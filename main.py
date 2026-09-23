import time
PROCESS_START = time.perf_counter()  # 用来算"导入库"花了多久 (pandas_ta 会带进 numba，导入本身就要几秒)

import os
import re
import json
import html
import yfinance as yf
import pandas as pd
import pandas_ta as ta
import requests
from openai import OpenAI
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from zoneinfo import ZoneInfo

from exports import export_downloads

IMPORT_SECS = time.perf_counter() - PROCESS_START

# === 1. 配置区域 ===
# 默认自选股列表 (马股代码记得加 .KL)：在 data/watchlist.json 还没生成之前使用
DEFAULT_WATCHLIST = [
    {"symbol": "1155.KL", "name": "Maybank 马银行"},
    {"symbol": "1023.KL", "name": "Public Bank 大众银行"},
    {"symbol": "5183.KL", "name": "Petronas Chemicals 国油化学"},
    {"symbol": "5296.KL", "name": "MR DIY"},
    {"symbol": "0083.KL", "name": "Press Metal 齐力工业"},
    {"symbol": "5168.KL", "name": "Hartalega 哈达维格"},
]

WATCHLIST_PATH = os.path.join("data", "watchlist.json")


def load_watchlist():
    # 优先用 scripts/fetch_watchlist.py 生成的全市场清单，
    # 还没跑过那个脚本时 (或文件为空) 就退回默认的 6 支股票，确保 bot 不会因此坏掉
    try:
        with open(WATCHLIST_PATH, encoding="utf-8") as f:
            watchlist = json.load(f)
        if watchlist:
            return watchlist
    except (FileNotFoundError, json.JSONDecodeError):
        pass
    return DEFAULT_WATCHLIST


WATCHLIST = load_watchlist()

REPORT_PATH = os.path.join("docs", "index.html")
REPORT_URL = "https://cja231.github.io/Bursa-bot/"
CHART_HISTORY_DAYS = 90  # 图表显示最近约 90 个交易日
# 流动性门槛 (按价格分级)：日成交量低于门槛的股票直接忽略，不进报告、也不参与信号判断
# 低价股要求更高的成交量，过滤掉交投清淡、容易被少量资金拉动的仙股
VOLUME_TIERS = [
    (0.10, 5_000_000),   # 价格 < 0.10          → 成交量至少 5M
    (0.20, 3_000_000),   # 0.10 ≤ 价格 < 0.20   → 至少 3M
    (0.50, 1_000_000),   # 0.20 ≤ 价格 ≤ 0.50   → 至少 1M (0.50 本身也算在这一档)
]
MIN_DAILY_VOLUME = 500_000  # 其余价格 (> 0.50) 的门槛，保持不变


def min_volume_for(price):
    for upper, min_vol in VOLUME_TIERS:
        if price < upper or (upper == 0.50 and price == 0.50):
            return min_vol
    return MIN_DAILY_VOLUME
MYT = ZoneInfo("Asia/Kuala_Lumpur")

# 并发抓取股票数据的线程数：yfinance 请求是网络 I/O，并发能大幅缩短整体运行时间
# (实测: 串行 188 秒 → 16 线程 49.5 秒，run #207 在 16 线程下 0 支抓取失败)。
# 数字太大容易被 Yahoo Finance 限流：日志里"数据不足/抓取失败"如果明显变多，就把这里调回 16。
FETCH_WORKERS = 24

DEEPSEEK_KEY = os.environ.get("DEEPSEEK_KEY")
NTFY_TOPIC = os.environ.get("NTFY_TOPIC")  # 可选：手机推送通知 (ntfy.sh)，不设置则跳过推送
FORCE_RUN = os.environ.get("FORCE_RUN", "").lower() == "true"  # 手动测试用：跳过交易日检查

if not DEEPSEEK_KEY:
    raise SystemExit(
        "缺少环境变量: DEEPSEEK_KEY。"
        " 请在 GitHub 仓库 Settings → Secrets and variables → Actions 中添加对应的 Secret。"
    )

# === 2. 初始化 DeepSeek 客户端 ===
# 关键修改点：base_url 必须是 deepseek 的地址
client = OpenAI(
    api_key=DEEPSEEK_KEY,               # 从 GitHub Secrets 读取密码
    base_url="https://api.deepseek.com" # 👈 这里指定连接 DeepSeek
)

# === T3 形态 ===
# 过去 2~5 天前某天放量(成交量 > 前20日均量)创出当天最高价 High1，
# 之后到今天为止每天最高价都低于 High1 (纯回调，没有提前破位)，
# 且今天收盘价突破 High1 → 判定命中
def detect_t3_pattern(df):
    if len(df) < 26:
        return False

    vol_avg20 = df["Volume"].rolling(20).mean().shift(1)
    today_close = df["Close"].iloc[-1]
    last_idx = len(df) - 1

    for offset in range(2, 6):  # T1 = 今天往前 2~5 天
        t1_idx = last_idx - offset
        if t1_idx < 20:
            continue

        t1_volume = df["Volume"].iloc[t1_idx]
        t1_vol_avg = vol_avg20.iloc[t1_idx]
        if pd.isna(t1_vol_avg) or t1_volume <= t1_vol_avg:
            continue

        high1 = df["High"].iloc[t1_idx]
        pullback_highs = df["High"].iloc[t1_idx + 1 : last_idx]
        if (pullback_highs >= high1).any():
            continue  # 中途已经提前破位，不算纯回调

        if today_close > high1:
            return True

    return False

# === 3. 获取数据并计算指标 ===
def get_stock_data(symbol, retries=1, check_volume=True):
    # retries=1: 并发抓取时个别请求偶尔会被 Yahoo Finance 短暂拒绝/超时，失败先重试一次再放弃，
    # 避免因为网络抖动而把本来有效的股票直接判定为"无数据"。
    for attempt in range(retries + 1):
        try:
            stock = yf.Ticker(symbol)
            # 获取过去 6 个月的数据以计算均线
            df = stock.history(period="6mo")

            if len(df) < 50:
                print(f"数据不足: {symbol}")
                return None

            # 成交量门槛放在算指标之前：实测 1070 支里约 3/4 会因为成交量不足被丢掉，
            # 以前是先把 RSI/SMA/EMA/PSAR/T3 全算完才丢，白白占 CPU (这部分多线程也帮不上忙)
            if check_volume:
                # 先四舍五入到 3 位 (Bursa 最小跳动 0.005)，避免 0.0999999 这类浮点误差把 0.10 的股票分错档
                last_close = round(float(df["Close"].iloc[-1]), 3)
                last_volume = int(df["Volume"].iloc[-1])
                threshold = min_volume_for(last_close)
                if last_volume < threshold:
                    return {"symbol": symbol, "low_volume": True, "close": round(last_close, 3),
                            "volume": last_volume, "threshold": threshold}

            # 计算技术指标 (RSI、均线、EMA20、Parabolic SAR)
            df.ta.rsi(length=14, append=True)
            df.ta.sma(length=50, append=True)
            df.ta.ema(length=20, append=True)
            df.ta.psar(append=True)

            # PSAR 在多头/空头趋势下分别写入不同的列，合并成单一数值方便比较
            psar_long_col = next(c for c in df.columns if c.startswith("PSARl"))
            psar_short_col = next(c for c in df.columns if c.startswith("PSARs"))
            df["PSAR"] = df[psar_long_col].combine_first(df[psar_short_col])

            #以此获取最新一天的数值
            latest = df.iloc[-1]
            prev = df.iloc[-2]

            # 供 K 线图使用的历史数据 (最近 CHART_HISTORY_DAYS 个交易日)
            chart_df = df.tail(CHART_HISTORY_DAYS)
            candles = [
                {
                    "time": idx.strftime("%Y-%m-%d"),
                    "open": round(row["Open"], 3),
                    "high": round(row["High"], 3),
                    "low": round(row["Low"], 3),
                    "close": round(row["Close"], 3),
                    "volume": int(row["Volume"]),
                }
                for idx, row in chart_df.iterrows()
            ]
            ema20 = [
                {"time": idx.strftime("%Y-%m-%d"), "value": round(row["EMA_20"], 3)}
                for idx, row in chart_df.iterrows()
                if pd.notna(row["EMA_20"])
            ]
            # SAR 整条序列也传给前端，给报告页面里的"SAR"预设指标画图用
            # (策略判断只用得上最新一天的 sar_bullish_now，但画图需要整条历史)
            psar_series = [
                {"time": idx.strftime("%Y-%m-%d"), "value": round(row["PSAR"], 3)}
                for idx, row in chart_df.iterrows()
                if pd.notna(row["PSAR"])
            ]

            # 相对成交量 = 今天成交量 / 前 20 个交易日平均成交量 (不含今天)，跟 TradingView 的 "相对成交量" 同一个意思
            vol_avg20 = df["Volume"].iloc[-21:-1].mean()
            rel_volume = round(latest['Volume'] / vol_avg20, 2) if vol_avg20 and pd.notna(vol_avg20) else None

            return {
                "symbol": symbol,
                "close": round(latest['Close'], 3),
                "rsi": round(latest['RSI_14'], 2),
                "sma50": round(latest['SMA_50'], 3),
                "prev_close": prev['Close'],
                "prev_sma50": prev['SMA_50'],
                "ema20_latest": round(latest['EMA_20'], 3),
                "sar_bullish_now": latest['Close'] > latest['PSAR'],
                "sar_bullish_prev": prev['Close'] > prev['PSAR'],
                "t3_pattern": detect_t3_pattern(df),
                "volume": int(latest['Volume']),
                "rel_volume": rel_volume,
                "candles": candles,
                "ema20": ema20,
                "psar": psar_series,
            }
        except Exception as e:
            if attempt < retries:
                continue
            print(f"获取失败 {symbol}: {e}")
            return None

def get_intraday_closes(symbol):
    """当天 (或最近一个交易日) 的 5 分钟收盘价序列，给表格里的迷你走势图用。拿不到就返回 None。"""
    try:
        df = yf.Ticker(symbol).history(period="1d", interval="5m")
        closes = [round(float(c), 4) for c in df["Close"].dropna()]
        return closes if len(closes) >= 2 else None
    except Exception:
        return None


def build_sparkline(values, baseline=None, width=72, height=24):
    """
    生成一个内嵌 SVG 迷你折线图 (服务端直接画好，不需要 JS，也不用加载图表库)。
    baseline: 画一条虚线基准 (日内图用昨收)；颜色按"最后一个点 相对 基准(或第一个点)"决定涨跌。
    颜色走 CSS 变量 --up/--down，所以报告页面里改颜色也会同步到这里。
    """
    if not values or len(values) < 2:
        return ""
    ref = baseline if baseline is not None else values[0]
    lo = min(values + [ref])
    hi = max(values + [ref])
    span = (hi - lo) or 1
    step = width / (len(values) - 1)

    def y(v):
        return height - 1 - (v - lo) / span * (height - 2)

    points = " ".join(f"{i * step:.1f},{y(v):.1f}" for i, v in enumerate(values))
    # 跟"涨跌%"同一套颜色规则：涨=绿、跌=红、没变=灰
    trend = "spark-up" if values[-1] > ref else "spark-down" if values[-1] < ref else "spark-flat"
    base_line = f'<line x1="0" x2="{width}" y1="{y(ref):.1f}" y2="{y(ref):.1f}"/>' if baseline is not None else ""
    return (f'<svg class="spark {trend}" viewBox="0 0 {width} {height}" width="{width}" height="{height}" '
            f'preserveAspectRatio="none" aria-hidden="true">{base_line}<polyline points="{points}"/></svg>')


def fmt_num(v, pattern, missing="—"):
    """数字格式化；None / NaN 显示成 "—"。价格 14 天没动的股票 RSI 会是 NaN (0/0)，以前表格里直接显示 "nan"。"""
    if v is None or (isinstance(v, float) and v != v):
        return missing
    return pattern.format(v)


def fmt_volume(v):
    if v >= 1e9:
        return f"{v / 1e9:.2f}B"
    if v >= 1e6:
        return f"{v / 1e6:.2f}M"
    if v >= 1e3:
        return f"{v / 1e3:.1f}K"
    return str(v)

# === 4. 筛选策略 ===
# 四个条件同时满足才算命中 (成交量 > 500k 已经在 main() 里作为门槛提前筛掉，这里不用重复判断):
#   - EMA20 < 现价 (价格站上 EMA20)
#   - SAR < 现价 (SAR 在价格下方，多头状态)
#   - T3 形态 (放量创高后回调，今天再次突破)
def check_strategy(data):
    """
    在这里修改你的筛选条件
    返回: (是否符合, 原因)
    """
    if not (data['close'] > data['ema20_latest']):
        return False, None

    if not data['sar_bullish_now']:
        return False, None

    if not data['t3_pattern']:
        return False, None

    return True, "🎯 EMA20多头 + SAR多头 + T3形态突破"

# === 5. 呼叫 DeepSeek 进行分析 ===
# system prompt 独立成常量、内容完全固定 (不拼时间戳/随机数)，且不含任何逐股票才知道的数据；
# 每支股票变化的部分全部放进 user message。DeepSeek 的 prompt cache 是按"从头开始逐字节比对的
# 最长公共前缀"计费打折的，一次运行里命中的股票经常不止一支，只要 system prompt 前缀完全一致，
# 从第二支股票开始这一段就能命中缓存、按缓存价计费，比混在一起写省钱也通常更快。
DEEPSEEK_SYSTEM_PROMPT = """你是专业的马来西亚股市分析师，同时是严谨的金融助手。

任务: 根据用户给出的某支股票的技术信号和基本数据，用简短的中文 (50字以内) 从技术面评价这个信号的可靠性，
例如 RSI 是否偏高或超买、现价相对 50 日均线的位置。

严格要求: 只做客观的技术面描述，不要给出任何操作或投资建议，
不要出现买入、卖出、观望、持有、加仓、减仓、止损、止盈、目标价之类的字眼。

接下来用户消息里会给出这支股票的具体数据，请只根据这些数据作答，不要虚构未提供的信息。"""

# 就算模型没听话，也把带操作建议的分句删掉再放进报告 (图表下方、Excel、PDF 都用这个结果)
TRADE_ADVICE_RE = re.compile(
    r"买入|买进|卖出|抛售|观望|建议|加仓|减仓|建仓|清仓|止损|止盈|目标价|入场|进场|离场|出场|持有|逢低|逢高|介入"
)


def strip_trade_advice(text):
    """按标点切成分句，去掉含操作建议字眼的分句；全部被去掉就返回空字符串 (页面上不显示点评)。"""
    if not text:
        return ""
    parts = re.split(r"([，,。！？!?；;：:\n])", text)
    kept = []
    for i in range(0, len(parts), 2):
        clause, sep = parts[i], parts[i + 1] if i + 1 < len(parts) else ""
        if clause.strip() and not TRADE_ADVICE_RE.search(clause):
            kept.append(clause + sep)
    result = "".join(kept).strip().rstrip("，,；;：:")
    return result + "。" if result and result[-1] not in "。！？!?" else result


def ask_deepseek(data, reason):
    # 这部分每支股票都不一样，所以放在 user message 里，不会污染上面固定的 system prompt 前缀
    stock_info = f"""股票代码: {data['symbol']}
触发信号: {reason}

基本数据:
- 现价: RM {data['close']}
- RSI (14): {data['rsi']}
- 50日均线: RM {data['sma50']}"""

    try:
        response = client.chat.completions.create(
            model="deepseek-chat",  # 👈 指定使用 DeepSeek V3 模型
            messages=[
                {"role": "system", "content": DEEPSEEK_SYSTEM_PROMPT},
                {"role": "user", "content": stock_info}
            ],
            temperature=0.1, # 让回答更稳定
            max_tokens=100
        )
        usage = getattr(response, "usage", None)
        if usage:
            hit = getattr(usage, "prompt_cache_hit_tokens", None)
            miss = getattr(usage, "prompt_cache_miss_tokens", None)
            if hit is not None or miss is not None:
                print(f"   💰 DeepSeek prompt cache: 命中 {hit} tokens / 未命中 {miss} tokens")
        return response.choices[0].message.content
    except Exception as e:
        return f"DeepSeek 分析出错: {e}"

# === 6. 报告页面的设置面板 (颜色自定义 + 自定义指标公式) ===
# 这几块单独写成普通字符串 (不是 f-string)，因为内容全是 JS/CSS 不需要 Python 变量插值，
# 这样大括号不用到处写成 {{ }}，改起来更不容易出错。

SETTINGS_CSS = """
  /* 设置面板里好几个元素用 hidden 属性切换显示，但它们自己的 class 又写了 display: flex，
     会盖掉浏览器默认的 [hidden] { display: none }，导致"隐藏"不生效。这里统一强制一下。 */
  [hidden] { display: none !important; }
  .settings-toggle {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.4rem 0.75rem;
    font-size: 0.85rem;
    color: var(--text-primary);
    cursor: pointer;
    margin-bottom: 1rem;
  }
  .settings-toggle:hover { background: var(--page); }
  .settings-panel {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1rem;
    margin-bottom: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }
  .settings-section h3 { margin: 0 0 0.5rem; font-size: 0.95rem; }
  .settings-section label {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    margin-right: 1rem;
    font-size: 0.85rem;
    color: var(--text-secondary);
  }
  .settings-section input[type="color"] {
    width: 28px;
    height: 28px;
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0;
    background: none;
    cursor: pointer;
  }
  .settings-section button {
    background: var(--page);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.35rem 0.7rem;
    font-size: 0.8rem;
    color: var(--text-primary);
    cursor: pointer;
  }
  .settings-section button:hover { background: var(--gridline); }
  .hint { font-size: 0.78rem; color: var(--muted); line-height: 1.7; margin: 0 0 0.75rem; }
  .hint code {
    font-family: ui-monospace, "SFMono-Regular", Menlo, monospace;
    background: var(--page);
    padding: 0.05rem 0.3rem;
    border-radius: 3px;
  }
  .indicator-form { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; margin-bottom: 0.5rem; }
  .indicator-form input[type="text"] {
    background: var(--page);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.4rem 0.6rem;
    font-size: 0.85rem;
    color: var(--text-primary);
  }
  #ind-name { width: 130px; }
  #ind-formula { flex: 1; min-width: 220px; font-family: ui-monospace, "SFMono-Regular", Menlo, monospace; }
  .ind-error { color: var(--down); font-size: 0.8rem; margin: 0 0 0.5rem; }
  .indicator-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; }
  .indicator-list li { display: flex; align-items: center; gap: 0.5rem; font-size: 0.82rem; background: var(--page); border-radius: 6px; padding: 0.35rem 0.6rem; }
  .ind-swatch { width: 12px; height: 12px; border-radius: 3px; flex-shrink: 0; }
  .ind-name { font-weight: 600; white-space: nowrap; }
  .ind-formula { color: var(--text-secondary); flex: 1; overflow-x: auto; white-space: nowrap; }
  .ind-remove { background: none; border: none; color: var(--muted); cursor: pointer; font-size: 1rem; line-height: 1; padding: 0 0.25rem; }
  .ind-remove:hover { color: var(--down); }
  .ind-tabs {
    display: flex;
    gap: 0.4rem;
    overflow-x: auto;
    padding-bottom: 0.4rem;
    margin-bottom: 0.75rem;
    -webkit-overflow-scrolling: touch;
  }
  .ind-tab {
    flex: 0 0 auto;
    background: var(--page);
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 0.35rem 0.9rem;
    font-size: 0.8rem;
    color: var(--text-secondary);
    cursor: pointer;
    white-space: nowrap;
  }
  .ind-tab.active { background: var(--text-primary); color: var(--surface); border-color: var(--text-primary); }
  .ind-presets { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.75rem; }
  .ind-preset-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    background: var(--page);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.4rem 0.7rem;
    font-size: 0.82rem;
    color: var(--text-primary);
    cursor: pointer;
  }
  .ind-preset-btn:hover { background: var(--gridline); }
  .ind-preset-btn .ind-swatch { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
  .ind-preset-btn.added { opacity: 0.5; cursor: default; }
  .ind-scale-toggle { display: inline-flex; align-items: center; gap: 0.3rem; font-size: 0.8rem; color: var(--text-secondary); }
  .ind-list-title { font-size: 0.85rem; margin: 0.5rem 0 0.4rem; color: var(--text-secondary); font-weight: 600; }
"""

TABLE_CSS = """
  /* ---- "其余股票" 表格: 参考 TradingView 选股器，紧凑行 + 代码徽章 + 迷你走势图 ---- */
  .table-toolbar { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.6rem; }
  #table-filter {
    flex: 0 1 260px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.4rem 0.6rem;
    font-size: 0.85rem;
    color: var(--text-primary);
  }
  .table-count { color: var(--muted); font-size: 0.8rem; }
  /* 宽度跟着内容走，不要在大屏上被拉满整行，列与列之间才不会空一大截 */
  table.data-table { font-size: 0.8rem; width: auto; min-width: min(100%, 760px); }
  table.data-table th, table.data-table td { padding: 0.3rem 0.55rem; line-height: 1.3; }
  table.data-table th { font-weight: 500; font-size: 0.75rem; }
  table.data-table th[data-type="none"] { cursor: default; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  th.num { text-align: right; }
  /* 序号列：用 CSS 计数器生成，排序/搜索之后会自动重新从 1 开始编号 (被搜索隐藏的行不计数) */
  #watchlist-table tbody { counter-reset: row; }
  #watchlist-table tbody tr { counter-increment: row; }
  #watchlist-table td.idx-cell::before { content: counter(row); }
  .idx-cell {
    position: sticky;
    left: 0;
    z-index: 2;
    width: 2.6rem;
    min-width: 2.6rem;
    max-width: 2.6rem;
    text-align: right;
    color: var(--muted);
    background: var(--surface);
    font-variant-numeric: tabular-nums;
  }
  table.data-table tbody tr:hover td.idx-cell { background: var(--page); }
  /* 股票列在手机上横向滑动时固定在左边 (紧贴在序号列右边) */
  .stock-cell {
    position: sticky;
    left: 2.6rem;
    z-index: 1;
    background: var(--surface);
    max-width: 150px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  table.data-table tbody tr:hover td.stock-cell { background: var(--page); }
  .ticker {
    display: inline-block;
    background: var(--page);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0.05rem 0.35rem;
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    margin-right: 0.35rem;
    vertical-align: middle;
  }
  .stock-code { color: var(--muted); font-size: 0.7rem; vertical-align: middle; }
  .unit { color: var(--muted); font-size: 0.65em; margin-left: 2px; }
  .spark-cell { padding-top: 0.15rem; padding-bottom: 0.15rem; }
  .spark { display: block; }
  .spark polyline { fill: none; stroke-width: 1.3; stroke-linejoin: round; }
  .spark-up polyline { stroke: var(--up); }
  .spark-down polyline { stroke: var(--down); }
  .spark-flat polyline { stroke: var(--muted); }
  .spark line { stroke: var(--muted); stroke-width: 0.6; stroke-dasharray: 2 2; }
  .relvol-high { font-weight: 700; color: var(--text-primary); }
  .pill { display: inline-block; padding: 0.05rem 0.45rem; border-radius: 999px; font-size: 0.7rem; font-weight: 600; }
  .pill-up { color: var(--up); background: color-mix(in srgb, var(--up) 14%, transparent); }
  .pill-down { color: var(--down); background: color-mix(in srgb, var(--down) 14%, transparent); }
"""

SETTINGS_PANEL_HTML = """
<button id="settings-toggle" class="settings-toggle" type="button" aria-expanded="false">⚙️ 图表设置</button>
<div id="settings-panel" class="settings-panel" hidden>
  <div class="settings-section">
    <h3>颜色</h3>
    <label>上涨 <input type="color" id="color-up"></label>
    <label>下跌 <input type="color" id="color-down"></label>
    <label>EMA20 <input type="color" id="color-ema"></label>
    <button type="button" id="color-reset">恢复默认</button>
  </div>
  <div class="settings-section">
    <h3>技术指标</h3>
    <div class="ind-tabs" id="ind-tabs">
      <button type="button" class="ind-tab active" data-cat="trend">趋势</button>
      <button type="button" class="ind-tab" data-cat="momentum">动量</button>
      <button type="button" class="ind-tab" data-cat="volatility">波动性</button>
      <button type="button" class="ind-tab" data-cat="volume">成交量</button>
      <button type="button" class="ind-tab" data-cat="custom">自定义公式</button>
    </div>

    <div id="ind-presets" class="ind-presets"></div>

    <div id="ind-custom-form" class="indicator-form" hidden>
      <input type="text" id="ind-name" placeholder="名称，例如 SMA10">
      <input type="text" id="ind-formula" placeholder="公式，例如 sma(close,10)">
      <input type="color" id="ind-color" value="#e8a33d">
      <label class="ind-scale-toggle"><input type="checkbox" id="ind-own-scale"> 独立坐标轴 (适合震荡类指标)</label>
      <button type="button" id="ind-add">添加到所有图表</button>
    </div>
    <p id="ind-error" class="ind-error" hidden></p>
    <p class="hint" id="ind-formula-hint" hidden>
      可用变量: <code>close</code> <code>open</code> <code>high</code> <code>low</code> <code>volume</code>
      可用函数: <code>sma(x,n)</code> <code>ema(x,n)</code> <code>stdev(x,n)</code> <code>highest(x,n)</code> <code>lowest(x,n)</code> <code>rsi(x,n)</code> <code>atr(n)</code> <code>obv()</code> <code>sum(x,n)</code> <code>abs(x)</code><br>
      例如: <code>sma(close,10)</code>　<code>ema(close,12)-ema(close,26)</code>　<code>sma(close,20)+2*stdev(close,20)</code>
    </p>

    <h4 class="ind-list-title">已添加</h4>
    <ul id="ind-list" class="indicator-list"></ul>
  </div>
  <p class="hint">以上设置只保存在你自己的浏览器里，不会影响其他人看到的报告，下次自动更新报告后依然保留。</p>
</div>
"""

CHART_SCRIPT = """
<script>
(function () {
  var data = JSON.parse(document.getElementById('chart-data').textContent);
  var chartRegistry = {}; // chartId -> { chart, candleSeries, emaSeries, volumeSeries, customSeries: {id: series} }

  // ---------- 颜色: 读取/应用/持久化 ----------
  var COLOR_KEYS = ['up', 'down', 'ema'];
  var COLOR_STORAGE_KEY = 'bursa_colors_v1';

  function loadSavedColors() {
    try { return JSON.parse(localStorage.getItem(COLOR_STORAGE_KEY) || '{}'); } catch (e) { return {}; }
  }
  function saveColors() {
    try {
      var toSave = {};
      COLOR_KEYS.forEach(function (k) {
        var v = document.documentElement.style.getPropertyValue('--' + k);
        if (v) toSave[k] = v.trim();
      });
      localStorage.setItem(COLOR_STORAGE_KEY, JSON.stringify(toSave));
    } catch (e) {}
  }
  // 页面一加载就把上次保存的颜色套回 CSS 变量，这样第一次画图就是对的颜色，不会先画默认色再闪一下
  (function applySavedColors() {
    var saved = loadSavedColors();
    COLOR_KEYS.forEach(function (k) {
      if (saved[k]) document.documentElement.style.setProperty('--' + k, saved[k]);
    });
  })();

  function computeColors() {
    var st = getComputedStyle(document.documentElement);
    return {
      text: st.getPropertyValue('--text-secondary').trim(),
      grid: st.getPropertyValue('--gridline').trim(),
      up: st.getPropertyValue('--up').trim(),
      down: st.getPropertyValue('--down').trim(),
      ema: st.getPropertyValue('--ema').trim()
    };
  }
  var colors = computeColors();

  function updateAllChartColors() {
    Object.keys(chartRegistry).forEach(function (chartId) {
      var reg = chartRegistry[chartId];
      reg.candleSeries.applyOptions({
        downColor: colors.down,
        borderUpColor: colors.up,
        borderDownColor: colors.down,
        wickUpColor: colors.up,
        wickDownColor: colors.down
      });
      reg.emaSeries.applyOptions({ color: colors.ema });
      reg.volumeSeries.setData(data[chartId].candles.map(function (c) {
        return { time: c.time, value: c.volume, color: c.close >= c.open ? colors.up : colors.down };
      }));
    });
  }

  // ---------- 自定义指标: 小型公式解析/计算引擎 ----------
  var customIndicators = []; // [{id, name, formula, color}]
  var IND_STORAGE_KEY = 'bursa_custom_indicators_v1';

  function loadSavedIndicators() {
    try { return JSON.parse(localStorage.getItem(IND_STORAGE_KEY) || '[]'); } catch (e) { return []; }
  }
  function saveIndicators() {
    try { localStorage.setItem(IND_STORAGE_KEY, JSON.stringify(customIndicators)); } catch (e) {}
  }

  function isArr(v) { return Array.isArray(v); }

  // 两个操作数做逐点运算，任一操作数是数组就按数组逐点算 (标量会自动广播)，null 值会一路传播下去
  function ew(a, b, fn) {
    if (isArr(a) && isArr(b)) {
      return a.map(function (v, i) {
        var w = b[i];
        return (v === null || v === undefined || w === null || w === undefined || isNaN(v) || isNaN(w)) ? null : fn(v, w);
      });
    }
    if (isArr(a)) return a.map(function (v) { return (v === null || v === undefined || isNaN(v)) ? null : fn(v, b); });
    if (isArr(b)) return b.map(function (w) { return (w === null || w === undefined || isNaN(w)) ? null : fn(a, w); });
    return fn(a, b);
  }

  function seriesSMA(arr, n) {
    var out = new Array(arr.length).fill(null);
    for (var i = 0; i < arr.length; i++) {
      if (i < n - 1) continue;
      var sum = 0, ok = true;
      for (var j = i - n + 1; j <= i; j++) {
        if (arr[j] === null || arr[j] === undefined || isNaN(arr[j])) { ok = false; break; }
        sum += arr[j];
      }
      out[i] = ok ? sum / n : null;
    }
    return out;
  }
  function seriesEMA(arr, n) {
    var k = 2 / (n + 1);
    var out = new Array(arr.length).fill(null);
    var prev = null;
    for (var i = 0; i < arr.length; i++) {
      var v = arr[i];
      if (v === null || v === undefined || isNaN(v)) { out[i] = null; prev = null; continue; }
      prev = prev === null ? v : v * k + prev * (1 - k);
      out[i] = prev;
    }
    return out;
  }
  function seriesStdev(arr, n) {
    var sma = seriesSMA(arr, n);
    var out = new Array(arr.length).fill(null);
    for (var i = 0; i < arr.length; i++) {
      if (sma[i] === null) continue;
      var sumSq = 0, ok = true;
      for (var j = i - n + 1; j <= i; j++) {
        if (arr[j] === null || arr[j] === undefined || isNaN(arr[j])) { ok = false; break; }
        sumSq += Math.pow(arr[j] - sma[i], 2);
      }
      out[i] = ok ? Math.sqrt(sumSq / n) : null;
    }
    return out;
  }
  function seriesExtreme(arr, n, better) {
    var out = new Array(arr.length).fill(null);
    for (var i = 0; i < arr.length; i++) {
      if (i < n - 1) continue;
      var slice = arr.slice(i - n + 1, i + 1);
      if (slice.some(function (v) { return v === null || v === undefined || isNaN(v); })) continue;
      out[i] = better.apply(null, slice);
    }
    return out;
  }
  function seriesSum(arr, n) {
    var out = new Array(arr.length).fill(null);
    for (var i = 0; i < arr.length; i++) {
      if (i < n - 1) continue;
      var s = 0, ok = true;
      for (var j = i - n + 1; j <= i; j++) {
        if (arr[j] === null || arr[j] === undefined || isNaN(arr[j])) { ok = false; break; }
        s += arr[j];
      }
      out[i] = ok ? s : null;
    }
    return out;
  }
  // Wilder 平滑的 RSI (跟 pandas_ta 后台算策略用的那套是同一种平滑方式，不是简单 EMA)
  function seriesRSI(closeArr, n) {
    var out = new Array(closeArr.length).fill(null);
    if (closeArr.length <= n) return out;
    var gains = [], losses = [];
    for (var i = 1; i < closeArr.length; i++) {
      var c0 = closeArr[i - 1], c1 = closeArr[i];
      if (c0 === null || c1 === null || c0 === undefined || c1 === undefined || isNaN(c0) || isNaN(c1)) {
        gains.push(null); losses.push(null); continue;
      }
      var change = c1 - c0;
      gains.push(change > 0 ? change : 0);
      losses.push(change < 0 ? -change : 0);
    }
    var avgGain = null, avgLoss = null;
    for (var idx = 0; idx < gains.length; idx++) {
      var barIndex = idx + 1;
      if (idx < n - 1) continue;
      if (idx === n - 1) {
        var sumG = 0, sumL = 0, ok = true;
        for (var j = 0; j < n; j++) {
          if (gains[j] === null) { ok = false; break; }
          sumG += gains[j]; sumL += losses[j];
        }
        if (!ok) continue;
        avgGain = sumG / n;
        avgLoss = sumL / n;
      } else {
        if (gains[idx] === null || avgGain === null) { avgGain = null; avgLoss = null; continue; }
        avgGain = (avgGain * (n - 1) + gains[idx]) / n;
        avgLoss = (avgLoss * (n - 1) + losses[idx]) / n;
      }
      if (avgGain === null) continue;
      out[barIndex] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
    return out;
  }
  // ATR: 真实波幅 (Wilder 平滑)，需要用到前一天收盘价，所以直接用 ctx 里的 high/low/close，不走 arrayArg
  function seriesATR(ctx, n) {
    var high = ctx.series.high, low = ctx.series.low, close = ctx.series.close;
    var tr = new Array(high.length).fill(null);
    for (var i = 0; i < high.length; i++) {
      if (i === 0) { tr[i] = high[i] - low[i]; continue; }
      var pc = close[i - 1];
      if (pc === null || pc === undefined || isNaN(pc)) { tr[i] = high[i] - low[i]; continue; }
      tr[i] = Math.max(high[i] - low[i], Math.abs(high[i] - pc), Math.abs(low[i] - pc));
    }
    var out = new Array(tr.length).fill(null);
    var avg = null;
    for (var i = 0; i < tr.length; i++) {
      if (i < n - 1) continue;
      if (i === n - 1) {
        var sum = 0;
        for (var j = i - n + 1; j <= i; j++) sum += tr[j];
        avg = sum / n;
      } else {
        avg = (avg * (n - 1) + tr[i]) / n;
      }
      out[i] = avg;
    }
    return out;
  }
  // OBV: 累积能量潮，跟 ATR 一样直接吃 ctx 里的 close/volume
  function seriesOBV(ctx) {
    var close = ctx.series.close, volume = ctx.series.volume;
    var out = new Array(close.length).fill(null);
    var cum = 0;
    for (var i = 0; i < close.length; i++) {
      if (i === 0) { out[i] = 0; continue; }
      if (close[i] > close[i - 1]) cum += volume[i];
      else if (close[i] < close[i - 1]) cum -= volume[i];
      out[i] = cum;
    }
    return out;
  }

  function evalFormula(formula, ctx) {
    var s = formula;
    var pos = 0;

    function skipSpace() { while (pos < s.length && /\\s/.test(s[pos])) pos++; }
    function consume(ch) {
      skipSpace();
      if (s[pos] !== ch) throw new Error('语法错误，期望 "' + ch + '"，但看到 "' + (s[pos] || '(末尾)') + '"');
      pos++;
    }
    function parseNumber() {
      skipSpace();
      var start = pos;
      while (pos < s.length && /[0-9.]/.test(s[pos])) pos++;
      if (pos === start) throw new Error('无效的数字');
      return parseFloat(s.slice(start, pos));
    }
    function parseIdent() {
      skipSpace();
      var start = pos;
      while (pos < s.length && /[a-zA-Z_0-9]/.test(s[pos])) pos++;
      if (pos === start) throw new Error('无效的名称');
      return s.slice(start, pos);
    }
    function lookupSeries(name) {
      if (ctx.series.hasOwnProperty(name)) return ctx.series[name];
      throw new Error('未知变量: ' + name + ' (可用: close open high low volume)');
    }
    function requireArgs(name, args, count) {
      if (args.length !== count) throw new Error(name + '() 需要 ' + count + ' 个参数，实际给了 ' + args.length + ' 个');
    }
    function arrayArg(v, label) {
      if (!isArr(v)) throw new Error(label + ' 必须是一条时间序列 (例如 close)，不能是单个数字');
      return v;
    }
    function periodArg(v, label) {
      if (isArr(v)) throw new Error(label + ' 必须是一个数字');
      if (typeof v !== 'number' || isNaN(v) || v <= 0) throw new Error(label + ' 必须是大于 0 的数字');
      return Math.round(v);
    }
    function callFunction(name, args) {
      switch (name) {
        case 'sma': requireArgs('sma', args, 2); return seriesSMA(arrayArg(args[0], 'sma 的第一个参数'), periodArg(args[1], 'sma 的周期'));
        case 'ema': requireArgs('ema', args, 2); return seriesEMA(arrayArg(args[0], 'ema 的第一个参数'), periodArg(args[1], 'ema 的周期'));
        case 'stdev': requireArgs('stdev', args, 2); return seriesStdev(arrayArg(args[0], 'stdev 的第一个参数'), periodArg(args[1], 'stdev 的周期'));
        case 'highest': requireArgs('highest', args, 2); return seriesExtreme(arrayArg(args[0], 'highest 的第一个参数'), periodArg(args[1], 'highest 的周期'), Math.max);
        case 'lowest': requireArgs('lowest', args, 2); return seriesExtreme(arrayArg(args[0], 'lowest 的第一个参数'), periodArg(args[1], 'lowest 的周期'), Math.min);
        case 'sum': requireArgs('sum', args, 2); return seriesSum(arrayArg(args[0], 'sum 的第一个参数'), periodArg(args[1], 'sum 的周期'));
        case 'rsi': requireArgs('rsi', args, 2); return seriesRSI(arrayArg(args[0], 'rsi 的第一个参数'), periodArg(args[1], 'rsi 的周期'));
        case 'atr': requireArgs('atr', args, 1); return seriesATR(ctx, periodArg(args[0], 'atr 的周期'));
        case 'obv': requireArgs('obv', args, 0); return seriesOBV(ctx);
        case 'abs':
          requireArgs('abs', args, 1);
          return isArr(args[0]) ? args[0].map(function (v) { return (v === null || v === undefined || isNaN(v)) ? null : Math.abs(v); }) : Math.abs(args[0]);
        default:
          throw new Error('未知函数: ' + name + '() (可用: sma ema stdev highest lowest sum rsi atr obv abs)');
      }
    }
    function parsePrimary() {
      skipSpace();
      var ch = s[pos];
      if (ch === '(') {
        pos++;
        var v = parseExpr();
        consume(')');
        return v;
      }
      if (ch !== undefined && /[0-9.]/.test(ch)) return parseNumber();
      if (ch !== undefined && /[a-zA-Z_]/.test(ch)) {
        var name = parseIdent();
        skipSpace();
        if (s[pos] === '(') {
          pos++;
          var args = [];
          skipSpace();
          if (s[pos] !== ')') {
            args.push(parseExpr());
            skipSpace();
            while (s[pos] === ',') { pos++; args.push(parseExpr()); skipSpace(); }
          }
          consume(')');
          return callFunction(name, args);
        }
        return lookupSeries(name);
      }
      throw new Error('公式无法解析，看不懂这里: "' + (ch === undefined ? '(末尾)' : s.slice(pos)) + '"');
    }
    function parseUnary() {
      skipSpace();
      if (s[pos] === '-') {
        pos++;
        return ew(parseUnary(), -1, function (a, b) { return a * b; });
      }
      return parsePower();
    }
    function parsePower() {
      var base = parsePrimary();
      skipSpace();
      if (s[pos] === '^') {
        pos++;
        return ew(base, parseUnary(), Math.pow);
      }
      return base;
    }
    function parseTerm() {
      var v = parseUnary();
      skipSpace();
      while (s[pos] === '*' || s[pos] === '/') {
        var op = s[pos]; pos++;
        var rhs = parseUnary();
        v = ew(v, rhs, op === '*' ? function (a, b) { return a * b; } : function (a, b) { return a / b; });
        skipSpace();
      }
      return v;
    }
    function parseExpr() {
      var v = parseTerm();
      skipSpace();
      while (s[pos] === '+' || s[pos] === '-') {
        var op = s[pos]; pos++;
        var rhs = parseTerm();
        v = ew(v, rhs, op === '+' ? function (a, b) { return a + b; } : function (a, b) { return a - b; });
        skipSpace();
      }
      return v;
    }

    var result = parseExpr();
    skipSpace();
    if (pos !== s.length) throw new Error('公式末尾有多余内容: "' + s.slice(pos) + '"');
    return result;
  }

  // 指标可以来自公式 (indicator.formula) 或者后台已经算好整条序列直接传过来的 (indicator.dataKey，目前只有 SAR)
  function computeIndicatorSeries(chartId, indicator) {
    var candles = data[chartId].candles;
    if (indicator.dataKey) {
      var raw = data[chartId][indicator.dataKey];
      if (!raw) throw new Error('这张图没有 ' + indicator.dataKey + ' 数据');
      return raw;
    }
    var ctx = {
      series: {
        close: candles.map(function (c) { return c.close; }),
        open: candles.map(function (c) { return c.open; }),
        high: candles.map(function (c) { return c.high; }),
        low: candles.map(function (c) { return c.low; }),
        volume: candles.map(function (c) { return c.volume; })
      }
    };
    var result = evalFormula(indicator.formula, ctx);
    if (!isArr(result)) throw new Error('公式结果必须是一条随时间变化的序列，不能只是一个固定数字');
    var points = [];
    candles.forEach(function (c, i) {
      var v = result[i];
      if (v !== null && v !== undefined && !isNaN(v)) points.push({ time: c.time, value: v });
    });
    return points;
  }

  // scale === 'volume': 跟成交量柱共用一条坐标轴 (适合"成交量均线"这种)
  // scale === 'own': 给这个指标单独开一条自动缩放的坐标轴，叠在图上但数值范围不跟价格挂钩 (适合 RSI/MACD 这类震荡指标)
  // 否则 (scale === 'price' 或没设置): 跟K线共用右侧价格坐标轴 (适合均线/布林带/SAR 这类跟价格同单位的指标)
  function scaleIdFor(indicator) {
    if (indicator.scale === 'volume') return '';
    if (indicator.scale === 'own') return 'ind-' + (indicator.scaleGroup || indicator.id);
    return undefined;
  }

  function addCustomIndicatorSeriesToChart(chartId, indicator) {
    var reg = chartRegistry[chartId];
    if (!reg) return;
    try {
      var opts = { color: indicator.color, lineWidth: indicator.dotted ? 1 : 2, priceLineVisible: false };
      if (indicator.dotted) opts.lineStyle = LightweightCharts.LineStyle.Dotted;
      var scaleId = scaleIdFor(indicator);
      if (scaleId !== undefined) opts.priceScaleId = scaleId;
      var series = reg.chart.addLineSeries(opts);
      series.setData(computeIndicatorSeries(chartId, indicator));
      if (indicator.scale === 'own') {
        reg.chart.priceScale(scaleId).applyOptions({ scaleMargins: { top: 0.05, bottom: 0.05 } });
      }
      reg.customSeries[indicator.id] = series;
    } catch (e) {
      console.warn('指标 "' + indicator.name + '" 在 ' + chartId + ' 渲染失败: ' + e.message);
    }
  }
  function applyIndicatorToAllCharts(indicator) {
    Object.keys(chartRegistry).forEach(function (chartId) { addCustomIndicatorSeriesToChart(chartId, indicator); });
  }
  function removeIndicator(id) {
    customIndicators = customIndicators.filter(function (ind) { return ind.id !== id; });
    saveIndicators();
    Object.keys(chartRegistry).forEach(function (chartId) {
      var reg = chartRegistry[chartId];
      if (reg.customSeries[id]) {
        reg.chart.removeSeries(reg.customSeries[id]);
        delete reg.customSeries[id];
      }
    });
    renderPresetGrid();
  }
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function renderIndicatorListItem(ind) {
    var list = document.getElementById('ind-list');
    if (!list) return;
    var detail = ind.formula || (ind.dataKey ? '(内置指标)' : '');
    var li = document.createElement('li');
    li.innerHTML = '<span class="ind-swatch" style="background:' + ind.color + '"></span>' +
      '<span class="ind-name">' + escapeHtml(ind.name) + '</span>' +
      '<code class="ind-formula">' + escapeHtml(detail) + '</code>' +
      '<button type="button" class="ind-remove" aria-label="删除">×</button>';
    li.querySelector('.ind-remove').addEventListener('click', function () {
      removeIndicator(ind.id);
      li.remove();
    });
    list.appendChild(li);
  }

  // ---------- 预设指标库: 分类导航 + 一键添加 ----------
  var INDICATOR_PRESETS = [
    { id: 'sma20', category: 'trend', name: 'SMA20', formula: 'sma(close,20)', color: '#3d8ce8', scale: 'price' },
    { id: 'sma50', category: 'trend', name: 'SMA50', formula: 'sma(close,50)', color: '#1f5fa8', scale: 'price' },
    { id: 'ema50', category: 'trend', name: 'EMA50', formula: 'ema(close,50)', color: '#8a5ce8', scale: 'price' },
    { id: 'sar', category: 'trend', name: 'SAR', dataKey: 'psar', color: '#e8a33d', scale: 'price', dotted: true },
    { id: 'boll_upper', category: 'trend', name: '布林带上轨(20,2)', formula: 'sma(close,20)+2*stdev(close,20)', color: '#e86e6e', scale: 'price' },
    { id: 'boll_mid', category: 'trend', name: '布林带中轨(20)', formula: 'sma(close,20)', color: '#c3c2b7', scale: 'price' },
    { id: 'boll_lower', category: 'trend', name: '布林带下轨(20,2)', formula: 'sma(close,20)-2*stdev(close,20)', color: '#6ee89b', scale: 'price' },

    { id: 'rsi14', category: 'momentum', name: 'RSI(14)', formula: 'rsi(close,14)', color: '#e8a33d', scale: 'own' },
    { id: 'macd_line', category: 'momentum', name: 'MACD线(12,26)', formula: 'ema(close,12)-ema(close,26)', color: '#3d8ce8', scale: 'own', scaleGroup: 'macd' },
    { id: 'macd_signal', category: 'momentum', name: 'MACD信号线(9)', formula: 'ema(ema(close,12)-ema(close,26),9)', color: '#e86e6e', scale: 'own', scaleGroup: 'macd' },
    { id: 'stoch_k', category: 'momentum', name: 'Stochastic %K(14)', formula: '(close-lowest(low,14))/(highest(high,14)-lowest(low,14))*100', color: '#8a5ce8', scale: 'own' },
    { id: 'cci20', category: 'momentum', name: 'CCI(20)', formula: '((high+low+close)/3-sma((high+low+close)/3,20))/(0.015*stdev((high+low+close)/3,20))', color: '#3dbf8e', scale: 'own' },
    { id: 'wr14', category: 'momentum', name: 'Williams %R(14)', formula: '(highest(high,14)-close)/(highest(high,14)-lowest(low,14))*-100', color: '#e86ec2', scale: 'own' },

    { id: 'atr14', category: 'volatility', name: 'ATR(14)', formula: 'atr(14)', color: '#e8a33d', scale: 'own' },
    { id: 'boll_width', category: 'volatility', name: '布林带带宽(20,2)', formula: '(sma(close,20)+2*stdev(close,20)-(sma(close,20)-2*stdev(close,20)))/sma(close,20)', color: '#3d8ce8', scale: 'own' },

    { id: 'obv', category: 'volume', name: 'OBV', formula: 'obv()', color: '#8a5ce8', scale: 'own' },
    { id: 'vol_sma20', category: 'volume', name: '成交量均线(20)', formula: 'sma(volume,20)', color: '#e8a33d', scale: 'volume' },
    { id: 'vwap20', category: 'volume', name: '滚动VWAP(20)', formula: 'sum((high+low+close)/3*volume,20)/sum(volume,20)', color: '#3dbf8e', scale: 'price' }
  ];
  var activeCategory = 'trend';

  function addPresetIndicator(preset) {
    var indicator = {
      id: 'ind-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      presetId: preset.id,
      name: preset.name,
      color: preset.color,
      scale: preset.scale,
      scaleGroup: preset.scaleGroup,
      dotted: preset.dotted
    };
    if (preset.dataKey) indicator.dataKey = preset.dataKey;
    else indicator.formula = preset.formula;
    customIndicators.push(indicator);
    saveIndicators();
    renderIndicatorListItem(indicator);
    applyIndicatorToAllCharts(indicator);
    renderPresetGrid();
  }

  function renderPresetGrid() {
    var wrap = document.getElementById('ind-presets');
    var customForm = document.getElementById('ind-custom-form');
    var hint = document.getElementById('ind-formula-hint');
    if (!wrap || !customForm || !hint) return;
    if (activeCategory === 'custom') {
      wrap.hidden = true;
      customForm.hidden = false;
      hint.hidden = false;
      return;
    }
    wrap.hidden = false;
    customForm.hidden = true;
    hint.hidden = true;
    wrap.innerHTML = '';
    var addedPresetIds = customIndicators.map(function (i) { return i.presetId; }).filter(Boolean);
    INDICATOR_PRESETS.filter(function (p) { return p.category === activeCategory; }).forEach(function (preset) {
      var isAdded = addedPresetIds.indexOf(preset.id) !== -1;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ind-preset-btn' + (isAdded ? ' added' : '');
      btn.innerHTML = '<span class="ind-swatch" style="background:' + preset.color + '"></span>' + escapeHtml(preset.name) + (isAdded ? ' ✓' : '');
      if (isAdded) {
        btn.disabled = true;
      } else {
        btn.addEventListener('click', function () { addPresetIndicator(preset); });
      }
      wrap.appendChild(btn);
    });
  }

  var indTabs = document.querySelectorAll('.ind-tab');
  indTabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      activeCategory = tab.dataset.cat;
      indTabs.forEach(function (t) { t.classList.toggle('active', t === tab); });
      renderPresetGrid();
    });
  });

  customIndicators = loadSavedIndicators();
  // 兼容旧版本存的数据 (那时候还没有 scale 字段，默认当成跟价格同轴处理)
  customIndicators.forEach(function (ind) { if (!ind.scale) ind.scale = 'price'; });
  customIndicators.forEach(renderIndicatorListItem);
  renderPresetGrid();

  // ---------- K 线图渲染 ----------
  function renderChart(chartId) {
    var el = document.getElementById(chartId);
    if (!el || !window.LightweightCharts || el.dataset.rendered) return;
    el.dataset.rendered = '1';

    var chart = LightweightCharts.createChart(el, {
      width: el.clientWidth,
      height: 260,
      layout: { background: { color: 'transparent' }, textColor: colors.text },
      grid: {
        vertLines: { color: colors.grid },
        horzLines: { color: colors.grid }
      },
      rightPriceScale: { borderColor: colors.grid },
      timeScale: { borderColor: colors.grid },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal }
    });

    // 空心K线: 上涨只描边(空心)，下跌实心填满
    var candleSeries = chart.addCandlestickSeries({
      upColor: 'rgba(0, 0, 0, 0)',
      downColor: colors.down,
      borderUpColor: colors.up,
      borderDownColor: colors.down,
      wickUpColor: colors.up,
      wickDownColor: colors.down,
      borderVisible: true
    });
    candleSeries.setData(data[chartId].candles);

    var emaSeries = chart.addLineSeries({
      color: colors.ema,
      lineWidth: 2,
      priceLineVisible: false
    });
    emaSeries.setData(data[chartId].ema20);

    // 成交量柱状图，叠加在图表下方约 20% 的区域
    var volumeSeries = chart.addHistogramSeries({
      priceScaleId: '',
      priceFormat: { type: 'volume' }
    });
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    volumeSeries.setData(data[chartId].candles.map(function (c) {
      return { time: c.time, value: c.volume, color: c.close >= c.open ? colors.up : colors.down };
    }));

    chart.timeScale().fitContent();

    chartRegistry[chartId] = { chart: chart, candleSeries: candleSeries, emaSeries: emaSeries, volumeSeries: volumeSeries, customSeries: {} };
    customIndicators.forEach(function (ind) { addCustomIndicatorSeriesToChart(chartId, ind); });

    // 鼠标/触摸移到某根K线时，显示当天开高低收+成交量；没有悬停时默认显示最新一天
    var infoEl = document.getElementById(chartId + '-info');
    function showBar(bar, vol) {
      if (!infoEl || !bar) return;
      var volText = vol && typeof vol.value === 'number' ? vol.value.toLocaleString() : '-';
      infoEl.innerHTML = '开 <b>' + bar.open + '</b>　高 <b>' + bar.high + '</b>　低 <b>' + bar.low + '</b>　收 <b>' + bar.close + '</b>　量 <b>' + volText + '</b>';
    }
    var lastCandle = data[chartId].candles[data[chartId].candles.length - 1];
    showBar(lastCandle, { value: lastCandle ? lastCandle.volume : null });

    chart.subscribeCrosshairMove(function (param) {
      var bar = param.seriesData ? param.seriesData.get(candleSeries) : null;
      var vol = param.seriesData ? param.seriesData.get(volumeSeries) : null;
      showBar(bar || lastCandle, vol || { value: lastCandle ? lastCandle.volume : null });
    });

    new ResizeObserver(function (entries) {
      chart.applyOptions({ width: entries[0].contentRect.width });
    }).observe(el);
  }

  // 懒加载: 图表滚动到快进入可视范围才真正渲染，避免一次性创建几百个图表卡住页面
  var lazyObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        renderChart(entry.target.id);
        lazyObserver.unobserve(entry.target);
      }
    });
  }, { rootMargin: '200px 0px' });

  Object.keys(data).forEach(function (chartId) {
    var el = document.getElementById(chartId);
    if (el) lazyObserver.observe(el);
  });

  // ---------- 设置面板交互 ----------
  var toggleBtn = document.getElementById('settings-toggle');
  var panel = document.getElementById('settings-panel');
  if (toggleBtn && panel) {
    toggleBtn.addEventListener('click', function () {
      var willOpen = panel.hidden;
      panel.hidden = !willOpen;
      toggleBtn.setAttribute('aria-expanded', String(willOpen));
    });
  }

  COLOR_KEYS.forEach(function (key) {
    var input = document.getElementById('color-' + key);
    if (!input) return;
    input.value = colors[key];
    input.addEventListener('input', function () {
      document.documentElement.style.setProperty('--' + key, input.value);
      colors = computeColors();
      updateAllChartColors();
      saveColors();
    });
  });

  var resetBtn = document.getElementById('color-reset');
  if (resetBtn) {
    resetBtn.addEventListener('click', function () {
      COLOR_KEYS.forEach(function (k) { document.documentElement.style.removeProperty('--' + k); });
      try { localStorage.removeItem(COLOR_STORAGE_KEY); } catch (e) {}
      colors = computeColors();
      COLOR_KEYS.forEach(function (k) {
        var input = document.getElementById('color-' + k);
        if (input) input.value = colors[k];
      });
      updateAllChartColors();
    });
  }

  var addBtn = document.getElementById('ind-add');
  if (addBtn) {
    addBtn.addEventListener('click', function () {
      var nameEl = document.getElementById('ind-name');
      var formulaEl = document.getElementById('ind-formula');
      var colorEl = document.getElementById('ind-color');
      var errEl = document.getElementById('ind-error');
      errEl.hidden = true;

      var name = nameEl.value.trim();
      var formula = formulaEl.value.trim();
      var color = colorEl.value;

      if (!name || !formula) {
        errEl.textContent = '请填写名称和公式';
        errEl.hidden = false;
        return;
      }
      if (formula.length > 300) {
        errEl.textContent = '公式太长了';
        errEl.hidden = false;
        return;
      }
      var ownScaleEl = document.getElementById('ind-own-scale');
      var scale = ownScaleEl && ownScaleEl.checked ? 'own' : 'price';
      var indicator = { id: 'ind-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7), name: name, formula: formula, color: color, scale: scale };

      var firstChartId = Object.keys(data)[0];
      if (firstChartId) {
        try {
          computeIndicatorSeries(firstChartId, indicator);
        } catch (e) {
          errEl.textContent = '公式错误: ' + e.message;
          errEl.hidden = false;
          return;
        }
      }

      customIndicators.push(indicator);
      saveIndicators();
      renderIndicatorListItem(indicator);
      applyIndicatorToAllCharts(indicator);
      nameEl.value = '';
      formulaEl.value = '';
      if (ownScaleEl) ownScaleEl.checked = false;
    });
  }

  // 点表头排序 (带升/降序箭头)
  var table = document.getElementById('watchlist-table');
  if (table) {
    var tbody = table.querySelector('tbody');
    var ths = Array.from(table.querySelectorAll('th'));
    ths.forEach(function (th, idx) {
      if (th.dataset.type === 'none') return; // 走势图那一列不排序
      var asc = true;
      th.addEventListener('click', function () {
        var rows = Array.from(tbody.querySelectorAll('tr'));
        var type = th.dataset.type;
        rows.sort(function (a, b) {
          var ac = a.children[idx], bc = b.children[idx];
          var av = ac.dataset.value !== undefined ? ac.dataset.value : ac.textContent;
          var bv = bc.dataset.value !== undefined ? bc.dataset.value : bc.textContent;
          if (type === 'num') { av = parseFloat(av); bv = parseFloat(bv); }
          if (av < bv) return asc ? -1 : 1;
          if (av > bv) return asc ? 1 : -1;
          return 0;
        });
        // 用 DocumentFragment 一次性批量搬运，比逐行 appendChild 少触发几次重排
        var frag = document.createDocumentFragment();
        rows.forEach(function (r) { frag.appendChild(r); });
        tbody.appendChild(frag);
        ths.forEach(function (other) {
          var arrow = other.querySelector('.arrow');
          if (arrow) arrow.textContent = '';
        });
        var currentArrow = th.querySelector('.arrow');
        if (currentArrow) currentArrow.textContent = asc ? '▲' : '▼';
        asc = !asc;
      });
    });

    // 搜索框: 按代码/名称即时过滤表格
    var filterInput = document.getElementById('table-filter');
    var countEl = document.getElementById('table-count');
    var allRows = Array.from(tbody.querySelectorAll('tr'));
    function updateCount(shown) {
      if (countEl) countEl.textContent = shown === allRows.length ? allRows.length + ' 支' : shown + ' / ' + allRows.length + ' 支';
    }
    updateCount(allRows.length);
    if (filterInput) {
      filterInput.addEventListener('input', function () {
        var q = filterInput.value.trim().toLowerCase();
        var shown = 0;
        allRows.forEach(function (row) {
          var hit = !q || (row.dataset.search || '').indexOf(q) !== -1;
          row.hidden = !hit;
          if (hit) shown++;
        });
        updateCount(shown);
      });
    }
  }
})();
</script>
"""

DOWNLOADS_CSS = """
  /* ---- 📥 下载报告 (近 7 天 CSV / Excel / PDF) ---- */
  .downloads {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    margin-bottom: 1.5rem;
    max-width: 560px;
  }
  .downloads > summary {
    cursor: pointer;
    padding: 0.55rem 0.9rem;
    font-size: 0.9rem;
    font-weight: 600;
    list-style: none;
  }
  .downloads > summary::-webkit-details-marker { display: none; }
  .downloads > summary::after { content: " ▸"; color: var(--muted); }
  .downloads[open] > summary::after { content: " ▾"; }
  .downloads-body { padding: 0 0.9rem 0.8rem; }
  /* 日期选择条: 左旧右新，放不下时左右滑动 */
  .dl-days {
    display: flex;
    gap: 0.4rem;
    overflow-x: auto;
    scroll-snap-type: x proximity;
    padding: 0.1rem 0 0.5rem;
    scrollbar-width: thin;
  }
  .dl-day {
    flex: 0 0 auto;
    scroll-snap-align: end;
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 3.6rem;
    padding: 0.3rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--page);
    color: var(--text-secondary);
    font: inherit;
    cursor: pointer;
    line-height: 1.25;
  }
  .dl-day b { font-size: 0.85rem; color: var(--text-primary); }
  .dl-day small { font-size: 0.68rem; }
  .dl-day .dl-sig { color: var(--up); font-size: 0.68rem; font-weight: 600; }
  .dl-day[aria-checked="true"] { border-color: var(--text-primary); background: var(--surface); box-shadow: inset 0 0 0 1px var(--text-primary); }
  .dl-day:focus-visible { outline: 2px solid var(--ema); outline-offset: 1px; }
  .dl-picked { border-top: 1px solid var(--border); padding-top: 0.55rem; }
  .dl-meta { font-size: 0.82rem; color: var(--text-secondary); margin: 0 0 0.45rem; }
  .dl-meta b { color: var(--text-primary); }
  .dl-combined { font-size: 0.78rem; margin: 0.7rem 0 0; color: var(--muted); }
  .dl-link {
    display: inline-block;
    padding: 0.2rem 0.75rem;
    margin: 0 0.3rem 0.2rem 0;
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--text-primary);
    text-decoration: none;
    font-size: 0.8rem;
  }
  .dl-combined .dl-link { padding: 0.1rem 0.5rem; font-size: 0.75rem; }
  .dl-link:hover { background: var(--page); }
"""

WEEKDAYS_ZH = "一二三四五六日"
DOWNLOAD_FORMATS = (("csv", "CSV"), ("xlsx", "Excel"), ("pdf", "PDF"))


def build_downloads_html(downloads):
    """报告页面上的"📥 下载报告"区块：一条近 7 天的日期选择条，选中哪天就下载哪天的 CSV / Excel / PDF。
    没有导出成功 (downloads 为 None) 就不显示。默认选中最新一天，不开 JS 也能直接下载最新一天。"""
    if not downloads or not downloads.get("days"):
        return ""

    days = list(reversed(downloads["days"]))  # 选择条左旧右新，跟时间轴方向一致
    info = []
    for d in days:
        dt = datetime.strptime(d["date"], "%Y-%m-%d")
        signals = d.get("signals", [])
        sig_text = f"信号 {len(signals)} 支 ({'、'.join(signals)})" if signals else "无信号"
        info.append({
            "date": d["date"],
            "weekday": "周" + WEEKDAYS_ZH[dt.weekday()],
            "short": f"{dt.month}/{dt.day}",
            "time": d["generated_at"][-5:],
            "summary": f"{sig_text} · 共 {d.get('count', 0)} 支",
            "files": {k: f"downloads/{d['files'][k]}" for k, _ in DOWNLOAD_FORMATS},
        })

    # 放进 <script> 里，"</" 转义掉，免得名字里万一有 "</script>" 把脚本截断
    days_json = json.dumps(info, ensure_ascii=False).replace("</", "<\\/")
    latest = len(info) - 1
    chips = "".join(
        f'<button type="button" class="dl-day" role="radio" data-i="{i}" '
        f'aria-checked="{"true" if i == latest else "false"}" tabindex="{0 if i == latest else -1}" '
        f'aria-label="{x["date"]} {x["weekday"]}">'
        f'<b>{x["short"]}</b><small>{x["weekday"]}</small>'
        f'{"<span class=dl-sig>● 信号</span>" if days[i].get("signals") else "<small>" + x["time"] + "</small>"}'
        f'</button>'
        for i, x in enumerate(info)
    )
    cur = info[latest]
    buttons = "".join(f'<a class="dl-link" data-fmt="{k}" href="{cur["files"][k]}" download>{label}</a>'
                      for k, label in DOWNLOAD_FORMATS)
    combined = downloads.get("combined")
    combined_html = (
        f'<p class="dl-combined">近 {len(info)} 天合并：'
        f'<a class="dl-link" href="downloads/{combined["xlsx"]}" download>Excel (每天一个工作表)</a>'
        f'<a class="dl-link" href="downloads/{combined["csv"]}" download>CSV</a></p>'
        if combined else ""
    )
    return f"""<details class="downloads" id="downloads">
  <summary>📥 下载报告 (近 {downloads["keep_days"]} 个交易日)</summary>
  <div class="downloads-body">
    <div class="dl-days" role="radiogroup" aria-label="选择日期">{chips}</div>
    <div class="dl-picked">
      <p class="dl-meta" aria-live="polite"><b>{cur["date"]} {cur["weekday"]}</b> · <span>{cur["time"]} 更新 · {html.escape(cur["summary"])}</span></p>
      <div>{buttons}</div>
    </div>
    {combined_html}
  </div>
</details>
<script>
(function () {{
  var DAYS = {days_json};
  var box = document.getElementById("downloads");
  if (!box) return;
  var strip = box.querySelector(".dl-days");
  var chips = strip.querySelectorAll(".dl-day");
  var meta = box.querySelector(".dl-meta");
  function pick(i, focus) {{
    var d = DAYS[i];
    chips.forEach(function (c, j) {{
      c.setAttribute("aria-checked", j === i ? "true" : "false");
      c.tabIndex = j === i ? 0 : -1;
    }});
    meta.querySelector("b").textContent = d.date + " " + d.weekday;
    meta.querySelector("span").textContent = d.time + " 更新 · " + d.summary;
    box.querySelectorAll(".dl-link[data-fmt]").forEach(function (a) {{
      a.href = d.files[a.dataset.fmt];
    }});
    if (focus) chips[i].focus();
    chips[i].scrollIntoView({{block: "nearest", inline: "nearest"}});
  }}
  chips.forEach(function (c) {{
    c.addEventListener("click", function () {{ pick(+c.dataset.i); }});
  }});
  strip.addEventListener("keydown", function (e) {{
    var cur = +(strip.querySelector('[aria-checked="true"]') || chips[0]).dataset.i;
    var next = {{ArrowLeft: cur - 1, ArrowRight: cur + 1, Home: 0, End: DAYS.length - 1}}[e.key];
    if (next === undefined) return;
    e.preventDefault();
    pick(Math.max(0, Math.min(DAYS.length - 1, next)), true);
  }});
  // 展开时把选择条滚到最右 (最新一天)
  box.addEventListener("toggle", function () {{
    if (box.open) strip.scrollLeft = strip.scrollWidth;
  }});
}})();
</script>"""


# === 7. 生成 HTML 报告 (只有命中信号的股票画 K 线图，其余用表格) ===
def build_html_report(stocks, downloads=None):
    now = datetime.now(MYT).strftime("%Y-%m-%d %H:%M")

    cards = []
    chart_payload = {}
    table_rows = []
    no_data_count = 0

    for s in stocks:
        code = s["symbol"].split(".")[0]
        data = s["data"]

        if data is None:
            no_data_count += 1
            continue

        if not s["matched"]:
            # 昨收也四舍五入到 3 位再比 (现价已经是 3 位)：不然价格没变的股票会因为浮点尾数算出 -0.00% 并显示成红色
            prev_close = round(data["prev_close"], 3) if data["prev_close"] else None
            change_pct = (data["close"] - prev_close) / prev_close * 100 if prev_close else 0
            if change_pct > 0:
                change_class, change_sign = "change-up", "+"
            elif change_pct < 0:
                change_class, change_sign = "change-down", ""
            else:
                change_class, change_sign = "change-neutral", ""

            # 迷你走势图: 优先用日内 5 分钟数据 (基准线=昨收)，拿不到就退回近 30 日收盘价
            intraday = s.get("intraday")
            if intraday:
                # Yahoo 的 5 分钟线会比最新成交价慢一点 (run #209 里 HEGROUP 当天 +0.94%，但最后一根 5 分钟线
                # 还在昨收下面，走势图被画成红色)。把最新价补在最后，线的终点=现价，颜色就跟"涨跌%"一致
                if intraday[-1] != data["close"]:
                    intraday = intraday + [data["close"]]
                spark = build_sparkline(intraday, baseline=prev_close)
                spark_title = "今日走势 (虚线=昨收)"
            else:
                spark = build_sparkline([c["close"] for c in data["candles"][-30:]])
                spark_title = "近 30 日走势"

            name = html.escape(s["name"])
            rel_vol = data.get("rel_volume")
            rel_vol_cell = (
                f'<td class="num{" relvol-high" if rel_vol >= 2 else ""}" data-value="{rel_vol}">{rel_vol:.2f}</td>'
                if rel_vol is not None else '<td class="num" data-value="-1">—</td>'
            )
            sar_pill = '<span class="pill pill-up">多头</span>' if data["sar_bullish_now"] else '<span class="pill pill-down">空头</span>'
            ema_class = "change-up" if data["close"] > data["ema20_latest"] else "change-down"

            table_rows.append((data["volume"], f"""<tr data-search="{code} {name.lower()}">
                <td class="idx-cell"></td>
                <td class="stock-cell" data-value="{name}"><span class="ticker">{name}</span><span class="stock-code">{code}</span></td>
                <td class="spark-cell" title="{spark_title}">{spark}</td>
                <td class="num" data-value="{data['close']}">{data['close']:.3f}<span class="unit">MYR</span></td>
                <td class="num {change_class}" data-value="{change_pct}">{change_sign}{change_pct:.2f}%</td>
                <td class="num" data-value="{data['volume']}">{fmt_volume(data['volume'])}</td>
                {rel_vol_cell}
                <td class="num" data-value="{fmt_num(data['rsi'], '{}', '-1')}">{fmt_num(data['rsi'], '{:.1f}')}</td>
                <td data-value="{1 if data['sar_bullish_now'] else 0}">{sar_pill}</td>
                <td class="num {ema_class}" data-value="{data['ema20_latest']}">{data['ema20_latest']:.3f}</td>
            </tr>"""))
            continue

        chart_id = f"chart-{code}"
        ai_html = f"<p>{s['ai_comment']}</p>" if s["ai_comment"] else ""  # 点评被过滤光了就整段不显示
        chart_payload[chart_id] = {"candles": data["candles"], "ema20": data["ema20"], "psar": data["psar"]}

        cards.append(f"""<section class="card">
            <div class="card-head">
                <h2>{s['name']} <span class="code">{code}</span></h2>
                <div class="stats">
                    <span>现价 <b>{data['close']}</b></span>
                    <span>RSI(14) <b>{fmt_num(data['rsi'], '{}')}</b></span>
                    <span>50日均线 <b>{data['sma50']}</b></span>
                </div>
            </div>
            <div id="{chart_id}-info" class="ohlc-info"></div>
            <div id="{chart_id}" class="chart"></div>
            <div class="legend">
                <span class="dot up"></span>上涨
                <span class="dot down"></span>下跌
                <span class="dot ema"></span>EMA20
                <span class="dot vol"></span>成交量
            </div>
            <div class="signal">
                <strong>🚨 {s['reason']}</strong>
                {ai_html}
            </div>
        </section>""")

    # 默认按成交量从高到低排 (跟 TradingView 选股器一样)，点表头仍然可以改排序
    table_rows = [row for _, row in sorted(table_rows, key=lambda r: r[0], reverse=True)]

    no_data_note = f"<p class='no-data'>另有 {no_data_count} 支股票数据不足，未列入。</p>" if no_data_count else ""

    return f"""<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>马股自动分析报告</title>
<script src="vendor/lightweight-charts.js"></script>
<style>
  /* 🎨 图表配色：想换颜色直接改这里的 hex 值即可 (--up / --down / --ema) */
  :root {{
    color-scheme: light;
    --page: #f9f9f7;
    --surface: #fcfcfb;
    --text-primary: #0b0b0b;
    --text-secondary: #52514e;
    --muted: #898781;
    --gridline: #e1e0d9;
    --border: rgba(11,11,11,0.10);
    --up: #0ca30c;      /* 阳线(上涨) 边框+影线颜色，空心 */
    --down: #d03b3b;    /* 阴线(下跌) 实心颜色 */
    --ema: #4a3aa7;     /* EMA20 均线颜色 */
  }}
  @media (prefers-color-scheme: dark) {{
    :root {{
      color-scheme: dark;
      --page: #0d0d0d;
      --surface: #1a1a19;
      --text-primary: #ffffff;
      --text-secondary: #c3c2b7;
      --muted: #898781;
      --gridline: #2c2c2a;
      --border: rgba(255,255,255,0.10);
      --up: #0ca30c;
      --down: #e66767;
      --ema: #9085e9;
    }}
  }}
  * {{ box-sizing: border-box; }}
  body {{
    margin: 0;
    padding: 1.5rem;
    background: var(--page);
    color: var(--text-primary);
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  }}
  h1 {{ margin: 0 0 0.25rem; font-size: 1.5rem; }}
  .updated {{ color: var(--text-secondary); margin: 0 0 1.5rem; }}
  .site-footer {{
    margin-top: 3rem;
    padding-top: 1.5rem;
    border-top: 1px solid var(--border);
    color: var(--muted);
    font-size: 0.8rem;
    line-height: 1.6;
  }}
  .grid {{
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
    gap: 1rem;
  }}
  .card {{
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1rem;
  }}
  .card-head {{
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }}
  h2 {{ margin: 0; font-size: 1.05rem; }}
  .code {{ color: var(--muted); font-weight: normal; font-size: 0.9rem; }}
  .stats {{ display: flex; gap: 0.75rem; color: var(--text-secondary); font-size: 0.85rem; flex-wrap: wrap; }}
  .stats b {{ color: var(--text-primary); }}
  .chart {{ width: 100%; height: 260px; }}  /* 要跟 JS 里 createChart 的 height 一致，否则图会溢出盖住下面的图例 */
  .legend {{ display: flex; gap: 1rem; align-items: center; color: var(--text-secondary); font-size: 0.8rem; margin-top: 0.5rem; }}
  .dot {{ display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 0.25rem; vertical-align: middle; }}
  .dot.up {{ background: transparent; border: 2px solid var(--up); }}
  .dot.down {{ background: var(--down); }}
  .dot.ema {{ background: var(--ema); }}
  .dot.vol {{ background: var(--muted); }}
  .signal {{
    margin-top: 0.75rem;
    padding: 0.6rem 0.75rem;
    border-left: 3px solid var(--ema);
    background: color-mix(in srgb, var(--ema) 10%, transparent);
    border-radius: 4px;
    font-size: 0.9rem;
  }}
  .signal p {{ margin: 0.35rem 0 0; color: var(--text-secondary); }}
  .no-data {{ color: var(--muted); }}
  .change-up {{ color: var(--up); font-weight: 600; }}
  .change-down {{ color: var(--down); font-weight: 600; }}
  .change-neutral {{ color: var(--muted); }}
  .ohlc-info {{
    font-size: 0.8rem;
    color: var(--text-secondary);
    margin-bottom: 0.25rem;
    min-height: 1.1em;
    white-space: nowrap;
    overflow-x: auto;
  }}
  .ohlc-info b {{ color: var(--text-primary); }}
  h2.section {{ font-size: 1.1rem; margin: 2rem 0 1rem; }}
  .table-wrap {{ overflow-x: auto; }}
  table.data-table {{
    width: 100%;
    border-collapse: collapse;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    font-size: 0.85rem;
  }}
  table.data-table th, table.data-table td {{
    padding: 0.5rem 0.75rem;
    text-align: left;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }}
  table.data-table th {{
    cursor: pointer;
    color: var(--text-secondary);
    user-select: none;
  }}
  table.data-table th:hover {{ color: var(--text-primary); }}
  table.data-table .arrow {{ display: inline-block; width: 0.9em; color: var(--text-primary); }}
  table.data-table tbody tr:hover {{ background: var(--page); }}
{SETTINGS_CSS}
{TABLE_CSS}
{DOWNLOADS_CSS}
</style>
</head>
<body>
<h1>📢 马股自动分析报告</h1>
<p class="updated">更新时间: {now} (MYT)</p>
{SETTINGS_PANEL_HTML}
{build_downloads_html(downloads)}

<h2 class="section">🚨 信号 ({len(cards)})</h2>
<div class="grid">
{''.join(cards) if cards else "<p class='no-data'>今日无符合条件的股票。</p>"}
</div>

<h2 class="section">📋 其余股票 ({len(table_rows)})</h2>
<div class="table-toolbar">
  <input type="search" id="table-filter" placeholder="🔍 搜索代码或名称" autocomplete="off">
  <span id="table-count" class="table-count"></span>
</div>
<div class="table-wrap">
<table class="data-table" id="watchlist-table">
  <thead>
    <tr>
      <th data-type="none" class="idx-cell">#</th>
      <th data-type="text" class="stock-cell">股票 <span class="arrow"></span></th>
      <th data-type="none">走势</th>
      <th data-type="num" class="num">价格 <span class="arrow"></span></th>
      <th data-type="num" class="num">涨跌% <span class="arrow"></span></th>
      <th data-type="num" class="num" data-default-sort="desc">成交量 <span class="arrow">▼</span></th>
      <th data-type="num" class="num">相对量 <span class="arrow"></span></th>
      <th data-type="num" class="num">RSI <span class="arrow"></span></th>
      <th data-type="num">SAR <span class="arrow"></span></th>
      <th data-type="num" class="num">EMA20 <span class="arrow"></span></th>
    </tr>
  </thead>
  <tbody>
{''.join(table_rows)}
  </tbody>
</table>
</div>
{no_data_note}

<footer class="site-footer">
  <p>本报告及其筛选策略、代码与分析方法版权所有 © {datetime.now(MYT).year} CJA231，保留一切权利。未经书面授权，禁止复制、转载、二次分发或用于商业用途。</p>
  <p>© {datetime.now(MYT).year} CJA231. All rights reserved. This report and the underlying strategy/code are proprietary; unauthorized reproduction or redistribution is prohibited.</p>
</footer>

<script id="chart-data" type="application/json">{json.dumps(chart_payload)}</script>
{CHART_SCRIPT}
</body>
</html>"""

# === 8. 手机推送通知 (ntfy.sh) ===
def send_notification(hits):
    if not NTFY_TOPIC:
        print("未设置 NTFY_TOPIC，跳过手机推送通知。")
        return

    message = f"发现 {hits} 个信号，点击查看完整报告" if hits else "今日扫描完成，暂无符合条件的股票"
    try:
        requests.post(
            "https://ntfy.sh/",
            json={
                "topic": NTFY_TOPIC,
                "title": "📢 马股报告已更新",
                "message": message,
                "click": REPORT_URL,
                "tags": ["chart_with_upwards_trend"],
            },
            timeout=10,
        )
    except Exception as e:
        print(f"推送通知失败: {e}")

# 判断今天是否为交易日的参考股：固定用流动性极佳的蓝筹股，跟 WATCHLIST 具体内容无关
# (非交易日/公共假期时 yfinance 不会有当天的数据)
TRADING_DAY_REFERENCE = "1155.KL"


SCREENER_PAGE_SIZE = 250  # Yahoo screener 单次请求上限


def prefetch_quotes():
    """
    用 Yahoo screener 几个请求 (每页 250 支) 拿到全马股票的现价 + 当日成交量，
    成交量不够门槛的股票就不用再去下载 6 个月历史了 (实测约 70% 的股票会被门槛挡掉)。
    返回 {symbol: (price, volume)}；screener 出错就返回空 dict，调用方会退回"逐支下载历史再判断"。
    """
    try:
        from yfinance import EquityQuery
        query = EquityQuery("eq", ["region", "my"])
        quotes, offset = {}, 0
        for _ in range(20):  # 安全上限
            result = yf.screen(query, offset=offset, size=SCREENER_PAGE_SIZE, sortField="ticker", sortAsc=True)
            page = result.get("quotes", [])
            for q in page:
                symbol, price, volume = q.get("symbol"), q.get("regularMarketPrice"), q.get("regularMarketVolume")
                if symbol and price is not None and volume is not None:
                    quotes[symbol] = (round(float(price), 3), int(volume))
            offset += SCREENER_PAGE_SIZE
            if not page or offset >= result.get("total", 0):
                break
        return quotes
    except Exception as e:
        print(f"⚠️ screener 预筛选失败 ({e})，改为逐支下载历史数据再判断成交量")
        return {}


def fetch_stock(symbol):
    """线程池里跑的单支股票任务：日线 + 指标；会进表格的股票顺便抓日内走势 (塞在 data["intraday"])。"""
    data = get_stock_data(symbol)
    if data and not data.get("low_volume") and not check_strategy(data)[0]:
        data["intraday"] = get_intraday_closes(symbol)
    return data


def is_trading_day(today_myt):
    # 只需要知道最新一根日线是不是今天，抓 5 天就够了，不用拉 6 个月再算一遍全部指标
    try:
        df = yf.Ticker(TRADING_DAY_REFERENCE).history(period="5d")
        return len(df) > 0 and df.index[-1].strftime("%Y-%m-%d") == today_myt
    except Exception as e:
        print(f"交易日判断失败 ({e})，按非交易日处理")
        return False

# === 主程序 ===
def main():
    today_myt = datetime.now(MYT).strftime("%Y-%m-%d")
    print(f"开始扫描 ({today_myt})...")

    if FORCE_RUN:
        print("⚠️ FORCE_RUN 模式：跳过交易日检查，直接用最新可用数据扫描 (用于测试)。")
    elif not is_trading_day(today_myt):
        print(f"今天 ({today_myt}) 非交易日或数据尚未更新，跳过本次扫描。")
        return

    # 第 1 步: screener 几个请求拿全市场现价+成交量，成交量不够的直接判定忽略，不用下载历史
    t_pre = time.perf_counter()
    quotes = prefetch_quotes()
    prefiltered = {}
    for item in WATCHLIST:
        q = quotes.get(item["symbol"])
        if q and q[1] < min_volume_for(q[0]):
            prefiltered[item["symbol"]] = {"symbol": item["symbol"], "low_volume": True, "close": q[0],
                                           "volume": q[1], "threshold": min_volume_for(q[0])}
    pre_secs = time.perf_counter() - t_pre
    print(f"screener 预筛选: 拿到 {len(quotes)} 支报价，其中 {len(prefiltered)} 支成交量不够、不用下载历史")

    # 第 2 步: 剩下的才并发下载 6 个月历史 + 算指标。screener 里没有的股票也走这一步 (在这里再判断成交量)。
    # 日线和日内走势放在同一个线程里抓：一支股票过了成交量门槛、又没命中信号 (会进表格)，就接着抓日内数据。
    t_fetch = time.perf_counter()
    symbols = [item["symbol"] for item in WATCHLIST if item["symbol"] not in prefiltered]
    print(f"并发抓取 {len(symbols)} 支股票的历史数据 (并发数: {FETCH_WORKERS}) ...")
    with ThreadPoolExecutor(max_workers=FETCH_WORKERS) as executor:
        fetched_map = dict(zip(symbols, executor.map(fetch_stock, symbols)))
    fetched = [prefiltered.get(item["symbol"]) or fetched_map.get(item["symbol"]) for item in WATCHLIST]
    fetch_secs = time.perf_counter() - t_fetch

    t_filter = time.perf_counter()
    stocks = []
    low_volume_by_tier = {}
    no_data = 0
    deepseek_calls = 0
    for item, data in zip(WATCHLIST, fetched):
        symbol = item["symbol"]

        # 流动性门槛 (按价格分级，见 VOLUME_TIERS): 成交量不够的直接忽略，不放进报告
        if data and data.get("low_volume"):
            low_volume_by_tier[data["threshold"]] = low_volume_by_tier.get(data["threshold"], 0) + 1
            continue
        if data is None:
            no_data += 1

        intraday = data.pop("intraday", None) if data else None
        matched, reason, ai_comment = False, None, None
        if data:
            matched, reason = check_strategy(data)
            if matched:
                # 防止 DeepSeek 限频：只在两次调用之间停 1 秒，最后一次调用之后不用等
                if deepseek_calls:
                    time.sleep(1)
                ai_comment = strip_trade_advice(ask_deepseek(data, reason))
                deepseek_calls += 1
                print(f"✅ 找到机会: {symbol}")

        stocks.append({
            "symbol": symbol,
            "name": item["name"],
            "data": data,
            "matched": matched,
            "reason": reason,
            "ai_comment": ai_comment,
            "intraday": intraday,
        })
    filter_secs = time.perf_counter() - t_filter

    for threshold in sorted(low_volume_by_tier):
        print(f"⏭️ 成交量低于 {threshold:,} 被忽略: {low_volume_by_tier[threshold]} 支")
    table_stocks = [s for s in stocks if s["data"] and not s["matched"]]
    got_intraday = sum(1 for s in table_stocks if s["intraday"])
    print(f"进入报告: {len(stocks) - no_data} 支 (信号 {deepseek_calls} 支, 表格 {len(table_stocks)} 支)；"
          f"数据不足/抓取失败 {no_data} 支")
    print(f"日内走势: {got_intraday}/{len(table_stocks)} 支拿到数据，其余用近 30 日走势代替")

    # 导出 CSV / Excel / PDF 下载文件 (要在生成网页之前，网页上的下载区块才能列出最新的文件)。
    # 导出出错不能拖垮主流程：报告照样生成和发布，只是这次没有下载区块。
    t_export = time.perf_counter()
    downloads = None
    try:
        downloads = export_downloads(stocks, today_myt, datetime.now(MYT).strftime("%Y-%m-%d %H:%M"))
        print(f"📥 下载文件已导出: 保留 {len(downloads['days'])} 天 ({downloads['days'][0]['date']} 起)")
    except Exception as e:
        print(f"⚠️ 导出下载文件失败 ({type(e).__name__}: {e})，报告照常生成，只是这次没有下载区块")
    export_secs = time.perf_counter() - t_export

    t_report = time.perf_counter()
    os.makedirs(os.path.dirname(REPORT_PATH), exist_ok=True)
    with open(REPORT_PATH, "w", encoding="utf-8") as f:
        f.write(build_html_report(stocks, downloads))
    report_secs = time.perf_counter() - t_report

    hits = sum(1 for s in stocks if s["matched"])
    if hits:
        print(f"报告已生成，共 {hits} 个信号")
    else:
        print("今日无符合条件的股票，报告已更新")

    t_notify = time.perf_counter()
    send_notification(hits)
    notify_secs = time.perf_counter() - t_notify

    # 耗时分解：Action 跑超过 1 分钟时，直接看这一行就知道慢在哪
    print(f"⏱️ 耗时: 导入库 {IMPORT_SECS:.1f}s | screener 预筛选 {pre_secs:.1f}s | 抓取+指标+日内 {fetch_secs:.1f}s | "
          f"筛选+DeepSeek {filter_secs:.1f}s | 导出下载 {export_secs:.1f}s | 生成报告 {report_secs:.1f}s | 推送 {notify_secs:.1f}s | "
          f"总计 {time.perf_counter() - PROCESS_START:.1f}s")

if __name__ == "__main__":
    main()
