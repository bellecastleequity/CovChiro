// Voices the 844-84-TREAT jingles with the shared Google (Gemini TTS) voice presets and mixes
// them over the music beds from beds.py.
//
//   python3 marketing/jingles/beds.py          # once: renders the music beds + timing.json
//   GEMINI_API_KEY=... node marketing/jingles/make-spots.mjs [warm|action]
//
// Output: marketing/jingles/out/spot-<n>-<voice>-{spoken,sung}.mp3, mixed to -16 LUFS with the
// music ducked under the voice (same mix rules as CoverageOnCall). Voice clips are cached in
// out/voice/, so re-running only re-mixes.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tts, VOICES } from '../voiceover/tts.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'out');
const voiceDir = path.join(out, 'voice');
fs.mkdirSync(voiceDir, { recursive: true });
const FF = process.env.FFMPEG || 'ffmpeg';
const preset = process.argv[2] || 'warm';
if (!VOICES[preset]) throw new Error(`Unknown voice "${preset}"`);

// A third style on the same warm voice: asks Gemini to sing/chant the hook on the melody's rhythm.
// TTS isn't a singer, so this is a "sung-ish" take; keep whichever sounds better.
VOICES.warmSung = {
  ...VOICES.warm,
  style:
    'Sing this short radio jingle warmly and melodically, like a friendly, calm commercial tag. Rising on the first numbers, landing gently and holding the last word',
};

const timing = JSON.parse(fs.readFileSync(path.join(out, 'timing.json'), 'utf8'));
const HOOK = 'Eight four four... eight four... TREAT.';

// Body lines are compliance-checked: general education, names the profession, no promises.
const SPOTS = [
  { bed: '1-audio-logo', body: null },
  { bed: '2-radio-tag-10s', body: 'Hurt in a car crash? Get checked within fourteen days. Call...' },
  {
    bed: '3-ad-bed-15s',
    body: 'After a car accident, Florida PIP generally requires care within fourteen days. Therapy and Injury: chiropractic care, with or without a referral. Call...',
  },
];

const dur = (f) => +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim();
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

async function line(p, text) {
  const f = path.join(voiceDir, `${p}-${slug(text)}.wav`);
  await tts(p, text, f);
  return f;
}

/** Stretches/squeezes a clip toward a target length (within a natural-sounding 0.85x–1.15x). */
function fit(file, target, tag) {
  const d = dur(file);
  const factor = Math.min(1.15, Math.max(0.85, d / target));
  if (Math.abs(factor - 1) < 0.02) return file;
  const o = file.replace(/\.wav$/, `.${tag}.wav`);
  execFileSync(FF, ['-y', '-loglevel', 'error', '-i', file, '-af', `atempo=${factor.toFixed(3)}`, o]);
  return o;
}

function mix(bed, clips, outFile, length) {
  // clips: [{ file, at }]. Voice on top, music ducked ~7 dB while the voice speaks, -16 LUFS.
  const inputs = ['-i', path.join(out, `${bed}.wav`), ...clips.flatMap((c) => ['-i', c.file])];
  const delays = clips.map((c, i) => `[${i + 1}:a]aresample=44100,adelay=${Math.round(c.at * 1000)}:all=1,volume=1.0[v${i}]`);
  const voices = clips.map((_, i) => `[v${i}]`).join('');
  const graph = [
    ...delays,
    `${voices}amix=inputs=${clips.length}:normalize=0,apad=whole_dur=${length.toFixed(3)},asplit=2[vox][key]`,
    `[0:a]aresample=44100,volume=0.55[bed]`,
    `[bed][key]sidechaincompress=threshold=0.02:ratio=6:attack=15:release=350[duck]`,
    `[duck][vox]amix=inputs=2:normalize=0:duration=longest,atrim=0:${length.toFixed(3)},loudnorm=I=-16:TP=-1.5:LRA=9[outa]`,
  ].join(';');
  execFileSync(FF, ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', graph, '-map', '[outa]', '-b:a', '192k', outFile]);
  return outFile;
}

for (const spot of SPOTS) {
  const t = timing[spot.bed];
  const hookLen = t.hookBeats * t.beat;
  for (const style of ['spoken', 'sung']) {
    const clips = [];
    if (spot.body) {
      // The body must finish just before the hook; squeeze gently if needed.
      const body = fit(await line(preset, spot.body), t.hook - 0.45, 'fit');
      clips.push({ file: body, at: 0.3 });
      if (dur(body) + 0.3 > t.hook + 0.05) console.warn(`  note: ${spot.bed} body runs ${(dur(body) + 0.3 - t.hook).toFixed(2)}s into the hook`);
    }
    const hookVoice = style === 'sung' && preset === 'warm' ? 'warmSung' : preset;
    if (style === 'sung' && preset !== 'warm') continue;
    const tag = fit(await line(hookVoice, HOOK), hookLen, 'hook');
    clips.push({ file: tag, at: t.hook });
    const f = mix(spot.bed, clips, path.join(out, `spot-${spot.bed}-${preset}-${style}.mp3`), t.length);
    console.log(`made ${path.relative(process.cwd(), f)} (${dur(f).toFixed(1)}s)`);
  }
}
