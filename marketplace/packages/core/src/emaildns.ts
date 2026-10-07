/**
 * Email deliverability check (Admin → Settings): does the sending domain have the DNS records inbox
 * providers look for? Pure rules over looked-up records; services/emaildns.ts does the lookups.
 * SendGrid "domain authentication" adds two DKIM CNAMEs (s1/s2._domainkey) and a return-path CNAME,
 * which also takes care of SPF alignment for SendGrid; the root SPF record covers the mailbox host.
 */

export interface EmailDnsFacts {
  domain: string;
  /** TXT records at the domain (each joined). */
  rootTxt: string[];
  /** TXT records at _dmarc.<domain>. */
  dmarcTxt: string[];
  /** CNAME targets of s1._domainkey / s2._domainkey (null = none). */
  dkim: { s1: string | null; s2: string | null };
  mx: string[];
}

export type CheckState = "ok" | "warn" | "fail";
export interface EmailDnsCheck {
  key: "spf" | "dkim" | "dmarc" | "mx";
  label: string;
  state: CheckState;
  found: string | null;
  fix: string | null;
}

export function emailDnsReport(f: EmailDnsFacts, opts: { reportEmail: string }): EmailDnsCheck[] {
  const d = f.domain;
  const out: EmailDnsCheck[] = [];

  const spf = f.rootTxt.filter((t) => /^v=spf1\b/i.test(t.trim()));
  if (!spf.length) {
    out.push({ key: "spf", label: "SPF (who may send for the domain)", state: "fail", found: null, fix: `Add a TXT record at ${d} (host "@"): v=spf1 include:sendgrid.net ~all — plus your mailbox host's include if mail is sent from it too (e.g. include:spf.web-hosting.com for Namecheap, include:_spf.google.com for Google Workspace).` });
  } else if (spf.length > 1) {
    out.push({ key: "spf", label: "SPF (who may send for the domain)", state: "fail", found: spf.join(" | "), fix: "There are several SPF records; inbox providers then ignore all of them. Merge them into one TXT record with every include: in it, ending in ~all." });
  } else if (/\+all\b/.test(spf[0])) {
    out.push({ key: "spf", label: "SPF (who may send for the domain)", state: "fail", found: spf[0], fix: "+all lets anyone send as your domain. End the record with ~all instead." });
  } else {
    const sendgrid = /include:sendgrid\.net/i.test(spf[0]);
    out.push({ key: "spf", label: "SPF (who may send for the domain)", state: sendgrid || f.dkim.s1 ? "ok" : "warn", found: spf[0], fix: sendgrid || f.dkim.s1 ? null : "Add include:sendgrid.net to this record (or finish SendGrid domain authentication), so SendGrid's mail passes SPF." });
  }

  const dkimOk = !!f.dkim.s1 && !!f.dkim.s2 && /sendgrid\.net\.?$/i.test(f.dkim.s1) && /sendgrid\.net\.?$/i.test(f.dkim.s2);
  out.push({
    key: "dkim",
    label: "DKIM (SendGrid signature)",
    state: dkimOk ? "ok" : "fail",
    found: [f.dkim.s1, f.dkim.s2].filter(Boolean).join(" | ") || null,
    fix: dkimOk ? null : `In SendGrid → Settings → Sender Authentication → Authenticate Your Domain, enter ${d}; it gives 3 CNAME records (s1._domainkey, s2._domainkey and an em#### return path). Add them in your DNS (cPanel → Zone Editor), then press Verify in SendGrid.`,
  });

  const dmarc = f.dmarcTxt.find((t) => /^v=DMARC1\b/i.test(t.trim())) ?? null;
  const rec = `v=DMARC1; p=none; rua=mailto:${opts.reportEmail}; adkim=r; aspf=r`;
  if (!dmarc) {
    out.push({ key: "dmarc", label: "DMARC (policy for mail that fails the checks)", state: "fail", found: null, fix: `Add a TXT record at _dmarc.${d}: ${rec} — Gmail and Yahoo require DMARC for bulk senders. After 2–4 weeks of clean reports, change p=none to p=quarantine.` });
  } else {
    const policy = /\bp=(none|quarantine|reject)\b/i.exec(dmarc)?.[1]?.toLowerCase() ?? null;
    out.push({ key: "dmarc", label: "DMARC (policy for mail that fails the checks)", state: policy === "none" || !policy ? "warn" : "ok", found: dmarc, fix: policy === "none" ? "Fine to start with. Once the reports show your mail passing (2–4 weeks), change p=none to p=quarantine." : policy ? null : "The record has no p= policy; add p=none to start." });
  }

  out.push({
    key: "mx",
    label: "MX (where replies to your addresses are delivered)",
    state: f.mx.length ? "ok" : "fail",
    found: f.mx.join(", ") || null,
    fix: f.mx.length ? null : `No mail server for ${d}: replies to support@ and info@ would bounce. Add MX records from your mailbox host (cPanel email or Google Workspace).`,
  });
  return out;
}
