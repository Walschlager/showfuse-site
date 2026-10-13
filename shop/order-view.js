/* ShowFuse shop: how an order is drawn. Shared by /shop/thanks/ and /shop/order/.
   The server never sends a street address, a name, an email or a phone number: only the city and
   state, and only after payment. Server text always goes in with textContent. */
(function () {
  'use strict';
  var SF = window.SF;
  if (!SF) return;
  var el = SF.el;

  function str(v, max) { return typeof v === 'string' ? v.slice(0, max || 200) : ''; }
  function num(v) { return typeof v === 'number' && isFinite(v) ? Math.round(v) : 0; }
  function numOrNull(v) { return typeof v === 'number' && isFinite(v) ? Math.round(v) : null; }

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
      if (i && typeof i.name === 'string') o.items.push({ name: str(i.name, 120), label: str(i.label, 30), qty: num(i.qty), unit: num(i.unit_cents), photo: typeof i.photo === 'string' ? i.photo : null });
    });
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

  function summary(o) {
    var box = el('div', { cls: 'osum' });
    o.items.forEach(function (i) {
      box.appendChild(el('div', { cls: 'it' }, [
        SF.photo(i.photo, i.name),
        el('div', null, [el('b', { text: i.name }), el('small', { text: (i.label ? i.label + ' · ' : '') + 'Qty ' + i.qty })]),
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

  window.SFOrder = { norm: norm, track: track, summary: summary, isPaid: isPaid, countryName: countryName };
})();
