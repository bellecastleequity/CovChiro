// InjuryCase — single-page front end.
// No inline handlers or styles anywhere (the CSP forbids them): every
// button carries data-act="..." and one delegated listener dispatches it.
// Every dynamic value goes through esc() before it touches innerHTML.
'use strict';
(() => {

const S = { csrf: '', user: null, lookups: null, brand: { name: 'InjuryCase' }, practice: null, contacts: [], caseData: null, caseTab: 'overview', idleTimeout: 900, lastActivity: Date.now() };
const $app = document.getElementById('app');
const $modalHost = document.getElementById('modal-host');

// ---------- utils ----------
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => (n === null || n === undefined || n === '') ? '—' : (Number(n) < 0 ? '-' : '') + '$' + Math.abs(Number(n)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d) => { if (!d) return '—'; const [y, m, dd] = String(d).slice(0, 10).split('-'); return `${+m}/${+dd}/${y}`; };
const today = () => new Date().toLocaleDateString('en-CA');
const daysSince = (d) => d ? Math.round((Date.parse(today()) - Date.parse(String(d).slice(0, 10))) / 86400000) : null;
// 'fin:balances' / 'fin:ledger' / 'fin:settlement' check the financial
// categories this user may see; 'fin:any' = at least one of them.
const fin = (scope) => !!S.user && (S.user.fin || []).includes(scope);
const can = (perm) => !!S.user && (perm.startsWith('fin:') ? (perm === 'fin:any' ? (S.user.fin || []).length > 0 : fin(perm.slice(4))) : S.user.perms.includes(perm));
// Plan features (app/saas.php FEATURES): trials and comped accounts get them all.
const hasFeature = (f) => !!S.practice && (S.practice.features || []).includes(f);
// EOB Genie on its own (no case management): a slimmer app.
const isEobProduct = () => S.practice?.product === 'eob';
const EOB_PRODUCT_NAV = ['eobs', 'cases', 'contacts', 'admin', 'settings', 'billing', 'audit'];
const featureInfo = (f) => S.practice?.featureCatalog?.[f] || { name: f, planName: '' };
function upgradeCardHtml(f) {
  const fi = featureInfo(f);
  const top = !!fi.topTier;
  return `<div class="card upgrade"><span class="chip legal">${esc(fi.planName)} plan${top ? '' : ' & up'}</span><h2 class="mt-sm">${esc(fi.name)}</h2>
    <p class="mt-sm">${esc(fi.blurb || '')}</p>
    <p class="small muted mt-sm">Included in the ${esc(fi.planName)} plan${top ? '' : ' and above'}. Your practice is on ${esc(S.practice?.planName || '')}.</p>
    ${can('users.manage') ? '<a class="btn mt" href="#/billing">See plans</a>' : '<p class="small mt">Ask your practice admin about upgrading.</p>'}</div>`;
}
const label = (map, key) => (S.lookups?.[map]?.[key]) ?? key ?? '—';
const contactName = (c) => c ? [c.organization, c.name].filter(Boolean).join(' — ') : '';
const opt = (value, text, selected) => `<option value="${esc(value)}"${String(selected ?? '') === String(value) ? ' selected' : ''}>${esc(text)}</option>`;

function toast(msg, isError) {
  const t = document.createElement('div');
  t.className = 'toast' + (isError ? ' error' : '');
  t.textContent = msg;
  document.getElementById('toast-host').appendChild(t);
  setTimeout(() => t.remove(), isError ? 6000 : 3000);
}

async function api(path, body, { passive = false } = {}) {
  const headers = { 'X-CSRF-Token': S.csrf };
  if (passive) headers['X-PI-Passive'] = '1';
  const init = { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', headers, cache: 'no-store' };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
  const res = await fetch('api/' + path, init);
  let data = null;
  try { data = await res.json(); } catch { data = { error: 'Unexpected server response' }; }
  if (!passive) S.lastActivity = Date.now();
  if (data && data.csrf) S.csrf = data.csrf;
  if (res.status === 401 && ['auth', 'mfa', 'session_expired', 'pw_change'].includes(data?.code)) {
    lockOut(data.error);
    throw new Error(data.error);
  }
  // Terms changed (or never accepted): back to the acceptance screen.
  if (res.status === 403 && data?.code === 'terms') { api('auth.php?action=session').then(applySession).catch(() => {}); throw new Error(data.error); }
  if (!res.ok) { const err = new Error(data?.error || 'Request failed'); err.data = data; err.status = res.status; throw err; }
  return data;
}

// Wraps an async action with error toasts.
async function attempt(fn) {
  try { return await fn(); } catch (e) { if (!/session|sign in|Not signed in|verification|Password change/i.test(e.message)) toast(e.message, true); return null; }
}

// ---------- modal & forms ----------
function openModal({ title, body, wide = false, okText = 'Save', onOk, extraButtons = '', cancelText = 'Cancel' }) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `<div class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="modal-head"><h2>${esc(title)}</h2></div>
    <div class="modal-body">${body}</div>
    <div class="err" data-role="err"></div>
    <div class="modal-foot">${extraButtons}<span class="spacer"></span><button class="btn ghost" data-close>${esc(cancelText)}</button>${onOk ? `<button class="btn" data-ok>${esc(okText)}</button>` : ''}</div>
  </div>`;
  const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('click', async (e) => {
    if (e.target === wrap || e.target.closest('[data-close]')) close();
    if (e.target.closest('[data-ok]') && onOk) {
      const btn = e.target.closest('[data-ok]');
      btn.disabled = true;
      try { const keep = await onOk(wrap.querySelector('.modal')); if (keep !== false) close(); }
      catch (err) { wrap.querySelector('[data-role=err]').textContent = err.message; }
      finally { btn.disabled = false; }
    }
  });
  $modalHost.appendChild(wrap);
  const first = wrap.querySelector('input:not([type=hidden]),select,textarea');
  if (first) first.focus();
  return { el: wrap.querySelector('.modal'), close };
}

function confirmBox(title, text, okText = 'Confirm') {
  return new Promise((resolve) => {
    const m = openModal({ title, body: `<p>${esc(text)}</p>`, okText, onOk: () => { resolve(true); }, cancelText: 'Cancel' });
    m.el.parentElement.addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target === m.el.parentElement) resolve(false); });
  });
}

// Field defs: {n: name, l: label, t: text|date|number|money|select|textarea|check|contact|user, opts: [[v,label]], ctype: [...], full, req, ph}
function fieldsHtml(defs, values = {}) {
  return `<div class="form-grid">${defs.map((f) => {
    const v = values[f.n] ?? '';
    const id = 'f_' + f.n;
    const cls = f.full || f.t === 'textarea' ? ' class="full"' : '';
    if (f.t === 'check') return `<div${cls}><label class="check"><input type="checkbox" id="${id}" name="${esc(f.n)}"${v && v !== '0' ? ' checked' : ''}> ${esc(f.l)}</label></div>`;
    let input;
    if (f.t === 'textarea') input = `<textarea id="${id}" name="${esc(f.n)}" rows="${f.rows || 3}" placeholder="${esc(f.ph || '')}">${esc(v)}</textarea>`;
    else if (f.t === 'select') input = `<select id="${id}" name="${esc(f.n)}">${f.blank !== false ? opt('', f.blank || '—') : ''}${f.opts.map(([k, t]) => opt(k, t, v)).join('')}</select>`;
    else if (f.t === 'contact') {
      const list = S.contacts.filter((c) => !f.ctype || f.ctype.includes(c.type));
      input = `<select id="${id}" name="${esc(f.n)}">${opt('', '— none —')}${list.map((c) => opt(c.id, contactName(c), v)).join('')}</select>`;
    } else if (f.t === 'user') input = `<select id="${id}" name="${esc(f.n)}">${opt('', '—')}${(S.lookups.providers || []).map((u) => opt(u.id, u.name, v)).join('')}</select>`;
    else {
      const type = f.t === 'money' || f.t === 'number' ? 'number' : (f.t || 'text');
      const step = f.t === 'money' ? ' step="0.01" min="0"' : (f.t === 'number' ? ' step="any"' : '');
      input = `<input type="${type}" id="${id}" name="${esc(f.n)}" value="${esc(v)}"${step} placeholder="${esc(f.ph || '')}"${f.req ? ' required' : ''} autocomplete="off">`;
    }
    return `<div${cls}><label for="${id}">${esc(f.l)}${f.req ? ' *' : ''}</label>${input}</div>`;
  }).join('')}</div>`;
}

function readFields(root, defs) {
  const out = {};
  for (const f of defs) {
    const el = root.querySelector(`[name="${f.n}"]`);
    if (!el) continue;
    out[f.n] = f.t === 'check' ? el.checked : el.value.trim();
    if (f.req && !out[f.n]) throw new Error(`${f.l} is required.`);
  }
  return out;
}

const entries = (obj) => Object.entries(obj || {});

// ---------- auth screens ----------
function authCard(inner, wide) {
  $app.innerHTML = `<div class="auth-wrap"><div class="auth-card${wide ? ' wide' : ''}">
    <a class="brand" href="${S.brand.custom ? '#' : './'}">${brandLogoHtml(false)}<div class="small muted">${esc(S.brand.tagline || '')}</div></a>
    ${inner}</div></div>`;
}

// White label: the practice's color for buttons, links and highlights, and
// its name in the tab title.
function applyBrand() {
  const b = S.brand, root = document.documentElement.style;
  document.title = b.name;
  for (const v of ['--indigo', '--indigo-dark', '--brand', '--brand-dark', '--brand-tint', '--accent-tint']) root.removeProperty(v);
  if (!b.color || !/^#[0-9A-F]{6}$/i.test(b.color)) return;
  const n = parseInt(b.color.slice(1), 16), rgb = [n >> 16, (n >> 8) & 255, n & 255];
  const dark = '#' + rgb.map((c) => Math.round(c * 0.78).toString(16).padStart(2, '0')).join('');
  root.setProperty('--indigo', b.color); root.setProperty('--brand', b.color);
  root.setProperty('--indigo-dark', dark); root.setProperty('--brand-dark', dark);
  root.setProperty('--brand-tint', `rgba(${rgb.join(',')},0.13)`);
}
// The logo for the sign-in card (light) or the sidebar (dark).
function brandLogoHtml(dark) {
  const b = S.brand;
  if (!b.custom) return `<img src="assets/logo-horizontal${dark ? '-dark' : ''}.svg" alt="${esc(b.name)}">`;
  return b.logo ? `<span class="wl-logo${dark ? ' on-dark' : ''}"><img src="${esc(b.logo)}" alt="${esc(b.name)}"></span>` : `<span class="wl-name">${esc(b.name)}</span>`;
}

function showLogin(message) {
  authCard(`<form data-form="login">
    <label for="li-email">Email</label><input id="li-email" type="email" autocomplete="username" required>
    <label for="li-pw">Password</label><input id="li-pw" type="password" autocomplete="current-password" required>
    <div class="err" data-role="err">${esc(message || '')}</div>
    <button class="btn" type="submit">Sign in</button>
    <p class="small">Authorized personnel only. All access to patient records is logged.</p>
    <p class="small hipaa-note"><b>HIPAA-ready</b> · Business Associate Agreement · encrypted · two-factor sign-in</p>
    ${S.brand.custom ? '' : '<p class="auth-switch">New practice? <a href="#signup" data-act="show-signup">Start a free trial</a></p>'}
  </form>`);
  document.getElementById('li-email').focus();
}

async function showSignup() {
  let plans = {}, trialDays = 14;
  try { const r = await api('auth.php?action=plans'); plans = r.plans; trialDays = r.trialDays; } catch { /* plans list is optional */ }
  const hq = new URLSearchParams(location.hash.split('?')[1] || '');
  const wanted = hq.get('plan'), promo = hq.get('promo') || '';
  // From an outreach email: remembered so the signup is credited to it.
  if (/^[a-f0-9]{32}$/.test(hq.get('ref') || '')) { try { sessionStorage.setItem('ic_ref', hq.get('ref')); } catch { /* private mode */ } }
  const genie = wanted === 'eob';
  authCard(`<form data-form="signup">
    ${genie ? '<img src="assets/genie/logo.png" alt="EOB Genie — Insurance EOBs. Explained." class="genie-signup-logo">' : ''}
    <h3>Start your ${trialDays}-day free ${genie ? 'EOB Genie ' : ''}trial</h3>
    <p>${genie ? 'No card needed. Upload your first auto / PIP EOBs in minutes.' : 'No card needed. Set up your practice, then invite your team.'}</p>
    <div class="form-grid">
      <div class="full"><label for="su-practice">Practice name</label><input id="su-practice" required autocomplete="organization"></div>
      <div><label for="su-name">Your name</label><input id="su-name" required autocomplete="name"></div>
      <div><label for="su-email">Work email</label><input id="su-email" type="email" required autocomplete="email"></div>
      <div><label for="su-pw">Password (12+ characters)</label><input id="su-pw" type="password" required autocomplete="new-password"></div>
      <div><label for="su-plan">Plan after trial</label><select id="su-plan">${entries(plans).map(([k, p]) => opt(k, `${p.name}${p.standalone ? ' (on its own)' : ''} — $${p.price}/mo or $${p.annual_price}/yr`, wanted || 'solo')).join('')}</select></div>
      <div class="full"><label for="su-promo">Promo code (optional)</label>
        <div class="promo-row"><input id="su-promo" value="${esc(promo)}" autocomplete="off" autocapitalize="characters" spellcheck="false"><button type="button" class="btn ghost" data-act="promo-check">Apply</button></div>
        <div class="small" id="su-promo-msg" aria-live="polite"></div></div>
    </div>
    <label class="check mt"><input type="checkbox" id="su-accept"> <span>I agree to the <a href="legal.html#terms" target="_blank" rel="noopener">Terms of Service</a> (including automatic renewal of paid plans until canceled and the restrictions on copying or building competing products), the <a href="legal.html#user-agreement" target="_blank" rel="noopener">User Agreement</a> personally, and the <a href="legal.html#baa" target="_blank" rel="noopener">Business Associate Agreement</a> on behalf of my practice, have read the <a href="legal.html#privacy" target="_blank" rel="noopener">Privacy Policy</a>, and understand that InjuryCase is an educational tool — clinical decisions remain with our treating providers.</span></label>
    <div class="err" data-role="err"></div>
    <button class="btn" type="submit">Create practice account</button>
    <p class="auth-switch">Already have an account? <a href="#" data-act="show-login">Sign in</a></p>
  </form>`, true);
  document.getElementById('su-practice').focus();
  if (promo) checkPromo();
}

// Shows what a promo code gives before the account is created.
async function checkPromo() {
  const code = document.getElementById('su-promo').value.trim(), msg = document.getElementById('su-promo-msg');
  if (!code) { msg.textContent = ''; return; }
  try {
    const r = await api('auth.php?action=promo_check&code=' + encodeURIComponent(code) + '&plan=' + encodeURIComponent(document.getElementById('su-plan').value));
    msg.className = 'small ' + (r.valid ? 'promo-ok' : 'promo-bad');
    msg.textContent = r.valid ? `✓ ${r.code}: ${r.summary}` : r.error;
  } catch (e) { msg.className = 'small promo-bad'; msg.textContent = e.message; }
}

function showPasswordChange() {
  authCard(`<form data-form="pwchange">
    <h3>Choose your password</h3>
    <p>At least 12 characters, mixing three of: lowercase, uppercase, numbers, symbols. A short passphrase works well.</p>
    <label for="pc-cur">Current (one-time) password</label><input id="pc-cur" type="password" autocomplete="current-password" required>
    <label for="pc-new">New password</label><input id="pc-new" type="password" autocomplete="new-password" required>
    <label for="pc-new2">Repeat new password</label><input id="pc-new2" type="password" autocomplete="new-password" required>
    <div class="err" data-role="err"></div>
    <button class="btn" type="submit">Save password</button>
  </form>`);
  document.getElementById('pc-cur').focus();
}

async function showMfaSetup() {
  const r = await attempt(() => api('auth.php?action=mfa_setup_start', {}));
  if (!r) return;
  authCard(`<form data-form="mfasetup">
    <h3>Set up two-factor sign-in</h3>
    <p>Scan this with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy), then enter the 6-digit code it shows.</p>
    <div class="qr-box"><canvas id="qr"></canvas></div>
    <div class="secret" title="Manual entry key">${esc(r.secret.replace(/(.{4})/g, '$1 ').trim())}</div>
    <label for="mf-code">6-digit code</label><input id="mf-code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" required>
    <div class="err" data-role="err"></div>
    <button class="btn" type="submit">Verify &amp; continue</button>
  </form>`);
  drawQr(document.getElementById('qr'), r.uri);
  document.getElementById('mf-code').focus();
}

function showMfa() {
  authCard(`<form data-form="mfa">
    <h3>Two-factor verification</h3>
    <p>Enter the 6-digit code from your authenticator app.</p>
    <label for="mf-code">Code</label><input id="mf-code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" required>
    <div class="err" data-role="err"></div>
    <button class="btn" type="submit">Verify</button>
    <p class="small">Lost your phone? Ask an administrator to reset your two-factor.</p>
  </form>`);
  document.getElementById('mf-code').focus();
}

// Every user — the owner and each sub-user — personally accepts the current
// Terms of Service and User Agreement before using the app, signing with
// their typed name.
function showTerms(s) {
  const vendor = S.brand.vendor || 'InjuryCase';
  authCard(`<form data-form="terms" data-version="${esc(s.termsVersion)}">
    <h3>Terms of use</h3>
    <p class="small">Before you continue, please review and accept the ${esc(vendor)} <a href="legal.html#terms" target="_blank" rel="noopener">Terms of Service</a> and <a href="legal.html#user-agreement" target="_blank" rel="noopener">User Agreement</a> (version ${esc(s.termsVersion)}). They apply to you personally, in addition to your practice's agreement. In short:</p>
    <ul class="small terms-points">
      <li>Use the app only for your practice's own patients, with your own login and two-factor.</li>
      <li>The software, its workflows, rules, checklists, templates and screens belong to ${esc(vendor)} and are confidential.</li>
      <li>Don't copy, record, scrape or reverse engineer it, and don't use it — on your own, with others, or by helping anyone else — to build or improve a similar or competing product. This continues for 24 months after your access ends.</li>
      <li>Don't share access or these materials with anyone outside your practice or anyone building a competing product.</li>
      <li>Your activity is logged for security, HIPAA and enforcement of these terms.</li>
    </ul>
    <label class="check mt"><input type="checkbox" id="tm-accept"> I have read and agree to the Terms of Service and User Agreement, including the restrictions on copying and competing products.</label>
    <label for="tm-name" class="mt">Type your full name to sign</label><input id="tm-name" autocomplete="name" maxlength="120" required>
    <div class="err" data-role="err"></div>
    <button class="btn" type="submit">I agree</button>
    <p class="small"><a href="#" data-act="sign-out">Sign out instead</a></p>
  </form>`, true);
  document.getElementById('tm-name').focus();
}

function drawQr(canvas, text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount(), margin = 3, scale = 6, size = (n + margin * 2) * scale;
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#0F1733';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect((c + margin) * scale, (r + margin) * scale, scale, scale);
}

function applySession(s) {
  if (s.brand) S.brand = s.brand;
  if (!s.user && S.signinBrand) S.brand = { ...S.brand, tagline: '', ...S.signinBrand, custom: true };
  applyBrand();
  S.practice = s.practice || null;
  S.idleTimeout = s.idleTimeoutSeconds;
  S.termsVersion = s.termsVersion;
  if (s.step === 'signed_in') {
    S.user = s.user; S.lookups = s.lookups;
    startShell();
  } else {
    S.user = null; S.caseData = null;
    if (s.step === 'signed_out' && location.hash.startsWith('#signup')) showSignup();
    else ({ signed_out: showLogin, password_change: showPasswordChange, mfa_setup: showMfaSetup, mfa: showMfa, terms: () => showTerms(s) })[s.step]?.();
  }
}

// Clears every trace of PHI from the page and returns to sign-in.
function lockOut(message) {
  S.user = null; S.caseData = null; S.contacts = [];
  $modalHost.innerHTML = '';
  if (location.hash) history.replaceState(null, '', location.pathname);
  api('auth.php?action=session').then(applySession).then(() => {
    const err = document.querySelector('[data-role=err]');
    if (err && message) err.textContent = message;
  }).catch(() => showLogin(message));
}

document.addEventListener('submit', async (e) => {
  const form = e.target.closest('[data-form]');
  if (!form) return;
  e.preventDefault();
  const err = form.querySelector('[data-role=err]');
  const btn = form.querySelector('button[type=submit]');
  err.textContent = ''; btn.disabled = true;
  try {
    const kind = form.dataset.form;
    let s;
    if (kind === 'login') s = await api('auth.php?action=login', { email: form.querySelector('#li-email').value, password: form.querySelector('#li-pw').value });
    else if (kind === 'pwchange') {
      const n1 = form.querySelector('#pc-new').value;
      if (n1 !== form.querySelector('#pc-new2').value) throw new Error("The new passwords don't match.");
      s = await api('auth.php?action=change_password', { current: form.querySelector('#pc-cur').value, new: n1 });
    }
    else if (kind === 'signup') {
      if (!form.querySelector('#su-accept').checked) throw new Error('Please accept the Terms, User Agreement and Business Associate Agreement.');
      s = await api('auth.php?action=signup', {
        practice_name: form.querySelector('#su-practice').value, name: form.querySelector('#su-name').value,
        email: form.querySelector('#su-email').value, password: form.querySelector('#su-pw').value,
        plan: form.querySelector('#su-plan').value, promo: form.querySelector('#su-promo').value.trim(), accept: true, ref: (() => { try { return sessionStorage.getItem('ic_ref') || ''; } catch { return ''; } })(),
      });
      history.replaceState(null, '', location.pathname);
    } else if (kind === 'mfasetup') s = await api('auth.php?action=mfa_setup_confirm', { code: form.querySelector('#mf-code').value });
    else if (kind === 'mfa') s = await api('auth.php?action=mfa_verify', { code: form.querySelector('#mf-code').value });
    else if (kind === 'terms') {
      if (!form.querySelector('#tm-accept').checked) throw new Error('Tick the box to accept.');
      s = await api('auth.php?action=accept_terms', { accept: true, name: form.querySelector('#tm-name').value.trim(), version: form.dataset.version });
    }
    applySession(s);
  } catch (ex) {
    if (document.body.contains(err)) err.textContent = ex.message;
  } finally { btn.disabled = false; }
});

// ---------- idle timeout ----------
// The server enforces the timeout; this just warns a minute before and
// wipes the screen when it happens, so PHI doesn't sit on an unattended
// monitor.
let idleWarning = null;
setInterval(async () => {
  if (!S.user) return;
  const idleFor = (Date.now() - S.lastActivity) / 1000;
  if (idleFor > S.idleTimeout - 70 && !idleWarning) {
    idleWarning = openModal({
      title: 'Still there?', okText: 'Stay signed in', cancelText: 'Sign out',
      body: '<p>For patient privacy you will be signed out automatically in about a minute.</p>',
      onOk: async () => { await api('auth.php?action=ping'); idleWarning = null; },
    });
    idleWarning.el.querySelector('[data-close]').addEventListener('click', () => { idleWarning = null; signOut(); });
  }
  if (idleFor > S.idleTimeout) {
    idleWarning = null;
    lockOut('You were signed out after ' + Math.round(S.idleTimeout / 60) + ' minutes of inactivity.');
  }
}, 10000);
['click', 'keydown'].forEach((ev) => document.addEventListener(ev, () => {
  // Local activity resets the client clock; the server's clock is reset by
  // the next real API call.
  if (S.user && !idleWarning) S.lastActivity = Date.now();
}, true));

async function signOut() {
  try { await api('auth.php?action=logout', {}); } catch { /* already gone */ }
  lockOut('You have been signed out.');
}

// ---------- shell & routing ----------
const NAV = [
  ['dashboard', 'Dashboard', 'case.read'], ['huddle', 'Daily huddle', 'case.read'], ['cases', 'Cases', 'case.read'], ['tasks', 'Tasks', 'case.read'],
  ['schedule', 'Appointment upload', 'case.write'], ['ar', 'A/R & settlements', 'fin:balances'], ['eobs', 'EOB Genie', 'fin:balances'], ['contacts', 'Contacts', 'case.read'], ['playbook', 'PI playbook', 'case.read'],
  ['admin', 'Users', 'users.manage'], ['settings', 'Practice settings', 'users.manage'], ['billing', 'Plan & billing', 'users.manage'],
  ['audit', 'Audit log', 'audit.read'], ['platform', 'Practices', 'platform.manage'], ['marketing', 'Marketing', 'platform.manage'],
];

// ---------- locations & providers ----------
// Location filter for the case list, dashboard, huddle and A/R (a per-
// browser preference; people limited to one location are filtered by the
// server regardless). Shown when the practice has more than one location.
const multiLocation = () => (S.lookups?.locations || []).length > 1;
const locationName = (id) => (S.lookups?.locations || []).find((l) => +l.id === +id)?.name || '';
// The locations this person may see (everyone's, unless they're limited).
const myLocations = () => (S.lookups?.locations || []).filter((l) => !S.user?.locationIds || S.user.locationIds.includes(+l.id));
function locFilter() {
  if (!multiLocation() || myLocations().length < 2) return '';
  let v = null;
  try { v = localStorage.getItem('ic.loc'); } catch { /* storage unavailable */ }
  if (v === null) v = S.user?.locationId ? String(S.user.locationId) : '';
  return v === '' || myLocations().some((l) => String(l.id) === v) ? v : '';
}
function setLocFilter(v) { try { localStorage.setItem('ic.loc', v); } catch { /* storage unavailable */ } }
const locQS = () => { const l = locFilter(); return l ? '&location=' + encodeURIComponent(l) : ''; };

// Nav items that are plan features.
const NAV_FEATURE = { huddle: 'huddle', schedule: 'schedule_import', eobs: 'eob_genie' };

// Trial / subscription / BAA notices shown above every page.
function bannerHtml() {
  const p = S.practice;
  if (!p) return '';
  const admin = can('users.manage');
  const cta = admin ? ' <a href="#/billing">Choose a plan</a>' : ' Ask your practice admin.';
  if (p.access === 'read_only') return `<div class="banner danger">Your ${p.status === 'trialing' ? 'free trial has ended' : 'subscription has ended'}. Records are read-only.${cta}</div>`;
  if (p.status === 'past_due') return `<div class="banner warn">Your last payment didn't go through.${admin ? ' <a href="#/billing">Update billing</a>' : ''}</div>`;
  if (admin && !p.baaCurrent) return `<div class="banner warn">Our Terms of Service and Business Associate Agreement have been updated — please review and accept them. <a href="#/settings">Practice settings</a></div>`;
  if (p.status === 'trialing') {
    const extras = (p.trialExtras || []).map((f) => featureInfo(f));
    return `<div class="banner info">${p.trialDaysLeft} day${p.trialDaysLeft === 1 ? '' : 's'} left in your free trial.${extras.length ? ` Your trial includes every feature — ${esc(extras.map((x) => `${x.name} (${x.planName})`).join(', '))} ${extras.length === 1 ? 'needs' : 'need'} a higher plan than ${esc(p.planName)} after the trial.` : ''}${admin ? ' <a href="#/billing">Choose a plan</a>' : ''}</div>`;
  }
  return '';
}

async function refreshSession() {
  const s = await attempt(() => api('auth.php?action=session'));
  if (s && s.step === 'signed_in') {
    S.practice = s.practice; S.lookups = s.lookups; const b = document.getElementById('banner'); if (b) b.innerHTML = bannerHtml();
    // White label can change with the plan or its settings.
    S.brand = s.brand; applyBrand();
    const sb = document.querySelector('.sidebar .brand'); if (sb) sb.innerHTML = `${brandLogoHtml(true)}<small>${esc(S.practice.name)}</small>`;
    // A plan change takes effect at once, so drop the plan tags on nav items it unlocked.
    document.querySelectorAll('.sidebar a[data-nav]').forEach((a) => { const f = NAV_FEATURE[a.dataset.nav]; if (f && hasFeature(f)) a.querySelector('.nav-lock')?.remove(); });
  }
}

async function startShell() {
  const operator = S.user.operator;
  $app.innerHTML = `<div class="shell">
    <nav class="sidebar" aria-label="Main">
      <div class="brand">${brandLogoHtml(true)}<small>${esc(operator ? 'Operator console' : S.practice.name)}</small></div>
      ${!operator && multiLocation() ? (myLocations().length < 2 ? `<div class="loc-switch small">${esc(locationName(S.user.locationId))}</div>`
        : `<select class="loc-switch" id="loc-switch" aria-label="Location">${opt('', S.user.locationIds ? 'All my locations' : 'All locations', locFilter())}${myLocations().map((l) => opt(l.id, l.name, locFilter())).join('')}</select>`) : ''}
      ${NAV.filter(([k, , p]) => can(p) && (!isEobProduct() || EOB_PRODUCT_NAV.includes(k))).map(([k, t]) => `<a href="#/${k}" data-nav="${k}">${esc(isEobProduct() && k === 'cases' ? 'Patients & claims' : t)}${k === 'tasks' ? ' <span class="nav-badge" id="task-badge" hidden></span>' : ''}${NAV_FEATURE[k] && !operator && !hasFeature(NAV_FEATURE[k]) ? ` <span class="nav-lock" title="${esc(featureInfo(NAV_FEATURE[k]).planName)} plan">${esc(featureInfo(NAV_FEATURE[k]).planName)}</span>` : ''}</a>`).join('')}
      <div class="who"><div><strong>${esc(S.user.name)}</strong><br><span class="muted-light">${esc(S.user.role)}</span></div>
        <button class="btn ghost sm" data-act="change-password">Change password</button>
        ${operator || !(hasFeature('email_digest') || hasFeature('task_emails')) ? '' : '<button class="btn ghost sm" data-act="my-notify">Email notifications</button>'}
        ${operator ? '' : '<button class="btn ghost sm" data-act="suggest">Suggest a feature</button>'}
        <button class="btn ghost sm" data-act="sign-out">Sign out</button></div>
    </nav>
    <div class="main-col"><div id="banner">${bannerHtml()}</div><main class="main" id="main"></main>
      <footer class="app-disclaimer">${clinicalNote()} State rules and deadlines are general information, not legal or billing advice. <a href="legal.html#disclaimer" target="_blank" rel="noopener">Disclaimer</a> · <a href="legal.html#terms" target="_blank" rel="noopener">Terms</a> · <a href="legal.html#privacy" target="_blank" rel="noopener">Privacy</a></footer></div>
  </div>`;
  document.getElementById('loc-switch')?.addEventListener('change', (e) => { setLocFilter(e.target.value); route(); });
  if (operator) { if (!location.hash.startsWith('#/platform')) location.hash = '#/platform'; route(); return; }
  await loadContacts();
  route();
}

async function loadContacts() {
  const r = await attempt(() => api('contacts.php?action=list'));
  if (r) S.contacts = r.contacts;
}

window.addEventListener('hashchange', () => { if (S.user) route(); });

function route() {
  const parts = (location.hash.replace(/^#\/?/, '').split('?')[0] || (S.user.operator ? 'platform' : isEobProduct() ? 'eobs' : 'dashboard')).split('/');
  let page = parts[0];
  if (isEobProduct() && !EOB_PRODUCT_NAV.includes(page) && page !== 'case') page = 'eobs';
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === page || (page === 'case' && a.dataset.nav === 'cases')));
  const main = document.getElementById('main');
  if (!main) return;
  main.innerHTML = '<div class="empty">Loading…</div>';
  window.scrollTo(0, 0);
  const pages = { dashboard: pageDashboard, cases: pageCases, case: pageCase, tasks: pageTasks, ar: pageAR, contacts: pageContacts, admin: pageAdmin, audit: pageAudit,
    settings: pageSettings, billing: pageBilling, platform: pagePlatform, playbook: pagePlaybook, huddle: pageHuddle, schedule: pageSchedule, marketing: pageMarketing, eobs: pageEobs };
  (pages[page] || (S.user.operator ? pagePlatform : pageDashboard))(main, parts.slice(1));
  if (!S.user.operator) refreshTaskBadge();
}

const phiBanner = '<div class="phi-banner">Contains protected health information · access is logged</div>';
// Shown wherever the app suggests care: the doctor decides, the app educates.
const clinicalNote = () => `${esc(S.brand.name)} is an educational tool. Its prompts, timelines and suggestions are general guidance, not medical advice — every clinical decision (examination, diagnosis, treatment, referrals, imaging, frequency, MMI and discharge) rests on the treating provider's own professional judgment and discretion for each patient.`;

// ---------- dashboard ----------
async function pageDashboard(main) {
  const d = await attempt(() => api('cases.php?action=dashboard' + locQS()));
  if (!d) return;
  // Reminder once a practice uses appointment uploads and yesterday's is missing.
  if (hasFeature('schedule_import') && can('case.write')) api('schedule.php?action=status', undefined, { passive: true }).then((st) => {
    const box = document.getElementById('sched-reminder');
    if (box && st.behind) box.innerHTML = `<div class="notice">The appointment list for <strong>${esc(fmtDate(st.expectedDate))}</strong> hasn't been uploaded yet, so visits and no-shows since then aren't logged. <a href="#/schedule">Upload it</a></div>`;
  }).catch(() => {});
  const ac = d.alertCounts || {};
  main.innerHTML = `${phiBanner}
    <div class="page-head"><div><h1>Dashboard</h1><div class="sub">${esc(new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }))}</div></div>
      <span class="spacer"></span>${can('case.write') ? '<button class="btn" data-act="new-case">+ New case</button>' : ''}</div>
    <div id="sched-reminder"></div>
    <div class="tiles">
      <div class="tile accent"><div class="k">Open cases</div><div class="v">${d.openCases}</div></div>
      <div class="tile"><div class="k">Actively treating</div><div class="v">${d.activelyTreating}</div></div>
      <div class="tile"><div class="k">Visits this week</div><div class="v">${d.visitsThisWeek}</div></div>
      <div class="tile"><div class="k">New this month</div><div class="v">${d.newThisMonth}</div></div>
      ${d.ar ? `<div class="tile warn"><div class="k">Total outstanding A/R</div><div class="v">${money(d.ar.total)}</div></div>
      <div class="tile"><div class="k">A/R in demand/litigation</div><div class="v">${money(d.ar.legal)}</div></div>` : ''}
    </div>
    ${d.openCases === 0 && can('case.write') ? `<div class="card onboard"><h2>Welcome to ${esc(S.brand.name)} — let's get your practice set up</h2>
      <ol class="mt">
        <li><strong>Add your letterhead.</strong> <a href="#/settings">Practice settings</a> — it goes on every attorney letter.</li>
        <li><strong>Add the attorneys and imaging centers you work with.</strong> <a href="#/contacts">Contacts</a></li>
        <li><strong>Open your first case.</strong> <button class="btn sm" data-act="new-case">+ New case</button></li>
        ${can('users.manage') ? '<li><strong>Invite your team</strong> — each person gets their own login. <a href="#/admin">Users</a></li>' : ''}
        <li><strong>Moving from spreadsheets?</strong> Email your tracking and A/R sheets to <a href="mailto:${esc(S.brand.support)}">${esc(S.brand.support)}</a> and we'll import them.</li>
      </ol></div>` : ''}
    <div class="card"><div class="card-head"><h2>Case pipeline</h2></div>
      <div class="pipeline">${entries(S.lookups.stages).map(([k, t]) => `<button class="pipe" data-act="goto-stage" data-stage="${esc(k)}"><div class="n">${d.byStage[k] || 0}</div><div class="l">${esc(t)}</div></button>`).join('')}</div>
    </div>
    <div class="grid-2 mt">
      <div class="card"><div class="card-head"><h2>Needs attention</h2>
        <span class="badge-count">${ac.high || 0}</span><span class="badge-count med">${ac.medium || 0}</span><span class="badge-count zero">${ac.low || 0}</span>
        <span class="spacer"></span>
        <select id="alert-level" aria-label="Filter alerts"><option value="">All</option><option value="high">Urgent only</option><option value="medium">Urgent + important</option></select></div>
        <ul class="alerts" id="dash-alerts"></ul></div>
      <div>${dashTipsHtml(d)}<div class="card"><div class="card-head"><h2>My tasks (next 7 days)</h2><span class="spacer"></span><a class="small" href="#/tasks">All tasks</a><button class="btn ghost sm" data-act="new-task">+ Task</button></div>
        ${taskListHtml(d.tasks, true, 'Nothing assigned to you this week.')}</div></div>
    </div>
    ${dashMailHtml(d.mailQueue || [])}
    ${dashNarrativesHtml(d.narratives || [])}`;
  let showAll = false;
  const renderAlerts = () => {
    const lvl = document.getElementById('alert-level').value;
    const keep = lvl === 'high' ? ['high'] : lvl === 'medium' ? ['high', 'medium'] : ['high', 'medium', 'low'];
    const matching = d.alerts.filter((a) => keep.includes(a.level));
    const list = showAll ? matching : matching.slice(0, 25);
    document.getElementById('dash-alerts').innerHTML = list.length ? list.map((a) => `<li class="${esc(a.level)}"><span class="dot"></span><div class="grow"><a href="#/case/${a.caseId}" class="who">${esc(a.patient)}</a> <span class="muted small mono">${esc(a.caseNumber)}</span><div>${esc(a.text)}</div></div>
      <button class="btn ghost sm" data-act="task-from-alert" data-case="${a.caseId}" data-text="${esc(a.text)}" title="Make this a task for someone">+ Task</button></li>`).join('')
      : '<li class="empty">Nothing needs attention.</li>';
    if (matching.length > list.length) {
      const more = document.createElement('li');
      more.innerHTML = `<button class="btn ghost sm">Show all ${matching.length}</button>`;
      more.querySelector('button').addEventListener('click', () => { showAll = true; renderAlerts(); });
      document.getElementById('dash-alerts').appendChild(more);
    }
  };
  document.getElementById('alert-level').addEventListener('change', () => { showAll = false; renderAlerts(); });
  // Default to the urgent and important items so the list is workable.
  document.getElementById('alert-level').value = (ac.high || 0) + (ac.medium || 0) > 0 ? 'medium' : '';
  renderAlerts();
}

// Insurer mailings ready to go out with the next outgoing mail, one
// envelope per insurer. Ticking "Mailed" completes the checklist step.
function dashMailHtml(groups) {
  if (!groups.length || !can('case.write')) return '';
  const n = groups.reduce((a, g) => a + g.items.length, 0);
  return `<div class="card mt" id="mail-queue"><div class="card-head"><h2>Mail to insurers</h2><span class="badge-count">${n}</span><span class="spacer"></span><span class="small muted">Send with the next outgoing mail — no need to wait for a batch.</span></div>
    ${groups.map((g) => `<h3 class="mt-sm">${esc(g.insurer)}</h3><ul class="alerts">${g.items.map((i) => `<li class="${i.overdue ? 'high' : 'medium'}"><span class="dot"></span>
      <div class="grow"><a href="#/case/${i.caseId}/checklist" class="who">${esc(i.patient)}</a> <span class="muted small mono">${esc(i.caseNumber)}</span>${i.adjuster ? ` <span class="small muted">· Attn ${esc(i.adjuster)}</span>` : ''}<div>${esc(i.label)}${i.overdue ? ` <span class="small warn-text">(due ${esc(fmtDate(i.due))})</span>` : ''}</div></div>
      ${i.letter ? `<a class="btn ghost sm" href="api/cases.php?action=letter&type=${esc(i.letter)}&id=${i.caseId}" target="_blank" rel="noopener">Letter</a>` : ''}
      <button class="btn ghost sm" data-act="mail-done" data-case="${i.caseId}" data-key="${esc(i.key)}">Mailed</button></li>`).join('')}</ul>`).join('')}</div>`;
}

// Final narratives the attorney requested, with the fee acknowledgment.
function dashNarrativesHtml(list) {
  if (!list.length) return '';
  return `<div class="card mt"><div class="card-head"><h2>Final narratives to prepare</h2><span class="badge-count">${list.length}</span></div>
    <div class="table-wrap"><table><thead><tr><th>Patient</th><th>Report</th><th>Requested</th><th>Due</th><th>Fee</th></tr></thead><tbody>
    ${list.map((n) => `<tr><td><a href="#/case/${n.caseId}">${esc(n.patient)}</a> <span class="muted small mono">${esc(n.caseNumber)}</span></td>
      <td>${n.kind === 'with_ratings' ? 'With AMA ratings' : 'Without ratings'}</td><td>${esc(fmtDate(n.requestedOn))}</td>
      <td class="${n.due && n.due < today() ? 'warn-text' : ''}">${esc(fmtDate(n.due))}</td>
      <td>${!n.hasFee ? '<span class="muted">No charge</span>' : `${n.fee !== null ? esc(money2(n.fee)) + ' · ' : ''}${n.ackAt ? `<span class="ok-text">Acknowledged${n.ackBy ? ' by ' + esc(n.ackBy) : ''} ${esc(fmtDate(n.ackAt.slice(0, 10)))}</span>` : '<span class="warn-text">Not acknowledged</span>'}`}</td></tr>`).join('')}
    </tbody></table></div></div>`;
}

// Tasks rendered anywhere are kept here so a click can open them for editing.
const taskCache = new Map();
function assigneeText(t) {
  return t.assignees.length ? t.assignees.map((a) => a.id == S.user.id ? 'You' : a.name).join(', ') : 'Anyone';
}
// Suggestions across the practice: where care or documentation could be stronger.
function dashTipsHtml(d) {
  if (!d.tips || !d.tips.length) return '';
  const counts = d.tipCounts || {};
  return `<div class="card tips"><div class="card-head"><h2>Suggestions to strengthen cases</h2></div>
    <div class="filters">${Object.entries(TIP_CATS).map(([k, [t, cls]]) => `<span class="chip ${cls}">${esc(t)}: ${counts[k] || 0}</span>`).join('')}</div>
    <ul class="alerts">${d.tips.slice(0, 8).map((t) => `<li><span class="dot ${TIP_CATS[t.category][1]}"></span><div><a href="#/case/${t.caseId}" class="who">${esc(t.patient)}</a> <span class="muted small mono">${esc(t.caseNumber)}</span><div class="small">${esc(t.title)}</div></div></li>`).join('')}</ul>
    ${d.tips.length > 8 ? `<p class="small muted">${d.tips.length - 8} more — open a case to see its suggestions.</p>` : ''}
    <p class="small muted guide-note">Educational prompts only — the treating provider decides what is clinically indicated.</p></div>`;
}

function taskListHtml(tasks, showCase, empty = 'No open tasks.') {
  if (!tasks.length) return `<div class="empty">${esc(empty)}</div>`;
  tasks.forEach((t) => taskCache.set(t.id, t));
  return `<ul class="alerts tasks">${tasks.map((t) => {
    const overdue = !t.done_at && t.due_on && t.due_on < today();
    const dueToday = !t.done_at && t.due_on === today();
    const level = t.done_at ? 'low' : overdue ? 'high' : (t.priority === 'high' || dueToday) ? 'medium' : 'low';
    const when = t.done_at ? `Done ${esc(fmtDate(t.done_at))}${t.done_by_name ? ' by ' + esc(t.done_by_name) : ''}`
      : t.due_on ? `${overdue ? '<span class="chip overdue">Overdue</span> ' : dueToday ? '<span class="chip due">Today</span> ' : ''}Due ${esc(fmtDate(t.due_on))}` : 'No due date';
    return `<li class="${level}${t.done_at ? ' done' : ''}"><input type="checkbox" data-act="task-done" data-id="${t.id}" aria-label="${t.done_at ? 'Reopen task' : 'Mark done'}"${t.done_at ? ' checked' : ''}>
      <div><button class="linklike" data-act="edit-task" data-id="${t.id}">${t.priority === 'high' && !t.done_at ? '<span class="chip red">High</span> ' : ''}${t.done_at ? `<s>${esc(t.title)}</s>` : esc(t.title)}</button>${t.notes ? ' <span class="small muted" title="Has notes">· notes</span>' : ''}
      <div class="small muted">${when}${!t.done_at && (can('case.write') || can('finance.write')) ? ` · <button class="linklike" data-act="push-task" data-id="${t.id}">Push off…</button>` : ''} · <span title="Assigned to">${esc(assigneeText(t))}</span>${showCase && t.case_id ? ` · <a href="#/case/${t.case_id}">${esc(t.patient)}</a>` : ''}${t.created_by_name && t.created_by != S.user.id ? ' · from ' + esc(t.created_by_name) : ''}</div></div></li>`;
  }).join('')}</ul>`;
}

// ---------- daily huddle ----------
// The morning team-meeting sheet: everything outstanding, grouped, with
// space to note who takes each item. Prints cleanly.
const huddleProvider = { value: '' };
async function pageHuddle(main) {
  if (!hasFeature('huddle')) { main.innerHTML = `<div class="page-head"><div><h1>Daily huddle</h1></div></div>${upgradeCardHtml('huddle')}`; return; }
  const r = await attempt(() => api('cases.php?action=huddle' + locQS() + (huddleProvider.value ? '&provider=' + huddleProvider.value : '')));
  if (!r) return;
  const secs = Object.entries(r.sections);
  const total = secs.reduce((n, [, s]) => n + s.items.length, 0);
  const dateText = new Date(r.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  main.innerHTML = `${phiBanner}<div class="page-head"><div><h1>Daily huddle</h1><div class="sub">${esc(r.practice)} · ${esc(dateText)} · ${total} item${total === 1 ? '' : 's'} outstanding</div></div><span class="spacer"></span>
      <select id="hd-provider" aria-label="Provider">${opt('', 'All providers', huddleProvider.value)}${(S.lookups.providers || []).map((u) => opt(u.id, u.name, huddleProvider.value)).join('')}</select>
      <button class="btn ghost" data-act="huddle-print">Print sheet</button></div>
    <div class="huddle-summary">${secs.map(([k, sec]) => `<a href="#h-${k}" class="hs ${sec.items.length ? '' : 'zero'}"><span class="n">${sec.items.length}</span><span class="l">${esc(sec.title)}</span></a>`).join('')}</div>
    ${secs.map(([k, sec]) => `<div class="card huddle-sec" id="h-${k}"><div class="card-head"><h2>${esc(sec.title)}</h2><span class="badge-count${sec.items.length ? '' : ' zero'}">${sec.items.length}</span></div>
      ${sec.items.length ? `<table class="huddle"><thead><tr><th class="hc"></th><th>Patient</th><th>Item</th>${k === 'tasks' ? '<th>Assigned</th>' : ''}<th class="who">Who / notes</th><th class="done">Done</th></tr></thead><tbody>
        ${sec.items.map((i) => `<tr><td class="hc"><span class="dot lv-${esc(i.level)}"></span></td>
          <td class="nowrap">${i.caseId ? `<a href="#/case/${i.caseId}">${esc(i.patient)}</a> <span class="small muted mono">${esc(i.caseNumber)}</span>` : '<span class="muted">—</span>'}</td>
          <td>${esc(i.text)}</td>${k === 'tasks' ? `<td class="small">${esc(i.assignees)}</td>` : ''}<td class="who"></td><td class="done"><span class="box"></span></td></tr>`).join('')}</tbody></table>`
        : '<div class="empty small">Nothing outstanding.</div>'}</div>`).join('')}
    <p class="small muted mt">Thresholds and what's included are set under Practice settings → Daily huddle &amp; email digest.</p>`;
  main.querySelector('#hd-provider').addEventListener('change', (e) => { huddleProvider.value = e.target.value; pageHuddle(main); });
}

async function myNotifyModal() {
  const r = await attempt(() => api('admin.php?action=my_notify'));
  if (!r) return;
  openModal({ title: 'Email notifications', okText: 'Save', body: `
    ${r.hasTaskEmails ? `<h3>Tasks</h3><label class="check mt-sm"><input type="checkbox" id="mn-tasks"${r.tasks ? ' checked' : ''}> Email me when a task I'm on the email list of is marked urgent, goes late or is completed</label>
      <p class="small muted mt-sm">Each task chooses who's emailed (usually the people assigned and whoever created it). Emails never include the task, patient or case.</p>` : ''}
    ${r.hasDigest ? `${r.hasTaskEmails ? '<h3 class="mt">Daily digest</h3>' : ''}<label class="check"><input type="checkbox" id="mn-on"${r.digest ? ' checked' : ''}> Send me a daily digest${r.weekdaysOnly ? ' on weekday mornings' : ' each morning'} at ${esc(r.email)}</label>
    <p class="small muted mt">The email lists how many items need attention under each heading below, with a link to the Daily huddle. It never contains patient names or case details. No email is sent on a day with nothing to report.</p>
    ${r.mailReady ? '' : '<div class="notice">Email sending isn\'t set up on this server yet — your choice is saved for when it is.</div>'}
    <h3 class="mt">Include</h3>
    <div class="mt">${Object.entries(r.available).map(([k, t]) => `<label class="check"><input type="checkbox" data-mn="${k}"${r.criteria.includes(k) ? ' checked' : ''}> ${esc(t)}</label>`).join('') || '<p class="small muted">Your practice hasn\'t turned any criteria on.</p>'}</div>` : (r.mailReady ? '' : '<div class="notice mt">Email sending isn\'t set up on this server yet — your choice is saved for when it is.</div>')}`,
    onOk: async (el) => {
      await api('admin.php?action=my_notify_save', { ...(r.hasDigest ? { digest: el.querySelector('#mn-on').checked, criteria: [...el.querySelectorAll('[data-mn]:checked')].map((x) => x.dataset.mn) } : {}),
        ...(r.hasTaskEmails ? { tasks: el.querySelector('#mn-tasks').checked } : {}) });
      toast('Saved');
    } });
}

// ---------- cases list ----------
let casesState = { stage: 'open', q: '', benefits: '', attorney: '', provider: '', sort: 'patient', dir: 1 };
async function pageCases(main, args) {
  if (args[0] === 'stage' && args[1]) casesState.stage = args[1];
  main.innerHTML = `${phiBanner}<div class="page-head"><div><h1>Cases</h1><div class="sub" id="cases-count"></div></div><span class="spacer"></span>
      ${can('case.write') ? '<button class="btn" data-act="new-case">+ New case</button>' : ''}</div>
    <div class="filters">
      <input type="search" id="cf-q" placeholder="Search name or case #" value="${esc(casesState.q)}" aria-label="Search">
      <select id="cf-stage" aria-label="Stage">${opt('open', 'All open cases', casesState.stage)}${opt('legal', 'Demand / litigation / mediation', casesState.stage)}${opt('all', 'All cases (incl. closed)', casesState.stage)}${entries(S.lookups.stages).map(([k, t]) => opt(k, t, casesState.stage)).join('')}</select>
      <select id="cf-benefits" aria-label="Benefits">${opt('', 'Any benefits')}${entries(S.lookups.benefits).map(([k, t]) => opt(k, t, casesState.benefits)).join('')}</select>
      <select id="cf-atty" aria-label="Attorney">${opt('', 'Any attorney')}${S.contacts.filter((c) => c.type === 'attorney').map((c) => opt(c.id, contactName(c), casesState.attorney)).join('')}</select>
      <select id="cf-provider" aria-label="Provider">${opt('', 'Any provider')}${S.user.role === 'provider' ? opt(S.user.id, 'My cases', casesState.provider) : ''}${(S.lookups.providers || []).filter((u) => +u.id !== +S.user.id || S.user.role !== 'provider').map((u) => opt(u.id, u.name, casesState.provider)).join('')}</select>
    </div>
    <div class="card"><div class="table-wrap" id="cases-table"><div class="empty">Loading…</div></div></div>`;
  let timer;
  const reload = async () => {
    const qs = new URLSearchParams({ action: 'list', stage: casesState.stage === 'all' ? 'all' : casesState.stage, q: casesState.q, benefits: casesState.benefits, attorney: casesState.attorney, provider: casesState.provider });
    const r = await attempt(() => api('cases.php?' + qs + locQS()));
    if (r) renderCasesTable(r.cases);
  };
  main.querySelector('#cf-q').addEventListener('input', (e) => { casesState.q = e.target.value; clearTimeout(timer); timer = setTimeout(reload, 300); });
  [['#cf-stage', 'stage'], ['#cf-benefits', 'benefits'], ['#cf-atty', 'attorney'], ['#cf-provider', 'provider']].forEach(([sel, key]) => main.querySelector(sel).addEventListener('change', (e) => { casesState[key] = e.target.value; reload(); }));
  reload();
}

function renderCasesTable(rows) {
  const cols = [
    ['patient', 'Patient'], ['stage', 'Stage'], ['benefits', 'Benefits'], ['doi', 'DOI'], ['firstVisit', '1st visit'], ['lastVisit', 'Last visit'],
    ['attorney', 'Attorney'], ['lastCorrespondence', 'Last contact'], ...(can('fin:balances') ? [['balance', 'Balance']] : []), ['checklistDone', 'Checklist'], ['alerts', 'Alerts'],
  ];
  const { sort, dir } = casesState;
  rows.sort((a, b) => { const x = a[sort] ?? '', y = b[sort] ?? ''; return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * dir; });
  document.getElementById('cases-count').textContent = `${rows.length} case${rows.length === 1 ? '' : 's'}`;
  const el = document.getElementById('cases-table');
  if (!rows.length) { el.innerHTML = '<div class="empty">No cases match.</div>'; return; }
  el.innerHTML = `<table><thead><tr>${cols.map(([k, t]) => `<th class="sortable${['balance'].includes(k) ? ' num' : ''}" data-act="sort-cases" data-key="${k}">${esc(t)}${sort === k ? (dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr class="click" data-act="open-case" data-id="${r.id}">
      <td><strong>${esc(r.patient)}</strong><div class="small muted mono">${esc(r.caseNumber)}</div></td>
      <td>${stageChip(r.stage)}${r.activelyTreating && ['intake', 'treating'].includes(r.stage) ? '' : ''}</td>
      <td>${r.benefits ? `<span class="chip">${esc(label('benefits', r.benefits))}</span>` : '—'}</td>
      <td class="nowrap">${esc(fmtDate(r.doi))}</td><td class="nowrap">${esc(fmtDate(r.firstVisit))}</td>
      <td class="nowrap">${esc(fmtDate(r.lastVisit))}</td>
      <td>${esc(r.attorney || '—')}</td>
      <td class="nowrap">${esc(fmtDate(r.lastCorrespondence))}</td>
      ${can('fin:balances') ? `<td class="num">${money(r.balance)}</td>` : ''}
      <td class="nowrap">${r.checklistDone}/${r.checklistTotal}</td>
      <td>${r.alerts ? `<span class="badge-count${r.highAlerts ? '' : ' med'}">${r.alerts}</span>` : '<span class="badge-count zero">0</span>'}</td>
    </tr>`).join('')}</tbody></table>`;
  el._rows = rows;
}

function stageChip(stage) {
  const cls = ['litigation', 'mediation', 'demand', 'negotiating'].includes(stage) ? 'legal' : ['closed', 'dropped'].includes(stage) ? '' : stage === 'intake' ? 'info' : stage === 'settled' || stage === 'tx_complete' ? 'settled' : 'teal';
  return `<span class="chip ${cls}">${esc(label('stages', stage))}</span>`;
}

// ---------- new case ----------
const PATIENT_DEFS = [
  { n: 'first_name', l: 'First name', req: true }, { n: 'last_name', l: 'Last name' },
  { n: 'preferred_name', l: 'Preferred name / nickname', ph: 'e.g. Tom' },
  { n: 'dob', l: 'Date of birth', t: 'date' }, { n: 'chart_number', l: 'Chart / account # in your EHR', ph: 'Matches appointment uploads exactly' }, { n: 'phone', l: 'Phone', t: 'tel' },
  { n: 'email', l: 'Email', t: 'email' }, { n: 'address', l: 'Address', full: true },
  { n: 'hipaa_contacts', l: 'Authorized to speak to (HIPAA release)', ph: 'e.g. spouse Maria — 727-555-0100', full: true },
];
const caseDefs = () => [
  { n: 'injury_type', l: 'Case type', t: 'select', blank: false, opts: entries(S.lookups.injuryTypes) },
  { n: 'date_of_injury', l: 'Date of injury (DOI)', t: 'date' },
  { n: 'ehr_case_label', l: 'Case name in your EHR (optional)', ph: 'e.g. Auto 7/20/26 — tells two open cases apart' },
  { n: 'first_visit', l: 'First visit', t: 'date' },
  { n: 'referral_source', l: 'Referral source', t: 'select', opts: [['attorney', 'Attorney'], ['self', 'Self'], ['provider', 'Another provider'], ['other', 'Other']] },
  { n: 'referred_by_contact_id', l: 'Referred by (contact)', t: 'contact' },
  { n: 'referred_by_text', l: 'Referred by (other)', ph: 'e.g. friend, Google' },
  { n: 'attorney_contact_id', l: 'Attorney', t: 'contact', ctype: ['attorney'] },
  { n: 'paralegal', l: 'Paralegal (name, phone / email)', ph: 'e.g. Maria — 305-555-0100' },
  { n: 'provider_user_id', l: 'Treating provider', t: 'user' },
  ...(myLocations().length && (!S.user.locationIds || myLocations().length > 1) ? [{ n: 'location_id', l: 'Location', t: 'select', blank: '—', opts: myLocations().map((l) => [l.id, l.name]) }] : []),
  { n: 'head_injury', l: 'Head injury? (hit head, lost consciousness, concussion symptoms)', t: 'select', blank: false, opts: HEAD_INJURY_OPTS },
  { n: 'initial_care', l: 'Seen since the accident (before our first visit)?', t: 'select', blank: false, opts: [['unknown', 'Not asked yet'], ['none', 'No'], ['doctor', 'Yes — a doctor'], ['urgent_care', 'Yes — urgent care'], ['hospital', 'Yes — hospital / ER']] },
  { n: 'ambulance', l: 'Taken by ambulance?', t: 'select', blank: false, opts: [['unknown', 'Not asked yet'], ['no', 'No'], ['yes', 'Yes']] },
  { n: 'jurisdiction', l: 'State whose rules apply (PIP, deadlines, liens)', t: 'select', blank: "Practice's state", opts: stateOpts() },
];

const HEAD_INJURY_OPTS = [['unknown', 'Not asked yet'], ['yes', 'Yes'], ['no', 'No']];
// State pickers: every state with how well the app's rules cover it.
const stateOpts = () => (S.lookups.states || []).map((st) => [st.code, `${st.name}${st.support === 'basic' ? '' : ' — ' + S.lookups.supportLabels[st.support].toLowerCase()}`]);
const stateName = (code) => (S.lookups.states || []).find((st) => st.code === code)?.name || code;
// Insurance on the new-case form: the usual first payer for the case type.
const NEW_COVERAGE_DEFS = () => [
  { n: 'cov_type', l: 'Insurance', t: 'select', blank: 'None — patient balance / LOP', opts: entries(S.lookups.coverageTypes) },
  { n: 'cov_carrier', l: 'Carrier (from contacts)', t: 'contact', ctype: ['insurer'] },
  { n: 'cov_carrier_text', l: 'Carrier (if not in contacts)' },
  { n: 'cov_claim', l: 'Claim #' }, { n: 'cov_policy', l: 'Policy / member #' }, { n: 'cov_adjuster', l: 'Adjuster' },
  { n: 'cov_auth', l: "Authorized visits (workers' comp)", t: 'number' },
];
const DEFAULT_COVERAGE = { auto: 'pip', slip_fall: '', workers_comp: 'workers_comp', other_pi: '' };
// The case-type picker at the top of a new case: what each type sets up.
const CASE_TYPE_CARDS = [
  ['auto', '🚗', 'Auto accident', 'PIP / no-fault, the state\'s deadlines, attorney and policy limits'],
  ['slip_fall', '⚠', 'Slip & fall', 'Premises liability: incident report, letter of protection, attorney'],
  ['workers_comp', '🏗', "Workers' comp", 'Employer and carrier, authorization and visit limits, status reports'],
  ['other_pi', '✚', 'Other injury', 'Dog bite, assault, product or other liability claim — letter of protection, attorney'],
];
// A patient with their cases, for choosing an existing patient.
function patientCardHtml(pt, chosen) {
  return `<label class="pt-card${chosen ? ' on' : ''}"><input type="radio" name="existing_patient" value="${pt.id}"${chosen ? ' checked' : ''}>
    <span><strong>${esc(pt.name)}</strong> <span class="small muted">${[pt.dob ? 'DOB ' + fmtDate(pt.dob) : '', pt.chartNumber ? 'Chart ' + pt.chartNumber : ''].filter(Boolean).map(esc).join(' · ')}</span>
    <span class="small">${pt.cases.length ? pt.cases.map((c) => `${esc(caseTag(c))} <span class="chip ${c.open ? 'teal' : 'na'}">${esc(label('stages', c.stage))}</span>`).join('<br>') : '<span class="muted">No cases yet</span>'}</span></span></label>`;
}

// New case: for a new patient, or another case for a patient already on
// file (one patient record per person; they may have several open cases).
function newCaseModal(opts = {}) {
  let chosen = opts.patient || null;   // existing patient card
  const m = openModal({
    title: chosen ? 'New case for ' + chosen.name : 'New PI case', wide: true, okText: 'Create case',
    body: `<h3>What kind of case is this?</h3>
      <div class="case-types" role="radiogroup" aria-label="Case type">${CASE_TYPE_CARDS.map(([k, ic, t, dsc], i) => `<label class="case-type${i === 0 ? ' on' : ''}"><input type="radio" name="new_case_type" value="${k}"${i === 0 ? ' checked' : ''}><span class="ct-ic" aria-hidden="true">${ic}</span><strong>${esc(t)}</strong><span class="small muted">${esc(dsc)}</span></label>`).join('')}</div>
      <h3 class="mt">Patient</h3>
      <div class="interval-toggle" role="radiogroup" aria-label="Patient"><button type="button" role="radio" data-pt-mode="new" class="${chosen ? '' : 'on'}">New patient</button><button type="button" role="radio" data-pt-mode="existing" class="${chosen ? 'on' : ''}">Existing patient — another case</button></div>
      <div id="pt-new" class="mt"${chosen ? ' hidden' : ''}>${fieldsHtml(PATIENT_DEFS)}<div id="pt-dupes" class="mt-sm"></div></div>
      <div id="pt-existing" class="mt"${chosen ? '' : ' hidden'}><input type="search" id="pt-search" placeholder="Search by name or chart #" aria-label="Find patient" autocomplete="off">
        <div id="pt-results" class="pt-results mt-sm">${chosen ? patientCardHtml(chosen, true) : '<p class="small muted">Type at least two letters.</p>'}</div></div>
      <h3 class="mt">Case details</h3>${fieldsHtml(caseDefs().filter((f) => f.n !== 'injury_type'))}
      <h3 class="mt">Insurance</h3>${fieldsHtml(NEW_COVERAGE_DEFS(), { cov_type: 'pip' })}
      <p class="small muted mt">Bill insurance first if the patient has it. More coverage (e.g. health insurance) can be added under Financials. Need a new attorney or insurer? Add them under Contacts first.</p>`,
    onOk: async (el) => {
      const cv = readFields(el, NEW_COVERAGE_DEFS());
      const coverage = cv.cov_type ? { type: cv.cov_type, carrier_contact_id: cv.cov_carrier, carrier_text: cv.cov_carrier_text, claim_number: cv.cov_claim,
        policy_number: cv.cov_policy, adjuster: cv.cov_adjuster, authorized_visits: cv.cov_auth } : null;
      const injuryType = el.querySelector('[name=new_case_type]:checked').value;
      const existing = !el.querySelector('#pt-existing').hidden;
      const pick = el.querySelector('[name=existing_patient]:checked');
      if (existing && !pick) throw new Error('Choose the patient, or switch to New patient.');
      let r;
      try {
        r = await api('cases.php?action=create', { ...(existing ? { patient_id: +pick.value } : { patient: readFields(el, PATIENT_DEFS) }), case: { ...readFields(el, caseDefs().filter((f) => f.n !== 'injury_type')), injury_type: injuryType }, coverage });
      } catch (e) {
        // The chart # belongs to a patient already on file: offer them.
        if (e.data?.code === 'existing_patient') { showExisting([e.data.patient], e.data.patient.id); }
        throw e;
      }
      toast('Case ' + r.caseNumber + ' created');
      location.hash = '#/case/' + r.id;
    },
  });
  const box = (id) => m.el.querySelector(id);
  const setMode = (mode) => {
    m.el.querySelectorAll('[data-pt-mode]').forEach((b) => b.classList.toggle('on', b.dataset.ptMode === mode));
    box('#pt-new').hidden = mode !== 'new'; box('#pt-existing').hidden = mode !== 'existing';
  };
  const showExisting = (list, pickId) => { setMode('existing'); box('#pt-results').innerHTML = list.map((pt) => patientCardHtml(pt, pt.id === pickId)).join('') || '<p class="small muted">No patients found.</p>'; };
  m.el.querySelectorAll('[data-pt-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.ptMode)));
  let timer;
  box('#pt-search').addEventListener('input', (e) => {
    clearTimeout(timer);
    const q = e.target.value.trim();
    if (q.length < 2) return;
    timer = setTimeout(async () => { const r = await api('cases.php?action=patient_search&q=' + encodeURIComponent(q)).catch(() => null); if (r) showExisting(r.patients, null); }, 250);
  });
  box('#pt-results').addEventListener('change', () => box('#pt-results').querySelectorAll('.pt-card').forEach((c) => c.classList.toggle('on', c.querySelector('input').checked)));
  // While a new patient is typed in: same chart #, or same name (and DOB), already on file?
  const dupeCheck = async () => {
    const v = readFields(box('#pt-new'), PATIENT_DEFS);
    if (!(v.chart_number || (v.first_name && v.last_name))) { box('#pt-dupes').innerHTML = ''; return; }
    const qs = new URLSearchParams({ first: v.first_name || '', last: v.last_name || '', dob: v.dob || '', chart: v.chart_number || '' });
    const r = await api('cases.php?action=patient_search&' + qs).catch(() => null);
    if (!r) return;
    box('#pt-dupes').innerHTML = r.patients.length ? `<div class="notice"><strong>Already on file?</strong> ${r.patients.map((pt) => `${esc(pt.name)}${pt.match === 'chart' ? ' (same chart #)' : ''} — ${pt.cases.length} case${pt.cases.length === 1 ? '' : 's'} <button type="button" class="btn ghost sm" data-use-patient="${pt.id}">Add this case to them</button>`).join('<br>')}
      <div class="small muted mt-sm">One patient record per person keeps their cases together and appointment uploads accurate.</div></div>` : '';
    box('#pt-dupes').querySelectorAll('[data-use-patient]').forEach((b) => b.addEventListener('click', () => showExisting(r.patients, +b.dataset.usePatient)));
  };
  ['first_name', 'last_name', 'dob', 'chart_number'].forEach((n) => box('#pt-new').querySelector(`[name=${n}]`)?.addEventListener('change', dupeCheck));
  m.el.querySelectorAll('[name=new_case_type]').forEach((r) => r.addEventListener('change', (e) => {
    m.el.querySelectorAll('.case-type').forEach((c) => c.classList.toggle('on', c.contains(e.target)));
    m.el.querySelector('[name=cov_type]').value = DEFAULT_COVERAGE[e.target.value] ?? '';
  }));
  return m;
}

// ---------- case page ----------
const CASE_TABS = [
  ['overview', 'Overview'], ['checklist', 'Checklist'], ['referrals', 'Co-management'], ['visits', 'Visits'], ['outcomes', 'Outcomes'],
  ['correspondence', 'Correspondence'], ['financials', 'Financials', 'fin:any'], ['documents', 'Documents'], ['tasks', 'Tasks'], ['activity', 'Activity'],
];

async function pageCase(main, args) {
  const id = +args[0];
  if (args[1]) S.caseTab = args[1];
  if (!S.caseData || S.caseData.case.id !== id) {
    const d = await attempt(() => api('cases.php?action=get&id=' + id));
    if (!d) { main.innerHTML = '<div class="empty">Case not found.</div>'; return; }
    S.caseData = d;
  }
  renderCase();
}

function renderCase() {
  const main = document.getElementById('main');
  const d = S.caseData, c = d.case, p = d.patient;
  setTimeout(() => maybeShowBasisChange(d), 0);
  // Documents only appears for files stored before uploads were turned off.
  const tabs = CASE_TABS.filter(([k, , perm]) => (!perm || can(perm)) && (k !== 'documents' || d.documents.length) && (!isEobProduct() || ['financials', 'activity'].includes(k)));
  if (!tabs.find(([k]) => k === S.caseTab)) S.caseTab = isEobProduct() ? 'financials' : 'overview';
  const atty = d.contacts.attorney_contact_id;
  // Same phase rule as the server's alerts: intake items matter while in
  // care, discharge items once care has ended.
  const inCare = ['intake', 'treating'].includes(c.stage);
  const overdueCount = d.checklist.filter((i) => i.status === 'overdue' && (i.group === 'At MMI / discharge') !== inCare).length;
  main.innerHTML = `${phiBanner}
    <div class="case-head"><div>
      <div class="small"><a href="#/cases">← All cases</a></div>
      <h1>${esc([p.first_name, p.last_name].filter(Boolean).join(' '))}</h1>
      <div class="meta"><span class="mono small muted">${esc(c.case_number)}</span>
        ${c.benefits ? `<span class="chip">${esc(label('benefits', c.benefits))}</span>` : ''}
        <span class="chip" title="${esc(d.rules.name + ' rules — ' + S.lookups.supportLabels[d.rules.support])}">${esc(d.rules.code)} rules</span>
        ${d.rules.emcRule && c.injury_type === 'auto' ? `<span class="chip ${c.emc_status === 'yes' ? 'teal' : c.emc_status === 'no' ? 'red' : 'ochre'}">EMC: ${esc(c.emc_status)}</span>` : ''}
        ${c.actively_treating == 1 ? '<span class="chip teal">Actively treating</span>' : ''}
        <span class="small muted">DOI ${esc(fmtDate(c.date_of_injury))} · ${d.stats.visitCount} visits · last ${esc(fmtDate(d.stats.lastVisit))}${atty ? ' · ' + esc(contactName(atty)) : ''}${p.chart_number ? ' · chart ' + esc(p.chart_number) : ''}</span>
      </div>
      ${(d.otherCases || []).length ? `<div class="other-cases small">Also: ${d.otherCases.map((o) => `<a href="#/case/${o.id}">${esc(caseTag(o))}</a> <span class="chip ${o.open ? 'teal' : 'na'}">${esc(label('stages', o.stage))}</span>`).join(' · ')}</div>` : ''}
      ${can('case.write') ? '<button class="linklike small" data-act="another-case">+ Another case for this patient</button>' : ''}</div>
      <span class="spacer"></span>
      <div><label for="case-stage">Stage</label><select id="case-stage" data-act-change="stage"${can('case.write') || can('finance.write') ? '' : ' disabled'}>${entries(S.lookups.stages).map(([k, t]) => opt(k, t, c.stage)).join('')}</select></div>
    </div>
    ${d.alerts.length && !isEobProduct() ? `<div class="alert-box"><ul class="alerts">${d.alerts.map((a) => `<li class="${esc(a.level)}"><span class="dot"></span><div class="grow">${esc(a.text)}</div><button class="btn ghost sm" data-act="task-from-alert" data-case="${c.id}" data-text="${esc(a.text)}" title="Make this a task for someone">+ Task</button></li>`).join('')}</ul></div>` : ''}
    <div class="tabs" role="tablist">${tabs.map(([k, t]) => `<button role="tab" data-act="case-tab" data-tab="${k}" class="${S.caseTab === k ? 'active' : ''}">${esc(t)}${k === 'checklist' && overdueCount ? ` <span class="badge-count">${overdueCount}</span>` : ''}</button>`).join('')}</div>
    <div id="case-tab"></div>`;
  main.querySelector('#case-stage').addEventListener('change', async (e) => {
    const r = await attempt(() => api('cases.php?action=update&id=' + c.id, { case: { stage: e.target.value } }));
    if (r) { S.caseData = r; toast('Stage updated'); renderCase(); } else e.target.value = c.stage;
  });
  const tabEl = main.querySelector('#case-tab');
  ({ overview: tabOverview, checklist: tabChecklist, referrals: tabReferrals, visits: tabVisits, outcomes: tabOutcomes, correspondence: tabCorrespondence,
    financials: tabFinancials, documents: tabDocuments, tasks: tabCaseTasks, activity: tabActivity })[S.caseTab](tabEl, d);
}

async function saveChild(table, row, extra = {}) {
  const r = await api('cases.php?action=child_save&id=' + S.caseData.case.id, { table, row, ...extra });
  S.caseData = r;
  renderCase();
  toast('Saved');
}

async function archiveChild(table, childId) {
  if (!await confirmBox('Remove entry', 'Remove this entry? It is archived (kept for the record) rather than permanently deleted.', 'Remove')) return;
  const r = await attempt(() => api('cases.php?action=child_archive&id=' + S.caseData.case.id, { table, child_id: childId }));
  if (r) { S.caseData = r; renderCase(); toast('Removed'); }
}

// --- overview ---
function tabOverview(el, d) {
  const c = d.case, p = d.patient, k = d.contacts;
  const row = (t, v) => `<dt>${esc(t)}</dt><dd>${v === null || v === undefined || v === '' ? '<span class="muted">—</span>' : esc(v)}</dd>`;
  const contactRow = (t, ct) => `<dt>${esc(t)}</dt><dd>${ct ? esc(contactName(ct)) + (ct.phone ? `<div class="small muted">☎ ${esc(ct.phone)}${ct.fax ? ' · fax ' + esc(ct.fax) : ''}</div>` : '') + (ct.email ? `<div class="small"><a href="mailto:${esc(ct.email)}">${esc(ct.email)}</a></div>` : '') : '<span class="muted">—</span>'}</dd>`;
  const provider = (S.lookups.providers || []).find((u) => +u.id === +c.provider_user_id);
  el.innerHTML = `${basisNoticeHtml(d)}${outreachCardHtml(d)}${guideCardHtml(d)}${tipsCardHtml(d)}<div class="grid-2">
    <div class="card"><div class="card-head"><h2>Case</h2><span class="spacer"></span>${can('case.write') ? '<button class="btn ghost sm" data-act="edit-case">Edit</button>' : ''}</div>
      <dl class="kv">
        ${row('Case type', label('injuryTypes', c.injury_type))}
        ${row('Date of injury', fmtDate(c.date_of_injury))}${row('First visit', fmtDate(c.first_visit))}
        ${c.mmi_date ? row('MMI', fmtDate(c.mmi_date) + (c.maintenance_every_days && !c.discharge_date ? ' · maintenance ' + maintenanceLabel(+c.maintenance_every_days) : '')) : ''}${row('Discharged', fmtDate(c.discharge_date))}
        ${row('Treating provider', provider?.name)}${c.location_id ? row('Location', locationName(c.location_id)) : ''}
        ${row('Referral source', c.referral_source)}${contactRow('Referred by', k.referred_by_contact_id)}${c.referred_by_text ? row('Referred by (note)', c.referred_by_text) : ''}
        ${contactRow('Attorney', k.attorney_contact_id)}${c.paralegal ? row('Paralegal', c.paralegal) : ''}${c.case_manager_name || c.case_manager_email ? `<dt>Case manager</dt><dd>${esc(c.case_manager_name || '')}${c.case_manager_email ? `<div class="small"><a href="mailto:${esc(c.case_manager_email)}">${esc(c.case_manager_email)}</a></div>` : ''}</dd>` : ''}
        <dt>Insurance</dt><dd>${(d.coverages || []).length ? d.coverages.map((cv) => `<div>${esc(label('coverageTypes', cv.type))}${cv.carrier_org || cv.carrier_text ? ' — ' + esc(cv.carrier_org || cv.carrier_text) : ''} <span class="chip ${cv.status === 'active' ? 'teal' : 'na'}">${esc(label('coverageStatus', cv.status))}</span>${cv.claim_number ? `<div class="small muted">Claim # ${esc(cv.claim_number)}</div>` : ''}</div>`).join('') : '<span class="muted">None — patient balance / LOP</span>'}</dd>
        <dt>Policy limits</dt><dd>${c.bi_limit || c.um_limit ? `${c.bi_limit ? 'At-fault BI ' + esc(money(c.bi_limit)) : ''}${c.bi_limit && c.um_limit ? ' · ' : ''}${c.um_limit ? 'UM ' + esc(money(c.um_limit)) : ''}${c.limits_source ? `<div class="small muted">${esc(c.limits_source)}${c.limits_noted_on ? ' · ' + esc(fmtDate(c.limits_noted_on)) : ''}</div>` : ''}` : '<span class="muted">Not known yet — ask the attorney</span>'}
          ${can('case.write') || can('finance.write') ? ' <button class="linklike small" data-act="edit-limits">Edit</button>' : ''}</dd>
        ${row('Bills go to', label('benefits', c.benefits))}
        ${d.billingBasis ? `<dt>Billing</dt><dd>${d.billingBasis === 'lop' ? '<span class="chip violet">Letter of protection</span> <span class="small muted">balance held until the case settles</span>' : '<span class="chip teal">Insurance (PIP)</span>'}
          ${can('case.write') ? ` <button class="linklike small" data-act="switch-basis" data-to="${d.billingBasis === 'lop' ? 'insurance' : 'lop'}">${d.billingBasis === 'lop' ? 'Switch to insurance…' : 'Switch to LOP…'}</button>` : ''}</dd>` : ''}
        ${c.injury_type === 'auto' && d.rules.emcRule ? row('EMC determination', c.emc_status + (c.emc_by ? ' · by ' + (S.lookups.emcCredentials[c.emc_by] || c.emc_by) : '') + (c.emc_on ? ' · ' + fmtDate(c.emc_on) : '')) : ''}
        ${c.injury_type === 'auto' && d.rules.tortOptions ? row('Lawsuit option', c.tort_option === 'unknown' ? 'Not asked yet' : d.rules.tortOptions[c.tort_option]) : ''}
        ${row('State rules', d.rules.name + ' · ' + S.lookups.supportLabels[d.rules.support])}
        ${row('LOP signed', c.lop_signed_on ? fmtDate(c.lop_signed_on) + (c.lop_acknowledged_on ? ' · firm acknowledged ' + fmtDate(c.lop_acknowledged_on) : ' · not countersigned') : '')}
        ${c.mediation_on || c.trial_on ? row('Mediation · trial', (fmtDate(c.mediation_on) || '—') + ' · ' + (fmtDate(c.trial_on) || '—')) : ''}
        ${c.settlement_signed_on || c.disbursement_expected_on ? row('Settlement', (c.settlement_signed_on ? 'signed ' + fmtDate(c.settlement_signed_on) : '') + (c.disbursement_expected_on ? (c.settlement_signed_on ? ' · ' : '') + 'check expected ' + fmtDate(c.disbursement_expected_on) : '')) : ''}
        ${c.discharge_date || c.mmi_date || c.narrative_request ? `<dt>Final narrative</dt><dd>${esc(NARRATIVE_LABELS[c.narrative_request] || 'Not asked yet')}${c.narrative_requested_on && ['without_ratings', 'with_ratings'].includes(c.narrative_request) ? ' · requested ' + esc(fmtDate(c.narrative_requested_on)) : ''}${narrFeeLine(c) ? `<br><span class="small ${c.narrative_fee_ack_at ? 'ok-text' : 'warn-text'}">${esc(narrFeeLine(c))}</span>` : ''}${can('case.write') || can('finance.write') ? ' <button class="linklike small" data-act="narrative">Record answer</button>' : ''}</dd>` : ''}
        ${row('Actively treating', c.actively_treating == 1 ? 'Yes' : 'No')}
        ${row('Treatment plan', c.plan_visits_per_week ? `${+c.plan_visits_per_week}x/week${c.plan_set_on ? ' since ' + fmtDate(c.plan_set_on) : ''}` : '')}
        ${row('Head injury', Object.fromEntries(HEAD_INJURY_OPTS)[c.head_injury])}
      </dl></div>
    <div>${caseUpdateCardHtml(d)}${statusCardHtml(d)}
      <div class="card"><div class="card-head"><h2>Patient</h2><span class="spacer"></span>${can('case.write') ? '<button class="btn ghost sm" data-act="edit-patient">Edit</button>' : ''}</div>
        <dl class="kv">${row('Name', [p.first_name, p.last_name].join(' '))}${row('Date of birth', fmtDate(p.dob))}${row('Phone', p.phone)}${row('Email', p.email)}${row('Address', p.address)}</dl></div>
      <div class="card"><div class="card-head"><h2>Case notes</h2><span class="spacer"></span>${can('case.write') ? '<button class="btn ghost sm" data-act="edit-notes">Edit</button>' : ''}</div>
        <div class="small prewrap">${c.notes ? esc(c.notes) : '<span class="muted">No notes.</span>'}</div></div>
      ${stateRulesCardHtml(d)}
      <div class="card"><div class="card-head"><h2>Letters</h2></div>
        <div class="filters"><button class="btn ghost sm" data-act="letter" data-type="status_request">Status update request</button>
        <button class="btn ghost sm" data-act="letter" data-type="attendance">Scheduling help (attendance)</button>
        ${can('export') || can('case.write') ? '<button class="btn ghost sm" data-act="export-file">Export patient file</button>' : ''}
        <button class="btn ghost sm" data-act="eoc-letter">End of treatment / narrative request</button>
        ${fin('balances') ? '<button class="btn ghost sm" data-act="letter" data-type="tx_complete">Treatment complete</button>' : ''}
        ${fin('settlement') ? '<button class="btn ghost sm" data-act="letter" data-type="reduction_response">Reduction response</button>' : ''}
        ${d.rules.demandLetter && fin('ledger') && (d.coverages || []).some((cv) => cv.type === 'pip') ? '<button class="btn ghost sm" data-act="letter" data-type="pip_demand">PIP pre-suit demand (to insurer)</button>' : ''}
        ${d.rules.demandLetter && d.billingBasis === 'insurance' ? '<button class="btn ghost sm" data-act="letter" data-type="treatment_notice">Notice of initiation of treatment (to insurer)</button><button class="btn ghost sm" data-act="letter" data-type="intent_to_bill">Letter of intent to bill (to insurer)</button>' : ''}</div>
        <p class="small muted">Opens a printable letter addressed to the attorney of record (letters marked "to insurer" go to the PIP adjuster). Log it under Correspondence once sent.</p></div>
    </div></div>`;
}

function editCaseModal() {
  const d = S.caseData, c = d.case;
  const defs = [...caseDefs(), { n: 'discharge_date', l: 'Discharge date', t: 'date' },
    ...(d.rules.emcRule && c.injury_type === 'auto' ? [{ n: 'emc_status', l: 'EMC determination', t: 'select', blank: false, opts: [['pending', 'Pending'], ['yes', 'Yes — EMC exists'], ['no', 'No EMC']] },
      { n: 'emc_by', l: 'EMC determined by (MD, DO, dentist, PA or APRN only)', t: 'select', blank: 'Not recorded', opts: entries(S.lookups.emcCredentials) },
      { n: 'emc_on', l: 'EMC determined on', t: 'date' }] : []),
    ...(d.rules.tortOptions && c.injury_type === 'auto' ? [{ n: 'tort_option', l: "Lawsuit (tort) option on the patient's policy", t: 'select', blank: false, opts: [['unknown', 'Not asked yet'], ...entries(d.rules.tortOptions)] }] : []),
    { n: 'plan_visits_per_week', l: 'Treatment plan: visits per week', t: 'select', blank: 'Not set', opts: [['1', '1x/week'], ['1.5', '1–2x/week'], ['2', '2x/week'], ['2.5', '2–3x/week'], ['3', '3x/week'], ['4', '4x/week'], ['5', '5x/week']] },
    { n: 'plan_set_on', l: 'Plan in effect since', t: 'date' },
    { n: 'mediation_on', l: 'Mediation date', t: 'date' }, { n: 'trial_on', l: 'Trial date', t: 'date' },
    { n: 'settlement_signed_on', l: 'Settlement signed on', t: 'date' }, { n: 'disbursement_expected_on', l: 'Attorney expects to mail / disburse by', t: 'date' },
    { n: 'actively_treating', l: 'Actively treating', t: 'check' }];
  openModal({
    title: 'Edit case', wide: true, body: fieldsHtml(defs, { ...c, plan_visits_per_week: c.plan_visits_per_week ? String(+c.plan_visits_per_week) : '', plan_set_on: c.plan_set_on || (c.plan_visits_per_week ? '' : today()) }),
    onOk: async (el) => {
      const vals = readFields(el, defs);
      S.caseData = await api('cases.php?action=update&id=' + c.id, { case: vals });
      renderCase(); toast('Case updated');
    },
  });
}

function editPatientModal() {
  const d = S.caseData;
  openModal({ title: 'Edit patient', body: fieldsHtml(PATIENT_DEFS, d.patient) + ((d.otherCases || []).length ? `<p class="small muted mt">Changes apply to all of this patient's cases (${d.otherCases.length + 1}).</p>` : ''), onOk: async (el) => {
    S.caseData = await api('cases.php?action=update&id=' + d.case.id, { patient: readFields(el, PATIENT_DEFS) });
    renderCase(); toast('Patient updated');
  } });
}

function editNotesModal() {
  const d = S.caseData, defs = [{ n: 'notes', l: 'Notes', t: 'textarea', rows: 10 }];
  openModal({ title: 'Case notes', wide: true, body: fieldsHtml(defs, d.case), onOk: async (el) => {
    S.caseData = await api('cases.php?action=update&id=' + d.case.id, { case: readFields(el, defs) });
    renderCase(); toast('Notes saved');
  } });
}

// --- checklist ---
const STATUS_TEXT = { done: 'Done', na: 'N/A', overdue: 'Overdue', due: 'Due soon', upcoming: 'Upcoming', waiting: 'Not yet', snoozed: 'Pushed off' };
function tabChecklist(el, d) {
  const groups = {};
  d.checklist.forEach((i) => (groups[i.group] = groups[i.group] || []).push(i));
  const editable = can('case.write');
  el.innerHTML = `<div class="card">
    <p class="small muted">Deadlines follow the office protocol: visit 1 paperwork at the first visit, intake items within 48 hours, insurer mailings with the next outgoing mail. Imaging and consult items tick themselves off from the Co-management tab. Your office can turn off steps it doesn't use under Practice settings → Case steps &amp; checklist.</p>
    ${entries(groups).map(([g, items]) => `<div class="checklist-group"><h3>${esc(g)}</h3>${items.map((i) => `
      <div class="check-row" data-key="${esc(i.key)}">
        <div class="lbl">${i.mail ? '<span class="chip mail" title="Mailed to the insurer">✉ Mail</span> ' : ''}${esc(i.label)}${i.custom ? ' <span class="chip">Our step</span>' : ''}${i.detail ? `<small>${esc(i.detail)}</small>` : ''}${i.due ? `<small>Due ${esc(fmtDate(i.due))}${i.snoozedUntil ? ' · pushed to ' + esc(fmtDate(i.snoozedUntil)) : ''}${i.note ? ' · ' + esc(i.note) : ''}</small>` : (i.note ? `<small>${esc(i.note)}</small>` : '')}
          ${i.letter || (editable && ['overdue', 'due', 'upcoming', 'snoozed'].includes(i.status)) ? `<small class="row-actions">${i.letter ? `<a href="api/cases.php?action=letter&type=${esc(i.letter)}&id=${d.case.id}" target="_blank" rel="noopener">Open letter</a>` : ''}${editable && ['overdue', 'due', 'upcoming', 'snoozed'].includes(i.status) ? `<button class="linklike" data-act="push-step" data-key="${esc(i.key)}">Push off…</button>` : ''}</small>` : ''}</div>
        <div><span class="chip ${esc(i.status)}">${esc(STATUS_TEXT[i.status])}</span></div>
        <div>${i.auto ? `<span class="small muted">${i.completedOn ? esc(fmtDate(i.completedOn)) : 'From referrals'}</span>`
          : `<input type="date" value="${esc(i.completedOn || '')}" data-act-change="ms-date" aria-label="Completed on"${editable ? '' : ' disabled'}>`}</div>
        <div><label class="check small"><input type="checkbox" data-act-change="ms-na"${i.status === 'na' ? ' checked' : ''}${editable ? '' : ' disabled'}> N/A</label></div>
      </div>`).join('')}</div>`).join('')}
  </div>`;
  el.querySelectorAll('[data-act-change]').forEach((inp) => inp.addEventListener('change', async () => {
    const row = inp.closest('.check-row');
    const item = d.checklist.find((i) => i.key === row.dataset.key);
    const dateEl = row.querySelector('input[type=date]');
    const body = { key: item.key, completed_on: dateEl ? dateEl.value : item.completedOn, not_applicable: row.querySelector('[data-act-change=ms-na]').checked, note: item.note };
    if (inp.dataset.actChange === 'ms-date' && !body.completed_on) body.completed_on = '';
    // Auto (referral-driven) items only store the N/A flag.
    if (item.auto) body.completed_on = '';
    const r = await attempt(() => api('cases.php?action=milestone&id=' + S.caseData.case.id, body));
    if (r) { S.caseData = r; renderCase(); }
  }));
}


// --- patient outreach: reaching a patient who has missed care ---
// Three attempts without a return visit → ask the attorney/paralegal to
// help (they can usually reach their client), then stop calling until the
// patient comes back. Notes may be requested in the claim: keep them factual.
// Automatic status requests to the attorney / case manager (Gold and up).
// Monthly case update to the attorney / case manager (on by default).
function caseUpdateCardHtml(d) {
  const u = d.caseUpdates, editable = can('case.write') || can('finance.write');
  if (!u) return '';
  const hist = u.history.map((h) => `<li><span>${esc(fmtDate(h.sent_at))} · ${h.kind === 'auto' ? 'automatic' : 'sent by ' + esc(h.sent_by_name || 'hand')} to ${esc(h.sent_to)}</span><span class="small ${h.viewed_at ? '' : 'muted'}">${h.viewed_at ? '✓ Opened ' + esc(fmtDate(h.viewed_at)) : 'Not opened yet'}</span></li>`).join('');
  return `<div class="card status-req"><div class="card-head"><h2>Monthly case update</h2><span class="spacer"></span>
      ${editable && u.practiceOn ? `<label class="check small"><input type="checkbox" data-act-change="case-update-toggle"${u.on ? ' checked' : ''}> Send every 30 days</label>` : ''}</div>
    <p class="small muted">Every 30 days the attorney${u.to.length ? ` (${esc(u.to.join(', '))})` : ''} gets a secure link to a one-page update: appointment history by week, outcome-score progress, referrals made and completed, and a balance snapshot (marked not the official ledger). The email itself has no patient details.</p>
    ${!u.practiceOn ? '<div class="notice">Monthly case updates are turned off for your practice (Practice settings).</div>' : u.problem ? `<div class="notice">${esc(u.problem)}</div>` : u.on && u.nextOn ? `<p class="small">Next update: <strong>${esc(fmtDate(u.nextOn))}</strong>${u.lastOn ? ' · last sent ' + esc(fmtDate(u.lastOn)) : ''}</p>` : ''}
    <div class="badge-row mt-sm"><a class="btn ghost sm" href="api/cases.php?action=case_update_preview&id=${d.case.id}" target="_blank" rel="noopener">Preview</a>${editable && !u.problem ? '<button class="btn ghost sm" data-act="case-update-send">Send now</button>' : ''}</div>
    ${hist ? `<ul class="sr-hist mt-sm">${hist}</ul>` : ''}</div>`;
}

function statusCardHtml(d) {
  const sr = d.statusRequests, editable = can('case.write') || can('finance.write');
  if (!sr) return '';
  if (!sr.available) return `<div class="card status-req"><div class="card-head"><h2>Attorney status requests</h2><span class="chip legal">${esc(featureInfo('auto_status').planName)} plan &amp; up</span></div>
    <p class="small muted">Email the attorney or case manager every 30 days for a case and payment status update, with a one-minute secure reply form that updates this case for you.</p></div>`;
  const hist = sr.history.map((h) => `<li><span>${esc(fmtDate(h.sent_at))} · ${h.kind === 'auto' ? 'automatic' : 'sent by hand'} to ${esc(h.sent_to)}</span>
    <span class="small ${h.responded_at ? '' : 'muted'}">${h.responded_at ? `✓ Replied ${esc(fmtDate(h.responded_at))}${h.repliedBy ? ' by ' + esc(h.repliedBy) : ''}: ${esc(h.status)}` : h.viewed_at ? 'Opened, no reply yet' : 'Not opened yet'}</span></li>`).join('');
  const every = sr.every || sr.defaultEvery;
  return `<div class="card status-req"><div class="card-head"><h2>Attorney status requests</h2><span class="chip ${sr.on && !sr.problem ? 'teal' : 'na'}">${sr.on ? (sr.problem ? 'On — needs attention' : 'Automatic') : 'Off'}</span></div>
    ${sr.on ? `<p class="small">Every ${every} days to ${esc(sr.recipients.join(', ') || S.lookups.statusTo[sr.to])}. ${sr.problem ? '' : `Next: <strong>${esc(sr.nextOn === today() ? 'today' : fmtDate(sr.nextOn))}</strong>${sr.lastOn ? ` · last ${esc(fmtDate(sr.lastOn))}` : ''}. Skipped while the attorney has replied within ${every} days.`}</p>`
      : '<p class="small muted">Turn on to email the attorney or case manager automatically for a case and payment status update. They reply on a secure one-minute form, and the answer updates this case.</p>'}
    ${sr.problem && sr.on ? `<div class="notice mt-sm">${esc(sr.problem)}</div>` : ''}
    ${hist ? `<ul class="status-hist mt-sm">${hist}</ul>` : ''}
    ${editable ? `<div class="badge-row mt-sm"><button class="btn ghost sm" data-act="status-settings">${sr.on ? 'Settings' : 'Set up'}</button>${sr.recipients.length ? '<button class="btn ghost sm" data-act="status-send">Send a request now</button>' : ''}</div>` : ''}
    <p class="small muted mt-sm">The email never includes patient details — only a secure link.</p></div>`;
}

function statusSettingsModal() {
  const d = S.caseData, c = d.case, sr = d.statusRequests;
  const defs = [{ n: 'auto_status', l: `Email automatically every ${sr.every || sr.defaultEvery} days (or the number below)`, t: 'check' },
    { n: 'auto_status_to', l: 'Send to', t: 'select', blank: false, opts: Object.entries(S.lookups.statusTo) },
    { n: 'auto_status_every', l: `Every (days) — blank = practice default (${sr.defaultEvery})`, t: 'number', min: 7, max: 180 },
    { n: 'case_manager_name', l: "Attorney's case manager" }, { n: 'case_manager_email', l: 'Case manager email', t: 'email' }];
  const atty = d.contacts.attorney_contact_id;
  openModal({ title: 'Attorney status requests', okText: 'Save', body: `<p class="small">${atty ? `Attorney: <strong>${esc(contactName(atty))}</strong> — ${atty.email ? esc(atty.email) : '<span class="err">no email on file; add it under Contacts</span>'}` : 'No attorney chosen on this case yet.'}</p>
      ${fieldsHtml(defs, { auto_status: +c.auto_status, auto_status_to: c.auto_status_to, auto_status_every: c.auto_status_every || '', case_manager_name: c.case_manager_name || '', case_manager_email: c.case_manager_email || '' })}
      <p class="small muted mt">They get a short email with a secure link (no patient details in the email). The link shows which client and asks for the case status, upcoming dates, settlement and payment status, and anything they need from you. Their reply is logged under Correspondence, fills in mediation, trial and settlement dates, and creates a task for your team.</p>`,
    onOk: async (el) => {
      const v = readFields(el, defs);
      const r = await api('cases.php?action=update&id=' + c.id, { case: v });
      S.caseData = r; renderCase(); toast('Saved');
    } });
}

function outreachCardHtml(d) {
  const st = d.outreachState;
  const flagged = (d.alerts || []).some((a) => /^(No visit in|Not following the treatment plan|\d+ outreach attempts|Attorney notified)/.test(a.text));
  if (!st || (!flagged && !d.outreach.length && st.state !== 'hold')) return '';
  const msg = {
    none: 'The patient has missed care. Call to get them back on schedule.',
    calling: `Outreach attempt ${st.attempts + 1} of ${st.needed} is next.`,
    notify: `${st.attempts} attempts without a return visit. Ask the attorney or paralegal to help reach the patient, then calls pause.`,
    hold: `Attorney notified ${fmtDate(st.holdOn)}. Calls are paused until the patient attends a visit.`,
    scheduled: 'The patient scheduled an appointment on the last contact.',
  }[st.state];
  const recent = d.outreach.slice(0, 8);
  return `<div class="card outreach st-${esc(st.state)}"><div class="card-head"><h2>Patient outreach</h2><span class="chip ${st.state === 'notify' ? 'overdue' : st.state === 'hold' ? 'legal' : st.state === 'scheduled' ? 'done' : 'due'}">${st.state === 'hold' ? 'Calls paused' : st.state === 'notify' ? 'Notify attorney' : st.attempts + ' of ' + st.needed + ' attempts'}</span>
      <span class="spacer"></span>${st.lastVisit ? `<span class="small muted">Last visit ${esc(fmtDate(st.lastVisit))}</span>` : ''}</div>
    <p>${esc(msg)}</p>
    <div class="filters gs-actions">
      ${st.state !== 'hold' ? '<button class="btn sm" data-act="outreach-log">+ Log outreach attempt</button>' : ''}
      ${st.state === 'notify' ? '<button class="btn sm" data-act="letter" data-type="attendance">Preview letter to attorney</button><button class="btn sm" data-act="outreach-hold">Attorney notified — pause calls</button>' : ''}
      ${['notify', 'hold'].includes(st.state) && can('case.write') && !d.case.discharge_date ? '<button class="btn ghost sm" data-act="end-care">Patient stopped coming — end care…</button>' : ''}
      ${st.state === 'hold' ? '<button class="btn ghost sm" data-act="outreach-resume">Resume calls</button>' : ''}
    </div>
    ${recent.length ? `<table class="small mt-sm"><thead><tr><th>Date</th><th>How</th><th>Outcome</th><th>Note</th><th>By</th></tr></thead><tbody>${recent.map((o) => `<tr><td class="nowrap">${esc(fmtDate(o.attempted_on))}</td><td>${esc(o.method)}</td><td>${esc(d.outreachOutcomes[o.outcome] || o.outcome)}</td><td>${esc(o.notes || '')}</td><td>${esc(o.created_by_name || '')}</td></tr>`).join('')}</tbody></table>` : ''}
  </div>`;
}
function outreachLogModal() {
  const d = S.caseData;
  const defs = [{ n: 'attempted_on', l: 'Date', t: 'date', req: true }, { n: 'method', l: 'How', t: 'select', blank: false, opts: [['call', 'Phone call'], ['text', 'Text message'], ['email', 'Email'], ['letter', 'Letter']] },
    { n: 'outcome', l: 'Outcome', t: 'select', blank: false, opts: Object.entries(d.outreachOutcomes) },
    { n: 'notes', l: 'Note (optional)', t: 'textarea', rows: 2, ph: 'e.g. Left voicemail asking patient to call to schedule.' }];
  openModal({ title: 'Log outreach attempt', okText: 'Save',
    body: fieldsHtml(defs, { attempted_on: today(), method: 'call', outcome: 'no_answer' }) + '<p class="small muted mt-sm">Keep notes to the facts of the contact. Avoid opinions about the patient\'s reasons or condition — these records can be requested by insurers or opposing counsel.</p>',
    onOk: async (el) => { await saveChild('outreach', readFields(el, defs)); toast('Logged'); } });
}
function outreachHoldModal() {
  const c = S.caseData.case;
  const defs = [{ n: 'date', l: 'Attorney / paralegal notified on', t: 'date', req: true },
    { n: 'method', l: 'Sent by', t: 'select', blank: false, opts: [['email', 'Email'], ['fax', 'Fax'], ['phone', 'Phone'], ['mail', 'Mail'], ['portal', 'Portal']] }];
  openModal({ title: 'Attorney notified — pause calls', okText: 'Save',
    body: `<p class="small">${c.paralegal ? 'Paralegal: ' + esc(c.paralegal) + '. ' : ''}This is logged under Correspondence. Calls pause until the patient attends a visit; you can resume them any time.</p>${fieldsHtml(defs, { date: today(), method: 'email' })}`,
    onOk: async (el) => { S.caseData = await api('cases.php?action=outreach_hold&id=' + c.id, readFields(el, defs)); renderCase(); toast('Calls paused'); } });
}

// --- care guide: referral next steps ---
// Plain-language prompts for clinics new to PI: what to refer, when, why.
const GUIDE_CHIPS = {
  done: ['done', 'Done'], now: ['overdue', 'Due now'], consider: ['due', 'Consider'], ask: ['due', 'Question'], upcoming: ['upcoming', 'Coming up'],
  waiting: ['waiting', 'Waiting'], na: ['na', 'Not needed'], dismissed: ['na', 'Not needed'], snoozed: ['upcoming', 'Reminder set'],
};
const GUIDE_REASONS = {
  mri: ['Patient declined', 'MRI already done elsewhere — records requested', 'Not clinically indicated'],
  ortho: ['Patient declined', 'MRI was normal', 'Already under orthopedic care', 'Not clinically indicated'],
  pain_mgmt: ['Fully resolved', 'Improving — continuing conservative care', 'Patient declined', 'Already under pain management'],
  neuro: ['No head injury', 'Patient declined', 'Already seeing a neurologist'],
  emc: ['PIP not involved', 'Determined elsewhere — records requested', 'Patient declined'],
};
const REF_STEPS = [['ordered', 'Ordered'], ['scheduled', 'Scheduled'], ['completed', 'Completed'], ['report_received', 'Report in']];
function refProgressHtml(r) {
  const at = REF_STEPS.findIndex(([k]) => k === r.status);
  return `<div class="ref-progress"><button class="linklike small" data-act="edit-referral" data-id="${r.id}">${esc(label('referralTypes', r.type))}${r.body_region ? ' · ' + esc(r.body_region) : ''}</button>
    ${r.status === 'no_show' ? '<span class="chip overdue">No-show — reschedule</span>' : `<ol class="steps">${REF_STEPS.map(([, t], i) => `<li class="${i <= at ? 'on' : ''}">${t}</li>`).join('')}</ol>`}</div>`;
}
// The order of the steps still to do, while reordering (else null).
const guideReorder = { keys: null };
function guideCardHtml(d) {
  if (!d.guide) return '';
  const w = can('case.write'), cw = can('clinical.write');
  const open = d.guide.filter((g) => ['now', 'consider', 'ask'].includes(g.status)).length;
  const reorder = guideReorder.keys && w;
  // While reordering, the movable steps follow the order being edited.
  let steps = d.guide;
  if (reorder) {
    const movable = d.guide.filter((g) => g.movable), byKey = Object.fromEntries(movable.map((g) => [g.key, g]));
    const ordered = guideReorder.keys.map((k) => byKey[k]).filter(Boolean);
    let i = 0;
    steps = d.guide.map((g) => (g.movable ? ordered[i++] : g));
  }
  const firstNext = steps.findIndex((g) => g.status !== 'done');
  const movableKeys = steps.filter((g) => g.movable).map((g) => g.key);
  return `<div class="card guide"><div class="card-head"><h2>Next steps</h2>
      <span class="small muted">${open ? `${open} need${open === 1 ? 's' : ''} attention` : 'On track'}${d.guideOrder?.case ? ' · your order for this case' : d.guideOrder?.practice ? " · your practice's order" : ''}</span><span class="spacer"></span>
      ${w && movableKeys.length > 1 ? (reorder ? '' : '<button class="btn ghost sm" data-act="guide-reorder">Reorder</button>') : ''}<a class="small" href="#/playbook">How PI cases work</a></div>
    ${reorder ? `<div class="notice mt-sm">Move the steps still to do into the order your office follows. Done steps stay in the order they happened.
      <div class="badge-row mt-sm"><button class="btn sm" data-act="guide-order-save" data-scope="case">Save for this case</button>${can('users.manage') ? '<button class="btn ghost sm" data-act="guide-order-save" data-scope="practice">Save as our order for every case</button>' : ''}
        ${d.guideOrder?.case ? '<button class="btn ghost sm" data-act="guide-order-save" data-scope="reset">Back to the practice order</button>' : ''}<button class="btn ghost sm" data-act="guide-reorder-cancel">Cancel</button></div></div>` : ''}
    <ol class="guide-steps">${steps.map((g, idx) => {
      if (g.kind === 'event') return `${idx === 0 ? '<li class="gs-divider small muted">Done so far</li>' : ''}<li class="gs-done gs-event"><div class="gs-head"><span class="chip done">Done</span> <strong>${esc(g.title)}</strong> <span class="small muted">${esc(g.text)}</span></div></li>`;
      const divider = idx === 0 && g.status === 'done' ? '<li class="gs-divider small muted">Done so far</li>' : idx === firstNext && idx > 0 ? '<li class="gs-divider small muted">Next</li>' : '';
      const mi = movableKeys.indexOf(g.key);
      const mover = reorder && g.movable ? `<span class="gs-move"><button class="btn ghost sm" data-act="guide-move" data-key="${g.key}" data-d="-1"${mi === 0 ? ' disabled' : ''} aria-label="Move ${esc(g.title)} up">↑</button><button class="btn ghost sm" data-act="guide-move" data-key="${g.key}" data-d="1"${mi === movableKeys.length - 1 ? ' disabled' : ''} aria-label="Move ${esc(g.title)} down">↓</button></span>` : '';
      const [cls, txt] = GUIDE_CHIPS[g.status];
      const act = [];
      const openish = ['now', 'consider', 'upcoming', 'waiting', 'ask'].includes(g.status);
      if (g.status === 'ask' && w) act.push(`<button class="btn sm" data-act="head-injury" data-v="yes">Yes, head injury</button><button class="btn ghost sm" data-act="head-injury" data-v="no">No head injury</button>`);
      if (g.kind === 'referral' && openish && g.status !== 'ask' && cw) act.push(`<button class="btn sm${g.status === 'now' || g.status === 'consider' ? '' : ' ghost'}" data-act="guide-refer" data-type="${g.types[0]}">Add ${esc(label('referralTypes', g.types[0]))} referral</button>`);
      if (g.kind === 'referral' && g.status === 'done' && cw) act.push(`<button class="btn ghost sm" data-act="guide-refer" data-type="${g.types[0]}">+ Another</button>`);
      if (g.kind === 'emc' && (openish || (g.status === 'done' && d.case.emc_status === 'pending'))) {
        if (w) act.push(`<span class="small muted">${g.status === 'done' ? 'Result:' : 'Done in house:'}</span><button class="btn sm${g.status === 'done' ? ' ghost' : ''}" data-act="emc-result" data-v="yes">EMC exists</button><button class="btn ghost sm" data-act="emc-result" data-v="no">No EMC</button>`);
        if (openish && cw) act.push(`<button class="btn ghost sm" data-act="guide-refer" data-type="emc">Refer out for EMC</button>`);
      }
      if (g.kind === 'visit' && openish && cw) act.push(`<button class="btn sm${g.status === 'now' ? '' : ' ghost'}" data-act="guide-visit" data-type="${g.visitType}">${g.visitType === 'maintenance' ? 'Log maintenance visit' : 'Log re-exam'}</button>`);
      if (g.kind === 'mmi' && cw) {
        const maint = d.case.mmi_date && d.case.maintenance_every_days && !d.case.discharge_date;
        if (openish) act.push(`<button class="btn ghost sm" data-act="mmi" data-plan="">Reached MMI…</button>`);
        else if (maint) act.push(`<button class="btn ghost sm" data-act="mmi" data-plan="maintenance">Change frequency</button><button class="btn ghost sm" data-act="mmi" data-plan="discharge">End maintenance — discharge</button>`);
        else if (d.case.discharge_date) act.push(`<button class="btn ghost sm" data-act="mmi" data-plan="maintenance">Start a maintenance plan</button>`);
      }
      if (['now', 'consider', 'ask'].includes(g.status) && w) act.push(`<button class="btn ghost sm" data-act="push-guide" data-step="${g.key}">Push off…</button>`);
      if (openish && g.kind !== 'visit' && w) act.push(`<button class="btn ghost sm" data-act="guide-dismiss" data-step="${g.key}">Not needed…</button>`);
      if (['dismissed', 'snoozed'].includes(g.status) && w) act.push(`<button class="btn ghost sm" data-act="guide-clear" data-step="${g.key}">Undo</button>`);
      if (g.key === 'neuro' && g.status === 'na' && d.case.head_injury === 'no' && w) act.push(`<button class="btn ghost sm" data-act="head-injury" data-v="unknown">Change answer</button>`);
      if (['now', 'consider'].includes(g.status)) act.push(`<button class="btn ghost sm" data-act="task-from-alert" data-case="${d.case.id}" data-text="${esc(g.title + ': ' + g.text)}">+ Task</button>`);
      if (g.kind === 'mmi' && w && !['done', 'na', 'dismissed'].includes(g.status)) act.push('<button class="btn ghost sm" data-act="end-care">Patient stopped coming…</button>');
      if (g.kind === 'mmi' && w && d.case.discharge_date && !d.case.mmi_date) act.push('<button class="btn ghost sm" data-act="resume-care">Patient came back — resume care</button>');
      if (reorder) act.length = 0;
      return `${divider}<li class="gs-${esc(g.status)}"><div class="gs-head">${mover}<span class="chip ${cls}">${txt}</span> <strong>${esc(g.title)}</strong> <span class="small muted">${esc(g.when)}</span></div>
        <div class="gs-body">${g.text ? `<div>${esc(g.text)}</div>` : ''}
          ${g.referrals.map(refProgressHtml).join('')}
          <details class="small"><summary>Why this matters</summary><p class="muted">${esc(g.why)}</p></details>
          ${act.length ? `<div class="filters gs-actions">${act.join('')}</div>` : ''}</div></li>`;
    }).join('')}</ol>
    <p class="small muted guide-note">Educational guidance only: the treating provider decides whether each step is clinically appropriate for this patient, and may skip, delay or change any of them.</p>
    <p class="small muted">Need something else — a second MRI, another opinion, EMG, dental/TMJ? Add it any time on the <button class="linklike" data-act="case-tab" data-tab="referrals">Co-management</button> tab.</p></div>`;
}

const MAINT_FREQ = [[7, 'Weekly'], [14, 'Every 2 weeks'], [21, 'Every 3 weeks'], [30, 'Monthly (1x per month)'], [42, 'Every 6 weeks'], [60, 'Every 2 months'], [90, 'Every 3 months']];
const maintenanceLabel = (days) => (MAINT_FREQ.find(([n]) => n === days)?.[1] || `every ${days} days`).replace(/ \(.*\)$/, '').replace(/^./, (x) => x.toLowerCase());
// At MMI: discharge, or a maintenance plan at a frequency the doctor sets.
function mmiModal(plan) {
  const c = S.caseData.case;
  const maint = c.mmi_date && c.maintenance_every_days && !c.discharge_date;
  const every = +c.maintenance_every_days || 30;
  const known = MAINT_FREQ.some(([n]) => n === every);
  const title = plan === 'discharge' ? 'End maintenance — discharge' : maint ? 'Maintenance frequency' : plan === 'maintenance' ? 'Start a maintenance plan' : 'Reached MMI';
  const m = openModal({ title, okText: 'Save', body: `
    ${!plan ? `<p class="small">The patient has improved as much as active treatment is expected to help. Do the final exam and outcome assessments, then choose what happens next.</p>
      <label class="check mt"><input type="radio" name="mmi-plan" value="discharge"> <span><strong>Discharge</strong> <span class="small muted">— care is complete</span></span></label>
      <label class="check"><input type="radio" name="mmi-plan" value="maintenance" checked> <span><strong>Maintenance plan</strong> <span class="small muted">— periodic visits to keep the improvement</span></span></label>` : ''}
    <div class="form-grid mt">
      <div><label for="mmi-date">${plan === 'discharge' ? 'Discharge date' : maint ? 'Effective' : 'MMI date'}</label><input type="date" id="mmi-date" value="${today()}"></div>
      <div id="mmi-freq-box"${plan === 'discharge' ? ' hidden' : ''}><label for="mmi-freq">How often (doctor's call)</label><select id="mmi-freq">${MAINT_FREQ.map(([n, t]) => opt(n, t, known ? every : '')).join('')}${opt('custom', 'Other…', known ? '' : 'custom')}</select>
        <input type="number" id="mmi-days" min="7" max="180" placeholder="Every … days" value="${known ? '' : every}"${known ? ' hidden' : ''} class="mt"></div>
    </div>
    ${plan !== 'discharge' ? '<p class="small muted mt">Maintenance visits are prompted at this frequency until you log a final discharge.</p>' : '<p class="small muted mt">Logs a discharge visit on this date.</p>'}`,
    onOk: async (el) => {
      const chosen = plan || el.querySelector('[name=mmi-plan]:checked').value;
      const f = el.querySelector('#mmi-freq').value;
      const body = { plan: chosen, date: el.querySelector('#mmi-date').value, every_days: f === 'custom' ? +el.querySelector('#mmi-days').value : +f };
      S.caseData = await api('cases.php?action=mmi&id=' + c.id, body);
      renderCase(); toast(chosen === 'discharge' ? 'Discharged' : 'Maintenance plan saved');
    } });
  m.el.querySelector('#mmi-freq').addEventListener('change', (e) => { m.el.querySelector('#mmi-days').hidden = e.target.value !== 'custom'; });
  m.el.querySelectorAll('[name=mmi-plan]').forEach((r) => r.addEventListener('change', () => { m.el.querySelector('#mmi-freq-box').hidden = m.el.querySelector('[name=mmi-plan]:checked').value === 'discharge'; }));
}

// --- case suggestions: better outcomes, complete documentation ---
const TIP_CATS = { gaps: ['Consistent care', 'cat-gaps'], specialists: ['Specialist care', 'cat-spec'], evaluation: ['Evaluation & documentation', 'cat-eval'] };
const TIP_REASONS = {
  gaps: ['Reason documented in the chart', 'Not applicable'],
  specialists: ['Not clinically indicated', 'Patient declined', 'Already arranged elsewhere'],
  evaluation: ['Done', 'Not applicable'],
};
function tipsCardHtml(d) {
  if (!d.tips || !d.tips.length) return '';
  const w = can('case.write'), cw = can('clinical.write');
  return `<div class="card tips"><div class="card-head"><h2>Suggestions</h2><span class="small muted">Ways to help the patient get the care they need and document the injury fully — if clinically indicated</span></div>
    <ul class="tip-list">${d.tips.map((t) => {
      const [catName, catCls] = TIP_CATS[t.category];
      const act = [];
      if (t.action?.referral && cw) act.push(`<button class="btn sm" data-act="guide-refer" data-type="${esc(t.action.referral)}" data-region="${esc(t.action.region || '')}">Add ${esc(label('referralTypes', t.action.referral))} referral</button>`);
      act.push(`<button class="btn ghost sm" data-act="task-from-alert" data-case="${d.case.id}" data-text="${esc(t.title)}">+ Task</button>`);
      if (w) act.push(`<button class="btn ghost sm" data-act="tip-dismiss" data-key="${esc(t.key)}">Not applicable…</button>`);
      return `<li class="${catCls}"><div><span class="chip ${catCls}">${esc(catName)}</span> <strong>${esc(t.title)}</strong></div>
        <div class="small">${esc(t.text)}</div>
        <details class="small"><summary>Why it matters</summary><p class="muted">${esc(t.why)}</p></details>
        <div class="filters gs-actions">${act.join('')}</div></li>`;
    }).join('')}</ul>
    <p class="small muted guide-note">Suggestions are educational prompts drawn from the case record. Act on them only when the treating provider judges them clinically indicated.</p></div>`;
}
function tipDismissModal(key) {
  const t = S.caseData.tips.find((x) => x.key === key);
  const reasons = TIP_REASONS[t.category] || ['Not applicable'];
  openModal({ title: 'Not applicable', okText: 'Save',
    body: `<p class="small"><strong>${esc(t.title)}</strong></p><p class="small muted">Record why, for anyone reviewing the case later.</p>
      <div class="mt">${reasons.map((r, i) => `<label class="check"><input type="radio" name="td-reason" value="${esc(r)}"${i === 0 ? ' checked' : ''}> ${esc(r)}</label>`).join('')}
      <label class="check"><input type="radio" name="td-reason" value=""> Other:</label><input id="td-other" placeholder="Reason" maxlength="255"></div>`,
    onOk: async (el) => {
      const reason = el.querySelector('[name=td-reason]:checked')?.value || el.querySelector('#td-other').value.trim();
      if (!reason) throw new Error('Pick or type a reason.');
      await guideStep('tip_' + key, { status: 'dismissed', reason }); toast('Saved');
    } });
}

async function guideStep(step, body) {
  const r = await api('cases.php?action=guide_step&id=' + S.caseData.case.id, { step, ...body });
  S.caseData = r; renderCase();
}
function guideDismissModal(step) {
  const g = S.caseData.guide.find((x) => x.key === step);
  const reasons = GUIDE_REASONS[step] || [];
  openModal({ title: `${g.title}: not needed`, okText: 'Save',
    body: `<p class="small">Record why, so anyone reviewing the case later understands the decision.</p>
      <div class="mt">${reasons.map((r, i) => `<label class="check"><input type="radio" name="gd-reason" value="${esc(r)}"${i === 0 ? ' checked' : ''}> ${esc(r)}</label>`).join('')}
      <label class="check"><input type="radio" name="gd-reason" value=""> Other:</label><input id="gd-other" placeholder="Reason" maxlength="255"></div>`,
    onOk: async (el) => {
      const pick = el.querySelector('[name=gd-reason]:checked')?.value;
      const reason = pick || el.querySelector('#gd-other').value.trim();
      if (!reason) throw new Error('Pick or type a reason.');
      await guideStep(step, { status: 'dismissed', reason }); toast('Saved');
    } });
}
function guideSnoozeModal(step) {
  const g = S.caseData.guide.find((x) => x.key === step);
  const defs = [{ n: 'until', l: 'Remind me on', t: 'date', req: true }, { n: 'reason', l: 'Note (optional)', ph: 'e.g. re-check at the 30-day re-exam' }];
  const inDays = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return x.toLocaleDateString('en-CA'); };
  const m = openModal({ title: `${g.title}: remind me later`, okText: 'Set reminder',
    body: `<div class="filters">${[[7, '1 week'], [14, '2 weeks'], [28, '4 weeks']].map(([n, t]) => `<button class="btn ghost sm" data-days="${n}">${t}</button>`).join('')}</div>${fieldsHtml(defs, { until: inDays(14) })}`,
    onOk: async (el) => { await guideStep(step, { status: 'snoozed', ...readFields(el, defs) }); toast('Reminder set'); } });
  m.el.querySelectorAll('[data-days]').forEach((b) => b.addEventListener('click', () => { m.el.querySelector('[name=until]').value = inDays(+b.dataset.days); }));
}

// ---------- PI playbook ----------
async function pagePlaybook(main) {
  const want = new URLSearchParams(location.hash.split('?')[1] || '').get('state');
  const r = await attempt(() => api('cases.php?action=playbook' + (want ? '&state=' + encodeURIComponent(want) : '')));
  if (!r) return;
  const st = r.state;
  const groups = {};
  r.checklist.forEach((i) => (groups[i.group] = groups[i.group] || []).push(i));
  const types = (cs) => cs.length === Object.keys(S.lookups.injuryTypes).length ? 'All cases' : cs.map((c) => label('injuryTypes', c)).join(', ');
  main.innerHTML = `<div class="page-head"><div><h1>PI playbook</h1><div class="sub">How a personal injury case runs, and the timelines ${esc(S.brand.name)} keeps you on. Every case shows these as next steps, checklist items and alerts.</div></div>
      <span class="spacer"></span><div><label for="pb-state">State</label><select id="pb-state">${stateOpts().map(([k, t]) => opt(k, t, st.code)).join('')}</select></div></div>
    <div class="notice"><strong>An educational guide.</strong> ${clinicalNote()} Legal and billing rules should be confirmed with qualified counsel.</div>
    <div class="card mt"><div class="card-head"><h2>${esc(st.name)}: what's different</h2><span class="chip ${st.support === 'full' ? 'teal' : st.support === 'limited' ? 'ochre' : ''}">${esc(S.lookups.supportLabels[st.support])}</span></div>
      ${st.verified ? '' : `<div class="notice small">Draft rules from published sources (October 2026) — confirm with an attorney licensed in ${esc(st.name)} before relying on them. Not legal advice.</div>`}
      ${st.support === 'basic' ? `<p class="small muted mt-sm">${esc(st.name)} isn't configured yet, so cases there use general at-fault-state rules: no PIP deadlines, letters of protection for the balance. The care guide, checklist and alerts below still apply.</p>` : ''}
      <dl class="kv mt">${st.summary.map(([t, x]) => `<dt>${esc(t)}</dt><dd>${esc(x)}</dd>`).join('')}</dl></div>
    
    <div class="card mt"><h2>Care timeline</h2>
      <ol class="playbook-steps">${r.guide.map((g) => `<li><strong>${esc(g.title)}</strong>${g.cases.length < 3 ? ` <span class="chip">${esc(g.cases.map((c) => label('injuryTypes', c)).join(', '))} only</span>` : ''} — <span>${esc(g.when)}</span><p class="small muted">${esc(g.why)}</p></li>`).join('')}</ol>
      <p class="small muted">More than one of any referral is normal (an MRI per region, a second ortho opinion). Add others — EMG, X-ray, physical therapy, dental/TMJ — whenever the patient needs them.</p></div>
    <div class="card mt"><h2>Best outcomes, well-documented cases</h2>
      <p class="small muted mt">The app turns these into suggestions on each case. All of them are "when clinically indicated" — the doctor decides.</p>
      <dl class="kv mt">
        <dt>No gaps in care</dt><dd>Keep the patient on the care plan. Call after any missed visit. If a gap happens, document the reason — unexplained gaps are the most common way a claim is discounted.</dd>
        <dt>Start early</dt><dd>Treat as soon after the injury as possible, and get records of any ER or urgent care visit in between.</dd>
        <dt>Every injured area evaluated</dt><dd>Image each injured region (neck, mid back, low back, shoulder, knee), not just the worst one.</dd>
        <dt>Objective testing</dt><dd>MRI for structural injury; EMG/NCV when there's radiating pain, numbness or tingling; neuropsychological testing for lasting concussion symptoms.</dd>
        <dt>Specialist involvement</dt><dd>Positive MRI findings → orthopedic evaluation. Follow through on what specialists recommend (injections, pain management, surgical consult).</dd>
        <dt>Measure progress</dt><dd>Outcome assessments at intake and every re-exam show improvement and lasting limitations in numbers.</dd>
        <dt>At MMI</dt><dd>If symptoms or impairment remain, ask the treating specialist for a permanency opinion and impairment rating. In no-fault states, pain-and-suffering claims usually depend on the injury meeting the state's threshold (see above).</dd>
        <dt>Keep the attorney informed</dt><dd>Attorney on file, letter of protection signed, records and bills sent promptly.</dd>
      </dl></div>
    <div class="card mt"><h2>Wording: write for every reader</h2>
      <p class="small muted mt">Case records can be requested by the insurer or opposing counsel. Keep notes, letters and logs to facts.</p>
      <dl class="kv mt">
        <dt>Do</dt><dd>Record what happened and when: "Called 10/20, no answer, left message to call and schedule." "Patient rescheduled to 10/24." "Referred to orthopedics 10/2."</dd>
        <dt>Avoid</dt><dd>Opinions about motives or effort ("non-compliant", "unmotivated", "refused care", "abandoned treatment"), guesses about the injury ("seems fine", "probably resolved"), and anything about the claim's value or strategy.</dd>
        <dt>Missed care</dt><dd>Note the facts and the reason the patient gave, if any. Ask the attorney or paralegal to help reach the patient instead of characterising it.</dd>
        <dt>Internal coaching</dt><dd>Alerts, suggestions, policy-limit warnings and checklists are internal working tools — they're never included in the patient-file export.</dd>
      </dl></div>
    <div class="card mt"><h2>Rules that cost money if missed</h2><dl class="kv">${r.rules.map(([t, x]) => `<dt>${esc(t)}</dt><dd>${esc(x)}</dd>`).join('')}</dl></div>
    <div class="card mt"><h2>Case checklist</h2>${Object.entries(groups).map(([g, items]) => `<h3 class="mt">${esc(g)}</h3>
      <table><thead><tr><th>Item</th><th>When</th><th>Applies to</th></tr></thead><tbody>${items.map((i) => `<tr><td>${esc(i.label)}</td><td class="small">${esc(i.when)}</td><td class="small muted">${esc(types(i.cases))}</td></tr>`).join('')}</tbody></table>`).join('')}</div>`;
  main.querySelector('#pb-state').addEventListener('change', (e) => { location.hash = '#/playbook?state=' + e.target.value; });
}

// --- referrals / co-management ---
const REF_STATUS = [['ordered', 'Ordered'], ['scheduled', 'Scheduled'], ['completed', 'Completed'], ['report_received', 'Report received'], ['no_show', 'No-show'], ['cancelled', 'Cancelled']];
const refDefs = () => [
  { n: 'direction', l: 'Direction', t: 'select', blank: false, opts: [['out', 'Outgoing — we referred'], ['in', 'Incoming — referred to us / co-managing']] },
  { n: 'type', l: 'Type', t: 'select', req: true, opts: entries(S.lookups.referralTypes) },
  { n: 'specialty', l: 'Specialty (for “Other”)', ph: 'e.g. Dental / TMJ, ENT, vestibular therapy' },
  { n: 'contact_id', l: 'Facility / provider', t: 'contact', ctype: ['imaging', 'pain_mgmt', 'ortho', 'neuro', 'md', 'hospital', 'pt', 'other'] },
  { n: 'facility_text', l: 'Facility (if not in contacts)' },
  { n: 'body_region', l: 'Body region', ph: 'e.g. C-spine, L-spine, R shoulder' },
  { n: 'status', l: 'Status', t: 'select', blank: false, opts: REF_STATUS },
  { n: 'ordered_on', l: 'Ordered / referred on', t: 'date' }, { n: 'scheduled_on', l: 'Appointment date', t: 'date' },
  { n: 'completed_on', l: 'Completed on', t: 'date' }, { n: 'report_received_on', l: 'Report received on', t: 'date' },
  { n: 'entered_in_chart', l: 'Report uploaded & entered in chart', t: 'check' },
  { n: 'findings', l: 'Findings / impression', t: 'textarea', ph: 'e.g. C5-6 disc herniation; EMC determined to exist' },
  { n: 'notes', l: 'Notes', t: 'textarea' },
];
function tabReferrals(el, d) {
  el.innerHTML = `<div class="card"><div class="card-head"><h2>Imaging, EMC &amp; co-management</h2><span class="spacer"></span>${can('clinical.write') ? '<button class="btn sm" data-act="add-referral">+ Add referral</button>' : ''}</div>
    ${d.referrals.length ? `<div class="table-wrap"><table><thead><tr><th>Type</th><th>Facility / provider</th><th>Status</th><th>Ordered</th><th>Appt</th><th>Completed</th><th>Report</th><th>Findings</th><th></th></tr></thead><tbody>
    ${d.referrals.map((r) => `<tr class="click" data-act="edit-referral" data-id="${r.id}">
      <td><strong>${esc(r.type === 'other' && r.specialty ? r.specialty : label('referralTypes', r.type))}</strong>${r.direction === 'in' ? ' <span class="chip">incoming</span>' : ''}${r.body_region ? `<div class="small muted">${esc(r.body_region)}</div>` : ''}</td>
      <td>${esc([r.contact_org, r.contact_name].filter(Boolean).join(' — ') || r.facility_text || '—')}</td>
      <td><span class="chip ${r.status === 'report_received' ? 'done' : r.status === 'no_show' ? 'overdue' : r.status === 'cancelled' ? 'na' : 'due'}">${esc(Object.fromEntries(REF_STATUS)[r.status])}</span></td>
      <td class="nowrap">${esc(fmtDate(r.ordered_on))}</td><td class="nowrap">${esc(fmtDate(r.scheduled_on))}</td><td class="nowrap">${esc(fmtDate(r.completed_on))}</td>
      <td class="nowrap">${esc(fmtDate(r.report_received_on))}${r.entered_in_chart == 1 ? ' ✓' : ''}</td>
      <td class="small">${esc((r.findings || '').slice(0, 120))}</td>
      <td>${can('clinical.write') ? `<button class="btn link small" data-act="archive-child" data-table="referrals" data-id="${r.id}">Remove</button>` : ''}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="empty">No referrals yet. The Overview tab shows which referrals are due and when.</div>'}
  </div>`;
}

function referralModal(existing, prefill = {}) {
  if (!can('clinical.write')) return;
  const defs = refDefs();
  openModal({
    title: existing ? 'Edit referral' : 'Add referral', wide: true,
    body: fieldsHtml(defs, existing || { direction: 'out', status: 'ordered', ordered_on: today(), ...prefill }) + (existing ? '' : '<p class="small muted">Tip: for an EMC referral, set the case\'s EMC determination on the Overview tab once the MD/DO report arrives.</p>'),
    onOk: async (el) => saveChild('referrals', { ...readFields(el, defs), ...(existing ? { id: existing.id } : {}) }),
  });
}

// --- visits ---
const VISIT_TYPES = [['initial', 'Initial exam'], ['treatment', 'Treatment'], ['re_exam', 'Re-exam'], ['maintenance', 'Maintenance'], ['discharge', 'Discharge'], ['no_show', 'No-show']];
const visitDefs = () => [
  { n: 'visit_date', l: 'Date of service', t: 'date', req: true },
  { n: 'visit_type', l: 'Visit type', t: 'select', blank: false, opts: VISIT_TYPES },
  { n: 'provider_user_id', l: 'Provider', t: 'user' },
  ...(multiLocation() && myLocations().length > 1 ? [{ n: 'location_id', l: 'Location', t: 'select', blank: 'Case location', opts: myLocations().map((l) => [l.id, l.name]) }] : []),
  { n: 'cpt_codes', l: 'CPT codes', ph: '98941, 97140, 97110' },
  ...(S.caseData?.case.injury_type === 'workers_comp' ? [{ n: 'dwc25_sent', l: 'DWC-25 sent to carrier', t: 'check' }] : []),
  { n: 'notes', l: 'Visit note', t: 'textarea' },
];
function tabVisits(el, d) {
  const counts = {};
  d.visits.forEach((v) => counts[v.visit_type] = (counts[v.visit_type] || 0) + 1);
  el.innerHTML = `<div class="card"><div class="card-head"><h2>Visits</h2>
      <span class="small muted">${d.stats.visitCount} attended${counts.no_show ? ` · ${counts.no_show} no-show${counts.no_show > 1 ? 's' : ''}` : ''}</span>
      <span class="spacer"></span>${can('clinical.write') ? '<button class="btn sm" data-act="add-visit">+ Log visit</button>' : ''}</div>
    ${d.visits.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Type</th><th>Provider</th><th>CPT</th>${d.case.injury_type === 'workers_comp' ? '<th>DWC-25</th>' : ''}<th>Note</th><th></th></tr></thead><tbody>
    ${d.visits.map((v) => `<tr class="click" data-act="edit-visit" data-id="${v.id}"><td class="nowrap">${esc(fmtDate(v.visit_date))}</td>
      <td><span class="chip ${v.visit_type === 'no_show' ? 'overdue' : v.visit_type === 'discharge' ? 'teal' : ''}">${esc(Object.fromEntries(VISIT_TYPES)[v.visit_type])}</span></td>
      <td>${esc(v.provider_name || '—')}</td><td class="mono small">${esc(v.cpt_codes || '')}${v.icd_codes ? `<div class="muted" title="${esc(v.icd_codes)}">ICD ${esc(v.icd_codes.split(', ').slice(0, 4).join(', '))}${v.icd_codes.split(', ').length > 4 ? '…' : ''}</div>` : ''}${v.source === 'ehr' ? ' <span class="chip">EHR</span>' : ''}</td>${d.case.injury_type === 'workers_comp' ? `<td>${v.visit_type === 'no_show' ? '—' : v.dwc25_sent == 1 ? '<span class="chip done">Sent</span>' : '<span class="chip due">Not sent</span>'}</td>` : ''}<td class="small">${esc((v.notes || '').slice(0, 140))}</td>
      <td>${can('clinical.write') ? `<button class="btn link small" data-act="archive-child" data-table="visits" data-id="${v.id}">Remove</button>` : ''}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="empty">No visits logged yet.</div>'}
    <p class="small muted mt">Logging the first visit moves an intake case to Treating; logging a Discharge visit sets the discharge date and moves it to Treatment complete.</p>
  </div>`;
}

function visitModal(existing, prefill = {}) {
  if (!can('clinical.write')) return;
  const defs = visitDefs();
  const chargeDefs = [{ n: 'charge_amount', l: 'Charge ($)', t: 'money' }, { n: 'charge_to', l: 'Bill to', t: 'select', blank: false, opts: holderOpts({ activeOnly: true }) }];
  const showCharge = !existing && can('finance.write');
  openModal({
    title: existing ? 'Edit visit' : 'Log visit', wide: true,
    body: fieldsHtml(defs, existing || { visit_date: today(), visit_type: S.caseData.stats.visitCount ? 'treatment' : 'initial', provider_user_id: S.caseData.case.provider_user_id || '', ...prefill })
      + (showCharge ? '<h3 class="mt">Charge (optional)</h3>' + fieldsHtml(chargeDefs, { charge_to: defaultBillTo() }) : ''),
    onOk: async (el) => {
      const row = { ...readFields(el, defs), ...(existing ? { id: existing.id } : {}) };
      const extra = showCharge ? (() => { const c = readFields(el, chargeDefs); return c.charge_amount ? { charge: { amount: c.charge_amount, to: c.charge_to } } : {}; })() : {};
      await saveChild('visits', row, extra);
    },
  });
}

// --- outcomes ---
function tabOutcomes(el, d) {
  const by = {};
  d.outcomes.forEach((o) => (by[o.measure] = by[o.measure] || []).push(o));
  el.innerHTML = `<div class="card"><div class="card-head"><h2>Outcome assessments</h2><span class="spacer"></span>${can('clinical.write') ? '<button class="btn sm" data-act="add-outcome">+ Record score</button>' : ''}</div>
    <p class="small muted">Higher scores mean more disability on these tools, so a falling score is improvement. Re-administer about every 30 days.</p>
    ${Object.keys(by).length ? `<div class="table-wrap"><table><thead><tr><th>Measure</th><th class="num">First</th><th class="num">Latest</th><th class="num">Change</th><th>History</th></tr></thead><tbody>
    ${entries(by).map(([m, list]) => {
      const first = +list[0].score, last = +list[list.length - 1].score;
      const pct = first ? Math.round((last - first) / first * 100) : 0;
      return `<tr><td><strong>${esc(label('outcomeMeasures', m))}</strong></td><td class="num">${first}</td><td class="num">${last}</td>
        <td class="num ${pct > 0 ? 'trend-up' : pct < 0 ? 'trend-down' : ''}">${list.length > 1 ? (pct > 0 ? '+' : '') + pct + '%' : '—'}</td>
        <td class="small">${list.map((o) => `${esc(fmtDate(o.taken_on))}: <strong>${esc(+o.score)}</strong>${can('clinical.write') ? ` <button class="btn link small" data-act="archive-child" data-table="outcomes" data-id="${o.id}" aria-label="Remove">×</button>` : ''}`).join(' · ')}</td></tr>`;
    }).join('')}</tbody></table></div>` : '<div class="empty">No scores recorded yet.</div>'}
  </div>`;
}

function outcomeModal() {
  const defs = [{ n: 'measure', l: 'Measure', t: 'select', req: true, opts: entries(S.lookups.outcomeMeasures) }, { n: 'score', l: 'Score', t: 'number', req: true }, { n: 'taken_on', l: 'Date', t: 'date', req: true }];
  openModal({ title: 'Record outcome score', body: fieldsHtml(defs, { taken_on: today() }), onOk: async (el) => saveChild('outcomes', readFields(el, defs)) });
}

// --- correspondence ---
const METHODS = [['fax', 'Fax'], ['email', 'Email'], ['phone', 'Phone'], ['mail', 'Mail'], ['portal', 'Portal'], ['in_person', 'In person']];
const corrDefs = () => [
  { n: 'occurred_on', l: 'Date', t: 'date', req: true },
  { n: 'direction', l: 'Direction', t: 'select', blank: false, opts: [['out', 'Sent / we called'], ['in', 'Received / they called']] },
  { n: 'method', l: 'Method', t: 'select', blank: false, opts: METHODS },
  { n: 'contact_id', l: 'With (contact)', t: 'contact' }, { n: 'contact_text', l: 'With (other)', ph: 'e.g. paralegal name' },
  { n: 'subject', l: 'Subject', req: true, full: true, ph: 'e.g. Case status update request; Records request; Reduction offer' },
  { n: 'notes', l: 'Notes / outcome', t: 'textarea', ph: 'What was said or sent, any dates given (mediation, trial, settlement)…' },
  { n: 'follow_up_on', l: 'Follow up on', t: 'date' }, { n: 'follow_up_done', l: 'Follow-up done', t: 'check' },
];
function tabCorrespondence(el, d) {
  el.innerHTML = `<div class="card"><div class="card-head"><h2>Correspondence log</h2><span class="spacer"></span>
      <button class="btn ghost sm" data-act="letter" data-type="status_request">Print status request</button>
      <button class="btn sm" data-act="add-corr">+ Log contact</button></div>
    ${d.correspondence.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Method</th><th>With</th><th>Subject / notes</th><th>Follow-up</th><th></th></tr></thead><tbody>
    ${d.correspondence.map((r) => `<tr class="click" data-act="edit-corr" data-id="${r.id}"><td class="nowrap">${esc(fmtDate(r.occurred_on))}</td>
      <td class="nowrap">${r.direction === 'in' ? '⬅' : '➡'} ${esc(Object.fromEntries(METHODS)[r.method])}</td>
      <td>${esc([r.contact_org, r.contact_name].filter(Boolean).join(' — ') || r.contact_text || '—')}</td>
      <td><strong>${esc(r.subject)}</strong>${r.notes ? `<div class="small">${esc(r.notes.slice(0, 200))}</div>` : ''}</td>
      <td class="nowrap">${r.follow_up_on ? (r.follow_up_done == 1 ? '<span class="chip done">Done</span>' : `<span class="chip ${r.follow_up_on <= today() ? 'overdue' : 'due'}">${esc(fmtDate(r.follow_up_on))}</span>`) : '—'}</td>
      <td><button class="btn link small" data-act="archive-child" data-table="correspondence" data-id="${r.id}">Remove</button></td></tr>`).join('')}
    </tbody></table></div>` : '<div class="empty">No correspondence logged.</div>'}
  </div>`;
}

function corrModal(existing) {
  const defs = corrDefs();
  const atty = S.caseData.case.attorney_contact_id;
  openModal({
    title: existing ? 'Edit correspondence' : 'Log correspondence', wide: true,
    body: fieldsHtml(defs, existing || { occurred_on: today(), direction: 'out', method: 'fax', contact_id: atty || '', follow_up_on: new Date(Date.now() + 14 * 864e5).toLocaleDateString('en-CA') }),
    onOk: async (el) => saveChild('correspondence', { ...readFields(el, defs), ...(existing ? { id: existing.id } : {}) }),
  });
}

// --- financials ---
// Money model: a charge is billed to an insurance coverage or the patient
// balance. Payments/adjustments reduce whoever holds it; a "move" shifts an
// amount between insurance and the patient balance (either direction).
// The app suggests moves but never makes them on its own, and every entry
// stays editable — payments routinely arrive weeks or months late.
const LEDGER_KINDS = [['charge', 'Charge'], ['payment', 'Payment'], ['adjustment', 'Adjustment'], ['reduction', 'Reduction (attorney)'], ['write_off', 'Write-off'], ['transfer', 'Move balance']];
const MOVE_REASONS = ['20% PIP coinsurance', 'PIP denied', 'PIP exhausted', 'Not covered by insurance', 'Late insurance payment received', 'Correction'];
const covById = (id) => (S.caseData.coverages || []).find((c) => +c.id === +id);
const covName = (cv) => cv ? label('coverageTypes', cv.type) + (cv.carrier_org || cv.carrier_text ? ' — ' + (cv.carrier_org || cv.carrier_text) : '') : 'Insurance';
const holderName = (bucket, covId) => bucket === 'patient' ? 'Patient balance' : covName(covById(covId));
const holderValue = (bucket, covId) => bucket === 'patient' ? 'patient' : String(covId || '');
const parseHolder = (v) => v === 'patient' ? { bucket: 'patient', coverage_id: null } : { bucket: 'insurance', coverage_id: v ? +v : null };
function holderOpts({ patient = true, activeOnly = false, exclude = null } = {}) {
  const out = (S.caseData.coverages || []).filter((c) => (!activeOnly || c.status === 'active') && String(c.id) !== exclude)
    .map((c) => [String(c.id), covName(c) + (c.status !== 'active' ? ` (${label('coverageStatus', c.status).toLowerCase()})` : '')]);
  if (patient && exclude !== 'patient') out.push(['patient', 'Patient balance (LOP)']);
  return out;
}
// Where new charges go by default: the first active insurance, else the patient.
const defaultBillTo = () => { const a = (S.caseData.coverages || []).filter((c) => c.status === 'active'); return a.length ? String(a[0].id) : 'patient'; };
const chargeLabel = (it) => `${fmtDate(it.date)} — ${it.memo || 'Charge'} (${money(it.amount)})`;

function tabFinancials(el, d) {
  const c = d.case;
  // Cases synced from an EHR ledger: the EHR is the source of truth, so
  // charges, payments and transfers aren't entered or edited here.
  const synced = !!c.ehr_synced_at;
  const fwAny = can('finance.write'), fw = fwAny && !synced;
  const showBal = fin('balances'), showLed = fin('ledger'), showSet = fin('settlement');
  // Without the balances category, totals are withheld by the server.
  const t = d.totals || { by_coverage: {}, patient_balance: 0, total_balance: 0 };
  const covEdit = can('case.write') || fw;
  const items = d.openItems || [];
  const showAll = el.dataset.all === '1';
  const shown = showAll ? items : items.filter((i) => i.ins_open > 0.005 || i.pat_open > 0.005);
  const pip = (d.coverages || []).find((cv) => cv.type === 'pip');
  const covCards = (d.coverages || []).map((cv) => {
    const b = t.by_coverage[cv.id] || { charges: 0, paid: 0, adjusted: 0, moved_out: 0, moved_in: 0, balance: 0 };
    const statusCls = cv.status === 'active' ? 'teal' : cv.status === 'closed' ? 'na' : 'overdue';
    const limit = cv.type === 'pip' ? `<div class="small">Limit ${cv.benefit_limit != null ? money(cv.benefit_limit) : d.rules.pipMedical ? money(d.rules.pipMedical) : 'not set'}${d.rules.emcRule && +c.pip_effective_limit < +(cv.benefit_limit ?? d.rules.pipMedical) ? ` · ${money(c.pip_effective_limit)} without a qualifying EMC` : ''}${cv.policy_effective_on ? ' · policy from ' + esc(fmtDate(cv.policy_effective_on)) : ''}</div>${cv.demand_sent_on ? `<div class="small">Pre-suit demand sent ${esc(fmtDate(cv.demand_sent_on))}</div>` : ''}` : '';
    const auth = cv.type === 'workers_comp' ? `<div class="small">Authorized: ${cv.authorized_visits ? esc(cv.authorized_visits) + ' visits' : 'visits not set'}${cv.authorized_through ? ' through ' + esc(fmtDate(cv.authorized_through)) : ''}</div>` : '';
    return `<div class="cov">
      <div class="cov-head"><strong>${esc(covName(cv))}</strong><span class="chip ${statusCls}">${esc(label('coverageStatus', cv.status))}${cv.status_on && cv.status !== 'active' ? ' ' + esc(fmtDate(cv.status_on)) : ''}</span><span class="spacer"></span><span class="small muted">Billing order ${esc(cv.priority)}</span></div>
      <div class="small">${cv.claim_number ? 'Claim # <span class="mono">' + esc(cv.claim_number) + '</span>' : '<span class="muted">No claim # yet</span>'}${cv.policy_number ? ' · Policy/member # <span class="mono">' + esc(cv.policy_number) + '</span>' : ''}${cv.adjuster ? ' · Adjuster ' + esc(cv.adjuster) : ''}</div>
      ${limit}${auth}${cv.status_reason ? `<div class="small muted">${esc(cv.status_reason)}</div>` : ''}
      ${showBal ? `<div class="cov-nums small"><span>Billed ${money(b.charges + b.moved_in)}</span><span>Paid ${money(b.paid)}</span><span>Adjusted ${money(b.adjusted)}</span><span>Moved out ${money(b.moved_out)}</span><span><strong>Open ${money(b.balance)}</strong></span></div>` : ''}
      ${covEdit ? `<div class="filters mt-sm"><button class="btn ghost sm" data-act="edit-coverage" data-id="${cv.id}">Edit</button>
        ${cv.status === 'active' ? `<button class="btn ghost sm" data-act="cov-status" data-id="${cv.id}" data-status="denied">Mark denied</button>
          ${cv.type !== 'workers_comp' ? `<button class="btn ghost sm" data-act="cov-status" data-id="${cv.id}" data-status="exhausted">Mark exhausted</button>` : ''}
          <button class="btn ghost sm" data-act="cov-status" data-id="${cv.id}" data-status="closed">Close</button>`
        : `<button class="btn ghost sm" data-act="cov-status" data-id="${cv.id}" data-status="active">Reactivate</button>`}
        ${fw && b.balance > 0.005 ? `<button class="btn ghost sm" data-act="move-balance" data-from="${cv.id}">Move balance…</button>` : ''}</div>` : ''}
    </div>`;
  }).join('');

  // Actual PIP payments against the limit — each carrier's fee schedule
  // differs, so nothing is estimated.
  const pct = (() => {
    if (!pip || !showBal) return null;
    const paid = (t.by_coverage[pip.id] || {}).paid || 0, lim = +c.pip_effective_limit;
    return lim ? { pct: Math.min(100, Math.round(paid / lim * 100)), paid, lim, left: Math.max(0, lim - paid) } : null;
  })();

  el.innerHTML = `
    ${fwAny ? `<div class="filters">${fw ? `<button class="btn sm" data-act="add-charge">+ Charge</button><button class="btn sm" data-act="add-payment">+ Payment</button>
      <button class="btn ghost sm" data-act="move-balance">Move balance…</button>` : ''}<button class="btn ghost sm" data-act="ehr-upload">Upload EHR ledger</button>${can('finance.write') ? '<button class="btn ghost sm" data-act="eob-upload-case">Upload EOB</button>' : ''}<span class="spacer"></span>
      ${showLed ? '<button class="btn ghost sm" data-act="letter" data-type="statement">Print statement</button>' : ''}</div>` : ''}
    ${synced ? `<div class="banner-inline"><strong>Financials mirror the ${esc(c.ehr_system)} ledger</strong> uploaded ${esc(fmtDate(d.ehr?.uploaded_at || c.ehr_synced_at))}${d.ehr?.uploaded_by_name ? ' by ' + esc(d.ehr.uploaded_by_name) : ''}.
      To change charges, payments or transfers, update ${esc(c.ehr_system)} and upload the new ledger.${d.ehr?.document_id ? ` <a href="api/documents.php?action=download&id=${d.ehr.document_id}&inline=1" target="_blank" rel="noopener">View ledger PDF</a>` : ''}</div>` : ''}
    <div class="grid-2">
      <div class="card"><div class="card-head"><h2>Insurance</h2><span class="spacer"></span>${covEdit ? '<button class="btn ghost sm" data-act="add-coverage">+ Add insurance</button>' : ''}</div>
        ${covCards || `<div class="empty">No insurance on file. Add PIP, MedPay, health insurance or workers' comp if the patient has it — insurance must be billed before the patient balance.</div>`}
      </div>
      <div>
        ${showBal ? `<div class="card"><h2>Balances</h2>
          ${(d.coverages || []).map((cv) => `<div class="money-row"><span>${esc(covName(cv))}</span><strong>${money((t.by_coverage[cv.id] || {}).balance || 0)}</strong></div>`).join('')}
          ${t.by_coverage[0] ? `<div class="money-row"><span>Insurance (no coverage linked)</span><strong>${money(t.by_coverage[0].balance)}</strong></div>` : ''}
          <div class="money-row"><span>Patient balance (LOP)</span><strong>${money(t.patient_balance)}</strong></div>
          <div class="money-row"><span><strong>Total outstanding</strong></span><strong>${money(t.total_balance)}</strong></div>
          <div class="small muted mt-sm">Charges ${money(t.total_charges)} · insurance paid ${money(t.insurance_paid)} · moved to patient ${money(t.moved_to_patient)}</div>
          ${pct ? `<div class="small mt">PIP has paid ${money(pct.paid)} of ${money(pct.lim)} — ${money(pct.left)} left<div class="bar ${pct.pct >= 100 ? 'over' : pct.pct >= 85 ? 'warn' : ''}"><i data-w="${pct.pct}"></i></div></div>` : ''}
        </div>` : ''}
        ${caseValueCardHtml(d)}
        <div class="card"><div class="card-head"><h2>LOP &amp; settlement</h2><span class="spacer"></span>${can('case.write') || fw ? '<button class="btn ghost sm" data-act="edit-lop">Edit</button>' : ''}</div>
          <div class="money-row"><span>LOP signed by patient</span><strong>${esc(fmtDate(c.lop_signed_on))}</strong></div>
          <div class="money-row"><span>Acknowledged by law firm</span><strong>${c.lop_acknowledged_on ? esc(fmtDate(c.lop_acknowledged_on)) : (c.lop_signed_on ? 'Not countersigned' : '—')}</strong></div>
          ${d.rules.lopDisclosure && c.lop_signed_on ? `<div class="money-row"><span>Disclosure facts (§768.0427)</span><strong>${c.lop_factored === 'unknown' ? 'Not recorded' : (c.lop_factored === 'yes' ? 'Factored' + (c.lop_factor_company ? ' to ' + esc(c.lop_factor_company) : '') + (c.lop_factor_price ? ' for ' + money(c.lop_factor_price) : '') : 'Not factored')} · health coverage: ${esc({ unknown: 'not recorded', yes: 'yes', no: 'no' }[c.lop_health_coverage] || 'not recorded')}</strong></div>` : ''}
          ${d.rules.balanceBilling !== 'allowed' ? `<div class="notice mt">${esc(d.rules.balanceNote || 'This state limits billing the patient above the fee schedule.')}</div>` : ''}
          <div class="money-row"><span>Mediation · trial</span><strong>${esc(fmtDate(c.mediation_on) || '—')} · ${esc(fmtDate(c.trial_on) || '—')}</strong></div>
          <div class="money-row"><span>Settlement signed · check expected</span><strong>${esc(fmtDate(c.settlement_signed_on) || '—')} · ${c.disbursement_expected_on ? `<span class="${!c.check_received_on && c.disbursement_expected_on < today() ? 'trend-up' : ''}">${esc(fmtDate(c.disbursement_expected_on))}</span>` : '—'}</strong></div>
          <div class="money-row"><span>Balance forwarded to attorney</span><strong>${c.balance_forwarded_on ? esc(fmtDate(c.balance_forwarded_on)) + (showSet ? ' · ' + money(c.balance_forwarded_amount) : '') : '—'}</strong></div>
          ${showSet ? `<div class="money-row"><span>Reduction floor — paid within 30 days (${d.reductionTerms.pct}%)</span><strong>${money(t.reduction_floor)}</strong></div><div class="money-row"><span>Paid after 30 days (${d.reductionTerms.late_pct}%)</span><strong>${money(t.reduction_late)}</strong></div>
          <div class="money-row"><span>Attorney offer</span><strong>${money(c.atty_offer)}${c.atty_offer && t.patient_balance > 0 ? ` <span class="small muted">(${Math.round(c.atty_offer / t.patient_balance * 1000) / 10}%)</span>` : ''}</strong></div>
          <div class="money-row"><span>Final settlement</span><strong>${money(c.final_settlement)}</strong></div>
          <div class="money-row"><span>Date authorized · check received</span><strong>${esc(fmtDate(c.date_authorized))} · ${esc(fmtDate(c.check_received_on))}</strong></div>
          ${c.atty_offer && +c.atty_offer < t.reduction_floor ? '<div class="notice mt">Offer is below the reduction floor.</div>' : ''}` : ''}
          ${fw && t.patient_balance > 0.005 ? '<button class="btn mt" data-act="forward-balance">Forward balance to attorney</button>' : ''}
        </div>
      </div>
    </div>
    ${showLed ? `<div class="card mt"><div class="card-head"><h2>Charges by date of service</h2><span class="spacer"></span>
      <label class="check small"><input type="checkbox" data-act-change="fin-all"${showAll ? ' checked' : ''}> Show paid charges</label></div>
      ${shown.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Description</th><th>Billed to</th><th class="num">Charge</th><th class="num">Ins. paid/adj.</th><th class="num">Moved to patient</th><th class="num">Patient paid/adj.</th><th class="num">Open — insurance</th><th class="num">Open — patient</th><th></th></tr></thead><tbody>
      ${shown.map((it) => `<tr><td class="nowrap">${esc(fmtDate(it.date))}</td><td class="small">${esc(it.memo || '')}</td>
        <td class="small">${esc(holderName(it.billed_to, it.billed_coverage_id))}${it.coverage_id && it.coverage_id !== it.billed_coverage_id ? ' → ' + esc(covName(covById(it.coverage_id))) : ''}</td>
        <td class="num">${money(it.amount)}</td><td class="num">${it.ins_paid + it.ins_adjusted ? money(it.ins_paid + it.ins_adjusted) : '—'}</td>
        <td class="num">${it.moved_to_patient ? money(it.moved_to_patient) : '—'}</td><td class="num">${it.pat_paid + it.pat_reduced ? money(it.pat_paid + it.pat_reduced) : '—'}</td>
        <td class="num">${it.ins_open > 0.005 ? '<strong>' + money(it.ins_open) + '</strong>' : '—'}</td><td class="num">${it.pat_open > 0.005 ? '<strong>' + money(it.pat_open) + '</strong>' : '—'}</td>
        <td>${fw ? `<div class="row-acts"><button class="btn ghost sm" data-act="add-payment" data-charge="${it.id}">Payment</button><button class="btn ghost sm" data-act="move-balance" data-charge="${it.id}">Move</button></div>` : ''}</td></tr>`).join('')}
      </tbody></table></div>` : `<div class="empty">${items.length ? 'Every charge is paid. Tick "Show paid charges" to see them.' : 'No charges yet. Log a visit with a charge, or add one with "+ Charge".'}</div>`}
    </div>
    <div class="card mt"><div class="card-head"><h2>Ledger history</h2><span class="small muted">${synced ? 'From the EHR ledger — read-only here.' : "Every entry stays editable — changes are recorded in the case's Activity."}</span></div>
      ${d.ledger.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Type</th><th>Who owes / moved</th><th>For</th><th>Ref / memo</th><th class="num">Amount</th><th>Last change</th><th></th></tr></thead><tbody>
      ${d.ledger.map((l) => {
        const charge = l.applies_to_id ? items.find((i) => i.id === +l.applies_to_id) : null;
        const who = l.kind === 'transfer' ? `${esc(holderName(l.bucket, l.coverage_id))} → ${esc(holderName(l.to_bucket, l.to_coverage_id))}` : esc(holderName(l.bucket, l.coverage_id));
        return `<tr><td class="nowrap">${esc(fmtDate(l.entry_date))}</td><td>${esc(Object.fromEntries(LEDGER_KINDS)[l.kind])}${l.source === 'ehr' ? ' <span class="chip">EHR</span>' : ''}</td><td class="small">${who}</td>
          <td class="small">${charge ? 'DOS ' + esc(fmtDate(charge.date)) : '—'}</td><td class="small">${esc([l.reference, l.memo].filter(Boolean).join(' · '))}</td>
          <td class="num">${l.kind === 'charge' || l.kind === 'transfer' ? money(l.amount) : '(' + money(l.amount) + ')'}</td>
          <td class="small muted">${esc(l.updated_by_name || '')}${l.updated_at ? ' · edited ' + esc(fmtDate(l.updated_at)) : ''}</td>
          <td class="nowrap">${fw ? `<button class="btn link small" data-act="edit-ledger" data-id="${l.id}">Edit</button> <button class="btn link small" data-act="archive-child" data-table="ledger" data-id="${l.id}">Remove</button>` : ''}</td></tr>`;
      }).join('')}</tbody></table></div>` : '<div class="empty">No ledger entries.</div>'}
    </div>` : ''}
    ${showBal ? '<div id="eob-card"></div>' : ''}`;
  if (showBal) loadCaseEobs();
  el.querySelectorAll('.bar > i[data-w]').forEach((i) => { i.style.width = i.dataset.w + '%'; });
  el.querySelectorAll('.limit-meter > i[data-w]').forEach((i) => { i.style.width = i.dataset.w + '%'; });
  el.querySelectorAll('.limit-meter > b[data-w]').forEach((b) => { b.style.left = b.dataset.w + '%'; });
  el.querySelector('[data-act-change=fin-all]')?.addEventListener('change', (e) => { el.dataset.all = e.target.checked ? '1' : ''; tabFinancials(el, d); });
}

// ----- insurance coverage -----
const coverageDefs = () => [
  { n: 'type', l: 'Insurance type', t: 'select', req: true, blank: false, opts: entries(S.lookups.coverageTypes) },
  { n: 'priority', l: 'Billing order (1 = bill first)', t: 'number' },
  { n: 'carrier_contact_id', l: 'Carrier (from contacts)', t: 'contact', ctype: ['insurer'] },
  { n: 'carrier_text', l: 'Carrier (if not in contacts)', ph: 'e.g. Florida Blue' },
  { n: 'claim_number', l: 'Claim #' }, { n: 'policy_number', l: 'Policy / member #' },
  { n: 'adjuster', l: 'Adjuster', ph: 'Name, phone' },
  { n: 'benefit_limit', l: `Benefit limit ($)${S.caseData?.rules?.pipMedical ? ' — ' + S.caseData.rules.name + ' minimum is ' + Math.round(S.caseData.rules.pipMedical).toLocaleString() : ''}`, t: 'money' },
  { n: 'policy_effective_on', l: 'Policy issued / renewed on (some state changes depend on it)', t: 'date' },
  { n: 'remaining_reported', l: 'Remaining per carrier ($) — from the adjuster / PIP payout log', t: 'money' },
  { n: 'remaining_reported_on', l: 'Remaining as of', t: 'date' },
  { n: 'authorized_visits', l: "Authorized visits (workers' comp)", t: 'number' },
  { n: 'authorized_through', l: "Authorized through (workers' comp)", t: 'date' },
  ...(S.caseData?.rules?.demandLetter ? [{ n: 'demand_sent_on', l: 'PIP pre-suit demand letter sent on (starts the 30-day clock)', t: 'date' }] : []),
  { n: 'notes', l: 'Notes', t: 'textarea' },
];
function coverageModal(existing) {
  const defs = coverageDefs();
  const first = { type: S.caseData.case.injury_type === 'workers_comp' ? 'workers_comp' : (S.caseData.coverages || []).length ? 'health' : 'pip' };
  openModal({ title: existing ? 'Edit insurance' : 'Add insurance', wide: true, body: fieldsHtml(defs, existing || first),
    onOk: async (el) => saveChild('coverages', { ...readFields(el, defs), ...(existing ? { id: existing.id } : {}) }) });
}

// Marking coverage denied/exhausted closes it, then offers (never forces)
// to move what's still open with that carrier to the patient balance.
function coverageStatusModal(cv, status) {
  const ph = { denied: 'e.g. late notice, IME cut-off, no coverage', exhausted: 'e.g. $10,000 paid', closed: 'e.g. claim closed', active: 'e.g. denial overturned' }[status];
  const defs = [{ n: 'status_on', l: 'Effective date', t: 'date', req: true }, { n: 'status_reason', l: 'Reason', ph, full: true }];
  openModal({
    title: `${status === 'active' ? 'Reactivate' : 'Mark ' + label('coverageStatus', status).toLowerCase()}: ${covName(cv)}`,
    body: fieldsHtml(defs, { status_on: today(), status_reason: status === 'active' ? '' : cv.status_reason || '' }),
    okText: 'Save',
    onOk: async (el) => {
      await saveChild('coverages', { id: cv.id, status, ...readFields(el, defs) });
      const open = (S.caseData.openItems || []).filter((i) => i.coverage_id === cv.id && i.ins_open > 0.005);
      if (status !== 'active' && open.length) {
        const reason = status === 'denied' ? `${label('coverageTypes', cv.type)} denied` : status === 'exhausted' ? `${label('coverageTypes', cv.type)} exhausted` : 'Not covered by insurance';
        moveModal({ fromValue: String(cv.id), reason, title: `${money(open.reduce((s, i) => s + i.ins_open, 0))} is still open with ${covName(cv)}` });
      }
    },
  });
}

// ----- moving balances -----
// Lists what is open with the source (one coverage, or the patient
// balance), lets the user tick/adjust amounts, and moves them. "Keep open"
// leaves everything where it is.
function moveModal({ fromValue = null, chargeId = null, amount = null, reason = '', title = 'Move balance' } = {}) {
  const d = S.caseData;
  const items = d.openItems || [];
  let from = fromValue;
  if (!from && chargeId) { const it = items.find((i) => i.id === chargeId); from = it && it.ins_open > 0.005 ? String(it.coverage_id || '') : 'patient'; }
  if (!from) from = holderOpts({ patient: false }).length ? holderOpts({ patient: false })[0][0] : 'patient';
  const doMove = async (el) => {
    const src = el.querySelector('#mv-from').value;
    const sel = [...el.querySelectorAll('[data-mv]:checked')].map((cb) => {
      const key = cb.dataset.mv, amt = +el.querySelector(`[data-mv-amt="${key}"]`).value;
      return { from: src === 'patient' ? 'patient' : 'insurance', coverage_id: src === 'patient' ? null : +src, applies_to_id: key === 'none' ? null : +key, amount: amt };
    }).filter((x) => x.amount > 0);
    if (!sel.length) throw new Error('Tick at least one line with an amount.');
    S.caseData = await api('cases.php?action=move_balance&id=' + d.case.id, { to: el.querySelector('#mv-to').value, date: el.querySelector('#mv-date').value, reason: el.querySelector('#mv-reason').value, items: sel });
    renderCase(); toast('Moved ' + money(sel.reduce((sum, x) => sum + x.amount, 0)));
  };
  const m = openModal({ title, wide: true, okText: 'Move selected', cancelText: 'Keep open', onOk: doMove, body: `
    <div class="form-grid">
      <div><label for="mv-from">Move from</label><select id="mv-from">${holderOpts({}).map(([v, t]) => opt(v, t, from)).join('')}</select></div>
      <div><label for="mv-to">Move to</label><select id="mv-to"></select></div>
      <div><label for="mv-date">Date</label><input type="date" id="mv-date" value="${today()}"></div>
      <div><label for="mv-reason">Reason</label><input id="mv-reason" list="mv-reasons" value="${esc(reason)}"><datalist id="mv-reasons">${MOVE_REASONS.map((r) => `<option value="${esc(r)}">`).join('')}</datalist></div>
    </div>
    <div class="notice mt hidden" id="mv-wc">Florida generally doesn't allow billing an injured worker for workers' comp care. Consider an appeal or a write-off instead of moving this to the patient balance.</div>
    <div id="mv-list" class="mt"></div>` });
  const el = m.el;
  const render = () => {
    const src = el.querySelector('#mv-from').value;
    const srcCov = src === 'patient' ? null : covById(src);
    const toSel = el.querySelector('#mv-to');
    const keep = toSel.value;
    toSel.innerHTML = holderOpts({ exclude: src }).map(([v, t]) => opt(v, t, keep || (src === 'patient' ? '' : 'patient'))).join('');
    const open = items.filter((i) => src === 'patient' ? i.pat_open > 0.005 : (i.coverage_id === +src && i.ins_open > 0.005));
    const total = src === 'patient' ? d.totals.patient_balance : ((d.totals.by_coverage[src] || {}).balance || 0);
    const unapplied = Math.round((total - open.reduce((s, i) => s + (src === 'patient' ? i.pat_open : i.ins_open), 0)) * 100) / 100;
    el.querySelector('#mv-list').innerHTML = open.length || unapplied > 0.005 ? `<table><thead><tr><th></th><th>Date of service</th><th>Description</th><th class="num">Open</th><th class="num">Amount to move</th></tr></thead><tbody>
      ${open.map((i) => { const amt = src === 'patient' ? i.pat_open : i.ins_open; const pre = chargeId ? i.id === chargeId : true;
        return `<tr><td><input type="checkbox" data-mv="${i.id}"${pre ? ' checked' : ''} aria-label="Select"></td><td class="nowrap">${esc(fmtDate(i.date))}</td><td class="small">${esc(i.memo || '')}</td>
          <td class="num">${money(amt)}</td><td class="num"><input type="number" step="0.01" min="0" max="${amt}" value="${chargeId && i.id === chargeId && amount ? amount : amt}" data-mv-amt="${i.id}" class="amt"></td></tr>`; }).join('')}
      ${unapplied > 0.005 && !chargeId ? `<tr><td><input type="checkbox" data-mv="none" checked aria-label="Select"></td><td colspan="2" class="small">Balance not tied to a date of service</td><td class="num">${money(unapplied)}</td>
          <td class="num"><input type="number" step="0.01" min="0" value="${unapplied}" data-mv-amt="none" class="amt"></td></tr>` : ''}
      </tbody></table>` : `<div class="empty">Nothing is open with ${esc(srcCov ? covName(srcCov) : 'the patient balance')}.</div>`;
    const wcWarn = () => el.querySelector('#mv-wc').classList.toggle('hidden', !(srcCov && srcCov.type === 'workers_comp' && toSel.value === 'patient'));
    wcWarn(); toSel.onchange = wcWarn;
  };
  el.querySelector('#mv-from').addEventListener('change', () => { el.querySelector('#mv-to').value = ''; render(); });
  render();
}

// ----- payments & charges -----
function paymentModal(chargeId) {
  const d = S.caseData, items = d.openItems || [];
  const it = chargeId ? items.find((i) => i.id === chargeId) : null;
  const payer = it ? (it.ins_open > 0.005 ? String(it.coverage_id || '') : 'patient') : defaultBillTo();
  const defs = [
    { n: 'entry_date', l: 'Date received', t: 'date', req: true },
    { n: 'kind', l: 'Type', t: 'select', blank: false, opts: LEDGER_KINDS.filter(([k]) => !['charge', 'transfer'].includes(k)) },
    { n: 'holder', l: 'From', t: 'select', blank: false, opts: holderOpts({}).map(([v, t]) => [v, v === 'patient' ? 'Patient / attorney (patient balance)' : t]) },
    { n: 'amount', l: 'Amount ($)', t: 'money', req: true },
    { n: 'applies_to_id', l: 'Apply to date of service', t: 'select', blank: '— not tied to a date of service —', opts: items.map((i) => [String(i.id), chargeLabel(i)]), full: true },
    { n: 'reference', l: 'Check / EOB #' }, { n: 'memo', l: 'Memo' },
  ];
  openModal({ title: 'Post payment', wide: true, body: fieldsHtml(defs, { entry_date: today(), kind: 'payment', holder: payer, applies_to_id: it ? String(it.id) : '' })
      + '<p class="small muted">Late payments are fine — date it when it arrived and apply it to the original date of service.</p>',
    onOk: async (el) => {
      const v = readFields(el, defs); const h = parseHolder(v.holder); delete v.holder;
      await saveChild('ledger', { ...v, ...h });
      // Suggest, never force: if insurance paid less than billed, offer to move the rest.
      if (h.bucket === 'insurance' && v.applies_to_id && v.kind === 'payment') {
        const now = (S.caseData.openItems || []).find((i) => i.id === +v.applies_to_id);
        if (now && now.ins_open > 0.005 && now.coverage_id === h.coverage_id) {
          moveModal({ fromValue: String(h.coverage_id), chargeId: now.id, amount: now.ins_open, reason: covById(h.coverage_id)?.type === 'pip' ? '20% PIP coinsurance' : 'Not covered by insurance',
            title: `${covName(covById(h.coverage_id))} paid ${money(v.amount)} — ${money(now.ins_open)} is still open on ${fmtDate(now.date)}` });
        }
      }
    } });
}

function chargeModal() {
  const defs = [{ n: 'entry_date', l: 'Date of service', t: 'date', req: true }, { n: 'amount', l: 'Amount ($)', t: 'money', req: true },
    { n: 'holder', l: 'Bill to', t: 'select', blank: false, opts: holderOpts({ activeOnly: true }) }, { n: 'memo', l: 'Description', ph: 'e.g. CPT 98941, 97140' }, { n: 'reference', l: 'Reference' }];
  openModal({ title: 'Add charge', body: fieldsHtml(defs, { entry_date: today(), holder: defaultBillTo() }), onOk: async (el) => {
    const v = readFields(el, defs); const h = parseHolder(v.holder); delete v.holder;
    await saveChild('ledger', { ...v, ...h, kind: 'charge' });
  } });
}

// Any ledger entry can be corrected at any time (amount, date, who it's
// from, which date of service it applies to).
function ledgerEditModal(row) {
  const items = S.caseData.openItems || [];
  const isTransfer = row.kind === 'transfer', isCharge = row.kind === 'charge';
  const defs = [
    { n: 'entry_date', l: isCharge ? 'Date of service' : 'Date', t: 'date', req: true },
    { n: 'kind', l: 'Type', t: 'select', blank: false, opts: isTransfer ? [['transfer', 'Move balance']] : LEDGER_KINDS.filter(([k]) => k !== 'transfer' && (isCharge ? k === 'charge' : k !== 'charge')) },
    { n: 'holder', l: isCharge ? 'Billed to' : isTransfer ? 'Moved from' : 'From', t: 'select', blank: false, opts: holderOpts({}) },
    ...(isTransfer ? [{ n: 'to_holder', l: 'Moved to', t: 'select', blank: false, opts: holderOpts({}) }] : []),
    { n: 'amount', l: 'Amount ($)', t: 'money', req: true },
    ...(isCharge ? [] : [{ n: 'applies_to_id', l: 'Applies to date of service', t: 'select', blank: '— not tied to a date of service —', opts: items.map((i) => [String(i.id), chargeLabel(i)]), full: true }]),
    { n: 'reference', l: 'Reference' }, { n: 'memo', l: 'Memo' },
  ];
  openModal({ title: 'Edit ledger entry', wide: true,
    body: fieldsHtml(defs, { ...row, holder: holderValue(row.bucket, row.coverage_id), to_holder: holderValue(row.to_bucket, row.to_coverage_id), applies_to_id: row.applies_to_id ? String(row.applies_to_id) : '' }),
    onOk: async (el) => {
      const v = readFields(el, defs); const h = parseHolder(v.holder); delete v.holder;
      if (isTransfer) { const to = parseHolder(v.to_holder); delete v.to_holder; v.to_bucket = to.bucket; v.to_coverage_id = to.coverage_id; }
      await saveChild('ledger', { id: row.id, ...v, ...h });
    } });
}

// ----- EHR ledger upload -----
// Two steps: preview (checks it's the right patient, shows what changes),
// then apply. The EHR's numbers replace the case's EHR-sourced lines.
// Upload one patient's ledger from the practice's EHR — any EHR:
//   spreadsheet (CSV/Excel): columns mapped once per EHR, then remembered
//   PDF: read directly where there's a built-in reader (DrChrono)
//   totals: typed in when nothing else is available
// Every route ends at the same preview, then "Apply to case".
const SHEET_CAT_OPTS = [['charge', 'Charge'], ['insurance_payment', 'Insurance payment'], ['patient_payment', 'Patient payment'],
  ['adjustment', 'Adjustment / write-off'], ['transfer', 'Moved to patient responsibility'], ['ignore', 'Ignore']];
function ehrUploadModal() {
  const d = S.caseData;
  const ehr = S.practice?.ehrName || 'your EHR';
  let step = 'file', token = null, preview = null, insp = null, pdfMessage = null;
  const icon = { ok: '✓', fill: '+', mismatch: '!', missing: '–', info: 'i' };
  const m = openModal({ title: 'Upload EHR ledger', wide: true, okText: 'Continue', body: '<div id="ehr-step"></div>', onOk: async (el) => {
    if (step === 'file') {
      const file = el.querySelector('#ehr-file').files[0];
      if (!file) throw new Error('Choose the ledger file first.');
      const fd = new FormData(); fd.append('case_id', d.case.id); fd.append('file', file);
      const r = await api('ehr.php?action=preview', fd);
      token = r.token;
      if (r.needsMapping) { insp = r; showMap(r.error); }
      else if (r.unrecognized) { pdfMessage = r.message; showTotals(); }
      else showPreview(r);
      return false;
    }
    if (step === 'map') { showPreview(await api('ehr.php?action=map', readMapping(el))); return false; }
    if (step === 'totals') { showPreview(await api('ehr.php?action=totals', readTotals(el))); return false; }
    // preview → apply
    if (preview.blocked) throw new Error(preview.blocked);
    const confirmM = el.querySelector('#ehr-confirm'), confirmT = el.querySelector('#ehr-totals-ok');
    if (confirmM && !confirmM.checked) throw new Error("Confirm it's the right patient, or cancel.");
    if (confirmT && !confirmT.checked) throw new Error(`Compare the totals with ${preview.system} and tick the box to confirm.`);
    const r = await api('ehr.php?action=apply', { token: preview.token, create_visits: !!el.querySelector('#ehr-visits')?.checked,
      replace_manual: !!el.querySelector('#ehr-manual')?.checked,
      confirm_mismatch: !!confirmM?.checked, confirm_totals: !!confirmT?.checked });
    toast(`Ledger applied${r.visitsCreated ? ' — ' + r.visitsCreated + ' visits added' : ''}`);
    await reloadCase();
  } });
  const host = m.el.querySelector('#ehr-step');
  const okBtn = m.el.querySelector('[data-ok]');
  const setErr = (t) => { m.el.querySelector('[data-role=err]').textContent = t || ''; };

  function showFile() {
    step = 'file'; okBtn.textContent = 'Continue'; setErr('');
    host.innerHTML = `<p class="small">Export <strong>this patient's ledger</strong> from ${esc(ehr)} and upload it. One patient per upload — filter the report to this patient before exporting. ${esc(ehr === 'your EHR' ? 'Your EHR' : ehr)} stays the source of truth: this case's charges, payments and patient/insurance split will mirror it.</p>
      <ul class="small muted mt"><li><strong>Spreadsheet (CSV or Excel)</strong> — works with every EHR. The first time, you'll match up the columns; after that it's automatic.</li>
        <li><strong>PDF</strong> — read directly for DrChrono billing ledgers.</li></ul>
      <div class="filters mt"><input type="file" id="ehr-file" accept=".csv,.xlsx,.pdf,.txt,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" aria-label="Ledger file"></div>
      <p class="small mt">No export available? <button class="linklike" id="ehr-to-totals">Enter the ledger totals instead</button></p>`;
    host.querySelector('#ehr-to-totals').addEventListener('click', () => { pdfMessage = null; showTotals(); });
  }

  // ---- column mapping ----
  function colOptions(selected) {
    return opt('', '— not in this file —', selected ?? '') + insp.header.map((h, i) => opt(i, `${String.fromCharCode(65 + (i % 26))} · ${h || '(blank)'}`, selected ?? '')).join('');
  }
  function showMap(error) {
    step = 'map'; okBtn.textContent = 'Preview'; setErr(error || '');
    const saved = insp.saved;
    const layout = saved?.layout || insp.guess.layout;
    const name = saved?.name || insp.ehrName || '';
    host.innerHTML = `<p class="small">${saved ? 'This file doesn\'t fit the saved layout exactly — check the columns below.' : 'First upload in this layout: tell us which column is which. We\'ll remember it for next time.'}
        Columns we recognised are filled in.</p>
      <div class="form-grid mt">
        <div><label for="map-name">EHR</label><input id="map-name" list="ehr-names" value="${esc(name)}" placeholder="e.g. ChiroTouch" autocomplete="off">
          <datalist id="ehr-names">${(insp.ehrs || []).map((n) => `<option value="${esc(n)}">`).join('')}</datalist></div>
        <div><label for="map-header">Column headings are on</label><select id="map-header">${insp.topRows.map((r, i) => opt(i, `Row ${i + 1}: ${r.filter(Boolean).slice(0, 4).join(' · ').slice(0, 60)}`, insp.headerRow)).join('')}</select></div>
        <div class="full"><label>The file has</label>
          <label class="check"><input type="radio" name="map-layout" value="lines"${layout === 'lines' ? ' checked' : ''}> <span><strong>One row per charge</strong> <span class="small muted">— each CPT line with its billed, paid and balance amounts</span></span></label>
          <label class="check"><input type="radio" name="map-layout" value="transactions"${layout === 'transactions' ? ' checked' : ''}> <span><strong>One row per transaction</strong> <span class="small muted">— charges, payments and adjustments each on their own row</span></span></label></div>
      </div>
      <div id="map-cols" class="form-grid mt"></div>
      <div id="map-types"></div>
      <div class="form-grid mt">
        <div><label for="map-dates">Dates like 3/4/2026 mean</label><select id="map-dates">${opt('mdy', 'March 4 (US)', saved?.date_order || insp.dateOrder)}${opt('dmy', '3 April', saved?.date_order || insp.dateOrder)}</select></div>
        <div><label>&nbsp;</label><label class="check"><input type="checkbox" id="map-save" checked> Remember this layout for future uploads</label></div>
      </div>
      <h3 class="mt">First rows of the file</h3>
      <div class="table-wrap sample"><table><thead><tr>${insp.header.map((h, i) => `<th>${String.fromCharCode(65 + (i % 26))} · ${esc(h)}</th>`).join('')}</tr></thead>
        <tbody>${insp.sample.map((r) => `<tr>${insp.header.map((_, i) => `<td class="small">${esc(r[i] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    const renderCols = () => {
      const lay = host.querySelector('[name=map-layout]:checked').value;
      const cols = (saved && saved.layout === lay ? saved.columns : null) || insp.guess.columns[lay] || {};
      host.querySelector('#map-cols').innerHTML = Object.entries(insp.fields[lay]).map(([f, [lbl, req]]) =>
        `<div><label for="mc-${f}">${esc(lbl)}${req ? ' *' : ''}</label><select id="mc-${f}" data-col="${f}">${colOptions(cols[f])}</select></div>`).join('')
        + (lay === 'transactions' ? '<p class="full small muted">Map either the one Amount column (plus Type or Description), or the separate Charges / Payments / Adjustments columns.</p>' : '<p class="full small muted">Map at least one balance column (patient or insurance) if the file has one — otherwise any unpaid amount counts as owed by insurance.</p>');
      host.querySelectorAll('[data-col=type],[data-col=description]').forEach((x) => x.addEventListener('change', renderTypes));
      renderTypes();
    };
    const renderTypes = () => {
      const lay = host.querySelector('[name=map-layout]:checked').value;
      const box = host.querySelector('#map-types');
      if (lay !== 'transactions') { box.innerHTML = ''; return; }
      const tc = host.querySelector('[data-col=type]').value || host.querySelector('[data-col=description]').value;
      const values = tc === '' ? null : insp.distinct[tc];
      const savedTypes = saved?.types || {};
      const sep = !host.querySelector('[data-col=amount]').value;
      box.innerHTML = `${values && values.length ? `<h3 class="mt">What each ${tc === host.querySelector('[data-col=type]').value ? 'type' : 'description'} means</h3>
          <div class="form-grid">${values.map((v, i) => `<div><label for="mt-${i}" class="small">${esc(v)}</label><select id="mt-${i}" data-type-value="${esc(v)}">${SHEET_CAT_OPTS.map(([k, t]) => opt(k, t, savedTypes[v] || insp.typeGuess[tc]?.[v] || 'ignore')).join('')}</select></div>`).join('')}</div>`
        : tc !== '' ? '<p class="small muted mt">That column has too many different values to list; they\'ll be read by keyword (e.g. “Ins Pmt”, “Copay”, “Adj”).</p>' : ''}
        ${sep ? `<div class="form-grid mt"><div><label for="map-defpay">Payments with no clear type are from</label><select id="map-defpay">${opt('insurance_payment', 'Insurance', saved?.default_payment)}${opt('patient_payment', 'The patient', saved?.default_payment)}${opt('ignore', 'Skip them', saved?.default_payment || 'ignore')}</select></div></div>` : ''}`;
    };
    host.querySelectorAll('[name=map-layout]').forEach((x) => x.addEventListener('change', renderCols));
    host.querySelector('#map-header').addEventListener('change', async (e) => {
      const r = await attempt(() => api('ehr.php?action=inspect', { token, header_row: +e.target.value }));
      if (r) { insp = r; showMap(); }
    });
    renderCols();
  }
  function readMapping(el) {
    const columns = {};
    el.querySelectorAll('[data-col]').forEach((x) => { if (x.value !== '') columns[x.dataset.col] = +x.value; });
    const types = {};
    el.querySelectorAll('[data-type-value]').forEach((x) => { types[x.dataset.typeValue] = x.value; });
    return { token, header_row: +el.querySelector('#map-header').value, name: el.querySelector('#map-name').value.trim(), save: el.querySelector('#map-save').checked,
      mapping: { layout: el.querySelector('[name=map-layout]:checked').value, columns, types, date_order: el.querySelector('#map-dates').value, default_payment: el.querySelector('#map-defpay')?.value || 'ignore' } };
  }

  // ---- typed totals ----
  const TOTAL_DEFS = [{ n: 'ehr_name', l: 'EHR' }, { n: 'as_of', l: 'Totals as of', t: 'date', req: true }, { n: 'first_dos', l: 'First date of service', t: 'date' },
    { n: 'billed', l: 'Total billed ($)', t: 'money', req: true }, { n: 'insurance_paid', l: 'Insurance paid ($)', t: 'money' }, { n: 'patient_paid', l: 'Patient paid ($)', t: 'money' },
    { n: 'adjustment', l: 'Adjustments / write-offs ($)', t: 'money' }, { n: 'insurance_balance', l: 'Insurance balance ($)', t: 'money' }, { n: 'patient_balance', l: 'Patient balance ($)', t: 'money' }];
  function showTotals() {
    step = 'totals'; okBtn.textContent = 'Preview'; setErr('');
    host.innerHTML = `${pdfMessage ? `<div class="notice">${esc(pdfMessage)}</div>` : ''}
      <p class="small mt">Copy the totals from the patient's ledger in ${esc(ehr)}. The case will show these balances (without line-by-line detail) until you upload a spreadsheet.</p>
      ${fieldsHtml(TOTAL_DEFS, { ehr_name: S.practice?.ehrName || '', as_of: today() })}
      <p class="small mt" id="tot-check"></p>`;
    const check = () => {
      const v = (n) => +(host.querySelector(`[name=${n}]`).value || 0);
      const left = v('billed') - v('insurance_paid') - v('patient_paid') - v('adjustment'), right = v('insurance_balance') + v('patient_balance');
      host.querySelector('#tot-check').innerHTML = v('billed') ? (Math.abs(left - right) < 0.005 ? '<span class="chip teal">Adds up</span> billed − paid − adjustments = the two balances'
        : `<span class="chip ochre">Off by ${money(Math.abs(left - right))}</span> billed − paid − adjustments = ${money(left)}, balances = ${money(right)}`) : '';
    };
    host.querySelectorAll('input').forEach((x) => x.addEventListener('input', check));
  }
  const readTotals = (el) => ({ ...readFields(el, TOTAL_DEFS), case_id: d.case.id, token });

  // ---- preview (all routes) ----
  function showPreview(pv) {
    step = 'preview'; preview = pv; token = pv.token; okBtn.textContent = 'Apply to case'; setErr('');
    const L = pv.ledger, C = pv.current;
    const fileWord = { pdf: 'PDF', csv: 'spreadsheet', xlsx: 'spreadsheet' }[pv.fileKind] || 'file';
    host.innerHTML = `
      ${pv.format ? `<p class="small">Read with the saved <strong>${esc(pv.format.name)}</strong> layout. <button class="linklike" id="ehr-remap">Change column mapping</button></p>` : ''}
      ${pv.method === 'spreadsheet' && !pv.format ? `<p class="small"><button class="linklike" id="ehr-remap">Back to column mapping</button></p>` : ''}
      ${pv.checks.length ? `<h3 class="mt">Is this the right patient?</h3>
      <ul class="checks">${pv.checks.map((k) => `<li class="ck-${esc(k.status)}"><span class="ck">${icon[k.status] || '·'}</span><strong>${esc(k.label)}</strong> <span class="small muted">${esc(k.detail)}</span></li>`).join('')}</ul>` : ''}
      ${pv.blocked ? `<div class="notice mt">${esc(pv.blocked)}</div>` : ''}
      <h3 class="mt">What changes</h3>
      <table><thead><tr><th></th><th class="num">${esc(pv.system)}</th><th class="num">Now in ${esc(S.brand.name)}</th></tr></thead><tbody>
        <tr><td>Total charges</td><td class="num">${money(L.billed)}</td><td class="num">${money(C.charges)}</td></tr>
        <tr><td>Insurance balance</td><td class="num"><strong>${money(L.insuranceBalance)}</strong></td><td class="num">${money(C.insuranceBalance)}</td></tr>
        <tr><td>Patient balance</td><td class="num"><strong>${money(L.patientBalance)}</strong></td><td class="num">${money(C.patientBalance)}</td></tr>
        <tr><td class="small muted">Insurance paid · patient paid · adjustments</td><td class="num small">${money(L.insurancePaid)} · ${money(L.patientPaid)} · ${money(L.adjustment)}</td><td></td></tr>
      </tbody></table>
      ${pv.method !== 'totals' ? `<p class="small muted">${pv.counts.lines} charge line${pv.counts.lines === 1 ? '' : 's'} across ${pv.counts.visits} date${pv.counts.visits === 1 ? '' : 's'} of service (${esc(fmtDate(pv.firstDos))} – ${esc(fmtDate(pv.lastDos))}).</p>
      ${pv.counts.newVisits ? `<label class="check mt"><input type="checkbox" id="ehr-visits" checked> Add the ${pv.counts.newVisits} visit${pv.counts.newVisits === 1 ? '' : 's'} not yet on this case (with CPT and ICD-10 codes)</label>` : ''}` : ''}
      ${pv.counts.manualRows ? `<label class="check"><input type="checkbox" id="ehr-manual" checked> Retire the ${pv.counts.manualRows} manually entered ledger line${pv.counts.manualRows === 1 ? '' : 's'} (e.g. opening balances) — the EHR replaces them</label>` : ''}
      <p class="small muted">The ${fileWord} is only read — it isn't kept.</p>
      ${!pv.verified && !pv.blocked ? `<div class="notice mt"><label class="check"><input type="checkbox" id="ehr-totals-ok"> I've compared these totals with ${esc(pv.system)} and they match, and this is ${esc(pv.patientName)}'s ledger.</label></div>` : ''}
      ${pv.needsOverride ? `<div class="notice mt"><label class="check"><input type="checkbox" id="ehr-confirm"> The name and date of birth don't match this case. I've confirmed this is the right patient.</label></div>` : ''}`;
    host.querySelector('#ehr-remap')?.addEventListener('click', async () => {
      const r = await attempt(() => api('ehr.php?action=inspect', { token, header_row: pv.headerRow ?? undefined }));
      if (r) { insp = r; showMap(); }
    });
    okBtn.disabled = !!pv.blocked;
  }
  showFile();
}

// ----- policy limits & case value -----
// Keeps the bills in proportion to what the case can pay: PIP left, and
// medical bills against the liability limits, with soft thresholds.
const LIMIT_DEFS = [
  { n: 'bi_limit', l: "At-fault driver's bodily-injury limit ($)", t: 'money', ph: 'e.g. 25000' },
  { n: 'um_limit', l: "Patient's UM/UIM limit ($)", t: 'money' },
  { n: 'liability_carrier', l: 'At-fault insurer', ph: 'e.g. State Farm' },
  { n: 'other_medical_estimate', l: 'Other bills not itemized, lump sum ($)', t: 'money', ph: 'Itemize under Financials → Other providers' },
  { n: 'limits_source', l: 'Where this came from', ph: 'e.g. Attorney call — Jane, Smith Law' },
  { n: 'limits_noted_on', l: 'As of', t: 'date' },
];
function limitsModal() {
  const c = S.caseData.case;
  openModal({ title: 'Policy limits', wide: true, okText: 'Save',
    body: `<p class="small">The attorney usually knows the at-fault driver's limits by the first call. These are the money that will pay the claim — medical bills, the attorney's fee and the patient's recovery all come out of them.</p>${fieldsHtml(LIMIT_DEFS, { limits_noted_on: today(), ...Object.fromEntries(LIMIT_DEFS.map((f) => [f.n, c[f.n] ?? (f.n === 'limits_noted_on' ? today() : '')])) })}`,
    onOk: async (el) => { S.caseData = await api('cases.php?action=update&id=' + c.id, { case: readFields(el, LIMIT_DEFS) }); renderCase(); toast('Policy limits saved'); } });
}
// The rules of the case's state, from the server (app/jurisdictions.php).
function stateRulesCardHtml(d) {
  const r = d.rules;
  return `<div class="card"><div class="card-head"><h2>${esc(r.name)} rules</h2><span class="chip ${r.support === 'full' ? 'teal' : r.support === 'limited' ? 'ochre' : ''}">${esc(S.lookups.supportLabels[r.support])}</span><span class="spacer"></span><a class="small" href="#/playbook?state=${esc(r.code)}">Playbook</a></div>
    ${r.verified ? '' : `<div class="notice small">Draft rules from published sources — confirm with an attorney licensed in ${esc(r.name)} before relying on them. Not legal advice.</div>`}
    ${r.support === 'limited' ? '<div class="notice small">This state caps provider charges and reviews care in ways this app only partly models — balances, letters of protection and reductions may not apply.</div>' : ''}
    <details class="mt-sm"><summary class="small">What's different in ${esc(r.name)}</summary><dl class="kv small mt-sm">${r.summary.map(([t, x]) => `<dt>${esc(t)}</dt><dd>${esc(x)}</dd>`).join('')}</dl></details></div>`;
}

function caseValueCardHtml(d) {
  const v = d.caseValue;
  if (!v) return '';
  const edit = can('case.write') || can('finance.write');
  const p = v.pip, l = v.limits;
  const pipHtml = p ? `<div class="cv-block"><div class="cv-title">PIP remaining <span class="small muted">${p.source === 'carrier' ? `carrier reported ${money(p.reported)} on ${esc(fmtDate(p.reportedOn))}${p.paidSince ? `, less ${money(p.paidSince)} paid to us since` : ''}` : `limit ${money(p.limit)} less PIP paid to us — other providers draw on PIP too; ask the adjuster for the real figure`}</span></div>
      <div class="cv-big">${money(p.remaining)}</div>
      <div class="bar ${p.remaining < 1500 ? 'over' : p.remaining < p.limit * 0.3 ? 'warn' : ''}"><i data-w="${p.limit ? Math.max(0, Math.min(100, Math.round(p.remaining / p.limit * 100))) : 0}"></i></div></div>` : '';
  let limHtml;
  if (!l) limHtml = `<div class="cv-block"><div class="cv-title">Medical bills vs. policy limits</div><p class="small muted">Policy limits not recorded yet. Ask the attorney for the at-fault driver's bodily-injury limit and the patient's UM coverage.</p>${edit ? '<button class="btn sm" data-act="edit-limits">Add policy limits</button>' : ''}</div>`;
  else {
    const pct = Math.round(l.share * 100);
    const lvl = l.share >= 0.75 ? 'over' : l.share >= 0.5 ? 'warn' : l.share >= 1 / 3 ? 'note' : '';
    const nextText = l.next ? `At the recent pace (~${money(l.perWeek)}/week of our charges), bills reach ${Math.round(l.next.share * 100)}% of the limits around <strong>${esc(fmtDate(l.next.date))}</strong>.` : l.perWeek ? '' : 'No new charges in the last four weeks.';
    limHtml = `<div class="cv-block"><div class="cv-title">Medical bills vs. policy limits <span class="small muted">${l.bi ? 'BI ' + money(l.bi) : ''}${l.bi && l.um ? ' + ' : ''}${l.um ? 'UM ' + money(l.um) : ''}${l.carrier ? ' · ' + esc(l.carrier) : ''}${l.source ? ' · ' + esc(l.source) : ''}</span></div>
      <div class="cv-big">${pct}% <span class="small muted">of ${money(l.pool)}</span></div>
      <div class="limit-meter ${lvl}"><i data-w="${Math.min(100, pct)}"></i>${l.thresholds.map((t) => `<b data-w="${Math.round(t * 100)}" title="${Math.round(t * 100)}%"></b>`).join('')}</div>
      <div class="limit-scale small muted"><span>0</span><span>⅓</span><span>½</span><span>¾</span><span>Limits</span></div>
      <div class="money-row small"><span>Our charges</span><strong>${money(l.ours)}</strong></div>
      <div class="money-row small"><span>Other providers (estimate)</span><strong>${l.other ? money(l.other) : '—'}</strong></div>
      <div class="money-row small"><span><strong>Total medical bills</strong></span><strong>${money(l.medical)}</strong></div>
      <p class="small mt-sm">${nextText}</p>
      <p class="small muted">A settlement usually splits into thirds — attorney's fee, medical bills, the patient. Past about a third, reductions become likely; plan care and other coverage (UM, health insurance, MedPay) with the attorney. Clinical decisions stay with the doctor.</p>
      ${edit ? '<button class="btn ghost sm" data-act="edit-limits">Edit limits</button>' : ''}</div>`;
  }
  const o = v.outside;
  const outHtml = o && o.locked ? `<div class="cv-block"><div class="cv-title">Other providers' bills</div>
      <div class="notice small">Estimating other facilities' bills from referrals (MRI, specialists, injections) is part of the ${esc(featureInfo('outside_estimates').planName)} plan and up. <a href="#/billing">See plans</a></div>
      ${o.lump ? `<div class="money-row small"><span>Other bills (lump sum)</span><strong>${money(o.lump)}</strong></div>` : ''}</div>`
    : o ? `<div class="cv-block"><div class="cv-title">Other providers' bills <span class="small muted">estimated from referrals and your cost list</span></div>
      <div class="cv-big">${money(o.all)}</div>
      ${o.lines.length || o.lump ? `<div class="est-lines">${o.lines.map((l) => `<div class="money-row small${l.excluded ? ' muted' : ''}"><span>${esc(l.label)} <span class="muted">· ${+l.qty} ${esc(l.unit)}${+l.qty === 1 ? '' : 's'} × ${money(l.unitCost)}${l.adjusted ? ' · adjusted' : l.referralId ? ' · from referral' : ''}</span></span><strong>${l.excluded ? 'left out' : money(l.amount)}</strong></div>`).join('')}
        ${o.lump ? `<div class="money-row small"><span>Other bills not itemized</span><strong>${money(o.lump)}</strong></div>` : ''}</div>`
        : '<p class="small muted">No outside referrals yet. MRI, ortho, neurology, pain management and other referrals add estimated bills here automatically.</p>'}
      <p class="small muted">Estimates for planning only — actual bills from other facilities will differ.</p>
      ${edit ? '<button class="btn ghost sm" data-act="edit-estimates">Adjust estimates</button>' : ''}</div>` : '';
  const th = v.threshold;
  const thHtml = th ? `<div class="cv-block"><div class="cv-title">Lawsuit threshold <span class="small muted">${esc(th.state)}</span></div>
      ${th.dollars ? `<div class="cv-big">${th.met ? '✓ Met' : money(th.dollars - th.amount) + ' to go'} <span class="small muted">${money(th.amount)} of ${money(th.dollars)}</span></div>
      <div class="bar ${th.met ? '' : 'warn'}"><i data-w="${Math.min(100, Math.round(th.amount / th.dollars * 100))}"></i></div><p class="small muted">${esc(th.counts)}. Other injury categories can also qualify.</p>` : ''}
      <p class="small">${esc(th.text)}</p></div>` : '';
  return `<div class="card case-value"><h2>Policy limits &amp; case value</h2>${pipHtml}${limHtml}${outHtml}${thHtml}</div>`;
}

// Other providers' estimated bills: adjust a referral's line (count or unit
// cost, or leave it out), or add lines such as injections, ER or surgery.
function estimatesModal() {
  const d = S.caseData, o = d.caseValue.outside, costs = S.lookups.outsideCosts;
  const rows = o.lines.map((l, i) => `<tr data-i="${i}"><td>${esc(l.label)}${l.referralId ? '<div class="small muted">From a referral</div>' : ''}</td>
      <td><input type="number" min="0" step="0.5" class="est-qty" value="${+l.qty}" aria-label="Count"> <span class="small muted">${esc(l.unit)}s</span></td>
      <td><input type="number" min="0" step="1" class="est-cost" value="${+l.unitCost}" aria-label="Cost each"></td>
      <td class="nowrap">${l.referralId ? '<span class="small muted">Set count to 0 to leave out</span>' : `<button type="button" class="btn link small" data-est-remove="${l.id}">Remove</button>`}</td></tr>`).join('');
  const m = openModal({ title: "Other providers' bills — estimates", wide: true, okText: 'Save estimates', body: `
    <p class="small">Expected charges at other facilities, used for the policy-limits and case-value math. Referrals add lines automatically from your <a href="#/settings">cost list</a>; change any count or cost for this case.</p>
    <div class="table-wrap mt"><table class="est-table"><thead><tr><th>Item</th><th>Count</th><th>Cost each ($)</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="empty">No lines yet.</td></tr>'}</tbody></table></div>
    <h3 class="mt">Add a line</h3>
    <div class="form-grid mt-sm"><div><label for="est-cat">Item</label><select id="est-cat">${entries(costs).map(([k, c]) => opt(k, `${c.label} — ${money(c.cost)} per ${c.unit}`, 'injection')).join('')}<option value="custom">Other (describe)</option></select></div>
      <div><label for="est-desc">Description (optional)</label><input id="est-desc" placeholder="e.g. L4-5 epidural, Tampa Pain Center"></div>
      <div><label for="est-qty">Count</label><input id="est-qty" type="number" min="0" step="0.5" value="1"></div>
      <div><label for="est-cost">Cost each ($, blank = cost list)</label><input id="est-cost" type="number" min="0" step="1"></div></div>
    <p class="small muted mt">Estimates for planning only — the treating providers decide what care is needed.</p>`,
    onOk: async (el) => {
      const save = (row) => api('cases.php?action=child_save&id=' + d.case.id, { table: 'case_estimates', row });
      for (const tr of el.querySelectorAll('tr[data-i]')) {
        const l = o.lines[+tr.dataset.i], qty = +tr.querySelector('.est-qty').value, cost = +tr.querySelector('.est-cost').value;
        if (qty === +l.qty && cost === +l.unitCost) continue;
        const listCost = costs[l.category]?.cost;
        await save({ ...(l.id ? { id: l.id } : {}), ...(l.referralId ? { referral_id: l.referralId } : {}), category: l.category, qty, unit_cost: cost === listCost ? null : cost });
      }
      const qty = el.querySelector('#est-qty').value, cat = el.querySelector('#est-cat').value, desc = el.querySelector('#est-desc').value.trim(), cost = el.querySelector('#est-cost').value;
      // Add the new line only if someone filled in the "Add a line" fields.
      const touched = el.dataset.addLine === '1' || desc || cost !== '';
      if (touched && (cat !== 'custom' || desc)) await save({ category: cat, description: desc || null, qty: +qty || 1, unit_cost: cost === '' ? null : +cost });
      S.caseData = await api('cases.php?action=get&id=' + d.case.id); renderCase(); toast('Estimates saved');
    } });
  m.el.querySelectorAll('[data-est-remove]').forEach((b) => b.addEventListener('click', async () => {
    S.caseData = await api('cases.php?action=child_archive&id=' + d.case.id, { table: 'case_estimates', child_id: +b.dataset.estRemove });
    m.close(); renderCase(); estimatesModal();
  }));
  m.el.querySelector('#est-cat').addEventListener('change', () => { m.el.dataset.addLine = '1'; });
  m.el.querySelector('#est-qty').addEventListener('input', () => { m.el.dataset.addLine = '1'; });
}

// ----- LOP, forwarding, settlement -----
function lopModal() {
  const c = S.caseData.case;
  const defs = [
    ...(can('case.write') ? [{ n: 'lop_signed_on', l: 'LOP signed by patient on', t: 'date' }, { n: 'lop_acknowledged_on', l: 'Acknowledged by law firm on (blank if not countersigned)', t: 'date' }] : []),
    ...(can('case.write') || can('finance.write') ? [{ n: 'mediation_on', l: 'Mediation date', t: 'date' }, { n: 'trial_on', l: 'Trial date', t: 'date' },
      { n: 'settlement_signed_on', l: 'Settlement signed on', t: 'date' }, { n: 'disbursement_expected_on', l: 'Attorney expects to mail / disburse by', t: 'date' }] : []),
    ...(can('case.write') && S.caseData.rules.lopDisclosure ? [
      { n: 'lop_factored', l: 'Account sold to a factoring company? (§768.0427)', t: 'select', blank: false, opts: [['unknown', 'Not recorded'], ['no', 'No'], ['yes', 'Yes']] },
      { n: 'lop_factor_company', l: 'Factoring company (if sold)' }, { n: 'lop_factor_price', l: 'Sale price ($, if sold)', t: 'money' },
      { n: 'lop_health_coverage', l: 'Patient had health coverage when treated?', t: 'select', blank: false, opts: [['unknown', 'Not recorded'], ['no', 'No'], ['yes', 'Yes']] }] : []),
    ...(can('finance.write') ? [{ n: 'balance_forwarded_on', l: 'Balance forwarded to attorney on', t: 'date' }, { n: 'balance_forwarded_amount', l: 'Amount forwarded ($)', t: 'money' },
      { n: 'atty_offer', l: 'Attorney offer ($)', t: 'money' }, { n: 'final_settlement', l: 'Final settlement ($)', t: 'money' },
      { n: 'date_authorized', l: 'Reduction authorized on', t: 'date' }, { n: 'check_received_on', l: 'Check received on', t: 'date' }] : []),
  ];
  openModal({ title: 'LOP & settlement', wide: true, body: fieldsHtml(defs, c) + '<p class="small muted mt">When the check arrives, post it as a Payment from the patient balance and the agreed reduction as a Reduction, so the balance closes to $0.</p>',
    onOk: async (el) => { S.caseData = await api('cases.php?action=update&id=' + c.id, { case: readFields(el, defs) }); renderCase(); toast('Saved'); } });
}

function forwardModal() {
  const d = S.caseData;
  const defs = [{ n: 'date', l: 'Date sent', t: 'date', req: true }, { n: 'amount', l: 'Patient balance forwarded ($)', t: 'money', req: true },
    { n: 'method', l: 'Sent by', t: 'select', blank: false, opts: [['fax', 'Fax'], ['email', 'Email'], ['mail', 'Mail'], ['portal', 'Portal']] }];
  const atty = d.contacts.attorney_contact_id;
  openModal({ title: 'Forward patient balance to attorney', okText: 'Record & print statement',
    body: (atty ? `<p class="small">To <strong>${esc(contactName(atty))}</strong>${atty.fax ? ' · fax ' + esc(atty.fax) : ''}${atty.email ? ' · ' + esc(atty.email) : ''}</p>` : '<div class="notice">No attorney on this case yet — add one on the Overview tab so the statement is addressed correctly.</div>')
      + fieldsHtml(defs, { date: today(), amount: d.totals.patient_balance, method: 'fax' }),
    onOk: async (el) => {
      S.caseData = await api('cases.php?action=forward_balance&id=' + d.case.id, readFields(el, defs));
      renderCase(); toast('Recorded — logged under Correspondence'); openLetter('statement');
    } });
}

// --- documents ---
const DOC_CATS = [['lor', 'Letter of representation'], ['intake', 'Intake paperwork'], ['prior_records', 'Prior records'], ['imaging_report', 'Imaging report'], ['emc_report', 'EMC report'],
  ['consult_report', 'Consult report'], ['narrative', 'Narrative'], ['letter', 'Letter'], ['billing', 'Billing / EOB'], ['correspondence', 'Correspondence'], ['other', 'Other']];
// Patient documents aren't stored — keep them in the EHR. Files stored
// before that can still be opened and removed.
function tabDocuments(el, d) {
  el.innerHTML = `<div class="card"><div class="card-head"><h2>Documents</h2></div>
    <div class="notice">Patient documents aren't stored here any more — keep them in your EHR. These files were uploaded earlier; open or remove them below.</div>
    ${d.documents.length ? `<div class="table-wrap"><table><thead><tr><th>File</th><th>Category</th><th>Uploaded</th><th class="num">Size</th><th></th></tr></thead><tbody>
    ${d.documents.map((x) => `<tr><td>${esc(x.original_name)}</td><td>${esc(Object.fromEntries(DOC_CATS)[x.category])}</td>
      <td class="small">${esc(fmtDate(x.uploaded_at))} · ${esc(x.uploaded_by_name || '')}</td><td class="num small">${Math.max(1, Math.round(x.size_bytes / 1024))} KB</td>
      <td class="nowrap"><a class="btn ghost sm" href="api/documents.php?action=download&id=${x.id}&inline=1" target="_blank" rel="noopener">View</a>
        <a class="btn ghost sm" href="api/documents.php?action=download&id=${x.id}">Download</a>
        ${can('case.write') ? `<button class="btn link small" data-act="archive-doc" data-id="${x.id}">Remove</button>` : ''}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="empty">No documents.</div>'}
  </div>`;
}

async function reloadCase() {
  const d = await attempt(() => api('cases.php?action=get&id=' + S.caseData.case.id));
  if (d) { S.caseData = d; renderCase(); }
}

// --- case tasks ---
function tabCaseTasks(el, d) {
  const open = d.tasks.filter((t) => !t.done_at), done = d.tasks.filter((t) => t.done_at);
  el.innerHTML = `<div class="card"><div class="card-head"><h2>Tasks</h2><span class="spacer"></span><button class="btn sm" data-act="new-task" data-case="${d.case.id}">+ Task</button></div>
    ${taskListHtml(open, false)}
    ${done.length ? `<details class="mt"><summary class="small muted">${done.length} completed</summary>${taskListHtml(done, false)}</details>` : ''}
  </div>`;
}

// A task for one or more team members (none = anyone can pick it up).
function taskModal(caseId, task = null, prefill = {}) {
  const te = S.lookups.taskEmail || { on: [], who: [], repeat_days: 5, events: {}, whoLabels: {} };
  const t = task || { title: prefill.title || '', notes: '', due_on: prefill.due_on || '', priority: 'normal', assignees: prefill.assignees || [{ id: S.user.id }],
    email_on: te.on, email_who: te.who, email_to: [], late_repeat_days: null };
  const defs = [{ n: 'title', l: 'Task', req: true, full: true }, { n: 'notes', l: 'Notes', t: 'textarea', rows: 2 }, { n: 'due_on', l: 'Due', t: 'date' },
    { n: 'priority', l: 'Priority', t: 'select', blank: false, opts: [['normal', 'Normal'], ['high', 'High']] }];
  const chosen = new Set(t.assignees.map((a) => +a.id));
  const team = S.lookups.users || [];
  const body = fieldsHtml(defs, t) + `<fieldset class="assignees mt"><legend>Assign to <span class="small muted">— one or more people; leave all unticked for anyone</span></legend>
      <div class="assignee-list">${team.map((u) => `<label class="check"><input type="checkbox" data-assignee="${u.id}"${chosen.has(+u.id) ? ' checked' : ''}> ${esc(u.name)}${u.id == S.user.id ? ' <span class="small muted">(you)</span>' : ''}</label>`).join('')}</div></fieldset>
    ${taskEmailHtml(t, te, team)}
    ${task ? `<p class="small muted mt">${task.case_id ? `Case: <a href="#/case/${task.case_id}">${esc(task.patient)}</a> · ` : ''}Created by ${esc(task.created_by_name || '—')} on ${esc(fmtDate(task.created_at))}</p>` : ''}`;
  const canDelete = task && (task.created_by == S.user.id || can('users.manage'));
  const caseOf = task ? task.case_id : caseId;
  const inCase = () => !!caseOf && location.hash.startsWith('#/case/' + caseOf);
  const m = openModal({ title: task ? 'Edit task' : 'New task', body, okText: task ? 'Save' : 'Add task',
    extraButtons: canDelete ? '<button class="btn danger" data-del>Delete</button>' : '',
    onOk: async (el) => {
      const v = readFields(el, defs);
      v.assignee_ids = [...el.querySelectorAll('[data-assignee]:checked')].map((x) => +x.dataset.assignee);
      if (hasFeature('task_emails')) {
        v.email_on = [...el.querySelectorAll('[data-te-on]:checked')].map((x) => x.dataset.teOn);
        v.email_who = [...el.querySelectorAll('[data-te-who]:checked')].map((x) => x.dataset.teWho);
        v.email_to = [...el.querySelectorAll('[data-te-to]:checked')].map((x) => +x.dataset.teTo);
        const rep = el.querySelector('#te-repeat').value;
        v.late_repeat_days = rep === '' || +rep === te.repeat_days ? null : +rep;
      }
      const r = await api('cases.php?action=task_save', { ...v, ...(task ? { id: task.id } : { case_id: caseId || null }), return_case: inCase() });
      afterTaskChange(r, inCase());
      toast(task ? 'Task saved' : 'Task added');
    } });
  m.el.querySelector('[data-del]')?.addEventListener('click', async () => {
    if (!await confirmBox('Delete task', `Delete “${task.title}”? It stays in the activity history.`, 'Delete')) return;
    if (await attempt(() => api('cases.php?action=task_delete', { id: task.id }))) { m.close(); afterTaskChange(null, false); toast('Task deleted'); }
  });
}

// Email alerts on a task (Gold and up). Emails never include the task or
// patient — just what happened and a link.
function taskEmailHtml(t, te, team) {
  if (!hasFeature('task_emails')) return `<p class="small muted mt">Email alerts when a task is urgent, late or completed are part of the ${esc(featureInfo('task_emails').planName)} plan and up.</p>`;
  const on = new Set(t.email_on || []), who = new Set(t.email_who || []), to = new Set((t.email_to || []).map(Number));
  return `<details class="mt"${taskEmailsOpen(t, te) ? ' open' : ''}><summary>Email alerts <span class="small muted">— ${on.size ? esc([...on].map((k) => ({ urgent: 'urgent', late: 'late', done: 'completed' })[k]).join(', ')) : 'off'}</span></summary>
    <fieldset class="assignees mt"><legend>Email when the task is</legend><div class="assignee-list">${entries(te.events).map(([k, l]) => `<label class="check"><input type="checkbox" data-te-on="${k}"${on.has(k) ? ' checked' : ''}> ${esc(l)}</label>`).join('')}</div></fieldset>
    <div class="form-grid mt"><div><label for="te-repeat">Late reminder: repeat every (days, 0 = once)</label><input type="number" id="te-repeat" min="0" max="60" value="${t.late_repeat_days ?? te.repeat_days}"></div></div>
    <fieldset class="assignees mt"><legend>Send to</legend><div class="assignee-list">${entries(te.whoLabels).map(([k, l]) => `<label class="check"><input type="checkbox" data-te-who="${k}"${who.has(k) ? ' checked' : ''}> ${esc(l)}</label>`).join('')}</div>
      <div class="small muted mt-sm">Also email:</div><div class="assignee-list">${team.map((u) => `<label class="check"><input type="checkbox" data-te-to="${u.id}"${to.has(+u.id) ? ' checked' : ''}> ${esc(u.name)}</label>`).join('')}</div></fieldset>
    <p class="small muted mt-sm">You're not emailed about changes you make yourself. Emails never include the task, patient or case — just what happened and a sign-in link.</p></details>`;
}
// Opened when this task differs from the practice's defaults.
const taskEmailsOpen = (t, te) => (t.email_to || []).length > 0 || t.late_repeat_days != null || [...(t.email_on || [])].sort().join() !== [...te.on].sort().join() || [...(t.email_who || [])].sort().join() !== [...te.who].sort().join();

function afterTaskChange(r, inCase) {
  if (inCase && r && r.case) { S.caseData = r; renderCase(); }
  else if (location.hash.startsWith('#/case/')) reloadCase();
  else route();
  refreshTaskBadge();
}

// Open tasks assigned to me, on the sidebar.
async function refreshTaskBadge() {
  const b = document.getElementById('task-badge');
  if (!b) return;
  try {
    const r = await api('cases.php?action=task_counts', undefined, { passive: true });
    b.hidden = !r.mine;
    b.textContent = r.mine;
    b.classList.toggle('due', r.due > 0);
    b.title = `${r.mine} open task${r.mine === 1 ? '' : 's'} assigned to you${r.due ? `, ${r.due} due today or overdue` : ''}`;
  } catch { /* badge is best-effort */ }
}

// --- activity: who did what ---
const AUDIT_VERBS = {
  create: 'added', update: 'updated', archive: 'removed', view: 'opened', list: 'viewed the case list', download: 'downloaded', upload: 'uploaded',
  export: 'exported', letter: 'generated a letter', forward_balance: 'forwarded the patient balance to the attorney', ehr_import: 'uploaded the EHR ledger',
  ehr_preview: 'previewed an EHR ledger upload', login: 'signed in', logout: 'signed out', login_password_ok: 'entered their password', login_failed: 'failed to sign in',
  login_locked: 'tried to sign in to a locked account', mfa_failed: 'entered a wrong two-factor code', mfa_enrolled: 'set up two-factor sign-in',
  password_changed: 'changed their password', session_timeout: 'was signed out after inactivity', access_denied: 'was refused access to', reset_password: 'issued a new one-time password for',
  reset_mfa: 'reset two-factor for', reset_unlock: 'unlocked', reset_badge: 'issued new website badge links for', accept_baa: 'accepted the Business Associate Agreement', accept_terms: 'accepted the Terms of Service and User Agreement', signup: 'signed the practice up',
  billing_checkout: 'started a plan checkout', billing_portal: 'opened billing', platform_update: 'changed the plan for',
};
const AUDIT_THINGS = {
  case: 'the case', visits: 'a visit', referrals: 'a co-management referral', coverages: 'insurance coverage', outcomes: 'an outcome assessment',
  correspondence: 'a correspondence entry', outreach: 'an outreach attempt', ledger: 'a ledger entry', task: 'task', milestone: 'checklist item', document: 'a document', contact: 'contact',
  user: 'user', location: 'location', promo_code: 'promo code', practice_step: 'office step', case_estimates: "an outside-provider estimate", feedback: 'feature suggestion', practice: 'practice settings', ehr_format: 'EHR spreadsheet layout', dashboard: 'the dashboard', ar_report: 'the A/R report',
  audit_log: 'the audit log', huddle: 'the daily huddle', permission: '', platform_practices: 'the practice list', care_guide: 'the referral guide',
};
const FIELD_NAMES = {
  provider_user_id: 'Provider', attorney_contact_id: 'Attorney', referred_by_contact_id: 'Referred by', referred_by_text: 'Referred by', contact_id: 'Contact',
  carrier_contact_id: 'Carrier', carrier_text: 'Carrier', coverage_id: 'Coverage', to_coverage_id: 'Moved to coverage', to_bucket: 'Moved to', applies_to_id: 'Applies to charge',
  atty_offer: 'Attorney offer', emc_status: 'EMC', lop_signed_on: 'LOP signed', lop_acknowledged_on: 'LOP acknowledged by law firm', date_of_injury: 'Date of injury',
  balance_forwarded_on: 'Balance forwarded on', balance_forwarded_amount: 'Balance forwarded', final_settlement: 'Final settlement', check_received_on: 'Check received',
  date_authorized: 'Reduction authorized', due_on: 'Due', assignees: 'Assigned to', done: 'Done', not_applicable: 'Not applicable', completed_on: 'Completed',
  dob: 'Date of birth', patient_dob: 'Date of birth', patient_first_name: 'First name', patient_last_name: 'Last name', patient_phone: 'Phone', patient_email: 'Email',
  patient_address: 'Address', cpt_codes: 'CPT codes', dwc25_sent: 'DWC-25 sent', staff_finance: 'Staff can see', finance_access: 'Full financial access',
  ehr_name: 'EHR', benefit_limit: 'Benefit limit', entry_date: 'Date', kind: 'Type', bucket: 'Owed by', status_on: 'Status date', insurance_balance: 'Insurance balance',
  patient_balance: 'Patient balance', injury_type: 'Case type', location_id: 'Location', location_restricted: 'Limited to location', outreach_hold_on: 'Calls paused (attorney notified)', paralegal: 'Paralegal', attempted_on: 'Date', method: 'How', outcome: 'Outcome', plan_visits_per_week: 'Treatment plan (visits/week)', plan_set_on: 'Plan since', notify_digest: 'Daily email digest',
  gap_days: 'Gap days', adherence_pct: 'Adherence threshold %', weekdays_only: 'Weekdays only', criteria: 'Criteria', bi_limit: 'At-fault BI limit', um_limit: 'UM limit', other_medical_estimate: "Other providers' bills (est.)",
  liability_carrier: 'At-fault insurer', limits_source: 'Limits source', limits_noted_on: 'Limits as of', remaining_reported: 'PIP remaining (carrier)', remaining_reported_on: 'Remaining as of', visit_type: 'Visit type', head_injury: 'Head injury',
  guide_mri: 'MRI referral', guide_ortho: 'Ortho referral', guide_pain_mgmt: 'Pain management referral', guide_neuro: 'Neurology referral', guide_emc: 'EMC determination', guide_reexam: 'Re-exam', mmi_date: 'MMI', maintenance_every_days: 'Maintenance every (days)', qty: 'Count', unit_cost: 'Cost each', referral_id: 'Referral', mediation_on: 'Mediation', trial_on: 'Trial', settlement_signed_on: 'Settlement signed', disbursement_expected_on: 'Check expected', jurisdiction: 'State rules', emc_by: 'EMC determined by', emc_on: 'EMC date', tort_option: 'Lawsuit option',
  lop_factored: 'LOP factored', lop_factor_company: 'Factoring company', lop_factor_price: 'Factoring price', lop_health_coverage: 'Health coverage at treatment', policy_effective_on: 'Policy issued/renewed', demand_sent_on: 'PIP demand sent', badge: 'Website badge shown',
};
const humanize = (s) => String(s).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
function auditValue(c, v) {
  if (v === null || v === undefined || v === '') return '—';
  if (c.t === 'money') return money(v);
  if (c.t === 'date') return fmtDate(v);
  if (c.t === 'bool') return v ? 'Yes' : 'No';
  if (c.t === 'enum') {
    const maps = { stage: 'stages', injury_type: 'injuryTypes', type: 'coverageTypes', status: 'coverageStatus' };
    return S.lookups?.[maps[c.f]]?.[v] ?? humanize(v);
  }
  return String(v);
}
function auditChangesHtml(e) {
  if (!e.changes || !e.changes.length) return '';
  const create = e.action === 'create' || e.action === 'archive';
  const rows = create ? e.changes.filter((c) => c.t !== 'text' && c.t !== 'ref') : e.changes;
  if (!rows.length) return '';
  return `<ul class="changes">${rows.map((c) => {
    const name = esc(FIELD_NAMES[c.f] || humanize(c.f));
    if (c.hidden) return `<li>${name} <span class="muted">(amount hidden)</span></li>`;
    if (c.t === 'text' || c.t === 'ref') return `<li>${name} <span class="muted">changed</span></li>`;
    if (create || c.from === null || c.from === undefined) return `<li>${name}: <strong>${esc(auditValue(c, c.to))}</strong></li>`;
    return `<li>${name}: ${esc(auditValue(c, c.from))} → <strong>${esc(auditValue(c, c.to))}</strong></li>`;
  }).join('')}</ul>`;
}
function auditSentence(e) {
  const who = `<strong>${esc(e.user || 'System')}</strong>`;
  const verb = AUDIT_VERBS[e.action] || humanize(e.action);
  let thing = AUDIT_THINGS[e.entity] ?? humanize(e.entity || '');
  if (e.entity === 'task') thing = `task “${esc(e.label || '#' + e.entityId)}”`;
  else if (e.entity === 'milestone') thing = `checklist item “${esc(humanize(e.entityId || ''))}”`;
  else if (['user', 'contact', 'ehr_format'].includes(e.entity) && e.detail) thing = `${thing} ${esc(e.detail)}`;
  else thing = esc(thing);
  if (['list', 'login', 'logout', 'login_password_ok', 'login_failed', 'login_locked', 'mfa_failed', 'mfa_enrolled', 'password_changed', 'session_timeout', 'accept_baa', 'accept_terms', 'forward_balance', 'ehr_import', 'ehr_preview', 'signup', 'billing_checkout', 'billing_portal'].includes(e.action)) thing = '';
  if (e.action === 'access_denied') thing = esc(e.entityId || '');
  let extra = '';
  if (e.action === 'letter' && e.detail) extra = ` <span class="muted">(${esc(humanize(e.detail))})</span>`;
  if (e.action === 'ehr_import' && e.detail) extra = ` <span class="muted">— ${esc(e.detail)}</span>`;
  if (['login_failed', 'mfa_failed'].includes(e.action) && e.detail) extra = ` <span class="muted">(${esc(e.detail)})</span>`;
  return `${who} ${esc(verb)} ${thing}${extra}`;
}
const fmtDateTime = (s) => { if (!s) return '—'; const d = new Date(String(s).replace(' ', 'T')); return isNaN(d) ? s : d.toLocaleString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }); };
const auditAlarm = (e) => /fail|denied|locked/.test(e.action);
function activityItemsHtml(entries) {
  return entries.map((e) => `<li${auditAlarm(e) ? ' class="alarm"' : ''}><div class="when small muted nowrap">${esc(fmtDateTime(e.at))}</div><div>${auditSentence(e)}${auditChangesHtml(e)}</div></li>`).join('');
}

async function tabActivity(el, d) {
  const state = { views: false };
  const load = async (before) => {
    const r = await attempt(() => api(`cases.php?action=activity&case_id=${d.case.id}${state.views ? '&views=1' : ''}${before ? '&before=' + before : ''}`));
    if (!r) return;
    const list = el.querySelector('#act-list');
    if (!before) list.innerHTML = '';
    list.insertAdjacentHTML('beforeend', r.entries.length ? activityItemsHtml(r.entries) : (before ? '' : '<li class="empty">No activity yet.</li>'));
    const more = el.querySelector('#act-more');
    more.hidden = !r.more;
    more.dataset.before = r.entries.length ? r.entries[r.entries.length - 1].id : '';
  };
  el.innerHTML = `<div class="card"><div class="card-head"><h2>Activity</h2><span class="small muted">Who changed what on this case, newest first</span><span class="spacer"></span>
      ${can('audit.read') ? '<label class="check small"><input type="checkbox" id="act-views"> Include who opened it</label>' : ''}</div>
    <ul class="activity" id="act-list"><li class="empty">Loading…</li></ul>
    <button class="btn ghost sm mt" id="act-more" hidden>Show older</button></div>`;
  el.querySelector('#act-views')?.addEventListener('change', (e) => { state.views = e.target.checked; load(); });
  el.querySelector('#act-more').addEventListener('click', (e) => load(e.target.dataset.before));
  load();
}

// ---------- tasks page ----------
const taskState = { scope: 'mine', status: 'open' };
async function pageTasks(main, args = []) {
  const st = taskState;
  if (args[0] && /^\d+$/.test(args[0])) {
    // From a task email: open that task.
    history.replaceState(null, '', '#/tasks');
    const one = await attempt(() => api('cases.php?action=task&id=' + args[0]));
    if (one) setTimeout(() => { taskCache.set(one.task.id, one.task); taskModal(one.task.case_id, one.task); }, 0);
  }
  const r = await attempt(() => api(`cases.php?action=tasks&scope=${encodeURIComponent(st.scope)}&status=${st.status}`));
  if (!r) return;
  const team = S.lookups.users || [];
  const who = st.scope === 'mine' ? 'assigned to you' : st.scope === 'unassigned' ? 'for anyone' : st.scope === 'created' ? 'you created' : st.scope.startsWith('user:') ? 'assigned to ' + (team.find((u) => 'user:' + u.id === st.scope)?.name || '') : '';
  main.innerHTML = `<div class="page-head"><div><h1>Tasks</h1><div class="sub">${r.tasks.length} ${st.status === 'done' ? 'completed in the last 90 days' : 'open'} ${esc(who)}</div></div><span class="spacer"></span>
      <button class="btn" data-act="new-task">+ Task</button></div>
    <div class="filters">
      <select id="task-scope" aria-label="Whose tasks">${opt('mine', 'Assigned to me', st.scope)}${opt('all', 'Everyone', st.scope)}${opt('unassigned', 'For anyone (unassigned)', st.scope)}${opt('created', 'Created by me', st.scope)}
        <optgroup label="Team member">${team.map((u) => opt('user:' + u.id, u.name, st.scope)).join('')}</optgroup></select>
      <select id="task-status" aria-label="Status">${opt('open', 'Open', st.status)}${opt('done', 'Completed', st.status)}</select></div>
    <div class="card">${taskListHtml(r.tasks, true, st.status === 'done' ? 'Nothing completed in the last 90 days.' : 'No open tasks here.')}</div>`;
  main.querySelector('#task-scope').addEventListener('change', (e) => { st.scope = e.target.value; pageTasks(main); });
  main.querySelector('#task-status').addEventListener('change', (e) => { st.status = e.target.value; pageTasks(main); });
}

// ---------- daily appointment list upload ----------
// Yesterday's appointments from any EHR (spreadsheet or PDF): kept visits
// and no-shows are logged on the matching injury cases after a preview.
const schedState = { preview: null, choices: {}, result: null, showCols: false, review: null };
// A case as the clinic knows it: our number, the EHR's name or type, DOI.
const caseTag = (c) => [c.number, c.label || (c.type ? label('injuryTypes', c.type) : ''), c.doi ? 'DOI ' + fmtDate(c.doi) : ''].filter(Boolean).join(' · ');
const SCHED_ACTIONS = [['visit', 'Log visit'], ['no_show', 'Log no-show'], ['skip', 'Skip']];

async function pageSchedule(main) {
  if (!hasFeature('schedule_import')) { main.innerHTML = `<div class="page-head"><div><h1>Appointment upload</h1></div></div>${upgradeCardHtml('schedule_import')}`; return; }
  const st = await attempt(() => api('schedule.php?action=status'));
  if (!st) return;
  const pv = schedState.preview, res = schedState.result;
  main.innerHTML = `<div class="page-head"><div><h1>Appointment upload</h1><div class="sub">Log yesterday's visits and no-shows on every injury case from your EHR's appointment list — no EHR connection needed.</div></div></div>
    ${st.behind ? `<div class="notice">The appointment list for <strong>${esc(fmtDate(st.expectedDate))}</strong> hasn't been uploaded yet${st.lastDate ? ` (last: ${esc(fmtDate(st.lastDate))})` : ''}.</div>` : ''}
    ${res ? schedResultHtml(res) : ''}
    ${schedState.review ? schedReviewHtml(schedState.review) : pv ? schedPreviewHtml(pv) : `<div class="card" id="sched-upload"><h2>Upload an appointment list</h2>
      <p class="small">In your EHR, run the daily appointment (or "appointment status") report for the day, export it as a <strong>spreadsheet (CSV or Excel)</strong> or <strong>PDF</strong>, and upload it here. Any EHR works: each row is matched to your open injury cases by patient name (date of birth breaks ties), and the date and status — kept, no-show, cancelled — are read from the row. Your other patients are ignored, and the file isn't kept.</p>
      <div class="form-grid mt"><div><label for="sched-file">Appointment list</label><input type="file" id="sched-file" accept=".csv,.xlsx,.pdf,.txt,.tsv,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></div>
        <div><label for="sched-date">Appointments on <span class="small muted">(used when the file doesn't show the date)</span></label><input type="date" id="sched-date" value="${esc(st.expectedDate)}" max="${esc(today())}"></div></div>
      <button class="btn mt" data-act="sched-preview">Preview</button></div>`}
    ${can('users.manage') ? schedSettingsHtml(st) : ''}
    <div class="card mt"><h2>Recent uploads</h2>${st.history.length ? `<div class="table-wrap"><table><thead><tr><th>Uploaded</th><th>Appointments</th><th>Visits</th><th>No-shows</th><th>Matched / other rows</th><th></th></tr></thead><tbody>
      ${st.history.map((h) => `<tr class="${h.undone_at ? 'muted' : ''}"><td>${esc(fmtDate(h.uploaded_at))}<div class="small muted">${esc(h.uploaded_by || '')} · ${esc(h.file_kind.toUpperCase())}</div></td>
        <td>${esc(fmtDate(h.first_date))}${h.last_date !== h.first_date ? ' – ' + esc(fmtDate(h.last_date)) : ''}</td><td>${+h.visits_added}</td><td>${+h.no_shows_added}</td><td>${+h.rows_matched} / ${+h.rows_unmatched}</td>
        <td>${h.undone_at ? '<span class="chip na">Undone</span>' : `<button class="btn ghost sm" data-act="sched-undo" data-id="${h.id}">Undo</button>`}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No uploads yet.</div>'}</div>`;
}

function schedPreviewHtml(pv) {
  const ch = schedState.choices;
  const action = (r) => ch[r.line]?.action ?? r.action;
  const caseOf = (r) => (ch[r.line] && 'case_id' in ch[r.line]) ? ch[r.line].case_id : r.case_id;
  const rows = pv.rows;
  const needsCase = (r) => ['visit', 'no_show'].includes(action(r)) && (caseOf(r) === null || caseOf(r) === '');
  const count = (a) => rows.filter((r) => a === 'ask' ? action(r) === 'ask' || needsCase(r) : action(r) === a).length;
  const caseSelect = (r) => `<select data-sched-case="${r.line}" aria-label="Which case">${caseOf(r) === null || caseOf(r) === '' ? opt('', 'Choose the case…', '') : ''}${r.cases.map((c) => opt(c.id, (r.ambiguous ? c.patient + ' · ' : '') + caseTag(c), caseOf(r))).join('')}${!r.ambiguous ? opt('all', `All ${r.cases.length} open cases`, caseOf(r)) : ''}</select>`;
  const linked = pv.unmatched.filter((u) => ch[u.line]?.case_id).length;
  const outcome = (o) => o === 'unknown' ? 'No status' : pv.outcomes[o] || o;
  const caseOpts = (sel) => opt('', '— not an injury case —', sel ?? '') + pv.openCases.map((c) => opt(c.id, c.label, sel ?? '')).join('');
  const cols = pv.columns;
  return `<div class="card" id="sched-preview"><div class="card-head"><h2>Preview — ${esc(pv.fileName)}</h2><span class="spacer"></span><button class="btn ghost sm" data-act="sched-cancel">Choose another file</button></div>
    ${pv.alreadyUploaded ? `<div class="notice">This exact file was already uploaded on ${esc(fmtDate(pv.alreadyUploaded))}. Visits already logged are skipped, so applying again is safe.</div>` : ''}
    ${pv.truncated ? '<div class="notice">Only the first 5,000 rows were read — upload one day at a time.</div>' : ''}
    <div class="sched-sum mt-sm"><span class="chip teal">${count('visit')} visit${count('visit') === 1 ? '' : 's'} to log</span><span class="chip overdue">${count('no_show')} no-show${count('no_show') === 1 ? '' : 's'}</span>
      <span class="chip na">${count('skip')} skipped</span>${count('ask') ? `<span class="chip due">${count('ask')} need a decision</span>` : ''}<span class="chip na">${pv.unmatchedCount} other row${pv.unmatchedCount === 1 ? '' : 's'}${linked ? ` (${linked} linked)` : ''}</span></div>
    ${!pv.dateFromFile && rows.length ? `<p class="small mt-sm">The file doesn't show appointment dates, so these are logged for <strong>${esc(fmtDate(pv.date))}</strong>.</p>` : ''}
    ${cols ? `<p class="small mt-sm">Columns read: ${Object.entries(cols.fields).filter(([k]) => cols.cols[k] !== undefined).map(([k, l]) => `${esc(l)} = <strong>${esc(cols.headings[cols.cols[k]] || '?')}</strong>`).join(' · ') || '<em>none recognised — reading each row as text</em>'}${cols.format ? ` <span class="muted">(saved layout: ${esc(cols.format)})</span>` : ''}
      <button class="linklike" data-act="sched-cols">${schedState.showCols ? 'Hide' : 'Change columns'}</button></p>${schedState.showCols ? schedColsHtml(cols) : ''}` : ''}
    ${Object.keys(pv.unknownStatuses).length ? `<div class="notice mt-sm" id="sched-words"><strong>Status wording we haven't seen before.</strong> Tell us what each means — it's remembered for every future upload.
      <div class="form-grid mt-sm">${Object.entries(pv.unknownStatuses).map(([w, n]) => `<div><label>“${esc(w)}” <span class="small muted">(${n} row${n === 1 ? '' : 's'})</span></label><select data-word="${esc(w)}">${opt('', 'Choose…')}${entries(pv.outcomes).map(([k, l]) => opt(k, l)).join('')}</select></div>`).join('')}</div>
      <button class="btn sm mt-sm" data-act="sched-words">Save and re-read</button></div>` : ''}
    ${rows.length ? `${rows.some((r) => action(r) === 'ask') ? `<div class="badge-row mt"><span class="small">Rows with no status:</span><button class="btn ghost sm" data-act="sched-bulk" data-v="visit">Mark all as kept</button><button class="btn ghost sm" data-act="sched-bulk" data-v="skip">Skip them</button></div>` : ''}
      ${rows.some(needsCase) ? `<div class="badge-row mt"><span class="small">Patients with more than one open case:</span><button class="btn ghost sm" data-act="sched-bulk-case" data-v="all">Log on all their open cases</button><button class="btn ghost sm" data-act="sched-bulk-case" data-v="newest">Newest case</button></div>` : ''}
      <div class="table-wrap mt"><table class="sched-table"><thead><tr><th>Patient</th><th>Date</th><th>In the file</th><th>Will</th></tr></thead><tbody>
      ${rows.map((r) => `<tr class="${action(r) === 'ask' || needsCase(r) ? 'attn' : ''}"><td><a href="#/case/${r.cases[0].id}">${esc(r.patient)}</a>${r.matchedBy !== 'name' ? ` <span class="small muted">by ${esc(r.matchedBy)}</span>` : ''}
        ${r.cases.length > 1 ? `<div class="mt-sm">${caseSelect(r)}</div>${r.caseWhy && caseOf(r) === r.case_id ? `<div class="small muted">Case picked from the ${esc(r.caseWhy)}</div>` : ''}` : ''}${r.ambiguous ? '<div class="small err">Two patients share this name — choose the right one</div>' : ''}</td>
        <td>${esc(fmtDate(r.date))}</td><td>${esc(r.raw || '—')} <span class="small muted">${esc(outcome(r.outcome))}</span></td>
        <td><select data-sched-action="${r.line}" aria-label="Action">${action(r) === 'ask' ? opt('ask', 'Choose…', 'ask') : ''}${SCHED_ACTIONS.map(([k, l]) => opt(k, l, action(r))).join('')}</select>${r.why && action(r) === r.action ? `<div class="small muted">${esc(r.why)}</div>` : ''}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty mt">No rows matched an open injury case. Check the file is the appointment list, or link rows below.</div>'}
    ${pv.unmatched.length ? `<details class="mt"><summary>${pv.unmatchedCount} row${pv.unmatchedCount === 1 ? '' : 's'} didn't match an open injury case <span class="small muted">— usually your other patients; link one if it's an injury case under a different name</span></summary>
      <div class="table-wrap mt-sm"><table class="sched-table"><thead><tr><th>Row</th><th>Date</th><th>Status</th><th>Link to case</th><th>Will</th></tr></thead><tbody>
      ${pv.unmatched.map((u) => `<tr><td class="small">${esc(u.text)}</td><td>${esc(fmtDate(u.date))}</td><td>${esc(u.raw || '—')}</td><td><select data-sched-link="${u.line}" aria-label="Link to case">${caseOpts(ch[u.line]?.case_id)}</select></td>
        <td>${ch[u.line]?.case_id ? `<select data-sched-action="${u.line}" aria-label="Action">${SCHED_ACTIONS.map(([k, l]) => opt(k, l, ch[u.line]?.action ?? (u.outcome === 'no_show' ? 'no_show' : u.outcome === 'attended' ? 'visit' : 'skip'))).join('')}</select>` : ''}</td></tr>`).join('')}</tbody></table></div></details>` : ''}
    <div class="badge-row mt"><button class="btn" data-act="sched-review"${count('ask') ? ' disabled title="Choose what to do with the highlighted rows first"' : ''}>Review import</button>${count('ask') ? `<span class="small muted">${count('ask')} highlighted row${count('ask') === 1 ? '' : 's'} need a choice first</span>` : ''}</div></div>`;
}

// The last look before anything is saved, one section per patient: what
// was found in the file and what will be logged on which case.
function schedReviewHtml(rv) {
  const t = rv.totals;
  const what = { visit: 'Log visit', no_show: 'Log no-show', skip: 'Skip' };
  const caseLine = (pt, ids) => ids.map((id) => { const c = pt.cases.find((x) => x.id === id); return c ? caseTag(c) : '#' + id; }).join('; ');
  const buttons = `<div class="badge-row"><button class="btn" data-act="sched-apply">Import ${t.visits} visit${t.visits === 1 ? '' : 's'} and ${t.noShows} no-show${t.noShows === 1 ? '' : 's'}</button><button class="btn ghost" data-act="sched-back">Back to edit</button></div>`;
  return `<div class="card" id="sched-review"><div class="card-head"><h2>Review import — ${esc(rv.fileName)}</h2></div>
    <p>Nothing has been saved yet. ${t.visits} visit${t.visits === 1 ? '' : 's'} and ${t.noShows} no-show${t.noShows === 1 ? '' : 's'} will be logged for ${t.patients} patient${t.patients === 1 ? '' : 's'} (${t.cases} case${t.cases === 1 ? '' : 's'})${t.skipped ? `; ${t.skipped} row${t.skipped === 1 ? '' : 's'} skipped` : ''}${rv.unmatchedCount ? `; ${rv.unmatchedCount} other row${rv.unmatchedCount === 1 ? " in the file isn't an injury case and is" : "s in the file aren't injury cases and are"} ignored` : ''}. Scroll to check each patient, then import.</p>
    ${buttons}
    <div class="review-list mt">${rv.patients.map((pt) => `<section class="review-patient">
      <div class="review-head"><h3>${esc(pt.patient)}</h3><span class="small muted">matched by ${esc(pt.matchedBy)}${pt.cases.length > 1 ? ` · ${pt.cases.length} open cases` : ''}</span><span class="spacer"></span>
        ${pt.visits ? `<span class="chip teal">${pt.visits} visit${pt.visits === 1 ? '' : 's'}</span>` : ''}${pt.noShows ? `<span class="chip overdue">${pt.noShows} no-show${pt.noShows === 1 ? '' : 's'}</span>` : ''}${!pt.visits && !pt.noShows ? '<span class="chip na">Nothing to log</span>' : ''}</div>
      <table class="review-table"><thead><tr><th>Found in the file</th><th>Will import</th></tr></thead><tbody>
      ${pt.items.map((i) => `<tr class="${i.action === 'skip' ? 'muted' : ''}"><td><strong>${esc(fmtDate(i.date))}</strong> · ${esc(i.raw || 'no status')} <span class="small muted">(${esc(i.outcome === 'unknown' ? 'no status' : rv.outcomes[i.outcome] || i.outcome)})</span>${i.text ? `<div class="small muted review-src">Row ${i.line}: ${esc(i.text)}</div>` : ''}</td>
        <td>${i.action === 'skip' ? `Skip${i.why ? ' — ' + esc(i.why) : ''}` : `<strong>${what[i.action]}</strong> on ${esc(caseLine(pt, i.targets))}${i.caseChoice === 'all' && pt.cases.length > 1 ? ' <span class="small muted">(all open cases)</span>' : ''}${i.linked ? ' <span class="small muted">(linked by hand)</span>' : ''}`}</td></tr>`).join('')}
      </tbody></table></section>`).join('')}</div>
    <div class="mt">${buttons}</div></div>`;
}

function schedColsHtml(cols) {
  const choose = (f) => `<select data-sched-col="${f}">${opt('', '— not in this file —', cols.cols[f] ?? '')}${cols.headings.map((h, i) => opt(i, `${String.fromCharCode(65 + (i % 26))} · ${h || '(blank)'}`, cols.cols[f] ?? '')).join('')}</select>`;
  return `<div class="sched-cols mt-sm"><div class="form-grid">${Object.entries(cols.fields).map(([f, l]) => `<div><label>${esc(l)}</label>${choose(f)}</div>`).join('')}</div>
    ${cols.sample.length ? `<div class="table-wrap mt-sm"><table class="small"><thead><tr>${cols.headings.slice(0, 14).map((h, i) => `<th>${String.fromCharCode(65 + i)} · ${esc(h)}</th>`).join('')}</tr></thead><tbody>${cols.sample.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : ''}
    <div class="form-grid mt-sm"><div><label for="sched-fmt">Remember this layout as <span class="small muted">(e.g. your EHR's name — optional)</span></label><input id="sched-fmt" value="${esc(cols.format || S.practice?.ehrName || '')}" maxlength="80"></div></div>
    <button class="btn sm mt-sm" data-act="sched-remap">Re-read with these columns</button></div>`;
}

function schedResultHtml(res) {
  return `<div class="card done-card"><h2>Logged ✓</h2><p>${res.visitsAdded} visit${res.visitsAdded === 1 ? '' : 's'} and ${res.noShowsAdded} no-show${res.noShowsAdded === 1 ? '' : 's'} on ${res.casesUpdated} case${res.casesUpdated === 1 ? '' : 's'}. Gaps in care, treatment-plan adherence and patient outreach are up to date.</p>
    ${res.noShowCases.length ? `<h3 class="mt">Missed visits</h3><ul class="small">${res.noShowCases.map((c) => `<li><a href="#/case/${c.caseId}">${esc(c.label)}</a> — ${c.noShows30} no-show${c.noShows30 === 1 ? '' : 's'} in the last 30 days${c.noShows30 >= 2 ? ' <span class="chip overdue">Follow up</span>' : ''}</li>`).join('')}</ul>` : ''}
    ${res.chartsLearned ? `<p class="small muted">${res.chartsLearned} chart number${res.chartsLearned === 1 ? '' : 's'} from the file ${res.chartsLearned === 1 ? 'was' : 'were'} saved to patients without one, so they match by chart next time.</p>` : ''}
    <button class="btn ghost sm mt" data-act="sched-done">Upload another</button></div>`;
}

function schedSettingsHtml(st) {
  const s = st.settings;
  return `<div class="card mt" id="sched-settings"><h2>How uploads count</h2>
    <div class="form-grid"><div><label for="ss-cancel">Cancellations</label><select id="ss-cancel">${opt('late', 'Late ones count as missed', s.cancel_counts)}${opt('all', 'All count as missed', s.cancel_counts)}${opt('none', "Don't count", s.cancel_counts)}</select></div>
      <div><label for="ss-unknown">Rows with no status in the file</label><select id="ss-unknown">${opt('ask', 'Ask each time', s.unknown_as)}${opt('attended', 'Count as kept visits', s.unknown_as)}${opt('skip', 'Skip them', s.unknown_as)}</select></div>
      <div><label for="ss-multi">Patient with more than one open case</label><select id="ss-multi">${opt('ask', 'Ask which case', s.multi_case)}${opt('all', 'Log on all their open cases', s.multi_case)}${opt('newest', 'Log on the newest case', s.multi_case)}</select></div></div>
    <p class="small muted">When the file names the case (your case #, the EHR's case name, or the date of injury), that case is used.</p>
    <p class="small mt">Your EHR's own status words${Object.keys(s.status_map).length ? ':' : ' — none yet. Any wording we don\'t recognise is asked about during an upload and remembered.'}</p>
    ${Object.keys(s.status_map).length ? `<ul class="small sched-words">${Object.entries(s.status_map).map(([w, o]) => `<li><label class="check"><input type="checkbox" data-keep-word="${esc(w)}" data-o="${esc(o)}" checked> “${esc(w)}” → ${esc(st.outcomes[o])}</label></li>`).join('')}</ul><p class="small muted">Untick a word to forget it.</p>` : ''}
    <button class="btn mt-sm" data-act="sched-settings">Save</button></div>`;
}

async function schedPreviewFile() {
  const f = document.getElementById('sched-file').files[0];
  if (!f) return toast('Choose the appointment list file first.', true);
  const fd = new FormData(); fd.append('file', f); fd.append('date', document.getElementById('sched-date').value);
  const r = await attempt(() => api('schedule.php?action=preview', fd));
  if (r) { schedState.preview = r; schedState.choices = {}; schedState.result = null; schedState.showCols = false; pageSchedule(document.getElementById('main')); }
}

// Choices on the preview are kept as they change (selects only).
document.addEventListener('change', (e) => {
  const el = e.target;
  if (!schedState.preview || !el.closest?.('#sched-preview')) return;
  const ch = schedState.choices;
  let line = el.dataset.schedAction || el.dataset.schedCase || el.dataset.schedLink;
  if (!line) return;
  ch[line] = ch[line] || {};
  if (el.dataset.schedAction) ch[line].action = el.value;
  else ch[line].case_id = el.value === 'all' ? 'all' : el.value ? +el.value : null;
  pageSchedule(document.getElementById('main'));
});

// ---------- A/R ----------
let arState = { all: false, sort: 'patient', dir: 1 };
// The next date to watch on a case: an overdue expected check first, then the
// soonest upcoming mediation, trial or expected check.
function nextCaseDate(x) {
  const t = today();
  if (x.disbursementExpected && !x.checkReceived && x.disbursementExpected < t) return { label: 'Check overdue', date: x.disbursementExpected };
  const up = [['Mediation', x.mediationOn], ['Trial', x.trialOn], ['Check expected', x.checkReceived ? null : x.disbursementExpected]].filter(([, d]) => d && d >= t).sort((a, b) => a[1].localeCompare(b[1]));
  return up.length ? { label: up[0][0], date: up[0][1] } : null;
}

async function pageAR(main) {
  const r = await attempt(() => api('cases.php?action=ar_report' + (arState.all ? '&all=1' : '') + locQS()));
  if (!r) return;
  const rows = r.rows;
  const { sort, dir } = arState;
  rows.sort((a, b) => { const x = a[sort] ?? '', y = b[sort] ?? ''; return (typeof x === 'number' || typeof y === 'number' ? (+x || 0) - (+y || 0) : String(x).localeCompare(String(y))) * dir; });
  rows.forEach((x) => { x.nextDate = nextCaseDate(x)?.date || null; });
  const cols = [['patient', 'Patient'], ['benefits', 'Benefits'], ['stage', 'Status'], ['nextDate', 'Next date'], ['lastVisit', 'Last visit'], ['lastCorrespondence', 'Last contact'], ['attorney', 'Attorney'],
    ['insuranceBalance', 'Insurance', 1], ['patientBalance', 'Patient/LOP', 1], ['totalBalance', 'Total', 1], ['forwardedOn', 'Forwarded'], ['reductionFloor', Math.round(S.lookups.reductionFloorPct * 100) + '% floor', 1], ['attyOffer', 'Offer', 1], ['finalSettlement', 'Settled', 1], ['checkReceived', 'Check rec\'d']];
  main.innerHTML = `${phiBanner}<div class="page-head"><div><h1>A/R &amp; settlements</h1><div class="sub">${rows.length} cases with a balance</div></div><span class="spacer"></span>
      <label class="check small"><input type="checkbox" id="ar-all"${arState.all ? ' checked' : ''}> Include closed</label>
      ${can('export') ? '<a class="btn ghost" href="api/cases.php?action=ar_report&format=csv' + (arState.all ? '&all=1' : '') + '">Export CSV</a>' : ''}</div>
    <div class="tiles">
      <div class="tile warn"><div class="k">Total outstanding</div><div class="v">${money(r.totals.total)}</div></div>
      <div class="tile"><div class="k">Insurance</div><div class="v">${money(r.totals.insurance)}</div></div>
      <div class="tile"><div class="k">Patient / LOP</div><div class="v">${money(r.totals.patient)}</div></div>
      <div class="tile accent"><div class="k">Settlements collected</div><div class="v">${money(r.totals.settledCollected)}</div></div>
    </div>
    <div class="card"><div class="table-wrap"><table><thead><tr>${cols.map(([k, t, n]) => `<th class="sortable${n ? ' num' : ''}" data-act="sort-ar" data-key="${k}">${esc(t)}${sort === k ? (dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((x) => `<tr class="click" data-act="open-case" data-id="${x.id}" data-tab="financials">
        <td><strong>${esc(x.patient)}</strong><div class="small muted mono">${esc(x.caseNumber)}</div></td>
        <td>${x.benefits ? esc(label('benefits', x.benefits)) : '—'}</td><td>${stageChip(x.stage)}</td>
        <td class="nowrap small">${(() => { const n = nextCaseDate(x); return n ? `<span class="${n.date < today() ? 'trend-up' : ''}">${esc(n.label)} ${esc(fmtDate(n.date))}</span>` : '—'; })()}</td>
        <td class="nowrap">${esc(fmtDate(x.lastVisit))}</td>
        <td class="nowrap">${x.lastCorrespondence ? `<span class="${daysSince(x.lastCorrespondence) > 30 ? 'trend-up' : ''}">${esc(fmtDate(x.lastCorrespondence))}</span>` : '<span class="trend-up">never</span>'}</td>
        <td class="small">${esc(x.attorney || '—')}</td>
        <td class="num">${money(x.insuranceBalance)}</td><td class="num">${money(x.patientBalance)}</td><td class="num"><strong>${money(x.totalBalance)}</strong></td>
        <td class="nowrap small">${x.forwardedOn ? esc(fmtDate(x.forwardedOn)) : (x.lopSigned ? 'LOP ' + esc(fmtDate(x.lopSigned)) : '—')}</td>
        <td class="num">${money(x.reductionFloor)}</td><td class="num">${x.attyOffer !== null ? money(x.attyOffer) + `<div class="small muted">${x.offerPct}%</div>` : '—'}</td>
        <td class="num">${money(x.finalSettlement)}</td><td class="nowrap">${esc(fmtDate(x.checkReceived))}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="7">Totals</td><td class="num">${money(r.totals.insurance)}</td><td class="num">${money(r.totals.patient)}</td><td class="num">${money(r.totals.total)}</td><td colspan="5"></td></tr></tfoot></table></div></div>`;
  main.querySelector('#ar-all').addEventListener('change', (e) => { arState.all = e.target.checked; pageAR(main); });
}

// ---------- contacts ----------
const CONTACT_TYPES = [['attorney', 'Attorney / law firm'], ['insurer', 'Insurance company'], ['imaging', 'Imaging center'], ['pain_mgmt', 'Pain management'], ['ortho', 'Orthopedics'],
  ['neuro', 'Neurology'], ['md', 'MD/DO (EMC)'], ['hospital', 'Hospital / ER'], ['pt', 'Physical therapy'], ['other', 'Other']];
const contactDefs = [{ n: 'type', l: 'Type', t: 'select', req: true, opts: CONTACT_TYPES }, { n: 'organization', l: 'Organization / firm' }, { n: 'name', l: 'Contact person' },
  { n: 'email', l: 'Email', t: 'email' }, { n: 'phone', l: 'Phone' }, { n: 'fax', l: 'Fax' }, { n: 'address', l: 'Address', full: true }, { n: 'notes', l: 'Notes', t: 'textarea' }];
async function pageContacts(main) {
  await loadContacts();
  const typeFilter = main.dataset.type || '';
  const list = S.contacts.filter((c) => !typeFilter || c.type === typeFilter);
  main.innerHTML = `<div class="page-head"><div><h1>Contacts</h1><div class="sub">Attorneys, insurers, imaging centers and co-managing providers</div></div><span class="spacer"></span>
      <select id="ct-type" aria-label="Type">${opt('', 'All types', typeFilter)}${CONTACT_TYPES.map(([k, t]) => opt(k, t, typeFilter)).join('')}</select>
      ${can('contacts.write') ? '<button class="btn" data-act="add-contact">+ Contact</button>' : ''}</div>
    <div class="card"><div class="table-wrap">${list.length ? `<table><thead><tr><th>Organization</th><th>Contact</th><th>Type</th><th>Email</th><th>Phone / fax</th><th class="num">Cases</th><th class="num">Referrals</th></tr></thead><tbody>
      ${list.map((c) => `<tr class="click" data-act="edit-contact" data-id="${c.id}"><td><strong>${esc(c.organization || '—')}</strong></td><td>${esc(c.name || '')}</td>
        <td><span class="chip">${esc(Object.fromEntries(CONTACT_TYPES)[c.type])}</span></td><td class="small">${esc(c.email || '')}</td>
        <td class="small nowrap">${esc(c.phone || '')}${c.fax ? '<br>fax ' + esc(c.fax) : ''}</td><td class="num">${c.case_count}</td><td class="num">${c.referral_count}</td></tr>`).join('')}
      </tbody></table>` : '<div class="empty">No contacts.</div>'}</div></div>`;
  main.querySelector('#ct-type').addEventListener('change', (e) => { main.dataset.type = e.target.value; pageContacts(main); });
}

function contactModal(existing) {
  if (!can('contacts.write')) return;
  openModal({
    title: existing ? 'Edit contact' : 'New contact', wide: true, body: fieldsHtml(contactDefs, existing || { type: 'attorney' }),
    extraButtons: existing ? '<button class="btn danger" data-act="archive-contact">Archive</button>' : '',
    onOk: async (el) => {
      await api('contacts.php?action=save', { ...readFields(el, contactDefs), ...(existing ? { id: existing.id } : {}) });
      await loadContacts(); toast('Contact saved');
      if (location.hash.startsWith('#/contacts')) route();
    },
  }).el.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-act=archive-contact]')) return;
    e.stopPropagation();
    if (!await confirmBox('Archive contact', 'Archive this contact? Existing cases keep their link to it.', 'Archive')) return;
    await attempt(() => api('contacts.php?action=archive', { id: existing.id }));
    $modalHost.innerHTML = '';
    await loadContacts(); route();
  });
}

// ---------- admin: users ----------
async function pageAdmin(main) {
  const r = await attempt(() => api('admin.php?action=users'));
  if (!r) return;
  main.innerHTML = `<div class="page-head"><div><h1>Users</h1><div class="sub">Every user signs in with their own account and two-factor. Never share logins.</div></div><span class="spacer"></span><button class="btn" data-act="add-user">+ User</button></div>
    <div class="card"><div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Financials</th><th>Status</th><th>2FA</th><th>Terms</th><th>Last sign-in</th><th></th></tr></thead><tbody>
    ${r.users.map((u) => `<tr><td><strong>${esc(u.name)}</strong></td><td>${esc(u.email)}</td><td><span class="chip">${esc(u.role)}</span></td>
      <td class="small">${u.role !== 'staff' ? 'All' : u.finance_access == 1 ? '<span class="chip teal">All (granted)</span>' : '<a href="#/settings">Staff setting</a>'}</td>
      <td>${u.active == 1 ? (u.locked_until && u.locked_until > new Date().toISOString().slice(0, 19).replace('T', ' ') ? '<span class="chip red">Locked</span>' : '<span class="chip teal">Active</span>') : '<span class="chip na">Disabled</span>'}${u.must_change_password == 1 ? ' <span class="chip ochre">Temp password</span>' : ''}</td>
      <td>${u.totp_enabled == 1 ? '✓' : '<span class="muted">not set up</span>'}</td>
      <td class="small">${u.terms_version === S.termsVersion ? `<span title="Signed &quot;${esc(u.terms_accepted_name)}&quot; ${esc(u.terms_accepted_at)}">✓ ${esc(fmtDate(u.terms_accepted_at.slice(0, 10)))}</span>` : '<span class="muted">at next sign-in</span>'}</td>
      <td class="small">${esc(u.last_login_at || 'never')}</td>
      <td class="nowrap"><button class="btn ghost sm" data-act="edit-user" data-id="${u.id}">Edit</button>
        <button class="btn ghost sm" data-act="reset-user" data-id="${u.id}" data-what="password">Reset password</button>
        <button class="btn ghost sm" data-act="reset-user" data-id="${u.id}" data-what="mfa">Reset 2FA</button>
        <button class="btn ghost sm" data-act="reset-user" data-id="${u.id}" data-what="unlock">Unlock</button></td></tr>`).join('')}
    </tbody></table></div>
    <h3 class="mt">Roles</h3>
    <dl class="kv small"><dt>admin</dt><dd>Everything, plus users and the audit log.</dd><dt>provider</dt><dd>All clinical and financial work.</dd>
      <dt>staff</dt><dd>Front desk / case manager: cases, checklist, referrals, visits, correspondence, documents. Sees financial values only as allowed under Practice settings → Financial visibility, or when granted financial access here. Can't post payments or settlements.</dd>
      <dt>billing</dt><dd>Ledger, settlements, A/R and correspondence. Read-only on clinical records.</dd></dl></div>`;
  main._users = r.users;
}

function userModal(existing) {
  const defs = [{ n: 'name', l: 'Full name', req: true }, ...(existing ? [] : [{ n: 'email', l: 'Email', t: 'email', req: true }]),
    { n: 'role', l: 'Role', t: 'select', blank: false, opts: [['staff', 'Staff'], ['billing', 'Billing'], ['provider', 'Provider'], ['admin', 'Admin']] },
    { n: 'finance_access', l: 'Grant full financial access (staff role only)', t: 'check' },
    ...(hasFeature('email_digest') ? [{ n: 'notify_digest', l: 'Daily email digest', t: 'check' }] : []),
    ...((S.lookups.locations || []).length ? [{ n: 'location_id', l: 'Home location', t: 'select', blank: '—', opts: S.lookups.locations.map((l) => [l.id, l.name]) },
      { n: 'location_restricted', l: 'Limit to their locations (home plus any ticked below)', t: 'check' }] : []),
    ...(existing ? [{ n: 'active', l: 'Active', t: 'check' }] : [])];
  // Other locations a limited person may also see (e.g. front desk covering two offices).
  const extra = new Set((existing?.location_ids || []).map(Number));
  const locBox = (S.lookups.locations || []).length > 1 ? `<fieldset class="assignees mt" id="um-locs"><legend>Also sees these locations</legend><div class="assignee-list">${S.lookups.locations.map((l) => `<label class="check"><input type="checkbox" data-loc="${l.id}"${extra.has(+l.id) ? ' checked' : ''}> ${esc(l.name)}</label>`).join('')}</div>
    <p class="small muted">Only applies when "Limit to their locations" is on. Their home location is always included.</p></fieldset>` : '';
  const m = openModal({ title: existing ? 'Edit user' : 'Add user', body: fieldsHtml(defs, existing || { role: 'staff', notify_digest: 0 }) + locBox, onOk: async (el) => {
    const v = readFields(el, defs);
    const ids = [...el.querySelectorAll('[data-loc]:checked')].map((x) => +x.dataset.loc).filter((i) => i !== +v.location_id);
    const r = await api('admin.php?action=user_save', { ...v, ...(locBox ? { location_ids: ids } : {}), ...(existing ? { id: existing.id } : {}) });
    if (r.tempPassword) showTempPassword(r.tempPassword);
    route();
  } });
  const box = m.el.querySelector('#um-locs'), lim = m.el.querySelector('[name="location_restricted"]'), home = m.el.querySelector('[name="location_id"]');
  if (box && lim) {
    const sync = () => {
      box.hidden = !lim.checked || !home.value;
      box.querySelectorAll('[data-loc]').forEach((c) => { const isHome = c.dataset.loc === home.value; c.disabled = isHome; if (isHome) c.checked = true; });
    };
    lim.addEventListener('change', sync); home.addEventListener('change', sync); sync();
  }
}

function showTempPassword(pw) {
  openModal({ title: 'One-time password', cancelText: 'Done',
    body: `<p>Give this to the user in person or by phone — not by email or text. They'll choose their own password and set up two-factor at first sign-in.</p><div class="secret big mt">${esc(pw)}</div>` });
}

// ---------- audit ----------
const AUDIT_CATEGORIES = [['', 'All activity'], ['changes', 'Changes (added, edited, removed)'], ['access', 'Access (opened, downloaded, exported)'],
  ['signin', 'Sign-ins & security'], ['admin', 'Users, settings & billing']];
async function pageAudit(main) {
  const f = main._f || { user_id: '', category: '', case_number: '', from: '', to: '' };
  const qs = new URLSearchParams(Object.fromEntries(Object.entries(f).filter(([, v]) => v)));
  const r = await attempt(() => api('admin.php?action=audit&' + qs));
  if (!r) return;
  main.innerHTML = `<div class="page-head"><div><h1>Audit log</h1><div class="sub">Every sign-in, view and change, by team member. Review it regularly — HIPAA expects you to watch for inappropriate access.</div></div><span class="spacer"></span>
      <a class="btn ghost" href="api/admin.php?action=audit_csv&${esc(qs.toString())}" download>Download CSV</a></div>
    <div class="filters">
      <select id="au-user" aria-label="Team member">${opt('', 'Everyone', f.user_id)}${r.members.map((u) => opt(u.id, u.name + (u.active == 1 ? '' : ' (inactive)'), f.user_id)).join('')}</select>
      <select id="au-cat" aria-label="Kind of activity">${AUDIT_CATEGORIES.map(([k, t]) => opt(k, t, f.category)).join('')}</select>
      <input id="au-case" placeholder="Case #" value="${esc(f.case_number)}" aria-label="Case number" size="10">
      <input type="date" id="au-from" value="${esc(f.from)}" aria-label="From"><input type="date" id="au-to" value="${esc(f.to)}" aria-label="To">
      <button class="btn ghost sm" data-act="audit-filter">Filter</button></div>
    <div class="card"><div class="table-wrap"><table class="audit"><thead><tr><th>When</th><th>What happened</th><th>Case</th><th>IP address</th></tr></thead><tbody id="au-rows"></tbody></table></div>
      <button class="btn ghost sm mt" id="au-more" hidden>Show older</button></div>`;
  const add = (rows, more) => {
    main.querySelector('#au-rows').insertAdjacentHTML('beforeend', rows.length ? rows.map((e) => `<tr${auditAlarm(e) ? ' class="alarm"' : ''}><td class="nowrap small">${esc(fmtDateTime(e.at))}</td>
      <td>${auditSentence(e)}${auditChangesHtml(e)}</td>
      <td class="small mono">${e.caseId ? `<a href="#/case/${e.caseId}/activity">${esc(e.caseNumber || e.caseId)}</a>` : ''}</td><td class="small mono">${esc(e.ip || '')}</td></tr>`).join('')
      : '<tr><td colspan="4" class="empty">No matching entries.</td></tr>');
    const btn = main.querySelector('#au-more');
    btn.hidden = !more;
    if (rows.length) btn.dataset.before = rows[rows.length - 1].id;
  };
  add(r.entries, r.more);
  main.querySelector('#au-more').addEventListener('click', async (e) => {
    const r2 = await attempt(() => api('admin.php?action=audit&' + qs + '&before=' + e.target.dataset.before));
    if (r2) add(r2.entries, r2.more);
  });
}

// ---------- practice settings ----------
const practiceDefs = () => [{ n: 'name', l: 'Practice name', req: true, full: true }, { n: 'address', l: 'Address (letterhead)', t: 'textarea', rows: 2 },
  { n: 'phone', l: 'Phone' }, { n: 'fax', l: 'Fax' }, { n: 'email', l: 'Office email (attorneys return forms here)', t: 'email' }, { n: 'state', l: 'State (default rules for new cases)', t: 'select', blank: false, opts: stateOpts() }, { n: 'ehr_name', l: 'Your EHR / EMR', ph: 'e.g. ChiroTouch, Jane, ECLIPSE' }];
async function pageSettings(main) {
  const r = await attempt(() => api('admin.php?action=practice'));
  if (!r) return;
  const p = r.practice, baaOk = p.baaVersion === p.currentBaaVersion;
  main.innerHTML = `<div class="page-head"><div><h1>Practice settings</h1><div class="sub">Your letterhead appears on every letter generated for attorneys.</div></div></div>
    <div class="grid-2"><div class="card"><h2>Practice details</h2><div id="practice-form">${fieldsHtml(practiceDefs(), p)}</div>
      <div class="err" id="practice-err"></div><button class="btn mt" data-act="save-practice">Save</button></div>
    <div class="card"><h2>Business Associate Agreement</h2>
      <p class="small mt">Because ${esc(S.brand.vendor || S.brand.name)} stores your patients' health information, HIPAA requires a Business Associate Agreement between your practice and us.</p>
      ${baaOk ? `<div class="notice ok mt">Accepted ${esc(fmtDate(p.baaAcceptedAt))} (version ${esc(p.baaVersion)}).</div>`
        : `<div class="notice mt">${p.baaVersion ? 'The agreement has been updated since you accepted it.' : 'Not yet accepted.'}</div>
           <label class="check mt"><input type="checkbox" id="baa-accept"> I accept the <a href="legal.html#terms" target="_blank" rel="noopener">Terms of Service</a> and the <a href="legal.html#baa" target="_blank" rel="noopener">Business Associate Agreement</a> (version ${esc(p.currentBaaVersion)}) on behalf of ${esc(p.name)}.</label>
           <button class="btn mt" data-act="accept-baa">Accept agreement</button>`}
      <p class="small muted mt"><a href="legal.html#terms" target="_blank" rel="noopener">Terms of Service</a> · <a href="legal.html#baa" target="_blank" rel="noopener">Business Associate Agreement</a> · <a href="legal.html#privacy" target="_blank" rel="noopener">Privacy Policy</a></p></div></div>
    <div class="card mt"><h2>Financial visibility for staff</h2>
      <p class="small mt">Admins, providers and billing always see financials. Choose what the <strong>staff</strong> role (front desk) can see. To open everything to one person, edit them under Users and grant full financial access.</p>
      ${[['balances', 'Balances', 'What insurance and the patient owe, totals, the A/R report and dashboard A/R'], ['ledger', 'Ledger detail', 'Individual charges, payments and balance moves; the itemized statement'],
         ['settlement', 'Settlement', 'Attorney offers, final settlement, reduction floor, amount forwarded, check received']]
        .map(([k, t, dsc]) => `<label class="check mt"><input type="checkbox" data-staff-fin="${k}"${(p.staffFinance || []).includes(k) ? ' checked' : ''}> <span><strong>${t}</strong> <span class="small muted">— ${dsc}</span></span></label>`).join('')}
      <button class="btn mt" data-act="save-staff-fin">Save visibility</button></div>
    <div class="card mt" id="notify-rules"><h2>Daily huddle &amp; email digest</h2>
      ${p.hasHuddle ? '' : `<div class="notice">The Daily huddle is part of the ${esc(featureInfo('huddle').planName)} plan and up; the thresholds below still set the gap and treatment-plan alerts on every case.</div>`}
      ${p.hasDigest ? '' : `<div class="notice">The daily email digest is part of the ${esc(featureInfo('email_digest').planName)} plan.</div>`}
      <p class="small mt">What the Daily huddle and the morning email watch for. Each person chooses whether to get the email (and which of these) under <em>Email notifications</em>; the email has counts and a link only — never patient names.</p>
      ${p.mailReady ? '' : '<div class="notice">Email sending isn\'t set up on this server yet, so digests won\'t go out until it is (see the deployment guide).</div>'}
      <div class="assignee-list mt">${Object.entries(p.notifyCriteria).map(([k, t]) => `<label class="check"><input type="checkbox" data-crit="${k}"${p.notifyRules.criteria.includes(k) ? ' checked' : ''}> ${esc(t)}</label>`).join('')}</div>
      <div class="form-grid mt"><div><label for="nr-gap">Gap in care after (days without a visit)</label><input type="number" id="nr-gap" min="3" max="60" value="${p.notifyRules.gap_days}"></div>
        <div><label for="nr-adh">Behind the treatment plan below (% of planned visits)</label><input type="number" id="nr-adh" min="10" max="100" step="5" value="${p.notifyRules.adherence_pct}"></div>
        <div><label>&nbsp;</label><label class="check"><input type="checkbox" id="nr-weekdays"${p.notifyRules.weekdays_only ? ' checked' : ''}> Weekdays only</label></div></div>
      <button class="btn mt" data-act="save-notify-rules">Save</button></div>
    <div class="card mt" id="task-email-card"><h2>Task email alerts</h2>
      <p class="small">The defaults for new tasks — each task can change its own under <em>Email alerts</em>. Emails say only what happened (urgent, late, completed) with a sign-in link — never the task, patient or case. Late tasks are first emailed the morning after the due date. Each person can turn task emails off under <em>Email notifications</em>.</p>
      ${p.hasTaskEmails ? '' : `<div class="notice mt">Task email alerts are part of the ${esc(featureInfo('task_emails').planName)} plan and up. <a href="#/billing">See plans</a></div>`}
      ${p.mailReady ? '' : '<div class="notice mt">Email sending isn\'t set up on this server yet, so task emails won\'t go out until it is.</div>'}
      <fieldset class="assignees mt"><legend>Email when a task is</legend><div class="assignee-list">${entries(S.lookups.taskEmail.events).map(([k, l]) => `<label class="check"><input type="checkbox" data-tr-on="${k}"${p.taskEmail.on.includes(k) ? ' checked' : ''}> ${esc(l)}</label>`).join('')}</div></fieldset>
      <fieldset class="assignees mt"><legend>Send to</legend><div class="assignee-list">${entries(S.lookups.taskEmail.whoLabels).map(([k, l]) => `<label class="check"><input type="checkbox" data-tr-who="${k}"${p.taskEmail.who.includes(k) ? ' checked' : ''}> ${esc(l)}</label>`).join('')}</div></fieldset>
      <div class="form-grid mt"><div><label for="tr-repeat">Repeat late emails every (days; 0 = once)</label><input type="number" id="tr-repeat" min="0" max="60" value="${p.taskEmail.repeat_days}"></div></div>
      ${p.hasTaskEmails ? '<button class="btn mt" data-act="save-task-email">Save</button>' : ''}</div>
    <div class="card mt" id="status-rules-card"><h2>Attorney status requests</h2>
      <p class="small">Email the attorney or case manager on a schedule asking for a case and payment status update. Each case has its own on/off switch and recipients (on the case's Overview); these are the defaults. The email holds no patient details — just a secure link to a one-minute reply form whose answer is logged on the case, fills in mediation, trial and settlement dates, and creates a task for your team.</p>
      ${p.hasAutoStatus ? '' : `<div class="notice mt">Automatic status requests are part of the ${esc(featureInfo('auto_status').planName)} plan and up. <a href="#/billing">See plans</a></div>`}
      ${p.mailReady ? '' : '<div class="notice mt">Email sending isn\'t set up on this server yet, so requests won\'t go out until it is.</div>'}
      <div class="form-grid mt"><div><label for="sq-every">Send every (days)</label><input type="number" id="sq-every" min="7" max="180" value="${p.statusRules.every_days}"></div></div>
      <label class="check mt"><input type="checkbox" id="sq-default"${p.statusRules.default_on ? ' checked' : ''}> Turn on automatically for new cases</label>
      <label class="check"><input type="checkbox" id="sq-balance"${p.statusRules.show_balance ? ' checked' : ''}> Show the outstanding balance on the reply page (helps with payment status)</label>
      <p class="small muted mt-sm">${p.autoStatusCount} open case${p.autoStatusCount === 1 ? '' : 's'} currently ${p.autoStatusCount === 1 ? 'has' : 'have'} automatic requests on. Requests go out on weekday mornings.</p>
      ${p.hasAutoStatus ? '<div class="badge-row mt"><button class="btn" data-act="save-status-rules">Save</button><button class="btn ghost" data-act="save-status-rules" data-enable="1">Save and turn on for open cases with an attorney</button></div>' : ''}</div>
    <div class="card mt" id="narr-fee-card"><h2>Final narrative reports</h2>
      <p class="small">Does your office charge for a final narrative report? The end-of-treatment letter and the attorney's online reply page show your fee next to each option, and an attorney who requests a report acknowledges the fee. You'll see who acknowledged it, and when, on the case.</p>
      ${narrFeeFields(p.narrativeFees)}
      <button class="btn mt" data-act="save-narrative-fees">Save</button></div>
    <div class="card mt"><h2>Monthly case updates to attorneys</h2>
      <p class="small">Every 30 days, each open injury case's attorney and case manager get a secure link to a one-page update: appointments kept and missed by week, outcome-score progress, referrals made and completed, a balance snapshot (clearly marked as not the official ledger), how to reach your office, and a thank-you. The email itself never includes patient details. Each case can also be switched off on its own.</p>
      <label class="check mt"><input type="checkbox" id="cu-on"${p.caseUpdates ? ' checked' : ''}> Send monthly case updates</label>
      <button class="btn mt" data-act="save-case-updates">Save</button></div>
    <div class="card mt" id="red-card"><h2>Reduction requests</h2>
      <p class="small">When an attorney asks for a reduction, the reduction letter offers your 30-day amount and a higher amount if payment arrives more than 30 days after settlement.</p>
      ${reductionFieldsHtml(p.reductionTerms)}
      <button class="btn mt" data-act="save-reduction-terms">Save</button></div>
    ${whiteLabelCard(p)}
    <div class="card mt"><div class="card-head"><h2>Locations</h2><span class="spacer"></span>${hasFeature('locations') ? '<button class="btn ghost sm" data-act="location-edit">+ Add location</button>' : ''}</div>
      <p class="small">Run more than one office in this account: each case belongs to a location (its letterhead is used on letters and exports), lists filter by location, and team members can be limited to their own location's patients.</p>
      <div id="locations-list" class="mt">${hasFeature('locations') ? '<div class="empty">Loading…</div>' : `<div class="notice">Multiple locations are part of the ${esc(featureInfo('locations').planName)} plan.</div>`}</div></div>
    <div class="card mt" id="costs-card"><div class="card-head"><h2>Outside provider costs</h2></div>
      <p class="small">What other facilities typically charge, used to estimate the other bills on each case from its referrals (an MRI counts once per body region on the referral). Estimates for planning only; each case can adjust its own lines under Financials.</p>
      ${hasFeature('outside_estimates') ? '' : `<div class="notice mt">Outside provider cost estimates are part of the ${esc(featureInfo('outside_estimates').planName)} plan and up. <a href="#/billing">See plans</a></div>`}
      <div class="table-wrap mt"><table><thead><tr><th>Item</th><th>Cost each ($)</th><th>Typical count per referral</th></tr></thead><tbody>
      ${entries(p.costs).map(([k, c]) => `<tr><td>${esc(c.label)} <span class="small muted">per ${esc(c.unit)}</span></td><td><input type="number" min="0" step="1" value="${+c.cost}" data-cost="${k}" data-f="cost" aria-label="${esc(c.label)} cost"></td>
        <td>${c.ref ? `<input type="number" min="0" step="1" value="${+c.typical}" data-cost="${k}" data-f="typical" aria-label="${esc(c.label)} typical count">` : '<span class="small muted">Added by hand on a case</span>'}</td></tr>`).join('')}
      </tbody></table></div>
      ${hasFeature('outside_estimates') ? '<div class="badge-row mt"><button class="btn" data-act="save-costs">Save cost list</button><button class="btn ghost" data-act="save-costs" data-reset="1">Reset to defaults</button></div>' : ''}</div>
    <div class="card mt" id="steps-card"><div class="card-head"><h2>Case steps &amp; checklist</h2><span class="spacer"></span>${hasFeature('custom_steps') ? '<button class="btn ghost sm" data-act="step-edit">+ Add your own step</button>' : ''}</div>
      <p class="small">Add the steps your office follows (they appear on every matching case's checklist, with due dates and alerts), and silence built-in steps your practice doesn't use. Silencing applies to every case; a single case can still mark a step "not needed".</p>
      <div id="steps-body" class="mt"><div class="empty">Loading…</div></div></div>
    <div class="card mt" id="badge-card"><div class="card-head"><h2>${esc(S.brand.vendor || S.brand.name)} Certified badge</h2></div>
      <p class="small">Put a badge on your website to show patients, attorneys and referral partners that your practice manages PI cases on secure, HIPAA-ready software. It links to a live verification page and turns itself off if your account lapses.</p>
      <div id="badge-body" class="mt"><div class="empty">Loading…</div></div></div>
    <div class="card mt"><h2>EHR ledger layouts</h2>
      <p class="small mt">When someone uploads a ledger spreadsheet in a new layout, they match up its columns once and it's saved here. Later uploads in the same layout are read automatically.</p>
      <div id="ehr-formats" class="mt"><div class="empty">Loading…</div></div></div>`;
  loadEhrFormats();
  loadLocations();
  paintWlPreview();
  loadBadge();
  loadSteps();
}

async function loadSteps() {
  const box = document.getElementById('steps-body');
  if (!box) return;
  const r = await attempt(() => api('admin.php?action=steps'));
  if (!r) return;
  loadSteps.data = r;
  const types = (cs) => !cs || cs.length >= Object.keys(r.injuryTypes).length ? 'All cases' : cs.map((c) => r.injuryTypes[c] || c).join(', ');
  const due = (st) => st.anchor === 'none' ? 'When it happens' : `${+st.days ? st.days + ' day' + (+st.days === 1 ? '' : 's') + ' after the' : 'On the day of the'} ${r.anchors[st.anchor]}`;
  const toggle = (it) => `<button class="btn ${it.silenced ? '' : 'ghost '}sm" data-act="step-silence" data-key="${esc(it.key)}" data-on="${it.silenced ? 0 : 1}">${it.silenced ? 'Turn back on' : 'Silence'}</button>`;
  const row = (it, sub) => `<tr${it.silenced ? ' class="muted"' : ''}><td>${esc(it.title)}${it.stateOnly ? ' <span class="chip">State rule</span>' : ''}${it.insuranceOnly ? ' <span class="chip">Insurance cases</span>' : ''}${sub ? `<div class="small muted">${esc(sub)}</div>` : ''}</td><td class="small">${esc(types(it.cases))}</td><td>${it.silenced ? '<span class="chip na">Silenced</span>' : '<span class="chip teal">On</span>'}</td><td class="right">${toggle(it)}</td></tr>`;
  box.innerHTML = `<div class="notice ok"><label class="check"><input type="checkbox" id="pack-chart"${r.packs.chart_setup ? ' checked' : ''}> <span><strong>Include new patient chart-setup steps</strong> — the front-desk intake routine (details to get on the phone, paperwork texted, claim verified with the attorney, EHR profile and chart flags, welcome video, next-day check-in call) as a checklist group on every case. Off by default; turn off any single step below.</span></label></div>
    <h3 class="mt">Your own steps</h3>
    ${!r.customEnabled ? `<div class="notice">Custom case steps are part of the ${esc(featureInfo('custom_steps').planName)} plan.${r.custom.length ? ' Your saved steps are kept and come back when you upgrade.' : ''} <a href="#/billing">See plans</a></div>` : r.custom.length ? `<div class="table-wrap"><table><thead><tr><th>Step</th><th>Applies to</th><th>Due</th><th></th></tr></thead><tbody>${r.custom.map((st) => `<tr><td><strong>${esc(st.title)}</strong>${st.detail ? `<div class="small muted">${esc(st.detail)}</div>` : ''}</td>
      <td class="small">${esc(types(st.cases ? st.cases.split(',') : null))}</td><td class="small">${esc(due(st))}</td>
      <td class="right nowrap"><button class="btn ghost sm" data-act="step-edit" data-id="${st.id}">Edit</button> <button class="btn ghost sm" data-act="step-remove" data-id="${st.id}">Remove</button></td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">None yet — e.g. "Welcome call to the patient", "Send intake packet to the attorney", "30-day progress photos".</div>'}
    <details class="mt"><summary><strong>Built-in Next steps</strong> <span class="small muted">(${r.guide.filter((g) => g.silenced).length} silenced)</span></summary>
      <div class="table-wrap mt-sm"><table><tbody>${r.guide.map((g) => row(g, g.when)).join('')}</tbody></table></div></details>
    <details class="mt"><summary><strong>Built-in checklist items</strong> <span class="small muted">(${r.checklist.filter((g) => g.silenced).length} silenced)</span></summary>
      <div class="table-wrap mt-sm"><table><tbody>${r.checklist.map((c) => row(c, c.group)).join('')}</tbody></table></div></details>
    <p class="small muted mt">"State rule" items only show on cases in states where they apply — silence them only if your counsel agrees they don't apply to you.</p>`;
}

function stepModal(id) {
  const r = loadSteps.data;
  const st = id ? r.custom.find((x) => +x.id === +id) : { anchor: 'first_visit', days: 2 };
  const picked = st.cases ? st.cases.split(',') : Object.keys(r.injuryTypes);
  const defs = [{ n: 'title', l: 'Step', req: true, full: true, ph: 'e.g. Welcome call to the patient' }, { n: 'detail', l: 'Instructions for the team (optional)', t: 'textarea', rows: 2 },
    { n: 'anchor', l: 'Due — counted from', t: 'select', blank: false, opts: [['first_visit', 'First visit'], ['date_of_injury', 'Date of the accident'], ['care_end', 'MMI / discharge'], ['none', 'No due date']] },
    { n: 'days', l: 'Days after', t: 'number' }];
  openModal({ title: id ? 'Edit step' : 'Add your own step', wide: true, okText: 'Save',
    body: fieldsHtml(defs, st) + `<h3 class="mt">Applies to</h3><div class="mt">${entries(r.injuryTypes).map(([k, t]) => `<label class="check"><input type="checkbox" data-step-case="${k}"${picked.includes(k) ? ' checked' : ''}> ${esc(t)}</label>`).join('')}</div>`,
    onOk: async (el) => { await api('admin.php?action=step_save', { ...readFields(el, defs), cases: [...el.querySelectorAll('[data-step-case]:checked')].map((x) => x.dataset.stepCase), ...(id ? { id: +id } : {}) }); toast('Saved'); loadSteps(); } });
}

const BADGE_STYLES = [['light', 'Light'], ['dark', 'Dark'], ['seal', 'Round seal']];
async function loadBadge(data) {
  const box = document.getElementById('badge-body');
  if (!box) return;
  const b = data || (await attempt(() => api('admin.php?action=badge')))?.badge;
  if (!b) return;
  loadBadge.data = b;
  const style = loadBadge.style || 'light';
  const preview = (st) => 'api/badge.php?' + b.urls.image.split('?')[1] + (st === 'light' ? '' : '&style=' + st);
  const file = (st, ext) => `assets/badges/injurycase-certified-${st}.${ext}`;
  const blocked = b.items.filter((i) => i.key !== 'enabled' && !i.met);
  box.innerHTML = `<ul class="badge-checks">${b.items.map((i) => `<li class="${i.met ? 'ok' : ''}"><span aria-hidden="true">${i.met ? '✓' : '○'}</span> ${esc(i.label)}</li>`).join('')}</ul>
    ${b.certified ? `<div class="notice ok mt">Your badge is live${b.enabledAt ? ` — certified since ${esc(fmtDate(b.enabledAt))}` : ''}.</div>`
      : b.enabled && blocked.length ? '<div class="notice mt">The badge is switched on but shows as <strong>not verified</strong> until the items above are complete.</div>' : ''}
    <div class="badge-row mt"><button class="btn${b.enabled ? ' ghost' : ''} sm" data-act="badge-toggle">${b.enabled ? 'Turn badge off' : 'Turn badge on'}</button>
      <a class="btn ghost sm" href="${esc(b.urls.verify)}" target="_blank" rel="noopener">Open verification page</a></div>
    <div class="badge-tabs mt" role="tablist">${BADGE_STYLES.map(([k, t]) => `<button class="chip${k === style ? ' on' : ''}" role="tab" aria-selected="${k === style}" data-act="badge-style" data-style="${k}">${t}</button>`).join('')}</div>
    <div class="badge-preview${style === 'dark' ? ' on-dark' : ''} mt"><img src="${esc(preview(style))}" alt="Badge preview" width="${style === 'seal' ? 160 : 240}" height="${style === 'seal' ? 160 : 72}"></div>
    <label class="mt" for="badge-code">Embed code — paste into your website (Wix, Squarespace, WordPress: an "HTML" or "Embed" block)</label>
    <textarea id="badge-code" class="mono small" rows="3" readonly>${esc(b.urls.embed[style])}</textarea>
    <div class="badge-row mt"><button class="btn sm" data-act="badge-copy">Copy code</button>
      ${b.certified ? `<a class="btn ghost sm" href="${file(style, 'png')}" download>Download PNG</a><a class="btn ghost sm" href="${file(style, 'svg')}" download>Download SVG</a>` : ''}
      <span class="spacer"></span><button class="btn ghost sm" data-act="badge-reset" title="Use if the code was copied somewhere it shouldn't be">New links</button></div>
    <p class="small muted mt">Downloaded images are for print and social posts; online, use the embed code so the badge stays verifiable. By showing the badge you agree to the <a href="legal.html#badge" target="_blank" rel="noopener">badge terms</a>.</p>`;
}

async function loadLocations() {
  const box = document.getElementById('locations-list');
  if (!box || !hasFeature('locations')) return;
  const r = await attempt(() => api('admin.php?action=locations'));
  if (!r) return;
  loadLocations.rows = r.locations;
  box.innerHTML = r.locations.length ? `<table><thead><tr><th>Location</th><th>Address</th><th>Phone / fax</th><th class="num">Open cases</th><th class="num">Team</th><th></th></tr></thead><tbody>
    ${r.locations.map((l) => `<tr${l.active == 1 ? '' : ' class="muted"'}><td><strong>${esc(l.name)}</strong>${l.active == 1 ? '' : ' <span class="chip na">Inactive</span>'}</td><td class="small">${esc(l.address || '')}</td>
      <td class="small">${esc([l.phone, l.fax ? 'fax ' + l.fax : ''].filter(Boolean).join(' · '))}</td><td class="num">${l.cases}</td><td class="num">${l.users}</td>
      <td class="right"><button class="btn ghost sm" data-act="location-edit" data-id="${l.id}">Edit</button></td></tr>`).join('')}</tbody></table>`
    : '<div class="empty">No locations yet — add your first office.</div>';
}
function locationModal(id) {
  const l = id ? loadLocations.rows.find((x) => +x.id === +id) : { active: 1 };
  const defs = [{ n: 'name', l: 'Name', req: true, ph: 'e.g. Miami — Coral Way' }, { n: 'address', l: 'Address (letterhead)', t: 'textarea', rows: 2 },
    { n: 'state', l: "State (new cases here follow this state's rules)", t: 'select', blank: "Practice's state", opts: stateOpts() }, { n: 'phone', l: 'Phone' }, { n: 'fax', l: 'Fax' },
    ...(id ? [{ n: 'active', l: 'Active', t: 'check' }] : [])];
  openModal({ title: id ? 'Edit location' : 'Add location', okText: 'Save', body: fieldsHtml(defs, l),
    onOk: async (el) => {
      const body = { ...readFields(el, defs), ...(id ? { id: +id } : {}) };
      try { await api('admin.php?action=location_save', body); }
      catch (err) {
        // Beyond the plan's included locations: confirm the add-on, pay, then save.
        if (err.data?.code !== 'location_addon') throw err;
        const a = err.data;
        if (!a.canPay) throw err;
        const per = a.interval === 'annual' ? '/year' : '/month';
        if (!(await confirmBox('Add another location?', `Your plan covers ${a.allowance} location${a.allowance === 1 ? '' : 's'}. Each additional location is ${money2(a.price)}${per}${a.today > 0 ? ` — about ${money2(a.today)} today for the rest of this billing period` : ''}, added to your subscription.`, `Add location (${money2(a.price)}${per})`))) return false;
        const r = await attempt(() => api('billing.php?action=locations_change', { quantity: a.quantity }));
        if (!r) return false;
        await api('admin.php?action=location_save', body);
      }
      toast('Saved'); await refreshSession(); loadLocations();
    } });
}

async function loadEhrFormats() {
  const box = document.getElementById('ehr-formats');
  if (!box) return;
  const r = await attempt(() => api('ehr.php?action=formats'));
  if (!r) { box.innerHTML = ''; return; }
  box.innerHTML = r.formats.length ? `<table><thead><tr><th>EHR</th><th>Layout</th><th>Saved by</th><th>Updated</th><th></th></tr></thead><tbody>
    ${r.formats.map((f) => `<tr><td>${esc(f.name)}</td><td class="small">${f.layout === 'lines' ? 'One row per charge' : 'One row per transaction'}</td><td class="small">${esc(f.created_by_name || '—')}</td>
      <td class="small">${esc(fmtDate(f.updated_at))}</td><td class="right"><button class="btn ghost sm" data-act="delete-ehr-format" data-id="${f.id}">Forget</button></td></tr>`).join('')}</tbody></table>`
    : '<div class="empty">None yet — the first spreadsheet upload creates one.</div>';
}

// ---------- plan & billing ----------
const billingInterval = { value: '' };
async function pageBilling(main) {
  const r = await attempt(() => api('billing.php?action=status'));
  if (!r) return;
  changePlan.status = r;
  const p = r.practice;
  if (location.hash.includes('done=1')) { toast('Thanks! Your subscription is being activated.'); history.replaceState(null, '', '#/billing'); setTimeout(refreshSession, 2500); }
  const freeUntil = p.status === 'active' && p.subscribed && p.trialEndsAt && p.trialEndsAt.slice(0, 10) > today() ? p.trialEndsAt.slice(0, 10) : null;
  const statusText = { trialing: p.access === 'full' ? `Free trial — ${p.trialDaysLeft} days left` : 'Free trial ended',
    active: freeUntil ? `Subscribed (${p.interval}) — free until ${fmtDate(freeUntil)}` : `Active · billed ${p.interval === 'annual' ? 'yearly' : 'monthly'}`,
    past_due: 'Payment past due', canceled: 'Canceled', comped: 'Complimentary' }[p.status];
  const interval = billingInterval.value || (p.interval === 'annual' ? 'annual' : 'monthly');
  const anyAnnual = Object.values(r.plans).some((pl) => pl.availableAnnual);
  const usage = (n, max) => `${n}${max ? ' of ' + max : ''}`;
  const pct = (n, max) => max ? Math.min(100, Math.round(n / max * 100)) : 0;
  main.innerHTML = `<div class="page-head"><div><h1>Plan &amp; billing</h1><div class="sub">${esc(p.planName)} plan · ${esc(statusText)}${p.currentPeriodEnd && p.status === 'active' ? (freeUntil ? ' · first charge ' : ' · renews ') + esc(fmtDate(p.currentPeriodEnd)) : ''}</div></div><span class="spacer"></span>
      ${r.hasCustomer ? '<button class="btn ghost" data-act="billing-portal">Manage billing &amp; invoices</button>' : ''}</div>
    <div class="tiles">
      <div class="tile"><div class="k">Open cases</div><div class="v">${usage(p.activeCases, p.limits.activeCases)}</div>${p.limits.activeCases ? `<div class="bar ${pct(p.activeCases, p.limits.activeCases) >= 90 ? 'warn' : ''}"><i data-w="${pct(p.activeCases, p.limits.activeCases)}"></i></div>` : ''}</div>
      <div class="tile"><div class="k">Users</div><div class="v">${usage(p.activeUsers, p.limits.users)}</div>${p.limits.users ? `<div class="bar"><i data-w="${pct(p.activeUsers, p.limits.users)}"></i></div>` : ''}</div>
      ${p.locations.active > 1 || p.locations.extra ? `<div class="tile"><div class="k">Locations</div><div class="v">${p.locations.active}${p.locations.allowance ? ' of ' + p.locations.allowance : ''}</div>
        <div class="small muted">${p.locations.included} included${p.locations.extra ? ` + ${p.locations.extra} extra at $${p.locations.price}/month each` : ''}</div></div>` : ''}
    </div>
    ${!r.billingReady ? '<div class="notice">Online billing isn\'t switched on yet for this installation.</div>' : ''}
    ${p.promo && !['active', 'past_due', 'comped'].includes(p.status) ? `<div class="notice ok">Promo code <strong class="mono">${esc(p.promo.code)}</strong>: ${esc(p.promo.summary)}${p.promo.plans ? ' (' + esc(p.promo.plans.map((k) => r.plans[k]?.name || k).join(' or ') + ' plan') + ')' : ''} — applied automatically at checkout.</div>` : ''}
    ${p.status === 'trialing' && p.access === 'full' && p.product !== 'eob' ? `<div class="notice ok">Your free trial includes everything in ${esc(r.plans[PLAN_TOP(r)].name)} — unlimited cases and users and every feature. When you subscribe, the plan you choose applies straight away. You can change plans any time; upgrades are charged only the difference and start the moment the payment goes through.</div>` : ''}
    ${p.status === 'trialing' && p.access === 'full' ? `<div class="notice ok">${r.firstCharge ? `Subscribing now keeps the rest of your free trial — your card is first charged on <strong>${esc(fmtDate(r.firstCharge))}</strong>.` : 'Your trial ends within two days, so billing starts when you subscribe.'} Cancel any time before then and you won't be charged.</div>` : ''}
    <div class="interval-toggle" role="radiogroup" aria-label="Billing period">
      <button role="radio" data-act="billing-interval" data-v="monthly" class="${interval === 'monthly' ? 'on' : ''}" aria-checked="${interval === 'monthly'}">Monthly</button>
      <button role="radio" data-act="billing-interval" data-v="annual" class="${interval === 'annual' ? 'on' : ''}" aria-checked="${interval === 'annual'}"${anyAnnual || !r.billingReady ? '' : ' disabled title="Annual billing isn\'t set up yet"'}>Annual <span class="save">2 months free</span></button>
    </div>
    ${p.product === 'eob' ? `<div class="notice ok">You're on <strong>EOB Genie</strong>. Gold includes EOB Genie <em>and</em> all of ${esc(S.brand.vendor || S.brand.name)} — case tracking, checklists, letters, attorney updates — for $${r.plans.practice.price - r.plans.eob.price} more a month. Your EOBs and patients carry over.</div>` : ''}
    <div class="plans">${entries(r.plans).sort(([a, x], [b, y]) => (x.standalone ? (p.product === 'eob' ? -1 : 1) : 0) - (y.standalone ? (p.product === 'eob' ? -1 : 1) : 0)).map(([k, pl]) => {
      const current = k === p.plan && ['active', 'past_due', 'comped'].includes(p.status) && (p.status === 'comped' || p.interval === interval);
      const annual = interval === 'annual';
      const avail = annual ? pl.availableAnnual : pl.available;
      const subscribed = p.subscribed && ['active', 'past_due'].includes(p.status);
      return `<div class="plan-card${current ? ' current' : ''}${pl.standalone ? ' genie-plan' : ''}">${pl.standalone ? '<img src="assets/genie/logo.png" alt="" class="genie-plan-logo"><span class="chip info">On its own — no case management</span>' : ''}<h3>${esc(pl.name)}</h3>
        <div class="price">$${annual ? pl.annual_price : pl.price}<span>/${annual ? 'year' : 'month'}</span></div>
        <p class="small ${annual ? '' : 'muted'}">${annual ? `$${(pl.annual_price / 12).toFixed(2)}/month · save $${pl.price * 12 - pl.annual_price} a year` : `or $${pl.annual_price}/year with annual billing`}</p>
        <p class="small muted">${esc(pl.blurb)}</p>
        ${pl.locations ? `<p class="small"><strong>${pl.locations.included} locations included</strong> · each additional location $${annual ? pl.locations.extra_price * r.annualMonthsCharged + '/year' : pl.locations.extra_price + '/month'}${p.locations.active > pl.locations.included ? ` — you have ${p.locations.active}, so +$${(p.locations.active - pl.locations.included) * (annual ? pl.locations.extra_price * r.annualMonthsCharged : pl.locations.extra_price)}/${annual ? 'year' : 'month'}` : ''}</p>` : ''}
        ${pl.standalone ? `<ul class="small"><li>Upload and read auto / PIP EOBs — one or a whole batch</li><li>Matched to each patient and posted to the ledger</li><li>Money left on the table, with demand letters</li><li>Fees below the PIP schedule</li><li>Late payments, bills with no EOB, late billing</li><li>PIP running-out forecast</li><li>Every insurer side by side</li><li>${pl.users} users</li></ul>`
          : `<ul class="small"><li>${pl.active_cases ? pl.active_cases + ' open cases' : 'Unlimited open cases'}</li><li>${pl.users ? pl.users + ' users' : 'Unlimited users'}</li><li>Unlimited closed cases</li>
          ${(pl.features || []).map((f) => `<li class="${f.included ? '' : 'no'}">${esc(f.name)}</li>`).join('')}</ul>`}
        ${current ? '<span class="chip teal">Current plan</span>' : p.status === 'comped' ? '' : subscribed ? changePlanButton(r, k, interval)
          : `<button class="btn${k === p.plan ? '' : ' ghost'}" data-act="checkout" data-plan="${k}" data-interval="${interval}"${avail ? '' : ' disabled'}>${p.status === 'trialing' && r.firstCharge ? 'Add card — keep free days' : 'Subscribe'}</button>`}</div>`;
    }).join('')}</div>
    <p class="small mt"><strong>Paid plans renew automatically</strong> every month or year (as chosen) at the price shown, charged to your card until you cancel. Cancel any time online under <em>Manage billing &amp; invoices</em>; access continues to the end of the paid period. See the <a href="legal.html#terms" target="_blank" rel="noopener">Terms of Service</a>.</p>
    <p class="small muted mt">Payments are processed by Stripe; ${esc(S.brand.vendor || S.brand.name)} never sees your card. Closed and dropped cases don't count toward your limit. If you cancel, your records stay readable and exportable.</p>`;
  main.querySelectorAll('.bar > i[data-w]').forEach((i) => { i.style.width = i.dataset.w + '%'; });
}

const PLAN_TOP = (r) => Object.keys(r.plans).filter((k) => !r.plans[k].standalone).at(-1);

// Switching a live subscription: upgrades pay the prorated difference now
// and take effect the moment the payment is confirmed.
function changePlanButton(r, plan, interval) {
  const o = r.changePreview?.options?.[plan]?.[interval];
  if (!o) return '<button class="btn ghost" data-act="billing-portal">Switch in Manage billing</button>';
  if (!o.available) return '<button class="btn ghost" disabled>Not available</button>';
  const label = r.changePreview.inTrial ? (o.upgrade ? 'Upgrade — free during your trial' : 'Switch — free during your trial')
    : o.upgrade ? `Upgrade — about ${money(o.today)} today` : `Switch${o.credit ? ` — about ${money(o.credit)} credit` : ''}`;
  return `<button class="btn${o.upgrade ? '' : ' ghost'}" data-act="change-plan" data-plan="${plan}" data-interval="${interval}">${esc(label)}</button>`;
}

async function changePlan(el) {
  const r = changePlan.status, plan = el.dataset.plan, interval = el.dataset.interval, pl = r.plans[plan], o = r.changePreview.options[plan][interval];
  const what = `${pl.name} (${interval === 'annual' ? 'billed yearly' : 'billed monthly'})`;
  const text = r.changePreview.inTrial ? `You'll move to ${what} now. Nothing is charged until your free trial ends.`
    : o.upgrade ? `You'll be charged the prorated difference for the rest of this billing period — about ${money(o.today)} — to your card on file. ${pl.name} features and limits start the moment the payment is confirmed.`
    : `You'll move to ${what} now. Features and limits change immediately, and the unused part of this period (about ${money(o.credit)}) is credited to your next bill.`;
  if (!(await confirmBox('Change to ' + what + '?', text, o.upgrade && !r.changePreview.inTrial ? 'Pay and upgrade' : 'Change plan'))) return;
  try {
    await api('billing.php?action=change_plan', { plan, interval });
    toast('You\'re now on ' + pl.name); await refreshSession(); pageBilling(document.getElementById('main'));
  } catch (e) {
    if (e.data?.payUrl) { if (await confirmBox('Payment needed', e.message, 'Complete payment')) window.open(e.data.payUrl, '_blank', 'noopener'); }
    else toast(e.message, true);
  }
}

// ---------- operator console ----------
// ---------- feature suggestions ----------
const FB_CHIP = { new: 'info', reviewing: 'due', planned: 'legal', done: 'done', declined: 'na' };
async function suggestModal() {
  const r = await attempt(() => api('feedback.php?action=list'));
  if (!r) return;
  const page = (location.hash.replace(/^#\/?/, '').split('/')[0] || 'dashboard');
  openModal({ title: 'Suggest a feature', wide: true, okText: 'Send suggestion', body: `
    <p class="small">Tell us what would make ${esc(S.brand.name)} work better for your practice — a new feature, a change to an existing one, or something that isn't working.</p>
    <div class="notice">Please don't include patient names or any patient details.</div>
    <div class="form-grid mt">
      <div><label for="fb-kind">Type</label><select id="fb-kind">${Object.entries(r.kinds).map(([k, t]) => opt(k, t, 'feature')).join('')}</select></div>
      <div><label for="fb-area">Area</label><select id="fb-area">${r.areas.map((a) => opt(a, a, '')).join('')}</select></div>
      <div class="full"><label for="fb-title">Short title *</label><input id="fb-title" maxlength="160" placeholder="e.g. Text-message reminders for appointments"></div>
      <div class="full"><label for="fb-body">Details</label><textarea id="fb-body" rows="4" placeholder="What would you like it to do, and how would it help your team?"></textarea></div>
    </div>
    ${r.items.length ? `<h3 class="mt">Your practice's suggestions</h3><ul class="fb-list">${r.items.map((i) => `<li><div><span class="chip ${FB_CHIP[i.status]}">${esc(r.statuses[i.status])}</span> <strong>${esc(i.title)}</strong> <span class="small muted">${esc(i.by || '')} · ${esc(fmtDate(i.at))}</span></div>${i.response ? `<div class="small fb-reply">Reply: ${esc(i.response)}</div>` : ''}</li>`).join('')}</ul>` : ''}`,
    onOk: async (el) => {
      const title = el.querySelector('#fb-title').value.trim();
      if (!title) throw new Error('Give your suggestion a short title.');
      await api('feedback.php?action=submit', { kind: el.querySelector('#fb-kind').value, area: el.querySelector('#fb-area').value, title, body: el.querySelector('#fb-body').value.trim(), page });
      toast('Thanks — suggestion sent');
    } });
}

async function feedbackSectionHtml() {
  const r = await attempt(() => api('feedback.php?action=all'));
  if (!r) return '';
  pagePlatform._fb = r;
  return `<div class="card mt"><div class="card-head"><h2>Feature suggestions</h2>${Object.entries(r.statuses).map(([k, t]) => `<span class="chip ${FB_CHIP[k]}">${esc(t)}: ${r.counts[k] || 0}</span>`).join(' ')}</div>
    ${r.items.length ? `<div class="table-wrap"><table><thead><tr><th>Suggestion</th><th>Practice</th><th>Area</th><th>Received</th><th>Status</th><th></th></tr></thead><tbody>
      ${r.items.map((i) => `<tr><td><strong>${esc(i.title)}</strong> <span class="small muted">${esc(r.kinds[i.kind])}</span>${i.body ? `<div class="small prewrap">${esc(i.body)}</div>` : ''}${i.response ? `<div class="small fb-reply">Reply: ${esc(i.response)}</div>` : ''}</td>
        <td class="small">${esc(i.practice || '')}<br>${esc(i.by || '')}</td><td class="small">${esc(i.area || '')}</td><td class="small nowrap">${esc(fmtDate(i.at))}</td>
        <td><span class="chip ${FB_CHIP[i.status]}">${esc(r.statuses[i.status])}</span></td><td><button class="btn ghost sm" data-act="op-feedback" data-id="${i.id}">Update</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No suggestions yet.</div>'}</div>`;
}
function feedbackUpdateModal(id) {
  const r = pagePlatform._fb; const i = r.items.find((x) => x.id === id);
  openModal({ title: 'Update suggestion', okText: 'Save', body: `<p><strong>${esc(i.title)}</strong></p>
    <label for="fbu-status">Status</label><select id="fbu-status">${Object.entries(r.statuses).map(([k, t]) => opt(k, t, i.status)).join('')}</select>
    <label for="fbu-resp">Reply to the practice (optional)</label><textarea id="fbu-resp" rows="3">${esc(i.response || '')}</textarea>`,
    onOk: async (el) => { await api('feedback.php?action=update', { id, status: el.querySelector('#fbu-status').value, response: el.querySelector('#fbu-resp').value.trim() }); toast('Saved'); pagePlatform(document.getElementById('main')); } });
}

async function pagePlatform(main) {
  const r = await attempt(() => api('platform.php?action=practices'));
  if (!r) return;
  const list = r.practices;
  const count = (st) => list.filter((p) => p.status === st).length;
  main.innerHTML = `<div class="page-head"><div><h1>Practices</h1><div class="sub">Subscriptions and usage. Operator accounts can't open patient records.</div></div></div>
    <div class="tiles"><div class="tile accent"><div class="k">MRR</div><div class="v">${money(r.mrr)}</div></div>
      <div class="tile"><div class="k">Active</div><div class="v">${count('active')}</div></div><div class="tile"><div class="k">Trialing</div><div class="v">${count('trialing')}</div></div>
      <div class="tile"><div class="k">Past due</div><div class="v">${count('past_due')}</div></div><div class="tile"><div class="k">Canceled</div><div class="v">${count('canceled')}</div></div></div>
    <div class="card"><div class="table-wrap"><table><thead><tr><th>Practice</th><th>Owner</th><th>Plan</th><th>Status</th><th class="num">Users</th><th class="num">Open cases</th><th>Last sign-in</th><th>BAA</th><th>Signed up</th><th></th></tr></thead><tbody>
    ${list.map((p) => `<tr><td><strong>${esc(p.name)}</strong></td><td class="small">${esc(p.ownerEmail || '—')}</td>
      <td><select data-act-change="plan" data-id="${p.id}" aria-label="Plan">${entries(r.plans).map(([k, pl]) => opt(k, pl.name, p.plan)).join('')}</select></td>
      <td><span class="chip ${p.access === 'read_only' ? 'red' : p.status === 'active' || p.status === 'comped' ? 'teal' : 'ochre'}">${esc(p.status)}${p.status === 'trialing' && p.access === 'full' ? ' · ' + p.trialDaysLeft + 'd' : ''}</span></td>
      <td class="num">${p.users}${p.limits.users ? '/' + p.limits.users : ''}</td><td class="num">${p.openCases}${p.limits.activeCases ? '/' + p.limits.activeCases : ''}</td>
      <td class="small">${esc(p.lastLogin || 'never')}</td><td class="small">${p.baaCurrent ? '✓' : '<span class="trend-up">needed</span>'}</td><td class="small">${esc(fmtDate(p.createdAt))}</td>
      <td class="nowrap">${['trialing', 'canceled'].includes(p.status) ? `<button class="btn ghost sm" data-act="op-extend" data-id="${p.id}">+14 days trial</button>` : ''}
        <button class="btn ghost sm" data-act="op-comp" data-id="${p.id}" data-on="${p.status === 'comped' ? 0 : 1}">${p.status === 'comped' ? 'Remove comp' : 'Comp'}</button></td></tr>`).join('')}
    </tbody></table></div></div>${await promoSectionHtml()}${await feedbackSectionHtml()}`;
  main.querySelectorAll('[data-act-change=plan]').forEach((sel) => sel.addEventListener('change', async () => {
    if (await attempt(() => api('platform.php?action=practice_update', { id: +sel.dataset.id, plan: sel.value }))) { toast('Plan changed'); pagePlatform(main); }
  }));
}

// ---------- marketing (operator): automatic outreach to clinics ----------
const mktState = { status: '', specialty: '', q: '', page: 0 };
const MKT_STATUS = { new: 'Waiting for research', qualified: 'Qualified', not_fit: 'Not a fit', no_email: 'No email found', ready: 'Queued', in_sequence: 'In sequence', done: 'Sequence finished',
  unsubscribed: 'Unsubscribed', bounced: 'Bounced', converted: 'Started a trial', paused: 'Paused', error: 'Error' };

async function pageMarketing(main) {
  const r = await attempt(() => api('platform.php?action=mkt_overview'));
  if (!r) return;
  pageMarketing.data = r;
  const s = r.settings, f = r.funnel, st = r.byStatus;
  const tile = (k, v, cls = '') => `<div class="tile ${cls}"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`;
  const check = (ok, text) => `<li class="${ok ? 'ok' : 'todo'}">${ok ? '✓' : '○'} ${text}</li>`;
  const chk = (id, on, label) => `<label class="check"><input type="checkbox" id="${id}"${on ? ' checked' : ''}> ${esc(label)}</label>`;
  const num = (id, label, v, extra = '') => `<div><label for="${id}">${esc(label)}</label><input type="number" id="${id}" value="${esc(v)}" ${extra}></div>`;
  const txt = (id, label, v, ph = '') => `<div><label for="${id}">${esc(label)}</label><input id="${id}" value="${esc(v)}" placeholder="${esc(ph)}"></div>`;
  main.innerHTML = `<div class="page-head"><div><h1>Marketing</h1><div class="sub">Automatic prospecting and outreach to practices that treat auto-accident patients.</div></div><span class="spacer"></span>
      <button class="btn ghost" data-act="mkt-add">+ Add a prospect</button></div>
    ${r.blocker ? `<div class="notice">${esc(r.blocker)}</div>` : '<div class="notice ok"><strong>Sending is on.</strong> Emails go out ' + esc(s.window_start) + ':00–' + esc(s.window_end) + ':00 in each practice\'s time zone' + (s.weekdays_only ? ', weekdays' : '') + '.</div>'}
    <div class="tiles">${tile('Prospects found', f.total)}${tile('Qualified with email', (st.ready || 0) + (st.in_sequence || 0) + (st.done || 0) + (st.converted || 0) + (st.unsubscribed || 0) + (st.bounced || 0))}
      ${tile('Sent today', r.sentToday + ' / ' + r.capToday, 'accent')}${tile('Due now', r.queuedNow)}${tile('Clicked', f.clicked)}${tile('Trials started', f.converted)}${tile('Unsubscribed', f.unsubscribed)}</div>
    <div class="grid-2 mt">
      <div class="card"><h2>Setup</h2><ul class="mkt-check">
        ${check(r.keys.gemini, 'Free AI model key (GEMINI_API_KEY) — finds websites and checks fit')}
        ${check(r.keys.openai, 'OpenAI key (OPENAI_API_KEY) — contact details when unclear (low-cost model)')}
        ${check(r.keys.sendgrid, 'SendGrid key (SENDGRID_API_KEY) — sends the emails')}
        ${check(r.keys.webhook, 'SendGrid event webhook secret (MKT_WEBHOOK_SECRET) — bounces, spam reports and unsubscribes')}
        ${check(!!s.from_email, 'From address (on a domain verified in SendGrid)')}${check(!!s.postal_address, 'Postal mailing address (required in every email)')}${check(!!s.video_url, 'YouTube link to the sales video')}
        ${check(s.discover, 'Prospecting switched on')}${check(s.enabled, 'Sending switched on')}</ul>
        <p class="small muted mt-sm">SendGrid → Settings → Mail Settings → Event Webhook: post <em>Bounced, Dropped, Spam reports, Unsubscribes</em> to<br><span class="mono">${esc(r.webhookUrl)}</span></p>
        <p class="small muted">Today's AI use: Gemini ${r.ai.gemini?.calls || 0} / ${s.gemini_daily} calls · OpenAI ${r.ai.openai?.calls || 0} / ${s.openai_daily} calls (${r.ai.openai?.tokens || 0} tokens). Discovery: ${r.discovery.done} of ${r.discovery.segments} ZIP segments searched.</p></div>
      <div class="card"><h2>Emails</h2><p class="small">A 3-email sequence: the introduction with the video, a short follow-up after ${esc(s.follow_up_days[0] ?? 4)} business days, and a last note after ${esc(s.follow_up_days[1] ?? 10)}. It stops when someone unsubscribes, bounces, starts a trial, or you mark a reply.</p>
        <div class="badge-row mt-sm">${[1, 2, 3].map((n) => `<a class="btn ghost sm" href="api/platform.php?action=mkt_preview&step=${n}" target="_blank" rel="noopener">Preview email ${n}</a>`).join('')}</div>
        <div class="form-grid mt"><div><label for="mkt-test-to">Send a test to</label><input id="mkt-test-to" type="email" value="${esc(S.user.email)}"></div><div><label for="mkt-test-step">Email</label><select id="mkt-test-step">${opt(1, 'Introduction')}${opt(2, 'Follow-up')}${opt(3, 'Last note')}</select></div></div>
        <button class="btn ghost sm mt-sm" data-act="mkt-test">Send test</button>
        <p class="small muted mt">Last 14 days: ${r.days.map((d) => `${esc(fmtDate(d.d))} ${+d.sent}`).join(' · ') || 'nothing sent yet'}</p></div></div>
    <div class="card mt" id="mkt-settings"><h2>Settings</h2>
      <div class="badge-row">${chk('ms-discover', s.discover, 'Prospecting on (find & research practices)')}${chk('ms-enabled', s.enabled, 'Sending on (no approval needed)')}${chk('ms-weekdays', s.weekdays_only, 'Weekdays only')}</div>
      <h3 class="mt">Who to look for</h3><div class="assignee-list">${entries(r.specialties).map(([k, l]) => `<label class="check"><input type="checkbox" data-ms-sp="${k}"${s.specialties.includes(k) ? ' checked' : ''}> ${esc(l)}</label>`).join('')}</div>
      <div class="form-grid mt">${txt('ms-states', 'States (comma-separated, blank = all)', s.states.join(', '), 'e.g. FL, GA, TX')}
        ${num('ms-ws', 'Send window starts (hour, their time)', s.window_start, 'min="0" max="23"')}${num('ms-we', 'Send window ends (hour)', s.window_end, 'min="1" max="24"')}
        ${num('ms-cap', 'Daily send cap', s.daily_cap, 'min="1"')}${num('ms-wu', 'Warm-up: first day', s.warmup_start, 'min="1"')}${num('ms-ws2', 'Warm-up: add per day', s.warmup_step, 'min="0"')}
        ${txt('ms-fu', 'Follow-ups (business days after the first email)', s.follow_up_days.join(', '), '4, 10')}
        ${txt('ms-fromname', 'From name', s.from_name)}${txt('ms-from', 'From address', s.from_email, 'hello@getinjurycase.com')}${txt('ms-reply', 'Replies go to', s.reply_to, 'you@injurycase.com')}
        <div class="full"><label for="ms-postal">Postal mailing address (shown in every email)</label><input id="ms-postal" value="${esc(s.postal_address)}" placeholder="123 Main St, Suite 100, Tampa, FL 33602"></div>
        ${txt('ms-video', 'YouTube video link', s.video_url, 'https://youtu.be/…')}${txt('ms-promo', 'Promo code on the trial link (optional)', s.promo)}
        ${txt('ms-gm', 'Free model (Gemini)', s.gemini_model)}${txt('ms-om', 'Low-cost model (OpenAI)', s.openai_model)}
        ${num('ms-gd', 'Gemini calls per day', s.gemini_daily, 'min="0"')}${num('ms-od', 'OpenAI calls per day', s.openai_daily, 'min="0"')}${num('ms-dd', 'New prospects per day', s.discover_daily, 'min="0"')}</div>
      <button class="btn mt" data-act="mkt-save">Save settings</button></div>
    <div class="card mt"><div class="card-head"><h2>Prospects</h2><span class="spacer"></span><button class="btn ghost sm" data-act="mkt-suppress">Do-not-email list (${r.suppressions})</button></div>
      <div class="filters"><input type="search" id="mkt-q" placeholder="Search name, email, city" value="${esc(mktState.q)}">
        <select id="mkt-status">${opt('', 'Any status', mktState.status)}${entries(MKT_STATUS).map(([k, l]) => opt(k, `${l} (${st[k] || 0})`, mktState.status)).join('')}</select>
        <select id="mkt-sp">${opt('', 'Any specialty', mktState.specialty)}${entries(r.specialties).map(([k, l]) => opt(k, l, mktState.specialty)).join('')}</select></div>
      <div id="mkt-list" class="mt-sm"><div class="empty">Loading…</div></div></div>`;
  const reload = () => { mktState.page = 0; loadMktProspects(); };
  main.querySelector('#mkt-q').addEventListener('change', (e) => { mktState.q = e.target.value; reload(); });
  main.querySelector('#mkt-status').addEventListener('change', (e) => { mktState.status = e.target.value; reload(); });
  main.querySelector('#mkt-sp').addEventListener('change', (e) => { mktState.specialty = e.target.value; reload(); });
  loadMktProspects();
}

async function loadMktProspects() {
  const qs = new URLSearchParams({ status: mktState.status, specialty: mktState.specialty, q: mktState.q, page: mktState.page });
  const r = await attempt(() => api('platform.php?action=mkt_prospects&' + qs));
  const box = document.getElementById('mkt-list');
  if (!r || !box) return;
  box.innerHTML = r.prospects.length ? `<div class="table-wrap"><table><thead><tr><th>Practice</th><th>Contact</th><th>Where</th><th>Status</th><th class="num">Fit</th><th>Emails</th><th>Next</th></tr></thead><tbody>
    ${r.prospects.map((p) => `<tr><td><button class="linklike" data-act="mkt-open" data-id="${p.id}">${esc(p.name)}</button><div class="small muted">${esc(pageMarketing.data.specialties[p.specialty] || p.specialty)}</div></td>
      <td class="small">${esc(p.contact_name || '')}${p.email ? `<div class="mono">${esc(p.email)}</div>` : ''}</td><td class="small">${esc([p.city, p.state].filter(Boolean).join(', '))}</td>
      <td><span class="chip ${p.status === 'converted' ? 'teal' : ['unsubscribed', 'bounced', 'error'].includes(p.status) ? 'red' : ['ready', 'in_sequence'].includes(p.status) ? 'ochre' : 'na'}">${esc(MKT_STATUS[p.status] || p.status)}</span>${p.clicked_at ? ' <span class="chip teal">clicked</span>' : ''}</td>
      <td class="num">${p.fit_score ?? '—'}</td><td class="num">${p.step}</td><td class="small">${p.next_send_at ? esc(fmtDate(p.next_send_at)) : '—'}</td></tr>`).join('')}</tbody></table></div>
    <div class="badge-row mt-sm">${mktState.page ? '<button class="btn ghost sm" data-act="mkt-page" data-d="-1">← Newer</button>' : ''}${r.more ? '<button class="btn ghost sm" data-act="mkt-page" data-d="1">Older →</button>' : ''}</div>`
    : '<div class="empty">No prospects here yet. They appear as prospecting runs (nightly discovery, research every 10 minutes).</div>';
}

async function mktOpen(id) {
  const r = await attempt(() => api('platform.php?action=mkt_prospect&id=' + id));
  if (!r) return;
  const p = r.prospect;
  const row = (k, v) => v ? `<dt>${esc(k)}</dt><dd>${v}</dd>` : '';
  const m = openModal({ title: p.name, wide: true, okText: 'Close', body: `<dl class="kv">
      ${row('Status', esc(MKT_STATUS[p.status] || p.status) + (p.error ? ` <span class="small err">${esc(p.error)}</span>` : ''))}${row('Specialty', esc(pageMarketing.data.specialties[p.specialty] || p.specialty))}
      ${row('Contact', esc([p.contact_name, p.contact_role].filter(Boolean).join(' — ')))}${row('Email', p.email ? `<span class="mono">${esc(p.email)}</span> <span class="small muted">(${esc(p.email_source || '')})</span>` : '')}
      ${row('Website', p.website ? `<a href="${esc(p.website)}" target="_blank" rel="noopener noreferrer">${esc(p.website)}</a>` : '')}${row('Phone', esc(p.phone))}${row('Address', esc([p.address, p.city, p.state, p.zip].filter(Boolean).join(', ')))}
      ${row('Fit', p.fit_score !== null ? esc(p.fit_score) + (p.fit_evidence ? `<div class="small muted">“${esc(p.fit_evidence)}”</div>` : '') : '')}${row('NPI', esc(p.npi))}${row('Next email', p.next_send_at ? esc(fmtDate(p.next_send_at)) : '')}</dl>
    <h3 class="mt">Emails</h3>${r.sends.length ? `<ul class="small">${r.sends.map((x) => `<li>${esc(fmtDate(x.sent_at))} · #${x.step} “${esc(x.subject)}” ${x.ok == 1 ? '✓' : '<span class="err">failed: ' + esc(x.error || '') + '</span>'}</li>`).join('')}</ul>` : '<p class="small muted">None sent yet.</p>'}
    ${r.events.length ? `<h3 class="mt">Activity</h3><ul class="small">${r.events.map((e) => `<li>${esc(fmtDate(e.at))} · ${esc(e.kind)}${e.detail ? ' — ' + esc(e.detail) : ''}</li>`).join('')}</ul>` : ''}
    <div class="badge-row mt">${['ready', 'in_sequence'].includes(p.status) ? '<button class="btn ghost sm" data-mkt-do="pause">Pause</button>' : ''}${['paused', 'error'].includes(p.status) && p.email ? '<button class="btn ghost sm" data-mkt-do="resume">Resume</button>' : ''}
      ${['in_sequence', 'ready'].includes(p.status) ? '<button class="btn ghost sm" data-mkt-do="replied">They replied — stop emails</button>' : ''}${!['unsubscribed', 'converted'].includes(p.status) ? '<button class="btn ghost sm" data-mkt-do="unsubscribe">Unsubscribe</button>' : ''}
      ${['not_fit', 'no_email', 'error'].includes(p.status) ? '<button class="btn ghost sm" data-mkt-do="research">Research again</button>' : ''}<a class="btn ghost sm" href="api/platform.php?action=mkt_preview&id=${p.id}&step=${Math.min(3, (p.step || 0) + 1)}" target="_blank" rel="noopener">Preview their next email</a></div>` });
  m.el.querySelectorAll('[data-mkt-do]').forEach((b) => b.addEventListener('click', async () => {
    if (await attempt(() => api('platform.php?action=mkt_action', { id: p.id, do: b.dataset.mktDo }))) { m.close(); toast('Done'); loadMktProspects(); }
  }));
}

async function mktSuppressModal() {
  const r = await attempt(() => api('platform.php?action=mkt_suppress'));
  if (!r) return;
  openModal({ title: 'Do-not-email list', okText: 'Add', body: `<p class="small">Unsubscribes, bounces and spam reports are added automatically and can't be removed. Add an address, or a whole domain like <span class="mono">@bigclinic.com</span>, to never email it.</p>
      <div class="form-grid mt"><div class="full"><label for="sup-e">Email or @domain</label><input id="sup-e"></div></div>
      <div class="table-wrap mt"><table class="small"><thead><tr><th>Address</th><th>Why</th><th>Added</th></tr></thead><tbody>${r.suppressions.map((x) => `<tr><td class="mono">${esc(x.email)}</td><td>${esc(x.reason)}</td><td>${esc(fmtDate(x.created_at))}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Empty.</td></tr>'}</tbody></table></div>`,
    onOk: async (el) => { await api('platform.php?action=mkt_suppress', { email: el.querySelector('#sup-e').value }); toast('Added'); pageMarketing(document.getElementById('main')); } });
}

function mktAddModal() {
  const defs = [{ n: 'name', l: 'Practice', req: true }, { n: 'email', l: 'Email', t: 'email', req: true }, { n: 'contact_name', l: 'Contact name' },
    { n: 'specialty', l: 'Specialty', t: 'select', blank: false, opts: entries(pageMarketing.data.specialties) }, { n: 'city', l: 'City' }, { n: 'state', l: 'State (2 letters)' }, { n: 'website', l: 'Website' }];
  openModal({ title: 'Add a prospect', okText: 'Add to the queue', body: `<p class="small">They'll get the email sequence in the next send window (unless they've unsubscribed before).</p>${fieldsHtml(defs)}`,
    onOk: async (el) => { await api('platform.php?action=mkt_add', readFields(el, defs)); toast('Added to the queue'); pageMarketing(document.getElementById('main')); } });
}

function mktSettingsPayload() {
  const v = (id) => document.getElementById(id).value, c = (id) => document.getElementById(id).checked;
  return { discover: c('ms-discover'), enabled: c('ms-enabled'), weekdays_only: c('ms-weekdays'), specialties: [...document.querySelectorAll('[data-ms-sp]:checked')].map((x) => x.dataset.msSp),
    states: v('ms-states').split(/[\s,]+/).filter(Boolean), window_start: +v('ms-ws'), window_end: +v('ms-we'), daily_cap: +v('ms-cap'), warmup_start: +v('ms-wu'), warmup_step: +v('ms-ws2'),
    follow_up_days: v('ms-fu').split(/[\s,]+/).filter(Boolean).map(Number), from_name: v('ms-fromname'), from_email: v('ms-from'), reply_to: v('ms-reply'), postal_address: v('ms-postal'),
    video_url: v('ms-video'), promo: v('ms-promo'), gemini_model: v('ms-gm'), openai_model: v('ms-om'), gemini_daily: +v('ms-gd'), openai_daily: +v('ms-od'), discover_daily: +v('ms-dd') };
}

// ---------- promo codes (operator) ----------
async function promoSectionHtml() {
  const r = await attempt(() => api('platform.php?action=promos'));
  if (!r) return '';
  promoSectionHtml.meta = r;
  return `<div class="card mt"><div class="card-head"><h2>Promo codes</h2><span class="spacer"></span><button class="btn ghost sm" data-act="promo-new">+ New code</button></div>
    <p class="small muted">Entered at registration. Share a link that fills it in: <span class="mono">${esc(location.origin)}/app.html#signup?promo=CODE</span></p>
    ${r.promos.length ? `<div class="table-wrap"><table><thead><tr><th>Code</th><th>Gives</th><th>Plans</th><th class="num">Used</th><th>Ends</th><th>Status</th><th></th></tr></thead><tbody>
    ${r.promos.map((p) => `<tr${p.active == 1 ? '' : ' class="muted"'}><td><strong class="mono">${esc(p.code)}</strong>${p.description ? `<div class="small muted">${esc(p.description)}</div>` : ''}</td>
      <td>${esc(p.summary)}</td><td class="small">${p.plans ? esc(p.plans.split(',').map((k) => r.plans[k]?.name || k).join(', ')) : 'Any'}</td>
      <td class="num">${p.redeemed}${p.max_redemptions != null ? ' / ' + p.max_redemptions : ''}</td><td class="small">${p.expires_on ? esc(fmtDate(p.expires_on)) : '—'}</td>
      <td><span class="chip ${p.active == 1 ? 'teal' : 'na'}">${p.active == 1 ? 'Active' : 'Off'}</span></td>
      <td><button class="btn ghost sm" data-act="promo-toggle" data-id="${p.id}" data-on="${p.active == 1 ? 0 : 1}">${p.active == 1 ? 'Turn off' : 'Turn on'}</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No promo codes yet.</div>'}</div>`;
}

function promoModal() {
  const m = promoSectionHtml.meta;
  const defs = [{ n: 'code', l: 'Code (letters and numbers)', req: true, ph: 'e.g. FLCHIRO25' }, { n: 'description', l: 'Internal note', ph: 'e.g. FCA conference, Oct 2026' },
    { n: 'kind', l: 'What it gives', t: 'select', blank: false, opts: entries(m.kinds) },
    { n: 'trial_days', l: 'Extra trial days', t: 'number' }, { n: 'percent_off', l: 'Percent off', t: 'number' }, { n: 'amount_off', l: '$ off per month', t: 'money' },
    { n: 'duration', l: 'Discount lasts', t: 'select', blank: false, opts: entries(m.durations) }, { n: 'duration_months', l: 'Months (if for a number of months)', t: 'number' },
    { n: 'max_redemptions', l: 'Limit uses (blank = unlimited)', t: 'number' }, { n: 'expires_on', l: 'Ends on (blank = no end)', t: 'date' }];
  openModal({ title: 'New promo code', wide: true, okText: 'Create code',
    body: fieldsHtml(defs, { kind: 'trial_days', trial_days: 14, duration: 'once' }) + `<h3 class="mt">Plans (none ticked = any plan)</h3><div class="mt">${entries(m.plans).map(([k, p]) => `<label class="check"><input type="checkbox" data-promo-plan="${k}"> ${esc(p.name)}</label>`).join('')}</div>
      <p class="small muted mt">Fields that don't apply to the chosen kind are ignored. Discounts are applied in Stripe Checkout when the practice subscribes.</p>`,
    onOk: async (el) => { await api('platform.php?action=promo_save', { ...readFields(el, defs), plans: [...el.querySelectorAll('[data-promo-plan]:checked')].map((x) => x.dataset.promoPlan) }); toast('Promo code created'); pagePlatform(document.getElementById('main')); } });
}

// ---------- letters ----------
// Records-ready summary of the workup (no financials or internal notes).
function exportFileModal() {
  const c = S.caseData.case;
  const opts = [['visits', 'Visits (dates, visit type, provider, diagnosis codes)', true], ['referrals', 'Referrals, imaging & consultations', true],
    ['findings', 'Report findings / impressions', true], ['outcomes', 'Outcome assessment scores', true],
    ['missed', 'Missed appointments', false], ['correspondence', 'Correspondence log (non-billing)', false], ['outreach', 'Scheduling contact log', false]];
  openModal({ title: 'Export patient file', okText: 'Open summary', wide: true, body: `
    <p class="small">A printable summary of this case's workup to send when records are requested. <strong>Never included:</strong> charges, payments, balances, insurance or policy limits, internal notes, tasks, alerts, suggestions or checklist status.</p>
    <div class="form-grid mt"><div class="full"><label for="ex-for">Prepared for</label><input id="ex-for" placeholder="e.g. GEICO claims — records request dated 10/20"></div></div>
    <h3 class="mt">Include</h3>
    <div class="mt">${opts.map(([k, t, on]) => `<label class="check"><input type="checkbox" data-ex="${k}"${on ? ' checked' : ''}> ${esc(t)}</label>`).join('')}</div>
    <p class="small muted mt-sm">Optional sections are off by default. Clinical notes stay in your EHR and are sent from there.</p>
    <label class="check mt"><input type="checkbox" id="ex-log" checked> Log that records were sent (Correspondence) and mark the records request done</label>`,
    onOk: async (el) => {
      const inc = [...el.querySelectorAll('[data-ex]:checked')].map((x) => x.dataset.ex);
      const forWhom = el.querySelector('#ex-for').value.trim();
      const w = window.open('about:blank', '_blank');   // opened in the click, so it isn't blocked
      if (el.querySelector('#ex-log').checked) { S.caseData = await api('cases.php?action=export_log&id=' + c.id, { for: forWhom, records_request: true }); renderCase(); }
      const url = 'api/cases.php?action=export_file&id=' + c.id + '&inc=' + encodeURIComponent(inc.join(',')) + (forWhom ? '&for=' + encodeURIComponent(forWhom) : '');
      if (w) w.location = url; else location.href = url;
    } });
}

// White label (top plan): the practice's own name, color, logo and sign-in link.
function whiteLabelCard(p) {
  const w = p.whiteLabel, on = p.hasWhiteLabel;
  const base = w.signinBase;
  return `<div class="card mt" id="wl-card"><div class="card-head"><h2>White label — your own brand</h2>${w.active ? '<span class="chip ok">On</span>' : ''}</div>
    <p class="small">Run ${esc(S.brand.vendor || 'InjuryCase')} under your clinic's name: your logo and color in the app, a sign-in link of your own, and your name on the attorney reply page and on emails sent for your office. Contracts, billing, your BAA and the Certified badge stay under ${esc(S.brand.vendor || 'InjuryCase')}.</p>
    ${on ? '' : `<div class="notice mt">White label is part of the ${esc(featureInfo('white_label').planName)} plan.${w.name ? ' Your saved branding comes back when you upgrade.' : ''} <a href="#/billing">See plans</a></div>`}
    <fieldset class="assignees mt"${on ? '' : ' disabled'}><div class="form-grid">
      <div><label for="wl-name">Product name (shown to your team and attorneys)</label><input id="wl-name" maxlength="60" value="${esc(w.name || '')}" placeholder="e.g. Bayside Case Portal"></div>
      <div><label for="wl-color">Main color (buttons and links)</label><div class="badge-row wl-color-row"><input type="color" id="wl-color-pick" value="${esc(w.color || '#2B3FD6')}" aria-label="Pick a color"><input id="wl-color" maxlength="7" value="${esc(w.color || '')}" placeholder="#2B3FD6"></div></div>
      <div class="full"><label for="wl-slug">Your sign-in link</label><div class="badge-row wl-slug-row"><span class="small muted mono">${esc(base)}</span><input id="wl-slug" maxlength="40" value="${esc(w.slug || '')}" placeholder="bayside"></div>
        ${w.signinUrl ? `<p class="small mt-sm">Share with your team: <a href="${esc(w.signinUrl)}" target="_blank" rel="noopener" class="mono">${esc(w.signinUrl)}</a></p>` : ''}</div>
      <div class="full"><label for="wl-logo-file">Logo (PNG with a transparent background works best; JPG or WebP also fine, up to 2 MB)</label>
        <div class="badge-row"><input type="file" id="wl-logo-file" accept="image/png,image/jpeg,image/webp">${w.logo ? '<button class="btn ghost sm" data-act="wl-logo-remove">Remove logo</button>' : ''}</div></div>
    </div>
    <div class="wl-preview" id="wl-preview">${wlPreviewHtml(w)}</div>
    ${on ? '<button class="btn mt" data-act="save-white-label">Save</button>' : ''}</fieldset></div>`;
}
function wlPreviewHtml(w) {
  const logo = (dark) => w.logo ? `<span class="wl-logo${dark ? ' on-dark' : ''}"><img src="${esc(w.logo)}" alt=""></span>` : `<span class="wl-name">${esc(w.name || 'Your clinic')}</span>`;
  const c = /^#[0-9A-F]{6}$/i.test(w.color || '') ? w.color : '#2B3FD6';
  return `<div><div class="small muted">Sign-in page</div><div class="mt-sm">${logo(false)}</div><button type="button" class="btn mt-sm wl-btn" data-color="${esc(c)}" tabindex="-1">Sign in</button></div>
    <div class="dark"><div class="small muted-light">Sidebar</div><div class="mt-sm wl-dark-name">${logo(true)}</div></div>`;
}
function paintWlPreview() {
  const box = document.getElementById('wl-preview'); if (!box) return;
  box.querySelectorAll('.wl-btn').forEach((b) => { b.style.background = b.dataset.color; b.style.borderColor = b.dataset.color; });
}

// ----- Reduction terms: what's accepted within 30 days, and after -----
function reductionFieldsHtml(t) {
  return `<div class="form-grid mt-sm"><div><label for="rt-pct">Accept if paid within 30 days (% of patient balance)</label><input type="number" id="rt-pct" min="10" max="100" step="0.5" value="${t.pct}"></div>
    <div><label for="rt-late">Accept if paid after 30 days (%)</label><input type="number" id="rt-late" min="10" max="100" step="0.5" value="${t.late_pct}"><div class="small muted">Suggested: the 30-day amount plus 5%.</div></div></div>`;
}
document.addEventListener('input', (e) => {
  if (e.target.id !== 'rt-pct') return;
  const late = e.target.closest('.modal, .card')?.querySelector('#rt-late');
  if (late) late.value = Math.min(100, Math.round(+e.target.value * 1.05 * 10) / 10);
});
// First reduction letter: ask the practice for both amounts.
function reductionTermsModal(then) {
  const t = S.caseData.reductionTerms;
  if (!can('users.manage')) return then();
  openModal({ title: 'Your reduction terms', okText: 'Save and open letter',
    body: `<p class="small">The letter states what your office accepts if the attorney pays within 30 days of settlement — and a second, higher amount if payment comes later. These are saved for every case (change them under Practice settings).</p>${reductionFieldsHtml(t)}`,
    onOk: async (el) => {
      const pct = +el.querySelector('#rt-pct').value, late = +el.querySelector('#rt-late').value;
      await api('admin.php?action=reduction_terms_save', { pct, late_pct: late });
      S.caseData.reductionTerms = { asked: true, pct, late_pct: late };
      then();
    } });
}

// ---------- auto / PIP insurance EOBs ----------
// Scans of insurer EOBs (one or a whole day's batch) are read on the
// server; here each EOB is reviewed and corrected, matched to its case and
// saved — posting the payment, the fee-schedule reduction and the PIP 20% to
// the patient — and the practice's payers and fee schedule are analysed.
const EOB_STATUS = { paid: ['Paid', 'teal'], reduced: ['Paid · reduced', 'info'], denied: ['Not paid', 'red'], exhausted: ['Benefits exhausted', 'red'], pending: ['Payment not shown', 'ochre'] };
const eobChip = (s) => { const [t, c] = EOB_STATUS[s] || [s, '']; return `<span class="chip ${c}">${esc(t)}</span>`; };
const EOB_NOTE_ICON = { denied: '✕', full_charge: '$', below_usual: '↓', exhausted: '!' };
const eobChecksHtml = (checks) => (checks || []).length ? `<ul class="eob-checks">${checks.map((c) => `<li class="${c.ok ? 'ok' : 'bad'}"><b>${c.ok ? '✓' : '!'}</b> ${esc(c.label)} <span class="muted">— ${esc(c.detail)}</span></li>`).join('')}</ul>` : '';
const eobNotesHtml = (lines) => {
  const n = []; (lines || []).forEach((l) => (l.notes || []).forEach((x) => n.push(`<li class="eob-note ${esc(x.kind)}"><b>${EOB_NOTE_ICON[x.kind] || 'i'}</b> <span class="mono">${esc(l.code)}</span> ${esc(x.text)}</li>`)));
  return n.length ? `<ul class="eob-notes">${[...new Set(n)].join('')}</ul>` : '';
};
const num = (v) => (v === '' || v === null || v === undefined || isNaN(+v)) ? null : Math.round(+v * 100) / 100;

// "LANTERN, RHEA" / "RHEA F LANTERN" → ['Rhea', 'Lantern'].
function eobPatientName(n) {
  const cap = (w) => w.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
  n = String(n || '').trim();
  if (n.includes(',')) { const [last, rest] = n.split(',', 2); return [cap(rest.trim().split(/\s+/)[0] || ''), cap(last.trim())]; }
  const w = n.split(/\s+/).filter(Boolean);
  return w.length > 1 ? [cap(w[0]), cap(w.at(-1))] : [cap(w[0] || ''), ''];
}

// A new patient and auto case from an EOB that matches no case: name, date
// of loss, the insurer and claim number as PIP coverage. Returns the case id.
async function newCaseFromEob(e) {
  const [first, last] = eobPatientName(e.header.patient);
  const defs = [{ n: 'first_name', l: 'First name', req: true }, { n: 'last_name', l: 'Last name' }, { n: 'date_of_injury', l: 'Date of loss', t: 'date' }, { n: 'claim', l: 'Claim number' }, { n: 'carrier', l: 'Insurer' }];
  return new Promise((resolve) => {
    let done = false;
    const m = openModal({ title: 'New patient from this EOB', okText: 'Create', body: `<p class="small">Creates the patient and an auto case with ${esc(e.header.payer || 'the insurer')} as PIP coverage.</p>` + fieldsHtml(defs, { first_name: first, last_name: last, date_of_injury: e.header.dateOfLoss || '', claim: e.header.claim || '', carrier: e.header.payer || '' }),
      onOk: async (el) => {
        const v = readFields(el, defs);
        if (!v.first_name) throw new Error("Enter the patient's first name.");
        const r = await api('cases.php?action=create', { patient: { first_name: v.first_name, last_name: v.last_name || '' }, case: { injury_type: 'auto', date_of_injury: v.date_of_injury || null, stage: 'treating' },
          coverage: { type: 'pip', carrier_text: v.carrier || null, claim_number: v.claim || null } });
        done = true; toast('Patient created'); resolve(r.id);
      } });
    m.el.parentElement.addEventListener('click', (ev) => { if (!done && (ev.target.closest('[data-close]') || ev.target === m.el.parentElement)) resolve(null); });
  });
}

// The genie at work while a scan is read: it rises from its lamp, EOB pages
// swirl in and come out checked, a sparkle rides the progress bar, and the
// status line has a little fun. The server reads the whole scan in one
// request, so progress is an estimate from the file size (scans run about
// 250 KB and 1.5 seconds a page); it eases toward 92% and finishes when the
// answer arrives, with a "ta-da".
const GENIE_STEPS = [
  [0, 'Rubbing the lamp…'], [6, 'Poof! The genie is up and stretching.'], [14, 'Unrolling your EOBs…'],
  [26, 'Reading every line — no squinting required.'], [42, 'Matching each EOB to its patient…'],
  [56, 'Checking the PIP math (80%, every time)…'], [70, 'Hunting for money left on the table…'],
  [82, 'Polishing the numbers until they sparkle…'], [92, 'Almost there — one last wiggle of the fingers…'],
];
const GENIE_LAMP = `<svg class="gp-lamp" viewBox="0 0 160 70" aria-hidden="true"><defs><linearGradient id="gp-gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFE7A3"/><stop offset=".55" stop-color="#F2B640"/><stop offset="1" stop-color="#C98516"/></linearGradient></defs>
  <path d="M8 34c14 2 24 6 34 12" stroke="#C98516" stroke-width="7" stroke-linecap="round" fill="none"/>
  <path d="M30 40c0-12 22-20 50-20s48 8 48 18c0 12-20 20-48 20S30 52 30 40Z" fill="url(#gp-gold)"/>
  <path d="M126 32c14-8 28 2 22 14-4 8-14 8-22 4" stroke="#C98516" stroke-width="6" fill="none" stroke-linecap="round"/>
  <ellipse cx="80" cy="21" rx="18" ry="5" fill="#FFE7A3"/><circle cx="80" cy="14" r="5" fill="#F2B640"/>
  <path d="M58 66h44l-6-8H64Z" fill="#C98516"/><path d="M48 38c10 4 54 4 64 0" stroke="#FFF6D6" stroke-width="3" fill="none" opacity=".7" stroke-linecap="round"/></svg>`;
// Extra lines for a big batch that's taking its time.
const GENIE_WAIT = ['Big batch! The genie is reading as fast as genie-ly possible…', 'Still reading — every number gets checked twice.',
  'Sorting the checks from the EOBs…', 'Skipping the health-insurance pages (auto / PIP only)…', 'Nearly there — the genie never rushes the math.'];

// Pages in a PDF, counted from its page objects (scanner PDFs list them
// plainly); falls back to the file size (about 250 KB a scanned page).
async function pdfPageCount(file) {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let txt = ''; for (let i = 0; i < bytes.length; i += 65536) txt += String.fromCharCode.apply(null, bytes.subarray(i, i + 65536));
    const n = (txt.match(/\/Type\s*\/Page(?![a-zA-Z])/g) || []).length;
    if (n > 0) return n;
  } catch { /* fall through to the size estimate */ }
  return Math.max(1, Math.round((file?.size || 250000) / 250000));
}

function genieProgress(host, file, label = '') {
  let pages = Math.max(1, Math.min(60, Math.round((file?.size || 250000) / 250000)));
  let eta = Math.max(4, pages * 1.5);
  host.innerHTML = `<div class="gp" role="status" aria-live="polite">
    <div class="gp-stage" aria-hidden="true">
      <div class="gp-docs"><i class="gp-doc"></i><i class="gp-doc"></i><i class="gp-doc"></i></div>
      <div class="gp-smoke"><i></i><i></i><i></i><i></i></div>
      <img class="gp-genie" src="assets/genie/icon.png" alt="">
      ${GENIE_LAMP}
      <span class="gp-spark"></span><span class="gp-spark"></span><span class="gp-spark"></span><span class="gp-spark"></span><span class="gp-spark"></span>
      <div class="gp-burst">${'<i></i>'.repeat(10)}</div>
    </div>
    <p class="gp-msg">${GENIE_STEPS[0][1]}</p>
    <div class="gp-bar"><i><b class="gp-bar-spark"></b></i></div>
    <p class="gp-sub">Reading about ${pages} page${pages === 1 ? '' : 's'}…</p>${label ? `<p class="gp-sub">${esc(label)}</p>` : ''}</div>`;
  const root = host.querySelector('.gp'), bar = root.querySelector('.gp-bar > i'), msg = root.querySelector('.gp-msg');
  const t0 = performance.now(); let pct = 0, stopped = false, step = 0;
  const subText = () => `Reading ${pages} page${pages === 1 ? '' : 's'} · usually under ${Math.ceil(eta / 5) * 5} seconds`;
  if (file) pdfPageCount(file).then((n) => { pages = Math.min(60, n); eta = Math.max(4, pages * 1.5); if (!stopped) root.querySelector('.gp-sub').textContent = subText(); });
  const setMsg = (t) => { if (msg.textContent === t) return; msg.classList.remove('gp-in'); void msg.offsetWidth; msg.textContent = t; msg.classList.add('gp-in'); };
  const tick = () => {
    if (stopped) return;
    const t = (performance.now() - t0) / 1000;
    // Fast at first, slowing near the end; past the estimate it keeps creeping toward 97%.
    pct = t <= eta ? 92 * (1 - Math.exp(-2.2 * t / eta)) / (1 - Math.exp(-2.2)) * 0.98 : Math.min(97, 90.2 + 6.8 * (1 - Math.exp(-(t - eta) / (eta * 1.5))));
    pct = Math.min(97, pct);
    bar.style.width = pct.toFixed(1) + '%';
    while (step + 1 < GENIE_STEPS.length && pct >= GENIE_STEPS[step + 1][0]) step++;
    setMsg(t > eta * 1.15 ? GENIE_WAIT[Math.floor((t - eta * 1.15) / 3.2) % GENIE_WAIT.length] : GENIE_STEPS[step][1]);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return {
    stop() { stopped = true; },
    async done(n, checks = 0) {
      stopped = true;
      bar.style.width = '100%';
      root.classList.add('gp-done');
      const what = [n ? `${n} EOB${n === 1 ? '' : 's'}` : '', checks ? `${checks} check${checks === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ');
      setMsg(what ? `Ta-da! ${what} ready for you to check.` : 'All done — no auto / PIP EOBs in this one.');
      root.querySelector('.gp-sub').textContent = '';
      const quiet = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      await new Promise((r) => setTimeout(r, quiet ? 400 : 1400));
    },
  };
}

function eobUploadModal(caseId = null, opts = {}) {
  caseId = typeof caseId === 'number' ? caseId : null;
  let res = null, history = !!opts.history;
  const m = openModal({ title: history ? 'Bring in past EOBs' : 'Upload insurance EOBs', wide: true, okText: 'Read EOBs', body: '<div id="eob-step"></div>', onOk: async (el) => {
    if (!res) {
      const files = [...el.querySelector('#eob-file').files];
      if (!files.length) throw new Error('Choose the scanned EOB PDF first.');
      history = !!el.querySelector('#eob-history')?.checked;
      // Each file is read in its own request; the results are reviewed and saved together.
      const all = { eobs: [], payments: [], skipped: [], failed: [], pageCount: 0, tokens: [], ocr: null, layouts: {}, files: files.length };
      for (const [n, file] of files.entries()) {
        const fd = new FormData(); if (caseId) fd.append('case_id', caseId); fd.append('file', file);
        const show = genieProgress(host, file, files.length > 1 ? `File ${n + 1} of ${files.length}` : '');
        let r = null;
        try { r = await api('eob.php?action=upload', fd); } catch (err) {
          show.stop();
          if (files.length === 1) { showFile(); throw err; }
          all.failed.push({ file: file.name, error: err.message }); continue;
        }
        const tag = files.length > 1 ? file.name : null;
        r.eobs.forEach((x) => { x.file = tag; }); (r.payments || []).forEach((x) => { x.file = tag; });
        all.eobs.push(...r.eobs); all.payments.push(...(r.payments || []));
        all.skipped.push(...r.skipped.map((x) => ({ ...x, file: tag })));
        all.pageCount += r.pageCount; all.tokens.push(r.token); all.ocr = r.ocr; all.layouts = r.layouts;
        if (n < files.length - 1) show.stop(); else await show.done(all.eobs.length, all.payments.length);
      }
      res = all;
      if (!res.tokens.length) { showFile(); throw new Error(res.failed.map((f) => `${f.file}: ${f.error}`).join(' · ')); }
      renderReview(); okBtn.textContent = 'Save'; return false;
    }
    readAll();
    const items = res.eobs.map((e) => ({ include: e.include, caseId: e.case?.caseId || null, coverageId: e.coverageId || null, header: e.header, lines: e.lines, totals: e.totals,
      pages: e.pages, layout: e.layout, reasons: e.reasons, exhausted: e.status === 'exhausted', post: e.post }));
    const pays = (res.payments || []).map((p) => ({ include: p.include, caseId: p.case?.caseId || null, coverageId: p.coverageId || null, post: p.post,
      header: { payer: p.payer, claim: p.claim, checkNumber: p.checkNumber, checkDate: p.date, amount: p.amount, interest: p.interest, fees: p.fees, via: p.via, viaRef: p.viaRef, recovery: p.recovery } }));
    const missing = items.find((x) => x.include && !x.caseId) || pays.find((x) => x.include && !x.caseId);
    if (missing) throw new Error('Choose the case for every EOB and check you are saving (or untick it).');
    if (!items.some((x) => x.include) && !pays.some((x) => x.include)) throw new Error('Tick at least one EOB or check to save.');
    const r = await api('eob.php?action=apply', { tokens: res.tokens, history, eobs: items, payments: pays });
    const posted = r.saved.filter((s) => s.posted).length, nPay = r.saved.filter((s) => s.kind === 'payment').length, nEob = r.saved.length - nPay;
    toast(`${history ? 'Past ' : ''}${[nEob ? nEob + ' EOB' + (nEob === 1 ? '' : 's') : '', nPay ? nPay + ' check' + (nPay === 1 ? '' : 's') : ''].filter(Boolean).join(' and ')} saved${posted ? ' — ' + posted + ' posted to the ledger' : (history ? ' for the EOB Genie report' : '')}`);
    r.saved.filter((s) => s.posted?.unapplied).forEach((s) => toast(`${s.caseNumber}: ${money(s.posted.unapplied)} was more than the open balance — it's on the ledger unapplied; check it.`));
    r.saved.filter((s) => s.notPostedWhy).forEach((s) => toast(s.caseNumber + ': ' + s.notPostedWhy));
    await offerLop(r.lopSuggested);
    if (S.caseData && caseId) await reloadCase(); else route();
  } });
  const host = m.el.querySelector('#eob-step');
  const okBtn = m.el.querySelector('[data-ok]');
  function showFile() {
    host.innerHTML = `${genieHead()}<p class="small">Scan the auto insurers' EOBs — one, or the whole day's mail in one PDF — and upload the scan. Each EOB is read, matched to its patient's case, and shown here to check before anything is saved.</p>
      <ul class="small muted mt"><li>Auto / PIP payers only: GEICO, Progressive, State Farm, USAA, Allstate, Travelers, MetLife / Farmers, AAA and others. Health-insurance and Medicare paperwork in the batch is skipped.</li>
        <li>Checks and payment advices in the scan are matched to their EOB. A check with no EOB — like a PIP demand or suit payment your attorney forwards with a cover letter — is read too and applied to the case's open balance.</li><li>Scan at 300 dpi, black and white or greyscale, for the best reading.</li>
        <li>The scan is only read — it isn't kept. Only the numbers you confirm are saved; keep the paper or scan in your EHR.</li></ul>
      <label class="mt" for="eob-file">Scanned EOBs (PDF — choose several files at once if you like)</label><input type="file" id="eob-file" accept="application/pdf,.pdf" multiple>
      <label class="check mt-sm"><input type="checkbox" id="eob-history"${history ? ' checked' : ''}> <span><strong>These are past EOBs</strong> <span class="small muted">— already in our books. Save them for the EOB Genie report without posting to the ledger or changing any coverage. (You can still tick "Post" on any one.)</span></span></label>`;
  }
  showFile();

  function caseOptions(e) {
    const seen = new Set(); const o = [];
    if (e.case) { o.push(opt(e.case.caseId, `${e.case.caseNumber}${(e.matches || []).find((x) => x.caseId === e.case.caseId) ? ' — ' + e.matches.find((x) => x.caseId === e.case.caseId).patient : ''}`, e.case.caseId)); seen.add(e.case.caseId); }
    (e.matches || []).forEach((x) => { if (!seen.has(x.caseId)) { o.push(opt(x.caseId, `${x.caseNumber} — ${x.patient} (${x.why})`, e.case?.caseId)); seen.add(x.caseId); } });
    if (caseId && !seen.has(caseId)) o.push(opt(caseId, S.caseData?.case?.case_number || 'This case', e.case?.caseId));
    return `<option value="">Choose the case…</option>${o.join('')}${can('case.write') ? '<option value="new">+ New patient from this EOB</option>' : ''}`;
  }
  const field = (i, f, l, v, type = 'text') => `<div><label for="eob-${i}-${f}">${esc(l)}</label><input id="eob-${i}-${f}" type="${type}" data-h="${f}" value="${esc(v ?? '')}"${type === 'number' ? ' step="0.01"' : ''}></div>`;
  function sectionHtml(e, i) {
    const h = e.header, t = e.totals, c = e.case;
    if (e.include === undefined) e.include = !!c || !!(e.matches || []).length || !!caseId;
    if (e.post === undefined) e.post = !history && !!c && !c.ehr && !c.duplicateOf;
    const cov = c ? c.coverages : [];
    e.coverageId = e.coverageId ?? c?.coverageId ?? null;
    return `<section class="eob-rev${e.include ? '' : ' off'}" data-i="${i}">
      <div class="eob-rev-head"><label class="check"><input type="checkbox" data-e="include"${e.include ? ' checked' : ''}> <strong>${esc(h.payer || 'Auto insurer')}</strong></label> ${eobChip(e.status)}
        <span class="spacer"></span><span class="small muted">${e.file ? esc(e.file) + ' · ' : ''}Page${e.pages.length === 1 ? '' : 's'} ${esc(e.pages.join(', '))} · ${esc(res.layouts[e.layout] || e.layout)}${e.confident ? ' · <b class="ok-ink">all checks pass</b>' : ''}</span></div>
      ${e.wrongCase ? `<div class="notice">This EOB names <strong>${esc(e.wrongCase.patient)}</strong> (${esc(e.wrongCase.why)}) — not the case you uploaded it on. Check the case below.</div>` : ''}
      <div class="form-grid">
        <div><label for="eob-${i}-case">Case${h.patient ? ` <span class="muted">— EOB says ${esc(h.patient)}</span>` : ''}</label><select id="eob-${i}-case" data-e="case">${caseOptions(e)}</select></div>
        <div><label for="eob-${i}-cov">Coverage</label><select id="eob-${i}-cov" data-e="coverage"${c ? '' : ' disabled'}>${cov.length ? cov.map((v) => opt(v.id, `${(S.lookups.coverageTypes || {})[v.type] || v.type.toUpperCase()} — ${v.carrier || 'carrier'}${v.status !== 'active' ? ' (' + v.status + ')' : ''}`, e.coverageId)).join('') : '<option value="">No insurance on the case</option>'}</select></div>
        ${field(i, 'payer', 'Payer', h.payer)}${field(i, 'claim', 'Claim number', h.claim)}${field(i, 'receivedOn', 'Bill received by insurer', h.receivedOn, 'date')}
        ${field(i, 'eobDate', 'EOB date', h.eobDate, 'date')}${field(i, 'checkNumber', 'Check number', h.checkNumber)}${field(i, 'checkDate', 'Check date', h.checkDate, 'date')}
      </div>
      <div class="table-wrap mt-sm"><table class="eob-lines"><thead><tr><th>Date of service</th><th>Code</th><th>Mod.</th><th class="num">Charged</th><th class="num">Allowed</th><th class="num">Paid</th><th>Reason codes</th><th></th></tr></thead><tbody>
        ${e.lines.map((l, j) => `<tr data-j="${j}"><td><input type="date" data-l="dos" value="${esc(l.dos || '')}" aria-label="Date of service"></td><td><input data-l="code" value="${esc(l.code)}" class="w-code" aria-label="Code"></td>
          <td><input data-l="modifiers" value="${esc(l.modifiers || '')}" class="w-mod" aria-label="Modifiers"></td><td><input type="number" step="0.01" data-l="charged" value="${l.charged ?? ''}" class="w-amt" aria-label="Charged"></td>
          <td><input type="number" step="0.01" data-l="allowed" value="${l.allowed ?? ''}" class="w-amt" aria-label="Allowed"></td><td><input type="number" step="0.01" data-l="paid" value="${l.paid ?? ''}" class="w-amt" aria-label="Paid" placeholder="—"></td>
          <td><input data-l="reasons" value="${esc(l.reasons || '')}" class="w-codes" aria-label="Reason codes"></td><td><button type="button" class="linklike" data-eob-del="${j}" aria-label="Remove line">✕</button></td></tr>`).join('')}
        </tbody></table></div>
      <button type="button" class="btn ghost sm mt-sm" data-eob-add>+ Add line</button>
      <div class="form-grid mt-sm eob-totals">${[['charged', 'Total charged'], ['allowed', 'Total allowed'], ['deductible', 'Deductible'], ['coinsurance', 'PIP 20% / copay'], ['interest', 'Interest paid'], ['paid', 'Paid (check)']].map(([k, l]) => `<div><label for="eob-${i}-t-${k}">${l}</label><input id="eob-${i}-t-${k}" type="number" step="0.01" data-t="${k}" value="${t[k] ?? ''}"${k === 'paid' && t.paid === null && e.estimatedPaid !== null ? ` placeholder="about ${e.estimatedPaid}"` : ''}></div>`).join('')}</div>
      ${t.paid === null && e.estimatedPaid !== null ? `<p class="small muted">This EOB doesn't print the payment (it's mailed separately). PIP pays 80% of the allowed amount — about ${money(e.estimatedPaid)}. Enter the check amount here if you have it; otherwise save now and post the payment on the case when the check comes.</p>` : ''}
      ${eobChecksHtml(e.checks)}${eobNotesHtml(e.lines)}
      ${e.status === 'exhausted' && history ? '<div class="notice">PIP benefits exhausted on this past EOB. The coverage and the case aren\'t changed — update them on the case if they\'re still open.</div>' : ''}
      ${e.status === 'exhausted' && !history ? '<div class="notice">PIP benefits exhausted. Saving marks the PIP coverage exhausted, and posting moves these charges to the patient balance. If the case has no other coverage, you\'ll be asked whether to switch it to a letter of protection.</div>' : ''}
      ${c?.duplicateOf ? `<div class="notice">An EOB from this payer for the same dates was already saved on ${esc(fmtDate(c.duplicateOf.on))}. Posting again would count the payment twice.</div>` : ''}
      ${t.interest ? `<p class="small muted">${money(t.interest)} of the check is interest: it's kept with the EOB and in the EOB Genie report, not posted against the visits.</p>` : ''}
      <label class="check mt-sm"><input type="checkbox" data-e="post"${e.post ? ' checked' : ''}${c?.ehr || !can('fin:ledger') ? ' disabled' : ''}> Post to the case ledger — ${cov.find((v) => v.id === e.coverageId)?.type === 'medpay' ? 'the MedPay payment (the patient balance it pays moves back to MedPay)' : 'the payment, the PIP fee-schedule reduction, and the deductible and 20% moved to the patient balance'}${c?.ehr ? ` <span class="muted">(this case's money comes from ${esc(c.ehr)} ledger uploads, so the EOB is saved for review only)</span>` : ''}</label>
    </section>`;
  }
  // A check with no EOB: a PIP demand or suit payment, usually forwarded by the attorney.
  function paySectionHtml(p, i) {
    const c = p.case;
    if (p.include === undefined) p.include = !!c || !!caseId;
    if (p.post === undefined) p.post = !history && !!c && !c.ehr;
    const cov = c ? c.coverages : [];
    p.coverageId = p.coverageId ?? c?.coverageId ?? null;
    const open = c ? Number((c.openByCoverage || {})[p.coverageId || 0] || 0) + (p.coverageId ? Number((c.openByCoverage || {})[0] || 0) : 0) : null;
    const benefits = Math.max(0, (p.amount || 0) - (p.interest || 0));
    const f = (k, l, v, type = 'text') => `<div><label for="pay-${i}-${k}">${esc(l)}</label><input id="pay-${i}-${k}" type="${type}" data-p="${k}" value="${esc(v ?? '')}"${type === 'number' ? ' step="0.01" min="0"' : ''}></div>`;
    const opts = caseOptions({ case: c, matches: p.matches }).replace('<option value="new">+ New patient from this EOB</option>', '');
    return `<section class="eob-rev eob-pay${p.include ? '' : ' off'}" data-pi="${i}">
      <div class="eob-rev-head"><label class="check"><input type="checkbox" data-e="include"${p.include ? ' checked' : ''}> <strong>${esc(p.payer || 'Auto insurer')} check</strong></label>
        ${p.recovery ? '<span class="chip legal">Demand / PIP suit</span>' : '<span class="chip">No EOB</span>'}${p.checkMissing ? ' <span class="chip ochre">Check not in this scan</span>' : ''}
        <span class="spacer"></span><span class="small muted">${p.file ? esc(p.file) + ' · ' : ''}Page${p.pages.length === 1 ? '' : 's'} ${esc(p.pages.join(', '))}${p.letterPages?.length ? ' · with the attorney\'s cover letter' : ''}</span></div>
      ${p.via ? `<p class="small">Came through <strong>${esc(p.via)}</strong>${p.viaRef ? ` — their file ${esc(p.viaRef)}` : ''}${p.fileStatus === 'closed' ? ' · <span class="chip teal">Attorney closing the file</span>' : p.fileStatus === 'open' ? ' · <span class="chip">Attorney still pursuing</span>' : ''}</p>` : ''}
      <div class="form-grid">
        <div><label for="pay-${i}-case">Case${p.patient ? ` <span class="muted">— says ${esc(p.patient)}</span>` : ''}</label><select id="pay-${i}-case" data-e="case">${opts}</select></div>
        <div><label for="pay-${i}-cov">Coverage</label><select id="pay-${i}-cov" data-e="coverage"${c ? '' : ' disabled'}>${cov.length ? cov.map((v) => opt(v.id, `${(S.lookups.coverageTypes || {})[v.type] || v.type.toUpperCase()} — ${v.carrier || 'carrier'}${v.status !== 'active' ? ' (' + v.status + ')' : ''}`, p.coverageId)).join('') : '<option value="">No insurance on the case</option>'}</select></div>
        ${f('payer', 'Payer', p.payer)}${f('claim', 'Claim number', p.claim)}${f('checkNumber', 'Check number', p.checkNumber)}${f('date', 'Check date', p.date, 'date')}
        ${f('amount', 'Check amount', p.amount, 'number')}${f('interest', 'Of which interest', p.interest, 'number')}${f('fees', 'Attorney fees paid separately', p.fees, 'number')}
        ${f('via', 'Attorney / law firm', p.via)}${f('viaRef', "Attorney's file number", p.viaRef)}
      </div>
      <label class="check mt-sm"><input type="checkbox" data-p="recovery"${p.recovery ? ' checked' : ''}> Recovered through a demand letter or PIP suit</label>
      ${p.interestIncluded && !p.interest ? '<p class="small muted">The check says it includes interest. If the letter or stub shows the split, enter the interest part — it\'s recorded, not applied to the visits.</p>' : ''}
      ${c && open !== null ? `<p class="small ${benefits > open + 0.005 ? '' : 'muted'}">Open with this coverage on the case: <strong>${money(open)}</strong>. ${benefits > open + 0.005 ? `The check pays ${money(benefits - open)} more: that goes to fee-schedule reductions taken on earlier EOBs, then any rest is posted unapplied for you to sort out.` : 'The check is applied to the oldest open visits first.'}</p>` : ''}
      <label class="check mt-sm"><input type="checkbox" data-e="post"${p.post ? ' checked' : ''}${c?.ehr || !can('fin:ledger') ? ' disabled' : ''}> Post to the case ledger — paid against the oldest open visits${p.interest ? '; the interest is recorded, not posted' : ''}${c?.ehr ? ` <span class="muted">(this case's money comes from ${esc(c.ehr)} ledger uploads, so it's saved for review only)</span>` : ''}</label>
    </section>`;
  }
  function readPaySection(sec) {
    const p = res.payments[+sec.dataset.pi];
    sec.querySelectorAll('[data-p]').forEach((x) => { const k = x.dataset.p; p[k] = x.type === 'checkbox' ? x.checked : (['amount', 'interest', 'fees'].includes(k) ? num(x.value) : (x.value.trim() || null)); });
    p.include = sec.querySelector('[data-e=include]').checked;
    const po = sec.querySelector('[data-e=post]'); p.post = po.checked && !po.disabled;
    const cv = sec.querySelector('[data-e=coverage]'); if (cv && cv.value) p.coverageId = +cv.value;
  }
  function renderReview() {
    const sk = res.skipped || [], pay = res.payments || [];
    const found = [res.eobs.length ? `${res.eobs.length} auto / PIP EOB${res.eobs.length === 1 ? '' : 's'}` : '', pay.length ? `${pay.length} check${pay.length === 1 ? '' : 's'} without an EOB` : ''].filter(Boolean).join(' and ');
    host.innerHTML = `${found ? `<p class="small">${found} found in ${res.pageCount} page${res.pageCount === 1 ? '' : 's'}. Check each against the paper${res.eobs.length ? ' — especially lines marked by a failed check' : ''} — then save.</p>` : '<div class="notice">No auto / PIP EOBs were found in this scan.</div>'}
      ${res.ocr ? '' : '<div class="notice">Read from the scanner\'s text layer (no OCR on this server) — check the numbers closely.</div>'}
      ${history ? '<div class="notice">Past EOBs: they\'re saved for the EOB Genie report and not posted to the ledger, and no coverage or case is changed. Tick "Post" on one only if its payment isn\'t in your books yet.</div>' : ''}
      ${(res.failed || []).length ? `<div class="notice">Couldn't read: ${res.failed.map((f) => `<strong>${esc(f.file)}</strong> (${esc(f.error)})`).join(', ')}</div>` : ''}
      ${missingBar()}
      ${res.eobs.map(sectionHtml).join('')}
      ${pay.map(paySectionHtml).join('')}
      ${sk.length ? `<details class="mt-sm small"><summary>${sk.length} page${sk.length === 1 ? '' : 's'} skipped</summary><ul>${sk.map((s) => `<li>${s.file ? esc(s.file) + ', p' : 'P'}age ${s.page}: ${esc(s.why)}</li>`).join('')}</ul></details>` : ''}`;
  }
  // EOBs and checks for patients who aren't set up yet (common with past EOBs).
  const unmatched = () => [...res.eobs.map((e, i) => ({ x: e, ref: 'e' + i, patient: e.header.patient, dateOfLoss: e.header.dateOfLoss, claim: e.header.claim, payer: e.header.payer })),
    ...(res.payments || []).map((p, i) => ({ x: p, ref: 'p' + i, patient: p.patient, dateOfLoss: p.dateOfLoss, claim: p.claim, payer: p.payer }))].filter((u) => !u.x.case && u.patient);
  function missingBar() {
    const u = unmatched();
    if (!u.length || !can('case.write')) return '';
    const people = new Set(u.map((x) => eobPatientName(x.patient).join(' ').toLowerCase() + '|' + (x.dateOfLoss || '')));
    return `<div class="card mt-sm eob-missing"><div class="card-head"><h3>${u.length} not matched to a case</h3></div><p class="small">${people.size} patient${people.size === 1 ? '' : 's'} named on them ${people.size === 1 ? "isn't" : "aren't"} set up yet. Create ${people.size === 1 ? 'the patient' : 'them'} — each with an auto case and the insurer as PIP coverage — and the EOBs are matched.</p>
      <div class="filters"><label for="eob-new-stage" class="small">New cases' stage</label><select id="eob-new-stage">${Object.entries(S.lookups.stages || { treating: 'Treating', tx_complete: 'Treatment complete', closed: 'Closed / paid' }).filter(([k]) => ['treating', 'tx_complete', 'settled', 'closed'].includes(k)).map(([k, v]) => opt(k, v, history ? 'closed' : 'treating')).join('')}</select>
      <button type="button" class="btn sm" data-eob-create-all>Create ${people.size} patient${people.size === 1 ? '' : 's'}</button></div></div>`;
  }
  async function createMissing(btn) {
    readAll();
    const u = unmatched();
    btn.disabled = true;
    const r = await attempt(() => api('eob.php?action=create_cases', { stage: host.querySelector('#eob-new-stage').value, people: u.map(({ ref, patient, dateOfLoss, claim, payer }) => ({ ref, patient, dateOfLoss, claim, payer })) }));
    btn.disabled = false;
    if (!r) return;
    for (const c of r.created) {
      const it = u.find((x) => x.ref === c.ref); if (!it) continue;
      it.x.case = await attempt(() => api('eob.php?action=case_info&case_id=' + c.caseId, it.ref[0] === 'e' ? it.x.header : { claim: it.x.claim, payer: it.x.payer }));
      it.x.matches = [{ caseId: c.caseId, caseNumber: c.caseNumber, patient: c.patient, score: 100, why: 'new from this EOB' }, ...(it.x.matches || [])];
      it.x.include = true; it.x.coverageId = null; it.x.post = undefined;
    }
    toast(`${r.count} patient${r.count === 1 ? '' : 's'} created`);
    renderReview();
  }
  host.addEventListener('click', (ev) => { const b = ev.target.closest('[data-eob-create-all]'); if (b) createMissing(b); });
  // Edits on screen → the review state.
  function readSection(sec) {
    const e = res.eobs[+sec.dataset.i];
    sec.querySelectorAll('[data-h]').forEach((x) => { e.header[x.dataset.h] = x.value.trim() || null; });
    sec.querySelectorAll('[data-t]').forEach((x) => { e.totals[x.dataset.t] = num(x.value); });
    sec.querySelectorAll('tr[data-j]').forEach((tr) => { const l = e.lines[+tr.dataset.j]; tr.querySelectorAll('[data-l]').forEach((x) => { l[x.dataset.l] = ['charged', 'allowed', 'paid'].includes(x.dataset.l) ? num(x.value) : (x.value.trim() || null); }); });
    e.include = sec.querySelector('[data-e=include]').checked;
    const p = sec.querySelector('[data-e=post]'); e.post = p.checked && !p.disabled;
    const cv = sec.querySelector('[data-e=coverage]'); if (cv && cv.value) e.coverageId = +cv.value;
  }
  const readAll = () => { host.querySelectorAll('section.eob-rev:not(.eob-pay)').forEach(readSection); host.querySelectorAll('section.eob-pay').forEach(readPaySection); };
  host.addEventListener('change', async (ev) => {
    const ps = ev.target.closest('section.eob-pay');
    if (ps) {
      readPaySection(ps);
      const p = res.payments[+ps.dataset.pi];
      if (ev.target.dataset.e === 'case') {
        const id = +ev.target.value;
        p.case = id ? await attempt(() => api('eob.php?action=case_info&case_id=' + id, { claim: p.claim, payer: p.payer })) : null;
        p.coverageId = null; p.post = undefined; p.include = !!p.case;
        ps.outerHTML = paySectionHtml(p, +ps.dataset.pi);
      } else if (ev.target.dataset.e === 'include') ps.classList.toggle('off', !p.include);
      else if (['coverage', 'amount', 'interest'].includes(ev.target.dataset.e || ev.target.dataset.p)) ps.outerHTML = paySectionHtml(p, +ps.dataset.pi);
      return;
    }
    const sec = ev.target.closest('section.eob-rev'); if (!sec) return;
    readSection(sec);
    const e = res.eobs[+sec.dataset.i];
    if (ev.target.dataset.e === 'case') {
      let id = +ev.target.value;
      if (ev.target.value === 'new') {
        id = await newCaseFromEob(e);
        if (!id) { ev.target.value = e.case?.caseId || ''; return; }
        e.matches = [{ caseId: id, caseNumber: '', patient: eobPatientName(e.header.patient).join(' '), score: 100, why: 'new from this EOB' }, ...(e.matches || [])];
      }
      e.case = id ? await attempt(() => api('eob.php?action=case_info&case_id=' + id, e.header)) : null;
      e.coverageId = null; e.post = undefined; e.include = !!e.case;
      sec.outerHTML = sectionHtml(e, +sec.dataset.i);
    } else if (ev.target.dataset.e === 'include') sec.classList.toggle('off', !e.include);
  });
  host.addEventListener('click', (ev) => {
    const sec = ev.target.closest('section.eob-rev'); if (!sec || sec.classList.contains('eob-pay')) return;
    const add = ev.target.closest('[data-eob-add]'), del = ev.target.closest('[data-eob-del]');
    if (!add && !del) return;
    readSection(sec);
    const e = res.eobs[+sec.dataset.i];
    if (add) e.lines.push({ dos: e.lines.at(-1)?.dos || null, code: '', modifiers: null, charged: null, allowed: null, paid: null, reasons: null, notes: [] });
    if (del) e.lines.splice(+del.dataset.eobDel, 1);
    sec.outerHTML = sectionHtml(e, +sec.dataset.i);
  });
}

// An EOB said PIP is exhausted and nothing else is left to bill: ask before
// the case moves to a letter of protection — never switch it silently.
async function offerLop(list) {
  for (const c of list || []) {
    const yes = await confirmBox(`Switch ${c.caseNumber} to a letter of protection?`, `${c.payer}'s EOB says PIP benefits are exhausted, and the case has no other active coverage. Switching moves the case to a letter of protection: insurance paperwork and mailings are no longer needed and the balance is held until the case settles. Your administrators get a summary email. You can also switch later from the case.`, 'Switch to LOP');
    if (!yes) { toast(`${c.caseNumber} stays on insurance billing — switch it from the case when you're ready`); continue; }
    if (await attempt(() => api('eob.php?action=switch_lop', { case_id: c.caseId }))) toast(`${c.caseNumber} switched to a letter of protection`);
  }
}

// The case's saved EOBs (Financials tab).
async function loadCaseEobs() {
  const box = document.getElementById('eob-card');
  if (!box || !S.caseData) return;
  const r = await attempt(() => api('eob.php?action=list&case_id=' + S.caseData.case.id));
  if (!r) return;
  loadCaseEobs.rows = r.eobs;
  const fw = can('finance.write');
  const genie = hasFeature('eob_genie');
  box.innerHTML = `<div class="card mt"><div class="card-head"><img src="assets/genie/appicon.png" alt="" class="genie-mini"><h2>Insurance EOBs</h2><span class="small muted">EOB Genie</span><span class="spacer"></span>${fw && genie ? '<button class="btn ghost sm" data-act="eob-upload-case">Upload EOB</button>' : ''}</div>
    ${!genie && !r.eobs.length ? `<p class="small muted">Upload insurer EOBs and they're read, posted and explained — with EOB Genie, included in Gold and Platinum. ${can('users.manage') ? '<a href="#/billing">See plans</a>' : ''}</p>` : ''}
    ${r.eobs.length ? `<div class="table-wrap"><table><thead><tr><th>EOB date</th><th>Payer</th><th>Dates of service</th><th class="num">Charged</th><th class="num">Allowed</th><th class="num">Paid</th><th>Status</th><th>Notes</th></tr></thead><tbody>
      ${r.eobs.map((e) => { const flags = (e.checks || []).filter((c) => !c.ok).length + (e.lines || []).reduce((n, l) => n + (l.notes || []).filter((x) => x.kind !== 'exhausted').length, 0);
        if (e.kind === 'payment') return `<tr class="clickable" data-act="eob-open" data-id="${e.id}"><td class="nowrap">${esc(fmtDate(e.checkDate || e.createdAt))}</td><td>${esc(e.payer)}</td><td class="small">Check${e.via ? ' via ' + esc(e.via) : ''}</td>
          <td class="num">—</td><td class="num">—</td><td class="num">${money(e.paid)}</td><td>${e.recovery ? '<span class="chip legal">Demand / PIP suit</span>' : '<span class="chip">No EOB</span>'}${e.history ? ' <span class="chip">Past</span>' : (e.posted ? '' : ' <span class="chip">Not posted</span>')}</td><td class="small">${e.interest ? money(e.interest) + ' interest' : ''}</td></tr>`;
        return `<tr class="clickable" data-act="eob-open" data-id="${e.id}"><td class="nowrap">${esc(fmtDate(e.eobDate || e.createdAt))}</td><td>${esc(e.payer)}</td><td class="nowrap small">${esc(fmtDate(e.dosFrom))}${e.dosTo && e.dosTo !== e.dosFrom ? ' – ' + esc(fmtDate(e.dosTo)) : ''}</td>
          <td class="num">${money(e.charged)}</td><td class="num">${money(e.allowed)}</td><td class="num">${money(e.paid)}</td><td>${eobChip(e.status)}${e.history ? ' <span class="chip">Past EOB</span>' : (e.posted ? '' : ' <span class="chip">Not posted</span>')}</td>
          <td class="small">${flags ? `<span class="chip ochre">${flags} to review</span>` : (e.daysToPay !== null ? `Paid in ${e.daysToPay} days` : '')}</td></tr>`; }).join('')}
      </tbody></table></div>` : genie ? `<div class="empty">No EOBs yet. Upload the insurer's EOB to post the payment and see how it was paid.</div>` : ''}</div>`;
}

function eobDetailModal(id) {
  const e = (loadCaseEobs.rows || []).find((x) => x.id === id);
  if (!e) return;
  if (e.kind === 'payment') {
    const m = openModal({ title: `${e.payer} check`, cancelText: 'Close', body: `
      <div class="filters">${e.recovery ? '<span class="chip legal">Demand / PIP suit</span>' : '<span class="chip">No EOB</span>'}${e.posted ? '<span class="chip teal">Posted to the ledger</span>' : '<span class="chip">Not posted</span>'}</div>
      <div class="money-row"><span>Check</span><strong>${esc(e.checkNumber || '—')}${e.checkDate ? ' · ' + esc(fmtDate(e.checkDate)) : ''}</strong></div>
      ${e.claim ? `<div class="money-row"><span>Claim</span><strong>${esc(e.claim)}</strong></div>` : ''}
      ${e.via ? `<div class="money-row"><span>Came through</span><strong>${esc(e.via)}${e.viaRef ? ' · file ' + esc(e.viaRef) : ''}</strong></div>` : ''}
      <div class="money-row"><span>Amount</span><strong>${money(e.paid)}</strong></div>
      ${e.interest ? `<div class="money-row"><span>Of which interest (recorded, not posted)</span><strong>${money(e.interest)}</strong></div>` : ''}
      ${e.fees ? `<div class="money-row"><span>Attorney fees paid separately</span><strong>${money(e.fees)}</strong></div>` : ''}`,
      extraButtons: can('finance.write') ? '<button class="btn ghost danger" data-eob-remove>Remove</button>' : '' });
    m.el.querySelector('[data-eob-remove]')?.addEventListener('click', async () => {
      if (!(await confirmBox('Remove this check?', e.posted ? 'The check and the ledger entries it posted are removed.' : 'The check is removed.', 'Remove'))) return;
      if (await attempt(() => api('eob.php?action=archive', { id: e.id }))) { m.close(); toast('Check removed'); reloadCase(); }
    });
    return;
  }
  const m = openModal({ title: `${e.payer} EOB`, wide: true, cancelText: 'Close', body: `
    <div class="filters">${eobChip(e.status)}${e.posted ? '<span class="chip teal">Posted to the ledger</span>' : '<span class="chip">Not posted</span>'}</div>
    <div class="money-row"><span>Dates of service</span><strong>${esc(fmtDate(e.dosFrom))}${e.dosTo && e.dosTo !== e.dosFrom ? ' – ' + esc(fmtDate(e.dosTo)) : ''}</strong></div>
    <div class="money-row"><span>Bill received by insurer · EOB date</span><strong>${esc(fmtDate(e.receivedOn))} · ${esc(fmtDate(e.eobDate))}</strong></div>
    <div class="money-row"><span>Check</span><strong>${esc(e.checkNumber || '—')}${e.checkDate ? ' · ' + esc(fmtDate(e.checkDate)) : ''}${e.daysToPay !== null ? ` · <span class="${e.daysToPay > 30 ? 'trend-up' : ''}">paid in ${e.daysToPay} days</span>` : ''}</strong></div>
    ${e.timing?.billedDays !== null && e.timing?.billedDays !== undefined ? `<div class="money-row"><span>Billed after service</span><strong>${e.timing.billedDays} days${e.timing.billedLate ? ` <span class="chip red">late — over ${e.timing.billWindow}</span>` : ''}</strong></div>` : ''}
    ${e.timing?.paidLate ? `<div class="money-row"><span>Paid late (over 30 days)</span><strong>${e.timing.payDays} days${e.timing.interestDue !== null ? ' · ' + money(e.timing.interestDue) + ' interest due' : ''}</strong></div>` : ''}
    <div class="money-row"><span>Charged → allowed → paid</span><strong>${money(e.charged)} → ${money(e.allowed)}${e.charged ? ` (${Math.round(e.allowed / e.charged * 1000) / 10}%)` : ''} → ${money(e.paid)}</strong></div>
    ${e.deductible || e.coinsurance ? `<div class="money-row"><span>Deductible · PIP 20% / copay</span><strong>${money(e.deductible)} · ${money(e.coinsurance)}</strong></div>` : ''}
    ${e.interest ? `<div class="money-row"><span>Interest paid (recorded, not posted against the visits)</span><strong>${money(e.interest)}</strong></div>` : ''}
    <div class="table-wrap mt-sm"><table><thead><tr><th>Date</th><th>Code</th><th>Mod.</th><th class="num">Charged</th><th class="num">Allowed</th><th class="num">Paid</th><th>Reason</th></tr></thead><tbody>
      ${(e.lines || []).map((l) => `<tr><td class="nowrap">${esc(fmtDate(l.dos))}</td><td class="mono">${esc(l.code)}</td><td class="small">${esc(l.modifiers || '')}</td><td class="num">${money(l.charged)}</td><td class="num">${money(l.allowed)}</td><td class="num">${money(l.paid)}</td><td class="small">${esc(l.reasons || '')}</td></tr>`).join('')}
    </tbody></table></div>
    ${eobChecksHtml(e.checks)}${eobNotesHtml(e.lines)}
    ${Object.keys(e.reasons || {}).length ? `<details class="mt-sm small"><summary>Reason codes on this EOB</summary><ul>${Object.entries(e.reasons).map(([k, v]) => `<li><span class="mono">${esc(k)}</span> ${esc(v)}</li>`).join('')}</ul></details>` : ''}`,
    extraButtons: can('finance.write') ? '<button class="btn ghost danger" data-eob-remove>Remove EOB</button>' + (hasFeature('eob_genie') ? ' <button class="btn ghost" data-eob-edit>Edit</button>' : '') : '' });
  m.el.querySelector('[data-eob-edit]')?.addEventListener('click', () => { m.close(); eobEditModal(e); });
  m.el.querySelector('[data-eob-remove]')?.addEventListener('click', async () => {
    if (!(await confirmBox('Remove this EOB?', e.posted ? 'The EOB and the ledger entries it posted are removed.' : 'The EOB is removed.', 'Remove'))) return;
    if (await attempt(() => api('eob.php?action=archive', { id: e.id }))) { m.close(); toast('EOB removed'); reloadCase(); }
  });
}

// The EOB Genie header (brand kit: logo, Montserrat, "Insurance EOBs. Explained.").
const genieHead = (sub = '') => `<div class="genie-head"><img src="assets/genie/logo.png" alt="EOB Genie — Insurance EOBs. Explained." class="genie-logo">${sub ? `<p class="genie-sub">${sub}</p>` : ''}</div>`;

// EOB Genie: upload a batch, what to act on, and the practice's numbers.
async function pageEobs(main) {
  main.innerHTML = `${phiBanner}<div class="page-head genie-page-head">${genieHead('Auto / PIP EOBs read, posted and explained — what to act on, and how every insurer pays')}
    <span class="spacer"></span>${can('finance.write') && hasFeature('eob_genie') ? '<button class="btn ghost" data-act="eob-history">Bring in past EOBs</button> <button class="btn genie-btn" data-act="eob-upload">Upload EOBs</button>' : ''}</div><div id="eob-insights"><div class="empty">Loading…</div></div>`;
  const box = document.getElementById('eob-insights');
  if (!hasFeature('eob_genie')) {
    const fi = featureInfo('eob_genie');
    box.innerHTML = `<div class="card upgrade genie-upsell"><img src="assets/genie/icon.png" alt="" class="genie-upsell-icon"><div><span class="chip legal">${esc(fi.planName)} plan &amp; up</span><h2 class="mt-sm">${esc(fi.name)}</h2>
      <p class="mt-sm">${esc(fi.blurb || '')}</p><p class="small muted mt-sm">Included in Gold and Platinum, or on its own as EOB Genie. Your practice is on ${esc(S.practice?.planName || '')}.</p>
      ${can('users.manage') ? '<a class="btn genie-btn mt" href="#/billing">See plans</a>' : '<p class="small mt">Ask your practice admin about upgrading.</p>'}</div></div>`;
    return;
  }
  const d = await attempt(() => api('eob.php?action=insights'));
  if (!d) return;
  const t = d.totals, g = d.genie;
  if (!t.eobs && !g.recovered.items.length) { box.innerHTML = `<div class="card genie-empty"><img src="assets/genie/icon.png" alt="" class="genie-upsell-icon"><div><h2>Upload your first EOBs</h2><p class="small">Scan the auto insurers' EOBs — a whole day's mail in one PDF is fine — and upload the scan. Each EOB is read, matched to its patient and checked; you confirm it and it's posted. The scan itself is never kept.</p></div></div>`; return; }
  const who = (x) => `<a href="#/case/${x.caseId}/financials">${esc(x.patient)}</a> <span class="mono small muted">${esc(x.caseNumber)}</span>`;
  const sect = (id, title, sub, body, n) => `<div class="card mt genie-card" id="${id}"><div class="card-head"><h2>${title}</h2>${n ? `<span class="badge-count">${n}</span>` : ''}</div><p class="small muted">${sub}</p>${body}</div>`;
  const table = (heads, rows) => rows.length ? `<div class="table-wrap"><table><thead><tr>${heads.map((h) => `<th${h.startsWith('#') ? ' class="num"' : ''}>${esc(h.replace(/^#/, ''))}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>` : '<div class="empty">Nothing here — good news.</div>';
  const ml = g.moneyLeft.items, kindLabel = { denied: 'Not paid', underpaid: 'Underpaid', short_paid: 'Paid short' };
  box.innerHTML = `<div class="tiles genie-tiles">
      <button type="button" class="tile accent" data-act="genie-jump" data-to="money-left"><div class="k">Money left on the table</div><div class="v">${money(g.moneyLeft.total)}</div><div class="small muted">${ml.length} item${ml.length === 1 ? '' : 's'} to dispute</div></button>
      <button type="button" class="tile" data-act="genie-jump" data-to="fee-check"><div class="k">Fees below the schedule</div><div class="v">${g.fees.liftYear ? money(g.fees.liftYear) : g.fees.codes.length}</div><div class="small muted">${g.fees.liftYear ? 'more a year at current volume' : 'codes allowed at your full charge'}</div></button>
      <button type="button" class="tile" data-act="genie-jump" data-to="paid-late"><div class="k">Paid late</div><div class="v">${g.paidLate.items.length}</div><div class="small muted">${g.paidLate.interestDue ? money(g.paidLate.interestDue) + ' interest due' : 'over 30 days from receipt'}</div></button>
      <button type="button" class="tile" data-act="genie-jump" data-to="no-eob"><div class="k">Bills with no EOB</div><div class="v">${g.noEob.items.length}</div><div class="small muted">${money(g.noEob.total)} waiting</div></button>
      <button type="button" class="tile warn" data-act="genie-jump" data-to="pip-out"><div class="k">PIP running out</div><div class="v">${g.pip.items.length}</div><div class="small muted">within 8 visits</div></button>
      ${g.recovered.items.length ? `<button type="button" class="tile" data-act="genie-jump" data-to="recovered"><div class="k">Recovered by demands &amp; suits</div><div class="v">${money(g.recovered.total)}</div><div class="small muted">${g.recovered.items.length} check${g.recovered.items.length === 1 ? '' : 's'}${g.recovered.interest ? ' · ' + money(g.recovered.interest) + ' interest' : ''}</div></button>` : ''}</div>
    ${sect('money-left', 'Money left on the table', 'Lines the insurer didn’t pay, allowed less than it usually does, or paid short of the PIP math (80% of the allowed amount). Amounts marked “about” are estimates at 80% of what the code is usually allowed. Dispute with the Florida pre-suit demand letter (§627.736(10)).',
      table(['Patient', 'Payer', 'EOB', 'What', '#Amount', ''], ml.map((x) => `<tr><td>${who(x)}</td><td>${esc(x.payer)}</td><td class="nowrap small">${esc(fmtDate(x.eobDate))}</td><td class="small"><span class="chip ${x.kind === 'denied' ? 'red' : 'ochre'}">${esc(kindLabel[x.kind])}</span> ${esc(x.text)}</td>
        <td class="num">${x.estimated ? '<span class="small muted">about</span> ' : ''}${money(x.amount)}</td><td>${x.demandLetter ? `<a class="btn ghost sm" href="api/cases.php?action=letter&type=pip_demand&id=${x.caseId}" target="_blank" rel="noopener">Demand letter</a>` : ''}</td></tr>`)), ml.length)}
    ${sect('fee-check', 'Fees below the PIP fee schedule', 'PIP pays the lesser of your charge and the schedule. When an insurer allows your whole charge — or more — your fee is likely below what the schedule pays. The yearly figure is 80% of the gap to the highest amount allowed, at your current volume.',
      table(['Code', '#Your charge', '#Highest allowed', '#Allowed in full', '#Per year', '#More a year'], g.fees.codes.map((f) => `<tr><td class="mono">${esc(f.code)}</td><td class="num">${money(f.charge)}</td><td class="num">${money(f.highestAllowed)}</td><td class="num">${f.allowedFull} of ${f.lines}</td><td class="num">${f.perYear}</td><td class="num">${f.liftYear ? '<strong>' + money(f.liftYear) + '</strong>' : '<span class="small muted">check the schedule</span>'}</td></tr>`)), g.fees.codes.length)}
    ${sect('paid-late', 'Paid late', `Florida PIP is overdue 30 days after the insurer receives the bill, and overdue payments bear simple interest (§627.736(4)). ${d.settings.interest_rate !== null ? `Interest is figured at ${esc(d.settings.interest_rate)}% a year, less any interest the insurer paid.` : 'Set the interest rate below to see what\'s owed.'}`,
      table(['Patient', 'Payer', 'EOB', '#Days to pay', '#Paid', '#Interest due'], g.paidLate.items.map((x) => `<tr><td>${who(x)}</td><td>${esc(x.payer)}</td><td class="nowrap small">${esc(fmtDate(x.eobDate))}</td><td class="num">${x.days}</td><td class="num">${money(x.paid)}</td><td class="num">${x.interestDue !== null ? money(x.interestDue) : '—'}</td></tr>`)), g.paidLate.items.length)}
    ${sect('no-eob', 'Bills with no EOB yet', 'Insurance charges still open 45+ days after the date of service with no EOB for that date. The bill may never have reached the insurer — call the adjuster.',
      table(['Patient', 'Date of service', '#Days', '#Open'], g.noEob.items.map((x) => `<tr><td>${who(x)}</td><td class="nowrap">${esc(fmtDate(x.dos))}</td><td class="num">${x.days}</td><td class="num">${money(x.amount)}</td></tr>`)), g.noEob.items.length)}
    ${sect('billed-late', 'Billed late', 'Bills sent after the state\'s PIP billing window — in Florida, 35 days from the date of service, or 75 if the notice of initiation of treatment went to the insurer within 21 days of the first visit (§627.736(5)(c)). Late bills can be refused, and the patient can\'t be billed for them.',
      table(['Patient', 'Payer', 'Service', '#Days to bill', '#Window', '#Charged'], g.billedLate.items.map((x) => `<tr><td>${who(x)}</td><td>${esc(x.payer)}</td><td class="nowrap small">${esc(fmtDate(x.dosFrom))}</td><td class="num"><strong>${x.days}</strong></td><td class="num">${x.window}</td><td class="num">${money(x.charged)}</td></tr>`)), g.billedLate.items.length)}
    ${sect('pip-out', 'PIP running out', 'Open auto cases with 8 or fewer visits of PIP left: what\'s left (the adjuster\'s figure when you\'ve recorded one — PIP is shared with every provider), what PIP pays you per visit on your EOBs, and the visit pace over the last four weeks. Get the letter of protection signed before it runs out.',
      table(['Patient', '#Left', '#Per visit', '#Visits left', 'Runs out', 'LOP'], g.pip.items.map((x) => `<tr><td>${who(x)}</td><td class="num">${money(x.left)}<div class="small muted">${x.source === 'adjuster' ? 'adjuster' : 'of ' + money(x.limit)}</div></td><td class="num">${money(x.perVisit)}<div class="small muted">${x.perVisitFrom === 'case' ? 'this case' : 'practice avg'}</div></td>
        <td class="num"><strong>${x.visitsLeft}</strong></td><td class="nowrap">${x.runsOutOn ? '~' + esc(fmtDate(x.runsOutOn)) : '<span class="small muted">no recent visits</span>'}</td><td>${x.lopSigned ? '<span class="chip teal">Signed</span>' : '<span class="chip red">Not signed</span>'}</td></tr>`)), g.pip.items.length)}
    ${g.recovered.items.length ? sect('recovered', 'Recovered by demands &amp; suits', 'Checks with no EOB — PIP demand and suit payments, most of them mailed to your attorney and forwarded with a cover letter. Interest is recorded with each check, not posted against the visits.',
      `${g.recovered.byFirm.length > 1 || g.recovered.byFirm[0]?.via !== 'Paid to the clinic directly' ? `<div class="table-wrap"><table><thead><tr><th>Came through</th><th class="num">Checks</th><th class="num">Recovered</th><th class="num">Interest</th></tr></thead><tbody>${g.recovered.byFirm.map((f) => `<tr><td>${esc(f.via)}</td><td class="num">${f.n}</td><td class="num">${money(f.amount)}</td><td class="num">${f.interest ? money(f.interest) : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}
      ${table(['Patient', 'Payer', 'Check', 'Came through', '#Amount', '#Interest'], g.recovered.items.map((x) => `<tr><td>${who(x)}</td><td>${esc(x.payer)}</td><td class="nowrap small">${esc(fmtDate(x.checkDate))}${x.checkNumber ? ' · ' + esc(x.checkNumber) : ''}</td><td class="small">${esc(x.via || '—')}${x.viaRef ? ' <span class="muted">file ' + esc(x.viaRef) + '</span>' : ''}</td><td class="num">${money(x.amount)}</td><td class="num">${x.interest ? money(x.interest) : ''}</td></tr>`))}`, 0) : ''}
    ${can('users.manage') ? `<div class="card mt"><h2>Settings</h2><div class="form-grid"><div><label for="eg-rate">Interest on overdue PIP payments (% a year)</label><input id="eg-rate" type="number" step="0.01" min="0" max="25" value="${d.settings.interest_rate ?? ''}" placeholder="e.g. the current §55.03 rate"></div></div>
      <p class="small muted">Florida sets the §55.03 rate each quarter (Chief Financial Officer). Leave blank to show days late only.</p><button class="btn mt" data-act="eob-settings-save">Save</button></div>` : ''}
    <div class="card mt"><h2>By payer</h2><div class="table-wrap"><table><thead><tr><th>Payer</th><th class="num">EOBs</th><th class="num">Charged</th><th class="num">Allowed</th><th class="num">Paid of charges</th><th class="num">Avg days to pay</th><th class="num">Over 30 days</th><th class="num">Lines not paid</th><th class="num">Exhausted</th><th class="num">Payment ≠ PIP math</th></tr></thead><tbody>
      ${d.payers.map((p) => `<tr><td>${esc(p.payer)}</td><td class="num">${p.eobs}</td><td class="num">${money(p.charged)}</td><td class="num">${p.allowedPct !== null ? p.allowedPct + '%' : '—'}</td><td class="num">${p.paidPct !== null ? p.paidPct + '%' : '—'}</td>
        <td class="num">${p.avgDays ?? '—'}</td><td class="num">${p.late || ''}</td><td class="num">${p.deniedLines ? p.deniedLines + ' of ' + p.lines : ''}</td><td class="num">${p.exhausted || ''}</td><td class="num">${p.mismatch || ''}</td></tr>`).join('')}
    </tbody></table></div><p class="small muted mt-sm">Florida PIP allows 200% of Medicare Part B (80% of workers' comp for codes Medicare doesn't price) and pays 80% of that.</p></div>
    <div class="card mt"><h2>By procedure code</h2><div class="table-wrap"><table><thead><tr><th>Code</th><th class="num">Lines</th><th class="num">Your charge</th><th class="num">Usually allowed</th><th class="num">Range</th><th>By payer</th><th>Notes</th></tr></thead><tbody>
      ${d.codes.map((c) => `<tr><td class="mono">${esc(c.code)}</td><td class="num">${c.lines}</td><td class="num">${money(c.charge)}</td><td class="num">${money(c.usualAllowed)}</td><td class="num small">${c.min !== null && c.max !== c.min ? money(c.min) + ' – ' + money(c.max) : ''}</td>
        <td class="small">${c.byPayer.map((b) => `${esc(b.payer)} ${money(b.allowed)}`).join(' · ')}</td>
        <td class="small">${c.chargeBelow ? `<span class="chip ochre">Fee may be below the schedule</span> allowed in full ${c.fullCharge}×` : ''}${c.denied ? ` ${c.denied} not paid` : ''}</td></tr>`).join('')}
    </tbody></table></div><p class="small muted mt-sm">"Usually allowed" is the middle allowed amount on your own EOBs over the last 18 months.</p></div>`;
}

// Edit a saved EOB: a corrected line, or the check that came later.
function eobEditModal(e) {
  const st = { lines: (e.lines || []).map((l) => ({ ...l })) };
  const linesHtml = () => st.lines.map((l, j) => `<tr data-j="${j}"><td><input type="date" data-l="dos" value="${esc(l.dos || '')}" aria-label="Date of service"></td><td><input data-l="code" value="${esc(l.code)}" class="w-code" aria-label="Code"></td>
    <td><input data-l="modifiers" value="${esc(l.modifiers || '')}" class="w-mod" aria-label="Modifiers"></td><td><input type="number" step="0.01" data-l="charged" value="${l.charged ?? ''}" class="w-amt" aria-label="Charged"></td>
    <td><input type="number" step="0.01" data-l="allowed" value="${l.allowed ?? ''}" class="w-amt" aria-label="Allowed"></td><td><input type="number" step="0.01" data-l="paid" value="${l.paid ?? ''}" class="w-amt" aria-label="Paid" placeholder="—"></td>
    <td><input data-l="reasons" value="${esc(l.reasons || '')}" class="w-codes" aria-label="Reason codes"></td><td><button type="button" class="linklike" data-eob-del="${j}" aria-label="Remove line">✕</button></td></tr>`).join('');
  const f = (k, l, v, type = 'text') => `<div><label for="ee-${k}">${l}</label><input id="ee-${k}" data-h="${k}" type="${type}" value="${esc(v ?? '')}"${type === 'number' ? ' step="0.01"' : ''}></div>`;
  const ehr = S.caseData?.case?.ehr_synced_at;
  const m = openModal({ title: `Edit ${e.payer} EOB`, wide: true, okText: 'Save changes', body: `<div class="form-grid">${f('payer', 'Payer', e.payer)}${f('claim', 'Claim number', e.claim)}${f('receivedOn', 'Bill received by insurer', e.receivedOn, 'date')}
      ${f('eobDate', 'EOB date', e.eobDate, 'date')}${f('checkNumber', 'Check number', e.checkNumber)}${f('checkDate', 'Check date', e.checkDate, 'date')}</div>
    <div class="table-wrap mt-sm"><table class="eob-lines"><thead><tr><th>Date of service</th><th>Code</th><th>Mod.</th><th class="num">Charged</th><th class="num">Allowed</th><th class="num">Paid</th><th>Reason codes</th><th></th></tr></thead><tbody id="ee-lines">${linesHtml()}</tbody></table></div>
    <button type="button" class="btn ghost sm mt-sm" data-eob-add>+ Add line</button>
    <div class="form-grid mt-sm eob-totals">${[['charged', 'Total charged'], ['allowed', 'Total allowed'], ['deductible', 'Deductible'], ['coinsurance', 'PIP 20% / copay'], ['interest', 'Interest paid'], ['paid', 'Paid (check)']].map(([k, l]) => `<div><label for="ee-t-${k}">${l}</label><input id="ee-t-${k}" type="number" step="0.01" data-t="${k}" value="${e[k] ?? ''}"></div>`).join('')}</div>
    <label class="check mt-sm"><input type="checkbox" id="ee-post"${e.posted ? ' checked' : ''}${ehr || !can('fin:ledger') ? ' disabled' : ''}> ${e.posted ? 'Re-post to the ledger — the entries this EOB posted are replaced to match' : 'Post to the case ledger'}</label>`,
    onOk: async (el) => {
      readLines(el);
      const header = {}; el.querySelectorAll('[data-h]').forEach((x) => { header[x.dataset.h] = x.value.trim() || null; });
      const totals = {}; el.querySelectorAll('[data-t]').forEach((x) => { totals[x.dataset.t] = num(x.value); });
      const r = await api('eob.php?action=update', { id: e.id, header, lines: st.lines, totals, coverageId: e.coverageId, layout: e.layout, reasons: e.reasons, exhausted: e.status === 'exhausted', post: el.querySelector('#ee-post').checked });
      toast(r.ledgerReplaced ? `EOB updated — ${r.ledgerReplaced} ledger entries replaced` : (r.posted ? 'EOB updated and posted' : 'EOB updated'));
      await offerLop(r.lopSuggested);
      await reloadCase();
    } });
  function readLines(el) { el.querySelectorAll('#ee-lines tr[data-j]').forEach((tr) => { const l = st.lines[+tr.dataset.j]; tr.querySelectorAll('[data-l]').forEach((x) => { l[x.dataset.l] = ['charged', 'allowed', 'paid'].includes(x.dataset.l) ? num(x.value) : (x.value.trim() || null); }); }); }
  m.el.addEventListener('click', (ev) => {
    const add = ev.target.closest('[data-eob-add]'), del = ev.target.closest('[data-eob-del]');
    if (!add && !del) return;
    readLines(m.el);
    if (add) st.lines.push({ dos: st.lines.at(-1)?.dos || null, code: '', modifiers: null, charged: null, allowed: null, paid: null, reasons: null });
    if (del) st.lines.splice(+del.dataset.eobDel, 1);
    m.el.querySelector('#ee-lines').innerHTML = linesHtml();
  });
}

// ----- Push off: when a step or task can't be done now -----
// Logged with who pushed it and listed on the next daily huddle.
function pushOffModal({ kind, key, caseId, label }) {
  const plus = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const m = openModal({ title: 'Push off to a later date', okText: 'Push off',
    body: `<p class="small"><strong>${esc(label)}</strong></p><p class="small muted">How long should it wait? It's logged with your name and shows on the next daily huddle.</p>
      <div class="badge-row mt-sm">${[[1, '1 day'], [7, '1 week'], [14, '2 weeks']].map(([n, l]) => `<button type="button" class="btn ghost sm" data-push-days="${n}">${l}</button>`).join('')}</div>
      <div class="form-grid mt"><div><label for="po-date">Or pick a date</label><input type="date" id="po-date" min="${plus(1)}" value="${plus(1)}"></div></div>`,
    onOk: async (el) => {
      const until = el.querySelector('#po-date').value;
      const r = await api('cases.php?action=push' + (caseId ? '&id=' + caseId : ''), { kind, key, until });
      toast('Pushed to ' + fmtDate(until));
      if (r.case) { S.caseData = r; renderCase(); } else route();
    } });
  m.el.querySelectorAll('[data-push-days]').forEach((b) => b.addEventListener('click', () => {
    m.el.querySelector('#po-date').value = plus(+b.dataset.pushDays);
    m.el.querySelectorAll('[data-push-days]').forEach((x) => x.classList.toggle('ghost', x !== b));
  }));
}

// ----- Insurance ↔ letter of protection -----
const BASIS_NAMES = { insurance: 'insurance (PIP) billing', lop: 'a letter of protection' };
function basisListHtml(items) { return items.length ? `<ul class="small">${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="small muted">None</p>'; }
// The last switch, until someone dismisses it — so everyone on the case sees it.
function basisNoticeHtml(d) {
  const b = d.basisChange;
  if (!b) return '';
  return `<div class="card basis-notice"><div class="card-head"><h2>Switched to ${esc(BASIS_NAMES[b.to])}</h2><span class="spacer"></span><button class="btn ghost sm" data-act="basis-seen">Got it</button></div>
    <p class="small">${esc(fmtDate(b.at.slice(0, 10)))}${b.by ? ' by ' + esc(b.by) : ''}${b.why ? ' — ' + esc(b.why) : ''}. The case's steps were updated:</p>
    <div class="grid-2"><div><strong class="small">Added</strong>${basisListHtml(b.added)}</div><div><strong class="small">Removed (no longer needed)</strong>${basisListHtml(b.removed)}</div></div></div>`;
}
// Pops up once right after a switch (the notice card stays until dismissed).
const shownBasis = new Set();
function maybeShowBasisChange(d) {
  const b = d.basisChange;
  if (!b || shownBasis.has(d.case.id + b.at)) return;
  shownBasis.add(d.case.id + b.at);
  if (Date.now() - new Date(b.at.replace(' ', 'T')).getTime() > 10 * 60 * 1000) return;   // only for a change just made
  openModal({ title: `Case switched to ${BASIS_NAMES[b.to]}`, cancelText: 'OK', body: `<p class="small">${b.why ? esc(b.why) + '. ' : ''}${b.to === 'lop' ? 'Insurance paperwork and mailings are no longer needed; the balance is held until the case settles. Clinical steps (like the EMC evaluation) stay.' : 'Insurance paperwork and mailings to the insurer were added.'} A summary was emailed to the practice's administrators.</p>
    <div class="grid-2"><div><strong class="small">Steps added</strong>${basisListHtml(b.added)}</div><div><strong class="small">Steps removed</strong>${basisListHtml(b.removed)}</div></div>` });
}
function switchBasisModal(to) {
  const c = S.caseData.case;
  const reasons = to === 'lop' ? ['Claim denied', 'Policy lapsed / no coverage', 'PIP exhausted', 'Other disqualifying factor', 'Attorney requested an LOP'] : ['Coverage confirmed', 'Claim accepted', 'Insurance information received'];
  openModal({ title: to === 'lop' ? 'Switch to a letter of protection' : 'Switch to insurance billing', okText: 'Switch',
    body: `<p class="small">${to === 'lop' ? 'The balance will be held at your office and resolved when the attorney settles the case. Insurance-only steps (assignment of benefits, standard disclosure, insurer mailings) come off the case; clinical steps stay. Make sure the patient signs a letter of protection.' : 'Insurance paperwork and mailings to the PIP insurer will be added to the case. Add or update the PIP coverage under Insurance.'}</p>
      <div class="form-grid mt"><div class="full"><label for="sb-why">Why?</label><select id="sb-why">${reasons.map((r) => opt(r, r)).join('')}</select></div></div>`,
    onOk: async (el) => { S.caseData = await api('cases.php?action=update&id=' + c.id, { case: { billing_basis: to }, basis_reason: el.querySelector('#sb-why').value }); renderCase(); } });
}

// "Do you charge for a final narrative?" — yes/no and the two fees.
function narrFeeFields(f) {
  const yes = f.asked && f.charge;
  return `<div class="nf-fields"><div class="badge-row mt-sm"><label class="check"><input type="radio" name="nf-charge" value="0"${f.asked && !f.charge ? ' checked' : ''}> No, we don't charge</label>
      <label class="check"><input type="radio" name="nf-charge" value="1"${yes ? ' checked' : ''}> Yes, we charge a fee</label></div>
    <div class="form-grid mt-sm nf-amounts"${yes ? '' : ' hidden'}><div><label for="nf-without">Fee — without AMA impairment ratings ($)</label><input type="number" id="nf-without" min="0" step="0.01" value="${f.without ?? ''}"></div>
      <div><label for="nf-with">Fee — with AMA whole-person ratings ($)</label><input type="number" id="nf-with" min="0" step="0.01" value="${f.with ?? ''}"></div></div></div>`;
}
function readNarrFees(root) {
  const c = root.querySelector('[name="nf-charge"]:checked');
  if (!c) return null;
  return { charge: c.value === '1', without: root.querySelector('#nf-without').value, with: root.querySelector('#nf-with').value };
}
// Monthly case update on/off for one case.
document.addEventListener('change', async (e) => {
  if (e.target.dataset?.actChange !== 'case-update-toggle') return;
  const r = await attempt(() => api('cases.php?action=update&id=' + S.caseData.case.id, { case: { case_updates: e.target.checked } }));
  if (r) { S.caseData = r; renderCase(); toast(e.target.checked ? 'Monthly updates on for this case' : 'Monthly updates off for this case'); }
});
// White label: color picker and hex box stay in step; a logo uploads on choose.
document.addEventListener('input', (e) => {
  const pick = e.target.id === 'wl-color-pick', hex = e.target.id === 'wl-color';
  if (!pick && !hex) return;
  if (pick) document.getElementById('wl-color').value = e.target.value.toUpperCase();
  else if (/^#[0-9A-F]{6}$/i.test(e.target.value)) document.getElementById('wl-color-pick').value = e.target.value;
  const c = document.getElementById('wl-color').value;
  if (/^#[0-9A-F]{6}$/i.test(c)) { document.querySelectorAll('#wl-preview .wl-btn').forEach((b) => { b.dataset.color = c; }); paintWlPreview(); }
});
document.addEventListener('change', async (e) => {
  if (e.target.id !== 'wl-logo-file' || !e.target.files[0]) return;
  const fd = new FormData(); fd.append('file', e.target.files[0]);
  if (await attempt(() => api('admin.php?action=white_label_logo', fd))) { toast('Logo uploaded'); await refreshSession(); pageSettings(document.getElementById('main')); }
});
document.addEventListener('change', async (e) => {
  if (e.target.id !== 'pack-chart') return;
  if (await attempt(() => api('admin.php?action=step_packs_save', { chart_setup: e.target.checked }))) { toast(e.target.checked ? 'Chart-setup steps added to cases' : 'Chart-setup steps removed'); loadSteps(); }
});
document.addEventListener('change', (e) => {
  if (e.target.name !== 'nf-charge') return;
  const amts = e.target.closest('.nf-fields').querySelector('.nf-amounts');
  amts.hidden = e.target.value !== '1';
});
const money2 = (n) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Fee and acknowledgment line for a requested narrative.
function narrFeeLine(c) {
  if (!['without_ratings', 'with_ratings'].includes(c.narrative_request) || !c.narrative_fee) return '';
  return c.narrative_fee_ack_at ? `Fee ${money2(c.narrative_fee)} — acknowledged${c.narrative_fee_ack_by ? ' by ' + c.narrative_fee_ack_by : ''} on ${fmtDate(c.narrative_fee_ack_at.slice(0, 10))} (${c.narrative_fee_ack_via === 'online' ? 'online reply' : 'returned form'})`
    : `Fee ${money2(c.narrative_fee)} — not acknowledged yet`;
}

const NARRATIVE_LABELS = { pending: 'Asked — waiting for the attorney', none: 'Not needed (attorney declined)', without_ratings: 'Requested — without AMA impairment ratings', with_ratings: 'Requested — with AMA whole-person impairment ratings' };

// End of treatment letter: MMI (outcome wording chosen by the provider) or
// self-released; asks the attorney about a final narrative report.
function eocLetterModal() {
  const c = S.caseData.case;
  const selfReleased = c.discharge_date && !c.mmi_date;
  if (!c.discharge_date && !c.mmi_date) return toast('Record MMI, or that the patient stopped coming, under Next steps first.', true);
  const defs = [...(selfReleased ? [] : [{ n: 'outcome', l: "Outcome (use the treating provider's findings)", t: 'select', blank: false, opts: [['improved', 'Significant improvement in pain and function'], ['residual', 'Improved, with some symptoms remaining'], ['unresolved', 'Conservative care has not resolved the symptoms']] }]),
    ...(fin('balances') ? [{ n: 'balance', l: 'Include the outstanding balance', t: 'check' }] : [])];
  const nf = S.caseData.narrativeFees || { asked: true };
  const feeAsk = !nf.asked ? (can('users.manage') ? `<div class="notice mt"><b>Does your office charge for a final narrative report?</b> Your answer goes on the letter (and is saved for next time under Settings).${narrFeeFields(nf)}</div>`
      : '<p class="small muted mt">Your office hasn\'t said yet whether it charges for a final narrative report, so the letter says any charges go on the patient\'s balance. An administrator can set the fee under Settings.</p>')
    : `<p class="small muted mt">${nf.charge ? `Your fee is shown on the letter${nf.without ? ' — ' + money2(nf.without) + ' without ratings' : ''}${nf.with ? ', ' + money2(nf.with) + ' with ratings' : ''}, and the attorney acknowledges it.` : 'The letter says there is no charge for the report.'} Change this under Settings.</p>`;
  openModal({ title: 'End of treatment — narrative request', okText: 'Open letter', body: `<p class="small">${selfReleased ? 'Tells the attorney the patient stopped coming (care ended without MMI) and asks whether they need a final narrative report.' : 'Tells the attorney the patient reached MMI' + (c.maintenance_every_days && !c.discharge_date ? ' and is moving to maintenance care' : ' and was released from care') + ', and asks whether they need a final narrative report.'}
 The attorney marks: yes without AMA ratings, yes with AMA whole-person ratings, or no. Record their answer on the case when it comes back.</p>${defs.length ? fieldsHtml(defs, { balance: true }) : ''}${feeAsk}`,
    onOk: async (el) => {
      const v = defs.length ? readFields(el, defs) : {};
      if (!nf.asked && can('users.manage')) {
        const f = readNarrFees(el);
        if (!f) { toast('Choose whether your office charges for a final narrative.', true); return false; }
        await api('admin.php?action=narrative_fees_save', f);
        S.caseData.narrativeFees = { asked: true, charge: f.charge, without: +f.without || null, with: +f.with || null };
      }
      window.open('api/cases.php?action=letter&type=end_of_care&id=' + c.id + (v.outcome ? '&outcome=' + v.outcome : '') + (v.balance ? '&balance=1' : ''), '_blank', 'noopener');
      if (!c.narrative_request) { S.caseData = await api('cases.php?action=update&id=' + c.id, { case: { narrative_request: 'pending' } }); renderCase(); }
    } });
}

function narrativeModal() {
  const c = S.caseData.case;
  const defs = [{ n: 'narrative_request', l: "Attorney's answer", t: 'select', blank: false, opts: [['pending', 'Asked — waiting'], ...Object.entries({ without_ratings: 'Yes — without AMA impairment ratings', with_ratings: 'Yes — with AMA whole-person impairment ratings', none: 'No — not needed' })] },
    { n: 'narrative_requested_on', l: 'Date requested (the report is due 30 days later)', t: 'date' }];
  const nf = S.caseData.narrativeFees || {};
  const feeOf = (k) => k === 'with_ratings' ? nf.with : (k === 'without_ratings' ? nf.without : null);
  const isYes = (k) => ['without_ratings', 'with_ratings'].includes(k);
  const feeDefs = [{ n: 'narrative_fee', l: 'Narrative fee ($, blank = no charge)', t: 'money' }, { n: 'narrative_fee_ack_by', l: 'Acknowledged by (name on the form)' }];
  const feeBox = `<div id="nm-fee" class="mt"${isYes(c.narrative_request) ? '' : ' hidden'}>${fieldsHtml(feeDefs, { narrative_fee: c.narrative_fee ?? (nf.charge ? feeOf(c.narrative_request) ?? '' : ''), narrative_fee_ack_by: c.narrative_fee_ack_by || '' })}
    <label class="check mt-sm"><input type="checkbox" id="nm-ack"${c.narrative_fee_ack_at ? ' checked' : ''}> The attorney acknowledged the fee (checked it on the returned form)</label>
    ${c.narrative_fee_ack_at ? `<p class="small muted">${esc(narrFeeLine(c))}</p>` : ''}</div>`;
  const m = openModal({ title: 'Final narrative report', okText: 'Save', body: fieldsHtml(defs, { narrative_request: c.narrative_request || 'pending', narrative_requested_on: c.narrative_requested_on || '' }) + feeBox,
    onOk: async (el) => {
      const v = readFields(el, defs);
      if (isYes(v.narrative_request)) Object.assign(v, readFields(el, feeDefs), { narrative_fee_ack: el.querySelector('#nm-ack').checked && !!el.querySelector('[name="narrative_fee"]').value });
      S.caseData = await api('cases.php?action=update&id=' + c.id, { case: v }); renderCase(); toast('Saved');
    } });
  m.el.querySelector('[name="narrative_request"]').addEventListener('change', (e) => {
    const yes = isYes(e.target.value);
    m.el.querySelector('#nm-fee').hidden = !yes;
    if (yes && nf.charge && !c.narrative_fee) m.el.querySelector('[name="narrative_fee"]').value = feeOf(e.target.value) ?? '';
  });
}

function endCareModal() {
  const c = S.caseData.case;
  openModal({ title: 'Patient stopped coming', okText: 'End care', body: `<p class="small">Ends active care without an MMI finding — for a patient who stopped attending. Care ends on their last visit unless you choose another date. If they come back, use "Patient came back — resume care".</p>
      <div class="assignee-list mt">${Object.entries({ self_released: 'Self-released', unreachable: 'Unable to be reached by phone/text', referred_out: 'Referred to another provider', other: 'Other' }).map(([k, l]) => `<label class="check"><input type="checkbox" data-flag="${k}"${k === 'self_released' ? ' checked' : ''}> ${esc(l)}</label>`).join('')}</div>
      <div class="form-grid mt"><div><label for="ec-date">Care ended on (blank = last visit)</label><input type="date" id="ec-date" max="${esc(today())}"></div></div>
      <p class="small muted mt">Next: the end-of-treatment letter (Letters) asks the attorney whether they need a final narrative report.</p>`,
    onOk: async (el) => {
      const flags = [...el.querySelectorAll('[data-flag]:checked')].map((x) => x.dataset.flag);
      S.caseData = await api('cases.php?action=end_care&id=' + c.id, { flags, date: el.querySelector('#ec-date').value || null });
      renderCase(); toast('Care ended');
    } });
}

function openLetter(type) {
  window.open('api/cases.php?action=letter&type=' + encodeURIComponent(type) + '&id=' + S.caseData.case.id, '_blank', 'noopener');
}

// ---------- change password (signed in) ----------
function changePasswordModal() {
  const defs = [{ n: 'current', l: 'Current password', t: 'password', req: true }, { n: 'new', l: 'New password (12+ characters)', t: 'password', req: true }, { n: 'new2', l: 'Repeat new password', t: 'password', req: true }];
  openModal({ title: 'Change password', body: fieldsHtml(defs), onOk: async (el) => {
    const v = readFields(el, defs);
    if (v.new !== v.new2) throw new Error("The new passwords don't match.");
    await api('auth.php?action=change_password', { current: v.current, new: v.new });
    toast('Password changed');
  } });
}

// ---------- delegated actions ----------
const ACTIONS = {
  'sign-out': signOut,
  'show-signup': () => { history.replaceState(null, '', '#signup'); showSignup(); },
  'show-login': () => { history.replaceState(null, '', location.pathname); showLogin(); },
  'save-practice': async () => {
    const box = document.getElementById('practice-form');
    try { await api('admin.php?action=practice_save', readFields(box, practiceDefs())); toast('Saved'); refreshSession(); }
    catch (e) { document.getElementById('practice-err').textContent = e.message; }
  },
  'save-staff-fin': async () => {
    const scopes = [...document.querySelectorAll('[data-staff-fin]:checked')].map((cb) => cb.dataset.staffFin);
    if (await attempt(() => api('admin.php?action=staff_finance', { scopes }))) toast('Staff financial visibility saved');
  },
  'accept-baa': async () => {
    if (!document.getElementById('baa-accept').checked) { toast('Tick the box to accept.', true); return; }
    if (await attempt(() => api('admin.php?action=accept_baa', { accept: true }))) { toast('Agreement accepted'); await refreshSession(); route(); }
  },
  'billing-interval': (el) => { billingInterval.value = el.dataset.v; pageBilling(document.getElementById('main')); },
  'checkout': async (el) => {
    const r = await attempt(() => api('billing.php?action=checkout', { plan: el.dataset.plan, interval: el.dataset.interval || 'monthly' }));
    if (r?.url) location.href = r.url;
  },
  'billing-portal': async () => {
    const r = await attempt(() => api('billing.php?action=portal', {}));
    if (r?.url) location.href = r.url;
  },
  'op-extend': async (el) => { if (await attempt(() => api('platform.php?action=practice_update', { id: +el.dataset.id, extend_trial_days: 14 }))) { toast('Trial extended'); route(); } },
  'op-comp': async (el) => { if (await attempt(() => api('platform.php?action=practice_update', { id: +el.dataset.id, comped: el.dataset.on === '1' }))) route(); },
  'change-password': changePasswordModal,
  'my-notify': myNotifyModal,
  'huddle-print': () => window.print(),
  'save-notify-rules': async () => {
    const box = document.getElementById('notify-rules');
    const body = { criteria: [...box.querySelectorAll('[data-crit]:checked')].map((x) => x.dataset.crit), gap_days: +box.querySelector('#nr-gap').value,
      adherence_pct: +box.querySelector('#nr-adh').value, weekdays_only: box.querySelector('#nr-weekdays').checked };
    if (await attempt(() => api('admin.php?action=notify_rules_save', body))) toast('Saved');
  },
  'new-case': () => newCaseModal(),
  'another-case': async () => {
    const r = await attempt(() => api('cases.php?action=patient_search&id=' + S.caseData.case.patient_id));
    const pt = r?.patients[0];
    if (pt) newCaseModal({ patient: pt });
  },
  'goto-stage': (el) => { casesState.stage = el.dataset.stage; location.hash = '#/cases'; },
  'open-case': (el) => { S.caseTab = el.dataset.tab || 'overview'; location.hash = '#/case/' + el.dataset.id; },
  'sort-cases': (el) => { casesState.dir = casesState.sort === el.dataset.key ? -casesState.dir : 1; casesState.sort = el.dataset.key; const t = document.getElementById('cases-table'); if (t._rows) renderCasesTable(t._rows); },
  'sort-ar': (el) => { arState.dir = arState.sort === el.dataset.key ? -arState.dir : 1; arState.sort = el.dataset.key; pageAR(document.getElementById('main')); },
  'case-tab': (el) => { S.caseTab = el.dataset.tab; renderCase(); },
  'switch-basis': (el) => switchBasisModal(el.dataset.to),
  'mail-done': async (el) => {
    const r = await attempt(() => api('cases.php?action=milestone&id=' + el.dataset.case, { key: el.dataset.key, completed_on: today(), not_applicable: false }));
    if (r) { toast('Marked mailed'); el.closest('li').remove(); }
  },
  'basis-seen': async () => { S.caseData = await api('cases.php?action=basis_seen&id=' + S.caseData.case.id, {}); renderCase(); },
  'edit-case': editCaseModal, 'edit-patient': editPatientModal, 'edit-notes': editNotesModal,
  'add-referral': () => referralModal(null),
  'guide-refer': (el) => referralModal(null, { type: el.dataset.type, ...(el.dataset.region ? { body_region: el.dataset.region } : {}) }),
  'tip-dismiss': (el) => tipDismissModal(el.dataset.key),
  'guide-visit': (el) => visitModal(null, { visit_type: el.dataset.type }),
  'outreach-log': outreachLogModal,
  'export-file': exportFileModal,
  'location-edit': (el) => locationModal(el.dataset.id ? +el.dataset.id : null),
  'edit-estimates': () => estimatesModal(),
  'save-costs': async (el) => {
    const box = document.getElementById('costs-card'), costs = {};
    box.querySelectorAll('[data-cost]').forEach((inp) => { (costs[inp.dataset.cost] = costs[inp.dataset.cost] || {})[inp.dataset.f] = inp.value; });
    const r = await attempt(() => api('admin.php?action=costs_save', el.dataset.reset ? { reset: true } : { costs }));
    if (r) { toast(el.dataset.reset ? 'Back to the defaults' : 'Cost list saved'); await refreshSession(); pageSettings(document.getElementById('main')); }
  },
  'promo-check': () => checkPromo(),
  'mkt-save': async () => {
    const body = mktSettingsPayload();
    if (body.enabled && !pageMarketing.data.settings.enabled && !(await confirmBox('Turn on automatic sending?', 'Emails will go out to qualified practices every weekday morning without approval, up to the daily cap (starting with the warm-up amount).', 'Turn on'))) return;
    const r = await attempt(() => api('platform.php?action=mkt_settings', body));
    if (r) { toast(r.blocker && body.enabled ? 'Saved — ' + r.blocker : 'Saved'); pageMarketing(document.getElementById('main')); }
  },
  'mkt-test': async () => {
    if (await attempt(() => api('platform.php?action=mkt_test', { to: document.getElementById('mkt-test-to').value, step: +document.getElementById('mkt-test-step').value }))) toast('Test sent');
  },
  'mkt-open': (el) => mktOpen(+el.dataset.id),
  'mkt-page': (el) => { mktState.page = Math.max(0, mktState.page + +el.dataset.d); loadMktProspects(); },
  'mkt-suppress': () => mktSuppressModal(),
  'mkt-add': () => mktAddModal(),
  'sched-preview': () => schedPreviewFile(),
  'sched-cancel': () => { schedState.preview = null; schedState.review = null; pageSchedule(document.getElementById('main')); },
  'sched-done': () => { schedState.result = null; pageSchedule(document.getElementById('main')); },
  'sched-cols': () => { schedState.showCols = !schedState.showCols; pageSchedule(document.getElementById('main')); },
  'sched-bulk': (el) => { schedState.preview.rows.forEach((r) => { if ((schedState.choices[r.line]?.action ?? r.action) === 'ask') schedState.choices[r.line] = { ...schedState.choices[r.line], action: el.dataset.v }; }); pageSchedule(document.getElementById('main')); },
  'sched-remap': async () => {
    const cols = {}; document.querySelectorAll('[data-sched-col]').forEach((s) => { if (s.value !== '') cols[s.dataset.schedCol] = +s.value; });
    const pv = schedState.preview;
    const r = await attempt(() => api('schedule.php?action=remap', { token: pv.token, header: pv.columns.header, cols, save_as: document.getElementById('sched-fmt').value }));
    if (r) { schedState.preview = r; schedState.choices = {}; schedState.showCols = false; toast('Re-read'); pageSchedule(document.getElementById('main')); }
  },
  'sched-words': async () => {
    const map = {}; document.querySelectorAll('#sched-words [data-word]').forEach((s) => { if (s.value) map[s.dataset.word] = s.value; });
    if (!Object.keys(map).length) return toast('Choose what at least one status means.', true);
    const r = await attempt(() => api('schedule.php?action=words', { token: schedState.preview.token, map }));
    if (r) { schedState.preview = r; schedState.choices = {}; toast('Saved — remembered for future uploads'); pageSchedule(document.getElementById('main')); }
  },
  'sched-review': async () => {
    const r = await attempt(() => api('schedule.php?action=review', { token: schedState.preview.token, rows: schedState.choices }));
    if (r) { schedState.review = r; pageSchedule(document.getElementById('main')); window.scrollTo(0, 0); }
  },
  'sched-back': () => { schedState.review = null; pageSchedule(document.getElementById('main')); },
  'sched-bulk-case': (el) => {
    const ch = schedState.choices;
    schedState.preview.rows.forEach((r) => {
      const a = ch[r.line]?.action ?? r.action, c = (ch[r.line] && 'case_id' in ch[r.line]) ? ch[r.line].case_id : r.case_id;
      if (r.ambiguous || !['visit', 'no_show'].includes(a) || (c !== null && c !== '')) return;
      ch[r.line] = { ...ch[r.line], case_id: el.dataset.v === 'all' ? 'all' : r.cases[0].id };
    });
    pageSchedule(document.getElementById('main'));
  },
  'sched-apply': async () => {
    const pv = schedState.preview;
    const r = await attempt(() => api('schedule.php?action=apply', { token: pv.token, rows: schedState.choices }));
    if (r) { schedState.preview = null; schedState.review = null; schedState.choices = {}; schedState.result = r; pageSchedule(document.getElementById('main')); window.scrollTo(0, 0); }
  },
  'sched-undo': async (el) => {
    if (!(await confirmBox('Undo this upload?', 'The visits and no-shows it logged are removed from the cases (they stay in the activity history).', 'Undo'))) return;
    if (await attempt(() => api('schedule.php?action=undo', { id: +el.dataset.id }))) { toast('Upload undone'); pageSchedule(document.getElementById('main')); }
  },
  'sched-settings': async () => {
    const status_map = {}; document.querySelectorAll('[data-keep-word]:checked').forEach((c) => { status_map[c.dataset.keepWord] = c.dataset.o; });
    const r = await attempt(() => api('schedule.php?action=settings', { cancel_counts: document.getElementById('ss-cancel').value, unknown_as: document.getElementById('ss-unknown').value, multi_case: document.getElementById('ss-multi').value, status_map }));
    if (r) { toast('Saved'); pageSchedule(document.getElementById('main')); }
  },
  'status-settings': () => statusSettingsModal(),
  'case-update-send': async () => {
    const r = await attempt(() => api('cases.php?action=case_update_send&id=' + S.caseData.case.id, {}));
    if (r) { S.caseData = r; renderCase(); toast('Update sent to ' + r.to.join(', ')); }
  },
  'save-case-updates': async (el) => {
    const on = document.getElementById('cu-on').checked;
    if (await attempt(() => api('admin.php?action=case_updates_save', { on }))) toast(on ? 'Monthly case updates on' : 'Monthly case updates off');
  },
  'status-send': async () => {
    const sr = S.caseData.statusRequests;
    if (!(await confirmBox('Send a status request now?', `An email with a secure reply link goes to ${sr.recipients.join(', ')}. No patient details are in the email.`, 'Send'))) return;
    const r = await attempt(() => api('cases.php?action=status_send&id=' + S.caseData.case.id, {}));
    if (r) { S.caseData = r; renderCase(); toast('Request sent to ' + r.to.join(', ')); }
  },
  'save-white-label': async () => {
    const box = document.getElementById('wl-card');
    const r = await attempt(() => api('admin.php?action=white_label_save', { name: box.querySelector('#wl-name').value, color: box.querySelector('#wl-color').value, slug: box.querySelector('#wl-slug').value }));
    if (r) { toast('Branding saved'); await refreshSession(); pageSettings(document.getElementById('main')); }
  },
  'wl-logo-remove': async () => {
    if (!(await confirmBox('Remove your logo?', 'Your product name is shown instead until you upload another.', 'Remove'))) return;
    if (await attempt(() => api('admin.php?action=white_label_logo_remove', {}))) { await refreshSession(); pageSettings(document.getElementById('main')); }
  },
  'save-narrative-fees': async () => {
    const v = readNarrFees(document.getElementById('narr-fee-card'));
    if (!v) return toast('Choose whether your office charges for a final narrative.', true);
    const r = await attempt(() => api('admin.php?action=narrative_fees_save', v));
    if (r) toast('Saved');
  },
  'save-status-rules': async (el) => {
    const box = document.getElementById('status-rules-card');
    const enable = !!el.dataset.enable;
    if (enable && !(await confirmBox('Turn on for open cases?', 'Every open case past treatment (or in demand, litigation, mediation, negotiation or settled awaiting the check) that has an attorney or case manager will start getting automatic status requests.', 'Turn on'))) return;
    const r = await attempt(() => api('admin.php?action=status_rules_save', { default_on: box.querySelector('#sq-default').checked, every_days: +box.querySelector('#sq-every').value,
      show_balance: box.querySelector('#sq-balance').checked, enable_open: enable }));
    if (r) { toast(enable ? `Turned on for ${r.turnedOn} case${r.turnedOn === 1 ? '' : 's'}` : 'Saved'); pageSettings(document.getElementById('main')); }
  },
  'save-task-email': async () => {
    const box = document.getElementById('task-email-card');
    const r = await attempt(() => api('admin.php?action=task_email_rules_save', { on: [...box.querySelectorAll('[data-tr-on]:checked')].map((x) => x.dataset.trOn),
      who: [...box.querySelectorAll('[data-tr-who]:checked')].map((x) => x.dataset.trWho), repeat_days: +box.querySelector('#tr-repeat').value }));
    if (r) { toast('Task email defaults saved'); await refreshSession(); }
  },
  'change-plan': (el) => changePlan(el),
  'step-edit': (el) => stepModal(el.dataset.id ? +el.dataset.id : null),
  'step-remove': async (el) => { if (!(await confirmBox('Remove this step?', 'It disappears from every case\'s checklist. Completions already recorded stay in the activity log.', 'Remove'))) return; if (await attempt(() => api('admin.php?action=step_save', { id: +el.dataset.id, remove: true }))) { toast('Removed'); loadSteps(); } },
  'step-silence': async (el) => { if (await attempt(() => api('admin.php?action=step_silence', { key: el.dataset.key, silenced: el.dataset.on === '1' }))) { toast(el.dataset.on === '1' ? 'Silenced for every case' : 'Turned back on'); loadSteps(); } },
  'promo-new': () => promoModal(),
  'promo-toggle': async (el) => { if (await attempt(() => api('platform.php?action=promo_save', { id: +el.dataset.id, active: el.dataset.on === '1' }))) { toast('Saved'); pagePlatform(document.getElementById('main')); } },
  'badge-style': (el) => { loadBadge.style = el.dataset.style; loadBadge(loadBadge.data); },
  'badge-toggle': async () => { const r = await attempt(() => api('admin.php?action=badge_save', { enabled: !loadBadge.data.enabled })); if (r) { toast(r.badge.enabled ? 'Badge turned on' : 'Badge turned off'); loadBadge(r.badge); } },
  'badge-copy': async () => {
    const ta = document.getElementById('badge-code');
    try { await navigator.clipboard.writeText(ta.value); } catch { ta.select(); document.execCommand('copy'); }
    toast('Embed code copied');
  },
  'badge-reset': async () => {
    if (!(await confirmBox('Create new badge links?', 'Badges already on your website will show "not verified" until you paste the new code.', 'Create new links'))) return;
    const r = await attempt(() => api('admin.php?action=badge_reset', {}));
    if (r) { toast('New links created — update your website'); loadBadge(r.badge); }
  },
  'suggest': suggestModal,
  'op-feedback': (el) => feedbackUpdateModal(+el.dataset.id),
  'outreach-hold': outreachHoldModal,
  'outreach-resume': async () => {
    const r = await attempt(() => api('cases.php?action=outreach_hold&id=' + S.caseData.case.id, { resume: true }));
    if (r) { S.caseData = r; renderCase(); toast('Calls resumed'); }
  },
  'mmi': (el) => mmiModal(el.dataset.plan),
  'emc-result': async (el) => {
    const r = await attempt(() => api('cases.php?action=update&id=' + S.caseData.case.id, { case: { emc_status: el.dataset.v } }));
    if (r) { S.caseData = r; renderCase(); toast('EMC determination recorded'); }
  },
  'guide-dismiss': (el) => guideDismissModal(el.dataset.step),
  'guide-snooze': (el) => guideSnoozeModal(el.dataset.step),
  'push-guide': (el) => pushOffModal({ kind: 'guide', key: el.dataset.step, caseId: S.caseData.case.id, label: (S.caseData.guide.find((g) => g.key === el.dataset.step) || {}).title || 'Next step' }),
  'push-step': (el) => pushOffModal({ kind: 'step', key: el.dataset.key, caseId: S.caseData.case.id, label: (S.caseData.checklist.find((i) => i.key === el.dataset.key) || {}).label || 'Checklist step' }),
  'push-task': (el) => { const t = taskCache.get(+el.dataset.id) || taskCache.get(el.dataset.id); pushOffModal({ kind: 'task', key: el.dataset.id, caseId: null, label: t ? t.title : 'Task' }); },
  'guide-clear': (el) => attempt(() => guideStep(el.dataset.step, { status: 'clear' })),
  'head-injury': async (el) => {
    const r = await attempt(() => api('cases.php?action=update&id=' + S.caseData.case.id, { case: { head_injury: el.dataset.v } }));
    if (r) { S.caseData = r; renderCase(); toast('Saved'); }
  },
  'edit-referral': (el) => referralModal(S.caseData.referrals.find((r) => r.id == el.dataset.id)),
  'add-visit': () => visitModal(null),
  'edit-visit': (el) => visitModal(S.caseData.visits.find((r) => r.id == el.dataset.id)),
  'add-outcome': outcomeModal,
  'add-corr': () => corrModal(null),
  'edit-corr': (el) => corrModal(S.caseData.correspondence.find((r) => r.id == el.dataset.id)),
  'add-coverage': () => coverageModal(null),
  'edit-coverage': (el) => coverageModal(covById(el.dataset.id)),
  'cov-status': (el) => coverageStatusModal(covById(el.dataset.id), el.dataset.status),
  'add-charge': chargeModal,
  'add-payment': (el) => paymentModal(el.dataset.charge ? +el.dataset.charge : null),
  'move-balance': (el) => moveModal({ fromValue: el.dataset.from || null, chargeId: el.dataset.charge ? +el.dataset.charge : null }),
  'edit-ledger': (el) => ledgerEditModal(S.caseData.ledger.find((l) => l.id == el.dataset.id)),
  'edit-lop': lopModal, 'edit-limits': limitsModal, 'forward-balance': forwardModal, 'ehr-upload': ehrUploadModal,
  'eob-upload': () => eobUploadModal(),
  'eob-history': () => eobUploadModal(null, { history: true }),
  'genie-jump': (el) => document.getElementById(el.dataset.to)?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
  'eob-settings-save': async () => {
    const v = document.getElementById('eg-rate').value.trim();
    if (await attempt(() => api('eob.php?action=settings', { interest_rate: v === '' ? null : +v }))) { toast('Saved'); pageEobs(document.getElementById('main')); }
  }, 'eob-upload-case': () => eobUploadModal(S.caseData.case.id), 'eob-open': (el) => eobDetailModal(+el.dataset.id),
  'archive-child': (el) => archiveChild(el.dataset.table, +el.dataset.id),
  'archive-doc': async (el) => {
    if (!await confirmBox('Remove document', 'Remove this document from the case? It is archived, not destroyed.', 'Remove')) return;
    if (await attempt(() => api('documents.php?action=archive', { id: +el.dataset.id }))) reloadCase();
  },
  'letter': (el) => (el.dataset.type === 'reduction_response' && S.caseData && !S.caseData.reductionTerms.asked ? reductionTermsModal(() => openLetter('reduction_response')) : openLetter(el.dataset.type)),
  'save-reduction-terms': async () => {
    const box = document.getElementById('red-card');
    if (await attempt(() => api('admin.php?action=reduction_terms_save', { pct: +box.querySelector('#rt-pct').value, late_pct: +box.querySelector('#rt-late').value }))) { toast('Saved'); await refreshSession(); }
  },
  'eoc-letter': () => eocLetterModal(),
  'narrative': () => narrativeModal(),
  'end-care': () => endCareModal(),
  'resume-care': async () => {
    if (!(await confirmBox('Resume care?', 'The patient is treating again: the end of care is cleared and the case goes back to treating.', 'Resume'))) return;
    const r = await attempt(() => api('cases.php?action=resume_care&id=' + S.caseData.case.id, {}));
    if (r) { S.caseData = r; renderCase(); toast('Care resumed'); }
  },
  'guide-reorder': () => { guideReorder.keys = S.caseData.guide.filter((g) => g.movable).map((g) => g.key); renderCase(); },
  'guide-reorder-cancel': () => { guideReorder.keys = null; renderCase(); },
  'guide-move': (el) => {
    const k = guideReorder.keys, i = k.indexOf(el.dataset.key), j = i + +el.dataset.d;
    if (i < 0 || j < 0 || j >= k.length) return;
    [k[i], k[j]] = [k[j], k[i]];
    renderCase();
  },
  'guide-order-save': async (el) => {
    const r = await attempt(() => api('cases.php?action=guide_order&id=' + S.caseData.case.id, { order: guideReorder.keys, scope: el.dataset.scope }));
    if (r) { guideReorder.keys = null; S.caseData = r; renderCase(); toast(el.dataset.scope === 'practice' ? 'Saved as your order for every case' : el.dataset.scope === 'reset' ? 'Back to the practice order' : 'Order saved for this case'); }
  },
  'new-task': (el) => taskModal(el.dataset.case ? +el.dataset.case : null),
  'edit-task': (el) => { const t = taskCache.get(+el.dataset.id); if (t) taskModal(t.case_id, t); },
  'task-from-alert': (el) => taskModal(+el.dataset.case, null, { title: el.dataset.text.slice(0, 200), assignees: [] }),
  'task-done': async (el) => {
    const inCase = location.hash.startsWith('#/case/');
    const done = el.checked;
    const r = await attempt(() => api('cases.php?action=task_save', { id: +el.dataset.id, done, return_case: inCase }));
    if (!r) { el.checked = !done; return; }
    toast(done ? 'Task done' : 'Task reopened');
    afterTaskChange(r, inCase);
  },
  'add-contact': () => contactModal(null),
  'edit-contact': (el) => contactModal(S.contacts.find((c) => c.id == el.dataset.id)),
  'add-user': () => userModal(null),
  'edit-user': (el) => userModal(document.getElementById('main')._users.find((u) => u.id == el.dataset.id)),
  'reset-user': async (el) => {
    const what = el.dataset.what;
    const text = { password: 'Issue a new one-time password? Their current password stops working immediately.', mfa: 'Clear their two-factor? They will scan a new QR code at next sign-in. Confirm who you are talking to first.', unlock: 'Unlock this account?' }[what];
    if (!await confirmBox('Confirm', text)) return;
    const r = await attempt(() => api('admin.php?action=user_reset', { id: +el.dataset.id, what }));
    if (!r) return;
    if (r.tempPassword) showTempPassword(r.tempPassword); else toast('Done');
    route();
  },
  'delete-ehr-format': async (el) => {
    if (!await confirmBox('Forget layout', 'Forget this layout? The next upload in this format will ask for the columns again.', 'Forget')) return;
    if (await attempt(() => api('ehr.php?action=format_delete', { id: +el.dataset.id }))) loadEhrFormats();
  },
  'audit-filter': () => {
    const main = document.getElementById('main');
    main._f = { user_id: document.getElementById('au-user').value, category: document.getElementById('au-cat').value, case_number: document.getElementById('au-case').value.trim(),
      from: document.getElementById('au-from').value, to: document.getElementById('au-to').value };
    pageAudit(main);
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.tagName === 'SELECT') return;
  // Let clicks on links/buttons inside a clickable row do their own thing.
  if (el.tagName === 'TR' && e.target.closest('a,button,input,label,select')) return;
  const fn = ACTIONS[el.dataset.act];
  if (!fn) return;
  if (el.tagName !== 'INPUT') e.preventDefault();
  fn(el);
});

// ---------- boot ----------
// A white-labelled practice's sign-in link (app.html?b=slug) brands the
// sign-in screens; it's remembered on this device for next time.
(async () => {
  let slug = new URLSearchParams(location.search).get('b');
  try { if (slug) localStorage.setItem('signinBrand', slug); else slug = localStorage.getItem('signinBrand'); } catch { /* storage unavailable */ }
  if (slug) {
    try { S.signinBrand = await api('brand.php?action=signin&b=' + encodeURIComponent(slug), undefined, { passive: true }); }
    catch { try { localStorage.removeItem('signinBrand'); } catch { /* ignore */ } }
  }
  api('auth.php?action=session').then(applySession).catch(() => showLogin('Could not reach the server.'));
})();

})();
