// Roleplay20 public gate. This page holds no game content: after the password is accepted by the game server,
// the rest of the app is loaded from that server.
(function () {
  'use strict';
  var REPO = 'roamingjackmans-pixel/roleplay20';
  var DISCOVERY = [
    'https://api.github.com/repos/' + REPO + '/contents/server.json?ref=live',
    'https://raw.githubusercontent.com/' + REPO + '/live/server.json',
  ];
  var $ = function (id) { return document.getElementById(id); };
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  };

  var device = store.get('rp20.device');
  if (!device) {
    var bytes = new Uint8Array(12);
    (window.crypto || window.msCrypto).getRandomValues(bytes);
    device = Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    store.set('rp20.device', device);
  }

  var server = null;

  function show(which) {
    ['gate-form', 'locked', 'status', 'offline'].forEach(function (id) { $(id).hidden = id !== which; });
  }
  function status(text) { $('status-text').textContent = text; show('status'); }

  function withTimeout(ms) {
    if (window.AbortSignal && AbortSignal.timeout) return AbortSignal.timeout(ms);
    var c = new AbortController();
    setTimeout(function () { c.abort(); }, ms);
    return c.signal;
  }

  function norm(u) { return u && u.charAt(u.length - 1) !== '/' ? u + '/' : u; }

  function ping(base) {
    return fetch(base + 'api/ping', { cache: 'no-store', signal: withTimeout(4500) })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { return !!(j && j.ok && j.name === 'Roleplay20'); })
      .catch(function () { return false; });
  }

  function discover(i) {
    if (i >= DISCOVERY.length) return Promise.resolve(null);
    return fetch(DISCOVERY[i] + (i ? '?t=' + Date.now() : ''), { cache: 'no-store', headers: i === 0 ? { Accept: 'application/vnd.github.raw+json' } : {} })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { return j && j.url ? norm(j.url) : discover(i + 1); })
      .catch(function () { return discover(i + 1); });
  }

  function findServer() {
    var q = new URLSearchParams(location.search).get('server');
    if (q) store.set('rp20.server', norm(q));
    var here = new URL('./', location.href).href;
    return ping(here).then(function (ok) {
      if (ok) return here;
      var saved = store.get('rp20.server');
      return (saved ? ping(saved) : Promise.resolve(false)).then(function (ok2) {
        if (ok2) return saved;
        return discover(0).then(function (url) {
          if (!url) return null;
          return ping(url).then(function (ok3) { if (ok3) { store.set('rp20.server', url); return url; } return null; });
        });
      });
    });
  }

  function api(path, opts) {
    opts = opts || {};
    var headers = { 'Content-Type': 'application/json' };
    var g = store.get('rp20.gate');
    if (g) headers['X-RP20-Gate'] = g;
    return fetch(server + 'api/' + path, { method: opts.method || 'GET', headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j._status = r.status; return j; }); });
  }

  var timer = null;
  function lockedUntil(until) {
    store.set('rp20.lockedUntil', String(until));
    show('locked');
    clearInterval(timer);
    var tick = function () {
      var ms = until - Date.now();
      if (ms <= 0) { clearInterval(timer); store.set('rp20.lockedUntil', null); show('gate-form'); return; }
      var h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
      $('countdown').textContent = [h, m, s].map(function (n) { return (n < 10 ? '0' : '') + n; }).join(':');
    };
    tick();
    timer = setInterval(tick, 1000);
  }

  function message(text, bad) {
    var m = $('msg');
    m.textContent = text || '';
    m.className = 'msg' + (bad ? ' bad' : '');
  }

  function loadApp() {
    status('Opening the doors…');
    api('app-manifest').then(function (man) {
      if (man._status === 403) { store.set('rp20.gate', null); show('gate-form'); return; }
      if (!man.js) { status(man.error || 'The app could not be loaded.'); return; }
      window.RP20 = { server: server, gate: store.get('rp20.gate'), device: device, shell: true };
      (man.css || []).forEach(function (href) {
        var l = document.createElement('link');
        l.rel = 'stylesheet';
        l.href = server + href;
        document.head.appendChild(l);
      });
      var s = document.createElement('script');
      s.type = 'module';
      s.src = server + man.js;
      s.onerror = function () { status('The app could not be loaded. Try refreshing.'); };
      window.addEventListener('rp20:ready', function () {
        $('gate').classList.add('leaving');
        setTimeout(function () { $('gate').remove(); var e = $('embers'); if (e) e.remove(); }, 600);
      });
      document.body.appendChild(s);
    }).catch(function () { show('offline'); });
  }

  function boot() {
    status('Finding the tavern…');
    var lu = Number(store.get('rp20.lockedUntil') || 0);
    findServer().then(function (url) {
      server = url;
      if (!server) {
        if (lu > Date.now()) return lockedUntil(lu);
        return show('offline');
      }
      return api('gate/status?device=' + device).then(function (st) {
        if (st.locked) return lockedUntil(st.lockedUntil);
        store.set('rp20.lockedUntil', null);
        if (!st.configured) { show('gate-form'); message('The site password has not been set up on the server yet.', true); return; }
        if (!store.get('rp20.gate')) { show('gate-form'); setTimeout(function () { $('pw').focus(); }, 50); return; }
        return api('gate/check').then(function (r) {
          if (r.ok) loadApp(); else { store.set('rp20.gate', null); show('gate-form'); $('pw').focus(); }
        });
      });
    }).catch(function () { show('offline'); });
  }

  $('gate-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var pw = $('pw').value;
    if (!pw) return;
    $('go').disabled = true;
    message('Listening…');
    api('gate', { method: 'POST', body: { password: pw, device: device } }).then(function (r) {
      $('go').disabled = false;
      if (r.ok && r.token) {
        store.set('rp20.gate', r.token);
        $('pw').value = '';
        message('');
        loadApp();
      } else if (r.locked) {
        lockedUntil(r.lockedUntil);
      } else {
        $('pw').value = '';
        var card = $('gate-form');
        card.classList.remove('shake');
        void card.offsetWidth;
        card.classList.add('shake');
        var left = r.remaining;
        message(r.error && left == null ? r.error : 'The door does not open. ' + left + (left === 1 ? ' attempt remains' : ' attempts remain') + ' before it seals for 24 hours.', true);
      }
    }).catch(function () { $('go').disabled = false; show('offline'); });
  });

  $('retry').addEventListener('click', boot);
  $('use-server').addEventListener('click', function () {
    var v = $('manual-server').value.trim();
    if (v) { store.set('rp20.server', norm(v)); boot(); }
  });

  // drifting embers
  (function embers() {
    var cv = $('embers');
    if (!cv || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
    var ctx = cv.getContext('2d');
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var w, h, parts = [];
    function size() { w = cv.width = innerWidth * dpr; h = cv.height = innerHeight * dpr; }
    size();
    addEventListener('resize', size);
    for (var i = 0; i < 70; i++) parts.push({ x: Math.random(), y: Math.random(), r: Math.random() * 1.8 + 0.4, s: Math.random() * 0.0009 + 0.0003, d: Math.random() * Math.PI * 2, a: Math.random() * 0.6 + 0.2 });
    (function frame(t) {
      if (!document.body.contains(cv)) return;
      ctx.clearRect(0, 0, w, h);
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        p.y -= p.s;
        p.x += Math.sin(t / 1800 + p.d) * 0.0004;
        if (p.y < -0.02) { p.y = 1.02; p.x = Math.random(); }
        var flick = 0.6 + 0.4 * Math.sin(t / 300 + p.d * 7);
        ctx.beginPath();
        ctx.fillStyle = 'rgba(242,170,80,' + (p.a * flick).toFixed(3) + ')';
        ctx.shadowColor = 'rgba(255,150,60,.8)';
        ctx.shadowBlur = 8 * dpr;
        ctx.arc(p.x * w, p.y * h, p.r * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
      requestAnimationFrame(frame);
    })(0);
  })();

  boot();
})();
