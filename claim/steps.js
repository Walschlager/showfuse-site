/* ShowFuse account pages (freeze, get back in): small helpers for a page that is a row of steps.
   Needs common.js first. Nothing is stored anywhere: the email, the code and the one-use token live in memory. */
(function () {
  'use strict';
  var SF = window.SF;
  if (!SF) return;
  var el = SF.el;

  function $(id) { return document.getElementById(id); }

  // Show one step of the page and hide the rest; the heading takes focus so a screen reader starts there.
  function showStep(all, id) {
    all.forEach(function (s) { $(s).hidden = s !== id; });
    var h1 = $(id).querySelector('h1');
    if (h1) { try { h1.focus({ preventScroll: true }); } catch (e) { h1.focus(); } }
    window.scrollTo(0, 0);
  }

  // The server's own sentence in a box, then any extra lines (each text, never markup).
  function showError(boxId, message, extra) {
    var box = $(boxId);
    SF.clear(box);
    box.appendChild(el('p', { text: message }));
    (extra || []).forEach(function (line) { box.appendChild(typeof line === 'string' ? el('p', { text: line }) : line); });
  }
  function clearError(boxId) { SF.clear($(boxId)); }

  function mailLine(before, after) {
    return el('p', null, [before, el('a', { href: 'mailto:info@showfuseapp.com', text: 'info@showfuseapp.com' }), after]);
  }

  // A button that says it is working, and says what it did before when it's done.
  function busy(btn, text) { btn.disabled = true; btn.dataset.idle = btn.textContent; btn.textContent = text; }
  function unbusy(btn) { btn.disabled = false; if (btn.dataset.idle) btn.textContent = btn.dataset.idle; }

  // "a•••@example.com": the same shape the server uses for an address it says back.
  function mask(email) {
    var at = email.lastIndexOf('@');
    return at < 1 ? email : email.charAt(0) + '•••' + email.slice(at);
  }

  // A "Send again in 0:45" link that comes back when the time is up.
  function countdown(btn, seconds) {
    var timer = null, left = 0;
    function pad(n) { return n < 10 ? '0' + n : String(n); }
    function tick() {
      if (left <= 0) { stop(); btn.disabled = false; btn.textContent = 'Send again'; return; }
      btn.disabled = true;
      btn.textContent = 'Send again in 0:' + pad(left);
      left--;
    }
    function stop() { if (timer) clearInterval(timer); timer = null; }
    return {
      start: function () { stop(); left = seconds; tick(); timer = setInterval(tick, 1000); },
      stop: stop
    };
  }

  SF.step = { $: $, showStep: showStep, showError: showError, clearError: clearError, mailLine: mailLine, busy: busy, unbusy: unbusy, mask: mask, countdown: countdown };
})();
