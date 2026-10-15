// Fills the swappable parts of every template from the URL:
//   ?city=Orlando                 -> "Orlando Therapy & Injury" everywhere [data-brand], city in [data-city]
//   ?city=                        -> brand-level "Therapy & Injury" (no city)
//   &address=...&hours=...&phone= -> fills [data-address], [data-hours], [data-phone]
// With no parameters the templates show Ocala, the first location.
(function () {
  const q = new URLSearchParams(location.search);
  const city = q.has('city') ? q.get('city').trim() : 'Ocala';
  const brand = city ? `${city} Therapy & Injury` : 'Therapy & Injury';
  const set = (sel, val) => document.querySelectorAll(sel).forEach((el) => (el.textContent = val));
  set('[data-brand]', brand);
  set('[data-city]', city || 'Florida');
  set('[data-city-upper]', (city || 'Florida').toUpperCase());
  const fields = {
    address: '2649 W Silver Springs Blvd, Ocala, FL 34475',
    hours: 'Mon, Wed, Thu · 1–6 pm',
    phone: '[PHONE]',
    url: 'therapyandinjury.com/' + (city ? city.toLowerCase().replace(/\s+/g, '-') : ''),
  };
  for (const k of Object.keys(fields)) set(`[data-${k}]`, q.get(k) ?? fields[k]);
  document.title = `${document.title} — ${brand}`;
})();
