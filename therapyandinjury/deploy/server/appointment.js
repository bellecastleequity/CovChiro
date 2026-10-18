'use strict';
/**
 * Appointment requests by plain email (port of the former public/api/appointment.php).
 *
 * Accepts ONLY: branch, type, name, phone, preferred_time, accident_date, consent (+ the "website"
 * honeypot). Never extend it to medical details, insurance numbers, or SSNs. Nothing is stored or logged:
 * each request is emailed to the location's inbox and forgotten.
 *
 * Where requests go: the location's email from the content editor (/_admin → Locations), unless
 * config.json overrides it ("mail": { "recipients": { "ocala": "…" } }). Other mail settings in config.json:
 *   "mail": { "from": "no-reply@therapyandinjury.com", "sendmail": "/usr/sbin/sendmail" }
 * Until a location has a recipient, its requests get 503 and the page tells the visitor to call.
 * Sending uses the server's sendmail (Exim on cPanel), the same path PHP's mail() used.
 */
const { spawn } = require('child_process');
const crypto = require('crypto');

const MAX_BODY = 16 * 1024;
const RATE = { windowMs: 10 * 60 * 1000, max: 6 }; // per IP
const hits = new Map();

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
}

function limited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < RATE.windowMs);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < RATE.windowMs)) hits.delete(k);
  return list.length > RATE.max;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        // Stop buffering, drain the rest, and let the handler answer 413.
        req.removeAllListeners('data');
        req.resume();
        reject(Object.assign(new Error('too large'), { status: 413 }));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// Same cleaning as the PHP version: strip tags, flatten line breaks/tabs, trim, cap length.
const clean = (v, max) => String(v ?? '').replace(/<[^>]*>/g, '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);

const encodeHeader = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);

function sendmail({ bin, from, to, subject, body }) {
  return new Promise((resolve, reject) => {
    const domain = from.split('@')[1] || 'therapyandinjury.com';
    const msg = [
      `From: Therapy & Injury website <${from}>`,
      `To: ${to}`,
      `Subject: ${encodeHeader(subject)}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${crypto.randomUUID()}@${domain}>`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      body,
      '',
    ].join('\r\n');
    const p = spawn(bin, ['-t', '-i', '-f', from], { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('sendmail timed out')); }, 20000);
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`sendmail exited ${code}: ${err.slice(0, 200)}`)); });
    p.stdin.end(msg);
  });
}

const leads = require('./leads.js');

async function handle(req, res, ctx, send) {
  const json = (status, body) => send(res, status, { 'content-type': 'application/json', 'cache-control': 'no-store' }, JSON.stringify(body));
  if (req.method !== 'POST') return json(405, { ok: false, error: 'method' });
  if (limited(clientIp(req))) return json(429, { ok: false, error: 'rate' });

  let raw;
  try { raw = await readBody(req); } catch (e) { return json(e.status || 400, { ok: false, error: 'body' }); }
  const type0 = String(req.headers['content-type'] || '');
  let f;
  if (type0.includes('application/json')) {
    try { f = JSON.parse(raw); } catch { return json(400, { ok: false, error: 'body' }); }
  } else {
    f = Object.fromEntries(new URLSearchParams(raw));
  }

  // Honeypot: real visitors never fill this in.
  if (f.website) return json(200, { ok: true });

  const branch = clean(f.branch, 40).toLowerCase().replace(/[^a-z0-9-]/g, '');
  const type = clean(f.type, 20) === 'notify' ? 'notify' : 'appointment';
  const name = clean(f.name, 100);
  const phone = clean(f.phone, 20);
  const time = clean(f.preferred_time, 120);
  let accident = clean(f.accident_date, 10);
  const consent = f.consent === 'yes';
  const lang = { es: 'Spanish (Español)', ht: 'Haitian Creole (Kreyòl)' }[clean(f.lang, 4)] || '';
  if (!name || phone.replace(/\D/g, '').length < 10 || !consent) return json(422, { ok: false, error: 'validation' });
  if (accident && !/^\d{4}-\d{2}-\d{2}$/.test(accident)) accident = '';

  // Every request is saved to the Leads inbox (/_admin → Leads) before the email goes out, so a mail
  // problem never loses a lead.
  let lead = null;
  try { lead = leads.addWebLead(ctx.root, { ...f, branch, type, name, phone, preferred_time: time, accident_date: accident }); }
  catch (e) { console.error('[appointment] could not save lead:', e.message); }
  const where = lead ? leads.channel(lead) + (lead.attr?.c ? ` · ${lead.attr.c}` : '') : '';

  const mail = ctx.getConfig().mail || {};
  const isEmail = (v) => typeof v === 'string' && /^[^\s@<>,;\[\]]+@[^\s@<>,;\[\]]+\.[^\s@<>,;\[\]]+$/.test(v.trim());
  const location = ctx.live?.()?.branches.find((b) => b.slug === branch);
  const to = [mail.recipients?.[branch], location?.email].find(isEmail)?.trim();
  if (!to) return lead ? done() : json(503, { ok: false, error: 'not_configured' });
  const from = mail.from || 'no-reply@therapyandinjury.com';

  const subject = `${type === 'notify' ? `Opening notification request — ${branch}` : `Appointment request — ${branch}`}${lang ? ` — ${lang.split(' ')[0]}` : ''}`;
  const body = [
    `Type: ${type}`,
    `Location: ${branch}`,
    `Name: ${name}`,
    `Phone: ${phone}`,
    `Preferred time: ${time || '—'}`,
    `Accident date: ${accident || '—'}`,
    ...(lang ? [`Language: ${lang} (sent from the ${lang.split(' ')[0]} page; the visitor may prefer that language)`] : []),
    ...(where ? [`Source: ${where}`] : []),
    'Consent to call/text: yes',
    `Submitted: ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`,
    ...(lead ? ['', 'Update this lead’s status in the Leads inbox: /_admin (Leads tab)'] : []),
  ].join('\n');

  try {
    await sendmail({ bin: mail.sendmail || '/usr/sbin/sendmail', from, to, subject, body });
  } catch (e) {
    console.error('[appointment] send failed:', e.message); // no form data in logs
    if (!lead) return json(500, { ok: false, error: 'send' });
  }
  return done();

  function done() {
  // Non-JS form posts get redirected back with a flag.
  if (!String(req.headers.accept || '').includes('application/json')) {
    const back = f.lang === 'es' || f.lang === 'ht' ? `/${f.lang}/?sent=1#cita` : `/${branch}/?sent=1#request`;
    send(res, 303, { location: back, 'cache-control': 'no-store' });
    return;
  }
  return json(200, { ok: true });
  }
}

module.exports = { handle };
