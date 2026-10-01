import { PROHIBITED_CLAIMS } from "./growth";

/**
 * Blog rules (pure). Software decides what may be published; AI only drafts.
 * Posts are stored as a small, safe Markdown subset and rendered as React
 * elements, never as raw HTML.
 */

// ---------------- slugs ----------------

export function slugify(title: string, max = 80): string {
  const s = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  return cut.includes("-") ? cut.slice(0, cut.lastIndexOf("-")) : cut;
}

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// ---------------- markdown subset ----------------

export type Inline = { t: "text"; v: string } | { t: "b"; c: Inline[] } | { t: "i"; c: Inline[] } | { t: "a"; href: string; c: Inline[] };
export type Block =
  | { t: "h2" | "h3"; id: string; c: Inline[] }
  | { t: "p"; c: Inline[] }
  | { t: "ul" | "ol"; items: Inline[][] }
  | { t: "quote"; c: Inline[] };

/** Internal paths, in-page anchors and https links only; anything else renders as plain text. */
export function safeHref(href: string): string | null {
  const h = href.trim();
  if (/^\/(?!\/)[^\s]*$/.test(h) || /^#[\w-]+$/.test(h)) return h;
  if (/^https:\/\/[^\s/]+\.[^\s]+$/i.test(h)) return h;
  return null;
}

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let text = "";
  const flush = () => (text ? (out.push({ t: "text", v: text }), (text = "")) : undefined);
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    const link = rest.match(/^\[([^\]]+)\]\(([^)\s]+)\)/);
    if (link) {
      flush();
      const href = safeHref(link[2]!);
      if (href) out.push({ t: "a", href, c: parseInline(link[1]!) });
      else out.push(...parseInline(link[1]!));
      i += link[0].length;
      continue;
    }
    const bold = rest.match(/^\*\*([^*]+?)\*\*/) ?? rest.match(/^__([^_]+?)__/);
    if (bold) {
      flush();
      out.push({ t: "b", c: parseInline(bold[1]!) });
      i += bold[0].length;
      continue;
    }
    const ital = rest.match(/^\*([^*\s][^*]*?)\*/) ?? rest.match(/^_([^_\s][^_]*?)_(?![A-Za-z0-9])/);
    if (ital && (i === 0 || !/[A-Za-z0-9]/.test(src[i - 1]!))) {
      flush();
      out.push({ t: "i", c: parseInline(ital[1]!) });
      i += ital[0].length;
      continue;
    }
    text += src[i];
    i++;
  }
  flush();
  return out;
}

export function inlineText(c: Inline[]): string {
  return c.map((x) => (x.t === "text" ? x.v : inlineText(x.c))).join("");
}

export function parseMarkdown(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  const ids = new Map<string, number>();
  const headingId = (text: string) => {
    const base = slugify(text, 60) || "section";
    const n = ids.get(base) ?? 0;
    ids.set(base, n + 1);
    return n ? `${base}-${n + 1}` : base;
  };
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push({ t: "p", c: parseInline(para.join(" ")) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) {
      flushPara();
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (h) {
      flushPara();
      // The page title is the only h1; deeper levels collapse to h3.
      const t = h[1]!.length <= 2 ? "h2" : "h3";
      const c = parseInline(h[2]!);
      blocks.push({ t, id: headingId(inlineText(c)), c });
      continue;
    }
    const ul = /^[-*+]\s+/, ol = /^\d+[.)]\s+/;
    if (ul.test(line) || ol.test(line)) {
      flushPara();
      const kind = ul.test(line) ? "ul" : "ol";
      const re = kind === "ul" ? ul : ol;
      const items: Inline[][] = [];
      while (i < lines.length && re.test(lines[i]!.trim())) {
        items.push(parseInline(lines[i]!.trim().replace(re, "")));
        i++;
      }
      i--;
      blocks.push({ t: kind, items });
      continue;
    }
    if (line.startsWith(">")) {
      flushPara();
      const q: string[] = [];
      while (i < lines.length && lines[i]!.trim().startsWith(">")) {
        q.push(lines[i]!.trim().replace(/^>\s?/, ""));
        i++;
      }
      i--;
      blocks.push({ t: "quote", c: parseInline(q.join(" ")) });
      continue;
    }
    para.push(line);
  }
  flushPara();
  return blocks;
}

export function wordCount(md: string): number {
  return (md.replace(/[#>*_[\]()-]/g, " ").match(/[A-Za-z0-9'’]+/g) ?? []).length;
}

export function readingMinutes(md: string): number {
  return Math.max(1, Math.round(wordCount(md) / 220));
}

// ---------------- publish checks ----------------

export interface BlogDraft {
  title: string;
  slug: string;
  description: string;
  body: string;
}

export interface BlogCheck {
  /** Block publishing until fixed. */
  errors: string[];
  /** Shown to the editor; publishing is still allowed. */
  warnings: string[];
}

const PHONE = /\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/;
const DOLLARS = /\$\s?\d[\d,]*(?:\.\d+)?/g;
const LEGAL_CITE = /(§|\bF\.\s?S\.|\bFla\.\s?Stat|\bstatute\s+\d|\bchapter\s+\d{3}\b|\brule\s+64B)/i;
const PATIENT_DETAIL = /\b(patient|client)\s+(named|called)\b|\bDOB\b|\bMRN\b|\bdate of birth\b/i;

const dollarsIn = (t: string) => (t.match(DOLLARS) ?? []).map((m) => m.replace(/\s/g, ""));

/**
 * Checks a post before it can be published. `knownDollarAmounts` are the
 * amounts that appear in the approved facts (FAQ, knowledge base); any other
 * dollar figure is an error, because prices come only from the rate engine.
 */
export function checkBlogPost(p: BlogDraft, opts: { knownDollarAmounts?: string[] } = {}): BlogCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const all = `${p.title}\n${p.description}\n${p.body}`;
  const words = wordCount(p.body);

  if (!p.title.trim()) errors.push("Add a title.");
  else if (p.title.length > 110) errors.push("Title is too long (110 characters max).");
  else if (p.title.length > 65) warnings.push(`Title is ${p.title.length} characters; Google usually shows about 60.`);

  if (!SLUG_RE.test(p.slug) || p.slug.length > 90) errors.push("Web address (slug) may use only lowercase letters, numbers and single hyphens.");

  const d = p.description.trim();
  if (d.length < 50) errors.push("Meta description is too short (50 characters minimum).");
  else if (d.length > 200) errors.push("Meta description is too long (200 characters max).");
  else if (d.length > 160) warnings.push(`Meta description is ${d.length} characters; search results usually show about 155.`);

  if (words < 300) errors.push(`The post is ${words} words; publish at least 300 so it's genuinely useful.`);
  else if (words > 3000) warnings.push(`The post is ${words} words; consider splitting it.`);
  if (!/^#{2,3}\s/m.test(p.body)) warnings.push("Add a few ## section headings; they help readers and search engines.");

  if (PROHIBITED_CLAIMS.test(all)) errors.push("Remove guarantee or results language (e.g. “guaranteed”, “risk-free”, “increase your revenue”, “30% more”).");
  if (PHONE.test(all) || EMAIL.test(all)) errors.push("Remove phone numbers and email addresses; link to /contact instead.");
  const known = new Set((opts.knownDollarAmounts ?? []).map((m) => m.replace(/\s/g, "")));
  const unknown = [...new Set(dollarsIn(all).filter((m) => !known.has(m)))];
  if (unknown.length) errors.push(`Remove dollar figures that don't come from our published pricing: ${unknown.join(", ")}. Link to /for-clinics for prices.`);
  if (PATIENT_DETAIL.test(all)) errors.push("Remove anything that looks like patient details. No patient information is allowed anywhere on the site.");

  if (LEGAL_CITE.test(all)) warnings.push("Mentions a statute or board rule. Check the citation against the official source before publishing.");
  const external = [...new Set((p.body.match(/\]\((https:\/\/[^)\s]+)\)/g) ?? []).map((m) => m.slice(2, -1)))];
  if (external.length) warnings.push(`Check that these outside links work and say what the post claims: ${external.join(", ")}`);
  if (/\]\((?!\/|#|https:\/\/)[^)]*\)/.test(p.body)) warnings.push("Some links aren't internal paths or https addresses; they'll show as plain text.");

  return { errors, warnings };
}

export { dollarsIn as dollarAmountsIn };
