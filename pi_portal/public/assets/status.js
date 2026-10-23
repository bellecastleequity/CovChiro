// Attorney / case manager reply page for a status request. The link token
// is the only access; the page shows which client and takes a short,
// structured reply that goes into the provider's case file.
'use strict';
(async () => {
  const box = document.getElementById('status');
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const token = new URLSearchParams(location.search).get('t') || '';
  const day = (d) => d ? new Date(d.slice(0, 10) + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '';
  const money = (n) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const message = (title, text, cls = 'off') => { box.innerHTML = `<div class="verify-card ${cls}"><div><h1>${esc(title)}</h1><p class="muted">${esc(text)}</p></div></div>`; };
  const api = async (action, body) => {
    const res = await fetch(`api/status.php?action=${action}&t=${encodeURIComponent(token)}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
    let data = null; try { data = await res.json(); } catch { data = { error: 'Something went wrong. Please try again.' }; }
    return { ok: res.ok, data };
  };
  const r = await api('view');
  if (!r.ok) return message(r.data.code === 'closed' ? 'No reply needed' : 'Link not available', r.data.error);
  const d = r.data, pr = d.practice;
  if (d.respondedAt) return message('Thank you', `A reply was received on ${day(d.respondedAt)}. To add anything, please contact ${pr.name}${pr.phone ? ' at ' + pr.phone : ''}.`, 'ok');
  const fees = d.narrativeFees || {};
  const dateInput = (k, l) => `<div><label for="sr-${k}">${esc(l)}</label><input type="date" id="sr-${k}" name="${k}" value="${esc(d.known[k] || '')}"></div>`;
  box.innerHTML = `<div class="status-head">
      <p class="eyebrow">Case status update request</p>
      <h1>${esc(pr.name)}</h1>
      <p class="muted">${esc([pr.address, pr.phone].filter(Boolean).join(' · '))}</p></div>
    <div class="status-client">
      <div><small>Your client</small><b>${esc(d.patient)}</b></div>
      ${d.dateOfInjury ? `<div><small>Date of injury</small><b>${esc(day(d.dateOfInjury))}</b></div>` : ''}
      <div><small>Provider's case #</small><b>${esc(d.caseNumber)}</b></div>
      ${d.lastVisit ? `<div><small>Last date of service</small><b>${esc(day(d.lastVisit))}</b></div>` : ''}
      ${d.balance !== null ? `<div><small>Outstanding balance</small><b>${esc(money(d.balance))}</b></div>` : ''}</div>
    <form id="sr-form" class="status-form" novalidate>
      <fieldset><legend>Current status of the case</legend>
        ${Object.entries(d.options).map(([k, l]) => `<label class="radio"><input type="radio" name="status" value="${k}"> ${esc(l)}</label>`).join('')}</fieldset>
      <fieldset><legend>Upcoming or recent dates <span class="muted">(if any)</span></legend><div class="status-grid">${Object.entries(d.dates).map(([k, l]) => dateInput(k, l)).join('')}</div></fieldset>
      <fieldset id="sr-pay"><legend>Payment to this office <span class="muted">(if sent)</span></legend><div class="status-grid">
        <div><label for="sr-paid-on">Date sent</label><input type="date" id="sr-paid-on" name="payment_sent_on"></div>
        <div><label for="sr-amt">Amount</label><input type="number" id="sr-amt" name="payment_amount" min="0" step="0.01" inputmode="decimal"></div>
        <div><label for="sr-chk">Check #</label><input id="sr-chk" name="check_number" maxlength="40"></div></div></fieldset>
      ${d.narrative ? `<fieldset><legend>Final narrative report</legend><p class="small muted">Treatment has ended. Would you like a final narrative report for your client? ${fees.charge && (fees.without_ratings || fees.with_ratings) ? 'This office charges a fee for the report, as shown; it is added to the patient\'s account balance.' : 'There is no charge for the report.'}</p>
        ${Object.entries(d.narrative).map(([k, l]) => `<label class="radio"><input type="radio" name="narrative" value="${k}"> ${esc(l)}${fees[k] ? ` — <b>fee ${esc(money(fees[k]))}</b>` : ''}</label>`).join('')}
        <label class="radio status-ack" id="sr-ack" hidden><input type="checkbox" name="ack_fee" value="1"> <span>I acknowledge the narrative report fee of <b id="sr-ack-amt"></b>, to be added to the patient's account balance.</span></label></fieldset>` : ''}
      <fieldset><legend>Do you need anything from the office?</legend>
        ${Object.entries(d.needs).map(([k, l]) => `<label class="radio"><input type="checkbox" name="needs" value="${k}"> ${esc(l)}</label>`).join('')}</fieldset>
      <label for="sr-note">Anything else? <span class="muted">(optional)</span></label><textarea id="sr-note" name="note" rows="3" maxlength="2000"></textarea>
      <div class="status-grid"><div><label for="sr-name">Your name</label><input id="sr-name" name="name" maxlength="120" required autocomplete="name"></div>
        <div><label for="sr-email">Your email <span class="muted">(optional)</span></label><input id="sr-email" name="email" type="email" maxlength="190" autocomplete="email"></div></div>
      <p class="err" id="sr-err" role="alert"></p>
      <button class="btn lg" type="submit">Send update</button>
    </form>`;
  const form = document.getElementById('sr-form');
  // Choosing a report that carries a fee asks for the acknowledgment.
  const feeFor = () => fees[(form.querySelector('input[name="narrative"]:checked') || {}).value] || null;
  form.addEventListener('change', (e) => {
    if (e.target.name !== 'narrative') return;
    const ack = document.getElementById('sr-ack'), f = feeFor();
    ack.hidden = !f;
    if (f) document.getElementById('sr-ack-amt').textContent = money(f); else ack.querySelector('input').checked = false;
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form), body = {};
    for (const [k, v] of f.entries()) if (k !== 'needs') body[k] = v;
    body.needs = f.getAll('needs');
    const err = document.getElementById('sr-err');
    if (!body.status) { err.textContent = 'Choose the current status of the case.'; return; }
    if (!String(body.name || '').trim()) { err.textContent = 'Enter your name.'; return; }
    if (d.narrative && feeFor() && !body.ack_fee) { err.textContent = `Please acknowledge the narrative report fee of ${money(feeFor())}, or choose a different option.`; return; }
    form.querySelector('button').disabled = true;
    const res = await api('reply', body);
    if (res.ok) message('Thank you — update received', `${pr.name} has your update. You can close this page.`, 'ok');
    else { err.textContent = res.data.error; form.querySelector('button').disabled = false; }
  });
})();
