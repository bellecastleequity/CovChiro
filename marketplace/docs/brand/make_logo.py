from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

NAVY, TEAL = "#282472", "#22C4BE"
MARK = '''<path d="M88.24 34.57A38 38 0 0 0 23.13 69.19" stroke="{n}" stroke-width="17.5" stroke-linecap="round" fill="none"/>
  <path d="M35.57 89.11A38 38 0 0 0 90.74 82.34" stroke="{t}" stroke-width="17.5" stroke-linecap="round" fill="none"/>
  <circle cx="60" cy="60" r="10.5" fill="{t}"/>'''

font = TTFont("Outfit600.woff2")
gs, cmap, hmtx = font.getGlyphSet(), font.getBestCmap(), font["hmtx"]
cap = font["OS/2"].sCapHeight
kern = {}
# Outfit ships kerning in GPOS; plain advance widths are close enough at logo sizes.

def text_path(s, x0, baseline, scale):
    d, x = [], 0
    for ch in s:
        g = cmap[ord(ch)]
        pen = SVGPathPen(gs)
        gs[g].draw(TransformPen(pen, (scale, 0, 0, -scale, x0 + x * scale, baseline)))
        d.append(pen.getCommands())
        x += hmtx[g][0]
    return " ".join(d), x * scale

# Measured from the reference artwork: cap height = 0.283 x the mark's outer
# height, gap = 0.11 x it; text vertically centred on the mark.
outer = 2 * (38 + 17.5 / 2)          # 93.5 units, spanning y 13.25..106.75
scale = 0.283 * outer / cap
baseline = 60 + 0.283 * outer / 2
x_text = 60 + 38 * 0.83 + 8.75 + 0.11 * outer   # right edge of the mark + gap
p1, w1 = text_path("Coverage", x_text, baseline, scale)
p2, w2 = text_path("OnCall", x_text + w1, baseline, scale)
width = x_text + w1 + w2 + 2

def lockup(n, t):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="12 12 {width - 12:.1f} 96" role="img" aria-label="CoverageOnCall">
  {MARK.format(n=n, t=t)}
  <path d="{p1}" fill="{n}"/>
  <path d="{p2}" fill="{t}"/>
</svg>
'''
open("logo.svg", "w").write(lockup(NAVY, TEAL))
open("logo-white.svg", "w").write(lockup("#FFFFFF", TEAL))
open("logo-mark.svg", "w").write(f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="12 12 96 96" role="img" aria-label="CoverageOnCall">
  {MARK.format(n=NAVY, t=TEAL)}
</svg>
''')
print("width", width)
