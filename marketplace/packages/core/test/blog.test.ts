import { describe, expect, it } from "vitest";
import { checkBlogPost, pickChannelVideo, rankRelated, youtubeId, type ChannelVideo, dollarAmountsIn, parseInline, parseMarkdown, readingMinutes, safeHref, slugify, wordCount } from "../src";

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
  it("blocks only a bad slug; thin posts and short descriptions are warnings", () => {
    const r = checkBlogPost({ ...good, slug: "Bad Slug", description: "short", body: "## A\n\ntoo short" });
    expect(r.errors.join(" ")).toMatch(/slug/);
    expect(r.errors).toHaveLength(1);
    expect(r.warnings.join(" ")).toMatch(/Meta description is short/);
    expect(r.warnings.join(" ")).toMatch(/300\+/);
  });
  it("flags (doesn't block) guarantees, contact details, patient details and unknown dollar figures: a person publishes", () => {
    for (const [extra, re] of [[" We guarantee coverage.", /Guarantee/], [" Call 813-555-0100.", /phone/], [" A patient named Jane came in.", /patient/], [" Overtime is $100 per hour.", /\$100/]] as const) {
      const r = checkBlogPost({ ...good, body: good.body + extra });
      expect(r.errors).toEqual([]);
      expect(r.warnings.join(" ")).toMatch(re);
    }
    expect(checkBlogPost({ ...good, body: good.body + " Overtime is $100 per hour." }, { knownDollarAmounts: dollarAmountsIn("Overtime: $100/hr") }).warnings.join(" ")).not.toMatch(/\$100/);
  });
  it("warns (doesn't block) on legal citations and outside links", () => {
    const r = checkBlogPost({ ...good, body: good.body + " See [the board](https://floridaschiropracticmedicine.gov) and F.S. 460." });
    expect(r.errors).toEqual([]);
    expect(r.warnings.join(" ")).toMatch(/statute/);
    expect(r.warnings.join(" ")).toMatch(/outside links/);
  });
});

describe("YouTube on blog posts", () => {
  it("reads the video ID from any common YouTube link", () => {
    for (const u of ["https://www.youtube.com/watch?v=3VMjGw18VH4&t=4s", "youtu.be/3VMjGw18VH4", "https://youtube.com/shorts/3VMjGw18VH4", "https://www.youtube-nocookie.com/embed/3VMjGw18VH4", "3VMjGw18VH4", "https://m.youtube.com/watch?v=3VMjGw18VH4"]) expect(youtubeId(u)).toBe("3VMjGw18VH4");
    for (const u of ["", "https://vimeo.com/123", "https://evil.com/watch?v=3VMjGw18VH4", "https://youtube.com/watch?v=short"]) expect(youtubeId(u)).toBeNull();
  });
  const videos: ChannelVideo[] = [
    { id: "aaaaaaaaaaa", title: "Post a Coverage Shift in 30 Seconds", audience: "CLINIC" },
    { id: "bbbbbbbbbbb", title: "No-Show Provider? Live Arrival Times", audience: "CLINIC" },
    { id: "ccccccccccc", title: "Set Your Own Minimum Pay", audience: "PROVIDER" },
    { id: "ddddddddddd", title: "The App in Your Pocket", audience: "ALL" },
  ];
  it("suggests a channel video for the post's audience, matching its words, never the embedded one", () => {
    expect(pickChannelVideo({ slug: "no-show", title: "What to do when a provider is a no-show", keywords: ["no-show provider"], audience: "CLINIC" }, videos)?.id).toBe("bbbbbbbbbbb");
    expect(pickChannelVideo({ slug: "no-show", title: "What to do when a provider is a no-show", keywords: [], audience: "CLINIC", videoId: "bbbbbbbbbbb" }, videos)?.id).not.toBe("bbbbbbbbbbb");
    expect(pickChannelVideo({ slug: "pay", title: "Minimum pay for fill-in work", keywords: [], audience: "PROVIDER" }, videos)?.id).toBe("ccccccccccc");
    expect(pickChannelVideo({ slug: "x", title: "x", keywords: [], audience: "PROVIDER" }, [videos[0]])).toBeNull();
  });
  it("ranks related posts by shared keywords, then newest", () => {
    const a = { id: "a", keywords: ["locum"], publishedAt: new Date("2026-10-01") };
    const b = { id: "b", keywords: ["coverage", "locum"], publishedAt: new Date("2026-09-01") };
    const c = { id: "c", keywords: [], publishedAt: new Date("2026-10-05") };
    expect(rankRelated({ keywords: ["coverage", "locum"] }, [a, b, c]).map((x) => x.id)).toEqual(["b", "a", "c"]);
  });
});
