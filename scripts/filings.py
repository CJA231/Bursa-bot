"""
原始财报文件索引 (docs/filings/<代码>.json)：每一季的季报、年报 (Annual Report & CG Report)、经审计账目，
都附上 Bursa 原文网址 (附件 PDF 在那一页)，终端版财报面板和 IR 页面列成「按财政年度」的表格，点一下就到原文。

- 来源：KLSE Screener (内容来自 Bursa)。个股页的季报列表 → 每季的财报页里有「View original report」(Bursa disclosure 原文)；
  年报、经审计账目从个股公告的类别筛选 (AR,ARCO / AA,AACO) 来，公告页里有 Bursa 原公告的网址
- 原文网址读一次就存起来 (不会变)，之后只读新的一季 / 新的年报
- GitHub Actions 打不开 Bursa 网站 (403)，所以只存网址，不下载 PDF；用户的浏览器可以直接打开

用法：python scripts/filings.py [--codes 5347,7113] [--limit 30] [--dry-run]
"""
import argparse
import json
import os
import re
import sys
import time
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import main as m  # noqa: E402

OUT_DIR = os.path.join("docs", "filings")
QUARTERS = 12            # 最近 12 季 (3 年)
YEARS = 5                # 年报 / 经审计账目最近 5 年
REFRESH_DAYS = 7
STOCK_VIEW = "https://www.klsescreener.com/v2/stocks/view/{}"
FIN_REPORT = "https://www.klsescreener.com/v2/stock/financial-report/{}/{}"
BURSA_ANN = "https://www.bursamalaysia.com/market_information/announcements/company_announcement/announcement_details?ann_id={}"
PAUSE = 0.4
_MON = {mn: i for i, mn in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}


def read_json(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:  # noqa: BLE001
        return default


def get(url):
    r = m.requests.get(url, headers=m.KLSE_HEADERS, timeout=25)
    r.raise_for_status()
    time.sleep(PAUSE)
    return r.text


def quarter_dates(view_html, code):
    """个股页里每一季财报页的期末日期 (新到旧)"""
    ds = set(re.findall(r"/v2/stock/financial-report/" + re.escape(code) + r"/(\d{4}-\d{2}-\d{2})", view_html))
    return sorted(ds, reverse=True)


def fye_month(view_html, detail):
    """财政年度结束的月份：个股页「Annual」表第一行 (例如 31 Aug, 2026)，没有就看 Yahoo 年报的期末日期"""
    k = view_html.find('id="annual"')
    if k >= 0:
        d = re.search(r"\b\d{1,2} ([A-Z][a-z]{2}), \d{4}", re.sub(r"<[^>]+>", " ", view_html[k:k + 4000]))
        if d and d.group(1).lower() in _MON:
            return _MON[d.group(1).lower()]
    per = (((detail or {}).get("fin") or {}).get("annual") or {}).get("periods") or []
    return int(per[-1][5:7]) if per else 12


def fy_quarter(period, fye):
    """期末日期 → (财政年度, 第几季)。财政年度用年度结束那一年表示 (FY2026 = 截至 2026 年 fye 月)"""
    y, mo = int(period[:4]), int(period[5:7])
    return (y if mo <= fye else y + 1), ((mo - fye - 1) % 12) // 3 + 1


def original_link(report_html):
    hit = re.search(r'href="(https?://disclosure\.bursamalaysia\.com/FileAccess/viewHtml\?e=\d+)"', report_html)
    if hit:
        return hit.group(1)
    ann = re.search(r"announcement_details\?ann_id=(\d+)", report_html)
    return BURSA_ANN.format(ann.group(1)) if ann else None


def annual_items(code, today):
    """年报 (AR) 和经审计账目 (AA) 的公告：年份从标题读 (列表的日期只有日 + 月，旧的年份推不准)"""
    out = []
    for cat, kind in (("AR,ARCO", "ar"), ("AA,AACO", "aa")):
        items = m.parse_klse_announcements(get(m.KLSE_ANN_STOCK.format(code) + "?category=" + cat), today)
        for x in items:
            if kind == "ar" and not re.search(r"annual report", x["title"], re.I):
                continue
            yrs = re.findall(r"\b(20\d{2}|19\d{2})\b", x["title"])
            if not yrs:
                continue
            out.append({"kind": kind, "year": int(yrs[-1]), "title": x["title"][:120], "id": x["id"], "page": x["link"]})
    return out


def process(code, now, log=print):
    path = os.path.join(OUT_DIR, f"{code}.json")
    old = read_json(path, {}) or {}
    detail = read_json(os.path.join("docs", "stock", f"{code}.json"), {}) or {}
    view = get(STOCK_VIEW.format(code))
    fye = fye_month(view, detail)
    known_q = {q["period"]: q for q in old.get("quarters") or [] if q.get("orig")}
    quarters, fetched = [], 0
    for d in quarter_dates(view, code)[:QUARTERS]:
        fy, qn = fy_quarter(d, fye)
        q = {"period": d, "fy": fy, "q": qn, "page": FIN_REPORT.format(code, d), "orig": (known_q.get(d) or {}).get("orig")}
        if not q["orig"]:
            try:
                q["orig"] = original_link(get(q["page"]))
                fetched += 1
            except Exception as e:  # noqa: BLE001
                log(f"⚠️ {code} {d} 财报页读取失败 ({type(e).__name__})")
        quarters.append(q)
    known_a = {a["id"]: a for a in old.get("annual") or [] if a.get("orig")}
    annual = []
    try:
        items = annual_items(code, now.date())
    except Exception as e:  # noqa: BLE001
        log(f"⚠️ {code} 年报列表读取失败 ({type(e).__name__})")
        items = [dict(a) for a in old.get("annual") or []]
    newest = max([a["year"] for a in items] or [now.year])
    for a in sorted(items, key=lambda x: (-x["year"], x["kind"])):
        if a["year"] <= newest - YEARS:
            continue
        a["orig"] = (known_a.get(a["id"]) or {}).get("orig") or a.get("orig")
        if not a["orig"]:
            try:
                a["orig"] = original_link(get(a["page"]))
                fetched += 1
            except Exception as e:  # noqa: BLE001
                log(f"⚠️ {code} 年报公告读取失败 ({type(e).__name__})")
        annual.append(a)
    rec = {"v": 1, "code": code, "updated": now.strftime("%Y-%m-%d %H:%M"), "fye_month": fye, "quarters": quarters, "annual": annual,
           "bursa": f"https://www.bursamalaysia.com/market_information/announcements/company_announcement?company={code}",
           "source": "Bursa Malaysia (via KLSE Screener)"}
    return rec, fetched


def pick(limit, now):
    """还没有索引的公司 (按成交额)；已有的：过了 REFRESH_DAYS，或报告里出现新的季报公告"""
    term = read_json(os.path.join("docs", "terminal", "data.json"), {}) or {}
    order = [s[0] for s in sorted(term.get("stocks") or [], key=lambda s: (-(s[11] or 0), -(s[5] or 0)))]
    first, rest = [], []
    for code in order:
        have = read_json(os.path.join(OUT_DIR, f"{code}.json"))
        if not have:
            rest.append(code)
            continue
        age = (now.replace(tzinfo=None) - datetime.strptime(have["updated"][:16], "%Y-%m-%d %H:%M")).days
        ann = read_json(os.path.join(m.ANN_DIR, f"{code}.json"), {}) or {}
        newq = any(re.search(r"quarterly rpt|annual report|audited", x.get("title", ""), re.I) and x.get("date", "") > have["updated"][:10]
                   for x in ann.get("items") or [])
        if newq:
            first.append(code)
        elif age >= REFRESH_DAYS:
            rest.append(code)
    return (first + rest)[:limit]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--codes", default="")
    ap.add_argument("--limit", type=int, default=30)
    ap.add_argument("--minutes", type=float, default=0, help="这次最多跑几分钟 (0 = 不限)；时间到就停，剩下的下次接着做")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    now = datetime.now(m.LOCAL_TZ)
    os.makedirs(OUT_DIR, exist_ok=True)
    todo = [c.strip() for c in a.codes.split(",") if c.strip()] or pick(a.limit, now)
    print(f"📂 原始财报文件：这次处理 {len(todo)} 家")
    done = 0
    deadline = time.time() + a.minutes * 60 if a.minutes else None
    for i, code in enumerate(todo):
        if deadline and time.time() > deadline:
            print(f"   时间到 ({a.minutes:g} 分钟)，这次做了 {i} 家，其余 {len(todo) - i} 家下次再做")
            break
        try:
            rec, fetched = process(code, now)
        except Exception as e:  # noqa: BLE001
            print(f"⚠️ {code} 失败：{type(e).__name__}: {e}")
            continue
        miss = sum(1 for q in rec["quarters"] if not q["orig"])
        print(f"   {code} 季报 {len(rec['quarters'])} (缺原文 {miss})，年报 / 审计 {len(rec['annual'])}，新读 {fetched} 页，财政年度截至 {rec['fye_month']} 月")
        if a.dry_run:
            print(json.dumps(rec, ensure_ascii=False, indent=1)[:2500])
            continue
        with open(os.path.join(OUT_DIR, f"{code}.json"), "w", encoding="utf-8") as f:
            json.dump(rec, f, ensure_ascii=False, separators=(",", ":"))
        done += 1
    print(f"📂 写入 {done} 家")


if __name__ == "__main__":
    main()
