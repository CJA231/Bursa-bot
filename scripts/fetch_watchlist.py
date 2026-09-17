"""
用 Yahoo Finance 的 Screener 功能，按"地区 = 马来西亚"抓出全部股票代码，
整理成 data/watchlist.json，供 main.py 读取当作扫描范围。

手动运行 (通常只需要偶尔跑一次，新股上市/下市后再重跑):
    python scripts/fetch_watchlist.py
"""
import json
import os
import time

import yfinance as yf
from yfinance import EquityQuery

OUTPUT_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "watchlist.json")
PAGE_SIZE = 250  # Yahoo 单次请求上限
MAX_PAGES = 20   # 安全上限，避免地区筛选出错时无限翻页


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
            seen[symbol] = name

        offset += PAGE_SIZE
        if offset >= total or not quotes:
            break
        time.sleep(1)  # 避免请求过快

    return seen


def main():
    equities = fetch_malaysia_equities()
    watchlist = [
        {"symbol": symbol, "name": name}
        for symbol, name in sorted(equities.items())
    ]

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(watchlist, f, ensure_ascii=False, indent=2)

    print(f"完成，共 {len(watchlist)} 支股票，已写入 {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
