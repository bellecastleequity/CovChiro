# Phone line on Amazon Connect: call menu (continue by text, or a callback)

Owner decisions (Oct 2026): **(855) 55-COVER is calls only** (a number ported into Amazon Connect gets voice, never texting). Every text comes from the separate **AWS texting number** (`AWS_SMS_ORIGINATION`, see `docs/aws-sms-setup.md`). Callers can press **1 to continue by text** or **2 for a callback**; nothing transfers a call to a person. The AI agent (on hold) slots in later where this menu says "stay on the line".

What the site already does: `/api/connect/menu` (signed, below) checks the number, skips anyone who texted STOP, limits it to 3 texts per number per day, sends the first text from the texting number, and logs everything in **Admin → Calls** (callback badge). Replies to the text land in **Admin → Texts** as usual.

## 1. Before the port finishes
- Get the AWS texting number working first (`docs/aws-sms-setup.md`, toll-free verification takes weeks).
- Ask AWS to continue porting (855) 552-6837 into Amazon Connect **for voice**. Until it's done, it stays at NumberBarn forwarding to your cell. You can test everything below on a temporary Connect number (Channels → Phone numbers → Claim a number) and move the flow onto 55-COVER the day the port completes.

## 2. The shared secret
1. Make a long random value (e.g. 40+ letters and digits from a password manager).
2. cPanel → Setup Node.js App → coverageoncall.com → add environment variable `CONNECT_WEBHOOK_SECRET` = that value → Stop App, Start App. (Dev: the same on dev.coverageoncall.com, with its own value.)
3. Without it, `/api/connect/menu` answers "not configured" and the flow falls back to "stay on the line".

## 3. The Lambda function
1. AWS console → Lambda → Create function → **Author from scratch**, name `coverageoncall-call-menu`, runtime **Node.js 20.x**.
2. Paste `deploy/aws/connect/menu-lambda.mjs` into `index.mjs` → Deploy.
3. Configuration → Environment variables: `SITE_URL` = `https://coverageoncall.com`, `CONNECT_WEBHOOK_SECRET` = the value from step 2.
4. Configuration → General: timeout **8 seconds**.
5. Amazon Connect console → your instance → **Flows → AWS Lambda** → add `coverageoncall-call-menu`.

## 4. The contact flow (Routing → Flows → Create flow, name "Main line")
Use one voice throughout (**Set voice**: a Neural voice, e.g. Joanna). Each "Invoke Lambda" block: function `coverageoncall-call-menu`, **Response validation: STRING_MAP**, the parameters listed.

1. **Set logging behavior**: on.
2. **Invoke AWS Lambda function** "Lookup": parameter `action` = `lookup`. (Gives `$.External.lastFour` and `$.External.canText`.)
3. **Play prompt**: "Thanks for calling Coverage On Call."
4. **Get customer input** (DTMF, timeout 5 s): "If you'd rather continue by text, press 1. For a call back from our team, press 2." Conditions **1** → *Text*, **2** → *Callback*. Timeout / default → *Callback* (until the AI agent is added there).

*Text* (and *Callback* the same, with `action` = `callback` and prompts about a call back):

5. **Check contact attributes**: `$.External.lastFour` is empty → go to step 8 (no caller ID).
6. **Get customer input** (DTMF): "Should we text the number you're calling from, ending in $.External.lastFour? Press 1 for yes, or 2 to enter a different number." **1** → step 7, **2** → step 8.
7. **Invoke Lambda** `action` = `text`, `choice` = `same` → step 10.
8. **Store customer input**: "Please enter the 10-digit mobile number to use, then press pound." Max digits 10, end with #, timeout 10 s.
9. **Invoke Lambda** `action` = `text`, `choice` = `other`, `digits` = `$.StoredCustomerInput` (set dynamically).
10. **Check contact attributes** `$.External.result`:
    - `done` → **Play prompt** `$.External.say` (text-to-speech, dynamic) → **Disconnect**.
    - `retry` → **Play prompt** `$.External.say` → **Loop** (2 times) back to step 8; after that → "Sorry, we couldn't use that number." → *Callback* or Disconnect.
    - `stay` → **Play prompt** `$.External.say` → *Callback* (or the AI agent later).
11. Any Lambda error branch → **Play prompt** "Sorry, something went wrong. Please call back in a few minutes." → **Disconnect**.

Publish, then **Channels → Phone numbers** → the number → Flow: **Main line**.

## 5. Test
1. Call the number from your cell, press 1, press 1: you get the text from the texting number within seconds, and **Admin → Calls** shows "Texted". Reply to it: it lands in **Admin → Texts**.
2. Call again, press 2, confirm: **Admin → Calls** shows "Wants a callback" with the badge; tap **Called back** when done.
3. Text STOP to the texting number, call, press 1: the call says the number has opted out and nothing is sent.

## Settings (Admin → Settings → Help & support)
- `phone.textHandoff`: callers can press 1 to continue by text (on). Off = the call says texting isn't available.
- `phone.handoffText`: the first text ({brand}, {callLine} filled in; keep "Reply STOP to opt out").
- `phone.handoffPerDay`: most continue-by-text texts to one number per day (3).

Pressing 1 is the caller's request for that one conversation (logged with time and number in Admin → Calls). It isn't marketing consent; nothing else is texted to them because of it.
