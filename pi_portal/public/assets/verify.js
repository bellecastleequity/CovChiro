// Badge verification page: asks the server whether the badge token in the
// link belongs to a practice that currently qualifies.
'use strict';
(async () => {
  const box = document.getElementById('verify');
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const token = new URLSearchParams(location.search).get('t') || '';
  const when = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const show = (cls, img, title, text) => {
    box.className = 'verify-card ' + cls;
    box.innerHTML = `<img src="api/badge.php?t=${encodeURIComponent(token)}&style=seal" width="120" height="120" alt="">
      <div><h1>${title}</h1>${text}</div>`;
    if (!img) box.querySelector('img').remove();
  };
  let r = null;
  try { r = await (await fetch('api/badge.php?action=verify&t=' + encodeURIComponent(token))).json(); } catch { /* shown below */ }
  if (r?.status === 'certified') {
    const since = r.since ? new Date(r.since + 'T12:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : '';
    show('ok', true, `${esc(r.practice)}${r.state ? ', ' + esc(r.state) : ''}`,
      `<p class="verify-status">✓ Verified InjuryCase Certified practice</p>${since ? `<p class="muted">Certified since ${esc(since)}</p>` : ''}<p class="small muted">Checked ${esc(when(r.checkedAt))}</p>`);
  } else if (r?.status === 'inactive') {
    show('off', false, 'Not currently certified', '<p class="muted">This badge belongs to a practice whose certification is not active right now.</p>');
  } else if (r) {
    show('off', false, 'Badge not recognized', '<p class="muted">We couldn\'t match this badge to a certified practice. If you found it on a website, the link may be out of date or copied.</p>');
  } else {
    show('off', false, 'Couldn\'t check right now', '<p class="muted">Please try again in a moment.</p>');
  }
})();
