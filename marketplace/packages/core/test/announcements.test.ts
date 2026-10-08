import { describe, expect, it } from "vitest";
import { announcementProblems, announcementSms } from "../src";

const ok = { kind: "NOTICE" as const, title: "New Clinic Agreement", body: "We've updated the agreement. Please review and sign it in Settings.", channels: ["email" as const] };

describe("announcements", () => {
  it("a normal notice is fine", () => {
    expect(announcementProblems(ok)).toEqual([]);
  });
  it("promotional messages can't go by text; links must be on-site; no patient details", () => {
    expect(announcementProblems({ ...ok, kind: "NEWS", channels: ["email", "sms"] }).join(" ")).toMatch(/can't go by text/);
    expect(announcementProblems({ ...ok, linkPath: "https://evil.example" }).join(" ")).toMatch(/page on this site/);
    expect(announcementProblems({ ...ok, linkPath: "/clinic/settings#agreement" })).toEqual([]);
    expect(announcementProblems({ ...ok, body: "Patient John Smith DOB 01/02/1960 was seen today." }).join(" ")).toMatch(/patient/);
  });
  it("texts are the subject and a link, kept short", () => {
    expect(announcementSms("CoverageOnCall", "New agreement to sign", "https://x.dev/clinic")).toBe("CoverageOnCall: New agreement to sign https://x.dev/clinic");
    expect(announcementSms("B", "x".repeat(400), null).length).toBe(300);
  });
});
