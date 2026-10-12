// "Now Is The Time" holiday coverage ad set (Oct 2026): 5 feed slides (1080x1350) + 5 story frames
// (1080x1920) in the house theme. Real logo and real app screens; no people (owner, Oct 2026: the
// cut-out library has been used enough).
// Run: node marketing/ads/holiday.cjs   (OUT=dir to change the output folder)
const fs = require("fs");
const path = require("path");
const { chromium } = require("/opt/node22/lib/node_modules/playwright");
const M = path.resolve(__dirname, "../..");
const OUT = process.env.OUT || path.join(__dirname, "out", "holiday");
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
.person{position:absolute;bottom:0;filter:drop-shadow(0 22px 44px rgba(0,0,0,.45))}
.fade{position:absolute;left:0;right:0;bottom:0;background:linear-gradient(rgba(20,18,56,0),rgba(20,18,56,.96))}
.flake{position:absolute;opacity:.22}
.card{position:absolute;background:#fff;color:#1e1b4b;border-radius:28px;box-shadow:0 30px 80px rgba(0,0,0,.45)}
.cal h4{font-family:Outfit,Inter,sans-serif;font-size:30px;color:#282472;margin-bottom:12px}
.cal .g{display:grid;grid-template-columns:repeat(7,1fr);gap:6px;font-size:21px;text-align:center}
.cal .g span{height:40px;line-height:40px;border-radius:10px;color:#475569}
.cal .g .dow{color:#94a3b8;font-weight:700;font-size:16px;height:26px;line-height:26px}
.cal .g .hot{background:#22C4BE;color:#fff;font-weight:700}
.cal .g .busy{background:#d8f5f3;color:#0f766e;font-weight:600}
.legend{display:flex;gap:18px;margin-top:16px;font-size:19px;color:#475569;flex-wrap:wrap}
.legend i{display:inline-block;width:16px;height:16px;border-radius:5px;margin-right:7px;vertical-align:-2px}
.check{display:flex;gap:20px;align-items:flex-start;font-size:34px;line-height:1.25;font-weight:600;margin-bottom:30px}
.check svg{flex:none;margin-top:2px}
.btn{position:absolute;left:64px;background:#22C4BE;color:#141238;font-weight:800;font-size:38px;border-radius:999px;padding:24px 44px;box-shadow:0 18px 40px rgba(34,196,190,.35)}
`;

const FLAKE = (x, y, s, rot = 0, op = 0.22) => `<svg class="flake" style="left:${x}px;top:${y}px;opacity:${op};transform:rotate(${rot}deg)" width="${s}" height="${s}" viewBox="0 0 48 48" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round">
  ${[0, 60, 120].map((a) => `<g transform="rotate(${a} 24 24)"><path d="M24 3v42"/><path d="M24 10l-5-5M24 10l5-5M24 38l-5 5M24 38l5 5"/></g>`).join("")}</svg>`;
// A string of lights across the top: teal, white and a warm white, on a soft curve.
function lights(W, y) {
  const n = 15, pts = [];
  for (let i = 0; i <= n; i++) { const t = i / n; pts.push([t * (W + 40) - 20, y + Math.sin(t * Math.PI * 3) * 18 + 24 * Math.sin(t * Math.PI)]); }
  const d = "M" + pts.map((p) => p.map(Math.round).join(" ")).join(" L");
  const cols = ["#22C4BE", "#ffffff", "#ffe7b0"];
  const bulbs = pts.slice(1, -1).map((p, i) => `<circle cx="${Math.round(p[0])}" cy="${Math.round(p[1] + 14)}" r="9" fill="${cols[i % 3]}" opacity=".95"/><circle cx="${Math.round(p[0])}" cy="${Math.round(p[1] + 14)}" r="22" fill="${cols[i % 3]}" opacity=".16"/>`).join("");
  return `<svg style="position:absolute;left:0;top:0" width="${W}" height="${y + 90}"><path d="${d}" stroke="rgba(255,255,255,.35)" stroke-width="2" fill="none"/>${bulbs}</svg>`;
}
const CHECK = `<svg width="40" height="40" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="11" fill="#22C4BE"/><path d="m7 12.5 3.2 3.2L17 9" stroke="#141238" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// Month grids for Nov and Dec 2026 (+ Jan 1 2027): holiday days solid, the rest of those weeks light.
function month(y, m, hot, busy) {
  const first = new Date(Date.UTC(y, m, 1)).getUTCDay(), days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const name = new Date(Date.UTC(y, m, 1)).toLocaleString("en-US", { month: "long", timeZone: "UTC" });
  let cells = ["S", "M", "T", "W", "T", "F", "S"].map((d) => `<span class="dow">${d}</span>`).join("");
  for (let i = 0; i < first; i++) cells += "<span></span>";
  for (let d = 1; d <= days; d++) cells += `<span class="${hot.includes(d) ? "hot" : busy.includes(d) ? "busy" : ""}">${d}</span>`;
  return `<div><h4>${name} ${y}</h4><div class="g">${cells}</div></div>`;
}
function calendar(x, y, w) {
  return `<div class="card cal" style="left:${x}px;top:${y}px;width:${w}px;padding:34px 36px 30px">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:34px">
      ${month(2026, 10, [26, 27], [23, 24, 25])}
      ${month(2026, 11, [24, 25, 31], [21, 22, 23, 28, 29, 30])}
    </div>
    <div class="legend"><span><i style="background:#22C4BE"></i>Holidays</span><span><i style="background:#d8f5f3"></i>Popular days off</span><span>+ New Year's Day, Jan 1</span></div>
  </div>`;
}
const phone = (img, x, y, h, rot = 0, z = 3) => `<div class="phone" style="left:${x}px;top:${y}px;width:${(h - 24) * (390 / 844) + 24}px;height:${h}px;transform:rotate(${rot}deg);z-index:${z}"><img src="${screen(img)}"></div>`;

// One slide; f = format { W, H, top (first safe y), bottom (last safe y) }.
function slide(n, f) {
  const { W, H, top, bottom } = f;
  const story = H > 1500;
  const head = (h, s, y = top + 150) => `<div class="text" style="top:${y}px"><div class="h">${h}</div>${s ? `<div class="s">${s}</div>` : ""}</div>`;
  const frame = (inner, opts = {}) => `<div id="c">${lights(W, story ? top - 70 : 0)}
    ${FLAKE(W - 210, top + 40, 120, 12)}${FLAKE(W - 380, top + 230, 60, 30, 0.16)}${FLAKE(40, bottom - 420, 70, 8, 0.12)}
    <img class="logo" style="top:${top}px" src="${LOGO}">
    <div class="pill" style="top:${top + 84}px">${opts.pill ?? "HOLIDAY COVERAGE"}</div>
    ${inner}
    ${opts.fade === false ? "" : `<div class="fade" style="z-index:5;height:${story ? 380 : 170}px"></div>`}
    ${opts.url === false ? "" : `<div class="url" style="z-index:6;top:${bottom - 40}px">coverageoncall.com</div>`}</div>`;

  if (n === 1) {
    // A big "calendar page" for the busiest day, stamped covered.
    const cw = story ? 640 : 520, cx = story ? (W - cw) / 2 : W - cw - 80;
    return frame(head("Now is<br><b>the time.</b>", "Plan your holiday schedule and book your coverage before the rush.", top + 150)
      + `<div data-after="${story ? 120 : 70}" style="position:absolute;left:${cx}px;width:${cw}px;transform:rotate(-4deg);z-index:3">
          <div class="card" style="position:relative;overflow:hidden;padding:0;width:${cw}px">
            <div style="background:#22C4BE;color:#141238;font-family:Outfit,Inter;font-weight:700;font-size:${cw * 0.09}px;letter-spacing:.12em;text-align:center;padding:${cw * 0.04}px 0">DECEMBER</div>
            <div style="font-family:Outfit,Inter;font-weight:700;font-size:${cw * 0.5}px;line-height:1;text-align:center;color:#282472;padding:${cw * 0.05}px 0 ${cw * 0.02}px">24</div>
            <div style="text-align:center;color:#64748b;font-size:${cw * 0.055}px;padding-bottom:${cw * 0.07}px">Thursday</div>
          </div>
          <div style="position:absolute;right:${-cw * 0.1}px;top:${cw * 0.62}px;transform:rotate(12deg);background:#141238;border:4px solid #22C4BE;color:#22C4BE;border-radius:999px;padding:${cw * 0.03}px ${cw * 0.06}px;font-weight:800;font-size:${cw * 0.07}px;letter-spacing:.06em;box-shadow:0 18px 40px rgba(0,0,0,.4)">✓ COVERED</div>
        </div>`
      + FLAKE(story ? 90 : 120, story ? bottom - 220 : bottom - 330, story ? 150 : 110, -10, 0.18));
  }
  if (n === 2) {
    return frame(head("Holiday weeks<br><b>fill fast.</b>", "It's one of the busiest times of the year for coverage requests. Book early for the best match.")
      + `<div data-after="${story ? 80 : 44}" style="position:absolute;left:0;top:0">${calendar(64, 0, W - 128)}</div>`);
  }
  if (n === 3) {
    const chip = (t, x, y, rot) => `<div class="card" style="left:${x}px;top:${y}px;padding:22px 30px;font-size:${story ? 34 : 30}px;font-weight:700;color:#282472;transform:rotate(${rot}deg);z-index:6;display:flex;gap:14px;align-items:center">${CHECK}${t}</div>`;
    return frame(head("Every holiday date,<br><b>one booking.</b>", story ? "Add all the days you'll be out at once. Keep the same provider for every day if you'd like." : "Add every day you'll be out at once. Same provider for all of them, if you'd like.")
      + phone("c03-post-shift-phone", story ? 330 : 470, story ? top + 640 : top + 500, story ? 1040 : 800, 3)
      + chip("Dec 21 – Dec 24 · 4 days", 40, story ? top + 860 : top + 620, -3)
      + chip("Same provider, every day", 40, story ? top + 1010 : top + 760, 2), { url: !story });
  }
  if (n === 4) {
    const items = ["Licensed, malpractice-verified providers", "Your price shown before you post", "Live arrival times on the day", "Digital timesheet, one-tap sign-off"];
    return frame(head("Everyone's<br><b>covered.</b>", "Your office, your staff and your patients.")
      + `<div data-after="50" style="position:absolute;left:64px;width:${story ? 950 : 540}px;z-index:4">${items.map((t) => `<div class="check">${CHECK}<span>${t}</span></div>`).join("")}</div>`
      + phone("c04-applicants-phone", story ? 470 : 640, story ? top + 1000 : top + 520, story ? 860 : 760, 4));
  }
  // 5: CTA with the clinic's dashboard and "today" screen (provider on the way).
  return frame(head("Enjoy the holidays.<br><b>We've got your office.</b>", null, top + 150)
    + `<div class="btn" data-after="44" style="z-index:7">Book holiday coverage →</div>`
    + `<div class="url" data-after="170" style="z-index:7;font-size:30px">coverageoncall.com</div>`
    + phone("c01-dashboard-phone", story ? 120 : 150, story ? top + 860 : top + 770, story ? 900 : 700, -6, 2)
    + phone("c05-today-provider-phone", story ? 520 : 560, story ? top + 800 : top + 720, story ? 900 : 700, 5, 3)
    + FLAKE(story ? 860 : 900, story ? top + 640 : top + 520, 90, 20, 0.2), { url: false });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch();
  for (const [name, f] of [["feed", { W: 1080, H: 1350, top: 56, bottom: 1300 }], ["story", { W: 1080, H: 1920, top: 270, bottom: 1600 }]]) {
    const p = await b.newPage({ viewport: { width: f.W, height: f.H } });
    for (let n = 1; n <= 5; n++) {
      fs.writeFileSync(path.join(OUT, "_page.html"), `<html><head><style>${css(f.W, f.H)}</style></head><body>${slide(n, f)}</body></html>`);
      await p.goto("file://" + path.join(OUT, "_page.html"));
      await p.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all([...document.images].map((i) => (i.complete ? 0 : new Promise((r) => (i.onload = i.onerror = r)))));
        const h = document.querySelector(".h"), txt = document.querySelector(".text");
        let fs = 112;
        while (h.scrollWidth > txt.clientWidth + 2 && fs > 60) { fs -= 2; h.style.fontSize = fs + "px"; }
        // Content that follows the headline sits just below it, whatever its final size.
        for (const el of document.querySelectorAll("[data-after]")) el.style.top = txt.offsetTop + txt.offsetHeight + +el.dataset.after + "px";
      });
      await p.screenshot({ path: `${OUT}/${name}-${n}.png` });
    }
    await p.close();
  }
  fs.rmSync(path.join(OUT, "_page.html"), { force: true });
  await b.close();
  console.log("done", OUT);
})();
