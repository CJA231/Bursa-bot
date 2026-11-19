"""
主要股东持股变动 (docs/holders/<代码>.json)：读 Bursa 的主要股东公告 (CA 2016 第 137 / 138 / 139 条)，
整理出每个主要股东最新的直接 / 间接持股 %，和这段期间最早一笔比较的变化。终端版个股页、IR 页面画持股图用。

- 来源：KLSE Screener 个股公告 (类别 SH,CHSH = Changes in Shareholdings，内容同样来自 Bursa) 的公告正文
- 公告是 Bursa 固定格式 (Name / Date of change / No of securities / Acquired|Disposed / Direct (%) …)，用程序直接读，不经过 AI
- 已经读过的公告 (按编号) 存在文件里，下次只读新的；每家公司最多回看 HIST_DAYS 天
- 只有「这段期间有申报过」的主要股东会出现 (很久没变动的股东不在公告里)，页面上会写清楚

用法：python scripts/holders.py [--codes 5347,1155] [--limit 40] [--dry-run]
不带 --codes：先做报告里有新持股公告的公司，再按成交额补还没有资料的公司。
"""
import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import main as m  # noqa: E402

OUT_DIR = os.path.join("docs", "holders")
HIST_DAYS = 400          # 回看大约 13 个月
MAX_PAGES = 6            # 每家公司公告列表最多翻几页 (一页 30 条)
MAX_BODIES = 60          # 每家公司这次最多读几篇公告正文
RUN_BODIES = 900         # 这次运行最多读几篇 (每篇停 0.4 秒，约 6 分钟)
KEEP_RECORDS = 120       # 文件里留最近几笔 (画变化用)
SUB_RE = re.compile(r"S-hldr|Substantial|Section 13[789]\b", re.I)
_MON = {mn: i for i, mn in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}
DATE_RE = r"(\d{1,2} [A-Za-z]{3} \d{4}|\d{1,2}/\d{1,2}/\d{4})"


def to_date(s):
    s = (s or "").strip()
    try:
        if "/" in s:
            return datetime.strptime(s, "%d/%m/%Y").strftime("%Y-%m-%d")
        d, mo, y = s.split()
        return datetime(int(y), _MON[mo[:3].lower()], int(d)).strftime("%Y-%m-%d")
    except Exception:  # noqa: BLE001
        return None


def num(s):
    try:
        return float(str(s).replace(",", ""))
    except (TypeError, ValueError):
        return None


def body_text(html_text):
    """公告页 HTML → 正文文字 (去掉网站菜单、脚本)"""
    t = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", html_text)
    t = re.sub(r"\s+", " ", m.html.unescape(re.sub(r"<[^>]+>", " ", t)))
    k = t.find("Particulars of")
    end = t.find("Announcement Info")
    return t[k if k >= 0 else 0:end if end > 0 else len(t)].strip()


def kind_of(title):
    if re.search(r"Section 139|Ceasing|Cessation", title, re.I):
        return "ceased"
    if re.search(r"Section 137|Notice of Interest", title, re.I):
        return "new"
    return "change"


def parse_holding(text, title=""):
    """一篇主要股东公告的正文 → {name, kind, changes[{date, units, type, nature}], direct, direct_pct, indirect, indirect_pct, total, notice}；
    认不出名字就返回 None"""
    name = re.search(r"Particulars of (?:substantial )?(?:Securities Holder|Shareholder)s? Name (.+?) (?:Address|Company No\.|Nationality|Descriptions)", text, re.I)
    if not name:
        return None
    out = {"name": " ".join(name.group(1).split())[:120], "kind": kind_of(title), "changes": []}
    for d, units, typ, nature in re.findall(DATE_RE + r" ([\d,]+) (Acquired|Disposed|Others|Transferred|[A-Z][a-z]+(?: [a-z]+)?) (Direct|Indirect|Deemed)(?: Interest)?", text):
        out["changes"].append({"date": to_date(d), "units": num(units), "type": typ.lower(), "nature": nature.lower()})
    for key, pat in (("direct", r"Direct \(units\) ([\d,]+)"), ("direct_pct", r"Direct \(%\) ([\d.]+)"),
                     ("indirect", r"Indirect/deemed interest \(units\) ([\d,]+)"), ("indirect_pct", r"Indirect/deemed interest \(%\) ([\d.]+)"),
                     ("total", r"Total no of securities after change ([\d,]+)")):
        hit = re.search(pat, text, re.I)
        out[key] = num(hit.group(1)) if hit else None
    nd = re.search(r"Date of notice " + DATE_RE, text, re.I)
    out["notice"] = to_date(nd.group(1)) if nd else None
    if out["kind"] == "ceased" and out["direct_pct"] is None and out["indirect_pct"] is None:
        out["direct_pct"] = out["indirect_pct"] = 0.0  # 不再是主要股东 (少于 5%)：公告不一定写剩多少
        out["below"] = True
    return out


def before_pct(rec):
    """第一笔之前的持股 % (用这次变动的股数倒推)：after% × (after 股数 ± 变动股数) / after 股数"""
    after_units = (rec.get("direct") or 0) + (rec.get("indirect") or 0)
    after_pct = (rec.get("direct_pct") or 0) + (rec.get("indirect_pct") or 0)
    if not after_units or not after_pct or not rec.get("changes"):
        return None
    delta = sum((c["units"] or 0) * (1 if c["type"] == "acquired" else -1 if c["type"] == "disposed" else 0) for c in rec["changes"])
    if not delta:
        return None
    return round(after_pct * (after_units - delta) / after_units, 3)


def summarize(records, since):
    """每个股东：最新持股、期间最早的持股 (第一笔变动之前)、变化 (百分点)、申报次数"""
    by = {}
    for r in sorted(records, key=lambda x: (x.get("date") or "", x["id"])):
        if (r.get("date") or "") < since:
            continue
        key = re.sub(r"[^A-Z0-9]", "", r["name"].upper())
        h = by.setdefault(key, {"name": r["name"], "n": 0, "first": None, "first_date": None})
        h["n"] += 1
        if h["first"] is None:
            h["first"], h["first_date"] = (0.0 if r.get("kind") == "new" else before_pct(r)), (r["changes"][0]["date"] if r.get("changes") else r.get("date"))
        h.update({"direct_pct": r.get("direct_pct"), "indirect_pct": r.get("indirect_pct"), "units": (r.get("direct") or 0) + (r.get("indirect") or 0) or None,
                  "as_of": (r["changes"][-1]["date"] if r.get("changes") else None) or r.get("date"), "ann": r["id"], "below": bool(r.get("below"))})
    out = []
    for h in by.values():
        pct = round((h.get("direct_pct") or 0) + (h.get("indirect_pct") or 0), 3)
        h["pct"] = pct
        h["chg"] = round(pct - h["first"], 3) if h["first"] is not None else None
        out.append(h)
    return sorted(out, key=lambda h: -h["pct"])


def list_holding_anns(code, known, since, today):
    """个股的持股类公告 (新到旧)，翻到 since 以前或都是读过的就停"""
    out = []
    for page in range(1, MAX_PAGES + 1):
        url = m.KLSE_ANN_STOCK.format(code) + "?category=SH,CHSH" + (f"&page={page}" if page > 1 else "")
        r = m.requests.get(url, headers=m.KLSE_HEADERS, timeout=20)
        r.raise_for_status()
        items = m.parse_klse_announcements(r.text, today)
        if not items:
            break
        fresh = [x for x in items if x["id"] not in known and SUB_RE.search(x["title"])]
        out += fresh
        # 列表只有「日 + 月」，旧的年份推不准；只要这一页都读过了，或最旧的已经超过回看期间，就不再往回翻
        if not [x for x in items if x["id"] not in known] or min(x["date"] for x in items) < since or len(items) < 30:
            break
        time.sleep(0.4)
    return out


def process(code, now, budget, log=print):
    path = os.path.join(OUT_DIR, f"{code}.json")
    old = m_read(path) or {}
    records = old.get("records") or []
    known = {r["id"] for r in records} | set(old.get("skip") or [])
    since = (now - timedelta(days=HIST_DAYS)).strftime("%Y-%m-%d")
    anns = list_holding_anns(code, known, since, now.date())
    used, skip = 0, list(old.get("skip") or [])
    for a in anns[:min(MAX_BODIES, budget)]:
        try:
            r = m.requests.get(a["link"], headers=m.KLSE_HEADERS, timeout=20)
            r.raise_for_status()
            rec = parse_holding(body_text(r.text), a["title"])
        except Exception as e:  # noqa: BLE001
            log(f"⚠️ {code} 持股公告 {a['id']} 读取失败 ({type(e).__name__})")
            continue
        finally:
            used += 1
            time.sleep(0.4)
        if not rec:
            skip.append(a["id"])
            continue
        # 公告列表的年份是推的，以正文里的变动日期 / 通知日期为准
        rec.update({"id": a["id"], "date": rec["notice"] or (rec["changes"][-1]["date"] if rec["changes"] else a["date"]), "title": a["title"][:160]})
        records.append(rec)
    records = sorted(records, key=lambda x: (x.get("date") or "", x["id"]), reverse=True)[:KEEP_RECORDS]
    holders = summarize(records, since)
    out = {"v": 1, "code": code, "updated": now.strftime("%Y-%m-%d %H:%M"), "since": since, "holders": holders,
           "records": records, "skip": skip[-200:], "source": "Bursa Malaysia (via KLSE Screener)"}
    return out, used, len(anns)


def m_read(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:  # noqa: BLE001
        return None


def pick(limit, now):
    """先做报告里有新持股公告 (docs/ann/) 但还没读过的公司，再按成交额补还没有资料的"""
    term = m_read(os.path.join("docs", "terminal", "data.json")) or {}
    order = [s[0] for s in sorted(term.get("stocks") or [], key=lambda s: (-(s[11] or 0), -(s[5] or 0)))]
    first, rest = [], []
    for code in order:
        have = m_read(os.path.join(OUT_DIR, f"{code}.json"))
        ann = m_read(os.path.join(m.ANN_DIR, f"{code}.json")) or {}
        news = [x for x in ann.get("items") or [] if x.get("cat") == "holding" and SUB_RE.search(x.get("title", ""))]
        if not have:
            rest.append(code)
        elif news:
            known = {r["id"] for r in have.get("records") or []} | set(have.get("skip") or [])
            if any(x["link"].rsplit("/", 1)[-1] not in known for x in news):
                first.append(code)
        elif (now - datetime.strptime(have["updated"][:10], "%Y-%m-%d").replace(tzinfo=now.tzinfo)).days >= 7:
            rest.append(code)
    return (first + rest)[:limit]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--codes", default="")
    ap.add_argument("--limit", type=int, default=40)
    ap.add_argument("--minutes", type=float, default=0, help="这次最多跑几分钟 (0 = 不限)；时间到就停，剩下的下次接着做")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    now = datetime.now(m.LOCAL_TZ)
    os.makedirs(OUT_DIR, exist_ok=True)
    todo = [c.strip() for c in a.codes.split(",") if c.strip()] or pick(a.limit, now)
    print(f"👥 主要股东：这次处理 {len(todo)} 家")
    budget, done = RUN_BODIES, 0
    deadline = time.time() + a.minutes * 60 if a.minutes else None
    for i, code in enumerate(todo):
        if deadline and time.time() > deadline:
            print(f"   时间到 ({a.minutes:g} 分钟)，这次做了 {i} 家，其余 {len(todo) - i} 家下次再做")
            break
        if budget <= 0:
            print("   这次读公告的额度用完，其余下次再做")
            break
        try:
            rec, used, found = process(code, now, budget)
        except Exception as e:  # noqa: BLE001
            print(f"⚠️ {code} 失败：{type(e).__name__}: {e}")
            continue
        budget -= used
        top = ", ".join(f"{h['name'][:24]} {h['pct']:.2f}%" + (f" ({h['chg']:+.2f})" if h.get("chg") is not None else "") for h in rec["holders"][:4])
        print(f"   {code} 新公告 {found}，读了 {used}；股东 {len(rec['holders'])}：{top}")
        if a.dry_run:
            print(json.dumps({k: rec[k] for k in ("holders",)}, ensure_ascii=False, indent=1)[:2500])
            continue
        with open(os.path.join(OUT_DIR, f"{code}.json"), "w", encoding="utf-8") as f:
            json.dump(rec, f, ensure_ascii=False, separators=(",", ":"))
        done += 1
    print(f"👥 写入 {done} 家")


if __name__ == "__main__":
    main()
