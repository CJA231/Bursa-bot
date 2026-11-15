// IR + ESG 页面 (ir.html?code=XXXX) 和可嵌入官网的小工具 (ir-widget.html?code=XXXX)
// 只用公开披露资料：公司简介 (stock/<代码>.json)、公告摘要和企业活动 (intel/<代码>.json)、新股日期 (ipo.json)、
// 可持续发展报告抽出的指标和 IFRS S1/S2 披露项目 (esg/<代码>.json，scripts/esg_extract.py)。不放股价、不打分、不给建议。
// 网站管理员在终端版的更正 (overrides.json) 照样生效。
(function () {
  'use strict';
  var WIDGET = !!window.BTERM_IR_WIDGET;
  var q = function (k) { var m = new RegExp('[?&]' + k + '=([^&#]+)').exec(location.search); return m ? decodeURIComponent(m[1]) : ''; };
  var LANG = (function () {
    var l = q('lang');
    try { if (l === 'en' || l === 'zh') { if (!WIDGET) localStorage.setItem('bursa_lang', l); return l; } return localStorage.getItem('bursa_lang') || (WIDGET ? 'en' : 'zh'); } catch (e) { return l === 'zh' ? 'zh' : WIDGET ? 'en' : 'zh'; }
  })();
  var EN = LANG === 'en';
  document.documentElement.lang = EN ? 'en' : 'zh-CN';
  (function () { var th = q('theme'); try { th = th || localStorage.getItem('bterm_theme'); } catch (e) {} if (th === 'dark' || th === 'light') document.documentElement.dataset.theme = th; })();
  var CODE = (q('code') || '').toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 6);

  var TX = {
    about: ['公司简介', 'About'], recent: ['最近动态', 'Recent developments'], notable: ['重要事件', 'Notable'], watch: ['留意事项', 'Points to note'],
    anns: ['最近公告', 'Latest announcements'], cal: ['企业活动日历', 'Corporate calendar'], nocal: ['接下来没有已公布的活动日期。', 'No upcoming dates announced.'],
    esg: ['可持续发展披露 (ESG)', 'Sustainability disclosures (ESG)'], metrics: ['关键指标', 'Key metrics'], readiness: ['IFRS S1 / S2 披露项目', 'IFRS S1 / S2 disclosure items'],
    peers: ['同行业对比', 'Sector peers'], intensity: ['强度 (每 RM 百万营收)', 'Intensity (per RM million revenue)'], source: ['来源', 'Source'],
    noesg: ['还没有这家公司的可持续发展报告资料。', 'No sustainability report has been processed for this company yet.'],
    notext: ['报告是扫描图片版，抽不出文字，需要人工处理。', 'The report is a scanned image; text could not be extracted.'],
    found: ['报告里找到', 'Found in report'], partial: ['部分', 'Partly'], notfound: ['自动检索未找到', 'Not found (automated)'],
    autonote: ['自动检索的结果，可能遗漏，以原报告为准；不是合规意见。', 'Automated search; items may be missed — the original report prevails. Not a compliance opinion.'],
    item: ['项目', 'Item'], status: ['报告里', 'In report'], page: ['页', 'p.'], value: ['数值', 'Value'], year: ['年份', 'Year'], metric: ['指标', 'Metric'],
    company: ['公司', 'Company'], s12: ['范围一+二', 'Scope 1+2'], energy: ['能源', 'Energy'], employees: ['员工', 'Employees'], women: ['女性 %', 'Women %'],
    ghgint: ['排放强度', 'GHG intensity'], items: ['披露项目', 'Items found'], nopeers: ['同行业还没有其他公司的资料。', 'No other companies in this sector yet.'],
    print: ['打印 / 存 PDF', 'Print / PDF'], lang: ['EN', '中文'], website: ['官网', 'Website'], updated: ['更新', 'Updated'],
    pick: ['输入股票代码打开 IR 页面，例如 5347：', 'Enter a stock code to open its IR page, e.g. 5347:'], open: ['打开', 'Open'], demo: ['已有 ESG 资料的公司', 'Companies with ESG data'],
    nodata: ['找不到这家公司的资料。', 'No data found for this company.'], powered: ['资料整理自公司公告，摘要可能有错漏，以原公告为准', 'Compiled from company announcements; summaries may contain errors — the original announcements prevail'],
    disc: ['本页只整理公司公开披露的资料 (公告、年报、可持续发展报告)：摘要和抽取的数字都附来源和页码，可能有错漏，以原文为准。不显示股价，不构成投资建议，也不是 ESG 评级或合规意见。',
      'This page only compiles the company\'s public disclosures (announcements, annual and sustainability reports). Summaries and extracted figures carry sources and page numbers and may contain errors — the originals prevail. No share prices; not investment advice, an ESG rating or a compliance opinion.'],
    terms: ['使用条款与免责声明', 'Terms of use & disclaimer'], est: ['推算', 'estimated'], ipo: ['IPO', 'IPO']
  };
  var t = function (k) { return (TX[k] || [k, k])[EN ? 1 : 0]; };
  var CALT = { agm: ['常年股东大会', 'AGM'], egm: ['特别股东大会', 'EGM'], ex_date: ['除权 / 除息', 'Ex-date'], entitlement: ['截止过户', 'Entitlement date'], payment: ['派发', 'Payment'],
    results: ['业绩公布', 'Results'], results_due: ['季报最迟公布', 'Results deadline'], listing: ['上市', 'Listing'], corporate: ['企业活动', 'Corporate'],
    ipo_open: ['IPO 开始认购', 'IPO opens'], ipo_close: ['IPO 截止认购', 'IPO closes'], ipo_ballot: ['IPO 抽签', 'IPO ballot'], ipo_listing: ['IPO 上市', 'IPO listing'] };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function L(o, k) { return !o ? null : EN ? (o[k + '_en'] != null ? o[k + '_en'] : null) : o[k]; }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  // 按报告原本的精度显示 (39.312 不要变 39.3)；很大的数字才去掉小数
  function fmt(v) { return isNum(v) ? v.toLocaleString('en', { maximumFractionDigits: Math.abs(v) >= 1e5 ? 0 : 3 }) : '—'; }
  function md(d) { return d ? d.slice(5).replace('-', '/') : '—'; }
  function today() { return new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10); }
  function addDays(d, n) { return new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10); }
  function j(u) { return fetch(u).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }
  var root = document.getElementById('ir');

  // 管理员更正：AI 资讯 (还没核对合并时用更正版)、日历 (新增 / 更正 / 删除)、简介
  function intelView(r, ov) {
    var own = r && r.owner;
    if (ov && !(own && own.intel_at === ov.at)) return Object.assign({}, r || {}, ov);
    if (!ov && own && own.intel_at && r.ai) return Object.assign({}, r, r.ai);
    return r;
  }
  function evApply(list, ops, code) {
    if (!ops || !ops.length) return list;
    var out = list.slice(), same = function (e, ref) { return e.date === ref.date && e.type === ref.type && (!ref.what || (e.what || '') === ref.what); };
    ops.forEach(function (o) {
      var mine = { date: o.date, type: o.type, what: o.what, what_en: o.what_en, link: o.link || null, code: code };
      if (o.op === 'add') { out.push(mine); return; }
      var i = -1; out.forEach(function (e, k) { if (i < 0 && same(e, o.ref || {})) i = k; });
      if (o.op === 'del') { if (i >= 0) out.splice(i, 1); return; }
      if (i >= 0) out[i] = Object.assign({}, out[i], mine, { link: o.link || out[i].link }); else out.push(mine);
    });
    return out;
  }

  function sec(title, inner, cls) { return '<section class="ir-s' + (cls ? ' ' + cls : '') + '"><h2>' + title + '</h2>' + inner + '</section>'; }

  function events(intel, ipo, ov) {
    var td = today(), list = ((intel && intel.events) || []).slice();
    if (ipo) [['open', 'ipo_open'], ['close', 'ipo_close'], ['ballot', 'ipo_ballot'], ['listing', 'ipo_listing']].forEach(function (k) {
      var d = k[0] === 'listing' && ov && ov.ipo && ov.ipo.listing ? ov.ipo.listing : ipo[k[0]];
      if (d) list.push({ date: d, type: k[1], what: ipo.price ? 'RM' + ipo.price : '', what_en: ipo.price ? 'RM' + ipo.price : '' });
    });
    list = evApply(list, ov && ov.events && ov.events.items, CODE);
    return list.filter(function (e) { return e.date >= td; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  }
  function evRows(list, n) {
    return list.slice(0, n).map(function (e) {
      var tl = (CALT[e.type] || [e.type, e.type])[EN ? 1 : 0];
      return '<li><span class="dim">' + md(e.date) + '</span> <b>' + esc(tl) + '</b> ' + esc(L(e, 'what') || '') + (e.src === 'rule' ? ' <span class="dim">(' + t('est') + ')</span>' : '') +
        (e.link && e.link !== '#' ? ' <a href="' + esc(e.link) + '" target="_blank" rel="noopener">↗</a>' : '') + '</li>';
    }).join('');
  }
  function annRows(intel, n) {
    return ((intel && intel.ann) || []).slice(0, n).map(function (a) {
      return '<li><span class="dim">' + md(a.date) + '</span> <a href="' + esc(a.link) + '" target="_blank" rel="noopener">' + esc(a.title) + '</a>' + (L(a, 'why') ? ' <span class="dim">· ' + esc(L(a, 'why')) + '</span>' : '') + '</li>';
    }).join('');
  }

  function esgBlock(e, index) {
    if (!e) return sec(t('esg'), '<p class="dim">' + t('noesg') + '</p>');
    if (e.status === 'no_text') return sec(t('esg'), '<p class="dim">' + t('notext') + '</p>');
    if (e.status !== 'ok') return sec(t('esg'), '<p class="dim">' + t('noesg') + '</p>');
    var h = L(e, 'summary') ? '<p>' + esc(L(e, 'summary')) + '</p>' : '';
    var ms = e.metrics || [];
    if (ms.length) h += '<h3>' + t('metrics') + '</h3><table class="ir-t"><thead><tr><th>' + t('metric') + '</th><th class="r">' + t('value') + '</th><th>' + t('year') + '</th><th>' + t('page') + '</th></tr></thead><tbody>' +
      ms.map(function (m) {
        return '<tr><td>' + esc(EN ? m.label_en : m.label) + '</td><td class="r"><b>' + fmt(m.value) + '</b> <span class="dim">' + esc(m.unit) + '</span></td><td>' + (m.year || '—') + '</td>' +
          '<td><details><summary>' + t('page') + ' ' + m.page + '</summary><q>' + esc(m.quote) + '</q></details></td></tr>';
      }).join('') + '</tbody></table>';
    var it = e.intensity;
    if (it && (isNum(it.ghg12_per_rm_m) || isNum(it.energy_per_rm_m))) h += '<p class="dim ir-int">' + t('intensity') + ' · FY' + it.year + ': ' +
      [isNum(it.ghg12_per_rm_m) ? t('s12') + ' ' + fmt(it.ghg12_per_rm_m) + ' tCO2e' : '', isNum(it.energy_per_rm_m) ? t('energy') + ' ' + fmt(it.energy_per_rm_m) + ' ' + esc(String(it.energy_unit || '').split(' /')[0]) : '']
        .filter(Boolean).join(' · ') + ' (' + (EN ? 'revenue RM' : '营收 RM') + fmt(it.revenue_rm_m) + (EN ? ' mil' : ' 百万') + ')</p>';
    var rd = e.readiness || [], RL = { governance: ['治理', 'Governance'], strategy: ['策略', 'Strategy'], risk_mgmt: ['风险管理', 'Risk management'], metrics_targets: ['指标与目标', 'Metrics & targets'],
      scope12: ['范围一、二排放', 'Scope 1 & 2 emissions'], scope3: ['范围三排放', 'Scope 3 emissions'], scenario: ['气候情景分析', 'Climate scenario analysis'], transition: ['转型计划 / 减排目标', 'Transition plan / targets'],
      financial_effects: ['气候对财务的影响', 'Financial effects of climate'], assurance: ['鉴证 / 审核', 'Assurance / review'] };
    var sym = { found: ['✓', 'up', t('found')], partial: ['◐', 'warn', t('partial')], not_found: ['—', 'dim', t('notfound')] };
    if (rd.length) h += '<h3>' + t('readiness') + '</h3><table class="ir-t"><thead><tr><th>' + t('item') + '</th><th>' + t('status') + '</th><th>' + t('page') + '</th></tr></thead><tbody>' +
      rd.map(function (r) { var s = sym[r.status] || sym.not_found;
        return '<tr><td>' + esc((RL[r.key] || [r.key, r.key])[EN ? 1 : 0]) + (L(r, 'note') ? '<div class="dim ir-note">' + esc(L(r, 'note')) + '</div>' : '') + '</td><td class="' + s[1] + '">' + s[0] + ' ' + s[2] + '</td><td>' + (r.page || '—') + '</td></tr>'; }).join('') + '</tbody></table>' +
      '<p class="dim ir-note">' + t('autonote') + '</p>';
    // 同行业对比 (同一个 sector)
    var peers = ((index && index.items) || []).filter(function (x) { return x.sector && x.sector === e.sector; });
    var val = function (x, k) { return x.metrics && x.metrics[k] ? x.metrics[k].value : null; };
    if (peers.length > 1) h += '<h3>' + t('peers') + ' <span class="dim">· ' + esc(e.sector) + '</span></h3><div class="ir-scroll"><table class="ir-t"><thead><tr><th>' + t('company') + '</th><th>' + t('year') + '</th><th class="r">' + t('s12') + ' (tCO2e)</th><th class="r">' + t('ghgint') + '</th><th class="r">' + t('employees') + '</th><th class="r">' + t('women') + '</th><th class="r">' + t('items') + '</th></tr></thead><tbody>' +
      peers.map(function (x) {
        var s1 = val(x, 'ghg_scope1'), s2 = val(x, 'ghg_scope2'), s12 = isNum(s1) || isNum(s2) ? (s1 || 0) + (s2 || 0) : null;
        return '<tr' + (x.code === e.code ? ' class="me"' : '') + '><td>' + esc(x.name || x.code) + '</td><td>' + (x.year || '—') + '</td><td class="r">' + fmt(s12) + '</td><td class="r">' + fmt(x.intensity && x.intensity.ghg12_per_rm_m) + '</td><td class="r">' + fmt(val(x, 'employees')) + '</td><td class="r">' + fmt(val(x, 'women_pct')) + '</td><td class="r">' + x.found + '/' + (index.readiness_total || 10) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    else h += '<p class="dim">' + t('peers') + ': ' + t('nopeers') + '</p>';
    var src = e.source || {};
    h += '<p class="dim ir-src">' + t('source') + ': <a href="' + esc(src.url) + '" target="_blank" rel="noopener">' + esc((src.type === 'annual' ? (EN ? 'Annual report ' : '年报 ') : (EN ? 'Sustainability report ' : '可持续发展报告 ')) + (e.year || '')) + ' ↗</a>' +
      (src.pages ? ' · ' + src.pages + (EN ? ' pages' : ' 页') : '') + ' · ' + t('updated') + ' ' + esc(e.updated || '') + '</p>';
    return sec(t('esg'), h, 'ir-esg');
  }

  function pickPage(index) {
    var items = (index && index.items) || [];
    return '<div class="ir-pick"><h1>IR · ESG</h1><p>' + t('pick') + '</p><form id="ir-go"><input id="ir-code" inputmode="numeric" maxlength="6" placeholder="5347"> <button type="submit">' + t('open') + '</button></form>' +
      (items.length ? '<h2>' + t('demo') + '</h2><ul class="ir-l">' + items.map(function (x) { return '<li><a href="?code=' + esc(x.code) + '">' + esc(x.name || x.code) + '</a> <span class="dim">' + esc(x.code) + ' · ' + esc(x.sector || '') + ' · FY' + (x.year || '') + '</span></li>'; }).join('') + '</ul>' : '') + '</div>';
  }

  function render(d) {
    var stock = d[0] || {}, ov = (d[5] && d[5].codes && d[5].codes[CODE]) || null;
    var intel = intelView(d[1], ov && ov.intel), esg = d[2], index = d[3], ipo = ((d[4] && d[4].ipos) || []).filter(function (x) { return x.code === CODE; })[0] || null;
    var names = (d[6] && d[6].names) || {}, short = names[CODE] || (ipo && ipo.ticker) || (intel && intel.name) || CODE;
    var name = stock.long_name || (intel && intel.long_name) || (ipo && ipo.name) || (esg && esg.name) || short;
    if (!d[0] && !d[1] && !d[2] && !ipo) { root.innerHTML = '<p class="dim">' + t('nodata') + ' (' + esc(CODE) + ')</p>' + pickPage(index); bindPick(); return; }
    document.title = (WIDGET ? short : name) + ' · IR';
    var ev = events(d[1], ipo, ov);
    if (WIDGET) {
      root.innerHTML = '<div class="irw-h"><b>' + esc(short) + '</b> <span class="dim">' + (EN ? 'Investor updates' : '投资者资讯') + '</span></div>' +
        '<h3>' + t('anns') + '</h3><ul class="ir-l">' + (annRows(intel, 5) || '<li class="dim">—</li>') + '</ul>' +
        '<h3>' + t('cal') + '</h3><ul class="ir-l">' + (evRows(ev.filter(function (e) { return e.date <= addDays(today(), 30); }), 6) || '<li class="dim">' + t('nocal') + '</li>') + '</ul>' +
        '<p class="dim irw-f">' + t('powered') + ' · <a href="https://cja231.github.io/Bursa-bot/terminal/ir.html?code=' + esc(CODE) + '" target="_blank" rel="noopener">bursa.term</a></p>';
      return;
    }
    var p = Object.assign({}, stock.profile || {}), op = ov && ov.profile;
    if (op) { ['zh', 'website'].forEach(function (k) { if (op[k]) p[k] = op[k]; }); ['lines', 'lines_en'].forEach(function (k) { if (op[k] && op[k].length) p[k] = op[k]; }); }
    var host = p.website ? p.website.replace(/^https?:\/\//i, '').replace(/\/$/, '') : '';
    var h = '<header class="ir-h"><div><h1>' + esc(name) + '</h1><p class="dim">' + esc(short) + ' · ' + esc(CODE) + (p.sector ? ' · ' + esc([p.sector, p.industry].filter(Boolean).join(' / ')) : '') +
      (p.website ? ' · <a href="' + esc(p.website) + '" target="_blank" rel="noopener">' + esc(host) + ' ↗</a>' : '') + '</p></div>' +
      '<div class="ir-tools"><button type="button" id="ir-lang">' + t('lang') + '</button><button type="button" id="ir-print">' + t('print') + '</button></div></header>';
    var about = EN ? p.summary : (p.zh || p.summary), lines = EN ? p.lines_en : p.lines;
    if (about) h += sec(t('about'), '<p>' + esc(about) + '</p>' + (lines && lines.length ? '<ul class="ir-l">' + lines.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : ''));
    if (intel) {
      var nt = L(intel, 'notable') || [], rk = L(intel, 'risks') || [], r = '';
      if (L(intel, 'recent')) r += '<p>' + esc(L(intel, 'recent')) + '</p>';
      if (nt.length) r += '<h3>' + t('notable') + '</h3><ul class="ir-l">' + nt.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
      if (rk.length) r += '<h3>' + t('watch') + '</h3><ul class="ir-l">' + rk.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
      if (L(intel, 'earnings')) r += '<p>' + esc(L(intel, 'earnings')) + '</p>';
      var al = annRows(intel, 8);
      if (al) r += '<h3>' + t('anns') + '</h3><ul class="ir-l">' + al + '</ul>';
      h += sec(t('recent'), r + '<p class="dim">' + t('updated') + ' ' + esc(intel.updated || '') + '</p>');
    }
    h += sec(t('cal'), ev.length ? '<ul class="ir-l">' + evRows(ev, 10) + '</ul>' : '<p class="dim">' + t('nocal') + '</p>');
    h += esgBlock(esg, index);
    h += '<footer class="ir-f dim"><p>' + t('disc') + '</p><p><a href="legal.html">' + t('terms') + '</a> · <a href="./#q-' + esc(CODE) + '">bursa.term</a></p></footer>';
    root.innerHTML = h;
    document.getElementById('ir-print').addEventListener('click', function () { window.print(); });
    document.getElementById('ir-lang').addEventListener('click', function () { try { localStorage.setItem('bursa_lang', EN ? 'zh' : 'en'); } catch (e) {} location.replace(location.pathname + '?code=' + CODE); });
  }
  function bindPick() {
    var f = document.getElementById('ir-go');
    if (f) f.addEventListener('submit', function (ev) { ev.preventDefault(); var c = (document.getElementById('ir-code').value || '').trim().toUpperCase(); if (c) location.search = '?code=' + encodeURIComponent(c); });
  }

  if (!CODE) {
    j('../esg/index.json').then(function (ix) { root.innerHTML = pickPage(ix); bindPick(); });
    return;
  }
  Promise.all([j('../stock/' + CODE + '.json'), j('../intel/' + CODE + '.json'), j('../esg/' + CODE + '.json'), j('../esg/index.json'), j('ipo.json'), j('overrides.json'), WIDGET ? null : j('data.json')])
    .then(render).catch(function (e) { root.innerHTML = '<p class="dn">' + esc(e.message) + '</p>'; });
})();
