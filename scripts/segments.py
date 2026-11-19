"""
业务板块动态 (docs/segments/<代码>.json)：这家公司今年 (1 月 1 日到今天) 各业务板块做了什么 —— 扩张、进入新业务、缩减、出售、拿到合约，
业务模式有没有变 (新增 / 退出整条业务线)；有年报 PDF 的公司再加上「各板块营收 / 利润：今年 vs 去年」。

- 来源 1 (全部公司，自动)：KLSE Screener 个股公告 (内容来自 Bursa)，今年的非例行公告标题 + 部分公告内文，交给 DeepSeek 按业务板块整理。
  每一条动态都要对应一条今年的公告 (编号)，对不上的丢掉；页面上每条都链接到原公告。
- 来源 2 (有年报的公司)：data/esg/sources.json 里 type = "annual" 的年报 PDF，抽「分部资料 (segment information)」的营收 / 利润两年数字。
  跟 ESG 一样核对：引句要真的在那一页、两个数字都要在引句里、那一页要有 segment 字样；变化 % 由程序算。
- 只描述发生了什么和数字，不评价好坏、不说改善 / 恶化、不预测。

用法：python scripts/segments.py [--codes 5347] [--limit 15] [--force] [--dry-run]
"""
import argparse
import hashlib
import json
import os
import re
import sys
import time
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import esg_extract as es  # noqa: E402  (下载 / 读 PDF、核对引句、过滤评价字眼；它也载入了 main 和 company_intel)
from company_intel import ann_body, fin_facts, read_json  # noqa: E402

m = es.m
OUT_DIR = os.path.join("docs", "segments")
MAX_PAGES = 12           # 公告列表最多翻 12 页 (一页 30 条)
MAX_ANNS = 80            # 给 DeepSeek 的公告标题最多几条
MAX_BODIES, BODY_CHARS = 18, 1600
REFRESH_DAYS = 14        # 没有新公告也每 14 天重新整理一次
AR_PAGES, AR_CHARS = 10, 3500
SKIP_CATS = ("holding", "buyback", "people", "dividend")   # 持股变动、回购、人事、派息：跟业务板块无关
BODY_RE = re.compile(r"transaction|acquisition|acquire|disposal|dispose|proposal|contract|award|letter of (?:award|acceptance)|memorandum|\bMOU\b|"
                     r"joint venture|subscription|incorporation|new (?:subsidiary|business)|diversif|expansion|plant|factory|capacity|"
                     r"concession|licen[cs]e|termination|cessation|closure|strike off|winding up|investment|partnership|agreement", re.I)
KINDS = ("expand", "new", "reduce", "exit", "contract", "other")
NUM_KEYS = {"revenue": ("营收", "Revenue"), "profit": ("利润", "Profit")}

PROMPT = """你是马来西亚上市公司的资料整理助手，帮投资者看懂这家公司今年各业务板块发生了什么变化。
你会拿到：公司业务线、今年的公告 (编号. 日期 [类别] 标题，部分附公告内文)、最新财报数字、年报里的业务板块名称 (如果有)。
只根据这些资料输出 JSON：
- overview：2~3 句中文，今年业务上主要发生了什么 (哪个板块扩张、新增业务、缩减或出售、拿到什么合约)；overview_en 英文版。
- segments：按业务板块分组 [{"name": 中文板块名, "name_en": 英文板块名, "note": 一句中文说明这个板块今年在做什么, "note_en": 英文,
    "actions": [{"ann": 公告编号 (整数), "kind": "expand" | "new" | "reduce" | "exit" | "contract" | "other", "text": 一句中文, "text_en": 英文}]}]
  - kind：expand = 扩大产能 / 新厂房 / 新市场 / 收购同类业务；new = 进入以前没有的新业务；reduce = 缩减 / 暂停 / 关闭部分业务；
    exit = 出售或退出某个业务；contract = 获得或签订合约、订单；other = 其他跟业务有关的事
  - 每条 action 一定要对应一条公告编号，公告里没有写的事情不要写；金额、产能、地点照公告写
  - 有年报板块名称就用年报的名称分组，不然用业务线名称；跟任何板块都对不上的放在 "集团 / Group"
  - 今年没有动态的板块不用输出
- model_changes：业务模式的变化 (新增或退出整条业务线、明显转型)，[{"ann": 公告编号, "text": 中文, "text_en": 英文}]；没有就输出 []
只陈述事实，不要评价好坏，不要用「改善、恶化、利好、利空、看好、强劲、疲弱」之类的字眼，不要预测，不要给投资建议。
公司名、产品名、地名保留英文。只输出 JSON。"""

AR_PROMPT = """你是年报资料抽取助手。你会拿到一家马来西亚上市公司年报的部分页面，每页前面标了页码【第 N 页】。
找出「按业务板块」(operating segments / segmental information / segment reporting) 的营收和利润，今年和上一年，输出 JSON：
{"fy": "年报的财政年度，例如 FY2025", "segments": [{"name": 中文板块名, "name_en": 原文英文板块名,
  "metrics": [{"key": "revenue" | "profit", "this": 今年数字 (原文的数字，不带逗号), "prev": 上一年数字, "unit": 原文单位 (例如 RM'000、RM million),
  "page": 页码 (整数), "quote": 原文里同时包含今年和上一年数字的那一行，一字不改照抄，最多 200 字}]}]}
- profit 用原文的分部利润 (segment profit / profit before tax / operating profit，照原文)；亏损是负数
- 只抽分部表里的数字，不要推算、不要加总、不要换算单位；找不到就输出 {"fy": null, "segments": []}
只输出 JSON。"""


def year_announcements(code, now):
    """今年的公告 (新到旧)。列表只有「日 + 月」，年份按今天推：一路往回翻，第一次看到比 1 月 1 日早的就停 (后面的年份推不准)"""
    since = f"{now.year}-01-01"
    out, seen = [], set()
    for page in range(1, MAX_PAGES + 1):
        url = m.KLSE_ANN_STOCK.format(code) + (f"?page={page}" if page > 1 else "")
        r = m.requests.get(url, headers=m.KLSE_HEADERS, timeout=20)
        r.raise_for_status()
        items = m.parse_klse_announcements(r.text, now.date())
        if not items:
            break
        for x in items:
            if x["date"] < since:
                return out
            if x["id"] not in seen:
                seen.add(x["id"])
                out.append(x)
        if len(items) < 30:
            break
        time.sleep(0.4)
    return out


ROUTINE_TITLE_RE = re.compile(r"S-hldr|Director'?s? Int|Section (?:13[789]|219)|Shares? Buy[ -]?Back|Dealings? (?:in|by)|Notice of (?:Interest|Person Ceasing)", re.I)


def relevant(anns):
    return [a for a in anns if a.get("cat") not in SKIP_CATS and not ROUTINE_TITLE_RE.search(a["title"])][:MAX_ANNS]


def annual_entry(code):
    src = (read_json(es.SOURCES, {}) or {}).get(code) or []
    ok = [e for e in src if isinstance(e, dict) and e.get("type") == "annual" and str(e.get("url", "")).startswith(("http://", "https://"))]
    return sorted(ok, key=lambda e: int(e.get("year") or 0), reverse=True)[0] if ok else None


def pick_ar_pages(pages, n=AR_PAGES):
    rx = re.compile(r"segment", re.I)
    scored = []
    for i, t in enumerate(pages):
        s = 3 * min(5, len(rx.findall(t)))
        if re.search(r"segment(?:al)? (?:information|reporting|revenue|results|profit)|operating segments", t, re.I):
            s += 8
        if re.search(r"review of (?:operations|performance)|management discussion|business review", t, re.I):
            s += 3
        s += min(4, len(re.findall(r"\d[\d,]{3,}", t)) // 20)
        if s >= 6:
            scored.append((s, i + 1))
    return sorted(p for _, p in sorted(scored, reverse=True)[:n])


def verify_num(mt, pages):
    """年报板块数字：引句在那一页、今年和去年两个数字都在引句里、那一页有 segment"""
    try:
        page = int(mt.get("page"))
    except (TypeError, ValueError):
        return None
    key, quote = mt.get("key"), str(mt.get("quote") or "").strip()
    this, prev = es._num(mt.get("this")), es._num(mt.get("prev"))
    if key not in NUM_KEYS or this is None or not quote or not (1 <= page <= len(pages)):
        return None
    text = pages[page - 1]
    if es._squash(quote) not in es._squash(text) or not re.search(r"segment", text, re.I):
        return None
    nums = [es._num(x) for x in re.findall(r"\(?-?\d[\d,]*(?:\.\d+)?\)?", quote.replace("(", "-").replace(")", ""))]

    def has(v):
        return v is not None and any(x is not None and abs(abs(x) - abs(v)) <= 1e-9 * max(1.0, abs(v)) for x in nums)
    if not has(this) or (prev is not None and not has(prev)):
        return None
    chg = round((this / prev - 1) * 100, 1) if prev not in (None, 0) and prev > 0 and this >= 0 else None
    return {"key": key, "label": NUM_KEYS[key][0], "label_en": NUM_KEYS[key][1], "this": this, "prev": prev, "chg_pct": chg,
            "unit": str(mt.get("unit") or "")[:20], "page": page, "quote": quote[:240]}


def annual_numbers(code, entry, old, log=print):
    """年报的板块数字；网址没变就用上次的结果 (不重新下载)"""
    prev = (old or {}).get("annual") or {}
    if prev.get("url") == entry["url"] and prev.get("status") in ("ok", "none"):
        return prev
    try:
        data = es.download(entry["url"])
    except Exception as e:  # noqa: BLE001
        log(f"⚠️ {code} 年报下载失败：{type(e).__name__}: {e}")
        return {"url": entry["url"], "year": entry.get("year"), "status": "error", "error": str(e)[:160]}
    pages = es.pdf_pages(data)
    base = {"url": entry["url"], "year": entry.get("year"), "sha1": hashlib.sha1(data).hexdigest(), "pages": len(pages)}
    sel = pick_ar_pages(pages)
    if not sel:
        return dict(base, status="none", segments=[])
    lines = [f"公司代码 {code}，年报 {entry.get('year', '')}", "页面:"] + [f"【第 {p} 页】 {pages[p - 1][:AR_CHARS]}" for p in sel]
    r = m.ai_chat(temperature=0.1, max_tokens=2500, response_format={"type": "json_object"},
                                         messages=[{"role": "system", "content": AR_PROMPT}, {"role": "user", "content": "\n".join(lines)}])
    out = json.loads(r.choices[0].message.content or "{}")
    segs, dropped = [], 0
    for sg in out.get("segments") or []:
        ms = []
        for mt in sg.get("metrics") or []:
            v = verify_num(mt, pages)
            if v and v["key"] not in {x["key"] for x in ms}:
                ms.append(v)
            else:
                dropped += 1
        if ms and sg.get("name_en"):
            segs.append({"name": label(sg.get("name"), 40) or label(sg["name_en"], 40), "name_en": label(sg["name_en"], 60), "numbers": ms})
    log(f"   {code} 年报板块 {len(segs)} 个 (丢掉 {dropped} 个对不上原文的数字)")
    return dict(base, status="ok" if segs else "none", fy=str(out.get("fy") or "")[:12] or None, pages_used=sel, segments=segs, dropped=dropped)


def facts_lines(detail):
    fin = detail.get("fin") or {}
    out = []
    f = fin_facts(fin)
    if f:
        out.append(f"最新一季 ({f['period']}) 营收 {f['revenue']}，同比 {f['revenue_yoy']}%；净利润 {f['net_income']}，同比 {f['net_income_yoy']}% ({f['currency']})")
    a = fin.get("annual") or {}
    per = a.get("periods") or []

    def at(k, j):
        arr = a.get(k) or []
        return arr[j] if j < len(arr) else None
    for j in range(max(0, len(per) - 2), len(per)):
        out.append(f"年度 {per[j]}: 营收 {at('revenue', j)}，净利润 {at('net_income', j)}")
    return out


# 板块动态额外过滤的评价字眼 (整句删掉)
SEG_JUDGE_RE = re.compile(r"强劲|疲弱|疲软|改善|恶化|亮眼|乏力|向好|转差|稳健|出色|欠佳|\b(?:strong|robust|weak|sluggish|deteriorat\w*|impressive|solid performance)\b", re.I)


def say(text, en=False):
    t = es.neutral(text, en=en)
    parts = re.split(r"(?<=[.;!?])\s+", t) if en else re.split(r"(?<=[。；;!?，,])", t)
    t = (" " if en else "").join(p for p in parts if p and not SEG_JUDGE_RE.search(p)).strip()
    return re.sub(r"[，,]$", "。", t) if not en else t


def label(text, n):
    """板块名称：纯文字，去掉结尾标点"""
    return re.sub(r"[。.，,；;:：\s]+$", "", " ".join(str(text or "").split()))[:n]


def norm(s):
    return re.sub(r"[^a-z0-9]", "", str(s or "").lower())


def ask(code, name, detail, anns, bodies, ar_segs, year):
    prof = detail.get("profile") or {}
    lines = [f"公司: {name} ({code})", f"今年: {year}"]
    if prof.get("lines_en") or prof.get("lines"):
        lines.append("业务线:")
        lines += [f"- {x}" for x in (prof.get("lines_en") or prof.get("lines"))]
    elif prof.get("summary"):
        lines.append("公司介绍: " + prof["summary"][:800])
    if ar_segs:
        lines.append("年报业务板块名称: " + "；".join(s["name_en"] for s in ar_segs))
    lines += facts_lines(detail)
    lines.append("今年的公告 (编号. 日期 [类别] 标题):")
    lines += [f"{i}. {a['date']} [{a.get('cat')}] {a['title']}" for i, a in enumerate(anns)]
    if bodies:
        lines.append("公告内文:")
        lines += [f"[{i}] {t}" for i, t in bodies.items()]
    r = m.ai_chat(temperature=0.1, max_tokens=3000, response_format={"type": "json_object"},
                                         messages=[{"role": "system", "content": PROMPT}, {"role": "user", "content": "\n".join(lines)}])
    return json.loads(r.choices[0].message.content or "{}")


def ann_ref(i, anns):
    try:
        i = int(i)
    except (TypeError, ValueError):
        return None
    if not 0 <= i < len(anns):
        return None
    a = anns[i]
    return {"date": a["date"], "ann_id": a["id"], "link": a["link"], "title": a["title"][:140]}


def build(code, name, out, anns, ar):
    """AI 的结果 → 核对后的记录：每条动态要对得上公告编号；字眼过滤；接上年报数字"""
    segs, dropped = [], 0
    for sg in out.get("segments") or []:
        acts = []
        for a in sg.get("actions") or []:
            ref = ann_ref(a.get("ann"), anns)
            text = say(a.get("text"))
            if not ref or not text or a.get("kind") not in KINDS:
                dropped += 1
                continue
            acts.append(dict(ref, kind=a["kind"], text=es.cut(text, 160), text_en=es.cut(say(a.get("text_en"), en=True), 260)))
        name_en = label(sg.get("name_en"), 60)
        if acts:
            segs.append({"name": label(sg.get("name"), 40) or name_en, "name_en": name_en or label(sg.get("name"), 40),
                         "note": es.cut(say(sg.get("note")), 120), "note_en": es.cut(say(sg.get("note_en"), en=True), 200),
                         "actions": sorted(acts, key=lambda x: x["date"], reverse=True), "numbers": []})
    # 年报数字接到同名板块 (名称对不上就单独列一个板块，只有数字)
    for s in (ar or {}).get("segments") or []:
        hit = next((g for g in segs if norm(g["name_en"]) == norm(s["name_en"]) or norm(s["name_en"]) in norm(g["name_en"]) or norm(g["name_en"]) in norm(s["name_en"])), None)
        if hit:
            hit["numbers"] = s["numbers"]
        else:
            segs.append({"name": s["name"], "name_en": s["name_en"], "note": "", "note_en": "", "actions": [], "numbers": s["numbers"]})
    mc = []
    for x in out.get("model_changes") or []:
        ref = ann_ref(x.get("ann"), anns)
        text = say(x.get("text"))
        if ref and text:
            mc.append(dict(ref, text=es.cut(text, 160), text_en=es.cut(say(x.get("text_en"), en=True), 260)))
        else:
            dropped += 1
    return segs, mc, dropped


def input_hash(anns, ar):
    key = json.dumps([[a["id"] for a in anns], (ar or {}).get("sha1"), 1], ensure_ascii=False)
    return hashlib.sha1(key.encode()).hexdigest()[:16]


def process(code, now, force=False, log=print):
    path = os.path.join(OUT_DIR, f"{code}.json")
    old = read_json(path, None)
    detail = read_json(os.path.join("docs", "stock", f"{code}.json"), {}) or {}
    name = detail.get("long_name") or code
    anns = relevant(year_announcements(code, now))
    entry = annual_entry(code)
    ar = annual_numbers(code, entry, old, log) if entry else None
    h = input_hash(anns, ar)
    if old and old.get("hash") == h and not force:
        log(f"   {code} 公告没变，跳过")
        return None
    if not anns and not (ar or {}).get("segments"):
        return {"v": 1, "code": code, "name": name, "year": now.year, "updated": now.strftime("%Y-%m-%d %H:%M"), "hash": h,
                "overview": "", "overview_en": "", "segments": [], "model_changes": [], "anns": 0, "annual": ar}
    bodies = {}
    for i, a in enumerate(anns):
        if len(bodies) >= MAX_BODIES:
            break
        if BODY_RE.search(a["title"]):
            try:
                bodies[i] = ann_body(a["id"])[:BODY_CHARS]
            except Exception as e:  # noqa: BLE001
                log(f"⚠️ {code} 公告内文抓取失败 {a['id']} ({type(e).__name__})")
    out = ask(code, name, detail, anns, bodies, (ar or {}).get("segments") or [], now.year)
    segs, mc, dropped = build(code, name, out, anns, ar)
    rec = {"v": 1, "code": code, "name": name, "year": now.year, "updated": now.strftime("%Y-%m-%d %H:%M"), "hash": h,
           "overview": es.cut(say(out.get("overview")), 300), "overview_en": es.cut(say(out.get("overview_en"), en=True), 500),
           "segments": segs, "model_changes": mc, "anns": len(anns), "dropped": dropped, "annual": ar}
    log(f"   {code} 今年公告 {len(anns)} 条 (内文 {len(bodies)})，板块 {len(segs)} 个，动态 {sum(len(s['actions']) for s in segs)} 条，"
        f"业务模式变化 {len(mc)}，丢掉 {dropped} 条对不上公告的")
    return rec


def pick(limit, now):
    """没有资料的、AI 资讯比板块动态新 (有新公告) 的、或超过 REFRESH_DAYS 的；信号股在前，其余按成交额"""
    term = read_json(os.path.join("docs", "terminal", "data.json"), {}) or {}
    order = [s[0] for s in sorted(term.get("stocks") or [], key=lambda s: (-(s[11] or 0), -(s[5] or 0)))]
    srcs = [c for c, v in (read_json(es.SOURCES, {}) or {}).items() if not c.startswith("_") and any((e or {}).get("type") == "annual" for e in v or [])]
    first, rest = [], []
    for code in list(dict.fromkeys(srcs + order)):
        have = read_json(os.path.join(OUT_DIR, f"{code}.json"), None)
        intel = read_json(os.path.join("docs", "intel", f"{code}.json"), {}) or {}
        if not have:
            (first if code in srcs else rest).append(code)
            continue
        if code in srcs and (have.get("annual") or {}).get("url") != (annual_entry(code) or {}).get("url"):
            first.append(code)
        elif intel.get("updated", "") > have["updated"] or have.get("year") != now.year:
            first.append(code)
        elif (now.replace(tzinfo=None) - datetime.strptime(have["updated"][:16], "%Y-%m-%d %H:%M")).days >= REFRESH_DAYS:
            rest.append(code)
    return (first + rest)[:limit]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--codes", default="")
    ap.add_argument("--limit", type=int, default=15)
    ap.add_argument("--minutes", type=float, default=0, help="这次最多跑几分钟 (0 = 不限)；时间到就停，剩下的下次接着做")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    now = datetime.now(m.LOCAL_TZ)
    os.makedirs(OUT_DIR, exist_ok=True)
    todo = [c.strip() for c in a.codes.split(",") if c.strip()] or pick(a.limit, now)
    print(f"🧩 业务板块动态：这次处理 {len(todo)} 家")
    done = 0
    deadline = time.time() + a.minutes * 60 if a.minutes else None
    for i, code in enumerate(todo):
        if deadline and time.time() > deadline:
            print(f"   时间到 ({a.minutes:g} 分钟)，这次做了 {i} 家，其余 {len(todo) - i} 家下次再做")
            break
        try:
            rec = process(code, now, a.force or bool(a.codes))
        except Exception as e:  # noqa: BLE001
            print(f"⚠️ {code} 失败：{type(e).__name__}: {e}")
            continue
        if not rec:
            continue
        if a.dry_run:
            print(json.dumps({k: rec[k] for k in ("overview", "segments", "model_changes")}, ensure_ascii=False, indent=1)[:5000])
            continue
        with open(os.path.join(OUT_DIR, f"{code}.json"), "w", encoding="utf-8") as f:
            json.dump(rec, f, ensure_ascii=False, separators=(",", ":"))
        done += 1
    print(f"🧩 写入 {done} 家")


if __name__ == "__main__":
    main()
