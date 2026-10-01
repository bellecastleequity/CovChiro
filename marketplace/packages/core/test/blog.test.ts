import { describe, expect, it } from "vitest";
import { checkBlogPost, dollarAmountsIn, parseInline, parseMarkdown, readingMinutes, safeHref, slugify, wordCount } from "../src";

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
const good = {
  title: "How to plan coverage for a CE weekend",
  slug: "how-to-plan-coverage-for-a-ce-weekend",
  description: "A practical checklist for clinic owners booking a covering doctor while they attend continuing education.",
  body: `## Start early\n\n${words(200)}\n\n## Brief your team\n\n${words(200)}`,
};

describe("slugify", () => {
  it("makes clean, ascii, hyphenated slugs", () => {
    expect(slugify("Locum Chiropractor vs. Coverage: What’s the Difference?")).toBe("locum-chiropractor-vs-coverage-what-s-the-difference");
    expect(slugify("Café & Clinic")).toBe("cafe-and-clinic");
  });
  it("cuts long titles at a word boundary", () => {
    const s = slugify("a".repeat(30) + " " + "b".repeat(30) + " " + "c".repeat(30), 70);
    expect(s).toBe("a".repeat(30) + "-" + "b".repeat(30));
  });
});

describe("markdown subset", () => {
  it("parses headings, paragraphs, lists and quotes", () => {
    const b = parseMarkdown("# Title\n\nHello **world** and *you*.\nSame para.\n\n- one\n- two\n\n1. first\n2. second\n\n> quoted\n\n### Deep");
    expect(b.map((x) => x.t)).toEqual(["h2", "p", "ul", "ol", "quote", "h3"]);
    expect(b[1]).toEqual({ t: "p", c: [{ t: "text", v: "Hello " }, { t: "b", c: [{ t: "text", v: "world" }] }, { t: "text", v: " and " }, { t: "i", c: [{ t: "text", v: "you" }] }, { t: "text", v: ". Same para." }] });
    expect(b[2]).toMatchObject({ t: "ul", items: [[{ t: "text", v: "one" }], [{ t: "text", v: "two" }]] });
  });
  it("gives headings unique ids", () => {
    const b = parseMarkdown("## Costs\n\n## Costs");
    expect(b.map((x) => (x.t === "h2" ? x.id : null))).toEqual(["costs", "costs-2"]);
  });
  it("keeps only safe links; others become text", () => {
    expect(parseInline("[pricing](/for-clinics)")).toEqual([{ t: "a", href: "/for-clinics", c: [{ t: "text", v: "pricing" }] }]);
    expect(parseInline("[x](javascript:alert(1))")[0]).toMatchObject({ t: "text" });
    expect(parseInline("[x](http://insecure.example)")).toEqual([{ t: "text", v: "x" }]);
    expect(safeHref("//evil.example")).toBeNull();
    expect(safeHref("https://floridahealth.gov/licensing")).toBe("https://floridahealth.gov/licensing");
  });
  it("doesn't treat snake_case or mid-word asterisks as italics", () => {
    expect(parseInline("file_name_here")).toEqual([{ t: "text", v: "file_name_here" }]);
  });
  it("counts words and reading time", () => {
    expect(wordCount("## Hi there\n\n- one two")).toBe(4);
    expect(readingMinutes(words(660))).toBe(3);
  });
});

describe("publish checks", () => {
  it("a sound post passes", () => {
    expect(checkBlogPost(good).errors).toEqual([]);
  });
  it("blocks thin posts, bad slugs and short descriptions", () => {
    const r = checkBlogPost({ ...good, slug: "Bad Slug", description: "short", body: "## A\n\ntoo short" });
    expect(r.errors.join(" ")).toMatch(/slug/);
    expect(r.errors.join(" ")).toMatch(/too short/);
    expect(r.errors.join(" ")).toMatch(/at least 300/);
  });
  it("blocks guarantees, contact details and patient details", () => {
    expect(checkBlogPost({ ...good, body: good.body + " We guarantee coverage." }).errors.join(" ")).toMatch(/guarantee/);
    expect(checkBlogPost({ ...good, body: good.body + " Call 813-555-0100." }).errors.join(" ")).toMatch(/phone/);
    expect(checkBlogPost({ ...good, body: good.body + " A patient named Jane came in." }).errors.join(" ")).toMatch(/patient/);
  });
  it("allows only dollar figures from approved facts", () => {
    const body = good.body + " Overtime is $100 per hour.";
    expect(checkBlogPost({ ...good, body }).errors.join(" ")).toMatch(/\$100/);
    expect(checkBlogPost({ ...good, body }, { knownDollarAmounts: dollarAmountsIn("Overtime: $100/hr") }).errors).toEqual([]);
  });
  it("warns (doesn't block) on legal citations and outside links", () => {
    const r = checkBlogPost({ ...good, body: good.body + " See [the board](https://floridaschiropracticmedicine.gov) and F.S. 460." });
    expect(r.errors).toEqual([]);
    expect(r.warnings.join(" ")).toMatch(/statute/);
    expect(r.warnings.join(" ")).toMatch(/outside links/);
  });
});
