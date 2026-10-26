/* ShowFuse website: switches on the buttons that wait for an address (see /assets/config.js).
   Elements marked data-app point at APP_URL; elements marked data-store point at APP_STORE_URL. Both start hidden, so with
   an empty setting (or no script) nothing shows. Elements marked data-beta are the closed-beta wording and hide once the App Store link is set. */
(function () {
  var cfg = window.SF_CONFIG || {};
  function secure(u) {
    if (typeof u !== 'string' || !u) return null;
    try { var x = new URL(u, location.href); return x.protocol === 'https:' ? x.href : null; } catch (e) { return null; }
  }
  function reveal(attr, url) {
    if (!url) return;
    var els = document.querySelectorAll('[' + attr + ']');
    for (var i = 0; i < els.length; i++) { els[i].href = url; els[i].hidden = false; }
  }
  var app = secure(cfg.APP_URL), store = secure(cfg.APP_STORE_URL);
  reveal('data-app', app);
  reveal('data-store', store);
  if (app) document.documentElement.classList.add('has-app');
  if (store) {
    document.documentElement.classList.add('has-store');
    var beta = document.querySelectorAll('[data-beta]');
    for (var i = 0; i < beta.length; i++) beta[i].hidden = true;
  }
})();
