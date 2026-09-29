# CoverageOnCall brand

`logo-reference.jpg` is the approved logo artwork. Everything else here is rebuilt from it.

## Colors

| Role | Hex | Tailwind token | Use for |
|---|---|---|---|
| Navy (primary) | `#282472` | `brand-600` | Buttons, links, active states, headings, the "Coverage" in the wordmark |
| Teal (accent) | `#22C4BE` | `accent-500` | Logo, highlights, decorative icons, the "OnCall" in the wordmark |
| Teal, for text | `#16A19C` / `#15807D` | `accent-600` / `accent-700` | Teal text on white. `accent-500` is too light for body text. |

Full scales live in `apps/web/src/app/globals.css`. Use the tokens, never raw hex values, in the app.

## Type

- **Outfit**, weight 600: the wordmark, plus page-level headings (`h1`, `h2`).
- **Inter**: everything else.

Both fonts are self-hosted at build time through `next/font`.

## Files

| File | What |
|---|---|
| `logo.svg` | Horizontal logo for light backgrounds. The wordmark is converted to outlines, so no font is needed. |
| `logo-white.svg` | The same, for navy or dark backgrounds |
| `logo-mark.svg` | The symbol on its own |
| `logo.png` | High-resolution PNG with a transparent background, for decks and print |

The web app uses:
- `apps/web/public/brand/*`, and email headers use `mark-email.png`.
- `apps/web/src/app/{favicon.ico,icon.svg,apple-icon.png,opengraph-image.png}`.
- `public/icons/*` for the installable web app (via `app/manifest.ts`).

The favicon has slightly thicker strokes than the full-size mark so it stays legible at 16 px.

## Regenerating

`make_logo.py` rebuilds the SVGs. It needs `pip install fonttools brotli` and `Outfit600.woff2` (Outfit weight 600, from Google Fonts) in the same folder.
