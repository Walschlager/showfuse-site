/* ShowFuse: /get-back-in/. Open a frozen account again from the website (build 13, checkpoint 3.7).
     1. you prove the inbox with a 6-digit code we email (we only send one if YOU froze the account: a reviewer's freeze
        is not yours to undo, and we say so)
     2. you choose a new password (the old one stops working, and every device stays signed out)
     3. you're back in: sign in on the phone
   Nothing happens on page load. The email, the code and the one-use token stay in memory. Needs common.js and steps.js. */
(function () {
  'use strict';
  var SF = window.SF;
  if (!SF || !SF.step) return;
  var st = SF.step, $ = st.$;

  var STEPS = ['g-email', 'g-code', 'g-pass', 'g-done'];
  var RESEND_SECONDS = 45;
  var S = { email: '', hint: '', token: null, busy: false };
  var cd = st.countdown($('resend'), RESEND_SECONDS);

  function show(id) { st.showStep(STEPS, id); }

  function restart(message) {
    cd.stop();
    S.token = null;
    $('code').value = '';
    $('p1').value = '';
    $('p2').value = '';
    st.clearError('codeErr');
    st.clearError('passErr');
    show('g-email');
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
      return SF.request('POST', '/v1/account/get-back-in/code', { json: SF.withBot({ email: S.email }) });
    }).then(function () {
      S.busy = false;
      st.unbusy(btn);
      return true;
    }, function (err) {
      S.busy = false;
      st.unbusy(btn);
      st.showError(errBox, err.message, err.code === 'network' ? ['Check your connection and try again.'] : [st.mailLine('Stuck? Email ', ' and we’ll help.')]);
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
      show('g-code');
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
    SF.request('POST', '/v1/account/get-back-in/verify', { json: { email: S.email, code: code } }).then(function (res) {
      S.busy = false;
      st.unbusy(btn);
      if (!res || !res.token) { st.showError('codeErr', 'Something went wrong on our side. Try again in a minute.'); return; }
      S.token = res.token;
      S.hint = res.email || st.mask(S.email);
      cd.stop();
      $('confirmed').textContent = '✓ Email confirmed · ' + S.hint;
      $('p1').value = '';
      $('p2').value = '';
      st.clearError('passErr');
      show('g-pass');
      $('p1').focus();
    }, function (err) {
      S.busy = false;
      st.unbusy(btn);
      if (err.code === 'wrong_code' || err.code === 'code_expired' || err.code === 'too_many_tries') $('code').value = '';
      // A reviewer's freeze, or an account waiting to be deleted: the server's own sentence, and the one way forward (unless the sentence already names the address).
      var extra = (err.code === 'frozen_by_reviewer' || err.code === 'closing' || err.code === 'not_frozen') && !/info@showfuseapp\.com/.test(err.message) ? [st.mailLine('Questions? Email ', '.')] : [];
      st.showError('codeErr', err.message, err.code === 'network' ? ['Check your connection and tap the button again.'] : extra);
      $('code').focus();
    });
  });

  // ---- 2 · a new password ----
  function strength(pw) {
    if (pw.length < 8) return ['weak', 'Too short'];
    if (pw.length >= 12 || (/[a-z]/.test(pw) && /[A-Z]/.test(pw) && /\d/.test(pw))) return ['strong', 'Strong'];
    return ['ok', 'OK'];
  }
  $('p1').addEventListener('input', function () {
    var s = strength($('p1').value), tag = $('strength');
    tag.className = 'strength ' + s[0];
    tag.textContent = s[1];
  });

  $('passForm').addEventListener('submit', function (e) {
    e.preventDefault();
    if (S.busy) return;
    var a = $('p1').value, b = $('p2').value;
    st.clearError('passErr');
    if (a.length < 8) { st.showError('passErr', 'Use at least 8 characters.'); $('p1').focus(); return; }
    if (a !== b) { st.showError('passErr', 'Those two don’t match. Type the same password twice.'); $('p2').focus(); return; }
    if (!S.token) { restart('This page timed out. Start again to get back in.'); return; }
    var btn = $('passBtn');
    S.busy = true;
    st.busy(btn, 'Saving…');
    SF.request('POST', '/v1/account/get-back-in/finish', { json: { token: S.token, password: a } }).then(function () {
      S.busy = false;
      st.unbusy(btn);
      S.token = null;   // one use: forget it, and the password with it
      $('p1').value = '';
      $('p2').value = '';
      $('doneEmail').textContent = S.hint;
      show('g-done');
    }, function (err) {
      S.busy = false;
      st.unbusy(btn);
      if (err.status === 410) { restart(err.message); return; }
      var extra = (err.code === 'frozen_by_reviewer' || err.code === 'closing') && !/info@showfuseapp\.com/.test(err.message) ? [st.mailLine('Questions? Email ', '.')] : [];
      st.showError('passErr', err.message, err.code === 'network' ? ['Check your connection and tap the button again.'] : extra);
    });
  });

  SF.ready.then(function () { $('email').focus(); });
})();
