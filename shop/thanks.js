/* ShowFuse: /shop/thanks/?n=SF-1042&t=<token>. Where Stripe sends people after paying.
   "Thank you" is on the page the moment it loads (it is right there in the HTML). Then we ask
   GET /v1/shop/order for what we can fill in. If that call fails, the page still says thank you.
   Server text always goes in with textContent. */
(function () {
  'use strict';
  var SF = window.SFShop;
  if (!SF) return;
  var el = SF.el, Bag = SF.Bag;
  var view = SF.$('view');
  var lede = SF.$('lede');

  function query(name) {
    var m = new RegExp('(?:^|[?&])' + name + '=([^&]*)').exec(location.search);
    if (!m) return '';
    try { return decodeURIComponent(m[1].replace(/\+/g, ' ')); } catch (e) { return ''; }
  }
  var number = query('n');
  var token = query('t');
  var haveLink = /^SF-\d{3,9}$/.test(number) && /^[A-Za-z0-9_-]{8,64}$/.test(token);

  var detail = el('div');
  var status = el('p', { cls: 'fine waiting', role: 'status' });
  var h1 = view.querySelector('h1');

  function ledeText(parts) {
    SF.clear(lede);
    parts.forEach(function (p) { lede.appendChild(typeof p === 'string' ? document.createTextNode(p) : p); });
  }
  function orderIs(tail) {
    ledeText(haveLink ? ['Order ', el('b', { text: number }), ' is in. ' + tail] : [tail]);
  }

  function firstDraw() {
    orderIs('');
    status.appendChild(el('span', { cls: 'spin', 'aria-hidden': 'true' }));
    status.appendChild(document.createTextNode(haveLink ? 'Loading your order…' : ''));
    view.appendChild(status);
    view.appendChild(detail);
    view.appendChild(el('div', { cls: 'pagebtns cont' }, [el('a', { id: 'backBtn', cls: 'btn ghost', href: '/', text: 'Back to ShowFuse' })]));
    view.appendChild(el('p', { cls: 'fine' }, [
      'Questions about your order? Email ', el('a', { href: 'mailto:' + SF.MAIL, text: SF.MAIL }),
      (haveLink ? ' and mention ' + number : '') + '. Your payment receipt comes separately from Stripe.'
    ]));
    if (!haveLink) { SF.clear(status); orderIs('We emailed your confirmation.'); }
  }

  function quiet(message, retry) {
    SF.clear(status);
    status.appendChild(document.createTextNode(message + ' '));
    if (retry) status.appendChild(el('button', { type: 'button', cls: 'link', text: 'Try again', on: { click: function () { SF.clear(status); status.appendChild(document.createTextNode('Loading your order…')); look(0); } } }));
  }

  function draw(o) {
    SF.clear(status);
    SF.clear(detail);
    if (o.status === 'expired' || o.status === 'failed') {
      h1.textContent = 'No charge was made.';
      document.title = 'No charge · ShowFuse';
      ledeText(['Order ', el('b', { text: o.number }), ' wasn\'t paid, so nothing was bought.']);
      return;
    }
    if (o.status === 'pending') orderIs('We\'re confirming your payment. Your confirmation email comes as soon as it clears.');
    else orderIs('We emailed your confirmation.');
    detail.appendChild(window.SFOrder.track(o));
    detail.appendChild(window.SFOrder.summary(o));
  }

  function look(attempt) {
    if (!haveLink) return;
    SF.request('GET', '/v1/shop/order?n=' + encodeURIComponent(number) + '&t=' + encodeURIComponent(token), { timeout: 15000 }).then(function (j) {
      var o = window.SFOrder.norm(j);
      if (!o) { quiet('We couldn\'t show the details just now. Your confirmation email has them.', true); done(true); return; }
      draw(o);
      if (o.status !== 'expired' && o.status !== 'failed') done(true);
      // Still waiting on the payment: the server checks with Stripe again each time we ask.
      if (o.status === 'pending' && attempt < 6) {
        setTimeout(function () { look(attempt + 1); }, 4000);
      } else if (o.status === 'pending') {
        SF.clear(status);
        status.appendChild(document.createTextNode('Still confirming. You can close this page: your confirmation email comes as soon as the payment clears.'));
      }
    }, function (err) {
      if (err && err.status === 404) {
        quiet('We couldn\'t find that order. If you just paid, your confirmation email has the details.', false);
        return;
      }
      // Anything else: the page still says thank you. You came here from Stripe, so the bag has done its job.
      quiet(err && err.status === 429 ? 'Lots of people asking just now.' : 'We couldn\'t load the order details just now. Your confirmation email has them.', true);
      done(true);
    });
  }

  // The order went through (or is going through): the bag has done its job.
  var cleared = false;
  function done(ok) {
    if (ok && !cleared) { cleared = true; Bag.clear(); Bag.forgetCheckoutKey(); }
  }

  firstDraw();
  look(0);

  SF.config(true).then(function (cfg) {
    SF.renderNav(cfg, { here: 'shop', bag: false });
    SF.renderFooter(cfg);
    var b = SF.$('backBtn');
    if (b && cfg.visible) { b.setAttribute('href', SF.href('/shop/')); b.textContent = 'Back to the shop'; }
  }, function () {
    SF.renderNav(null, { here: 'shop', bag: false });
    SF.renderFooter(null);
  });
})();
