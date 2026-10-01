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
  /** Why the last send failed, in the email service's own words. */
  lastError?: string | null;
}

export interface Texter {
  name: string;
  send(to: string, body: string): Promise<boolean>;
  /** Why the last send failed, in the SMS service's own words (with its error code). */
  lastError?: string | null;
  lastErrorCode?: number | null;
  /** Twilio message SID of the last accepted send. */
  lastId?: string | null;
  /** Delivery status of a sent message (Twilio accepts first, then delivers or fails). */
  status?(id: string): Promise<{ status: string; errorCode: number | null; errorMessage: string | null } | null>;
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
  lastError: string | null = null;
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
    if (r.status >= 200 && r.status < 300) {
      this.lastError = null;
      return true;
    }
    // e.g. 403 "The from address does not match a verified Sender Identity".
    const body = await r.text().catch(() => "");
    let detail = body.slice(0, 300);
    try {
      detail = (JSON.parse(body) as { errors?: { message: string }[] }).errors?.map((e) => e.message).join("; ") || detail;
    } catch {
      /* not JSON */
    }
    this.lastError = `SendGrid ${r.status}: ${detail} (from ${from})`;
    console.error(`[email] ${this.lastError}`);
    return false;
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
  lastError: string | null = null;
  lastErrorCode: number | null = null;
  lastId: string | null = null;
  constructor(private sid: string, private token: string, private service: string) {}
  private auth() {
    return "Basic " + Buffer.from(`${this.sid}:${this.token}`).toString("base64");
  }
  async send(to: string, body: string) {
    this.lastError = null;
    this.lastErrorCode = null;
    this.lastId = null;
    try {
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${this.sid}/Messages.json`, {
        method: "POST",
        headers: { Authorization: this.auth(), "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ To: to, MessagingServiceSid: this.service, Body: body }),
        signal: AbortSignal.timeout(15000),
      });
      const j = (await r.json().catch(() => ({}))) as { sid?: string; code?: number; message?: string };
      if (r.status >= 200 && r.status < 300) {
        this.lastId = j.sid ?? null;
        return true;
      }
      this.lastErrorCode = j.code ?? null;
      this.lastError = `Twilio ${r.status}${j.code ? ` (error ${j.code})` : ""}: ${j.message ?? "request rejected"}`;
    } catch (e) {
      this.lastError = `Couldn't reach Twilio: ${(e as Error).message}`;
    }
    console.error(`[sms] to=${to.slice(0, -4)}**** ${this.lastError}`);
    return false;
  }
  async status(id: string) {
    try {
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${this.sid}/Messages/${id}.json`, { headers: { Authorization: this.auth() }, signal: AbortSignal.timeout(10000) });
      if (!r.ok) return null;
      const j = (await r.json()) as { status: string; error_code: number | null; error_message: string | null };
      return { status: j.status, errorCode: j.error_code, errorMessage: j.error_message };
    } catch {
      return null;
    }
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

/** Twilio error codes people actually hit, in plain words with the fix. */
export const TWILIO_ERROR_HELP: Record<number, string> = {
  20003: "Twilio rejected the Account SID / Auth Token. Copy both again from the Twilio Console home page (the SID starts with AC).",
  20404: "Twilio couldn't find that account or messaging service. Check TWILIO_ACCOUNT_SID and TWILIO_MESSAGING_SERVICE_SID (starts with MG).",
  21211: "That isn't a valid phone number.",
  21408: "Your Twilio account isn't allowed to text this country. Enable it under Messaging → Settings → Geo permissions.",
  21608: "Your Twilio account is still a trial: it can only text numbers you've verified in Twilio. Upgrade the account, or add this number under Phone Numbers → Verified Caller IDs.",
  21610: "This number replied STOP to your Twilio number. They need to text START to it to receive texts again.",
  21612: "Twilio can't send from your sender to this number.",
  21614: "That number isn't a mobile number (it can't receive texts).",
  21703: "The Messaging Service has no sender. In Twilio: Messaging → Services → your service → Sender Pool → add your phone number.",
  21704: "The Messaging Service has no sender. In Twilio: Messaging → Services → your service → Sender Pool → add your phone number.",
  30003: "The phone is off or unreachable right now.",
  30005: "The carrier says this number doesn't exist.",
  30006: "That's a landline or a number that can't receive texts.",
  30007: "The carrier filtered the text as spam. Usually this means your number isn't fully registered (A2P 10DLC or toll-free verification).",
  30032: "Your toll-free number isn't verified yet. In Twilio: Phone Numbers → your toll-free number → Verification. Texts are blocked until it's approved.",
  30034: "Your 10-digit number isn't registered for A2P 10DLC. US carriers now block texts from unregistered numbers. In Twilio: Messaging → Regulatory Compliance → A2P 10DLC — register your brand and a campaign, then add the number to that campaign's Messaging Service.",
};

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
