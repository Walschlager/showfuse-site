/* DEV ONLY: a fake shop API so every shop page can be clicked through without a server, and without
   Stripe. base.js loads this only with ?fake=1 (or ?fake=checkout) on localhost, and it checks again
   below, so it never runs on showfuseapp.com. It follows docs/SHOP_API.md: same limits, same errors,
   same shipping rule, same product shape.

   ?fake=1          every shop call is answered here
   ?fake=checkout   config, products and quote go to the real local API; only checkout, cancel and
                    order are answered here, so nothing can ever reach Stripe

   Cheat sheet (the ?name=value switches ride along on the links between pages)
   shop=closed      the store switch is off: config says open false
   shop=linkonly    open, but nothing is listed (only /shop/p/?s=m_beanie works), like the $1 test product
   shop=error       config fails (503)
   shop=none        config answers 404, like a server that doesn't have the shop yet (shows the closed page)
   shop=showcase    mode "showcase": the shop can be looked at, nothing can be bought (no Bag link, no Add to bag, no Checkout)
   shop=showcasemin the same, but config is only { mode, open: false, visible: true }
   shop=nomode      an older server: config has no "mode" at all (open + visible still decide)
   shop=weirdmode   config says mode "sale", open and visible: a mode the page doesn't know, so it stays closed
   demo=1           the Emblem Hoodie (Coming soon) is a DEMO item: a DEMO tag on its photos
   demo=live        ...and so is the Fuse Hoodie, which is on sale and buyable (like the practice server): the page lets it be bought
   demo=all         all eight items are demo items, and config says test_mode (the practice server's look)
   demo=real        all eight are demo items and all are Coming soon (a real store's seed); best with shop=showcase
   tax=none         the bag has no tax line (config says tax: none)
   pay=paid         Checkout "pays" and lands on the thank-you page (default)
   pay=pending      ...lands on the thank-you page while the payment is still being confirmed
   pay=cancel       ...lands on the cancelled page instead
   co=soldout       Checkout fails: 409 sold_out    co=noship  409 cant_ship_here   co=gone  409 item_unavailable
   co=closed        409 store_closed                co=rate    429                  co=stripe  502 payment_unavailable
   co=toomany       409 too_many_open_checkouts     co=key     409 checkout_key_used once, then it works
   co=slow          Checkout takes 3 seconds        co=bad     the link in the answer is not Stripe's (the page must refuse it)
   evil=1           HTML and script-looking text in every server string, to prove it only ever shows as text
   nobadge=1        hides the small FAKE API badge (for clean screenshots)

   Order links  /shop/thanks/?n=SF-1042&t=...  and  /shop/order/?n=SF-1042&t=...
   t=fake-paid | fake-pending (pending twice, then paid) | fake-shipped | fake-refunded | fake-expired
   t=fake-canada (paid, to Canada) | fake-slow (paid after 4 seconds) | fake-fail (the call fails) | anything else: not found
   Cancel link  /shop/cancelled/?n=SF-1042&t=fake-cancel | fake-cancel-again (opened a second time) | fake-paid-cancel (already paid)
                | fake-pending-cancel | anything else: not found

   Returns (build 14, docs/BUILD_14_API_CONTRACT.md). The demo order SF-1002 is a shipped order of a Fuse Hoodie, two Pro Beanies and a Pro Tee
   (final sale), $168.50, shipped Oct 16 with the return window open until Nov 15. One order link per state:
   t=fake-ret-none (can be returned, no request yet) | fake-ret-requested | fake-ret-approved (our mistake, we pay) | fake-ret-approved-buyer (they pay)
   | fake-ret-shipped | fake-ret-received | fake-ret-problem | fake-ret-refunded | fake-ret-custom (refunded, one typed amount) | fake-ret-declined
   | fake-ret-cancelled | fake-ret-expired | fake-ret-closed | fake-ret-two (two requests) | fake-ret-final (SF-1031: everything final sale)
   | fake-ret-window (closed Nov 15) | fake-ret-unshipped (paid, not shipped)
   Everything on the request routes works in this page's life: ask, add photos, track, cancel. The orders above change as you go.
   ret=rate (429 rate_limited)   ret=toofast (400 too_fast)   ret=rejected (400)   ret=window (409 return_window_closed)   ret=final (409 final_sale)
   ret=nothing (409 nothing_to_return)   ret=toomany (409 too_many_open_returns)   ret=busy (503)   ret=slow (the request takes 3 seconds)
   ret=photo413 | photo415 | photomany | photolimit | photo429 | photo503   photo upload answers   ret=wrongstate (409 return_wrong_state on track/cancel)
   shop=noreturns   config has no "returns" block (an older server, or the store off): the form falls back to the six standard reasons

   Product photos are /shop/dev-photos/<slug>.jpg. They are NOT in the site's files (the demo merch isn't
   public). Without them the pages show their quiet "no photo" blocks. */
(function () {
  'use strict';
  var host = location.hostname;
  var mode = (/(?:^|[?&])fake=(1|checkout)(?:&|$)/.exec(location.search) || [])[1];
  if (!(host === 'localhost' || host === '127.0.0.1') || !mode) return;

  var Base = window.SFBase || {};
  var API = Base.api;
  var realFetch = window.fetch.bind(window);
  function flag(name) {
    var m = new RegExp('(?:^|[?&])' + name + '=([^&]*)').exec(location.search);
    return m ? decodeURIComponent(m[1]) : '';
  }
  var SHOP = flag('shop'), TAX = flag('tax'), PAY = flag('pay'), CO = flag('co'), RET = flag('ret'), EVIL = flag('evil') === '1', DEMO = flag('demo');
  // ?evil=1 puts HTML and script-looking text in every server string (names, notes, messages, links, photo
  // addresses), to prove the pages show it as plain text and never run it. window.__pwned must stay unset.
  var n = 0;
  function E(s) { return EVIL ? '<img src=x onerror="window.__pwned=' + (++n) + '"><b>' + s + '</b> "q" & <script>window.__pwned=99</script>' : s; }

  // ---------- the catalog ----------
  function pad(n, w) { var s = String(n); while (s.length < w) s = '0' + s; return s; }
  function vid(p, s) { return 'c0de' + pad(p, 4) + '-' + pad(s, 4) + '-4000-8000-000000000000'; }
  function pid(p) { return '5a1f' + pad(p, 4) + '-0000-4000-8000-000000000000'; }
  var ZONES = {
    US: { id: '7d7c0000-0000-4000-8000-000000000001', name: 'United States', extra: 200, delivery: '5 to 10 business days', note: null, excluded: [] },
    CA: { id: '0b190000-0000-4000-8000-000000000002', name: 'Canada', extra: 300, delivery: '7 to 14 business days', note: 'Import taxes and duties are not included.', excluded: ['QC'] }
  };
  var S5 = ['S', 'M', 'L', 'XL', 'XXL'], ONE = ['One size'];
  var CATALOG = [
    { slug: 'm_hoodie', name: 'Fuse Hoodie', blurb: 'Heavyweight black, two-tone wordmark', price: 6500, ship: { US: 800, CA: 1400 }, sizes: S5, stock: { L: 3, XXL: 0 },
      desc: 'Heavyweight black fleece with the two-tone SHOWFUSE wordmark across the chest. Ribbed cuffs, kangaroo pocket.', photos: ['m_hoodie', 'm_hoodie_emblem', 'm_hoodie_pro_back'] },
    { slug: 'm_hoodie_pro', name: 'Pro Hoodie', blurb: 'Wordmark + the Pro star', price: 7000, ship: { US: 800, CA: 1400 }, sizes: S5, all: 0,
      desc: 'Black hoodie with the wordmark and the Pro star.', photos: ['m_hoodie_pro'] },
    { slug: 'm_hoodie_pro_back', name: 'Pro Block Hoodie', blurb: 'Oversized PRO block across the back', price: 7000, ship: { US: 800, CA: 1400 }, sizes: S5,
      desc: 'Oversized PRO block across the back.', photos: ['m_hoodie_pro_back'] },
    { slug: 'm_hoodie_emblem', name: 'Emblem Hoodie', blurb: 'Small fuse emblem, left chest', price: 6500, ship: { US: 800, CA: 1400 }, sizes: S5, status: 'coming_soon',
      desc: 'Black hoodie with the small fuse emblem on the left chest.', photos: ['m_hoodie_emblem'] },
    { slug: 'm_tee', name: 'Emblem Tee', blurb: 'Soft cotton, fuse emblem on the chest', price: 3200, ship: { US: 500, CA: 1100 }, sizes: S5, stock: { M: 2 },
      desc: 'Soft cotton tee with the fuse emblem on the chest.', photos: ['m_tee'] },
    { slug: 'm_tee_pro', name: 'Pro Tee', blurb: 'PRO block, centre chest', price: 3400, ship: { US: 500, CA: null }, sizes: S5,
      desc: 'Soft cotton tee with the PRO block across the centre chest.', photos: ['m_tee_pro', 'm_tee'] },
    { slug: 'm_hat', name: 'Pro Cap', blurb: 'Distressed black, embroidered PRO', price: 3500, ship: { US: 500, CA: 900 }, sizes: ONE, stock: { 'One size': 3 },
      desc: 'Distressed black cap with embroidered PRO.', photos: ['m_hat'] },
    { slug: 'm_beanie', name: 'Pro Beanie', blurb: 'Ribbed cuff, woven PRO label', price: 2800, ship: { US: 500, CA: 900 }, sizes: ONE,
      desc: 'Ribbed-cuff beanie with a woven PRO label.', photos: ['m_beanie'] }
  ];
  var VARIANTS = {};   // variant id -> { product, label, stock }
  CATALOG.forEach(function (p, pi) {
    p.id = pid(pi + 1);
    p.status = p.status || 'live';
    p.variants = p.sizes.map(function (label, si) {
      var stock = p.all !== undefined ? p.all : (p.stock && p.stock[label] !== undefined ? p.stock[label] : 25);
      var v = { id: vid(pi + 1, si + 1), label: label, stock: stock, product: p, sku: p.slug.toUpperCase().replace(/_/g, '-') + '-' + label.toUpperCase().replace(/ /g, '') };
      VARIANTS[v.id] = v;
      return v;
    });
  });
  function bySlug(slug) { for (var i = 0; i < CATALOG.length; i++) if (CATALOG[i].slug === slug) return CATALOG[i]; return null; }
  function photoUrl(name) {
    if (EVIL) return name === 'm_hoodie' ? 'javascript:window.__pwned=3' : 'https://evil.example/a.jpg';
    return '/shop/dev-photos/' + name + '.jpg';
  }
  function L(s) { return EVIL ? '<i>' + s + '</i>' : s; }

  var LOW = 5;
  // Demo items, as the real server has them (docs/SHOP_API.md, "Demo products"):
  //   demo=1     the Emblem Hoodie (Coming soon) is a DEMO item
  //   demo=live  ...and so is the Fuse Hoodie, which is on sale and buyable: like the practice server, where a demo item is
  //              bought like any other. The page must let it be added to the bag (the server says buyable, the page follows)
  //   demo=all   all eight are demo items, statuses as in this fake, and config says test_mode: the practice server's look
  //   demo=real  all eight are demo items and all are Coming soon: a real store's seed (best seen with shop=showcase)
  var ALL_SLUGS = ['m_hoodie', 'm_hoodie_pro', 'm_hoodie_pro_back', 'm_hoodie_emblem', 'm_tee', 'm_tee_pro', 'm_hat', 'm_beanie'];
  var DEMO_SLUGS = DEMO === '1' ? ['m_hoodie_emblem'] : DEMO === 'live' ? ['m_hoodie_emblem', 'm_hoodie'] : (DEMO === 'all' || DEMO === 'real') ? ALL_SLUGS : [];
  // A real store's demo items are all Coming soon, whatever the catalog above says.
  function statusOf(p) { return DEMO === 'real' ? 'coming_soon' : p.status; }
  function publicProduct(p, preview) {
    var sizes = p.variants.map(function (v) { return { id: v.id, label: L(v.label), sold_out: v.stock <= 0, left: v.stock <= LOW ? v.stock : null }; });
    var any = sizes.some(function (s) { return !s.sold_out; });
    var shipping = Object.keys(ZONES).map(function (c) { return { zone_id: ZONES[c].id, ships: typeof p.ship[c] === 'number', price_cents: typeof p.ship[c] === 'number' ? p.ship[c] : null }; });
    var demo = DEMO_SLUGS.indexOf(p.slug) >= 0;
    // a demo item shows three pictures, so the stamp can be seen on the thumbnails too
    var photos = demo && p.photos.length < 3 ? p.photos.concat(['m_hoodie', 'm_hoodie_pro_back']).slice(0, 3) : p.photos;
    return {
      id: p.id, slug: p.slug, name: E(p.name), blurb: E(p.blurb), description: E(p.desc), price_cents: p.price, currency: 'USD',
      photos: photos.map(photoUrl), status: statusOf(p), buyable: !preview && !showcaseOn() && sellable(p) && any, demo: demo,
      sold_out: !any, sizes: sizes, shipping: shipping,
      ships_to: Object.keys(ZONES).filter(function (c) { return typeof p.ship[c] === 'number'; }), preview: !!preview
    };
  }

  // ---------- plumbing ----------
  function reply(status, body, ms) {
    var res = function () { return new Response(JSON.stringify(body), { status: status, headers: { 'Content-Type': 'application/json' } }); };
    if (document.hidden) return Promise.resolve(res());
    return new Promise(function (resolve) { setTimeout(function () { resolve(res()); }, ms || 120 + Math.random() * 200); });
  }
  function fail(status, code, message, extra, ms) {
    var e = { code: code, message: E(message) };
    if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k]; });
    return reply(status, { error: e }, ms);
  }
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  function closed() { return SHOP === 'closed'; }
  // Showcase: visible and browsable; the server turns away every quote and checkout.
  function showcaseOn() { return SHOP === 'showcase' || SHOP === 'showcasemin'; }
  // What the shop window lists, what a link can reach, and what can be bought.
  function liveCatalog() { return SHOP === 'linkonly' ? [] : CATALOG.filter(function (p) { return statusOf(p) === 'live' || statusOf(p) === 'coming_soon'; }); }
  function reachable(p) { return !closed() && (SHOP === 'linkonly' ? p.slug === 'm_beanie' : statusOf(p) === 'live' || statusOf(p) === 'coming_soon' || statusOf(p) === 'unlisted'); }
  function sellable(p) { return SHOP === 'linkonly' ? p.slug === 'm_beanie' : statusOf(p) === 'live' || statusOf(p) === 'unlisted'; }

  // ---------- the rules (the same as the server's) ----------
  function checkBag(b) {
    if (!b || typeof b !== 'object') return { err: [400, 'invalid_request', 'Invalid request.'] };
    if (typeof b.country !== 'string' || !/^[A-Za-z]{2}$/.test(b.country)) return { err: [400, 'invalid_request', 'Pick a country.'] };
    if (!Array.isArray(b.items) || !b.items.length) return { err: [400, 'invalid_request', 'Your bag is empty.'] };
    var merged = {}, order = [], pieces = 0;
    for (var i = 0; i < b.items.length; i++) {
      var it = b.items[i];
      if (!it || typeof it.variant_id !== 'string' || !UUID.test(it.variant_id)) return { err: [400, 'invalid_request', 'That item isn\'t valid.'] };
      if (typeof it.qty !== 'number' || it.qty % 1 !== 0 || it.qty < 1) return { err: [400, 'invalid_request', 'Each item needs a quantity of at least 1.'] };
      if (merged[it.variant_id] === undefined) { merged[it.variant_id] = 0; order.push(it.variant_id); }
      merged[it.variant_id] += it.qty;
    }
    for (var k = 0; k < order.length; k++) {
      if (merged[order[k]] > 5) return { err: [400, 'qty_limit', 'You can order up to 5 of one item.'] };
      pieces += merged[order[k]];
    }
    if (pieces > 10) return { err: [400, 'too_many_items', '10 items is the most in one order.'] };
    var country = b.country.toUpperCase();
    if (!ZONES[country]) return { err: [400, 'country_not_available', 'We don\'t ship to that country yet.'] };
    return { country: country, items: order.map(function (id) { return { variant_id: id, qty: merged[id] }; }) };
  }

  function classify(v, qty, country) {
    if (!v || !sellable(v.product)) return 'unavailable';
    if (typeof v.product.ship[country] !== 'number') return 'cant_ship_here';
    if (v.stock <= 0) return 'sold_out';
    if (v.stock < qty) return 'short';
    return null;
  }

  function quote(bag) {
    var zone = ZONES[bag.country];
    var lines = [], problems = [], live = [];
    bag.items.forEach(function (it) {
      var v = VARIANTS[it.variant_id];
      var problem = classify(v, it.qty, bag.country);
      var unit = v ? v.product.price : 0;
      lines.push({
        variant_id: it.variant_id, product_id: v ? v.product.id : null, slug: v ? v.product.slug : null, name: v ? E(v.product.name) : '',
        label: v ? L(v.label) : '', sku: v ? v.sku : '', photo: v ? photoUrl(v.product.photos[0]) : null, qty: it.qty,
        unit_cents: unit, line_cents: unit * it.qty, left: v && v.stock <= LOW ? v.stock : null, problem: problem
      });
      if (problem) {
        problems.push({ variant_id: it.variant_id, code: problem, left: v ? v.stock : null,
          message: problem === 'short' ? 'Only ' + v.stock + ' left: ' + v.product.name + ' (' + v.label + ').'
            : problem === 'sold_out' ? v.product.name + ' (' + v.label + ') just sold out.'
            : problem === 'unavailable' ? 'An item in your bag isn\'t available any more.'
            : v.product.name + ' can\'t ship to ' + zone.name + '.' });
      }
      if (v) live.push({ qty: it.qty, ship: v.product.ship[bag.country] });
    });
    var subtotal = lines.reduce(function (n, l) { return n + l.line_cents; }, 0);
    var ok = live.length > 0 && live.every(function (l) { return typeof l.ship === 'number'; });
    var items = live.reduce(function (n, l) { return n + l.qty; }, 0);
    var base = ok ? Math.max.apply(null, live.map(function (l) { return l.ship; })) : 0;
    var shipping = ok ? base + Math.max(items - 1, 0) * zone.extra : null;
    return {
      ok: problems.length === 0, currency: 'USD', country: bag.country, zone_id: zone.id, zone: zone.name, lines: lines,
      subtotal_cents: subtotal, shipping_cents: shipping, total_cents: ok ? subtotal + shipping : null,
      shipping: ok ? { base_cents: base, items: items, extra_items: Math.max(items - 1, 0), extra_item_cents: zone.extra } : null,
      tax: TAX === 'none' ? 'none' : 'calculated_at_checkout', note: zone.note, delivery: zone.delivery, excluded_regions: zone.excluded, problems: problems
    };
  }

  // ---------- checkout ----------
  var orders = [];        // checkouts started in this page's life: { key, hash, number, cancelled }
  var nextNumber = 1042;
  var keyUsedOnce = false;
  function hashOf(bag) {
    return bag.country + '|' + bag.items.map(function (i) { return i.variant_id + ':' + i.qty; }).sort().join(',');
  }
  function carry() { return Base.carry ? '&' + Base.carry : ''; }

  function checkout(b) {
    if (CO === 'closed' || closed() || showcaseOn()) return fail(409, 'store_closed', 'The shop is closed right now.');
    if (CO === 'rate') return fail(429, 'rate_limited', 'Too many requests. Slow down and try again.');
    var bag = checkBag(b);
    if (bag.err) return fail(bag.err[0], bag.err[1], bag.err[2]);
    if (b.source !== 'web') return fail(400, 'invalid_request', 'Say where the order is from.');
    // R3: "newsletter" is optional, and when it is there it is true or false.
    if (b.newsletter !== undefined && typeof b.newsletter !== 'boolean') return fail(400, 'invalid_request', 'newsletter must be true or false.');
    if (typeof b.checkout_key !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(b.checkout_key)) return fail(400, 'invalid_request', 'That checkout key isn\'t valid.');
    if (b.website) return fail(400, 'rejected', 'Could not start the checkout.');
    if (typeof b.t !== 'number' || b.t < 2500 || b.t > 86400000) return fail(400, 'too_fast', 'Give the page a second and try again.');
    console.info('[dev-fake] checkout', JSON.stringify(b));

    if (CO === 'key' && !keyUsedOnce) { keyUsedOnce = true; return fail(409, 'checkout_key_used', 'That checkout has ended. Start a new one.'); }
    if (CO === 'stripe') return fail(502, 'payment_unavailable', 'Can\'t reach the payment page. Try again.');
    if (CO === 'toomany') return fail(409, 'too_many_open_checkouts', 'You already have 3 checkouts open. Finish or cancel one first.');

    var hash = hashOf(bag);
    var again = orders.filter(function (o) { return o.key === b.checkout_key; })[0];
    if (again) {
      if (again.hash !== hash) return fail(409, 'checkout_key_conflict', 'That checkout was started with something different. Start again.');
      if (again.cancelled) return fail(409, 'checkout_key_used', 'That checkout has ended. Start a new one.');
      return answer(again, bag);
    }

    // In ?fake=checkout the bag holds the REAL server's ids, which this fake doesn't know: don't judge them.
    var hybrid = mode === 'checkout' && !VARIANTS[bag.items[0].variant_id];
    var bad = function (codes) {
      if (hybrid) return [];
      return bag.items.filter(function (it) { var p = classify(VARIANTS[it.variant_id], it.qty, bag.country); return p && codes.indexOf(p) >= 0; })
        .map(function (it) { var v = VARIANTS[it.variant_id]; return { variant_id: it.variant_id, name: v ? v.product.name : '', label: v ? v.label : '', left: v ? v.stock : 0, reason: classify(v, it.qty, bag.country) }; });
    };
    var gone = bad(['unavailable']);
    if (gone.length || CO === 'gone') return fail(409, 'item_unavailable', 'An item in your bag isn\'t available any more.', { lines: gone });
    var noShip = bad(['cant_ship_here']);
    if (noShip.length || CO === 'noship') return fail(409, 'cant_ship_here', 'Some items can\'t ship to ' + ZONES[bag.country].name + '. Remove them to check out.', { lines: noShip });
    var short = bad(['sold_out', 'short']);
    if (short.length || CO === 'soldout') return fail(409, 'sold_out', 'Something in your bag just sold out.', { lines: short });
    var open = orders.filter(function (o) { return !o.cancelled; }).length;
    if (open >= 3) return fail(409, 'too_many_open_checkouts', 'You already have 3 checkouts open. Finish or cancel one first.');

    var o = { key: b.checkout_key, hash: hash, number: 'SF-' + (nextNumber++), cancelled: false };
    orders.push(o);
    return answer(o, bag);
  }

  function answer(o, bag) {
    var q = quote(bag);
    var dest = PAY === 'cancel' ? '/shop/cancelled/?n=' + o.number + '&t=fake-cancel'
      : '/shop/thanks/?n=' + o.number + '&t=' + (PAY === 'pending' ? 'fake-pending' : 'fake-paid');
    var url = CO === 'bad' ? 'http://evil.example/pay' : dest + carry();
    return reply(200, {
      url: url, number: o.number, expires_at: new Date(Date.now() + 31 * 60000).toISOString(),
      subtotal_cents: q.subtotal_cents, shipping_cents: q.shipping_cents, currency: 'USD'
    }, CO === 'slow' ? 3000 : 450);
  }

  function cancel(b) {
    if (!b || typeof b.number !== 'string' || typeof b.token !== 'string') return fail(400, 'invalid_request', 'Invalid request.');
    var t = b.token;
    if (t === 'fake-paid-cancel') return reply(200, { ok: true, status: 'paid', released: false });
    if (t === 'fake-pending-cancel') return reply(200, { ok: true, status: 'pending', released: false });
    if (t === 'fake-cancel') {
      orders.forEach(function (o) { if (o.number === b.number) o.cancelled = true; });
      return reply(200, { ok: true, status: 'expired', released: true });
    }
    // the same link opened a second time: already over, nothing left to release (the real server answers this way)
    if (t === 'fake-cancel-again') return reply(200, { ok: true, status: 'expired', released: false });
    return fail(404, 'not_found', 'We couldn\'t find that order.');
  }

  // ---------- orders ----------
  var pendingLooks = 0;
  function orderView(number, t) {
    var items = [
      { name: E('Fuse Hoodie'), label: L('L'), qty: 1, unit_cents: 6500, photo: photoUrl('m_hoodie') },
      { name: E('Pro Beanie'), label: L('One size'), qty: 1, unit_cents: 2800, photo: photoUrl('m_beanie') },
      { name: E('Emblem Tee'), label: L('M'), qty: 1, unit_cents: 3200, photo: photoUrl('m_tee') }
    ];
    var o = {
      number: number, status: 'paid', placed_at: '2026-10-19T16:21:03.000Z', paid_at: '2026-10-19T16:22:40.000Z', shipped_at: null,
      country: 'US', city: 'Detroit', region: 'MI', items: items, subtotal_cents: 12500, shipping_cents: 1200, tax_cents: 750, total_cents: 14450,
      refunded_cents: 0, currency: 'USD', tracking: null, test_mode: false
    };
    if (EVIL) { o.city = '<b>Detroit</b>'; o.region = '<i>MI</i>'; }
    if (t === 'fake-canada') { o.country = 'CA'; o.city = 'Toronto'; o.region = 'ON'; o.shipping_cents = 2000; o.tax_cents = 0; o.total_cents = 14500; }
    if (t === 'fake-shipped') {
      o.status = 'shipped'; o.shipped_at = '2026-10-21T11:08:00.000Z';
      o.tracking = { carrier: E('USPS'), number: '9400111899223344556677', url: EVIL ? 'javascript:window.__pwned=6' : 'https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111899223344556677' };
    }
    if (t === 'fake-refunded') { o.status = 'refunded'; o.refunded_cents = 14450; }
    if (t === 'fake-expired') { o.status = 'expired'; o.paid_at = null; o.city = null; o.region = null; o.tax_cents = null; o.total_cents = null; }
    if (t === 'fake-pending' && pendingLooks++ < 2) {
      o.status = 'pending'; o.paid_at = null; o.city = null; o.region = null; o.tax_cents = null; o.total_cents = null;
    }
    return o;
  }

  function order(params) {
    var n = params.get('n'), t = params.get('t');
    if (!/^SF-\d{3,9}$/.test(n || '') || !t) return fail(404, 'not_found', 'We couldn\'t find that order.');
    if (t === 'fake-fail') return fail(503, 'unavailable', 'Something went wrong on our side. Try again in a minute.');
    if (/^fake-ret-/.test(t)) return retKnown(t) ? reply(200, retOrder(n, t)) : fail(404, 'not_found', 'We couldn\'t find that order.');
    if (['fake-paid', 'fake-pending', 'fake-shipped', 'fake-refunded', 'fake-expired', 'fake-canada', 'fake-slow'].indexOf(t) < 0) {
      return fail(404, 'not_found', 'We couldn\'t find that order.');
    }
    return reply(200, orderView(n, t), t === 'fake-slow' ? 4000 : undefined);
  }

  // ---------- returns (build 14) ----------
  // The same rules as the server's (docs/BUILD_14_API_CONTRACT.md, sections 2 to 5), kept in memory for this page's life.
  var REASONS = [
    { code: 'wrong_size', label: 'Wrong size', our_mistake: false, photos: false },
    { code: 'damaged_defective', label: 'Damaged or defective', our_mistake: true, photos: true },
    { code: 'wrong_item', label: 'Wrong item sent', our_mistake: true, photos: true },
    { code: 'not_as_expected', label: 'Not as expected', our_mistake: false, photos: false },
    { code: 'changed_mind', label: 'Changed my mind', our_mistake: false, photos: false },
    { code: 'other', label: 'Other', our_mistake: false, photos: false }
  ];
  function reasonOf(code) { for (var i = 0; i < REASONS.length; i++) if (REASONS[i].code === code) return REASONS[i]; return null; }
  var LIVE = { requested: 1, approved: 1, shipped_back: 1, received: 1, refunded: 1 };   // statuses that hold units
  var STATUS_LABEL = { requested: 'Requested', approved: 'Approved', shipped_back: 'Shipped back', received: 'Received', refunded: 'Refunded', declined: 'Declined', cancelled: 'Cancelled', expired: 'Expired', closed: 'Closed' };

  // SF-1002: the demo order of the returns mockup. SF-1031: everything final sale.
  var HOODIE = 'a1b2c3d4-0001-4000-8000-000000000001', BEANIE = 'a1b2c3d4-0001-4000-8000-000000000002', TEE = 'a1b2c3d4-0001-4000-8000-000000000003';
  var RET_LINES = [
    { id: HOODIE, name: 'Fuse Hoodie', label: 'M', qty: 1, unit: 6500, photo: 'm_hoodie', fs: false },
    { id: BEANIE, name: 'Pro Beanie', label: 'One size', qty: 2, unit: 2800, photo: 'm_beanie', fs: false },
    { id: TEE, name: 'Pro Tee', label: 'M', qty: 1, unit: 3400, photo: 'm_tee_pro', fs: true }
  ];
  var FINAL_LINES = [{ id: TEE, name: 'Pro Tee', label: 'M', qty: 1, unit: 3400, photo: 'm_tee_pro', fs: true }];
  var ADDRESS = { name: 'ShowFuse Returns, c/o Demo Fulfillment Co.', line1: '1200 Example Way', line2: null, city: 'Reno', state: 'NV', postal_code: '89501', country: 'US' };

  function itemOf(id, qty, received) {
    var l = RET_LINES.filter(function (x) { return x.id === id; })[0];
    return { id: id, name: E(l.name), label: L(l.label), qty: qty, received_qty: received === undefined ? null : received, photo: photoUrl(l.photo) };
  }
  // A return, with the mockup's RET-0007 as the starting point; over changes it.
  function mkReturn(number, status, over) {
    var r = {
      number: number, status: status, status_label: STATUS_LABEL[status], reason: 'damaged_defective', reason_label: 'Damaged or defective', our_mistake: true,
      note: E('The seam on the left sleeve came apart the first time I tried it on.'), photo_count: 1, items: [itemOf(HOODIE, 1)],
      requested_at: '2026-10-24T16:41:00.000Z', approved_at: null, declined_at: null, received_at: null, refunded_at: null, ship_by: null, ship_by_date: null,
      pays_return_shipping: null, shipping_note: null, return_address: null, tracking: null, postage_cents: null, decline_reason: null, closed_note: null,
      check: null, refund: null, can_cancel: status === 'requested' || status === 'approved', can_add_tracking: status === 'approved' || status === 'shipped_back', currency: 'USD'
    };
    Object.keys(over || {}).forEach(function (k) { r[k] = over[k]; });
    r.can_cancel = status === 'requested' || status === 'approved';
    r.can_add_tracking = status === 'approved' || status === 'shipped_back';
    return r;
  }
  function approvedBits(buyerPays) {
    return {
      approved_at: '2026-10-24T17:05:00.000Z', ship_by: '2026-11-08T07:59:59.999Z', ship_by_date: '2026-11-07',
      pays_return_shipping: buyerPays ? 'buyer' : 'shop', return_address: JSON.parse(JSON.stringify(ADDRESS)),
      shipping_note: E(buyerPays
        ? 'You pay for return shipping. We refund the items you send back and the tax on them. The shipping you paid to get your order is not refunded.'
        : 'Because it arrived damaged, we\'re covering your return shipping. Pay for the postage, then add what you paid on your order page. We add it to your refund.')
    };
  }
  function beanieReturn(number, status) {
    return mkReturn(number, status, { reason: 'changed_mind', reason_label: 'Changed my mind', our_mistake: false, note: E('Not my style.'), photo_count: 0, items: [itemOf(BEANIE, 2)] });
  }
  var SENT = { carrier: 'USPS', number: '9400111899223344559900', added_at: '2026-10-28T21:12:00.000Z' };
  function seedReturns(t) {
    var A = approvedBits(false);
    function plus(r, bits) { Object.keys(bits).forEach(function (k) { r[k] = bits[k]; }); return r; }
    if (t === 'fake-ret-requested') return [mkReturn('RET-0007', 'requested')];
    if (t === 'fake-ret-approved') return [mkReturn('RET-0007', 'approved', A)];
    if (t === 'fake-ret-approved-buyer') return [plus(beanieReturn('RET-0008', 'approved'), approvedBits(true))];
    if (t === 'fake-ret-shipped') return [mkReturn('RET-0007', 'shipped_back', plus(A, { tracking: { carrier: E(SENT.carrier), number: E(SENT.number), added_at: SENT.added_at }, postage_cents: 840 }))];
    var recv = plus(plus({}, A), { tracking: { carrier: SENT.carrier, number: SENT.number, added_at: SENT.added_at }, postage_cents: 840, received_at: '2026-11-02T19:30:00.000Z', items: [itemOf(HOODIE, 1, 1)] });
    if (t === 'fake-ret-received') return [mkReturn('RET-0007', 'received', plus(recv, { check: { condition: 'ok', note: null } }))];
    if (t === 'fake-ret-problem') return [mkReturn('RET-0007', 'received', plus(recv, { check: { condition: 'problem', note: E('The cuff has a stain and the tags were cut off.') } }))];
    if (t === 'fake-ret-refunded') {
      return [mkReturn('RET-0007', 'refunded', plus(recv, { check: { condition: 'ok', note: null }, refunded_at: '2026-11-02T22:10:00.000Z',
        refund: { amount_cents: 8690, refunded_at: '2026-11-02T22:10:00.000Z', items_cents: 6500, tax_cents: 0, shipping_cents: 1350, postage_cents: 840, custom: false, currency: 'USD' } }))];
    }
    if (t === 'fake-ret-custom') {
      return [mkReturn('RET-0007', 'refunded', plus(recv, { check: { condition: 'ok', note: null }, refunded_at: '2026-11-02T22:10:00.000Z',
        refund: { amount_cents: 5000, refunded_at: '2026-11-02T22:10:00.000Z', items_cents: null, tax_cents: null, shipping_cents: null, postage_cents: null, custom: true, currency: 'USD' } }))];
    }
    if (t === 'fake-ret-declined') {
      return [mkReturn('RET-0007', 'declined', { declined_at: '2026-10-24T17:05:00.000Z',
        decline_reason: E('Thanks for the photo. We can\'t see the damage you described, so we can\'t approve this one. If you have a clearer photo, send it and we\'ll look again.') })];
    }
    if (t === 'fake-ret-cancelled') return [mkReturn('RET-0007', 'cancelled')];
    if (t === 'fake-ret-expired') return [mkReturn('RET-0007', 'expired', plus(plus({}, A), { approved_at: '2026-09-20T17:05:00.000Z', ship_by: '2026-10-05T06:59:59.999Z', ship_by_date: '2026-10-04' }))];
    if (t === 'fake-ret-closed') {
      return [mkReturn('RET-0007', 'closed', plus(recv, { check: { condition: 'problem', note: E('The hem stitching is cut and there is a stain.') },
        closed_note: E('Hem stitching is cut and there is a stain, so there is nothing we can refund.') }))];
    }
    if (t === 'fake-ret-two') {
      var done = mkReturn('RET-0007', 'refunded', plus(recv, { check: { condition: 'ok', note: null }, refunded_at: '2026-11-02T22:10:00.000Z',
        refund: { amount_cents: 8690, refunded_at: '2026-11-02T22:10:00.000Z', items_cents: 6500, tax_cents: 0, shipping_cents: 1350, postage_cents: 840, custom: false, currency: 'USD' } }));
      return [beanieReturn('RET-0009', 'requested'), done];
    }
    return [];
  }
  var RET_TOKENS = ['none', 'requested', 'approved', 'approved-buyer', 'shipped', 'received', 'problem', 'refunded', 'custom', 'declined', 'cancelled', 'expired', 'closed', 'two', 'final', 'window', 'unshipped'];
  function retKnown(t) { return RET_TOKENS.indexOf(String(t).replace(/^fake-ret-/, '')) >= 0; }
  var RETSTATE = {};
  function retState(t) {
    if (!RETSTATE[t]) RETSTATE[t] = { returns: seedReturns(t), made: {}, photos: [], nextNo: 12 };
    return RETSTATE[t];
  }
  function retLines(t) { return t === 'fake-ret-final' ? FINAL_LINES : RET_LINES; }
  function leftOf(t, line) {
    var used = 0;
    retState(t).returns.forEach(function (r) {
      if (!LIVE[r.status]) return;
      r.items.forEach(function (i) { if (i.id === line.id) used += i.qty; });
    });
    return Math.max(0, line.qty - used);
  }

  function retOrder(number, t) {
    var st = retState(t), lines = retLines(t), final = t === 'fake-ret-final';
    var shipped = t !== 'fake-ret-unshipped', windowOpen = t !== 'fake-ret-window';
    var items = lines.map(function (l) {
      return { id: l.id, name: E(l.name), label: L(l.label), qty: l.qty, unit_cents: l.unit, photo: photoUrl(l.photo), final_sale: l.fs, returnable_qty: leftOf(t, l) };
    });
    var left = items.some(function (i) { return i.returnable_qty > 0; });
    var leftOpen = items.some(function (i) { return i.returnable_qty > 0 && !i.final_sale; });
    var closedWhy = !shipped ? 'not_shipped' : !windowOpen ? 'window' : !left ? 'nothing_left' : !leftOpen ? 'final_sale' : null;
    var refunded = 0;
    st.returns.forEach(function (r) { if (r.refund) refunded += r.refund.amount_cents; });
    var subtotal = lines.reduce(function (n, l) { return n + l.qty * l.unit; }, 0), ship = final ? 500 : 1350;
    var o = {
      number: number, status: shipped ? 'shipped' : 'paid', placed_at: '2026-10-14T16:21:03.000Z', paid_at: '2026-10-14T16:22:40.000Z',
      shipped_at: shipped ? (final ? '2026-10-21T11:08:00.000Z' : '2026-10-16T18:08:00.000Z') : null,
      country: 'US', city: 'Detroit', region: 'MI', items: items, subtotal_cents: subtotal, shipping_cents: ship, tax_cents: 0, total_cents: subtotal + ship,
      refunded_cents: refunded, currency: 'USD', test_mode: false,
      tracking: shipped ? { carrier: 'USPS', number: final ? '9400111899223344557788' : '9400111899223344556677',
        url: 'https://tools.usps.com/go/TrackConfirmAction?tLabels=' + (final ? '9400111899223344557788' : '9400111899223344556677') } : null,
      return_window_days: 30, return_by: shipped ? '2026-11-16T07:59:59.999Z' : null, return_by_date: shipped ? (final ? '2026-11-20' : '2026-11-15') : null,
      can_return: closedWhy === null, can_report_problem: shipped && windowOpen && left, return_closed: closedWhy,
      returns: st.returns.map(function (r) { return JSON.parse(JSON.stringify(r)); })
    };
    if (final && !windowOpen) o.can_report_problem = false;
    return o;
  }

  // ---- the request routes (guest: ?n=&t= in the query, the bot checks in the body) ----
  var UUIDRE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  function guestToken(params) {
    var n = params.get('n'), t = params.get('t');
    if (!/^SF-\d{3,9}$/.test(n || '') || !/^fake-ret-/.test(t || '') || !retKnown(t)) return null;
    return t;
  }
  function botCheck(b) {
    if (!b || typeof b !== 'object') return fail(400, 'invalid_request', 'Invalid request.');
    if (RET === 'rejected' || b.website) return fail(400, 'rejected', 'We couldn\'t send that. Reload the page and try again.');
    if (RET === 'toofast' || typeof b.t !== 'number' || b.t < 2500 || b.t > 86400000) return fail(400, 'too_fast', 'Give the page a second and try again.');
    if (RET === 'rate') return fail(429, 'rate_limited', 'Too many requests from your network. Wait a minute and try again.');
    return null;
  }
  function pretty(ymd) { var m = /^\d{4}-(\d{2})-(\d{2})$/.exec(ymd); return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m[1] - 1] + ' ' + (+m[2]); }

  function retCreate(params, b) {
    var t = guestToken(params);
    if (!t) return fail(404, 'not_found', 'We couldn\'t find that order.');
    var bad = botCheck(b);
    if (bad) return bad;
    var st = retState(t), lines = retLines(t);
    if (typeof b.request_id !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(b.request_id)) return fail(400, 'invalid_request', 'That request id isn\'t valid.');
    if (st.made[b.request_id]) return reply(201, { return: JSON.parse(JSON.stringify(st.made[b.request_id])), already: true });
    console.info('[dev-fake] return request', JSON.stringify(b));
    if (!Array.isArray(b.items) || !b.items.length) return fail(400, 'invalid_request', 'Pick at least one item to send back.');
    var seen = {}, picked = [];
    for (var i = 0; i < b.items.length; i++) {
      var it = b.items[i];
      var line = it && typeof it.id === 'string' && UUIDRE.test(it.id) ? lines.filter(function (l) { return l.id === it.id; })[0] : null;
      if (!line || seen[it.id] || typeof it.qty !== 'number' || it.qty % 1 !== 0 || it.qty < 1) return fail(400, 'invalid_request', 'One of the items isn\'t valid.');
      seen[it.id] = 1;
      picked.push({ line: line, qty: it.qty });
    }
    var reason = typeof b.reason === 'string' ? reasonOf(b.reason) : null;
    if (!reason) return fail(400, 'invalid_request', 'Pick a reason.');
    if (b.note !== undefined && (typeof b.note !== 'string' || b.note.length > 500)) return fail(400, 'invalid_request', 'Your note can be up to 500 characters.');
    var ids = b.photo_ids === undefined ? [] : b.photo_ids;
    if (!Array.isArray(ids) || ids.length > 3 || (ids.length && !reason.photos) || ids.some(function (x) { return st.photos.indexOf(x) < 0; })) return fail(400, 'invalid_request', 'Those photos can\'t be used with this request.');

    if (RET === 'busy') return fail(503, 'busy', 'We\'re busy for a moment. Try again in a few seconds.');
    var shipped = t !== 'fake-ret-unshipped';
    if (!shipped) return fail(409, 'not_shipped', 'This order hasn\'t shipped yet, so it can\'t be returned.');
    if (t === 'fake-ret-window' || RET === 'window') return fail(409, 'return_window_closed', 'The return window for this order closed on ' + pretty('2026-11-15') + '. Email us and we\'ll take a look.', { closed_on: '2026-11-15' });
    var finals = picked.filter(function (p) { return p.line.fs; });
    var problemReason = reason.code === 'damaged_defective' || reason.code === 'wrong_item';
    if ((finals.length && !problemReason) || RET === 'final') {
      var fl = (finals.length ? finals : [{ line: RET_LINES[2] }]).map(function (p) { return { id: p.line.id, name: p.line.name, label: p.line.label }; });
      return fail(409, 'final_sale', fl[0].name + ' is final sale, so it can\'t be returned. If it arrived damaged or isn\'t what you ordered, pick that reason instead.', { lines: fl });
    }
    var few = picked.filter(function (p) { return p.qty > leftOf(t, p.line); });
    if (few.length || RET === 'nothing') {
      var nl = (few.length ? few : [{ line: RET_LINES[1] }]).map(function (p) { return { id: p.line.id, name: p.line.name, label: p.line.label, returnable_qty: leftOf(t, p.line) }; });
      return fail(409, 'nothing_to_return', nl[0].name + ' has fewer left to return than you asked for.', { lines: nl });
    }
    var open = st.returns.filter(function (r) { return r.status === 'requested' || r.status === 'approved' || r.status === 'shipped_back' || r.status === 'received'; }).length;
    if (open >= 3 || RET === 'toomany') return fail(409, 'too_many_open_returns', 'There are too many open return requests from your network. Try again tomorrow, or email us.', { scope: 'network', limit: 10 });

    var no = 'RET-' + ('000' + (st.nextNo++)).slice(-4);
    var r = mkReturn(no, 'requested', {
      reason: reason.code, reason_label: reason.label, our_mistake: reason.our_mistake, note: b.note ? E(b.note) : null, photo_count: ids.length,
      items: picked.map(function (p) { return itemOf(p.line.id, p.qty); }), requested_at: new Date().toISOString()
    });
    st.photos = st.photos.filter(function (x) { return ids.indexOf(x) < 0; });
    st.returns.unshift(r);
    st.made[b.request_id] = r;
    return reply(201, { return: JSON.parse(JSON.stringify(r)), already: false }, RET === 'slow' ? 3000 : 700);
  }

  function retFind(t, number) { var l = retState(t).returns.filter(function (r) { return r.number === number; }); return l[0] || null; }
  function retDone(r, code) {
    if (code) r.status = code;
    r.status_label = STATUS_LABEL[r.status];
    r.can_cancel = r.status === 'requested' || r.status === 'approved';
    r.can_add_tracking = r.status === 'approved' || r.status === 'shipped_back';
    return reply(200, { return: JSON.parse(JSON.stringify(r)) });
  }
  function retTracking(params, number, b) {
    var t = guestToken(params);
    if (!t) return fail(404, 'not_found', 'We couldn\'t find that order.');
    var bad = botCheck(b);
    if (bad) return bad;
    var r = retFind(t, number);
    if (!r) return fail(404, 'not_found', 'We couldn\'t find that return.');
    if (RET === 'wrongstate' || (r.status !== 'approved' && r.status !== 'shipped_back')) return fail(409, 'return_wrong_state', 'That return can\'t take tracking right now.', { status: r.status });
    var hasC = typeof b.carrier === 'string' && b.carrier.trim(), hasN = typeof b.tracking_number === 'string' && b.tracking_number, hasP = typeof b.postage_cents === 'number';
    if (!hasC && !hasN && !hasP) return fail(400, 'invalid_request', 'Add a tracking number, a carrier or the postage you paid.');
    if (hasC && b.carrier.length > 30) return fail(400, 'invalid_request', 'The carrier can be up to 30 characters.');
    if (hasN && !/^[A-Za-z0-9 -]{5,40}$/.test(b.tracking_number)) return fail(400, 'invalid_request', 'A tracking number is 5 to 40 letters, numbers, spaces or dashes.');
    if (hasP && (b.postage_cents % 1 !== 0 || b.postage_cents < 0 || b.postage_cents > 10000)) return fail(400, 'invalid_request', 'The postage can be $0 to $100.');
    if (hasP && r.pays_return_shipping !== 'shop') return fail(400, 'invalid_request', 'You pay return shipping on this one, so there\'s no postage to add.');
    console.info('[dev-fake] return tracking', number, JSON.stringify(b));
    r.tracking = { carrier: hasC ? E(b.carrier.trim()) : null, number: hasN ? E(b.tracking_number) : null, added_at: new Date().toISOString() };
    if (hasP) r.postage_cents = b.postage_cents;
    return retDone(r, 'shipped_back');
  }
  function retCancel(params, number, b) {
    var t = guestToken(params);
    if (!t) return fail(404, 'not_found', 'We couldn\'t find that order.');
    var bad = botCheck(b);
    if (bad) return bad;
    var r = retFind(t, number);
    if (!r) return fail(404, 'not_found', 'We couldn\'t find that return.');
    if (r.status === 'cancelled') return retDone(r);
    if (RET === 'wrongstate' || (r.status !== 'requested' && r.status !== 'approved')) return fail(409, 'return_wrong_state', 'That return can\'t be cancelled any more.', { status: r.status });
    return retDone(r, 'cancelled');
  }
  function retPhoto(params, fd) {
    var t = guestToken(params);
    if (!t) return fail(404, 'not_found', 'We couldn\'t find that order.');
    if (RET === 'photo429') return fail(429, 'rate_limited', 'Too many requests from your network. Wait a minute and try again.');
    if (RET === 'photo503') return fail(503, 'busy', 'We\'re busy for a moment. Try again in a few seconds.');
    var f = fd && typeof fd.get === 'function' ? fd.get('file') : null;
    if (!f || typeof f === 'string') return fail(400, 'file_required', 'Choose a photo to add.');
    if (RET === 'photo415' || !/^image\/(jpeg|png)$/.test(f.type)) return fail(415, 'unsupported_media', 'Use a JPEG or PNG photo.');
    if (RET === 'photo413' || f.size > 8388608) return fail(413, 'file_too_large', 'That photo is over 8 MB. Choose a smaller one.');
    if (RET === 'photolimit') return fail(403, 'upload_limit', 'You\'ve added the most photos for today. Try again tomorrow.');
    var st = retState(t);
    if (RET === 'photomany' || st.photos.length >= 3) return fail(409, 'too_many_photos', 'Three photos are already waiting for this order.');
    var id = 'f0f0f0f0-' + ('0000' + (st.photos.length + 1)).slice(-4) + '-4000-8000-' + ('000000000000' + Math.floor(Math.random() * 1e12)).slice(-12);
    st.photos.push(id);
    return reply(201, { photo: { id: id, content_type: f.type, bytes: f.size }, attached: st.photos.length, limit: 3 }, 500);
  }

  // ---------- routing ----------
  function config() {
    if (SHOP === 'error') return fail(503, 'unavailable', 'Something went wrong on our side. Try again in a minute.');
    if (SHOP === 'none') return fail(404, 'not_found', 'Route not found.');   // a server that doesn't have the shop yet
    if (closed()) return reply(200, { mode: 'off', open: false, visible: false, test_mode: false });
    if (SHOP === 'showcasemin') return reply(200, { mode: 'showcase', open: false, visible: true, test_mode: false });
    var full = {
      mode: SHOP === 'showcase' ? 'showcase' : 'open',
      open: SHOP !== 'showcase', visible: SHOP !== 'linkonly', test_mode: DEMO === 'all', currency: 'USD',
      tax: TAX === 'none' ? 'none' : 'calculated_at_checkout', pack_time: '3 business days',
      countries: Object.keys(ZONES).map(function (c) {
        var z = ZONES[c];
        return { code: c, name: z.name, zone_id: z.id, zone: z.name, extra_item_cents: z.extra, delivery: z.delivery, note: z.note ? E(z.note) : null, excluded_regions: z.excluded };
      }),
      limits: { max_items: 10, max_qty_per_line: 5 }, low_stock_at: LOW,
      returns: SHOP === 'noreturns' ? undefined : { window_days: 30, ship_within_days: 14, shipping_mode: 'buyer_unless_our_mistake', reasons: REASONS },
      links: EVIL
        ? { shipping_returns: 'javascript:window.__pwned=5', terms_of_sale: 'https://evil.example/terms' }
        : { shipping_returns: 'https://showfuseapp.com/shipping-returns', terms_of_sale: 'https://showfuseapp.com/terms-of-sale' }
    };
    if (SHOP === 'nomode') delete full.mode;   // an older server: it only says open and visible
    if (SHOP === 'weirdmode') full.mode = 'sale';   // a mode this page has never heard of: it must stay closed
    return reply(200, full);
  }

  function handle(method, path, params, body) {
    if (method === 'GET' && path === '/v1/shop/config') return config();
    if (method === 'GET' && path === '/v1/shop/products') {
      if (closed()) return reply(200, { products: [] });
      return reply(200, { products: liveCatalog().map(function (p) { return publicProduct(p, false); }) });
    }
    var m = /^\/v1\/shop\/products\/([a-z0-9][a-z0-9_-]{1,39})$/.exec(path);
    if (method === 'GET' && m) {
      var p = bySlug(m[1]);
      var preview = params.get('preview') === 'good';
      if (!p || (!preview && !reachable(p))) return fail(404, 'not_found', 'We couldn\'t find that product.');
      return reply(200, publicProduct(p, preview));
    }
    if (method === 'POST' && path === '/v1/shop/quote') {
      if (closed() || showcaseOn()) return fail(409, 'store_closed', 'The shop is closed right now.');
      var bag = checkBag(body);
      if (bag.err) return fail(bag.err[0], bag.err[1], bag.err[2]);
      return reply(200, quote(bag));
    }
    if (method === 'POST' && path === '/v1/shop/checkout') return checkout(body);
    if (method === 'POST' && path === '/v1/shop/checkout/cancel') return cancel(body);
    if (method === 'GET' && path === '/v1/shop/order') return order(params);
    if (method === 'POST' && path === '/v1/shop/order/returns') return retCreate(params, body);
    var rm = /^\/v1\/shop\/order\/returns\/(RET-\d{3,9})\/(tracking|cancel)$/.exec(path);
    if (method === 'POST' && rm) return rm[2] === 'tracking' ? retTracking(params, rm[1], body) : retCancel(params, rm[1], body);
    if (method === 'POST' && path === '/v1/shop/return-photos') return retPhoto(params, body);
    return fail(404, 'not_found', 'Route not found.');
  }

  // In ?fake=checkout only these three are faked.
  var ONLY = { '/v1/shop/checkout': 1, '/v1/shop/checkout/cancel': 1, '/v1/shop/order': 1 };
  function faked(pathname) { return ONLY[pathname] || /^\/v1\/shop\/(order\/returns|return-photos)/.test(pathname); }

  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : input.url;
    if (!API || url.indexOf(API + '/v1/shop/') !== 0) return realFetch(input, init);
    init = init || {};
    var u = new URL(url), method = String(init.method || 'GET').toUpperCase();
    if (mode === 'checkout' && !faked(u.pathname)) return realFetch(input, init);
    var body = null;
    if (typeof init.body === 'string') { try { body = JSON.parse(init.body); } catch (e) { body = null; } }
    else if (typeof FormData === 'function' && init.body instanceof FormData) body = init.body;
    console.info('[dev-fake]', method, u.pathname + u.search);
    try { return handle(method, u.pathname, u.searchParams, body); }
    catch (e) { console.error(e); return fail(500, 'fake_crash', 'The fake API crashed: ' + e.message); }
  };
  window.SF_SHOP_FAKE_READY = true;
  console.info('[dev-fake] shop API is faked' + (mode === 'checkout' ? ' for checkout, cancel and order only' : '') + '. Cheat sheet at the top of /shop/dev-fake.js.');
})();
