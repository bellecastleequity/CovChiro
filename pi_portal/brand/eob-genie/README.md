# EOB Genie — brand kit

**Insurance EOBs. Explained.** EOB Genie makes insurance Explanation of
Benefits documents easier for medical professionals to understand and
process. Supporting phrases: *Make sense of your EOBs.* · *Your EOBs, made
simple.* · *Clearer EOBs. Less stress.*

Every file here is built from code (`src/build.py`, then `src/render.mjs` for
the PNGs), so the logo is exact and reproducible. The wordmark and tagline are
Montserrat converted to outlines — the SVGs don't depend on installed fonts.
The genie mascot is raster artwork (`src/mascot.png`, 344 × 434 px) embedded in
the SVGs; see *Mascot* below.

## Files

| File | Use |
|---|---|
| `eob-genie-logo-horizontal` (.svg, png/) | Primary logo: website headers, documents, slides |
| `eob-genie-logo-horizontal-dark` | On Midnight or other dark backgrounds (transparent) |
| `eob-genie-logo-horizontal-on-midnight` | Dark version on a Midnight tile |
| `eob-genie-logo-stacked`, `-stacked-dark` | Square and centred layouts |
| `eob-genie-wordmark`, `-wordmark-dark` | Where the mascot already appears nearby |
| `eob-genie-logo-mono-black`, `-mono-white` | One-colour printing, fax, embossing |
| `eob-genie-app-icon` (+ png/ 1024, 512, 256, 192, 128, 64, 48) | App tiles, social avatars |
| `png/apple-touch-icon.png` (180, square) · `png/icon-512-maskable.png` | Phone home screens, Android maskable |
| `eob-genie-favicon` · `png/favicon.ico` (16/32/48), `png/favicon-16/32.png` | Browser tabs — the head only, so a face still reads at 16 px |
| `icons/icon-*.svg` (Ocean Blue, `-midnight`, `-white`) + png/icons (128, 512) | Shield (accurate analysis), lightning (saves time), heart (less stress), document (clear answers), EOB document (EOB checked), sparkle (trusted partner) |
| `eob-genie-palette`, `-typography`, `-clear-space`, `-brand-sheet` | Reference sheets |

## Colors

| | Hex | Use |
|---|---|---|
| Frost Blue | `#CFF4FF` | Light backgrounds, brand tint, app-icon tile (top) |
| Arctic Blue | `#69C8E8` | Accent; "Genie" in the wordmark; app-icon tile (bottom) |
| Ocean Blue | `#176A96` | Buttons, links, UI icons |
| Midnight | `#152E46` | Text, headers, dark surfaces |
| Silver | `#E6EEF5` | Borders, neutral backgrounds |
| White | `#FFFFFF` | Negative space |

On light backgrounds "Genie" is a vertical gradient from Arctic Blue to
`#2A93C8` (45% of the way to Ocean Blue): flat Arctic Blue on white is too
faint to read (about 1.9:1). On dark backgrounds it's flat Arctic Blue.

## Typography

Montserrat (SIL Open Font License, files in `src/fonts`): **ExtraBold** for the
wordmark, **Bold** for headings, **SemiBold** for subheadings and the tagline
(all caps, tracking +0.20 em), **Medium / Regular** for body copy. Fallback:
Arial or a similar clean sans-serif.

## Logo use

- Prefer the horizontal logo; use the stacked logo for square or centred layouts, the app icon or favicon for tiles and tabs.
- Use the dark versions on Midnight or similarly dark surfaces, the one-colour versions when colour printing isn't available.
- Clear space: at least the height of the "E" in EOB on every side (see `eob-genie-clear-space`). Minimum size: horizontal logo 160 px wide on screen, 1.25 in in print.
- Don't stretch, skew or recolour the mascot, add effects, or set the wordmark in another font.

## Mascot

The mascot in the original kit had flaws carried into every logo and icon,
fixed here: a navy divider bar from the brand board beside the genie, a white
"ground haze" that showed on dark backgrounds, and see-through eye whites and
jewel highlights. Its resolution (344 × 434 px) is fine on screen and for the
app icon up to 512 px, but **too small for print or large signage**. For those,
re-export the genie at 2000 px or more (or as vector artwork) and save it as
`src/mascot.png`; `build.py` and `render.mjs` regenerate everything.

## Rebuilding

```
python3 pi_portal/brand/eob-genie/src/build.py
node pi_portal/brand/eob-genie/src/render.mjs pi_portal/brand/eob-genie
```
Needs Python with `fonttools` and `uharfbuzz`, and Node with Playwright/Chromium.
