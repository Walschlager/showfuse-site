/* ShowFuse website: the splash (the ticket eats "showfuse" and spits it back out). Runs only when the page's head script chose to
   show it (html.splash). Dark video on a dark screen, the light one on a light screen. It ends on its own after 7 seconds; a tap,
   a click, a key or Skip ends it sooner. If the video can't play (a phone's low-power mode, a slow network), the page shows
   after a moment anyway, and nothing waits more than 9 seconds. */
(function () {
  var root = document.documentElement;
  if (!root.classList.contains('splash')) return;
  var box = document.getElementById('splash'), video = document.getElementById('splashVideo');
  if (!box || !video) { root.classList.remove('splash'); return; }
  var light = !!(window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches);
  var over = false;
  function finish() {
    if (over) return;
    over = true;
    try { sessionStorage.setItem('sf-splash', '1'); } catch (e) { /* fine */ }
    box.classList.add('is-leaving');
    setTimeout(function () { root.classList.remove('splash'); if (box.parentNode) box.parentNode.removeChild(box); }, 480);
  }
  video.src = light ? '/assets/splash/showfuse-splash-light.mp4' : '/assets/splash/showfuse-splash-dark.mp4';
  video.addEventListener('ended', finish);
  video.addEventListener('error', function () { setTimeout(finish, 600); });
  box.addEventListener('click', finish);
  document.addEventListener('keydown', function () { finish(); }, { once: true });
  var started = video.play();
  if (started && started.catch) started.catch(function () { setTimeout(finish, 1200); });
  setTimeout(finish, 9000);
})();
