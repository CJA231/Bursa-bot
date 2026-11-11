"""
马股新股 (IPO) 日历 + 上市表现。终端版「日历」页顶部的 IPO 区和月历里的 IPO 日期都用这份资料。

来源 (都是公开资料，只记录事实，不做好坏判断)：
- KLSE Screener IPO 页 https://www.klsescreener.com/v2/ipos ：每家一张卡片，有代码、简称、全名、招股价、
  开始 / 截止认购、抽签、分配、上市日期、发行规模、市值、板块 (Main / ACE / LEAP)、行业、子行业。
  不登入只看得到最近约两年 (2026-11 实测 108 家)。
- 超额认购倍数：同一网站的个股页 (/v2/stocks/view/<代码>) 新闻栏里的标题，例如「MyDCD IPO oversubscribed 36.46 times」。
  标题里要有公司名称才算 (避免拿到别家的数字)；找不到就留空，不猜。
- 首日开盘 / 收盘、上市至今：Yahoo Finance 日线 (不复权的价格，跟招股价比)。

状态存在 data/ipos.json (跟 data/watchlist.json 一样会提交)，终端版生成时复制一份精简的到 docs/terminal/ipo.json。
IPO 页每 6 小时最多抓一次；已经算好的首日表现不再重算 (首日价格不会变)，上市至今的现价每天更新一次。

用法 (平时由 main.py 跑马股报告时自动调用)：
  python ipo_calendar.py            # 更新 data/ipos.json 并印出摘要
  python ipo_calendar.py --force    # 不管 6 小时限制
"""
import html as _html
import json
import os
import re
import sys
from datetime import datetime, timedelta

import requests

IPO_URL = "https://www.klsescreener.com/v2/ipos"
STOCK_URL = "https://www.klsescreener.com/v2/stocks/view/{}"
STATE_PATH = os.path.join("data", "ipos.json")
REFRESH_HOURS = 6
KEEP_DAYS = 400            # 上市超过约 13 个月的不再追踪 (汇总统计看近 12 个月)
SUB_WINDOW = (-45, 20)     # 截止认购后 / 上市前后这段时间才去个股页找超额认购倍数 (天)
SUB_MAX_TRIES = 8          # 上市前后那段时间每家最多找几次 (每次运行一次)，找不到就算了
SUB_OLD_TRIES = 1          # 更早上市的 (近 13 个月) 补找一次，汇总统计才有足够的样本
SUB_PER_RUN = 10           # 每次最多打开几个个股页
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
           "Accept": "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9"}
MONTHS = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}
# 时间轴上的步骤名称 → 栏位
STEPS = {"Open": "open", "Close": "close", "Ballot": "ballot", "Allotment": "allot", "Tentative Listing": "listing", "Listing": "listing"}


def _date(dm, year):
    """「20 Oct」+「2026」→ 2026-10-20"""
    m = re.match(r"(\d{1,2})\s+([A-Za-z]{3})", dm or "")
    if not m or m.group(2).lower() not in MONTHS:
        return None
    try:
        return datetime(int(year), MONTHS[m.group(2).lower()], int(m.group(1))).strftime("%Y-%m-%d")
    except ValueError:
        return None


def _int(s):
    s = (s or "").replace(",", "").strip()
    return int(s) if s.isdigit() else None


def parse_cards(page):
    """IPO 页 HTML → [{code, ticker, name, price, open, close, ballot, allot, listing, issue_size, mcap, board, sector, subsector}]"""
    body = re.sub(r"<script.*?</script>|<style.*?</style>", " ", page, flags=re.S | re.I)
    out = []
    for c in re.split(r'<div class="card mb-3 p-0">', body)[1:]:
        head = re.search(r'href="/v2/stocks/view/(\w+)"[^>]*>\s*([^<]+?)\s*</a>\s*</h4>\s*<span[^>]*>\s*([^<]+?)\s*</span>', c)
        if not head:
            continue
        price = re.search(r'title="Issue price"[^>]*>\s*([\d.]+)\s*<', c)
        toks = [_html.unescape(t.strip()) for t in re.sub(r"<[^>]+>", "|", c).split("|")]
        toks = [t for t in toks if t]

        def after(label):
            return toks[toks.index(label) + 1] if label in toks and toks.index(label) + 1 < len(toks) else None

        rec = {"code": head.group(1), "ticker": _html.unescape(head.group(2)), "name": _html.unescape(head.group(3)).title().replace(" Berhad", " Bhd"),
               "price": float(price.group(1)) if price else None,
               "issue_size": _int(after("Issue Size:")), "mcap": _int(after("Market Cap:")),
               "board": after("Board:"), "sector": after("Sector:"), "subsector": after("Sub sector:")}
        for k in ("board", "sector", "subsector"):  # 没有这一栏时，下一格会是别的标签
            if rec[k] and rec[k].endswith(":"):
                rec[k] = None
        for i, t in enumerate(toks[:-2]):
            if t in STEPS and re.fullmatch(r"\d{1,2} [A-Za-z]{3}", toks[i + 1]) and re.fullmatch(r"\d{4}", toks[i + 2]):
                rec[STEPS[t]] = _date(toks[i + 1], toks[i + 2])
        if rec.get("listing") or rec.get("close"):
            out.append(rec)
    return out


SUB_RE = re.compile(r"(over|under)[- ]?subscribed\s+(?:by\s+)?(?:about\s+|some\s+|nearly\s+|almost\s+|over\s+)?([\d,]+(?:\.\d+)?)\s*(?:times|x\b)", re.I)


def find_oversub(page, rec):
    """个股页新闻标题 / 摘要里的「oversubscribed by 36.46 times」。句子里要有公司名称 (简称或全名第一个字) 才算"""
    text = re.sub(r"\s+", " ", _html.unescape(re.sub(r"<[^>]+>", " | ", re.sub(r"<script.*?</script>|<style.*?</style>", " ", page, flags=re.S | re.I))))
    keys = {rec["ticker"].lower(), rec["name"].split()[0].lower()}
    for part in text.split(" | "):
        part = part.strip(" |")
        m = SUB_RE.search(part)
        # 公司名称要是一个完整的字 (简称像 RT 不能配到 report 里面)
        named = any(k and re.search(r"(?<![a-z0-9])" + re.escape(k) + r"(?![a-z0-9])", part.lower()) for k in keys)
        if m and named and re.search(r"\bIPO\b|public|offering|listing", part, re.I):
            n = float(m.group(2).replace(",", ""))
            if m.group(1).lower() == "under":
                return {"oversub": None, "sub_note": part.strip()[:160], "under": True}
            if 0 < n < 2000:
                return {"oversub": n, "sub_note": part.strip()[:160]}
    return None


def _perf(recs, today, log):
    """Yahoo 日线：首日开盘 / 收盘 (上市日起 7 天内第一根)，以及最新收盘价"""
    todo = [r for r in recs if r.get("listing") and r["listing"] <= today and r.get("code")]
    if not todo:
        return
    try:
        import yfinance as yf
    except Exception as e:  # noqa: BLE001
        log(f"⚠️ IPO: 没有 yfinance ({e})")
        return
    start = min(r["listing"] for r in todo)
    syms = [r["code"] + ".KL" for r in todo]
    try:
        df = yf.download(syms, start=start, interval="1d", auto_adjust=False, group_by="ticker", threads=True, progress=False)
    except Exception as e:  # noqa: BLE001
        log(f"⚠️ IPO: Yahoo 日线下载失败 ({type(e).__name__}: {e})")
        return
    for r in todo:
        sym = r["code"] + ".KL"
        try:
            d = df[sym] if len(syms) > 1 else df
            d = d.dropna(subset=["Close"])
        except Exception:  # noqa: BLE001
            continue
        if d.empty:
            continue
        dates = [x.strftime("%Y-%m-%d") for x in d.index]
        lim = (datetime.strptime(r["listing"], "%Y-%m-%d") + timedelta(days=7)).strftime("%Y-%m-%d")
        first = next((i for i, x in enumerate(dates) if r["listing"] <= x <= lim), None)
        # 首日那根定了就不再改；如果首日就是今天 (还没收盘、Yahoo 盘中的开盘价有时是 0)，下次运行再更新
        if first is not None and (r.get("d1_close") is None or r.get("d1_date") == today):
            row = d.iloc[first]
            val = lambda k: round(float(row[k]), 4) if float(row[k]) > 0 else None  # noqa: E731
            r.update({"d1_date": dates[first], "d1_open": val("Open"), "d1_high": val("High"), "d1_low": val("Low"), "d1_close": val("Close")})
        r["last"] = round(float(d["Close"].iloc[-1]), 4)
        r["last_date"] = dates[-1]


def update(path=STATE_PATH, now=None, force=False, log=print):
    """更新 data/ipos.json，回传 state。网站连不上就保留旧资料 (不会让报告失败)"""
    now = (now or datetime.now()).replace(tzinfo=None)  # main.py 传进来的是马来西亚时间 (带时区)，这里只用当地日期
    today = now.strftime("%Y-%m-%d")
    try:
        with open(path, encoding="utf-8") as f:
            state = json.load(f)
    except (OSError, ValueError):
        state = {}
    state.setdefault("ipos", {})
    last = state.get("fetched")
    if not force and last:
        try:
            if now - datetime.strptime(last, "%Y-%m-%d %H:%M") < timedelta(hours=REFRESH_HOURS):
                return state
        except ValueError:
            pass
    try:
        r = requests.get(IPO_URL, headers=HEADERS, timeout=30)
        r.raise_for_status()
        cards = parse_cards(r.text)
    except Exception as e:  # noqa: BLE001
        log(f"⚠️ IPO: KLSE Screener IPO 页抓取失败 ({type(e).__name__}: {e})，沿用上次的资料")
        return state
    if not cards:
        log("⚠️ IPO: IPO 页没有解析到任何一家 (网页格式可能改了)，沿用上次的资料")
        return state
    old = state["ipos"]
    for c in cards:
        key = c["code"]
        rec = old.get(key, {})
        rec.update({k: v for k, v in c.items() if v is not None})
        old[key] = rec
    cutoff = (now - timedelta(days=KEEP_DAYS)).strftime("%Y-%m-%d")
    for k in [k for k, v in old.items() if (v.get("listing") or v.get("close") or "9999") < cutoff]:
        del old[k]

    # 超额认购倍数 (截止认购之后才会有)
    opened = 0
    for rec in sorted(old.values(), key=lambda v: v.get("listing") or ""):
        if rec.get("oversub") is not None or rec.get("under") or opened >= SUB_PER_RUN:
            continue
        ref = rec.get("listing") or rec.get("close")
        if not rec.get("close") or rec["close"] > today or not ref:
            continue
        days = (datetime.strptime(ref, "%Y-%m-%d") - now).days
        if rec.get("sub_tries", 0) >= (SUB_MAX_TRIES if SUB_WINDOW[0] <= days <= SUB_WINDOW[1] else SUB_OLD_TRIES):
            continue
        opened += 1
        rec["sub_tries"] = rec.get("sub_tries", 0) + 1
        try:
            p = requests.get(STOCK_URL.format(rec["code"]), headers=HEADERS, timeout=30)
            hit = find_oversub(p.text, rec) if p.ok else None
        except Exception:  # noqa: BLE001
            hit = None
        if hit:
            rec.update(hit)

    _perf(list(old.values()), today, log)
    for v in old.values():  # None 的栏位不存
        for k in [k for k, x in v.items() if x is None]:
            del v[k]
    state.update({"v": 1, "fetched": now.strftime("%Y-%m-%d %H:%M"), "source": IPO_URL})
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=1, sort_keys=True)
    up = sum(1 for v in old.values() if (v.get("listing") or "") > today)
    log(f"🆕 IPO: {len(cards)} 家 (待上市 {up})，超额认购查了 {opened} 家")
    return state


# 给终端版的精简版 (只留页面用得到的栏位)
FIELDS = ("code", "ticker", "name", "price", "open", "close", "ballot", "listing", "issue_size", "mcap", "board", "sector", "subsector",
          "oversub", "under", "d1_date", "d1_open", "d1_close", "last", "last_date")


def export(state, out_path):
    rows = sorted(state.get("ipos", {}).values(), key=lambda v: v.get("listing") or v.get("close") or "", reverse=True)
    slim = [{k: r[k] for k in FIELDS if r.get(k) is not None} for r in rows]
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({"v": 1, "updated": state.get("fetched"), "source": state.get("source"), "ipos": slim}, f, ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    st = update(force="--force" in sys.argv)
    for r in sorted(st["ipos"].values(), key=lambda v: v.get("listing") or "", reverse=True)[:20]:
        print(r.get("listing"), r.get("code"), r.get("ticker"), r.get("price"), r.get("board"), "sub", r.get("oversub"),
              "d1", r.get("d1_open"), r.get("d1_close"), "last", r.get("last"))
