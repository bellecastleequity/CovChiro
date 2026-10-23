# Video thumbnails and social graphics

Owner's rules (Oct 2026). Follow them for every new thumbnail, reel cover and social graphic.

## Style rule (owner, Oct 2026)
- Every thumbnail and graphic uses our local, in-code style (marketing/thumbnails/thumbs.cjs): navy/teal gradient, Outfit headline with the teal second half, audience pill, real logo, real app screens in a phone or browser frame, coverageoncall.com at the bottom. The owner rejected the Canva-made layouts; replace them with local renders.
- Two themes, rotated for variety (owner, Oct 23 2026: "use this light theme along with our blue theme"):
  - **Blue (dark):** the navy/teal gradient above (marketing/thumbnails/thumbs.cjs, marketing/ads/welcome.cjs). White text, white logo (logo-white.svg).
  - **Light:** white-to-silver background (`linear-gradient(170deg,#ffffff,#f1f3f7 40%,#dde2ea)` plus a soft teal glow in one corner) with a brand color line down the left side (22 px, teal #22C4BE at the top fading to navy #282472, soft teal glow, a thin navy line beside it). Navy headlines with the teal second half (#14aaa4 for text, brand teal for the line and button), slate body text, the full-color logo (logo.svg), white cards with soft shadows, a teal button with navy text, navy-framed phones. Reference: marketing/ads/change.cjs ("Do you feel it? Change is good." reel, Oct 2026).
  - Alternate them across new creations (a set may mix both); keep the fonts, logo, pill, real app screens and coverageoncall.com the same in both.
- Canva is only for making realistic people assets when a design truly needs a person. The design itself is always the local template.
- No people by default: render with NOPEOPLE=1 (the owner retired the existing cut-outs).

## Where to make them (owner decision, Oct 2026)
- Default: build them here in code (HTML/SVG rendered to PNG). That keeps the real logo, fonts, colors and app screens exact, has no credit limits, and a series comes from one template.
- Use Canva only when a design needs something we can't make here, mainly realistic photos of people. Even then, put in the real logo and app screens and check every AI-made detail (logos, prices, names, placeholders) before saving.
- The YouTube thumbnail renderer and a first people library (cut-outs from the approved Canva set) live in marketing/thumbnails/. New series start from that template.
- Later: add licensed people photos to marketing/thumbnails/people/ so photo-based designs never need Canva.

## People
- Show the range of people in America: a mix of ethnicities, ages and genders across a set of thumbnails. Don't repeat the same look from one design to the next.
- The owner approved the casting in the "Shake Up The Industry" ad set (Oct 2026, Canva designs DAHXtqvDvAo feed / DAHXtj4GIh0 story) as the benchmark: several ethnicities, ages and genders, and a mix of specialties in each group shot.
- Never use a real person's likeness without a signed release.
- Owner, Oct 2026: the people cut-outs in marketing/thumbnails/people have been used enough. Don't reuse them in new ads: go without people (real app screens, calendars, icons, graphics), or make new people in Canva when a design truly needs them.

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
