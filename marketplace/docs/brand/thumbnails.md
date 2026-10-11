# Video thumbnails and social graphics

Owner's rules (Oct 2026). Follow them for every new thumbnail, reel cover and social graphic.

## Where to make them (owner decision, Oct 2026)
- Default: build them here in code (HTML/SVG rendered to PNG). That keeps the real logo, fonts, colors and app screens exact, has no credit limits, and a series comes from one template.
- Use Canva only when a design needs something we can't make here, mainly realistic photos of people. Even then, put in the real logo and app screens and check every AI-made detail (logos, prices, names, placeholders) before saving.
- Later: once we have a library of licensed people photos stored in the project, photo-based designs move here too.

## People
- Show the range of people in America: a mix of ethnicities, ages and genders across a set of thumbnails. Don't repeat the same look from one design to the next.
- The owner approved the casting in the "Shake Up The Industry" ad set (Oct 2026, Canva designs DAHXtqvDvAo feed / DAHXtj4GIh0 story) as the benchmark: several ethnicities, ages and genders, and a mix of specialties in each group shot.
- Never use a real person's likeness without a signed release.

## Specialties
- Use imagery that works for any healthcare specialty, so the thumbnails don't need redoing when we add professions. Good choices: a provider in neutral clinical attire or scrubs, a front desk, a phone with the app, a calendar or shift card.
- Mix in other specialties (physical therapy, massage, nursing, sonography and others) alongside chiropractic.
- The copy must not say we offer a profession that isn't live yet. Only chiropractic is live today, so use words like "provider", "clinic" and "coverage" instead of naming other specialties.
- Avoid chiropractic-only props (spine models, adjusting tables) unless the video is specifically about chiropractic.

## App screens
- Use real app screens instead of AI-drawn phones. AI phones invent prices, cities and dates.
- Real screens live in `apps/web/public/brand/screens/` and are served at `https://coverageoncall.com/brand/screens/<file>.png` once a release is installed. In Canva, use upload-asset-from-url with that address; local uploads are blocked from the build environment.
- These screens come from the test site's demo data (made-up clinics, providers and amounts). Treat every number on them as an example.
- To add a screen, copy it from `dist/marketing/screenshots/` into that folder, then release.

## Brand
- Navy #282472, teal #22C4BE. Use the real logo mark (`/brand/logo-mark.svg`) on a white circle, never an AI-drawn logo.
- Use the same layout family as the approved thumbnails: bold headline (2 lines max), short sub-line, logo top-left.
