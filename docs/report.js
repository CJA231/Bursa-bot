/*!
 * Bursa Bot 报告页脚本 (马股 docs/index.html、美股 docs/us/index.html 共用)
 * 筛选器: 自定义选股条件 (模板里的条件在报告全部股票里筛) + 后台信号卡片轮播、
 * 全局工具栏 (周期 / 图表类型 / 指标 / 模板 / 设置)、主图/副图指标与可调参数、图表左上角图例、模板，
 * 左上角 ☰ 导航 (工具、自选、下载)，"其余股票"表格的排序 / 快速筛选、完整图表 + 财报 + 公告 + 新闻、底部搜索栏，
 * 股票计算器、名词解释、选股条件回测、公告栏，以及返回手势 / #s=代码 深链接。
 * 依赖 vendor/lightweight-charts.js (TradingView Lightweight Charts v5)。
 * 版权所有 CJA231，保留一切权利。
 */
(function () {
  'use strict';

  var LWC = window.LightweightCharts;
  var dataEl = document.getElementById('chart-data');
  var data = dataEl ? JSON.parse(dataEl.textContent) : {};
  var charts = {}; // chartId -> 图表状态，见 renderChart()

  // 马股 / 美股两个页面共用这份脚本，市场差异全部来自 <body> 的 data-* 属性 (main.py 生成)
  var MARKET = (function () {
    var d = document.body.dataset;
    function int(v, fallback) { var n = parseInt(v, 10); return isFinite(n) ? n : fallback; }
    return {
      id: d.market || 'MY',
      sessionStart: int(d.sessionStart, 9 * 60), // 开市时间 (当地时间距午夜几分钟)：马股 9:00，美股 9:30
      priceDp: int(d.priceDp, 3),                 // 价格小数位：马股 3 位，美股 2 位
      searchHint: d.searchHint || '例如 CYPARK / 5184'
    };
  })();
  // main.py 放在页面里的每支股票基本资料 (市值、市盈率、股息率、52 周高低、成交额、ATR、SAR…)，
  // 加上一手几股、美元汇率、回测摘要；旧版页面没有这一段 → 空的，用到的地方自己跳过
  var META = (function () {
    var el = document.getElementById('report-meta');
    try { return el ? JSON.parse(el.textContent) : null; } catch (e) { return null; }
  })() || {};
  if (!META.stocks) META.stocks = {};
  var LOT = META.lot || (MARKET.id === 'US' ? 1 : 100);
  var CUR_SYM = META.sym || (MARKET.id === 'US' ? 'US$' : 'RM');

  // ---------- 小工具 ----------
  // localStorage 在隐私模式/被禁用时读写会抛错，一律当成"没有存过"
  function loadJSON(key, fallback) {
    try {
      var v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch (e) { return fallback; }
  }
  function saveJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  }
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function newId(prefix) { return prefix + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7); }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function fmtValue(v) {
    if (!isNum(v)) return '—';
    var a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    if (a >= 1e4) return (v / 1e3).toFixed(1) + 'K';
    if (a >= 100) return v.toFixed(2);
    if (a > 0 && a < 0.01) return v.toFixed(4);
    return v.toFixed(3);
  }
  // 价格小数位按市场 (马股 3 位，Bursa 最小跳动 0.005；美股 2 位)，100 以上最多 2 位
  function fmtPrice(v) {
    if (!isNum(v)) return '—';
    return v.toFixed(Math.abs(v) >= 100 ? Math.min(2, MARKET.priceDp) : MARKET.priceDp);
  }
  function fmtVolume(v) {
    if (!isNum(v)) return '—';
    if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
    return String(v);
  }
  // 大数字最多 3 位有效数字 (81.1M、425M、5.72M)，跟 main.py 的 fmt_compact 一样
  function fmtCompact(v) {
    if (!isNum(v)) return '—';
    var units = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
    for (var i = 0; i < units.length; i++) {
      if (Math.abs(v) >= units[i][0]) {
        var x = v / units[i][0];
        return (x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2)) + units[i][1];
      }
    }
    return v.toFixed(0);
  }
  function fmtPct(v, digits, plus) {
    if (!isNum(v)) return '—';
    return (plus !== false && v > 0 ? '+' : '') + v.toFixed(digits === undefined ? 1 : digits) + '%';
  }
  function fmtMoney2(v) { // 金额到仙 / 分: 1,234.56
    if (!isNum(v)) return '—';
    return (v < 0 ? '-' : '') + Math.abs(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  // ---------- 返回键 / 返回手势: 先关对话框 (或 ☰ 导航)，不要直接离开整个页面 ----------
  // 每打开一层就 history.pushState 一格；按返回 → popstate → 关掉比那一格新的层。
  // 用 × / Esc / 点遮罩关的时候自己 history.back() 把那一格退掉 (不然要多按一次返回才离开页面)。
  // history.back() 是异步的：退格还没完成就马上又开一层 (例如关掉导航接着打开计算器) 的话，新的那一格等退完再 push，
  // 不然会被那次 back 退掉，之后按返回的次数就对不上了
  var histSeq = 0, histLayers = [], skipPop = 0, pendingPush = [];
  function doPush(layer) {
    try { history.pushState({ bbLayer: layer.id }, '', layer.url || location.href); layer.pushed = true; } catch (e) { /* 不支持就算了 */ }
  }
  function pushLayer(close, url) {
    var layer = { id: ++histSeq, close: close, url: url };
    histLayers.push(layer);
    if (skipPop) pendingPush.push(layer); else doPush(layer);
    return layer;
  }
  function releaseLayer(layer) {
    var i = layer ? histLayers.indexOf(layer) : -1;
    if (i === -1) return;
    histLayers.splice(i, 1);
    var q = pendingPush.indexOf(layer);
    if (q !== -1) { pendingPush.splice(q, 1); return; }
    if (layer.pushed && history.state && history.state.bbLayer === layer.id) { skipPop++; history.back(); }
  }
  function retargetLayer(layer, url) { // 同一格换成另一支股票 (上一支 / 下一支)
    layer.url = url;
    if (layer.pushed && history.state && history.state.bbLayer === layer.id) {
      try { history.replaceState({ bbLayer: layer.id }, '', url || location.href); } catch (e) { /* 忽略 */ }
    }
  }
  window.addEventListener('popstate', function (e) {
    if (skipPop) {
      skipPop--;
      if (!skipPop) { var q = pendingPush; pendingPush = []; q.forEach(doPush); }
      return;
    }
    var cur = (e.state && e.state.bbLayer) || 0;
    for (var i = histLayers.length - 1; i >= 0; i--) {
      var layer = histLayers[i];
      if (layer.id > cur) { histLayers.splice(i, 1); layer.close(true); }
    }
  });
  function stripHash() {
    if (!location.hash) return;
    try { history.replaceState(history.state, '', location.pathname + location.search); } catch (e) { /* 忽略 */ }
  }

  // ---------- 颜色: 读取/应用/持久化 ----------
  var COLOR_KEYS = ['up', 'down', 'ema'];
  var COLOR_STORAGE_KEY = 'bursa_colors_v1';

  function saveColors() {
    var toSave = {};
    COLOR_KEYS.forEach(function (k) {
      var v = document.documentElement.style.getPropertyValue('--' + k);
      if (v) toSave[k] = v.trim();
    });
    saveJSON(COLOR_STORAGE_KEY, toSave);
  }
  // 一加载就把上次保存的颜色套回 CSS 变量，第一次画图就是对的颜色，不会先画默认色再闪一下
  (function applySavedColors() {
    var saved = loadJSON(COLOR_STORAGE_KEY, {});
    COLOR_KEYS.forEach(function (k) {
      if (saved[k]) document.documentElement.style.setProperty('--' + k, saved[k]);
    });
  })();

  function computeColors() {
    var st = getComputedStyle(document.documentElement);
    return {
      text: st.getPropertyValue('--text-secondary').trim(),
      grid: st.getPropertyValue('--gridline').trim(),
      up: st.getPropertyValue('--up').trim(),
      down: st.getPropertyValue('--down').trim(),
      ema: st.getPropertyValue('--ema').trim()
    };
  }
  var colors = computeColors();

  // ---------- 公式引擎 (自定义指标): 序列函数 + 递归下降解析器 ----------
  function isArr(v) { return Array.isArray(v); }

  // 两个操作数做逐点运算，任一操作数是数组就按数组逐点算 (标量会自动广播)，null 值会一路传播下去
  function ew(a, b, fn) {
    if (isArr(a) && isArr(b)) {
      return a.map(function (v, i) {
        var w = b[i];
        return (v === null || v === undefined || w === null || w === undefined || isNaN(v) || isNaN(w)) ? null : fn(v, w);
      });
    }
    if (isArr(a)) return a.map(function (v) { return (v === null || v === undefined || isNaN(v)) ? null : fn(v, b); });
    if (isArr(b)) return b.map(function (w) { return (w === null || w === undefined || isNaN(w)) ? null : fn(a, w); });
    return fn(a, b);
  }

  function seriesSMA(arr, n) {
    var out = new Array(arr.length).fill(null);
    for (var i = 0; i < arr.length; i++) {
      if (i < n - 1) continue;
      var sum = 0, ok = true;
      for (var j = i - n + 1; j <= i; j++) {
        if (arr[j] === null || arr[j] === undefined || isNaN(arr[j])) { ok = false; break; }
        sum += arr[j];
      }
      out[i] = ok ? sum / n : null;
    }
    return out;
  }
  // 跟后台 pandas_ta 的 ema 一样 (presma): 先攒够 n 根，第 n 根 = 这 n 根的简单平均，之后才按 EMA 递推；
  // 不够 n 根的地方是 null (新上市的股票 EMA20 要 20 天才有，跟表格里显示"—"一致)
  function seriesEMA(arr, n) {
    var k = 2 / (n + 1);
    var out = new Array(arr.length).fill(null);
    var prev = null, seed = [];
    for (var i = 0; i < arr.length; i++) {
      var v = arr[i];
      if (v === null || v === undefined || isNaN(v)) { prev = null; seed = []; continue; }
      if (prev === null) {
        seed.push(v);
        if (seed.length < n) continue;
        prev = seed.reduce(function (a, b) { return a + b; }, 0) / n;
        seed = [];
      } else {
        prev = v * k + prev * (1 - k);
      }
      out[i] = prev;
    }
    return out;
  }
  function seriesStdev(arr, n) {
    var sma = seriesSMA(arr, n);
    var out = new Array(arr.length).fill(null);
    for (var i = 0; i < arr.length; i++) {
      if (sma[i] === null) continue;
      var sumSq = 0, ok = true;
      for (var j = i - n + 1; j <= i; j++) {
        if (arr[j] === null || arr[j] === undefined || isNaN(arr[j])) { ok = false; break; }
        sumSq += Math.pow(arr[j] - sma[i], 2);
      }
      out[i] = ok ? Math.sqrt(sumSq / n) : null;
    }
    return out;
  }
  function seriesExtreme(arr, n, better) {
    var out = new Array(arr.length).fill(null);
    for (var i = 0; i < arr.length; i++) {
      if (i < n - 1) continue;
      var slice = arr.slice(i - n + 1, i + 1);
      if (slice.some(function (v) { return v === null || v === undefined || isNaN(v); })) continue;
      out[i] = better.apply(null, slice);
    }
    return out;
  }
  function seriesSum(arr, n) {
    var out = new Array(arr.length).fill(null);
    for (var i = 0; i < arr.length; i++) {
      if (i < n - 1) continue;
      var s = 0, ok = true;
      for (var j = i - n + 1; j <= i; j++) {
        if (arr[j] === null || arr[j] === undefined || isNaN(arr[j])) { ok = false; break; }
        s += arr[j];
      }
      out[i] = ok ? s : null;
    }
    return out;
  }
  // Wilder 平滑的 RSI (跟 pandas_ta 后台算策略用的那套是同一种平滑方式，不是简单 EMA)
  function seriesRSI(closeArr, n) {
    var out = new Array(closeArr.length).fill(null);
    if (closeArr.length <= n) return out;
    var gains = [], losses = [];
    for (var i = 1; i < closeArr.length; i++) {
      var c0 = closeArr[i - 1], c1 = closeArr[i];
      if (c0 === null || c1 === null || c0 === undefined || c1 === undefined || isNaN(c0) || isNaN(c1)) {
        gains.push(null); losses.push(null); continue;
      }
      var change = c1 - c0;
      gains.push(change > 0 ? change : 0);
      losses.push(change < 0 ? -change : 0);
    }
    var avgGain = null, avgLoss = null;
    for (var idx = 0; idx < gains.length; idx++) {
      var barIndex = idx + 1;
      if (idx < n - 1) continue;
      if (idx === n - 1) {
        var sumG = 0, sumL = 0, ok = true;
        for (var j = 0; j < n; j++) {
          if (gains[j] === null) { ok = false; break; }
          sumG += gains[j]; sumL += losses[j];
        }
        if (!ok) continue;
        avgGain = sumG / n;
        avgLoss = sumL / n;
      } else {
        if (gains[idx] === null || avgGain === null) { avgGain = null; avgLoss = null; continue; }
        avgGain = (avgGain * (n - 1) + gains[idx]) / n;
        avgLoss = (avgLoss * (n - 1) + losses[idx]) / n;
      }
      if (avgGain === null) continue;
      out[barIndex] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
    return out;
  }
  // ATR: 真实波幅 (Wilder 平滑)，需要用到前一天收盘价，所以直接用 ctx 里的 high/low/close，不走 arrayArg
  function seriesATR(ctx, n) {
    var high = ctx.series.high, low = ctx.series.low, close = ctx.series.close;
    var tr = new Array(high.length).fill(null);
    for (var i = 0; i < high.length; i++) {
      if (i === 0) { tr[i] = high[i] - low[i]; continue; }
      var pc = close[i - 1];
      if (pc === null || pc === undefined || isNaN(pc)) { tr[i] = high[i] - low[i]; continue; }
      tr[i] = Math.max(high[i] - low[i], Math.abs(high[i] - pc), Math.abs(low[i] - pc));
    }
    var out = new Array(tr.length).fill(null);
    var avg = null;
    for (var i = 0; i < tr.length; i++) {
      if (i < n - 1) continue;
      if (i === n - 1) {
        var sum = 0;
        for (var j = i - n + 1; j <= i; j++) sum += tr[j];
        avg = sum / n;
      } else {
        avg = (avg * (n - 1) + tr[i]) / n;
      }
      out[i] = avg;
    }
    return out;
  }
  // OBV: 累积能量潮，跟 ATR 一样直接吃 ctx 里的 close/volume
  function seriesOBV(ctx) {
    var close = ctx.series.close, volume = ctx.series.volume;
    var out = new Array(close.length).fill(null);
    var cum = 0;
    for (var i = 0; i < close.length; i++) {
      if (i === 0) { out[i] = 0; continue; }
      if (close[i] > close[i - 1]) cum += volume[i];
      else if (close[i] < close[i - 1]) cum -= volume[i];
      out[i] = cum;
    }
    return out;
  }

  // ref(x, n): n 根K线之前的值 (ref(close,1) = 昨收)
  function seriesRef(arr, n) {
    return arr.map(function (_, i) {
      var v = i - n >= 0 ? arr[i - n] : null;
      return v === undefined || v === null || isNaN(v) ? null : v;
    });
  }
  // crossup(a, b) / crossdown(a, b): 这一根 a 在 b 上方 (下方)、上一根还没有 → 1，否则 0；数据不够 → null
  function seriesCross(a, b, up) {
    var n = isArr(a) ? a.length : b.length;
    function at(x, i) { var v = isArr(x) ? x[i] : x; return v === null || v === undefined || isNaN(v) ? null : v; }
    var out = new Array(n).fill(null);
    for (var i = 1; i < n; i++) {
      var a0 = at(a, i - 1), b0 = at(b, i - 1), a1 = at(a, i), b1 = at(b, i);
      if (a0 === null || b0 === null || a1 === null || b1 === null) continue;
      out[i] = (up ? a1 > b1 && a0 <= b0 : a1 < b1 && a0 >= b0) ? 1 : 0;
    }
    return out;
  }
  // T3 形态，逐根K线判断，跟 main.py 的 detect_t3_pattern 同一个定义 (改的话两边一起改):
  // T1 = 2~5 根之前，T1 的成交量 > T1 之前 20 根的平均量；T1 之后到昨天的最高价都没碰到 T1 的最高价 (纯回调)；
  // 今天收盘价突破 T1 的最高价 → 1。前面不到 26 根K线算不了 → null (后台当成不成立)
  function seriesT3(ctx) {
    var high = ctx.series.high, close = ctx.series.close, vol = ctx.series.volume, n = close.length;
    var out = new Array(n).fill(null);
    function num(v) { return v !== null && v !== undefined && !isNaN(v); }
    for (var i = 25; i < n; i++) {
      var hit = 0;
      for (var off = 2; off <= 5 && !hit; off++) {
        var t1 = i - off;
        if (t1 < 20) continue;
        var sum = 0, ok = num(vol[t1]);
        for (var j = t1 - 20; j < t1 && ok; j++) { if (num(vol[j])) sum += vol[j]; else ok = false; }
        if (!ok || !(vol[t1] > sum / 20)) continue;
        var h1 = high[t1], broke = false;
        for (var k = t1 + 1; k < i; k++) if (high[k] >= h1) { broke = true; break; }
        if (!broke && close[i] > h1) hit = 1;
      }
      out[i] = hit;
    }
    return out;
  }
  // 条件运算的结果是逐根的 1 / 0；数据不够 (null) 时: and 只要有一边是 0 就是 0，or 只要有一边是 1 就是 1，其余 null
  function truthOf(v) { return v === null || v === undefined || isNaN(v) ? null : v !== 0; }
  function logicOp(a, b, isAnd) {
    function one(x, y) {
      var p = truthOf(x), q = truthOf(y);
      if (isAnd) return p === false || q === false ? 0 : p === null || q === null ? null : 1;
      return p === true || q === true ? 1 : p === null || q === null ? null : 0;
    }
    if (!isArr(a) && !isArr(b)) return one(a, b);
    var n = isArr(a) ? a.length : b.length, out = new Array(n);
    for (var i = 0; i < n; i++) out[i] = one(isArr(a) ? a[i] : a, isArr(b) ? b[i] : b);
    return out;
  }
  function logicNot(a) {
    function one(x) { var p = truthOf(x); return p === null ? null : p ? 0 : 1; }
    return isArr(a) ? a.map(one) : one(a);
  }
  var COMPARE = {
    '>': function (a, b) { return a > b ? 1 : 0; }, '<': function (a, b) { return a < b ? 1 : 0; },
    '>=': function (a, b) { return a >= b ? 1 : 0; }, '<=': function (a, b) { return a <= b ? 1 : 0; },
    '==': function (a, b) { return a === b ? 1 : 0; }, '!=': function (a, b) { return a !== b ? 1 : 0; }
  };
  var FORMULA_VARS = 'close open high low volume';
  var FORMULA_FUNCS = 'sma ema stdev highest lowest sum rsi atr obv abs ref max min round crossup crossdown psar supertrend t3';

  // 优先级 (低 → 高): or → and → not → 比较 (> < >= <= == !=) → + - → * / → 负号 → ^
  function evalFormula(formula, ctx) {
    var s = formula;
    var pos = 0;

    function skipSpace() { while (pos < s.length && /\s/.test(s[pos])) pos++; }
    function consume(ch) {
      skipSpace();
      if (s[pos] !== ch) throw new Error('语法错误，期望 "' + ch + '"，但看到 "' + (s[pos] || '(末尾)') + '"');
      pos++;
    }
    // 关键字 (and / or / not) 要是一个完整的单词，closeX 这种变量名不算
    function peekWord(w) {
      skipSpace();
      if (s.substr(pos, w.length).toLowerCase() !== w) return false;
      var next = s[pos + w.length];
      return next === undefined || !/[a-zA-Z_0-9]/.test(next);
    }
    function parseNumber() {
      skipSpace();
      var start = pos;
      while (pos < s.length && /[0-9.]/.test(s[pos])) pos++;
      if (pos === start) throw new Error('无效的数字');
      var v = parseFloat(s.slice(start, pos));
      if (isNaN(v)) throw new Error('无效的数字: ' + s.slice(start, pos));
      return v;
    }
    function parseIdent() {
      skipSpace();
      var start = pos;
      while (pos < s.length && /[a-zA-Z_0-9]/.test(s[pos])) pos++;
      if (pos === start) throw new Error('无效的名称');
      return s.slice(start, pos);
    }
    function lookupSeries(name) {
      var key = name.toLowerCase();
      if (ctx.series.hasOwnProperty(key)) return ctx.series[key];
      throw new Error('未知变量: ' + name + ' (可用: ' + FORMULA_VARS + ')');
    }
    function requireArgs(name, args, count) {
      if (args.length !== count) throw new Error(name + '() 需要 ' + count + ' 个参数，实际给了 ' + args.length + ' 个');
    }
    function arrayArg(v, label) {
      if (!isArr(v)) throw new Error(label + ' 必须是一条时间序列 (例如 close)，不能是单个数字');
      return v;
    }
    function periodArg(v, label) {
      if (isArr(v)) throw new Error(label + ' 必须是一个数字');
      if (typeof v !== 'number' || isNaN(v) || v <= 0) throw new Error(label + ' 必须是大于 0 的数字');
      return Math.round(v);
    }
    function numberArg(v, label) {
      if (isArr(v) || typeof v !== 'number' || isNaN(v) || v <= 0) throw new Error(label + ' 必须是大于 0 的数字');
      return v;
    }
    function callFunction(name, args) {
      switch (name) {
        case 'sma': requireArgs('sma', args, 2); return seriesSMA(arrayArg(args[0], 'sma 的第一个参数'), periodArg(args[1], 'sma 的周期'));
        case 'ema': requireArgs('ema', args, 2); return seriesEMA(arrayArg(args[0], 'ema 的第一个参数'), periodArg(args[1], 'ema 的周期'));
        case 'stdev': requireArgs('stdev', args, 2); return seriesStdev(arrayArg(args[0], 'stdev 的第一个参数'), periodArg(args[1], 'stdev 的周期'));
        case 'highest': requireArgs('highest', args, 2); return seriesExtreme(arrayArg(args[0], 'highest 的第一个参数'), periodArg(args[1], 'highest 的周期'), Math.max);
        case 'lowest': requireArgs('lowest', args, 2); return seriesExtreme(arrayArg(args[0], 'lowest 的第一个参数'), periodArg(args[1], 'lowest 的周期'), Math.min);
        case 'sum': requireArgs('sum', args, 2); return seriesSum(arrayArg(args[0], 'sum 的第一个参数'), periodArg(args[1], 'sum 的周期'));
        case 'rsi': requireArgs('rsi', args, 2); return seriesRSI(arrayArg(args[0], 'rsi 的第一个参数'), periodArg(args[1], 'rsi 的周期'));
        case 'atr': requireArgs('atr', args, 1); return seriesATR(ctx, periodArg(args[0], 'atr 的周期'));
        case 'obv': requireArgs('obv', args, 0); return seriesOBV(ctx);
        case 'abs':
          requireArgs('abs', args, 1);
          return isArr(args[0]) ? args[0].map(function (v) { return (v === null || v === undefined || isNaN(v)) ? null : Math.abs(v); }) : Math.abs(args[0]);
        case 'ref': requireArgs('ref', args, 2); return seriesRef(arrayArg(args[0], 'ref 的第一个参数'), periodArg(args[1], 'ref 往前几根'));
        case 'max': requireArgs('max', args, 2); return ew(args[0], args[1], Math.max);
        case 'min': requireArgs('min', args, 2); return ew(args[0], args[1], Math.min);
        case 'crossup':
        case 'crossdown':
          requireArgs(name, args, 2);
          if (!isArr(args[0]) && !isArr(args[1])) throw new Error(name + '() 至少有一边要是时间序列');
          return seriesCross(args[0], args[1], name === 'crossup');
        case 'psar':
          if (args.length !== 0 && args.length !== 2) throw new Error('psar() 不带参数 (0.02, 0.2)，或者 psar(加速因子, 最大值)');
          return seriesPSAR(ctx.series.high, ctx.series.low, ctx.series.close,
            args.length ? numberArg(args[0], 'psar 的加速因子') : 0.02, args.length ? numberArg(args[1], 'psar 的最大值') : 0.2);
        case 'supertrend':
          if (args.length !== 0 && args.length !== 2) throw new Error('supertrend() 不带参数 (10, 3)，或者 supertrend(ATR长度, 倍数)');
          return seriesSupertrend(ctx.bars, args.length ? numberArg(args[1], 'supertrend 的倍数') : 3,
            args.length ? periodArg(args[0], 'supertrend 的 ATR 长度') : 10).value;
        case 't3': requireArgs('t3', args, 0); return seriesT3(ctx);
        case 'round':
          if (args.length !== 1 && args.length !== 2) throw new Error('round() 要 1 或 2 个参数：round(x) 或 round(x, 小数位)');
          var dp = args.length === 2 ? args[1] : 0;
          if (isArr(dp) || !(dp >= 0 && dp <= 10) || dp !== Math.floor(dp)) throw new Error('round 的小数位必须是 0 到 10 的整数');
          function rnd(v) { return v === null || v === undefined || isNaN(v) ? null : Number(v.toFixed(dp)); }
          return isArr(args[0]) ? args[0].map(rnd) : rnd(args[0]);
        default:
          throw new Error('未知函数: ' + name + '() (可用: ' + FORMULA_FUNCS + ')');
      }
    }
    function parsePrimary() {
      skipSpace();
      var ch = s[pos];
      if (ch === '(') {
        pos++;
        var v = parseExpr();
        consume(')');
        return v;
      }
      if (ch !== undefined && /[0-9.]/.test(ch)) return parseNumber();
      if (ch !== undefined && /[a-zA-Z_]/.test(ch)) {
        var name = parseIdent();
        if (/^(and|or|not)$/i.test(name)) throw new Error('「' + name + '」前后要有条件，例如 close > open ' + name.toLowerCase() + ' volume > 1000000');
        skipSpace();
        if (s[pos] === '(') {
          pos++;
          var args = [];
          skipSpace();
          if (s[pos] !== ')') {
            args.push(parseExpr());
            skipSpace();
            while (s[pos] === ',') { pos++; args.push(parseExpr()); skipSpace(); }
          }
          consume(')');
          return callFunction(name.toLowerCase(), args);
        }
        return lookupSeries(name);
      }
      throw new Error('公式无法解析，看不懂这里: "' + (ch === undefined ? '(末尾)' : s.slice(pos)) + '"');
    }
    function parseUnary() {
      skipSpace();
      if (s[pos] === '-') {
        pos++;
        return ew(parseUnary(), -1, function (a, b) { return a * b; });
      }
      return parsePower();
    }
    function parsePower() {
      var base = parsePrimary();
      skipSpace();
      if (s[pos] === '^') {
        pos++;
        return ew(base, parseUnary(), Math.pow);
      }
      return base;
    }
    function parseTerm() {
      var v = parseUnary();
      skipSpace();
      while (s[pos] === '*' || s[pos] === '/') {
        var op = s[pos]; pos++;
        var rhs = parseUnary();
        v = ew(v, rhs, op === '*' ? function (a, b) { return a * b; } : function (a, b) { return a / b; });
        skipSpace();
      }
      return v;
    }
    function parseSum() {
      var v = parseTerm();
      skipSpace();
      while (s[pos] === '+' || s[pos] === '-') {
        var op = s[pos]; pos++;
        var rhs = parseTerm();
        v = ew(v, rhs, op === '+' ? function (a, b) { return a + b; } : function (a, b) { return a - b; });
        skipSpace();
      }
      return v;
    }
    function parseCompare() {
      var v = parseSum();
      skipSpace();
      var op = /^(>=|<=|==|!=|>|<)/.exec(s.slice(pos, pos + 2));
      if (!op) {
        if (s[pos] === '=') throw new Error('比较是否相等要写两个等号 ==');
        return v;
      }
      pos += op[1].length;
      return ew(v, parseSum(), COMPARE[op[1]]);
    }
    function parseNot() {
      skipSpace();
      if (peekWord('not')) { pos += 3; return logicNot(parseNot()); }
      if (s[pos] === '!' && s[pos + 1] !== '=') { pos++; return logicNot(parseNot()); }
      return parseCompare();
    }
    function parseAnd() {
      var v = parseNot();
      for (;;) {
        skipSpace();
        if (peekWord('and')) pos += 3;
        else if (s.substr(pos, 2) === '&&') pos += 2;
        else return v;
        v = logicOp(v, parseNot(), true);
      }
    }
    function parseExpr() { // or 的优先级最低
      var v = parseAnd();
      for (;;) {
        skipSpace();
        if (peekWord('or')) pos += 2;
        else if (s.substr(pos, 2) === '||') pos += 2;
        else return v;
        v = logicOp(v, parseAnd(), false);
      }
    }

    var result = parseExpr();
    skipSpace();
    if (pos !== s.length) throw new Error('公式末尾有多余内容: "' + s.slice(pos) + '"');
    return result;
  }

  function makeCtx(bars) {
    return {
      bars: bars,
      series: {
        close: bars.map(function (b) { return b.close; }),
        open: bars.map(function (b) { return b.open; }),
        high: bars.map(function (b) { return b.high; }),
        low: bars.map(function (b) { return b.low; }),
        volume: bars.map(function (b) { return b.volume; })
      }
    };
  }
  function formulaValues(bars, formula, ctx) {
    var result = evalFormula(formula, ctx || makeCtx(bars));
    if (!isArr(result)) throw new Error('公式结果必须是一条随时间变化的序列，不能只是一个固定数字');
    return result;
  }

  // Parabolic SAR，逐行照 pandas_ta 的 psar 移植 (后台判断"SAR多头"用的就是它)，图上的点跟策略判断完全一致。
  // 后台是 df.ta.psar()，这个写法不会把 close 传进去，所以第一根的 SAR 用最低价 (上升) / 最高价 (下降)，不是收盘价
  // (历史很短的新股才看得出差别；长的在第一次反转之后就完全一样)
  function seriesPSAR(high, low, close, af0, maxAf) {
    af0 = af0 || 0.02;
    maxAf = maxAf || 0.2;
    var m = high.length;
    var out = new Array(m).fill(null);
    if (m < 2) return out;
    // pandas_ta 的 _falling(): 前两根K线的 -DM > 0 就当成一开始是下跌趋势
    var up = high[1] - high[0], dn = low[0] - low[1];
    var falling = dn > up && dn > 0;
    var af = af0;
    var ep = falling ? low[0] : high[0];
    var sar = falling ? high[0] : low[0];
    for (var i = 1; i < m; i++) {
      sar = sar + af * (ep - sar);
      var reverse;
      if (falling) {
        reverse = high[i] > sar;
        if (low[i] < ep) { ep = low[i]; af = Math.min(af + af0, maxAf); }
        sar = Math.max(high[i - 1], sar);
      } else {
        reverse = low[i] < sar;
        if (high[i] > ep) { ep = high[i]; af = Math.min(af + af0, maxAf); }
        sar = Math.min(low[i - 1], sar);
      }
      if (reverse) {
        sar = ep;
        af = af0;
        falling = !falling;
        ep = falling ? low[i] : high[i];
      }
      out[i] = sar;
    }
    return out;
  }

  // ---------- K线周期 ----------
  // base = 用后台哪一份数据合成 (见 main.py 的 CHART_SOURCES)；mins = 日内K线的分钟数
  var TIMEFRAMES = [
    { id: '1m', label: '1分', base: '1m', baseMins: 1, mins: 1 },
    { id: '5m', label: '5分', base: '5m', baseMins: 5, mins: 5 },
    { id: '10m', label: '10分', base: '5m', baseMins: 5, mins: 10 },
    { id: '15m', label: '15分', base: '15m', baseMins: 15, mins: 15 },
    { id: '30m', label: '30分', base: '15m', baseMins: 15, mins: 30 },
    { id: '45m', label: '45分', base: '15m', baseMins: 15, mins: 45 },
    { id: '1h', label: '1小时', base: '60m', baseMins: 60, mins: 60 },
    { id: '2h', label: '2小时', base: '60m', baseMins: 60, mins: 120 },
    { id: '4h', label: '4小时', base: '60m', baseMins: 60, mins: 240 },
    { id: 'D', label: '天', base: '1d' },
    { id: 'W', label: '周', base: '1d', group: 'week' },
    { id: 'M', label: '月', base: '1mo' }
  ];
  var TF_STORAGE_KEY = 'bursa_timeframe_v1';
  var DAY = 86400;
  var SESSION_START_MIN = MARKET.sessionStart; // 日内K线从开市时间 (马股 9:00、美股 9:30) 开始对齐分组 (跟 TradingView 一样)
  var VISIBLE_BARS = 120;          // 切换周期后默认显示最近多少根，往左拖可以看更早的

  function tfById(id) {
    for (var i = 0; i < TIMEFRAMES.length; i++) if (TIMEFRAMES[i].id === id) return TIMEFRAMES[i];
    return null;
  }
  function isIntraday(tf) { return !!tf.mins; }
  function hasTf(chartId, tf) {
    var raw = data[chartId].bars[tf.base];
    return !!(raw && raw.t && raw.t.length);
  }

  // 把连续的K线按 keyOf 分组合并成更大周期 (开=第一根开，高/低=最高/最低，收=最后一根收，量=相加)
  function aggregate(bars, keyOf) {
    var out = [], cur = null, curKey = null;
    bars.forEach(function (b) {
      var k = keyOf(b.time);
      if (cur && k === curKey) {
        cur.high = Math.max(cur.high, b.high);
        cur.low = Math.min(cur.low, b.low);
        cur.close = b.close;
        cur.volume += b.volume;
      } else {
        cur = { time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume };
        curKey = k;
        out.push(cur);
      }
    });
    return out;
  }
  function barsFor(chartId, tf) {
    var raw = data[chartId].bars[tf.base];
    if (!raw || !raw.t || !raw.t.length) return null;
    var bars = raw.t.map(function (t, i) {
      return { time: t, open: raw.o[i], high: raw.h[i], low: raw.l[i], close: raw.c[i], volume: raw.v[i] };
    });
    if (tf.group === 'week') {
      // 1970-01-01 是星期四，(天数 + 3) % 7 = 离星期一过了几天
      return aggregate(bars, function (t) { var d = Math.floor(t / DAY); return d - (d + 3) % 7; });
    }
    if (tf.mins && tf.mins > tf.baseMins) {
      // 日内时间戳已经是"交易所当地时间当成 UTC"，所以 t % DAY 就是当地的钟点
      return aggregate(bars, function (t) {
        var minutes = Math.floor((t % DAY) / 60) - SESSION_START_MIN;
        return Math.floor(t / DAY) + ':' + Math.floor(minutes / tf.mins);
      });
    }
    return bars;
  }
  function fmtTime(t, tf) {
    var iso = new Date(t * 1000).toISOString();
    if (tf.id === 'M') return iso.slice(0, 7);
    if (isIntraday(tf)) return iso.slice(0, 10) + ' ' + iso.slice(11, 16);
    return iso.slice(0, 10);
  }
  // 一目均衡表的先行带要往未来多画 25 根，这里按周期往后排时间 (日线跳过周末，不扣公共假期)
  function futureTimes(lastTime, count, tf) {
    var out = [], t = lastTime;
    for (var i = 0; i < count; i++) {
      if (tf.id === 'M') {
        var d = new Date(t * 1000);
        t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000;
      } else if (tf.id === 'W') {
        t += 7 * DAY;
      } else if (tf.id === 'D') {
        do { t += DAY; } while ([0, 6].indexOf((Math.floor(t / DAY) + 4) % 7) !== -1);
      } else {
        t += tf.mins * 60;
      }
      out.push(t);
    }
    return out;
  }

  // ---------- 一目均衡表 (Ichimoku Cloud)，按 TradingView 内置 Pine 脚本的算法 ----------
  var CLOUD_UP = 'rgba(67, 160, 71, 0.22)';   // 先行带 A 在 B 上方
  var CLOUD_DOWN = 'rgba(244, 67, 54, 0.22)'; // 先行带 A 在 B 下方

  function ichimokuSeries(bars, tf, p) {
    var high = bars.map(function (b) { return b.high; });
    var low = bars.map(function (b) { return b.low; });
    function donchian(n) {
      var hh = seriesExtreme(high, n, Math.max), ll = seriesExtreme(low, n, Math.min);
      return hh.map(function (h, i) { return h === null || ll[i] === null ? null : (h + ll[i]) / 2; });
    }
    var conversion = donchian(p.conversion);
    var base = donchian(p.base);
    var leadA = conversion.map(function (c, i) { return c === null || base[i] === null ? null : (c + base[i]) / 2; });
    var leadB = donchian(p.spanB);
    var shift = p.displacement - 1; // Pine: offset = displacement - 1
    var times = bars.map(function (b) { return b.time; });
    var allTimes = bars.length ? times.concat(futureTimes(times[times.length - 1], shift, tf)) : [];
    function points(values, offset) {
      var out = [];
      values.forEach(function (v, i) {
        var j = i + offset;
        if (v !== null && j >= 0 && j < allTimes.length) out.push({ time: allTimes[j], value: v });
      });
      return out;
    }
    return {
      conversion: points(conversion, 0),
      base: points(base, 0),
      lagging: points(bars.map(function (b) { return b.close; }), -shift),
      leadA: points(leadA, shift),
      leadB: points(leadB, shift)
    };
  }

  // 图表库没有"两条线之间填色"，用 series primitive 直接在画布上画多边形；
  // 两条线交叉的那一段按交点切成两个三角形，颜色在交叉点准确切换 (跟 TradingView 一样)
  function CloudPrimitive(leadA, leadB) {
    var bByTime = {};
    leadB.forEach(function (p) { bByTime[p.time] = p.value; });
    this._pairs = leadA.filter(function (p) { return p.time in bByTime; })
      .map(function (p) { return { time: p.time, a: p.value, b: bByTime[p.time] }; });
    this._chart = null;
    this._series = null;
    var self = this;
    this._paneView = {
      zOrder: function () { return 'bottom'; },
      renderer: function () { return { draw: function (target) { self._draw(target); } }; }
    };
  }
  CloudPrimitive.prototype.attached = function (param) { this._chart = param.chart; this._series = param.series; };
  CloudPrimitive.prototype.detached = function () { this._chart = null; this._series = null; };
  CloudPrimitive.prototype.updateAllViews = function () {};
  CloudPrimitive.prototype.paneViews = function () { return [this._paneView]; };
  CloudPrimitive.prototype._draw = function (target) {
    if (!this._chart) return;
    var timeScale = this._chart.timeScale(), series = this._series, pts = [];
    this._pairs.forEach(function (p) {
      var x = timeScale.timeToCoordinate(p.time);
      var ya = series.priceToCoordinate(p.a), yb = series.priceToCoordinate(p.b);
      if (x !== null && ya !== null && yb !== null) pts.push({ x: x, ya: ya, yb: yb, d: p.a - p.b });
    });
    function poly(ctx, corners, color) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(corners[0][0], corners[0][1]);
      for (var k = 1; k < corners.length; k++) ctx.lineTo(corners[k][0], corners[k][1]);
      ctx.closePath();
      ctx.fill();
    }
    target.useMediaCoordinateSpace(function (scope) {
      var ctx = scope.context;
      for (var i = 0; i + 1 < pts.length; i++) {
        var p = pts[i], q = pts[i + 1];
        if (p.d * q.d < 0) {
          var t = p.d / (p.d - q.d);
          var cx = p.x + (q.x - p.x) * t, cy = p.ya + (q.ya - p.ya) * t;
          poly(ctx, [[p.x, p.ya], [cx, cy], [p.x, p.yb]], p.d > 0 ? CLOUD_UP : CLOUD_DOWN);
          poly(ctx, [[cx, cy], [q.x, q.ya], [q.x, q.yb]], q.d > 0 ? CLOUD_UP : CLOUD_DOWN);
        } else {
          var up = p.d !== 0 ? p.d > 0 : q.d > 0;
          poly(ctx, [[p.x, p.ya], [q.x, q.ya], [q.x, q.yb], [p.x, p.yb]], up ? CLOUD_UP : CLOUD_DOWN);
        }
      }
    });
  };

  // ---------- Supertrend，按 TradingView 内置脚本 (ta.supertrend) 的算法 ----------
  var ST_UP = '#4CAF50';     // Pine color.green
  var ST_DOWN = '#FF5252';   // Pine color.red

  // 逐行照 Pine 的 ta.supertrend 写：ATR 用 Wilder 平滑 (ta.atr)，中线 hl2，
  // 上下轨只能往有利方向收紧；direction -1 = 多头 (线在K线下方)，1 = 空头
  function seriesSupertrend(bars, factor, atrPeriod) {
    var n = bars.length;
    var ctx = { series: {
      high: bars.map(function (b) { return b.high; }),
      low: bars.map(function (b) { return b.low; }),
      close: bars.map(function (b) { return b.close; })
    } };
    var atr = seriesATR(ctx, atrPeriod);
    var value = new Array(n).fill(null), direction = new Array(n).fill(null);
    var prevUpper = null, prevLower = null, prevST = null;
    for (var i = 0; i < n; i++) {
      if (atr[i] === null) continue;
      var src = (bars[i].high + bars[i].low) / 2;
      var upper = src + factor * atr[i], lower = src - factor * atr[i];
      var pu = prevUpper === null ? 0 : prevUpper, pl = prevLower === null ? 0 : prevLower; // Pine: nz(band[1])
      var prevClose = i > 0 ? bars[i - 1].close : null;
      lower = lower > pl || (prevClose !== null && prevClose < pl) ? lower : pl;
      upper = upper < pu || (prevClose !== null && prevClose > pu) ? upper : pu;
      var dir;
      if (i === 0 || atr[i - 1] === null) dir = 1;
      else if (prevST === prevUpper) dir = bars[i].close > upper ? -1 : 1;
      else dir = bars[i].close < lower ? 1 : -1;
      value[i] = dir === -1 ? lower : upper;
      direction[i] = dir;
      prevUpper = upper;
      prevLower = lower;
      prevST = value[i];
    }
    return { value: value, direction: direction };
  }

  // Supertrend 的线和填色都自己画：图表库的折线遇到空白点不会断开 (实测 v5 会直接连过去)，
  // 做不出 Pine plot.style_linebr 那种"方向一变线就断"的效果。
  // 线只连同方向的相邻两根K线；填色在K线实体中点 (open+close)/2 和线之间，方向一变就断开 (fillgaps=false)
  function SupertrendPrimitive(points) {
    this._points = points; // [{time, mid, value, line, fill}]
    this._chart = null;
    this._series = null;
    var self = this;
    function view(zOrder, draw) {
      return { zOrder: function () { return zOrder; }, renderer: function () { return { draw: function (t) { self._draw(t, draw); } }; } };
    }
    this._views = [
      view('bottom', function (ctx, p, q) { // 填色画在K线下面
        ctx.fillStyle = p.fill;
        ctx.beginPath();
        ctx.moveTo(p.x, p.ym);
        ctx.lineTo(q.x, q.ym);
        ctx.lineTo(q.x, q.yv);
        ctx.lineTo(p.x, p.yv);
        ctx.closePath();
        ctx.fill();
      }),
      view('normal', function (ctx, p, q) { // 线画在K线上面 (跟 TradingView 一样)
        ctx.strokeStyle = p.line;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(p.x, p.yv);
        ctx.lineTo(q.x, q.yv);
        ctx.stroke();
      })
    ];
  }
  SupertrendPrimitive.prototype.attached = function (param) { this._chart = param.chart; this._series = param.series; };
  SupertrendPrimitive.prototype.detached = function () { this._chart = null; this._series = null; };
  SupertrendPrimitive.prototype.updateAllViews = function () {};
  SupertrendPrimitive.prototype.paneViews = function () { return this._views; };
  SupertrendPrimitive.prototype._draw = function (target, drawSegment) {
    if (!this._chart) return;
    var timeScale = this._chart.timeScale(), series = this._series;
    var pts = this._points.map(function (p) {
      return { x: timeScale.timeToCoordinate(p.time), ym: series.priceToCoordinate(p.mid), yv: series.priceToCoordinate(p.value), line: p.line, fill: p.fill };
    });
    target.useMediaCoordinateSpace(function (scope) {
      for (var i = 0; i + 1 < pts.length; i++) {
        var p = pts[i], q = pts[i + 1];
        if (p.line !== q.line || p.x === null || q.x === null || p.ym === null || p.yv === null || q.ym === null || q.yv === null) continue;
        drawSegment(scope.context, p, q);
      }
    });
  };

  // ---------- 通用填色 primitive: 在每根K线的 a、b 两个价位之间填色，相邻两根颜色一样才连起来 ----------
  // 用在布林带 (上下轨之间) 和 HLC 区域图 (高-收、收-低)
  function BandPrimitive(points) {
    this._points = points; // [{time, a, b, color}]
    this._chart = null;
    this._series = null;
    var self = this;
    this._paneView = {
      zOrder: function () { return 'bottom'; },
      renderer: function () { return { draw: function (target) { self._draw(target); } }; }
    };
  }
  BandPrimitive.prototype.attached = function (param) { this._chart = param.chart; this._series = param.series; };
  BandPrimitive.prototype.detached = function () { this._chart = null; this._series = null; };
  BandPrimitive.prototype.updateAllViews = function () {};
  BandPrimitive.prototype.paneViews = function () { return [this._paneView]; };
  BandPrimitive.prototype._draw = function (target) {
    if (!this._chart) return;
    var timeScale = this._chart.timeScale(), series = this._series;
    var pts = this._points.map(function (p) {
      return { x: timeScale.timeToCoordinate(p.time), ya: series.priceToCoordinate(p.a), yb: series.priceToCoordinate(p.b), color: p.color };
    });
    target.useMediaCoordinateSpace(function (scope) {
      var ctx = scope.context;
      for (var i = 0; i + 1 < pts.length; i++) {
        var p = pts[i], q = pts[i + 1];
        if (p.color !== q.color || p.x === null || q.x === null || p.ya === null || p.yb === null || q.ya === null || q.yb === null) continue;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.moveTo(p.x, p.ya);
        ctx.lineTo(q.x, q.ya);
        ctx.lineTo(q.x, q.yb);
        ctx.lineTo(p.x, p.yb);
        ctx.closePath();
        ctx.fill();
      }
    });
  };

  // #rrggbb → rgba(r,g,b,a)
  function withAlpha(hex, alpha) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
    if (!m) return hex;
    var n = parseInt(m[1], 16);
    return 'rgba(' + (n >> 16 & 255) + ', ' + (n >> 8 & 255) + ', ' + (n & 255) + ', ' + alpha + ')';
  }
  function fillTemplate(tpl, p) { return tpl.replace(/\{(\w+)\}/g, function (_, k) { return String(p[k]); }); }
  function toPoints(bars, values) {
    var out = [];
    values.forEach(function (v, i) { if (isNum(v)) out.push({ time: bars[i].time, value: v }); });
    return out;
  }
  function lastValue(points) {
    for (var i = points.length - 1; i >= 0; i--) if (isNum(points[i].value)) return points[i].value;
    return null;
  }

  // ---------- 指标库: 每个指标的参数 (输入)、画哪几条线 (样式)、怎么算 ----------
  // scale: price = 跟价格同单位；own = 震荡类 (自己的数值范围)；volume = 跟成交量同单位
  // formulas 里的 {length} 这类占位符会换成用户设定的参数，再交给上面的公式引擎计算
  var CATEGORIES = [
    { id: 'trend', name: '趋势' },
    { id: 'momentum', name: '动量' },
    { id: 'volatility', name: '波动性' },
    { id: 'volume', name: '成交量' }
  ];
  function lengthInput(def) { return { key: 'length', label: '长度', def: def, min: 1, max: 500, step: 1 }; }
  var INDICATOR_DEFS = [
    { id: 'sma', category: 'trend', name: '移动平均线 SMA', desc: '最近 N 根K线收盘价的简单平均。', scale: 'price',
      inputs: [lengthInput(20)], plots: [{ key: 'ma', label: 'SMA', color: '#3d8ce8' }],
      formulas: { ma: 'sma(close,{length})' }, short: function (p) { return 'SMA ' + p.length; } },
    { id: 'ema', category: 'trend', name: '指数移动平均 EMA', desc: '越近的K线权重越大的平均线。', scale: 'price',
      inputs: [lengthInput(50)], plots: [{ key: 'ma', label: 'EMA', color: '#8a5ce8' }],
      formulas: { ma: 'ema(close,{length})' }, short: function (p) { return 'EMA ' + p.length; } },
    { id: 'psar', category: 'trend', name: '抛物线转向 SAR', desc: 'Parabolic SAR；逐行照 pandas_ta 移植，跟策略判断"SAR多头"用的是同一种算法。', scale: 'price',
      inputs: [{ key: 'start', label: '加速因子', def: 0.02, min: 0.001, max: 1, step: 0.001 }, { key: 'max', label: '最大值', def: 0.2, min: 0.01, max: 1, step: 0.01 }],
      plots: [{ key: 'sar', label: 'SAR', color: '#e8a33d', type: 'dots' }], short: function (p) { return 'SAR ' + p.start + ' ' + p.max; } },
    { id: 'bb', category: 'trend', name: '布林带 Bollinger Bands', desc: '中轨 = N 日均线，上下轨 = 中轨 ± 倍数 × 标准差，上下轨之间填色。', scale: 'price',
      inputs: [lengthInput(20), { key: 'mult', label: '标准差倍数', def: 2, min: 0.1, max: 10, step: 0.1 }],
      plots: [{ key: 'basis', label: '中轨', color: '#FF6D00' }, { key: 'upper', label: '上轨', color: '#2962FF' }, { key: 'lower', label: '下轨', color: '#2962FF' }],
      formulas: { basis: 'sma(close,{length})', upper: 'sma(close,{length})+{mult}*stdev(close,{length})', lower: 'sma(close,{length})-{mult}*stdev(close,{length})' },
      band: { a: 'upper', b: 'lower', alpha: 0.08 }, short: function (p) { return 'BB ' + p.length + ' ' + p.mult; } },
    { id: 'ichimoku', category: 'trend', name: '一目均衡表 Ichimoku Cloud', desc: '按 TradingView 内置 Pine 脚本的算法；先行带往未来多画 (位移 − 1) 根，A 在 B 上方云是绿色。', scale: 'price', width: 1,
      inputs: [{ key: 'conversion', label: '转换线长度', def: 9, min: 1, max: 200, step: 1 }, { key: 'base', label: '基准线长度', def: 26, min: 1, max: 200, step: 1 },
        { key: 'spanB', label: '先行带B长度', def: 52, min: 1, max: 300, step: 1 }, { key: 'displacement', label: '位移', def: 26, min: 1, max: 100, step: 1 }],
      plots: [{ key: 'conversion', label: '转换线', color: '#2962FF' }, { key: 'base', label: '基准线', color: '#B71C1C' }, { key: 'lagging', label: '延迟线', color: '#43A047' },
        { key: 'leadA', label: '先行带A', color: '#A5D6A7' }, { key: 'leadB', label: '先行带B', color: '#EF9A9A' }],
      short: function (p) { return '一目 ' + p.conversion + ' ' + p.base + ' ' + p.spanB + ' ' + p.displacement; } },
    { id: 'supertrend', category: 'trend', name: 'Supertrend 超级趋势', desc: '按 TradingView 内置脚本 (ta.supertrend)；多头绿线在K线下方，空头红线在上方。', scale: 'price',
      inputs: [{ key: 'atr', label: 'ATR 长度', def: 10, min: 1, max: 200, step: 1 }, { key: 'factor', label: '倍数', def: 3, min: 0.1, max: 20, step: 0.01 }],
      plots: [{ key: 'up', label: '多头', color: ST_UP }, { key: 'down', label: '空头', color: ST_DOWN }],
      short: function (p) { return 'Supertrend ' + p.atr + ' ' + p.factor; } },

    { id: 'rsi', category: 'momentum', name: '相对强弱指数 RSI', desc: 'Wilder 平滑，跟后台策略用的 RSI 一致；虚线是 70 / 30。', scale: 'own',
      inputs: [lengthInput(14)], plots: [{ key: 'rsi', label: 'RSI', color: '#7E57C2' }],
      formulas: { rsi: 'rsi(close,{length})' }, levels: [70, 30], short: function (p) { return 'RSI ' + p.length; } },
    { id: 'macd', category: 'momentum', name: 'MACD', desc: 'MACD 线 = 快 EMA − 慢 EMA；信号线 = MACD 线的 EMA；柱 = 两者之差。', scale: 'own',
      inputs: [{ key: 'fast', label: '快线长度', def: 12, min: 1, max: 200, step: 1 }, { key: 'slow', label: '慢线长度', def: 26, min: 1, max: 300, step: 1 }, { key: 'signal', label: '信号线长度', def: 9, min: 1, max: 100, step: 1 }],
      plots: [{ key: 'hist', label: '柱 (正)', color: '#26A69A', type: 'hist', negLabel: '柱 (负)', negColor: '#FF5252' }, { key: 'macd', label: 'MACD', color: '#2962FF' }, { key: 'signal', label: '信号线', color: '#FF6D00' }],
      formulas: { macd: 'ema(close,{fast})-ema(close,{slow})', signal: 'ema(ema(close,{fast})-ema(close,{slow}),{signal})',
        hist: 'ema(close,{fast})-ema(close,{slow})-ema(ema(close,{fast})-ema(close,{slow}),{signal})' },
      short: function (p) { return 'MACD ' + p.fast + ' ' + p.slow + ' ' + p.signal; } },
    { id: 'stoch', category: 'momentum', name: '随机指标 Stochastic', desc: '%K = N 日内收盘价的相对位置 (平滑后)，%D = %K 的均线；虚线是 80 / 20。', scale: 'own',
      inputs: [{ key: 'k', label: '%K 长度', def: 14, min: 1, max: 200, step: 1 }, { key: 'smoothK', label: '%K 平滑', def: 1, min: 1, max: 50, step: 1 }, { key: 'd', label: '%D 平滑', def: 3, min: 1, max: 50, step: 1 }],
      plots: [{ key: 'k', label: '%K', color: '#2962FF' }, { key: 'd', label: '%D', color: '#FF6D00' }],
      formulas: { k: 'sma((close-lowest(low,{k}))/(highest(high,{k})-lowest(low,{k}))*100,{smoothK})',
        d: 'sma(sma((close-lowest(low,{k}))/(highest(high,{k})-lowest(low,{k}))*100,{smoothK}),{d})' },
      levels: [80, 20], short: function (p) { return 'Stoch ' + p.k + ' ' + p.smoothK + ' ' + p.d; } },
    { id: 'cci', category: 'momentum', name: '顺势指标 CCI', desc: '价格偏离均价的程度；虚线是 +100 / −100。', scale: 'own',
      inputs: [lengthInput(20)], plots: [{ key: 'cci', label: 'CCI', color: '#3dbf8e' }],
      formulas: { cci: '((high+low+close)/3-sma((high+low+close)/3,{length}))/(0.015*stdev((high+low+close)/3,{length}))' },
      levels: [100, -100], short: function (p) { return 'CCI ' + p.length; } },
    { id: 'wr', category: 'momentum', name: '威廉指标 Williams %R', desc: '收盘价在 N 日高低区间里的位置 (0 到 −100)；虚线是 −20 / −80。', scale: 'own',
      inputs: [lengthInput(14)], plots: [{ key: 'wr', label: '%R', color: '#e86ec2' }],
      formulas: { wr: '(highest(high,{length})-close)/(highest(high,{length})-lowest(low,{length}))*-100' },
      levels: [-20, -80], short: function (p) { return '%R ' + p.length; } },

    { id: 'atr', category: 'volatility', name: '平均真实波幅 ATR', desc: '真实波幅的 Wilder 平滑，衡量波动大小。', scale: 'own',
      inputs: [lengthInput(14)], plots: [{ key: 'atr', label: 'ATR', color: '#e8a33d' }],
      formulas: { atr: 'atr({length})' }, short: function (p) { return 'ATR ' + p.length; } },
    { id: 'bbw', category: 'volatility', name: '布林带带宽', desc: '(上轨 − 下轨) ÷ 中轨，数值越小代表越收敛。', scale: 'own',
      inputs: [lengthInput(20), { key: 'mult', label: '标准差倍数', def: 2, min: 0.1, max: 10, step: 0.1 }],
      plots: [{ key: 'bbw', label: '带宽', color: '#3d8ce8' }],
      formulas: { bbw: '(2*{mult}*stdev(close,{length}))/sma(close,{length})' }, short: function (p) { return 'BBW ' + p.length + ' ' + p.mult; } },

    { id: 'volsma', category: 'volume', name: '成交量均线', desc: 'N 日成交量平均，跟成交量柱共用坐标轴。', scale: 'volume',
      inputs: [lengthInput(20)], plots: [{ key: 'ma', label: '量均线', color: '#e8a33d' }],
      formulas: { ma: 'sma(volume,{length})' }, short: function (p) { return 'Vol MA ' + p.length; } },
    { id: 'obv', category: 'volume', name: '能量潮 OBV', desc: '上涨日加成交量、下跌日减成交量的累计值。', scale: 'own',
      inputs: [], plots: [{ key: 'obv', label: 'OBV', color: '#8a5ce8' }],
      formulas: { obv: 'obv()' }, short: function () { return 'OBV'; } },
    { id: 'vwap', category: 'volume', name: '滚动 VWAP', desc: '最近 N 根K线的成交量加权平均价。', scale: 'price',
      inputs: [lengthInput(20)], plots: [{ key: 'vwap', label: 'VWAP', color: '#3dbf8e' }],
      formulas: { vwap: 'sum((high+low+close)/3*volume,{length})/sum(volume,{length})' }, short: function (p) { return 'VWAP ' + p.length; } }
  ];
  // 自定义公式 ("我的脚本") 共用这个定义，名称/公式/坐标轴存在指标实例上
  var CUSTOM_DEF = { id: 'custom', category: 'custom', name: '自定义公式', scale: 'price', inputs: [], plots: [{ key: 'value', label: '线', color: '#e8a33d' }] };
  var DEF_BY_ID = {};
  INDICATOR_DEFS.forEach(function (d) { DEF_BY_ID[d.id] = d; });
  DEF_BY_ID.custom = CUSTOM_DEF;
  function defOf(ind) { return DEF_BY_ID[ind.def] || CUSTOM_DEF; }
  function catName(id) {
    for (var i = 0; i < CATEGORIES.length; i++) if (CATEGORIES[i].id === id) return CATEGORIES[i].name;
    return id === 'custom' ? '我的脚本' : '';
  }
  function autoPane(scale) { return scale === 'own' ? 'sub' : 'main'; }
  function defaultParams(def) {
    var p = {};
    def.inputs.forEach(function (i) { p[i.key] = i.def; });
    return p;
  }
  function indLabel(ind) {
    var def = defOf(ind);
    if (def === CUSTOM_DEF) return ind.name || '自定义公式';
    return def.short ? def.short(ind.params) : def.name;
  }
  function indScale(ind) { return defOf(ind) === CUSTOM_DEF ? (ind.scale || 'price') : defOf(ind).scale; }
  function makeIndicator(defId, pane) {
    var def = DEF_BY_ID[defId];
    return { id: newId('ind'), def: defId, params: defaultParams(def), colors: {}, width: def.width || 2, pane: pane || autoPane(def.scale), hidden: false };
  }
  // 参数清洗: 数字、范围、整数
  function cleanParams(def, raw) {
    var p = {};
    def.inputs.forEach(function (i) {
      var v = parseFloat(raw && raw[i.key]);
      if (!isNum(v)) v = i.def;
      v = Math.min(i.max, Math.max(i.min, v));
      if (i.step >= 1) v = Math.round(v);
      p[i.key] = +v.toFixed(6);
    });
    return p;
  }

  // ---------- 选股条件 (自定义筛选器) ----------
  // 一条规则 = {id, a, op, b}：a / b 是下面 OPERANDS 里的东西 (+ 可调的长度 n)，b 也可以是固定数字 {k:'num', v}；
  // 或者自己写公式 {id, formula}。规则编译成公式 (ruleFormula) 交给上面的公式引擎，结果是逐根的 1 / 0。
  // unit 用来提示"两边单位不一样" (例如拿收盘价跟 RSI 比)；bool = 形态类，只有"成立 / 不成立"
  // group = 下拉框里的分组 (手机上会变成选单里的小标题)。
  // 当前价格 = 最新一根日线的收盘价：盘中就是最新成交价 (跟表格"价格"一栏一样)，收盘后就是当天收盘价
  var OPERANDS = [
    { k: 'close', group: 'price', label: '当前价格', unit: 'price', f: function () { return 'close'; } },
    { k: 'pclose', group: 'price', label: '昨日收盘', unit: 'price', f: function () { return 'ref(close,1)'; } },
    { k: 'open', group: 'price', label: '今日开盘', unit: 'price', f: function () { return 'open'; } },
    { k: 'high', group: 'price', label: '今日最高', unit: 'price', f: function () { return 'high'; } },
    { k: 'low', group: 'price', label: '今日最低', unit: 'price', f: function () { return 'low'; } },
    { k: 'hh', group: 'price', label: '前 N 日最高', unit: 'price', len: 20, f: function (n) { return 'ref(highest(high,' + n + '),1)'; }, short: function (n) { return '前' + n + '日最高'; } },
    { k: 'll', group: 'price', label: '前 N 日最低', unit: 'price', len: 20, f: function (n) { return 'ref(lowest(low,' + n + '),1)'; }, short: function (n) { return '前' + n + '日最低'; } },
    { k: 'sma', group: 'trend', label: 'SMA 均线', unit: 'price', len: 20, f: function (n) { return 'sma(close,' + n + ')'; }, short: function (n) { return 'SMA(' + n + ')'; } },
    { k: 'ema', group: 'trend', label: 'EMA 均线', unit: 'price', len: 20, f: function (n) { return 'ema(close,' + n + ')'; }, short: function (n) { return 'EMA(' + n + ')'; } },
    { k: 'sar', group: 'trend', label: 'SAR 抛物线', unit: 'price', f: function () { return 'psar()'; }, short: function () { return 'SAR'; } },
    { k: 'st', group: 'trend', label: 'Supertrend', unit: 'price', f: function () { return 'supertrend()'; }, short: function () { return 'Supertrend(10,3)'; } },
    { k: 'rsi', group: 'momentum', label: 'RSI', unit: 'osc', len: 14, f: function (n) { return 'rsi(close,' + n + ')'; }, short: function (n) { return 'RSI(' + n + ')'; } },
    { k: 'macd', group: 'momentum', label: 'MACD 线', unit: 'osc', f: function () { return 'ema(close,12)-ema(close,26)'; }, short: function () { return 'MACD线'; } },
    { k: 'macds', group: 'momentum', label: 'MACD 信号线', unit: 'osc', f: function () { return 'ema(ema(close,12)-ema(close,26),9)'; }, short: function () { return 'MACD信号线'; } },
    { k: 'chg', group: 'momentum', label: '涨跌%', unit: 'pct', f: function () { return '(close/ref(close,1)-1)*100'; } },
    { k: 'atrp', group: 'momentum', label: 'ATR% 波动', unit: 'pct', len: 14, f: function (n) { return 'atr(' + n + ')/close*100'; }, short: function (n) { return 'ATR%(' + n + ')'; } },
    { k: 'vol', group: 'volume', label: '成交量', unit: 'vol', f: function () { return 'volume'; } },
    { k: 'vma', group: 'volume', label: '成交量均线', unit: 'vol', len: 20, f: function (n) { return 'sma(volume,' + n + ')'; }, short: function (n) { return '量均线(' + n + ')'; } },
    // 相对量 = 今天成交量 ÷ 前 N 天平均 (不含今天)，跟表格的"相对量"同一个算法
    { k: 'rvol', group: 'volume', label: '相对量', unit: 'ratio', len: 20, f: function (n) { return 'volume/ref(sma(volume,' + n + '),1)'; }, short: function (n) { return '相对量(' + n + ')'; } },
    { k: 't3', group: 'pattern', label: 'T3 形态突破', unit: 'bool', f: function () { return 't3()'; } }
  ];
  var OPERAND_GROUPS = [['price', '价格'], ['trend', '均线 · 趋势'], ['momentum', '动量 · 波动'], ['volume', '成交量'], ['pattern', '形态']];
  var OPERAND_BY_K = {};
  OPERANDS.forEach(function (o) { OPERAND_BY_K[o.k] = o; });
  var RULE_OPS = [
    { k: '>', label: '>' }, { k: '<', label: '<' }, { k: '>=', label: '≥' }, { k: '<=', label: '≤' },
    { k: 'crossup', label: '上穿' }, { k: 'crossdown', label: '下穿' }
  ];
  var RULE_OP_LABEL = {};
  RULE_OPS.forEach(function (o) { RULE_OP_LABEL[o.k] = o.label; });
  var BOOL_OPS = [{ k: 'is', label: '成立' }, { k: 'not', label: '不成立' }];
  var UNIT_NAMES = { price: '价格', pct: '百分比', osc: '指标数值', vol: '成交量', ratio: '倍数' };
  var MAX_LEN = 500;

  function clampLen(v, def) {
    var n = Math.round(parseFloat(v));
    return isNum(n) ? Math.min(MAX_LEN, Math.max(1, n)) : def;
  }
  // 数字写进公式: 不能用科学计数法 (公式引擎看不懂 1e-7 这种)
  function numLiteral(v) {
    var s = (+v).toFixed(6).replace(/\.?0+$/, '');
    return s === '-0' ? '0' : s;
  }
  function isBoolOperand(ref) { return !!(ref && OPERAND_BY_K[ref.k] && OPERAND_BY_K[ref.k].unit === 'bool'); }
  // 价格类的值 (收盘价、均线、SAR…) 先四舍五入到 3 位小数再比，跟后台一样 (main.py 存的现价、EMA20、SAR 都是 3 位)，
  // 不然现价 0.075、EMA 0.0748 这种，后台当成"没站上"，网页却算"站上了"
  var PRICE_ROUND = 3;
  function operandFormula(ref) {
    if (ref.k === 'num') return numLiteral(ref.v);
    var d = OPERAND_BY_K[ref.k];
    var f = d.f(d.len ? clampLen(ref.n, d.len) : null);
    return d.unit === 'price' ? 'round(' + f + ',' + PRICE_ROUND + ')' : f;
  }
  function operandLabel(ref) {
    if (ref.k === 'num') return numLiteral(ref.v);
    var d = OPERAND_BY_K[ref.k];
    return d.short ? d.short(d.len ? clampLen(ref.n, d.len) : null) : d.label;
  }
  function ruleFormula(r) {
    if (r.formula !== undefined) return r.formula;
    var a = operandFormula(r.a);
    if (isBoolOperand(r.a)) return r.op === 'not' ? 'not ' + a : a;
    var b = operandFormula(r.b);
    if (r.op === 'crossup' || r.op === 'crossdown') return r.op + '(' + a + ',' + b + ')';
    return a + ' ' + r.op + ' ' + b;
  }
  function ruleLabel(r) {
    if (r.formula !== undefined) return '公式：' + (r.formula.trim() || '(空)');
    var a = operandLabel(r.a);
    if (isBoolOperand(r.a)) return r.op === 'not' ? a + ' 不成立' : a;
    return a + ' ' + RULE_OP_LABEL[r.op] + ' ' + operandLabel(r.b);
  }
  function unitWarning(r) {
    if (r.formula !== undefined || isBoolOperand(r.a) || !r.b || r.b.k === 'num') return '';
    var ua = OPERAND_BY_K[r.a.k].unit, ub = OPERAND_BY_K[r.b.k].unit;
    if (ua === ub) return '';
    return '两边单位不一样 (' + UNIT_NAMES[ua] + ' 对 ' + UNIT_NAMES[ub] + ')，这样比通常没有意义，确认一下是不是想这样比';
  }
  function cleanRef(ref, allowNum) {
    if (!ref || typeof ref !== 'object') return null;
    if (ref.k === 'num') {
      if (!allowNum) return null;
      var v = parseFloat(ref.v);
      return { k: 'num', v: isNum(v) ? Math.max(-1e12, Math.min(1e12, v)) : 0 };
    }
    var d = OPERAND_BY_K[ref.k];
    if (!d) return null;
    return d.len ? { k: d.k, n: clampLen(ref.n, d.len) } : { k: d.k };
  }
  // 读进来的规则 (localStorage / 备份文件) 清洗一遍: 认不得的丢掉，缺的补默认值
  function validRule(r) {
    if (!r || typeof r !== 'object') return false;
    if (!r.id || typeof r.id !== 'string') r.id = newId('rule');
    if (r.formula !== undefined) {
      if (typeof r.formula !== 'string') return false;
      r.formula = r.formula.slice(0, 300);
      delete r.a; delete r.b; delete r.op;
      return true;
    }
    var a = cleanRef(r.a, false);
    if (!a) return false;
    r.a = a;
    if (isBoolOperand(a)) {
      if (r.op !== 'not') r.op = 'is';
      delete r.b;
      return true;
    }
    if (!RULE_OP_LABEL[r.op]) r.op = '>';
    var b = cleanRef(r.b, true);
    r.b = b && !isBoolOperand(b) ? b : { k: 'num', v: 0 };
    return true;
  }

  // ---------- 内置模板 ----------
  // kind: 'strategy' = 选股策略 (带条件，套用后在报告全部股票里筛)；其余只是指标组合
  // ⚠️ s-backend 要跟后台 main.py 的 check_strategy / BACKEND_STRATEGY_PARTS 同一套条件，改的话两边一起改
  var BUILTIN_TEMPLATES = [
    { id: 's-backend', kind: 'strategy', name: '后台默认策略', desc: '当前价格 > EMA(20)、当前价格 > SAR、T3 形态突破 (跟后台信号同一套条件)',
      items: [['psar']],
      rules: [{ a: { k: 'close' }, op: '>', b: { k: 'ema', n: 20 } }, { a: { k: 'close' }, op: '>', b: { k: 'sar' } }, { a: { k: 't3' }, op: 'is' }] },
    { id: 's-rsi', kind: 'strategy', name: 'RSI 超卖回升', desc: 'RSI(14) 上穿 30', items: [['rsi']],
      rules: [{ a: { k: 'rsi', n: 14 }, op: 'crossup', b: { k: 'num', v: 30 } }] },
    { id: 's-golden', kind: 'strategy', name: '均线金叉', desc: 'SMA(20) 上穿 SMA(50)', items: [['sma', { length: 20 }], ['sma', { length: 50 }]],
      rules: [{ a: { k: 'sma', n: 20 }, op: 'crossup', b: { k: 'sma', n: 50 } }] },
    { id: 's-breakout', kind: 'strategy', name: '放量突破', desc: '当前价格 > 前 20 日最高，而且相对量 ≥ 2', items: [['volsma']],
      rules: [{ a: { k: 'close' }, op: '>', b: { k: 'hh', n: 20 } }, { a: { k: 'rvol', n: 20 }, op: '>=', b: { k: 'num', v: 2 } }] },
    { id: 's-macd', kind: 'strategy', name: 'MACD 金叉', desc: 'MACD 线上穿信号线 (12, 26, 9)', items: [['macd']],
      rules: [{ a: { k: 'macd' }, op: 'crossup', b: { k: 'macds' } }] },
    { id: 's-supertrend', kind: 'strategy', name: 'Supertrend 转多', desc: '当前价格上穿 Supertrend (10, 3)', items: [['supertrend']],
      rules: [{ a: { k: 'close' }, op: 'crossup', b: { k: 'st' } }] },
    { id: 'b-trend', name: '趋势跟随', desc: 'SMA 50 + Supertrend + SAR', items: [['sma', { length: 50 }], ['supertrend'], ['psar']] },
    { id: 'b-ichimoku', name: '一目均衡表', desc: '一目均衡表 (9, 26, 52, 26)', items: [['ichimoku']] },
    { id: 'b-momentum', name: '动量组合', desc: 'RSI 14 + MACD 12 26 9 (两个副图)', items: [['rsi'], ['macd']] },
    { id: 'b-volatility', name: '波动率', desc: '布林带 20 2 + ATR 14', items: [['bb'], ['atr']] },
    { id: 'b-volume', name: '量价', desc: '成交量均线 20 + 滚动 VWAP 20 + OBV', items: [['volsma'], ['vwap'], ['obv']] }
  ];
  function isStrategy(bt) { return bt.kind === 'strategy'; }
  function builtinById(id) { return BUILTIN_TEMPLATES.filter(function (x) { return x.id === id; })[0] || null; }
  function instantiateItems(items) {
    return items.map(function (it) {
      var ind = makeIndicator(it[0]);
      if (it[1]) ind.params = cleanParams(DEF_BY_ID[it[0]], Object.assign({}, ind.params, it[1]));
      return ind;
    });
  }
  function instantiateRules(rules) {
    return (rules || []).map(function (r) { var c = JSON.parse(JSON.stringify(r)); c.id = newId('rule'); return c; }).filter(validRule);
  }

  // ---------- 模板存储 (v2) + 旧版本迁移 ----------
  // 一个模板 = {id, name, indicators: [指标...], rules: [选股条件...], match: 'all' | 'any', origin?: 内置模板 id}
  var TPL_KEY = 'bursa_templates_v2';
  var TPL_KEY_V1 = 'bursa_templates_v1';
  var LEGACY_IND_KEY = 'bursa_custom_indicators_v1';
  var FAV_KEY = 'bursa_ind_favorites_v1';
  var SCRIPTS_KEY = 'bursa_my_scripts_v1';
  var DEFAULT_TPL_NAME = '我的筛选器';

  // 旧版的预设 id → 新版指标 + 参数 (布林带三条线、MACD 两条线以前是分开的，现在各合成一个指标)
  var LEGACY_PRESETS = {
    sma20: ['sma', { length: 20 }], sma50: ['sma', { length: 50 }], ema50: ['ema', { length: 50 }], sar: ['psar'],
    boll_upper: ['bb'], boll_mid: ['bb'], boll_lower: ['bb'], ichimoku: ['ichimoku'], supertrend: ['supertrend'],
    rsi14: ['rsi'], macd_line: ['macd'], macd_signal: ['macd'], stoch_k: ['stoch'], cci20: ['cci'], wr14: ['wr'],
    atr14: ['atr'], boll_width: ['bbw'], obv: ['obv'], vol_sma20: ['volsma'], vwap20: ['vwap']
  };
  function migrateIndicators(list) {
    var out = [], seen = {};
    (Array.isArray(list) ? list : []).forEach(function (old) {
      if (!old) return;
      var key = old.presetId || (old.builtin === 'psar' || old.dataKey === 'psar' ? 'sar' : old.builtin || old.composite);
      var map = LEGACY_PRESETS[key];
      if (map) {
        if (seen[map[0]] && (map[0] === 'bb' || map[0] === 'macd')) return;
        seen[map[0]] = true;
        var ind = makeIndicator(map[0], old.pane === 'main' || old.pane === 'sub' ? old.pane : undefined);
        if (map[1]) ind.params = cleanParams(DEF_BY_ID[map[0]], Object.assign({}, ind.params, map[1]));
        if (old.color && DEF_BY_ID[map[0]].plots.length === 1) ind.colors[DEF_BY_ID[map[0]].plots[0].key] = old.color;
        out.push(ind);
      } else if (old.formula) {
        var scale = old.scale || 'price';
        out.push({ id: old.id || newId('ind'), def: 'custom', name: old.name || '自定义公式', formula: old.formula, scale: scale,
          params: {}, colors: { value: old.color || '#e8a33d' }, width: 2, pane: old.pane === 'main' || old.pane === 'sub' ? old.pane : autoPane(scale), hidden: false });
      }
    });
    return out;
  }
  function validIndicator(ind) {
    if (!ind || typeof ind.id !== 'string' || !ind.id || !DEF_BY_ID[ind.def]) return false;
    // 颜色会写进图例的 style，只收 #rrggbb (导入的备份文件是别人给的也不怕)
    var colorsIn = ind.colors && typeof ind.colors === 'object' ? ind.colors : {};
    ind.colors = {};
    Object.keys(colorsIn).forEach(function (k) { if (/^#[0-9a-f]{6}$/i.test(colorsIn[k])) ind.colors[k] = colorsIn[k]; });
    ind.width = [1, 2, 3, 4].indexOf(+ind.width) !== -1 ? +ind.width : (DEF_BY_ID[ind.def].width || 2);
    if (ind.def === 'custom') {
      if (typeof ind.formula !== 'string' || !ind.formula.length) return false;
      ind.name = typeof ind.name === 'string' ? ind.name.slice(0, 40) : '自定义公式';
      if (['price', 'own', 'volume'].indexOf(ind.scale) === -1) ind.scale = 'price';
      if (ind.pane !== 'main' && ind.pane !== 'sub') ind.pane = autoPane(ind.scale);
      return true;
    }
    ind.params = cleanParams(DEF_BY_ID[ind.def], ind.params);
    if (ind.pane !== 'main' && ind.pane !== 'sub') ind.pane = autoPane(indScale(ind));
    return true;
  }
  var templates = loadJSON(TPL_KEY, null);
  if (!templates || !Array.isArray(templates.list) || !templates.list.length) {
    var v1 = loadJSON(TPL_KEY_V1, null);
    if (v1 && Array.isArray(v1.list) && v1.list.length) {
      templates = { active: v1.active, list: v1.list.map(function (t) { return { id: t.id || newId('tpl'), name: t.name || DEFAULT_TPL_NAME, indicators: migrateIndicators(t.indicators) }; }) };
    } else {
      templates = { active: 'tpl-1', list: [{ id: 'tpl-1', name: DEFAULT_TPL_NAME, indicators: migrateIndicators(loadJSON(LEGACY_IND_KEY, [])) }] };
    }
    templates.migrated = true; // 下面清洗完马上存成 v2，之后每次打开都读同一份 (旧的 v1 保留不删)
  }
  templates.list.forEach(function (t) {
    if (!t.id) t.id = newId('tpl');
    t.indicators = (Array.isArray(t.indicators) ? t.indicators : []).filter(validIndicator);
    // 选股条件 (旧模板没有 = 空，只有指标)；match: all = 全部满足、any = 任一满足
    t.rules = (Array.isArray(t.rules) ? t.rules : []).filter(validRule);
    if (t.match !== 'any') t.match = 'all';
  });
  if (templates.migrated) {
    delete templates.migrated;
    saveJSON(TPL_KEY, templates);
  }
  var favorites = loadJSON(FAV_KEY, []);
  if (!Array.isArray(favorites)) favorites = [];
  var scripts = loadJSON(SCRIPTS_KEY, []);
  if (!Array.isArray(scripts)) scripts = [];

  function activeTemplate() {
    for (var i = 0; i < templates.list.length; i++) if (templates.list[i].id === templates.active) return templates.list[i];
    templates.active = templates.list[0].id;
    return templates.list[0];
  }
  function indicators() { return activeTemplate().indicators; }
  function findIndicator(id) {
    var list = indicators();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  var statusTimer = null;
  function persist() {
    var ok = saveJSON(TPL_KEY, templates);
    var el = document.getElementById('tpl-status');
    if (!el) return;
    el.textContent = ok ? '✓ 已自动保存' : '浏览器不允许保存 (可能是隐私模式)';
    el.classList.add('show');
    clearTimeout(statusTimer);
    statusTimer = setTimeout(function () { el.classList.remove('show'); }, ok ? 1500 : 4000);
  }
  var toastTimer = null;
  function toast(msg) {
    var el = document.getElementById('bb-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'bb-toast';
      el.className = 'bb-toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 1600);
  }
  // 指标或模板有任何变动: 保存 + 重画所有图 + 刷新模板名称 / 选股条件结果 / ☰ 导航 / 打开着的对话框
  var onIndicatorsChanged = [];
  function indicatorsChanged() {
    persist();
    Object.keys(charts).forEach(function (id) { rebuildIndicators(charts[id]); });
    renderTemplateName();
    refreshStrategy();
    renderDashScreeners();
    onIndicatorsChanged.forEach(function (fn) { fn(); });
  }
  // 套用内置模板。reuse = true (从 ☰ 导航点的): 以前套用过的 (模板上记着 origin) 直接切过去，不会越点越多份；
  // reuse = false (指标对话框里的「套用」): 跟以前一样，每次都复制一份新的
  function applyBuiltin(bt, reuse) {
    var existing = reuse ? templates.list.filter(function (t) { return t.origin === bt.id; })[0] : null;
    if (existing) {
      templates.active = existing.id;
    } else {
      var t = { id: newId('tpl'), name: bt.name, origin: bt.id, indicators: instantiateItems(bt.items), rules: instantiateRules(bt.rules), match: 'all' };
      templates.list.push(t);
      templates.active = t.id;
    }
    indicatorsChanged();
    return activeTemplate();
  }
  function newTemplate(name, indicatorsList, rules, match) {
    var t = { id: newId('tpl'), name: name, indicators: indicatorsList || [], rules: rules || [], match: match === 'any' ? 'any' : 'all' };
    templates.list.push(t);
    templates.active = t.id;
    return t;
  }
  function templateById(id) {
    for (var i = 0; i < templates.list.length; i++) if (templates.list[i].id === id) return templates.list[i];
    return null;
  }
  // "2 个条件 · 1 个指标：SAR"
  function templateSummary(t) {
    var parts = [];
    if (t.rules.length) parts.push(t.rules.length + ' 个条件 (' + (t.match === 'any' ? '任一' : '全部') + '满足)');
    parts.push(t.indicators.length ? t.indicators.length + ' 个指标：' + t.indicators.map(indLabel).join('、') : '没有指标');
    return parts.join(' · ');
  }
  function renameTemplate(t) {
    if (!t) return;
    var name = window.prompt('模板名称', t.name);
    if (name === null) return;
    name = name.trim().slice(0, 30);
    if (!name) return;
    t.name = name;
    indicatorsChanged();
  }

  // ---------- 模板备份: 模板只存在这个浏览器里，换手机 / 电脑或清掉浏览器资料前可以导出，之后再导入 ----------
  function exportBackup() {
    var payload = { app: 'bursa-bot', kind: 'templates-backup', v: 1, exported_at: new Date().toISOString(),
      templates: templates, scripts: scripts, favorites: favorites };
    var url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    var a = document.createElement('a');
    a.href = url;
    a.download = 'bursa-bot-模板备份-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('已下载备份：' + templates.list.length + ' 个模板、' + scripts.length + ' 个脚本');
  }
  // 导入 = 合并: 模板全部加进来 (重名的名字后面加"(导入)")，脚本和收藏去掉重复的
  function importBackup(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var p = JSON.parse(reader.result);
        var list = p && p.templates && Array.isArray(p.templates.list) ? p.templates.list : null;
        if (!list) throw new Error('不是这个网站导出的模板备份');
        var names = {}, added = 0, addedScripts = 0;
        templates.list.forEach(function (t) { names[t.name] = true; });
        list.forEach(function (raw) {
          if (!raw || typeof raw !== 'object') return;
          var t = {
            id: newId('tpl'), name: String(raw.name || DEFAULT_TPL_NAME).slice(0, 30) || DEFAULT_TPL_NAME,
            indicators: (Array.isArray(raw.indicators) ? raw.indicators : []).map(function (i) {
              return i && typeof i === 'object' ? Object.assign({}, i, { id: newId('ind') }) : null;
            }).filter(validIndicator),
            rules: (Array.isArray(raw.rules) ? raw.rules : []).map(function (r) {
              return r && typeof r === 'object' ? Object.assign({}, r, { id: newId('rule') }) : null;
            }).filter(validRule),
            match: raw.match === 'any' ? 'any' : 'all'
          };
          if (typeof raw.origin === 'string' && builtinById(raw.origin)) t.origin = raw.origin;
          while (names[t.name]) t.name += ' (导入)';
          names[t.name] = true;
          templates.list.push(t);
          added++;
        });
        (Array.isArray(p.scripts) ? p.scripts : []).forEach(function (sc) {
          if (!sc || typeof sc.name !== 'string' || typeof sc.formula !== 'string') return;
          if (scripts.some(function (x) { return x.name === sc.name && x.formula === sc.formula; })) return;
          scripts.push({ name: sc.name.slice(0, 40), formula: sc.formula.slice(0, 300), color: /^#[0-9a-f]{6}$/i.test(sc.color) ? sc.color : '#e8a33d',
            scale: ['price', 'own', 'volume'].indexOf(sc.scale) !== -1 ? sc.scale : 'price' });
          addedScripts++;
        });
        (Array.isArray(p.favorites) ? p.favorites : []).forEach(function (id) {
          if (DEF_BY_ID[id] && id !== 'custom' && favorites.indexOf(id) === -1) favorites.push(id);
        });
        saveJSON(SCRIPTS_KEY, scripts);
        saveJSON(FAV_KEY, favorites);
        indicatorsChanged();
        toast('已导入 ' + added + ' 个模板' + (addedScripts ? '、' + addedScripts + ' 个脚本' : ''));
      } catch (e) {
        toast('导入失败：' + e.message);
      }
    };
    reader.onerror = function () { toast('读取文件失败'); };
    reader.readAsText(file);
  }
  function removeIndicator(id) {
    var list = indicators();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) { list.splice(i, 1); break; }
    indicatorsChanged();
  }
  // ↑ / ↓: 跟同一区域 (主图 / 副图) 里前一个或后一个指标换位置。副图的顺序就是窗格从上到下的顺序
  function neighborIndex(list, idx, dir) {
    for (var j = idx + dir; j >= 0 && j < list.length; j += dir) {
      if (list[j].pane === list[idx].pane) return j;
    }
    return -1;
  }
  function moveIndicator(id, dir) {
    var list = indicators();
    var idx = -1;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) idx = i;
    if (idx === -1) return;
    var j = neighborIndex(list, idx, dir);
    if (j === -1) return;
    var item = list.splice(idx, 1)[0];
    list.splice(j, 0, item);
    indicatorsChanged();
  }
  function toggleHidden(id) {
    var ind = findIndicator(id);
    if (!ind) return;
    ind.hidden = !ind.hidden;
    indicatorsChanged();
  }

  // ---------- 图表类型 (照 TradingView 的分组) ----------
  var CHART_TYPE_KEY = 'bursa_chart_type_v1';
  function icon(path, extra) {
    return '<svg class="ico" viewBox="0 0 18 18" aria-hidden="true"' + (extra || '') + '>' + path + '</svg>';
  }
  var ICONS = {
    bars: icon('<path d="M5 3v12M3 6h2M5 11h2M12 2v13M10 5h2M12 12h2"/>'),
    candles: icon('<path d="M5 2v14M12 2v14"/><rect x="3" y="5" width="4" height="7" class="f"/><rect x="10" y="4" width="4" height="6" class="f"/>'),
    hollow: icon('<path d="M5 2v3M5 12v4M12 2v2M12 10v6"/><rect x="3" y="5" width="4" height="7"/><rect x="10" y="4" width="4" height="6" class="f"/>'),
    volcandles: icon('<path d="M5 2v14M13 3v12"/><rect x="2.5" y="5" width="5" height="7"/><rect x="11.5" y="6" width="3" height="5"/>'),
    line: icon('<path d="M2 13l4-5 4 3 6-7"/>'),
    linemarkers: icon('<path d="M2 13l4-5 4 3 6-7"/><circle cx="6" cy="8" r="1.4" class="f"/><circle cx="10" cy="11" r="1.4" class="f"/>'),
    step: icon('<path d="M2 14h4V9h4v3h3V4h3"/>'),
    area: icon('<path d="M2 13l4-5 4 3 6-7v12H2z" class="f2"/><path d="M2 13l4-5 4 3 6-7"/>'),
    hlc: icon('<path d="M2 7l4-3 4 2 6-3M2 14l4-3 4 2 6-3" /><path d="M2 11l4-4 4 3 6-4" class="thick"/>'),
    baseline: icon('<path d="M1 9h16" stroke-dasharray="2 2"/><path d="M2 12l4-6 4 5 6-8"/>'),
    columns: icon('<path d="M3 16V9M7 16V5M11 16V8M15 16V3" class="thick"/>'),
    highlow: icon('<rect x="3" y="4" width="3" height="9"/><rect x="11" y="3" width="3" height="7"/>'),
    heikin: icon('<path d="M5 2v14M12 2v14"/><rect x="3" y="4" width="4" height="8"/><rect x="10" y="6" width="4" height="7" class="f"/>'),
    other: icon('<path d="M3 3h4v4H3zM11 3h4v4h-4zM3 11h4v4H3zM11 11h4v4h-4z"/>')
  };
  var NOT_SUPPORTED = '暂不支持 (要非时间轴的图表)';
  var CHART_TYPE_GROUPS = [
    [{ id: 'bars', name: '美国线' }, { id: 'candles', name: 'K线图' }, { id: 'hollow', name: '空心K线图' }, { id: 'volcandles', name: '成交量蜡烛', off: '暂不支持 (蜡烛宽度要随成交量变化)' }],
    [{ id: 'line', name: '线形图' }, { id: 'linemarkers', name: '带标记线' }, { id: 'step', name: '阶梯线' }],
    [{ id: 'area', name: '面积图' }, { id: 'hlc', name: 'HLC区域' }, { id: 'baseline', name: '基准线' }],
    [{ id: 'columns', name: '柱状图' }, { id: 'highlow', name: '高-低' }],
    [{ id: 'vp1', name: '成交量轨迹', off: '暂不支持 (要逐笔成交数据)' }, { id: 'vp2', name: '时间价格机会', off: '暂不支持 (要逐笔成交数据)' }, { id: 'vp3', name: '交易时段成交量分布图', off: '暂不支持 (要逐笔成交数据)' }],
    [{ id: 'heikin', name: '平均K线图' }, { id: 'renko', name: '砖形图', off: NOT_SUPPORTED }, { id: 'linebreak', name: '新价线', off: NOT_SUPPORTED },
      { id: 'kagi', name: '卡吉图', off: NOT_SUPPORTED }, { id: 'pnf', name: '点数图', off: NOT_SUPPORTED }, { id: 'range', name: '范围图', off: NOT_SUPPORTED }]
  ];
  function chartTypeById(id) {
    for (var g = 0; g < CHART_TYPE_GROUPS.length; g++) {
      for (var i = 0; i < CHART_TYPE_GROUPS[g].length; i++) if (CHART_TYPE_GROUPS[g][i].id === id) return CHART_TYPE_GROUPS[g][i];
    }
    return null;
  }
  var chartType = loadJSON(CHART_TYPE_KEY, 'hollow');
  if (!chartTypeById(chartType) || chartTypeById(chartType).off) chartType = 'hollow';

  // 平均K线 (Heikin Ashi): 收 = 四价平均，开 = 上一根的 (开+收)/2
  function heikinAshi(bars) {
    var out = [];
    bars.forEach(function (b, i) {
      var close = (b.open + b.high + b.low + b.close) / 4;
      var open = i === 0 ? (b.open + b.close) / 2 : (out[i - 1].open + out[i - 1].close) / 2;
      out.push({ time: b.time, open: open, high: Math.max(b.high, open, close), low: Math.min(b.low, open, close), close: close });
    });
    return out;
  }

  // ---------- K 线图 ----------
  function isPhone() { return window.innerWidth < 640; }
  function mainPaneHeight() { return isPhone() ? 300 : 440; }
  function subPaneHeight() { return isPhone() ? 110 : 140; }
  // 完整图表对话框里的主图是正方形 (data-square)：高 = 宽，限制在 260–720px
  function mainHeightOf(el) {
    return el && el.dataset.square ? Math.max(260, Math.min(720, Math.round(el.clientWidth))) : mainPaneHeight();
  }
  // 手机 (没有鼠标): 在图表上下滑 = 滑动整个页面 (图表只接左右拖动)；右边价格轴不能拖动缩放，
  // 不然用拇指在右边滑页面时老是误触把价格轴拉歪
  var TOUCH_ONLY = !!(window.matchMedia && window.matchMedia('(hover: none)').matches);

  function volumeData(bars) {
    return bars.map(function (b) {
      return { time: b.time, value: b.volume, color: withAlpha(b.close >= b.open ? colors.up : colors.down, 0.55) };
    });
  }
  // 主图 (价格) 系列: 按图表类型建立，返回 {main, extras}
  function createMainSeries(st) {
    var chart = st.chart, up = colors.up, down = colors.down, extras = [], main;
    var base = { priceLineVisible: true, lastValueVisible: true };
    switch (chartType) {
      case 'bars':
        main = chart.addSeries(LWC.BarSeries, Object.assign({ upColor: up, downColor: down, openVisible: true, thinBars: false }, base));
        break;
      case 'candles':
        main = chart.addSeries(LWC.CandlestickSeries, Object.assign({ upColor: up, downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down }, base));
        break;
      case 'heikin':
        main = chart.addSeries(LWC.CandlestickSeries, Object.assign({ upColor: up, downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down }, base));
        break;
      case 'highlow':
        main = chart.addSeries(LWC.CandlestickSeries, Object.assign({ upColor: withAlpha(colors.ema, 0.75), downColor: withAlpha(colors.ema, 0.75), borderVisible: false, wickVisible: false }, base));
        break;
      case 'line':
      case 'linemarkers':
      case 'step':
        main = chart.addSeries(LWC.LineSeries, Object.assign({ color: colors.ema, lineWidth: 2, lineType: chartType === 'step' ? LWC.LineType.WithSteps : LWC.LineType.Simple,
          pointMarkersVisible: chartType === 'linemarkers', pointMarkersRadius: 2 }, base));
        break;
      case 'area':
        main = chart.addSeries(LWC.AreaSeries, Object.assign({ lineColor: colors.ema, topColor: withAlpha(colors.ema, 0.35), bottomColor: withAlpha(colors.ema, 0.02), lineWidth: 2 }, base));
        break;
      case 'baseline':
        main = chart.addSeries(LWC.BaselineSeries, Object.assign({ topLineColor: up, topFillColor1: withAlpha(up, 0.28), topFillColor2: withAlpha(up, 0.04),
          bottomLineColor: down, bottomFillColor1: withAlpha(down, 0.04), bottomFillColor2: withAlpha(down, 0.28), lineWidth: 2 }, base));
        break;
      case 'columns':
        main = chart.addSeries(LWC.HistogramSeries, Object.assign({ base: 0 }, base));
        break;
      case 'hlc':
        main = chart.addSeries(LWC.LineSeries, Object.assign({ color: colors.text, lineWidth: 2 }, base));
        extras.push(chart.addSeries(LWC.LineSeries, { color: withAlpha(up, 0.9), lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }));
        extras.push(chart.addSeries(LWC.LineSeries, { color: withAlpha(down, 0.9), lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }));
        break;
      default: // hollow 空心K线: 上涨只描边，下跌实心
        main = chart.addSeries(LWC.CandlestickSeries, Object.assign({ upColor: 'rgba(0, 0, 0, 0)', downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down, borderVisible: true }, base));
    }
    st.main = main;
    st.extras = extras;
  }
  function setMainData(st) {
    var bars = st.bars;
    // 换周期会重新 setData；上一次挂上去的填色要先拆掉，不然会越叠越多
    (st.mainPrims || []).forEach(function (x) { x.series.detachPrimitive(x.prim); });
    st.mainPrims = [];
    switch (chartType) {
      case 'line': case 'linemarkers': case 'step': case 'area':
        st.main.setData(bars.map(function (b) { return { time: b.time, value: b.close }; }));
        break;
      case 'baseline':
        var sorted = bars.map(function (b) { return b.close; }).sort(function (a, b) { return a - b; });
        st.main.applyOptions({ baseValue: { type: 'price', price: sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0 } }); // 基准 = 收盘价中位数
        st.main.setData(bars.map(function (b) { return { time: b.time, value: b.close }; }));
        break;
      case 'columns':
        st.main.setData(bars.map(function (b, i) {
          var up = i === 0 ? b.close >= b.open : b.close >= bars[i - 1].close;
          return { time: b.time, value: b.close, color: up ? colors.up : colors.down };
        }));
        break;
      case 'highlow':
        st.main.setData(bars.map(function (b) { return { time: b.time, open: b.high, high: b.high, low: b.low, close: b.low }; }));
        break;
      case 'heikin':
        st.main.setData(heikinAshi(bars));
        break;
      case 'hlc':
        st.main.setData(bars.map(function (b) { return { time: b.time, value: b.close }; }));
        st.extras[0].setData(bars.map(function (b) { return { time: b.time, value: b.high }; }));
        st.extras[1].setData(bars.map(function (b) { return { time: b.time, value: b.low }; }));
        var hi = bars.map(function (b) { return { time: b.time, a: b.high, b: b.close, color: withAlpha(colors.up, 0.18) }; });
        var lo = bars.map(function (b) { return { time: b.time, a: b.close, b: b.low, color: withAlpha(colors.down, 0.18) }; });
        st.mainPrims = [{ series: st.main, prim: new BandPrimitive(hi) }, { series: st.extras[0], prim: new BandPrimitive(lo) }];
        st.mainPrims.forEach(function (x) { x.series.attachPrimitive(x.prim); });
        break;
      default:
        st.main.setData(bars);
    }
  }
  function setBaseData(st) {
    setMainData(st);
    st.volume.setData(volumeData(st.bars));
    var emaPoints = toPoints(st.bars, seriesEMA(st.bars.map(function (b) { return b.close; }), 20));
    st.ema.setData(emaPoints);
    st.emaLast = lastValue(emaPoints);
  }

  function scaleOptions(ind, paneIndex) {
    if (paneIndex !== 0) return {};
    var scale = indScale(ind);
    if (scale === 'volume') return { priceScaleId: '' };
    if (scale === 'own') return { priceScaleId: 'ind-' + ind.id };
    return {};
  }
  function computePlots(ind, bars, tf) {
    var def = defOf(ind), p = ind.params;
    if (def === CUSTOM_DEF) return { value: toPoints(bars, formulaValues(bars, ind.formula)) };
    if (def.id === 'ichimoku') return ichimokuSeries(bars, tf, p);
    if (def.id === 'psar') {
      return { sar: toPoints(bars, seriesPSAR(bars.map(function (b) { return b.high; }), bars.map(function (b) { return b.low; }), bars.map(function (b) { return b.close; }), p.start, p.max)) };
    }
    var out = {};
    Object.keys(def.formulas).forEach(function (k) { out[k] = toPoints(bars, formulaValues(bars, fillTemplate(def.formulas[k], p))); });
    return out;
  }
  function plotColor(ind, plot) { return (ind.colors && ind.colors[plot.key]) || plot.color; }
  function plotNegColor(ind, plot) { return (ind.colors && ind.colors[plot.key + '_neg']) || plot.negColor; }

  // 返回 [{series, color, last, optional}]
  function addIndicatorSeries(st, ind, paneIndex) {
    var chart = st.chart, bars = st.bars, def = defOf(ind), p = ind.params;
    function lineSeries(color, extra) {
      var opts = Object.assign({ color: color, lineWidth: ind.width || 2, priceLineVisible: false, lastValueVisible: paneIndex > 0, crosshairMarkerVisible: false },
        scaleOptions(ind, paneIndex), extra || {});
      return chart.addSeries(LWC.LineSeries, opts, paneIndex);
    }
    if (def.id === 'supertrend') {
      var up = plotColor(ind, def.plots[0]), down = plotColor(ind, def.plots[1]);
      var stv = seriesSupertrend(bars, p.factor, p.atr);
      // 两条"隐形"的线: 线由 SupertrendPrimitive 画 (图表库的折线遇到空白点不会断开)，
      // 这两条只用来撑价格坐标轴范围、给图例取数值
      var sides = [{ dir: -1, color: up }, { dir: 1, color: down }].map(function (side) {
        var series = lineSeries(side.color, { lineVisible: false, lastValueVisible: false });
        series.setData(bars.map(function (b, i) { return stv.direction[i] === side.dir ? { time: b.time, value: stv.value[i] } : { time: b.time }; }));
        var n = bars.length;
        return { series: series, color: side.color, last: n && stv.direction[n - 1] === side.dir ? stv.value[n - 1] : null, optional: true };
      });
      var drawn = [];
      bars.forEach(function (b, i) {
        if (stv.direction[i] === null) return;
        var isUp = stv.direction[i] === -1;
        drawn.push({ time: b.time, mid: (b.open + b.close) / 2, value: stv.value[i], line: isUp ? up : down, fill: withAlpha(isUp ? up : down, 0.1) });
      });
      sides[0].series.attachPrimitive(new SupertrendPrimitive(drawn));
      return sides;
    }
    var plots = computePlots(ind, bars, st.tf);
    var parts = def.plots.map(function (plot) {
      var color = plotColor(ind, plot), data = plots[plot.key] || [], series;
      if (plot.type === 'hist') {
        var neg = plotNegColor(ind, plot);
        series = chart.addSeries(LWC.HistogramSeries, Object.assign({ priceLineVisible: false, lastValueVisible: false }, scaleOptions(ind, paneIndex)), paneIndex);
        series.setData(data.map(function (pt) { return { time: pt.time, value: pt.value, color: pt.value >= 0 ? color : neg }; }));
      } else {
        series = lineSeries(color, plot.type === 'dots' ? { lineVisible: false, pointMarkersVisible: true, pointMarkersRadius: 1.5 } : null);
        series.setData(data);
      }
      return { series: series, color: color, last: lastValue(data) };
    });
    if (def.levels && parts.length) {
      def.levels.forEach(function (lv) {
        parts[parts.length - 1].series.createPriceLine({ price: lv, color: withAlpha(colors.text, 0.5), lineWidth: 1, lineStyle: LWC.LineStyle.Dashed, axisLabelVisible: false });
      });
    }
    if (def.band) {
      var bByTime = {};
      (plots[def.band.b] || []).forEach(function (pt) { bByTime[pt.time] = pt.value; });
      var fill = withAlpha(plotColor(ind, def.plots[1]), def.band.alpha);
      var band = (plots[def.band.a] || []).filter(function (pt) { return pt.time in bByTime; })
        .map(function (pt) { return { time: pt.time, a: pt.value, b: bByTime[pt.time], color: fill }; });
      parts[0].series.attachPrimitive(new BandPrimitive(band));
    }
    if (def.id === 'ichimoku') parts[3].series.attachPrimitive(new CloudPrimitive(plots.leadA, plots.leadB));
    if (paneIndex === 0 && indScale(ind) === 'own') parts[0].series.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: 0.25 } });
    return parts;
  }

  function rebuildIndicators(st) {
    var chart = st.chart;
    st.entries.forEach(function (entry) { entry.parts.forEach(function (p) { chart.removeSeries(p.series); }); });
    st.entries = [];
    while (chart.panes().length > 1) chart.removePane(chart.panes().length - 1);

    indicators().forEach(function (ind) {
      var entry = { ind: ind, parts: [], pane: 0, error: null };
      if (ind.hidden) {
        entry.pane = ind.pane === 'sub' ? -1 : 0; // 隐藏的副图指标不开窗格，图例放主图里 (灰色)
      } else {
        var paneIndex = ind.pane === 'sub' ? chart.panes().length : 0;
        try {
          entry.parts = addIndicatorSeries(st, ind, paneIndex);
          entry.pane = paneIndex;
        } catch (e) {
          entry.error = e.message;
          entry.pane = ind.pane === 'sub' ? -1 : 0;
        }
      }
      st.entries.push(entry);
    });

    layoutPanes(st);
  }
  function layoutPanes(st) {
    var panes = st.chart.panes();
    var mainH = mainHeightOf(st.el), subH = subPaneHeight();
    var height = mainH + subH * (panes.length - 1);
    panes.forEach(function (pane, i) { pane.setStretchFactor(i === 0 ? mainH : subH); });
    st.el.style.height = height + 'px';
    st.chart.resize(st.el.clientWidth, height);
    requestAnimationFrame(function () { renderLegends(st); });
  }

  var VISIBLE_BARS_PHONE = 80;
  function showRecentBars(st) {
    var n = st.bars.length, extra = 0; // 一目均衡表往未来多画了 (位移 − 1) 根，也要露出来
    st.entries.forEach(function (e) { if (defOf(e.ind).id === 'ichimoku' && !e.error && !e.ind.hidden) extra = Math.max(extra, e.ind.params.displacement - 1); });
    var visible = isPhone() ? VISIBLE_BARS_PHONE : VISIBLE_BARS;
    st.chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - visible), to: n + extra + 2 });
  }

  function setTimeframe(st, tf) {
    var use = hasTf(st.id, tf) ? tf : tfById('D');
    var bars = barsFor(st.id, use);
    if (!bars || !bars.length) return;
    st.tf = use;
    st.bars = bars;
    st.index = {};
    bars.forEach(function (b, i) { st.index[b.time] = i; });
    st.chart.applyOptions({ timeScale: { timeVisible: isIntraday(use), secondsVisible: false } });
    setBaseData(st);
    rebuildIndicators(st);
    showRecentBars(st);
    updateQuoteLive(st, null);
    var note = document.getElementById(st.id + '-tfnote');
    if (note) {
      note.hidden = use === tf;
      note.textContent = use === tf ? '' : '这支股票这次没拿到「' + tf.label + '」的数据，显示的是日线';
    }
  }

  // ---------- 图表左上角图例: 名称 (点一下改参数) + 当前值 + 👁 ⚙ ↑ ↓ × ----------
  var ICON_EYE = icon('<path d="M1.5 9s2.8-5 7.5-5 7.5 5 7.5 5-2.8 5-7.5 5-7.5-5-7.5-5z"/><circle cx="9" cy="9" r="2.2"/>');
  var ICON_EYE_OFF = icon('<path d="M1.5 9s2.8-5 7.5-5 7.5 5 7.5 5-2.8 5-7.5 5-7.5-5-7.5-5z"/><path d="M3 15L15 3"/>');
  var ICON_GEAR = icon('<circle cx="9" cy="9" r="2.4"/><path d="M9 1.8v2.1M9 14.1v2.1M1.8 9h2.1M14.1 9h2.1M3.9 3.9l1.5 1.5M12.6 12.6l1.5 1.5M3.9 14.1l1.5-1.5M12.6 5.4l1.5-1.5"/>');
  var ICON_TRASH = icon('<path d="M3 5h12M7 5V3h4v2M5 5l1 10h6l1-10"/>');
  function paneTop(st, paneIndex) {
    var panes = st.chart.panes();
    var pane = panes[paneIndex];
    var el = pane && pane.getHTMLElement && pane.getHTMLElement();
    var wrapRect = st.legendsEl.getBoundingClientRect();
    if (el) return el.getBoundingClientRect().top - wrapRect.top;
    var top = 0;
    for (var i = 0; i < paneIndex; i++) top += panes[i].getHeight() + 1;
    return top;
  }
  function renderLegends(st) {
    var box = st.legendsEl;
    if (!box) return;
    var byPane = {};
    st.entries.forEach(function (e) {
      var p = e.pane === -1 ? 0 : e.pane;
      (byPane[p] = byPane[p] || []).push(e);
    });
    var list = indicators();
    var html = '';
    st.chart.panes().forEach(function (pane, p) {
      var rows = '';
      if (p === 0) {
        rows += '<div class="lg-row lg-base" data-base="ema"><span class="lg-swatch" style="background:' + colors.ema + '"></span>' +
          '<span class="lg-name lg-static">EMA 20</span><span class="lg-val"></span></div>';
      }
      (byPane[p] || []).forEach(function (e) {
        var idx = list.indexOf(e.ind);
        var name = escapeHtml(indLabel(e.ind));
        var canUp = neighborIndex(list, idx, -1) !== -1, canDown = neighborIndex(list, idx, 1) !== -1;
        var linePlots = defOf(e.ind).plots.filter(function (pl) { return pl.type !== 'hist'; });
        var swatch = plotColor(e.ind, linePlots[0] || defOf(e.ind).plots[0]);
        rows += '<div class="lg-row' + (e.error ? ' lg-error' : '') + (e.ind.hidden ? ' lg-hidden' : '') + '" data-ind="' + escapeHtml(e.ind.id) + '"' +
          (e.error ? ' title="' + escapeHtml(e.error) + '"' : '') + '>' +
          '<span class="lg-swatch" style="background:' + escapeHtml(swatch) + '"></span>' +
          '<button type="button" class="lg-name" data-act="gear" title="点一下修改参数">' + name + (e.error ? ' ⚠' : '') + '</button>' +
          '<span class="lg-val"></span>' +
          '<span class="lg-ctrl">' +
          '<button type="button" data-act="eye" title="' + (e.ind.hidden ? '显示' : '隐藏') + '" aria-label="' + (e.ind.hidden ? '显示 ' : '隐藏 ') + name + '">' + (e.ind.hidden ? ICON_EYE_OFF : ICON_EYE) + '</button>' +
          '<button type="button" data-act="gear" title="设置" aria-label="设置 ' + name + '">' + ICON_GEAR + '</button>' +
          '<button type="button" data-act="up" title="上移" aria-label="上移 ' + name + '"' + (canUp ? '' : ' disabled') + '>↑</button>' +
          '<button type="button" data-act="down" title="下移" aria-label="下移 ' + name + '"' + (canDown ? '' : ' disabled') + '>↓</button>' +
          '<button type="button" data-act="del" title="删除" aria-label="删除 ' + name + '">' + ICON_TRASH + '</button>' +
          '</span></div>';
      });
      html += '<div class="lg-pane" data-pane="' + p + '" style="top:' + (paneTop(st, p) + 4) + 'px">' + rows + '</div>';
    });
    box.innerHTML = html;
    updateLegendValues(st, null);
  }
  function updateLegendValues(st, seriesData) {
    var box = st.legendsEl;
    if (!box) return;
    function valueOf(series, fallback) {
      if (!seriesData) return fallback;
      var d = seriesData.get(series);
      return d && isNum(d.value) ? d.value : null;
    }
    var base = box.querySelector('[data-base="ema"] .lg-val');
    if (base) base.textContent = fmtValue(valueOf(st.ema, st.emaLast));
    st.entries.forEach(function (e) {
      var el = box.querySelector('[data-ind="' + (window.CSS && CSS.escape ? CSS.escape(e.ind.id) : e.ind.id) + '"] .lg-val');
      if (!el) return;
      el.innerHTML = e.parts.map(function (p) {
        var v = valueOf(p.series, p.last);
        if (p.optional && !isNum(v)) return '';
        return '<span style="color:' + p.color + '">' + fmtValue(v) + '</span>';
      }).join('');
    });
  }

  // ---------- 图表下方的 quote: 十字光标那根K线的 时间/开高低收/涨跌/量 ----------
  function updateQuoteLive(st, bar) {
    var el = document.getElementById(st.id + '-live');
    if (!el || !st.bars.length) return;
    var b = bar || st.bars[st.bars.length - 1];
    var i = st.index[b.time];
    var prev = i > 0 ? st.bars[i - 1] : null;
    function item(label, value, cls) {
      return '<span>' + label + ' <b' + (cls ? ' class="' + cls + '"' : '') + '>' + value + '</b></span>';
    }
    var html = '<span class="ql-time">' + fmtTime(b.time, st.tf) + ' · ' + st.tf.label + '</span>' +
      item('开', fmtPrice(b.open)) + item('高', fmtPrice(b.high)) + item('低', fmtPrice(b.low)) + item('收', fmtPrice(b.close));
    if (prev && prev.close) {
      var chg = b.close - prev.close, pct = chg / prev.close * 100;
      var cls = chg > 0 ? 'change-up' : chg < 0 ? 'change-down' : 'change-neutral';
      var sign = chg > 0 ? '+' : '';
      html += item('涨跌', sign + fmtPrice(chg) + ' (' + sign + pct.toFixed(2) + '%)', cls);
    }
    html += item('量', fmtVolume(b.volume));
    el.innerHTML = html;
  }
  function onCrosshair(st, param) {
    var i = param && param.time !== undefined ? st.index[param.time] : undefined;
    var hovering = i !== undefined && param.seriesData;
    updateQuoteLive(st, hovering ? st.bars[i] : null);
    updateLegendValues(st, hovering ? param.seriesData : null);
  }

  // ---------- 建图 / 拆图 ----------
  var currentTf = tfById(loadJSON(TF_STORAGE_KEY, 'D')) || tfById('D');
  function renderChart(chartId) {
    var el = document.getElementById(chartId);
    if (!el || !LWC || charts[chartId] || !data[chartId]) return;
    var chart = LWC.createChart(el, {
      width: el.clientWidth,
      height: mainHeightOf(el),
      layout: { background: { color: 'transparent' }, textColor: colors.text, attributionLogo: false, // 署名放在页脚
        panes: { separatorColor: colors.grid, separatorHoverColor: colors.grid } },
      grid: { vertLines: { color: colors.grid }, horzLines: { color: colors.grid } },
      rightPriceScale: { borderColor: colors.grid },
      timeScale: { borderColor: colors.grid, rightOffset: 2 },
      crosshair: { mode: LWC.CrosshairMode.Normal },
      handleScroll: { vertTouchDrag: !TOUCH_ONLY },
      handleScale: { axisPressedMouseMove: { time: true, price: !TOUCH_ONLY } },
      localization: { locale: 'zh-CN', dateFormat: 'yyyy-MM-dd' }
    });
    var st = { id: chartId, el: el, chart: chart, legendsEl: document.getElementById(chartId + '-legends'),
      tf: null, bars: [], index: {}, entries: [], emaLast: null, main: null, extras: [] };
    st.volume = chart.addSeries(LWC.HistogramSeries, { priceScaleId: '', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
    st.volume.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    createMainSeries(st);
    st.ema = chart.addSeries(LWC.LineSeries, { color: colors.ema, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    charts[chartId] = st;
    setTimeframe(st, currentTf);

    chart.subscribeCrosshairMove(function (param) { onCrosshair(st, param); });
    if (st.legendsEl && !st.legendsEl.dataset.bound) {
      st.legendsEl.dataset.bound = '1';
      st.legendsEl.addEventListener('click', function (e) {
        var btn = e.target.closest('button[data-act]');
        if (!btn) {
          // 手机上点图例这一行 (不是按钮) = 展开 / 收起这一行的按钮
          var tapped = e.target.closest('.lg-row[data-ind]');
          if (!tapped) return;
          var wasOpen = tapped.classList.contains('open');
          st.legendsEl.querySelectorAll('.lg-row.open').forEach(function (r) { r.classList.remove('open'); });
          if (!wasOpen) tapped.classList.add('open');
          return;
        }
        var row = btn.closest('[data-ind]');
        if (!row) return;
        var id = row.getAttribute('data-ind'), act = btn.dataset.act;
        if (act === 'del') removeIndicator(id);
        else if (act === 'eye') toggleHidden(id);
        else if (act === 'gear') openIndicatorSettings(id);
        else moveIndicator(id, act === 'up' ? -1 : 1);
      });
    }
    // 拖动副图之间的分隔线会改变窗格高度，放开后重新对齐图例
    st.onPointerUp = function () { requestAnimationFrame(function () { renderLegends(st); }); };
    el.addEventListener('pointerup', st.onPointerUp);
    st.ro = new ResizeObserver(function (entries) {
      var w = entries[0].contentRect.width;
      if (!w || w === st.lastWidth) return;
      st.lastWidth = w;
      if (el.dataset.square) { layoutPanes(st); return; } // 正方形主图: 宽度变了高度也要跟着变
      chart.resize(w, el.clientHeight);
      requestAnimationFrame(function () { renderLegends(st); });
    });
    st.ro.observe(el);
  }
  function destroyChart(chartId) {
    var st = charts[chartId];
    if (!st) return;
    st.ro.disconnect();
    st.el.removeEventListener('pointerup', st.onPointerUp);
    st.chart.remove();
    if (st.legendsEl) st.legendsEl.innerHTML = '';
    delete charts[chartId];
  }
  // 换图表类型 / 换颜色: 已经画好的图全部重建
  function rerenderAll() {
    Object.keys(charts).forEach(function (id) { destroyChart(id); renderChart(id); });
  }

  // ---------- 通用对话框 / 下拉菜单 ----------
  var openDialogs = [];
  function openDialog(opts) {
    var overlay = document.createElement('div');
    overlay.className = 'dlg-overlay';
    var titleId = newId('dlg-title');
    overlay.innerHTML = '<div class="dlg ' + (opts.className || '') + '" role="dialog" aria-modal="true" aria-labelledby="' + titleId + '">' +
      '<div class="dlg-head"><h3 id="' + titleId + '">' + escapeHtml(opts.title) + '</h3><button type="button" class="dlg-x" aria-label="关闭">×</button></div>' +
      '<div class="dlg-body"></div>' + (opts.footer ? '<div class="dlg-foot"></div>' : '') + '</div>';
    var dlg = overlay.firstChild;
    var body = dlg.querySelector('.dlg-body');
    if (typeof opts.body === 'string') body.innerHTML = opts.body; else if (opts.body) body.appendChild(opts.body);
    var previousFocus = opts.previousFocus || document.activeElement;
    var layer = null;
    var handle = {
      el: dlg, body: body, foot: dlg.querySelector('.dlg-foot'),
      // how: true = 按了返回 (history 已经退回去了)；{ keep: true } = 换下一支股票，history 那一格留给下一个对话框
      close: function (how) {
        if (!overlay.parentNode) return null;
        var fromPop = how === true, keep = !!(how && how.keep);
        overlay.parentNode.removeChild(overlay);
        document.removeEventListener('keydown', onKey, true);
        openDialogs.splice(openDialogs.indexOf(handle), 1);
        if (!openDialogs.length) document.documentElement.classList.remove('dlg-open');
        if (opts.onClose) opts.onClose();
        if (!fromPop && !keep) releaseLayer(layer);
        if (!keep && opts.deepLinked) stripHash();
        if (!keep && previousFocus && previousFocus.focus && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
        return keep ? { layer: layer, previousFocus: previousFocus } : null;
      }
    };
    if (opts.reuse && opts.reuse.layer && histLayers.indexOf(opts.reuse.layer) !== -1) {
      layer = opts.reuse.layer;
      layer.close = handle.close;
      retargetLayer(layer, opts.url);
    } else if (!opts.deepLinked) {
      layer = pushLayer(handle.close, opts.url);
    }
    function onKey(e) {
      if (openDialogs[openDialogs.length - 1] !== handle) return;
      if (e.key === 'Escape') { e.stopPropagation(); handle.close(); }
      if (e.key === 'Tab') { // 焦点留在对话框里
        var f = dlg.querySelectorAll('button:not([disabled]), input:not([disabled]), select, textarea, [tabindex="0"]');
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    }
    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) handle.close(); });
    dlg.querySelector('.dlg-x').addEventListener('click', handle.close);
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);
    document.documentElement.classList.add('dlg-open');
    openDialogs.push(handle);
    setTimeout(function () {
      // 手机 / 平板上不要一打开就把光标放进输入框: 键盘会弹出来挡住一半，iPhone 还会因为输入框字号小
      // 而自动放大整页，对话框顶部 (标题、×) 就被推到屏幕外 → 没有鼠标的设备上焦点先放在 × 上
      var first = dlg.querySelector(TOUCH_ONLY ? '.dlg-x' : (opts.focus || 'input, select, textarea, button:not(.dlg-x)'));
      if (first) first.focus({ preventScroll: true });
    }, 0);
    return handle;
  }
  var openMenu = null;
  function closeMenu() {
    if (!openMenu) return;
    openMenu.menu.hidden = true;
    openMenu.button.setAttribute('aria-expanded', 'false');
    openMenu = null;
  }
  document.addEventListener('mousedown', function (e) {
    if (openMenu && !openMenu.menu.contains(e.target) && !openMenu.button.contains(e.target)) closeMenu();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && openMenu) { var b = openMenu.button; closeMenu(); b.focus(); }
  });

  // ---------- 全局工具栏: 周期 | 图表类型 ▾ | ƒx 指标 | 模板 | ⚙ ----------
  function anyChartHas(tf) {
    return Object.keys(data).some(function (id) { return hasTf(id, tf); });
  }
  // 周期选择: [分时 ▾] 天 周 月 —— 1 分到 4 小时 9 个周期收进一个选单 (手机上是底部弹出)，
  // 不再是一整条要左右滑、两头被切掉半个字的按钮条。卡片上方的全局工具栏和完整图表对话框共用
  function buildTfControl(box, isAvailable, onPick) {
    var intra = TIMEFRAMES.filter(isIntraday), main = TIMEFRAMES.filter(function (tf) { return !isIntraday(tf); });
    box.classList.add('tf-compact');
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', 'K线周期');
    box.innerHTML = '<div class="tb-menu-wrap tf-intra"><button type="button" class="tf-btn tf-intra-btn" aria-haspopup="menu" aria-expanded="false" aria-selected="false">' +
      '<span class="tf-intra-label">分时</span><span class="tf-caret" aria-hidden="true">▾</span></button>' +
      '<div class="tb-menu tf-menu" role="menu" aria-label="分钟 / 小时周期" hidden>' + intra.map(function (tf) {
        var ok = isAvailable(tf);
        return '<button type="button" role="menuitemradio" class="tb-menu-item" data-tf="' + tf.id + '" aria-checked="false" tabindex="-1"' +
          (ok ? '' : ' aria-disabled="true"') + '><span>' + tf.label + '</span>' + (ok ? '' : '<small>没有数据</small>') + '</button>';
      }).join('') + '</div></div>' +
      main.map(function (tf) {
        return '<button type="button" class="tf-btn" data-tf="' + tf.id + '" aria-selected="false"' + (isAvailable(tf) ? '' : ' disabled title="没有' + tf.label + '线的数据"') + '>' + tf.label + '</button>';
      }).join('');
    var menuBtn = box.querySelector('.tf-intra-btn'), menu = box.querySelector('.tf-menu');
    menuBtn.addEventListener('click', function () {
      if (openMenu && openMenu.menu === menu) { closeMenu(); return; }
      closeMenu();
      menu.hidden = false;
      menuBtn.setAttribute('aria-expanded', 'true');
      openMenu = { menu: menu, button: menuBtn };
      var cur = menu.querySelector('[aria-checked="true"]') || menu.querySelector('.tb-menu-item:not([aria-disabled])');
      if (cur) cur.focus();
    });
    menu.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      var items = Array.prototype.slice.call(menu.querySelectorAll('.tb-menu-item:not([aria-disabled])'));
      var next = items[(items.indexOf(document.activeElement) + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
      if (next) { e.preventDefault(); next.focus(); }
    });
    box.addEventListener('click', function (e) {
      var b = e.target.closest('[data-tf]');
      if (!b || b.disabled || b.getAttribute('aria-disabled') === 'true') return;
      if (menu.contains(b)) { closeMenu(); menuBtn.focus({ preventScroll: true }); }
      onPick(tfById(b.dataset.tf));
    });
    return function mark(tf) {
      var isIntra = !!(tf && isIntraday(tf));
      box.querySelectorAll('.tf-btn[data-tf]').forEach(function (b) { b.setAttribute('aria-selected', tf && b.dataset.tf === tf.id ? 'true' : 'false'); });
      menuBtn.setAttribute('aria-selected', isIntra ? 'true' : 'false');
      box.querySelector('.tf-intra-label').textContent = isIntra ? tf.label : '分时';
      menu.querySelectorAll('[data-tf]').forEach(function (b) {
        var on = !!(tf && b.dataset.tf === tf.id);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
        b.classList.toggle('on', on);
      });
    };
  }
  var markToolbarTf = null;
  function buildToolbar() {
    var bar = document.getElementById('chart-toolbar');
    if (!bar) return;
    bar.innerHTML =
      '<div class="tb-tf"></div>' +
      '<div class="tb-tools">' +
      '<div class="tb-menu-wrap"><button type="button" class="tb-btn" id="tb-type" aria-haspopup="menu" aria-expanded="false" title="图表类型"></button>' +
      '<div class="tb-menu" id="tb-type-menu" role="menu" hidden></div></div>' +
      '<button type="button" class="tb-btn" id="tb-ind" title="指标"><span class="fx">ƒx</span><span class="tb-label">指标</span></button>' +
      '<button type="button" class="tb-btn" id="tb-tpl" title="指标模板">' + icon('<path d="M3 3h5v5H3zM10 3h5v5h-5zM3 10h5v5H3zM10 10h5v5h-5z"/>') + '<span class="tb-label">模板</span></button>' +
      '<button type="button" class="tb-btn" id="tb-settings" title="图表设置" aria-label="图表设置">' + ICON_GEAR + '</button>' +
      '</div>';
    markToolbarTf = buildTfControl(bar.querySelector('.tb-tf'), anyChartHas, applyTimeframe);

    var typeBtn = bar.querySelector('#tb-type'), typeMenu = bar.querySelector('#tb-type-menu');
    typeBtn.addEventListener('click', function () {
      if (openMenu && openMenu.menu === typeMenu) { closeMenu(); return; }
      closeMenu();
      renderTypeMenu();
      typeMenu.hidden = false;
      typeBtn.setAttribute('aria-expanded', 'true');
      openMenu = { menu: typeMenu, button: typeBtn };
      var cur = typeMenu.querySelector('[aria-checked="true"]');
      if (cur) cur.focus();
    });
    typeMenu.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      var items = Array.prototype.slice.call(typeMenu.querySelectorAll('[role="menuitemradio"]:not([aria-disabled="true"])'));
      var i = items.indexOf(document.activeElement);
      var next = items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
      if (next) { e.preventDefault(); next.focus(); }
    });
    bar.querySelector('#tb-ind').addEventListener('click', function () { openIndicatorsDialog('all'); });
    bar.querySelector('#tb-tpl').addEventListener('click', function () { openIndicatorsDialog('mytpl'); });
    bar.querySelector('#tb-settings').addEventListener('click', openSettingsDialog);
    updateToolbar();
  }
  function renderTypeMenu() {
    var menu = document.getElementById('tb-type-menu');
    menu.innerHTML = CHART_TYPE_GROUPS.map(function (group) {
      return '<div class="tb-menu-group">' + group.map(function (t) {
        var on = t.id === chartType;
        return '<button type="button" role="menuitemradio" class="tb-menu-item' + (on ? ' on' : '') + '" data-type="' + t.id + '" aria-checked="' + on + '"' +
          (t.off ? ' aria-disabled="true" title="' + escapeHtml(t.off) + '"' : '') + ' tabindex="-1">' +
          (ICONS[t.id] || ICONS.other) + '<span>' + t.name + '</span>' + (t.off ? '<small>暂不支持</small>' : '') + '</button>';
      }).join('') + '</div>';
    }).join('');
    menu.querySelectorAll('[data-type]').forEach(function (item) {
      item.addEventListener('click', function () {
        var t = chartTypeById(item.dataset.type);
        if (t.off) { toast(t.name + '：' + t.off); return; }
        chartType = t.id;
        saveJSON(CHART_TYPE_KEY, chartType);
        closeMenu();
        updateToolbar();
        rerenderAll();
        document.getElementById('tb-type').focus();
      });
    });
  }
  function updateToolbar() {
    var bar = document.getElementById('chart-toolbar');
    if (!bar) return;
    if (markToolbarTf) markToolbarTf(currentTf);
    var t = chartTypeById(chartType);
    var typeBtn = document.getElementById('tb-type');
    if (typeBtn) {
      typeBtn.innerHTML = (ICONS[t.id] || ICONS.other) + '<span class="tb-label">' + t.name + '</span><span class="tb-caret">▾</span>';
      typeBtn.setAttribute('aria-label', '图表类型：' + t.name);
    }
  }
  function applyTimeframe(tf) {
    currentTf = tf;
    saveJSON(TF_STORAGE_KEY, tf.id);
    Object.keys(charts).forEach(function (id) { setTimeframe(charts[id], tf); });
    updateToolbar();
  }

  // ---------- 指标对话框 (照 TradingView "指标、衡量标准和策略" 的分类) ----------
  var placement = 'auto'; // 新指标放在哪: 自动 / 主图 / 新副图
  function paneFor(scale) { return placement === 'auto' ? autoPane(scale) : placement; }
  var NAV = [
    { group: '个人', items: [{ id: 'fav', name: '收藏', icon: '★' }, { id: 'scripts', name: '我的脚本', icon: 'ƒ' }] },
    { group: '模板', items: [{ id: 'mytpl', name: '我的模板', icon: '▦' }, { id: 'builtintpl', name: '内置模板', icon: '▤' }] },
    { group: '内置', items: [{ id: 'all', name: '技术指标', icon: '∿' }].concat(CATEGORIES.map(function (c) { return { id: c.id, name: c.name, icon: '·', sub: true }; })) }
  ];
  function countInTemplate(defId) {
    return indicators().filter(function (i) { return i.def === defId; }).length;
  }
  function addIndicatorFromDef(defId) {
    var ind = makeIndicator(defId, paneFor(DEF_BY_ID[defId].scale));
    indicators().push(ind);
    indicatorsChanged();
    toast('已添加 ' + indLabel(ind) + (ind.pane === 'sub' ? '（新副图）' : '（主图）'));
  }
  function addIndicatorFromScript(sc) {
    var ind = { id: newId('ind'), def: 'custom', name: sc.name, formula: sc.formula, scale: sc.scale || 'price', params: {},
      colors: { value: sc.color || '#e8a33d' }, width: 2, pane: paneFor(sc.scale || 'price'), hidden: false };
    indicators().push(ind);
    indicatorsChanged();
    toast('已添加 ' + sc.name);
  }
  // 公式用一段假数据试算一次，有错当场提示
  function testFormula(formula) {
    formulaValues([1, 2, 3, 4, 5].map(function (v, i) { return { time: i, open: v, high: v + 1, low: v - 1, close: v, volume: 100 }; }), formula);
  }
  function openIndicatorsDialog(startView) {
    var view = startView || 'all';
    var query = '';
    var root = document.createElement('div');
    root.className = 'ind-dlg';
    root.innerHTML =
      '<div class="ind-dlg-top">' +
      '<input type="search" class="ind-search" placeholder="搜索指标、脚本或模板" aria-label="搜索" autocomplete="off">' +
      '<div class="ind-place" role="radiogroup" aria-label="新指标放在哪里"><span>添加到</span>' +
      ['auto:自动', 'main:主图', 'sub:新副图'].map(function (x) {
        var k = x.split(':');
        return '<button type="button" role="radio" data-place="' + k[0] + '" aria-checked="' + (placement === k[0]) + '">' + k[1] + '</button>';
      }).join('') + '</div></div>' +
      '<div class="ind-dlg-main"><nav class="ind-nav" aria-label="分类"></nav><div class="ind-pane" tabindex="-1"></div></div>';
    var nav = root.querySelector('.ind-nav'), pane = root.querySelector('.ind-pane'), search = root.querySelector('.ind-search');
    nav.innerHTML = NAV.map(function (g) {
      return '<div class="ind-nav-group"><div class="ind-nav-title">' + g.group + '</div>' + g.items.map(function (it) {
        return '<button type="button" class="ind-nav-item' + (it.sub ? ' sub' : '') + '" data-view="' + it.id + '"><span class="ind-nav-ico">' + it.icon + '</span>' + it.name + '</button>';
      }).join('') + '</div>';
    }).join('');
    root.querySelectorAll('.ind-place [data-place]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        placement = btn.dataset.place;
        root.querySelectorAll('.ind-place [data-place]').forEach(function (b) { b.setAttribute('aria-checked', b === btn ? 'true' : 'false'); });
      });
    });
    nav.addEventListener('click', function (e) {
      var b = e.target.closest('[data-view]');
      if (!b) return;
      view = b.dataset.view;
      search.value = '';
      query = '';
      render();
    });
    search.addEventListener('input', function () { query = search.value.trim().toLowerCase(); render(); });

    function indRow(def) {
      var fav = favorites.indexOf(def.id) !== -1, n = countInTemplate(def.id);
      return '<div class="ind-row" data-def="' + def.id + '">' +
        '<button type="button" class="ind-star' + (fav ? ' on' : '') + '" data-act="star" aria-label="' + (fav ? '取消收藏' : '收藏') + '" aria-pressed="' + fav + '">' + (fav ? '★' : '☆') + '</button>' +
        '<button type="button" class="ind-row-main" data-act="add"><span class="ind-row-name">' + escapeHtml(def.name) + '</span>' +
        (n ? '<span class="ind-badge">已加 ' + n + '</span>' : '') + '</button>' +
        '<span class="ind-row-cat">' + catName(def.category) + '</span>' +
        '<span class="ind-row-actions"><button type="button" data-act="info" title="说明" aria-label="说明">{ }</button>' +
        '<button type="button" data-act="add" title="添加" aria-label="添加 ' + escapeHtml(def.name) + '">＋</button></span>' +
        '<div class="ind-row-info" hidden>' + escapeHtml(def.desc || '') +
        (def.inputs.length ? '<br>默认参数：' + def.inputs.map(function (i) { return i.label + ' ' + i.def; }).join('，') : '') +
        (def.formulas ? '<br><code>' + escapeHtml(Object.keys(def.formulas).map(function (k) { return fillTemplate(def.formulas[k], defaultParams(def)); }).join('  |  ')) + '</code>' : '') +
        '</div></div>';
    }
    function scriptRow(sc, i) {
      return '<div class="ind-row" data-script="' + i + '">' +
        '<span class="ind-star static">ƒ</span>' +
        '<button type="button" class="ind-row-main" data-act="add-script"><span class="ind-row-name">' + escapeHtml(sc.name) + '</span></button>' +
        '<span class="ind-row-cat"><code>' + escapeHtml(sc.formula) + '</code></span>' +
        '<span class="ind-row-actions"><button type="button" data-act="add-script" aria-label="添加 ' + escapeHtml(sc.name) + '">＋</button>' +
        '<button type="button" data-act="del-script" aria-label="从我的脚本删除 ' + escapeHtml(sc.name) + '">' + ICON_TRASH + '</button></span></div>';
    }
    function tplRow(t) {
      var on = t.id === templates.active;
      return '<div class="ind-row' + (on ? ' active' : '') + '" data-tpl="' + escapeHtml(t.id) + '">' +
        '<span class="ind-star static">' + (on ? '●' : '○') + '</span>' +
        '<button type="button" class="ind-row-main" data-act="use-tpl"><span class="ind-row-name">' + escapeHtml(t.name || '未命名') + '</span>' +
        (on ? '<span class="ind-badge">使用中</span>' : '') + '</button>' +
        '<span class="ind-row-cat">' + escapeHtml(templateSummary(t)) + '</span>' +
        '<span class="ind-row-actions always">' + (on ? '' : '<button type="button" data-act="use-tpl">使用</button>') +
        '<button type="button" data-act="rename-tpl" title="改名" aria-label="模板 ' + escapeHtml(t.name) + ' 改名">✎</button>' +
        '<button type="button" data-act="del-tpl" aria-label="删除模板 ' + escapeHtml(t.name) + '">' + ICON_TRASH + '</button></span></div>';
    }
    function builtinRow(t) {
      return '<div class="ind-row" data-btpl="' + t.id + '">' +
        '<span class="ind-star static">' + (isStrategy(t) ? '◎' : '▤') + '</span>' +
        '<button type="button" class="ind-row-main" data-act="use-btpl"><span class="ind-row-name">' + escapeHtml(t.name) + '</span></button>' +
        '<span class="ind-row-cat">' + escapeHtml(t.desc) + '</span>' +
        '<span class="ind-row-actions always"><button type="button" data-act="use-btpl">套用</button></span></div>';
    }
    function header(title, extra) { return '<div class="ind-pane-head"><h4>' + title + '</h4>' + (extra || '') + '</div>'; }
    function render() {
      nav.querySelectorAll('[data-view]').forEach(function (b) { b.classList.toggle('active', !query && b.dataset.view === view); });
      var html = '';
      if (query) {
        var defs = INDICATOR_DEFS.filter(function (d) { return (d.name + ' ' + (d.desc || '') + ' ' + d.id + ' ' + (d.short ? d.short(defaultParams(d)) : '')).toLowerCase().indexOf(query) !== -1; });
        var scs = scripts.map(function (s, i) { return [s, i]; }).filter(function (x) { return (x[0].name + ' ' + x[0].formula).toLowerCase().indexOf(query) !== -1; });
        var tps = templates.list.filter(function (t) { return (t.name || '').toLowerCase().indexOf(query) !== -1; });
        var bts = BUILTIN_TEMPLATES.filter(function (t) { return (t.name + ' ' + t.desc).toLowerCase().indexOf(query) !== -1; });
        html += header('搜索结果');
        if (defs.length) html += '<div class="ind-list">' + defs.map(indRow).join('') + '</div>';
        if (scs.length) html += '<div class="ind-sub-head">我的脚本</div><div class="ind-list">' + scs.map(function (x) { return scriptRow(x[0], x[1]); }).join('') + '</div>';
        if (tps.length) html += '<div class="ind-sub-head">我的模板</div><div class="ind-list">' + tps.map(tplRow).join('') + '</div>';
        if (bts.length) html += '<div class="ind-sub-head">内置模板 (选股策略 / 指标组合)</div><div class="ind-list">' + bts.map(builtinRow).join('') + '</div>';
        if (!defs.length && !scs.length && !tps.length && !bts.length) html += '<p class="ind-empty">找不到「' + escapeHtml(query) + '」</p>';
      } else if (view === 'fav') {
        var favDefs = INDICATOR_DEFS.filter(function (d) { return favorites.indexOf(d.id) !== -1; });
        html += header('收藏');
        html += favDefs.length ? '<div class="ind-list">' + favDefs.map(indRow).join('') + '</div>' : '<p class="ind-empty">还没有收藏。在「技术指标」里点指标前面的 ☆ 就会出现在这里。</p>';
      } else if (view === 'scripts') {
        html += header('我的脚本');
        html += '<form class="script-form" novalidate>' +
          '<label>名称<input type="text" name="name" maxlength="40" placeholder="例如 SMA10" required></label>' +
          '<label class="grow">公式<input type="text" name="formula" maxlength="300" placeholder="例如 sma(close,10)" spellcheck="false" required></label>' +
          '<label>颜色<input type="color" name="color" value="#e8a33d"></label>' +
          '<label>坐标轴<select name="scale"><option value="price">跟价格同轴</option><option value="own">独立 (震荡类)</option><option value="volume">跟成交量同轴</option></select></label>' +
          '<button type="submit" class="btn-primary">保存并添加</button>' +
          '<p class="form-error" hidden></p>' +
          '<p class="hint">变量 <code>close</code> <code>open</code> <code>high</code> <code>low</code> <code>volume</code>；函数 <code>sma</code> <code>ema</code> <code>stdev</code> <code>highest</code> <code>lowest</code> <code>sum</code> <code>rsi</code> <code>atr</code> <code>obv</code> <code>abs</code>；' +
          '例如 <code>ema(close,12)-ema(close,26)</code></p></form>';
        html += scripts.length ? '<div class="ind-list">' + scripts.map(scriptRow).join('') + '</div>' : '<p class="ind-empty">还没有保存的脚本。</p>';
      } else if (view === 'mytpl') {
        html += header('我的模板', '<div class="head-actions"><button type="button" data-act="save-as">＋ 当前模板另存一份</button><button type="button" data-act="new-tpl">＋ 空白模板</button></div>');
        html += '<p class="hint">一个模板 = 选股条件 + 图表上的指标。筛选器标题下面那行小字就是正在使用的模板名称，点一下可以改名；' +
          '加、删、调整指标和条件都会自动存进正在使用的模板。模板只存在这个浏览器里，换手机 / 电脑前可以先导出备份。</p>';
        html += '<div class="ind-list">' + templates.list.map(tplRow).join('') + '</div>';
        html += '<div class="head-actions tpl-backup"><button type="button" data-act="export">⤓ 导出备份</button><button type="button" data-act="import">⤒ 导入备份</button>' +
          '<input type="file" class="tpl-import" accept="application/json,.json" hidden></div>';
      } else if (view === 'builtintpl') {
        html += header('内置模板') + '<p class="hint">套用后会复制成一个新的「我的模板」并切换过去，原来的模板不会被改动。' +
          '选股策略带条件，套用后筛选器会在今天报告里的全部股票中挑出符合的。</p>';
        html += '<div class="ind-sub-head">选股策略 (带条件)</div><div class="ind-list">' + BUILTIN_TEMPLATES.filter(isStrategy).map(builtinRow).join('') + '</div>';
        html += '<div class="ind-sub-head">指标组合</div><div class="ind-list">' + BUILTIN_TEMPLATES.filter(function (t) { return !isStrategy(t); }).map(builtinRow).join('') + '</div>';
      } else {
        var cats = view === 'all' ? CATEGORIES : CATEGORIES.filter(function (c) { return c.id === view; });
        html += header(view === 'all' ? '技术指标' : catName(view));
        cats.forEach(function (c) {
          if (view === 'all') html += '<div class="ind-sub-head">' + c.name + '</div>';
          html += '<div class="ind-list">' + INDICATOR_DEFS.filter(function (d) { return d.category === c.id; }).map(indRow).join('') + '</div>';
        });
      }
      pane.innerHTML = html;
      var form = pane.querySelector('.script-form');
      if (form) form.addEventListener('submit', onScriptSubmit);
      var fileInput = pane.querySelector('.tpl-import');
      if (fileInput) fileInput.addEventListener('change', function () { if (fileInput.files[0]) importBackup(fileInput.files[0]); });
    }
    function onScriptSubmit(e) {
      e.preventDefault();
      var f = e.target, err = f.querySelector('.form-error');
      var name = f.name.value.trim(), formula = f.formula.value.trim();
      err.hidden = true;
      function fail(msg) { err.textContent = msg; err.hidden = false; }
      if (!name || !formula) return fail('请填写名称和公式');
      try { testFormula(formula); } catch (ex) { return fail('公式错误：' + ex.message); }
      var sc = { name: name, formula: formula, color: f.color.value, scale: f.scale.value };
      scripts.push(sc);
      saveJSON(SCRIPTS_KEY, scripts);
      addIndicatorFromScript(sc);
    }
    pane.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-act]');
      if (!btn) return;
      var row = btn.closest('.ind-row'), act = btn.dataset.act;
      if (act === 'add') addIndicatorFromDef(row.dataset.def);
      else if (act === 'star') {
        var id = row.dataset.def, k = favorites.indexOf(id);
        if (k === -1) favorites.push(id); else favorites.splice(k, 1);
        saveJSON(FAV_KEY, favorites);
        render();
      } else if (act === 'info') {
        var info = row.querySelector('.ind-row-info');
        info.hidden = !info.hidden;
      } else if (act === 'add-script') addIndicatorFromScript(scripts[+row.dataset.script]);
      else if (act === 'del-script') {
        scripts.splice(+row.dataset.script, 1);
        saveJSON(SCRIPTS_KEY, scripts);
        render();
      } else if (act === 'use-tpl') {
        templates.active = row.dataset.tpl;
        indicatorsChanged();
        toast('已切换到模板「' + activeTemplate().name + '」');
      } else if (act === 'rename-tpl') {
        renameTemplate(templateById(row.dataset.tpl));
      } else if (act === 'del-tpl') {
        var t = templateById(row.dataset.tpl);
        if (!t || !window.confirm('删除模板「' + t.name + '」(' + templateSummary(t) + ')？')) return;
        templates.list = templates.list.filter(function (x) { return x !== t; });
        if (!templates.list.length) templates.list.push({ id: newId('tpl'), name: DEFAULT_TPL_NAME, indicators: [], rules: [], match: 'all' });
        if (!templates.list.some(function (x) { return x.id === templates.active; })) templates.active = templates.list[0].id;
        indicatorsChanged();
      } else if (act === 'save-as') {
        var cur = activeTemplate();
        var nt = newTemplate(cur.name + ' 副本', JSON.parse(JSON.stringify(cur.indicators)).map(function (i) { i.id = newId('ind'); return i; }),
          instantiateRules(cur.rules), cur.match);
        indicatorsChanged();
        toast('已建立模板「' + nt.name + '」，可以在筛选器标题下面改名');
      } else if (act === 'new-tpl') {
        var blank = newTemplate('筛选器 ' + (templates.list.length + 1));
        indicatorsChanged();
        toast('已建立模板「' + blank.name + '」，可以在筛选器标题下面改名');
      } else if (act === 'use-btpl') {
        var bt = builtinById(row.dataset.btpl);
        applyBuiltin(bt, false);
        toast('已套用内置模板「' + bt.name + '」');
      } else if (act === 'export') {
        exportBackup();
      } else if (act === 'import') {
        var input = pane.querySelector('.tpl-import');
        if (input) { input.value = ''; input.click(); }
      }
    });
    onIndicatorsChanged.push(render);
    render();
    return openDialog({
      title: '指标、模板和脚本', body: root, className: 'dlg-ind', focus: '.ind-search',
      onClose: function () { onIndicatorsChanged.splice(onIndicatorsChanged.indexOf(render), 1); }
    });
  }

  // ---------- 单个指标的设置 (点图例上的名称或 ⚙): 输入 / 样式 两页 ----------
  function openIndicatorSettings(id) {
    var ind = findIndicator(id);
    if (!ind) return;
    var def = defOf(ind), isCustom = def === CUSTOM_DEF;
    var root = document.createElement('form');
    root.className = 'ind-set';
    root.noValidate = true;
    var inputsHtml = isCustom
      ? '<label>名称<input type="text" name="name" maxlength="40" value="' + escapeHtml(ind.name || '') + '"></label>' +
        '<label>公式<textarea name="formula" rows="3" maxlength="300" spellcheck="false">' + escapeHtml(ind.formula || '') + '</textarea></label>' +
        '<label>坐标轴<select name="scale">' + [['price', '跟价格同轴'], ['own', '独立 (震荡类)'], ['volume', '跟成交量同轴']].map(function (o) {
          return '<option value="' + o[0] + '"' + (ind.scale === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
        }).join('') + '</select></label>'
      : def.inputs.length ? def.inputs.map(function (i) {
        return '<label>' + i.label + '<input type="number" inputmode="decimal" name="p_' + i.key + '" value="' + ind.params[i.key] + '" min="' + i.min + '" max="' + i.max + '" step="' + i.step + '"></label>';
      }).join('') : '<p class="hint">这个指标没有可以调的参数。</p>';
    var styleHtml = def.plots.map(function (pl) {
      var s = '<label class="color-row"><span>' + pl.label + '</span><input type="color" name="c_' + pl.key + '" value="' + plotColor(ind, pl) + '"></label>';
      if (pl.type === 'hist') s += '<label class="color-row"><span>' + pl.negLabel + '</span><input type="color" name="c_' + pl.key + '_neg" value="' + plotNegColor(ind, pl) + '"></label>';
      return s;
    }).join('') +
      '<label>线宽<select name="width">' + [1, 2, 3, 4].map(function (w) { return '<option value="' + w + '"' + ((ind.width || 2) === w ? ' selected' : '') + '>' + w + ' px</option>'; }).join('') + '</select></label>' +
      '<div class="seg" role="radiogroup" aria-label="位置"><span>位置</span>' +
      '<label><input type="radio" name="pane" value="main"' + (ind.pane === 'main' ? ' checked' : '') + '> 主图</label>' +
      '<label><input type="radio" name="pane" value="sub"' + (ind.pane === 'sub' ? ' checked' : '') + '> 副图</label></div>' +
      '<label class="check"><input type="checkbox" name="visible"' + (ind.hidden ? '' : ' checked') + '> 在图上显示</label>';
    root.innerHTML =
      '<div class="tabs" role="tablist"><button type="button" role="tab" data-tab="in" aria-selected="true">输入</button><button type="button" role="tab" data-tab="st" aria-selected="false">样式</button></div>' +
      '<div class="tab-page" data-page="in">' + inputsHtml + '</div>' +
      '<div class="tab-page" data-page="st" hidden>' + styleHtml + '</div>' +
      '<p class="form-error" hidden></p>' +
      (def.desc ? '<p class="hint">' + escapeHtml(def.desc) + '</p>' : '');
    root.querySelectorAll('[data-tab]').forEach(function (t) {
      t.addEventListener('click', function () {
        root.querySelectorAll('[data-tab]').forEach(function (x) { x.setAttribute('aria-selected', x === t ? 'true' : 'false'); });
        root.querySelectorAll('[data-page]').forEach(function (pg) { pg.hidden = pg.dataset.page !== t.dataset.tab; });
      });
    });
    var dlg = openDialog({ title: isCustom ? (ind.name || '自定义公式') : def.name, body: root, footer: true, className: 'dlg-set' });
    // 点图例名称会打开这里，所以删除也放在这里 (手机上点名称最顺手，旁边的 🗑 要先点这一行才出现)
    dlg.foot.innerHTML = '<button type="button" class="btn-danger" data-act="delete">' + ICON_TRASH + ' 删除</button><button type="button" data-act="reset">恢复默认</button>' +
      '<span class="grow"></span><button type="button" data-act="cancel">取消</button><button type="button" class="btn-primary" data-act="ok">确定</button>';
    function err(msg) { var e = root.querySelector('.form-error'); e.textContent = msg; e.hidden = !msg; }
    dlg.foot.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-act]'); // 点到按钮里的图标时 target 是 svg
      var act = btn && btn.dataset.act;
      if (act === 'cancel') dlg.close();
      else if (act === 'delete') { dlg.close(); removeIndicator(id); toast('已删除 ' + indLabel(ind)); }
      else if (act === 'reset') {
        def.inputs.forEach(function (i) { root.elements['p_' + i.key].value = i.def; });
        def.plots.forEach(function (pl) {
          root.elements['c_' + pl.key].value = pl.color;
          if (pl.type === 'hist') root.elements['c_' + pl.key + '_neg'].value = pl.negColor;
        });
        root.elements.width.value = String(def.width || 2);
      } else if (act === 'ok') save();
    });
    root.addEventListener('submit', function (e) { e.preventDefault(); save(); });
    function save() {
      var f = root.elements;
      if (isCustom) {
        var name = f.name.value.trim(), formula = f.formula.value.trim();
        if (!name || !formula) return err('请填写名称和公式');
        try { testFormula(formula); } catch (ex) { return err('公式错误：' + ex.message); }
        ind.name = name;
        ind.formula = formula;
        ind.scale = f.scale.value;
      } else {
        var raw = {};
        def.inputs.forEach(function (i) { raw[i.key] = f['p_' + i.key].value; });
        ind.params = cleanParams(def, raw);
      }
      var cols = {};
      def.plots.forEach(function (pl) {
        cols[pl.key] = f['c_' + pl.key].value;
        if (pl.type === 'hist') cols[pl.key + '_neg'] = f['c_' + pl.key + '_neg'].value;
      });
      ind.colors = cols;
      ind.width = +f.width.value;
      ind.pane = f.pane.value === 'sub' ? 'sub' : 'main';
      ind.hidden = !f.visible.checked;
      dlg.close();
      indicatorsChanged();
    }
  }

  // ---------- 图表设置 (⚙): 颜色 ----------
  function openSettingsDialog() {
    var root = document.createElement('div');
    root.className = 'chart-set';
    root.innerHTML = '<div class="color-grid">' +
      [['up', '上涨'], ['down', '下跌'], ['ema', 'EMA 20 / 线形图']].map(function (c) {
        return '<label class="color-row"><span>' + c[1] + '</span><input type="color" data-key="' + c[0] + '" value="' + colors[c[0]] + '"></label>';
      }).join('') + '</div>' +
      '<p class="hint">图表类型、周期、指标和模板在上方工具栏。所有设置只保存在你自己的浏览器里，不影响别人，报告每次更新后也会保留。</p>';
    var dlg = openDialog({ title: '图表设置', body: root, footer: true, className: 'dlg-set' });
    dlg.foot.innerHTML = '<button type="button" data-act="reset">恢复默认颜色</button><span class="grow"></span><button type="button" class="btn-primary" data-act="ok">完成</button>';
    var timer = null;
    root.querySelectorAll('input[type=color]').forEach(function (input) {
      input.addEventListener('input', function () {
        document.documentElement.style.setProperty('--' + input.dataset.key, input.value);
        colors = computeColors();
        saveColors();
        clearTimeout(timer);
        timer = setTimeout(rerenderAll, 120);
      });
    });
    dlg.foot.addEventListener('click', function (e) {
      var act = e.target.dataset && e.target.dataset.act;
      if (act === 'ok') dlg.close();
      if (act === 'reset') {
        COLOR_KEYS.forEach(function (k) { document.documentElement.style.removeProperty('--' + k); });
        try { localStorage.removeItem(COLOR_STORAGE_KEY); } catch (ex) {}
        colors = computeColors();
        root.querySelectorAll('input[type=color]').forEach(function (i) { i.value = colors[i.dataset.key]; });
        rerenderAll();
      }
    });
  }

  // ---------- 筛选器名称 (标题下方那行小字) = 当前模板名称 ----------
  function renderTemplateName() {
    var nameEl = document.getElementById('tpl-name');
    if (nameEl && document.activeElement !== nameEl) nameEl.value = activeTemplate().name;
  }
  (function initTemplateName() {
    var nameEl = document.getElementById('tpl-name');
    if (!nameEl) return;
    nameEl.addEventListener('input', function () {
      activeTemplate().name = nameEl.value.trim() || DEFAULT_TPL_NAME;
      persist();
      renderDashScreeners();
    });
    nameEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') nameEl.blur(); });
    nameEl.addEventListener('blur', function () { nameEl.value = activeTemplate().name; });
    renderTemplateName();
  })();

  // ---------- 卡片轮播: 左右滑 / ‹ › / 股票标签，一次看一支 ----------
  (function initCarousel() {
    var track = document.getElementById('car-track');
    if (!track) return;
    var cards = Array.prototype.slice.call(track.querySelectorAll('.card'));
    var chips = Array.prototype.slice.call(document.querySelectorAll('.sym-chip'));
    var strip = document.querySelector('.sym-list');
    var prev = document.querySelector('.car-nav.prev'), next = document.querySelector('.car-nav.next');
    var counter = document.getElementById('car-count');
    var current = -1;
    function ensureRendered(i) {
      [i, i - 1, i + 1].forEach(function (k) {
        if (cards[k]) renderChart(cards[k].dataset.chart);
      });
    }
    function setActive(i) {
      if (i === current) return;
      current = i;
      chips.forEach(function (c, k) {
        var on = k === i;
        c.classList.toggle('active', on);
        c.setAttribute('aria-current', on ? 'true' : 'false');
        if (on && strip) strip.scrollLeft = c.offsetLeft - strip.offsetLeft - (strip.clientWidth - c.offsetWidth) / 2;
      });
      // 看不到的卡片设成 inert: 不能被 Tab 聚焦 (否则焦点跑进去会把轮播横向拖到一半)
      cards.forEach(function (c, k) { c.inert = k !== i; c.setAttribute('aria-hidden', k === i ? 'false' : 'true'); });
      if (counter) counter.textContent = (i + 1) + ' / ' + cards.length;
      if (prev) prev.disabled = i <= 0;
      if (next) next.disabled = i >= cards.length - 1;
      ensureRendered(i);
    }
    function indexFromScroll() { return Math.max(0, Math.min(cards.length - 1, Math.round(track.scrollLeft / Math.max(1, track.clientWidth)))); }
    function goTo(i, smooth) {
      i = Math.max(0, Math.min(cards.length - 1, i));
      track.scrollTo({ left: i * track.clientWidth, behavior: smooth ? 'smooth' : 'auto' });
      setActive(i);
    }
    var ticking = false;
    track.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () { ticking = false; setActive(indexFromScroll()); });
    }, { passive: true });
    if (prev) prev.addEventListener('click', function () { goTo(current - 1, true); });
    if (next) next.addEventListener('click', function () { goTo(current + 1, true); });
    chips.forEach(function (c, k) { c.addEventListener('click', function () { goTo(k, true); }); });
    document.querySelectorAll('.sym-nav').forEach(function (b) {
      b.addEventListener('click', function () { if (strip) strip.scrollBy({ left: +b.dataset.dir * strip.clientWidth * 0.7, behavior: 'smooth' }); });
    });
    track.addEventListener('keydown', function (e) {
      if (e.target !== track) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(current - 1, true); }
      if (e.key === 'ArrowRight') { e.preventDefault(); goTo(current + 1, true); }
    });
    // 窗口大小变了 (手机转横屏等)，停在同一张卡片上
    var lastW = track.clientWidth;
    new ResizeObserver(function () {
      if (track.clientWidth === lastW) return;
      lastW = track.clientWidth;
      if (current >= 0) track.scrollLeft = current * track.clientWidth;
    }).observe(track);
    if (cards.length) {
      // 懒加载: 轮播区快滚进屏幕才画第一张图
      if ('IntersectionObserver' in window) {
        var io = new IntersectionObserver(function (entries) {
          if (entries.some(function (e) { return e.isIntersecting; })) { setActive(indexFromScroll()); io.disconnect(); }
        }, { rootMargin: '300px 0px' });
        io.observe(track);
      } else {
        setActive(0);
      }
    }
  })();

  // ---------- 完整图表 + 财报 (点"其余股票"的一行、选股条件命中的一行，或点筛选器卡片上的"完整图表 · 财报") ----------
  // 表格股票最新的K线在 docs/charts/table.json (6 个月日线 + 当天 5 分钟线，每次运行都更新)，第一次打开时才下载；
  // 财报 + 2 年日线 + 10 年月线在 docs/stock/<代码>.json (后台一周刷新一次)，打开哪支才下载哪支。
  var tableChartsUrl = document.body.dataset.tableCharts || '';
  var tableChartsPromise = null;
  function loadTableCharts() {
    if (!tableChartsUrl) return Promise.reject(new Error('这次运行没有生成完整图表数据'));
    if (!tableChartsPromise) {
      tableChartsPromise = fetch(tableChartsUrl).then(function (r) {
        if (!r.ok) throw new Error('下载失败 (HTTP ' + r.status + ')');
        return r.json();
      }).catch(function (e) { tableChartsPromise = null; throw e; });
    }
    return tableChartsPromise;
  }
  // 精简格式 (价格 ×1000 的整数、第一根时间 + 间隔) → 图表用的 {t,o,h,l,c,v}
  function decodeBars(c) {
    if (!c || !c.o || !c.o.length) return null;
    var t = [c.t0];
    for (var i = 0; i < c.dt.length; i++) t.push(t[i] + c.dt[i] * c.u);
    function div(a) { return a.map(function (x) { return x / 1000; }); }
    return { t: t, o: div(c.o), h: div(c.h), l: div(c.l), c: div(c.c), v: c.v };
  }
  function rawToObjs(raw) {
    return raw.t.map(function (t, i) { return { time: t, open: raw.o[i], high: raw.h[i], low: raw.l[i], close: raw.c[i], volume: raw.v[i] }; });
  }
  function objsToRaw(list) {
    return {
      t: list.map(function (b) { return b.time; }), o: list.map(function (b) { return b.open; }), h: list.map(function (b) { return b.high; }),
      l: list.map(function (b) { return b.low; }), c: list.map(function (b) { return b.close; }), v: list.map(function (b) { return b.volume; })
    };
  }
  function sessionKey(mins) {
    return function (t) { return Math.floor(t / DAY) + ':' + Math.floor((Math.floor((t % DAY) / 60) - SESSION_START_MIN) / mins); };
  }
  function monthKey(t) { var x = new Date(t * 1000); return x.getUTCFullYear() * 12 + x.getUTCMonth(); }
  // 个股资料 (财报 + 长期K线)：没有文件 = null；同一页面里重复打开同一支不再下载
  var detailCache = {};
  function loadDetail(code) {
    if (!detailCache[code]) {
      detailCache[code] = fetch('stock/' + encodeURIComponent(code) + '.json', { cache: 'no-cache' }).then(function (r) {
        if (r.status === 404) return null;
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      });
      detailCache[code].catch(function () { delete detailCache[code]; });
    }
    return detailCache[code];
  }
  // 表格股票: table.json 的 6 个月日线 + 5 分钟线，再接上个股资料里更早的日线 / 月线 (有的话)；
  // 15 分 / 1 小时 / 月线 在这里合成，其余周期再由 barsFor() 合成
  function basesFromTable(entry, detail) {
    var bars = {};
    var recent = decodeBars(entry.d), m5 = decodeBars(entry.i);
    var long = detail && detail.bars ? decodeBars(detail.bars.d) : null;
    var monthly = detail && detail.bars ? decodeBars(detail.bars.m) : null;
    var daily = recent ? rawToObjs(recent) : [];
    if (long) {
      var first = daily.length ? daily[0].time : Infinity;
      daily = rawToObjs(long).filter(function (b) { return b.time < first; }).concat(daily);
    }
    if (daily.length) {
      bars['1d'] = objsToRaw(daily);
      // 月线: 日线覆盖的月份用日线合成 (最新)；日线的第一个月可能不完整，它和更早的月份用 10 年月线
      var cut = monthKey(daily[0].time) + (monthly ? 1 : 0);
      var older = monthly ? rawToObjs(monthly).filter(function (b) { return monthKey(b.time) < cut; }) : [];
      var fromDaily = aggregate(daily, monthKey).filter(function (b) { return monthKey(b.time) >= cut; });
      bars['1mo'] = objsToRaw(older.concat(fromDaily));
    }
    if (m5) {
      bars['5m'] = m5;
      bars['15m'] = objsToRaw(aggregate(rawToObjs(m5), sessionKey(15)));
      bars['60m'] = objsToRaw(aggregate(rawToObjs(m5), sessionKey(60)));
    }
    return bars;
  }

  var modalSeq = 0;
  function openStockModal(opts) {
    var id = 'm' + (++modalSeq) + '-' + opts.code;
    var root = document.createElement('div');
    root.className = 'stock-view';
    var ctx = opts.ctx && opts.ctx.list && opts.ctx.list.length > 1 && opts.ctx.i >= 0 ? opts.ctx : null;
    root.innerHTML =
      (opts.headHtml ? '<div class="sv-head">' + opts.headHtml + '</div>' : '') +
      // 自选 / 计算器 / 分享 + 上一支、下一支 (按打开时那个列表的顺序：表格、命中列表…)
      '<div class="sv-bar"><div class="sv-acts">' +
      '<button type="button" class="sv-act sv-star" data-act="star" aria-pressed="false"></button>' +
      '<button type="button" class="sv-act" data-act="calc">计算器</button>' +
      '<button type="button" class="sv-act" data-act="share">分享</button></div>' +
      (ctx ? '<div class="sv-nav"><button type="button" class="sv-act" data-act="prev" aria-label="上一支"' + (ctx.i <= 0 ? ' disabled' : '') + '>‹</button>' +
        '<span>' + (ctx.i + 1) + ' / ' + ctx.list.length + '</span>' +
        '<button type="button" class="sv-act" data-act="next" aria-label="下一支"' + (ctx.i >= ctx.list.length - 1 ? ' disabled' : '') + '>›</button></div>' : '') +
      '</div>' + stockStatsHtml(opts.code) +
      // 电脑: 左边正方形K线图，右边财报，下面公告、新闻；手机: 从上到下排，图表右边留一条滑动页面用的空白
      '<div class="sv-grid"><section class="sv-chart" aria-label="K线图">' +
      '<div class="sv-toolbar"><div class="sv-tf"></div>' +
      '<button type="button" class="tb-btn sv-ind" title="指标"><span class="fx">ƒx</span><span class="tb-label">指标</span></button></div>' +
      '<p class="tf-note" id="' + id + '-tfnote" hidden></p>' +
      '<p class="sv-msg hint">图表载入中…</p>' +
      '<div class="chart-wrap"><div id="' + id + '" class="chart" data-square="1"></div><div class="chart-legends" id="' + id + '-legends"></div></div>' +
      '<div class="quote"><div class="quote-live" id="' + id + '-live"></div></div></section>' +
      '<section class="fin" aria-label="财务报表"><div class="fin-head"><h4>财务报表</h4>' +
      '<div class="tabs fin-tabs" role="tablist"><button type="button" role="tab" data-fin="quarterly" aria-selected="true">近 4 季</button>' +
      '<button type="button" role="tab" data-fin="annual" aria-selected="false">近 2 年 (年报)</button></div></div>' +
      '<div class="fin-body"><p class="hint">财报载入中…</p></div>' +
      '<p class="hint fin-foot"></p></section></div>' +
      '<section class="news ann-sec" aria-label="公司公告"><h4>公司公告</h4><div class="ann-body"><p class="hint">公告载入中…</p></div></section>' +
      '<section class="news" aria-label="最近新闻"><h4>最近新闻</h4><div class="news-body"><p class="hint">新闻载入中…</p></div></section>';
    var dlg = openDialog({
      title: opts.name + '  ' + opts.code, body: root, className: 'dlg-stock', focus: '.dlg-x',
      url: '#s=' + encodeURIComponent(opts.code), deepLinked: opts.deepLinked, reuse: opts.reuse, previousFocus: opts.previousFocus,
      onClose: function () { destroyChart(id); delete data[id]; }
    });
    var star = root.querySelector('.sv-star');
    function paintStar() {
      var on = isWatched(opts.code);
      star.setAttribute('aria-pressed', on ? 'true' : 'false');
      star.textContent = on ? '★ 已自选' : '☆ 加自选';
    }
    paintStar();
    root.querySelector('.sv-bar').addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b || b.disabled) return;
      var act = b.dataset.act;
      if (act === 'star') { toggleWatch(opts.code, opts.name); paintStar(); }
      else if (act === 'calc') { openCalculator({ code: opts.code, name: opts.name }); }
      else if (act === 'share') { shareStock(opts.code, opts.name); }
      else if ((act === 'prev' || act === 'next') && ctx) {
        var j = ctx.i + (act === 'next' ? 1 : -1);
        if (j < 0 || j >= ctx.list.length) return;
        var keep = dlg.close({ keep: true }); // 同一格 history 留给下一支，按返回一次就回到页面
        openReportStock(ctx.list[j], { list: ctx.list, i: j }, { reuse: keep, previousFocus: keep && keep.previousFocus });
      }
    });
    // 价格 / 涨跌放进标题那一行 (标题不跟着内容滚动)，往下看财报、新闻时还看得到是哪支股票、现在多少钱
    var svHead = root.querySelector('.sv-head');
    if (svHead) dlg.el.querySelector('.dlg-head h3').insertAdjacentElement('afterend', svHead);
    root.querySelector('.sv-ind').addEventListener('click', function () { openIndicatorsDialog('all'); });
    var msg = root.querySelector('.sv-msg'), wrap = root.querySelector('.chart-wrap');
    var detail = loadDetail(opts.code);
    var shortHistory = false;
    // 筛选器卡片本来就有 2 年日线 + 10 年月线 + 全部日内周期，直接用；表格股票拼 table.json + 个股资料
    var ready = opts.sourceChartId && data[opts.sourceChartId]
      ? Promise.resolve(data[opts.sourceChartId].bars)
      : Promise.all([loadTableCharts(), detail.catch(function () { return null; })]).then(function (res) {
        var e = res[0].stocks && res[0].stocks[opts.code];
        if (!e) throw new Error('这次运行没有这支股票的K线');
        shortHistory = !(res[1] && res[1].bars && res[1].bars.d);
        return basesFromTable(e, res[1]);
      });
    ready.then(function (bars) {
      if (!root.isConnected) return;
      data[id] = { bars: bars };
      msg.hidden = !shortHistory;
      msg.textContent = shortHistory ? '目前只有最近 6 个月的日线；2 年日线 + 10 年月线后台还在补 (每次运行补一批，通常一天内补齐)' : '';
      renderChart(id);
      buildModalTimeframes(root, id);
    }).catch(function (e) {
      msg.textContent = '图表载入失败：' + e.message;
      wrap.hidden = true;
      root.querySelector('.sv-toolbar').hidden = true;
    });
    showFinancials(opts.code, detail, root.querySelector('.fin'));
    showAnnouncements(opts.code, root.querySelector('.ann-body'));
    showNews(opts.code, root.querySelector('.news-body'));
    return dlg;
  }
  // 详情顶部一行关键数字 (都来自 main.py 放在页面里的 report-meta)：市值、市盈率、股息率、52 周区间、财报日期…
  function stockStatsHtml(code) {
    var m = META.stocks[code];
    if (!m) return '';
    var items = [];
    if (isNum(m.mc)) items.push(['市值', CUR_SYM + ' ' + fmtCompact(m.mc)]);
    if (isNum(m.pe)) items.push(['市盈率', m.pe.toFixed(1) + ' 倍']);
    if (isNum(m.dy)) items.push(['股息率', m.dy.toFixed(2) + '%']);
    if (isNum(m.hi) && isNum(m.lo) && m.hi > m.lo && isNum(m.p)) {
      var pos = Math.max(0, Math.min(100, (m.p - m.lo) / (m.hi - m.lo) * 100));
      items.push(['52 周区间', fmtPrice(m.lo) + ' – ' + fmtPrice(m.hi),
        '<span class="sv-range" title="现价在 52 周区间的 ' + pos.toFixed(0) + '% 位置"><i style="left:' + pos.toFixed(1) + '%"></i></span>']);
    }
    if (m.e && m.e.length) {
      var now = Date.now() / 1000;
      var byNum = function (a, b) { return a - b; };
      var next = m.e.filter(function (t) { return t > now; }).sort(byNum)[0];
      var last = m.e.filter(function (t) { return t <= now; }).sort(byNum).pop();
      var md = function (t) { var d = new Date(t * 1000); return (d.getMonth() + 1) + '/' + d.getDate(); };
      if (next) items.push(['下次财报', md(next) + (next - now < 86400 * 14 ? ' (快到了)' : ''), '', next - now < 86400 * 14 ? 'soon' : '']);
      else if (last && now - last < 86400 * 60) items.push(['最近财报', md(last)]);
    }
    if (isNum(m.a)) items.push(['20 日平均成交额', CUR_SYM + ' ' + fmtCompact(m.a)]);
    if (isNum(m.atr)) items.push(['ATR(14) 波动', m.atr.toFixed(1) + '% / 天']);
    if (LOT > 1 && isNum(m.p)) items.push(['一手 ' + LOT + ' 股', CUR_SYM + ' ' + fmtMoney2(m.p * LOT)]);
    if (!items.length) return '';
    return '<dl class="sv-stats">' + items.map(function (it) {
      return '<div' + (it[3] ? ' class="' + it[3] + '"' : '') + '><dt>' + it[0] + '</dt><dd>' + escapeHtml(it[1]) + (it[2] || '') + '</dd></div>';
    }).join('') + '</dl>';
  }
  function shareStock(code, name) {
    var url = location.origin + location.pathname + '#s=' + encodeURIComponent(code);
    if (navigator.share && TOUCH_ONLY) {
      navigator.share({ title: name + ' ' + code, url: url }).catch(function () { /* 用户取消 */ });
      return;
    }
    var done = function () { toast('已复制链接：打开就直接看到 ' + name); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { window.prompt('复制这个链接', url); });
    else window.prompt('复制这个链接', url);
  }
  function buildModalTimeframes(root, id) {
    var mark = buildTfControl(root.querySelector('.sv-tf'), function (tf) { return hasTf(id, tf); }, function (tf) {
      if (charts[id]) { setTimeframe(charts[id], tf); mark(charts[id].tf); }
    });
    mark(charts[id] && charts[id].tf);
  }

  // ---------- 财报: 4 张小柱状图 (一张一个指标，不用双坐标轴) + 完整数字表格 ----------
  var FIN_TABLE_ROWS = [
    { key: 'revenue', label: '营业收入' }, { key: 'gross_profit', label: '毛利' }, { key: 'operating_income', label: '营业利润' },
    { key: 'net_income', label: '净利润' }, { key: 'net_margin', label: '净利率', pct: true }, { key: 'eps', label: '每股盈利 (EPS)', eps: true },
    { key: 'total_assets', label: '总资产' }, { key: 'total_liabilities', label: '总负债' }, { key: 'equity', label: '股东权益' },
    { key: 'cash', label: '现金及等价物' }, { key: 'total_debt', label: '总债务' },
    { key: 'operating_cf', label: '经营现金流' }, { key: 'free_cf', label: '自由现金流' }
  ];
  // accent = 单一颜色 (规模)；sign = 正数绿、负数红 (盈亏)
  var FIN_CHARTS = [
    { key: 'revenue', label: '营业收入', color: 'accent' },
    { key: 'net_income', label: '净利润', color: 'sign', flip: ['转盈', '转亏'] },
    { key: 'net_margin', label: '净利率', color: 'sign', pct: true },
    { key: 'operating_cf', label: '经营现金流', color: 'sign', flip: ['转正', '转负'] }
  ];
  function fmtMoney(v) {
    if (!isNum(v)) return '—';
    var a = Math.abs(v), s = v < 0 ? '-' : '';
    if (a >= 1e9) return s + (a / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return s + (a / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M';
    if (a >= 1e3) return s + (a / 1e3).toFixed(0) + 'K';
    return s + a.toFixed(0);
  }
  function fmtFin(row, v) {
    if (!isNum(v)) return '—';
    if (row.pct) return v.toFixed(1) + '%';
    if (row.eps) return (v < 0 ? '-' : '') + Math.abs(v).toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
    return fmtMoney(v);
  }
  function periodLabel(p, annual) {
    var y = +p.slice(0, 4), m = +p.slice(5, 7);
    return annual ? 'FY' + y : String(y).slice(2) + 'Q' + Math.ceil(m / 3);
  }
  // 净利率 = 净利润 ÷ 营业收入
  function withMargin(sec) {
    var out = Object.assign({}, sec);
    out.net_margin = (sec.periods || []).map(function (_, i) {
      var r = sec.revenue && sec.revenue[i], n = sec.net_income && sec.net_income[i];
      return isNum(r) && isNum(n) && r !== 0 ? n / r * 100 : null;
    });
    return out;
  }
  function barPath(x, w, y0, y1, r) {
    var h = Math.abs(y1 - y0);
    r = Math.min(r, h, w / 2);
    var up = y1 < y0, e = up ? y1 + r : y1 - r; // 圆角只在数据那一端，贴着基线那一端是直角
    return 'M' + x + ',' + y0 + 'V' + e + 'Q' + x + ',' + y1 + ' ' + (x + r) + ',' + y1 + 'H' + (x + w - r) +
      'Q' + (x + w) + ',' + y1 + ' ' + (x + w) + ',' + e + 'V' + y0 + 'Z';
  }
  // 只显示最近 n 期 (后台留了 8 季，更早的拿来算"同比")
  function lastN(sec, n) {
    var k = Math.max(0, (sec.periods || []).length - n), out = {};
    Object.keys(sec).forEach(function (key) { out[key] = isArr(sec[key]) ? sec[key].slice(k) : sec[key]; });
    return out;
  }
  // 去年同一季在完整资料里的位置 (报告期月份差一个月以内都算)
  function yoyIndex(full, p) {
    var y = +p.slice(0, 4) - 1, m = +p.slice(5, 7);
    for (var i = 0; i < (full.periods || []).length; i++) {
      var q = full.periods[i];
      if (+q.slice(0, 4) === y && Math.abs(+q.slice(5, 7) - m) <= 1) return i;
    }
    return -1;
  }
  function changeText(def, a, b) {
    if (!isNum(a) || !isNum(b)) return '';
    return def.pct ? (b - a >= 0 ? '+' : '') + (b - a).toFixed(1) + ' 个百分点'
      : def.flip && a < 0 && b > 0 ? def.flip[0] : def.flip && a > 0 && b < 0 ? def.flip[1] // 正负号变了，百分比没意义
        : a !== 0 ? (b - a >= 0 ? '+' : '') + ((b - a) / Math.abs(a) * 100).toFixed(1) + '%' : '';
  }
  function columnChart(def, sec, annual, full) {
    var periods = sec.periods, vals = sec[def.key] || [];
    var W = 240, H = 132, top = 20, bottom = 22, plotH = H - top - bottom;
    var nums = vals.filter(isNum);
    var lo = Math.min(0, Math.min.apply(null, nums.length ? nums : [0])), hi = Math.max(0, Math.max.apply(null, nums.length ? nums : [1]));
    if (hi === lo) hi = lo + 1;
    function y(v) { return top + (hi - v) / (hi - lo) * plotH; }
    var y0 = y(0), n = periods.length, slot = (W - 8) / Math.max(n, 1), bw = Math.min(24, slot * 0.55);
    var row = { pct: def.pct };
    var lastIdx = -1;
    vals.forEach(function (v, i) { if (isNum(v)) lastIdx = i; });
    var svg = '<svg class="fc-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + def.label + '各期数值，详见下方表格">' +
      '<line class="fc-base" x1="4" x2="' + (W - 4) + '" y1="' + y0.toFixed(1) + '" y2="' + y0.toFixed(1) + '"/>';
    periods.forEach(function (p, i) {
      var v = vals[i], x = 4 + slot * i + (slot - bw) / 2;
      var tip = periodLabel(p, annual) + ' (' + p + ')  ' + def.label + '：' + fmtFin(row, v);
      svg += '<g class="fc-bar"><title>' + escapeHtml(tip) + '</title>' +
        '<rect class="fc-hit" x="' + (4 + slot * i).toFixed(1) + '" y="0" width="' + slot.toFixed(1) + '" height="' + H + '"/>';
      if (isNum(v) && v !== 0) {
        var color = def.color === 'accent' ? 'var(--ema)' : v >= 0 ? 'var(--up)' : 'var(--down)';
        svg += '<path d="' + barPath(x, bw, y0, y(v), 4) + '" style="fill:' + color + '"/>';
      }
      if (i === lastIdx) { // 只标最新一期的数值，其余看悬停提示和下方表格
        var ly = (v >= 0 ? y(v) : y0) - 5; // 负数标在基线上方，不会压到底下的季度文字
        svg += '<text class="fc-val" x="' + (x + bw / 2).toFixed(1) + '" y="' + ly.toFixed(1) + '" text-anchor="middle">' + escapeHtml(fmtFin(row, v)) + '</text>';
      }
      svg += '<text class="fc-lbl" x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle">' + periodLabel(p, annual) + '</text></g>';
    });
    svg += '</svg>';
    // 季报: 环比 (较上季) + 同比 (较去年同季，季节性行业看这个才准)；年报: 较上年
    var changes = [];
    if (lastIdx > 0 && isNum(vals[lastIdx - 1])) {
      var a = vals[lastIdx - 1], b = vals[lastIdx], txt = changeText(def, a, b);
      if (txt) changes.push('<span class="' + (b >= a ? 'change-up' : 'change-down') + '">' + (annual ? '较上年 ' : '环比 ') + txt + '</span>');
    }
    if (!annual && full && lastIdx >= 0) {
      var yi = yoyIndex(full, periods[lastIdx]), prevYear = yi >= 0 && full[def.key] ? full[def.key][yi] : null;
      var ytxt = changeText(def, prevYear, vals[lastIdx]);
      if (ytxt) changes.push('<span class="' + (vals[lastIdx] >= prevYear ? 'change-up' : 'change-down') + '">同比 ' + ytxt + '</span>');
    }
    return '<div class="fc"><div class="fc-title"><span>' + def.label + '</span><span class="fc-chg">' + changes.join('') + '</span></div>' + svg + '</div>';
  }
  function finTable(sec, annual) {
    var periods = sec.periods;
    var rows = FIN_TABLE_ROWS.filter(function (r) { return (sec[r.key] || []).some(isNum); });
    return '<div class="fin-table-wrap"><table class="fin-table"><thead><tr><th scope="col">项目</th>' +
      periods.map(function (p) { return '<th scope="col" class="num" title="报告期结束：' + p + '">' + periodLabel(p, annual) + '<small>' + p + '</small></th>'; }).join('') +
      '</tr></thead><tbody>' + rows.map(function (r) {
        return '<tr><th scope="row">' + r.label + '</th>' + periods.map(function (_, i) {
          var v = sec[r.key][i];
          return '<td class="num' + (isNum(v) && v < 0 ? ' change-down' : '') + '">' + fmtFin(r, v) + '</td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>';
  }
  // 财报货币 / 完整年报链接按市场: 马股看 Bursa 官网公司公告，美股看 SEC EDGAR 的 10-K
  var HOME_CURRENCY = MARKET.id === 'US' ? { code: 'USD', name: '美元 (USD)', short: '美元', market: '美股' }
    : { code: 'MYR', name: '令吉 (RM)', short: '令吉', market: '马股' };
  function annualReportLink(code) {
    if (MARKET.id === 'US') {
      var edgar = 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&type=10-K&CIK=' + encodeURIComponent(code);
      return '完整年报 (10-K)：<a href="' + edgar + '" target="_blank" rel="noopener">SEC EDGAR ↗</a>';
    }
    var bursa = 'https://www.bursamalaysia.com/trade/trading_resources/listing_directory/company-profile?stock_code=' + encodeURIComponent(code);
    return '完整年报 PDF：<a href="' + bursa + '" target="_blank" rel="noopener">Bursa 官网公司资料 ↗</a> (年报在公司公告里)';
  }
  function showFinancials(code, detailPromise, box) {
    var body = box.querySelector('.fin-body'), foot = box.querySelector('.fin-foot');
    var link = annualReportLink(code);
    foot.innerHTML = link;
    detailPromise.then(function (detail) {
      var fin = detail && detail.fin;
      box.querySelector('.fin-tabs').hidden = !fin;
      if (!detail) {
        body.innerHTML = '<p class="hint">这支股票的财报还没抓到。后台每次运行补一批 (每支一周更新一次)，通常一天内会补齐。</p>';
        return;
      }
      if (!fin) {
        body.innerHTML = '<p class="hint">Yahoo Finance 没有这家公司的财报数据 (' + escapeHtml(detail.fetched_at) + ' 查过，过两天会再试)。可以到' +
          (MARKET.id === 'US' ? ' SEC EDGAR 看年报 (10-K)' : ' Bursa 官网看年报') + '。</p>';
        return;
      }
      var fullQ = withMargin(fin.quarterly || { periods: [] });
      var views = { quarterly: lastN(fullQ, 4), annual: withMargin(fin.annual || { periods: [] }) };
      function show(kind) {
        var sec = views[kind], annual = kind === 'annual';
        box.querySelectorAll('[data-fin]').forEach(function (t) { t.setAttribute('aria-selected', t.dataset.fin === kind ? 'true' : 'false'); });
        if (!sec.periods || !sec.periods.length) {
          body.innerHTML = '<p class="hint">没有' + (annual ? '年度' : '季度') + '财报数据。</p>';
          return;
        }
        body.innerHTML = '<div class="fc-grid">' + FIN_CHARTS.map(function (d) { return columnChart(d, sec, annual, annual ? null : fullQ); }).join('') + '</div>' + finTable(sec, annual);
      }
      box.querySelectorAll('[data-fin]').forEach(function (t) { t.addEventListener('click', function () { show(t.dataset.fin); }); });
      show(views.quarterly.periods && views.quarterly.periods.length ? 'quarterly' : 'annual');
      var cur = fin.currency, home = HOME_CURRENCY;
      var unit = !cur ? '金额单位：公司报告货币 (' + home.market + '一般是' + home.name + ')' : cur === home.code ? '金额单位：' + home.name
        : '金额单位：' + escapeHtml(cur) + ' (这家公司用 ' + escapeHtml(cur) + ' 报告，不是' + home.short + ')';
      foot.innerHTML = '数据来源：Yahoo Finance (' + escapeHtml(detail.fetched_at) + ' 更新)，' + unit + '，K = 千、M = 百万、B = 十亿；季度 / 财年按报告期结束的月份 / 年份标示。' + link;
    }).catch(function (e) {
      body.innerHTML = '<p class="hint">财报载入失败：' + escapeHtml(e.message) + '</p>';
    });
  }

  // ---------- 个股新闻: docs/news/<代码>.json (后台半天更新一次，只有标题 + 来源 + 原文链接) ----------
  function timeAgo(ts) {
    if (!ts) return '';
    var s = Date.now() / 1000 - ts;
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + ' 分钟前';
    if (s < 86400) return Math.round(s / 3600) + ' 小时前';
    if (s < 86400 * 30) return Math.round(s / 86400) + ' 天前';
    return new Date(ts * 1000).toISOString().slice(0, 10);
  }
  function showNews(code, box) {
    fetch('news/' + encodeURIComponent(code) + '.json', { cache: 'no-cache' }).then(function (r) {
      if (r.status === 404) return null;
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (n) {
      if (!n) { box.innerHTML = '<p class="hint">这支股票的新闻还没抓到，后台每次运行补一批，通常一天内会补齐。</p>'; return; }
      if (!n.items || !n.items.length) {
        box.innerHTML = '<p class="hint">最近 90 天没有找到这家公司的新闻 (' + escapeHtml(n.fetched_at.slice(0, 16).replace('T', ' ')) + ' 查过)。</p>';
        return;
      }
      box.innerHTML = '<ul class="news-list">' + n.items.map(function (it) {
        var when = timeAgo(it.time);
        return '<li><a href="' + escapeHtml(it.link) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(it.title) + '</a>' +
          '<span class="news-meta">' + escapeHtml(it.source || '') + (it.source && when ? ' · ' : '') +
          (it.time ? '<time datetime="' + new Date(it.time * 1000).toISOString() + '">' + when + '</time>' : '') + '</span></li>';
      }).join('') + '</ul><p class="hint news-foot">新闻标题来自 ' + escapeHtml(n.source || 'Google News') +
        ' (按公司名称搜索，偶尔会混进同名的其他新闻)，点标题看原文；' + escapeHtml(n.fetched_at.slice(0, 16).replace('T', ' ')) + ' 更新。</p>';
    }).catch(function (e) {
      box.innerHTML = '<p class="hint">新闻载入失败：' + escapeHtml(e.message) + '</p>';
    });
  }

  // ---------- 公司公告: docs/ann/<代码>.json (后台半天更新一次：马股 Bursa 官网、美股 SEC EDGAR) ----------
  var ANN_CAT_LABEL = { results: '财报', dividend: '派息·权益', corporate: '企业活动', holding: '持股变动', buyback: '回购',
    uma: '异常交易', people: '人事', meeting: '会议·年报', other: '其他' };
  function annOfficialPage(code) {
    return MARKET.id === 'US' ? 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&owner=include&count=40&CIK=' + encodeURIComponent(code)
      : 'https://www.bursamalaysia.com/market_information/announcements/company_announcement?company=' + encodeURIComponent(code);
  }
  function showAnnouncements(code, box) {
    var link = '<a href="' + annOfficialPage(code) + '" target="_blank" rel="noopener">' + (MARKET.id === 'US' ? 'SEC EDGAR' : 'Bursa 官网') + '上的全部公告 ↗</a>';
    fetch('ann/' + encodeURIComponent(code) + '.json', { cache: 'no-cache' }).then(function (r) {
      if (r.status === 404) return null;
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (a) {
      if (!a) { box.innerHTML = '<p class="hint">这支股票的公告还没抓到 (后台每次运行补一批)，可以先看' + link + '。</p>'; return; }
      var when = escapeHtml(String(a.fetched_at || '').slice(0, 16).replace('T', ' '));
      if (!a.items || !a.items.length) { box.innerHTML = '<p class="hint">最近半年没有公告 (' + when + ' 查过)。' + link + '</p>'; return; }
      box.innerHTML = '<ul class="ann-list">' + a.items.map(function (it) {
        return '<li><time datetime="' + escapeHtml(it.date) + '">' + escapeHtml(it.date) + '</time>' +
          '<span class="ann-cat">' + (ANN_CAT_LABEL[it.cat] || '其他') + '</span>' +
          '<a href="' + escapeHtml(it.link) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(it.title) + '</a></li>';
      }).join('') + '</ul><p class="hint news-foot">来源：' + escapeHtml(a.source || '') + '，' + when + ' 更新，点标题看原文；' + link + '</p>';
    }).catch(function (e) {
      box.innerHTML = '<p class="hint">公告载入失败：' + escapeHtml(e.message) + '。' + link + '</p>';
    });
  }

  // ---------- 自选股: 存在这个浏览器里 (马股、美股分开)，☰ 里有列表，表格可以只看自选 ----------
  var WATCH_KEY = 'bursa_watch_v1_' + MARKET.id;
  var watchList = loadJSON(WATCH_KEY, []);
  if (!isArr(watchList)) watchList = [];
  watchList = watchList.filter(function (x) { return x && typeof x.code === 'string'; }).slice(0, 200);
  function isWatched(code) { return watchList.some(function (x) { return x.code === code; }); }
  var watchListeners = [];
  function toggleWatch(code, name) {
    if (isWatched(code)) {
      watchList = watchList.filter(function (x) { return x.code !== code; });
      toast('已从自选移除 ' + name);
    } else {
      watchList.unshift({ code: code, name: name || code });
      toast('已加入自选：' + name + ' (☰ → 自选)');
    }
    saveJSON(WATCH_KEY, watchList);
    watchListeners.forEach(function (fn) { fn(); });
  }

  // 筛选器卡片上加一个"完整图表 · 财报"按钮 (卡片里本来就有多周期K线，这里主要是看财报)
  document.querySelectorAll('.card[data-chart]').forEach(function (card) {
    var tags = card.querySelector('.card-tags');
    var h2 = card.querySelector('h2');
    if (!tags || !h2) return;
    var code = card.dataset.chart.replace(/^chart-/, '');
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'card-fin';
    btn.textContent = '完整图表 · 财报 ›';
    btn.addEventListener('click', function () { openReportStock(entryByCode(code)); });
    tags.appendChild(btn);
  });

  buildToolbar();

  // ---------- "其余股票"表格: 点表头排序 + 手机上的排序下拉框 + 搜索 ----------
  var table = document.getElementById('watchlist-table');
  if (table) {
    var tbody = table.querySelector('tbody');
    var ths = Array.prototype.slice.call(table.querySelectorAll('th'));
    var sortSelect = document.getElementById('table-sort');
    function sortBy(idx, asc) {
      var th = ths[idx], type = th.dataset.type;
      var rows = Array.prototype.slice.call(tbody.querySelectorAll('tr'));
      rows.sort(function (a, b) {
        var ac = a.children[idx], bc = b.children[idx];
        var av = ac.dataset.value !== undefined ? ac.dataset.value : ac.textContent;
        var bv = bc.dataset.value !== undefined ? bc.dataset.value : bc.textContent;
        if (type === 'num') { av = parseFloat(av); bv = parseFloat(bv); }
        if (av < bv) return asc ? -1 : 1;
        if (av > bv) return asc ? 1 : -1;
        return 0;
      });
      // 用 DocumentFragment 一次性批量搬运，比逐行 appendChild 少触发几次重排
      var frag = document.createDocumentFragment();
      rows.forEach(function (r) { frag.appendChild(r); });
      tbody.appendChild(frag);
      ths.forEach(function (other) {
        var arrow = other.querySelector('.arrow');
        if (arrow) arrow.textContent = '';
        other.removeAttribute('aria-sort');
      });
      var currentArrow = th.querySelector('.arrow');
      if (currentArrow) currentArrow.textContent = asc ? '▲' : '▼';
      th.setAttribute('aria-sort', asc ? 'ascending' : 'descending');
      if (sortSelect) sortSelect.value = idx + ':' + (asc ? 'asc' : 'desc');
    }
    ths.forEach(function (th, idx) {
      if (th.dataset.type === 'none') return; // 序号、走势图这两列不排序
      var asc = false; // 第一次点 = 升序；默认按成交量降序排着，所以点"成交量"也是先变升序
      th.addEventListener('click', function () {
        asc = !asc;
        sortBy(idx, asc);
      });
    });
    if (sortSelect) {
      sortSelect.addEventListener('change', function () {
        var v = sortSelect.value.split(':');
        sortBy(+v[0], v[1] === 'asc');
      });
    }

    // 点一行 (或用键盘选中后按 Enter) = 打开完整图表 + 财报 + 新闻
    function openRow(tr) {
      if (!tr || !tr.dataset.code) return;
      // 上一支 / 下一支 = 表格现在看得到的行 (按现在的排序、筛选)
      var list = Array.prototype.filter.call(tbody.querySelectorAll('tr[data-code]'), function (r) { return !r.hidden; })
        .map(function (r) { return entryByCode(r.dataset.code); }).filter(Boolean);
      var e = entryByCode(tr.dataset.code);
      openReportStock(e, { list: list, i: list.indexOf(e) });
    }
    // 手机上页面还在惯性滑动时，手指按下去是想停下来，不是想打开 → 滑动停下 400ms 内的点击不算
    var lastScroll = 0;
    window.addEventListener('scroll', function () { lastScroll = Date.now(); }, { passive: true });
    tbody.addEventListener('click', function (e) {
      if (TOUCH_ONLY && Date.now() - lastScroll < 400) return;
      // 电脑上在表格里拖选文字 (例如复制股票代码) 放开时也会触发 click，这种不算
      var sel = window.getSelection ? window.getSelection() : null;
      if (sel && !sel.isCollapsed && String(sel).trim() && tbody.contains(sel.anchorNode)) return;
      openRow(e.target.closest('tr'));
    });
    tbody.addEventListener('keydown', function (e) { if (e.key === 'Enter') openRow(e.target.closest('tr')); });

    // 快速筛选按钮 (可以同时按几个，条件叠加)；旧版页面还有搜索框 (#table-filter) 的话一起算
    var filterInput = document.getElementById('table-filter');
    var chipBox = document.getElementById('table-chips');
    var countEl = document.getElementById('table-count');
    var allRows = Array.prototype.slice.call(tbody.querySelectorAll('tr'));
    var minPrice = MARKET.id === 'US' ? 5 : 0.1;
    var TABLE_FILTERS = {
      watch: function (tr) { return isWatched(tr.dataset.code); },
      sar: function (tr) { return tr.dataset.sar === '1'; },
      rv: function (tr) { return parseFloat(tr.dataset.rv) >= 2; },
      rsilo: function (tr) { var v = parseFloat(tr.dataset.rsi); return v >= 0 && v < 30; },
      rsihi: function (tr) { return parseFloat(tr.dataset.rsi) > 70; },
      px: function (tr) { return parseFloat(tr.dataset.px) >= minPrice; }
    };
    var activeFilters = [];
    function applyTableFilters() {
      var q = filterInput ? filterInput.value.trim().toLowerCase() : '';
      var shown = 0;
      allRows.forEach(function (row) {
        var hit = (!q || (row.dataset.search || '').indexOf(q) !== -1) &&
          activeFilters.every(function (f) { return TABLE_FILTERS[f](row); });
        row.hidden = !hit;
        if (hit) shown++;
      });
      if (countEl) countEl.textContent = shown === allRows.length ? allRows.length + ' 支' : shown + ' / ' + allRows.length + ' 支';
      var empty = document.getElementById('table-empty');
      if (!shown && !empty) {
        empty = document.createElement('p');
        empty.id = 'table-empty';
        empty.className = 'hint';
        table.parentNode.insertAdjacentElement('afterend', empty);
      }
      if (empty) {
        empty.hidden = !!shown;
        empty.textContent = activeFilters.indexOf('watch') !== -1 && !watchList.length
          ? '还没有自选股：打开任何一支股票，按「☆ 加自选」。' : '没有股票符合这些筛选条件。';
      }
    }
    function markWatchedRows() {
      allRows.forEach(function (row) { row.classList.toggle('is-watched', isWatched(row.dataset.code)); });
    }
    markWatchedRows();
    watchListeners.push(function () { markWatchedRows(); if (activeFilters.indexOf('watch') !== -1) applyTableFilters(); });
    applyTableFilters();
    if (filterInput) filterInput.addEventListener('input', applyTableFilters);
    if (chipBox) {
      chipBox.addEventListener('click', function (e) {
        var b = e.target.closest('.tf-chip[data-f]');
        if (!b || !TABLE_FILTERS[b.dataset.f]) return;
        var on = b.getAttribute('aria-pressed') !== 'true';
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        activeFilters = Array.prototype.filter.call(chipBox.querySelectorAll('.tf-chip[aria-pressed="true"]'), function (x) { return TABLE_FILTERS[x.dataset.f]; })
          .map(function (x) { return x.dataset.f; });
        applyTableFilters();
      });
    }
  }
  // ---------- 报告里的全部股票 (信号卡片 + 表格)：选股条件、底部搜索栏共用 ----------
  var STOCKS = null, ENTRY_MAP = null;
  function entryByCode(code) {
    if (!ENTRY_MAP) {
      ENTRY_MAP = {};
      reportStocks().forEach(function (e) { ENTRY_MAP[e.code] = e; });
    }
    return ENTRY_MAP[code] || null;
  }
  function reportStocks() {
    if (STOCKS) return STOCKS;
    STOCKS = [];
    function upOf(el) { return !el ? null : el.classList.contains('change-up') ? true : el.classList.contains('change-down') ? false : null; }
    document.querySelectorAll('.card[data-chart]').forEach(function (card) {
      var h2 = card.querySelector('h2'), price = card.querySelector('.card-price b');
      var change = card.querySelector('.card-price .change-up, .card-price .change-down, .card-price .change-neutral');
      STOCKS.push({ code: card.dataset.chart.replace(/^chart-/, ''), name: h2 ? h2.firstChild.textContent.trim() : '', card: card, chartId: card.dataset.chart,
        price: price ? price.textContent : '', change: change ? change.textContent.replace(/^.*\(|\)$/g, '') : '', up: upOf(change) });
    });
    document.querySelectorAll('#watchlist-table tbody tr[data-code]').forEach(function (tr) {
      var price = tr.querySelector('.col-price'), change = tr.querySelector('.col-change');
      STOCKS.push({ code: tr.dataset.code, name: tr.dataset.name || '', tr: tr, price: price ? price.firstChild.textContent : '',
        change: change ? change.textContent.trim() : '', up: upOf(change) });
    });
    return STOCKS;
  }
  // 打开某支股票的完整图表 + 财报 + 公告 + 新闻。ctx = 上一支 / 下一支用的列表 (没给就是整份报告的顺序)
  function stockOptsOf(e) {
    if (e.card) {
      var price = e.card.querySelector('.card-price');
      return { code: e.code, name: e.name, sourceChartId: e.chartId, headHtml: price ? price.outerHTML : '' };
    }
    var p = e.tr.querySelector('.col-price'), c = e.tr.querySelector('.col-change');
    return {
      code: e.code, name: e.name || e.code,
      headHtml: '<span class="card-price"><b>' + escapeHtml(p ? p.firstChild.textContent : '') + '</b> ' +
        (c ? '<span class="' + c.className.replace(/\b(num|col-change)\b/g, '').trim() + '">' + escapeHtml(c.textContent) + '</span>' : '') + '</span>'
    };
  }
  function openReportStock(e, ctx, extra) {
    if (!e) return null;
    var opts = stockOptsOf(e);
    var all = reportStocks();
    opts.ctx = ctx || { list: all, i: all.indexOf(e) };
    if (extra) Object.keys(extra).forEach(function (k) { opts[k] = extra[k]; });
    return openStockModal(opts);
  }

  // ---------- 自定义选股条件: 用报告里每支股票的日线，看最新一根符不符合当前模板的条件 ----------
  // 信号卡片本来就带着 2 年日线 (页面自带)；表格股票用 charts/table.json 的 6 个月日线 (跟点开完整图表是同一份)，
  // 模板里真的有条件时才下载，没有条件就不多花流量。全部在浏览器里算，不影响后台信号。
  var universePromise = null;
  function loadUniverse() {
    if (universePromise) return universePromise;
    var list = reportStocks();
    var needTable = list.some(function (e) { return e.tr; });
    var tableReady = needTable ? loadTableCharts().then(function (j) { return { json: j }; }, function (err) { return { error: err }; }) : Promise.resolve({});
    universePromise = tableReady.then(function (res) {
      var items = [], missing = 0;
      list.forEach(function (e) {
        var raw = null;
        if (e.chartId && data[e.chartId] && data[e.chartId].bars) raw = data[e.chartId].bars['1d'];
        else if (e.tr && res.json && res.json.stocks && res.json.stocks[e.code]) raw = decodeBars(res.json.stocks[e.code].d);
        if (raw && raw.t && raw.t.length) items.push({ stock: e, bars: rawToObjs(raw), ctx: null });
        else missing++;
      });
      if (res.error) universePromise = null; // table.json 这次没下载到，下次改条件时再试
      return { items: items, missing: missing, tableError: res.error ? res.error.message : null };
    });
    return universePromise;
  }
  // 规则 → 公式，并用假数据试算一次 (公式错了当场知道，不会拿去算几百支股票)
  function compileRules(t) {
    return t.rules.map(function (r) {
      var c = { rule: r, formula: '', error: null };
      try {
        c.formula = ruleFormula(r);
        if (!c.formula.trim()) throw new Error('公式是空的');
        testFormula(c.formula);
      } catch (e) { c.error = e.message; }
      return c;
    });
  }
  function lastTurnover(item) { var b = item.bars[item.bars.length - 1]; return b && isNum(b.volume) && isNum(b.close) ? b.volume * b.close : 0; }
  function evaluateRules(universe, compiled, match) {
    var hits = [];
    universe.items.forEach(function (it) {
      if (!it.ctx) it.ctx = makeCtx(it.bars);
      var any = false, all = true;
      compiled.forEach(function (c) {
        if ((match === 'any' && any) || (match !== 'any' && !all)) return;
        var ok = false;
        try {
          var arr = evalFormula(c.formula, it.ctx);
          ok = truthOf(isArr(arr) ? arr[arr.length - 1] : arr) === true;
        } catch (e) { ok = false; }
        any = any || ok;
        all = all && ok;
      });
      if (match === 'any' ? any : all) hits.push(it);
    });
    // 跟表格默认一样按成交额从高到低
    hits.sort(function (a, b) { return lastTurnover(b) - lastTurnover(a); });
    return hits;
  }
  // 命中列表每一行顺便显示条件里的数值 (例如 RSI(14) 28.3、相对量 2.4)：条件左边那一项在最新一根的值；价格类不重复显示
  function hitValues(it, compiled) {
    var out = [];
    compiled.forEach(function (c) {
      var r = c.rule;
      if (out.length >= 2 || c.error || r.formula || !r.a || isBoolOperand(r.a)) return;
      var def = OPERAND_BY_K[r.a.k];
      if (!def || def.unit === 'price') return;
      try {
        var arr = evalFormula(operandFormula(r.a), it.ctx);
        var v = isArr(arr) ? arr[arr.length - 1] : arr;
        if (isNum(v)) out.push(operandLabel(r.a) + ' ' + (def.unit === 'vol' ? fmtVolume(v) : def.unit === 'pct' ? fmtPct(v, 2) : fmtValue(v)));
      } catch (e) { /* 算不出来就不显示 */ }
    });
    return out;
  }
  // 回测这组条件：报告里每支股票最近约 6 个月的日线 (表格股票只有 6 个月；信号股有 2 年，也只看最后 6 个月，才比得起来)，
  // 条件"由不成立变成立"的那一天算一次 (连续几天都成立只算第一天)，隔天开盘价计入，看之后 5 / 10 / 20 天的涨跌；
  // 跟同期"任意一天买进"比。在浏览器里算，不上传任何东西。
  var BT_H = [5, 10, 20];
  function backtestRules(universe, compiled, match) {
    var acc = BT_H.map(function () { return { n: 0, sum: 0, win: 0, rets: [] }; });
    var base = BT_H.map(function () { return { n: 0, sum: 0, win: 0 }; });
    var events = 0, stocks = 0, from = null, to = null;
    universe.items.forEach(function (it) {
      if (!it.ctx) it.ctx = makeCtx(it.bars);
      var bars = it.bars, n = bars.length;
      if (n < 30) return;
      var arrs = compiled.map(function (c) {
        try { var a = evalFormula(c.formula, it.ctx); return isArr(a) ? a : null; } catch (e) { return null; }
      });
      var truthAt = function (i) {
        var any = false, all = true;
        arrs.forEach(function (a) { var ok = !!a && truthOf(a[i]) === true; any = any || ok; all = all && ok; });
        return match === 'any' ? any : all;
      };
      var start = Math.max(25, n - 126), prev = truthAt(start - 1), hit = false;
      if (from === null || bars[start].time < from) from = bars[start].time;
      if (to === null || bars[n - 1].time > to) to = bars[n - 1].time;
      for (var i = start; i < n - 1; i++) {
        var entry = bars[i + 1].open, cur = truthAt(i);
        if (!(entry > 0)) { prev = cur; continue; }
        BT_H.forEach(function (h, k) {
          var j = i + h;
          if (j >= n) return;
          var r = (bars[j].close / entry - 1) * 100;
          base[k].n++; base[k].sum += r; base[k].win += r > 0 ? 1 : 0;
          if (cur && !prev) { acc[k].n++; acc[k].sum += r; acc[k].win += r > 0 ? 1 : 0; acc[k].rets.push(r); }
        });
        if (cur && !prev) { events++; hit = true; }
        prev = cur;
      }
      if (hit) stocks++;
    });
    function median(xs) {
      if (!xs.length) return null;
      xs = xs.slice().sort(function (a, b) { return a - b; });
      var m = Math.floor(xs.length / 2);
      return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
    }
    return {
      events: events, stocks: stocks, from: from, to: to, total: universe.items.length,
      rows: BT_H.map(function (h, k) {
        return { h: h, n: acc[k].n, avg: acc[k].n ? acc[k].sum / acc[k].n : null, med: median(acc[k].rets),
          win: acc[k].n ? acc[k].win / acc[k].n * 100 : null,
          baseAvg: base[k].n ? base[k].sum / base[k].n : null, baseWin: base[k].n ? base[k].win / base[k].n * 100 : null };
      })
    };
  }
  function ymd(t) { var d = new Date(t * 1000); return (d.getUTCMonth() + 1) + '/' + d.getUTCDate(); }
  function backtestHtml(r) {
    if (!r.events) return '<div class="sp-bt"><p class="hint">最近 6 个月 (' + ymd(r.from) + ' ~ ' + ymd(r.to) + ') 这组条件在 ' + r.total + ' 支股票里一次都没有出现过。</p></div>';
    var cls = function (v) { return !isNum(v) ? '' : v > 0 ? 'change-up' : v < 0 ? 'change-down' : ''; };
    return '<div class="sp-bt"><p class="sp-bt-head"><b>回测</b> ' + ymd(r.from) + ' ~ ' + ymd(r.to) + ' · ' + r.stocks + ' 支股票出现过 · 共 ' + r.events + ' 次' +
      ' <button type="button" class="info-btn" data-gloss="cbt" aria-label="回测怎么算">ⓘ</button></p>' +
      '<div class="bt-table-wrap"><table class="bt-table"><thead><tr><th>之后</th><th class="num">平均</th><th class="num">中位</th><th class="num">胜率</th>' +
      '<th class="num">任意一天买进</th><th class="num">次数</th></tr></thead><tbody>' + r.rows.map(function (x) {
        return '<tr><th scope="row">' + x.h + ' 天</th><td class="num ' + cls(x.avg) + '">' + fmtPct(x.avg, 2) + '</td><td class="num ' + cls(x.med) + '">' + fmtPct(x.med, 2) + '</td>' +
          '<td class="num">' + fmtPct(x.win, 0, false) + '</td><td class="num ' + cls(x.baseAvg) + '">' + fmtPct(x.baseAvg, 2) + '</td><td class="num">' + x.n + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="hint">条件由不成立变成立的那天算一次，隔天开盘价计入，没扣交易成本；历史统计不代表未来。</p></div>';
  }

  var SP_PAGE = 30;
  var sp = { key: null, hits: null, total: 0, missing: 0, tableError: null, shown: SP_PAGE, loading: false };
  var strategyListeners = []; // 条件编辑器里的"目前命中 N / 总数"
  function refreshStrategy() {
    var panel = document.getElementById('strategy-panel');
    // 旧版页面 (还没重新生成的 index.html) 没有条件面板，也没有 ☰ 导航 → 不用算
    if (!panel && !strategyListeners.length && !document.getElementById('dash-hits')) return;
    var t = activeTemplate();
    var compiled = compileRules(t), valid = compiled.filter(function (c) { return !c.error; });
    if (!valid.length) {
      sp.key = null;
      sp.hits = null;
      sp.loading = false;
    } else {
      var key = t.id + '|' + t.match + '|' + valid.map(function (c) { return c.formula; }).join('\n');
      if (key !== sp.key) {
        sp.key = key;
        sp.hits = null;
        sp.shown = SP_PAGE;
        sp.loading = true;
        loadUniverse().then(function (u) {
          if (sp.key !== key) return; // 算完之前条件又改了，这次结果作废
          sp.hits = evaluateRules(u, valid, t.match);
          sp.total = u.items.length;
          sp.missing = u.missing;
          sp.tableError = u.tableError;
          sp.loading = false;
          renderStrategy(t, compiled);
        });
      }
    }
    if (panel) renderStrategy(t, compiled);
    else notifyStrategy(t, compiled);
  }
  function notifyStrategy(t, compiled) {
    var valid = compiled.filter(function (c) { return !c.error; }).length;
    var dashHits = document.getElementById('dash-hits');
    if (dashHits) dashHits.textContent = !valid ? '—' : sp.loading || !sp.hits ? '…' : String(sp.hits.length);
    strategyListeners.forEach(function (fn) { fn(t, compiled); });
  }
  function renderStrategy(t, compiled) {
    var panel = document.getElementById('strategy-panel');
    notifyStrategy(t, compiled);
    if (!panel) return;
    var total = reportStocks().length;
    if (!t.rules.length) { // 没有条件时只占一行，不要把下面的信号卡片挤到屏幕外
      panel.innerHTML = '<div class="sp-head sp-head-empty"><span class="sp-title">选股条件</span>' +
        '<span class="sp-match">自己在 ' + total + ' 支里筛，或从 ☰ 套用内置策略</span>' +
        '<div class="sp-actions"><button type="button" class="sp-btn primary" data-act="edit">＋ 添加条件</button></div></div>';
      return;
    }
    var errors = compiled.filter(function (c) { return c.error; });
    // 条件之间用「且 / 或」连起来，一眼看得出是全部满足还是任一满足
    var join = '<li class="sp-join" aria-hidden="true">' + (t.match === 'any' ? '或' : '且') + '</li>';
    var html = '<div class="sp-head"><span class="sp-title">选股条件</span><span class="sp-match">' + (t.match === 'any' ? '任一满足' : '全部满足') + ' · ' + t.rules.length + ' 条</span>' +
      '<div class="sp-actions"><button type="button" class="sp-btn" data-act="edit">✎ 编辑条件</button></div></div>' +
      '<ul class="sp-rules">' + compiled.map(function (c) {
        return '<li class="sp-rule' + (c.error ? ' err' : '') + '"' + (c.error ? ' title="' + escapeHtml(c.error) + '"' : '') + '>' +
          escapeHtml(ruleLabel(c.rule)) + (c.error ? ' ⚠' : '') + '</li>';
      }).join(join) + '</ul>';
    if (errors.length) html += '<p class="sp-err">' + errors.length + ' 条条件有错，没有参与筛选：' + escapeHtml(errors[0].error) + '</p>';
    if (errors.length === compiled.length) {
      panel.innerHTML = html;
      return;
    }
    if (sp.loading || !sp.hits) {
      panel.innerHTML = html + '<p class="sp-loading">正在用今天报告里的 ' + total + ' 支股票计算…</p>';
      return;
    }
    var note = '按成交额排序 · 看最新一根日线';
    if (sp.missing) note += ' · ' + sp.missing + ' 支没有K线数据没算' + (sp.tableError ? ' (表格股票的K线下载失败：' + sp.tableError + ')' : '');
    html += '<p class="sp-stat"><span>命中</span> <b>' + sp.hits.length + '</b> <span>/ ' + sp.total + ' 支</span> <small>' + escapeHtml(note) + '</small></p>';
    var validRules = compiled.filter(function (c) { return !c.error; });
    html += sp.bt && sp.bt.key === sp.key ? backtestHtml(sp.bt.result)
      : '<button type="button" class="sp-btn sp-bt-btn" data-act="backtest">回测这组条件 (近 6 个月)</button>';
    if (sp.hits.length) {
      html += '<ol class="sp-hits">' + sp.hits.slice(0, sp.shown).map(function (it, i) {
        var e = it.stock, vals = hitValues(it, validRules);
        return '<li class="sp-hit" data-i="' + i + '" tabindex="0" role="button" aria-label="打开 ' + escapeHtml(e.name + ' ' + e.code) + ' 的完整图表">' +
          '<span class="sp-idx">' + (i + 1) + '</span>' +
          '<span class="sp-name"><b>' + escapeHtml(e.name) + '</b><span class="sp-code">' + escapeHtml(e.code) + '</span>' + (e.card ? '<span class="sp-sig">信号</span>' : '') +
          (vals.length ? '<small class="sp-vals">' + escapeHtml(vals.join(' · ')) + '</small>' : '') + '</span>' +
          '<span class="sp-price">' + escapeHtml(e.price) + '</span>' +
          '<span class="sp-chg ' + (e.up === true ? 'change-up' : e.up === false ? 'change-down' : 'change-neutral') + '">' + escapeHtml(e.change) + '</span>' +
          '<span class="sp-vol">' + fmtCompact(lastTurnover(it)) + '</span></li>';
      }).join('') + '</ol>';
      var left = sp.hits.length - sp.shown;
      if (left > 0) html += '<button type="button" class="sp-btn sp-more" data-act="more">再显示 ' + Math.min(SP_PAGE, left) + ' 支 (还有 ' + left + ' 支)</button>';
    } else {
      html += '<p class="sp-empty">今天报告里没有股票符合这些条件。</p>';
    }
    panel.innerHTML = html;
  }
  (function initStrategyPanel() {
    var panel = document.getElementById('strategy-panel');
    if (!panel) return;
    function openHit(li) {
      var i = li ? +li.dataset.i : -1;
      if (!sp.hits || !sp.hits[i]) return;
      openReportStock(sp.hits[i].stock, { list: sp.hits.map(function (h) { return h.stock; }), i: i });
    }
    panel.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-act]');
      if (btn && btn.dataset.act === 'edit') { openRulesDialog(); return; }
      if (btn && btn.dataset.act === 'backtest') {
        var t = activeTemplate(), compiled = compileRules(t), key = sp.key;
        btn.disabled = true;
        btn.textContent = '回测中…';
        loadUniverse().then(function (u) {
          if (sp.key !== key) return;
          sp.bt = { key: key, result: backtestRules(u, compiled.filter(function (c) { return !c.error; }), t.match) };
          renderStrategy(t, compiled);
        });
        return;
      }
      if (btn && btn.dataset.act === 'more') { sp.shown += SP_PAGE; renderStrategy(activeTemplate(), compileRules(activeTemplate())); return; }
      openHit(e.target.closest('.sp-hit'));
    });
    panel.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        var li = e.target.closest('.sp-hit');
        if (li) { e.preventDefault(); openHit(li); }
      }
    });
  })();

  // ---------- 条件编辑器: 每条条件一张小卡片，改了立刻存进当前模板 ----------
  // 版面 (CSS grid，见 main.py 的 STRATEGY_CSS)：手机上三行 ——「① 条件 🗑」/「左边 [长度]」/「比较 右边 [长度或数字]」，
  // 长度、数字固定在最右一栏，下拉框右边对齐；电脑上一行排完。没有长度的地方下拉框直接占满那一栏
  function defaultRule() { return { id: newId('rule'), a: { k: 'close' }, op: '>', b: { k: 'sma', n: 20 } }; }
  function operandOptions(selected, forRight) {
    function opt(value, label) { return '<option value="' + value + '"' + (value === selected ? ' selected' : '') + '>' + escapeHtml(label) + '</option>'; }
    var html = forRight ? '<optgroup label="数字">' + opt('num', '固定数字') + '</optgroup>' : '';
    OPERAND_GROUPS.forEach(function (g) {
      var items = OPERANDS.filter(function (o) { return o.group === g[0] && (!forRight || o.unit !== 'bool'); });
      if (items.length) html += '<optgroup label="' + g[1] + '">' + items.map(function (o) { return opt(o.k, o.label); }).join('') + '</optgroup>';
    });
    return html;
  }
  // 数字后面的单位跟着左边走：价格 RM / $，百分比 %，倍数 倍，成交量 股
  function numberSuffix(r) {
    var u = OPERAND_BY_K[r.a.k] && OPERAND_BY_K[r.a.k].unit;
    return { price: MARKET.id === 'US' ? '$' : 'RM', pct: '%', ratio: '倍', vol: '股' }[u] || '';
  }
  // 长度 / 数字输入框 (右边带单位)
  function numBox(area, field, value, suffix, attrs, label) {
    return '<label class="rl-num rl-' + area + (suffix ? '' : ' no-suf') + '"><input class="rl-ctl" type="number" data-f="' + field + '" value="' + value + '" ' + attrs +
      ' aria-label="' + escapeHtml(label) + '">' + (suffix ? '<span class="rl-suf" aria-hidden="true">' + escapeHtml(suffix) + '</span>' : '') + '</label>';
  }
  function lenBox(ref, area, field) {
    var d = OPERAND_BY_K[ref.k];
    if (!d || !d.len) return '';
    return numBox(area, field, clampLen(ref.n, d.len), '日', 'min="1" max="' + MAX_LEN + '" step="1" inputmode="numeric"', d.label + ' 用几日计算');
  }
  function selectBox(area, field, options, label) {
    return '<select class="rl-ctl rl-' + area + '" data-f="' + field + '" aria-label="' + escapeHtml(label) + '">' + options + '</select>';
  }
  function ruleRowHtml(r, i) {
    var n = i + 1, id = escapeHtml(r.id);
    var del = '<button type="button" class="rl-btn rl-del" data-act="del" title="删除这条条件" aria-label="删除第 ' + n + ' 条条件">' + ICON_TRASH + '</button>';
    function no(text) { return '<span class="rl-no"><b>' + n + '</b><span class="rl-no-t">' + text + '</span></span>'; }
    if (r.formula !== undefined) {
      return '<div class="rl-row is-formula" data-id="' + id + '">' + no('公式条件') + del +
        '<textarea class="rl-ctl rl-formula" data-f="formula" rows="2" maxlength="300" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off"' +
        ' placeholder="例如 close > sma(close,50) and rsi(close,14) < 70" aria-label="第 ' + n + ' 条条件的公式">' + escapeHtml(r.formula) + '</textarea>' +
        '<p class="rl-err" hidden></p></div>';
    }
    var ad = OPERAND_BY_K[r.a.k], cls = 'rl-row' + (ad.len ? ' has-alen' : '');
    var html = no('条件') + del + selectBox('a', 'a', operandOptions(r.a.k, false), '第 ' + n + ' 条条件的左边') + lenBox(r.a, 'alen', 'an');
    if (isBoolOperand(r.a)) {
      cls += ' is-bool';
      html += '<div class="rl-seg rl-op" role="radiogroup" aria-label="成立或不成立">' + BOOL_OPS.map(function (o) {
        return '<label><input type="radio" name="rl-op-' + id + '" data-f="op" value="' + o.k + '"' + (r.op === o.k ? ' checked' : '') + '><span>' + o.label + '</span></label>';
      }).join('') + '</div>';
    } else {
      var bd = r.b.k === 'num' ? null : OPERAND_BY_K[r.b.k];
      var right = r.b.k === 'num'
        ? numBox('blen', 'bv', numLiteral(r.b.v), numberSuffix(r), 'step="any" inputmode="decimal"', '数字')
        : lenBox(r.b, 'blen', 'bn');
      if (right) cls += ' has-blen';
      html += selectBox('op', 'op', RULE_OPS.map(function (o) {
        return '<option value="' + o.k + '"' + (o.k === r.op ? ' selected' : '') + '>' + o.label + '</option>';
      }).join(''), '比较') + selectBox('b', 'b', operandOptions(r.b.k, true), '第 ' + n + ' 条条件的右边') + right;
    }
    var warn = unitWarning(r);
    return '<div class="' + cls + '" data-id="' + id + '">' + html +
      '<p class="rl-warn"' + (warn ? '' : ' hidden') + '>' + escapeHtml(warn) + '</p><p class="rl-err" hidden></p></div>';
  }
  function openRulesDialog() {
    var t = activeTemplate();
    var root = document.createElement('div');
    root.className = 'rules-dlg';
    root.innerHTML =
      '<div class="rl-top"><div class="rl-seg rl-match" role="radiogroup" aria-label="怎样算命中">' +
      '<label><input type="radio" name="rl-match" value="all"' + (t.match !== 'any' ? ' checked' : '') + '><span>全部满足</span></label>' +
      '<label><input type="radio" name="rl-match" value="any"' + (t.match === 'any' ? ' checked' : '') + '><span>任一满足</span></label></div>' +
      '<p class="rl-live" aria-live="polite"></p></div>' +
      '<div class="rl-list"></div>' +
      '<div class="rl-add"><button type="button" class="rl-btn" data-act="add"><b>＋</b>添加条件</button>' +
      '<button type="button" class="rl-btn" data-act="add-formula"><b>ƒ</b>公式条件</button></div>' +
      '<details class="rl-help"><summary>怎么看、怎么写</summary><ul>' +
      '<li>每支股票只看<b>最新一根日线</b>：<b>当前价格</b> = 报告更新时的最新成交价 (跟表格"价格"一样，收盘后就是收盘价)；「今日」= 最新这一根，「昨日收盘」= 前一根</li>' +
      '<li><b>上穿 / 下穿</b> = 这一根刚穿过去 (前一根还在另一边)；<b>日</b> = 用几根日线算，例如 EMA 20 日</li>' +
      '<li><b>公式条件</b>：比较 <code>&gt; &lt; &gt;= &lt;= == !=</code>，组合 <code>and</code> <code>or</code> <code>not</code>；' +
      '变量 <code>close</code> (当前价格) <code>open</code> <code>high</code> <code>low</code> <code>volume</code>；' +
      '函数 <code>sma</code> <code>ema</code> <code>rsi</code> <code>atr</code> <code>highest</code> <code>lowest</code> <code>ref(x,n)</code> <code>crossup(a,b)</code> <code>crossdown(a,b)</code> <code>psar()</code> <code>supertrend()</code> <code>t3()</code> 等</li>' +
      '<li>例子：<code>close &gt; ref(high,1) and volume &gt; 2*sma(volume,20)</code> (突破昨天高点，而且放量)</li>' +
      '</ul></details>';
    var list = root.querySelector('.rl-list'), live = root.querySelector('.rl-live');
    function renderRows() {
      list.innerHTML = t.rules.length ? t.rules.map(ruleRowHtml).join('') : '<p class="rl-empty">还没有条件，点下面的「＋ 添加条件」。</p>';
      updateStates();
    }
    function ruleOf(row) { var id = row && row.dataset.id; return t.rules.filter(function (r) { return r.id === id; })[0] || null; }
    function rowIndex(r) { return t.rules.indexOf(r); }
    function rerenderRow(row, r, focusField) {
      var tmp = document.createElement('div');
      tmp.innerHTML = ruleRowHtml(r, rowIndex(r));
      var fresh = tmp.firstChild;
      row.parentNode.replaceChild(fresh, row);
      if (focusField) { var f = fresh.querySelector('[data-f="' + focusField + '"]'); if (f) f.focus(); }
      updateStates();
    }
    // 单位提示 + 公式错误 (每条各自试算)
    function updateStates() {
      list.querySelectorAll('.rl-row').forEach(function (row) {
        var r = ruleOf(row);
        if (!r) return;
        var warn = row.querySelector('.rl-warn'), err = row.querySelector('.rl-err');
        if (warn) { var w = unitWarning(r); warn.textContent = w; warn.hidden = !w; }
        var msg = '';
        try {
          var f = ruleFormula(r);
          if (r.formula !== undefined && !f.trim()) msg = '';
          else testFormula(f);
        } catch (e) { msg = '公式错误：' + e.message; }
        err.textContent = msg;
        err.hidden = !msg;
      });
    }
    var timer = null;
    function save(now) {
      clearTimeout(timer);
      function run() { timer = null; persist(); refreshStrategy(); renderDashScreeners(); }
      if (now) run(); else timer = setTimeout(run, 250);
    }
    function onLive(tpl, compiled) {
      if (tpl !== t) return;
      var valid = compiled.filter(function (c) { return !c.error; }).length;
      live.innerHTML = !t.rules.length ? '还没有条件' : !valid ? '条件都有错，暂时算不了'
        : sp.loading || !sp.hits ? '计算中…' : '命中 <b>' + sp.hits.length + '</b><span> / ' + sp.total + ' 支</span>';
    }
    strategyListeners.push(onLive);

    root.addEventListener('change', function (e) {
      var el = e.target;
      if (el.name === 'rl-match') { t.match = el.value === 'any' ? 'any' : 'all'; save(true); return; }
      var row = el.closest('.rl-row'), r = ruleOf(row), f = el.dataset.f;
      if (!r || !f) return;
      if (f === 'a') {
        var d = OPERAND_BY_K[el.value];
        r.a = cleanRef({ k: el.value, n: d && d.len }, false);
        if (isBoolOperand(r.a)) { r.op = r.op === 'not' ? 'not' : 'is'; delete r.b; }
        else {
          if (!RULE_OP_LABEL[r.op]) r.op = '>';
          if (!r.b) r.b = { k: 'num', v: 0 };
        }
        rerenderRow(row, r, 'a');
      } else if (f === 'op') {
        r.op = el.value;
        updateStates();
      } else if (f === 'b') {
        var bd = OPERAND_BY_K[el.value];
        r.b = el.value === 'num' ? { k: 'num', v: r.b && r.b.k === 'num' ? r.b.v : 0 } : cleanRef({ k: el.value, n: bd && bd.len }, false);
        rerenderRow(row, r, 'b');
      } else {
        return; // 长度 / 数字 / 公式在下面的 input 事件里处理
      }
      save(false);
    });
    root.addEventListener('input', function (e) {
      var el = e.target, row = el.closest('.rl-row'), r = ruleOf(row), f = el.dataset.f;
      if (!r || !f) return;
      if (f === 'an' || f === 'bn') {
        var ref = f === 'an' ? r.a : r.b;
        var n = parseFloat(el.value);
        if (!isNum(n)) return; // 还在打字 (空的) 先不改
        ref.n = clampLen(n, OPERAND_BY_K[ref.k].len);
      } else if (f === 'bv') {
        var v = parseFloat(el.value);
        if (!isNum(v)) return;
        r.b.v = Math.max(-1e12, Math.min(1e12, v));
      } else if (f === 'formula') {
        r.formula = el.value.slice(0, 300);
      } else {
        return;
      }
      updateStates();
      save(false);
    });
    // 长度框打了超出范围的数字，离开时改回实际用的值
    root.addEventListener('focusout', function (e) {
      var el = e.target, row = el.closest && el.closest('.rl-row'), r = ruleOf(row);
      if (!r) return;
      if (el.dataset.f === 'an') el.value = r.a.n;
      else if (el.dataset.f === 'bn') el.value = r.b.n;
      else if (el.dataset.f === 'bv') el.value = numLiteral(r.b.v);
    });
    root.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-act]');
      if (!btn) return;
      var act = btn.dataset.act;
      if (act === 'del') {
        var r = ruleOf(btn.closest('.rl-row'));
        t.rules = t.rules.filter(function (x) { return x !== r; });
        renderRows();
        save(true);
      } else if (act === 'add' || act === 'add-formula') {
        var nr = act === 'add' ? defaultRule() : { id: newId('rule'), formula: '' };
        t.rules.push(nr);
        renderRows();
        var row = list.querySelector('[data-id="' + nr.id + '"]');
        var target = row && row.querySelector(act === 'add' ? 'select' : 'textarea');
        if (target) target.focus();
        save(true);
      }
    });
    renderRows();
    var dlg = openDialog({
      title: '选股条件：' + t.name, body: root, footer: true, className: 'dlg-rules',
      onClose: function () {
        if (timer) save(true); // 还没存的改动马上存
        strategyListeners.splice(strategyListeners.indexOf(onLive), 1);
      }
    });
    dlg.foot.innerHTML = '<span class="grow rl-foot-note">改了会自动保存到模板「' + escapeHtml(t.name) + '」</span><button type="button" class="btn-primary" data-act="done">完成</button>';
    dlg.foot.addEventListener('click', function (e) { if (e.target.closest('[data-act="done"]')) dlg.close(); });
    refreshStrategy(); // 填上"目前命中"
    return dlg;
  }

  // ---------- 左上角 ☰ 导航: 市场 / 概览 / 筛选器种类 ----------
  function renderDashScreeners() {
    var box = document.getElementById('dash-screeners');
    if (!box) return;
    var active = activeTemplate();
    var mine = templates.list.map(function (t) {
      var on = t.id === active.id;
      return '<button type="button" class="dash-item' + (on ? ' on' : '') + '" data-dash="tpl" data-id="' + escapeHtml(t.id) + '"' + (on ? ' aria-current="true"' : '') + '>' +
        '<span class="dash-item-name">' + escapeHtml(t.name) + '</span><small>' +
        (t.rules.length ? t.rules.length + ' 个条件' : '没有条件') + ' · ' + t.indicators.length + ' 个指标' + (on ? ' · 使用中' : '') + '</small></button>';
    }).join('');
    var builtins = BUILTIN_TEMPLATES.filter(isStrategy).map(function (bt) {
      var on = active.origin === bt.id;
      return '<button type="button" class="dash-item' + (on ? ' on' : '') + '" data-dash="builtin" data-id="' + bt.id + '">' +
        '<span class="dash-item-name">' + escapeHtml(bt.name) + '</span><small>' + escapeHtml(bt.desc) + '</small></button>';
    }).join('');
    box.innerHTML = '<h3 class="dash-sub">我的模板</h3><div class="dash-list">' + mine + '</div>' +
      '<div class="dash-actions"><button type="button" class="dash-act primary" data-dash="new">＋ 新建筛选器</button>' +
      '<button type="button" class="dash-act" data-dash="manage">管理模板</button></div>' +
      '<h3 class="dash-sub">内置策略</h3><div class="dash-list">' + builtins + '</div>' +
      '<p class="dash-note">点一下就切换到那个筛选器；内置策略第一次点会复制一份到「我的模板」，之后再点直接切过去。</p>';
  }
  var dashCloser = null;
  // ☰ 里的「自选」：今天报告里有的显示价格、涨跌，点了打开；不在报告里的 (成交量没达标) 灰掉
  function renderDashWatch() {
    var box = document.getElementById('dash-watch');
    if (!box) return;
    if (!watchList.length) {
      box.innerHTML = '<p class="dash-note">还没有自选股：打开任何一支股票，按「☆ 加自选」。表格上方的「★ 自选」可以只看自选。</p>';
      return;
    }
    box.innerHTML = '<div class="dash-list dash-watch">' + watchList.map(function (x) {
      var e = entryByCode(x.code), m = META.stocks[x.code];
      var chg = m && isNum(m.c) ? m.c : null;
      return '<div class="dash-witem' + (e ? '' : ' off') + '">' +
        (e ? '<button type="button" class="dash-wopen" data-dash="watch" data-code="' + escapeHtml(x.code) + '">' : '<span class="dash-wopen">') +
        '<b>' + escapeHtml(x.name) + '</b><small>' + escapeHtml(x.code) + '</small>' +
        (e ? '<span class="dash-wpx">' + escapeHtml(e.price) + '</span><span class="' + (chg > 0 ? 'change-up' : chg < 0 ? 'change-down' : 'change-neutral') + '">' +
          escapeHtml(e.change) + '</span>' : '<span class="dash-wpx muted">今天不在报告里</span>') +
        (e ? '</button>' : '</span>') +
        '<button type="button" class="dash-wx" data-dash="unwatch" data-code="' + escapeHtml(x.code) + '" data-name="' + escapeHtml(x.name) + '" aria-label="从自选移除 ' + escapeHtml(x.name) + '">×</button></div>';
    }).join('') + '</div>';
  }
  watchListeners.push(renderDashWatch);
  (function initDash() {
    var btn = document.getElementById('dash-btn'), nav = document.getElementById('dash'), backdrop = document.getElementById('dash-backdrop');
    if (!btn || !nav) return;
    function focusables() {
      return Array.prototype.filter.call(nav.querySelectorAll('a[href], button:not([disabled])'), function (el) { return el.offsetParent !== null; });
    }
    function onKey(e) {
      if (openDialogs.length) return; // 上面还开着对话框，让对话框自己处理
      if (e.key === 'Escape') { e.preventDefault(); close(true); }
      else if (e.key === 'Tab') { // 焦点留在导航里
        var f = focusables();
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
        else if (!nav.contains(document.activeElement)) { e.preventDefault(); f[0].focus(); }
      }
    }
    var layer = null;
    function open() {
      renderDashScreeners();
      renderDashWatch();
      nav.hidden = false;
      if (backdrop) backdrop.hidden = false;
      document.documentElement.classList.add('dash-open');
      btn.setAttribute('aria-expanded', 'true');
      document.addEventListener('keydown', onKey, true);
      layer = pushLayer(function () { close(true, true); }); // 按返回 = 关导航
      var x = nav.querySelector('.dash-x');
      if (x) x.focus({ preventScroll: true });
    }
    // keep = 接着要打开对话框：导航占的那一格 history 直接交给对话框用 (返回一次就回到页面)，返回 { layer }
    function close(restoreFocus, fromPop, keep) {
      if (nav.hidden) return null;
      nav.hidden = true;
      if (backdrop) backdrop.hidden = true;
      document.documentElement.classList.remove('dash-open');
      btn.setAttribute('aria-expanded', 'false');
      document.removeEventListener('keydown', onKey, true);
      var handed = keep && layer ? { layer: layer, previousFocus: btn } : null;
      if (!fromPop && !handed) releaseLayer(layer);
      layer = null;
      if (restoreFocus) btn.focus({ preventScroll: true });
      return handed;
    }
    dashCloser = close;
    function goToScreener() {
      var sec = document.getElementById('sec-screener');
      if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    btn.addEventListener('click', function () { if (nav.hidden) open(); else close(true); });
    if (backdrop) backdrop.addEventListener('click', function () { close(true); });
    nav.addEventListener('click', function (e) {
      if (e.target.closest('.dash-x')) { close(true); return; }
      var link = e.target.closest('a[href]');
      if (link) {
        var hash = link.getAttribute('href');
        // 页面里的区块: 自己滚过去 (不留 #xxx 在网址和历史记录里，按返回不会卡在同一页)；另一个市场、下载文件照常
        if (/^#[\w-]+$/.test(hash) && document.getElementById(hash.slice(1))) {
          e.preventDefault();
          close(false);
          var target = document.getElementById(hash.slice(1));
          setTimeout(function () { target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 30);
        } else if (!link.hasAttribute('download')) {
          close(false);
        }
        return;
      }
      var b = e.target.closest('[data-dash]');
      if (!b) return;
      var act = b.dataset.dash;
      if (act === 'calc' || act === 'gloss') {
        var handed = close(false, false, true);
        if (act === 'calc') openCalculator({}, handed); else openGlossary(null, handed);
        return;
      }
      if (act === 'watch') {
        var we = entryByCode(b.dataset.code);
        if (!we) return;
        var wl = watchList.map(function (x) { return entryByCode(x.code); }).filter(Boolean);
        var h = close(false, false, true);
        openReportStock(we, { list: wl, i: wl.indexOf(we) }, { reuse: h, previousFocus: h && h.previousFocus });
        return;
      }
      if (act === 'unwatch') { toggleWatch(b.dataset.code, b.dataset.name); return; }
      if (act === 'tpl') {
        templates.active = b.dataset.id;
        indicatorsChanged();
        close(true);
        goToScreener();
        toast('已切换到筛选器「' + activeTemplate().name + '」');
      } else if (act === 'builtin') {
        var bt = builtinById(b.dataset.id);
        if (!bt) return;
        applyBuiltin(bt, true);
        close(true);
        goToScreener();
        toast('已切换到「' + activeTemplate().name + '」');
      } else if (act === 'new') {
        newTemplate('筛选器 ' + (templates.list.length + 1));
        indicatorsChanged();
        close(true);
        goToScreener();
        openRulesDialog();
      } else if (act === 'manage') {
        close(true);
        openIndicatorsDialog('mytpl');
      }
    });
  })();

  // ---------- 页面最下方固定的搜索栏: 滑到哪里都能直接打股票名称或代码，选中就打开完整图表 + 财报 + 新闻 ----------
  (function () {
    var entries = reportStocks();
    if (!entries.length) return;
    var dock = document.createElement('div');
    dock.className = 'dock';
    dock.setAttribute('role', 'search');
    dock.innerHTML = '<div class="dock-inner"><ul class="dock-list" id="dock-list" role="listbox" aria-label="搜索结果" hidden></ul>' +
      '<input type="search" id="dock-input" placeholder="搜股票名称或代码，' + escapeHtml(MARKET.searchHint) + '" autocomplete="off" autocapitalize="characters" spellcheck="false"' +
      ' enterkeyhint="search" role="combobox" aria-expanded="false" aria-controls="dock-list" aria-autocomplete="list" aria-label="搜索股票"></div>';
    document.body.appendChild(dock);
    document.documentElement.classList.add('has-dock');
    var input = dock.querySelector('input'), list = dock.querySelector('ul');
    var shown = [], active = -1;

    // 排序: 代码或名称完全一样 > 代码开头 > 名称开头 > 名称包含 > 代码包含；同分时信号股在前，再按页面原来的顺序 (成交量)
    function search(q) {
      q = q.trim().toLowerCase();
      if (!q) return [];
      var out = [];
      entries.forEach(function (e, i) {
        var code = e.code.toLowerCase(), name = e.name.toLowerCase(), s = -1;
        if (code === q || name === q) s = 0; else if (code.indexOf(q) === 0) s = 1; else if (name.indexOf(q) === 0) s = 2;
        else if (name.indexOf(q) !== -1) s = 3; else if (code.indexOf(q) !== -1) s = 4;
        if (s !== -1) out.push({ e: e, s: s, i: i });
      });
      out.sort(function (a, b) { return a.s - b.s || (b.e.card ? 1 : 0) - (a.e.card ? 1 : 0) || a.i - b.i; });
      return out.slice(0, 8).map(function (x) { return x.e; });
    }
    function setActive(i) {
      active = i;
      list.querySelectorAll('[role=option]').forEach(function (li, j) { li.setAttribute('aria-selected', j === i ? 'true' : 'false'); });
      var cur = list.querySelector('[aria-selected=true]');
      if (cur) { input.setAttribute('aria-activedescendant', cur.id); cur.scrollIntoView({ block: 'nearest' }); }
      else input.removeAttribute('aria-activedescendant');
    }
    function render() {
      var q = input.value;
      shown = search(q);
      if (!q.trim()) { hide(); return; }
      list.innerHTML = shown.length ? shown.map(function (e, i) {
        return '<li role="option" id="dock-opt-' + i + '" data-i="' + i + '" aria-selected="false"><b>' + escapeHtml(e.name) + '</b>' +
          '<span class="dock-code">' + escapeHtml(e.code) + '</span>' + (e.card ? '<span class="dock-sig">信号</span>' : '') +
          '<span class="dock-price">' + escapeHtml(e.price) + '</span>' +
          '<span class="dock-chg ' + (e.up === true ? 'change-up' : e.up === false ? 'change-down' : '') + '">' + escapeHtml(e.change) + '</span></li>';
      }).join('') : '<li class="dock-empty">今天的报告里没有「' + escapeHtml(q.trim()) + '」(成交量没达标的股票不在报告里，或者代码打错了)</li>';
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      setActive(shown.length ? 0 : -1);
    }
    function hide() {
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      active = -1;
    }
    function open(e) {
      if (!e) return;
      hide();
      input.value = '';
      input.blur();
      openReportStock(e);
    }
    input.addEventListener('input', render);
    input.addEventListener('focus', function () { if (input.value.trim()) render(); });
    input.addEventListener('blur', function () { setTimeout(hide, 150); });
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        if (!shown.length) return;
        ev.preventDefault();
        setActive((active + (ev.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length);
      } else if (ev.key === 'Enter') {
        ev.preventDefault();
        open(shown[active >= 0 ? active : 0]);
      } else if (ev.key === 'Escape') {
        hide();
        input.blur();
      }
    });
    list.addEventListener('mousedown', function (ev) { ev.preventDefault(); }); // 点选项时输入框不要先失焦把列表关掉
    list.addEventListener('click', function (ev) {
      var li = ev.target.closest('[data-i]');
      if (li) open(shown[+li.dataset.i]);
    });
    // 电脑上在页面任何地方按 / 就跳到搜索栏
    document.addEventListener('keydown', function (ev) {
      if (ev.key !== '/' || ev.ctrlKey || ev.metaKey || ev.altKey) return;
      var el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if (document.documentElement.classList.contains('dlg-open')) return;
      ev.preventDefault();
      input.focus();
    });
  })();

  // ---------- 股票计算器: 手续费 / 印花税 / 保本价 + 按风险算股数 ----------
  // 马股收费 (普通股)：佣金看券商 (常见 0.1%、最低 RM8)；结算费 0.03% 最多 RM1,000；印花税每 RM1,000 (不足也算) RM1、最多 RM1,000
  // (2023-07-13 到 2028-07-12 的税率)；普通股的佣金、结算费不收 8% SST (ETF / REIT / 权证要)。买、卖各收一次。
  // 美股：各家券商差很多，默认值只是例子；金额用美元算，另外按汇率换成令吉。收费标准存在这个浏览器里，改一次就记住
  var CALC_KEY = 'bursa_calc_v1_' + MARKET.id;
  var CALC_DEFAULTS = MARKET.id === 'US'
    ? { rate: 0.1, min: 1, fixed: 0, sst: 0, clear: 0, clearCap: 0, stamp: 0, stampCap: 0, spread: 0.5 }
    : { rate: 0.1, min: 8, fixed: 0, sst: 0, clear: 0.03, clearCap: 1000, stamp: 1, stampCap: 1000, spread: 0 };
  var CALC_FEE_FIELDS = MARKET.id === 'US'
    ? [['rate', '佣金 (%)'], ['min', '最低佣金 (US$)'], ['fixed', '每笔平台费 (US$)'], ['spread', '换汇差价 (%)']]
    : [['rate', '佣金 (%)'], ['min', '最低佣金 (RM)'], ['sst', '佣金服务税 SST (%)'], ['clear', '结算费 (%)'], ['clearCap', '结算费上限 (RM)'],
      ['stamp', '印花税 (每 RM1,000，RM)'], ['stampCap', '印花税上限 (RM)'], ['fixed', '每笔其他费用 (RM)']];
  function r2(x) { return Math.round(x * 100) / 100; }
  function feesFor(value, f) {
    if (!(value > 0)) return { brok: 0, sst: 0, clear: 0, stamp: 0, fixed: 0, total: 0 };
    var brok = r2(Math.max(value * (f.rate || 0) / 100, f.min || 0));
    var sst = r2(brok * (f.sst || 0) / 100);
    var clear = f.clear ? r2(Math.min(value * f.clear / 100, f.clearCap || Infinity)) : 0;
    var stamp = f.stamp ? Math.min(Math.ceil(value / 1000 - 1e-9) * f.stamp, f.stampCap || Infinity) : 0;
    var fixed = f.fixed || 0;
    return { brok: brok, sst: sst, clear: clear, stamp: stamp, fixed: fixed, total: r2(brok + sst + clear + stamp + fixed) };
  }
  function tickOf(p) {
    if (MARKET.id === 'US') return 0.01;
    return p < 1 ? 0.005 : p < 10 ? 0.01 : p < 100 ? 0.02 : 0.1;
  }
  function roundTick(p, up) {
    var t = tickOf(p), k = p / t;
    k = up ? Math.ceil(k - 1e-9) : Math.floor(k + 1e-9);
    return Math.round(k * t * 1e6) / 1e6;
  }
  // 保本卖价: 卖掉之后扣完卖出费用，刚好拿回买入总成本的最低价 (按最小跳动往上取)
  function breakEvenPrice(cost, shares, f) {
    if (!(cost > 0) || !(shares > 0)) return null;
    var p = roundTick(cost / shares, true);
    for (var k = 0; k < 5000; k++) {
      var v = p * shares;
      if (v - feesFor(v, f).total >= cost - 1e-6) return p;
      p = Math.round((p + tickOf(p)) * 1e6) / 1e6;
    }
    return null;
  }
  function feeBreakdown(fe) {
    var parts = [['佣金', fe.brok], ['SST', fe.sst], ['结算费', fe.clear], ['印花税', fe.stamp], ['其他', fe.fixed]]
      .filter(function (x) { return x[1] > 0; }).map(function (x) { return x[0] + ' ' + fmtMoney2(x[1]); });
    return parts.join(' · ');
  }
  function openCalculator(pre, handed) {
    pre = pre || {};
    var saved = loadJSON(CALC_KEY, {}) || {};
    var fees = {};
    Object.keys(CALC_DEFAULTS).forEach(function (k) { fees[k] = isNum(saved.fees && saved.fees[k]) ? saved.fees[k] : CALC_DEFAULTS[k]; });
    var m = pre.code ? META.stocks[pre.code] : null;
    var price = m && isNum(m.p) ? m.p : null;
    var us = MARKET.id === 'US';
    var st = {
      buy: price, sell: price ? roundTick(price * 1.05, true) : null, qty: us ? 10 : 10, unit: us ? 'share' : 'lot',
      fx: isNum(META.usd_myr) ? META.usd_myr : (isNum(saved.fx) ? saved.fx : 4.2),
      capital: isNum(saved.capital) ? saved.capital : (us ? 5000 : 10000), riskAmt: isNum(saved.riskAmt) ? saved.riskAmt : (us ? 50 : 200),
      entry: price, stop: m && isNum(m.sar) && price && m.sar < price ? m.sar : (price ? roundTick(price * 0.95, false) : null),
      target: price ? roundTick(price * 1.1, true) : null
    };
    var sym = CUR_SYM;
    function numIn(k, label, val, extra) {
      return '<label class="cf"><span>' + label + '</span><input type="number" inputmode="decimal" step="any" min="0" data-k="' + k + '"' +
        (isNum(val) ? ' value="' + val + '"' : '') + (extra || '') + '></label>';
    }
    var body = document.createElement('div');
    body.className = 'calc';
    body.innerHTML =
      (pre.code ? '<p class="calc-stock"><b>' + escapeHtml(pre.name || pre.code) + '</b> ' + escapeHtml(pre.code) + (price ? ' · 现价 ' + fmtPrice(price) : '') +
        (m && isNum(m.sar) ? ' · SAR ' + fmtPrice(m.sar) : '') + '</p>' : '') +
      '<div class="rl-seg calc-tabs" role="radiogroup" aria-label="计算器">' +
      '<label><input type="radio" name="calc-pane" value="cost" checked><span>交易成本 · 保本价</span></label>' +
      '<label><input type="radio" name="calc-pane" value="risk"><span>按风险算股数</span></label></div>' +
      '<section class="calc-pane" data-pane="cost"><div class="calc-grid">' +
      numIn('buy', '买入价 (' + sym + ')', st.buy) + numIn('sell', '卖出价 (' + sym + ')', st.sell) +
      '<label class="cf cf-qty"><span>数量</span><span class="cf-row"><input type="number" inputmode="numeric" step="1" min="0" data-k="qty" value="' + st.qty + '">' +
      (us ? '<em>股</em>' : '<span class="rl-seg calc-unit" role="radiogroup" aria-label="数量单位"><label><input type="radio" name="calc-unit" value="lot" checked><span>手</span></label>' +
        '<label><input type="radio" name="calc-unit" value="share"><span>股</span></label></span>') + '</span></label>' +
      (us ? numIn('fx', '汇率 (1 美元 = ? 令吉)', st.fx) : '') +
      '</div><div class="calc-out" aria-live="polite"></div>' +
      '<details class="calc-fees"><summary>收费标准 (按你的券商改，会记住)</summary><div class="calc-grid">' +
      CALC_FEE_FIELDS.map(function (x) { return numIn('fee-' + x[0], x[1], fees[x[0]]); }).join('') +
      '</div><p class="hint">' + (us ? '美股各家券商收费差很多 (有的每笔固定几美元、有的按比例)，这里的默认值只是例子。换汇差价 = 令吉换美元时银行 / 券商多收的百分比。'
        : '默认：佣金 0.1% 最低 RM8 (多数券商网上交易)；结算费 0.03% 最多 RM1,000；印花税每 RM1,000 (不足也算) RM1、最多 RM1,000。买、卖各收一次。' +
          '普通股的佣金、结算费不收 SST；ETF、REIT、权证要另加 8%，把 SST 填 8。') +
      '</p><button type="button" class="sp-btn calc-reset">恢复默认</button></details></section>' +
      '<section class="calc-pane" data-pane="risk" hidden><div class="calc-grid">' +
      numIn('capital', '本金 (' + sym + ')', st.capital) + numIn('riskAmt', '这一笔最多亏 (' + sym + ')', st.riskAmt) +
      numIn('entry', '进场价', st.entry) + numIn('stop', '风险价 (跌到这里就认赔，例如 SAR)', st.stop) +
      numIn('target', '预期卖价', st.target) +
      '</div><div class="calc-out calc-risk-out" aria-live="polite"></div>' +
      '<p class="hint">股数 = 愿意亏的金额 ÷ (进场价 − 风险价)，' + (LOT > 1 ? '按一手 ' + LOT + ' 股往下取整，' : '') + '不超过本金；亏损、报酬都已经扣掉买卖费用。只是资金管理的算术，不是买卖建议。</p></section>';
    var dlg = openDialog({ title: '股票计算器', body: body, className: 'dlg-calc', reuse: handed, previousFocus: handed && handed.previousFocus });
    function val(k) { var el = body.querySelector('[data-k="' + k + '"]'); var v = el ? parseFloat(el.value) : NaN; return isFinite(v) ? v : null; }
    function unit() { var el = body.querySelector('input[name="calc-unit"]:checked'); return us ? 'share' : el ? el.value : 'lot'; }
    function readFees() {
      var f = {};
      Object.keys(CALC_DEFAULTS).forEach(function (k) { var v = val('fee-' + k); f[k] = v === null ? (body.querySelector('[data-k="fee-' + k + '"]') ? 0 : CALC_DEFAULTS[k]) : v; });
      return f;
    }
    function row(label, value, cls, sub) {
      return '<div class="co-row' + (cls ? ' ' + cls : '') + '"><span>' + label + '</span><b>' + value + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</div>';
    }
    function money(v, signed) { return (signed && v > 0 ? '+' : '') + sym + ' ' + fmtMoney2(v); }
    // 美股: 令吉换美元 (买) 按汇率多付换汇差价，美元换回令吉 (卖) 少拿换汇差价
    function inMyr(v, f, signed, side) {
      if (!us || !isNum(v) || !(val('fx') > 0)) return '';
      var sp = (f.spread || 0) / 100, rate = val('fx') * (side === 'buy' ? 1 + sp : side === 'sell' ? 1 - sp : 1);
      return '≈ ' + (signed && v > 0 ? '+' : '') + 'RM ' + fmtMoney2(v * rate);
    }
    function renderCost() {
      var f = readFees(), buy = val('buy'), sell = val('sell'), q = val('qty');
      var shares = q === null ? 0 : Math.floor(q) * (unit() === 'lot' ? LOT : 1);
      var out = body.querySelector('[data-pane="cost"] .calc-out');
      if (!(buy > 0) || !(shares > 0)) { out.innerHTML = '<p class="hint">填上买入价和数量就会算出来。</p>'; return; }
      var bv = buy * shares, bf = feesFor(bv, f), cost = bv + bf.total;
      var html = row('股数', shares.toLocaleString('en-US') + ' 股' + (unit() === 'lot' ? ' (' + Math.floor(q) + ' 手)' : ''), '') +
        row('买入金额', money(bv), '', inMyr(bv, f, false, 'buy')) +
        row('买入费用', money(bf.total), '', feeBreakdown(bf)) +
        row('买入总成本', money(cost), 'co-strong', inMyr(cost, f, false, 'buy'));
      var be = breakEvenPrice(cost, shares, f);
      if (be) html += row('保本卖价', fmtPrice(be), 'co-strong', '比买入价高 ' + fmtPct((be / buy - 1) * 100, 2, false) + ' 才打平 (已扣买卖费用)');
      if (sell > 0) {
        var sv = sell * shares, sf = feesFor(sv, f), net = sv - sf.total - cost, netMyr = '';
        if (us && val('fx') > 0) {
          var sp = (f.spread || 0) / 100, myr = (sv - sf.total) * val('fx') * (1 - sp) - cost * val('fx') * (1 + sp);
          netMyr = '换回令吉 ≈ ' + (myr > 0 ? '+' : '') + 'RM ' + fmtMoney2(myr) + (sp ? ' (已扣两次换汇差价)' : '');
        }
        html += row('卖出金额', money(sv), '', '') + row('卖出费用', money(sf.total), '', feeBreakdown(sf)) +
          row(net >= 0 ? '净赚' : '净亏', money(net, true) + ' (' + fmtPct(net / cost * 100, 2) + ')', 'co-strong ' + (net > 0 ? 'co-up' : net < 0 ? 'co-down' : ''), netMyr) +
          row('来回费用合计', money(bf.total + sf.total), '', '占买入金额 ' + fmtPct((bf.total + sf.total) / bv * 100, 2, false));
      }
      out.innerHTML = html;
    }
    function renderRisk() {
      var f = readFees(), cap = val('capital'), risk = val('riskAmt'), e = val('entry'), s = val('stop'), t = val('target');
      var out = body.querySelector('.calc-risk-out');
      if (!(e > 0) || !(s > 0) || !(risk > 0)) { out.innerHTML = '<p class="hint">填上进场价、风险价和愿意亏的金额。</p>'; return; }
      if (s >= e) { out.innerHTML = '<p class="hint change-down">风险价要低于进场价。</p>'; return; }
      var perShare = e - s;
      // 跌到风险价时的亏损 (含买、卖两次费用)
      var lossAt = function (n) { var v = e * n; return s * n - feesFor(s * n, f).total - (v + feesFor(v, f).total); };
      var shares = Math.floor(risk / perShare / LOT) * LOT;
      while (shares > 0 && -lossAt(shares) > risk + 1e-9) shares -= LOT; // 连费用一起算也不超过愿意亏的金额
      var byCap = cap > 0 ? Math.floor(cap / (e * 1.003) / LOT) * LOT : Infinity; // 留一点给费用
      var capped = byCap < shares;
      shares = Math.min(shares, byCap);
      if (!(shares > 0)) { out.innerHTML = '<p class="hint change-down">按这些数字连' + (LOT > 1 ? '一手 (' + LOT + ' 股)' : '一股') + '都买不了：愿意亏的金额太少，或者风险价离进场价太远。</p>'; return; }
      var bv = e * shares, bf = feesFor(bv, f), cost = bv + bf.total;
      var sv = s * shares, lossNet = sv - feesFor(sv, f).total - cost;
      var html = row('可以买', shares.toLocaleString('en-US') + ' 股' + (LOT > 1 ? ' (' + shares / LOT + ' 手)' : ''), 'co-strong', capped ? '受本金限制' : '按愿意亏的金额算') +
        row('需要资金', money(cost), '', (cap > 0 ? '占本金 ' + fmtPct(cost / cap * 100, 1, false) : '') + (inMyr(cost, f, false, 'buy') ? ' · ' + inMyr(cost, f, false, 'buy') : '')) +
        row('跌到风险价', money(lossNet, true) + ' (' + fmtPct(lossNet / cost * 100, 2) + ')', 'co-down', '每股风险 ' + fmtPrice(perShare) + ' (' + fmtPct(-perShare / e * 100, 2) + ')，已含买卖费用');
      if (t > e) {
        var tv = t * shares, gain = tv - feesFor(tv, f).total - cost;
        html += row('到预期卖价', money(gain, true) + ' (' + fmtPct(gain / cost * 100, 2) + ')', 'co-up', '已含买卖费用') +
          row('风险报酬比', '1 : ' + ((t - e) / perShare).toFixed(2), 'co-strong', '扣费用后 1 : ' + (lossNet < 0 ? (gain / -lossNet).toFixed(2) : '—'));
      }
      out.innerHTML = html + '<button type="button" class="sp-btn calc-use">用这个股数算交易成本 ›</button>';
      out.querySelector('.calc-use').dataset.shares = shares;
    }
    function save() {
      saveJSON(CALC_KEY, { fees: readFees(), fx: val('fx'), capital: val('capital'), riskAmt: val('riskAmt') });
    }
    function render() { renderCost(); renderRisk(); }
    body.addEventListener('input', function () { render(); save(); });
    // 只处理两组单选 (页签、手 / 股)。数字框打字时 input 已经重算过了；这里再算一次会在输入框失焦时把结果区重画，
    // 手机上刚好按在"用这个股数"按钮上的那一下就不算了
    body.addEventListener('change', function (e) {
      if (e.target.name === 'calc-pane') {
        body.querySelectorAll('.calc-pane').forEach(function (p) { p.hidden = p.dataset.pane !== e.target.value; });
      } else if (e.target.name === 'calc-unit') {
        var qEl = body.querySelector('[data-k="qty"]'), q = parseFloat(qEl.value);
        if (isFinite(q)) qEl.value = e.target.value === 'share' ? q * LOT : Math.floor(q / LOT);
        render();
      }
    });
    body.addEventListener('click', function (e) {
      if (e.target.closest('.calc-reset')) {
        CALC_FEE_FIELDS.forEach(function (x) { body.querySelector('[data-k="fee-' + x[0] + '"]').value = CALC_DEFAULTS[x[0]]; });
        render();
        save();
        return;
      }
      var use = e.target.closest('.calc-use');
      if (use) {
        var n = +use.dataset.shares;
        body.querySelector('[data-k="buy"]').value = val('entry');
        body.querySelector('[data-k="sell"]').value = val('target') || '';
        var shareRadio = body.querySelector('input[name="calc-unit"][value="share"]');
        if (shareRadio) shareRadio.checked = true;
        body.querySelector('[data-k="qty"]').value = n;
        var costRadio = body.querySelector('input[name="calc-pane"][value="cost"]');
        costRadio.checked = true;
        body.querySelectorAll('.calc-pane').forEach(function (p) { p.hidden = p.dataset.pane !== 'cost'; });
        render();
      }
    });
    render();
    return dlg;
  }

  // ---------- 名词解释 (☰ → 名词解释，或页面上的 ⓘ) ----------
  var GLOSSARY = [
    ['price', '当前价格', '报告生成时的最新成交价 (盘中会有几分钟延迟)，收盘后就是当天收盘价。'],
    ['state', '盘中 / 已收盘', '报告在交易时间里生成时标「盘中」：最新一根日线还没收完，信号收盘前可能消失；「已收盘」= 用的是当天收盘价。'],
    ['turnover', '成交额', '价格 × 成交股数，代表今天有多少钱在买卖这支股票。马股低价股动辄成交几亿股但金额很小，所以表格按成交额排。'],
    ['relvol', '相对量', '今天成交量 ÷ 前 20 个交易日的平均成交量。2 倍以上 = 明显放量。平时几乎没成交的股票倍数会虚高，超过 20 倍显示「20+」。'],
    ['rsi', 'RSI (14)', '最近 14 天涨跌力度的比例，0 ~ 100。一般把 70 以上叫超买、30 以下叫超卖，只是描述，不代表一定会回头。'],
    ['ema', 'EMA20', '20 天指数移动平均线 (近期价格权重大一点)。价格在 EMA20 上面 = 短期趋势向上。卡片上「EMA20多头 +3.0%」= 现价高出 EMA20 3%。'],
    ['sar', 'SAR (抛物线转向)', '跟着价格移动的一串点。价格在 SAR 上面 = 多头；收盘跌到 SAR 下面就转空。常被当成跟踪式的风险价。'],
    ['t3', 'T3 形态突破', '2 ~ 5 天前某天放量 (成交量高于前 20 天平均) 创出当天最高价，之后几天都没超过那个价 (回调)，今天收盘再突破它。'],
    ['atr', 'ATR (14)', '最近 14 天平均每天的波动幅度，这里用占股价的百分比表示。数字越大，股价每天上下跳得越多。'],
    ['risk', '风险 (到 SAR)', '现价跌到 SAR 要跌多少 %。SAR 是后台策略自己的转空线，所以拿来当"这笔信号的风险"参考。'],
    ['rr', '风险报酬比', '1 : X = 每冒 1 份风险 (到 SAR 的距离)，历史上同类信号期间最大涨幅的中位数是几份。X 越大越划算，但这是历史统计，不保证。'],
    ['backtest', '策略回测怎么算', '用近 6 个月的日线，把后台策略 (EMA20 多头 + SAR 多头 + T3 形态突破) 每一天都判断一次：信号当天收盘后，隔天开盘价计入；之后哪天收盘跌到 SAR 以下就按当天收盘价结算，最多拿 20 个交易日。每笔扣掉来回交易成本。另外看信号之后固定 5 / 10 / 20 天的涨跌，跟同期「任意一天买进」的平均比，看信号有没有比随便买好。只统计今天进报告的股票 (有幸存者偏差)，历史统计不代表未来。'],
    ['winrate', '胜率', '已结算的信号里，扣完成本还赚钱的比例。'],
    ['payoff', '盈亏比', '平均每笔赚的 ÷ 平均每笔亏的。胜率低但盈亏比高也可能整体赚钱。'],
    ['pf', '获利因子', '所有赚钱的笔数加起来 ÷ 所有亏钱的加起来。大于 1 = 整体赚钱。'],
    ['r', 'R 倍数', '每笔收益 ÷ 这笔的初始风险 (计入价到 SAR 的距离)。平均 R 大于 0 = 平均每冒 1 份风险能赚回多于 0 份。'],
    ['mfe', '期间最大涨幅 / 跌幅', '持有期间最高曾经涨到多少 (MFE)、最低曾经跌到多少 (MAE)，用来看"到过多少"，不是最后结算的收益。'],
    ['cbt', '回测这组条件', '在浏览器里用报告里每支股票最近约 6 个月的日线，把你的条件每一天都算一次；条件"由不成立变成立"的那天算一次，隔天开盘价计入，看 5 / 10 / 20 天后的涨跌，跟同期任意一天买进比。没扣交易成本。'],
    ['tick', '跳一格', 'Bursa 的最小价格跳动：1 令吉以下 0.005、1 ~ 10 令吉 0.01、10 ~ 100 令吉 0.02。0.035 的股票跳一格就是 14%，涨跌幅看起来很夸张。'],
    ['range', '52 周区间', '过去一年的最低价 ~ 最高价，小条上的点 = 现价在这个区间的位置。'],
    ['pe', '市盈率 / 股息率', '市盈率 = 股价 ÷ 过去 12 个月每股盈利 (亏损公司没有)；股息率 = 过去 12 个月派的股息 ÷ 股价。来自 Yahoo Finance。']
  ];
  function openGlossary(focusKey, handed) {
    var body = '<dl class="gloss">' + GLOSSARY.map(function (g) {
      return '<div id="gloss-' + g[0] + '"' + (g[0] === focusKey ? ' class="on"' : '') + '><dt>' + g[1] + '</dt><dd>' + g[2] + '</dd></div>';
    }).join('') + '</dl>';
    var dlg = openDialog({ title: '名词解释', body: body, className: 'dlg-gloss', reuse: handed, previousFocus: handed && handed.previousFocus });
    if (focusKey) {
      var el = dlg.body.querySelector('#gloss-' + focusKey);
      if (el) setTimeout(function () { el.scrollIntoView({ block: 'start' }); }, 30);
    }
    return dlg;
  }

  // ---------- 页面上各区块里点股票名 (今日市场的榜单、公告栏、回测里最近的信号) = 打开完整图表 ----------
  function codesIn(container) {
    var seen = {}, out = [];
    container.querySelectorAll('[data-code]').forEach(function (el) {
      if (el.closest('[hidden]') || seen[el.dataset.code]) return;
      seen[el.dataset.code] = 1;
      var e = entryByCode(el.dataset.code);
      if (e) out.push(e);
    });
    return out;
  }
  function openFromSection(el) {
    var e = entryByCode(el.dataset.code);
    if (!e) { toast('今天的报告里没有这支股票的图表'); return; }
    var list = codesIn(el.closest('.mk-movers, .ann-board, tbody') || document.body);
    openReportStock(e, { list: list, i: list.indexOf(e) });
  }
  document.addEventListener('click', function (e) {
    var info = e.target.closest('.info-btn[data-gloss]');
    if (info) { e.preventDefault(); openGlossary(info.dataset.gloss); return; }
    var el = e.target.closest('#sec-market .mk-chip[data-code], .ann-board .ann-stock[data-code], #sec-backtest tr[data-code]');
    if (el) openFromSection(el);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    var el = e.target.closest && e.target.closest('#sec-backtest tr[data-code]');
    if (el) openFromSection(el);
  });

  // ---------- 公司公告栏: 分类筛选 + 先显示 12 条 ----------
  (function initBoard() {
    var board = document.getElementById('ann-board');
    if (!board) return;
    var items = Array.prototype.slice.call(board.children), LIMIT = 12, expanded = false, cat = '';
    var more = document.createElement('button');
    more.type = 'button';
    more.className = 'sp-btn ann-more';
    board.insertAdjacentElement('afterend', more);
    function apply() {
      var matched = items.filter(function (li) { return !cat || li.dataset.cat === cat; });
      items.forEach(function (li) { li.hidden = true; });
      matched.forEach(function (li, i) { li.hidden = !expanded && i >= LIMIT; });
      var left = matched.length - LIMIT;
      more.hidden = expanded || left <= 0;
      more.textContent = '再显示 ' + left + ' 条';
    }
    var filter = document.querySelector('.ann-filter');
    if (filter) filter.addEventListener('click', function (e) {
      var b = e.target.closest('.ann-chip');
      if (!b) return;
      cat = b.dataset.cat || '';
      filter.querySelectorAll('.ann-chip').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      apply();
    });
    more.addEventListener('click', function () { expanded = true; apply(); });
    apply();
  })();

  // ---------- 网址 #s=代码 = 一打开就显示那支股票 (分享出去的链接) ----------
  function openFromHash() {
    var m = /^#s=([^&]+)$/.exec(location.hash);
    if (!m || openDialogs.length) return;
    var e = entryByCode(decodeURIComponent(m[1]));
    if (e) openReportStock(e, null, { deepLinked: true });
    else { stripHash(); toast('今天的报告里没有这支股票 (成交量没达标，或者代码打错了)'); }
  }
  window.addEventListener('hashchange', openFromHash);

  // 页面一打开: 按当前模板的条件算一次 (没有条件就只显示"添加条件")，☰ 导航里的模板列表也先准备好
  refreshStrategy();
  renderDashScreeners();
  openFromHash();
})();
