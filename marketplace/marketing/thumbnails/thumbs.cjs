// YouTube thumbnails (1280x720) in the in-house CoverageOnCall theme: navy/teal gradient,
// Outfit headline, real logo, real app/website screens, people cut-outs.
const fs = require("fs");
const path = require("path");
const { chromium } = require("/opt/node22/lib/node_modules/playwright");
const HERE = __dirname;
const M = path.resolve(HERE, "../..");
const OUT = process.env.OUT || path.join(HERE, "out");
const C = "FOR CLINICS", P = "FOR PROVIDERS", B = "CLINICS + PROVIDERS";
const raw = (n) => `${M}/dist/marketing/screenshots/${n}.png`;
// [file, audience, headline (use *word* for teal), sub, person, {phone, desk, phone2}]
const T = [
  ["01-post-a-shift", C, "Post a shift in *30 seconds*", "Verified providers. The price up front.", "manager", { phone: raw("c03-post-shift-phone") }],
  ["02-shifts-that-fit", P, "Shifts that *fit your life*", "Only shifts you qualify for, with the pay shown first.", "latina-nurse", { phone: raw("p02-find-shifts-phone") }],
  ["03-shift-day", P, "Shift day, *handled*", "On my way, clock in, timesheet. All in the app.", "black-nurse", { phone: raw("p06-time-clock-phone") }],
  ["04-new-location", C, "New location? *Never* left uncovered", "Coverage for every office you open.", "exec-woman", { desk: raw("c01-dashboard-desk") }],
  ["05-get-paid-fast", P, "Get paid *fast*", "Paid through Stripe after every shift.", "pt-man", { phone: raw("p18-payouts-phone") }],
  ["06-make-the-switch", C, "Make the *switch*", "Up-front pricing. Verified providers.", "manager", { desk: raw("c04-applicants-desk") }],
  ["07-called-out", C, "Provider *called out?*", "Book coverage for tomorrow in minutes.", "phone-man", { phone: raw("c08-shifts-phone") }],
  ["08-close-or-stay-open", C, "Close or *stay open?*", "Free cost-of-closing calculator.", null, { desk: `${HERE}/screens/cost-of-closing-desk.png`, url: "coverageoncall.com/tools/cost-of-closing" }],
  ["09-refer-and-earn", B, "Refer a provider, earn *$20*", "Share your link. You both get paid.", "smile-man", { phone: raw("c02-referral-open-phone") }],
  ["10-skip-the-agency", C, "Skip the *agency*", "Book verified providers directly.", "asian-nurse", { desk: raw("c03-post-shift-desk") }],
  ["11-grow-at-your-pace", C, "Grow at *your pace*", "Add coverage as your practice grows.", "chiro", { desk: raw("c08-shifts-desk") }],
  ["12-extra-income", P, "Extra income, *your schedule*", "Pick up shifts when it suits you.", "pt-woman", { phone: raw("p10-earnings-phone") }],
  ["13-take-the-week-off", C, "Take the *week off*", "Your clinic stays open while you're away.", "lead", { phone: raw("c01-dashboard-phone") }],
  ["14-students-new-grads", P, "Students & new grads: *start sooner*", "Get set up before your license arrives.", "latina-nurse", { phone: raw("p12-credentials-phone") }],
  ["15-no-show-covered", C, "No-show? *Covered.*", "Live arrival times and one-tap replacement.", "phone-woman", { phone: raw("c05-today-provider-phone") }],
  ["16-best-match-wins", C, "Best match *wins*", "Not whoever replied first.", "older-doc", { phone: raw("c04-applicants-phone") }],
  ["17-know-whos-coming", C, "Know who's *walking in*", "Verified license, malpractice and ratings.", "smile-man", { phone: raw("c10-provider-profile-phone") }],
  ["18-no-more-paper", C, "No more *paper timesheets*", "Digital time clock and one-tap sign-off.", "exec-woman", { desk: raw("c07-timesheets-desk") }],
  ["19-same-provider-every-week", C, "Same provider *every week*", "Standing bookings, booked automatically.", "chiro", { desk: raw("c09-my-providers-desk") }],
  ["20-pi-clinics", C, "PI clinic? *Stay open.*", "Don't lose patients to a missed day.", "lead", { desk: `${HERE}/screens/pi-clinics-desk.png`, url: "coverageoncall.com/personal-injury-clinics" }],
  ["21-provider-signup", P, "Sign up & get *verified*", "License, malpractice, payouts. All online.", "pt-man", { phone: raw("p12-credentials-phone") }],
  ["22-set-your-minimum-pay", P, "Set your *minimum pay*", "Only see shifts that pay what you want.", "latina-nurse", { phone: raw("p03-shift-detail-phone") }],
  ["23-go-on-call", P, "Go *On Call*", "Get confirmed instantly for nearby shifts.", "black-nurse", { phone: raw("p17-on-call-phone") }],
  ["24-clinic-signup", C, "Get your clinic *ready today*", "A short checklist, then post your first shift.", "manager", { desk: raw("c01-dashboard-desk") }],
  ["25-be-ready-today", C, "Be ready *before you need us*", "Set up now. Book in minutes later.", "asian-nurse", { phone: raw("c08-shifts-phone") }],
  ["26-be-ready-to-earn", P, "Be ready *to earn*", "Finish setup now, take shifts sooner.", "pt-woman", { phone: raw("p01-dashboard-phone") }],
  ["27-fly-in", P, "Fly in. *Get paid.*", "Shifts in Puerto Rico & the USVI.", "lead", { phone: raw("p03-shift-detail-phone") }],
  ["28-the-app", B, "Coverage *in your pocket*", "One app for clinics and providers.", null, { phone: raw("c01-dashboard-phone"), phone2: raw("p01-dashboard-phone") }],
  ["29-rewards", P, "Earn *rewards* every shift", "Points, levels and badges on your profile.", "older-man", { phone: raw("p13-public-profile-phone") }],
  ["30-no-patient-data", B, "No patient data. *Ever.*", "Coverage without the privacy risk.", "exec-woman", { shield: true }],
  ["31-need-help-now", B, "Need help *now?*", "A real person, within minutes.", "phone-woman", { phone: `${HERE}/screens/help-phone.png` }],
  // Enroll-now reels (Oct 2026): no people (owner), screens from the reels themselves.
  ["32-ready-before-you-need-it", C, "Ready *before you need it*", "Enroll in minutes. Pay only when booked.", null, { phone: `${HERE}/screens/enroll-rb-verified-phone.png`, phone2: `${HERE}/screens/enroll-rb-price-phone.png` }],
  ["34-providers-be-ready", P, "Providers:<br>*be ready*", "Enroll free. See your pay before you apply.", null, { phone: `${HERE}/screens/enroll-pr-shifts-phone.png`, phone2: `${HERE}/screens/enroll-pr-pay-phone.png` }],
  ["33-six-am-sick-call", C, "6 AM.<br>*A sick call?*", "Enrolled? Post the day in a minute.", null, { phone: `${HERE}/screens/enroll-am-price-phone.png`, phone2: `${HERE}/screens/enroll-am-posted-phone.png` }],
];
// Cut-outs from Canva previews: some have a hard, straight edge where Canva cropped them.
// left: hidden under the phone/browser; right: bled off the canvas edge. Clean ones need nothing.
// left: fraction of the width (from the left) to keep under the device; right: true = bleed off the canvas.
// deskSink: lower the person by this fraction of their height in browser layouts (hides a cut near the bottom).
// deskDrop: the cut can't be hidden behind a browser window, so browser layouts go without this person.
const EDGES = {
  "asian-nurse": { left: 0.08, deskDrop: true }, "black-nurse": { left: 0.23, deskDrop: true },
  chiro: { left: 0.18, deskSink: 0.25 }, "glasses-man": { left: 0.38, deskDrop: true },
  "latina-nurse": { left: 0.07, deskDrop: true }, "older-doc": { left: 0.15, deskDrop: true },
  "older-man": { left: 0.08, deskDrop: true }, "pt-man": { left: 0.08, deskDrop: true },
  "smile-man": { left: 0.14, right: true, deskDrop: true }, "phone-man": { right: true },
};
const url = (p) => "file://" + p;
const css = `
@font-face{font-family:Inter;font-weight:100 900;src:url(file://${M}/apps/web/.next/static/media/83afe278b6a6bb3c-s.p.2bn3s6zvc0dyp.woff2)}
@font-face{font-family:Outfit;font-weight:700;src:url(file://${M}/apps/web/.next/static/media/1b99372b3eaef0c8-s.p.1gsd1jahc5dg_.woff2)}
*{box-sizing:border-box;margin:0}
body{width:1280px;height:720px;overflow:hidden}
#c{position:relative;width:1280px;height:720px;overflow:hidden;color:#fff;font-family:Inter,sans-serif;
  background:radial-gradient(760px 620px at 100% 0%, rgba(34,196,190,.55), transparent 62%), radial-gradient(620px 520px at -8% 112%, rgba(34,196,190,.25), transparent 60%), linear-gradient(160deg,#2f2a86 0%,#282472 42%,#161441 100%)}
.logo{position:absolute;left:56px;top:46px;height:46px}
.pill{position:absolute;left:56px;top:128px;border:2px solid rgba(106,226,217,.85);color:#a3f0e9;border-radius:999px;padding:8px 18px;font-weight:700;letter-spacing:.12em;font-size:17px}
.text{position:absolute;left:56px;top:186px;width:610px}
.h{font-family:Outfit,Inter,sans-serif;font-weight:700;letter-spacing:-.025em;line-height:1.0;font-size:96px;text-shadow:0 6px 30px rgba(0,0,0,.25)}
.h b{color:#22C4BE;font-weight:700}
.s{color:#d6d4f3;font-size:30px;line-height:1.3;margin-top:24px;font-weight:500}
.url{position:absolute;left:56px;bottom:40px;color:#a3f0e9;font-weight:600;font-size:22px;letter-spacing:.02em}
.phone{position:absolute;background:#0e0d2b;padding:10px;border-radius:46px;box-shadow:0 30px 70px rgba(0,0,0,.5),0 0 0 2px rgba(255,255,255,.1)}
.phone img{display:block;border-radius:37px;width:100%;height:100%;object-fit:cover;object-position:top}
.browser{position:absolute;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 30px 70px rgba(0,0,0,.5)}
.bar{height:34px;background:#eef0f5;display:flex;align-items:center;gap:7px;padding:0 14px}
.bar i{width:10px;height:10px;border-radius:50%;background:#cfd3dc;display:block}
.bar span{margin-left:12px;background:#fff;border-radius:999px;padding:3px 14px;font-size:12px;color:#64748b}
.browser img{display:block;width:100%;height:calc(100% - 34px);object-fit:cover;object-position:top left}
.person{position:absolute;bottom:0;filter:drop-shadow(0 20px 40px rgba(0,0,0,.45))}
.fade{position:absolute;left:0;right:0;bottom:0;height:80px;background:linear-gradient(rgba(22,20,65,0),rgba(22,20,65,.95))}
.shield{position:absolute;left:760px;top:150px;width:300px;height:300px;border-radius:50%;display:grid;place-items:center;
  background:radial-gradient(circle at 30% 25%, rgba(255,255,255,.22), rgba(255,255,255,.06) 60%);box-shadow:0 0 0 10px rgba(34,196,190,.85),0 0 0 26px rgba(34,196,190,.18),0 30px 80px rgba(0,0,0,.45)}
`;
const PHONE_AR = 390 / 844;
function phoneBox(img, x, y, h, rot = 0, z = 3) {
  const w = (h - 20) * PHONE_AR + 20;
  return `<div class="phone dev" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;transform:rotate(${rot}deg);z-index:${z}"><img src="${url(img)}"></div>`;
}
function browserBox(img, x, y, w, address = "coverageoncall.com", z = 1) {
  const h = (w * 900) / 1440 + 34;
  return `<div class="browser dev" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;z-index:${z}"><div class="bar"><i></i><i></i><i></i><span>${address}</span></div><img src="${url(img)}"></div>`;
}
function layout([file, aud, head, sub, person, v]) {
  const h = head.replace(/\*(.+?)\*/g, "<b>$1</b>");
  let visual = "";
  if (v.phone2) {
    visual = phoneBox(v.phone, 760, 70, 600, -6, 2) + phoneBox(v.phone2, 980, 110, 600, 5, 3);
  } else if (v.desk) {
    visual = browserBox(v.desk, 650, 140, 590, v.url);
  } else if (v.shield) {
    visual = `<div class="shield"><svg viewBox="0 0 24 24" width="160" height="160" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m4.5 4.5 15 15"/></svg></div>`;
  } else if (v.desk) {
    visual = browserBox(v.desk, person ? 600 : 650, person ? 150 : 140, person ? 520 : 590, v.url);
  } else if (v.phone) {
    visual = phoneBox(v.phone, person ? 700 : 880, 62, 610, person ? -4 : -3);
  }
  let ppl = "";
  const edges = person ? EDGES[person] || {} : {};
  // A hard left edge can't be hidden behind the shield or two phones: those go without a person.
  if (person && !(edges.left && (v.shield || v.phone2)) && !(v.desk && edges.deskDrop)) {
    const ph = person === "phone-man" ? 470 : person === "phone-woman" ? 560 : 640;
    const coverL = v.desk && edges.deskSink ? 0 : edges.left || 0;
    const z = v.desk ? (coverL ? 0 : 4) : 2;
    ppl = `<img class="person" data-left="${coverL}" data-right="${edges.right ? 1 : 0}" src="${url(`${HERE}/people/${person}.png`)}" style="height:${ph}px;right:-20px;bottom:${v.desk && edges.deskSink ? -Math.round(ph * edges.deskSink) : 0}px;z-index:${z}">`;
  } else if (v.desk) {
    visual = browserBox(v.desk, 650, 140, 590, v.url);
  } else if (v.shield) {
    visual = visual.replace('class="shield"', 'class="shield" style="left:820px;top:190px"');
  }
  return `<div id="c"><img class="logo" src="${url(`${M}/apps/web/public/brand/logo-white.svg`)}">
    <div class="pill">${aud}</div>
    <div class="text" style="width:${v.desk ? 540 : 610}px"><div class="h">${h}</div><div class="s">${sub}</div></div>
    ${visual}${ppl}<div class="fade" style="z-index:5;height:${person && person.startsWith("phone-") ? 150 : 80}px"></div>
    <div class="url" style="z-index:6">coverageoncall.com</div></div>`;
}
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const only = process.env.ONLY ? process.env.ONLY.split(",") : null;
  for (let t of T) {
    if (only && !only.some((o) => t[0].startsWith(o))) continue;
    // NOPEOPLE=1: render without the people cut-outs (owner, Oct 2026: they've been used enough).
    if (process.env.NOPEOPLE) t = [...t.slice(0, 4), null, t[5]];
    fs.writeFileSync(path.join(OUT, "_page.html"), `<html><head><style>${css}</style></head><body>${layout(t)}</body></html>`);
    await p.goto("file://" + path.join(OUT, "_page.html"));
    await p.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((i) => (i.complete ? 0 : new Promise((r) => (i.onload = i.onerror = r)))));
      // People with a hard left edge: slide the phone/browser over their left third (it sits on top);
      // a hard right edge bleeds off the canvas.
      const per = document.querySelector(".person"), dev = document.querySelector(".dev");
      if (per && dev) {
        const coverL = +per.dataset.left, pw = per.offsetWidth, W = 1280;
        const bleed = +per.dataset.right ? Math.round(pw * 0.08) : 20;
        per.style.right = -bleed + "px";
        if (coverL) {
          const left = W + bleed - pw, dw = dev.offsetWidth;
          // The phone is tilted, so give its edge 26px of slack.
          const target = left + pw * coverL + 26;
          const minX = dev.classList.contains("browser") ? 600 : 660, maxX = 920;
          const dx = Math.max(minX, Math.min(maxX, Math.round(target - dw)));
          dev.style.left = dx + "px";
          dev.style.zIndex = 3;
          if (dx + dw < target) { per.style.right = "auto"; per.style.left = Math.round(dx + dw - 26 - pw * coverL) + "px"; }
        }
      }
      // Headline: shrink until headline + sub fit above the URL line.
      const h = document.querySelector(".h"), txt = document.querySelector(".text");
      let fs = 96;
      while ((txt.offsetTop + txt.offsetHeight > 640 || h.offsetHeight > 3 * fs * 1.02 || h.scrollWidth > txt.clientWidth + 2) && fs > 54) { fs -= 2; h.style.fontSize = fs + "px"; }
    });
    await p.screenshot({ path: `${OUT}/${t[0]}.png` });
  }
  fs.rmSync(path.join(OUT, "_page.html"), { force: true });
  await b.close();
  console.log("done");
})();
