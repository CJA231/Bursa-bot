// Bursa Bot · AI 问答 + owner 编辑中转 (Cloudflare Worker)
//
// 1) POST /            终端版「✦ AI」问答：加上固定的系统提示、带 DeepSeek 密钥转发，回答一段一段 (stream) 传回去。
// 2) POST /edit/ai     owner 编辑：按你的指令用 DeepSeek 改写一个模块 (AI 资讯 / 公司简介 / 日历事件 / IPO)，回传建议版本，不保存。
// 3) POST /edit/save   owner 编辑：检查格式和字眼后，把你的版本提交到 GitHub 仓库的 docs/terminal/overrides.json，
//                      GitHub Pages 约 1–2 分钟后更新，所有人都看得到。
//
// 密钥都只存在 Cloudflare 的 Secret 里，网页上看不到。需要设置 (Workers → Settings → Variables and Secrets)：
//   DEEPSEEK_KEY  (Secret) DeepSeek API 密钥 —— 建议另外开一个、设好用量上限
//   PASS          (Secret) 通行码，自己定 (终端 AI 设置里填同一个)；没有通行码的请求一律拒绝
//   ALLOW_ORIGIN  (Text)   https://cja231.github.io
//   以下只有要在网页上编辑内容才需要 (没设置 = 编辑功能关闭，问答照常)：
//   EDIT_PASS     (Secret) 编辑通行码，跟 PASS 不同 —— 问答通行码可以给朋友，编辑通行码只有你自己知道
//   GH_TOKEN      (Secret) GitHub fine-grained token：只选这个仓库，权限只开 Contents = Read and write
//   GH_REPO       (Text)   CJA231/Bursa-bot
//   GH_BRANCH     (Text)   main (GitHub Pages 发布的那个分支；不写就是 main)
const SYSTEM = `你是 Bursa Bot 终端版里的 AI 助手，帮用户看懂马来西亚股票的公开资料。
用户的问题后面会附上「当前页面资料」(价格、技术指标、财报数字、公告、新闻、AI 整理的近况)，回答要以这些资料为根据，资料里没有的就说没有，不要编造数字或事件。
用简体中文回答，条理清楚、简短；需要时分点。可以解释指标是什么意思、财报数字的变化、公告在说什么、有哪些需要留意的事项。
绝对不要给买入、卖出、持有、加仓、止损、目标价或任何操作建议，也不要预测股价涨跌；用户问「该不该买」时，说明你不能给建议，改为整理相关事实和需要留意的地方。
最后不用加免责声明 (页面上已经有)。`;
const MAX_MSG = 12, MAX_CHARS = 16000;
const OV_PATH = 'docs/terminal/overrides.json';

function cors(env, req) {
  const origin = req.headers.get('Origin') || '';
  const ok = !env.ALLOW_ORIGIN || origin === env.ALLOW_ORIGIN;
  return { ok, h: { 'Access-Control-Allow-Origin': ok ? origin || '*' : 'null', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Pass, X-Edit-Pass', 'Access-Control-Max-Age': '86400', 'Vary': 'Origin' } };
}
const json = (c, obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...c.h, 'Content-Type': 'application/json; charset=utf-8' } });

export default {
  async fetch(req, env) {
    const c = cors(env, req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: c.h });
    if (req.method !== 'POST') return new Response('POST only', { status: 405, headers: c.h });
    if (!c.ok) return new Response('origin not allowed', { status: 403, headers: c.h });
    if (!env.PASS || req.headers.get('X-Pass') !== env.PASS) return new Response('wrong pass', { status: 401, headers: c.h });
    let body;
    try { body = await req.json(); } catch (e) { return new Response('bad json', { status: 400, headers: c.h }); }
    const path = new URL(req.url).pathname.replace(/\/+$/, '');
    if (path === '/edit/ai' || path === '/edit/save') {
      if (!env.EDIT_PASS || req.headers.get('X-Edit-Pass') !== env.EDIT_PASS) return json(c, { error: 'wrong edit pass' }, 401);
      try {
        return path === '/edit/ai' ? json(c, await editAi(env, body)) : json(c, await editSave(env, body));
      } catch (e) {
        return json(c, { error: String(e && e.message || e) }, e && e.status || 500);
      }
    }
    return chat(env, c, body);
  },
};

async function chat(env, c, body) {
  const msgs = (Array.isArray(body.messages) ? body.messages : []).filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string').slice(-MAX_MSG);
  if (!msgs.length) return new Response('no messages', { status: 400, headers: c.h });
  let total = 0;
  for (const m of msgs) { m.content = m.content.slice(0, MAX_CHARS); total += m.content.length; }
  if (total > MAX_CHARS * 2) return new Response('too long', { status: 413, headers: c.h });
  const r = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.DEEPSEEK_KEY },
    body: JSON.stringify({ model: 'deepseek-chat', temperature: 0.3, max_tokens: 1200, stream: true, messages: [{ role: 'system', content: SYSTEM + (body.lang === 'en' ? '\nThe user is reading the English version: answer in English (keep the same rules).' : '') }, ...msgs] }),
  });
  return new Response(r.body, { status: r.status, headers: { ...c.h, 'Content-Type': r.headers.get('Content-Type') || 'text/event-stream', 'Cache-Control': 'no-cache' } });
}

// ---------- 字眼检查 (跟 Python 那边 main.TRADE_ADVICE_RE / company_intel.JUDGE_RE 同一套) ----------
// hard = 好坏评价 / 明显的操作建议，一律不能用；soft = 有时是在陈述事实 (例如「大股东卖出 500 万股」「董事会建议派息」)，要你确认才保存
const HARD = [/利好|利空|看好|看淡|看涨|看跌|正面消息|负面消息|目标价|止损|止盈|加仓|减仓|建仓|清仓|逢低|逢高|抄底|入场|进场|离场|出场|观望|介入/g,
  /\b(bullish|bearish|stop[- ]?loss|take[- ]?profit|target price|upside|positive news|negative news|accumulate)\b/gi];
const SOFT = [/买入|买进|卖出|抛售|持有|建议/g, /\b(buy|sell|hold)\b/gi];
function words(obj, res) {
  const out = new Set();
  const walk = v => { if (typeof v === 'string') res.forEach(re => (v.match(re) || []).forEach(w => out.add(w))); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => { if (k !== 'refs' && k !== 'src' && k !== 'link' && k !== 'website') walk(x); }); };
  walk(obj);
  return [...out];
}

// ---------- 各模块的格式 (只收这些栏位、限制长度；其余一律丢掉) ----------
const TYPES = ['agm', 'egm', 'ex_date', 'entitlement', 'payment', 'results', 'listing', 'corporate'];
const str = (v, n) => typeof v === 'string' ? v.replace(/\s+$/g, '').slice(0, n) : '';
const list = (v, n, len) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split('\n') : []).map(x => str(String(x).trim(), len)).filter(Boolean).slice(0, n);
const url = v => typeof v === 'string' && /^https?:\/\/[^\s"'<>]{3,300}$/i.test(v.trim()) ? v.trim() : '';
const date = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
function bad(msg) { const e = new Error(msg); e.status = 400; return e; }
const SHAPE = {
  intel(d) {
    return { recent: str(d.recent, 600), recent_en: str(d.recent_en, 800), notable: list(d.notable, 5, 300), notable_en: list(d.notable_en, 5, 400),
      risks: list(d.risks, 5, 300), risks_en: list(d.risks_en, 5, 400), earnings: str(d.earnings, 400), earnings_en: str(d.earnings_en, 500), refs: str(d.refs, 6000) };
  },
  profile(d) {
    return { zh: str(d.zh, 1200), lines: list(d.lines, 8, 200), lines_en: list(d.lines_en, 8, 260), website: url(d.website) };
  },
  event(d) {  // 一条：op = add (新增) / fix (更正 AI 那条) / del (删掉 AI 那条)
    const op = ['add', 'fix', 'del'].includes(d.op) ? d.op : 'add';
    const e = { id: str(d.id, 24) || Math.random().toString(36).slice(2, 10), op, date: date(d.date), type: TYPES.includes(d.type) ? d.type : 'corporate',
      what: str(d.what, 60), what_en: str(d.what_en, 90), link: url(d.link) };
    if (op !== 'add') {
      const r = d.ref || {};
      e.ref = { date: date(r.date), type: TYPES.includes(r.type) ? r.type : str(r.type, 20), what: str(r.what, 60) };
      if (!e.ref.date) throw bad('ref.date missing');
    }
    if (op !== 'del' && !e.date) throw bad('date missing');
    return e;
  },
  events(d) { return { items: (Array.isArray(d.items) ? d.items : []).slice(0, 40).map(x => SHAPE.event(x || {})) }; },
  ipo(d) {
    const n = typeof d.oversub === 'number' ? d.oversub : parseFloat(d.oversub);
    return { oversub: isFinite(n) && n > 0 && n < 5000 ? Math.round(n * 100) / 100 : null, src: url(d.src), listing: date(d.listing), note: str(d.note, 160) };
  },
};

// ---------- /edit/ai：按指令改写 (不保存) ----------
const EDIT_SYS = `你是 Bursa Bot 网站管理员 (owner) 的编辑助手。管理员会给你某个模块现在的内容 (JSON)、他的修改指令、可能还有他贴上的参考资料 (公告原文、新闻) 和页面上已有的资料。
按指令修改，输出跟输入同样字段的 JSON (没要改的字段原样保留)。规则：
- 只能用给你的资料和管理员的参考资料里的事实和数字，不要编造；指令要求加入资料里没有的数字时，保留原文并在 note 字段说明缺什么资料。
- 只陈述事实，不要用「利好」「利空」「看好」「正面」「负面」这类评价字眼，不要给买入、卖出、持有、目标价、止损之类的建议，不要预测股价。
- 中文字段用简体中文；*_en 字段用简洁的商业英文，意思跟中文一致 (管理员只改了中文时，英文也跟着改)。
- 列表字段输出成字符串数组，每条一句。
- 额外输出 note：一句中文，说明你改了什么 (或为什么没改)。只输出 JSON。`;
const KIND_HINT = {
  intel: '模块: AI 公司资讯。字段 recent (近况 2~3 句)、notable[] (重要事件)、risks[] (留意事项)、earnings (财报 1~2 句)，以及 *_en。refs 是管理员的参考资料，不要改。',
  profile: '模块: 公司中文简介。字段 zh (一段介绍)、lines[] (业务线，每条一句)、lines_en[]、website (官网网址)。',
  event: '模块: 企业活动日历的一条。字段 date (YYYY-MM-DD)、type (只能是 agm / egm / ex_date / entitlement / payment / results / listing / corporate)、what (20 字以内中文)、what_en、link。日期只能用资料里写明的。',
  ipo: '模块: 新股 IPO。字段 oversub (超额认购倍数，数字；资料里找不到就 null)、src (来源网址)、listing (上市日 YYYY-MM-DD)、note。',
};
async function editAi(env, b) {
  const kind = b.kind;
  if (!SHAPE[kind] || kind === 'events') throw bad('unknown kind');
  const cur = SHAPE[kind](b.current || {});
  const instr = str(b.instruction, 600), refs = str(b.refs, 8000), ctx = typeof b.context === 'string' ? b.context.slice(0, 12000) : JSON.stringify(b.context || {}).slice(0, 12000);
  if (!instr) throw bad('instruction missing');
  const user = [`公司: ${str(b.name, 80)} (${str(b.code, 10)})`, KIND_HINT[kind], '现在的内容 (JSON):', JSON.stringify(cur), '管理员的指令:', instr,
    refs ? '管理员的参考资料:\n' + refs : '管理员没有贴参考资料。', '页面上已有的资料:', ctx].join('\n');
  const r = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.DEEPSEEK_KEY },
    body: JSON.stringify({ model: 'deepseek-chat', temperature: 0.2, max_tokens: 1800, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: EDIT_SYS }, { role: 'user', content: user }] }),
  });
  if (!r.ok) { const e = new Error('DeepSeek HTTP ' + r.status); e.status = 502; throw e; }
  const j = await r.json();
  let out = {};
  try { out = JSON.parse((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '{}'); } catch (e) { out = {}; }
  const proposal = SHAPE[kind](Object.assign({}, cur, out, kind === 'intel' ? { refs: cur.refs } : {}));
  if (kind === 'event') { proposal.op = cur.op; proposal.id = cur.id; if (cur.ref) proposal.ref = cur.ref; }
  return { proposal, note: str(out.note, 300), hard: words(proposal, HARD), soft: words(proposal, SOFT) };
}

// ---------- /edit/save：提交到 GitHub ----------
// body: { code, name, kind: 'intel' | 'profile' | 'events' | 'ipo', data (null = 删掉这一块，恢复成自动版本), confirm_soft: true/false }
async function editSave(env, b) {
  if (!env.GH_TOKEN || !env.GH_REPO) { const e = new Error('GH_TOKEN / GH_REPO not set'); e.status = 501; throw e; }
  const code = str(b.code, 10).toUpperCase();
  if (!/^[0-9A-Z]{4,6}$/.test(code)) throw bad('bad code');
  if (!['intel', 'profile', 'events', 'ipo'].includes(b.kind)) throw bad('unknown kind');
  const data = b.data == null ? null : SHAPE[b.kind](b.data);
  if (data) {
    const hard = words(data, HARD), soft = words(data, SOFT);
    if (hard.length) return { ok: false, hard, soft };
    if (soft.length && !b.confirm_soft) return { ok: false, hard: [], soft };
  }
  const at = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');  // 马来西亚时间
  for (let attempt = 0; attempt < 3; attempt++) {
    const cur = await ghGet(env, OV_PATH);
    const ov = cur.json || { v: 1, codes: {} };
    ov.codes = ov.codes || {};
    const rec = ov.codes[code] || {};
    if (data) rec[b.kind] = Object.assign(data, { at });
    else delete rec[b.kind];
    if (b.name) rec.name = str(b.name, 80);
    if (Object.keys(rec).some(k => k !== 'name')) ov.codes[code] = rec; else delete ov.codes[code];
    ov.v = 1; ov.updated = at;
    const msg = `Owner edit: ${code} ${b.kind}${data ? '' : ' (restore auto)'}`;
    const res = await ghPut(env, OV_PATH, JSON.stringify(ov, null, 1) + '\n', cur.sha, msg);
    if (res.ok) return { ok: true, at, commit: res.commit };
    if (res.status !== 409 && res.status !== 422) { const e = new Error('GitHub HTTP ' + res.status + ' ' + res.text); e.status = 502; throw e; }
    // 409 / 422 = 别的提交刚好改了这个文件 (sha 不对)，重新读一次再试
  }
  const e = new Error('GitHub conflict, try again'); e.status = 409; throw e;
}

const GH = 'https://api.github.com';
function ghHeaders(env) {
  return { Authorization: 'Bearer ' + env.GH_TOKEN, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'bursa-bot-worker' };
}
async function ghGet(env, path) {
  const r = await fetch(`${GH}/repos/${env.GH_REPO}/contents/${path}?ref=${encodeURIComponent(env.GH_BRANCH || 'main')}`, { headers: ghHeaders(env) });
  if (r.status === 404) return { sha: null, json: null };
  if (!r.ok) { const e = new Error('GitHub HTTP ' + r.status); e.status = 502; throw e; }
  const j = await r.json();
  const bin = atob((j.content || '').replace(/\n/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  let parsed = null;
  try { parsed = JSON.parse(new TextDecoder().decode(bytes)); } catch (e) { parsed = null; }
  return { sha: j.sha, json: parsed };
}
function b64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
async function ghPut(env, path, text, sha, message) {
  const body = { message, content: b64(text), branch: env.GH_BRANCH || 'main' };
  if (sha) body.sha = sha;
  const r = await fetch(`${GH}/repos/${env.GH_REPO}/contents/${path}`, { method: 'PUT', headers: { ...ghHeaders(env), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (r.ok) { const j = await r.json(); return { ok: true, commit: j.commit && j.commit.sha }; }
  return { ok: false, status: r.status, text: (await r.text()).slice(0, 200) };
}

