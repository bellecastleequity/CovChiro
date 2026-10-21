# InjuryCase mark: a white "i" and a bold "C"; a tapered mint swoosh sweeps
# from under the "i", around the base of the "C", and rises into an arrow.
import math
def bez(p0, p1, p2, p3, t):
    u = 1 - t
    return tuple(u**3*a + 3*u*u*t*b + 3*u*t*t*c + t**3*d for a, b, c, d in zip(p0, p1, p2, p3))
def swoosh_poly(p0, p1, p2, p3, w0, w1, n=40):
    left, right = [], []
    for i in range(n + 1):
        t = i / n
        x, y = bez(p0, p1, p2, p3, t)
        x2, y2 = bez(p0, p1, p2, p3, min(1, t + 1e-3)) if t < 1 else (x, y)
        if t == 1:
            xa, ya = bez(p0, p1, p2, p3, 1 - 1e-3); dx, dy = x - xa, y - ya
        else:
            dx, dy = x2 - x, y2 - y
        L = math.hypot(dx, dy) or 1; nx, ny = -dy / L, dx / L
        w = (w0 + (w1 - w0) * (t ** 0.8)) / 2
        left.append((x + nx*w, y + ny*w)); right.append((x - nx*w, y - ny*w))
    pts = left + right[::-1]
    return 'M' + ' L'.join('%.2f %.2f' % p for p in pts) + ' Z', left
def mark(bg='#0B2340', glyph='#FFFFFF', arrow='#1FA866', with_c=True, gap=True):
    out = []
    if bg: out.append('<rect width="64" height="64" rx="15" fill="%s"/>' % bg)
    out.append('<circle cx="15.5" cy="14.5" r="5.3" fill="%s"/>' % glyph)
    out.append('<rect x="10.4" y="23" width="10.2" height="28" rx="3.4" fill="%s"/>' % glyph)
    B = (48.0, 27.2); d = (0.52, -0.854); L = 15.0; hw = 9.0
    T = (B[0] + d[0]*L, B[1] + d[1]*L); nrm = (-d[1], d[0])
    p0, p1, p2, p3 = (9.5, 51.5), (27, 55), (B[0] - d[0]*13, B[1] - d[1]*13), (B[0] + d[0]*1.2, B[1] + d[1]*1.2)
    sw, lower = swoosh_poly(p0, p1, p2, p3, 5.6, 8.6)
    if with_c:
        # The C is clipped to the area above the swoosh's lower edge, so it
        # always ends cleanly at the arrow.
        clip = [(0, 0), (64, 0), (64, lower[-1][1])] + lower[::-1] + [(0, lower[0][1])]
        uid = 'c%d' % abs(hash((bg, glyph)) % 10000)
        cx, cy, r = 35, 35.6, 9.9
        a0, a1 = math.radians(-38), math.radians(120)
        out.append('<clipPath id="%s"><path d="M%s Z"/></clipPath>' % (uid, ' L'.join('%.2f %.2f' % q for q in clip)))
        out.append('<path clip-path="url(#%s)" d="M%.2f %.2f A%.1f %.1f 0 1 0 %.2f %.2f" fill="none" stroke="%s" stroke-width="9.2" stroke-linecap="round"/>' % (
            uid, cx + r*math.cos(a0), cy + r*math.sin(a0), r, r, cx + r*math.cos(a1), cy + r*math.sin(a1), glyph))
    head = 'M%.2f %.2f L%.2f %.2f L%.2f %.2f Z' % (T[0], T[1], B[0] + nrm[0]*hw, B[1] + nrm[1]*hw, B[0] - nrm[0]*hw, B[1] - nrm[1]*hw)
    if gap and bg:  # knock-out outline separating the swoosh from the white letters
        out.append('<path d="%s %s" fill="%s" stroke="%s" stroke-width="3.4" stroke-linejoin="round"/>' % (sw, head, bg, bg))
    # round the swoosh's tail
    tail = '<circle cx="%.2f" cy="%.2f" r="%.2f" fill="%%s"/>' % (p0[0], p0[1], 2.8)
    if gap and bg:
        out.append('<circle cx="%.2f" cy="%.2f" r="4.5" fill="%s"/>' % (p0[0], p0[1], bg))
    out.append('<path d="%s" fill="%s"/>' % (sw, arrow))
    out.append(tail % arrow)
    out.append('<path d="%s" fill="%s" stroke="%s" stroke-width="1.4" stroke-linejoin="round"/>' % (head, arrow, arrow))
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="InjuryCase">' + ''.join(out) + '</svg>'
if __name__ == '__main__':
    open('mark.svg', 'w').write(mark())
    open('mark-navy.svg', 'w').write(mark(bg='#0F1733'))
    open('mark-simple.svg', 'w').write(mark(with_c=False))
