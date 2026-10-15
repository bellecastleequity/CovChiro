# Audio: 844-84-TREAT jingles and voiceovers

| Path | What |
|---|---|
| `jingles/beds.py` | Renders the three instrumental beds (audio logo ~5s, radio tag ~11s, ad bed ~13s) and `out/timing.json`, which records where the "eight-four-four, eight-four, TREAT" hook sits in each. Needs Python 3 + numpy + ffmpeg. |
| `voiceover/tts.mjs` | The Google (Gemini TTS) voice presets shared with CoverageOnCall: `warm` (female, Achernar) and `action` (male, Fenrir). |
| `jingles/make-spots.mjs` | Voices each spot, places the hook voice exactly on the music hook, ducks the music under the voice, and normalizes to -16 LUFS. |

## Make the spots
```bash
cd therapyandinjury
python3 marketing/jingles/beds.py
GEMINI_API_KEY=... node marketing/jingles/make-spots.mjs warm     # calm brand voice (recommended)
GEMINI_API_KEY=... node marketing/jingles/make-spots.mjs action   # high-energy male, for comparison
```
In this cloud environment, `GEMINI_API_KEY` comes from the environment settings. Never commit it or paste it in chat.

Output goes in `marketing/jingles/out/` (git-ignored):
- `spot-<bed>-warm-spoken.mp3`: the hook spoken on the beat
- `spot-<bed>-warm-sung.mp3`: the same voice asked to sing the hook. TTS isn't a trained singer, so pick whichever sounds better.

## Scripts (compliance-checked)
- **Hook:** "Eight-four-four… eight-four… TREAT."
- **Radio tag:** "Hurt in a car crash? Get checked within fourteen days. Call… [hook]"
- **Ad bed:** "After a car accident, Florida PIP generally requires care within fourteen days. Therapy and Injury: chiropractic care, with or without a referral. Call… [hook]"

Every spot names the profession ("chiropractic"), makes no promise of results, and is general education. Spots never target a specific crash or person.
