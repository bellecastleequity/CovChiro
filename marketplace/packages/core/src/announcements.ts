import { looksLikePhi } from "./screening";

/**
 * Admin announcements (mass messages to providers, clinics or everyone). Two kinds:
 *  - NOTICE: about the service or their account (policy, agreement, outage, new feature they need to
 *    know). Goes to everyone in the audience; may also go by text to verified mobiles.
 *  - NEWS: promotional (offers, recruiting pushes, newsletters). Email carries an unsubscribe link and
 *    the postal address (CAN-SPAM); people who unsubscribed are skipped; never by text (texts need
 *    separate marketing consent).
 * In-app is always on; push goes with in-app.
 */

export type AnnouncementKind = "NOTICE" | "NEWS";
export type AnnouncementChannel = "email" | "sms" | "push";

export interface AnnouncementDraft {
  kind: AnnouncementKind;
  title: string;
  body: string;
  channels: AnnouncementChannel[];
  linkPath?: string | null;
}

export function announcementProblems(a: AnnouncementDraft): string[] {
  const out: string[] = [];
  if (a.title.trim().length < 3) out.push("Add a subject line.");
  if (a.title.length > 120) out.push("Keep the subject under 120 characters.");
  if (a.body.trim().length < 10) out.push("Write the message.");
  if (a.body.length > 5000) out.push("Keep the message under 5,000 characters.");
  if (looksLikePhi(`${a.title}\n${a.body}`)) out.push("Remove anything that looks like patient information.");
  if (a.kind === "NEWS" && a.channels.includes("sms")) out.push("Promotional messages can't go by text (that needs separate marketing consent). Send it as an important notice, or untick text.");
  if (a.linkPath && !/^\/[A-Za-z0-9/_\-?=&#.]*$/.test(a.linkPath)) out.push("The button link must be a page on this site, starting with / (for example /provider/shifts).");
  return out;
}

/** The text version: subject + link only (texts stay short; the full message is in the app and email). */
export function announcementSms(brandName: string, title: string, url: string | null) {
  return `${brandName}: ${title}${url ? ` ${url}` : ""}`.slice(0, 300);
}
