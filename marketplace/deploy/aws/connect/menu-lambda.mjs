// Amazon Connect → this Lambda → https://coverageoncall.com/api/connect/menu
// Runtime: Node.js 20.x (no dependencies). Environment variables:
//   SITE_URL                https://coverageoncall.com   (or https://dev.coverageoncall.com to test)
//   CONNECT_WEBHOOK_SECRET  the same long random value set on the site (cPanel → Setup Node.js App)
// In the contact flow, "Invoke AWS Lambda function" passes these parameters:
//   action  lookup | text | callback
//   choice  same | other            (text / callback only)
//   digits  $.StoredCustomerInput   (only when choice = other)
// It returns flat values the flow reads as $.External.result / say / lastFour / canText.
import { createHmac } from "node:crypto";

export const handler = async (event) => {
  const p = event?.Details?.Parameters ?? {};
  const contact = event?.Details?.ContactData ?? {};
  const body = JSON.stringify({
    action: p.action,
    contactId: contact.InitialContactId || contact.ContactId,
    callerPhone: contact.CustomerEndpoint?.Address ?? null,
    choice: p.choice === "other" ? "other" : "same",
    digits: p.digits ?? null,
  });
  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = createHmac("sha256", process.env.CONNECT_WEBHOOK_SECRET).update(`${ts}.${body}`).digest("hex");
  try {
    const res = await fetch(`${process.env.SITE_URL.replace(/\/$/, "")}/api/connect/menu`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-cm-timestamp": ts, "x-cm-signature": sig },
      body,
      signal: AbortSignal.timeout(6000),
    });
    const j = await res.json();
    return { result: String(j.result ?? "stay"), say: String(j.say ?? ""), lastFour: String(j.lastFour ?? ""), canText: String(j.canText ?? "yes") };
  } catch {
    return { result: "stay", say: "Sorry, something went wrong on our side. Let's continue on the call.", lastFour: "", canText: "no" };
  }
};
