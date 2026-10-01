/**
 * Spam rules for public forms (Ask a question, lead / contact forms, signups).
 * Pure scoring: no network, no AI. Services add the sender block list, the MX check
 * and (for questions) the AI category on top. A high score files the message in the
 * Spam folder; it never deletes anything or bans anyone.
 */

export type SpamCategory = "solicitation" | "spam";

export interface SpamInput {
  name?: string | null;
  email?: string | null;
  /** Free text: the question, message or organization name. */
  text?: string | null;
}

export interface SpamScore {
  score: number;
  reasons: string[];
  /** Mostly sales-pitch wording (SEO, web design, lead generation…) vs plain junk. */
  kind: SpamCategory;
}

/** Vendor cold pitches: each match adds SOLICIT_POINTS. */
const SOLICITATION: [RegExp, string][] = [
  [/\bseo\b|search[- ]engine optimi[sz]ation/i, "SEO pitch"],
  [/\b(rank|ranking|rankings)\b.{0,40}\b(google|bing|search|first page|page one|higher)\b|\bfirst page of google\b/i, "search ranking pitch"],
  [/\bback ?links?\b|\bguest (post|posting|article)\b|\bdomain authority\b/i, "link building pitch"],
  [/\b(web ?site|web) (re)?design\b|\bredesign (of )?your (web ?site|site)\b|\bweb development\b/i, "web design pitch"],
  [/\b(app|software|mobile app) development\b/i, "development pitch"],
  [/\bdigital marketing\b|\bsocial media (management|marketing)\b|\bppc\b|\bpay[- ]per[- ]click\b|\bgoogle ads\b/i, "marketing pitch"],
  [/\blead generation\b|\bmore (leads|patients|customers|clients|traffic)\b|\bincrease (your )?(traffic|sales|leads)\b/i, "lead generation pitch"],
  [/\bvirtual assistants?\b|\boutsourc(e|ing)\b|\boffshore\b|\bwhite[- ]label\b/i, "outsourcing pitch"],
  [/\b(google (my )?business|gmb) (profile|listing)\b|\bonline reputation\b|\bmore (5|five)[- ]star reviews\b/i, "listings / reviews pitch"],
  [/\b(found|noticed|spotted|flag(ged)?) (some|a few|several)?\s*(issues|errors|problems|things|something)\b.{0,60}\b(web ?site|site)\b|\b(checking|reviewed|audit(ed)?|analy[sz]ed) your (web ?site|site)\b|\bweb ?site audit\b/i, "website audit pitch"],
  [/\breply with your (phone|number|best number)\b|\b(convenient|good|best) time (to|for a) (call|chat|talk)\b|\bquick (call|chat) this week\b/i, "asks for a call"],
  [/\b(free|no[- ]obligation) (quote|proposal|consultation|audit|analysis|report)\b/i, "free audit / quote offer"],
  [/\bcrawl(ed|ing)?\b.{0,40}\bindex(ed|ing)\b|\bindex(ed|ing)\b.{0,40}\bcrawl/i, "crawling / indexing pitch"],
];
const SOLICIT_POINTS = 25;

/** Junk and scams. */
const JUNK: [RegExp, string, number][] = [
  [/\b(bitcoin|crypto(currency)?|forex|nft|binary options?|investment opportunit)/i, "crypto / investment", 45],
  [/\b(casino|betting|viagra|cialis|porn|xxx|escort|dating site|hookup)\b/i, "adult / gambling / pharma", 60],
  [/\b(loan|payday|credit repair|debt relief|merchant cash advance|business funding)\b/i, "loan / funding offer", 35],
  [/\bdear (sir|madam|sir\/madam|sir or madam)\b|\bdear (website|site) owner\b|\bhello (dear|friend)\b/i, "form-letter greeting", 25],
  [/\b(make|earn) (money|\$\d)|\bwork from home\b|\bguaranteed (income|results|traffic)\b/i, "money-making claim", 40],
  [/\bunsubscribe\b|\bopt[- ]out\b|\bif you('| a)re not interested\b|\bnot interested\?? (just )?reply\b/i, "mass-mail footer", 20],
];

/** Throwaway inboxes (common ones; the block list in Admin covers the rest). */
export const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.net", "sharklasers.com", "10minutemail.com", "tempmail.com", "temp-mail.org",
  "yopmail.com", "trashmail.com", "getnada.com", "dispostable.com", "maildrop.cc", "fakeinbox.com", "throwawaymail.com",
  "mailnesia.com", "emailondeck.com", "mohmal.com", "tempail.com", "moakt.com", "mintemail.com", "spamgourmet.com", "burnermail.io",
]);

const SHORTENERS = /\b(bit\.ly|tinyurl\.com|t\.co|goo\.gl|ow\.ly|is\.gd|buff\.ly|rebrand\.ly|cutt\.ly|shorturl\.at|t\.ly)\//i;

export function emailDomain(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase().split("@")[1] ?? "";
}

export function spamScore(input: SpamInput): SpamScore {
  const text = (input.text ?? "").slice(0, 5000);
  const name = (input.name ?? "").trim();
  const reasons: string[] = [];
  let solicit = 0;
  let junk = 0;

  for (const [re, label] of SOLICITATION) if (re.test(text)) (solicit += SOLICIT_POINTS), reasons.push(label);
  for (const [re, label, pts] of JUNK) if (re.test(text)) (junk += pts), reasons.push(label);

  const links = (text.match(/https?:\/\/|www\./gi) ?? []).length;
  if (links >= 4) (junk += 40), reasons.push(`${links} links`);
  else if (links >= 2) (junk += 20), reasons.push(`${links} links`);
  if (SHORTENERS.test(text)) (junk += 25), reasons.push("link shortener");

  const letters = text.replace(/[^\p{L}]/gu, "");
  if (letters.length >= 20) {
    const foreign = (text.match(/[Ѐ-ӿ؀-ۿ฀-๿぀-ヿ一-鿿가-힯]/g) ?? []).length;
    if (foreign / letters.length > 0.3) (junk += 30), reasons.push("mostly non-English script");
    const upper = (letters.match(/\p{Lu}/gu) ?? []).length;
    if (upper / letters.length > 0.7) (junk += 15), reasons.push("all capitals");
  }

  if (DISPOSABLE_DOMAINS.has(emailDomain(input.email))) (junk += 60), reasons.push("throwaway email address");
  if (/https?:|www\.|\.(com|net|org|ru|xyz)\b/i.test(name)) (junk += 40), reasons.push("link in name");
  else if (/\d{3,}/.test(name)) (junk += 15), reasons.push("digits in name");
  else if (name.length >= 6 && !/\s/.test(name) && /[bcdfghjklmnpqrstvwxz]{5,}/i.test(name)) (junk += 20), reasons.push("random-looking name");

  const score = Math.min(100, solicit + junk);
  return { score, reasons, kind: solicit >= junk ? "solicitation" : "spam" };
}

/** Too fast to be a person typing (seconds from form load to submit). */
export function submittedTooFast(startedAtMs: number | null | undefined, nowMs: number, minSeconds: number): boolean {
  if (!startedAtMs || !Number.isFinite(startedAtMs) || minSeconds <= 0) return false;
  const elapsed = (nowMs - startedAtMs) / 1000;
  // A start time in the future or days old is a stale/odd page, not proof of a bot.
  return elapsed >= 0 && elapsed < minSeconds;
}

export const SPAM_LABEL: Record<SpamCategory, string> = { solicitation: "Sales pitch", spam: "Spam" };
