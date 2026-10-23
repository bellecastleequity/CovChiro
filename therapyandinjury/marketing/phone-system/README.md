# Phone system: Amazon Connect + texting + automatic leads

```
Caller dials 844-84-TREAT ──► Amazon Connect (voice)
                               │  ├─ Lambda "log"       → lead in /_admin → Leads (badge: call)
                               │  └─ "Press 1 to text"  → Lambda "sendText" → first text from the texting number
                               ▼
Texting number (AWS End User Messaging SMS, imported into Connect)
   patient replies ──► Connect chat (AI agent or front desk) ─► Lambda "log" → same lead (badge: text)
Website "Text us" buttons ──► same texting number
```

- **844-84-TREAT** stays the number on every ad, video, jingle and page. It takes calls only.
- **The texting number** is a separate AWS number used for two-way texts.
- **Every call and text becomes a lead on its own.**
  - It shows in /_admin → Leads with a **call** or **text** badge.
  - A number seen in the last 30 days is added to that person's lead, with a red **called again** or **texted again** badge.
  - Callers who were patients before get a "Returning" note.
  - The front desk only sets *How did you hear about us?* and the status.

Files:
- `lambda/index.mjs`: the AWS Lambda function. Paste it in as-is; nothing to install.
- `lambda/test-event-call.json` and `lambda/test-event-text.json`: test events for the Lambda console.

---

## 1. Before go-live (one time)

1. **HIPAA agreement:** AWS console → **AWS Artifact** → Agreements → accept the **AWS Business Associate Addendum**. Do this before any patient calls or texts go through AWS.
2. **Port 844-84-TREAT for voice.**
   - Tell AWS to continue the port, voice only.
   - Keep the current carrier account active until AWS confirms the port is complete.
   - Texting on 844-84-TREAT stops at the port.
3. **Get the texting number:** AWS console → **AWS End User Messaging SMS** → Phone numbers → Request originator. Pick one:
   - **Local 10DLC number** (recommended: a local number gets more replies). Register a **Brand** (your EIN and legal name) and a **Campaign** using the answers in section 5. Approval takes about 1–3 weeks.
   - **Toll-free number.** Submit **toll-free verification** with the same answers. Takes about 2–6 weeks and supports picture messages.
   - Turn on **two-way messaging** for the number.
   - Leave AWS's automatic **STOP/HELP** keyword handling on. Add a HELP reply: *"Therapy & Injury: call 844-84-TREAT for help. Reply STOP to opt out."*
4. **Import the texting number into Connect:** Amazon Connect console → your instance → **Channels → Phone numbers → Import number** (from End User Messaging). Then, in the Connect admin site, assign it to the **inbound text flow** (section 4).

## 2. The Lambda function (10 minutes)

1. AWS console → **Lambda** → Create function → *Author from scratch* → name `ti-connect-leads`, runtime **Node.js 22.x**.
2. Code tab: rename `index.js` to **`index.mjs`**, paste in `lambda/index.mjs`, and click **Deploy**.
3. Configuration → General → **Timeout: 8 seconds**.
4. Configuration → **Environment variables**:

| Key | Value |
|---|---|
| `SITE_EVENT_URL` | from /_admin → **Team → Phone system** (click Show) |
| `SITE_SECRET` | from the same place |
| `TEXT_FROM` | the texting number's **Phone number ID** (or ARN) from End User Messaging |
| `TEXT_CONFIG_SET` | optional: an End User Messaging configuration set, if you want delivery events |

5. Configuration → Permissions → the role → **Add permissions → Create inline policy** (JSON). Replace the region, account and number ID:
```json
{ "Version": "2012-10-17", "Statement": [{ "Effect": "Allow", "Action": "sms-voice:SendTextMessage",
  "Resource": "arn:aws:sms-voice:us-east-1:<ACCOUNT_ID>:phone-number/<PHONE_NUMBER_ID>" }] }
```
6. **Test** tab: paste `lambda/test-event-call.json` → Test. It returns `logged: "true"`, `textSent: "true"`, and a test lead shows in /_admin → Leads (delete it after). Then run `lambda/test-event-text.json` the same way.
7. Amazon Connect console → your instance → **Flows → AWS Lambda** → add `ti-connect-leads`.

## 3. Inbound call flow (844-84-TREAT)

Build it in the Connect admin site → Routing → **Flows** → Create flow. Block by block:

1. **Set logging behavior** → enabled. **Set voice** → English (e.g. "Joanna" or "Danielle", neural).
2. **Get customer input** (text-to-speech, timeout 3 s): *language menu* (section 6). On 2 → **Set contact attributes** `lang = es` and set the voice to a Spanish (US) voice. On 3 → `lang = ht`. Default and timeout → `lang = en`.
   - Amazon Polly has no Haitian Creole voice. For the Creole prompts, record a staff member or voice talent and upload them as **audio prompts**. The jingle voice files in `marketing/voiceover` can be used the same way.
3. **Invoke AWS Lambda function** → `ti-connect-leads`, no parameters. This logs the call as soon as it arrives, so even hang-ups become a lead to call back. Optional: **Check contact attributes** → *External* `existing` = `patient` → route to the patient queue instead of the new-patient queue.
4. **Check hours of operation** → in hours: continue. Out of hours: play the after-hours line, then go to step 5 anyway. Texting works around the clock.
5. **Get customer input**: the *press 1 to text* line (section 6). Wait 4 s.
   - **Pressed 1** → **Invoke AWS Lambda function** with parameter `action = sendText`, then **Check contact attributes** → External `textSent` equals `true`:
     - true → play *"We just sent you a text…"*, then **Disconnect**.
     - false (landline, or the text failed) → play *"We couldn't text this number, so please stay on the line…"*, then continue to step 6.
   - No input / timeout → step 6.
6. **Set working queue** (new patients) → **Transfer to queue**. On **queue full or error**, invoke the Lambda with `outcome = voicemail` and send the call to voicemail, or play "we'll call you back" (the lead is already logged).

Optional, with an AI agent (Amazon Lex or Amazon Q in Connect):
- Before the transfer, let the bot ask for the caller's name, the accident date and how they heard about you, and save them as contact attributes `name`, `accidentDate` (YYYY-MM-DD) and `howHeard`.
- Then invoke the Lambda again. The lead fills in on its own.
- `howHeard` must match one of the answers in /_admin → Leads (e.g. `Google search`, `Facebook / Instagram ad`, `Attorney referral`, `Urgent care referral`).
- Pass the bot's short summary as parameter `summary`. It's saved as a note on the lead.

## 4. Inbound text flow (the texting number)

Create a second flow of type **Contact flow (inbound)** and assign the texting number to it:

1. **Set logging behavior** → enabled.
2. **Invoke AWS Lambda function** → `ti-connect-leads` (no parameters). The reply joins the caller's lead, or a new **text** lead is made for someone who found the number on the website.
3. AI agent (optional): **Get customer input** with a Lex bot that asks for the name, accident date and preferred visit time, then invoke the Lambda with `summary`.
4. **Set working queue** → **Transfer to queue**. The front desk answers in the Connect agent workspace (the chat window), which works for texts.

## 5. Text-number registration answers (10DLC campaign / toll-free verification)

- **Use case:** Customer care / Account notifications. Healthcare practice scheduling.
- **Description:** "Therapy & Injury, a chiropractic and rehabilitation clinic in Ocala, FL, texts with people who ask us to: callers who press 1 on our phone line to continue by text, and people who text us first from our website. Messages are appointment scheduling and visit logistics only. No marketing."
- **Opt-in (how people agree):** "Callers to (844) 848-7328 hear: 'To continue by text message, press 1. Message and data rates may apply. Reply STOP anytime to opt out.' Pressing 1 sends one confirmation text, and the conversation continues only if they reply. Website visitors start the conversation themselves by tapping 'Text us' (therapyandinjury.com). The opt-out notice is shown next to the button."
- **Sample messages:**
  1. "Therapy & Injury (844-84-TREAT) here. You asked to continue by text. Reply with your name and the date of your accident and we will get you scheduled. Reply STOP to opt out."
  2. "Thanks, Maria. We have Tuesday at 10:00 am or 2:30 pm open at 2649 W Silver Springs Blvd. Which works for you?"
- **Opt-out:** STOP (automatic). **Help:** HELP → "Call 844-84-TREAT for help. Reply STOP to opt out."
- **Volume:** under 2,000 messages/month to start.
- Privacy policy URL: https://therapyandinjury.com/privacy/

## 6. Prompt scripts

Have a native speaker read the Spanish and Creole lines before you record them.

| | English | Español | Kreyòl |
|---|---|---|---|
| Greeting + language | "Thanks for calling Therapy & Injury. Para español, oprima 2. Pou kreyòl, peze 3." | — | — |
| Press 1 to text | "To continue by text message, press 1. We'll text you from our scheduling line. Message and data rates may apply. Reply STOP anytime to opt out. Or stay on the line for our team." | "Para continuar por mensaje de texto, oprima 1. Le escribiremos desde nuestra línea de citas. Pueden aplicar tarifas de mensajes y datos. Responda STOP en cualquier momento para cancelar. O permanezca en la línea." | "Pou kontinye pa mesaj tèks, peze 1. N ap voye tèks ba ou nan liy randevou nou an. Frè mesaj ak done ka aplike. Reponn STOP nenpòt lè pou kanpe. Oswa rete sou liy lan." |
| Text sent | "We just sent you a text. Reply there anytime and we'll get you scheduled. Goodbye." | "Le acabamos de enviar un texto. Responda cuando quiera y le daremos una cita. Adiós." | "Nou fèk voye yon tèks ba ou. Reponn li nenpòt lè, n ap ba w yon randevou. Orevwa." |
| Text failed | "We couldn't text this number, so please stay on the line and we'll help you now." | "No pudimos enviar un texto a este número. Por favor permanezca en la línea y le ayudamos ahora." | "Nou pa t ka voye tèks nan nimewo sa a. Tanpri rete sou liy lan, n ap ede w kounye a." |
| After hours | "Our office is closed right now. Press 1 to continue by text, or leave a message and we'll call you back first thing." | "Nuestra oficina está cerrada. Oprima 1 para continuar por texto, o deje un mensaje y le llamaremos temprano." | "Biwo a fèmen kounye a. Peze 1 pou kontinye pa tèks, oswa kite yon mesaj, n ap rele w byen bonè." |

## 7. On the website

- /_admin → **Content → Site → Texting number**: enter the new number. "Text us" then appears:
  - in the phone banner ("Prefer to text? Text (352) …", with the opt-out note)
  - in the mobile bottom bar, next to Call
  - on the English, Spanish and Creole pages, each with a first message already typed in the visitor's language
- Leave it empty until the number is registered.
- The banner above the number now says **Call now** instead of "Call or text", so nobody texts 844-84-TREAT after the port.
- **Reports** has new **Text** (text leads) and **Text taps** (taps on Text buttons) columns. Calls from blocked caller IDs are counted but can't become leads.

## 8. Privacy rules for texts

- Texts aren't encrypted. Use them for scheduling and logistics only, never for diagnoses, records or insurance details.
- Add a line to the intake paperwork saying the patient agrees to appointment texts, and that texts are not secure.
- Texting under "press 1" consent is for that conversation. Promotional texts need separate written consent.
