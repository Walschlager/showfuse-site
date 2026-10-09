/* ShowFuse: claim your artist page. Built against docs/CLAIM_API.md.
   Flows on this one page:
     claim   search → email → code → two proofs (or an invite code) → done
     invite  #invite=…  → code → birthday if needed + terms → done
     status  #status=…  → where the claim stands (+ add proof when we asked for more)
     report  "Report it" on a claimed page → email → code → proof → done
   Tokens live in memory only. The hash is wiped the moment it's read.
   Server and user text always goes in with textContent. */
(function () {
  'use strict';
  var SF = window.SF;
  if (!SF) return;
  var el = SF.el;

  var IG_HANDLE = '@showfuse';   // where artists DM their code (from the approved mock)
  var RESEND_SECONDS = 45;
  var MAX_FILE = 10 * 1024 * 1024;
  var ADDR = 'info@showfuseapp.com';
  var MAIL = 'mailto:' + ADDR;
  var SCREENS = ['loading', 'search', 'email', 'report', 'code', 'proof', 'done', 'status', 'oops'];
  var STEP_OF = { search: 1, report: 1, email: 2, code: 2, proof: 3 };
  var STEP_LABELS = {
    claim: ['Find your name', 'Confirm your email', 'Show two proofs'],
    report: ['Tell us', 'Confirm your email', 'Show two proofs']
  };

  function $(id) { return id ? document.getElementById(id) : null; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  // ---------- state (memory only) ----------
  function fresh(flow) {
    return {
      flow: flow, artist: null, email: '', masked: '', message: '',
      claimId: null, inviteToken: null, claimToken: null, claim: null, mode: null,
      big: false, proofId: null, uploading: false, upSeq: 0, busy: false,
      statusToken: null, status: null, moreFile: null
    };
  }
  var S = fresh('claim');

  // Pages the server told us are big. Search shows the size we have on file,
  // but submit counts fans live, so a page can look small and still be big.
  var knownBig = {};
  function bigPage(a) { return !!a && (a.size === 'big' || knownBig[a.id] === true); }

  // Read the link's hash right away; takeHash wipes it from the address bar.
  var boot = SF.takeHash();

  document.querySelectorAll('.ighandle').forEach(function (n) { n.textContent = IG_HANDLE; });

  // ---------- screens + progress ----------
  function show(name, focusId) {
    SCREENS.forEach(function (s) { $('s-' + s).hidden = s !== name; });
    progress(name);
    window.scrollTo(0, 0);
    var f = focusId ? $(focusId) : $('s-' + name).querySelector('h1');
    if (f) { try { f.focus({ preventScroll: true }); } catch (e) { f.focus(); } }
  }

  function progress(name) {
    var prog = $('prog'), step = STEP_OF[name];
    if (!step || S.flow === 'invite' || S.flow === 'status') { prog.hidden = true; return; }
    var labels = STEP_LABELS[S.flow === 'report' ? 'report' : 'claim'];
    var items = prog.querySelectorAll('li');
    for (var i = 0; i < items.length; i++) {
      var n = i + 1, li = items[i];
      li.className = n < step ? 'done' : n === step ? 'now' : '';
      li.querySelector('.pn').textContent = n < step ? '✓' : String(n);
      li.querySelector('.pl').textContent = labels[i];
      if (n === step) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    }
    prog.hidden = false;
  }

  // ---------- errors + next steps ----------
  // acts: [[label, function], [label, 'mailto:…'], …]
  function fillActions(box, acts, big) {
    SF.clear(box);
    (acts || []).forEach(function (a, i) {
      var cls = big ? (i === 0 ? 'btn' : 'btn ghost') : 'link';
      box.appendChild(typeof a[1] === 'string'
        ? el('a', { cls: big ? cls : null, href: a[1], text: a[0] })
        : el('button', { type: 'button', cls: cls, text: a[0], on: { click: a[1] } }));
    });
    return box;
  }
  function mailAct() { return ['Email ' + ADDR, MAIL]; }

  // Our address as plain text anyone can select (a mailto link doesn't open
  // everywhere), plus a Copy button for the actions row.
  function addrLine(before, after) {
    return el('p', null, [before, el('span', { cls: 'addr', text: ADDR }), after]);
  }
  // A server message that already names our address, word for word, with the
  // address made easy to select. null when the message doesn't name it.
  function msgWithAddr(msg) {
    var i = String(msg || '').indexOf(ADDR);
    return i < 0 ? null : addrLine(msg.slice(0, i), msg.slice(i + ADDR.length));
  }
  function copyAct() {
    return ['Copy address', function (e) {
      var b = e.currentTarget, box = b.closest('.err');
      copyText(b, ADDR, box && box.querySelector('.addr'));
    }];
  }

  // Copies text. If the browser says no, selects it so a long-press can copy.
  function copyText(btn, text, src) {
    var idle = btn.dataset.idle || btn.textContent;
    btn.dataset.idle = idle;
    var select = function () {
      if (!src) return;
      var r = document.createRange();
      r.selectNodeContents(src);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    };
    var copied = function () { btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = idle; }, 2000); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(copied, select);
    else select();
  }

  // msg and extra: text, or a ready-made node.
  function showErr(id, msg, acts, extra) {
    var box = $(id);
    if (!box) return;
    SF.clear(box);
    box.appendChild(msg && typeof msg === 'object' ? msg : el('p', { text: msg || 'Something went wrong. Try again.' }));
    if (extra) box.appendChild(typeof extra === 'string' ? el('p', { text: extra }) : extra);
    if (acts && acts.length) box.appendChild(fillActions(el('div', { cls: 'next' }), acts, false));
  }
  function hideErr(id) { SF.clear($(id)); }

  function oops(title, msg, next, acts) {
    $('oopsTitle').textContent = title;
    $('oopsText').textContent = msg || '';
    $('oopsNext').textContent = next || '';
    $('oopsNext').hidden = !next;
    fillActions($('oopsActions'), acts, true);
    show('oops');
  }

  function busy(b, text) {
    if (!b) return;
    if (!b.dataset.label) b.dataset.label = b.textContent;
    b.disabled = true;
    b.textContent = text;
  }
  function unbusy(b) {
    if (!b) return;
    b.disabled = false;
    if (b.dataset.label) { b.textContent = b.dataset.label; delete b.dataset.label; }
  }

  // ---------- artists ----------
  function initial(name) { var s = String(name || '').trim(); return s ? Array.from(s)[0].toUpperCase() : '?'; }
  function safeImg(u) { return typeof u === 'string' && /^(https:\/\/|blob:)/i.test(u) ? u : null; }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function genresText(a) {
    var g = a && Array.isArray(a.genres) ? a.genres.filter(function (x) { return typeof x === 'string' && x; }).slice(0, 3) : [];
    return g.length ? g.map(cap).join(' · ') : 'On ShowFuse';
  }
  function artistName() { return (S.artist && S.artist.name) || 'your page'; }

  function avatar(a, small) {
    var box = el('span', { cls: small ? 'ava sm' : 'ava', 'aria-hidden': 'true' });
    var src = safeImg(a && a.image_url);
    if (src) {
      var img = el('img', { src: src, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
      img.addEventListener('error', function () { SF.clear(box); box.textContent = initial(a.name); });
      box.appendChild(img);
    } else {
      box.textContent = initial(a && a.name);
    }
    return box;
  }

  function fillPicked() {
    var a = S.artist || {};
    document.querySelectorAll('[data-picked]').forEach(function (n) {
      SF.clear(n);
      n.appendChild(avatar(a, true));
      n.appendChild(el('span', { cls: 'pk' }, [
        el('b', { text: a.name || 'Your page' }),
        el('small', { text: S.flow !== 'report' && bigPage(a) ? 'Big page' : genresText(a) })   // size never matters for a report
      ]));
      if (S.flow !== 'invite') {
        n.appendChild(el('button', { type: 'button', cls: 'link', text: S.flow === 'report' ? 'Not this one?' : 'Not you?', on: { click: backToSearch } }));
      }
    });
  }

  function backToSearch() {
    stopCountdown();
    S = fresh('claim');
    show('search');
  }

  // ---------- step 1: search ----------
  var q = $('q'), results = $('results'), searchSeq = 0, searchTimer = null;

  q.addEventListener('input', function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, 280);
  });
  $('searchForm').addEventListener('submit', function (e) {
    e.preventDefault();
    clearTimeout(searchTimer);
    runSearch();
    q.blur();
  });

  function searchMsg(text, spin) {
    SF.clear(results);
    if (!text) return;
    var p = el('p', { cls: 'msg' });
    if (spin) p.appendChild(el('span', { cls: 'spin', 'aria-hidden': 'true' }));
    p.appendChild(document.createTextNode(text));
    results.appendChild(p);
  }

  function runSearch() {
    var v = q.value.trim().slice(0, 60);
    var my = ++searchSeq;
    $('notListed').hidden = true;
    $('addBox').hidden = true;
    $('searchStatus').textContent = '';
    if (v.length < 2) { searchMsg(v ? 'Type at least 2 letters.' : ''); return; }
    searchMsg('Looking…', true);
    SF.request('GET', '/v1/claim/search?q=' + encodeURIComponent(v)).then(function (res) {
      if (my !== searchSeq) return;
      renderResults(v, res && Array.isArray(res.results) ? res.results : []);
    }, function (err) {
      if (my !== searchSeq) return;
      SF.clear(results);
      var box = el('div', { cls: 'err', role: 'alert' }, [el('p', { text: err.message })]);
      box.appendChild(fillActions(el('div', { cls: 'next' }), [['Try again', runSearch]], false));
      results.appendChild(box);
    });
  }

  function renderResults(v, list) {
    SF.clear(results);
    list = list.filter(function (a) { return a && a.id && a.name; }).slice(0, 12);
    if (!list.length) {
      $('searchStatus').textContent = 'No match.';
      showAdd('We don’t have “' + v + '” on ShowFuse yet', v);
      return;
    }
    list.forEach(function (a) { results.appendChild(resultRow(a)); });
    $('searchStatus').textContent = list.length === 1 ? '1 match.' : list.length + ' matches.';
    $('notListed').hidden = false;
  }

  function resultRow(a) {
    var open = a.state === 'open';
    var mid = el('div', { cls: 'rmid' }, [el('b', { text: a.name }), el('small', { text: genresText(a) })]);
    var action;
    if (open) {
      if (bigPage(a)) {
        mid.appendChild(el('span', { cls: 'bigtag' }, [el('b', { text: 'Big page' }), ' · claim with your band email and an Instagram DM, or an invite code']));
      }
      action = el('button', { type: 'button', cls: 'tagc', text: 'Claim', 'aria-label': 'Claim ' + a.name, on: { click: function () { pickArtist(a); } } });
    } else {
      // claimed or frozen: locked for good, but the real artist can report it
      mid.appendChild(el('span', { cls: 'rfine' }, ['Is this you? ', el('button', { type: 'button', cls: 'link', text: 'Report it', 'aria-label': 'Report ' + a.name, on: { click: function () { startReport(a); } } })]));
      action = el('span', { cls: 'tagc locked', text: 'Claimed ✓' });
    }
    return el('div', { cls: 'result' }, [avatar(a), mid, action]);
  }

  // "Ask us to add you"
  function showAdd(title, name) {
    $('addTitle').textContent = title;
    $('addKicker').hidden = title === 'Ask us to add you';
    var n = $('aName');
    if (name && (!n.value || n.dataset.auto === '1')) { n.value = name; n.dataset.auto = '1'; }
    $('addForm').hidden = false;
    $('addDone').hidden = true;
    hideErr('addErr');
    $('addBox').hidden = false;
  }
  $('aName').addEventListener('input', function () { this.dataset.auto = '0'; });
  $('openAdd').addEventListener('click', function () {
    showAdd('Ask us to add you', q.value.trim());
    $('notListed').hidden = true;
    try { $('addTitle').focus({ preventScroll: true }); } catch (e) { $('addTitle').focus(); }
    $('addBox').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('addForm').addEventListener('submit', function (e) { e.preventDefault(); sendAddRequest(); });

  function sendAddRequest() {
    var name = $('aName').value.trim(), email = $('aEmail').value.trim();
    var sp = $('aSpotify').value.trim(), note = $('aNote').value.trim(), btn = $('addBtn');
    hideErr('addErr');
    if (!name) { showErr('addErr', 'Add your artist name.'); $('aName').focus(); return; }
    if (!SF.isEmail(email)) { showErr('addErr', 'That email doesn’t look right. Check it and try again.'); $('aEmail').focus(); return; }
    if (sp && !/spotify/i.test(sp)) {
      showErr('addErr', 'That doesn’t look like a Spotify link. In Spotify, open your artist page, tap Share, then Copy link.');
      $('aSpotify').focus();
      return;
    }
    var body = { name: name, email: email };   // optional fields only when filled in
    if (sp) body.spotify_url = /^spotify:/i.test(sp) ? sp : /^https?:\/\//i.test(sp) ? sp.replace(/^http:/i, 'https:') : 'https://' + sp;
    if (note) body.note = note;
    busy(btn, 'Sending…');
    SF.afterMinTime().then(function () {
      return SF.request('POST', '/v1/claim/request-add', { json: SF.withBot(body) });
    }).then(function () {
      unbusy(btn);
      $('addForm').hidden = true;
      var done = $('addDone');
      SF.clear(done);
      done.appendChild(el('b', { text: '✓ Thanks! We got it.' }));
      done.appendChild(document.createTextNode(' We’ll look for ' + name + ' and email ' + email + ' when your page is ready to claim.'));
      done.hidden = false;
    }, function (err) {
      unbusy(btn);
      if (err.code === 'invalid_link') { showErr('addErr', err.message); $('aSpotify').focus(); return; }
      showErr('addErr', err.message, err.code === 'network' || err.code === 'too_fast' ? [['Try again', sendAddRequest]] : [mailAct()]);
    });
  }

  // ---------- step 2: email + code ----------
  function pickArtist(a) {
    S = fresh('claim');
    S.artist = a;
    fillPicked();
    $('bigNote').hidden = !bigPage(a);
    hideErr('emailErr');
    show('email', 'email');
  }

  $('emailForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var email = $('email').value.trim();
    hideErr('emailErr');
    if (!SF.isEmail(email)) { showErr('emailErr', 'That email doesn’t look right. Check it and try again.'); $('email').focus(); return; }
    S.email = email;
    requestCode($('emailBtn'), 'emailErr', false);
  });

  function useDifferentEmail() {
    var old = S;
    stopCountdown();
    S = fresh(old.flow === 'report' ? 'report' : 'claim');
    S.artist = old.artist;
    S.message = old.message;
    fillPicked();
    if (S.flow === 'report') {
      hideErr('reportErr');
      show('report', 'rEmail');
      $('rEmail').select();
    } else {
      $('bigNote').hidden = !bigPage(S.artist);
      hideErr('emailErr');
      show('email', 'email');
      $('email').select();
    }
  }
  $('diffEmail').addEventListener('click', useDifferentEmail);

  // Sends (or sends again) the 6-digit code for whichever flow we're in.
  function requestCode(btn, errId, again) {
    var path, body;
    if (S.flow === 'report') { path = '/v1/claim/report/start'; body = { artist_id: S.artist.id, email: S.email, message: S.message }; }
    else if (S.flow === 'invite') { path = '/v1/claim/invite/open'; body = { invite_token: S.inviteToken }; }
    else { path = '/v1/claim/start'; body = { artist_id: S.artist.id, email: S.email }; }
    var mine = S;
    busy(btn, 'Sending…');
    hideErr(errId);
    return SF.afterMinTime().then(function () {
      return SF.request('POST', path, { json: SF.withBot(body) });
    }).then(function (res) {
      unbusy(btn);
      if (S !== mine) return false;
      S.claimId = res.claim_id || S.claimId;
      if (S.flow === 'invite') {
        if (res.artist) S.artist = res.artist;
        if (res.email) S.masked = res.email;
      }
      if (again) $('codeInfo').textContent = res.code_sent === false ? 'We already sent a code a few minutes ago. Use that one.' : 'We sent a new code.';
      else {
        openCode();
        if (res.code_sent === false) $('codeInfo').textContent = 'We already sent you a code a few minutes ago. Use that one.';
      }
      startCountdown();
      return true;
    }, function (err) {
      unbusy(btn);
      if (S !== mine) return false;
      if (S.flow === 'invite' && !again) { inviteError(err); return false; }
      codeRequestError(err, errId, function () { requestCode(btn, errId, again); });
      return false;
    });
  }

  function codeRequestError(err, errId, retry) {
    var acts;
    if (err.code === 'page_claimed' && S.flow !== 'invite') acts = [['Report it', function () { startReport(S.artist); }], ['Search again', backToSearch]];
    else if (err.code === 'not_found') acts = [['Search again', backToSearch]];
    else if (err.code === 'rate_limited') acts = S.flow === 'invite' ? [mailAct()] : [['Use a different email', useDifferentEmail], mailAct()];
    else if (err.code === 'network' || err.code === 'too_fast') acts = [['Try again', retry]];
    else if (S.flow === 'report' && err.status === 409) acts = [['Claim it instead', function () { pickArtist(S.artist); }], ['Search again', backToSearch]];
    else acts = [mailAct()];
    showErr(errId, err.message, acts);
  }

  function openCode() {
    var invite = S.flow === 'invite';
    fillPicked();
    $('codeKicker').hidden = !invite;
    $('codeTitle').textContent = invite ? 'Claim ' + artistName() : 'Check your inbox';
    $('lockedWrap').hidden = !invite;
    $('lockedEmail').textContent = S.masked || '';
    var lede = $('codeLede');
    SF.clear(lede);
    if (invite) lede.textContent = 'We emailed you a 6-digit code. It’s in the subject line.';
    else lede.append('We sent a 6-digit code to ', el('b', { text: S.email }), '. It’s in the subject line.');
    $('diffWrap').hidden = invite;
    $('inviteWrong').hidden = !invite;
    codeIn.value = '';
    hideErr('codeErr');
    $('codeInfo').textContent = '';
    show('code', 'code');
  }

  var codeIn = $('code');
  codeIn.addEventListener('input', function () {
    var d = codeIn.value.replace(/\D/g, '').slice(0, 6);
    if (d !== codeIn.value) codeIn.value = d;
    if (d.length === 6) checkCode();
  });
  codeIn.addEventListener('paste', function (e) {
    var cd = e.clipboardData;
    if (!cd) return;
    var d = String(cd.getData('text') || '').replace(/\D/g, '').slice(0, 6);
    if (!d) return;
    e.preventDefault();
    codeIn.value = d;
    if (d.length === 6) checkCode();
  });
  $('codeForm').addEventListener('submit', function (e) { e.preventDefault(); checkCode(); });

  function checkCode() {
    if (S.busy) return;
    var code = codeIn.value.replace(/\D/g, '');
    hideErr('codeErr');
    $('codeInfo').textContent = '';
    if (code.length !== 6) { showErr('codeErr', 'Type the 6-digit code from the email.'); codeIn.focus(); return; }
    var mine = S, btn = $('codeBtn');
    S.busy = true;
    busy(btn, 'Checking…');
    SF.request('POST', '/v1/claim/verify', { json: SF.withBot({ claim_id: S.claimId, code: code }) }).then(function (res) {
      mine.busy = false;
      unbusy(btn);
      if (S === mine) verified(res);
    }, function (err) {
      mine.busy = false;
      unbusy(btn);
      if (S === mine) verifyError(err);
    });
  }

  function verifyError(err) {
    var invite = S.flow === 'invite', acts = [], extra = '', msg = err.message;
    var newCode = ['Send a new code', resendNow];
    var diff = ['Use a different email', useDifferentEmail];
    var ask = 'Ask the person who invited you to send the invite to a different email.';
    switch (err.code) {
      case 'wrong_code': codeIn.value = ''; codeIn.focus(); break;   // the message says how many tries are left
      case 'code_expired': codeIn.value = ''; acts = [newCode]; break;
      case 'too_many_tries': codeIn.value = ''; acts = invite ? [newCode] : [newCode, diff]; break;
      case 'already_owns_page':
        // One person, one account. A different email would make a second
        // account, so we join the pages by hand instead. The server's message
        // says to email us; ours fills in if it doesn't.
        $('diffWrap').hidden = true;
        msg = msgWithAddr(err.message) || err.message;
        if (typeof msg === 'string') extra = addrLine('Email ', ' and we’ll put both under one account.');
        acts = [copyAct()];
        break;
      case 'venue_account':
        msg = msgWithAddr(err.message) || err.message;
        if (typeof msg !== 'string') extra = invite ? ask : '';
        else extra = addrLine(invite ? ask + ' Or email ' : 'Is the venue yours too? Email ', ' and we’ll sort it out.');
        acts = invite ? [copyAct()] : [diff, copyAct()];
        break;
      case 'network': acts = [['Try again', checkCode]]; break;
      default: acts = [newCode, mailAct()];
    }
    showErr('codeErr', msg, acts, extra);
  }

  function verified(res) {
    if (!res || !res.claim_token || !res.claim) {
      showErr('codeErr', 'Something went wrong on our side. Try again in a minute.', [['Send a new code', resendNow]]);
      return;
    }
    S.claimToken = res.claim_token;   // memory only. status_token is for the receipt email, so we drop it.
    S.claim = res.claim;
    if (res.claim.artist) S.artist = Object.assign({}, S.artist || {}, res.claim.artist);
    stopCountdown();
    setupProof();
    show('proof');
  }

  // resend link with a 45-second countdown
  var cdTimer = null, cdLeft = 0;
  function startCountdown() {
    stopCountdown();
    cdLeft = RESEND_SECONDS;
    tick();
    cdTimer = setInterval(tick, 1000);
  }
  function stopCountdown() { if (cdTimer) clearInterval(cdTimer); cdTimer = null; }
  function tick() {
    var b = $('resend');
    if (cdLeft <= 0) { stopCountdown(); b.disabled = false; b.textContent = 'Send again'; return; }
    b.disabled = true;
    b.textContent = 'Send again in 0:' + pad(cdLeft);
    cdLeft--;
  }
  function resendNow() {
    stopCountdown();
    codeIn.value = '';
    hideErr('codeErr');
    $('codeInfo').textContent = '';
    var b = $('resend');
    b.disabled = true;
    b.textContent = 'Sending…';
    requestCode(null, 'codeErr', true).then(function (ok) {
      if (!ok) { b.disabled = false; b.textContent = 'Send again'; }
    });
  }
  $('resend').addEventListener('click', resendNow);

  // ---------- step 3: two proofs (or one invite code) ----------
  function setupProof() {
    var c = S.claim;
    var invite = c.invite === true || S.flow === 'invite';
    var band = c.email_kind === 'band';
    var claim = c.kind ? c.kind === 'claim' : S.flow !== 'report';   // invites are claims too
    S.mode = invite ? 'invite' : 'proofs';
    S.big = claim && !invite && bigPage(S.artist);   // the server ignores size on reports
    S.proofId = null; S.uploading = false; S.upSeq++;
    S.storedShots = c.proof_count || 0;   // screenshots already saved for this claim (another tab, or before a reload)
    fillPicked();

    $('proofKicker').hidden = !invite;
    $('proofTitle').textContent = invite ? 'Almost done' : 'Show two proofs';
    $('proofEmail').textContent = c.email || S.email || S.masked;
    // Approving a claim takes over an account that already uses this email. A report never does.
    $('acctNote').hidden = !claim || c.account !== 'existing';
    $('acctName').textContent = (S.artist && S.artist.name) || 'this artist';
    var lede = $('proofLede');
    lede.textContent = invite ? 'One last step and ' + artistName() + ' is yours. No review needed.'
      : S.flow === 'report' ? 'Once you send it, we look at both sides.' : '';
    lede.hidden = !lede.textContent;

    $('proofList').hidden = invite;
    paintBig();
    $('shotHint').textContent = 'Your Spotify for Artists, DistroKid or similar dashboard, with “' + artistName() + '” showing.';
    var email = c.email || S.email;
    $('bandText').textContent = band
      ? email + ' is a band email. We’ll match it to your website.'
      : 'You used ' + email + ', so this one doesn’t count. Got an email at your own domain, like you@yourband.com? Start again with it.';
    $('bandTag').hidden = !band;
    $('bandFix').hidden = band;
    $('rBand').classList.toggle('na', !band);
    $('rDm').hidden = !c.dm_code;
    $('dmCode').textContent = c.dm_code || '';
    $('dmSent').checked = false;
    $('invCode').value = '';
    $('optBox').hidden = invite;
    $('optBox').open = true;
    $('proofFine').hidden = invite;

    $('shotDone').hidden = true;
    $('shotPick').hidden = false;
    $('shotNote').hidden = false;
    hideErr('shotErr');
    if (S.storedShots > 0) shotAlreadyThere();
    // An invite code can't fix a report: the page is already claimed.
    $('rCode').hidden = !claim || invite;
    $('dobField').hidden = !c.needs_dob;
    $('dob').value = '';   // browsers restore old form values; start this claim clean
    $('dob').max = todayISO();
    $('terms').checked = false;
    hideErr('sendErr');
    unbusy($('sendBtn'));
    updateSend();
  }

  // Big pages (claims only): a screenshot can't count, so its row goes away.
  function paintBig() {
    $('pBigNote').hidden = !S.big;
    $('rShot').hidden = S.big;
  }

  // Submit answered big_page_proof: the live fan count says big, whatever
  // search showed. Remember it for this page and repaint the proof step.
  function markBig() {
    if (S.artist && S.artist.id) knownBig[S.artist.id] = true;
    S.big = true;
    paintBig();
    fillPicked();
  }

  // Which proofs count right now. Two of screenshot / band email / DM, or one invite code.
  function proofs() {
    var c = S.claim || {};
    var shot = !S.big && (!!S.proofId || S.storedShots > 0);
    var band = c.email_kind === 'band';
    var dm = !!c.dm_code && $('dmSent').checked;
    var code = invCodeOk();
    var n = (shot ? 1 : 0) + (band ? 1 : 0) + (dm ? 1 : 0);
    return { shot: shot, band: band, dm: dm, code: code, n: n, ok: code || n >= 2 };
  }

  function paintProofs(p) {
    [['rShot', p.shot], ['rBand', p.band], ['rDm', p.dm], ['rCode', p.code]].forEach(function (x) {
      var row = $(x[0]);
      row.classList.toggle('on', x[1]);
      row.querySelector('[data-state]').textContent = x[1] ? ' Counts.' : ' Not added yet.';
    });
    var cnt = $('proofCount'), hint = $('countHint');
    if (p.code) {
      cnt.hidden = true;
      hint.textContent = 'Your invite code is enough on its own.';
    } else if (S.big && !p.band) {
      // big page + Gmail-type email: two proofs can't add up, so say what does work
      cnt.hidden = true;
      hint.textContent = 'With this email you need an invite code. Or start again with your band email.';
    } else {
      var n = Math.min(p.n, 2);
      cnt.hidden = false;
      cnt.textContent = n + ' of 2' + (n === 2 ? ' ✓' : '');
      cnt.classList.toggle('full', n === 2);
      hint.textContent = S.big ? 'Band email + Instagram DM, or one invite code.' : 'Any two below, or one invite code.';
    }
  }

  $('bandDiffEmail').addEventListener('click', useDifferentEmail);

  ['invCode', 'mgr', 'lIg', 'lTt', 'lWeb', 'dob'].forEach(function (id) { $(id).addEventListener('input', updateSend); });
  ['dmSent', 'terms', 'dob'].forEach(function (id) { $(id).addEventListener('change', updateSend); });

  // screenshot upload: goes up as soon as it's picked
  $('shotFile').addEventListener('change', function () {
    var f = this.files && this.files[0];
    this.value = '';   // so picking the same file again still works
    if (f) uploadShot(f);
  });

  // typeOnly: the size is checked again after shrinkShot, which can bring a big file under 10 MB
  function fileProblem(f, typeOnly) {
    var t = String(f.type || '').toLowerCase();
    var ok = /^image\/(jpeg|png|heic|heif)$/.test(t) || /\.(jpe?g|png|heic|heif)$/i.test(f.name || '');
    if (!ok) return 'That file won’t work. Use a JPEG, PNG or HEIC screenshot.';
    if (!typeOnly && f.size > MAX_FILE) return 'That file is over 10 MB. Try a smaller screenshot.';
    return '';
  }

  // Big screenshots are shrunk on the phone before they go up: a 6 MB PNG is
  // slow on cell data and too big for Claude's notes (5 MB / 8000 px), which
  // then saw no screenshot at all (Tsunoki, 2026-10-08). Redrawn as a JPEG no
  // longer than 2400 px. A file the browser can't read (HEIC in Chrome) goes up
  // as it is, like before.
  var SHRINK_EDGE = 2400, SHRINK_OVER = 3 * 1024 * 1024;
  function shrinkShot(f) {
    return new Promise(function (resolve) {
      if (!window.URL || !URL.createObjectURL) { resolve(f); return; }
      var url = URL.createObjectURL(f), img = new Image(), settled = false;
      function finish(out) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        URL.revokeObjectURL(url);
        resolve(out || f);
      }
      var timer = setTimeout(function () { finish(f); }, 15000);
      img.onerror = function () { finish(f); };
      img.onload = function () {
        var w = img.naturalWidth, ht = img.naturalHeight;
        var heic = /hei[cf]/i.test(String(f.type) + String(f.name));
        var scale = w && ht ? Math.min(1, SHRINK_EDGE / Math.max(w, ht)) : 1;
        if (!w || !ht || (scale === 1 && f.size <= SHRINK_OVER && !heic)) { finish(f); return; }
        try {
          var c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(w * scale));
          c.height = Math.max(1, Math.round(ht * scale));
          var g = c.getContext('2d');
          if (!g || !c.toBlob) { finish(f); return; }
          g.fillStyle = '#fff';   // see-through PNG corners turn white, not black
          g.fillRect(0, 0, c.width, c.height);
          g.drawImage(img, 0, 0, c.width, c.height);
          c.toBlob(function (b) {
            // nothing gained on a big-but-small-sized PNG: keep the original
            if (!b || (scale === 1 && !heic && b.size >= f.size)) { finish(f); return; }
            var name = String(f.name || 'screenshot').replace(/\.[a-z0-9]+$/i, '') + '.jpg';
            try { finish(new File([b], name, { type: 'image/jpeg' })); } catch (e) { finish(b); }
          }, 'image/jpeg', 0.85);
        } catch (e) { finish(f); }
      };
      img.src = url;
    });
  }

  function thumb(box, f) {
    SF.clear(box);
    if (/^image\/(jpeg|png)$/i.test(f.type || '') && window.URL && URL.createObjectURL) {
      var url = URL.createObjectURL(f);
      var img = el('img', { src: url, alt: '' });
      img.addEventListener('load', function () { URL.revokeObjectURL(url); });
      img.addEventListener('error', function () { URL.revokeObjectURL(url); SF.clear(box); box.textContent = 'IMG'; });
      box.appendChild(img);
    } else {
      box.textContent = /hei[cf]/i.test(String(f.type) + String(f.name)) ? 'HEIC' : 'IMG';
    }
  }

  // The server already has screenshot(s) for this claim: show it as added.
  function shotAlreadyThere() {
    SF.clear($('shotThumb'));
    $('shotThumb').textContent = 'IMG';
    $('shotName').textContent = S.storedShots === 1 ? 'Your screenshot' : 'Your ' + S.storedShots + ' screenshots';
    $('shotState').textContent = 'Already added · we keep it private';
    $('shotState').className = 'good';
    $('shotDone').hidden = false;
    $('shotPick').hidden = true;
    $('shotNote').hidden = true;
  }

  function uploadShot(f) {
    hideErr('shotErr');
    var bad = fileProblem(f, true);
    if (bad) { showErr('shotErr', bad); return; }
    var mine = S, seq = ++S.upSeq, st = $('shotState');
    S.uploading = true;
    S.proofId = null;
    thumb($('shotThumb'), f);
    $('shotName').textContent = f.name || 'screenshot';
    st.textContent = 'Uploading…';
    st.className = '';
    $('shotDone').hidden = false;
    $('shotPick').hidden = true;
    $('shotNote').hidden = true;
    updateSend();
    shrinkShot(f).then(function (g) {
      if (S !== mine || seq !== S.upSeq) return null;
      var big = fileProblem(g);
      if (big) throw { message: big, status: 0 };
      var fd = new FormData();
      fd.append('file', g, g.name || f.name || 'screenshot');
      return SF.request('POST', '/v1/claim/proof', { form: fd, bearer: S.claimToken, timeout: 120000 });
    }).then(function (res) {
      if (S !== mine || seq !== S.upSeq) return;
      S.uploading = false;
      S.proofId = res.proof_id || null;
      if (res.name) $('shotName').textContent = res.name;
      st.textContent = 'Uploaded · we keep it private';
      st.className = 'good';
      updateSend();
    }, function (err) {
      if (S !== mine || seq !== S.upSeq) return;
      S.uploading = false;
      if (err.code === 'too_many_files') {
        // Three are already saved for this claim: that's plenty, and they count.
        S.storedShots = Math.max(S.storedShots || 0, 3);
        shotAlreadyThere();
        updateSend();
        return;
      }
      $('shotDone').hidden = true;
      $('shotPick').hidden = false;
      $('shotNote').hidden = false;
      showErr('shotErr', err.message, err.status === 401
        ? [['Start again', startOver]]
        : [['Try another file', function () { $('shotFile').click(); }]]);
      updateSend();
    });
  }

  // copy the DM code
  document.querySelectorAll('[data-copy]').forEach(function (b) {
    b.addEventListener('click', function () {
      var src = $(b.getAttribute('data-copy'));
      copyText(b, src.textContent, src);
    });
  });

  // Links go on the profile, and the app only keeps full https links,
  // so "@name" turns into https://instagram.com/name and so on.
  function social(raw, host, prefix) {
    var s = String(raw || '').trim();
    if (!s) return '';
    if (/^https:\/\//i.test(s)) return s;
    if (/^http:\/\//i.test(s)) return 'https://' + s.slice(7);
    if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return '';
    if (s.indexOf('/') !== -1 || s.toLowerCase().indexOf(host) !== -1) return 'https://' + s.replace(/^\/+/, '');
    var handle = s.replace(/^@+/, '');
    return /^[A-Za-z0-9._]{1,60}$/.test(handle) ? 'https://' + host + '/' + prefix + handle : '';
  }
  function site(raw) {
    var s = String(raw || '').trim();
    if (!s) return '';
    if (/^https:\/\//i.test(s)) return s;
    if (/^http:\/\//i.test(s)) return 'https://' + s.slice(7);
    if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^[^:\/]+:\d/.test(s)) return '';
    return /\./.test(s) && !/\s/.test(s) ? 'https://' + s.replace(/^\/+/, '') : '';
  }
  function links(ig, tt, web) {
    return { instagram: social($(ig).value, 'instagram.com', ''), tiktok: social($(tt).value, 'tiktok.com', '@'), website: site($(web).value) };
  }
  // A field someone filled in that we couldn't turn into a link.
  function badLink(ig, tt, web) {
    var l = links(ig, tt, web);
    if ($(ig).value.trim() && !l.instagram) return { text: 'Check your Instagram', focus: ig };
    if ($(tt).value.trim() && !l.tiktok) return { text: 'Check your TikTok', focus: tt };
    if ($(web).value.trim() && !l.website) return { text: 'Check your website', focus: web };
    return null;
  }

  function normCode(v) { return String(v || '').toUpperCase().replace(/\s+/g, ''); }
  function invCodeOk() { return /^SF[A-Z0-9]{8}$/.test(normCode($('invCode').value).replace(/[^A-Z0-9]/g, '')); }

  function todayISO() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function dobState() {
    var v = $('dob').value;
    if (!v) return 'empty';
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    if (!m) return 'bad';
    var y = +m[1], mo = +m[2], d = +m[3], now = new Date();
    if (y < 1900 || mo < 1 || mo > 12 || d < 1 || d > 31) return 'bad';
    var age = now.getFullYear() - y;
    if (now.getMonth() + 1 < mo || (now.getMonth() + 1 === mo && now.getDate() < d)) age--;
    if (age < 0) return 'bad';
    return age >= 13 ? 'ok' : 'young';
  }

  // Where to send someone who still needs a proof.
  function nextProofField(p) {
    var c = S.claim || {};
    if (!S.big && !p.shot) return $('shotFile');
    if (c.dm_code && !p.dm) return $('dmSent');
    return $('invCode');
  }

  // What's still missing, in page order. null = ready to send.
  function missing() {
    var c = S.claim || {};
    if (S.uploading) return { text: 'Uploading your screenshot…' };
    if (S.mode !== 'invite') {
      var p = proofs();
      if (!p.ok) {
        if ($('invCode').value.trim() && !p.code) return { text: 'Check your invite code', focus: 'invCode' };
        if (S.big && !p.band) return { text: 'Add an invite code', focus: 'invCode' };
        return { text: p.n === 1 ? 'Add one more proof' : 'Add two proofs', focus: nextProofField(p) };
      }
      var bl = badLink('lIg', 'lTt', 'lWeb');
      if (bl) return bl;
      var mgr = $('mgr').value.trim();
      if (mgr && !SF.isEmail(mgr)) return { text: 'Check your manager’s email', focus: 'mgr' };
    }
    if (c.needs_dob) {
      var d = dobState();
      if (d === 'empty') return { text: 'Add your birthday', focus: 'dob' };
      if (d === 'young') return { text: 'You need to be 13 or older', focus: 'dob' };
      if (d === 'bad') return { text: 'Check your birthday', focus: 'dob' };
    }
    if (!$('terms').checked) return { text: 'Tick the box to agree', focus: 'terms' };
    return null;
  }

  function updateSend() {
    var b = $('sendBtn');
    if (!S.claim || b.disabled) return;
    if (S.mode !== 'invite') paintProofs(proofs());
    var m = missing();
    b.setAttribute('aria-disabled', m ? 'true' : 'false');
    b.textContent = m ? m.text : S.mode === 'invite' ? 'Finish' : 'Send for review';
    if (S.claim.needs_dob && dobState() === 'young') {
      showErr('dobErr', 'You need to be 13 or older to claim a page.', null, 'A parent or your manager can claim it for you with their own email.');
    } else hideErr('dobErr');
  }

  function focusField(t) {
    var n = typeof t === 'string' ? $(t) : t;
    if (!n) return;
    var box = n.closest('.prow, .field, .terms, .optrow') || n;
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    try { n.focus({ preventScroll: true }); } catch (e) { n.focus(); }
  }

  $('sendBtn').addEventListener('click', function () {
    if (S.busy || !S.claim) return;
    var m = missing();
    if (m) { if (m.focus) focusField(m.focus); return; }
    submitClaim();
  });

  function submitClaim() {
    var c = S.claim, invite = S.mode === 'invite', p = proofs();
    var body = {
      proof_ids: !invite && p.shot ? [S.proofId] : [],
      invite_code: !invite && p.code ? normCode($('invCode').value) : null,
      dm_sent: !invite && p.dm,
      links: invite ? { instagram: '', tiktok: '', website: '' } : links('lIg', 'lTt', 'lWeb'),
      manager_email: invite ? '' : $('mgr').value.trim(),
      date_of_birth: c.needs_dob ? $('dob').value : null,
      accept_terms: true
    };
    var mine = S, btn = $('sendBtn');
    S.busy = true;
    busy(btn, 'Sending…');
    hideErr('sendErr');
    SF.request('POST', '/v1/claim/submit', { json: body, bearer: S.claimToken }).then(function (res) {
      mine.busy = false;
      unbusy(btn);
      if (S !== mine) return;
      S.claimToken = null;   // done with it
      showDone(res || {}, body);
    }, function (err) {
      mine.busy = false;
      unbusy(btn);
      if (S !== mine) return;
      var acts, extra = '';
      if (err.code === 'big_page_proof') {
        // We showed the screenshot as counting, but the server counts fans live.
        if (!S.big && p.shot) extra = 'So your screenshot doesn’t count here.';
        markBig();
        acts = [];
      } else if (err.status === 401) {
        acts = [['Start again', startOver]];
        extra = invite ? 'Tap Start again and we’ll send a new code to the invited email.'
          : 'Nothing is lost. Start again with the same email and we’ll pick up where you left off.';
      } else if (err.code === 'network') acts = [['Try again', submitClaim]];
      else if (err.code === 'proof_required') acts = [];
      else acts = [mailAct()];
      updateSend();   // after markBig, so the counter and the button say what's missing now
      showErr('sendErr', err.message, acts, extra);
    });
  }

  // After the 2-hour page timeout: same artist, same email, new code.
  function startOver() {
    var old = S;
    if (old.flow === 'invite' && old.inviteToken) { openInvite(old.inviteToken); return; }
    S = fresh(old.flow === 'report' ? 'report' : 'claim');
    S.artist = old.artist;
    S.email = old.email;
    S.message = old.message;
    fillPicked();
    if (S.flow === 'report') { hideErr('reportErr'); show('report'); }
    else {
      $('bigNote').hidden = !bigPage(S.artist);
      hideErr('emailErr');
      show('email', 'email');
    }
  }

  // ---------- done ----------
  function proofSummary(body) {
    var parts = [];
    if (S.claim && S.claim.email_kind === 'band') parts.push('Band email');
    if (body.proof_ids.length) parts.push('Screenshot');
    if (body.invite_code) parts.push('Invite code');
    if (body.dm_sent) parts.push('Instagram DM');
    if (body.links.instagram) parts.push('Instagram link');
    if (body.links.tiktok) parts.push('TikTok link');
    if (body.links.website) parts.push('Website');
    if (body.manager_email) parts.push('Manager’s email');
    return parts.join(' + ');
  }

  function trackItem(state, title, small) {
    var sr = state === 'done' ? 'Done: ' : state === 'now' ? 'Now: ' : 'Next: ';
    return el('li', { cls: state }, [
      el('span', { cls: 'd', 'aria-hidden': 'true' }),
      el('span', null, [el('span', { cls: 'sr', text: sr }), title, small ? el('small', { text: small }) : null])
    ]);
  }

  function showDone(res, body) {
    var approved = res.status === 'approved', report = S.flow === 'report', name = artistName();
    var email = (S.claim && S.claim.email) || S.email;
    var track = $('doneTrack'), dmBox = $('doneDm');
    SF.clear(track);
    SF.clear(dmBox);
    dmBox.hidden = true;
    if (approved) {
      $('doneKicker').textContent = 'You’re in';
      $('doneTitle').textContent = name + ' is yours.';
      $('doneLede').textContent = 'No review needed. Your page is locked to your account.';
      track.appendChild(trackItem('done', 'Email confirmed', email));
      track.appendChild(trackItem('done', 'Page claimed', 'Locked to your account'));
      track.appendChild(trackItem('now', 'Get the app', 'Check your email. It says how to get the app and sign in.'));
      $('doneFine').textContent = 'You can close this page.';
    } else {
      $('doneKicker').textContent = 'Sent';
      $('doneTitle').textContent = 'Done. You can close this page.';
      $('doneLede').textContent = report
        ? 'We got your report about ' + name + '. We’ll look at both sides and email you. Nothing changes on the page until we decide.'
        : 'We’re checking your claim for ' + name + '. You don’t need to do anything else.';
      track.appendChild(trackItem('done', 'Email confirmed', email));
      track.appendChild(trackItem('done', report ? 'Report sent' : 'Proofs sent', proofSummary(body)));
      track.appendChild(trackItem('now', 'ShowFuse check', report ? 'We’ll email you either way' : 'We’ll email you, usually within 24 hours'));
      if (!report) track.appendChild(trackItem('todo', 'You’re in', 'That email says how to get the app and sign in'));
      var code = res.dm_code || (S.claim && S.claim.dm_code);
      if (code && !body.dm_sent) {
        dmBox.append('Want a faster yes? DM ', el('span', { cls: 'dmcode', text: code }), ' to ', el('b', { text: IG_HANDLE }), ' from your official Instagram.');
        dmBox.hidden = false;
      }
      $('doneFine').textContent = 'We sent a receipt to your inbox. It links back to your ' + (report ? 'report' : 'claim') + ' in case we need one more thing.';
    }
    show('done');
  }

  // ---------- report ----------
  function startReport(a) {
    stopCountdown();
    S = fresh('report');
    S.artist = a;
    fillPicked();
    hideErr('reportErr');
    show('report');
  }

  $('reportForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var msg = $('rMsg').value.trim(), email = $('rEmail').value.trim();
    hideErr('reportErr');
    if (!msg) { showErr('reportErr', 'Tell us what’s going on first.'); $('rMsg').focus(); return; }
    if (!SF.isEmail(email)) { showErr('reportErr', 'That email doesn’t look right. Check it and try again.'); $('rEmail').focus(); return; }
    S.message = msg;
    S.email = email;
    requestCode($('reportBtn'), 'reportErr', false);
  });

  // ---------- invite link (#invite=…) ----------
  function openInvite(token) {
    stopCountdown();
    S = fresh('invite');
    S.inviteToken = token;
    $('loadText').textContent = 'Opening your invite…';
    show('loading');
    requestCode(null, null, false);
  }

  function inviteError(err) {
    var token = S.inviteToken, next, acts;
    switch (err.code) {
      case 'invite_used':
        next = 'Already claimed it? Check your email. It says how to get the app and sign in. If that wasn’t you, email us and we’ll sort it out.';
        acts = [mailAct()];
        break;
      case 'invite_expired':
        next = 'Ask the person who invited you for a new one, or find your name and claim it the regular way.';
        acts = [['Find your name', backToSearch], mailAct()];
        break;
      case 'page_claimed':
        next = 'If it’s yours, find your name and tap Report it. We’ll look into it.';
        acts = [['Find your name', backToSearch]];
        break;
      case 'network':
      case 'too_fast':
        next = '';
        acts = [['Try again', function () { openInvite(token); }]];
        break;
      default:
        next = 'Ask the person who invited you to send a new one, or find your name and claim it the regular way.';
        acts = [['Find your name', backToSearch], mailAct()];
    }
    oops('This invite didn’t open', err.message, next, acts);
  }

  // ---------- status link (#status=…) ----------
  function openStatus(token) {
    stopCountdown();
    S = fresh('status');
    S.statusToken = token;
    $('loadText').textContent = 'Getting your claim…';
    show('loading');
    var mine = S;
    SF.request('GET', '/v1/claim/status', { bearer: token }).then(function (st) {
      if (S === mine) renderStatus(st || {});
    }, function (err) {
      if (S !== mine) return;
      if (err.code === 'network') {
        oops('We couldn’t reach ShowFuse', err.message, '', [['Try again', function () { openStatus(token); }], mailAct()]);
      } else {
        oops('This link doesn’t work anymore', err.message, 'It may be old. Check your newest email from us, or start a new claim.', [['Start a new claim', backToSearch], mailAct()]);
      }
    });
  }

  function renderStatus(st) {
    S.status = st;
    var report = st.kind === 'report', name = st.artist_name || 'your page';
    var what = report ? 'report about ' + name : 'claim for ' + name;
    var title, lede, acts = [];
    switch (st.status) {
      case 'submitted':
        title = 'We’re on it';
        lede = report ? 'We’re looking at your report about ' + name + '. We’ll email you when we decide.'
          : 'We’re checking your claim for ' + name + '. We’ll email you, usually within 24 hours. You don’t need to do anything else.';
        break;
      case 'asked_more':
        title = 'One more thing';
        lede = 'To finish your ' + what + ', we need one more thing from you.';
        break;
      case 'approved':
        title = report ? 'We fixed it' : name + ' is yours.';
        lede = report ? 'We looked into your report about ' + name + ' and fixed the page. Check your email for what happens next.'
          : 'Your page is approved. Check your email. It says how to get the app and sign in.';
        break;
      case 'rejected':
        if (report) {
          title = 'We kept the page as it is';
          lede = 'We looked at your report about ' + name + ' and kept the page with its owner for now. Have more to show us? Email us.';
          acts = [mailAct()];
        } else {
          title = 'We couldn’t confirm it';
          lede = 'We couldn\u2019t confirm your claim. You can start a new claim with two proofs, like your band email and a DM from your official Instagram, or with an invite code.';
          acts = [['Start a new claim', backToSearch], mailAct()];
        }
        break;
      case 'superseded':
        title = 'Someone else’s claim went through';
        lede = report ? 'Your report about ' + name + ' was closed when the page changed hands. If it’s still wrong, email us.'
          : 'Another claim for ' + name + ' was approved first. If ' + name + ' is your page, find it again and tap Report it, or email us.';
        acts = report ? [mailAct()] : [['Search again', backToSearch], mailAct()];
        break;
      case 'expired':
        title = 'This claim timed out';
        lede = 'It sat too long without a proof. Start again with the same email. It only takes a minute.';
        acts = [['Start a new claim', backToSearch]];
        break;
      default:
        title = report ? 'Your report' : 'Your claim';
        lede = 'Check your email for the latest from us.';
        acts = [mailAct()];
    }
    $('stKicker').textContent = report ? 'Your report' : 'Your claim';
    $('stTitle').textContent = title;
    $('stLede').textContent = lede;
    $('stNote').hidden = !st.asked_note;
    $('stNoteText').textContent = st.asked_note || '';
    $('moreDone').hidden = true;
    var canAdd = st.can_add_proof === true || (st.status === 'asked_more' && st.can_add_proof !== false);
    if (canAdd) setupMore(st);
    else {
      $('moreForm').hidden = true;
      if (st.status === 'asked_more') acts = [mailAct()];   // we asked, but the form is closed: email is the way
    }
    fillActions($('stActions'), acts, true);
    show('status');
  }

  function setupMore(st) {
    $('moreDm').hidden = !st.dm_code;
    $('mDmCode').textContent = st.dm_code || '';
    $('mDm').checked = false;
    S.moreFile = null;
    $('mFileDone').hidden = true;
    $('mFilePick').hidden = false;
    ['mIg', 'mTt', 'mWeb'].forEach(function (id) { $(id).value = ''; });
    hideErr('moreErr');
    unbusy($('moreBtn'));
    $('moreForm').hidden = false;
    updateMore();
  }

  function moreHas() {
    var l = links('mIg', 'mTt', 'mWeb');
    return {
      file: S.moreFile, links: l,
      hasLinks: !!(l.instagram || l.tiktok || l.website),
      dm: !!(S.status && S.status.dm_code) && $('mDm').checked,
      bad: badLink('mIg', 'mTt', 'mWeb')
    };
  }
  function updateMore() {
    var b = $('moreBtn');
    if (b.disabled) return;
    var h = moreHas();
    var ok = !h.bad && (h.file || h.hasLinks || h.dm);
    b.setAttribute('aria-disabled', ok ? 'false' : 'true');
    b.textContent = h.bad ? h.bad.text : ok ? 'Send it' : 'Add something above';
  }
  ['mIg', 'mTt', 'mWeb'].forEach(function (id) { $(id).addEventListener('input', updateMore); });
  $('mDm').addEventListener('change', updateMore);
  $('mFile').addEventListener('change', function () {
    var f = this.files && this.files[0];
    this.value = '';
    if (!f) return;
    hideErr('moreErr');
    var bad = fileProblem(f, true);
    if (bad) { showErr('moreErr', bad); return; }
    S.moreFile = f;
    thumb($('mThumb'), f);
    $('mFileName').textContent = f.name || 'screenshot';
    $('mFileDone').hidden = false;
    $('mFilePick').hidden = true;
    updateMore();
  });
  $('mFileDrop').addEventListener('click', function () {
    S.moreFile = null;
    $('mFileDone').hidden = true;
    $('mFilePick').hidden = false;
    updateMore();
  });
  $('moreForm').addEventListener('submit', function (e) { e.preventDefault(); sendMore(); });

  function sendMore() {
    var h = moreHas(), b = $('moreBtn');
    if (S.busy) return;
    if (h.bad) { focusField(h.bad.focus); return; }
    if (!h.file && !h.hasLinks && !h.dm) return;
    var mine = S, tok = S.statusToken;
    S.busy = true;
    busy(b, 'Sending…');
    hideErr('moreErr');
    var p = Promise.resolve();
    if (h.file) {
      p = p.then(function () {
        return shrinkShot(h.file);
      }).then(function (g) {
        var big = fileProblem(g);
        if (big) throw { message: big, status: 0 };
        var fd = new FormData();
        fd.append('file', g, g.name || h.file.name || 'screenshot');
        return SF.request('POST', '/v1/claim/add-proof', { form: fd, bearer: tok, timeout: 120000 });
      }).then(function () {
        mine.moreFile = null;   // sent: a retry only sends what's left
      });
    }
    if (h.hasLinks || h.dm) {
      p = p.then(function () {
        var body = {};
        if (h.hasLinks) body.links = h.links;
        if (h.dm) body.dm_sent = true;
        return SF.request('POST', '/v1/claim/add-proof', { json: body, bearer: tok });
      });
    }
    p.then(function () {
      mine.busy = false;
      unbusy(b);
      if (S !== mine) return;
      $('moreForm').hidden = true;
      $('moreDone').hidden = false;
    }, function (err) {
      mine.busy = false;
      unbusy(b);
      if (S !== mine) return;
      if (!S.moreFile) { $('mFileDone').hidden = true; $('mFilePick').hidden = false; }
      updateMore();
      showErr('moreErr', err.message, err.status === 401
        ? [['Start a new claim', backToSearch], mailAct()]
        : err.code === 'network' ? [['Try again', sendMore]] : [mailAct()]);
    });
  }

  // ---------- start ----------
  var routed = false;
  function route(h, first) {
    if (h.invite) { routed = true; openInvite(h.invite); return; }
    if (h.status) { routed = true; openStatus(h.status); return; }
    if (first && !routed) { routed = true; show('search'); }
  }
  SF.ready.then(function () { route(boot, true); });
  // Another email link opened in this same tab.
  window.addEventListener('hashchange', function () {
    var h = SF.takeHash();
    if (h.invite || h.status) route(h, false);
  });
})();
