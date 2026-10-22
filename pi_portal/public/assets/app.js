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
  if (!res.ok) throw new Error(data?.error || 'Request failed');
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
    <a class="brand" href="./"><img src="assets/logo-horizontal.svg" alt="${esc(S.brand.name)}"><div class="small muted">${esc(S.brand.tagline || '')}</div></a>
    ${inner}</div></div>`;
}

function showLogin(message) {
  authCard(`<form data-form="login">
    <label for="li-email">Email</label><input id="li-email" type="email" autocomplete="username" required>
    <label for="li-pw">Password</label><input id="li-pw" type="password" autocomplete="current-password" required>
    <div class="err" data-role="err">${esc(message || '')}</div>
    <button class="btn" type="submit">Sign in</button>
    <p class="small">Authorized personnel only. All access to patient records is logged.</p>
    <p class="auth-switch">New practice? <a href="#signup" data-act="show-signup">Start a free trial</a></p>
  </form>`);
  document.getElementById('li-email').focus();
}

async function showSignup() {
  let plans = {}, trialDays = 14;
  try { const r = await api('auth.php?action=plans'); plans = r.plans; trialDays = r.trialDays; } catch { /* plans list is optional */ }
  const wanted = new URLSearchParams(location.hash.split('?')[1] || '').get('plan');
  authCard(`<form data-form="signup">
    <h3>Start your ${trialDays}-day free trial</h3>
    <p>No card needed. Set up your practice, then invite your team.</p>
    <div class="form-grid">
      <div class="full"><label for="su-practice">Practice name</label><input id="su-practice" required autocomplete="organization"></div>
      <div><label for="su-name">Your name</label><input id="su-name" required autocomplete="name"></div>
      <div><label for="su-email">Work email</label><input id="su-email" type="email" required autocomplete="email"></div>
      <div><label for="su-pw">Password (12+ characters)</label><input id="su-pw" type="password" required autocomplete="new-password"></div>
      <div><label for="su-plan">Plan after trial</label><select id="su-plan">${entries(plans).map(([k, p]) => opt(k, `${p.name} — $${p.price}/mo or $${p.annual_price}/yr`, wanted || 'solo')).join('')}</select></div>
    </div>
    <label class="check mt"><input type="checkbox" id="su-accept"> I agree to the <a href="legal.html#terms" target="_blank" rel="noopener">Terms of Service</a> and the <a href="legal.html#baa" target="_blank" rel="noopener">Business Associate Agreement</a> on behalf of my practice.</label>
    <div class="err" data-role="err"></div>
    <button class="btn" type="submit">Create practice account</button>
    <p class="auth-switch">Already have an account? <a href="#" data-act="show-login">Sign in</a></p>
  </form>`, true);
  document.getElementById('su-practice').focus();
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

function drawQr(canvas, text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount(), margin = 3, scale = 6, size = (n + margin * 2) * scale;
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#0B2340';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect((c + margin) * scale, (r + margin) * scale, scale, scale);
}

function applySession(s) {
  if (s.brand) S.brand = s.brand;
  document.title = S.brand.name;
  S.practice = s.practice || null;
  S.idleTimeout = s.idleTimeoutSeconds;
  if (s.step === 'signed_in') {
    S.user = s.user; S.lookups = s.lookups;
    startShell();
  } else {
    S.user = null; S.caseData = null;
    if (s.step === 'signed_out' && location.hash.startsWith('#signup')) showSignup();
    else ({ signed_out: showLogin, password_change: showPasswordChange, mfa_setup: showMfaSetup, mfa: showMfa })[s.step]?.();
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
      if (!form.querySelector('#su-accept').checked) throw new Error('Please accept the Terms and Business Associate Agreement.');
      s = await api('auth.php?action=signup', {
        practice_name: form.querySelector('#su-practice').value, name: form.querySelector('#su-name').value,
        email: form.querySelector('#su-email').value, password: form.querySelector('#su-pw').value,
        plan: form.querySelector('#su-plan').value, accept: true,
      });
      history.replaceState(null, '', location.pathname);
    } else if (kind === 'mfasetup') s = await api('auth.php?action=mfa_setup_confirm', { code: form.querySelector('#mf-code').value });
    else if (kind === 'mfa') s = await api('auth.php?action=mfa_verify', { code: form.querySelector('#mf-code').value });
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
  ['ar', 'A/R & settlements', 'fin:balances'], ['contacts', 'Contacts', 'case.read'], ['playbook', 'PI playbook', 'case.read'],
  ['admin', 'Users', 'users.manage'], ['settings', 'Practice settings', 'users.manage'], ['billing', 'Plan & billing', 'users.manage'],
  ['audit', 'Audit log', 'audit.read'], ['platform', 'Practices', 'platform.manage'],
];

// ---------- locations & providers ----------
// Location filter for the case list, dashboard, huddle and A/R (a per-
// browser preference; people limited to one location are filtered by the
// server regardless). Shown when the practice has more than one location.
const multiLocation = () => (S.lookups?.locations || []).length > 1;
const locationName = (id) => (S.lookups?.locations || []).find((l) => +l.id === +id)?.name || '';
function locFilter() {
  if (!multiLocation() || S.user?.locationRestricted) return '';
  let v = null;
  try { v = localStorage.getItem('ic.loc'); } catch { /* storage unavailable */ }
  if (v === null) v = S.user?.locationId ? String(S.user.locationId) : '';
  return v;
}
function setLocFilter(v) { try { localStorage.setItem('ic.loc', v); } catch { /* storage unavailable */ } }
const locQS = () => { const l = locFilter(); return l ? '&location=' + encodeURIComponent(l) : ''; };

// Nav items that are plan features.
const NAV_FEATURE = { huddle: 'huddle' };

// Trial / subscription / BAA notices shown above every page.
function bannerHtml() {
  const p = S.practice;
  if (!p) return '';
  const admin = can('users.manage');
  const cta = admin ? ' <a href="#/billing">Choose a plan</a>' : ' Ask your practice admin.';
  if (p.access === 'read_only') return `<div class="banner danger">Your ${p.status === 'trialing' ? 'free trial has ended' : 'subscription has ended'}. Records are read-only.${cta}</div>`;
  if (p.status === 'past_due') return `<div class="banner warn">Your last payment didn't go through.${admin ? ' <a href="#/billing">Update billing</a>' : ''}</div>`;
  if (admin && !p.baaCurrent) return `<div class="banner warn">Please review and accept the current Business Associate Agreement. <a href="#/settings">Practice settings</a></div>`;
  if (p.status === 'trialing') {
    const extras = (p.trialExtras || []).map((f) => featureInfo(f));
    return `<div class="banner info">${p.trialDaysLeft} day${p.trialDaysLeft === 1 ? '' : 's'} left in your free trial.${extras.length ? ` Your trial includes every feature — ${esc(extras.map((x) => `${x.name} (${x.planName})`).join(', '))} ${extras.length === 1 ? 'needs' : 'need'} a higher plan than ${esc(p.planName)} after the trial.` : ''}${admin ? ' <a href="#/billing">Choose a plan</a>' : ''}</div>`;
  }
  return '';
}

async function refreshSession() {
  const s = await attempt(() => api('auth.php?action=session'));
  if (s && s.step === 'signed_in') { S.practice = s.practice; S.lookups = s.lookups; const b = document.getElementById('banner'); if (b) b.innerHTML = bannerHtml(); }
}

async function startShell() {
  const operator = S.user.operator;
  $app.innerHTML = `<div class="shell">
    <nav class="sidebar" aria-label="Main">
      <div class="brand"><img src="assets/logo-horizontal-dark.svg" alt="${esc(S.brand.name)}"><small>${esc(operator ? 'Operator console' : S.practice.name)}</small></div>
      ${!operator && multiLocation() ? (S.user.locationRestricted ? `<div class="loc-switch small">${esc(locationName(S.user.locationId))}</div>`
        : `<select class="loc-switch" id="loc-switch" aria-label="Location">${opt('', 'All locations', locFilter())}${S.lookups.locations.map((l) => opt(l.id, l.name, locFilter())).join('')}</select>`) : ''}
      ${NAV.filter(([, , p]) => can(p)).map(([k, t]) => `<a href="#/${k}" data-nav="${k}">${esc(t)}${k === 'tasks' ? ' <span class="nav-badge" id="task-badge" hidden></span>' : ''}${NAV_FEATURE[k] && !operator && !hasFeature(NAV_FEATURE[k]) ? ` <span class="nav-lock" title="${esc(featureInfo(NAV_FEATURE[k]).planName)} plan">${esc(featureInfo(NAV_FEATURE[k]).planName)}</span>` : ''}</a>`).join('')}
      <div class="who"><div><strong>${esc(S.user.name)}</strong><br><span class="muted-light">${esc(S.user.role)}</span></div>
        <button class="btn ghost sm" data-act="change-password">Change password</button>
        ${operator || !hasFeature('email_digest') ? '' : '<button class="btn ghost sm" data-act="my-notify">Email notifications</button>'}
        ${operator ? '' : '<button class="btn ghost sm" data-act="suggest">Suggest a feature</button>'}
        <button class="btn ghost sm" data-act="sign-out">Sign out</button></div>
    </nav>
    <div class="main-col"><div id="banner">${bannerHtml()}</div><main class="main" id="main"></main></div>
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
  const parts = (location.hash.replace(/^#\/?/, '').split('?')[0] || (S.user.operator ? 'platform' : 'dashboard')).split('/');
  const page = parts[0];
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === page || (page === 'case' && a.dataset.nav === 'cases')));
  const main = document.getElementById('main');
  if (!main) return;
  main.innerHTML = '<div class="empty">Loading…</div>';
  window.scrollTo(0, 0);
  const pages = { dashboard: pageDashboard, cases: pageCases, case: pageCase, tasks: pageTasks, ar: pageAR, contacts: pageContacts, admin: pageAdmin, audit: pageAudit,
    settings: pageSettings, billing: pageBilling, platform: pagePlatform, playbook: pagePlaybook, huddle: pageHuddle };
  (pages[page] || (S.user.operator ? pagePlatform : pageDashboard))(main, parts.slice(1));
  if (!S.user.operator) refreshTaskBadge();
}

const phiBanner = '<div class="phi-banner">Contains protected health information · access is logged</div>';

// ---------- dashboard ----------
async function pageDashboard(main) {
  const d = await attempt(() => api('cases.php?action=dashboard' + locQS()));
  if (!d) return;
  const ac = d.alertCounts || {};
  main.innerHTML = `${phiBanner}
    <div class="page-head"><div><h1>Dashboard</h1><div class="sub">${esc(new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }))}</div></div>
      <span class="spacer"></span>${can('case.write') ? '<button class="btn" data-act="new-case">+ New case</button>' : ''}</div>
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
    </div>`;
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
    ${d.tips.length > 8 ? `<p class="small muted">${d.tips.length - 8} more — open a case to see its suggestions.</p>` : ''}</div>`;
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
      <div class="small muted">${when} · <span title="Assigned to">${esc(assigneeText(t))}</span>${showCase && t.case_id ? ` · <a href="#/case/${t.case_id}">${esc(t.patient)}</a>` : ''}${t.created_by_name && t.created_by != S.user.id ? ' · from ' + esc(t.created_by_name) : ''}</div></div></li>`;
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
    <label class="check"><input type="checkbox" id="mn-on"${r.digest ? ' checked' : ''}> Send me a daily digest${r.weekdaysOnly ? ' on weekday mornings' : ' each morning'} at ${esc(r.email)}</label>
    <p class="small muted mt">The email lists how many items need attention under each heading below, with a link to the Daily huddle. It never contains patient names or case details. No email is sent on a day with nothing to report.</p>
    ${r.mailReady ? '' : '<div class="notice">Email sending isn\'t set up on this server yet — your choice is saved for when it is.</div>'}
    <h3 class="mt">Include</h3>
    <div class="mt">${Object.entries(r.available).map(([k, t]) => `<label class="check"><input type="checkbox" data-mn="${k}"${r.criteria.includes(k) ? ' checked' : ''}> ${esc(t)}</label>`).join('') || '<p class="small muted">Your practice hasn\'t turned any criteria on.</p>'}</div>`,
    onOk: async (el) => {
      await api('admin.php?action=my_notify_save', { digest: el.querySelector('#mn-on').checked, criteria: [...el.querySelectorAll('[data-mn]:checked')].map((x) => x.dataset.mn) });
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
  { n: 'dob', l: 'Date of birth', t: 'date' }, { n: 'phone', l: 'Phone', t: 'tel' },
  { n: 'email', l: 'Email', t: 'email' }, { n: 'address', l: 'Address', full: true },
];
const caseDefs = () => [
  { n: 'injury_type', l: 'Case type', t: 'select', blank: false, opts: entries(S.lookups.injuryTypes) },
  { n: 'date_of_injury', l: 'Date of injury (DOI)', t: 'date' },
  { n: 'first_visit', l: 'First visit', t: 'date' },
  { n: 'referral_source', l: 'Referral source', t: 'select', opts: [['attorney', 'Attorney'], ['self', 'Self'], ['provider', 'Another provider'], ['other', 'Other']] },
  { n: 'referred_by_contact_id', l: 'Referred by (contact)', t: 'contact' },
  { n: 'referred_by_text', l: 'Referred by (other)', ph: 'e.g. friend, Google' },
  { n: 'attorney_contact_id', l: 'Attorney', t: 'contact', ctype: ['attorney'] },
  { n: 'paralegal', l: 'Paralegal (name, phone / email)', ph: 'e.g. Maria — 305-555-0100' },
  { n: 'provider_user_id', l: 'Treating provider', t: 'user' },
  ...((S.lookups.locations || []).length && !S.user.locationRestricted ? [{ n: 'location_id', l: 'Location', t: 'select', blank: '—', opts: S.lookups.locations.map((l) => [l.id, l.name]) }] : []),
  { n: 'head_injury', l: 'Head injury? (hit head, lost consciousness, concussion symptoms)', t: 'select', blank: false, opts: HEAD_INJURY_OPTS },
];

const HEAD_INJURY_OPTS = [['unknown', 'Not asked yet'], ['yes', 'Yes'], ['no', 'No']];
// Insurance on the new-case form: the usual first payer for the case type.
const NEW_COVERAGE_DEFS = () => [
  { n: 'cov_type', l: 'Insurance', t: 'select', blank: 'None — patient balance / LOP', opts: entries(S.lookups.coverageTypes) },
  { n: 'cov_carrier', l: 'Carrier (from contacts)', t: 'contact', ctype: ['insurer'] },
  { n: 'cov_carrier_text', l: 'Carrier (if not in contacts)' },
  { n: 'cov_claim', l: 'Claim #' }, { n: 'cov_policy', l: 'Policy / member #' }, { n: 'cov_adjuster', l: 'Adjuster' },
  { n: 'cov_auth', l: "Authorized visits (workers' comp)", t: 'number' },
];
const DEFAULT_COVERAGE = { auto: 'pip', slip_fall: '', workers_comp: 'workers_comp' };
function newCaseModal() {
  const m = openModal({
    title: 'New PI case', wide: true, okText: 'Create case',
    body: `<h3>Patient</h3>${fieldsHtml(PATIENT_DEFS)}<h3 class="mt">Case</h3>${fieldsHtml(caseDefs(), { injury_type: 'auto' })}
      <h3 class="mt">Insurance</h3>${fieldsHtml(NEW_COVERAGE_DEFS(), { cov_type: 'pip' })}
      <p class="small muted mt">Bill insurance first if the patient has it. More coverage (e.g. health insurance) can be added under Financials. Need a new attorney or insurer? Add them under Contacts first.</p>`,
    onOk: async (el) => {
      const cv = readFields(el, NEW_COVERAGE_DEFS());
      const coverage = cv.cov_type ? { type: cv.cov_type, carrier_contact_id: cv.cov_carrier, carrier_text: cv.cov_carrier_text, claim_number: cv.cov_claim,
        policy_number: cv.cov_policy, adjuster: cv.cov_adjuster, authorized_visits: cv.cov_auth } : null;
      const r = await api('cases.php?action=create', { patient: readFields(el, PATIENT_DEFS), case: readFields(el, caseDefs()), coverage });
      toast('Case ' + r.caseNumber + ' created');
      location.hash = '#/case/' + r.id;
    },
  });
  m.el.querySelector('[name=injury_type]').addEventListener('change', (e) => { m.el.querySelector('[name=cov_type]').value = DEFAULT_COVERAGE[e.target.value] ?? ''; });
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
  const tabs = CASE_TABS.filter(([, , perm]) => !perm || can(perm));
  if (!tabs.find(([k]) => k === S.caseTab)) S.caseTab = 'overview';
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
        <span class="chip ${c.emc_status === 'yes' ? 'teal' : c.emc_status === 'no' ? 'red' : 'ochre'}">EMC: ${esc(c.emc_status)}</span>
        ${c.actively_treating == 1 ? '<span class="chip teal">Actively treating</span>' : ''}
        <span class="small muted">DOI ${esc(fmtDate(c.date_of_injury))} · ${d.stats.visitCount} visits · last ${esc(fmtDate(d.stats.lastVisit))}${atty ? ' · ' + esc(contactName(atty)) : ''}</span>
      </div></div>
      <span class="spacer"></span>
      <div><label for="case-stage">Stage</label><select id="case-stage" data-act-change="stage"${can('case.write') || can('finance.write') ? '' : ' disabled'}>${entries(S.lookups.stages).map(([k, t]) => opt(k, t, c.stage)).join('')}</select></div>
    </div>
    ${d.alerts.length ? `<div class="alert-box"><ul class="alerts">${d.alerts.map((a) => `<li class="${esc(a.level)}"><span class="dot"></span><div class="grow">${esc(a.text)}</div><button class="btn ghost sm" data-act="task-from-alert" data-case="${c.id}" data-text="${esc(a.text)}" title="Make this a task for someone">+ Task</button></li>`).join('')}</ul></div>` : ''}
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
  el.innerHTML = `${outreachCardHtml(d)}${guideCardHtml(d)}${tipsCardHtml(d)}<div class="grid-2">
    <div class="card"><div class="card-head"><h2>Case</h2><span class="spacer"></span>${can('case.write') ? '<button class="btn ghost sm" data-act="edit-case">Edit</button>' : ''}</div>
      <dl class="kv">
        ${row('Case type', label('injuryTypes', c.injury_type))}
        ${row('Date of injury', fmtDate(c.date_of_injury))}${row('First visit', fmtDate(c.first_visit))}
        ${c.mmi_date ? row('MMI', fmtDate(c.mmi_date) + (c.maintenance_every_days && !c.discharge_date ? ' · maintenance ' + maintenanceLabel(+c.maintenance_every_days) : '')) : ''}${row('Discharged', fmtDate(c.discharge_date))}
        ${row('Treating provider', provider?.name)}${c.location_id ? row('Location', locationName(c.location_id)) : ''}
        ${row('Referral source', c.referral_source)}${contactRow('Referred by', k.referred_by_contact_id)}${c.referred_by_text ? row('Referred by (note)', c.referred_by_text) : ''}
        ${contactRow('Attorney', k.attorney_contact_id)}${c.paralegal ? row('Paralegal', c.paralegal) : ''}
        <dt>Insurance</dt><dd>${(d.coverages || []).length ? d.coverages.map((cv) => `<div>${esc(label('coverageTypes', cv.type))}${cv.carrier_org || cv.carrier_text ? ' — ' + esc(cv.carrier_org || cv.carrier_text) : ''} <span class="chip ${cv.status === 'active' ? 'teal' : 'na'}">${esc(label('coverageStatus', cv.status))}</span>${cv.claim_number ? `<div class="small muted">Claim # ${esc(cv.claim_number)}</div>` : ''}</div>`).join('') : '<span class="muted">None — patient balance / LOP</span>'}</dd>
        <dt>Policy limits</dt><dd>${c.bi_limit || c.um_limit ? `${c.bi_limit ? 'At-fault BI ' + esc(money(c.bi_limit)) : ''}${c.bi_limit && c.um_limit ? ' · ' : ''}${c.um_limit ? 'UM ' + esc(money(c.um_limit)) : ''}${c.limits_source ? `<div class="small muted">${esc(c.limits_source)}${c.limits_noted_on ? ' · ' + esc(fmtDate(c.limits_noted_on)) : ''}</div>` : ''}` : '<span class="muted">Not known yet — ask the attorney</span>'}
          ${can('case.write') || can('finance.write') ? ' <button class="linklike small" data-act="edit-limits">Edit</button>' : ''}</dd>
        ${row('Bills go to', label('benefits', c.benefits))}${c.injury_type === 'auto' ? row('EMC determination', c.emc_status) : ''}
        ${row('LOP signed', c.lop_signed_on ? fmtDate(c.lop_signed_on) + (c.lop_acknowledged_on ? ' · firm acknowledged ' + fmtDate(c.lop_acknowledged_on) : ' · not countersigned') : '')}
        ${row('Actively treating', c.actively_treating == 1 ? 'Yes' : 'No')}
        ${row('Treatment plan', c.plan_visits_per_week ? `${+c.plan_visits_per_week}x/week${c.plan_set_on ? ' since ' + fmtDate(c.plan_set_on) : ''}` : '')}
        ${row('Head injury', Object.fromEntries(HEAD_INJURY_OPTS)[c.head_injury])}
      </dl></div>
    <div>
      <div class="card"><div class="card-head"><h2>Patient</h2><span class="spacer"></span>${can('case.write') ? '<button class="btn ghost sm" data-act="edit-patient">Edit</button>' : ''}</div>
        <dl class="kv">${row('Name', [p.first_name, p.last_name].join(' '))}${row('Date of birth', fmtDate(p.dob))}${row('Phone', p.phone)}${row('Email', p.email)}${row('Address', p.address)}</dl></div>
      <div class="card"><div class="card-head"><h2>Case notes</h2><span class="spacer"></span>${can('case.write') ? '<button class="btn ghost sm" data-act="edit-notes">Edit</button>' : ''}</div>
        <div class="small prewrap">${c.notes ? esc(c.notes) : '<span class="muted">No notes.</span>'}</div></div>
      <div class="card"><div class="card-head"><h2>Letters</h2></div>
        <div class="filters"><button class="btn ghost sm" data-act="letter" data-type="status_request">Status update request</button>
        <button class="btn ghost sm" data-act="letter" data-type="attendance">Scheduling help (attendance)</button>
        ${can('export') || can('case.write') ? '<button class="btn ghost sm" data-act="export-file">Export patient file</button>' : ''}
        ${fin('balances') ? '<button class="btn ghost sm" data-act="letter" data-type="tx_complete">Treatment complete</button>' : ''}
        ${fin('settlement') ? '<button class="btn ghost sm" data-act="letter" data-type="reduction_response">Reduction response</button>' : ''}</div>
        <p class="small muted">Opens a printable letter addressed to the attorney of record. Log it under Correspondence once sent.</p></div>
    </div></div>`;
}

function editCaseModal() {
  const d = S.caseData, c = d.case;
  const defs = [...caseDefs(), { n: 'discharge_date', l: 'Discharge date', t: 'date' },
    { n: 'emc_status', l: 'EMC determination', t: 'select', blank: false, opts: [['pending', 'Pending'], ['yes', 'Yes — EMC exists'], ['no', 'No EMC']] },
    { n: 'plan_visits_per_week', l: 'Treatment plan: visits per week', t: 'select', blank: 'Not set', opts: [['1', '1x/week'], ['1.5', '1–2x/week'], ['2', '2x/week'], ['2.5', '2–3x/week'], ['3', '3x/week'], ['4', '4x/week'], ['5', '5x/week']] },
    { n: 'plan_set_on', l: 'Plan in effect since', t: 'date' },
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
  openModal({ title: 'Edit patient', body: fieldsHtml(PATIENT_DEFS, d.patient), onOk: async (el) => {
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
const STATUS_TEXT = { done: 'Done', na: 'N/A', overdue: 'Overdue', due: 'Due soon', upcoming: 'Upcoming', waiting: 'Not yet' };
function tabChecklist(el, d) {
  const groups = {};
  d.checklist.forEach((i) => (groups[i.group] = groups[i.group] || []).push(i));
  const editable = can('case.write');
  el.innerHTML = `<div class="card">
    <p class="small muted">Deadlines follow the office protocol: intake items within 48 hours of the first visit, MRI within 10 days, EMC referral within 21 days, consults within 45 days. Imaging and consult items tick themselves off from the Co-management tab.</p>
    ${entries(groups).map(([g, items]) => `<div class="checklist-group"><h3>${esc(g)}</h3>${items.map((i) => `
      <div class="check-row" data-key="${esc(i.key)}">
        <div class="lbl">${esc(i.label)}${i.due ? `<small>Due ${esc(fmtDate(i.due))}${i.note ? ' · ' + esc(i.note) : ''}</small>` : (i.note ? `<small>${esc(i.note)}</small>` : '')}</div>
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
function guideCardHtml(d) {
  if (!d.guide) return '';
  const w = can('case.write'), cw = can('clinical.write');
  const open = d.guide.filter((g) => ['now', 'consider', 'ask'].includes(g.status)).length;
  return `<div class="card guide"><div class="card-head"><h2>Next steps</h2>
      <span class="small muted">${open ? `${open} need${open === 1 ? 's' : ''} attention` : 'On track'}</span><span class="spacer"></span><a class="small" href="#/playbook">How PI cases work</a></div>
    <ol class="guide-steps">${d.guide.map((g) => {
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
      if (['now', 'consider', 'ask'].includes(g.status) && w) act.push(`<button class="btn ghost sm" data-act="guide-snooze" data-step="${g.key}">Remind me later</button>`);
      if (openish && g.kind !== 'visit' && w) act.push(`<button class="btn ghost sm" data-act="guide-dismiss" data-step="${g.key}">Not needed…</button>`);
      if (['dismissed', 'snoozed'].includes(g.status) && w) act.push(`<button class="btn ghost sm" data-act="guide-clear" data-step="${g.key}">Undo</button>`);
      if (g.key === 'neuro' && g.status === 'na' && d.case.head_injury === 'no' && w) act.push(`<button class="btn ghost sm" data-act="head-injury" data-v="unknown">Change answer</button>`);
      if (['now', 'consider'].includes(g.status)) act.push(`<button class="btn ghost sm" data-act="task-from-alert" data-case="${d.case.id}" data-text="${esc(g.title + ': ' + g.text)}">+ Task</button>`);
      return `<li class="gs-${esc(g.status)}"><div class="gs-head"><span class="chip ${cls}">${txt}</span> <strong>${esc(g.title)}</strong> <span class="small muted">${esc(g.when)}</span></div>
        <div class="gs-body">${g.text ? `<div>${esc(g.text)}</div>` : ''}
          ${g.referrals.map(refProgressHtml).join('')}
          <details class="small"><summary>Why this matters</summary><p class="muted">${esc(g.why)}</p></details>
          ${act.length ? `<div class="filters gs-actions">${act.join('')}</div>` : ''}</div></li>`;
    }).join('')}</ol>
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
    }).join('')}</ul></div>`;
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
  const r = await attempt(() => api('cases.php?action=playbook'));
  if (!r) return;
  const groups = {};
  r.checklist.forEach((i) => (groups[i.group] = groups[i.group] || []).push(i));
  const types = (cs) => cs.length === 3 ? 'All cases' : cs.map((c) => label('injuryTypes', c)).join(', ');
  main.innerHTML = `<div class="page-head"><div><h1>PI playbook</h1><div class="sub">How a personal injury case runs, and the timelines ${esc(S.brand.name)} keeps you on. Every case shows these as next steps, checklist items and alerts.</div></div></div>
    <div class="card"><h2>Care timeline</h2>
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
        <dt>At MMI</dt><dd>If symptoms or impairment remain, ask the treating specialist for a permanency opinion and impairment rating. In Florida auto cases, non-economic damages generally require a permanent injury.</dd>
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
  ...(multiLocation() && !S.user.locationRestricted ? [{ n: 'location_id', l: 'Location', t: 'select', blank: 'Case location', opts: S.lookups.locations.map((l) => [l.id, l.name]) }] : []),
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
    const limit = cv.type === 'pip' ? `<div class="small">Limit ${money(cv.benefit_limit ?? 10000)}${c.emc_status !== 'yes' ? ` · ${money(c.pip_effective_limit)} without EMC` : ''}</div>` : '';
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
      <button class="btn ghost sm" data-act="move-balance">Move balance…</button>` : ''}<button class="btn ghost sm" data-act="ehr-upload">Upload EHR ledger</button><span class="spacer"></span>
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
          <div class="money-row"><span>Balance forwarded to attorney</span><strong>${c.balance_forwarded_on ? esc(fmtDate(c.balance_forwarded_on)) + (showSet ? ' · ' + money(c.balance_forwarded_amount) : '') : '—'}</strong></div>
          ${showSet ? `<div class="money-row"><span>${Math.round(S.lookups.reductionFloorPct * 100)}% floor (of patient balance)</span><strong>${money(t.reduction_floor)}</strong></div>
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
    </div>` : ''}`;
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
  { n: 'benefit_limit', l: 'Benefit limit ($) — PIP is usually 10,000', t: 'money' },
  { n: 'remaining_reported', l: 'Remaining per carrier ($) — from the adjuster / PIP payout log', t: 'money' },
  { n: 'remaining_reported_on', l: 'Remaining as of', t: 'date' },
  { n: 'authorized_visits', l: "Authorized visits (workers' comp)", t: 'number' },
  { n: 'authorized_through', l: "Authorized through (workers' comp)", t: 'date' },
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
      replace_manual: !!el.querySelector('#ehr-manual')?.checked, save_file: !!el.querySelector('#ehr-save')?.checked,
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
      ${pv.hasFile ? `<label class="check"><input type="checkbox" id="ehr-save"> Also save the ${fileWord} to this case's documents <span class="small muted">(EHR exports often include demographics such as SSN)</span></label>` : ''}
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
  { n: 'other_medical_estimate', l: "Other providers' bills, estimate ($)", t: 'money', ph: 'ER, imaging, specialists' },
  { n: 'limits_source', l: 'Where this came from', ph: 'e.g. Attorney call — Jane, Smith Law' },
  { n: 'limits_noted_on', l: 'As of', t: 'date' },
];
function limitsModal() {
  const c = S.caseData.case;
  openModal({ title: 'Policy limits', wide: true, okText: 'Save',
    body: `<p class="small">The attorney usually knows the at-fault driver's limits by the first call. These are the money that will pay the claim — medical bills, the attorney's fee and the patient's recovery all come out of them.</p>${fieldsHtml(LIMIT_DEFS, { limits_noted_on: today(), ...Object.fromEntries(LIMIT_DEFS.map((f) => [f.n, c[f.n] ?? (f.n === 'limits_noted_on' ? today() : '')])) })}`,
    onOk: async (el) => { S.caseData = await api('cases.php?action=update&id=' + c.id, { case: readFields(el, LIMIT_DEFS) }); renderCase(); toast('Policy limits saved'); } });
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
  return `<div class="card case-value"><h2>Policy limits &amp; case value</h2>${pipHtml}${limHtml}</div>`;
}

// ----- LOP, forwarding, settlement -----
function lopModal() {
  const c = S.caseData.case;
  const defs = [
    ...(can('case.write') ? [{ n: 'lop_signed_on', l: 'LOP signed by patient on', t: 'date' }, { n: 'lop_acknowledged_on', l: 'Acknowledged by law firm on (blank if not countersigned)', t: 'date' }] : []),
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
function tabDocuments(el, d) {
  const canUpload = can('case.write') || can('finance.write');
  el.innerHTML = `<div class="card"><div class="card-head"><h2>Documents</h2></div>
    ${canUpload ? `<div class="filters"><select id="doc-cat" aria-label="Category">${DOC_CATS.map(([k, t]) => opt(k, t)).join('')}</select>
      <input type="file" id="doc-file" accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff,.heic,.doc,.docx,.txt" aria-label="File">
      <button class="btn sm" data-act="upload-doc">Upload</button></div>
      <p class="small muted">Files are encrypted on the server. PDF, image, Word or text; 25 MB max.</p>` : ''}
    ${d.documents.length ? `<div class="table-wrap"><table><thead><tr><th>File</th><th>Category</th><th>Uploaded</th><th class="num">Size</th><th></th></tr></thead><tbody>
    ${d.documents.map((x) => `<tr><td>${esc(x.original_name)}</td><td>${esc(Object.fromEntries(DOC_CATS)[x.category])}</td>
      <td class="small">${esc(fmtDate(x.uploaded_at))} · ${esc(x.uploaded_by_name || '')}</td><td class="num small">${Math.max(1, Math.round(x.size_bytes / 1024))} KB</td>
      <td class="nowrap"><a class="btn ghost sm" href="api/documents.php?action=download&id=${x.id}&inline=1" target="_blank" rel="noopener">View</a>
        <a class="btn ghost sm" href="api/documents.php?action=download&id=${x.id}">Download</a>
        ${can('case.write') ? `<button class="btn link small" data-act="archive-doc" data-id="${x.id}">Remove</button>` : ''}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="empty">No documents uploaded.</div>'}
  </div>`;
}

async function uploadDoc() {
  const file = document.getElementById('doc-file').files[0];
  if (!file) { toast('Choose a file first.', true); return; }
  const fd = new FormData();
  fd.append('case_id', S.caseData.case.id);
  fd.append('category', document.getElementById('doc-cat').value);
  fd.append('file', file);
  const r = await attempt(() => api('documents.php?action=upload', fd));
  if (r) { toast('Uploaded'); await reloadCase(); }
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
  const t = task || { title: prefill.title || '', notes: '', due_on: prefill.due_on || '', priority: 'normal', assignees: prefill.assignees || [{ id: S.user.id }] };
  const defs = [{ n: 'title', l: 'Task', req: true, full: true }, { n: 'notes', l: 'Notes', t: 'textarea', rows: 2 }, { n: 'due_on', l: 'Due', t: 'date' },
    { n: 'priority', l: 'Priority', t: 'select', blank: false, opts: [['normal', 'Normal'], ['high', 'High']] }];
  const chosen = new Set(t.assignees.map((a) => +a.id));
  const team = S.lookups.users || [];
  const body = fieldsHtml(defs, t) + `<fieldset class="assignees mt"><legend>Assign to <span class="small muted">— one or more people; leave all unticked for anyone</span></legend>
      <div class="assignee-list">${team.map((u) => `<label class="check"><input type="checkbox" data-assignee="${u.id}"${chosen.has(+u.id) ? ' checked' : ''}> ${esc(u.name)}${u.id == S.user.id ? ' <span class="small muted">(you)</span>' : ''}</label>`).join('')}</div></fieldset>
    ${task ? `<p class="small muted mt">${task.case_id ? `Case: <a href="#/case/${task.case_id}">${esc(task.patient)}</a> · ` : ''}Created by ${esc(task.created_by_name || '—')} on ${esc(fmtDate(task.created_at))}</p>` : ''}`;
  const canDelete = task && (task.created_by == S.user.id || can('users.manage'));
  const caseOf = task ? task.case_id : caseId;
  const inCase = () => !!caseOf && location.hash.startsWith('#/case/' + caseOf);
  const m = openModal({ title: task ? 'Edit task' : 'New task', body, okText: task ? 'Save' : 'Add task',
    extraButtons: canDelete ? '<button class="btn danger" data-del>Delete</button>' : '',
    onOk: async (el) => {
      const v = readFields(el, defs);
      v.assignee_ids = [...el.querySelectorAll('[data-assignee]:checked')].map((x) => +x.dataset.assignee);
      const r = await api('cases.php?action=task_save', { ...v, ...(task ? { id: task.id } : { case_id: caseId || null }), return_case: inCase() });
      afterTaskChange(r, inCase());
      toast(task ? 'Task saved' : 'Task added');
    } });
  m.el.querySelector('[data-del]')?.addEventListener('click', async () => {
    if (!await confirmBox('Delete task', `Delete “${task.title}”? It stays in the activity history.`, 'Delete')) return;
    if (await attempt(() => api('cases.php?action=task_delete', { id: task.id }))) { m.close(); afterTaskChange(null, false); toast('Task deleted'); }
  });
}

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
  reset_mfa: 'reset two-factor for', reset_unlock: 'unlocked', reset_badge: 'issued new website badge links for', accept_baa: 'accepted the Business Associate Agreement', signup: 'signed the practice up',
  billing_checkout: 'started a plan checkout', billing_portal: 'opened billing', platform_update: 'changed the plan for',
};
const AUDIT_THINGS = {
  case: 'the case', visits: 'a visit', referrals: 'a co-management referral', coverages: 'insurance coverage', outcomes: 'an outcome assessment',
  correspondence: 'a correspondence entry', outreach: 'an outreach attempt', ledger: 'a ledger entry', task: 'task', milestone: 'checklist item', document: 'a document', contact: 'contact',
  user: 'user', location: 'location', feedback: 'feature suggestion', practice: 'practice settings', ehr_format: 'EHR spreadsheet layout', dashboard: 'the dashboard', ar_report: 'the A/R report',
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
  guide_mri: 'MRI referral', guide_ortho: 'Ortho referral', guide_pain_mgmt: 'Pain management referral', guide_neuro: 'Neurology referral', guide_emc: 'EMC determination', guide_reexam: 'Re-exam', mmi_date: 'MMI', maintenance_every_days: 'Maintenance every (days)', badge: 'Website badge shown',
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
  if (['list', 'login', 'logout', 'login_password_ok', 'login_failed', 'login_locked', 'mfa_failed', 'mfa_enrolled', 'password_changed', 'session_timeout', 'accept_baa', 'forward_balance', 'ehr_import', 'ehr_preview', 'signup', 'billing_checkout', 'billing_portal'].includes(e.action)) thing = '';
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
async function pageTasks(main) {
  const st = taskState;
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

// ---------- A/R ----------
let arState = { all: false, sort: 'patient', dir: 1 };
async function pageAR(main) {
  const r = await attempt(() => api('cases.php?action=ar_report' + (arState.all ? '&all=1' : '') + locQS()));
  if (!r) return;
  const rows = r.rows;
  const { sort, dir } = arState;
  rows.sort((a, b) => { const x = a[sort] ?? '', y = b[sort] ?? ''; return (typeof x === 'number' || typeof y === 'number' ? (+x || 0) - (+y || 0) : String(x).localeCompare(String(y))) * dir; });
  const cols = [['patient', 'Patient'], ['benefits', 'Benefits'], ['stage', 'Status'], ['lastVisit', 'Last visit'], ['lastCorrespondence', 'Last contact'], ['attorney', 'Attorney'],
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
        <td class="nowrap">${esc(fmtDate(x.lastVisit))}</td>
        <td class="nowrap">${x.lastCorrespondence ? `<span class="${daysSince(x.lastCorrespondence) > 30 ? 'trend-up' : ''}">${esc(fmtDate(x.lastCorrespondence))}</span>` : '<span class="trend-up">never</span>'}</td>
        <td class="small">${esc(x.attorney || '—')}</td>
        <td class="num">${money(x.insuranceBalance)}</td><td class="num">${money(x.patientBalance)}</td><td class="num"><strong>${money(x.totalBalance)}</strong></td>
        <td class="nowrap small">${x.forwardedOn ? esc(fmtDate(x.forwardedOn)) : (x.lopSigned ? 'LOP ' + esc(fmtDate(x.lopSigned)) : '—')}</td>
        <td class="num">${money(x.reductionFloor)}</td><td class="num">${x.attyOffer !== null ? money(x.attyOffer) + `<div class="small muted">${x.offerPct}%</div>` : '—'}</td>
        <td class="num">${money(x.finalSettlement)}</td><td class="nowrap">${esc(fmtDate(x.checkReceived))}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="6">Totals</td><td class="num">${money(r.totals.insurance)}</td><td class="num">${money(r.totals.patient)}</td><td class="num">${money(r.totals.total)}</td><td colspan="5"></td></tr></tfoot></table></div></div>`;
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
    <div class="card"><div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Financials</th><th>Status</th><th>2FA</th><th>Last sign-in</th><th></th></tr></thead><tbody>
    ${r.users.map((u) => `<tr><td><strong>${esc(u.name)}</strong></td><td>${esc(u.email)}</td><td><span class="chip">${esc(u.role)}</span></td>
      <td class="small">${u.role !== 'staff' ? 'All' : u.finance_access == 1 ? '<span class="chip teal">All (granted)</span>' : '<a href="#/settings">Staff setting</a>'}</td>
      <td>${u.active == 1 ? (u.locked_until && u.locked_until > new Date().toISOString().slice(0, 19).replace('T', ' ') ? '<span class="chip red">Locked</span>' : '<span class="chip teal">Active</span>') : '<span class="chip na">Disabled</span>'}${u.must_change_password == 1 ? ' <span class="chip ochre">Temp password</span>' : ''}</td>
      <td>${u.totp_enabled == 1 ? '✓' : '<span class="muted">not set up</span>'}</td><td class="small">${esc(u.last_login_at || 'never')}</td>
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
      { n: 'location_restricted', l: "Only see this location's patients", t: 'check' }] : []),
    ...(existing ? [{ n: 'active', l: 'Active', t: 'check' }] : [])];
  openModal({ title: existing ? 'Edit user' : 'Add user', body: fieldsHtml(defs, existing || { role: 'staff', notify_digest: 0 }), onOk: async (el) => {
    const r = await api('admin.php?action=user_save', { ...readFields(el, defs), ...(existing ? { id: existing.id } : {}) });
    if (r.tempPassword) showTempPassword(r.tempPassword);
    route();
  } });
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
const PRACTICE_DEFS = [{ n: 'name', l: 'Practice name', req: true, full: true }, { n: 'address', l: 'Address (letterhead)', t: 'textarea', rows: 2 },
  { n: 'phone', l: 'Phone' }, { n: 'fax', l: 'Fax' }, { n: 'state', l: 'State', ph: 'FL' }, { n: 'ehr_name', l: 'Your EHR / EMR', ph: 'e.g. ChiroTouch, Jane, ECLIPSE' }];
async function pageSettings(main) {
  const r = await attempt(() => api('admin.php?action=practice'));
  if (!r) return;
  const p = r.practice, baaOk = p.baaVersion === p.currentBaaVersion;
  main.innerHTML = `<div class="page-head"><div><h1>Practice settings</h1><div class="sub">Your letterhead appears on every letter generated for attorneys.</div></div></div>
    <div class="grid-2"><div class="card"><h2>Practice details</h2><div id="practice-form">${fieldsHtml(PRACTICE_DEFS, p)}</div>
      <div class="err" id="practice-err"></div><button class="btn mt" data-act="save-practice">Save</button></div>
    <div class="card"><h2>Business Associate Agreement</h2>
      <p class="small mt">Because ${esc(S.brand.name)} stores your patients' health information, HIPAA requires a Business Associate Agreement between your practice and us.</p>
      ${baaOk ? `<div class="notice ok mt">Accepted ${esc(fmtDate(p.baaAcceptedAt))} (version ${esc(p.baaVersion)}).</div>`
        : `<div class="notice mt">${p.baaVersion ? 'The agreement has been updated since you accepted it.' : 'Not yet accepted.'}</div>
           <label class="check mt"><input type="checkbox" id="baa-accept"> I accept the <a href="legal.html#baa" target="_blank" rel="noopener">Business Associate Agreement</a> (version ${esc(p.currentBaaVersion)}) on behalf of ${esc(p.name)}.</label>
           <button class="btn mt" data-act="accept-baa">Accept agreement</button>`}
      <p class="small muted mt"><a href="legal.html#baa" target="_blank" rel="noopener">Read the agreement</a></p></div></div>
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
    <div class="card mt"><div class="card-head"><h2>Locations</h2><span class="spacer"></span>${hasFeature('locations') ? '<button class="btn ghost sm" data-act="location-edit">+ Add location</button>' : ''}</div>
      <p class="small">Run more than one office in this account: each case belongs to a location (its letterhead is used on letters and exports), lists filter by location, and team members can be limited to their own location's patients.</p>
      <div id="locations-list" class="mt">${hasFeature('locations') ? '<div class="empty">Loading…</div>' : `<div class="notice">Multiple locations are part of the ${esc(featureInfo('locations').planName)} plan.</div>`}</div></div>
    <div class="card mt" id="badge-card"><div class="card-head"><h2>${esc(S.brand.name)} Certified badge</h2></div>
      <p class="small">Put a badge on your website to show patients, attorneys and referral partners that your practice manages PI cases on secure, HIPAA-ready software. It links to a live verification page and turns itself off if your account lapses.</p>
      <div id="badge-body" class="mt"><div class="empty">Loading…</div></div></div>
    <div class="card mt"><h2>EHR ledger layouts</h2>
      <p class="small mt">When someone uploads a ledger spreadsheet in a new layout, they match up its columns once and it's saved here. Later uploads in the same layout are read automatically.</p>
      <div id="ehr-formats" class="mt"><div class="empty">Loading…</div></div></div>`;
  loadEhrFormats();
  loadLocations();
  loadBadge();
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
  const defs = [{ n: 'name', l: 'Name', req: true, ph: 'e.g. Miami — Coral Way' }, { n: 'address', l: 'Address (letterhead)', t: 'textarea', rows: 2 }, { n: 'phone', l: 'Phone' }, { n: 'fax', l: 'Fax' },
    ...(id ? [{ n: 'active', l: 'Active', t: 'check' }] : [])];
  openModal({ title: id ? 'Edit location' : 'Add location', okText: 'Save', body: fieldsHtml(defs, l),
    onOk: async (el) => { await api('admin.php?action=location_save', { ...readFields(el, defs), ...(id ? { id: +id } : {}) }); toast('Saved'); await refreshSession(); loadLocations(); } });
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
    </div>
    ${!r.billingReady ? '<div class="notice">Online billing isn\'t switched on yet for this installation.</div>' : ''}
    ${p.status === 'trialing' && p.access === 'full' ? `<div class="notice ok">${r.firstCharge ? `Subscribing now keeps the rest of your free trial — your card is first charged on <strong>${esc(fmtDate(r.firstCharge))}</strong>.` : 'Your trial ends within two days, so billing starts when you subscribe.'} Cancel any time before then and you won't be charged.</div>` : ''}
    <div class="interval-toggle" role="radiogroup" aria-label="Billing period">
      <button role="radio" data-act="billing-interval" data-v="monthly" class="${interval === 'monthly' ? 'on' : ''}" aria-checked="${interval === 'monthly'}">Monthly</button>
      <button role="radio" data-act="billing-interval" data-v="annual" class="${interval === 'annual' ? 'on' : ''}" aria-checked="${interval === 'annual'}"${anyAnnual || !r.billingReady ? '' : ' disabled title="Annual billing isn\'t set up yet"'}>Annual <span class="save">2 months free</span></button>
    </div>
    <div class="plans">${entries(r.plans).map(([k, pl]) => {
      const current = k === p.plan && ['active', 'past_due', 'comped'].includes(p.status) && (p.status === 'comped' || p.interval === interval);
      const annual = interval === 'annual';
      const avail = annual ? pl.availableAnnual : pl.available;
      const subscribed = p.subscribed && ['active', 'past_due'].includes(p.status);
      return `<div class="plan-card${current ? ' current' : ''}"><h3>${esc(pl.name)}</h3>
        <div class="price">$${annual ? pl.annual_price : pl.price}<span>/${annual ? 'year' : 'month'}</span></div>
        <p class="small ${annual ? '' : 'muted'}">${annual ? `$${(pl.annual_price / 12).toFixed(2)}/month · save $${pl.price * 12 - pl.annual_price} a year` : `or $${pl.annual_price}/year with annual billing`}</p>
        <p class="small muted">${esc(pl.blurb)}</p>
        <ul class="small"><li>${pl.active_cases ? pl.active_cases + ' open cases' : 'Unlimited open cases'}</li><li>${pl.users ? pl.users + ' users' : 'Unlimited users'}</li><li>Unlimited closed cases</li>
          ${(pl.features || []).map((f) => `<li class="${f.included ? '' : 'no'}">${esc(f.name)}</li>`).join('')}</ul>
        ${current ? '<span class="chip teal">Current plan</span>' : p.status === 'comped' ? '' : subscribed ? '<button class="btn ghost" data-act="billing-portal">Switch in Manage billing</button>'
          : `<button class="btn${k === p.plan ? '' : ' ghost'}" data-act="checkout" data-plan="${k}" data-interval="${interval}"${avail ? '' : ' disabled'}>${p.status === 'trialing' && r.firstCharge ? 'Add card — keep free days' : 'Subscribe'}</button>`}</div>`;
    }).join('')}</div>
    <p class="small muted mt">Payments are processed by Stripe; ${esc(S.brand.name)} never sees your card. Closed and dropped cases don't count toward your limit. If you cancel, your records stay readable and exportable.</p>`;
  main.querySelectorAll('.bar > i[data-w]').forEach((i) => { i.style.width = i.dataset.w + '%'; });
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
    </tbody></table></div></div>${await feedbackSectionHtml()}`;
  main.querySelectorAll('[data-act-change=plan]').forEach((sel) => sel.addEventListener('change', async () => {
    if (await attempt(() => api('platform.php?action=practice_update', { id: +sel.dataset.id, plan: sel.value }))) { toast('Plan changed'); pagePlatform(main); }
  }));
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
    try { await api('admin.php?action=practice_save', readFields(box, PRACTICE_DEFS)); toast('Saved'); refreshSession(); }
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
  'new-case': newCaseModal,
  'goto-stage': (el) => { casesState.stage = el.dataset.stage; location.hash = '#/cases'; },
  'open-case': (el) => { S.caseTab = el.dataset.tab || 'overview'; location.hash = '#/case/' + el.dataset.id; },
  'sort-cases': (el) => { casesState.dir = casesState.sort === el.dataset.key ? -casesState.dir : 1; casesState.sort = el.dataset.key; const t = document.getElementById('cases-table'); if (t._rows) renderCasesTable(t._rows); },
  'sort-ar': (el) => { arState.dir = arState.sort === el.dataset.key ? -arState.dir : 1; arState.sort = el.dataset.key; pageAR(document.getElementById('main')); },
  'case-tab': (el) => { S.caseTab = el.dataset.tab; renderCase(); },
  'edit-case': editCaseModal, 'edit-patient': editPatientModal, 'edit-notes': editNotesModal,
  'add-referral': () => referralModal(null),
  'guide-refer': (el) => referralModal(null, { type: el.dataset.type, ...(el.dataset.region ? { body_region: el.dataset.region } : {}) }),
  'tip-dismiss': (el) => tipDismissModal(el.dataset.key),
  'guide-visit': (el) => visitModal(null, { visit_type: el.dataset.type }),
  'outreach-log': outreachLogModal,
  'export-file': exportFileModal,
  'location-edit': (el) => locationModal(el.dataset.id ? +el.dataset.id : null),
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
  'archive-child': (el) => archiveChild(el.dataset.table, +el.dataset.id),
  'upload-doc': uploadDoc,
  'archive-doc': async (el) => {
    if (!await confirmBox('Remove document', 'Remove this document from the case? It is archived, not destroyed.', 'Remove')) return;
    if (await attempt(() => api('documents.php?action=archive', { id: +el.dataset.id }))) reloadCase();
  },
  'letter': (el) => openLetter(el.dataset.type),
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
api('auth.php?action=session').then(applySession).catch(() => showLogin('Could not reach the server.'));

})();
