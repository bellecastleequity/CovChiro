import { promises as dns } from "node:dns";
import { brand, env } from "@cm/config";
import { emailDnsReport } from "@cm/core";
import { getSettings, requireAdmin, type Actor } from "./context";

/** The domain mail is sent from (EMAIL_FROM), else the brand domain. */
export function sendingDomain() {
  const from = env().EMAIL_FROM ?? "";
  const m = /@([A-Za-z0-9.-]+)/.exec(from);
  return (m?.[1] ?? brand().domain).toLowerCase();
}

const txt = (name: string) => dns.resolveTxt(name).then((r) => r.map((parts) => parts.join("")), () => [] as string[]);
const cname = (name: string) => dns.resolveCname(name).then((r) => r[0] ?? null, () => null);

/** Admin → Settings → Email deliverability check: looks up the records from the server and says what's missing. */
export async function emailDnsCheck(actor: Actor) {
  requireAdmin(actor);
  const domain = sendingDomain();
  const [rootTxt, dmarcTxt, s1, s2, mx] = await Promise.all([
    txt(domain),
    txt(`_dmarc.${domain}`),
    cname(`s1._domainkey.${domain}`),
    cname(`s2._domainkey.${domain}`),
    dns.resolveMx(domain).then((r) => r.sort((a, b) => a.priority - b.priority).map((x) => x.exchange), () => [] as string[]),
  ]);
  const s = await getSettings();
  return { domain, checks: emailDnsReport({ domain, rootTxt, dmarcTxt, dkim: { s1, s2 }, mx }, { reportEmail: s["email.adminInbox"] }) };
}
