# Ad sets

Rendered here in code (house theme, real logo, real app screens), per docs/brand/thumbnails.md. Don't reuse the people cut-outs in ../thumbnails/people (owner, Oct 2026).

- `holiday.cjs` — "Now Is The Time" holiday coverage (Oct 2026): 5 feed slides (1080x1350) + 5 story frames (1080x1920).
  Run `node marketing/ads/holiday.cjs` (needs `dist/marketing/screenshots/` and a web build for the fonts); `OUT=dir` changes the output folder (default `marketing/ads/out/holiday`, ignored by git).
- `welcome.cjs` — "Welcome Discount" clinic ad set (Oct 2026): 5 feed slides, 5 story frames, 1 square post (`node marketing/ads/welcome.cjs stills`, output `marketing/ads/out/welcome`), and the 32 s explainer reel frames (`node marketing/ads/welcome.cjs frames <story|feed> <dir> 30 0,7.8,14.4,22.1 32.5`), voiced with the `warm` preset: 4 lines placed at 0.5 / 8.1 / 14.7 / 22.4 s, soft café bed ducked under the voice, loudness -16 LUFS (ffmpeg). Clinic audiences only.
