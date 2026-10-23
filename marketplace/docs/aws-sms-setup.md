# Texting with AWS: setup steps

The site sends shift offers, reminders, verification codes and urgent alerts by text through **AWS End User Messaging SMS**. Providers can answer offers by text ("YES 4821"), and STOP / HELP work automatically. Until the steps below are done, the site stays in email-only mode: everything still goes out by email and in the app.

Do these in the AWS console. Never paste keys into chat; they only go into cPanel's environment variables.

Allow about 30 minutes of clicking, then a wait of days to about two weeks for AWS and the carriers to approve the number.

## 1. Account and region

1. Create the AWS account, or sign in, and add a payment card.
2. Top-right region menu: choose **US East (N. Virginia) us-east-1**. Use this same region for everything below.

## 2. Get a toll-free number

1. Open **AWS End User Messaging SMS** (search "End User Messaging").
2. **Phone numbers → Request originator.**
3. Country **United States**, number type **Toll-free**, capabilities **SMS**, message type **Transactional**.
4. Two-way SMS: **on** (you'll point it at the SNS topic in step 5).

## 3. Register the number (toll-free verification)

US carriers block texts from unregistered numbers. Open **Registrations → Create registration → US toll-free number registration**, then attach it to the number from step 2. Use these answers:

- **Company:** your legal business name, address, website `https://coverageoncall.com`.
- **Use case:** "Account notifications and shift alerts for licensed healthcare providers and clinics who signed up on our platform: shift offers they can accept by replying YES/NO with a code, booking confirmations and reminders, one-time verification codes, and urgent coverage alerts."
- **How people opt in:** "Providers enter their mobile number and tick a consent box on the On Call page (coverageoncall.com/provider/oncall) after creating an account, then confirm the number with a code we text them. Clinic users opt in in their account settings. The consent text names the message types, says message frequency varies and message/data rates may apply, and links our Privacy Policy (coverageoncall.com/privacy) and Terms (coverageoncall.com/terms)."
- **Sample messages:**
  - "CoverageOnCall: your verification code is 482913. Msg & data rates may apply. Reply STOP to opt out."
  - "CoverageOnCall: Shift offer Tue 9am–5pm in Orlando, $420. Reply YES 4821 to accept or NO 4821 to pass."
  - "CoverageOnCall: Reminder: your shift at Sunrise Chiropractic starts tomorrow at 9:00 AM."
- **Monthly volume:** your best estimate (for example 1,000).

Then wait for approval. AWS emails you, and the registration shows **Complete**.

## 4. Leave the sandbox and raise the spending limit

New accounts can only text numbers you've verified, and only up to $1 a month.

1. **Account settings → Request production access.** Same use case as above.
2. Request a **spend limit increase** for SMS. Something like $25 a month is plenty to start.
3. While you wait, you can test: **Destination phone numbers → Add**, and verify your own mobile.

## 5. Replies and delivery results (SNS)

1. Open **Amazon SNS → Topics → Create topic**. Type **Standard**, name `coverageoncall-sms`. Copy its **ARN**: `arn:aws:sns:us-east-1:…:coverageoncall-sms`.
2. Go back to **End User Messaging SMS → Phone numbers → your number → Two-way SMS**. Turn it on and set destination **Amazon SNS**, the topic above.
3. **Configuration sets → Create**, named `coverageoncall`. Add an **event destination**: Amazon SNS, the same topic, with all **text** events.
4. **Keywords** on the number: set the HELP reply to "CoverageOnCall: shift alerts and account texts. Help: call or text (855) 55-COVER or email support@coverageoncall.com. Reply STOP to opt out." STOP is handled by AWS automatically.

## 6. A key that can only send texts

1. Open **IAM → Users → Create user** `coverageoncall-sms`, with no console access.
2. **Add permissions → Create inline policy → JSON**:

```json
{
  "Version": "2012-10-17",
  "Statement": [{ "Effect": "Allow", "Action": "sms-voice:SendTextMessage", "Resource": "*" }]
}
```

3. **Security credentials → Create access key → Application running outside AWS.** Copy the Access key ID (starts with AKIA) and the Secret.

## 7. Put it into the site

Go to cPanel → **Setup Node.js App** → coverageoncall.com → **Environment variables**:

| Name | Value |
|---|---|
| `AWS_SMS_ACCESS_KEY_ID` | the AKIA… key |
| `AWS_SMS_SECRET_ACCESS_KEY` | the secret |
| `AWS_SMS_REGION` | `us-east-1` |
| `AWS_SMS_ORIGINATION` | your AWS texting number (a toll-free number bought in AWS End User Messaging; not the (855) 55-COVER calling line) |
| `AWS_SMS_CONFIGURATION_SET` | `coverageoncall` |
| `AWS_SMS_SNS_TOPIC_ARNS` | the topic ARN from step 5 |

Then **Stop App** and **Start App**.

## 8. Connect the replies, then test

1. **SNS → your topic → Create subscription.** Protocol **HTTPS**, endpoint `https://coverageoncall.com/api/webhooks/aws-sms`. The site confirms it by itself within a few seconds, and the status turns **Confirmed**.
2. Open **Admin → Settings → Checks & connections → Text message check** and send a test to your phone. It shows "Delivered" or explains the problem in plain words.
3. Verify your own number on the provider **On Call** page and reply **HELP**. You should get the HELP text back.

## The test site (dev.coverageoncall.com)

Leave the AWS keys off on dev. Its texts are already captured in **Admin → Test site → Outbox**. To really deliver to a few phones from dev, add the same keys there, plus `SANDBOX_SMS_ALLOW` with those numbers.

## Twilio

Twilio is still supported. If both services are configured, AWS is used unless `SMS_PROVIDER=twilio` is set.

## The business number: (855) 55-COVER

- **Calls only (owner decision, Oct 2026).** The vanity number is a calling line: it shows with a Call button in the site footer, on Contact, on the help pages and "Need help now?", and at the bottom of every email ("Call (855) 55-COVER"). It's never offered for texting anywhere (no Text button, no "call or text"). Set it in Admin → Settings → Help & support (`site.phone`, `site.phoneLabel`); leave `site.phone` blank to hide it everywhere.
- **Why:** a toll-free number ported into Amazon Connect gets voice only (AWS, Oct 23 2026), and people reply to the number that texted them anyway.
- **Texts** come only from the AWS End User Messaging texting number (`AWS_SMS_ORIGINATION`): shift offers, reminders, alerts and our replies. Replies to those texts land on that number: YES/NO + code and STOP/HELP/START are handled automatically, everything else goes to **Admin → Texts**. Use a separate AWS toll-free texting number for this (start its toll-free verification early; it takes a few weeks).
- **Calls** go wherever the number's voice service sends them: forwarded to a cell while it's at NumberBarn, later Amazon Connect (the AI phone agent, on hold).
