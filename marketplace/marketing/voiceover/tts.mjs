// The two approved CoverageOnCall voiceovers (owner, Oct 2026). Every video uses one of these, nothing else.
//   node tts.mjs <warm|action> "<line>" <out.wav>
// Key: GEMINI_API_KEY in the environment (never committed; never pasted in chat).
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

export const VOICES = {
  // Female, warm explainer: every demo / how-it-works video (batch 1-3, enroll reels).
  warm: {
    model: 'gemini-3.1-flash-tts-preview',
    voiceName: 'Achernar',
    style: 'Read aloud in a warm, explainer marketing video tone',
    trim: false,
    tempo: 1.0,
  },
  // Male, high-energy action-movie trailer: punchy ads ("Nothing else compares").
  action: {
    model: 'gemini-2.5-pro-preview-tts',
    voiceName: 'Fenrir',
    style: 'Read this as a high-energy action movie trailer announcer: intense, punchy, urgent and exciting, fast pace, hitting every word hard like an explosive blockbuster trailer',
    trim: true, // cut leading/trailing silence
    tempo: 1.1, // then speed up 10% (pitch kept)
  },
};

const wav = (pcm, rate) => { const h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40); return Buffer.concat([h, pcm]); };

/** Makes one line. ffmpeg (FFMPEG env or on PATH) is needed for the action voice's trim + tempo. */
export async function tts(preset, text, out) {
  const v = VOICES[preset];
  if (!v) throw new Error(`Unknown voice "${preset}". Use warm or action.`);
  if (fs.existsSync(out)) return out;
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('Set GEMINI_API_KEY');
  for (let a = 0; a < 6; a++) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${v.model}:generateContent?key=${key}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: `${v.style}:\n${text}` }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: v.voiceName } } } } }),
    });
    const j = await r.json();
    const part = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
    if (r.ok && part) {
      const rate = +(part.inlineData.mimeType.match(/rate=(\d+)/)?.[1] ?? 24000);
      const raw = v.trim || v.tempo !== 1 ? `${out}.raw.wav` : out;
      fs.writeFileSync(raw, wav(Buffer.from(part.inlineData.data, 'base64'), rate));
      if (raw !== out) {
        const af = [v.trim && 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.03,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.06,areverse', v.tempo !== 1 && `atempo=${v.tempo}`].filter(Boolean).join(',');
        execFileSync(process.env.FFMPEG || 'ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-af', af, out]);
        fs.rmSync(raw);
      }
      return out;
    }
    if (r.status === 402 || (r.status === 429 && /PerDay/.test(JSON.stringify(j)))) throw new Error(`Gemini quota (${r.status}): ${JSON.stringify(j).slice(0, 200)}`);
    await new Promise((res) => setTimeout(res, (r.status === 429 ? 20000 : 3000) * (a + 1)));
  }
  throw new Error('TTS failed: ' + text);
}

if (import.meta.url === `file://${process.argv[1]}` && process.argv[4]) console.log(await tts(process.argv[2], process.argv[3], process.argv[4]));
