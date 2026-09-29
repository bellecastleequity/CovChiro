/**
 * Message screening (SPEC §10.3, INV-4). Contact details are redacted before
 * confirmation; likely patient information triggers a warning so the sender
 * can edit before sending. We only ever record a counter for PHI hits, never
 * the matched text.
 */

const PATTERNS: { kind: string; re: RegExp }[] = [
  { kind: "email", re: /[A-Z0-9._%+-]+\s*(?:@|\(at\)|\[at\]|\sat\s)\s*[A-Z0-9.-]+\s*(?:\.|\(dot\)|\[dot\]|\sdot\s)\s*[A-Z]{2,}/gi },
  { kind: "url", re: /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|net|org|io|co|us|biz|info|me)\b(?:\/\S*)?/gi },
  { kind: "phone", re: /(?:\+?1[\s.-]*)?\(?\b\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}\b/g },
  { kind: "spelled-phone", re: /\b(?:(?:zero|one|two|three|four|five|six|seven|eight|nine|oh)[\s,.-]*){7,}/gi },
  { kind: "handle", re: /\b(?:text|call|reach|dm|whats\s?app|signal|telegram)\s+me\b[^.!?\n]{0,40}/gi },
];

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
  for (const { kind, re } of PATTERNS) {
    redacted = redacted.replace(re, () => {
      kinds.add(kind);
      return "[contact removed]";
    });
  }
  return { found: kinds.size > 0, kinds: [...kinds], redacted };
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
  body: string;
  redacted: boolean;
  /** Post-confirmation contact sharing is allowed but flagged when repeated. */
  flagged: boolean;
  phiWarning: boolean;
}

/**
 * @param confirmed whether the pair has a confirmed shift together
 * @param priorContactShares how many earlier messages in this thread contained contact info
 */
export function screenMessage(text: string, confirmed: boolean, priorContactShares = 0): ScreenResult {
  const phiWarning = looksLikePhi(text);
  const scan = scanContactInfo(text);
  if (!scan.found) return { body: text, redacted: false, flagged: false, phiWarning };
  if (!confirmed) return { body: scan.redacted, redacted: true, flagged: false, phiWarning };
  return { body: text, redacted: false, flagged: priorContactShares >= 1, phiWarning };
}
