// Screens for the full walkthrough video. Run after seed_and_shoot.js (it
// seeds the fictional demo clinic and saves its sign-in code secret), then:
//   node walkthrough_shoot.js shots_walk
// Opens one fictional patient's case through the real New case form and moves
// it from intake to a closed, paid case, capturing each step.
const { chromium } = require('playwright'); const crypto = require('crypto'); const fs = require('fs'); const path = require('path');
const b32 = (s) => { const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = ''; for (const c of s.replace(/=+$/, '')) bits += a.indexOf(c).toString(2).padStart(5, '0'); const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); };
const totp = (sec) => { const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000))); const h = crypto.createHmac('sha1', b32(sec)).update(buf).digest(); const o = h[19] & 15; return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0'); };
const ago = (d) => new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);
const range = (from, to, step) => { const a = []; for (let d = from; d >= to; d -= step) a.push(d); return a; };
const OUT = process.argv[2]; const B = 'http://localhost:8080/';
const HIDE = '#banner,.phi-banner{display:none!important}';

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const secret = fs.readFileSync(path.join(__dirname, '.build', 'demo_mfa.txt'), 'utf8').trim();
  const br = await chromium.launch();
  const ctx = await br.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.5, bypassCSP: true }); const q = await ctx.newPage();
  await new Promise((r) => setTimeout(r, (30 - (Date.now() / 1000) % 30 + 1) * 1000));
  await q.goto(B + 'app.html'); await q.fill('#li-email', 'alex@bayside-demo.test'); await q.fill('#li-pw', 'Bayside-Demo-Pass-26'); await q.click('button[type=submit]');
  await q.waitForSelector('#mf-code'); await q.fill('#mf-code', totp(secret)); await q.click('button[type=submit]'); await q.waitForTimeout(2000);

  // API calls ride on the signed-in browser session.
  const ua = await q.evaluate(() => navigator.userAgent);
  let tk = (await (await q.request.get(B + 'api/auth.php?action=session', { headers: { 'User-Agent': ua } })).json()).csrf || '';
  const post = async (u, d) => { const r = await q.request.post(B + 'api/' + u, { data: d, headers: { 'X-CSRF-Token': tk, 'User-Agent': ua } }); const j = await r.json(); if (j.csrf) tk = j.csrf; if (r.status() >= 400) console.log('ERR', u, JSON.stringify(j).slice(0, 200)); return j; };
  const get = async (u) => (await q.request.get(B + 'api/' + u, { headers: { 'User-Agent': ua } })).json();

  // A full load each time: a hash-only change can show the app's cached copy of the case.
  const go = async (hash) => { await q.goto('about:blank'); await q.goto(B + 'app.html#/' + hash); await q.waitForTimeout(1600); await q.addStyleTag({ content: HIDE }); await q.waitForTimeout(200); };
  const shot = async (hash, name, opts = {}) => { await go(hash); if (opts.after) await opts.after(); await q.waitForTimeout(400); await q.screenshot({ path: `${OUT}/${name}.png`, fullPage: !!opts.full }); console.log('shot', name); };
  const crop = async (hash, sel, name, after) => {
    if (hash !== null) await go(hash);
    if (after) await after();
    try { const el = q.locator(sel).first(); await el.scrollIntoViewIfNeeded({ timeout: 5000 }); await q.waitForTimeout(300); await el.screenshot({ path: `${OUT}/${name}.png`, timeout: 5000 }); console.log('crop', name); } catch (e) { console.log('MISSING', name, sel); }
  };
  const letter = async (id, type, name) => {
    const lp = await ctx.newPage(); await lp.setViewportSize({ width: 1100, height: 1000 });
    await lp.goto(B + `api/cases.php?action=letter&id=${id}&type=${type}`); await lp.waitForTimeout(800); await lp.screenshot({ path: `${OUT}/${name}.png` }); await lp.close(); console.log('letter', name);
  };

  // ---------- 1. Intake: the New case form, filled in as the front desk would ----------
  const atty = (await get('contacts.php?action=list')).contacts?.find((c) => /Hartwell/.test(c.organization || ''));
  await go('dashboard');
  await q.setViewportSize({ width: 1600, height: 2300 });
  await q.click('[data-act=new-case]'); await q.waitForTimeout(800);
  await q.locator('input[name=new_case_type]').first().check({ force: true });
  await q.fill('#f_first_name', 'Maya'); await q.fill('#f_last_name', 'Collins'); await q.fill('#f_dob', '1991-04-12');
  await q.fill('#f_phone', '(813) 555-0187'); await q.fill('#f_email', 'maya.collins@example.com'); await q.fill('#f_address', '418 Palm Ave, Tampa, FL 33606');
  await q.fill('#f_date_of_injury', ago(2)); await q.fill('#f_first_visit', ago(0));
  await q.selectOption('#f_referral_source', 'attorney');
  if (atty) await q.selectOption('#f_attorney_contact_id', String(atty.id));
  await q.fill('#f_paralegal', 'Renee — (813) 555-0119');
  await q.selectOption('#f_provider_user_id', { index: 1 });
  await q.selectOption('#f_head_injury', 'no');
  await q.selectOption('#f_cov_type', 'pip'); await q.fill('#f_cov_carrier_text', 'Sunshine Mutual Insurance');
  await q.fill('#f_cov_claim', 'SM-24-118842'); await q.fill('#f_cov_adjuster', 'Kim Alvarez');
  await q.waitForTimeout(400);
  await q.locator('.modal').first().screenshot({ path: `${OUT}/form.png` }); console.log('crop form');
  await q.click('button:has-text("Create case")'); await q.waitForTimeout(2500);
  await q.setViewportSize({ width: 1600, height: 1000 });
  const id = +(q.url().match(/case\/(\d+)/) || [])[1] || (await get('cases.php?action=list')).cases.find((c) => c.patient === 'Maya Collins').id;
  console.log('case', id);
  await shot(`case/${id}/overview`, 'newcase');
  await shot(`case/${id}/checklist`, 'checklist');

  // ---------- 2. Five weeks of care ----------
  const doc = (await get('auth.php?action=session')).user.id;
  const child = (table, row) => post(`cases.php?action=child_save&id=${id}`, { table, row });
  await post(`cases.php?action=update&id=${id}`, { case: { date_of_injury: ago(58), first_visit: ago(56), emc_status: 'yes', emc_by: 'MD', emc_on: ago(51), plan_visits_per_week: 3, plan_set_on: ago(56), lop_signed_on: ago(56), stage: 'treating',
    bi_limit: 50000, um_limit: 25000, other_medical_estimate: 3800, limits_source: 'Attorney call — Dana Hartwell', limits_noted_on: ago(54), liability_carrier: 'Gulfstream Auto' } });
  let d = await get(`cases.php?action=get&id=${id}`);
  const cov = d.coverages[0]?.id;
  if (cov) await child('coverages', { id: cov, type: 'pip', benefit_limit: 10000, remaining_reported: 5600, remaining_reported_on: ago(25) });
  const visitDays = range(56, 1, 2);
  for (const v of visitDays) await child('visits', { visit_date: ago(v), visit_type: v === 56 ? 'initial' : v === 26 ? 're_exam' : 'treatment', provider_user_id: doc, cpt_codes: v === 56 ? '99203, 98941, 97140' : '98941, 97140, 97112' });
  for (const [m, sc, day] of [['ndi', 48, 56], ['ndi', 30, 26], ['oswestry', 42, 56], ['oswestry', 28, 26]]) await child('outcomes', { measure: m, score: sc, taken_on: ago(day) });
  const img = (await get('contacts.php?action=list')).contacts?.find((c) => c.type === 'imaging');
  await child('referrals', { type: 'mri', contact_id: img?.id, body_region: 'C-spine', status: 'report_received', ordered_on: ago(56), scheduled_on: ago(50), completed_on: ago(49), report_received_on: ago(47), entered_in_chart: 1, findings: 'C5-6 disc protrusion with mild foraminal narrowing.' });
  for (const v of visitDays) await child('ledger', { entry_date: ago(v), kind: 'charge', bucket: 'insurance', coverage_id: cov, amount: v === 56 ? 475 : 295 });
  await child('ledger', { entry_date: ago(25), kind: 'payment', bucket: 'insurance', coverage_id: cov, amount: 3260, reference: 'EOB 44817' });
  await child('correspondence', { occurred_on: ago(56), direction: 'in', method: 'email', contact_id: atty?.id, subject: 'Letter of representation received' });
  await child('correspondence', { occurred_on: ago(54), direction: 'out', method: 'phone', contact_id: atty?.id, subject: 'Called attorney — policy limits $50k BI / $25k UM' });
  d = await get(`cases.php?action=get&id=${id}`);
  for (const it of d.checklist) if (['overdue', 'due'].includes(it.status) && !it.auto) await post(`cases.php?action=milestone&id=${id}`, { key: it.key, completed_on: it.due || ago(50) });
  await crop(`case/${id}/overview`, '.card.guide', 'guide');
  await crop(`case/${id}/overview`, '.card.guide', 'why', async () => {
    await q.evaluate(() => { for (const el of document.querySelectorAll('.card.guide details')) el.open = true; });
  });
  await shot(`case/${id}/referrals`, 'comanage');
  await crop(`case/${id}/overview`, '.card:has(h2:text-is("Case"))', 'limits');
  await shot(`case/${id}/visits`, 'visits');
  await shot(`case/${id}/outcomes`, 'outcomes');

  // ---------- 3. A gap in care ----------
  d = await get(`cases.php?action=get&id=${id}`);
  for (const v of d.visits) if (v.visit_date > ago(17)) await post(`cases.php?action=child_archive&id=${id}`, { table: 'visits', child_id: v.id });
  for (const l of d.ledger || []) if (l.kind === 'charge' && l.entry_date > ago(17)) await post(`cases.php?action=child_archive&id=${id}`, { table: 'ledger', child_id: l.id });
  await child('outreach', { attempted_on: ago(10), method: 'call', outcome: 'left_message' });
  await child('outreach', { attempted_on: ago(6), method: 'text', outcome: 'no_answer' });
  await child('outreach', { attempted_on: ago(3), method: 'call', outcome: 'no_answer' });
  await shot(`case/${id}/overview`, 'gap');
  await crop(`case/${id}/overview`, '.card.outreach', 'outreach');
  await letter(id, 'attendance', 'attendance');
  await post('cases.php?action=task_save', { title: 'Call Maya Collins to reschedule — try evening', case_id: id, due_on: ago(0), priority: 'high', assignee_ids: [doc] });
  await shot('dashboard', 'dashboard');
  await shot('huddle', 'huddle', { full: true });
  await shot('tasks', 'tasks');

  // ---------- 4. Back in care, then MMI ----------
  await child('outreach', { attempted_on: ago(2), method: 'call', outcome: 'spoke_scheduled' });
  for (const v of [1, 0]) { await child('visits', { visit_date: ago(v), visit_type: v === 0 ? 're_exam' : 'treatment', provider_user_id: doc }); await child('ledger', { entry_date: ago(v), kind: 'charge', bucket: 'insurance', coverage_id: cov, amount: 295 }); }
  for (const [m, sc] of [['ndi', 12], ['oswestry', 10]]) await child('outcomes', { measure: m, score: sc, taken_on: ago(0) });
  await go(`case/${id}/overview`);
  try { await q.click('[data-act=mmi]'); await q.waitForTimeout(800); await q.addStyleTag({ content: HIDE }); await q.locator('.modal').first().screenshot({ path: `${OUT}/mmi.png` }); console.log('crop mmi'); await q.keyboard.press('Escape'); } catch (e) { console.log('MISSING mmi'); }
  await post(`cases.php?action=mmi&id=${id}`, { plan: 'discharge', date: ago(0) });
  await child('ledger', { entry_date: ago(0), kind: 'payment', bucket: 'insurance', coverage_id: cov, amount: 1180, reference: 'EOB 45210' });
  await letter(id, 'tx_complete', 'txletter');
  await child('correspondence', { occurred_on: ago(5), direction: 'out', method: 'fax', contact_id: atty?.id, subject: 'Scheduling assistance letter' });
  await child('correspondence', { occurred_on: ago(2), direction: 'in', method: 'phone', contact_id: atty?.id, subject: 'Paralegal confirmed Maya rescheduled' });
  await child('correspondence', { occurred_on: ago(0), direction: 'out', method: 'fax', contact_id: atty?.id, subject: 'Treatment complete letter + itemized bill', follow_up_on: ago(-30) });
  await shot(`case/${id}/correspondence`, 'correspondence');

  // ---------- 5. Getting paid ----------
  d = await get(`cases.php?action=get&id=${id}`);
  const insBal = d.totals?.insurance_balance ?? 0;
  if (insBal > 0) await child('ledger', { entry_date: ago(0), kind: 'transfer', bucket: 'insurance', coverage_id: cov, to_bucket: 'patient', amount: insBal, memo: 'Balance after PIP moved to the LOP' });
  await crop(`case/${id}/financials`, '.case-value', 'value');
  await shot(`case/${id}/financials`, 'ledger', { full: true });
  await shot('ar', 'ar');
  await post(`cases.php?action=update&id=${id}`, { case: { stage: 'negotiating', atty_offer: Math.round((d.totals?.total_balance || 3000) * 0.5), final_settlement: 42500 } });
  await letter(id, 'reduction_response', 'reduction');
  await post(`cases.php?action=update&id=${id}`, { case: { stage: 'settled', date_authorized: ago(0) } });
  await shot(`case/${id}/financials`, 'settled');
  await post(`cases.php?action=update&id=${id}`, { case: { stage: 'closed', check_received_on: ago(0) } });
  await shot(`case/${id}/overview`, 'closed');

  // ---------- 6. The office side ----------
  await post('admin.php?action=step_save', { title: 'Welcome call to the patient', detail: 'Check in after the first visit: questions, next appointment, transportation.', cases: ['auto', 'slip_fall', 'other_pi'], anchor: 'first_visit', days: 1 });
  await post('admin.php?action=step_save', { title: '30-day progress photos', detail: 'Posture and range-of-motion photos for the file.', cases: ['auto', 'slip_fall'], anchor: 'first_visit', days: 30 });
  await post('admin.php?action=step_save', { title: 'Final balance call to the attorney', anchor: 'care_end', days: 14 });
  await crop('settings', '.card:has(h2:text-is("Case steps & checklist"))', 'steps');
  for (const [name, email, role] of [['Jess Romero', 'jess@bayside-demo.test', 'staff'], ['Tom Becker', 'tom@bayside-demo.test', 'billing'], ['Dr. Priya Nair', 'priya@bayside-demo.test', 'provider']]) await post('admin.php?action=user_save', { name, email, role });
  await shot('admin', 'team');
  await crop('settings', '.card:has(h2:text-is("Financial visibility for staff"))', 'finvis');
  await shot('audit', 'audit');
  await br.close(); console.log('done');
})();
