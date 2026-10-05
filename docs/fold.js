// 首页分页：一次只显示一块 (机会 / 回测 / 市场 / 公告 / 股票)，不用在一整条很长的页面里上下找。
// 机会 = 今天关注 + 信号图表 + 筛选器；回测 = 策略回测 + 我的持仓；市场 = 今日市场；公告；股票 = 其余股票。
// 组件原样不动，只是按页分开放；停在哪一页记在这台设备。点 ☰ 里的链接 / 搜索结果跳到别的页面时会自动切过去。
(function () {
  if (window.__bursaFold) return;
  window.__bursaFold = true;
  var KEY = 'bursa_tab_v2';
  function $(s, r) { return (r || document).querySelector(s); }
  function txt(el) { return el ? el.textContent.replace(/\s+/g, ' ').trim() : ''; }
  var panes = {}, order = [];

  function pane(id, label, nodes, count) {
    nodes = nodes.filter(Boolean);
    if (!nodes.length) return;
    var box = document.createElement('div');
    box.className = 'tab-pane'; box.id = 'tab-' + id; box.hidden = true;
    nodes[0].parentNode.insertBefore(box, nodes[0]);
    nodes.forEach(function (n) { box.appendChild(n); });
    panes[id] = { id: id, label: label, box: box, count: count };
    order.push(id);
  }

  var focus = $('#sec-focus'), mk = $('#sec-market'), bt = $('#sec-backtest'), sig = $('#sec-signals'), cards = $('#screener');
  var scr = $('#sec-screener'), tplbar = $('#tpl-bar'), spanel = $('#strategy-panel');
  var ann = $('#sec-ann'), tbl = $('#sec-table');

  // 信号图表放在「后台信号」标题正下方
  if (sig && cards) sig.parentNode.insertBefore(cards, sig.nextSibling);
  // 公告 = 公告标题到「其余股票」标题之间的东西；股票 = 其余股票标题到页脚之间
  var annNodes = [], tNodes = [];
  if (ann && tbl) for (var n = ann.nextElementSibling; n && n !== tbl; n = n.nextElementSibling) annNodes.push(n);
  if (tbl) for (var m = tbl.nextElementSibling; m && m.tagName !== 'FOOTER' && m.tagName !== 'SCRIPT'; m = m.nextElementSibling) tNodes.push(m);

  pane('opp', '机会', [focus, sig, cards, scr, tplbar, spanel]);
  pane('bt', '回测', [bt]);
  pane('mk', '市场', [mk]);
  pane('ann', '公告', [ann].concat(annNodes));
  pane('tbl', '股票', [tbl].concat(tNodes));

  var nav = document.createElement('nav');
  nav.className = 'fold-toc'; nav.setAttribute('aria-label', '页面');
  nav.innerHTML = order.map(function (id) { return '<button type="button" data-to="' + id + '" role="tab" aria-selected="false">' + panes[id].label + '<b></b></button>'; }).join('');
  var upd = $('p.updated');
  if (upd) upd.parentNode.insertBefore(nav, upd.nextSibling);

  var current = null;
  function show(id, save) {
    if (!panes[id]) id = order[0];
    current = id;
    order.forEach(function (k) { panes[k].box.hidden = k !== id; });
    nav.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.to === id)); });
    if (save) { try { localStorage.setItem(KEY, id); } catch (e) {} }
    window.dispatchEvent(new Event('resize')); // 里面的图表 / 表格重新量一下宽度
  }
  nav.addEventListener('click', function (e) {
    var b = e.target.closest('[data-to]');
    if (!b) return;
    show(b.dataset.to, true);
    window.scrollTo({ top: 0 });
  });
  // 跳到别的页面里的东西 (☰ 菜单的链接、搜索结果、网址 #sec-…)
  function paneOf(el) { var p = el && el.closest && el.closest('.tab-pane'); return p ? p.id.replace(/^tab-/, '') : null; }
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[href^="#sec-"]');
    if (!a) return;
    var t = document.getElementById(a.getAttribute('href').slice(1)), id = paneOf(t);
    if (id && id !== current) { show(id, true); setTimeout(function () { t.scrollIntoView({ block: 'start' }); }, 30); }
  }, true);
  window.addEventListener('bursa:show-tab', function (e) { show(e.detail, true); });

  // 标签上的数字 (机会 / 股票的数量)，report.js 填完内容之后刷新
  function counts() {
    var set = function (id, v) { var b = nav.querySelector('[data-to="' + id + '"] b'); if (b) b.textContent = v ? ' ' + v : ''; };
    var tabs = document.querySelectorAll('#sec-focus .fc-tab'), news = tabs.length ? tabs[0].querySelector('b') : null;
    set('opp', news ? news.textContent : '');
    var tc = $('#sec-table .section-count'); set('tbl', tc ? txt(tc).replace(/[^\d]/g, '') : '');
  }
  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) {}
  show(saved, false);
  window.addEventListener('load', function () { counts(); setTimeout(counts, 600); });
  var focusEl = $('#sec-focus'); if (focusEl) new MutationObserver(counts).observe(focusEl, { childList: true, subtree: true });
})();
