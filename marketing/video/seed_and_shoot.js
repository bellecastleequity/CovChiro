// Seeds a fictional demo clinic through the real API, then screenshots the
// app for the sales video. All patient, attorney and clinic names are made up.
const { chromium } = require('playwright'); const crypto = require('crypto');
const b32 = (s) => { const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = ''; for (const c of s.replace(/=+$/, '')) bits += a.indexOf(c).toString(2).padStart(5, '0'); const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); };
const totp = (sec) => { const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000))); const h = crypto.createHmac('sha1', b32(sec)).update(buf).digest(); const o = h[19] & 15; return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0'); };
const ago = (d) => new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);
const OUT = process.argv[2];
(async () => {
  const B = 'http://localhost:8080/';
  const br = await chromium.launch(); const ctx = await br.newContext({ viewport: { width: 1600, height: 1000 } }); const p = await ctx.newPage();
  await p.goto(B + 'app.html'); const ua = await p.evaluate(() => navigator.userAgent);
  let tk = (await (await p.request.get(B + 'api/auth.php?action=session', { headers: { 'User-Agent': ua } })).json()).csrf || '';
  const post = async (u, d) => { const r = await p.request.post(B + 'api/' + u, { data: d, headers: { 'X-CSRF-Token': tk, 'User-Agent': ua } }); const j = await r.json(); if (j.csrf) tk = j.csrf; if (r.status() >= 400) console.log('ERR', u, j); return j; };
  const get = async (u) => (await p.request.get(B + 'api/' + u, { headers: { 'User-Agent': ua } })).json();
  await post('auth.php?action=signup', { practice_name: 'Bayside Spine & Injury', name: 'Dr. Alex Morgan', email: 'alex@bayside-demo.test', password: 'Bayside-Demo-Pass-26', plan: 'practice', accept: true });
  const s = await post('auth.php?action=mfa_setup_start', {}); await post('auth.php?action=mfa_setup_confirm', { code: totp(s.secret) });
  await post('admin.php?action=practice_save', { name: 'Bayside Spine & Injury', address: '1200 Harbor Blvd, Suite 4\nTampa, FL 33602', phone: '(813) 555-0142', fax: '(813) 555-0143', state: 'FL', ehr_name: 'ChiroTouch' });
  const contact = async (type, organization, name) => (await post('contacts.php?action=save', { type, organization, name, phone: '(813) 555-01' + Math.floor(10 + Math.random() * 89) })).contact.id;
  const atty1 = await contact('attorney', 'Hartwell & Pierce, P.A.', 'Dana Hartwell'), atty2 = await contact('attorney', 'Coastal Injury Law Group', 'Marcus Lee'), atty3 = await contact('attorney', 'Sun City Trial Attorneys', 'Priya Shah');
  const img = await contact('imaging', 'Gulf Coast Open MRI', ''), ortho = await contact('ortho', 'Tampa Bay Orthopedic Associates', 'Dr. Ellen Cho');
  const doc = (await get('auth.php?action=session')).user.id;
  const mk = async (first, last, c, cov = { type: 'pip', carrier_text: 'Sunshine Mutual Insurance' }) => (await post('cases.php?action=create', { patient: { first_name: first, last_name: last, phone: '(813) 555-0' + (100 + Math.floor(Math.random() * 899)) }, case: { injury_type: 'auto', provider_user_id: doc, ...c }, coverage: cov })).id;
  const child = (id, table, row) => post('cases.php?action=child_save&id=' + id, { table, row });
  const visits = async (id, days) => {
    for (const d of days) await child(id, 'visits', { visit_date: ago(d), visit_type: d === days[0] ? 'initial' : 'treatment', provider_user_id: doc });
    for (let d = days[0] - 29; d >= days[days.length - 1]; d -= 29) { await child(id, 'visits', { visit_date: ago(d), visit_type: 're_exam', provider_user_id: doc }); await child(id, 'outcomes', { measure: 'ndi', score: 40 - Math.round((days[0] - d) / 6), taken_on: ago(d) }); }
    await child(id, 'outcomes', { measure: 'ndi', score: 44, taken_on: ago(days[0]) });
  };
  const charges = async (id, days, amt = 185) => { const d = await get('cases.php?action=get&id=' + id); const cov = d.coverages[0]?.id; for (const x of days) await child(id, 'ledger', { entry_date: ago(x), kind: 'charge', bucket: cov ? 'insurance' : 'patient', coverage_id: cov, amount: amt }); return cov; };
  const range = (from, to, step) => { const a = []; for (let d = from; d >= to; d -= step) a.push(d); return a; };

  // 1 — treating, MRI done, ortho due
  const c1 = await mk('Jordan', 'Avery', { date_of_injury: ago(34), first_visit: ago(32), attorney_contact_id: atty1, emc_status: 'yes', emc_by: 'MD', emc_on: ago(27), plan_visits_per_week: 3, plan_set_on: ago(32), head_injury: 'no', referral_source: 'attorney', stage: 'treating', lop_signed_on: ago(31) });
  await visits(c1, range(32, 1, 2)); const cov1 = await charges(c1, range(32, 1, 2));
  await child(c1, 'referrals', { type: 'mri', contact_id: img, body_region: 'C-spine', status: 'report_received', ordered_on: ago(32), completed_on: ago(24), report_received_on: ago(22), entered_in_chart: 1, findings: 'C5-6 disc protrusion with mild foraminal narrowing.' });
  await child(c1, 'ledger', { entry_date: ago(10), kind: 'payment', bucket: 'insurance', coverage_id: cov1, amount: 1480 });
  await post('cases.php?action=update&id=' + c1, { case: { bi_limit: 50000, um_limit: 25000, other_medical_estimate: 4200, limits_source: 'Attorney call — Dana Hartwell', limits_noted_on: ago(28), liability_carrier: 'Gulfstream Auto' } });
  for (const [m, sc, d] of [['ndi', 46, 31], ['ndi', 34, 3], ['oswestry', 38, 31], ['oswestry', 30, 3]]) await child(c1, 'outcomes', { measure: m, score: sc, taken_on: ago(d) });
  // 2 — brand new: MRI + EMC due
  const c2 = await mk('Taylor', 'Brooks', { date_of_injury: ago(6), first_visit: ago(3), attorney_contact_id: atty2, stage: 'intake', referral_source: 'attorney' });
  await visits(c2, [3, 1]);
  // 3 — gap in care
  const c3 = await mk('Morgan', 'Reyes', { date_of_injury: ago(60), first_visit: ago(57), attorney_contact_id: atty3, emc_status: 'yes', emc_by: 'DO', stage: 'treating', plan_visits_per_week: 2, plan_set_on: ago(57), head_injury: 'no' });
  await visits(c3, range(57, 19, 4)); await charges(c3, range(57, 19, 4));
  await child(c3, 'outreach', { attempted_on: ago(12), method: 'call', outcome: 'left_message' }); await child(c3, 'outreach', { attempted_on: ago(8), method: 'text', outcome: 'no_answer' });
  // 4 — head injury → neuro
  const c4 = await mk('Casey', 'Nguyen', { date_of_injury: ago(16), first_visit: ago(14), attorney_contact_id: atty1, emc_status: 'pending', stage: 'treating', head_injury: 'yes' });
  await visits(c4, range(14, 2, 3)); await charges(c4, range(14, 2, 3));
  await child(c4, 'referrals', { type: 'mri', contact_id: img, body_region: 'L-spine', status: 'scheduled', ordered_on: ago(14), scheduled_on: ago(-2) });
  // 5 — slip & fall on LOP
  const c5 = await mk('Riley', 'Carter', { injury_type: 'slip_fall', date_of_injury: ago(40), first_visit: ago(38), attorney_contact_id: atty2, stage: 'treating', lop_signed_on: ago(38), head_injury: 'no' }, null);
  await visits(c5, range(38, 3, 4)); await charges(c5, range(38, 3, 4), 165);
  // 6 — policy limits pressure
  const c6 = await mk('Quinn', 'Martinez', { date_of_injury: ago(95), first_visit: ago(92), attorney_contact_id: atty3, emc_status: 'yes', emc_by: 'MD', stage: 'treating', head_injury: 'no' });
  await visits(c6, range(92, 2, 3)); const cov6 = await charges(c6, range(92, 2, 3), 210);
  await child(c6, 'ledger', { entry_date: ago(40), kind: 'payment', bucket: 'insurance', coverage_id: cov6, amount: 4100 });
  await child(c6, 'referrals', { type: 'mri', contact_id: img, body_region: 'L-spine', status: 'report_received', ordered_on: ago(92), completed_on: ago(84), report_received_on: ago(82), entered_in_chart: 1, findings: 'L4-5 disc herniation.' });
  await post('cases.php?action=update&id=' + c6, { case: { bi_limit: 25000, other_medical_estimate: 9800, limits_source: 'Adjuster', limits_noted_on: ago(60), liability_carrier: 'Keystone Casualty' } });
  await child(c6, 'referrals', { type: 'ortho', contact_id: ortho, status: 'report_received', ordered_on: ago(70), completed_on: ago(55), report_received_on: ago(50), entered_in_chart: 1, findings: 'Recommends lumbar epidural steroid injection.' });
  // 7 — demand, stale attorney update
  const c7 = await mk('Jamie', 'Patel', { date_of_injury: ago(210), first_visit: ago(205), attorney_contact_id: atty1, emc_status: 'yes', emc_by: 'MD', stage: 'demand', discharge_date: ago(80), mmi_date: ago(80), head_injury: 'no' });
  await child(c7, 'correspondence', { occurred_on: ago(45), direction: 'out', method: 'fax', contact_id: atty1, subject: 'Treatment complete letter + itemized bill' });
  // 8 — settled, check pending
  const c8 = await mk('Drew', 'Thompson', { date_of_injury: ago(330), first_visit: ago(325), attorney_contact_id: atty2, stage: 'settled', discharge_date: ago(200), mmi_date: ago(200), date_authorized: ago(38), final_settlement: 85000, head_injury: 'no' });
  // 9 — workers comp
  const c9 = await mk('Avery', 'Johnson', { injury_type: 'workers_comp', date_of_injury: ago(21), first_visit: ago(19), stage: 'treating', head_injury: 'no' }, { type: 'workers_comp', carrier_text: 'Bayline Comp Insurance', authorized_visits: 12, authorized_through: ago(-20) });
  await visits(c9, range(19, 1, 2));
  // 10–13 more for the pipeline
  for (const [f, l, st, d] of [['Sam', 'Whitfield', 'negotiating', 260], ['Harper', 'Lin', 'litigation', 400], ['Reese', 'Okafor', 'treating', 22], ['Logan', 'Diaz', 'tx_complete', 120]]) {
    const id = await mk(f, l, { date_of_injury: ago(d), first_visit: ago(d - 3), attorney_contact_id: [atty1, atty2, atty3][d % 3], emc_status: 'yes', emc_by: 'MD', stage: st, head_injury: 'no' });
    if (st === 'treating') { await visits(id, range(d - 3, 1, 3)); await charges(id, range(d - 3, 1, 3)); }
  }
  await post('cases.php?action=task_save', { title: 'Request ER records from Tampa General', case_id: c2, due_on: ago(0), priority: 'high', assignee_ids: [doc] });
  await post('cases.php?action=task_save', { title: 'Call adjuster re: PIP remaining', case_id: c6, due_on: ago(1) });
  // A real clinic ticks off its intake checklist; leave the newest case open.
  const all = (await get('cases.php?action=list')).cases || [];
  for (const cs of all) {
    if (cs.id === c2) continue;
    const d = await get('cases.php?action=get&id=' + cs.id);
    for (const it of d.checklist) if (['overdue', 'due'].includes(it.status) && !it.auto) await post('cases.php?action=milestone&id=' + cs.id, { key: it.key, completed_on: it.due || ago(1) });
  }
  console.log('seeded', all.length);

  // ---- screenshots, signed in through the real login ----
  const ctx2 = await br.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.5, bypassCSP: true }); const q = await ctx2.newPage();
  await new Promise((r) => setTimeout(r, (30 - (Date.now() / 1000) % 30 + 1) * 1000));
  await q.goto(B + 'app.html'); await q.fill('#li-email', 'alex@bayside-demo.test'); await q.fill('#li-pw', 'Bayside-Demo-Pass-26'); await q.click('button[type=submit]');
  await q.waitForSelector('#mf-code'); await q.fill('#mf-code', totp(s.secret)); await q.click('button[type=submit]'); await q.waitForTimeout(2000);
  await q.addStyleTag({ content: '#banner{display:none!important}' });
  const shot = async (hash, name, after) => { await q.goto(B + 'app.html#/' + hash); await q.waitForTimeout(1600); await q.addStyleTag({ content: '#banner,.phi-banner{display:none!important}' }); if (after) await after(); await q.waitForTimeout(400); await q.screenshot({ path: `${OUT}/${name}.png` }); };
  await shot('dashboard', 'dashboard');
  await shot('case/' + c2, 'case_new');
  await shot('case/' + c1, 'case_guide', async () => { await q.locator('.card.guide').scrollIntoViewIfNeeded(); await q.evaluate(() => window.scrollBy(0, -80)); });
  await shot('huddle', 'huddle');
  const crop = async (hash, sel, name) => { await q.goto(B + 'app.html#/' + hash); await q.waitForTimeout(1600); await q.addStyleTag({ content: '#banner,.phi-banner{display:none!important}' }); try { await q.locator(sel).first().scrollIntoViewIfNeeded({ timeout: 5000 }); await q.waitForTimeout(300); await q.locator(sel).first().screenshot({ path: `${OUT}/${name}.png`, timeout: 5000 }); } catch (e) { console.log('MISSING', name); } };
  await crop('case/' + c6 + '/financials', '.case-value', 'case_value');
  await crop('case/' + c3 + '/overview', '.card.outreach', 'outreach_card');
  await crop('playbook?state=NY', '.card:has(h2:has-text("what\'s different"))', 'state_ny');
  await crop('case/' + c1 + '/overview', '.card.guide', 'guide_card');
  await shot('case/' + c3, 'outreach');
  await shot('playbook?state=FL', 'playbook');
  await shot('cases', 'cases');
  const letter = await ctx2.newPage(); await letter.setViewportSize({ width: 1100, height: 1000 });
  await letter.goto(B + 'api/cases.php?action=letter&id=' + c1 + '&type=tx_complete'); await letter.waitForTimeout(800); await letter.screenshot({ path: `${OUT}/letter.png` });
  await shot('settings', 'badge', async () => { await q.locator('#badge-card').scrollIntoViewIfNeeded(); });
  const lp = await ctx2.newPage(); await lp.setViewportSize({ width: 1600, height: 1000 }); await lp.goto(B); await lp.waitForTimeout(800);
  await lp.screenshot({ path: `${OUT}/landing.png` }); await lp.locator('#pricing').scrollIntoViewIfNeeded(); await lp.waitForTimeout(600); await lp.screenshot({ path: `${OUT}/pricing.png` });
  await lp.locator('footer').scrollIntoViewIfNeeded(); await lp.screenshot({ path: `${OUT}/trust.png` });
  await br.close(); console.log('shot');
})();
