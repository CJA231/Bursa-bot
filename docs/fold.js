// 首页收纳：组件原样不动，只把标题后面的内容包进可以折叠的一层，收起时标题下面留一行摘要；
// 信号卡片 (图表) 移到后台信号标题正下方；页面顶部加一排目录，点了跳过去并展开。开合状态记在这台设备
(function () {
  if (window.__bursaFold) return; // 只跑一次 (页面重复载入也不会把区块再包一层)
  window.__bursaFold = true;
  var KEY = 'bursa_fold_v1', state = {};
  try { state = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) {}
  function keep() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }
  function $(s, r) { return (r || document).querySelector(s); }
  function txt(el) { return el ? el.textContent.replace(/\s+/g, ' ').trim() : ''; }
  var folds = {};

  // head = 一直看得到的标题；nodes = 收进去的内容；sum() = 收起时那一行摘要 (HTML)
  function fold(id, label, head, nodes, sum, open) {
    nodes = nodes.filter(Boolean);
    if (!head || !nodes.length) return;
    var bar = document.createElement('button');
    bar.type = 'button'; bar.className = 'fold-bar'; bar.setAttribute('aria-controls', 'fold-' + id);
    var body = document.createElement('div');
    body.className = 'fold-body'; body.id = 'fold-' + id;
    head.parentNode.insertBefore(bar, nodes[0]);
    bar.parentNode.insertBefore(body, bar.nextSibling);
    nodes.forEach(function (n) { body.appendChild(n); });
    var f = folds[id] = { id: id, label: label, head: head, bar: bar, body: body, sum: sum };
    f.set = function (on, save) {
      body.hidden = !on;
      bar.setAttribute('aria-expanded', String(on));
      bar.innerHTML = '<span class="fold-sum">' + (on ? '' : sum()) + '</span><span class="fold-tg">' + (on ? '收起 ▴' : '展开 ▾') + '</span>';
      bar.classList.toggle('open', on);
      if (save) { state[id] = on; keep(); }
      if (on) window.dispatchEvent(new Event('resize')); // 里面的图表 / 表格重新量一下宽度
    };
    bar.addEventListener('click', function () { f.set(body.hidden, true); });
    f.set(id in state ? state[id] : open, false);
  }
  function num(el) { var m = /[\d,.]+/.exec(txt(el)); return m ? m[0] : ''; }
  function chip(label, value, cls) { return '<span class="fold-kv"><i>' + label + '</i><b class="' + (cls || '') + '">' + value + '</b></span>'; }
  function tileVal(label) {
    var dts = document.querySelectorAll('#sec-backtest .bt-tiles dt');
    var names = label.split('|'); // 中文 | English：切到英文后这里读到的是翻译过的字
    for (var i = 0; i < dts.length; i++) if (names.some(function (nm) { return txt(dts[i]).indexOf(nm) === 0; })) { var dd = dts[i].nextElementSibling; return dd ? [txt(dd), dd.className] : null; }
    return null;
  }

  // 1. 今日市场
  var mk = $('#sec-market');
  if (mk) fold('market', '市场', $('#sec-market-h'), [$('.mk-row', mk), $('.mk-movers', mk)], function () {
    var idx = $('.mk-idx', mk), ch = idx && $('span[class^="change"]', idx), cnt = mk.querySelectorAll('.mk-counts span');
    return chip('KLCI', txt(idx && idx.querySelector('b')) + ' <small class="' + (ch ? ch.className : '') + '">' + txt(ch).replace(/^.*\(/, '').replace(')', '') + '</small>') +
      (cnt.length === 3 ? chip('涨 / 跌', '<span class="change-up">' + num(cnt[0]) + '</span> / <span class="change-down">' + num(cnt[2]) + '</span>') : '') +
      chip('成交额', (/(RM|\$)?\s*[\d.,]+\s*[A-Za-z]*\s*$/.exec(txt($('.mk-note span', mk))) || [''])[0]);
  }, false);

  // 2. 筛选器 (自己的条件模板)
  var scrH = $('#sec-screener');
  if (scrH) fold('screener', '筛选器', scrH, [$('#tpl-bar'), $('#strategy-panel')], function () {
    var name = $('#tpl-name'), hits = $('#dash-hits');
    return chip('', (name && name.value) || '—') + (hits && /\d/.test(txt(hits)) ? chip('命中', txt(hits)) : '') + '<span class="fold-hint">编辑</span>';
  }, false);

  // 3. 信号卡片 (图表) 放到后台信号标题正下方，回测折起来
  var sig = $('#sec-signals'), cards = $('#screener'), bt = $('#sec-backtest');
  if (sig && cards) sig.parentNode.insertBefore(cards, sig.nextSibling);
  if (bt) {
    var head = $('.bt-head', bt), rest = [].slice.call(bt.children).filter(function (c) { return c !== head; });
    var box = document.createElement('div'); box.className = 'fold-bt-anchor';
    head.parentNode.insertBefore(box, head.nextSibling);
    rest.forEach(function (n) { box.appendChild(n); });
    fold('backtest', '回测', head, [box], function () {
      var w = tileVal('胜率|Win rate'), e = tileVal('期望值|Expectancy'), t = tileVal('合计盈亏|Net P/L'), d = tileVal('最大回撤|Max drawdown');
      return (w ? chip('胜率', w[0]) : '') + (e ? chip('期望值', e[0], e[1]) : '') + (t ? chip('合计', t[0], t[1]) : '') + (d ? chip('回撤', d[0], d[1]) : '');
    }, false);
  }

  // 4. 公司公告
  var ann = $('#sec-ann'), tbl = $('#sec-table');
  if (ann && tbl) {
    var annNodes = [];
    for (var n = ann.nextElementSibling; n && n !== tbl; n = n.nextElementSibling) annNodes.push(n);
    var empty = annNodes.length === 1 && /没有/.test(txt(annNodes[0]));
    fold('ann', '公告', ann, annNodes, function () {
      if (empty) return '<span class="fold-hint">这次没有抓到公告</span>';
      var items = document.querySelectorAll('#fold-ann li, #fold-ann tr, #fold-ann .ann-item');
      return chip('最近公告', items.length ? items.length + ' 条' : '有') + '<span class="fold-hint">点开看全部</span>';
    }, !empty);
  }

  // 5. 其余股票
  if (tbl) {
    var tNodes = [];
    for (var m = tbl.nextElementSibling; m && m.tagName !== 'FOOTER' && m.tagName !== 'SCRIPT'; m = m.nextElementSibling) tNodes.push(m);
    fold('table', '股票', tbl, tNodes, function () {
      var names = [].slice.call(document.querySelectorAll('#watchlist-table tbody tr[data-name]')).filter(function (r) { return !r.hidden && r.style.display !== 'none'; })
        .slice(0, 3).map(function (r) { return r.dataset.name; });
      var sel = document.getElementById('table-sort'); return chip(sel ? txt(sel.options[sel.selectedIndex]) : '排序', names.length ? names.join(' · ') : '—') + '<span class="fold-hint">筛选　排序　☆</span>';
    }, false);
  }

  // 6. 顶部目录
  var toc = document.createElement('nav');
  toc.className = 'fold-toc'; toc.setAttribute('aria-label', '跳到');
  var items = [['focus', '今天'], ['market', '市场'], ['screener', '筛选器'], ['signals', '信号'], ['backtest', '回测'], ['ann', '公告'], ['table', '股票']];
  toc.innerHTML = items.filter(function (x) { return x[0] === 'signals' || x[0] === 'focus' || folds[x[0]]; }).map(function (x) {
    return '<button type="button" data-to="' + x[0] + '">' + x[1] + '</button>';
  }).join('') + '<button type="button" class="fold-all" data-to="all">全部展开</button>';
  var upd = $('p.updated');
  if (upd) upd.parentNode.insertBefore(toc, upd.nextSibling);
  toc.addEventListener('click', function (e) {
    var b = e.target.closest('[data-to]'); if (!b) return;
    var to = b.dataset.to;
    if (to === 'all') {
      var anyClosed = Object.keys(folds).some(function (k) { return folds[k].body.hidden; });
      Object.keys(folds).forEach(function (k) { folds[k].set(anyClosed, true); });
      b.textContent = anyClosed ? '全部收起' : '全部展开';
      return;
    }
    var target = to === 'signals' ? sig : to === 'focus' ? $('#sec-focus') : folds[to].head;
    if (folds[to]) folds[to].set(true, true);
    var y = target.getBoundingClientRect().top + window.scrollY - toc.offsetHeight - 8;
    window.scrollTo({ top: y, behavior: 'smooth' });
  });
  // report.js 之后才填好的内容 (命中数、表格行) → 摘要晚一点再刷新一次
  window.addEventListener('load', function () {
    setTimeout(function () { Object.keys(folds).forEach(function (k) { if (folds[k].body.hidden) folds[k].set(false, false); }); }, 400);
  });
})();
