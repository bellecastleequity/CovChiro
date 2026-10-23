'use strict';
/**
 * Lead management (owner, Oct 2026): every website request and every phone lead the front desk logs,
 * with where it came from (ad campaign, page, language), its status through the funnel, notes, and
 * anonymous call-button taps for reports. Nothing here leaves the server: no CRM, no ad pixels.
 *
 * Lead kinds: 'web' (website form), 'phone' (logged by the front desk), and 'call' / 'text' (logged by
 * the phone system: Amazon Connect posts each call and text conversation to /api/connect/event).
 *
 * Storage (app root, never touched by updates):
 *   leads/leads.enc         leads, call-tap counts and ad spend; AES-256-GCM encrypted
 *   leads/key               the encryption key (made on first use, readable by the app user only),
 *                           unless LEADS_KEY (64 hex characters) is set in the environment
 *   leads/backup-<day>.enc  one encrypted copy per day, last 14 kept
 *   users.json              front-desk logins (scrypt password hashes, no lead data)
 *   leads/connect.json      the shared secret Amazon Connect signs its posts with
 * Writes take a short lock so several app processes (Passenger can run more than one) never clash.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STATUSES = ['new', 'contacted', 'booked', 'showed', 'patient', 'notfit', 'noanswer'];
const STAGE = { new: 0, noanswer: 0, notfit: 0, contacted: 1, booked: 2, showed: 3, patient: 4 };
const HOW_HEARD = ['Facebook / Instagram ad', 'YouTube', 'Google search', 'Google ad', 'Radio', 'Attorney referral', 'Doctor / clinic referral', 'Urgent care referral', 'Hospital / ER referral', 'Imaging center referral', 'Friend or family', 'Drove by / signage', 'Website', 'Spanish ad', 'Creole ad', 'Returning patient', 'Other'];
const REFERRAL = /referral$/i; // the "… referral" answers above can name the referring office
const KEEP_BACKUPS = 14;

const clean = (v, max = 120) => String(v ?? '').replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, max);
const digits = (p) => String(p || '').replace(/\D/g, '').slice(-10);
const today = () => new Date().toISOString().slice(0, 10);
const newId = () => crypto.randomBytes(8).toString('hex');

function dirOf(root) {
  const d = path.join(root, 'leads');
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  return d;
}

function keyOf(root) {
  const env = process.env.LEADS_KEY;
  if (env && /^[0-9a-f]{64}$/i.test(env)) return Buffer.from(env, 'hex');
  const f = path.join(dirOf(root), 'key');
  if (!fs.existsSync(f)) {
    try { fs.writeFileSync(f, crypto.randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
  return Buffer.from(fs.readFileSync(f, 'utf8').trim(), 'hex');
}

function encrypt(key, obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return JSON.stringify({ v: 1, iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') });
}
function decrypt(key, text) {
  const j = JSON.parse(text);
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(j.iv, 'base64'));
  d.setAuthTag(Buffer.from(j.tag, 'base64'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(j.data, 'base64')), d.final()]).toString('utf8'));
}

const EMPTY = () => ({ leads: [], events: {}, spend: {} });

function read(root) {
  const f = path.join(dirOf(root), 'leads.enc');
  if (!fs.existsSync(f)) return EMPTY();
  return { ...EMPTY(), ...decrypt(keyOf(root), fs.readFileSync(f, 'utf8')) };
}

/** Runs fn(db) under a lock and saves what it returns (or the mutated db). */
function update(root, fn) {
  const dir = dirOf(root);
  const lock = path.join(dir, '.lock');
  const start = Date.now();
  for (;;) {
    try { fs.mkdirSync(lock); break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 10000) { fs.rmSync(lock, { recursive: true, force: true }); continue; } } catch {}
      if (Date.now() - start > 5000) throw new Error('The lead store is busy; try again.');
      const until = Date.now() + 25; while (Date.now() < until) { /* short wait */ }
    }
  }
  try {
    const db = read(root);
    const result = fn(db);
    const key = keyOf(root);
    const f = path.join(dir, 'leads.enc');
    const tmp = `${f}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, encrypt(key, db), { mode: 0o600 });
    fs.renameSync(tmp, f);
    const backup = path.join(dir, `backup-${today()}.enc`);
    if (!fs.existsSync(backup)) {
      fs.copyFileSync(f, backup);
      const old = fs.readdirSync(dir).filter((x) => /^backup-\d{4}-\d{2}-\d{2}\.enc$/.test(x)).sort().reverse().slice(KEEP_BACKUPS);
      for (const x of old) fs.rmSync(path.join(dir, x), { force: true });
    }
    return result;
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
}

/** { id, org, type } of a referring office (from the Outreach contacts), or null. */
function cleanReferrer(r) {
  if (!r || typeof r !== 'object' || !/^[a-f0-9]{16}$/.test(String(r.id || ''))) return null;
  return { id: r.id, org: clean(r.org, 160), type: clean(r.type, 20) };
}

/** Visitor source as captured by the site (first-party, no IDs): cleaned and size-limited. */
function cleanAttr(raw) {
  let a = {};
  try { a = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw || {}; } catch { a = {}; }
  const out = {};
  for (const [k, max] of [['s', 60], ['m', 60], ['c', 100], ['t', 100], ['k', 100], ['l', 200], ['r', 120], ['p', 200]]) if (a[k]) out[k] = clean(a[k], max);
  if (a.ads) out.ads = clean(a.ads, 20); // 'google' / 'meta' when a click ID was present (the ID itself isn't kept)
  if (a.at && !Number.isNaN(Date.parse(a.at))) out.at = new Date(a.at).toISOString();
  return out;
}

/** Marketing channel for reports, from a web visitor's source or a phone lead's "how did you hear". */
function channel(lead) {
  if ((lead.kind === 'call' || lead.kind === 'text') && !lead.howHeard) return lead.kind === 'call' ? 'Phone call (not asked yet)' : 'Text message (not asked yet)';
  if (lead.kind === 'phone' || lead.kind === 'call' || lead.kind === 'text') {
    const h = lead.howHeard || 'Other';
    if (/facebook|instagram/i.test(h)) return 'Meta ads';
    if (/google ad/i.test(h)) return 'Google ads';
    if (/spanish ad|creole ad/i.test(h)) return 'Meta ads';
    return h === 'Website' ? 'Website (called)' : h;
  }
  const a = lead.attr || {};
  const s = (a.s || '').toLowerCase(), m = (a.m || '').toLowerCase(), r = (a.r || '').toLowerCase();
  const paid = /cpc|ppc|paid|ads?$|display|video/.test(m) || !!a.ads;
  if (/facebook|instagram|^fb$|^ig$|meta/.test(s) || a.ads === 'meta') return paid || a.ads === 'meta' ? 'Meta ads' : 'Social (organic)';
  if (/youtube/.test(s)) return 'YouTube';
  if (/google/.test(s) || a.ads === 'google') return paid ? 'Google ads' : 'Search (organic)';
  if (/radio/.test(s) || /radio/.test(m)) return 'Radio';
  if (/email|newsletter/.test(m) || /email/.test(s)) return 'Email';
  if (s) return s;
  if (/google\.|bing\.|duckduckgo\.|yahoo\./.test(r)) return 'Search (organic)';
  if (/facebook\.|instagram\.|t\.co|twitter\.|tiktok\.|youtube\./.test(r)) return 'Social (organic)';
  if (r) return `Referral: ${r}`;
  return 'Direct / typed in';
}

function addWebLead(root, f) {
  const lead = {
    id: newId(), kind: 'web', createdAt: new Date().toISOString(), type: f.type === 'notify' ? 'notify' : 'appointment',
    branch: clean(f.branch, 40), lang: ['es', 'ht'].includes(f.lang) ? f.lang : 'en',
    name: clean(f.name, 100), phone: clean(f.phone, 20), preferredTime: clean(f.preferred_time, 120),
    accidentDate: /^\d{4}-\d{2}-\d{2}$/.test(f.accident_date || '') ? f.accident_date : '',
    attr: cleanAttr(f.attr), status: 'new', history: [{ status: 'new', by: 'website', at: new Date().toISOString() }], notes: [],
  };
  update(root, (db) => { db.leads.push(lead); });
  return lead;
}

function addPhoneLead(root, body, by) {
  const name = clean(body.name, 100), phone = clean(body.phone, 20);
  if (!name && digits(phone).length < 10) throw Object.assign(new Error('Enter a name or a phone number'), { status: 422 });
  const now = new Date().toISOString();
  const lead = {
    id: newId(), kind: 'phone', createdAt: now, type: 'appointment', branch: clean(body.branch, 40),
    lang: ['es', 'ht'].includes(body.lang) ? body.lang : 'en', name, phone,
    accidentDate: /^\d{4}-\d{2}-\d{2}$/.test(body.accidentDate || '') ? body.accidentDate : '',
    howHeard: HOW_HEARD.includes(body.howHeard) ? body.howHeard : 'Other', campaign: clean(body.campaign, 100),
    referrer: REFERRAL.test(body.howHeard || '') ? cleanReferrer(body.referrer) : null,
    status: STATUSES.includes(body.status) ? body.status : 'contacted',
    history: [{ status: 'new', by, at: now }], notes: body.note ? [{ by, at: now, text: clean(body.note, 1000) }] : [],
  };
  if (lead.status !== 'new') lead.history.push({ status: lead.status, by, at: now });
  update(root, (db) => { db.leads.push(lead); });
  return lead;
}

function changeLead(root, body, by) {
  return update(root, (db) => {
    const l = db.leads.find((x) => x.id === body.id);
    if (!l) throw Object.assign(new Error('Lead not found'), { status: 404 });
    const now = new Date().toISOString();
    if (body.status && body.status !== l.status) {
      if (!STATUSES.includes(body.status)) throw Object.assign(new Error('Unknown status'), { status: 422 });
      l.status = body.status;
      l.history.push({ status: body.status, by, at: now });
    }
    if (body.note) l.notes.push({ by, at: now, text: clean(body.note, 1000) });
    for (const k of ['name', 'phone', 'preferredTime']) if (typeof body[k] === 'string') l[k] = clean(body[k], k === 'preferredTime' ? 120 : 100);
    if (typeof body.howHeard === 'string' && HOW_HEARD.includes(body.howHeard)) l.howHeard = body.howHeard;
    if ('referrer' in body) l.referrer = cleanReferrer(body.referrer);
    if (body.remove === true) { db.leads = db.leads.filter((x) => x.id !== l.id); return { removed: true }; }
    return l;
  });
}

/** Anonymous call-button tap (no IP, no phone): counted per day, channel, campaign, page and language. */
function addEvent(root, body) {
  const type = body.type === 'call' || body.type === 'text' ? body.type : null;
  if (!type) return;
  const attr = cleanAttr(body.attr);
  const fake = { kind: 'web', attr };
  const k = [today(), type, channel(fake), attr.c || '', clean(body.page, 120), ['es', 'ht'].includes(body.lang) ? body.lang : 'en'].join('|');
  update(root, (db) => { db.events[k] = (db.events[k] || 0) + 1; });
}

function setSpend(root, body) {
  const month = String(body.month || '');
  if (!/^\d{4}-\d{2}$/.test(month)) throw Object.assign(new Error('Month must look like 2026-11'), { status: 422 });
  const campaign = clean(body.campaign, 100);
  if (!campaign) throw Object.assign(new Error('Enter the campaign name exactly as in the ad links (utm_campaign)'), { status: 422 });
  const amount = Number(body.amount);
  if (!(amount >= 0)) throw Object.assign(new Error('Amount must be a number'), { status: 422 });
  return update(root, (db) => {
    const k = `${month}|${campaign}`;
    if (amount === 0) delete db.spend[k]; else db.spend[k] = Math.round(amount * 100) / 100;
    return db.spend;
  });
}

const reached = (l) => Math.max(0, ...l.history.map((h) => STAGE[h.status] ?? 0));
const inRange = (iso, from, to) => (!from || iso.slice(0, 10) >= from) && (!to || iso.slice(0, 10) <= to);

function report(root, from, to) {
  const db = read(root);
  const leads = db.leads.filter((l) => inRange(l.createdAt, from, to) && l.type !== 'notify');
  const groups = { channel: {}, campaign: {}, lang: {}, branch: {}, referrer: {} };
  const blank = () => ({ leads: 0, web: 0, phone: 0, text: 0, contacted: 0, booked: 0, showed: 0, patients: 0, calls: 0, texts: 0, spend: 0 });
  const add = (g, key, l) => {
    const r = (groups[g][key] ||= blank());
    r.leads++; r[l.kind === 'text' ? 'text' : l.kind === 'web' ? 'web' : 'phone']++;
    const s = reached(l);
    if (s >= 1) r.contacted++; if (s >= 2) r.booked++; if (s >= 3) r.showed++; if (s >= 4) r.patients++;
  };
  for (const l of leads) {
    add('channel', channel(l), l);
    add('campaign', l.kind === 'web' ? l.attr?.c || '(no campaign)' : l.campaign || '(phone, no campaign)', l);
    add('lang', l.lang || 'en', l);
    add('branch', l.branch || '—', l);
    if (l.referrer?.org) add('referrer', l.referrer.org, l);
  }
  let hidden = 0;
  for (const [k, n] of Object.entries(db.events)) {
    const [day, type, ch, camp, , lang] = k.split('|');
    if (!inRange(day, from, to)) continue;
    if (type.startsWith('connect-')) { hidden += n; continue; } // calls/texts with no caller ID
    const col = type === 'text' ? 'texts' : 'calls';
    (groups.channel[ch] ||= blank())[col] += n;
    (groups.campaign[camp || '(no campaign)'] ||= blank())[col] += n;
    (groups.lang[lang || 'en'] ||= blank())[col] += n;
  }
  // Spend: whole months that overlap the range.
  for (const [k, amt] of Object.entries(db.spend)) {
    const [month, camp] = k.split('|');
    if ((from && `${month}-31` < from) || (to && `${month}-01` > to)) continue;
    (groups.campaign[camp] ||= blank()).spend += amt;
  }
  const totals = blank();
  for (const r of Object.values(groups.channel)) for (const k of Object.keys(totals)) totals[k] += r[k];
  totals.spend = Object.values(groups.campaign).reduce((a, r) => a + r.spend, 0);
  totals.noCallerId = hidden;
  return { from, to, totals, groups, spend: db.spend };
}

function listLeads(root, from, to) {
  const db = read(root);
  return db.leads.filter((l) => inRange(l.createdAt, from, to)).map((l) => ({ ...l, channel: channel(l) })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

const csvCell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
function exportCsv(root, from, to) {
  const rows = [['Received', 'Kind', 'Status', 'Name', 'Phone', 'Location', 'Language', 'Channel', 'Campaign', 'Ad / content', 'Landing page', 'Preferred time', 'Accident date', 'How heard', 'Referred by', 'Notes']];
  for (const l of listLeads(root, from, to)) {
    rows.push([l.createdAt, l.kind, l.status, l.name, l.phone, l.branch, l.lang, l.channel, l.kind === 'web' ? l.attr?.c : l.campaign, l.attr?.t, l.attr?.l, l.preferredTime, l.accidentDate, l.howHeard, l.referrer?.org, (l.notes || []).map((n) => `${n.at.slice(0, 10)} ${n.by}: ${n.text}`).join(' | ')]);
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** Minimal CSV parser (quotes, newlines inside quotes). The separator (comma, semicolon or tab) is the one the header row uses most. */
function parseCsv(text) {
  const first = text.slice(0, text.search(/\r?\n|$/)).replace(/"[^"]*"/g, '');
  const sep = [',', ';', '\t'].map((c) => [c, first.split(c).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

/**
 * Carepatron patient export → marks matching leads "Became a patient". Matches on the last 10 digits of
 * any phone column (headers with phone / mobile / cell, or columns that hold phone numbers). The file is
 * read in memory and not stored. Leads must have come in before the patient record date when one is found.
 */
function matchPatients(root, csvText, by) {
  const rows = parseCsv(String(csvText).replace(/^﻿/, ''));
  if (rows.length < 2) throw Object.assign(new Error('That file has no rows'), { status: 422 });
  const head = rows[0].map((h) => h.trim().toLowerCase());
  let phoneCols = head.map((h, i) => (/phone|mobile|cell|tel/.test(h) ? i : -1)).filter((i) => i >= 0);
  if (!phoneCols.length) {
    phoneCols = head.map((_, i) => i).filter((i) => rows.slice(1, 51).filter((r) => digits(r[i]).length === 10).length >= Math.min(5, rows.length - 1) * 0.6);
  }
  if (!phoneCols.length) throw Object.assign(new Error('No phone column found. The export needs a column with patients’ phone numbers.'), { status: 422 });
  const dateCol = head.findIndex((h) => /created|added|registered|first|start/.test(h) && /date|at|on|visit|appointment|created|added/.test(h));
  const patients = new Map();
  for (const r of rows.slice(1)) {
    const d = dateCol >= 0 && !Number.isNaN(Date.parse(r[dateCol])) ? new Date(r[dateCol]).toISOString() : null;
    for (const i of phoneCols) { const p = digits(r[i]); if (p.length === 10 && !patients.has(p)) patients.set(p, d); }
  }
  const now = new Date().toISOString();
  const result = update(root, (db) => {
    let matched = 0, already = 0;
    for (const l of db.leads) {
      const p = digits(l.phone);
      if (!patients.has(p)) continue;
      const since = patients.get(p);
      if (since && since < l.createdAt.slice(0, 10)) continue; // patient record older than the lead: an existing patient
      if (l.status === 'patient') { already++; continue; }
      l.status = 'patient';
      l.history.push({ status: 'patient', by: `${by} (Carepatron import)`, at: now });
      matched++;
    }
    return { matched, already };
  });
  return { rows: rows.length - 1, phones: patients.size, phoneColumns: phoneCols.map((i) => rows[0][i]), dateColumn: dateCol >= 0 ? rows[0][dateCol] : null, ...result };
}

// ---------- phone system (Amazon Connect) ----------
const RECENT_DAYS = 30; // a caller or texter seen again within this many days updates their lead
function connectSecret(root, rotate = false) {
  const f = path.join(dirOf(root), 'connect.json');
  let s = null;
  try { s = JSON.parse(fs.readFileSync(f, 'utf8')).secret; } catch {}
  if (!s || rotate) {
    s = crypto.randomBytes(32).toString('base64url');
    const tmp = `${f}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ secret: s, createdAt: new Date().toISOString() }) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, f);
  }
  return s;
}
/** Checks X-TI-Timestamp / X-TI-Signature (hex HMAC-SHA256 of "<timestamp>.<body>"), 5-minute window. */
function connectSigned(root, headers, raw) {
  const ts = Number(headers['x-ti-timestamp']), sig = String(headers['x-ti-signature'] || '');
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300 || !/^[a-f0-9]{64}$/.test(sig)) return false;
  const want = crypto.createHmac('sha256', connectSecret(root)).update(`${ts}.`).update(raw).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig));
}

/**
 * One call or text conversation from Amazon Connect (posted by marketing/phone-system/lambda). A new
 * number becomes a lead; a number seen in the last 30 days gets the contact added to its lead. Several
 * posts for one contact (call started, pressed 1 for text, details from the AI agent) merge into one entry.
 * Returns { leadId, isNew, existing } so the call flow can route returning patients differently.
 */
function addConnectEvent(root, ev) {
  const phone = digits(ev.phone);
  const kind = ev.channel === 'text' ? 'text' : 'call';
  const contactId = clean(ev.contactId, 80);
  const now = new Date().toISOString();
  const touch = { at: now, kind, contactId, dialed: clean(ev.dialed, 20), menu: clean(ev.menu, 60), outcome: clean(ev.outcome, 60) };
  if (phone.length < 10) {
    // Blocked / unknown caller ID: nothing to call back, so it's only counted.
    update(root, (db) => { const k = [today(), `connect-${kind}`, 'Unknown caller ID', '', '', ['es', 'ht'].includes(ev.lang) ? ev.lang : 'en'].join('|'); db.events[k] = (db.events[k] || 0) + 1; });
    return { leadId: '', isNew: false, existing: 'none' };
  }
  const name = clean(ev.name, 100), summary = clean(ev.summary, 2000);
  const accidentDate = /^\d{4}-\d{2}-\d{2}$/.test(ev.accidentDate || '') ? ev.accidentDate : '';
  const howHeard = HOW_HEARD.includes(ev.howHeard) ? ev.howHeard : '';
  return update(root, (db) => {
    const since = new Date(Date.now() - RECENT_DAYS * 864e5).toISOString();
    const mine = db.leads.filter((l) => digits(l.phone) === phone);
    const everPatient = mine.some((l) => l.status === 'patient' || (l.history || []).some((h) => h.status === 'patient'));
    let l = mine.filter((x) => x.createdAt >= since || (x.touches || []).some((t) => t.at >= since)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    const isNew = !l;
    if (!l) {
      l = {
        id: newId(), kind, via: 'connect', createdAt: now, type: 'appointment', branch: clean(ev.branch, 40) || 'ocala',
        lang: ['es', 'ht'].includes(ev.lang) ? ev.lang : 'en', name, phone: `(${phone.slice(0, 3)}) ${phone.slice(3, 6)}-${phone.slice(6)}`, accidentDate, howHeard, campaign: '',
        status: 'new', history: [{ status: 'new', by: 'phone system', at: now }], notes: [], touches: [],
      };
      if (everPatient) l.notes.push({ by: 'phone system', at: now, text: 'Returning: this number belongs to an earlier patient.' });
      db.leads.push(l);
    }
    l.touches ||= [];
    const same = contactId && l.touches.find((t) => t.contactId === contactId);
    if (same) {
      for (const k of ['menu', 'outcome', 'dialed']) if (touch[k]) same[k] = touch[k];
      same.updatedAt = now;
    } else l.touches.push(touch);
    if (!l.name && name) l.name = name;
    if (!l.accidentDate && accidentDate) l.accidentDate = accidentDate;
    if (!l.howHeard && howHeard) l.howHeard = howHeard;
    if (ev.lang && ['es', 'ht'].includes(ev.lang) && l.lang === 'en') l.lang = ev.lang;
    if (summary) l.notes.push({ by: kind === 'text' ? 'AI agent (text)' : 'AI agent (call)', at: now, text: summary });
    // Someone already worked this lead to "no answer" and they've now called or texted back: put it back on top.
    if (!isNew && !same && ['noanswer'].includes(l.status)) { l.status = 'new'; l.history.push({ status: 'new', by: `phone system (${kind === 'text' ? 'texted' : 'called'} back)`, at: now }); }
    return { leadId: l.id, isNew, existing: everPatient ? 'patient' : isNew ? 'none' : 'lead' };
  });
}

// ---------- front-desk logins ----------
const usersFile = (root) => path.join(root, 'users.json');
function readUsers(root) { try { return JSON.parse(fs.readFileSync(usersFile(root), 'utf8')).users || []; } catch { return []; } }
function writeUsers(root, users) {
  const f = usersFile(root), tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ users }, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, f);
}
const hash = (pw, salt) => crypto.scryptSync(String(pw), Buffer.from(salt, 'hex'), 32).toString('hex');
function checkUser(root, username, password) {
  const u = readUsers(root).find((x) => x.username.toLowerCase() === String(username).trim().toLowerCase());
  if (!u) return null;
  const ok = crypto.timingSafeEqual(Buffer.from(hash(password, u.salt), 'hex'), Buffer.from(u.hash, 'hex'));
  return ok ? u : null;
}
function saveUser(root, body) {
  const username = clean(body.username, 40).toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw Object.assign(new Error('Username: 3–40 letters, numbers, dots or dashes'), { status: 422 });
  if (String(body.password || '').length < 10) throw Object.assign(new Error('Password must be at least 10 characters'), { status: 422 });
  const users = readUsers(root);
  const salt = crypto.randomBytes(16).toString('hex');
  const existing = users.find((u) => u.username === username);
  const rec = { username, name: clean(body.name, 60) || existing?.name || username, role: 'desk', salt, hash: hash(body.password, salt), createdAt: existing?.createdAt || new Date().toISOString() };
  writeUsers(root, [...users.filter((u) => u.username !== username), rec]);
  return { username, name: rec.name };
}
function removeUser(root, username) { writeUsers(root, readUsers(root).filter((u) => u.username !== String(username).toLowerCase())); }
const listUsers = (root) => readUsers(root).map(({ username, name, role, createdAt }) => ({ username, name, role, createdAt }));

module.exports = { STATUSES, HOW_HEARD, addConnectEvent, connectSecret, connectSigned, addWebLead, addPhoneLead, changeLead, addEvent, setSpend, report, listLeads, exportCsv, matchPatients, parseCsv, checkUser, saveUser, removeUser, listUsers, channel };
