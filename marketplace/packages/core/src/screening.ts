/**
 * Message screening (SPEC §10.3, INV-4). Contact details are redacted before
 * confirmation; likely patient information triggers a warning so the sender
 * can edit before sending. We only ever record a counter for PHI hits, never
 * the matched text.
 */

const PATTERNS: { kind: string; re: RegExp }[] = [
  { kind: "email", re: /[A-Z0-9._%+-]+\s*(?:@|\(at\)|\[at\]|\sat\s)\s*[A-Z0-9.-]+\s*(?:\.|\(dot\)|\[dot\]|\sdot\s)\s*[A-Z]{2,}/gi },
  { kind: "email", re: /\b(?:g\s*-?\s*mail|yahoo|hotmail|outlook\.com|icloud|aol\.com|proton\s*mail)\b/gi },
  { kind: "url", re: /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\s*(?:\.|\(dot\)|\sdot\s)\s*(?:com|net|org|io|co|us|biz|info|me|ly|app)\b(?:\/\S*)?/gi },
  { kind: "phone", re: /(?:\+?1[\s.-]*)?\(?\b\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}\b/g },
  { kind: "spelled-phone", re: /\b(?:(?:zero|one|two|three|four|five|six|seven|eight|nine|oh)[\s,.-]*){7,}/gi },
  { kind: "social", re: /(?:^|\s)@[a-z0-9_.]{2,}\b|\b(?:insta(?:gram)?|facebook|linked\s*in|snap\s*chat|tik\s*tok|whats\s*app|telegram|venmo|zelle|cash\s*app|pay\s*pal|twitter|messenger)\b/gi },
  { kind: "contact-request", re: /\b(?:text|call|phone|email|e-mail|reach|dm|ping|whats\s?app|signal|telegram)\s+me\b[^.!?\n]{0,40}/gi },
];

/** Arranging work outside the platform (non-circumvention). Blocked in messages. */
const OFF_PLATFORM: RegExp[] = [
  /\b(?:off|outside(?:\s+of)?)\s+(?:the\s+|this\s+)?(?:app|platform|site|website|coverage\s*on\s*call)\b/i,
  /\b(?:work|book|hire|pay|deal|contract|schedule)(?:ing|ed|s)?\s+(?:with\s+)?(?:you|me|us|them|her|him)?\s*direct(?:ly)?\b/i,
  /\bdirect(?:ly)?\s+(?:hire|booking|contract|deposit|payment|pay|arrangement)\b/i,
  /\b(?:skip|avoid|bypass|cut\s+out|save\s+on|get\s+around|go\s+around)\s+(?:the\s+|their\s+|all\s+the\s+)?(?:fees?|middle\s*-?\s*man|platform|app|site|coverage\s*on\s*call|commission|markup)\b/i,
  /\bpay\s+(?:you\s+|me\s+)?(?:in\s+)?cash\b|\bunder\s+the\s+table\b|\bcash\s+only\b/i,
  /\b(?:personal|private|real|other|direct|cell)\s+(?:number|cell|phone|email|e-mail|contact|line)\b/i,
  /\b(?:my|our)\s+(?:cell|number|digits|email|e-mail)\s+(?:is|:)/i,
  /\b(?:join(?:ing)?|work(?:ing)?\s+for|come\s+work\s+(?:for|with))\s+(?:our|us)\b[^.!?\n]{0,60}\b(?:full[\s-]?time|part[\s-]?time|permanent(?:ly)?|staff|employee|w-?2|payroll)\b/i,
  /\b(?:full[\s-]?time|permanent|w-?2)\s+(?:position|job|role|offer|spot|opening)\b/i,
];

// ---------- obfuscated phone numbers ----------
const NUM_WORDS: Record<string, string> = {
  zero: "0", oh: "0", o: "0", none: "0", one: "1", won: "1", two: "2", three: "3", four: "4", for: "4", five: "5", six: "6", seven: "7", eight: "8", ate: "8", nine: "9", niner: "9",
  ten: "10", eleven: "11", twelve: "12",
};
const FILLER = new Set(["dash", "dot", "space", "then", "and", "hyphen", "comma", "point"]);
const REPEAT: Record<string, number> = { double: 2, triple: 3 };

/** Masks things that look like digits but aren't phones: money, dates, times, ordinals. */
function maskNonPhone(text: string) {
  const mask = (m: string) => "§".repeat(m.length);
  return text
    .replace(/\$\s?\d[\d,]*(?:\.\d+)?/g, mask)
    .replace(/\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/g, mask)
    .replace(/\b\d{1,2}:\d{2}\b/g, mask)
    .replace(/\b\d+(?:st|nd|rd|th)\b/gi, mask);
}

/**
 * Finds phone numbers written any way: 4075551234, 407 555 1234, 4-0-7…,
 * "four oh seven five five five…", "4o7 555 l234", "double five"… A run of
 * 7 or 10+ digits joined only by separators or number words counts.
 * Returns the [start, end) spans.
 */
export function findObfuscatedPhones(text: string): [number, number][] {
  const masked = maskNonPhone(text);
  const tokens = [...masked.matchAll(/[a-z]+|\d+|[^a-z\d\s]/gi)];
  const spans: [number, number][] = [];
  let digits = "";
  let lastGroupLen = 0;
  let start = -1;
  let end = -1;
  let repeat = 1;
  let comma = false;
  const flush = () => {
    if (digits.length === 7 || digits.length >= 10) spans.push([start, end]);
    digits = "";
    start = -1;
    repeat = 1;
    comma = false;
    lastGroupLen = 0;
  };
  const add = (d: string, from: number, to: number) => {
    // A comma between multi-digit groups is a list ("suite 200, 1234 Main"), not a phone.
    if (comma && digits && (d.length > 1 || lastGroupLen > 1)) flush();
    comma = false;
    if (start < 0) start = from;
    end = to;
    const chunk = d.repeat(d.length === 1 ? repeat : 1);
    digits += chunk;
    lastGroupLen = d.length;
    repeat = 1;
  };
  for (const m of tokens) {
    const t = m[0];
    const from = m.index!;
    const to = from + t.length;
    if (/^\d+$/.test(t)) add(t, from, to);
    else if (/^[a-z]+$/i.test(t)) {
      const w = t.toLowerCase();
      if (NUM_WORDS[w] !== undefined && (w.length > 1 || digits)) add(NUM_WORDS[w], from, to);
      else if (/^[ol]$/.test(w) && digits) add(w === "o" ? "0" : "1", from, to);
      else if (REPEAT[w]) repeat = REPEAT[w];
      else if (FILLER.has(w) && digits) continue;
      else flush();
    } else if (t === ",") comma = true;
    else if ("-.()+_*|#~=".includes(t)) continue;
    else flush(); // §, :, /, and anything else end the run
  }
  flush();
  return spans;
}

export const REDACTION_NOTICE = "For your protection, contact details are shared through the platform.";
export const PHI_NOTICE = "Do not include patient information.";

export interface ContactScan {
  found: boolean;
  kinds: string[];
  redacted: string;
}

export function scanContactInfo(text: string): ContactScan {
  let redacted = text;
  const kinds = new Set<string>();
  // Obfuscated phones first (on the original positions), then the patterns.
  const spans = findObfuscatedPhones(text);
  for (const [a, b] of [...spans].reverse()) {
    kinds.add("phone");
    redacted = `${redacted.slice(0, a)}[contact removed]${redacted.slice(b)}`;
  }
  for (const { kind, re } of PATTERNS) {
    redacted = redacted.replace(re, () => {
      kinds.add(kind);
      return "[contact removed]";
    });
  }
  return { found: kinds.size > 0, kinds: [...kinds], redacted };
}

/** Does the text try to arrange work, payment or contact outside the platform? */
export function looksOffPlatform(text: string): boolean {
  return OFF_PLATFORM.some((re) => re.test(text));
}

const PHI_PATTERNS: RegExp[] = [
  /\b[Pp]atient\s*(?:name)?\s*[:\-]?\s*(?:Mr\.?|Mrs\.?|Ms\.?|Dr\.?)?\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?/,
  /\b(?:MRN|medical record(?: number)?|chart\s*#|acct\s*#)\s*[:#]?\s*\w+/i,
  /\b(?:DOB|date of birth|born)\s*[:\-]?\s*\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}/i,
  /\b\d{1,2}[\/.-]\d{1,2}[\/.-](?:19|20)\d{2}\b.*\b(?:dob|birth)\b/i,
  /\b\d{3}-\d{2}-\d{4}\b/, // SSN
  /\b(?:diagnos(?:is|ed)|dx)\s*[:\-]?\s*[A-Z]\d{2}(?:\.\d+)?\b/i, // ICD-10 code
];

export function looksLikePhi(text: string): boolean {
  return PHI_PATTERNS.some((re) => re.test(text));
}

export interface ScreenResult {
  /** Contact details or off-platform dealing: the message is not sent. */
  blocked: boolean;
  /** What tripped the block: phone, email, url, social, contact-request, off-platform. */
  reasons: string[];
  phiWarning: boolean;
}

/**
 * Messages never carry contact details or arrange work off the platform —
 * before or after confirmation. Everything a booked provider needs (address,
 * front desk phone, arrival notes) is on the booking itself.
 */
export function screenMessage(text: string): ScreenResult {
  const phiWarning = looksLikePhi(text);
  const reasons = new Set(scanContactInfo(text).kinds.map((k) => (k === "spelled-phone" ? "phone" : k)));
  if (looksOffPlatform(text)) reasons.add("off-platform");
  return { blocked: reasons.size > 0, reasons: [...reasons], phiWarning };
}
