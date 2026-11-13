"""
公司情报 (AI 分析)：用 DeepSeek 把每家马股公司「最近发生什么事」整理成中文，跟每日筛选完全分开跑。

每家公司收集：
- 公告：KLSE Screener 个股公告页 (最近 90 天，最多 25 条)
- 新闻：Google News / Yahoo (跟报告同一套搜法，最近 90 天，最多 8 条)
- 财报：docs/stock/<代码>.json 里的季报 → 由程序算好「比去年同季 / 比上一季」的变化 (DeepSeek 只负责描述，不自己算数字)
- 公司简介：同一个文件里的 profile
DeepSeek 输出 (JSON)：近况 2~3 句、重要事件 / 留意事项各几条、财报一两句、每条公告一个标签 (notable 重要事件 / risk 留意 / routine 例行)。
全部只陈述事实，不判断好坏 (不写「利好」「利空」这类会被当成买卖信号的字眼)。

写到 docs/intel/<代码>.json，另外 docs/intel/index.json 放每家公司的更新日期、重要事件 / 留意事项条数和最近公告的标签 (终端版公告页用)。

网站管理员 (owner) 在终端版网页上编辑过的内容 (docs/terminal/overrides.json，经 worker/ai-proxy.js 提交)：
重新整理那家公司时，AI 先照常整理出新版本 (A)，再把 A、管理员的版本 (B) 和原始资料一起交给 DeepSeek 核对：
B 有根据的照 B 写、A 的新事件补进去、跟资料矛盾的用资料的数字并列进 conflicts、找不到根据的保留并列进 unverified。
合并结果写进 docs/intel/<代码>.json，原本的 AI 版本放在 "ai"，核对结果放在 "owner" (终端版只给管理员看 conflicts / unverified)。
管理员一有新的编辑，下次运行就会优先重新核对那家公司。
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
TAGS = ("notable", "risk", "routine")
# 企业活动日历：标题像这些的公告，去抓内文给 DeepSeek 找日期 (每家最多 EVENT_MAX 条)
EVENT_RE = re.compile(r"book closure|entitlement|dividend|general meeting|\bAGM\b|\bEGM\b|bonus|rights issue|subdivision|consolidation|share split|"
                      r"listing|warrant|private placement|\bIPO\b|prospectus|special issue|capital repayment|distribution", re.I)
EVENT_MAX, EVENT_BODY = 6, 2200
EVENT_TYPES = ("agm", "egm", "ex_date", "entitlement", "payment", "results", "listing", "corporate")
CAL_PATH = os.path.join(INTEL_DIR, "calendar.json")
CAL_BACK, CAL_AHEAD = 7, 180  # 日历放过去 7 天到未来 180 天
OVR_PATH = os.path.join("docs", "terminal", "overrides.json")  # 管理员在网页上的编辑 (worker 提交)
INTEL_FIELDS = ("recent", "notable", "risks", "earnings", "recent_en", "notable_en", "risks_en", "earnings_en")

SYSTEM_PROMPT = """你是马来西亚上市公司的资料整理助手，帮投资者快速看懂一家公司最近发生了什么。
你会拿到：公司名称和简介、最近的公告标题 (有编号)、最近的新闻标题、程序算好的财报变化。
用简体中文输出 JSON，字段：
- recent: 2~3 句，这家公司最近在发生什么 (合约、业务、财报、企业活动、股权变动、监管事件)。没有资料就写「近期没有重要公告或新闻」。
- notable: 0~3 条，近期的重要事件 (例如：获得合约、收购 / 出售资产、新业务、业绩发布、派息、红股)，每条一句，只陈述发生了什么，不说对公司是好是坏。
- risks: 0~3 条，需要留意的事项，每条一句 (例如：私募 / 附加股摊薄、交易所 UMA 询问、核数师保留意见、大股东或董事减持、亏损扩大、诉讼、违约)，同样只陈述事实。
- earnings: 1~2 句描述财报变化，只能用给你的数字，不能自己推算新数字；没有财报资料就留空字符串。
- tags: 每条公告一个对象 {"i": 公告编号, "t": "notable" 或 "risk" 或 "routine", "why": "10 个字以内，说明是什么事件 (例如「合约 RM50M」「私募 10%」)"}。
  股东大会通知、董事持股例行申报、更正、季度报告本身归 routine (财报内容另外写在 earnings)。
- events: 从「公告内文」里找出明确写着的日期，每个日期一个对象 {"i": 公告编号, "type": 类型, "date": "YYYY-MM-DD", "what": "20 字以内中文，例如 第 2 次中期股息每股 5 仙"}。
  type 只能是: agm (常年股东大会), egm (特别股东大会), ex_date (除权 / 除息日), entitlement (登记 / 截止过户日), payment (派发 / 付款日),
  results (业绩公布日), listing (新股、凭单 warrants、红股、附加股、私募新股的上市日), corporate (其他企业活动日期，例如认购截止、合并生效)。
  只能用内文里写明的日期，看不到就不要写；不要推算。
另外每个文字字段都要附英文版 (意思一样、简洁的商业英文)：recent_en、notable_en、risks_en、earnings_en，tags 里加 "why_en"，events 里加 "what_en"。
规则：只根据给你的资料，不要编造事件或数字；不要用「利好」「利空」「正面」「负面」「看好」之类的评价字眼；不要评价股价会涨会跌；不要给任何买入、卖出、持有、目标价之类的建议。
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
    bodies = {}
    for i, a in enumerate(ann):
        if len(bodies) >= EVENT_MAX:
            break
        if EVENT_RE.search(a["title"]):
            try:
                bodies[i] = ann_body(a["id"])
            except Exception as e:
                print(f"⚠️ {code} 公告内文抓取失败 {a['id']} ({type(e).__name__})")
    prof = detail.get("profile") or {}
    return {"code": code, "name": name, "long_name": long_name, "ann": ann, "news": items, "bodies": bodies,
            "facts": fin_facts(detail.get("fin")), "profile": prof.get("zh") or (prof.get("summary") or "")[:600],
            "industry": " / ".join(x for x in (prof.get("sector"), prof.get("industry")) if x)}


def ann_body(ann_id):
    """KLSE Screener 公告页的正文 (Bursa 原文的字段：日期、金额、股数…)，去掉网站菜单和页尾"""
    r = m.requests.get(m.KLSE_ANN_VIEW.format(ann_id), headers=m.KLSE_HEADERS, timeout=20)
    r.raise_for_status()
    body = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", r.text)
    t = re.sub(r"\s+", " ", m.html.unescape(re.sub(r"<[^>]+>", " ", body)))
    k = t.find("disabling or pausing your ad blocker.")
    t = t[k + 38:] if k >= 0 else t
    end = t.find("View original announcement")
    return t[:end if end > 0 else len(t)].strip()[:EVENT_BODY]


def owner_stamp(ov):
    """管理员编辑的时间戳 (资讯 + 日历)；没有编辑就是空字符串"""
    ov = ov or {}
    return "|".join(x for x in ((ov.get("intel") or {}).get("at"), (ov.get("events") or {}).get("at")) if x)


def input_hash(c, ov=None):
    # 管理员编辑过就算输入变了 → 下次重新核对合并
    key = json.dumps([[a["id"] for a in c["ann"]], [n["title"] for n in c["news"]], (c["facts"] or {}).get("period"), 3, owner_stamp(ov)], ensure_ascii=False)  # 3 = 加了日历 + 英文版之后的版本
    return hashlib.sha1(key.encode()).hexdigest()[:16]


def source_lines(c):
    """给 DeepSeek 的原始资料 (公司、公告、新闻、公告内文、财报)；整理和核对合并共用"""
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
    if c.get("bodies"):
        lines.append("公告内文 (找日期用):")
        lines += [f"[{i}] {txt}" for i, txt in c["bodies"].items()]
    if facts:
        lines.append("财报 (程序算好的，单位 " + facts["currency"] + "): " + json.dumps(
            {k: v for k, v in facts.items() if k != "currency" and v is not None}, ensure_ascii=False))
    return lines


def ask(c):
    r = m.client.chat.completions.create(
        model="deepseek-chat", temperature=0.1, max_tokens=2400, response_format={"type": "json_object"},
        messages=[{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": "\n".join(source_lines(c))}])
    return json.loads(r.choices[0].message.content or "{}")


MERGE_PROMPT = """你是资料核对员。同一家马来西亚上市公司有两份「近况整理」：
A = AI 根据最新的公告、新闻、财报整理的版本；B = 网站管理员 (owner) 人工编辑的版本，可能附有管理员提供的参考资料。
任务：对照「原始资料」(公告、新闻、公告内文、财报数字、管理员参考资料) 核实 A 和 B，合并成一份最终版本。规则：
1. B 的内容有原始资料或管理员参考资料支持的，保留 B 的写法 (管理员的措辞优先)。
2. A 有、B 没有的事件 (通常是 B 编辑之后才出现的新公告)，补进最终版本。
3. B 跟原始资料矛盾的 (例如金额、日期、股数不一样)，最终版本用原始资料的数字，并在 conflicts 写一句：B 写的是什么、资料写的是什么、根据哪条资料。
4. B 有、但原始资料和参考资料都找不到根据的，保留在最终版本，但在 unverified 写一句是哪一点。
5. owner_events 是管理员对企业活动日历的新增 / 更正 / 删除，逐条对照公告内文；跟资料矛盾的写进 conflicts，找不到根据的写进 unverified。
6. 只陈述事实，不用「利好」「利空」「看好」「正面」「负面」之类的评价，不给任何买卖建议；数字只能用资料里有的。
7. B 为空时，最终版本 = A，conflicts / unverified 只看 owner_events。
8. conflicts / unverified 是写给管理员看的，不要用 A / B 称呼，中文用「你的编辑」「AI 新整理的」，英文用 "your edit" / "the new AI summary"。
输出 JSON：recent, notable[] (最多 3 条), risks[] (最多 3 条), earnings, recent_en, notable_en[], risks_en[], earnings_en,
conflicts[] (中文，每条一句), conflicts_en[], unverified[], unverified_en[]。只输出 JSON。"""


def merge_owner(c, rec, ov, now):
    """把管理员的版本 (B) 跟这次 AI 版本 (A) 对照原始资料核对、合并；失败就回传原本的 rec (页面会继续直接显示管理员的版本)"""
    intel, events = (ov.get("intel") or {}), ((ov.get("events") or {}).get("items") or [])
    a = {k: rec.get(k) for k in INTEL_FIELDS}
    b = {k: intel.get(k) for k in INTEL_FIELDS} if intel else {}
    lines = source_lines(c)
    if intel.get("refs"):
        lines += ["管理员参考资料:", intel["refs"][:6000]]
    lines += ["A (AI 版本):", json.dumps(a, ensure_ascii=False), "B (管理员版本):", json.dumps(b, ensure_ascii=False) if b else "(空)",
              "owner_events:", json.dumps(events, ensure_ascii=False) if events else "(没有)"]
    try:
        r = m.client.chat.completions.create(
            model="deepseek-chat", temperature=0.1, max_tokens=2400, response_format={"type": "json_object"},
            messages=[{"role": "system", "content": MERGE_PROMPT}, {"role": "user", "content": "\n".join(lines)}])
        out = json.loads(r.choices[0].message.content or "{}")
    except Exception as e:  # noqa: BLE001
        print(f"⚠️ {c['code']} 管理员版本核对合并失败 ({type(e).__name__}: {e})")
        return rec

    def zh_list(k, n=3):
        return [x for x in (clean(s) for s in (out.get(k) or [])[:n]) if x]

    def en_list(k, n=3):
        return [x for x in (clean_en(s) for s in (out.get(k) or [])[:n]) if x]
    merged = dict(rec)
    merged["ai"] = a  # 原本的 AI 版本 (管理员按「恢复成 AI 自动版本」时用)
    merged.update({"recent": clean(out.get("recent")) or rec.get("recent"), "notable": zh_list("notable"), "risks": zh_list("risks"),
                   "earnings": clean(out.get("earnings")) if c["facts"] else "", "recent_en": clean_en(out.get("recent_en")) or rec.get("recent_en"),
                   "notable_en": en_list("notable_en"), "risks_en": en_list("risks_en"), "earnings_en": clean_en(out.get("earnings_en")) if c["facts"] else ""})
    merged["owner"] = {"stamp": owner_stamp(ov), "intel_at": intel.get("at"), "events_at": (ov.get("events") or {}).get("at"),
                       "merged_at": now.strftime("%Y-%m-%d %H:%M"),
                       "conflicts": zh_list("conflicts", 8), "conflicts_en": en_list("conflicts_en", 8),
                       "unverified": zh_list("unverified", 8), "unverified_en": en_list("unverified_en", 8)}
    return merged


JUDGE_RE = re.compile(r"利好|利空|看好|看淡|看涨|看跌|正面消息|负面消息|bullish|bearish", re.I)


def clean(text):
    """去掉买卖建议 (main.strip_trade_advice) 和好坏评价字眼的分句"""
    t = m.strip_trade_advice(str(text or "").strip())
    parts = re.split(r"([，,。；;])", t)
    t = "".join(parts[i] + (parts[i + 1] if i + 1 < len(parts) else "") for i in range(0, len(parts), 2) if not JUDGE_RE.search(parts[i]))
    return t.strip().rstrip("，,；;")


EN_JUDGE_RE = re.compile(r"\b(buy|sell|hold|accumulate|bullish|bearish|stop[- ]?loss|take[- ]?profit|target price|upside|positive news|negative news)\b", re.I)


def clean_en(text):
    """英文版：去掉含买卖建议 / 好坏评价字眼的句子"""
    parts = re.split(r"(?<=[.;!?])\s+", str(text or "").strip())
    return " ".join(p for p in parts if p and not EN_JUDGE_RE.search(p)).strip()


def build_record(c, out, now, h):
    tags = {}
    for t in out.get("tags") or []:
        try:
            i = int(t.get("i"))
        except (TypeError, ValueError):
            continue
        if 0 <= i < len(c["ann"]) and t.get("t") in TAGS:
            tags[i] = (t["t"], clean(t.get("why")).rstrip("。")[:30], clean_en(t.get("why_en")).rstrip(".")[:40])
    ann = [{"id": a["id"], "date": a["date"], "title": a["title"], "link": a["link"], "cat": a["cat"],
            "tag": tags.get(i, ("routine", "", ""))[0], "why": tags.get(i, ("", "", ""))[1], "why_en": tags.get(i, ("", "", ""))[2]} for i, a in enumerate(c["ann"])]
    events = []
    lo, hi = (now - timedelta(days=60)).strftime("%Y-%m-%d"), (now + timedelta(days=400)).strftime("%Y-%m-%d")
    for ev in out.get("events") or []:
        try:
            i, d = int(ev.get("i")), str(ev.get("date") or "")
            datetime.strptime(d, "%Y-%m-%d")
        except (TypeError, ValueError):
            continue
        if 0 <= i < len(c["ann"]) and ev.get("type") in EVENT_TYPES and lo <= d <= hi:
            a = c["ann"][i]
            events.append({"date": d, "type": ev["type"], "what": clean(ev.get("what")).rstrip("。")[:40], "what_en": clean_en(ev.get("what_en")).rstrip(".")[:60],
                           "ann": a["id"], "link": a["link"], "src": "ai"})
    due = results_due(c["facts"], now)
    if due:
        events.append(due)
    events.sort(key=lambda e: e["date"])
    return {"v": 1, "code": c["code"], "name": c["name"], "long_name": c["long_name"], "updated": now.strftime("%Y-%m-%d %H:%M"),
            "hash": h, "recent": clean(out.get("recent")),
            "notable": [x for x in (clean(s) for s in (out.get("notable") or out.get("catalysts") or [])[:3]) if x],
            "risks": [x for x in (clean(s) for s in (out.get("risks") or [])[:3]) if x],
            "earnings": clean(out.get("earnings")) if c["facts"] else "", "facts": c["facts"], "ann": ann, "news": c["news"], "events": events,
            "recent_en": clean_en(out.get("recent_en")),
            "notable_en": [x for x in (clean_en(s) for s in (out.get("notable_en") or [])[:3]) if x],
            "risks_en": [x for x in (clean_en(s) for s in (out.get("risks_en") or [])[:3]) if x],
            "earnings_en": clean_en(out.get("earnings_en")) if c["facts"] else ""}


def results_due(facts, now):
    """下一份季报的最迟公布日：Bursa 规定季末后 2 个月内公布 → 最新已公布那季 + 3 个月 = 下一季末，再 + 2 个月 (程序算，不是公司宣布的日期)"""
    if not facts or not facts.get("period"):
        return None
    y, mth = int(facts["period"][:4]), int(facts["period"][5:7])
    mth += 5
    y, mth = y + (mth - 1) // 12, (mth - 1) % 12 + 1
    nxt = datetime(y + (mth == 12), mth % 12 + 1, 1) - timedelta(days=1)  # 那个月最后一天
    d = nxt.strftime("%Y-%m-%d")
    if d < now.strftime("%Y-%m-%d"):
        return None
    q_end_m = (int(facts["period"][5:7]) + 2) % 12 + 1
    mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][q_end_m - 1]
    return {"date": d, "type": "results_due", "what": f"下一季 ({q_end_m} 月底结束) 季报最迟公布日 · 交易所规定",
            "what_en": f"Deadline for the quarter ending {mon} (Bursa rule)", "src": "rule"}


def read_json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def pick(universe, priority, limit, force, now, ovr=None):
    """管理员编辑过、还没核对合并的最先做；再做报告里的股票 (priority 顺序)，再做其余；没有文件 / 超过 REFRESH_DAYS 天的才做"""
    cut = (now - timedelta(days=REFRESH_DAYS)).strftime("%Y-%m-%d")
    order = {c: i for i, c in enumerate(priority)}
    first, todo = [], []
    for code, name in sorted(universe.items(), key=lambda kv: (order.get(kv[0], 1e9), kv[0])):
        rec = read_json(os.path.join(INTEL_DIR, f"{code}.json"), None)
        stamp = owner_stamp((ovr or {}).get(code))
        if (stamp and (not rec or (rec.get("owner") or {}).get("stamp") != stamp)) or (not stamp and rec and rec.get("owner")):  # 新编辑 / 恢复成自动版本
            first.append((code, name))
        elif force or not rec or rec.get("updated", "")[:10] < cut:
            todo.append((code, name))
    return (first + todo)[:max(limit, len(first))]


def write_index(now):
    since = (now - timedelta(days=INDEX_TAG_DAYS)).strftime("%Y-%m-%d")
    items = {}
    for fn in sorted(os.listdir(INTEL_DIR)):
        if not fn.endswith(".json") or fn in ("index.json", "calendar.json"):
            continue
        rec = read_json(os.path.join(INTEL_DIR, fn), None)
        if not rec:
            continue
        items[rec["code"]] = {"u": rec["updated"][:10], "c": len(rec.get("notable") or []), "r": len(rec.get("risks") or []),
                              "t": {a["id"]: a["tag"] for a in rec.get("ann") or [] if a["date"] >= since and a["tag"] != "routine"}}
    write_calendar(now)
    with open(INDEX_PATH, "w", encoding="utf-8") as f:
        json.dump({"v": 1, "updated": now.strftime("%Y-%m-%d %H:%M"), "items": items}, f, ensure_ascii=False, separators=(",", ":"))
    return len(items)


def write_calendar(now):
    """全部公司的企业活动日期汇总成 docs/intel/calendar.json (终端版「日历」页用)"""
    lo, hi = (now - timedelta(days=CAL_BACK)).strftime("%Y-%m-%d"), (now + timedelta(days=CAL_AHEAD)).strftime("%Y-%m-%d")
    out = []
    for fn in sorted(os.listdir(INTEL_DIR)):
        if not fn.endswith(".json") or fn in ("index.json", "calendar.json"):
            continue
        rec = read_json(os.path.join(INTEL_DIR, fn), None) or {}
        for e in rec.get("events") or []:
            if lo <= e.get("date", "") <= hi:
                out.append(dict(e, code=rec.get("code"), name=rec.get("name")))
    out.sort(key=lambda e: (e["date"], e["code"] or ""))
    with open(CAL_PATH, "w", encoding="utf-8") as f:
        json.dump({"v": 1, "updated": now.strftime("%Y-%m-%d %H:%M"), "events": out}, f, ensure_ascii=False, separators=(",", ":"))
    return len(out)


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
    ovr = {k: v for k, v in (read_json(OVR_PATH, {}).get("codes") or {}).items() if owner_stamp(v)}  # 管理员编辑过资讯 / 日历的公司
    if a.codes:
        want = [c.strip() for c in a.codes.split(",") if c.strip()]
        universe = {c: universe.get(c, c) for c in want}
    term = read_json(os.path.join("docs", "terminal", "data.json"), {})
    priority = [s[0] for s in sorted(term.get("stocks") or [], key=lambda s: -(s[5] or 0))]  # 报告里的股票按成交额
    todo = pick(universe, priority, a.limit, a.force or bool(a.codes), now, ovr)
    print(f"🧠 公司情报：名单 {len(universe)} 家，这次处理 {len(todo)} 家")
    with ThreadPoolExecutor(FETCH_WORKERS) as pool:
        collected = list(pool.map(lambda cn: collect(cn[0], cn[1], now), todo))
    done = same = failed = merged = 0
    for (code, name), c in zip(todo, collected):
        if c is None:
            failed += 1
            continue
        path = os.path.join(INTEL_DIR, f"{code}.json")
        h, old = input_hash(c, ovr.get(code)), read_json(path, None)
        if old and old.get("hash") == h and not a.force:
            old["updated"] = now.strftime("%Y-%m-%d %H:%M")  # 资料没变：不再问 DeepSeek，只更新检查时间
            due = results_due(old.get("facts"), now)
            old["events"] = [e for e in old.get("events") or [] if e.get("type") != "results_due"] + ([due] if due else [])
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
            if code in ovr:  # 管理员编辑过：AI 新版本 + 管理员版本 对照资料核对合并
                rec = merge_owner(c, rec, ovr[code], now)
                merged += 1
            done += 1
            time.sleep(0.5)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(rec, f, ensure_ascii=False, separators=(",", ":"))
    n = write_index(now)
    print(f"🧠 完成：DeepSeek 分析 {done} 家 (其中跟管理员版本核对合并 {merged} 家)，资料没变沿用 {same} 家，抓取失败 {failed} 家；index 共 {n} 家")


if __name__ == "__main__":
    main()
