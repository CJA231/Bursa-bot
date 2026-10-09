"""
用 Yahoo Finance 的 Screener 功能，按"地区 = 马来西亚"抓出全部股票代码，
整理成 data/watchlist.json，供 main.py 读取当作扫描范围。

每天第一次跑报告之前自动更新一次 (daily.yml，带 --if-stale)：新上市的股票当天就进名单，
公司改名、下市也跟着改。和上一份名单比较的结果 (新上市 / 改名 / 下市) 记在 data/watchlist_changes.json，
报告「今日市场」会列出最近的变动。

手动运行:
    python scripts/fetch_watchlist.py            # 马上重抓
    python scripts/fetch_watchlist.py --if-stale # 今天 (马来西亚时间) 已经抓过就跳过
"""
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone

import yfinance as yf
from yfinance import EquityQuery

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUTPUT_PATH = os.path.join(ROOT, "data", "watchlist.json")
CHANGES_PATH = os.path.join(ROOT, "data", "watchlist_changes.json")
DETAIL_DIR = os.path.join(ROOT, "docs", "stock")  # 个股资料 (公司全名、财报)：改名后删掉，下次跑报告重抓
PAGE_SIZE = 250  # Yahoo 单次请求上限
MAX_PAGES = 20   # 安全上限，避免地区筛选出错时无限翻页
MIN_KEEP = 0.9   # 这次抓到的数量不到上一份的 90%：多半是 Yahoo 出错 / 只回了一部分 → 不覆盖，保留旧名单
KEEP_DAYS = 60   # 变动记录保留多久
MYT = timezone(timedelta(hours=8))


def fetch_malaysia_equities():
    query = EquityQuery("eq", ["region", "my"])
    seen = {}
    offset = 0

    for _ in range(MAX_PAGES):
        result = yf.screen(query, offset=offset, size=PAGE_SIZE, sortField="ticker", sortAsc=True)
        quotes = result.get("quotes", [])
        total = result.get("total", 0)
        print(f"抓取中... offset={offset}, 本页 {len(quotes)} 支, 总数 {total}")

        for item in quotes:
            symbol = item.get("symbol")
            quote_type = item.get("quoteType")
            if not symbol or quote_type != "EQUITY":
                continue  # 跳过权证/ETF/REIT等非普通股票
            name = item.get("shortName") or item.get("longName") or symbol
            seen[symbol] = name.strip()

        offset += PAGE_SIZE
        if offset >= total or not quotes:
            break
        time.sleep(1)  # 避免请求过快

    return seen


def load_json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def diff(old, new, today):
    """old / new: {symbol: name} → 变动列表 (新上市 / 改名 / 下市)"""
    events = []
    for sym in sorted(new.keys() - old.keys()):
        events.append({"date": today, "type": "new", "symbol": sym, "name": new[sym]})
    for sym in sorted(old.keys() - new.keys()):
        events.append({"date": today, "type": "removed", "symbol": sym, "name": old[sym]})
    for sym in sorted(old.keys() & new.keys()):
        if old[sym] != new[sym]:
            events.append({"date": today, "type": "renamed", "symbol": sym, "name": new[sym], "old": old[sym]})
    return events


def main():
    today = datetime.now(MYT).strftime("%Y-%m-%d")
    changes = load_json(CHANGES_PATH, {})
    if "--if-stale" in sys.argv and changes.get("updated") == today:
        print(f"今天 ({today}) 已经更新过股票名单，跳过")
        return

    old_list = load_json(OUTPUT_PATH, [])
    old = {x["symbol"]: x["name"] for x in old_list if x.get("symbol")}
    new = fetch_malaysia_equities()
    if not new or (old and len(new) < len(old) * MIN_KEEP):
        print(f"这次只抓到 {len(new)} 支 (上一份 {len(old)} 支)，可能是 Yahoo 出错，保留旧名单")
        return

    events = diff(old, new, today) if old else []
    cutoff = (datetime.now(MYT) - timedelta(days=KEEP_DAYS)).strftime("%Y-%m-%d")
    history = [e for e in changes.get("events", []) if e.get("date", "") >= cutoff]
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump([{"symbol": s, "name": n} for s, n in sorted(new.items())], f, ensure_ascii=False, indent=2)
    with open(CHANGES_PATH, "w", encoding="utf-8") as f:
        json.dump({"updated": today, "count": len(new), "events": events + history}, f, ensure_ascii=False, indent=2)

    for e in events:
        if e["type"] == "renamed":  # 公司全名 / 新闻关键词是旧的 → 删掉个股资料，下次跑报告重抓
            path = os.path.join(DETAIL_DIR, e["symbol"].split(".")[0] + ".json")
            if os.path.exists(path):
                os.remove(path)
    label = {"new": "新上市", "removed": "下市", "renamed": "改名"}
    for e in events:
        print(f"{label[e['type']]}: {e['symbol']} {e.get('old', '') + ' → ' if e.get('old') else ''}{e['name']}")
    print(f"完成，共 {len(new)} 支股票 (新上市 {sum(e['type'] == 'new' for e in events)}、改名 {sum(e['type'] == 'renamed' for e in events)}、"
          f"下市 {sum(e['type'] == 'removed' for e in events)})，已写入 {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
