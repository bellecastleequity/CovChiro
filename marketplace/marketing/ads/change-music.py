# Original music for the "Do you feel it? Change is good." reel (Oct 2026), synthesized from scratch: no samples,
# nothing to license, so it can run in paid ads. 120 BPM (one bar = 2 s), 24 s.
#   0-4 s   cold intro in B minor: wind, airy pad, icy bell               ("Do you feel it?")
#   4-8 s   build: kick, hats and bass come in, riser + snare roll, a beat of silence  ("It's getting colder")
#   8 s     the change: drop into bright D major, four-on-the-floor, claps, plucks, bell hook  ("Change is good!")
#   22 s    final D chord + cymbal, rings out to 24 s
#   python3 marketing/ads/change-music.py out.wav
import numpy as np, wave, sys
SR = 44100; BPM = 120; BEAT = 60 / BPM; BAR = 4 * BEAT; DUR = 24.0
N = int(SR * DUR)
rng = np.random.default_rng(23)
hz = lambda m: 440 * 2 ** ((m - 69) / 12)
bus = {k: np.zeros((2, N)) for k in ("dry", "wet", "duck")}  # duck = pad/bass, ducked by the kick

def add(sig, t0, pan=0.0, gain=1.0, to="dry", send=0.0):
    i = int(round(t0 * SR))
    if i >= N or i < 0: return
    s = sig[: N - i] * gain; l, r = np.sqrt(0.5 * (1 - pan)), np.sqrt(0.5 * (1 + pan))
    bus[to][0, i:i + len(s)] += s * l; bus[to][1, i:i + len(s)] += s * r
    if send: bus["wet"][0, i:i + len(s)] += s * l * send; bus["wet"][1, i:i + len(s)] += s * r * send

def tt(d): return np.arange(int(SR * d)) / SR
def band(x, lo, hi):  # FFT band-pass (static), fine for one-shots and fixed buses
    X = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1 / SR); X[(f < lo) | (f > hi)] = 0; return np.fft.irfft(X, len(x))
def env(t, a, d, hold=None, rel=0.08):
    e = np.minimum(1, t / max(a, 1e-4)) * np.exp(-t * d)
    if hold is not None: e *= np.where(t > hold, np.exp(-(t - hold) / rel), 1)
    return e

def pad(m, dur, bright=1.0):
    t = tt(dur + 1.2); s = np.zeros_like(t)
    for det in (-0.09, 0.0, 0.11):           # three detuned saws, harmonics rolled off (soft, airy)
        f = hz(m + det)
        for k in range(1, 11):
            s += np.sin(2 * np.pi * k * f * t + k * det * 7) / k * np.exp(-k / (2.2 + 2.2 * bright))
    e = np.minimum(1, t / 0.35) * np.where(t > dur, np.exp(-(t - dur) / 0.5), 1)
    return 0.05 * s * e

def pluck(m, vel=1.0):
    t = tt(0.9); f = hz(m); s = sum(np.sin(2 * np.pi * k * f * t) / k * np.exp(-t * (5 + 3 * k)) for k in range(1, 9))
    return 0.11 * vel * s * np.minimum(1, t / 0.002)

def bell(m, vel=1.0):
    t = tt(2.2); f = hz(m)
    s = sum(a * np.sin(2 * np.pi * f * r * t) * np.exp(-t * d) for r, a, d in ((1, 1, 2.2), (2.76, .45, 4.5), (5.4, .25, 7), (8.93, .12, 11)))
    return 0.085 * vel * s * np.minimum(1, t / 0.002)

def bass(m, dur):
    t = tt(dur + 0.05); f = hz(m)
    s = np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * 2 * f * t) + 0.12 * np.sin(2 * np.pi * 3 * f * t)
    return 0.26 * np.tanh(1.4 * s) * env(t, 0.004, 2.5, dur, 0.03)

def kick():
    t = tt(0.45); ph = 2 * np.pi * np.cumsum(46 + 110 * np.exp(-t * 28)) / SR
    return 0.62 * (np.sin(ph) * np.exp(-t * 7) + 0.25 * band(rng.standard_normal(len(t)), 2000, 6000) * np.exp(-t * 180))

def clap():
    t = tt(0.35); n = band(rng.standard_normal(len(t)), 900, 3200)
    e = sum(np.where(t >= o, np.exp(-(t - o) * 60), 0) for o in (0, 0.009, 0.019)) + 0.5 * np.where(t > 0.02, np.exp(-(t - 0.02) * 14), 0)
    return 0.32 * n * e

def snare():
    t = tt(0.2); return 0.22 * (band(rng.standard_normal(len(t)), 1200, 7000) * np.exp(-t * 28) + 0.5 * np.sin(2 * np.pi * 190 * t) * np.exp(-t * 35))

def hat(open_=False):
    t = tt(0.35 if open_ else 0.08); return (0.045 if open_ else 0.05) * band(rng.standard_normal(len(t)), 7000, 15000) * np.exp(-t * (17 if open_ else 60))

def crash():
    t = tt(2.6); return 0.1 * band(rng.standard_normal(len(t)), 4500, 15000) * np.exp(-t * 2.3)

# ---- arrangement ----
# Intro/build: Bm  G  Em  F#   (cold)     Drop: D  A  Bm  G  D  A  Bm  G  A, then D to finish
INTRO = [(47, [59, 62, 66]), (43, [59, 62, 67]), (40, [59, 64, 67]), (42, [58, 61, 66])]
DROP = [(38, [62, 66, 69]), (45, [61, 64, 69]), (47, [62, 66, 71]), (43, [62, 67, 71])]
for b in range(4):
    root, ch = INTRO[b]
    for k, m in enumerate(ch): add(pad(m, BAR, 0.5), b * BAR, pan=-0.4 + 0.4 * k, to="duck", send=0.5)
    add(pad(root + 12, BAR, 0.3), b * BAR, gain=0.6, to="duck")
for b, m in ((0, 78), (0.5, 74), (1, 71), (1.5, 73)):        # icy bell line over the intro
    add(bell(m, 0.9), b * BAR + 0.25, pan=0.35, send=0.6)
# wind: band-passed noise swelling over the first 7 s
w = band(rng.standard_normal(int(7.6 * SR)), 300, 2400); wt = np.arange(len(w)) / SR
add(0.05 * w * np.sin(np.pi * np.minimum(1, wt / 7.6)) ** 1.5 * (1 + 0.4 * np.sin(2 * np.pi * 0.35 * wt)), 0, pan=-0.2, send=0.3)
# build (4-8 s): kick quarters, closed hats, bass eighths
for i in range(8):
    t0 = 4 + i * BEAT
    if t0 < 7.5: add(kick(), t0, gain=0.8)
    add(hat(), t0 + BEAT / 2, pan=0.3)
for i in range(14):
    b = 2 + i // 8; root = INTRO[b][0]; add(bass(root, BEAT / 2 * 0.8), 4 + i * BEAT / 2, to="duck", gain=0.8)
# riser + snare roll into the drop, then a beat of silence (7.75-8.0)
rn = int(3.75 * SR); rt = np.arange(rn) / SR; noise = rng.standard_normal(rn)
riser = sum(band(noise, lo, lo * 3) * np.clip((rt / 3.75) * 4 - j, 0, 1) for j, lo in enumerate((400, 1200, 3000, 6000)))
add(0.045 * riser * (rt / 3.75) ** 2, 4.0, send=0.4)
add(0.08 * np.sin(2 * np.pi * np.cumsum(220 + 660 * (rt / 3.75) ** 2) / SR) * (rt / 3.75) ** 3, 4.0, pan=0.1, send=0.3)
for i, t0 in enumerate(np.concatenate([np.arange(6.0, 7.0, BEAT / 2), np.arange(7.0, 7.75, BEAT / 4)])):
    add(snare(), t0, gain=0.4 + 0.6 * i / 13, send=0.25)
# drop (8-22 s): seven bars
END = 22.0
for b in range(7):
    t0 = 8 + b * BAR; root, ch = (DROP + DROP)[b] if b < 6 else (45, [61, 64, 69])
    for k, m in enumerate(ch): add(pad(m, BAR, 1.0), t0, pan=-0.5 + 0.5 * k, to="duck", gain=0.8, send=0.45)
    for i in range(4):
        add(kick(), t0 + i * BEAT)
        add(hat(True), t0 + i * BEAT + BEAT / 2, pan=0.25, send=0.1)
        add(hat(), t0 + i * BEAT + BEAT / 4, pan=-0.3, gain=0.6); add(hat(), t0 + i * BEAT + 3 * BEAT / 4, pan=-0.3, gain=0.6)
        add(bass(root, BEAT / 2 * 0.7), t0 + i * BEAT + BEAT / 2, to="duck")
        add(bass(root + 12, BEAT / 4 * 0.6), t0 + i * BEAT + 3 * BEAT / 4, to="duck", gain=0.45)
    for i in (1, 3): add(clap(), t0 + i * BEAT, send=0.35)
    arp = [ch[0] + 12, ch[1] + 12, ch[2] + 12, ch[1] + 12]          # sixteenth-note pluck arpeggio
    for i in range(16): add(pluck(arp[i % 4], 0.9 if i % 4 == 0 else 0.6), t0 + i * BEAT / 4, pan=0.45 if i % 2 else -0.45, send=0.3)
add(crash(), 8.0, send=0.3); add(crash(), 12.0, gain=0.6, send=0.3); add(crash(), 18.0, gain=0.7, send=0.3)
# bell hook, the "change is good" motif (two-bar phrase, answered the second time)
HOOK = [(0, 78), (0.5, 81), (1.0, 83), (1.5, 81), (2.5, 78), (3.0, 76), (3.5, 74)]
HOOK2 = [(0, 78), (0.5, 81), (1.0, 83), (1.5, 86), (2.5, 85), (3.0, 83), (3.5, 81)]
for ph, notes in ((8, HOOK), (12, HOOK2), (16, HOOK), (20, HOOK2)):
    for beat, m in notes:
        if ph + beat * BEAT * 2 < END: add(bell(m), ph + beat * BEAT * 2, pan=0.15, send=0.55)
# finish: D chord + low D + cymbal at 22 s, ringing out
for k, m in enumerate([50, 62, 66, 69, 74]): add(pad(m, 0.8, 1.0), END, pan=-0.4 + 0.2 * k, gain=1.2, send=0.6)
add(kick(), END); add(crash(), END, gain=1.2, send=0.5); add(bell(86), END, send=0.7); add(bell(74, 0.8), END + 0.01, send=0.7)

# ---- mix ----
tt_all = np.arange(N) / SR; duck = np.ones(N)
kicks = [4 + i * BEAT for i in range(7)] + [8 + i * BEAT for i in range(28)] + [END]
for k in kicks:
    m = tt_all >= k; duck[m] = np.minimum(duck[m], 1 - 0.55 * np.exp(-(tt_all[m] - k) / 0.11))
mix = bus["dry"] + bus["duck"] * duck
irn = int(SR * 2.2); it = np.arange(irn) / SR
ir = rng.standard_normal((2, irn)) * np.exp(-it * 2.6); ir[:, : int(0.02 * SR)] = 0
def conv(x, h):
    n = 1 << int(np.ceil(np.log2(len(x) + len(h)))); return np.fft.irfft(np.fft.rfft(x, n) * np.fft.rfft(h, n), n)[: len(x)]
wet = np.stack([conv(band(bus["wet"][c], 200, 9000), ir[c]) for c in (0, 1)])
mix = mix + 0.2 * wet * (np.abs(mix).max() / (np.abs(wet).max() + 1e-9))
fo = tt_all > DUR - 1.2; mix[:, fo] *= np.linspace(1, 0, fo.sum())
mix = np.tanh(mix / np.abs(mix).max() * 1.3) / np.tanh(1.3) * 0.92  # gentle glue saturation
pcm = (mix.T * 32767).astype("<i2")
with wave.open(sys.argv[1], "wb") as f: f.setnchannels(2); f.setsampwidth(2); f.setframerate(SR); f.writeframes(pcm.tobytes())
print("ok", DUR)
