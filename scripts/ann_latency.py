"""
记录各公告来源的延迟 / 完整度：每次运行对同一组股票，看每个网站上「最新一条公告的日期」和「最近 7 天几条」，
连同抓取时间一起追加到 data/ann_latency.json。跑几天之后用 --report 看哪个网站慢、慢几天、漏多少。

来源 (11/11 在 GitHub Actions 上实测能直接读的)：
- KLSE Screener 个股页 (报告现在用的)：/v2/announcements/stock/<代码>，用 main.parse_klse_announcements 解析
- i3investor 个股页：/web/stock/announcement/<代码>，页面里的 const dtdata = [[日期, 链接+标题], ...]
MalaysiaStock.biz、i3investor 的全市场列表都要 JavaScript 才载入，脚本读不到，所以不比。
Bursa 官网在 Actions 上一律 403，也比不了。

用法: python scripts/ann_latency.py            # 记录一次 (daily.yml 每次运行后跑)
      python scripts/ann_latency.py --report   # 印出统计
"""
import json
import os
import re
import sys
from datetime import datetime, timedelta

import requests

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, ROOT)
OUT = os.path.join(ROOT, "data", "ann_latency.json")
KEEP_DAYS = 30
# 公告多、常有新公告的大型股 + 几支中小型股 (固定一组，前后才比得了)
CODES = ["1155", "1295", "1023", "5347", "6888", "5225", "0166", "7113", "5398", "0097", "3182", "5285"]
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9"}
I3_URL = "https://klse.i3investor.com/web/stock/announcement/{}"
I3_ROW_RE = re.compile(r'\["(\d{4}-\d{2}-\d{2})","<a href=\'/web/announcement/detail/(\d+)\'')


def klse_dates(code, today):
    os.environ.setdefault("DEEPSEEK_KEY", "unused")  # 只借 main 的解析函数，不会调用 DeepSeek
    import main as m
    r = requests.get(m.KLSE_ANN_STOCK.format(code), headers=UA, timeout=20)
    r.raise_for_status()
    return [x["date"] for x in m.parse_klse_announcements(r.text, today)]


def i3_dates(code, today):
    r = requests.get(I3_URL.format(code), headers=UA, timeout=20)
    r.raise_for_status()
    return [d for d, _ in I3_ROW_RE.findall(r.text)]


SOURCES = (("klse", klse_dates), ("i3", i3_dates))


def summarize(dates, today):
    week = (today - timedelta(days=7)).isoformat()
    return {"latest": max(dates) if dates else None, "n7": sum(1 for d in dates if d >= week), "n": len(dates)}


def record():
    from zoneinfo import ZoneInfo
    now = datetime.now(ZoneInfo("Asia/Kuala_Lumpur"))
    today = now.date()
    row = {"t": now.strftime("%Y-%m-%d %H:%M"), "s": {}}
    for code in CODES:
        for name, fn in SOURCES:
            try:
                row["s"].setdefault(code, {})[name] = summarize(fn(code, today), today)
            except Exception as e:
                row["s"].setdefault(code, {})[name] = {"err": f"{type(e).__name__}: {str(e)[:80]}"}
    try:
        with open(OUT, encoding="utf-8") as f:
            log = json.load(f)
    except (OSError, ValueError):
        log = {"v": 1, "codes": CODES, "runs": []}
    cut = (now - timedelta(days=KEEP_DAYS)).strftime("%Y-%m-%d")
    log["runs"] = [r for r in log.get("runs", []) if r["t"] >= cut] + [row]
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(log, f, ensure_ascii=False, separators=(",", ":"))
    ok = {n: sum(1 for c in row["s"].values() if "latest" in c.get(n, {})) for n, _ in SOURCES}
    print(f"📮 公告来源记录 {row['t']}：" + "，".join(f"{n} {ok[n]}/{len(CODES)} 支读得到" for n, _ in SOURCES))


def report():
    with open(OUT, encoding="utf-8") as f:
        log = json.load(f)
    runs = log["runs"]
    print(f"{len(runs)} 次记录，{runs[0]['t']} ~ {runs[-1]['t']}")
    names = [n for n, _ in SOURCES]
    # 每支股票、每个来源：最新公告日期第一次出现是哪一次运行 → 跟最早出现的来源比，慢多久
    lag = {n: [] for n in names}
    fail = {n: 0 for n in names}
    for code in log.get("codes", CODES):
        first = {}  # (来源, 日期) → 第一次看到的时间
        for r in runs:
            for n in names:
                s = r["s"].get(code, {}).get(n, {})
                if "err" in s:
                    fail[n] += 1
                elif s.get("latest") and (n, s["latest"]) not in first:
                    first[(n, s["latest"])] = r["t"]
        for d in sorted({d for (_, d) in first}):
            seen = {n: first.get((n, d)) for n in names}
            got = [t for t in seen.values() if t]
            for n in names:
                if seen[n]:
                    lag[n].append((datetime.strptime(seen[n], "%Y-%m-%d %H:%M") - datetime.strptime(min(got), "%Y-%m-%d %H:%M")).total_seconds() / 3600)
    for n in names:
        xs = sorted(lag[n])
        med = xs[len(xs) // 2] if xs else None
        print(f"{n}: {len(xs)} 个新公告日期；比最早的来源慢 中位数 {med if med is None else round(med, 1)} 小时，"
              f"最多 {round(xs[-1], 1) if xs else None} 小时；出错 {fail[n]} 次")
    last = runs[-1]["s"]
    print("最近一次：各股最新公告日期 (" + " / ".join(names) + ")")
    for code in log.get("codes", CODES):
        print(f"  {code}: " + " / ".join(str(last.get(code, {}).get(n, {}).get("latest") or last.get(code, {}).get(n, {}).get("err")) for n in names)
              + "   近 7 天条数 " + " / ".join(str(last.get(code, {}).get(n, {}).get("n7", "-")) for n in names))


if __name__ == "__main__":
    report() if "--report" in sys.argv else record()
