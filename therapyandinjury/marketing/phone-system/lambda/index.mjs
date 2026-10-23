/**
 * Amazon Connect → therapyandinjury.com lead logging, plus the "press 1 to continue by text" message.
 * Runtime: Node.js 20.x or 22.x (the AWS SDK v3 it uses is built into the runtime; no packages to install).
 *
 * Call it from a Connect flow with an "Invoke AWS Lambda function" block. Parameters (all optional):
 *   action    "log" (default) | "sendText"
 *   outcome   what happened: started, transferred, voicemail, after-hours, inbound (a text came in) …
 *   menu      the option pressed, e.g. "1" or "text"
 *   lang      en | es | ht (or set a contact attribute "lang" once, after the language menu)
 *   name, accidentDate (YYYY-MM-DD), howHeard, summary, branch   details the AI agent or a Lex bot gathered
 * Contact attributes with the same names are used too, so a bot can set them as it goes.
 *
 * It returns (as contact attributes you can branch on): leadId, isNew ("true"/"false"),
 * existing ("patient" | "lead" | "none"), textSent ("true"/"false"), logged ("true"/"false").
 * It never throws: if the website is down the call carries on (and the error is in CloudWatch).
 *
 * Environment variables:
 *   SITE_EVENT_URL  https://therapyandinjury.com/api/connect/event   (/_admin → Team → Phone system)
 *   SITE_SECRET     the secret shown there
 *   TEXT_FROM       the texting number's phone number ID or ARN in AWS End User Messaging SMS (or +1… number)
 *   TEXT_CONFIG_SET optional End User Messaging configuration set (for delivery events)
 *
 * The function's role needs sms-voice:SendTextMessage on that number (see README).
 * No patient health details are put in texts: only the greeting below.
 */
import crypto from 'node:crypto';
import { PinpointSMSVoiceV2Client, SendTextMessageCommand } from '@aws-sdk/client-pinpoint-sms-voice-v2';

// The first text after "press 1". Keep it short, name the practice, and keep the opt-out line.
export const FIRST_TEXT = {
  en: 'Therapy & Injury (844-84-TREAT) here. You asked to continue by text. Reply with your name and the date of your accident and we will get you scheduled. Reply STOP to opt out.',
  es: 'Le escribe Therapy & Injury (844-84-TREAT). Pidió continuar por texto. Responda con su nombre y la fecha de su accidente y le daremos una cita. Responda STOP para no recibir más mensajes.',
  ht: 'Se Therapy & Injury (844-84-TREAT). Ou te mande kontinye pa tèks. Reponn ak non w ak dat aksidan an, n ap ba w yon randevou. Reponn STOP pou nou pa voye mesaj ankò.',
};

const sms = new PinpointSMSVoiceV2Client({});
// Swappable for tests.
export const deps = {
  sendText: (to, body, lang) => sms.send(new SendTextMessageCommand({
    DestinationPhoneNumber: to,
    OriginationIdentity: process.env.TEXT_FROM,
    MessageBody: body,
    MessageType: 'TRANSACTIONAL',
    ...(process.env.TEXT_CONFIG_SET ? { ConfigurationSetName: process.env.TEXT_CONFIG_SET } : {}),
    Context: { source: 'connect-press-1', lang },
  })),
  fetch: (...a) => fetch(...a),
};

const pick = (...vals) => vals.find((v) => typeof v === 'string' && v.trim() !== '')?.trim() || '';

async function postToSite(event) {
  const url = process.env.SITE_EVENT_URL, secret = process.env.SITE_SECRET;
  if (!url || !secret) throw new Error('SITE_EVENT_URL and SITE_SECRET must be set');
  const body = JSON.stringify(event);
  const ts = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', secret).update(`${ts}.`).update(body).digest('hex');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3500); // Connect waits at most 8 s for the whole function
  try {
    const r = await deps.fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ti-timestamp': String(ts), 'x-ti-signature': sig }, body, signal: ctrl.signal });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(`site answered HTTP ${r.status} ${j.error || ''}`.trim());
    return j;
  } finally { clearTimeout(timer); }
}

export const handler = async (event) => {
  const cd = event?.Details?.ContactData || {};
  const p = event?.Details?.Parameters || {};
  const at = cd.Attributes || {};
  const action = pick(p.action) || 'log';
  const channel = cd.Channel === 'VOICE' ? 'call' : 'text';
  const phone = pick(cd.CustomerEndpoint?.Address);
  const lang = ['en', 'es', 'ht'].includes(pick(p.lang, at.lang)) ? pick(p.lang, at.lang) : 'en';
  const out = { logged: 'false', textSent: 'false', leadId: '', isNew: 'false', existing: 'none' };

  let outcome = pick(p.outcome) || (channel === 'text' ? 'inbound' : 'started');
  if (action === 'sendText') {
    try {
      if (!/^\+1\d{10}$/.test(phone)) throw new Error('caller number is not a US number');
      await deps.sendText(phone, FIRST_TEXT[lang], lang);
      out.textSent = 'true';
      outcome = 'text-requested';
    } catch (e) {
      console.error('[press-1 text] failed:', e.name || '', e.message);
      outcome = 'text-failed';
    }
  }

  try {
    const r = await postToSite({
      contactId: cd.ContactId || '', channel, phone, dialed: pick(cd.SystemEndpoint?.Address), lang,
      outcome, menu: pick(p.menu, action === 'sendText' ? '1 (text)' : ''),
      name: pick(p.name, at.name), accidentDate: pick(p.accidentDate, at.accidentDate), howHeard: pick(p.howHeard, at.howHeard),
      summary: pick(p.summary), branch: pick(p.branch, at.branch),
    });
    Object.assign(out, { logged: 'true', leadId: r.leadId || '', isNew: String(!!r.isNew), existing: r.existing || 'none' });
  } catch (e) {
    console.error('[lead log] failed:', e.message);
  }
  return out;
};
