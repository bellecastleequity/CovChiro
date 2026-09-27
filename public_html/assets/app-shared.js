// A brief, non-blocking confirmation banner — for "this save worked" instead
// of an alert() that forces a click to dismiss. type: 'success' | 'error'.
function showToast(message, type = 'success'){
  let host = document.getElementById('toast-host');
  if (!host){
    host = document.createElement('div');
    host.id = 'toast-host';
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 3200);
}
const ORIGIN_ZIP = '32801';
const ORIGIN = { lat: 28.5410, lng: -81.3790 };
const MILE_TIERS = [ { max: 150, rate: 0.20 }, { max: 300, rate: 0.40 }, { max: Infinity, rate: 0.60 } ];
function tieredMileageRate(miles){
  for (const tier of MILE_TIERS) if (miles <= tier.max) return tier.rate;
  return MILE_TIERS[MILE_TIERS.length - 1].rate;
}
const RATES = {
  central:{half:325, full:575, label:'Central FL'},
  north:  {half:375, full:625, label:'North FL'},
  south:  {half:375, full:625, label:'South FL'}
};
const ZIP3 = {
  '320':[30.33,-81.66,'north'],'321':[29.21,-81.02,'central'],'322':[30.32,-81.70,'north'],
  '323':[30.44,-84.28,'north'],'324':[30.16,-85.66,'north'],'325':[30.42,-87.22,'north'],
  '326':[29.65,-82.32,'north'],'327':[28.90,-81.26,'central'],'328':[28.54,-81.38,'central'],
  '329':[28.29,-81.41,'central'],'330':[26.12,-80.14,'south'],'331':[25.77,-80.19,'south'],
  '332':[25.77,-80.19,'south'],'333':[26.12,-80.14,'south'],'334':[26.71,-80.05,'south'],
  '335':[27.95,-82.46,'central'],'336':[27.95,-82.46,'central'],'337':[27.77,-82.64,'central'],
  '338':[28.04,-81.95,'central'],'339':[26.64,-81.87,'south'],'341':[26.14,-81.79,'south'],
  '342':[27.34,-82.53,'central'],'344':[29.65,-82.32,'north'],'346':[28.55,-82.39,'central'],
  '347':[28.55,-81.77,'central'],'349':[27.64,-80.40,'central']
};
const ROAD_FACTOR = 1.22; // straight-line → approximate driving miles
const KEYS_OVERRIDE = {
  33037: 295, // Key Largo — closest to the mainland
  33070: 305, // Tavernier
  33036: 315, // Islamorada
  33001: 330, // Long Key
  33050: 345, // Marathon
  33051: 345, // Marathon
  33052: 345, // Marathon
  33042: 365, // Lower Keys
  33043: 365, // Big Pine Key
  33044: 375, // Lower Keys
  33040: 385, // Key West
  33041: 385, // Key West
  33045: 385, // Key West area
};
const KEYS_BAND_MIN = 33001, KEYS_BAND_MAX = 33052;
const KEYS_FALLBACK_MILES = 365; // conservative — always past the 300mi threshold
function keysMileage(zipNum){
  if (KEYS_OVERRIDE[zipNum] != null) return KEYS_OVERRIDE[zipNum];
  if (zipNum >= KEYS_BAND_MIN && zipNum <= KEYS_BAND_MAX) return KEYS_FALLBACK_MILES;
  return null;
}
const money = n => '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const $ = id => document.getElementById(id);
function haversine(a, b){
  const R = 3958.8, toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat/2)**2 + Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
// Splits a sorted list of date strings into runs of consecutive calendar
// days — each run is one "trip" for mileage purposes (mileage is charged
// once per trip, not once per day, since a multi-day-in-a-row booking is a
// single drive out and back).
function groupConsecutiveDates(sortedDates){
  const groups = [];
  let current = [];
  for (const d of sortedDates){
    if (!current.length){ current.push(d); continue; }
    const prev = new Date(current[current.length - 1] + 'T12:00:00');
    const cur = new Date(d + 'T12:00:00');
    const diffDays = Math.round((cur - prev) / 864e5);
    if (diffDays === 1) current.push(d);
    else { groups.push(current); current = [d]; }
  }
  if (current.length) groups.push(current);
  return groups;
}
function lookupZip(zip){
  const z = (zip || '').trim();
  if (!/^\d{5}$/.test(z)) return null;
  const km = keysMileage(parseInt(z, 10));
  if (km != null) return { miles: km, region: 'south' };
  const p = z.slice(0,3);
  if (!ZIP3[p]) return null;
  const [lat, lng, region] = ZIP3[p];
  const miles = Math.round(haversine(ORIGIN, {lat, lng}) * ROAD_FACTOR);
  return { miles, region };
}
function extractZipFromAddress(address){
  const m = String(address || '').match(/\b(\d{5})(-\d{4})?\b/);
  return m ? m[1] : '';
}
// Live client-side quote preview for an address field with
// attachAddressAutosuggest() attached: prefers the lat/lng the client picked
// from a suggestion (precise, real distance) and falls back to the ZIP3
// estimate for whatever ZIP appears in the typed text (works even before a
// suggestion is chosen, or if the geocoder is unreachable). The server
// always re-geocodes and re-prices authoritatively at submit time — this is
// purely so the on-page quote updates live as someone types/picks an address.
function resolveLocationClient(address, lat, lng){
  const zip = extractZipFromAddress(address);
  const zipLookup = lookupZip(zip);
  const latNum = parseFloat(lat), lngNum = parseFloat(lng);
  if (!isNaN(latNum) && !isNaN(lngNum)){
    const miles = Math.round(haversine(ORIGIN, {lat: latNum, lng: lngNum}) * ROAD_FACTOR);
    return { miles, region: zipLookup ? zipLookup.region : null, lat: latNum, lng: lngNum };
  }
  return { miles: zipLookup ? zipLookup.miles : 0, region: zipLookup ? zipLookup.region : null, lat: null, lng: null };
}
// Convenience wrapper for the common case of an <input> that
// attachAddressAutosuggest() is attached to (address in .value, lat/lng in
// .dataset from the last picked suggestion, if any).
function resolveLocationForInput(input){
  return resolveLocationClient(input.value, input.dataset.lat, input.dataset.lng);
}
let user = null, bookings = [], dashView = 'upcoming', svc = 'office', myInvoices = [];
let lastMinuteEnabled = true; // default on — overridden by loadSession() from /api/settings.php
let standingRequests = [], standingAgreements = [];
let flexRateDates = []; // admin-published open dates at a set promotional rate — no bidding, no negotiation
let blackouts = [], allBooked = [], isAdmin = false;
const ADMIN_EMAIL = 'mail@coveragechiropractor.com'; // provider account
// coveragechiropractor.com and thefloridachiropractor.com are separate
// domains (separate cPanel document roots, separate browser origins) that
// happen to share this same file and the same backend/database. A handful
// of resources — the static downloadable documents and admin-uploaded
// license/malpractice/W-9 files — only ever live under the main site's
// folder, so anything linking to them needs an absolute URL rather than a
// relative one that would resolve against whichever domain is loaded.
const MAIN_SITE_URL = 'https://coveragechiropractor.com';
const dstr = d => d.toISOString().slice(0,10);
function rangeDates(a,b){
  const out=[], d=new Date(a+'T12:00:00'), end=new Date((b||a)+'T12:00:00');
  let guard=0;
  while(d<=end && guard++<400){ out.push(dstr(d)); d.setDate(d.getDate()+1); }
  return out;
}
const localDateStr = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
let bookedDaySet = [];
async function apiFetch(url, opts = {}){
  const res = await fetch(url, Object.assign({ credentials: 'same-origin', headers: {'Content-Type':'application/json'} }, opts));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong. Try again.'), { data, status: res.status });
  return data;
}
async function loadAvailability(){
  try {
    const av = await apiFetch('/api/booking.php?action=availability');
    blackouts = (av.blackouts || []).map(b => ({ id: b.id, start: b.start, end: b.end, scope: b.scope, note: b.note || '' }));
    bookedDaySet = av.bookedDates || [];
    allBooked = bookedDaySet.map(d => ({ dates: [d] }));
  } catch (e) { /* availability is best-effort for the live calendar preview */ }
}
async function loadMyBookings(){
  if (!user){ bookings = []; return; }
  try { bookings = (await apiFetch('/api/booking.php?action=list')).bookings || []; }
  catch (e) { bookings = []; }
}
async function loadMyStanding(){
  if (!user){ standingRequests = []; standingAgreements = []; return; }
  try {
    const r = await apiFetch('/api/standing.php?action=list_mine');
    standingRequests = r.requests || [];
    standingAgreements = r.agreements || [];
  } catch (e) { standingRequests = []; standingAgreements = []; }
}
const STANDING_TIER_1 = { min: 12, rate: 0.10 };
const STANDING_TIER_2 = { min: 24, rate: 0.15 };
const STANDING_TIER_3 = { min: 52, rate: 0.20 };
const STANDING_PREPAY_BONUS = 0.02; // extra off, on top of the tier rate, for paying the full commitment upfront
function patternDayEquivalents(patterns){
  return patterns.reduce((sum, p) => sum + p.count * (p.type === 'full' ? 1 : 0.5), 0);
}
function standingTierFor(count){
  if (count >= STANDING_TIER_3.min) return STANDING_TIER_3;
  if (count >= STANDING_TIER_2.min) return STANDING_TIER_2;
  if (count >= STANDING_TIER_1.min) return STANDING_TIER_1;
  return null;
}
function effectiveStandingRate(tier, paymentPlan, customOverrideRate){
  if (customOverrideRate != null) return customOverrideRate;
  if (!tier) return 0;
  return tier.rate + (paymentPlan === 'prepay' ? STANDING_PREPAY_BONUS : 0);
}
function nextWeekdayOnOrAfter(dateStr, targetDow){
  let d = new Date(dateStr + 'T12:00:00');
  while (d.getDay() !== targetDow) d.setDate(d.getDate() + 1);
  return localDateStr(d);
}
const TYPE_LABEL_SD = { full: 'Full day', 'half-am': 'Half day (AM)', 'half-pm': 'Half day (PM)' };
const LAST_MINUTE_RATE = 0.10; // 10% off any coverage date within 24 hours, still unbooked
const FIRST_BOOKING_RATE = 0.10;   // 10% off a brand-new clinic's first booking
const RECURRING_DISCOUNT_RATE = 0.05; // 5% off, once a clinic has earned recurring status
const RECURRING_QUALIFY_DAYS = 3;  // 3 full-day-equivalents needed to qualify (6 half days = 3)
const RECURRING_WINDOW_DAYS = 365; // reward stays active while booking at least once a year
function cumulativeDayEquivalents(bookingsArr){
  return bookingsArr
    .filter(b => b.status !== 'cancelled' && b.service === 'office')
    .reduce((sum, b) => {
      const types = b.dayTypes || (b.dates || []).map(() => 'full');
      return sum + types.reduce((s, t) => s + (t === 'full' ? 1 : 0.5), 0);
    }, 0);
}
function mostRecentBookingDate(bookingsArr){
  const dates = bookingsArr
    .filter(b => b.status !== 'cancelled' && b.service === 'office')
    .map(b => b.start).filter(Boolean).sort();
  return dates.length ? dates[dates.length - 1] : null;
}
function recurringStatus(bookingsArr){
  const cumDays = cumulativeDayEquivalents(bookingsArr);
  const lastDate = mostRecentBookingDate(bookingsArr);
  const qualified = cumDays >= RECURRING_QUALIFY_DAYS;
  let active = false, daysSinceLast = null;
  if (qualified && lastDate){
    daysSinceLast = Math.floor((new Date() - new Date(lastDate + 'T00:00:00')) / 864e5);
    active = daysSinceLast <= RECURRING_WINDOW_DAYS;
  }
  return { cumDays, qualified, active, lastDate, daysSinceLast };
}
function renderAuthState(){
  const acctBtn = $('btn-account'); if (acctBtn) acctBtn.textContent = user ? 'My bookings' : 'Sign in';
  const signOut = $('sign-out-link'); if (signOut) signOut.classList.toggle('hidden', !user);
  isAdmin = !!(user && user.isAdmin);
}
$('sign-out-link').addEventListener('click', async (e) => {
  e.preventDefault();
  try { await apiFetch('/api/auth.php?action=logout', { method: 'POST' }); } catch (e) {}
  window.location.href = 'index.html';
});
let stripeInstance = null, stripeElements = null, paymentContext = null, paymentOnSuccess = null;
async function openPaymentModal(bookingId, purpose, amountLabel, onSuccess){
  paymentContext = { kind: 'booking', bookingId };
  paymentOnSuccess = onSuccess;
  await mountPaymentElement('/api/payment.php?action=create_payment_intent', { booking_id: bookingId, purpose }, amountLabel);
}
async function mountPaymentElement(url, body, amountLabel){
  $('payment-sub').textContent = amountLabel;
  $('payment-err').textContent = '';
  $('payment-element').innerHTML = '';
  $('payment-submit').disabled = true;
  $('payment-modal').classList.add('open');
  try {
    const r = await apiFetch(url, { method: 'POST', body: JSON.stringify(body) });
    stripeInstance = Stripe(r.publishable_key);
    stripeElements = stripeInstance.elements({ clientSecret: r.client_secret });
    stripeElements.create('payment').mount('#payment-element');
    $('payment-submit').disabled = false;
  } catch (e){
    $('payment-err').textContent = e.message;
  }
}
if ($('payment-submit')) $('payment-submit').addEventListener('click', async () => {
  if (!stripeInstance || !stripeElements) return;
  $('payment-submit').disabled = true;
  $('payment-err').textContent = '';
  const { error, paymentIntent } = await stripeInstance.confirmPayment({ elements: stripeElements, redirect: 'if_required' });
  if (error){
    $('payment-err').textContent = error.message || 'Payment failed. Try again.';
    $('payment-submit').disabled = false;
    return;
  }
  try {
    if (paymentContext.kind === 'standing_deposit'){
      await apiFetch('/api/standing.php?action=request', { method: 'POST', body: JSON.stringify({
        ...paymentContext.requestBody, depositPaymentIntentId: paymentIntent.id,
      })});
      $('payment-modal').classList.remove('open');
      if (paymentOnSuccess) await paymentOnSuccess();
      return;
    }
    const confirmUrl = paymentContext.kind === 'standing' ? '/api/payment.php?action=confirm_standing_payment'
      : paymentContext.kind === 'invoice' ? '/api/payment.php?action=confirm_invoice_payment'
      : '/api/payment.php?action=confirm_payment';
    const confirmBody = paymentContext.kind === 'standing'
      ? { agreementId: paymentContext.agreementId, date: paymentContext.date, payment_intent_id: paymentIntent.id }
      : paymentContext.kind === 'invoice'
      ? { invoice_id: paymentContext.invoiceId, payment_intent_id: paymentIntent.id }
      : { booking_id: paymentContext.bookingId, payment_intent_id: paymentIntent.id };
    const r = await apiFetch(confirmUrl, { method: 'POST', body: JSON.stringify(confirmBody) });
    $('payment-modal').classList.remove('open');
    if (paymentOnSuccess) paymentOnSuccess(r.booking);
  } catch (e){
    $('payment-err').textContent = e.message;
    $('payment-submit').disabled = false;
  }
});
document.querySelectorAll('[data-close]').forEach(b =>
  b.addEventListener('click', () => b.closest('.modal-bg').classList.remove('open')));
document.querySelectorAll('.modal-bg').forEach(bg =>
  bg.addEventListener('click', e => { if (e.target === bg) bg.classList.remove('open'); }));

// ===== Welcome offer pop-up (homepage lead capture) =====
// The code the visitor received is remembered in this browser so it's
// re-applied to the booking form on later visits, and so the pre-login promo
// preview can prove which email it belongs to.
const WELCOME_SITE = location.hostname.includes('thefloridachiropractor') ? 'florida' : 'coverage';
function welcomeLead(){ try { return JSON.parse(localStorage.getItem('welcomeLead') || 'null'); } catch (e) { return null; } }
function welcomeLeadEmail(){ const l = welcomeLead(); return l && l.email ? l.email : ''; }
function rememberWelcomeLead(data){ try { localStorage.setItem('welcomeLead', JSON.stringify(data)); } catch (e) {} }
function applyWelcomeCode(){
  const l = welcomeLead(), input = $('promo-input'), apply = $('promo-apply');
  if (!l || !l.code || !input || !apply) return false;
  if (input.value.trim().toUpperCase() === l.code) return true;
  input.value = l.code;
  apply.click();
  return true;
}
(function initWelcomeOffer(){
  const modal = $('welcome-modal');
  if (!modal) return;
  const params = new URLSearchParams(location.search);
  const urlCode = (params.get('welcome') || '').trim().toUpperCase();
  const urlEmail = (params.get('lead') || '').trim().toLowerCase();
  if (urlCode) rememberWelcomeLead(Object.assign(welcomeLead() || {}, { code: urlCode, email: urlEmail || (welcomeLead() || {}).email || '' }));
  window.addEventListener('load', () => setTimeout(applyWelcomeCode, 300));

  let dismissedAt = 0;
  try { dismissedAt = parseInt(localStorage.getItem('welcomeDismissedAt') || '0', 10) || 0; } catch (e) {}
  const recentlyDismissed = dismissedAt && (Date.now() - dismissedAt) < 30 * 864e5;
  let shown = false;
  // Only for visitors who haven't already grabbed a code, closed it in the
  // last month, or signed in (an account holder isn't a new lead).
  function maybeShow(){
    if (shown || welcomeLead() || recentlyDismissed || user) return;
    shown = true;
    modal.classList.add('open');
    setTimeout(() => { const n = $('welcome-name'); if (n) n.focus(); }, 250);
  }
  setTimeout(maybeShow, 8000);
  window.addEventListener('scroll', () => {
    const pct = (window.scrollY + window.innerHeight) / Math.max(1, document.documentElement.scrollHeight);
    if (pct >= 0.4) maybeShow();
  }, { passive: true });
  modal.addEventListener('click', e => {
    if (e.target === modal || e.target.closest('[data-close]')) {
      try { localStorage.setItem('welcomeDismissedAt', String(Date.now())); } catch (err) {}
    }
  });

  async function submitWelcome(){
    const name = $('welcome-name').value.trim(), email = $('welcome-email').value.trim();
    const err = $('welcome-err');
    err.textContent = '';
    if (!name){ err.textContent = 'Enter your name.'; return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ err.textContent = 'Enter a valid email address.'; return; }
    const btn = $('welcome-submit');
    btn.disabled = true;
    let r;
    try { r = await apiFetch('/api/leads.php?action=capture', { method: 'POST', body: JSON.stringify({ name, email, site: WELCOME_SITE }) }); }
    catch (e) { err.textContent = e.message; btn.disabled = false; return; }
    btn.disabled = false;
    rememberWelcomeLead({ email: email.toLowerCase(), code: r.code, expiresAt: r.expiresAt });
    $('welcome-code').textContent = r.code;
    const exp = r.expiresAt ? new Date(r.expiresAt + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '';
    $('welcome-done-msg').textContent = (r.alreadySignedUp ? "You'd already signed up — here's your code again. " : "We've emailed it to you too. ")
      + (exp ? `Good through ${exp}, first booking only.` : 'First booking only.');
    $('welcome-step-form').classList.add('hidden');
    $('welcome-step-done').classList.remove('hidden');
    applyWelcomeCode();
  }
  $('welcome-submit').addEventListener('click', submitWelcome);
  ['welcome-name', 'welcome-email'].forEach(id => $(id).addEventListener('keydown', e => { if (e.key === 'Enter') submitWelcome(); }));
  $('welcome-book-now').addEventListener('click', () => {
    modal.classList.remove('open');
    applyWelcomeCode();
    const target = $('rates') || $('book');
    if (target) target.scrollIntoView({ behavior: 'smooth' });
  });
})();

function chatGuestKey(){
  let key = null;
  try { key = localStorage.getItem('covchiro_chat_key'); } catch (e) {}
  if (!key){
    key = 'guest:' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    try { localStorage.setItem('covchiro_chat_key', key); } catch (e) {}
  }
  return key;
}
const CHAT_BOT_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>`;
function renderChatMessages(messages){
  const body = $('chat-body');
  if (!body) return;
  if (!messages.length) return; // leave the default greeting in place
  body.innerHTML = messages.map(m => {
    const isAdmin = m.sender === 'admin';
    const isBot = m.sender === 'bot';
    const isOffice = isAdmin || isBot;
    const initial = (m.name || '?').trim().charAt(0).toUpperCase() || '?';
    const avatar = isAdmin
      ? `<img class="chat-avatar" src="assets/headshot.jpg" alt="Dr. McPherson">`
      : isBot
      ? `<div class="chat-avatar-bot" title="Quick reply">${CHAT_BOT_ICON}</div>`
      : `<div class="chat-avatar-initial">${initial}</div>`;
    const time = m.createdAt ? new Date(m.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
    const label = isBot ? `<div class="chat-msg-label">Quick reply</div>` : '';
    return `<div class="chat-msg-row ${isOffice ? 'chat-row-admin' : 'chat-row-me'}">
      ${avatar}
      <div class="chat-bubble-wrap">
        ${label}
        <div class="chat-msg ${isOffice ? 'chat-msg-admin' : 'chat-msg-me'}">${String(m.message).replace(/</g,'&lt;')}</div>
        ${time ? `<div class="chat-msg-time">${time}</div>` : ''}
      </div>
    </div>`;
  }).join('');
  body.scrollTop = body.scrollHeight;
  body.querySelectorAll('img.chat-avatar').forEach(img => {
    if (!img.complete) img.addEventListener('load', () => { body.scrollTop = body.scrollHeight; }, { once: true });
  });
}
function showChatTyping(){
  const body = $('chat-body');
  if (!body) return;
  body.insertAdjacentHTML('beforeend', `<div class="chat-msg-row chat-row-admin" id="chat-typing">
    <div class="chat-avatar-bot">${CHAT_BOT_ICON}</div>
    <div class="chat-bubble-wrap"><div class="chat-msg chat-msg-admin chat-typing-dots"><span></span><span></span><span></span></div></div>
  </div>`);
  body.scrollTop = body.scrollHeight;
}
function hideChatTyping(){
  const el = document.getElementById('chat-typing');
  if (el) el.remove();
}
function appendOptimisticChatMessage(text){
  const body = $('chat-body');
  if (!body) return;
  const nameSource = user ? user.name : ($('chat-guest-name') ? $('chat-guest-name').value : '');
  const initial = (nameSource || '?').trim().charAt(0).toUpperCase() || '?';
  const time = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  body.insertAdjacentHTML('beforeend', `<div class="chat-msg-row chat-row-me">
    <div class="chat-avatar-initial">${initial}</div>
    <div class="chat-bubble-wrap">
      <div class="chat-msg chat-msg-me">${String(text).replace(/</g,'&lt;')}</div>
      <div class="chat-msg-time">${time}</div>
    </div>
  </div>`);
  body.scrollTop = body.scrollHeight;
}
async function loadChatHistory(){
  try {
    const url = user ? '/api/chat.php?action=history' : `/api/chat.php?action=history&threadKey=${encodeURIComponent(chatGuestKey())}`;
    const res = await apiFetch(url);
    renderChatMessages(res.messages || []);
  } catch (e) { /* best-effort */ }
}
let chatPollTimer = null;
function startChatPolling(){
  stopChatPolling();
  chatPollTimer = setInterval(loadChatHistory, 15000);
}
function stopChatPolling(){
  if (chatPollTimer){ clearInterval(chatPollTimer); chatPollTimer = null; }
}
async function sendChatMessage(){
  const input = $('chat-input-text');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  const body = { message: text };
  if (!user){
    const nameEl = $('chat-guest-name'), emailEl = $('chat-guest-email');
    const name = nameEl ? nameEl.value.trim() : '';
    const email = emailEl ? emailEl.value.trim() : '';
    if (!name || !email){ alert('Enter your name and email so we can reply.'); return; }
    try { localStorage.setItem('covchiro_chat_name', name); localStorage.setItem('covchiro_chat_email', email); } catch (e) {}
    body.threadKey = chatGuestKey();
    body.name = name;
    body.email = email;
  }
  input.value = '';
  appendOptimisticChatMessage(text);
  const guestFields = $('chat-guest-fields');
  if (guestFields && !user) guestFields.classList.add('hidden'); // captured above — no need to show them again
  showChatTyping();
  let sendError = null;
  try {
    await apiFetch('/api/chat.php?action=send', { method: 'POST', body: JSON.stringify(body) });
  } catch (e) { sendError = e; }
  // A brief, natural-feeling pause before the reply appears, rather than
  // popping in instantly — the message itself is still clearly labeled as
  // a "Quick reply" (automated), this just avoids an abrupt instant reply.
  setTimeout(async () => {
    hideChatTyping();
    if (sendError){ alert(sendError.message); return; }
    await loadChatHistory();
  }, 1600 + Math.random() * 2200);
}
function initChatWidget(){
  const guestFields = $('chat-guest-fields');
  if (guestFields){
    let identified = false;
    if (!user){
      try {
        const n = localStorage.getItem('covchiro_chat_name'), e = localStorage.getItem('covchiro_chat_email');
        if (n && $('chat-guest-name')) $('chat-guest-name').value = n;
        if (e && $('chat-guest-email')) $('chat-guest-email').value = e;
        identified = !!(n && e);
      } catch (err) {}
    }
    // Already have a name/email on file for this visitor (or they're
    // logged in) — no reason to keep showing empty-looking fields on every
    // visit once they've already been captured and are being reused.
    guestFields.classList.toggle('hidden', !!user || identified);
  }
  const sendBtn = $('chat-send');
  if (sendBtn) sendBtn.addEventListener('click', sendChatMessage);
  const inputText = $('chat-input-text');
  if (inputText) inputText.addEventListener('keydown', (e) => { if (e.key === 'Enter'){ e.preventDefault(); sendChatMessage(); } });
}

// ---------- Custom date picker ----------
// Replaces the native <input type="date"> popup (which can't grey out
// individual dates) with a small calendar that visually disables anything
// the caller's isDisabled(dateStr) predicate flags, so a customer can't even
// select an unavailable date in the first place. Writes the same
// YYYY-MM-DD string a native date input would and dispatches a real
// 'change' event, so any existing listener on the input keeps working
// unchanged.
const DP_MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DP_DOW_LABELS = ['S','M','T','W','T','F','S'];
function attachDatePicker(input, opts){
  opts = opts || {};
  const isDisabled = opts.isDisabled || (() => false);
  const minDate = opts.minDate || localDateStr(new Date());

  input.type = 'text';
  input.readOnly = true;
  input.classList.add('dp-input');
  if (!input.placeholder) input.placeholder = opts.placeholder || 'Select a date';

  const popup = document.createElement('div');
  popup.className = 'dp-popup hidden';
  document.body.appendChild(popup);

  let viewYear, viewMonth; // viewMonth is 0-indexed

  function ymd(y, m, d){ return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`; }

  function render(){
    const first = new Date(viewYear, viewMonth, 1);
    const startDow = first.getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const todayStr = localDateStr(new Date());
    let cells = '';
    for (let i = 0; i < startDow; i++) cells += `<span class="dp-cell dp-empty"></span>`;
    for (let d = 1; d <= daysInMonth; d++){
      const dateStr = ymd(viewYear, viewMonth, d);
      const disabled = dateStr < minDate || isDisabled(dateStr);
      const cls = ['dp-cell'];
      if (disabled) cls.push('dp-disabled');
      if (dateStr === todayStr) cls.push('dp-today');
      if (dateStr === input.value) cls.push('dp-selected');
      cells += `<button type="button" class="${cls.join(' ')}" data-date="${dateStr}" ${disabled ? 'disabled' : ''}>${d}</button>`;
    }
    popup.innerHTML = `
      <div class="dp-header">
        <button type="button" class="dp-nav" data-nav="-1" aria-label="Previous month">&#8249;</button>
        <span class="dp-title">${DP_MONTH_NAMES[viewMonth]} ${viewYear}</span>
        <button type="button" class="dp-nav" data-nav="1" aria-label="Next month">&#8250;</button>
      </div>
      <div class="dp-dow-row">${DP_DOW_LABELS.map(l => `<span>${l}</span>`).join('')}</div>
      <div class="dp-grid">${cells}</div>`;
    popup.querySelector('[data-nav="-1"]').addEventListener('click', (e) => {
      e.stopPropagation(); viewMonth--; if (viewMonth < 0){ viewMonth = 11; viewYear--; } render();
    });
    popup.querySelector('[data-nav="1"]').addEventListener('click', (e) => {
      e.stopPropagation(); viewMonth++; if (viewMonth > 11){ viewMonth = 0; viewYear++; } render();
    });
    popup.querySelectorAll('.dp-cell:not(.dp-disabled):not(.dp-empty)').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        input.value = btn.dataset.date;
        close();
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });
  }
  function position(){
    const r = input.getBoundingClientRect();
    popup.style.top = (r.bottom + window.scrollY + 4) + 'px';
    popup.style.left = (r.left + window.scrollX) + 'px';
  }
  function open(){
    const base = /^\d{4}-\d{2}-\d{2}$/.test(input.value) ? input.value : minDate;
    const [y, m] = base.split('-').map(Number);
    viewYear = y; viewMonth = m - 1;
    render();
    position();
    popup.classList.remove('hidden');
    document.addEventListener('click', onOutsideClick, true);
    document.addEventListener('keydown', onKeydown, true);
    window.addEventListener('scroll', close, { passive: true, once: true, capture: true });
    window.addEventListener('resize', close, { once: true });
  }
  function close(){
    popup.classList.add('hidden');
    document.removeEventListener('click', onOutsideClick, true);
    document.removeEventListener('keydown', onKeydown, true);
  }
  function onOutsideClick(e){ if (!popup.contains(e.target) && e.target !== input) close(); }
  function onKeydown(e){ if (e.key === 'Escape') close(); }

  input.addEventListener('click', () => { if (popup.classList.contains('hidden')) open(); else close(); });
}

// Free, no-API-key address autosuggest via OpenStreetMap's Nominatim search
// endpoint, called directly from the browser (Nominatim's usage policy is
// satisfied by the page's own Referer header — no API key exists to send).
// Debounced well under Nominatim's ~1 request/second fair-use limit, and
// biased to a Florida bounding box since that's the only area this site
// serves. Selecting a suggestion fills the input with the full address and
// stores the suggestion's lat/lng on the input's dataset for an instant
// client-side quote preview — the server always re-geocodes and re-prices
// authoritatively when the booking is actually submitted, so a stale or
// missing suggestion here never affects what a client is actually charged.
const ADDRESS_SUGGEST_VIEWBOX = '-87.7,31.1,-79.7,24.3'; // left,top,right,bottom (lon,lat,lon,lat)
function attachAddressAutosuggest(input, opts){
  opts = opts || {};
  const onSelect = opts.onSelect || (() => {});
  input.autocomplete = 'off';
  input.classList.add('addr-input');

  const popup = document.createElement('div');
  popup.className = 'addr-popup hidden';
  document.body.appendChild(popup);

  let debounceTimer = null;
  let abortController = null;
  let items = [];

  function position(){
    const r = input.getBoundingClientRect();
    popup.style.top = (r.bottom + window.scrollY + 4) + 'px';
    popup.style.left = (r.left + window.scrollX) + 'px';
    popup.style.width = r.width + 'px';
  }
  function close(){
    popup.classList.add('hidden');
    document.removeEventListener('click', onOutsideClick, true);
  }
  function onOutsideClick(e){ if (!popup.contains(e.target) && e.target !== input) close(); }

  function renderItems(){
    if (!items.length){ close(); return; }
    popup.innerHTML = items.map((it, i) => `<button type="button" class="addr-item" data-i="${i}">${it.display_name}</button>`).join('');
    popup.querySelectorAll('.addr-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const it = items[Number(btn.dataset.i)];
        input.value = it.display_name;
        input.dataset.lat = it.lat;
        input.dataset.lng = it.lon;
        close();
        onSelect(it);
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });
    position();
    popup.classList.remove('hidden');
    document.addEventListener('click', onOutsideClick, true);
  }

  async function search(q){
    if (abortController) abortController.abort();
    abortController = new AbortController();
    const url = 'https://nominatim.openstreetmap.org/search?' + new URLSearchParams({
      format: 'json', addressdetails: '1', limit: '5', countrycodes: 'us',
      viewbox: ADDRESS_SUGGEST_VIEWBOX, bounded: '1', q,
    });
    try {
      const res = await fetch(url, { signal: abortController.signal });
      if (!res.ok) throw new Error('geocoder error');
      items = await res.json();
      renderItems();
    } catch (e) {
      // Geocoder unreachable, rate-limited, or the request was superseded by
      // a newer keystroke (AbortError) — fail silently either way. The field
      // still works as a plain text input; the server prices authoritatively
      // from whatever address is actually submitted.
      items = [];
    }
  }

  input.addEventListener('input', () => {
    delete input.dataset.lat; delete input.dataset.lng;
    clearTimeout(debounceTimer);
    const q = input.value.trim();
    if (q.length < 6){ close(); return; }
    debounceTimer = setTimeout(() => search(q), 500);
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}
