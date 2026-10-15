# Competitor research: Florida injury clinic websites (Oct 2026)

Sites reviewed: Hess Spinal & Medical Centers, COR Medical Centers, Path Medical, 1-800-ASK-GARY, and Sterling Medical Group.
The sites themselves are blocked by this build environment's network policy, so this research comes from web search results (their own pages as indexed, plus directory listings). Re-check the live sites before copying any specific idea.

## What they do

| Pattern | Who | Notes |
|---|---|---|
| Phone-first: big call buttons everywhere | All | Their core conversion path is the phone call. |
| Same-day appointments / walk-ins | Hess, COR, Path | Usually in the hero or on location pages. |
| Bilingual staff called out ("Hablamos Su Idioma", Spanish/Creole/Portuguese) | Hess, COR | A big deal in Florida, especially Orlando, Kissimmee, and Deltona. |
| One page per clinic titled "Car Accident Chiropractor near [City], FL" | Path | Location pages built around the main local search phrase. |
| On-site imaging (X-ray, MRI) and medical evaluations | Hess, Path, Sterling | "One-stop shop." Hess offers X-rays, chiropractic, physical therapy, injections, and an MD. |
| Free transportation to appointments | Hess, and others in search results | Promoted as "Transportation Available." |
| "No upfront cost" / PIP billing assistance | Hess | Framed as PIP covering care. |
| Injury-type pages (auto, work, slip & fall) | COR | Each is its own landing page. |
| Search-driven blog ("How long should you see a chiropractor after a car accident?", "14-day PIP deadline") | Hess | Long-tail search phrases. |
| Location count as a trust signal ("18 locations", "22 locations") | Hess, COR, Path | |
| 24/7 free helpline referring to doctors *and* lawyers | 1-800-ASK-GARY | A referral-service model, not a clinic. |
| Surgery-level care and "world-class" copy | Sterling | Neurosurgery, orthopedics, MRI, pain management. |

## What we added now (on this branch)

1. **Mobile action bar** pinned to the bottom of every page on phones: **Call · Request visit · Directions**, the phone-first pattern all of them use. On a location page it uses that location's phone number.
2. **Location feature chips**, which show only once you confirm them. Each location in `branches.json` now has `features`: `sameDayAppointments`, `walkInsWelcome`, `eveningHours`, `onSiteXray`, and `languages`. They all start off. Turning one on shows a chip ("✓ Same-day appointments", "✓ Hablamos español") on that location's page and its car-accident page, and spoken languages go into its schema. A chip only appears on the home trust strip when every open location has it on.
3. **Home page trust strip**, using only statements true everywhere today: Florida-licensed chiropractic physicians · Auto accident (PIP) patients welcome · Plain-language care plans · Referrals to independent medical providers when needed.
4. **Two blog posts on topics competitors rank for:**
   - "How Long Will I Need Chiropractic Care After a Car Accident?" (no promised number of visits)
   - "Florida PIP Basics": the 14-day rule, 80% of medical bills and 60% of lost income, and why the $2,500 vs. $10,000 emergency-medical-condition step leads us to refer patients for a medical evaluation.
5. We already had the Path-style page: `/ocala/car-accident-chiropractor/`, one per open location, plus condition pages similar to COR's injury-type pages.

## Recommended next, once you confirm the facts
- **Spanish.** If an Ocala staff member speaks Spanish, add `"Español"` to `features.languages`. Later, consider Spanish versions of the home, location, and PIP pages. This matters most for Orlando, Kissimmee, and Deltona.
- **Same-day / walk-ins.** Turn these on only if the front desk can actually deliver them during the current Mon/Wed/Thu 1–6 pm hours.
- **More hours.** Every competitor shows longer hours. A Tuesday, Friday, or Saturday morning block would help both conversions and the "open now" results in Google Maps.
- **Online intake / pre-registration.** This shortens the first visit. It needs a HIPAA-appropriate form vendor, since intake includes health information. Keep that separate from the plain-email appointment form.
- **Work injury and slip-and-fall pages.** Only if you'll accept those cases. Workers' comp has its own billing rules.
- **Reviews.** Ask for Google reviews once you're open (no incentives), and show the star rating from your Google Business Profile. Don't post reviews as testimonials without written permission.

## What we should NOT copy (compliance)
- **Free transportation or "no out-of-pocket cost."** Offering something of value to get patients can raise issues under Florida's patient-brokering and kickback laws (Fla. Stat. §817.505, §456.054). PIP also generally pays only 80% of medical bills, so "no cost" can be misleading. Waiving PIP deductibles or copays is a known fraud risk area. **Have your attorney review before advertising any of these.**
- **A 24/7 helpline that refers callers to doctors and lawyers** (the Ask Gary model). That's a regulated referral-service business, and Florida restricts soliciting crash victims. Stay a clinic.
- **"Expert," "world-class," "#1," location-count bragging without the facts, or results claims.** These conflict with Florida chiropractic advertising rules and your brief.
- **Implying on-site MDs, physical therapy, MRI, or injections.** We refer to independent medical providers. Only add services you actually provide.

## Sources
- [Hess Spinal & Medical Centers](https://www.hessspinalandmedicalcenters.com/) and its [Accident Care page](https://hessspinalandmedicalcenters.com/accident-care); [blog: how long to see a chiropractor](https://www.hessspinalandmedicalcenters.com/blog/how-long-should-you-see-a-chiropractor-after-a-car-accident); [MapQuest listing](https://www.mapquest.com/us/florida/hess-spinal-medical-centers-433931061); [Yelp](https://www.yelp.com/brands/hess-spinal-medical-centers)
- [COR Medical Centers](https://www.cormedicalcenters.com/) and its [About page](https://www.cormedicalcenters.com/about-us/); [COR Injury Centers on Yelp](https://www.yelp.com/biz/cor-injury-centers-hialeah)
- [Path Medical](https://pathmedical.com/), its [About page](https://pathmedical.com/about-us/), [Locations](https://pathmedical.com/locations/), and an example [location page](https://pathmedical.com/locations/orlando-mri/)
- [1-800-ASK-GARY](https://1800askgary.com/), [Why us](https://1800askgary.com/why-us/), [cost FAQ](https://1800askgary.com/faq/how-much-does-it-cost-to-use-1-800-ask-gary/), [LinkedIn](https://www.linkedin.com/company/1-800-ask-gary)
- [Sterling Medical Group](https://sterlingmedgroup.com/service/); [X profile](https://x.com/SterlingMedGrp); [directory listing](https://www.findhealthclinics.com/US/Winter-Park/692752767531790/Sterling-Medical-Group)
