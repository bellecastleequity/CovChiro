# Builds every EOB Genie brand file from code, so the brand stays exact and
# reproducible:  python3 pi_portal/brand/eob-genie/src/build.py
# then render the PNGs:  node pi_portal/brand/eob-genie/src/render.mjs pi_portal/brand/eob-genie
# Needs fonttools and uharfbuzz. Montserrat (SIL Open Font License) is in
# src/fonts. All text is converted to outlines, so the SVGs don't depend on
# installed fonts. The genie mascot is raster artwork (src/mascot.png, cleaned
# from the original kit: stray divider bar and white ground haze removed, eye
# and jewel highlights restored) embedded in the SVGs.
import base64, os
import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

SRC = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(SRC, '..')
FROST, ARCTIC, OCEAN, MIDNIGHT, SILVER, WHITE, BLACK = '#CFF4FF', '#69C8E8', '#176A96', '#152E46', '#E6EEF5', '#FFFFFF', '#000000'
GENIE_DEEP = '#2A93C8'   # Arctic → Ocean, 45% of the way: the lower edge of "Genie" on light backgrounds
GRAY = '#5B6B7C'
TAGLINE = 'INSURANCE EOBs. EXPLAINED.'

class Face:
    def __init__(self, file):
        self.path = os.path.join(SRC, 'fonts', file)
        self.tt = TTFont(self.path)
        self.upm = self.tt['head'].unitsPerEm
        self.cap = self.tt['OS/2'].sCapHeight
        self.glyphs = self.tt.getGlyphSet()
        self.hbfont = hb.Font(hb.Face(hb.Blob.from_file_path(self.path)))
    def run(self, text, size, x0, baseline, fill, track=0.0):
        """Outlined text as an SVG path; returns (svg, advance)."""
        buf = hb.Buffer(); buf.add_str(text); buf.guess_segment_properties()
        hb.shape(self.hbfont, buf, {'kern': True, 'liga': True})
        s = size / self.upm
        x = x0; d = []
        for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
            pen = SVGPathPen(self.glyphs)
            self.glyphs[self.tt.getGlyphName(info.codepoint)].draw(TransformPen(pen, (s, 0, 0, -s, x + pos.x_offset * s, baseline - pos.y_offset * s)))
            d.append(pen.getCommands())
            x += pos.x_advance * s + track * size
        return '<path fill="%s" d="%s"/>' % (fill, ' '.join(d)), x - x0 - track * size
    def width(self, text, size, track=0.0):
        return self.run(text, size, 0, 0, '#000', track)[1]

MED, SEMI, BOLD, XBOLD = (Face('Montserrat-%s.ttf' % w) for w in ('Medium', 'SemiBold', 'Bold', 'ExtraBold'))

def text(face, s, size, x, baseline, fill, anchor='start', track=0.0):
    if anchor != 'start':
        w = face.width(s, size, track)
        x -= w / 2 if anchor == 'middle' else w
    return face.run(s, size, x, baseline, fill, track)[0]

def label(s, size, x, baseline, fill, anchor='start'):
    return text(SEMI, s.upper(), size, x, baseline, fill, anchor, track=0.14)

def png64(name):
    with open(os.path.join(SRC, name), 'rb') as f:
        return 'data:image/png;base64,' + base64.b64encode(f.read()).decode()

MASCOT = {'color': png64('mascot.png'), 'mono': png64('mascot-mono.png'), 'head': png64('mascot-head.png')}
MASCOT_RATIO = 344 / 434   # width / height of src/mascot.png
HEAD_RATIO = 227 / 303

def mascot(x, y, h, kind='color'):
    w = h * (HEAD_RATIO if kind == 'head' else MASCOT_RATIO)
    return '<image href="%s" x="%.1f" y="%.1f" width="%.1f" height="%.1f" preserveAspectRatio="xMidYMid meet"/>' % (MASCOT[kind], x, y, w, h), w

def sparkle(cx, cy, r, fill):
    k = r * 0.22
    return ('<path fill="%s" d="M%.1f %.1f L%.1f %.1f L%.1f %.1f L%.1f %.1f L%.1f %.1f L%.1f %.1f L%.1f %.1f L%.1f %.1f Z"/>'
            % (fill, cx, cy - r, cx + k, cy - k, cx + r, cy, cx + k, cy + k, cx, cy + r, cx - k, cy + k, cx - r, cy, cx - k, cy - k))

DEFS = '<defs><linearGradient id="genie" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="%s"/><stop offset="1" stop-color="%s"/></linearGradient>' \
       '<linearGradient id="tile" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="%s"/><stop offset="1" stop-color="%s"/></linearGradient></defs>' % (ARCTIC, GENIE_DEEP, FROST, ARCTIC)

def svg(w, h, body, title='EOB Genie', bg=None, rx=0):
    b = '<rect width="%g" height="%g" rx="%g" fill="%s"/>' % (w, h, rx, bg) if bg else ''
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %g %g" width="%g" height="%g" role="img" aria-label="%s">%s<title>%s</title>%s%s</svg>'
            % (w, h, w, h, title, DEFS, title, b, body))

# Colour schemes: (EOB, Genie, sparkle, tagline, mascot)
SCHEMES = {
    'light': (MIDNIGHT, 'url(#genie)', ARCTIC, MIDNIGHT, 'color'),
    'dark': (WHITE, ARCTIC, ARCTIC, FROST, 'color'),
    'mono-black': (BLACK, BLACK, BLACK, BLACK, 'mono'),
    'mono-white': (WHITE, WHITE, WHITE, WHITE, 'mono'),
}

def wordmark(cap, x0, baseline, scheme, tagline=True, align='start'):
    """'EOB Genie' (+ sparkle, + tagline). Returns (svg, width, height above baseline, depth below)."""
    c_eob, c_genie, c_spark, c_tag, _ = SCHEMES[scheme]
    size = cap * XBOLD.upm / XBOLD.cap
    w1 = XBOLD.width('EOB', size, -0.01); gap = 0.24 * size; w2 = XBOLD.width('Genie', size, -0.01)
    word_w = w1 + gap + w2
    tag_size = cap * 0.30; tag_track = 0.20
    tag_w = SEMI.width(TAGLINE, tag_size, tag_track)
    total = max(word_w + cap * 0.38, tag_w)
    x = x0 - (total / 2 if align == 'middle' else 0)
    out = [XBOLD.run('EOB', size, x, baseline, c_eob, -0.01)[0], XBOLD.run('Genie', size, x + w1 + gap, baseline, c_genie, -0.01)[0]]
    out.append(sparkle(x + word_w + cap * 0.16, baseline - cap * 1.02, cap * 0.21, c_spark))
    depth = 0
    if tagline:
        tx = x if align == 'start' else x0 - tag_w / 2
        out.append(SEMI.run(TAGLINE, tag_size, tx, baseline + cap * 0.78, c_tag, tag_track)[0])
        depth = cap * 0.78
    return ''.join(out), total, cap * 1.25, depth

def horizontal(scheme, bg=None):
    H, pad = 520, 48
    mh = H - 2 * pad
    m, mw = mascot(pad, pad, mh, SCHEMES[scheme][4])
    cap = 132
    gx = pad + mw + 64
    probe, tw, up, down = wordmark(cap, 0, 0, scheme)
    base = H / 2 + (up - down) / 2 - cap * 0.10
    wm, tw, _, _ = wordmark(cap, gx, base, scheme)
    W = gx + tw + pad + 20
    return svg(round(W), H, m + wm, bg=bg, rx=28 if bg else 0)

def stacked(scheme, bg=None):
    W, pad = 900, 56
    mh = 470
    m, mw = mascot((W - mh * MASCOT_RATIO) / 2, pad, mh, SCHEMES[scheme][4])
    cap = 96
    base = pad + mh + 40 + cap
    wm, tw, _, down = wordmark(cap, W / 2, base, scheme, align='middle')
    H = base + down + pad + 10
    return svg(W, round(H), m + wm, bg=bg, rx=28 if bg else 0)

def wordmark_only(scheme, bg=None):
    cap, pad = 120, 40
    wm, tw, up, down = wordmark(cap, pad, pad + up_of(cap), scheme)
    return svg(round(tw + 2 * pad), round(pad + up_of(cap) + down + pad), wm, bg=bg, rx=20 if bg else 0)

def up_of(cap):
    return cap * 1.25

def app_icon(square=False, maskable=False):
    S = 512
    rx = 0 if square or maskable else 112
    h = 330 if maskable else 432
    w = h * MASCOT_RATIO
    y = (S - h) / 2 + (8 if maskable else 52)
    m, _ = mascot((S - w) / 2, y, h)
    clip = '' if rx == 0 else '<clipPath id="clip-icon"><rect width="512" height="512" rx="112"/></clipPath>'
    body = (('<defs>%s</defs>' % clip) if clip else '') + '<g%s><rect width="512" height="512" fill="url(#tile)"/>%s</g>' % (' clip-path="url(#clip-icon)"' if clip else '', m)
    return svg(S, S, body, 'EOB Genie app icon')

def favicon():
    # 16/32 px: the head alone, so a face still reads in a browser tab.
    S = 64
    h = 60; w = h * HEAD_RATIO
    m, _ = mascot((S - w) / 2, 6, h, 'head')
    body = '<defs><clipPath id="clip-fav"><rect width="64" height="64" rx="14"/></clipPath></defs><g clip-path="url(#clip-fav)"><rect width="64" height="64" fill="url(#tile)"/>%s</g>' % m
    return svg(S, S, body, 'EOB Genie')

ICONS = {
    'shield-check': '<path d="M32 5 54 13v16c0 15-9 25-22 32C19 54 10 44 10 29V13Z"/><path d="m21 32 7 7 15-16"/>',
    'lightning': '<path d="M36 4 14 35h15l-3 25 22-34H33Z"/>',
    'heart': '<path d="M32 56 10 35C-2 20 17 4 32 20 47 4 66 20 54 35Z"/>',
    'document': '<path d="M15 6h25l12 12v40H15Z"/><path d="M40 6v13h12M23 31h21M23 40h21M23 49h15"/>',
    'eob-document': '<path d="M16 5h26l10 10v44H16Z"/><path d="M42 5v12h10M23 27h21M23 36h21M23 45h15"/><path d="m24 53 5 5 10-11"/>',
    'sparkle': '<path d="M32 3 38 25 61 32 38 39 32 61 26 39 3 32 26 25Z"/>',
}
ICON_NAMES = {'shield-check': 'Accurate analysis', 'lightning': 'Saves time', 'heart': 'Less stress', 'document': 'Clear answers', 'eob-document': 'EOB checked', 'sparkle': 'Trusted partner'}

def icon(name, color):
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" fill="none" stroke="%s" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="%s"><title>%s</title>%s</svg>'
            % (color, ICON_NAMES[name], ICON_NAMES[name], ICONS[name]))

PALETTE = [(FROST, 'Frost Blue', 'Light backgrounds, brand tint', MIDNIGHT), (ARCTIC, 'Arctic Blue', 'Accent, "Genie" in the wordmark', MIDNIGHT),
           (OCEAN, 'Ocean Blue', 'Buttons, links, UI icons', WHITE), (MIDNIGHT, 'Midnight', 'Text, headers, dark surfaces', WHITE),
           (SILVER, 'Silver', 'Borders, neutral backgrounds', MIDNIGHT), (WHITE, 'White', 'Negative space, clean surfaces', MIDNIGHT)]

def palette():
    W, H, cw = 1600, 520, 240
    out = [label('Brand colors', 22, 60, 70, MIDNIGHT)]
    for i, (hexv, name, use, ink) in enumerate(PALETTE):
        x = 60 + i * (cw + 12)
        out.append('<rect x="%d" y="110" width="%d" height="250" rx="18" fill="%s" stroke="%s" stroke-width="2"/>' % (x, cw, hexv, SILVER if hexv in (WHITE, SILVER, FROST) else hexv))
        out.append(text(BOLD, name, 26, x + 18, 330, ink))
        out.append(text(SEMI, hexv, 22, x + 4, 400, MIDNIGHT))
        out.append(text(MED, use, 17, x + 4, 432, GRAY))
    return svg(W, H, ''.join(out), 'EOB Genie colors', WHITE)

def typography():
    W, H = 1600, 640
    out = [label('Typography — Montserrat', 22, 60, 70, MIDNIGHT),
           text(XBOLD, 'EOB Genie', 96, 60, 200, MIDNIGHT), text(MED, 'ExtraBold — wordmark', 20, 640, 190, GRAY),
           text(BOLD, 'Headings: Bold, Midnight', 46, 60, 290, MIDNIGHT),
           text(SEMI, 'Subheadings: SemiBold, Ocean Blue', 34, 60, 360, OCEAN),
           text(MED, 'Body and captions: Medium (or Regular), Midnight on white or Frost Blue.', 26, 60, 425, MIDNIGHT),
           label(TAGLINE, 24, 60, 500, MIDNIGHT),
           text(MED, 'Tagline: SemiBold, all caps, tracking +0.20 em', 20, 60, 540, GRAY),
           text(MED, 'Fallback when Montserrat isn’t available: Arial or a similar clean sans-serif.', 20, 60, 590, GRAY)]
    return svg(W, H, ''.join(out), 'EOB Genie typography', WHITE)

def clear_space():
    W, H = 1600, 760
    out = [label('Clear space & minimum size', 22, 60, 70, MIDNIGHT)]
    cap = 110; gx, base = 470, 380
    m, mw = mascot(150, 170, 380)
    wm, tw, up, down = wordmark(cap, gx, base, 'light')
    e = cap  # clear space = the height of the "E"
    x0, y0, x1, y1 = 150 - e, 170 - e, gx + tw + e, 170 + 380 + e
    out.append('<rect x="%g" y="%g" width="%g" height="%g" fill="%s" stroke="%s" stroke-dasharray="10 8" stroke-width="2"/>' % (x0, y0, x1 - x0, y1 - y0, FROST, OCEAN))
    out.append('<rect x="150" y="170" width="%g" height="380" fill="%s"/>' % (gx + tw - 150, WHITE))
    out += [m, wm, text(MED, 'Keep space around the logo at least the height of the “E” in EOB. Minimum: horizontal logo 160 px wide (on screen), 1.25 in (print); app icon 16 px.', 20, 60, 740, GRAY)]
    return svg(W, H, ''.join(out), 'EOB Genie clear space', WHITE)

def inner(s):
    a = s.index('>', s.index('<svg')) + 1
    return s[a:s.rindex('</svg>')].replace(DEFS, '')

def sizes_of(s):
    import re
    m = re.search(r'viewBox="0 0 ([\d.]+) ([\d.]+)"', s)
    return float(m.group(1)), float(m.group(2))

def place(s, x, y, w):
    sw, sh = sizes_of(s)
    k = w / sw
    return '<g transform="translate(%g %g) scale(%g)">%s</g>' % (x, y, k, inner(s)), sh * k

def sheet():
    W, H = 2400, 1600
    out = ['<rect width="%d" height="%d" fill="%s"/>' % (W, H, WHITE)]
    def cell(x, y, w, h, title, bg=WHITE, ink=MIDNIGHT):
        out.append('<rect x="%d" y="%d" width="%d" height="%d" rx="20" fill="%s" stroke="%s" stroke-width="2"/>' % (x, y, w, h, bg, SILVER))
        out.append(label(title, 20, x + 32, y + 50, ink))
    cell(40, 40, 1400, 560, 'Primary logo — horizontal')
    g, _ = place(horizontal('light'), 120, 130, 1240); out.append(g)
    cell(1470, 40, 890, 560, 'Stacked logo')
    g, _ = place(stacked('light'), 1740, 80, 350); out.append(g)
    cell(40, 630, 760, 330, 'On dark', MIDNIGHT, FROST)
    g, _ = place(horizontal('dark'), 90, 700, 660); out.append(g)
    cell(820, 630, 760, 330, 'One colour — black')
    g, _ = place(horizontal('mono-black'), 870, 700, 660); out.append(g)
    cell(1600, 630, 760, 330, 'One colour — white', BLACK, WHITE)
    g, _ = place(horizontal('mono-white'), 1650, 700, 660); out.append(g)
    cell(40, 990, 1100, 570, 'App icon & favicon')
    x = 90
    for s in (300, 160, 96, 64):
        g, _ = place(app_icon(), x, 1080 + (300 - s), s); out.append(g)
        out.append(text(MED, '%d px' % (512 if s == 300 else {160: 256, 96: 128, 64: 64}[s]), 18, x + s / 2, 1420, GRAY, 'middle'))
        x += s + 50
    for s in (48, 32):
        g, _ = place(favicon(), x, 1080 + 300 - s, s); out.append(g)
        out.append(text(MED, '%d px' % (32 if s == 48 else 16), 18, x + s / 2, 1420, GRAY, 'middle'))
        x += s + 40
    out.append(text(MED, 'Small sizes use the head only, so a face still reads in a browser tab.', 18, 90, 1500, GRAY))
    cell(1170, 990, 1190, 270, 'Colors')
    for i, (hexv, name, _, ink) in enumerate(PALETTE):
        cx = 1230 + i * 188
        out.append('<circle cx="%d" cy="%d" r="52" fill="%s" stroke="%s" stroke-width="2"/>' % (cx + 52, 1110, hexv, SILVER))
        out.append(text(SEMI, hexv, 18, cx + 52, 1195, MIDNIGHT, 'middle'))
        out.append(text(MED, name, 17, cx + 52, 1222, GRAY, 'middle'))
    cell(1170, 1290, 1190, 270, 'Icons')
    for i, n in enumerate(ICONS):
        ix = 1240 + i * 186
        out.append('<g transform="translate(%d 1345) scale(1.15)" fill="none" stroke="%s" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">%s</g>' % (ix, OCEAN, ICONS[n]))
        out.append(text(MED, ICON_NAMES[n].upper(), 15, ix + 37, 1490, MIDNIGHT, 'middle', 0.08))
    return svg(W, H, ''.join(out), 'EOB Genie brand sheet')

def main():
    files = {
        'logo-horizontal': horizontal('light'), 'logo-horizontal-dark': horizontal('dark'), 'logo-horizontal-on-midnight': horizontal('dark', MIDNIGHT),
        'logo-stacked': stacked('light'), 'logo-stacked-dark': stacked('dark'),
        'logo-mono-black': horizontal('mono-black'), 'logo-mono-white': horizontal('mono-white'),
        'wordmark': wordmark_only('light'), 'wordmark-dark': wordmark_only('dark'),
        'app-icon': app_icon(), 'app-icon-square': app_icon(square=True), 'app-icon-maskable': app_icon(maskable=True), 'favicon': favicon(),
        'palette': palette(), 'typography': typography(), 'clear-space': clear_space(), 'brand-sheet': sheet(),
    }
    for n, s in files.items():
        with open(os.path.join(OUT, 'eob-genie-%s.svg' % n), 'w') as f: f.write(s)
    os.makedirs(os.path.join(OUT, 'icons'), exist_ok=True)
    for n in ICONS:
        for suffix, color in (('', OCEAN), ('-midnight', MIDNIGHT), ('-white', WHITE)):
            with open(os.path.join(OUT, 'icons', 'icon-%s%s.svg' % (n, suffix)), 'w') as f: f.write(icon(n, color))
    print('wrote %d logo/sheet SVGs and %d icons' % (len(files), len(ICONS) * 3))

if __name__ == '__main__':
    main()
