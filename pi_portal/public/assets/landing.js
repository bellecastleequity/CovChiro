// Landing page: renders the pricing cards from the same plan list the app
// enforces (app/saas.php), so prices on the website can't drift from what
// customers are actually billed.
'use strict';
(() => {
  document.getElementById('year').textContent = new Date().getFullYear();
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  fetch('api/auth.php?action=plans', { credentials: 'same-origin' }).then((r) => r.json()).then((d) => {
    document.getElementById('trial-days').textContent = d.trialDays;
    const keys = Object.keys(d.plans);
    document.getElementById('pricing-cards').innerHTML = keys.map((k, i) => {
      const p = d.plans[k];
      const featured = i === 1;
      return `<div class="price-card${featured ? ' featured' : ''}">${featured ? '<span class="badge">Most popular</span>' : ''}
        <h3>${esc(p.name)}</h3><p class="muted">${esc(p.blurb)}</p>
        <div class="amount">$${esc(p.price)}<span>/month</span></div>
        <ul><li>${p.active_cases ? esc(p.active_cases) + ' open cases' : 'Unlimited open cases'}</li><li>${p.users ? esc(p.users) + ' team members' : 'Unlimited team members'}</li>
          <li>Unlimited closed cases</li><li>Every feature included</li><li>BAA &amp; two-factor security</li></ul>
        <a class="btn${featured ? '' : ' ghost'}" href="app.html#signup?plan=${encodeURIComponent(k)}">Start free trial</a></div>`;
    }).join('');
  }).catch(() => { /* pricing is optional on the page */ });
})();
