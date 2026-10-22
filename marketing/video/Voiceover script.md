# InjuryCase sales video — voiceover script

The video (`InjuryCase sales video.mp4`, 1:41, 1080p) is built to play muted, with every point on screen. To add a voice, record these lines to match the timecodes (about 140 words a minute — calm and confident), then send the audio file and it will be merged into the video. A doctor's own voice works best with clinic owners.

| Time | On screen | Voiceover |
|---|---|---|
| 0:00 | InjuryCase logo — "Every PI case, from first visit to final check." | Every personal injury case — from the first visit to the final check. This is InjuryCase. |
| 0:06 | Spreadsheets and sticky notes · a missed deadline · attorneys waiting · patients slipping through | If your PI cases live in spreadsheets and sticky notes, you know the cost: a missed deadline, an attorney waiting on an update, a patient who quietly stops coming in. There's a better way. |
| 0:15 | Dashboard | Every morning, InjuryCase shows your team exactly what needs attention — gaps in care, overdue referrals, PIP billing deadlines and settlements still waiting on a check — ranked by urgency. |
| 0:26 | Next steps on a case | Every case comes with a built-in PI playbook: the MRI script at visit one, the EMC determination in week one, the orthopedic referral after the MRI, and a re-exam every thirty days. It's guidance — your doctors always make the clinical calls. |
| 0:38 | Daily huddle | Run a ten-minute morning huddle from one printable sheet, with an owner for every item — and a morning email digest that never includes patient details. |
| 0:47 | Policy limits & case value | Protect what every case is worth. See PIP remaining and medical bills against the policy limits, with soft warnings before a big reduction surprises you. |
| 0:57 | Letters and patient outreach | Keep attorneys in the loop in one click — status, treatment-complete and reduction letters on your letterhead, with outreach logged in neutral, records-safe wording. |
| 1:06 | State rules | Built in Florida and ready for your state, with PIP, no-fault, lawsuit-threshold and lien rules configured for twenty-seven states plus D.C. |
| 1:14 | Security | HIPAA-ready from day one: a Business Associate Agreement, two-factor sign-in for every user, encryption and daily backups — shaped by more than ten years of personal injury attorney input. |
| 1:22 | Pricing | Plans start at thirty-nine dollars a month, with a fourteen-day free trial and no credit card required. |
| 1:30 | Call to action + QR code | Put every PI case on track this week. Start your free trial at injurycase.com, or email support@injurycase.com to request a demo. |

## Sending it to clinics

- **Email subject ideas:** "See every PI case's next step in 90 seconds" · "Stop losing PI cases to missed deadlines" · "A 10-minute huddle for your PI patients".
- **Email body (short):** Hi {Name}, we built InjuryCase for clinics like {Clinic} that treat auto and injury patients. This 90-second video shows how it keeps every case on track, from first visit to final check. Start a 14-day free trial (no card) at injurycase.com, or reply to set up a quick demo. — {Your name}
- Video email tools (and many inboxes) show the thumbnail (`thumbnail.jpg`) with a play button linking to the video page; attach the MP4 only for small lists.
- Use a promo code link to track and reward each campaign, e.g. `injurycase.com/app.html#signup?promo=FCA2026` (create the code in the operator console first).

## Rebuilding the video

1. With the app running locally, `node seed_and_shoot.js <dir>/shots` seeds a fictional demo clinic (every name is made up) and captures the screens.
2. `node render.js <dir> 30` renders `video.html` frame by frame; then `ffmpeg -framerate 30 -i frames/%05d.jpg -c:v libx264 -crf 20 -pix_fmt yuv420p "InjuryCase sales video.mp4"`.
3. Edit wording and timing in `video.html` (each element's `data-in` is its entrance time in seconds).
