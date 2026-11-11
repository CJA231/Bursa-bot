"""
公司情报 (AI 分析)：用 DeepSeek 把每家马股公司「最近发生什么事」整理成中文，跟每日筛选完全分开跑。

每家公司收集：
- 公告：KLSE Screener 个股公告页 (最近 90 天，最多 25 条)
- 新闻：Google News / Yahoo (跟报告同一套搜法，最近 90 天，最多 8 条)
- 财报：docs/stock/<代码>.json 里的季报 → 由程序算好「比去年同季 / 比上一季」的变化 (DeepSeek 只负责描述，不自己算数字)
- 公司简介：同一个文件里的 profile
DeepSeek 输出 (JSON)：近况 2~3 句、利好 / 风险各几条、财报一两句、每条公告一个标签 (catalyst 利好 / risk 风险 / routine 例行)。

写到 docs/intel/<代码>.json，另外 docs/intel/index.json 放每家公司的更新日期、利好 / 风险条数和最近公告的标签 (终端版公告页用)。
输入没变 (公告、新闻、最新一季财报都一样) 就不再问 DeepSeek；超过 REFRESH_DAYS 天才重新抓。
文字只整理公开资料，不给买卖建议 (提示词要求 + strip_trade_advice 再过滤一次)。

用法:
  python scripts/company_intel.py                 # 补 / 更新最多 --limit 家 (默认 120)
  python scripts/company_intel.py --codes 5335,1155 --force
  python scripts/company_intel.py --limit 30 --dry-run   # 只收集资料、不调用 DeepSeek
在 Actions 跑: .github/workflows/company_intel.yml (手动或每天一次)
"""
import argparse
import hashlib
import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, ROOT)
os.chdir(ROOT)
os.environ.setdefault("MARKET", "MY")
import main as m  # noqa: E402  (借用报告的抓取函数、DeepSeek client 和过滤建议字眼的函数)

INTEL_DIR = os.path.join("docs", "intel")
INDEX_PATH = os.path.join(INTEL_DIR, "index.json")
REFRESH_DAYS = 7         # 输入没变也每 7 天重抓一次 (公告 / 新闻可能有更新)
ANN_DAYS, ANN_MAX = 90, 25
NEWS_MAX = 8
INDEX_TAG_DAYS = 45       # index.json 只放最近 45 天公告的标签 (控制文件大小)
FETCH_WORKERS = 4
TAGS = ("catalyst", "risk", "routine")

SYSTEM_PROMPT = """你是马来西亚上市公司的资料整理助手，帮投资者快速看懂一家公司最近发生了什么。
你会拿到：公司名称和简介、最近的公告标题 (有编号)、最近的新闻标题、程序算好的财报变化。
用简体中文输出 JSON，字段：
- recent: 2~3 句，这家公司最近在发生什么 (合约、业务、财报、企业活动、股权变动、监管事件)。没有资料就写「近期没有重要公告或新闻」。
- catalysts: 0~3 条，可能对公司有正面影响的事件，每条一句，引用具体事件。
- risks: 0~3 条，值得留意的风险事件，每条一句 (例如：私募 / 附加股摊薄、交易所 UMA 询问、核数师保留意见、大股东或董事减持、亏损扩大、诉讼、违约)。
- earnings: 1~2 句描述财报变化，只能用给你的数字，不能自己推算新数字；没有财报资料就留空字符串。
- tags: 每条公告一个对象 {"i": 公告编号, "t": "catalyst" 或 "risk" 或 "routine", "why": "10 个字以内的原因"}。
  股东大会通知、董事持股例行申报、更正、季度报告本身归 routine (财报内容另外写在 earnings)。
规则：只根据给你的资料，不要编造事件或数字；不要评价股价会涨会跌；不要给任何买入、卖出、持有、目标价之类的建议。
公司名、产品名、机构名保留英文。只输出 JSON。"""


def fin_facts(fin):
    """最新一季跟去年同季、上一季比：营收、净利润、净利率 (程序算，给 DeepSeek 描述 + 页面直接显示)"""
    q = (fin or {}).get("quarterly") or {}
    periods = q.get("periods") or []
    if not periods:
        return None
    i = len(periods) - 1

    def val(k, j):
        arr = q.get(k) or []
        return arr[j] if 0 <= j < len(arr) else None

    def chg(a, b):
        return round((a / b - 1) * 100, 1) if a is not None and b not in (None, 0) and b > 0 else None

    def margin(j):
        r, n = val("revenue", j), val("net_income", j)
        return round(n / r * 100, 1) if r and n is not None else None
    yoy = i - 4  # 季报一年 4 季
    out = {"period": periods[i], "currency": fin.get("currency") or "MYR",
           "revenue": val("revenue", i), "net_income": val("net_income", i), "net_margin": margin(i),
           "revenue_qoq": chg(val("revenue", i), val("revenue", i - 1)), "net_income_qoq": chg(val("net_income", i), val("net_income", i - 1)),
           "revenue_yoy": chg(val("revenue", i), val("revenue", yoy)) if yoy >= 0 else None,
           "net_income_yoy": chg(val("net_income", i), val("net_income", yoy)) if yoy >= 0 else None,
           "net_margin_prev": margin(i - 1), "loss": (val("net_income", i) or 0) < 0}
    return out


def load_detail(code):
    try:
        with open(os.path.join(m.DETAIL_DIR, f"{code}.json"), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def collect(code, name, now):
    """一家公司要给 DeepSeek 的资料；公告和新闻都抓不到 (网站出错) 返回 None，下次再试"""
    detail = load_detail(code)
    long_name = (detail.get("long_name") or "").strip() or None
    since = (now - timedelta(days=ANN_DAYS)).strftime("%Y-%m-%d")
    ann, ann_ok = [], True
    try:
        ann = [a for a in m.klse_announcements(code) if a["date"] >= since][:ANN_MAX]
    except Exception as e:
        ann_ok = False
        print(f"⚠️ {code} 公告抓取失败 ({type(e).__name__}: {e})")
    news = None
    try:
        news = m.fetch_news(f"{code}.KL", name, long_name, now)
    except Exception as e:
        print(f"⚠️ {code} 新闻抓取失败 ({type(e).__name__}: {e})")
    if not ann_ok and news is None:
        return None
    items = [{"title": n["title"], "source": n.get("source"), "link": n.get("link"),
              "date": datetime.fromtimestamp(n["time"], m.LOCAL_TZ).strftime("%Y-%m-%d") if n.get("time") else None}
             for n in ((news or {}).get("items") or [])[:NEWS_MAX]]
    prof = detail.get("profile") or {}
    return {"code": code, "name": name, "long_name": long_name, "ann": ann, "news": items,
            "facts": fin_facts(detail.get("fin")), "profile": prof.get("zh") or (prof.get("summary") or "")[:600],
            "industry": " / ".join(x for x in (prof.get("sector"), prof.get("industry")) if x)}


def input_hash(c):
    key = json.dumps([[a["id"] for a in c["ann"]], [n["title"] for n in c["news"]], (c["facts"] or {}).get("period")], ensure_ascii=False)
    return hashlib.sha1(key.encode()).hexdigest()[:16]


def ask(c):
    facts = c["facts"]
    lines = [f"公司: {c['long_name'] or c['name']} ({c['name']}, {c['code']})"]
    if c["industry"]:
        lines.append(f"行业: {c['industry']}")
    if c["profile"]:
        lines.append(f"简介: {c['profile']}")
    lines.append("公告 (编号. 日期 标题):" if c["ann"] else "公告: 最近 90 天没有")
    lines += [f"{i}. {a['date']} {a['title']}" for i, a in enumerate(c["ann"])]
    lines.append("新闻:" if c["news"] else "新闻: 最近没有")
    lines += [f"- {n['date'] or ''} [{n['source'] or ''}] {n['title']}" for n in c["news"]]
    if facts:
        lines.append("财报 (程序算好的，单位 " + facts["currency"] + "): " + json.dumps(
            {k: v for k, v in facts.items() if k != "currency" and v is not None}, ensure_ascii=False))
    r = m.client.chat.completions.create(
        model="deepseek-chat", temperature=0.1, max_tokens=900, response_format={"type": "json_object"},
        messages=[{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": "\n".join(lines)}])
    return json.loads(r.choices[0].message.content or "{}")


def clean(text):
    return m.strip_trade_advice(str(text or "").strip())


def build_record(c, out, now, h):
    tags = {}
    for t in out.get("tags") or []:
        try:
            i = int(t.get("i"))
        except (TypeError, ValueError):
            continue
        if 0 <= i < len(c["ann"]) and t.get("t") in TAGS:
            tags[i] = (t["t"], clean(t.get("why")).rstrip("。")[:30])
    ann = [{"id": a["id"], "date": a["date"], "title": a["title"], "link": a["link"], "cat": a["cat"],
            "tag": tags.get(i, ("routine", ""))[0], "why": tags.get(i, ("", ""))[1]} for i, a in enumerate(c["ann"])]
    return {"v": 1, "code": c["code"], "name": c["name"], "long_name": c["long_name"], "updated": now.strftime("%Y-%m-%d %H:%M"),
            "hash": h, "recent": clean(out.get("recent")),
            "catalysts": [x for x in (clean(s) for s in (out.get("catalysts") or [])[:3]) if x],
            "risks": [x for x in (clean(s) for s in (out.get("risks") or [])[:3]) if x],
            "earnings": clean(out.get("earnings")) if c["facts"] else "", "facts": c["facts"], "ann": ann, "news": c["news"]}


def read_json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def pick(universe, priority, limit, force, now):
    """先做报告里的股票 (priority 顺序)，再做其余；没有文件 / 超过 REFRESH_DAYS 天的才做"""
    cut = (now - timedelta(days=REFRESH_DAYS)).strftime("%Y-%m-%d")
    order = {c: i for i, c in enumerate(priority)}
    todo = []
    for code, name in sorted(universe.items(), key=lambda kv: (order.get(kv[0], 1e9), kv[0])):
        rec = read_json(os.path.join(INTEL_DIR, f"{code}.json"), None)
        if force or not rec or rec.get("updated", "")[:10] < cut:
            todo.append((code, name))
    return todo[:limit]


def write_index(now):
    since = (now - timedelta(days=INDEX_TAG_DAYS)).strftime("%Y-%m-%d")
    items = {}
    for fn in sorted(os.listdir(INTEL_DIR)):
        if not fn.endswith(".json") or fn == "index.json":
            continue
        rec = read_json(os.path.join(INTEL_DIR, fn), None)
        if not rec:
            continue
        items[rec["code"]] = {"u": rec["updated"][:10], "c": len(rec.get("catalysts") or []), "r": len(rec.get("risks") or []),
                              "t": {a["id"]: a["tag"] for a in rec.get("ann") or [] if a["date"] >= since and a["tag"] != "routine"}}
    with open(INDEX_PATH, "w", encoding="utf-8") as f:
        json.dump({"v": 1, "updated": now.strftime("%Y-%m-%d %H:%M"), "items": items}, f, ensure_ascii=False, separators=(",", ":"))
    return len(items)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=120)
    ap.add_argument("--codes", default="")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    now = datetime.now(m.LOCAL_TZ)
    os.makedirs(INTEL_DIR, exist_ok=True)
    universe = {r["symbol"].split(".")[0]: r.get("name") or r["symbol"] for r in read_json(m.WATCHLIST_PATH, []) if r.get("symbol", "").endswith(".KL")}
    if a.codes:
        want = [c.strip() for c in a.codes.split(",") if c.strip()]
        universe = {c: universe.get(c, c) for c in want}
    term = read_json(os.path.join("docs", "terminal", "data.json"), {})
    priority = [s[0] for s in sorted(term.get("stocks") or [], key=lambda s: -(s[5] or 0))]  # 报告里的股票按成交额
    todo = pick(universe, priority, a.limit, a.force or bool(a.codes), now)
    print(f"🧠 公司情报：名单 {len(universe)} 家，这次处理 {len(todo)} 家")
    with ThreadPoolExecutor(FETCH_WORKERS) as pool:
        collected = list(pool.map(lambda cn: collect(cn[0], cn[1], now), todo))
    done = same = failed = 0
    for (code, name), c in zip(todo, collected):
        if c is None:
            failed += 1
            continue
        path = os.path.join(INTEL_DIR, f"{code}.json")
        h, old = input_hash(c), read_json(path, None)
        if old and old.get("hash") == h and not a.force:
            old["updated"] = now.strftime("%Y-%m-%d %H:%M")  # 资料没变：不再问 DeepSeek，只更新检查时间
            rec = old
            same += 1
        elif a.dry_run:
            print(f"   {code} {name}: 公告 {len(c['ann'])} 条、新闻 {len(c['news'])} 条、财报 {'有' if c['facts'] else '无'}")
            continue
        else:
            try:
                rec = build_record(c, ask(c), now, h)
            except Exception as e:
                print(f"⚠️ DeepSeek 失败 {code} ({type(e).__name__}: {e})，这次先停")
                break  # 多半是限流 / 额度问题
            done += 1
            time.sleep(0.5)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(rec, f, ensure_ascii=False, separators=(",", ":"))
    n = write_index(now)
    print(f"🧠 完成：DeepSeek 分析 {done} 家，资料没变沿用 {same} 家，抓取失败 {failed} 家；index 共 {n} 家")


if __name__ == "__main__":
    main()
