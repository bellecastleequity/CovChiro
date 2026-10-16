import { describe, expect, it } from "vitest";
import { contactPageLinks, decodeCfEmail, extractEmails, hasContactForm, pickClinicEmail, pickProviderEmail, placeMatches, safeFetchUrl, siteSocialLinks, siteUrl } from "../src/sitescan";

/** Cloudflare's email obfuscation: first byte is the key, every following byte is XORed with it. */
function cf(email: string, key = 0x42) {
  return [key, ...[...email].map((c) => c.charCodeAt(0) ^ key)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

describe("site scan: finding emails on a clinic's own pages", () => {
  it("reads mailto links, plain text and Cloudflare-protected addresses", () => {
    const html = `
      <a href="mailto:Info@SunriseChiro.com?subject=Hi">Email us</a>
      <p>Front desk: frontdesk@sunrisechiro.com.</p>
      <a href="/cdn-cgi/l/email-protection#${cf("drlee@sunrisechiro.com")}">[email&#160;protected]</a>
      <span class="__cf_email__" data-cfemail="${cf("office@sunrisechiro.com", 0x1f)}">[email protected]</span>
      <p>Write to billing [at] sunrisechiro [dot] com</p>`;
    expect(extractEmails(html)).toEqual(expect.arrayContaining(["info@sunrisechiro.com", "frontdesk@sunrisechiro.com", "drlee@sunrisechiro.com", "office@sunrisechiro.com", "billing@sunrisechiro.com"]));
    expect(decodeCfEmail(cf("a@b.co"))).toBe("a@b.co");
    expect(decodeCfEmail("zz")).toBeNull();
  });

  it("ignores image names, tracking ids and version strings that look like emails", () => {
    const html = `<img src="logo@2x.png"> <script src="lib@3.1.4.min.js"></script> 6e1a2f@sentry.wixpress.com user@example.com`;
    expect(extractEmails(html)).toEqual(["6e1a2f@sentry.wixpress.com", "user@example.com"]);
    expect(pickClinicEmail([{ email: "6e1a2f@sentry.wixpress.com", url: "u" }, { email: "user@example.com", url: "u" }], "https://sunrisechiro.com")).toBeNull();
  });

  it("prefers the clinic's own front-desk mailbox, never the web designer's address", () => {
    const found = [
      { email: "hello@bestchirowebsites.com", url: "https://sunrisechiro.com/" },
      { email: "drlee@sunrisechiro.com", url: "https://sunrisechiro.com/about" },
      { email: "info@sunrisechiro.com", url: "https://sunrisechiro.com/contact" },
    ];
    expect(pickClinicEmail(found, "https://www.sunrisechiro.com")).toEqual({ email: "info@sunrisechiro.com", url: "https://sunrisechiro.com/contact" });
    // Another business's domain on the page is usually the web designer or a parent company.
    expect(pickClinicEmail([found[0]], "https://sunrisechiro.com")).toBeNull();
    expect(pickClinicEmail([{ email: "office@gmail.com", url: "u" }], "https://sunrisechiro.com")).toEqual({ email: "office@gmail.com", url: "u" });
    expect(pickClinicEmail([{ email: "jane.smith@gmail.com", url: "u" }], "https://sunrisechiro.com")).toBeNull();
  });

  it("finds a provider's own address on their practice site", () => {
    const found = [{ email: "info@sunrisechiro.com", url: "a" }, { email: "jlee@sunrisechiro.com", url: "b" }];
    expect(pickProviderEmail(found, { firstName: "Jamie", lastName: "Lee", website: "https://sunrisechiro.com", practiceRole: "ASSOCIATE", providersAtPractice: 3 })).toEqual({ email: "jlee@sunrisechiro.com", url: "b" });
    // A shared inbox only counts for the owner of a solo practice.
    expect(pickProviderEmail([found[0]], { firstName: "Jamie", lastName: "Lee", website: "https://sunrisechiro.com", practiceRole: "ASSOCIATE", providersAtPractice: 3 })).toBeNull();
    expect(pickProviderEmail([found[0]], { firstName: "Jamie", lastName: "Lee", website: "https://sunrisechiro.com", practiceRole: "OWNER", providersAtPractice: 1 })).toEqual({ email: "info@sunrisechiro.com", url: "a" });
  });

  it("lists the site's own contact pages, contact first", () => {
    const html = `<a href="/blog/back-pain">Blog</a> <a href="/about-us">About Dr. Lee</a> <a href="https://sunrisechiro.com/contact">Contact</a>
      <a href="https://facebook.com/sunrise">Facebook</a> <a href="/new-patients#form">New patients</a> <a href="/contact">Contact again</a> <a href="mailto:x@y.com">mail</a>`;
    expect(contactPageLinks(html, "https://www.sunrisechiro.com/", 5)).toEqual(["https://sunrisechiro.com/contact", "https://www.sunrisechiro.com/about-us", "https://www.sunrisechiro.com/new-patients"]);
  });

  it("spots contact forms and official social profiles", () => {
    expect(hasContactForm(`<form action="/send"><input type="email" name="e"><textarea></textarea></form>`)).toBe(true);
    expect(hasContactForm(`<form action="/search"><input type="search"></form>`)).toBe(false);
    expect(siteSocialLinks(`<a href="https://www.instagram.com/sunrisechiro/">IG</a> <a href="https://www.facebook.com/sharer/sharer.php?u=x">share</a> <a href="https://facebook.com/SunriseChiro">FB</a>`))
      .toEqual(["https://www.instagram.com/sunrisechiro/", "https://facebook.com/SunriseChiro"]);
  });

  it("matches a Google Maps place to the registry address by ZIP and street number, or phone", () => {
    const p = { address: "123 Main St, Suite 4", zip: "32801", phone: null };
    expect(placeMatches(p, { address: "123 Main St #4, Orlando, FL 32801, USA", phone: null })).toBe(true);
    expect(placeMatches(p, { address: "125 Main St, Orlando, FL 32801, USA", phone: null })).toBe(false);
    expect(placeMatches(p, { address: "123 Main St, Tampa, FL 33602, USA", phone: null })).toBe(false);
    expect(placeMatches({ ...p, phone: "(407) 555-0100" }, { address: "PO Box 1, Orlando, FL 32899", phone: "407-555-0100" })).toBe(true);
  });

  it("only fetches ordinary public web addresses", () => {
    expect(siteUrl("sunrisechiro.com/?utm_source=gmb")).toBe("https://sunrisechiro.com");
    expect(siteUrl("https://www.sunrisechiro.com/home?utm_source=google")).toBe("https://www.sunrisechiro.com/home");
    expect(siteUrl("not a url")).toBeNull();
    expect(safeFetchUrl("https://sunrisechiro.com/contact")).toBe(true);
    for (const bad of ["http://localhost/x", "http://127.0.0.1/", "http://10.0.0.5/", "http://192.168.1.1/", "http://169.254.169.254/latest", "ftp://x.com/", "https://x.com:8443/", "http://[::1]/", "http://intranet/"]) expect(safeFetchUrl(bad)).toBe(false);
  });
});
