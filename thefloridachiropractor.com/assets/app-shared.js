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
let user = null, bookings = [], dashView = 'upcoming', svc = 'office';
let lastMinuteEnabled = true; // default on — overridden by loadSession() from /api/settings.php
let standingRequests = [], standingAgreements = [];
let flexRateDates = []; // admin-published open dates at a set promotional rate — no bidding, no negotiation
let blackouts = [], allBooked = [], isAdmin = false;
const ADMIN_EMAIL = 'drmichaelmcpherson@gmail.com'; // provider account
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
    const confirmUrl = paymentContext.kind === 'standing' ? '/api/payment.php?action=confirm_standing_payment' : '/api/payment.php?action=confirm_payment';
    const confirmBody = paymentContext.kind === 'standing'
      ? { agreementId: paymentContext.agreementId, date: paymentContext.date, payment_intent_id: paymentIntent.id }
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

function chatGuestKey(){
  let key = null;
  try { key = localStorage.getItem('covchiro_chat_key'); } catch (e) {}
  if (!key){
    key = 'guest:' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    try { localStorage.setItem('covchiro_chat_key', key); } catch (e) {}
  }
  return key;
}
function renderChatMessages(messages){
  const body = $('chat-body');
  if (!body) return;
  if (!messages.length) return; // leave the default greeting in place
  body.innerHTML = messages.map(m => {
    const isAdmin = m.sender === 'admin';
    const initial = (m.name || '?').trim().charAt(0).toUpperCase() || '?';
    const avatar = isAdmin
      ? `<img class="chat-avatar" src="assets/headshot.jpg" alt="Dr. McPherson">`
      : `<div class="chat-avatar-initial">${initial}</div>`;
    const time = m.createdAt ? new Date(m.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
    return `<div class="chat-msg-row ${isAdmin ? 'chat-row-admin' : 'chat-row-me'}">
      ${avatar}
      <div class="chat-bubble-wrap">
        <div class="chat-msg ${isAdmin ? 'chat-msg-admin' : 'chat-msg-me'}">${String(m.message).replace(/</g,'&lt;')}</div>
        ${time ? `<div class="chat-msg-time">${time}</div>` : ''}
      </div>
    </div>`;
  }).join('');
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
  try {
    await apiFetch('/api/chat.php?action=send', { method: 'POST', body: JSON.stringify(body) });
  } catch (e) { alert(e.message); return; }
  await loadChatHistory();
}
function initChatWidget(){
  const guestFields = $('chat-guest-fields');
  if (guestFields){
    guestFields.classList.toggle('hidden', !!user);
    if (!user){
      try {
        const n = localStorage.getItem('covchiro_chat_name'), e = localStorage.getItem('covchiro_chat_email');
        if (n && $('chat-guest-name')) $('chat-guest-name').value = n;
        if (e && $('chat-guest-email')) $('chat-guest-email').value = e;
      } catch (err) {}
    }
  }
  const sendBtn = $('chat-send');
  if (sendBtn) sendBtn.addEventListener('click', sendChatMessage);
  const inputText = $('chat-input-text');
  if (inputText) inputText.addEventListener('keydown', (e) => { if (e.key === 'Enter'){ e.preventDefault(); sendChatMessage(); } });
}
