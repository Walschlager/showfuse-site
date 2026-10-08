/* ShowFuse claim + freeze pages: shared helpers.
   No third-party code. Tokens stay in memory. Every piece of server or user
   text goes into the page with textContent, never innerHTML. */
(function () {
  'use strict';

  var loadedAt = Date.now();
  var host = location.hostname;
  var local = host === 'localhost' || host === '127.0.0.1';
  var fake = local && /(?:^|[?&])fake=1(?:&|$)/.test(location.search);
  var API = local ? 'http://localhost:3000' : 'https://showfuse-api-production.up.railway.app';
  var MIN_MS = 2600; // the server wants t >= 2500 ms on the page

  // Dev only: ?fake=1 on localhost swaps in canned API answers (claim/dev-fake.js).
  var ready = new Promise(function (resolve) {
    if (!fake) { resolve(); return; }
    var s = document.createElement('script');
    s.src = '/claim/dev-fake.js';
    s.onload = function () { resolve(); };
    s.onerror = function () { resolve(); };
    document.head.appendChild(s);
  });

  // Read "#key=value&key2=value2" into an object, then wipe it from the
  // address bar and this history entry. Values are decoded without turning
  // "+" into a space, so tokens come through intact.
  function takeHash() {
    var out = {};
    var raw = location.hash.replace(/^#/, '');
    if (!raw) return out;
    raw.split('&').forEach(function (part) {
      var i = part.indexOf('=');
      if (i < 1) return;
      try { out[decodeURIComponent(part.slice(0, i))] = decodeURIComponent(part.slice(i + 1)); } catch (e) { /* bad escape: skip it */ }
    });
    history.replaceState(null, '', location.pathname + (fake ? location.search : ''));
    return out;
  }

  function sinceLoad() { return Date.now() - loadedAt; }

  // Resolves once the page has been open long enough for the bot check.
  function afterMinTime() {
    var wait = MIN_MS - sinceLoad();
    if (wait <= 0) return Promise.resolve();
    return new Promise(function (resolve) { setTimeout(resolve, wait); });
  }

  // Adds the honeypot value and time-on-page to an unauthenticated POST body.
  function withBot(body) {
    var v = '';
    var traps = document.querySelectorAll('input[name="website"]');
    for (var i = 0; i < traps.length; i++) { if (traps[i].value) { v = traps[i].value; break; } }
    body.website = v;
    body.t = Math.min(sinceLoad(), 86000000);   // the waitlist schema caps t at one day
    return body;
  }

  var NET_MSG = 'We couldn’t reach ShowFuse. Check your connection and try again.';

  function problem(status, code, message) { return { status: status, code: code, message: String(message) }; }

  function fallbackMsg(status) {
    if (status === 429) return 'Too many tries for now. Wait a few minutes and try again.';
    if (status >= 500) return 'Something went wrong on our side. Try again in a minute.';
    return 'Something went wrong. Try again.';
  }

  // fetch wrapper. Resolves with the JSON body on 2xx. Rejects with
  // { status, code, message } where message is the server's own sentence.
  function request(method, path, o) {
    o = o || {};
    var headers = { Accept: 'application/json' };
    var body;
    if (o.json) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(o.json); }
    else if (o.form) { body = o.form; }
    if (o.bearer) headers.Authorization = 'Bearer ' + o.bearer;
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = null;
    function done() { if (timer) clearTimeout(timer); }
    // Wait for the dev fake (if any) so a fake-mode request can never reach a real server.
    return ready.then(function () {
      if (fake && !window.SF_FAKE_READY) throw problem(0, 'network', 'The fake API didn\u2019t load. Reload the page.');
      timer = ctl ? setTimeout(function () { ctl.abort(); }, o.timeout || 25000) : null;
      return fetch(API + path, {
        method: method, headers: headers, body: body,
        credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
        signal: ctl ? ctl.signal : undefined
      });
    }).then(function (r) {
      return r.text().then(function (txt) {
        done();
        var j = null;
        try { j = txt ? JSON.parse(txt) : null; } catch (e) { j = null; }
        if (r.ok) return j || {};
        var e = j && j.error && typeof j.error === 'object' ? j.error : null;
        throw problem(r.status, (e && e.code) || 'http_' + r.status, (e && e.message) || fallbackMsg(r.status));
      });
    }).catch(function (err) {
      done();
      if (err && typeof err.status === 'number' && err.code) throw err;
      throw problem(0, 'network', NET_MSG);
    });
  }

  // Tiny DOM builder. Text always goes in as text nodes.
  function el(tag, props, kids) {
    var n = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v === undefined || v === null || v === false) return;
        if (k === 'text') n.textContent = String(v);
        else if (k === 'cls') n.className = v;
        else if (k === 'on') Object.keys(v).forEach(function (ev) { n.addEventListener(ev, v[ev]); });
        else if (k === 'hidden' || k === 'disabled') n[k] = true;
        else n.setAttribute(k, v === true ? '' : String(v));
      });
    }
    if (kids) {
      kids.forEach(function (c) {
        if (c === null || c === undefined || c === false) return;
        n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    }
    return n;
  }

  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }

  function isEmail(s) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s); }

  if (fake) {
    ready.then(function () {
      document.body.appendChild(el('div', { cls: 'fakebadge', text: 'FAKE API', 'aria-hidden': 'true' }));
    });
  }

  window.SF = {
    API: API, fake: fake, ready: ready, NET_MSG: NET_MSG,
    takeHash: takeHash, afterMinTime: afterMinTime, withBot: withBot,
    request: request, el: el, clear: clear, isEmail: isEmail
  };
})();
