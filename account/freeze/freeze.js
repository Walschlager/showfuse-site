/* ShowFuse: /account/freeze/. Freeze your own account from the website (build 13, checkpoint 3.7).
   Three things have to happen, and nothing happens on page load:
     1. you prove it's you with a 6-digit code we email (not a password: someone who got in may have changed it)
     2. you tap "Freeze my account"
     3. you tap "Yes, freeze my account" (only this one asks the server to freeze)
   The email, the code and the one-use token stay in memory. Needs common.js and steps.js. */
(function () {
  'use strict';
  var SF = window.SF;
  if (!SF || !SF.step) return;
  var st = SF.step, $ = st.$, el = SF.el;

  var STEPS = ['a-email', 'a-code', 'a-freeze', 'a-confirm', 'a-done'];
  var RESEND_SECONDS = 45;
  var S = { email: '', token: null, busy: false };
  var cd = st.countdown($('resend'), RESEND_SECONDS);

  function show(id) { st.showStep(STEPS, id); }

  function restart(message) {
    cd.stop();
    S.token = null;
    $('code').value = '';
    st.clearError('codeErr');
    st.clearError('yesErr');
    show('a-email');
    if (message) st.showError('emailErr', message);
    $('email').focus();
  }

  // ---- 1 · email, then the code ----
  function requestCode(btn, errBox) {
    if (S.busy) return Promise.resolve(false);
    S.busy = true;
    st.busy(btn, 'Sending…');
    st.clearError(errBox);
    return SF.afterMinTime().then(function () {
      return SF.request('POST', '/v1/account/freeze/code', { json: SF.withBot({ email: S.email }) });
    }).then(function () {
      S.busy = false;
      st.unbusy(btn);
      return true;
    }, function (err) {
      S.busy = false;
      st.unbusy(btn);
      st.showError(errBox, err.message, err.code === 'network' ? ['Check your connection and try again.'] : [st.mailLine('Stuck? Email ', ' and we’ll freeze it for you.')]);
      return false;
    });
  }

  $('emailForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var email = $('email').value.trim();
    st.clearError('emailErr');
    if (!SF.isEmail(email)) { st.showError('emailErr', 'Type the email you use for ShowFuse.'); $('email').focus(); return; }
    S.email = email;
    requestCode($('emailBtn'), 'emailErr').then(function (ok) {
      if (!ok) return;
      $('codeTo').textContent = st.mask(S.email);
      $('code').value = '';
      show('a-code');
      cd.start();
      $('code').focus();
    });
  });

  $('resend').addEventListener('click', function () {
    cd.stop();
    $('code').value = '';
    var b = $('resend');
    requestCode(b, 'codeErr').then(function (ok) { if (ok) cd.start(); else { b.disabled = false; b.textContent = 'Send again'; } });
  });
  $('different').addEventListener('click', function () { restart(); });

  $('code').addEventListener('input', function () {
    // digits only; six of them check themselves
    var d = $('code').value.replace(/\D/g, '').slice(0, 6);
    if ($('code').value !== d) $('code').value = d;
  });

  $('codeForm').addEventListener('submit', function (e) {
    e.preventDefault();
    if (S.busy) return;
    var code = $('code').value.replace(/\D/g, '');
    st.clearError('codeErr');
    if (code.length !== 6) { st.showError('codeErr', 'Type the 6-digit code from the email.'); $('code').focus(); return; }
    var btn = $('codeBtn');
    S.busy = true;
    st.busy(btn, 'Checking…');
    SF.request('POST', '/v1/account/freeze/verify', { json: { email: S.email, code: code } }).then(function (res) {
      S.busy = false;
      st.unbusy(btn);
      if (!res || !res.token) { st.showError('codeErr', 'Something went wrong on our side. Try again in a minute.'); return; }
      S.token = res.token;
      cd.stop();
      $('signedIn').textContent = '✓ Signed in · ' + (res.email || st.mask(S.email));
      show('a-freeze');
    }, function (err) {
      S.busy = false;
      st.unbusy(btn);
      if (err.code === 'wrong_code') $('code').value = '';
      if (err.code === 'code_expired' || err.code === 'too_many_tries') $('code').value = '';
      st.showError('codeErr', err.message, err.code === 'network' ? ['Check your connection and tap the button again.'] : []);
      $('code').focus();
    });
  });

  // ---- 2 · freeze it: a tap to ask, a tap to be sure ----
  $('freezeBtn').addEventListener('click', function () { st.clearError('yesErr'); show('a-confirm'); });
  $('backBtn').addEventListener('click', function () { show('a-freeze'); });

  $('yesBtn').addEventListener('click', function () {
    if (S.busy) return;
    if (!S.token) { restart('This page timed out. Sign in again to freeze your account.'); return; }
    var btn = $('yesBtn'), tok = S.token;
    S.busy = true;
    st.busy(btn, 'Freezing…');
    st.clearError('yesErr');
    SF.request('POST', '/v1/account/freeze/confirm', { json: { token: tok } }).then(function () {
      S.busy = false;
      st.unbusy(btn);
      S.token = null;   // one use: forget it
      show('a-done');
    }, function (err) {
      S.busy = false;
      st.unbusy(btn);
      if (err.status === 410) { restart(err.message); return; }
      st.showError('yesErr', err.message, err.code === 'network' ? ['Check your connection and tap the button again.'] : [st.mailLine('Still stuck? Email ', ' and we’ll freeze it for you right away.')]);
    });
  });

  SF.ready.then(function () { $('email').focus(); });
})();
