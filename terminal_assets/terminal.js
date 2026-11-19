// bursa.term — 马股终端版 (纯文字 / Nord)。数据: data.json (今天的结果) + bars.json (日线，打开后在背景下载)
// 页面: 1 信号 (+ 信号跟进) · 2 市场 · 3 观察列表 (自己的，分文件夹) · 4 回测 · 5 股票池 · 6 公告 · 7 日历 (企业活动)；#q-<代码> = 个股。图全部用字符画 (█ │ ▁▂▃ …)。
(function () {
  'use strict';
  // 语言：中文 (默认) / English，跟标准报告共用设置 (localStorage bursa_lang，网址 ?lang=en / ?lang=zh)。切换会重新载入页面
  var LANG = (function () {
    var q = /[?&]lang=(en|zh)/.exec(location.search); try { if (q) localStorage.setItem('bursa_lang', q[1]); return (q && q[1]) || localStorage.getItem('bursa_lang') || 'zh'; } catch (e) { return (q && q[1]) || 'zh'; }
  })();
  var EN = window.TERM_EN || {};
  // 资料里自带的中文 (信号条件、趋势检查、风险线依据、指数名称)：English 模式下按规则换成英文
  var TR = [[/SAR 下穿 当前价格/g, 'SAR crosses below price'], [/当前价格/g, 'Price'], [/价格/g, 'Price'], [/成交量/g, 'Volume'], [/ 或 /g, ' or '],
    [/最近回调低点 \(收盘价\)/g, 'latest pullback low (close)'], [/最近回调低点/g, 'latest pullback low'], [/收盘价/g, 'close'], [/第 (\d+) 天/g, 'day $1'],
    [/支撑/g, 'support'], [/放量抛售/g, 'heavy-volume drop'], [/趋势转坏/g, 'trend weak'], [/、/g, ', '], [/富时综合指数/g, 'FBM'], [/（/g, ' ('], [/）/g, ')']];
  function tr(x) { if (LANG !== 'en' || x == null) return x; x = String(x); TR.forEach(function (r) { x = x.replace(r[0], r[1]); }); return x; }
  function L(o, k) { return !o ? null : LANG === 'en' ? (o[k + '_en'] != null ? o[k + '_en'] : null) : o[k]; }  // AI 生成内容：English 模式用 *_en，没有就不显示
  function T(zh) { return LANG === 'en' && Object.prototype.hasOwnProperty.call(EN, zh) ? EN[zh] : zh; }
  document.documentElement.lang = LANG === 'en' ? 'en' : 'zh-CN'; document.documentElement.dataset.lang = LANG;
  var V = (document.currentScript && /v=([^&]+)/.exec(document.currentScript.src) || [])[1] || Date.now();
  var D = null, BARS = null, barsLoading = false;
  var main = document.getElementById('main');
  var PAGES = [['sig', T('信号')], ['mkt', T('市场')], ['watch', T('观察列表')], ['bt', T('回测')], ['pool', T('股票池')], ['ann', T('公告')], ['cal', T('日历')]];
  var S = { page: 'sig', code: null, flt: {}, sort: 'to', dir: -1, q: '', limit: 50, cat: 'all' };
  var CAT = { results: T('财报'), dividend: T('派息'), corporate: T('企业'), holding: T('持股'), buyback: T('回购'), uma: T('异常'), people: T('人事'), meeting: T('会议'), other: T('其他') };
  var EXIT = { take: T('涨幅达标'), emab: T('EMA 破位'), combo: T('趋势转坏'), time: T('期满'), swing: T('跌破低点'), stop: T('跌破风险线'), sar: T('SAR 转空'), red: T('回调红K'), open: T('跟踪中'), high: T('前高'), res: T('阻力') };
  var STN = { hold: T('ACTIVE 跟踪中'), near: T('NEAR 近风险线'), out: T('ENDED 已结束') };

  // ---------- 小工具 ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function px(v) { return !isNum(v) ? '—' : v.toFixed(v < 10 ? 3 : 2); }
  function pct(v, d) { return !isNum(v) ? '—' : (v > 0 ? '+' : '') + v.toFixed(d == null ? 2 : d) + '%'; }
  function cls(v) { return !isNum(v) || v === 0 ? 'dim' : v > 0 ? 'up' : 'dn'; }
  function big(v) { return !isNum(v) ? '—' : v >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(0) + 'K' : String(Math.round(v)); }
  function rm(v) { return !isNum(v) ? '—' : (v > 0 ? '+' : v < 0 ? '-' : '') + 'RM ' + Math.round(Math.abs(v)).toLocaleString('en'); }
  function md(d) { return d ? d.slice(5).replace('-', '/') : '—'; }
  function pad(s, n, right) { s = String(s); return s.length >= n ? s.slice(0, n) : right ? ' '.repeat(n - s.length) + s : s + ' '.repeat(n - s.length); }
  function meter(f, n) { var k = Math.max(0, Math.min(n, Math.round(f * n))); return '█'.repeat(k) + span('g', '░'.repeat(n - k)); }  // 空的部分用暗灰，满的部分颜色更跳
  // 中文字比一格宽：标签放进固定宽度的格子里，后面的条才对得齐
  function cell(t, n, right) { return '<span class="cell" style="width:' + n + 'ch' + (right ? ';text-align:right' : '') + '">' + t + '</span>'; }
  function span(c, t) { return c ? '<span class="' + c + '">' + t + '</span>' : t; }
  var EIGHTHS = ' ▁▂▃▄▅▆▇█';
  function spark(vals, n) {
    vals = vals.filter(isNum); if (vals.length < 2) return '';
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), r = hi - lo || 1, out = '';
    for (var i = 0; i < n; i++) { var v = vals[Math.min(vals.length - 1, Math.floor(i * vals.length / n))]; out += EIGHTHS[1 + Math.round((v - lo) / r * 7)]; }
    return out;
  }
  var CW = null;  // 一个字符多宽 (px)，用来算字符图能放几栏
  function charW() {
    if (CW) return CW;
    // 数字和方块字可能来自不同字体 (网页字体还没载入时)，两种都量，取宽的那个，图才不会超出框
    var w = ['0', '█', '│', '┄', '▄', '╌', '━'].map(function (ch) {
      var p = document.createElement('pre'); p.className = 'chart'; p.style.cssText = 'position:absolute;visibility:hidden'; p.textContent = ch.repeat(50);
      document.body.appendChild(p); var x = p.getBoundingClientRect().width / 50; p.remove(); return x;
    });
    CW = Math.max.apply(null, w) || 7; return CW;
  }
  function cols() { return Math.max(30, Math.floor((main.clientWidth - 30) / charW())); }

  // ---------- 字符 K 线 ----------
  // 每栏一天：实体 █ (半格 ▀▄、十字 ━)，影线 │，EMA20 ·，风险线 / 目标 ╌；右边价格刻度，下面成交量 ▁▂▃ 和日期
  // 两种画法 (图表右下角或 [k] 切换，存在 bterm_candle)：
  //   hollow 空心K线 (默认，跟 TradingView 一样)：收盘 > 开盘 = 空心框，收盘 < 开盘 = 实心；颜色看收盘比前一天收盘涨还是跌
  //   solid  实心K线：收盘 ≥ 开盘 绿、否则红，全部实心
  // 空心框用 CSS 画 (.hc，四边 + 半格)，不靠字体里的框线字符，手机上粗细跟实心一样
  var CANDLE = 'hollow';
  try { if (localStorage.getItem('bterm_candle') === 'solid') CANDLE = 'solid'; } catch (e) {}
  function toggleCandle() { CANDLE = CANDLE === 'hollow' ? 'solid' : 'hollow'; try { localStorage.setItem('bterm_candle', CANDLE); } catch (e) {} render(); }
  function candleChart(bars, opt) {
    opt = opt || {};
    var rows = opt.rows || 12, axis = 7, W = Math.min(bars.length, (opt.cols || cols()) - axis);
    if (W < 5) return T('<p class="dim">日线不够</p>');
    var k = 2 / 21, e = null, ema = bars.map(function (b) { e = e == null ? b.c : b.c * k + e * (1 - k); return e; });
    var bs = bars.slice(-W), em = ema.slice(-W), off = bars.length - W;
    var lo = Infinity, hi = -Infinity;
    bs.forEach(function (b) { lo = Math.min(lo, b.l); hi = Math.max(hi, b.h); });
    var span0 = hi - lo || hi * 0.02 || 0.01;
    [opt.stop, opt.target].forEach(function (v) { if (isNum(v) && v > lo - span0 * 0.35 && v < hi + span0 * 0.35) { lo = Math.min(lo, v); hi = Math.max(hi, v); } });
    var padv = (hi - lo) * 0.04; lo -= padv; hi += padv;
    var step = (hi - lo) / rows;
    function rowOf(v) { return Math.max(0, Math.min(rows - 1, Math.floor((hi - v) / step))); }
    var g = [];
    for (var r = 0; r < rows; r++) { g.push([]); for (var i = 0; i < W; i++) g[r].push([' ', '']); }
    var hollow = CANDLE === 'hollow';
    // 颜色：实心 = 收盘对开盘；空心 = 收盘对前一天收盘 (第一根没有前一天，用开盘)
    var colr = bs.map(function (b, i) { var ref = hollow ? (i + off > 0 ? bars[i + off - 1].c : b.o) : b.o; return b.c >= ref ? 'u' : 'd'; });
    bs.forEach(function (b, i) {
      var c = 'c' + colr[i], bt = Math.max(b.o, b.c), bb = Math.min(b.o, b.c), doji = bt - bb < step * 0.25;
      // 空心实体按半格算：ht / hb = 实体上 / 下缘离顶部几个半格
      var hc = hollow && b.c > b.o && !doji, ht = 0, hb = 0;
      if (hc) { ht = Math.max(0, Math.round((hi - bt) / step * 2)); hb = Math.min(rows * 2, Math.max(ht + 1, Math.round((hi - bb) / step * 2))); }
      for (var r = 0; r < rows; r++) {
        var top = hi - r * step, bot = top - step, ov = Math.min(bt, top) - Math.max(bb, bot);
        if (hc && hb > 2 * r && ht < 2 * r + 2) {
          var a = Math.max(ht, 2 * r) - 2 * r, z = Math.min(hb, 2 * r + 2) - 2 * r, k = c + ' hc';
          if (a === 1) k += ' ha' + (b.h > bt + step * 0.25 ? ' wa' : '');
          if (z === 1) k += ' hz' + (b.l < bb - step * 0.25 ? ' wb' : '');
          if (ht >= 2 * r) k += ' ht';
          if (hb <= 2 * r + 2) k += ' hb';
          g[r][i] = [' ', k];
        }
        else if (doji && (bt + bb) / 2 <= top && (bt + bb) / 2 > bot) g[r][i] = ['━', c];
        else if (!hc && ov > 0) g[r][i] = [ov >= step * 0.55 ? '█' : bt >= top - step * 0.5 ? '▀' : '▄', c];
        else if (b.h > bot && b.l <= top) g[r][i] = ['│', c];
      }
    });
    em.forEach(function (v, i) { if (i + off >= 19) { var r = rowOf(v); if (g[r][i][0] === ' ') g[r][i] = ['·', 'e']; } });
    var marks = {};
    [[opt.stop, 'cd', 'STOP'], [opt.target, 'cu', 'TGT ']].forEach(function (m) {
      if (!isNum(m[0]) || m[0] < lo || m[0] > hi) return;
      var r = rowOf(m[0]); marks[r] = m;
      for (var i = 0; i < W; i++) if (g[r][i][0] === ' ') g[r][i] = ['╌', m[1]];
    });
    var labels = {}; labels[0] = hi - step / 2; labels[Math.floor(rows / 2)] = hi - (Math.floor(rows / 2) + 0.5) * step; labels[rows - 1] = lo + step / 2;
    var out = [];
    for (r = 0; r < rows; r++) {
      var line = '', cur = null, buf = '';
      for (i = 0; i < W; i++) {
        var cell = g[r][i];
        if (cell[1].indexOf(' hc') > 0) { line += span(cur, buf) + span(cell[1], ' '); buf = ''; cur = null; continue; }  // 空心框每格单独一个 span
        if (cell[1] !== cur) { line += span(cur, buf); buf = ''; cur = cell[1]; } buf += cell[0];
      }
      line += span(cur, buf);
      var lab = marks[r] ? span(marks[r][1], ' ' + pad(px(marks[r][0]), 6, true)) : labels[r] != null ? span('dim', ' ' + pad(px(labels[r]), 6, true)) : '';
      out.push(line + lab);
    }
    var mv = Math.max.apply(null, bs.map(function (b) { return b.v || 0; })) || 1, vl = '', vc = null, vb = '';
    bs.forEach(function (b, i) { var c = 'v' + colr[i], ch = EIGHTHS[Math.max(1, Math.round((b.v || 0) / mv * 8))]; if (c !== vc) { vl += span(vc, vb); vb = ''; vc = c; } vb += ch; });
    vl += span(vc, vb) + span('dim', ' VOL');
    out.push(vl);
    var d0 = md(bs[0].d), d1 = md(bs[bs.length - 1].d);
    out.push(span('dim', d0 + ' '.repeat(Math.max(1, W - d0.length - d1.length)) + d1) +
      ' <button type="button" class="cndl" data-candle title="' + T('切换空心 / 实心K线 [k]') + '">' + (hollow ? T('空心') : T('实心')) + '</button>');
    return '<pre class="chart" role="img" aria-label="' + esc(opt.label || T('日线')) + T('，最近 ') + W + T(' 天">') + out.join('\n') + '</pre>';
  }
  // 多行方块图 (资金曲线 / 指数)：每栏一个点，最上面一格用 ▁▂▃ 表示零头
  function blockChart(vals, opt) {
    opt = opt || {};
    var rows = opt.rows || 7, axis = 9, W = (opt.cols || cols()) - axis;
    vals = vals.filter(isNum); if (vals.length < 2) return T('<p class="dim">数据不够</p>');
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (opt.zero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
    var r = hi - lo || 1, colv = [], coli = [];
    for (var i = 0; i < W; i++) { var j = Math.min(vals.length - 1, Math.floor(i * vals.length / W)); colv.push(vals[j]); coli.push(j); }
    var zr = opt.zero ? (0 - lo) / r * rows : null, out = [];
    for (var y = rows - 1; y >= 0; y--) {
      var line = '', cur = null, buf = '';
      colv.forEach(function (v, i) {
        var h = (v - lo) / r * rows, f = Math.max(y === 0 && zr == null ? 0.5 : 0, Math.min(1, h - y)), ch = f >= 0.75 ? '█' : f >= 0.25 ? '▄' : ' ', c = opt.color ? opt.color(v, coli[i], vals) : 'acc';
        if (ch === ' ' && zr != null && Math.floor(zr) === y) { ch = '┄'; c = 'g'; }
        if (c !== cur) { line += span(cur, buf); buf = ''; cur = c; } buf += ch;
      });
      line += span(cur, buf);
      var lab = y === rows - 1 ? opt.fmt(hi) : y === 0 ? opt.fmt(lo) : zr != null && Math.floor(zr) === y ? opt.fmt(0) : '';
      out.push(line + (lab ? span('dim', ' ' + pad(lab, axis - 1, true)) : ''));
    }
    if (opt.dates) out.push(span('dim', opt.dates[0] + ' '.repeat(Math.max(1, W - opt.dates[0].length - opt.dates[1].length)) + opt.dates[1]));
    return '<pre class="chart" role="img" aria-label="' + esc(opt.label || T('走势')) + '">' + out.join('\n') + '</pre>';
  }

  // ---------- 数据整理 ----------
  var ST = {}, LIST = [], OPEN = {};  // OPEN = 哪些信号卡的 Info 是打开的 (重画后保持)
  var NAMES = {};  // 代码 → 简称：整个马股名单 (data.json names) + 报告里的股票
  function nameOf(c) { return (ST[c] && ST[c].name) || NAMES[c] || c; }
  // 名称 / 代码搜索：先找名称开头相同的，再找包含的；skip = 已经加了的不再列
  function findCodes(q, skip, n) {
    q = (q || '').trim().toUpperCase(); if (!q) return [];
    var all = Object.keys(NAMES), head = [], mid = [];
    all.forEach(function (c) {
      if (skip && skip.indexOf(c) >= 0) return;
      var nm = (NAMES[c] || '').toUpperCase();
      if (nm.indexOf(q) === 0 || c.indexOf(q) === 0) head.push(c); else if (nm.indexOf(q) > 0) mid.push(c);
    });
    var rank = function (a, b) { return ((ST[b] && ST[b].to) || 0) - ((ST[a] && ST[a].to) || 0) || (a < b ? -1 : 1); };
    return head.sort(rank).concat(mid.sort(rank)).slice(0, n || 8);
  }
  function ingest() {
    LIST = D.stocks.map(function (r) {
      return { code: r[0], name: r[1], p: r[2], c: r[3], vol: r[4], to: r[5], rv: r[6], rsi: r[7], sar: r[8], ema: r[9], sma: r[10],
        sig: r[11], pool: r[12], fresh: r[13], first: r[14], streak: r[15], mc: r[16], atr: r[17], listed: r[18] };
    });
    LIST.forEach(function (s) { ST[s.code] = s; });
    NAMES = D.names || {}; LIST.forEach(function (s) { NAMES[s.code] = s.name; });
  }
  function bars(code) {
    var b = BARS && BARS[code]; if (!b) return null;
    return b.map(function (x) { return { d: x[0], o: x[1] / 1000, h: x[2] / 1000, l: x[3] / 1000, c: x[4] / 1000, v: x[5] }; });
  }
  function loadBars() {
    if (BARS || barsLoading) return; barsLoading = true;
    fetch('bars.json?v=' + V).then(function (r) { return r.json(); }).then(function (j) { BARS = j; render(); }).catch(function () { barsLoading = false; });
  }
  function chartFor(code, opt) {
    var b = bars(code);
    if (!b) return '<pre class="chart dim">' + (BARS ? T('没有日线') : 'loading bars…') + '</pre>';
    return candleChart(b, opt);
  }
  function sparkFor(code, n) { var b = bars(code); return b ? spark(b.slice(-30).map(function (x) { return x.c; }), n) : ''; }

  // ---------- 页面 ----------
  function pn(title, sub, inner) { return '<section class="pn"><h2><span class="tt">' + title + '</span>' + (sub ? '<small>' + sub + '</small>' : '') + '</h2><div class="stack">' + inner + '</div></section>'; }
  function kv(items, four) { return '<div class="kv' + (four ? ' k4' : '') + '">' + items.map(function (x) { return '<div><span>' + x[0] + '</span><span class="' + (x[2] || '') + '">' + x[1] + '</span></div>'; }).join('') + '</div>'; }
  function stockBtn(s, right, sub) {
    return '<button type="button" class="row" data-q="' + esc(s.code) + '"><span><b>' + esc(s.name) + '</b> <span class="dim">' + esc(s.code) + '</span>' + (sub ? '<br><span class="sub">' + sub + '</span>' : '') + '</span><span class="r">' + right + '</span></button>';
  }

  // 搜索全部股票 (代码或名称；整个马股名单，不只报告里的)：结果点一下打开个股页，Enter 开第一个
  function sqHits(q) {
    q = (q || '').trim().toUpperCase();
    if (!q) return [];
    var out = [];
    Object.keys(NAMES).forEach(function (c) {
      var n = String(NAMES[c] || '').toUpperCase(), r = c === q || n === q ? 0 : c.indexOf(q) === 0 ? 1 : n.indexOf(q) === 0 ? 2 : n.indexOf(q) >= 0 ? 3 : -1;
      if (r >= 0) out.push([r, c]);
    });
    return out.sort(function (a, b) { return a[0] - b[0] || (ST[b[1]] ? 1 : 0) - (ST[a[1]] ? 1 : 0) || (a[1] < b[1] ? -1 : 1); }).slice(0, 8).map(function (x) { return x[1]; });
  }
  function sqRes() {
    var q = S.sq || '', hits = sqHits(q);
    if (!q.trim()) return '';
    if (!hits.length) return '<p class="dim sq-none">' + (LANG === 'en' ? 'No stock matches “' + esc(q) + '”' : '找不到「' + esc(q) + '」') + '</p>';
    return hits.map(function (c) {
      var s = ST[c];
      return '<button type="button" class="sq-r" data-q="' + esc(c) + '"><span class="dim">' + esc(c) + '</span> <b>' + esc(nameOf(c)) + '</b>' +
        (s ? ' <span class="sq-p">' + px(s.p) + ' <span class="' + cls(s.c) + '">' + pct(s.c, 1) + '</span>' + (s.sig ? ' <span class="up">SIG</span>' : '') + '</span>' : '') + '</button>';
    }).join('');
  }
  function sqBox() {
    return '<div class="sq"><div class="grep"><label for="sq">' + (LANG === 'en' ? 'find&gt;' : '搜索&gt;') + '</label><input id="sq" type="search" inputmode="search" enterkeyhint="go" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="' +
      (LANG === 'en' ? 'Any stock: code or name' : '全部股票：代码或名称') + '" value="' + esc(S.sq || '') + '"></div><div class="sq-res" id="sq-res">' + sqRes() + '</div></div>';
  }
  function pageSig() { return sqBox() + pageSigBody(); }
  function pageSigBody() {
    var sigs = D.signals || [];
    if (!sigs.length) return pn(T('SIGNALS 信号'), md(D.date), T('<p>今天没有股票符合「SAR 转多」的全部条件。</p><p class="dim">之前的信号还在跟进的列在下面；回测结果看 [4]。</p>')) + pageTrack();
    return sigs.map(function (x) {
      var risk = isNum(x.stop) ? (x.price - x.stop) / x.price * 100 : null;
      var inner = '<p><button type="button" class="nm" data-q="' + esc(x.code) + '"><b>' + esc(x.name) + '</b> <span class="dim">' + esc(x.code) + '</span></button>　<b>' + px(x.price) + '</b> <span class="' + cls(x.chg) + '">' + pct(x.chg) + '</span>' + (D.state === 'live' ? T('　<span class="warn">盘中</span>') : '') + '</p>' +
        chartFor(x.code, { stop: x.stop, target: x.target, label: x.name + T(' 日线') }) +
        kv([[T('距风险线'), risk == null ? '—' : pct(-risk, 1), 'dn'], [T('参考涨幅'), x.tp ? '+' + x.tp + '%' : '—', 'up'], ['R:R', isNum(x.rr) ? x.rr.toFixed(1) : '—'], [T('相对量'), isNum(x.rv) ? x.rv.toFixed(2) + '×' : '—']], true) +
        (risk != null && x.tp ? T('<pre class="txt">下行 ') + (function () { var k = Math.max(1, Math.round(risk / (risk + x.tp) * 24)); return span('cd', '█'.repeat(k)) + span('cu', '█'.repeat(24 - k)); })() + T(' 上行\n') +
          span('dim', T('风险线 ') + px(x.stop) + (x.stop_by ? ' (' + esc(tr(x.stop_by)) + ')' : '') + T('  ·  参考位 ') + px(x.target)) + '</pre>' : '') +
        (L(x, 'digest') ? T('<p class="digest"><b>消息面&gt;</b> ') + esc(L(x, 'digest')) + '</p>' : '') +
        '<details class="info" data-code="' + esc(x.code) + '"' + (OPEN[x.code] ? ' open' : '') + '><summary>Info <span class="arw" aria-hidden="true">➡️</span></summary>' +
        '<pre class="txt">' + (x.why || []).map(function (w) { return span('up', '[x]') + ' ' + esc(tr(w)); }).join('\n') + '</pre>' +
        '<button type="button" class="more" data-q="' + esc(x.code) + T('">个股详情 →</button></details>');
      return pn(T('SIGNAL · SAR 转多'), md(x.date || D.date), inner);
    }).join('') + pageTrack();
  }
  // 信号跟进 (系统自动)：最近的信号之后走势怎样 (接近风险线 / 跟踪中 / 刚结束)
  function pageTrack() {
    var f = D.follow || [];
    if (!f.length) return pn(T('TRACKING 信号跟进'), '', T('<p class="dim">最近没有还在跟进的信号。</p>'));
    var groups = [['near', T('接近风险线')], ['hold', T('跟踪中')], ['out', T('刚结束跟踪')]];
    return groups.map(function (gp) {
      var items = f.filter(function (x) { return x.status === gp[0]; });
      if (!items.length) return '';
      return pn('TRACKING · ' + STN[gp[0]], LANG === 'en' ? items.length + ' stocks' : gp[1] + ' · ' + items.length, '<div class="rows">' + items.map(function (x) {
        var s = ST[x.code] || { code: x.code, name: x.name };
        var bar = isNum(x.dist) ? span(x.dist < 3 ? 'dn' : 'acc', meter(Math.max(0, x.dist) / 15, 10)) + ' ' + x.dist.toFixed(1) + '%' : '';
        var sub = md(x.sig) + T(' 信号 · ') + x.days + T(' 天 · 信号价 ') + px(x.entry) + (x.status === 'out' ? ' · ' + (EXIT[x.reason] || x.reason) : T(' · 风险线 ') + px(x.stop)) +
          (x.hits && x.hits.length ? ' · <span class="warn">' + esc(tr(x.hits.join('、'))) + '</span>' : '');
        return stockBtn(s, '<span class="' + cls(x.ret) + ' b">' + pct(x.ret, 1) + '</span><br><span class="sub">' + (x.status === 'out' ? px(x.last) : bar) + '</span>', sub);
      }).join('') + '</div>');
    }).join('');
  }

  // ---------- 观察列表 (自己的)：可以开很多个文件夹分类；存在这台设备的浏览器 (localStorage)，可导出 / 导入备份 ----------
  var WQ = '';
  var W = (function () {
    var j = null;
    try { j = JSON.parse(localStorage.getItem('bterm_watch') || 'null'); } catch (e) {}
    if (!j || !Array.isArray(j.folders) || !j.folders.length) j = { folders: [{ id: 'f1', name: T('默认'), codes: [] }], cur: 'f1' };
    return j;
  })();
  function saveW() { try { localStorage.setItem('bterm_watch', JSON.stringify(W)); } catch (e) {} }
  function curFolder() { return W.folders.filter(function (f) { return f.id === W.cur; })[0] || W.folders[0]; }
  function watchCount() { var u = {}; W.folders.forEach(function (f) { f.codes.forEach(function (c) { u[c] = 1; }); }); return Object.keys(u).length; }
  function wSug() {
    return findCodes(WQ, curFolder().codes, 8).map(function (c) { return '<button type="button" data-wadd="' + c + '">+ ' + esc(nameOf(c)) + ' <span class="dim">' + c + '</span></button>'; }).join('');
  }
  function watchRow(c) {
    var s = ST[c], right, sub;
    if (s) {
      right = '<span class="' + cls(s.c) + ' b">' + pct(s.c) + '</span><br><span class="sub">' + px(s.p) + '</span>';
      sub = '<span class="' + cls(s.c) + '">' + sparkFor(c, 12) + '</span> RSI ' + (isNum(s.rsi) ? s.rsi.toFixed(0) : '—') + T(' · 量比 ') + (isNum(s.rv) ? s.rv.toFixed(1) : '—') +
        (s.sig ? T(' · <span class="up">今天信号</span>') : '') + (s.pool ? '' : T(' · <span class="dim">不在股票池</span>'));
    } else {
      var b = DAILY[c];
      if (b === undefined) loadDaily(c).then(function () { if (S.page === 'watch' && !S.code) render(); });
      var last = b && b.length ? b[b.length - 1] : null, prev = b && b.length > 1 ? b[b.length - 2] : null, ch = last && prev ? (last.c / prev.c - 1) * 100 : null;
      right = last ? '<span class="' + cls(ch) + ' b">' + pct(ch) + '</span><br><span class="sub">' + px(last.c) + '</span>' : '<span class="dim">—</span>';
      sub = T('<span class="dim">今天不在报告里 (成交量不够)') + (last ? ' · ' + md(last.d) + T(' 收盘') : '') + '</span>';
    }
    return '<div class="wrow">' + stockBtn(s || { code: c, name: nameOf(c) }, right, sub) + '<button type="button" class="wdel" data-wd="' + c + T('" aria-label="从这个文件夹移除 ') + esc(nameOf(c)) + '">×</button></div>';
  }
  // 文件夹操作都在页面里完成 (不用 prompt / confirm 弹窗：有些手机浏览器会把弹窗挡掉，按了没反应)
  // WF.mode: new 新文件夹 / ren 改名 / del 确认删除 / exp 导出 / imp 导入；WF.code = 在个股页新建时顺便把这支加进去；WF.msg = 提示
  var WF = { mode: null, code: null, msg: '' };
  function wForm(where) {
    var m = WF.mode, f = curFolder(), h = '';
    if (!m || (where === 'quote') !== !!WF.code) return WF.msg && where !== 'quote' ? '<p class="warn">' + esc(WF.msg) + '</p>' : '';
    if (m === 'new' || m === 'ren') h = '<div class="wform"><input id="wf-name" type="text" maxlength="20" autocomplete="off" placeholder="' + (m === 'new' ? T('新文件夹名称，例如 科技、银行') : T('新的名称')) + '" value="' + (m === 'ren' ? esc(f.name) : '') + '">' +
      '<button type="button" class="ok" data-wa="ok">' + (m === 'new' ? T('建立') : T('改名')) + T('</button><button type="button" data-wa="cancel">取消</button></div>');
    else if (m === 'del') h = T('<div class="wform"><span class="dn">删除「') + esc(T(f.name)) + T('」和里面 ') + f.codes.length + T(' 支？</span><button type="button" class="ok bad" data-wa="ok">确认删除</button><button type="button" data-wa="cancel">取消</button></div>');
    else if (m === 'exp') h = T('<div class="wform col"><span class="dim">长按全选、复制，存在备忘录里；以后在「导入」贴回来就能恢复。</span><textarea id="wf-text" rows="4" readonly>') + esc(JSON.stringify({ folders: W.folders })) + T('</textarea><button type="button" data-wa="cancel">完成</button></div>');
    else if (m === 'imp') h = T('<div class="wform col"><span class="dim">贴上之前「导出备份」的整段文字，会取代现在的观察列表。</span><textarea id="wf-text" rows="4" placeholder="{&quot;folders&quot;: …}"></textarea><div><button type="button" class="ok" data-wa="ok">导入</button><button type="button" data-wa="cancel">取消</button></div></div>');
    return h + (WF.msg ? '<p class="warn">' + esc(WF.msg) + '</p>' : '');
  }
  function wSubmit() {
    var m = WF.mode, f = curFolder(), el = document.getElementById(m === 'imp' ? 'wf-text' : 'wf-name'), v = el ? el.value.trim() : '';
    WF.msg = '';
    if (m === 'new') {
      if (!v) { WF.msg = T('请先输入文件夹名称'); return; }
      var id = 'f' + Date.now().toString(36); W.folders.push({ id: id, name: v.slice(0, 20), codes: WF.code ? [WF.code] : [] });
      if (!WF.code) W.cur = id;
    } else if (m === 'ren') { if (!v) { WF.msg = T('名称不能是空的'); return; } f.name = v.slice(0, 20); }
    else if (m === 'del') { if (W.folders.length > 1) { W.folders = W.folders.filter(function (x) { return x.id !== f.id; }); W.cur = W.folders[0].id; } }
    else if (m === 'imp') {
      try {
        var fs = (JSON.parse(v).folders || []).filter(function (x) { return x && x.name && Array.isArray(x.codes); }).map(function (x, i) {
          return { id: 'f' + i + Date.now().toString(36), name: String(x.name).slice(0, 20), codes: x.codes.map(String).filter(function (c) { return /^[0-9A-Z]{4,6}$/.test(c); }) }; });
        if (!fs.length) throw new Error('empty');
        W.folders = fs; W.cur = fs[0].id;
      } catch (e) { WF.msg = T('看不懂这段文字，请贴上完整的导出内容。'); return; }
    }
    WF.mode = null; WF.code = null; saveW();
  }
  function pageWatch() {
    var f = curFolder();
    var tabs = T('<div class="opts wtabs" role="group" aria-label="文件夹">') + W.folders.map(function (x) {
      return '<button type="button" data-wf="' + x.id + '" aria-pressed="' + (x.id === f.id) + '">📁 ' + esc(T(x.name)) + ' ' + x.codes.length + '</button>'; }).join('') +
      T('<button type="button" data-wa="new">＋ 新文件夹</button></div>');
    var add = T('<div class="grep"><label for="w-q">add&gt;</label><input id="w-q" type="search" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="名称或代码，加进「') + esc(f.name) + '」" value="' + esc(WQ) + '"></div>' +
      '<div class="opts" id="w-sug">' + wSug() + '</div>';
    var rows = f.codes.length ? '<div class="rows">' + f.codes.map(watchRow).join('') + '</div>' : T('<p class="dim">这个文件夹还是空的。上面搜索加入，或在个股页点「☆ 文件夹名」。</p>');
    var tools = T('<div class="opts"><button type="button" data-wa="ren">改名</button>') + (W.folders.length > 1 ? T('<button type="button" data-wa="del">删除文件夹</button>') : '') +
      T('<button type="button" data-wa="exp">导出备份</button><button type="button" data-wa="imp">导入</button></div>') +
      T('<p class="dim">观察列表只存在这台设备的浏览器里，换手机或清除网站资料会不见，记得「导出备份」。</p>');
    var topForm = WF.mode === 'new' && !WF.code ? wForm('page') : '', botForm = WF.mode && WF.mode !== 'new' ? wForm('page') : '';
    return pn(T('WATCHLIST 观察列表'), W.folders.length + T(' 个文件夹 · ') + watchCount() + T(' 支'), tabs + topForm) + pn('📁 ' + esc(f.name), f.codes.length + T(' 支'), add + rows + tools + botForm);
  }
  // 个股页上的「收藏到观察列表」：每个文件夹一个开关，可以直接在这里开新文件夹并放进去
  function watchToggles(code) {
    return T('<div class="opts wq" role="group" aria-label="收藏到观察列表"><span class="dim">收藏到</span>') + W.folders.map(function (f) {
      var on = f.codes.indexOf(code) >= 0;
      return '<button type="button" data-wt="' + f.id + '" data-v="' + code + '" aria-pressed="' + on + '">' + (on ? '★ ' : '☆ ') + esc(T(f.name)) + '</button>'; }).join('') +
      '<button type="button" data-wa="new" data-v="' + code + T('">＋ 新文件夹</button></div>') + (WF.mode === 'new' && WF.code === code ? wForm('quote') : '');
  }
  function watchClick(t) {
    var d = t.dataset, f = curFolder();
    if (d.wf) { W.cur = d.wf; WQ = ''; WF.mode = null; WF.msg = ''; }
    else if (d.wadd) { if (f.codes.indexOf(d.wadd) < 0) f.codes.push(d.wadd); WQ = ''; }
    else if (d.wd) { f.codes = f.codes.filter(function (c) { return c !== d.wd; }); }
    else if (d.wt) { var g = W.folders.filter(function (x) { return x.id === d.wt; })[0]; if (g) { var i = g.codes.indexOf(d.v); if (i >= 0) g.codes.splice(i, 1); else g.codes.push(d.v); } }
    else if (d.wa === 'ok') wSubmit();
    else if (d.wa === 'cancel') { WF.mode = null; WF.code = null; WF.msg = ''; }
    else if (d.wa) { WF.mode = d.wa === WF.mode && (d.v || null) === WF.code ? null : d.wa; WF.code = d.v || null; WF.msg = ''; }
    saveW(); render();
    if (WF.mode === 'new' || WF.mode === 'ren' || WF.mode === 'imp') { var el = document.getElementById(WF.mode === 'imp' ? 'wf-text' : 'wf-name'); if (el) el.focus(); }
  }
  function pageBtLedger() {
    var b = D.bt; if (!b) return pn(T('BACKTEST 回测'), '', T('<p class="dim">这次没有回测数据。</p>'));
    var a = b.acct, pos = b.position || 20000, R = function (v) { return isNum(v) ? v / 100 * pos : null; };
    var h = pn(T('SIMULATION 模拟统计'), esc(T(b.name || '')) + T(' · 同时最多 ') + (b.slots || '∞') + T(' 笔 · 每笔模拟 RM') + (pos / 1000) + 'K',
      kv([[T('胜率'), isNum(a.win_rate) ? a.win_rate.toFixed(1) + '%' : '—'], [T('期望值'), pct(a.avg), cls(a.avg)], [T('合计'), rm(R(a.total)), cls(a.total)], [T('最大回撤'), rm(R(a.mdd)), 'dn']], true) +
      kv([[T('已结束 / 进行中'), a.closed + ' / ' + a.open], [T('进行中浮动'), pct(a.open_avg), cls(a.open_avg)], [T('盈亏比'), isNum(a.payoff) ? a.payoff.toFixed(2) : '—'], [T('获利因子'), isNum(a.pf) ? a.pf.toFixed(2) : '—'],
        [T('平均天数'), isNum(a.avg_days) ? a.avg_days + T(' 天') : '—'], [T('最多连亏'), a.max_streak != null ? a.max_streak + T(' 笔') : '—'], [T('最好'), pct(a.best, 1), 'up'], [T('最差'), pct(a.worst, 1), 'dn']]));
    if (b.curve && b.curve.length > 1) h += pn(T('EQUITY 模拟累计'), T('已结束的累计 · ') + md(b.curve[0][0]) + ' ~ ' + md(b.curve[b.curve.length - 1][0]),
      blockChart([0].concat(b.curve.map(function (c) { return R(c[1]); })), { rows: 8, zero: true, label: T('账户资金曲线'), fmt: function (v) { return (v >= 0 ? '+' : '') + (v / 1000).toFixed(1) + 'k'; },
        color: function (v) { return v >= 0 ? 'acc' : 'dn'; }, dates: [md(b.curve[0][0]), md(b.curve[b.curve.length - 1][0])] }));
    var ex = a.exits || {}, tot = Object.keys(ex).reduce(function (s, k) { return s + ex[k]; }, 0) || 1;
    h += pn(T('ENDS 结束原因'), a.closed + T(' 笔'), '<pre class="txt">' + Object.keys(ex).sort(function (x, y) { return ex[y] - ex[x]; }).map(function (k) {
      return cell(esc(EXIT[k] || k), LANG === 'en' ? 12 : 10) + span('acc', meter(ex[k] / tot, 20)) + ' ' + pad(ex[k], 3, true); }).join('\n') + '</pre>');
    var p = b.paper || {}, ps = p.stats || {};
    if (p.trades && p.trades.length) h += pn(T('PAPER 模拟账户'), md(p.start) + T(' 起 · 胜率 ') + (isNum(ps.win_rate) ? ps.win_rate.toFixed(0) + '%' : '—'),
      '<div class="rows">' + p.trades.slice().sort(function (x, y) { return (y.entry_date || '') < (x.entry_date || '') ? -1 : 1; }).map(function (t) {
        var v = t.reason === 'open' ? t.ret : t.net, s = ST[t.code] || { code: t.code, name: t.name };
        return stockBtn(s, '<span class="' + cls(v) + ' b">' + pct(v, 1) + '</span><br><span class="sub">' + rm(R(v)) + '</span>',
          md(t.entry_date) + ' ' + px(t.entry) + ' → ' + px(t.exit) + ' · ' + (EXIT[t.reason] || t.reason) + ' · ' + t.days + T(' 天'));
      }).join('') + '</div>');
    if (b.monthly && b.monthly.length) h += pn(T('EVERY 每个信号都计入'), (b.every && b.every.closed) + T(' 笔 · 胜 ') + (b.every && isNum(b.every.win_rate) ? b.every.win_rate.toFixed(0) + '%' : '—') + T(' · 均 ') + pct(b.every && b.every.avg),
      '<pre class="txt">' + span('dim', 'MONTH    N    WIN               AVG') + '\n' + b.monthly.map(function (m) {
        return m[0] + ' ' + pad(m[1], 4, true) + '  ' + span(m[2] >= 50 ? 'up' : m[2] < 30 ? 'dn' : 'acc', meter(m[2] / 100, 10)) + ' ' + pad(m[2].toFixed(0) + '%', 4, true) + ' ' + span(cls(m[3]), pad(pct(m[3], 1), 7, true)); }).join('\n') + '</pre>');
    return h;
  }

  // ---------- 自定义回测：自己选进场条件 / 股票 (一支或几支合计) / 时间，在浏览器里用个股 2 年日线 (../stock/<代码>.json) 重算 ----------
  // 结束条件是后台规则的简化版：涨幅达标、跌破 EMA20 连 2 天、趋势转坏 (Supertrend / SAR 转空 / 放量抛售 / EMA5<EMA20 坏 2 项)、跌幅 %、最长天数
  var CB_RULES = [
    ['sar', T('SAR 转多 (当天翻多)'), 1], ['ema20', T('价格 > EMA20'), 1], ['ema5x20', 'EMA5 > EMA20', 1], ['vol1m', T('成交量 ≥ 1M'), 1],
    ['st', T('Supertrend(3,1.4) < 价格'), 1], ['ema50', T('价格 > EMA50 或 EMA5 > EMA50'), 1],
    ['cross', T('EMA5 上穿 EMA20 (当天)'), 0], ['bbup', T('收盘 > 布林上轨 (20,2)'), 0], ['rv2', T('相对量 ≥ 2'), 0],
    ['rsi50', 'RSI(14) > 50', 0], ['rsi30', 'RSI(14) < 30', 0], ['hi20', T('收盘创 20 日新高'), 0]];
  var CB = (function () {
    var d = { codes: [], from: '', to: '', rules: {}, take: 15, stop: 0, hold: 90, emab: 1, combo: 1, q: '' };
    CB_RULES.forEach(function (r) { d.rules[r[0]] = !!r[2]; });
    try { var j = JSON.parse(localStorage.getItem('bterm_cbt') || 'null'); if (j) Object.keys(d).forEach(function (k) { if (j[k] !== undefined) d[k] = j[k]; }); } catch (e) {}
    d.q = ''; d.res = null; d.busy = false; d.err = '';
    return d;
  })();
  function cbSave() { try { localStorage.setItem('bterm_cbt', JSON.stringify({ codes: CB.codes, from: CB.from, to: CB.to, rules: CB.rules, take: CB.take, stop: CB.stop, hold: CB.hold, emab: CB.emab, combo: CB.combo })); } catch (e) {} }
  var DAILY = {}, PROF = {}, FIN = {};  // 代码 → 日线 [{d,o,h,l,c,v}]；代码 → 公司简介 (stock/<代码>.json 的 profile)
  var DLOAD = {};  // 同一支股票同时只下载一次
  function loadDaily(code) {
    if (code in DAILY) return Promise.resolve(DAILY[code]);
    if (DLOAD[code]) return DLOAD[code];
    return DLOAD[code] = fetch((D.report || '../') + 'stock/' + code + '.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (j) {
      PROF[code] = (j && j.profile) || null; PROF[code + '_name'] = j && j.long_name; FIN[code] = (j && j.fin) || null;
      var b = j && j.bars && j.bars.d, out = null;
      if (b && b.c && b.c.length) {
        var t = b.t0; out = b.c.map(function (_, i) { if (i) t += b.dt[i - 1] * b.u; return { d: new Date(t * 1000).toISOString().slice(0, 10), o: b.o[i] / 1000, h: b.h[i] / 1000, l: b.l[i] / 1000, c: b.c[i] / 1000, v: b.v[i] || 0 }; });
      } else out = bars(code);  // 没有长期日线 → 用终端版的 90 天
      DAILY[code] = out; return out;
    });
  }
  function emaS(a, n) { var k = 2 / (n + 1), e = null; return a.map(function (v) { e = e == null ? v : v * k + e * (1 - k); return e; }); }
  function smaS(a, n) { var s = 0; return a.map(function (v, i) { s += v; if (i >= n) s -= a[i - n]; return i >= n - 1 ? s / n : null; }); }
  function rsiS(c, n) {
    var out = [null], g = 0, l = 0;
    for (var i = 1; i < c.length; i++) {
      var ch = c[i] - c[i - 1], up = Math.max(ch, 0), dn = Math.max(-ch, 0);
      if (i <= n) { g += up / n; l += dn / n; out.push(i === n ? (l ? 100 - 100 / (1 + g / l) : 100) : null); }
      else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; out.push(l ? 100 - 100 / (1 + g / l) : 100); }
    }
    return out;
  }
  function psarS(b) {  // 1 = 多头 (SAR 在价格下面)
    var n = b.length, bull = [1], af = 0.02, up = true, ep = b[0].h, sar = b[0].l;
    for (var i = 1; i < n; i++) {
      sar = sar + af * (ep - sar);
      if (up) {
        sar = Math.min(sar, b[i - 1].l, i > 1 ? b[i - 2].l : b[i - 1].l);
        if (b[i].l < sar) { up = false; sar = ep; ep = b[i].l; af = 0.02; }
        else if (b[i].h > ep) { ep = b[i].h; af = Math.min(0.2, af + 0.02); }
      } else {
        sar = Math.max(sar, b[i - 1].h, i > 1 ? b[i - 2].h : b[i - 1].h);
        if (b[i].h > sar) { up = true; sar = ep; ep = b[i].h; af = 0.02; }
        else if (b[i].l < ep) { ep = b[i].l; af = Math.min(0.2, af + 0.02); }
      }
      bull.push(up ? 1 : 0);
    }
    return bull;
  }
  function stS(b, n, m) {  // Supertrend 线 (多头时在价格下面)
    var tr = b.map(function (x, i) { return i ? Math.max(x.h - x.l, Math.abs(x.h - b[i - 1].c), Math.abs(x.l - b[i - 1].c)) : x.h - x.l; });
    var atr = [], a = null;
    tr.forEach(function (v, i) { a = i < n ? (a == null ? v : a + (v - a) / (i + 1)) : (a * (n - 1) + v) / n; atr.push(a); });
    var out = [], fu = null, fl = null, dir = 1;
    b.forEach(function (x, i) {
      var mid = (x.h + x.l) / 2, bu = mid + m * atr[i], bl = mid - m * atr[i];
      fu = fu == null || bu < fu || b[i - 1].c > fu ? bu : fu;
      fl = fl == null || bl > fl || b[i - 1].c < fl ? bl : fl;
      if (i) dir = x.c > fu ? 1 : x.c < fl ? -1 : dir;
      out.push(dir > 0 ? fl : fu);
    });
    return out;
  }
  function cbStock(code, b, from, to, cost) {
    var c = b.map(function (x) { return x.c; }), v = b.map(function (x) { return x.v; });
    var e5 = emaS(c, 5), e20 = emaS(c, 20), e50 = emaS(c, 50), sar = psarS(b), st = stS(b, 3, 1.4), rsi = rsiS(c, 14), av = smaS(v, 20), sma20 = smaS(c, 20);
    var sd = c.map(function (_, i) { if (i < 19) return null; var m = sma20[i], s = 0; for (var k = i - 19; k <= i; k++) s += (c[k] - m) * (c[k] - m); return Math.sqrt(s / 20); });
    var R = CB.rules, on = CB_RULES.filter(function (r) { return R[r[0]]; }).map(function (r) { return r[0]; });
    function ok(i) {
      if (i < 50) return false;
      return on.every(function (k) {
        switch (k) {
          case 'sar': return sar[i] === 1 && sar[i - 1] === 0;
          case 'ema20': return c[i] > e20[i];
          case 'ema5x20': return e5[i] > e20[i];
          case 'vol1m': return v[i] >= 1e6;
          case 'st': return st[i] < c[i];
          case 'ema50': return c[i] > e50[i] || e5[i] > e50[i];
          case 'cross': return e5[i] > e20[i] && e5[i - 1] <= e20[i - 1];
          case 'bbup': return sd[i] != null && c[i] > sma20[i] + 2 * sd[i];
          case 'rv2': return av[i - 1] > 0 && v[i] >= 2 * av[i - 1];
          case 'rsi50': return rsi[i] > 50;
          case 'rsi30': return rsi[i] != null && rsi[i] < 30;
          case 'hi20': for (var k2 = i - 20; k2 < i; k2++) if (c[k2] >= c[i]) return false; return true;
        }
        return true;
      });
    }
    var trades = [], i = 0;
    while (i < b.length) {
      if (b[i].d < from || b[i].d > to || !ok(i)) { i++; continue; }
      var en = c[i], j = i + 1, why = 'open', below = 0;
      for (; j < b.length; j++) {
        var r = (c[j] / en - 1) * 100;
        if (CB.stop > 0 && r <= -CB.stop) { why = 'stop'; break; }
        if (CB.take > 0 && r >= CB.take) { why = 'take'; break; }
        if (CB.emab) { below = c[j] < e20[j] ? below + 1 : 0; if (below >= 2) { why = 'emab'; break; } }
        if (CB.combo) {
          var bad = (c[j] < st[j] ? 1 : 0) + (sar[j] === 0 && sar[j - 1] === 1 ? 1 : 0) + (c[j] < c[j - 1] && av[j - 1] > 0 && v[j] >= 2 * av[j - 1] ? 1 : 0) + (e5[j] < e20[j] ? 1 : 0);
          if (bad >= 2) { why = 'combo'; break; }
        }
        if (CB.hold > 0 && j - i >= CB.hold) { why = 'time'; break; }
      }
      var x = Math.min(j, b.length - 1), ret = (c[x] / en - 1) * 100;
      trades.push({ code: code, sig: b[i].d, entry: en, exit_date: b[x].d, exit: c[x], days: x - i, reason: why, ret: ret, net: why === 'open' ? ret : ret - cost });
      i = why === 'open' ? b.length : x + 1;  // 同一支卖掉之后才看下一个信号
    }
    return trades;
  }
  function cbStats(tr) {
    var cl = tr.filter(function (t) { return t.reason !== 'open'; }), w = cl.filter(function (t) { return t.net > 0; }), l = cl.filter(function (t) { return t.net <= 0; });
    var sum = function (a) { return a.reduce(function (s, t) { return s + t.net; }, 0); };
    var cum = 0, peak = 0, mdd = 0;
    cl.slice().sort(function (a, b) { return a.exit_date < b.exit_date ? -1 : 1; }).forEach(function (t) { cum += t.net; peak = Math.max(peak, cum); mdd = Math.min(mdd, cum - peak); });
    var aw = w.length ? sum(w) / w.length : null, al = l.length ? sum(l) / l.length : null;
    return { n: tr.length, closed: cl.length, open: tr.length - cl.length, win: cl.length ? w.length / cl.length * 100 : null, avg: cl.length ? sum(cl) / cl.length : null,
      total: sum(cl), mdd: mdd, payoff: aw != null && al ? aw / -al : null, days: cl.length ? cl.reduce(function (s, t) { return s + t.days; }, 0) / cl.length : null };
  }
  function cbRun() {
    if (!CB.codes.length) { CB.err = T('先加至少一支股票'); render(); return; }
    if (!CB_RULES.some(function (r) { return CB.rules[r[0]]; })) { CB.err = T('至少勾一个信号条件'); render(); return; }
    CB.busy = true; CB.err = ''; CB.res = null; render();
    var cost = (D.bt && isNum(D.bt.cost)) ? D.bt.cost : 0.5;
    Promise.all(CB.codes.map(loadDaily)).then(function (all) {
      var first = null, last = null, per = [], trades = [];
      CB.codes.forEach(function (code, k) {
        var b = all[k];
        if (!b || b.length < 60) { per.push({ code: code, none: true }); return; }
        if (!first || b[0].d < first) first = b[0].d; if (!last || b[b.length - 1].d > last) last = b[b.length - 1].d;
        var t = cbStock(code, b, CB.from || '0000', CB.to || '9999', cost);
        per.push({ code: code, st: cbStats(t), bh: (function () { var s = b.filter(function (x) { return x.d >= (CB.from || '0000') && x.d <= (CB.to || '9999'); }); return s.length > 1 ? (s[s.length - 1].c / s[0].c - 1) * 100 : null; })() });
        trades = trades.concat(t);
      });
      CB.res = { trades: trades.sort(function (a, b) { return a.sig < b.sig ? 1 : -1; }), per: per, all: cbStats(trades), first: first, last: last, cost: cost };
      CB.busy = false; cbSave(); render();
    });
  }
  function cbAdd(codes) { codes.forEach(function (c) { if (c && CB.codes.indexOf(c) < 0 && CB.codes.length < 30) CB.codes.push(c); }); CB.q = ''; cbSave(); render(); }
  function cbPreset(k) {
    var last = D.date || new Date().toISOString().slice(0, 10), d = new Date(last + 'T00:00:00Z');
    if (k === 'all') { CB.from = ''; CB.to = ''; }
    else { d.setUTCMonth(d.getUTCMonth() - { m3: 3, m6: 6, y1: 12 }[k]); CB.from = d.toISOString().slice(0, 10); CB.to = ''; }
    cbSave(); render();
  }
  function cbSug() {
    return findCodes(CB.q, CB.codes, 6).map(function (c) { return '<button type="button" data-cb="add" data-v="' + c + '">+ ' + esc(nameOf(c)) + ' <span class="dim">' + c + '</span></button>'; }).join('');
  }
  function pageCustom() {
    var pos = (D.bt && D.bt.position) || 20000, R = function (v) { return isNum(v) ? v / 100 * pos : null; };
    var name = function (c) { return ST[c] ? ST[c].name : NAMES[c] || c; };
    var stocks = T('<div class="grep"><label for="cb-q">add&gt;</label><input id="cb-q" type="search" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="名称或代码，例如 SUNVIEW" value="') + esc(CB.q) + '"></div>' +
      '<div class="opts" id="cb-sug">' + cbSug() + '</div>' +
      T('<div class="opts"><button type="button" data-cb="add-sig">+ 今天信号股</button><button type="button" data-cb="add-watch">+ 观察列表「') + esc(curFolder().name) + T('」</button><button type="button" data-cb="add-top">+ 成交额前 10</button>') + (CB.codes.length ? T('<button type="button" data-cb="clear">清空</button>') : '') + '</div>' +
      (CB.codes.length ? '<div class="opts">' + CB.codes.map(function (c) { return '<button type="button" class="chip" data-cb="del" data-v="' + c + T('" aria-label="移除 ') + esc(name(c)) + '">' + esc(name(c)) + ' ×</button>'; }).join('') + '</div>' : T('<p class="dim">还没选股票。一支 = 单支回测，几支 = 合计 + 分别列出 (最多 30 支)。</p>'));
    var time = '<div class="opts">' + [['m3', T('3 个月')], ['m6', T('6 个月')], ['y1', T('1 年')], ['all', T('全部 (约 2 年)')]].map(function (p) { return '<button type="button" data-cb="preset" data-v="' + p[0] + '">' + p[1] + '</button>'; }).join('') + '</div>' +
      T('<div class="cb-dates"><label>从 <input type="date" id="cb-from" value="') + esc(CB.from) + T('"></label><label>到 <input type="date" id="cb-to" value="') + esc(CB.to) + '"></label></div>';
    var rules = '<div class="cb-rules">' + CB_RULES.map(function (r) { return '<label><input type="checkbox" data-cbr="' + r[0] + '"' + (CB.rules[r[0]] ? ' checked' : '') + '> ' + esc(r[1]) + '</label>'; }).join('') + T('</div><p class="dim">勾的条件全部同时成立的那天，以收盘价开始计算。默认勾的 6 个 = 后台策略。</p>');
    var exit = '<div class="cb-exit">' + [['take', T('涨幅达到 % 结束'), CB.take], ['stop', T('跌幅达到 % 结束 (0 = 不用)'), CB.stop], ['hold', T('最长天数'), CB.hold]].map(function (x) {
      return '<label>' + x[1] + ' <input type="number" inputmode="decimal" min="0" step="1" data-cbn="' + x[0] + '" value="' + x[2] + '"></label>'; }).join('') +
      '<label><input type="checkbox" data-cbx="emab"' + (CB.emab ? ' checked' : '') + T('> 收盘跌破 EMA20 连 2 天</label><label><input type="checkbox" data-cbx="combo"') + (CB.combo ? ' checked' : '') + T('> 趋势转坏 (Supertrend / SAR / 放量抛售 / EMA5&lt;EMA20 坏 2 项)</label></div>');
    var h = pn(T('STOCKS 回测股票'), CB.codes.length + T(' 支'), stocks) + pn(T('PERIOD 回测时间'), (CB.from || T('最早')) + ' ~ ' + (CB.to || T('最新')), time) +
      pn(T('CONDITIONS 信号条件'), CB_RULES.filter(function (r) { return CB.rules[r[0]]; }).length + T(' 项'), rules) + pn(T('END 结束条件'), '', exit) +
      '<button type="button" class="run" data-cb="run"' + (CB.busy ? ' disabled' : '') + '>' + (CB.busy ? T('计算中…') : T('▶ 运行回测')) + '</button>' + (CB.err ? '<p class="dn">' + esc(CB.err) + '</p>' : '');
    var r = CB.res;
    if (r) {
      var a = r.all;
      h += pn(T('RESULT 结果'), CB.codes.length + T(' 支合计 · ') + md(CB.from || r.first) + ' ~ ' + md(CB.to || r.last) + T(' · 成本 ') + r.cost + '%',
        kv([[T('笔数'), a.n + (a.open ? T(' (进行中 ') + a.open + ')' : '')], [T('胜率'), isNum(a.win) ? a.win.toFixed(1) + '%' : '—'], [T('期望值'), pct(a.avg), cls(a.avg)], [T('合计'), rm(R(a.total)), cls(a.total)]], true) +
        kv([[T('最大回撤'), rm(R(a.mdd)), 'dn'], [T('盈亏比'), isNum(a.payoff) ? a.payoff.toFixed(2) : '—'], [T('平均天数'), isNum(a.days) ? a.days.toFixed(1) + T(' 天') : '—'], [T('每笔'), 'RM' + (pos / 1000) + 'K']]) +
        (a.closed > 1 ? (function () { var cl = r.trades.filter(function (t) { return t.reason !== 'open'; }).sort(function (x, y) { return x.exit_date < y.exit_date ? -1 : 1; }), cum = 0;
          return blockChart([0].concat(cl.map(function (t) { cum += t.net; return R(cum); })), { rows: 6, zero: true, label: T('自定义回测资金曲线'), fmt: function (v) { return (v >= 0 ? '+' : '') + (v / 1000).toFixed(1) + 'k'; },
            color: function (v) { return v >= 0 ? 'acc' : 'dn'; }, dates: [md(cl[0].exit_date), md(cl[cl.length - 1].exit_date)] }); })() : '') +
        (a.n ? '' : T('<p class="dim">这段时间没有任何一天同时满足勾的条件。少勾几个条件或拉长时间试试。</p>')));
      if (r.per.length > 1) h += pn(T('BY STOCK 分别'), '', '<pre class="txt">' + span('dim', cell(T('股票'), 10) + cell(T('笔'), 4, 1) + cell(T('胜率'), 7, 1) + cell(T('合计 RM'), 10, 1) + cell(T('同期涨跌'), 10, 1)) + '\n' +
        r.per.map(function (p) { return '<button type="button" class="nm" data-q="' + p.code + '">' + cell(esc(name(p.code)), 10) + '</button>' + (p.none ? span('dim', T('没有日线')) : pad(p.st.n, 4, true) + pad(isNum(p.st.win) ? p.st.win.toFixed(0) + '%' : '—', 7, true) + span(cls(p.st.total), pad(rm(R(p.st.total)).replace('RM ', ''), 10, true)) + span(cls(p.bh), pad(pct(p.bh, 1), 10, true))); }).join('\n') + '</pre>');
      if (r.trades.length) h += pn(T('TRADES 逐笔'), r.trades.length + T(' 笔 (新到旧)'), '<div class="rows">' + r.trades.slice(0, 60).map(function (t) {
        var s = ST[t.code] || { code: t.code, name: name(t.code) };
        return stockBtn(s, '<span class="' + cls(t.net) + ' b">' + pct(t.net, 1) + '</span><br><span class="sub">' + rm(R(t.net)) + '</span>', md(t.sig) + ' ' + px(t.entry) + ' → ' + px(t.exit) + ' · ' + (EXIT[t.reason] || t.reason) + ' · ' + t.days + T(' 天'));
      }).join('') + '</div>');
    }
    return h;
  }
  function pageBt() {
    var seg = T('<div class="opts seg" role="group" aria-label="回测"><button type="button" data-cb="mode" data-v="ledger" aria-pressed="') + (S.bt !== 'custom') + T('">后台策略</button><button type="button" data-cb="mode" data-v="custom" aria-pressed="') + (S.bt === 'custom') + T('">自定义回测</button></div>');
    return seg + (S.bt === 'custom' ? pageCustom() : pageBtLedger());
  }
  function cbClick(t) {
    var a = t.dataset.cb, v = t.dataset.v;
    if (a === 'mode') { S.bt = v; try { localStorage.setItem('bterm_btmode', v); } catch (e) {} render(); }
    else if (a === 'add') cbAdd([v]);
    else if (a === 'add-sig') cbAdd((D.signals || []).map(function (x) { return x.code; }));
    else if (a === 'add-watch') cbAdd(curFolder().codes);
    else if (a === 'add-top') cbAdd(LIST.filter(function (s) { return s.pool === 1; }).sort(function (x, y) { return (y.to || 0) - (x.to || 0); }).slice(0, 10).map(function (s) { return s.code; }));
    else if (a === 'clear') { CB.codes = []; CB.res = null; cbSave(); render(); }
    else if (a === 'del') { CB.codes = CB.codes.filter(function (c) { return c !== v; }); cbSave(); render(); }
    else if (a === 'preset') cbPreset(v);
    else if (a === 'run') cbRun();
  }
  try { S.bt = localStorage.getItem('bterm_btmode') === 'custom' ? 'custom' : 'ledger'; } catch (e) { S.bt = 'ledger'; }
  var FLT = [['s', 'sar', 'SAR▲', function (s) { return s.sar === 1; }], ['e', 'ema', '>EMA20', function (s) { return isNum(s.ema) && s.p > s.ema; }],
    ['v', 'rv', 'RVOL≥2', function (s) { return s.rv >= 2; }], ['l', 'lo', 'RSI<30', function (s) { return isNum(s.rsi) && s.rsi < 30; }],
    ['h', 'hi', 'RSI>70', function (s) { return s.rsi > 70; }], ['n', 'new', T('今天新进'), function (s) { return s.fresh === 1; }]];
  var SORT = [['o', 'to', T('成交额'), function (s) { return s.to || 0; }], ['c', 'chg', T('涨跌'), function (s) { return s.c || 0; }],
    ['r', 'rv', T('相对量'), function (s) { return s.rv || 0; }], ['i', 'rsi', 'RSI', function (s) { return s.rsi || 0; }]];
  function poolList() {
    var q = S.q.trim().toUpperCase(), fs = FLT.filter(function (f) { return S.flt[f[1]]; }), so = SORT.filter(function (x) { return x[1] === S.sort; })[0];
    return LIST.filter(function (s) { return (q ? (s.name.toUpperCase().indexOf(q) >= 0 || s.code.indexOf(q) >= 0) : s.pool === 1) && fs.every(function (f) { return f[3](s); }); })
      .sort(function (a, b) { return (so[3](a) - so[3](b)) * S.dir; });  // dir -1 = 高到低, 1 = 低到高
  }
  // 同一个排序再按一次 = 换方向 (高到低 ⇄ 低到高)
  function setSort(k) { if (S.sort === k) S.dir = -S.dir; else { S.sort = k; S.dir = -1; } render(); }
  function poolHead() {
    return T('<div class="grep"><label for="grep">grep&gt;</label><input id="grep" type="search" inputmode="search" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="名称或代码 (搜全部)" value="') + esc(S.q) + '"></div>' +
      T('<div class="opts" role="group" aria-label="筛选">') + FLT.map(function (f) { return '<button type="button" data-flt="' + f[1] + '" aria-pressed="' + !!S.flt[f[1]] + '">[' + f[0] + ']' + f[2] + '</button>'; }).join('') + '</div>' +
      T('<div class="opts" role="group" aria-label="排序">') + SORT.map(function (x) { return '<button type="button" data-sort="' + x[1] + '" aria-pressed="' + (S.sort === x[1]) + T('" title="再按一次换方向">[') + x[0] + ']' + x[2] + (S.sort === x[1] ? (S.dir < 0 ? '↓' : '↑') : '') + '</button>'; }).join('') + '</div>';
  }
  function poolBody() {
    var l = poolList(), n = LIST.filter(function (s) { return s.pool === 1; }).length;
    function th(k, t) { var on = S.sort === k; return '<button type="button" class="num th' + (on ? ' on' : '') + '" data-sort="' + k + '">' + (on ? (S.dir < 0 ? '↓' : '↑') : '') + t + '</button>'; }
    var rows = '<div class="grid-pool thead"><span>CODE</span><span>NAME</span><span class="num">LAST</span>' + th('chg', 'CHG%') + th('rv', 'RVOL') + th('rsi', 'RSI') + '<span>30D</span></div>' +
      l.slice(0, S.limit).map(function (s) {
        return '<button type="button" class="row" data-q="' + esc(s.code) + '" style="display:block"><span class="grid-pool"><span class="dim">' + esc(s.code) + '</span><span class="' + (s.pool ? '' : 'dim') + '">' + esc(s.name) + '</span><span class="num">' + px(s.p) + '</span>' +
          '<span class="num ' + cls(s.c) + '">' + pct(s.c, 1).replace('%', '') + '</span><span class="num' + (s.rv >= 2 ? ' warn' : '') + '">' + (isNum(s.rv) ? s.rv.toFixed(1) : '—') + '</span>' +
          '<span class="num">' + (isNum(s.rsi) ? s.rsi.toFixed(0) : '—') + '</span><span class="' + cls(s.c) + '">' + sparkFor(s.code, 12) + (s.fresh ? T(' <span class="acc">新</span>') : '') + (s.sig ? ' <span class="up">SIG</span>' : '') + '</span></span></button>';
      }).join('') + (l.length > S.limit ? T('<button type="button" class="more" data-more="1">→ 再显示 ') + Math.min(50, l.length - S.limit) + T(' 支 (共 ') + l.length + ')</button>' : '');
    return { rows: rows, n: (S.q ? T('搜索 ') + l.length + T(' 支') : l.length + ' / ' + n + T(' 支 · 成交量 ≥ 1M')) };
  }
  function pagePool() {
    var b = poolBody();
    return pn(T('POOL 股票池'), '<span id="pool-n">' + b.n + '</span>', poolHead() + '<div class="rows pool-tbl" id="pool-body">' + b.rows + '</div>');
  }
  // 热力图：成交额最大的股票，一格一支，颜色深浅 = 涨跌幅 (░▒▓█ 四级)，点格子开个股
  // 热力图：成交额最大的 N 支，一格一支，颜色深浅 = 涨跌幅。支数多时格子自动变小，整张图尽量一屏看完 (不是拉成长长一列)
  // 下面的颜色对照可以点：只显示那一档涨跌幅的股票，再点一次取消
  var HEAT_N = [[24, T('前 24')], [50, T('前 50')], [80, T('前 80')], [0, T('股票池全部')]];
  var HEAT_LG = [['d4', '≤-10'], ['d3', '-5'], ['d2', '-2'], ['d1', '-0.5'], ['z0', '0'], ['u1', '+0.5'], ['u2', '+2'], ['u3', '+5'], ['u4', '≥10']];
  var HEAT_TXT = { d4: T('跌 10% 以上'), d3: T('跌 5–10%'), d2: T('跌 2–5%'), d1: T('跌 0.5–2%'), z0: T('±0.5% 以内'), u1: T('涨 0.5–2%'), u2: T('涨 2–5%'), u3: T('涨 5–10%'), u4: T('涨 10% 以上') };
  function heatLevel(c) { var a = Math.abs(c || 0); return a < 0.5 ? 0 : a < 2 ? 1 : a < 5 ? 2 : a < 10 ? 3 : 4; }
  function heatKey(c) { var lv = heatLevel(c); return lv ? (c > 0 ? 'u' : 'd') + lv : 'z0'; }
  function heatmap() {
    var n = S.heat == null ? 50 : S.heat;
    var src = LIST.filter(function (s) { return s.pool === 1 && isNum(s.c); }).sort(function (a, b) { return (b.to || 0) - (a.to || 0); });
    var arr = n ? src.slice(0, n) : src;
    if (!arr.length) return '';
    var cnt = {}; arr.forEach(function (s) { var k = heatKey(s.c); cnt[k] = (cnt[k] || 0) + 1; });
    var hb = S.hb && cnt[S.hb] ? S.hb : null, shown = hb ? arr.filter(function (s) { return heatKey(s.c) === hb; }) : arr;
    var up = arr.filter(function (s) { return s.c > 0; }).length, dn = arr.filter(function (s) { return s.c < 0; }).length;
    var opts = T('<div class="opts" role="group" aria-label="热力图范围">') + HEAT_N.map(function (x) {
      return '<button type="button" data-heat="' + x[0] + '" aria-pressed="' + (n === x[0]) + '">' + x[1] + '</button>'; }).join('') + '</div>';
    var dens = shown.length <= 30 ? 'hm-l' : shown.length <= 60 ? 'hm-m' : shown.length <= 100 ? 'hm-s' : 'hm-xs';
    var cells = shown.map(function (s) {
      return '<button type="button" class="hm-c hm-' + heatKey(s.c) + '" data-q="' + esc(s.code) + '" title="' + esc(s.name) + ' ' + pct(s.c) + T(' · 成交额 RM ') + big(s.to) + '">' +
        '<span class="hm-n">' + esc(s.name) + '</span><span class="hm-p">' + (s.c > 0 ? '+' : '') + s.c.toFixed(1) + '</span></button>';
    }).join('');
    var legend = T('<div class="hm-lg" role="group" aria-label="按涨跌幅筛选">') + HEAT_LG.map(function (x) {
      return '<button type="button" class="hm-' + x[0] + '" data-hb="' + x[0] + '" aria-pressed="' + (hb === x[0]) + '" aria-label="' + HEAT_TXT[x[0]] + ' ' + (cnt[x[0]] || 0) + T(' 支"') + (cnt[x[0]] ? '' : ' disabled') + '>' +
        x[1] + '<small>' + (cnt[x[0]] || 0) + '</small></button>'; }).join('') + '</div>' +
      '<p class="dim hm-tip">' + (hb ? T('只显示「') + HEAT_TXT[hb] + '」' + shown.length + T(' 支 · 再点一次显示全部') : T('点颜色格子 = 只看那一档涨跌幅的股票')) + '</p>';
    return pn(T('HEATMAP 热力图'), T('按成交额 · ▲') + up + ' ▼' + dn, opts + '<div class="hm ' + dens + '">' + cells + '</div>' + legend);
  }
  function pageMkt() {
    var m = D.market || {}, ix = m.index, b = m.breadth, h = '';
    if (ix) h += pn(T('INDEX 大盘'), esc(tr(ix.label)), '<p><b>' + ix.last.toLocaleString('en', { minimumFractionDigits: 2 }) + '</b> <span class="' + cls(ix.chg) + '">' + (ix.chg > 0 ? '+' : '') + ix.chg + ' (' + pct(ix.pct) + ')</span>' + (isNum(m.usd_myr) ? '　<span class="dim">USD/MYR ' + m.usd_myr.toFixed(4) + '</span>' : '') + '</p>' +
      blockChart(ix.spark, { rows: 6, label: ix.label + T(' 近 30 日'), fmt: function (v) { return v.toFixed(0); }, color: function (v, j, a) { return j && a[j] < a[j - 1] ? 'cd' : 'cu'; } }));
    h += heatmap();
    if (b) { var t = b.total || (b.up + b.flat + b.down) || 1;
      h += pn(T('BREADTH 涨跌家数'), T('全市场 ') + t + T(' 支'), '<pre class="txt">' + span('up', pad(T('ADV 涨'), 7) + meter(b.up / t, 24)) + ' ' + b.up + '\n' + span('dim', pad(T('UNCH 平'), 7) + meter(b.flat / t, 24)) + ' ' + b.flat + '\n' + span('dn', pad(T('DEC 跌'), 7) + meter(b.down / t, 24)) + ' ' + b.down +
        '\n' + span('dim', '52W HIGH ' + b.highs + ' · LOW ' + b.lows + (isNum(b.turnover) ? T(' · 成交额 RM ') + big(b.turnover) : '')) + '</pre>'); }
    var liq = LIST.filter(function (s) { return (s.to || 0) >= 1e6; });
    function top(arr, f, n) { return arr.slice().sort(f).slice(0, n); }
    [[T('GAINERS 涨幅'), top(liq.filter(function (s) { return s.c > 0; }), function (a, b) { return b.c - a.c; }, 5)],
      [T('LOSERS 跌幅'), top(liq.filter(function (s) { return s.c < 0; }), function (a, b) { return a.c - b.c; }, 5)],
      [T('ACTIVE 成交额'), top(LIST, function (a, b) { return (b.to || 0) - (a.to || 0); }, 5)]].forEach(function (g) {
      h += pn(g[0], g[0].indexOf('ACTIVE') ? T('成交额 ≥ RM1M') : '', '<div class="rows">' + g[1].map(function (s) { return stockBtn(s, '<span class="' + cls(s.c) + ' b">' + pct(s.c) + '</span><br><span class="sub">' + px(s.p) + '</span>', 'RM ' + big(s.to) + T(' · 量比 ') + (isNum(s.rv) ? s.rv.toFixed(1) : '—')); }).join('') + '</div>');
    });
    var ch = D.changes || [];
    if (ch.length) { var L = { 'new': T('新上市'), renamed: T('改名'), removed: T('下市') };
      h += pn(T('LISTING 名单变动'), T('近 14 天'), '<pre class="txt">' + ch.map(function (e) { return md(e.date) + ' ' + span(e.type === 'removed' ? 'dn' : e.type === 'new' ? 'up' : 'warn', cell(L[e.type] || e.type, 7)) + ' ' + esc(e.symbol.replace('.KL', '')) + ' ' + (e.old ? esc(e.old) + ' → ' : '') + esc(e.name); }).join('\n') + '</pre>'); }
    return h;
  }
  // 公告筛选只有一排：「全部」固定在左边，AI 标记 (📌 / ⚠) 和各分类在右边一条横向滑动；一次选一个 (S.af)
  function pageAnn() {
    var bd = D.board || [];
    if (!bd.length) return pn(T('ANNOUNCEMENTS 公告'), '', T('<p class="dim">最近 14 天报告里的股票没有公告。</p>'));
    loadIntelIx();
    var tg = function (x) { var it = INTEL_IX && INTEL_IX[x.code]; var t = it && it.t ? it.t[annId(x.link)] : null; return t === 'catalyst' ? 'notable' : t; };
    var af = S.af || '';
    var pass = function (x) { return !af || (af === 'notable' || af === 'risk' ? tg(x) === af : x.cat === af); };
    var items = bd.filter(pass), out = '', last = null, lim = S.alim || 40;
    items.slice(0, lim).forEach(function (x) {
      if (x.date !== last) { out += '<p class="dim" style="margin-top:6px">── ' + md(x.date) + ' ──</p>'; last = x.date; }
      out += '<p class="list-ann"><button type="button" data-q="' + esc(x.code) + '" class="' + (x.signal ? 'up' : 'acc') + '">' + esc(x.name) + '</button> <span class="tag dim">' + (CAT[x.cat] || x.cat) + '</span>' + tagChip(tg(x)) + '<a href="' + esc(x.link) + '" target="_blank" rel="noopener">' + esc(x.title) + '</a></p>';
    });
    var chips = [['notable', T('📌 重要事件')], ['risk', T('⚠ 需留意')]].concat(Object.keys(CAT).filter(function (c) { return bd.some(function (x) { return x.cat === c; }); }).map(function (c) { return [c, CAT[c]]; }));
    var btn = function (k, label) { return '<button type="button" data-af="' + k + '" aria-pressed="' + (af === k) + '">' + label + '</button>'; };
    var bar = T('<div class="fbar" role="group" aria-label="筛选公告">') + btn('', T('全部')) + '<div class="fscroll">' + chips.map(function (c) { return btn(c[0], c[1]); }).join('') + '</div></div>' +
      (INTEL_IX ? '' : T('<p class="dim" style="font-size:11px">AI 标记载入中…</p>'));
    if (items.length > lim) out += '<button type="button" class="more" data-amore="1">' + (LANG === 'en' ? '→ show ' + Math.min(40, items.length - lim) + ' more (of ' + items.length + ')' : '→ 再显示 ' + Math.min(40, items.length - lim) + ' 条 (共 ' + items.length + ' 条)') + '</button>';
    return pn(T('ANNOUNCEMENTS 公告'), T('近 14 天 · ') + items.length + T(' 条'), bar + out);
  }


  // ---------- AI 分析 (scripts/company_intel.py 每天收盘后用 DeepSeek 逐家整理，写在 ../intel/)：近况、重要事件 / 留意事项、财报一句、公告标记 ----------
  // 只做中性标记 (📌 = 值得注意的事件，⚠ = 需要留意)，不写「利好」：避免被当成买入信号
  var INTEL = {}, INTEL_IX = null, ixLoading = false;
  var TAG = { notable: ['📌', '', 'tg-note'], catalyst: ['📌', '', 'tg-note'], risk: ['⚠', T('留意'), 'tg-risk'] };
  function loadIntelIx() {
    if (INTEL_IX || ixLoading) return; ixLoading = true;
    fetch((D.report || '../') + 'intel/index.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
      .then(function (j) { INTEL_IX = (j && j.items) || {}; if (S.page === 'ann' && !S.code) render(); });
  }
  function annId(link) { var mm = /(\d+)\D*$/.exec(link || ''); return mm ? mm[1] : null; }
  function tagChip(t) { var x = TAG[t]; return x ? '<span class="tag ' + x[2] + '" title="' + (x[1] || T('重要事件')) + '">' + x[0] + (x[1] ? ' ' + x[1] : '') + '</span>' : ''; }
  // 要显示哪个版本：你刚编辑、还没核对 → 你的版本；已核对合并 → 合并后的；你按了「恢复成自动版本」→ 原本的 AI 版本
  function intelView(code) {
    var r = INTEL[code] && INTEL[code] !== 'loading' ? INTEL[code] : null, o = ovGet(code, 'intel'), own = r && r.owner;
    if (!r && !o) return null;
    if (o && !(own && own.intel_at === o.at && !o.pending)) return { v: Object.assign({}, r || {}, o), state: 'edited', o: o, r: r };
    if (o) return { v: r, state: 'merged', o: o, r: r };
    if (own && own.intel_at && r.ai) return { v: Object.assign({}, r, r.ai), state: 'auto', r: r };
    return { v: r, state: 'auto', r: r };
  }
  function intelPanel(code) {
    if (!(code in INTEL)) {
      INTEL[code] = 'loading';
      fetch((D.report || '../') + 'intel/' + code + '.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
        .then(function (j) { INTEL[code] = j; if (S.code === code) render(); });
    }
    var title = T('AI 分析') + edBtn('intel', code);
    if (INTEL[code] === 'loading') return pn(title, '', '<p class="dim">loading…</p>');
    var iv = intelView(code);
    if (!iv) return pn(title, '', T('<p class="dim">还没分析到这家公司 (每天收盘后陆续补上)。</p>'));
    var r = iv.v, own = iv.r && iv.r.owner, f = r.facts, h = '';
    if (isOwner() && own && (own.conflicts || []).concat(own.unverified || []).length) h += '<div class="own-c">' +
      ((L(own, 'conflicts') || []).length ? T('<p class="warn">⚠ 跟资料不一致 (已按资料改)：</p><ul>') + L(own, 'conflicts').map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '') +
      ((L(own, 'unverified') || []).length ? T('<p class="dim">找不到资料佐证 (保留你的写法)：</p><ul>') + L(own, 'unverified').map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '') +
      T('<p class="dim">只有你 (owner) 看得到这一块。</p></div>');
    if (L(r, 'recent')) h += '<p>' + esc(L(r, 'recent')) + '</p>';
    var nt = L(r, 'notable') || (LANG === 'en' ? [] : r.catalysts) || [], rk = L(r, 'risks') || [];
    if (nt.length || rk.length) h += '<ul class="intel-l">' +
      nt.map(function (x) { return '<li><b>📌</b> ' + esc(x) + '</li>'; }).join('') +
      rk.map(function (x) { return '<li class="tg-risk"><b>⚠</b> ' + esc(x) + '</li>'; }).join('') + '</ul>';
    if (f) h += '<p class="dim intel-f">' + md(f.period) + T(' 季：营收 ') + finNum(f.revenue) + (isNum(f.revenue_yoy) ? T(' (按年 ') + pct(f.revenue_yoy, 1) + ')' : '') +
      T(' · 净利 ') + finNum(f.net_income) + (isNum(f.net_income_yoy) ? T(' (按年 ') + pct(f.net_income_yoy, 1) + ')' : '') + (isNum(f.net_margin) ? T(' · 净利率 ') + f.net_margin + '%' : '') + '</p>';
    if (L(r, 'earnings')) h += '<p>' + esc(L(r, 'earnings')) + '</p>';
    if (LANG === 'en' && r.recent && !r.recent_en) h += '<p class="dim">English version will appear after the next analysis run.</p>';
    var upc = evApply(code, (iv.r && iv.r.events) || []).filter(function (e) { return e.date >= today(); });
    if (upc.length || isOwner()) h += T('<h3 class="fin-h">📅 即将到来') + (isOwner() ? T(' <button type="button" class="ed-b" data-ed="event" data-code="') + esc(code) + T('">＋ 新增</button>') : '') + '</h3>' + upc.slice(0, 8).map(function (e) { var t = CAL_T[e.type] || ['corp', e.type];
      return '<p class="list-ann"><span class="dim">' + md(e.date) + '</span> <span class="cal-t cg-' + t[0] + '">' + t[1] + '</span> ' + esc(L(e, 'what') || '') + (e.src === 'rule' ? T(' <span class="dim">(推算)</span>') : '') + (e.src !== 'rule' ? edBtn('event', code, e) : '') + '</p>'; }).join('');
    var tagged = ((iv.r && iv.r.ann) || []).filter(function (a) { return a.tag !== 'routine'; });
    if (tagged.length) h += T('<h3 class="fin-h">标记的公告 <span class="dim">📌 重要事件 · ⚠ 需留意</span></h3>') + tagged.slice(0, 10).map(function (a) {
      return '<p class="list-ann"><span class="dim">' + md(a.date) + '</span> ' + tagChip(a.tag) + '<a href="' + esc(a.link) + '" target="_blank" rel="noopener">' + esc(a.title) + '</a>' + (L(a, 'why') ? ' <span class="dim">· ' + esc(L(a, 'why')) + '</span>' : '') + '</p>'; }).join('');
    h += T('<p class="dim intel-note">AI 生成 (DeepSeek)') + T('，只整理公开的公告、新闻和财报，可能有错漏，不构成投资建议 · 更新 ') + esc(r.updated || (iv.o && iv.o.at) || '—') + '</p>';
    return pn(title, T('公告 ') + ((iv.r && iv.r.ann) || []).length + T(' · 新闻 ') + ((iv.r && iv.r.news) || []).length, h);
  }

  // ---------- 新股 IPO (ipo_calendar.py：KLSE Screener IPO 页 + 新闻标题里的超额认购 + Yahoo 日线)：日历页顶部 ----------
  // 只列事实 (日期、招股价、认购倍数、首日和至今的价格变化)，不评论好坏；ipo.json 在 /terminal/ 里面，离线也看得到
  var IPO = null, ipoLoading = false;
  function loadIpo() {
    if (IPO || ipoLoading) return; ipoLoading = true;
    fetch('ipo.json?v=' + V).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
      .then(function (j) { IPO = (j && j.ipos) || []; IPO.updated = j && j.updated; if (S.page === 'cal' && !S.code) render(); });
  }
  function ipoBoard(b) { return !b ? '' : /ACE/i.test(b) ? 'ACE' : /LEAP/i.test(b) ? 'LEAP' : /Main/i.test(b) ? 'Main' : b; }
  function ipoPx(v) { return isNum(v) ? 'RM' + (v < 1 ? v.toFixed(3).replace(/0$/, '') : v.toFixed(2)) : '—'; }
  function ipoChg(v, ref) { return isNum(v) && isNum(ref) && ref > 0 ? (v / ref - 1) * 100 : null; }
  function pctS(v) { return isNum(v) && Math.abs(v) >= 100 ? pct(v, 0) : pct(v, 1); }  // 表格格子窄：三位数的百分比不带小数
  function addDays(d, n) { return new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10); }
  function ipoStatus(r, td) {
    if (r.open && td < r.open) return ['dim', T('即将招股')];
    if (r.close && td <= r.close) return ['warn', td === r.close ? T('今天截止') : T('招股中')];
    if (r.ballot && td <= r.ballot) return ['acc', T('待抽签')];
    return ['acc', T('待上市')];
  }
  // IPO 的日期也放进月历 (新上市类别)
  var IPO_T = [['open', 'ipo_open'], ['close', 'ipo_close'], ['ballot', 'ipo_ballot'], ['listing', 'ipo_listing']];
  function ipoEvents(from) {
    var out = [];
    (IPO || []).forEach(function (r) {
      var w = [ipoPx(r.price), ipoBoard(r.board)].filter(Boolean).join(' · ');
      IPO_T.forEach(function (k) {
        if (r[k[0]] && r[k[0]] >= from) out.push({ date: r[k[0]], type: k[1], code: r.code, name: r.ticker, what: w, what_en: w, ipo: 1, link: 'https://www.klsescreener.com/v2/stocks/view/' + r.code });
      });
    });
    return out;
  }
  function ipoName(r) {  // 已经在我们名单里的 → 点了打开个股页；还没上市的只显示名称
    return NAMES[r.code] ? '<button type="button" data-q="' + esc(r.code) + '" class="acc">' + esc(r.ticker) + '</button>' : '<b class="acc">' + esc(r.ticker) + '</b>';
  }
  function ipoPanel() {
    loadIpo();
    if (!IPO) return pn(T('IPO 新股'), '', '<p class="dim">loading…</p>');
    if (!IPO.length) return '';
    var td = today(), yago = addDays(td, -365), ipoWarn = [];
    var LIST0 = IPO.map(function (r) {
      var o = ovGet(r.code, 'ipo'); if (!o) return r;
      var x = Object.assign({}, r, { own: o });
      if (o.oversub != null) { x.oversub = o.oversub; if (isNum(r.oversub) && Math.abs(r.oversub - o.oversub) > 0.01) ipoWarn.push(r.ticker + T('：你填 ') + o.oversub + T('×，自动找到 ') + r.oversub + '×'); }
      if (o.listing) { x.listing = o.listing; if (r.listing && r.listing !== o.listing) ipoWarn.push(r.ticker + T('：你填上市日 ') + md(o.listing) + T('，KLSE Screener 写 ') + md(r.listing)); }
      return x;
    });
    var up = LIST0.filter(function (r) { return !r.listing || r.listing > td; }).sort(function (a, b) { return (a.listing || a.close || '') < (b.listing || b.close || '') ? -1 : 1; });
    var done = LIST0.filter(function (r) { return r.listing && r.listing <= td && r.listing >= yago; }).sort(function (a, b) { return a.listing < b.listing ? 1 : -1; });  // 上市日新到旧
    var h = T('<h3 class="fin-h">招股中 / 待上市 · ') + up.length + '</h3>';
    h += up.length ? up.map(function (r) {
      var st = ipoStatus(r, td), steps = [];
      if (r.open || r.close) steps.push(T('认购 ') + md(r.open) + '–' + md(r.close));
      if (r.ballot) steps.push(T('抽签 ') + md(r.ballot));
      if (r.listing) { var dd = Math.round((Date.parse(r.listing) - Date.parse(td)) / 864e5); steps.push(T('上市 ') + md(r.listing) + ' (' + (dd === 0 ? T('今天') : dd + T(' 天后')) + ')'); }
      var info = [r.sector && r.sector !== r.subsector ? r.sector + ' / ' + r.subsector : r.sector || r.subsector, isNum(r.mcap) ? T('市值 ') + 'RM' + (r.mcap / 1e6).toFixed(0) + 'M' : null].filter(Boolean).join(' · ');
      return '<p class="list-ann ipo-r"><span class="cal-t cg-list">' + st[1] + '</span> ' + ipoName(r) + edBtn('ipo', r.code) + ' <span class="dim">' + esc(r.name) + '</span> · ' + esc([ipoBoard(r.board), ipoPx(r.price)].filter(function (x) { return x && x !== '—'; }).join(' · ')) +
        '<br><span class="dim">' + esc(steps.join(' · ')) + (info ? '<br>' + esc(info) : '') + '</span></p>';
    }).join('') : T('<p class="dim">目前没有招股中或待上市的新股。</p>');
    // 近 12 个月汇总
    var d1 = done.map(function (r) { return ipoChg(r.d1_close, r.price); }).filter(isNum).sort(function (a, b) { return a - b; });
    var subs = done.map(function (r) { return r.oversub; }).filter(isNum);
    var avg = function (a) { return a.reduce(function (s, x) { return s + x; }, 0) / a.length; };
    var stat = [T('近 12 个月 ') + done.length + T(' 家上市')];
    if (subs.length) stat.push(T('平均超额认购 ') + avg(subs).toFixed(1) + T(' 倍') + span('dim', ' (' + subs.length + T(' 家有资料)')));
    if (d1.length) {
      var ups = d1.filter(function (x) { return x > 0; }).length;
      stat.push(T('首日收盘高于招股价 ') + ups + '/' + d1.length + T(' 家') + span('dim', ' (' + Math.round(ups / d1.length * 100) + '%)'));
      stat.push(T('首日收盘平均 ') + span(cls(avg(d1)), pct(avg(d1), 1)) + T(' · 中位数 ') + span(cls(d1[d1.length >> 1]), pct(d1[d1.length >> 1], 1)));
    }
    h += T('<h3 class="fin-h">已上市 · 近 12 个月</h3>') + '<p class="ipo-stat">' + stat.join('<br>') + '</p>';
    if (done.length) {
      var rows = S.ipoAll ? done : done.slice(0, 12);
      var hd = cell(T('股票'), isOwner() ? 12 : 10) + cell(T('上市日'), 6) + cell(T('招股'), 6, true) + cell(T('认购'), 7, true) + cell(T('首日开'), 7, true) + cell(T('首日收'), 7, true) + cell(T('至今'), 7, true);
      h += '<pre class="txt ipo-t"><span class="dim">' + hd + '</span>\n' + rows.map(function (r) {
        var o = ipoChg(r.d1_open, r.price), c = ipoChg(r.d1_close, r.price), n = ipoChg(r.last, r.price);
        return cell(ipoName(r) + edBtn('ipo', r.code), isOwner() ? 12 : 10) + cell(md(r.listing), 6) + cell(isNum(r.price) ? r.price.toFixed(r.price < 1 ? 3 : 2).replace(/0$/, '') : '—', 6, true) +
          cell(isNum(r.oversub) ? r.oversub.toFixed(r.oversub < 100 ? 1 : 0) + '×' : r.under ? T('不足') : '—', 7, true) +
          cell(span(cls(o), pctS(o)), 7, true) + cell(span(cls(c), pctS(c)), 7, true) + cell(span(cls(n), pctS(n)), 7, true);
      }).join('\n') + '</pre>';
      if (done.length > 12) h += '<button type="button" class="more" data-ipo="all">' + (S.ipoAll ? T('收起') : T('全部 ') + done.length + T(' 家')) + '</button>';
    }
    if (isOwner() && ipoWarn.length) h += T('<div class="own-c"><p class="warn">⚠ 你填的跟自动找到的不一样 (页面用你填的)：</p><ul>') + ipoWarn.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + T('</ul><p class="dim">只有你 (owner) 看得到这一块。</p></div>');
    h += T('<p class="dim intel-note">资料：KLSE Screener IPO 页 (日期、招股价、板块)、新闻标题 (超额认购倍数，找不到就留空)、Yahoo Finance 日线 (首日开盘 / 收盘、最新收盘，跟招股价比)。日期以招股书和交易所公告为准。过去的新股表现不代表将来，这里不构成认购或买卖建议 · 更新 ') + esc(IPO.updated || '—') + '</p>';
    return pn(T('IPO 新股'), up.length + T(' 家待上市'), h);
  }

  // ---------- 日历：企业活动日期 (scripts/company_intel.py 用 DeepSeek 从公告内文找出的日期 + 程序按交易所规定算的季报最迟公布日) ----------
  // 分类跟公告页一样：会议 / 派息 / 财报 / 企业 / 新上市；月历上每天的小点 = 那天有哪些类别，点日期看那天的明细
  var CAL = null, calLoading = false;
  var CAL_T = { agm: ['meet', T('常年股东大会')], egm: ['meet', T('特别股东大会')], ex_date: ['div', T('除权 / 除息')], entitlement: ['div', T('截止过户')], payment: ['div', T('派发')],
    results: ['res', T('业绩公布')], results_due: ['res', T('季报最迟公布')], listing: ['list', T('上市')], corporate: ['corp', T('企业活动')],
    ipo_open: ['list', T('IPO 开始认购')], ipo_close: ['list', T('IPO 截止认购')], ipo_ballot: ['list', T('IPO 抽签')], ipo_listing: ['list', T('IPO 上市')] };
  var CAL_G = [['meet', T('会议')], ['div', T('派息')], ['res', T('财报')], ['corp', T('企业')], ['list', T('新上市')]];
  function loadCal() {
    if (CAL || calLoading) return; calLoading = true;
    fetch((D.report || '../') + 'intel/calendar.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
      .then(function (j) { CAL = (j && j.events) || []; CAL.updated = j && j.updated; if (S.page === 'cal' && !S.code) render(); });
  }
  function today() { var d = new Date(Date.now() + 8 * 3600e3); return d.toISOString().slice(0, 10); }  // 马来西亚日期
  function calRow(e) {
    var t = CAL_T[e.type] || ['corp', e.type];
    var nm = e.ipo && !NAMES[e.code] ? '<b class="acc">' + esc(e.name || e.code) + '</b>' : '<button type="button" data-q="' + esc(e.code) + '" class="acc">' + esc(e.name || e.code) + '</button>';
    return '<p class="list-ann cal-r"><span class="cal-t cg-' + t[0] + '">' + t[1] + '</span> ' + nm + ' ' +
      esc(L(e, 'what') || '') + (e.link ? ' <a href="' + esc(e.link) + T('" target="_blank" rel="noopener" aria-label="公告原文">↗</a>') : '') + (e.src === 'rule' ? T(' <span class="dim">(推算)</span>') : '') +
      (e.ipo ? edBtn('ipo', e.code) : e.src !== 'rule' ? edBtn('event', e.code, e) : '') + '</p>';
  }
  function pageCal() {
    loadCal();
    var top = ipoPanel();
    if (!CAL) return top + pn(T('CALENDAR 日历'), '', '<p class="dim">loading…</p>');
    var g = S.calG || '', mine = !!S.calW, wset = {};
    W.folders.forEach(function (f) { f.codes.forEach(function (c) { wset[c] = 1; }); });
    // 公告整理出来的日期 + IPO 日期；同一支同一天的「上市」只留 IPO 那条
    var ipoEv = ipoEvents(addDays(today(), -7)), ipoKey = {};
    ipoEv.forEach(function (e) { if (e.type === 'ipo_listing') ipoKey[e.code + e.date] = 1; });
    var ALL = CAL.filter(function (e) { return !(e.type === 'listing' && ipoKey[e.code + e.date]); });
    var ovCodes = {}; [OV || {}, OVP].forEach(function (o) { Object.keys(o).forEach(function (c) { if (ovGet(c, 'events')) ovCodes[c] = 1; }); });
    Object.keys(ovCodes).forEach(function (c) {  // 管理员的新增 / 更正 / 删除
      ALL = ALL.filter(function (e) { return e.code !== c; }).concat(evApply(c, ALL.filter(function (e) { return e.code === c; })).filter(function (e) { return e.date >= addDays(today(), -7); }));
    });
    ALL = ALL.concat(ipoEv).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    var ev = ALL.filter(function (e) { return (!g || (CAL_T[e.type] || [])[0] === g) && (!mine || wset[e.code]); });
    var btn = function (k, label, on, attr) { return '<button type="button" ' + attr + '="' + k + '" aria-pressed="' + on + '">' + label + '</button>'; };
    var bar = T('<div class="fbar" role="group" aria-label="筛选日历">') + btn('', T('全部'), !g, 'data-calg') + '<div class="fscroll">' +
      CAL_G.map(function (x) { return btn(x[0], '<i class="cal-dot cg-' + x[0] + '"></i>' + x[1], g === x[0], 'data-calg'); }).join('') +
      '<button type="button" data-calw="1" aria-pressed="' + mine + T('">★ 只看观察列表</button></div></div>');
    var td = today(), mon = S.calM || td.slice(0, 7), y = +mon.slice(0, 4), mo = +mon.slice(5, 7);
    var first = new Date(Date.UTC(y, mo - 1, 1)), days = new Date(Date.UTC(y, mo, 0)).getUTCDate(), lead = (first.getUTCDay() + 6) % 7;  // 星期一开头
    var byDay = {}; ev.forEach(function (e) { (byDay[e.date] = byDay[e.date] || []).push(e); });
    var grid = T('<div class="cal-h"><button type="button" data-calm="-1" aria-label="上个月">‹</button><b>') + (LANG === 'en' ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][mo - 1] + ' ' + y : y + T(' 年 ') + mo) + T(' 月</b><button type="button" data-calm="1" aria-label="下个月">›</button></div>') +
      '<div class="cal-g">' + [T('一'), T('二'), T('三'), T('四'), T('五'), T('六'), T('日')].map(function (d) { return '<span class="cal-wd">' + d + '</span>'; }).join('') + '<span></span>'.repeat(lead);
    for (var d = 1; d <= days; d++) {
      var ds = mon + '-' + (d < 10 ? '0' : '') + d, list = byDay[ds] || [], gs = {};
      list.forEach(function (e) { gs[(CAL_T[e.type] || ['corp'])[0]] = 1; });
      grid += '<button type="button" class="cal-d' + (ds === td ? ' today' : '') + (ds === S.calD ? ' sel' : '') + (list.length ? ' has' : '') + '" data-cald="' + ds + '"' + (list.length ? '' : ' tabindex="-1"') +
        ' aria-label="' + mo + T(' 月 ') + d + T(' 日 ') + list.length + T(' 项"><span>') + d + '</span><span class="cal-dots">' + CAL_G.filter(function (x) { return gs[x[0]]; }).map(function (x) { return '<i class="cal-dot cg-' + x[0] + '"></i>'; }).join('') + '</span>' +
        (list.length > 1 ? '<small>' + list.length + '</small>' : '') + '</button>';
    }
    grid += '</div>';
    var listH, sel = S.calD;
    if (sel) {
      var dl = byDay[sel] || [];
      listH = '<h3 class="fin-h">' + md(sel) + ' · ' + dl.length + T(' 项 <button type="button" class="more" data-cald="') + sel + T('">× 看接下来 30 天</button></h3>') + (dl.length ? dl.map(calRow).join('') : T('<p class="dim">这天没有记录。</p>'));
    } else {
      var end = new Date(Date.parse(td + 'T00:00:00Z') + 30 * 864e5).toISOString().slice(0, 10), up = ev.filter(function (e) { return e.date >= td && e.date <= end; }), last = null;
      listH = T('<h3 class="fin-h">接下来 30 天 · ') + up.length + T(' 项</h3>') + (up.length ? up.map(function (e) {
        var h = e.date !== last ? '<p class="dim cal-day">── ' + md(e.date) + ' ' + (LANG === 'en' ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] : ['周日', '周一', '周二', '周三', '周四', '周五', '周六'])[new Date(e.date + 'T00:00:00Z').getUTCDay()] + ' ──</p>' : ''; last = e.date; return h + calRow(e); }).join('') :
        T('<p class="dim">接下来 30 天没有记录') + (mine ? T(' (只看观察列表)') : '') + '。</p>');
    }
    var note = T('<p class="dim intel-note">日期由 AI (DeepSeek) 从公告原文整理，「季报最迟公布」是按交易所规定 (季末后 2 个月内) 推算的最迟日期，不是公司宣布的日期；IPO 日期来自 KLSE Screener。以公告原文为准 · 更新 ') + esc(CAL.updated || '—') + '</p>';
    return top + pn(T('CALENDAR 日历'), ev.length + T(' 项 · 过去 7 天到未来半年'), bar + grid + listH + note);
  }
  function calClick(t) {
    var d = t.dataset;
    if (d.calg !== undefined) S.calG = d.calg || '';
    else if (d.calw) S.calW = !S.calW;
    else if (d.calm) { var m0 = S.calM || today().slice(0, 7), y = +m0.slice(0, 4), mo = +m0.slice(5, 7) + (+d.calm); if (mo < 1) { mo = 12; y--; } if (mo > 12) { mo = 1; y++; } S.calM = y + '-' + (mo < 10 ? '0' : '') + mo; S.calD = null; }
    else if (d.cald) S.calD = S.calD === d.cald ? null : d.cald;
    render();
  }

  // ---------- ✦ AI 问答：每一页右下角的按钮，问题 + 当前页面的资料一起送给 DeepSeek ----------
  // 两种连线方式 (⚙ 设置，只存在这台设备的浏览器)：Worker (worker/ai-proxy.js，密钥在 Cloudflare，推荐) / 自己的 DeepSeek 密钥 (浏览器直接连)
  var AI_SYS = T('你是 Bursa Bot 终端版里的 AI 助手，帮用户看懂马来西亚股票的公开资料。用户的问题后面会附上「当前页面资料」，回答要以这些资料为根据，资料里没有的就说没有，不要编造数字或事件。') +
    T('用简体中文回答，条理清楚、简短；需要时分点。可以解释指标、财报数字的变化、公告在说什么、有哪些需要留意的事项。') +
    T('绝对不要给买入、卖出、持有、加仓、止损、目标价或任何操作建议，也不要预测股价涨跌；用户问「该不该买」时，说明你不能给建议，改为整理相关事实和需要留意的地方。');
  var AI = { open: false, busy: false, msgs: [], ctxKey: null, cfg: (function () { try { return JSON.parse(localStorage.getItem('bterm_ai') || '{}'); } catch (e) { return {}; } })(), setup: false };
  function aiSave() { try { localStorage.setItem('bterm_ai', JSON.stringify(AI.cfg)); } catch (e) {} }
  function aiReady() { return AI.cfg.mode === 'worker' ? !!(AI.cfg.url && AI.cfg.pass) : AI.cfg.mode === 'key' ? !!AI.cfg.key : false; }
  function num(v, d) { return isNum(v) ? +v.toFixed(d == null ? 2 : d) : null; }
  // 当前页面的资料 (送给 AI 当根据)：个股页 = 这支股票的全部资料；其他页 = 今天的大盘 + 这一页的重点
  function aiContext() {
    var m = D.market || {}, ix = m.index, b = m.breadth, c = { 日期: D.date, 更新: D.updated };
    if (ix) c.大盘 = { 指数: ix.label, 点数: ix.last, 涨跌: ix.chg, 涨跌百分比: ix.pct, 近30日: ix.spark };
    if (b) c.涨跌家数 = { 涨: b.up, 平: b.flat, 跌: b.down, 新高: b.highs, 新低: b.lows };
    if (S.code) {
      var code = S.code, s = ST[code], it = INTEL[code], pr = PROF[code], f = FIN[code], ex = EXTRA[code], bd = bars(code) || DAILY[code];
      c.股票 = { 代码: code, 名称: nameOf(code), 全名: PROF[code + '_name'] || null };
      if (s) c.行情 = { 价格: s.p, 涨跌百分比: s.c, 成交量: s.vol, 成交额: s.to, 相对量: s.rv, RSI14: s.rsi, EMA20: s.ema, 五十日线: s.sma, SAR多头: s.sar, ATR百分比: s.atr, 市值: s.mc, 今天信号: !!s.sig, 在股票池: !!s.pool };
      if (bd && bd.length) c.近30日收盘 = bd.slice(-30).map(function (x) { return [x.d, x.c]; });
      var sig = (D.signals || []).filter(function (x) { return x.code === code; })[0], fol = (D.follow || []).filter(function (x) { return x.code === code; })[0];
      if (sig) c.今天信号 = { 条件: sig.why, 风险线: sig.stop, 参考位: sig.target, 消息面: sig.digest };
      if (fol) c.信号跟进 = { 信号日: fol.sig, 信号价: fol.entry, 现价: fol.last, 之后涨跌: fol.ret, 天数: fol.days, 风险线: fol.stop, 状态: fol.status, 趋势检查: fol.hits };
      if (pr) c.公司简介 = { 行业: [pr.sector, pr.industry].filter(Boolean).join(' / '), 介绍: pr.zh || (pr.summary || '').slice(0, 800), 业务: pr.lines };
      if (it && it !== 'loading') c.AI整理 = { 近况: it.recent, 重要事件: it.notable, 需留意: it.risks, 财报: it.earnings, 财报数字: it.facts, 即将到来: (it.events || []).slice(0, 8) };
      if (f && f.quarterly) { var q = f.quarterly, k = Math.max(0, q.periods.length - 5);
        c.季报 = q.periods.slice(k).map(function (p, i) { i += k; return { 季末: p, 营收: (q.revenue || [])[i], 毛利: (q.gross_profit || [])[i], 营业利润: (q.operating_income || [])[i], 净利润: (q.net_income || [])[i], EPS: (q.eps || [])[i], 总负债: (q.total_liabilities || [])[i], 总资产: (q.total_assets || [])[i] }; }); }
      if (ex && ex !== 'loading') { c.公告 = (ex.ann || []).slice(0, 12).map(function (a) { return a.date + ' ' + a.title; }); c.新闻 = (ex.news || []).slice(0, 8).map(function (n) { return n.title + (n.source ? ' (' + n.source + ')' : ''); }); }
    } else {
      var liq = LIST.filter(function (x) { return isNum(x.c) && x.p >= 0.1; });
      var brief = function (x) { return x.name + ' ' + x.code + ' ' + x.p + ' (' + (x.c > 0 ? '+' : '') + x.c + '%)'; };
      c.成交额最大 = liq.slice().sort(function (a, b) { return (b.to || 0) - (a.to || 0); }).slice(0, 12).map(brief);
      c.涨幅最大 = liq.filter(function (x) { return (x.to || 0) >= 1e6; }).sort(function (a, b) { return b.c - a.c; }).slice(0, 8).map(brief);
      c.跌幅最大 = liq.filter(function (x) { return (x.to || 0) >= 1e6; }).sort(function (a, b) { return a.c - b.c; }).slice(0, 8).map(brief);
      c.今天信号 = (D.signals || []).map(function (x) { return x.name + ' ' + x.code + T(' 条件: ') + (x.why || []).join('; '); });
      c.当前页面 = (PAGES.filter(function (p) { return p[0] === S.page; })[0] || [])[1];
      if (S.page === 'ann') c.最近公告 = (D.board || []).slice(0, 25).map(function (x) { return x.date + ' ' + x.name + ': ' + x.title; });
      if (S.page === 'cal' && IPO) c.待上市新股 = IPO.filter(function (r) { return !r.listing || r.listing > today(); }).map(function (r) { return { 代码: r.code, 简称: r.ticker, 名称: r.name, 板块: r.board, 招股价: r.price, 截止认购: r.close, 抽签: r.ballot, 上市: r.listing, 行业: r.sector }; });
      if (S.page === 'cal' && CAL) c.日历 = CAL.filter(function (e) { return e.date >= today(); }).slice(0, 30).map(function (e) { return e.date + ' ' + e.name + ' ' + (CAL_T[e.type] || [])[1] + ' ' + (e.what || ''); });
      if (S.page === 'watch') c.观察列表 = curFolder().codes.map(function (x) { return ST[x] ? brief(ST[x]) : nameOf(x) + ' ' + x; });
    }
    return c;
  }
  function aiChips() {
    if (S.code) return [T('用几句话总结这家公司最近的情况'), T('解释最新一季的财报数字'), T('这些技术指标说明了什么'), T('最近的公告在说什么'), T('有哪些需要留意的地方')];
    if (S.page === 'ann') return [T('今天最值得留意的公告有哪些'), T('把这些公告按类型整理一下')];
    if (S.page === 'cal') return [T('接下来两周有哪些重要日期'), T('哪些公司快要除息')];
    if (S.page === 'watch') return [T('整理我观察列表里股票今天的表现')];
    return [T('今天大盘的情况怎么样'), T('成交额最大的几支股票在发生什么'), T('解释一下今天信号股符合的条件')];
  }
  // AI 回答的可视化：标题、分点、表格 (数字栏位画长条)、涨跌 % 上色、RM 金额突出、提到的股票简称可以点开个股页
  var REVN = null;
  function revNames() { if (!REVN) { REVN = {}; Object.keys(NAMES).forEach(function (c) { var n = String(NAMES[c] || '').toUpperCase(); if (n.length >= 3 && !REVN[n]) REVN[n] = c; }); } return REVN; }
  function aiInline(x) {
    x = esc(x).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
    x = x.replace(/RM\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:百万|亿|万|千|million|billion|mil|bil|[mbkMBK](?![a-z])))?/g, '<span class="ai-num">$&</span>');
    x = x.replace(/([+\-−]?\d[\d,]*(?:\.\d+)?)\s?%/g, function (m0, n) {
      var v = parseFloat(n.replace(/,/g, '').replace('−', '-')); return '<span class="ai-pct' + (/^[+\-−]/.test(n) ? (v > 0 ? ' up' : v < 0 ? ' dn' : '') : '') + '">' + m0 + '</span>'; });
    var rv = revNames();
    return x.replace(/(^|[^\w&\-])([A-Z][A-Z0-9&\-]{2,11})(?![\w&\-])/g, function (m0, pre, w) { var c = rv[w]; return c ? pre + '<button type="button" class="ai-stk" data-q="' + esc(c) + '" title="' + esc(c) + '">' + w + '</button>' : m0; });
  }
  function aiCellNum(v) { var m = /^[^\d+\-−]*([+\-−]?\d[\d,]*(?:\.\d+)?)/.exec(String(v).replace(/<[^>]+>/g, '')); return m ? parseFloat(m[1].replace(/,/g, '').replace('−', '-')) : null; }
  function aiTable(rows) {
    var head = rows[0], body = rows.slice(1); if (!body.length) { body = rows; head = null; }
    var w = Math.max.apply(null, rows.map(function (r) { return r.length; })), num = [];
    for (var j = 0; j < w; j++) { var vals = body.map(function (r) { return aiCellNum(r[j] || ''); }); num[j] = vals.every(function (v) { return v !== null; }) && body.length > 1 ? Math.max.apply(null, vals.map(Math.abs)) || 1 : 0; }
    return '<div class="ai-tw"><table class="ai-t">' + (head ? '<tr>' + head.map(function (c) { return '<th>' + aiInline(c) + '</th>'; }).join('') + '</tr>' : '') + body.map(function (r) {
      return '<tr>' + r.map(function (c, j) { if (!num[j]) return '<td>' + aiInline(c) + '</td>'; var v = aiCellNum(c);
        return '<td class="n"><span class="ai-bar' + (v < 0 ? ' neg' : '') + '" style="width:' + Math.round(Math.abs(v) / num[j] * 100) + '%"></span><span class="ai-bv">' + aiInline(c) + '</span></td>'; }).join('') + '</tr>'; }).join('') + '</table></div>';
  }
  function aiFmt(t) {
    var out = [], list = null, tbl = null;
    function flushL() { if (list) { out.push('<' + list.t + ' class="ai-ul">' + list.items.join('') + '</' + list.t + '>'); list = null; } }
    function flushT() { if (tbl) { out.push(aiTable(tbl)); tbl = null; } }
    String(t || '').split('\n').forEach(function (raw) {
      var l = raw.replace(/\s+$/, ''), m;
      if (/^\s*\|.*\|\s*$/.test(l)) { flushL(); if (/^\s*\|[\s:\-|]+\|\s*$/.test(l)) return; (tbl = tbl || []).push(l.trim().replace(/^\||\|$/g, '').split('|').map(function (c) { return c.trim(); })); return; }
      flushT();
      if ((m = /^\s*(?:[-*•·]|(\d+)[.)、])\s+(.*)$/.exec(l))) { var tg = m[1] ? 'ol' : 'ul'; if (!list || list.t !== tg) { flushL(); list = { t: tg, items: [] }; } list.items.push('<li>' + aiInline(m[2]) + '</li>'); return; }
      flushL();
      if ((m = /^\s*#{1,4}\s*(.+)$/.exec(l))) { out.push('<h4 class="ai-h">' + aiInline(m[1].replace(/\*\*/g, '')) + '</h4>'); return; }
      if (l.trim()) out.push('<p>' + aiInline(l) + '</p>');
    });
    flushL(); flushT();
    return out.join('');
  }

  var AI_ICON = '<svg viewBox="0 0 24 24"><path d="M12 2.5c.6 4.6 2.9 6.9 7.5 7.5-4.6.6-6.9 2.9-7.5 7.5-.6-4.6-2.9-6.9-7.5-7.5 4.6-.6 6.9-2.9 7.5-7.5z"/><path d="M19 15.5c.25 1.9 1.1 2.75 3 3-1.9.25-2.75 1.1-3 3-.25-1.9-1.1-2.75-3-3 1.9-.25 2.75-1.1 3-3z"/></svg>';
  // ---------- 🎨 自定义界面：预设主题 / 用一句话叫 AI 设计 (配色、字号、圆角、玻璃感)，即时预览，存在这台设备 ----------
  var THEME_KEYS = ['bg', 'bg2', 'fg', 'mut', 'line', 'acc', 'acc2', 'up', 'dn', 'warn', 'sel'];
  var THEME_PRESETS = [
    { id: 'navy', name: ['深海蓝金', 'Navy & gold'], scheme: 'dark', bg: '#0F1B2D', bg2: '#16263D', fg: '#F4EFE3', mut: '#A9B4C6', line: '#2C4060', acc: '#E3B964', acc2: '#F0CF8A', up: '#6FD39B', dn: '#FF8A8A', warn: '#F2C14E', sel: '#1E3352', font: 13, radius: 10, glass: 0.55 },
    { id: 'paper', name: ['护眼暖色', 'Warm paper'], scheme: 'light', bg: '#F6F0E1', bg2: '#ECE3CF', fg: '#2B2418', mut: '#5F533F', line: '#D6C9AC', acc: '#7A4E14', acc2: '#8F5F22', up: '#2E7D46', dn: '#B23A3A', warn: '#7F5900', sel: '#E6DAC0', font: 14, radius: 8, glass: 0.6 },
    { id: 'contrast', name: ['高对比', 'High contrast'], scheme: 'dark', bg: '#000000', bg2: '#141414', fg: '#FFFFFF', mut: '#D0D0D0', line: '#5A5A5A', acc: '#FFD400', acc2: '#FFE766', up: '#3DFF8B', dn: '#FF6B6B', warn: '#FFD400', sel: '#2A2A2A', font: 15, radius: 0, glass: 0.8 },
    { id: 'forest', name: ['森林绿', 'Forest'], scheme: 'dark', bg: '#13201A', bg2: '#1B2C24', fg: '#ECF3EC', mut: '#A7BBAE', line: '#2F4A3C', acc: '#A8D8A0', acc2: '#C6E8BE', up: '#7EE0A0', dn: '#FF9C8C', warn: '#E8D27D', sel: '#22382D', font: 13, radius: 12, glass: 0.5 }
  ];
  var THEME_SYS = '你是网页界面配色设计师。根据用户的描述，为一个股票资讯终端 (等宽字体、很多数字和表格) 设计一套界面主题。只输出 JSON：' +
    '{"name": 2~6 个字的主题名, "scheme": "dark" 或 "light", "bg": 页面背景, "bg2": 卡片 / 输入框背景, "fg": 主要文字, "mut": 次要文字, "line": 线条和边框, "acc": 标题和强调色, "acc2": 第二强调色 (按钮、链接), ' +
    '"up": 上涨的颜色 (绿色系), "dn": 下跌的颜色 (红色系), "warn": 提醒 (黄 / 橙色系), "sel": 选中项目的背景, "font": 字号 12~17 的整数 (默认 13), "radius": 圆角 0~18 的整数 px (默认 0), "glass": 玻璃感 0~1 (默认 0.6，越小越透明), "note": 一句话说明这套设计}。' +
    '颜色一律用 #RRGGBB。fg 跟 bg 的对比度至少 7:1，mut 至少 4.5:1，up / dn / acc 在 bg 上都要看得清楚。只输出 JSON。';
  var TH = { view: false, prompt: '', busy: false, preview: null, note: '', err: '' };
  function hexOk(v) { return /^#[0-9a-f]{6}$/i.test(v || ''); }
  function lum(h) { return [1, 3, 5].map(function (i) { var v = parseInt(h.substr(i, 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }).reduce(function (a, v, i) { return a + v * [0.2126, 0.7152, 0.0722][i]; }, 0); }
  function contrast(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  // AI 给的主题先检查：颜色格式、数字范围、对比度 (看不清就改成黑 / 白或默认的涨跌色)
  function themeClean(o) {
    if (!o || typeof o !== 'object') return null;
    var t = { name: String(o.name || '').slice(0, 16), note: String(o.note || '').slice(0, 160) };
    if (!hexOk(o.bg) || !hexOk(o.fg)) return null;
    var dark = lum(o.bg) < 0.25, def = dark ? THEME_PRESETS[0] : THEME_PRESETS[1];
    t.scheme = dark ? 'dark' : 'light';
    THEME_KEYS.forEach(function (k) { t[k] = hexOk(o[k]) ? o[k].toUpperCase() : def[k]; });
    var bw = function (bg) { return contrast('#FFFFFF', bg) >= contrast('#000000', bg) ? '#FFFFFF' : '#000000'; };
    if (contrast(t.fg, t.bg) < 7) t.fg = bw(t.bg);
    if (contrast(t.mut, t.bg) < 4.5) t.mut = t.fg;
    ['acc', 'acc2'].forEach(function (k) { if (contrast(t[k], t.bg) < 3) t[k] = t.fg; });
    ['up', 'dn', 'warn'].forEach(function (k) { if (contrast(t[k], t.bg) < 3) t[k] = def[k]; });
    var clamp = function (v, lo, hi, d) { v = Number(v); return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
    t.font = Math.round(clamp(o.font, 12, 17, 13)); t.radius = Math.round(clamp(o.radius, 0, 18, 0)); t.glass = Math.round(clamp(o.glass, 0.25, 0.95, 0.6) * 100) / 100;
    return t;
  }
  function themeVars(t) {
    var v = {}; THEME_KEYS.forEach(function (k) { v[k] = t[k]; });
    v.fc5 = t.acc; v['fin-line'] = t.acc; v.fs = t.font + 'px'; v.r = t.radius + 'px'; v.glass = Math.round(t.glass * 100) + '%';
    return v;
  }
  var THEME_ALL = THEME_KEYS.concat(['fc5', 'fin-line', 'fs', 'r', 'glass']);
  function themeApply(t) {
    var root = document.documentElement, st = root.style;
    THEME_ALL.forEach(function (k) { st.removeProperty('--' + k); }); st.removeProperty('color-scheme'); delete root.dataset.custom;
    if (!t) return;
    var v = themeVars(t); Object.keys(v).forEach(function (k) { st.setProperty('--' + k, v[k]); });
    st.colorScheme = t.scheme; root.dataset.custom = '1';
  }
  function themeSaved() { try { return JSON.parse(localStorage.getItem('bterm_custom_theme') || 'null'); } catch (e) { return null; } }
  function themeStore(t, on) {  // 页面开头的小脚本 (index.html) 也读这一份，所以 vars 先算好存着
    try { if (!t) localStorage.removeItem('bterm_custom_theme'); else localStorage.setItem('bterm_custom_theme', JSON.stringify({ on: on !== false, t: t, vars: themeVars(t) })); } catch (e) {}
  }
  function themeCurrent() { var sv = themeSaved(); return sv && sv.on && sv.t ? sv.t : null; }
  (function () { var c = themeCurrent(); if (c) themeApply(c); })();
  function themeAsk() {
    var q = (TH.prompt || '').trim(); if (!q || TH.busy) return;
    if (!aiReady()) { TH.err = Z('要先在 ⚙ 设置里设好 AI，才能用一句话生成；也可以直接用上面的预设。', 'Set up AI in ⚙ first to generate from a sentence; or use a preset above.'); aiRender(); return; }
    TH.busy = true; TH.err = ''; aiRender();
    var cur = TH.preview || themeCurrent(), user = q + (cur ? Z('\n\n(现在的主题，可以在这个基础上改：', '\n\n(current theme, you may adjust it: ') + JSON.stringify(cur) + ')' : '');
    var req = AI.cfg.mode === 'worker'
      ? fetch(AI.cfg.url.replace(/\/$/, '') + '/theme', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Pass': AI.cfg.pass }, body: JSON.stringify({ prompt: user, lang: LANG }) })
        .then(function (r) { if (r.status === 404 || r.status === 405) throw new Error(Z('Worker 要更新 (重新部署 worker/ai-proxy.js) 才能生成主题', 'Redeploy worker/ai-proxy.js to enable theme generation')); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      : dsFetch(AI.cfg.key, { temperature: 0.7, max_tokens: 600, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: THEME_SYS }, { role: 'user', content: user }] })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (j) { return JSON.parse((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '{}'); });
    req.then(function (o) {
      var t = themeClean(o && o.theme ? o.theme : o);
      if (!t) throw new Error(Z('AI 回传的主题格式不对，再试一次', 'The AI returned an invalid theme; try again'));
      TH.preview = t; TH.note = t.note; themeApply(t);
    }).catch(function (e) { TH.err = e.message; }).then(function () { TH.busy = false; aiRender(); });
  }
  function themeView() {
    var cur = TH.preview || themeCurrent(), sw = function (t) { return ['bg', 'fg', 'acc', 'up', 'dn'].map(function (k) { return '<i style="background:' + t[k] + '"></i>'; }).join(''); };
    var h = '<div class="th">' + '<p class="dim">' + Z('点一个预设，或用一句话描述想要的样子，整个页面会马上变给你看；满意再按保存 (只存在这台设备)。', 'Pick a preset or describe the look in one sentence; the whole page changes right away. Save when you like it (this device only).') + '</p>' +
      '<div class="th-pre">' + '<button type="button" class="th-p" data-th="default"><span class="th-sw"><i style="background:#303030"></i><i style="background:#F8F6F2"></i><i style="background:#D8D0C1"></i><i style="background:#8FD19E"></i><i style="background:#F2949A"></i></span>' + Z('默认', 'Default') + '</button>' +
      THEME_PRESETS.map(function (t) { return '<button type="button" class="th-p" data-th="' + t.id + '"' + (cur && cur.name === t.name[0] ? ' aria-pressed="true"' : '') + '><span class="th-sw">' + sw(t) + '</span>' + t.name[LANG === 'en' ? 1 : 0] + '</button>'; }).join('') + '</div>' +
      '<div class="ai-in"><textarea id="th-q" rows="2" placeholder="' + Z('例如：深蓝配金色，字大一点，圆角多一点', 'e.g. deep blue with gold, larger text, rounder corners') + '">' + esc(TH.prompt) + '</textarea>' +
      '<button type="button" class="ok" data-th="ask"' + (TH.busy ? ' disabled' : '') + '>' + (TH.busy ? '<span class="ai-dots"><i></i><i></i><i></i></span>' : Z('✦ 生成', '✦ Create')) + '</button></div>' +
      '<div class="opts ai-chips">' + [Z('护眼的暖色，字大一点', 'Warm and easy on the eyes, larger text'), Z('像彭博终端：黑底橙字', 'Like a Bloomberg terminal: black and orange'), Z('清爽的浅色，圆角，玻璃感强', 'Light and clean, rounded, strong glass'), Z('深紫配霓虹青', 'Deep purple with neon cyan')].map(function (q) { return '<button type="button" data-th="ex" data-v="' + esc(q) + '">' + esc(q) + '</button>'; }).join('') + '</div>' +
      (TH.err ? '<p class="dn">⚠ ' + esc(TH.err) + '</p>' : '') +
      (cur ? '<div class="th-cur"><span class="th-sw big">' + sw(cur) + '</span><div><b>' + esc(cur.name || Z('自定义', 'Custom')) + '</b> <span class="dim">' + cur.font + 'px · ' + Z('圆角 ', 'radius ') + cur.radius + ' · ' + Z('玻璃 ', 'glass ') + Math.round(cur.glass * 100) + '%</span>' + (TH.note || cur.note ? '<p class="dim">' + esc(TH.note || cur.note) + '</p>' : '') + '</div></div>' : '') +
      '<div class="opts">' + (TH.preview ? '<button type="button" class="ok" data-th="save">' + Z('保存', 'Save') + '</button><button type="button" data-th="cancel">' + Z('取消预览', 'Cancel preview') + '</button>' : '') +
      (themeCurrent() || TH.preview ? '<button type="button" data-th="reset">' + Z('还原默认', 'Back to default') + '</button>' : '') + '</div></div>';
    return h;
  }
  function themeClick(t) {
    var a = t.dataset.th;
    if (a === 'default') { TH.preview = null; TH.note = ''; themeApply(null); themeStore(null); }
    else if (a === 'ask') { var q = document.getElementById('th-q'); TH.prompt = q ? q.value : TH.prompt; themeAsk(); return; }
    else if (a === 'ex') { TH.prompt = t.dataset.v; themeAsk(); return; }
    else if (a === 'save') { if (TH.preview) { themeStore(TH.preview, true); TH.preview = null; } }
    else if (a === 'cancel') { TH.preview = null; TH.note = ''; themeApply(themeCurrent()); }
    else if (a === 'reset') { TH.preview = null; TH.note = ''; themeStore(null); themeApply(null); }
    else { var p = THEME_PRESETS.filter(function (x) { return x.id === a; })[0]; if (p) { TH.preview = Object.assign({}, p, { name: p.name[0], note: '' }); TH.note = ''; themeApply(TH.preview); } }
    aiRender();
  }
  function aiRender() {
    var box = document.getElementById('ai-panel'); if (!box) return;
    var fab0 = document.getElementById('ai-fab'); box.hidden = !AI.open; fab0.setAttribute('aria-expanded', String(AI.open)); fab0.classList.toggle('busy', !!(AI.busy || TH.busy));
    if (!AI.open) return;
    var label = S.code ? nameOf(S.code) + ' ' + S.code : ((PAGES.filter(function (p) { return p[0] === S.page; })[0] || [])[1] || '') + T(' · 今日市场');
    var h = '<div class="ai-top"><span class="ai-logo" aria-hidden="true">' + AI_ICON + '</span><b>' + (TH.view ? Z('自定义界面', 'Customize') : Z('AI 问答', 'Ask AI')) + '</b>' +
      (TH.view ? '<span class="ai-ctx"></span>' : '<span class="ai-ctx" title="' + esc(label) + '">' + esc(label) + '</span>') +
      '<button type="button" data-ai="theme" aria-pressed="' + TH.view + '" title="' + Z('自定义界面', 'Customize the look') + '">🎨</button><button type="button" data-ai="setup" title="' + Z('设置', 'Settings') + '">⚙</button><button type="button" data-ai="close" aria-label="' + Z('关闭', 'Close') + '">×</button></div>';
    if (TH.view && !AI.setup) { h += themeView(); box.innerHTML = h; return; }
    if (AI.setup || !aiReady()) {
      var md0 = AI.cfg.mode || 'worker';
      h += T('<div class="ai-set"><p class="dim">选择连线方式 (只存在这台设备的浏览器)：</p>') +
        '<div class="opts"><button type="button" data-ai="mode" data-v="worker" aria-pressed="' + (md0 === 'worker') + T('">Worker (推荐)</button><button type="button" data-ai="mode" data-v="key" aria-pressed="') + (md0 === 'key') + T('">自己的 DeepSeek 密钥</button></div>') +
        (md0 === 'worker' ? T('<label>Worker 网址<input id="ai-url" type="url" autocomplete="off" placeholder="https://bursa-ai.xxx.workers.dev" value="') + esc(AI.cfg.url || '') + '"></label>' +
          T('<label>通行码<input id="ai-pass" type="password" autocomplete="off" value="') + esc(AI.cfg.pass || '') + T('"></label><p class="dim">设置方法见仓库 worker/README.md：密钥放在 Cloudflare，网页上看不到。</p>') +
          T('<label>编辑通行码 (只有网站管理员需要，可留空)<input id="ai-edit" type="password" autocomplete="off" value="') + esc(AI.cfg.edit || '') + T('"></label><p class="dim">填了之后，AI 资讯、公司简介、日历和 IPO 旁边会出现 ✎，可以用 AI 改写后发布到网站。</p>')
          : T('<label>DeepSeek API 密钥<input id="ai-key" type="password" autocomplete="off" placeholder="sk-…" value="') + esc(AI.cfg.key || '') + T('"></label><p class="dim">密钥只存在这台手机，问问题时浏览器直接连 DeepSeek。建议用另外开的、设了用量上限的密钥。</p>')) +
        T('<div class="opts"><button type="button" class="ok" data-ai="save">保存</button>') + (aiReady() ? T('<button type="button" data-ai="setup">取消</button>') : '') + '</div></div>';
    } else {
      h += '<div class="ai-log" id="ai-log">' + (AI.msgs.length ? AI.msgs.map(function (m) { return '<div class="ai-m ai-' + m.role + '">' + (m.role === 'user' ? esc(m.show || m.content) : aiFmt(m.content) || '<span class="ai-dots"><i></i><i></i><i></i></span>') + '</div>'; }).join('') :
        T('<p class="dim">会把这一页的资料 (价格、指标、财报、公告、AI 整理) 一起交给 AI。可以点下面的问题，或自己输入。</p>')) + '</div>' +
        '<div class="opts ai-chips">' + aiChips().map(function (q) { return '<button type="button" data-ai="ask" data-v="' + esc(q) + '">' + esc(q) + '</button>'; }).join('') + '</div>' +
        T('<div class="ai-in"><textarea id="ai-q" rows="2" placeholder="问 AI… (例如：这家公司的负债高吗？)"></textarea><button type="button" class="ok" data-ai="send"') + (AI.busy ? ' disabled' : '') + '>' + (AI.busy ? '…' : T('发送')) + '</button></div>' +
        T('<p class="dim ai-note">AI 生成，只根据页面资料整理，可能有错漏；不构成投资建议。') + (AI.msgs.length ? T(' <button type="button" class="more" data-ai="clear">清空对话</button>') : '') + '</p>';
    }
    box.innerHTML = h;
    var lg = document.getElementById('ai-log'); if (lg) lg.scrollTop = lg.scrollHeight;
  }
  // DeepSeek (浏览器直接连，用自己的密钥)：模型名称失效时自动换新名称 (从错误信息读出 DeepSeek 现在支持的名称)，记在这台设备
  var DS_URL = 'https://api.deepseek.com/chat/completions', DS_FB = ['deepseek-flash', 'deepseek-v4-flash'];
  function dsModel() { try { return localStorage.getItem('bterm_ds_model') || 'deepseek-chat'; } catch (e) { return 'deepseek-chat'; } }
  function dsFetch(key, payload) {
    var tried = [], todo = [dsModel()].concat(DS_FB);
    function attempt() {
      var model = todo.filter(function (x) { return tried.indexOf(x) < 0; })[0];
      if (!model) return Promise.reject(new Error(T('DeepSeek 模型都不能用 (试过 ') + tried.join(', ') + ')'));
      var body = Object.assign({}, payload, { model: model });
      if (model !== 'deepseek-chat') body.thinking = { type: 'disabled' };  // 新名称默认开思考模式：关掉，直接回答
      return fetch(DS_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify(body) }).then(function (r) {
        if (r.status !== 400 && r.status !== 404) {
          if (r.ok && model !== dsModel()) { try { localStorage.setItem('bterm_ds_model', model); } catch (e) {} }
          return r;
        }
        return r.clone().text().then(function (t) {
          if (!(/model/i.test(t) && /support|not exist|invalid|deprecat|not found/i.test(t))) return r;
          tried.push(model);
          var m = /model names are\s+(.+?)(?:,?\s+but\b|\.|$)/i.exec(t);
          if (m) m[1].split(/,|\band\b/).map(function (x) { return x.replace(/['"\s]/g, ''); }).filter(function (x) { return /^[\w.\-]+$/.test(x); })
            .sort(function (a, b) { return (/flash/.test(a) ? 0 : 1) - (/flash/.test(b) ? 0 : 1); }).forEach(function (x) { if (todo.indexOf(x) < 0) todo.push(x); });
          return attempt();
        });
      });
    }
    return attempt();
  }
  function aiAsk(q) {
    q = (q || '').trim(); if (!q || AI.busy) return;
    var key = S.code || S.page; if (AI.ctxKey !== key) { AI.msgs = []; AI.ctxKey = key; }  // 换了股票 / 页面就开新对话
    var first = !AI.msgs.length, ctx = first ? T('\n\n【当前页面资料】\n') + JSON.stringify(aiContext()) : '';
    AI.msgs.push({ role: 'user', content: q + ctx, show: q }, { role: 'assistant', content: '' });
    AI.busy = true; aiRender();
    var cur = AI.msgs[AI.msgs.length - 1], hist = AI.msgs.slice(0, -1).map(function (m) { return { role: m.role, content: m.content }; });
    var req = AI.cfg.mode === 'worker' ? fetch(AI.cfg.url.replace(/\/$/, ''), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Pass': AI.cfg.pass }, body: JSON.stringify({ messages: hist, lang: LANG }) })
      : dsFetch(AI.cfg.key, { temperature: 0.3, max_tokens: 1200, stream: true, messages: [{ role: 'system', content: AI_SYS }].concat(hist) });
    req.then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error(r.status + (r.status === 401 ? T(' 通行码 / 密钥不对') : r.status === 403 ? T(' 网址不被允许 (检查 ALLOW_ORIGIN)') : r.status === 402 ? T(' DeepSeek 额度不足') : '') + ' ' + t.slice(0, 120)); });
      var rd = r.body.getReader(), dec = new TextDecoder(), buf = '';
      function pump() {
        return rd.read().then(function (x) {
          if (x.done) return;
          buf += dec.decode(x.value, { stream: true });
          var lines = buf.split('\n'); buf = lines.pop();
          lines.forEach(function (ln) {
            ln = ln.trim(); if (ln.indexOf('data:') !== 0) return; var dta = ln.slice(5).trim(); if (dta === '[DONE]') return;
            try { var j = JSON.parse(dta), dl = j.choices && j.choices[0] && j.choices[0].delta; if (dl && dl.content) cur.content += dl.content; } catch (e) {}
          });
          var el = document.querySelectorAll('#ai-log .ai-assistant'); if (el.length) { el[el.length - 1].innerHTML = aiFmt(cur.content); var lg = document.getElementById('ai-log'); lg.scrollTop = lg.scrollHeight; }
          return pump();
        });
      }
      return pump();
    }).catch(function (e) {
      cur.content = (cur.content ? cur.content + '\n\n' : '') + T('⚠ 连线失败：') + e.message + (AI.cfg.mode === 'key' && /fetch|Load failed|NetworkError/i.test(e.message) ? T('\n浏览器可能挡掉直接连线，请改用 Worker 方式 (worker/README.md)。') : '');
    }).then(function () { AI.busy = false; aiRender(); });
  }
  function aiClick(t) {
    var a = t.dataset.ai;
    if (a === 'toggle') { AI.open = !AI.open; }
    else if (a === 'close') AI.open = false;
    else if (a === 'setup') AI.setup = !AI.setup;
    else if (a === 'theme') { TH.view = !TH.view; AI.setup = false; }
    else if (a === 'mode') { AI.cfg.mode = t.dataset.v; AI.setup = true; }
    else if (a === 'save') {
      if (AI.cfg.mode !== 'key') { AI.cfg.mode = 'worker'; AI.cfg.url = (document.getElementById('ai-url') || {}).value || ''; AI.cfg.pass = (document.getElementById('ai-pass') || {}).value || ''; AI.cfg.edit = (document.getElementById('ai-edit') || {}).value || ''; OV = null; ovLoading = false; loadOv(); }
      else AI.cfg.key = (document.getElementById('ai-key') || {}).value || '';
      aiSave(); AI.setup = !aiReady();
    } else if (a === 'clear') AI.msgs = [];
    else if (a === 'ask') { aiAsk(t.dataset.v); return; }
    else if (a === 'send') { var q = document.getElementById('ai-q'); aiAsk(q && q.value); return; }
    aiRender();
  }
  (function () {
    var fab = document.createElement('button'); fab.type = 'button'; fab.id = 'ai-fab'; fab.dataset.ai = 'toggle'; fab.setAttribute('aria-controls', 'ai-panel'); fab.setAttribute('aria-expanded', 'false');
    fab.setAttribute('aria-label', Z('AI 问答', 'Ask AI')); fab.title = Z('AI 问答 (可以拖到别的位置)', 'Ask AI (drag to move)');
    fab.innerHTML = '<span class="fab-ring" aria-hidden="true"></span><span class="fab-ic" aria-hidden="true">' + AI_ICON + '</span><span class="fab-x" aria-hidden="true">×</span>';
    var box = document.createElement('section'); box.id = 'ai-panel'; box.hidden = true; box.setAttribute('aria-label', T('AI 问答'));
    document.body.appendChild(box); document.body.appendChild(fab);
    fabPlace(fabPos(), false); fabDrag(fab);
    window.addEventListener('resize', function () { fabPlace(fabPos(), false); });
  })();
  // 按钮位置：贴左边或右边 + 离底部的高度 (占可用高度的比例)，存在这台设备
  function fabPos() { try { var p = JSON.parse(localStorage.getItem('bterm_fab') || 'null'); if (p && (p.side === 'l' || p.side === 'r') && p.y >= 0 && p.y <= 1) return p; } catch (e) {} return { side: 'r', y: 0 }; }
  function fabBounds() { var bar = window.innerWidth < 780 && !WIDGET ? 84 : 16; return { lo: bar, hi: Math.max(bar, window.innerHeight - 140) }; }
  function fabPlace(p, anim) {
    var fab = document.getElementById('ai-fab'); if (!fab) return;
    var b = fabBounds(), y = b.lo + (b.hi - b.lo) * p.y;
    fab.classList.toggle('fab-anim', !!anim);
    var w = fab.offsetWidth || 52;  // 一律用 left + bottom 的像素值，贴边时才能平滑滑过去
    fab.style.right = 'auto'; fab.style.top = 'auto';
    fab.style.left = (p.side === 'l' ? 12 : window.innerWidth - w - 12) + 'px'; fab.style.bottom = 'calc(' + Math.round(y) + 'px + env(safe-area-inset-bottom, 0px))';
  }
  function fabDrag(fab) {
    var st = null;
    // 按下之后在整个视窗听移动 / 放开：手指一下子就移出按钮范围也跟得上
    fab.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      var r = fab.getBoundingClientRect(); st = { x: e.clientX, y: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top, moved: false, id: e.pointerId };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
    });
    var move = function (e) {
      if (!st || e.pointerId !== st.id) return;
      if (!st.moved && Math.hypot(e.clientX - st.x, e.clientY - st.y) < 8) return;
      if (!st.moved) { st.moved = true; try { fab.setPointerCapture(st.id); } catch (err) {} fab.classList.add('fab-drag'); fab.classList.remove('fab-anim'); }
      var w = fab.offsetWidth, x = Math.max(4, Math.min(window.innerWidth - w - 4, e.clientX - st.dx)), y = Math.max(4, Math.min(window.innerHeight - w - 4, e.clientY - st.dy));
      fab.style.left = x + 'px'; fab.style.bottom = (window.innerHeight - y - w) + 'px';
    };
    var end = function (e) {
      if (!st || e.pointerId !== st.id) return; var s0 = st; st = null;
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end);
      if (!s0.moved) return;
      fab.classList.remove('fab-drag');
      var r = fab.getBoundingClientRect(), b = fabBounds(), fromBottom = window.innerHeight - r.bottom;
      var p = { side: r.left + r.width / 2 < window.innerWidth / 2 ? 'l' : 'r', y: Math.max(0, Math.min(1, (fromBottom - b.lo) / Math.max(1, b.hi - b.lo))) };
      try { localStorage.setItem('bterm_fab', JSON.stringify(p)); } catch (err) {}
      fabPlace(p, true);
      fab.dataset.dragged = '1'; setTimeout(function () { delete fab.dataset.dragged; }, 50);  // 拖完放开不要当成点一下
    };
    fab.addEventListener('click', function (e) { if (fab.dataset.dragged) { e.stopPropagation(); e.preventDefault(); } }, true);
  }
  // ---------- owner 编辑：网站管理员在网页上 (可以用 AI) 修改 AI 资讯 / 公司简介 / 日历 / IPO，经 worker 提交到 docs/terminal/overrides.json ----------
  // 只有在 ✦ AI ⚙ 设置里填了「编辑通行码」才出现 ✎ 按钮；真正的权限检查在 worker (编辑通行码 + GitHub 令牌都在 Cloudflare)。
  // 保存后 GitHub Pages 约 1–2 分钟才更新，这段时间先用这台设备存着的版本 (OVP) 显示，服务器版本追上了就删掉。
  // 资讯 / 日历：下次 scripts/company_intel.py 整理那家公司时，AI 新版本和你的版本会对照公告核对、合并 (结果在 docs/intel/<代码>.json 的 owner)。
  var OV = null, ovLoading = false;
  var OVP = (function () { try { return JSON.parse(localStorage.getItem('bterm_ov_pending') || '{}'); } catch (e) { return {}; } })();
  function ovSavePending() { try { localStorage.setItem('bterm_ov_pending', JSON.stringify(OVP)); } catch (e) {} }
  function isOwner() { return AI.cfg.mode === 'worker' && !!AI.cfg.url && !!AI.cfg.pass && !!AI.cfg.edit; }
  function loadOv() {
    if (OV || ovLoading) return; ovLoading = true;
    fetch('overrides.json?' + (isOwner() ? 't=' + Date.now() : 'v=' + V)).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
      .then(function (j) {
        OV = (j && j.codes) || {};
        Object.keys(OVP).forEach(function (code) {  // 服务器已经是这个版本 (或更新) 的，本地那份就不用了
          Object.keys(OVP[code]).forEach(function (k) {
            var p = OVP[code][k], s = OV[code] && OV[code][k];
            if (p.data ? s && s.at >= p.at : !s) delete OVP[code][k];
          });
          if (!Object.keys(OVP[code]).length) delete OVP[code];
        });
        ovSavePending(); render();
      });
  }
  function ovGet(code, kind) {
    var p = OVP[code] && OVP[code][kind];
    if (p) return p.data ? Object.assign({ at: p.at, pending: 1 }, p.data) : null;
    return (OV && OV[code] && OV[code][kind]) || null;
  }
  // 日历：管理员的新增 / 更正 / 删除套在 AI 整理的事件上 (只在页面上套，calendar.json 本身不改)
  function evApply(code, list) {
    var ops = (ovGet(code, 'events') || {}).items || [];
    if (!ops.length) return list;
    var out = list.slice();
    var same = function (e, ref) { return e.date === ref.date && e.type === ref.type && (!ref.what || (e.what || '') === ref.what); };
    ops.forEach(function (o) {
      var mine = { date: o.date, type: o.type, what: o.what, what_en: o.what_en, link: o.link || null, code: code, name: nameOf(code), src: 'owner', oid: o.id, ref: o.ref || null };
      if (o.op === 'add') { out.push(mine); return; }
      var i = -1;
      out.forEach(function (e, k) { if (i < 0 && e.src !== 'owner' && same(e, o.ref || {})) i = k; });
      if (o.op === 'del') { if (i >= 0) out.splice(i, 1); return; }
      if (i >= 0) out[i] = Object.assign({}, out[i], mine, { link: o.link || out[i].link }); else out.push(mine);  // 原来那条已经不在：照样显示你的版本
    });
    return out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  }
  var EVREG = [];  // 这次画面上每个日历事件的编号 → 事件 (✎ 按钮用)
  function edBtn(kind, code, extra) {
    if (!isOwner()) return '';
    var id = '';
    if (extra) { EVREG.push(extra); id = ' data-ev="' + (EVREG.length - 1) + '"'; }
    return ' <button type="button" class="ed-b" data-ed="' + kind + '" data-code="' + esc(code) + '"' + id + T('" aria-label="编辑">✎</button>');
  }
  var ED_F = {
    intel: [['recent', T('近况'), 'area', 3], ['recent_en', T('近况 (English)'), 'area', 3], ['notable', T('📌 重要事件 (一行一条)'), 'list', 3], ['notable_en', T('重要事件 (English)'), 'list', 3],
      ['risks', T('⚠ 留意事项 (一行一条)'), 'list', 3], ['risks_en', T('留意事项 (English)'), 'list', 3], ['earnings', T('财报'), 'area', 2], ['earnings_en', T('财报 (English)'), 'area', 2],
      ['refs', T('参考资料 (可选：贴公告原文 / 新闻 / 网址，AI 改写和每次核对合并时用来查证。页面上不显示，但会存在仓库公开的 overrides.json 里，不要贴私人资料或整篇付费文章)'), 'area', 4]],
    profile: [['zh', T('中文介绍'), 'area', 4], ['lines', T('业务线 (一行一条)'), 'list', 4], ['lines_en', T('业务线 (English)'), 'list', 4], ['website', T('官网'), 'url']],
    event: [['date', T('日期'), 'date'], ['type', T('类型'), 'type'], ['what', T('内容 (20 字以内)'), 'text'], ['what_en', T('内容 (English)'), 'text'], ['link', T('公告链接 (可选)'), 'url']],
    ipo: [['oversub', T('超额认购倍数'), 'num'], ['src', T('来源网址'), 'url'], ['listing', T('上市日 (更正用，可留空)'), 'date'], ['note', T('备注 (例如：TheStar 11/05)'), 'text']]
  };
  var ED_TITLE = { intel: T('AI 资讯'), profile: T('公司简介'), event: T('日历事件'), ipo: T('新股 IPO') };
  var ED = null;
  function edCurrent(kind, code, ev) {
    if (kind === 'intel') {
      var iv = intelView(code), base = (iv && iv.v) || {}, o = ovGet(code, 'intel');
      var d = {}; ED_F.intel.forEach(function (f) { d[f[0]] = base[f[0]] != null ? base[f[0]] : (f[2] === 'list' ? [] : ''); }); d.refs = (o && o.refs) || '';
      return d;
    }
    if (kind === 'profile') { var p = Object.assign({}, PROF[code] || {}, ovGet(code, 'profile') || {}); return { zh: p.zh || '', lines: p.lines || [], lines_en: p.lines_en || [], website: p.website || '' }; }
    if (kind === 'event') return ev ? { date: ev.date, type: ev.type, what: ev.what || '', what_en: ev.what_en || '', link: ev.link || '' } : { date: today(), type: 'corporate', what: '', what_en: '', link: '' };
    var row = (IPO || []).filter(function (x) { return x.code === code; })[0] || {}, oi = ovGet(code, 'ipo') || {};
    return { oversub: oi.oversub != null ? oi.oversub : row.oversub != null ? row.oversub : '', src: oi.src || '', listing: oi.listing || '', note: oi.note || '' };
  }
  function edOpen(kind, code, ev) {
    AI.open = false; aiRender();
    ED = { kind: kind, code: code, name: nameOf(code), ev: ev || null, data: edCurrent(kind, code, ev), prev: null, changed: {}, note: '', msg: '', err: '', soft: [], hard: [], busy: false };
    edRender();
  }
  function edVal(f, v) { return f[2] === 'list' ? (v || []).join('\n') : v == null ? '' : String(v); }
  function edRead() {  // 表单 → ED.data
    if (!ED) return;
    ED_F[ED.kind].forEach(function (f) {
      var el = document.getElementById('ed-' + f[0]); if (!el) return;
      ED.data[f[0]] = f[2] === 'list' ? el.value.split('\n').map(function (x) { return x.trim(); }).filter(Boolean) : el.value;
    });
    var ins = document.getElementById('ed-ins'), rf = document.getElementById('ed-refs');
    if (ins) ED.ins = ins.value; if (rf) ED.refs = rf.value;
  }
  function edRender() {
    var box = document.getElementById('ed-panel'); if (!box) return;
    box.hidden = !ED; if (!ED) return;
    var tn = CAL_T, k = ED.kind, own = k === 'event' ? ED.ev && ED.ev.src === 'owner' : !!ovGet(ED.code, k === 'event' ? 'events' : k);
    var h = '<div class="ai-top"><b>✎ ' + ED_TITLE[k] + '</b><span class="dim">' + esc(ED.name) + ' ' + esc(ED.code) + '</span><button type="button" data-edx="close" aria-label="' + T('关闭') + '">×</button></div><div class="ed-body">';
    h += T('<p class="dim">更正后按「保存并发布」：经你的 Worker 提交到 GitHub，约 1–2 分钟后所有人看到的就是更正后的资料 (页面上不会标示)。只写事实，不写好坏评价或买卖建议。</p>');
    h += T('<div class="ed-ai"><b>✦ 用 AI 改</b><input id="ed-ins" type="text" placeholder="例如：把近况缩短成两句 / 加上 11/10 公告的合约金额 / 英文跟着中文改" value="') + esc(ED.ins || '') + '">' +
      (k === 'intel' ? '' : T('<textarea id="ed-refs" rows="2" placeholder="参考资料 (可选)：贴公告原文或新闻">') + esc(ED.refs || '') + '</textarea>') +
      '<div class="opts"><button type="button" data-edx="ai"' + (ED.busy ? ' disabled' : '') + '>' + (ED.busy === 'ai' ? T('AI 改写中…') : T('✦ AI 改写')) + '</button>' +
      (ED.prev ? T('<button type="button" data-edx="undo">↩ 撤销 AI 改动</button>') : '') + '</div>' + (ED.note ? '<p class="dim">AI：' + esc(ED.note) + '</p>' : '') + '</div>';
    ED_F[k].forEach(function (f) {
      var v = esc(edVal(f, ED.data[f[0]])), cls = ED.changed[f[0]] ? ' class="chg"' : '', inp;
      if (f[2] === 'area' || f[2] === 'list') inp = '<textarea id="ed-' + f[0] + '" rows="' + f[3] + '"' + cls + '>' + v + '</textarea>';
      else if (f[2] === 'type') inp = '<select id="ed-' + f[0] + '"' + cls + '>' + ['agm', 'egm', 'ex_date', 'entitlement', 'payment', 'results', 'listing', 'corporate'].map(function (t) { return '<option value="' + t + '"' + (ED.data.type === t ? ' selected' : '') + '>' + esc((tn[t] || [, t])[1]) + '</option>'; }).join('') + '</select>';
      else inp = '<input id="ed-' + f[0] + '" type="' + (f[2] === 'num' ? 'number" step="0.01" min="0' : f[2] === 'date' ? 'date' : f[2] === 'url' ? 'url' : 'text') + '" value="' + v + '"' + cls + '>';
      h += '<label>' + f[1] + (ED.changed[f[0]] ? T(' <span class="warn">· AI 改过</span>') : '') + inp + '</label>';
    });
    if (ED.hard.length) h += T('<p class="dn">不能用这些字眼 (会被当成好坏评价或买卖建议)：') + esc(ED.hard.join('、')) + T('。请改写后再保存。</p>');
    if (ED.soft.length) h += T('<p class="warn">这些字眼可能被当成建议：') + esc(ED.soft.join('、')) + T('。如果是在陈述事实 (例如「大股东卖出 500 万股」「董事会建议派息」)，可以确认后保存。</p><div class="opts"><button type="button" data-edx="save-soft">确认是陈述事实，仍然保存</button></div>');
    if (ED.err) h += '<p class="dn">' + esc(ED.err) + '</p>';
    if (ED.msg) h += '<p class="up">' + ED.msg + '</p>';
    h += '<div class="opts ed-act"><button type="button" class="ok" data-edx="save"' + (ED.busy ? ' disabled' : '') + '>' + (ED.busy === 'save' ? T('提交中…') : T('保存并发布')) + '</button>' +
      (k === 'event' && ED.ev ? T('<button type="button" data-edx="del">删除这条</button>') : '') +
      (k !== 'event' && own ? T('<button type="button" data-edx="restore">恢复成自动版本</button>') : '') +
      T('<button type="button" data-edx="close">取消</button></div></div>');
    box.innerHTML = h;
  }
  function edCall(path, body) {
    return fetch(AI.cfg.url.replace(/\/$/, '') + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Pass': AI.cfg.pass, 'X-Edit-Pass': AI.cfg.edit }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return { error: 'HTTP ' + r.status }; }).then(function (j) { if (!r.ok && !j.error) j.error = 'HTTP ' + r.status; return j; }); });
  }
  function edContext() {  // 给 AI 的页面资料：这家公司已有的公告、新闻、财报、日历、IPO
    var r = INTEL[ED.code] && INTEL[ED.code] !== 'loading' ? INTEL[ED.code] : {}, c = {};
    if (r.ann) c.公告 = r.ann.slice(0, 20).map(function (a) { return a.date + ' ' + a.title; });
    if (r.news) c.新闻 = r.news.slice(0, 8).map(function (n) { return (n.date || '') + ' ' + n.title; });
    if (r.facts) c.财报 = r.facts;
    if (r.events) c.日历 = r.events.map(function (e) { return e.date + ' ' + e.type + ' ' + (e.what || ''); });
    if (PROF[ED.code]) c.简介 = { 英文: PROF[ED.code].summary, 行业: PROF[ED.code].industry };
    var ip = (IPO || []).filter(function (x) { return x.code === ED.code; })[0]; if (ip) c.IPO = ip;
    return c;
  }
  function edEventsPayload(remove) {  // 日历：整份「你的更正」清单 (新增 / 更正 / 删除)
    var items = ((ovGet(ED.code, 'events') || {}).items || []).slice(), ev = ED.ev, d = ED.data;
    if (ev && ev.src === 'owner') items = items.filter(function (o) { return o.id !== ev.oid; });
    var ref = ev ? (ev.src === 'owner' ? ev.ref : { date: ev.date, type: ev.type, what: ev.what || '' }) : null;
    if (remove) { if (ref) items.push({ op: 'del', ref: ref }); }
    else items.push(Object.assign({ op: ref ? 'fix' : 'add', date: d.date, type: d.type, what: d.what, what_en: d.what_en, link: d.link }, ref ? { ref: ref } : {}));
    return { items: items };
  }
  function edSave(opts) {
    edRead();
    var kind = ED.kind === 'event' ? 'events' : ED.kind, data;
    if (opts.restore) data = null;
    else if (ED.kind === 'event') data = edEventsPayload(opts.del);
    else data = Object.assign({}, ED.data);
    if (ED.kind === 'ipo' && data) data.oversub = data.oversub === '' ? null : +data.oversub;
    ED.busy = 'save'; ED.err = ED.msg = ''; ED.hard = []; if (!opts.soft) ED.soft = []; edRender();
    edCall('/edit/save', { code: ED.code, name: ED.name, kind: kind, data: data, confirm_soft: !!opts.soft }).then(function (j) {
      ED.busy = false;
      if (j.error) ED.err = T('保存失败：') + j.error;
      else if (!j.ok) { ED.hard = j.hard || []; ED.soft = j.soft || []; }
      else {
        OVP[ED.code] = OVP[ED.code] || {}; OVP[ED.code][kind] = { at: j.at, data: data }; ovSavePending();
        ED.soft = []; ED.msg = T('✓ 已提交 (') + esc((j.commit || '').slice(0, 7)) + T(')，约 1–2 分钟后所有人看得到；这台设备现在就显示新版本。');
        if (ED.kind === 'event') ED.ev = null;
        render();
      }
      edRender();
    }).catch(function (e) { ED.busy = false; ED.err = T('连不上 Worker：') + e.message; edRender(); });
  }
  function edClick(t) {
    var a = t.dataset.edx;
    if (a === 'close') { ED = null; edRender(); return; }
    if (a === 'save') return edSave({});
    if (a === 'save-soft') return edSave({ soft: true });
    if (a === 'del') { if (ED.ev) edSave({ del: true }); return; }
    if (a === 'restore') return edSave({ restore: true });
    if (a === 'undo') { if (ED.prev) { ED.data = ED.prev; ED.prev = null; ED.changed = {}; ED.note = ''; } edRender(); return; }
    if (a === 'ai') {
      edRead();
      if (!(ED.ins || '').trim()) { ED.err = T('先写下要 AI 怎么改。'); edRender(); return; }
      ED.busy = 'ai'; ED.err = ''; edRender();
      var cur = Object.assign({}, ED.data);
      if (ED.kind === 'event' && ED.ev) { cur.op = ED.ev.src === 'owner' ? 'add' : 'fix'; cur.ref = { date: ED.ev.date, type: ED.ev.type }; }
      edCall('/edit/ai', { kind: ED.kind, code: ED.code, name: ED.name, current: cur, instruction: ED.ins, refs: ED.kind === 'intel' ? ED.data.refs : ED.refs, context: edContext() }).then(function (j) {
        ED.busy = false;
        if (j.error) { ED.err = T('AI 改写失败：') + j.error; edRender(); return; }
        ED.prev = Object.assign({}, ED.data); ED.changed = {};
        ED_F[ED.kind].forEach(function (f) {
          var nv = j.proposal[f[0]]; if (nv === undefined) return;
          if (JSON.stringify(nv) !== JSON.stringify(ED.data[f[0]])) ED.changed[f[0]] = 1;
          ED.data[f[0]] = nv;
        });
        ED.note = j.note || ''; ED.hard = j.hard || []; ED.soft = [];
        edRender();
      }).catch(function (e) { ED.busy = false; ED.err = T('连不上 Worker：') + e.message; edRender(); });
    }
  }
  (function () { var box = document.createElement('section'); box.id = 'ed-panel'; box.hidden = true; box.setAttribute('aria-label', T('编辑')); document.body.appendChild(box); })();

  // 个股：字符 K 线 + 数字 + (信号 / 观察列表) + 公告和新闻
  var EXTRA = {};

  // ---------- 财报图 (Yahoo 季报 / 年报)：损益表、盈利能力 (利润率阶梯图)、资产负债 (堆叠柱 + 负债率)、现金流 ----------
  // 版面参考 Datawrapper 的财报表：每个科目一行、每期一格 (格子里一条横条 + 数字)，各期一个颜色
  function finNum(v) {
    if (!isNum(v)) return '—';
    var a = Math.abs(v), sg = v < 0 ? '-' : '';
    return sg + (a >= 1e9 ? (a / 1e9).toFixed(a >= 1e10 ? 1 : 2) + 'B' : a >= 1e6 ? (a / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(0) + 'K' : a.toFixed(a < 10 ? 2 : 0));
  }
  function finPeriods(sec, n) {
    var P = (sec && sec.periods) || [], k = Math.max(0, P.length - n);
    return { idx: P.map(function (_, i) { return i; }).slice(k), lab: P.slice(k) };
  }
  function finTable(sec, idx, labs, rows) {
    rows = rows.filter(function (r) { return idx.some(function (i) { return isNum((sec[r[0]] || [])[i]); }); });
    if (!rows.length) return '';
    var h = '<div class="ft" style="grid-template-columns: ' + (LANG === 'en' ? '7.2em' : '5.5em') + ' repeat(' + idx.length + ', minmax(0, 1fr))"><span></span>' + labs.map(function (l, k) { return '<span class="ft-h"><i class="fc' + (k + 6 - idx.length) + '"></i>' + l + '</span>'; }).join('');
    rows.forEach(function (r) {
      var vals = idx.map(function (i) { return (sec[r[0]] || [])[i]; }), mx = Math.max.apply(null, vals.map(function (v) { return isNum(v) ? Math.abs(v) : 0; })) || 1;
      h += '<span class="ft-l' + (r[2] ? ' b' : '') + '">' + r[1] + '</span>' + vals.map(function (v, k) {
        var w = isNum(v) ? Math.max(2, Math.abs(v) / mx * 100) : 0;
        return '<span class="ft-c"><span class="ft-v">' + (r[3] ? (isNum(v) ? v.toFixed(3) : '—') : finNum(v)) + '</span><span class="ft-bar"><i class="' + (isNum(v) && v < 0 ? 'neg' : 'fc' + (k + 6 - idx.length)) + '" style="width:' + w + '%"></i></span></span>';
      }).join('');
    });
    return h + '</div>';
  }
  // 利润率小图：阶梯面积图，0 线、最高 / 最低刻度
  function stepChart(title, vals, labs) {
    var ok = vals.filter(isNum); if (ok.length < 2) return '';
    var W = 120, H = 70, lo = Math.min(0, Math.min.apply(null, ok)), hi = Math.max(0, Math.max.apply(null, ok)), r = hi - lo || 1, n = vals.length;
    var y = function (v) { return 6 + (hi - v) / r * (H - 12); }, x = function (i) { return i / n * W; }, d = '', a = '', y0 = y(0);
    vals.forEach(function (v, i) { if (!isNum(v)) return; var yy = y(v); d += (d ? 'L' : 'M') + x(i).toFixed(1) + ' ' + yy.toFixed(1) + 'H' + x(i + 1).toFixed(1); a += 'M' + x(i).toFixed(1) + ' ' + y0.toFixed(1) + 'V' + yy.toFixed(1) + 'H' + x(i + 1).toFixed(1) + 'V' + y0.toFixed(1) + 'Z'; });
    var last = ok[ok.length - 1];
    return '<figure class="sc"><figcaption>' + title + ' <b class="' + cls(last) + '">' + last.toFixed(1) + '%</b></figcaption>' +
      '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="' + title + ' ' + vals.map(function (v, i) { return labs[i] + ' ' + (isNum(v) ? v.toFixed(1) + '%' : '—'); }).join('，') + '">' +
      '<path d="' + a + '" style="fill:var(--fin-area)"/><line x1="0" x2="' + W + '" y1="' + y0 + '" y2="' + y0 + '" style="stroke:var(--line);stroke-width:1" vector-effect="non-scaling-stroke"/>' +
      '<path d="' + d + '" style="fill:none;stroke:var(--fin-line);stroke-width:1.5" vector-effect="non-scaling-stroke"/></svg>' +
      '<div class="sc-ax"><span>' + labs[0] + '</span><span>' + labs[labs.length - 1] + '</span></div></figure>';
  }
  // 资产负债：每期一根柱 (高度 = 总资产)，下段负债、上段股东权益，柱顶写资产负债率
  function bsChart(sec, idx, labs) {
    var A = idx.map(function (i) { return (sec.total_assets || [])[i]; }), L = idx.map(function (i) { return (sec.total_liabilities || [])[i]; });
    if (!A.some(isNum) || !L.some(isNum)) return '';
    var mx = Math.max.apply(null, A.filter(isNum)) || 1, W = 300, H = 120, bw = W / idx.length;
    var g = idx.map(function (_, k) {
      if (!isNum(A[k]) || !isNum(L[k])) return '';
      var ha = A[k] / mx * (H - 22), hl = L[k] / mx * (H - 22), x0 = k * bw + bw * 0.18, w = bw * 0.64;
      return '<rect x="' + x0 + '" y="' + (H - ha) + '" width="' + w + '" height="' + (ha - hl) + '" style="fill:var(--fin-eq)"/>' +
        '<rect x="' + x0 + '" y="' + (H - hl) + '" width="' + w + '" height="' + hl + '" style="fill:var(--fin-li)"/>' +
        '<text x="' + (x0 + w / 2) + '" y="' + (H - ha - 5) + '" text-anchor="middle" style="fill:var(--fg);font-size:10px">' + (L[k] / A[k] * 100).toFixed(0) + '%</text>';
    }).join('');
    return T('<p class="fin-sub">资产负债率 <span class="dim">= 总负债 ÷ 总资产</span>　<i class="sw" style="background:var(--fin-li)"></i>负债 <i class="sw" style="background:var(--fin-eq)"></i>股东权益</p>') +
      '<svg class="bs" viewBox="0 0 ' + W + ' ' + H + T('" role="img" aria-label="资产负债率 ') + idx.map(function (_, k) { return labs[k] + ' ' + (isNum(A[k]) && isNum(L[k]) ? (L[k] / A[k] * 100).toFixed(0) + '%' : '—'); }).join('，') + '">' + g + '</svg>' +
      '<div class="ft-x" style="grid-template-columns: repeat(' + idx.length + ', minmax(0, 1fr))">' + labs.map(function (l) { return '<span>' + l + '</span>'; }).join('') + '</div>';
  }
  function finPanel(code) {
    if (!(code in FIN)) return '';  // profilePanel 已经在载入同一个文件
    var f = FIN[code];
    if (!f || !(f.quarterly || f.annual)) return pn(T('FINANCIALS 财报'), '', T('<p class="dim">Yahoo 没有这家公司的财报数据。</p>'));
    var mode = S.fin === 'a' && f.annual && f.annual.periods.length ? 'a' : (f.quarterly && f.quarterly.periods.length ? 'q' : 'a');
    var sec = mode === 'a' ? f.annual : f.quarterly, pp = finPeriods(sec, mode === 'a' ? 4 : 5), idx = pp.idx;
    var labs = pp.lab.map(function (d) { return mode === 'a' ? 'FY' + d.slice(2, 4) : d.slice(2, 4) + '/' + d.slice(5, 7); });
    var cur = f.currency === 'MYR' || !f.currency ? 'RM' : f.currency;
    var seg = T('<div class="opts" role="group" aria-label="财报期间"><button type="button" data-fin="q" aria-pressed="') + (mode === 'q') + '"' + (f.quarterly && f.quarterly.periods.length ? '' : ' disabled') + T('>季报</button>') +
      '<button type="button" data-fin="a" aria-pressed="' + (mode === 'a') + '"' + (f.annual && f.annual.periods.length ? '' : ' disabled') + T('>年报</button></div>');
    var mg = function (k) { return idx.map(function (i) { var r = (sec.revenue || [])[i], v = (sec[k] || [])[i]; return isNum(r) && r && isNum(v) ? v / r * 100 : null; }); };
    var h = seg + T('<h3 class="fin-h">【损益表】<span class="dim">单位 ') + cur + '</span></h3>' +
      finTable(sec, idx, labs, [['revenue', T('营收'), 1], ['gross_profit', T('毛利')], ['operating_income', T('营业利润')], ['net_income', T('净利润'), 1], ['eps', 'EPS', 0, 1]]);
    var sm = stepChart(T('毛利率'), mg('gross_profit'), labs) + stepChart(T('营业利润率'), mg('operating_income'), labs) + stepChart(T('净利率'), mg('net_income'), labs);
    if (sm) h += T('<h3 class="fin-h">【盈利能力】<span class="dim">占营收 %</span></h3><div class="scs">') + sm + '</div>';
    var bs = bsChart(sec, idx, labs);
    if (bs) h += T('<h3 class="fin-h">【资产负债】</h3>') + bs + finTable(sec, idx, labs, [['total_assets', T('总资产')], ['total_liabilities', T('总负债')], ['equity', T('股东权益')], ['cash', T('现金')], ['total_debt', T('总债务')]]);
    var cf = finTable(sec, idx, labs, [['operating_cf', T('经营现金流'), 1], ['capex', T('资本支出')], ['free_cf', T('自由现金流'), 1]]);
    if (cf) h += T('<h3 class="fin-h">【现金流】</h3>') + cf;
    return pn(T('FINANCIALS 财报'), (mode === 'a' ? T('年报') : T('季报')) + ' · Yahoo Finance', h + '<p class="dim fin-note">' + (mode === 'q' ? T('季报每格 = 那一季 (月份 = 季末)。') : '') + T('银行等金融股没有毛利 / 营业利润，会少几行。</p>'));
  }
  // 公司简介：官网、行业、员工、中文背景 + 业务线 (DeepSeek 按 Yahoo 英文介绍写的)，英文原文收在 ➡️ 里
  function profilePanel(code) {
    if (!(code in PROF)) { loadDaily(code).then(function () { if (S.code === code) render(); }); return pn(T('PROFILE 公司简介'), '', '<p class="dim">loading…</p>'); }
    var op = ovGet(code, 'profile'), p = PROF[code];
    if (op) { p = Object.assign({}, p || {}); ['zh', 'website'].forEach(function (k) { if (op[k]) p[k] = op[k]; }); ['lines', 'lines_en'].forEach(function (k) { if (op[k] && op[k].length) p[k] = op[k]; }); }
    if (!p) return pn(T('PROFILE 公司简介') + edBtn('profile', code), '', T('<p class="dim">还没有这家公司的资料 (每天会陆续补上)。</p>'));
    var host = p.website ? p.website.replace(/^https?:\/\//i, '').replace(/\/$/, '') : '';
    var h = (PROF[code + '_name'] ? '<p><b>' + esc(PROF[code + '_name']) + '</b></p>' : '') +
      (p.sector || p.industry ? T('<p><span class="acc">行业</span> ') + esc([p.sector, p.industry].filter(Boolean).join(' / ')) + '</p>' : '') +
      (p.website ? T('<p><span class="acc">官网</span> <a href="') + esc(p.website) + '" target="_blank" rel="noopener">' + esc(host) + ' ↗</a></p>' : '') +
      kv([[T('员工'), isNum(p.employees) ? p.employees.toLocaleString('en') + T(' 人') : '—'], [T('所在地'), esc(p.city || '—')]]);
    if (LANG === 'en') {
      if (p.summary) h += '<p class="prof-en-main">' + esc(p.summary) + '</p>';
      if (p.lines_en && p.lines_en.length) h += '<ul class="prof-lines">' + p.lines_en.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
    } else {
      if (p.zh) h += '<p>' + esc(p.zh) + '</p>' + (p.lines && p.lines.length ? '<ul class="prof-lines">' + p.lines.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '');
      else if (p.summary) h += T('<p class="dim">中文介绍还在生成，先看英文原文：</p>');
      if (p.summary) h += '<details class="info"' + (p.zh ? '' : ' open') + '><summary>English <span class="arw" aria-hidden="true">➡️</span></summary><p class="dim prof-en">' + esc(p.summary) + '</p></details>';
    }
    h += '<p><a href="ir.html?code=' + esc(code) + T('" target="_blank" rel="noopener">IR / ESG 页面 ↗</a></p>');
    return pn(T('PROFILE 公司简介') + edBtn('profile', code), T('来源 Yahoo Finance'), h);
  }
  function pageQuote(code) {
    var s = ST[code];
    if (!s) {  // 不在今天的报告里 (成交量不够)：用个股 2 年日线画图，其余照样显示 (简介、财报、公告、新闻)
      var bd = DAILY[code];
      if (bd === undefined) loadDaily(code).then(function () { if (S.code === code) render(); });
      var lst = bd && bd.length ? bd[bd.length - 1] : null, prv = bd && bd.length > 1 ? bd[bd.length - 2] : null, chg = lst && prv ? (lst.c / prv.c - 1) * 100 : null;
      var hm = T('<button type="button" class="back" data-back="1">← [q] 返回</button>') +
        pn(esc(nameOf(code)), esc(code), (lst ? '<p><b style="font-size:18px">' + px(lst.c) + '</b> <span class="' + cls(chg) + '">' + pct(chg) + '</span>　<span class="dim">' + md(lst.d) + T(' 收盘</span></p>') : '') +
          watchToggles(code) + (bd && bd.length > 5 ? candleChart(bd.slice(-90), { rows: 14, label: nameOf(code) + T(' 日线') }) : '<p class="dim">' + (bd === undefined ? 'loading…' : T('没有日线')) + '</p>') +
          T('<p class="dim">这支股票今天不在报告里 (成交量没达到门槛)，没有指标和信号。</p>'));
      return hm + qTabs(code);
    }
    var sig = (D.signals || []).filter(function (x) { return x.code === code; })[0], fol = (D.follow || []).filter(function (x) { return x.code === code; })[0];
    var h = T('<button type="button" class="back" data-back="1">← [q] 返回</button>');
    h += pn(esc(s.name), esc(code), '<p><b style="font-size:18px">' + px(s.p) + '</b> <span class="' + cls(s.c) + '">' + pct(s.c) + '</span>' + (s.sig ? '　<span class="up">● SIGNAL</span>' : '') + (s.fresh ? T('　<span class="acc">今天新进股票池</span>') : '') + '</p>' + watchToggles(code) +
      chartFor(code, { rows: 14, stop: sig ? sig.stop : fol ? fol.stop : null, target: sig ? sig.target : null, label: s.name + T(' 日线') }) +
      kv([[T('成交量'), big(s.vol)], [T('成交额'), 'RM ' + big(s.to)], [T('相对量'), isNum(s.rv) ? s.rv.toFixed(2) + '×' : '—', s.rv >= 2 ? 'warn' : ''], ['RSI(14)', isNum(s.rsi) ? s.rsi.toFixed(1) : '—'],
        ['EMA20', px(s.ema), isNum(s.ema) ? (s.p > s.ema ? 'up' : 'dn') : ''], [T('50日线'), px(s.sma), isNum(s.sma) ? (s.p > s.sma ? 'up' : 'dn') : ''], ['SAR', s.sar == null ? '—' : s.sar ? T('多头') : T('空头'), s.sar ? 'up' : 'dn'], ['ATR', isNum(s.atr) ? s.atr.toFixed(1) + '%' : '—'],
        [T('市值'), isNum(s.mc) ? 'RM ' + big(s.mc) : '—'], [T('股票池'), s.sig ? T('信号股') : s.pool ? (s.first ? md(s.first) + T(' 起 · ') + s.streak + T(' 天') : T('在池')) : T('不在池')], [T('上市天数'), isNum(s.listed) ? s.listed + T(' 天') : T('> 90 天')], [T('日期'), md(D.date)]]));
    if (sig) h += pn(T('LEVELS 信号参考位'), T('SAR 转多'), kv([[T('信号价'), px(sig.price)], [T('风险线'), px(sig.stop), 'dn'], [T('参考位'), px(sig.target), 'up'], ['R:R', isNum(sig.rr) ? sig.rr.toFixed(1) : '—']]) +
      '<pre class="txt">' + (sig.why || []).map(function (w) { return span('up', '[x]') + ' ' + esc(tr(w)); }).join('\n') + '</pre>' + (L(sig, 'digest') ? T('<p class="digest"><b>消息面&gt;</b> ') + esc(L(sig, 'digest')) + '</p>' : ''));
    else if (fol) h += pn(T('TRACKING 信号跟进'), STN[fol.status], kv([[T('信号日'), md(fol.sig)], [T('信号价'), px(fol.entry)], [T('现价'), px(fol.last)], [T('之后涨跌'), pct(fol.ret, 1), cls(fol.ret)],
      [T('天数'), fol.days + T(' 天')], [T('风险线'), px(fol.stop), 'dn'], [T('距风险线'), isNum(fol.dist) ? fol.dist.toFixed(1) + '%' : '—', fol.dist < 3 ? 'dn' : ''], [T('状态'), fol.status === 'out' ? (EXIT[fol.reason] || fol.reason) : STN[fol.status]]]) +
      (fol.hits && fol.hits.length ? T('<p class="warn">趋势检查: ') + esc(tr(fol.hits.join('、'))) + '</p>' : ''));
    h += qTabs(code);
    return h;
  }
  // 个股页分段 (手机上整页太长)：价格 / 图表一直在上面，下面一次只显示一组；标签条滚动时贴在顶部
  var QT = [['ov', '概况', 'Overview'], ['fin', '财报', 'Financials'], ['hold', '股东', 'Holders'], ['news', '公告 · 新闻', 'Filings · News']];
  function qTabs(code) {
    var ex = EXTRA[code];
    if (!ex) { EXTRA[code] = 'loading'; fetchExtra(code); }
    var t = S.qtab || 'ov', body;
    if (t !== 'ov') profilePanel(code);  // 个股文件 (简介 + 财报) 在这里载入
    var hn = ex && ex.holders ? (ex.holders.holders || []).filter(function (x) { return !x.below && x.pct > 0; }).length : 0, an = ex && ex.ann ? ex.ann.length : 0;
    var cnt = { hold: hn, news: an };
    var bar = '<div class="qtabs" role="tablist" aria-label="' + (LANG === 'en' ? 'Sections' : '分段') + '">' + QT.map(function (q) {
      return '<button type="button" role="tab" data-qt="' + q[0] + '" aria-selected="' + (t === q[0]) + '">' + (LANG === 'en' ? q[2] : q[1]) + (cnt[q[0]] ? ' <small>' + cnt[q[0]] + '</small>' : '') + '</button>'; }).join('') + '</div>';
    if (t === 'fin') body = finPanel(code) + filingsPanel(code);
    else if (t === 'hold') body = holdersPanel(code) || pn(LANG === 'en' ? 'SUBSTANTIAL SHAREHOLDERS' : 'SHAREHOLDERS 主要股东', '', '<p class="dim">' + (ex === 'loading' || !ex ? 'loading…' : LANG === 'en' ? 'No substantial-shareholder filings on record for this company yet.' : '还没有这家公司的主要股东申报资料 (每天会陆续补上)。') + '</p>');
    else if (t === 'news') body = extraPanels(code);
    else body = profilePanel(code) + intelPanel(code) + segPanel(code);
    return bar + '<div class="qbody" role="tabpanel">' + body + '</div>';
  }
  function extraPanels(code) {
    var h = '';
    var ex = EXTRA[code];
    if (!ex) { EXTRA[code] = 'loading'; fetchExtra(code); }
    var ann = ex && ex.ann || [], news = ex && ex.news || [];
    h += pn(T('FILINGS 公告'), ann.length ? ann.length + T(' 条') : '', ex === 'loading' || !ex ? '<p class="dim">loading…</p>' : ann.length ? ann.slice(0, 10).map(function (a) { return '<p class="list-ann"><span class="dim">' + md(a.date) + '</span> <span class="tag dim">' + (CAT[a.cat] || a.cat) + '</span><a href="' + esc(a.link) + '" target="_blank" rel="noopener">' + esc(a.title) + '</a></p>'; }).join('') : T('<p class="dim">没有抓到公告</p>'));
    h += pn(T('NEWS 新闻'), '', ex === 'loading' || !ex ? '<p class="dim">loading…</p>' : news.length ? news.slice(0, 8).map(function (n) { return '<p class="list-ann"><span class="dim">' + (n.time ? md(new Date(n.time * 1000).toISOString().slice(0, 10)) : '') + '</span> <a href="' + esc(n.link) + '" target="_blank" rel="noopener">' + esc(n.title) + '</a> <span class="dim">' + esc(n.source || '') + '</span></p>'; }).join('') : T('<p class="dim">最近没有新闻</p>'));
    return h;
  }
  // ---------- 业务板块动态 / 原始财报文件 / 主要股东 (docs/segments、docs/filings、docs/holders；没有资料的公司不显示) ----------
  function Z(zh, en) { return LANG === 'en' ? en : zh; }
  var SEGK = { expand: ['扩张', 'Expand'], 'new': ['新业务', 'New business'], reduce: ['缩减', 'Scale back'], exit: ['退出', 'Exit'], contract: ['合约', 'Contract'], other: ['其他', 'Other'] };
  function bigN(v) { return isNum(v) ? v.toLocaleString('en', { maximumFractionDigits: Math.abs(v) >= 1e5 ? 0 : 2 }) : '—'; }
  function segPanel(code) {
    var g = EXTRA[code] && EXTRA[code].segments;
    if (!g || !((g.segments || []).length || (g.model_changes || []).length || L(g, 'overview'))) return '';
    var n = 0, h = '';
    if (L(g, 'overview')) h += '<p>' + esc(L(g, 'overview')) + '</p>';
    if ((g.model_changes || []).length) h += '<h3 class="fin-h">' + Z('业务模式变化', 'Business model changes') + '</h3>' + g.model_changes.map(function (x) {
      return '<p class="list-ann"><span class="dim">' + md(x.date) + '</span> ' + esc(L(x, 'text') || x.title) + ' <a href="' + esc(x.link) + '" target="_blank" rel="noopener" title="' + esc(x.title) + '">' + Z('公告', 'filing') + ' ↗</a></p>'; }).join('');
    (g.segments || []).forEach(function (sg) {
      h += '<h3 class="fin-h">▍' + esc(LANG === 'en' ? sg.name_en || sg.name : sg.name || sg.name_en) + (L(sg, 'note') ? '<span class="dim">' + esc(L(sg, 'note')) + '</span>' : '') + '</h3>';
      if ((sg.numbers || []).length) {
        var cur = g.annual && g.annual.fy ? g.annual.fy : Z('今年', 'This yr');
        h += '<pre class="txt">' + sg.numbers.map(function (x) {
          return cell(esc(Z(x.label, x.label_en)), 7) + ' ' + cell(bigN(x.this), 13, true) + span('dim', ' ← ' + pad(bigN(x.prev), 12, true)) + ' ' +
            cell(isNum(x.chg_pct) ? span(cls(x.chg_pct), (x.chg_pct > 0 ? '+' : '') + x.chg_pct.toFixed(1) + '%') : span('dim', '—'), 8, true) + '\n' + span('dim', '        ' + esc(x.unit) + ' · ' + esc(cur) + Z(' 年报第 ', ' AR p.') + x.page + Z(' 页', ''));
        }).join('\n') + '</pre>';
      }
      (sg.actions || []).forEach(function (a) {
        n++;
        h += '<p class="list-ann"><span class="dim">' + md(a.date) + '</span> <span class="tag acc">' + Z((SEGK[a.kind] || SEGK.other)[0], (SEGK[a.kind] || SEGK.other)[1]) + '</span>' +
          esc(L(a, 'text') || a.title) + ' <a href="' + esc(a.link) + '" target="_blank" rel="noopener" title="' + esc(a.title) + '">↗</a></p>';
      });
    });
    if (LANG === 'en' && g.overview && !g.overview_en) h += '<p class="dim">English version will appear after the next update.</p>';
    h += '<p class="dim">' + Z('根据 ' + g.year + ' 年 ' + g.anns + ' 条公告整理 (每条动态都链接原公告)' + (g.annual && g.annual.status === 'ok' ? '；板块数字来自年报分部资料' : '') + '。只描述发生了什么，不代表好坏。',
      'From ' + g.anns + ' filings in ' + g.year + ' (each item links to the filing)' + (g.annual && g.annual.status === 'ok' ? '; segment figures from the annual report' : '') + '. Describes what happened only — not a judgement.') + ' · ' + md(g.updated.slice(0, 10)) + '</p>';
    return pn(Z('SEGMENTS 业务板块动态', 'SEGMENTS'), g.year + (n ? Z(' · ' + n + ' 条', ' · ' + n + ' items') : ''), h);
  }
  function filingsPanel(code) {
    var f = EXTRA[code] && EXTRA[code].filings;
    if (!f || !((f.quarters || []).length || (f.annual || []).length)) return '';
    var fys = {}, add = function (fy) { return fys[fy] || (fys[fy] = { q: {}, ar: null, aa: null }); };
    (f.quarters || []).forEach(function (q) { add(q.fy).q[q.q] = q; });
    // 年报标题的年份 = 那一份年报的财政年度；经审计账目标题写期末日期 (例如 31 Aug 2025)
    (f.annual || []).forEach(function (a) { var r = add(a.year); if (!r[a.kind]) r[a.kind] = a; });
    var lk = function (x, t, tip) { return x ? '<a href="' + esc(x.orig || x.page) + '" target="_blank" rel="noopener" title="' + esc(tip || '') + '">[' + t + ']</a>' : span('g', '[' + t.replace(/./g, '·').slice(0, t.length) + ']'); };
    var rows = Object.keys(fys).sort().reverse().slice(0, 5).map(function (fy) {
      var r = fys[fy];
      return span('acc', 'FY' + fy) + '  ' + [1, 2, 3, 4].map(function (k) { var q = r.q[k]; return lk(q, 'Q' + k, q ? Z('截至 ', 'period ended ') + q.period : ''); }).join(' ') +
        '  ' + lk(r.ar, Z('年报', 'AR'), r.ar && r.ar.title) + ' ' + lk(r.aa, Z('审计', 'Audited'), r.aa && r.aa.title);
    });
    var mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][(f.fye_month || 12) - 1];
    return pn(Z('REPORTS 原始财报文件', 'ORIGINAL REPORTS'), Z('财政年度截至 ', 'FY ends ') + mo, '<pre class="txt fl">' + rows.join('\n') + '</pre>' +
      '<p class="dim">' + Z('点 [Q1]–[Q4]、[年报]、[审计] 打开 Bursa 原文 (附件 PDF 在那一页)。', 'Tap [Q1]–[Q4], [AR] or [Audited] to open the original on Bursa (PDF attachments are on that page).') +
      ' <a href="' + esc(f.bursa) + '" target="_blank" rel="noopener">' + Z('Bursa 全部公告', 'All Bursa filings') + ' ↗</a></p>');
  }
  var HC = ['hc1', 'hc2', 'hc3', 'hc4', 'hc5'], HCH = ['█', '▓', '▒', '■', '▚'];
  function holdersPanel(code) {
    var g = EXTRA[code] && EXTRA[code].holders, hs = (g && g.holders || []).filter(function (x) { return !x.below && x.pct > 0; });
    if (!hs.length) return '';
    // 持股结构只用直接持股 (间接 / 视同持股会跟别人的直接持股重复，例如家族成员互相算进去)；颜色跟着股东走
    var W = 40, used = 0, bar = '', legend = [], col = {};
    hs.filter(function (x) { return x.direct_pct >= 0.1; }).sort(function (a, b) { return b.direct_pct - a.direct_pct; }).slice(0, 5).forEach(function (x, i) {
      col[x.name] = i;
      var d = x.direct_pct || 0, k = Math.round(d / 100 * W);
      if (k < 1 && d > 0) k = 1;
      k = Math.min(k, W - used); used += k;
      bar += span(HC[i], HCH[i].repeat(k));
      legend.push(span(HC[i], HCH[i]) + ' ' + esc(x.name.slice(0, 26)) + ' ' + (d ? d.toFixed(2) + '%' : '—'));
    });
    bar += span('g', '·'.repeat(Math.max(0, W - used)));
    // 手机上窄：名字短一点、条短一点、不显示日期
    var narrow = window.innerWidth < 560, BW = narrow ? 8 : 16;
    var mx = Math.max.apply(null, hs.map(function (x) { return x.pct; })) || 1, nw = narrow ? 17 : LANG === 'en' ? 24 : 22;
    var rows = hs.slice(0, 10).map(function (x, i) {
      var k = Math.max(1, Math.round(x.pct / mx * BW));
      var chg = isNum(x.chg) ? span(x.chg > 0 ? 'up' : x.chg < 0 ? 'dn' : 'dim', (x.chg > 0 ? '+' : '') + x.chg.toFixed(2)) : span('dim', Z('新', 'new'));
      return cell(esc(x.name.slice(0, nw)), nw) + ' ' + span(x.name in col ? HC[col[x.name]] : 'acc', '█'.repeat(k)) + span('g', '░'.repeat(BW - k)) + ' ' + pad(x.pct.toFixed(2) + '%', 7, true) + ' ' + cell(chg, 6, true) + (narrow ? '' : span('dim', '  ' + md(x.as_of)));
    });
    var recs = (g.records || []).slice(0, 5).map(function (r) {
      var c = (r.changes || [])[0] || {}, tot = (r.direct_pct || 0) + (r.indirect_pct || 0);
      var act = { acquired: Z('买入', 'bought'), disposed: Z('卖出', 'sold') }[c.type] || c.type || '';
      return '<p class="list-ann"><span class="dim">' + md(c.date || r.date) + '</span> ' + esc(r.name) + ' <span class="' + (c.type === 'acquired' ? 'up' : c.type === 'disposed' ? 'dn' : 'dim') + '">' + esc(act) + ' ' + bigN(c.units) + '</span>' +
        (r.changes && r.changes.length > 1 ? span('dim', Z(' 等 ' + r.changes.length + ' 笔', ' +' + (r.changes.length - 1) + ' more')) : '') + ' → ' + tot.toFixed(2) + '% <a href="https://www.klsescreener.com/v2/announcements/view/' + esc(r.id) + '" target="_blank" rel="noopener">↗</a></p>';
    }).join('');
    return pn(Z('SHAREHOLDERS 主要股东', 'SUBSTANTIAL SHAREHOLDERS'), hs.length + Z(' 位', ''),
      '<h3 class="fin-h">' + Z('持股结构', 'Ownership') + '<span class="dim">' + Z('直接持股 · 其余为其他股东', 'direct holdings · rest = other shareholders') + '</span></h3>' +
      '<pre class="txt">' + bar + ' ' + span('dim', '100%') + '\n' + legend.join('\n') + '</pre>' +
      '<h3 class="fin-h">' + Z('持股 % 和变化', 'Stake % and change') + '<span class="dim">' + Z('直接 + 间接 · 变化 = 百分点', 'direct + indirect · change in pp') + '</span></h3>' +
      '<pre class="txt">' + cell(span('dim', Z('股东', 'Holder')), nw) + ' ' + span('dim', pad('', BW)) + ' ' + span('dim', pad('%', 7, true)) + ' ' + cell(span('dim', Z('变化', 'chg')), 6, true) + (narrow ? '' : span('dim', Z('  最近变动', '  last'))) + '\n' + rows.join('\n') + '</pre>' +
      (recs ? '<h3 class="fin-h">' + Z('最近的申报', 'Latest filings') + '</h3>' + recs : '') +
      '<p class="dim">' + Z('只包含 ' + md(g.since) + ' 以来有申报变动的主要股东 (持股 ≥5%)；持股 % = 直接 + 间接，间接 (视同) 持股可能跟别人的持股重复，所以各行加起来可以超过 100%；变化跟期间第一笔申报之前比 (按股数推算)；很久没变动的股东不会出现。来源：Bursa 主要股东公告。',
        'Only substantial shareholders (≥5%) who filed a change since ' + md(g.since) + '; stake = direct + indirect, and indirect (deemed) interests can overlap, so rows may add up to more than 100%; change is vs. before their first filing in the period (derived from units); long-inactive holders are not shown. Source: Bursa substantial-shareholder filings.') + '</p>');
  }
  function fetchExtra(code) {
    var j = function (u) { return fetch(u).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); };
    var base = D.report || '../';
    Promise.all([j(base + 'ann/' + code + '.json'), j(base + 'news/' + code + '.json'), j(base + 'holders/' + code + '.json'), j(base + 'filings/' + code + '.json'), j(base + 'segments/' + code + '.json')]).then(function (r) {
      EXTRA[code] = { ann: (r[0] && r[0].items) || [], news: (r[1] && r[1].items) || [], holders: r[2], filings: r[3], segments: r[4] };
      if (S.code === code) render();
    });
  }

  // ---------- 外框 ----------
  // 顶部跑马灯：KLCI、涨 / 平 / 跌家数、USD/MYR、更新时间，后面接成交额前 10、成交量前 10 的涨跌 (不含仙股)；内容复制一份接在后面，无缝循环
  // ---------- 桌面小工具 (widget.html)：一个小窗口看今天的重点，每 5 分钟自动更新；点股票在完整终端打开 ----------
  var WIDGET = !!window.BTERM_WIDGET;
  function wgRow(code, extra) {
    var s = ST[code], nm = (s && s.name) || nameOf(code);
    return '<button type="button" class="wg-r" data-q="' + esc(code) + '"><span class="wg-n">' + esc(nm) + (extra ? ' <small class="dim">' + extra + '</small>' : '') + '</span>' +
      '<span class="wg-s dim">' + (s ? sparkFor(code, 10) : '') + '</span><span class="wg-p">' + (s ? px(s.p) : '—') + '</span>' +
      '<span class="wg-c ' + (s ? cls(s.c) : 'dim') + '">' + (s ? pct(s.c, 1) : T('不在报告')) + '</span></button>';
  }
  function wgHead(t, sub) { return '<h3 class="wg-h">' + t + (sub != null ? ' <span class="dim">' + sub + '</span>' : '') + '</h3>'; }
  function pageWidget() {
    loadCal(); loadIpo();
    var m = D.market || {}, ix = m.index, b = m.breadth, td = today(), end = addDays(td, 7), h = '';
    var st = { live: T('盘中'), pre: T('开市前'), closed: T('已收盘') }[D.state] || D.state;
    h += '<p class="wg-top">' + (ix ? '<b>KLCI</b> ' + ix.last.toLocaleString('en', { minimumFractionDigits: 2 }) + ' <span class="' + cls(ix.chg) + '">' + pct(ix.pct) + '</span> ' : '') +
      (b ? '<span class="up">▲' + b.up + '</span> <span class="dim">■' + b.flat + '</span> <span class="dn">▼' + b.down + '</span>' : '') + '</p>';
    var sg = D.signals || [];
    h += wgHead(T('今日信号'), sg.length) + (sg.length ? sg.slice(0, 6).map(function (x) { return wgRow(x.code); }).join('') : T('<p class="dim">今天没有信号</p>'));
    var f = curFolder();
    h += wgHead('★ ' + esc(T(f.name)), f.codes.length) + (W.folders.length > 1 ? '<div class="opts wg-f">' + W.folders.map(function (x) {
      return '<button type="button" data-wgf="' + esc(x.id) + '" aria-pressed="' + (x.id === f.id) + '">' + esc(T(x.name)) + '</button>'; }).join('') + '</div>' : '') +
      (f.codes.length ? f.codes.slice(0, 12).map(function (c) { return wgRow(c); }).join('') : T('<p class="dim">观察列表是空的 (在完整终端里加)</p>'));
    var liq = LIST.filter(function (x) { return isNum(x.c) && isNum(x.p) && x.p >= 0.1; }).sort(function (x, y) { return (y.to || 0) - (x.to || 0); }).slice(0, 5);
    h += wgHead(T('成交额前 5')) + liq.map(function (x) { return wgRow(x.code); }).join('');
    // 接下来 7 天：IPO 日期 + 观察列表公司的企业活动
    var wset = {}; W.folders.forEach(function (x) { x.codes.forEach(function (c) { wset[c] = 1; }); });
    var ev = (IPO ? ipoEvents(td) : []).filter(function (e) { return e.date <= end; });
    if (CAL) Object.keys(wset).forEach(function (c) { ev = ev.concat(evApply(c, CAL.filter(function (e) { return e.code === c; })).filter(function (e) { return e.date >= td && e.date <= end; })); });
    ev.sort(function (a, b2) { return a.date < b2.date ? -1 : a.date > b2.date ? 1 : 0; });
    h += wgHead(T('接下来 7 天'), ev.length) + (ev.length ? ev.slice(0, 8).map(function (e) {
      var t = CAL_T[e.type] || ['corp', e.type];
      return '<p class="wg-e"><span class="dim">' + md(e.date) + '</span> <span class="cal-t cg-' + t[0] + '">' + t[1] + '</span> ' + esc(e.name || e.code) + '</p>'; }).join('') :
      T('<p class="dim">没有 IPO 日期或观察列表公司的活动</p>'));
    h += '<p class="dim wg-foot">' + esc(md(D.updated.slice(0, 10)) + D.updated.slice(10)) + ' ' + esc(D.tz || '') + ' · ' + st + T(' · 每 5 分钟自动更新 · <a href="./" target="bterm">完整终端 ↗</a></p>');
    return h;
  }
  if (WIDGET) {  // 自动更新：窗口看得到时每 5 分钟重新读 data.json；从别的窗口切回来、超过 5 分钟也马上更新
    var wgLast = Date.now();
    var wgRefresh = function () {
      if (document.visibilityState !== 'visible' || !D) return;
      wgLast = Date.now();
      fetch('data.json?t=' + Date.now()).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
        if (!j) return; D = j; ingest(); document.getElementById('status').innerHTML = status(); BARS = null; barsLoading = false; CAL = null; calLoading = false; render();
      }).catch(function () {});
    };
    setInterval(wgRefresh, 5 * 60e3);
    document.addEventListener('visibilitychange', function () { if (Date.now() - wgLast > 5 * 60e3) wgRefresh(); });
  }
  function status() {
    var m = D.market || {}, ix = m.index, b = m.breadth, st = { live: T('盘中 LIVE'), pre: T('开市前'), closed: T('收盘 CLOSED') }[D.state] || D.state, sep = ' <span class="g">│</span> ';
    var parts = [];
    if (ix) parts.push('<b>' + esc(ix.label.split(' ').pop()) + '</b> ' + ix.last.toLocaleString('en', { minimumFractionDigits: 2 }) + ' <span class="' + cls(ix.chg) + '">' + (ix.chg > 0 ? '▲' : ix.chg < 0 ? '▼' : '') + (ix.chg > 0 ? '+' : '') + ix.chg + ' ' + pct(ix.pct) + '</span>');
    if (b) parts.push(T('<span class="up">涨 ▲') + b.up + T('</span> <span class="dim">平 ■') + b.flat + T('</span> <span class="dn">跌 ▼') + b.down + '</span>');
    if (isNum(m.usd_myr)) parts.push('<span class="dim">USD/MYR</span> ' + m.usd_myr.toFixed(4));
    parts.push('<span class="dim">' + esc(md(D.updated.slice(0, 10)) + D.updated.slice(10)) + ' ' + esc(D.tz || '') + '</span> <span class="' + (D.state === 'live' ? 'warn' : 'acc') + '">' + st + '</span>');
    // 成交额前 10、成交量前 10 (仙股不看：价格 < RM0.10 的剔除)
    var liq = LIST.filter(function (x) { return isNum(x.c) && isNum(x.p) && x.p >= 0.1; });
    [[T('成交额 TOP10'), 'to'], [T('成交量 TOP10'), 'vol']].forEach(function (g) {
      parts.push('<span class="tk-h">' + g[0] + '</span>');
      liq.slice().sort(function (x, y) { return (y[g[1]] || 0) - (x[g[1]] || 0); }).slice(0, 10).forEach(function (x) {
        parts.push('<b>' + esc(x.name) + '</b> ' + px(x.p) + ' <span class="' + cls(x.c) + '">' + (x.c > 0 ? '▲' : x.c < 0 ? '▼' : '') + pct(x.c, 1) + '</span>');
      });
    });
    var one = parts.join(sep) + sep;
    return '<span class="tick" aria-hidden="true"><span>' + one + '</span><span>' + one + '</span></span>' +
      '<span class="sr-only">' + esc(parts.join(' · ').replace(/<[^>]+>/g, '')) + '</span>';
  }
  function keys() {
    var counts = { sig: (D.signals || []).length, watch: watchCount(), pool: LIST.filter(function (s) { return s.pool === 1; }).length, ann: (D.board || []).length };
    document.getElementById('keys').innerHTML = PAGES.map(function (p, i) {
      return '<button type="button" data-page="' + p[0] + '"' + (S.page === p[0] && !S.code ? ' aria-current="page"' : '') + '><span class="k">[' + (i + 1) + ']</span>' + p[1] + (counts[p[0]] ? ' ' + counts[p[0]] : '') + '</button>';
    }).join('') + '<a class="ui-std" href="' + esc(stdUrl()) + T('">⚙ 标准风格</a>');
  }
  // ---------- 手机底部导航栏：7 个小图标 + 短标签，浮动玻璃效果；选中的那页有一个会滑过去的玻璃泡泡 ----------
  var TBI = {
    sig: '<path d="M3 12h4l3-7 4 14 3-7h4"/>',
    mkt: '<path d="M7 4v3M7 17v3M17 3v4M17 15v6"/><rect x="5" y="7" width="4" height="10" rx="1"/><rect x="15" y="7" width="4" height="8" rx="1"/>',
    watch: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
    bt: '<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6"/><path d="M3 4v4.5h4.5"/><path d="M12 7.5V12l3 2"/>',
    pool: '<path d="M12 3l9 4.5-9 4.5-9-4.5z"/><path d="M3 12l9 4.5 9-4.5"/><path d="M3 16.5l9 4.5 9-4.5"/>',
    ann: '<path d="M4 10v4h3l7 4V6l-7 4z"/><path d="M18 9a4 4 0 0 1 0 6"/>',
    cal: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'
  };
  var TBL = { sig: ['信号', 'Signals'], mkt: ['市场', 'Market'], watch: ['观察', 'Watch'], bt: ['回测', 'Backtest'], pool: ['股票池', 'Pool'], ann: ['公告', 'Filings'], cal: ['日历', 'Calendar'] };
  var tbBuilt = false, TB = { drag: false, x0: 0, moved: false, hot: null, lastX: 0, lastT: 0, eat: false };
  var narrowUI = function () { return window.innerWidth < 780 && !WIDGET; };
  var calmUI = function () { return window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches; };
  function tbButtons() { return [].slice.call(document.querySelectorAll('#tabbar button[data-page]')); }
  // 玻璃泡泡：外层负责位置 (translateX)，里面的 blob 负责「液体」拉伸变形
  function tbPlace(x, w, opt) {
    var ind = document.querySelector('#tabbar .tb-ind');
    if (!ind) return;
    opt = opt || {};
    ind.classList.toggle('tb-free', !!opt.free);
    ind.style.width = w + 'px'; ind.style.transform = 'translateX(' + x + 'px)';
    var blob = ind.firstChild;
    if (blob && opt.stretch != null) blob.style.transform = 'scale(' + (1 + opt.stretch).toFixed(3) + ',' + (1 - opt.stretch * 0.45).toFixed(3) + ')';
    else if (blob && opt.squish && !calmUI()) { blob.style.transform = ''; blob.classList.remove('tb-squish'); void blob.offsetWidth; blob.classList.add('tb-squish'); }
  }
  function tbNearest(x) {
    var bs = tbButtons(), best = null, bd = 1e9;
    bs.forEach(function (b) { var d = Math.abs(b.offsetLeft + b.offsetWidth / 2 - x); if (d < bd) { bd = d; best = b; } });
    return best;
  }
  function tbHot(b) {
    if (TB.hot === b) return;
    if (TB.hot) TB.hot.classList.remove('tb-hot');
    TB.hot = b;
    if (b) { b.classList.add('tb-hot'); try { if (navigator.vibrate) navigator.vibrate(4); } catch (e) {} }
  }
  function tabbar(squish) {
    var tb = document.getElementById('tabbar');
    if (!tb || WIDGET) return;
    if (!tbBuilt) {
      tb.setAttribute('aria-label', LANG === 'en' ? 'Pages' : '页面');
      tb.innerHTML = '<div class="tb-in"><span class="tb-ind" aria-hidden="true"><span class="tb-blob"></span></span>' + PAGES.map(function (p) {
        return '<button type="button" data-page="' + p[0] + '"><svg viewBox="0 0 24 24" aria-hidden="true">' + TBI[p[0]] + '</svg><span>' + TBL[p[0]][LANG === 'en' ? 1 : 0] + '</span></button>'; }).join('') + '</div>';
      tbBuilt = true;
      tbBind(tb);
    }
    var on = null;
    tbButtons().forEach(function (b) {
      var cur = b.dataset.page === S.page;
      if (cur) { b.setAttribute('aria-current', S.code ? 'true' : 'page'); on = b; } else b.removeAttribute('aria-current');
    });
    if (on && on.offsetWidth && !TB.drag) tbPlace(on.offsetLeft, on.offsetWidth, { squish: squish });
  }
  // 按住导航栏左右滑：泡泡跟着手指走 (边走边拉长)，经过的图标放大；放开就弹到最近那一页并切过去
  function tbBind(tb) {
    var inner = function () { return tb.querySelector('.tb-in'); };
    tb.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      TB.drag = true; TB.moved = false; TB.x0 = e.clientX; TB.lastX = e.clientX; TB.lastT = e.timeStamp;
      tb.classList.add('tb-press');
    });
    tb.addEventListener('pointermove', function (e) {
      if (!TB.drag) return;
      if (!TB.moved && Math.abs(e.clientX - TB.x0) < 6) return;
      if (!TB.moved) { try { tb.setPointerCapture(e.pointerId); } catch (err) {} }  // 真的开始拖才锁定指针 (只点一下照常是按钮的 click)
      TB.moved = true;
      var r = inner().getBoundingClientRect(), bs = tbButtons(), w = bs[0] ? bs[0].offsetWidth : 50;
      var x = Math.max(0, Math.min(r.width - w, e.clientX - r.left - w / 2));
      var dt = Math.max(8, e.timeStamp - TB.lastT), v = Math.abs(e.clientX - TB.lastX) / dt;  // px / ms
      TB.lastX = e.clientX; TB.lastT = e.timeStamp;
      tbPlace(x, w, { free: true, stretch: Math.min(0.32, v * 0.22) });
      tbHot(tbNearest(x + w / 2));
    });
    var end = function (e, cancel) {
      if (!TB.drag) return;
      TB.drag = false; tb.classList.remove('tb-press');
      var hot = TB.hot; tbHot(null);
      if (TB.moved) {
        TB.eat = true;  // 拖完放开不要再当成点一下
        if (!cancel && hot && (hot.dataset.page !== S.page || S.code)) go(hot.dataset.page, null, { swipe: true });
        else tabbar(true);
      }
    };
    tb.addEventListener('pointerup', function (e) { end(e, false); });
    tb.addEventListener('pointercancel', function (e) { end(e, true); });
    tb.addEventListener('click', function (e) { if (TB.eat) { TB.eat = false; e.stopPropagation(); e.preventDefault(); } }, true);
  }
  // 在页面上左右滑：换到前 / 后一页 (第 1 → 7 页)；页面和导航栏的泡泡都跟着手指动。个股页向右滑 = 返回
  var SW = null;
  function swScrollable(el) {
    for (; el && el !== document.body; el = el.parentElement) {
      if (/^(INPUT|TEXTAREA|SELECT|CANVAS)$/.test(el.tagName) || el.id === 'ai-panel' || el.id === 'ed-panel' || el.id === 'tabbar') return true;
      if (el.scrollWidth > el.clientWidth + 2) { var ox = getComputedStyle(el).overflowX; if (ox === 'auto' || ox === 'scroll') return true; }
    }
    return false;
  }
  function swIndex() { for (var i = 0; i < PAGES.length; i++) if (PAGES[i][0] === S.page) return i; return 0; }
  function swTarget(dx) {
    if (S.code) return dx > 0 ? { back: true } : null;
    var i = swIndex() + (dx < 0 ? 1 : -1);
    return i >= 0 && i < PAGES.length ? { page: PAGES[i][0] } : null;
  }
  document.addEventListener('touchstart', function (e) {
    if (!narrowUI() || e.touches.length !== 1 || !main.contains(e.target) || swScrollable(e.target) || (AI && AI.open)) { SW = null; return; }
    var t = e.touches[0];
    SW = { x: t.clientX, y: t.clientY, dx: 0, lock: null, t: e.timeStamp };
  }, { passive: true });
  document.addEventListener('touchmove', function (e) {
    if (!SW) return;
    var t = e.touches[0], dx = t.clientX - SW.x, dy = t.clientY - SW.y;
    if (!SW.lock) { if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return; SW.lock = Math.abs(dx) > Math.abs(dy) * 1.3 ? 'x' : 'y'; }
    if (SW.lock !== 'x') return;
    e.preventDefault();
    SW.dx = dx;
    var tg = swTarget(dx), damp = tg ? 0.55 : 0.18;  // 头尾没有下一页：拉得动但有阻力
    main.classList.add('sw-drag');
    main.style.transform = 'translateX(' + (dx * damp).toFixed(1) + 'px)';
    main.style.opacity = String(Math.max(0.55, 1 - Math.abs(dx) / 700));
    if (tg && tg.page) {  // 泡泡也往目标那一页挪 (按滑动的比例)
      var bs = tbButtons(), a = bs[swIndex()], b = bs.filter(function (x) { return x.dataset.page === tg.page; })[0];
      if (a && b) { var f = Math.min(1, Math.abs(dx) / (window.innerWidth * 0.5)); tbPlace(a.offsetLeft + (b.offsetLeft - a.offsetLeft) * f, a.offsetWidth, { free: true, stretch: f * 0.28 * (1 - f) * 2 }); }
    }
  }, { passive: false });
  document.addEventListener('touchend', function (e) {
    if (!SW) return;
    var s0 = SW; SW = null;
    if (s0.lock !== 'x') return;
    var dx = s0.dx, fast = Math.abs(dx) / Math.max(1, e.timeStamp - s0.t) > 0.5, tg = swTarget(dx);
    main.classList.remove('sw-drag');
    if (tg && (Math.abs(dx) > window.innerWidth * 0.28 || (fast && Math.abs(dx) > 40))) {
      main.style.transform = ''; main.style.opacity = '';
      if (tg.back) go(S.page, null, { swipe: true, dir: -1 }); else go(tg.page, null, { swipe: true });
    } else {
      main.classList.add('sw-back'); main.style.transform = ''; main.style.opacity = '';
      setTimeout(function () { main.classList.remove('sw-back'); }, 320);
      tabbar(true);
    }
  });
  document.addEventListener('touchcancel', function () { if (SW) { SW = null; main.classList.remove('sw-drag'); main.style.transform = ''; main.style.opacity = ''; tabbar(); } });
  // 换页动画：新的一页从滑动的方向滑进来
  function pageIn(dir) {
    if (!narrowUI() || calmUI() || !dir) return;
    main.classList.remove('pg-l', 'pg-r'); void main.offsetWidth;
    main.classList.add(dir > 0 ? 'pg-l' : 'pg-r');
  }
  function stdUrl() { return (D.report || '../') + '?ui=std'; }
  function render() {
    if (!D) return;
    keys(); tabbar(TB.sq); EVREG = [];
    document.getElementById('prompt-arg').textContent = S.code ? 'quote ' + S.code : '--' + S.page;
    var fn = { cal: pageCal, sig: pageSig, watch: pageWatch, bt: pageBt, pool: pagePool, mkt: pageMkt, ann: pageAnn }[S.page] || pageSig;
    var focusId = document.activeElement && /^(grep|cb-q|sq)$/.test(document.activeElement.id) ? document.activeElement.id : null, focusGrep = !!focusId, pos = focusGrep ? document.activeElement.selectionStart : null;
    main.innerHTML = WIDGET ? pageWidget() : S.code ? pageQuote(S.code) : fn();
    if (focusGrep) { var g = document.getElementById(focusId); if (g) { g.focus(); try { g.setSelectionRange(pos, pos); } catch (e) {} } }
    if (!BARS) loadBars();
    if (AI.open && !AI.busy && !(document.activeElement && document.activeElement.closest && document.activeElement.closest('#ai-panel'))) aiRender();
  }
  function go(page, code, opt) {
    var from = PAGES.map(function (p) { return p[0]; }).indexOf(S.page), to = PAGES.map(function (p) { return p[0]; }).indexOf(page || S.page);
    var dir = opt && opt.dir ? opt.dir : (code ? 1 : !code && S.code ? -1 : to > from ? 1 : to < from ? -1 : 0);  // 1 = 从右边进来，-1 = 从左边进来
    var pageChanged = (page || S.page) !== S.page || (code || null) !== S.code;
    if ((code || null) !== S.code) S.qtab = 'ov';
    if (page && page !== S.page) S.alim = 40;
    S.page = page || S.page; S.code = code || null;
    var h = S.code ? '#q-' + S.code : '#' + S.page;
    if (location.hash !== h) history.replaceState(null, '', h);
    TB.sq = pageChanged; render(); TB.sq = false; window.scrollTo(0, 0);
    if (pageChanged) pageIn(dir);
  }
  function fromHash() {
    var h = location.hash.slice(1);
    if (/^q-/.test(h)) { S.code = h.slice(2); return; }
    if (h === 'hold') h = 'watch';  // 旧书签
    S.code = null; if (PAGES.some(function (p) { return p[0] === h; })) S.page = h;
  }

  // ---------- 操作 ----------
  document.addEventListener('click', function (e) {
    if (WIDGET) {
      var wq = e.target.closest('[data-q]'); if (wq) { window.open('./#q-' + wq.dataset.q, 'bterm'); return; }
      var wf = e.target.closest('[data-wgf]'); if (wf) { W.cur = wf.dataset.wgf; saveW(); render(); return; }
    }
    var wt = e.target.closest('[data-wf],[data-wa],[data-wadd],[data-wd],[data-wt]'); if (wt) { watchClick(wt); return; }
    var fb = e.target.closest('[data-fin]'); if (fb) { S.fin = fb.dataset.fin; render(); return; }
    var ab = e.target.closest('[data-af]'); if (ab) {  // 换筛选后把选中的那个滑到看得见的位置
      S.af = ab.dataset.af || ''; var sl = document.querySelector('.fscroll'), x = sl ? sl.scrollLeft : 0; render();
      var sl2 = document.querySelector('.fscroll'); if (sl2) { sl2.scrollLeft = x; var on = sl2.querySelector('[aria-pressed="true"]'); if (on) on.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
      return; }
    var cbt = e.target.closest('[data-cb]'); if (cbt) { cbClick(cbt); return; }
    var thb = e.target.closest('[data-th]'); if (thb) { themeClick(thb); return; }
    var ai = e.target.closest('[data-ai]'); if (ai) { aiClick(ai); return; }
    if (e.target.closest('.ai-stk') && window.innerWidth < 780) AI.open = false;  // 手机上点 AI 回答里的股票：关掉面板去看个股页
    var ct = e.target.closest('[data-calg],[data-calw],[data-calm],[data-cald]'); if (ct) { calClick(ct); return; }
    if (e.target.closest('[data-candle]')) { toggleCandle(); return; }
    var edb = e.target.closest('[data-ed]'); if (edb) { edOpen(edb.dataset.ed, edb.dataset.code, edb.dataset.ev != null ? EVREG[+edb.dataset.ev] : null); return; }
    var edx = e.target.closest('[data-edx]'); if (edx) { edClick(edx); return; }
    if (e.target.closest('[data-ipo]')) { S.ipoAll = !S.ipoAll; render(); return; }
    var qt = e.target.closest('[data-qt]'); if (qt) { S.qtab = qt.dataset.qt; render(); var bar = document.querySelector('.qtabs'); if (bar && bar.getBoundingClientRect().top < 0) bar.scrollIntoView(); return; }
    if (e.target.closest('[data-amore]')) { S.alim = (S.alim || 40) + 40; render(); return; }
    var hbx = e.target.closest('[data-hb]'); if (hbx) { S.hb = S.hb === hbx.dataset.hb ? null : hbx.dataset.hb; render(); return; }
    var t = e.target.closest('[data-page],[data-q],[data-back],[data-flt],[data-sort],[data-more],[data-cat],[data-heat]');
    if (!t) return;
    if (t.dataset.page) go(t.dataset.page);
    else if (t.dataset.q) go(S.page, t.dataset.q);
    else if (t.dataset.back) go(S.page);
    else if (t.dataset.flt) { S.flt[t.dataset.flt] = !S.flt[t.dataset.flt]; S.limit = 50; render(); }
    else if (t.dataset.sort) setSort(t.dataset.sort);
    else if (t.dataset.more) { S.limit += 50; render(); }
    else if (t.dataset.cat) { S.cat = t.dataset.cat; render(); }
    else if (t.dataset.heat) { S.heat = +t.dataset.heat; S.hb = null; render(); }
  });
  document.addEventListener('toggle', function (e) { var d = e.target; if (d.classList && d.classList.contains('info')) OPEN[d.dataset.code] = d.open; }, true);
  document.addEventListener('change', function (e) {
    var el = e.target, d = el.dataset || {};
    if (d.cbr) { CB.rules[d.cbr] = el.checked; cbSave(); }
    else if (d.cbx) { CB[d.cbx] = el.checked ? 1 : 0; cbSave(); }
    else if (d.cbn) { var n = parseFloat(el.value); CB[d.cbn] = isFinite(n) && n >= 0 ? n : 0; cbSave(); }
    else if (el.id === 'cb-from' || el.id === 'cb-to') { CB[el.id === 'cb-from' ? 'from' : 'to'] = el.value; cbSave(); render(); }
  });
  // 搜索框打字时只换下面的列表 / 建议，不重画整页：重画会换掉输入框，iPhone 键盘就从数字跳回字母
  document.addEventListener('input', function (e) {
    var id = e.target.id, box;
    if (id === 'cb-q') { CB.q = e.target.value; if ((box = document.getElementById('cb-sug'))) box.innerHTML = cbSug(); }
    else if (id === 'w-q') { WQ = e.target.value; if ((box = document.getElementById('w-sug'))) box.innerHTML = wSug(); }
    else if (id === 'th-q') TH.prompt = e.target.value;
    else if (id === 'sq') { S.sq = e.target.value; if ((box = document.getElementById('sq-res'))) box.innerHTML = sqRes(); }
    else if (id === 'grep') {
      S.q = e.target.value; S.limit = 50;
      var b = poolBody(); if ((box = document.getElementById('pool-body'))) box.innerHTML = b.rows;
      if ((box = document.getElementById('pool-n'))) box.textContent = b.n;
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey || !D) return;
    var typing = e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName);
    if (e.key === 'Enter' && e.target.id === 'sq') { e.preventDefault(); var h0 = sqHits(S.sq)[0]; if (h0) { e.target.blur(); go(S.page, h0); } return; }
    if (e.key === 'Enter' && e.target.id === 'wf-name') { e.preventDefault(); wSubmit(); render(); return; }
    if (e.key === 'Enter' && !e.shiftKey && e.target.id === 'ai-q') { e.preventDefault(); aiAsk(e.target.value); return; }
    if (e.key === 'Escape' && AI.open) { AI.open = false; aiRender(); return; }
    if (e.key === 'Escape') { if (typing) e.target.blur(); if (S.code) go(S.page); return; }
    if (typing) return;
    var n = parseInt(e.key, 10);
    if (n >= 1 && n <= PAGES.length) { go(PAGES[n - 1][0]); e.preventDefault(); return; }
    if (e.key === 'q' && S.code) { go(S.page); return; }
    if (e.key === '/') { e.preventDefault(); if (S.page === 'sig' && !S.code) { var sq = document.getElementById('sq'); if (sq) sq.focus(); return; } go('pool'); var g = document.getElementById('grep'); if (g) g.focus(); return; }
    if (e.key === 't') { toggleTheme(); return; }
    if (e.key === 'k') { toggleCandle(); return; }
    if (S.page === 'pool' && !S.code) {
      var f = FLT.filter(function (x) { return x[0] === e.key; })[0], s = SORT.filter(function (x) { return x[0] === e.key; })[0];
      if (f) { S.flt[f[1]] = !S.flt[f[1]]; S.limit = 50; render(); } else if (s) setSort(s[1]); else if (e.key === 'a') { S.flt = {}; render(); }
    }
  });
  window.addEventListener('hashchange', function () { fromHash(); render(); });
  var resizeT = null;
  var lastW = window.innerWidth;  // 只在宽度变了才重画 (iPhone 滚动时地址栏收起只改高度，不该重画)
  window.addEventListener('resize', function () { if (window.innerWidth === lastW) return; lastW = window.innerWidth; clearTimeout(resizeT); resizeT = setTimeout(function () { CW = null; render(); }, 150); });
  function toggleTheme() {
    if (document.documentElement.dataset.custom) { var sv = themeSaved(); if (sv && sv.t) themeStore(sv.t, false); TH.preview = null; themeApply(null); aiRender(); return; }
    var root = document.documentElement, dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('bterm_theme', root.dataset.theme); } catch (e) {}
  }
  try { var th = localStorage.getItem('bterm_theme'); if (th === 'dark' || th === 'light') document.documentElement.dataset.theme = th; } catch (e) {}
  document.getElementById('theme-btn').addEventListener('click', toggleTheme);
  // 中文 ⇄ English：存进 bursa_lang (跟标准报告共用)，重新载入
  (function () {
    var lb = document.getElementById('lang-btn');
    if (lb) { lb.textContent = LANG === 'en' ? '中文' : 'EN'; lb.setAttribute('aria-label', LANG === 'en' ? '切换到中文' : 'Switch to English');
      lb.addEventListener('click', function () { try { localStorage.setItem('bursa_lang', LANG === 'en' ? 'zh' : 'en'); } catch (e) {}
        location.replace(location.pathname + location.search.replace(/([?&])lang=(en|zh)&?/, '$1').replace(/[?&]$/, '') + location.hash); }); }
    if (LANG !== 'en') return;
    var set = function (id, txt) { var el = document.getElementById(id); if (el) el.textContent = txt; };
    set('theme-btn', '[t] Theme'); set('keys-help', 'Keys 1–7 switch pages, / search, k hollow / solid candles, q back');
    set('disclaimer', 'For research only, not investment advice · Data: Yahoo Finance, Bursa (via KLSE Screener), Google News');
    set('full-report', '⚙ Standard view');
    set('legal-link', 'Terms of use & disclaimer');
    if (main.querySelector('.dim')) main.innerHTML = '<p class="dim">Loading data…</p>';
  })();

  // 离线 (PWA)：sw.js 存着最后一次的页面和 data.json / bars.json；连不上网时用存着的，顶部显示「离线 · 数据时间」
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }
  var OFFLINE = false;
  function offlineBar() {
    var el = document.getElementById('offline');
    if (!OFFLINE || !D) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('p'); el.id = 'offline'; el.className = 'offline'; document.getElementById('status').insertAdjacentElement('beforebegin', el); }
    var when = esc(md(D.updated.slice(0, 10)) + D.updated.slice(10)) + ' ' + esc(D.tz || '');
    el.innerHTML = navigator.onLine === false
      ? T('⚠ 离线 · 显示的是 ') + when + T(' 的数据')
      : T('⚠ 连不上服务器 · 显示的是 ') + when + T(' 的数据 · <button type="button" data-reload>重新载入</button>');
  }
  window.addEventListener('online', function () { if (OFFLINE) offlineBar(); });
  window.addEventListener('offline', function () { if (OFFLINE) offlineBar(); });
  document.addEventListener('click', function (e) { if (e.target.closest('[data-reload]')) location.reload(); });

  fetch('data.json?v=' + V).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); OFFLINE = r.headers.get('x-bterm-offline') === '1'; return r.json(); }).then(function (j) {
    D = j; ingest(); fromHash(); offlineBar(); loadOv();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { CW = null; render(); });  // 网页字体到了再量一次字宽
    document.getElementById('status').innerHTML = status();
    var tk = document.querySelector('#status .tick > span');  // 速度固定约每秒 40px，内容长短不影响快慢
    if (tk) document.querySelector('#status .tick').style.animationDuration = Math.max(20, tk.getBoundingClientRect().width / 40) + 's';
    document.getElementById('full-report').href = stdUrl();
    render();
  }).catch(function (err) {
    main.innerHTML = T('<p class="dn">读取 data.json 失败 (') + esc(err.message) + T(')。报告可能还在生成，稍后再刷新。</p>');
  });
})();
