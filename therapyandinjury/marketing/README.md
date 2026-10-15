# Audio: 844-84-TREAT jingles and voiceovers

| Path | What |
|---|---|
| `voiceover/tts.mjs` | The Google (Gemini TTS) voice presets shared with CoverageOnCall. Jingles use `urban` (male, Fenrir, a smooth, professional urban-radio read). `warm` (female, Achernar) and `action` (Fenrir, trailer read) are kept for parity. |
| `jingles/make-spots.mjs` | Builds the spots: voices each body line, sizes the groove to it, renders the beds, puts each hook word on its melody note, ducks the music under the voice, and normalizes to -16 LUFS. |
| `jingles/beds.py` | The music: a 92 bpm R&B/hip-hop groove (Rhodes, 808, kick, clap, hats). There's no melody under the spoken body, and a lead melody on the hook. Writes `out/timing.json` with the time of every hook note. Needs Python 3, numpy and ffmpeg (make-spots runs it). |

## Make the spots
```bash
cd therapyandinjury
node marketing/jingles/make-spots.mjs          # urban voice (default)
node marketing/jingles/make-spots.mjs warm     # any other preset, for comparison
```
The key comes from `GEMINI_API_KEY` in the environment. Never commit it or paste it in chat.

How the voice matches the jingle:
- The hook is voiced as six separate words ("Eight. Four. Four. Eight. Four. TREAT!").
- The take is cut at its pauses into one clip per word.
- Each clip starts on its melody note. A clip that runs past the next note is tightened (at most 1.45x).
- The body line ends right before the hook, so "Call..." leads straight into it.

Output goes in `marketing/jingles/out/` (git-ignored): `spot-1-audio-logo-<voice>.mp3` (~4s), `spot-2-radio-tag-<voice>.mp3` (~10s), `spot-3-ad-15s-<voice>.mp3` (under 15s). Voice clips are cached in `out/voice/`. Delete a clip to re-voice that line.

## Scripts (compliance-checked)
- **Hook:** "Eight-four-four… eight-four… TREAT."
- **Radio tag:** "Hurt in a car crash? Get checked within fourteen days. Call… [hook]"
- **Ad bed:** "After a car accident, Florida PIP generally requires care within fourteen days. Therapy and Injury: chiropractic care, with or without a referral. Call… [hook]"

Every spot names the profession ("chiropractic"), makes no promise of results, and is general education. Spots never target a specific crash or person.
