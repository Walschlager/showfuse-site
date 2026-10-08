/* DEV ONLY: a fake claim API so every screen can be clicked through without
   the server. common.js loads this only with ?fake=1 on localhost, and it
   checks again below, so it never runs on showfuseapp.com.

   Cheat sheet
   Search    "ts" open pages · "kno" big page + page with a photo · "wal" claimed
             "frost" frozen · "neon" big · "glass" looks small, but submit finds it big
             "crown" claimed + big (report it: size never matters for reports)
             "zz" no match · "boom" search error
   Email     gmail/yahoo/icloud/hotmail/outlook = free email, anything else = band email
             limit@… too many codes · taken@… page just got claimed
             venue@… venue account · owner@… already runs a page (claims only, like the server)
             venue0@… / owner0@… the same, in an older server's words (no address in the message)
             existing@… has an account (no birthday) · timeout@… 2-hour timeout on submit
   Code      123456 works · 000000 expired · 999999 too many tries · anything else is wrong
   Step 3    two proofs (screenshot, band email, DM) or one invite code
             big pages (claims only): band email + DM; size is the live one at submit
             invite code SF-7Q2K-9XM4 works, anything else is refused
             a screenshot named fail… is refused · DM codes look like SF-K7Q2M
   Add me    Spotify: https://open.spotify.com/… or spotify:artist:<22 letters/digits>
   Links     /claim/?fake=1#invite=good | existing | owner | venue | used | expired | claimed | (else invalid)
             /claim/?fake=1#status=submitted | asked | approved | rejected | superseded | expired | report | (else bad)
             /freeze/?fake=1#t=good | noname | (else used or expired, like the server)
             /freeze/?fake=1#hold=good | done (already happened) | (else used or expired) */
(function () {
  'use strict';
  var host = location.hostname;
  if (!(host === 'localhost' || host === '127.0.0.1') || !/(?:^|[?&])fake=1(?:&|$)/.test(location.search)) return;

  var API = 'http://localhost:3000';
  var realFetch = window.fetch.bind(window);
  var FREE = /@(gmail|googlemail|yahoo|icloud|me|hotmail|outlook|live|aol|proton|protonmail)\./i;

  function photo(label, bg) {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="' + bg +
      '"/><text x="48" y="61" font-family="Arial,sans-serif" font-size="34" font-weight="700" text-anchor="middle" fill="#111013">' + label + '</text></svg>';
    return URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  }

  var ARTISTS = [
    { id: 'a-tsunoki', name: 'Tsunoki', image_url: null, genres: ['electronic'], state: 'open', size: 'small' },
    { id: 'a-tsune', name: 'Tsune', image_url: null, genres: ['electronic', 'house'], state: 'open', size: 'unknown' },
    { id: 'a-knocked', name: 'Knocked Loose', image_url: null, genres: ['metal', 'hardcore'], state: 'open', size: 'big' },
    { id: 'a-knock2', name: 'Knock2', image_url: photo('K2', '#FFC300'), genres: ['electronic', 'bass'], state: 'open', size: 'small' },
    { id: 'a-walsch', name: 'Walschlager', image_url: photo('W', '#5FE08F'), genres: ['electronic'], state: 'claimed', size: 'small' },
    { id: 'a-neon', name: 'Neon Harbor', image_url: null, genres: ['indie', 'pop'], state: 'open', size: 'big' },
    { id: 'a-frost', name: 'Frost Theory', image_url: null, genres: ['indie'], state: 'frozen', size: 'small' },
    { id: 'a-crown', name: 'Crown Static', image_url: null, genres: ['rock'], state: 'claimed', size: 'big' },
    // Search shows the stored size; submit counts fans live (live: what that finds).
    { id: 'a-glass', name: 'Glasshouse', image_url: null, genres: ['indie', 'electronic'], state: 'open', size: 'small', live: 'big' }
  ];

  var STATUS = {
    submitted: { status: 'submitted', kind: 'claim', artist_name: 'Tsunoki', asked_note: null, dm_code: 'SF-K7Q2M', can_add_proof: false },
    asked: { status: 'asked_more', kind: 'claim', artist_name: 'Tsunoki', dm_code: 'SF-K7Q2M', can_add_proof: true,
      asked_note: 'Thanks for your claim! To finish, DM your code SF-K7Q2M to @showfuse from your official Instagram, or add a link to your Instagram, TikTok or website.' },
    approved: { status: 'approved', kind: 'claim', artist_name: 'Tsunoki', asked_note: null, dm_code: 'SF-K7Q2M', can_add_proof: false },
    rejected: { status: 'rejected', kind: 'claim', artist_name: 'Neon Harbor', dm_code: 'SF-4WXN8', can_add_proof: false,
      asked_note: 'Big artists claim with an email from their official team, an invite link from us, or a DM from their official Instagram.' },
    superseded: { status: 'superseded', kind: 'claim', artist_name: 'Tsunoki', asked_note: null, dm_code: null, can_add_proof: false },
    expired: { status: 'expired', kind: 'claim', artist_name: 'Tsunoki', asked_note: null, dm_code: null, can_add_proof: false },
    report: { status: 'submitted', kind: 'report', artist_name: 'Walschlager', asked_note: null, dm_code: 'SF-R2D7P', can_add_proof: false }
  };

  // Invite links: which (invited) email each one opens with.
  var INVITES = { good: 'team@harbormgmt.example', existing: 'existing@harbormgmt.example', owner: 'owner@harbormgmt.example', venue: 'venue@harbormgmt.example' };

  var claims = {}, seq = 0, proofSeq = 0;

  // "SF-" + 5 letters/digits, no 0/O/1/I (like the server's codes).
  function dmCode() {
    var abc = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ', s = 'SF-';
    for (var i = 0; i < 5; i++) s += abc.charAt(Math.floor(Math.random() * abc.length));
    return s;
  }

  function find(id) { for (var i = 0; i < ARTISTS.length; i++) if (ARTISTS[i].id === id) return ARTISTS[i]; return null; }
  function pub(a) { return { id: a.id, name: a.name, image_url: a.image_url, size: a.size }; }
  function mask(email) { var at = email.indexOf('@'); return at < 1 ? email : email.charAt(0) + '•••' + email.slice(at); }
  function newClaim(fields) {
    var id = 'c-' + (++seq);
    claims[id] = Object.assign({ id: id, tries: 5, kind: 'claim', invite: false, shots: 0 }, fields);
    return claims[id];
  }
  function byToken(tok) {
    for (var k in claims) if (claims[k].token && claims[k].token === tok) return claims[k];
    return null;
  }
  function age(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''), now = new Date();
    if (!m) return -1;
    var a = now.getFullYear() - +m[1];
    if (now.getMonth() + 1 < +m[2] || (now.getMonth() + 1 === +m[2] && now.getDate() < +m[3])) a--;
    return a;
  }

  // A little fake network delay so loading states show. None while the tab is
  // hidden, where browsers throttle timers hard.
  function reply(status, body, ms) {
    var res = function () { return new Response(JSON.stringify(body), { status: status, headers: { 'Content-Type': 'application/json' } }); };
    if (document.hidden) return Promise.resolve(res());
    return new Promise(function (resolve) {
      setTimeout(function () { resolve(res()); }, ms || 350 + Math.random() * 300);
    });
  }
  function fail(status, code, message) { return reply(status, { error: { code: code, message: message } }); }

  // Same bot check as the waitlist route: honeypot empty, t >= 2500.
  function bot(b) {
    if (!b) return fail(400, 'invalid_request', 'Invalid request.');
    if (b.website) return fail(400, 'rejected', 'Could not send that.');
    if (typeof b.t !== 'number' || b.t < 2500) return fail(400, 'too_fast', 'Give the form a second and try again.');
    return null;
  }

  function handle(method, path, params, b, form, tok) {
    var f, a, c;
    if (method === 'GET' && path === '/v1/claim/search') {
      var q = String(params.get('q') || '').trim().toLowerCase();
      if (q.length < 2 || q.length > 60) return fail(400, 'invalid_request', 'Search needs 2 to 60 letters.');
      if (q === 'boom') return fail(503, 'unavailable', 'Search is taking a break. Try again in a minute.');
      return reply(200, { results: ARTISTS.filter(function (x) { return x.name.toLowerCase().indexOf(q) !== -1; }).slice(0, 12)
        .map(function (x) { return { id: x.id, name: x.name, image_url: x.image_url, genres: x.genres, state: x.state, size: x.size }; }) });
    }
    if (method === 'POST' && path === '/v1/claim/request-add') {
      if ((f = bot(b))) return f;
      if (!b.name || !b.email) return fail(400, 'invalid_request', 'Name and email are required.');
      if ('spotify_url' in b && !/^(https:\/\/open\.spotify\.com\/|spotify:artist:[A-Za-z0-9]{22}$)/.test(b.spotify_url || '')) {
        return fail(400, 'invalid_link', 'That doesn’t look like a Spotify link. You can leave it empty.');
      }
      if (/^limit@/i.test(b.email)) return fail(429, 'rate_limited', 'Too many requests for now. Try again tomorrow.');
      console.info('[dev-fake] request-add', b);
      return reply(202, { ok: true });
    }
    if (method === 'POST' && path === '/v1/claim/start') {
      if ((f = bot(b))) return f;
      a = find(b.artist_id);
      if (!a) return fail(404, 'not_found', 'We couldn’t find that page. Search again.');
      if (a.state !== 'open' || /^taken@/i.test(b.email)) return fail(409, 'page_claimed', 'Someone just claimed this page.');
      if (/^limit@/i.test(b.email)) return fail(429, 'rate_limited', 'Too many codes for now. Try again in 15 minutes.');
      c = newClaim({ artist: a, email: b.email });
      return reply(200, { ok: true, claim_id: c.id });
    }
    if (method === 'POST' && path === '/v1/claim/report/start') {
      if ((f = bot(b))) return f;
      a = find(b.artist_id);
      if (!a) return fail(404, 'not_found', 'We couldn’t find that page. Search again.');
      if (a.state === 'open') return fail(409, 'page_not_claimed', 'This page isn’t claimed yet, so there’s nothing to report. You can claim it instead.');
      if (!b.message) return fail(400, 'invalid_request', 'Tell us what happened.');
      c = newClaim({ artist: a, email: b.email, kind: 'report' });
      return reply(200, { ok: true, claim_id: c.id });
    }
    if (method === 'POST' && path === '/v1/claim/invite/open') {
      if ((f = bot(b))) return f;
      var t = b.invite_token;
      if (t === 'used') return fail(410, 'invite_used', 'This invite was already used.');
      if (t === 'expired') return fail(410, 'invite_expired', 'This invite expired.');
      if (t === 'claimed') return fail(409, 'page_claimed', 'This page was already claimed.');
      if (!INVITES.hasOwnProperty(t)) return fail(404, 'invite_invalid', 'This invite link doesn’t work.');
      a = find('a-neon');
      c = newClaim({ artist: a, email: INVITES[t], invite: true });
      return reply(200, { ok: true, claim_id: c.id, artist: pub(a), email: mask(c.email) });
    }
    if (method === 'POST' && path === '/v1/claim/verify') {
      c = claims[b && b.claim_id];
      if (!c) return fail(404, 'not_found', 'That code doesn’t match anything. Ask for a new one.');
      if (c.tries <= 0) return fail(429, 'too_many_tries', 'Too many wrong tries. Ask for a new code.');
      if (b.code === '000000') return fail(400, 'code_expired', 'That code expired.');
      if (b.code === '999999') { c.tries = 0; return fail(429, 'too_many_tries', 'Too many wrong tries. Ask for a new code.'); }
      if (b.code !== '123456') {
        c.tries--;
        if (c.tries <= 0) return fail(429, 'too_many_tries', 'Too many wrong tries. Ask for a new code.');
        return fail(400, 'wrong_code', 'That code doesn’t match. ' + c.tries + (c.tries === 1 ? ' try' : ' tries') + ' left.');
      }
      // Today's server names our address in both. venue0@ / owner0@ get an older server's words (no address).
      if (/^venue0?@/i.test(c.email)) {
        return fail(409, 'venue_account', /^venue0@/i.test(c.email) ? 'This email belongs to a venue account. Use a different email.'
          : 'This email belongs to a venue account on ShowFuse. Use your band email, or email info@showfuseapp.com and we\'ll sort it out.');
      }
      if (c.kind === 'claim' && /^owner0?@/i.test(c.email)) {
        return fail(409, 'already_owns_page', /^owner0@/i.test(c.email) ? 'This email already runs an artist page.'
          : 'This email already runs an artist page on ShowFuse. Email info@showfuseapp.com and we\'ll put both under one account.');
      }
      var existing = /^existing@/i.test(c.email);
      c.token = 'fake-claim-' + c.id;
      c.dm_code = c.dm_code || dmCode();
      c.needs_dob = !existing;
      c.email_kind = FREE.test(c.email) ? 'free' : 'band';
      return reply(200, {
        claim_token: c.token, status_token: 'fake-status-' + c.id,
        claim: { id: c.id, kind: c.kind, status: 'email_verified', invite: c.invite, artist: pub(c.artist),
          email: mask(c.email), email_kind: c.email_kind, account: existing ? 'existing' : 'new',
          dm_code: c.dm_code, needs_dob: c.needs_dob }
      });
    }
    if (method === 'POST' && path === '/v1/claim/proof') {
      c = byToken(tok);
      if (!c) return fail(401, 'unauthorized', 'This page timed out. Start again.');
      var file = form && form.get('file');
      if (!file || typeof file === 'string') return fail(400, 'invalid_request', 'Add a file.');
      if (/^fail/i.test(file.name)) return fail(400, 'bad_file', 'We couldn’t read that file. Try a JPEG or PNG screenshot.');
      if (file.size > 10 * 1024 * 1024) return fail(413, 'request_rejected', 'That file is too big.');
      if (c.shots >= 3) return fail(400, 'too_many_files', 'That’s enough screenshots. Send for review.');
      c.shots++;   // the server counts every screenshot it stored, whatever proof_ids says
      return reply(201, { proof_id: 'p-' + (++proofSeq), name: file.name }, 900);
    }
    if (method === 'POST' && path === '/v1/claim/submit') {
      c = byToken(tok);
      if (!c) return fail(401, 'unauthorized', 'This page timed out. Start again.');
      console.info('[dev-fake] submit', b);
      if (/^timeout@/i.test(c.email)) return fail(401, 'session_expired', 'This page timed out after 2 hours.');
      if (b.accept_terms !== true) return fail(400, 'terms_required', 'Tick the box to agree to the Terms.');
      if (c.needs_dob && !b.date_of_birth) return fail(400, 'dob_required', 'Add your birthday.');
      if (b.date_of_birth && age(b.date_of_birth) < 13) return fail(400, 'too_young', 'You need to be 13 or older to claim a page.');
      if (c.invite) return reply(200, { status: 'approved', dm_code: c.dm_code });
      var band = c.email_kind === 'band';
      var shot = c.shots > 0;   // like the server: what was uploaded, not proof_ids
      if (b.invite_code) {
        if (b.invite_code !== 'SF-7Q2K-9XM4') return fail(400, 'invite_invalid', 'That invite code doesn’t work for this page and email.');
        return reply(200, { status: c.kind === 'report' ? 'submitted' : 'approved', dm_code: c.dm_code });
      }
      // Two proofs (screenshot, band email, DM), or one invite code. Size counts
      // for claims only, live at submit: on a big page a screenshot doesn't count.
      var big = c.kind === 'claim' && (c.artist.live || c.artist.size) === 'big';
      var n = (shot && !big ? 1 : 0) + (band ? 1 : 0) + (b.dm_sent ? 1 : 0);
      if (n < 2) {
        if (big) return fail(400, 'big_page_proof', 'This is a big page. Claim it with your band email and a DM from your official Instagram, or with an invite code from our team.');
        return fail(400, 'proof_required', n === 0 ? 'Add two proofs: a screenshot, your band email, or the Instagram DM.'
          : 'Add one more proof. We need two: a screenshot, your band email, or the Instagram DM.');
      }
      return reply(200, { status: 'submitted', dm_code: c.dm_code });
    }
    if (method === 'GET' && path === '/v1/claim/status') {
      if (!STATUS[tok]) return fail(401, 'invalid_link', 'This link doesn’t work anymore.');
      return reply(200, STATUS[tok]);
    }
    if (method === 'POST' && path === '/v1/claim/add-proof') {
      if (!STATUS[tok]) return fail(401, 'invalid_link', 'This link doesn’t work anymore.');
      if (form) {
        var mf = form.get('file');
        if (!mf || typeof mf === 'string' || /^fail/i.test(mf.name)) return fail(400, 'bad_file', 'We couldn’t read that file. Try a JPEG or PNG screenshot.');
        return reply(200, { ok: true }, 900);
      }
      if (!b || (!b.links && !b.dm_sent)) return fail(400, 'invalid_request', 'Add something first.');
      console.info('[dev-fake] add-proof', b);
      return reply(200, { ok: true });
    }
    if (method === 'POST' && path === '/v1/account/freeze') {
      if ((f = bot(b))) return f;
      if (b.token === 'good') return reply(200, { ok: true, artist_name: 'Tsunoki' });
      if (b.token === 'noname') return reply(200, { ok: true, artist_name: null });
      return fail(410, 'link_expired', 'This link was already used or expired. Email info@showfuseapp.com if you need help.');
    }
    if (method === 'POST' && path === '/v1/account/stop-hold') {
      if ((f = bot(b))) return f;
      if (b.token === 'good') return reply(200, { ok: true, artist_name: 'Tsunoki' });
      if (b.token === 'done') return fail(409, 'hold_done', 'That change already happened or was stopped. Email info@showfuseapp.com.');
      return fail(410, 'link_expired', 'This link was already used or expired. Email info@showfuseapp.com if you need help.');
    }
    return fail(404, 'not_found', 'Route not found.');
  }

  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : input.url;
    if (url.indexOf(API + '/') !== 0) return realFetch(input, init);
    init = init || {};
    var u = new URL(url), method = String(init.method || 'GET').toUpperCase();
    var body = null, form = null;
    if (typeof init.body === 'string') { try { body = JSON.parse(init.body); } catch (e) { body = null; } }
    if (typeof FormData !== 'undefined' && init.body instanceof FormData) form = init.body;
    var h = init.headers || {}, auth = h.Authorization || h.authorization || '';
    var tok = auth.indexOf('Bearer ') === 0 ? auth.slice(7) : '';
    console.info('[dev-fake]', method, u.pathname);
    try { return handle(method, u.pathname, u.searchParams, body, form, tok); }
    catch (e) { console.error(e); return fail(500, 'fake_crash', 'The fake API crashed: ' + e.message); }
  };
  window.SF_FAKE_READY = true;
  console.info('[dev-fake] claim API is faked. Cheat sheet at the top of /claim/dev-fake.js.');
})();
