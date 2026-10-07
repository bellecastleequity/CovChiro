import { describe, expect, it } from "vitest";
import { emailDnsReport } from "../src";

const good = {
  domain: "coverageoncall.com",
  rootTxt: ["v=spf1 include:spf.web-hosting.com include:sendgrid.net ~all", "google-site-verification=x"],
  dmarcTxt: ["v=DMARC1; p=quarantine; rua=mailto:admin@coverageoncall.com"],
  dkim: { s1: "s1.domainkey.u123.wl.sendgrid.net.", s2: "s2.domainkey.u123.wl.sendgrid.net." },
  mx: ["mx1.privateemail.com"],
};
const state = (r: ReturnType<typeof emailDnsReport>) => Object.fromEntries(r.map((c) => [c.key, c.state]));

describe("email deliverability check", () => {
  it("all set", () => {
    expect(state(emailDnsReport(good, { reportEmail: "admin@coverageoncall.com" }))).toEqual({ spf: "ok", dkim: "ok", dmarc: "ok", mx: "ok" });
  });
  it("missing records say exactly what to add", () => {
    const r = emailDnsReport({ ...good, rootTxt: [], dmarcTxt: [], dkim: { s1: null, s2: null }, mx: [] }, { reportEmail: "admin@coverageoncall.com" });
    expect(state(r)).toEqual({ spf: "fail", dkim: "fail", dmarc: "fail", mx: "fail" });
    expect(r.find((c) => c.key === "dmarc")!.fix).toMatch(/_dmarc\.coverageoncall\.com: v=DMARC1; p=none; rua=mailto:admin@coverageoncall\.com/);
  });
  it("two SPF records or +all fail; p=none is a warning", () => {
    expect(state(emailDnsReport({ ...good, rootTxt: ["v=spf1 a ~all", "v=spf1 include:sendgrid.net ~all"] }, { reportEmail: "a@b.c" })).spf).toBe("fail");
    expect(state(emailDnsReport({ ...good, rootTxt: ["v=spf1 +all"] }, { reportEmail: "a@b.c" })).spf).toBe("fail");
    expect(state(emailDnsReport({ ...good, dmarcTxt: ["v=DMARC1; p=none"] }, { reportEmail: "a@b.c" })).dmarc).toBe("warn");
  });
});
