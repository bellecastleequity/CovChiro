// CaseMGR — single-page front end.
// No inline handlers or styles anywhere (the CSP forbids them): every
// button carries data-act="..." and one delegated listener dispatches it.
// Every dynamic value goes through esc() before it touches innerHTML.
'use strict';
(() => {

const S = { csrf: '', user: null, lookups: null, brand: { name: 'CaseMGR' }, practice: null, contacts: [], caseData: null, caseTab: 'overview', idleTimeout: 900, lastActivity: Date.now() };
const $app = document.getElementById('app');
const $modalHost = document.getElementById('modal-host');

// ---------- utils ----------
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => (n === null || n === undefined || n === '') ? '—' : (Number(n) < 0 ? '-' : '') + '$' + Math.abs(Number(n)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d) => { if (!d) return '—'; const [y, m, dd] = String(d).slice(0, 10).split('-'); return `${+m}/${+dd}/${y}`; };
const today = () => new Date().toLocaleDateString('en-CA');
const daysSince = (d) => d ? Math.round((Date.parse(today()) - Date.parse(String(d).slice(0, 10))) / 86400000) : null;
const can = (perm) => !!S.user && S.user.perms.includes(perm);
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
    <a class="brand" href="./"><img src="assets/logo.svg" alt=""><div><h2>${esc(S.brand.name)}</h2><div class="small muted">${esc(S.brand.tagline || '')}</div></div></a>
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
      <div><label for="su-plan">Plan after trial</label><select id="su-plan">${entries(plans).map(([k, p]) => opt(k, `${p.name} — $${p.price}/mo`, wanted || 'solo')).join('')}</select></div>
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
  ctx.fillStyle = '#1C2430';
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
  ['dashboard', 'Dashboard', 'case.read'], ['cases', 'Cases', 'case.read'], ['tasks', 'Tasks', 'case.read'],
  ['ar', 'A/R & settlements', 'finance.read'], ['contacts', 'Contacts', 'case.read'],
  ['admin', 'Users', 'users.manage'], ['settings', 'Practice settings', 'users.manage'], ['billing', 'Plan & billing', 'users.manage'],
  ['audit', 'Audit log', 'audit.read'], ['platform', 'Practices', 'platform.manage'],
];

// Trial / subscription / BAA notices shown above every page.
function bannerHtml() {
  const p = S.practice;
  if (!p) return '';
  const admin = can('users.manage');
  const cta = admin ? ' <a href="#/billing">Choose a plan</a>' : ' Ask your practice admin.';
  if (p.access === 'read_only') return `<div class="banner danger">Your ${p.status === 'trialing' ? 'free trial has ended' : 'subscription has ended'}. Records are read-only.${cta}</div>`;
  if (p.status === 'past_due') return `<div class="banner warn">Your last payment didn't go through.${admin ? ' <a href="#/billing">Update billing</a>' : ''}</div>`;
  if (admin && !p.baaCurrent) return `<div class="banner warn">Please review and accept the current Business Associate Agreement. <a href="#/settings">Practice settings</a></div>`;
  if (p.status === 'trialing') return `<div class="banner info">${p.trialDaysLeft} day${p.trialDaysLeft === 1 ? '' : 's'} left in your free trial.${admin ? ' <a href="#/billing">Choose a plan</a>' : ''}</div>`;
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
      <div class="brand"><img src="assets/logo.svg" alt=""><div>${esc(S.brand.name)}<small>${esc(operator ? 'Operator console' : S.practice.name)}</small></div></div>
      ${NAV.filter(([, , p]) => can(p)).map(([k, t]) => `<a href="#/${k}" data-nav="${k}">${esc(t)}</a>`).join('')}
      <div class="who"><div><strong>${esc(S.user.name)}</strong><br><span class="muted-light">${esc(S.user.role)}</span></div>
        <button class="btn ghost sm" data-act="change-password">Change password</button>
        <button class="btn ghost sm" data-act="sign-out">Sign out</button></div>
    </nav>
    <div class="main-col"><div id="banner">${bannerHtml()}</div><main class="main" id="main"></main></div>
  </div>`;
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
    settings: pageSettings, billing: pageBilling, platform: pagePlatform };
  (pages[page] || (S.user.operator ? pagePlatform : pageDashboard))(main, parts.slice(1));
}

const phiBanner = '<div class="phi-banner">Contains protected health information · access is logged</div>';

// ---------- dashboard ----------
async function pageDashboard(main) {
  const d = await attempt(() => api('cases.php?action=dashboard'));
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
      <div class="card"><div class="card-head"><h2>My tasks (next 7 days)</h2><span class="spacer"></span><button class="btn ghost sm" data-act="new-task">+ Task</button></div>
        ${taskListHtml(d.tasks, true)}</div>
    </div>`;
  let showAll = false;
  const renderAlerts = () => {
    const lvl = document.getElementById('alert-level').value;
    const keep = lvl === 'high' ? ['high'] : lvl === 'medium' ? ['high', 'medium'] : ['high', 'medium', 'low'];
    const matching = d.alerts.filter((a) => keep.includes(a.level));
    const list = showAll ? matching : matching.slice(0, 25);
    document.getElementById('dash-alerts').innerHTML = list.length ? list.map((a) => `<li class="${esc(a.level)}"><span class="dot"></span><div><a href="#/case/${a.caseId}" class="who">${esc(a.patient)}</a> <span class="muted small mono">${esc(a.caseNumber)}</span><div>${esc(a.text)}</div></div></li>`).join('')
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

function taskListHtml(tasks, showCase) {
  if (!tasks.length) return '<div class="empty">No open tasks.</div>';
  return `<ul class="alerts">${tasks.map((t) => {
    const overdue = t.due_on && t.due_on < today();
    return `<li class="${overdue ? 'high' : 'low'}"><input type="checkbox" data-act="task-done" data-id="${t.id}" aria-label="Mark done">
      <div><div>${esc(t.title)}</div><div class="small muted">${t.due_on ? (overdue ? '<span class="chip overdue">Overdue</span> ' : '') + 'Due ' + esc(fmtDate(t.due_on)) : 'No due date'}${t.assigned_name ? ' · ' + esc(t.assigned_name) : ''}
      ${showCase && t.case_id ? ` · <a href="#/case/${t.case_id}">${esc(t.patient)}</a>` : ''}</div></div></li>`;
  }).join('')}</ul>`;
}

// ---------- cases list ----------
let casesState = { stage: 'open', q: '', benefits: '', attorney: '', sort: 'patient', dir: 1 };
async function pageCases(main, args) {
  if (args[0] === 'stage' && args[1]) casesState.stage = args[1];
  main.innerHTML = `${phiBanner}<div class="page-head"><div><h1>Cases</h1><div class="sub" id="cases-count"></div></div><span class="spacer"></span>
      ${can('case.write') ? '<button class="btn" data-act="new-case">+ New case</button>' : ''}</div>
    <div class="filters">
      <input type="search" id="cf-q" placeholder="Search name or case #" value="${esc(casesState.q)}" aria-label="Search">
      <select id="cf-stage" aria-label="Stage">${opt('open', 'All open cases', casesState.stage)}${opt('legal', 'Demand / litigation / mediation', casesState.stage)}${opt('all', 'All cases (incl. closed)', casesState.stage)}${entries(S.lookups.stages).map(([k, t]) => opt(k, t, casesState.stage)).join('')}</select>
      <select id="cf-benefits" aria-label="Benefits">${opt('', 'Any benefits')}${entries(S.lookups.benefits).map(([k, t]) => opt(k, t, casesState.benefits)).join('')}</select>
      <select id="cf-atty" aria-label="Attorney">${opt('', 'Any attorney')}${S.contacts.filter((c) => c.type === 'attorney').map((c) => opt(c.id, contactName(c), casesState.attorney)).join('')}</select>
    </div>
    <div class="card"><div class="table-wrap" id="cases-table"><div class="empty">Loading…</div></div></div>`;
  let timer;
  const reload = async () => {
    const qs = new URLSearchParams({ action: 'list', stage: casesState.stage === 'all' ? 'all' : casesState.stage, q: casesState.q, benefits: casesState.benefits, attorney: casesState.attorney });
    const r = await attempt(() => api('cases.php?' + qs));
    if (r) renderCasesTable(r.cases);
  };
  main.querySelector('#cf-q').addEventListener('input', (e) => { casesState.q = e.target.value; clearTimeout(timer); timer = setTimeout(reload, 300); });
  [['#cf-stage', 'stage'], ['#cf-benefits', 'benefits'], ['#cf-atty', 'attorney']].forEach(([sel, key]) => main.querySelector(sel).addEventListener('change', (e) => { casesState[key] = e.target.value; reload(); }));
  reload();
}

function renderCasesTable(rows) {
  const cols = [
    ['patient', 'Patient'], ['stage', 'Stage'], ['benefits', 'Benefits'], ['doi', 'DOI'], ['firstVisit', '1st visit'], ['lastVisit', 'Last visit'],
    ['attorney', 'Attorney'], ['lastCorrespondence', 'Last contact'], ...(can('finance.read') ? [['balance', 'Balance']] : []), ['checklistDone', 'Checklist'], ['alerts', 'Alerts'],
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
      ${can('finance.read') ? `<td class="num">${money(r.balance)}</td>` : ''}
      <td class="nowrap">${r.checklistDone}/${r.checklistTotal}</td>
      <td>${r.alerts ? `<span class="badge-count${r.highAlerts ? '' : ' med'}">${r.alerts}</span>` : '<span class="badge-count zero">0</span>'}</td>
    </tr>`).join('')}</tbody></table>`;
  el._rows = rows;
}

function stageChip(stage) {
  const cls = ['litigation', 'mediation', 'demand', 'negotiating'].includes(stage) ? 'ochre' : ['closed', 'dropped'].includes(stage) ? '' : stage === 'settled' ? 'teal' : 'teal';
  return `<span class="chip ${cls}">${esc(label('stages', stage))}</span>`;
}

// ---------- new case ----------
const benefitOpts = () => entries(S.lookups.benefits);
const PATIENT_DEFS = [
  { n: 'first_name', l: 'First name', req: true }, { n: 'last_name', l: 'Last name' },
  { n: 'dob', l: 'Date of birth', t: 'date' }, { n: 'phone', l: 'Phone', t: 'tel' },
  { n: 'email', l: 'Email', t: 'email' }, { n: 'address', l: 'Address', full: true },
];
const caseDefs = () => [
  { n: 'injury_type', l: 'Injury type', t: 'select', blank: false, opts: [['auto', 'Auto accident'], ['slip_fall', 'Slip & fall'], ['work', 'Work injury'], ['other', 'Other']] },
  { n: 'date_of_injury', l: 'Date of injury (DOI)', t: 'date' },
  { n: 'first_visit', l: 'First visit', t: 'date' },
  { n: 'benefits', l: 'Benefits', t: 'select', opts: benefitOpts() },
  { n: 'referral_source', l: 'Referral source', t: 'select', opts: [['attorney', 'Attorney'], ['self', 'Self'], ['provider', 'Another provider'], ['other', 'Other']] },
  { n: 'referred_by_contact_id', l: 'Referred by (contact)', t: 'contact' },
  { n: 'referred_by_text', l: 'Referred by (other)', ph: 'e.g. friend, Google' },
  { n: 'attorney_contact_id', l: 'Attorney', t: 'contact', ctype: ['attorney'] },
  { n: 'insurer_contact_id', l: 'Insurance company', t: 'contact', ctype: ['insurer'] },
  { n: 'adjuster', l: 'Adjuster' },
  { n: 'claim_number', l: 'Claim #' }, { n: 'policy_number', l: 'Policy #' },
  { n: 'provider_user_id', l: 'Treating provider', t: 'user' },
];

function newCaseModal() {
  const m = openModal({
    title: 'New PI case', wide: true, okText: 'Create case',
    body: `<h3>Patient</h3>${fieldsHtml(PATIENT_DEFS)}<h3 class="mt">Case</h3>${fieldsHtml(caseDefs(), { injury_type: 'auto', benefits: 'pip' })}
      <p class="small muted mt">Need a new attorney or insurer? Add them under Contacts first, or edit the case afterwards.</p>`,
    onOk: async (el) => {
      const r = await api('cases.php?action=create', { patient: readFields(el, PATIENT_DEFS), case: readFields(el, caseDefs()) });
      toast('Case ' + r.caseNumber + ' created');
      location.hash = '#/case/' + r.id;
    },
  });
  return m;
}

// ---------- case page ----------
const CASE_TABS = [
  ['overview', 'Overview'], ['checklist', 'Checklist'], ['referrals', 'Co-management'], ['visits', 'Visits'], ['outcomes', 'Outcomes'],
  ['correspondence', 'Correspondence'], ['financials', 'Financials', 'finance.read'], ['documents', 'Documents'], ['tasks', 'Tasks'], ['activity', 'Activity', 'audit.read'],
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
  const overdueCount = d.checklist.filter((i) => i.status === 'overdue' && (i.group === 'At discharge') !== inCare).length;
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
    ${d.alerts.length ? `<div class="alert-box"><ul class="alerts">${d.alerts.map((a) => `<li class="${esc(a.level)}"><span class="dot"></span><div>${esc(a.text)}</div></li>`).join('')}</ul></div>` : ''}
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
  el.innerHTML = `<div class="grid-2">
    <div class="card"><div class="card-head"><h2>Case</h2><span class="spacer"></span>${can('case.write') ? '<button class="btn ghost sm" data-act="edit-case">Edit</button>' : ''}</div>
      <dl class="kv">
        ${row('Injury type', { auto: 'Auto accident', slip_fall: 'Slip & fall', work: 'Work injury', other: 'Other' }[c.injury_type])}
        ${row('Date of injury', fmtDate(c.date_of_injury))}${row('First visit', fmtDate(c.first_visit))}${row('Discharged', fmtDate(c.discharge_date))}
        ${row('Treating provider', provider?.name)}
        ${row('Referral source', c.referral_source)}${contactRow('Referred by', k.referred_by_contact_id)}${c.referred_by_text ? row('Referred by (note)', c.referred_by_text) : ''}
        ${contactRow('Attorney', k.attorney_contact_id)}${contactRow('Insurance', k.insurer_contact_id)}
        ${row('Adjuster', c.adjuster)}${row('Claim #', c.claim_number)}${row('Policy #', c.policy_number)}
        ${row('Benefits', label('benefits', c.benefits))}${row('EMC determination', c.emc_status)}
        ${row('PIP limit', money(c.pip_limit) + (c.emc_status !== 'yes' ? ` (effective ${money(c.pip_effective_limit)} without EMC)` : ''))}
        ${row('Actively treating', c.actively_treating == 1 ? 'Yes' : 'No')}
      </dl></div>
    <div>
      <div class="card"><div class="card-head"><h2>Patient</h2><span class="spacer"></span>${can('case.write') ? '<button class="btn ghost sm" data-act="edit-patient">Edit</button>' : ''}</div>
        <dl class="kv">${row('Name', [p.first_name, p.last_name].join(' '))}${row('Date of birth', fmtDate(p.dob))}${row('Phone', p.phone)}${row('Email', p.email)}${row('Address', p.address)}</dl></div>
      <div class="card"><div class="card-head"><h2>Case notes</h2><span class="spacer"></span>${can('case.write') ? '<button class="btn ghost sm" data-act="edit-notes">Edit</button>' : ''}</div>
        <div class="small prewrap">${c.notes ? esc(c.notes) : '<span class="muted">No notes.</span>'}</div></div>
      <div class="card"><div class="card-head"><h2>Letters</h2></div>
        <div class="filters"><button class="btn ghost sm" data-act="letter" data-type="status_request">Status update request</button>
        <button class="btn ghost sm" data-act="letter" data-type="tx_complete">Treatment complete</button>
        ${can('finance.read') ? '<button class="btn ghost sm" data-act="letter" data-type="reduction_response">Reduction response</button>' : ''}</div>
        <p class="small muted">Opens a printable letter addressed to the attorney of record. Log it under Correspondence once sent.</p></div>
    </div></div>`;
}

function editCaseModal() {
  const d = S.caseData, c = d.case;
  const defs = [...caseDefs(), { n: 'discharge_date', l: 'Discharge date', t: 'date' },
    { n: 'emc_status', l: 'EMC determination', t: 'select', blank: false, opts: [['pending', 'Pending'], ['yes', 'Yes — EMC exists'], ['no', 'No EMC']] },
    { n: 'pip_limit', l: 'PIP limit', t: 'money' }, { n: 'actively_treating', l: 'Actively treating', t: 'check' }];
  openModal({
    title: 'Edit case', wide: true, body: fieldsHtml(defs, c),
    onOk: async (el) => {
      const vals = readFields(el, defs);
      if (!can('finance.write')) { delete vals.pip_limit; delete vals.benefits; }
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

// --- referrals / co-management ---
const REF_STATUS = [['ordered', 'Ordered'], ['scheduled', 'Scheduled'], ['completed', 'Completed'], ['report_received', 'Report received'], ['no_show', 'No-show'], ['cancelled', 'Cancelled']];
const refDefs = () => [
  { n: 'direction', l: 'Direction', t: 'select', blank: false, opts: [['out', 'Outgoing — we referred'], ['in', 'Incoming — referred to us / co-managing']] },
  { n: 'type', l: 'Type', t: 'select', req: true, opts: entries(S.lookups.referralTypes) },
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
      <td><strong>${esc(label('referralTypes', r.type))}</strong>${r.direction === 'in' ? ' <span class="chip">incoming</span>' : ''}${r.body_region ? `<div class="small muted">${esc(r.body_region)}</div>` : ''}</td>
      <td>${esc([r.contact_org, r.contact_name].filter(Boolean).join(' — ') || r.facility_text || '—')}</td>
      <td><span class="chip ${r.status === 'report_received' ? 'done' : r.status === 'no_show' ? 'overdue' : r.status === 'cancelled' ? 'na' : 'due'}">${esc(Object.fromEntries(REF_STATUS)[r.status])}</span></td>
      <td class="nowrap">${esc(fmtDate(r.ordered_on))}</td><td class="nowrap">${esc(fmtDate(r.scheduled_on))}</td><td class="nowrap">${esc(fmtDate(r.completed_on))}</td>
      <td class="nowrap">${esc(fmtDate(r.report_received_on))}${r.entered_in_chart == 1 ? ' ✓' : ''}</td>
      <td class="small">${esc((r.findings || '').slice(0, 120))}</td>
      <td>${can('clinical.write') ? `<button class="btn link small" data-act="archive-child" data-table="referrals" data-id="${r.id}">Remove</button>` : ''}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="empty">No referrals yet. Add the MRI order, EMC referral and any ortho/neuro/pain consults here.</div>'}
  </div>`;
}

function referralModal(existing) {
  if (!can('clinical.write')) return;
  const defs = refDefs();
  openModal({
    title: existing ? 'Edit referral' : 'Add referral', wide: true,
    body: fieldsHtml(defs, existing || { direction: 'out', status: 'ordered', ordered_on: today() }) + (existing ? '' : '<p class="small muted">Tip: for an EMC referral, set the case\'s EMC determination on the Overview tab once the MD/DO report arrives.</p>'),
    onOk: async (el) => saveChild('referrals', { ...readFields(el, defs), ...(existing ? { id: existing.id } : {}) }),
  });
}

// --- visits ---
const VISIT_TYPES = [['initial', 'Initial exam'], ['treatment', 'Treatment'], ['re_exam', 'Re-exam'], ['discharge', 'Discharge'], ['no_show', 'No-show']];
const visitDefs = () => [
  { n: 'visit_date', l: 'Date of service', t: 'date', req: true },
  { n: 'visit_type', l: 'Visit type', t: 'select', blank: false, opts: VISIT_TYPES },
  { n: 'provider_user_id', l: 'Provider', t: 'user' }, { n: 'cpt_codes', l: 'CPT codes', ph: '98941, 97140, 97110' },
  { n: 'notes', l: 'Visit note', t: 'textarea' },
];
function tabVisits(el, d) {
  const counts = {};
  d.visits.forEach((v) => counts[v.visit_type] = (counts[v.visit_type] || 0) + 1);
  el.innerHTML = `<div class="card"><div class="card-head"><h2>Visits</h2>
      <span class="small muted">${d.stats.visitCount} attended${counts.no_show ? ` · ${counts.no_show} no-show${counts.no_show > 1 ? 's' : ''}` : ''}</span>
      <span class="spacer"></span>${can('clinical.write') ? '<button class="btn sm" data-act="add-visit">+ Log visit</button>' : ''}</div>
    ${d.visits.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Type</th><th>Provider</th><th>CPT</th><th>Note</th><th></th></tr></thead><tbody>
    ${d.visits.map((v) => `<tr class="click" data-act="edit-visit" data-id="${v.id}"><td class="nowrap">${esc(fmtDate(v.visit_date))}</td>
      <td><span class="chip ${v.visit_type === 'no_show' ? 'overdue' : v.visit_type === 'discharge' ? 'teal' : ''}">${esc(Object.fromEntries(VISIT_TYPES)[v.visit_type])}</span></td>
      <td>${esc(v.provider_name || '—')}</td><td class="mono small">${esc(v.cpt_codes || '')}</td><td class="small">${esc((v.notes || '').slice(0, 140))}</td>
      <td>${can('clinical.write') ? `<button class="btn link small" data-act="archive-child" data-table="visits" data-id="${v.id}">Remove</button>` : ''}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="empty">No visits logged yet.</div>'}
    <p class="small muted mt">Logging the first visit moves an intake case to Treating; logging a Discharge visit sets the discharge date and moves it to Treatment complete.</p>
  </div>`;
}

function visitModal(existing) {
  if (!can('clinical.write')) return;
  const defs = visitDefs();
  const chargeDefs = [{ n: 'charge_amount', l: 'Post charge to ledger ($)', t: 'money' }, { n: 'charge_bucket', l: 'Bill to', t: 'select', blank: false, opts: [['insurance', 'Insurance (PIP/MedPay)'], ['patient', 'Patient / LOP']] }];
  const showCharge = !existing && can('finance.write');
  openModal({
    title: existing ? 'Edit visit' : 'Log visit', wide: true,
    body: fieldsHtml(defs, existing || { visit_date: today(), visit_type: S.caseData.stats.visitCount ? 'treatment' : 'initial', provider_user_id: S.caseData.case.provider_user_id || '' })
      + (showCharge ? '<h3 class="mt">Charge (optional)</h3>' + fieldsHtml(chargeDefs, { charge_bucket: ['lop', 'benex', 'denied'].includes(S.caseData.case.benefits) ? 'patient' : 'insurance' }) : ''),
    onOk: async (el) => {
      const row = { ...readFields(el, defs), ...(existing ? { id: existing.id } : {}) };
      const extra = showCharge ? (() => { const c = readFields(el, chargeDefs); return c.charge_amount ? { charge: { amount: c.charge_amount, bucket: c.charge_bucket } } : {}; })() : {};
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
const LEDGER_KINDS = [['charge', 'Charge'], ['payment', 'Payment'], ['adjustment', 'Adjustment'], ['reduction', 'Reduction (attorney)'], ['write_off', 'Write-off']];
const ledgerDefs = [
  { n: 'entry_date', l: 'Date', t: 'date', req: true }, { n: 'kind', l: 'Type', t: 'select', blank: false, opts: LEDGER_KINDS },
  { n: 'bucket', l: 'Bucket', t: 'select', blank: false, opts: [['insurance', 'Insurance (PIP/MedPay)'], ['patient', 'Patient / attorney (LOP)']] },
  { n: 'amount', l: 'Amount ($)', t: 'money', req: true }, { n: 'reference', l: 'Reference', ph: 'Check #, EOB #, claim line' }, { n: 'memo', l: 'Memo' },
];
function tabFinancials(el, d) {
  const t = d.totals, c = d.case;
  const limit = +c.pip_effective_limit, expectedPip = t.insurance_charges * 0.8;
  const pct = limit ? Math.min(100, Math.round(expectedPip / limit * 100)) : 0;
  const offerPct = c.atty_offer && t.total_balance > 0 ? Math.round(c.atty_offer / t.total_balance * 1000) / 10 : null;
  const finalPct = c.final_settlement && t.total_balance > 0 ? Math.round(c.final_settlement / t.total_balance * 1000) / 10 : null;
  const editable = can('finance.write');
  el.innerHTML = `<div class="grid-2">
    <div class="card"><div class="card-head"><h2>Ledger</h2><span class="spacer"></span>${editable ? '<button class="btn sm" data-act="add-ledger">+ Entry</button>' : ''}</div>
      ${d.ledger.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Type</th><th>Bucket</th><th>Ref / memo</th><th class="num">Amount</th><th></th></tr></thead><tbody>
      ${d.ledger.map((l) => `<tr><td class="nowrap">${esc(fmtDate(l.entry_date))}</td><td>${esc(Object.fromEntries(LEDGER_KINDS)[l.kind])}</td><td>${l.bucket === 'insurance' ? 'Insurance' : 'Patient/LOP'}</td>
        <td class="small">${esc([l.reference, l.memo].filter(Boolean).join(' · '))}</td>
        <td class="num">${l.kind === 'charge' ? money(l.amount) : '(' + money(l.amount) + ')'}</td>
        <td>${editable ? `<button class="btn link small" data-act="archive-child" data-table="ledger" data-id="${l.id}">Remove</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">No ledger entries.</div>'}
    </div>
    <div>
      <div class="card"><h2>Balances</h2>
        <div class="money-row"><span>Insurance charges</span><strong>${money(t.insurance_charges)}</strong></div>
        <div class="money-row"><span>Insurance payments &amp; credits</span><strong>(${money(t.insurance_credits)})</strong></div>
        <div class="money-row"><span>Insurance balance</span><strong>${money(t.insurance_balance)}</strong></div>
        <div class="money-row"><span>Patient / LOP balance</span><strong>${money(t.patient_balance)}</strong></div>
        <div class="money-row"><span><strong>Total outstanding</strong></span><strong>${money(t.total_balance)}</strong></div>
        ${c.benefits === 'pip' || c.benefits === 'benex' ? `<div class="small mt">PIP pays 80% of charges: expected ${money(expectedPip)} of ${money(limit)} limit${c.emc_status !== 'yes' ? ' (no EMC — $2,500 cap)' : ''}
          <div class="bar ${pct >= 100 ? 'over' : pct >= 85 ? 'warn' : ''}"><i data-w="${pct}"></i></div></div>` : ''}
      </div>
      <div class="card"><div class="card-head"><h2>Settlement / reduction</h2><span class="spacer"></span>${editable ? '<button class="btn ghost sm" data-act="edit-settlement">Edit</button>' : ''}</div>
        <div class="money-row"><span>${Math.round(S.lookups.reductionFloorPct * 100)}% floor</span><strong>${money(t.reduction_floor)}</strong></div>
        <div class="money-row"><span>Attorney offer</span><strong>${money(c.atty_offer)}${offerPct !== null ? ` <span class="small muted">(${offerPct}%)</span>` : ''}</strong></div>
        <div class="money-row"><span>Final settlement</span><strong>${money(c.final_settlement)}${finalPct !== null ? ` <span class="small muted">(${finalPct}%)</span>` : ''}</strong></div>
        <div class="money-row"><span>Date authorized</span><strong>${esc(fmtDate(c.date_authorized))}</strong></div>
        <div class="money-row"><span>Check received</span><strong>${esc(fmtDate(c.check_received_on))}</strong></div>
        ${c.atty_offer && t.reduction_floor && +c.atty_offer < t.reduction_floor ? '<div class="notice">Offer is below the reduction floor.</div>' : ''}
        <p class="small muted mt">When the check arrives, post it as a Payment and the agreed reduction as a Reduction so the balance closes to $0.</p>
      </div>
    </div></div>`;
  // Width via CSSOM (allowed under the CSP; inline style attributes are not).
  el.querySelectorAll('.bar > i[data-w]').forEach((i) => { i.style.width = i.dataset.w + '%'; });
}

function ledgerModal() {
  openModal({ title: 'Ledger entry', body: fieldsHtml(ledgerDefs, { entry_date: today(), kind: 'payment', bucket: 'insurance' }) + '<p class="small muted">Always enter a positive amount — Charge adds to the balance, every other type subtracts.</p>',
    onOk: async (el) => saveChild('ledger', readFields(el, ledgerDefs)) });
}

function settlementModal() {
  const c = S.caseData.case;
  const defs = [{ n: 'atty_offer', l: 'Attorney offer ($)', t: 'money' }, { n: 'final_settlement', l: 'Final settlement ($)', t: 'money' },
    { n: 'date_authorized', l: 'Date authorized', t: 'date' }, { n: 'check_received_on', l: 'Check received on', t: 'date' }];
  openModal({ title: 'Settlement / reduction', body: fieldsHtml(defs, c), onOk: async (el) => {
    S.caseData = await api('cases.php?action=update&id=' + c.id, { case: readFields(el, defs) });
    renderCase(); toast('Saved');
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
    ${done.length ? `<details class="mt"><summary class="small muted">${done.length} completed</summary><ul class="alerts">${done.map((t) => `<li class="low"><span class="dot"></span><div><s>${esc(t.title)}</s> <span class="small muted">done ${esc(fmtDate(t.done_at))}</span></div></li>`).join('')}</ul></details>` : ''}
  </div>`;
}

function taskModal(caseId) {
  const defs = [{ n: 'title', l: 'Task', req: true, full: true }, { n: 'due_on', l: 'Due', t: 'date' }, { n: 'assigned_user_id', l: 'Assign to', t: 'select', opts: (S.lookups.users || []).map((u) => [u.id, u.name]) }];
  openModal({ title: 'New task', body: fieldsHtml(defs, { assigned_user_id: S.user.id }), onOk: async (el) => {
    const v = readFields(el, defs);
    const r = await api('cases.php?action=task_save', { ...v, case_id: caseId || null, return_case: !!caseId });
    if (caseId && r.case) { S.caseData = r; renderCase(); } else route();
    toast('Task added');
  } });
}

// --- activity (audit for this case) ---
async function tabActivity(el, d) {
  el.innerHTML = '<div class="card"><div class="empty">Loading…</div></div>';
  const r = await attempt(() => api('admin.php?action=audit&case_id=' + d.case.id));
  if (!r) return;
  el.innerHTML = `<div class="card"><div class="card-head"><h2>Access &amp; change history</h2></div>${auditTable(r.entries)}</div>`;
}

function auditTable(rows) {
  if (!rows.length) return '<div class="empty">No entries.</div>';
  return `<div class="table-wrap"><table><thead><tr><th>When</th><th>User</th><th>Action</th><th>Record</th><th>Case</th><th>IP</th><th>Detail</th></tr></thead><tbody>
    ${rows.map((a) => `<tr><td class="nowrap small">${esc(a.occurred_at)}</td><td class="small">${esc(a.user_email || '—')}</td><td><span class="chip ${/fail|denied|locked/.test(a.action) ? 'red' : ''}">${esc(a.action)}</span></td>
      <td class="small">${esc([a.entity, a.entity_id].filter(Boolean).join(' #'))}</td><td class="small mono">${a.case_id ? `<a href="#/case/${a.case_id}">${esc(a.case_number || a.case_id)}</a>` : ''}</td>
      <td class="small mono">${esc(a.ip_address || '')}</td><td class="small">${esc(a.detail || '')}</td></tr>`).join('')}</tbody></table></div>`;
}

// ---------- tasks page ----------
async function pageTasks(main) {
  const scope = main.dataset.scope || 'all';
  const r = await attempt(() => api('cases.php?action=tasks&scope=' + scope));
  if (!r) return;
  main.innerHTML = `<div class="page-head"><div><h1>Tasks</h1><div class="sub">${r.tasks.length} open</div></div><span class="spacer"></span>
    <select id="task-scope" aria-label="Scope">${opt('all', 'Everyone\'s tasks', scope)}${opt('mine', 'Assigned to me', scope)}</select>
    <button class="btn" data-act="new-task">+ Task</button></div>
    <div class="card">${taskListHtml(r.tasks, true)}</div>`;
  main.querySelector('#task-scope').addEventListener('change', (e) => { main.dataset.scope = e.target.value; pageTasks(main); });
}

// ---------- A/R ----------
let arState = { all: false, sort: 'patient', dir: 1 };
async function pageAR(main) {
  const r = await attempt(() => api('cases.php?action=ar_report' + (arState.all ? '&all=1' : '')));
  if (!r) return;
  const rows = r.rows;
  const { sort, dir } = arState;
  rows.sort((a, b) => { const x = a[sort] ?? '', y = b[sort] ?? ''; return (typeof x === 'number' || typeof y === 'number' ? (+x || 0) - (+y || 0) : String(x).localeCompare(String(y))) * dir; });
  const cols = [['patient', 'Patient'], ['benefits', 'Benefits'], ['stage', 'Status'], ['lastVisit', 'Last visit'], ['lastCorrespondence', 'Last contact'], ['attorney', 'Attorney'],
    ['insuranceBalance', 'Insurance', 1], ['patientBalance', 'Patient/LOP', 1], ['totalBalance', 'Total', 1], ['reductionFloor', Math.round(S.lookups.reductionFloorPct * 100) + '% floor', 1], ['attyOffer', 'Offer', 1], ['finalSettlement', 'Settled', 1], ['checkReceived', 'Check rec\'d']];
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
        <td class="num">${money(x.reductionFloor)}</td><td class="num">${x.attyOffer !== null ? money(x.attyOffer) + `<div class="small muted">${x.offerPct}%</div>` : '—'}</td>
        <td class="num">${money(x.finalSettlement)}</td><td class="nowrap">${esc(fmtDate(x.checkReceived))}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="6">Totals</td><td class="num">${money(r.totals.insurance)}</td><td class="num">${money(r.totals.patient)}</td><td class="num">${money(r.totals.total)}</td><td colspan="4"></td></tr></tfoot></table></div></div>`;
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
    <div class="card"><div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>2FA</th><th>Last sign-in</th><th></th></tr></thead><tbody>
    ${r.users.map((u) => `<tr><td><strong>${esc(u.name)}</strong></td><td>${esc(u.email)}</td><td><span class="chip">${esc(u.role)}</span></td>
      <td>${u.active == 1 ? (u.locked_until && u.locked_until > new Date().toISOString().slice(0, 19).replace('T', ' ') ? '<span class="chip red">Locked</span>' : '<span class="chip teal">Active</span>') : '<span class="chip na">Disabled</span>'}${u.must_change_password == 1 ? ' <span class="chip ochre">Temp password</span>' : ''}</td>
      <td>${u.totp_enabled == 1 ? '✓' : '<span class="muted">not set up</span>'}</td><td class="small">${esc(u.last_login_at || 'never')}</td>
      <td class="nowrap"><button class="btn ghost sm" data-act="edit-user" data-id="${u.id}">Edit</button>
        <button class="btn ghost sm" data-act="reset-user" data-id="${u.id}" data-what="password">Reset password</button>
        <button class="btn ghost sm" data-act="reset-user" data-id="${u.id}" data-what="mfa">Reset 2FA</button>
        <button class="btn ghost sm" data-act="reset-user" data-id="${u.id}" data-what="unlock">Unlock</button></td></tr>`).join('')}
    </tbody></table></div>
    <h3 class="mt">Roles</h3>
    <dl class="kv small"><dt>admin</dt><dd>Everything, plus users and the audit log.</dd><dt>provider</dt><dd>All clinical and financial work.</dd>
      <dt>staff</dt><dd>Front desk / case manager: cases, checklist, referrals, visits, correspondence, documents. Sees balances; can't post payments or settlements.</dd>
      <dt>billing</dt><dd>Ledger, settlements, A/R and correspondence. Read-only on clinical records.</dd></dl></div>`;
  main._users = r.users;
}

function userModal(existing) {
  const defs = [{ n: 'name', l: 'Full name', req: true }, ...(existing ? [] : [{ n: 'email', l: 'Email', t: 'email', req: true }]),
    { n: 'role', l: 'Role', t: 'select', blank: false, opts: [['staff', 'Staff'], ['billing', 'Billing'], ['provider', 'Provider'], ['admin', 'Admin']] },
    ...(existing ? [{ n: 'active', l: 'Active', t: 'check' }] : [])];
  openModal({ title: existing ? 'Edit user' : 'Add user', body: fieldsHtml(defs, existing || { role: 'staff' }), onOk: async (el) => {
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
async function pageAudit(main) {
  const f = main._f || { action_filter: '', from: '', to: '' };
  const qs = new URLSearchParams({ action: 'audit', ...f });
  const r = await attempt(() => api('admin.php?' + qs));
  if (!r) return;
  main.innerHTML = `<div class="page-head"><div><h1>Audit log</h1><div class="sub">Latest 500 matching entries. Review regularly — HIPAA requires you to watch for inappropriate access.</div></div></div>
    <div class="filters"><select id="au-action" aria-label="Action">${['', 'login', 'login_failed', 'mfa_failed', 'view', 'update', 'create', 'archive', 'download', 'upload', 'export', 'letter', 'access_denied', 'session_timeout'].map((a) => opt(a, a || 'All actions', f.action_filter)).join('')}</select>
      <input type="date" id="au-from" value="${esc(f.from)}" aria-label="From"><input type="date" id="au-to" value="${esc(f.to)}" aria-label="To"><button class="btn ghost sm" data-act="audit-filter">Filter</button></div>
    <div class="card">${auditTable(r.entries)}</div>`;
}

// ---------- practice settings ----------
const PRACTICE_DEFS = [{ n: 'name', l: 'Practice name', req: true, full: true }, { n: 'address', l: 'Address (letterhead)', t: 'textarea', rows: 2 },
  { n: 'phone', l: 'Phone' }, { n: 'fax', l: 'Fax' }, { n: 'state', l: 'State', ph: 'FL' }];
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
      <p class="small muted mt"><a href="legal.html#baa" target="_blank" rel="noopener">Read the agreement</a></p></div></div>`;
}

// ---------- plan & billing ----------
async function pageBilling(main) {
  const r = await attempt(() => api('billing.php?action=status'));
  if (!r) return;
  const p = r.practice;
  if (location.hash.includes('done=1')) { toast('Thanks! Your subscription is being activated.'); history.replaceState(null, '', '#/billing'); setTimeout(refreshSession, 2500); }
  const statusText = { trialing: p.access === 'full' ? `Free trial — ${p.trialDaysLeft} days left` : 'Free trial ended', active: 'Active', past_due: 'Payment past due', canceled: 'Canceled', comped: 'Complimentary' }[p.status];
  const usage = (n, max) => `${n}${max ? ' of ' + max : ''}`;
  const pct = (n, max) => max ? Math.min(100, Math.round(n / max * 100)) : 0;
  main.innerHTML = `<div class="page-head"><div><h1>Plan &amp; billing</h1><div class="sub">${esc(p.planName)} plan · ${esc(statusText)}${p.currentPeriodEnd && p.status === 'active' ? ' · renews ' + esc(fmtDate(p.currentPeriodEnd)) : ''}</div></div><span class="spacer"></span>
      ${r.hasCustomer ? '<button class="btn ghost" data-act="billing-portal">Manage billing &amp; invoices</button>' : ''}</div>
    <div class="tiles">
      <div class="tile"><div class="k">Open cases</div><div class="v">${usage(p.activeCases, p.limits.activeCases)}</div>${p.limits.activeCases ? `<div class="bar ${pct(p.activeCases, p.limits.activeCases) >= 90 ? 'warn' : ''}"><i data-w="${pct(p.activeCases, p.limits.activeCases)}"></i></div>` : ''}</div>
      <div class="tile"><div class="k">Users</div><div class="v">${usage(p.activeUsers, p.limits.users)}</div>${p.limits.users ? `<div class="bar"><i data-w="${pct(p.activeUsers, p.limits.users)}"></i></div>` : ''}</div>
    </div>
    ${!r.billingReady ? '<div class="notice">Online billing isn\'t switched on yet for this installation.</div>' : ''}
    <div class="plans">${entries(r.plans).map(([k, pl]) => {
      const current = k === p.plan && ['active', 'past_due', 'comped'].includes(p.status);
      return `<div class="plan-card${current ? ' current' : ''}"><h3>${esc(pl.name)}</h3><div class="price">$${pl.price}<span>/month</span></div>
        <p class="small muted">${esc(pl.blurb)}</p>
        <ul class="small"><li>${pl.active_cases ? pl.active_cases + ' open cases' : 'Unlimited open cases'}</li><li>${pl.users ? pl.users + ' users' : 'Unlimited users'}</li><li>All features, unlimited closed cases</li></ul>
        ${current ? '<span class="chip teal">Current plan</span>' : p.status === 'comped' ? '' : `<button class="btn${k === p.plan ? '' : ' ghost'}" data-act="checkout" data-plan="${k}"${pl.available ? '' : ' disabled'}>${r.hasCustomer && p.status === 'active' ? 'Switch' : 'Subscribe'}</button>`}</div>`;
    }).join('')}</div>
    <p class="small muted mt">Payments are processed by Stripe; ${esc(S.brand.name)} never sees your card. Closed and dropped cases don't count toward your limit. If you cancel, your records stay readable and exportable.</p>`;
  main.querySelectorAll('.bar > i[data-w]').forEach((i) => { i.style.width = i.dataset.w + '%'; });
}

// ---------- operator console ----------
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
    </tbody></table></div></div>`;
  main.querySelectorAll('[data-act-change=plan]').forEach((sel) => sel.addEventListener('change', async () => {
    if (await attempt(() => api('platform.php?action=practice_update', { id: +sel.dataset.id, plan: sel.value }))) { toast('Plan changed'); pagePlatform(main); }
  }));
}

// ---------- letters ----------
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
  'accept-baa': async () => {
    if (!document.getElementById('baa-accept').checked) { toast('Tick the box to accept.', true); return; }
    if (await attempt(() => api('admin.php?action=accept_baa', { accept: true }))) { toast('Agreement accepted'); await refreshSession(); route(); }
  },
  'checkout': async (el) => {
    const r = await attempt(() => api('billing.php?action=checkout', { plan: el.dataset.plan }));
    if (r?.url) location.href = r.url;
  },
  'billing-portal': async () => {
    const r = await attempt(() => api('billing.php?action=portal', {}));
    if (r?.url) location.href = r.url;
  },
  'op-extend': async (el) => { if (await attempt(() => api('platform.php?action=practice_update', { id: +el.dataset.id, extend_trial_days: 14 }))) { toast('Trial extended'); route(); } },
  'op-comp': async (el) => { if (await attempt(() => api('platform.php?action=practice_update', { id: +el.dataset.id, comped: el.dataset.on === '1' }))) route(); },
  'change-password': changePasswordModal,
  'new-case': newCaseModal,
  'goto-stage': (el) => { casesState.stage = el.dataset.stage; location.hash = '#/cases'; },
  'open-case': (el) => { S.caseTab = el.dataset.tab || 'overview'; location.hash = '#/case/' + el.dataset.id; },
  'sort-cases': (el) => { casesState.dir = casesState.sort === el.dataset.key ? -casesState.dir : 1; casesState.sort = el.dataset.key; const t = document.getElementById('cases-table'); if (t._rows) renderCasesTable(t._rows); },
  'sort-ar': (el) => { arState.dir = arState.sort === el.dataset.key ? -arState.dir : 1; arState.sort = el.dataset.key; pageAR(document.getElementById('main')); },
  'case-tab': (el) => { S.caseTab = el.dataset.tab; renderCase(); },
  'edit-case': editCaseModal, 'edit-patient': editPatientModal, 'edit-notes': editNotesModal,
  'add-referral': () => referralModal(null),
  'edit-referral': (el) => referralModal(S.caseData.referrals.find((r) => r.id == el.dataset.id)),
  'add-visit': () => visitModal(null),
  'edit-visit': (el) => visitModal(S.caseData.visits.find((r) => r.id == el.dataset.id)),
  'add-outcome': outcomeModal,
  'add-corr': () => corrModal(null),
  'edit-corr': (el) => corrModal(S.caseData.correspondence.find((r) => r.id == el.dataset.id)),
  'add-ledger': ledgerModal, 'edit-settlement': settlementModal,
  'archive-child': (el) => archiveChild(el.dataset.table, +el.dataset.id),
  'upload-doc': uploadDoc,
  'archive-doc': async (el) => {
    if (!await confirmBox('Remove document', 'Remove this document from the case? It is archived, not destroyed.', 'Remove')) return;
    if (await attempt(() => api('documents.php?action=archive', { id: +el.dataset.id }))) reloadCase();
  },
  'letter': (el) => openLetter(el.dataset.type),
  'new-task': (el) => taskModal(el.dataset.case ? +el.dataset.case : null),
  'task-done': async (el) => {
    const inCase = location.hash.startsWith('#/case/');
    const r = await attempt(() => api('cases.php?action=task_save', { id: +el.dataset.id, done: true, return_case: inCase }));
    if (!r) { el.checked = false; return; }
    toast('Task done');
    if (inCase && r.case) { S.caseData = r; renderCase(); } else route();
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
  'audit-filter': () => {
    const main = document.getElementById('main');
    main._f = { action_filter: document.getElementById('au-action').value, from: document.getElementById('au-from').value, to: document.getElementById('au-to').value };
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
