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
  var SHOP = flag('shop'), TAX = flag('tax'), PAY = flag('pay'), CO = flag('co'), EVIL = flag('evil') === '1', DEMO = flag('demo');
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
    if (['fake-paid', 'fake-pending', 'fake-shipped', 'fake-refunded', 'fake-expired', 'fake-canada', 'fake-slow'].indexOf(t) < 0) {
      return fail(404, 'not_found', 'We couldn\'t find that order.');
    }
    return reply(200, orderView(n, t), t === 'fake-slow' ? 4000 : undefined);
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
    return fail(404, 'not_found', 'Route not found.');
  }

  // In ?fake=checkout only these three are faked.
  var ONLY = { '/v1/shop/checkout': 1, '/v1/shop/checkout/cancel': 1, '/v1/shop/order': 1 };

  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : input.url;
    if (!API || url.indexOf(API + '/v1/shop/') !== 0) return realFetch(input, init);
    init = init || {};
    var u = new URL(url), method = String(init.method || 'GET').toUpperCase();
    if (mode === 'checkout' && !ONLY[u.pathname]) return realFetch(input, init);
    var body = null;
    if (typeof init.body === 'string') { try { body = JSON.parse(init.body); } catch (e) { body = null; } }
    console.info('[dev-fake]', method, u.pathname + u.search);
    try { return handle(method, u.pathname, u.searchParams, body); }
    catch (e) { console.error(e); return fail(500, 'fake_crash', 'The fake API crashed: ' + e.message); }
  };
  window.SF_SHOP_FAKE_READY = true;
  console.info('[dev-fake] shop API is faked' + (mode === 'checkout' ? ' for checkout, cancel and order only' : '') + '. Cheat sheet at the top of /shop/dev-fake.js.');
})();
