// 终端版离线 (PWA)：只管 /terminal/ 里面的文件，标准报告、个股资料 (../stock、../ann、../intel)、AI 问答一律不碰。
// - 页面、data.json、bars.json、ipo.json (新股)：先上网拿最新的 (成功就存一份)；连不上或 8 秒没回应才用存着的那份，回应头加 x-bterm-offline 让页面显示「离线」
// - terminal.css / terminal.js 这些带 ?v= 版本号的：版本号没变就直接用存着的
// - 字体：存一次一直用 (文件名不变，另外一个缓存，不会每次更新都重下载)
// 每次生成报告 54241951 都会变，浏览器就会装新版本的 sw.js，并删掉旧版本的页面缓存。
var V = '54241951';
var SHELL = 'bterm-shell-' + V, DATA = 'bterm-data', FONT = 'bterm-font-1';
var SCOPE = new URL(self.registration.scope);
var PRE = ['./', 'terminal.css?v=' + V, 'terminal_en.js?v=' + V, 'terminal.js?v=' + V, 'legal.html', 'manifest.webmanifest'];
var DATA_FILES = ['data.json', 'bars.json', 'ipo.json', 'overrides.json'];
var FONTS = ['fonts/JetBrainsMono-Regular.woff2', 'fonts/JetBrainsMono-Medium.woff2', 'fonts/JetBrainsMono-Bold.woff2'];
var WAIT_MS = 8000;

function abs(u) { return new URL(u, SCOPE).href; }
function noSearch(u) { var x = new URL(u); x.search = ''; x.hash = ''; return x.href; }

self.addEventListener('install', function (e) {
  e.waitUntil(Promise.all([
    caches.open(SHELL).then(function (c) { return c.addAll(PRE.map(function (u) { return new Request(abs(u), { cache: 'reload' }); })); }),
    // 最新的数据也先存一份：没打开过图表的人离线时也有日线
    caches.open(DATA).then(function (c) {
      return Promise.all(DATA_FILES.map(function (u) {
        return fetch(abs(u), { cache: 'reload' }).then(function (r) { if (r.ok) return c.put(abs(u), r); }).catch(function () {});
      }));
    }),
    caches.open(FONT).then(function (c) {
      return Promise.all(FONTS.map(function (u) {
        return c.match(abs(u)).then(function (hit) { if (!hit) return c.add(abs(u)).catch(function () {}); });
      }));
    })
  ]).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k.indexOf('bterm-shell-') === 0 && k !== SHELL; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

// 存着的回应加上「离线」标记 (body 不变)
function marked(res) {
  var h = new Headers(res.headers); h.set('x-bterm-offline', '1');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

// 先上网；失败或超时就用存着的 (key = 去掉 ?v= 的网址，只留最新一份)
function networkFirst(req, key, cacheName, fallbackKey) {
  return new Promise(function (resolve, reject) {
    var done = false, timer = null;
    function fromCache() {
      return caches.match(key).then(function (hit) { return hit || (fallbackKey ? caches.match(fallbackKey) : null); });
    }
    // no-cache = 每次都跟服务器确认 (没改就是很小的 304)；不然离线时浏览器自己的 HTTP 缓存会先回应，页面就不知道已经离线
    fetch(new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' })).then(function (res) {
      if (res.ok) { var copy = res.clone(); caches.open(cacheName).then(function (c) { c.put(key, copy); }); }
      if (!done) { done = true; clearTimeout(timer); resolve(res); }
    }).catch(function (err) {
      if (done) return;
      fromCache().then(function (hit) { done = true; clearTimeout(timer); hit ? resolve(marked(hit)) : reject(err); });
    });
    // 讯号很差时不要一直转圈：等太久而且有存着的就先用存着的
    timer = setTimeout(function () {
      fromCache().then(function (hit) { if (hit && !done) { done = true; resolve(marked(hit)); } });
    }, WAIT_MS);
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== SCOPE.origin || url.pathname.indexOf(SCOPE.pathname) !== 0) return;  // 只管终端版自己的文件
  var rel = url.pathname.slice(SCOPE.pathname.length);
  if (rel.indexOf('fonts/') === 0) {
    e.respondWith(caches.open(FONT).then(function (c) {
      return c.match(req).then(function (hit) { return hit || fetch(req).then(function (res) { if (res.ok) c.put(req, res.clone()); return res; }); });
    }));
    return;
  }
  if (req.mode === 'navigate') {
    // 页面：离线时打不开的页面 (例如没看过的 legal.html) 就开首页
    e.respondWith(networkFirst(req, noSearch(req.url), DATA, abs('./')));
    return;
  }
  if (/\.json$/.test(rel)) {
    e.respondWith(networkFirst(req, noSearch(req.url), DATA));
    return;
  }
  e.respondWith(caches.match(req).then(function (hit) {
    return hit || fetch(req).then(function (res) {
      if (res.ok && url.search) { var copy = res.clone(); caches.open(SHELL).then(function (c) { c.put(req, copy); }); }
      return res;
    });
  }));
});
