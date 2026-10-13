/* ShowFuse: /shop/bag/ (the bag). Built against docs/SHOP_API.md.
   The bag lives in this browser (see Bag in common.js). Every number on the page comes from
   POST /v1/shop/quote: the page sends variant ids, quantities and a country, never a price.
   Checkout sends POST /v1/shop/checkout (with the honeypot and the time on the page) and then goes
   to the Stripe page the server hands back. Server text always goes in with textContent. */
(function () {
  'use strict';
  var SF = window.SF;
  if (!SF) return;
  var el = SF.el, Bag = SF.Bag;
  var view = SF.$('view');
  var main = SF.$('main');

  var PROBLEMS = { sold_out: 1, short: 1, unavailable: 1, cant_ship_here: 1 };
  var RETURNS = 'Problems are fully covered. One size exchange within 30 days (you pay return shipping). Otherwise final sale for the first run.';

  var S = {
    cfg: null, country: '', info: {}, quote: null, shown: null,
    loaded: false, busy: false, qerr: '', co: false, coErr: '', qSeq: 0, timer: null, focus: ''
  };
  var photoNodes = {};   // variant id -> its picture, so redrawing the bag doesn't reload the images

  function num(v) { return typeof v === 'number' && isFinite(v) ? Math.round(v) : 0; }
  function numOrNull(v) { return typeof v === 'number' && isFinite(v) ? Math.round(v) : null; }
  function str(v, max) { return typeof v === 'string' ? v.slice(0, max || 200) : ''; }

  // ---------- what the server said ----------
  function normQuote(q) {
    q = q || {};
    var out = {
      ok: q.ok === true, subtotal: num(q.subtotal_cents), shipping: numOrNull(q.shipping_cents), total: numOrNull(q.total_cents),
      rule: null, lines: []
    };
    if (q.shipping && typeof q.shipping === 'object') {
      out.rule = { base: num(q.shipping.base_cents), items: num(q.shipping.items), extra: num(q.shipping.extra_item_cents) };
    }
    (Array.isArray(q.lines) ? q.lines : []).forEach(function (l) {
      if (!l || typeof l.variant_id !== 'string') return;
      out.lines.push({
        id: l.variant_id.toLowerCase(), name: str(l.name, 120), label: str(l.label, 30), photo: typeof l.photo === 'string' ? l.photo : null,
        qty: num(l.qty), unit: num(l.unit_cents), left: typeof l.left === 'number' ? Math.max(0, Math.round(l.left)) : null,
        problem: PROBLEMS[l.problem] ? l.problem : null
      });
    });
    // A line that is short always has its count in "problems", even above the low-stock line.
    (Array.isArray(q.problems) ? q.problems : []).forEach(function (p) {
      if (!p || typeof p.variant_id !== 'string' || p.code !== 'short' || typeof p.left !== 'number') return;
      out.lines.forEach(function (l) { if (l.id === p.variant_id.toLowerCase()) l.left = Math.max(0, Math.round(p.left)); });
    });
    return out;
  }
  // Lines that can't be bought at all: they stay in the bag, struck out, and are left out of the totals.
  function gone(l) { return l.problem === 'unavailable' || l.problem === 'cant_ship_here' || l.problem === 'sold_out'; }

  function bagTotal(bag) { return bag.lines.reduce(function (n, l) { return n + l.q; }, 0); }
  function countryNow() { return SF.countryByCode(S.cfg, S.country); }

  // ---------- asking for the numbers ----------
  function ask(lines) {
    return SF.request('POST', '/v1/shop/quote', {
      json: { country: S.country, items: lines.map(function (l) { return { variant_id: l.id, qty: l.q }; }) }
    }).then(normQuote);
  }

  function schedule(ms) {
    S.busy = true;
    clearTimeout(S.timer);
    S.timer = setTimeout(runQuote, ms);
  }

  function runQuote(retried) {
    var mine = ++S.qSeq;
    var lines = Bag.read().lines;
    if (!lines.length) { S.quote = null; S.shown = null; S.busy = false; S.qerr = ''; S.loaded = true; render(); return; }
    S.busy = true;
    S.qerr = '';
    ask(lines).then(function (q) {
      if (mine !== S.qSeq) return null;
      S.quote = q;
      q.lines.forEach(function (l) { S.info[l.id] = l; });
      var bad = q.lines.filter(gone);
      if (!bad.length) return q;
      // Lines that can't ship or are gone get no total of their own. Ask again without them for the real numbers.
      var keep = lines.filter(function (l) { return !bad.some(function (b) { return b.id === l.id; }); });
      if (!keep.length) return null;
      return ask(keep).then(function (q2) { return mine === S.qSeq ? q2 : null; });
    }).then(function (shown) {
      if (mine !== S.qSeq) return;
      S.shown = shown;
      S.busy = false;
      S.loaded = true;
      S.qerr = '';
      render();
      announce();
    }, function (err) {
      if (mine !== S.qSeq) return;
      S.busy = false;
      S.loaded = true;
      if (err && err.code === 'country_not_available' && !retried) {
        S.country = defaultCountry(S.cfg, '');
        Bag.setCountry(S.country);
        runQuote(true);
        return;
      }
      if (err && (err.code === 'store_closed' || err.code === 'shop_not_configured')) { recheck(); return; }
      S.quote = null;
      S.shown = null;
      S.qerr = err && err.message ? err.message : SF.NET_MSG;
      render();
    });
  }

  function announce() {
    var n = SF.$('srStatus');
    if (!n) return;
    var bag = Bag.read();
    n.textContent = S.shown && S.shown.total !== null
      ? SF.plural(bagTotal(bag), 'item', 'items') + ' in your bag. Total before tax ' + SF.usd(S.shown.total) + '.'
      : SF.plural(bagTotal(bag), 'item', 'items') + ' in your bag.';
  }

  // The store may have closed while the bag was open.
  function recheck() {
    SF.config(true).then(function (cfg) {
      S.cfg = cfg;
      if (!cfg.open) showClosed(); else { S.qerr = 'Something changed. Try again.'; render(); }
    }, function () { S.qerr = SF.NET_MSG; render(); });
  }

  function defaultCountry(cfg, wanted) {
    if (SF.countryByCode(cfg, wanted)) return wanted;
    return SF.countryByCode(cfg, 'US') ? 'US' : (cfg.countries[0] ? cfg.countries[0].code : '');
  }

  // ---------- pieces ----------
  function chevron() {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2.4');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    var p = document.createElementNS(ns, 'path');
    p.setAttribute('d', 'M7 9.5l5-5 5 5M7 14.5l5 5 5-5');
    svg.appendChild(p);
    return el('span', { cls: 'chev' }, [svg]);
  }

  function lineEl(l, total) {
    var info = S.info[l.id];
    if (!info) {
      return el('div', { cls: 'ln' }, [el('div', { cls: 'ph nophoto' }), el('div', null, [el('b', { text: 'One moment…' })]), el('div', { cls: 'amt' })]);
    }
    var isGone = gone(info);
    var name = info.name || 'An item in your bag';
    var shown = name + (info.label ? ' (' + info.label + ')' : '');
    if (!photoNodes[l.id]) photoNodes[l.id] = SF.photo(info.photo, name);
    var mid = el('div', null, [el('b', { text: name }), info.label ? el('small', { text: info.label }) : el('small', { text: ' ' })]);
    var amt = el('div', { cls: 'amt', text: info.name ? SF.usd(info.unit * l.q) : '' });

    if (isGone) {
      var c = countryNow();
      var why = info.problem === 'sold_out' ? 'Sold out — remove it to check out'
        : info.problem === 'cant_ship_here' ? 'Doesn\'t ship to ' + (c ? c.name : 'this country') + ' — remove it to check out'
        : 'No longer available — remove it to check out';
      mid.appendChild(el('div', { cls: 'gonenote', id: 'note-' + l.id, text: why }));
      mid.appendChild(el('div', { cls: 'tools' }, [
        el('button', { type: 'button', cls: 'rm solid', text: 'Remove', 'data-k': 'rm:' + l.id, 'aria-label': 'Remove ' + shown + ' from your bag', on: { click: function () { removeLine(l.id); } } })
      ]));
      return el('div', { cls: 'ln gone' }, [photoNodes[l.id], mid, amt]);
    }

    var q = l.q;
    var left = info.left;
    var plusOff = q >= SF.limits.qty || total >= SF.limits.items || (left !== null && q >= left);
    var tools = el('div', { cls: 'tools' }, [
      el('div', { cls: 'qty sm' }, [
        el('button', { type: 'button', cls: 'minus', text: '−', disabled: q <= 1, 'data-k': 'minus:' + l.id, 'aria-label': 'One less ' + shown, on: { click: function () { setQty(l.id, q - 1, 'minus:' + l.id); } } }),
        el('span', { text: q }),
        el('button', { type: 'button', cls: 'plus', text: '+', disabled: plusOff, 'data-k': 'plus:' + l.id, 'aria-label': 'One more ' + shown, on: { click: function () { setQty(l.id, q + 1, 'plus:' + l.id); } } })
      ]),
      q >= SF.limits.qty ? el('span', { cls: 'cap5', text: SF.limits.qty + ' max' }) : null,
      el('button', { type: 'button', cls: 'rm', text: 'Remove', 'data-k': 'rm:' + l.id, 'aria-label': 'Remove ' + shown + ' from your bag', on: { click: function () { removeLine(l.id); } } })
    ]);
    mid.appendChild(tools);
    if (left !== null && left > 0) mid.appendChild(el('div', { cls: 'lowhint', id: 'note-' + l.id, text: 'Only ' + left + ' left' }));
    return el('div', { cls: 'ln' }, [photoNodes[l.id], mid, amt]);
  }

  function row(label, value, cls, sub, words) {
    return el('div', { cls: 'ln2' + (cls ? ' ' + cls : '') }, [
      el('span', null, [label, sub ? el('small', { text: sub }) : null]),
      el('span', { cls: words ? 'words' : null }, typeof value === 'string' ? [value] : value)
    ]);
  }

  function totalsEl(bag) {
    var cfg = S.cfg;
    var box = el('div', { cls: 'totals' + (S.busy ? ' busy' : ''), 'aria-busy': S.busy ? 'true' : 'false' });
    var sh = S.shown;
    if (!sh || sh.total === null || sh.shipping === null) return box;
    var c = countryNow();
    var pieces = sh.lines.reduce(function (n, l) { return n + l.qty; }, 0);
    box.appendChild(row('Subtotal · ' + SF.plural(pieces, 'item', 'items'), SF.usd(sh.subtotal)));
    var rule = sh.rule && sh.rule.items > 1
      ? 'Priciest item ' + SF.usdShort(sh.rule.base) + ' + ' + SF.usdShort(sh.rule.extra) + ' for each extra item' : '';
    box.appendChild(row('Shipping · ' + (c ? c.name : ''), SF.usd(sh.shipping), '', rule));
    var taxed = cfg.tax === 'calculated_at_checkout';
    if (taxed) {
      box.appendChild(el('div', { cls: 'ln2' }, [
        el('span', null, ['Tax', el('span', { cls: 'sr', text: ' is ' })]),
        el('span', { cls: 'words', text: 'calculated at checkout' })
      ]));
    }
    box.appendChild(row(taxed ? 'Total before tax' : 'Total', SF.usd(sh.total), 'tot'));
    return box;
  }

  // Can this bag go to checkout? Not while a total is being worked out, or any line has a problem.
  function blocked() {
    var q = S.quote;
    if (S.busy || S.co || S.qerr || !q || !S.shown) return true;
    return q.lines.some(function (l) { return !!l.problem; });
  }

  function renderBag(bag) {
    var cfg = S.cfg;
    var total = bagTotal(bag);
    main.className = 'wrap wide';
    SF.setTitle('Your bag');

    var lines = el('div', { cls: 'lines' });
    bag.lines.forEach(function (l) { lines.appendChild(lineEl(l, total)); });
    if (total >= SF.limits.items) lines.appendChild(el('div', { cls: 'full', text: SF.limits.items + ' items is the most in one order.' }));

    var sel = el('select', { id: 'country', 'aria-labelledby': 'shipTo', 'data-k': 'country', on: { change: function (e) { changeCountry(e.target.value); } } });
    cfg.countries.forEach(function (c) { sel.appendChild(el('option', { value: c.code, text: SF.countryLabel(c) })); });
    sel.value = S.country;

    var note = SF.countryNote(countryNow());
    var parts = [
      el('h2', { id: 'shipTo', text: 'Ship to' }),
      el('div', { cls: 'selwrap' }, [sel, chevron()]),
      el('p', { cls: 'fine soon', text: 'More countries soon.' }),
      note ? el('div', { cls: 'note', text: note }) : null
    ];
    if (S.qerr) {
      parts.push(el('div', { cls: 'err', role: 'alert' }, [el('p', { text: S.qerr })]));
      parts.push(el('button', { type: 'button', cls: 'btn small ghost', text: 'Try again', on: { click: function () { schedule(0); render(); } } }));
    } else {
      parts.push(totalsEl(bag));
    }

    var words = el('div', { cls: 'polsum' }, [RETURNS]);
    var pl = SF.policyLinks(cfg);
    if (pl) words.appendChild(pl);
    parts.push(words);

    var off = blocked();
    // A screen reader that lands on the greyed-out Checkout is told which line is in the way.
    var stuck = bag.lines.filter(function (l) { return S.info[l.id] && S.info[l.id].problem; })[0];
    parts.push(el('button', {
      type: 'button', cls: 'btn', id: 'checkoutBtn', 'data-k': 'checkout', 'aria-disabled': off ? 'true' : 'false',
      'aria-describedby': off && stuck ? 'note-' + stuck.id : null,
      text: S.co ? 'Taking you to checkout…' : 'Checkout', on: { click: checkout }
    }));
    if (S.coErr) parts.push(el('div', { cls: 'err', role: 'alert' }, [el('p', { text: S.coErr })]));
    parts.push(el('p', { cls: 'fine', text: 'You\'ll finish paying on Stripe\'s secure page. Apple Pay and cards work. No account needed: we\'ll email your receipt.' }));
    parts.push(el('div', { cls: 'hp', 'aria-hidden': 'true' }, [el('label', null, ['Website', el('input', { name: 'website', type: 'text', tabindex: '-1', autocomplete: 'off' })])]));

    SF.clear(view);
    if (cfg.visible) view.appendChild(el('a', { cls: 'crumb', href: SF.href('/shop/'), text: '← Keep shopping' }));
    view.appendChild(el('div', { cls: 'kicker', text: 'Your bag' }));
    view.appendChild(el('h1', { tabindex: '-1', text: SF.plural(total, 'item', 'items') }));
    view.appendChild(el('div', { cls: 'baggrid' }, [lines, el('div', { cls: 'summary' }, parts)]));
  }

  function renderEmpty() {
    var cfg = S.cfg;
    main.className = 'wrap wide';
    SF.setTitle('Your bag');
    SF.clear(view);
    if (cfg.visible) view.appendChild(el('a', { cls: 'crumb', href: SF.href('/shop/'), text: '← Keep shopping' }));
    view.appendChild(el('div', { cls: 'kicker', text: 'Your bag' }));
    view.appendChild(el('h1', { tabindex: '-1', text: 'Your bag is empty.' }));
    view.appendChild(el('p', { cls: 'lede', text: 'Add something from the shop and it will wait here.' }));
    view.appendChild(el('a', { cls: 'btn small', href: cfg.visible ? SF.href('/shop/') : '/', text: cfg.visible ? 'Back to the shop' : 'Back to ShowFuse' }));
  }

  function render() {
    if (!S.cfg) return;
    SF.renderNav(S.cfg, { here: 'bag' });
    var active = document.activeElement;
    var key = active && view.contains(active) ? active.getAttribute('data-k') : '';
    var bag = Bag.read();
    if (!bag.lines.length) { renderEmpty(); if (S.focus === 'heading') SF.focusHeading(view); S.focus = ''; return; }
    if (!S.loaded) { loading(); return; }
    if (S.cfg && S.country !== bag.country) Bag.setCountry(S.country);
    renderBag(bag);
    var want = S.focus || key;
    S.focus = '';
    if (want === 'heading') { SF.focusHeading(view); return; }
    if (want) {
      var t = view.querySelector('[data-k="' + want.replace(/"/g, '') + '"]');
      if (t && !t.disabled) { try { t.focus({ preventScroll: true }); } catch (e) { t.focus(); } }
    }
  }

  function loading() {
    main.className = 'wrap wide';
    SF.clear(view);
    view.appendChild(el('p', { cls: 'lede', role: 'status' }, [el('span', { cls: 'spin', 'aria-hidden': 'true' }), 'One sec…']));
  }

  function showClosed() {
    SF.setTitle('The shop isn\'t open yet');
    SF.clear(view);
    SF.closedPage(main).forEach(function (n) { view.appendChild(n); });
    SF.renderNav(null, { here: 'bag' });
    SF.focusHeading(view);
  }

  function showError(err) {
    main.className = 'wrap';
    SF.setTitle('Your bag');
    SF.clear(view);
    [el('div', { cls: 'kicker', text: 'Your bag' }), el('h1', { tabindex: '-1', text: 'We couldn\'t load your bag.' })]
      .concat(SF.errorBlock(err && err.message ? err.message : SF.NET_MSG, start)).forEach(function (n) { if (n) view.appendChild(n); });
    SF.focusHeading(view);
  }

  // ---------- what people do ----------
  function setQty(id, qty, focus) {
    var info = S.info[id];
    var max = SF.limits.qty;
    if (info && info.left !== null) max = Math.min(max, info.left);
    qty = Math.max(1, Math.min(qty, Math.max(max, 1)));
    Bag.setQty(id, qty);
    S.coErr = '';
    S.focus = focus || '';
    schedule(300);
    render();
  }
  function removeLine(id) {
    Bag.remove(id);
    S.coErr = '';
    S.focus = 'heading';
    schedule(Bag.read().lines.length ? 0 : 0);
    render();
  }
  function changeCountry(code) {
    if (!SF.countryByCode(S.cfg, code)) return;
    S.country = code;
    Bag.setCountry(code);
    S.coErr = '';
    S.quote = null;
    S.shown = null;
    // Whatever the last answer said about a country no longer applies.
    Object.keys(S.info).forEach(function (k) { S.info[k].problem = null; });
    S.focus = 'country';
    schedule(0);
    render();
  }

  // The Stripe page, or (dev fake only) a page on this site.
  function paymentUrl(u) {
    if (typeof u !== 'string') return null;
    try {
      var x = new URL(u, window.location.href);
      if (x.protocol === 'https:' && x.hostname === 'checkout.stripe.com') return x.href;
      if (SF.Base.fake && x.origin === window.location.origin) return x.href;
    } catch (e) { /* not a web address */ }
    return null;
  }

  function checkoutFailed(message) {
    S.co = false;
    S.coErr = message;
    render();
  }

  function checkout() {
    if (S.co || blocked()) return;
    S.co = true;
    S.coErr = '';
    render();
    var bag = Bag.read();
    bag.country = S.country;
    var items = bag.lines.map(function (l) { return { variant_id: l.id, qty: l.q }; });
    function send(fresh) {
      var key = Bag.checkoutKey(bag, fresh);
      return SF.afterMinTime().then(function () {
        return SF.request('POST', '/v1/shop/checkout', { json: SF.withBot({ country: S.country, items: items, source: 'web', checkout_key: key }) });
      });
    }
    send(false).catch(function (err) {
      // An old attempt used this key (or a different bag did): make a new key and go again, once.
      if (err && (err.code === 'checkout_key_used' || err.code === 'checkout_key_conflict')) return send(true);
      throw err;
    }).then(function (res) {
      var url = paymentUrl(res && res.url);
      if (!url) { checkoutFailed('We couldn\'t open the payment page. Try again.'); return; }
      window.location.assign(url);   // the page stays as it is until the browser leaves
    }, function (err) {
      var code = err && err.code;
      if (code === 'store_closed' || code === 'shop_not_configured') { recheck(); S.co = false; return; }
      S.co = false;
      S.coErr = err && err.message ? err.message : SF.NET_MSG;
      if (code === 'sold_out' || code === 'item_unavailable' || code === 'cant_ship_here') { render(); schedule(0); render(); return; }
      if (code === 'country_not_available') { S.country = defaultCountry(S.cfg, ''); Bag.setCountry(S.country); render(); schedule(0); render(); return; }
      render();
    });
  }

  // ---------- start ----------
  var seq = 0;
  function start() {
    var mine = ++seq;
    S.loaded = false;
    S.co = false;
    loading();
    SF.config(true).then(function (cfg) {
      if (mine !== seq) return;
      S.cfg = cfg;
      SF.renderFooter(cfg);
      if (!cfg.open || !cfg.countries.length) { showClosed(); return; }
      var bag = Bag.read();
      S.country = defaultCountry(cfg, bag.country);
      if (!bag.lines.length) { S.loaded = true; render(); return; }
      runQuote();
    }, function (err) {
      if (mine !== seq) return;
      SF.renderNav(null, { here: 'bag' });
      SF.renderFooter(null);
      showError(err);
    });
  }

  start();
  // Another tab changed the bag.
  window.addEventListener('storage', function (e) { if (e.key === 'sf_bag_v1' && S.cfg && S.loaded) { schedule(200); render(); } });
  // Back from Stripe (or any back/forward) can bring this page back mid-checkout. Start fresh.
  window.addEventListener('pageshow', function (e) { if (e.persisted) start(); });
})();
