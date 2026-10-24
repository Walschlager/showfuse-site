/* ShowFuse shop: how an order is drawn. Shared by /shop/thanks/ and /shop/order/.
   The server never sends a street address, a name, an email or a phone number: only the city and
   state, and only after payment. Server text always goes in with textContent.
   Build 14 adds the return fields of GET /v1/shop/order (docs/BUILD_14_API_CONTRACT.md, sections 2 and 3). A server that doesn't
   have them (13.2) sends none, and then none of it shows: no tag, no button. */
(function () {
  'use strict';
  var SF = window.SFShop;
  if (!SF) return;
  var el = SF.el;

  function str(v, max) { return typeof v === 'string' ? v.slice(0, max || 200) : ''; }
  function num(v) { return typeof v === 'number' && isFinite(v) ? Math.round(v) : 0; }
  function numOrNull(v) { return typeof v === 'number' && isFinite(v) ? Math.round(v) : null; }

  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var DAY = /^\d{4}-\d{2}-\d{2}$/;
  var RETURN_STATUS = ['requested', 'approved', 'shipped_back', 'received', 'refunded', 'declined', 'cancelled', 'expired', 'closed'];
  var RETURN_CLOSED = ['not_shipped', 'unavailable', 'window', 'nothing_left', 'final_sale'];

  // One return request (the Return object, contract section 3). Dates that mean "by when" are the server's Pacific day (shipByDate), never worked out here.
  function normReturn(r) {
    if (!r || typeof r.number !== 'string' || !/^RET-\d{3,9}$/.test(r.number)) return null;
    var a = r.return_address && typeof r.return_address === 'object' ? r.return_address : null;
    var t = r.tracking && typeof r.tracking === 'object' ? r.tracking : null;
    var c = r.check && typeof r.check === 'object' ? r.check : null;
    var f = r.refund && typeof r.refund === 'object' ? r.refund : null;
    var ret = {
      number: r.number, status: RETURN_STATUS.indexOf(r.status) >= 0 ? r.status : 'unknown', statusLabel: str(r.status_label, 40),
      reason: str(r.reason, 30), reasonLabel: str(r.reason_label, 60), ourMistake: r.our_mistake === true,
      note: str(r.note, 500), photoCount: num(r.photo_count), items: [],
      requestedAt: str(r.requested_at, 40), approvedAt: str(r.approved_at, 40), declinedAt: str(r.declined_at, 40),
      receivedAt: str(r.received_at, 40), refundedAt: str(r.refunded_at, 40),
      shipByDate: DAY.test(r.ship_by_date) ? r.ship_by_date : '',
      pays: r.pays_return_shipping === 'shop' || r.pays_return_shipping === 'buyer' ? r.pays_return_shipping : null,
      shippingNote: str(r.shipping_note, 600),
      address: a ? { name: str(a.name, 120), line1: str(a.line1, 120), line2: str(a.line2, 120), city: str(a.city, 80), state: str(a.state, 20), postal: str(a.postal_code, 20), country: str(a.country, 2) } : null,
      tracking: t ? { carrier: str(t.carrier, 40), number: str(t.number, 60), addedAt: str(t.added_at, 40) } : null,
      postage: numOrNull(r.postage_cents),
      declineReason: str(r.decline_reason, 400), closedNote: str(r.closed_note, 400),
      check: c ? { problem: c.condition === 'problem', note: str(c.note, 400) } : null,
      refund: f ? { amount: num(f.amount_cents), refundedAt: str(f.refunded_at, 40), custom: f.custom === true, items: numOrNull(f.items_cents), tax: numOrNull(f.tax_cents), shipping: numOrNull(f.shipping_cents), postage: numOrNull(f.postage_cents) } : null,
      canCancel: r.can_cancel === true, canAddTracking: r.can_add_tracking === true
    };
    (Array.isArray(r.items) ? r.items : []).forEach(function (i) {
      if (i && typeof i.name === 'string') ret.items.push({ id: typeof i.id === 'string' && UUID.test(i.id) ? i.id : '', name: str(i.name, 120), label: str(i.label, 30), qty: num(i.qty), receivedQty: numOrNull(i.received_qty) });
    });
    return ret;
  }

  function countryName(code) {
    if (!/^[A-Z]{2}$/.test(code || '')) return '';
    try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) || code; } catch (e) { return code; }
  }

  function norm(j) {
    if (!j || typeof j.number !== 'string' || !/^SF-\d{3,9}$/.test(j.number)) return null;
    var t = j.tracking && typeof j.tracking === 'object' ? j.tracking : null;
    var o = {
      number: j.number, status: str(j.status, 20), placedAt: str(j.placed_at, 40), paidAt: str(j.paid_at, 40), shippedAt: str(j.shipped_at, 40),
      country: str(j.country, 2), city: str(j.city, 80), region: str(j.region, 40), items: [],
      subtotal: num(j.subtotal_cents), shipping: num(j.shipping_cents), tax: numOrNull(j.tax_cents), total: numOrNull(j.total_cents),
      refunded: num(j.refunded_cents),
      tracking: t && typeof t.number === 'string' && t.number ? { carrier: str(t.carrier, 40), number: str(t.number, 60), url: SF.safeHttps(t.url) } : null
    };
    (Array.isArray(j.items) ? j.items : []).forEach(function (i) {
      if (i && typeof i.name === 'string') {
        o.items.push({
          id: typeof i.id === 'string' && UUID.test(i.id) ? i.id : '', name: str(i.name, 120), label: str(i.label, 30), qty: num(i.qty), unit: num(i.unit_cents),
          photo: typeof i.photo === 'string' ? i.photo : null, finalSale: i.final_sale === true, returnableQty: numOrNull(i.returnable_qty)
        });
      }
    });
    // Build 14: the return window, whether a request can be made now, and the requests so far (newest first, as the server sends them).
    o.returnByDate = DAY.test(j.return_by_date) ? j.return_by_date : '';
    o.canReturn = j.can_return === true;
    o.canReportProblem = j.can_report_problem === true;
    o.returnClosed = RETURN_CLOSED.indexOf(j.return_closed) >= 0 ? j.return_closed : null;
    o.returns = [];
    (Array.isArray(j.returns) ? j.returns : []).forEach(function (r) { var x = normReturn(r); if (x) o.returns.push(x); });
    return o;
  }

  function isPaid(o) { return o.status === 'paid' || o.status === 'shipped' || o.status === 'refunded'; }

  // Where the order stands, as a list: Paid, packed, on its way.
  function track(o) {
    var paidLine = (o.total !== null ? SF.usd(o.total) : '') + (o.paidAt ? (o.total !== null ? ' · ' : '') + SF.shortDate(o.paidAt) : '');
    function step(state, title, small) {
      return el('li', { cls: state }, [el('span', { cls: 'd' }), el('span', { cls: 'tn' }, [el('b', { text: title }), small])]);
    }
    function todo(title) { return el('li', null, [el('span', { cls: 'd' }), el('span', { cls: 'todo', text: title })]); }
    var list = el('ol', { cls: 'track' });
    if (o.status === 'pending') {
      list.appendChild(step('now', 'We\'re confirming your payment', el('small', { text: 'This usually takes a few seconds.' })));
      list.appendChild(todo('Our merch team packs it'));
      list.appendChild(todo('On its way'));
    } else if (o.status === 'shipped') {
      list.appendChild(step('done', 'Paid', paidLine ? el('small', { text: paidLine }) : null));
      list.appendChild(step('done', 'Our merch team packed it'));
      var t = o.tracking;
      var bits = [];
      if (o.shippedAt) bits.push(el('span', { text: 'Shipped ' + SF.shortDate(o.shippedAt) + '. ' }));
      if (t) {
        bits.push(el('span', { cls: 'mono', text: (t.carrier ? t.carrier + ' ' : '') + t.number }));
        if (t.url) { bits.push(' · '); bits.push(el('a', { href: t.url, target: '_blank', rel: 'noopener noreferrer', text: 'Track your package' })); }
      }
      list.appendChild(step('now', 'On its way', bits.length ? el('small', null, bits) : null));
    } else if (o.status === 'refunded') {
      list.appendChild(step('done', 'Paid', paidLine ? el('small', { text: paidLine }) : null));
      list.appendChild(step('done refund', 'Refunded', el('small', { text: SF.usd(o.refunded || o.total || 0) + ' is going back to your card. It can take a few days to show up.' })));
    } else {
      list.appendChild(step('done', 'Paid', paidLine ? el('small', { text: paidLine }) : null));
      list.appendChild(step('now', 'Our merch team packs it', el('small', { text: 'We\'ll email you a tracking number when it ships.' })));
      list.appendChild(todo('On its way'));
    }
    return list;
  }

  // opts.finalSale: put the FINAL SALE tag by the name of a line that was bought as final sale (the order page does; the thank-you page doesn't).
  function summary(o, opts) {
    var box = el('div', { cls: 'osum' });
    o.items.forEach(function (i) {
      var name = el('b', { text: i.name });
      if (opts && opts.finalSale && i.finalSale) { name.appendChild(document.createTextNode(' ')); name.appendChild(el('span', { cls: 'fs', text: 'Final sale' })); }
      box.appendChild(el('div', { cls: 'it' }, [
        SF.photo(i.photo, i.name),
        el('div', null, [name, el('small', { text: (i.label ? i.label + ' · ' : '') + 'Qty ' + i.qty })]),
        el('span', { cls: 'mono', text: SF.usd(i.unit * i.qty) })
      ]));
    });
    var where = countryName(o.country);
    box.appendChild(el('div', { cls: 'ln' }, [el('span', { text: 'Shipping' + (where ? ' · ' + where : '') }), el('span', { text: SF.usd(o.shipping) })]));
    if (o.tax !== null && o.tax > 0) box.appendChild(el('div', { cls: 'ln' }, [el('span', { text: 'Tax' }), el('span', { text: SF.usd(o.tax) })]));
    if (o.refunded > 0) box.appendChild(el('div', { cls: 'ln' }, [el('span', { text: 'Refunded' }), el('span', { text: '−' + SF.usd(o.refunded) })]));
    if (o.total !== null) box.appendChild(el('div', { cls: 'ln tot' }, [el('span', { text: 'Total · US dollars' }), el('span', { text: SF.usd(o.total) })]));
    // City and state only. Never the street.
    if (o.city || o.region) {
      box.appendChild(el('div', { cls: 'to' }, [
        el('div', { cls: 'lbl', text: 'Ships to' }),
        (o.city + (o.city && o.region ? ', ' : '') + o.region) + (where ? ' · ' + where : '')
      ]));
    }
    return box;
  }

  window.SFOrder = { norm: norm, normReturn: normReturn, track: track, summary: summary, isPaid: isPaid, countryName: countryName };
})();
