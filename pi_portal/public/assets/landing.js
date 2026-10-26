// Landing page: renders the pricing cards from the same plan list the app
// enforces (app/saas.php), so prices on the website can't drift from what
// customers are actually billed.
'use strict';
(() => {
  document.getElementById('year').textContent = new Date().getFullYear();
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let data = null, interval = 'monthly';
  const render = () => {
    const d = data;
    const keys = Object.keys(d.plans).filter((k) => !d.plans[k].standalone);
    const annual = interval === 'annual';
    const genie = d.plans.eob;
    if (genie) { document.getElementById('genie-price').textContent = annual ? genie.annual_price : genie.price; document.querySelector('.genie-offer-price small').textContent = annual ? '/year on its own' : '/month on its own'; document.getElementById('genie-offer').hidden = false; }
    document.getElementById('pricing-cards').innerHTML = keys.map((k, i) => {
      const p = d.plans[k];
      const featured = i === 1;
      return `<div class="price-card${featured ? ' featured' : ''}">${featured ? '<span class="badge">Most popular</span>' : ''}
        <h3>${esc(p.name)}</h3><p class="muted">${esc(p.blurb)}</p>
        <div class="amount">$${esc(annual ? p.annual_price : p.price)}<span>/${annual ? 'year' : 'month'}</span></div>
        <p class="per">${annual ? `$${(p.annual_price / 12).toFixed(2)}/month · save $${p.price * 12 - p.annual_price}` : `or $${esc(p.annual_price)}/year — 2 months free`}</p>
        <ul><li>${p.active_cases ? esc(p.active_cases) + ' open cases' : 'Unlimited open cases'}</li><li>${p.users ? esc(p.users) + ' team members' : 'Unlimited team members'}</li>
          <li>Unlimited closed cases</li>${(d.coreFeatures || []).map((f) => `<li>${esc(f)}</li>`).join('')}<li>HIPAA-ready: signed BAA, encryption &amp; two-factor sign-in</li>
          ${(p.features || []).map((f) => `<li class="${f.included ? 'plus' : 'no'}">${esc(f.name)}</li>`).join('')}</ul>
        <a class="btn${featured ? '' : ' ghost'}" href="app.html#signup?plan=${encodeURIComponent(k)}">Start free trial</a></div>`;
    }).join('');
  };
  document.querySelectorAll('[data-interval]').forEach((b) => b.addEventListener('click', () => {
    interval = b.dataset.interval;
    document.querySelectorAll('[data-interval]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); });
    if (data) render();
  }));
  fetch('api/auth.php?action=plans', { credentials: 'same-origin' }).then((r) => r.json()).then((d) => {
    document.getElementById('trial-days').textContent = d.trialDays;
    data = d;
    render();
  }).catch(() => { /* pricing is optional on the page */ });
})();
