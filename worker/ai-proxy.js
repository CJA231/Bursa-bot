// Bursa Bot · AI 问答 + owner 编辑中转 (Cloudflare Worker)
//
// 1) POST /            终端版「✦ AI」问答：加上固定的系统提示、带 DeepSeek 密钥转发，回答一段一段 (stream) 传回去。
// 2) POST /edit/ai     owner 编辑：按你的指令用 DeepSeek 改写一个模块 (AI 资讯 / 公司简介 / 日历事件 / IPO)，回传建议版本，不保存。
// 3) POST /edit/save   owner 编辑：检查格式和字眼后，把你的版本提交到 GitHub 仓库的 docs/terminal/overrides.json，
//                      GitHub Pages 约 1–2 分钟后更新，所有人都看得到。
// 4) POST /theme       🎨 自定义界面：用一句话描述想要的样子，DeepSeek 设计一套配色 / 字号 / 圆角 (JSON)，网页上预览、存在用户自己的设备。
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
// 5) POST /auth/login  👤 用 Google 账号登录 (任何人都可以，不用通行码)；POST /sync/pull、/sync/push、/sync/delete 跨设备同步观察列表和界面设定。
//   以下只有要开登录 / 同步才需要 (没设置 = 登录功能关闭，其他照常)：
//   GOOGLE_CLIENT_ID (Text)  Google Cloud 的 OAuth 用户端 ID (xxx.apps.googleusercontent.com)
//   SESSION_SECRET   (Secret) 随便一串 32 个字以上的乱码 (签登录凭证用；换掉 = 所有人要重新登录)
//   KV 绑定 SYNC              Workers → Settings → Bindings → KV namespace，变量名称 SYNC
//   PLUS_EMAILS      (Text)   付费 (Plus) 用户的电邮，逗号分隔；也可以在 KV 加一笔 plus:<电邮> = 到期日 YYYY-MM-DD (或 forever)
//   FREE_MAX_FOLDERS / FREE_MAX_STOCKS / PLUS_MAX_FOLDERS / PLUS_MAX_STOCKS (Text，可不设) 同步上限，默认 1 / 30 / 5 / 2000
//   OWNER_EMAILS     (Text)   网站管理员的电邮：自己是 Plus，账号面板里可以手动开通 / 取消别人的 Plus
//   STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET (Secret)、STRIPE_PRICE_MONTH / STRIPE_PRICE_YEAR (Text)：Stripe 自动收款 (可不设)
// 6) POST /admin/plus/list|set|remove (管理员)、/pay/checkout|portal (登录的用户)、/pay/webhook (Stripe 呼叫，签名验证)
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
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Pass, X-Edit-Pass', 'Access-Control-Max-Age': '86400', 'Vary': 'Origin' } };
}
const json = (c, obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...c.h, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

export default {
  async fetch(req, env) {
    const c = cors(env, req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: c.h });
    if (req.method !== 'POST') return new Response('POST only', { status: 405, headers: c.h });
    const path = new URL(req.url).pathname.replace(/\/+$/, '');
    // 💳 Stripe 付款通知：Stripe 的服务器直接呼叫 (没有 Origin)，靠签名验证，不走下面的网址 / 通行码检查
    if (path === '/pay/webhook') return stripeWebhook(env, req);
    if (!c.ok) return new Response('origin not allowed', { status: 403, headers: c.h });
    // 👤 登录 / 跨设备同步：用 Google 账号登录，不用通行码 (任何人都可以登录)
    if (path.startsWith('/auth/') || path.startsWith('/sync/') || path.startsWith('/admin/') || path.startsWith('/pay/')) {
      let b = {};
      try { b = await req.json(); } catch (e) { b = {}; }
      try { return json(c, await account(env, req, path, b || {})); } catch (e) { return json(c, { error: String(e && e.message || e), ...(e && e.extra || {}) }, e && e.status || 500); }
    }
    if (!env.PASS || req.headers.get('X-Pass') !== env.PASS) return new Response('wrong pass', { status: 401, headers: c.h });
    let body;
    try { body = await req.json(); } catch (e) { return new Response('bad json', { status: 400, headers: c.h }); }
    if (path === '/edit/ai' || path === '/edit/save') {
      if (!env.EDIT_PASS || req.headers.get('X-Edit-Pass') !== env.EDIT_PASS) return json(c, { error: 'wrong edit pass' }, 401);
      try {
        return path === '/edit/ai' ? json(c, await editAi(env, body)) : json(c, await editSave(env, body));
      } catch (e) {
        return json(c, { error: String(e && e.message || e) }, e && e.status || 500);
      }
    }
    if (path === '/theme') {
      try { return json(c, await theme(env, body)); } catch (e) { return json(c, { error: String(e && e.message || e) }, e && e.status || 500); }
    }
    return chat(env, c, body);
  },
};

// ---------- 👤 Google 登录 + 跨设备同步 (Cloudflare KV) ----------
// 网页的「用 Google 登录」按钮拿到 Google 的 ID token (JWT) → /auth/login 在这里验证 Google 的签名、发给谁 (aud)、有效期、电邮已验证
// → 发一个 30 天的登录凭证 (HMAC 签名，服务器不用存)。之后 /sync/* 都带着这个凭证 (Authorization: Bearer …)。
// 同步的资料存在 KV (绑定名称 SYNC)：一个账号一笔 d:<Google 账号 ID>，只有观察列表和界面设定；AI 密钥 / 通行码永远不会上传。
// 免费 / Plus：PLUS_EMAILS (逗号分隔) 里的电邮，或 KV 里有 plus:<电邮> (值 = 到期日 YYYY-MM-DD，或 forever) → Plus；其余是免费版。
// 免费版只同步 FREE_MAX_FOLDERS 个列表、共 FREE_MAX_STOCKS 只股票 (默认 1 / 30)，Plus 默认 5 个列表；多出来的只留在那台设备。
const GOOGLE_CERTS = 'https://www.googleapis.com/oauth2/v3/certs';
const SESSION_DAYS = 30, DOC_MAX = 96 * 1024, CODE_RE = /^[0-9A-Z]{3,8}$/;
const PREFS = { theme: ['dark', 'light'], lang: ['zh', 'en'], candle: ['hollow', 'solid'], btmode: ['ledger', 'custom'] };
const THEME_KEYS = ['name', 'scheme', 'bg', 'bg2', 'fg', 'mut', 'line', 'acc', 'acc2', 'up', 'dn', 'warn', 'sel', 'font', 'radius', 'glass', 'note'];
const enc = new TextEncoder(), dec = new TextDecoder();
let JWKS = { at: 0, ttl: 0, keys: {} };

function fail(status, msg, extra) { const e = new Error(msg); e.status = status; if (extra) e.extra = extra; return e; }
function b64uEnc(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64uDec(s) {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const myNow = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');  // 马来西亚时间

async function googleKey(kid) {
  const now = Date.now();
  // 缓存 Google 的公钥 (按 Cache-Control，最多 6 小时)；遇到没见过的 kid (Google 换钥匙) 最多每分钟重新读一次
  if (now - JWKS.at > JWKS.ttl || (!JWKS.keys[kid] && now - JWKS.at > 60e3)) {
    const r = await fetch(GOOGLE_CERTS);
    if (!r.ok) throw fail(502, 'google certs HTTP ' + r.status);
    const m = /max-age=(\d+)/.exec(r.headers.get('Cache-Control') || '');
    const keys = {};
    for (const k of ((await r.json()) || {}).keys || []) if (k && k.kid && k.kty === 'RSA') keys[k.kid] = k;
    JWKS = { at: now, ttl: Math.min(m ? +m[1] * 1000 : 3600e3, 6 * 3600e3), keys };
  }
  const jwk = JWKS.keys[kid];
  if (!jwk) throw fail(401, 'unknown google key');
  return crypto.subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
}

async function verifyGoogle(env, idt) {
  if (!env.GOOGLE_CLIENT_ID) throw fail(501, 'GOOGLE_CLIENT_ID not set');
  const parts = typeof idt === 'string' && idt.length < 4096 ? idt.split('.') : [];
  if (parts.length !== 3) throw fail(400, 'bad token');
  let head, pay;
  try { head = JSON.parse(dec.decode(b64uDec(parts[0]))); pay = JSON.parse(dec.decode(b64uDec(parts[1]))); } catch (e) { throw fail(400, 'bad token'); }
  if (!head || head.alg !== 'RS256' || !head.kid || !pay) throw fail(401, 'bad token');
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', await googleKey(String(head.kid)), b64uDec(parts[2]), enc.encode(parts[0] + '.' + parts[1]));
  if (!ok) throw fail(401, 'bad signature');
  const now = Math.floor(Date.now() / 1000);
  if (pay.iss !== 'accounts.google.com' && pay.iss !== 'https://accounts.google.com') throw fail(401, 'bad issuer');
  if (!String(env.GOOGLE_CLIENT_ID).split(',').map(s => s.trim()).filter(Boolean).includes(pay.aud)) throw fail(401, 'bad audience');
  if (!(pay.exp > now - 60)) throw fail(401, 'token expired');
  if (pay.iat > now + 300) throw fail(401, 'bad token time');
  if (!pay.sub || typeof pay.email !== 'string' || !(pay.email_verified === true || pay.email_verified === 'true')) throw fail(401, 'email not verified');
  return { sub: String(pay.sub), email: pay.email.toLowerCase(), name: str(pay.name, 80), picture: url(pay.picture) };
}

async function hmacKey(env) {
  if (!env.SESSION_SECRET || String(env.SESSION_SECRET).length < 16) throw fail(501, 'SESSION_SECRET not set (at least 16 characters)');
  return crypto.subtle.importKey('raw', enc.encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function sessionIssue(env, u) {
  const body = b64uEnc(enc.encode(JSON.stringify({ s: u.sub, e: u.email, x: Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400 })));
  return body + '.' + b64uEnc(await crypto.subtle.sign('HMAC', await hmacKey(env), enc.encode(body)));
}
async function sessionCheck(env, req) {
  const m = /^Bearer ([\w-]{10,600})\.([\w-]{20,100})$/.exec(req.headers.get('Authorization') || '');
  if (!m) throw fail(401, 'login required');
  if (!(await crypto.subtle.verify('HMAC', await hmacKey(env), b64uDec(m[2]), enc.encode(m[1])))) throw fail(401, 'login expired');
  let p = null;
  try { p = JSON.parse(dec.decode(b64uDec(m[1]))); } catch (e) { p = null; }
  if (!p || !p.s || !(p.x > Date.now() / 1000)) throw fail(401, 'login expired');
  return { sub: String(p.s), email: String(p.e || '') };
}

const emailList = v => String(v || '').toLowerCase().split(/[\s,;]+/).filter(Boolean);
const isOwner = (env, email) => !!email && emailList(env.OWNER_EMAILS).includes(email);
async function planOf(env, email) {
  if (isOwner(env, email) || emailList(env.PLUS_EMAILS).includes(email)) return { plan: 'plus', until: null };
  const r = env.SYNC && email ? await env.SYNC.getWithMetadata('plus:' + email) : null;  // Cloudflare 后台 KV 加一笔就升级，不用重新部署
  const s = String((r && r.value) || '').trim(), stripe = !!(r && r.metadata && r.metadata.cus);  // stripe = 有 Stripe 订阅 (可以「管理订阅」)
  if (/^(forever|true|1)$/i.test(s)) return { plan: 'plus', until: null, stripe };
  if (/^\d{4}-\d{2}-\d{2}$/.test(s) && s >= myNow().slice(0, 10)) return { plan: 'plus', until: s, stripe };
  return { plan: 'free', until: null };
}
function limitsOf(env, plan) {
  const n = (v, d) => { const x = parseInt(v, 10); return x > 0 ? x : d; };
  return plan === 'plus' ? { folders: n(env.PLUS_MAX_FOLDERS, 5), stocks: n(env.PLUS_MAX_STOCKS, 2000) }
    : { folders: n(env.FREE_MAX_FOLDERS, 1), stocks: n(env.FREE_MAX_STOCKS, 30) };
}

// 只收这些栏位；超过免费 / Plus 上限的列表、股票不存 (那些只留在原来的设备)
// tpl (回测策略模板) 只有网站管理员 (OWNER_EMAILS) 的账号会存，别人送来的直接丢掉
function cleanTpl(a) {
  const out = [], ids = new Set();
  for (const t of Array.isArray(a) ? a : []) {
    if (!t || typeof t !== 'object' || !Array.isArray(t.conds) || out.length >= 80) continue;
    const id = str(t.id, 24); if (!id || ids.has(id)) continue;
    const o = { id, name: str(t.name, 60) || id, conds: t.conds.slice(0, 15) };
    if (Array.isArray(t.exits)) o.exits = t.exits.slice(0, 12);
    ['take', 'stop', 'hold', 'emab', 'combo'].forEach(k => { if (typeof t[k] === 'number' && isFinite(t[k])) o[k] = t[k]; });
    if (JSON.stringify(o).length > 4000) continue;
    ids.add(id); out.push(o);
  }
  return out;
}
function cleanDoc(d, lim, owner) {
  d = d && typeof d === 'object' && !Array.isArray(d) ? d : {};
  const out = { v: 1, watch: null, prefs: {}, theme: null, cbt: null };
  let trimmed = false;
  const w = d.watch && typeof d.watch === 'object' ? d.watch : null;
  if (w) {
    const folders = [], ids = new Set();
    let total = 0;
    for (const f of Array.isArray(w.folders) ? w.folders : []) {
      const id = f && typeof f === 'object' ? str(f.id, 24) : '';
      if (!id || ids.has(id)) continue;
      if (folders.length >= lim.folders) { trimmed = true; break; }
      const codes = [];
      for (const c of Array.isArray(f.codes) ? f.codes : []) {
        const k = String(c).toUpperCase();
        if (!CODE_RE.test(k) || codes.includes(k)) continue;
        if (total >= lim.stocks) { trimmed = true; break; }
        codes.push(k); total++;
      }
      ids.add(id); folders.push({ id, name: str(f.name, 40), codes });
    }
    if (folders.length) out.watch = { folders, cur: ids.has(w.cur) ? w.cur : folders[0].id };
  }
  const p = d.prefs && typeof d.prefs === 'object' ? d.prefs : {};
  for (const k in PREFS) if (PREFS[k].includes(p[k])) out.prefs[k] = p[k];
  const t = d.theme && typeof d.theme === 'object' && d.theme.t && typeof d.theme.t === 'object' ? d.theme : null;
  if (t) {
    const tt = {};
    THEME_KEYS.forEach(k => { const v = t.t[k]; if (typeof v === 'number' && isFinite(v)) tt[k] = v; else if (typeof v === 'string') tt[k] = v.slice(0, 200); });
    out.theme = { on: t.on !== false, t: tt };
  }
  if (d.cbt && typeof d.cbt === 'object' && !Array.isArray(d.cbt) && JSON.stringify(d.cbt).length <= 6000) out.cbt = d.cbt;
  // 股票池：条件 + 储存的筛选结果 (日期、条件、股票和当天价格)，网页那边最多 30 笔、约 30KB
  if (d.pool && typeof d.pool === 'object' && !Array.isArray(d.pool) && JSON.stringify(d.pool).length <= 40000) out.pool = d.pool;
  if (owner && Array.isArray(d.tpl)) out.tpl = cleanTpl(d.tpl);
  if (JSON.stringify(out).length > DOC_MAX) throw fail(413, 'too large');
  return { doc: out, trimmed };
}

async function account(env, req, path, b) {
  if (path === '/auth/login') {
    const u = await verifyGoogle(env, b.credential);
    const pl = await planOf(env, u.email);
    return { token: await sessionIssue(env, u), email: u.email, name: u.name, picture: u.picture, days: SESSION_DAYS, ...pl, limits: limitsOf(env, pl.plan), ...extras(env, u.email) };
  }
  const u = await sessionCheck(env, req);
  if (!env.SYNC) throw fail(501, 'KV binding SYNC not set');
  if (path.startsWith('/admin/')) return admin(env, u, path, b);
  if (path.startsWith('/pay/')) return pay(env, u, path, b, req);
  const key = 'd:' + u.sub;
  if (path === '/sync/delete') { await env.SYNC.delete(key); return { ok: true }; }
  const pl = await planOf(env, u.email), lim = limitsOf(env, pl.plan);
  const cur = await env.SYNC.get(key, 'json');
  const rev = cur && cur.rev || 0, info = { email: u.email, ...pl, limits: lim, ...extras(env, u.email) };
  if (path === '/sync/pull') return { rev, data: cur ? cur.data : null, updated: cur ? cur.updated : null, ...info };
  if (path === '/sync/push') {
    // 别的设备先存了新版本 → 409 + 最新版本，网页合并后再送一次 (KV 不是即时一致，这只防常见的情况；网页那边是三方合并，不会丢资料)
    if (b.rev !== rev) throw fail(409, 'conflict', { rev, data: cur ? cur.data : null, updated: cur ? cur.updated : null, ...info });
    const r = cleanDoc(b.data, lim, isOwner(env, u.email));
    const rec = { rev: rev + 1, updated: myNow(), email: u.email, data: r.doc };
    await env.SYNC.put(key, JSON.stringify(rec), { metadata: { email: u.email, updated: rec.updated } });  // 后台的 key 列表看得到是谁
    return { rev: rec.rev, updated: rec.updated, data: rec.data, trimmed: r.trimmed, ...info };
  }
  throw fail(404, 'not found');
}

// ---------- 💎 Plus：网站管理员手动开通 + Stripe 自动收款 ----------
// OWNER_EMAILS (Text)：网站管理员的电邮 (自己永远是 Plus，账号面板会多一个「管理 Plus 用户」)
// Stripe (可不设，没设 = 只能手动开通)：STRIPE_SECRET_KEY (Secret)、STRIPE_WEBHOOK_SECRET (Secret)、STRIPE_PRICE_MONTH / STRIPE_PRICE_YEAR (Text，价格 ID price_…)
// KV：plus:<电邮> = 到期日 YYYY-MM-DD 或 forever (跟以前一样，Cloudflare 后台也可以直接改)；metadata 记来源、Stripe 客户编号，给管理面板和「管理订阅」用
const DAY = 864e5;
const isoDay = ms => new Date(ms + 8 * 3600e3).toISOString().slice(0, 10);  // 马来西亚日期
const laterOf = (a, b) => a === 'forever' || b === 'forever' ? 'forever' : (a || '') > (b || '') ? a : b;
const emailOk = e => typeof e === 'string' && e.length <= 120 && /^[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}$/i.test(e);
function payReady(env) { return !!(env.STRIPE_SECRET_KEY && (env.STRIPE_PRICE_MONTH || env.STRIPE_PRICE_YEAR)); }
function extras(env, email) {
  const o = { pay: payReady(env) ? { month: !!env.STRIPE_PRICE_MONTH, year: !!env.STRIPE_PRICE_YEAR } : null };
  if (isOwner(env, email)) o.owner = true;
  return o;
}
async function plusGet(env, email) {
  const r = await env.SYNC.getWithMetadata('plus:' + email);
  return r && r.value != null ? { until: String(r.value).trim(), meta: r.metadata || {} } : null;
}
async function plusPut(env, email, until, meta) {
  await env.SYNC.put('plus:' + email, until, { metadata: { ...meta, until, at: myNow() } });
}

async function admin(env, u, path, b) {
  if (!isOwner(env, u.email)) throw fail(403, 'owner only');
  if (path === '/admin/plus/list') {
    const out = [];
    let cursor;
    do {  // 后台直接加的 (没有 metadata) 才要另外读值
      const pg = await env.SYNC.list({ prefix: 'plus:', cursor });
      for (const k of pg.keys) {
        const m = k.metadata || {};
        out.push({ email: k.name.slice(5), until: m.until || String(await env.SYNC.get(k.name) || '').trim(), src: m.src || 'manual', at: m.at || '', note: m.note || '' });
      }
      cursor = pg.list_complete ? null : pg.cursor;
    } while (cursor && out.length < 2000);
    out.sort((x, y) => (y.at || '').localeCompare(x.at || '') || x.email.localeCompare(y.email));
    return { items: out, plusEmails: emailList(env.PLUS_EMAILS), owners: emailList(env.OWNER_EMAILS), today: myNow().slice(0, 10) };
  }
  const email = String(b.email || '').trim().toLowerCase();
  if (!emailOk(email)) throw fail(400, 'bad email');
  if (path === '/admin/plus/set') {
    const until = b.until === 'forever' ? 'forever' : /^\d{4}-\d{2}-\d{2}$/.test(b.until || '') ? b.until : '';
    if (!until) throw fail(400, 'bad date');
    const old = await plusGet(env, email);
    await plusPut(env, email, until, { ...(old ? old.meta : {}), src: 'manual', by: u.email, note: str(b.note, 80) || (old && old.meta.note) || '' });  // 没填备注就保留旧的
    return { ok: true, email, until };
  }
  if (path === '/admin/plus/remove') { await env.SYNC.delete('plus:' + email); return { ok: true, email }; }
  throw fail(404, 'not found');
}

// Stripe API (表单格式)
function form(obj, pre, out) {
  out = out || [];
  for (const [k, v] of Object.entries(obj)) {
    const key = pre ? `${pre}[${k}]` : k;
    if (v == null) continue;
    if (typeof v === 'object') form(v, key, out); else out.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(v)));
  }
  return out.join('&');
}
async function stripe(env, path, params) {
  const r = await fetch('https://api.stripe.com/v1/' + path, { method: 'POST', body: form(params),
    headers: { Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY, 'Content-Type': 'application/x-www-form-urlencoded' } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw fail(502, 'Stripe: ' + ((j.error && j.error.message) || 'HTTP ' + r.status));
  return j;
}
function backUrl(env, b) {  // 付款完 / 取消后回到哪里：只接受本网站的网址
  const u = typeof b.back === 'string' ? b.back : '';
  const site = env.ALLOW_ORIGIN || '';
  return site && u.startsWith(site + '/') && u.length < 400 ? u.replace(/[?#].*$/, '') : (site || 'https://example.com') + '/';
}
async function pay(env, u, path, b) {
  if (!payReady(env)) throw fail(501, 'payments not set up');
  const old = await plusGet(env, u.email), cus = old && old.meta.cus;
  if (path === '/pay/checkout') {
    const price = b.plan === 'year' ? env.STRIPE_PRICE_YEAR : b.plan === 'month' ? env.STRIPE_PRICE_MONTH : null;
    if (!price) throw fail(400, 'bad plan');
    const back = backUrl(env, b);
    const s = await stripe(env, 'checkout/sessions', {
      mode: 'subscription', line_items: { 0: { price, quantity: 1 } }, client_reference_id: u.sub,
      ...(cus ? { customer: cus } : { customer_email: u.email }),  // 用登录的 Gmail，付款后才对得上账号
      subscription_data: { metadata: { email: u.email, sub: u.sub } }, metadata: { email: u.email },
      allow_promotion_codes: 'true', success_url: back + '?plus=ok', cancel_url: back + '?plus=cancel' });
    return { url: s.url };
  }
  if (path === '/pay/portal') {  // 取消 / 换卡 / 看收据：Stripe 的客户中心
    if (!cus) throw fail(404, 'no Stripe subscription for this account');
    const s = await stripe(env, 'billing_portal/sessions', { customer: cus, return_url: backUrl(env, b) });
    return { url: s.url };
  }
  throw fail(404, 'not found');
}

// Stripe 付款通知 (webhook)：验证签名 → 每次付款成功 (invoice.paid) 把 Plus 延长到这一期结束 + 2 天
async function stripeWebhook(env, req) {
  const text = await req.text();
  const reply = (status, msg) => new Response(msg, { status, headers: { 'Content-Type': 'text/plain' } });
  if (!env.STRIPE_WEBHOOK_SECRET || !env.SYNC) return reply(501, 'not set up');
  const sig = req.headers.get('Stripe-Signature') || '';
  const t = (/(?:^|,)t=(\d+)/.exec(sig) || [])[1], v1s = [...sig.matchAll(/(?:^|,)v1=([0-9a-f]{64})/g)].map(m => m[1]);
  if (!t || !v1s.length || Math.abs(Date.now() / 1000 - +t) > 300) return reply(400, 'bad signature');
  const key = await crypto.subtle.importKey('raw', enc.encode(env.STRIPE_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  let ok = false;
  for (const v of v1s) {
    const bytes = new Uint8Array(v.match(/../g).map(h => parseInt(h, 16)));
    if (await crypto.subtle.verify('HMAC', key, bytes, enc.encode(t + '.' + text))) ok = true;
  }
  if (!ok) return reply(400, 'bad signature');
  let ev;
  try { ev = JSON.parse(text); } catch (e) { return reply(400, 'bad json'); }
  if (ev.type !== 'invoice.paid' && ev.type !== 'invoice.payment_succeeded') return reply(200, 'ignored');
  const inv = (ev.data && ev.data.object) || {};
  const sd = (inv.parent && inv.parent.subscription_details) || inv.subscription_details || {};
  const email = String((sd.metadata && sd.metadata.email) || inv.customer_email || '').trim().toLowerCase();
  const ends = ((inv.lines && inv.lines.data) || []).map(l => l.period && +l.period.end).filter(x => x > 0);
  if (!emailOk(email) || !ends.length) return reply(200, 'no email / period');
  const until = isoDay(Math.max(...ends) * 1000 + 2 * DAY);
  const old = await plusGet(env, email);
  await plusPut(env, email, laterOf(old && old.until, until), { ...(old ? old.meta : {}), src: 'stripe', cus: inv.customer || (old && old.meta.cus) || '',
    subId: sd.subscription || inv.subscription || '' });
  return reply(200, 'ok');
}

// ---------- /theme：🎨 用一句话设计界面主题 (网页那边会再检查颜色格式和对比度) ----------
const THEME_SYS = '你是网页界面配色设计师。根据用户的描述，为一个股票资讯终端 (等宽字体、很多数字和表格) 设计一套界面主题。只输出 JSON：' +
  '{"name": 2~6 个字的主题名, "scheme": "dark" 或 "light", "bg": 页面背景, "bg2": 卡片 / 输入框背景, "fg": 主要文字, "mut": 次要文字, "line": 线条和边框, "acc": 标题和强调色, "acc2": 第二强调色 (按钮、链接), ' +
  '"up": 上涨的颜色 (绿色系), "dn": 下跌的颜色 (红色系), "warn": 提醒 (黄 / 橙色系), "sel": 选中项目的背景, "font": 字号 12~17 的整数 (默认 13), "radius": 圆角 0~18 的整数 px (默认 0), "glass": 玻璃感 0~1 (默认 0.6，越小越透明), "note": 一句话说明这套设计}。' +
  '颜色一律用 #RRGGBB。fg 跟 bg 的对比度至少 7:1，mut 至少 4.5:1，up / dn / acc 在 bg 上都要看得清楚。只输出 JSON。';
async function theme(env, body) {
  const prompt = typeof body.prompt === 'string' ? body.prompt.slice(0, 1500) : '';
  if (!prompt.trim()) { const e = new Error('prompt missing'); e.status = 400; throw e; }
  const r = await dsFetch(env, { temperature: 0.7, max_tokens: 600, response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: THEME_SYS + (body.lang === 'en' ? ' Write name and note in English.' : '') }, { role: 'user', content: prompt }] });
  if (!r.ok) { const e = new Error('DeepSeek HTTP ' + r.status); e.status = 502; throw e; }
  const j = await r.json();
  let out = {};
  try { out = JSON.parse((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '{}'); } catch (e) { out = {}; }
  const pick = {};  // 只回传主题需要的栏位
  ['name', 'scheme', 'bg', 'bg2', 'fg', 'mut', 'line', 'acc', 'acc2', 'up', 'dn', 'warn', 'sel', 'font', 'radius', 'glass', 'note'].forEach(k => { if (out[k] != null) pick[k] = out[k]; });
  return { theme: pick };
}

// DeepSeek：模型名称失效时自动换新名称 (从错误信息读出 DeepSeek 现在支持的名称)；新名称默认开思考模式，一律关掉
const DS_URL = 'https://api.deepseek.com/chat/completions', DS_FB = ['deepseek-flash', 'deepseek-v4-flash'];
let DS_MODEL = 'deepseek-chat';  // 同一个 Worker 实例里，换过一次就一直用新的
async function dsFetch(env, payload) {
  const tried = [], todo = [DS_MODEL, ...DS_FB];
  for (;;) {
    const model = todo.find(x => !tried.includes(x));
    if (!model) { const e = new Error('DeepSeek: no usable model (tried ' + tried.join(', ') + ')'); e.status = 502; throw e; }
    const body = { ...payload, model };
    if (model !== 'deepseek-chat') body.thinking = { type: 'disabled' };
    const r = await fetch(DS_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.DEEPSEEK_KEY }, body: JSON.stringify(body) });
    if (r.status === 400 || r.status === 404) {
      const t = await r.clone().text();
      if (/model/i.test(t) && /support|not exist|invalid|deprecat|not found/i.test(t)) {
        tried.push(model);
        const m = /model names are\s+(.+?)(?:,?\s+but\b|\.|$)/i.exec(t);
        if (m) m[1].split(/,|\band\b/).map(x => x.replace(/['"\s]/g, '')).filter(x => /^[\w.-]+$/.test(x))
          .sort((a, b) => (/flash/.test(a) ? 0 : 1) - (/flash/.test(b) ? 0 : 1)).forEach(x => { if (!todo.includes(x)) todo.push(x); });
        continue;
      }
    }
    if (r.ok) DS_MODEL = model;
    return r;
  }
}

async function chat(env, c, body) {
  const msgs = (Array.isArray(body.messages) ? body.messages : []).filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string').slice(-MAX_MSG);
  if (!msgs.length) return new Response('no messages', { status: 400, headers: c.h });
  let total = 0;
  for (const m of msgs) { m.content = m.content.slice(0, MAX_CHARS); total += m.content.length; }
  if (total > MAX_CHARS * 2) return new Response('too long', { status: 413, headers: c.h });
  const r = await dsFetch(env, { temperature: 0.3, max_tokens: 1200, stream: true, messages: [{ role: 'system', content: SYSTEM + (body.lang === 'en' ? '\nThe user is reading the English version: answer in English (keep the same rules).' : '') }, ...msgs] });
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
  const r = await dsFetch(env, { temperature: 0.2, max_tokens: 1800, response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: EDIT_SYS }, { role: 'user', content: user }] });
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

