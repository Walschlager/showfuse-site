/* ShowFuse: /shop/order/?n=SF-1042&t=<token>. The "View your order" link in the order emails.
   Status, items and tracking from GET /v1/shop/order. The server only ever sends the city and
   state, never the street, and neither does this page. Server text always goes in with textContent. */
(function () {
  'use strict';
  var SF = window.SFShop;
  if (!SF) return;
  var el = SF.el;
  var view = SF.$('view');

  function query(name) {
    var m = new RegExp('(?:^|[?&])' + name + '=([^&]*)').exec(location.search);
    if (!m) return '';
    try { return decodeURIComponent(m[1].replace(/\+/g, ' ')); } catch (e) { return ''; }
  }
  var number = query('n');
  var token = query('t');
  var haveLink = /^SF-\d{3,9}$/.test(number) && /^[A-Za-z0-9_-]{8,64}$/.test(token);
  var shopHref = '/';
  var shopLabel = 'Back to ShowFuse';

  function put(nodes) {
    SF.clear(view);
    nodes.forEach(function (n) { if (n) view.appendChild(n); });
    SF.focusHeading(view);
  }

  function loading() {
    SF.clear(view);
    view.appendChild(el('p', { cls: 'lede', role: 'status' }, [el('span', { cls: 'spin', 'aria-hidden': 'true' }), 'One sec…']));
  }

  function notFound() {
    SF.setTitle('Your order');
    put([
      el('div', { cls: 'kicker', text: 'Your order' }),
      el('h1', { tabindex: '-1', text: 'We couldn\'t find that order.' }),
      el('p', { cls: 'lede', text: 'Open the "View your order" button in your order email again. Still stuck? Email us and mention your order number.' }),
      el('div', { cls: 'pagebtns' }, [el('a', { cls: 'btn', href: 'mailto:' + SF.MAIL + '?subject=' + encodeURIComponent('My ShowFuse order'), text: 'Email ' + SF.MAIL })])
    ]);
  }

  function failed(err) {
    SF.setTitle('Your order');
    put([
      el('div', { cls: 'kicker', text: 'Your order' }),
      el('h1', { tabindex: '-1', text: 'We couldn\'t load your order.' })
    ].concat(SF.errorBlock(err && err.message ? err.message : SF.NET_MSG, start)));
  }

  function headline(o) {
    if (o.status === 'pending') return 'We\'re confirming your payment. Check back in a minute.';
    if (o.status === 'paid') return 'Paid. We\'ll email you a tracking number when it ships.';
    if (o.status === 'shipped') return 'On its way. The tracking number is below.';
    if (o.status === 'refunded') return 'Refunded. The money is going back to your card.';
    if (o.status === 'expired') return 'No charge was made for this order.';
    if (o.status === 'failed') return 'The payment didn\'t go through, so no charge was made.';
    return '';
  }

  function show(o) {
    SF.setTitle('Order ' + o.number);
    var nodes = [
      el('div', { cls: 'kicker', text: 'Your order' }),
      el('h1', { tabindex: '-1', text: 'Order ' + o.number }),
      el('p', { cls: 'lede', text: headline(o) })
    ];
    var live = o.status !== 'expired' && o.status !== 'failed';
    if (live) nodes.push(window.SFOrder.track(o));
    nodes.push(window.SFOrder.summary(o));
    nodes.push(el('div', { cls: 'pagebtns cont' }, [el('a', { cls: 'btn ghost', href: shopHref, text: shopLabel })]));
    nodes.push(el('p', { cls: 'fine' }, [
      'Questions about your order? Email ', el('a', { href: 'mailto:' + SF.MAIL, text: SF.MAIL }),
      ' and mention ' + o.number + '. Your payment receipt comes separately from Stripe.'
    ]));
    put(nodes);
  }

  var seq = 0;
  function start() {
    var mine = ++seq;
    if (!haveLink) { notFound(); return; }
    loading();
    var cfgP = SF.config(true).then(function (cfg) {
      SF.renderNav(cfg, { here: '', bag: false });
      SF.renderFooter(cfg);
      if (cfg.visible) { shopHref = SF.href('/shop/'); shopLabel = 'Back to the shop'; }
    }, function () { SF.renderNav(null, { here: '', bag: false }); SF.renderFooter(null); });
    var orderP = SF.request('GET', '/v1/shop/order?n=' + encodeURIComponent(number) + '&t=' + encodeURIComponent(token), { timeout: 15000 })
      .then(function (j) { return { order: window.SFOrder.norm(j) }; }, function (e) { return { fail: e }; });
    Promise.all([cfgP, orderP]).then(function (r) {
      if (mine !== seq) return;
      var res = r[1];
      if (res.order) { show(res.order); return; }
      if (res.fail && res.fail.status !== 404) { failed(res.fail); return; }
      notFound();
    });
  }

  start();
})();
