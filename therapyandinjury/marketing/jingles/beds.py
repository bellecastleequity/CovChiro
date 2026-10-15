# Renders the 844-84-TREAT music beds: a professional-urban (R&B / hip-hop) groove at 92 bpm.
#   python3 beds.py out/plan.json     (make-spots.mjs writes the plan and runs this for you)
# The plan says how many bars of groove sit under each spot's spoken body, so the bed is built
# around the voice instead of the voice being squeezed into the bed. Under the body there is no
# lead melody (just drums, Rhodes chords, 808) so the words never fight a tune. The hook melody
# starts on beat 2 of the hook bar and lands "TREAT" on the next downbeat; timing.json records
# the exact time of every hook note so make-spots.mjs can put each spoken word on its note.
import numpy as np, wave, subprocess, json, os, sys
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out')
os.makedirs(OUT, exist_ok=True)
SR = 44100
BPM = 92
BEAT = 60 / BPM
BAR = 4 * BEAT
rng = np.random.default_rng(7)

NOTE = {n: i for i, n in enumerate(['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'])}
def hz(name): return 440.0 * 2 ** ((12 * (int(name[-1]) + 1) + NOTE[name[:-1]] - 69) / 12)

def band(x, lo, hi):
    f = np.fft.rfft(x); fr = np.fft.rfftfreq(len(x), 1 / SR)
    f[(fr < lo) | (fr > hi)] = 0
    return np.fft.irfft(f, len(x))

def tt(dur): return np.arange(int(dur * SR)) / SR

def rhodes(freq, dur, vel):
    t = tt(dur)
    tone = (np.sin(2*np.pi*freq*t + 0.6*np.sin(2*np.pi*freq*t)*np.exp(-t*5))
            + 0.25*np.sin(2*np.pi*2*freq*t)*np.exp(-t*4))
    e = np.exp(-t * 1.4) * np.minimum(1, t / 0.004)
    R = int(min(0.15, dur * 0.3) * SR); e[-R:] *= np.linspace(1, 0, R)
    return vel * tone * e * (1 + 0.12 * np.sin(2*np.pi*4.5*t))  # tremolo

def chord(names, dur, vel=0.16):
    return sum(rhodes(hz(n), dur, vel) for n in names) / np.sqrt(len(names))

def lead(freq, dur, vel=0.5):
    # Soft synth-pluck lead for the hook: rhodes plus a gentle square-ish bell an octave up.
    t = tt(dur)
    sq = np.tanh(3 * np.sin(2*np.pi*2*freq*t)) * np.exp(-t * 3.5) * 0.18
    return rhodes(freq, dur, vel) + vel * sq * np.minimum(1, t / 0.003)

def b808(freq, dur, vel=0.55):
    t = tt(dur)
    f = freq * (1 + 0.6 * np.exp(-t * 40))
    s = np.sin(2*np.pi*np.cumsum(f)/SR)
    e = np.exp(-t * 1.6) * np.minimum(1, t / 0.003)
    R = int(min(0.08, dur * 0.3) * SR); e[-R:] *= np.linspace(1, 0, R)
    return vel * np.tanh(1.8 * s) * e

def kick(vel=0.8):
    t = tt(0.35); f = 160 * np.exp(-t * 30) + 48
    return vel * np.tanh(2 * np.sin(2*np.pi*np.cumsum(f)/SR)) * np.exp(-t * 11)

def clap(vel=0.45):
    t = tt(0.25); n = band(rng.standard_normal(len(t)), 900, 5000)
    e = np.zeros(len(t))
    for k in (0, 0.011, 0.022): e += (t >= k) * np.exp(-np.maximum(t - k, 0) * (70 if k < 0.02 else 18))
    return vel * n / np.max(np.abs(n)) * e

def hat(vel=0.12, open_=False):
    t = tt(0.25 if open_ else 0.06); n = band(rng.standard_normal(len(t)), 7000, 16000)
    return vel * n / np.max(np.abs(n)) * np.exp(-t * (14 if open_ else 70))

def pad(names, dur, vel=0.05):
    t = tt(dur)
    s = sum(np.sin(2*np.pi*hz(n)*t) + 0.5*np.sin(2*np.pi*hz(n)*1.004*t) for n in names) / len(names)
    return vel * s * np.minimum(1, t / 0.5) * np.minimum(1, (dur - t) / 0.4)

class Mix:
    def __init__(self, seconds): self.buf = np.zeros(int((seconds + 2) * SR))
    def add(self, sig, at):
        i = int(round(at * SR))
        if i < 0: sig, i = sig[-i:], 0
        self.buf[i:i+len(sig)] += sig[:len(self.buf)-i]
    def save(self, name, seconds):
        b = self.buf[:int(seconds * SR)]
        out = b.copy()
        for k, g in ((0.029, .18), (0.043, .14), (0.071, .1), (0.113, .07), (0.167, .05)):
            d = int(k * SR); out[d:] += g * b[:-d]
        out = np.tanh(1.2 * out / np.max(np.abs(out))) / np.tanh(1.2) * 0.89
        fade = int(0.35 * SR); out[-fade:] *= np.linspace(1, 0, fade)
        pcm = (out * 32767).astype(np.int16)
        path = os.path.join(OUT, name)
        with wave.open(path + '.wav', 'wb') as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', path + '.wav', '-b:a', '192k', path + '.mp3'], check=True)

# Cmaj9 / Am9 / Fmaj9 / G13-ish, Rhodes voicings, 808 on the roots.
PROG = [(['E4', 'G4', 'B4', 'D5'], 'C2'), (['C4', 'E4', 'G4', 'B4'], 'A1'),
        (['A3', 'C4', 'E4', 'G4'], 'F1'), (['F3', 'A3', 'B3', 'E4'], 'G1')]
# Hook: "eight four four | eight four | TREAT", in beats from beat 2 of the hook bar.
# TREAT (E5 over Cmaj9) lands on the next downbeat.
HOOK = [('G4', 0.0, .5), ('A4', .5, .5), ('C5', 1.0, 1.0), ('G4', 2.0, .5), ('A4', 2.5, .5), ('E5', 3.0, 2.0)]
HOOK_LEN_BEATS = 3.0 + 2.0

def groove_bar(mx, t0, bar_i, chord_names, root, light=False):
    mx.add(chord(chord_names, BAR * 0.98), t0)
    mx.add(b808(hz(root), BEAT * 2.4), t0)
    mx.add(b808(hz(root), BEAT * 1.2, .4), t0 + BEAT * 2.75)
    swing = BEAT / 4 * 0.12
    for s in range(16):
        at = t0 + s * BEAT / 4 + (swing if s % 2 else 0)
        if s in (0, 7, 10): mx.add(kick(0.8 if s == 0 else 0.6), at)
        if s in (4, 12) and not light: mx.add(clap(), at)
        if s % 2 == 0: mx.add(hat(0.11 if s % 4 == 0 else 0.07), at)
        elif bar_i % 2 and s in (13, 15): mx.add(hat(0.05), at)
    if bar_i % 4 == 3: mx.add(hat(0.06, True), t0 + 3.5 * BEAT)

def hook_section(mx, bar_start, groove=True):
    hook_t = bar_start + BEAT
    if groove:
        # Hook bar: Fmaj9 then G under "eight-four-four / eight-four", Cmaj9 on TREAT.
        mx.add(chord(PROG[2][0], 2 * BEAT), bar_start); mx.add(b808(hz('F1'), 2 * BEAT * .95), bar_start)
        mx.add(chord(PROG[3][0], 2 * BEAT), bar_start + 2 * BEAT); mx.add(b808(hz('G1'), 2 * BEAT * .95), bar_start + 2 * BEAT)
        for s in range(16):
            at = bar_start + s * BEAT / 4
            if s in (0, 10): mx.add(kick(0.7), at)
            if s in (4, 12): mx.add(clap(0.4), at)
            if s % 2 == 0: mx.add(hat(0.07), at)
    else:
        mx.add(pad(['F3', 'A3', 'C4', 'E4'], 3 * BEAT, .06), hook_t)
    notes = []
    for n, b, d in HOOK:
        at = hook_t + b * BEAT
        mx.add(lead(hz(n), d * BEAT * 1.1, .42), at)
        notes.append({'note': n, 't': round(at, 4), 'dur': round(d * BEAT, 4)})
    land = hook_t + 3.0 * BEAT
    mx.add(chord(PROG[0][0], 2.5 * BEAT, .2), land); mx.add(pad(PROG[0][0], 2.5 * BEAT, .06), land)
    mx.add(b808(hz('C2'), 2.2 * BEAT, .6), land); mx.add(kick(0.85), land); mx.add(clap(0.35), land)
    mx.add(hat(0.08, True), land)
    return notes, land + 2.5 * BEAT

def render(name, body_bars):
    lead_in = 0.0
    mx = Mix(BAR * (body_bars + 3))
    for i in range(body_bars):
        ch, root = PROG[i % 4]
        groove_bar(mx, lead_in + i * BAR, i, ch, root, light=(i == 0 and body_bars > 1))
    notes, end = hook_section(mx, lead_in + body_bars * BAR, groove=body_bars > 0)
    if body_bars == 0:  # audio logo: start the hook right away
        shift = BEAT - 0.2
        mx.buf = np.concatenate([mx.buf[int(shift * SR):], np.zeros(int(shift * SR))])
        for n in notes: n['t'] = round(n['t'] - shift, 4)
        end -= shift
    mx.save(name, end)
    return {'bpm': BPM, 'beat': BEAT, 'bar': BAR, 'bodyBars': body_bars, 'hookNotes': notes, 'length': round(end, 4)}

if __name__ == '__main__':
    plan = json.load(open(sys.argv[1])) if len(sys.argv) > 1 else {'1-audio-logo': 0, '2-radio-tag': 2, '3-ad-15s': 4}
    timing = {name: render(name, bars) for name, bars in plan.items()}
    json.dump(timing, open(os.path.join(OUT, 'timing.json'), 'w'), indent=2)
    print('beds:', ', '.join(f"{k} {v['length']:.1f}s" for k, v in timing.items()))
