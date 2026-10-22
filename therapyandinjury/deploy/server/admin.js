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
 *
 * Roles: the owner signs in with ADMIN_PASSWORD (any username) and can do everything. Front-desk
 * logins (made by the owner under Team) sign in with their own username and password and only see
 * the Leads tab.
 *
 * Outreach (owner): referral-partner contacts and SendGrid email campaigns (outreach.js).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PAGE = fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8');
const leads = require('./leads.js');
const outreach = require('./outreach.js');
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

/** Who is signing in: { role: 'owner' | 'desk', user } or null. */
function authorized(req, password, root) {
  const m = /^Basic\s+(.+)$/i.exec(String(req.headers.authorization || ''));
  if (!m) return null;
  const decoded = Buffer.from(m[1], 'base64').toString('utf8');
  const user = decoded.slice(0, Math.max(0, decoded.indexOf(':'))).trim();
  const given = decoded.slice(decoded.indexOf(':') + 1);
  const desk = user ? leads.checkUser(root, user, given) : null;
  if (desk) return { role: 'desk', user: desk.username, name: desk.name };
  if (crypto.timingSafeEqual(digest(given), digest(password))) return { role: 'owner', user: user || 'owner', name: 'Owner' };
  return null;
}

/** The file inside a multipart/form-data body (the admin page's upload pieces); a raw body is returned as is. */
function filePart(req, buf) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(String(req.headers['content-type'] || ''));
  if (!/multipart\/form-data/i.test(String(req.headers['content-type'] || '')) || !m) return buf;
  const boundary = Buffer.from(`--${m[1] || m[2]}`);
  const start = buf.indexOf(boundary);
  const headEnd = buf.indexOf('\r\n\r\n', start);
  const end = buf.indexOf(Buffer.concat([Buffer.from('\r\n'), boundary]), headEnd);
  if (start < 0 || headEnd < 0 || end < 0) throw Object.assign(new Error('Upload piece arrived incomplete; try again.'), { status: 400 });
  return buf.subarray(headEnd + 4, end);
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
  const who = authorized(req, password, ctx.root);
  if (!who) {
    if (req.headers.authorization) { recent.push(now); fails.set(ip, recent); }
    return send(res, 401, { ...base, 'www-authenticate': 'Basic realm="Therapy & Injury site admin", charset="UTF-8"', 'content-type': 'text/plain' }, 'Sign in required\n');
  }
  fails.delete(ip);

  const updater = require(path.join(ctx.root, 'updater.js'));
  const route = url.pathname.replace(/\/+$/, '') || '/_admin';
  const by = who.role === 'owner' ? 'Owner' : who.name || who.user;

  // Leads (owner and front desk).
  if (route === '/_admin/api/me') return json(200, { ok: true, role: who.role, user: who.user, name: who.name, statuses: leads.STATUSES, howHeard: leads.HOW_HEARD, branches: (ctx.live()?.branches || []).map((b) => ({ slug: b.slug, city: b.city, open: b.status === 'open' })) });
  if (route.startsWith('/_admin/api/leads')) {
    const from = url.searchParams.get('from') || '', to = url.searchParams.get('to') || '';
    if (req.method === 'GET' && route === '/_admin/api/leads') return json(200, { ok: true, leads: leads.listLeads(ctx.root, from, to) });
    if (req.method === 'GET' && route === '/_admin/api/leads.csv') {
      return send(res, 200, { ...base, 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"` }, '\uFEFF' + leads.exportCsv(ctx.root, from, to));
    }
    if (!['POST', 'PUT'].includes(req.method) || req.headers['x-admin-action'] !== '1') return json(400, { ok: false, error: 'Bad request' });
    try {
      if (route === '/_admin/api/leads/match') return json(200, { ok: true, ...leads.matchPatients(ctx.root, (await readRaw(req, 20 * 1024 * 1024)).toString('utf8'), by) });
      const body = JSON.parse((await readRaw(req, 64 * 1024)).toString('utf8') || '{}');
      // "Referred by": the office is looked up in the outreach contacts, never taken from the browser.
      if ('referrerId' in body) body.referrer = body.referrerId ? outreach.partnerById(ctx.root, String(body.referrerId)) : null;
      if (route === '/_admin/api/leads/add') return json(200, { ok: true, lead: leads.addPhoneLead(ctx.root, body, by) });
      if (route === '/_admin/api/leads/update') {
        if (body.remove && who.role !== 'owner') return json(403, { ok: false, error: 'Only the owner can delete a lead' });
        return json(200, { ok: true, lead: leads.changeLead(ctx.root, body, by) });
      }
      return json(404, { ok: false, error: 'Unknown action' });
    } catch (e) {
      console.error('[leads]', e.message);
      return json(e.status || 400, { ok: false, error: e.message });
    }
  }
  if (req.method === 'GET' && route === '/_admin/api/partners') return json(200, { ok: true, partners: outreach.partnerList(ctx.root) });
  if (req.method === 'GET' && route === '/_admin' && who.role !== 'owner') return send(res, 200, { ...base, 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'" }, PAGE);
  // Everything else is the owner's.
  if (who.role !== 'owner') return json(403, { ok: false, error: 'This login can only use the Leads tab.' });

  if (req.method === 'GET' && route === '/_admin/api/report') return json(200, { ok: true, ...leads.report(ctx.root, url.searchParams.get('from') || '', url.searchParams.get('to') || '') });
  const origin = new URL(ctx.siteInfo.domain || 'https://therapyandinjury.com').origin;
  if (req.method === 'GET' && route === '/_admin/api/outreach') return json(200, { ok: true, ...outreach.overview(ctx.root, leads.listLeads(ctx.root, '', ''), origin) });
  if (route.startsWith('/_admin/api/outreach/')) {
    if (req.method !== 'POST' || req.headers['x-admin-action'] !== '1') return json(400, { ok: false, error: 'Bad request' });
    try {
      const raw = (await readRaw(req, 5 * 1024 * 1024)).toString('utf8');
      const act = route.slice('/_admin/api/outreach/'.length);
      if (act === 'import') return json(200, { ok: true, ...outreach.importContacts(ctx.root, leads.parseCsv(raw.replace(/^\uFEFF/, '')), 'Owner') });
      const body = JSON.parse(raw || '{}');
      if (act === 'contact') return json(200, { ok: true, contact: outreach.saveContact(ctx.root, body, 'Owner') });
      if (act === 'campaign') return json(200, { ok: true, campaign: outreach.saveCampaign(ctx.root, body) });
      if (act === 'settings') return json(200, { ok: true, settings: outreach.saveSettings(ctx.root, body) });
      if (act === 'secrets') return json(200, { ok: outreach.saveSecrets(ctx.root, body) });
      if (act === 'preview') return json(200, { ok: true, ...outreach.preview(ctx.root, body, origin) });
      if (act === 'test') return json(200, { ok: true, ...(await outreach.sendTest(ctx.root, body, origin)) });
      if (act === 'run') return json(200, { ok: true, ...(await outreach.tick(ctx.root, origin)) });
      return json(404, { ok: false, error: 'Unknown action' });
    } catch (e) {
      console.error('[outreach]', e.message);
      return json(e.status || 400, { ok: false, error: e.message });
    }
  }
  if (req.method === 'GET' && route === '/_admin/api/users') return json(200, { ok: true, users: leads.listUsers(ctx.root) });

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
    if (route === '/_admin/api/upload' && url.searchParams.has('id')) {
      // One piece of a package (the admin page sends 2 MB pieces in order); the last piece installs it.
      const id = String(url.searchParams.get('id'));
      const part = Number(url.searchParams.get('part')), of = Number(url.searchParams.get('of'));
      if (!/^[a-f0-9]{8,32}$/.test(id) || !Number.isInteger(part) || !Number.isInteger(of) || of < 1 || of > 100 || part < 0 || part >= of) return json(400, { ok: false, error: 'Bad upload piece' });
      const tmp = path.join(ctx.root, 'tmp');
      fs.mkdirSync(tmp, { recursive: true });
      // Leftovers from abandoned uploads (over an hour old) are removed.
      for (const d of fs.readdirSync(tmp).filter((x) => x.startsWith('upload-'))) {
        try { if (Date.now() - fs.statSync(path.join(tmp, d)).mtimeMs > 3600e3) fs.rmSync(path.join(tmp, d), { recursive: true, force: true }); } catch {}
      }
      const dir = path.join(tmp, `upload-${id}`);
      fs.mkdirSync(dir, { recursive: true });
      const raw = await readRaw(req, 8 * 1024 * 1024);
      fs.writeFileSync(path.join(dir, String(part)), filePart(req, raw));
      if (part < of - 1) return json(200, { ok: true, received: part + 1, of });
      const pieces = [];
      for (let i = 0; i < of; i++) {
        const f = path.join(dir, String(i));
        if (!fs.existsSync(f)) { fs.rmSync(dir, { recursive: true, force: true }); return json(400, { ok: false, error: `Upload incomplete (piece ${i + 1} of ${of} missing). Try again.` }); }
        pieces.push(fs.readFileSync(f));
      }
      fs.rmSync(dir, { recursive: true, force: true });
      const buf = Buffer.concat(pieces);
      if (buf.length > MAX_UPLOAD) return json(413, { ok: false, error: 'Upload is too large' });
      const r = updater.installBuffer(buf, { source: 'admin upload', force: url.searchParams.get('force') === '1' });
      return json(200, { ok: true, ...r, note: 'Installed. The site switches over on the next request.' });
    }
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
    if (route === '/_admin/api/spend') return json(200, { ok: true, spend: leads.setSpend(ctx.root, body) });
    if (route === '/_admin/api/users') {
      if (body.remove) { leads.removeUser(ctx.root, body.username); return json(200, { ok: true, users: leads.listUsers(ctx.root) }); }
      leads.saveUser(ctx.root, body);
      return json(200, { ok: true, users: leads.listUsers(ctx.root) });
    }
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
