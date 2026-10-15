// Voices the 844-84-TREAT jingles and builds the music around the voice.
//
//   node marketing/jingles/make-spots.mjs [urban|warm|action]     (default: urban)
//
// 1. Voices each spot's body line, then picks how many bars of groove sit under it so the body
//    finishes just before the hook (no squeezing the read to fit a fixed bed).
// 2. Runs beds.py with that plan; timing.json comes back with the exact time of every hook note.
// 3. Voices the hook as six separate punchy words, cuts the take into its six words, and puts each
//    word on its melody note, so the voice and the jingle line up word for word.
// 4. Mixes: music ducked under the voice, -16 LUFS. Output: out/spot-<spot>-<voice>.mp3.
// Voice clips are cached in out/voice/ (delete a clip to re-voice it).
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tts, VOICES } from '../voiceover/tts.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'out');
const voiceDir = path.join(out, 'voice');
fs.mkdirSync(voiceDir, { recursive: true });
const FF = process.env.FFMPEG || 'ffmpeg';
const preset = process.argv[2] || 'urban';
if (!VOICES[preset]) throw new Error(`Unknown voice "${preset}"`);

// Must match beds.py.
const BEAT = 60 / 92;
const BAR = 4 * BEAT;

// The hook as six words, so the take cuts cleanly into one clip per melody note.
const HOOK_WORDS = ['Eight', 'four', 'four', 'eight', 'four', 'TREAT'];
const HOOK = 'Eight. Four. Four. Eight. Four. TREAT!';
VOICES[`${preset}Hook`] = {
  ...VOICES[preset],
  style: `${VOICES[preset].style}. Say each word on its own like a rhythmic radio jingle chant: short and punchy, a clear pause after every word, and land the last word with confidence`,
};

// Body lines are compliance-checked: general education, names the profession, no promises.
const SPOTS = [
  { name: '1-audio-logo', body: null },
  // `phrases` are the on-screen captions for the video ads (marketing/video), one per spoken phrase.
  {
    name: '2-radio-tag',
    body: 'Hurt in a car crash? Get checked within fourteen days. Call...',
    phrases: ['Hurt in a car crash?', 'Get checked within 14 days.', 'Call'],
  },
  {
    name: '3-ad-15s',
    body: 'After a car accident, Florida PIP generally requires care within fourteen days. Therapy and Injury: chiropractic care, with or without a referral. Call...',
    phrases: ['After a car accident,', 'Florida PIP generally requires care within 14 days.', 'Therapy & Injury:', 'chiropractic care,', 'with or without a referral.', 'Call'],
  },
  // "Don't Walk It Off" (30 s commercial). Longer spots list their script as `lines`: the whole script is
  // voiced as ONE take (separate takes drift in pitch and even gender), then each line's start is found
  // in the take for its caption. `say` is what the voice reads; `cap` is the on-screen caption.
  {
    name: '4-walk-it-off-30',
    length: 30,
    lines: [
      { say: 'You walked away from the crash.', cap: 'You walked away from the crash.' },
      { say: 'Said...', cap: 'Said,' },
      { say: "I'm good.", cap: '“I’m good.”' },
      { say: 'Next morning?', cap: 'Next morning?' },
      { say: 'Stiff neck.', cap: 'Stiff neck.' },
      { say: 'Tight back.', cap: 'Tight back.' },
      { say: 'Headaches.', cap: 'Headaches.' },
      { say: 'After a crash, symptoms can show up hours, even days later.', cap: 'After a crash, symptoms can show up hours, even days later.' },
      { say: 'Florida PIP generally requires care within fourteen days.', cap: 'Florida PIP generally requires care within 14 days.' },
      { say: "Don't walk it off.", cap: 'Don’t walk it off.' },
      { say: 'Get checked.', cap: 'Get checked.' },
      { say: 'Chiropractic care, with or without a referral.', cap: 'Chiropractic care, with or without a referral.' },
      // The website is said as "dot com" so the voice reads it cleanly; the URL itself names the brand.
      { say: 'Visit Therapy and Injury dot com, or call now...', cap: 'therapyandinjury.com' },
    ],
  },
  // "Don't Walk It Off" (60 s): the 30 s story, then the jingle mid-spot, then what the first visit
  // looks like and what to bring (wording matches social posts 05 and 10), then the final jingle.
  {
    name: '5-walk-it-off-60',
    length: 60,
    lines: [
      { say: 'You walked away from the crash.', cap: 'You walked away from the crash.' },
      { say: 'Said...', cap: 'Said,' },
      { say: "I'm good.", cap: '“I’m good.”' },
      { say: 'Even called home.', cap: 'Even called home.' },
      { say: "I'm fine. For real.", cap: '“I’m fine. For real.”' },
      { say: 'Next morning?', cap: 'Next morning?' },
      { say: 'Stiff neck.', cap: 'Stiff neck.' },
      { say: 'Tight back.', cap: 'Tight back.' },
      { say: 'Headaches.', cap: 'Headaches.' },
      { say: 'After a crash, symptoms can show up hours, even days later.', cap: 'After a crash, symptoms can show up hours, even days later.' },
      { say: 'And Florida PIP generally requires care within fourteen days.', cap: 'Florida PIP generally requires care within 14 days.' },
      { say: "So don't walk it off. Call...", cap: 'So don’t walk it off. Call', hookAfter: true },
      { say: 'At Therapy and Injury, your first visit is simple.', cap: 'Your first visit is simple.' },
      { say: 'A conversation about how you got hurt.', cap: 'A conversation about how you got hurt.' },
      { say: 'A chiropractic exam.', cap: 'A chiropractic exam.' },
      { say: 'And a clear plan, in plain language.', cap: 'A clear plan, in plain language.' },
      { say: 'Bring your photo ID, your auto insurance card, and your crash report if you have one.', cap: 'What to bring' },
      { say: 'Chiropractic care, with or without a referral.', cap: 'Chiropractic care, with or without a referral.' },
      { say: "Don't wait out the clock.", cap: 'Don’t wait out the clock.' },
      { say: 'Get checked.', cap: 'Get checked.' },
      { say: 'Visit Therapy and Injury dot com, or call now...', cap: 'therapyandinjury.com' },
    ],
  },
];

const dur = (f) => +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim();
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const ff = (...args) => execFileSync(FF, ['-y', '-loglevel', 'error', ...args]);

// Cache name: readable slug + a hash of the full text (two scripts can share their first 40 characters).
const key = (text) => `${slug(text)}-${crypto.createHash('sha1').update(text).digest('hex').slice(0, 8)}`;

async function line(p, text) {
  const f = path.join(voiceDir, `${p}-${key(text)}.wav`);
  await tts(p, text, f);
  return f;
}

function readWav(file) {
  const b = fs.readFileSync(file);
  let i = 12, rate = 24000, data;
  while (i < b.length - 8) {
    const id = b.toString('ascii', i, i + 4), size = b.readUInt32LE(i + 4);
    if (id === 'fmt ') rate = b.readUInt32LE(i + 12);
    if (id === 'data') { data = b.subarray(i + 8, i + 8 + size); break; }
    i += 8 + size + (size % 2);
  }
  const s = new Float32Array(data.length / 2);
  for (let k = 0; k < s.length; k++) s[k] = data.readInt16LE(k * 2) / 32768;
  return { rate, s };
}

function writeWav(file, s, rate) {
  const pcm = Buffer.alloc(s.length * 2);
  for (let k = 0; k < s.length; k++) pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(s[k] * 32767))), k * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, pcm]));
}

/** Splits a take into `count` words by its pauses; returns each word as [{start, end}] pieces in samples. */
function words(file, count) {
  const { rate, s } = readWav(file);
  const hop = Math.round(rate * 0.01);
  const rms = [];
  for (let k = 0; k + hop <= s.length; k += hop) {
    let e = 0;
    for (let j = k; j < k + hop; j++) e += s[j] * s[j];
    rms.push(Math.sqrt(e / hop));
  }
  const thr = Math.max(...rms) * 0.03; // about -30 dB: keeps quiet consonant releases ("eigh-t", "trea-t")
  let segs = [];
  for (let f = 0, start = -1; f <= rms.length; f++) {
    const on = f < rms.length && rms[f] > thr;
    if (on && start < 0) start = f;
    if (!on && start >= 0) { segs.push([[start, f]]); start = -1; }
  }
  segs = segs.filter((g) => g[0][1] - g[0][0] >= 3);
  const gap = (j) => segs[j + 1][0][0] - segs[j].at(-1)[1];
  // A word is the pieces between the long pauses the hook read leaves between words.
  while (segs.length > count) {
    let k = 0;
    for (let j = 1; j < segs.length - 1; j++) if (gap(j) < gap(k)) k = j;
    segs.splice(k, 2, [...segs[k], ...segs[k + 1]]);
  }
  while (segs.length < count) {
    // A run-on read: split the longest word at its quietest frame.
    let k = 0;
    const span = (g) => g.at(-1)[1] - g[0][0];
    segs.forEach((g, j) => { if (span(g) > span(segs[k])) k = j; });
    const a = segs[k][0][0], b = segs[k].at(-1)[1];
    let m = a + 5;
    for (let f = a + 5; f < b - 5; f++) if (rms[f] < rms[m]) m = f;
    segs.splice(k, 1, [[a, m]], [[m + 1, b]]);
  }
  const pad = (g) => g.map(([a, b], i) => ({ start: Math.max(0, (i ? Math.ceil((a + g[i - 1][1]) / 2) : a - 2) * hop), end: Math.min(s.length, (i + 1 < g.length ? Math.floor((b + g[i + 1][0]) / 2) : b + 3) * hop) }));
  return { rate, s, segs: segs.map(pad) };
}

/** Joins a word's pieces with the silence inside it cut to 40 ms, with short fades. */
function wordAudio(s, rate, pieces) {
  const fade = Math.round(rate * 0.008), hole = new Float32Array(Math.round(rate * 0.04));
  const parts = pieces.map(({ start, end }, i) => {
    const p = s.slice(start, end);
    for (let k = 0; k < fade && k < p.length; k++) { if (i) p[k] *= k / fade; p[p.length - 1 - k] *= k / fade; }
    return i ? [hole, p] : [p];
  }).flat();
  const all = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  parts.reduce((o, p) => (all.set(p, o), o + p.length), 0);
  for (let k = 0; k < fade; k++) all[k] *= k / fade;
  return all;
}

/** One clip per hook word, each fitted to the time until the next note. */
function hookClips(file, notes, spotLength) {
  const { rate, s, segs } = words(file, notes.length);
  return segs.map((pieces, i) => {
    const slot = i + 1 < notes.length ? notes[i + 1].t - notes[i].t - 0.03 : spotLength - notes[i].t - 0.3;
    let f = path.join(voiceDir, `${path.basename(file, '.wav')}.w${i}.wav`);
    // Keep the word's natural span when it fits; otherwise cut the pause inside it (eigh..t) first.
    const whole = [{ start: pieces[0].start, end: pieces.at(-1).end }];
    const seg = (whole[0].end - whole[0].start) / rate <= slot ? wordAudio(s, rate, whole) : wordAudio(s, rate, pieces);
    writeWav(f, seg, rate);
    const len = seg.length / rate;
    if (len > slot) {
      const g2 = f.replace(/\.wav$/, '.fit.wav');
      const factor = Math.min(1.45, len / slot);
      ff('-i', f, '-af', `atempo=${factor.toFixed(3)},afade=t=out:st=${Math.max(0, slot - 0.03).toFixed(3)}:d=0.03,atrim=0:${slot.toFixed(3)}`, g2);
      f = g2;
    }
    // Words hit the beat on their vowel, a few ms after the clip starts.
    return { file: f, at: Math.max(0, notes[i].t - 0.035), word: HOOK_WORDS[i], len: Math.min(len, slot) };
  });
}

/** Start time (s) of each of `count` phrases in a read: phrases begin after its longest pauses. */
function phraseStarts(file, count) {
  const { rate, s } = readWav(file);
  const hop = Math.round(rate * 0.01), rms = [];
  for (let k = 0; k + hop <= s.length; k += hop) {
    let e = 0;
    for (let j = k; j < k + hop; j++) e += s[j] * s[j];
    rms.push(Math.sqrt(e / hop));
  }
  const thr = Math.max(...rms) * 0.03, pauses = [];
  let first = rms.findIndex((v) => v > thr);
  for (let f = first, q = -1; f < rms.length; f++) {
    if (rms[f] <= thr) { if (q < 0) q = f; }
    else if (q >= 0) { pauses.push({ len: f - q, end: f }); q = -1; }
  }
  const cuts = pauses.sort((a, b) => b.len - a.len).slice(0, count - 1).map((p) => p.end).sort((a, b) => a - b);
  return [first, ...cuts].map((f) => (f * hop) / rate);
}

/**
 * Rough start time of each line from Gemini (audio in, JSON array out), cached as <take>.align.json.
 * Accurate to a few tenths of a second; lineStarts() snaps each one to a real pause in the take.
 */
async function geminiAlign(file, lines) {
  const cache = `${file}.align.json`;
  if (fs.existsSync(cache)) return JSON.parse(fs.readFileSync(cache, 'utf8'));
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ parts: [
        { inlineData: { mimeType: 'audio/wav', data: fs.readFileSync(file).toString('base64') } },
        { text: `Force-align this voiceover to its script. For each numbered line give the time in seconds (two decimals) when the FIRST word of that line starts to be spoken. Lines:\n${lines.map((l, i) => `${i}. ${l}`).join('\n')}` },
      ] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: { type: 'ARRAY', items: { type: 'NUMBER' } } },
    }),
  });
  const j = await r.json();
  const times = JSON.parse(j.candidates?.[0]?.content?.parts?.at(-1)?.text ?? 'null');
  if (!Array.isArray(times) || times.length !== lines.length) { console.warn(`  note: Gemini alignment unavailable (${r.status}); using text-length estimates`); return null; }
  fs.writeFileSync(cache, JSON.stringify(times));
  return times;
}

/**
 * Start time (s) of each line in a one-take read. Candidates are speech onsets after a pause of 60 ms+;
 * each line is matched to the candidate nearest where it should start (Gemini's estimate when given,
 * else its share of the characters), favoring longer pauses, keeping the lines in order (dynamic programming).
 */
function lineStarts(file, lines, hint) {
  const { rate, s } = readWav(file);
  const hop = Math.round(rate * 0.01), rms = [];
  for (let k = 0; k + hop <= s.length; k += hop) {
    let e = 0;
    for (let j = k; j < k + hop; j++) e += s[j] * s[j];
    rms.push(Math.sqrt(e / hop));
  }
  const thr = Math.max(...rms) * 0.03;
  const first = rms.findIndex((v) => v > thr);
  let last = rms.length - 1;
  while (rms[last] <= thr) last--;
  const cand = [];
  for (let f = first, q = -1; f <= last; f++) {
    if (rms[f] <= thr) { if (q < 0) q = f; }
    else if (q >= 0) { if (f - q >= 6) cand.push({ t: f / 100, pause: (f - q) / 100 }); q = -1; }
  }
  const chars = lines.map((l) => l.length + 6); // +6: every line ends in a pause
  const total = chars.reduce((a, b) => a + b, 0);
  const t0 = first / 100, span = last / 100 - t0;
  const expect = hint ?? chars.map((_, i) => t0 + (span * chars.slice(0, i).reduce((a, b) => a + b, 0)) / total);
  const cost = (i, j) => Math.abs(cand[j].t - expect[i]) - (hint ? 0.3 : 1.2) * Math.min(cand[j].pause, 0.6);
  // best[i][j]: lines 1..i placed, line i on candidate j.
  const n = lines.length, m = cand.length, best = [], from = [];
  for (let i = 1; i < n; i++) {
    best[i] = []; from[i] = [];
    for (let j = 0; j < m; j++) {
      if (i === 1) { best[i][j] = cost(i, j); continue; }
      let b = Infinity, k0 = -1;
      for (let k = 0; k < j; k++) if (best[i - 1][k] < b) { b = best[i - 1][k]; k0 = k; }
      best[i][j] = b + cost(i, j); from[i][j] = k0;
    }
  }
  let j = best[n - 1].indexOf(Math.min(...best[n - 1]));
  const starts = [];
  for (let i = n - 1; i >= 1; i--) { starts[i] = cand[j].t; j = from[i][j]; }
  starts[0] = t0;
  return starts;
}

function mix(bed, clips, outFile, length) {
  const inputs = ['-i', path.join(out, `${bed}.wav`), ...clips.flatMap((c) => ['-i', c.file])];
  const delays = clips.map((c, i) => `[${i + 1}:a]aresample=44100,adelay=${Math.round(c.at * 1000)}:all=1[v${i}]`);
  const graph = [
    ...delays,
    `${clips.map((_, i) => `[v${i}]`).join('')}amix=inputs=${clips.length}:normalize=0,apad=whole_dur=${length.toFixed(3)},asplit=2[vox][key]`,
    `[0:a]aresample=44100,volume=0.6[bed]`,
    `[bed][key]sidechaincompress=threshold=0.03:ratio=4:attack=10:release=250[duck]`,
    `[duck][vox]amix=inputs=2:normalize=0:duration=longest,atrim=0:${length.toFixed(3)},loudnorm=I=-16:TP=-1.5:LRA=9[outa]`,
  ].join(';');
  execFileSync(FF, ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', graph, '-map', '[outa]', '-b:a', '192k', outFile]);
  return outFile;
}

/**
 * 60 s spots: one take split into two acts at the line marked `hookAfter`. Act 1 runs into a mid-spot
 * hook; act 2 starts just after that hook's TREAT and is fitted to end right before the final hook.
 */
async function twoActs(spot, file, starts, m) {
  const { rate, s } = readWav(file);
  const cut = Math.round((starts[m + 1] - 0.12) * rate);
  const fa = file.replace(/\.wav$/, '.act1.wav'), fb0 = file.replace(/\.wav$/, '.act2.wav');
  writeWav(fa, s.slice(0, cut), rate);
  writeWav(fb0, s.slice(cut), rate);
  const dA = dur(fa);
  const mid = Math.ceil((0.45 + dA - BEAT) / BAR);
  const atA = Math.max(0.3, mid * BAR + BEAT - 0.15 - dA);
  const startB = (mid + 1) * BAR + 1.6; // TREAT lands on bar mid+1; act 2 starts as it rings out
  const bars = Math.floor((spot.length - 1.2 - 4 * BEAT) / BAR);
  const room = bars * BAR + BEAT - 0.15 - startB;
  let fb = fb0, dB = dur(fb0), k = 1;
  // Fit act 2 to its slot: speed up if long, or slow down up to 5% so a short read leaves no dead air.
  const tempo = dB > room ? dB / room : Math.max(0.95, dB / room);
  if (Math.abs(tempo - 1) > 0.005) {
    k = 1 / tempo;
    if (tempo > 1.12) console.warn(`  note: ${spot.name} act 2 is ${(dB - room).toFixed(1)}s long for its slot; sped up ${((tempo - 1) * 100).toFixed(0)}%`);
    fb = fb0.replace(/\.wav$/, '.fit.wav');
    ff('-i', fb0, '-af', `atempo=${tempo.toFixed(3)}`, fb);
    dB = dur(fb);
  }
  const atB = Math.max(startB, bars * BAR + BEAT - 0.15 - dB);
  const cutS = cut / rate;
  bodies[spot.name] = {
    clips: [{ file: fa, at: atA }, { file: fb, at: atB }],
    times: starts.map((x, i) => (i <= m ? atA + x : atB + (x - cutS) * k)),
    actTwo: startB,
  };
  plan[spot.name] = { bars, length: spot.length, mid };
}

// 1. Bodies first: size each bed to its read.
const plan = {}, bodies = {};
for (const spot of SPOTS) {
  if (!spot.body && !spot.lines) { plan[spot.name] = { bars: 0 }; continue; }
  let file, starts;
  if (spot.lines) {
    file = await line(preset, spot.lines.map((l) => l.say).join(' '));
    const says = spot.lines.map((l) => l.say);
    starts = lineStarts(file, says, await geminiAlign(file, says));
    const m = spot.lines.findIndex((l) => l.hookAfter);
    if (m >= 0) { await twoActs(spot, file, starts, m); continue; }
  } else file = await line(preset, spot.body);
  const d = dur(file);
  // The hook starts on beat 2 of bar n; the body needs 0.3 s lead-in and 0.15 s before the hook.
  let bars = Math.max(1, Math.ceil((0.45 + d - BEAT) / BAR));
  if (bars > 1 && 0.45 + d / 1.1 <= (bars - 1) * BAR + BEAT) bars -= 1; // a slight tighten saves a bar
  // Fixed-length spots: the latest bar whose "TREAT" (3 beats into the hook) still has 1.2 s before the end.
  if (spot.length) bars = Math.floor((spot.length - 1.2 - 3 * BEAT - BEAT) / BAR);
  const room = bars * BAR + BEAT - 0.45;
  if (d > room) {
    const tight = file.replace(/\.wav$/, '.fit.wav');
    if (d / room > 1.12) console.warn(`  note: ${spot.name} read is ${(d - room).toFixed(1)}s long for its slot; sped up ${((d / room - 1) * 100).toFixed(0)}% (trim the copy if it sounds rushed)`);
    ff('-i', file, '-af', `atempo=${(d / room).toFixed(3)}`, tight);
    file = tight;
    starts = starts?.map((x) => (x * room) / d);
  }
  // End the body right before the hook so "Call..." leads straight into it.
  bodies[spot.name] = { file, starts, at: Math.max(0.3, bars * BAR + BEAT - 0.15 - dur(file)) };
  plan[spot.name] = { bars, length: spot.length };
}
fs.writeFileSync(path.join(out, 'plan.json'), JSON.stringify(plan));

// 2. Music around the voice.
console.log(execFileSync('python3', [path.join(here, 'beds.py'), path.join(out, 'plan.json')]).toString().trim());
const timing = JSON.parse(fs.readFileSync(path.join(out, 'timing.json'), 'utf8'));

// 3 + 4. Hook words on the notes, then mix.
const hookTake = await line(`${preset}Hook`, HOOK);
const cues = {};
for (const spot of SPOTS) {
  const t = timing[spot.name];
  const b = bodies[spot.name];
  const clips = hookClips(hookTake, t.hookNotes, t.length);
  const midClips = t.midHookNotes ? hookClips(hookTake, t.midHookNotes, b.actTwo + 0.25) : [];
  if (b?.clips) clips.unshift(...b.clips, ...midClips);
  else if (b) clips.unshift(b);
  const f = mix(spot.name, clips, path.join(out, `spot-${spot.name}-${preset}.mp3`), t.length);
  console.log(`made ${path.relative(process.cwd(), f)} (${dur(f).toFixed(1)}s): ${clips.map((c) => `${c.word ?? 'body'}@${c.at.toFixed(2)}`).join(' ')}`);
  cues[spot.name] = {
    audio: path.basename(f),
    length: t.length,
    beat: t.beat,
    phrases: !b ? []
      : b.times ? spot.lines.map((l, i) => ({ text: l.cap, t: +b.times[i].toFixed(3) }))
      : spot.lines ? spot.lines.map((l, i) => ({ text: l.cap, t: +(b.at + b.starts[i]).toFixed(3) }))
      : phraseStarts(b.file, spot.phrases.length).map((s0, i) => ({ text: spot.phrases[i], t: +(b.at + s0).toFixed(3) })),
    hook: t.hookNotes.map((n, i) => ({ word: HOOK_WORDS[i], t: n.t })),
    ...(t.midHookNotes && { midHook: t.midHookNotes.map((n, i) => ({ word: HOOK_WORDS[i], t: n.t })) }),
  };
}
// Caption and beat timings for the video ads.
fs.writeFileSync(path.join(out, `cues-${preset}.json`), JSON.stringify(cues, null, 2));
