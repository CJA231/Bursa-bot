// 展示站：行情和价位的事实 —— 综述、强势股、今日机会、其余股票、K线
(function () {
  'use strict';
  var D = null, BARS = null, BY = {}, app = document.getElementById('app');
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function price(v) { return v === null || v === undefined ? '—' : v.toFixed(v >= 100 ? 2 : 3); }
  function pct(v, d) { return v === null || v === undefined ? '—' : (v > 0 ? '+' : '') + v.toFixed(d === undefined ? 2 : d) + '%'; }
  function cls(v) { return v > 0 ? 'up' : v < 0 ? 'down' : 'flat'; }
  function compact(v) { var a = Math.abs(v); return a >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : a >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : a >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : String(Math.round(v)); }
  function load(url) { return fetch(url, { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); }); }

  // ---------- 综述 ----------
  function spark(vals) {
    if (!vals || vals.length < 2) return '';
    var w = 120, h = 30, lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), sp = hi - lo || 1;
    var pts = vals.map(function (v, i) { return (i / (vals.length - 1) * w).toFixed(1) + ',' + (h - (v - lo) / sp * (h - 4) - 2).toFixed(1); }).join(' ');
    var up = vals[vals.length - 1] >= vals[0];
    return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" aria-label="近一个月"><polyline fill="none" stroke="var(--' + (up ? 'up' : 'down') + ')" stroke-width="1.5" points="' + pts + '"/></svg>';
  }
  function nm(r) { return '<span class="nm"><b>' + esc(r.n) + '</b>' + (r.n === r.c ? '' : ' <small>' + esc(r.c) + '</small>') + '</span>'; } // 公司全名 + 代码 (名称就是代码时不重复)
  function chip(code, value, c) { var r = BY[code]; return r ? '<button type="button" class="chip" data-code="' + esc(code) + '">' + nm(r) + '<span class="' + (c || '') + '">' + value + '</span></button>' : ''; }
  function marketHtml() {
    var m = D.market, tiles = (m.indices || []).map(function (ix) {
      return '<div class="card mk-idx"><small>' + esc(ix.label) + '</small><b>' + ix.last.toLocaleString('en', { minimumFractionDigits: 2 }) + '</b><span class="' + cls(ix.chg) + '">' + (ix.chg > 0 ? '+' : '') + ix.chg.toFixed(2) + ' (' + pct(ix.pct) + ')</span>' + spark(ix.spark) + '</div>';
    });
    var b = m.breadth;
    if (b) {
      var w = function (n) { return (n / b.total * 100).toFixed(1) + '%'; };
      tiles.push('<div class="card"><small>全市场涨跌</small><div class="mk-bar" role="img" aria-label="上涨 ' + b.up + '，平盘 ' + b.flat + '，下跌 ' + b.down + '"><span class="u" style="width:' + w(b.up) + '"></span><span class="f" style="width:' + w(b.flat) + '"></span><span class="d" style="width:' + w(b.down) + '"></span></div>' +
        '<div class="mk-counts"><span class="up">涨 ' + b.up + '</span><span class="flat">平 ' + b.flat + '</span><span class="down">跌 ' + b.down + '</span></div>' +
        '<p class="mk-note"><span>成交额 ' + D.cur + ' ' + compact(b.turnover) + '</span><span>新高 ' + b.highs + ' · 新低 ' + b.lows + '</span></p></div>');
    }
    var groups = [['涨幅榜', m.gainers, function (r) { return [pct(r.chg), 'up']; }], ['跌幅榜', m.losers, function (r) { return [pct(r.chg), 'down']; }], ['成交额', m.active, function (r) { return [compact(r.t), '']; }]]
      .filter(function (g) { return g[1] && g[1].length; });
    return '<h2>综述</h2><div class="mk-row">' + tiles.join('') + '</div>' +
      (groups.length ? '<div class="mk-groups">' + groups.map(function (g) { return '<div><h4>' + g[0] + '</h4>' + g[1].map(function (c) { var v = g[2](BY[c]); return chip(c, v[0], v[1]); }).join('') + '</div>'; }).join('') + '</div>' : '');
  }

  // ---------- 强势股 / 今日机会 ----------
  function rowHtml(r, mode) {
    var line;
    if (mode === 'sig' && r.plan) {
      var p = r.plan;
      line = '<span class="l">进 <b>' + price(p.entry) + '</b> · 损 <b>' + price(p.stop) + '</b> <b class="down">−' + p.risk.toFixed(1) + '%</b> · 标 <b>' + price(p.target) + '</b> · <b title="报酬风险比">R ' + p.rr.toFixed(1) + '</b></span>';
    } else line = '<span class="l">量比 <b>' + (r.rv === null ? '—' : r.rv.toFixed(1) + '×') + '</b> · 额 <b>' + compact(r.t) + '</b></span>';
    return '<li><button type="button" class="row" data-code="' + esc(r.c) + '"><span class="h">' + nm(r) + '<span class="px">' + price(r.p) + ' <span class="' + cls(r.chg) + '">' + pct(r.chg) + '</span></span></span>' + line + '</button></li>';
  }
  function listHtml(title, codes, mode, note) {
    var rows = codes.map(function (c) { return BY[c]; }).filter(Boolean);
    return '<h2>' + title + '<span class="count">' + rows.length + (note ? ' · ' + note : '') + '</span></h2>' +
      (rows.length ? '<ol class="list' + (mode === 'sig' ? ' sig-grid' : '') + '" data-list="' + mode + '">' + rows.map(function (r) { return rowHtml(r, mode); }).join('') + '</ol>' : '<p class="hint">—</p>');
  }

  // ---------- 其余股票 (可排序、搜索、筛选) ----------
  var T = { sort: 't', dir: -1, q: '', f: {}, shown: 50 };
  var COLS = [['n', '股票', 0], ['p', '价格', 1], ['chg', '涨跌', 1], ['v', '成交量', 1], ['rv', '量比', 1], ['t', '成交额', 1]];
  function tableRows() {
    var q = T.q.trim().toLowerCase();
    var rows = D.stocks.filter(function (r) {
      if (r.sig) return false;
      if (q && (r.n + ' ' + r.c).toLowerCase().indexOf(q) < 0) return false;
      if (T.f.up && !(r.chg > 0)) return false;
      if (T.f.down && !(r.chg < 0)) return false;
      if (T.f.rv && !((r.rv || 0) >= 2)) return false;
      if (T.f.px && r.p < 0.1) return false;
      return true;
    });
    var k = T.sort;
    rows.sort(function (a, b) { var x = a[k], y = b[k]; if (x === null) x = -Infinity; if (y === null) y = -Infinity; return (typeof x === 'string' ? x.localeCompare(y) : x - y) * T.dir; });
    return rows;
  }
  function tableHtml() {
    var rows = tableRows(), chips = [['up', '上涨'], ['down', '下跌'], ['rv', '放量 ≥ 2×'], ['px', '排除 ' + D.cur + '0.10 以下']];
    return '<h2>其余股票<span class="count">' + rows.length + '</span></h2><div class="toolbar"><input type="search" id="q" placeholder="搜股票名称或代码，例如 CYPARK / 5184" value="' + esc(T.q) + '" aria-label="搜索股票">' +
      chips.map(function (c) { return '<button type="button" class="chip" data-f="' + c[0] + '" aria-pressed="' + !!T.f[c[0]] + '">' + c[1] + '</button>'; }).join('') + '</div>' +
      '<div class="table-wrap"><table><thead><tr>' + COLS.map(function (c) { return '<th class="' + (c[2] ? 'num' : '') + '" data-k="' + c[0] + '">' + c[1] + (T.sort === c[0] ? (T.dir > 0 ? ' ↑' : ' ↓') : '') + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.slice(0, T.shown).map(function (r) {
        return '<tr data-code="' + esc(r.c) + '"><td>' + nm(r) + '</td><td class="num">' + price(r.p) + '</td><td class="num ' + cls(r.chg) + '">' + pct(r.chg) + '</td><td class="num">' + compact(r.v) + '</td><td class="num">' + (r.rv === null ? '—' : r.rv.toFixed(1) + '×') + '</td><td class="num">' + compact(r.t) + '</td></tr>';
      }).join('') + '</tbody></table></div>' + (rows.length > T.shown ? '<button type="button" class="more">再显示 ' + Math.min(50, rows.length - T.shown) + ' 支</button>' : '');
  }
  function drawTable() {
    var box = document.getElementById('tbl'), focus = document.activeElement && document.activeElement.id === 'q', pos = focus ? document.activeElement.selectionStart : 0;
    box.innerHTML = tableHtml();
    if (focus) { var i = document.getElementById('q'); i.focus(); i.setSelectionRange(pos, pos); }
  }

  // ---------- 详情：纯K线 + 成交量；机会股多画进场 / 风险线 / 目标 ----------
  var dlg = null, chart = null, curList = [], curI = -1;
  function closeDlg() { if (chart) { chart.remove(); chart = null; } if (dlg) { dlg.remove(); dlg = null; } document.removeEventListener('keydown', onKey); }
  function onKey(e) { if (e.key === 'Escape') closeDlg(); else if (e.key === 'ArrowRight') step(1); else if (e.key === 'ArrowLeft') step(-1); }
  function step(d) { var j = curI + d; if (j >= 0 && j < curList.length) openStock(curList[j], curList, j); }
  function openStock(code, list, i) {
    var r = BY[code];
    if (!r) return;
    closeDlg();
    curList = list || [code]; curI = i === undefined ? 0 : i;
    var p = r.plan, label = list && list.length > 1;
    dlg = document.createElement('div');
    dlg.className = 'dlg'; dlg.setAttribute('role', 'dialog'); dlg.setAttribute('aria-label', r.n + ' ' + r.c);
    dlg.innerHTML = '<div class="dlg-box"><div class="dlg-h"> <h3>' + esc(r.n) + '</h3>' + (r.n === r.c ? '' : '<span class="code">' + esc(r.c) + '</span>') + '<b>' + price(r.p) + '</b><span class="' + cls(r.chg) + '">' + pct(r.chg) + '</span><button type="button" class="dlg-x" aria-label="关闭">×</button></div>' +
      (label ? '<div class="nav"><button type="button" data-s="-1"' + (curI <= 0 ? ' disabled' : '') + ' aria-label="上一支">‹</button><span>' + (curI + 1) + ' / ' + curList.length + '</span><button type="button" data-s="1"' + (curI >= curList.length - 1 ? ' disabled' : '') + ' aria-label="下一支">›</button></div>' : '') +
      '<dl class="kv"><div><dt>成交量</dt><dd>' + compact(r.v) + '</dd></div><div><dt>量比</dt><dd>' + (r.rv === null ? '—' : r.rv.toFixed(1) + '×') + '</dd></div><div><dt>成交额</dt><dd>' + D.cur + ' ' + compact(r.t) + '</dd></div><div><dt>日期</dt><dd>' + esc((r.d || '').slice(5)) + '</dd></div></dl>' +
      (p ? '<div class="plan"><div class="r"><span title="进场">进 <b>' + price(p.entry) + '</b></span><span title="风险线">损 <b class="down">' + price(p.stop) + '</b> <small>−' + p.risk.toFixed(1) + '%</small></span><span title="目标">标 <b class="up">' + price(p.target) + '</b></span><span title="报酬风险比 = (目标 − 进场) ÷ (进场 − 风险线)">R <b>' + p.rr.toFixed(1) + '</b></span></div></div>' : '') +
      '<div id="chart"><p class="hint">图表载入中…</p></div></div>';
    document.body.appendChild(dlg);
    dlg.addEventListener('click', function (e) {
      if (e.target === dlg || e.target.closest('.dlg-x')) { closeDlg(); return; }
      var s = e.target.closest('[data-s]'); if (s) step(+s.dataset.s);
    });
    document.addEventListener('keydown', onKey);
    (BARS ? Promise.resolve(BARS) : load('bars.json').then(function (b) { BARS = b; return b; })).then(function (b) {
      var data = b[code], el = document.getElementById('chart');
      if (!el || !dlg) return;
      if (!data || !window.LightweightCharts) { el.innerHTML = '<p class="hint">没有K线数据</p>'; return; }
      el.innerHTML = '';
      var st = getComputedStyle(document.documentElement), L = window.LightweightCharts, up = st.getPropertyValue('--up').trim(), dn = st.getPropertyValue('--down').trim();
      chart = L.createChart(el, { width: el.clientWidth, height: 320, layout: { fontFamily: getComputedStyle(document.body).fontFamily, background: { color: 'transparent' }, textColor: st.getPropertyValue('--text-secondary').trim(), attributionLogo: false },
        grid: { vertLines: { visible: false }, horzLines: { color: st.getPropertyValue('--gridline').trim() } }, rightPriceScale: { borderVisible: false }, timeScale: { borderVisible: false } });
      var c = chart.addSeries(L.CandlestickSeries, { upColor: 'transparent', borderUpColor: up, wickUpColor: up, downColor: dn, borderDownColor: dn, wickDownColor: dn, priceFormat: { type: 'price', precision: 3, minMove: 0.001 } });
      c.setData(data.map(function (x) { return { time: x[0], open: x[1] / 1000, high: x[2] / 1000, low: x[3] / 1000, close: x[4] / 1000 }; }));
      var v = chart.addSeries(L.HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'vol', lastValueVisible: false, priceLineVisible: false });
      chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
      v.setData(data.map(function (x) { return { time: x[0], value: x[5], color: x[4] >= x[1] ? up + '66' : dn + '66' }; }));
      if (p) [['进场', p.entry, st.getPropertyValue('--accent').trim()], ['风险线', p.stop, dn], ['目标', p.target, up]].forEach(function (l) { c.createPriceLine({ price: l[1], color: l[2], lineStyle: 2, lineWidth: 1, axisLabelVisible: true, title: l[0] }); });
      chart.timeScale().fitContent();
    }).catch(function (e) { var el = document.getElementById('chart'); if (el) el.innerHTML = '<p class="hint">图表载入失败：' + esc(e.message) + '</p>'; });
  }

  // ---------- 页面 ----------
  function render() {
    var sig = D.stocks.filter(function (r) { return r.sig; }).map(function (r) { return r.c; });
    document.getElementById('updated').innerHTML = '更新时间 ' + esc(D.updated) + '<span class="badge' + (D.state === 'live' ? ' live' : '') + '">' + (D.state === 'live' ? '盘中' : D.state === 'pre' ? '开市前' : '已收盘') + '</span>';
    app.innerHTML = marketHtml() + listHtml('强势股', D.strong, 'strong', '') +
      listHtml('今日机会', sig, 'sig', D.state === 'live' ? '盘中' : '') + '<div id="tbl"></div>';
    drawTable();
    app.addEventListener('click', function (e) {
      var th = e.target.closest('th[data-k]'), f = e.target.closest('[data-f]'), more = e.target.closest('.more'), tr = e.target.closest('[data-code]');
      if (th) { var k = th.dataset.k; T.dir = T.sort === k ? -T.dir : (k === 'n' ? 1 : -1); T.sort = k; drawTable(); return; }
      if (f) { T.f[f.dataset.f] = !T.f[f.dataset.f]; T.shown = 50; drawTable(); return; }
      if (more) { T.shown += 50; drawTable(); return; }
      if (tr) {
        var ol = tr.closest('[data-list]'), list;
        if (ol) list = [].map.call(ol.querySelectorAll('[data-code]'), function (x) { return x.dataset.code; });
        else if (tr.closest('table')) list = tableRows().map(function (r) { return r.c; });
        else list = [tr.dataset.code];
        openStock(tr.dataset.code, list, list.indexOf(tr.dataset.code));
      }
    });
    app.addEventListener('input', function (e) { if (e.target.id === 'q') { T.q = e.target.value; T.shown = 50; drawTable(); } });
  }
  load('data.json').then(function (d) {
    D = d; d.stocks.forEach(function (r) { BY[r.c] = r; });
    document.title = d.title;
    render();
    var m = /^#s=([^&]+)$/.exec(location.hash); if (m) openStock(decodeURIComponent(m[1]));
  }).catch(function (e) { app.innerHTML = '<p class="hint">载入失败：' + esc(e.message) + '</p>'; });
})();
