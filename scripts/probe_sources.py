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


def dump_views():
    """公告内文 (KLSE Screener /v2/announcements/view/<id>) 去掉标签后长什么样；新上市 / IPO 页面在不在"""
    import os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    os.environ.setdefault("DEEPSEEK_KEY", "unused")
    import main as m
    rows = m.klse_announcements()
    want = [r for r in rows if re.search(r"book closure|entitlement|dividend|general meeting|AGM|EGM|listing|warrant|bonus|rights|IPO|prospectus", r["title"], re.I)][:4]
    print(f"[list] {len(rows)} rows; picked", [(r["id"], r["title"][:60]) for r in want])
    for r in want:
        h = requests.get(m.KLSE_ANN_VIEW.format(r["id"]), headers=UA, timeout=20).text
        body = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", h)
        txt = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", body))
        k = txt.find(r["title"][:25])
        links = re.findall(r'href="([^"]*(?:bursamalaysia|disclosure)[^"]*)"', h)[:3]
        print(f"---- view {r['id']} len={len(h)} title_at={k} links={links}")
        print("    " + txt[max(0, k):k + 1800] if k >= 0 else "    " + txt[:1800])
    for label, url in (("klse ipo", "https://www.klsescreener.com/v2/ipo"), ("klse new listing", "https://www.klsescreener.com/v2/stocks/new-listing"),
                       ("klse warrants", "https://www.klsescreener.com/v2/warrants"), ("i3 ipo", "https://klse.i3investor.com/web/ipo"),
                       ("i3 entitlement 1155", "https://klse.i3investor.com/web/stock/entitlement/1155"), ("msb ipo", "https://www.malaysiastock.biz/Listed-Companies.aspx?type=I")):
        try:
            rr = requests.get(url, headers=UA, timeout=20)
            t = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", rr.text)))
            print(f"[{label}] {rr.status_code} len={len(rr.text)} dtdata={'dtdata' in rr.text}\n    {t[:700]}")
        except Exception as e:
            print(f"[{label}] ERROR {type(e).__name__}: {e}")


def dump_nav():
    """KLSE Screener / i3investor 菜单里 IPO、Entitlements、Meeting Calendar、Additional Listing 的真正网址，以及那些页面的结构"""
    pages = {}
    for site, url in (("klse", "https://www.klsescreener.com/v2/announcements"), ("i3", "https://klse.i3investor.com/web/stock/entitlement/1155")):
        h = requests.get(url, headers=UA, timeout=20).text
        for href, label in re.findall(r'<a[^>]+href="([^"#]+)"[^>]*>\s*([^<]{2,40}?)\s*</a>', h):
            if re.search(r"ipo|entitle|dividend|meeting|additional|listing|warrant|share issued", label + href, re.I):
                full = href if href.startswith("http") else ("https://www.klsescreener.com" if site == "klse" else "https://klse.i3investor.com") + href
                pages.setdefault(full, label.strip())
    print("[nav]", pages)
    for url, label in list(pages.items())[:9]:
        try:
            rr = requests.get(url, headers=UA, timeout=20)
            body = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", rr.text)
            t = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", body))
            k = max(t.find("Date"), 0)
            dt = re.search(r"const dtdata = (\[.{0,700})", rr.text, re.S)
            print(f"[{label}] {rr.status_code} {url} len={len(rr.text)} tables={rr.text.count('<tr')}\n    text: {t[k:k + 900]}\n    dtdata: {dt.group(1) if dt else None}")
        except Exception as e:
            print(f"[{label}] ERROR {e}")


def dump_ipo():
    """KLSE Screener 的 IPO 页 (/v2/ipos)：印出表格表头、前几行和详情页链接，看看能不能解析"""
    for url in ("https://www.klsescreener.com/v2/ipos", "https://www.klsescreener.com/v2/ipos/listed"):
        try:
            r = requests.get(url, headers=UA, timeout=30)
        except Exception as e:
            print(f"[ipo] {url} ERR {e}"); continue
        h = r.text
        print(f"==== {url} -> {r.status_code} len={len(h)} final={r.url}")
        if r.status_code != 200:
            print(h[:300]); continue
        tables = re.findall(r"<table.*?</table>", h, re.S | re.I)
        print(f"tables={len(tables)}")
        for i, t in enumerate(tables[:4]):
            ths = [re.sub(r"<[^>]+>|\s+", " ", x).strip() for x in re.findall(r"<th[^>]*>(.*?)</th>", t, re.S | re.I)]
            rows = re.findall(r"<tr[^>]*>(.*?)</tr>", t, re.S | re.I)
            print(f"--- table {i}: {len(rows)} rows, th={ths}")
            for row in rows[:6]:
                tds = [re.sub(r"<[^>]+>|\s+", " ", x).strip() for x in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, re.S | re.I)]
                links = re.findall(r'href="([^"]+)"', row)
                print("   ", tds, links[:3])
        links = sorted(set(re.findall(r'href="(/v2/ipos?/[^"#?]+)"', h)))
        print("ipo links:", links[:20])
        if not tables:
            from collections import Counter
            body = re.sub(r"<script.*?</script>|<style.*?</style>", " ", h, flags=re.S | re.I)
            print("body len (no script/style):", len(body))
            cls = Counter(c for x in re.findall(r'class="([^"]+)"', body) for c in x.split())
            print("top classes:", cls.most_common(60))
            hrefs = Counter(re.sub(r"\d+", "N", x) for x in re.findall(r'href="(/v2/[^"#?]*)', body))
            print("href patterns:", hrefs.most_common(30))
            scripts = re.findall(r"<script[^>]*>(.*?)</script>", h, re.S | re.I)
            for sc in sorted(scripts, key=len, reverse=True)[:3]:
                print("---- big script len", len(sc), re.sub(r"\s+", " ", sc[:1500]))
            for kw in ("Listing", "Offer Price", "Closing", "Prospectus", "Oversub", "Market"):
                k = body.find(kw)
                print(f"---- around {kw!r} @ {k}:", re.sub(r"\s+", " ", body[max(0, k - 1500):k + 2500]) if k >= 0 else "-")
    # 详情页 (第一条链接) 的结构
    try:
        h = requests.get("https://www.klsescreener.com/v2/ipos", headers=UA, timeout=30).text
        det = [l for l in re.findall(r'href="(/v2/ipos?/[^"#?]+)"', h) if l.rstrip("/") not in ("/v2/ipos", "/v2/ipo")]
        if det:
            u = "https://www.klsescreener.com" + det[0]
            d = requests.get(u, headers=UA, timeout=30)
            txt = re.sub(r"\s+", " ", re.sub(r"<script.*?</script>|<style.*?</style>", " ", d.text, flags=re.S))
            k = txt.find("Offer")
            print(f"==== detail {u} -> {d.status_code} len={len(d.text)}")
            print(re.sub(r"<[^>]+>", " | ", txt[max(0, k - 1500):k + 3500]))
    except Exception as e:
        print("detail ERR", e)


def dump_ipo2():
    """IPO 第二轮：一张完整卡片的文字、个股页里有没有板块 / 业务 / 认购资料、公告里有没有超额认购"""
    import os
    from datetime import datetime
    h = requests.get("https://www.klsescreener.com/v2/ipos", headers=UA, timeout=30).text
    body = re.sub(r"<script.*?</script>|<style.*?</style>", " ", h, flags=re.S | re.I)
    cards = re.split(r'<div class="card mb-3 p-0">', body)[1:]
    print("cards:", len(cards))
    years = re.findall(r'<option[^>]*value="(\d{4})"', h)
    print("year options:", years[:15])
    for c in cards[:2] + cards[-2:]:
        print("---- card:", re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " | ", c))[:1500])
    codes = []
    for c in cards:
        m = re.search(r'href="/v2/stocks/view/(\w+)"', c)
        if m: codes.append(m.group(1))
    print("codes:", codes[:30])
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    import main as m
    for code in codes[2:5]:
        r = requests.get(f"https://www.klsescreener.com/v2/stocks/view/{code}", headers=UA, timeout=30)
        t = re.sub(r"\s+", " ", re.sub(r"<script.*?</script>|<style.*?</style>", " ", r.text, flags=re.S | re.I))
        print(f"==== stock view {code} -> {r.status_code} len={len(r.text)}")
        for kw in ("Market", "Sector", "Board", "IPO", "Listing", "ubscri", "Business", "Shariah", "Category"):
            for k in [x.start() for x in re.finditer(kw, t)][:2]:
                print(f"  [{kw}]", re.sub(r"<[^>]+>", " | ", t[max(0, k - 200):k + 400]))
        try:
            ann = m.fetch_announcements(code + ".KL", datetime.now(m.LOCAL_TZ))
            items = ann["items"]
            print(f"  ann {len(items)}:", *(f"\n    {x['date']} [{x['cat']}] {x['title'][:110]} id={x.get('id')}" for x in items[:12]))
            sub = [x for x in items if re.search(r"subscri|ballot|listing|prospectus", x["title"], re.I)]
            for x in sub[:2]:
                if x.get("id"):
                    v = requests.get(f"https://www.klsescreener.com/v2/announcements/view/{x['id']}", headers=UA, timeout=30).text
                    vt = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", re.sub(r"<script.*?</script>|<style.*?</style>", " ", v, flags=re.S | re.I)))
                    k = max(vt.find("subscri"), 0)
                    print(f"  ---- view {x['id']}:", vt[max(0, k - 1200):k + 1800])
        except Exception as e:
            print("  ann ERR", e)


def main():
    if "--ipo2" in sys.argv:
        dump_ipo2()
        return
    if "--ipo" in sys.argv:
        dump_ipo()
        return
    if "--nav" in sys.argv:
        dump_nav()
        return
    if "--views" in sys.argv:
        dump_views()
        return
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
