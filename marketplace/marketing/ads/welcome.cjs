// "Welcome Discount" clinic ad set (Oct 2026, docs/specs/welcome-discount.md): 15% off a clinic's first 3
// completed coverage bookings, no code, no expiration. House theme, real logo and app screens, no people.
//   node marketing/ads/welcome.cjs stills   → 5 feed slides (1080x1350), 5 story frames (1080x1920), 1 square post (1080x1080)
//   node marketing/ads/welcome.cjs frames <story|feed> <dir> <fps> <t1,t2,t3,t4 scene starts in s> <total s>
//                                         → PNG frames for the explainer reel (the voiced mix is done with ffmpeg)
// Needs dist/marketing/screenshots/ and a web build for the fonts. OUT=dir changes the stills folder
// (default marketing/ads/out/welcome, ignored by git).
// Example price: $575 is the busy full-day rate in Florida's smaller cities (seedData FL-Smaller cities); 15% = $86.25.
const fs = require("fs");
const path = require("path");
const { chromium } = require("/opt/node22/lib/node_modules/playwright");
const M = path.resolve(__dirname, "../..");
const OUT = process.env.OUT || path.join(__dirname, "out", "welcome");
const url = (p) => "file://" + p;
const screen = (n) => url(`${M}/dist/marketing/screenshots/${n}.png`);
const LOGO = url(`${M}/apps/web/public/brand/logo-white.svg`);

const css = (W, H) => `
@font-face{font-family:Inter;font-weight:100 900;src:url(file://${M}/apps/web/.next/static/media/83afe278b6a6bb3c-s.p.2bn3s6zvc0dyp.woff2)}
@font-face{font-family:Outfit;font-weight:700;src:url(file://${M}/apps/web/.next/static/media/1b99372b3eaef0c8-s.p.1gsd1jahc5dg_.woff2)}
*{box-sizing:border-box;margin:0}
body{width:${W}px;height:${H}px;overflow:hidden}
#c{position:relative;width:${W}px;height:${H}px;overflow:hidden;color:#fff;font-family:Inter,sans-serif;
  background:radial-gradient(900px 760px at 100% 0%, rgba(34,196,190,.45), transparent 62%), radial-gradient(800px 700px at -10% 105%, rgba(34,196,190,.22), transparent 60%), linear-gradient(165deg,#2f2a86 0%,#282472 45%,#141238 100%)}
.logo{position:absolute;left:64px;height:52px}
.pill{position:absolute;left:64px;border:2px solid rgba(106,226,217,.85);color:#a3f0e9;border-radius:999px;padding:9px 20px;font-weight:700;letter-spacing:.14em;font-size:19px}
.text{position:absolute;left:64px;right:64px}
.h{font-family:Outfit,Inter,sans-serif;font-weight:700;letter-spacing:-.025em;line-height:1.02;font-size:112px;text-shadow:0 6px 30px rgba(0,0,0,.25)}
.h b{color:#22C4BE;font-weight:700}
.s{color:#dcdaf5;font-size:36px;line-height:1.32;margin-top:26px;font-weight:500;max-width:900px}
.url{position:absolute;left:64px;color:#a3f0e9;font-weight:600;font-size:26px;letter-spacing:.02em}
.phone{position:absolute;background:#0e0d2b;padding:12px;border-radius:52px;box-shadow:0 34px 80px rgba(0,0,0,.5),0 0 0 2px rgba(255,255,255,.1)}
.phone img{display:block;border-radius:41px;width:100%;height:100%;object-fit:cover;object-position:top}
.fade{position:absolute;left:0;right:0;bottom:0;background:linear-gradient(rgba(20,18,56,0),rgba(20,18,56,.96))}
.card{position:absolute;background:#fff;color:#1e1b4b;border-radius:28px;box-shadow:0 30px 80px rgba(0,0,0,.45)}
.check{display:flex;gap:20px;align-items:flex-start;font-size:34px;line-height:1.25;font-weight:600;margin-bottom:30px}
.check svg{flex:none;margin-top:2px}
.btn{position:absolute;left:64px;background:#22C4BE;color:#141238;font-weight:800;font-size:38px;border-radius:999px;padding:24px 44px;box-shadow:0 18px 40px rgba(34,196,190,.35)}
.big{font-family:Outfit,Inter,sans-serif;font-weight:700;line-height:.86;letter-spacing:-.04em;color:#22C4BE;text-shadow:0 10px 50px rgba(34,196,190,.35)}
.ticket{position:absolute;display:flex;align-items:center;gap:22px;background:#fff;color:#282472;border-radius:24px;padding:22px 30px;box-shadow:0 24px 60px rgba(0,0,0,.4);font-weight:700}
.ticket .n{font-family:Outfit,Inter;font-size:1.5em;color:#22C4BE}
.ticket .tag{margin-left:auto;background:#d8f5f3;color:#0f766e;border-radius:999px;padding:6px 16px;font-size:.72em;letter-spacing:.06em}
.price{padding:34px 38px;font-size:30px}
.price .row{display:flex;justify-content:space-between;gap:24px;padding:10px 0}
.price .disc{color:#047857;font-weight:700}
.price .tot{border-top:2px solid #e2e8f0;margin-top:8px;padding-top:18px;font-family:Outfit,Inter;font-size:42px;color:#282472}
.price .note{color:#64748b;font-size:20px;margin-top:12px}
.price .was{text-decoration:line-through;color:#94a3b8;font-weight:500}
.code{position:absolute;display:flex;align-items:center;gap:16px;background:rgba(255,255,255,.1);border:3px dashed rgba(255,255,255,.4);color:#dcdaf5;border-radius:20px;padding:22px 30px;font-family:ui-monospace,monospace;font-size:34px;letter-spacing:.1em}
.strike{position:absolute;left:-12px;right:-12px;top:50%;height:7px;background:#22C4BE;border-radius:4px;transform:rotate(-7deg)}
.dots{display:flex;gap:18px}
.dots i{display:block;width:34px;height:34px;border-radius:50%;background:#22C4BE;box-shadow:0 0 0 6px rgba(34,196,190,.2)}
/* video: scenes fade in and out; elements animate in with .in (delay via --d) */
.scene{position:absolute;inset:0;opacity:0}
.in{opacity:0;animation:rise .7s cubic-bezier(.2,.8,.2,1) forwards;animation-delay:var(--d,0s)}
.pop{opacity:0;animation:pop .6s cubic-bezier(.2,1.4,.4,1) forwards;animation-delay:var(--d,0s)}
.draw{transform:scaleX(0);transform-origin:left;animation:draw .5s ease-out forwards;animation-delay:var(--d,0s)}
@keyframes rise{from{opacity:0;transform:translateY(46px)}to{opacity:1;transform:none}}
@keyframes pop{0%{opacity:0;transform:scale(.6)}100%{opacity:1;transform:scale(1)}}
@keyframes draw{to{transform:scaleX(1) rotate(-7deg)}}
@keyframes drift{from{transform:translateY(0)}to{transform:translateY(-40px)}}
`;

const CHECK = `<svg width="40" height="40" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="11" fill="#22C4BE"/><path d="m7 12.5 3.2 3.2L17 9" stroke="#141238" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const GIFT = (s = 64) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="#22C4BE" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/></svg>`;
const phone = (img, x, y, h, rot = 0, z = 3, cls = "") => `<div class="phone ${cls}" style="left:${x}px;top:${y}px;width:${(h - 24) * (390 / 844) + 24}px;height:${h}px;transform:rotate(${rot}deg);z-index:${z}"><img src="${screen(img)}"></div>`;
const tickets = (x, y, w, fs, cls = "", d0 = 0) =>
  [1, 2, 3].map((n, i) => `<div class="ticket ${cls}" style="left:${x + i * 18}px;top:${y + i * (fs * 3.1)}px;width:${w}px;font-size:${fs}px;--d:${d0 + i * 0.35}s;transform:rotate(${[-2, 1, -1][i]}deg)"><span class="n">${n}</span><span>Booking ${n}</span><span class="tag">15% OFF</span></div>`).join("");
const priceCard = (x, y, w, cls = "", d = 0) => `<div class="card price ${cls}" style="left:${x}px;top:${y}px;width:${w}px;--d:${d}s;z-index:6">
  <div class="row"><span>Coverage, full day</span><span class="was">$575.00</span></div>
  <div class="row disc"><span>Welcome Discount (15%)</span><span>−$86.25</span></div>
  <div class="row tot"><span>You pay</span><span>$488.75</span></div>
  <div class="note">Example: a busy full day in a smaller Florida city. Rates vary by region; travel is separate.</div></div>`;
const noCode = (x, y, fs, cls = "", d = 0, dl = 0.5) => `<div class="code ${cls}" style="left:${x}px;top:${y}px;font-size:${fs}px;--d:${d}s">PROMO CODE<span style="position:relative;display:inline-block;width:0;height:0"></span><div class="strike draw" style="--d:${d + dl}s"></div></div>`;

// ---------------- stills ----------------
function slide(n, f) {
  const { W, H, top, bottom } = f;
  const story = H > 1500, square = W === H;
  const head = (h, s, y = top + 150) => `<div class="text" style="top:${y}px"><div class="h">${h}</div>${s ? `<div class="s">${s}</div>` : ""}</div>`;
  const frame = (inner, opts = {}) => `<div id="c">
    <img class="logo" style="top:${top}px" src="${LOGO}">
    <div class="pill" style="top:${top + 84}px">${opts.pill ?? "WELCOME DISCOUNT · FOR CLINICS"}</div>
    ${inner}
    ${opts.fade === false ? "" : `<div class="fade" style="z-index:5;height:${story ? 360 : 160}px"></div>`}
    ${opts.url === false ? "" : `<div class="url" style="z-index:6;top:${bottom - 40}px">coverageoncall.com</div>`}</div>`;

  if (n === 0) {
    // Square single-image post: the whole offer at a glance.
    return frame(`<div class="text" style="top:${top + 160}px"><div class="big" style="font-size:300px">15%<span style="font-size:120px;color:#fff"> off</span></div>
        <div class="h" style="font-size:66px;margin-top:20px">your first 3<br><b>coverage bookings.</b></div>
        <div class="s" style="font-size:32px">No promo code. No expiration. Applied automatically.</div>
        <div style="display:flex;gap:16px;margin-top:34px">${[1, 2, 3].map((n) => `<div style="background:#fff;color:#282472;border-radius:18px;padding:14px 22px;font-weight:700;font-size:26px;box-shadow:0 14px 34px rgba(0,0,0,.35)"><span style="font-family:Outfit;color:#22C4BE">${n}</span> · 15% off</div>`).join("")}</div></div>`
      + `<div class="btn" style="top:${bottom - 150}px;font-size:32px;padding:20px 36px;z-index:7">Create your free clinic account →</div>`, { url: false, fade: false });
  }
  if (n === 1) {
    return frame(`<div class="text" style="top:${top + 150}px"><div class="big" style="font-size:${story ? 380 : 330}px">15%</div>
        <div class="h" style="margin-top:18px">off your first<br><b>3 bookings.</b></div>
        <div class="s">Welcome to Coverage On Call. Your clinic's first three coverage bookings are 15% off.</div></div>`
      + `<div data-after="${story ? 70 : 40}" style="position:absolute;left:0;top:0;width:${W}px">${tickets(64, 0, story ? 820 : 640, story ? 34 : 28)}</div>`);
  }
  if (n === 2) {
    return frame(head("No code.<br><b>No expiration.</b>", "It's applied automatically when you book. Use it next week or next year.")
      + `<div data-after="${story ? 90 : 50}" style="position:absolute;left:0;top:0;width:${W}px;height:600px">${noCode(64, 0, story ? 40 : 34)}
          <div class="check" style="position:absolute;left:64px;top:${story ? 170 : 140}px;width:${W - 128}px">${CHECK}<span>Automatic at checkout</span></div>
          <div class="check" style="position:absolute;left:64px;top:${story ? 250 : 215}px;width:${W - 128}px">${CHECK}<span>Never expires</span></div>
          <div class="check" style="position:absolute;left:64px;top:${story ? 330 : 290}px;width:${W - 128}px">${CHECK}<span>Shared by everyone on your clinic account</span></div></div>`
      + `<div style="position:absolute;right:80px;bottom:${story ? H - bottom + 30 : 110}px;opacity:.9;transform:rotate(-8deg)">${GIFT(story ? 300 : 230)}</div>`);
  }
  if (n === 3) {
    return frame(head("See the savings<br><b>before you book.</b>", story ? "Your price, the discount and your total are on screen before you post." : "Price, discount and total on screen before you post.")
      + priceCard(64, 0, story ? W - 128 : 600, "", 0).replace('class="card price ', 'data-after="' + (story ? 70 : 44) + '" class="card price ')
      + (story ? phone("c03-post-shift-phone", 420, top + 930, 760, 3, 2) : phone("c03-post-shift-phone", 700, top + 560, 700, 4)));
  }
  if (n === 4) {
    const items = ["Licensed, malpractice-verified providers", "Post in minutes, pick who covers", "Live arrival times on the day", "See how many discounts you have left"];
    return frame(head("Coverage your<br><b>clinic can count on.</b>")
      + `<div data-after="50" style="position:absolute;left:64px;width:${story ? 950 : 560}px;z-index:4">${items.map((t) => `<div class="check">${CHECK}<span>${t}</span></div>`).join("")}</div>`
      + phone("c01-dashboard-phone", story ? 470 : 650, story ? top + 1000 : top + 560, story ? 860 : 740, 4));
  }
  return frame(head("Save 15% on your<br><b>first 3 bookings.</b>", "No code. No expiration.", top + 150)
    + `<div class="btn" data-after="50" style="z-index:7">Claim your welcome benefits →</div>`
    + `<div class="url" data-after="176" style="z-index:7;font-size:30px">coverageoncall.com</div>`
    + phone("c03-post-shift-phone", story ? 120 : 150, story ? top + 860 : top + 780, story ? 900 : 700, -6, 2)
    + phone("c04-applicants-phone", story ? 520 : 560, story ? top + 800 : top + 730, story ? 900 : 700, 5, 3), { url: false });
}

// ---------------- explainer reel ----------------
// Four scenes timed to the voiceover lines; each scene fades over 0.35s.
function reel(f, starts, total) {
  const { W, H, top, bottom } = f;
  const story = H > 1500;
  const sc = (i, inner) => `<div class="scene" id="s${i}">${inner}</div>`;
  const s1 = `<div class="text" style="top:${top + 170}px">
      <div class="big pop" style="font-size:${story ? 400 : 320}px;--d:.15s">15%</div>
      <div class="h in" style="margin-top:18px;--d:.7s">off your first<br><b>3 coverage bookings.</b></div></div>
    ${tickets(64, story ? top + 1060 : top + 820, story ? 820 : 640, story ? 34 : 26, "in", 1.6)}`;
  const s2 = `<div class="text" style="top:${top + 170}px"><div class="h in" style="--d:.1s">No code.<br><b>No expiration.</b></div></div>
    ${noCode(64, story ? top + 520 : top + 450, story ? 44 : 36, "in", 0.8, 0.9)}
    <div class="check in" style="position:absolute;left:64px;top:${story ? top + 720 : top + 610}px;--d:2.2s">${CHECK}<span>Applied automatically</span></div>
    <div class="check in" style="position:absolute;left:64px;top:${story ? top + 810 : top + 690}px;--d:3.0s">${CHECK}<span>Never expires</span></div>
    <div class="pop" style="position:absolute;right:90px;top:${story ? top + 1000 : top + 760}px;--d:3.6s">${GIFT(story ? 220 : 170)}</div>`;
  const s3 = `<div class="text" style="top:${top + 150}px"><div class="h in" style="font-size:${story ? 96 : 84}px;--d:.1s">See your price<br><b>before you book.</b></div></div>
    ${phone("c03-post-shift-phone", story ? 470 : 610, story ? top + 520 : top + 400, story ? 900 : 760, 4, 3, "in")}
    ${priceCard(40, story ? top + 900 : top + 640, story ? 640 : 600, "in", 1.8)}`;
  const s4 = `<div class="text" style="top:${top + 170}px"><div class="h in" style="--d:.1s">Save 15% on your<br><b>first 3 bookings.</b></div>
      <div class="s in" style="--d:.8s">No code. No expiration.</div></div>
    <div class="btn pop" style="top:${story ? top + 640 : top + 560}px;--d:1.6s;z-index:7">Create your free clinic account →</div>
    <div class="url in" style="top:${story ? top + 790 : top + 700}px;font-size:34px;--d:2.4s">coverageoncall.com</div>
    ${phone("c01-dashboard-phone", story ? 300 : 560, story ? top + 900 : top + 800, story ? 820 : 640, -4, 2, "in")}`;
  const html = `<div id="c"><img class="logo" style="top:${top}px" src="${LOGO}"><div class="pill" style="top:${top + 84}px">WELCOME DISCOUNT · FOR CLINICS</div>
    ${sc(0, s1)}${sc(1, s2)}${sc(2, s3)}${sc(3, s4)}<div class="fade" style="z-index:5;height:${story ? 300 : 140}px"></div></div>`;
  // Per-frame: each scene's animations run from its own start; scene opacity crossfades.
  const script = `window.at = (t) => {
    const S = ${JSON.stringify(starts)}, T = ${total};
    S.forEach((s, i) => {
      const e = i < S.length - 1 ? S[i + 1] : T + 1, el = document.getElementById('s' + i);
      const o = Math.max(0, Math.min(1, (t - s) / .35, (e - t) / .35));
      el.style.opacity = o;
      for (const a of el.getAnimations({ subtree: true })) { a.pause(); a.currentTime = Math.max(0, (t - s) * 1000); }
    });
  };`;
  return { html, script };
}

async function settle(p) {
  await p.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((i) => (i.complete ? 0 : new Promise((r) => (i.onload = i.onerror = r)))));
  });
}

(async () => {
  const mode = process.argv[2] || "stills";
  const b = await chromium.launch();
  const FORMATS = { feed: { W: 1080, H: 1350, top: 56, bottom: 1300 }, story: { W: 1080, H: 1920, top: 270, bottom: 1600 }, square: { W: 1080, H: 1080, top: 56, bottom: 1030 } };
  if (mode === "stills") {
    fs.mkdirSync(OUT, { recursive: true });
    const jobs = [["feed", [1, 2, 3, 4, 5]], ["story", [1, 2, 3, 4, 5]], ["square", [0]]];
    for (const [name, ns] of jobs) {
      const f = FORMATS[name];
      const p = await b.newPage({ viewport: { width: f.W, height: f.H } });
      for (const n of ns) {
        fs.writeFileSync(path.join(OUT, "_page.html"), `<html><head><style>${css(f.W, f.H)}*{animation:none!important}.draw{transform:rotate(-7deg)}.in,.pop{opacity:1}</style></head><body>${slide(n, f)}</body></html>`);
        await p.goto("file://" + path.join(OUT, "_page.html"));
        await settle(p);
        await p.evaluate(() => {
          const h = document.querySelector(".text .h"), txt = document.querySelector(".text");
          if (h) { let fs = parseFloat(getComputedStyle(h).fontSize); while (h.scrollWidth > txt.clientWidth + 2 && fs > 50) { fs -= 2; h.style.fontSize = fs + "px"; } }
          for (const el of document.querySelectorAll("[data-after]")) el.style.top = txt.offsetTop + txt.offsetHeight + +el.dataset.after + "px";
        });
        await p.screenshot({ path: `${OUT}/${name === "square" ? "square" : `${name}-${n}`}.png` });
      }
      await p.close();
    }
    fs.rmSync(path.join(OUT, "_page.html"), { force: true });
  } else {
    const [, , , fmt, dir, fps, startsCsv, total] = process.argv;
    const f = FORMATS[fmt];
    fs.mkdirSync(dir, { recursive: true });
    const { html, script } = reel(f, startsCsv.split(",").map(Number), +total);
    fs.writeFileSync(path.join(dir, "_page.html"), `<html><head><style>${css(f.W, f.H)}</style></head><body>${html}<script>${script}</script></body></html>`);
    const p = await b.newPage({ viewport: { width: f.W, height: f.H } });
    await p.goto("file://" + path.join(dir, "_page.html"));
    await settle(p);
    const n = Math.round(+total * +fps);
    for (let i = 0; i < n; i++) {
      await p.evaluate((t) => window.at(t), i / +fps);
      await p.screenshot({ path: path.join(dir, `f${String(i).padStart(5, "0")}.png`) });
    }
    fs.rmSync(path.join(dir, "_page.html"), { force: true });
  }
  await b.close();
  console.log("done");
})();
