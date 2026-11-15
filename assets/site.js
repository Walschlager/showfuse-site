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
  // data-app-go="/signup": a link that is ALREADY visible (its own href is the fallback, e.g. the iPhone list) and goes straight to
  // that page of the web app once APP_URL is set. Only a plain path is taken, so nothing in the page can point it anywhere else.
  if (app) {
    var go = document.querySelectorAll('[data-app-go]');
    for (var g = 0; g < go.length; g++) {
      var path = go[g].getAttribute('data-app-go') || '/';
      if (/^\/[A-Za-z0-9/_-]*$/.test(path)) go[g].href = new URL(path, app).href;
    }
  }
  // the phone menu (the ⋯ button in the header)
  var btn = document.querySelector('.menu-btn'), menu = document.getElementById('siteMenu');
  if (btn && menu) {
    var set = function (open) { menu.hidden = !open; btn.setAttribute('aria-expanded', open ? 'true' : 'false'); };
    btn.addEventListener('click', function () { set(menu.hidden); });
    menu.addEventListener('click', function (e) { if (e.target.closest('a')) set(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !menu.hidden) { set(false); btn.focus(); } });
    document.addEventListener('click', function (e) { if (!menu.hidden && !menu.contains(e.target) && !btn.contains(e.target)) set(false); });
  }
  // "Copy" next to the email address (the clipboard only works from a click; if it's refused, the address is selected instead)
  var copies = document.querySelectorAll('[data-copy]');
  for (var c = 0; c < copies.length; c++) {
    copies[c].addEventListener('click', function (e) {
      var b = e.currentTarget, text = b.getAttribute('data-copy');
      function done() { b.textContent = 'Copied'; setTimeout(function () { b.textContent = 'Copy'; }, 1800); }
      function pick() { var t = b.previousElementSibling; if (!t) return; var r = document.createRange(); r.selectNodeContents(t); var s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, pick); else pick();
    });
  }
  if (store) {
    document.documentElement.classList.add('has-store');
    var beta = document.querySelectorAll('[data-beta]');
    for (var i = 0; i < beta.length; i++) beta[i].hidden = true;
  }
})();
