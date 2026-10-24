/* ShowFuse shop: the "Return or refund" pages on /shop/order/. Build 14, against docs/BUILD_14_API_CONTRACT.md (sections 4 and 5).
   Two steps, as in the approved mockup (screens 2a to 4): pick the items, a reason, photos and a note, then review and send.
   The request goes to the website's route for this order link (POST /v1/shop/order/returns), with a request_id that makes a
   double press or a retry after a timeout one request. Photos go up as they are picked (POST /v1/shop/return-photos), one call
   each. What may be asked, and whether a reason takes photos, comes from the server (the config's returns block, the order's
   can_return, returnable_qty and final_sale). Where the server turns something down its own sentence is shown as it is.
   The steps are history entries, so the browser's Back goes from the review to the picker and from the picker to the order.
   Server text always goes in with textContent. */
(function () {
  'use strict';
  var SF = window.SFShop, R = window.SFReturns;
  if (!SF || !R) return;
  var el = SF.el;

  // If the store's answer has no returns block (the store is off, or an older server), the six standard reasons are used.
  // Same codes, labels and photo rules as docs/BUILD_14_API_CONTRACT.md, section 1. The server checks every request anyway.
  var STANDARD = [
    { code: 'wrong_size', label: 'Wrong size', ourMistake: false, photos: false },
    { code: 'damaged_defective', label: 'Damaged or defective', ourMistake: true, photos: true },
    { code: 'wrong_item', label: 'Wrong item sent', ourMistake: true, photos: true },
    { code: 'not_as_expected', label: 'Not as expected', ourMistake: false, photos: false },
    { code: 'changed_mind', label: 'Changed my mind', ourMistake: false, photos: false },
    { code: 'other', label: 'Other', ourMistake: false, photos: false }
  ];
  var PROBLEM = { damaged_defective: true, wrong_item: true };   // the only reasons a final-sale line is accepted with
  var MAX_PHOTOS = 3, MAX_BYTES = 8 * 1024 * 1024, MAX_NOTE = 500;   // MAX_PHOTOS until the server says otherwise (its upload answer carries the limit)
  // Refusals that mean "what you are looking at is out of date": the order is drawn again from the server.
  var STALE = { not_shipped: 1, return_unavailable: 1, return_window_closed: 1, final_sale: 1, nothing_to_return: 1, too_many_open_returns: 1, not_found: 1 };

  var S = null;   // the request being made: { ctx, o, rules, reasons, problemOnly, depth, d }

  function bold(t) { return el('b', { text: t }); }
  function newId() {
    var bytes = new Uint8Array(18);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    else for (var i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    var s = '';
    for (var j = 0; j < bytes.length; j++) s += String.fromCharCode(bytes[j]);
    return window.btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');   // 24 characters of A-Za-z0-9_-
  }
  function reasonOf(code) { for (var i = 0; i < S.reasons.length; i++) if (S.reasons[i].code === code) return S.reasons[i]; return null; }
  function leftOf(l) { return l.returnableQty === null ? l.qty : l.returnableQty; }   // an older server: assume all of it
  function photosOn(reasonCode) { var r = reasonOf(reasonCode); return !!(r && r.photos); }

  // ---------- history: the two steps ----------
  function push(n) {
    try { window.history.pushState({ sfFlow: n }, ''); S.depth = n; } catch (e) { /* no history: the buttons still work */ }
  }
  function close(fresh) {
    if (!S) return;
    var ctx = S.ctx;
    S.d.photos.forEach(function (p) { if (p.url) { try { URL.revokeObjectURL(p.url); } catch (e) { /* gone already */ } } });
    S = null;
    if (fresh) ctx.reload(); else ctx.showOrder();
  }
  window.addEventListener('popstate', function (e) {
    if (!S) return;
    var n = e.state && e.state.sfFlow;
    if (!n) { close(false); return; }            // back to the order, as it was
    if (S.d.done) { close(true); return; }       // the request went through: the order again, fresh
    S.depth = n;
    if (n === 1) pick(); else review();
  });
  // The crumb and the Back button go one step back through history when there is one to go back to.
  function back() {
    if (S.depth > 0) {
      var was = S.depth;
      window.history.back();
      setTimeout(function () { if (S && S.depth === was) { if (was > 1) { S.depth = was - 1; pick(); } else close(false); } }, 250);
    } else if (S.step === 2) pick();
    else close(false);
  }

  // ---------- opening ----------
  // Opened by the "Return or refund" button (a normal request), or by "tell us" on an order that is all final sale. Then o.canReturn is
  // false and only a damaged or wrong item can be asked for (o.canReportProblem).
  function open(ctx) {
    var o = ctx.order;
    var rules = ctx.cfg && ctx.cfg.returns ? ctx.cfg.returns : null;
    S = {
      ctx: ctx, o: o, rules: rules, reasons: rules ? rules.reasons : STANDARD, depth: 0, step: 1,
      problemOnly: !o.canReturn && o.canReportProblem,
      d: { requestId: newId(), picks: {}, unlocked: {}, reason: '', note: '', photos: [], limit: MAX_PHOTOS, attemptSig: '', done: false, sending: false }
    };
    // Only one line to choose from, and it can only be reported as damaged or wrong: start with it ticked.
    var open1 = o.items.filter(function (l) { return leftOf(l) > 0 && l.id; });
    if (S.problemOnly && open1.length === 1) S.d.picks[open1[0].id] = 1;
    push(1);
    pick();
  }

  // ---------- one line of the picker ----------
  function lineKind(l) {
    if (leftOf(l) <= 0 || !l.id) return 'used';
    if (l.finalSale && !S.problemOnly && !S.d.unlocked[l.id]) return 'final';
    return 'can';
  }
  function anyFinalPicked() {
    return S.o.items.some(function (l) { return l.finalSale && S.d.picks[l.id]; });
  }
  function restricted() { return S.problemOnly || anyFinalPicked(); }
  function pickedLines() {
    return S.o.items.filter(function (l) { return S.d.picks[l.id] > 0; });
  }

  // ---------- step 1: what, why, photos, a note ----------
  function head(kicker, title, meta) {
    var nodes = [
      el('button', { type: 'button', cls: 'crumb', on: { click: back } }, ['← ', S.step === 2 ? 'Back' : 'Your order']),
      el('div', { cls: 'kicker', text: kicker }),
      el('h1', { tabindex: '-1', text: title })
    ];
    if (meta) nodes.push(el('p', { cls: 'rmeta', text: meta }));
    return nodes;
  }
  function honeypot() {
    return el('div', { cls: 'hp', 'aria-hidden': 'true' }, [el('label', null, ['Website', el('input', { name: 'website', type: 'text', tabindex: '-1', autocomplete: 'off' })])]);
  }
  function errBox() { return el('div', { cls: 'err', role: 'alert' }); }
  function say(box, msg) { SF.clear(box); if (msg) box.appendChild(el('p', { text: msg })); }

  function pick() {
    S.step = 1;
    var o = S.o, d = S.d;
    SF.setTitle('Return or refund');
    var metaBits = [o.number];
    if (o.shippedAt) metaBits.push('Shipped ' + R.pacificDay(o.shippedAt));
    if (o.returnByDate) metaBits.push('Return by ' + R.dayText(o.returnByDate));

    var list = el('ul', { cls: 'rpick' });
    var rsnBox = el('fieldset', { cls: 'rsnset' });
    var photoBox = el('div', { cls: 'photobox' });
    var err = errBox();
    var noteField = el('textarea', { id: 'rnote', maxlength: String(MAX_NOTE), rows: '3', placeholder: '' });
    var count = el('div', { cls: 'count', text: '0 / ' + MAX_NOTE });
    var go = el('button', { type: 'submit', cls: 'btn', text: 'Continue' });
    noteField.value = d.note;
    count.textContent = d.note.length + ' / ' + MAX_NOTE;

    // --- the rows ---
    function drawRows() {
      SF.clear(list);
      o.items.forEach(function (l) { list.appendChild(row(l)); });
    }
    function row(l) {
      var kind = lineKind(l), left = leftOf(l), on = kind === 'can' && d.picks[l.id] > 0;
      var li = el('li', { cls: 'rrow ' + kind + (on ? ' on' : '') });
      var tags = el('b', { text: l.name });
      if (l.finalSale) { tags.appendChild(document.createTextNode(' ')); tags.appendChild(el('span', { cls: 'fs', text: 'Final sale' })); }
      var sub = (l.label ? l.label + ' · ' : '') + (left < l.qty ? left + ' left to return of ' + l.qty : l.qty > 1 ? l.qty + ' in this order' : 'Qty ' + l.qty);
      var text = el('div', { cls: 'rtx' }, [tags, el('small', { text: sub })]);
      if (kind === 'final') {
        text.appendChild(el('small', { cls: 'why', text: 'Final sale, so it can\'t be returned.' }));
        if (S.o.canReportProblem) {
          var tell = el('button', { type: 'button', cls: 'link strong', text: 'Damaged or wrong? Tell us' });
          tell.addEventListener('click', function () {
            d.unlocked[l.id] = true;
            d.picks[l.id] = 1;
            settle();
            drawRows();
            var cb = list.querySelector('[data-line="' + l.id + '"] input');
            if (cb) cb.focus();
          });
          text.appendChild(tell);
        }
      }
      if (kind === 'used') text.appendChild(el('small', { cls: 'why', text: 'Already in a return request.' }));
      var box;
      if (kind === 'can') {
        var cb = el('input', { type: 'checkbox', cls: 'sr', id: 'rl-' + l.id });
        cb.checked = on;
        cb.addEventListener('change', function () {
          if (cb.checked) d.picks[l.id] = d.picks[l.id] || 1; else delete d.picks[l.id];
          settle();
          drawRows();
          var again = list.querySelector('[data-line="' + l.id + '"] input');
          if (again) again.focus();
        });
        box = el('label', { 'for': 'rl-' + l.id, cls: 'rmain' }, [cb, el('span', { cls: 'rbox', 'aria-hidden': 'true', text: '✓' }), SF.photo(l.photo, l.name), text, el('span', { cls: 'mono', text: SF.usd(l.unit * l.qty) })]);
      } else {
        box = el('div', { cls: 'rmain' }, [el('span', { cls: 'rbox lock', 'aria-hidden': 'true' }, [R.icon('lock', 13)]), SF.photo(l.photo, l.name), text, el('span', { cls: 'mono', text: SF.usd(l.unit * l.qty) })]);
      }
      li.setAttribute('data-line', l.id);
      li.appendChild(box);
      if (on && left > 1) li.appendChild(stepper(l, left));
      return li;
    }
    function stepper(l, left) {
      var q = d.picks[l.id];
      var minus = el('button', { type: 'button', cls: 'minus', 'aria-label': 'One fewer ' + l.name, text: '−' });
      var plus = el('button', { type: 'button', cls: 'plus', 'aria-label': 'One more ' + l.name, text: '+' });
      var n = el('span', { text: String(q), 'aria-live': 'polite' });
      minus.disabled = q <= 1;
      plus.disabled = q >= left;
      function set(v) { d.picks[l.id] = v; n.textContent = String(v); minus.disabled = v <= 1; plus.disabled = v >= left; }
      minus.addEventListener('click', function () { if (d.picks[l.id] > 1) set(d.picks[l.id] - 1); });
      plus.addEventListener('click', function () { if (d.picks[l.id] < left) set(d.picks[l.id] + 1); });
      return el('div', { cls: 'rqty' }, [el('span', { cls: 'lbl', text: 'How many' }), el('div', { cls: 'qty' }, [minus, n, plus]), el('span', { cls: 'of', text: 'of ' + left })]);
    }

    // --- the reasons ---
    function drawReasons() {
      SF.clear(rsnBox);
      rsnBox.appendChild(el('legend', { cls: 'lbl', text: 'Why?' }));
      var group = el('div', { cls: 'rsn' });
      S.reasons.forEach(function (r) {
        if (restricted() && !PROBLEM[r.code]) return;
        var inp = el('input', { type: 'radio', name: 'reason', value: r.code, cls: 'sr' });
        inp.checked = d.reason === r.code;
        inp.addEventListener('change', function () { d.reason = r.code; drawPhotos(); });
        group.appendChild(el('label', { cls: 'rsnb' }, [inp, el('span', { text: r.label })]));
      });
      rsnBox.appendChild(group);
    }
    // --- the photos ---
    function fileProblem(f) {
      var t = String(f.type || '').toLowerCase();
      if (!(/^image\/(jpeg|png)$/.test(t) || /\.(jpe?g|png)$/i.test(f.name || ''))) return 'That file won\'t work. Use a JPEG or PNG photo.';
      if (f.size > MAX_BYTES) return 'That photo is over 8 MB. Choose a smaller one.';
      return '';
    }
    function uploadMessage(e) {
      // Any 413 means "that file can't be sent", whatever the server called it. Our own words when the server gave none.
      if (e && (e.status === 413 || e.status === 415) && /^http_/.test(e.code || '')) return 'That photo can\'t be sent. Try a different one.';
      return e && e.message ? e.message : SF.NET_MSG;
    }
    var photoErr = errBox();
    function addFiles(files) {
      say(photoErr, '');
      var room = d.limit - d.photos.length;
      var list2 = [].slice.call(files, 0);
      if (list2.length > room) { say(photoErr, room > 0 ? 'Up to ' + d.limit + ' photos. We took the first ' + room + '.' : 'That\'s the most photos: ' + d.limit + '.'); list2 = list2.slice(0, Math.max(room, 0)); }
      list2.reduce(function (p, f) { return p.then(function () { return addOne(f); }); }, Promise.resolve());
    }
    function addOne(f) {
      var bad = fileProblem(f);
      if (bad) { say(photoErr, bad); return Promise.resolve(); }
      var ph = { id: null, name: f.name || 'photo', url: null, state: 'up' };
      try { ph.url = URL.createObjectURL(f); } catch (e) { ph.url = null; }
      d.photos.push(ph);
      drawPhotos();
      return S.ctx.upload(f).then(function (res) {
        var id = res && res.photo && typeof res.photo.id === 'string' ? res.photo.id : '';
        if (!id) throw { message: 'We couldn\'t add that photo. Try another one.' };
        ph.id = id;
        ph.state = 'ready';
        if (typeof res.limit === 'number' && res.limit >= 1 && res.limit <= 10) d.limit = Math.round(res.limit);
        drawPhotos();
      }, function (e) { dropPhoto(ph); say(photoErr, uploadMessage(e)); drawPhotos(); });
    }
    function dropPhoto(ph) {
      var i = d.photos.indexOf(ph);
      if (i >= 0) d.photos.splice(i, 1);
      if (ph.url) { try { URL.revokeObjectURL(ph.url); } catch (e) { /* gone already */ } }
    }
    function drawPhotos() {
      SF.clear(photoBox);
      photoBox.hidden = !photosOn(d.reason);
      if (photoBox.hidden) return;
      photoBox.appendChild(el('div', { cls: 'lbl' }, ['Photos ', el('span', { cls: 'optl', text: 'optional · up to ' + d.limit + ' · they help us approve faster' })]));
      var tiles = el('div', { cls: 'ptiles' });
      d.photos.forEach(function (ph) {
        var t = el('div', { cls: 'ptile ' + ph.state });
        if (ph.url) { var img = el('img', { src: ph.url, alt: '' }); img.addEventListener('error', function () { SF.clear(t); t.appendChild(R.icon('camera', 22)); }); t.appendChild(img); }
        else t.appendChild(R.icon('camera', 22));
        if (ph.state === 'up') t.appendChild(el('span', { cls: 'spin', role: 'status', 'aria-label': 'Uploading' }));
        else {
          t.appendChild(el('button', { type: 'button', cls: 'rm', 'aria-label': 'Remove this photo', on: { click: function () { dropPhoto(ph); say(photoErr, ''); drawPhotos(); } } }, [R.icon('x', 12)]));
        }
        tiles.appendChild(t);
      });
      if (d.photos.length < d.limit) {
        var inp = el('input', { type: 'file', cls: 'sr', id: 'rphoto', accept: 'image/jpeg,image/png', multiple: true });
        inp.addEventListener('change', function () { var fl = inp.files; if (fl && fl.length) addFiles(fl); });
        tiles.appendChild(el('label', { cls: 'padd', 'for': 'rphoto' }, [inp, R.icon('plus', 20), el('span', { cls: 'sr', text: 'Add a photo' })]));
      }
      tiles.appendChild(el('span', { cls: 'phint', text: 'Show us the damage or what arrived.' }));
      photoBox.appendChild(tiles);
      photoBox.appendChild(photoErr);
    }

    // The reasons that are offered depend on the lines ticked: a final-sale line only goes with "damaged" or "wrong item".
    function settle() {
      if (restricted() && d.reason && !PROBLEM[d.reason]) d.reason = '';
      drawReasons();
      drawPhotos();
      say(err, '');
    }

    noteField.addEventListener('input', function () { d.note = noteField.value; count.textContent = d.note.length + ' / ' + MAX_NOTE; });

    var form = el('form', { cls: 'rform', novalidate: 'novalidate' }, [
      honeypot(),
      el('h2', { cls: 'lbl', text: 'What are you sending back?' }),
      list,
      el('p', { cls: 'cond' }, [R.icon('info', 16), 'We can take back items that are unworn, unwashed and have their tags on, in the original packaging where possible.']),
      rsnBox,
      photoBox,
      el('div', { cls: 'field' }, [el('label', { 'for': 'rnote' }, ['Anything else? ', el('span', { cls: 'optl', text: 'optional' })]), noteField, count]),
      err,
      go
    ]);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      say(err, '');
      if (!pickedLines().length) { say(err, 'Tick what you\'re sending back.'); return; }
      if (!d.reason) { say(err, 'Pick a reason.'); return; }
      if (d.photos.some(function (p) { return p.state === 'up'; })) { say(err, 'Your photo is still uploading. Give it a second.'); return; }
      var sig = JSON.stringify([d.picks, d.reason, d.note, d.photos.map(function (p) { return p.id; })]);
      // a changed request after a failed send gets its own id, so it can't be mistaken for the first try
      if (d.attemptSig && d.attemptSig !== sig) d.requestId = newId();
      d.attemptSig = '';
      push(2);
      review();
    });

    S.ctx.put(head('1 of 2', 'Return or refund', metaBits.join(' · ')).concat([form]));
    drawRows();
    drawReasons();
    drawPhotos();
  }

  // ---------- step 2: review and send ----------
  function whoPays(reason) {
    if (reason.ourMistake) {
      var why = reason.code === 'wrong_item' ? 'Because we sent the wrong item, we\'ll cover return shipping' : 'Because it arrived damaged, we\'ll cover return shipping';
      return { cls: 'ours', parts: [bold(why), ' and give back what you paid to ship it.'] };
    }
    if (S.rules && S.rules.shippingMode === 'shop_always') {
      return { cls: 'ours', parts: [bold('We\'ll cover return shipping.'), ' The shipping you paid on the way to you isn\'t refunded.'] };
    }
    return { cls: 'you', parts: [bold('You pay return shipping.'), ' The shipping you paid on the way to you isn\'t refunded. In Canada you also pay any customs.'] };
  }

  function review() {
    S.step = 2;
    var o = S.o, d = S.d;
    SF.setTitle('Review your return');
    var reason = reasonOf(d.reason);
    if (!reason || !pickedLines().length) { pick(); return; }
    var sendPhotos = photosOn(d.reason) ? d.photos.filter(function (p) { return p.id; }) : [];
    var err = errBox();
    var send = el('button', { type: 'button', cls: 'btn', text: 'Send request' });

    var rows = el('dl', { cls: 'rsum' });
    function line(label, kids) { rows.appendChild(el('div', { cls: 'rr' }, [el('dt', { text: label }), el('dd', null, kids)])); }
    line('Sending back', pickedLines().map(function (l) {
      return el('div', { cls: 'rit' }, [el('span', { text: d.picks[l.id] + ' × ' + l.name + (l.label ? ' · ' + l.label : '') }), el('span', { cls: 'mono', text: SF.usd(l.unit * d.picks[l.id]) })]);
    }));
    line('Reason', [reason.label]);
    if (sendPhotos.length) line('Photos', [sendPhotos.length + ' added']);
    if (d.note.trim()) line('Your note', [el('em', { text: '“' + d.note.trim() + '”' })]);

    var pays = whoPays(reason);
    var next = el('ol', { cls: 'nexts' });
    [['We look at your request', 'Within 1 to 2 business days. We\'ll email you.'],
     ['If we approve it, you send it back', 'We email the return address. Please don\'t send anything before that: a package without approval may be refused.'],
     ['We check it, then refund you', 'Only after we receive the package and check what\'s inside. The refund goes back to your original payment method; banks take about 5 to 10 business days.']
    ].forEach(function (x, i) {
      next.appendChild(el('li', null, [el('span', { cls: 'no', text: String(i + 1) }), el('div', null, [el('b', { text: x[0] }), el('span', { cls: 's', text: x[1] })])]));
    });

    function done(res) {
      d.done = true;
      d.sending = false;
      sent(window.SFOrder.normReturn(res && res.return));
    }
    function fail(e) {
      d.sending = false;
      send.disabled = false;
      send.textContent = 'Send request';
      SF.clear(err);
      err.appendChild(el('p', { text: e && e.message ? e.message : SF.NET_MSG }));
      // The order has moved on (a rule or the window changed, or the units are gone): show it again from the server, not this form.
      if (e && STALE[e.code]) {
        send.hidden = true;
        err.appendChild(el('button', { type: 'button', cls: 'btn small ghost', text: 'Back to your order', on: { click: function () { close(true); } } }));
      }
      err.scrollIntoView({ block: 'nearest' });
    }
    send.addEventListener('click', function () {
      if (d.sending) return;
      d.sending = true;
      d.attemptSig = JSON.stringify([d.picks, d.reason, d.note, d.photos.map(function (p) { return p.id; })]);
      send.disabled = true;
      send.textContent = 'Sending…';
      say(err, '');
      var body = {
        request_id: d.requestId,
        items: pickedLines().map(function (l) { return { id: l.id, qty: d.picks[l.id] }; }),
        reason: d.reason
      };
      if (d.note.trim()) body.note = d.note.trim();
      if (sendPhotos.length) body.photo_ids = sendPhotos.map(function (p) { return p.id; });
      S.ctx.post('/returns', body).then(done, fail);
    });

    S.ctx.put(head('2 of 2', 'Review').concat([
      honeypot(),
      rows,
      el('p', { cls: 'who ' + pays.cls }, pays.parts),
      el('h2', { cls: 'lbl', text: 'What happens next' }),
      next,
      el('p', { cls: 'polink' }, [el('a', { href: '/shipping-returns', target: '_blank', rel: 'noopener', text: 'Read the full Returns policy ›' })]),
      err,
      send
    ]));
  }

  // ---------- after sending: Request sent ----------
  function sent(ret) {
    S.step = 3;
    SF.setTitle('Request sent');
    try { window.history.replaceState({ sfFlow: 3 }, ''); } catch (e) { /* no history */ }
    var day = ret ? R.pacificDay(ret.requestedAt) : '';
    var steps = [
      ['Requested', 'Today' + (day ? ', ' + day : '') + '. We have it.', true],
      ['Approved', 'We email you the return address. Please wait for it before you send anything.'],
      ['Shipped back', 'You send it. Adding the tracking number is optional.'],
      ['Received & checked', 'We open the package and check what\'s inside.'],
      ['Refunded', 'Back to your original payment method, only after step 4.']
    ];
    var list = el('ol', { cls: 'nexts sentlist' });
    steps.forEach(function (x, i) {
      list.appendChild(el('li', { cls: x[2] ? 'done' : '' }, [el('span', { cls: 'no', text: x[2] ? '✓' : String(i + 1) }), el('div', null, [el('b', { text: x[0] }), el('span', { cls: 's', text: x[1] })])]));
    });
    var viewBtn = el('button', { type: 'button', cls: 'btn', text: 'View order', on: { click: function () { close(true); } } });
    S.ctx.put([
      el('div', { cls: 'sentmark', 'aria-hidden': 'true', text: '✓' }),
      el('h1', { cls: 'sentt', tabindex: '-1', text: 'Request sent' }),
      ret ? el('p', { cls: 'sentno mono', text: ret.number }) : null,
      el('p', { cls: 'sentsub' }, ['We\'ll email you within ', bold('1 to 2 business days'), '.']),
      el('h2', { cls: 'lbl', text: 'Where it stands' }),
      list,
      viewBtn,
      el('p', { cls: 'fine ctr', text: 'Nothing is refunded until we receive and check your package.' })
    ]);
  }

  window.SFReturnFlow = { open: open };
})();
