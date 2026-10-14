# Voiceovers

Owner rule (Oct 2026): every CoverageOnCall video uses one of these two voices, and only these.

| Preset | Voice | Use for | How it's read |
|---|---|---|---|
| `warm` | Female, Gemini TTS voice **Achernar** (`gemini-3.1-flash-tts-preview`) | Demos, how-it-works and feature videos, enroll reels | "Warm, explainer marketing video tone"; natural pace, untrimmed |
| `action` | Male, Gemini TTS voice **Fenrir** (`gemini-2.5-pro-preview-tts`) | Punchy ads, comparisons, hype spots ("Nothing else compares", Oct 2026) | High-energy action-movie trailer announcer; silences trimmed, then 1.1x speed |

`node tts.mjs <warm|action> "<line>" <out.wav>` makes one line (needs `GEMINI_API_KEY`; ffmpeg for `action`).
Write lines short and punchy for `action` (one idea per sentence, e.g. "Nothing. Else. Compares."). Time on-screen text to the measured clip lengths, not guesses.

Retired (owner rejected, Oct 2026): soft "luxury" male (Algieba) and slow cinematic male (Algenib).

Mix: voice on top; music well under it (about 7 dB below, ducked while he/she speaks); loudness -16 LUFS.
Action spots pair with the in-code action score (drums, pulsing bass, booms on hits, risers) and slam-in text, screen shake and teal flash on each hit, in the brand fonts (bold Outfit headlines with the teal second half, Inter body, filled teal coverageoncall.com button).
