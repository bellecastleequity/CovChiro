# InjuryCase sales video — voiceover script

The video (`InjuryCase sales video.mp4`, 1:48, 1080p) is built to play muted, with every point on screen. HIPAA readiness is shown from the first scene: a badge on the opening, a corner badge on every product screen, a full HIPAA & security scene, the pricing line and the closing call to action. To add a voice, record these lines to match the timecodes (about 140 words a minute — calm and confident), then send the audio file and it will be merged into the video. A doctor's own voice works best with clinic owners.

| Time | On screen | Voiceover |
|---|---|---|
| 0:00 | InjuryCase logo — "Every PI case, from first visit to final check." · HIPAA-ready badge | Every personal injury case — from the first visit to the final check. This is InjuryCase: HIPAA-ready case management for clinics that treat injury patients. |
| 0:07 | Spreadsheets and sticky notes · a missed deadline · attorneys waiting · patients slipping through | If your PI cases live in spreadsheets and sticky notes, you know the cost: a missed deadline, an attorney waiting on an update, a patient who quietly stops coming in. There's a better way. |
| 0:16 | Dashboard | Every morning, InjuryCase shows your team exactly what needs attention — gaps in care, overdue referrals, PIP billing deadlines, and settlements still waiting on a check — ranked by urgency. |
| 0:27 | Next steps on a case | Every case comes with a built-in PI playbook: the MRI script at visit one, the EMC determination in week one, the orthopedic referral after the MRI, and a re-exam every thirty days. Add your office's own steps, too. It's guidance — your doctors always make the clinical calls. |
| 0:39 | Daily huddle | Run a ten-minute morning huddle from one printable sheet, with an owner for every item — and a morning email digest that never includes patient details. |
| 0:48 | Policy limits & case value | Protect what every case is worth. See PIP remaining and medical bills against the policy limits, with soft warnings before a big reduction surprises you. |
| 0:58 | Letters and patient outreach | Keep attorneys in the loop in one click — status, treatment-complete, and reduction letters on your letterhead, with outreach logged in neutral, records-safe wording — a workflow shaped by more than ten years of personal injury attorney input. |
| 1:09 | State rules | Built in Florida and ready for your state, with PIP, no-fault, lawsuit-threshold, and lien rules configured for twenty-seven states plus D.C. |
| 1:17 | HIPAA & security — BAA, two-factor, encryption, backups, audit trail | And it's HIPAA-ready from day one. We sign a Business Associate Agreement with every practice, and the Security Rule's technical safeguards are built in: two-factor sign-in for every user, encryption, role-based access, automatic sign-out, a complete audit trail, and daily encrypted backups. |
| 1:28 | Pricing — "Every plan: HIPAA safeguards … signed BAA" | Plans start at thirty-nine dollars a month — every plan with the same HIPAA safeguards and a signed BAA — with a fourteen-day free trial and no credit card required. |
| 1:37 | Call to action + QR code · HIPAA-ready badge | Put every PI case on track this week. Start your free trial at injurycase.com, or email support at injurycase.com to request a demo. |

## Sending it to clinics

- **Email subject ideas:** "See every PI case's next step in 90 seconds" · "Stop losing PI cases to missed deadlines" · "A 10-minute huddle for your PI patients".
- **Email body (short):** Hi {Name}, we built InjuryCase for clinics like {Clinic} that treat auto and injury patients. This 90-second video shows how it keeps every case on track, from first visit to final check. Start a 14-day free trial (no card) at injurycase.com, or reply to set up a quick demo. — {Your name}
- Video email tools (and many inboxes) show the thumbnail (`thumbnail.jpg`) with a play button linking to the video page; attach the MP4 only for small lists.
- Use a promo code link to track and reward each campaign, e.g. `injurycase.com/app.html#signup?promo=FCA2026` (create the code in the operator console first).

## Switching the voice

The video fits itself to the voice. Each scene lasts its default length or as long as its voiceover clip needs, whichever is longer, so rewording a line or changing voices never cuts anything off. The lines live in `scenes.json`.

**Google Cloud Text-to-Speech (recommended)**
1. In Google Cloud, enable the Text-to-Speech API and create an API key restricted to it.
2. Add it as the `GOOGLE_TTS_API_KEY` secret (in this Claude environment: environment settings → Network secrets or environment variables; on your computer: `export GOOGLE_TTS_API_KEY=...`).
3. `python3 tts_google.py` writes one clip per scene to `vo/`. Try voices with `--voice` (e.g. `en-US-Neural2-D`, `en-US-Studio-Q`, or a Chirp 3 HD voice) and list them with `--list en-US`; redo one line with `--only 04-playbook`.
4. `python3 build_video.py` renders the video with the voice mixed in.

**Your own recording:** save one file per scene as `vo/01-open.mp3` … `vo/11-cta.mp3` (any of .mp3/.wav/.m4a), or a single take as `vo/full.mp3` timed to the table above, then run `build_video.py`.

**Music:** drop a licensed track in as `music.mp3`; it's mixed quietly under the voice and fades out at the end.

## Rebuilding the screens

1. With the app running locally, `node seed_and_shoot.js shots` seeds a fictional demo clinic (every name is made up) and captures the screens.
2. Edit wording or layout in `video.html` (each element's `data-in` is seconds after its scene starts), then `python3 build_video.py`.
