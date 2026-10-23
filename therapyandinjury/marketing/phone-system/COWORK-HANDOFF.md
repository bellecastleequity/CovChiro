# Handoff for Claude Cowork: set up the Amazon Connect Lambda

**Status as of Oct 23, 2026:**
- Website version 1.0.15 is installed on therapyandinjury.com (owner confirmed).
- 844-84-TREAT is being ported to Amazon Connect, voice only.
- The texting number (AWS End User Messaging SMS) may not be approved yet.

**Goal:**
- Every call and text to the Connect numbers is logged as a lead on the website.
- "Press 1 to continue by text" sends the first text.

**Background:** `README.md` in this folder (sections 2–4). **Code to deploy:** `lambda/index.mjs` (paste it unchanged).

## Ground rules
- Work in the owner's AWS account and the website admin with the owner present. Ask before creating anything that costs money beyond Lambda's free tier.
- **Never paste `SITE_SECRET` or any AWS key into chat, notes, email or a file.** Copy it straight from /_admin into the Lambda console.
- Don't change the number port, the Connect instance settings, or the HIPAA agreement. Those are the owner's decisions.
- Region: use the **same region as the Connect instance**. Check the Connect console and note it below.

## Before you start: check these
- [ ] The owner can sign in to the AWS console and to `https://therapyandinjury.com/_admin`.
- [ ] /_admin → Updates shows **Running version 1.0.15** or later.
- [ ] **AWS Artifact → Agreements:** the AWS Business Associate Addendum is accepted. If not, the owner accepts it before any patient calls go through AWS.
- [ ] The Amazon Connect instance exists. Note its name and region: `________` / `________`
- [ ] Has the texting number been approved in **AWS End User Messaging SMS → Phone numbers**?
  - If yes, note its **Phone number ID**: `________`
  - If not, do every step except the ones marked *(texting number)* and come back to those later.

## Steps

1. **Create the function**
   - AWS console → **Lambda** → **Create function** → *Author from scratch*.
   - Name: `ti-connect-leads`. Runtime: **Node.js 22.x**. Architecture: x86_64. Default execution role.
   - Click **Create function**.
2. **Add the code**
   - Code tab → rename `index.js` to **`index.mjs`**.
   - Replace its contents with `lambda/index.mjs` from this repo.
   - Click **Deploy**.
3. **Timeout:** Configuration → General configuration → Edit → **8 sec** → Save.
4. **Environment variables:** Configuration → Environment variables → Edit.
   - `SITE_EVENT_URL` = the URL shown in /_admin → **Team → Phone system** (click **Show**). It should be `https://therapyandinjury.com/api/connect/event`.
   - `SITE_SECRET` = the secret shown in the same place.
   - `TEXT_FROM` = the texting number's Phone number ID *(texting number)*.
   - Save.
5. **Permission to send texts** *(texting number)*
   - Configuration → Permissions → click the role name.
   - **Add permissions → Create inline policy → JSON**. Paste this, replacing the region, account ID and phone number ID:
     ```json
     { "Version": "2012-10-17", "Statement": [{ "Effect": "Allow", "Action": "sms-voice:SendTextMessage",
       "Resource": "arn:aws:sms-voice:<REGION>:<ACCOUNT_ID>:phone-number/<PHONE_NUMBER_ID>" }] }
     ```
   - Name it `ti-send-press1-text` and create it.
6. **Test the logging:** Test tab → new event → paste `lambda/test-event-call.json` → **Test**.
   - Expected: `"logged": "true"`.
   - `"textSent"` is `"true"` only once the texting number is set up. Otherwise `"false"` is expected.
   - In /_admin → **Leads** (All statuses), a **call** lead from (352) 555-0142 should appear.
   - Then run `lambda/test-event-text.json`. The same lead gets a text entry and a note.
   - **Delete the test lead** afterwards: Details → Delete lead.
   - If `logged` is `"false"`, open **Monitor → View CloudWatch logs**:
     - "HTTP 401 signature" means `SITE_SECRET` doesn't match /_admin. Copy it again.
     - Anything else: check `SITE_EVENT_URL`.
7. **Real text test** *(texting number)*
   - In `test-event-call.json`, change `CustomerEndpoint.Address` to the owner's mobile, e.g. `+1352…`. Run the test.
   - The owner's phone should receive the "Therapy & Injury (844-84-TREAT) here…" text.
   - Delete that test lead too.
8. **Make the function available to Connect:** Amazon Connect console → the instance → **Flows** → **AWS Lambda** → choose `ti-connect-leads` → **Add Lambda Function**.

## After the Lambda: the flows (same session if time allows)
- **Inbound call flow:** build it as in `README.md` section 3 and assign it to 844-84-TREAT once the port is complete.
- **Inbound text flow:** build it as in `README.md` section 4 and assign it to the texting number *(texting number)*.
- **Prompts:**
  - English and Spanish can use Amazon Polly voices.
  - Creole lines need a recorded audio prompt; Polly has no Haitian Creole voice.
  - Scripts are in section 6.
- **Test call:** call 844-84-TREAT from the owner's mobile and press 1.
  - Expect a text, a **call** lead in /_admin → Leads, and (after replying) the same lead with a text entry.
- **Website:** once the texting number is live, enter it in /_admin → **Content → Site → Texting number** and click Save. "Text us" buttons appear on the site.

## Done when
- [ ] Test events log leads (`logged: "true"`) and the test leads are deleted.
- [ ] The press-1 text arrives on the owner's phone *(texting number)*.
- [ ] `ti-connect-leads` is added to the Connect instance.
- [ ] Note anything left open here for the owner:

_____________________________________________
