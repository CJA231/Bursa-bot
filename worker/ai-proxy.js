// Bursa Bot · AI 问答中转 (Cloudflare Worker)
// 终端版的「✦ AI」按钮把问题和当前页面的资料送到这里，这里加上固定的系统提示、带上 DeepSeek 密钥转发，再把回答一段一段 (stream) 传回去。
// 密钥只存在 Cloudflare 的 Secret 里，网页上看不到。需要设置 (Workers → Settings → Variables and Secrets)：
//   DEEPSEEK_KEY  (Secret) DeepSeek API 密钥 —— 建议另外开一个、设好用量上限
//   PASS          (Secret) 通行码，自己定 (终端 AI 设置里填同一个)；没有通行码的请求一律拒绝
//   ALLOW_ORIGIN  (Text)   https://cja231.github.io
const SYSTEM = `你是 Bursa Bot 终端版里的 AI 助手，帮用户看懂马来西亚股票的公开资料。
用户的问题后面会附上「当前页面资料」(价格、技术指标、财报数字、公告、新闻、AI 整理的近况)，回答要以这些资料为根据，资料里没有的就说没有，不要编造数字或事件。
用简体中文回答，条理清楚、简短；需要时分点。可以解释指标是什么意思、财报数字的变化、公告在说什么、有哪些需要留意的事项。
绝对不要给买入、卖出、持有、加仓、止损、目标价或任何操作建议，也不要预测股价涨跌；用户问「该不该买」时，说明你不能给建议，改为整理相关事实和需要留意的地方。
最后不用加免责声明 (页面上已经有)。`;
const MAX_MSG = 12, MAX_CHARS = 16000;

function cors(env, req) {
  const origin = req.headers.get('Origin') || '';
  const ok = !env.ALLOW_ORIGIN || origin === env.ALLOW_ORIGIN;
  return { ok, h: { 'Access-Control-Allow-Origin': ok ? origin || '*' : 'null', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Pass', 'Access-Control-Max-Age': '86400', 'Vary': 'Origin' } };
}

export default {
  async fetch(req, env) {
    const c = cors(env, req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: c.h });
    if (req.method !== 'POST') return new Response('POST only', { status: 405, headers: c.h });
    if (!c.ok) return new Response('origin not allowed', { status: 403, headers: c.h });
    if (!env.PASS || req.headers.get('X-Pass') !== env.PASS) return new Response('wrong pass', { status: 401, headers: c.h });
    let body;
    try { body = await req.json(); } catch (e) { return new Response('bad json', { status: 400, headers: c.h }); }
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
  },
};
