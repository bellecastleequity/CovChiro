// Unsubscribe page for outreach emails: one button, no sign-in.
'use strict';
(async () => {
  const box = document.getElementById('unsub');
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const token = new URLSearchParams(location.search).get('t') || '';
  const done = () => { box.className = 'verify-card ok'; box.innerHTML = '<div><h1>You\'re unsubscribed</h1><p class="muted">You won\'t receive any more emails from InjuryCase. Sorry for the interruption.</p></div>'; };
  let r;
  try { r = await (await fetch('api/m.php?a=info&t=' + encodeURIComponent(token))).json(); } catch { r = { error: 'Something went wrong. Reply to the email with "unsubscribe" and we\'ll remove you.' }; }
  if (r.error) { box.className = 'verify-card off'; box.innerHTML = `<div><h1>Link not recognized</h1><p class="muted">${esc(r.error)}</p></div>`; return; }
  if (r.unsubscribed) return done();
  box.innerHTML = `<div><h1>Unsubscribe from InjuryCase emails?</h1><p class="muted">${r.email ? esc(r.email) + ' will' : 'You\'ll'} no longer receive any emails from us.</p>
    <button class="btn lg" id="unsub-btn" type="button">Unsubscribe</button><p class="err" id="unsub-err"></p></div>`;
  document.getElementById('unsub-btn').addEventListener('click', async (e) => {
    e.target.disabled = true;
    const res = await fetch('api/m.php?a=u&t=' + encodeURIComponent(token), { method: 'POST' });
    if (res.ok) done(); else { document.getElementById('unsub-err').textContent = 'That didn\'t work. Reply to the email with "unsubscribe" and we\'ll remove you.'; e.target.disabled = false; }
  });
})();
