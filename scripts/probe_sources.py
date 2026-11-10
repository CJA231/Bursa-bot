"""
检查外部数据来源在 GitHub Actions 上能不能连上 (公告、新闻这些网站常常挡数据中心的 IP)。
用法: 在 Actions 手动跑 Debug Stock，symbol 填 PROBE；或本地 python scripts/probe_sources.py [股票代码]
每个网址印出 HTTP 状态、内容类型、长度和开头一小段，方便判断能不能拿来解析。
"""
import re
import sys

import requests

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      "Accept": "text/html,application/json,application/xml;q=0.9,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.9"}


def urls(code, name):
    return [
        ("bursa api", f"https://www.bursamalaysia.com/api/v1/announcements/search?ann_type=company&company={code}&per_page=5&page=1"),
        ("bursa page", f"https://www.bursamalaysia.com/market_information/announcements/company_announcement?company={code}"),
        ("bursa disclosure", "https://disclosure.bursamalaysia.com/FileAccess/apbursaweb/"),
        ("klsescreener", f"https://www.klsescreener.com/v2/announcements/stock/{code}"),
        ("klsescreener list", "https://www.klsescreener.com/v2/announcements"),
        ("malaysiastock.biz", f"https://www.malaysiastock.biz/Company-Announcement.aspx?securityCode={code}"),
        ("i3investor", f"https://klse.i3investor.com/web/stock/announcement/{code}"),
        ("thestar", f"https://www.thestar.com.my/business/marketwatch/stocks/?qcounter={name}"),
        ("marketscreener", f"https://www.marketscreener.com/search/?q={name}"),
        ("google news rss", f"https://news.google.com/rss/search?q=%22{name}%22+bursa+announcement&hl=en-MY&gl=MY&ceid=MY:en"),
    ]


def main():
    code = sys.argv[1] if len(sys.argv) > 1 else "0024"
    name = sys.argv[2] if len(sys.argv) > 2 else "JAG"
    for label, url in urls(code, name):
        try:
            r = requests.get(url, headers=UA, timeout=20)
            body = r.text
            snippet = re.sub(r"\s+", " ", body[:400])
            anns = len(re.findall(r"announcement", body, re.I))
            print(f"[{label}] {r.status_code} {r.headers.get('content-type', '')[:40]} len={len(body)} 'announcement'×{anns}\n    {url}\n    {snippet[:300]}")
        except Exception as e:
            print(f"[{label}] ERROR {type(e).__name__}: {e}\n    {url}")


if __name__ == "__main__":
    main()
