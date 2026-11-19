"""
ESG / 可持续发展披露抽取 (IR + ESG 样品页用)：从公司公开的可持续发展报告 / 年报 PDF 抽出关键指标和 IFRS S1/S2 披露项目。

资料来源只用公司自己公开的报告 (不用行情数据)：
- data/esg/sources.json：{"<代码>": [{"url": "...pdf", "year": 2025, "type": "sustainability" | "annual"}]}
  在 GitHub 网页编辑这个文件、填公司官网上的 PDF 网址；PDF 不放进仓库，运行时下载，用 sha1 判断有没有变。
- 每家只处理一份：优先可持续发展报告，同类型取最新年份。

抽取方法：
1. pypdf 逐页抽文字 (扫描图片版抽不出文字 → status = no_text，需要人工)
2. 按关键词 (Scope 1/2/3、tCO2e、能源、用水、废弃物、员工、女性、培训、工伤、IFRS S1/S2、TCFD、情景分析…) 挑出最相关的页面
3. DeepSeek 只看这些页面，输出：指标 (数值 + 单位 + 年份 + 页码 + 原文引句)、IFRS S1/S2 披露检查 (found / partial / not_found + 页码)、2–3 句事实摘要
4. 防编造：引句必须真的在那一页的文字里、数值必须出现在引句里，否则丢掉；文字再过滤好坏评价和买卖建议字眼
5. 强度：范围一 + 二排放、能源 ÷ 当年营收 (docs/stock/<代码>.json 的年报营收)，每 RM 百万营收；只是计算，不打分、不排名

输出 docs/esg/<代码>.json，另外 docs/esg/index.json 放各家公司的指标 (IR 页的同行对比用)。
全部只陈述报告里写的事实和页码，不是 ESG 评级，也不是合规意见。

用法:
  python scripts/esg_extract.py                         # sources.json 里全部 (PDF 没变的跳过)
  python scripts/esg_extract.py --codes 5335 --force
  python scripts/esg_extract.py --codes 5335 --dry-run  # 只印结果、不写文件
在 Actions 跑: .github/workflows/esg.yml (sources.json 一改就自动跑，也可以手动)
"""
import argparse
import hashlib
import io
import json
import os
import re
import sys
from datetime import datetime

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "scripts"))
os.chdir(ROOT)
os.environ.setdefault("MARKET", "MY")
import main as m  # noqa: E402  (DeepSeek client、requests、时区)
from company_intel import clean, clean_en, read_json  # noqa: E402  (过滤建议 / 评价字眼)

SOURCES = os.path.join("data", "esg", "sources.json")
OUT_DIR = os.path.join("docs", "esg")
INDEX = os.path.join(OUT_DIR, "index.json")
MAX_BYTES = 40 * 1024 * 1024
PAGES_TO_AI, PAGE_CHARS = 24, 3000  # 指标页 + 每个披露项目最相关的页，合计最多 24 页
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      "Accept": "application/pdf,*/*"}

# 指标：key → (中文, 英文, 说明给 AI)
METRICS = {
    "ghg_scope1": ("范围一排放", "Scope 1 emissions", "Scope 1 GHG emissions, tCO2e"),
    "ghg_scope2": ("范围二排放", "Scope 2 emissions", "Scope 2 GHG emissions (location- or market-based, say which in unit), tCO2e"),
    "ghg_scope3": ("范围三排放", "Scope 3 emissions", "Scope 3 GHG emissions, tCO2e"),
    "energy": ("能源消耗", "Energy consumption", "total energy consumption (MWh, GJ, kWh)"),
    "water": ("用水量", "Water consumption", "total water consumption / withdrawal (m3, megalitres)"),
    "waste": ("废弃物", "Waste generated", "total waste generated (tonnes)"),
    "employees": ("员工人数", "Employees", "total number of employees"),
    "women_pct": ("女性员工比例", "Women in workforce", "percentage of women employees"),
    "board_women_pct": ("女性董事比例", "Women on the board", "percentage of women directors"),
    "training_hours": ("培训时数", "Training hours", "total training hours (or per employee — say which in unit)"),
    "lti": ("工伤 (损失工时)", "Lost-time injuries", "lost time incident rate (LTIR / LTIFR) or number of lost-time injuries"),
    "fatalities": ("工作死亡", "Work-related fatalities", "number of work-related fatalities"),
    "community_rm": ("社区投资", "Community investment", "amount invested in communities (RM)"),
    "anticorruption_pct": ("反贪培训覆盖", "Anti-corruption training", "percentage of employees trained on anti-corruption"),
}
# IFRS S1 / S2 披露项目：key → (中文, 英文, 说明给 AI)
READINESS = {
    "governance": ("治理：董事会 / 管理层对可持续发展和气候议题的监督", "Governance: board / management oversight of sustainability and climate", "IFRS S1/S2 governance pillar"),
    "strategy": ("策略：可持续发展相关的风险与机会", "Strategy: sustainability-related risks and opportunities", "IFRS S1/S2 strategy pillar"),
    "risk_mgmt": ("风险管理：识别、评估、管理的流程", "Risk management: processes to identify, assess and manage", "IFRS S1/S2 risk management pillar"),
    "metrics_targets": ("指标与目标", "Metrics and targets", "IFRS S1/S2 metrics and targets pillar"),
    "scope12": ("范围一、二排放数字", "Scope 1 and 2 emissions figures", "quantified Scope 1 and Scope 2 GHG emissions"),
    "scope3": ("范围三排放", "Scope 3 emissions", "quantified Scope 3 GHG emissions or categories"),
    "scenario": ("气候情景分析", "Climate scenario analysis", "climate-related scenario analysis (e.g. 1.5C / 2C / 4C scenarios)"),
    "transition": ("转型计划 / 减排目标", "Transition plan / reduction targets", "transition plan, net-zero or emission reduction targets"),
    "financial_effects": ("气候对财务的影响", "Financial effects of climate", "current or anticipated financial effects of climate-related risks"),
    "assurance": ("鉴证 / 审核", "Assurance / review", "external assurance or internal review of the sustainability statement"),
}
STATUSES = ("found", "partial", "not_found")
# 每个披露项目在整份报告里找页面用的关键词 (不然 AI 只看到挑中的页，会把有写的说成没写)
READY_KW = {
    "governance": r"board (?:of directors )?(?:oversight|responsib)|sustainability (?:committee|governance)|governance structure",
    "strategy": r"risks? and opportunit|material (?:matters|sustainability)|business model|value chain|time horizon",
    "risk_mgmt": r"risk management (?:framework|process)|enterprise risk|identif\w+ (?:and|,) assess",
    "metrics_targets": r"targets?|kpi|performance data|metrics",
    "scope12": r"scope\s*1|scope\s*2|tco2e",
    "scope3": r"scope\s*3",
    "scenario": r"scenario analysis|1\.5\s*°?c|2\s*°?c|ngfs|iea|physical risk",
    "transition": r"transition plan|net[- ]zero|decarboni[sz]|reduction target",
    "financial_effects": r"financial (?:effect|impact|implication)|anticipated financial",
    "assurance": r"assurance|assured|independent (?:review|limited)|internal audit",
}
# 指标的意思检查：引句 (或引句前面 400 字) 要有这些字；引句里有「排除」的字就不算 (例如员工数不能是「完成培训的员工」)
METRIC_CTX = {
    "ghg_scope1": (r"scope1", None), "ghg_scope2": (r"scope2", None), "ghg_scope3": (r"scope3", None),
    "energy": (r"energy|electricity|fuel", None), "water": (r"water", None), "waste": (r"waste", None),
    "employees": (r"employee|headcount|workforce|staff", r"training|learning|programme|program|completed|newhire|turnover|attrition"),
    "women_pct": (r"women|female|gender", r"board|director|senior|management|leadership"),
    "board_women_pct": (r"women|female|gender|boarddiversity", None),
    "training_hours": (r"training|learning", None), "lti": (r"losttime|ltif|ltir|injur", None), "fatalities": (r"fatalit|death", None),
    "community_rm": (r"communit|donation|contribution|csr|investment", None), "anticorruption_pct": (r"corruption|bribery", None),
}
KEYWORDS = [(re.compile(p, re.I), w) for p, w in [
    (r"scope\s*[123]", 5), (r"tco2e?|co2e|ghg|greenhouse", 4), (r"ifrs\s*s[12]|tcfd|issb", 4), (r"scenario", 3), (r"transition plan|net[- ]zero", 3),
    (r"energy consumption|electricity|mwh|\bgj\b|kwh", 3), (r"water (?:consumption|withdrawal)|m3|megalit", 3), (r"waste", 2),
    (r"employees|workforce|headcount", 2), (r"women|female|gender", 2), (r"training hours|hours of training", 3),
    (r"lost[- ]time|ltifr|ltir|fatalit", 3), (r"anti-?corruption|anti-?bribery", 2), (r"community|donation|csr", 1),
    (r"board (?:of directors|oversight)|sustainability committee", 2), (r"performance data|data table|key indicators|common (?:sustainability )?matters", 4),
    (r"assurance|assured|limited assurance", 2)]]
# ESG 的好坏评价字眼 (除了 company_intel 的建议 / 利好利空过滤，再加这些)
ESG_JUDGE_RE = re.compile(r"领先|落后|优秀|出色|不足|欠佳|表现良好|表现不佳|\b(?:excellent|outstanding|leading|lagging|poor|weak|strong performance)\b", re.I)

PROMPT = """你是可持续发展报告的资料抽取助手。你会拿到一家马来西亚上市公司可持续发展报告或年报的部分页面，每页前面标了页码【第 N 页】。
只根据这些页面输出 JSON，字段：
- metrics：只抽下面列出的指标 (key 固定)。每个 {"key", "value" (原文写的数字，不带逗号；原文写 39.3 million 就填 39.3), "unit" (原文单位，连同 million / thousand，例如 million tCO2e、MWh、m3、%、人), "year" (数字属于哪一年，整数),
  "page" (页码，整数), "quote" (原文里包含这个数字的一小段，一字不改照抄，最多 200 字)}。
  同一个指标有好几年的数字，只要最新那一年。找不到的指标不要输出；不要推算、不要换算单位、不要把几个数字加起来。
  要分清楚：员工总数 ≠ 参加培训的员工；女性员工比例 ≠ 女性高管 / 女性董事比例。
- readiness：下面列出的每一项都要输出一个 {"key", "status": "found" | "partial" | "not_found", "page": 主要出现的页码 (没找到就 null), "note": 一句中文说明报告里写了什么, "note_en": 英文}。
  这只是「报告里有没有写」，不是合规意见。note 描述报告内容；这些页面里找不到时写「报告中没有找到相关披露」，不要提到「提供的页面」。
- summary：2–3 句中文，只陈述报告披露了什么 (报告期、涵盖范围、主要数字)；summary_en 英文版。
不要用「领先」「优秀」「不足」「表现良好」之类的评价，不要给投资建议。只输出 JSON。"""


def download(url):
    """下载 PDF (最多 MAX_BYTES)；不是 PDF 就报错"""
    with m.requests.get(url, headers=UA, timeout=60, stream=True) as r:
        r.raise_for_status()
        buf = io.BytesIO()
        for chunk in r.iter_content(64 * 1024):
            buf.write(chunk)
            if buf.tell() > MAX_BYTES:
                raise ValueError(f"PDF 超过 {MAX_BYTES // 1024 // 1024}MB")
    data = buf.getvalue()
    if not data.startswith(b"%PDF"):
        raise ValueError("下载到的不是 PDF (网址可能是网页或需要登入)")
    return data


def pdf_pages(data):
    """每页的文字 (空白合并)"""
    from pypdf import PdfReader
    out = []
    for page in PdfReader(io.BytesIO(data)).pages:
        try:
            t = page.extract_text() or ""
        except Exception:  # noqa: BLE001  (个别页面坏掉不影响其他页)
            t = ""
        out.append(re.sub(r"\s+", " ", t).strip())
    return out


def pick_pages(pages, n=PAGES_TO_AI):
    """挑页面 (页码从 1 开始，按页码排序)：每个披露项目在整份报告里最相关的 1 页 + 指标关键词分数最高的页，合计最多 n 页"""
    scored = []
    for i, t in enumerate(pages):
        s = sum(w * min(3, len(rx.findall(t))) for rx, w in KEYWORDS)
        s += min(4, len(re.findall(r"\d[\d,]*\.?\d*", t)) // 25)  # 数字多的页 (资料表) 加分
        if s > 0:
            scored.append((s, i + 1))
    chosen = []
    for kw in READY_KW.values():
        rx = re.compile(kw, re.I)
        hits = sorted(((len(rx.findall(t)), i + 1) for i, t in enumerate(pages) if rx.search(t)), reverse=True)
        if hits and hits[0][1] not in chosen:
            chosen.append(hits[0][1])
    for _, p in sorted(scored, reverse=True):
        if len(chosen) >= n:
            break
        if p not in chosen:
            chosen.append(p)
    return sorted(chosen[:n])


def ask(code, name, entry, pages, sel):
    lines = [f"公司: {name} ({code})", f"报告: {entry.get('type', 'sustainability')} {entry.get('year', '')}", "要抽的指标 (key: 说明):"]
    lines += [f"- {k}: {v[2]}" for k, v in METRICS.items()]
    lines.append("要检查的披露项目 (key: 说明):")
    lines += [f"- {k}: {v[2]}" for k, v in READINESS.items()]
    lines.append("页面:")
    lines += [f"【第 {p} 页】 {pages[p - 1][:PAGE_CHARS]}" for p in sel]
    r = m.ai_chat(
        temperature=0.1, max_tokens=3000, response_format={"type": "json_object"},
        messages=[{"role": "system", "content": PROMPT}, {"role": "user", "content": "\n".join(lines)}])
    return json.loads(r.choices[0].message.content or "{}")


def _squash(t):
    return re.sub(r"\s+", "", str(t or "")).lower()


def _num(v):
    try:
        return float(str(v).replace(",", "").strip())
    except (TypeError, ValueError):
        return None


def verify_metric(mt, pages, why=None):
    """引句要在那一页、数值要在引句里、意思要对 (METRIC_CTX)，否则 None (why 收集丢掉的原因)"""
    def drop(reason):
        if why is not None:
            why.append({"key": mt.get("key"), "reason": reason})
        return None
    key, page, quote, val = mt.get("key"), mt.get("page"), str(mt.get("quote") or "").strip(), _num(mt.get("value"))
    try:
        page = int(page)
    except (TypeError, ValueError):
        return None
    if key not in METRICS or val is None or not quote or not (1 <= page <= len(pages)):
        return drop("format")
    sq, sp = _squash(quote), _squash(pages[page - 1])
    pos = sp.find(sq)
    if pos < 0:
        return drop("quote not on page")
    nums = [_num(x) for x in re.findall(r"\d[\d,]*(?:\.\d+)?", quote)]
    if not any(x is not None and abs(x - val) <= 1e-9 * max(1.0, abs(val)) for x in nums):
        return drop("value not in quote")
    need, bad = METRIC_CTX.get(key, (None, None))
    if need and not re.search(need, sp[max(0, pos - 400):pos] + sq, re.I):
        return drop("wrong metric (context)")
    if bad and re.search(bad, sq, re.I):
        return drop("wrong metric (excluded words)")
    try:
        year = int(mt.get("year")) if mt.get("year") is not None else None
    except (TypeError, ValueError):
        year = None
    return {"key": key, "value": val, "unit": str(mt.get("unit") or "")[:30], "year": year, "page": page, "quote": quote[:240]}


def neutral(text, en=False):
    t = clean_en(text) if en else clean(text)
    if en:  # 英文按句子切 (句号后面要有空白，小数 39.312 不会被切开)
        return " ".join(p for p in re.split(r"(?<=[.;!?])\s+", t) if p and not ESG_JUDGE_RE.search(p)).strip()
    return "".join(p for p in re.split(r"(?<=[。；;!?])", t) if p and not ESG_JUDGE_RE.search(p)).strip()


def cut(text, n):
    """太长就在 n 字以内最后一个句号处截断 (不切在句子中间)；整段没有句号才硬切。"""
    if len(text) <= n:
        return text
    head = text[:n]
    m = max(head.rfind(c) for c in ("。", "；", ". ", "; "))
    return head[:m + 1].strip() if m > n // 3 else head.rstrip() + "…"


def verify_readiness(items, pages):
    out = {}
    for it in items or []:
        k, st = it.get("key"), it.get("status")
        if k not in READINESS or st not in STATUSES or k in out:
            continue
        try:
            page = int(it.get("page")) if it.get("page") is not None else None
        except (TypeError, ValueError):
            page = None
        if page is not None and not (1 <= page <= len(pages)):
            page = None
        if st != "not_found" and page is None:
            st = "partial"  # 说有写但给不出页码：降一级
        out[k] = {"key": k, "status": st, "page": page if st != "not_found" else None,
                  "note": cut(neutral(it.get("note")), 120), "note_en": cut(neutral(it.get("note_en"), en=True), 200)}
    for k in READINESS:  # AI 漏掉的项目当成没找到
        out.setdefault(k, {"key": k, "status": "not_found", "page": None, "note": "", "note_en": ""})
    return [out[k] for k in READINESS]


def annual_revenue(code, year):
    """那一年的年报营收 (RM)；没有就 None"""
    fin = (read_json(os.path.join("docs", "stock", f"{code}.json"), {}) or {}).get("fin") or {}
    a = fin.get("annual") or {}
    periods, rev = a.get("periods") or [], a.get("revenue") or []
    for i, p in enumerate(periods):
        if str(p)[:4] == str(year) and i < len(rev) and rev[i]:
            return rev[i], fin.get("currency") or "MYR"
    return None, None


def scale(unit):
    """单位里的倍数：million / mil / juta = 1e6，thousand / '000 / k = 1e3"""
    u = str(unit or "").lower()
    if re.search(r"million|\bmil\b|juta|\bmn\b", u):
        return 1e6
    if re.search(r"thousand|'000|\bkt\b|ktco2", u):
        return 1e3
    return 1.0  # kWh / MWh / GJ 是不同单位，不是倍数：强度照原单位写


def intensity(code, year, metrics):
    rev, cur = annual_revenue(code, year)
    if not rev or cur not in ("MYR", "RM"):
        return None
    by = {x["key"]: x for x in metrics}
    out = {"revenue_rm_m": round(rev / 1e6, 2), "year": year}
    s12 = [by[k] for k in ("ghg_scope1", "ghg_scope2") if k in by and re.search(r"co2", by[k]["unit"], re.I)]
    if s12:
        out["ghg12_per_rm_m"] = round(sum(x["value"] * scale(x["unit"]) for x in s12) / (rev / 1e6), 4)
        out["ghg12_unit"] = "tCO2e / RM mil"
    if "energy" in by:
        u = by["energy"]["unit"]
        out["energy_per_rm_m"] = round(by["energy"]["value"] * scale(u) / (rev / 1e6), 4)
        out["energy_unit"] = re.sub(r"(?i)million|thousand|'000|\bmil\b", "", u).strip() + " / RM mil"
    return out if len(out) > 2 else None


def choose(entries):
    ok = [e for e in entries or [] if isinstance(e, dict) and str(e.get("url", "")).startswith(("http://", "https://"))]
    return sorted(ok, key=lambda e: (e.get("type") == "sustainability", int(e.get("year") or 0)), reverse=True)[0] if ok else None


def process(code, entry, now, force=False, dry=False, log=print):
    path = os.path.join(OUT_DIR, f"{code}.json")
    old = read_json(path, None)
    detail = read_json(os.path.join("docs", "stock", f"{code}.json"), {}) or {}
    name = detail.get("long_name") or code
    base = {"v": 1, "code": code, "name": name, "sector": (detail.get("profile") or {}).get("sector"), "year": entry.get("year"),
            "updated": now.strftime("%Y-%m-%d %H:%M"), "source": {"url": entry["url"], "type": entry.get("type", "sustainability")}}
    try:
        data = download(entry["url"])
    except Exception as e:  # noqa: BLE001
        log(f"⚠️ {code} 下载失败：{type(e).__name__}: {e}")
        return None if old else dict(base, status="error", error=f"{type(e).__name__}: {e}"[:200])
    sha = hashlib.sha1(data).hexdigest()
    if old and old.get("source", {}).get("sha1") == sha and old.get("status") == "ok" and not force:
        log(f"   {code} PDF 没变，跳过")
        return None
    pages = pdf_pages(data)
    base["source"].update({"sha1": sha, "pages": len(pages)})
    if sum(len(t) for t in pages) < 500:
        log(f"⚠️ {code} PDF 抽不出文字 (可能是扫描图片版)，需要人工")
        return dict(base, status="no_text")
    sel = pick_pages(pages)
    out = ask(code, name, entry, pages, sel)
    metrics, dropped, why = [], 0, []
    for mt in out.get("metrics") or []:
        v = verify_metric(mt, pages, why)
        if v and v["key"] not in {x["key"] for x in metrics}:
            v["label"], v["label_en"] = METRICS[v["key"]][0], METRICS[v["key"]][1]
            metrics.append(v)
        else:
            dropped += 1
    rec = dict(base, status="ok", pages_used=sel, summary=cut(neutral(out.get("summary")), 400), summary_en=cut(neutral(out.get("summary_en"), en=True), 700),
               metrics=sorted(metrics, key=lambda x: list(METRICS).index(x["key"])), readiness=verify_readiness(out.get("readiness"), pages), dropped=dropped, dropped_why=why[:20])
    yr = entry.get("year") or max([x["year"] for x in metrics if x.get("year")] or [None])
    rec["intensity"] = intensity(code, yr, metrics) if yr else None
    log(f"   {code} 指标 {len(metrics)} 个 (丢掉 {dropped} 个对不上原文的)，披露项目 found "
        f"{sum(1 for r in rec['readiness'] if r['status'] == 'found')}/{len(READINESS)}")
    return rec


def write_index(now):
    items = []
    for fn in sorted(os.listdir(OUT_DIR)):
        if not fn.endswith(".json") or fn == "index.json":
            continue
        r = read_json(os.path.join(OUT_DIR, fn), None)
        if not r or r.get("status") != "ok":
            continue
        items.append({"code": r["code"], "name": r.get("name"), "sector": r.get("sector"), "year": r.get("year"),
                      "metrics": {x["key"]: {"value": x["value"], "unit": x["unit"], "year": x.get("year")} for x in r.get("metrics") or []},
                      "found": sum(1 for x in r.get("readiness") or [] if x["status"] == "found"), "intensity": r.get("intensity")})
    with open(INDEX, "w", encoding="utf-8") as f:
        json.dump({"v": 1, "updated": now.strftime("%Y-%m-%d %H:%M"), "readiness_total": len(READINESS), "items": items}, f, ensure_ascii=False, separators=(",", ":"))
    return len(items)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--codes", default="")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    now = datetime.now(m.LOCAL_TZ)
    src = {k: v for k, v in (read_json(SOURCES, {}) or {}).items() if not k.startswith("_")}
    want = [c.strip() for c in a.codes.split(",") if c.strip()]
    todo = [(c, choose(src.get(c))) for c in (want or sorted(src))]
    todo = [(c, e) for c, e in todo if e]
    print(f"🌱 ESG：sources.json {len(src)} 家，这次处理 {len(todo)} 家")
    os.makedirs(OUT_DIR, exist_ok=True)
    changed = 0
    for code, entry in todo:
        try:
            rec = process(code, entry, now, a.force, a.dry_run)
        except Exception as e:  # noqa: BLE001  (一家失败不影响其他家)
            print(f"⚠️ {code} 抽取失败 ({type(e).__name__}: {e})")
            continue
        if rec is None:
            continue
        if a.dry_run:
            print(json.dumps(rec, ensure_ascii=False, indent=1)[:4000])
            continue
        with open(os.path.join(OUT_DIR, f"{code}.json"), "w", encoding="utf-8") as f:
            json.dump(rec, f, ensure_ascii=False, separators=(",", ":"))
        changed += 1
    if not a.dry_run and (changed or not os.path.exists(INDEX)):
        n = write_index(now)
        print(f"🌱 完成：更新 {changed} 家；index 共 {n} 家")


if __name__ == "__main__":
    main()
