/* ShowFuse website: the demo deck's motion. Every [data-deck="live"] swipes its top card right on its own every few seconds
   (the next card is underneath, so the screenshot's own card never shows), and a visitor can drag a card left or right too.
   Still decks ([data-deck="still"]) never move. Reduced motion: no auto-swipe, dragging still works. The page works without this file. */
(function () {
  var decks = document.querySelectorAll('[data-deck="live"]');
  if (!decks.length) return;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  Array.prototype.forEach.call(decks, function (deck) {
    var order = Array.prototype.slice.call(deck.querySelectorAll('.dcard'));
    if (order.length < 2) return;
    deck.classList.add('is-live');
    var busy = false, inView = true, idleUntil = 0, drag = null;

    function stack() { for (var i = 0; i < order.length; i++) order[i].style.zIndex = String(order.length - i); }
    stack();

    // Off it goes; once it's off screen it slides back in place UNDER the others (hidden by the new top card).
    function fling(card, dir) {
      busy = true;
      card.classList.remove('is-settling');
      card.classList.add('is-flying');
      card.style.transform = 'translateX(' + (dir * 135) + '%) rotate(' + (dir * 18) + 'deg)';
      setTimeout(function () {
        card.classList.remove('is-flying');
        order.push(order.shift());
        stack();
        card.style.transform = '';
        void card.offsetWidth;
        busy = false;
      }, 620);
    }

    if (!reduce) {
      setInterval(function () {
        if (busy || drag || !inView || document.hidden || Date.now() < idleUntil) return;
        fling(order[0], 1);
      }, 3400);
    }
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) { inView = es[0].isIntersecting; }, { threshold: 0.35 }).observe(deck);
    }

    deck.addEventListener('pointerdown', function (e) {
      if (busy || (e.pointerType === 'mouse' && e.button !== 0)) return;
      var card = order[0];
      drag = { card: card, x0: e.clientX, y0: e.clientY, dx: 0, id: e.pointerId, w: deck.getBoundingClientRect().width, moved: false };
      card.classList.remove('is-settling');
      try { deck.setPointerCapture(e.pointerId); } catch (err) { /* fine */ }
    });
    deck.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      drag.dx = e.clientX - drag.x0;
      if (!drag.moved && Math.abs(drag.dx) > 6) { drag.moved = true; deck.classList.add('is-dragging'); }
      if (drag.moved) drag.card.style.transform = 'translateX(' + drag.dx + 'px) rotate(' + (drag.dx / drag.w * 14) + 'deg)';
    });
    function end(e) {
      if (!drag || (e && e.pointerId !== drag.id)) return;
      var d = drag; drag = null;
      deck.classList.remove('is-dragging');
      idleUntil = Date.now() + 6000;            // a visitor is playing with it: the auto-swipe waits
      if (d.moved && Math.abs(d.dx) > d.w * 0.22) { fling(d.card, d.dx > 0 ? 1 : -1); return; }
      d.card.classList.add('is-settling');
      d.card.style.transform = '';
    }
    deck.addEventListener('pointerup', end);
    deck.addEventListener('pointercancel', end);
    deck.addEventListener('lostpointercapture', end);
  });
})();
