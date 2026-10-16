'use strict';
/**
 * therapyandinjury.com web server (Node 18+ built-ins only; no node_modules). Started by the app root's app.js.
 *
 * Release layout (releases/<version>/):
 *   site/          static files from the Astro build (CSS/JS, images, media, OG images)
 *   site-server/   the Astro server build; renders every page per request from the live content
 *   site-static/   a snapshot of every page at build time, served only if site-server fails to load
 *   server/        this server, the form handler, the admin page
 *
 * Content edited at /_admin is saved to <app root>/content.json (never touched by updates); pages pick
 * it up on the next request. The server also:
 *   - 301s city domains to their location page, www/other hosts to the bare domain, http → https
 *   - serves static files with caching, ETags, gzip/brotli, and byte ranges (video on iPhone/Safari)
 *   - adds security headers to every response; compresses and ETags rendered pages
 *   - POST /api/appointment (and the old .php URL): appointment requests by email
 *   - /_admin: password-protected updater + content editor; GET /_health: version check
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

const appointment = require('./appointment.js');
const admin = require('./admin.js');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.woff': 'font/woff', '.ttf': 'font/ttf', '.webmanifest': 'application/manifest+json', '.map': 'application/json',
  '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.vtt': 'text/vtt; charset=utf-8',
};
const COMPRESSIBLE = /^(text\/|application\/(json|xml|rss\+xml|manifest\+json)|image\/svg\+xml)/;
const STREAM_OVER = 2 * 1024 * 1024; // larger files (video) are streamed, not read into memory

const SECURITY_HEADERS = {
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'SAMEORIGIN',
  // Location is allowed for this site only ("Use my location"); embeds like the map can't ask for it.
  'permissions-policy': 'camera=(), microphone=(), geolocation=(self)',
};

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function cacheControl(urlPath, ext) {
  if (urlPath.startsWith('/_astro/')) return 'public, max-age=31536000, immutable';
  if (/^\.(svg|png|jpe?g|webp|avif|gif|ico|woff2?|ttf|mp4|webm|mp3|pdf)$/.test(ext)) return 'public, max-age=86400';
  return 'public, max-age=600';
}

function pickEncoding(req) {
  const accept = String(req.headers['accept-encoding'] || '');
  return /\bbr\b/.test(accept) ? 'br' : /\bgzip\b/.test(accept) ? 'gzip' : null;
}
const compress = (body, enc) => (enc === 'br'
  ? zlib.brotliCompressSync(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } })
  : zlib.gzipSync(body, { level: 6 }));

function start({ root, releaseDir, version, degraded = null }) {
  const siteDir = path.join(releaseDir, 'site');
  const staticDir = path.join(releaseDir, 'site-static');
  const siteInfo = readJson(path.join(releaseDir, 'server', 'site.json'), {});
  const canonical = new URL(siteInfo.domain || 'https://therapyandinjury.com');
  const configFile = path.join(root, 'config.json');
  const contentFile = path.join(root, 'content.json');
  process.env.TI_CONTENT_FILE = contentFile; // read by the Astro build's content store

  let config = {}, configMtime = 0;
  const getConfig = () => {
    // Re-read config.json when it changes, so editing it needs no restart.
    try {
      const m = fs.statSync(configFile).mtimeMs;
      if (m !== configMtime) { config = readJson(configFile, {}); configMtime = m; }
    } catch { config = {}; }
    return config;
  };
  /** The live site data (defaults + content.json), as held by the Astro build. */
  const live = () => {
    if (!render) return null;
    const h = globalThis.__therapyandinjury;
    if (h) { h.refresh(); return h; }
    return null;
  };
  const cityDomains = () => {
    const map = new Map(Object.entries(siteInfo.cityDomains || {}));
    const l = live();
    if (l) for (const b of l.branches) for (const d of b.domains || []) map.set(String(d).toLowerCase().replace(/^www\./, ''), b.slug);
    return map;
  };

  // The page renderer (Astro, ESM). If it can't load, pages come from the build-time snapshot instead.
  let render = null, renderError = null;
  const renderReady = import(pathToFileURL(path.join(releaseDir, 'site-server', 'entry.mjs')).href)
    .then(async (m) => {
      render = m.handler;
      // Load the content store now (Astro loads middleware lazily on the first page view), so the
      // editor and the form can read the live data straight after a restart.
      await import(pathToFileURL(path.join(releaseDir, 'site-server', 'virtual_astro_middleware.mjs')).href).catch(() => {});
      globalThis.__therapyandinjury?.refresh();
    })
    .catch((e) => { renderError = e; console.error('[server] page renderer failed to load; serving the snapshot:', e.stack || e.message); });

  const ctx = { root, releaseDir, version, degraded, siteInfo, getConfig, live, contentFile, renderStatus: () => (render ? 'live' : renderError ? `snapshot (renderer failed: ${renderError.message})` : 'starting') };
  const compressed = new Map(); // `${file}:${mtime}:${enc}` → Buffer

  function send(res, status, headers, body) {
    res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
    res.end(body);
  }

  function redirect(res, location, status = 301) {
    send(res, status, { location, 'cache-control': status === 301 ? 'public, max-age=3600' : 'no-store', 'content-type': 'text/plain; charset=utf-8' }, `Moved to ${location}\n`);
  }

  function serveFile(req, res, file, stat, urlPath, status = 200) {
    const ext = path.extname(file).toLowerCase();
    const type = TYPES[ext] || 'application/octet-stream';
    const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
    const headers = {
      'content-type': type,
      'cache-control': status === 200 ? cacheControl(urlPath, ext) : 'no-store',
      etag,
      'last-modified': stat.mtime.toUTCString(),
      vary: 'Accept-Encoding',
    };
    if (status === 200 && req.headers['if-none-match'] === etag) return send(res, 304, headers);

    // Big files (video): stream, with byte ranges, which iPhone/Safari need to play video at all.
    if (stat.size > STREAM_OVER || req.headers.range) {
      headers['accept-ranges'] = 'bytes';
      let start = 0, end = stat.size - 1, code = status;
      const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
      if (m && status === 200) {
        if (m[1] === '' && m[2] !== '') { start = Math.max(0, stat.size - Number(m[2])); }
        else { start = Number(m[1]); if (m[2] !== '') end = Math.min(Number(m[2]), stat.size - 1); }
        if (start > end || start >= stat.size) {
          return send(res, 416, { ...headers, 'content-range': `bytes */${stat.size}` });
        }
        code = 206;
        headers['content-range'] = `bytes ${start}-${end}/${stat.size}`;
      }
      headers['content-length'] = end - start + 1;
      res.writeHead(code, { ...SECURITY_HEADERS, ...headers });
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res);
    }

    let body = fs.readFileSync(file);
    const enc = COMPRESSIBLE.test(type) && body.length > 1024 ? pickEncoding(req) : null;
    if (enc) {
      const key = `${file}:${stat.mtimeMs}:${enc}`;
      let z = compressed.get(key);
      if (!z) { z = compress(body, enc); compressed.set(key, z); }
      body = z;
      headers['content-encoding'] = enc;
    }
    headers['content-length'] = body.length;
    send(res, status, headers, req.method === 'HEAD' ? undefined : body);
  }

  /** A static asset (never HTML: pages always come from the renderer). Returns false if there is none. */
  function serveAsset(req, res, url) {
    let urlPath;
    try { urlPath = decodeURIComponent(url.pathname); } catch { return false; }
    if (urlPath.endsWith('/') || urlPath.endsWith('.html')) return false;
    // No dotfiles (.htaccess etc.), no traversal, no NUL bytes.
    if (urlPath.includes('\0') || urlPath.split('/').some((p) => p.startsWith('.'))) return 'blocked';
    const file = path.join(siteDir, path.normalize(urlPath));
    if (!file.startsWith(siteDir + path.sep)) return 'blocked';
    let stat;
    try { stat = fs.statSync(file); } catch { return false; }
    if (!stat.isFile()) return false;
    if (req.method !== 'GET' && req.method !== 'HEAD') { send(res, 405, { allow: 'GET, HEAD', 'content-type': 'text/plain' }, 'Method not allowed\n'); return true; }
    serveFile(req, res, file, stat, urlPath);
    return true;
  }

  /** Build-time snapshot of the pages, used only when the renderer is down. */
  function serveSnapshot(req, res, url) {
    let p = url.pathname;
    try { p = decodeURIComponent(p); } catch {}
    if (p.split('/').some((x) => x.startsWith('.')) || p.includes('\0')) p = '/404.html';
    let file = path.join(staticDir, path.normalize(p), p.endsWith('/') ? 'index.html' : '');
    if (!file.startsWith(staticDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      if (!p.endsWith('/') && fs.existsSync(path.join(staticDir, p, 'index.html'))) return redirect(res, `${url.pathname}/${url.search}`);
      file = path.join(staticDir, '404.html');
      return serveFile(req, res, file, fs.statSync(file), '/404.html', 404);
    }
    return serveFile(req, res, file, fs.statSync(file), p);
  }

  /** Runs the Astro renderer, then adds security headers, an ETag, and compression to the page. */
  function renderPage(req, res, notFound = false) {
    let force404 = notFound;
    const enc = pickEncoding(req);
    const chunks = [];
    let status = 200;
    const origWriteHead = res.writeHead.bind(res), origWrite = res.write.bind(res), origEnd = res.end.bind(res);
    const setFrom = (h) => {
      if (!h) return;
      const pairs = Array.isArray(h) ? (Array.isArray(h[0]) ? h : chunkPairs(h)) : Object.entries(h);
      for (const [k, v] of pairs) res.setHeader(k, v);
    };
    const chunkPairs = (flat) => { const out = []; for (let i = 0; i < flat.length; i += 2) out.push([flat[i], flat[i + 1]]); return out; };
    res.writeHead = (code, msg, headers) => { status = code; setFrom(typeof msg === 'string' ? headers : msg); return res; };
    res.write = (chunk, encoding, cb) => {
      if (chunk != null) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof encoding === 'string' ? encoding : 'utf8'));
      if (typeof encoding === 'function') encoding(); else if (typeof cb === 'function') cb();
      return true;
    };
    res.end = (chunk, encoding, cb) => {
      if (chunk != null && typeof chunk !== 'function') chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof encoding === 'string' ? encoding : 'utf8'));
      res.writeHead = origWriteHead; res.write = origWrite; res.end = origEnd;
      if (force404) status = 404;
      let body = Buffer.concat(chunks);
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) if (!res.hasHeader(k)) res.setHeader(k, v);
      const type = String(res.getHeader('content-type') || '');
      if (!res.hasHeader('cache-control')) res.setHeader('cache-control', status === 200 ? 'public, max-age=0, must-revalidate' : 'no-store');
      if (status === 200 && body.length && !res.hasHeader('etag')) {
        const etag = `"${crypto.createHash('sha1').update(body).digest('base64url').slice(0, 20)}"`;
        res.setHeader('etag', etag);
        if (req.headers['if-none-match'] === etag) {
          res.removeHeader('content-length');
          origWriteHead(304);
          return origEnd(typeof cb === 'function' ? cb : undefined);
        }
      }
      if (enc && COMPRESSIBLE.test(type) && body.length > 1024 && !res.hasHeader('content-encoding')) {
        body = compress(body, enc);
        res.setHeader('content-encoding', enc);
        res.setHeader('vary', 'Accept-Encoding');
      }
      res.setHeader('content-length', body.length);
      origWriteHead(status);
      return origEnd(req.method === 'HEAD' ? undefined : body, typeof cb === 'function' ? cb : typeof encoding === 'function' ? encoding : undefined);
    };
    // A route Astro doesn't know: render the site's 404 page instead (once).
    render(req, res, () => {
      if (req.url.startsWith('/404/')) { status = 404; res.setHeader('content-type', 'text/plain; charset=utf-8'); return res.end('Not found\n'); }
      req.url = '/404/';
      force404 = true;
      render(req, res, () => { status = 404; res.setHeader('content-type', 'text/plain; charset=utf-8'); res.end('Not found\n'); });
    });
  }

  const server = http.createServer(async (req, res) => {
    try {
      const host = String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
      const url = new URL(req.url || '/', `http://${host || 'localhost'}`);
      const cfg = getConfig();
      const local = !host || host === 'localhost' || /^127\.|^\[?::1\]?$/.test(host);

      if (url.pathname === '/_health') {
        return send(res, 200, { 'content-type': 'application/json', 'cache-control': 'no-store' }, JSON.stringify({ ok: true, version, degraded, pages: render ? 'live' : renderError ? 'snapshot' : 'starting' }));
      }
      await renderReady;
      // City domains → their location page (e.g. ocalatherapyandinjury.com → /ocala/).
      const bare = host.replace(/^www\./, '');
      const city = cityDomains().get(bare);
      if (city) return redirect(res, `${canonical.origin}/${city}/`);
      // Bare domain only, and https.
      if (!local && cfg.redirects?.canonicalHost !== false && host !== canonical.host) return redirect(res, `${canonical.origin}${url.pathname}${url.search}`);
      const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
      if (!local && cfg.redirects?.forceHttps !== false && proto === 'http') return redirect(res, `${canonical.origin}${url.pathname}${url.search}`);

      if (url.pathname === '/api/appointment' || url.pathname === '/api/appointment.php') return await appointment.handle(req, res, ctx, send);
      if (url.pathname === '/_admin' || url.pathname.startsWith('/_admin/')) return await admin.handle(req, res, url, ctx, send);

      const asset = serveAsset(req, res, url);
      if (asset === true) return;
      const blocked = asset === 'blocked';
      if (blocked) { req.url = '/404/'; url.pathname = '/404/'; } // dotfiles/traversal → the 404 page
      // Pages live at /path/ (trailingSlash: always): /about → /about/. Paths with a file extension are left alone.
      else if ((req.method === 'GET' || req.method === 'HEAD') && !url.pathname.endsWith('/') && !/\.[a-z0-9]+$/i.test(url.pathname)) {
        return redirect(res, `${url.pathname}/${url.search}`);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { allow: 'GET, HEAD', 'content-type': 'text/plain; charset=utf-8' }, 'Method not allowed\n');
      if (render) return renderPage(req, res, blocked);
      return serveSnapshot(req, res, url);
    } catch (e) {
      console.error('[server] request failed:', e.stack || e.message);
      if (!res.headersSent) send(res, 500, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }, 'Server error\n');
      else res.end();
    }
  });
  server.listen(process.env.PORT || 3000, () => {
    console.log(`[server] therapyandinjury.com ${version}${degraded ? ` (fallback; ${degraded} failed)` : ''} listening on ${process.env.PORT || 3000}`);
  });
  return server;
}

module.exports = { start };
