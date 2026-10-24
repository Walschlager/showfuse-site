/* ShowFuse shop: how a return looks on the order page (/shop/order/). Build 14, against docs/BUILD_14_API_CONTRACT.md.
   What the buyer sees: a card for each request (its number, a five-step bar, what to do next), the "Return or refund" button
   and the line under it, and the lines that stand in for the button when it can't be pressed (window closed, final sale).
   Every fact about an order (dates, who pays, the return address, why a request was turned down) comes from the server, and the
   dates that mean "by when" are the server's own Pacific days (return_by_date, ship_by_date). Nothing here works out a deadline.
   The words around those facts are the approved ones from the returns mockup. Server text always goes in with textContent. */
(function () {
  'use strict';
  var SF = window.SFShop;
  if (!SF) return;
  var el = SF.el;

  // ---------- days ----------
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // "2026-11-15" (a Pacific calendar day from the server) -> "Nov 15". No clock and no time zone are involved.
  function dayText(ymd) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
    if (!m || +m[2] < 1 || +m[2] > 12) return '';
    return MONTHS[+m[2] - 1] + ' ' + (+m[3]);
  }
  // An event time (ISO, UTC) -> its day on the Pacific calendar, the calendar every rule counts on: "Oct 24".
  function pacificDay(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    try { return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric' }).format(d); } catch (e) { return ''; }
  }

  // ---------- small icons (the mockup's own paths) ----------
  var NS = 'http://www.w3.org/2000/svg';
  var ICONS = {
    info: { sw: 1.9, kids: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M12 11v5.5M12 7.6h.01', 'stroke-width': 2.4 }]] },
    lock: { sw: 1.9, kids: [['rect', { x: 4.5, y: 10.5, width: 15, height: 10, rx: 2 }], ['path', { d: 'M7.8 10.5V8a4.2 4.2 0 0 1 8.4 0v2.5' }]] },
    camera: { sw: 1.8, kids: [['path', { d: 'M4 8.5h3l1.6-2.5h6.8L17 8.5h3a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5a1 1 0 0 1 1-1z' }], ['circle', { cx: 12, cy: 13.4, r: 3.3 }]] },
    copy: { sw: 1.9, kids: [['rect', { x: 8.5, y: 8.5, width: 11, height: 11, rx: 2 }], ['path', { d: 'M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2' }]] },
    plus: { sw: 2.5, kids: [['path', { d: 'M12 4.5v15M4.5 12h15' }]] },
    minus: { sw: 2.5, kids: [['path', { d: 'M5 12h14' }]] },
    x: { sw: 2.3, kids: [['path', { d: 'M5.5 5.5l13 13M18.5 5.5l-13 13' }]] },
    mail: { sw: 1.7, kids: [['rect', { x: 3, y: 5.5, width: 18, height: 13, rx: 2 }], ['path', { d: 'M3.8 7.6l8.2 6 8.2-6' }]] }
  };
  function icon(name, size) {
    var spec = ICONS[name];
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', String(size || 16));
    svg.setAttribute('height', String(size || 16));
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', String(spec.sw));
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    spec.kids.forEach(function (k) {
      var n = document.createElementNS(NS, k[0]);
      Object.keys(k[1]).forEach(function (a) { n.setAttribute(a, String(k[1][a])); });
      svg.appendChild(n);
    });
    return el('span', { cls: 'ico' }, [svg]);
  }

  // ---------- words ----------
  var STEPS = ['Requested', 'Approved', 'Shipped back', 'Received & checked', 'Refunded'];
  var CHIP = { requested: 's-ask', approved: 's-ok', shipped_back: 's-ask', received: 's-ask', refunded: 's-done', declined: 's-no', cancelled: 's-off', expired: 's-off', closed: 's-off' };
  var FALLBACK_LABEL = { requested: 'Requested', approved: 'Approved', shipped_back: 'Shipped back', received: 'Received', refunded: 'Refunded', declined: 'Declined', cancelled: 'Cancelled', expired: 'Expired', closed: 'Closed' };

  function bold(t) { return el('b', { text: t }); }
  function statusLabel(r) { return r.statusLabel || FALLBACK_LABEL[r.status] || 'Return'; }
  // "1 × Fuse Hoodie M, 2 × Pro Beanie One size". With received: the units that were really received (the refund is for those).
  function itemsText(r, received) {
    return r.items.map(function (i) {
      var q = received && i.receivedQty !== null ? i.receivedQty : i.qty;
      return q > 0 ? q + ' × ' + i.name + (i.label ? ' ' + i.label : '') : '';
    }).filter(function (t) { return t; }).join(', ');
  }
  function helpHref(subject) { return 'mailto:' + SF.MAIL + '?subject=' + encodeURIComponent(subject); }

  // The date on the right of a card's header: the day the latest step happened, on the Pacific calendar.
  function whenText(r) {
    if (r.status === 'requested') return pacificDay(r.requestedAt);
    if (r.status === 'approved') return pacificDay(r.approvedAt);
    if (r.status === 'shipped_back') return r.tracking ? pacificDay(r.tracking.addedAt) : '';
    if (r.status === 'received' || r.status === 'closed') return pacificDay(r.receivedAt);
    if (r.status === 'refunded') return pacificDay((r.refund && r.refund.refundedAt) || r.refundedAt);
    if (r.status === 'declined') return pacificDay(r.declinedAt);
    return '';
  }

  // The five-step bar (a request that ends early shows the steps it reached, then how it ended).
  function stepList(r) {
    var s = r.status, out = [];
    if (s === 'declined') out = [['Requested', 'done'], ['Declined', 'bad']];
    else if (s === 'cancelled') out = [['Requested', 'done']].concat(r.approvedAt ? [['Approved', 'done']] : [], [['Cancelled', 'off']]);
    else if (s === 'expired') out = [['Requested', 'done'], ['Approved', 'done']].concat(r.tracking ? [['Shipped back', 'done']] : [], [['Expired', 'off']]);
    else if (s === 'closed') out = [['Requested', 'done'], ['Approved', 'done'], ['Shipped back', 'done'], ['Received & checked', 'done'], ['Closed', 'off']];
    else {
      var at = { requested: 0, approved: 1, shipped_back: 2, received: 3, refunded: 4 }[s];
      if (at === undefined) return null;
      STEPS.forEach(function (label, i) { out.push([label, i <= at ? 'done' : i === at + 1 ? 'now' : 'todo']); });
    }
    return out;
  }
  var SAYS = { done: 'done', now: 'next', bad: 'ended', off: 'ended', todo: 'not yet' };
  function bar(r) {
    var list = stepList(r);
    if (!list) return null;
    var ol = el('ol', { cls: 'rsteps n' + list.length, 'aria-label': 'Where this return stands' });
    list.forEach(function (st) {
      ol.appendChild(el('li', { cls: st[1] }, [st[0], el('span', { cls: 'sr', text: ', ' + SAYS[st[1]] })]));
    });
    return ol;
  }

  function note(parts) { return el('p', { cls: 'rnote' }, parts); }
  function refundLine() { return note(['Your refund comes ', bold('after we receive and check the package'), '.']); }

  // ---------- the return address, and copying it ----------
  function addressLines(a) {
    var lines = [];
    if (a.name) lines.push(a.name);
    if (a.line1) lines.push(a.line1);
    if (a.line2) lines.push(a.line2);
    var last = (a.city ? a.city + (a.state ? ', ' : '') : '') + (a.state ? a.state : '') + (a.postal ? ' ' + a.postal : '');
    if (last.trim()) lines.push(last.trim());
    if (a.country && a.country !== 'US') lines.push(a.country);
    return lines;
  }
  function legacyCopy(text) {
    try {
      var t = el('textarea', { cls: 'sr', 'aria-hidden': 'true', tabindex: '-1', readonly: 'readonly' });
      t.value = text;
      document.body.appendChild(t);
      t.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(t);
      return !!ok;
    } catch (e) { return false; }
  }
  function copyText(text) {
    if (!(navigator.clipboard && navigator.clipboard.writeText)) return Promise.resolve(legacyCopy(text));
    // a browser that never answers the clipboard call gets the old way after a moment, so the button never just sits there
    return new Promise(function (resolve) {
      var done = false;
      function fin(v) { if (!done) { done = true; resolve(v); } }
      setTimeout(function () { fin(legacyCopy(text)); }, 2500);
      navigator.clipboard.writeText(text).then(function () { fin(true); }, function () { fin(legacyCopy(text)); });
    });
  }
  function copyButton(text) {
    var label = el('span', { text: 'Copy address' });
    var b = el('button', { type: 'button', cls: 'copy' }, [icon('copy', 14), label]);
    var timer = null;
    b.addEventListener('click', function () {
      copyText(text).then(function (ok) {
        label.textContent = ok ? 'Copied' : 'Press and hold the address to copy it';
        clearTimeout(timer);
        timer = setTimeout(function () { label.textContent = 'Copy address'; }, 2200);
      });
    });
    return b;
  }

  // ---------- tracking and postage (approved, shipped back) ----------
  // One small form. Everything in it is optional, but at least one thing is needed. Postage only when the shop pays the return shipping.
  function trackForm(r, ctx) {
    var form = el('form', { cls: 'tform', novalidate: 'novalidate' });
    var id = 'tr-' + r.number;
    var carrier = el('input', { type: 'text', id: id + '-c', maxlength: '30', autocomplete: 'off', placeholder: 'USPS, UPS, FedEx…' });
    var number = el('input', { type: 'text', id: id + '-n', maxlength: '40', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', placeholder: 'Tracking number' });
    var postage = r.pays === 'shop' ? el('input', { type: 'text', id: id + '-p', inputmode: 'decimal', maxlength: '6', autocomplete: 'off', placeholder: '0.00', 'aria-describedby': id + '-ph' }) : null;
    if (r.tracking) { carrier.value = r.tracking.carrier; number.value = r.tracking.number; }
    if (postage && r.postage !== null) postage.value = (r.postage / 100).toFixed(2);
    var err = el('div', { cls: 'err', role: 'alert' });
    var save = el('button', { type: 'submit', cls: 'btn small line', text: 'Save' });
    var busy = false;

    function fail(msg) { SF.clear(err); err.appendChild(el('p', { text: msg })); }

    form.appendChild(el('div', { cls: 'hp', 'aria-hidden': 'true' }, [el('label', null, ['Website', el('input', { name: 'website', type: 'text', tabindex: '-1', autocomplete: 'off' })])]));
    form.appendChild(el('div', { cls: 'tfields' }, [
      el('div', { cls: 'field n' }, [el('label', { 'for': id + '-n' }, ['Tracking number']), number]),
      el('div', { cls: 'field c' }, [el('label', { 'for': id + '-c' }, ['Carrier']), carrier])
    ]));
    if (postage) {
      form.appendChild(el('div', { cls: 'field p' }, [
        el('label', { 'for': id + '-p' }, ['Postage you paid']),
        el('div', { cls: 'money' }, [el('span', { cls: 'cur', 'aria-hidden': 'true', text: '$' }), postage]),
        el('small', { id: id + '-ph', cls: 'hint', text: 'We add it to your refund.' })
      ]));
    }
    form.appendChild(err);
    form.appendChild(save);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (busy) return;
      SF.clear(err);
      var c = carrier.value.trim(), n = number.value.trim(), p = postage ? postage.value.trim().replace(/^\$/, '') : '';
      var body = {};
      if (c) body.carrier = c;
      if (n) {
        if (!/^[A-Za-z0-9 -]{5,40}$/.test(n)) { fail('A tracking number is 5 to 40 letters, numbers, spaces or dashes.'); number.focus(); return; }
        body.tracking_number = n;
      }
      if (p) {
        if (!/^\d{1,3}(\.\d{1,2})?$/.test(p) || parseFloat(p) > 100) { fail('Type the postage in dollars and cents, up to $100, like 8.40.'); postage.focus(); return; }
        body.postage_cents = Math.round(parseFloat(p) * 100);
      }
      if (!Object.keys(body).length) { fail(postage ? 'Add a tracking number, or the postage you paid.' : 'Add a tracking number.'); number.focus(); return; }
      busy = true;
      save.disabled = true;
      save.textContent = 'Saving…';
      ctx.post('/returns/' + r.number + '/tracking', body).then(function (res) {
        busy = false;
        var next = window.SFOrder.normReturn(res && res.return);
        if (next) ctx.replaceReturn(next, { saved: true });
        else ctx.reload();
      }, function (e2) {
        busy = false;
        save.disabled = false;
        save.textContent = 'Save';
        fail(e2 && e2.message ? e2.message : SF.NET_MSG);
        // the request has moved on (it can't take tracking any more): say so, and offer the order as it is now
        if (e2 && e2.status === 409) { save.hidden = true; err.appendChild(el('button', { type: 'button', cls: 'btn small ghost', text: 'Show my order again', on: { click: ctx.reload } })); }
      });
    });
    return form;
  }

  // ---------- "Send it back": the instructions after an approval ----------
  function instructions(r, ctx) {
    var cfg = ctx.cfg && ctx.cfg.returns;
    var box = el('div', { cls: 'ins' });
    box.appendChild(el('h3', { cls: 'lbl', text: 'Send it back' }));

    function row(n, title, extra) {
      return el('div', { cls: 'ir' }, [el('span', { cls: 'no', text: n }), el('div', null, [el('b', null, title)].concat(extra || []))]);
    }
    if (r.address) {
      var lines = addressLines(r.address);
      var adr = el('div', { cls: 'adr' });
      lines.forEach(function (ln, i) { if (i) adr.appendChild(el('br')); adr.appendChild(document.createTextNode(ln)); });
      box.appendChild(row('1', ['Send it to'], [adr, copyButton(lines.join('\n'))]));
    }
    box.appendChild(row(r.address ? '2' : '1', ['Write your order number on the box'], [el('span', { cls: 'boxcode', text: ctx.order.number })]));
    var by = dayText(r.shipByDate);
    var when = cfg && cfg.shipWithinDays ? 'Ship it within ' + cfg.shipWithinDays + ' days' + (by ? ', by ' + by : '') : (by ? 'Ship it by ' + by : 'Ship it back');
    box.appendChild(row(r.address ? '3' : '2', [when], [el('span', { cls: 's', text: 'Any tracked service works. ' + (r.shippingNote ? r.shippingNote + ' ' : '') + 'Keep your receipt.' })]));
    box.appendChild(row(r.address ? '4' : '3', ['Add your tracking ', el('span', { cls: 'optl', text: '(optional)' })], [trackForm(r, ctx)]));
    return box;
  }

  // "Cancel this request": a quiet link that asks once.
  function cancelBox(r, ctx) {
    var wrap = el('div', { cls: 'cancelbox' });
    var err = el('div', { cls: 'err', role: 'alert' });
    function ask() {
      SF.clear(wrap);
      var yes = el('button', { type: 'button', cls: 'btn small line', text: 'Yes, cancel it' });
      var keep = el('button', { type: 'button', cls: 'btn small ghost', text: 'Keep it', on: { click: rest } });
      yes.addEventListener('click', function () {
        yes.disabled = true;
        keep.disabled = true;
        yes.textContent = 'Cancelling…';
        SF.clear(err);
        ctx.post('/returns/' + r.number + '/cancel', {}).then(function () { ctx.reload(); }, function (e) {
          yes.disabled = false;
          keep.disabled = false;
          yes.textContent = 'Yes, cancel it';
          err.appendChild(el('p', { text: e && e.message ? e.message : SF.NET_MSG }));
          if (e && e.status === 409) { yes.hidden = true; keep.hidden = true; err.appendChild(el('button', { type: 'button', cls: 'btn small ghost', text: 'Show my order again', on: { click: ctx.reload } })); }
        });
      });
      wrap.appendChild(el('p', { cls: 'cq', text: 'Cancel ' + r.number + '?' }));
      wrap.appendChild(el('div', { cls: 'cbtns' }, [yes, keep]));
      wrap.appendChild(err);
      yes.focus();
    }
    function rest() {
      SF.clear(wrap);
      wrap.appendChild(el('button', { type: 'button', cls: 'quietlnk', text: 'Cancel this request', on: { click: ask } }));
    }
    rest();
    return wrap;
  }

  // ---------- what we refunded ----------
  function refundBox(r) {
    var f = r.refund;
    if (!f) return null;
    var box = el('div', { cls: 'refbox' });
    box.appendChild(el('div', { cls: 'lbl', text: 'We refunded' }));
    box.appendChild(el('div', { cls: 'big mono', text: SF.usd(f.amount) }));
    if (!f.custom) {
      var rows = [];
      if (f.items) rows.push([itemsText(r, true) || 'Items you sent back', f.items]);
      if (f.tax) rows.push(['Tax on those items', f.tax]);
      if (f.shipping) rows.push(['Original shipping' + (r.ourMistake ? ' (our mistake)' : ''), f.shipping]);
      if (f.postage) rows.push(['Return postage you paid', f.postage]);
      rows.forEach(function (x) {
        box.appendChild(el('div', { cls: 'rl' }, [el('span', { text: x[0] }), el('span', { cls: 'mono', text: SF.usd(x[1]) })]));
      });
    }
    box.appendChild(note(['It went back to your ', bold('original payment method'), '. Banks usually take about 5 to 10 business days to show it.']));
    return box;
  }

  function emailBox(r, order) {
    return el('div', { cls: 'rmail' }, [
      el('a', { cls: 'btn ghost', href: helpHref('Question about ' + r.number + ' (order ' + order.number + ')') }, [icon('mail', 16), 'Questions? Email us']),
      el('p', { cls: 'rsmall', text: 'Opens an email to ' + SF.MAIL + ' with ' + r.number + ' and ' + order.number + ' in it.' })
    ]);
  }

  // ---------- one card ----------
  function body(r, ctx, opts) {
    var s = r.status, out = [];
    if (s === 'requested') {
      out.push(note(['We have your request. We\'ll email you within ', bold('1 to 2 business days'), '. Please wait for our answer before you send anything.']));
      out.push(refundLine());
      if (r.canCancel) out.push(cancelBox(r, ctx));
    } else if (s === 'approved') {
      out.push(refundLine());
      out.push(instructions(r, ctx));
      if (r.canCancel) out.push(cancelBox(r, ctx));
    } else if (s === 'shipped_back') {
      out.push(refundLine());
      var t = r.tracking;
      var line = t ? [t.carrier, t.number].filter(function (x) { return x; }).join(' ') : '';
      var tbox = el('div', { cls: 'tsum' });
      var thead = el('div', { cls: 'thead' }, [el('span', { cls: 'lbl', text: 'Your tracking' })]);
      tbox.appendChild(thead);
      tbox.appendChild(el('div', { cls: 'tline mono', text: line || 'Not added' }));
      if (r.postage !== null && r.pays === 'shop') tbox.appendChild(el('div', { cls: 'tpost', text: 'Postage you paid: ' + SF.usd(r.postage) }));
      if (opts && opts.saved) tbox.appendChild(el('p', { cls: 'okline', role: 'status', text: 'Saved. Thank you.' }));
      if (r.canAddTracking) {
        var form = trackForm(r, ctx);
        form.hidden = true;
        var change = el('button', { type: 'button', cls: 'link', text: 'Change' });
        change.addEventListener('click', function () {
          form.hidden = !form.hidden;
          change.textContent = form.hidden ? 'Change' : 'Hide';
          if (!form.hidden) form.querySelector('#tr-' + r.number + '-n').focus();
        });
        thead.appendChild(change);
        tbox.appendChild(form);
      }
      out.push(tbox);
      if (r.address) {
        var lines = addressLines(r.address);
        var adr = el('div', { cls: 'adr' });
        lines.forEach(function (ln, i) { if (i) adr.appendChild(el('br')); adr.appendChild(document.createTextNode(ln)); });
        out.push(el('details', { cls: 'where' }, [el('summary', { text: 'Where to send it' }), adr, copyButton(lines.join('\n')),
          el('p', { cls: 'rsmall' }, ['Write ', bold(ctx.order.number), ' on the box.'])]));
      }
    } else if (s === 'received') {
      if (r.check && r.check.problem) {
        out.push(note(['We received your package and found a problem with it.']));
        if (r.check.note) out.push(el('blockquote', { cls: 'rquote', text: '“' + r.check.note + '”' }));
        out.push(note(['We may refund only part of the price, or nothing. We\'ll email you what we decide.']));
      } else {
        out.push(note(['We received your package and checked it. ', bold('Your refund is next.'), ' We\'ll email you when we\'ve made it.']));
      }
    } else if (s === 'refunded') {
      out.push(refundBox(r) || note(['We refunded this return. It went back to your ', bold('original payment method'), '.']));
    } else if (s === 'declined') {
      out.push(el('div', { cls: 'rwhy' }, [el('p', null, [bold('We couldn\'t approve this return.')]),
        r.declineReason ? el('p', { cls: 'rquote', text: '“' + r.declineReason + '”' }) : null]));
      out.push(note(['Nothing was refunded, and nothing else about your order has changed.']));
      out.push(emailBox(r, ctx.order));
    } else if (s === 'cancelled') {
      out.push(note(['You cancelled this request. Nothing was refunded, and nothing else about your order has changed.']));
    } else if (s === 'expired') {
      out.push(note(['This request expired because we didn\'t get a package in time. If you did send one, email us and we\'ll look into it.']));
      out.push(emailBox(r, ctx.order));
    } else if (s === 'closed') {
      out.push(el('div', { cls: 'rwhy' }, [el('p', null, [bold('We received your return, but we couldn\'t refund it.')]),
        r.closedNote ? el('p', { cls: 'rquote', text: '“' + r.closedNote + '”' }) : null]));
      out.push(note(['Nothing was refunded, and nothing else about your order has changed.']));
      out.push(emailBox(r, ctx.order));
    }
    return out;
  }

  function card(r, ctx, opts) {
    var box = el('section', { cls: 'rcard ' + r.status, 'data-ret': r.number, 'aria-label': 'Return ' + r.number });
    var when = whenText(r);
    box.appendChild(el('div', { cls: 'rh' }, [
      el('span', { cls: 'lbl', text: 'Return' }),
      el('span', { cls: 'rno mono', text: r.number }),
      el('span', { cls: 'rwhen' }, [when ? el('span', { cls: 'rdate', text: when }) : null, el('span', { cls: 'rchip ' + (CHIP[r.status] || 's-off'), text: statusLabel(r) })])
    ]));
    var b = bar(r);
    if (b) box.appendChild(b);
    var what = itemsText(r);
    if (what) box.appendChild(el('p', { cls: 'ritems', text: what + (r.reasonLabel ? ' · ' + r.reasonLabel : '') }));
    body(r, ctx, opts).forEach(function (n) { if (n) box.appendChild(n); });
    return box;
  }

  // All the cards of an order (the server sends them newest first).
  function cards(order, ctx) {
    return order.returns.map(function (r) { return card(r, ctx); });
  }

  // ---------- the button, and the lines that stand in for it ----------
  function actions(o, ctx) {
    var out = [];
    if (o.canReturn) {
      out.push(el('button', { type: 'button', cls: 'btn ghost', text: 'Return or refund', on: { click: function () { ctx.startFlow({}); } } }));
      if (o.returnByDate) out.push(el('p', { cls: 'until' }, ['You can return this until ', bold(dayText(o.returnByDate)), '.']));
    } else if (o.returnClosed === 'window') {
      var help = el('a', { href: helpHref('Help with order ' + o.number), text: 'Need help?' });
      out.push(el('p', { cls: 'rclosed' }, o.returnByDate ? ['Return window closed on ', bold(dayText(o.returnByDate)), ' · ', help] : ['The return window has closed · ', help]));
    } else if (o.returnClosed === 'final_sale') {
      out.push(el('button', { type: 'button', cls: 'btn ghost', disabled: true, 'aria-describedby': 'fsnote' }, [icon('lock', 16), 'Return or refund']));
      var tail = [bold('Final sale.'), ' Everything in this order is final sale, so it can\'t be returned.'];
      if (o.canReportProblem) {
        tail.push(' A damaged or wrong item can still always be fixed: ');
        tail.push(el('button', { type: 'button', cls: 'link strong', text: 'tell us ›', on: { click: function () { ctx.startFlow({ problem: true }); } } }));
      }
      out.push(el('p', { id: 'fsnote', cls: 'fsnote' }, tail));
    }
    return out;
  }

  window.SFReturns = { cards: cards, card: card, actions: actions, dayText: dayText, pacificDay: pacificDay, icon: icon, itemsText: itemsText, helpHref: helpHref, addressLines: addressLines };
})();
