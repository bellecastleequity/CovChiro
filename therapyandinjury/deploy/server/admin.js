'use strict';
/**
 * /_admin: password-protected content editor + updater (page: admin.html).
 *
 * Content: edits the site facts, locations (hours, phones, emails, doctors…), and videos. Saved to
 * <app root>/content.json (with the last 15 versions in content-backups/); pages show changes on the
 * next request. Updates: upload a release, install from the update source, roll back, restart.
 *
 * Password: ADMIN_PASSWORD environment variable (cPanel → Setup Node.js App → Environment variables)
 * or "adminPassword" in config.json. At least 12 characters; with no password set, /_admin is off (404).
 * Sign in with any username and that password (browser login prompt, HTTP Basic over HTTPS).
 *
 * Changes need the custom header X-Admin-Action, which other sites can't send (CSRF protection).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PAGE = fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8');
const KEEP_BACKUPS = 15;
const WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Checks an edited { site, branches } document; returns a list of problems (empty = OK). */
function validateContent(doc) {
  const errs = [];
  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  if (!isObj(doc) || !isObj(doc.site) || !Array.isArray(doc.branches)) return ['Expected { site: {…}, branches: […] }'];
  const walk = (v, where) => {
    if (typeof v === 'string') { if (v.length > 20000) errs.push(`${where}: text is too long`); return; }
    if (v === null || typeof v === 'number' || typeof v === 'boolean') return;
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${where}[${i}]`));
    if (isObj(v)) return Object.entries(v).forEach(([k, x]) => walk(x, where ? `${where}.${k}` : k));
    errs.push(`${where}: unsupported value`);
  };
  walk(doc, '');
  const slugs = new Set();
  doc.branches.forEach((b, i) => {
    const at = `Location ${b?.city || i + 1}`;
    if (!isObj(b) || !/^[a-z0-9-]{2,40}$/.test(b.slug || '')) return errs.push(`${at}: missing or bad slug`);
    if (slugs.has(b.slug)) errs.push(`${at}: duplicate slug ${b.slug}`);
    slugs.add(b.slug);
    if (b.status && !['open', 'coming soon'].includes(b.status)) errs.push(`${at}: status must be "open" or "coming soon"`);
    if (b.hours != null) {
      if (!Array.isArray(b.hours)) errs.push(`${at}: hours must be a list`);
      else b.hours.forEach((h) => {
        if (!WEEK.includes(h?.day)) errs.push(`${at}: bad day "${h?.day}"`);
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(h?.opens || '') || !/^([01]\d|2[0-3]):[0-5]\d$/.test(h?.closes || '')) errs.push(`${at}: ${h?.day} needs opening and closing times`);
        else if (h.opens >= h.closes) errs.push(`${at}: ${h.day} closes before it opens`);
      });
    }
    if (b.address != null && (!isObj(b.address) || ['street', 'city', 'state', 'zip'].some((k) => typeof b.address[k] !== 'string'))) errs.push(`${at}: address needs street, city, state and zip`);
    if (b.geo && ['lat', 'lng'].some((k) => b.geo[k] != null && typeof b.geo[k] !== 'number')) errs.push(`${at}: map coordinates must be numbers`);
    if (b.mapZoom != null && !(Number.isInteger(b.mapZoom) && b.mapZoom >= 3 && b.mapZoom <= 21)) errs.push(`${at}: map zoom must be a whole number from 3 to 21`);
    for (const k of ['domains', 'nearbyAreas', 'doctors']) if (b[k] != null && !Array.isArray(b[k])) errs.push(`${at}: ${k} must be a list`);
    if (b.email && !/^\[/.test(b.email) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email)) errs.push(`${at}: email "${b.email}" doesn't look like an email address`);
  });
  if (JSON.stringify(doc).length > 1024 * 1024) errs.push('Content is larger than 1 MB');
  return errs;
}

function backups(root) {
  const dir = path.join(root, 'content-backups');
  try { return fs.readdirSync(dir).filter((f) => /^content-[\dTZ-]+\.json$/.test(f)).sort().reverse(); } catch { return []; }
}

function saveContent(ctx, doc) {
  const file = ctx.contentFile;
  const dir = path.join(ctx.root, 'content-backups');
  fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(file)) fs.copyFileSync(file, path.join(dir, `content-${new Date().toISOString().replace(/[:.]/g, '-')}.json`));
  for (const old of backups(ctx.root).slice(KEEP_BACKUPS)) fs.rmSync(path.join(dir, old), { force: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ...doc, updatedAt: new Date().toISOString() }, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

const MAX_UPLOAD = 150 * 1024 * 1024;
const fails = new Map(); // ip → [timestamps]
const LOCK = { windowMs: 15 * 60 * 1000, max: 10 };

const ipOf = (req) => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();

function passwordOf(ctx) {
  const p = process.env.ADMIN_PASSWORD || ctx.getConfig().adminPassword || '';
  return p.length >= 12 ? p : null;
}

function authorized(req, password) {
  const m = /^Basic\s+(.+)$/i.exec(String(req.headers.authorization || ''));
  if (!m) return false;
  const decoded = Buffer.from(m[1], 'base64').toString('utf8');
  const given = decoded.slice(decoded.indexOf(':') + 1);
  return crypto.timingSafeEqual(digest(given), digest(password));
}

function readRaw(req, max) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > max) {
        req.removeAllListeners('data');
        req.resume();
        reject(Object.assign(new Error(`Upload is larger than ${max / 1048576} MB`), { status: 413 }));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function handle(req, res, url, ctx, send) {
  const base = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow', 'x-frame-options': 'DENY' };
  const json = (status, body) => send(res, status, { ...base, 'content-type': 'application/json' }, JSON.stringify(body));
  const password = passwordOf(ctx);
  if (!password) return send(res, 404, { ...base, 'content-type': 'text/plain' }, 'Not found\n');

  const ip = ipOf(req);
  const now = Date.now();
  const recent = (fails.get(ip) || []).filter((t) => now - t < LOCK.windowMs);
  if (recent.length >= LOCK.max) return send(res, 429, { ...base, 'content-type': 'text/plain', 'retry-after': '900' }, 'Too many sign-in attempts. Try again in 15 minutes.\n');
  if (!authorized(req, password)) {
    if (req.headers.authorization) { recent.push(now); fails.set(ip, recent); }
    return send(res, 401, { ...base, 'www-authenticate': 'Basic realm="Therapy & Injury site admin", charset="UTF-8"', 'content-type': 'text/plain' }, 'Sign in required\n');
  }
  fails.delete(ip);

  const updater = require(path.join(ctx.root, 'updater.js'));
  const route = url.pathname.replace(/\/+$/, '') || '/_admin';

  if (req.method === 'GET' && route === '/_admin') return send(res, 200, { ...base, 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data: https://i.ytimg.com; frame-ancestors 'none'" }, PAGE);
  if (req.method === 'GET' && route === '/_admin/api/content') {
    const l = ctx.live();
    if (!l) return json(503, { ok: false, error: 'The page renderer is not running, so content can’t be edited right now. Check the log.' });
    const saved = fs.existsSync(ctx.contentFile) ? fs.statSync(ctx.contentFile).mtime.toISOString() : null;
    return json(200, { ok: true, site: l.site, branches: l.branches, savedAt: saved, backups: backups(ctx.root) });
  }
  if (req.method === 'GET' && route === '/_admin/api/status') {
    const st = updater.status();
    const mail = ctx.getConfig().mail || {};
    return json(200, {
      ...st,
      running: ctx.version,
      degraded: ctx.degraded,
      node: process.version,
      uptimeSec: Math.round(process.uptime()),
      pages: ctx.renderStatus(),
      mailRecipients: Object.keys(mail.recipients || {}),
      updateSource: ctx.getConfig().update?.manifestUrl ? 'manifest URL' : ctx.getConfig().update?.github?.repo ? `GitHub ${ctx.getConfig().update.github.repo}` : null,
    });
  }

  // Everything below changes the site: require the custom header (CSRF) and a write method.
  if (!['POST', 'PUT'].includes(req.method) || req.headers['x-admin-action'] !== '1') return json(400, { ok: false, error: 'Bad request' });
  try {
    if (route === '/_admin/api/upload') {
      const buf = await readRaw(req, MAX_UPLOAD);
      const r = updater.installBuffer(buf, { source: 'admin upload', force: url.searchParams.get('force') === '1' });
      return json(200, { ok: true, ...r, note: 'Installed. The site switches over on the next request.' });
    }
    if (route === '/_admin/api/content' && req.method === 'PUT') {
      const doc = JSON.parse((await readRaw(req, 2 * 1024 * 1024)).toString('utf8') || '{}');
      const problems = validateContent(doc);
      if (problems.length) return json(422, { ok: false, error: problems.slice(0, 8).join(' · ') });
      saveContent(ctx, { site: doc.site, branches: doc.branches });
      ctx.live();
      return json(200, { ok: true, note: 'Saved. The site shows the changes now.' });
    }
    if (route === '/_admin/api/content/restore') {
      const body = JSON.parse((await readRaw(req, 4096)).toString('utf8') || '{}');
      const name = String(body.name || '');
      if (!backups(ctx.root).includes(name)) return json(404, { ok: false, error: 'No such saved version' });
      const doc = JSON.parse(fs.readFileSync(path.join(ctx.root, 'content-backups', name), 'utf8'));
      saveContent(ctx, { site: doc.site, branches: doc.branches });
      ctx.live();
      return json(200, { ok: true, note: `Restored the version saved ${name.slice(8, 18)}.` });
    }
    const body = JSON.parse((await readRaw(req, 4096)).toString('utf8') || '{}');
    if (route === '/_admin/api/activate') return json(200, { ok: true, ...updater.activate(String(body.version || '')) });
    if (route === '/_admin/api/rollback') return json(200, { ok: true, ...updater.rollback() });
    if (route === '/_admin/api/check') return json(200, { ok: true, ...(await updater.check()) });
    if (route === '/_admin/api/update') return json(200, { ok: true, ...(await updater.update()) });
    if (route === '/_admin/api/restart') { updater.touchRestart(); return json(200, { ok: true }); }
    return json(404, { ok: false, error: 'Unknown action' });
  } catch (e) {
    console.error('[admin]', e.message);
    return json(e.status || 400, { ok: false, error: e.message });
  }
}



module.exports = { handle };
