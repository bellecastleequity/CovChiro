# Builds every InjuryCase brand file from code, so the brand stays exact and
# reproducible:  python3 pi_portal/brand/src/build.py
# then render the PNGs:  node pi_portal/brand/src/render.mjs pi_portal/brand
# Needs: fonttools, uharfbuzz, and Inter (SIL Open Font License) at
# /usr/share/fonts/opentype/inter/. All text is converted to outlines, so
# the output SVGs don't depend on any installed font.
import os, re, sys
import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
sys.path.insert(0, os.path.dirname(__file__))
from mark import mark

OUT = os.path.join(os.path.dirname(__file__), '..')
FONTS = '/usr/share/fonts/opentype/inter/'
INDIGO, MINT, NAVY, WHITE, BLACK = '#2B3FD6', '#5EEAD4', '#0F1733', '#FFFFFF', '#000000'
GRAY, LINE = '#5B6476', '#E1E5EE'
TINTS = {'indigo': ['#2B3FD6', '#959FEA', '#CAD0F5'], 'mint': ['#5EEAD4', '#9EF2E5', '#DFFAF6']}
TRACK = -0.012  # em; slightly tight for the wordmark

class Face:
    def __init__(self, file):
        self.path = FONTS + file
        self.tt = TTFont(self.path)
        self.upm = self.tt['head'].unitsPerEm
        self.cap = self.tt['OS/2'].sCapHeight
        self.glyphs = self.tt.getGlyphSet()
        self.hbfont = hb.Font(hb.Face(hb.Blob.from_file_path(self.path)))
    def run(self, text, size, x0, baseline, fill, track=TRACK):
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
            x += pos.x_advance * s + track * size
        return '<path fill="%s" d="%s"/>' % (fill, ' '.join(d)), x - x0 - track * size
    def width(self, text, size, track=0):
        return self.run(text, size, 0, 0, '#000', track)[1]

REG, MED, SEMI, BOLD = Face('Inter-Regular.otf'), Face('Inter-Medium.otf'), Face('Inter-SemiBold.otf'), Face('Inter-Bold.otf')

def text(face, s, size, x, baseline, fill, anchor='start', track=0):
    if anchor != 'start':
        w = face.width(s, size, track)
        x -= w / 2 if anchor == 'middle' else w
    return face.run(s, size, x, baseline, fill, track)[0]

def label(s, size, x, baseline, fill, anchor='start'):  # small caps-style section labels
    return text(MED, s.upper(), size, x, baseline, fill, anchor, track=0.12)

def wordmark(cap_h, x0, baseline, c1, c2):
    size = cap_h * MED.upm / MED.cap
    p1, w1 = MED.run('Injury', size, x0, baseline, c1)
    p2, w2 = BOLD.run('Case', size, x0 + w1 + 0.01 * size, baseline, c2)
    return p1 + p2, w1 + 0.01 * size + w2, size

def svg(w, h, body, label='InjuryCase', bg=None):
    back = '<rect width="100%%" height="100%%" fill="%s"/>' % bg if bg else ''
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %.1f %.1f" role="img" aria-label="%s">%s%s</svg>' % (w, h, label, back, body)

def inner(m):  # strip the outer <svg> of a file so it can be nested
    return m[m.index('>') + 1:m.rindex('</svg>')]

def size_of(m):
    w, h = re.search(r'viewBox="0 0 ([\d.]+) ([\d.]+)"', m).groups()
    return float(w), float(h)

def place(m, x, y, w=None, h=None):
    """Nest a whole file at (x, y), scaled to width w or height h."""
    vw, vh = size_of(m)
    if w is None: w = h * vw / vh
    if h is None: h = w * vh / vw
    return '<svg x="%.2f" y="%.2f" width="%.2f" height="%.2f" viewBox="0 0 %.1f %.1f">%s</svg>' % (x, y, w, h, vw, vh, inner(m))

def horizontal(mk, c1, c2):
    cap = 64 * 0.40; gap = 64 * 0.2; base = 32 + cap / 2
    t, tw, size = wordmark(cap, 64 + gap, base, c1, c2)
    return svg(64 + gap + tw, 64, '<g>%s</g>%s' % (inner(mk), t))

def stacked(mk, c1, c2):
    cap = 64 * 0.29
    _, tw, size = wordmark(cap, 0, 0, c1, c2)
    W = max(tw, 64); base = 64 + 64 * 0.22 + cap
    t, _, _ = wordmark(cap, (W - tw) / 2, base, c1, c2)
    H = base + size * 0.24
    return svg(W, H, '<g transform="translate(%.2f 0)">%s</g>%s' % ((W - 64) / 2, inner(mk), t))

def wordmark_only(c1, c2):
    cap = 40; t, tw, size = wordmark(cap, 0, cap + 2, c1, c2)
    return svg(tw, cap + 2 + size * 0.24, t)

def with_tagline(mk, line1, line2, c1, c2, c3):
    """Horizontal logo, a thin divider, and a two-line tagline."""
    logo = horizontal(mk, c1, c2); lw, lh = size_of(logo)
    x = lw + 18; ts = 11.5
    body = inner(logo) + '<rect x="%.2f" y="16" width="1" height="32" fill="%s"/>' % (x, LINE if c3 == GRAY else c3)
    body += text(REG, line1, ts, x + 18, 29.5, c3) + text(REG, line2, ts, x + 18, 45, c3)
    w = x + 18 + max(REG.width(line1, ts), REG.width(line2, ts))
    return svg(w, 64, body)

marks = {
    'mark': mark(),
    'mark-navy': mark(bg=NAVY),
    'mark-mono-black': mark(bg=BLACK, glyph=WHITE, arrow=WHITE),
    'mark-mono-white': mark(bg=WHITE, glyph=NAVY, arrow=NAVY),
    'mark-small': mark(with_c=False),
}
files = dict(marks)
files['logo-horizontal'] = horizontal(marks['mark'], NAVY, INDIGO)
files['logo-horizontal-dark'] = horizontal(marks['mark'], WHITE, INDIGO)
files['logo-stacked'] = stacked(marks['mark'], NAVY, INDIGO)
files['logo-stacked-dark'] = stacked(marks['mark'], WHITE, INDIGO)
files['logo-mono-black'] = horizontal(marks['mark-mono-black'], BLACK, BLACK)
files['logo-mono-white'] = horizontal(marks['mark-mono-white'], WHITE, WHITE)
files['wordmark'] = wordmark_only(NAVY, INDIGO)
files['wordmark-dark'] = wordmark_only(WHITE, INDIGO)
files['logo-tagline-manage'] = with_tagline(marks['mark'], 'Manage Cases', 'Move Patients Forward', NAVY, INDIGO, GRAY)
files['logo-tagline-settlement'] = with_tagline(marks['mark'], 'From First Visit', 'to Final Settlement', NAVY, INDIGO, GRAY)
files['logo-tagline-manage-dark'] = with_tagline(marks['mark'], 'Manage Cases', 'Move Patients Forward', WHITE, INDIGO, '#C9D1EA')
files['logo-tagline-settlement-dark'] = with_tagline(marks['mark'], 'From First Visit', 'to Final Settlement', WHITE, INDIGO, '#C9D1EA')
# Favicons as their own files (the 16px one is the simplified "i" + arrow).
files['favicon-32'] = marks['mark']
files['favicon-16'] = marks['mark-small']

# ---- Guideline boards: palette, tints, typography, clear space, small sizes ----
def swatch(x, y, w, h, color, name, hexv, ink):
    return ('<rect x="%d" y="%d" width="%d" height="%d" rx="10" fill="%s"/>' % (x, y, w, h, color)
            + text(SEMI, name, 18, x + 18, y + h - 38, ink) + text(REG, hexv, 15, x + 18, y + h - 16, ink))

def palette():
    body = swatch(0, 0, 150, 110, INDIGO, 'Indigo', '#2B3FD6', WHITE) + swatch(162, 0, 150, 110, MINT, 'Mint', '#5EEAD4', NAVY) + swatch(324, 0, 150, 110, NAVY, 'Navy', '#0F1733', WHITE)
    body += label('Color palette', 13, 237, 146, GRAY, 'middle')
    for i, (k, row) in enumerate(TINTS.items()):
        x0 = 510 + i * 200
        for j, c in enumerate(row):
            body += '<rect x="%d" y="20" width="52" height="52" rx="8" fill="%s"/>' % (x0 + j * 60, c)
        body += label('%s tints' % k, 13, x0 + 86, 102, GRAY, 'middle')
    return svg(900, 156, body, 'InjuryCase color palette', bg=WHITE)

def typography():
    body = text(BOLD, 'Aa', 150, 0, 140, NAVY, track=-0.02)
    body += text(SEMI, 'Inter', 44, 210, 52, NAVY) + text(REG, 'Clean. Modern. Professional.', 19, 210, 86, GRAY)
    body += MED.run('InjuryCase', 17 * MED.upm / MED.cap, 210, 136, NAVY)[0] + text(REG, 'Medium (Injury)', 14, 210, 160, GRAY)
    wm2, _, _ = wordmark(17, 390, 136, NAVY, INDIGO)
    body += wm2 + text(REG, 'Bold (Case)', 14, 390, 160, GRAY)
    body += text(REG, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789', 13, 0, 200, GRAY)
    return svg(560, 214, body, 'InjuryCase typography', bg=WHITE)

def clear_space():
    # Clear space = height of the "i" (dot top to stem baseline), 9.2..51 → ~42 units of 64.
    u = 42 / 64 * 120; m = 120; x0 = y0 = u
    W = m + 2 * u
    dash = 'stroke="#B8BFD0" stroke-width="1" stroke-dasharray="4 4" fill="none"'
    body = '<rect x="0.5" y="0.5" width="%.1f" height="%.1f" %s/>' % (W - 1, W - 1, dash)
    body += '<rect x="%.1f" y="%.1f" width="%d" height="%d" %s/>' % (x0, y0, m, m, dash)
    for (cx, cy) in [(u / 2, u / 2), (W - u / 2, u / 2), (u / 2, W - u / 2), (W - u / 2, W - u / 2), (u / 2, W / 2), (W - u / 2, W / 2), (W / 2, u / 2), (W / 2, W - u / 2)]:
        body += '<path d="M%.1f %.1fl10 10m0 -10l-10 10" stroke="#B8BFD0" stroke-width="1.5"/>' % (cx - 5, cy - 5)
    body += place(marks['mark'], x0, y0, w=m)
    tx = W + 34
    body += label('Clear space', 17, tx, 40, NAVY)
    for i, l in enumerate(['Keep clear space equal', 'to the height of the "i"', '(dot to baseline) on', 'all sides.']):
        body += text(REG, l, 17, tx, 74 + i * 25, GRAY)
    return svg(tx + 230, W, body, 'InjuryCase clear space', bg=WHITE)

def small_sizes():
    body = label('Icon at small sizes', 14, 260, 22, GRAY, 'middle'); x = 0
    for px in (128, 64, 32, 16):
        src = marks['mark-small'] if px == 16 else marks['mark']
        body += place(src, x, 150 - px, w=px) + text(REG, '%d×%d' % (px, px), 13, x + px / 2, 176, GRAY, 'middle')
        x += px + 60
    return svg(x - 40, 186, body, 'InjuryCase icon sizes', bg=WHITE)

files['palette'] = palette()
files['typography'] = typography()
files['clear-space'] = clear_space()
files['icon-sizes'] = small_sizes()

# ---- The brand sheet: everything on one board ----
def sheet():
    W, H = 1536, 1024; b = ''
    def cell(x, y, w, h, dark=False):
        return '<rect x="%d" y="%d" width="%d" height="%d" fill="%s"/>' % (x, y, w, h, NAVY if dark else WHITE)
    b += cell(0, 0, W, H)
    b += cell(805, 0, 731, 312, True) + cell(1187, 318, 349, 278, True) + cell(754, 810, 260, 158, True)
    for y in (314, 598, 776): b += '<rect x="0" y="%d" width="%d" height="1" fill="%s"/>' % (y, W, LINE)
    b += place(files['logo-horizontal'], 55, 70, w=700) + label('Primary logo (horizontal)', 13, 402, 284, GRAY, 'middle')
    b += place(files['logo-horizontal-dark'], 853, 70, w=640) + label('Primary logo (dark background)', 13, 1170, 284, '#C9D1EA', 'middle')
    b += cell(277, 355, 172, 172, False)
    b += place(marks['mark'], 48, 355, w=172) + label('App icon', 12, 134, 551, GRAY, 'middle') + label('(white background)', 12, 134, 569, GRAY, 'middle')
    b += place(marks['mark-navy'], 277, 355, w=172) + label('App icon', 12, 363, 551, GRAY, 'middle') + label('(navy background)', 12, 363, 569, GRAY, 'middle')
    b += place(marks['mark'], 520, 398, w=102) + label('Favicon', 12, 571, 551, GRAY, 'middle') + label('(32×32)', 12, 571, 569, GRAY, 'middle')
    b += place(marks['mark-small'], 721, 432, w=52) + label('Favicon', 12, 747, 551, GRAY, 'middle') + label('(16×16)', 12, 747, 569, GRAY, 'middle')
    b += place(files['logo-stacked'], 892, 346, h=180) + label('Stacked logo', 12, 1011, 556, GRAY, 'middle') + label('(white background)', 12, 1011, 574, GRAY, 'middle')
    b += place(files['logo-stacked-dark'], 1243, 346, h=180) + label('Stacked logo', 12, 1362, 556, '#C9D1EA', 'middle') + label('(navy background)', 12, 1362, 574, '#C9D1EA', 'middle')
    b += place(files['palette'], 33, 618, w=810)
    b += place(files['clear-space'], 878, 622, w=310)
    b += place(files['icon-sizes'], 1222, 612, w=296)
    b += label('Typography', 13, 34, 802, GRAY) + place(files['typography'], 50, 822, w=420)
    b += label('Monochrome variations', 13, 520, 802, GRAY)
    b += place(marks['mark-mono-black'], 577, 832, w=74) + place(files['wordmark'].replace(NAVY, BLACK).replace(INDIGO, BLACK), 538, 908, w=152) + label('Black (print)', 12, 614, 986, GRAY, 'middle')
    b += place(marks['mark-mono-white'], 850, 832, w=74) + place(files['wordmark-dark'].replace(INDIGO, WHITE), 811, 908, w=152) + label('White (dark background)', 12, 886, 986, GRAY, 'middle')
    b += label('Alternative layouts', 13, 1070, 802, GRAY)
    b += place(files['logo-tagline-manage'], 1085, 826, h=58) + place(files['logo-tagline-settlement'], 1085, 914, h=58)
    return svg(W, H, b, 'InjuryCase brand sheet')
files['brand-sheet'] = sheet()

# clipPath ids must be unique per file once several logos share a page
for name, content in files.items():
    # give every clip id (including nested copies) a unique name, then point
    # each url() at the id that precedes it in document order
    parts = re.split(r'(id="c\d+(?:-[\w-]+)?"|url\(#c\d+(?:-[\w-]+)?\))', content)
    out, cur, k = [], {}, 0
    for p in parts:
        mi = re.fullmatch(r'id="(c\d+(?:-[\w-]+)?)"', p)
        mu = re.fullmatch(r'url\(#(c\d+(?:-[\w-]+)?)\)', p)
        if mi:
            k += 1; cur[mi.group(1)] = 'clip-%s-%d' % (name, k); out.append('id="%s"' % cur[mi.group(1)])
        elif mu:
            out.append('url(#%s)' % cur.get(mu.group(1), mu.group(1)))
        else:
            out.append(p)
    open(os.path.join(OUT, 'injurycase-%s.svg' % name), 'w').write(''.join(out))
print('wrote', len(files), 'SVGs to', os.path.abspath(OUT))
