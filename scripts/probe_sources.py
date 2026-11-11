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


def check_klse():
    """用 main.py 里真正的解析函数抓几支股票的公告，确认格式认得出来"""
    import os
    from datetime import datetime
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    import main as m
    for code in ("0024", "1155", "5347", "7113"):
        try:
            ann = m.fetch_announcements(code + ".KL", datetime.now(m.LOCAL_TZ))
            items = ann["items"]
            print(f"[klse {code}] {len(items)} 条", *(f"\n    {x['date']} [{x['cat']}] {x['title'][:80]}" for x in items[:3]))
        except Exception as e:
            print(f"[klse {code}] ERROR {type(e).__name__}: {e}")
    try:
        rows = m.klse_announcements()
        print(f"[klse 全市场] {len(rows)} 条，例如 {rows[0] if rows else None}")
    except Exception as e:
        print(f"[klse 全市场] ERROR {type(e).__name__}: {e}")


LIST_URLS = [  # 全市场最新公告列表 (记录各网站延迟用)，先看哪个网址有、HTML 长什么样
    ("i3 latest", "https://klse.i3investor.com/web/announcement/latest"),
    ("i3 announcement", "https://klse.i3investor.com/web/announcement"),
    ("i3 stock 1155", "https://klse.i3investor.com/web/stock/announcement/1155"),
    ("msb latest", "https://www.malaysiastock.biz/Latest-Announcement.aspx"),
    ("msb corporate", "https://www.malaysiastock.biz/Corporate-Announcement.aspx"),
    ("msb stock 1155", "https://www.malaysiastock.biz/Company-Announcement.aspx?securityCode=1155"),
]


def dump_lists():
    """印出每个列表页的状态，以及前几条公告附近的 HTML (找日期 / 时间 + 标题的结构)"""
    for label, url in LIST_URLS:
        try:
            r = requests.get(url, headers=UA, timeout=25)
            body = r.text
            print(f"[{label}] {r.status_code} len={len(body)} {url}")
            if r.status_code != 200:
                continue
            # 公告链接 (i3: /web/announcement/detail/<id>；msb: 含 announcement 的 .aspx 链接) 附近的 HTML
            pat = r"/web/announcement/detail/\d+" if "i3" in label else r"href=\"[^\"]*[Aa]nnouncement[^\"]*\d[^\"]*\""
            hits = [m.start() for m in re.finditer(pat, body)]
            print(f"    {len(hits)} announcement links")
            for h in hits[:2] + hits[10:11]:
                print("    ---- " + re.sub(r"\s+", " ", body[max(0, h - 900):h + 500]))
        except Exception as e:
            print(f"[{label}] ERROR {type(e).__name__}: {e}")


def main():
    if "--lists" in sys.argv:
        dump_lists()
        return
    if "--klse" in sys.argv:
        check_klse()
        return
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    code = args[0] if args else "0024"
    name = args[1] if len(args) > 1 else "JAG"
    for label, url in urls(code, name):
        try:
            r = requests.get(url, headers=UA, timeout=20)
            body = r.text
            snippet = re.sub(r"\s+", " ", body[:400])
            anns = len(re.findall(r"announcement", body, re.I))
            print(f"[{label}] {r.status_code} {r.headers.get('content-type', '')[:40]} len={len(body)} 'announcement'×{anns}\n    {url}\n    {snippet[:300]}")
            if "--html" in sys.argv and r.status_code == 200 and label in ("klsescreener", "klsescreener list", "i3investor", "malaysiastock.biz"):
                hits = [m.start() for m in re.finditer(r"<a[^>]+href=\"[^\"]*announcement[^\"]*\d[^\"]*\"", body, re.I)]
                print(f"    {len(hits)} announcement links")
                for h in hits[2:5]:
                    print("    ---- " + re.sub(r"\s+", " ", body[max(0, h - 700):h + 500]))
        except Exception as e:
            print(f"[{label}] ERROR {type(e).__name__}: {e}\n    {url}")


if __name__ == "__main__":
    main()
