# Therapy & Injury: launch TODO

On the site, every unfilled fact shows as a yellow `[PLACEHOLDER]` highlight. When you fill one in, the highlight disappears.
Most facts live in two data files. Edit those first:

- `src/data/site.json`: brand-wide facts and SEO settings
- `src/data/branches.json`: one entry per location

## Decisions recorded
- **Treating doctor:** no doctor is named anywhere yet. Pages say "Florida-licensed chiropractic physician (D.C.)". When a location's doctor is confirmed, add them under that location's `doctors` in `branches.json` and rebuild. Their name then appears on the location page, its schema, and `llms.txt`.
- **Business structure:** owner-operated by Therapy & Injury (registered DBA). Each location may be its own PLLC. Once one is formed, put its name in that location's `legalEntity`, and it appears on that location's page and in its schema. "Florida Therapy & Injury" is used only as an SEO alternate name.
- **Form backend:** plain email, through `public/api/appointment.php`.
- **PIP hero:** keep the current 14-day PIP copy.
- **City domains:** purchased. They are listed in `branches.json → domains`.

---

## 1. Facts to fill in

### Brand (`src/data/site.json`)
- [ ] `mainPhone`, `mainEmail`
- [ ] `social.instagram`, `social.facebook`: profile URLs once the accounts exist
- [ ] `seo.gaMeasurementId`: GA4 ID (G-XXXXXXXXXX), if you want analytics
- [ ] `seo.googleSiteVerification`: from Google Search Console (HTML tag method, the `content` value only)
- [ ] `seo.bingSiteVerification`: from Bing Webmaster Tools (or import from Search Console instead)
- [ ] `lastUpdatedLegal`: date the privacy and accessibility pages were reviewed

### Ocala (`src/data/branches.json`)
- [ ] `phone`
- [ ] `email`: also add it to `$RECIPIENTS` in `public/api/appointment.php` (see §3)
- [ ] `doctors`: treating doctor, once confirmed
- [ ] `legalEntity`: the location's PLLC name, once formed
- [ ] `gbpUrl`: Google Business Profile link, once the profile is verified
- [ ] `geo.lat` / `geo.lng`: from Google Maps (right-click the pin to copy). Improves local SEO.
- [ ] `features`: turn on only what's true. Options are `sameDayAppointments`, `walkInsWelcome`, `eveningHours`, `onSiteXray`, and `languages` (add `"Español"` if a Spanish speaker is on staff). Each one shows as a chip on the location page. See `docs/competitor-research.md`.
- [ ] `nearbyAreas`: confirm the list (currently Silver Springs, Belleview, Dunnellon, Marion Oaks, Summerfield, Anthony, Reddick)

### Coming-soon locations: Orlando, Lake Mary, Deltona, DeLand, Eustis
- [ ] Confirm **DeLand** should be listed. It was in the brand pack but not the brief.
- [ ] **Eustis** (Lake County) was added Oct 2026. Confirm `eustistherapyandinjury.com` is purchased, and confirm its nearby areas (Mount Dora, Tavares, Umatilla, Leesburg, Sorrento, Grand Island). The Eustis brand kit is in `brand-assets/Eustis Therapy & Injury/`. The stacked lockups were re-centered (Oct 2026 update). The `05` tagline lockup carries the same "Expert Injury Care" wording flagged below.
- [ ] `openingNote`, `phone`, `email`
- [ ] When a location opens: set `status` to `"open"` and add `address`, `hours`, `doctors`, `gbpUrl` and `legalEntity`. Rebuild, upload, then run `npm run indexnow`. The location's page and its car-accident page then become indexable and join the sitemap automatically.

### Content
- [ ] **Services** (`src/lib/content.ts`): approve each description and its technique lists, then set `confirm: false`
- [ ] **FAQ** (`src/lib/faq.ts`): billing process, referral requirements, self-pay or health insurance options, first-visit length. Answers with placeholders are kept out of FAQ rich results and `llms.txt` until they're filled.
- [ ] **Auto Accident Injuries page**: online intake forms (yes or no?) and first-visit length
- [ ] Review the 5 condition guides and 4 starter blog posts. All are educational drafts.

### Legal pages
- [ ] Privacy policy: attorney or compliance review, the list of service providers, retention period, and a link to your HIPAA Notice of Privacy Practices
- [ ] Accessibility statement: response time
- [ ] Appointment form call/text consent wording: confirm with counsel (TCPA)

### Social kit (`social/`)
- [ ] Post 06 (Meet the doctor) is **on hold** until a doctor is confirmed. The calendar marks it `hold`.
- [ ] Post times in `social/calendar.csv`
- [ ] Caption 09: replace `[ADDRESS]`, `[HOURS]` and `[PHONE]`
- [ ] After any change to `branches.json`, run `npm run social:gbp` to regenerate the Google Business Profile sheets

---

## Black-owned visibility (off-site; see `docs/black-owned-visibility.md`)
- [ ] For each location's Google Business Profile, turn on "Identifies as Black-owned"
- [ ] Yelp: claim each location and turn on the "Black-owned" attribute
- [ ] List with Black-owned business directories and local Black chambers, and paste each profile URL into `site.json` → `directoryListings`
- [ ] Optional: Florida Office of Supplier Diversity MBE certification

---

## 2. Compliance flags (Florida advertising)
- [ ] **Doctor name in ads:** Florida chiropractic advertising rules may require ads to include the chiropractic physician's name. Until a doctor is named, ads say "chiropractic" and "Florida-licensed D.C." Confirm with counsel before running paid ads, and add the name once known.
- [ ] **Competitor tactics to avoid until counsel approves:** free transportation, "no out-of-pocket cost" claims, and waiving PIP copays or deductibles (patient-brokering and kickback risk, Fla. Stat. §817.505 and §456.054). See `docs/competitor-research.md`.
- [ ] **Free or discounted offers:** none in any copy right now. If you add one, Florida requires a specific disclaimer (Fla. Stat. §456.062). Have it reviewed before posting.
- [ ] **Brand pack wording:** the `05-stacked-with-tagline` lockups say "INJURY TREATMENT CENTER" and "Expert Injury Care." I didn't use them, because "expert" can read as a specialty claim. Confirm with counsel before using those files.
- [ ] **Brand pack typeface:** the pre-made lockups use a Nexa-style face, not Inter. Pick one for signage so they match.
- [ ] **Entities:** confirm Florida allows a PLLC per location for a chiropractic practice under your ownership structure, and register the "Therapy & Injury" fictitious name on Sunbiz.
- [ ] **"Therapy" in the name:** confirm with counsel that it raises no issue under Florida's physical-therapy title rules (Fla. Stat. ch. 486). The site never says "physical therapy."
- Already handled: every page and template names "chiropractic" or "D.C." No "best," "#1," guarantees, statistics, testimonials, or medical-doctor claims. Medical evaluations are always described as a referral to an independent medical provider.

---

## 3. Technical
- [ ] **Form email:** fill in `$RECIPIENTS` (one inbox per location) and `$FROM` (an address on therapyandinjury.com) in `public/api/appointment.php`. Until then the form tells visitors to call. Set up SPF, DKIM and DMARC for the domain in cPanel so requests don't land in spam.
- [ ] **City domains:** in cPanel, add each one as an **Alias** of therapyandinjury.com. The generated `.htaccess` redirects each to its location page.
- [ ] **Launch SEO steps** (see README → SEO → After launch): verify Search Console and Bing, submit the sitemap, run `npm run indexnow`.
- [ ] Social templates load Inter from Google Fonts. Export them while online.
