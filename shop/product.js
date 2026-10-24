/* ShowFuse: /shop/p/?s=<slug> (one product). Built against docs/SHOP_API.md.
   Photos, price in USD, size, quantity, Add to bag, and the shipping and returns words.
   ?preview=<token> (from the dashboard's preview link) shows a product that isn't on sale yet,
   without any way to buy it. Server text always goes in with textContent. */
(function () {
  'use strict';
  var SF = window.SFShop;
  if (!SF) return;
  var el = SF.el, Bag = SF.Bag;
  var view = SF.$('view');
  var main = SF.$('main');

  function query(name) {
    var m = new RegExp('(?:^|[?&])' + name + '=([^&]*)').exec(location.search);
    if (!m) return '';
    try { return decodeURIComponent(m[1].replace(/\+/g, ' ')); } catch (e) { return ''; }
  }
  var slug = query('s');
  var preview = query('preview').slice(0, 80);

  function loading() {
    main.className = 'wrap wide';
    SF.clear(view);
    view.appendChild(el('p', { cls: 'lede', role: 'status' }, [el('span', { cls: 'spin', 'aria-hidden': 'true' }), 'One sec…']));
  }
  function put(nodes) {
    SF.clear(view);
    nodes.forEach(function (n) { if (n) view.appendChild(n); });
  }
  function showClosed() {
    SF.setTitle('The shop isn\'t open yet');
    put(SF.closedPage(main));
    SF.focusHeading(view);
  }
  function showNotFound(cfg) {
    main.className = 'wrap';
    SF.setTitle('Merch');
    var open = cfg && cfg.visible;
    put([
      el('div', { cls: 'kicker', text: 'ShowFuse merch' }),
      el('h1', { tabindex: '-1', text: 'We couldn\'t find that product.' }),
      el('p', { cls: 'lede', text: 'The link may be old, or the item may be gone.' }),
      el('a', { cls: 'btn small ghost', href: open ? SF.href('/shop/') : '/', text: open ? 'Back to the shop' : 'Back to ShowFuse' })
    ]);
    SF.focusHeading(view);
  }
  function showError(err) {
    main.className = 'wrap';
    SF.setTitle('Merch');
    put([
      el('div', { cls: 'kicker', text: 'ShowFuse merch' }),
      el('h1', { tabindex: '-1', text: 'We couldn\'t load this product.' })
    ].concat(SF.errorBlock(err && err.message ? err.message : SF.NET_MSG, start)));
    SF.focusHeading(view);
  }

  // "Packed within 3 business days; arrives in about 5 to 10 business days (US) or 7 to 14 business days (Canada).
  //  Problems are fully covered; one size exchange within 30 days."
  function shippingWords(cfg, p) {
    var to = cfg.countries.filter(function (c) { return p.shipsTo.indexOf(c.code) >= 0; });
    var lead = to.length >= 2 ? 'Ships to ' + SF.joinList(to.map(SF.countryShort)) + '. ' : '';
    var bits = [];
    if (cfg.packTime) bits.push('Packed within ' + cfg.packTime);
    var times = to.filter(function (c) { return c.delivery; });
    if (times.length) {
      var same = times.every(function (c) { return c.delivery === times[0].delivery; });
      if (same || times.length === 1) {
        bits.push('arrives in about ' + times[0].delivery);
      } else {
        // "5 to 10 business days (US) or 7 to 14 (Canada)": the unit is said once.
        var unit = /(business days?)$/.exec(times[0].delivery);
        var each = times.map(function (c, i) {
          var d = c.delivery;
          if (i > 0 && unit && /(business days?)$/.test(d) && /(business days?)$/.exec(d)[1] === unit[1]) d = d.slice(0, d.length - unit[1].length - 1);
          return d + ' (' + (c.code === 'US' ? 'US' : c.name) + ')';
        });
        bits.push('arrives in about ' + each.slice(0, -1).join(', ') + ' or ' + each[each.length - 1]);
      }
    }
    var first = bits.join('; ');
    if (first) first = first.charAt(0).toUpperCase() + first.slice(1) + '. ';
    // A final-sale item says so (the approved words of the picker), instead of the one-size-exchange sentence that would contradict it.
    return lead + first + (p.finalSale ? 'Final sale, so it can\'t be returned.' : 'Problems are fully covered; one size exchange within 30 days.');
  }

  function showProduct(cfg, p) {
    main.className = 'wrap wide';
    SF.setTitle(p.name);

    var soon = p.status === 'coming_soon';
    var showcase = !!cfg.showcase;   // the shop can be looked at; nothing can be bought
    var selling = !p.preview && (p.status === 'live' || p.status === 'unlisted');
    // The server says buyable: never in showcase, and never for a demo item on a real store. On the practice server a demo
    // item is bought like any other (it is the whole test shop there), so the page does not second-guess the flag.
    var canBuy = selling && cfg.open && p.buyable && p.shipsTo.length > 0;
    var multi = p.sizes.length > 1;
    var S = { size: null, qty: 1, photo: 0 };
    if (canBuy && p.sizes.length === 1 && !p.sizes[0].soldOut) S.size = p.sizes[0];

    // ----- photos -----
    var big = el('div', { cls: 'big' });
    var thumbs = null;
    var thumbBtns = [];
    function photoAlt(i) { return p.name + (p.photos.length > 1 ? ', photo ' + (i + 1) + ' of ' + p.photos.length : ''); }
    function showPhoto(i) {
      S.photo = i;
      SF.clear(big);
      var bp = SF.photo(p.photos[i], photoAlt(i));
      if (p.demo) bp.appendChild(SF.demoStamp('big'));
      if (p.finalSale) bp.appendChild(el('div', { cls: 'fs onphoto', text: 'Final sale' }));   // the same tag as on the order, on the photo as in the app
      big.appendChild(bp);
      thumbBtns.forEach(function (b, k) {
        b.className = 'th' + (k === i ? ' on' : '');
        b.setAttribute('aria-pressed', k === i ? 'true' : 'false');
      });
    }
    if (p.photos.length > 1) {
      thumbs = el('div', { cls: 'thumbs' });
      p.photos.forEach(function (u, i) {
        var tp = SF.photo(u, '', 'ph', true);
        if (p.demo) tp.appendChild(SF.demoStamp('thumb'));
        var b = el('button', { type: 'button', cls: 'th', 'aria-label': 'Show photo ' + (i + 1) + ' of ' + p.photos.length, on: { click: function () { showPhoto(i); } } }, [tp]);
        thumbBtns.push(b);
        thumbs.appendChild(b);
      });
    }
    var gal = el('div', { cls: 'gal' }, [big, thumbs]);

    // ----- the buying part -----
    var right = el('div');
    right.appendChild(el('div', { cls: 'kicker', text: 'ShowFuse merch' }));
    right.appendChild(el('h1', { tabindex: '-1', text: p.name }));
    right.appendChild(soon
      ? el('div', { cls: 'price soon', text: 'Coming soon' })
      : el('div', { cls: 'price' }, [SF.usd(p.priceCents), el('small', { text: 'USD' })]));

    // "Ships to the United States only": a product that skips some country we ship to.
    var skipped = cfg.countries.filter(function (c) { return p.shipsTo.indexOf(c.code) < 0; });
    var only = cfg.countries.filter(function (c) { return p.shipsTo.indexOf(c.code) >= 0; });
    if (showcase) { /* nothing ships in showcase, so there is nothing to say about where */ }
    else if (p.shipsTo.length === 0) right.appendChild(el('p', { cls: 'quiet', text: 'We can\'t ship this anywhere right now.' }));
    else if (skipped.length) right.appendChild(el('p', { cls: 'quiet', text: 'Ships to ' + SF.joinList(only.map(SF.countryLong)) + ' only' }));

    var desc = p.description || p.blurb;
    if (desc) right.appendChild(el('p', { cls: 'lede', text: desc }));
    // The approved line of the final-sale product page (returns mockup, screen 7a).
    if (p.finalSale) right.appendChild(el('p', { cls: 'fsline' }, [el('b', { text: 'Final sale.' }), ' This item can\'t be returned, like other limited or signed items. A damaged or wrong item can still always be fixed.']));
    if (p.preview) right.appendChild(el('p', { cls: 'note', text: 'Preview. This is how the page will look. It isn\'t on sale, so there is nothing to buy here.' }));

    var sizeBtns = [];
    var qtyNum = el('span', { text: '1', 'aria-live': 'polite' });
    var minus = null, plus = null, addBtn = null;
    var hint = el('span', { cls: 'lowhint' });
    var cap = el('span', { cls: 'cap5' });
    var pick = el('p', { cls: 'pickmsg', role: 'alert' });

    function refresh() {
      sizeBtns.forEach(function (x) {
        var on = !!S.size && x.size.id === S.size.id;
        x.btn.className = 's' + (on ? ' on' : '') + (x.size.soldOut ? ' off' : '');
        x.btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      if (!canBuy) return;
      var room = Bag.room(S.size ? S.size.id : null, S.size ? S.size.left : null);
      if (S.qty > room.n) S.qty = Math.max(1, room.n);
      qtyNum.textContent = String(S.qty);
      minus.disabled = S.qty <= 1;
      plus.disabled = S.qty >= room.n;
      hint.textContent = S.size && S.size.left !== null && S.size.left > 0
        ? 'Only ' + S.size.left + ' left' + (multi ? ' in ' + S.size.label : '') : '';
      hint.hidden = !hint.textContent;
      var atCap = S.qty >= room.n;
      cap.textContent = atCap && room.why === 'order' ? SF.limits.items + ' items is the most in one order.'
        : atCap && room.why === 'line' ? SF.limits.qty + ' max' : '';
      cap.hidden = !cap.textContent;
      addBtn.setAttribute('aria-disabled', room.n < 1 ? 'true' : 'false');
    }

    function choose(size) {
      if (size.soldOut) return;
      S.size = size;
      pick.textContent = '';
      refresh();
    }

    if (canBuy || soon || p.soldOut) {
      var sizesBox = el('div', { cls: 'sizes', role: 'group', 'aria-label': 'Size' });
      p.sizes.forEach(function (size) {
        var b = el('button', {
          type: 'button', cls: 's', disabled: !canBuy || size.soldOut,
          'aria-label': size.label + (size.soldOut ? ', sold out' : ''), text: size.label,
          on: { click: function () { choose(size); } }
        });
        sizeBtns.push({ size: size, btn: b });
        sizesBox.appendChild(b);
      });
      if (p.sizes.length && !soon && !showcase) {
        right.appendChild(el('div', { cls: 'field' }, [el('label', { text: 'Size' }), sizesBox, pick]));
      }
    }

    if (canBuy) {
      minus = el('button', { type: 'button', cls: 'minus', 'aria-label': 'One less', text: '−', on: { click: function () { if (S.qty > 1) { S.qty--; refresh(); } } } });
      plus = el('button', { type: 'button', cls: 'plus', 'aria-label': 'One more', text: '+', on: { click: function () { S.qty++; refresh(); } } });
      right.appendChild(el('div', { cls: 'field' }, [
        el('label', { text: 'Quantity' }),
        el('div', { cls: 'row2' }, [el('div', { cls: 'qty' }, [minus, qtyNum, plus]), hint, cap])
      ]));
      addBtn = el('button', { type: 'button', cls: 'btn', text: 'Add to bag', 'aria-disabled': 'false', on: { click: add } });
      right.appendChild(addBtn);
    } else {
      var why = p.preview ? 'Preview only' : soon ? 'Coming soon' : p.soldOut ? 'Sold out' : showcase ? 'Not on sale yet' : 'Not on sale';
      right.appendChild(el('button', { type: 'button', cls: 'btn', text: why, 'aria-disabled': 'true' }));
    }

    if (!showcase) {
      var words = el('div', { cls: 'polsum' }, [shippingWords(cfg, p)]);
      var links = SF.policyLinks(cfg, 'roomy');
      if (links) words.appendChild(links);
      right.appendChild(words);
    }

    function add() {
      if (!S.size) {
        pick.textContent = 'Pick a size.';
        var first = sizeBtns.filter(function (x) { return !x.size.soldOut; })[0];
        if (first) first.btn.focus();
        return;
      }
      var room = Bag.room(S.size.id, S.size.left);
      if (room.n < 1) { refresh(); return; }
      Bag.add(S.size.id, Math.min(S.qty, room.n));
      // Like the approved page: Add to bag takes you to the bag.
      window.location.assign(SF.href('/shop/bag/'));
    }

    put([
      cfg.visible ? el('a', { cls: 'crumb', href: SF.href('/shop/'), text: '← All merch' }) : null,
      el('div', { cls: 'pdp' }, [gal, right])
    ]);
    showPhoto(0);
    refresh();
  }

  var seq = 0;
  function start() {
    var mine = ++seq;
    loading();
    var validSlug = /^[a-z0-9][a-z0-9_-]{1,39}$/.test(slug);
    var cfgP = SF.config(true).then(function (c) { return { cfg: c }; }, function (e) { return { fail: e }; });
    var prodP = validSlug
      ? SF.request('GET', '/v1/shop/products/' + slug + (preview ? '?preview=' + encodeURIComponent(preview) : ''))
        .then(function (j) { return { product: SF.normalizeProduct(j) }; }, function (e) { return { fail: e }; })
      : Promise.resolve({ fail: { status: 404, code: 'not_found', message: '' } });
    Promise.all([cfgP, prodP]).then(function (r) {
      if (mine !== seq) return;
      var c = r[0], p = r[1];
      var cfg = c.cfg || null;
      SF.renderNav(cfg, { here: 'shop' });
      SF.renderFooter(cfg);
      if (c.fail) { showError(c.fail); return; }
      if (p.product) { showProduct(cfg, p.product); return; }
      var f = p.fail || { status: 404 };
      if (f.status === 404) {
        // Unknown link, or a closed store (a closed store answers every product with 404).
        // Showcase is visible: there a 404 is just an unknown product.
        if (!cfg.visible && !preview) showClosed(); else showNotFound(cfg);
        return;
      }
      showError(f);
    });
  }

  start();
  window.addEventListener('pageshow', function (e) { if (e.persisted) start(); });
})();
