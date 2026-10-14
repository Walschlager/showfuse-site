/* ShowFuse shop: helpers shared by the shop pages. Built against docs/SHOP_API.md.
   No third-party code. Every piece of server or user text goes into the page with
   textContent, never innerHTML. What is kept on the device: the bag (localStorage, with a fallback when the
   browser blocks storage) and, for one checkout attempt, its key (sessionStorage). That record also notes whether
   the newsletter box was ticked for that attempt, so Back from Stripe can show the box as it was; it goes when the
   attempt ends, after 40 minutes, or with the tab. Nothing is stored about whether the shop is open: every page
   asks the server and, if it can't get a clear "visible", shows no shop doors. */
(function () {
  'use strict';
  var Base = window.SFBase;
  if (!Base) return;

  var loadedAt = Date.now();
  var MIN_MS = 2600;                     // the server wants t >= 2500 ms on the page for a website checkout
  var MAIL = 'info@showfuseapp.com';
  var NET_MSG = 'We couldn\'t reach ShowFuse. Check your connection and try again.';
  var limits = { items: 10, qty: 5 };    // replaced by what GET /v1/shop/config says

  function $(id) { return id ? document.getElementById(id) : null; }

  // ---------- small DOM builder (text always goes in as text nodes) ----------
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

  // ---------- talking to the API ----------
  function problem(status, code, message, detail) {
    return { status: status, code: code, message: String(message), lines: detail && Array.isArray(detail.lines) ? detail.lines : [] };
  }
  function fallbackMsg(status) {
    if (status === 429) return 'Too many tries for now. Wait a minute and try again.';
    if (status >= 500) return 'Something went wrong on our side. Try again in a minute.';
    return 'Something went wrong. Try again.';
  }

  // fetch wrapper. Resolves with the JSON body on 2xx. Rejects with { status, code, message, lines }
  // where message is the server's own sentence.
  function request(method, path, o) {
    o = o || {};
    var headers = { Accept: 'application/json' };
    var body;
    if (o.json) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(o.json); }
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = null;
    function done() { if (timer) clearTimeout(timer); }
    // Wait for the dev fake (if any), so a fake-mode request can never reach a real server.
    return Base.ready.then(function () {
      if (Base.fake && !window.SF_SHOP_FAKE_READY) throw problem(0, 'network', 'The fake API didn\'t load. Reload the page.');
      timer = ctl ? setTimeout(function () { ctl.abort(); }, o.timeout || 25000) : null;
      return fetch(Base.api + path, {
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
        throw problem(r.status, (e && e.code) || 'http_' + r.status, (e && e.message) || fallbackMsg(r.status), e);
      });
    }).catch(function (err) {
      done();
      if (err && typeof err.status === 'number' && err.code) throw err;
      throw problem(0, 'network', NET_MSG);
    });
  }

  // ---------- bot checks for the website checkout ----------
  function sinceLoad() { return Date.now() - loadedAt; }
  function afterMinTime() {
    var wait = MIN_MS - sinceLoad();
    if (wait <= 0) return Promise.resolve();
    return new Promise(function (resolve) { setTimeout(resolve, wait); });
  }
  // The honeypot value and time-on-page, added to the checkout body.
  function withBot(body) {
    var v = '';
    var traps = document.querySelectorAll('input[name="website"]');
    for (var i = 0; i < traps.length; i++) { if (traps[i].value) { v = traps[i].value; break; } }
    body.website = v;
    body.t = Math.min(sinceLoad(), 86000000);     // the server caps t at one day
    return body;
  }

  // ---------- money, dates, words ----------
  // 6500 -> "$65.00"
  function usd(cents) {
    var c = Math.round(Number(cents) || 0);
    var abs = Math.abs(c);
    var dollars = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (c < 0 ? '-' : '') + '$' + dollars + '.' + ('0' + (abs % 100)).slice(-2);
  }
  // 800 -> "$8", 150 -> "$1.50"
  function usdShort(cents) {
    var c = Math.round(Number(cents) || 0);
    return c % 100 === 0 ? usd(c).replace(/\.00$/, '') : usd(c);
  }
  function shortDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    try { return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); } catch (e) { return ''; }
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function joinList(items) {
    if (items.length <= 1) return items.join('');
    return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
  }
  function cleanStr(v, max) { return typeof v === 'string' ? v.slice(0, max) : ''; }
  function intOr(v, d) { return typeof v === 'number' && isFinite(v) ? Math.round(v) : d; }

  // ---------- addresses we are willing to put in a link or an image ----------
  function isLocalUrl(u) { return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u); }
  function safeImg(u) {
    if (typeof u !== 'string' || u.length > 600) return null;
    if (/^https:\/\//i.test(u)) return u;
    if (Base.local && isLocalUrl(u)) return u;
    if (Base.fake && /^\/shop\/dev-photos\/[a-z0-9_]+\.jpg$/.test(u)) return u;
    return null;
  }
  // Only our own website, or this machine while testing.
  function safeSiteUrl(u) {
    if (typeof u !== 'string' || u.length > 300) return null;
    try {
      var x = new URL(u);
      if (x.protocol === 'https:' && (x.hostname === 'showfuseapp.com' || x.hostname === 'www.showfuseapp.com')) return x.href;
      if (Base.local && x.protocol === 'http:' && (x.hostname === 'localhost' || x.hostname === '127.0.0.1')) return x.href;
    } catch (e) { /* not a web address */ }
    return null;
  }
  function safeHttps(u) {
    if (typeof u !== 'string' || u.length > 500) return null;
    try { var x = new URL(u); return x.protocol === 'https:' ? x.href : null; } catch (e) { return null; }
  }
  // A product or order picture. If it can't load, a quiet block with the first letter stays.
  // lazy: true for pictures well below the fold (the browser loads them as you scroll).
  function photo(url, alt, cls, lazy) {
    var box = el('div', { cls: cls || 'ph' });
    var src = safeImg(url);
    var img = null;
    function none() {
      if (img && img.parentNode) img.parentNode.removeChild(img);
      if (box.className.indexOf('nophoto') < 0) box.className += ' nophoto';
      box.setAttribute('data-initial', String(alt || '').trim().charAt(0).toUpperCase());
    }
    if (!src) { none(); return box; }
    img = el('img', { src: src, alt: alt || '', decoding: 'async', loading: lazy ? 'lazy' : null, referrerpolicy: 'no-referrer' });
    img.addEventListener('error', none);
    box.appendChild(img);
    return box;
  }

  // The small yellow "DEMO" tag on a demo item's photos, as in the app (R1). size: '' (a card in the grid), 'big' (the product
  // photo) or 'thumb'. The size classes are demo-big / demo-thumb: a plain "big" would pick up the product gallery's own .big rules.
  function demoStamp(size) {
    return el('div', { cls: 'demo' + (size ? ' demo-' + size : ''), text: 'DEMO' });
  }

  // A product as the shop pages use it. Anything we don't recognise is dropped.
  function normalizeProduct(p) {
    if (!p || typeof p.slug !== 'string' || typeof p.name !== 'string') return null;
    var out = {
      id: cleanStr(p.id, 60), slug: p.slug, name: cleanStr(p.name, 120), blurb: cleanStr(p.blurb, 200),
      description: cleanStr(p.description, 4000), priceCents: intOr(p.price_cents, 0), status: cleanStr(p.status, 20),
      buyable: p.buyable === true, soldOut: p.sold_out === true, preview: p.preview === true, demo: p.demo === true,
      photos: [], sizes: [], shipping: [], shipsTo: []
    };
    (Array.isArray(p.photos) ? p.photos : []).forEach(function (u) { if (safeImg(u)) out.photos.push(u); });
    (Array.isArray(p.sizes) ? p.sizes : []).forEach(function (s) {
      if (s && typeof s.id === 'string' && typeof s.label === 'string') {
        out.sizes.push({ id: s.id.toLowerCase(), label: cleanStr(s.label, 30), soldOut: s.sold_out === true, left: typeof s.left === 'number' ? Math.max(0, Math.round(s.left)) : null });
      }
    });
    (Array.isArray(p.shipping) ? p.shipping : []).forEach(function (s) {
      if (s && typeof s.zone_id === 'string') out.shipping.push({ zoneId: s.zone_id, ships: s.ships === true, priceCents: typeof s.price_cents === 'number' ? s.price_cents : null });
    });
    (Array.isArray(p.ships_to) ? p.ships_to : []).forEach(function (c) { if (typeof c === 'string' && /^[A-Z]{2}$/.test(c)) out.shipsTo.push(c); });
    return out;
  }

  // Links between shop pages keep the localhost dev switches (?fake=1, ?api=practice, ...).
  function href(path) {
    if (!Base.carry) return path;
    var hash = '';
    var i = path.indexOf('#');
    if (i >= 0) { hash = path.slice(i); path = path.slice(0, i); }
    return path + (path.indexOf('?') >= 0 ? '&' : '?') + Base.carry + hash;
  }

  // ---------- the store switch and what it ships to ----------
  var REGION_NAMES = { QC: 'Quebec' };
  function regionName(code) { return REGION_NAMES[code] || code; }

  function normalizeConfig(j) {
    j = j || {};
    // mode: "off", "showcase" (the shop can be looked at, nothing can be bought) or "open". An older server doesn't say
    // at all: then it is open if it says open, else off. A mode we don't know is treated as off (fail closed).
    var mode = j.mode === undefined || j.mode === null ? (j.open === true ? 'open' : 'off')
      : (j.mode === 'off' || j.mode === 'showcase' || j.mode === 'open' ? j.mode : 'off');
    var cfg = {
      mode: mode, open: j.open === true && mode === 'open', visible: false, showcase: false, testMode: j.test_mode === true,
      tax: j.tax === 'calculated_at_checkout' ? 'calculated_at_checkout' : 'none',
      packTime: cleanStr(j.pack_time, 40), countries: [], lowStockAt: 5, links: { shippingReturns: null, termsOfSale: null }
    };
    (Array.isArray(j.countries) ? j.countries : []).forEach(function (c) {
      if (!c || typeof c.code !== 'string' || !/^[A-Z]{2}$/.test(c.code)) return;
      cfg.countries.push({
        code: c.code, name: cleanStr(c.name, 60) || c.code, zoneId: cleanStr(c.zone_id, 60),
        extraCents: intOr(c.extra_item_cents, 0), delivery: cleanStr(c.delivery, 60), note: cleanStr(c.note, 400) || null,
        excluded: (Array.isArray(c.excluded_regions) ? c.excluded_regions : []).filter(function (r) { return typeof r === 'string' && /^[A-Z]{2,3}$/.test(r); }),
        collectsPhone: c.collects_phone === true ? true : c.collects_phone === false ? false : null
      });
    });
    // Showcase: the server says visible and nothing more is needed (nothing ships, nothing is bought), so cfg.open stays false:
    // no bag, no Add to bag, no Checkout. Otherwise visible only when the server says so AND there is somewhere to ship to.
    // Anything else: no doors.
    cfg.showcase = mode === 'showcase' && j.visible === true;
    cfg.visible = cfg.showcase || (cfg.open && j.visible === true && cfg.countries.length > 0);
    var l = j.limits || {};
    if (intOr(l.max_items, 0) >= 1 && intOr(l.max_items, 0) <= 100) limits.items = intOr(l.max_items, 10);
    if (intOr(l.max_qty_per_line, 0) >= 1 && intOr(l.max_qty_per_line, 0) <= 100) limits.qty = intOr(l.max_qty_per_line, 5);
    if (intOr(j.low_stock_at, -1) >= 0) cfg.lowStockAt = intOr(j.low_stock_at, 5);
    var links = j.links || {};
    cfg.links.shippingReturns = safeSiteUrl(links.shipping_returns);
    cfg.links.termsOfSale = safeSiteUrl(links.terms_of_sale);
    return cfg;
  }

  // Asked on every page load. Not kept anywhere: a closed store must show no doors.
  var cfgPromise = null;
  function config(force) {
    if (cfgPromise && !force) return cfgPromise;
    cfgPromise = request('GET', '/v1/shop/config', { timeout: 12000 }).then(normalizeConfig, function (err) {
      // A server that doesn't have the shop yet answers 404 for this route. That is "no shop here", so the closed page,
      // not a technical error. Any other failure (no connection, a server error) still throws: we don't know, so no doors.
      if (err && err.status === 404) return normalizeConfig({ open: false, visible: false });
      throw err;
    });
    return cfgPromise;
  }

  function countryByCode(cfg, code) {
    for (var i = 0; cfg && i < cfg.countries.length; i++) if (cfg.countries[i].code === code) return cfg.countries[i];
    return null;
  }
  // "Canada (not Quebec yet)"
  function countryLabel(c) {
    return c.excluded.length ? c.name + ' (not ' + c.excluded.map(regionName).join(' or ') + ' yet)' : c.name;
  }
  // The note under the Ship to picker: the server's note, then what each country needs us to say.
  function countryNote(c) {
    if (!c) return '';
    var parts = [];
    if (c.note) parts.push(c.note);
    if (c.code === 'CA' && c.note && /duties/i.test(c.note)) parts.push('Canada may charge them when the parcel arrives.');
    c.excluded.forEach(function (r) { parts.push(regionName(r) + ': we don\'t ship there yet.'); });
    var phone = c.collectsPhone === null ? c.code === 'CA' : c.collectsPhone;
    if (phone) parts.push('The next page asks for a phone number (' + c.name + ' only), because the carrier needs one.');
    return parts.join(' ');
  }
  // In a sentence: "the US", "Canada".
  function countryShort(c) { return c.code === 'US' ? 'the US' : c.name; }
  function countryLong(c) { return c.code === 'US' ? 'the United States' : c.name; }

  // ---------- the bag (kept in this browser) ----------
  var Bag = (function () {
    var KEY = 'sf_bag_v1';
    var CK_KEY = 'sf_checkout_key_v1';
    var NAME_PREFIX = 'sfbag1:';
    var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    var MAX_AGE = 30 * 24 * 3600 * 1000;
    var storeOK = null;

    // Does this browser let us keep anything? (Some block it. The bag then rides along in the
    // tab's window name instead, which lasts for the tab.)
    function canStore() {
      if (storeOK !== null) return storeOK;
      try {
        var k = '__sf_probe';
        window.localStorage.setItem(k, '1');
        window.localStorage.removeItem(k);
        storeOK = true;
      } catch (e) { storeOK = false; }
      return storeOK;
    }
    function rawRead() {
      if (canStore()) {
        try { return window.localStorage.getItem(KEY); } catch (e) { return null; }
      }
      var n = String(window.name || '');
      return n.indexOf(NAME_PREFIX) === 0 ? n.slice(NAME_PREFIX.length) : null;
    }
    function rawWrite(str) {
      if (canStore()) {
        try { if (str === null) window.localStorage.removeItem(KEY); else window.localStorage.setItem(KEY, str); return; } catch (e) { storeOK = false; }
      }
      try { window.name = str === null ? '' : NAME_PREFIX + str; } catch (e) { /* nothing more to try */ }
    }

    // Anything odd in storage is dropped, so a hand-edited or old bag can never send a bad request.
    function clean(x) {
      var out = { country: '', lines: [], t: 0 };
      if (!x || typeof x !== 'object') return out;
      if (typeof x.country === 'string' && /^[A-Z]{2}$/.test(x.country)) out.country = x.country;
      if (typeof x.t === 'number') out.t = x.t;
      var seen = {};
      var total = 0;
      (Array.isArray(x.lines) ? x.lines : []).forEach(function (l) {
        if (!l || typeof l.id !== 'string') return;
        var id = l.id.toLowerCase();
        var q = Math.floor(Number(l.q));
        if (!UUID.test(id) || !(q >= 1) || seen[id]) return;
        q = Math.min(q, limits.qty, limits.items - total);
        if (q < 1) return;
        seen[id] = true;
        total += q;
        out.lines.push({ id: id, q: q });
      });
      return out;
    }
    function read() {
      var out = { country: '', lines: [], t: 0 };
      try {
        var raw = rawRead();
        if (raw) out = clean(JSON.parse(raw));
      } catch (e) { out = { country: '', lines: [], t: 0 }; }
      if (out.t && Date.now() - out.t > MAX_AGE) out = { country: out.country, lines: [], t: 0 };
      return out;
    }
    function write(b) {
      b = clean(b);
      b.t = Date.now();
      rawWrite(b.lines.length || b.country ? JSON.stringify(b) : null);
      return b;
    }
    function count() {
      return read().lines.reduce(function (n, l) { return n + l.q; }, 0);
    }
    function qtyOf(id) {
      var b = read();
      for (var i = 0; i < b.lines.length; i++) if (b.lines[i].id === id) return b.lines[i].q;
      return 0;
    }
    // How many more of this one can go in the bag, and which limit is the one that stops it:
    // 'order' (the whole bag is full), 'line' (this one is at its most) or 'stock' (all that's left).
    function room(id, left) {
      var have = id ? qtyOf(id) : 0;
      var lineRoom = limits.qty - have;
      var orderRoom = limits.items - count();
      var stockRoom = typeof left === 'number' ? left - have : Infinity;
      var n = Math.min(lineRoom, orderRoom, stockRoom);
      var why = orderRoom <= lineRoom && orderRoom <= stockRoom ? 'order' : lineRoom <= stockRoom ? 'line' : 'stock';
      return { n: Math.max(n, 0), why: why };
    }
    function add(id, qty) {
      var b = read();
      var line = null;
      b.lines.forEach(function (l) { if (l.id === id) line = l; });
      if (line) line.q += qty; else b.lines.push({ id: id, q: qty });
      return write(b);
    }
    function setQty(id, qty) {
      var b = read();
      b.lines.forEach(function (l) { if (l.id === id) l.q = qty; });
      return write(b);
    }
    function remove(id) {
      var b = read();
      b.lines = b.lines.filter(function (l) { return l.id !== id; });
      return write(b);
    }
    function clearLines() {
      var b = read();
      b.lines = [];
      return write(b);
    }
    function setCountry(code) {
      var b = read();
      b.country = code;
      return write(b);
    }

    // One checkout attempt = one key. The same bag to the same country reuses it, so a double tap,
    // a reload or "back" from Stripe gets the same payment page, never a second hold on the stock.
    // b.news (the "Email me when new merch drops" tick) is part of it only when ticked, so an unticked bag hashes exactly as
    // it always did. A changed tick starts a new attempt: the old payment page must not carry yesterday's answer.
    function bagHash(b) {
      return b.country + '|' + b.lines.map(function (l) { return l.id + ':' + l.q; }).sort().join(',') + (b.news ? '|news' : '');
    }
    function newKey() {
      var bytes = new Uint8Array(18);
      if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
      else for (var i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
      var s = '';
      for (var j = 0; j < bytes.length; j++) s += String.fromCharCode(bytes[j]);
      return window.btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');   // 24 characters of A-Za-z0-9_-
    }
    var memKey = null;
    function heldRecord() {
      var held = memKey;
      try {
        var raw = window.sessionStorage.getItem(CK_KEY);
        if (raw) held = JSON.parse(raw);
      } catch (e) { /* storage blocked: the key lives in memory */ }
      return held;
    }
    function checkoutKey(b, fresh) {
      var h = bagHash(b);
      var held = heldRecord();
      if (!fresh && held && held.h === h && typeof held.k === 'string' && Date.now() - held.t < 40 * 60 * 1000) return held.k;
      var made = { h: h, k: newKey(), t: Date.now() };
      memKey = made;
      try { window.sessionStorage.setItem(CK_KEY, JSON.stringify(made)); } catch (e) { /* memory only */ }
      return made.k;
    }
    function forgetCheckoutKey() {
      memKey = null;
      try { window.sessionStorage.removeItem(CK_KEY); } catch (e) { /* nothing */ }
    }
    // Back from Stripe can load the bag page again. If this very bag was just sent to Stripe with the newsletter box ticked,
    // the box comes back ticked, so pressing Checkout again is still the same attempt (same key, same payment page, no
    // second hold). Any other time the box starts unticked: nothing about it is kept beyond that one attempt.
    function wasTicked(b) {
      var held = heldRecord();
      return !!(held && typeof held.h === 'string' && Date.now() - held.t < 40 * 60 * 1000 &&
        held.h === bagHash({ country: b.country, lines: b.lines, news: true }));
    }

    return {
      read: read, write: write, count: count, qtyOf: qtyOf, room: room, add: add, setQty: setQty,
      remove: remove, clear: clearLines, setCountry: setCountry, checkoutKey: checkoutKey, forgetCheckoutKey: forgetCheckoutKey,
      wasTicked: wasTicked
    };
  })();

  // ---------- header and footer ----------
  var navState = { cfg: null, opts: {} };

  function navLink(text, path, on, extra) {
    var a = el('a', { href: href(path), cls: (extra || '') + (on ? ' on' : ''), 'data-gen': '1' });
    if (on) a.setAttribute('aria-current', 'page');
    a.appendChild(document.createTextNode(text));
    return a;
  }
  // cfg: the store's answer, or null if we couldn't get one (then no shop doors at all).
  // opts.here: 'shop' | 'bag' | ''.   opts.bag: false hides the Bag link (the thank-you page).
  function renderNav(cfg, opts) {
    navState.cfg = cfg;
    navState.opts = opts || {};
    opts = navState.opts;
    // The practice server answers test_mode: true. Say so, so pretend money is never mistaken for real.
    var strip = $('teststrip');
    if (cfg && cfg.testMode) {
      if (!strip) document.body.insertBefore(el('div', { id: 'teststrip', cls: 'teststrip', role: 'note', text: 'TEST MONEY · practice server' }), document.body.firstChild);
    } else if (strip) {
      strip.parentNode.removeChild(strip);
    }
    var nav = $('nav');
    if (!nav) return;
    var old = nav.querySelectorAll('[data-gen]');
    for (var i = 0; i < old.length; i++) old[i].parentNode.removeChild(old[i]);
    var help = nav.querySelector('.helplink');
    if (cfg && cfg.visible) nav.insertBefore(navLink('Shop', '/shop/', opts.here === 'shop'), help);
    if (cfg && cfg.open && opts.bag !== false) {
      var n = Bag.count();
      var a = navLink('Bag', '/shop/bag/', opts.here === 'bag', 'bag');
      if (n > 0) {
        a.appendChild(document.createTextNode(' '));
        a.appendChild(el('b', { text: n }));
        a.setAttribute('aria-label', 'Bag, ' + plural(n, 'item', 'items'));
      }
      nav.insertBefore(a, help);
    }
  }
  // Other tabs change the bag: keep the little count honest.
  window.addEventListener('storage', function (e) { if (e.key === 'sf_bag_v1' && navState.cfg) renderNav(navState.cfg, navState.opts); });

  // "Shipping & returns" and "Terms of sale" appear only when the store is on and says where they are.
  function renderFooter(cfg) {
    var box = $('policyLinks');
    if (!box) return;
    var a = $('polShip'), b = $('polTerms');
    // Only while buying is open. In showcase nothing can be bought, so there is nothing to link (and the pages may not exist yet).
    var live = cfg && cfg.visible && !cfg.showcase;
    var s = live ? cfg.links.shippingReturns : null;
    var t = live ? cfg.links.termsOfSale : null;
    if (a && s) a.setAttribute('href', s);
    if (b && t) b.setAttribute('href', t);
    box.hidden = !(s && t);
  }

  // The returns words (Brandon's checkpoint 1.4), with links to the two policy pages when they exist.
  function policyLinks(cfg, mt) {
    var out = [];
    if (cfg && cfg.showcase) return null;
    if (cfg && cfg.links.shippingReturns) out.push(el('a', { href: cfg.links.shippingReturns, target: '_blank', rel: 'noopener', text: 'Shipping and returns' }));
    if (cfg && cfg.links.termsOfSale) out.push(el('a', { href: cfg.links.termsOfSale, target: '_blank', rel: 'noopener', text: 'Terms of sale' }));
    return out.length ? el('div', { cls: 'pol-links' + (mt ? ' ' + mt : '') }, out) : null;
  }

  function focusHeading(root) {
    var h = root && root.querySelector('h1');
    if (h) { try { h.focus({ preventScroll: true }); } catch (e) { h.focus(); } }
  }
  function setTitle(t) { document.title = t + ' · ShowFuse'; }

  // The closed-store page: also what an old link or a typed address gets.
  function closedPage(main) {
    main.className = 'wrap';
    return [
      el('div', { cls: 'kicker', text: 'ShowFuse merch' }),
      el('h1', { tabindex: '-1', text: 'The shop isn\'t open yet.' }),
      el('p', { cls: 'lede', text: 'Nothing is for sale here right now.' }),
      el('a', { cls: 'btn small ghost', href: '/', text: 'Back to ShowFuse' })
    ];
  }

  // A "couldn't load" block with a button that runs retry().
  function errorBlock(message, retry) {
    return [
      el('div', { cls: 'err', role: 'alert' }, [el('p', { text: message })]),
      retry ? el('button', { type: 'button', cls: 'btn small ghost', text: 'Try again', on: { click: retry } }) : null
    ];
  }

  // ?fake=1 or ?fake=checkout (localhost only): a small badge, so canned answers are never mistaken for the real thing.
  // Add &nobadge=1 for clean screenshots.
  if (Base.fake && !/(?:^|[?&])nobadge=1(?:&|$)/.test(window.location.search)) {
    Base.ready.then(function () {
      document.body.appendChild(el('div', { cls: 'fakebadge', 'aria-hidden': 'true', text: Base.fake === 'checkout' ? 'FAKE CHECKOUT' : 'FAKE API' }));
    });
  }

  window.SFShop = {
    Base: Base, MAIL: MAIL, NET_MSG: NET_MSG, limits: limits, Bag: Bag,
    $: $, el: el, clear: clear, request: request, withBot: withBot, afterMinTime: afterMinTime,
    usd: usd, usdShort: usdShort, shortDate: shortDate, plural: plural, joinList: joinList,
    safeHttps: safeHttps, photo: photo, demoStamp: demoStamp, normalizeProduct: normalizeProduct, href: href,
    config: config, countryByCode: countryByCode, countryLabel: countryLabel, countryNote: countryNote,
    countryShort: countryShort, countryLong: countryLong,
    renderNav: renderNav, renderFooter: renderFooter, policyLinks: policyLinks,
    focusHeading: focusHeading, setTitle: setTitle, closedPage: closedPage, errorBlock: errorBlock
  };
})();
