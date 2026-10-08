/* ShowFuse: /freeze/ page.
   #t=…     freeze the account (from a sign-in alert or email-change email)
   #hold=…  stop a change that's set to happen in 72 hours
   Nothing happens on page load (email scanners open links). The person taps
   the button, then we POST. The token lives in memory only. */
(function () {
  'use strict';
  var SF = window.SF;
  if (!SF) return;
  var el = SF.el;
  function $(id) { return document.getElementById(id); }

  var SECTIONS = ['f-ask', 'f-done', 'h-ask', 'h-done', 'f-missing'];
  var mode = null, token = null, busy = false;

  function take() {
    var h = SF.takeHash();   // reads the hash, then wipes it
    if (h.hold) { mode = 'hold'; token = h.hold; }
    else if (h.t) { mode = 'freeze'; token = h.t; }
    return !!token;
  }

  function show(id) {
    SECTIONS.forEach(function (s) { $(s).hidden = s !== id; });
    var h1 = $(id).querySelector('h1');
    if (h1) { try { h1.focus({ preventScroll: true }); } catch (e) { h1.focus(); } }
  }

  function start() {
    [['freezeBtn', 'Freeze my account', 'freezeErr'], ['holdBtn', 'Stop it', 'holdErr']].forEach(function (x) {
      $(x[0]).disabled = false;
      $(x[0]).textContent = x[1];
      SF.clear($(x[2]));
    });
    show(mode === 'hold' ? 'h-ask' : mode === 'freeze' ? 'f-ask' : 'f-missing');
  }

  function mailLine(after) {
    return el('p', null, ['Email ', el('a', { href: 'mailto:info@showfuseapp.com', text: 'info@showfuseapp.com' }), after]);
  }

  function run(o) {
    if (busy) return;
    if (!token) { show('f-missing'); return; }
    busy = true;
    var tok = token, btn = $(o.btn), idle = btn.textContent, box = $(o.err);
    btn.disabled = true;
    btn.textContent = o.busyText;
    SF.clear(box);
    SF.afterMinTime().then(function () {
      return SF.request('POST', o.path, { json: SF.withBot({ token: tok }) });
    }).then(function (res) {
      busy = false;
      if (token === tok) token = null;   // single use: forget it (unless a newer link came in)
      o.done(res || {});
    }, function (err) {
      busy = false;
      btn.disabled = false;
      btn.textContent = idle;
      SF.clear(box);
      box.appendChild(el('p', { text: err.message }));
      box.appendChild(err.code === 'network' ? el('p', { text: 'Check your connection and tap the button again.' }) : mailLine(o.helpAfter));
    });
  }

  $('freezeBtn').addEventListener('click', function () {
    run({
      btn: 'freezeBtn', err: 'freezeErr', path: '/v1/account/freeze', busyText: 'Freezing…',
      helpAfter: ' and we’ll freeze it for you right away.',
      done: function (res) {
        var n = $('fName');
        n.textContent = res.artist_name ? res.artist_name + ' is locked. Nobody can sign in or change it until we check in with you.'
          : 'Your account is locked. Nobody can sign in until we check in with you.';
        n.hidden = false;
        show('f-done');
      }
    });
  });

  $('holdBtn').addEventListener('click', function () {
    run({
      btn: 'holdBtn', err: 'holdErr', path: '/v1/account/stop-hold', busyText: 'Stopping…',
      helpAfter: ' and we’ll stop it for you right away.',
      done: function (res) {
        var n = $('hName');
        n.textContent = res.artist_name ? res.artist_name + ' stays with you.' : '';
        n.hidden = !res.artist_name;
        show('h-done');
      }
    });
  });

  take();
  SF.ready.then(start);
  // Another email link opened in this same tab.
  window.addEventListener('hashchange', function () { if (take() && !busy) start(); });
})();
