import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import { brand, env } from "@cm/config";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** For List-Unsubscribe on marketing mail. */
  unsubscribeUrl?: string;
}

export interface Mailer {
  name: string;
  send(m: EmailMessage): Promise<boolean>;
}

export interface Texter {
  name: string;
  send(to: string, body: string): Promise<boolean>;
}

/** Sent mail/SMS in dev is appended to .uploads/outbox.log and kept in memory for tests. */
export const devOutbox: { channel: "email" | "sms"; to: string; subject?: string; body: string; at: Date }[] = [];

async function devLog(line: string) {
  try {
    const dir = path.resolve(env().UPLOAD_DIR);
    await mkdir(dir, { recursive: true });
    await appendFile(path.join(dir, "outbox.log"), line + "\n");
  } catch {
    /* best effort */
  }
}

class SendGridMailer implements Mailer {
  name = "sendgrid";
  constructor(private key: string) {}
  async send(m: EmailMessage) {
    const from = brand().emailFrom;
    const match = from.match(/^(.*)<(.+)>$/);
    const r = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: m.to }] }],
        from: match ? { email: match[2].trim(), name: match[1].trim() } : { email: from },
        subject: m.subject,
        content: [
          { type: "text/plain", value: m.text },
          { type: "text/html", value: m.html },
        ],
        // One-click unsubscribe goes to the POST endpoint; the visible link goes to the confirm page.
        ...(m.unsubscribeUrl ? { headers: { "List-Unsubscribe": `<${m.unsubscribeUrl.replace("/unsubscribe?", "/api/unsubscribe?")}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } } : {}),
      }),
    });
    return r.status >= 200 && r.status < 300;
  }
}

class DevMailer implements Mailer {
  name = "dev";
  async send(m: EmailMessage) {
    devOutbox.push({ channel: "email", to: m.to, subject: m.subject, body: m.text, at: new Date() });
    if (env().NODE_ENV !== "test") console.log(`[email] to=${m.to} subject="${m.subject}"`);
    await devLog(`[${new Date().toISOString()}] EMAIL to=${m.to} subject="${m.subject}"\n${m.text}\n---`);
    return true;
  }
}

class TwilioTexter implements Texter {
  name = "twilio";
  constructor(private sid: string, private token: string, private service: string) {}
  async send(to: string, body: string) {
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${this.sid}/Messages.json`, {
      method: "POST",
      headers: { Authorization: "Basic " + Buffer.from(`${this.sid}:${this.token}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: to, MessagingServiceSid: this.service, Body: body }),
    });
    return r.status >= 200 && r.status < 300;
  }
}

class DevTexter implements Texter {
  name = "dev";
  async send(to: string, body: string) {
    devOutbox.push({ channel: "sms", to, body, at: new Date() });
    if (env().NODE_ENV !== "test") console.log(`[sms] to=${to} ${body}`);
    await devLog(`[${new Date().toISOString()}] SMS to=${to}\n${body}\n---`);
    return true;
  }
}

let mailer: Mailer | null = null;
let texter: Texter | null = null;
export function mailProvider(): Mailer {
  if (!mailer) mailer = env().SENDGRID_API_KEY ? new SendGridMailer(env().SENDGRID_API_KEY!) : new DevMailer();
  return mailer;
}
export function smsProvider(): Texter {
  if (!texter) {
    const e = env();
    texter = e.TWILIO_ACCOUNT_SID && e.TWILIO_AUTH_TOKEN && e.TWILIO_MESSAGING_SERVICE_SID
      ? new TwilioTexter(e.TWILIO_ACCOUNT_SID, e.TWILIO_AUTH_TOKEN, e.TWILIO_MESSAGING_SERVICE_SID)
      : new DevTexter();
  }
  return texter;
}
