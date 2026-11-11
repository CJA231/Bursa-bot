// bursa.term — 马股终端版 (纯文字 / Nord)。数据: data.json (今天的结果) + bars.json (日线，打开后在背景下载)
// 页面: 1 信号 (+ 信号跟进) · 2 市场 · 3 观察列表 (自己的，分文件夹) · 4 回测 · 5 股票池 · 6 公告；#q-<代码> = 个股。图全部用字符画 (█ │ ▁▂▃ …)。
(function () {
  'use strict';
  var V = (document.currentScript && /v=([^&]+)/.exec(document.currentScript.src) || [])[1] || Date.now();
  var D = null, BARS = null, barsLoading = false;
  var main = document.getElementById('main');
  var PAGES = [['sig', '信号'], ['mkt', '市场'], ['watch', '观察列表'], ['bt', '回测'], ['pool', '股票池'], ['ann', '公告']];
  var S = { page: 'sig', code: null, flt: {}, sort: 'to', dir: -1, q: '', limit: 50, cat: 'all' };
  var CAT = { results: '财报', dividend: '派息', corporate: '企业', holding: '持股', buyback: '回购', uma: '异常', people: '人事', meeting: '会议', other: '其他' };
  var EXIT = { take: '涨幅达标', emab: 'EMA 破位', combo: '趋势转坏', time: '期满', swing: '跌破低点', stop: '跌破风险线', sar: 'SAR 转空', red: '回调红K', open: '跟踪中', high: '前高', res: '阻力' };
  var STN = { hold: 'ACTIVE 跟踪中', near: 'NEAR 近风险线', out: 'ENDED 已结束' };

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
  function candleChart(bars, opt) {
    opt = opt || {};
    var rows = opt.rows || 12, axis = 7, W = Math.min(bars.length, (opt.cols || cols()) - axis);
    if (W < 5) return '<p class="dim">日线不够</p>';
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
    bs.forEach(function (b, i) {
      var c = b.c >= b.o ? 'cu' : 'cd', bt = Math.max(b.o, b.c), bb = Math.min(b.o, b.c);
      for (var r = 0; r < rows; r++) {
        var top = hi - r * step, bot = top - step, ov = Math.min(bt, top) - Math.max(bb, bot);
        if (bt - bb < step * 0.25 && (bt + bb) / 2 <= top && (bt + bb) / 2 > bot) g[r][i] = ['━', c];
        else if (ov > 0) g[r][i] = [ov >= step * 0.55 ? '█' : bt >= top - step * 0.5 ? '▀' : '▄', c];
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
      for (i = 0; i < W; i++) { var cell = g[r][i]; if (cell[1] !== cur) { line += span(cur, buf); buf = ''; cur = cell[1]; } buf += cell[0]; }
      line += span(cur, buf);
      var lab = marks[r] ? span(marks[r][1], ' ' + pad(px(marks[r][0]), 6, true)) : labels[r] != null ? span('dim', ' ' + pad(px(labels[r]), 6, true)) : '';
      out.push(line + lab);
    }
    var mv = Math.max.apply(null, bs.map(function (b) { return b.v || 0; })) || 1, vl = '', vc = null, vb = '';
    bs.forEach(function (b) { var c = b.c >= b.o ? 'vu' : 'vd', ch = EIGHTHS[Math.max(1, Math.round((b.v || 0) / mv * 8))]; if (c !== vc) { vl += span(vc, vb); vb = ''; vc = c; } vb += ch; });
    vl += span(vc, vb) + span('dim', ' VOL');
    out.push(vl);
    var d0 = md(bs[0].d), d1 = md(bs[bs.length - 1].d);
    out.push(span('dim', d0 + ' '.repeat(Math.max(1, W - d0.length - d1.length)) + d1));
    return '<pre class="chart" role="img" aria-label="' + esc(opt.label || '日线') + '，最近 ' + W + ' 天">' + out.join('\n') + '</pre>';
  }
  // 多行方块图 (资金曲线 / 指数)：每栏一个点，最上面一格用 ▁▂▃ 表示零头
  function blockChart(vals, opt) {
    opt = opt || {};
    var rows = opt.rows || 7, axis = 9, W = (opt.cols || cols()) - axis;
    vals = vals.filter(isNum); if (vals.length < 2) return '<p class="dim">数据不够</p>';
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
    return '<pre class="chart" role="img" aria-label="' + esc(opt.label || '走势') + '">' + out.join('\n') + '</pre>';
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
    if (!b) return '<pre class="chart dim">' + (BARS ? '没有日线' : 'loading bars…') + '</pre>';
    return candleChart(b, opt);
  }
  function sparkFor(code, n) { var b = bars(code); return b ? spark(b.slice(-30).map(function (x) { return x.c; }), n) : ''; }

  // ---------- 页面 ----------
  function pn(title, sub, inner) { return '<section class="pn"><h2><span class="tt">' + title + '</span>' + (sub ? '<small>' + sub + '</small>' : '') + '</h2><div class="stack">' + inner + '</div></section>'; }
  function kv(items, four) { return '<div class="kv' + (four ? ' k4' : '') + '">' + items.map(function (x) { return '<div><span>' + x[0] + '</span><span class="' + (x[2] || '') + '">' + x[1] + '</span></div>'; }).join('') + '</div>'; }
  function stockBtn(s, right, sub) {
    return '<button type="button" class="row" data-q="' + esc(s.code) + '"><span><b>' + esc(s.name) + '</b> <span class="dim">' + esc(s.code) + '</span>' + (sub ? '<br><span class="sub">' + sub + '</span>' : '') + '</span><span class="r">' + right + '</span></button>';
  }

  function pageSig() {
    var sigs = D.signals || [];
    if (!sigs.length) return pn('SIGNALS 信号', md(D.date), '<p>今天没有股票符合「SAR 转多」的全部条件。</p><p class="dim">之前的信号还在跟进的列在下面；回测结果看 [4]。</p>') + pageTrack();
    return sigs.map(function (x) {
      var risk = isNum(x.stop) ? (x.price - x.stop) / x.price * 100 : null;
      var inner = '<p><button type="button" class="nm" data-q="' + esc(x.code) + '"><b>' + esc(x.name) + '</b> <span class="dim">' + esc(x.code) + '</span></button>　<b>' + px(x.price) + '</b> <span class="' + cls(x.chg) + '">' + pct(x.chg) + '</span>' + (D.state === 'live' ? '　<span class="warn">盘中</span>' : '') + '</p>' +
        chartFor(x.code, { stop: x.stop, target: x.target, label: x.name + ' 日线' }) +
        kv([['距风险线', risk == null ? '—' : pct(-risk, 1), 'dn'], ['参考涨幅', x.tp ? '+' + x.tp + '%' : '—', 'up'], ['R:R', isNum(x.rr) ? x.rr.toFixed(1) : '—'], ['相对量', isNum(x.rv) ? x.rv.toFixed(2) + '×' : '—']], true) +
        (risk != null && x.tp ? '<pre class="txt">下行 ' + (function () { var k = Math.max(1, Math.round(risk / (risk + x.tp) * 24)); return span('cd', '█'.repeat(k)) + span('cu', '█'.repeat(24 - k)); })() + ' 上行\n' +
          span('dim', '风险线 ' + px(x.stop) + (x.stop_by ? ' (' + esc(x.stop_by) + ')' : '') + '  ·  参考位 ' + px(x.target)) + '</pre>' : '') +
        (x.digest ? '<p class="digest"><b>消息面&gt;</b> ' + esc(x.digest) + '</p>' : '') +
        '<details class="info" data-code="' + esc(x.code) + '"' + (OPEN[x.code] ? ' open' : '') + '><summary>Info <span class="arw" aria-hidden="true">➡️</span></summary>' +
        '<pre class="txt">' + (x.why || []).map(function (w) { return span('up', '[x]') + ' ' + esc(w); }).join('\n') + '</pre>' +
        '<button type="button" class="more" data-q="' + esc(x.code) + '">个股详情 →</button></details>';
      return pn('SIGNAL · SAR 转多', md(x.date || D.date), inner);
    }).join('') + pageTrack();
  }
  // 信号跟进 (系统自动)：最近的信号之后走势怎样 (接近风险线 / 跟踪中 / 刚结束)
  function pageTrack() {
    var f = D.follow || [];
    if (!f.length) return pn('TRACKING 信号跟进', '', '<p class="dim">最近没有还在跟进的信号。</p>');
    var groups = [['near', '接近风险线'], ['hold', '跟踪中'], ['out', '刚结束跟踪']];
    return groups.map(function (gp) {
      var items = f.filter(function (x) { return x.status === gp[0]; });
      if (!items.length) return '';
      return pn('TRACKING · ' + STN[gp[0]], gp[1] + ' · ' + items.length, '<div class="rows">' + items.map(function (x) {
        var s = ST[x.code] || { code: x.code, name: x.name };
        var bar = isNum(x.dist) ? span(x.dist < 3 ? 'dn' : 'acc', meter(Math.max(0, x.dist) / 15, 10)) + ' ' + x.dist.toFixed(1) + '%' : '';
        var sub = md(x.sig) + ' 信号 · ' + x.days + ' 天 · 信号价 ' + px(x.entry) + (x.status === 'out' ? ' · ' + (EXIT[x.reason] || x.reason) : ' · 风险线 ' + px(x.stop)) +
          (x.hits && x.hits.length ? ' · <span class="warn">' + esc(x.hits.join('、')) + '</span>' : '');
        return stockBtn(s, '<span class="' + cls(x.ret) + ' b">' + pct(x.ret, 1) + '</span><br><span class="sub">' + (x.status === 'out' ? px(x.last) : bar) + '</span>', sub);
      }).join('') + '</div>');
    }).join('');
  }

  // ---------- 观察列表 (自己的)：可以开很多个文件夹分类；存在这台设备的浏览器 (localStorage)，可导出 / 导入备份 ----------
  var WQ = '';
  var W = (function () {
    var j = null;
    try { j = JSON.parse(localStorage.getItem('bterm_watch') || 'null'); } catch (e) {}
    if (!j || !Array.isArray(j.folders) || !j.folders.length) j = { folders: [{ id: 'f1', name: '默认', codes: [] }], cur: 'f1' };
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
      sub = '<span class="' + cls(s.c) + '">' + sparkFor(c, 12) + '</span> RSI ' + (isNum(s.rsi) ? s.rsi.toFixed(0) : '—') + ' · 量比 ' + (isNum(s.rv) ? s.rv.toFixed(1) : '—') +
        (s.sig ? ' · <span class="up">今天信号</span>' : '') + (s.pool ? '' : ' · <span class="dim">不在股票池</span>');
    } else {
      var b = DAILY[c];
      if (b === undefined) loadDaily(c).then(function () { if (S.page === 'watch' && !S.code) render(); });
      var last = b && b.length ? b[b.length - 1] : null, prev = b && b.length > 1 ? b[b.length - 2] : null, ch = last && prev ? (last.c / prev.c - 1) * 100 : null;
      right = last ? '<span class="' + cls(ch) + ' b">' + pct(ch) + '</span><br><span class="sub">' + px(last.c) + '</span>' : '<span class="dim">—</span>';
      sub = '<span class="dim">今天不在报告里 (成交量不够)' + (last ? ' · ' + md(last.d) + ' 收盘' : '') + '</span>';
    }
    return '<div class="wrow">' + stockBtn(s || { code: c, name: nameOf(c) }, right, sub) + '<button type="button" class="wdel" data-wd="' + c + '" aria-label="从这个文件夹移除 ' + esc(nameOf(c)) + '">×</button></div>';
  }
  // 文件夹操作都在页面里完成 (不用 prompt / confirm 弹窗：有些手机浏览器会把弹窗挡掉，按了没反应)
  // WF.mode: new 新文件夹 / ren 改名 / del 确认删除 / exp 导出 / imp 导入；WF.code = 在个股页新建时顺便把这支加进去；WF.msg = 提示
  var WF = { mode: null, code: null, msg: '' };
  function wForm(where) {
    var m = WF.mode, f = curFolder(), h = '';
    if (!m || (where === 'quote') !== !!WF.code) return WF.msg && where !== 'quote' ? '<p class="warn">' + esc(WF.msg) + '</p>' : '';
    if (m === 'new' || m === 'ren') h = '<div class="wform"><input id="wf-name" type="text" maxlength="20" autocomplete="off" placeholder="' + (m === 'new' ? '新文件夹名称，例如 科技、银行' : '新的名称') + '" value="' + (m === 'ren' ? esc(f.name) : '') + '">' +
      '<button type="button" class="ok" data-wa="ok">' + (m === 'new' ? '建立' : '改名') + '</button><button type="button" data-wa="cancel">取消</button></div>';
    else if (m === 'del') h = '<div class="wform"><span class="dn">删除「' + esc(f.name) + '」和里面 ' + f.codes.length + ' 支？</span><button type="button" class="ok bad" data-wa="ok">确认删除</button><button type="button" data-wa="cancel">取消</button></div>';
    else if (m === 'exp') h = '<div class="wform col"><span class="dim">长按全选、复制，存在备忘录里；以后在「导入」贴回来就能恢复。</span><textarea id="wf-text" rows="4" readonly>' + esc(JSON.stringify({ folders: W.folders })) + '</textarea><button type="button" data-wa="cancel">完成</button></div>';
    else if (m === 'imp') h = '<div class="wform col"><span class="dim">贴上之前「导出备份」的整段文字，会取代现在的观察列表。</span><textarea id="wf-text" rows="4" placeholder="{&quot;folders&quot;: …}"></textarea><div><button type="button" class="ok" data-wa="ok">导入</button><button type="button" data-wa="cancel">取消</button></div></div>';
    return h + (WF.msg ? '<p class="warn">' + esc(WF.msg) + '</p>' : '');
  }
  function wSubmit() {
    var m = WF.mode, f = curFolder(), el = document.getElementById(m === 'imp' ? 'wf-text' : 'wf-name'), v = el ? el.value.trim() : '';
    WF.msg = '';
    if (m === 'new') {
      if (!v) { WF.msg = '请先输入文件夹名称'; return; }
      var id = 'f' + Date.now().toString(36); W.folders.push({ id: id, name: v.slice(0, 20), codes: WF.code ? [WF.code] : [] });
      if (!WF.code) W.cur = id;
    } else if (m === 'ren') { if (!v) { WF.msg = '名称不能是空的'; return; } f.name = v.slice(0, 20); }
    else if (m === 'del') { if (W.folders.length > 1) { W.folders = W.folders.filter(function (x) { return x.id !== f.id; }); W.cur = W.folders[0].id; } }
    else if (m === 'imp') {
      try {
        var fs = (JSON.parse(v).folders || []).filter(function (x) { return x && x.name && Array.isArray(x.codes); }).map(function (x, i) {
          return { id: 'f' + i + Date.now().toString(36), name: String(x.name).slice(0, 20), codes: x.codes.map(String).filter(function (c) { return /^[0-9A-Z]{4,6}$/.test(c); }) }; });
        if (!fs.length) throw new Error('empty');
        W.folders = fs; W.cur = fs[0].id;
      } catch (e) { WF.msg = '看不懂这段文字，请贴上完整的导出内容。'; return; }
    }
    WF.mode = null; WF.code = null; saveW();
  }
  function pageWatch() {
    var f = curFolder();
    var tabs = '<div class="opts wtabs" role="group" aria-label="文件夹">' + W.folders.map(function (x) {
      return '<button type="button" data-wf="' + x.id + '" aria-pressed="' + (x.id === f.id) + '">📁 ' + esc(x.name) + ' ' + x.codes.length + '</button>'; }).join('') +
      '<button type="button" data-wa="new">＋ 新文件夹</button></div>';
    var add = '<div class="grep"><label for="w-q">add&gt;</label><input id="w-q" type="search" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="名称或代码，加进「' + esc(f.name) + '」" value="' + esc(WQ) + '"></div>' +
      '<div class="opts" id="w-sug">' + wSug() + '</div>';
    var rows = f.codes.length ? '<div class="rows">' + f.codes.map(watchRow).join('') + '</div>' : '<p class="dim">这个文件夹还是空的。上面搜索加入，或在个股页点「☆ 文件夹名」。</p>';
    var tools = '<div class="opts"><button type="button" data-wa="ren">改名</button>' + (W.folders.length > 1 ? '<button type="button" data-wa="del">删除文件夹</button>' : '') +
      '<button type="button" data-wa="exp">导出备份</button><button type="button" data-wa="imp">导入</button></div>' +
      '<p class="dim">观察列表只存在这台设备的浏览器里，换手机或清除网站资料会不见，记得「导出备份」。</p>';
    var topForm = WF.mode === 'new' && !WF.code ? wForm('page') : '', botForm = WF.mode && WF.mode !== 'new' ? wForm('page') : '';
    return pn('WATCHLIST 观察列表', W.folders.length + ' 个文件夹 · ' + watchCount() + ' 支', tabs + topForm) + pn('📁 ' + esc(f.name), f.codes.length + ' 支', add + rows + tools + botForm);
  }
  // 个股页上的「收藏到观察列表」：每个文件夹一个开关，可以直接在这里开新文件夹并放进去
  function watchToggles(code) {
    return '<div class="opts wq" role="group" aria-label="收藏到观察列表"><span class="dim">收藏到</span>' + W.folders.map(function (f) {
      var on = f.codes.indexOf(code) >= 0;
      return '<button type="button" data-wt="' + f.id + '" data-v="' + code + '" aria-pressed="' + on + '">' + (on ? '★ ' : '☆ ') + esc(f.name) + '</button>'; }).join('') +
      '<button type="button" data-wa="new" data-v="' + code + '">＋ 新文件夹</button></div>' + (WF.mode === 'new' && WF.code === code ? wForm('quote') : '');
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
    var b = D.bt; if (!b) return pn('BACKTEST 回测', '', '<p class="dim">这次没有回测数据。</p>');
    var a = b.acct, pos = b.position || 20000, R = function (v) { return isNum(v) ? v / 100 * pos : null; };
    var h = pn('SIMULATION 模拟统计', esc(b.name || '') + ' · 同时最多 ' + (b.slots || '∞') + ' 笔 · 每笔模拟 RM' + (pos / 1000) + 'K',
      kv([['胜率', isNum(a.win_rate) ? a.win_rate.toFixed(1) + '%' : '—'], ['期望值', pct(a.avg), cls(a.avg)], ['合计', rm(R(a.total)), cls(a.total)], ['最大回撤', rm(R(a.mdd)), 'dn']], true) +
      kv([['已结束 / 进行中', a.closed + ' / ' + a.open], ['进行中浮动', pct(a.open_avg), cls(a.open_avg)], ['盈亏比', isNum(a.payoff) ? a.payoff.toFixed(2) : '—'], ['获利因子', isNum(a.pf) ? a.pf.toFixed(2) : '—'],
        ['平均天数', isNum(a.avg_days) ? a.avg_days + ' 天' : '—'], ['最多连亏', a.max_streak != null ? a.max_streak + ' 笔' : '—'], ['最好', pct(a.best, 1), 'up'], ['最差', pct(a.worst, 1), 'dn']]));
    if (b.curve && b.curve.length > 1) h += pn('EQUITY 模拟累计', '已结束的累计 · ' + md(b.curve[0][0]) + ' ~ ' + md(b.curve[b.curve.length - 1][0]),
      blockChart([0].concat(b.curve.map(function (c) { return R(c[1]); })), { rows: 8, zero: true, label: '账户资金曲线', fmt: function (v) { return (v >= 0 ? '+' : '') + (v / 1000).toFixed(1) + 'k'; },
        color: function (v) { return v >= 0 ? 'acc' : 'dn'; }, dates: [md(b.curve[0][0]), md(b.curve[b.curve.length - 1][0])] }));
    var ex = a.exits || {}, tot = Object.keys(ex).reduce(function (s, k) { return s + ex[k]; }, 0) || 1;
    h += pn('ENDS 结束原因', a.closed + ' 笔', '<pre class="txt">' + Object.keys(ex).sort(function (x, y) { return ex[y] - ex[x]; }).map(function (k) {
      return cell(esc(EXIT[k] || k), 10) + span('acc', meter(ex[k] / tot, 20)) + ' ' + pad(ex[k], 3, true); }).join('\n') + '</pre>');
    var p = b.paper || {}, ps = p.stats || {};
    if (p.trades && p.trades.length) h += pn('PAPER 模拟账户', md(p.start) + ' 起 · 胜率 ' + (isNum(ps.win_rate) ? ps.win_rate.toFixed(0) + '%' : '—'),
      '<div class="rows">' + p.trades.slice().sort(function (x, y) { return (y.entry_date || '') < (x.entry_date || '') ? -1 : 1; }).map(function (t) {
        var v = t.reason === 'open' ? t.ret : t.net, s = ST[t.code] || { code: t.code, name: t.name };
        return stockBtn(s, '<span class="' + cls(v) + ' b">' + pct(v, 1) + '</span><br><span class="sub">' + rm(R(v)) + '</span>',
          md(t.entry_date) + ' ' + px(t.entry) + ' → ' + px(t.exit) + ' · ' + (EXIT[t.reason] || t.reason) + ' · ' + t.days + ' 天');
      }).join('') + '</div>');
    if (b.monthly && b.monthly.length) h += pn('EVERY 每个信号都计入', (b.every && b.every.closed) + ' 笔 · 胜 ' + (b.every && isNum(b.every.win_rate) ? b.every.win_rate.toFixed(0) + '%' : '—') + ' · 均 ' + pct(b.every && b.every.avg),
      '<pre class="txt">' + span('dim', 'MONTH    N    WIN               AVG') + '\n' + b.monthly.map(function (m) {
        return m[0] + ' ' + pad(m[1], 4, true) + '  ' + span(m[2] >= 50 ? 'up' : m[2] < 30 ? 'dn' : 'acc', meter(m[2] / 100, 10)) + ' ' + pad(m[2].toFixed(0) + '%', 4, true) + ' ' + span(cls(m[3]), pad(pct(m[3], 1), 7, true)); }).join('\n') + '</pre>');
    return h;
  }

  // ---------- 自定义回测：自己选进场条件 / 股票 (一支或几支合计) / 时间，在浏览器里用个股 2 年日线 (../stock/<代码>.json) 重算 ----------
  // 结束条件是后台规则的简化版：涨幅达标、跌破 EMA20 连 2 天、趋势转坏 (Supertrend / SAR 转空 / 放量抛售 / EMA5<EMA20 坏 2 项)、跌幅 %、最长天数
  var CB_RULES = [
    ['sar', 'SAR 转多 (当天翻多)', 1], ['ema20', '价格 > EMA20', 1], ['ema5x20', 'EMA5 > EMA20', 1], ['vol1m', '成交量 ≥ 1M', 1],
    ['st', 'Supertrend(3,1.4) < 价格', 1], ['ema50', '价格 > EMA50 或 EMA5 > EMA50', 1],
    ['cross', 'EMA5 上穿 EMA20 (当天)', 0], ['bbup', '收盘 > 布林上轨 (20,2)', 0], ['rv2', '相对量 ≥ 2', 0],
    ['rsi50', 'RSI(14) > 50', 0], ['rsi30', 'RSI(14) < 30', 0], ['hi20', '收盘创 20 日新高', 0]];
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
    if (!CB.codes.length) { CB.err = '先加至少一支股票'; render(); return; }
    if (!CB_RULES.some(function (r) { return CB.rules[r[0]]; })) { CB.err = '至少勾一个信号条件'; render(); return; }
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
    var stocks = '<div class="grep"><label for="cb-q">add&gt;</label><input id="cb-q" type="search" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="名称或代码，例如 SUNVIEW" value="' + esc(CB.q) + '"></div>' +
      '<div class="opts" id="cb-sug">' + cbSug() + '</div>' +
      '<div class="opts"><button type="button" data-cb="add-sig">+ 今天信号股</button><button type="button" data-cb="add-watch">+ 观察列表「' + esc(curFolder().name) + '」</button><button type="button" data-cb="add-top">+ 成交额前 10</button>' + (CB.codes.length ? '<button type="button" data-cb="clear">清空</button>' : '') + '</div>' +
      (CB.codes.length ? '<div class="opts">' + CB.codes.map(function (c) { return '<button type="button" class="chip" data-cb="del" data-v="' + c + '" aria-label="移除 ' + esc(name(c)) + '">' + esc(name(c)) + ' ×</button>'; }).join('') + '</div>' : '<p class="dim">还没选股票。一支 = 单支回测，几支 = 合计 + 分别列出 (最多 30 支)。</p>');
    var time = '<div class="opts">' + [['m3', '3 个月'], ['m6', '6 个月'], ['y1', '1 年'], ['all', '全部 (约 2 年)']].map(function (p) { return '<button type="button" data-cb="preset" data-v="' + p[0] + '">' + p[1] + '</button>'; }).join('') + '</div>' +
      '<div class="cb-dates"><label>从 <input type="date" id="cb-from" value="' + esc(CB.from) + '"></label><label>到 <input type="date" id="cb-to" value="' + esc(CB.to) + '"></label></div>';
    var rules = '<div class="cb-rules">' + CB_RULES.map(function (r) { return '<label><input type="checkbox" data-cbr="' + r[0] + '"' + (CB.rules[r[0]] ? ' checked' : '') + '> ' + esc(r[1]) + '</label>'; }).join('') + '</div><p class="dim">勾的条件全部同时成立的那天，以收盘价开始计算。默认勾的 6 个 = 后台策略。</p>';
    var exit = '<div class="cb-exit">' + [['take', '涨幅达到 % 结束', CB.take], ['stop', '跌幅达到 % 结束 (0 = 不用)', CB.stop], ['hold', '最长天数', CB.hold]].map(function (x) {
      return '<label>' + x[1] + ' <input type="number" inputmode="decimal" min="0" step="1" data-cbn="' + x[0] + '" value="' + x[2] + '"></label>'; }).join('') +
      '<label><input type="checkbox" data-cbx="emab"' + (CB.emab ? ' checked' : '') + '> 收盘跌破 EMA20 连 2 天</label><label><input type="checkbox" data-cbx="combo"' + (CB.combo ? ' checked' : '') + '> 趋势转坏 (Supertrend / SAR / 放量抛售 / EMA5&lt;EMA20 坏 2 项)</label></div>';
    var h = pn('STOCKS 回测股票', CB.codes.length + ' 支', stocks) + pn('PERIOD 回测时间', (CB.from || '最早') + ' ~ ' + (CB.to || '最新'), time) +
      pn('CONDITIONS 信号条件', CB_RULES.filter(function (r) { return CB.rules[r[0]]; }).length + ' 项', rules) + pn('END 结束条件', '', exit) +
      '<button type="button" class="run" data-cb="run"' + (CB.busy ? ' disabled' : '') + '>' + (CB.busy ? '计算中…' : '▶ 运行回测') + '</button>' + (CB.err ? '<p class="dn">' + esc(CB.err) + '</p>' : '');
    var r = CB.res;
    if (r) {
      var a = r.all;
      h += pn('RESULT 结果', CB.codes.length + ' 支合计 · ' + md(CB.from || r.first) + ' ~ ' + md(CB.to || r.last) + ' · 成本 ' + r.cost + '%',
        kv([['笔数', a.n + (a.open ? ' (进行中 ' + a.open + ')' : '')], ['胜率', isNum(a.win) ? a.win.toFixed(1) + '%' : '—'], ['期望值', pct(a.avg), cls(a.avg)], ['合计', rm(R(a.total)), cls(a.total)]], true) +
        kv([['最大回撤', rm(R(a.mdd)), 'dn'], ['盈亏比', isNum(a.payoff) ? a.payoff.toFixed(2) : '—'], ['平均天数', isNum(a.days) ? a.days.toFixed(1) + ' 天' : '—'], ['每笔', 'RM' + (pos / 1000) + 'K']]) +
        (a.closed > 1 ? (function () { var cl = r.trades.filter(function (t) { return t.reason !== 'open'; }).sort(function (x, y) { return x.exit_date < y.exit_date ? -1 : 1; }), cum = 0;
          return blockChart([0].concat(cl.map(function (t) { cum += t.net; return R(cum); })), { rows: 6, zero: true, label: '自定义回测资金曲线', fmt: function (v) { return (v >= 0 ? '+' : '') + (v / 1000).toFixed(1) + 'k'; },
            color: function (v) { return v >= 0 ? 'acc' : 'dn'; }, dates: [md(cl[0].exit_date), md(cl[cl.length - 1].exit_date)] }); })() : '') +
        (a.n ? '' : '<p class="dim">这段时间没有任何一天同时满足勾的条件。少勾几个条件或拉长时间试试。</p>'));
      if (r.per.length > 1) h += pn('BY STOCK 分别', '', '<pre class="txt">' + span('dim', cell('股票', 10) + cell('笔', 4, 1) + cell('胜率', 7, 1) + cell('合计 RM', 10, 1) + cell('同期涨跌', 10, 1)) + '\n' +
        r.per.map(function (p) { return '<button type="button" class="nm" data-q="' + p.code + '">' + cell(esc(name(p.code)), 10) + '</button>' + (p.none ? span('dim', '没有日线') : pad(p.st.n, 4, true) + pad(isNum(p.st.win) ? p.st.win.toFixed(0) + '%' : '—', 7, true) + span(cls(p.st.total), pad(rm(R(p.st.total)).replace('RM ', ''), 10, true)) + span(cls(p.bh), pad(pct(p.bh, 1), 10, true))); }).join('\n') + '</pre>');
      if (r.trades.length) h += pn('TRADES 逐笔', r.trades.length + ' 笔 (新到旧)', '<div class="rows">' + r.trades.slice(0, 60).map(function (t) {
        var s = ST[t.code] || { code: t.code, name: name(t.code) };
        return stockBtn(s, '<span class="' + cls(t.net) + ' b">' + pct(t.net, 1) + '</span><br><span class="sub">' + rm(R(t.net)) + '</span>', md(t.sig) + ' ' + px(t.entry) + ' → ' + px(t.exit) + ' · ' + (EXIT[t.reason] || t.reason) + ' · ' + t.days + ' 天');
      }).join('') + '</div>');
    }
    return h;
  }
  function pageBt() {
    var seg = '<div class="opts seg" role="group" aria-label="回测"><button type="button" data-cb="mode" data-v="ledger" aria-pressed="' + (S.bt !== 'custom') + '">后台策略</button><button type="button" data-cb="mode" data-v="custom" aria-pressed="' + (S.bt === 'custom') + '">自定义回测</button></div>';
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
    ['h', 'hi', 'RSI>70', function (s) { return s.rsi > 70; }], ['n', 'new', '今天新进', function (s) { return s.fresh === 1; }]];
  var SORT = [['o', 'to', '成交额', function (s) { return s.to || 0; }], ['c', 'chg', '涨跌', function (s) { return s.c || 0; }],
    ['r', 'rv', '相对量', function (s) { return s.rv || 0; }], ['i', 'rsi', 'RSI', function (s) { return s.rsi || 0; }]];
  function poolList() {
    var q = S.q.trim().toUpperCase(), fs = FLT.filter(function (f) { return S.flt[f[1]]; }), so = SORT.filter(function (x) { return x[1] === S.sort; })[0];
    return LIST.filter(function (s) { return (q ? (s.name.toUpperCase().indexOf(q) >= 0 || s.code.indexOf(q) >= 0) : s.pool === 1) && fs.every(function (f) { return f[3](s); }); })
      .sort(function (a, b) { return (so[3](a) - so[3](b)) * S.dir; });  // dir -1 = 高到低, 1 = 低到高
  }
  // 同一个排序再按一次 = 换方向 (高到低 ⇄ 低到高)
  function setSort(k) { if (S.sort === k) S.dir = -S.dir; else { S.sort = k; S.dir = -1; } render(); }
  function poolHead() {
    return '<div class="grep"><label for="grep">grep&gt;</label><input id="grep" type="search" inputmode="search" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="名称或代码 (搜全部)" value="' + esc(S.q) + '"></div>' +
      '<div class="opts" role="group" aria-label="筛选">' + FLT.map(function (f) { return '<button type="button" data-flt="' + f[1] + '" aria-pressed="' + !!S.flt[f[1]] + '">[' + f[0] + ']' + f[2] + '</button>'; }).join('') + '</div>' +
      '<div class="opts" role="group" aria-label="排序">' + SORT.map(function (x) { return '<button type="button" data-sort="' + x[1] + '" aria-pressed="' + (S.sort === x[1]) + '" title="再按一次换方向">[' + x[0] + ']' + x[2] + (S.sort === x[1] ? (S.dir < 0 ? '↓' : '↑') : '') + '</button>'; }).join('') + '</div>';
  }
  function poolBody() {
    var l = poolList(), n = LIST.filter(function (s) { return s.pool === 1; }).length;
    function th(k, t) { var on = S.sort === k; return '<button type="button" class="num th' + (on ? ' on' : '') + '" data-sort="' + k + '">' + (on ? (S.dir < 0 ? '↓' : '↑') : '') + t + '</button>'; }
    var rows = '<div class="grid-pool thead"><span>CODE</span><span>NAME</span><span class="num">LAST</span>' + th('chg', 'CHG%') + th('rv', 'RVOL') + th('rsi', 'RSI') + '<span>30D</span></div>' +
      l.slice(0, S.limit).map(function (s) {
        return '<button type="button" class="row" data-q="' + esc(s.code) + '" style="display:block"><span class="grid-pool"><span class="dim">' + esc(s.code) + '</span><span class="' + (s.pool ? '' : 'dim') + '">' + esc(s.name) + '</span><span class="num">' + px(s.p) + '</span>' +
          '<span class="num ' + cls(s.c) + '">' + pct(s.c, 1).replace('%', '') + '</span><span class="num' + (s.rv >= 2 ? ' warn' : '') + '">' + (isNum(s.rv) ? s.rv.toFixed(1) : '—') + '</span>' +
          '<span class="num">' + (isNum(s.rsi) ? s.rsi.toFixed(0) : '—') + '</span><span class="' + cls(s.c) + '">' + sparkFor(s.code, 12) + (s.fresh ? ' <span class="acc">新</span>' : '') + (s.sig ? ' <span class="up">SIG</span>' : '') + '</span></span></button>';
      }).join('') + (l.length > S.limit ? '<button type="button" class="more" data-more="1">→ 再显示 ' + Math.min(50, l.length - S.limit) + ' 支 (共 ' + l.length + ')</button>' : '');
    return { rows: rows, n: (S.q ? '搜索 ' + l.length + ' 支' : l.length + ' / ' + n + ' 支 · 成交量 ≥ 1M') };
  }
  function pagePool() {
    var b = poolBody();
    return pn('POOL 股票池', '<span id="pool-n">' + b.n + '</span>', poolHead() + '<div class="rows pool-tbl" id="pool-body">' + b.rows + '</div>');
  }
  // 热力图：成交额最大的股票，一格一支，颜色深浅 = 涨跌幅 (░▒▓█ 四级)，点格子开个股
  // 热力图：成交额最大的 N 支，一格一支，颜色深浅 = 涨跌幅。支数多时格子自动变小，整张图尽量一屏看完 (不是拉成长长一列)
  // 下面的颜色对照可以点：只显示那一档涨跌幅的股票，再点一次取消
  var HEAT_N = [[24, '前 24'], [50, '前 50'], [80, '前 80'], [0, '股票池全部']];
  var HEAT_LG = [['d4', '≤-10'], ['d3', '-5'], ['d2', '-2'], ['d1', '-0.5'], ['z0', '0'], ['u1', '+0.5'], ['u2', '+2'], ['u3', '+5'], ['u4', '≥10']];
  var HEAT_TXT = { d4: '跌 10% 以上', d3: '跌 5–10%', d2: '跌 2–5%', d1: '跌 0.5–2%', z0: '±0.5% 以内', u1: '涨 0.5–2%', u2: '涨 2–5%', u3: '涨 5–10%', u4: '涨 10% 以上' };
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
    var opts = '<div class="opts" role="group" aria-label="热力图范围">' + HEAT_N.map(function (x) {
      return '<button type="button" data-heat="' + x[0] + '" aria-pressed="' + (n === x[0]) + '">' + x[1] + '</button>'; }).join('') + '</div>';
    var dens = shown.length <= 30 ? 'hm-l' : shown.length <= 60 ? 'hm-m' : shown.length <= 100 ? 'hm-s' : 'hm-xs';
    var cells = shown.map(function (s) {
      return '<button type="button" class="hm-c hm-' + heatKey(s.c) + '" data-q="' + esc(s.code) + '" title="' + esc(s.name) + ' ' + pct(s.c) + ' · 成交额 RM ' + big(s.to) + '">' +
        '<span class="hm-n">' + esc(s.name) + '</span><span class="hm-p">' + (s.c > 0 ? '+' : '') + s.c.toFixed(1) + '</span></button>';
    }).join('');
    var legend = '<div class="hm-lg" role="group" aria-label="按涨跌幅筛选">' + HEAT_LG.map(function (x) {
      return '<button type="button" class="hm-' + x[0] + '" data-hb="' + x[0] + '" aria-pressed="' + (hb === x[0]) + '" aria-label="' + HEAT_TXT[x[0]] + ' ' + (cnt[x[0]] || 0) + ' 支"' + (cnt[x[0]] ? '' : ' disabled') + '>' +
        x[1] + '<small>' + (cnt[x[0]] || 0) + '</small></button>'; }).join('') + '</div>' +
      '<p class="dim hm-tip">' + (hb ? '只显示「' + HEAT_TXT[hb] + '」' + shown.length + ' 支 · 再点一次显示全部' : '点颜色格子 = 只看那一档涨跌幅的股票') + '</p>';
    return pn('HEATMAP 热力图', '按成交额 · ▲' + up + ' ▼' + dn, opts + '<div class="hm ' + dens + '">' + cells + '</div>' + legend);
  }
  function pageMkt() {
    var m = D.market || {}, ix = m.index, b = m.breadth, h = '';
    if (ix) h += pn('INDEX 大盘', esc(ix.label), '<p><b>' + ix.last.toLocaleString('en', { minimumFractionDigits: 2 }) + '</b> <span class="' + cls(ix.chg) + '">' + (ix.chg > 0 ? '+' : '') + ix.chg + ' (' + pct(ix.pct) + ')</span>' + (isNum(m.usd_myr) ? '　<span class="dim">USD/MYR ' + m.usd_myr.toFixed(4) + '</span>' : '') + '</p>' +
      blockChart(ix.spark, { rows: 6, label: ix.label + ' 近 30 日', fmt: function (v) { return v.toFixed(0); }, color: function (v, j, a) { return j && a[j] < a[j - 1] ? 'cd' : 'cu'; } }));
    h += heatmap();
    if (b) { var t = b.total || (b.up + b.flat + b.down) || 1;
      h += pn('BREADTH 涨跌家数', '全市场 ' + t + ' 支', '<pre class="txt">' + span('up', pad('ADV 涨', 7) + meter(b.up / t, 24)) + ' ' + b.up + '\n' + span('dim', pad('UNCH 平', 7) + meter(b.flat / t, 24)) + ' ' + b.flat + '\n' + span('dn', pad('DEC 跌', 7) + meter(b.down / t, 24)) + ' ' + b.down +
        '\n' + span('dim', '52W HIGH ' + b.highs + ' · LOW ' + b.lows + (isNum(b.turnover) ? ' · 成交额 RM ' + big(b.turnover) : '')) + '</pre>'); }
    var liq = LIST.filter(function (s) { return (s.to || 0) >= 1e6; });
    function top(arr, f, n) { return arr.slice().sort(f).slice(0, n); }
    [['GAINERS 涨幅', top(liq.filter(function (s) { return s.c > 0; }), function (a, b) { return b.c - a.c; }, 5)],
      ['LOSERS 跌幅', top(liq.filter(function (s) { return s.c < 0; }), function (a, b) { return a.c - b.c; }, 5)],
      ['ACTIVE 成交额', top(LIST, function (a, b) { return (b.to || 0) - (a.to || 0); }, 5)]].forEach(function (g) {
      h += pn(g[0], g[0].indexOf('ACTIVE') ? '成交额 ≥ RM1M' : '', '<div class="rows">' + g[1].map(function (s) { return stockBtn(s, '<span class="' + cls(s.c) + ' b">' + pct(s.c) + '</span><br><span class="sub">' + px(s.p) + '</span>', 'RM ' + big(s.to) + ' · 量比 ' + (isNum(s.rv) ? s.rv.toFixed(1) : '—')); }).join('') + '</div>');
    });
    var ch = D.changes || [];
    if (ch.length) { var L = { 'new': '新上市', renamed: '改名', removed: '下市' };
      h += pn('LISTING 名单变动', '近 14 天', '<pre class="txt">' + ch.map(function (e) { return md(e.date) + ' ' + span(e.type === 'removed' ? 'dn' : e.type === 'new' ? 'up' : 'warn', cell(L[e.type] || e.type, 7)) + ' ' + esc(e.symbol.replace('.KL', '')) + ' ' + (e.old ? esc(e.old) + ' → ' : '') + esc(e.name); }).join('\n') + '</pre>'); }
    return h;
  }
  // 公告筛选只有一排：「全部」固定在左边，AI 标记 (📌 / ⚠) 和各分类在右边一条横向滑动；一次选一个 (S.af)
  function pageAnn() {
    var bd = D.board || [];
    if (!bd.length) return pn('ANNOUNCEMENTS 公告', '', '<p class="dim">最近 14 天报告里的股票没有公告。</p>');
    loadIntelIx();
    var tg = function (x) { var it = INTEL_IX && INTEL_IX[x.code]; var t = it && it.t ? it.t[annId(x.link)] : null; return t === 'catalyst' ? 'notable' : t; };
    var af = S.af || '';
    var pass = function (x) { return !af || (af === 'notable' || af === 'risk' ? tg(x) === af : x.cat === af); };
    var items = bd.filter(pass), out = '', last = null;
    items.forEach(function (x) {
      if (x.date !== last) { out += '<p class="dim" style="margin-top:6px">── ' + md(x.date) + ' ──</p>'; last = x.date; }
      out += '<p class="list-ann"><button type="button" data-q="' + esc(x.code) + '" class="' + (x.signal ? 'up' : 'acc') + '">' + esc(x.name) + '</button> <span class="tag dim">' + (CAT[x.cat] || x.cat) + '</span>' + tagChip(tg(x)) + '<a href="' + esc(x.link) + '" target="_blank" rel="noopener">' + esc(x.title) + '</a></p>';
    });
    var chips = [['notable', '📌 重要事件'], ['risk', '⚠ 需留意']].concat(Object.keys(CAT).filter(function (c) { return bd.some(function (x) { return x.cat === c; }); }).map(function (c) { return [c, CAT[c]]; }));
    var btn = function (k, label) { return '<button type="button" data-af="' + k + '" aria-pressed="' + (af === k) + '">' + label + '</button>'; };
    var bar = '<div class="fbar" role="group" aria-label="筛选公告">' + btn('', '全部') + '<div class="fscroll">' + chips.map(function (c) { return btn(c[0], c[1]); }).join('') + '</div></div>' +
      (INTEL_IX ? '' : '<p class="dim" style="font-size:11px">AI 标记载入中…</p>');
    return pn('ANNOUNCEMENTS 公告', '近 14 天 · ' + items.length + ' 条', bar + out);
  }


  // ---------- AI 分析 (scripts/company_intel.py 每天收盘后用 DeepSeek 逐家整理，写在 ../intel/)：近况、重要事件 / 留意事项、财报一句、公告标记 ----------
  // 只做中性标记 (📌 = 值得注意的事件，⚠ = 需要留意)，不写「利好」：避免被当成买入信号
  var INTEL = {}, INTEL_IX = null, ixLoading = false;
  var TAG = { notable: ['📌', '', 'tg-note'], catalyst: ['📌', '', 'tg-note'], risk: ['⚠', '留意', 'tg-risk'] };
  function loadIntelIx() {
    if (INTEL_IX || ixLoading) return; ixLoading = true;
    fetch((D.report || '../') + 'intel/index.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
      .then(function (j) { INTEL_IX = (j && j.items) || {}; if (S.page === 'ann' && !S.code) render(); });
  }
  function annId(link) { var mm = /(\d+)\D*$/.exec(link || ''); return mm ? mm[1] : null; }
  function tagChip(t) { var x = TAG[t]; return x ? '<span class="tag ' + x[2] + '" title="' + (x[1] || '重要事件') + '">' + x[0] + (x[1] ? ' ' + x[1] : '') + '</span>' : ''; }
  function intelPanel(code) {
    if (!(code in INTEL)) {
      INTEL[code] = 'loading';
      fetch((D.report || '../') + 'intel/' + code + '.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
        .then(function (j) { INTEL[code] = j; if (S.code === code) render(); });
    }
    var r = INTEL[code], title = 'AI 分析';
    if (r === 'loading') return pn(title, '', '<p class="dim">loading…</p>');
    if (!r) return pn(title, '', '<p class="dim">还没分析到这家公司 (每天收盘后陆续补上)。</p>');
    var f = r.facts, h = '';
    if (r.recent) h += '<p>' + esc(r.recent) + '</p>';
    var nt = r.notable || r.catalysts || [];
    if (nt.length || (r.risks || []).length) h += '<ul class="intel-l">' +
      nt.map(function (x) { return '<li><b>📌</b> ' + esc(x) + '</li>'; }).join('') +
      (r.risks || []).map(function (x) { return '<li class="tg-risk"><b>⚠</b> ' + esc(x) + '</li>'; }).join('') + '</ul>';
    if (f) h += '<p class="dim intel-f">' + md(f.period) + ' 季：营收 ' + finNum(f.revenue) + (isNum(f.revenue_yoy) ? ' (按年 ' + pct(f.revenue_yoy, 1) + ')' : '') +
      ' · 净利 ' + finNum(f.net_income) + (isNum(f.net_income_yoy) ? ' (按年 ' + pct(f.net_income_yoy, 1) + ')' : '') + (isNum(f.net_margin) ? ' · 净利率 ' + f.net_margin + '%' : '') + '</p>';
    if (r.earnings) h += '<p>' + esc(r.earnings) + '</p>';
    var tagged = (r.ann || []).filter(function (a) { return a.tag !== 'routine'; });
    if (tagged.length) h += '<h3 class="fin-h">标记的公告 <span class="dim">📌 重要事件 · ⚠ 需留意</span></h3>' + tagged.slice(0, 10).map(function (a) {
      return '<p class="list-ann"><span class="dim">' + md(a.date) + '</span> ' + tagChip(a.tag) + '<a href="' + esc(a.link) + '" target="_blank" rel="noopener">' + esc(a.title) + '</a>' + (a.why ? ' <span class="dim">· ' + esc(a.why) + '</span>' : '') + '</p>'; }).join('');
    h += '<p class="dim intel-note">AI 生成 (DeepSeek)，只整理公开的公告、新闻和财报，可能有错漏，不构成投资建议 · 更新 ' + esc(r.updated) + '</p>';
    return pn(title, '公告 ' + (r.ann || []).length + ' · 新闻 ' + (r.news || []).length, h);
  }
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
    var h = '<div class="ft" style="grid-template-columns: 5.5em repeat(' + idx.length + ', minmax(0, 1fr))"><span></span>' + labs.map(function (l, k) { return '<span class="ft-h"><i class="fc' + (k + 6 - idx.length) + '"></i>' + l + '</span>'; }).join('');
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
    return '<p class="fin-sub">资产负债率 <span class="dim">= 总负债 ÷ 总资产</span>　<i class="sw" style="background:var(--fin-li)"></i>负债 <i class="sw" style="background:var(--fin-eq)"></i>股东权益</p>' +
      '<svg class="bs" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="资产负债率 ' + idx.map(function (_, k) { return labs[k] + ' ' + (isNum(A[k]) && isNum(L[k]) ? (L[k] / A[k] * 100).toFixed(0) + '%' : '—'); }).join('，') + '">' + g + '</svg>' +
      '<div class="ft-x" style="grid-template-columns: repeat(' + idx.length + ', minmax(0, 1fr))">' + labs.map(function (l) { return '<span>' + l + '</span>'; }).join('') + '</div>';
  }
  function finPanel(code) {
    if (!(code in FIN)) return '';  // profilePanel 已经在载入同一个文件
    var f = FIN[code];
    if (!f || !(f.quarterly || f.annual)) return pn('FINANCIALS 财报', '', '<p class="dim">Yahoo 没有这家公司的财报数据。</p>');
    var mode = S.fin === 'a' && f.annual && f.annual.periods.length ? 'a' : (f.quarterly && f.quarterly.periods.length ? 'q' : 'a');
    var sec = mode === 'a' ? f.annual : f.quarterly, pp = finPeriods(sec, mode === 'a' ? 4 : 5), idx = pp.idx;
    var labs = pp.lab.map(function (d) { return mode === 'a' ? 'FY' + d.slice(2, 4) : d.slice(2, 4) + '/' + d.slice(5, 7); });
    var cur = f.currency === 'MYR' || !f.currency ? 'RM' : f.currency;
    var seg = '<div class="opts" role="group" aria-label="财报期间"><button type="button" data-fin="q" aria-pressed="' + (mode === 'q') + '"' + (f.quarterly && f.quarterly.periods.length ? '' : ' disabled') + '>季报</button>' +
      '<button type="button" data-fin="a" aria-pressed="' + (mode === 'a') + '"' + (f.annual && f.annual.periods.length ? '' : ' disabled') + '>年报</button></div>';
    var mg = function (k) { return idx.map(function (i) { var r = (sec.revenue || [])[i], v = (sec[k] || [])[i]; return isNum(r) && r && isNum(v) ? v / r * 100 : null; }); };
    var h = seg + '<h3 class="fin-h">【损益表】<span class="dim">单位 ' + cur + '</span></h3>' +
      finTable(sec, idx, labs, [['revenue', '营收', 1], ['gross_profit', '毛利'], ['operating_income', '营业利润'], ['net_income', '净利润', 1], ['eps', 'EPS', 0, 1]]);
    var sm = stepChart('毛利率', mg('gross_profit'), labs) + stepChart('营业利润率', mg('operating_income'), labs) + stepChart('净利率', mg('net_income'), labs);
    if (sm) h += '<h3 class="fin-h">【盈利能力】<span class="dim">占营收 %</span></h3><div class="scs">' + sm + '</div>';
    var bs = bsChart(sec, idx, labs);
    if (bs) h += '<h3 class="fin-h">【资产负债】</h3>' + bs + finTable(sec, idx, labs, [['total_assets', '总资产'], ['total_liabilities', '总负债'], ['equity', '股东权益'], ['cash', '现金'], ['total_debt', '总债务']]);
    var cf = finTable(sec, idx, labs, [['operating_cf', '经营现金流', 1], ['capex', '资本支出'], ['free_cf', '自由现金流', 1]]);
    if (cf) h += '<h3 class="fin-h">【现金流】</h3>' + cf;
    return pn('FINANCIALS 财报', (mode === 'a' ? '年报' : '季报') + ' · Yahoo Finance', h + '<p class="dim fin-note">' + (mode === 'q' ? '季报每格 = 那一季 (月份 = 季末)。' : '') + '银行等金融股没有毛利 / 营业利润，会少几行。</p>');
  }
  // 公司简介：官网、行业、员工、中文背景 + 业务线 (DeepSeek 按 Yahoo 英文介绍写的)，英文原文收在 ➡️ 里
  function profilePanel(code) {
    if (!(code in PROF)) { loadDaily(code).then(function () { if (S.code === code) render(); }); return pn('PROFILE 公司简介', '', '<p class="dim">loading…</p>'); }
    var p = PROF[code];
    if (!p) return pn('PROFILE 公司简介', '', '<p class="dim">还没有这家公司的资料 (每天会陆续补上)。</p>');
    var host = p.website ? p.website.replace(/^https?:\/\//i, '').replace(/\/$/, '') : '';
    var h = (PROF[code + '_name'] ? '<p><b>' + esc(PROF[code + '_name']) + '</b></p>' : '') +
      (p.sector || p.industry ? '<p><span class="acc">行业</span> ' + esc([p.sector, p.industry].filter(Boolean).join(' / ')) + '</p>' : '') +
      (p.website ? '<p><span class="acc">官网</span> <a href="' + esc(p.website) + '" target="_blank" rel="noopener">' + esc(host) + ' ↗</a></p>' : '') +
      kv([['员工', isNum(p.employees) ? p.employees.toLocaleString('en') + ' 人' : '—'], ['所在地', esc(p.city || '—')]]);
    if (p.zh) h += '<p>' + esc(p.zh) + '</p>' + (p.lines && p.lines.length ? '<ul class="prof-lines">' + p.lines.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '');
    else if (p.summary) h += '<p class="dim">中文介绍还在生成，先看英文原文：</p>';
    if (p.summary) h += '<details class="info"' + (p.zh ? '' : ' open') + '><summary>English <span class="arw" aria-hidden="true">➡️</span></summary><p class="dim prof-en">' + esc(p.summary) + '</p></details>';
    return pn('PROFILE 公司简介', '来源 Yahoo Finance', h);
  }
  function pageQuote(code) {
    var s = ST[code];
    if (!s) {  // 不在今天的报告里 (成交量不够)：用个股 2 年日线画图，其余照样显示 (简介、财报、公告、新闻)
      var bd = DAILY[code];
      if (bd === undefined) loadDaily(code).then(function () { if (S.code === code) render(); });
      var lst = bd && bd.length ? bd[bd.length - 1] : null, prv = bd && bd.length > 1 ? bd[bd.length - 2] : null, chg = lst && prv ? (lst.c / prv.c - 1) * 100 : null;
      var hm = '<button type="button" class="back" data-back="1">← [q] 返回</button>' +
        pn(esc(nameOf(code)), esc(code), (lst ? '<p><b style="font-size:18px">' + px(lst.c) + '</b> <span class="' + cls(chg) + '">' + pct(chg) + '</span>　<span class="dim">' + md(lst.d) + ' 收盘</span></p>' : '') +
          watchToggles(code) + (bd && bd.length > 5 ? candleChart(bd.slice(-90), { rows: 14, label: nameOf(code) + ' 日线' }) : '<p class="dim">' + (bd === undefined ? 'loading…' : '没有日线') + '</p>') +
          '<p class="dim">这支股票今天不在报告里 (成交量没达到门槛)，没有指标和信号。</p>');
      return hm + profilePanel(code) + intelPanel(code) + finPanel(code) + extraPanels(code);
    }
    var sig = (D.signals || []).filter(function (x) { return x.code === code; })[0], fol = (D.follow || []).filter(function (x) { return x.code === code; })[0];
    var h = '<button type="button" class="back" data-back="1">← [q] 返回</button>';
    h += pn(esc(s.name), esc(code), '<p><b style="font-size:18px">' + px(s.p) + '</b> <span class="' + cls(s.c) + '">' + pct(s.c) + '</span>' + (s.sig ? '　<span class="up">● SIGNAL</span>' : '') + (s.fresh ? '　<span class="acc">今天新进股票池</span>' : '') + '</p>' + watchToggles(code) +
      chartFor(code, { rows: 14, stop: sig ? sig.stop : fol ? fol.stop : null, target: sig ? sig.target : null, label: s.name + ' 日线' }) +
      kv([['成交量', big(s.vol)], ['成交额', 'RM ' + big(s.to)], ['相对量', isNum(s.rv) ? s.rv.toFixed(2) + '×' : '—', s.rv >= 2 ? 'warn' : ''], ['RSI(14)', isNum(s.rsi) ? s.rsi.toFixed(1) : '—'],
        ['EMA20', px(s.ema), isNum(s.ema) ? (s.p > s.ema ? 'up' : 'dn') : ''], ['50日线', px(s.sma), isNum(s.sma) ? (s.p > s.sma ? 'up' : 'dn') : ''], ['SAR', s.sar == null ? '—' : s.sar ? '多头' : '空头', s.sar ? 'up' : 'dn'], ['ATR', isNum(s.atr) ? s.atr.toFixed(1) + '%' : '—'],
        ['市值', isNum(s.mc) ? 'RM ' + big(s.mc) : '—'], ['股票池', s.sig ? '信号股' : s.pool ? (s.first ? md(s.first) + ' 起 · ' + s.streak + ' 天' : '在池') : '不在池'], ['上市', isNum(s.listed) ? s.listed + ' 天' : '> 90 天'], ['日期', md(D.date)]]));
    if (sig) h += pn('LEVELS 信号参考位', 'SAR 转多', kv([['信号价', px(sig.price)], ['风险线', px(sig.stop), 'dn'], ['参考位', px(sig.target), 'up'], ['R:R', isNum(sig.rr) ? sig.rr.toFixed(1) : '—']]) +
      '<pre class="txt">' + (sig.why || []).map(function (w) { return span('up', '[x]') + ' ' + esc(w); }).join('\n') + '</pre>' + (sig.digest ? '<p class="digest"><b>消息面&gt;</b> ' + esc(sig.digest) + '</p>' : ''));
    else if (fol) h += pn('TRACKING 信号跟进', STN[fol.status], kv([['信号日', md(fol.sig)], ['信号价', px(fol.entry)], ['现价', px(fol.last)], ['之后涨跌', pct(fol.ret, 1), cls(fol.ret)],
      ['天数', fol.days + ' 天'], ['风险线', px(fol.stop), 'dn'], ['距风险线', isNum(fol.dist) ? fol.dist.toFixed(1) + '%' : '—', fol.dist < 3 ? 'dn' : ''], ['状态', fol.status === 'out' ? (EXIT[fol.reason] || fol.reason) : STN[fol.status]]]) +
      (fol.hits && fol.hits.length ? '<p class="warn">趋势检查: ' + esc(fol.hits.join('、')) + '</p>' : ''));
    h += profilePanel(code) + intelPanel(code) + finPanel(code) + extraPanels(code);
    return h;
  }
  function extraPanels(code) {
    var h = '';
    var ex = EXTRA[code];
    if (!ex) { EXTRA[code] = 'loading'; fetchExtra(code); }
    var ann = ex && ex.ann || [], news = ex && ex.news || [];
    h += pn('FILINGS 公告', ann.length ? ann.length + ' 条' : '', ex === 'loading' || !ex ? '<p class="dim">loading…</p>' : ann.length ? ann.slice(0, 10).map(function (a) { return '<p class="list-ann"><span class="dim">' + md(a.date) + '</span> <span class="tag dim">' + (CAT[a.cat] || a.cat) + '</span><a href="' + esc(a.link) + '" target="_blank" rel="noopener">' + esc(a.title) + '</a></p>'; }).join('') : '<p class="dim">没有抓到公告</p>');
    h += pn('NEWS 新闻', '', ex === 'loading' || !ex ? '<p class="dim">loading…</p>' : news.length ? news.slice(0, 8).map(function (n) { return '<p class="list-ann"><span class="dim">' + (n.time ? md(new Date(n.time * 1000).toISOString().slice(0, 10)) : '') + '</span> <a href="' + esc(n.link) + '" target="_blank" rel="noopener">' + esc(n.title) + '</a> <span class="dim">' + esc(n.source || '') + '</span></p>'; }).join('') : '<p class="dim">最近没有新闻</p>');
    return h;
  }
  function fetchExtra(code) {
    var j = function (u) { return fetch(u).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); };
    var base = D.report || '../';
    Promise.all([j(base + 'ann/' + code + '.json'), j(base + 'news/' + code + '.json')]).then(function (r) {
      EXTRA[code] = { ann: (r[0] && r[0].items) || [], news: (r[1] && r[1].items) || [] };
      if (S.code === code) render();
    });
  }

  // ---------- 外框 ----------
  // 顶部跑马灯：KLCI、涨 / 平 / 跌家数、USD/MYR、更新时间，后面接成交额前 10、成交量前 10 的涨跌 (不含仙股)；内容复制一份接在后面，无缝循环
  function status() {
    var m = D.market || {}, ix = m.index, b = m.breadth, st = { live: '盘中 LIVE', pre: '开市前', closed: '收盘 CLOSED' }[D.state] || D.state, sep = ' <span class="g">│</span> ';
    var parts = [];
    if (ix) parts.push('<b>' + esc(ix.label.split(' ').pop()) + '</b> ' + ix.last.toLocaleString('en', { minimumFractionDigits: 2 }) + ' <span class="' + cls(ix.chg) + '">' + (ix.chg > 0 ? '▲' : ix.chg < 0 ? '▼' : '') + (ix.chg > 0 ? '+' : '') + ix.chg + ' ' + pct(ix.pct) + '</span>');
    if (b) parts.push('<span class="up">涨 ▲' + b.up + '</span> <span class="dim">平 ■' + b.flat + '</span> <span class="dn">跌 ▼' + b.down + '</span>');
    if (isNum(m.usd_myr)) parts.push('<span class="dim">USD/MYR</span> ' + m.usd_myr.toFixed(4));
    parts.push('<span class="dim">' + esc(md(D.updated.slice(0, 10)) + D.updated.slice(10)) + ' ' + esc(D.tz || '') + '</span> <span class="' + (D.state === 'live' ? 'warn' : 'acc') + '">' + st + '</span>');
    // 成交额前 10、成交量前 10 (仙股不看：价格 < RM0.10 的剔除)
    var liq = LIST.filter(function (x) { return isNum(x.c) && isNum(x.p) && x.p >= 0.1; });
    [['成交额 TOP10', 'to'], ['成交量 TOP10', 'vol']].forEach(function (g) {
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
    }).join('') + '<a class="ui-std" href="' + esc(stdUrl()) + '">⚙ 标准风格</a>';
  }
  function stdUrl() { return (D.report || '../') + '?ui=std'; }
  function render() {
    if (!D) return;
    keys();
    document.getElementById('prompt-arg').textContent = S.code ? 'quote ' + S.code : '--' + S.page;
    var fn = { sig: pageSig, watch: pageWatch, bt: pageBt, pool: pagePool, mkt: pageMkt, ann: pageAnn }[S.page] || pageSig;
    var focusId = document.activeElement && /^(grep|cb-q)$/.test(document.activeElement.id) ? document.activeElement.id : null, focusGrep = !!focusId, pos = focusGrep ? document.activeElement.selectionStart : null;
    main.innerHTML = S.code ? pageQuote(S.code) : fn();
    if (focusGrep) { var g = document.getElementById(focusId); if (g) { g.focus(); try { g.setSelectionRange(pos, pos); } catch (e) {} } }
    if (!BARS) loadBars();
  }
  function go(page, code) {
    S.page = page || S.page; S.code = code || null;
    var h = S.code ? '#q-' + S.code : '#' + S.page;
    if (location.hash !== h) history.replaceState(null, '', h);
    render(); window.scrollTo(0, 0);
  }
  function fromHash() {
    var h = location.hash.slice(1);
    if (/^q-/.test(h)) { S.code = h.slice(2); return; }
    if (h === 'hold') h = 'watch';  // 旧书签
    S.code = null; if (PAGES.some(function (p) { return p[0] === h; })) S.page = h;
  }

  // ---------- 操作 ----------
  document.addEventListener('click', function (e) {
    var wt = e.target.closest('[data-wf],[data-wa],[data-wadd],[data-wd],[data-wt]'); if (wt) { watchClick(wt); return; }
    var fb = e.target.closest('[data-fin]'); if (fb) { S.fin = fb.dataset.fin; render(); return; }
    var ab = e.target.closest('[data-af]'); if (ab) {  // 换筛选后把选中的那个滑到看得见的位置
      S.af = ab.dataset.af || ''; var sl = document.querySelector('.fscroll'), x = sl ? sl.scrollLeft : 0; render();
      var sl2 = document.querySelector('.fscroll'); if (sl2) { sl2.scrollLeft = x; var on = sl2.querySelector('[aria-pressed="true"]'); if (on) on.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
      return; }
    var cbt = e.target.closest('[data-cb]'); if (cbt) { cbClick(cbt); return; }
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
    else if (id === 'grep') {
      S.q = e.target.value; S.limit = 50;
      var b = poolBody(); if ((box = document.getElementById('pool-body'))) box.innerHTML = b.rows;
      if ((box = document.getElementById('pool-n'))) box.textContent = b.n;
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey || !D) return;
    var typing = e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName);
    if (e.key === 'Enter' && e.target.id === 'wf-name') { e.preventDefault(); wSubmit(); render(); return; }
    if (e.key === 'Escape') { if (typing) e.target.blur(); if (S.code) go(S.page); return; }
    if (typing) return;
    var n = parseInt(e.key, 10);
    if (n >= 1 && n <= PAGES.length) { go(PAGES[n - 1][0]); e.preventDefault(); return; }
    if (e.key === 'q' && S.code) { go(S.page); return; }
    if (e.key === '/') { e.preventDefault(); go('pool'); var g = document.getElementById('grep'); if (g) g.focus(); return; }
    if (e.key === 't') { toggleTheme(); return; }
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
    var root = document.documentElement, dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('bterm_theme', root.dataset.theme); } catch (e) {}
  }
  try { var th = localStorage.getItem('bterm_theme'); if (th === 'dark' || th === 'light') document.documentElement.dataset.theme = th; } catch (e) {}
  document.getElementById('theme-btn').addEventListener('click', toggleTheme);

  fetch('data.json?v=' + V).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(function (j) {
    D = j; ingest(); fromHash();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { CW = null; render(); });  // 网页字体到了再量一次字宽
    document.getElementById('status').innerHTML = status();
    var tk = document.querySelector('#status .tick > span');  // 速度固定约每秒 40px，内容长短不影响快慢
    if (tk) document.querySelector('#status .tick').style.animationDuration = Math.max(20, tk.getBoundingClientRect().width / 40) + 's';
    document.getElementById('full-report').href = stdUrl();
    render();
  }).catch(function (err) {
    main.innerHTML = '<p class="dn">读取 data.json 失败 (' + esc(err.message) + ')。报告可能还在生成，稍后再刷新。</p>';
  });
})();
