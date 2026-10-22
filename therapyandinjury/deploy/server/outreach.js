'use strict';
/**
 * Referral-partner outreach (owner, Oct 2026): business-to-business email campaigns to personal-injury
 * attorneys, urgent care centers, hospitals, primary care, imaging centers and specialists, sent through
 * SendGrid, with opens, clicks, bounces and unsubscribes tracked. Never used for patients or accident
 * victims (Florida §817.234(8)); patient leads live in leads.js.
 *
 * How it works:
 *   - Contacts: partner offices (public business email/phone). Import a CSV or add them one by one.
 *   - Campaigns: an audience (partner types, optional tag) and a sequence of steps (day, subject, text).
 *     An active campaign enrolls matching contacts on its own; each contact gets one step at a time,
 *     only on weekdays inside the send window, at most `dailyCap` emails a day in all, and never two
 *     emails within 3 days. A sequence stops when the contact replies (marked in /_admin), becomes a
 *     partner, unsubscribes, bounces or reports spam.
 *   - Sending runs every few minutes while the app is up, and from a cPanel cron job that calls
 *     /api/outreach/tick?k=<token> (Passenger stops idle apps, so the cron keeps sending on schedule).
 *   - Tracking: SendGrid's Event Webhook posts to /api/outreach/events?k=<token> (signature checked
 *     when the verification key is saved). Unsubscribe: /api/outreach/unsubscribe?t=<signed token>, also
 *     sent as a one-click List-Unsubscribe header (RFC 8058).
 *
 * Storage (app root, never touched by updates):
 *   outreach/outreach.json  contacts, campaigns, enrollments, messages, suppressions, settings
 *   outreach/secret.json    SendGrid API key, webhook verification key, link tokens (never sent to the browser)
 * Business contacts are not patient data, but the files are still private to the app user (mode 600).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TYPES = { attorney: 'Personal-injury attorney', urgent: 'Urgent care', hospital: 'Hospital / ER', primary: 'Primary care', imaging: 'Imaging center', specialist: 'Orthopedic / pain / specialist', other: 'Other' };
const CONTACT_STATUSES = { active: 'Active', replied: 'Replied', partner: 'Active partner', notinterested: 'Not interested', unsubscribed: 'Unsubscribed', bounced: 'Bounced', dnc: 'Do not contact' };
const SENDABLE = new Set(['active']);
const MIN_GAP_DAYS = 3;
const PER_TICK = 25;
const KEEP_MESSAGES = 20000;
const TZ = 'America/New_York';
const DAY = 86400000;

const clean = (v, max = 200) => String(v ?? '').replace(/<[^>]*>/g, '').replace(/[\u0000-\u0009\u000b-\u001f]+/g, ' ').trim().slice(0, max);
const cleanText = (v, max = 8000) => String(v ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f]+/g, ' ').slice(0, max);
const isEmail = (v) => typeof v === 'string' && /^[^\s@<>,;"\[\]]+@[^\s@<>,;"\[\]]+\.[^\s@<>,;"\[\]]{2,}$/.test(v.trim());
const lc = (v) => String(v || '').trim().toLowerCase();
const newId = () => crypto.randomBytes(8).toString('hex');
const nowIso = () => new Date().toISOString();
const err = (message, status = 422) => Object.assign(new Error(message), { status });

// ---------- storage ----------
function dirOf(root) {
  const d = path.join(root, 'outreach');
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  return d;
}
function writeJson(file, obj) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
}
const EMPTY = () => ({ contacts: [], campaigns: [], enrollments: [], messages: [], suppress: {}, settings: {}, seeded: false });
function read(root) {
  try { return { ...EMPTY(), ...JSON.parse(fs.readFileSync(path.join(dirOf(root), 'outreach.json'), 'utf8')) }; } catch { return EMPTY(); }
}
function lockDir(dir, name, staleMs, waitMs) {
  const lock = path.join(dir, name);
  const start = Date.now();
  for (;;) {
    try { fs.mkdirSync(lock); return () => fs.rmSync(lock, { recursive: true, force: true }); } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - fs.statSync(lock).mtimeMs > staleMs) { fs.rmSync(lock, { recursive: true, force: true }); continue; } } catch {}
      if (Date.now() - start > waitMs) return null;
      const until = Date.now() + 25; while (Date.now() < until) { /* short wait */ }
    }
  }
}
/** Runs fn(db) under a lock and saves the db afterwards; returns fn's result. */
function update(root, fn) {
  const dir = dirOf(root);
  const release = lockDir(dir, '.lock', 10000, 5000);
  if (!release) throw err('The outreach store is busy; try again.', 503);
  try {
    const db = read(root);
    seed(root, db);
    const result = fn(db);
    if (db.messages.length > KEEP_MESSAGES) db.messages = db.messages.slice(-KEEP_MESSAGES);
    writeJson(path.join(dir, 'outreach.json'), db);
    return result;
  } finally { release(); }
}

/** The store, with the starter campaigns saved on first use (so their ids are stable). */
function load(root) {
  const db = read(root);
  if (db.seeded) return db;
  update(root, () => {});
  return read(root);
}

function secrets(root) {
  const f = path.join(dirOf(root), 'secret.json');
  let s = {};
  try { s = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
  if (!s.hookToken || !s.unsubKey) {
    s = { hookToken: crypto.randomBytes(18).toString('base64url'), unsubKey: crypto.randomBytes(32).toString('hex'), ...s };
    writeJson(f, s);
  }
  return s;
}
const apiKeyOf = (root) => process.env.SENDGRID_API_KEY || secrets(root).sendgridKey || '';

// ---------- settings ----------
const DEFAULT_SETTINGS = {
  fromEmail: '', fromName: '', replyTo: '', senderName: '', senderTitle: '', practicePhone: '',
  physicalAddress: 'Therapy & Injury, 2649 W Silver Springs Blvd, Ocala, FL 34475',
  dailyCap: 40, sendDays: [1, 2, 3, 4, 5], sendStart: '09:00', sendEnd: '16:00', paused: false, testEmail: '',
};
const settingsOf = (db) => ({ ...DEFAULT_SETTINGS, ...db.settings });

function saveSettings(root, body) {
  return update(root, (db) => {
    const s = settingsOf(db);
    for (const k of ['fromName', 'senderName', 'senderTitle', 'practicePhone']) if (typeof body[k] === 'string') s[k] = clean(body[k], 100);
    for (const k of ['fromEmail', 'replyTo', 'testEmail']) {
      if (typeof body[k] !== 'string') continue;
      const v = body[k].trim();
      if (v && !isEmail(v)) throw err(`"${v}" doesn't look like an email address`);
      s[k] = v;
    }
    if (typeof body.physicalAddress === 'string') s.physicalAddress = clean(body.physicalAddress, 200);
    if (body.dailyCap != null) {
      const n = Number(body.dailyCap);
      if (!(Number.isInteger(n) && n >= 1 && n <= 500)) throw err('Daily limit must be a whole number from 1 to 500');
      s.dailyCap = n;
    }
    if (Array.isArray(body.sendDays)) s.sendDays = [...new Set(body.sendDays.map(Number).filter((d) => d >= 0 && d <= 6))].sort();
    for (const k of ['sendStart', 'sendEnd']) if (typeof body[k] === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(body[k])) s[k] = body[k];
    if (s.sendStart >= s.sendEnd) throw err('The send window must end after it starts');
    if (typeof body.paused === 'boolean') s.paused = body.paused;
    db.settings = s;
    return s;
  });
}

function saveSecrets(root, body) {
  const s = secrets(root);
  if (typeof body.sendgridKey === 'string' && body.sendgridKey.trim()) {
    const k = body.sendgridKey.trim();
    if (!/^SG\.[\w-]{10,}\.[\w-]{10,}$/.test(k)) throw err('That doesn\'t look like a SendGrid API key (it starts with "SG.")');
    s.sendgridKey = k;
  }
  if (body.clearSendgridKey) delete s.sendgridKey;
  if (typeof body.webhookKey === 'string') {
    const k = body.webhookKey.replace(/-----[^-]+-----|\s+/g, '');
    if (k) {
      try { crypto.createPublicKey({ key: Buffer.from(k, 'base64'), format: 'der', type: 'spki' }); } catch { throw err('That verification key is not valid. Copy the whole key from SendGrid → Mail Settings → Event Webhook → Signature verification.'); }
    }
    s.webhookKey = k || undefined;
  }
  if (body.newHookToken) s.hookToken = crypto.randomBytes(18).toString('base64url');
  writeJson(path.join(dirOf(root), 'secret.json'), s);
  return true;
}

// ---------- contacts ----------
function normType(v) {
  const t = lc(v);
  if (TYPES[t]) return t;
  if (/attorney|law|lawyer|legal/.test(t)) return 'attorney';
  if (/urgent|walk-?in/.test(t)) return 'urgent';
  if (/hospital|er\b|emergency/.test(t)) return 'hospital';
  if (/primary|family|internal|pcp/.test(t)) return 'primary';
  if (/imaging|mri|radiolog|x-?ray/.test(t)) return 'imaging';
  if (/ortho|pain|spine|specialist|neuro|rehab/.test(t)) return 'specialist';
  return 'other';
}
const tagsOf = (v) => (Array.isArray(v) ? v : String(v || '').split(/[,;]/)).map((x) => clean(x, 40).toLowerCase()).filter(Boolean).slice(0, 12);

function contactFrom(body, existing = {}) {
  const c = { ...existing };
  for (const [k, max] of [['org', 160], ['name', 100], ['title', 100], ['phone', 40], ['address', 200], ['website', 300], ['city', 60]]) if (typeof body[k] === 'string') c[k] = clean(body[k], max);
  if (typeof body.email === 'string') {
    const e = body.email.trim();
    if (e && !isEmail(e)) throw err(`"${e}" doesn't look like an email address`);
    c.email = e;
  }
  if (body.type != null) c.type = normType(body.type);
  if (body.tags != null) c.tags = tagsOf(body.tags);
  if (body.status != null) {
    if (!CONTACT_STATUSES[body.status]) throw err('Unknown contact status');
    c.status = body.status;
  }
  if (!c.org && !c.name) throw err('Enter the office or the person\'s name');
  return c;
}

function stopFor(db, contactId, reason) {
  for (const e of db.enrollments) if (e.contactId === contactId && e.status === 'active') { e.status = 'stopped'; e.stopReason = reason; e.endedAt = nowIso(); }
}

function saveContact(root, body, by) {
  return update(root, (db) => {
    if (body.id) {
      const c = db.contacts.find((x) => x.id === body.id);
      if (!c) throw err('Contact not found', 404);
      if (body.remove === true) {
        db.contacts = db.contacts.filter((x) => x.id !== c.id);
        db.enrollments = db.enrollments.filter((e) => e.contactId !== c.id);
        return { removed: true };
      }
      const before = c.status;
      Object.assign(c, contactFrom(body, c));
      if (body.note) (c.notes ||= []).push({ by, at: nowIso(), text: clean(body.note, 1000) });
      if (c.status !== before) {
        (c.history ||= []).push({ status: c.status, by, at: nowIso() });
        if (!SENDABLE.has(c.status)) stopFor(db, c.id, CONTACT_STATUSES[c.status]);
        if (c.status === 'active' && db.suppress[lc(c.email)]?.reason === 'unsubscribed') throw err('This address unsubscribed; it can\'t be emailed again.');
      }
      return c;
    }
    const c = contactFrom(body, { id: newId(), createdAt: nowIso(), status: 'active', type: 'other', tags: [], notes: [], history: [], source: by });
    if (c.email && db.contacts.some((x) => lc(x.email) === lc(c.email))) throw err(`${c.email} is already in your contacts`);
    if (body.note) c.notes.push({ by, at: nowIso(), text: clean(body.note, 1000) });
    if (db.suppress[lc(c.email)]) c.status = db.suppress[lc(c.email)].reason === 'bounced' ? 'bounced' : 'unsubscribed';
    db.contacts.push(c);
    return c;
  });
}

/** CSV import (marketing/referral-outreach/contacts.csv, or any sheet with org/name/email columns). */
function importContacts(root, rows, by) {
  if (rows.length < 2) throw err('That file has no rows');
  const head = rows[0].map((h) => lc(h).replace(/[^a-z]/g, ''));
  const col = (...names) => head.findIndex((h) => names.includes(h));
  const ix = {
    org: col('org', 'organization', 'office', 'practice', 'company', 'firm', 'business', 'name'),
    name: col('contactperson', 'contact', 'person', 'fullname', 'firstname'),
    title: col('title', 'role', 'position'),
    email: col('email', 'emailaddress', 'mail'),
    phone: col('phone', 'telephone', 'tel', 'phonenumber'),
    address: col('address', 'street', 'location'),
    website: col('website', 'url', 'web', 'site'),
    type: col('type', 'category', 'kind'),
    tags: col('tags', 'tag', 'labels'),
    notes: col('notes', 'note', 'comments'),
  };
  if (ix.org < 0 && ix.email < 0) throw err('No office/name or email column found. The first row needs headings like: type, name, email, phone.');
  if (ix.name === ix.org) ix.name = -1;
  const get = (r, k) => (ix[k] >= 0 ? String(r[ix[k]] || '').trim() : '');
  return update(root, (db) => {
    let added = 0, updated = 0, skipped = 0;
    const problems = [];
    for (const [n, r] of rows.slice(1).entries()) {
      const body = { org: get(r, 'org'), name: get(r, 'name'), title: get(r, 'title'), email: get(r, 'email'), phone: get(r, 'phone'), address: get(r, 'address'), website: get(r, 'website'), type: get(r, 'type') || 'other', tags: get(r, 'tags') };
      if (body.email && !isEmail(body.email)) { problems.push(`Row ${n + 2}: bad email "${body.email}"`); body.email = ''; }
      if (!body.org && !body.name) { skipped++; continue; }
      const match = db.contacts.find((c) => (body.email && lc(c.email) === lc(body.email)) || (!c.email && lc(c.org) === lc(body.org) && lc(c.name) === lc(body.name)));
      try {
        if (match) {
          for (const k of Object.keys(body)) if (!body[k] || (k === 'type' && body.type === 'other')) delete body[k];
          Object.assign(match, contactFrom(body, match));
          updated++;
        } else {
          const c = contactFrom(body, { id: newId(), createdAt: nowIso(), status: 'active', type: 'other', tags: [], notes: [], history: [], source: `${by} (import)` });
          if (get(r, 'notes')) c.notes.push({ by: `${by} (import)`, at: nowIso(), text: clean(get(r, 'notes'), 1000) });
          if (db.suppress[lc(c.email)]) c.status = 'unsubscribed';
          db.contacts.push(c);
          added++;
        }
      } catch (e) { problems.push(`Row ${n + 2}: ${e.message}`); skipped++; }
    }
    return { added, updated, skipped, problems: problems.slice(0, 20) };
  });
}

// ---------- campaigns ----------
const slugify = (s) => lc(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'outreach';

function saveCampaign(root, body) {
  return update(root, (db) => {
    let c = body.id ? db.campaigns.find((x) => x.id === body.id) : null;
    if (body.id && !c) throw err('Campaign not found', 404);
    if (c && body.remove === true) {
      if (db.messages.some((m) => m.campaignId === c.id)) throw err('This campaign has sent emails; pause it instead of deleting it, so its history stays.');
      db.campaigns = db.campaigns.filter((x) => x.id !== c.id);
      db.enrollments = db.enrollments.filter((e) => e.campaignId !== c.id);
      return { removed: true };
    }
    if (!c) { c = { id: newId(), createdAt: nowIso(), status: 'draft', types: [], tag: '', steps: [] }; db.campaigns.push(c); }
    if (typeof body.name === 'string') c.name = clean(body.name, 100);
    if (!c.name) throw err('Give the campaign a name');
    c.slug = slugify(c.slug && !body.name ? c.slug : c.name);
    if (Array.isArray(body.types)) c.types = body.types.filter((t) => TYPES[t]);
    if (typeof body.tag === 'string') c.tag = clean(body.tag, 40).toLowerCase();
    if (Array.isArray(body.steps)) {
      if (body.steps.length > 8) throw err('Up to 8 emails per campaign');
      c.steps = body.steps.map((s, i) => {
        const day = Number(s.day);
        if (!(Number.isInteger(day) && day >= 0 && day <= 365)) throw err(`Email ${i + 1}: the day must be a whole number from 0 to 365`);
        const subject = clean(s.subject, 160), text = cleanText(s.body, 8000).trim();
        if (!subject || !text) throw err(`Email ${i + 1} needs a subject and a message`);
        return { day, subject, body: text };
      });
      for (let i = 1; i < c.steps.length; i++) if (c.steps[i].day <= c.steps[i - 1].day) throw err(`Email ${i + 1} must be sent on a later day than email ${i}`);
    }
    if (body.status != null) {
      if (!['draft', 'active', 'paused'].includes(body.status)) throw err('Unknown campaign status');
      if (body.status === 'active') {
        const s = settingsOf(db);
        if (!c.steps.length) throw err('Add at least one email before starting the campaign');
        if (!c.types.length && !c.tag) throw err('Choose who the campaign is for (partner types or a tag)');
        if (!isEmail(s.fromEmail) || !s.physicalAddress) throw err('Fill in Outreach → Settings first (sender email and the practice\'s mailing address, which the law requires in every email)');
        if (!apiKeyOf(root)) throw err('Add your SendGrid API key in Outreach → Settings first');
      }
      if (body.status !== c.status) c[`${body.status}At`] = nowIso();
      c.status = body.status;
      if (c.status === 'active') enrollMatching(db, c);
    }
    return c;
  });
}

const matches = (c, camp) => (!camp.types.length || camp.types.includes(c.type)) && (!camp.tag || (c.tags || []).includes(camp.tag));
function canEnroll(db, c) {
  return SENDABLE.has(c.status) && isEmail(c.email) && !db.suppress[lc(c.email)];
}
/** Adds every matching contact not yet in this campaign. A contact in another running sequence waits for it to finish. */
function enrollMatching(db, camp) {
  let n = 0;
  const inCamp = new Set(db.enrollments.filter((e) => e.campaignId === camp.id).map((e) => e.contactId));
  for (const c of db.contacts) {
    if (inCamp.has(c.id) || !matches(c, camp) || !canEnroll(db, c)) continue;
    db.enrollments.push({ id: newId(), campaignId: camp.id, contactId: c.id, step: 0, fails: 0, status: 'active', startedAt: null, createdAt: nowIso() });
    n++;
  }
  return n;
}

// ---------- email content ----------
function firstName(c) {
  const n = String(c.name || '').replace(/^(dr|mr|mrs|ms|mx)\.?\s+/i, '').trim();
  return n.split(/\s+/)[0] || '';
}
function fill(text, c, s) {
  const map = {
    first_name: firstName(c) || 'there', name: c.name || c.org || 'there', org: c.org || 'your office', title: c.title || '', city: c.city || 'Ocala',
    sender_name: s.senderName || s.fromName || 'Therapy & Injury', sender_title: s.senderTitle || '', practice_phone: s.practicePhone || '', address: s.physicalAddress,
  };
  return String(text).replace(/\{(\w+)\}/g, (m, k) => (k in map ? map[k] : m));
}
const escHtml = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
/** Tags this site's links so visits from the email show in the reports as Email / <campaign>. */
function tagLink(url, camp) {
  try {
    const u = new URL(url);
    if (!/(^|\.)therapyandinjury\.com$/i.test(u.hostname) || u.searchParams.has('utm_source')) return url;
    u.searchParams.set('utm_source', 'outreach'); u.searchParams.set('utm_medium', 'email'); u.searchParams.set('utm_campaign', camp?.slug || 'outreach');
    return u.toString();
  } catch { return url; }
}
function linkify(escaped, camp) {
  return escaped.replace(/\b(https?:\/\/[^\s<]+[^\s<.,;:!?)\]])|\b((?:www\.)?therapyandinjury\.com(?:\/[^\s<]*[^\s<.,;:!?)\]])?)/gi, (m, full, bare) => {
    const href = tagLink((full || `https://${bare}`).replace(/&amp;/g, '&'), camp);
    return `<a href="${escHtml(href)}" style="color:#0b6e66">${m}</a>`;
  });
}
function unsubToken(root, contactId) {
  const sig = crypto.createHmac('sha256', secrets(root).unsubKey).update(`u:${contactId}`).digest('base64url').slice(0, 22);
  return `${contactId}.${sig}`;
}
function contactFromToken(root, token) {
  const [id, sig] = String(token || '').split('.');
  if (!id || !sig) return null;
  const want = unsubToken(root, id).split('.')[1];
  return want.length === sig.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig)) ? id : null;
}

/** { subject, html, text } for one step to one contact (plain, personal-looking email + the required footer). */
function compose(root, db, camp, step, c, origin) {
  const s = settingsOf(db);
  const subject = fill(step.subject, c, s);
  const body = fill(step.body, c, s);
  const unsub = `${origin}/api/outreach/unsubscribe?t=${unsubToken(root, c.id)}`;
  const paras = body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  // Runs of lines starting with "- " become a list; other lines stay a paragraph (line breaks kept).
  const bullet = /^\s*[-•*]\s+/;
  const htmlBody = paras.map((p) => {
    const groups = [];
    for (const l of p.split('\n')) {
      const isB = bullet.test(l), last = groups.at(-1);
      if (last && last.isB === isB) last.lines.push(l); else groups.push({ isB, lines: [l] });
    }
    return groups.map((g) => (g.isB
      ? `<ul style="margin:0 0 14px;padding-left:20px">${g.lines.map((l) => `<li>${linkify(escHtml(l.replace(bullet, '')), camp)}</li>`).join('')}</ul>`
      : `<p style="margin:0 0 ${groups.length > 1 ? 6 : 14}px">${linkify(escHtml(g.lines.join('\n')), camp).replace(/\n/g, '<br>')}</p>`)).join('');
  }).join('');
  const footer = `${escHtml(s.physicalAddress)}<br>You're receiving this as a local health-care or legal professional. <a href="${escHtml(unsub)}" clicktracking="off" style="color:#57667a">Unsubscribe</a> and we won't email you again.`;
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#ffffff"><div style="max-width:600px;margin:0 auto;padding:20px 16px;font:15px/1.55 Arial,Helvetica,sans-serif;color:#1b2a3d">${htmlBody}<div style="margin-top:28px;padding-top:12px;border-top:1px solid #e3e8ee;font-size:12px;line-height:1.5;color:#57667a">${footer}</div></div></body></html>`;
  const text = `${body}\n\n--\n${s.physicalAddress}\nUnsubscribe: ${unsub}\n`;
  return { subject, html, text, unsub };
}

// ---------- SendGrid ----------
async function sgSend(root, db, { to, subject, html, text, unsub, messageId, categories }) {
  const key = apiKeyOf(root);
  if (!key) throw err('No SendGrid API key saved', 400);
  const s = settingsOf(db);
  const payload = {
    personalizations: [{ to: [{ email: to }], custom_args: { ti_m: messageId } }],
    from: { email: s.fromEmail, name: s.fromName || 'Therapy & Injury' },
    reply_to: isEmail(s.replyTo) ? { email: s.replyTo } : undefined,
    subject,
    content: [{ type: 'text/plain', value: text }, { type: 'text/html', value: html }],
    categories: categories?.slice(0, 10),
    headers: unsub ? { 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : undefined,
    tracking_settings: { click_tracking: { enable: true, enable_text: false }, open_tracking: { enable: true }, subscription_tracking: { enable: false } },
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(`${process.env.SENDGRID_API_URL || 'https://api.sendgrid.com'}/v3/mail/send`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: ctrl.signal });
    if (r.status === 202 || r.status === 200) return { sgId: r.headers.get('x-message-id') || '' };
    let detail = '';
    try { detail = (await r.json()).errors?.map((e) => e.message).join('; ') || ''; } catch {}
    throw err(`SendGrid refused the email (HTTP ${r.status}${detail ? `: ${detail}` : ''})`, r.status === 401 || r.status === 403 ? 400 : 502);
  } finally { clearTimeout(timer); }
}

// ---------- the sender ----------
function localNow(date = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', hour: '2-digit', minute: '2-digit', year: 'numeric', month: '2-digit', day: '2-digit', hourCycle: 'h23' }).formatToParts(date).map((x) => [x.type, x.value]));
  return { day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday), hm: `${p.hour}:${p.minute}`, date: `${p.year}-${p.month}-${p.day}` };
}
function inWindow(s, date = new Date()) {
  const l = localNow(date);
  return s.sendDays.includes(l.day) && l.hm >= s.sendStart && l.hm < s.sendEnd;
}
const sentToday = (db) => { const d = localNow().date; return db.messages.filter((m) => !m.test && m.sentAt && localNow(new Date(m.sentAt)).date === d).length; };

/** What's due now: [{ enrollment, campaign, contact, step }], oldest first, within today's remaining allowance. */
function dueNow(db, now = Date.now()) {
  const s = settingsOf(db);
  const camps = new Map(db.campaigns.filter((c) => c.status === 'active').map((c) => [c.id, c]));
  const contacts = new Map(db.contacts.map((c) => [c.id, c]));
  const lastSent = new Map();
  for (const m of db.messages) if (!m.test && m.sentAt) lastSent.set(m.contactId, Math.max(lastSent.get(m.contactId) || 0, Date.parse(m.sentAt)));
  const busy = new Set(db.enrollments.filter((e) => e.status === 'active' && e.startedAt).map((e) => e.contactId));
  const out = [], picked = new Set();
  const list = db.enrollments.filter((e) => e.status === 'active' && camps.has(e.campaignId)).sort((a, b) => (a.startedAt ? 0 : 1) - (b.startedAt ? 0 : 1) || String(a.startedAt || a.createdAt).localeCompare(String(b.startedAt || b.createdAt)));
  for (const e of list) {
    const camp = camps.get(e.campaignId), c = contacts.get(e.contactId), step = camp.steps[e.step];
    if (!c || !step || picked.has(c.id)) continue;
    if (!canEnroll(db, c)) continue;
    if (!e.startedAt && busy.has(c.id)) continue; // finishing another campaign first
    const due = e.startedAt ? Date.parse(e.startedAt) + step.day * DAY : now;
    if (due > now) continue;
    if (now - (lastSent.get(c.id) || 0) < MIN_GAP_DAYS * DAY) continue;
    out.push({ e, camp, c, step });
    picked.add(c.id);
  }
  return out.slice(0, Math.max(0, s.dailyCap - sentToday(db)));
}

let ticking = false;
/** Sends what's due (up to PER_TICK). Safe to call from several processes at once. */
async function tick(root, origin, { force = false } = {}) {
  if (ticking) return { skipped: 'already running' };
  ticking = true;
  const release = lockDir(dirOf(root), '.sending', 10 * 60000, 0);
  if (!release) { ticking = false; return { skipped: 'another process is sending' }; }
  let sent = 0, failed = 0;
  try {
    // Pick up new contacts for running campaigns.
    const due = update(root, (db) => {
      for (const camp of db.campaigns) if (camp.status === 'active') enrollMatching(db, camp);
      const s = settingsOf(db);
      if (s.paused || !apiKeyOf(root) || !isEmail(s.fromEmail) || !s.physicalAddress) return [];
      if (!force && !inWindow(s)) return [];
      return dueNow(db).slice(0, PER_TICK).map(({ e, camp, c, step }) => ({ eid: e.id, cid: c.id, campId: camp.id, stepIx: e.step, mail: compose(root, db, camp, step, c, origin), to: c.email, campSlug: camp.slug, db }));
    });
    for (const d of due) {
      const messageId = newId();
      let res = null, error = '';
      try { res = await sgSend(root, d.db, { ...d.mail, to: d.to, messageId, categories: ['outreach', d.campSlug] }); sent++; }
      catch (e) { error = e.message; failed++; }
      update(root, (db) => {
        const e = db.enrollments.find((x) => x.id === d.eid);
        db.messages.push({ id: messageId, contactId: d.cid, campaignId: d.campId, step: d.stepIx, to: d.to, subject: d.mail.subject, sentAt: res ? nowIso() : null, sgId: res?.sgId || '', status: res ? 'sent' : 'failed', error: error || undefined, opens: 0, clicks: 0 });
        if (e && !res && !/HTTP 40[13]/.test(error) && (e.fails = (e.fails || 0) + 1) >= 3) { e.status = 'stopped'; e.stopReason = `Sending failed 3 times: ${error}`; e.endedAt = nowIso(); }
        if (!e || !res) return;
        if (!e.startedAt) e.startedAt = nowIso();
        e.step++;
        e.lastAt = nowIso();
        const camp = db.campaigns.find((x) => x.id === e.campaignId);
        if (!camp || e.step >= camp.steps.length) { e.status = 'done'; e.endedAt = nowIso(); }
      });
      if (error && /HTTP 40[13]/.test(error)) break; // bad key: stop this round
    }
    return { sent, failed };
  } finally { release(); ticking = false; }
}

async function sendTest(root, body, origin) {
  const db = load(root);
  const s = settingsOf(db);
  const to = String(body.to || s.testEmail || '').trim();
  if (!isEmail(to)) throw err('Enter the address to send the test to (Settings → test address)');
  if (!isEmail(s.fromEmail)) throw err('Fill in the sender email in Settings first');
  const camp = db.campaigns.find((c) => c.id === body.campaignId) || { slug: 'test', steps: [] };
  const step = body.step ? { subject: clean(body.step.subject, 160), body: cleanText(body.step.body) } : camp.steps[Number(body.stepIndex) || 0];
  if (!step) throw err('Nothing to send');
  const sample = db.contacts.find((c) => c.id === body.contactId) || { id: 'test', name: 'Dr. Jane Sample', org: 'Sample Law Group', title: 'Managing Partner', city: 'Ocala' };
  const mail = compose(root, db, camp, step, sample, origin);
  const messageId = newId();
  const r = await sgSend(root, db, { ...mail, subject: `[Test] ${mail.subject}`, to, messageId, categories: ['outreach-test'], unsub: null });
  update(root, (d) => { d.messages.push({ id: messageId, test: true, contactId: null, campaignId: camp.id || null, step: 0, to, subject: `[Test] ${mail.subject}`, sentAt: nowIso(), sgId: r.sgId, status: 'sent', opens: 0, clicks: 0 }); });
  return { to };
}

function preview(root, body, origin) {
  const db = load(root);
  const camp = db.campaigns.find((c) => c.id === body.campaignId) || { slug: 'preview' };
  const sample = db.contacts.find((c) => c.id === body.contactId) || { id: 'preview', name: 'Dr. Jane Sample', org: 'Sample Law Group', title: 'Managing Partner', city: 'Ocala' };
  const m = compose(root, db, camp, { subject: clean(body.subject, 160), body: cleanText(body.body) }, sample, origin);
  return { subject: m.subject, html: m.html };
}

// ---------- SendGrid event webhook ----------
function verifySignature(root, req, raw) {
  const key = secrets(root).webhookKey;
  if (!key) return true; // token in the URL only
  const sig = req.headers['x-twilio-email-event-webhook-signature'], ts = req.headers['x-twilio-email-event-webhook-timestamp'];
  if (!sig || !ts) return false;
  try {
    return crypto.verify('sha256', Buffer.concat([Buffer.from(String(ts)), raw]), { key: Buffer.from(key, 'base64'), format: 'der', type: 'spki' }, Buffer.from(String(sig), 'base64'));
  } catch { return false; }
}
const tokenOk = (root, k) => { const t = secrets(root).hookToken; return typeof k === 'string' && k.length === t.length && crypto.timingSafeEqual(Buffer.from(k), Buffer.from(t)); };

function handleEvents(root, events) {
  if (!Array.isArray(events)) return 0;
  return update(root, (db) => {
    const byId = new Map(db.messages.map((m) => [m.id, m]));
    let n = 0;
    for (const ev of events.slice(0, 2000)) {
      const m = byId.get(ev?.ti_m) || (ev?.sg_message_id && db.messages.find((x) => x.sgId && String(ev.sg_message_id).startsWith(x.sgId)));
      if (!m) continue;
      const at = ev.timestamp ? new Date(ev.timestamp * 1000).toISOString() : nowIso();
      n++;
      switch (ev.event) {
        case 'delivered': if (m.status === 'sent') m.status = 'delivered'; m.deliveredAt ||= at; break;
        case 'open': m.opens = (m.opens || 0) + 1; m.firstOpenAt ||= at; if (ev.sg_machine_open) m.machineOpen = true; break;
        case 'click': m.clicks = (m.clicks || 0) + 1; m.firstClickAt ||= at; m.lastUrl = clean(ev.url, 300); break;
        case 'deferred': m.deferred = (m.deferred || 0) + 1; break;
        case 'bounce': case 'dropped': {
          m.status = ev.event === 'dropped' ? 'dropped' : 'bounced'; m.error = clean(ev.reason || ev.response || ev.event, 300);
          const hard = ev.event === 'dropped' || ev.type !== 'blocked';
          if (hard && m.to) { db.suppress[lc(m.to)] = { reason: 'bounced', at }; mark(db, m.contactId, 'bounced', 'SendGrid'); }
          break;
        }
        case 'spamreport': case 'unsubscribe': case 'group_unsubscribe':
          if (m.to) db.suppress[lc(m.to)] = { reason: ev.event === 'spamreport' ? 'spam report' : 'unsubscribed', at };
          if (ev.event === 'spamreport') m.spam = true; else m.unsubscribed = true;
          mark(db, m.contactId, 'unsubscribed', ev.event === 'spamreport' ? 'Spam report (SendGrid)' : 'SendGrid');
          break;
        default: n--;
      }
    }
    return n;
  });
}
function mark(db, contactId, status, by) {
  const c = db.contacts.find((x) => x.id === contactId);
  if (!c || c.status === status) return;
  c.status = status;
  (c.history ||= []).push({ status, by, at: nowIso() });
  stopFor(db, c.id, CONTACT_STATUSES[status]);
}

function unsubscribe(root, token) {
  const id = contactFromToken(root, token);
  if (!id) return false;
  update(root, (db) => {
    const c = db.contacts.find((x) => x.id === id);
    if (!c) return;
    if (c.email) db.suppress[lc(c.email)] = { reason: 'unsubscribed', at: nowIso() };
    const m = [...db.messages].reverse().find((x) => x.contactId === id && !x.test);
    if (m) m.unsubscribed = true;
    mark(db, id, 'unsubscribed', 'Unsubscribe link');
  });
  return true;
}

// ---------- views for the admin page ----------
function referralCounts(leadsList) {
  const out = {};
  for (const l of leadsList) {
    const id = l.referrer?.id;
    if (!id) continue;
    const r = (out[id] ||= { leads: 0, patients: 0 });
    r.leads++;
    if (l.status === 'patient' || (l.history || []).some((h) => h.status === 'patient')) r.patients++;
  }
  return out;
}

function overview(root, leadsList, origin) {
  const db = load(root);
  const sec = secrets(root);
  const s = settingsOf(db);
  const refs = referralCounts(leadsList);
  const msgs = db.messages.filter((m) => !m.test);
  const perContact = {};
  for (const m of msgs) {
    const p = (perContact[m.contactId] ||= { sent: 0, opened: 0, clicked: 0, last: null });
    if (m.sentAt) p.sent++;
    if (m.opens) p.opened++;
    if (m.clicks) p.clicked++;
    if (m.sentAt && (!p.last || m.sentAt > p.last)) p.last = m.sentAt;
  }
  const contacts = db.contacts.map((c) => ({ ...c, mail: perContact[c.id] || { sent: 0, opened: 0, clicked: 0, last: null }, referrals: refs[c.id] || { leads: 0, patients: 0 }, suppressed: db.suppress[lc(c.email)]?.reason || null, enrolled: db.enrollments.filter((e) => e.contactId === c.id && e.status === 'active').map((e) => e.campaignId) }));
  const campaigns = db.campaigns.map((camp) => {
    const ms = msgs.filter((m) => m.campaignId === camp.id && m.sentAt);
    const en = db.enrollments.filter((e) => e.campaignId === camp.id);
    const ids = new Set(en.map((e) => e.contactId));
    const replied = db.contacts.filter((c) => ids.has(c.id) && ['replied', 'partner'].includes(c.status)).length;
    const r = [...ids].reduce((a, id) => { const x = refs[id]; if (x) { a.leads += x.leads; a.patients += x.patients; } return a; }, { leads: 0, patients: 0 });
    const ppl = (f) => new Set(ms.filter(f).map((m) => m.contactId)).size;
    return {
      ...camp,
      stats: {
        enrolled: en.length, waiting: en.filter((e) => e.status === 'active' && !e.startedAt).length, inProgress: en.filter((e) => e.status === 'active' && e.startedAt).length,
        finished: en.filter((e) => e.status === 'done').length, stopped: en.filter((e) => e.status === 'stopped').length,
        sent: ms.length, delivered: ms.filter((m) => m.deliveredAt || m.status === 'delivered').length, opened: ppl((m) => m.opens > 0), clicked: ppl((m) => m.clicks > 0),
        bounced: ms.filter((m) => ['bounced', 'dropped'].includes(m.status)).length, unsubscribed: ms.filter((m) => m.unsubscribed || m.spam).length,
        replied, referralLeads: r.leads, referralPatients: r.patients,
      },
    };
  });
  const due = dueNow(db);
  return {
    types: TYPES, statuses: CONTACT_STATUSES, settings: s, contacts, campaigns,
    messages: db.messages.slice(-300).reverse(),
    suppress: db.suppress,
    sendgrid: { keySet: !!apiKeyOf(root), keyFromEnv: !!process.env.SENDGRID_API_KEY, webhookKeySet: !!sec.webhookKey },
    hooks: { events: `${origin}/api/outreach/events?k=${sec.hookToken}`, tick: `${origin}/api/outreach/tick?k=${sec.hookToken}` },
    queue: { dueNow: due.length, sentToday: sentToday(db), inWindow: inWindow(s), local: localNow() },
  };
}

/** For the Leads tab (front desk too): partner offices to pick as "Referred by". */
const partnerList = (root) => load(root).contacts.filter((c) => c.status !== 'dnc').map((c) => ({ id: c.id, org: c.org || c.name, type: c.type })).sort((a, b) => a.org.localeCompare(b.org));
const partnerById = (root, id) => { const c = read(root).contacts.find((x) => x.id === id); return c ? { id: c.id, org: c.org || c.name, type: c.type } : null; };

// ---------- starter campaigns (drafts; nothing sends until the owner starts one) ----------
const SIGN = '{sender_name}\n{sender_title}\nTherapy & Injury · {practice_phone} · therapyandinjury.com';
const STARTERS = [
  {
    name: 'Attorneys: introduction', types: ['attorney'], steps: [
      { day: 0, subject: 'Car-accident clients in {city}: seen within 24 hours', body: 'Hi {first_name},\n\nI\'m {sender_name} with Therapy & Injury, a chiropractic and rehab practice at 2649 W Silver Springs Blvd in Ocala that focuses on auto-accident injuries.\n\nWhat that means for your clients:\n- New patients seen the same or next day, well inside the 14-day PIP window\n- We bill PIP directly, and send exam findings, treatment plans and progress notes once your client signs a release\n- Patient information in English, Spanish and Haitian Creole\n- Imaging and referrals to orthopedics or pain management when the injury needs more than we do\n\nCould I drop off a short packet, or take 10 minutes to walk your intake team through how we work? Clients can also reach us directly at 844-84-TREAT or therapyandinjury.com.\n\nThank you,\n' + SIGN },
      { day: 7, subject: 'Re: car-accident clients in {city}', body: 'Hi {first_name},\n\nFollowing up on my note last week. If {org} ever has a client who was hurt in a crash and hasn\'t been seen yet, we can usually see them today or tomorrow, and we send records quickly once they sign a release.\n\nWould a 10-minute call this week work for you or your intake lead?\n\nThank you,\n' + SIGN },
      { day: 21, subject: 'Last note from Therapy & Injury', body: 'Hi {first_name},\n\nI don\'t want to fill your inbox, so this is my last email. If it\'s ever useful, here\'s how to reach us:\n\n- New patients: 844-84-TREAT or therapyandinjury.com (English, Spanish and Kreyòl)\n- Records requests: reply to this email\n\nThank you for the work you do for injured people in Marion County.\n\n' + SIGN },
    ],
  },
  {
    name: 'Urgent care, hospitals & primary care: introduction', types: ['urgent', 'hospital', 'primary'], steps: [
      { day: 0, subject: 'A same-day follow-up option for your car-accident patients', body: 'Hi {first_name},\n\nI\'m {sender_name} with Therapy & Injury in Ocala (2649 W Silver Springs Blvd). We treat neck and back injuries from car accidents with chiropractic care and rehab.\n\nMany of your patients after a crash need follow-up care within 14 days to keep their PIP benefits. If it helps your team, we:\n- see them the same or next day and bill their auto insurance directly\n- send you our findings and plan, with the patient\'s consent, so their chart with you stays complete\n- refer back to you for anything medical, and order imaging when it\'s indicated\n\nCould I bring by patient handouts (English, Spanish and Haitian Creole) for your front desk?\n\nThank you,\n' + SIGN },
      { day: 7, subject: 'Re: follow-up care after car accidents', body: 'Hi {first_name},\n\nA quick follow-up. If it\'s easier than handouts, your staff can simply give patients our number, 844-84-TREAT, or therapyandinjury.com. We\'ll take it from there and keep you in the loop with the patient\'s consent.\n\nIs there a good day for me to stop by and meet your office manager?\n\nThank you,\n' + SIGN },
      { day: 21, subject: 'Last note from Therapy & Injury', body: 'Hi {first_name},\n\nThis is my last email, so I won\'t crowd your inbox. If you ever need a same-day option for a patient after a crash, we\'re at 844-84-TREAT and therapyandinjury.com, in English, Spanish and Kreyòl.\n\nThank you for caring for our community.\n\n' + SIGN },
    ],
  },
  {
    name: 'Imaging centers: referring office setup', types: ['imaging'], steps: [
      { day: 0, subject: 'New referring office in Ocala (auto-injury chiropractic)', body: 'Hi {first_name},\n\nI\'m {sender_name} with Therapy & Injury, a chiropractic and rehab practice at 2649 W Silver Springs Blvd in Ocala focused on auto-accident injuries. We expect to order X-ray and MRI studies regularly and would like to set up with {org} as a referring office.\n\nCould you tell me:\n- what you need from us to get set up (order forms, portal access, contacts)\n- your usual turnaround for scheduling and reads\n- whether you accept PIP and letters of protection\n\nThank you,\n' + SIGN },
      { day: 7, subject: 'Re: referring office setup', body: 'Hi {first_name},\n\nFollowing up on my note about setting up Therapy & Injury as a referring office. Who is the best person on your team to talk to about order forms and scheduling?\n\nThank you,\n' + SIGN },
    ],
  },
];
function seed(root, db) {
  if (db.seeded) return;
  db.seeded = true;
  for (const st of STARTERS) db.campaigns.push({ id: newId(), createdAt: nowIso(), status: 'draft', tag: '', slug: slugify(st.name), ...st });
}

module.exports = {
  TYPES, CONTACT_STATUSES, saveSettings, saveSecrets, saveContact, importContacts, saveCampaign, tick, sendTest, preview,
  verifySignature, tokenOk, handleEvents, unsubscribe, contactFromToken, overview, partnerList, partnerById, read, localNow, inWindow,
};
