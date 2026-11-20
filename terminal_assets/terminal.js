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
  var PAGES = [['mkt', T('市场')], ['sig', T('信号')], ['watch', T('观察列表')], ['bt', T('回测')], ['pool', T('股票池')], ['ann', T('公告')], ['cal', T('日历')]];
  var S = { page: 'mkt', code: null, flt: {}, sort: 'vol', dir: -1, q: '', limit: 50, cat: 'all' };
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
  function toggleCandle() { CANDLE = CANDLE === 'hollow' ? 'solid' : 'hollow'; try { localStorage.setItem('bterm_candle', CANDLE); } catch (e) {} syncSoon(); render(); }
  // 关键价位 (个股页)：图里最近的波段高 / 低点 (左右各 k 根都没超过它) + 区间最高 / 最低，现价上面最近两条 = 压力、下面最近两条 = 支撑；
  // 横虚线 + 右边刻度标出准确价格。只是图上的价位，不是买卖建议。按「关键价位」开关，存在这台设备
  var LEVELS = true;
  try { if (localStorage.getItem('bterm_levels') === '0') LEVELS = false; } catch (e) {}
  function toggleLevels() { LEVELS = !LEVELS; try { localStorage.setItem('bterm_levels', LEVELS ? '1' : '0'); } catch (e) {} render(); }
  function keyLevels(bs, step) {
    var k = bs.length >= 60 ? 3 : 2, cand = [], last = bs[bs.length - 1].c, out = [], gap = Math.max(step, last * 0.01);
    for (var i = k; i < bs.length - k; i++) {
      var isH = true, isL = true;
      for (var j = i - k; j <= i + k; j++) if (j !== i) { if (bs[j].h > bs[i].h) isH = false; if (bs[j].l < bs[i].l) isL = false; }
      if (isH) cand.push(bs[i].h); if (isL) cand.push(bs[i].l);
    }
    cand.push(Math.max.apply(null, bs.map(function (b) { return b.h; })), Math.min.apply(null, bs.map(function (b) { return b.l; })));
    function pick(arr, side) {  // arr 由近到远；相近的 (gap 以内) 合并成一区，取最外面那条 (支撑取最低、压力取最高)，最多两区
      var zs = [];
      arr.forEach(function (v) { var z = zs[zs.length - 1]; if (z && Math.abs(v - z.near) < gap) z.v = v; else zs.push({ near: v, v: v }); });
      zs.slice(0, 2).forEach(function (z) { out.push({ v: z.v, s: side }); });
    }
    var eps = last * 0.002;  // 跟现价一样的不算 (那就是现价本身)
    pick(cand.filter(function (v) { return v > last + eps; }).sort(function (a, b) { return a - b; }), 'r');
    pick(cand.filter(function (v) { return v < last - eps; }).sort(function (a, b) { return b - a; }), 's');
    return out;
  }
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
    em.forEach(function (v, i) { if (i + off >= 19) { var r = rowOf(v); if (!g[r][i][1]) g[r][i] = ['·', 'e']; } });
    var marks = {};
    [[opt.stop, 'cd', 'STOP'], [opt.target, 'cu', 'TGT ']].forEach(function (m) {
      if (!isNum(m[0]) || m[0] < lo || m[0] > hi) return;
      var r = rowOf(m[0]); marks[r] = m;
      for (var i = 0; i < W; i++) if (!g[r][i][1]) g[r][i] = ['╌', m[1]];
    });
    var lv = opt.levels && LEVELS ? keyLevels(bs, step) : [], lvr = {};
    lv.forEach(function (o) {
      var r = rowOf(o.v); if (marks[r] || lvr[r]) return; lvr[r] = o;
      for (var i = 0; i < W; i++) if (!g[r][i][1] || g[r][i][1] === 'e') g[r][i] = ['╌', 'kl'];
    });
    // 刻度：最上 / 最下标图里准确的最高价 / 最低价，中间一格标大约价位
    var mxH = Math.max.apply(null, bs.map(function (b) { return b.h; })), mnL = Math.min.apply(null, bs.map(function (b) { return b.l; }));
    var labels = {}; if (!Object.keys(lvr).length) labels[Math.floor(rows / 2)] = hi - (Math.floor(rows / 2) + 0.5) * step;  // 有关键价位就不要大约的中间刻度
    labels[rowOf(mxH)] = mxH; labels[rowOf(mnL)] = mnL;
    var out = [];
    for (r = 0; r < rows; r++) {
      var line = '', cur = null, buf = '';
      for (i = 0; i < W; i++) {
        var cell = g[r][i];
        if (cell[1].indexOf(' hc') > 0) { line += span(cur, buf) + span(cell[1], ' '); buf = ''; cur = null; continue; }  // 空心框每格单独一个 span
        if (cell[1] !== cur) { line += span(cur, buf); buf = ''; cur = cell[1]; } buf += cell[0];
      }
      line += span(cur, buf);
      var lab = marks[r] ? span(marks[r][1], ' ' + pad(px(marks[r][0]), 6, true)) : lvr[r] ? ' ' + span('klt', pad(px(lvr[r].v), 6, true)) : labels[r] != null ? span('dim', ' ' + pad(px(labels[r]), 6, true)) : '';
      out.push(line + lab);
    }
    var mv = Math.max.apply(null, bs.map(function (b) { return b.v || 0; })) || 1, vl = '', vc = null, vb = '';
    bs.forEach(function (b, i) { var c = 'v' + colr[i], ch = EIGHTHS[Math.max(1, Math.round((b.v || 0) / mv * 8))]; if (c !== vc) { vl += span(vc, vb); vb = ''; vc = c; } vb += ch; });
    vl += span(vc, vb) + span('dim', ' VOL');
    out.push(vl);
    var d0 = md(bs[0].d), d1 = md(bs[bs.length - 1].d);
    out.push(span('dim', d0 + ' '.repeat(Math.max(1, W - d0.length - d1.length)) + d1));
    var shown = lv.filter(function (o) { return lvr[rowOf(o.v)] === o; }).sort(function (a, b) { return b.v - a.v; });
    var lg = function (side, zh, en) { var x = shown.filter(function (o) { return o.s === side; }); return x.length ? Z(zh, en) + ' ' + x.map(function (o) { return '<b class="klv">' + px(o.v) + '</b>'; }).join(' · ') : ''; };
    var bar = '<div class="ch-bar"><button type="button" class="cndl" data-candle title="' + T('切换空心 / 实心K线 [k]') + '">' + (hollow ? T('空心') : T('实心')) + '</button>' +
      (opt.levels ? '<button type="button" class="cndl" data-levels aria-pressed="' + LEVELS + '" title="' + Z('图上最近的波段高低点', 'Nearest swing highs and lows on the chart') + '">' + Z('关键价位', 'Key levels') + '</button>' +
        (LEVELS && shown.length ? '<span class="kl-lg">' + [lg('r', '压力', 'Resistance'), lg('s', '支撑', 'Support')].filter(Boolean).join('　') + '</span>' : '') : '') + '</div>';
    return '<pre class="chart" role="img" aria-label="' + esc(opt.label || T('日线')) + T('，最近 ') + W + T(' 天') + (shown.length ? ' · ' + Z('关键价位 ', 'key levels ') + shown.map(function (o) { return px(o.v); }).join(', ') : '') + '">' + out.join('\n') + '</pre>' + bar;
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
  function siteBase() {  // 资料网址 (data.json 的 report) 跟现在的网站不同 (例如刚搬到 Cloudflare Pages)：改读同一个网站的资料
    try { if (D.report && /^https?:/.test(D.report) && new URL(D.report).origin !== location.origin && /^https?:$/.test(location.protocol)) D.report = new URL('../', location.href).href; } catch (e) {}
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
  function sparkFor(code, n, upto) {  // upto = 画到哪一天为止 (回看过去的股票池)
    var b = bars(code);
    if (upto && (!b || idxOf(b, upto, 'd') < 0)) b = DAILY[code] || null;  // 今天不在报告里的：用载入过的 2 年日线
    if (!b) return '';
    if (upto) { var i = idxOf(b, upto, 'd'); if (i < 0) return ''; b = b.slice(0, i + 1); }
    return spark(b.slice(-30).map(function (x) { return x.c; }), n);
  }

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
  function pageSig() { return pageSigBody(); }
  // 搜索：市场页 (首页) 放在大盘图上面；其他页 (含个股页) 浮在页面底部 (#fsq，在 main 外面，换页不重建，打字不会掉焦点)
  var FSQ = { on: null };
  function fsq() {
    var el = document.getElementById('fsq'), on = !WIDGET && !!D && (S.page !== 'mkt' || !!S.code);
    if (!el) { el = document.createElement('div'); el.id = 'fsq'; el.className = 'fsq'; el.hidden = true; document.body.appendChild(el); fsqKb(el); }
    if (on === FSQ.on) return;
    FSQ.on = on; el.innerHTML = on ? sqBox() : ''; el.hidden = !on; el.classList.remove('shut');
    document.body.classList.toggle('has-fsq', on);
  }
  function sqClear() {
    S.sq = ''; var i = document.getElementById('sq'), r = document.getElementById('sq-res');
    if (i) { i.value = ''; i.blur(); } if (r) r.innerHTML = '';
  }
  // 手机键盘弹出时，把浮动搜索框抬到键盘上面
  function fsqKb(el) {
    var vv = window.visualViewport; if (!vv) return;
    var f = function () { var kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop); el.classList.toggle('kb', kb > 80); el.style.setProperty('--kb', Math.round(kb) + 'px'); };
    vv.addEventListener('resize', f); vv.addEventListener('scroll', f);
  }
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
  function saveW() { try { localStorage.setItem('bterm_watch', JSON.stringify(W)); } catch (e) {} syncSoon(); }
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
      (ACC && ACCT ? '<p class="dim">☁ ' + Z('已同步', 'Synced') + '</p>'
        : ACCT ? '<p class="dim"><button type="button" class="more" data-acct="toggle">' + Z('登录以同步 →', 'Sign in to sync →') + '</button></p>'
        : T('<p class="dim">观察列表只存在这台设备的浏览器里，换手机或清除网站资料会不见，记得「导出备份」。</p>'));
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
    var b = D.bt; if (!b) return pn(ttl(T('BACKTEST 回测')), '', T('<p class="dim">这次没有回测数据。</p>'));
    var a = b.acct, pos = b.position || 20000, R = function (v) { return isNum(v) ? v / 100 * pos : null; };
    var h = pn(ttl(T('SIMULATION 模拟统计')), esc(T(b.name || '')) + T(' · 同时最多 ') + (b.slots || '∞') + T(' 笔 · 每笔模拟 RM') + (pos / 1000) + 'K',
      kv([[T('胜率'), isNum(a.win_rate) ? a.win_rate.toFixed(1) + '%' : '—'], [T('期望值'), pct(a.avg), cls(a.avg)], [T('合计'), rm(R(a.total)), cls(a.total)], [T('最大回撤'), rm(R(a.mdd)), 'dn']], true) +
      kv([[T('已结束 / 进行中'), a.closed + ' / ' + a.open], [T('进行中浮动'), pct(a.open_avg), cls(a.open_avg)], [T('盈亏比'), isNum(a.payoff) ? a.payoff.toFixed(2) : '—'], [T('获利因子'), isNum(a.pf) ? a.pf.toFixed(2) : '—'],
        [T('平均天数'), isNum(a.avg_days) ? a.avg_days + T(' 天') : '—'], [T('最多连亏'), a.max_streak != null ? a.max_streak + T(' 笔') : '—'], [T('最好'), pct(a.best, 1), 'up'], [T('最差'), pct(a.worst, 1), 'dn']]));
    if (b.curve && b.curve.length > 1) h += pn(ttl(T('EQUITY 模拟累计')), T('已结束的累计 · ') + md(b.curve[0][0]) + ' ~ ' + md(b.curve[b.curve.length - 1][0]),
      blockChart([0].concat(b.curve.map(function (c) { return R(c[1]); })), { rows: 8, zero: true, label: T('账户资金曲线'), fmt: function (v) { return (v >= 0 ? '+' : '') + (v / 1000).toFixed(1) + 'k'; },
        color: function (v) { return v >= 0 ? 'acc' : 'dn'; }, dates: [md(b.curve[0][0]), md(b.curve[b.curve.length - 1][0])] }));
    var ex = a.exits || {}, tot = Object.keys(ex).reduce(function (s, k) { return s + ex[k]; }, 0) || 1;
    h += pn(ttl(T('ENDS 结束原因')), a.closed + T(' 笔'), '<pre class="txt">' + Object.keys(ex).sort(function (x, y) { return ex[y] - ex[x]; }).map(function (k) {
      return cell(esc(EXIT[k] || k), LANG === 'en' ? 12 : 10) + span('acc', meter(ex[k] / tot, 20)) + ' ' + pad(ex[k], 3, true); }).join('\n') + '</pre>');
    var p = b.paper || {}, ps = p.stats || {};
    if (p.trades && p.trades.length) h += pn(ttl(T('PAPER 模拟账户')), md(p.start) + T(' 起 · 胜率 ') + (isNum(ps.win_rate) ? ps.win_rate.toFixed(0) + '%' : '—'),
      '<div class="rows">' + p.trades.slice().sort(function (x, y) { return (y.entry_date || '') < (x.entry_date || '') ? -1 : 1; }).map(function (t) {
        var v = t.reason === 'open' ? t.ret : t.net, s = ST[t.code] || { code: t.code, name: t.name };
        return stockBtn(s, '<span class="' + cls(v) + ' b">' + pct(v, 1) + '</span><br><span class="sub">' + rm(R(v)) + '</span>',
          md(t.entry_date) + ' ' + px(t.entry) + ' → ' + px(t.exit) + ' · ' + (EXIT[t.reason] || t.reason) + ' · ' + t.days + T(' 天'));
      }).join('') + '</div>');
    if (b.monthly && b.monthly.length) h += pn(ttl(T('EVERY 每个信号都计入')), (b.every && b.every.closed) + T(' 笔 · 胜 ') + (b.every && isNum(b.every.win_rate) ? b.every.win_rate.toFixed(0) + '%' : '—') + T(' · 均 ') + pct(b.every && b.every.avg),
      '<pre class="txt">' + span('dim', 'MONTH    N    WIN               AVG') + '\n' + b.monthly.map(function (m) {
        return m[0] + ' ' + pad(m[1], 4, true) + '  ' + span(m[2] >= 50 ? 'up' : m[2] < 30 ? 'dn' : 'acc', meter(m[2] / 100, 10)) + ' ' + pad(m[2].toFixed(0) + '%', 4, true) + ' ' + span(cls(m[3]), pad(pct(m[3], 1), 7, true)); }).join('\n') + '</pre>');
    return h;
  }

  // ---------- 自定义回测：自己选进场条件 / 股票 (一支或几支合计) / 时间，在浏览器里用个股 2 年日线 (../stock/<代码>.json) 重算 ----------
  // 结束条件是后台规则的简化版：涨幅达标、跌破 EMA20 连 2 天、趋势转坏 (Supertrend / SAR 转空 / 放量抛售 / EMA5<EMA20 坏 2 项)、跌幅 %、最长天数
  // ---------- 回测用的指标库 (公式是公开的标准算法，默认参数跟一般看盘软件一样) ----------
  // 每个指标：k、分组、名称、参数 [key, 中文, English, 默认, 最小, 最大, 步长]、输出线 [key, 中文, English]、单位、算法 fn(X, p, o) → 每根 K 线一个值 (算不出来 = null)
  // X = 一支股票的资料 + 快取：X.c / o / h / l / v (数组)、X.b (K 线)、X.fin (季报)、X.m(key, fn) 记住算过的
  var IND = {}, INDK = [];
  function ind(k, g, zh, en, p, out, u, fn, d) { IND[k] = { k: k, g: g, zh: zh, en: en, p: p || [], out: out || null, u: u || '', fn: fn, d: d || null }; INDK.push(k); }
  var IG = [['px', '价格', 'Price'], ['ma', '均线', 'Moving averages'], ['osc', '动能', 'Oscillators'], ['trend', '趋势', 'Trend'], ['vola', '波动 / 通道', 'Volatility / channels'], ['volu', '成交量', 'Volume'], ['pat', '形态', 'Patterns'], ['fin', '财务 (季报)', 'Financials (quarterly)']];
  var N = function (d) { return ['n', '周期', 'Length', d, 1, 500, 1]; };
  function arr(n) { var a = new Array(n); for (var i = 0; i < n; i++) a[i] = null; return a; }
  function nn(x) { return x != null && isFinite(x); }
  function smaA(a, n) {  // 最近 n 个都有值才算
    var out = arr(a.length), s = 0, bad = 0;
    for (var i = 0; i < a.length; i++) {
      if (nn(a[i])) s += a[i]; else bad++;
      if (i >= n) { if (nn(a[i - n])) s -= a[i - n]; else bad--; }
      if (i >= n - 1 && !bad) out[i] = s / n;
    }
    return out;
  }
  function emaA(a, n) {  // 从第一个有值的开始 (跟终端原本的 EMA 一样)
    var k = 2 / (n + 1), e = null, out = arr(a.length);
    for (var i = 0; i < a.length; i++) { if (!nn(a[i])) { out[i] = e; continue; } e = e == null ? a[i] : a[i] * k + e * (1 - k); out[i] = e; }
    return out;
  }
  function rmaA(a, n) {  // Wilder 平滑：前 n 个取平均当起点
    var out = arr(a.length), e = null, s = 0, cnt = 0;
    for (var i = 0; i < a.length; i++) {
      if (!nn(a[i])) continue;
      if (e == null) { s += a[i]; cnt++; if (cnt === n) { e = s / n; out[i] = e; } continue; }
      e = (e * (n - 1) + a[i]) / n; out[i] = e;
    }
    return out;
  }
  function wmaA(a, n) {
    var out = arr(a.length), den = n * (n + 1) / 2;
    for (var i = n - 1; i < a.length; i++) { var s = 0, ok = true; for (var j = 0; j < n; j++) { var x = a[i - j]; if (!nn(x)) { ok = false; break; } s += x * (n - j); } if (ok) out[i] = s / den; }
    return out;
  }
  function hhA(a, n, prior) { var out = arr(a.length); for (var i = 0; i < a.length; i++) { var lo = i - n + (prior ? 0 : 1), hi = prior ? i - 1 : i; if (lo < 0) continue; var m = -Infinity; for (var j = lo; j <= hi; j++) if (a[j] > m) m = a[j]; out[i] = m; } return out; }
  function llA(a, n, prior) { var out = arr(a.length); for (var i = 0; i < a.length; i++) { var lo = i - n + (prior ? 0 : 1), hi = prior ? i - 1 : i; if (lo < 0) continue; var m = Infinity; for (var j = lo; j <= hi; j++) if (a[j] < m) m = a[j]; out[i] = m; } return out; }
  function sdA(a, n) {  // 总体标准差 (布林带用)
    var m = smaA(a, n), out = arr(a.length);
    for (var i = n - 1; i < a.length; i++) { if (m[i] == null) continue; var s = 0; for (var j = i - n + 1; j <= i; j++) s += (a[j] - m[i]) * (a[j] - m[i]); out[i] = Math.sqrt(s / n); }
    return out;
  }
  function trA(X) { return X.m('tr', function () { return X.c.map(function (_, i) { return i ? Math.max(X.h[i] - X.l[i], Math.abs(X.h[i] - X.c[i - 1]), Math.abs(X.l[i] - X.c[i - 1])) : X.h[i] - X.l[i]; }); }); }
  function mapA(n, f) { var out = arr(n); for (var i = 0; i < n; i++) { var v = f(i); out[i] = nn(v) ? v : null; } return out; }
  function lagA(a, d) { return a.map(function (_, i) { return i >= d ? a[i - d] : null; }); }
  function rsiA(c, n) {  // Wilder RSI
    var out = [null], g = 0, l = 0;
    for (var i = 1; i < c.length; i++) {
      var ch = c[i] - c[i - 1], up = Math.max(ch, 0), dn = Math.max(-ch, 0);
      if (i <= n) { g += up / n; l += dn / n; out.push(i === n ? (l ? 100 - 100 / (1 + g / l) : 100) : null); }
      else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; out.push(l ? 100 - 100 / (1 + g / l) : 100); }
    }
    return out;
  }
  function psarA(X, st, inc, mx) {  // 抛物线 SAR：值 + 趋势 (1 多 / -1 空)
    var b = X.b, n = b.length, val = arr(n), tr = arr(n), af = st, up = true, ep = b[0].h, sar = b[0].l;
    val[0] = sar; tr[0] = 1;
    for (var i = 1; i < n; i++) {
      sar = sar + af * (ep - sar);
      if (up) {
        sar = Math.min(sar, b[i - 1].l, i > 1 ? b[i - 2].l : b[i - 1].l);
        if (b[i].l < sar) { up = false; sar = ep; ep = b[i].l; af = st; }
        else if (b[i].h > ep) { ep = b[i].h; af = Math.min(mx, af + inc); }
      } else {
        sar = Math.max(sar, b[i - 1].h, i > 1 ? b[i - 2].h : b[i - 1].h);
        if (b[i].h > sar) { up = true; sar = ep; ep = b[i].h; af = st; }
        else if (b[i].l < ep) { ep = b[i].l; af = Math.min(mx, af + inc); }
      }
      val[i] = sar; tr[i] = up ? 1 : -1;
    }
    return { val: val, trend: tr };
  }
  function stA(X, n, m) {  // Supertrend：线 + 趋势
    var b = X.b, tr = trA(X), atr = [], a = null;
    tr.forEach(function (v, i) { a = i < n ? (a == null ? v : a + (v - a) / (i + 1)) : (a * (n - 1) + v) / n; atr.push(a); });
    var val = [], dirs = [], fu = null, fl = null, dir = 1;
    b.forEach(function (x, i) {
      var mid = (x.h + x.l) / 2, bu = mid + m * atr[i], bl = mid - m * atr[i];
      fu = fu == null || bu < fu || b[i - 1].c > fu ? bu : fu;
      fl = fl == null || bl > fl || b[i - 1].c < fl ? bl : fl;
      if (i) dir = x.c > fu ? 1 : x.c < fl ? -1 : dir;
      val.push(dir > 0 ? fl : fu); dirs.push(dir);
    });
    return { val: val, trend: dirs };
  }
  // 季报：季度结束 60 天后才当作公开 (年报 120 天)，回测某一天只用那天以前已经公开的
  function finAt(X) {
    return X.m('fin', function () {
      var F = X.fin, q = F && F.quarterly, an = F && F.annual, n = X.b.length, qi = arr(n), ai = arr(n);
      var add = function (d, days) { var t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + days); return t.toISOString().slice(0, 10); };
      var qa = q && q.periods ? q.periods.map(function (d) { return add(d, 60); }) : [], aa = an && an.periods ? an.periods.map(function (d) { return add(d, 120); }) : [];
      for (var i = 0; i < n; i++) {
        var d = X.b[i].d;
        for (var j = qa.length - 1; j >= 0; j--) if (qa[j] <= d) { qi[i] = j; break; }
        for (var k = aa.length - 1; k >= 0; k--) if (aa[k] <= d) { ai[i] = k; break; }
      }
      return { q: q || {}, a: an || {}, qi: qi, ai: ai };
    });
  }
  function finA(X, f) {
    return X.m('f:' + f, function () {
      var P = finAt(X), q = P.q, a = P.a, g = function (k, j) { var s = q[k]; return s && j != null && j >= 0 ? s[j] : null; }, ga = function (k, j) { var s = a[k]; return s && j != null && j >= 0 ? s[j] : null; };
      var pct = function (x, y) { return nn(x) && nn(y) && y > 0 ? (x / y - 1) * 100 : null; };
      var ttm = function (k, j) { if (j == null || j < 3) return null; var s = 0; for (var t = j - 3; t <= j; t++) { var v = g(k, t); if (!nn(v)) return null; s += v; } return s; };
      var epsY = function (i) { var j = P.qi[i], t = ttm('eps', j); if (nn(t)) return t; var y = ga('eps', P.ai[i]); if (nn(y)) return y; var e = g('eps', j); return nn(e) ? e * 4 : null; };
      var niY = function (i) { var j = P.qi[i], t = ttm('net_income', j); if (nn(t)) return t; var y = ga('net_income', P.ai[i]); if (nn(y)) return y; var e = g('net_income', j); return nn(e) ? e * 4 : null; };
      var shares = function (j) { var ni = g('net_income', j), e = g('eps', j); return nn(ni) && nn(e) && e !== 0 && ni / e > 0 ? ni / e : null; };
      return mapA(X.b.length, function (i) {
        var j = P.qi[i], c = X.c[i];
        switch (f) {
          case 'rev': return g('revenue', j);
          case 'ni': return g('net_income', j);
          case 'eps': return g('eps', j);
          case 'eps_ttm': return ttm('eps', j);
          case 'pe': var e = epsY(i); return nn(e) && e > 0 ? c / e : null;
          case 'pb': var sh = shares(j), eq = g('equity', j); return sh && nn(eq) && eq > 0 ? c / (eq / sh) : null;
          case 'mcap': var s2 = shares(j); return s2 ? c * s2 : null;
          case 'rev_qoq': return pct(g('revenue', j), g('revenue', j - 1));
          case 'ni_qoq': return pct(g('net_income', j), g('net_income', j - 1));
          case 'rev_yoy': return pct(g('revenue', j), g('revenue', j - 4));
          case 'ni_yoy': return pct(g('net_income', j), g('net_income', j - 4));
          case 'gm': var r1 = g('revenue', j), gp = g('gross_profit', j); return nn(r1) && r1 > 0 && nn(gp) ? gp / r1 * 100 : null;
          case 'om': var r2 = g('revenue', j), op = g('operating_income', j); return nn(r2) && r2 > 0 && nn(op) ? op / r2 * 100 : null;
          case 'nm': var r3 = g('revenue', j), n3 = g('net_income', j); return nn(r3) && r3 > 0 && nn(n3) ? n3 / r3 * 100 : null;
          case 'roe': var ny = niY(i), eq2 = g('equity', j); return nn(ny) && nn(eq2) && eq2 > 0 ? ny / eq2 * 100 : null;
          case 'de': var td = g('total_debt', j), eq3 = g('equity', j); return nn(eq3) && eq3 > 0 ? (nn(td) ? td : 0) / eq3 : null;
          case 'cash': return g('cash', j);
          case 'fcf': return g('free_cf', j);
          case 'ocf': return g('operating_cf', j);
        }
        return null;
      });
    });
  }
  // 价格
  ind('close', 'px', '收盘价', 'Close', [], null, '', function (X) { return X.c; }, { op: 'gt', r: { k: 'ema', p: [20] } });
  ind('open', 'px', '开盘价', 'Open', [], null, '', function (X) { return X.o; }, { op: 'gt', r: { k: 'close' } });
  ind('high', 'px', '最高价', 'High', [], null, '', function (X) { return X.h; }, { op: 'gt', r: { k: 'hh', p: [20] } });
  ind('low', 'px', '最低价', 'Low', [], null, '', function (X) { return X.l; }, { op: 'lt', r: { k: 'll', p: [20] } });
  ind('chg', 'px', '当日涨跌', 'Change', [], null, '%', function (X) { return mapA(X.c.length, function (i) { return i && X.c[i - 1] > 0 ? (X.c[i] / X.c[i - 1] - 1) * 100 : null; }); }, { op: 'gt', v: 3 });
  ind('perf', 'px', 'N 日涨跌', 'Performance', [['n', '天数', 'Days', 20, 1, 500, 1]], null, '%', function (X, p) { return mapA(X.c.length, function (i) { return i >= p[0] && X.c[i - p[0]] > 0 ? (X.c[i] / X.c[i - p[0]] - 1) * 100 : null; }); }, { op: 'gt', v: 10 });
  ind('gap', 'px', '跳空', 'Gap', [], null, '%', function (X) { return mapA(X.c.length, function (i) { return i && X.c[i - 1] > 0 ? (X.o[i] / X.c[i - 1] - 1) * 100 : null; }); }, { op: 'gt', v: 2 });
  ind('hh', 'px', '前 N 日最高收盘', 'Highest close (prev N)', [['n', '天数', 'Days', 20, 1, 500, 1]], null, '', function (X, p) { return hhA(X.c, p[0], true); }, null);
  ind('ll', 'px', '前 N 日最低收盘', 'Lowest close (prev N)', [['n', '天数', 'Days', 20, 1, 500, 1]], null, '', function (X, p) { return llA(X.c, p[0], true); }, null);
  // 均线
  ind('sma', 'ma', 'SMA 简单均线', 'SMA', [N(20)], null, '', function (X, p) { return smaA(X.c, p[0]); }, null);
  ind('ema', 'ma', 'EMA 指数均线', 'EMA', [N(20)], null, '', function (X, p) { return emaA(X.c, p[0]); }, null);
  ind('wma', 'ma', 'WMA 加权均线', 'WMA', [N(20)], null, '', function (X, p) { return wmaA(X.c, p[0]); }, null);
  ind('hma', 'ma', 'HMA 赫尔均线', 'Hull MA', [N(20)], null, '', function (X, p) { var n = p[0], h = Math.max(1, Math.round(n / 2)), w1 = wmaA(X.c, h), w2 = wmaA(X.c, n); return wmaA(w1.map(function (x, i) { return nn(x) && nn(w2[i]) ? 2 * x - w2[i] : null; }), Math.max(1, Math.round(Math.sqrt(n)))); }, null);
  ind('vwma', 'ma', 'VWMA 量加权均线', 'VWMA', [N(20)], null, '', function (X, p) { var pv = smaA(X.c.map(function (c, i) { return c * X.v[i]; }), p[0]), vv = smaA(X.v, p[0]); return pv.map(function (x, i) { return nn(x) && vv[i] > 0 ? x / vv[i] : null; }); }, null);
  // 动能
  ind('rsi', 'osc', 'RSI 相对强弱', 'RSI', [N(14)], null, '', function (X, p) { return rsiA(X.c, p[0]); }, { op: 'lt', v: 30 });
  ind('stoch', 'osc', 'KD 随机指标', 'Stochastic', [['k', '%K 周期', '%K length', 14, 1, 200, 1], ['s', '%K 平滑', '%K smoothing', 3, 1, 50, 1], ['d', '%D 平滑', '%D smoothing', 3, 1, 50, 1]], [['k', '%K', '%K'], ['d', '%D', '%D']], '',
    function (X, p, o) { var raw = X.m('stk:' + p[0], function () { var H = hhA(X.h, p[0]), L = llA(X.l, p[0]); return mapA(X.c.length, function (i) { return H[i] != null && H[i] > L[i] ? (X.c[i] - L[i]) / (H[i] - L[i]) * 100 : H[i] != null ? 50 : null; }); }); var K = smaA(raw, p[1]); return o === 'd' ? smaA(K, p[2]) : K; }, { op: 'xup', r: { k: 'stoch', o: 'd' } });
  ind('stochrsi', 'osc', '随机 RSI', 'Stoch RSI', [['r', 'RSI 周期', 'RSI length', 14, 2, 200, 1], ['s', '随机周期', 'Stoch length', 14, 1, 200, 1], ['k', '%K 平滑', '%K smoothing', 3, 1, 50, 1], ['d', '%D 平滑', '%D smoothing', 3, 1, 50, 1]], [['k', '%K', '%K'], ['d', '%D', '%D']], '',
    function (X, p, o) { var r = rsiA(X.c, p[0]), H = hhA(r.map(function (x) { return x == null ? -Infinity : x; }), p[1]), L = llA(r.map(function (x) { return x == null ? Infinity : x; }), p[1]);
      var raw = mapA(r.length, function (i) { return nn(H[i]) && nn(L[i]) && r[i] != null ? (H[i] > L[i] ? (r[i] - L[i]) / (H[i] - L[i]) * 100 : 50) : null; }), K = smaA(raw, p[2]); return o === 'd' ? smaA(K, p[3]) : K; }, { op: 'xup', r: { k: 'stochrsi', o: 'd' } });
  ind('macd', 'osc', 'MACD', 'MACD', [['f', '快线', 'Fast', 12, 1, 200, 1], ['s', '慢线', 'Slow', 26, 1, 300, 1], ['g', '信号线', 'Signal', 9, 1, 100, 1]], [['line', 'MACD 线', 'MACD line'], ['sig', '信号线', 'Signal'], ['hist', '柱状图', 'Histogram']], '',
    function (X, p, o) { var line = X.m('macd:' + p[0] + ',' + p[1], function () { var f = emaA(X.c, p[0]), s = emaA(X.c, p[1]); return f.map(function (x, i) { return x - s[i]; }); }); if (o === 'line') return line; var sig = emaA(line, p[2]); return o === 'sig' ? sig : line.map(function (x, i) { return x - sig[i]; }); }, { op: 'xup', r: { k: 'macd', o: 'sig' } });
  ind('cci', 'osc', 'CCI 顺势指标', 'CCI', [N(20)], null, '', function (X, p) { var n = p[0], tp = X.c.map(function (c, i) { return (X.h[i] + X.l[i] + c) / 3; }), m = smaA(tp, n);
    return mapA(tp.length, function (i) { if (m[i] == null) return null; var d = 0; for (var j = i - n + 1; j <= i; j++) d += Math.abs(tp[j] - m[i]); d /= n; return d ? (tp[i] - m[i]) / (0.015 * d) : 0; }); }, { op: 'lt', v: -100 });
  ind('wr', 'osc', '威廉指标 %R', 'Williams %R', [N(14)], null, '', function (X, p) { var H = hhA(X.h, p[0]), L = llA(X.l, p[0]); return mapA(X.c.length, function (i) { return H[i] != null && H[i] > L[i] ? (H[i] - X.c[i]) / (H[i] - L[i]) * -100 : null; }); }, { op: 'lt', v: -80 });
  ind('mom', 'osc', '动量', 'Momentum', [N(10)], null, '', function (X, p) { return mapA(X.c.length, function (i) { return i >= p[0] ? X.c[i] - X.c[i - p[0]] : null; }); }, { op: 'gt', v: 0 });
  ind('roc', 'osc', 'ROC 变动率', 'Rate of change', [N(10)], null, '%', function (X, p) { return mapA(X.c.length, function (i) { return i >= p[0] && X.c[i - p[0]] > 0 ? (X.c[i] / X.c[i - p[0]] - 1) * 100 : null; }); }, { op: 'gt', v: 0 });
  ind('mfi', 'osc', 'MFI 资金流量', 'Money flow index', [N(14)], null, '', function (X, p) { var n = p[0], tp = X.c.map(function (c, i) { return (X.h[i] + X.l[i] + c) / 3; });
    return mapA(tp.length, function (i) { if (i < n) return null; var pos = 0, neg = 0; for (var j = i - n + 1; j <= i; j++) { var f = tp[j] * X.v[j]; if (tp[j] > tp[j - 1]) pos += f; else if (tp[j] < tp[j - 1]) neg += f; } return neg ? 100 - 100 / (1 + pos / neg) : 100; }); }, { op: 'lt', v: 20 });
  ind('ao', 'osc', 'AO 动量震荡', 'Awesome oscillator', [['f', '快线', 'Fast', 5, 1, 100, 1], ['s', '慢线', 'Slow', 34, 1, 300, 1]], null, '', function (X, p) { var hl = X.h.map(function (h, i) { return (h + X.l[i]) / 2; }), f = smaA(hl, p[0]), s = smaA(hl, p[1]); return f.map(function (x, i) { return nn(x) && nn(s[i]) ? x - s[i] : null; }); }, { op: 'xup', v: 0 });
  // 趋势
  ind('sar', 'trend', '抛物线 SAR', 'Parabolic SAR', [['st', '起始', 'Start', 0.02, 0.001, 1, 0.001], ['inc', '步长', 'Increment', 0.02, 0.001, 1, 0.001], ['mx', '最大值', 'Max', 0.2, 0.01, 1, 0.01]], [['val', 'SAR 值', 'SAR value'], ['trend', '方向 (1 多 / -1 空)', 'Direction (1 up / -1 down)']], '',
    function (X, p, o) { var r = X.m('sar:' + p.join(','), function () { return psarA(X, p[0], p[1], p[2]); }); return r[o]; }, { l: { k: 'close' }, op: 'xup', r: { k: 'sar', o: 'val' } });
  ind('st', 'trend', 'Supertrend', 'Supertrend', [['n', 'ATR 周期', 'ATR length', 10, 1, 200, 1], ['m', '倍数', 'Multiplier', 3, 0.1, 20, 0.1]], [['val', '线', 'Line'], ['trend', '方向 (1 多 / -1 空)', 'Direction (1 up / -1 down)']], '',
    function (X, p, o) { var r = X.m('st:' + p.join(','), function () { return stA(X, p[0], p[1]); }); return r[o]; }, { l: { k: 'close' }, op: 'gt', r: { k: 'st', o: 'val' } });
  ind('adx', 'trend', 'ADX / DMI', 'ADX / DMI', [['n', 'DI 周期', 'DI length', 14, 1, 200, 1], ['s', 'ADX 平滑', 'ADX smoothing', 14, 1, 200, 1]], [['adx', 'ADX', 'ADX'], ['pdi', '+DI', '+DI'], ['mdi', '-DI', '-DI']], '',
    function (X, p, o) { var r = X.m('dmi:' + p[0], function () { var up = [0], dn = [0];
        for (var i = 1; i < X.c.length; i++) { var u = X.h[i] - X.h[i - 1], d = X.l[i - 1] - X.l[i]; up.push(u > d && u > 0 ? u : 0); dn.push(d > u && d > 0 ? d : 0); }
        var tr = rmaA(trA(X), p[0]), pu = rmaA(up, p[0]), pd = rmaA(dn, p[0]);
        return { pdi: mapA(tr.length, function (i) { return tr[i] ? 100 * pu[i] / tr[i] : null; }), mdi: mapA(tr.length, function (i) { return tr[i] ? 100 * pd[i] / tr[i] : null; }) }; });
      if (o !== 'adx') return r[o];
      var dx = mapA(r.pdi.length, function (i) { var s = r.pdi[i] + r.mdi[i]; return nn(s) ? (s ? 100 * Math.abs(r.pdi[i] - r.mdi[i]) / s : 0) : null; }); return rmaA(dx, p[1]); }, { op: 'gt', v: 25 });
  ind('aroon', 'trend', 'Aroon', 'Aroon', [N(25)], [['up', '上升线', 'Up'], ['dn', '下降线', 'Down'], ['osc', '震荡值', 'Oscillator']], '',
    function (X, p, o) { var n = p[0]; return mapA(X.c.length, function (i) { if (i < n) return null; var hi = i, lo = i; for (var j = i - n; j <= i; j++) { if (X.h[j] >= X.h[hi]) hi = j; if (X.l[j] <= X.l[lo]) lo = j; }
      var u = 100 * (n - (i - hi)) / n, d = 100 * (n - (i - lo)) / n; return o === 'up' ? u : o === 'dn' ? d : u - d; }); }, { op: 'gt', v: 70 });
  ind('ichi', 'trend', '一目均衡表', 'Ichimoku', [['c', '转换线', 'Conversion', 9, 1, 100, 1], ['b', '基准线', 'Base', 26, 1, 200, 1], ['s', '先行带 B', 'Span B', 52, 1, 300, 1]], [['conv', '转换线', 'Conversion line'], ['base', '基准线', 'Base line'], ['a', '先行带 A (云)', 'Leading span A (cloud)'], ['b', '先行带 B (云)', 'Leading span B (cloud)']], '',
    function (X, p, o) { var mid = function (n) { var H = hhA(X.h, n), L = llA(X.l, n); return H.map(function (x, i) { return x != null ? (x + L[i]) / 2 : null; }); };
      var cv = mid(p[0]), bs = mid(p[1]); if (o === 'conv') return cv; if (o === 'base') return bs;
      var raw = o === 'a' ? cv.map(function (x, i) { return nn(x) && nn(bs[i]) ? (x + bs[i]) / 2 : null; }) : mid(p[2]); return lagA(raw, p[1]); }, { l: { k: 'close' }, op: 'gt', r: { k: 'ichi', o: 'a' } });
  // 波动 / 通道
  ind('bb', 'vola', '布林带', 'Bollinger Bands', [N(20), ['m', '标准差倍数', 'StdDev', 2, 0.1, 10, 0.1]], [['up', '上轨', 'Upper'], ['mid', '中轨', 'Basis'], ['lo', '下轨', 'Lower'], ['pb', '%B', '%B'], ['w', '带宽 %', 'Bandwidth %']], '',
    function (X, p, o) { var m = smaA(X.c, p[0]), sd = sdA(X.c, p[0]);
      return mapA(X.c.length, function (i) { if (m[i] == null || sd[i] == null) return null; var u = m[i] + p[1] * sd[i], l = m[i] - p[1] * sd[i];
        return o === 'up' ? u : o === 'lo' ? l : o === 'mid' ? m[i] : o === 'pb' ? (u > l ? (X.c[i] - l) / (u - l) : null) : (m[i] ? (u - l) / m[i] * 100 : null); }); }, { l: { k: 'close' }, op: 'gt', r: { k: 'bb', o: 'up' } });
  ind('kc', 'vola', '肯特纳通道', 'Keltner Channels', [N(20), ['m', '倍数', 'Multiplier', 2, 0.1, 10, 0.1], ['a', 'ATR 周期', 'ATR length', 10, 1, 200, 1]], [['up', '上轨', 'Upper'], ['mid', '中轨', 'Basis'], ['lo', '下轨', 'Lower']], '',
    function (X, p, o) { var m = emaA(X.c, p[0]), a = rmaA(trA(X), p[2]); return mapA(X.c.length, function (i) { return a[i] == null ? null : o === 'up' ? m[i] + p[1] * a[i] : o === 'lo' ? m[i] - p[1] * a[i] : m[i]; }); }, { l: { k: 'close' }, op: 'gt', r: { k: 'kc', o: 'up' } });
  ind('dc', 'vola', '唐奇安通道', 'Donchian Channels', [N(20)], [['up', '上轨', 'Upper'], ['mid', '中轨', 'Basis'], ['lo', '下轨', 'Lower']], '',
    function (X, p, o) { var H = hhA(X.h, p[0]), L = llA(X.l, p[0]); return H.map(function (x, i) { return x == null ? null : o === 'up' ? x : o === 'lo' ? L[i] : (x + L[i]) / 2; }); }, { l: { k: 'close' }, op: 'ge', r: { k: 'dc', o: 'up' } });
  ind('atr', 'vola', 'ATR 真实波幅', 'ATR', [N(14)], null, '', function (X, p) { return rmaA(trA(X), p[0]); }, null);
  ind('atrp', 'vola', 'ATR % (占股价)', 'ATR % of price', [N(14)], null, '%', function (X, p) { var a = rmaA(trA(X), p[0]); return a.map(function (x, i) { return nn(x) && X.c[i] > 0 ? x / X.c[i] * 100 : null; }); }, { op: 'gt', v: 3 });
  // 成交量
  ind('vol', 'volu', '成交量', 'Volume', [], null, '', function (X) { return X.v; }, { op: 'ge', v: 1e6 });
  ind('volsma', 'volu', '均量', 'Volume SMA', [N(20)], null, '', function (X, p) { return smaA(X.v, p[0]); }, null);
  ind('rvol', 'volu', '相对量 (对比前 N 日均量)', 'Relative volume (vs prev N-day avg)', [N(20)], null, '×', function (X, p) { var a = smaA(X.v, p[0]); return mapA(X.v.length, function (i) { return i && a[i - 1] > 0 ? X.v[i] / a[i - 1] : null; }); }, { op: 'ge', v: 2 });
  ind('tov', 'volu', '成交额', 'Value traded', [], null, 'RM', function (X) { return X.c.map(function (c, i) { return c * X.v[i]; }); }, { op: 'ge', v: 1e6 });
  ind('obv', 'volu', 'OBV 能量潮', 'On-balance volume', [], null, '', function (X) { var s = 0; return X.c.map(function (c, i) { if (i) s += c > X.c[i - 1] ? X.v[i] : c < X.c[i - 1] ? -X.v[i] : 0; return s; }); }, { op: 'up', w: 5 });
  ind('cmf', 'volu', 'CMF 蔡金资金流', 'Chaikin money flow', [N(20)], null, '', function (X, p) { var mfv = X.c.map(function (c, i) { var r = X.h[i] - X.l[i]; return r ? ((c - X.l[i]) - (X.h[i] - c)) / r * X.v[i] : 0; }), a = smaA(mfv, p[0]), b = smaA(X.v, p[0]); return a.map(function (x, i) { return nn(x) && b[i] > 0 ? x / b[i] : null; }); }, { op: 'gt', v: 0 });
  // 形态 (是 / 否)：用确认过的高低点 (左右各 k 根 K 线，k 根之后才确认，不偷看未来)
  function pivots(X, k) {
    return X.m('piv:' + k, function () {
      var h = X.h, l = X.l, his = [], los = [];
      for (var i = 2 * k; i < h.length; i++) {
        var p = i - k, okH = true, okL = true;
        for (var t = 1; t <= k; t++) { if (!(h[p] > h[p - t]) || !(h[p] >= h[p + t])) okH = false; if (!(l[p] < l[p - t]) || !(l[p] <= l[p + t])) okL = false; }
        if (okH) his.push({ p: p, v: h[p] }); if (okL) los.push({ p: p, v: l[p] });
      }
      return { hi: his, lo: los };
    });
  }
  function pivIn(list, i, n, k) {  // i 那天以前已经确认、而且在最近 n 天内的高 / 低点 (旧到新)
    var out = [];
    for (var j = list.length - 1; j >= 0; j--) { var x = list[j]; if (x.p + k > i) continue; if (x.p < i - n) break; out.unshift(x); }
    return out;
  }
  ind('hhhl', 'pat', '上升结构 (更高的高点和低点)', 'Uptrend structure (higher highs and lows)', [['n', '最近几天', 'Within days', 30, 5, 250, 1], ['k', '高低点确认 (左右各几根)', 'Pivot strength (bars each side)', 2, 1, 10, 1]], null, '',
    function (X, p) { var P = pivots(X, p[1]); return mapA(X.c.length, function (i) { var H = pivIn(P.hi, i, p[0], p[1]), L = pivIn(P.lo, i, p[0], p[1]);
      return H.length >= 2 && L.length >= 2 && H[H.length - 1].v > H[H.length - 2].v && L[L.length - 1].v > L[L.length - 2].v ? 1 : 0; }); }, { op: 'gt', v: 0 });
  ind('nshape', 'pat', 'N 字形 (涨 → 回调出更高的低点 → 再涨)', 'N-shape (rally, pullback to a higher low, rising again)', [['n', '最近几天', 'Within days', 30, 5, 250, 1], ['k', '高低点确认 (左右各几根)', 'Pivot strength (bars each side)', 2, 1, 10, 1], ['b', '要突破前高 (1 要 / 0 不用)', 'Must break the prior high (1 yes / 0 no)', 0, 0, 1, 1]], null, '',
    function (X, p) { var P = pivots(X, p[1]); return mapA(X.c.length, function (i) {
      var L = pivIn(P.lo, i, p[0], p[1]); if (L.length < 2) return 0;
      var L2 = L[L.length - 1], L1 = L[L.length - 2]; if (!(L2.v > L1.v)) return 0;              // 回调的低点比前一个低点高 (HL)
      var H1 = null; P.hi.forEach(function (x) { if (x.p > L1.p && x.p < L2.p && (!H1 || x.v > H1.v)) H1 = x; }); if (!H1) return 0;  // 中间有一段上涨的高点
      for (var j = L2.p + 1; j <= i; j++) if (X.l[j] < L2.v) return 0;                            // 之后没有再跌破这个低点
      if (!(X.c[i] > X.c[L2.p])) return 0;                                                        // 已经再涨
      return p[2] >= 1 && !(X.c[i] > H1.v) ? 0 : 1; }); }, { op: 'gt', v: 0 });
  IND.hhhl.b = IND.nshape.b = 1;  // 是 / 否 的指标
  // 财务 (季报)
  [['pe', '本益比 P/E', 'P/E ratio', '', { op: 'in', v: 5, v2: 15 }], ['pb', '股价净值比 P/B', 'P/B ratio', '', { op: 'lt', v: 1 }], ['mcap', '市值', 'Market cap', 'RM', { op: 'ge', v: 1e8 }],
   ['eps', '每股盈利 (季)', 'EPS (quarter)', 'RM', { op: 'gt', v: 0 }], ['eps_ttm', '每股盈利 (近 4 季)', 'EPS (TTM)', 'RM', { op: 'gt', v: 0 }],
   ['rev', '营收 (季)', 'Revenue (quarter)', 'RM', { op: 'ge', v: 1e7 }], ['ni', '净利润 (季)', 'Net income (quarter)', 'RM', { op: 'gt', v: 0 }],
   ['rev_qoq', '营收按季增长', 'Revenue growth QoQ', '%', { op: 'gt', v: 0 }], ['ni_qoq', '净利按季增长', 'Net income growth QoQ', '%', { op: 'gt', v: 0 }],
   ['rev_yoy', '营收按年增长', 'Revenue growth YoY', '%', { op: 'gt', v: 10 }], ['ni_yoy', '净利按年增长', 'Net income growth YoY', '%', { op: 'gt', v: 10 }],
   ['gm', '毛利率', 'Gross margin', '%', { op: 'gt', v: 30 }], ['om', '营业利润率', 'Operating margin', '%', { op: 'gt', v: 10 }], ['nm', '净利率', 'Net margin', '%', { op: 'gt', v: 10 }],
   ['roe', 'ROE 股东权益回报', 'Return on equity', '%', { op: 'gt', v: 15 }], ['de', '负债权益比', 'Debt / equity', '', { op: 'lt', v: 0.5 }],
   ['cash', '现金', 'Cash', 'RM', { op: 'gt', v: 0 }], ['ocf', '营运现金流 (季)', 'Operating cash flow (quarter)', 'RM', { op: 'gt', v: 0 }], ['fcf', '自由现金流 (季)', 'Free cash flow (quarter)', 'RM', { op: 'gt', v: 0 }]
  ].forEach(function (f) { ind(f[0], 'fin', f[1], f[2], [], null, f[3], function (X) { return finA(X, f[0]); }, f[4]); });
  // ---------- 进场条件 = 左边 (指标 + 参数 + 哪一条线)、比较方式、右边 (数值，或另一个指标) ----------
  // {l: {k, p, o}, op, r: {k, p, o} | null, v, v2, w}；特别的旧条件 {t: 'ema50'} (价格或 EMA5 高于 EMA50) 保留
  var OPS = {  // [中文, English, 符号, 右边要什么 (rv 数值或指标 / ri 指标 + % / range 区间 / none 不用), 有天数栏]
    gt: ['高于', 'Above', '>', 'rv'], ge: ['高于或等于', 'Above or equal', '≥', 'rv'], lt: ['低于', 'Below', '<', 'rv'], le: ['低于或等于', 'Below or equal', '≤', 'rv'],
    x: ['穿越 (任一方向)', 'Crosses', '⇅', 'rv', 1], xup: ['上穿', 'Crosses above', '↗', 'rv', 1], xdn: ['下穿', 'Crosses below', '↘', 'rv', 1],
    in: ['介于', 'Between', '∈', 'range'], out: ['不在区间内', 'Outside', '∉', 'range'],
    gtp: ['高于至少 X%', 'Above by at least X%', '>', 'ri'], ltp: ['低于至少 X%', 'Below by at least X%', '<', 'ri'],
    up: ['比 N 天前高', 'Higher than N days ago', '↑', 'none', 1], dn: ['比 N 天前低', 'Lower than N days ago', '↓', 'none', 1]
  };
  var OPK = ['gt', 'ge', 'lt', 'le', 'xup', 'xdn', 'x', 'in', 'out', 'gtp', 'ltp', 'up', 'dn'];
  var SH = { sma: 'SMA', ema: 'EMA', wma: 'WMA', hma: 'HMA', vwma: 'VWMA', rsi: 'RSI', stoch: 'KD', stochrsi: 'StochRSI', macd: 'MACD', cci: 'CCI', wr: '%R', mom: 'MOM', roc: 'ROC', mfi: 'MFI', ao: 'AO',
    sar: 'SAR', st: 'Supertrend', adx: 'DMI', aroon: 'Aroon', kc: 'KC', atr: 'ATR', atrp: 'ATR%', obv: 'OBV', cmf: 'CMF', pe: 'P/E', pb: 'P/B', roe: 'ROE' };
  var SHZ = { hhhl: ['上升结构', 'HH/HL'], nshape: ['N 字形', 'N-shape'], ichi: ['一目', 'Ichimoku'], bb: ['布林', 'BB'], dc: ['唐奇安', 'Donchian'], volsma: ['均量', 'Vol SMA'], rvol: ['相对量', 'RVOL'], perf: ['涨跌', 'Perf'], hh: ['前高', 'Prev high'], ll: ['前低', 'Prev low'], vol: ['成交量', 'Volume'], tov: ['成交额', 'Value'] };
  function opnd(s) {  // 整理一个指标 (参数补上默认值、限制范围)
    var d = s && IND[s.k]; if (!d) return null;
    var o = { k: s.k, p: d.p.map(function (q, j) { var x = s.p ? +s.p[j] : NaN; if (!isFinite(x)) x = q[3]; x = Math.max(q[4], Math.min(q[5], x)); return q[6] >= 1 ? Math.round(x) : +x.toFixed(4); }) };
    if (d.out) o.o = d.out.some(function (x) { return x[0] === s.o; }) ? s.o : d.out[0][0];
    return o;
  }
  function cbNew(k) {  // 「+ 条件」选了一个指标：用它最常用的写法
    if (k === '@ema50') return { t: 'ema50' };
    var d = IND[k], df = d.d || (k === 'll' ? { l: { k: 'close' }, op: 'lt', r: { k: 'll' } } : k === 'atr' ? { op: 'gt', v: 0.1 } : k === 'volsma' ? { l: { k: 'vol' }, op: 'gt', r: { k: 'volsma' } } : { l: { k: 'close' }, op: 'gt', r: { k: k } });
    return cbCond({ l: df.l || { k: k, o: df.lo }, op: df.op, r: df.r || null, v: df.v, v2: df.v2, w: df.w });
  }
  function cbCond(c) {  // 整理一个条件 (本机 / 同步来的)，不合法就丢掉
    if (!c) return null;
    if (c.t === 'ema50') return { t: 'ema50' };
    var l = opnd(c.l); if (!l) return null;
    if (IND[l.k].b) { var bq = { l: l, op: c.op === 'lt' ? 'lt' : 'gt' }; bq.v = bq.op === 'gt' ? 0 : 1; if (+c.d > 1) bq.d = Math.min(30, Math.round(+c.d)); return bq; }  // 是 / 否：成立 = > 0，不成立 = < 1
    var op = OPS[c.op] ? c.op : 'gt', need = OPS[op][3], q = { l: l, op: op }, num = function (x, df) { x = +x; return isFinite(x) ? x : df; };
    if (need === 'rv' || need === 'ri') { var r = opnd(c.r); if (r) q.r = r; else if (need === 'ri') { q.r = opnd({ k: 'ema', p: [20] }); } else q.v = num(c.v, 0); }
    if (need === 'ri') q.v = Math.max(0, num(c.v, 5));
    if (need === 'range') { var a = num(c.v, 0), b = num(c.v2, a + 10); q.v = Math.min(a, b); q.v2 = Math.max(a, b); }
    if (OPS[op][4]) q.w = Math.max(1, Math.min(250, Math.round(num(c.w, need === 'none' ? 5 : 1))));
    if (+c.d > 1) q.d = Math.min(30, Math.round(+c.d));
    return q;
  }
  var CB_DEF = [{ l: { k: 'sar', o: 'trend' }, op: 'xup', v: 0 }, { l: { k: 'close' }, op: 'gt', r: { k: 'ema', p: [20] } }, { l: { k: 'ema', p: [5] }, op: 'gt', r: { k: 'ema', p: [20] } },
    { l: { k: 'vol' }, op: 'ge', v: 1e6 }, { l: { k: 'close' }, op: 'gt', r: { k: 'st', p: [3, 1.4], o: 'val' } }, { t: 'ema50' }];  // = 后台策略
  var CB_OLD = { sar: CB_DEF[0], ema20: CB_DEF[1], ema5x20: CB_DEF[2], vol1m: CB_DEF[3], st: CB_DEF[4], ema50: CB_DEF[5],  // 旧版勾选框 → 新格式 (结果一样)
    cross: { l: { k: 'ema', p: [5] }, op: 'xup', r: { k: 'ema', p: [20] } }, bbup: { l: { k: 'close' }, op: 'gt', r: { k: 'bb', p: [20, 2], o: 'up' } }, rv2: { l: { k: 'rvol', p: [20] }, op: 'ge', v: 2 },
    rsi50: { l: { k: 'rsi', p: [14] }, op: 'gt', v: 50 }, rsi30: { l: { k: 'rsi', p: [14] }, op: 'lt', v: 30 }, hi20: { l: { k: 'close' }, op: 'gt', r: { k: 'hh', p: [20] } } };
  function cbConds(j) {  // 新格式 conds，或旧版的 rules {sar: true, ...}
    var out;
    if (j && Array.isArray(j.conds)) out = j.conds.map(cbCond).filter(Boolean);
    else if (j && j.rules && typeof j.rules === 'object') { out = []; Object.keys(CB_OLD).forEach(function (k) { if (j.rules[k]) out.push(cbCond(CB_OLD[k])); }); }
    else out = CB_DEF.map(cbCond);
    return out.slice(0, 15);
  }
  // 一支股票的计算环境 (指标算过就记住)
  function cbCtx(b, fin) { var X = { b: b, c: b.map(function (x) { return x.c; }), o: b.map(function (x) { return x.o; }), h: b.map(function (x) { return x.h; }), l: b.map(function (x) { return x.l; }), v: b.map(function (x) { return x.v; }), fin: fin, C: {} };
    X.m = function (k, f) { return k in X.C ? X.C[k] : (X.C[k] = f()); }; return X; }
  function cbSer(X, s) { var d = IND[s.k]; return X.m('i:' + s.k + ':' + s.p.join(',') + ':' + (s.o || ''), function () { return d.fn(X, s.p, s.o); }); }
  function cbWarm(conds) {  // 指标要多少根 K 线才稳定：最少 50 根，参数里最长的周期
    var w = 50, scan = function (s) { if (!s) return; IND[s.k].p.forEach(function (q, j) { if (q[6] >= 1) w = Math.max(w, s.p[j]); }); };
    conds.forEach(function (q) { if (q.t) return; scan(q.l); scan(q.r); if (q.w) w = Math.max(w, q.w); if (q.d) w = Math.max(w, q.d); }); return w;
  }
  function cbFn(X, q) {  // 一个条件 → function(i) 那天是否成立
    return (function () {
      if (q.t === 'ema50') { var c = X.c, e5 = cbSer(X, opnd({ k: 'ema', p: [5] })), e50 = cbSer(X, opnd({ k: 'ema', p: [50] })); return function (i) { return c[i] > e50[i] || e5[i] > e50[i]; }; }
      var L = cbSer(X, q.l), R = q.r ? cbSer(X, q.r) : null, need = OPS[q.op][3];
      var lv = function (j) { return j >= 0 ? L[j] : null; }, rv = function (j) { return R ? (j >= 0 ? R[j] : null) : q.v; };
      var crossAt = function (j, up) { var a = lv(j), b = rv(j), pa = lv(j - 1), pb = rv(j - 1); if (!nn(a) || !nn(b) || !nn(pa) || !nn(pb)) return false; return up ? a > b && pa <= pb : a < b && pa >= pb; };
      return function (i) {
        var a = lv(i), b;
        if (!nn(a)) return false;
        switch (q.op) {
          case 'gt': b = rv(i); return nn(b) && a > b;
          case 'ge': b = rv(i); return nn(b) && a >= b;
          case 'lt': b = rv(i); return nn(b) && a < b;
          case 'le': b = rv(i); return nn(b) && a <= b;
          case 'in': return a >= q.v && a <= q.v2;
          case 'out': return a < q.v || a > q.v2;
          case 'gtp': b = rv(i); return nn(b) && b > 0 && a >= b * (1 + q.v / 100);
          case 'ltp': b = rv(i); return nn(b) && b > 0 && a <= b * (1 - q.v / 100);
          case 'up': var pu = lv(i - q.w); return nn(pu) && a > pu;
          case 'dn': var pd = lv(i - q.w); return nn(pd) && a < pd;
        }
        for (var j = i; j > i - q.w; j--) {  // 穿越：最近 w 天内发生过
          if (q.op === 'xup' && crossAt(j, true)) return true;
          if (q.op === 'xdn' && crossAt(j, false)) return true;
          if (q.op === 'x' && (crossAt(j, true) || crossAt(j, false))) return true;
        }
        return false;
      };
    })();
  }
  function cbTest(X, conds) {  // → function(i) 那天全部条件是否成立 (d = 连续几天都成立)
    var fs = conds.map(function (q) { var f = cbFn(X, q), d = q.d || 1; return d > 1 ? function (i) { for (var t = 0; t < d; t++) if (!f(i - t)) return false; return true; } : f; });
    return function (i) { for (var k = 0; k < fs.length; k++) if (!fs[k](i)) return false; return true; };
  }
  // ---------- 显示 ----------
  function fmtV(v, u) {
    if (!nn(v)) return '—';
    var a = Math.abs(v), s = a >= 1e9 ? +(v / 1e9).toFixed(2) + 'B' : a >= 1e6 ? +(v / 1e6).toFixed(2) + 'M' : a >= 1e4 ? +(v / 1e3).toFixed(1) + 'K' : String(+v.toFixed(4));
    return u === 'RM' ? 'RM' + s : u === '%' ? s + '%' : u === '×' ? s + '×' : s;
  }
  function parseV(t) {  // 「1.5M」「200k」「3%」「1e6」都可以
    var m = /^\s*(-?[\d.]+(?:e[+-]?\d+)?)\s*([kmb])?\s*%?\s*$/i.exec(String(t).replace(/,/g, '').replace(/^RM/i, ''));
    if (!m) return NaN; var x = parseFloat(m[1]); return m[2] ? x * { k: 1e3, m: 1e6, b: 1e9 }[m[2].toLowerCase()] : x;
  }
  function indNm(k) { return Z(IND[k].zh, IND[k].en); }
  function opndLbl(s) {
    var d = IND[s.k], nm = SH[s.k] || (SHZ[s.k] ? Z(SHZ[s.k][0], SHZ[s.k][1]) : indNm(s.k));
    var o = d.out && d.out.length > 1 ? d.out.filter(function (x) { return x[0] === s.o; })[0] : null, on = o ? Z(o[1], o[2]).replace(/ \(.*\)$/, '') : '';
    if (o && o === d.out[0] && (on.indexOf(nm) >= 0 || /^(线|Line)$/.test(on))) on = '';  // 「MACD(12,26,9) MACD 线」→「MACD(12,26,9)」
    return nm + (s.p.length ? '(' + s.p.join(',') + ')' : '') + (on ? ' ' + on : '');
  }
  function cbLbl(q) {  // 标签上显示 [左边, 比较 + 右边]
    if (q.t === 'ema50') return [Z('价格或 EMA5', 'Price or EMA5'), '> EMA50'];
    if (IND[q.l.k].b) return [opndLbl(q.l), (q.op === 'lt' ? Z('不成立', 'not met') : Z('成立', 'met')) + (q.d > 1 ? Z(' · 连 ' + q.d + ' 天', ' · ' + q.d + 'd in a row') : '')];
    if (q.l.o === 'trend' && !q.r && q.v === 0 && /^(xup|xdn|gt|lt)$/.test(q.op)) {  // 方向 (1 / -1)：「↗ 0」看不懂，直接写转多 / 多头
      var tw = { xup: ['转多', 'flips up'], xdn: ['转空', 'flips down'], gt: ['多头', 'uptrend'], lt: ['空头', 'downtrend'] }[q.op];
      return [opndLbl(q.l).replace(/ (方向|Direction)$/, ''), Z(tw[0], tw[1]) + (OPS[q.op][4] && q.w > 1 ? Z(' (近 ' + q.w + ' 天)', ' (last ' + q.w + 'd)') : '') + (q.d > 1 ? Z(' · 连 ' + q.d + ' 天', ' · ' + q.d + 'd in a row') : '')];
    }
    var m = OPS[q.op], u = IND[q.l.k].u, sym = m[2], right = '';
    if (m[3] === 'rv') right = q.r ? opndLbl(q.r) : fmtV(q.v, u);
    else if (m[3] === 'ri') right = opndLbl(q.r) + ' +' + q.v + '%';
    else if (m[3] === 'range') right = fmtV(q.v, u) + ' – ' + fmtV(q.v2, u);
    if (q.op === 'ltp') right = opndLbl(q.r) + ' −' + q.v + '%';
    var tail = m[3] === 'none' ? Z(' ' + q.w + ' 天', ' ' + q.w + 'd') : m[4] && q.w > 1 ? Z(' (近 ' + q.w + ' 天)', ' (last ' + q.w + 'd)') : '';
    return [opndLbl(q.l), sym + (right ? ' ' + right : '') + tail + (q.d > 1 ? Z(' · 连 ' + q.d + ' 天', ' · ' + q.d + 'd in a row') : '')];
  }
  if (window.BTERM_TEST) window.BTERM_TEST.bt = { IND: IND, ctx: cbCtx, ser: cbSer, opnd: opnd, test: cbTest, cond: cbCond, conds: cbConds, exits: function (j) { return cbExits(j); }, stock: function () { return cbStock.apply(null, arguments); }, swing: function (X, k) { return swingLows(X, k); }, cands: function () { return cbCands.apply(null, arguments); }, done: function () { cbDone(); }, bars: function (c) { return bars(c); }, list: function () { return LIST; }, port: function () { return cbPort.apply(null, arguments); }, mc: function () { return cbMC.apply(null, arguments); } };  // 只给自动测试用
  var XS = {  // [中文, English, 参数 [key, 中文, English, 默认, 最小, 最大, 步长, 单位], 分组]
    stop: ['止损', 'Stop loss', [['v', '从进场价跌', 'Drop from entry', 10, 0.5, 90, 0.5, '%']], 'risk'],
    trail: ['移动止损', 'Trailing stop', [['v', '从持仓最高点回落', 'Drop from highest high', 10, 0.5, 90, 0.5, '%']], 'risk'],
    atr: ['ATR 移动止损', 'ATR trailing stop', [['n', 'ATR 周期', 'ATR length', 14, 1, 100, 1, ''], ['m', '倍数', 'Multiplier', 3, 0.5, 10, 0.1, '×']], 'risk'],
    take: ['止盈', 'Take profit', [['v', '从进场价涨', 'Gain from entry', 20, 0.5, 1000, 0.5, '%']], 'risk'],
    swing: ['跌破回调低点', 'Break of swing low', [['k', '低点确认 (左右各几根 K 线)', 'Pivot strength (bars each side)', 2, 1, 10, 1, '']], 'struct'],
    combo: ['趋势转坏', 'Trend turns down', [], 'struct'],
    hold: ['最长持有', 'Max holding', [['v', '天数', 'Days', 60, 1, 500, 1, '']], 'time']
  };
  var XG = [['risk', '价格止损 / 止盈', 'Price stops / targets'], ['struct', '趋势结构', 'Trend structure'], ['time', '时间', 'Time']];
  var CB_XDEF = [{ t: 'stop', v: 10 }, { t: 'swing', k: 2 }];  // 默认出场：止损 10% + 跌破最近回调低点 (让趋势跑)
  var CB = (function () {
    var d = { codes: [], from: '', to: '', q: '', uni: 'market', slots: 3, size: 20000, rank: 'tov', sz: 'fix', runs: 50, minpx: 0.1 }, j = null;
    try { j = JSON.parse(localStorage.getItem('bterm_cbt') || 'null'); if (j) Object.keys(d).forEach(function (k) { if (j[k] !== undefined) d[k] = j[k]; }); } catch (e) {}
    if (['market', 'pool', 'custom'].indexOf(d.uni) < 0) d.uni = 'market'; d.slots = Math.max(1, Math.min(50, Math.round(+d.slots) || 3)); d.size = Math.max(1000, Math.min(1e7, +d.size || 20000));
    d.minpx = Math.max(0, Math.min(100, +d.minpx || 0)); if (['tov', 'rvol', 'chg', 'rand'].indexOf(d.rank) < 0) d.rank = 'tov'; if (d.sz !== 'pct') d.sz = 'fix'; d.runs = [20, 50, 100].indexOf(+d.runs) >= 0 ? +d.runs : 50;
    d.conds = cbConds(j); d.exits = cbExits(j); d.q = ''; d.tlim = 60; d.sens = null; d.res = null; d.busy = false; d.err = ''; d.pop = null; d.cq = '';
    return d;
  })();
  function cbSave() { try { localStorage.setItem('bterm_cbt', JSON.stringify({ codes: CB.codes, from: CB.from, to: CB.to, conds: CB.conds, exits: CB.exits, uni: CB.uni, slots: CB.slots, size: CB.size, rank: CB.rank, sz: CB.sz, runs: CB.runs, minpx: CB.minpx })); } catch (e) {} syncSoon(); }
  // ---------- 回测策略模板 (只有网站管理员看得到；存在管理员自己的同步资料里，别人拿不到) ----------
  var TPL = (function () { try { var a = JSON.parse(localStorage.getItem('bterm_tpl') || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } })();
  function tplSave() { try { localStorage.setItem('bterm_tpl', JSON.stringify(TPL)); } catch (e) {} syncSoon(); }
  function tplOn() { return !!(ACC && ACC.owner); }
  var E = function (n) { return { k: 'ema', p: [n] }; }, CL = { k: 'close' };
  var X10 = { t: 'stop', v: 10 }, SW2 = { t: 'swing', k: 2 };
  var TPL_BUILTIN = [  // [中文名, English, 进场条件, 结束条件]
    ['N 字形趋势', 'N-shape trend', [{ l: CL, op: 'gt', r: { k: 'sar', o: 'val' }, d: 7 }, { l: { k: 'vol' }, op: 'gt', v: 1e6 }, { l: E(5), op: 'gt', r: E(20) }, { l: CL, op: 'gt', r: { k: 'ichi', o: 'base' } },
      { l: CL, op: 'gt', r: { k: 'st', p: [3, 1.4], o: 'val' } }, { l: { k: 'hhhl', p: [30, 2] }, op: 'gt', v: 0 }, { l: { k: 'nshape', p: [30, 2, 0] }, op: 'gt', v: 0 }], [X10, SW2]],
    ['后台策略', 'Built-in strategy', null, { take: 15, stop: 0, hold: 90, emab: 1, combo: 1 }],
    ['MACD 金叉 + 放量', 'MACD cross + volume', [{ l: { k: 'macd', o: 'line' }, op: 'xup', r: { k: 'macd', o: 'sig' } }, { l: { k: 'rvol' }, op: 'ge', v: 1.5 }, { l: CL, op: 'gt', r: E(50) }], [X10, SW2]],
    ['EMA5 上穿 EMA20 · 让趋势跑', 'EMA5 crosses EMA20 · let it run', [{ l: E(5), op: 'xup', r: E(20) }, { l: { k: 'vol' }, op: 'ge', v: 5e5 }], [X10, SW2]],
    ['RSI 超卖反弹', 'RSI oversold bounce', [{ l: { k: 'rsi' }, op: 'xup', v: 30, w: 3 }, { l: CL, op: 'gt', r: E(5) }, { l: { k: 'vol' }, op: 'ge', v: 5e5 }], [{ t: 'stop', v: 7 }, { t: 'take', v: 12 }, { t: 'hold', v: 30 }]],
    ['布林带突破', 'Bollinger breakout', [{ l: CL, op: 'xup', r: { k: 'bb', o: 'up' } }, { l: { k: 'rvol' }, op: 'ge', v: 2 }], [{ t: 'stop', v: 8 }, { t: 'trail', v: 10 }]],
    ['均线多头排列', 'Moving averages stacked up', [{ l: CL, op: 'gt', r: E(5) }, { l: E(5), op: 'gt', r: E(20) }, { l: E(20), op: 'gt', r: E(50) }, { l: { k: 'adx', o: 'adx' }, op: 'gt', v: 20 }], [X10, { l: CL, op: 'lt', r: E(20), d: 2 }]],
    ['20 日新高 + 放量', '20-day high + volume', [{ l: CL, op: 'gt', r: { k: 'hh', p: [20] } }, { l: { k: 'rvol' }, op: 'ge', v: 2 }, { l: { k: 'chg' }, op: 'ge', v: 3 }], [{ t: 'stop', v: 8 }, SW2]],
    ['KD 低位金叉', 'Stochastic cross from low', [{ l: { k: 'stoch', o: 'k' }, op: 'xup', r: { k: 'stoch', o: 'd' } }, { l: { k: 'stoch', o: 'd' }, op: 'lt', v: 30 }], [{ t: 'stop', v: 6 }, { t: 'take', v: 10 }, { t: 'hold', v: 30 }]],
    ['Supertrend 转多', 'Supertrend turns up', [{ l: { k: 'st', o: 'trend' }, op: 'xup', v: 0 }, { l: { k: 'vol' }, op: 'ge', v: 1e6 }], [X10, { l: { k: 'st', o: 'trend' }, op: 'xdn', v: 0 }]],
    ['一目云上', 'Above the Ichimoku cloud', [{ l: CL, op: 'gt', r: { k: 'ichi', o: 'a' } }, { l: CL, op: 'gt', r: { k: 'ichi', o: 'b' } }, { l: { k: 'ichi', o: 'conv' }, op: 'xup', r: { k: 'ichi', o: 'base' }, w: 3 }], [X10, { l: CL, op: 'lt', r: { k: 'ichi', o: 'base' }, d: 2 }]],
    ['价值 + 趋势', 'Value + trend', [{ l: { k: 'pe' }, op: 'in', v: 5, v2: 15 }, { l: { k: 'roe' }, op: 'gt', v: 10 }, { l: CL, op: 'xup', r: E(50), w: 5 }], [X10, { t: 'swing', k: 3 }]],
    ['成长股', 'Growth', [{ l: { k: 'rev_yoy' }, op: 'gt', v: 15 }, { l: { k: 'ni_yoy' }, op: 'gt', v: 15 }, { l: CL, op: 'xup', r: E(20), w: 3 }], [X10, SW2]]
  ];
  function tplCur() { return JSON.parse(JSON.stringify({ conds: CB.conds, exits: CB.exits })); }
  function tplId() { return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }
  function tplSum(t) { return Z(t.conds.length + ' 个条件', t.conds.length + ' conditions') + ' · ' + cbExits(t).map(function (q) { return xLbl(q).join(' ').trim(); }).join(' / '); }
  function tplClick(a, v) {
    if (!tplOn()) return;
    if (a === 'tsave') {
      var nm = ((document.getElementById('tpl-name') || {}).value || '').trim().slice(0, 60); if (!nm) { var ie = document.getElementById('tpl-name'); if (ie) ie.focus(); return; }
      var old = TPL.filter(function (t) { return t.name === nm; })[0], t = tplCur(); t.name = nm; t.id = old ? old.id : tplId();
      if (old) TPL[TPL.indexOf(old)] = t; else TPL.unshift(t);
      CB.tpl = t.id; CB.tnote = old ? Z('已更新', 'Updated') : Z('已保存', 'Saved'); tplSave(); render();
    } else if (a === 'tload') {
      var x = TPL.filter(function (t) { return t.id === v; })[0]; if (!x) return;
      CB.conds = cbConds(x); CB.exits = cbExits(x);
      CB.tpl = x.id; CB.tnote = ''; CB.pop = null; cbSave(); render(); cbRe();
    } else if (a === 'tdel') {
      var y = TPL.filter(function (t) { return t.id === v; })[0]; if (!y || !window.confirm(Z('删除模板「' + y.name + '」？', 'Delete template “' + y.name + '”?'))) return;
      TPL = TPL.filter(function (t) { return t !== y; }); if (CB.tpl === v) CB.tpl = null; CB.tnote = ''; tplSave(); render();
    } else if (a === 'tseed') {
      var have = {}; TPL.forEach(function (t) { have[t.name] = 1; });
      TPL_BUILTIN.forEach(function (b) { if (have[Z(b[0], b[1])]) return; TPL.push({ id: tplId(), name: Z(b[0], b[1]), conds: (b[2] || CB_DEF).map(cbCond).filter(Boolean), exits: cbExits(Array.isArray(b[3]) ? { exits: b[3] } : b[3]) }); });
      CB.tnote = ''; tplSave(); render();
    }
  }
  function tplPop(head) {
    var cur = TPL.filter(function (t) { return t.id === CB.tpl; })[0];
    return head(Z('策略模板', 'Strategy templates')) +
      '<div class="tpl-save"><input id="tpl-name" type="text" maxlength="60" autocomplete="off" placeholder="' + Z('模板名称', 'Template name') + '" value="' + esc(cur ? cur.name : '') + '"><button type="button" class="ok" data-cb="tsave">' + Z('保存目前设定', 'Save current') + '</button></div>' +
      (CB.tnote ? '<p class="up tpl-note">' + esc(CB.tnote) + '</p>' : '') +
      (TPL.length ? '<div class="tpl-list">' + TPL.map(function (t) {
        return '<div class="tpl-row' + (t.id === CB.tpl ? ' on' : '') + '"><button type="button" class="tpl-load" data-cb="tload" data-v="' + esc(t.id) + '"><b>' + esc(t.name) + '</b><span class="dim">' + esc(tplSum(t)) + '</span></button><button type="button" class="px" data-cb="tdel" data-v="' + esc(t.id) + '" aria-label="' + Z('删除 ', 'Delete ') + esc(t.name) + '">🗑</button></div>';
      }).join('') + '</div>' : '') + (function () { var have = {}; TPL.forEach(function (t) { have[t.name] = 1; }); var miss = TPL_BUILTIN.filter(function (b) { return !have[Z(b[0], b[1])]; }).length;
        return miss ? '<button type="button" class="more" data-cb="tseed">' + (TPL.length ? Z('补上 ' + miss + ' 个还没有的内置模板', 'Add ' + miss + ' missing built-in templates') : Z('载入 ' + miss + ' 个内置策略模板', 'Load ' + miss + ' built-in strategy templates')) + '</button>' : ''; })();
  }
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
  // ---------- 结束条件 (出场)：任何一个成立就出场 ----------
  // 特别的：止损 / 止盈 / 移动止损 (盘中碰到那个价位就成交，跳空就按开盘价)、跌破回调低点、ATR 移动止损、最长持有、趋势转坏 (按收盘)
  // 其他 = 跟进场一样的指标条件 {l, op, r, v, …, d: 持仓期间连续几天}
  function xCond(c) {
    if (!c) return null;
    var m = XS[c.t];
    if (!m) { var q = cbCond(c); return q && !q.t ? q : null; }
    var o = { t: c.t };
    m[2].forEach(function (p) { var x = +c[p[0]]; if (!isFinite(x)) x = p[3]; x = Math.max(p[4], Math.min(p[5], x)); o[p[0]] = p[6] >= 1 ? Math.round(x) : +x.toFixed(3); });
    return o;
  }
  function cbExits(j) {  // 新格式 exits，或旧版的 take / stop / hold / emab / combo
    if (j && Array.isArray(j.exits)) return j.exits.map(xCond).filter(Boolean).slice(0, 12);
    if (j && ['take', 'stop', 'hold', 'emab', 'combo'].some(function (k) { return j[k] !== undefined; })) {
      var out = [];
      if (j.stop > 0) out.push(xCond({ t: 'stop', v: j.stop }));
      if (j.take > 0) out.push(xCond({ t: 'take', v: j.take }));
      if (j.emab) out.push(xCond({ l: { k: 'close' }, op: 'lt', r: { k: 'ema', p: [20] }, d: 2 }));
      if (j.combo) out.push({ t: 'combo' });
      if (j.hold > 0) out.push(xCond({ t: 'hold', v: j.hold }));
      return out;
    }
    return CB_XDEF.map(xCond);
  }
  function xNew(k) {  // 「+ 结束条件」：特别的用默认参数；指标条件用进场写法反过来 (高于 → 低于、上穿 → 下穿)
    if (XS[k]) return xCond({ t: k });
    var q = cbNew(k); if (!q || q.t) return q;
    var flip = { gt: 'lt', lt: 'gt', ge: 'le', le: 'ge', xup: 'xdn', xdn: 'xup', gtp: 'ltp', ltp: 'gtp', up: 'dn', dn: 'up', in: 'out', out: 'in' };
    q.op = flip[q.op] || q.op;
    if (!q.r && nn(q.v) && !q.l.o) { if (/^(rsi|mfi|stochrsi|stoch)$/.test(q.l.k)) q.v = 100 - q.v; else if (q.l.k === 'wr') q.v = -100 - q.v; else if (q.l.k === 'cci') q.v = -q.v; }
    return xCond(q);
  }
  function xLbl(q) {
    var m = XS[q.t];
    if (!m) return cbLbl(q);
    switch (q.t) {
      case 'stop': case 'take': case 'trail': return [Z(m[0], m[1]), q.v + '%'];
      case 'atr': return [Z(m[0], m[1]), q.n + ' × ' + q.m];
      case 'swing': return [Z(m[0], m[1]), Z('强度 ', 'strength ') + q.k];
      case 'hold': return [Z(m[0], m[1]), Z(q.v + ' 天', q.v + ' days')];
    }
    return [Z(m[0], m[1]), ''];
  }
  // 回调低点：K 线 p 的低点比左边 k 根都低、不高于右边 k 根 → 在 p + k 那天收盘才确认 (不偷看未来)
  function swingLows(X, k) {
    return X.m('swing:' + k, function () {
      var l = X.l, n = l.length, conf = [];  // conf[i] = 在 i 那天刚确认的低点 [位置, 价格] 或 null
      for (var i = 0; i < n; i++) {
        var p = i - k, ok = p - k >= 0;
        for (var t = 1; ok && t <= k; t++) if (!(l[p] < l[p - t]) || !(l[p] <= l[p + t])) ok = false;
        conf.push(ok ? [p, l[p]] : null);
      }
      return conf;
    });
  }
  // Bursa 的价格跳动单位：< RM1 每格 0.005、RM1–9.99 每格 0.01、RM10–99.98 每格 0.02、≥ RM100 每格 0.10
  function tick(p) { return p < 1 ? 0.005 : p < 10 ? 0.01 : p < 100 ? 0.02 : 0.1; }
  function tickDn(p) { var t = tick(p); return +(Math.floor(p / t + 1e-9) * t).toFixed(3); }  // 卖出止损：第一个成交得到的价格 ≤ 这个价位
  function tickUp(p) { var t = tick(p); return +(Math.ceil(p / t - 1e-9) * t).toFixed(3); }
  // 一支股票：照条件进场 (当天收盘价)，照结束条件出场 → 每一笔交易
  var XC = {};  // 每支股票的指标快取 (同一份日线重算时不用再算)
  function cbStock(code, b, from, to, cost, exits, all) {
    var X = XC[code] && XC[code].b === b ? XC[code] : (XC[code] = cbCtx(b, FIN[code])), c = X.c, o = X.o, h = X.h, l = X.l, v = X.v, test = cbTest(X, CB.conds), warm = cbWarm(CB.conds);
    exits = exits || CB.exits;
    var e5 = X.m('x:e5', function () { return emaS(c, 5); }), e20 = X.m('x:e20', function () { return emaS(c, 20); }), sar = X.m('x:sar', function () { return psarS(b); }), st = X.m('x:st', function () { return stS(b, 3, 1.4); }), av = X.m('x:av', function () { return smaS(v, 20); });  // 「趋势转坏」用
    var xf = exits.map(function (q) { return q.t ? null : cbFn(X, q); });
    var sw = {}, atr = {};
    exits.forEach(function (q) { if (q.t === 'swing') sw[q.k] = swingLows(X, q.k); if (q.t === 'atr') atr[q.n] = cbSer(X, opnd({ k: 'atr', p: [q.n] })); });
    var trades = [], i = warm;
    while (i < b.length) {
      if (b[i].d < from || b[i].d > to || !test(i)) { i++; continue; }
      var en = c[i], peak = c[i], hi = h[i], lo = Infinity, mx = -Infinity, j, why = null, fill = null, det = '';
      var streak = exits.map(function () { return 0; });
      var sup = {};  // 每个「跌破回调低点」的支撑：进场时最近一个低于进场价的低点，之后只往上移 (更高的低点)
      Object.keys(sw).forEach(function (k) { var s = null; for (var t = i; t >= 0 && s == null; t--) { var cf = sw[k][t]; if (cf && cf[1] < en) s = cf[1]; } sup[k] = s; });
      for (j = i + 1; j < b.length; j++) {
        lo = Math.min(lo, l[j]); mx = Math.max(mx, h[j]);
        // 1. 盘中价位：止损 / 移动止损 (先算，保守)，再算止盈
        var prot = null;
        exits.forEach(function (q, k) {
          var lvl = q.t === 'stop' ? en * (1 - q.v / 100) : q.t === 'trail' ? peak * (1 - q.v / 100) : null;
          if (lvl != null && l[j] <= lvl && (!prot || lvl > prot.lvl)) prot = { k: k, lvl: lvl };
        });
        if (prot) { why = prot.k; fill = Math.min(o[j], tickDn(prot.lvl)); det = px(tickDn(prot.lvl)); break; }
        for (var k1 = 0; k1 < exits.length; k1++) { var q1 = exits[k1]; if (q1.t === 'take') { var tl = en * (1 + q1.v / 100); if (h[j] >= tickUp(tl)) { why = k1; fill = Math.max(o[j], tickUp(tl)); det = px(tickUp(tl)); break; } } }
        if (why != null) break;
        // 2. 收盘：回调低点、ATR、指标条件、趋势转坏、最长持有
        for (var k2 = 0; k2 < exits.length && why == null; k2++) {
          var q = exits[k2];
          if (q.t === 'swing') {
            var cf2 = sw[q.k][j - 1]; if (cf2 && cf2[0] > i - q.k && (sup[q.k] == null || cf2[1] > sup[q.k])) sup[q.k] = cf2[1];  // 持仓后新确认的更高低点
            if (sup[q.k] != null && c[j] < sup[q.k]) { why = k2; det = px(sup[q.k]); }
          } else if (q.t === 'atr') {
            var a = atr[q.n][j - 1]; if (nn(a) && c[j] < hi - q.m * a) { why = k2; det = px(hi - q.m * a); }
          } else if (q.t === 'combo') {
            var bad = (c[j] < st[j] ? 1 : 0) + (sar[j] === 0 && sar[j - 1] === 1 ? 1 : 0) + (c[j] < c[j - 1] && av[j - 1] > 0 && v[j] >= 2 * av[j - 1] ? 1 : 0) + (e5[j] < e20[j] ? 1 : 0);
            if (bad >= 2) why = k2;
          } else if (q.t === 'hold') { if (j - i >= q.v) why = k2; }
          else if (!q.t) { streak[k2] = xf[k2](j) ? streak[k2] + 1 : 0; if (streak[k2] >= (q.d || 1)) why = k2; }
        }
        if (why != null) { fill = c[j]; break; }
        peak = Math.max(peak, h[j]); hi = Math.max(hi, h[j]);
      }
      var x = why != null ? j : b.length - 1, ex = why != null ? fill : c[x], ret = (ex / en - 1) * 100;
      trades.push({ code: code, sig: b[i].d, entry: en, tov: en * v[i], rv: av[i - 1] > 0 ? v[i] / av[i - 1] : 0, chg: i && c[i - 1] > 0 ? c[i] / c[i - 1] - 1 : 0, exit_date: b[x].d, exit: ex, days: x - i, reason: why == null ? 'open' : 'x' + why, det: det, ret: ret, net: why == null ? ret : ret - cost,
        mae: isFinite(lo) ? Math.min(0, (lo / en - 1) * 100) : 0, mfe: isFinite(mx) ? Math.max(0, (mx / en - 1) * 100) : 0 });
      if (all) { i++; continue; }  // 组合回测：每个信号日都是一笔候选
      if (why == null) break;  // 还在持仓：之后不会再有新的进场
      i = x + 1;  // 同一支卖掉之后才看下一个信号
    }
    return trades;
  }
  // ---------- 组合回测：全市场 / 股票池 / 自选，同时最多持有几笔、每笔多少钱，信号多过空位就随机挑 ----------
  function cbUni() {
    if (CB.uni === 'custom') return CB.codes.slice();
    if (CB.uni === 'pool') return LIST.filter(function (s) { return s.pool === 1; }).map(function (s) { return s.code; });
    return (D.daily && D.daily.length ? D.daily : Object.keys(NAMES)).slice();  // 有 2 年日线的全部股票 (旧的 data.json 没有清单：先用全部名单试)
  }
  function cbUniN() { return CB.uni === 'custom' ? CB.codes.length : cbUni().length; }
  function cbLoadAll(codes, prog) {  // 同时最多 8 个下载；下载过的留在记忆体
    var out = new Array(codes.length), k = 0, done = 0;
    return new Promise(function (ok) {
      if (!codes.length) { ok(out); return; }
      var next = function () {
        if (k >= codes.length) return;
        var i = k++;
        loadDaily(codes[i]).then(function (b) { out[i] = b; done++; if (prog) prog(done, codes.length); if (done === codes.length) ok(out); else next(); });
      };
      for (var t = 0; t < Math.min(8, codes.length); t++) next();
    });
  }
  function rng(seed) { return function () { seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  var RANK = { tov: [Z('成交额先', 'turnover'), Z('成交额大的', 'Highest turnover')], rvol: [Z('相对量先', 'rel. volume'), Z('相对量大的', 'Highest relative volume')], chg: [Z('涨幅先', 'day gain'), Z('当日涨幅大的', 'Biggest day gain')], rand: [Z('随机', 'random'), Z('随机 (稳健性测试)', 'Random (robustness test)')] };
  function cbOpt() {
    return { slots: CB.slots, size: CB.size, rank: CB.rank, sz: CB.sz, runs: CB.runs, minpx: CB.minpx, from: CB.from || '0000', to: CB.to || '9999', cost: (D.bt && isNum(D.bt.cost)) ? D.bt.cost : 0.5 };
  }
  // 候选交易：每支股票的每一个信号日都算一笔 (出场只看那支股票自己的走势)；组合模拟再决定买不买
  function cbCands(codes, all, exits, opt) {
    var cands = [], first = null, last = null, close = {}, n = 0;
    codes.forEach(function (code, k) {
      var b = all[k]; if (!b || b.length < 60) return;
      n++;
      if (!first || b[0].d < first) first = b[0].d; if (!last || b[b.length - 1].d > last) last = b[b.length - 1].d;
      var m = {}; b.forEach(function (x) { m[x.d] = x.c; }); close[code] = m;
      var t = cbStock(code, b, opt.from, opt.to, opt.cost, exits, true);
      for (var i = 0; i < t.length; i++) if (!(t[i].entry < (opt.minpx || 0))) cands.push(t[i]);  // 仙股：跳一格就是 10–50%，止损保护不了
    });
    return { cands: cands, first: first, last: last, close: close, n: n };
  }
  // 一次组合模拟：每天先处理出场，再用收盘价进场；同一支卖掉当天不再买回；每笔按 100 股一手买到不超过设定金额
  function cbPort(P, opt, seed) {
    var byDay = {}, dset = {}, rnd = seed != null ? rng(seed) : null, half = opt.cost / 200;
    P.cands.forEach(function (t) { (byDay[t.sig] || (byDay[t.sig] = [])).push(t); });
    Object.keys(P.close).forEach(function (code) { var m = P.close[code]; for (var d in m) dset[d] = 1; });
    var days = Object.keys(dset).filter(function (d) { return d >= opt.from && d <= opt.to; }).sort();
    var cap = opt.slots * opt.size, cash = cap, held = [], done = [], eq = [], nh = [], missed = 0, lastPx = {}, sold = {};
    days.forEach(function (d) {
      held = held.filter(function (p) {
        if (p.t.reason === 'open' || p.t.exit_date !== d) return true;
        var got = p.sh * p.t.exit * (1 - half); cash += got; p.pl = got - p.basis; done.push(p); sold[p.t.code] = d; return false;
      });
      var cs = (byDay[d] || []).filter(function (t) { return sold[t.code] !== d && !held.some(function (p) { return p.t.code === t.code; }); });
      if (rnd) { for (var i = cs.length - 1; i > 0; i--) { var j = Math.floor(rnd() * (i + 1)), x = cs[i]; cs[i] = cs[j]; cs[j] = x; } }
      else { var rk = opt.rank === 'rvol' ? 'rv' : opt.rank === 'chg' ? 'chg' : 'tov'; cs.sort(function (a, b) { return (b[rk] || 0) - (a[rk] || 0) || (b.tov || 0) - (a.tov || 0); }); }  // 排名：成交额 / 相对量 / 当日涨幅
      var eqNow = cash; if (opt.sz === 'pct') held.forEach(function (p) { var c1 = P.close[p.t.code][d]; eqNow += p.sh * (c1 != null ? c1 : lastPx[p.t.code] != null ? lastPx[p.t.code] : p.t.entry); });  // 复利：每笔 = 当时资金 ÷ 笔数
      cs.forEach(function (t) {
        if (held.length >= opt.slots) { missed++; return; }
        var amt = Math.min(opt.sz === 'pct' ? eqNow / opt.slots : opt.size, cash / (1 + half)), sh = Math.floor(amt / t.entry / 100) * 100;
        if (sh <= 0) { missed++; return; }
        var basis = sh * t.entry * (1 + half); cash -= basis; held.push({ t: t, sh: sh, basis: basis });
      });
      var mv = 0;
      held.forEach(function (p) { var c0 = P.close[p.t.code][d]; if (c0 != null) lastPx[p.t.code] = c0; mv += p.sh * (lastPx[p.t.code] != null ? lastPx[p.t.code] : p.t.entry); });
      eq.push(cash + mv); nh.push(held.length);
    });
    var peak = -Infinity, mdd = 0, mddRM = 0;
    eq.forEach(function (v) { peak = Math.max(peak, v); if (v / peak - 1 < mdd / 100) { mdd = (v / peak - 1) * 100; mddRM = v - peak; } });
    var tr = done.map(function (p) { var t = p.t; return { code: t.code, sig: t.sig, entry: t.entry, exit_date: t.exit_date, exit: t.exit, days: t.days, reason: t.reason, det: t.det, net: t.net, ret: t.ret, mae: t.mae, mfe: t.mfe, sh: p.sh, pl: p.pl }; })
      .concat(held.map(function (p) { var t = p.t, px0 = lastPx[t.code] != null ? lastPx[t.code] : t.entry, val = p.sh * px0; return { code: t.code, sig: t.sig, entry: t.entry, exit_date: null, exit: px0, days: t.days, reason: 'open', det: '', net: (px0 / t.entry - 1) * 100, ret: (px0 / t.entry - 1) * 100, mae: t.mae, mfe: t.mfe, sh: p.sh, pl: val - p.basis }; }))
      .sort(function (a, b) { return a.sig < b.sig ? 1 : a.sig > b.sig ? -1 : 0; });
    var fin = eq.length ? eq[eq.length - 1] : cap, yrs = days.length / 245, cl = tr.filter(function (t) { return t.reason !== 'open'; });
    return { cap: cap, final: fin, ret: (fin / cap - 1) * 100, cagr: yrs > 0.25 && fin > 0 ? (Math.pow(fin / cap, 1 / yrs) - 1) * 100 : null, mdd: mdd, mddRM: mddRM, days: days, eq: eq, nh: nh, trades: tr, missed: missed,
      n: tr.length, open: held.length, win: cl.length ? cl.filter(function (t) { return t.pl > 0; }).length / cl.length * 100 : null,
      hold: cl.length ? cl.reduce(function (s, t) { return s + t.days; }, 0) / cl.length : null,
      avgHeld: nh.length ? nh.reduce(function (s, x) { return s + x; }, 0) / nh.length : 0, full: nh.length ? nh.filter(function (x) { return x >= opt.slots; }).length / nh.length * 100 : 0 };
  }
  // 随机挑选跑很多次 → 看结果的分布 (不是只靠一次运气)；「成交额大的先」只跑一次
  function cbMC(P, opt, runs) {
    var rs = [];
    if (opt.rank !== 'rand') rs.push(cbPort(P, opt, null));
    else for (var s = 1; s <= (runs || opt.runs); s++) rs.push(cbPort(P, opt, s * 7919));
    var by = rs.slice().sort(function (a, b) { return a.final - b.final; });
    var q = function (arr, f) { return arr[Math.min(arr.length - 1, Math.max(0, Math.round(f * (arr.length - 1))))]; };
    var rets = rs.map(function (r) { return r.ret; }).sort(function (a, b) { return a - b; }), dds = rs.map(function (r) { return r.mdd; }).sort(function (a, b) { return a - b; });
    var ns = rs.map(function (r) { return r.n; }).sort(function (a, b) { return a - b; }), ws = rs.map(function (r) { return r.win == null ? 0 : r.win; }).sort(function (a, b) { return a - b; });
    return { rep: by[Math.round((by.length - 1) * 0.5)], runs: rs.length, ret: { lo: q(rets, 0.05), med: q(rets, 0.5), hi: q(rets, 0.95) }, dd: { worst: dds[0], lo: q(dds, 0.05), med: q(dds, 0.5), hi: q(dds, 0.95) },
      loss: rs.filter(function (r) { return r.ret < 0; }).length / rs.length * 100, n: q(ns, 0.5), win: q(ws, 0.5) };
  }
  function cbRun() {
    var codes = cbUni();
    if (!codes.length) { CB.err = CB.uni === 'custom' ? T('先加至少一支股票') : Z('没有股票资料', 'No stock data'); render(); return; }
    if (!CB.conds.length) { CB.err = Z('至少加一个进场条件', 'Add at least one entry condition'); render(); return; }
    CB.busy = true; CB.again = false; CB.err = ''; CB.sens = null; CB.load = { d: 0, n: codes.length }; CB.tlim = 60; cbDone();  // 旧结果留着，算好再换
    cbLoadAll(codes, function (d, n) { CB.load = { d: d, n: n }; var bt = document.querySelector('[data-cb="run"]'); if (bt) bt.textContent = Z('载入资料 ', 'Loading data ') + d + '/' + n + '…'; }).then(function (all) {
      CB.load = null; var bt = document.querySelector('[data-cb="run"]'); if (bt) bt.textContent = Z('计算中…', 'Running…');
      setTimeout(function () {
        var opt = cbOpt(), P = cbCands(codes, all, CB.exits, opt), mc = cbMC(P, opt);
        CB.res = { mc: mc, rep: mc.rep, trades: mc.rep.trades, exits: JSON.parse(JSON.stringify(CB.exits)), first: P.first, last: P.last, n: P.n, cost: opt.cost, opt: opt };
        CB.data = { codes: codes, all: all }; CB.busy = false; cbSave();
        if (CB.again) { CB.again = false; cbRun(); } else cbDone();
      }, 30);
    });
  }
  // 参数测试：同一组进场条件，把某一个结束条件换成几个不同的数值，各跑一次组合模拟 (随机挑选的话每个数值跑 20 次取中位数)
  var SENS = { stop: ['v', [5, 7, 10, 12, 15, 20]], trail: ['v', [5, 8, 10, 12, 15, 20]], take: ['v', [10, 15, 20, 30, 50, 100]], swing: ['k', [1, 2, 3, 4, 5]], atr: ['m', [2, 2.5, 3, 3.5, 4, 5]], hold: ['v', [10, 20, 40, 60, 90, 120]] };
  function cbSens(k) {
    var q = CB.exits[k], sp = q && SENS[q.t]; if (!sp || !CB.data) return;
    CB.sens = { k: k, busy: true }; render();
    setTimeout(function () {
      var opt = cbOpt(), rows = sp[1].concat(null).map(function (val) {
        var ex = CB.exits.filter(function (_, t) { return t !== k || val != null; }).map(function (x) { if (x !== q) return x; var y = JSON.parse(JSON.stringify(x)); y[sp[0]] = val; return y; });
        var mc = cbMC(cbCands(CB.data.codes, CB.data.all, ex, opt), opt, Math.min(opt.runs, 20));
        return { val: val, n: mc.n, win: mc.win, ret: mc.ret.med, dd: mc.dd.med, loss: mc.loss };
      });
      CB.sens = { k: k, rows: rows, key: sp[0], cur: q[sp[0]] }; cbDone();
    }, 30);
  }
  // ---------- 策略诊断：列出现在的策略，再从回测结果找出可以改进的地方 (每一项可以一键试试，会重新回测) ----------
  function cbStrat() {
    var uni = { market: Z('全市场', 'Whole market'), pool: Z('股票池', 'Pool'), custom: Z('自选', 'Custom') }[CB.uni];
    return { entry: CB.conds.map(function (q) { return cbLbl(q).join(' '); }), exit: CB.exits.map(function (q) { return xLbl(q).join(' ').trim(); }),
      cap: Z(CB.slots + ' 笔 × RM' + CB.size.toLocaleString('en'), CB.slots + ' × RM' + CB.size.toLocaleString('en')) + (CB.sz === 'pct' ? Z(' (复利)', ' (compounding)') : '') + ' · ' + RANK[CB.rank][0],
      uni: uni + (CB.uni !== 'custom' ? ' ' + cbUniN() : ' ' + CB.codes.length) + Z(' 支', '') + (CB.minpx ? Z(' · 不买低于 RM', ' · skip below RM') + CB.minpx.toFixed(2) : ''),
      period: (CB.from || Z('最早', 'earliest')) + ' ~ ' + (CB.to || Z('最新', 'latest')) };
  }
  function cbHas(f) { return CB.conds.some(function (q) { return !q.t && f(q); }); }
  function cbDiag(r) {
    var a = r.rep, mc = r.mc, tr = a.trades, cl = tr.filter(function (t) { return t.reason !== 'open'; });
    var wn = cl.filter(function (t) { return t.pl > 0; }), ls = cl.filter(function (t) { return t.pl <= 0; });
    var avg = function (arr, f) { return arr.length ? arr.reduce(function (s, t) { return s + f(t); }, 0) / arr.length : null; };
    var aw = avg(wn, function (t) { return t.net; }), al = avg(ls, function (t) { return t.net; }), payoff = aw != null && al ? aw / -al : null;
    var win = cl.length ? wn.length / cl.length * 100 : 0;
    var stopK = r.exits.map(function (q, k) { return q.t === 'stop' ? k : -1; }).filter(function (k) { return k >= 0; })[0];
    var stopTr = stopK == null ? [] : cl.filter(function (t) { return t.reason === 'x' + stopK; }), stopPl = stopTr.reduce(function (s, t) { return s + t.pl; }, 0);
    var p90 = (function () { if (wn.length < 5) return null; var m = wn.map(function (t) { return -t.mae; }).sort(function (x, y) { return x - y; }); return m[Math.min(m.length - 1, Math.floor(m.length * 0.9))]; })();
    var give = avg(wn, function (t) { return t.mfe - t.ret; });
    var low = cl.filter(function (t) { return t.entry < 0.3; }), lowPl = low.reduce(function (s, t) { return s + t.pl; }, 0);
    var trend = cbHas(function (q) { return (q.r && /^(ema|sma|wma|hma)$/.test(q.r.k) && q.r.p[0] >= 50 && /^(gt|ge)$/.test(q.op)) || (q.l.k === 'adx' && q.op === 'gt'); });
    var items = [], push = function (zh, en, act, al2) { items.push({ txt: Z(zh, en), act: act || null, lbl: act ? al2 : '' }); };
    var multi = mc.runs > 1, med = mc.ret.med, loss = mc.loss, dd = multi ? mc.dd.med : a.mdd;  // 只跑一次 (按排序挑) 时没有「机率」可言
    var verdict = med < 0 || loss > 50 ? 'bad' : med > 10 && loss < 25 && dd > -25 ? 'good' : 'mixed';
    var vtxt = (multi ? Z('中位数 ' + pct(med, 1) + '、亏钱机率 ' + loss.toFixed(0) + '%、中位最大回撤 ' + pct(dd, 1), 'Median ' + pct(med, 1) + ', chance of a loss ' + loss.toFixed(0) + '%, median max drawdown ' + pct(dd, 1)) :
      Z('总收益 ' + pct(med, 1) + '、最大回撤 ' + pct(dd, 1), 'Total return ' + pct(med, 1) + ', max drawdown ' + pct(dd, 1))) +
      (verdict === 'bad' ? (multi ? Z('：这个策略在随机挑选下站不住，下面是从交易里看到的问题。', ': this strategy does not hold up under random picks. Here is what the trades show.') :
        Z('：这段期间这个策略亏钱，下面是从交易里看到的问题。', ': this strategy lost money over this period. Here is what the trades show.')) :
        verdict === 'good' ? Z('：表现稳定。还是建议换一段期间再跑一次确认。', ': it holds up. Still worth re-running on another period to confirm.') : Z('：好坏参半，下面几点可以试着改善。', ': mixed. A few things below may help.'));
    if (cl.length < 20) push('只有 ' + cl.length + ' 笔已结束的交易，样本太少，结果很不可靠。少用一两个进场条件或拉长期间。', 'Only ' + cl.length + ' closed trades: too few to trust. Drop a condition or use a longer period.',
      CB.from || CB.to ? { k: 'period' } : null, Z('期间改成全部', 'Use the whole period'));
    if (CB.rank === 'rand' && mc.runs > 1 && mc.ret.hi - mc.ret.lo > 40) push('随机 ' + mc.runs + ' 次的收益从 ' + pct(mc.ret.lo, 0) + ' 到 ' + pct(mc.ret.hi, 0) + '，同一天信号太多 (没空位错过 ' + a.missed + ' 个)，结果很看挑到哪一支。条件要更严，让信号变少、变准。',
      'Random runs range from ' + pct(mc.ret.lo, 0) + ' to ' + pct(mc.ret.hi, 0) + ': too many signals per day (' + a.missed + ' missed), so results depend on which stock gets picked. Tighten the entry so signals are fewer and better.',
      !trend ? { k: 'addc', q: { l: { k: 'close' }, op: 'gt', r: { k: 'ema', p: [50] } } } : { k: 'rank', v: 'tov' }, !trend ? Z('加「收盘价 > EMA(50)」', 'Add “Close > EMA(50)”') : Z('改成成交额大的先', 'Pick highest turnover first'));
    if (stopTr.length >= Math.max(3, cl.length * 0.35) && stopPl < 0) push(Math.round(stopTr.length / cl.length * 100) + '% 的交易是止损出场，合计 ' + (stopPl < 0 ? '-' : '+') + 'RM' + Math.abs(Math.round(stopPl)).toLocaleString('en') + '：常常一进场就反向。加一个趋势过滤，只在大趋势向上时进场。',
      Math.round(stopTr.length / cl.length * 100) + '% of trades hit the stop, totalling RM' + Math.round(stopPl).toLocaleString('en') + ': entries often reverse straight away. Add a trend filter so you only enter in an uptrend.',
      !trend ? { k: 'addc', q: { l: { k: 'close' }, op: 'gt', r: { k: 'ema', p: [50] } } } : !cbHas(function (q) { return q.l.k === 'adx'; }) ? { k: 'addc', q: { l: { k: 'adx', o: 'adx' }, op: 'gt', v: 20 } } : null,
      !trend ? Z('加「收盘价 > EMA(50)」', 'Add “Close > EMA(50)”') : Z('加「ADX > 20」', 'Add “ADX > 20”'));
    if (win < 40 && payoff != null && payoff < 1.5) push('胜率 ' + win.toFixed(0) + '%、盈亏比 ' + payoff.toFixed(2) + '：赢的不够多，赚的也不够大。进场时要求放量确认。',
      'Win rate ' + win.toFixed(0) + '%, payoff ' + payoff.toFixed(2) + ': not enough winners, and wins are not big enough. Require volume confirmation on entry.',
      !cbHas(function (q) { return q.l.k === 'rvol'; }) ? { k: 'addc', q: { l: { k: 'rvol', p: [20] }, op: 'ge', v: 1.5 } } : null, Z('加「相对量 ≥ 1.5」', 'Add “Relative volume ≥ 1.5”'));
    if (stopK != null && p90 != null) {
      var sv = r.exits[stopK].v, nv = Math.min(20, Math.ceil(p90 + 1));
      if (sv > p90 + 3) push('九成赢单的浮亏不超过 ' + p90.toFixed(1) + '%，止损 ' + sv + '% 太宽，输的单会亏太多。', '90% of winners dipped less than ' + p90.toFixed(1) + '%, so a ' + sv + '% stop is too wide and losers lose too much.', { k: 'stop', v: nv }, Z('止损改成 ' + nv + '%', 'Set stop to ' + nv + '%'));
      else if (sv < p90 - 1) push('一成赢单中途跌超过 ' + p90.toFixed(1) + '%，止损 ' + sv + '% 会把这些后来会赚的单先砍掉。', '10% of winners dipped more than ' + p90.toFixed(1) + '%; a ' + sv + '% stop cuts them before they recover.', { k: 'stop', v: nv }, Z('止损改成 ' + nv + '%', 'Set stop to ' + nv + '%'));
    }
    if (give != null && give > 8) {
      var sk = r.exits.map(function (q, k) { return q.t === 'swing' && q.k > 1 ? k : -1; }).filter(function (k) { return k >= 0; })[0], hasTr = r.exits.some(function (q) { return q.t === 'trail'; });
      push('赚钱的单平均回吐 ' + give.toFixed(1) + '% 才出场：出场太慢。', 'Winners give back ' + give.toFixed(1) + '% on average before exiting: exits are too slow.',
        sk != null ? { k: 'swingk', i: sk } : !hasTr ? { k: 'addx', q: { t: 'trail', v: 10 } } : null, sk != null ? Z('回调低点强度改成 1', 'Swing-low strength 1') : Z('加「移动止损 10%」', 'Add “Trailing stop 10%”'));
    }
    if (low.length >= Math.max(3, cl.length * 0.3) && lowPl < 0) { var mp = CB.minpx < 0.3 ? 0.3 : 0.5;
      push(low.length + ' 笔是 RM0.30 以下的股票，合计 -RM' + Math.abs(Math.round(lowPl)).toLocaleString('en') + '：价格低，跳一格就是好几个百分点。', low.length + ' trades were below RM0.30, totalling -RM' + Math.abs(Math.round(lowPl)).toLocaleString('en') + ': at low prices one tick is several percent.',
        { k: 'minpx', v: mp }, Z('不买低于 RM' + mp.toFixed(2), 'Skip below RM' + mp.toFixed(2))); }
    if (dd < -25 && CB.slots < 10) { var ns = Math.min(10, CB.slots * 2), nz = Math.max(1000, Math.round(CB.slots * CB.size / ns / 1000) * 1000);
      push('中位最大回撤 ' + pct(dd, 1) + '：资金太集中在少数几笔。同样的本金分成更多笔。', 'Median max drawdown ' + pct(dd, 1) + ': capital is concentrated in too few positions. Split the same capital into more positions.',
        { k: 'cap', slots: ns, size: nz }, Z(ns + ' 笔 × RM' + nz.toLocaleString('en'), ns + ' × RM' + nz.toLocaleString('en'))); }
    if (a.days.length > 40 && a.avgHeld / CB.slots < 0.4) push('空位常常空着 (平均持仓 ' + a.avgHeld.toFixed(1) + ' / ' + CB.slots + ')：信号太少，资金闲着。可以放宽一个条件或扩大股票范围。',
      'Slots are often empty (avg ' + a.avgHeld.toFixed(1) + ' / ' + CB.slots + '): too few signals, capital sits idle. Loosen a condition or widen the stock scope.',
      CB.uni !== 'market' ? { k: 'uni', v: 'market' } : null, Z('股票范围改成全市场', 'Use the whole market'));
    return { verdict: verdict, vtxt: vtxt, items: items.slice(0, 6), stats: { 胜率: +win.toFixed(1), 盈亏比: payoff == null ? null : +payoff.toFixed(2), 止损出场笔数: stopTr.length, 九成赢单浮亏不超过: p90, 赢单平均回吐: give == null ? null : +give.toFixed(1) } };
  }
  function cbFix(i) {
    var f = CB.dx && CB.dx[i]; if (!f) return;
    if (f.k === 'addc') CB.conds.push(cbCond(f.q));
    else if (f.k === 'addx') CB.exits.push(xCond(f.q));
    else if (f.k === 'stop') CB.exits.forEach(function (q) { if (q.t === 'stop') q.v = f.v; });
    else if (f.k === 'swingk') { if (CB.exits[f.i]) CB.exits[f.i].k = 1; }
    else if (f.k === 'minpx') CB.minpx = f.v;
    else if (f.k === 'cap') { CB.slots = f.slots; CB.size = f.size; }
    else if (f.k === 'rank') CB.rank = f.v;
    else if (f.k === 'uni') CB.uni = f.v;
    else if (f.k === 'period') { CB.from = ''; CB.to = ''; }
    CB.pop = null; cbSave(); render(); cbRe();
  }
  function cbAskAI() {  // 把策略 + 结果 + 诊断交给 AI，问它怎么改 (用户自己选的模型 / 密钥)
    AI.open = true; if (SY.open) { SY.open = false; acctRender(); } aiRender();
    if (aiReady()) aiAsk(Z('根据这次回测的资料，这个策略表现不好的主要原因是什么？请具体建议进场条件、出场条件和资金设定可以怎么调整，并说明理由。只讨论回测设定，不要给个股买卖建议。',
      'Based on this backtest, what are the main reasons this strategy underperforms? Suggest concrete changes to the entry conditions, exit conditions and capital settings, with reasons. Only discuss the backtest settings, not whether to buy or sell any stock.'));
  }
  function cbRe() { if (!CB.res || !(CB.uni !== 'custom' || CB.codes.length) || !CB.conds.length) return; if (CB.busy) { CB.again = true; return; } cbRun(); }  // 已经跑过：改了设定就自动重算 (正在算就等算完再算一次)  // 已经跑过：改了设定就自动重算
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
  // 中文模式的面板标题只显示中文 (英文模式本来就只有英文)
  function ttl(t) { return LANG === 'en' ? t : t.replace(/^[A-Z][A-Z0-9 ·&\/-]*\s+(?=[^\x00-\x7f])/, ''); }
  function pill(pop, k, v, del, label) {
    var on = CB.pop === pop;
    return '<span class="pill' + (on ? ' on' : '') + '"><button type="button" class="pl" data-cb="pop" data-v="' + pop + '" aria-expanded="' + on + '"><span class="pk">' + k + '</span>' + (v ? ' <b>' + v + '</b>' : '') + '</button>' +
      (del ? '<button type="button" class="px" data-cb="' + del[0] + '" data-v="' + del[1] + '" aria-label="' + Z('移除 ', 'Remove ') + esc(label || k) + '">×</button>' : '') + '</span>';
  }
  function cbList(mode) {  // 「+ 条件」/「+ 结束条件」菜单：按类别分组，可以打字筛选
    var q = (CB.cq || '').trim().toLowerCase(), act = mode === 'e' ? 'xadd' : mode === 'p' ? 'pcadd' : 'cadd', hit = function (t) { return !q || t.toLowerCase().indexOf(q) >= 0; };
    var h = mode === 'e' ? XG.map(function (g) {
      var ks = Object.keys(XS).filter(function (k) { return XS[k][3] === g[0] && hit(XS[k][0] + ' ' + XS[k][1]); });
      return ks.length ? '<div class="cbg"><h3>' + Z(g[1], g[2]) + '</h3>' + ks.map(function (k) { return '<button type="button" data-cb="xadd" data-v="' + k + '">' + Z(XS[k][0], XS[k][1]) + '</button>'; }).join('') + '</div>' : '';
    }).join('') : '';
    h += IG.filter(function (g) { return mode !== 'p' || g[0] !== 'fin'; }).map(function (g) {
      var ks = INDK.filter(function (k) { var d = IND[k]; return d.g === g[0] && hit(d.zh + ' ' + d.en + ' ' + (SH[k] || '')); }), extra = mode === 'c' && g[0] === 'ma' && (!q || /ema50|价格或|price or/.test(q) || 'ema'.indexOf(q) >= 0);
      if (!ks.length && !extra) return '';
      return '<div class="cbg"><h3>' + (mode === 'e' ? Z('指标条件 · ', 'Indicator · ') : '') + Z(g[1], g[2]) + '</h3>' + ks.map(function (k) { return '<button type="button" data-cb="' + act + '" data-v="' + k + '">' + esc(indNm(k)) + '</button>'; }).join('') +
        (extra ? '<button type="button" data-cb="cadd" data-v="@ema50">' + Z('价格或 EMA5 高于 EMA50', 'Price or EMA5 above EMA50') + '</button>' : '') + '</div>';
    }).join('');
    return h || '<p class="dim">' + Z('没有符合的条件', 'No match') + '</p>';
  }
  function indSel(key, cur) {
    return '<select data-cbc="' + key + '">' + IG.filter(function (g) { return key[0] !== 'p' || g[0] !== 'fin'; }).map(function (g) {
      return '<optgroup label="' + Z(g[1], g[2]) + '">' + INDK.filter(function (k) { return IND[k].g === g[0]; }).map(function (k) { return '<option value="' + k + '"' + (k === cur ? ' selected' : '') + '>' + esc(indNm(k)) + '</option>'; }).join('') + '</optgroup>';
    }).join('') + '</select>';
  }
  function opndEd(i, side, s) {  // 指标 + 参数 + 哪一条线 (i = 「c3」进场第 4 个 / 「e1」出场第 2 个)
    var d = IND[s.k], h = '<label>' + (side === 'l' ? Z('指标', 'Indicator') : Z('比较对象', 'Compare with')) + indSel(i + ':' + side + '.k', s.k) + '</label>';
    if (d.p.length) h += '<div class="cbp-ps">' + d.p.map(function (q, j) { return '<label>' + Z(q[1], q[2]) + '<input type="number" inputmode="decimal" data-cbc="' + i + ':' + side + '.p.' + j + '" value="' + s.p[j] + '" min="' + q[4] + '" max="' + q[5] + '" step="' + q[6] + '"></label>'; }).join('') + '</div>';
    if (d.out && d.out.length > 1) h += '<label>' + Z('线', 'Line') + '<select data-cbc="' + i + ':' + side + '.o">' + d.out.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === s.o ? ' selected' : '') + '>' + esc(Z(o[1], o[2])) + '</option>'; }).join('') + '</select></label>';
    return h;
  }
  function condEd(L, i) {
    var arr = L === 'e' ? CB.exits : L === 'p' ? PC : CB.conds, q = arr[i], key = L + i; if (!q) return '';
    var head = function (t) { return '<div class="cbp-h"><b>' + t + '</b><button type="button" class="px" data-cb="cdel" data-v="' + key + '" aria-label="' + Z('移除', 'Remove') + '">🗑</button><button type="button" class="px" data-cb="pop" data-v="" aria-label="' + Z('关闭', 'Close') + '">✕</button></div>'; };
    var num = function (k, lbl, v, unit, lo, hi, step) { return '<label>' + lbl + '<span class="cbp-n"><input type="number" inputmode="decimal" data-cbc="' + key + ':' + k + '" value="' + v + '" min="' + lo + '" max="' + hi + '" step="' + (step || 1) + '">' + (unit ? '<span class="dim">' + unit + '</span>' : '') + '</span></label>'; };
    if (q.t === 'ema50') return head(Z('价格或 EMA5 高于 EMA50', 'Price or EMA5 above EMA50')) + '<p class="dim">' + Z('后台策略的条件之一，不能改参数；要自己调就移除它，再用「EMA 指数均线」加。', 'One of the built-in strategy rules. To adjust it, remove it and add “EMA” instead.') + '</p>';
    if (XS[q.t]) {  // 特别的结束条件
      var m = XS[q.t], note = { stop: ['盘中碰到这个价就成交；跳空低开就按开盘价。', 'Fills at this price intraday; at the open if it gaps below.'], trail: ['从持仓以来的最高价回落这么多就出场 (盘中成交)。', 'Exits when price drops this much from the highest high since entry (intraday).'],
        take: ['盘中碰到就按这个价卖；跳空高开就按开盘价。', 'Sells at this price intraday; at the open if it gaps above.'], atr: ['收盘跌破「持仓最高价 − 倍数 × ATR」就出场。', 'Exits when the close drops below highest high − multiplier × ATR.'],
        swing: ['趋势走出更高的低点时支撑跟着往上移；收盘跌破最近的回调低点就出场。', 'Support moves up with each higher low; exits when the close breaks the latest swing low.'], combo: ['Supertrend、SAR 转空、放量下跌、EMA5 低于 EMA20 其中 2 项出现就出场。', 'Exits when 2 of these appear: below Supertrend, SAR flips down, heavy-volume drop, EMA5 below EMA20.'],
        hold: ['持有这么多个交易日就出场。', 'Exits after this many trading days.'] }[q.t];
      return head(Z(m[0], m[1])) + m[2].map(function (p) { return num(p[0], Z(p[1], p[2]), q[p[0]], p[7] === '天' ? Z('天', 'days') : p[7], p[4], p[5], p[6]); }).join('') + (note ? '<p class="dim">' + Z(note[0], note[1]) + '</p>' : '');
    }
    var mo = OPS[q.op], u = IND[q.l.k].u, uL = u ? ' <span class="dim">' + (u === 'RM' ? 'RM' : u) + '</span>' : '';
    var val = function (k, lbl, v) { return '<label>' + lbl + '<span class="cbp-n"><input type="text" inputmode="decimal" autocomplete="off" data-cbc="' + key + ':' + k + '" value="' + esc(fmtV(v, '')) + '" placeholder="1.5M">' + uL + '</span></label>'; };
    if (IND[q.l.k].b) return head(esc(indNm(q.l.k))) + opndEd(key, 'l', q.l) + '<label>' + Z('条件', 'Condition') + '<select data-cbc="' + key + ':bool"><option value="1"' + (q.op !== 'lt' ? ' selected' : '') + '>' + Z('成立', 'Met') + '</option><option value="0"' + (q.op === 'lt' ? ' selected' : '') + '>' + Z('不成立', 'Not met') + '</option></select></label>' +
      '<div class="cbp-2">' + num('d', L === 'e' ? Z('持仓期间连续成立', 'True for (in a row)') : Z('连续成立', 'True for (in a row)'), q.d || 1, Z('天', 'days'), 1, 30) + '</div>' +
      '<p class="dim">' + Z('高低点要左右各几根 K 线都比较低 / 高才算，而且要等那几根走完才确认，不会用到未来的资料。', 'A pivot must be lower / higher than the bars on each side and is only confirmed once those bars have passed, so no future data is used.') + '</p>';
    var h = head(esc(indNm(q.l.k))) + opndEd(key, 'l', q.l) + '<label>' + Z('条件', 'Condition') + '<select data-cbc="' + key + ':op">' + OPK.map(function (o) { return '<option value="' + o + '"' + (o === q.op ? ' selected' : '') + '>' + Z(OPS[o][0], OPS[o][1]) + '</option>'; }).join('') + '</select></label>';
    if (mo[3] === 'rv') h += '<div class="opts seg cbp-rt" role="group"><button type="button" data-cb="rt" data-v="' + key + ':v" aria-pressed="' + !q.r + '">' + Z('数值', 'Value') + '</button><button type="button" data-cb="rt" data-v="' + key + ':i" aria-pressed="' + !!q.r + '">' + Z('指标', 'Indicator') + '</button></div>' +
      (q.r ? opndEd(key, 'r', q.r) : val('v', Z('数值', 'Value'), q.v));
    if (mo[3] === 'ri') h += opndEd(key, 'r', q.r) + num('v', Z('至少', 'At least'), q.v, '%', 0, 1000);
    if (mo[3] === 'range') h += '<div class="cbp-2">' + val('v', Z('最小', 'Min'), q.v) + val('v2', Z('最大', 'Max'), q.v2) + '</div>';
    h += '<div class="cbp-2">' + (mo[4] ? num('w', mo[3] === 'none' ? Z('天数', 'Days') : Z('在最近几天内', 'Within the last'), q.w, Z('天', 'days'), 1, 250) : '') +
      num('d', L === 'e' ? Z('持仓期间连续成立', 'True for (in a row)') : Z('连续成立', 'True for (in a row)'), q.d || 1, Z('天', 'days'), 1, 30) + '</div>';
    if (IND[q.l.k].g === 'fin' || (q.r && IND[q.r.k].g === 'fin')) h += '<p class="dim">' + Z('按季报，季度结束 60 天后才算公开。', 'Quarterly reports, counted as public 60 days after quarter end.') + '</p>';
    return h;
  }
  function cbPop() {
    var p = CB.pop; if (!p) return '';
    var head = function (t, del) { return '<div class="cbp-h"><b>' + t + '</b>' + (del ? '<button type="button" class="px" data-cb="' + del[0] + '" data-v="' + del[1] + '" aria-label="' + Z('移除', 'Remove') + '">🗑</button>' : '') +
      '<button type="button" class="px" data-cb="pop" data-v="" aria-label="' + Z('关闭', 'Close') + '">✕</button></div>'; };
    var num = function (key, lbl, val, unit, lo, hi, step) { return '<label>' + lbl + '<span class="cbp-n"><input type="number" inputmode="decimal" data-cbc="' + key + '" value="' + val + '" min="' + lo + '" max="' + hi + '" step="' + (step || 1) + '">' + (unit ? '<span class="dim">' + unit + '</span>' : '') + '</span></label>'; };
    var h = '';
    if ((p === 'padd' || p.indexOf('p:') === 0) !== (S.page === 'pool')) return '';  // 股票池的编辑框只在股票池页，回测的只在回测页
    if (p.indexOf('c:') === 0 || p.indexOf('e:') === 0 || p.indexOf('p:') === 0) {
      h = condEd(p[0], +p.slice(2)); if (!h) return '';
    } else if (p === 'tpl') {
      if (!tplOn()) return '';
      h = tplPop(head);
    } else if (p === 'add') {
      h = head(Z('添加进场条件', 'Add entry condition')) + '<div class="grep"><label for="cb-cq">' + Z('搜索&gt;', 'find&gt;') + '</label><input id="cb-cq" type="search" autocomplete="off" spellcheck="false" placeholder="' + Z('RSI、MACD、本益比…', 'RSI, MACD, P/E…') + '" value="' + esc(CB.cq || '') + '"></div>' +
        '<div id="cb-clist">' + cbList('c') + '</div><button type="button" class="more" data-cb="reset">' + Z('恢复后台策略的 6 个条件', 'Reset to the 6 default conditions') + '</button>';
    } else if (p === 'padd') {
      h = head(Z('添加筛选条件', 'Add filter')) + '<div class="grep"><label for="cb-cq">' + Z('搜索&gt;', 'find&gt;') + '</label><input id="cb-cq" type="search" autocomplete="off" spellcheck="false" placeholder="' + Z('RSI、MACD、N 字形…', 'RSI, MACD, N-shape…') + '" value="' + esc(CB.cq || '') + '"></div>' +
        '<div id="cb-clist">' + cbList('p') + '</div><p class="dim">' + Z('用最近 90 天的日线算最新一天；财务条件请在回测里用。', 'Uses the last 90 daily bars, latest day; use financial conditions in the backtest.') + '</p>';
    } else if (p === 'xadd') {
      h = head(Z('添加结束条件', 'Add exit condition')) + '<div class="grep"><label for="cb-cq">' + Z('搜索&gt;', 'find&gt;') + '</label><input id="cb-cq" type="search" autocomplete="off" spellcheck="false" placeholder="' + Z('止损、回调低点、RSI…', 'stop, swing, RSI…') + '" value="' + esc(CB.cq || '') + '"></div>' +
        '<div id="cb-clist">' + cbList('e') + '</div>';
    } else if (p === 'stocks') {
      var name = function (c) { return ST[c] ? ST[c].name : NAMES[c] || c; };
      var mp = '<label>' + Z('不买股价低于', 'Skip prices below') + '</label><div class="opts">' + [0, 0.05, 0.1, 0.2, 0.5, 1].map(function (x) { return '<button type="button" data-cb="capv" data-v="minpx:' + x + '" aria-pressed="' + (CB.minpx === x) + '">' + (x ? 'RM' + x.toFixed(2) : Z('不限', 'none')) + '</button>'; }).join('') + '</div>';
      var seg = '<div class="opts seg cbp-rt" role="group">' + [['market', Z('全市场', 'Market')], ['pool', Z('股票池', 'Pool')], ['custom', Z('自选', 'Custom')]].map(function (u) { return '<button type="button" data-cb="uni" data-v="' + u[0] + '" aria-pressed="' + (CB.uni === u[0]) + '">' + u[1] + '</button>'; }).join('') + '</div>';
      if (CB.uni !== 'custom') h = head(Z('回测股票', 'Stocks')) + seg + '<p class="dim">' + (CB.uni === 'market' ? Z('有 2 年日线的全部股票，共 ', 'All stocks with 2 years of daily data: ') : Z('成交量 ≥ 1M 的股票，共 ', 'Stocks trading ≥ 1M shares: ')) + cbUniN() + Z(' 支。', '.') + '</p>' + mp;
      else h = head(Z('回测股票', 'Stocks')) + seg + mp + '<div class="grep"><label for="cb-q">' + Z('添加&gt;', 'add&gt;') + '</label><input id="cb-q" type="search" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="' + Z('名称或代码', 'Name or code') + '" value="' + esc(CB.q) + '"></div>' +
        '<div class="opts" id="cb-sug">' + cbSug() + '</div>' +
        '<div class="opts"><button type="button" data-cb="add-sig">' + Z('+ 今天信号股', '+ Today’s signals') + '</button><button type="button" data-cb="add-watch">+ ' + esc(curFolder().name) + '</button><button type="button" data-cb="add-top">' + Z('+ 成交额前 10', '+ Top 10 turnover') + '</button>' + (CB.codes.length ? '<button type="button" data-cb="clear">' + Z('清空', 'Clear') + '</button>' : '') + '</div>' +
        (CB.codes.length ? '<div class="opts">' + CB.codes.map(function (c) { return '<button type="button" class="chip" data-cb="del" data-v="' + c + '" aria-label="' + Z('移除 ', 'Remove ') + esc(name(c)) + '">' + esc(name(c)) + ' ×</button>'; }).join('') + '</div>' : '');
    } else if (p === 'cap') {
      var cb = function (k, vals, fmt) { return '<div class="opts">' + vals.map(function (x) { return '<button type="button" data-cb="capv" data-v="' + k + ':' + x + '" aria-pressed="' + (CB[k] === x) + '">' + fmt(x) + '</button>'; }).join('') + '</div>'; };
      h = head(Z('资金与持仓', 'Capital and positions')) +
        '<label>' + Z('同时最多持有', 'Max positions at once') + '<span class="cbp-n"><input type="number" inputmode="numeric" min="1" max="50" step="1" data-cbk="slots" value="' + CB.slots + '"><span class="dim">' + Z('笔', 'positions') + '</span></span></label>' + cb('slots', [1, 2, 3, 5, 10, 20], function (x) { return x + Z(' 笔', ''); }) +
        '<label>' + Z('每笔金额', 'Amount per position') + '<span class="cbp-n"><input type="text" inputmode="decimal" autocomplete="off" data-cbk="size" value="' + esc(fmtV(CB.size, '')) + '"><span class="dim">RM</span></span></label>' + cb('size', [5000, 10000, 20000, 50000, 100000], function (x) { return 'RM' + x / 1000 + 'K'; }) +
        '<div class="opts seg cbp-rt" role="group"><button type="button" data-cb="capv" data-v="sz:fix" aria-pressed="' + (CB.sz === 'fix') + '">' + Z('每笔固定金额', 'Fixed amount') + '</button><button type="button" data-cb="capv" data-v="sz:pct" aria-pressed="' + (CB.sz === 'pct') + '">' + Z('资金 ÷ 笔数 (复利)', 'Capital ÷ positions (compounding)') + '</button></div>' +
        '<label>' + Z('同一天符合条件的股票多过空位时，先买', 'When more stocks qualify than free slots, buy first') + '</label>' + '<div class="opts">' + Object.keys(RANK).map(function (k) { return '<button type="button" data-cb="capv" data-v="rank:' + k + '" aria-pressed="' + (CB.rank === k) + '">' + RANK[k][1] + '</button>'; }).join('') + '</div>' +
        (CB.rank === 'rand' ? '<label>' + Z('随机跑几次', 'Random runs') + '</label>' + cb('runs', [20, 50, 100], function (x) { return x + Z(' 次', ''); }) : '') +
        '<p class="dim">' + Z('起始资金 = 笔数 × 每笔金额 = RM', 'Starting capital = positions × amount = RM') + (CB.slots * CB.size).toLocaleString('en') + (CB.sz === 'pct' ? Z('；之后每笔 = 当时资金 ÷ 笔数', '; later each position = current capital ÷ positions') : '') + Z('。按 100 股一手买进。', '. Bought in 100-share lots.') + '</p>';
    } else if (p === 'period') {
      h = head(Z('回测期间', 'Period')) + '<div class="opts">' + [['m3', Z('3 个月', '3 months')], ['m6', Z('6 个月', '6 months')], ['y1', Z('1 年', '1 year')], ['all', Z('全部', 'All')]].map(function (x) { return '<button type="button" data-cb="preset" data-v="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>' +
        '<div class="cb-dates"><label>' + Z('从', 'From') + ' <input type="date" id="cb-from" value="' + esc(CB.from) + '"></label><label>' + Z('到', 'To') + ' <input type="date" id="cb-to" value="' + esc(CB.to) + '"></label></div>';
    }
    return '<div class="cbpop" id="cbpop" role="dialog">' + h + '</div>';
  }
  function cbBar() {
    var name = function (c) { return ST[c] ? ST[c].name : NAMES[c] || c; };
    var stk = (CB.uni === 'market' ? Z('全市场 ', 'Market ') + cbUniN() : CB.uni === 'pool' ? Z('股票池 ', 'Pool ') + cbUniN() : CB.codes.length === 1 ? esc(name(CB.codes[0])) : CB.codes.length ? Z(CB.codes.length + ' 支', CB.codes.length + ' stocks') : Z('未选', 'none')) + (CB.minpx ? ' · ≥RM' + CB.minpx.toFixed(2) : '');
    var per = !CB.from && !CB.to ? Z('全部', 'All') : md(CB.from || (CB.res && CB.res.first) || '') + ' ~ ' + (CB.to ? md(CB.to) : Z('最新', 'now'));
    var tcur = TPL.filter(function (t) { return t.id === CB.tpl; })[0];
    var row1 = (tplOn() ? pill('tpl', Z('模板', 'Template'), tcur ? esc(tcur.name) : TPL.length ? Z(TPL.length + ' 个', TPL.length + '') : '+') : '') + pill('stocks', Z('股票', 'Stocks'), stk) + pill('period', Z('期间', 'Period'), per) + pill('cap', Z('资金', 'Capital'), Z(CB.slots + ' 笔 × RM', CB.slots + ' × RM') + (CB.size >= 1000 ? +(CB.size / 1000).toFixed(1) + 'K' : CB.size) + (CB.sz === 'pct' ? Z(' 复利', ' comp.') : '') + ' · ' + RANK[CB.rank][0]) + '<span class="cbf-sep" aria-hidden="true"></span>' +
      CB.conds.map(function (q, i) { var l = cbLbl(q); return pill('c:' + i, esc(l[0]), esc(l[1]), ['cdel', 'c' + i], l.join(' ')); }).join('') +
      (CB.conds.length < 15 ? '<button type="button" class="padd" data-cb="pop" data-v="add" aria-expanded="' + (CB.pop === 'add') + '">+ ' + Z('条件', 'Condition') + '</button>' : '');
    var row2 = '<span class="cbf-k">' + Z('出场 (任一)', 'Exit (any)') + '</span>' + CB.exits.map(function (q, i) { var l = xLbl(q); return pill('e:' + i, esc(l[0]), esc(l[1]), ['cdel', 'e' + i], l.join(' ')); }).join('') +
      (CB.exits.length < 12 ? '<button type="button" class="padd" data-cb="pop" data-v="xadd" aria-expanded="' + (CB.pop === 'xadd') + '">+ ' + Z('结束条件', 'Exit') + '</button>' : '');
    return '<div class="cbf" id="cbf"><div class="cbf-row">' + row1 + '</div><div class="cbf-row">' + row2 + '</div>' + cbPop() + '</div>';
  }
  // 点开的编辑框对齐到它的标签下面 (手机就整排宽)
  function cbPlace() {
    var pop = document.getElementById('cbpop'), bar = document.getElementById('cbf'); if (!pop || !bar) return;
    var b = bar.querySelector('[aria-expanded="true"]'); if (!b) return;
    var tgt = b.closest('.pill') || b, x = tgt.getBoundingClientRect().left - bar.getBoundingClientRect().left;
    pop.style.marginLeft = Math.max(0, Math.min(x, bar.clientWidth - pop.offsetWidth)) + 'px';
  }
  function cbRunBtn() { return '<button type="button" class="run" data-cb="run"' + (CB.busy ? ' disabled' : '') + '>' + (CB.busy ? (CB.load ? Z('载入资料 ', 'Loading data ') + CB.load.d + '/' + CB.load.n + '…' : Z('计算中…', 'Running…')) : Z('▶ 运行回测', '▶ Run backtest')) + '</button>' + (CB.err ? '<p class="dn">' + esc(CB.err) + '</p>' : ''); }
  function pageCustom() { return cbBar() + '<div id="cb-run">' + cbRunBtn() + '</div><div id="cb-res">' + cbResHtml() + '</div>'; }
  // 背景重算完成：正在回测编辑框里打字就只换结果和运行按钮，不重画编辑框 (不然打到一半的内容会不见)
  function cbDone() {
    var ae = document.activeElement, res = document.getElementById('cb-res'), run = document.getElementById('cb-run');
    if (ae && ae.closest && ae.closest('#cbpop') && res && run && S.page === 'bt' && !S.code) { res.innerHTML = cbResHtml(); run.innerHTML = cbRunBtn(); } else render();
  }
  function cbResHtml() {
    var pos = (D.bt && D.bt.position) || 20000, R = function (v) { return isNum(v) ? v / 100 * pos : null; };
    var name = function (c) { return ST[c] ? ST[c].name : NAMES[c] || c; };
    var h = '';
    var r = CB.res;
    if (r) {
      var a = r.rep, mc = r.mc, o = r.opt, K = function (v) { return (v < 0 ? '-' : '+') + 'RM' + Math.abs(Math.round(v)).toLocaleString('en'); };
      var ymd = function (d) { return d ? d.slice(2, 10).replace(/-/g, '/') : ''; };  // 跨年份：显示 25/05/06
      var pc = function (v) { return isNum(v) ? (v > 0 ? '+' : '') + v.toFixed(1) + '%' : '—'; };
      h += pn(ttl(T('RESULT 结果')), r.n + Z(' 支 · ', ' stocks · ') + ymd(CB.from || r.first) + ' ~ ' + ymd(CB.to || r.last) + T(' · 成本 ') + r.cost + '%' + (o.rank === 'rand' ? Z(' · 随机 ' + mc.runs + ' 次的中位数', ' · median of ' + mc.runs + ' random runs') : ''),
        kv([[Z('起始资金', 'Start'), 'RM' + a.cap.toLocaleString('en')], [Z('期末资金', 'End'), 'RM' + Math.round(a.final).toLocaleString('en'), cls(a.ret)], [Z('总收益', 'Return'), pc(a.ret), cls(a.ret)], [Z('最大回撤', 'Max drawdown'), pc(a.mdd), 'dn']], true) +
        kv([[Z('年化', 'Per year'), pc(a.cagr), cls(a.cagr)], [Z('回撤金额', 'Drawdown RM'), K(a.mddRM), 'dn'], [Z('笔数', 'Trades'), a.n + (a.open ? Z(' (持仓中 ', ' (open ') + a.open + ')' : '')], [Z('胜率', 'Win rate'), isNum(a.win) ? a.win.toFixed(1) + '%' : '—'],
          [Z('平均持有', 'Avg holding'), isNum(a.hold) ? a.hold.toFixed(1) + Z(' 天', ' days') : '—'], [Z('平均持仓', 'Avg positions'), a.avgHeld.toFixed(1) + ' / ' + o.slots], [Z('满仓天数', 'Days fully invested'), a.full.toFixed(0) + '%'], [Z('没空位错过', 'Missed (no slot)'), a.missed + Z(' 个信号', ' signals')]]) +
        (a.eq.length > 2 ? blockChart(a.eq.map(function (v) { return v - a.cap; }), { rows: 6, zero: true, label: Z('资金曲线 (每天按收盘价计市值)', 'Equity (marked to market daily)'), fmt: function (v) { return (v >= 0 ? '+' : '') + (v / 1000).toFixed(1) + 'k'; },
          color: function (v) { return v >= 0 ? 'acc' : 'dn'; }, dates: [ymd(a.days[0]), ymd(a.days[a.days.length - 1])] }) +
          blockChart(a.nh, { rows: Math.min(6, Math.max(2, o.slots)), label: Z('同时持仓数', 'Positions held'), fmt: function (v) { return v.toFixed(0); }, color: function () { return 'cu'; }, dates: [ymd(a.days[0]), ymd(a.days[a.days.length - 1])] }) : '') +
        (a.n ? '' : '<p class="dim">' + Z('这段时间没有任何一天同时满足全部条件。移除几个条件或拉长时间试试。', 'No day in this period met every condition. Remove some conditions or use a longer period.') + '</p>'));
      if (o.rank === 'rand' && mc.runs > 1) h += pn(Z('随机 ' + mc.runs + ' 次', mc.runs + ' random runs'), Z('同一天信号多过空位时随机挑，看运气占多少', 'random picks when signals exceed slots: how much is luck'),
        '<div class="trd-wrap"><table class="trd"><thead><tr><th></th><th class="n">' + Z('最差 5%', 'Worst 5%') + '</th><th class="n">' + Z('中位数', 'Median') + '</th><th class="n">' + Z('最好 5%', 'Best 5%') + '</th></tr></thead><tbody>' +
        '<tr><td>' + Z('总收益', 'Return') + '</td><td class="n ' + cls(mc.ret.lo) + '">' + pc(mc.ret.lo) + '</td><td class="n ' + cls(mc.ret.med) + '">' + pc(mc.ret.med) + '</td><td class="n ' + cls(mc.ret.hi) + '">' + pc(mc.ret.hi) + '</td></tr>' +
        '<tr><td>' + Z('最大回撤', 'Max drawdown') + '</td><td class="n dn">' + pc(mc.dd.lo) + '</td><td class="n dn">' + pc(mc.dd.med) + '</td><td class="n dn">' + pc(mc.dd.hi) + '</td></tr>' +
        '<tr><td>' + Z('亏钱的机率', 'Chance of a loss') + '</td><td class="n" colspan="3">' + mc.loss.toFixed(0) + '%</td></tr></tbody></table></div>');
      // 策略诊断
      var dg = cbDiag(r), st = cbStrat(); CB.dx = dg.items.map(function (x) { return x.act; });
      var row = function (k, v) { return '<div class="dg-r"><span class="dim">' + k + '</span><span>' + v + '</span></div>'; };
      h += pn(Z('策略诊断', 'Strategy check'), '',
        '<p class="dg-v dg-' + dg.verdict + '">' + esc(dg.vtxt) + '</p>' +
        '<div class="dg-s">' + row(Z('进场 (全部成立)', 'Entry (all)'), st.entry.map(esc).join('<br>')) + row(Z('出场 (任一)', 'Exit (any)'), st.exit.map(esc).join('<br>')) +
          row(Z('资金', 'Capital'), esc(st.cap)) + row(Z('股票', 'Stocks'), esc(st.uni)) + row(Z('期间', 'Period'), esc(st.period)) + '</div>' +
        (dg.items.length ? '<ol class="dg-i">' + dg.items.map(function (x, i) { return '<li>' + esc(x.txt) + (x.act ? '<br><button type="button" class="more" data-cb="fix" data-v="' + i + '">' + Z('试试：', 'Try: ') + esc(x.lbl) + ' →</button>' : '') + '</li>'; }).join('') + '</ol>'
          : '<p class="dim">' + Z('交易资料里没有看到明显的问题。', 'Nothing obvious stands out in the trades.') + '</p>') +
        '<p class="dim">' + Z('「试试」会改设定并重新回测，自己比较前后结果。在同一段资料上改太多次，容易只是刚好适合过去，最好再换一段期间验证。', '“Try” changes the setting and re-runs; compare the results yourself. Tuning many times on the same data tends to fit the past, so confirm on another period.') + '</p>' +
        '<button type="button" class="more" data-cb="askai">✦ ' + Z('问 AI 怎么改进', 'Ask AI how to improve') + '</button>');
      // 每月：开仓 / 平仓 / 平均持仓 / 当月盈亏 / 月底资金
      if (a.days.length > 20) {
        var mo = {}, order = [];
        a.days.forEach(function (d, i) { var k = d.slice(0, 7), g = mo[k]; if (!g) { g = mo[k] = { o: 0, c: 0, h: 0, n: 0, s: i ? a.eq[i - 1] : a.cap, e: 0 }; order.push(k); } g.h += a.nh[i]; g.n++; g.e = a.eq[i]; });
        a.trades.forEach(function (t) { var k1 = t.sig.slice(0, 7); if (mo[k1]) mo[k1].o++; if (t.exit_date && mo[t.exit_date.slice(0, 7)]) mo[t.exit_date.slice(0, 7)].c++; });
        h += pn(Z('每月', 'By month'), '', '<div class="trd-wrap"><table class="trd"><thead><tr><th>' + Z('月份', 'Month') + '</th><th class="n">' + Z('开仓', 'Opened') + '</th><th class="n">' + Z('平仓', 'Closed') + '</th><th class="n">' + Z('平均持仓', 'Avg held') + '</th><th class="n">' + Z('当月盈亏', 'P/L') + '</th><th class="n">' + Z('月底资金', 'Equity') + '</th></tr></thead><tbody>' +
          order.slice().reverse().map(function (k) { var g = mo[k], pl = g.e - g.s; return '<tr><td>' + k.slice(2).replace('-', '/') + '</td><td class="n">' + g.o + '</td><td class="n">' + g.c + '</td><td class="n">' + (g.h / g.n).toFixed(1) + '</td><td class="n ' + cls(pl) + '">' + K(pl) + '</td><td class="n">' + Math.round(g.e).toLocaleString('en') + '</td></tr>'; }).join('') + '</tbody></table></div>');
      }
      // 分别：有交易的股票，按盈亏排 (最多 20 支)
      var per = {}; a.trades.forEach(function (t) { var g = per[t.code] || (per[t.code] = { n: 0, w: 0, s: 0 }); g.n++; if (t.pl > 0) g.w++; g.s += t.pl; });
      var pk = Object.keys(per).sort(function (x, y) { return per[y].s - per[x].s; });
      if (pk.length > 1) h += pn(ttl(T('BY STOCK 分别')), pk.length > 20 ? Z('盈亏最多 / 最少的各 10 支', 'top and bottom 10') : '', '<div class="trd-wrap"><table class="trd"><thead><tr><th>' + Z('股票', 'Stock') + '</th><th class="n">' + Z('笔', 'Trades') + '</th><th class="n">' + Z('胜率', 'Win') + '</th><th class="n">' + Z('合计 RM', 'Total RM') + '</th></tr></thead><tbody>' +
        (pk.length > 20 ? pk.slice(0, 10).concat(pk.slice(-10)) : pk).map(function (c) { var g = per[c]; return '<tr><td><button type="button" class="nm" data-q="' + esc(c) + '"><b>' + esc(name(c)) + '</b></button></td><td class="n">' + g.n + '</td><td class="n">' + (g.w / g.n * 100).toFixed(0) + '%</td><td class="n ' + cls(g.s) + '">' + K(g.s) + '</td></tr>'; }).join('') + '</tbody></table></div>');
      var xl = function (t) { if (t.reason === 'open') return Z('持仓中', 'Still open'); var q = r.exits[+t.reason.slice(1)]; return q ? xLbl(q).join(' ').trim() : t.reason; };
      var cl = r.trades.filter(function (t) { return t.reason !== 'open'; });
      // 出场原因：哪一个结束条件出了几笔、赚还是亏
      if (r.trades.length) {
        var grp = {}; r.trades.forEach(function (t) { var g = grp[t.reason] || (grp[t.reason] = { n: 0, w: 0, s: 0, rm: 0, lbl: xl(t) }); g.n++; if (t.pl > 0) g.w++; g.s += t.net; g.rm += t.pl; });
        h += pn(Z('出场原因', 'Exit reasons'), '', '<div class="trd-wrap"><table class="trd"><thead><tr><th>' + Z('原因', 'Reason') + '</th><th class="n">' + Z('笔', 'Trades') + '</th><th class="n">' + Z('胜率', 'Win') + '</th><th class="n">' + Z('平均', 'Avg') + '</th><th class="n">' + Z('合计 RM', 'Total RM') + '</th></tr></thead><tbody>' +
          Object.keys(grp).sort(function (a, b) { return grp[b].n - grp[a].n; }).map(function (k) { var g = grp[k]; return '<tr><td>' + esc(g.lbl) + '</td><td class="n">' + g.n + '</td><td class="n">' + (g.w / g.n * 100).toFixed(0) + '%</td><td class="n ' + cls(g.s) + '">' + pct(g.s / g.n, 1) + '</td><td class="n ' + cls(g.rm) + '">' + K(g.rm) + '</td></tr>'; }).join('') + '</tbody></table></div>');
      }
      // 最大浮亏 / 浮盈：赢的交易中途最多跌多少 (止损可以设在哪)、最多涨过多少 (回吐了多少)
      if (cl.length > 2) {
        var wn = cl.filter(function (t) { return t.net > 0; }), ls = cl.filter(function (t) { return t.net <= 0; }), avg = function (a, f) { return a.length ? a.reduce(function (s2, t) { return s2 + f(t); }, 0) / a.length : null; };
        var p90 = (function () { if (wn.length < 3) return null; var m = wn.map(function (t) { return -t.mae; }).sort(function (a, b) { return a - b; }); return m[Math.min(m.length - 1, Math.floor(m.length * 0.9))]; })();
        h += pn(Z('最大浮亏 / 浮盈', 'Adverse / favourable excursion'), Z('持仓期间盘中最低 / 最高', 'intraday low / high while holding'),
          kv([[Z('赢单平均最大浮亏', 'Winners: avg worst dip'), pct(avg(wn, function (t) { return t.mae; }), 1), 'dn'], [Z('输单平均最大浮亏', 'Losers: avg worst dip'), pct(avg(ls, function (t) { return t.mae; }), 1), 'dn'],
            [Z('九成赢单浮亏不超过', '90% of winners dipped less than'), isNum(p90) ? '-' + p90.toFixed(1) + '%' : '—', 'dn'], [Z('平均最大浮盈', 'Avg best gain'), pct(avg(cl, function (t) { return t.mfe; }), 1), 'up'],
            [Z('赢单平均回吐', 'Winners: avg give-back'), isNum(avg(wn, function (t) { return t.mfe - t.ret; })) ? '-' + avg(wn, function (t) { return t.mfe - t.ret; }).toFixed(1) + '%' : '—'], [Z('输单曾经浮盈', 'Losers once up by'), pct(avg(ls, function (t) { return t.mfe; }), 1), 'up']]));
      }
      // 参数测试：换几个数值看合计和回撤
      var sx = r.exits.map(function (q, k) { return SENS[q.t] ? k : -1; }).filter(function (k) { return k >= 0; });
      if (sx.length && a.n) {
        var sv = CB.sens, rows = sv && sv.rows ? '<div class="trd-wrap"><table class="trd"><thead><tr><th>' + esc(xLbl(r.exits[sv.k])[0]) + '</th><th class="n">' + Z('笔', 'Trades') + '</th><th class="n">' + Z('胜率', 'Win') + '</th><th class="n">' + Z('总收益', 'Return') + '</th><th class="n">' + Z('最大回撤', 'Max DD') + '</th><th class="n">' + Z('亏钱机率', 'Loss chance') + '</th></tr></thead><tbody>' +
          sv.rows.map(function (x) { return '<tr' + (x.val === sv.cur ? ' class="on"' : '') + '><td>' + (x.val == null ? Z('不用', 'off') : x.val + (sv.key === 'v' && r.exits[sv.k].t !== 'hold' ? '%' : '')) + '</td><td class="n">' + x.n + '</td><td class="n">' + (isNum(x.win) ? x.win.toFixed(0) + '%' : '—') + '</td><td class="n ' + cls(x.ret) + '">' + pc(x.ret) + '</td><td class="n dn">' + pc(x.dd) + '</td><td class="n">' + x.loss.toFixed(0) + '%</td></tr>'; }).join('') + '</tbody></table></div>' : '';
        h += pn(Z('参数测试', 'Parameter test'), '', '<div class="sens-f"><select id="cb-sx">' + sx.map(function (k) { return '<option value="' + k + '"' + (sv && sv.k === k ? ' selected' : '') + '>' + esc(xLbl(r.exits[k]).join(' ').trim()) + '</option>'; }).join('') + '</select><button type="button" class="ok" data-cb="sens"' + (sv && sv.busy ? ' disabled' : '') + '>' + (sv && sv.busy ? Z('计算中…', 'Running…') : Z('测试不同数值', 'Try other values')) + '</button></div>' + rows);
      }
      // 逐笔：栏位对齐
      if (r.trades.length) h += pn(ttl(T('TRADES 逐笔')), r.trades.length + T(' 笔 (新到旧)'), '<div class="trd-wrap"><table class="trd trd-t"><thead><tr><th>' + Z('股票', 'Stock') + '</th><th>' + Z('进场', 'Entry') + '</th><th>' + Z('出场', 'Exit') + '</th><th class="n">' + Z('天数', 'Days') + '</th><th>' + Z('出场原因', 'Exit reason') + '</th><th class="n">' + Z('最大浮亏', 'Worst') + '</th><th class="n">' + Z('最大浮盈', 'Best') + '</th><th class="n">' + Z('盈亏', 'P/L') + '</th><th class="n">RM</th></tr></thead><tbody>' +
        r.trades.slice(0, CB.tlim).map(function (t) {
          return '<tr><td><button type="button" class="nm" data-q="' + esc(t.code) + '"><b>' + esc(name(t.code)) + '</b></button></td><td>' + ymd(t.sig) + ' <span class="dim">' + px(t.entry) + '</span></td><td>' + (t.reason === 'open' ? '—' : ymd(t.exit_date) + ' <span class="dim">' + px(t.exit) + '</span>') + '</td><td class="n">' + t.days + '</td>' +
            '<td class="rsn">' + esc(xl(t)) + (t.det ? ' <span class="dim">@' + t.det + '</span>' : '') + '</td><td class="n dn">' + pct(t.mae, 1) + '</td><td class="n up">' + pct(t.mfe, 1) + '</td><td class="n b ' + cls(t.net) + '">' + pct(t.net, 1) + '</td><td class="n ' + cls(t.pl) + '">' + K(t.pl) + '</td></tr>';
        }).join('') + '</tbody></table></div>' + (r.trades.length > CB.tlim ? '<button type="button" class="more" data-cb="tmore">' + Z('再显示 60 笔', 'Show 60 more') + '</button>' : ''));
    }
    return h;
  }
  function pageBt() {
    var seg = '<div class="opts seg" role="group" aria-label="' + Z('回测', 'Backtest') + '"><button type="button" data-cb="mode" data-v="ledger" aria-pressed="' + (S.bt !== 'custom') + '">' + Z('后台策略', 'Built-in strategy') + '</button><button type="button" data-cb="mode" data-v="custom" aria-pressed="' + (S.bt === 'custom') + '">' + Z('自定义回测', 'Custom backtest') + '</button></div>';
    return seg + (S.bt === 'custom' ? pageCustom() : pageBtLedger());
  }
  function cbClick(t) {
    var a = t.dataset.cb, v = t.dataset.v;
    if (a === 'mode') { S.bt = v; try { localStorage.setItem('bterm_btmode', v); } catch (e) {} syncSoon(); render(); }
    else if (a === 'add') { cbAdd([v]); cbRe(); }
    else if (a === 'add-sig') cbAdd((D.signals || []).map(function (x) { return x.code; }));
    else if (a === 'add-watch') cbAdd(curFolder().codes);
    else if (a === 'add-top') cbAdd(LIST.filter(function (s) { return s.pool === 1; }).sort(function (x, y) { return (y.to || 0) - (x.to || 0); }).slice(0, 10).map(function (s) { return s.code; }));
    else if (a === 'clear') { CB.codes = []; CB.res = null; cbSave(); render(); }
    else if (a === 'del') { CB.codes = CB.codes.filter(function (c) { return c !== v; }); cbSave(); render(); cbRe(); }
    else if (a === 'preset') { cbPreset(v); cbRe(); }
    else if (a === 'run') { CB.pop = null; cbRun(); }
    else if (a === 'tsave' || a === 'tload' || a === 'tdel' || a === 'tseed') tplClick(a, v);
    else if (a === 'pop') { CB.pop = v && CB.pop !== v ? v : null; CB.cq = ''; CB.tnote = ''; render(); var f = CB.pop && document.querySelector(CB.pop === 'add' || CB.pop === 'xadd' || CB.pop === 'padd' ? '#cb-cq' : CB.pop === 'stocks' ? '#cb-q' : '#cbpop select, #cbpop input'); if (f && !narrowUI()) f.focus(); }
    else if (a === 'cdel' && v[0] === 'p') { PC.splice(+v.slice(1), 1); CB.pop = null; pcSave(); render(); }
    else if (a === 'cdel') { (v[0] === 'e' ? CB.exits : CB.conds).splice(+v.slice(1), 1); CB.pop = null; cbSave(); render(); cbRe(); }
    else if (a === 'pcadd') { var pq = cbNew(v); if (!pq || pq.t) return; PC.push(pq); CB.pop = 'p:' + (PC.length - 1); pcSave(); S.limit = 50; render(); }
    else if (a === 'pq') pqToggle(v);
    else if (a === 'pclear') { PC = []; S.flt = {}; CB.pop = null; pcSave(); render(); }
    else if (a === 'pcol') pcolToggle(v);
    else if (a === 'pd') pdPick(v);
    else if (a === 'lbn') { LB.n = +v; render(); }
    else if (a === 'lb') lbRun();
    else if (a === 'lbcsv') lbCsv();
    else if (a === 'lb20csv') lb20Csv();
    else if (a === 'pcsv') poolCsv();
    else if (a === 'psave') psvAdd();
    else if (a === 'pdel') { PSV = PSV.filter(function (r) { return r.id !== v; }); psvSave(); render(); }
    else if (a === 'papply') psvApply(v);
    else if (a === 'svcsv') { var sr = PSV.filter(function (r) { return r.id === v; })[0]; if (sr) csvDl('bursa-pool-saved-' + sr.d + '.csv', PSV_HEAD, psvRows(sr)); }
    else if (a === 'svall') csvDl('bursa-pool-saved-all.csv', PSV_HEAD, [].concat.apply([], PSV.map(psvRows)));
    else if (a === 'cadd') { var nq = cbNew(v); if (!nq) return; CB.conds.push(nq); CB.pop = nq.t ? null : 'c:' + (CB.conds.length - 1); cbSave(); render(); cbRe(); }
    else if (a === 'rt') { var rp = v.split(':'), ra = rp[0][0] === 'e' ? CB.exits : rp[0][0] === 'p' ? PC : CB.conds, ri = +rp[0].slice(1), rq = ra[ri]; if (!rq || rq.t) return; rq = JSON.parse(JSON.stringify(rq));
      if (rp[1] === 'i') rq.r = { k: rq.l.k === 'close' ? 'ema' : 'close' }; else { delete rq.r; if (rq.v == null) rq.v = 0; }
      ra[ri] = (ra === CB.exits ? xCond : cbCond)(rq); if (ra === PC) { pcSave(); render(); return; } cbSave(); render(); cbRe(); }
    else if (a === 'reset') { CB.conds = CB_DEF.map(cbCond); CB.pop = null; cbSave(); render(); cbRe(); }
    else if (a === 'xadd') { var xq = xNew(v); if (!xq) return; CB.exits.push(xq); CB.pop = xq.t === 'combo' ? null : 'e:' + (CB.exits.length - 1); cbSave(); render(); cbRe(); }
    else if (a === 'sens') { var sel = document.getElementById('cb-sx'); if (sel) cbSens(+sel.value); }
    else if (a === 'tmore') { CB.tlim += 60; render(); }
    else if (a === 'uni') { CB.uni = v; cbSave(); render(); cbRe(); }
    else if (a === 'fix') cbFix(+v);
    else if (a === 'askai') cbAskAI();
    else if (a === 'capv') { var cv = v.split(':'); CB[cv[0]] = cv[0] === 'rank' || cv[0] === 'sz' ? cv[1] : +cv[1]; cbSave(); render(); cbRe(); }
  }
  try { S.bt = localStorage.getItem('bterm_btmode') === 'custom' ? 'custom' : 'ledger'; } catch (e) { S.bt = 'ledger'; }
  // 新股 = 真正的 IPO：IPO 名单上 (管理员更正优先) 上市 NEWD 天内。只看 IPO 名单：日线短的不一定是新股 (附加股权利 R1、转板、改代码、资料缺口)，老股票刚进股票池也不算
  var NEWD = 180, IPOM = null;
  function dayDiff(a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / 864e5); }
  function ipoListing(code) {
    if (IPO && (!IPOM || IPOM.src !== IPO)) { IPOM = { src: IPO, m: {} }; IPO.forEach(function (r) { if (r.code && r.listing) IPOM.m[r.code] = r.listing; }); }
    var o = ovGet(code, 'ipo'); return (o && o.listing) || (IPOM && IPOM.src === IPO && IPOM.m[code]) || null;
  }
  function listDays(s, at) {  // 上市第几天 (个股页「上市天数」)：IPO 名单的上市日，没有就用日线第一天；at = 以哪一天算，没给 = 今天
    var l = ipoListing(s.code), td = at || today();
    if (l) return l <= td ? dayDiff(l, td) + 1 : null;
    var st = ST[s.code] || s; if (!isNum(st.listed)) return null;
    var x = st.listed - (at ? Math.max(0, dayDiff(at, today())) : 0); return x > 0 ? x : null;
  }
  function isNewList(s, at) {
    var l = ipoListing(s.code), td = at !== undefined && at !== null ? at : pdOn() ? S.pd : today();
    return !!l && l <= td && dayDiff(l, td) + 1 <= NEWD;
  }
  var FLT = [['n', 'ipo', Z('新股', 'New listings'), isNewList]];
  // 股票池筛选 = 跟回测一样的条件标签 (用每支股票最近 90 天的 K 线算，看最新那一天是否全部成立)；常用的几个一按就加 / 移除
  var PQ = [['s', Z('SAR 在价下', 'SAR below'), { l: { k: 'close' }, op: 'gt', r: { k: 'sar', o: 'val' } }], ['e', '> EMA20', { l: { k: 'close' }, op: 'gt', r: { k: 'ema', p: [20] } }],
    ['v', Z('相对量 ≥ 2', 'RVOL ≥ 2'), { l: { k: 'rvol', p: [20] }, op: 'ge', v: 2 }], ['l', 'RSI < 30', { l: { k: 'rsi', p: [14] }, op: 'lt', v: 30 }], ['h', 'RSI > 70', { l: { k: 'rsi', p: [14] }, op: 'gt', v: 70 }]];
  var PC = (function () { try { var j = JSON.parse(localStorage.getItem('bterm_pool') || 'null'); return j && Array.isArray(j.conds) ? j.conds.map(cbCond).filter(function (q) { return q && !q.t; }).slice(0, 15) : []; } catch (e) { return []; } })();
  function pcSave() { try { localStorage.setItem('bterm_pool', JSON.stringify({ conds: PC })); } catch (e) {} syncSoon(); }
  function pqIdx(k) { var q0 = cbCond(PQ.filter(function (x) { return x[0] === k; })[0][2]); for (var i = 0; i < PC.length; i++) if (same(PC[i], q0)) return i; return -1; }
  function pqToggle(k) { var i = pqIdx(k); if (i >= 0) PC.splice(i, 1); else PC.push(cbCond(PQ.filter(function (x) { return x[0] === k; })[0][2])); CB.pop = null; pcSave(); S.limit = 50; render(); }
  var PXC = {};  // 股票池：每支股票的指标快取 (90 天 K 线 / 2 年日线各一份)
  function idxOf(arr, d, key) { for (var i = arr.length - 1; i >= 0; i--) { var x = key ? arr[i][key] : arr[i][0]; if (x === d) return i; if (x < d) return -1; } return -1; }
  var DSET = null;
  function hasDaily(code) { if (!DSET) { DSET = {}; (D.daily || []).forEach(function (c) { DSET[c] = 1; }); } return !!DSET[code]; }
  function pxAt(code, d, warm) {  // → {X, i} 那天的位置 | null 没有资料 | undefined 要先载入 2 年日线
    var raw = BARS && BARS[code], j = raw ? (d ? idxOf(raw, d) : raw.length - 1) : -1;
    if (raw && j >= 19 && (!d || j >= warm)) {
      var c = PXC[code] && PXC[code].raw === raw ? PXC[code] : (PXC[code] = { raw: raw, X: cbCtx(bars(code), null) });
      return { X: c.X, i: j };
    }
    if (!d) return null;
    if (!(code in DAILY)) return hasDaily(code) || raw ? undefined : null;
    var f = DAILY[code]; if (!f) return null;
    var k = idxOf(f, d, 'd'); if (k < 19) return null;
    var c2 = PXC['@' + code] && PXC['@' + code].raw === f ? PXC['@' + code] : (PXC['@' + code] = { raw: f, X: cbCtx(f, null) });
    return { X: c2.X, i: k };
  }
  function pcPass(d, need) {  // → function(s) 这支股票在 d 那天 (没给 = 今天) 是否符合全部条件；need = 要先载入日线的代码
    if (!PC.length) return function () { return true; };
    var warm = cbWarm(PC);
    return function (s) { var e = pxAt(s.code, d, warm); if (e === undefined) { if (need) need.push(s.code); return false; } return !!e && cbTest(e.X, PC)(e.i); };
  }
  // ---------- 股票池存档：每天收盘后的股票池 (downloads/pool/*.csv，保留约一年)。选日期 = 看那天的股票池，条件用那天的 K 线算 ----------
  var PDAY = {}, PDL = {}, PLD = null;
  function arch() { return (D && D.arch) || {}; }
  function archUrl(p) { return (D.report || '../') + p; }
  var TDAYS = null;  // 有日线的日子 = 交易日 (90 天 K 线里任何一支股票有那天的 K 线)
  function tradeDay(d) {
    if (new Date(d + 'T00:00:00Z').getUTCDay() % 6 === 0) return false;  // 周六、周日
    if (!BARS) return true;
    if (!TDAYS) { TDAYS = { min: '9999' }; Object.keys(BARS).forEach(function (c) { BARS[c].forEach(function (x) { TDAYS[x[0]] = 1; if (x[0] < TDAYS.min) TDAYS.min = x[0]; }); }); }
    return d < TDAYS.min || !!TDAYS[d];  // 90 天以内：没有任何 K 线的日子 = 公共假期 / 休市
  }
  function poolDates() { var a = arch().pool; return a && Array.isArray(a.dates) ? a.dates.filter(tradeDay) : []; }
  function pdOn() { return !!(S.pd && D && S.pd !== D.date); }  // 正在看过去某一天
  function csvParse(t) {
    var rows = [], row = [], f = '', q = false; t = String(t).replace(/^\ufeff/, '');
    for (var i = 0; i < t.length; i++) {
      var c = t[i];
      if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
      else f += c;
    }
    if (f || row.length) { row.push(f); rows.push(row); }
    return rows;
  }
  function poolCsvRows(t) {  // 存档 CSV → 跟 LIST 一样的物件 (价格、涨跌、成交量…都是那天的)
    var a = csvParse(t), h = a.shift() || [], I = {};
    [['t', '类型'], ['code', '代码'], ['name', '名称'], ['p', '价格'], ['c', '涨跌%'], ['vol', '成交量'], ['to', '成交额'], ['rv', '相对量'], ['rsi', 'RSI']].forEach(function (x) { I[x[0]] = h.indexOf(x[1]); });
    if (I.code < 0) return null;
    var num = function (r, k) { var v = I[k] >= 0 ? parseFloat(r[I[k]]) : NaN; return isFinite(v) ? v : null; };
    return a.filter(function (r) { return r.length > 2 && /^[0-9A-Z]{3,8}$/.test(r[I.code]); }).map(function (r) {
      return { code: r[I.code], name: r[I.name] || r[I.code], p: num(r, 'p'), c: num(r, 'c'), vol: num(r, 'vol'), to: num(r, 'to'), rv: num(r, 'rv'), rsi: num(r, 'rsi'), sig: r[I.t] === '信号' ? 1 : 0, pool: 1 };
    });
  }
  function loadPoolDay(d) {
    if (PDAY[d]) return Promise.resolve(PDAY[d]);
    if (PDL[d]) return PDL[d];
    var a = arch().pool; if (!a || !a.fmt) return Promise.resolve(PDAY[d] = { err: 1 });
    return PDL[d] = fetch(archUrl(a.fmt.replace('{d}', d))).then(function (r) { return r.ok ? r.text() : null; }).catch(function () { return null; }).then(function (t) {
      var rows = t ? poolCsvRows(t) : null; PDAY[d] = rows ? { rows: rows } : { err: 1 }; delete PDL[d]; return PDAY[d];
    });
  }
  function needDaily(codes) {  // 过去太久 / 今天不在报告里的股票：载入 2 年日线后重画
    if (!codes.length || PLD) return;
    PLD = { n: codes.length, done: 0 };
    cbLoadAll(codes, function (k) { PLD.done = k; var e = document.getElementById('pool-n'); if (e) e.textContent = Z('载入 K 线 ', 'Loading bars ') + k + ' / ' + PLD.n; })
      .then(function () { PLD = null; if (S.page === 'pool' && !S.code) render(); });
  }
  function wkd(d) { return Z('日一二三四五六'.charAt(new Date(d + 'T00:00:00Z').getUTCDay()), 'SunMonTueWedThuFriSat'.substr(new Date(d + 'T00:00:00Z').getUTCDay() * 3, 3)); }
  function pdPick(d) {
    S.pd = d && d !== D.date ? d : ''; S.limit = 50;
    if (S.pd) loadPoolDay(S.pd).then(function () { if (S.page === 'pool' && !S.code) render(); });
    render();
  }
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function poolDays() {  // 日期选择条：最近 20 个交易日排成一排 (左旧右新，今天在最右边)；更早的在最左边的下拉选单
    var all = [D.date].concat(poolDates().filter(function (d) { return d < D.date; })), cur = pdOn() ? S.pd : D.date;
    if (all.length < 2) return '';
    var near = all.slice(0, 20).reverse(), far = all.slice(20), farOn = far.indexOf(cur) >= 0;
    var cell = function (d, i) {
      var td = d === D.date, mo = i === 0 || d.slice(5, 7) !== near[i - 1].slice(5, 7), m = +d.slice(5, 7);
      var top = td ? Z('今天', 'Today') : mo ? Z(m + '月', MON[m - 1]) : wkd(d);
      return '<button type="button" class="pday' + (mo ? ' mo' : '') + (td ? ' td' : '') + '" role="radio" aria-checked="' + (d === cur) + '" data-cb="pd" data-v="' + (td ? '' : d) + '" title="' + d + ' ' + wkd(d) + '" aria-label="' + d + ' ' + wkd(d) + '">' +
        '<small>' + top + '</small><b>' + (+d.slice(8)) + '</b></button>';
    };
    return '<div class="pdays" role="radiogroup" aria-label="' + Z('股票池日期 (最近 20 个交易日)', 'Pool date (last 20 trading days)') + '">' +
      (far.length ? '<select class="pday-more' + (farOn ? ' on' : '') + '" data-pdsel="1" aria-label="' + Z('更早的日期', 'Earlier dates') + '"><option value="">' + Z('更早', 'Older') + '</option>' +
        far.map(function (d) { return '<option value="' + d + '"' + (d === cur ? ' selected' : '') + '>' + d + ' ' + wkd(d) + '</option>'; }).join('') + '</select>' : '') +
      near.map(cell).join('') + '</div>';
  }
  function pdScroll() {  // 手机上一排放不下：卷到选中的那天 (默认今天，在最右边)
    var pd = document.querySelector('.pdays'); if (!pd || pd.scrollWidth <= pd.clientWidth) return;
    var on = pd.querySelector('[aria-checked="true"]') || pd.lastElementChild;
    pd.scrollLeft = Math.max(0, on.offsetLeft - pd.offsetLeft - pd.clientWidth + on.offsetWidth + 24);
  }
  // 表格的数字栏：[key, 快捷键, 名称, 表头, 宽 (ch), 取值, 显示]；显示哪几栏自己选 (至少一栏)，任何一栏都能排序 (默认成交量)，存在这台设备
  var PCOL = [['chg', 'c', Z('涨跌', 'Change'), Z('涨跌%', 'CHG%'), 6, function (s) { return s.c; }, function (s) { return '<span class="num ' + cls(s.c) + '">' + pct(s.c, 1).replace('%', '') + '</span>'; }],
    ['vol', 'u', Z('成交量', 'Volume'), Z('成交量', 'VOL'), 6, function (s) { return s.vol; }, function (s) { return '<span class="num">' + (isNum(s.vol) ? big(s.vol) : '—') + '</span>'; }],
    ['to', 'o', Z('成交额', 'Value'), Z('成交额', 'VALUE'), 7, function (s) { return s.to; }, function (s) { return '<span class="num">' + (isNum(s.to) ? big(s.to) : '—') + '</span>'; }],
    ['rv', 'r', Z('相对量', 'RVOL'), Z('相对量', 'RVOL'), Z(6, 4), function (s) { return s.rv; }, function (s) { return '<span class="num' + (s.rv >= 2 ? ' warn' : '') + '">' + (isNum(s.rv) ? s.rv.toFixed(1) : '—') + '</span>'; }],
    ['rsi', 'i', 'RSI', 'RSI', 3, function (s) { return s.rsi; }, function (s) { return '<span class="num">' + (isNum(s.rsi) ? s.rsi.toFixed(0) : '—') + '</span>'; }]];
  var SORT = PCOL.map(function (c) { return [c[1], c[0], c[2], function (s) { var v = c[5](s); return isNum(v) ? v : 0; }]; });
  var PS = (function () { try { return JSON.parse(localStorage.getItem('bterm_pcols') || 'null') || {}; } catch (e) { return {}; } })();
  if (PCOL.some(function (c) { return c[0] === PS.sort; })) { S.sort = PS.sort; S.dir = PS.dir === 1 ? 1 : -1; }
  function pcols() {
    var c = Array.isArray(PS.cols) ? PS.cols.filter(function (k) { return PCOL.some(function (x) { return x[0] === k; }); }) : [];
    return c.length ? c : narrowUI() ? ['chg', 'vol', 'rv'] : ['chg', 'vol', 'rv', 'rsi'];
  }
  function psSave() { PS.sort = S.sort; PS.dir = S.dir; try { localStorage.setItem('bterm_pcols', JSON.stringify(PS)); } catch (e) {} }
  function pcolToggle(k) {
    var c = pcols(), on = c.indexOf(k) >= 0; if (on && c.length < 2) return;
    PS.cols = PCOL.map(function (x) { return x[0]; }).filter(function (x) { return x === k ? !on : c.indexOf(x) >= 0; }); psSave(); render();
  }
  function poolSrc() { return pdOn() ? ((PDAY[S.pd] && PDAY[S.pd].rows) || []) : LIST; }  // 那天的股票池
  function poolList(noSearch) {
    var need = [], past = pdOn(), q = noSearch ? '' : S.q.trim().toUpperCase(), fs = FLT.filter(function (f) { return S.flt[f[1]]; }), so = SORT.filter(function (x) { return x[1] === S.sort; })[0], pass = pcPass(past ? S.pd : '', need);
    var out = poolSrc().filter(function (s) { return (q ? (s.name.toUpperCase().indexOf(q) >= 0 || s.code.indexOf(q) >= 0) : s.pool === 1) && fs.every(function (f) { return f[3](s); }) && pass(s); })
      .sort(function (a, b) { return (so[3](a) - so[3](b)) * S.dir; });  // dir -1 = 高到低, 1 = 低到高
    needDaily(need); out.need = need.length;
    return out;
  }
  // 同一个排序再按一次 = 换方向 (高到低 ⇄ 低到高)
  function setSort(k) { if (S.sort === k) S.dir = -S.dir; else { S.sort = k; S.dir = -1; } psSave(); render(); }
  function poolHead() {
    var past = pdOn();
    return T('<div class="grep"><label for="grep">grep&gt;</label><input id="grep" type="search" inputmode="search" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="名称或代码 (搜全部)" value="').replace(/placeholder="[^"]*"/, past ? 'placeholder="' + Z('在 ' + md(S.pd) + ' 的股票池里找名称或代码', 'Name or code in the ' + md(S.pd) + ' pool') + '"' : '$&') + esc(S.q) + '"></div>' +
      '<div class="cbf" id="cbf"><div class="cbf-row" role="group" aria-label="' + Z('筛选', 'Filters') + '">' +
        PQ.map(function (x) { return '<button type="button" class="qchip" data-cb="pq" data-v="' + x[0] + '" aria-pressed="' + (pqIdx(x[0]) >= 0) + '"><span class="k">[' + x[0] + ']</span>' + x[1] + '</button>'; }).join('') +
        FLT.map(function (f) { return '<button type="button" class="qchip" data-flt="' + f[1] + '" aria-pressed="' + !!S.flt[f[1]] + '"><span class="k">[' + f[0] + ']</span>' + f[2] + '</button>'; }).join('') + '</div>' +
        '<div class="cbf-row">' + PC.map(function (q, i) { var l = cbLbl(q); return pill('p:' + i, esc(l[0]), esc(l[1]), ['cdel', 'p' + i], l.join(' ')); }).join('') +
        (PC.length < 15 ? '<button type="button" class="padd" data-cb="pop" data-v="padd" aria-expanded="' + (CB.pop === 'padd') + '">+ ' + Z('条件', 'Condition') + '</button>' : '') +
        (PC.length || S.flt.ipo ? '<button type="button" class="more" data-cb="pclear">' + Z('清除全部 [a]', 'Clear all [a]') + '</button>' : '') + '</div>' + cbPop() + '</div>' +
      '<div class="opts po" role="group" aria-label="' + Z('排序', 'Sort') + '"><span class="ol">' + Z('排序', 'Sort') + '</span>' + SORT.map(function (x) { return '<button type="button" data-sort="' + x[1] + '" aria-pressed="' + (S.sort === x[1]) + '" title="' + Z('再按一次换方向', 'Press again to flip') + '"><span class="k">[' + x[0] + ']</span>' + x[2] + (S.sort === x[1] ? (S.dir < 0 ? '↓' : '↑') : '') + '</button>'; }).join('') + '</div>' +
      '<div class="opts po" role="group" aria-label="' + Z('显示栏位', 'Columns') + '"><span class="ol">' + Z('显示', 'Show') + '</span>' + PCOL.map(function (c) { var on = pcols().indexOf(c[0]) >= 0; return '<button type="button" class="pcol" data-cb="pcol" data-v="' + c[0] + '" aria-pressed="' + on + '">' + (on ? '✓ ' : '') + c[2] + '</button>'; }).join('') + '</div>';
  }
  function poolBody() {
    var past = pdOn(), day = past ? PDAY[S.pd] : null;
    if (past && (!day || day.err)) return { rows: '<p class="dim">' + (day ? Z('这一天没有股票池存档。', 'No pool archive for this day.') : Z('载入 ' + md(S.pd) + ' 的股票池存档…', 'Loading the ' + md(S.pd) + ' pool archive…')) + '</p>', n: md(S.pd) };
    var l = poolList(), n = poolSrc().filter(function (s) { return s.pool === 1; }).length;
    function th(k, t) { var on = S.sort === k; return '<button type="button" class="num th' + (on ? ' on' : '') + '" data-sort="' + k + '">' + (on ? (S.dir < 0 ? '↓' : '↑') : '') + t + '</button>'; }
    var cs = pcols().map(function (k) { return PCOL.filter(function (x) { return x[0] === k; })[0]; });
    var cw = cs.map(function (c) { return c[4] + (S.sort === c[0] ? 1 : 0); }), spk = cols() >= 4 + 5 + 6 + cw.reduce(function (a, b) { return a + b; }, 0) + 12 + cs.length + 4;  // 太窄就不放 30 天小图
    var gt = ' style="grid-template-columns:4ch ' + (spk ? 'minmax(5ch,9ch)' : 'minmax(5ch,1fr)') + ' 6ch ' + cw.map(function (w) { return w + 'ch'; }).join(' ') + (spk ? ' minmax(0,1fr)' : '') + '"';
    var rows = '<div class="grid-pool thead"' + gt + '><span>' + Z('代码', 'CODE') + '</span><span>' + Z('名称', 'NAME') + '</span><span class="num">' + Z('价格', 'LAST') + '</span>' + cs.map(function (c) { return th(c[0], c[3]); }).join('') + (spk ? '<span>' + Z('30天', '30D') + '</span>' : '') + '</div>' +
      l.slice(0, S.limit).map(function (s) {
        return '<button type="button" class="row" data-q="' + esc(s.code) + '" style="display:block"><span class="grid-pool"' + gt + '><span class="dim">' + esc(s.code) + '</span><span class="' + (s.pool ? '' : 'dim') + '">' + (isNewList(s) ? '<span class="nb">' + Z('新股', 'IPO') + '</span>' : '') + esc(s.name) + '</span><span class="num">' + px(s.p) + '</span>' +
          cs.map(function (c) { return c[6](s); }).join('') +
          (spk ? '<span class="' + cls(s.c) + '">' + sparkFor(s.code, 12, past ? S.pd : '') + (s.sig ? ' <span class="up">SIG</span>' : '') + '</span>' : '') + '</span></button>';
      }).join('') + (l.length > S.limit ? T('<button type="button" class="more" data-more="1">→ 再显示 ') + Math.min(50, l.length - S.limit) + T(' 支 (共 ') + l.length + ')</button>' : '');
    var wait = (PC.length && !BARS) || l.need ? '<p class="dim">' + Z('载入 K 线中…', 'Loading bars…') + '</p>' : '';
    return { rows: wait + rows, n: (past ? md(S.pd) + ' ' + wkd(S.pd) + ' · ' : '') + (S.q ? T('搜索 ') + l.length + T(' 支') : l.length + ' / ' + n + T(' 支 · 成交量 ≥ 1M')) };
  }
  // ---------- 回看 / 储存 / 下载 ----------
  function nowQ(code) {  // 最新价 + 日期 (今天的报告 → 2 年日线 → 90 天 K 线)
    if (ST[code] && isNum(ST[code].p)) return { p: ST[code].p, d: D.date };
    var b = DAILY[code] || bars(code), x = b && b.length ? b[b.length - 1] : null; return x ? { p: x.c, d: x.d } : null;
  }
  function nowPx(code) { var q = nowQ(code); return q ? q.p : null; }
  function nowD(code) { var q = nowQ(code); return q ? q.d : ''; }
  function since(p0, code, d0) {  // 那天收盘 → 之后最新价；没有比那天新的价格就不算 (不是 0%)
    var q = nowQ(code); return isNum(p0) && p0 > 0 && q && isNum(q.p) && (!d0 || q.d > d0) ? (q.p / p0 - 1) * 100 : null;
  }
  function avgOf(a) { a = a.filter(isNum); return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null; }
  function condTxt(cs) { return (cs || []).map(function (q) { q = cbCond(q); return q ? cbLbl(q).join(' ') : ''; }).filter(Boolean).join(' · '); }
  function fltTxt(f) { return FLT.filter(function (x) { return (f || []).indexOf(x[1]) >= 0; }).map(function (x) { return x[2]; }).join(' · '); }
  function csvDl(name, head, rows) {  // 在浏览器里产生 CSV 下载 (Excel 打得开：UTF-8 BOM)
    var cell = function (v) { v = v == null ? '' : String(v); if (/^[=+@]/.test(v)) v = "'" + v; return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var t = '﻿' + [head].concat(rows).map(function (r) { return r.map(cell).join(','); }).join('\r\n');
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([t], { type: 'text/csv;charset=utf-8' })); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  function chips(list) {  // [{code, name, ch}] → 一排可以点的股票 + 之后涨跌
    return list.map(function (x) { return '<button type="button" class="lb-c" data-q="' + esc(x.code) + '">' + esc(x.name) + (isNum(x.ch) ? ' <span class="' + cls(x.ch) + '">' + pct(x.ch, 1) + '</span>' : '') + '</button>'; }).join('');
  }
  // 回看：这组条件 (+ 新股筛选) 在最近 N 个存档日各有哪些股票，之后到今天涨跌多少
  var LB = { n: 20, res: null, busy: 0, key: '', prog: '' };
  function lbKey() { return canon({ c: PC, f: S.flt, n: LB.n, d: D && D.date }); }
  function lbRun() {
    if (LB.busy) return LB.p || Promise.resolve();
    var ds = [D.date].concat(poolDates().filter(function (d) { return d < D.date; })).slice(0, LB.n);
    LB.busy = 1; LB.res = null; LB.key = lbKey(); LB.prog = Z('载入存档…', 'Loading archives…'); render();
    return LB.p = Promise.all(ds.slice(1).map(loadPoolDay)).then(function () {
      var warm = cbWarm(PC), need = {};
      if (PC.length) ds.forEach(function (d, k) { var day = k ? PDAY[d] : { rows: LIST }; ((day && day.rows) || []).forEach(function (s) { if (s.pool === 1 && pxAt(s.code, k ? d : '', warm) === undefined) need[s.code] = 1; }); });
      return cbLoadAll(Object.keys(need), function (a, b) { LB.prog = Z('载入 K 线 ', 'Loading bars ') + a + ' / ' + b; var e = document.getElementById('lb-prog'); if (e) e.textContent = LB.prog; });
    }).then(function () {
      var fs = FLT.filter(function (f) { return S.flt[f[1]]; });
      LB.res = ds.map(function (d, k) {
        var day = k ? PDAY[d] : { rows: LIST }; if (!day || day.err) return { d: d, err: 1 };
        var rows = day.rows.filter(function (s) { return s.pool === 1; }), pass = pcPass(k ? d : '');
        var hit = rows.filter(function (s) { return fs.every(function (f) { return f[3](s, k ? d : null); }) && pass(s); })
          .map(function (s) { return { code: s.code, name: s.name, p: s.p, ch: k ? since(s.p, s.code, d) : null }; })
          .sort(function (a, b) { return (isNum(b.ch) ? b.ch : -1e9) - (isNum(a.ch) ? a.ch : -1e9); });
        return { d: d, n: rows.length, hit: hit };
      });
      LB.busy = 0; LB.p = null; if (S.page === 'pool' && !S.code) render();
    });
  }
  function lb20Csv() { LB.n = 20; (LB.res && LB.key === lbKey() ? Promise.resolve() : lbRun()).then(lbCsv); }  // 最近 20 个交易日 (这组条件) 一次下载
  function lbCsv() {
    if (!LB.res) return; var rows = [], ct = condTxt(PC), ft = fltTxt(Object.keys(S.flt).filter(function (k) { return S.flt[k]; }));
    LB.res.forEach(function (r) { (r.hit || []).forEach(function (x) { rows.push([r.d, x.code, x.name, x.p, nowPx(x.code), nowD(x.code), isNum(x.ch) ? x.ch.toFixed(2) : '', [ct, ft].filter(Boolean).join(' · ')]); }); });
    csvDl('bursa-pool-lookback-' + D.date + '.csv', [Z('日期', 'Date'), Z('代码', 'Code'), Z('名称', 'Name'), Z('当天收盘', 'Close that day'), Z('最新价', 'Latest'), Z('最新价日期', 'Latest date'), Z('之后涨跌%', 'Change since %'), Z('条件', 'Conditions')], rows);
  }
  function lbPanel() {
    var nd = poolDates().length, scr = PC.length || FLT.some(function (f) { return S.flt[f[1]]; });
    if (!nd) return '';
    var h = '<div class="opts po"><span class="ol">' + Z('最近', 'Last') + '</span>' + [5, 10, 20].map(function (n) { return '<button type="button" data-cb="lbn" data-v="' + n + '" aria-pressed="' + (LB.n === n) + '">' + n + Z(' 天', ' days') + '</button>'; }).join('') +
      '<button type="button" class="lb-go" data-cb="lb"' + (!LB.busy ? '' : ' disabled') + '>▶ ' + Z('回看', 'Look back') + '</button>' +
      (LB.res ? '<button type="button" class="lb-dl" data-cb="lbcsv">⤓ CSV</button>' : '') + '</div>';
    if (!scr && !LB.res && !LB.busy) h += '<p class="dim">' + Z('没有条件 = 每天整个股票池；在上面加条件或按「新股」，就是看这组条件在过去每一天筛出哪些股票、之后到今天涨跌多少。', 'No conditions = the whole pool each day. Add conditions or "New listings" above to see what this screen picked on each past day and how those stocks moved since.') + '</p>';
    if (LB.busy) h += '<p class="dim" id="lb-prog">' + esc(LB.prog) + '</p>';
    else if (LB.res) {
      if (LB.key !== lbKey()) h += '<p class="warn">' + Z('条件或天数改了，按「回看」重新算。', 'The screen changed. Press "Look back" again.') + '</p>';
      h += '<div class="lb">' + LB.res.map(function (r) {
        var av = r.hit ? avgOf(r.hit.map(function (x) { return x.ch; })) : null, today0 = r.d === D.date;
        return '<div class="lb-r"><div class="lb-h"><button type="button" class="lb-d" data-cb="pd" data-v="' + (today0 ? '' : r.d) + '" title="' + Z('看那天的股票池', 'Open that day') + '">' + md(r.d) + ' ' + wkd(r.d) + '</button>' +
          (r.err ? '<span class="dim">' + Z('没有存档', 'no archive') + '</span>' : '<span>' + Z('符合 ', '') + '<b>' + r.hit.length + '</b> / ' + r.n + Z(' 支', ' stocks') + '</span>' + (!today0 && isNum(av) ? '<span class="dim">' + Z('之后平均 ', 'avg since ') + '<span class="' + cls(av) + '">' + pct(av, 1) + '</span></span>' : '')) + '</div>' +
          (r.hit && r.hit.length ? '<div class="lb-s">' + chips(r.hit.slice(0, 30)) + (r.hit.length > 30 ? '<span class="dim">+' + (r.hit.length - 30) + '</span>' : '') + '</div>' : '') + '</div>';
      }).join('') + '</div><p class="dim">' + Z('「之后」= 那天收盘价到最新价，只是历史记录，不是买卖建议。', '"Since" = that day\'s close to the latest price. A historical record, not advice.') + '</p>';
    }
    return pn(Z('TRACK 回看', 'TRACK'), Z('这组条件在过去几天', 'this screen on past days'), h);
  }
  // 储存：把这次筛选结果 (日期、条件、股票和当天价格) 存起来，之后随时看涨跌、下载；登录后跟账号同步
  var PSV = (function () { try { var j = JSON.parse(localStorage.getItem('bterm_psaved') || 'null'); return Array.isArray(j) ? j.filter(function (r) { return r && r.id && Array.isArray(r.s); }) : []; } catch (e) { return []; } })();
  var PSV_MAX = 30, PSV_BYTES = 30000;
  function psvTrim(a) { a = a.slice(0, PSV_MAX); while (a.length > 1 && JSON.stringify(a).length > PSV_BYTES) a.pop(); return a; }
  function psvSave() { PSV = psvTrim(PSV); try { localStorage.setItem('bterm_psaved', JSON.stringify(PSV)); } catch (e) {} syncSoon(); }
  function psvAdd() {
    var l = poolList(true); if (!l.length) return;
    var t = new Date(Date.now() + 8 * 3600e3).toISOString();
    PSV.unshift({ id: 'p' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36), at: t.slice(0, 10) + ' ' + t.slice(11, 16), d: pdOn() ? S.pd : D.date, n: l.length,
      c: PC.map(function (q) { return JSON.parse(JSON.stringify(q)); }), f: Object.keys(S.flt).filter(function (k) { return S.flt[k]; }),
      s: l.slice(0, 60).map(function (x) { return [x.code, String(x.name).slice(0, 30), x.p]; }) });
    S.svOpen = PSV[0].id; psvSave(); render();
  }
  function svLoad(id) {  // 打开一笔记录：今天不在报告里的股票，载入日线拿最新价
    var r = PSV.filter(function (x) { return x.id === id; })[0]; if (!r) return;
    var need = r.s.map(function (x) { return x[0]; }).filter(function (c) { return !ST[c] && !(c in DAILY) && hasDaily(c); });
    if (need.length) cbLoadAll(need).then(function () { if (S.page === 'pool' && !S.code) render(); });
  }
  function psvApply(id) {
    var r = PSV.filter(function (x) { return x.id === id; })[0]; if (!r) return;
    PC = (r.c || []).map(cbCond).filter(function (q) { return q && !q.t; }); S.flt = {}; (r.f || []).forEach(function (k) { S.flt[k] = true; });
    pcSave(); pdPick(poolDates().indexOf(r.d) >= 0 || r.d === D.date ? r.d : ''); window.scrollTo(0, 0);
  }
  function psvRows(r) { return r.s.map(function (x) { var ch = since(x[2], x[0], r.d); return [r.at, r.d, condTxt(r.c) + (r.f && r.f.length ? ' · ' + fltTxt(r.f) : ''), x[0], x[1], x[2], nowPx(x[0]), nowD(x[0]), isNum(ch) ? ch.toFixed(2) : '']; }); }
  var PSV_HEAD = [Z('储存时间', 'Saved at'), Z('日期', 'Date'), Z('条件', 'Conditions'), Z('代码', 'Code'), Z('名称', 'Name'), Z('当天收盘', 'Close that day'), Z('最新价', 'Latest'), Z('最新价日期', 'Latest date'), Z('之后涨跌%', 'Change since %')];
  function svPanel() {
    var past = pdOn(), day = past ? PDAY[S.pd] : null, ok = !past || (day && day.rows);
    var h = '<div class="opts po"><button type="button" class="lb-go" data-cb="psave"' + (ok ? '' : ' disabled') + '>＋ ' + Z('储存这次结果', 'Save this result') + ' (' + md(past ? S.pd : D.date) + ')</button>' +
      (PSV.length ? '<button type="button" class="lb-dl" data-cb="svall">⤓ ' + Z('全部 CSV', 'All as CSV') + '</button>' : '') + '</div>';
    h += PSV.length ? '<div class="sv">' + PSV.map(function (r) {
      var list = r.s.map(function (x) { return { code: x[0], name: x[1], ch: since(x[2], x[0], r.d) }; }), av = avgOf(list.map(function (x) { return x.ch; })), ct = condTxt(r.c), ft = fltTxt(r.f);
      return '<details class="sv-r"' + (S.svOpen === r.id ? ' open' : '') + ' data-sv="' + esc(r.id) + '"><summary><b>' + md(r.d) + ' ' + wkd(r.d) + '</b> · ' + r.n + Z(' 支', ' stocks') + (isNum(av) && r.d !== D.date ? ' · ' + Z('之后平均 ', 'avg since ') + '<span class="' + cls(av) + '">' + pct(av, 1) + '</span>' : '') +
        '<br><small class="dim">' + esc([ct, ft].filter(Boolean).join(' · ') || Z('没有条件 (整个股票池)', 'No conditions (whole pool)')) + '</small></summary>' +
        '<div class="lb-s">' + chips(list) + (r.n > list.length ? '<span class="dim">+' + (r.n - list.length) + '</span>' : '') + '</div>' +
        '<div class="opts"><button type="button" data-cb="papply" data-v="' + esc(r.id) + '">' + Z('套用这组条件', 'Use this screen') + '</button><button type="button" data-cb="svcsv" data-v="' + esc(r.id) + '">⤓ CSV</button>' +
        '<button type="button" class="dn" data-cb="pdel" data-v="' + esc(r.id) + '">' + Z('删除', 'Delete') + '</button></div></details>';
    }).join('') + '</div>' : '<p class="dim">' + Z('还没有储存的结果。储存后可以随时回来看这些股票之后的涨跌，或下载 CSV；登录后会跟账号同步。', 'Nothing saved yet. Saved results show how the stocks moved since and can be downloaded as CSV; they sync with your account when signed in.') + '</p>';
    return pn(Z('SAVED 储存', 'SAVED'), PSV.length + ' / ' + PSV_MAX, h);
  }
  // 下载：跟完整报告的「下载报告」同一批存档文件，跟着上面选的日期走
  function dlPanel() {
    var A = arch(), d = pdOn() ? S.pd : D.date, rep0 = (A.days || []).filter(function (x) { return x.d === d; })[0], pf = A.pool, has = poolDates().indexOf(d) >= 0;
    var a = function (href, lab) { return '<a class="dl-a" href="' + esc(archUrl(href)) + '" download>' + lab + '</a>'; };
    var row = function (k, v) { return '<div class="dl-r"><span class="dl-k">' + k + '</span><span class="dl-v">' + v + '</span></div>'; };
    var h = '';
    h += row(Z('这次筛选结果', 'This screen'), '<button type="button" class="dl-a" data-cb="pcsv">CSV</button>');
    h += row(Z('最近 20 个交易日', 'Last 20 trading days'), '<button type="button" class="dl-a" data-cb="lb20csv"' + (LB.busy ? ' disabled' : '') + '>CSV</button><small class="dim">' + Z('这组条件每天符合的股票 (没有条件 = 整个股票池)', 'stocks matching this screen each day (no conditions = whole pool)') + '</small>');
    if (pf && has) h += row(Z('股票池存档', 'Pool archive'), a(pf.fmt.replace('{d}', d), 'CSV'));
    h += row(Z('完整报告', 'Full report'), rep0 ? ['csv', 'xlsx', 'pdf'].filter(function (k) { return rep0.f[k]; }).map(function (k) { return a(rep0.f[k], { csv: 'CSV', xlsx: 'Excel', pdf: 'PDF' }[k]); }).join('') +
      '<small class="dim">' + esc((rep0.t ? rep0.t + Z(' 更新 · ', ' · ') : '') + (rep0.sig && rep0.sig.length ? Z('信号 ', 'signals ') + rep0.sig.join('、') : Z('无信号', 'no signal')) + ' · ' + Z('共 ', '') + rep0.n + Z(' 支', ' stocks')) + '</small>'
      : '<span class="dim">' + Z('完整报告只保留近 7 个交易日', 'Full reports are kept for 7 trading days') + '</span>');
    var comb = [];
    if (A.comb) comb.push(Z('近 7 天报告 ', '7-day report ') + a(A.comb.xlsx, 'Excel') + a(A.comb.csv, 'CSV'));
    if (pf && pf.hist) comb.push(Z('近 ' + pf.hdays + ' 天股票池 ', pf.hdays + '-day pool ') + a(pf.hist, 'CSV'));
    if (comb.length) h += row(Z('合并', 'Combined'), comb.join('<span class="dim"> · </span>'));
    return pn(Z('DOWNLOAD 下载', 'DOWNLOAD'), md(d) + ' ' + wkd(d), '<div class="dl">' + h + '</div>');
  }
  function poolCsv() {
    var l = poolList(true), d = pdOn() ? S.pd : D.date, ct = [condTxt(PC), fltTxt(Object.keys(S.flt).filter(function (k) { return S.flt[k]; }))].filter(Boolean).join(' · ');
    csvDl('bursa-pool-' + d + '.csv', [Z('日期', 'Date'), Z('代码', 'Code'), Z('名称', 'Name'), Z('价格', 'Price'), Z('涨跌%', 'Change %'), Z('成交量', 'Volume'), Z('成交额', 'Value'), Z('相对量', 'RVOL'), 'RSI', Z('新股', 'New listing'), Z('条件', 'Conditions')],
      l.map(function (s) { return [d, s.code, s.name, s.p, s.c, s.vol, s.to, s.rv, s.rsi, isNewList(s) ? Z('新股', 'yes') : '', ct]; }));
  }
  function pagePool() {
    loadIpo();  // 「新股」要用 IPO 上市日
    if (pdOn() && !PDAY[S.pd]) loadPoolDay(S.pd).then(function () { if (S.page === 'pool' && !S.code) render(); });
    var b = poolBody();
    return pn(T('POOL 股票池'), '<span id="pool-n">' + b.n + '</span>', poolDays() + poolHead() + '<div class="rows pool-tbl" id="pool-body">' + b.rows + '</div>') + lbPanel() + svPanel() + dlPanel();
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
    var m = D.market || {}, ix = m.index, b = m.breadth, h = sqBox();
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
      .then(function (j) { IPO = (j && j.ipos) || []; IPO.updated = j && j.updated; if (S.code || S.page === 'cal' || S.page === 'pool') render(); });
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

  // ---------- ✦ AI 问答：每一页右下角的按钮，问题 + 当前页面的资料一起送给用户选的模型 (DeepSeek / ChatGPT / Gemini / Claude) ----------
  // ⚙ 设置 (只存在这台设备的浏览器)：DeepSeek = Worker (worker/ai-proxy.js，密钥在 Cloudflare) 或自己的密钥；其他三家 = 用户自己的 API 密钥 (浏览器直接连)
  var AI_SYS = T('你是 Bursa Bot 终端版里的 AI 助手，帮用户看懂马来西亚股票的公开资料。用户的问题后面会附上「当前页面资料」，回答要以这些资料为根据，资料里没有的就说没有，不要编造数字或事件。') +
    T('用简体中文回答，条理清楚、简短；需要时分点。可以解释指标、财报数字的变化、公告在说什么、有哪些需要留意的事项。') +
    T('绝对不要给买入、卖出、持有、加仓、止损、目标价或任何操作建议，也不要预测股价涨跌；用户问「该不该买」时，说明你不能给建议，改为整理相关事实和需要留意的地方。');
  var AI = { open: false, busy: false, msgs: [], ctxKey: null, cfg: (function () { try { return JSON.parse(localStorage.getItem('bterm_ai') || '{}'); } catch (e) { return {}; } })(), setup: false, setp: null };
  function aiSave() { try { localStorage.setItem('bterm_ai', JSON.stringify(AI.cfg)); } catch (e) {} }

  // ---------- 🤖 选模型：DeepSeek / ChatGPT / Gemini / Claude ----------
  // 面板上方一排可以左右滑的模型 (或按 ‹ ›、方向键 ← →)。各家的 API 密钥用户自己填 (⚙ 设置)，只存在这台设备 (bterm_ai，不会同步、不会传到本网站)；
  // 问问题时浏览器直接连到那一家。DeepSeek 另外可以走网站的 Worker (通行码)。ChatGPT / Gemini 的模型名称失效时，自动改用该服务商现在提供的名称。
  var PROV = {
    deepseek: { name: 'DeepSeek', ph: 'sk-…', models: [['auto', 'Flash']] },
    openai: { name: 'ChatGPT', ph: 'sk-…', models: [['gpt-5-mini', 'GPT-5 mini'], ['gpt-5', 'GPT-5']] },
    gemini: { name: 'Gemini', ph: 'AIza…', models: [['gemini-2.5-flash', '2.5 Flash'], ['gemini-2.5-pro', '2.5 Pro']] },
    claude: { name: 'Claude', ph: 'sk-ant-…', models: [['claude-opus-5-5', 'Opus 5.5'], ['claude-sonnet-5-5', 'Sonnet 5.5'], ['claude-haiku-5-5', 'Haiku 5.5']] }
  };
  var PROV_IDS = ['deepseek', 'openai', 'gemini', 'claude'];
  (function () { var c = AI.cfg; if (!PROV[c.prov]) c.prov = 'deepseek'; c.keys = c.keys && typeof c.keys === 'object' ? c.keys : {}; c.model = c.model && typeof c.model === 'object' ? c.model : {}; c.extra = c.extra && typeof c.extra === 'object' ? c.extra : {}; c.alias = c.alias && typeof c.alias === 'object' ? c.alias : {}; })();
  function provReady(p) {
    var c = AI.cfg;
    if (p === 'deepseek') return c.mode === 'worker' ? !!(c.url && c.pass) : c.mode === 'key' ? !!c.key : false;
    return !!c.keys[p];
  }
  function aiReady() { return provReady(AI.cfg.prov); }
  function anyReady() { return PROV_IDS.some(provReady); }
  function curModel(p) { p = p || AI.cfg.prov; return AI.cfg.model[p] || PROV[p].models[0][0]; }
  function realModel(p, id) { id = id || curModel(p); var a = AI.cfg.alias[p]; return a && a[id] || id; }  // 原本的名称失效后自动换成的名称
  function modelLabel(p, id) { var r = realModel(p, id); if (r !== id) return r; var m = PROV[p].models.filter(function (x) { return x[0] === id; })[0]; return m ? m[1] : id; }
  function modelName(p, id) { p = p || AI.cfg.prov; id = id || curModel(p); return p === 'deepseek' ? 'DeepSeek' + (AI.cfg.mode === 'worker' ? ' · Worker' : '') : PROV[p].name + ' · ' + modelLabel(p, id); }
  function modelList() {  // 每家的预设模型 + 用户自己填的 + 自动换过的名称
    var out = [];
    PROV_IDS.forEach(function (p) {
      var ms = PROV[p].models.slice();
      [AI.cfg.extra[p], AI.cfg.model[p]].forEach(function (x) { if (x && !ms.some(function (m) { return m[0] === x; })) ms.push([x, x]); });
      ms.forEach(function (m) { out.push({ p: p, id: m[0], label: m[1] }); });
    });
    return out;
  }
  function modelRow() {
    var p0 = AI.cfg.prov, m0 = curModel();
    return '<div class="ai-mrow"><button type="button" class="ai-mnav" data-ai="mprev" aria-label="' + Z('上一个模型', 'Previous model') + '">‹</button>' +
      '<div class="ai-models" role="radiogroup" aria-label="' + Z('选择 AI 模型 (左右滑动，或按 ← →)', 'Choose the AI model (swipe, or press ← →)') + '">' + modelList().map(function (x) {
        var on = x.p === p0 && x.id === m0, ok = provReady(x.p);
        return '<button type="button" role="radio" class="pm pm-' + x.p + (ok ? '' : ' nokey') + '" aria-checked="' + on + '" tabindex="' + (on ? 0 : -1) + '" data-ai="model" data-p="' + x.p + '" data-v="' + esc(x.id) + '">' +
          '<b>' + PROV[x.p].name + '</b><small>' + esc(x.p === 'deepseek' ? (AI.cfg.mode === 'worker' ? 'Worker' : x.label) : modelLabel(x.p, x.id)) + (ok ? '' : Z(' · 未设密钥', ' · no key')) + '</small></button>';
      }).join('') + '</div><button type="button" class="ai-mnav" data-ai="mnext" aria-label="' + Z('下一个模型', 'Next model') + '">›</button></div>';
  }
  function modelPick(p, id) {
    if (!PROV[p]) return;
    AI.cfg.prov = p; if (p !== 'deepseek') AI.cfg.model[p] = id; aiSave();  // 还没设密钥的也可以选：输入框那里会提示去设置
  }
  function modelStep(d) {  // ‹ › / ← →：换到上一个 / 下一个模型
    var list = modelList(), i = 0;
    list.forEach(function (x, k) { if (x.p === AI.cfg.prov && x.id === curModel()) i = k; });
    var x = list[(i + d + list.length) % list.length]; modelPick(x.p, x.id);
  }
  // 那一排滑到选中的模型 (从原本的位置平滑滑过去)
  function modelScroll(prev) {
    var row = document.querySelector('#ai-panel .ai-models'), on = row && row.querySelector('[aria-checked="true"]'); if (!on) return;
    var to = Math.max(0, on.offsetLeft - (row.clientWidth - on.offsetWidth) / 2);
    if (prev != null) { row.scrollLeft = prev; if (row.scrollTo) row.scrollTo({ left: to, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); else row.scrollLeft = to; }
    else row.scrollLeft = to;
  }

  // ---------- 各家 API (浏览器直接连) ----------
  function sseRead(r, onData) {  // 读 Server-Sent Events：每个 data: 行交给 onData (JSON)
    var rd = r.body.getReader(), dec = new TextDecoder(), buf = '';
    function line(ln) { ln = ln.trim(); if (ln.indexOf('data:') !== 0) return; var d = ln.slice(5).trim(); if (!d || d === '[DONE]') return; try { onData(JSON.parse(d)); } catch (e) {} }
    function pump() {
      return rd.read().then(function (x) {
        if (x.done) { if (buf) line(buf); return; }
        buf += dec.decode(x.value, { stream: true });
        var lines = buf.split('\n'); buf = lines.pop(); lines.forEach(line);
        return pump();
      });
    }
    return pump();
  }
  function httpErr(p, status, text) {
    var why = status === 401 || status === 403 ? Z(' 密钥不对或没有权限', ' wrong key or no access') : status === 402 ? Z(' 余额不足', ' insufficient balance')
      : status === 429 ? Z(' 太频繁或额度用完', ' rate limit or quota reached') : status === 404 ? Z(' 找不到这个模型', ' model not found') : '';
    var e = new Error(PROV[p].name + ' HTTP ' + status + why + (text ? ' · ' + String(text).replace(/\s+/g, ' ').slice(0, 140) : '')); e.status = status; return e;
  }
  var OA_URL = 'https://api.openai.com/v1', GM_URL = 'https://generativelanguage.googleapis.com/v1beta';
  function oaHeaders() { return { 'Content-Type': 'application/json', Authorization: 'Bearer ' + AI.cfg.keys.openai }; }
  function gmHeaders() { return { 'Content-Type': 'application/json', 'x-goog-api-key': AI.cfg.keys.gemini }; }
  // 模型名称失效 (ChatGPT / Gemini)：列出这把密钥能用的模型，挑同一类最新的 (mini / flash 优先跟原本一样)，记在这台设备
  function listModels(p) {
    var req = p === 'openai' ? fetch(OA_URL + '/models', { headers: oaHeaders() }) : fetch(GM_URL + '/models?pageSize=200', { headers: gmHeaders() });
    return req.then(function (r) { if (!r.ok) throw httpErr(p, r.status); return r.json(); }).then(function (j) {
      return p === 'openai' ? (j.data || []).map(function (m) { return m.id; })
        : (j.models || []).filter(function (m) { return (m.supportedGenerationMethods || []).indexOf('generateContent') >= 0; }).map(function (m) { return String(m.name || '').replace(/^models\//, ''); });
    });
  }
  function pickModel(p, ids, want) {
    var ver = function (id) { var m = /(\d+(?:\.\d+)?)/.exec(id); return m ? parseFloat(m[1]) : 0; };
    var ok = p === 'openai' ? ids.filter(function (id) { return /^gpt-\d/.test(id) && !/audio|realtime|transcribe|tts|image|search|instruct|codex|oss|preview|chat-latest|\d{4}-\d{2}-\d{2}/.test(id); })
      : ids.filter(function (id) { return /^gemini-\d/.test(id) && !/tts|image|live|audio|embed|lite|exp|preview|thinking|-\d{3}$/.test(id); });
    var fam = p === 'openai' ? (/mini/.test(want) ? /mini/ : /nano/.test(want) ? /nano/ : /^gpt-[\d.]+$/) : (/pro/.test(want) ? /pro/ : /flash/);
    var same = ok.filter(function (id) { return fam.test(id); }), pool = same.length ? same : ok;
    return pool.sort(function (a, b) { return ver(b) - ver(a) || a.length - b.length; })[0] || null;
  }
  function withModel(p, run) {  // run(model) → fetch；模型失效就换一次
    var want = curModel(p), real = realModel(p, want);
    return run(real).then(function (r) {
      if (r.ok || (r.status !== 400 && r.status !== 404)) return r;
      return r.clone().text().then(function (t) {
        if (!(/model/i.test(t) && /not.?found|does not exist|not supported|unsupported|invalid|deprecat|no longer|not available/i.test(t))) return r;
        return listModels(p).then(function (ids) {
          var nm = pickModel(p, ids, real); if (!nm || nm === real) return r;
          (AI.cfg.alias[p] = AI.cfg.alias[p] || {})[want] = nm; aiSave(); return run(nm);
        }, function () { return r; });
      });
    });
  }
  // Claude：用 Anthropic 官方 SDK (terminal_assets/vendor/，选了 Claude 才下载)；dangerouslyAllowBrowser = 用户自己的密钥、浏览器直接连
  var CLAUDE_SDK = 'vendor/anthropic-sdk-1.5.0.js', claudeLib = null;
  function claudeClient() {
    if (!claudeLib) claudeLib = new Function('u', 'return import(u)')(new URL(CLAUDE_SDK, location.href).href).then(function (m) { return m.default; }, function (e) { claudeLib = null; throw new Error(Z('Claude 套件载入失败：', 'Could not load the Claude SDK: ') + e.message); });
    return claudeLib.then(function (Anthropic) { return new Anthropic({ apiKey: AI.cfg.keys.claude, dangerouslyAllowBrowser: true, maxRetries: 1 }); });
  }
  function claudeParams(sys, msgs, max) {
    var model = realModel('claude'), q = { model: model, max_tokens: max, system: sys, messages: msgs,
      betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };  // 安全分类拒绝时，服务器自动改用预设的备用模型
    if (model === 'claude-opus-5-5') q.output_config = { effort: 'medium' };
    return q;
  }
  function claudeErr(e) { return e && e.status ? httpErr('claude', e.status, e.error && e.error.error && e.error.error.message || e.message) : e; }
  // 问答 (一段一段传回来)：onText(片段)；回传 Promise (完成 / 失败)
  function aiStream(sys, hist, onText) {
    var p = AI.cfg.prov, c = AI.cfg;
    if (p === 'deepseek') {
      var req = c.mode === 'worker' ? fetch(c.url.replace(/\/$/, ''), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Pass': c.pass }, body: JSON.stringify({ messages: hist, lang: LANG }) })
        : dsFetch(c.key, { temperature: 0.3, max_tokens: 1200, stream: true, messages: [{ role: 'system', content: sys }].concat(hist) });
      return req.then(function (r) {
        if (!r.ok) return r.text().then(function (t) { throw new Error(r.status + (r.status === 401 ? T(' 通行码 / 密钥不对') : r.status === 403 ? T(' 网址不被允许 (检查 ALLOW_ORIGIN)') : r.status === 402 ? T(' DeepSeek 额度不足') : '') + ' ' + t.slice(0, 120)); });
        return sseRead(r, function (j) { var d = j.choices && j.choices[0] && j.choices[0].delta; if (d && d.content) onText(d.content); });
      });
    }
    if (p === 'openai') {
      return withModel('openai', function (m) {
        return fetch(OA_URL + '/chat/completions', { method: 'POST', headers: oaHeaders(), body: JSON.stringify({ model: m, stream: true, max_completion_tokens: 6000, messages: [{ role: 'system', content: sys }].concat(hist) }) });
      }).then(function (r) {
        if (!r.ok) return r.text().then(function (t) { throw httpErr('openai', r.status, t); });
        return sseRead(r, function (j) { var d = j.choices && j.choices[0] && j.choices[0].delta; if (d && d.content) onText(d.content); });
      });
    }
    if (p === 'gemini') {
      var contents = hist.map(function (m) { return { role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }; });
      return withModel('gemini', function (m) {
        return fetch(GM_URL + '/models/' + encodeURIComponent(m) + ':streamGenerateContent?alt=sse', { method: 'POST', headers: gmHeaders(),
          body: JSON.stringify({ systemInstruction: { parts: [{ text: sys }] }, contents: contents, generationConfig: { temperature: 0.3, maxOutputTokens: 8192 } }) });
      }).then(function (r) {
        if (!r.ok) return r.text().then(function (t) { throw httpErr('gemini', r.status, t); });
        return sseRead(r, function (j) { var ps = j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts || []; ps.forEach(function (x) { if (x.text && !x.thought) onText(x.text); }); });
      });
    }
    return claudeClient().then(function (cl) {
      var st = cl.beta.messages.stream(claudeParams(sys, hist, 16000));
      st.on('text', function (d) { onText(d); });
      return st.finalMessage().then(function (msg) {
        if (msg.stop_reason === 'refusal') onText(Z('\n\n(Claude 没有回答这个问题。)', '\n\n(Claude declined to answer this.)'));
      });
    }).catch(function (e) { throw claudeErr(e); });
  }
  // 一次拿完整回答 (🎨 主题设计用，要 JSON)
  function aiOnce(sys, user) {
    var p = AI.cfg.prov, c = AI.cfg;
    if (p === 'deepseek') {
      if (c.mode === 'worker') return fetch(c.url.replace(/\/$/, '') + '/theme', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Pass': c.pass }, body: JSON.stringify({ prompt: user, lang: LANG }) })
        .then(function (r) { if (r.status === 404 || r.status === 405) throw new Error(Z('Worker 要更新 (重新部署 worker/ai-proxy.js) 才能生成主题', 'Redeploy worker/ai-proxy.js to enable theme generation')); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (j) { return JSON.stringify(j.theme || j); });
      return dsFetch(c.key, { temperature: 0.7, max_tokens: 600, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }] })
        .then(function (r) { if (!r.ok) throw httpErr('deepseek', r.status); return r.json(); })
        .then(function (j) { return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || ''; });
    }
    if (p === 'openai') return withModel('openai', function (m) {
      return fetch(OA_URL + '/chat/completions', { method: 'POST', headers: oaHeaders(), body: JSON.stringify({ model: m, max_completion_tokens: 6000, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }] }) });
    }).then(function (r) { if (!r.ok) return r.text().then(function (t) { throw httpErr('openai', r.status, t); }); return r.json(); })
      .then(function (j) { return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || ''; });
    if (p === 'gemini') return withModel('gemini', function (m) {
      return fetch(GM_URL + '/models/' + encodeURIComponent(m) + ':generateContent', { method: 'POST', headers: gmHeaders(),
        body: JSON.stringify({ systemInstruction: { parts: [{ text: sys }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { temperature: 0.7, maxOutputTokens: 8192, responseMimeType: 'application/json' } }) });
    }).then(function (r) { if (!r.ok) return r.text().then(function (t) { throw httpErr('gemini', r.status, t); }); return r.json(); })
      .then(function (j) { return ((j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || []).filter(function (x) { return !x.thought; }).map(function (x) { return x.text || ''; }).join(''); });
    return claudeClient().then(function (cl) { return cl.beta.messages.create(claudeParams(sys, [{ role: 'user', content: user }], 16000)); })
      .then(function (msg) { return (msg.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join(''); }, function (e) { throw claudeErr(e); });
  }
  function jsonIn(s) { var m = /\{[\s\S]*\}/.exec(s || ''); if (!m) return null; try { return JSON.parse(m[0]); } catch (e) { return null; } }
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
      if (S.page === 'bt' && S.bt === 'custom' && CB.res) {  // 自定义回测：策略设定 + 组合结果 + 诊断
        var R0 = CB.res, A0 = R0.rep, M0 = R0.mc, G0 = cbDiag(R0), X0 = {};
        A0.trades.forEach(function (t) { var k = t.reason === 'open' ? T('持仓中') : xLbl(R0.exits[+t.reason.slice(1)] || {}).join(' '); var g = X0[k] || (X0[k] = { 笔数: 0, 合计RM: 0 }); g.笔数++; g.合计RM += Math.round(t.pl); });
        c.回测 = { 策略: cbStrat(), 资金曲线: { 起始: A0.cap, 期末: Math.round(A0.final), 总收益百分比: +A0.ret.toFixed(2), 最大回撤百分比: +A0.mdd.toFixed(2), 年化: A0.cagr == null ? null : +A0.cagr.toFixed(2) },
          交易: { 笔数: A0.n, 持仓中: A0.open, 平均持有天数: A0.hold, 平均持仓: +A0.avgHeld.toFixed(2), 满仓天数百分比: +A0.full.toFixed(0), 没空位错过信号: A0.missed },
          随机分布: M0.runs > 1 ? { 次数: M0.runs, 收益最差5: +M0.ret.lo.toFixed(1), 收益中位: +M0.ret.med.toFixed(1), 收益最好5: +M0.ret.hi.toFixed(1), 回撤中位: +M0.dd.med.toFixed(1), 亏钱机率: +M0.loss.toFixed(0) } : null,
          出场原因: X0, 指标: G0.stats, 程序诊断: G0.items.map(function (x) { return x.txt; }) };
      }
    }
    return c;
  }
  function aiChips() {
    if (S.code) return [T('用几句话总结这家公司最近的情况'), T('解释最新一季的财报数字'), T('这些技术指标说明了什么'), T('最近的公告在说什么'), T('有哪些需要留意的地方')];
    if (S.page === 'ann') return [T('今天最值得留意的公告有哪些'), T('把这些公告按类型整理一下')];
    if (S.page === 'cal') return [T('接下来两周有哪些重要日期'), T('哪些公司快要除息')];
    if (S.page === 'watch') return [T('整理我观察列表里股票今天的表现')];
    if (S.page === 'bt' && S.bt === 'custom' && CB.res) return [Z('这个回测策略可以怎么改进', 'How could this backtest strategy be improved'), Z('解释这次回测的结果', 'Explain these backtest results')];
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
    syncSoon();
  }
  function themeCurrent() { var sv = themeSaved(); return sv && sv.on && sv.t ? sv.t : null; }
  (function () { var c = themeCurrent(); if (c) themeApply(c); })();
  function themeAsk() {
    var q = (TH.prompt || '').trim(); if (!q || TH.busy) return;
    if (!aiReady()) { TH.err = Z('要先在 ⚙ 设置里设好 AI，才能用一句话生成；也可以直接用上面的预设。', 'Set up AI in ⚙ first to generate from a sentence; or use a preset above.'); aiRender(); return; }
    TH.busy = true; TH.err = ''; aiRender();
    var cur = TH.preview || themeCurrent(), user = q + (cur ? Z('\n\n(现在的主题，可以在这个基础上改：', '\n\n(current theme, you may adjust it: ') + JSON.stringify(cur) + ')' : '');
    aiOnce(THEME_SYS + (LANG === 'en' ? ' Write name and note in English.' : ''), user).then(function (s) {
      var o = jsonIn(s);
      var t = themeClean(o && o.theme ? o.theme : o);
      if (!t) throw new Error(Z('AI 回传的主题格式不对，再试一次', 'The AI returned an invalid theme; try again'));
      TH.preview = t; TH.note = t.note; themeApply(t);
    }).catch(function (e) { TH.err = e.message; }).then(function () { TH.busy = false; aiRender(); });
  }
  function themeView() {
    var cur = TH.preview || themeCurrent(), sw = function (t) { return ['bg', 'fg', 'acc', 'up', 'dn'].map(function (k) { return '<i style="background:' + t[k] + '"></i>'; }).join(''); };
    var h = '<div class="th">' +
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
    var oldRow = box.querySelector('.ai-models'), prevX = oldRow ? oldRow.scrollLeft : null;
    var label = S.code ? nameOf(S.code) + ' ' + S.code : ((PAGES.filter(function (p) { return p[0] === S.page; })[0] || [])[1] || '') + T(' · 今日市场');
    var setOn = AI.setup || (!TH.view && !anyReady());
    var h = '<div class="ai-top"><span class="ai-logo" aria-hidden="true">' + AI_ICON + '</span><b>' + (setOn ? Z('AI 设置', 'AI settings') : TH.view ? Z('自定义界面', 'Customize') : Z('AI 问答', 'Ask AI')) + '</b>' +
      (TH.view || setOn ? '<span class="ai-ctx"></span>' : '<span class="ai-ctx" title="' + esc(label) + '">' + esc(label) + '</span>') +
      '<button type="button" data-ai="theme" aria-pressed="' + (TH.view && !AI.setup) + '" title="' + Z('自定义界面', 'Customize the look') + '" aria-label="' + Z('自定义界面', 'Customize the look') + '">🎨</button>' +
      '<button type="button" data-ai="setup" aria-pressed="' + setOn + '" title="' + Z('AI 设置 (模型、密钥)', 'AI settings (models, keys)') + '" aria-label="' + Z('AI 设置', 'AI settings') + '">⚙</button>' +
      '<button type="button" data-ai="close" aria-label="' + Z('关闭', 'Close') + '">×</button></div>';
    if (setOn) h += aiSetView();
    else {
      h += modelRow();
      if (TH.view) h += themeView();
      else h += '<div class="ai-log" id="ai-log">' + (AI.msgs.length ? AI.msgs.map(function (m) { return '<div class="ai-m ai-' + m.role + '">' + (m.role === 'user' ? esc(m.show || m.content) : (aiFmt(m.content) || '<span class="ai-dots"><i></i><i></i><i></i></span>') + (m.by ? '<small class="ai-by">' + esc(m.by) + '</small>' : '')) + '</div>'; }).join('') :
          '') + '</div>' +
        (aiReady() ? '<div class="opts ai-chips">' + aiChips().map(function (q) { return '<button type="button" data-ai="ask" data-v="' + esc(q) + '">' + esc(q) + '</button>'; }).join('') + '</div>' +
          T('<div class="ai-in"><textarea id="ai-q" rows="2" placeholder="问 AI… (例如：这家公司的负债高吗？)"></textarea><button type="button" class="ok" data-ai="send"') + (AI.busy ? ' disabled' : '') + '>' + (AI.busy ? '…' : T('发送')) + '</button></div>'
          : '<div class="ai-need"><span>' + PROV[AI.cfg.prov].name + Z(' 还没设 API 密钥', ' has no API key yet') + '</span><button type="button" class="ok" data-ai="setp" data-v="' + AI.cfg.prov + '">' + Z('设置 ', 'Set up ') + PROV[AI.cfg.prov].name + '</button></div>') +
        T('<p class="dim ai-note">AI 生成，只根据页面资料整理，可能有错漏；不构成投资建议。') + (AI.msgs.length ? T(' <button type="button" class="more" data-ai="clear">清空对话</button>') : '') + '</p>';
    }
    box.innerHTML = h;
    modelScroll(prevX);
    var lg = document.getElementById('ai-log'); if (lg) lg.scrollTop = lg.scrollHeight;
  }
  // ⚙ 设置：上面选一家 (DeepSeek / ChatGPT / Gemini / Claude)，下面填那一家的密钥和模型
  function aiSetView() {
    var p = AI.setp || AI.cfg.prov, c = AI.cfg;
    var h = '<div class="ai-set"><div class="opts ai-ptabs" role="tablist" aria-label="' + Z('服务商', 'Provider') + '">' + PROV_IDS.map(function (q) {
      return '<button type="button" role="tab" data-ai="setp" data-v="' + q + '" aria-selected="' + (q === p) + '" aria-pressed="' + (q === p) + '">' + PROV[q].name + (provReady(q) ? ' <span class="up">✓</span>' : '') + '</button>'; }).join('') + '</div>';
    if (p === 'deepseek') {
      var md0 = c.mode === 'key' ? 'key' : 'worker';
      h += '<div class="opts"><button type="button" data-ai="mode" data-v="worker" aria-pressed="' + (md0 === 'worker') + T('">Worker (推荐)</button><button type="button" data-ai="mode" data-v="key" aria-pressed="') + (md0 === 'key') + T('">自己的 DeepSeek 密钥</button></div>') +
        (md0 === 'worker' ? T('<label>Worker 网址<input id="ai-url" type="url" autocomplete="off" placeholder="https://bursa-ai.xxx.workers.dev" value="') + esc(c.url || '') + '"></label>' +
          T('<label>通行码<input id="ai-pass" type="password" autocomplete="off" value="') + esc(c.pass || '') + '"></label>' +
          (c.edit || SY.admin ? '<label>' + Z('编辑通行码', 'Edit passcode') + '<input id="ai-edit" type="password" autocomplete="off" value="' + esc(c.edit || '') + '"></label>' : '')  // 管理员才用：已填过或网址有 ?admin 才显示
          : T('<label>DeepSeek API 密钥<input id="ai-key" type="password" autocomplete="off" placeholder="sk-…" value="') + esc(c.key || '') + '"></label>');
    } else {
      var cur = curModel(p), ex = c.extra[p] || '';
      h += '<label>' + PROV[p].name + ' API key<input id="ai-k" type="password" autocomplete="off" spellcheck="false" placeholder="' + PROV[p].ph + '" value="' + esc(c.keys[p] || '') + '"></label>' +
        '<label>' + Z('模型', 'Model') + '<select id="ai-m">' + PROV[p].models.map(function (m) { return '<option value="' + m[0] + '"' + (m[0] === cur ? ' selected' : '') + '>' + esc(PROV[p].name + ' ' + m[1]) + ' (' + m[0] + ')</option>'; }).join('') +
        (cur && !PROV[p].models.some(function (m) { return m[0] === cur; }) ? '<option value="' + esc(cur) + '" selected>' + esc(cur) + '</option>' : '') + '</select></label>' +
        '<label>' + Z('其他模型名称 (可留空；填了就用这个)', 'Other model id (optional; used if filled in)') + '<input id="ai-x" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" value="' + esc(ex) + '"></label>';
    }
    h += (p === 'deepseek' && c.mode !== 'key' ? '' : '<p class="dim">' + Z('密钥仅保存在本设备', 'Key stays on this device') + '</p>') +
      '<div class="opts"><button type="button" class="ok" data-ai="save">' + T('保存') + '</button>' + (anyReady() ? '<button type="button" data-ai="done">' + Z('返回', 'Back') + '</button>' : '') +
      (p !== 'deepseek' && c.keys[p] ? '<button type="button" data-ai="forget">' + Z('删除这个密钥', 'Remove this key') + '</button>' : '') + '</div></div>';
    return h;
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
    q = (q || '').trim(); if (!q || AI.busy || !aiReady()) return;
    var key = S.code || S.page; if (AI.ctxKey !== key) { AI.msgs = []; AI.ctxKey = key; }  // 换了股票 / 页面就开新对话
    var first = !AI.msgs.length, ctx = first ? T('\n\n【当前页面资料】\n') + JSON.stringify(aiContext()) : '';
    AI.msgs.push({ role: 'user', content: q + ctx, show: q }, { role: 'assistant', content: '', by: modelName() });
    AI.busy = true; aiRender();
    var cur = AI.msgs[AI.msgs.length - 1], hist = AI.msgs.slice(0, -1).map(function (m) { return { role: m.role, content: m.content }; }), raf = 0;
    function paint() {  // 一帧最多画一次 (Claude / Gemini 一次来很多小片段)
      raf = 0; var el = document.querySelectorAll('#ai-log .ai-assistant'); if (!el.length) return;
      el[el.length - 1].innerHTML = aiFmt(cur.content) + '<small class="ai-by">' + esc(cur.by) + '</small>'; var lg = document.getElementById('ai-log'); lg.scrollTop = lg.scrollHeight;
    }
    var p0 = AI.cfg.prov;
    aiStream(AI_SYS, hist, function (d) { cur.content += d; if (!raf) raf = requestAnimationFrame(paint); }).then(function () { cur.by = modelName(p0); }).catch(function (e) {  // 模型自动换过名称：标示实际回答的模型
      var p = AI.cfg.prov, net = /fetch|Load failed|NetworkError|network/i.test(e.message);
      cur.content = (cur.content ? cur.content + '\n\n' : '') + T('⚠ 连线失败：') + e.message +
        (net && p === 'deepseek' && AI.cfg.mode === 'key' ? T('\n浏览器可能挡掉直接连线，请改用 Worker 方式 (worker/README.md)。') : net ? Z('\n连不上 ' + PROV[p].name + '：检查网络，或这个服务商不接受浏览器直接连线。', '\nCould not reach ' + PROV[p].name + ': check the connection, or the provider may block direct browser calls.') : '');
    }).then(function () { AI.busy = false; aiRender(); });
  }
  function aiClick(t) {
    var a = t.dataset.ai;
    if (a === 'toggle') { AI.open = !AI.open; if (AI.open && SY.open) { SY.open = false; acctRender(); } }
    else if (a === 'close') AI.open = false;
    else if (a === 'setup') { var setOn = AI.setup || (!TH.view && !aiReady()); AI.setup = !setOn; AI.setp = null; if (AI.setup) TH.view = false; }
    else if (a === 'done') { AI.setup = false; AI.setp = null; }
    else if (a === 'theme') { TH.view = !(TH.view && !AI.setup); AI.setup = false; AI.setp = null; }
    else if (a === 'setp') { AI.setp = t.dataset.v; AI.setup = true; }
    else if (a === 'mode') { AI.cfg.mode = t.dataset.v; AI.setp = 'deepseek'; AI.setup = true; }
    else if (a === 'model') modelPick(t.dataset.p, t.dataset.v);
    else if (a === 'mprev' || a === 'mnext') modelStep(a === 'mprev' ? -1 : 1);
    else if (a === 'forget') { var fp = AI.setp || AI.cfg.prov; delete AI.cfg.keys[fp]; aiSave(); }
    else if (a === 'save') {
      var sp = AI.setp || AI.cfg.prov, val = function (id) { return ((document.getElementById(id) || {}).value || '').trim(); };
      if (sp === 'deepseek') {
        if (AI.cfg.mode !== 'key') { AI.cfg.mode = 'worker'; AI.cfg.url = val('ai-url'); AI.cfg.pass = val('ai-pass'); AI.cfg.edit = val('ai-edit'); OV = null; ovLoading = false; loadOv(); }
        else AI.cfg.key = val('ai-key');
      } else {
        AI.cfg.keys[sp] = val('ai-k'); var x = val('ai-x').replace(/[^\w.\-:\/]/g, '').slice(0, 80);
        if (x) AI.cfg.extra[sp] = x; else delete AI.cfg.extra[sp];
        AI.cfg.model[sp] = x || val('ai-m') || PROV[sp].models[0][0];
        if (!AI.cfg.keys[sp]) delete AI.cfg.keys[sp];
      }
      if (provReady(sp)) AI.cfg.prov = sp;  // 存好就改用这一家
      aiSave(); AI.setup = !provReady(sp); AI.setp = AI.setup ? sp : null;
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
    document.body.classList.toggle('fab-l', p.side === 'l'); document.body.classList.toggle('fab-low', y - b.lo < 60);  // 浮动搜索框给 ✦ 按钮让位
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
    loadIpo();
    var s = ST[code];
    if (!s) {  // 不在今天的报告里 (成交量不够)：用个股 2 年日线画图，其余照样显示 (简介、财报、公告、新闻)
      var bd = DAILY[code];
      if (bd === undefined) loadDaily(code).then(function () { if (S.code === code) render(); });
      var lst = bd && bd.length ? bd[bd.length - 1] : null, prv = bd && bd.length > 1 ? bd[bd.length - 2] : null, chg = lst && prv ? (lst.c / prv.c - 1) * 100 : null;
      var hm = T('<button type="button" class="back" data-back="1">← [q] 返回</button>') +
        pn(esc(nameOf(code)), esc(code), (lst ? '<p><b style="font-size:18px">' + px(lst.c) + '</b> <span class="' + cls(chg) + '">' + pct(chg) + '</span>　<span class="dim">' + md(lst.d) + T(' 收盘</span></p>') : '') +
          watchToggles(code) + (bd && bd.length > 5 ? candleChart(bd.slice(-90), { rows: 14, levels: true, label: nameOf(code) + T(' 日线') }) : '<p class="dim">' + (bd === undefined ? 'loading…' : T('没有日线')) + '</p>') +
          T('<p class="dim">这支股票今天不在报告里 (成交量没达到门槛)，没有指标和信号。</p>'));
      return hm + qTabs(code);
    }
    var sig = (D.signals || []).filter(function (x) { return x.code === code; })[0], fol = (D.follow || []).filter(function (x) { return x.code === code; })[0];
    var h = T('<button type="button" class="back" data-back="1">← [q] 返回</button>');
    h += pn(esc(s.name), esc(code), '<p><b style="font-size:18px">' + px(s.p) + '</b> <span class="' + cls(s.c) + '">' + pct(s.c) + '</span>' + (s.sig ? '　<span class="up">● SIGNAL</span>' : '') + (isNewList(s) ? '　<span class="acc">' + Z('新股 · 上市第 ' + listDays(s) + ' 天', 'New listing · day ' + listDays(s)) + '</span>' : '') + '</p>' + watchToggles(code) +
      chartFor(code, { rows: 14, levels: true, stop: sig ? sig.stop : fol ? fol.stop : null, target: sig ? sig.target : null, label: s.name + T(' 日线') }) +
      kv([[T('成交量'), big(s.vol)], [T('成交额'), 'RM ' + big(s.to)], [T('相对量'), isNum(s.rv) ? s.rv.toFixed(2) + '×' : '—', s.rv >= 2 ? 'warn' : ''], ['RSI(14)', isNum(s.rsi) ? s.rsi.toFixed(1) : '—'],
        ['EMA20', px(s.ema), isNum(s.ema) ? (s.p > s.ema ? 'up' : 'dn') : ''], [T('50日线'), px(s.sma), isNum(s.sma) ? (s.p > s.sma ? 'up' : 'dn') : ''], ['SAR', s.sar == null ? '—' : s.sar ? T('多头') : T('空头'), s.sar ? 'up' : 'dn'], ['ATR', isNum(s.atr) ? s.atr.toFixed(1) + '%' : '—'],
        [T('市值'), isNum(s.mc) ? 'RM ' + big(s.mc) : '—'], [T('股票池'), s.sig ? T('信号股') : s.pool ? (s.first ? md(s.first) + T(' 起 · ') + s.streak + T(' 天') : T('在池')) : T('不在池')], [T('上市天数'), listDays(s) != null ? listDays(s) + T(' 天') : T('> 90 天')], [T('日期'), md(D.date)]]));
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
        if (!j) return; D = j; siteBase(); ingest(); document.getElementById('status').innerHTML = status(); BARS = null; barsLoading = false; CAL = null; calLoading = false; render();
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
    ind.classList.toggle('tb-free', !!opt.free);  // 拖动时没有过渡：泡泡跟手指同一帧
    if (TB.w !== w) { ind.style.width = w + 'px'; TB.w = w; }  // 宽度只在变的时候设 (改宽度要重新排版，会卡)
    ind.style.transform = 'translate3d(' + x.toFixed(1) + 'px,0,0)';
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
      if (!TB.moved) { try { tb.setPointerCapture(e.pointerId); } catch (err) {} TB.rect = inner().getBoundingClientRect(); TB.bw = (tbButtons()[0] || {}).offsetWidth || 50; TB.v = 0; }  // 真的开始拖才锁定指针 (只点一下照常是按钮的 click)
      TB.moved = true;
      var dt = Math.max(8, e.timeStamp - TB.lastT), v = Math.abs(e.clientX - TB.lastX) / dt;  // px / ms
      TB.v = TB.v * 0.6 + v * 0.4;  // 速度平滑一下，拉长的程度不会一跳一跳
      TB.lastX = e.clientX; TB.lastT = e.timeStamp; TB.px = e.clientX;
      if (!TB.raf) TB.raf = requestAnimationFrame(tbFrame);  // 一帧只更新一次
    });
    function tbFrame() {
      TB.raf = 0;
      if (!TB.drag || !TB.moved) return;
      var r = TB.rect, w = TB.bw, x = Math.max(0, Math.min(r.width - w, TB.px - r.left - w / 2));
      tbPlace(x, w, { free: true, stretch: Math.min(0.3, TB.v * 0.2) });
      tbHot(tbNearest(x + w / 2));
    }
    var end = function (e, cancel) {
      if (!TB.drag) return;
      TB.drag = false; tb.classList.remove('tb-press');
      var hot = TB.hot; tbHot(null);
      if (TB.raf) { cancelAnimationFrame(TB.raf); TB.raf = 0; }
      if (TB.moved) {
        TB.eat = true;  // 拖完放开不要再当成点一下
        if (!cancel && hot && (hot.dataset.page !== S.page || S.code)) {
          tbPlace(hot.offsetLeft, hot.offsetWidth, { squish: true });  // 泡泡先弹过去，下一帧才换页 (重画整页时动画已经在跑，不会卡住)
          var pg = hot.dataset.page;
          requestAnimationFrame(function () { requestAnimationFrame(function () { go(pg, null, { swipe: true, tbDone: true }); }); });
        } else tabbar(true);
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
    if (!SW.lock) { if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return; SW.lock = Math.abs(dx) > Math.abs(dy) * 1.3 ? 'x' : 'y'; if (SW.lock === 'x') main.classList.add('sw-drag'); }
    if (SW.lock !== 'x') return;
    e.preventDefault();
    SW.dx = dx;
    if (!SW.raf) SW.raf = requestAnimationFrame(swFrame);  // 一帧只更新一次
  }, { passive: false });
  function swFrame() {
    if (!SW) return;
    SW.raf = 0;
    var dx = SW.dx, tg = swTarget(dx), damp = tg ? 0.55 : 0.18;  // 头尾没有下一页：拉得动但有阻力
    SW.off = dx * damp;
    main.style.transform = 'translate3d(' + SW.off.toFixed(1) + 'px,0,0)';
    main.style.opacity = String(Math.max(0.6, 1 - Math.abs(dx) / 800));
    if (tg && tg.page) {  // 泡泡也往目标那一页挪 (按滑动的比例)
      var bs = tbButtons(), a = bs[swIndex()], b = bs.filter(function (x) { return x.dataset.page === tg.page; })[0];
      if (a && b) { var f = Math.min(1, Math.abs(dx) / (window.innerWidth * 0.5)); tbPlace(a.offsetLeft + (b.offsetLeft - a.offsetLeft) * f, a.offsetWidth, { free: true, stretch: f * 0.26 * (1 - f) * 2 }); }
    }
  }
  document.addEventListener('touchend', function (e) {
    if (!SW) return;
    var s0 = SW; SW = null;
    if (s0.raf) cancelAnimationFrame(s0.raf);
    if (s0.lock !== 'x') return;
    var dx = s0.dx, fast = Math.abs(dx) / Math.max(1, e.timeStamp - s0.t) > 0.5, tg = swTarget(dx);
    main.classList.remove('sw-drag');
    if (tg && (Math.abs(dx) > window.innerWidth * 0.28 || (fast && Math.abs(dx) > 40))) {
      // 顺着手指的方向继续滑出去，再换页 (不会先弹回原位再跳)
      if (tg.back) go(S.page, null, { swipe: true, dir: -1 }); else go(tg.page, null, { swipe: true, dir: dx < 0 ? 1 : -1 });
    } else {
      main.classList.add('sw-back'); main.style.transform = ''; main.style.opacity = '';
      setTimeout(function () { main.classList.remove('sw-back'); }, 360);
      tabbar(true);
    }
  });
  document.addEventListener('touchcancel', function () { if (SW) { SW = null; main.classList.remove('sw-drag'); main.style.transform = ''; main.style.opacity = ''; tabbar(); } });
  // 换页动画 (手机)：旧页顺着方向滑出、淡出 (从手指放开的位置接着走)，看不见的那一瞬间换内容，新页从另一边滑进来 —— 一个连贯的动作。
  // dir 1 = 往左走 (下一页)，-1 = 往右走 (上一页)。只动 transform / opacity (合成层，不重新排版)
  var PG = { busy: false, t: 0 };
  function pageSwap(dir, apply) {
    if (!narrowUI() || calmUI() || !dir) { apply(); return; }
    clearTimeout(PG.t);
    var W = Math.min(window.innerWidth, 520), out = -dir * W * 0.32, inn = dir * W * 0.22;
    main.classList.remove('pg-in'); main.classList.add('pg-out');
    main.style.transform = 'translate3d(' + out.toFixed(0) + 'px,0,0)'; main.style.opacity = '0';
    PG.t = setTimeout(function () {
      apply();  // 这时旧页已经看不见：换内容、卷回顶部
      main.classList.remove('pg-out');
      main.style.transform = 'translate3d(' + inn.toFixed(0) + 'px,0,0)'; main.style.opacity = '0';
      void main.offsetWidth;
      main.classList.add('pg-in'); main.style.transform = ''; main.style.opacity = '';
      PG.t = setTimeout(function () { main.classList.remove('pg-in'); }, 340);
    }, 120);
  }
  function stdUrl() { return (D.report || '../') + '?ui=std'; }
  function render() {
    if (!D) return;
    keys(); tabbar(TB.sq); fsq(); EVREG = [];
    document.getElementById('prompt-arg').textContent = S.code ? 'quote ' + S.code : '--' + S.page;
    var fn = { cal: pageCal, sig: pageSig, watch: pageWatch, bt: pageBt, pool: pagePool, mkt: pageMkt, ann: pageAnn }[S.page] || pageSig;
    var focusId = document.activeElement && /^(grep|cb-q|cb-cq|sq)$/.test(document.activeElement.id) ? document.activeElement.id : null, focusGrep = !!focusId, pos = focusGrep ? document.activeElement.selectionStart : null;
    main.innerHTML = WIDGET ? pageWidget() : S.code ? pageQuote(S.code) : fn();
    if ((S.page === 'bt' || S.page === 'pool') && !S.code) cbPlace();
    if (S.page === 'pool' && !S.code) pdScroll();
    document.body.classList.toggle('cbp-open', !!(CB.pop && (S.page === 'bt' || S.page === 'pool') && !S.code));  // 编辑框打开时收起底部浮动搜索
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
    if (pageChanged) CB.pop = null;
    S.page = page || S.page; S.code = code || null;
    var h = S.code ? '#q-' + S.code : '#' + S.page;
    if (location.hash !== h) history.replaceState(null, '', h);
    var apply = function () { render(); if (window.scrollY) window.scrollTo(0, 0); };
    if (pageChanged) { if (!(opt && opt.tbDone)) tabbar(true); pageSwap(dir, apply); } else apply();  // 先让导航栏的泡泡动起来，再换页
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
    if (CB.pop && (S.page === 'bt' || S.page === 'pool') && !e.target.closest('#cbf')) { CB.pop = null; CB.tnote = ''; render(); }  // 点编辑框外面：先收起，这一下照常生效 (例如点账号按钮)
    var cbt = e.target.closest('[data-cb]'); if (cbt) { cbClick(cbt); return; }
    var thb = e.target.closest('[data-th]'); if (thb) { themeClick(thb); return; }
    var ai = e.target.closest('[data-ai]'); if (ai) { aiClick(ai); return; }
    var ac = e.target.closest('[data-acct]'); if (ac) { acctClick(ac); return; }
    if (e.target.closest('.ai-stk') && window.innerWidth < 780) AI.open = false;  // 手机上点 AI 回答里的股票：关掉面板去看个股页
    var ct = e.target.closest('[data-calg],[data-calw],[data-calm],[data-cald]'); if (ct) { calClick(ct); return; }
    if (e.target.closest('[data-candle]')) { toggleCandle(); return; }
    if (e.target.closest('[data-levels]')) { toggleLevels(); return; }
    var edb = e.target.closest('[data-ed]'); if (edb) { edOpen(edb.dataset.ed, edb.dataset.code, edb.dataset.ev != null ? EVREG[+edb.dataset.ev] : null); return; }
    var edx = e.target.closest('[data-edx]'); if (edx) { edClick(edx); return; }
    if (e.target.closest('[data-ipo]')) { S.ipoAll = !S.ipoAll; render(); return; }
    var qt = e.target.closest('[data-qt]'); if (qt) { S.qtab = qt.dataset.qt; render(); var bar = document.querySelector('.qtabs'); if (bar && bar.getBoundingClientRect().top < 0) bar.scrollIntoView(); return; }
    if (e.target.closest('[data-amore]')) { S.alim = (S.alim || 40) + 40; render(); return; }
    var hbx = e.target.closest('[data-hb]'); if (hbx) { S.hb = S.hb === hbx.dataset.hb ? null : hbx.dataset.hb; render(); return; }
    var t = e.target.closest('[data-page],[data-q],[data-back],[data-flt],[data-sort],[data-more],[data-cat],[data-heat]');
    if (!t) return;
    if (t.dataset.page) go(t.dataset.page);
    else if (t.dataset.q) { if (t.classList.contains('sq-r')) sqClear(); go(S.page, t.dataset.q); }
    else if (t.dataset.back) go(S.page);
    else if (t.dataset.flt) { S.flt[t.dataset.flt] = !S.flt[t.dataset.flt]; S.limit = 50; render(); }
    else if (t.dataset.sort) setSort(t.dataset.sort);
    else if (t.dataset.more) { S.limit += 50; render(); }
    else if (t.dataset.cat) { S.cat = t.dataset.cat; render(); }
    else if (t.dataset.heat) { S.heat = +t.dataset.heat; S.hb = null; render(); }
  });
  document.addEventListener('toggle', function (e) { var d = e.target; if (d.classList && d.classList.contains('info')) OPEN[d.dataset.code] = d.open; if (d.dataset && d.dataset.sv) { S.svOpen = d.open ? d.dataset.sv : S.svOpen === d.dataset.sv ? null : S.svOpen; if (d.open) svLoad(d.dataset.sv); } }, true);
  document.addEventListener('change', function (e) {
    var el = e.target, d = el.dataset || {};
    if (d.pdsel) { if (el.value) pdPick(el.value); return; }
    if (d.cbk === 'slots') { var sl = Math.round(+el.value); if (sl >= 1) CB.slots = Math.min(50, sl); cbSave(); render(); cbRe(); return; }
    if (d.cbk === 'size') { var sz = parseV(el.value); if (isFinite(sz) && sz >= 1000) CB.size = Math.min(1e7, Math.round(sz)); cbSave(); render(); cbRe(); return; }
    if (d.cbc) {  // 条件编辑框：「c3:栏位」进场 /「e1:栏位」出场
      var pr = d.cbc.split(':'), n = parseFloat(el.value);
      var L = pr[0][0], arr = L === 'e' ? CB.exits : L === 'p' ? PC : CB.conds, ci = +pr[0].slice(1), q = arr[ci], path = pr[1], val = el.value, norm = L === 'e' ? xCond : cbCond;
      if (!q || q.t === 'ema50') return;
      q = JSON.parse(JSON.stringify(q));
      if (XS[q.t]) { if (isFinite(n)) q[path] = n; }
      else if (path === 'l.k') {  // 换左边的指标：一定留在左边
        var dd = IND[val] && IND[val].d;
        if (dd && !dd.l && (dd.v != null || dd.r)) q = L === 'e' ? xNew(val) : cbNew(val);  // 有常用写法 (RSI < 30、MACD 上穿信号线…)：用它
        else { q.l = { k: val }; if (!q.r && OPS[q.op][3] === 'rv') q.r = { k: val === 'close' ? 'ema' : 'close' }; }  // 均线等：保留原来的比较，右边是数值就改成跟收盘价比
      }
      else if (path === 'r.k') q.r = { k: val };
      else if (path === 'op') { if (OPS[val][3] === 'range' && OPS[q.op][3] !== 'range') { q.v2 = nn(q.v) ? q.v * 2 || 10 : 10; } q.op = val; }
      else if (/^[lr]\.p\.\d+$/.test(path)) { var pv = parseFloat(val); if (isFinite(pv)) q[path[0]].p[+path.split('.')[2]] = pv; }
      else if (/^[lr]\.o$/.test(path)) q[path[0]].o = val;
      else if (path === 'v' || path === 'v2') { var xv = parseV(val); if (isFinite(xv)) q[path] = xv; }
      else if (path === 'w' || path === 'd') { if (isFinite(n)) q[path] = n; }
      else if (path === 'bool') { q.op = val === '1' ? 'gt' : 'lt'; }
      arr[ci] = norm(q) || arr[ci];
      if (L === 'p') { pcSave(); S.limit = 50; render(); return; }
      cbSave(); render(); cbRe();
    }
    else if (el.id === 'cb-from' || el.id === 'cb-to') { CB[el.id === 'cb-from' ? 'from' : 'to'] = el.value; cbSave(); render(); cbRe(); }
  });
  // 点浮动搜索框外面：收起结果 (文字留着，再点输入框就回来)
  document.addEventListener('pointerdown', function (e) { var el = document.getElementById('fsq'); if (el && !el.hidden && !(e.target.closest && e.target.closest('#fsq'))) el.classList.add('shut'); });
  document.addEventListener('focusin', function (e) { if (e.target.id === 'sq') { var el = document.getElementById('fsq'); if (el) el.classList.remove('shut'); } });
  // 搜索框打字时只换下面的列表 / 建议，不重画整页：重画会换掉输入框，iPhone 键盘就从数字跳回字母
  document.addEventListener('input', function (e) {
    var id = e.target.id, box;
    if (id === 'cb-cq') { CB.cq = e.target.value; if ((box = document.getElementById('cb-clist'))) box.innerHTML = cbList(CB.pop === 'xadd' ? 'e' : CB.pop === 'padd' ? 'p' : 'c'); }
    else if (id === 'cb-q') { CB.q = e.target.value; if ((box = document.getElementById('cb-sug'))) box.innerHTML = cbSug(); }
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
    if (e.key === 'Enter' && e.target.id === 'sq') { e.preventDefault(); var h0 = sqHits(S.sq)[0]; if (h0) { sqClear(); go(S.page, h0); } return; }
    if (e.key === 'Enter' && e.target.id === 'tpl-name') { e.preventDefault(); tplClick('tsave'); return; }
    if (e.key === 'Enter' && e.target.id === 'wf-name') { e.preventDefault(); wSubmit(); render(); return; }
    if (e.key === 'Enter' && !e.shiftKey && e.target.id === 'ai-q') { e.preventDefault(); aiAsk(e.target.value); return; }
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && AI.open && e.target.closest && e.target.closest('.ai-mrow')) {  // 模型那一排：← → 换模型
      e.preventDefault(); modelStep(e.key === 'ArrowLeft' ? -1 : 1); aiRender();
      var on = document.querySelector('#ai-panel .ai-models [aria-checked="true"]'); if (on) on.focus({ preventScroll: true }); return;
    }
    if (e.key === 'Escape' && CB.pop && (S.page === 'bt' || S.page === 'pool')) { CB.pop = null; render(); return; }
    if (e.key === 'Escape' && AI.open) { AI.open = false; aiRender(); return; }
    if (e.key === 'Escape' && SY.open) { SY.open = false; acctRender(); return; }
    if (e.key === 'Escape' && e.target.id === 'sq') { var fe = document.getElementById('fsq'); if (fe) fe.classList.add('shut'); e.target.blur(); return; }
    if (e.key === 'Escape') { if (typing) e.target.blur(); if (S.code) go(S.page); return; }
    if (typing) return;
    var n = parseInt(e.key, 10);
    if (n >= 1 && n <= PAGES.length) { go(PAGES[n - 1][0]); e.preventDefault(); return; }
    if (e.key === 'q' && S.code) { go(S.page); return; }
    if (e.key === '/') { e.preventDefault(); var sq = document.getElementById('sq'); if (sq) { var fe = document.getElementById('fsq'); if (fe) fe.classList.remove('shut'); sq.focus(); } return; }
    if (e.key === 't') { toggleTheme(); return; }
    if (e.key === 'k') { toggleCandle(); return; }
    if (S.page === 'pool' && !S.code) {
      var f = FLT.filter(function (x) { return x[0] === e.key; })[0], s = SORT.filter(function (x) { return x[0] === e.key; })[0];
      if (f) { S.flt[f[1]] = !S.flt[f[1]]; S.limit = 50; render(); } else if (PQ.some(function (x) { return x[0] === e.key; })) pqToggle(e.key); else if (s) setSort(s[1]); else if (e.key === 'a') { S.flt = {}; PC = []; pcSave(); render(); }
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
    syncSoon();
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

  // ---------- 👤 账号 (用 Google 登录) + 跨设备同步 ----------
  // account.json (手写、公开，跟页面放在一起)：google_client_id + worker 网址，两个都有才显示右上角的「登录」。
  // 登录后，观察列表、主题、语言、K 线样式、🎨 自定义主题、自定义回测的设定在各设备之间同步 (Worker → Cloudflare KV)。
  // AI 密钥、通行码 (bterm_ai) 和登录凭证本身永远不会放进同步的资料。
  // 合并 = 三方合并 (上次同步的版本、这台设备、云端)：两边各自新增 / 删除的股票都保留；同一个设定两边都改了，以这台设备为准。
  var ACCT = null;  // account.json
  var ACC = (function () { try { var a = JSON.parse(localStorage.getItem('bterm_acct') || 'null'); return a && a.token && a.email ? a : null; } catch (e) { return null; } })();
  var SY = { open: false, busy: false, again: false, t: null, err: '', note: '', applying: false, lang: '', info: false };
  var GIS = { p: null, init: false };
  function accSave() { try { if (ACC) localStorage.setItem('bterm_acct', JSON.stringify(ACC)); else localStorage.removeItem('bterm_acct'); } catch (e) {} }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function canon(o) {  // 比较用：物件的 key 排好顺序再转成文字
    return JSON.stringify(o == null ? null : o, function (k, v) { return v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v).sort().reduce(function (a, x) { a[x] = v[x]; return a; }, {}) : v; });
  }
  function same(a, b) { return canon(a) === canon(b); }
  function syncLocal() {  // 这台设备要同步的资料
    var p = {}, v, th = themeSaved(), cbt = null;
    if ((v = lsGet('bterm_theme')) === 'dark' || v === 'light') p.theme = v;
    if ((v = lsGet('bursa_lang')) === 'zh' || v === 'en') p.lang = v;
    if ((v = lsGet('bterm_candle')) === 'solid' || v === 'hollow') p.candle = v;
    if ((v = lsGet('bterm_btmode')) === 'ledger' || v === 'custom') p.btmode = v;
    try { cbt = JSON.parse(lsGet('bterm_cbt') || 'null'); } catch (e) { cbt = null; }
    return { v: 1, watch: { folders: W.folders.map(function (f) { return { id: f.id, name: f.name, codes: f.codes.slice() }; }), cur: W.cur },
      prefs: p, theme: th && th.t ? { on: th.on !== false, t: th.t } : null, cbt: cbt && typeof cbt === 'object' && !Array.isArray(cbt) ? cbt : null, tpl: tplOn() ? TPL : undefined,
      pool: { conds: JSON.parse(JSON.stringify(PC)), saved: JSON.parse(JSON.stringify(PSV)) } };
  }
  function mergeWatch(b, l, r, first) {
    if (!r || !r.folders || !r.folders.length) return l;
    if (!l || !l.folders || !l.folders.length) return r;
    var idx = function (w) { var m = {}; ((w && w.folders) || []).forEach(function (f) { m[f.id] = f; }); return m; };
    var B = idx(b), L = idx(l), seen = {}, out = [];
    r.folders.forEach(function (rf) {
      var lf = L[rf.id], bf = B[rf.id];
      if (!lf) { if (!bf) out.push({ id: rf.id, name: rf.name, codes: rf.codes.slice() }); return; }  // 别的设备新增的留着；这台设备删掉的就不要
      var bc = bf ? bf.codes : [];
      var codes = rf.codes.filter(function (c) { return !(bc.indexOf(c) >= 0 && lf.codes.indexOf(c) < 0); });  // 这台设备删掉的股票
      lf.codes.forEach(function (c) { if (bc.indexOf(c) < 0 && codes.indexOf(c) < 0) codes.push(c); });         // 这台设备新增的股票
      out.push({ id: rf.id, name: bf && lf.name !== bf.name ? lf.name : rf.name, codes: codes }); seen[rf.id] = 1;
    });
    l.folders.forEach(function (lf) {  // 这台设备新增的列表 (上次同步时还没有)；上次有、云端现在没有 = 别的设备删掉了
      if (seen[lf.id] || B[lf.id] || (first && !lf.codes.length)) return;
      out.push({ id: lf.id, name: lf.name, codes: lf.codes.slice() });
    });
    if (!out.length) return l;
    var has = function (id) { return out.some(function (f) { return f.id === id; }); };
    return { folders: out, cur: has(l.cur) ? l.cur : has(r.cur) ? r.cur : out[0].id };
  }
  function mergeSaved(b, l, r) {  // 储存的股票池结果：两边新增的都留，任何一边删掉的就删 (b = 上次同步的版本)
    var ids = function (a) { var m = {}; (a || []).forEach(function (x) { if (x && x.id) m[x.id] = x; }); return m; };
    var B = ids(b), L = ids(l), R = ids(r), out = [];
    Object.keys(L).concat(Object.keys(R)).forEach(function (id) {
      if (out.some(function (x) { return x.id === id; })) return;
      if (b && B[id] && (!L[id] || !R[id])) return;
      out.push(L[id] || R[id]);
    });
    return psvTrim(out.sort(function (x, y) { return (y.at || '') < (x.at || '') ? -1 : (y.at || '') > (x.at || '') ? 1 : 0; }));
  }
  if (window.BTERM_TEST) window.BTERM_TEST.sync = { merge3: function (b, l, r) { return merge3(b, l, r); }, local: function () { return syncLocal(); }, apply: function (d) { applyDoc(d); } };  // 只给自动测试用
  function merge3(b, l, r) {  // b = null：这台设备第一次同步 → 观察列表取联集，设定以云端为准
    var first = !b, out = { v: 1, prefs: {}, watch: null, theme: null, cbt: null };
    b = b || {};
    var pick = function (lv, rv, bv) { return first ? (rv != null ? rv : lv) : !same(lv, bv) ? lv : rv; };
    var lp = l.prefs || {}, rp = r.prefs || {}, bp = b.prefs || {};
    ['theme', 'lang', 'candle', 'btmode'].forEach(function (k) { var v = pick(lp[k], rp[k], bp[k]); if (v != null) out.prefs[k] = v; });
    var nt = function (x) { return x && x.t ? { on: x.on !== false, t: themeClean(x.t) || x.t } : null; };  // 主题先整理成同一个格式再比较
    out.theme = pick(nt(l.theme), nt(r.theme), nt(b.theme)) || null;
    out.cbt = pick(l.cbt, r.cbt, b.cbt) || null;
    if (l.tpl || r.tpl) out.tpl = pick(l.tpl, r.tpl, b.tpl) || [];
    var lpo = l.pool || {}, rpo = r.pool || {}, bpo = b.pool || {};
    if (l.pool || r.pool) out.pool = { conds: pick(lpo.conds, rpo.conds, bpo.conds) || [], saved: mergeSaved(first ? null : bpo.saved, lpo.saved, rpo.saved) };
    out.watch = mergeWatch(first ? null : b.watch, l.watch, r.watch, first);
    return out;
  }
  function applyDoc(d) {  // 把合并好的版本套用到这台设备
    var redraw = false, p = d.prefs || {}, root = document.documentElement;
    var w = d.watch && Array.isArray(d.watch.folders) ? d.watch.folders.filter(function (f) { return f && f.id && Array.isArray(f.codes); }) : [];
    if (w.length && !same({ folders: W.folders, cur: W.cur }, d.watch)) {
      W = { folders: w.map(function (f) { return { id: String(f.id), name: String(f.name || '').slice(0, 40), codes: f.codes.map(String).filter(function (c) { return /^[0-9A-Z]{3,8}$/.test(c); }) }; }), cur: d.watch.cur };
      if (!W.folders.some(function (f) { return f.id === W.cur; })) W.cur = W.folders[0].id;
      saveW(); redraw = true;
    }
    if (p.theme) { lsSet('bterm_theme', p.theme); if (root.dataset.theme !== p.theme) root.dataset.theme = p.theme; }
    if (p.lang) lsSet('bursa_lang', p.lang);
    SY.lang = p.lang && p.lang !== LANG ? p.lang : '';
    if (p.candle) { if (p.candle !== CANDLE) { CANDLE = p.candle; redraw = true; } lsSet('bterm_candle', p.candle); }
    if (p.btmode) { if (p.btmode !== S.bt) { S.bt = p.btmode; redraw = true; } lsSet('bterm_btmode', p.btmode); }
    var sv = themeSaved(), mine = sv && sv.t ? { on: sv.on !== false, t: sv.t } : null;
    if (!same(mine, d.theme)) {
      var t = d.theme && themeClean(d.theme.t);
      if (!d.theme) { themeStore(null); themeApply(null); } else if (t) { themeStore(t, d.theme.on); themeApply(d.theme.on !== false ? t : null); }
      TH.preview = null; redraw = true;
    }
    var cb0 = null; try { cb0 = JSON.parse(lsGet('bterm_cbt') || 'null'); } catch (e) { cb0 = null; }
    if (d.cbt && !same(cb0, d.cbt)) {
      ['codes', 'from', 'to', 'uni', 'slots', 'size', 'rank', 'sz', 'runs', 'minpx'].forEach(function (k) { if (d.cbt[k] !== undefined) CB[k] = d.cbt[k]; });
      if (!Array.isArray(CB.codes)) CB.codes = [];
      CB.conds = cbConds(d.cbt); CB.exits = cbExits(d.cbt); CB.pop = null;
      CB.res = null; cbSave(); redraw = true;
    }
    if (d.pool && typeof d.pool === 'object') {
      var pc2 = Array.isArray(d.pool.conds) ? d.pool.conds.map(cbCond).filter(function (q) { return q && !q.t; }).slice(0, 15) : PC;
      if (!same(pc2, PC)) { PC = pc2; lsSet('bterm_pool', JSON.stringify({ conds: PC })); redraw = true; }
      var sv2 = Array.isArray(d.pool.saved) ? d.pool.saved.filter(function (r) { return r && r.id && Array.isArray(r.s); }) : PSV;
      if (!same(sv2, PSV)) { PSV = psvTrim(sv2); lsSet('bterm_psaved', JSON.stringify(PSV)); redraw = true; }
    }
    if (Array.isArray(d.tpl) && tplOn() && !same(TPL, d.tpl)) { TPL = d.tpl; try { localStorage.setItem('bterm_tpl', JSON.stringify(TPL)); } catch (e) {} redraw = true; }
    if (redraw && D) render();
  }
  function accApi(path, body) {
    var h = { 'Content-Type': 'application/json' };
    if (ACC && ACC.token) h.Authorization = 'Bearer ' + ACC.token;
    return fetch(ACCT.worker.replace(/\/+$/, '') + path, { method: 'POST', headers: h, body: JSON.stringify(body || {}) }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error((j && j.error) || 'HTTP ' + r.status); e.status = r.status; e.body = j || {}; throw e; }
        return j;
      });
    });
  }
  function accInfo(j) {
    if (!ACC || !j) return;
    ['plan', 'until', 'limits'].forEach(function (k) { if (j[k] !== undefined) ACC[k] = j[k]; });
    if (j.plan !== undefined) { ACC.owner = !!j.owner; ACC.pay = j.pay || null; ACC.stripe = !!j.stripe; }  // 管理员 / 能不能在线付款 / 有没有 Stripe 订阅
  }
  function syncSoon(ms) {
    if (!SY || !ACC || !ACCT || SY.applying || WIDGET) return;
    clearTimeout(SY.t); SY.t = setTimeout(syncRun, ms == null ? 2500 : ms);
  }
  function syncRun() {
    if (!ACC || !ACCT) return Promise.resolve();
    if (SY.busy) { SY.again = true; return Promise.resolve(); }
    clearTimeout(SY.t); SY.t = null; SY.busy = true; SY.err = ''; acctRender();  // 提示 (例如「付款成功」) 留着，关面板再打开才清掉
    var who = ACC.token;
    function step(r, n) {
      if (!ACC || ACC.token !== who) return null;  // 同步途中登出了
      accInfo(r);
      var lim = r.limits, pl = ACC.plim;  // 升级 (上限变大) 之前被截掉的股票，现在送上去
      var grown = ACC.trimmed && lim && pl && (lim.folders > pl.folders || lim.stocks > pl.stocks);
      var mine = syncLocal(), changed = !ACC.synced || canon(mine) !== ACC.sent || grown;
      if (r.rev !== ACC.rev || !ACC.synced) {  // 云端有新版本 (或这台设备第一次同步)：合并后套用
        if (r.data) { SY.applying = true; try { applyDoc(merge3(ACC.synced ? ACC.base : null, mine, r.data)); } finally { SY.applying = false; } }
        ACC.rev = r.rev; ACC.base = r.data || null;
      }
      var now = syncLocal(), s = canon(now);
      if (!changed) { ACC.sent = s; return null; }  // 这台设备没改过：云端的版本已经套用，不用再送回去
      return accApi('/sync/push', { rev: r.rev, data: now }).then(function (p) {
        if (!ACC || ACC.token !== who) return;
        accInfo(p); ACC.rev = p.rev; ACC.base = p.data; ACC.sent = s; ACC.synced = true; ACC.trimmed = !!p.trimmed; ACC.plim = p.limits || null;
      }, function (e) {
        if (e.status === 409 && n < 3 && e.body && typeof e.body.rev === 'number') return step(e.body, n + 1);  // 别的设备刚存了：再合并一次
        throw e;
      });
    }
    return accApi('/sync/pull').then(function (r) { return step(r, 0); }).then(function () {
      if (ACC && ACC.token === who) { ACC.at = Date.now(); accSave(); }
    }, function (e) {
      if (!ACC || ACC.token !== who) return;
      if (e.status === 401) { accOut(); SY.err = Z('登录已过期，请重新登录。', 'Your sign-in has expired. Please sign in again.'); return; }
      SY.err = e.status ? e.message : Z('连不上同步服务器', 'Cannot reach the sync server'); accSave();
    }).then(function () {
      SY.busy = false; acctRender();
      if (SY.again) { SY.again = false; syncSoon(400); }
    });
  }
  function accOut() {
    ACC = null; accSave(); clearTimeout(SY.t); SY.t = null; SY.lang = '';
    try { if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect(); } catch (e) {}
    if (D && S.page === 'watch' && !S.code) render();
  }
  // 登出 = 这个账号的观察列表离开这台设备 (云端还在，再登录就回来)。先把没送上去的修改送上去；
  // 还有只在这台设备的股票 (超出免费版上限 / 同步失败) 就先问。登录过期 (401) 不算登出，列表留着等重新登录合并。
  function signOut() {
    if (!ACC || SY.busy) return;
    var pending = function () { return !ACC || !ACC.synced || canon(syncLocal()) !== ACC.sent; };
    var fin = function () {
      if ((pending() || (ACC && ACC.trimmed)) && !window.confirm(Z('部分观察列表没有存到云端 (超出免费版上限或同步失败)，登出后会从这台设备删除。仍然登出？',
        'Some watchlist items are not saved to the cloud (over the free limit or not synced) and will be removed from this device. Sign out anyway?'))) { acctRender(); return; }
      accOut(); watchReset(); TPL = []; CB.tpl = null; PSV = []; try { localStorage.removeItem('bterm_tpl'); localStorage.removeItem('bterm_psaved'); } catch (e) {} SY.err = ''; SY.note = Z('已登出', 'Signed out'); acctRender(); if (D) render();
    };
    if (pending()) syncRun().then(fin); else fin();
  }
  function watchReset() {
    W = { folders: [{ id: 'f1', name: T('默认'), codes: [] }], cur: 'f1' }; WQ = '';
    try { localStorage.setItem('bterm_watch', JSON.stringify(W)); } catch (e) {}
  }
  function onCred(resp) {
    if (!resp || !resp.credential) return;
    SY.busy = true; SY.err = ''; SY.note = ''; acctRender();
    accApi('/auth/login', { credential: resp.credential }).then(function (j) {
      ACC = { token: j.token, email: j.email, name: j.name || '', plan: j.plan, until: j.until || null, limits: j.limits, exp: Date.now() + (j.days || 30) * 864e5,
        rev: 0, base: null, sent: null, synced: false, trimmed: false };
      accSave(); SY.busy = false;
      if (D && S.page === 'watch' && !S.code) render();
      return syncRun();
    }).catch(function (e) { SY.busy = false; SY.err = Z('登录失败：', 'Sign-in failed: ') + e.message; acctRender(); });
  }
  function gisLoad() {
    if (window.google && google.accounts && google.accounts.id) return Promise.resolve();
    if (!GIS.p) GIS.p = new Promise(function (ok, no) {
      var s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
      s.onload = function () { ok(); }; s.onerror = function () { GIS.p = null; no(new Error(Z('Google 登录载入失败，请检查网络后再试。', 'Could not load Google sign-in. Check your connection and try again.'))); };
      document.head.appendChild(s);
    });
    return GIS.p;
  }
  function gisButton() {
    var el = document.getElementById('g-btn'); if (!el) return;
    gisLoad().then(function () {
      if (!GIS.init) { google.accounts.id.initialize({ client_id: ACCT.client_id || ACCT.google_client_id, callback: onCred, auto_select: false, cancel_on_tap_outside: true, ux_mode: 'popup', itp_support: true }); GIS.init = true; }
      el = document.getElementById('g-btn'); if (!el || el.childNodes.length) return;
      var bg = getComputedStyle(document.body).backgroundColor.match(/\d+/g) || [0, 0, 0];
      google.accounts.id.renderButton(el, { type: 'standard', theme: (+bg[0] + +bg[1] + +bg[2]) / 3 < 128 ? 'filled_black' : 'outline', size: 'large', text: 'signin_with', shape: 'pill',
        logo_alignment: 'left', locale: LANG === 'en' ? 'en' : 'zh_CN', width: Math.max(200, Math.min(320, el.clientWidth || 280)) });
    }, function (e) { el = document.getElementById('g-btn'); if (el) el.innerHTML = '<p class="dn">' + esc(e.message) + '</p>'; });
  }
  var INFO = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="10.9" y="10.4" width="2.2" height="6.8" rx="1.1"/><circle cx="12" cy="7.4" r="1.35"/></svg>';
  var PERSON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm0 2c-4.4 0-8 2.3-8 5.2V21h16v-1.8c0-2.9-3.6-5.2-8-5.2Z"/></svg>';
  function acctRender() {
    var btn = document.getElementById('acct-btn'), box = document.getElementById('acct-panel'), u = document.querySelector('.prompt .u');
    if (!btn || !box) return;
    if (u) u.textContent = (ACC ? (ACC.email.split('@')[0] || 'user').slice(0, 18) : 'user') + '@bursa';
    btn.hidden = !ACCT; box.hidden = !ACCT || !SY.open; btn.setAttribute('aria-expanded', String(!box.hidden));
    if (!ACCT) return;
    var st = SY.busy ? 'busy' : SY.err ? 'err' : ACC && ACC.at ? 'ok' : '';
    btn.dataset.st = ACC ? st : ''; btn.classList.toggle('on', !!ACC);
    btn.title = ACC ? ACC.email + ' · ' + (st === 'ok' ? Z('已同步', 'Synced') : st === 'busy' ? Z('同步中…', 'Syncing…') : st === 'err' ? Z('同步失败', 'Sync failed') : '') : Z('登录以同步观察列表和设定', 'Sign in to sync your watchlists and settings');
    btn.innerHTML = ACC ? '<span class="av" aria-hidden="true">' + esc((ACC.name || ACC.email).charAt(0).toUpperCase()) + '</span><span class="dot" aria-hidden="true"></span><span class="sr-only">' + esc(btn.title) + '</span>'
      : PERSON + '<span>' + Z('登录', 'Sign in') + '</span>';
    if (box.hidden) return;
    var r = btn.getBoundingClientRect();
    box.style.top = Math.round(r.bottom + 8) + 'px';
    box.style.maxHeight = Math.max(220, Math.round(window.innerHeight - r.bottom - 8 - (window.innerWidth < 780 ? 96 : 16))) + 'px';  // 不压到手机底部导航栏
    if (window.innerWidth >= 780) { box.style.left = 'auto'; box.style.right = Math.max(8, Math.round(window.innerWidth - r.right)) + 'px'; } else { box.style.left = ''; box.style.right = ''; }
    var num = function (o, d) { o = o || {}; return { folders: parseInt(o.folders, 10) || d.folders, stocks: parseInt(o.stocks, 10) || d.stocks }; };
    var plans = ACCT.plans || {}, fr = num(plans.free, { folders: 1, stocks: 30 }), pl = num(plans.plus, { folders: 5, stocks: 2000 });
    var nf = W.folders.length, ns = W.folders.reduce(function (n, f) { return n + f.codes.length; }, 0), legal = 'legal.html#' + (LANG === 'en' ? 'e14' : 'c14');
    var plus = !!ACC && ACC.plan === 'plus', lim = ACC ? num(ACC.limits, plus ? pl : fr) : fr;
    var upLink = ACCT.upgrade && /^(https:|mailto:)/.test(ACCT.upgrade) ? ACCT.upgrade : '';
    var upg = upLink ? ' <a href="' + esc(upLink) + '" target="_blank" rel="noopener">' + Z('升级 Plus ↗', 'Upgrade to Plus ↗') + '</a>' : '';
    var price = (plans.plus && plans.plus.price) || {}, pm = price.month || 'RM9.90', py = price.year || 'RM99';
    var h = '<div class="ai-top"><span class="ai-logo" aria-hidden="true">' + PERSON + '</span><b>' + Z('账号 · 跨设备同步', 'Account · Sync') + '</b><span class="ai-ctx"></span>' +
      '<button type="button" class="acct-i" data-acct="info" aria-expanded="' + SY.info + '" aria-controls="acct-plans" title="' + Z('免费版 / Plus 包含哪些功能', 'What the Free and Plus plans include') + '" aria-label="' + Z('免费版 / Plus 包含哪些功能', 'What the Free and Plus plans include') + '">' + INFO + '</button>' +
      '<button type="button" data-acct="close" aria-label="' + Z('关闭', 'Close') + '">×</button></div>';
    if (SY.info) {  // ⓘ：免费版 / Plus 各包含哪些同步功能 (登录后标出自己的方案)
      var col = function (plan) { return ACC && (plan === 'plus') === plus ? ' class="mine"' : ''; }, yes = '<span class="y" aria-label="' + Z('有', 'Included') + '">✓</span>';
      var cap = function (p) { return Z(esc(p.folders) + ' 个列表<br>' + esc(p.stocks.toLocaleString()) + ' 只股票', esc(p.folders) + ' lists<br>' + esc(p.stocks.toLocaleString()) + ' stocks'); };
      var row = function (name, a, b) { return '<tr><th scope="row">' + name + '</th><td' + col('free') + '>' + a + '</td><td' + col('plus') + '>' + b + '</td></tr>'; };
      h += '<div class="acct-plans" id="acct-plans"><table><thead><tr><th scope="col"><span class="sr-only">' + Z('功能', 'Feature') + '</span></th>' +
        '<th scope="col"' + col('free') + '>' + Z('免费版', 'Free') + (ACC && !plus ? '<small>' + Z('你的方案', 'Your plan') + '</small>' : '') + '</th>' +
        '<th scope="col"' + col('plus') + '>Plus' + (plus ? '<small>' + Z('你的方案', 'Your plan') + '</small>' : '') + '</th></tr></thead><tbody>' +
        row(Z('观察列表同步', 'Watchlist sync'), cap(ACC && !plus ? lim : fr), cap(ACC && plus ? lim : pl)) +  // 自己的方案显示 Worker 实际的上限
        row(Z('深色 / 浅色、语言、K 线样式', 'Dark / light, language, candle style'), yes, yes) +
        row(Z('🎨 自定义主题', '🎨 Custom theme'), yes, yes) +
        row(Z('自定义回测设定', 'Custom backtest settings'), yes, yes) +
        (ACC && ACC.pay ? row(Z('价格', 'Price'), Z('免费', 'Free'), esc(pm) + Z(' / 月', ' / month') + '<br>' + esc(py) + Z(' / 年', ' / year')) : '') +
        '</tbody></table>' + (ACC && !plus && upg ? '<p class="dim">' + upg + '</p>' : '') + '</div>';
    }
    h += '<div class="acct-body">';
    if (!ACC) {
      h += '<p>' + Z('在所有设备同步观察列表与设定。', 'Sync your watchlists and settings across devices.') + '</p>' +
        '<div id="g-btn" class="g-btn">' + (SY.busy ? '<span class="ai-dots"><i></i><i></i><i></i></span>' : '') + '</div>' +
        (SY.err ? '<p class="dn">' + esc(SY.err) + '</p>' : '') + (SY.note ? '<p class="up">' + esc(SY.note) + '</p>' : '') +
        '<p class="dim">' + Z('登录即表示同意<a href="' + legal + '">使用条款</a>', 'By signing in you agree to the <a href="' + legal + '">Terms</a>') + '</p>';
    } else {
      var over = !plus && (nf > lim.folders || ns > lim.stocks);
      var when = ACC.at ? new Date(ACC.at) : null, hm = when ? ('0' + when.getHours()).slice(-2) + ':' + ('0' + when.getMinutes()).slice(-2) : '';
      var use = plus ? Z(nf + ' 个列表 · ' + ns + ' 只', nf + ' lists · ' + ns + ' stocks') : Z(nf + '/' + lim.folders + ' 个列表 · ' + ns + '/' + lim.stocks + ' 只', nf + '/' + lim.folders + ' lists · ' + ns + '/' + lim.stocks + ' stocks');
      h += '<div class="acct-me"><span class="av big" aria-hidden="true">' + esc((ACC.name || ACC.email).charAt(0).toUpperCase()) + '</span><div><b>' + esc(ACC.email) + '</b>' +
        '<p><span class="plan' + (plus ? ' plus' : '') + '">' + (plus ? 'Plus' : Z('免费版', 'Free')) + '</span>' + (plus && ACC.until ? ' <span class="dim">' + Z('到期 ', 'until ') + esc(ACC.until) + '</span>' : '') + '</p></div></div>' +
        '<p class="acct-st ' + st + '"><span>' + (st === 'busy' ? Z('同步中…', 'Syncing…') : st === 'err' ? '⚠ ' + esc(SY.err) : st === 'ok' ? Z('✓ 已同步 · ', '✓ Synced · ') + hm : Z('还没同步', 'Not synced yet')) + '</span>' +
        '<span class="acct-use' + (over ? ' warn' : '') + '">' + esc(use) + '</span></p>' +
        (over || ACC.trimmed ? '<p class="warn">' + Z('超出免费版上限的部分仅存于本设备', 'Items over the free limit stay on this device') + '</p>' : '') +
        (!plus && ACC.pay ? '<div class="acct-up"><b>' + Z('升级 Plus', 'Upgrade to Plus') + '</b><div class="opts acct-act">' +
          (ACC.pay.month ? '<button type="button" class="ok" data-acct="buy" data-v="month"' + (SY.busy ? ' disabled' : '') + '>' + esc(pm) + Z(' / 月', ' / month') + '</button>' : '') +
          (ACC.pay.year ? '<button type="button" class="ok" data-acct="buy" data-v="year"' + (SY.busy ? ' disabled' : '') + '>' + esc(py) + Z(' / 年', ' / year') + '</button>' : '') + '</div>' +
          (upLink ? '<a class="dim" href="' + esc(upLink) + '" target="_blank" rel="noopener">' + Z('其他付款方式 ↗', 'Other ways to pay ↗') + '</a>' : '') + '</div>' : '') +
        (plus && ACC.stripe && ACC.pay ? '<p class="dim"><button type="button" class="more" data-acct="portal">' + Z('管理订阅 ↗', 'Manage subscription ↗') + '</button></p>' : '') +
        (SY.note ? '<p class="up">' + esc(SY.note) + '</p>' : '') +
        (SY.lang ? '<p class="dim">' + Z('语言已同步为 English', 'Language synced: 中文') + ' <button type="button" class="more" data-acct="lang">' + Z('现在切换', 'Switch now') + '</button></p>' : '') +
        '<div class="opts acct-act"><button type="button" class="ok" data-acct="sync"' + (SY.busy ? ' disabled' : '') + '>' + Z('立即同步', 'Sync now') + '</button>' +
        '<button type="button" data-acct="out">' + Z('登出', 'Sign out') + '</button><button type="button" class="danger" data-acct="del">' + Z('删除云端资料', 'Delete cloud data') + '</button>' +
        '</div>' + (ACC.owner && SY.admin ? adminView() : '') +
        '<p class="dim"><a href="' + legal + '">' + Z('隐私说明', 'Privacy') + '</a></p>';
    }
    var keep = {}; ['adm-email', 'adm-len', 'adm-date', 'adm-note'].forEach(function (id) { var el = document.getElementById(id); if (el) keep[id] = el.value; });  // 重画时保留管理员正在填的
    box.innerHTML = h + '</div>';
    Object.keys(keep).forEach(function (id) { var el = document.getElementById(id); if (el) el.value = keep[id]; });
    if (!ACC && !SY.busy) gisButton();
    if (ACC && ACC.owner && SY.admin && !ADM.items && !ADM.busy && !ADM.err) admLoad();  // 网址加 ?admin 才打开 (界面上没有入口)
  }
  // 👑 管理员：手动开通 / 延长 / 取消别人的 Plus (例如收到 DuitNow 转账后)
  var ADM = { items: null, busy: false, err: '', msg: '', extra: [] };
  function admLoad() {
    ADM.busy = true; ADM.err = ''; acctRender();
    return accApi('/admin/plus/list').then(function (j) { ADM.items = j.items || []; ADM.extra = (j.plusEmails || []).concat(j.owners || []); ADM.today = j.today; }, function (e) { ADM.err = e.message; })
      .then(function () { ADM.busy = false; acctRender(); });
  }
  function adminView() {
    var today = ADM.today || new Date().toISOString().slice(0, 10);
    var h = '<div class="acct-admin"><b>Plus</b>' +
      '<div class="adm-form"><input id="adm-email" type="email" inputmode="email" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Gmail">' +
      '<div class="adm-row"><select id="adm-len"><option value="1">' + Z('+1 个月', '+1 month') + '</option><option value="12">' + Z('+1 年', '+1 year') + '</option><option value="forever">' + Z('永久', 'Forever') + '</option></select>' +
      '<input id="adm-date" type="date" min="' + today + '" aria-label="' + Z('或指定到期日', 'Or pick an end date') + '" title="' + Z('或指定到期日 (填了就用这个)', 'Or pick an end date (used if set)') + '"></div>' +
      '<input id="adm-note" type="text" maxlength="80" autocomplete="off" placeholder="' + Z('备注', 'Note') + '">' +
      '<button type="button" class="ok" data-acct="adm-set"' + (ADM.busy ? ' disabled' : '') + '>' + Z('开通 / 延长', 'Grant / extend') + '</button></div>' +
      (ADM.err ? '<p class="dn">⚠ ' + esc(ADM.err) + '</p>' : '') + (ADM.msg ? '<p class="up">' + esc(ADM.msg) + '</p>' : '') +
      (ADM.busy && !ADM.items ? '<span class="ai-dots"><i></i><i></i><i></i></span>' : '');
    var items = ADM.items || [];
    h += items.length ? '<ul class="adm-list">' + items.map(function (x) {
      var live = x.until === 'forever' || x.until >= today;
      return '<li><div><b>' + esc(x.email) + '</b><span class="' + (live ? 'up' : 'dim') + '">' + (x.until === 'forever' ? Z('永久', 'forever') : esc(x.until)) + (live ? '' : Z(' (已过期)', ' (expired)')) + '</span>' +
        '<span class="dim">' + (x.src === 'stripe' ? 'Stripe' : Z('手动', 'manual')) + (x.note ? ' · ' + esc(x.note) : '') + '</span></div>' +
        '<button type="button" class="danger" data-acct="adm-del" data-v="' + esc(x.email) + '">' + Z('取消', 'Remove') + '</button></li>'; }).join('') + '</ul>'
      : ADM.items ? '<p class="dim">' + Z('暂无', 'None') + '</p>' : '';
    return h + '</div>';
  }
  function admUntil(email) {  // +1 个月 / +1 年：从现在的到期日 (还没过期的话) 往后加
    var d = (document.getElementById('adm-date') || {}).value, len = (document.getElementById('adm-len') || {}).value;
    if (d) return d;
    if (len === 'forever') return 'forever';
    var cur = (ADM.items || []).filter(function (x) { return x.email === email; })[0], today = ADM.today || new Date().toISOString().slice(0, 10);
    if (cur && cur.until === 'forever') return 'forever';
    var base = cur && cur.until > today ? cur.until : today, t = new Date(base + 'T00:00:00Z');
    t.setUTCMonth(t.getUTCMonth() + (parseInt(len, 10) || 1));
    return t.toISOString().slice(0, 10);
  }
  function payGo(path, body) {  // 去 Stripe 付款页 / 客户中心
    SY.busy = true; SY.err = ''; acctRender();
    accApi(path, Object.assign({ back: location.origin + location.pathname }, body || {})).then(function (j) { if (j && j.url) location.href = j.url; else throw new Error('no url'); })
      .catch(function (e) { SY.busy = false; SY.err = Z('付款页开不了：', 'Could not open the payment page: ') + e.message; acctRender(); });
  }
  function acctClick(t) {
    var a = t.dataset.acct;
    if (a === 'toggle') { SY.open = !SY.open; if (SY.open && AI.open) { AI.open = false; aiRender(); } if (SY.open) { SY.note = ''; SY.info = false; } }
    else if (a === 'info') SY.info = !SY.info;
    else if (a === 'buy') { payGo('/pay/checkout', { plan: t.dataset.v }); return; }
    else if (a === 'portal') { payGo('/pay/portal'); return; }
    else if (a === 'admin') { SY.admin = !SY.admin; ADM.msg = ''; ADM.err = ''; if (SY.admin) { admLoad(); return; } }
    else if (a === 'adm-set' || a === 'adm-del') {
      var em = a === 'adm-del' ? t.dataset.v : ((document.getElementById('adm-email') || {}).value || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(em)) { ADM.err = Z('请填用户登录用的 Gmail', 'Enter the Gmail they sign in with'); acctRender(); return; }
      if (a === 'adm-del' && !window.confirm(Z('取消 ' + em + ' 的 Plus？', 'Remove Plus from ' + em + '?'))) return;
      var until = a === 'adm-set' ? admUntil(em) : null, note = ((document.getElementById('adm-note') || {}).value || '').trim();
      ADM.busy = true; ADM.err = ''; ADM.msg = ''; acctRender();
      accApi(a === 'adm-set' ? '/admin/plus/set' : '/admin/plus/remove', a === 'adm-set' ? { email: em, until: until, note: note } : { email: em }).then(function () {
        ADM.msg = a === 'adm-set' ? Z(em + ' 的 Plus 到 ' + (until === 'forever' ? '永久' : until), em + ' has Plus until ' + until) : Z('已取消 ' + em + ' 的 Plus', 'Removed Plus from ' + em);
        ['adm-email', 'adm-date', 'adm-note'].forEach(function (id) { var el = document.getElementById(id); if (el) el.value = ''; });
        if (ACC && em === ACC.email) syncRun();
        return admLoad();
      }, function (e) { ADM.busy = false; ADM.err = e.message; acctRender(); });
      return;
    }
    else if (a === 'close') SY.open = false;
    else if (a === 'sync') { syncRun(); return; }
    else if (a === 'out') { signOut(); return; }
    else if (a === 'lang') { location.replace(location.pathname + location.search.replace(/([?&])lang=(en|zh)&?/, '$1').replace(/[?&]$/, '') + location.hash); return; }
    else if (a === 'del') {
      if (!window.confirm(Z('删除云端的同步资料并登出？这台设备上的列表和设定会保留。', 'Delete your synced data from the cloud and sign out? Lists and settings on this device are kept.'))) return;
      SY.busy = true; acctRender();
      accApi('/sync/delete').then(function () { accOut(); SY.err = ''; SY.note = Z('云端资料已删除', 'Cloud data deleted'); },
        function (e) { SY.err = e.message; }).then(function () { SY.busy = false; acctRender(); });
      return;
    }
    acctRender();
  }
  if (!WIDGET) {
    (function () {
      var btn = document.getElementById('acct-btn'); if (!btn) return;
      btn.dataset.acct = 'toggle';
      var box = document.createElement('section'); box.id = 'acct-panel'; box.hidden = true; box.setAttribute('aria-label', Z('账号', 'Account'));
      document.body.appendChild(box);
    })();
    // 从 Stripe 付款页回来：?plus=ok / ?plus=cancel → 打开账号面板说明，网址拿掉参数
    var PAID = /[?&]plus=ok\b/.test(location.search), CANCEL = /[?&]plus=cancel\b/.test(location.search);
    if (/[?&]admin\b/.test(location.search)) { SY.open = true; SY.admin = true; }  // 网站管理员入口 (只有 OWNER_EMAILS 的账号会显示)
    if (PAID || CANCEL) {
      SY.open = true; SY.note = PAID ? Z('付款成功', 'Payment received') : Z('已取消付款', 'Payment cancelled');
      try { history.replaceState(null, '', location.pathname + location.search.replace(/([?&])plus=(ok|cancel)&?/, '$1').replace(/[?&]$/, '') + location.hash); } catch (e) {}
    }
    fetch('account.json?v=' + V).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (!j || !(j.google_client_id || j.client_id) || !/^https?:\/\/[^\s"'<>]+$/.test(j.worker || '')) return;
      ACCT = j;
      if (ACC && ACC.exp && ACC.exp < Date.now()) { accOut(); SY.err = Z('登录已过期，请重新登录。', 'Your sign-in has expired. Please sign in again.'); }
      acctRender();
      if (D && S.page === 'watch' && !S.code) render();  // 观察列表页的「登录 / 已同步」提示
      if (ACC) syncRun();
      if (PAID && ACC) { setTimeout(syncRun, 4000); setTimeout(syncRun, 15000); }  // Stripe 的付款通知可能晚几秒才到
    }).catch(function () {});
    document.addEventListener('visibilitychange', function () {
      if (!ACC || !ACCT) return;
      if (document.visibilityState === 'hidden') { if (SY.t) syncRun(); }  // 离开前把还没送出的改动送出去
      else if (Date.now() - (ACC.at || 0) > 60e3) syncRun();               // 回到页面：超过 1 分钟没同步就拿一次最新的
    });
    window.addEventListener('online', function () { if (ACC && ACCT && SY.err) syncSoon(500); });
    window.addEventListener('resize', function () { if (SY.open) acctRender(); });
  }

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
    D = j; siteBase(); ingest(); fromHash(); offlineBar(); loadOv();
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
