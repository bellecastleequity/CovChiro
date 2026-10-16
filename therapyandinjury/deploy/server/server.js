'use strict';
/**
 * therapyandinjury.com web server (Node 18+ built-ins only). Started by the app root's app.js.
 *
 * Does what the Apache .htaccess did for the static build, plus the form and the updater:
 *   - city domains (branches.json "domains") 301 to their location page
 *   - www / other hosts 301 to the bare domain; http → https when the proxy says the request was http
 *   - serves the Astro build from ../site with clean URLs (/about → /about/), the 404 page, caching
 *     (fingerprinted /_astro/ files are immutable), ETags, and gzip/brotli for text
 *   - security headers on every response
 *   - POST /api/appointment (and the old /api/appointment.php URL): appointment requests by email
 *   - /_admin: password-protected updater page (upload a release, update, roll back)
 *   - GET /_health: version check for monitoring
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const zlib = require('zlib');

const appointment = require('./appointment.js');
const admin = require('./admin.js');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.woff': 'font/woff', '.ttf': 'font/ttf', '.webmanifest': 'application/manifest+json', '.map': 'application/json',
  '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg',
};
const COMPRESSIBLE = /^(text\/|application\/(json|xml|manifest\+json)|image\/svg\+xml)/;

const SECURITY_HEADERS = {
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'SAMEORIGIN',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function cacheControl(urlPath, ext) {
  if (urlPath.startsWith('/_astro/')) return 'public, max-age=31536000, immutable';
  if (/^\.(svg|png|jpe?g|webp|avif|gif|ico|woff2?|ttf|mp4|webm|mp3|pdf)$/.test(ext)) return 'public, max-age=86400';
  return 'public, max-age=600';
}

function start({ root, releaseDir, version, degraded = null }) {
  const siteDir = path.join(releaseDir, 'site');
  const site = readJson(path.join(releaseDir, 'server', 'site.json'), {});
  const canonical = new URL(site.domain || 'https://therapyandinjury.com');
  const cityDomains = new Map(Object.entries(site.cityDomains || {}));
  const configFile = path.join(root, 'config.json');
  let config = {}, configMtime = 0;
  const getConfig = () => {
    // Re-read config.json when it changes, so editing it needs no restart.
    try {
      const m = fs.statSync(configFile).mtimeMs;
      if (m !== configMtime) { config = readJson(configFile, {}); configMtime = m; }
    } catch { config = {}; }
    return config;
  };
  const ctx = { root, releaseDir, version, degraded, site, getConfig };
  const compressed = new Map(); // `${file}:${mtime}:${enc}` → Buffer
  const notFoundPage = path.join(siteDir, '404.html');

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
    let body = fs.readFileSync(file);
    const accept = String(req.headers['accept-encoding'] || '');
    if (COMPRESSIBLE.test(type) && body.length > 1024) {
      const enc = /\bbr\b/.test(accept) ? 'br' : /\bgzip\b/.test(accept) ? 'gzip' : null;
      if (enc) {
        const key = `${file}:${stat.mtimeMs}:${enc}`;
        let z = compressed.get(key);
        if (!z) {
          z = enc === 'br'
            ? zlib.brotliCompressSync(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } })
            : zlib.gzipSync(body, { level: 9 });
          compressed.set(key, z);
        }
        body = z;
        headers['content-encoding'] = enc;
      }
    }
    headers['content-length'] = body.length;
    send(res, status, headers, req.method === 'HEAD' ? undefined : body);
  }

  function notFound(req, res) {
    try { return serveFile(req, res, notFoundPage, fs.statSync(notFoundPage), '/404.html', 404); }
    catch { return send(res, 404, { 'content-type': 'text/plain; charset=utf-8' }, 'Not found\n'); }
  }

  function serveStatic(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { allow: 'GET, HEAD', 'content-type': 'text/plain' }, 'Method not allowed\n');
    let urlPath;
    try { urlPath = decodeURIComponent(url.pathname); } catch { return notFound(req, res); }
    // No dotfiles (.htaccess etc.), no traversal, no NUL bytes.
    if (urlPath.includes('\0') || urlPath.split('/').some((p) => p.startsWith('.'))) return notFound(req, res);
    let file = path.join(siteDir, path.normalize(urlPath));
    if (!file.startsWith(siteDir)) return notFound(req, res);
    let stat;
    try { stat = fs.statSync(file); } catch { return notFound(req, res); }
    if (stat.isDirectory()) {
      if (!urlPath.endsWith('/')) return redirect(res, `${url.pathname}/${url.search}`);
      file = path.join(file, 'index.html');
      try { stat = fs.statSync(file); } catch { return notFound(req, res); }
    }
    return serveFile(req, res, file, stat, urlPath);
  }

  const server = http.createServer(async (req, res) => {
    try {
      const host = String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
      const url = new URL(req.url || '/', `http://${host || 'localhost'}`);
      const cfg = getConfig();
      const local = !host || host === 'localhost' || /^127\.|^\[?::1\]?$/.test(host);

      if (url.pathname === '/_health') {
        return send(res, 200, { 'content-type': 'application/json', 'cache-control': 'no-store' }, JSON.stringify({ ok: true, version, degraded }));
      }
      // City domains → their location page (e.g. ocalatherapyandinjury.com → /ocala/).
      const bare = host.replace(/^www\./, '');
      if (cityDomains.has(bare)) return redirect(res, `${canonical.origin}/${cityDomains.get(bare)}/`);
      // Bare domain only, and https.
      if (!local && cfg.redirects?.canonicalHost !== false && host !== canonical.host) return redirect(res, `${canonical.origin}${url.pathname}${url.search}`);
      const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
      if (!local && cfg.redirects?.forceHttps !== false && proto === 'http') return redirect(res, `${canonical.origin}${url.pathname}${url.search}`);

      if (url.pathname === '/api/appointment' || url.pathname === '/api/appointment.php') return await appointment.handle(req, res, ctx, send);
      if (url.pathname === '/_admin' || url.pathname.startsWith('/_admin/')) return await admin.handle(req, res, url, ctx, send);
      return serveStatic(req, res, url);
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
