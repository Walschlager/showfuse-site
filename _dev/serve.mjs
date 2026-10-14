/* ShowFuse website: the local dev server. Plain Node (18 or newer), no packages.

     node _dev/serve.mjs          the site on http://localhost:8792 (the port the local API's CLAIM_SITE_URL expects)
     node _dev/serve.mjs 8080     the site on another port

   It serves this folder the way GitHub Pages does (/support finds support.html, /shop/ finds shop/index.html, a missing page shows
   404.html) and listens on this machine only. It is read-only: nothing it sends is stored.

   WHY IT EXISTS. The pages that talk to the API carry a content-security tag, and that tag allows ONLY the real API
   (https://showfuse-api-production.up.railway.app), because that is all visitors on showfuseapp.com may reach. Testing on your own machine
   needs more: the local API (http://localhost:3000) and, with ?api=practice, the practice server. So, for requests to localhost or
   127.0.0.1 only, this server adds those two addresses to connect-src and img-src of that tag in the copy it SENDS. The files on disk never
   change, and a page opened under any other name (for example a pretend showfuseapp.com) gets exactly what is published.
   (Why not in the page itself? A second tag can only tighten a policy, never loosen it, and a tag made by a script would let the page run
   with no policy at all if that script failed to load.)

   Without this server (python3 -m http.server, a file:// page) a page's own tag blocks the local API; ?fake=1 still works because it
   makes no calls. The pages' own code decides where each call goes (shop/base.js, claim/common.js, and the home and support forms); this
   server only keeps the browser from blocking what that code already chose. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_PORT = 8792;
export const REAL_API = 'https://showfuse-api-production.up.railway.app';
export const LOCAL_API = 'http://localhost:3000';
export const PRACTICE_API = 'https://showfuse-app-dev-staging.up.railway.app';

// Localhost, by the same rule every page uses (location.hostname is exactly "localhost" or "127.0.0.1"). Takes a Host header.
export function isLocalHost(hostHeader) {
  const host = String(hostHeader || '').toLowerCase().replace(/:\d+$/, '');
  return host === 'localhost' || host === '127.0.0.1';
}

// Wherever a page's content-security tag allows the real API (connect-src, img-src), also allow the local API and the practice server.
// Everything else in the page, and in the tag, is left exactly as it is. Safe to apply twice.
const POLICY_TAG = /(<meta\s+http-equiv="Content-Security-Policy"\s+content=")([^"]*)(")/gi;
function widen(directive) {
  const m = /^(\s*)(connect-src|img-src)((?:\s+\S+)+)(\s*)$/i.exec(directive);
  if (!m) return directive;
  if (!m[3].trim().split(/\s+/).includes(REAL_API)) return directive;
  const have = m[3].trim().split(/\s+/);
  const extra = [LOCAL_API, PRACTICE_API].filter((origin) => !have.includes(origin));
  return m[1] + m[2] + m[3] + (extra.length ? ' ' + extra.join(' ') : '') + m[4];
}
export function devPolicy(html) {
  return html.replace(POLICY_TAG, (all, head, policy, tail) => head + policy.split(';').map(widen).join(';') + tail);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff'
};

export function createServer(root) {
  const base = path.resolve(root);

  function fileAt(file) {
    try { return fs.statSync(file).isFile() ? file : null; } catch { return null; }
  }
  function dirAt(file) {
    try { return fs.statSync(file).isDirectory(); } catch { return false; }
  }
  function send(req, res, status, type, body, extra) {
    res.writeHead(status, Object.assign({ 'Content-Type': type, 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }, extra));
    res.end(req.method === 'HEAD' ? undefined : body);
    console.log(req.method + ' ' + req.url + ' ' + status);
  }
  function page(req, res, status, file) {
    let body = fs.readFileSync(file);
    const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    if (type.startsWith('text/html') && isLocalHost(req.headers.host)) body = Buffer.from(devPolicy(body.toString('utf8')));
    send(req, res, status, type, body);
  }

  function handle(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(req, res, 405, 'text/plain; charset=utf-8', 'Method not allowed', { Allow: 'GET, HEAD' });
    const target = String(req.url || '').split('#')[0];
    const q = target.indexOf('?');
    const search = q < 0 ? '' : target.slice(q);
    let pathname;
    try { pathname = decodeURIComponent(q < 0 ? target : target.slice(0, q)); } catch { return send(req, res, 400, 'text/plain; charset=utf-8', 'Bad address'); }
    if (pathname[0] !== '/' || pathname.includes('\0')) return send(req, res, 400, 'text/plain; charset=utf-8', 'Bad address');
    const parts = pathname.split('/').filter(Boolean);
    // Like GitHub Pages: never a dot-file (.git), never an underscore folder (this one), never a way out of the folder.
    const hidden = parts.some((part) => part === '..' || part === '.' || part[0] === '.' || part[0] === '_');
    let file = hidden ? null : path.join(base, ...parts);
    if (file && file !== base && !file.startsWith(base + path.sep)) file = null;

    if (file) {
      const wantsDir = pathname.endsWith('/');
      const exact = !wantsDir && fileAt(file);
      if (exact) return page(req, res, 200, exact);
      if (wantsDir || file === base) {
        const index = fileAt(path.join(file, 'index.html'));
        if (index) return page(req, res, 200, index);
      } else if (dirAt(file)) {
        // a folder asked for without its closing slash: send the browser to the slash (what GitHub Pages does), keeping ?query
        const where = '/' + parts.map(encodeURIComponent).join('/') + '/' + search.replace(/[^\x21-\x7e]/g, encodeURIComponent);
        res.writeHead(301, { Location: where });
        res.end();
        console.log(req.method + ' ' + req.url + ' 301');
        return;
      } else {
        const html = fileAt(file + '.html');
        if (html) return page(req, res, 200, html);
      }
    }
    const notFound = fileAt(path.join(base, '404.html'));
    if (notFound) return page(req, res, 404, notFound);
    return send(req, res, 404, 'text/plain; charset=utf-8', 'Not found');
  }

  return http.createServer((req, res) => {
    try {
      handle(req, res);
    } catch (err) {
      // a dev server must not fall over on an odd request
      try { send(req, res, 500, 'text/plain; charset=utf-8', 'The dev server hit a problem: ' + err.message); } catch { res.destroy(); }
    }
  });
}

// Run directly (node _dev/serve.mjs [port]); importing this file (the tests do) starts nothing.
let isMain = false;
try { isMain = !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { /* not run directly */ }
if (isMain) {
  const arg = process.argv[2];
  const port = arg === undefined ? DEFAULT_PORT : Number(arg);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('Usage: node _dev/serve.mjs [port]   (default ' + DEFAULT_PORT + ')');
    process.exit(2);
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const server = createServer(root);
  server.on('error', (err) => {
    console.error(err.code === 'EADDRINUSE' ? 'Port ' + port + ' is already in use. Stop whatever is using it, or pick another: node _dev/serve.mjs 8080' : String(err));
    process.exit(1);
  });
  server.listen(port, '127.0.0.1', () => {
    console.log('ShowFuse site (dev): http://localhost:' + port + '   serving ' + root);
    console.log('Pages opened on localhost may also reach the local API (' + LOCAL_API + ') and, with ?api=practice, the practice server.');
    console.log('Any other hostname gets the pages exactly as published. Ctrl-C to stop.');
  });
}
