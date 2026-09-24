/*!
 * Bursa Bot 报告页脚本
 * 筛选器 (信号股) 的多周期K线图、主图/副图指标、图表左上角图例、指标模板、设置面板，以及"其余股票"表格的排序/搜索。
 * 依赖 vendor/lightweight-charts.js (TradingView Lightweight Charts v5)。
 * 版权所有 CJA231，保留一切权利。
 */
(function () {
  'use strict';

  var LWC = window.LightweightCharts;
  var dataEl = document.getElementById('chart-data');
  var data = dataEl ? JSON.parse(dataEl.textContent) : {};
  var charts = {}; // chartId -> 图表状态，见 renderChart()

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
  // 价格统一 3 位小数 (Bursa 最小跳动 0.005)，100 以上用 2 位
  function fmtPrice(v) {
    if (!isNum(v)) return '—';
    return Math.abs(v) >= 100 ? v.toFixed(2) : v.toFixed(3);
  }
  function fmtVolume(v) {
    if (!isNum(v)) return '—';
    if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
    return String(v);
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
  function seriesEMA(arr, n) {
    var k = 2 / (n + 1);
    var out = new Array(arr.length).fill(null);
    var prev = null;
    for (var i = 0; i < arr.length; i++) {
      var v = arr[i];
      if (v === null || v === undefined || isNaN(v)) { out[i] = null; prev = null; continue; }
      prev = prev === null ? v : v * k + prev * (1 - k);
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

  function evalFormula(formula, ctx) {
    var s = formula;
    var pos = 0;

    function skipSpace() { while (pos < s.length && /\s/.test(s[pos])) pos++; }
    function consume(ch) {
      skipSpace();
      if (s[pos] !== ch) throw new Error('语法错误，期望 "' + ch + '"，但看到 "' + (s[pos] || '(末尾)') + '"');
      pos++;
    }
    function parseNumber() {
      skipSpace();
      var start = pos;
      while (pos < s.length && /[0-9.]/.test(s[pos])) pos++;
      if (pos === start) throw new Error('无效的数字');
      return parseFloat(s.slice(start, pos));
    }
    function parseIdent() {
      skipSpace();
      var start = pos;
      while (pos < s.length && /[a-zA-Z_0-9]/.test(s[pos])) pos++;
      if (pos === start) throw new Error('无效的名称');
      return s.slice(start, pos);
    }
    function lookupSeries(name) {
      if (ctx.series.hasOwnProperty(name)) return ctx.series[name];
      throw new Error('未知变量: ' + name + ' (可用: close open high low volume)');
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
        default:
          throw new Error('未知函数: ' + name + '() (可用: sma ema stdev highest lowest sum rsi atr obv abs)');
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
          return callFunction(name, args);
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
    function parseExpr() {
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

    var result = parseExpr();
    skipSpace();
    if (pos !== s.length) throw new Error('公式末尾有多余内容: "' + s.slice(pos) + '"');
    return result;
  }

  function formulaValues(bars, formula) {
    var ctx = {
      series: {
        close: bars.map(function (b) { return b.close; }),
        open: bars.map(function (b) { return b.open; }),
        high: bars.map(function (b) { return b.high; }),
        low: bars.map(function (b) { return b.low; }),
        volume: bars.map(function (b) { return b.volume; })
      }
    };
    var result = evalFormula(formula, ctx);
    if (!isArr(result)) throw new Error('公式结果必须是一条随时间变化的序列，不能只是一个固定数字');
    return result;
  }

  // Parabolic SAR，逐行照 pandas_ta 的 psar 移植 (后台判断"SAR多头"用的就是它)，图上的点跟策略判断完全一致
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
    var sar = close[0];
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
  var SESSION_START_MIN = 9 * 60; // Bursa 早上 9:00 开市，日内K线从开市时间开始对齐分组 (跟 TradingView 一样)
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
      // 日内时间戳已经是"马来西亚时间当成 UTC"，所以 t % DAY 就是当地的钟点
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
  var ICHIMOKU = { conversion: 9, base: 26, spanB: 52, displacement: 26 };
  var ICHIMOKU_LINES = [
    { key: 'conversion', name: '转换线', color: '#2962FF' },
    { key: 'base', name: '基准线', color: '#B71C1C' },
    { key: 'lagging', name: '延迟线', color: '#43A047' },
    { key: 'leadA', name: '先行带A', color: '#A5D6A7' },
    { key: 'leadB', name: '先行带B', color: '#EF9A9A' }
  ];
  var CLOUD_UP = 'rgba(67, 160, 71, 0.22)';   // 先行带 A 在 B 上方
  var CLOUD_DOWN = 'rgba(244, 67, 54, 0.22)'; // 先行带 A 在 B 下方

  function ichimokuSeries(bars, tf) {
    var high = bars.map(function (b) { return b.high; });
    var low = bars.map(function (b) { return b.low; });
    function donchian(n) {
      var hh = seriesExtreme(high, n, Math.max), ll = seriesExtreme(low, n, Math.min);
      return hh.map(function (h, i) { return h === null || ll[i] === null ? null : (h + ll[i]) / 2; });
    }
    var conversion = donchian(ICHIMOKU.conversion);
    var base = donchian(ICHIMOKU.base);
    var leadA = conversion.map(function (c, i) { return c === null || base[i] === null ? null : (c + base[i]) / 2; });
    var leadB = donchian(ICHIMOKU.spanB);
    var shift = ICHIMOKU.displacement - 1; // Pine: offset = displacement - 1
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
  var SUPERTREND = { atrPeriod: 10, factor: 3 };
  var ST_UP = '#4CAF50';     // Pine color.green
  var ST_DOWN = '#FF5252';   // Pine color.red
  var ST_UP_FILL = 'rgba(76, 175, 80, 0.1)';    // color.new(color.green, 90)
  var ST_DOWN_FILL = 'rgba(255, 82, 82, 0.1)';  // color.new(color.red, 90)

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

  // ---------- 预设指标库 ----------
  // scale: price = 跟价格同单位；own = 震荡类 (自己的数值范围)；volume = 跟成交量同单位
  // paneGroup 相同的指标放进同一个副图 (例如 MACD 线和信号线)
  var INDICATOR_PRESETS = [
    { id: 'sma20', category: 'trend', name: 'SMA20', formula: 'sma(close,20)', color: '#3d8ce8', scale: 'price' },
    { id: 'sma50', category: 'trend', name: 'SMA50', formula: 'sma(close,50)', color: '#1f5fa8', scale: 'price' },
    { id: 'ema50', category: 'trend', name: 'EMA50', formula: 'ema(close,50)', color: '#8a5ce8', scale: 'price' },
    { id: 'sar', category: 'trend', name: 'SAR', builtin: 'psar', color: '#e8a33d', scale: 'price' },
    { id: 'boll_upper', category: 'trend', name: '布林带上轨(20,2)', formula: 'sma(close,20)+2*stdev(close,20)', color: '#e86e6e', scale: 'price' },
    { id: 'boll_mid', category: 'trend', name: '布林带中轨(20)', formula: 'sma(close,20)', color: '#c3c2b7', scale: 'price' },
    { id: 'boll_lower', category: 'trend', name: '布林带下轨(20,2)', formula: 'sma(close,20)-2*stdev(close,20)', color: '#6ee89b', scale: 'price' },
    { id: 'ichimoku', category: 'trend', name: '一目均衡表(9,26,52)', builtin: 'ichimoku', color: '#2962FF', scale: 'price' },
    { id: 'supertrend', category: 'trend', name: 'Supertrend(10,3)', builtin: 'supertrend', color: '#4CAF50', scale: 'price' },

    { id: 'rsi14', category: 'momentum', name: 'RSI(14)', formula: 'rsi(close,14)', color: '#e8a33d', scale: 'own' },
    { id: 'macd_line', category: 'momentum', name: 'MACD线(12,26)', formula: 'ema(close,12)-ema(close,26)', color: '#3d8ce8', scale: 'own', paneGroup: 'macd' },
    { id: 'macd_signal', category: 'momentum', name: 'MACD信号线(9)', formula: 'ema(ema(close,12)-ema(close,26),9)', color: '#e86e6e', scale: 'own', paneGroup: 'macd' },
    { id: 'stoch_k', category: 'momentum', name: 'Stochastic %K(14)', formula: '(close-lowest(low,14))/(highest(high,14)-lowest(low,14))*100', color: '#8a5ce8', scale: 'own' },
    { id: 'cci20', category: 'momentum', name: 'CCI(20)', formula: '((high+low+close)/3-sma((high+low+close)/3,20))/(0.015*stdev((high+low+close)/3,20))', color: '#3dbf8e', scale: 'own' },
    { id: 'wr14', category: 'momentum', name: 'Williams %R(14)', formula: '(highest(high,14)-close)/(highest(high,14)-lowest(low,14))*-100', color: '#e86ec2', scale: 'own' },

    { id: 'atr14', category: 'volatility', name: 'ATR(14)', formula: 'atr(14)', color: '#e8a33d', scale: 'own' },
    { id: 'boll_width', category: 'volatility', name: '布林带带宽(20,2)', formula: '(sma(close,20)+2*stdev(close,20)-(sma(close,20)-2*stdev(close,20)))/sma(close,20)', color: '#3d8ce8', scale: 'own' },

    { id: 'obv', category: 'volume', name: 'OBV', formula: 'obv()', color: '#8a5ce8', scale: 'own' },
    { id: 'vol_sma20', category: 'volume', name: '成交量均线(20)', formula: 'sma(volume,20)', color: '#e8a33d', scale: 'volume' },
    { id: 'vwap20', category: 'volume', name: '滚动VWAP(20)', formula: 'sum((high+low+close)/3*volume,20)/sum(volume,20)', color: '#3dbf8e', scale: 'price' }
  ];
  function autoPane(scale) { return scale === 'own' ? 'sub' : 'main'; }

  // 兼容以前存下来的指标 (旧版本字段: dataKey / composite / scaleGroup，没有 pane)
  function normalizeIndicator(ind) {
    if (!ind.scale) ind.scale = 'price';
    if (ind.dataKey === 'psar') { ind.builtin = 'psar'; delete ind.dataKey; }
    if (ind.composite === 'ichimoku') { ind.builtin = 'ichimoku'; delete ind.composite; }
    if (ind.scaleGroup && !ind.paneGroup) ind.paneGroup = ind.scaleGroup;
    delete ind.scaleGroup;
    if (ind.pane !== 'main' && ind.pane !== 'sub') ind.pane = autoPane(ind.scale);
    return ind;
  }

  // ---------- 指标模板 (筛选器名称 + 一组指标)，每次改动立刻存进浏览器 ----------
  var TPL_STORAGE_KEY = 'bursa_templates_v1';
  var LEGACY_IND_KEY = 'bursa_custom_indicators_v1';
  var DEFAULT_TPL_NAME = '我的筛选器';

  var templates = loadJSON(TPL_STORAGE_KEY, null);
  if (!templates || !Array.isArray(templates.list) || !templates.list.length) {
    // 第一次用新版: 把旧版存的指标搬进第一个模板
    var legacy = loadJSON(LEGACY_IND_KEY, []);
    templates = { active: 'tpl-1', list: [{ id: 'tpl-1', name: DEFAULT_TPL_NAME, indicators: Array.isArray(legacy) ? legacy : [] }] };
  }
  templates.list.forEach(function (t) {
    t.indicators = (Array.isArray(t.indicators) ? t.indicators : []).filter(function (i) { return i && i.id; }).map(normalizeIndicator);
  });

  function activeTemplate() {
    for (var i = 0; i < templates.list.length; i++) if (templates.list[i].id === templates.active) return templates.list[i];
    templates.active = templates.list[0].id;
    return templates.list[0];
  }
  function indicators() { return activeTemplate().indicators; }

  var statusTimer = null;
  function persist() {
    var ok = saveJSON(TPL_STORAGE_KEY, templates);
    var el = document.getElementById('tpl-status');
    if (!el) return;
    el.textContent = ok ? '✓ 已自动保存' : '浏览器不允许保存 (可能是隐私模式)';
    el.classList.add('show');
    clearTimeout(statusTimer);
    statusTimer = setTimeout(function () { el.classList.remove('show'); }, ok ? 1500 : 4000);
  }
  // 指标或模板有任何变动: 保存 + 重画所有图 + 刷新设置面板
  function indicatorsChanged() {
    persist();
    Object.keys(charts).forEach(function (id) { rebuildIndicators(charts[id]); });
    renderIndicatorList();
    renderPresetGrid();
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
  function togglePane(id) {
    indicators().forEach(function (ind) { if (ind.id === id) ind.pane = ind.pane === 'main' ? 'sub' : 'main'; });
    indicatorsChanged();
  }

  // ---------- K 线图 ----------
  var MAIN_PANE_HEIGHT = 300;
  var SUB_PANE_HEIGHT = 120;

  function volumeData(bars) {
    return bars.map(function (b) {
      return { time: b.time, value: b.volume, color: b.close >= b.open ? colors.up : colors.down };
    });
  }
  function toPoints(bars, values) {
    var out = [];
    values.forEach(function (v, i) { if (isNum(v)) out.push({ time: bars[i].time, value: v }); });
    return out;
  }
  function lastValue(points) { return points.length ? points[points.length - 1].value : null; }

  function applyBaseColors(st) {
    st.candle.applyOptions({
      upColor: 'rgba(0, 0, 0, 0)', // 空心阳线: 上涨只描边
      downColor: colors.down,
      borderUpColor: colors.up,
      borderDownColor: colors.down,
      wickUpColor: colors.up,
      wickDownColor: colors.down
    });
    st.ema.applyOptions({ color: colors.ema });
    st.chart.applyOptions({
      layout: { textColor: colors.text, panes: { separatorColor: colors.grid, separatorHoverColor: colors.grid } },
      grid: { vertLines: { color: colors.grid }, horzLines: { color: colors.grid } },
      rightPriceScale: { borderColor: colors.grid },
      timeScale: { borderColor: colors.grid }
    });
  }
  function setBaseData(st) {
    st.candle.setData(st.bars);
    st.volume.setData(volumeData(st.bars));
    var emaPoints = toPoints(st.bars, seriesEMA(st.bars.map(function (b) { return b.close; }), 20));
    st.ema.setData(emaPoints);
    st.emaLast = lastValue(emaPoints);
  }

  function lineOptions(ind, paneIndex) {
    var opts = {
      color: ind.color,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: paneIndex > 0, // 副图右边显示最新值；主图上指标一多标签会挤成一团，就不显示
      crosshairMarkerVisible: false
    };
    if (paneIndex === 0) {
      if (ind.scale === 'volume') opts.priceScaleId = '';
      else if (ind.scale === 'own') opts.priceScaleId = 'ind-' + (ind.paneGroup || ind.id);
    }
    return opts;
  }
  // 返回 [{series, color, last}]，一目均衡表这类组合指标会有好几条
  function addIndicatorSeries(st, ind, paneIndex) {
    var chart = st.chart, bars = st.bars;
    if (ind.builtin === 'ichimoku') {
      var ich = ichimokuSeries(bars, st.tf);
      var parts = ICHIMOKU_LINES.map(function (line) {
        var opts = lineOptions({ color: line.color, scale: 'price' }, paneIndex);
        opts.lineWidth = 1;
        opts.lastValueVisible = false;
        var series = chart.addSeries(LWC.LineSeries, opts, paneIndex);
        series.setData(ich[line.key]);
        return { series: series, color: line.color, last: lastValue(ich[line.key]) };
      });
      parts[3].series.attachPrimitive(new CloudPrimitive(ich.leadA, ich.leadB));
      return parts;
    }
    if (ind.builtin === 'supertrend') {
      var stv = seriesSupertrend(bars, SUPERTREND.factor, SUPERTREND.atrPeriod);
      // 多头、空头各一条"隐形"的线：不画出来 (线由 SupertrendPrimitive 画)，
      // 只用来让价格坐标轴把它算进范围，以及给图例取十字光标位置的数值
      var sides = [{ dir: -1, color: ST_UP }, { dir: 1, color: ST_DOWN }].map(function (side) {
        var opts = lineOptions({ color: side.color, scale: 'price' }, paneIndex);
        opts.lastValueVisible = false;
        opts.lineVisible = false;
        var series = chart.addSeries(LWC.LineSeries, opts, paneIndex);
        var data = bars.map(function (b, i) {
          return stv.direction[i] === side.dir ? { time: b.time, value: stv.value[i] } : { time: b.time };
        });
        series.setData(data);
        var last = bars.length && stv.direction[bars.length - 1] === side.dir ? stv.value[bars.length - 1] : null;
        // optional: 这条线在当前K线没有值时，图例里就不显示它 (两条线同一时间只会有一条有值)
        return { series: series, color: side.color, last: last, optional: true };
      });
      var drawn = [];
      bars.forEach(function (b, i) {
        if (stv.direction[i] === null) return;
        var up = stv.direction[i] === -1;
        drawn.push({ time: b.time, mid: (b.open + b.close) / 2, value: stv.value[i], line: up ? ST_UP : ST_DOWN, fill: up ? ST_UP_FILL : ST_DOWN_FILL });
      });
      sides[0].series.attachPrimitive(new SupertrendPrimitive(drawn));
      return sides;
    }
    var opts = lineOptions(ind, paneIndex);
    var points;
    if (ind.builtin === 'psar') {
      opts.lineVisible = false;       // SAR 画成一颗颗的点，跟 TradingView 一样
      opts.pointMarkersVisible = true;
      opts.pointMarkersRadius = 1.5;
      points = toPoints(bars, seriesPSAR(
        bars.map(function (b) { return b.high; }), bars.map(function (b) { return b.low; }), bars.map(function (b) { return b.close; })));
    } else {
      points = toPoints(bars, formulaValues(bars, ind.formula));
    }
    var s = chart.addSeries(LWC.LineSeries, opts, paneIndex);
    s.setData(points);
    if (paneIndex === 0 && ind.scale === 'own') s.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: 0.25 } });
    return [{ series: s, color: ind.color, last: lastValue(points) }];
  }

  function rebuildIndicators(st) {
    var chart = st.chart;
    st.entries.forEach(function (entry) {
      entry.parts.forEach(function (p) { chart.removeSeries(p.series); });
    });
    st.entries = [];
    while (chart.panes().length > 1) chart.removePane(chart.panes().length - 1);

    var paneOfGroup = {};
    indicators().forEach(function (ind) {
      var key = ind.paneGroup || ind.id;
      var paneIndex = ind.pane === 'sub' ? (key in paneOfGroup ? paneOfGroup[key] : chart.panes().length) : 0;
      var entry = { ind: ind, parts: [], pane: paneIndex, error: null };
      try {
        entry.parts = addIndicatorSeries(st, ind, paneIndex);
        if (ind.pane === 'sub') paneOfGroup[key] = paneIndex;
      } catch (e) {
        entry.error = e.message;
        entry.pane = ind.pane === 'sub' ? -1 : 0; // 算不出来的副图指标不开窗格，图例放主图里提示
      }
      st.entries.push(entry);
    });

    // 主图 + 每个副图的高度，整张图跟着变高
    var panes = chart.panes();
    var height = MAIN_PANE_HEIGHT + SUB_PANE_HEIGHT * (panes.length - 1);
    panes.forEach(function (pane, i) { pane.setStretchFactor(i === 0 ? MAIN_PANE_HEIGHT : SUB_PANE_HEIGHT); });
    st.el.style.height = height + 'px';
    chart.resize(st.el.clientWidth, height);
    requestAnimationFrame(function () { renderLegends(st); });
  }

  function showRecentBars(st) {
    var n = st.bars.length;
    var extra = 0; // 一目均衡表往未来多画了 25 根，也要露出来
    st.entries.forEach(function (e) { if (e.ind.builtin === 'ichimoku' && !e.error) extra = ICHIMOKU.displacement - 1; });
    st.chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - VISIBLE_BARS), to: n + extra + 2 });
  }

  function setTimeframe(st, tf) {
    var bars = barsFor(st.id, tf);
    if (!bars || !bars.length) return;
    st.tf = tf;
    st.bars = bars;
    st.index = {};
    bars.forEach(function (b, i) { st.index[b.time] = i; });
    st.chart.applyOptions({ timeScale: { timeVisible: isIntraday(tf), secondsVisible: false } });
    setBaseData(st);
    rebuildIndicators(st);
    showRecentBars(st);
    updateQuoteLive(st, null);
    var tfBar = document.getElementById(st.id + '-tf');
    if (tfBar) {
      tfBar.querySelectorAll('.tf-btn').forEach(function (b) {
        var on = b.dataset.tf === tf.id;
        b.setAttribute('aria-selected', on ? 'true' : 'false');
        b.tabIndex = on ? 0 : -1;
        if (on) {
          var list = b.parentNode; // 只横向滚导航条，不用 scrollIntoView (会连整页一起滚)
          list.scrollLeft = b.offsetLeft - list.offsetLeft - (list.clientWidth - b.offsetWidth) / 2;
        }
      });
    }
  }

  // ---------- 图表左上角图例: 每个窗格一块，名称 + 当前值 + ↑ ↓ × ----------
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
          '<span class="lg-name">EMA20</span><span class="lg-val"></span></div>';
      }
      (byPane[p] || []).forEach(function (e) {
        var idx = list.indexOf(e.ind);
        var canUp = neighborIndex(list, idx, -1) !== -1, canDown = neighborIndex(list, idx, 1) !== -1;
        rows += '<div class="lg-row' + (e.error ? ' lg-error' : '') + '" data-ind="' + escapeHtml(e.ind.id) + '"' +
          (e.error ? ' title="' + escapeHtml(e.error) + '"' : '') + '>' +
          '<span class="lg-swatch" style="background:' + escapeHtml(e.ind.color) + '"></span>' +
          '<span class="lg-name">' + escapeHtml(e.ind.name) + (e.error ? ' ⚠' : '') + '</span>' +
          '<span class="lg-val"></span>' +
          '<span class="lg-ctrl">' +
          '<button type="button" data-act="up" title="上移" aria-label="上移 ' + escapeHtml(e.ind.name) + '"' + (canUp ? '' : ' disabled') + '>↑</button>' +
          '<button type="button" data-act="down" title="下移" aria-label="下移 ' + escapeHtml(e.ind.name) + '"' + (canDown ? '' : ' disabled') + '>↓</button>' +
          '<button type="button" data-act="del" title="删除" aria-label="删除 ' + escapeHtml(e.ind.name) + '">×</button>' +
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
    var html = '<span class="ql-time">' + fmtTime(b.time, st.tf) + '</span>' +
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
    var hovering = param && param.time !== undefined && param.seriesData && param.seriesData.get(st.candle);
    updateQuoteLive(st, hovering ? st.bars[st.index[param.time]] : null);
    updateLegendValues(st, hovering ? param.seriesData : null);
  }

  // ---------- 周期导航条 ----------
  function buildTimeframeBar(st) {
    var bar = document.getElementById(st.id + '-tf');
    if (!bar) return;
    bar.innerHTML =
      '<button type="button" class="tf-arrow" data-dir="-1" aria-label="向左滚动">‹</button>' +
      '<div class="tf-list" role="tablist" aria-label="K线周期"></div>' +
      '<button type="button" class="tf-arrow" data-dir="1" aria-label="向右滚动">›</button>' +
      '<button type="button" class="tf-ind" title="添加指标">ƒx 指标</button>';
    var list = bar.querySelector('.tf-list');
    TIMEFRAMES.forEach(function (tf) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'tf-btn';
      b.dataset.tf = tf.id;
      b.textContent = tf.label;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', 'false');
      if (!hasTf(st.id, tf)) {
        b.disabled = true;
        b.title = '这次没拿到' + tf.label + '的数据';
      }
      b.addEventListener('click', function () {
        setTimeframe(st, tf);
        saveJSON(TF_STORAGE_KEY, tf.id);
      });
      list.appendChild(b);
    });
    var arrows = bar.querySelectorAll('.tf-arrow');
    function updateArrows() {
      arrows[0].disabled = list.scrollLeft <= 1;
      arrows[1].disabled = list.scrollLeft + list.clientWidth >= list.scrollWidth - 1;
    }
    arrows.forEach(function (a) {
      a.addEventListener('click', function () { list.scrollBy({ left: +a.dataset.dir * list.clientWidth * 0.7 }); });
    });
    list.addEventListener('scroll', updateArrows, { passive: true });
    new ResizeObserver(updateArrows).observe(list);
    // 键盘 ← → 在周期之间切换
    list.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      var btns = Array.prototype.filter.call(list.querySelectorAll('.tf-btn'), function (b) { return !b.disabled; });
      var cur = btns.indexOf(document.activeElement);
      var next = btns[cur + (e.key === 'ArrowRight' ? 1 : -1)];
      if (next) { e.preventDefault(); next.click(); next.focus(); }
    });
    bar.querySelector('.tf-ind').addEventListener('click', openSettingsPanel);
  }
  function initialTimeframe(chartId) {
    var saved = tfById(loadJSON(TF_STORAGE_KEY, 'D'));
    if (saved && hasTf(chartId, saved)) return saved;
    var daily = tfById('D');
    if (hasTf(chartId, daily)) return daily;
    for (var i = 0; i < TIMEFRAMES.length; i++) if (hasTf(chartId, TIMEFRAMES[i])) return TIMEFRAMES[i];
    return null;
  }

  function renderChart(chartId) {
    var el = document.getElementById(chartId);
    if (!el || !LWC || charts[chartId]) return;
    var tf = initialTimeframe(chartId);
    if (!tf) return;

    var chart = LWC.createChart(el, {
      width: el.clientWidth,
      height: MAIN_PANE_HEIGHT,
      layout: { background: { color: 'transparent' }, textColor: colors.text, attributionLogo: false }, // 署名放在页脚
      crosshair: { mode: LWC.CrosshairMode.Normal },
      timeScale: { rightOffset: 2 },
      localization: { locale: 'zh-CN', dateFormat: 'yyyy-MM-dd' }
    });
    var candle = chart.addSeries(LWC.CandlestickSeries, { borderVisible: true });
    var volume = chart.addSeries(LWC.HistogramSeries, {
      priceScaleId: '', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false
    });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    var ema = chart.addSeries(LWC.LineSeries, {
      lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false
    });

    var st = {
      id: chartId, el: el, chart: chart, candle: candle, volume: volume, ema: ema,
      legendsEl: document.getElementById(chartId + '-legends'),
      tf: null, bars: [], index: {}, entries: [], emaLast: null
    };
    charts[chartId] = st;
    applyBaseColors(st);
    buildTimeframeBar(st);
    setTimeframe(st, tf);

    chart.subscribeCrosshairMove(function (param) { onCrosshair(st, param); });
    if (st.legendsEl) {
      st.legendsEl.addEventListener('click', function (e) {
        var btn = e.target.closest('button[data-act]');
        var row = btn && btn.closest('[data-ind]');
        if (!row) return;
        var id = row.getAttribute('data-ind');
        if (btn.dataset.act === 'del') removeIndicator(id);
        else moveIndicator(id, btn.dataset.act === 'up' ? -1 : 1);
      });
    }
    // 拖动副图之间的分隔线会改变窗格高度，放开后重新对齐图例
    el.addEventListener('pointerup', function () { requestAnimationFrame(function () { renderLegends(st); }); });
    new ResizeObserver(function (entries) {
      chart.resize(entries[0].contentRect.width, el.clientHeight);
      requestAnimationFrame(function () { renderLegends(st); });
    }).observe(el);
  }

  function updateAllChartColors() {
    Object.keys(charts).forEach(function (id) {
      var st = charts[id];
      applyBaseColors(st);
      st.volume.setData(volumeData(st.bars));
      renderLegends(st);
    });
  }

  // 懒加载: 图表快滚进可视范围才真正渲染
  var lazyObserver = 'IntersectionObserver' in window ? new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        renderChart(entry.target.id);
        lazyObserver.unobserve(entry.target);
      }
    });
  }, { rootMargin: '200px 0px' }) : null;
  Object.keys(data).forEach(function (chartId) {
    var el = document.getElementById(chartId);
    if (!el) return;
    if (lazyObserver) lazyObserver.observe(el);
    else renderChart(chartId);
  });

  // ---------- 筛选器模板条 (标题下方那一行小字) ----------
  function renderTemplateBar() {
    var nameEl = document.getElementById('tpl-name');
    var select = document.getElementById('tpl-select');
    var delBtn = document.getElementById('tpl-del');
    if (!nameEl || !select) return;
    var tpl = activeTemplate();
    if (document.activeElement !== nameEl) nameEl.value = tpl.name;
    select.innerHTML = templates.list.map(function (t) {
      return '<option value="' + escapeHtml(t.id) + '"' + (t.id === tpl.id ? ' selected' : '') + '>' +
        escapeHtml(t.name || '未命名') + ' (' + t.indicators.length + ' 个指标)</option>';
    }).join('');
    if (delBtn) delBtn.disabled = false;
  }
  (function initTemplateBar() {
    var nameEl = document.getElementById('tpl-name');
    var select = document.getElementById('tpl-select');
    var newBtn = document.getElementById('tpl-new');
    var delBtn = document.getElementById('tpl-del');
    if (!nameEl || !select) return;
    nameEl.addEventListener('input', function () {
      activeTemplate().name = nameEl.value.trim() || DEFAULT_TPL_NAME;
      persist();
      renderTemplateBar();
    });
    nameEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') nameEl.blur(); });
    nameEl.addEventListener('blur', function () { nameEl.value = activeTemplate().name; });
    select.addEventListener('change', function () {
      templates.active = select.value;
      indicatorsChanged();
      renderTemplateBar();
    });
    newBtn.addEventListener('click', function () {
      var t = { id: newId('tpl'), name: '筛选器 ' + (templates.list.length + 1), indicators: [] };
      templates.list.push(t);
      templates.active = t.id;
      indicatorsChanged();
      renderTemplateBar();
      nameEl.focus();
      nameEl.select();
    });
    delBtn.addEventListener('click', function () {
      var tpl = activeTemplate();
      if (!window.confirm('删除模板「' + tpl.name + '」和里面的 ' + tpl.indicators.length + ' 个指标？')) return;
      templates.list = templates.list.filter(function (t) { return t.id !== tpl.id; });
      if (!templates.list.length) templates.list.push({ id: newId('tpl'), name: DEFAULT_TPL_NAME, indicators: [] });
      templates.active = templates.list[0].id;
      indicatorsChanged();
      renderTemplateBar();
    });
    renderTemplateBar();
  })();

  // ---------- 设置面板 ----------
  var panel = document.getElementById('settings-panel');
  var toggleBtn = document.getElementById('settings-toggle');
  function setPanelOpen(open) {
    if (!panel || !toggleBtn) return;
    panel.hidden = !open;
    toggleBtn.setAttribute('aria-expanded', String(open));
  }
  function openSettingsPanel() {
    setPanelOpen(true);
    if (toggleBtn) toggleBtn.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  if (toggleBtn) toggleBtn.addEventListener('click', function () { setPanelOpen(panel.hidden); });

  COLOR_KEYS.forEach(function (key) {
    var input = document.getElementById('color-' + key);
    if (!input) return;
    input.value = colors[key];
    input.addEventListener('input', function () {
      document.documentElement.style.setProperty('--' + key, input.value);
      colors = computeColors();
      updateAllChartColors();
      saveColors();
    });
  });
  var resetBtn = document.getElementById('color-reset');
  if (resetBtn) {
    resetBtn.addEventListener('click', function () {
      COLOR_KEYS.forEach(function (k) { document.documentElement.style.removeProperty('--' + k); });
      try { localStorage.removeItem(COLOR_STORAGE_KEY); } catch (e) {}
      colors = computeColors();
      COLOR_KEYS.forEach(function (k) {
        var input = document.getElementById('color-' + k);
        if (input) input.value = colors[k];
      });
      updateAllChartColors();
    });
  }

  // 新指标放在哪: 自动 / 主图 / 新副图
  var placement = 'auto';
  var placeBtns = document.querySelectorAll('.ind-place [data-place]');
  placeBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      placement = btn.dataset.place;
      placeBtns.forEach(function (b) { b.setAttribute('aria-checked', b === btn ? 'true' : 'false'); });
    });
  });
  function paneFor(scale) { return placement === 'auto' ? autoPane(scale) : placement; }

  function renderIndicatorList() {
    var ul = document.getElementById('ind-list');
    if (!ul) return;
    var list = indicators();
    ul.innerHTML = '';
    if (!list.length) {
      ul.innerHTML = '<li class="ind-empty">这个模板还没有指标，从上面点一个加进来</li>';
    }
    list.forEach(function (ind, idx) {
      var detail = ind.formula || (ind.builtin === 'ichimoku' ? '转换线 / 基准线 / 延迟线 / 先行带A·B + 云'
        : ind.builtin === 'supertrend' ? 'ATR 10，倍数 3；绿 = 多头，红 = 空头' : '内置指标');
      var li = document.createElement('li');
      li.innerHTML = '<span class="ind-swatch" style="background:' + escapeHtml(ind.color) + '"></span>' +
        '<span class="ind-name">' + escapeHtml(ind.name) + '</span>' +
        '<code class="ind-formula">' + escapeHtml(detail) + '</code>' +
        '<button type="button" class="ind-pane-toggle" title="切换放在主图还是副图">' + (ind.pane === 'main' ? '主图' : '副图') + '</button>' +
        '<button type="button" class="ind-move" data-dir="-1" aria-label="上移"' + (neighborIndex(list, idx, -1) === -1 ? ' disabled' : '') + '>↑</button>' +
        '<button type="button" class="ind-move" data-dir="1" aria-label="下移"' + (neighborIndex(list, idx, 1) === -1 ? ' disabled' : '') + '>↓</button>' +
        '<button type="button" class="ind-remove" aria-label="删除">×</button>';
      li.querySelector('.ind-remove').addEventListener('click', function () { removeIndicator(ind.id); });
      li.querySelector('.ind-pane-toggle').addEventListener('click', function () { togglePane(ind.id); });
      li.querySelectorAll('.ind-move').forEach(function (b) {
        b.addEventListener('click', function () { moveIndicator(ind.id, +b.dataset.dir); });
      });
      ul.appendChild(li);
    });
    renderTemplateBar();
  }

  var activeCategory = 'trend';
  function addPresetIndicator(preset) {
    var ind = {
      id: newId('ind'),
      presetId: preset.id,
      name: preset.name,
      color: preset.color,
      scale: preset.scale,
      pane: paneFor(preset.scale)
    };
    if (preset.paneGroup) ind.paneGroup = preset.paneGroup;
    if (preset.builtin) ind.builtin = preset.builtin;
    else ind.formula = preset.formula;
    indicators().push(ind);
    indicatorsChanged();
  }
  function renderPresetGrid() {
    var wrap = document.getElementById('ind-presets');
    var customForm = document.getElementById('ind-custom-form');
    var hint = document.getElementById('ind-formula-hint');
    if (!wrap || !customForm || !hint) return;
    var custom = activeCategory === 'custom';
    wrap.hidden = custom;
    customForm.hidden = !custom;
    hint.hidden = !custom;
    if (custom) return;
    wrap.innerHTML = '';
    var added = indicators().map(function (i) { return i.presetId; }).filter(Boolean);
    INDICATOR_PRESETS.filter(function (p) { return p.category === activeCategory; }).forEach(function (preset) {
      var isAdded = added.indexOf(preset.id) !== -1;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ind-preset-btn' + (isAdded ? ' added' : '');
      btn.innerHTML = '<span class="ind-swatch" style="background:' + preset.color + '"></span>' + escapeHtml(preset.name) + (isAdded ? ' ✓' : '');
      if (isAdded) btn.disabled = true;
      else btn.addEventListener('click', function () { addPresetIndicator(preset); });
      wrap.appendChild(btn);
    });
  }
  var indTabs = document.querySelectorAll('.ind-tab');
  indTabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      activeCategory = tab.dataset.cat;
      indTabs.forEach(function (t) { t.classList.toggle('active', t === tab); });
      renderPresetGrid();
    });
  });

  var addBtn = document.getElementById('ind-add');
  if (addBtn) {
    addBtn.addEventListener('click', function () {
      var nameEl = document.getElementById('ind-name');
      var formulaEl = document.getElementById('ind-formula');
      var colorEl = document.getElementById('ind-color');
      var errEl = document.getElementById('ind-error');
      errEl.hidden = true;
      function fail(msg) { errEl.textContent = msg; errEl.hidden = false; }
      var name = nameEl.value.trim(), formula = formulaEl.value.trim();
      if (!name || !formula) return fail('请填写名称和公式');
      if (formula.length > 300) return fail('公式太长了');
      // 先拿一段假数据试算一次，公式有错当场提示，不会存进模板
      try {
        formulaValues([1, 2, 3, 4, 5].map(function (v, i) { return { time: i, open: v, high: v + 1, low: v - 1, close: v, volume: 100 }; }), formula);
      } catch (e) { return fail('公式错误: ' + e.message); }
      // 自定义公式按"自动"时放主图、跟价格同轴 (大多数人写的是均线类)
      indicators().push({ id: newId('ind'), name: name, formula: formula, color: colorEl.value, scale: 'price', pane: paneFor('price') });
      indicatorsChanged();
      nameEl.value = '';
      formulaEl.value = '';
    });
  }

  renderIndicatorList();
  renderPresetGrid();

  // ---------- "其余股票"表格: 点表头排序 + 搜索 ----------
  var table = document.getElementById('watchlist-table');
  if (table) {
    var tbody = table.querySelector('tbody');
    var ths = Array.prototype.slice.call(table.querySelectorAll('th'));
    ths.forEach(function (th, idx) {
      if (th.dataset.type === 'none') return; // 序号、走势图这两列不排序
      var asc = true;
      th.addEventListener('click', function () {
        var rows = Array.prototype.slice.call(tbody.querySelectorAll('tr'));
        var type = th.dataset.type;
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
        });
        var currentArrow = th.querySelector('.arrow');
        if (currentArrow) currentArrow.textContent = asc ? '▲' : '▼';
        asc = !asc;
      });
    });

    var filterInput = document.getElementById('table-filter');
    var countEl = document.getElementById('table-count');
    var allRows = Array.prototype.slice.call(tbody.querySelectorAll('tr'));
    var updateCount = function (shown) {
      if (countEl) countEl.textContent = shown === allRows.length ? allRows.length + ' 支' : shown + ' / ' + allRows.length + ' 支';
    };
    updateCount(allRows.length);
    if (filterInput) {
      filterInput.addEventListener('input', function () {
        var q = filterInput.value.trim().toLowerCase();
        var shown = 0;
        allRows.forEach(function (row) {
          var hit = !q || (row.dataset.search || '').indexOf(q) !== -1;
          row.hidden = !hit;
          if (hit) shown++;
        });
        updateCount(shown);
      });
    }
  }
})();
