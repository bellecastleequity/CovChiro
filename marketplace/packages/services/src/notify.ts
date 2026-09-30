import { brand, env } from "@cm/config";
import { mailProvider, smsProvider } from "@cm/integrations";
import type { Db } from "./context";

/**
 * In-app + email (+ SMS) notifications. Brand name/domain come from config
 * (Addendum 01 §12) — nothing brand-specific is hard-coded here.
 */

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function absoluteUrl(path: string): string {
  return path.startsWith("http") ? path : `${env().APP_BASE_URL.replace(/\/$/, "")}${path}`;
}

export interface EmailContent {
  subject: string;
  heading: string;
  paragraphs: string[];
  cta?: { label: string; url: string };
  /** Boxed list entries (e.g. one per booking), each with its own buttons. */
  items?: { title: string; lines: string[]; links: { label: string; url: string }[] }[];
  footerNote?: string;
  unsubscribeUrl?: string;
}

export function renderEmail(c: EmailContent): { html: string; text: string } {
  const b = brand();
  const cta = c.cta
    ? `<tr><td style="padding:8px 0 24px"><a href="${esc(absoluteUrl(c.cta.url))}" style="display:inline-block;background:#282472;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:10px">${esc(c.cta.label)}</a></td></tr>`
    : "";
  const html = `<!doctype html><html><body style="margin:0;background:#f4f6f8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;padding:28px">
<tr><td style="padding-bottom:18px"><img src="${esc(absoluteUrl("/brand/mark-email.png"))}" width="28" height="28" alt="" style="vertical-align:middle;border:0"> <span style="vertical-align:middle;font-weight:700;font-size:17px;color:#282472">${esc(b.name)}</span></td></tr>
<tr><td style="font-size:22px;font-weight:700;padding-bottom:12px">${esc(c.heading)}</td></tr>
${c.paragraphs.map((p) => `<tr><td style="font-size:15px;line-height:1.6;color:#334155;padding-bottom:12px">${esc(p)}</td></tr>`).join("")}
${(c.items ?? [])
  .map(
    (it) => `<tr><td style="padding-bottom:12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px"><tr><td style="padding:14px 16px">
<div style="font-size:16px;font-weight:700;color:#0f172a">${esc(it.title)}</div>
${it.lines.map((l) => `<div style="font-size:14px;line-height:1.5;color:#475569;margin-top:2px">${esc(l)}</div>`).join("")}
<div style="margin-top:10px">${it.links
      .map((l, i) => `<a href="${esc(absoluteUrl(l.url))}" style="display:inline-block;margin:0 6px 6px 0;padding:8px 14px;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none;${i === 0 ? "background:#282472;color:#ffffff" : "background:#ffffff;color:#282472;border:1px solid #cbd5e1"}">${esc(l.label)}</a>`)
      .join("")}</div>
</td></tr></table></td></tr>`,
  )
  .join("")}
${cta}
<tr><td style="font-size:12px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:14px">${esc(c.footerNote ?? `${b.name} · ${b.domain} · Questions? ${b.supportEmail}`)}${
    c.unsubscribeUrl ? ` · <a href="${esc(c.unsubscribeUrl)}" style="color:#94a3b8">Unsubscribe</a>` : ""
  }</td></tr>
</table></td></tr></table></body></html>`;
  const items = (c.items ?? []).flatMap((it) => ["", it.title, ...it.lines, ...it.links.map((l) => `${l.label}: ${absoluteUrl(l.url)}`)]);
  const text = [c.heading, "", ...c.paragraphs, ...items, ...(c.cta ? ["", `${c.cta.label}: ${absoluteUrl(c.cta.url)}`] : []), "", `${b.name} · ${b.domain}`, ...(c.unsubscribeUrl ? [`Unsubscribe: ${c.unsubscribeUrl}`] : [])].join("\n");
  return { html, text };
}

export async function sendEmail(to: string, c: EmailContent): Promise<boolean> {
  const { html, text } = renderEmail(c);
  try {
    return await mailProvider().send({ to, subject: c.subject, html, text, unsubscribeUrl: c.unsubscribeUrl });
  } catch (e) {
    console.error("email send failed", e);
    return false;
  }
}

export interface NotifyInput {
  template: string;
  title: string;
  body: string;
  link?: string;
  email?: boolean;
  sms?: boolean;
  /** Extra paragraphs for the email body. */
  details?: string[];
  ctaLabel?: string;
}

/** Writes the in-app notification, then sends email/SMS best-effort (never throws). */
export async function notify(db: Db, userId: string, n: NotifyInput) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return;
  const row = await db.notification.create({
    data: { userId, channel: "in_app", template: n.template, title: n.title, body: n.body, link: n.link ?? null, payload: {} },
  });
  const sent: string[] = [];
  if (n.email !== false) {
    const ok = await sendEmail(user.email, {
      subject: n.title,
      heading: n.title,
      paragraphs: [n.body, ...(n.details ?? [])],
      cta: n.link ? { label: n.ctaLabel ?? "Open", url: n.link } : undefined,
    });
    if (ok) sent.push("email");
  }
  if (n.sms && user.phone && user.phoneVerifiedAt) {
    const ok = await smsProvider()
      .send(user.phone, `${brand().name}: ${n.title}${n.link ? ` ${absoluteUrl(n.link)}` : ""}`)
      .catch(() => false);
    if (ok) sent.push("sms");
  }
  if (sent.length) await db.notification.update({ where: { id: row.id }, data: { sentAt: new Date(), payload: { sent } } });
}

export async function notifyClinic(db: Db, clinicOrgId: string, n: NotifyInput) {
  const members = await db.clinicMember.findMany({ where: { clinicOrgId } });
  for (const m of members) await notify(db, m.userId, n);
}

export async function notifyAdmins(db: Db, n: NotifyInput) {
  const admins = await db.user.findMany({ where: { role: "PLATFORM_ADMIN", disabledAt: null } });
  for (const a of admins) await notify(db, a.id, n);
}
