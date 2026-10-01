import { describe, expect, it } from "vitest";
import { spamScore, submittedTooFast } from "../src/spam";

const SEO_PITCH = `Hi,

I wanted to quickly flag something we found while checking your website.

Your SEO (Search Engine Optimization) setup appears to have some incomplete technical elements affecting search-engine crawling, indexing, and overall visibility on Google and Bing.

If you have a few minutes, reply with your phone number and a convenient time. I can walk you through what we found.

Thanks,
Daniel Edwards`;

describe("spamScore", () => {
  it("flags a cold SEO pitch as a sales pitch", () => {
    const r = spamScore({ name: "Daniel Edwards", email: "danieledwards.web2@gmail.com", text: SEO_PITCH });
    expect(r.score).toBeGreaterThanOrEqual(50);
    expect(r.kind).toBe("solicitation");
    expect(r.reasons).toEqual(expect.arrayContaining(["SEO pitch", "asks for a call"]));
  });

  it("leaves real clinic and provider questions alone", () => {
    for (const text of [
      "How much does a full-day coverage shift cost in Orlando? We need someone for two Fridays in March.",
      "I'm a chiropractor licensed in Florida. Do I need my own malpractice insurance to pick up shifts?",
      "Can I see the provider's license before they arrive? Our front desk wants to verify it.",
      "Do you cover Saturdays? Our website says we're open 8 to 1 and I'll be traveling.",
    ]) {
      const r = spamScore({ name: "Jane Smith", email: "jane@smithchiro.com", text });
      expect(r.score, text).toBeLessThan(50);
    }
  });

  it("scores links, shorteners, throwaway inboxes and junk", () => {
    expect(spamScore({ name: "Bob", email: "x@mailinator.com", text: "hello" }).reasons).toContain("throwaway email address");
    expect(spamScore({ text: "see https://a.com https://b.com https://c.com https://d.com" }).score).toBeGreaterThanOrEqual(40);
    expect(spamScore({ text: "Dear Sir/Madam, earn money from home with bitcoin bit.ly/abc" }).kind).toBe("spam");
    expect(spamScore({ name: "xkqzvbrtm", text: "hi" }).reasons).toContain("random-looking name");
    expect(spamScore({ name: "Buy now www.cheap.ru", text: "hi" }).reasons).toContain("link in name");
  });

  it("caps at 100", () => {
    expect(spamScore({ name: "www.x.com", email: "a@yopmail.com", text: `${SEO_PITCH} bitcoin casino loan https://a https://b https://c https://d` }).score).toBe(100);
  });
});

describe("submittedTooFast", () => {
  const now = 1_000_000;
  it("catches instant submits only", () => {
    expect(submittedTooFast(now - 1000, now, 3)).toBe(true);
    expect(submittedTooFast(now - 5000, now, 3)).toBe(false);
    expect(submittedTooFast(null, now, 3)).toBe(false);
    expect(submittedTooFast(now + 60_000, now, 3)).toBe(false);
    expect(submittedTooFast(now - 1000, now, 0)).toBe(false);
  });
});
