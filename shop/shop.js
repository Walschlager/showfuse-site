/* ShowFuse: /shop/ (the shop window). Built against docs/SHOP_API.md.
   Asks GET /v1/shop/config first. Not visible: "The shop isn't open yet." Visible: the products
   from GET /v1/shop/products. Server text always goes in with textContent. */
(function () {
  'use strict';
  var SF = window.SFShop;
  if (!SF) return;
  var el = SF.el;
  var view = SF.$('view');
  var main = SF.$('main');

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

  function showError(err) {
    main.className = 'wrap';
    SF.setTitle('Merch');
    put([
      el('div', { cls: 'kicker', text: 'ShowFuse merch' }),
      el('h1', { tabindex: '-1', text: 'We couldn\'t load the shop.' })
    ].concat(SF.errorBlock(err && err.message ? err.message : SF.NET_MSG, start)));
    SF.focusHeading(view);
  }

  // "Only 3 left" on a card: only when every size that is still in stock is running low.
  function leftLabel(p, lowAt) {
    var inStock = p.sizes.filter(function (s) { return !s.soldOut; });
    if (!inStock.length) return '';
    var total = 0;
    for (var i = 0; i < inStock.length; i++) {
      if (inStock[i].left === null) return '';
      total += inStock[i].left;
    }
    return total >= 1 && total <= lowAt ? 'Only ' + total + ' left' : '';
  }

  function card(p, cfg, index) {
    var soon = p.status === 'coming_soon';
    var sold = !soon && p.soldOut;
    var a = el('a', {
      cls: 'pc' + (sold ? ' sold' : '') + (soon ? ' soon' : ''),
      href: SF.href('/shop/p/?s=' + encodeURIComponent(p.slug))
    });
    var ph = SF.photo(p.photos[0], p.name, 'ph', index >= 4);
    // The tags over the photo: Sold out or Coming soon at the left, DEMO at the right (see .tags in shop.css).
    var tags = [];
    if (sold) tags.push(el('div', { cls: 'sticker', text: 'Sold out' }));
    if (soon) tags.push(el('div', { cls: 'sticker soon', text: 'Coming soon' }));
    if (p.demo) tags.push(SF.demoStamp());
    if (tags.length) ph.appendChild(el('div', { cls: 'tags' + (tags.length > 1 ? ' two' : '') }, tags));
    var price;
    if (soon) price = el('div', { cls: 'pr', text: 'Coming soon' });
    else if (sold) price = el('div', { cls: 'pr', text: 'Sold out' });
    else {
      price = el('div', { cls: 'pr' }, [SF.usd(p.priceCents), el('small', { text: 'USD' })]);
      // "Only 3 left" nudges a buyer; in showcase nobody can buy, so it is left out.
      var left = cfg.showcase ? '' : leftLabel(p, cfg.lowStockAt);
      if (left) price.appendChild(el('span', { cls: 'left', text: left }));
    }
    var tx = el('div', { cls: 'tx' }, [el('b', { text: p.name }), p.blurb ? el('small', { text: p.blurb }) : null, price]);
    a.appendChild(ph);
    a.appendChild(tx);
    return a;
  }

  function showGrid(cfg, products) {
    main.className = 'wrap wide';
    SF.setTitle('Merch');
    var where = cfg.countries.map(SF.countryShort);
    var grid = el('div', { cls: 'pgrid' });
    products.forEach(function (p, i) { grid.appendChild(card(p, cfg, i)); });
    // Showcase: the shop can be looked at and nothing can be bought, so no words about shipping or a bag. The note is the app's
    // line for this state, except that its second sentence says where the I WANT THIS button is (in the ShowFuse app): the
    // button is the app's, this website has none, so it must not tell anyone to tap one here.
    var intro = cfg.showcase
      ? [el('p', { cls: 'lede', text: 'Hoodies, tees and hats from ShowFuse.' }),
         el('div', { cls: 'shipnote' }, [el('div', null, [
           el('b', { text: 'Nothing is for sale yet.' }),
           el('small', { text: 'Tap I WANT THIS in the ShowFuse app on what you\'d wear.' })
         ])])]
      : [el('p', { cls: 'lede', text: 'Hoodies, tees and hats from ShowFuse. We ship to ' + SF.joinList(where) + '.' }),
         el('div', { cls: 'shipnote' }, [el('div', null, [
           el('b', { text: 'Ships to ' + where.join(' + ') + '.' }),
           el('small', { text: 'Prices are in US dollars. Shipping is worked out in your bag.' })
         ])])];
    // The heading is the page's name, so there is no small "ShowFuse merch" line above it (it would only say the same thing).
    put([
      el('h1', { tabindex: '-1', text: 'ShowFuse merch' })
    ].concat(intro, [grid]));
  }

  var seq = 0;
  function start() {
    var mine = ++seq;
    loading();
    SF.config(true).then(function (cfg) {
      if (mine !== seq) return null;
      SF.renderNav(cfg, { here: 'shop' });
      SF.renderFooter(cfg);
      if (!cfg.visible) { showClosed(); return null; }
      return SF.request('GET', '/v1/shop/products').then(function (res) {
        if (mine !== seq) return;
        var list = (res && Array.isArray(res.products) ? res.products : []).map(SF.normalizeProduct).filter(Boolean);
        if (!list.length) showClosed(); else showGrid(cfg, list);
      });
    }).catch(function (err) {
      if (mine !== seq) return;
      // No clear answer from the server: no shop doors, and an honest "couldn't load".
      SF.renderNav(null, { here: 'shop' });
      SF.renderFooter(null);
      showError(err);
    });
  }

  start();
  // Back or forward can bring this page back as it was. Ask again, so a closed store never lingers.
  window.addEventListener('pageshow', function (e) { if (e.persisted) start(); });
})();
