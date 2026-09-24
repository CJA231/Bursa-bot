import time
PROCESS_START = time.perf_counter()  # 用来算"导入库"花了多久 (pandas_ta 会带进 numba，导入本身就要几秒)

import os
import re
import json
import html
import calendar
import hashlib
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

            if df is None or df.empty:
                print(f"没有数据: {symbol}")
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

            # 新上市的股票历史很短也照样处理 (9/24 用户要求：不足 90 天一样按成交量门槛筛选，以前 < 50 天直接丢掉)。
            # 天数不够算的指标留空 (None)：RSI 要 15 天、EMA20 要 20 天、50日均线要 50 天、SAR 要 2 天。
            # 这种股票照样进"其余股票"表格；信号要 EMA20 + T3 形态，至少 26 天左右才可能命中。
            history_days = len(df)
            for name, kwargs in (("rsi", {"length": 14}), ("sma", {"length": 50}), ("ema", {"length": 20}), ("psar", {})):
                try:
                    getattr(df.ta, name)(append=True, **kwargs)
                except Exception:
                    pass  # 天数太少 pandas_ta 可能直接报错，当作算不出来

            # PSAR 在多头/空头趋势下分别写入不同的列，合并成单一数值方便比较
            psar_long_col = next((c for c in df.columns if c.startswith("PSARl")), None)
            psar_short_col = next((c for c in df.columns if c.startswith("PSARs")), None)
            if psar_long_col and psar_short_col:
                df["PSAR"] = df[psar_long_col].combine_first(df[psar_short_col])

            def value(col, i=-1, ndigits=3):
                """某一列第 i 行的值；列不存在、天数不够或 NaN 都返回 None"""
                if col not in df.columns or len(df) < -i:
                    return None
                v = df[col].iloc[i]
                return None if pd.isna(v) else round(float(v), ndigits)

            close = value("Close")
            prev_close = value("Close", -2, 6)
            psar_now, psar_prev = value("PSAR"), value("PSAR", -2)

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
                if "EMA_20" in chart_df.columns and pd.notna(row["EMA_20"])
            ]
            # SAR 整条序列也传给前端 (策略判断只用得上最新一天的 sar_bullish_now，但画图需要整条历史)
            psar_series = [
                {"time": idx.strftime("%Y-%m-%d"), "value": round(row["PSAR"], 3)}
                for idx, row in chart_df.iterrows()
                if "PSAR" in chart_df.columns and pd.notna(row["PSAR"])
            ]

            # 相对成交量 = 今天成交量 / 前 20 个交易日平均成交量 (不含今天)，跟 TradingView 的 "相对成交量" 同一个意思
            # (新股不足 20 天就用现有的那几天平均；上市第一天没有前一天，就没有相对量)
            vol_avg20 = df["Volume"].iloc[-21:-1].mean()
            last_volume = int(df["Volume"].iloc[-1])
            rel_volume = round(last_volume / vol_avg20, 2) if vol_avg20 and pd.notna(vol_avg20) else None

            return {
                "symbol": symbol,
                "close": close,
                "rsi": value("RSI_14", ndigits=2),
                "sma50": value("SMA_50"),
                "prev_close": prev_close,
                "prev_sma50": value("SMA_50", -2),
                "ema20_latest": value("EMA_20"),
                # None = 天数不够算 SAR
                "sar_bullish_now": close > psar_now if psar_now is not None else None,
                "sar_bullish_prev": prev_close > psar_prev if psar_prev is not None and prev_close is not None else None,
                "t3_pattern": detect_t3_pattern(df),
                "volume": last_volume,
                "rel_volume": rel_volume,
                "history_days": history_days,
                "daily_bars": compact_bars(df, intraday=False),  # 双击看完整图表用 (只有表格股票会写进 table.json)
                "candles": candles,
                "ema20": ema20,
                "psar": psar_series,
            }
        except Exception as e:
            if attempt < retries:
                continue
            print(f"获取失败 {symbol}: {e}")
            return None

# 信号股K线图的多周期数据: (键, yfinance interval, period, 只保留最近几个交易日)
# 网页上的 1分~月 这些周期都从这几份数据合成 (例如 10 分 = 两根 5 分，2 小时 = 两根 1 小时，周 = 日线按周合并)。
# Yahoo 没有秒级数据，所以没有 30 秒；各周期的历史长度受 Yahoo 限制 (1 分钟线最多 7 天、分钟线最多 60 天)。
CHART_SOURCES = [
    ("1m", "1m", "5d", 2),       # 1 分: 只留最近 2 个交易日，不然网页太大
    ("5m", "5m", "5d", None),    # 5 分、10 分
    ("15m", "15m", "1mo", None),  # 15 分、30 分、45 分
    ("60m", "60m", "3mo", None),  # 1 小时、2 小时、4 小时
    ("1d", "1d", "2y", None),     # 天、周 (2 年够一目均衡表的先行带 B 画满整张图)
    ("1mo", "1mo", "10y", None),  # 月
]
MYT_OFFSET_SECS = 8 * 3600


def bars_payload(df, intraday):
    """DataFrame → 网页用的列式数组 {t,o,h,l,c,v} (比一根K线一个对象省一半以上体积)。
    时间用秒级时间戳：日内K线加上 +8 小时，让图表按 UTC 显示时刚好就是马来西亚时间；日线以上用当天 00:00 UTC。"""
    df = df.dropna(subset=["Open", "High", "Low", "Close"])
    if intraday:
        t = [int(ts.timestamp()) + MYT_OFFSET_SECS for ts in df.index]
    else:
        t = [calendar.timegm(ts.date().timetuple()) for ts in df.index]
    return {
        "t": t,
        "o": [round(float(x), 4) for x in df["Open"]],
        "h": [round(float(x), 4) for x in df["High"]],
        "l": [round(float(x), 4) for x in df["Low"]],
        "c": [round(float(x), 4) for x in df["Close"]],
        "v": [int(x) if pd.notna(x) else 0 for x in df["Volume"]],
    }


def get_chart_history(symbol):
    """只给命中信号的股票 (有K线图的，平常 0–3 支) 用：并发抓 6 种周期的K线，任何一种抓失败就跳过那一种
    (网页上对应的周期按钮会变灰)，不影响其他东西。"""
    def fetch(source):
        key, interval, period, keep_days = source
        try:
            df = yf.Ticker(symbol).history(period=period, interval=interval)
            if df is None or df.empty:
                return key, None
            if keep_days:
                days = sorted(set(df.index.date))[-keep_days:]
                df = df[[d in days for d in df.index.date]]
            return key, bars_payload(df, intraday=interval.endswith("m"))
        except Exception as e:
            print(f"⚠️ {symbol} {interval} K线获取失败 ({type(e).__name__}: {e})")
            return key, None

    with ThreadPoolExecutor(max_workers=len(CHART_SOURCES)) as pool:
        return {key: bars for key, bars in pool.map(fetch, CHART_SOURCES) if bars}


def get_intraday(symbol):
    """当天 (或最近一个交易日) 的 5 分钟K线。返回 (收盘价序列, 精简K线)：
    收盘价给表格的迷你走势图，精简K线给"双击看完整图表"的日内周期用。拿不到就返回 (None, None)。"""
    try:
        df = yf.Ticker(symbol).history(period="1d", interval="5m")
        df = df.dropna(subset=["Open", "High", "Low", "Close"])
        closes = [round(float(c), 4) for c in df["Close"]]
        if len(closes) < 2:
            return None, None
        return closes, compact_bars(df, intraday=True)
    except Exception:
        return None, None


def compact_bars(df, intraday):
    """
    "其余股票"双击看完整图表用的精简K线 (全部表格股票放在同一个 docs/charts/table.json，打开时才下载)：
    价格 ×1000 存成整数 (Bursa 最小跳动 0.005，3 位小数足够)；时间只存第一根 + 每根的间隔
    (日线以天、日内以分钟为单位)。比 bars_payload 那种完整时间戳 + 小数小一半以上。
    """
    df = df.dropna(subset=["Open", "High", "Low", "Close"])
    if df.empty:
        return None
    if intraday:
        ts, unit = [int(x.timestamp()) + MYT_OFFSET_SECS for x in df.index], 60
    else:
        ts, unit = [calendar.timegm(x.date().timetuple()) for x in df.index], 86400
    return {
        "t0": ts[0], "u": unit, "dt": [(b - a) // unit for a, b in zip(ts, ts[1:])],
        "o": [round(float(x) * 1000) for x in df["Open"]],
        "h": [round(float(x) * 1000) for x in df["High"]],
        "l": [round(float(x) * 1000) for x in df["Low"]],
        "c": [round(float(x) * 1000) for x in df["Close"]],
        "v": [int(x) if pd.notna(x) else 0 for x in df["Volume"]],
    }


CHARTS_DIR = os.path.join("docs", "charts")
TABLE_CHARTS_FILE = os.path.join(CHARTS_DIR, "table.json")


def write_table_charts(stocks):
    """把"其余股票"每一支的 6 个月日线 + 当天 5 分钟线写进 docs/charts/table.json。
    网页里双击某一行才下载这个文件 (整页不会因此变大)；返回文件内容的短哈希，放在网址后面防止浏览器用旧缓存。"""
    table = {}
    for s in stocks:
        d = s["data"]
        if not d or s["matched"] or not d.get("daily_bars"):
            continue
        table[s["symbol"].split(".")[0]] = {"d": d["daily_bars"], "i": s.get("intraday_bars")}
    os.makedirs(CHARTS_DIR, exist_ok=True)
    body = json.dumps({"v": 1, "stocks": table}, separators=(",", ":"))
    with open(TABLE_CHARTS_FILE, "w", encoding="utf-8") as f:
        f.write(body)
    return hashlib.sha1(body.encode()).hexdigest()[:10]


# ---- 每支股票的详细资料: 近 4 季 + 近 2 年财报、2 年日线 + 10 年月线，存在 docs/stock/<代码>.json ----
# 双击"其余股票"的一行 (或点卡片上的"完整图表 · 财报") 时才下载。财报一季才变一次，长期K线里
# 最近 6 个月以外的部分也不会再变 (最近 6 个月每次运行都写在 table.json 里，网页打开时拼在一起)，
# 所以每支一周抓一次就够。每次运行只补一小批 (DETAIL_PER_RUN 支)，不会拖慢运行：
# 第一天跑几次就补齐全部表格股票，之后每周轮着刷新。
DETAIL_DIR = os.path.join("docs", "stock")
DETAIL_MAX_AGE_DAYS = 7    # 有财报的: 一周刷新一次
DETAIL_RETRY_DAYS = 2      # Yahoo 没给财报的: 两天后再试 (可能只是那次请求被限流，不想一错就等一周)
DETAIL_PRUNE_DAYS = 30     # 超过 30 天没更新、这次也不在报告里的 (早就跌出成交量门槛了) 删掉
DETAIL_PER_RUN = 30
DETAIL_WORKERS = 8
DETAIL_HISTORY = (("d", "2y", "1d"), ("m", "10y", "1mo"))  # 跟筛选器卡片一样长
FIN_QUARTERS = 4
FIN_YEARS = 2
# (输出键, 可能的科目名称) —— Yahoo 不同公司用的科目名称略有不同，按顺序找第一个有的
FIN_ROWS = {
    "income": [("revenue", ["Total Revenue", "Operating Revenue"]), ("gross_profit", ["Gross Profit"]),
               ("operating_income", ["Operating Income", "EBIT"]),
               ("net_income", ["Net Income", "Net Income Common Stockholders", "Net Income Continuous Operations"]),
               ("eps", ["Diluted EPS", "Basic EPS"])],
    "balance": [("total_assets", ["Total Assets"]), ("total_liabilities", ["Total Liabilities Net Minority Interest", "Total Liabilities"]),
                ("equity", ["Stockholders Equity", "Common Stock Equity", "Total Equity Gross Minority Interest"]),
                ("cash", ["Cash And Cash Equivalents", "Cash Cash Equivalents And Short Term Investments"]),
                ("total_debt", ["Total Debt"])],
    "cashflow": [("operating_cf", ["Operating Cash Flow", "Cash Flow From Continuing Operating Activities"]),
                 ("free_cf", ["Free Cash Flow"]), ("capex", ["Capital Expenditure"])],
}


def statement_values(df, rows):
    """yfinance 财报 DataFrame (行 = 科目，列 = 报告期) → {报告期日期: {键: 数值}}"""
    out = {}
    if df is None or getattr(df, "empty", True):
        return out
    for col in df.columns:
        period = pd.Timestamp(col).strftime("%Y-%m-%d")
        values = {}
        for key, names in rows:
            for name in names:
                if name in df.index:
                    v = df.at[name, col]
                    if pd.notna(v):
                        values[key] = float(v)
                    break
        if values:
            out[period] = values
    return out


def financial_section(income, balance, cashflow, n):
    """以利润表的报告期为准，取最近 n 期 (旧 → 新)；资产负债表 / 现金流量表同一天的数字对上去，没有就留空"""
    periods = sorted(p for p, v in income.items() if "revenue" in v or "net_income" in v)[-n:]
    keys = [k for group in FIN_ROWS.values() for k, _ in group]
    merged = {p: {**income.get(p, {}), **balance.get(p, {}), **cashflow.get(p, {})} for p in periods}
    return {"periods": periods, **{k: [merged[p].get(k) for p in periods] for k in keys}}


def fetch_detail(symbol, today):
    """
    一支股票的财报 + 长期K线。上市公司一定有K线，日线都拿不到 = 这次请求失败，返回 None
    (不写文件，下次运行再试；不然会写一个空文件然后一周都不再抓)。
    财报拿不到就是 fin = None (很多小公司 Yahoo 本来就没有)。
    """
    t = yf.Ticker(symbol)
    bars = {}
    for key, period, interval in DETAIL_HISTORY:
        try:
            bars[key] = compact_bars(t.history(period=period, interval=interval), intraday=False)
        except Exception as e:
            print(f"⚠️ {symbol} {interval}×{period} K线获取失败 ({type(e).__name__}: {e})")
            bars[key] = None
    if not bars["d"]:
        return None

    def get(attr):
        try:
            return getattr(t, attr)
        except Exception:
            return None
    q = financial_section(statement_values(get("quarterly_income_stmt"), FIN_ROWS["income"]),
                          statement_values(get("quarterly_balance_sheet"), FIN_ROWS["balance"]),
                          statement_values(get("quarterly_cashflow"), FIN_ROWS["cashflow"]), FIN_QUARTERS)
    a = financial_section(statement_values(get("income_stmt"), FIN_ROWS["income"]),
                          statement_values(get("balance_sheet"), FIN_ROWS["balance"]),
                          statement_values(get("cashflow"), FIN_ROWS["cashflow"]), FIN_YEARS)
    # info: 公司全名 (搜新闻用，简称像 "JAG"、"SDG" 太容易搜到别的东西) + 财报货币 (马股大多是令吉，少数用美元报告)
    info = get("info") or {}
    fin = None
    if q["periods"] or a["periods"]:
        fin = {"quarterly": q, "annual": a, "currency": info.get("financialCurrency")}
    return {"v": 1, "symbol": symbol, "fetched_at": today, "long_name": info.get("longName"), "fin": fin, "bars": bars}


def read_detail_date(code):
    """已有文件的 (抓取日期, 有没有财报)；没有文件 / 坏文件返回 (None, False)"""
    try:
        with open(os.path.join(DETAIL_DIR, f"{code}.json"), encoding="utf-8") as f:
            d = json.load(f)
        if "long_name" not in d:  # 9/24 之前的旧格式没有公司全名 (搜新闻要用)，当成过期重抓
            return None, False
        return datetime.strptime(d["fetched_at"], "%Y-%m-%d"), bool(d.get("fin"))
    except Exception:
        return None, False


def detail_is_fresh(code, today):
    fetched, has_fin = read_detail_date(code)
    if fetched is None:
        return False
    age = (datetime.strptime(today, "%Y-%m-%d") - fetched).days
    return age < (DETAIL_MAX_AGE_DAYS if has_fin else DETAIL_RETRY_DAYS)


def prune_details(keep, today):
    """删掉超过 DETAIL_PRUNE_DAYS 天没更新、这次也不在报告里的股票文件；读不了的坏文件也删 (下次需要时会重抓)"""
    if not os.path.isdir(DETAIL_DIR):
        return 0
    removed = 0
    now = datetime.strptime(today, "%Y-%m-%d")
    for name in os.listdir(DETAIL_DIR):
        code = name[:-len(".json")]
        if not name.endswith(".json") or code in keep:
            continue
        fetched, _ = read_detail_date(code)
        if fetched is not None and (now - fetched).days <= DETAIL_PRUNE_DAYS:
            continue
        os.remove(os.path.join(DETAIL_DIR, name))
        removed += 1
    return removed


def refresh_details(stocks, today):
    """报告里的股票 (信号在前，其余按成交量从高到低)，文件没有或过期的，这次补 DETAIL_PER_RUN 支。
    返回 (这次抓了几支, 写入几支, 其中几支有财报, 删掉几个过期文件)"""
    candidates = sorted((s for s in stocks if s["data"]), key=lambda s: (not s["matched"], -s["data"]["volume"]))
    todo = [s["symbol"] for s in candidates if not detail_is_fresh(s["symbol"].split(".")[0], today)][:DETAIL_PER_RUN]
    written = with_fin = 0
    if todo:
        os.makedirs(DETAIL_DIR, exist_ok=True)

        def safe_fetch(symbol):
            try:
                return fetch_detail(symbol, today)
            except Exception as e:
                print(f"⚠️ {symbol} 个股资料获取失败 ({type(e).__name__}: {e})")
                return None
        with ThreadPoolExecutor(max_workers=DETAIL_WORKERS) as pool:
            for symbol, detail in zip(todo, pool.map(safe_fetch, todo)):
                if detail is None:
                    continue  # 这次没拿到，下次运行再试
                with open(os.path.join(DETAIL_DIR, f"{symbol.split('.')[0]}.json"), "w", encoding="utf-8") as f:
                    json.dump(detail, f, ensure_ascii=False, separators=(",", ":"))
                written += 1
                with_fin += detail["fin"] is not None
    pruned = prune_details({s["symbol"].split(".")[0] for s in stocks if s["data"]}, today)
    return len(todo), written, with_fin, pruned



# ---- 个股新闻: 最近的新闻标题 + 链接，存在 docs/news/<代码>.json，每支半天更新一次 ----
# 只存标题、来源、时间和原文链接 (不转载内文)。主要用 Google News RSS 按公司全名搜 (比 Yahoo 的个股新闻准，
# Yahoo 对马股小公司常常给一堆无关的大盘新闻)；Google 那边拿不到时才退回 Yahoo。
NEWS_DIR = os.path.join("docs", "news")
NEWS_MAX_AGE_HOURS = 12
NEWS_PER_RUN = 40
NEWS_WORKERS = 8
NEWS_KEEP = 8
NEWS_MAX_DAYS = 90
NEWS_PRUNE_DAYS = 30
GOOGLE_NEWS_RSS = "https://news.google.com/rss/search"
COMPANY_SUFFIX_RE = re.compile(r"[\s,.]*\b(berhad|bhd)\.?\s*$", re.I)


def news_query(name, long_name):
    """搜索词: 有全名就用全名 (去掉 Berhad / Bhd 结尾，新闻里两种写法都有)，没有就用简称 + Bursa"""
    if long_name:
        base = COMPANY_SUFFIX_RE.sub("", long_name).strip()
        if len(base) >= 4:
            return f'"{base}"'
    return f'"{name}" Bursa'


def google_news(query):
    """Google News RSS → [{title, source, link, time}]；请求失败会抛异常 (调用的地方决定要不要重试)"""
    import xml.etree.ElementTree as ET
    from email.utils import parsedate_to_datetime
    r = requests.get(GOOGLE_NEWS_RSS, params={"q": f"{query} when:{NEWS_MAX_DAYS}d", "hl": "en-MY", "gl": "MY", "ceid": "MY:en"},
                     headers={"User-Agent": "Mozilla/5.0 (bursa-bot)"}, timeout=10)
    r.raise_for_status()
    items = []
    for it in ET.fromstring(r.content).iter("item"):
        title, link = (it.findtext("title") or "").strip(), (it.findtext("link") or "").strip()
        source = (it.findtext("source") or "").strip()
        if source and title.endswith(" - " + source):  # Google 会在标题后面接 " - 来源"
            title = title[: -len(" - " + source)]
        try:
            ts = int(parsedate_to_datetime(it.findtext("pubDate")).timestamp())
        except Exception:
            ts = None
        if title and link.startswith("http"):
            items.append({"title": title, "source": source, "link": link, "time": ts})
    return items


def yahoo_news(symbol):
    """yfinance 的个股新闻 (新旧两种格式都认)"""
    items = []
    for n in yf.Ticker(symbol).news or []:
        c = n.get("content") or n
        link = ((c.get("canonicalUrl") or {}).get("url") or (c.get("clickThroughUrl") or {}).get("url") or c.get("link") or "")
        source = (c.get("provider") or {}).get("displayName") or c.get("publisher") or "Yahoo Finance"
        ts = c.get("providerPublishTime")
        if not ts and c.get("pubDate"):
            try:
                ts = int(pd.Timestamp(c["pubDate"]).timestamp())
            except Exception:
                ts = None
        if c.get("title") and link.startswith("http"):
            items.append({"title": c["title"], "source": source, "link": link, "time": ts})
    return items


def fetch_news(symbol, name, long_name, now):
    """返回新闻文件内容；两个来源都出错 = 这次请求失败，返回 None (不写文件，下次运行再试)"""
    query = news_query(name, long_name)
    items, source, errors = [], None, 0
    for label, fn in (("Google News", lambda: google_news(query)), ("Yahoo Finance", lambda: yahoo_news(symbol))):
        try:
            items = fn()
        except Exception:
            errors += 1
            continue
        if items:
            source = label
            break
    if errors == 2:
        return None
    oldest = now.timestamp() - NEWS_MAX_DAYS * 86400
    seen, keep = set(), []
    for it in sorted(items, key=lambda x: x["time"] or 0, reverse=True):
        key = it["title"].lower()
        if key in seen or (it["time"] and it["time"] < oldest):
            continue
        seen.add(key)
        keep.append(it)
    return {"v": 1, "symbol": symbol, "fetched_at": now.isoformat(timespec="minutes"), "query": query,
            "source": source, "items": keep[:NEWS_KEEP]}


def news_age_hours(code, now):
    try:
        with open(os.path.join(NEWS_DIR, f"{code}.json"), encoding="utf-8") as f:
            fetched = datetime.fromisoformat(json.load(f)["fetched_at"])
        return (now - fetched).total_seconds() / 3600
    except Exception:
        return None


def refresh_news(stocks, now):
    """信号在前、其余按成交量从高到低，新闻超过 NEWS_MAX_AGE_HOURS 小时的这次补 NEWS_PER_RUN 支。
    返回 (抓了几支, 写入几支, 其中几支有新闻, 删掉几个过期文件)"""
    candidates = sorted((s for s in stocks if s["data"]), key=lambda s: (not s["matched"], -s["data"]["volume"]))
    todo = []
    for s in candidates:
        age = news_age_hours(s["symbol"].split(".")[0], now)
        if age is None or age >= NEWS_MAX_AGE_HOURS:
            todo.append(s)
        if len(todo) >= NEWS_PER_RUN:
            break
    written = with_items = 0
    if todo:
        os.makedirs(NEWS_DIR, exist_ok=True)

        def safe_fetch(s):
            code = s["symbol"].split(".")[0]
            try:
                with open(os.path.join(DETAIL_DIR, f"{code}.json"), encoding="utf-8") as f:
                    long_name = json.load(f).get("long_name")
            except Exception:
                long_name = None
            try:
                return fetch_news(s["symbol"], s["name"], long_name, now)
            except Exception as e:
                print(f"⚠️ {s['symbol']} 新闻获取失败 ({type(e).__name__}: {e})")
                return None
        with ThreadPoolExecutor(max_workers=NEWS_WORKERS) as pool:
            for s, news in zip(todo, pool.map(safe_fetch, todo)):
                if news is None:
                    continue
                with open(os.path.join(NEWS_DIR, f"{s['symbol'].split('.')[0]}.json"), "w", encoding="utf-8") as f:
                    json.dump(news, f, ensure_ascii=False, separators=(",", ":"))
                written += 1
                with_items += bool(news["items"])
    keep = {s["symbol"].split(".")[0] for s in stocks if s["data"]}
    pruned = 0
    if os.path.isdir(NEWS_DIR):
        for name in os.listdir(NEWS_DIR):
            code = name[:-len(".json")]
            if not name.endswith(".json") or code in keep:
                continue
            age = news_age_hours(code, now)
            if age is None or age > NEWS_PRUNE_DAYS * 24:
                os.remove(os.path.join(NEWS_DIR, name))
                pruned += 1
    return len(todo), written, with_items, pruned

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


def sar_pill_html(bullish):
    """SAR 多空标签；None = 天数太少算不出来 (新上市第一天)"""
    if bullish is None:
        return "—"
    return '<span class="pill pill-up">多头</span>' if bullish else '<span class="pill pill-down">空头</span>'


def history_badge(data):
    """历史不到 CHART_HISTORY_DAYS (90) 个交易日的股票 (多半是新上市) 标一个"N天"，提醒部分指标算不出来"""
    days = data.get("history_days")
    if not days or days >= CHART_HISTORY_DAYS:
        return ""
    return (f'<span class="new-badge" title="只有 {days} 个交易日的数据 (多半是新上市)，'
            f'天数不够的指标显示 —">{days}天</span>')


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
    # 新股天数不够时 EMA20 / SAR 是 None，直接不算命中 (照样会进表格)
    if data['ema20_latest'] is None or not (data['close'] > data['ema20_latest']):
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
- 50日均线: {f"RM {data['sma50']}" if data['sma50'] is not None else "数据不足 (新上市，不到 50 个交易日)"}"""

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

UI_CSS = """
  /* 有些元素自己的 class 写了 display: flex，会盖掉浏览器默认的 [hidden] { display: none }，这里统一强制一下 */
  [hidden] { display: none !important; }
  .ico { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.4; stroke-linecap: round; stroke-linejoin: round; flex-shrink: 0; }
  .ico .f { fill: currentColor; }
  .ico .f2 { fill: currentColor; opacity: 0.25; stroke: none; }
  .ico .thick { stroke-width: 2.4; }
  .hint { font-size: 0.78rem; color: var(--muted); line-height: 1.7; margin: 0.4rem 0 0.6rem; }
  .hint code, .ind-row code {
    font-family: ui-monospace, "SFMono-Regular", Menlo, monospace;
    background: var(--page);
    padding: 0.05rem 0.3rem;
    border-radius: 3px;
    font-size: 0.92em;
  }
  .btn-danger { color: var(--down) !important; display: inline-flex; align-items: center; gap: 0.3rem; }
  .btn-danger .ico { width: 13px; height: 13px; }
  .btn-primary { background: var(--text-primary) !important; color: var(--surface) !important; border-color: var(--text-primary) !important; }
  .form-error { color: var(--down); font-size: 0.8rem; margin: 0.4rem 0; }

  /* ---- 对话框 (指标库、指标设置、图表设置) ---- */
  html.dlg-open { overflow: hidden; }
  .dlg-overlay {
    position: fixed; inset: 0; z-index: 50;
    background: rgba(0, 0, 0, 0.45);
    display: flex; align-items: center; justify-content: center;
    padding: 1rem;
  }
  .dlg {
    background: var(--surface);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
    width: min(440px, 100%);
    max-height: min(86vh, 760px);
    display: flex; flex-direction: column;
    overflow: hidden;
  }
  .dlg.dlg-ind { width: min(960px, 100%); height: min(86vh, 720px); }
  .dlg-head { display: flex; align-items: center; justify-content: space-between; padding: 0.9rem 1rem 0.6rem; }
  .dlg-head h3 { margin: 0; font-size: 1.05rem; }
  .dlg-x { background: none; border: none; color: var(--text-secondary); font-size: 1.5rem; line-height: 1; cursor: pointer; padding: 0.1rem 0.4rem; border-radius: 6px; }
  .dlg-x:hover { background: var(--page); color: var(--text-primary); }
  .dlg-body { padding: 0 1rem 1rem; overflow: auto; flex: 1; min-height: 0; }
  .dlg-foot { display: flex; align-items: center; gap: 0.5rem; padding: 0.7rem 1rem; border-top: 1px solid var(--border); }
  .dlg-foot .grow { flex: 1; }
  .dlg button:not(.dlg-x):not(.ind-row-main):not(.ind-nav-item):not(.ind-star):not([role="tab"]),
  .dlg select, .dlg input[type="text"], .dlg input[type="number"], .dlg input[type="search"], .dlg textarea {
    font: inherit; font-size: 0.85rem; color: var(--text-primary);
    background: var(--page); border: 1px solid var(--border); border-radius: 6px; padding: 0.4rem 0.65rem;
  }
  .dlg button { cursor: pointer; }
  .dlg input[type="color"] { width: 34px; height: 26px; border: 1px solid var(--border); border-radius: 5px; padding: 0; background: none; cursor: pointer; }
  .dlg label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.8rem; color: var(--text-secondary); }

  /* 指标库对话框: 左边分类导航，右边列表 (手机上导航变成上方一排可滑动的标签) */
  .ind-dlg { display: flex; flex-direction: column; height: 100%; gap: 0.6rem; }
  .ind-dlg-top { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }
  .ind-search { flex: 1 1 260px; }
  .ind-place { display: flex; align-items: center; gap: 0.3rem; font-size: 0.78rem; color: var(--text-secondary); }
  .dlg .ind-place button { border-radius: 999px !important; padding: 0.2rem 0.7rem !important; font-size: 0.78rem !important; }
  /* 上面那条通用按钮样式的优先级很高 (一串 :not)，这里要用 !important 才盖得过 */
  .dlg .ind-place button[aria-checked="true"] { background: var(--text-primary) !important; color: var(--surface) !important; border-color: var(--text-primary) !important; }
  .ind-dlg-main { display: flex; gap: 0.75rem; flex: 1; min-height: 0; }
  .ind-nav { flex: 0 0 170px; overflow: auto; border-right: 1px solid var(--border); padding-right: 0.5rem; }
  .ind-nav-title { font-size: 0.72rem; color: var(--muted); margin: 0.6rem 0.4rem 0.25rem; }
  .ind-nav-item {
    display: flex; align-items: center; gap: 0.5rem; width: 100%; text-align: left;
    font: inherit; font-size: 0.86rem; color: var(--text-primary);
    background: none; border: none; border-radius: 6px; padding: 0.4rem 0.5rem;
  }
  .ind-nav-item.sub { padding-left: 1.6rem; font-size: 0.8rem; color: var(--text-secondary); }
  .ind-nav-item:hover { background: var(--page); }
  .ind-nav-item.active { background: var(--page); font-weight: 600; box-shadow: inset 3px 0 0 var(--text-primary); }
  .ind-nav-ico { width: 1rem; text-align: center; color: var(--muted); }
  .ind-pane { flex: 1; overflow: auto; min-width: 0; }
  .ind-pane-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem; margin: 0.3rem 0; }
  .ind-pane-head h4 { margin: 0; font-size: 0.95rem; }
  .head-actions { display: flex; gap: 0.4rem; flex-wrap: wrap; }
  .ind-sub-head { font-size: 0.75rem; color: var(--muted); margin: 0.8rem 0 0.2rem; }
  .ind-list { display: flex; flex-direction: column; }
  .ind-row {
    display: grid; grid-template-columns: 1.8rem minmax(0, 1.4fr) minmax(0, 1fr) auto; align-items: center;
    gap: 0.4rem; padding: 0.15rem 0.3rem; border-radius: 6px;
  }
  .ind-row:hover, .ind-row:focus-within { background: var(--page); }
  .ind-row.active { background: color-mix(in srgb, var(--ema) 10%, transparent); }
  .ind-star { background: none; border: none; font-size: 1rem; color: var(--muted); padding: 0.2rem; }
  .ind-star.on { color: #f5a623; }
  .ind-star.static { text-align: center; }
  .ind-row-main { display: flex; align-items: center; gap: 0.4rem; background: none; border: none; font: inherit; color: var(--text-primary); text-align: left; padding: 0.45rem 0.2rem; min-width: 0; }
  .ind-row-name { font-size: 0.88rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ind-badge { font-size: 0.68rem; color: var(--up); border: 1px solid currentColor; border-radius: 999px; padding: 0 0.35rem; white-space: nowrap; }
  .ind-row-cat { font-size: 0.75rem; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ind-row-actions { display: flex; gap: 0.25rem; opacity: 0; }
  .ind-row:hover .ind-row-actions, .ind-row:focus-within .ind-row-actions, .ind-row-actions.always { opacity: 1; }
  .dlg .ind-row-actions button { padding: 0.15rem 0.45rem; font-size: 0.78rem; display: inline-flex; align-items: center; }
  .ind-row-info { grid-column: 2 / -1; font-size: 0.78rem; color: var(--text-secondary); line-height: 1.6; padding: 0 0.2rem 0.5rem; }
  .ind-empty { color: var(--muted); font-size: 0.85rem; padding: 1rem 0.3rem; }
  .script-form { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: flex-end; margin: 0.4rem 0 0.8rem; }
  .script-form .grow { flex: 1 1 220px; }
  .script-form .hint, .script-form .form-error { flex-basis: 100%; margin: 0; }

  /* 单个指标设置: 输入 / 样式 两页 */
  .ind-set, .chart-set { display: flex; flex-direction: column; gap: 0.7rem; }
  .tabs { display: flex; gap: 1rem; border-bottom: 1px solid var(--border); margin-bottom: 0.2rem; }
  .tabs [role="tab"] { background: none; border: none; font: inherit; font-size: 0.9rem; color: var(--text-secondary); padding: 0.4rem 0; border-bottom: 2px solid transparent; cursor: pointer; }
  .tabs [role="tab"][aria-selected="true"] { color: var(--text-primary); border-bottom-color: var(--text-primary); font-weight: 600; }
  .tab-page { display: flex; flex-direction: column; gap: 0.7rem; }
  .ind-set textarea { font-family: ui-monospace, "SFMono-Regular", Menlo, monospace; resize: vertical; }
  .dlg label.color-row { flex-direction: row; align-items: center; justify-content: space-between; font-size: 0.85rem; color: var(--text-primary); }
  .dlg label.check { flex-direction: row; align-items: center; gap: 0.4rem; font-size: 0.85rem; color: var(--text-primary); }
  .seg { display: flex; align-items: center; gap: 0.8rem; font-size: 0.85rem; }
  .seg > span { color: var(--text-secondary); font-size: 0.8rem; }
  .dlg .seg label { flex-direction: row; align-items: center; gap: 0.3rem; color: var(--text-primary); font-size: 0.85rem; }
  .color-grid { display: flex; flex-direction: column; gap: 0.6rem; }

  .bb-toast {
    position: fixed; left: 50%; bottom: 1.5rem; transform: translate(-50%, 1rem); z-index: 60;
    background: var(--text-primary); color: var(--surface); font-size: 0.82rem;
    padding: 0.5rem 0.9rem; border-radius: 999px; opacity: 0; pointer-events: none; transition: opacity 0.2s, transform 0.2s;
    max-width: calc(100vw - 2rem);
  }
  .bb-toast.show { opacity: 1; transform: translate(-50%, 0); }

  @media (max-width: 640px) {
    .dlg-overlay { padding: 0; align-items: flex-end; }
    .dlg { width: 100%; max-height: 92vh; border-radius: 14px 14px 0 0; }
    .dlg.dlg-ind { height: 92vh; }
    .ind-dlg-main { flex-direction: column; gap: 0.4rem; }
    .ind-nav { flex: 0 0 auto; display: flex; gap: 0.3rem; overflow-x: auto; border-right: none; border-bottom: 1px solid var(--border); padding: 0 0 0.4rem; scrollbar-width: none; }
    .ind-nav-group { display: contents; }
    .ind-nav-title { display: none; }
    .ind-nav-item, .ind-nav-item.sub { width: auto; flex: 0 0 auto; padding: 0.3rem 0.7rem; border: 1px solid var(--border); border-radius: 999px; font-size: 0.8rem; color: var(--text-primary); }
    .ind-nav-item.active { box-shadow: none; background: var(--text-primary); color: var(--surface); }
    .ind-nav-ico { display: none; }
    .ind-row { grid-template-columns: 1.8rem minmax(0, 1fr) auto; }
    .ind-row-cat { grid-column: 2 / 3; grid-row: 2; margin-top: -0.35rem; padding-bottom: 0.3rem; }
    .ind-row-actions { opacity: 1; grid-row: 1; grid-column: 3; }
  }
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
  .table-count { color: var(--muted); font-size: 0.8rem; margin-left: auto; }
  .table-hint { margin: -0.2rem 0 0.5rem; font-size: 0.75rem; color: var(--muted); }
  #watchlist-table tbody tr { cursor: pointer; }
  #watchlist-table tbody tr:focus-visible { outline: 2px solid var(--ema); outline-offset: -2px; }
  .table-sort { display: none; font: inherit; font-size: 0.8rem; color: var(--text-primary); background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 0.35rem 0.4rem; }
  /* 电脑: 表格撑满整个页面宽度 */
  table.data-table { font-size: 0.82rem; width: 100%; }
  table.data-table th, table.data-table td { padding: 0.38rem 0.6rem; line-height: 1.3; }
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
  .new-badge {
    display: inline-block; margin-left: 0.35rem; padding: 0 0.3rem; border-radius: 3px; vertical-align: middle;
    font-size: 0.64rem; font-weight: 600; color: var(--ema); border: 1px solid color-mix(in srgb, var(--ema) 50%, transparent);
  }
  .unit { color: var(--muted); font-size: 0.65em; margin-left: 2px; }
  .spark-cell { padding-top: 0.15rem; padding-bottom: 0.15rem; width: 18%; }
  .spark { display: block; width: 100%; min-width: 72px; max-width: 220px; height: 28px; }
  .spark polyline { fill: none; stroke-width: 1.3; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
  .spark-up polyline { stroke: var(--up); }
  .spark-down polyline { stroke: var(--down); }
  .spark-flat polyline { stroke: var(--muted); }
  .spark line { stroke: var(--muted); stroke-width: 0.6; stroke-dasharray: 2 2; vector-effect: non-scaling-stroke; }
  .relvol-high { font-weight: 700; color: var(--text-primary); }
  .pill { display: inline-block; padding: 0.05rem 0.45rem; border-radius: 999px; font-size: 0.7rem; font-weight: 600; }
  .pill-up { color: var(--up); background: color-mix(in srgb, var(--up) 14%, transparent); }
  .pill-down { color: var(--down); background: color-mix(in srgb, var(--down) 14%, transparent); }

  /* 手机: 不再左右滑动整张表，每一行排成两层刚好塞进屏幕宽度
     第一层  #  股票  走势  价格
     第二层     量  相对量  RSI  SAR  EMA20  涨跌%
     表头藏起来，改用搜索框旁边的"排序"下拉框 */
  @media (max-width: 640px) {
    .table-toolbar { flex-wrap: wrap; gap: 0.5rem; }
    #table-filter { flex: 1 1 60%; }
    .table-sort { display: block; }
    .table-count { flex-basis: 100%; margin: 0; }
    .table-wrap { overflow: visible; }
    #watchlist-table, #watchlist-table tbody { display: block; width: 100%; }
    #watchlist-table thead { display: none; }
    #watchlist-table tbody tr {
      display: grid;
      grid-template-columns: 1.5rem repeat(5, minmax(0, 1fr)) auto;
      grid-template-areas:
        "idx   stock stock stock spark spark price"
        ".     vol   relvol rsi  sar   ema   change";
      align-items: center; column-gap: 0.35rem; row-gap: 0.1rem;
      padding: 0.45rem 0.5rem; border-bottom: 1px solid var(--border);
    }
    #watchlist-table td { display: block; padding: 0; border: none; background: none; position: static; min-width: 0; max-width: none; width: auto; }
    #watchlist-table td.idx-cell { grid-area: idx; text-align: left; font-size: 0.72rem; }
    #watchlist-table td.stock-cell { grid-area: stock; overflow: hidden; text-overflow: ellipsis; }
    #watchlist-table td.spark-cell { grid-area: spark; }
    #watchlist-table .spark { min-width: 0; height: 24px; }
    #watchlist-table td.col-price { grid-area: price; font-weight: 600; font-size: 0.85rem; }
    #watchlist-table td.col-change { grid-area: change; font-size: 0.8rem; }
    #watchlist-table td.col-vol { grid-area: vol; }
    #watchlist-table td.col-relvol { grid-area: relvol; }
    #watchlist-table td.col-rsi { grid-area: rsi; }
    #watchlist-table td.col-sar { grid-area: sar; }
    #watchlist-table td.col-ema { grid-area: ema; }
    #watchlist-table td[data-label] { text-align: left; font-size: 0.74rem; font-weight: 500; }
    #watchlist-table td[data-label]::before { content: attr(data-label); display: block; font-size: 0.62rem; color: var(--muted); font-weight: 400; }
    #watchlist-table td.col-ema.change-up, #watchlist-table td.col-ema.change-down { font-weight: 600; }
    #watchlist-table .pill { padding: 0 0.35rem; font-size: 0.66rem; }
    #watchlist-table .ticker { font-size: 0.74rem; }
    #watchlist-table .unit { display: none; }
  }
"""


# 图表脚本放在 docs/report.js (不再内嵌在 HTML 里)：浏览器可以缓存，改起来也好测试。
# 网址后面带上文件内容的哈希，改了脚本后浏览器会自动拿新版本，不会用到缓存里的旧脚本。
REPORT_JS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "docs", "report.js")


def report_js_version():
    try:
        with open(REPORT_JS_PATH, "rb") as f:
            return hashlib.sha1(f.read()).hexdigest()[:10]
    except OSError:
        return "dev"


CARD_CSS = """
  /* ---- 筛选器: 模板名称 → 股票标签 → 全局工具栏 → 卡片轮播 ---- */
  .tpl-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; margin: 0 0 0.8rem; font-size: 0.8rem; color: var(--muted); }
  .tpl-name {
    font: inherit; font-size: 0.85rem; color: var(--text-secondary);
    background: transparent; border: 1px dashed transparent; border-radius: 4px;
    padding: 0.15rem 0.35rem; width: 14em; max-width: 70vw;
  }
  .tpl-name:hover { border-color: var(--border); }
  .tpl-name:focus { outline: none; border-color: var(--muted); color: var(--text-primary); }
  .tpl-status { font-size: 0.72rem; color: var(--up); opacity: 0; transition: opacity 0.3s; }
  .tpl-status.show { opacity: 1; }

  .screener { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
  /* 股票标签: 像 TradingView 顶部的分页，放不下时左右滑 */
  .sym-strip { display: flex; align-items: stretch; border-bottom: 1px solid var(--border); background: var(--page); }
  .sym-list { display: flex; overflow-x: auto; scrollbar-width: none; flex: 1; min-width: 0; scroll-behavior: smooth; }
  .sym-list::-webkit-scrollbar { display: none; }
  .sym-chip {
    flex: 0 0 auto; display: inline-flex; align-items: baseline; gap: 0.35rem;
    font: inherit; font-size: 0.78rem; color: var(--text-secondary);
    background: none; border: none; border-right: 1px solid var(--border);
    padding: 0.55rem 0.8rem; cursor: pointer; white-space: nowrap;
  }
  .sym-chip b { color: var(--text-primary); font-size: 0.82rem; }
  .sym-chip .sym-price { font-variant-numeric: tabular-nums; }
  .sym-chip:hover { background: var(--surface); }
  .sym-chip.active { background: var(--surface); box-shadow: inset 0 -2px 0 var(--text-primary); }
  .sym-nav, .tf-arrow {
    flex: 0 0 auto; font: inherit; font-size: 1.05rem; line-height: 1; color: var(--text-secondary);
    background: none; border: none; padding: 0 0.5rem; cursor: pointer;
  }
  .tf-arrow:disabled { visibility: hidden; }
  .sym-nav:hover, .tf-arrow:hover { color: var(--text-primary); }

  /* 全局工具栏: 周期 | 图表类型 ▾ | ƒx 指标 | 模板 | ⚙ */
  .chart-toolbar { display: flex; align-items: center; gap: 0.4rem; padding: 0.35rem 0.5rem; border-bottom: 1px solid var(--border); }
  .tb-tf { display: flex; align-items: center; flex: 1; min-width: 0; }
  .tf-list { display: flex; gap: 0.1rem; overflow-x: auto; scroll-behavior: smooth; scrollbar-width: none; flex: 1; min-width: 0; }
  .tf-list::-webkit-scrollbar { display: none; }
  .tf-btn, .tb-btn {
    flex: 0 0 auto; display: inline-flex; align-items: center; gap: 0.3rem;
    font: inherit; font-size: 0.8rem; color: var(--text-secondary);
    background: transparent; border: 1px solid transparent; border-radius: 6px;
    padding: 0.28rem 0.5rem; cursor: pointer; white-space: nowrap;
  }
  .tf-btn:hover:not(:disabled), .tb-btn:hover { background: var(--page); color: var(--text-primary); }
  .tf-btn[aria-selected="true"] { background: var(--page); border-color: var(--border); color: var(--text-primary); font-weight: 600; }
  .tf-btn:disabled { opacity: 0.35; cursor: default; }
  .tb-tools { display: flex; align-items: center; gap: 0.15rem; border-left: 1px solid var(--border); padding-left: 0.4rem; }
  .tb-btn .fx { font-style: italic; font-weight: 700; font-family: Georgia, serif; }
  .tb-caret { font-size: 0.65rem; color: var(--muted); }
  .tb-menu-wrap { position: relative; }
  .tb-menu {
    position: absolute; top: calc(100% + 6px); left: 0; z-index: 30;
    width: 250px; max-height: min(70vh, 620px); overflow: auto;
    background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25); padding: 0.3rem;
  }
  .tb-menu-group + .tb-menu-group { border-top: 1px solid var(--border); margin-top: 0.25rem; padding-top: 0.25rem; }
  .tb-menu-item {
    display: flex; align-items: center; gap: 0.65rem; width: 100%;
    font: inherit; font-size: 0.86rem; color: var(--text-primary);
    background: none; border: none; border-radius: 6px; padding: 0.45rem 0.6rem; cursor: pointer; text-align: left;
  }
  .tb-menu-item:hover, .tb-menu-item:focus { background: var(--page); outline: none; }
  .tb-menu-item.on { background: var(--text-primary); color: var(--surface); }
  .tb-menu-item[aria-disabled="true"] { color: var(--muted); cursor: default; }
  .tb-menu-item small { margin-left: auto; font-size: 0.68rem; color: var(--muted); }

  /* 卡片轮播: 一次一张，左右滑 / ‹ › / 点股票标签 */
  .carousel { position: relative; }
  .car-track { display: flex; overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: none; overscroll-behavior-x: contain; }
  .car-track::-webkit-scrollbar { display: none; }
  .car-track:focus-visible { outline: 2px solid var(--ema); outline-offset: -2px; }
  .card { flex: 0 0 100%; min-width: 0; scroll-snap-align: start; scroll-snap-stop: always; padding: 0.9rem 1rem 1rem; background: var(--surface); }
  /* 右上角: ‹ 1 / 12 › (放在卡片标题旁边，不会挡到图表的价格坐标) */
  .car-ctrl { position: absolute; top: 0.7rem; right: 0.8rem; z-index: 4; display: flex; align-items: center; gap: 0.25rem; }
  .car-nav {
    width: 1.9rem; height: 1.9rem; border-radius: 50%;
    font: inherit; font-size: 1.15rem; line-height: 1; color: var(--text-primary);
    background: var(--page); border: 1px solid var(--border); cursor: pointer;
  }
  .car-nav:hover:not(:disabled) { border-color: var(--text-secondary); }
  .car-nav:disabled { opacity: 0.3; cursor: default; }
  .car-count { min-width: 3.2em; text-align: center; font-size: 0.75rem; color: var(--muted); font-variant-numeric: tabular-nums; }

  .card-head { display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 0.3rem 0.8rem; margin: 0 7.8rem 0.2rem 0; }
  .card-price { font-size: 0.9rem; font-variant-numeric: tabular-nums; }
  .card-price b { font-size: 1.05rem; margin-right: 0.3rem; }
  .card-tags { margin: 0 0 0.5rem; font-size: 0.75rem; color: var(--muted); }
  .tf-note { margin: 0 0 0.4rem; font-size: 0.75rem; color: var(--down); }
  .chart-wrap { position: relative; }
  .chart { width: 100%; height: 440px; }
  /* 图表左上角的指标图例: 名称 (点一下改参数) + 数值 + 👁 ⚙ ↑ ↓ × (电脑上鼠标移过去才显示按钮，手机上一直显示) */
  .chart-legends { position: absolute; inset: 0; pointer-events: none; z-index: 3; }
  .lg-pane { position: absolute; left: 4px; right: 70px; display: flex; flex-direction: column; align-items: flex-start; gap: 1px; }
  .lg-row {
    display: inline-flex; align-items: center; gap: 0.3rem; max-width: 100%;
    font-size: 0.72rem; line-height: 1.5; padding: 0 0.3rem; border-radius: 4px;
    color: var(--text-secondary); background: color-mix(in srgb, var(--surface) 72%, transparent);
    pointer-events: auto; white-space: nowrap;
  }
  .lg-row.lg-error { color: var(--down); }
  .lg-row.lg-hidden { opacity: 0.55; }
  .lg-row.lg-hidden .lg-name { text-decoration: line-through; }
  .lg-swatch { width: 8px; height: 8px; border-radius: 2px; flex-shrink: 0; }
  .lg-name { flex-shrink: 0; max-width: 12em; font: inherit; color: inherit; background: none; border: none; padding: 0; cursor: pointer; overflow: hidden; text-overflow: ellipsis; border-radius: 3px; }
  .lg-name:hover { color: var(--text-primary); text-decoration: underline dotted; }
  .lg-name.lg-static { cursor: default; text-decoration: none; }
  .lg-val { font-variant-numeric: tabular-nums; display: inline-flex; gap: 0.3rem; min-width: 0; overflow: hidden; }
  .lg-ctrl { display: inline-flex; gap: 1px; }
  .lg-ctrl button {
    display: inline-flex; align-items: center; justify-content: center;
    font: inherit; font-size: 0.72rem; line-height: 1; width: 1.35rem; height: 1.25rem; padding: 0;
    color: var(--text-secondary); background: var(--page); border: 1px solid var(--border); border-radius: 3px; cursor: pointer;
  }
  .lg-ctrl .ico { width: 13px; height: 13px; }
  .lg-ctrl button:hover:not(:disabled) { color: var(--text-primary); }
  .lg-ctrl button[data-act="del"]:hover { color: var(--down); }
  .lg-ctrl button:disabled { opacity: 0.3; cursor: default; }
  @media (hover: hover) {
    .lg-row .lg-ctrl { display: none; }
    .lg-row:hover .lg-ctrl, .lg-row:focus-within .lg-ctrl { display: inline-flex; }
  }
  /* 手机 (没有鼠标): 点名称 = 打开设置；点这一行其他地方 = 展开 👁 ⚙ ↑ ↓ × (展开时先把数值藏起来，才放得下) */
  @media (hover: none) {
    .lg-row .lg-ctrl { display: none; }
    .lg-row.open .lg-ctrl { display: inline-flex; }
    .lg-row.open .lg-val { display: none; }
    .lg-name { max-width: 9em; }
    .lg-ctrl button { width: 1.7rem; height: 1.55rem; }
  }
  /* 图表下方的数据 (quote): 第一行是十字光标所在那根K线，下面是日线数据 */
  .quote { margin-top: 0.5rem; border-top: 1px solid var(--border); padding-top: 0.45rem; font-size: 0.78rem; }
  .quote-live { display: flex; flex-wrap: wrap; gap: 0.2rem 0.7rem; color: var(--text-secondary); font-variant-numeric: tabular-nums; min-height: 1.2em; }
  .quote-live b { color: var(--text-primary); font-weight: 600; }
  .quote-live .ql-time { color: var(--muted); }
  .quote-grid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 0.35rem 0.6rem; margin: 0.45rem 0 0; }
  .quote-grid div { min-width: 0; }
  .quote-grid dt { color: var(--muted); font-size: 0.7rem; }
  .quote-grid dd { margin: 0; color: var(--text-primary); font-weight: 600; font-variant-numeric: tabular-nums; }

  /* 筛选器卡片上的"完整图表 · 财报" */
  .card-fin {
    margin-left: 0.6rem; font: inherit; font-size: 0.75rem; color: var(--ema);
    background: none; border: none; padding: 0; cursor: pointer; white-space: nowrap;
  }
  .card-fin:hover { text-decoration: underline; }

  /* ---- 完整图表 + 财报 对话框 ---- */
  .dlg.dlg-stock { width: min(1280px, 100%); height: min(94vh, 1000px); }
  .stock-view { display: flex; flex-direction: column; gap: 0.4rem; }
  .sv-head { font-size: 0.95rem; }
  .sv-toolbar { display: flex; align-items: center; gap: 0.4rem; border-bottom: 1px solid var(--border); padding-bottom: 0.3rem; }
  .sv-toolbar .tf-list { flex: 1; }
  .stock-view .chart { height: 400px; }
  .fin { margin-top: 0.8rem; border-top: 1px solid var(--border); padding-top: 0.6rem; }
  .fin-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem; }
  .fin-head h4 { margin: 0; font-size: 0.95rem; }
  .fin-tabs { border-bottom: none; margin: 0; }
  .fc-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 0.6rem 1rem; margin: 0.7rem 0; }
  .fc { min-width: 0; }
  .fc-title { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 0.4rem; font-size: 0.8rem; color: var(--text-secondary); }
  .fc-title .change-up, .fc-title .change-down { font-size: 0.72rem; }
  .fc-svg { display: block; width: 100%; height: auto; overflow: visible; }
  .fc-base { stroke: var(--gridline); stroke-width: 1; }
  .fc-hit { fill: transparent; }
  .fc-bar:hover path { opacity: 0.75; }
  .fc-val { font-size: 10px; font-weight: 600; fill: var(--text-primary); font-variant-numeric: tabular-nums; }
  .fc-lbl { font-size: 9px; fill: var(--muted); }
  .fin-table-wrap { overflow-x: auto; }
  .fin-table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
  .fin-table th, .fin-table td { padding: 0.32rem 0.55rem; border-bottom: 1px solid var(--border); white-space: nowrap; }
  .fin-table thead th { color: var(--text-secondary); font-weight: 500; font-size: 0.75rem; }
  .fin-table thead th small { display: block; color: var(--muted); font-size: 0.65rem; font-weight: 400; }
  .fin-table tbody th, .fin-table thead th:first-child { text-align: left; font-weight: 500; color: var(--text-secondary); }
  .fin-table .num { text-align: right; font-variant-numeric: tabular-nums; }
  .fin-foot a { color: var(--ema); }
  .sv-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0 1.5rem; }
  .sv-chart { min-width: 0; }
  /* 电脑: 左边正方形K线图，右边财报 (鼠标放在右边滚轮 = 滚动对话框，不会被图表吃掉)；下面整排是新闻 */
  @media (min-width: 900px) {
    .sv-grid { grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); align-items: start; }
    .sv-grid .fin { margin-top: 0; border-top: none; padding-top: 0.2rem; }
    .sv-grid .fc-grid { grid-template-columns: 1fr 1fr; }
  }
  .news { margin-top: 1rem; border-top: 1px solid var(--border); padding-top: 0.6rem; }
  .news h4 { margin: 0 0 0.3rem; font-size: 0.95rem; }
  .news-list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); column-gap: 1.5rem; }
  .news-list li { padding: 0.5rem 0; border-bottom: 1px solid var(--border); min-width: 0; }
  .news-list a {
    color: var(--text-primary); text-decoration: none; font-size: 0.86rem; font-weight: 500; line-height: 1.4;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }
  .news-list a:hover { text-decoration: underline; }
  .news-meta { display: block; margin-top: 0.15rem; font-size: 0.72rem; color: var(--muted); }
  .news-foot { margin-top: 0.5rem; }
  /* 手机 / 平板 (没有鼠标): 图表和表格右边留一条空白给拇指滑页面 (中间那条细线是提示)，
     不会一滑就点开股票、或者拖到图表的价格轴 */
  @media (hover: none) {
    .chart-wrap { margin-right: 26px; }
    .chart-wrap::after, .table-wrap::after {
      content: ""; position: absolute; top: 0.6rem; bottom: 0.6rem; right: -15px; width: 3px; border-radius: 2px;
      background: var(--border); pointer-events: none;
    }
    .table-wrap { position: relative; margin-right: 22px; }
    .table-wrap::after { right: -13px; }
  }

  @media (max-width: 640px) {
    .chart { height: 300px; }
    .card { padding: 0.75rem 0.7rem 0.85rem; }
    .quote-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .tb-label, .tb-caret { display: none; }
    .tb-tools { gap: 0; padding-left: 0.2rem; }
    .tf-btn, .tb-btn { padding: 0.28rem 0.42rem; }
    .car-ctrl { top: 0.55rem; right: 0.5rem; }
    .stock-view .chart { height: 300px; }
    .dlg.dlg-stock { height: 94vh; }
    .sv-toolbar { align-items: flex-start; }
    .sv-toolbar .tf-list { flex-wrap: wrap; overflow: visible; } /* 手机上周期按钮排两行，不藏在右边 */
    .fc-grid { grid-template-columns: 1fr 1fr; gap: 0.5rem 0.8rem; }
    .fc-lbl { font-size: 13px; } /* 小图缩到约 0.7 倍，字要写大一点，实际显示约 9-10px */
    .fc-val { font-size: 14px; }
    .fin-table { font-size: 0.75rem; }
    .fin-table th, .fin-table td { padding: 0.3rem 0.3rem; }
    .fin-table thead th small { display: none; } /* 手机上只留 25Q3 / FY2025，四栏才放得下不用横向滑 */
    .card-fin { display: block; margin: 0.2rem 0 0; }
    .card-head { margin-right: 7rem; }
    .tb-menu { position: fixed; left: 0.5rem; right: 0.5rem; top: auto; bottom: 0.5rem; width: auto; max-height: 70vh; }
  }
"""

TEMPLATE_BAR_HTML = """
<div class="tpl-bar" id="tpl-bar">
  <span>模板</span>
  <input type="text" id="tpl-name" class="tpl-name" maxlength="30" spellcheck="false" aria-label="筛选器名称 (当前指标模板，改名自动保存)" title="点一下改名，自动保存">
  <span id="tpl-status" class="tpl-status" aria-live="polite">✓ 已自动保存</span>
</div>
"""


def build_screener_html(cards, chips):
    """筛选器区块: 股票标签 + 全局工具栏 (由 report.js 填) + 卡片轮播。没有信号就只显示一句话。"""
    if not cards:
        return "<p class='no-data'>今日无符合条件的股票。</p>"
    return f"""<section class="screener" id="screener" aria-label="筛选器图表">
  <div class="sym-strip">
    <button type="button" class="sym-nav" data-dir="-1" aria-label="股票标签向左滚动">‹</button>
    <div class="sym-list" role="list">{''.join(chips)}</div>
    <button type="button" class="sym-nav" data-dir="1" aria-label="股票标签向右滚动">›</button>
  </div>
  <div class="chart-toolbar" id="chart-toolbar"></div>
  <div class="carousel">
    <div class="car-track" id="car-track" tabindex="0" aria-label="左右滑动切换股票">
{''.join(cards)}
    </div>
    <div class="car-ctrl">
      <button type="button" class="car-nav prev" aria-label="上一支">‹</button>
      <span class="car-count" id="car-count" aria-live="polite"></span>
      <button type="button" class="car-nav next" aria-label="下一支">›</button>
    </div>
  </div>
</section>"""

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
def build_html_report(stocks, downloads=None, table_charts_version=None):
    now = datetime.now(MYT).strftime("%Y-%m-%d %H:%M")

    cards = []
    chips = []
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
                f'<td class="num col-relvol{" relvol-high" if rel_vol >= 2 else ""}" data-label="相对量" data-value="{rel_vol}">{rel_vol:.2f}</td>'
                if rel_vol is not None else '<td class="num col-relvol" data-label="相对量" data-value="-1">—</td>'
            )
            sar_pill = sar_pill_html(data["sar_bullish_now"])
            sar_value = -1 if data["sar_bullish_now"] is None else int(data["sar_bullish_now"])
            ema = data["ema20_latest"]
            ema_cell = (
                f'<td class="num col-ema {"change-up" if data["close"] > ema else "change-down"}" data-label="EMA20" data-value="{ema}">{ema:.3f}</td>'
                if ema is not None else '<td class="num col-ema" data-label="EMA20" data-value="-1">—</td>'
            )
            new_badge = history_badge(data)

            table_rows.append((data["volume"], f"""<tr data-search="{code} {name.lower()}" data-code="{code}" data-name="{name}" tabindex="0">
                <td class="idx-cell"></td>
                <td class="stock-cell" data-value="{name}"><span class="ticker">{name}</span><span class="stock-code">{code}</span>{new_badge}</td>
                <td class="spark-cell" title="{spark_title}">{spark}</td>
                <td class="num col-price" data-value="{data['close']}">{data['close']:.3f}<span class="unit">MYR</span></td>
                <td class="num col-change {change_class}" data-value="{change_pct}">{change_sign}{change_pct:.2f}%</td>
                <td class="num col-vol" data-label="成交量" data-value="{data['volume']}">{fmt_volume(data['volume'])}</td>
                {rel_vol_cell}
                <td class="num col-rsi" data-label="RSI" data-value="{fmt_num(data['rsi'], '{}', '-1')}">{fmt_num(data['rsi'], '{:.1f}')}</td>
                <td class="col-sar" data-label="SAR" data-value="{sar_value}">{sar_pill}</td>
                {ema_cell}
            </tr>"""))
            continue

        chart_id = f"chart-{code}"
        bars = dict(data.get("chart_history") or {})
        if "1d" not in bars:
            # 多周期数据整个抓不到时，至少用策略那份 90 天日线把"天"画出来
            candles = data["candles"]
            bars["1d"] = {
                "t": [calendar.timegm(datetime.strptime(c["time"], "%Y-%m-%d").timetuple()) for c in candles],
                "o": [c["open"] for c in candles], "h": [c["high"] for c in candles],
                "l": [c["low"] for c in candles], "c": [c["close"] for c in candles],
                "v": [c["volume"] for c in candles],
            }
        chart_payload[chart_id] = {"bars": bars}

        prev_close = round(data["prev_close"], 3) if data["prev_close"] else None
        change = data["close"] - prev_close if prev_close else 0
        change_pct = change / prev_close * 100 if prev_close else 0
        change_class = "change-up" if change > 0 else "change-down" if change < 0 else "change-neutral"
        sign = "+" if change > 0 else ""
        # 筛选条件做成一行小标签 (不带表情符号)，例如 "EMA20多头 · SAR多头 · T3形态突破"
        tags = " · ".join(part.strip() for part in s["reason"].replace("🎯", "").split("+") if part.strip())
        rel_vol = data.get("rel_volume")
        sar_pill = sar_pill_html(data["sar_bullish_now"])
        quote_items = [
            ("成交量", fmt_volume(data["volume"])),
            ("相对量", f"{rel_vol:.2f}×" if rel_vol is not None else "—"),
            ("RSI(14)", fmt_num(data["rsi"], "{:.1f}")),
            ("50日均线", fmt_num(data["sma50"], "{:.3f}")),
            ("EMA20", fmt_num(data["ema20_latest"], "{:.3f}")),
            ("SAR", sar_pill),
        ]
        quote_grid = "".join(f"<div><dt>{k}</dt><dd>{v}</dd></div>" for k, v in quote_items)

        # 图表下方只放数据 (quote)，不放说明文字/图例/符号；AI 点评只保留在下载的 Excel/PDF 里
        chips.append(f'''<button type="button" class="sym-chip" aria-current="false"><b>{html.escape(s['name'])}</b>'''
                     f'''<span class="sym-price">{data['close']:.3f}</span><span class="{change_class}">{sign}{change_pct:.2f}%</span></button>''')
        cards.append(f"""<section class="card" data-chart="{chart_id}" aria-roledescription="卡片" aria-label="{html.escape(s['name'])} {code}">
            <div class="card-head">
                <h2>{html.escape(s['name'])} <span class="code">{code}</span>{history_badge(data)}</h2>
                <div class="card-price"><b>{data['close']:.3f}</b> <span class="{change_class}">{sign}{change:.3f} ({sign}{change_pct:.2f}%)</span></div>
            </div>
            <p class="card-tags">{html.escape(tags)}</p>
            <p class="tf-note" id="{chart_id}-tfnote" hidden></p>
            <div class="chart-wrap">
                <div id="{chart_id}" class="chart"></div>
                <div class="chart-legends" id="{chart_id}-legends"></div>
            </div>
            <div class="quote">
                <div class="quote-live" id="{chart_id}-live"></div>
                <dl class="quote-grid">{quote_grid}</dl>
            </div>
        </section>""")

    # 默认按成交量从高到低排 (跟 TradingView 选股器一样)，点表头仍然可以改排序
    table_rows = [row for _, row in sorted(table_rows, key=lambda r: r[0], reverse=True)]

    # 放进 <script> 里，"</" 转义掉，免得名字里万一有 "</script>" 把脚本截断
    chart_json = json.dumps(chart_payload, separators=(",", ":")).replace("</", "<\\/")
    no_data_note = f"<p class='no-data'>另有 {no_data_count} 支股票数据不足，未列入。</p>" if no_data_count else ""

    return f"""<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>马股自动分析报告</title>
<script src="vendor/lightweight-charts.js?v=5.2.1"></script>
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
  .no-data {{ color: var(--muted); }}
  .change-up {{ color: var(--up); font-weight: 600; }}
  .change-down {{ color: var(--down); font-weight: 600; }}
  .change-neutral {{ color: var(--muted); }}
  h2.section {{ font-size: 1.1rem; margin: 2rem 0 1rem; }}
  h2.section.with-sub {{ margin-bottom: 0.2rem; }}
  .section-count {{ color: var(--muted); font-weight: normal; font-size: 0.9rem; }}
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
{UI_CSS}
{CARD_CSS}
{TABLE_CSS}
{DOWNLOADS_CSS}
</style>
</head>
<body data-table-charts="{f'charts/table.json?v={table_charts_version}' if table_charts_version else ''}">
<h1>📢 马股自动分析报告</h1>
<p class="updated">更新时间: {now} (MYT)</p>
{build_downloads_html(downloads)}

<h2 class="section with-sub">筛选器 <span class="section-count">({len(cards)})</span></h2>
{TEMPLATE_BAR_HTML}
{build_screener_html(cards, chips)}

<h2 class="section">📋 其余股票 ({len(table_rows)})</h2>
<div class="table-toolbar">
  <input type="search" id="table-filter" placeholder="🔍 搜索代码或名称" autocomplete="off">
  <select id="table-sort" class="table-sort" aria-label="排序">
    <option value="5:desc" selected>成交量 ↓</option>
    <option value="4:desc">涨跌% ↓</option>
    <option value="4:asc">涨跌% ↑</option>
    <option value="6:desc">相对量 ↓</option>
    <option value="7:desc">RSI ↓</option>
    <option value="7:asc">RSI ↑</option>
    <option value="3:desc">价格 ↓</option>
    <option value="3:asc">价格 ↑</option>
    <option value="1:asc">名称 A→Z</option>
  </select>
  <span id="table-count" class="table-count"></span>
</div>
<p class="table-hint">双击任一行 (手机上点一下) 查看完整K线图、近 4 季 / 近 2 年财报和最近新闻</p>
<div class="table-wrap">
<table class="data-table" id="watchlist-table">
  <thead>
    <tr>
      <th data-type="none" class="idx-cell">#</th>
      <th data-type="text" class="stock-cell">股票 <span class="arrow"></span></th>
      <th data-type="none">走势</th>
      <th data-type="num" class="num">价格 <span class="arrow"></span></th>
      <th data-type="num" class="num">涨跌% <span class="arrow"></span></th>
      <th data-type="num" class="num" data-default-sort="desc" aria-sort="descending">成交量 <span class="arrow">▼</span></th>
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
  <p>K 线图: TradingView Lightweight Charts™ · Copyright (c) 2025 TradingView, Inc. · <a href="https://www.tradingview.com/" target="_blank" rel="noopener">https://www.tradingview.com/</a> (Apache License 2.0)</p>
  <p>行情数据来自公开渠道 (Yahoo Finance)，可能有延迟或错误，仅供个人研究参考，不构成投资建议。</p>
  <p>© {datetime.now(MYT).year} CJA231. All rights reserved. This report and the underlying strategy/code are proprietary; unauthorized reproduction or redistribution is prohibited.</p>
</footer>

<script id="chart-data" type="application/json">{chart_json}</script>
<script src="report.js?v={report_js_version()}"></script>
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
    返回 (quotes, equities)：quotes = {symbol: (price, volume)}；equities = {symbol: 名称}，只算普通股
    (跟 scripts/fetch_watchlist.py 同一个规则)，用来找出清单里还没有的新上市股票。
    screener 出错就返回两个空 dict，调用方会退回"逐支下载历史再判断"。
    """
    try:
        from yfinance import EquityQuery
        query = EquityQuery("eq", ["region", "my"])
        quotes, equities, offset = {}, {}, 0
        for _ in range(20):  # 安全上限
            result = yf.screen(query, offset=offset, size=SCREENER_PAGE_SIZE, sortField="ticker", sortAsc=True)
            page = result.get("quotes", [])
            for q in page:
                symbol, price, volume = q.get("symbol"), q.get("regularMarketPrice"), q.get("regularMarketVolume")
                if symbol and price is not None and volume is not None:
                    quotes[symbol] = (round(float(price), 3), int(volume))
                if symbol and q.get("quoteType") == "EQUITY":
                    equities[symbol] = q.get("shortName") or q.get("longName") or symbol
            offset += SCREENER_PAGE_SIZE
            if not page or offset >= result.get("total", 0):
                break
        return quotes, equities
    except Exception as e:
        print(f"⚠️ screener 预筛选失败 ({e})，改为逐支下载历史数据再判断成交量")
        return {}, {}


def build_scan_list(equities):
    """
    扫描范围 = data/watchlist.json 清单 + screener 里有、清单里还没有的普通股 (多半是新上市)。
    清单只有手动跑 scripts/fetch_watchlist.py 才会更新，以前新股要等有人更新清单才会被扫描到。
    另外新股刚上市时 Yahoo 还没有名称，清单里名字就是代码 (例如 0468.KL)，这里顺便换成 screener 的新名称。
    """
    scan, known = [], set()
    for item in WATCHLIST:
        name = item["name"]
        if name == item["symbol"] and equities.get(item["symbol"], name) != name:
            name = equities[item["symbol"]]
        scan.append({"symbol": item["symbol"], "name": name})
        known.add(item["symbol"])
    new = [{"symbol": sym, "name": name} for sym, name in sorted(equities.items()) if sym not in known]
    if new:
        shown = "、".join(f"{x['name']} ({x['symbol']})" for x in new[:10]) + (" …" if len(new) > 10 else "")
        print(f"🆕 screener 里有 {len(new)} 支清单里没有的股票 (多半是新上市)，一起扫描: {shown}")
    return scan + new


def fetch_stock(symbol):
    """线程池里跑的单支股票任务：日线 + 指标；会进表格的股票顺便抓日内走势 (塞在 data["intraday"] / ["intraday_bars"])。"""
    data = get_stock_data(symbol)
    if data and not data.get("low_volume") and not check_strategy(data)[0]:
        data["intraday"], data["intraday_bars"] = get_intraday(symbol)
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
    quotes, equities = prefetch_quotes()
    scan_list = build_scan_list(equities)
    prefiltered = {}
    for item in scan_list:
        q = quotes.get(item["symbol"])
        if q and q[1] < min_volume_for(q[0]):
            prefiltered[item["symbol"]] = {"symbol": item["symbol"], "low_volume": True, "close": q[0],
                                           "volume": q[1], "threshold": min_volume_for(q[0])}
    pre_secs = time.perf_counter() - t_pre
    print(f"screener 预筛选: 拿到 {len(quotes)} 支报价，其中 {len(prefiltered)} 支成交量不够、不用下载历史")

    # 第 2 步: 剩下的才并发下载 6 个月历史 + 算指标。screener 里没有的股票也走这一步 (在这里再判断成交量)。
    # 日线和日内走势放在同一个线程里抓：一支股票过了成交量门槛、又没命中信号 (会进表格)，就接着抓日内数据。
    t_fetch = time.perf_counter()
    symbols = [item["symbol"] for item in scan_list if item["symbol"] not in prefiltered]
    print(f"并发抓取 {len(symbols)} 支股票的历史数据 (并发数: {FETCH_WORKERS}) ...")
    with ThreadPoolExecutor(max_workers=FETCH_WORKERS) as executor:
        fetched_map = dict(zip(symbols, executor.map(fetch_stock, symbols)))
    fetched = [prefiltered.get(item["symbol"]) or fetched_map.get(item["symbol"]) for item in scan_list]
    fetch_secs = time.perf_counter() - t_fetch

    t_filter = time.perf_counter()
    stocks = []
    low_volume_by_tier = {}
    no_data = 0
    deepseek_calls = 0
    for item, data in zip(scan_list, fetched):
        symbol = item["symbol"]

        # 流动性门槛 (按价格分级，见 VOLUME_TIERS): 成交量不够的直接忽略，不放进报告
        if data and data.get("low_volume"):
            low_volume_by_tier[data["threshold"]] = low_volume_by_tier.get(data["threshold"], 0) + 1
            continue
        if data is None:
            no_data += 1

        intraday = data.pop("intraday", None) if data else None
        intraday_bars = data.pop("intraday_bars", None) if data else None
        matched, reason, ai_comment = False, None, None
        if data:
            matched, reason = check_strategy(data)
            if matched:
                # 防止 DeepSeek 限频：只在两次调用之间停 1 秒，最后一次调用之后不用等
                if deepseek_calls:
                    time.sleep(1)
                ai_comment = strip_trade_advice(ask_deepseek(data, reason))
                data["chart_history"] = get_chart_history(symbol)
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
            "intraday_bars": intraday_bars,
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

    # 双击"其余股票"看完整图表用的K线 + 个股资料 (财报、长期K线，一周刷新一次，每次补一批)。出错都不影响报告本身
    t_fin = time.perf_counter()
    table_charts_version = None
    try:
        table_charts_version = write_table_charts(stocks)
    except Exception as e:
        print(f"⚠️ 写表格股票K线失败 ({type(e).__name__}: {e})，这次双击看不了完整图表")
    try:
        tried, written, with_fin, pruned = refresh_details(stocks, today_myt)
        if tried or pruned:
            print(f"📊 个股资料 (财报 + 2 年日线 + 10 年月线): 这次抓 {tried} 支，写入 {written} 支，其中 {with_fin} 支 Yahoo 有财报"
                  + (f"，{tried - written} 支没拿到下次再试" if tried > written else "")
                  + (f"，删掉 {pruned} 个过期文件" if pruned else ""))
    except Exception as e:
        print(f"⚠️ 更新个股资料失败 ({type(e).__name__}: {e})")
    try:
        tried, written, with_items, pruned = refresh_news(stocks, datetime.now(MYT))
        if tried or pruned:
            print(f"📰 个股新闻: 这次抓 {tried} 支，写入 {written} 支，其中 {with_items} 支有最近 {NEWS_MAX_DAYS} 天的新闻"
                  + (f"，{tried - written} 支没拿到下次再试" if tried > written else "")
                  + (f"，删掉 {pruned} 个过期文件" if pruned else ""))
    except Exception as e:
        print(f"⚠️ 更新个股新闻失败 ({type(e).__name__}: {e})")
    fin_secs = time.perf_counter() - t_fin

    t_report = time.perf_counter()
    os.makedirs(os.path.dirname(REPORT_PATH), exist_ok=True)
    with open(REPORT_PATH, "w", encoding="utf-8") as f:
        f.write(build_html_report(stocks, downloads, table_charts_version))
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
          f"筛选+DeepSeek {filter_secs:.1f}s | 导出下载 {export_secs:.1f}s | 图表+财报+新闻 {fin_secs:.1f}s | 生成报告 {report_secs:.1f}s | 推送 {notify_secs:.1f}s | "
          f"总计 {time.perf_counter() - PROCESS_START:.1f}s")

if __name__ == "__main__":
    main()
