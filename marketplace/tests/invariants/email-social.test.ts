import { describe, expect, it } from "vitest";
import { renderEmail } from "@cm/services";

describe("email footer social icons", () => {
  const c = { subject: "Hi", heading: "Hello", paragraphs: ["Body"] };

  it("links Instagram and YouTube icons when the links are set", () => {
    const { html, text } = renderEmail(c, { instagram: "https://www.instagram.com/coverageoncall", youtube: "https://www.youtube.com/@coverageoncall" });
    expect(html).toContain('href="https://www.instagram.com/coverageoncall"');
    expect(html).toContain('href="https://www.youtube.com/@coverageoncall"');
    expect(html).toContain("/brand/email-instagram.png");
    expect(html).toContain("/brand/email-youtube.png");
    expect(text).toContain("YouTube: https://www.youtube.com/@coverageoncall");
  });

  it("hides an icon whose link is blank", () => {
    const { html } = renderEmail(c, { instagram: "https://www.instagram.com/coverageoncall" });
    expect(html).toContain("email-instagram.png");
    expect(html).not.toContain("email-youtube.png");
    expect(renderEmail(c).html).not.toContain("email-instagram.png");
  });
});
