# therapyandinjury.com

Static website and social media launch kit for **Therapy & Injury**, chiropractic injury and wellness care across Florida.
Owner-operated. "Therapy & Injury" is the registered DBA used by every location; each location may have its own professional entity (set `legalEntity` in `branches.json`).

Built with [Astro](https://astro.build). The build is plain HTML/CSS with a little JS, ready for Namecheap cPanel hosting.

See **[TODO.md](TODO.md)** for every placeholder and decision still open.

## Quick start
```bash
cd therapyandinjury
npm install
npm run dev       # http://localhost:4321
npm run build     # outputs dist/ and runs the SEO check
npm run indexnow  # after uploading: ping Bing/IndexNow with every URL
```
Requires Node 22+.

## Adding a new city
Add one entry to `src/data/branches.json` (copy an existing one), then run `npm run build`. That creates:
- `/<slug>/`: the branch page, with its own title, meta description, MedicalBusiness schema, map, and form
- `/og/<slug>.png`: its Open Graph image
- an entry in the sitemap, the Locations page, the home page picker, and the footer
- a redirect from each domain in its `domains` list to the branch page (in the generated `.htaccess`)

It also gets `/<slug>/car-accident-chiropractor/` once it's open. Coming-soon locations are `noindex` and left out of the sitemap until they open.

Use `"status": "coming soon"` until it opens. Then switch to `"open"` and add the address, hours, and doctors.
Also run `node social/gbp/generate.mjs` to create its Google Business Profile sheet.

## Deploying to Namecheap cPanel
1. `npm run build`
2. In cPanel, open the document root of therapyandinjury.com. Use the folder cPanel assigned to that domain, **not** the `public_html/` of another site in this repo.
3. Upload the **contents** of `dist/`, including the hidden `.htaccess` file. In File Manager, turn on "Show Hidden Files."
4. Turn on AutoSSL / HTTPS for the domain. The `.htaccess` forces HTTPS and the bare domain.
5. Add each city domain as an **Alias** of therapyandinjury.com. The `.htaccess` sends each one to its branch page.

## SEO (same playbook as CoverageOnCall)
- **Sitemap** `/sitemap.xml`: built from one list of indexable URLs (`src/lib/paths.ts`) with priority, change frequency and blog dates. Coming-soon locations are excluded.
- **robots.txt**: open to all crawlers. AI search and answer engines (GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot, Google-Extended and others) are named explicitly so they can cite the site.
- **`/llms.txt`**: a plain-language fact sheet for AI assistants, built from the same data as the site. Unfilled placeholders are left out.
- **IndexNow**: key file at `/<key>.txt`. Run `npm run indexnow` after each upload to tell Bing (which also feeds ChatGPT and Copilot search) about every page.
- **Structured data**: Organization and WebSite on every page (with alternate names "Florida Therapy & Injury" and "Therapy and Injury"), MedicalBusiness per location, plus Service, FAQPage, BreadcrumbList, MedicalWebPage, Article and BlogPosting where they fit.
- **Every page**: unique title and description, self-referencing canonical, Open Graph and Twitter cards, and a branded 1200×630 OG image per location.
- **Google Analytics 4 and verification**: set `seo.gaMeasurementId`, `seo.googleSiteVerification` and `seo.bingSiteVerification` in `src/data/site.json`. GA sends cleaned page views only (just UTM and gclid parameters) and never sees form data.
- **Build gate**: `scripts/seo-check.mjs` fails the build on a missing or duplicate title or description, a wrong canonical, a missing H1 or OG image, invalid JSON-LD, broken internal links, or a sitemap that doesn't match the indexable pages. It warns on lengths.
- **Content**: condition guides (`src/lib/conditions.ts`), FAQ (`src/lib/faq.ts`), a car-accident checklist, a local "car accident chiropractor" page per open location, and a Markdown blog (`src/content/blog/`, with RSS at `/blog/rss.xml`).

### After launch
1. Google Search Console: add the domain property, paste the verification code into `site.json`, rebuild, upload, then submit `https://therapyandinjury.com/sitemap.xml`.
2. Bing Webmaster Tools: import from Search Console (or verify with `seo.bingSiteVerification`), then run `npm run indexnow`.
3. Google Business Profile per open location (`social/gbp/`), linking to the location page with its UTM link.
4. New blog post: add a Markdown file, run `npm run build`, upload, then run `npm run indexnow`.

## Project map
```
src/data/site.json         brand-wide facts (phone, form endpoint, Carepatron patientLinks, SEO ids)
src/data/branches.json     one entry per location (drives most of the site)
src/lib/site.ts            helpers: names, hours, schema
src/lib/content.ts         shared service and "how care works" copy
src/lib/conditions.ts      condition guides
src/lib/faq.ts             site-wide FAQ
src/lib/paths.ts           every indexable URL (sitemap, llms.txt, IndexNow)
src/content/blog/          blog posts (Markdown)
scripts/                   seo-check.mjs, indexnow.mjs
src/lib/og.ts              build-time OG image renderer
src/components/            Wordmark, Header, Footer, BranchCard, AppointmentForm, LocationPicker
src/pages/                 every page, plus sitemap.xml, robots.txt, llms.txt, the IndexNow key, and OG images
public/brand/              brand mark SVGs and favicons (from the brand pack, unmodified)
public/api/appointment.php placeholder form handler (see TODO.md)
brand-assets/              full original brand pack, for reference
social/                    social launch kit (see social/README.md)
```

## Brand rules used in code
- Colors: navy `#0B2D5B`, teal `#19CCBE`, slate `#6B7B8C`, light gray `#F4F6F8`.
- Teal fails WCAG AA as text on white (2.0:1), so it's used only for fills and accents. Teal buttons carry navy text (6.8:1).
- Small text uses a darker slate `#57667A`, which passes AA. Brand slate `#6B7B8C` is for large text and decoration only.
- Type: Inter (self-hosted via Fontsource on the site, Google Fonts in social templates).
- The mark is always the original SVG. It is never recolored, stretched, or given effects. Navy backgrounds use the official white version.
