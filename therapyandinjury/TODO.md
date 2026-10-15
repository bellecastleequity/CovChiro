# Therapy & Injury: launch TODO

On the site, every unfilled fact shows as a yellow `[PLACEHOLDER]` highlight. When you fill one in, the highlight disappears.
Most facts live in two data files. Edit those first:

- `src/data/site.json`: brand-wide facts
- `src/data/branches.json`: one entry per location

---

## 1. Facts to fill in

### Brand (`src/data/site.json`)
- [ ] `mainPhone`: main phone number
- [ ] `mainEmail`: main email
- [ ] `founder.licenseNumber`: Dr. McPherson's Florida chiropractic license number (CH …)
- [ ] `social.instagram`, `social.facebook`: profile URLs once the accounts exist
- [ ] `lastUpdatedLegal`: date the privacy and accessibility pages were reviewed

### Ocala (`src/data/branches.json`)
- [ ] `phone`
- [ ] `email` (also needed by the form handler, see §3)
- [ ] `gbpUrl`: Google Business Profile link, once the profile is verified
- [ ] `geo.lat` / `geo.lng`: from Google Maps (right-click the pin to copy). Improves local SEO.
- [ ] `nearbyAreas`: confirm the list (currently Silver Springs, Belleview, Dunnellon, Marion Oaks, Summerfield, Anthony, Reddick)
- [ ] Confirm hours: Monday, Wednesday, Thursday, 1–6 pm

### Coming-soon branches: Orlando, Lake Mary, Deltona, DeLand
- [ ] Confirm **DeLand** should be listed. It was in the brand asset pack but not in the brief.
- [ ] `openingNote`: expected opening (e.g., "Spring 2027")
- [ ] `phone`, `email`
- [ ] When a branch opens: set `status` to `"open"` and add `address`, `hours`, `doctors`, and `gbpUrl`, then rebuild
- [ ] `nearbyAreas`: confirm each list

### About page (`src/pages/about.astro`)
- [ ] Dr. McPherson's headshot. Is `thefloridachiropractor.com/assets/headshot.jpg` in this repo the same doctor? If so, it can be reused.
- [ ] Bio (2–3 sentences)
- [ ] Doctor of Chiropractic school and year
- [ ] Undergraduate school, degree, and year
- [ ] Certifications and memberships. **List only verified items**, or delete the lines.

### Services (`src/lib/content.ts`)
Every service description is a draft marked `[PLACEHOLDER — CONFIRM SERVICE DESCRIPTION]`. For each one, approve the wording, then set `confirm: false`.
- [ ] Injury evaluation
- [ ] Chiropractic adjustments, including the list of techniques used
- [ ] Rehabilitation & therapeutic exercise, including in-clinic equipment and approach
- [ ] Soft-tissue therapy, including the list of techniques used

### Auto Accident Injuries page (`src/pages/auto-accident-injuries.astro`)
- [ ] Online intake forms before the visit: yes or no?
- [ ] First-visit length
- [ ] FAQ: referral requirements, PIP billing process, and self-pay or health insurance options after 14 days

### Legal pages
- [ ] Privacy policy: **attorney or compliance review**, plus the list of service providers, retention period, and a link to your HIPAA Notice of Privacy Practices
- [ ] Accessibility statement: response time
- [ ] Appointment form consent wording (call/text consent): **confirm with counsel** (TCPA)

### Social kit (`social/`)
- [ ] Headshot and one-line bio for post 06 (Meet the doctor)
- [ ] Post times in `social/calendar.csv`
- [ ] Replace `[ADDRESS]`, `[HOURS]`, and `[PHONE]` in caption 09 (now open)
- [ ] Re-run `node social/gbp/generate.mjs` after updating `branches.json`, then fill the remaining `[ … ]` items in `social/gbp/*.md`

---

## 2. Compliance flags (Florida advertising)
- [ ] **Verify current Florida PIP law before launch and periodically after.** The site and posts describe the 14-day initial-care rule (Fla. Stat. §627.736) with "generally." The Florida Legislature has repeatedly considered replacing PIP. If the law changes, update the home hero, the Auto Accident Injuries page, posts 03, 04, and 05, stories S1 and S3, and the captions.
- [ ] **Free or discounted offers:** none in any copy right now. If you add one, Florida requires a specific disclaimer (Fla. Stat. §456.062). Have it reviewed before posting.
- [ ] **Brand pack wording:** the `05-stacked-with-tagline` lockups in `brand-assets/` say "INJURY TREATMENT CENTER" and "Expert Injury Care. Personalized Recovery." I did **not** use them. "Expert" can read as a specialty or superiority claim. Confirm with counsel before using those files anywhere.
- [ ] **Brand pack typeface:** the pre-made lockups use a Nexa-style face, not Inter. The site and social kit build the wordmark in Inter, as the brief specifies. Pick one for print and signage so they match.
- [ ] Brand name check: confirm with counsel that "Therapy & Injury" causes no issue under Florida's restrictions on physical-therapy terms (Fla. Stat. ch. 486). The site never says "physical therapy."
- [ ] Testimonials: none used. Add only with written patient permission.
- Everything else: every page and template names "chiropractic" and "D.C." No "best," "#1," guarantees, statistics, or medical-doctor claims. Medical evaluations are always described as a referral to an *independent* medical provider.

---

## 3. Technical decisions
- [ ] **Form backend:** `public/api/appointment.php` is a placeholder. It emails requests to the branch inbox and stays disabled (returns 503, so the site tells visitors to call) until you fill in `$RECIPIENTS`. Decide whether plain email is acceptable for name, phone, and accident date. Alternatives are a HIPAA-eligible form service or an encrypted inbox. If you switch, change `formEndpoint` in `site.json`.
- [ ] **City domains:** `branches.json → domains` drives the redirects in the generated `.htaccess`. Confirm which domains you own (currently ocala-, orlando-, lakemary-, deltona-, and delandtherapyandinjury.com). In cPanel, add each one as an **Alias** (parked) domain of therapyandinjury.com.
- [ ] Analytics: none installed. If you add any, update the privacy policy.
- [ ] Submit `https://therapyandinjury.com/sitemap.xml` in Google Search Console.
- [ ] Social templates load Inter from Google Fonts. Export them while online.
