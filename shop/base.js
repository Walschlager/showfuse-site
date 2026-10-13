/* ShowFuse shop: which API a page talks to. Shared by the shop pages and the support page.
   No third-party code, nothing stored.

     showfuseapp.com                 the real API
     localhost                       the local API (port 3000)
     localhost + ?api=practice       the practice server. Honored ONLY when the page itself is on
                                     localhost, so no link on the real site can point at it.
     localhost + ?fake=1             canned answers for every shop call from /shop/dev-fake.js,
                                     so the pages can be reviewed with no server
     localhost + ?fake=checkout      the API above for config, products and quote; canned answers
                                     for checkout, cancel and order (so nothing can reach Stripe) */
(function () {
  'use strict';

  var PROD = 'https://showfuse-api-production.up.railway.app';
  var LOCAL = 'http://localhost:3000';
  var PRACTICE = 'https://showfuse-app-dev-staging.up.railway.app';
  // Dev switches that ride along on links between shop pages (localhost only).
  var DEV_KEYS = ['fake', 'api', 'shop', 'tax', 'pay', 'co', 'evil'];

  var host = location.hostname;
  var local = host === 'localhost' || host === '127.0.0.1';
  var search = local ? location.search : '';

  function param(name) {
    var m = new RegExp('(?:^|[?&])' + name + '=([^&]*)').exec(search);
    if (!m) return null;
    try { return decodeURIComponent(m[1]); } catch (e) { return null; }
  }

  var practice = param('api') === 'practice';
  var fake = param('fake');
  if (fake !== '1' && fake !== 'checkout') fake = null;
  var api = !local ? PROD : practice ? PRACTICE : LOCAL;

  var carry = [];
  if (local) {
    DEV_KEYS.forEach(function (k) {
      var v = k === 'fake' ? fake : k === 'api' ? (practice ? 'practice' : null) : param(k);
      if (v !== null && /^[a-z0-9_-]{1,20}$/i.test(v)) carry.push(k + '=' + encodeURIComponent(v));
    });
  }

  // Dev only: swaps in canned API answers. Never runs outside localhost.
  var ready = new Promise(function (resolve) {
    if (!fake) { resolve(); return; }
    var s = document.createElement('script');
    s.src = '/shop/dev-fake.js';
    s.onload = function () { resolve(); };
    s.onerror = function () { resolve(); };
    document.head.appendChild(s);
  });

  window.SFBase = {
    api: api, local: local, practice: practice, fake: fake, ready: ready,
    carry: carry.join('&'),
    PROD: PROD, LOCAL: LOCAL, PRACTICE: PRACTICE
  };
})();
