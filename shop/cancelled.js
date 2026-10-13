/* ShowFuse: /shop/cancelled/?n=SF-1042&t=<token>. Where Stripe sends people who leave the payment page.
   "No charge was made" is on the page from the start (it is in the HTML). The page also tells the
   server to let go of the held items right away: POST /v1/shop/checkout/cancel. Safe to run twice.
   The bag is left exactly as it was. Server text always goes in with textContent. */
(function () {
  'use strict';
  var SF = window.SFShop;
  if (!SF) return;

  function query(name) {
    var m = new RegExp('(?:^|[?&])' + name + '=([^&]*)').exec(location.search);
    if (!m) return '';
    try { return decodeURIComponent(m[1].replace(/\+/g, ' ')); } catch (e) { return ''; }
  }
  var number = query('n');
  var token = query('t');
  var haveLink = /^SF-\d{3,9}$/.test(number) && /^[A-Za-z0-9_-]{8,64}$/.test(token);
  // "Your bag is just as you left it" is only said when there is something in it (a browser that
  // blocks storage can lose the bag on the way to Stripe and back).
  var haveBag = SF.Bag.count() > 0;

  var BASE = 'You left the payment page before paying, so nothing was bought. ';
  var BAG = 'Your bag is just as you left it.';

  function say(text) { SF.$('lede').textContent = text; }

  function cancel() {
    if (!haveLink) return;
    SF.request('POST', '/v1/shop/checkout/cancel', { json: { number: number, token: token }, timeout: 20000 }).then(function (res) {
      if (res && res.status === 'paid') {
        SF.$('head').textContent = 'That order was already paid.';
        say('You already paid for this order, so it wasn\'t cancelled. Your confirmation email has the details.');
      } else if (res && res.status === 'pending') {
        say(BASE + 'We\'re still ending this checkout. No charge was made.' + (haveBag ? ' ' + BAG : ''));
      } else if (res && (res.released === true || res.status === 'expired' || res.status === 'failed')) {
        // "expired" means the checkout is over and its stock is back, whether this call or an earlier one did it.
        SF.Bag.forgetCheckoutKey();   // that checkout has ended: the next try gets a fresh key
        say(BASE + 'We\'ve let go of the items we were holding' + (haveBag ? ', and your bag is just as you left it.' : '.'));
      }
    }, function () {
      // A wrong link or no connection: the page already says what matters. The held items are let go on their own in a few minutes.
    });
  }

  SF.config(true).then(function (cfg) {
    SF.renderNav(cfg, { here: 'shop' });
    SF.renderFooter(cfg);
    // Only point people at the shop while the shop says it is open.
    if (!cfg.open) SF.$('bagBtn').hidden = true;
    if (cfg.visible) {
      SF.$('shopBtn').setAttribute('href', SF.href('/shop/'));
      SF.$('shopBtn').textContent = 'Keep shopping';
    }
  }, function () {
    SF.renderNav(null, { here: 'shop' });
    SF.renderFooter(null);
  });
  SF.$('bagBtn').setAttribute('href', SF.href('/shop/bag/'));
  SF.$('bagBtn').hidden = !haveBag;
  if (!haveBag) SF.$('shopBtn').className = 'btn';   // nothing to go back to: the way out is the main button
  say(BASE + (haveBag ? BAG : ''));
  cancel();
})();
