# therapyandinjury.com

Static website and social media launch kit for **Therapy & Injury**, chiropractic injury and wellness care across Florida.
Operated by Florida Therapy & Injury, P.A.

Built with [Astro](https://astro.build). The build is plain HTML/CSS with a little JS, ready for Namecheap cPanel hosting.

See **[TODO.md](TODO.md)** for every placeholder and decision still open.

## Quick start
```bash
cd therapyandinjury
npm install
npm run dev       # http://localhost:4321
npm run build     # outputs dist/
```
Requires Node 22+.

## Adding a new city
Add one entry to `src/data/branches.json` (copy an existing one), then run `npm run build`. That creates:
- `/<slug>/`: the branch page, with its own title, meta description, MedicalBusiness schema, map, and form
- `/og/<slug>.png`: its Open Graph image
- an entry in the sitemap, the Locations page, the home page picker, and the footer
- a redirect from each domain in its `domains` list to the branch page (in the generated `.htaccess`)

Use `"status": "coming soon"` until it opens. Then switch to `"open"` and add the address, hours, and doctors.
Also run `node social/gbp/generate.mjs` to create its Google Business Profile sheet.

## Deploying to Namecheap cPanel
1. `npm run build`
2. In cPanel, open the document root of therapyandinjury.com. Use the folder cPanel assigned to that domain, **not** the `public_html/` of another site in this repo.
3. Upload the **contents** of `dist/`, including the hidden `.htaccess` file. In File Manager, turn on "Show Hidden Files."
4. Turn on AutoSSL / HTTPS for the domain. The `.htaccess` forces HTTPS and the bare domain.
5. Add each city domain as an **Alias** of therapyandinjury.com. The `.htaccess` sends each one to its branch page.

## Project map
```
src/data/site.json         brand-wide facts (phone, legal name, form endpoint)
src/data/branches.json     one entry per location (drives most of the site)
src/lib/site.ts            helpers: names, hours, schema
src/lib/content.ts         shared service and "how care works" copy
src/lib/og.ts              build-time OG image renderer
src/components/            Wordmark, Header, Footer, BranchCard, AppointmentForm, LocationPicker
src/pages/                 home, auto-accident-injuries, services, about, locations, [city], privacy, accessibility, 404
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
