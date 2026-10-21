# Builds every InjuryCase logo file from code, so the brand stays exact and
# reproducible:  python3 pi_portal/brand/src/build.py
# Needs: fonttools, uharfbuzz, and Inter Display (SIL Open Font License) at
# /usr/share/fonts/opentype/inter/. The wordmark is converted to outlines,
# so the output SVGs don't depend on any installed font.
import os, sys
import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
sys.path.insert(0, os.path.dirname(__file__))
from mark import mark

OUT = os.path.join(os.path.dirname(__file__), '..')
FONTS = '/usr/share/fonts/opentype/inter/'
INDIGO, MINT, NAVY, WHITE, BLACK = '#2B3FD6', '#5EEAD4', '#0F1733', '#FFFFFF', '#000000'
TRACK = -0.012  # em; slightly tight, as display type should be

class Face:
    def __init__(self, file):
        self.path = FONTS + file
        self.tt = TTFont(self.path)
        self.upm = self.tt['head'].unitsPerEm
        self.cap = self.tt['OS/2'].sCapHeight
        self.glyphs = self.tt.getGlyphSet()
        blob = hb.Blob.from_file_path(self.path)
        self.hbfont = hb.Font(hb.Face(blob))
    def run(self, text, size, x0, baseline, fill):
        """Outlined text as an SVG path; returns (svg, advance)."""
        buf = hb.Buffer(); buf.add_str(text); buf.guess_segment_properties()
        hb.shape(self.hbfont, buf, {'kern': True, 'liga': True})
        s = size / self.upm
        x = x0; d = []
        for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
            name = self.tt.getGlyphName(info.codepoint)
            pen = SVGPathPen(self.glyphs)
            self.glyphs[name].draw(TransformPen(pen, (s, 0, 0, -s, x + pos.x_offset * s, baseline - pos.y_offset * s)))
            d.append(pen.getCommands())
            x += pos.x_advance * s + TRACK * size
        return '<path fill="%s" d="%s"/>' % (fill, ' '.join(d)), x - x0 - TRACK * size

MED, BOLD = Face('InterDisplay-Medium.otf'), Face('InterDisplay-Bold.otf')

def wordmark(cap_h, x0, baseline, c1, c2):
    size = cap_h * MED.upm / MED.cap
    p1, w1 = MED.run('Injury', size, x0, baseline, c1)
    p2, w2 = BOLD.run('Case', size, x0 + w1 + 0.01 * size, baseline, c2)
    return p1 + p2, w1 + 0.01 * size + w2, size

def svg(w, h, body, label='InjuryCase'):
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %.1f %.1f" role="img" aria-label="%s">%s</svg>' % (w, h, label, body)

def inner(m):  # strip the outer <svg> of a mark so it can be nested
    return m[m.index('>') + 1:m.rindex('</svg>')]

def horizontal(mk, c1, c2):
    cap = 64 * 0.40; gap = 64 * 0.2; base = 32 + cap / 2
    text, tw, size = wordmark(cap, 64 + gap, base, c1, c2)
    pad_b = size * 0.24  # descenders of j and y
    return svg(64 + gap + tw, 64, '<g>%s</g>%s' % (inner(mk), text))

def stacked(mk, c1, c2):
    cap = 64 * 0.29
    _, tw, size = wordmark(cap, 0, 0, c1, c2)
    W = max(tw, 64); base = 64 + 64 * 0.22 + cap
    text, _, _ = wordmark(cap, (W - tw) / 2, base, c1, c2)
    H = base + size * 0.24
    return svg(W, H, '<g transform="translate(%.2f 0)">%s</g>%s' % ((W - 64) / 2, inner(mk), text))

def wordmark_only(c1, c2):
    cap = 40; text, tw, size = wordmark(cap, 0, cap + 2, c1, c2)
    return svg(tw, cap + 2 + size * 0.24, text)

marks = {
    'mark': mark(),
    'mark-navy': mark(bg=NAVY),
    'mark-mono-black': mark(bg=BLACK, glyph=WHITE, arrow=WHITE),
    'mark-mono-white': mark(bg=WHITE, glyph=NAVY, arrow=NAVY),
    'mark-small': mark(with_c=False),
}
files = {k: v for k, v in marks.items()}
files['logo-horizontal'] = horizontal(marks['mark'], NAVY, INDIGO)
files['logo-horizontal-dark'] = horizontal(marks['mark'], WHITE, MINT)
files['logo-stacked'] = stacked(marks['mark'], NAVY, INDIGO)
files['logo-stacked-dark'] = stacked(marks['mark'], WHITE, MINT)
files['logo-mono-black'] = horizontal(marks['mark-mono-black'], BLACK, BLACK)
files['logo-mono-white'] = horizontal(marks['mark-mono-white'], WHITE, WHITE)
files['wordmark'] = wordmark_only(NAVY, INDIGO)
files['wordmark-dark'] = wordmark_only(WHITE, MINT)

# clipPath ids must be unique per file once several logos share a page
import re
for name, content in files.items():
    content = re.sub(r'id="(c\d+)"', lambda m: 'id="%s-%s"' % (m.group(1), name), content)
    content = re.sub(r'url\(#(c\d+)\)', lambda m: 'url(#%s-%s)' % (m.group(1), name), content)
    open(os.path.join(OUT, 'injurycase-%s.svg' % name), 'w').write(content)
print('wrote', len(files), 'SVGs to', os.path.abspath(OUT))
