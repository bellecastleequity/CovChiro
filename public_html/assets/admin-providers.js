// Admin → Providers tab: the provider network's funnel, credential
// verification queue, provider records, coverage shifts, school/campaign
// recruitment links, geographic supply, and follow-up automation settings.
// Loaded by admin.html after its own script (uses $, apiFetch, money,
// showToast, escHtml, decodeHtml, drawQrCode and Leaflet from there).
// All rules (who can be assigned, what counts as verified) are enforced by
// /api/provider.php — this UI only reflects them.

const pvAdm = { sub: 'overview', list: null, queue: [], funnel: null, shifts: null, schools: null, supply: null, settings: null,
  search: '', stage: 'all', supplyZip: '', supplyGroup: 'byMetro', qrOpen: null, editSchool: null };
const PV_STATUS_LABEL = { not_provided: 'Not provided', uploaded: 'Uploaded — incomplete', pending: 'Verification pending', verified: 'Verified', rejected: 'Needs correction', expired: 'Expired', superseded: 'Replaced' };
const PV_STATUS_COLOR = { verified: 'var(--teal-dark)', pending: '#7a5a20', uploaded: '#7a5a20', rejected: 'var(--red)', expired: 'var(--red)', not_provided: '#8a8171', superseded: '#8a8171' };
const pvT = s => escHtml(decodeHtml(s == null ? '' : String(s)));
const pvDate = d => d ? new Date(String(d).length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const pvPill = st => `<span style="font-family:'IBM Plex Mono',monospace;font-size:0.72rem;font-weight:600;color:${PV_STATUS_COLOR[st] || 'inherit'};">${PV_STATUS_LABEL[st] || st}</span>`;
const pvPct = (a, b) => b ? Math.round(a / b * 100) + '%' : '—';
const pvCard = (label, value, sub) => `<div class="an-card"><div class="an-label">${label}</div><div class="an-value">${value}</div>${sub ? `<div class="an-sub">${sub}</div>` : ''}</div>`;
const pvTable = (head, rows) => `<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:0.82rem;">
  <thead><tr>${head.map((h, i) => `<th style="text-align:${i ? 'right' : 'left'};padding:6px 8px;border-bottom:1px solid var(--line);font-weight:600;white-space:nowrap;">${h}</th>`).join('')}</tr></thead>
  <tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td style="text-align:${i ? 'right' : 'left'};padding:6px 8px;border-bottom:1px solid var(--line);${i ? 'white-space:nowrap;' : ''}">${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;

async function loadProvidersTab(){
  pvAdm.error = null;
  try {
    const r = await apiFetch('/api/provider.php?action=admin_list');
    pvAdm.list = r.providers; pvAdm.queue = r.queue; pvAdm.lifecycle = r.lifecycle; pvAdm.sources = r.sources;
  } catch (e) { pvAdm.error = e.message; return; }
  await pvLoadSub(pvAdm.sub);
}

async function pvLoadSub(sub){
  try {
    if (sub === 'overview') pvAdm.funnel = await apiFetch('/api/provider.php?action=admin_funnel');
    if (sub === 'shifts') { pvAdm.shifts = (await apiFetch('/api/provider.php?action=admin_shifts')).shifts; if (typeof loadAdminBookings === 'function' && !adminBookings.length) await loadAdminBookings(); }
    if (sub === 'schools') pvAdm.schools = (await apiFetch('/api/provider.php?action=admin_schools')).schools;
    if (sub === 'supply') pvAdm.supply = await apiFetch('/api/provider.php?action=admin_supply' + (pvAdm.supplyZip ? '&zip=' + encodeURIComponent(pvAdm.supplyZip) : ''));
    if (sub === 'automation') pvAdm.settings = await apiFetch('/api/provider.php?action=admin_settings');
  } catch (e) { pvAdm.subError = e.message; }
}

function renderProvidersTab(el){
  if (pvAdm.error) {
    el.innerHTML = `<div class="admin-card"><h3>Provider network</h3><p style="font-size:0.85rem;color:var(--red);">Couldn't load providers (${escHtml(pvAdm.error)}). If this is a new install, run <code>migration_015_provider_network.sql</code> in phpMyAdmin.</p></div>`;
    return;
  }
  const flagged = (pvAdm.shifts || []).filter(s => s.needsReview).length;
  const subs = [['overview', 'Funnel'], ['queue', `Verification queue${pvAdm.queue.length ? ` (${pvAdm.queue.length})` : ''}`], ['list', 'Providers'],
    ['shifts', `Shifts${flagged ? ` (${flagged} ⚠)` : ''}`], ['schools', 'Schools & links'], ['supply', 'Supply map'], ['automation', 'Automation']];
  el.innerHTML = `
    <div class="ai-row" style="margin-bottom:16px;gap:6px;">${subs.map(([k, l]) => `<button class="btn ${pvAdm.sub === k ? '' : 'ghost'} sm" data-pv-sub="${k}">${l}</button>`).join('')}</div>
    ${pvAdm.subError ? `<p style="font-size:0.85rem;color:var(--red);">${escHtml(pvAdm.subError)}</p>` : ''}
    <div id="pv-body"></div>`;
  pvAdm.subError = null;
  el.querySelectorAll('[data-pv-sub]').forEach(b => b.addEventListener('click', async () => {
    pvAdm.sub = b.dataset.pvSub;
    await pvLoadSub(pvAdm.sub);
    renderProvidersTab(el);
  }));
  const body = $('pv-body');
  ({ overview: pvOverview, queue: pvQueue, list: pvList, shifts: pvShifts, schools: pvSchools, supply: pvSupply, automation: pvAutomation })[pvAdm.sub](body);
}
async function pvRefresh(){ await loadProvidersTab(); renderProvidersTab($('admin-list')); }

// ---------- funnel ----------
function pvOverview(el){
  const f = pvAdm.funnel;
  if (!f) { el.innerHTML = '<div class="empty">Loading…</div>'; return; }
  const c = f.current, fn = f.funnel;
  const steps = [['Provider leads', fn.leads], ['Accounts created', fn.accounts], ['Graduated', fn.graduated], ['License submitted', fn.licenseSubmitted],
    ['Licensed (verified)', fn.licensed], ['License + malpractice submitted', fn.bothSubmitted], ['Coverage-ready (ever)', fn.coverageReady],
    ['Accepted first shift', fn.firstShift], ['Repeat providers (2+ shifts)', fn.repeat]];
  const max = Math.max(1, ...steps.map(s => s[1]));
  const bars = steps.map(([label, n], i) => `
    <div style="display:grid;grid-template-columns:minmax(120px,210px) 1fr 92px;gap:10px;align-items:center;margin-bottom:6px;font-size:0.82rem;">
      <div>${label}</div>
      <div style="background:var(--paper-2);border-radius:3px;height:18px;"><div style="width:${Math.max(n ? 2 : 0, n / max * 100)}%;height:100%;background:${i >= 6 ? 'var(--teal)' : 'var(--teal-light)'};border-radius:3px;"></div></div>
      <div style="text-align:right;font-family:'IBM Plex Mono',monospace;">${n}${i ? ` <span style="color:#8a8171;">${pvPct(n, steps[i - 1][1])}</span>` : ''}</div>
    </div>`).join('');
  const stageRows = Object.entries(f.stageLabels).map(([k, l]) => [l, f.stages[k] || 0]);
  const srcRows = f.bySource.sort((a, b) => b.registered - a.registered).map(s => [pvT(s.label), s.registered, s.licensed, s.coverageReady, s.readyNow, s.firstShift, pvPct(s.coverageReady, s.registered),
    s.spend ? money(s.spend) : '—', s.spend && s.registered ? money(s.spend / s.registered) : '—', s.spend && s.coverageReady ? money(s.spend / s.coverageReady) : '—']);
  const schoolRows = f.bySchool.sort((a, b) => b.registered - a.registered).map(s => [pvT(s.label), s.registered, s.licensed, s.coverageReady, s.readyNow, s.firstShift, pvPct(s.coverageReady, s.registered)]);
  const campRows = f.campaigns.map(s => [`${pvT(s.name)}<div style="font-size:0.72rem;color:#8a8171;">/join/${pvT(s.slug)}</div>`, s.visits, s.leads, s.registered, pvPct(s.registered, s.visits),
    s.coverageReady, s.firstShift, s.cost ? money(s.cost) : '—', s.cost && s.registered ? money(s.cost / s.registered) : '—', s.cost && s.coverageReady ? money(s.cost / s.coverageReady) : '—']);
  el.innerHTML = `
    <div class="an-grid">
      ${pvCard('Registered providers', c.registered, 'every provider account, any stage')}
      ${pvCard('Coverage-ready now', c.coverageReady, 'license + malpractice verified, eligible today')}
      ${pvCard('Awaiting verification', pvAdm.queue.length, 'credential submissions in the queue')}
      ${pvCard('Ready rate', pvPct(c.coverageReady, c.registered), `${c.suspended} on hold`)}
    </div>
    <p style="font-size:0.78rem;color:#7a5a20;margin:10px 0 0;padding:8px 12px;background:rgba(184,134,63,0.1);border-radius:4px;">Network size in marketing should quote <strong>coverage-ready</strong> providers (${c.coverageReady}), not registered accounts (${c.registered}) — registered includes students and anyone not yet verified.</p>
    <div class="admin-card" style="margin-top:20px;"><h3>Provider funnel</h3>
      <p style="font-size:0.8rem;color:#6b7280;margin-bottom:12px;">How many providers have ever reached each step. Percentages are conversion from the step above.</p>${bars}</div>
    <div class="admin-card" style="margin-top:20px;"><h3>Where providers are today</h3>${pvTable(['Stage', 'Providers'], stageRows)}</div>
    <div class="admin-card" style="margin-top:20px;"><h3>By acquisition source</h3>
      <p style="font-size:0.8rem;color:#6b7280;margin-bottom:8px;">Spend comes from Automation → Acquisition spend; school/event campaign spend is set per link under Schools &amp; links.</p>
      ${srcRows.length ? pvTable(['Source', 'Registered', 'Licensed', 'Ready (ever)', 'Ready now', '1st shift', 'Reg→ready', 'Spend', 'Cost/reg.', 'Cost/ready'], srcRows) : '<p style="font-size:0.85rem;color:#6b7280;">No providers yet.</p>'}</div>
    <div class="admin-card" style="margin-top:20px;"><h3>Campaign links (/join/…)</h3>
      ${campRows.length ? pvTable(['Link', 'Visits', 'Leads', 'Registered', 'Visit→reg.', 'Ready', '1st shift', 'Cost', 'Cost/reg.', 'Cost/ready'], campRows) : '<p style="font-size:0.85rem;color:#6b7280;">No campaign link activity yet. Links and QR codes are under Schools &amp; links.</p>'}</div>
    <div class="admin-card" style="margin-top:20px;"><h3>By school</h3>${schoolRows.length ? pvTable(['School', 'Registered', 'Licensed', 'Ready (ever)', 'Ready now', '1st shift', 'Reg→ready'], schoolRows) : '<p style="font-size:0.85rem;color:#6b7280;">No providers yet.</p>'}</div>
    <div class="admin-card" style="margin-top:20px;"><h3>New provider accounts by month</h3>${f.monthly.length ? pvTable(['Month', 'Registered'], f.monthly.map(m => [m.month, m.registered])) : '<p style="font-size:0.85rem;color:#6b7280;">None yet.</p>'}</div>`;
}

// ---------- verification queue ----------
function pvCredFields(c){
  return c.type === 'license'
    ? [['License #', c.licenseNumber], ['State', c.licenseState], ['Issued', c.issueDate && pvDate(c.issueDate)], ['Expires', pvDate(c.expirationDate)]]
    : [['Carrier', c.carrier], ['Policy #', c.policyNumber], ['Coverage start', c.coverageStart && pvDate(c.coverageStart)], ['Expires', pvDate(c.expirationDate)],
       ['Per claim', c.perClaimLimit && money(c.perClaimLimit)], ['Aggregate', c.aggregateLimit && money(c.aggregateLimit)]];
}
function pvReviewBlock(c){
  const fieldInputs = c.type === 'license'
    ? `<div class="row2"><div><label>License # (as on document)</label><input type="text" data-rv="licenseNumber" value="${pvT(c.licenseNumber)}"></div><div><label>State</label><input type="text" data-rv="licenseState" maxlength="2" value="${pvT(c.licenseState)}"></div></div>`
    : `<div class="row2"><div><label>Carrier</label><input type="text" data-rv="carrier" value="${pvT(c.carrier)}"></div><div><label>Policy #</label><input type="text" data-rv="policyNumber" value="${pvT(c.policyNumber)}"></div></div>`;
  return `<div class="pv-review" data-cred="${c.id}">
    ${fieldInputs}
    <div class="row2"><div><label>Expiration date</label><input type="date" data-rv="expirationDate" value="${pvT(c.expirationDate)}"></div>
      <div><label>Note to provider (required to reject)</label><input type="text" data-rv="notes" placeholder="e.g. Image unreadable — please re-upload"></div></div>
    <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">
      <button class="btn sm" data-rv-go="verify">Verify</button>
      <button class="btn ghost sm" data-rv-go="reject" style="color:var(--red);border-color:var(--red);">Reject — needs correction</button>
    </div>
    <div class="err-msg" data-rv-err></div>
  </div>`;
}
function pvWireReview(root, after){
  root.querySelectorAll('.pv-review').forEach(box => box.querySelectorAll('[data-rv-go]').forEach(btn => btn.addEventListener('click', async () => {
    const decision = btn.dataset.rvGo;
    const body = { id: Number(box.dataset.cred), decision };
    box.querySelectorAll('[data-rv]').forEach(i => { body[i.dataset.rv] = i.value.trim(); });
    if (decision === 'verify' && !confirm('Confirm you have checked the document (and, for a license, the state board record) and the details match?')) return;
    btn.disabled = true;
    try {
      const r = await apiFetch('/api/provider.php?action=admin_review_credential', { method: 'POST', body: JSON.stringify(body) });
      showToast(decision === 'verify' ? (r.eligible ? 'Verified — provider is now coverage-ready.' : 'Verified.') : 'Rejected — provider notified.');
      await after();
    } catch (e) { box.querySelector('[data-rv-err]').textContent = e.message; btn.disabled = false; }
  })));
}
function pvQueue(el){
  if (!pvAdm.queue.length) { el.innerHTML = '<div class="empty">Nothing waiting for verification.</div>'; return; }
  el.innerHTML = `<p style="font-size:0.82rem;color:#6b7280;margin-bottom:12px;">Oldest first. Open the document, check it against the state licensing board / carrier, correct any mistyped details, then verify or reject. A credential only counts toward eligibility once verified here.</p>`
    + pvAdm.queue.map(c => `
    <div class="admin-card" style="margin-bottom:14px;">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;">
        <div><div style="font-weight:600;">${pvT(c.providerName)} <span style="font-weight:400;color:#6b7280;">· ${pvT(c.providerEmail)}</span></div>
          <div style="font-size:0.82rem;margin-top:2px;">${c.type === 'license' ? 'Chiropractic license' : 'Malpractice insurance'} · submitted ${pvDate(c.submittedAt)}</div></div>
        <div style="display:flex;gap:8px;align-items:flex-start;">${c.fileUrl ? `<a class="btn ghost sm" href="${c.fileUrl}" target="_blank" rel="noopener">Open document</a>` : ''}<button class="btn ghost sm" data-pv-open="${c.providerId}">Provider</button></div>
      </div>
      <div style="font-size:0.82rem;color:#3d4552;margin:8px 0;">${pvCredFields(c).filter(f => f[1]).map(f => `<span style="margin-right:14px;"><span style="color:#8a8171;">${f[0]}:</span> ${pvT(f[1])}</span>`).join('')}</div>
      ${pvReviewBlock(c)}
    </div>`).join('');
  pvWireReview(el, pvRefresh);
  el.querySelectorAll('[data-pv-open]').forEach(b => b.addEventListener('click', () => pvOpenProvider(Number(b.dataset.pvOpen))));
}

// ---------- provider list + detail ----------
function pvList(el){
  const q = pvAdm.search.toLowerCase();
  const list = pvAdm.list.filter(p => (pvAdm.stage === 'all' || p.lifecycle === pvAdm.stage || (pvAdm.stage === 'suspended' && p.accountStatus === 'suspended'))
    && (!q || [p.name, p.email, p.phone, p.schoolName, p.zip, p.city, p.metro, p.source].join(' ').toLowerCase().includes(q)));
  el.innerHTML = `
    <div class="ai-row" style="margin-bottom:12px;">
      <input type="text" id="pv-search" placeholder="Search name, email, school, ZIP, city…" value="${escHtml(pvAdm.search)}">
      <select id="pv-stage" style="flex:0 1 230px;width:auto;"><option value="all">All stages (${pvAdm.list.length})</option>
        ${Object.entries(pvAdm.lifecycle).map(([k, l]) => `<option value="${k}" ${pvAdm.stage === k ? 'selected' : ''}>${l} (${pvAdm.list.filter(p => p.lifecycle === k).length})</option>`).join('')}
        <option value="suspended" ${pvAdm.stage === 'suspended' ? 'selected' : ''}>On hold</option></select>
      <button class="btn ghost sm" id="pv-export">Export CSV</button>
    </div>
    <div style="font-size:0.78rem;color:#8a8171;margin-bottom:8px;">${list.length} provider${list.length === 1 ? '' : 's'}</div>
    ${list.map(p => `
      <div class="blk ${p.eligible ? 'booked' : ''}" style="margin-bottom:8px;cursor:pointer;${p.accountStatus === 'suspended' ? 'opacity:0.6;' : ''}" data-pv-open="${p.id}">
        <div style="min-width:0;">
          <div class="bd" style="overflow-wrap:anywhere;">${pvT(p.name)} <span style="font-weight:400;color:#6b7280;">· ${pvT(p.email)}</span></div>
          <div class="bn">${pvT(p.lifecycleLabel)}${p.accountStatus === 'suspended' ? ' · ON HOLD' : ''} · License: ${pvPill(p.license.status)}${p.license.renewal ? ' (renewal in review)' : ''} · Malpractice: ${pvPill(p.malpractice.status)}${p.malpractice.renewal ? ' (renewal in review)' : ''}</div>
          <div class="bn">${pvT(p.schoolName || '—')} · grad ${pvDate(p.graduationDate)} · ${pvT([p.city, p.state].filter(Boolean).join(', ') || p.zip || '—')} · ${p.travelRadius} mi · via ${pvT(pvAdm.sources[p.source] || p.source)}${p.sourceDetail ? ' (' + pvT(p.sourceDetail) + ')' : ''} · ${p.shifts} shift${p.shifts === 1 ? '' : 's'}</div>
        </div>
      </div>`).join('') || '<div class="empty">No providers match.</div>'}`;
  $('pv-search').addEventListener('input', e => { pvAdm.search = e.target.value; const pos = e.target.selectionStart; pvList(el); const s = $('pv-search'); s.focus(); s.setSelectionRange(pos, pos); });
  $('pv-stage').addEventListener('change', e => { pvAdm.stage = e.target.value; pvList(el); });
  $('pv-export').addEventListener('click', () => {
    const head = ['Name', 'Email', 'Phone', 'Stage', 'Coverage ready', 'License', 'License expires', 'Malpractice', 'Malpractice expires', 'School', 'Graduation', 'Licensure applied', 'States', 'ZIP', 'City', 'County', 'State', 'Metro', 'Travel radius', 'Source', 'Source detail', 'UTM campaign', 'SMS consent', 'Shifts', 'Created'];
    const rows = list.map(p => [p.name, p.email, p.phone, p.lifecycleLabel, p.eligible ? 'yes' : 'no', p.license.status, p.license.expiresAt || '', p.malpractice.status, p.malpractice.expiresAt || '',
      decodeHtml(p.schoolName), p.graduationDate || '', p.licensureApplied, p.intendedStates.join(' '), p.zip || '', p.city || '', p.county || '', p.state || '', p.metro || '', p.travelRadius,
      p.source, p.sourceDetail || '', p.utmCampaign || '', p.smsConsent ? 'yes' : 'no', p.shifts, p.createdAt]);
    const csv = [head, ...rows].map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'providers.csv'; a.click();
  });
  el.querySelectorAll('[data-pv-open]').forEach(b => b.addEventListener('click', () => pvOpenProvider(Number(b.dataset.pvOpen))));
}

function pvModal(html){
  const old = $('pv-modal'); if (old) old.remove();
  const m = document.createElement('div');
  m.id = 'pv-modal';
  m.style.cssText = 'position:fixed;inset:0;background:rgba(28,36,48,0.55);z-index:1000;display:flex;align-items:flex-start;justify-content:center;padding:24px 12px;overflow-y:auto;';
  m.innerHTML = `<div style="background:var(--paper);border-radius:6px;width:100%;max-width:760px;padding:22px;position:relative;">
    <button class="btn ghost sm" id="pv-modal-close" style="position:absolute;top:14px;right:14px;">Close</button>${html}</div>`;
  document.body.appendChild(m);
  const close = () => m.remove();
  $('pv-modal-close').addEventListener('click', close);
  m.addEventListener('click', e => { if (e.target === m) close(); });
  return m;
}

async function pvOpenProvider(id){
  let d;
  try { d = await apiFetch('/api/provider.php?action=admin_provider&id=' + id); } catch (e) { showToast(e.message, 'error'); return; }
  const p = d.profile;
  const req = d.eligibility.requirements.map(r => `<li style="color:${r.met ? 'var(--teal-dark)' : 'var(--red)'};">${r.met ? '✓' : '✗'} ${escHtml(r.label)}</li>`).join('');
  const creds = d.credentials.map(c => `
    <div class="blk ${c.status === 'verified' ? 'booked' : ''}" style="margin-bottom:8px;flex-direction:column;align-items:stretch;">
      <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;">
        <div class="bd">${c.type === 'license' ? 'License' : 'Malpractice'} · ${pvPill(c.status)}</div>
        <div style="display:flex;gap:6px;">${c.fileUrl ? `<a class="btn ghost sm" href="${c.fileUrl}" target="_blank" rel="noopener">Document</a>` : ''}
          ${c.status === 'verified' ? `<button class="btn ghost sm" data-revoke="${c.id}" style="color:var(--red);border-color:var(--red);">Revoke</button>` : ''}</div>
      </div>
      <div class="bn">${pvCredFields(c).filter(f => f[1]).map(f => `${f[0]}: ${pvT(f[1])}`).join(' · ')}</div>
      <div class="bn">Submitted ${pvDate(c.submittedAt)}${c.verifiedAt ? ` · reviewed ${pvDate(c.verifiedAt)} by ${pvT(c.verifiedBy || '')}` : ''}${c.reviewNotes ? ` · note: ${pvT(c.reviewNotes)}` : ''}</div>
      ${['pending', 'uploaded'].includes(c.status) ? pvReviewBlock(c) : ''}
    </div>`).join('') || '<p style="font-size:0.85rem;color:#6b7280;">No credentials submitted yet.</p>';
  const utm = Object.entries(p.utm).filter(([, v]) => v).map(([k, v]) => `${k}=${pvT(v)}`).join(' · ');
  const m = pvModal(`
    <h2 style="font-size:1.4rem;margin-right:80px;">${pvT(p.name)}</h2>
    <p style="font-size:0.85rem;color:#6b7280;">${pvT(p.email)} ${p.emailVerified ? '(confirmed)' : '(email not confirmed)'} · ${pvT(p.phone)}${p.smsConsent ? ` · SMS consent ${pvDate(p.smsConsentAt)}` : ' · no SMS consent'}</p>
    <div class="admin-card" style="margin-top:14px;">
      <h3>${pvT(p.lifecycleLabel)} ${d.eligibility.eligible ? '· <span style="color:var(--teal-dark);">Shift eligible</span>' : '· <span style="color:var(--red);">Not shift eligible</span>'}</h3>
      <ul style="list-style:none;font-size:0.84rem;display:grid;gap:3px;">${req}</ul>
      <div style="margin-top:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        ${p.accountStatus === 'suspended'
          ? `<span style="font-size:0.82rem;color:var(--red);">On hold: ${pvT(p.suspendedReason || '')}</span><button class="btn ghost sm" id="pv-reactivate">Reactivate</button>`
          : `<button class="btn ghost sm" id="pv-suspend" style="color:var(--red);border-color:var(--red);">Put account on hold</button>`}
      </div>
    </div>
    <div class="admin-card" style="margin-top:14px;"><h3>Credentials</h3>${creds}</div>
    <div class="admin-card" style="margin-top:14px;"><h3>Profile</h3>
      <div style="font-size:0.84rem;display:grid;gap:3px;">
        <div><span style="color:#8a8171;">School:</span> ${pvT(p.schoolName || '—')} · graduation ${pvDate(p.graduationDate)}</div>
        <div><span style="color:#8a8171;">Licensure:</span> ${pvT({ no: 'not yet applied', yes: 'application submitted', licensed: 'licensed' }[p.licensureApplied])} · expected ${pvT(p.expectedLicensure || '—')} · states ${pvT(p.intendedStates.join(', '))}</div>
        <div><span style="color:#8a8171;">Location:</span> ${pvT([p.zip, p.city, p.county, p.state].filter(Boolean).join(' · '))}${p.metro ? ' · ' + pvT(p.metro) : ''} · travels ${p.travelRadius} mi${p.preferredArea ? ' · prefers ' + pvT(p.preferredArea) : ''}</div>
        ${p.techniques ? `<div><span style="color:#8a8171;">Techniques:</span> ${pvT(p.techniques)}</div>` : ''}
        <div><span style="color:#8a8171;">Acquired via:</span> ${pvT(pvAdm.sources[p.source] || p.source)}${p.sourceDetail ? ' (' + pvT(p.sourceDetail) + ')' : ''}${p.referredBy ? ' · referred by ' + pvT(p.referredBy) : ''}${utm ? ' · ' + utm : ''}${p.landingPath ? ' · landed on ' + pvT(p.landingPath) : ''}</div>
        <div><span style="color:#8a8171;">Milestones:</span> joined ${pvDate(p.createdAt)} · first coverage-ready ${pvDate(p.firstReadyAt)} · first shift ${pvDate(p.firstShiftAt)}</div>
        <div><span style="color:#8a8171;">Follow-ups:</span> ${p.followupStep} sent${p.followupsOptOut ? ' · unsubscribed from reminders' : ''}</div>
      </div></div>
    <div class="admin-card" style="margin-top:14px;"><h3>Shifts</h3>${d.shifts.length ? d.shifts.map(s => `<div class="bn" style="margin-bottom:4px;">${pvDate(s.date)} · ${pvT(s.clinicName || '')} · ${money(s.pay)} · ${s.status}${s.needsReview ? ' · <span style="color:var(--red);">needs review</span>' : ''}</div>`).join('') : '<p style="font-size:0.85rem;color:#6b7280;">None.</p>'}</div>
    <div class="admin-card" style="margin-top:14px;"><h3>Messages sent</h3>${d.messages.length ? d.messages.map(x => `<div class="bn" style="margin-bottom:3px;">${new Date(x.sentAt).toLocaleString()} · ${pvT(x.subject)}${x.ok ? '' : ' <span style="color:var(--red);">(failed)</span>'}</div>`).join('') : '<p style="font-size:0.85rem;color:#6b7280;">None yet.</p>'}</div>`);
  const reopen = async () => { await loadProvidersTab(); renderProvidersTab($('admin-list')); pvOpenProvider(id); };
  pvWireReview(m, reopen);
  m.querySelectorAll('[data-revoke]').forEach(b => b.addEventListener('click', async () => {
    const notes = prompt('Revoke this verified credential? The provider loses shift eligibility immediately and upcoming shifts are flagged for review.\n\nReason (sent to the provider):');
    if (!notes) return;
    try { await apiFetch('/api/provider.php?action=admin_review_credential', { method: 'POST', body: JSON.stringify({ id: Number(b.dataset.revoke), decision: 'revoke', notes }) }); showToast('Credential revoked.'); await reopen(); }
    catch (e) { showToast(e.message, 'error'); }
  }));
  const setAccount = async (status) => {
    const reason = status === 'suspended' ? prompt('Reason for putting this account on hold (internal):') : '';
    if (status === 'suspended' && reason === null) return;
    try { const r = await apiFetch('/api/provider.php?action=admin_set_account', { method: 'POST', body: JSON.stringify({ id, status, reason }) }); showToast(status === 'suspended' ? `On hold${r.flaggedShifts ? ` — ${r.flaggedShifts} shift(s) flagged` : ''}.` : 'Reactivated.'); await reopen(); }
    catch (e) { showToast(e.message, 'error'); }
  };
  if ($('pv-suspend')) $('pv-suspend').addEventListener('click', () => setAccount('suspended'));
  if ($('pv-reactivate')) $('pv-reactivate').addEventListener('click', () => setAccount('active'));
}

// ---------- shifts ----------
function pvShiftFormHtml(){
  const today = localDateStr(new Date());
  const opts = (adminBookings || []).filter(b => b.status !== 'cancelled').flatMap(b => (b.dates || []).filter(d => d >= today).map(d => ({ b, d })))
    .sort((x, y) => x.d.localeCompare(y.d)).slice(0, 200);
  return `<div class="admin-card" style="margin-bottom:20px;border-color:var(--teal);">
    <h3 id="sh-toggle" style="cursor:pointer;">+ Offer a coverage shift to the network</h3>
    <div id="sh-form" class="hidden">
      <label for="sh-booking">From a clinic booking (optional — fills in clinic, address and date)</label>
      <select id="sh-booking"><option value="">— Enter details manually —</option>${opts.map(({ b, d }) => `<option value="${escHtml(b.id)}|${d}">${d} · ${pvT(b.title)} · ${escHtml(b.id)}</option>`).join('')}</select>
      <div class="row2"><div><label for="sh-date">Date</label><input type="date" id="sh-date" min="${today}"></div>
        <div><label for="sh-type">Day</label><select id="sh-type"><option value="full">Full day</option><option value="half">Half day</option></select></div></div>
      <div class="row2"><div><label for="sh-start">Start time</label><input type="time" id="sh-start" value="08:00"></div><div><label for="sh-end">End time</label><input type="time" id="sh-end" value="17:00"></div></div>
      <div class="row2"><div><label for="sh-clinic">Clinic name</label><input type="text" id="sh-clinic"></div><div><label for="sh-pay">Provider pay ($)</label><input type="text" id="sh-pay" inputmode="decimal"></div></div>
      <label for="sh-address">Address (shared with the provider once assigned)</label><input type="text" id="sh-address">
      <div class="row2"><div><label for="sh-zip">ZIP</label><input type="text" id="sh-zip" maxlength="5"></div><div><label for="sh-state">State</label><input type="text" id="sh-state" maxlength="2" value="FL"></div></div>
      <label for="sh-notes">Notes for the provider</label><input type="text" id="sh-notes" placeholder="Dress code, techniques, parking, point of contact…">
      <label style="display:flex;gap:8px;align-items:center;margin-top:12px;"><input type="checkbox" id="sh-notify" checked style="width:auto;"> Email coverage-ready providers whose travel radius reaches this shift</label>
      <div class="err-msg" id="sh-err"></div>
      <button class="btn" id="sh-save">Publish shift</button>
    </div></div>`;
}
function pvShifts(el){
  const list = pvAdm.shifts || [];
  const row = s => `
    <div class="blk ${s.status === 'assigned' || s.status === 'completed' ? 'booked' : ''}" style="margin-bottom:8px;flex-direction:column;align-items:stretch;${s.needsReview ? 'border-left-color:var(--red);background:rgba(155,59,46,0.05);' : ''}${s.status === 'cancelled' ? 'opacity:0.55;' : ''}">
      <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;">
        <div class="bd">${pvDate(s.date)} · ${s.startTime && s.endTime ? `${s.startTime}–${s.endTime}` : s.dayType} · ${money(s.pay)}</div>
        <div class="bn" style="margin:0;">${escHtml(s.id)} · ${s.status}</div>
      </div>
      <div class="bn">${pvT(s.clinicName || '—')} · ${pvT(s.address || [s.city, s.state, s.zip].filter(Boolean).join(' '))}${s.bookingId ? ' · booking ' + escHtml(s.bookingId) : ''}</div>
      ${s.providerId ? `<div class="bn">Provider: <a href="#" data-pv-open="${s.providerId}">${pvT(s.providerName)}</a> · ${s.assignedBy === 'self' ? 'accepted by provider' : 'assigned by ' + pvT(s.assignedBy)} ${pvDate(s.assignedAt)}</div>` : ''}
      ${s.needsReview ? `<div class="bn" style="color:var(--red);font-weight:600;">⚠ Needs review: ${pvT(s.reviewReason)}</div>` : ''}
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">
        ${s.status === 'open' ? `<button class="btn ghost sm" data-sh-cand="${s.id}">Find eligible provider</button>` : ''}
        ${s.needsReview ? `<button class="btn ghost sm" data-sh-keep="${s.id}">Keep — credentials renewed</button>` : ''}
        ${s.status === 'assigned' ? `<button class="btn ghost sm" data-sh-unassign="${s.id}">Unassign</button>` : ''}
        ${s.status === 'assigned' && s.date <= localDateStr(new Date()) ? `<button class="btn ghost sm" data-sh-done="${s.id}">Mark completed</button>` : ''}
        ${['open', 'assigned'].includes(s.status) ? `<button class="btn ghost sm" data-sh-cancel="${s.id}" style="color:var(--red);border-color:var(--red);">Cancel shift</button>` : ''}
      </div>
      <div data-sh-cand-box="${s.id}"></div>
    </div>`;
  el.innerHTML = pvShiftFormHtml()
    + `<p style="font-size:0.8rem;color:#6b7280;margin-bottom:10px;">Only providers whose license (for the shift's state) and malpractice insurance are verified and unexpired on the shift date can accept or be assigned — the server rejects anything else, including assignments made here. Flagged shifts are assignments whose provider lost eligibility (expired/revoked credential or account hold); they're never removed automatically.</p>`
    + (list.length ? list.map(row).join('') : '<div class="empty">No shifts yet.</div>');
  $('sh-toggle').addEventListener('click', () => $('sh-form').classList.toggle('hidden'));
  $('sh-booking').addEventListener('change', e => {
    if (!e.target.value) return;
    const [id, d] = e.target.value.split('|');
    const b = adminBookings.find(x => x.id === id);
    $('sh-date').value = d;
    if (b) {
      const t = (b.dayTimes || []).find(x => x.date === d);
      if (t) { $('sh-start').value = t.startTime || ''; $('sh-end').value = t.endTime || ''; }
      const typeIdx = (b.dates || []).indexOf(d);
      if ((b.dayTypes || [])[typeIdx] && b.dayTypes[typeIdx] !== 'full') $('sh-type').value = 'half';
      $('sh-address').value = decodeHtml(b.address || ''); $('sh-zip').value = b.zip || '';
      $('sh-clinic').value = decodeHtml((b.title || '').replace(/^.*?—\s*/, ''));
      $('sh-notes').value = decodeHtml([b.coverage && b.coverage.techniques && b.coverage.techniques.join ? 'Techniques: ' + b.coverage.techniques.join(', ') : '', b.coverage && b.coverage.dress ? 'Dress: ' + b.coverage.dress : ''].filter(Boolean).join(' · '));
    }
  });
  $('sh-save').addEventListener('click', async () => {
    const [bookingId] = ($('sh-booking').value || '').split('|');
    const body = { bookingId: bookingId || null, date: $('sh-date').value, dayType: $('sh-type').value, startTime: $('sh-start').value, endTime: $('sh-end').value,
      clinicName: $('sh-clinic').value.trim(), pay: $('sh-pay').value.trim(), address: $('sh-address').value.trim(), zip: $('sh-zip').value.trim(),
      state: $('sh-state').value.trim().toUpperCase(), notes: $('sh-notes').value.trim(), notify: $('sh-notify').checked };
    $('sh-save').disabled = true;
    try { const r = await apiFetch('/api/provider.php?action=admin_shift_save', { method: 'POST', body: JSON.stringify(body) }); showToast(`Shift published${body.notify ? ` — ${r.notified} provider${r.notified === 1 ? '' : 's'} emailed` : ''}.`); await pvLoadSub('shifts'); pvShifts(el); }
    catch (e) { $('sh-err').textContent = e.message; $('sh-save').disabled = false; }
  });
  const act = async (url, body, msg) => {
    try { await apiFetch(url, { method: 'POST', body: JSON.stringify(body) }); showToast(msg); await pvLoadSub('shifts'); pvShifts(el); }
    catch (e) { showToast(e.message, 'error'); }
  };
  el.querySelectorAll('[data-pv-open]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); pvOpenProvider(Number(a.dataset.pvOpen)); }));
  el.querySelectorAll('[data-sh-keep]').forEach(b => b.addEventListener('click', () => act('/api/provider.php?action=admin_shift_review', { id: b.dataset.shKeep }, 'Review cleared.')));
  el.querySelectorAll('[data-sh-unassign]').forEach(b => b.addEventListener('click', () => {
    const reason = prompt('Unassign this provider? The shift reopens. Note to the provider (optional):');
    if (reason !== null) act('/api/provider.php?action=admin_shift_unassign', { id: b.dataset.shUnassign, reason }, 'Provider unassigned — shift reopened.');
  }));
  el.querySelectorAll('[data-sh-done]').forEach(b => b.addEventListener('click', () => act('/api/provider.php?action=admin_shift_status', { id: b.dataset.shDone, status: 'completed' }, 'Marked completed.')));
  el.querySelectorAll('[data-sh-cancel]').forEach(b => b.addEventListener('click', () => {
    const reason = prompt('Cancel this shift? Any assigned provider is notified. Reason (optional):');
    if (reason !== null) act('/api/provider.php?action=admin_shift_status', { id: b.dataset.shCancel, status: 'cancelled', reason }, 'Shift cancelled.');
  }));
  el.querySelectorAll('[data-sh-cand]').forEach(b => b.addEventListener('click', async () => {
    const box = el.querySelector(`[data-sh-cand-box="${b.dataset.shCand}"]`);
    box.innerHTML = '<p class="bn">Checking eligibility…</p>';
    let c;
    try { c = (await apiFetch('/api/provider.php?action=admin_shift_candidates&id=' + encodeURIComponent(b.dataset.shCand))).candidates; } catch (e) { box.innerHTML = `<p class="bn" style="color:var(--red);">${escHtml(e.message)}</p>`; return; }
    box.innerHTML = c.length ? `<div style="margin-top:8px;">${c.map(x => `<div class="bn" style="display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:4px;">
        <span>${pvT(x.name)} · ${x.miles != null ? `~${x.miles} mi` : 'distance unknown'} (travels ${x.travelRadius})${x.withinRadius ? '' : ' · outside their radius'}</span>
        <button class="btn sm" data-assign="${x.id}">Assign</button></div>`).join('')}</div>`
      : '<p class="bn" style="margin-top:6px;">No provider is eligible for this date yet.</p>';
    box.querySelectorAll('[data-assign]').forEach(a => a.addEventListener('click', () => {
      if (confirm('Assign this provider? They will be emailed the shift details.')) act('/api/provider.php?action=admin_shift_assign', { id: b.dataset.shCand, providerId: Number(a.dataset.assign) }, 'Provider assigned.');
    }));
  }));
}

// ---------- schools & recruitment links ----------
function pvSchools(el){
  const list = pvAdm.schools || [];
  const e = pvAdm.editSchool || { slug: '', name: '', city: '', state: '', kind: 'school', headline: '', campaignCost: 0, active: true };
  el.innerHTML = `
    <div class="admin-card" style="margin-bottom:20px;">
      <h3>${e.id ? 'Edit link' : 'Add a school, event or campaign link'}</h3>
      <p style="font-size:0.8rem;color:#6b7280;">Each gets its own URL (coveragechiropractor.com/join/<em>link-name</em>) and QR code. Everyone who signs up through it is attributed to it automatically. Add campaign spend to see cost per registered and per coverage-ready provider.</p>
      <div class="row2"><div><label for="sc-name">Name</label><input type="text" id="sc-name" value="${pvT(e.name)}" placeholder="e.g. Palmer Florida — Spring graduation fair"></div>
        <div><label for="sc-slug">Link name</label><input type="text" id="sc-slug" value="${pvT(e.slug)}" placeholder="e.g. palmer-spring26"></div></div>
      <div class="row2"><div><label for="sc-kind">Type</label><select id="sc-kind">${[['school', 'Chiropractic school'], ['event', 'Graduation / school event'], ['campaign', 'Other campaign']].map(([k, l]) => `<option value="${k}" ${e.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div><label for="sc-cost">Spend to date ($)</label><input type="number" id="sc-cost" min="0" step="0.01" value="${e.campaignCost || ''}"></div></div>
      <div class="row2"><div><label for="sc-city">City</label><input type="text" id="sc-city" value="${pvT(e.city)}"></div><div><label for="sc-state">State</label><input type="text" id="sc-state" maxlength="2" value="${pvT(e.state)}"></div></div>
      <label for="sc-headline">Landing page headline (optional)</label><input type="text" id="sc-headline" value="${pvT(e.headline)}" placeholder="Default: Join the Chiropractic Coverage Network">
      <label style="display:flex;gap:8px;align-items:center;margin-top:12px;"><input type="checkbox" id="sc-active" ${e.active ? 'checked' : ''} style="width:auto;"> Active (link works${e.kind === 'school' ? ' and school appears in the sign-up list' : ''})</label>
      <div class="err-msg" id="sc-err"></div>
      <div style="display:flex;gap:8px;"><button class="btn" id="sc-save">${e.id ? 'Save changes' : 'Add link'}</button>${e.id ? '<button class="btn ghost" id="sc-new">New instead</button>' : ''}</div>
    </div>
    ${list.map(s => `
      <div class="blk ${s.active ? 'booked' : ''}" style="margin-bottom:8px;flex-direction:column;align-items:stretch;">
        <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;">
          <div class="bd">${pvT(s.name)}${s.active ? '' : ' <span style="font-weight:400;color:#8a8171;">(inactive)</span>'}</div>
          <div style="display:flex;gap:6px;"><button class="btn ghost sm" data-sc-qr="${s.id}">QR code</button><button class="btn ghost sm" data-sc-edit="${s.id}">Edit</button></div>
        </div>
        <div class="bn"><a href="${escHtml(s.url)}?preview=1" target="_blank" rel="noopener">${escHtml(s.url)}</a> · ${s.kind}${s.city ? ' · ' + pvT(s.city) + ', ' + pvT(s.state) : ''}</div>
        <div class="bn">${s.visits} visit${s.visits === 1 ? '' : 's'} · ${s.viaLink} signed up via link · ${s.students} total from this school${s.campaignCost ? ' · spend ' + money(s.campaignCost) : ''}</div>
        ${pvAdm.qrOpen === s.id ? `<div style="margin-top:10px;text-align:center;"><canvas id="sc-qr-canvas" style="width:220px;height:220px;border:1px solid var(--line);"></canvas>
          <div style="margin-top:6px;"><a class="btn ghost sm" id="sc-qr-dl" download="qr-join-${escHtml(s.slug)}.png">Download PNG</a> <button class="btn ghost sm" id="sc-copy">Copy link</button></div></div>` : ''}
      </div>`).join('')}`;
  $('sc-save').addEventListener('click', async () => {
    const body = { id: e.id || null, name: $('sc-name').value.trim(), slug: $('sc-slug').value.trim().toLowerCase(), kind: $('sc-kind').value, campaignCost: Number($('sc-cost').value || 0),
      city: $('sc-city').value.trim(), state: $('sc-state').value.trim().toUpperCase(), headline: $('sc-headline').value.trim(), active: $('sc-active').checked };
    try { await apiFetch('/api/provider.php?action=admin_school_save', { method: 'POST', body: JSON.stringify(body) }); pvAdm.editSchool = null; showToast('Saved.'); await pvLoadSub('schools'); pvSchools(el); }
    catch (err) { $('sc-err').textContent = err.message; }
  });
  if ($('sc-new')) $('sc-new').addEventListener('click', () => { pvAdm.editSchool = null; pvSchools(el); });
  el.querySelectorAll('[data-sc-edit]').forEach(b => b.addEventListener('click', () => { pvAdm.editSchool = list.find(s => s.id === Number(b.dataset.scEdit)); pvSchools(el); el.scrollIntoView({ behavior: 'smooth' }); }));
  el.querySelectorAll('[data-sc-qr]').forEach(b => b.addEventListener('click', () => { const id = Number(b.dataset.scQr); pvAdm.qrOpen = pvAdm.qrOpen === id ? null : id; pvSchools(el); }));
  const canvas = $('sc-qr-canvas');
  if (canvas) {
    const s = list.find(x => x.id === pvAdm.qrOpen);
    drawQrCode(canvas, s.url);
    $('sc-qr-dl').href = canvas.toDataURL('image/png');
    $('sc-copy').addEventListener('click', () => { navigator.clipboard.writeText(s.url).then(() => showToast('Link copied.')); });
  }
}

// ---------- supply ----------
let pvMap = null;
function pvSupply(el){
  const d = pvAdm.supply;
  if (!d) { el.innerHTML = '<div class="empty">Loading…</div>'; return; }
  const groups = { byState: 'State', byMetro: 'Metro area', byCounty: 'County', byZip: 'ZIP code' };
  const g = d[pvAdm.supplyGroup] || [];
  const r = d.radius;
  el.innerHTML = `
    <div class="admin-card" style="margin-bottom:20px;">
      <h3>Coverage supply around a clinic</h3>
      <p style="font-size:0.8rem;color:#6b7280;">Enter a clinic's ZIP to see how many coverage-ready DCs are nearby — and how many of those said they'd travel that far — before marketing to clinics in that market. Distances are approximate driving miles.</p>
      <div class="ai-row"><input type="text" id="sp-zip" maxlength="5" placeholder="Clinic ZIP, e.g. 32801" value="${escHtml(pvAdm.supplyZip)}" style="max-width:200px;"><button class="btn sm" id="sp-go">Check supply</button></div>
      ${r ? `<p style="font-size:0.84rem;margin-top:10px;">${escHtml(r.zip)}${r.city ? ' · ' + pvT(r.city) : ''}${r.county ? ', ' + pvT(r.county) : ''}${r.state ? ', ' + pvT(r.state) : ''}</p>
        ${pvTable(['Within', 'Coverage-ready', '…who will travel that far', 'In pipeline (not ready)'], r.rings.map(x => [`${x.miles} miles`, `<strong>${x.ready}</strong>`, x.readyWillTravel, x.pipeline]))}` : ''}
    </div>
    <div class="admin-card" style="margin-bottom:20px;"><h3>Provider map</h3>
      <div id="sp-map" style="height:360px;border-radius:6px;"></div>
      <p style="font-size:0.76rem;color:#8a8171;margin-top:6px;">Teal = coverage-ready (circle = their travel radius) · gold = in the pipeline. Positions are ZIP-level.</p></div>
    <div class="admin-card"><h3>Density by ${groups[pvAdm.supplyGroup].toLowerCase()}</h3>
      <div class="ai-row" style="margin-bottom:10px;">${Object.entries(groups).map(([k, l]) => `<button class="btn ${pvAdm.supplyGroup === k ? '' : 'ghost'} sm" data-sp-group="${k}">${l}</button>`).join('')}</div>
      ${g.length ? pvTable([groups[pvAdm.supplyGroup], 'Coverage-ready', 'Pipeline', 'Registered'], g.map(x => [pvT(x.key), `<strong>${x.ready}</strong>`, x.pipeline, x.registered])) : '<p style="font-size:0.85rem;color:#6b7280;">No providers yet.</p>'}
    </div>`;
  const go = async () => { pvAdm.supplyZip = $('sp-zip').value.trim(); await pvLoadSub('supply'); renderProvidersTab($('admin-list')); };
  $('sp-go').addEventListener('click', go);
  $('sp-zip').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  el.querySelectorAll('[data-sp-group]').forEach(b => b.addEventListener('click', () => { pvAdm.supplyGroup = b.dataset.spGroup; pvSupply(el); }));
  if (typeof L === 'undefined') return;
  if (pvMap) { pvMap.remove(); pvMap = null; }
  pvMap = L.map('sp-map').setView(r ? [r.lat, r.lng] : [28.1, -81.6], r ? 8 : 6);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap contributors' }).addTo(pvMap);
  d.points.forEach(p => {
    if (p.ready) L.circle([p.lat, p.lng], { radius: p.radius * 1609.34 / 1.22, color: '#2F5D53', weight: 1, fillOpacity: 0.04 }).addTo(pvMap);
    L.circleMarker([p.lat, p.lng], { radius: 6, color: p.ready ? '#1F3F38' : '#B8863F', fillColor: p.ready ? '#2F5D53' : '#B8863F', fillOpacity: 0.85, weight: 1 })
      .bindPopup(`${escHtml(p.name)}<br>${p.ready ? 'Coverage-ready' : escHtml((pvAdm.lifecycle || {})[p.stage] || p.stage)} · travels ${p.radius} mi`).addTo(pvMap);
  });
  if (r) L.marker([r.lat, r.lng]).bindPopup('Clinic ZIP ' + escHtml(r.zip)).addTo(pvMap);
  setTimeout(() => pvMap && pvMap.invalidateSize(), 50);
}

// ---------- automation ----------
function pvAutomation(el){
  const s = pvAdm.settings;
  if (!s) { el.innerHTML = '<div class="empty">Loading…</div>'; return; }
  const a = s.automation;
  el.innerHTML = `
    <div class="admin-card" style="margin-bottom:20px;">
      <h3>Credential follow-up emails</h3>
      <p style="font-size:0.8rem;color:#6b7280;">For providers who aren't coverage-ready yet. Timed from their graduation date (or sign-up, if later). Each email asks only for what's actually missing — license, then malpractice, or a correction — and nothing is sent while both credentials are submitted and under review. All reminders stop the moment both are verified.</p>
      <label style="display:flex;gap:8px;align-items:center;"><input type="checkbox" id="au-enabled" ${a.enabled ? 'checked' : ''} style="width:auto;"> Send follow-ups</label>
      <div class="row2"><div><label for="au-days">Days after graduation</label><input type="text" id="au-days" value="${a.followupDays.join(', ')}"></div>
        <div><label for="au-repeat">Then repeat every (days)</label><input type="number" id="au-repeat" min="7" max="365" value="${a.repeatDays}"></div></div>
      <div class="row2"><div><label for="au-gap">Minimum days between follow-ups</label><input type="number" id="au-gap" min="1" max="90" value="${a.minGapDays}"></div>
        <div><label for="au-renew">Renewal reminders (days before expiry)</label><input type="text" id="au-renew" value="${a.renewalDays.join(', ')}"></div></div>
      <div class="err-msg" id="au-err"></div>
      <button class="btn" id="au-save">Save schedule</button>
    </div>
    <div class="admin-card">
      <h3>Acquisition spend by source</h3>
      <p style="font-size:0.8rem;color:#6b7280;">Total spent per channel, for cost per registered / coverage-ready provider on the Funnel page. School and event spend is entered per link instead.</p>
      ${Object.entries(s.sources).filter(([k]) => !['school', 'event'].includes(k)).map(([k, l]) => `<div class="row2" style="align-items:center;"><div style="font-size:0.85rem;">${escHtml(l)}</div><div><input type="number" min="0" step="0.01" data-spend="${k}" value="${s.spend[k] || ''}"></div></div>`).join('')}
      <div class="err-msg" id="sp-err"></div>
      <button class="btn" id="sp-save">Save spend</button>
    </div>`;
  const nums = v => v.split(/[,\s]+/).map(Number).filter(n => n > 0);
  $('au-save').addEventListener('click', async () => {
    const automation = { enabled: $('au-enabled').checked, followupDays: nums($('au-days').value), repeatDays: Number($('au-repeat').value), minGapDays: Number($('au-gap').value), renewalDays: nums($('au-renew').value) };
    try { const r = await apiFetch('/api/provider.php?action=admin_settings_save', { method: 'POST', body: JSON.stringify({ automation }) }); pvAdm.settings.automation = r.automation; showToast('Schedule saved.'); pvAutomation(el); }
    catch (e) { $('au-err').textContent = e.message; }
  });
  $('sp-save').addEventListener('click', async () => {
    const spend = {}; el.querySelectorAll('[data-spend]').forEach(i => { if (Number(i.value) > 0) spend[i.dataset.spend] = Number(i.value); });
    try { const r = await apiFetch('/api/provider.php?action=admin_settings_save', { method: 'POST', body: JSON.stringify({ spend }) }); pvAdm.settings.spend = r.spend; showToast('Spend saved.'); }
    catch (e) { $('sp-err').textContent = e.message; }
  });
}
