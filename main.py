import time
PROCESS_START = time.perf_counter()  # 用来算"导入库"花了多久 (pandas_ta 会带进 numba，导入本身就要几秒)

import os
import re
import json
import html
import math
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

# === 0. 市场设置 ===
# 马股 (MY) 和美股 (US) 共用同一套程序，两边不一样的地方全部写在这里。
# 用环境变量 MARKET 切换：MARKET=MY (默认，cron-job.org 的旧任务不传就是马股) / MARKET=US。
# 两个市场的报告放在不同目录，互不影响：马股 docs/ → https://cja231.github.io/Bursa-bot/，
# 美股 docs/us/ → https://cja231.github.io/Bursa-bot/us/；页面脚本 docs/report.js 两边共用 (市场差异看 <body> 的 data-*)。
MARKETS = {
    "MY": {
        "name": "马股",
        "title": "马股自动分析报告",
        "universe": "Bursa 全部上市股票 (Main + ACE)",
        "docs_dir": "docs",
        "url": "https://cja231.github.io/Bursa-bot/",
        "tz": "Asia/Kuala_Lumpur",
        "tz_label": "MYT",
        "currency": "MYR",
        "currency_symbol": "RM",
        "price_dp": 3,                # Bursa 最小跳动 0.005，价格显示 3 位小数
        "session_start": 9 * 60,      # 开市时间 (当地时间，距午夜几分钟)：日内K线从这里开始对齐合成 15 分、1 小时…
        "session_end": 17 * 60,       # 收市 (含收盘竞价)：这之前跑的报告标"盘中"，最新一根日线还没收完
        "lot_size": 100,              # 一手 = 100 股 (计算器、"一手金额"用)
        # 大盘指数 (Yahoo 代码, 显示名称)：页面顶部"今日市场"
        "indices": [("^KLSE", "富时综合指数 KLCI")],
        # 回测扣的来回交易成本 (%)：佣金 0.1% + 结算费 0.03% + 印花税 0.1%，买卖各一次 ≈ 0.46%，取 0.5%
        "round_trip_cost_pct": 0.5,
        "watchlist": os.path.join("data", "watchlist.json"),
        # 在 data/watchlist.json 还没生成之前使用 (马股代码记得加 .KL)
        "default_watchlist": [
            {"symbol": "1155.KL", "name": "Maybank 马银行"},
            {"symbol": "1023.KL", "name": "Public Bank 大众银行"},
            {"symbol": "5183.KL", "name": "Petronas Chemicals 国油化学"},
            {"symbol": "5296.KL", "name": "MR DIY"},
            {"symbol": "0083.KL", "name": "Press Metal 齐力工业"},
            {"symbol": "5168.KL", "name": "Hartalega 哈达维格"},
        ],
        # 流动性门槛 (按价格分级)：日成交量低于门槛的股票直接忽略，不进报告、也不参与信号判断
        # 低价股要求更高的成交量，过滤掉交投清淡、容易被少量资金拉动的仙股
        "volume_tiers": [
            (0.10, 5_000_000),   # 价格 < 0.10          → 成交量至少 5M
            (0.20, 3_000_000),   # 0.10 ≤ 价格 < 0.20   → 至少 3M
            (0.50, 1_000_000),   # 0.20 ≤ 价格 ≤ 0.50   → 至少 1M (0.50 本身也算在这一档)
        ],
        "min_volume": 500_000,        # 其余价格 (> 0.50) 的门槛
        "min_turnover": None,         # 马股按成交量 (股数) 分级，不看成交额
        "screener": {"region": "my"},
        "trading_ref": "1155.KL",     # 马银行，流动性最好，用它判断今天有没有开市
        "news": {"hl": "en-MY", "gl": "MY", "ceid": "MY:en", "fallback": "Bursa"},
        "analyst": "马来西亚股市",
        "file_prefix": "bursa-report",
        "search_hint": "例如 CYPARK / 5184",
        "detail_per_run": 30,         # 一天跑 10 次，每次补 30 支个股资料就够
        "news_per_run": 40,
        "ann_per_run": 40,            # 公司公告 (Bursa 官网)：每次补几支
    },
    "US": {
        "name": "美股",
        "title": "美股自动分析报告",
        "universe": "市值 ≥ 100 亿美元的美股 (纽交所 / 纳斯达克)",
        "docs_dir": os.path.join("docs", "us"),
        "url": "https://cja231.github.io/Bursa-bot/us/",
        "tz": "America/New_York",     # 夏令时自动处理 (日内K线时间也按当天的 UTC 偏移换算，见 local_epoch)
        "tz_label": "美东时间",
        "currency": "USD",
        "currency_symbol": "US$",
        "price_dp": 2,
        "session_start": 9 * 60 + 30,
        "session_end": 16 * 60,
        "lot_size": 1,
        "indices": [("^GSPC", "标普 500"), ("^IXIC", "纳斯达克综合"), ("^VIX", "VIX 波动率")],
        # 美股佣金一般是每笔固定几美元，按常见单笔金额折算，来回约 0.1%
        "round_trip_cost_pct": 0.1,
        # 没有清单文件：扫描范围直接用下面 screener 的结果 (每次运行都按最新市值重新找)；
        # screener 出错时才退回这几支大型股，报告至少还能生成
        "watchlist": None,
        "default_watchlist": [
            {"symbol": "AAPL", "name": "Apple"},
            {"symbol": "MSFT", "name": "Microsoft"},
            {"symbol": "NVDA", "name": "NVIDIA"},
            {"symbol": "AMZN", "name": "Amazon"},
            {"symbol": "GOOGL", "name": "Alphabet"},
            {"symbol": "META", "name": "Meta Platforms"},
        ],
        # 美股股价从几美元到几十万美元都有，用股数分级不合理，改看成交额 (价格 × 股数)：
        # 门槛股数 = 最低成交额 ÷ 价格 (见 min_volume_for)
        "volume_tiers": [],
        "min_volume": 1_000_000,      # 只有价格异常 (≤ 0) 时才用得到
        "min_turnover": 20_000_000,   # 日成交额至少 2000 万美元
        # 只要纽交所 / 纳斯达克挂牌的普通股 (不要场外 OTC)，市值 ≥ 100 亿美元 (约 700 支)
        "screener": {"region": "us", "exchanges": ["NYQ", "NMS", "NGM", "NCM", "ASE"], "min_market_cap": 10_000_000_000},
        "trading_ref": "SPY",
        "news": {"hl": "en-US", "gl": "US", "ceid": "US:en", "fallback": "stock"},
        "analyst": "美国股市",
        "file_prefix": "us-report",
        "search_hint": "例如 AAPL / NVDA",
        # 一天只跑一次、股票又多 (700–850 支)，每次多补一些。个股资料一支要十来个 Yahoo 请求：
        # 9/24 头两次美股 run 各补 120 支，只写入 62 / 51 支，其余被 Yahoo 限流 (Too Many Requests)，
        # 所以改成 50 (没拿到的下次运行排在前面再试)；新闻走 Google News，两次都是 120 支全部成功
        "detail_per_run": 50,
        "news_per_run": 120,
        "ann_per_run": 80,            # 公司公告 (SEC EDGAR)：SEC 限每秒 10 个请求，一次 80 支约 15 秒
    },
}
MARKET_ID = (os.environ.get("MARKET") or "MY").strip().upper()
if MARKET_ID not in MARKETS:
    raise SystemExit(f"环境变量 MARKET={MARKET_ID!r} 不认识，只能是 {' / '.join(MARKETS)}")
MKT = MARKETS[MARKET_ID]

LOCAL_TZ = ZoneInfo(MKT["tz"])       # 交易所当地时间 (马股 MYT，美股美东时间)
DOCS_ROOT = "docs"                   # GitHub Pages 的根目录：report.js、vendor/ 放在这里，两个市场共用
DOCS_DIR = MKT["docs_dir"]           # 这个市场的报告、下载文件、K线/财报/新闻都放在这下面
# 页面引用 report.js、vendor/ 的相对路径前缀：马股页面在根目录 ("")，美股页面在 us/ 下面 ("../")
ASSET_PREFIX = "" if os.path.normpath(DOCS_DIR) == os.path.normpath(DOCS_ROOT) else \
    os.path.relpath(DOCS_ROOT, DOCS_DIR).replace(os.sep, "/") + "/"
PRICE_DP = MKT["price_dp"]
PRICE_PATTERN = "{:." + str(PRICE_DP) + "f}"
CURRENCY_SYMBOL = MKT["currency_symbol"]


def fmt_price(v):
    """价格按市场的位数显示 (马股 3 位、美股 2 位)"""
    return PRICE_PATTERN.format(v)


# === 1. 配置区域 ===
DEFAULT_WATCHLIST = MKT["default_watchlist"]
WATCHLIST_PATH = MKT["watchlist"]


def load_watchlist():
    # 马股优先用 scripts/fetch_watchlist.py 生成的全市场清单，
    # 还没跑过那个脚本时 (或文件为空) 就退回默认的 6 支股票，确保 bot 不会因此坏掉。
    # 美股没有清单文件，返回空清单：扫描范围直接用 screener 的结果 (见 build_scan_list)
    if not WATCHLIST_PATH:
        return []
    try:
        with open(WATCHLIST_PATH, encoding="utf-8") as f:
            watchlist = json.load(f)
        if watchlist:
            return watchlist
    except (FileNotFoundError, json.JSONDecodeError):
        pass
    return DEFAULT_WATCHLIST


WATCHLIST = load_watchlist()

REPORT_PATH = os.path.join(DOCS_DIR, "index.html")
REPORT_URL = MKT["url"]
CHART_HISTORY_DAYS = 90  # 图表显示最近约 90 个交易日
# 流动性门槛 (见 MARKETS 里的说明)：马股按价格分级的成交量，美股按成交额
VOLUME_TIERS = MKT["volume_tiers"]
MIN_DAILY_VOLUME = MKT["min_volume"]
MIN_TURNOVER = MKT["min_turnover"]


def min_volume_for(price):
    """日成交量 (股数) 门槛。美股 = 最低成交额 ÷ 价格；马股按价格分级"""
    if MIN_TURNOVER:
        return math.ceil(MIN_TURNOVER / price) if price > 0 else MIN_DAILY_VOLUME
    for upper, min_vol in VOLUME_TIERS:
        if price < upper or (upper == 0.50 and price == 0.50):
            return min_vol
    return MIN_DAILY_VOLUME


def volume_rule_text(threshold):
    """日志里"⏭️ …被忽略"那一行的说明。美股每支股票的门槛股数都不一样 (按价格算)，只写成交额"""
    if MIN_TURNOVER:
        return f"成交额低于 {CURRENCY_SYMBOL}{MIN_TURNOVER / 1e6:,.0f}M"
    return f"成交量低于 {threshold:,}"

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

# === 回测：后台策略过去 6 个月每一次信号之后的表现 ===
# 用的就是每次运行本来就下载的那 6 个月日线 (不多发请求)，每一天都用"跟 check_strategy 一模一样"的条件判断：
#   第 i 天收盘时 EMA20 多头 + SAR 多头 + T3 形态突破 → 信号；隔天 (i+1) 开盘价计入；
#   之后哪天收盘跌到 SAR 以下 (SAR 转空) 就在那天收盘结算，最多拿 BT_MAX_HOLD 个交易日；
#   同一支股票一笔还没结算时出现的新信号不重复算。收益扣掉来回交易成本 (MKT["round_trip_cost_pct"])。
# 另外按固定天数 (5 / 10 / 20 天) 看信号之后的涨跌，跟"同期任意一天买进"的平均做对比 (看信号有没有比随便买好)。
# ⚠️ 只统计今天进报告的股票 (成交量达标)，有幸存者偏差；历史统计不代表未来。
BT_MAX_HOLD = 20
BT_HORIZONS = (5, 10, 20)
BT_RECENT_BARS = 20       # "最近信号"列出最近 20 个交易日里出现过的信号
BT_COST_PCT = MKT["round_trip_cost_pct"]


def t3_flags(df):
    """detect_t3_pattern 的逐日版本：第 i 天 (看到第 i 天为止的数据) 是不是 T3 形态突破。条件跟 detect_t3_pattern 完全一样。"""
    n = len(df)
    flags = [False] * n
    if n < 26:
        return flags
    vol_avg20 = df["Volume"].rolling(20).mean().shift(1).tolist()
    high, close, vol = df["High"].tolist(), df["Close"].tolist(), df["Volume"].tolist()
    for i in range(25, n):
        for offset in range(2, 6):
            t1 = i - offset
            if t1 < 20:
                continue
            avg = vol_avg20[t1]
            if avg != avg or vol[t1] <= avg:  # NaN 或没放量
                continue
            h1 = high[t1]
            if any(h >= h1 for h in high[t1 + 1:i]):
                continue
            if close[i] > h1:
                flags[i] = True
                break
    return flags


def backtest_stock(df):
    """一支股票的逐日信号 + 模拟交易。df 已经算好 EMA_20 / PSAR。返回 {"trades": [...], "base": {天数: [收益总和, 次数, 上涨次数]}}"""
    n = len(df)
    out = {"trades": [], "base": {h: [0.0, 0, 0] for h in BT_HORIZONS}}
    if n < 27 or "EMA_20" not in df.columns or "PSAR" not in df.columns:
        return out
    dates = [d.strftime("%Y-%m-%d") for d in df.index]
    out["from"] = dates[25]
    o, h, l, c = df["Open"].tolist(), df["High"].tolist(), df["Low"].tolist(), df["Close"].tolist()
    ema, sar = df["EMA_20"].tolist(), df["PSAR"].tolist()
    t3 = t3_flags(df)

    def ok(x):
        return x is not None and x == x

    def bull(i):  # 跟 get_stock_data / check_strategy 一样先四舍五入到 3 位再比
        return ok(sar[i]) and round(float(c[i]), 3) > round(float(sar[i]), 3)

    def signal(i):
        return ok(ema[i]) and round(float(c[i]), 3) > round(float(ema[i]), 3) and bull(i) and t3[i]

    # 同期基准: 第 25 天之后任意一天收盘"买进" (隔天开盘价计入)，持有 N 天的涨跌
    for i in range(25, n - 1):
        entry = o[i + 1]
        if not ok(entry) or entry <= 0:
            continue
        for hz in BT_HORIZONS:
            j = i + hz
            if j < n and ok(c[j]):
                r = (c[j] / entry - 1) * 100
                b = out["base"][hz]
                b[0] += r
                b[1] += 1
                b[2] += r > 0

    i = 25
    while i < n - 1:  # 最后一天的信号 = 今天的信号，还没有"隔天开盘"，不算进回测
        if not signal(i):
            i += 1
            continue
        e = i + 1
        entry = o[e]
        if not ok(entry) or entry <= 0:
            i += 1
            continue
        hi, lo = h[e], l[e]
        j = e
        reason = "open"
        while True:
            hi, lo = max(hi, h[j]), min(lo, l[j])
            if not bull(j):
                reason = "sar"
                break
            if j - e + 1 >= BT_MAX_HOLD:
                reason = "time"
                break
            if j == n - 1:
                break
            j += 1
        ret = (c[j] / entry - 1) * 100
        horizons = {}
        for hz in BT_HORIZONS:
            k = e + hz - 1
            horizons[hz] = round((c[k] / entry - 1) * 100, 2) if k < n and ok(c[k]) else None
        risk = (entry - sar[i]) / entry * 100 if ok(sar[i]) else None
        out["trades"].append({
            "sig": dates[i], "sig_ago": n - 1 - i, "entry": round(float(entry), 4), "exit": round(float(c[j]), 4),
            "exit_date": dates[j], "days": j - e + 1, "reason": reason, "ret": round(ret, 2),
            "mfe": round((hi / entry - 1) * 100, 2), "mae": round((lo / entry - 1) * 100, 2),
            "risk": round(risk, 2) if risk is not None and risk > 0 else None, "h": horizons,
        })
        i = j + 1
    return out


def _median(xs):
    xs = sorted(xs)
    if not xs:
        return None
    m = len(xs) // 2
    return xs[m] if len(xs) % 2 else (xs[m - 1] + xs[m]) / 2


BT_DIST_EDGES = (-10, -5, 0, 5, 10)  # 收益分布: < -10%、-10~-5、-5~0、0~5、5~10、> 10%


def summarize_backtest(stocks):
    """把每支股票的回测合起来 → 页面上"策略回测"区块要的数字。没有任何一笔 (例如新市场第一次跑) 返回 None"""
    closed, opened, recent = [], [], []
    base = {h: [0.0, 0, 0] for h in BT_HORIZONS}
    first_day, last_day, n_stocks = None, None, 0
    for st in stocks:
        data = st.get("data")
        bt = data and data.get("backtest")
        if not bt:
            continue
        n_stocks += 1
        if bt.get("from"):
            first_day = min(first_day or bt["from"], bt["from"])
        for hz, (tot, cnt, win) in bt["base"].items():
            base[hz][0] += tot
            base[hz][1] += cnt
            base[hz][2] += win
        for tr in bt["trades"]:
            tr = dict(tr, code=st["symbol"].split(".")[0], name=st["name"])
            (opened if tr["reason"] == "open" else closed).append(tr)
            if tr["sig_ago"] <= BT_RECENT_BARS:
                recent.append(tr)
        candles = data.get("candles") or []
        if candles:
            last_day = max(last_day or candles[-1]["time"], candles[-1]["time"])
    trades = closed + opened
    if not trades and not any(b[1] for b in base.values()):
        return None
    cost = BT_COST_PCT
    nets = [t["ret"] - cost for t in closed]
    wins = [x for x in nets if x > 0]
    losses = [x for x in nets if x <= 0]
    max_streak = streak = 0
    for t in sorted(closed, key=lambda t: t["exit_date"]):
        streak = streak + 1 if t["ret"] - cost <= 0 else 0
        max_streak = max(max_streak, streak)
    dist = [0] * (len(BT_DIST_EDGES) + 1)
    for x in nets:
        dist[sum(1 for edge in BT_DIST_EDGES if x >= edge)] += 1
    horizons = []
    for hz in BT_HORIZONS:
        rs = [t["h"][hz] for t in trades if t["h"].get(hz) is not None]
        tot, cnt, win = base[hz]
        horizons.append({
            "h": hz, "n": len(rs),
            "avg": round(sum(rs) / len(rs), 2) if rs else None,
            "median": round(_median(rs), 2) if rs else None,
            "win": round(sum(1 for r in rs if r > 0) / len(rs) * 100, 1) if rs else None,
            "base_avg": round(tot / cnt, 2) if cnt else None,
            "base_win": round(win / cnt * 100, 1) if cnt else None,
            "base_n": cnt,
        })
    risks = [t["risk"] for t in closed if t["risk"]]
    r_multiples = [(t["ret"] - cost) / t["risk"] for t in closed if t["risk"]]
    return {
        "stocks": n_stocks, "trades": len(trades), "closed": len(closed), "open": len(opened),
        "from": first_day, "to": last_day, "cost": cost, "max_hold": BT_MAX_HOLD,
        "win_rate": round(len(wins) / len(nets) * 100, 1) if nets else None,
        "avg": round(sum(nets) / len(nets), 2) if nets else None,
        "median": round(_median(nets), 2) if nets else None,
        "avg_win": round(sum(wins) / len(wins), 2) if wins else None,
        "avg_loss": round(sum(losses) / len(losses), 2) if losses else None,
        "payoff": round((sum(wins) / len(wins)) / abs(sum(losses) / len(losses)), 2) if wins and losses and sum(losses) else None,
        "pf": round(sum(wins) / abs(sum(losses)), 2) if wins and losses and sum(losses) else None,
        "avg_days": round(sum(t["days"] for t in closed) / len(closed), 1) if closed else None,
        "best": round(max(nets), 2) if nets else None,
        "worst": round(min(nets), 2) if nets else None,
        "max_streak": max_streak,
        "exit_sar": sum(1 for t in closed if t["reason"] == "sar"),
        "exit_time": sum(1 for t in closed if t["reason"] == "time"),
        "mfe_median": round(_median([t["mfe"] for t in closed]), 2) if closed else None,
        "mae_median": round(_median([t["mae"] for t in closed]), 2) if closed else None,
        "risk_median": round(_median(risks), 2) if risks else None,
        "avg_r": round(sum(r_multiples) / len(r_multiples), 2) if r_multiples else None,
        "dist": dist, "horizons": horizons,
        "recent": sorted(recent, key=lambda t: (t["sig_ago"], -t["ret"]))[:40],
    }


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
            for name, kwargs in (("rsi", {"length": 14}), ("sma", {"length": 50}), ("ema", {"length": 20}), ("psar", {}), ("atr", {"length": 14})):
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
            # 成交额 = 价格 × 股数 (马股仙股动辄几亿股，按股数排会误导，表格默认按成交额排)；前 20 天平均成交额 (不含今天)
            turnover = (df["Close"] * df["Volume"])
            turnover_avg20 = turnover.iloc[-21:-1].mean() if history_days > 1 else None
            atr_col = next((col for col in df.columns if col.startswith("ATRr_") or col.startswith("ATR_")), None)
            atr = value(atr_col, ndigits=6) if atr_col else None
            # 新股: 从第一根日线算起上市几天 (日历天)；历史够长的股票不需要
            listed_days = None
            if history_days < CHART_HISTORY_DAYS:
                listed_days = (datetime.now(LOCAL_TZ).date() - df.index[0].date()).days + 1

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
                "listed_days": listed_days,
                "turnover": round(float(turnover.iloc[-1]), 2),
                "turnover_avg20": round(float(turnover_avg20), 2) if turnover_avg20 is not None and pd.notna(turnover_avg20) else None,
                "atr_pct": round(atr / close * 100, 2) if atr and close else None,
                "sar": psar_now,
                "backtest": backtest_stock(df),
                "daily_bars": compact_bars(df, intraday=False),  # 点开看完整图表 + 网页上的选股条件用 (只有表格股票会写进 table.json)
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


def local_epoch(ts):
    """日内K线的时间 → "交易所当地钟点当成 UTC" 的秒级时间戳，图表按 UTC 显示时刚好就是当地时间。
    马股固定 +8 小时；美股夏令时 -4、冬令时 -5，按每一根K线自己那天的偏移算 (tz_convert 会处理夏令时)。"""
    ts = pd.Timestamp(ts)
    if ts.tzinfo is None:
        ts = ts.tz_localize("UTC")
    return int(ts.timestamp()) + int(ts.tz_convert(LOCAL_TZ).utcoffset().total_seconds())


def bars_payload(df, intraday):
    """DataFrame → 网页用的列式数组 {t,o,h,l,c,v} (比一根K线一个对象省一半以上体积)。
    时间用秒级时间戳：日内K线换成当地钟点 (local_epoch)；日线以上用当天 00:00 UTC。"""
    df = df.dropna(subset=["Open", "High", "Low", "Close"])
    if intraday:
        t = [local_epoch(ts) for ts in df.index]
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
    收盘价给表格的迷你走势图，精简K线给"点表格看完整图表"的日内周期用。拿不到就返回 (None, None)。"""
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
    "其余股票"点开看完整图表 (以及网页上的自定义选股条件) 用的精简K线
    (全部表格股票放在同一个 docs/charts/table.json，用到时才下载)：
    价格 ×1000 存成整数 (Bursa 最小跳动 0.005，美股 0.01，3 位小数足够)；时间只存第一根 + 每根的间隔
    (日线以天、日内以分钟为单位)。比 bars_payload 那种完整时间戳 + 小数小一半以上。
    """
    df = df.dropna(subset=["Open", "High", "Low", "Close"])
    if df.empty:
        return None
    if intraday:
        ts, unit = [local_epoch(x) for x in df.index], 60
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


CHARTS_DIR = os.path.join(DOCS_DIR, "charts")
TABLE_CHARTS_FILE = os.path.join(CHARTS_DIR, "table.json")
DOWNLOADS_DIR = os.path.join(DOCS_DIR, "downloads")


def write_table_charts(stocks):
    """把"其余股票"每一支的 6 个月日线 + 当天 5 分钟线写进 <市场目录>/charts/table.json。
    网页里点开某一行、或者模板里有选股条件时才下载这个文件 (整页不会因此变大)；
    返回文件内容的短哈希，放在网址后面防止浏览器用旧缓存。"""
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


# ---- 每支股票的详细资料: 近 4 季 + 近 2 年财报、2 年日线 + 10 年月线，存在 <市场目录>/stock/<代码>.json ----
# 点开"其余股票"的一行 (或点卡片上的"完整图表 · 财报") 时才下载。财报一季才变一次，长期K线里
# 最近 6 个月以外的部分也不会再变 (最近 6 个月每次运行都写在 table.json 里，网页打开时拼在一起)，
# 所以每支一周抓一次就够。每次运行只补一小批 (DETAIL_PER_RUN 支)，不会拖慢运行：
# 马股第一天跑几次就补齐全部表格股票，之后每周轮着刷新；美股一天只跑一次，每次多补一些。
DETAIL_DIR = os.path.join(DOCS_DIR, "stock")
DETAIL_MAX_AGE_DAYS = 7    # 有财报的: 一周刷新一次
DETAIL_RETRY_DAYS = 2      # Yahoo 没给财报的: 两天后再试 (可能只是那次请求被限流，不想一错就等一周)
DETAIL_PRUNE_DAYS = 30     # 超过 30 天没更新、这次也不在报告里的 (早就跌出成交量门槛了) 删掉
DETAIL_PER_RUN = MKT["detail_per_run"]
DETAIL_WORKERS = 8
DETAIL_HISTORY = (("d", "2y", "1d"), ("m", "10y", "1mo"))  # 跟筛选器卡片一样长
FIN_QUARTERS = 8  # 网页上显示最近 4 季；更早的留着算"较去年同季" (Yahoo 一般只给 5 季左右)
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
    # info: 公司全名 (搜新闻用，简称像 "JAG"、"SDG" 太容易搜到别的东西) + 财报货币 (马股大多是令吉，少数用美元报告；美股大多是美元)
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



# ---- 个股新闻: 最近的新闻标题 + 链接，存在 <市场目录>/news/<代码>.json，每支半天更新一次 ----
# 只存标题、来源、时间和原文链接 (不转载内文)。主要用 Google News RSS 按公司全名搜 (比 Yahoo 的个股新闻准，
# Yahoo 对马股小公司常常给一堆无关的大盘新闻)；Google 那边拿不到时才退回 Yahoo。
NEWS_DIR = os.path.join(DOCS_DIR, "news")
NEWS_MAX_AGE_HOURS = 12
NEWS_PER_RUN = MKT["news_per_run"]
NEWS_WORKERS = 8
NEWS_KEEP = 8
NEWS_MAX_DAYS = 90
NEWS_PRUNE_DAYS = 30
GOOGLE_NEWS_RSS = "https://news.google.com/rss/search"
# 公司全名结尾的公司形式 (只去掉最后一个)：马股 Berhad / Bhd，美股 Inc / Corp / Co / Ltd / plc / N.V. …
COMPANY_SUFFIX_RE = re.compile(
    r"[\s,.&]*\b(berhad|bhd|inc|incorporated|corp|corporation|co|company|ltd|limited|plc|n\.?\s?v|s\.?\s?a|ag|se)\.?\s*$", re.I)


# 标题里带别的交易所代码的新闻多半是同名的外国公司 (例如马股 NEXG 搜到加拿大的 "NexGold Mining (TSXV:NEXG)")，直接丢掉
FOREIGN_TICKER_RE = re.compile(
    r"\((?:TSXV?|CSE|ASX|LSE|AIM|HKEX|HKG|SGX|NSE|BSE|JSE|NZX|TSE|OTC\w*"
    + ("|NYSE|NASDAQ|AMEX|NYSEAMERICAN" if MARKET_ID == "MY" else "|KLSE|BURSA|MYX") + r")\s*:", re.I)


def news_query(name, long_name):
    """搜索词: 有全名就用全名 (去掉 Berhad / Inc 这类结尾，新闻里两种写法都有)，没有就用简称 + Bursa (美股是 stock)"""
    if long_name:
        base = COMPANY_SUFFIX_RE.sub("", long_name).strip()
        if len(base) >= 4:
            return f'"{base}"'
    return f'"{name}" {MKT["news"]["fallback"]}'


def google_news(query):
    """Google News RSS → [{title, source, link, time}]；请求失败会抛异常 (调用的地方决定要不要重试)"""
    import xml.etree.ElementTree as ET
    from email.utils import parsedate_to_datetime
    region = MKT["news"]
    r = requests.get(GOOGLE_NEWS_RSS, params={"q": f"{query} when:{NEWS_MAX_DAYS}d", "hl": region["hl"], "gl": region["gl"], "ceid": region["ceid"]},
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
        if key in seen or (it["time"] and it["time"] < oldest) or FOREIGN_TICKER_RE.search(it["title"]):
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

# ---- 公司公告：马股 = Bursa 官网公告，美股 = SEC EDGAR 申报文件，存在 <市场目录>/ann/<代码>.json ----
# 只存日期、标题、分类和官方原文链接。每次运行补 ANN_PER_RUN 支 (信号在前，其余按成交额)，每支半天更新一次；
# 页面上的"公司公告"栏 = 报告里的股票最近 ANN_BOARD_DAYS 天的公告 (马股另外再抓一次全市场最新公告，当天的公告来得更快)。
# 抓不到 (网站挡了、格式变了) 不影响报告，页面上照样给官方公告页的链接。
ANN_DIR = os.path.join(DOCS_DIR, "ann")
ANN_MAX_AGE_HOURS = 12
ANN_PER_RUN = MKT["ann_per_run"]
ANN_WORKERS = 4
ANN_KEEP = 15
ANN_MAX_DAYS = 180
ANN_PRUNE_DAYS = 30
ANN_BOARD_DAYS = 14
ANN_BOARD_MAX = 60
BURSA_ANN_API = "https://www.bursamalaysia.com/api/v1/announcements/search"
BURSA_ANN_PAGE = "https://www.bursamalaysia.com/market_information/announcements/company_announcement"
BURSA_ANN_DETAIL = BURSA_ANN_PAGE + "/announcement_details?ann_id="
BURSA_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "X-Requested-With": "XMLHttpRequest",
    "Referer": BURSA_ANN_PAGE,
}
# SEC 要求 User-Agent 写明是谁在抓 (没写会被挡)；想换成自己的联络方式可以在 workflow 里设环境变量 SEC_USER_AGENT
SEC_HEADERS = {"User-Agent": os.environ.get("SEC_USER_AGENT") or "Bursa-bot stock report github.com/CJA231/Bursa-bot",
               "Accept-Encoding": "gzip, deflate"}
SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
SEC_SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{:010d}.json"

# 公告分类 (按标题关键字，先对上的先算)：页面上的筛选按钮
ANN_CATS = [
    ("results", "财报"), ("dividend", "派息·权益"), ("corporate", "企业活动"), ("holding", "持股变动"),
    ("buyback", "回购"), ("uma", "异常交易"), ("people", "人事"), ("meeting", "会议·年报"), ("other", "其他"),
]
BURSA_CAT_RULES = [
    ("uma", r"unusual market activity|\bUMA\b|\bquery\b"),
    ("results", r"quarterly r(?:e)?p(?:or)?t|financial result|financial statement|interim report|audited account"),
    ("dividend", r"entitlement|dividend|distribution"),
    ("buyback", r"buy[\s-]?back"),
    ("holding", r"substantial shareholder|change in sub|changes? in director|director'?s interest|shareholding|"
                r"notice of (?:interest|person ceasing)|interest in securities"),
    ("people", r"change in (?:boardroom|principal officer|audit committee|company secretary|chief)"),
    ("meeting", r"annual report|general meeting|\bAGM\b|\bEGM\b"),
    ("corporate", r"transaction|acquisition|disposal|proposal|placement|rights issue|bonus|merger|contract|award|"
                  r"memorandum|\bMOU\b|joint venture|listing|conversion|warrant|expiry|redemption"),
]
SEC_FORMS = {  # 只收这些 (内部人交易 Form 4、银行的结构性票据 424B2 之类太多太杂，不列)
    "8-K": "8-K 重大事件", "10-Q": "10-Q 季报", "10-K": "10-K 年报", "20-F": "20-F 年报 (外国公司)",
    "40-F": "40-F 年报 (加拿大公司)", "6-K": "6-K 外国公司报告", "DEF 14A": "DEF 14A 股东大会委托书",
    "SC 13D": "13D 大股东持股", "SC 13G": "13G 大股东持股", "SCHEDULE 13D": "13D 大股东持股", "SCHEDULE 13G": "13G 大股东持股",
    "S-1": "S-1 证券发行登记", "S-3": "S-3 证券发行登记", "S-4": "S-4 并购相关证券登记",
}
SEC_FORM_CATS = {"10-Q": "results", "10-K": "results", "20-F": "results", "40-F": "results", "DEF 14A": "meeting",
                 "SC 13D": "holding", "SC 13G": "holding", "SCHEDULE 13D": "holding", "SCHEDULE 13G": "holding",
                 "S-1": "corporate", "S-3": "corporate", "S-4": "corporate", "6-K": "other"}
SEC_8K_ITEMS = {
    "1.01": ("签订重大协议", "corporate"), "1.02": ("终止重大协议", "corporate"), "2.01": ("完成收购 / 出售资产", "corporate"),
    "2.02": ("业绩公告", "results"), "2.03": ("新增债务", "corporate"), "2.05": ("重组 / 裁员", "corporate"),
    "2.06": ("资产减值", "results"), "3.01": ("上市地位通知", "other"), "3.02": ("发行未登记股票", "corporate"),
    "5.02": ("董事 / 高管变动", "people"), "5.03": ("修改公司章程", "other"), "5.07": ("股东投票结果", "meeting"),
    "7.01": ("公开披露 (Reg FD)", "other"), "8.01": ("其他事件", "other"),
}


def ann_category(title):
    for cat, pattern in BURSA_CAT_RULES:
        if re.search(pattern, title, re.I):
            return cat
    return "other"


def _strip_tags(x):
    return " ".join(html.unescape(re.sub(r"<[^>]+>", " ", x or "")).split())


def parse_bursa_row(row):
    """Bursa 公告搜索 API 的一行 (几段 HTML 字符串) → {id, date, title, code, company, link, cat}；认不出来返回 None。
    格式没有官方文档，这里尽量宽松：从整行里找 ann_id=数字 的链接当标题、"24 Sep 2026" 这种日期、stock_code=代码"""
    blob = " ".join(str(x) for x in (row.values() if isinstance(row, dict) else row if isinstance(row, (list, tuple)) else [row]))
    m = re.search(r"<a[^>]*ann_id=(\d+)[^>]*>(.*?)</a>", blob, re.S | re.I)
    if not m:
        return None
    title = _strip_tags(m.group(2))
    d = re.search(r"\b(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})\b", blob)
    date = None
    if d:
        try:
            date = datetime.strptime(f"{d.group(1)} {d.group(2).title()} {d.group(3)}", "%d %b %Y").strftime("%Y-%m-%d")
        except ValueError:
            date = None
    code = re.search(r"stock_code=([0-9A-Z]+)", blob)
    comp = re.search(r"<a[^>]*stock_code=[0-9A-Z]+[^>]*>(.*?)</a>", blob, re.S | re.I)
    if not title or not date:
        return None
    return {"id": m.group(1), "date": date, "title": title, "code": code.group(1) if code else None,
            "company": _strip_tags(comp.group(1)) if comp else None, "link": BURSA_ANN_DETAIL + m.group(1), "cat": ann_category(title)}


def bursa_announcements(company="", per_page=20, page=1):
    params = {"ann_type": "company", "keyword": "", "dt_ht": "", "dt_lt": "", "company": company, "mkt": "", "sec": "",
              "subsec": "", "per_page": per_page, "page": page}
    r = requests.get(BURSA_ANN_API, params=params, headers=BURSA_HEADERS, timeout=15)
    r.raise_for_status()
    rows = r.json().get("data") or []
    items = [x for x in (parse_bursa_row(row) for row in rows) if x]
    if rows and not items:
        raise ValueError("Bursa 公告格式认不出来 (网站可能改版了)")
    return items


_SEC_CIKS = None


def sec_cik_map():
    """SEC 的 代码 → CIK 对照表 (一次运行只下载一次)"""
    global _SEC_CIKS
    if _SEC_CIKS is None:
        r = requests.get(SEC_TICKERS_URL, headers=SEC_HEADERS, timeout=20)
        r.raise_for_status()
        _SEC_CIKS = {str(v["ticker"]).upper(): int(v["cik_str"]) for v in r.json().values()}
    return _SEC_CIKS


def sec_filings(ticker):
    cik = sec_cik_map().get(ticker.upper()) or sec_cik_map().get(ticker.upper().replace("-", "."))
    if not cik:
        return []
    r = requests.get(SEC_SUBMISSIONS_URL.format(cik), headers=SEC_HEADERS, timeout=15)
    r.raise_for_status()
    rec = (r.json().get("filings") or {}).get("recent") or {}
    forms, dates, accs = rec.get("form") or [], rec.get("filingDate") or [], rec.get("accessionNumber") or []
    docs, items8k = rec.get("primaryDocument") or [], rec.get("items") or []
    out = []
    for i, form in enumerate(forms):
        base = form[:-2] if form.endswith("/A") else form
        if base not in SEC_FORMS or i >= len(dates) or i >= len(accs):
            continue
        acc = accs[i].replace("-", "")
        doc = docs[i] if i < len(docs) and docs[i] else f"{accs[i]}-index.htm"
        title, cat = SEC_FORMS[base] + (" (修正)" if form.endswith("/A") else ""), SEC_FORM_CATS.get(base, "other")
        if base == "8-K":
            codes = [x.strip() for x in (items8k[i] if i < len(items8k) else "").split(",") if x.strip() and x.strip() != "9.01"]
            labels = [SEC_8K_ITEMS[x][0] for x in codes if x in SEC_8K_ITEMS]
            if labels:
                title = "8-K " + "、".join(labels)
            cat = next((SEC_8K_ITEMS[x][1] for x in codes if x in SEC_8K_ITEMS), "other")
        out.append({"date": dates[i], "title": title, "link": f"https://www.sec.gov/Archives/edgar/data/{cik}/{acc}/{doc}", "cat": cat})
    return out


def ann_official_page(code):
    if MARKET_ID == "US":
        return "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&owner=include&count=40&CIK=" + code
    return BURSA_ANN_PAGE + "?company=" + code


def fetch_announcements(symbol, now):
    code = symbol.split(".")[0]
    if MARKET_ID == "US":
        items, source = sec_filings(code), "SEC EDGAR"
        time.sleep(0.3)  # SEC 限每秒 10 个请求 (4 个线程各停 0.3 秒，大约每秒 8 个)
    else:
        items, source = bursa_announcements(company=code), "Bursa Malaysia"
    oldest = (now.date() - pd.Timedelta(days=ANN_MAX_DAYS)).strftime("%Y-%m-%d")
    seen, keep = set(), []
    for it in sorted(items, key=lambda x: x["date"], reverse=True):
        if it["date"] < oldest or it["link"] in seen:
            continue
        seen.add(it["link"])
        keep.append({k: it[k] for k in ("date", "title", "link", "cat")})
    return {"v": 1, "symbol": symbol, "fetched_at": now.isoformat(timespec="minutes"), "source": source,
            "page": ann_official_page(code), "items": keep[:ANN_KEEP]}


def ann_file(code):
    return os.path.join(ANN_DIR, f"{code}.json")


def read_ann(code):
    try:
        with open(ann_file(code), encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def refresh_announcements(stocks, now):
    """补一批个股公告文件，再合成页面上的公告栏。返回 (抓了几支, 写入几支, 删掉几个过期文件, 公告栏条目)"""
    listed = [s for s in stocks if s["data"]]
    by_code = {s["symbol"].split(".")[0]: s for s in listed}
    candidates = sorted(listed, key=lambda s: (not s["matched"], -(s["data"].get("turnover") or 0)))
    todo = []
    for s in candidates:
        old = read_ann(s["symbol"].split(".")[0])
        try:
            age = (now - datetime.fromisoformat(old["fetched_at"])).total_seconds() / 3600 if old else None
        except Exception:
            age = None
        if age is None or age >= ANN_MAX_AGE_HOURS:
            todo.append(s)
        if len(todo) >= ANN_PER_RUN:
            break
    written = 0
    if todo:
        os.makedirs(ANN_DIR, exist_ok=True)
        if MARKET_ID == "US":
            try:
                sec_cik_map()
            except Exception as e:
                print(f"⚠️ SEC 代码对照表下载失败 ({type(e).__name__}: {e})，这次不抓公告")
                todo = []
        errors = []

        def safe_fetch(s):
            try:
                return fetch_announcements(s["symbol"], now)
            except Exception as e:
                errors.append(f"{s['symbol']}: {type(e).__name__}: {e}")
                return None
        with ThreadPoolExecutor(max_workers=ANN_WORKERS) as pool:
            for s, ann in zip(todo, pool.map(safe_fetch, todo)):
                if ann is None:
                    continue
                with open(ann_file(s["symbol"].split(".")[0]), "w", encoding="utf-8") as f:
                    json.dump(ann, f, ensure_ascii=False, separators=(",", ":"))
                written += 1
        if errors:
            print(f"⚠️ 公告抓取失败 {len(errors)} 支，例如 {errors[0]}")

    # 公告栏: 报告里每支股票的公告文件 + (马股) 全市场最新公告，只留最近 ANN_BOARD_DAYS 天
    board, seen = [], set()
    since = (now.date() - pd.Timedelta(days=ANN_BOARD_DAYS)).strftime("%Y-%m-%d")

    def add(code, it):
        if it["date"] >= since and it["link"] not in seen:
            seen.add(it["link"])
            s = by_code[code]
            board.append({"code": code, "name": s["name"], "signal": bool(s["matched"]), **{k: it[k] for k in ("date", "title", "link", "cat")}})
    if MARKET_ID == "MY":
        try:
            for page in (1, 2, 3):
                for it in bursa_announcements(per_page=50, page=page):
                    if it["code"] in by_code:
                        add(it["code"], it)
        except Exception as e:
            print(f"⚠️ Bursa 全市场最新公告获取失败 ({type(e).__name__}: {e})，公告栏只用个股公告文件")
    for code in by_code:
        ann = read_ann(code)
        for it in (ann or {}).get("items", []):
            add(code, it)
    board.sort(key=lambda x: (x["date"], x["signal"]), reverse=True)

    pruned = 0
    if os.path.isdir(ANN_DIR):
        for name in os.listdir(ANN_DIR):
            code = name[:-len(".json")]
            if not name.endswith(".json") or code in by_code:
                continue
            ann = read_ann(code)
            try:
                age = (now - datetime.fromisoformat(ann["fetched_at"])).days if ann else None
            except Exception:
                age = None
            if age is None or age > ANN_PRUNE_DAYS:
                os.remove(os.path.join(ANN_DIR, name))
                pruned += 1
    return len(todo), written, pruned, board[:ANN_BOARD_MAX]


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
    """历史不到 CHART_HISTORY_DAYS (90) 个交易日的股票 (多半是新上市) 标"上市 N 天" (从第一根日线算的日历天)，提醒部分指标算不出来"""
    days = data.get("history_days")
    if not days or days >= CHART_HISTORY_DAYS:
        return ""
    listed = data.get("listed_days") or days
    return (f'<span class="new-badge" title="新上市：只有 {days} 个交易日的数据，天数不够的指标显示 —">上市 {listed} 天</span>')


def tick_size(price):
    """Bursa 最小跳动 (美股一律 0.01)"""
    if MARKET_ID != "MY":
        return 0.01
    return 0.005 if price < 1 else 0.01 if price < 10 else 0.02 if price < 100 else 0.1


def tick_badge(price):
    """低价股跳一格就是好几个百分点 (0.035 跳 0.005 = 14%)，≥ 5% 的标出来"""
    if not price or MARKET_ID != "MY":
        return ""
    pct = tick_size(price) / price * 100
    if pct < 5:
        return ""
    return f'<span class="tick-badge" title="最小跳动 {tick_size(price):g}，跳一格就是 {pct:.0f}%">跳一格 {pct:.0f}%</span>'


def fmt_compact(v):
    """成交额这类大数字: 最多 3 位有效数字 (81.1M、425M、5.72M)，手机上一格放得下"""
    if v is None:
        return "—"
    for div, suffix in ((1e12, "T"), (1e9, "B"), (1e6, "M"), (1e3, "K")):
        if abs(v) >= div:
            x = v / div
            return (f"{x:.0f}" if x >= 100 else f"{x:.1f}" if x >= 10 else f"{x:.2f}") + suffix
    return f"{v:.0f}"


def pct_text(v, digits=1, plus=True):
    if v is None:
        return "—"
    return f"{'+' if plus and v > 0 else ''}{v:.{digits}f}%"


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
# 四个条件同时满足才算命中 (成交量门槛已经在 main() 里提前筛掉，这里不用重复判断):
#   - EMA20 < 现价 (价格站上 EMA20)
#   - SAR < 现价 (SAR 在价格下方，多头状态)
#   - T3 形态 (放量创高后回调，今天再次突破)
# ⚠️ 改这里的条件时，docs/report.js 里内置策略「后台默认策略」(s-backend) 的三条规则也要一起改，
#    否则网页上套用"后台默认策略"筛出来的股票会跟后台信号对不上
BACKEND_STRATEGY_PARTS = ["EMA20多头", "SAR多头", "T3形态突破"]


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

    return True, "🎯 " + " + ".join(BACKEND_STRATEGY_PARTS)

# === 5. 呼叫 DeepSeek 进行分析 ===
# system prompt 独立成常量、内容完全固定 (不拼时间戳/随机数)，且不含任何逐股票才知道的数据；
# 每支股票变化的部分全部放进 user message。DeepSeek 的 prompt cache 是按"从头开始逐字节比对的
# 最长公共前缀"计费打折的，一次运行里命中的股票经常不止一支，只要 system prompt 前缀完全一致，
# 从第二支股票开始这一段就能命中缓存、按缓存价计费，比混在一起写省钱也通常更快。
DEEPSEEK_SYSTEM_PROMPT = f"""你是专业的{MKT['analyst']}分析师，同时是严谨的金融助手。

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
- 现价: {CURRENCY_SYMBOL} {data['close']}
- RSI (14): {data['rsi']}
- 50日均线: {f"{CURRENCY_SYMBOL} {data['sma50']}" if data['sma50'] is not None else "数据不足 (新上市，不到 50 个交易日)"}"""

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
    max-height: min(86dvh, 760px);
    display: flex; flex-direction: column;
    overflow: hidden;
  }
  .dlg.dlg-ind { width: min(960px, 100%); height: min(86vh, 720px); height: min(86dvh, 720px); }
  .dlg-head { display: flex; align-items: center; justify-content: space-between; padding: 0.9rem 1rem 0.6rem; }
  .dlg-head h3 { margin: 0; font-size: 1.05rem; }
  .dlg-x { background: none; border: none; color: var(--text-secondary); font-size: 1.5rem; line-height: 1; cursor: pointer; padding: 0.1rem 0.4rem; border-radius: 6px; }
  .dlg-x:hover { background: var(--page); color: var(--text-primary); }
  .dlg-body { padding: 0 1rem 1rem; overflow: auto; flex: 1; min-height: 0; }
  .dlg-foot { display: flex; align-items: center; gap: 0.5rem; padding: 0.7rem 1rem; border-top: 1px solid var(--border); }
  .dlg-foot .grow { flex: 1; }
  .dlg button:not(.dlg-x):not(.ind-row-main):not(.ind-nav-item):not(.ind-star):not([role="tab"]):not(.rl-btn),
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

  /* 页面最下方固定的搜索栏 (report.js 生成)；打开对话框时藏起来 */
  .dock {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 40;
    padding: 0.5rem 1rem calc(0.5rem + env(safe-area-inset-bottom));
    background: var(--surface); border-top: 1px solid var(--border); box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.08);
  }
  html.dlg-open .dock { display: none; }
  html.has-dock body { padding-bottom: 5.5rem; }
  html.has-dock .bb-toast { bottom: 5rem; }
  .dock-inner { position: relative; max-width: 640px; margin: 0 auto; }
  .dock-inner::before {
    content: ""; position: absolute; left: 0.95rem; bottom: 0.9rem; width: 15px; height: 15px; pointer-events: none; background: var(--muted);
    -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Ccircle cx='7' cy='7' r='5' fill='none' stroke='%23000' stroke-width='1.8'/%3E%3Cpath d='M11 11l3.5 3.5' stroke='%23000' stroke-width='1.8' stroke-linecap='round'/%3E%3C/svg%3E") center / contain no-repeat;
    mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Ccircle cx='7' cy='7' r='5' fill='none' stroke='%23000' stroke-width='1.8'/%3E%3Cpath d='M11 11l3.5 3.5' stroke='%23000' stroke-width='1.8' stroke-linecap='round'/%3E%3C/svg%3E") center / contain no-repeat;
  }
  #dock-input {
    width: 100%; font: inherit; font-size: 16px; /* 16px: iPhone 点输入框才不会自动放大页面 */
    padding: 0.6rem 1rem 0.6rem 2.3rem; border-radius: 999px; border: 1px solid var(--border);
    background: var(--page); color: var(--text-primary);
  }
  #dock-input:focus { outline: 2px solid var(--ema); outline-offset: 0; }
  .dock-list {
    position: absolute; left: 0; right: 0; bottom: calc(100% + 0.45rem); margin: 0; padding: 0.3rem; list-style: none;
    background: var(--surface); border: 1px solid var(--border); border-radius: 12px; box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.18);
    max-height: 50vh; max-height: 50dvh; overflow-y: auto;
  }
  .dock-list li { display: flex; align-items: baseline; gap: 0.5rem; padding: 0.55rem 0.65rem; border-radius: 8px; cursor: pointer; font-size: 0.88rem; }
  .dock-list li[aria-selected="true"], .dock-list li[role="option"]:hover { background: var(--page); }
  .dock-code { color: var(--muted); font-size: 0.78rem; }
  .dock-sig { font-size: 0.68rem; color: var(--ema); border: 1px solid currentColor; border-radius: 4px; padding: 0 0.25rem; }
  .dock-price { margin-left: auto; font-variant-numeric: tabular-nums; font-weight: 600; }
  .dock-chg { min-width: 4.2em; text-align: right; font-size: 0.8rem; font-variant-numeric: tabular-nums; }
  .dock-list li.dock-empty { color: var(--muted); cursor: default; font-size: 0.82rem; }

  /* iPhone: 输入框字号小于 16px 时，一点进去 Safari 就会自动放大整页，对话框顶部 (标题、×) 跟着被推到屏幕外
     ("指标、模板"对话框一打开就把光标放进搜索框，所以一开就被切掉)。没有鼠标的设备上输入框一律 16px，
     report.js 也不再一打开对话框就把光标放进输入框 */
  @media (hover: none) {
    .dlg input[type="text"], .dlg input[type="number"], .dlg input[type="search"], .dlg select, .dlg textarea,
    .tpl-name, #table-filter, .table-sort { font-size: 16px; }
  }

  @media (max-width: 640px) {
    /* 从底部弹出；万一对话框比看得到的区域还高，margin-top: auto 会让它改成贴着顶部 (多出来的在下面，
       里面本来就能滚动)，标题和 × 永远在屏幕里 —— 以前 align-items: flex-end 会把多出来的部分挤到屏幕上方 */
    .dlg-overlay { padding: 0; align-items: flex-start; }
    /* dvh = 实际看得到的高度。iPhone Safari 的 vh 是按底部网址栏收起来算的，网址栏还在时对话框比屏幕高，
       顶部 (股票名称、代码、关闭按钮) 会被挤出屏幕外；不支持 dvh 的旧浏览器用前面那个 vh */
    .dlg { width: 100%; margin-top: auto; max-height: 92vh; max-height: 92dvh; border-radius: 14px 14px 0 0; }
    .dlg.dlg-ind { height: 92vh; height: 92dvh; }
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
  .table-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 0.5rem 0.75rem; margin-bottom: 0.6rem; }
  /* 快速筛选 (可以同时按几个，条件叠加)；搜索统一用页面最下方的搜索栏 */
  .tf-chips { display: flex; flex-wrap: wrap; gap: 0.35rem; flex: 1 1 auto; min-width: 0; }
  .tf-chip {
    font: inherit; font-size: 0.78rem; line-height: 1; padding: 0.42rem 0.7rem; border-radius: 999px; cursor: pointer;
    color: var(--text-secondary); background: var(--surface); border: 1px solid var(--border); white-space: nowrap;
  }
  .tf-chip:hover { color: var(--text-primary); border-color: color-mix(in srgb, var(--text-primary) 30%, transparent); }
  .tf-chip[aria-pressed="true"] { color: var(--surface); background: var(--text-primary); border-color: var(--text-primary); }
  .table-count { color: var(--muted); font-size: 0.8rem; margin-left: auto; }
  #watchlist-table tbody tr.is-watched .ticker::before { content: "★ "; color: #d9a400; }
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
  .new-badge, .tick-badge {
    display: inline-block; margin-left: 0.35rem; padding: 0 0.3rem; border-radius: 3px; vertical-align: middle; white-space: nowrap;
    font-size: 0.64rem; font-weight: 600; color: var(--ema); border: 1px solid color-mix(in srgb, var(--ema) 50%, transparent);
  }
  .tick-badge { color: #b26b00; border-color: color-mix(in srgb, #d08a00 50%, transparent); font-weight: 500; }
  .relvol-odd { color: var(--muted); font-style: italic; }
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
     第二层     成交额  相对量  RSI  SAR  EMA20  涨跌%   (成交量藏起来，排序下拉框里还能按成交量排)
     数字一律短格式 (81.1M)，每一格超出就省略号，不会挤在一起；表头藏起来，改用"排序"下拉框 */
  @media (max-width: 640px) {
    .tf-chips { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; flex-basis: 100%; padding-bottom: 2px;
      -webkit-mask-image: linear-gradient(90deg, #000 88%, transparent); mask-image: linear-gradient(90deg, #000 88%, transparent); }
    .tf-chips::-webkit-scrollbar { display: none; }
    .table-sort { display: block; }
    .table-count { margin-left: auto; }
    .table-wrap { overflow: visible; }
    #watchlist-table, #watchlist-table tbody { display: block; width: 100%; }
    #watchlist-table thead { display: none; }
    #watchlist-table tbody tr {
      display: grid;
      /* 各栏按内容宽度分配 (成交额 5 个字、相对量 / RSI 4 个字、SAR 标签、EMA20 最多 6 个字)，iPhone 最窄 375px 也不会被截断 */
      grid-template-columns: 1.1rem minmax(0, 1.3fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.15fr) minmax(0, 1.45fr) minmax(3.5rem, auto);
      grid-template-areas:
        "idx   stock stock  stock spark spark price"
        ".     turn  relvol rsi   sar   ema   change";
      align-items: center; column-gap: 0.35rem; row-gap: 0.15rem;
      padding: 0.5rem 0.5rem; border-bottom: 1px solid var(--border);
      content-visibility: auto; contain-intrinsic-size: auto 62px; /* 屏幕外的行先不排版 (美股 800 多行时滑起来顺很多) */
    }
    #watchlist-table td { display: block; padding: 0; border: none; background: none; position: static; min-width: 0; max-width: none; width: auto; }
    #watchlist-table td.idx-cell { grid-area: idx; text-align: left; font-size: 0.72rem; }
    #watchlist-table td.stock-cell { grid-area: stock; overflow: hidden; text-overflow: ellipsis; }
    #watchlist-table td.spark-cell { grid-area: spark; }
    #watchlist-table .spark { min-width: 0; height: 24px; }
    #watchlist-table td.col-price { grid-area: price; font-weight: 600; font-size: 0.85rem; }
    #watchlist-table td.col-change { grid-area: change; font-size: 0.8rem; }
    #watchlist-table td.col-turn { grid-area: turn; }
    #watchlist-table td.col-vol { display: none; }
    #watchlist-table td.col-relvol { grid-area: relvol; }
    #watchlist-table td.col-rsi { grid-area: rsi; }
    #watchlist-table td.col-sar { grid-area: sar; }
    #watchlist-table td.col-ema { grid-area: ema; }
    #watchlist-table td[data-label] { text-align: left; font-size: 0.72rem; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; letter-spacing: -0.01em; }
    #watchlist-table td.idx-cell { font-size: 0.66rem; }
    #watchlist-table td.col-price, #watchlist-table td.col-change { text-align: right; white-space: nowrap; }
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
  /* ---- 筛选器: 模板名称 → 选股条件面板 (STRATEGY_CSS) → 后台信号: 股票标签 → 全局工具栏 → 卡片轮播 ---- */
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
    width: 250px; max-height: min(70vh, 620px); max-height: min(70dvh, 620px); overflow: auto;
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
  .dlg.dlg-stock { width: min(1280px, 100%); height: min(94vh, 1000px); height: min(94dvh, 1000px); }
  .dlg-stock .dlg-head { gap: 0.6rem; border-bottom: 1px solid var(--border); padding-bottom: 0.55rem; margin-bottom: 0.5rem; }
  .dlg-stock .dlg-head .sv-head { margin-right: auto; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .dlg-stock .dlg-head h3 { flex-shrink: 0; }
  .dlg-stock .dlg-head .card-price { font-size: 0.8rem; }
  .dlg-stock .dlg-head .card-price b { font-size: 0.98rem; }
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
    .dlg.dlg-stock { height: 92vh; height: 92dvh; }
    .sv-toolbar { align-items: flex-start; }
    .fc-grid { grid-template-columns: 1fr 1fr; gap: 0.5rem 0.8rem; }
    .fc-lbl { font-size: 13px; } /* 小图缩到约 0.7 倍，字要写大一点，实际显示约 9-10px */
    .fc-val { font-size: 14px; }
    .fin-table { font-size: 0.75rem; }
    .fin-table th, .fin-table td { padding: 0.3rem 0.3rem; }
    .fin-table thead th small { display: none; } /* 手机上只留 25Q3 / FY2025，四栏才放得下不用横向滑 */
    .card-fin { display: block; margin: 0.2rem 0 0; }
    .card-head { margin-right: 7rem; }
    .tb-menu { position: fixed; left: 0.5rem; right: 0.5rem; top: auto; bottom: 0.5rem; width: auto; max-height: 70vh; max-height: 70dvh; }
  }
"""

MARKET_CSS = """
  /* ---- 标题下面的"盘中 / 已收盘"标签 ---- */
  .updated { display: flex; flex-wrap: wrap; align-items: center; gap: 0.3rem 0.5rem; }
  .mstate {
    display: inline-flex; align-items: center; gap: 0.35rem; padding: 0.1rem 0.55rem; border-radius: 999px; font-size: 0.72rem;
    color: var(--text-secondary); border: 1px solid var(--border); background: var(--surface);
  }
  .mstate.live { color: #9a5a00; border-color: color-mix(in srgb, #d08a00 45%, transparent); background: color-mix(in srgb, #d08a00 10%, var(--surface)); }
  .mstate.live::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: #d08a00; animation: bb-pulse 1.6s ease-in-out infinite; }
  @keyframes bb-pulse { 50% { opacity: 0.3; } }
  .live-badge {
    display: inline-block; margin-left: 0.4rem; padding: 0 0.35rem; border-radius: 4px; vertical-align: middle;
    font-size: 0.64rem; font-weight: 600; color: #9a5a00; border: 1px solid color-mix(in srgb, #d08a00 50%, transparent);
  }
  @media (prefers-color-scheme: dark) { .mstate.live, .live-badge { color: #f0b54a; } }

  /* ---- 今日市场: 指数 + 全市场涨跌家数 (手机上两格一排)，下面一条涨跌榜 / 成交额榜 ---- */
  .market h2.section { margin: 1.1rem 0 0.6rem; }
  .mk-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 0.6rem; }
  .mk-idx, .mk-breadth { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 0.65rem 0.8rem; min-width: 0; }
  .mk-idx { display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: "name spark" "last spark" "chg spark"; align-items: center; column-gap: 0.5rem; }
  .mk-name { grid-area: name; font-size: 0.74rem; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .mk-idx b { grid-area: last; font-size: 1.15rem; line-height: 1.3; font-variant-numeric: tabular-nums; }
  .mk-idx > span.change-up, .mk-idx > span.change-down, .mk-idx > span.change-neutral { grid-area: chg; font-size: 0.78rem; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .mk-spark { grid-area: spark; width: 84px; }
  .mk-spark .spark { width: 84px; height: 34px; }
  .mk-bar { display: flex; gap: 2px; height: 8px; border-radius: 999px; overflow: hidden; background: var(--page); }
  .mk-bar span { display: block; min-width: 2px; }
  .mk-bar .up { background: var(--up); }
  .mk-bar .flat { background: var(--muted); opacity: 0.45; }
  .mk-bar .down { background: var(--down); }
  .mk-counts { display: flex; justify-content: space-between; margin-top: 0.45rem; font-size: 0.82rem; font-variant-numeric: tabular-nums; }
  .mk-note { margin: 0.4rem 0 0; font-size: 0.72rem; color: var(--muted); line-height: 1.5; }
  .mk-movers { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.6rem; margin-top: 0.7rem; }
  .mk-group { min-width: 0; }
  .mk-group h4 { margin: 0 0 0.35rem; font-size: 0.72rem; font-weight: 500; color: var(--text-secondary); }
  .mk-group > div { display: flex; flex-wrap: wrap; gap: 0.35rem; }
  .mk-chip {
    font: inherit; display: inline-flex; align-items: baseline; gap: 0.4rem; padding: 0.32rem 0.6rem; border-radius: 8px; cursor: pointer;
    border: 1px solid var(--border); background: var(--surface); color: var(--text-primary); font-size: 0.8rem; white-space: nowrap;
  }
  .mk-chip:hover { border-color: color-mix(in srgb, var(--text-primary) 30%, transparent); }
  .mk-chip span { font-size: 0.75rem; font-variant-numeric: tabular-nums; }
  .mk-val { color: var(--text-secondary); font-weight: 500; }

  /* ---- 策略回测 (后台信号下面) ---- */
  .bt { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 0.75rem 0.9rem 0.8rem; margin: 0 0 0.9rem; }
  .bt-head { display: flex; flex-wrap: wrap; align-items: center; gap: 0.2rem 0.6rem; }
  .bt-head h4 { margin: 0; font-size: 0.92rem; }
  .bt-sub { font-size: 0.74rem; color: var(--muted); }
  .bt-head .info-btn { margin-left: auto; }
  .bt-tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0.5rem; margin: 0.6rem 0 0; }
  .bt-tiles > div, .bt-risk > div { background: var(--page); border-radius: 8px; padding: 0.5rem 0.65rem; min-width: 0; }
  .bt-tiles dt, .bt-risk dt { font-size: 0.7rem; color: var(--text-secondary); }
  .bt-tiles dd { margin: 0.1rem 0 0; font-size: 1.2rem; font-weight: 650; font-variant-numeric: tabular-nums; }
  .bt-tiles small, .bt-risk small { display: block; margin-top: 0.1rem; font-size: 0.66rem; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bt-vs { margin: 0.6rem 0 0; font-size: 0.8rem; color: var(--text-secondary); line-height: 1.6; }
  .bt-more { margin-top: 0.6rem; border-top: 1px solid var(--border); padding-top: 0.55rem; }
  .bt-more summary { cursor: pointer; font-size: 0.82rem; font-weight: 500; color: var(--text-primary); }
  .bt-more h5 { margin: 1rem 0 0.4rem; font-size: 0.82rem; }
  .bt-more h5 small { font-weight: 400; color: var(--muted); }
  .bt-table-wrap { overflow-x: auto; }
  .bt-table { width: 100%; border-collapse: collapse; font-size: 0.78rem; }
  .bt-table th, .bt-table td { padding: 0.38rem 0.5rem; border-bottom: 1px solid var(--border); white-space: nowrap; text-align: left; }
  .bt-table thead th { font-weight: 500; color: var(--text-secondary); font-size: 0.72rem; }
  .bt-table .num { text-align: right; font-variant-numeric: tabular-nums; }
  .bt-table tbody th { font-weight: 500; }
  .bt-recent tbody tr { cursor: pointer; }
  .bt-recent tbody tr:hover { background: var(--page); }
  .bt-recent tbody tr:focus-visible { outline: 2px solid var(--ema); outline-offset: -2px; }
  .bt-recent small { color: var(--muted); font-size: 0.7rem; }
  .bt-st { font-size: 0.7rem; padding: 0 0.35rem; border-radius: 4px; border: 1px solid var(--border); color: var(--text-secondary); white-space: nowrap; }
  .bt-st.open { color: var(--ema); border-color: color-mix(in srgb, var(--ema) 45%, transparent); }
  .bt-risk { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0.45rem; margin: 0; }
  .bt-risk dd { margin: 0.1rem 0 0; font-size: 0.95rem; font-weight: 600; font-variant-numeric: tabular-nums; }
  .bt-dist { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 0.4rem; height: 130px; }
  .bt-bin { display: flex; flex-direction: column; align-items: center; gap: 0.2rem; min-width: 0; font-size: 0.72rem; font-variant-numeric: tabular-nums; }
  .bt-bin-track { flex: 1; width: 72%; display: flex; align-items: flex-end; }
  .bt-bin-bar { display: block; width: 100%; min-height: 2px; border-radius: 4px 4px 0 0; }
  .bt-bin.neg .bt-bin-bar { background: var(--down); }
  .bt-bin.pos .bt-bin-bar { background: var(--up); }
  .bt-bin small { color: var(--muted); font-size: 0.62rem; white-space: nowrap; }
  .bt-method { margin-top: 0.9rem; }
  .info-btn {
    font: inherit; width: 1.5rem; height: 1.5rem; flex: 0 0 auto; display: inline-grid; place-items: center; padding: 0; cursor: pointer;
    border-radius: 50%; border: 1px solid var(--border); background: var(--surface); color: var(--text-secondary); font-size: 0.8rem; line-height: 1;
  }
  .info-btn:hover { color: var(--text-primary); border-color: color-mix(in srgb, var(--text-primary) 30%, transparent); }

  /* ---- 公司公告栏 ---- */
  .ann-filter { display: flex; gap: 0.35rem; overflow-x: auto; scrollbar-width: none; padding: 0 0 0.15rem; margin: 0 0 0.55rem; }
  .ann-filter::-webkit-scrollbar { display: none; }
  .ann-chip {
    font: inherit; font-size: 0.78rem; line-height: 1; padding: 0.42rem 0.7rem; border-radius: 999px; cursor: pointer; white-space: nowrap;
    color: var(--text-secondary); background: var(--surface); border: 1px solid var(--border);
  }
  .ann-chip small { color: var(--muted); margin-left: 0.15rem; }
  .ann-chip[aria-pressed="true"] { color: var(--surface); background: var(--text-primary); border-color: var(--text-primary); }
  .ann-chip[aria-pressed="true"] small { color: inherit; opacity: 0.7; }
  .ann-board { list-style: none; margin: 0; padding: 0; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
  .ann-item {
    display: grid; grid-template-columns: 2.8rem auto auto minmax(0, 1fr); align-items: baseline; gap: 0.2rem 0.6rem;
    padding: 0.6rem 0.8rem; border-bottom: 1px solid var(--border); font-size: 0.84rem;
  }
  .ann-item:last-child { border-bottom: none; }
  .ann-item time, .ann-list time { color: var(--muted); font-size: 0.74rem; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .ann-stock { font: inherit; font-weight: 600; padding: 0; border: none; background: none; color: var(--text-primary); cursor: pointer; white-space: nowrap; }
  .ann-stock:hover { text-decoration: underline; }
  .ann-stock.sig::after { content: "信号"; margin-left: 0.3rem; font-size: 0.62rem; font-weight: 500; color: var(--ema); border: 1px solid currentColor; border-radius: 3px; padding: 0 0.2rem; vertical-align: 1px; }
  .ann-cat { font-size: 0.68rem; color: var(--text-secondary); border: 1px solid var(--border); border-radius: 4px; padding: 0 0.3rem; white-space: nowrap; }
  .ann-item a, .ann-list a { color: var(--text-primary); text-decoration: none; line-height: 1.45; min-width: 0; overflow-wrap: anywhere; }
  .ann-item a:hover, .ann-list a:hover { text-decoration: underline; }
  .ann-more { margin-top: 0.5rem; }
  @media (max-width: 640px) {
    .ann-item { grid-template-columns: auto auto minmax(0, 1fr); padding: 0.55rem 0.7rem; }
    .ann-item a { grid-column: 1 / -1; }
    .ann-cat { justify-self: end; }
    .mk-row { grid-template-columns: 1fr 1fr; gap: 0.5rem; }
    .mk-idx { grid-template-columns: minmax(0, 1fr); grid-template-areas: "name" "last" "chg" "spark"; }
    .mk-idx b { font-size: 1.05rem; }
    .mk-spark, .mk-spark .spark { width: 100%; }
    .mk-spark .spark { height: 26px; }
    .mk-breadth { padding: 0.6rem 0.7rem; }
    .mk-row > .mk-breadth:only-child, .mk-row > .mk-breadth:nth-child(odd):last-child { grid-column: 1 / -1; }
    /* 涨幅榜 / 跌幅榜 / 成交额: 手机上每个榜一行 (标题在左，股票可以左右滑) */
    .mk-movers { grid-template-columns: 1fr; gap: 0.4rem; }
    .mk-group { display: grid; grid-template-columns: 3.2rem minmax(0, 1fr); align-items: center; }
    .mk-group h4 { margin: 0; }
    .mk-group > div { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; padding: 1px 0;
      -webkit-mask-image: linear-gradient(90deg, #000 88%, transparent); mask-image: linear-gradient(90deg, #000 88%, transparent); }
    .mk-group > div::-webkit-scrollbar { display: none; }
    .bt { padding: 0.7rem 0.75rem; }
    .bt-tiles, .bt-risk { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .bt-dist { height: 110px; gap: 0.25rem; }
    .bt-table { font-size: 0.74rem; }
    .bt-table th, .bt-table td { padding: 0.34rem 0.3rem; }
    .bt-table thead th { white-space: normal; line-height: 1.25; vertical-align: bottom; }
    .bt-recent .bt-hide-sm { display: none; }
    .bt-recent td:first-child small { display: block; }
    .bt-recent td:last-child { white-space: normal; }
    .bt-recent td:last-child small { display: block; }
    .bt-risk dd { font-size: 0.88rem; }
  }
"""

TOOLS_CSS = """
  /* ---- 周期: [分时 ▾] 天 周 月 ---- */
  .tf-compact { display: flex; align-items: center; gap: 0.15rem; flex: 1; min-width: 0; }
  .tf-intra { flex: 0 0 auto; }
  .tf-intra-btn .tf-caret { font-size: 0.62rem; color: var(--muted); margin-left: 0.05rem; }
  .tf-intra-btn[aria-selected="true"] { background: var(--page); border-color: var(--border); color: var(--text-primary); font-weight: 600; }
  .tf-menu { width: 180px; }
  .tf-menu .tb-menu-item { padding: 0.5rem 0.7rem; }
  .sv-toolbar .tf-compact { flex: 1; }

  /* ---- 信号卡片: 上榜理由的数字、SAR 价位 ---- */
  .card-tags span[title] { cursor: help; }
  .q-sub { font-weight: 500; color: var(--text-secondary); font-size: 0.85em; }
  .quote-grid div[title] dt { text-decoration: underline dotted; text-underline-offset: 2px; cursor: help; }
  @media (min-width: 641px) { .quote-grid { grid-template-columns: repeat(auto-fill, minmax(6.8rem, 1fr)); } }

  /* ---- 完整图表对话框: 自选 / 计算器 / 分享 + 上一支下一支，下面一排关键数字 ---- */
  .sv-bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.4rem; margin: 0 0 0.5rem; }
  .sv-acts, .sv-nav { display: flex; align-items: center; gap: 0.35rem; }
  .dlg .sv-act {
    font: inherit; font-size: 0.8rem; padding: 0.32rem 0.7rem; border-radius: 999px; cursor: pointer; line-height: 1.2;
    color: var(--text-primary); background: var(--surface); border: 1px solid var(--border);
  }
  .dlg .sv-act:hover:not(:disabled) { border-color: color-mix(in srgb, var(--text-primary) 30%, transparent); }
  .dlg .sv-act:disabled { opacity: 0.35; cursor: default; }
  .dlg .sv-star[aria-pressed="true"] { color: #b88a00; border-color: color-mix(in srgb, #d9a400 55%, transparent); background: color-mix(in srgb, #d9a400 10%, var(--surface)); }
  .sv-nav span { font-size: 0.75rem; color: var(--muted); font-variant-numeric: tabular-nums; min-width: 3.5rem; text-align: center; }
  .dlg .sv-nav .sv-act { width: 2.1rem; padding: 0.3rem 0; text-align: center; font-size: 0.95rem; }
  .sv-stats {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr)); gap: 0.35rem 0.8rem; margin: 0 0 0.7rem;
    padding: 0.55rem 0.7rem; border-radius: 10px; background: var(--page); border: 1px solid var(--border);
  }
  .sv-stats div { min-width: 0; }
  .sv-stats dt { font-size: 0.68rem; color: var(--muted); }
  .sv-stats dd { margin: 0.05rem 0 0; font-size: 0.84rem; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sv-stats .soon dd { color: #b26b00; }
  .sv-range { display: block; position: relative; height: 4px; margin: 0.3rem 0 0.1rem; border-radius: 999px;
    background: linear-gradient(90deg, color-mix(in srgb, var(--down) 55%, transparent), color-mix(in srgb, var(--up) 55%, transparent)); }
  .sv-range i { position: absolute; top: 50%; width: 9px; height: 9px; margin: -4.5px 0 0 -4.5px; border-radius: 50%; background: var(--text-primary); border: 2px solid var(--surface); }
  .ann-sec { margin-top: 1rem; }
  .ann-list { list-style: none; margin: 0; padding: 0; }
  .ann-list li { display: grid; grid-template-columns: 5.6rem auto minmax(0, 1fr); align-items: baseline; gap: 0.2rem 0.6rem; padding: 0.5rem 0; border-bottom: 1px solid var(--border); font-size: 0.84rem; }
  @media (max-width: 640px) {
    .ann-list li { grid-template-columns: auto minmax(0, 1fr); }
    .ann-list li a { grid-column: 1 / -1; }
    .ann-list li .ann-cat { justify-self: start; }
    .sv-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .fin-table tbody th, .fin-table thead th:first-child { position: sticky; left: 0; background: var(--surface); z-index: 1; }
  }
  .fc-chg { display: inline-flex; flex-wrap: wrap; gap: 0 0.5rem; justify-content: flex-end; }
  .fc-chg span { font-size: 0.7rem; }

  /* ---- 选股条件面板: 命中时的数值、回测 ---- */
  .sp-head-empty .sp-match { flex: 1 1 12rem; }
  .sp-vals { display: block; margin-top: 0.1rem; font-size: 0.7rem; color: var(--text-secondary); font-weight: 400; }
  .sp-bt-btn { margin: 0.1rem 0 0.6rem; }
  .sp-bt { margin: 0.2rem 0 0.7rem; padding: 0.55rem 0.7rem; border-radius: 10px; background: var(--page); border: 1px solid var(--border); }
  .sp-bt-head { display: flex; flex-wrap: wrap; align-items: center; gap: 0.3rem 0.5rem; margin: 0 0 0.4rem; font-size: 0.78rem; color: var(--text-secondary); }
  .sp-bt-head b { color: var(--text-primary); }
  .sp-bt .hint { margin: 0.45rem 0 0; }

  /* ---- ☰ 导航: 工具、自选 ---- */
  .dash-tools { display: grid; gap: 0.35rem; }
  .dash-tool {
    font: inherit; display: flex; flex-direction: column; align-items: flex-start; gap: 0.1rem; text-align: left; cursor: pointer;
    padding: 0.55rem 0.7rem; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); color: var(--text-primary);
  }
  .dash-tool:hover { background: var(--page); }
  .dash-tool b { font-size: 0.86rem; }
  .dash-tool small { font-size: 0.7rem; color: var(--muted); }
  .dash-witem { display: flex; align-items: stretch; gap: 0.25rem; }
  .dash-wopen {
    font: inherit; flex: 1; min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) auto auto; grid-template-rows: auto auto; column-gap: 0.6rem;
    align-items: baseline; text-align: left; padding: 0.45rem 0.65rem; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); color: var(--text-primary); cursor: pointer;
  }
  .dash-wopen b { font-size: 0.86rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dash-wopen small { grid-row: 2; font-size: 0.7rem; color: var(--muted); }
  .dash-wpx { grid-row: 1 / span 2; align-self: center; font-size: 0.82rem; font-variant-numeric: tabular-nums; font-weight: 600; }
  .dash-wopen > span:last-child { grid-row: 1 / span 2; align-self: center; font-size: 0.78rem; font-variant-numeric: tabular-nums; }
  .dash-witem.off .dash-wopen { cursor: default; opacity: 0.6; }
  .dash-wpx.muted { font-weight: 400; color: var(--muted); font-size: 0.72rem; }
  .dash-wx { font: inherit; width: 2rem; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); color: var(--muted); cursor: pointer; }
  .dash-wx:hover { color: var(--down); }
  .dash-dl .downloads { margin: 0; }

  /* ---- 股票计算器 ---- */
  .dlg.dlg-calc { width: min(560px, 100%); }
  .calc-stock { margin: 0 0 0.6rem; font-size: 0.84rem; color: var(--text-secondary); }
  .calc-stock b { color: var(--text-primary); }
  .calc-tabs { margin: 0 0 0.8rem; }
  .calc-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.6rem 0.7rem; }
  .dlg .cf { display: flex; flex-direction: column; gap: 0.25rem; margin: 0; font-size: 0.74rem; color: var(--text-secondary); min-width: 0; }
  .dlg .cf input[type="number"] { width: 100%; height: 2.4rem; border-radius: 9px; background: var(--surface); font-variant-numeric: tabular-nums; }
  .cf-row { display: flex; align-items: center; gap: 0.4rem; }
  .cf-row input { flex: 1; min-width: 0; }
  .cf-row em { font-style: normal; font-size: 0.8rem; color: var(--text-secondary); }
  .calc-unit { flex: 0 0 auto; }
  .dlg .calc-unit span { padding: 0.3rem 0.65rem; }
  .calc-out { margin: 0.8rem 0 0.2rem; border-radius: 10px; background: var(--page); border: 1px solid var(--border); padding: 0.25rem 0.8rem; }
  .co-row { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: baseline; column-gap: 0.8rem; padding: 0.45rem 0; border-bottom: 1px solid var(--border); font-size: 0.84rem; }
  .co-row:last-of-type { border-bottom: none; }
  .co-row > span { color: var(--text-secondary); }
  .co-row > b { text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; }
  .co-row > small { grid-column: 1 / -1; text-align: right; font-size: 0.7rem; color: var(--muted); }
  .co-row.co-strong > b { font-size: 1rem; }
  .co-row.co-up > b { color: var(--up); }
  .co-row.co-down > b { color: var(--down); }
  .calc-out .calc-use { margin: 0.5rem 0 0.4rem; }
  .calc-fees { margin-top: 0.8rem; border-top: 1px solid var(--border); padding-top: 0.6rem; }
  .calc-fees summary { cursor: pointer; font-size: 0.82rem; font-weight: 500; margin-bottom: 0.6rem; }

  /* ---- 名词解释 ---- */
  .dlg.dlg-gloss { width: min(620px, 100%); }
  .gloss { margin: 0; }
  .gloss > div { padding: 0.65rem 0; border-bottom: 1px solid var(--border); scroll-margin-top: 0.5rem; }
  .gloss > div.on { background: color-mix(in srgb, var(--ema) 8%, transparent); border-radius: 8px; padding: 0.65rem 0.6rem; }
  .gloss dt { font-weight: 600; font-size: 0.9rem; }
  .gloss dd { margin: 0.25rem 0 0; font-size: 0.84rem; line-height: 1.7; color: var(--text-secondary); }
"""

TEMPLATE_BAR_HTML = """
<div class="tpl-bar" id="tpl-bar">
  <span>模板</span>
  <input type="text" id="tpl-name" class="tpl-name" maxlength="30" spellcheck="false" aria-label="筛选器名称 (当前模板 = 选股条件 + 图表指标，改名自动保存)" title="点一下改名，自动保存">
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
  <summary>下载报告 (近 {downloads["keep_days"]} 个交易日)</summary>
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


DASH_CSS = """
  /* ---- 左上角 ☰ 导航 (抽屉): 市场 (马股 / 美股) · 概览 · 筛选器种类 ---- */
  .topbar { display: flex; align-items: center; gap: 0.6rem; margin: 0 0 0.25rem; }
  .topbar h1 { margin: 0; min-width: 0; }
  .dash-btn {
    flex: 0 0 auto; width: 2.4rem; height: 2.4rem; display: inline-flex; align-items: center; justify-content: center;
    font: inherit; font-size: 1.15rem; line-height: 1; color: var(--text-primary); cursor: pointer;
    background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
  }
  .dash-btn:hover { background: var(--page); }
  .dash-btn[aria-expanded="true"] { background: var(--text-primary); color: var(--surface); }
  html.dash-open { overflow: hidden; }
  html.dash-open .dock { display: none; }
  .dash-backdrop { position: fixed; inset: 0; z-index: 46; background: rgba(0, 0, 0, 0.4); }
  .dash {
    position: fixed; top: 0; bottom: 0; left: 0; z-index: 47;
    width: min(340px, 88vw); overflow-y: auto; overscroll-behavior: contain;
    background: var(--surface); color: var(--text-primary); border-right: 1px solid var(--border);
    box-shadow: 12px 0 40px rgba(0, 0, 0, 0.25);
    padding: 0.8rem 1rem calc(1.2rem + env(safe-area-inset-bottom));
  }
  .dash-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.4rem; }
  .dash-head b { font-size: 1rem; }
  .dash-x { background: none; border: none; color: var(--text-secondary); font-size: 1.5rem; line-height: 1; padding: 0.1rem 0.4rem; border-radius: 6px; cursor: pointer; }
  .dash-x:hover { background: var(--page); color: var(--text-primary); }
  .dash-sec { border-top: 1px solid var(--border); padding: 0.7rem 0 0.8rem; }
  .dash-sec h2 { margin: 0 0 0.5rem; font-size: 0.78rem; font-weight: 600; color: var(--muted); letter-spacing: 0.04em; }
  .dash-mkts { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }
  .dash-mkt {
    display: flex; flex-direction: column; gap: 0.1rem; padding: 0.5rem 0.65rem; border-radius: 8px;
    border: 1px solid var(--border); background: var(--page); color: var(--text-primary); text-decoration: none;
  }
  .dash-mkt b { font-size: 0.92rem; }
  .dash-mkt small { font-size: 0.68rem; color: var(--muted); line-height: 1.35; }
  .dash-mkt.on { border-color: var(--text-primary); box-shadow: inset 0 0 0 1px var(--text-primary); background: var(--surface); }
  a.dash-mkt:not(.on):hover { border-color: var(--text-secondary); }
  .dash-mkt.off { opacity: 0.6; }
  .dash-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 0.55rem 0.8rem; margin: 0; }
  .dash-stats dt { font-size: 0.7rem; color: var(--muted); }
  .dash-stats dd { margin: 0; font-size: 1.05rem; font-weight: 600; font-variant-numeric: tabular-nums; }
  .dash-stats dd.dash-time { font-size: 0.8rem; font-weight: 500; }
  .dash-note { margin: 0.55rem 0 0; font-size: 0.72rem; color: var(--muted); line-height: 1.5; }
  .dash-links { list-style: none; margin: 0.6rem 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 0.35rem; }
  .dash-links a {
    display: inline-block; font-size: 0.78rem; color: var(--text-primary); text-decoration: none;
    border: 1px solid var(--border); border-radius: 999px; padding: 0.2rem 0.65rem;
  }
  .dash-links a:hover { background: var(--page); }
  .dash-sub { margin: 0.2rem 0 0.35rem; font-size: 0.72rem; font-weight: 500; color: var(--text-secondary); }
  .dash-list { display: flex; flex-direction: column; gap: 0.3rem; margin-bottom: 0.6rem; }
  .dash-item {
    display: flex; flex-direction: column; align-items: flex-start; gap: 0.1rem; width: 100%; text-align: left;
    font: inherit; color: var(--text-primary); background: none; cursor: pointer;
    border: 1px solid var(--border); border-radius: 8px; padding: 0.45rem 0.65rem;
  }
  .dash-item:hover { background: var(--page); }
  .dash-item.on { border-color: var(--text-primary); box-shadow: inset 3px 0 0 var(--text-primary); }
  .dash-item-name { font-size: 0.86rem; font-weight: 600; }
  .dash-item small { font-size: 0.7rem; color: var(--muted); line-height: 1.4; }
  .dash-actions { display: flex; gap: 0.4rem; flex-wrap: wrap; margin: 0 0 0.8rem; }
  .dash-act {
    font: inherit; font-size: 0.78rem; color: var(--text-primary); cursor: pointer;
    background: var(--page); border: 1px solid var(--border); border-radius: 999px; padding: 0.25rem 0.75rem;
  }
  .dash-act.primary { background: var(--text-primary); color: var(--surface); border-color: var(--text-primary); }
"""

STRATEGY_CSS = """
  /* ---- 筛选器: 自定义选股条件面板 (内容由 report.js 生成) + "后台信号"小标题 ---- */
  .strategy-panel { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 0.75rem 0.9rem 0.8rem; }
  .strategy-panel:empty { display: none; }
  .sp-head { display: flex; flex-wrap: wrap; align-items: center; gap: 0.3rem 0.6rem; }
  .sp-title { font-weight: 600; font-size: 0.92rem; }
  .sp-match { font-size: 0.75rem; color: var(--muted); }
  .sp-actions { margin-left: auto; display: flex; gap: 0.4rem; }
  .sp-btn {
    font: inherit; font-size: 0.8rem; color: var(--text-primary); cursor: pointer; white-space: nowrap;
    background: var(--page); border: 1px solid var(--border); border-radius: 999px; padding: 0.3rem 0.8rem;
  }
  .sp-btn:hover { border-color: var(--text-secondary); }
  .sp-btn.primary { background: var(--text-primary); color: var(--surface); border-color: var(--text-primary); }
  .sp-empty { margin: 0.5rem 0 0; font-size: 0.8rem; color: var(--text-secondary); line-height: 1.6; }
  .sp-rules { list-style: none; margin: 0.6rem 0 0; padding: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem 0.35rem; }
  .sp-join { font-size: 0.7rem; color: var(--muted); padding: 0 0.05rem; }
  .sp-rule {
    font-size: 0.78rem; line-height: 1.4; padding: 0.15rem 0.6rem; border-radius: 999px; max-width: 100%;
    border: 1px solid var(--border); background: var(--page); color: var(--text-secondary);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .sp-rule.err { color: var(--down); border-color: color-mix(in srgb, var(--down) 45%, transparent); }
  .sp-err { margin: 0.4rem 0 0; font-size: 0.75rem; color: var(--down); }
  .sp-stat { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.1rem 0.35rem; margin: 0.8rem 0 0.4rem; font-size: 0.82rem; color: var(--text-secondary); }
  .sp-stat b { color: var(--text-primary); font-size: 1.35rem; line-height: 1; font-variant-numeric: tabular-nums; }
  .sp-stat small { margin-left: auto; font-size: 0.72rem; color: var(--muted); }
  .sp-hits { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--border); }
  .sp-hit {
    display: grid; grid-template-columns: 1.8rem minmax(0, 1fr) auto 4.6rem 4.4rem; align-items: baseline; gap: 0.5rem;
    padding: 0.5rem 0.3rem; border-bottom: 1px solid var(--border); cursor: pointer; font-size: 0.84rem;
  }
  .sp-hit:hover { background: var(--page); }
  .sp-hit:focus-visible { outline: 2px solid var(--ema); outline-offset: -2px; }
  .sp-idx { color: var(--muted); font-size: 0.72rem; text-align: right; font-variant-numeric: tabular-nums; }
  .sp-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sp-code { color: var(--muted); font-size: 0.72rem; margin-left: 0.3rem; }
  .sp-sig { font-size: 0.64rem; color: var(--ema); border: 1px solid currentColor; border-radius: 4px; padding: 0 0.25rem; margin-left: 0.3rem; }
  .sp-price, .sp-chg, .sp-vol { text-align: right; font-variant-numeric: tabular-nums; }
  .sp-price { font-weight: 600; }
  .sp-vol { color: var(--text-secondary); font-size: 0.78rem; }
  .sp-more { display: block; margin: 0.6rem auto 0; }
  .sp-loading { margin: 0.6rem 0 0.2rem; font-size: 0.8rem; color: var(--muted); }
  h3.subsection { font-size: 1rem; margin: 1.5rem 0 0.15rem; }
  .sub-note { margin: 0 0 0.8rem; font-size: 0.78rem; color: var(--muted); line-height: 1.5; }

  /* ---- 条件编辑器对话框 (report.js openRulesDialog)：每条条件一张小卡片，用 grid 对齐 ----
     手机三行:  ① 条件 ········ 🗑   /   [左边 ▾        ][长度]   /   [比较][右边 ▾ ][长度或数字]
     长度、数字固定在最右一栏，所有下拉框右边对齐；没有长度的地方，下拉框直接占满那一栏 (has-alen / has-blen 控制) */
  .dlg.dlg-rules { width: min(760px, 100%); }
  .rules-dlg { display: flex; flex-direction: column; gap: 0.8rem; }
  .rl-top { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem 1rem; }
  /* 分段选择 (全部满足 / 任一满足、成立 / 不成立)：真正的 radio 藏起来，外观是一条胶囊 */
  .rl-seg {
    display: inline-flex; gap: 2px; padding: 3px; border-radius: 10px;
    background: color-mix(in srgb, var(--text-primary) 6%, var(--surface)); border: 1px solid var(--border);
  }
  .dlg .rl-seg label { display: block; position: relative; margin: 0; font-size: 0.86rem; color: var(--text-secondary); }
  .rl-seg input { position: absolute; opacity: 0; width: 1px; height: 1px; margin: 0; pointer-events: none; }
  .rl-seg span { display: block; padding: 0.38rem 1rem; border-radius: 7px; cursor: pointer; white-space: nowrap; transition: background 0.15s, color 0.15s; }
  .rl-seg label:hover span { color: var(--text-primary); }
  .rl-seg input:checked + span {
    background: var(--surface); color: var(--text-primary); font-weight: 600;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.14), 0 0 0 1px var(--border);
  }
  .rl-seg input:focus-visible + span { outline: 2px solid var(--ema); outline-offset: 1px; }
  .rl-live { margin: 0; font-size: 0.82rem; color: var(--text-secondary); white-space: nowrap; font-variant-numeric: tabular-nums; }
  .rl-live b { color: var(--text-primary); font-size: 1.05rem; margin: 0 0.1rem; }
  .rl-live span { color: var(--muted); }
  .rl-list { display: flex; flex-direction: column; gap: 0.6rem; }
  .rl-row {
    display: grid; align-items: center; gap: 0.5rem;
    grid-template-columns: 4.6rem minmax(0, 1fr) 6.2rem;
    grid-template-areas: "no no del" "a a a" "op b b";
    padding: 0.4rem 0.65rem 0.7rem; border-radius: 12px;
    background: color-mix(in srgb, var(--text-primary) 4%, var(--surface)); border: 1px solid var(--border);
  }
  .rl-row.has-alen { grid-template-areas: "no no del" "a a alen" "op b b"; }
  .rl-row.has-blen { grid-template-areas: "no no del" "a a a" "op b blen"; }
  .rl-row.has-alen.has-blen { grid-template-areas: "no no del" "a a alen" "op b blen"; }
  .rl-row.is-bool { grid-template-areas: "no no del" "a a a" "op op op"; }
  .rl-row.is-bool.has-alen { grid-template-areas: "no no del" "a a alen" "op op op"; }
  .rl-row.is-formula { grid-template-areas: "no no del" "f f f"; }
  .rl-no { grid-area: no; display: flex; align-items: center; gap: 0.45rem; font-size: 0.76rem; color: var(--muted); }
  .rl-no b {
    display: inline-grid; place-items: center; width: 1.4rem; height: 1.4rem; border-radius: 50%;
    font-size: 0.72rem; font-weight: 600; color: var(--text-primary); background: var(--surface); border: 1px solid var(--border);
    font-variant-numeric: tabular-nums;
  }
  .rl-a { grid-area: a; }
  .rl-alen { grid-area: alen; }
  .rl-op { grid-area: op; }
  .rl-b { grid-area: b; }
  .rl-blen { grid-area: blen; }
  .rl-formula { grid-area: f; }
  .rl-row .rl-seg { justify-self: start; }
  /* 下拉框 / 输入框统一 40px 高、同一个圆角和边框；下拉箭头自己画 (iPhone、安卓、电脑看起来都一样) */
  .dlg .rl-row .rl-ctl {
    display: block; width: 100%; min-width: 0; height: 2.5rem; margin: 0;
    font: inherit; font-size: 0.9rem; color: var(--text-primary);
    background-color: var(--surface); border: 1px solid var(--border); border-radius: 9px; padding: 0 0.75rem;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .dlg .rl-row select.rl-ctl {
    -webkit-appearance: none; appearance: none; cursor: pointer; padding-right: 2rem;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8'%3E%3Cpath d='M1 1.5l5 5 5-5' fill='none' stroke='%23898781' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat; background-position: right 0.75rem center; background-size: 0.68rem;
  }
  .dlg .rl-row select.rl-op { text-align: center; text-align-last: center; padding: 0 1.6rem 0 0.6rem; background-position: right 0.55rem center; }
  .dlg .rl-row .rl-ctl:hover { border-color: color-mix(in srgb, var(--text-primary) 28%, transparent); }
  .dlg .rl-row .rl-ctl:focus { outline: none; border-color: var(--ema); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ema) 25%, transparent); }
  .dlg .rl-row textarea.rl-ctl {
    height: auto; min-height: 2.5rem; padding: 0.55rem 0.75rem; line-height: 1.5; resize: vertical;
    font-family: ui-monospace, "SFMono-Regular", Menlo, monospace; font-size: 0.85rem;
  }
  .dlg .rl-num { position: relative; display: block; margin: 0; }
  .dlg .rl-row .rl-num input { text-align: right; padding-right: 2.1rem; font-variant-numeric: tabular-nums; -moz-appearance: textfield; }
  .dlg .rl-row .rl-num.no-suf input { padding-right: 0.75rem; }
  .rl-num input::-webkit-outer-spin-button, .rl-num input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
  .rl-suf { position: absolute; right: 0.7rem; top: 50%; transform: translateY(-50%); font-size: 0.74rem; color: var(--muted); pointer-events: none; }
  .rl-btn { font: inherit; cursor: pointer; }
  .rl-del {
    grid-area: del; justify-self: end; width: 2rem; height: 2rem; display: inline-grid; place-items: center;
    border-radius: 8px; border: 1px solid transparent; background: transparent; color: var(--muted); padding: 0;
  }
  .rl-del:hover, .rl-del:focus-visible { color: var(--down); background: color-mix(in srgb, var(--down) 12%, transparent); outline: none; }
  .rl-del .ico { width: 15px; height: 15px; }
  .rl-warn, .rl-err { grid-column: 1 / -1; margin: 0; font-size: 0.76rem; line-height: 1.5; }
  .rl-warn { color: var(--text-secondary); }
  .rl-warn::before { content: "⚠ "; color: #d08a00; }
  .rl-err { color: var(--down); }
  .rl-add { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }
  .rl-add .rl-btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 0.4rem; height: 2.75rem;
    font-size: 0.88rem; color: var(--text-primary); background: transparent;
    border: 1px dashed color-mix(in srgb, var(--text-primary) 30%, transparent); border-radius: 10px;
  }
  .rl-add .rl-btn:hover { border-style: solid; background: color-mix(in srgb, var(--text-primary) 5%, transparent); }
  .rl-add .rl-btn b { font-weight: 500; font-size: 1.05em; color: var(--ema); }
  .rl-help { border-top: 1px solid var(--border); padding-top: 0.65rem; font-size: 0.8rem; color: var(--text-secondary); }
  .rl-help summary { cursor: pointer; list-style: none; display: inline-flex; align-items: center; gap: 0.4rem; font-weight: 500; }
  .rl-help summary::-webkit-details-marker { display: none; }
  .rl-help summary::before { content: "›"; display: inline-block; width: 0.8em; text-align: center; font-size: 1.15em; transition: transform 0.15s; }
  .rl-help[open] summary::before { transform: rotate(90deg); }
  .rl-help ul { margin: 0.5rem 0 0; padding-left: 1.15rem; line-height: 1.75; }
  .rl-help li + li { margin-top: 0.2rem; }
  .rl-help code {
    font-family: ui-monospace, "SFMono-Regular", Menlo, monospace; font-size: 0.9em;
    background: color-mix(in srgb, var(--text-primary) 7%, transparent); padding: 0.05rem 0.3rem; border-radius: 4px;
  }
  .rl-empty { font-size: 0.84rem; color: var(--muted); margin: 0; padding: 1rem; text-align: center; border: 1px dashed var(--border); border-radius: 12px; }
  /* 电脑: 一条条件一行排完 */
  @media (min-width: 641px) {
    .rl-row {
      grid-template-columns: 1.5rem minmax(0, 1fr) 5.6rem 4.8rem minmax(0, 1fr) 6.4rem 2.1rem;
      grid-template-areas: "no a a op b b del";
      padding: 0.55rem 0.6rem;
    }
    .rl-row.has-alen { grid-template-areas: "no a alen op b b del"; }
    .rl-row.has-blen { grid-template-areas: "no a a op b blen del"; }
    .rl-row.has-alen.has-blen { grid-template-areas: "no a alen op b blen del"; }
    .rl-row.is-bool { grid-template-areas: "no a a op op op del"; }
    .rl-row.is-bool.has-alen { grid-template-areas: "no a alen op op op del"; }
    .rl-row.is-formula { grid-template-areas: "no f f f f f del"; }
    .rl-no-t { display: none; }
    .rl-warn, .rl-err { grid-column: 2 / -1; }
  }
  /* 没有鼠标的设备 (手机 / 平板)：字号 16px，iPhone 点进去才不会自动放大整页 */
  @media (hover: none) {
    .dlg .rl-row .rl-ctl, .dlg .rl-row textarea.rl-ctl { font-size: 16px; }
  }
  .rl-foot-note { margin: 0; font-size: 0.75rem; color: var(--muted); }
  .tpl-backup { margin-top: 0.9rem; }
  @media (max-width: 640px) {
    .sp-hit { grid-template-columns: 1.4rem minmax(0, 1fr) auto 4.2rem; gap: 0.4rem; }
    .sp-vol { display: none; }
  }
"""


def build_dashboard_html(signal_count, stock_count, updated, downloads_html=""):
    """左上角 ☰ 打开的导航抽屉。「筛选器种类」的内容 (我的模板 + 内置策略) 由 report.js 生成，
    因为模板存在浏览器的 localStorage 里，后台不知道；「条件命中」的数字也是 report.js 算完填进 #dash-hits。"""
    markets = []
    for mid, m in MARKETS.items():
        label = f'<b>{html.escape(m["name"])}</b><small>{html.escape(m["universe"])}</small>'
        if mid == MARKET_ID:
            markets.append(f'<a class="dash-mkt on" href="./" aria-current="page">{label}</a>')
        elif os.path.exists(os.path.join(m["docs_dir"], "index.html")):
            href = os.path.relpath(m["docs_dir"], DOCS_DIR).replace(os.sep, "/") + "/"
            markets.append(f'<a class="dash-mkt" href="{html.escape(href)}">{label}</a>')
        else:  # 另一个市场还没跑过 (例如美股第一次手动运行之前)，链接点了会 404，先不给点
            markets.append(f'<span class="dash-mkt off" aria-disabled="true"><b>{html.escape(m["name"])}</b>'
                           f'<small>第一次运行后出现</small></span>')
    return f"""<div class="dash-backdrop" id="dash-backdrop" hidden></div>
<nav class="dash" id="dash" aria-label="导航" hidden>
  <div class="dash-head"><b>导航</b><button type="button" class="dash-x" aria-label="关闭导航">×</button></div>
  <section class="dash-sec" aria-labelledby="dash-h-mkt">
    <h2 id="dash-h-mkt">市场</h2>
    <div class="dash-mkts">{''.join(markets)}</div>
  </section>
  <section class="dash-sec" aria-labelledby="dash-h-ov">
    <h2 id="dash-h-ov">概览</h2>
    <dl class="dash-stats">
      <div><dt>后台信号</dt><dd>{signal_count}</dd></div>
      <div><dt>报告内股票</dt><dd>{stock_count}</dd></div>
      <div><dt>条件命中</dt><dd id="dash-hits" title="当前模板的选股条件在报告里命中几支">—</dd></div>
      <div><dt>更新时间</dt><dd class="dash-time">{html.escape(updated)}</dd></div>
    </dl>
    <p class="dash-note">扫描范围：{html.escape(MKT["universe"])}；成交量达标的股票才会进报告。</p>
    <ul class="dash-links">
      <li><a href="#sec-market">今日市场</a></li>
      <li><a href="#sec-screener">筛选器</a></li>
      <li><a href="#sec-signals">后台信号</a></li>
      <li><a href="#sec-backtest">策略回测</a></li>
      <li><a href="#sec-ann">公司公告</a></li>
      <li><a href="#sec-table">其余股票</a></li>
    </ul>
  </section>
  <section class="dash-sec" aria-labelledby="dash-h-tools">
    <h2 id="dash-h-tools">工具</h2>
    <div class="dash-tools">
      <button type="button" class="dash-tool" data-dash="calc"><b>股票计算器</b><small>手续费、印花税、保本价、按风险算股数</small></button>
      <button type="button" class="dash-tool" data-dash="gloss"><b>名词解释</b><small>SAR、T3 形态、相对量、胜率、盈亏比…</small></button>
    </div>
  </section>
  <section class="dash-sec" aria-labelledby="dash-h-watch">
    <h2 id="dash-h-watch">自选</h2>
    <div id="dash-watch"><p class="dash-note">需要开启 JavaScript 才能看到自选股。</p></div>
  </section>
  <section class="dash-sec" aria-labelledby="dash-h-scr">
    <h2 id="dash-h-scr">筛选器种类</h2>
    <div id="dash-screeners"><p class="dash-note">需要开启 JavaScript 才能看到你的模板。</p></div>
  </section>
  {f'<section class="dash-sec dash-dl" aria-label="下载报告">{downloads_html}</section>' if downloads_html else ''}
</nav>"""


def market_state(now):
    """报告生成时交易所开没开: live = 盘中 (最新一根日线还没收完)、pre = 开市前、closed = 已收盘 / 休市"""
    mins = now.hour * 60 + now.minute
    if now.weekday() >= 5 or mins >= MKT["session_end"]:
        return "closed"
    return "pre" if mins < MKT["session_start"] else "live"


def state_badge_html(state, delay):
    if state == "live":
        note = f"，报价约延迟 {delay} 分钟" if delay else ""
        return (f'<span class="mstate live" title="信号用的是还没收完的日线，收盘前可能变化{note}">'
                f'盘中 · 未收盘{note}</span>')
    if state == "pre":
        return '<span class="mstate" title="今天还没开市，数字是上一个交易日的">开市前 · 上一交易日数据</span>'
    return '<span class="mstate closed" title="数字是当天收盘后的">已收盘</span>'


def change_pct_of(data):
    prev = round(data["prev_close"], 3) if data.get("prev_close") else None
    return (data["close"] - prev) / prev * 100 if prev else 0.0


MOVER_MIN_TURNOVER = 1_000_000 if MARKET_ID == "MY" else 100_000_000  # 涨跌榜只看成交额够大的，免得被仙股跳一格占满


def build_market_html(market, stocks):
    """页面顶部"今日市场"：大盘指数、全市场涨跌家数 / 52 周新高新低、报告里的涨跌榜和成交额榜"""
    market = market or {}
    parts = []
    tiles = []
    for ix in market.get("indices") or []:
        cls = "change-up" if ix["chg"] > 0 else "change-down" if ix["chg"] < 0 else "change-neutral"
        sign = "+" if ix["chg"] > 0 else ""
        spark = build_sparkline(ix["spark"][-22:], width=96, height=28)
        tiles.append(f'<div class="mk-idx"><span class="mk-name">{html.escape(ix["label"])}</span>'
                     f'<b>{ix["last"]:,.2f}</b><span class="{cls}">{sign}{ix["chg"]:,.2f} ({sign}{ix["chg_pct"]:.2f}%)</span>'
                     f'<span class="mk-spark" title="近一个月">{spark}</span></div>')
    b = market.get("breadth")
    if b:
        def w(n):
            return f"{n / b['total'] * 100:.1f}%"
        tiles.append(f"""<div class="mk-breadth">
    <div class="mk-bar" role="img" aria-label="上涨 {b['up']} 家，平盘 {b['flat']} 家，下跌 {b['down']} 家">
      <span class="up" style="width:{w(b['up'])}"></span><span class="flat" style="width:{w(b['flat'])}"></span><span class="down" style="width:{w(b['down'])}"></span></div>
    <div class="mk-counts"><span class="change-up">涨 {b['up']}</span><span class="change-neutral">平 {b['flat']}</span><span class="change-down">跌 {b['down']}</span></div>
    <p class="mk-note">全市场 {b['total']} 支 · 成交额 {CURRENCY_SYMBOL} {fmt_compact(b['turnover'])} · 52 周新高 {b['highs']} / 新低 {b['lows']}</p>
  </div>""")
    if tiles:
        parts.append(f'<div class="mk-row">{"".join(tiles)}</div>')

    listed = [s for s in stocks if s["data"]]
    if listed:
        def chip(s, value, cls):
            code = s["symbol"].split(".")[0]
            return (f'<button type="button" class="mk-chip" data-code="{html.escape(code)}"><b>{html.escape(s["name"])}</b>'
                    f'<span class="{cls}">{value}</span></button>')
        liquid = [s for s in listed if (s["data"].get("turnover") or 0) >= MOVER_MIN_TURNOVER]
        gainers = sorted((s for s in liquid if change_pct_of(s["data"]) > 0), key=lambda s: -change_pct_of(s["data"]))[:3]
        losers = sorted((s for s in liquid if change_pct_of(s["data"]) < 0), key=lambda s: change_pct_of(s["data"]))[:3]
        active = sorted(listed, key=lambda s: -(s["data"].get("turnover") or 0))[:3]
        groups = []
        if gainers:
            groups.append(("涨幅榜", "".join(chip(s, pct_text(change_pct_of(s["data"]), 2), "change-up") for s in gainers)))
        if losers:
            groups.append(("跌幅榜", "".join(chip(s, pct_text(change_pct_of(s["data"]), 2), "change-down") for s in losers)))
        if active:
            groups.append(("成交额", "".join(chip(s, fmt_compact(s["data"]["turnover"]), "mk-val") for s in active)))
        pairs = [(s["data"]["turnover"], s["data"]["turnover_avg20"]) for s in listed if s["data"].get("turnover_avg20")]
        base_sum = sum(b2 for _, b2 in pairs)
        ratio = sum(a for a, _ in pairs) / base_sum if pairs and base_sum else None
        note = (f'<p class="mk-note">报告里 {len(listed)} 支股票今天的成交额是前 20 天平均的 {ratio:.2f} 倍；'
                f'涨跌榜只看成交额 ≥ {CURRENCY_SYMBOL} {fmt_compact(MOVER_MIN_TURNOVER)} 的股票</p>') if ratio else ""
        if groups:
            parts.append('<div class="mk-movers">' + "".join(f'<div class="mk-group"><h4>{t}</h4><div>{c}</div></div>' for t, c in groups)
                         + "</div>" + note)
    if not parts:
        return ""
    return (f'<section class="market" id="sec-market" aria-labelledby="sec-market-h">'
            f'<h2 class="section" id="sec-market-h">今日市场</h2>{"".join(parts)}</section>')


def build_backtest_html(bt):
    """"后台信号"下面的策略回测区块 (纯 HTML，不开 JS 也看得到)；最近信号那张表点一行打开完整图表 (report.js)"""
    if not bt:
        return ""

    def cls(v):
        return "" if v is None else "change-up" if v > 0 else "change-down" if v < 0 else "change-neutral"

    def num(v, d=2):
        return "—" if v is None else f"{v:.{d}f}"

    def pct_or_dash(v, d=1):
        return "—" if v is None else f"{v:.{d}f}%"

    h10 = next((h for h in bt["horizons"] if h["h"] == 10), None)
    vs = ""
    if h10 and h10["avg"] is not None and h10["base_avg"] is not None:
        vs = (f'<p class="bt-vs">信号出现后 10 个交易日平均 <b class="{cls(h10["avg"])}">{pct_text(h10["avg"], 2)}</b>，'
              f'同期任意一天买进平均 <b class="{cls(h10["base_avg"])}">{pct_text(h10["base_avg"], 2)}</b> (都没扣成本)</p>')
    tiles = [
        ("胜率", pct_or_dash(bt["win_rate"]), "", f'已结算 {bt["closed"]} 笔'),
        ("每笔平均", pct_text(bt["avg"], 2), cls(bt["avg"]), f'中位 {pct_text(bt["median"], 2)}'),
        ("盈亏比", num(bt["payoff"]), "", f'赚 {pct_text(bt["avg_win"], 1)} / 亏 {pct_text(bt["avg_loss"], 1)}'),
        ("平均持有", f'{num(bt["avg_days"], 1)} 天' if bt["avg_days"] is not None else "—", "", f'最多 {bt["max_hold"]} 天'),
    ]
    tiles_html = "".join(f'<div><dt>{k}</dt><dd class="{c}">{v}</dd><small>{sub}</small></div>' for k, v, c, sub in tiles)
    hz_rows = "".join(
        f'<tr><th scope="row">{h["h"]} 天</th><td class="num {cls(h["avg"])}">{pct_text(h["avg"], 2)}</td>'
        f'<td class="num">{pct_or_dash(h["win"])}</td>'
        f'<td class="num {cls(h["base_avg"])}">{pct_text(h["base_avg"], 2)}</td>'
        f'<td class="num">{pct_or_dash(h["base_win"])}</td><td class="num">{h["n"]}</td></tr>'
        for h in bt["horizons"])
    labels = ["< -10%", "-10~-5%", "-5~0%", "0~5%", "5~10%", "> 10%"]
    peak = max(bt["dist"]) or 1
    dist = "".join(f'<div class="bt-bin {"neg" if i < 3 else "pos"}"><b>{c}</b><span class="bt-bin-track"><span class="bt-bin-bar" style="height:{c / peak * 100:.0f}%"></span></span>'
                   f'<small>{labels[i]}</small></div>' for i, c in enumerate(bt["dist"]))
    risk = [
        ("初始风险", pct_text(-bt["risk_median"], 1) if bt["risk_median"] else "—", "计入价到 SAR，中位数"),
        ("期间最大涨幅", pct_text(bt["mfe_median"], 1), "中位数"),
        ("期间最大跌幅", pct_text(bt["mae_median"], 1), "中位数"),
        ("平均 R 倍数", num(bt["avg_r"]), "每笔收益 ÷ 初始风险"),
        ("获利因子", num(bt["pf"]), "总赚 ÷ 总亏"),
        ("最好 / 最差", f'{pct_text(bt["best"], 1)} / {pct_text(bt["worst"], 1)}', "单笔，已扣成本"),
        ("最多连亏", f'{bt["max_streak"]} 笔', "按结算日期排"),
        ("结算原因", f'SAR {bt["exit_sar"]} · 满期 {bt["exit_time"]}', f'满期 = 拿满 {bt["max_hold"]} 天'),
    ]
    risk_html = "".join(f'<div><dt>{k}</dt><dd>{v}</dd><small>{sub}</small></div>' for k, v, sub in risk)
    status = {"open": "持有中", "sar": "SAR 结算", "time": "满期结算"}
    recent_rows = "".join(
        f'<tr data-code="{html.escape(t["code"])}" tabindex="0"><td><b>{html.escape(t["name"])}</b> <small>{html.escape(t["code"])}</small></td>'
        f'<td>{t["sig"][5:].replace("-", "/")}</td><td class="num bt-hide-sm">{fmt_price(t["entry"])}</td><td class="num">{fmt_price(t["exit"])}</td>'
        f'<td class="num {cls(t["ret"])}">{pct_text(t["ret"], 1)}</td><td class="num bt-hide-sm">{pct_text(t["mae"], 1)}</td>'
        f'<td><span class="bt-st {t["reason"]}">{status[t["reason"]]}</span> <small>{t["days"]} 天</small></td></tr>'
        for t in bt["recent"])
    if recent_rows:
        recent = (f'<h5>最近 {BT_RECENT_BARS} 个交易日的信号现在怎样 <small>(没扣成本；点一行看图表)</small></h5>'
                  f'<div class="bt-table-wrap"><table class="bt-table bt-recent"><thead><tr><th>股票</th><th>信号日</th><th class="num bt-hide-sm">计入价</th>'
                  f'<th class="num" title="还没结算 = 现价；已结算 = 结算那天的收盘价">现价</th><th class="num">收益</th><th class="num bt-hide-sm">期间最大跌幅</th><th>状态</th></tr></thead>'
                  f'<tbody>{recent_rows}</tbody></table></div>')
    else:
        recent = f'<p class="hint">最近 {BT_RECENT_BARS} 个交易日没有出现过信号。</p>'
    period = f'{bt["from"][5:].replace("-", "/")} ~ {bt["to"][5:].replace("-", "/")}' if bt["from"] and bt["to"] else "近 6 个月"
    return f"""<div class="bt" id="sec-backtest">
  <div class="bt-head"><h4>策略回测</h4><span class="bt-sub">{period} · {bt['stocks']} 支 · {bt['trades']} 笔信号</span>
    <button type="button" class="info-btn" data-gloss="backtest" aria-label="回测怎么算">ⓘ</button></div>
  <dl class="bt-tiles">{tiles_html}</dl>
  {vs}
  <details class="bt-more"><summary>详细数据 · 风险报酬 · 最近信号表现</summary>
    <h5>信号之后固定天数的涨跌 <small>(隔天开盘价计入，没扣成本)</small></h5>
    <div class="bt-table-wrap"><table class="bt-table"><thead><tr><th>持有</th><th class="num">信号平均</th><th class="num">信号胜率</th>
      <th class="num">任意日平均</th><th class="num">任意日胜率</th><th class="num">笔数</th></tr></thead><tbody>{hz_rows}</tbody></table></div>
    <h5>风险与报酬 <small>(已结算的 {bt['closed']} 笔)</small></h5>
    <dl class="bt-risk">{risk_html}</dl>
    <h5>每笔收益分布 <small>(已扣成本)</small></h5>
    <div class="bt-dist">{dist}</div>
    {recent}
    <p class="hint bt-method">规则：信号当天收盘后，隔天开盘价计入；之后哪天收盘跌到 SAR 以下就按当天收盘价结算，最多 {bt['max_hold']} 个交易日。
      每笔已扣来回交易成本约 {bt['cost']}%。同一支股票一笔没结算前的新信号不重复算。只统计今天进报告的股票 (成交量达标)，有幸存者偏差；
      样本只有近 6 个月的日线，历史统计不代表未来，也不是投资建议。</p>
  </details>
</div>"""


def build_board_html(board):
    """公司公告栏：报告里的股票最近 ANN_BOARD_DAYS 天的公告；分类筛选、点股票名打开完整图表由 report.js 处理"""
    official = BURSA_ANN_PAGE if MARKET_ID == "MY" else "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent"
    source = "Bursa 官网" if MARKET_ID == "MY" else "SEC EDGAR"
    cat_label = dict(ANN_CATS)
    count = ""
    if not board:
        body = (f'<p class="hint">这次没有抓到公告 (后台每次运行补一批，刚开始要跑几次才会齐)。'
                f'可以直接到 <a href="{official}" target="_blank" rel="noopener">{source} ↗</a> 看。</p>')
    else:
        counts = {}
        for it in board:
            counts[it["cat"]] = counts.get(it["cat"], 0) + 1
        chips = [f'<button type="button" class="ann-chip" data-cat="" aria-pressed="true">全部 <small>{len(board)}</small></button>']
        chips += [f'<button type="button" class="ann-chip" data-cat="{c}" aria-pressed="false">{label} <small>{counts[c]}</small></button>'
                  for c, label in ANN_CATS if counts.get(c)]
        items = "".join(
            f'<li class="ann-item" data-cat="{it["cat"]}"><time datetime="{it["date"]}">{it["date"][5:].replace("-", "/")}</time>'
            f'<button type="button" class="ann-stock{" sig" if it["signal"] else ""}" data-code="{html.escape(it["code"])}">{html.escape(it["name"])}</button>'
            f'<span class="ann-cat">{cat_label.get(it["cat"], "其他")}</span>'
            f'<a href="{html.escape(it["link"])}" target="_blank" rel="noopener noreferrer">{html.escape(it["title"])}</a></li>'
            for it in board)
        body = (f'<div class="ann-filter" role="toolbar" aria-label="公告分类">{"".join(chips)}</div>'
                f'<ul class="ann-board" id="ann-board">{items}</ul>'
                f'<p class="hint">来源：<a href="{official}" target="_blank" rel="noopener">{source} ↗</a>，点标题看原文；'
                f'点股票名看图表、财报和这支股票的全部公告。</p>')
        count = f' <span class="section-count">({len(board)})</span>'
    return (f'<h2 class="section with-sub" id="sec-ann">公司公告{count}</h2>'
            f'<p class="sub-note">报告里的股票最近 {ANN_BOARD_DAYS} 天的公告</p>{body}')


# === 7. 生成 HTML 报告 (只有命中信号的股票画 K 线图，其余用表格) ===
def build_html_report(stocks, downloads=None, table_charts_version=None, market=None, backtest=None, board=None):
    now_dt = datetime.now(LOCAL_TZ)
    now = now_dt.strftime("%Y-%m-%d %H:%M")
    state = market_state(now_dt)
    delay = ((market or {}).get("breadth") or {}).get("delay")
    mfe_median = backtest.get("mfe_median") if backtest else None
    meta = {}  # 每支股票给 report.js 用的数字 (详情顶部的市值 / 市盈率、计算器、自选列表)

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

        turnover = data.get("turnover") or data["close"] * data["volume"]
        q = QUOTE_META.get(s["symbol"]) or {}
        m = {"n": s["name"], "p": data["close"], "c": round(change_pct_of(data), 2), "t": round(turnover), "sig": 1 if s["matched"] else 0}
        for key, v in (("a", data.get("turnover_avg20")), ("atr", data.get("atr_pct")), ("sar", data.get("sar")),
                       ("rsi", data.get("rsi")), ("l", data.get("listed_days")), ("mc", q.get("mcap")), ("pe", q.get("pe")),
                       ("dy", q.get("dy")), ("hi", q.get("hi52")), ("lo", q.get("lo52"))):
            if v is not None:
                m[key] = round(v, 4) if isinstance(v, float) else v
        if q.get("earnings"):
            m["e"] = q["earnings"]
        meta[code] = m

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
            if rel_vol is None:
                rel_vol_cell = '<td class="num col-relvol" data-label="相对量" data-value="-1">—</td>'
            elif rel_vol >= 20:  # 平时几乎没成交的股票，今天一有量倍数就几十上百，照实显示会误导
                rel_vol_cell = (f'<td class="num col-relvol relvol-high relvol-odd" data-label="相对量" data-value="{rel_vol}" '
                                f'title="相对量 {rel_vol:.1f} 倍：平时成交很少，倍数容易虚高">20+</td>')
            else:
                rel_vol_cell = (f'<td class="num col-relvol{" relvol-high" if rel_vol >= 2 else ""}" data-label="相对量" '
                                f'data-value="{rel_vol}">{rel_vol:.2f}</td>')
            sar_pill = sar_pill_html(data["sar_bullish_now"])
            sar_value = -1 if data["sar_bullish_now"] is None else int(data["sar_bullish_now"])
            ema = data["ema20_latest"]
            ema_cell = (
                f'<td class="num col-ema {"change-up" if data["close"] > ema else "change-down"}" data-label="EMA20" data-value="{ema}">{fmt_price(ema)}</td>'
                if ema is not None else '<td class="num col-ema" data-label="EMA20" data-value="-1">—</td>'
            )
            new_badge = history_badge(data) + tick_badge(data["close"])
            flags = (f'data-sar="{sar_value}" data-rv="{rel_vol if rel_vol is not None else -1}" '
                     f'data-rsi="{fmt_num(data["rsi"], "{}", "-1")}" data-px="{data["close"]}"')

            table_rows.append((turnover, f"""<tr data-search="{code} {name.lower()}" data-code="{code}" data-name="{name}" tabindex="0" {flags}>
                <td class="idx-cell"></td>
                <td class="stock-cell" data-value="{name}"><span class="ticker">{name}</span><span class="stock-code">{code}</span>{new_badge}</td>
                <td class="spark-cell" title="{spark_title}">{spark}</td>
                <td class="num col-price" data-value="{data['close']}">{fmt_price(data['close'])}<span class="unit">{MKT['currency']}</span></td>
                <td class="num col-change {change_class}" data-value="{change_pct}">{change_sign}{change_pct:.2f}%</td>
                <td class="num col-turn" data-label="成交额" data-value="{turnover:.0f}">{fmt_compact(turnover)}</td>
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
        # 上榜理由做成一行小标签 (不带表情符号)，带上"高出多少"：例如 "EMA20多头 +3.0% · SAR多头 +5.5% · T3形态突破 · 放量 2.1×"
        close, ema, sar = data["close"], data["ema20_latest"], data.get("sar")
        rel_vol = data.get("rel_volume")
        # 距离一律按"占现价的 %"算，跟下面"风险 (到 SAR)"是同一个数
        tag_parts = [
            ("EMA20多头" + (f" {pct_text((close - ema) / close * 100, 1)}" if ema else ""), "现价比 EMA20 高多少 (占现价 %)"),
            ("SAR多头" + (f" {pct_text((close - sar) / close * 100, 1)}" if sar else ""), "现价比 SAR 高多少 = 跌到 SAR 要跌多少"),
            ("T3形态突破", "放量创高后回调，今天收盘再突破那天的最高价"),
        ]
        if rel_vol is not None:
            tag_parts.append((f"量 {rel_vol:.1f}×", "今天成交量是前 20 天平均的几倍"))
        tags_html = " · ".join(f'<span title="{t}">{html.escape(x)}</span>' for x, t in tag_parts)
        # 风险报酬 (都是数字，不是建议)：风险 = 现价跌到 SAR 要跌多少；报酬参考 = 回测里同类信号期间最大涨幅的中位数
        risk = (close - sar) / close * 100 if sar and sar < close else None
        rr = mfe_median / risk if mfe_median and risk else None
        sar_pill = sar_pill_html(data["sar_bullish_now"]) + (f' <span class="q-sub">{fmt_price(sar)}</span>' if sar else "")
        quote_items = [
            ("成交额", fmt_compact(turnover), ""),
            ("相对量", f"{rel_vol:.2f}×" if rel_vol is not None else "—", ""),
            ("RSI(14)", fmt_num(data["rsi"], "{:.1f}"), ""),
            ("EMA20", fmt_num(ema, PRICE_PATTERN), ""),
            ("50日均线", fmt_num(data["sma50"], PRICE_PATTERN), ""),
            ("SAR", sar_pill, ""),
            ("ATR(14)", pct_text(data.get("atr_pct"), 1, plus=False), "近 14 天平均每天波动多少"),
            ("风险 (到 SAR)", pct_text(-risk, 1) if risk else "—", "现价跌到 SAR 要跌多少"),
            ("风险报酬比", f"1 : {rr:.1f}" if rr else "—",
             f"报酬参考 = 回测里同类信号期间最大涨幅的中位数 {pct_text(mfe_median, 1)}" if mfe_median else "回测样本不够"),
        ]
        quote_grid = "".join(f'<div{f" title={chr(34)}{t}{chr(34)}" if t else ""}><dt>{k}</dt><dd>{v}</dd></div>' for k, v, t in quote_items)
        live_badge = '<span class="live-badge" title="盘中信号：用的是还没收完的日线，收盘前可能消失">盘中</span>' if state == "live" else ""

        # 图表下方只放数据 (quote)，不放说明文字/图例/符号；AI 点评只保留在下载的 Excel/PDF 里
        chips.append(f'''<button type="button" class="sym-chip" aria-current="false"><b>{html.escape(s['name'])}</b>'''
                     f'''<span class="sym-price">{fmt_price(data['close'])}</span><span class="{change_class}">{sign}{change_pct:.2f}%</span></button>''')
        cards.append(f"""<section class="card" data-chart="{chart_id}" aria-roledescription="卡片" aria-label="{html.escape(s['name'])} {code}">
            <div class="card-head">
                <h2>{html.escape(s['name'])} <span class="code">{code}</span>{history_badge(data)}{live_badge}</h2>
                <div class="card-price"><b>{fmt_price(data['close'])}</b> <span class="{change_class}">{sign}{fmt_price(change)} ({sign}{change_pct:.2f}%)</span></div>
            </div>
            <p class="card-tags">{tags_html}</p>
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

    # 默认按成交额从高到低排 (马股仙股成交股数动辄几亿，按股数排会误导)，点表头 / 排序下拉框仍然可以改
    table_rows = [row for _, row in sorted(table_rows, key=lambda r: r[0], reverse=True)]

    # 放进 <script> 里，"</" 转义掉，免得名字里万一有 "</script>" 把脚本截断
    chart_json = json.dumps(chart_payload, separators=(",", ":")).replace("</", "<\\/")
    no_data_note = f"<p class='no-data'>另有 {no_data_count} 支股票数据不足，未列入。</p>" if no_data_count else ""
    downloads_html = build_downloads_html(downloads)
    dashboard_html = build_dashboard_html(len(cards), len(cards) + len(table_rows), f"{now} ({MKT['tz_label']})", downloads_html)
    page_meta = {"stocks": meta, "lot": MKT["lot_size"], "cur": MKT["currency"], "sym": CURRENCY_SYMBOL, "state": state,
                 "usd_myr": (market or {}).get("usd_myr"),
                 "bt": {k: backtest.get(k) for k in ("mfe_median", "risk_median", "cost", "win_rate", "avg")} if backtest else None}
    meta_json = json.dumps(page_meta, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    market_html = build_market_html(market, stocks)
    backtest_html = build_backtest_html(backtest)
    board_html = build_board_html(board or [])
    # 马股 / 美股两个页面共用 report.js，市场差异全部放在 <body> 的 data-* 里给脚本读
    body_attrs = (f'data-market="{MARKET_ID}" data-session-start="{MKT["session_start"]}" data-price-dp="{PRICE_DP}" '
                  f'data-search-hint="{html.escape(MKT["search_hint"])}" '
                  f'data-table-charts="{f"charts/table.json?v={table_charts_version}" if table_charts_version else ""}"')

    return f"""<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#f9f9f7" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0d0d0d" media="(prefers-color-scheme: dark)">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="{MKT['name']}报告">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="{ASSET_PREFIX}icons/icon-192.png" type="image/png">
<link rel="apple-touch-icon" href="{ASSET_PREFIX}icons/apple-touch-icon.png">
<title>{MKT['title']}</title>
<script src="{ASSET_PREFIX}vendor/lightweight-charts.js?v=5.2.1"></script>
<style>
  /* 🎨 图表配色：想换颜色直接改这里的 hex 值即可 (--up / --down / --ema) */
  :root {{
    color-scheme: light;
    --page: #f9f9f7;
    --surface: #fcfcfb;
    --text-primary: #0b0b0b;
    --text-secondary: #52514e;
    --muted: #6f6d68;   /* 浅色背景上的灰字: 对比度约 4.9:1 (以前 #898781 只有 3.4:1，小字看不清) */
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
{DASH_CSS}
{STRATEGY_CSS}
{MARKET_CSS}
{TOOLS_CSS}
</style>
</head>
<body {body_attrs}>
<header class="topbar">
  <button type="button" class="dash-btn" id="dash-btn" aria-label="导航：市场、概览、工具、自选、筛选器种类、下载" aria-controls="dash" aria-expanded="false">☰</button>
  <h1>{MKT['title']}</h1>
</header>
<p class="updated">更新时间 {now} ({MKT['tz_label']}) {state_badge_html(state, delay)}</p>
{dashboard_html}
{market_html}

<h2 class="section with-sub" id="sec-screener">筛选器</h2>
{TEMPLATE_BAR_HTML}
<div class="strategy-panel" id="strategy-panel"></div>

<h3 class="subsection" id="sec-signals">后台信号 <span class="section-count">({len(cards)})</span></h3>
<p class="sub-note">后台固定策略 ({' + '.join(BACKEND_STRATEGY_PARTS)}) 筛出来的股票，附多周期 K 线图</p>
{backtest_html}
{build_screener_html(cards, chips)}

{board_html}

<h2 class="section" id="sec-table">其余股票 ({len(table_rows)})</h2>
<div class="table-toolbar">
  <div class="tf-chips" id="table-chips" role="group" aria-label="快速筛选">
    <button type="button" class="tf-chip" data-f="watch" aria-pressed="false">★ 自选</button>
    <button type="button" class="tf-chip" data-f="sar" aria-pressed="false">SAR 多头</button>
    <button type="button" class="tf-chip" data-f="rv" aria-pressed="false">放量 ≥ 2×</button>
    <button type="button" class="tf-chip" data-f="rsilo" aria-pressed="false">RSI &lt; 30</button>
    <button type="button" class="tf-chip" data-f="rsihi" aria-pressed="false">RSI &gt; 70</button>
    <button type="button" class="tf-chip" data-f="px" aria-pressed="false">{"排除 RM0.10 以下" if MARKET_ID == "MY" else "排除 $5 以下"}</button>
  </div>
  <select id="table-sort" class="table-sort" aria-label="排序">
    <option value="5:desc" selected>成交额 ↓</option>
    <option value="4:desc">涨跌% ↓</option>
    <option value="4:asc">涨跌% ↑</option>
    <option value="6:desc">成交量 ↓</option>
    <option value="7:desc">相对量 ↓</option>
    <option value="8:desc">RSI ↓</option>
    <option value="8:asc">RSI ↑</option>
    <option value="3:desc">价格 ↓</option>
    <option value="3:asc">价格 ↑</option>
    <option value="1:asc">名称 A→Z</option>
  </select>
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
      <th data-type="num" class="num" data-default-sort="desc" aria-sort="descending">成交额 <span class="arrow">▼</span></th>
      <th data-type="num" class="num">成交量 <span class="arrow"></span></th>
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
  <p>本报告及其筛选策略、代码与分析方法版权所有 © {datetime.now(LOCAL_TZ).year} CJA231，保留一切权利。未经书面授权，禁止复制、转载、二次分发或用于商业用途。</p>
  <p>K 线图: TradingView Lightweight Charts™ · Copyright (c) 2025 TradingView, Inc. · <a href="https://www.tradingview.com/" target="_blank" rel="noopener">https://www.tradingview.com/</a> (Apache License 2.0)</p>
  <p>行情数据来自公开渠道 (Yahoo Finance)，可能有延迟或错误，仅供个人研究参考，不构成投资建议。</p>
  <p>© {datetime.now(LOCAL_TZ).year} CJA231. All rights reserved. This report and the underlying strategy/code are proprietary; unauthorized reproduction or redistribution is prohibited.</p>
</footer>

<script id="chart-data" type="application/json">{chart_json}</script>
<script id="report-meta" type="application/json">{meta_json}</script>
<script src="{ASSET_PREFIX}report.js?v={report_js_version()}"></script>
</body>
</html>"""

def write_manifest():
    """"添加到主屏幕"用的 manifest (每个市场一份，放在报告同一个目录；图标 docs/icons/ 两个市场共用)"""
    manifest = {
        "name": MKT["title"], "short_name": f"{MKT['name']}报告", "lang": "zh", "start_url": "./", "scope": "./",
        "display": "standalone", "background_color": "#0d0d0d", "theme_color": "#0d0d0d",
        "icons": [
            {"src": f"{ASSET_PREFIX}icons/icon-192.png", "sizes": "192x192", "type": "image/png"},
            {"src": f"{ASSET_PREFIX}icons/icon-512.png", "sizes": "512x512", "type": "image/png"},
            {"src": f"{ASSET_PREFIX}icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
        ],
    }
    with open(os.path.join(DOCS_DIR, "manifest.webmanifest"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)


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
                "title": f"📢 {MKT['name']}报告已更新",
                "message": message,
                "click": REPORT_URL,
                "tags": ["chart_with_upwards_trend"],
            },
            timeout=10,
        )
    except Exception as e:
        print(f"推送通知失败: {e}")

# 判断今天是否为交易日的参考股：固定用流动性极佳的股票 (马股马银行、美股 SPY)，跟 WATCHLIST 具体内容无关
# (非交易日/公共假期时 yfinance 不会有当天的数据)
TRADING_DAY_REFERENCE = MKT["trading_ref"]


SCREENER_PAGE_SIZE = 250  # Yahoo screener 单次请求上限


def screener_query():
    """Yahoo screener 的查询条件：马股 = 地区 my (全部股票)；美股 = 地区 us + 纽交所/纳斯达克 + 市值门槛"""
    from yfinance import EquityQuery
    cfg = MKT["screener"]
    conditions = [EquityQuery("eq", ["region", cfg["region"]])]
    if cfg.get("exchanges"):
        conditions.append(EquityQuery("is-in", ["exchange", *cfg["exchanges"]]))
    if cfg.get("min_market_cap"):
        conditions.append(EquityQuery("gte", ["intradaymarketcap", cfg["min_market_cap"]]))
    return conditions[0] if len(conditions) == 1 else EquityQuery("and", conditions)


# screener 每支股票顺便带回来的基本资料 (不用另外请求)：市值、市盈率、股息率、52 周高低、财报日期、报价延迟…
# 页面上"今日市场"(全市场涨跌家数、52 周新高/新低) 和个股详情顶部那一行都用这里的数字；Yahoo 没给的字段就是 None
QUOTE_META = {}


def _num(v):
    try:
        v = float(v)
        return v if v == v and abs(v) != float("inf") else None
    except (TypeError, ValueError):
        return None


def quote_meta(q):
    dy = _num(q.get("trailingAnnualDividendYield"))
    dy = dy * 100 if dy is not None else _num(q.get("dividendYield"))  # 前者是小数 (0.045)，后者已经是百分比 (4.5)
    earnings = [_num(q.get(k)) for k in ("earningsTimestampStart", "earningsTimestamp", "earningsTimestampEnd")]
    return {
        "price": _num(q.get("regularMarketPrice")),
        "chg_pct": _num(q.get("regularMarketChangePercent")),
        "volume": _num(q.get("regularMarketVolume")),
        "mcap": _num(q.get("marketCap")),
        "pe": _num(q.get("trailingPE")),
        "dy": round(dy, 2) if dy is not None and 0 <= dy < 100 else None,
        "hi52": _num(q.get("fiftyTwoWeekHigh")),
        "lo52": _num(q.get("fiftyTwoWeekLow")),
        "earnings": [int(x) for x in earnings if x],
        "delay": _num(q.get("exchangeDataDelayedBy")),
        "state": q.get("marketState"),
    }


def market_breadth():
    """全市场 (screener 拿到的全部普通股，不只是进报告的) 涨跌家数、成交额、52 周新高 / 新低"""
    up = down = flat = highs = lows = 0
    turnover = 0.0
    for m in QUOTE_META.values():
        chg, price, vol = m["chg_pct"], m["price"], m["volume"]
        if chg is None or not vol:
            continue  # 今天没成交的不算
        if chg > 0.0001:
            up += 1
        elif chg < -0.0001:
            down += 1
        else:
            flat += 1
        if price:
            turnover += price * vol
            if m["hi52"] and price >= m["hi52"] * 0.999:
                highs += 1
            elif m["lo52"] and price <= m["lo52"] * 1.001:
                lows += 1
    total = up + down + flat
    if not total:
        return None
    delays = [m["delay"] for m in QUOTE_META.values() if m["delay"] is not None]
    return {"up": up, "down": down, "flat": flat, "total": total, "turnover": turnover, "highs": highs, "lows": lows,
            "delay": int(max(set(delays), key=delays.count)) if delays else None}


def fetch_indices():
    """大盘指数最近一个月的收盘价 (画迷你走势 + 今天涨跌)；拿不到的指数就不显示"""
    out = []
    for sym, label in MKT["indices"]:
        try:
            closes = [round(float(x), 2) for x in yf.Ticker(sym).history(period="1mo")["Close"].dropna()]
        except Exception as e:
            print(f"⚠️ 指数 {sym} 获取失败 ({type(e).__name__}: {e})")
            continue
        if len(closes) >= 2:
            out.append({"symbol": sym, "label": label, "last": closes[-1], "chg": closes[-1] - closes[-2],
                        "chg_pct": (closes[-1] / closes[-2] - 1) * 100, "spark": closes})
    return out


def fetch_usd_myr():
    """美元兑令吉汇率 (计算器换算用)，拿不到返回 None (网页上自己填)"""
    try:
        closes = yf.Ticker("MYR=X").history(period="5d")["Close"].dropna()
        return round(float(closes.iloc[-1]), 4) if len(closes) else None
    except Exception as e:
        print(f"⚠️ 美元汇率获取失败 ({type(e).__name__}: {e})")
        return None


def prefetch_quotes():
    """
    用 Yahoo screener 几个请求 (每页 250 支) 拿到整个市场的现价 + 当日成交量，
    成交量不够门槛的股票就不用再去下载 6 个月历史了 (马股实测约 70% 的股票会被门槛挡掉)。
    返回 (quotes, equities)：quotes = {symbol: (price, volume)}；equities = {symbol: 名称}，只算普通股
    (跟 scripts/fetch_watchlist.py 同一个规则)，马股用来找出清单里还没有的新上市股票，美股直接当扫描范围。
    screener 出错就返回两个空 dict，调用方会退回"逐支下载历史再判断"。
    """
    try:
        query = screener_query()
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
                    QUOTE_META[symbol] = quote_meta(q)
            offset += SCREENER_PAGE_SIZE
            if not page or offset >= result.get("total", 0):
                break
        return quotes, equities
    except Exception as e:
        print(f"⚠️ screener 预筛选失败 ({e})，改为逐支下载历史数据再判断成交量")
        return {}, {}


def build_scan_list(equities):
    """
    马股: 扫描范围 = data/watchlist.json 清单 + screener 里有、清单里还没有的普通股 (多半是新上市)。
    清单只有手动跑 scripts/fetch_watchlist.py 才会更新，以前新股要等有人更新清单才会被扫描到。
    另外新股刚上市时 Yahoo 还没有名称，清单里名字就是代码 (例如 0468.KL)，这里顺便换成 screener 的新名称。
    美股: 没有清单，扫描范围就是 screener 找到的普通股 (市值门槛以上)；screener 出错时退回几支默认的大型股。
    """
    if not WATCHLIST:
        if equities:
            print(f"📋 screener 找到 {len(equities)} 支股票 ({MKT['universe']})")
            return [{"symbol": sym, "name": name} for sym, name in sorted(equities.items())]
        print(f"⚠️ screener 没拿到股票清单，这次只扫描默认的 {len(DEFAULT_WATCHLIST)} 支")
        return [dict(item) for item in DEFAULT_WATCHLIST]
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


def is_trading_day(today_local):
    # 只需要知道最新一根日线是不是今天 (交易所当地日期)，抓 5 天就够了，不用拉 6 个月再算一遍全部指标
    try:
        df = yf.Ticker(TRADING_DAY_REFERENCE).history(period="5d")
        return len(df) > 0 and df.index[-1].strftime("%Y-%m-%d") == today_local
    except Exception as e:
        print(f"交易日判断失败 ({e})，按非交易日处理")
        return False

# === 主程序 ===
def main():
    today_local = datetime.now(LOCAL_TZ).strftime("%Y-%m-%d")
    print(f"开始扫描{MKT['name']} ({today_local} {MKT['tz_label']})...")

    if FORCE_RUN:
        print("⚠️ FORCE_RUN 模式：跳过交易日检查，直接用最新可用数据扫描 (用于测试)。")
    elif not is_trading_day(today_local):
        print(f"今天 ({today_local}) 非交易日或数据尚未更新，跳过本次扫描。")
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

        # 流动性门槛 (马股按价格分级，美股按成交额，见 min_volume_for): 成交量不够的直接忽略，不放进报告
        if data and data.get("low_volume"):
            tier = 0 if MIN_TURNOVER else data["threshold"]  # 美股每支的门槛股数都不一样，合成一行
            low_volume_by_tier[tier] = low_volume_by_tier.get(tier, 0) + 1
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
        print(f"⏭️ {volume_rule_text(threshold)} 被忽略: {low_volume_by_tier[threshold]} 支")
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
        downloads = export_downloads(stocks, today_local, datetime.now(LOCAL_TZ).strftime("%Y-%m-%d %H:%M"),
                                     downloads_dir=DOWNLOADS_DIR, title=MKT["title"], tz_label=MKT["tz_label"],
                                     file_prefix=MKT["file_prefix"])
        print(f"📥 下载文件已导出: 保留 {len(downloads['days'])} 天 ({downloads['days'][0]['date']} 起)")
    except Exception as e:
        print(f"⚠️ 导出下载文件失败 ({type(e).__name__}: {e})，报告照常生成，只是这次没有下载区块")
    export_secs = time.perf_counter() - t_export

    # 点开"其余股票"看完整图表 (以及网页上的选股条件) 用的K线 + 个股资料 (财报、长期K线，一周刷新一次，每次补一批)。
    # 出错都不影响报告本身
    t_fin = time.perf_counter()
    table_charts_version = None
    try:
        table_charts_version = write_table_charts(stocks)
    except Exception as e:
        print(f"⚠️ 写表格股票K线失败 ({type(e).__name__}: {e})，这次点表格看不了完整图表、选股条件也只算得了信号股")
    try:
        tried, written, with_fin, pruned = refresh_details(stocks, today_local)
        if tried or pruned:
            print(f"📊 个股资料 (财报 + 2 年日线 + 10 年月线): 这次抓 {tried} 支，写入 {written} 支，其中 {with_fin} 支 Yahoo 有财报"
                  + (f"，{tried - written} 支没拿到下次再试" if tried > written else "")
                  + (f"，删掉 {pruned} 个过期文件" if pruned else ""))
    except Exception as e:
        print(f"⚠️ 更新个股资料失败 ({type(e).__name__}: {e})")
    try:
        tried, written, with_items, pruned = refresh_news(stocks, datetime.now(LOCAL_TZ))
        if tried or pruned:
            print(f"📰 个股新闻: 这次抓 {tried} 支，写入 {written} 支，其中 {with_items} 支有最近 {NEWS_MAX_DAYS} 天的新闻"
                  + (f"，{tried - written} 支没拿到下次再试" if tried > written else "")
                  + (f"，删掉 {pruned} 个过期文件" if pruned else ""))
    except Exception as e:
        print(f"⚠️ 更新个股新闻失败 ({type(e).__name__}: {e})")
    board = []
    try:
        tried, written, pruned, board = refresh_announcements(stocks, datetime.now(LOCAL_TZ))
        print(f"📢 公司公告: 这次抓 {tried} 支，写入 {written} 支" + (f"，{tried - written} 支没拿到下次再试" if tried > written else "")
              + (f"，删掉 {pruned} 个过期文件" if pruned else "") + f"；公告栏 {len(board)} 条 (最近 {ANN_BOARD_DAYS} 天)")
    except Exception as e:
        print(f"⚠️ 更新公司公告失败 ({type(e).__name__}: {e})")
    fin_secs = time.perf_counter() - t_fin

    # 今日市场 (大盘指数 + 全市场涨跌家数) 和策略回测：出错都不影响报告
    market = {"indices": [], "breadth": None, "usd_myr": None}
    try:
        market = {"indices": fetch_indices(), "breadth": market_breadth(), "usd_myr": fetch_usd_myr()}
    except Exception as e:
        print(f"⚠️ 今日市场数据获取失败 ({type(e).__name__}: {e})")
    backtest = None
    try:
        backtest = summarize_backtest(stocks)
        if backtest:
            print(f"🧪 策略回测 ({backtest['from']} ~ {backtest['to']}，{backtest['stocks']} 支): {backtest['trades']} 笔 "
                  f"(已结算 {backtest['closed']})，胜率 {backtest['win_rate']}%，每笔平均 {backtest['avg']}% (已扣成本 {backtest['cost']}%)")
    except Exception as e:
        print(f"⚠️ 策略回测失败 ({type(e).__name__}: {e})")

    t_report = time.perf_counter()
    os.makedirs(os.path.dirname(REPORT_PATH), exist_ok=True)
    with open(REPORT_PATH, "w", encoding="utf-8") as f:
        f.write(build_html_report(stocks, downloads, table_charts_version, market=market, backtest=backtest, board=board))
    try:
        write_manifest()
    except OSError as e:
        print(f"⚠️ manifest 写入失败 ({e})")
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
