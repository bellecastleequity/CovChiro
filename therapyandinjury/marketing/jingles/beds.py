import numpy as np, wave, subprocess, json, os
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out')
os.makedirs(OUT, exist_ok=True)
TIMING = {}
SR = 44100

def midi(n): return 440.0 * 2 ** ((n - 69) / 12)
NOTE = {n: i for i, n in enumerate(['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'])}
def m(name):  # 'C5' -> midi
    return 12 * (int(name[-1]) + 1) + NOTE[name[:-1]]

def env(n, a=0.008, d=0.25, s=0.55, r=0.25, total=None):
    t = np.arange(n) / SR
    e = np.ones(n)
    A = int(a * SR); e[:A] = np.linspace(0, 1, A)
    e *= np.where(t > a, s + (1 - s) * np.exp(-(t - a) / d), 1)
    R = int(r * SR)
    if R < n: e[-R:] *= np.linspace(1, 0, R)
    return e

def epiano(freq, dur, vel=0.6):
    n = int(dur * SR); t = np.arange(n) / SR
    tone = (np.sin(2*np.pi*freq*t) + 0.35*np.sin(2*np.pi*2*freq*t)*np.exp(-t*3)
            + 0.12*np.sin(2*np.pi*3*freq*t)*np.exp(-t*6) + 0.05*np.sin(2*np.pi*7*freq*t)*np.exp(-t*12))
    return vel * tone * env(n, d=0.6, s=0.25, r=min(0.3, dur*0.4))

def bell(freq, dur, vel=0.5):
    n = int(dur * SR); t = np.arange(n) / SR
    tone = np.sin(2*np.pi*freq*t) + 0.5*np.sin(2*np.pi*freq*2.76*t)*np.exp(-t*4) + 0.25*np.sin(2*np.pi*freq*5.4*t)*np.exp(-t*8)
    return vel * tone * np.exp(-t * 2.2) * env(n, a=0.003, d=10, s=1, r=0.2)

def pad(freqs, dur, vel=0.12):
    n = int(dur * SR); t = np.arange(n) / SR
    tone = sum(np.sin(2*np.pi*f*t) + 0.3*np.sin(2*np.pi*f*1.003*t) for f in freqs)
    e = np.minimum(1, t / 0.6) * np.minimum(1, (dur - t) / 0.6)
    return vel * tone * e / len(freqs)

def bass(freq, dur, vel=0.35):
    n = int(dur * SR); t = np.arange(n) / SR
    return vel * (np.sin(2*np.pi*freq*t) + 0.2*np.sin(2*np.pi*2*freq*t)) * env(n, d=0.4, s=0.5, r=0.08)

def shaker(dur, vel=0.05):
    n = int(dur * SR); t = np.arange(n) / SR
    return vel * np.random.default_rng(1).standard_normal(n) * np.exp(-t * 40)

def kick(vel=0.5):
    n = int(0.25 * SR); t = np.arange(n) / SR
    f = 110 * np.exp(-t * 18) + 45
    return vel * np.sin(2*np.pi*np.cumsum(f)/SR) * np.exp(-t * 9)

class Mix:
    def __init__(self, seconds): self.buf = np.zeros(int(seconds * SR) + SR)
    def add(self, sig, at):
        i = int(at * SR); self.buf[i:i+len(sig)] += sig[:len(self.buf)-i]
    def save(self, name, seconds):
        b = self.buf[:int(seconds * SR)]
        # gentle reverb: a few decaying echoes
        out = b.copy()
        for k, g in ((0.031, .25), (0.047, .2), (0.083, .15), (0.131, .1), (0.197, .07)):
            d = int(k * SR); out[d:] += g * b[:-d]
        out /= np.max(np.abs(out)) * 1.12
        fade = int(0.4 * SR); out[-fade:] *= np.linspace(1, 0, fade)
        pcm = (out * 32767).astype(np.int16)
        name = os.path.join(OUT, name)
        with wave.open(name + '.wav', 'wb') as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', name + '.wav', '-b:a', '192k', name + '.mp3'], check=True)

# The hook: "eight - four - four | eight - four | TREAT" (6 syllables, last one held)
# Melody rises, repeats, then resolves up to the tonic on TREAT: calm, confident, resolved.
HOOK = [('G4', .5), ('A4', .25), ('C5', .75), ('G4', .5), ('A4', .5), ('E5', 1.75)]

def play_line(mx, line, start, beat, inst=epiano, vel=.6, octave=0):
    t = start
    for note, beats in line:
        mx.add(inst(midi(m(note) + 12 * octave), beats * beat * 1.15, vel), t)
        t += beats * beat
    return t

# ---------- 1. Audio logo (~4 s): just the hook, bell + piano, one chord swell ----------
beat = 60 / 96
mx = Mix(5)
mx.add(pad([midi(m('C4')), midi(m('E4')), midi(m('G4'))], 4.6, .10), 0)
end = play_line(mx, HOOK, 0.15, beat, epiano, .55)
play_line(mx, HOOK, 0.15, beat, bell, .18, octave=1)
mx.add(bass(midi(m('C3')), 1.6, .3), 0.15 + 3.0 * beat)
mx.save('1-audio-logo', 4.8)
TIMING['1-audio-logo'] = {'hook': 0.15, 'hookBeats': 4.25, 'beat': beat, 'length': 4.8}

# ---------- 2. Radio tag (~10 s): short intro phrase + hook ----------
# Lyric: "Hurt in a car crash? Get checked in fourteen days. Call eight-four-four, eight-four, TREAT."
beat = 60 / 100
mx = Mix(11)
chords = [('C', ['C4','E4','G4'], 'C3'), ('A', ['A3','C4','E4'], 'A2'), ('F', ['F3','A3','C4'], 'F2'), ('G', ['G3','B3','D4'], 'G2'),
          ('C', ['C4','E4','G4'], 'C3'), ('F', ['F3','A3','C4'], 'F2'), ('G', ['G3','B3','D4'], 'G2'), ('C', ['C4','E4','G4'], 'C3')]
for i, (_, ch, bs) in enumerate(chords):
    t = i * 2 * beat
    mx.add(pad([midi(m(n)) for n in ch], 2 * beat + .3, .09), t)
    mx.add(bass(midi(m(bs)), 2 * beat * .9, .28), t)
    for k in range(4): mx.add(shaker(.1, .03), t + k * beat / 2 * 2)
INTRO = [('E4', .5), ('G4', .5), ('A4', .5), ('G4', 1), ('E4', 1.5),        # Hurt in a car crash?
         ('D4', .5), ('E4', .5), ('G4', .5), ('A4', .5), ('C5', .5), ('A4', .5), ('G4', 1.5)]  # get checked in fourteen days
t = play_line(mx, INTRO, 0.1, beat, epiano, .5)
play_line(mx, [('E4', .5)] + HOOK, t + .1, beat, epiano, .6)          # "Call" pickup + hook
play_line(mx, HOOK, t + .1 + .5 * beat, beat, bell, .15, octave=1)
mx.save('2-radio-tag-10s', 10.8)
TIMING['2-radio-tag-10s'] = {'hook': t + .1 + .5 * beat, 'hookBeats': 4.25, 'beat': beat, 'length': 10.8}

# ---------- 3. Ad bed (~15 s): warm groove for a spoken ad, hook at the end ----------
beat = 60 / 92
mx = Mix(16)
prog = [('C4','E4','G4','C3'), ('G3','B3','D4','G2'), ('A3','C4','E4','A2'), ('F3','A3','C4','F2')] * 2
for i, ch in enumerate(prog):
    t = i * 2 * beat
    mx.add(pad([midi(m(n)) for n in ch[:3]], 2 * beat + .3, .11), t)
    mx.add(bass(midi(m(ch[3])), beat * .9, .3), t); mx.add(bass(midi(m(ch[3])), beat * .9, .22), t + beat)
    mx.add(kick(.35), t); mx.add(kick(.25), t + beat)
    for k in range(4): mx.add(shaker(.08, .035), t + k * beat / 2)
    # soft arpeggio
    for k, n in enumerate([ch[0], ch[1], ch[2], ch[1]]):
        mx.add(epiano(midi(m(n) + 12), beat * .6, .16), t + k * beat / 2)
t_hook = len(prog) * 2 * beat
mx.add(pad([midi(m('C4')), midi(m('E4')), midi(m('G4'))], 4 * beat, .1), t_hook)
mx.add(bass(midi(m('C3')), 3 * beat, .3), t_hook + 3 * beat)
play_line(mx, HOOK, t_hook, beat, epiano, .6)
play_line(mx, HOOK, t_hook, beat, bell, .16, octave=1)
mx.save('3-ad-bed-15s', t_hook + 4.6 * beat)
TIMING['3-ad-bed-15s'] = {'hook': t_hook, 'hookBeats': 4.25, 'beat': beat, 'length': t_hook + 4.6 * beat}
json.dump(TIMING, open(os.path.join(OUT, 'timing.json'), 'w'), indent=2)
print('ok', json.dumps(TIMING))
