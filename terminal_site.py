"""终端版 (ASCII / Nord)：只做马股的另一套界面，和完整报告用同一次运行的数据。

写到 docs/terminal/ (GitHub Pages 上就是 <报告网址>/terminal/)：
- data.json  = 今天的信号、持仓跟进、回测、股票池、大盘、公告、名单变动
- bars.json  = 每支股票最近 BARS_DAYS 根日线 (点开个股才下载)
- index.html / terminal.css / terminal.js = 页面 (从 terminal_assets/ 复制)
个股的公告 / 新闻直接读完整报告的 ../ann/<代码>.json、../news/<代码>.json，不重复存。
自成一体 (只靠 build() 传进来的东西和几个文件路径)，以后要搬到独立仓库只要把这个文件和 terminal_assets/ 带走。"""
import json
import os
import shutil
from datetime import datetime, timedelta

TERM_DIR = os.environ.get("TERMINAL_SITE_DIR") or os.path.join("docs", "terminal")
BARS_DAYS = 90
CHANGES_DAYS = 14
BOARD_MAX = 80
ASSETS = ("index.html", "terminal.css", "terminal.js", "terminal_en.js", "legal.html")


def _f(v, d=3):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    return None if v != v else round(v, d)


def _load(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError, TypeError):
        return default


def stock_rows(stocks, pool_cur, mcaps):
    """每支进报告的股票一行 (数组，省体积)：
    [代码, 名称, 价, 涨跌%, 量, 成交额, 相对量, RSI, SAR 多头(1/0/null), EMA20, 50日线, 信号, 股票池, 今天新进, 首次进池, 连续在池天数, 市值, ATR%, 上市天数]"""
    out = []
    for s in stocks:
        d = s.get("data")
        if not d or d.get("low_volume"):
            continue
        code = s["symbol"].split(".")[0]
        prev = d.get("prev_close")
        chg = (d["close"] / round(prev, 3) - 1) * 100 if prev else 0.0
        p = pool_cur.get(code) or {}
        sar = d.get("sar_bullish_now")
        out.append([code, s["name"], _f(d["close"]), _f(chg, 2), int(d.get("volume") or 0), _f(d.get("turnover"), 0), _f(d.get("rel_volume"), 2),
                    _f(d.get("rsi"), 1), None if sar is None else int(bool(sar)), _f(d.get("ema20_latest")), _f(d.get("sma50")),
                    int(bool(s.get("matched"))), int(bool(s.get("in_pool"))), int(bool(s.get("pool_new"))), p.get("first"), p.get("streak"),
                    _f(mcaps.get(s["symbol"]), 0), _f(d.get("atr_pct"), 2), d.get("listed_days")])
    return out


def build_bars(stocks):
    """{代码: [[日期, 开, 高, 低, 收, 量], ...]}，价格 ×1000 取整"""
    out = {}
    for s in stocks:
        d = s.get("data")
        if not d or not d.get("candles"):
            continue
        out[s["symbol"].split(".")[0]] = [[c["time"], round(c["open"] * 1000), round(c["high"] * 1000), round(c["low"] * 1000),
                                           round(c["close"] * 1000), int(c.get("volume") or 0)] for c in d["candles"][-BARS_DAYS:]]
    return out


def backtest_block(bt, ledger):
    """回测：账户统计 (跟完整报告同一套 trade_stats)、资金曲线 (已平仓按卖出日累加)、模拟账户、每个信号都买的按月统计"""
    if not bt:
        return None
    keep = ("n", "closed", "open", "open_avg", "win_rate", "avg", "median", "avg_win", "avg_loss", "payoff", "pf", "avg_days",
            "best", "worst", "max_streak", "mdd", "mdd_pct", "total", "exits")
    trades = (ledger or {}).get("trades") or []
    closed = sorted((t for t in trades if t.get("reason") != "open"), key=lambda t: t.get("exit_date") or "")
    curve, cum = [], 0.0
    for t in closed:
        cum += t["net"]
        curve.append([t["exit_date"], round(cum, 2), t["code"], round(t["net"], 2)])
    months = {}
    for t in (ledger or {}).get("every") or []:
        if t.get("reason") == "open":
            continue
        m = months.setdefault(t["sig"][:7], [0, 0, 0.0])
        m[0] += 1
        m[1] += t["net"] > 0
        m[2] += t["net"]
    paper = bt.get("paper") or {}
    pt = [{k: t.get(k) for k in ("code", "name", "sig", "entry_date", "entry", "exit", "exit_date", "days", "reason", "ret", "net")}
          for t in paper.get("trades") or []]
    return {"from": bt.get("from"), "to": bt.get("to"), "position": bt.get("position"), "slots": bt.get("slots"), "cost": bt.get("cost"),
            "name": bt.get("name"), "acct": {k: bt["all"].get(k) for k in keep},
            "every": {k: (bt.get("every") or {}).get(k) for k in ("n", "closed", "win_rate", "avg", "total")},
            "paper": {"start": paper.get("start"), "stats": {k: (paper.get("stats") or {}).get(k) for k in keep}, "trades": pt},
            "curve": curve, "monthly": [[m, v[0], round(v[1] / v[0] * 100, 1), round(v[2] / v[0], 2)] for m, v in sorted(months.items(), reverse=True)]}


def universe_names(path):
    """整个马股名单 {代码: 简称} (观察列表可以加报告以外的股票、搜索用)"""
    rows = _load(path, []) or []
    return {r["symbol"].split(".")[0]: r.get("name") or r["symbol"].split(".")[0] for r in rows if isinstance(r, dict) and r.get("symbol")}


def build(stocks, market, backtest, board, focus_new, state, updated, tz_label, ledger_path, changes_path, pool_index_path,
          mcaps=None, report_url="../", out_dir=None, watchlist_path=os.path.join("data", "watchlist.json")):
    out_dir = out_dir or TERM_DIR
    rows = [s for s in stocks if s.get("data") and not s["data"].get("low_volume")]
    if not rows:
        return None
    os.makedirs(out_dir, exist_ok=True)
    pool_cur = (_load(pool_index_path, {}) or {}).get("cur") or {}
    digests = {s["symbol"].split(".")[0]: (s.get("ai_comment"), s.get("ai_comment_en")) for s in rows if s.get("matched")}
    signals = []
    for x in focus_new or []:
        zh, en = digests.get(x["code"], (None, None))
        signals.append(dict(x, digest=zh, digest_en=en))
    market = market or {}
    ix = (market.get("indices") or [None])[0]
    since = (datetime.now() - timedelta(days=CHANGES_DAYS)).strftime("%Y-%m-%d")
    changes = [e for e in (_load(changes_path, {}) or {}).get("events", []) if e.get("date", "") >= since]
    last_date = max((s["data"].get("last_date") or "" for s in rows), default="")
    payload = {
        "v": 1, "updated": updated, "tz": tz_label, "state": state, "date": last_date, "report": report_url,
        "market": {"index": {"label": ix["label"], "last": _f(ix["last"], 2), "chg": _f(ix["chg"], 2), "pct": _f(ix["chg_pct"], 2),
                             "spark": [_f(v, 2) for v in ix["spark"][-30:]]} if ix else None,
                   "breadth": market.get("breadth"), "usd_myr": market.get("usd_myr")},
        "signals": signals,
        "follow": (backtest or {}).get("follow") or [],
        "bt": backtest_block(backtest, _load(ledger_path, None)),
        "stocks": stock_rows(rows, pool_cur, mcaps or {}),
        "board": [{k: b.get(k) for k in ("date", "code", "name", "title", "link", "cat", "signal")} for b in (board or [])[:BOARD_MAX]],
        "changes": changes,
        "names": universe_names(watchlist_path),
    }
    with open(os.path.join(out_dir, "data.json"), "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(out_dir, "bars.json"), "w", encoding="utf-8") as f:
        json.dump(build_bars(rows), f, separators=(",", ":"))
    here = os.path.dirname(os.path.abspath(__file__))
    version = str(abs(hash(updated)) % 10 ** 8)
    for name in ASSETS:
        src = os.path.join(here, "terminal_assets", name)
        if name.endswith(".html"):
            with open(src, encoding="utf-8") as f:
                page = f.read().replace("__V__", version)
            with open(os.path.join(out_dir, name), "w", encoding="utf-8") as f:
                f.write(page)
        else:
            shutil.copyfile(src, os.path.join(out_dir, name))
    return out_dir
