// "Do you feel it? Change is good." clinic reel (Oct 2026, owner brief): the weather's changing, it's getting
// colder; change to Coverage On Call to find verified, quality coverage doctors at the best price.
// Reel only (1080x1920), no voice; original music from change-music.py. House fonts and colors on the
// brighter variant the owner asked for: white-to-silver background with a brand color line down the left side.
//   node marketing/ads/change.cjs frames <dir> <fps>   → PNG frames (then ffmpeg with the music)
//   node marketing/ads/change.cjs cover <file.png> [t]  → one frame at t s (default 9.6: the reel cover, "Change is good!")
// Needs dist/marketing/screenshots/ and a web build for the fonts.
const fs = require("fs");
const path = require("path");
const { chromium } = require("/opt/node22/lib/node_modules/playwright");
const M = path.resolve(__dirname, "../..");
const url = (p) => "file://" + p;
const screen = (n) => url(`${M}/dist/marketing/screenshots/${n}.png`);
const LOGO = url(`${M}/apps/web/public/brand/logo.svg`);
const W = 1080, H = 1920, TOP = 270, X = 110;
// Scene starts (s), matched to the music: 120 BPM, the drop (minor → major) lands on 8.0 s.
const S = [0, 3.8, 7.85, 11.85, 17.85], T = 24;

const css = `
@font-face{font-family:Inter;font-weight:100 900;src:url(file://${M}/apps/web/.next/static/media/83afe278b6a6bb3c-s.p.2bn3s6zvc0dyp.woff2)}
@font-face{font-family:Outfit;font-weight:700;src:url(file://${M}/apps/web/.next/static/media/1b99372b3eaef0c8-s.p.1gsd1jahc5dg_.woff2)}
*{box-sizing:border-box;margin:0}
body{width:${W}px;height:${H}px;overflow:hidden}
#c{position:relative;width:${W}px;height:${H}px;overflow:hidden;color:#1e1b4b;font-family:Inter,sans-serif;
  background:radial-gradient(900px 700px at 85% 8%, #ffffff 0%, rgba(255,255,255,0) 70%), radial-gradient(700px 600px at 0% 100%, rgba(34,196,190,.10), transparent 70%), linear-gradient(170deg,#ffffff 0%,#f1f3f7 40%,#dde2ea 100%)}
/* the color line down the left side, with a soft glow */
.line{position:absolute;left:0;top:0;bottom:0;width:22px;background:linear-gradient(180deg,#22C4BE 0%,#22C4BE 30%,#282472 100%);box-shadow:0 0 40px rgba(34,196,190,.35);z-index:8}
.line2{position:absolute;left:34px;top:0;bottom:0;width:4px;background:linear-gradient(180deg,rgba(40,36,114,0),rgba(40,36,114,.35) 50%,rgba(34,196,190,0));z-index:8}
.logo{position:absolute;left:${X}px;top:${TOP - 10}px;height:56px;z-index:7}
.pill{position:absolute;left:${X}px;top:${TOP + 72}px;border:2px solid #22C4BE;color:#0f8f8a;background:rgba(34,196,190,.08);border-radius:999px;padding:9px 20px;font-weight:700;letter-spacing:.14em;font-size:19px;z-index:7}
.text{position:absolute;left:${X}px;right:90px}
.h{font-family:Outfit,Inter,sans-serif;font-weight:700;letter-spacing:-.03em;line-height:1.0;font-size:132px;color:#282472}
.h b{color:#14aaa4;font-weight:700}
.s{color:#475569;font-size:40px;line-height:1.32;margin-top:30px;font-weight:500;max-width:860px}
.temp{position:absolute;left:${X}px;font-family:Outfit,Inter;font-weight:700;letter-spacing:-.05em;color:#282472;line-height:.9}
.temp small{font-size:.32em;letter-spacing:0;color:#64748b;margin-left:10px;vertical-align:.95em}
.therm{position:absolute;width:56px;border-radius:28px;background:#fff;box-shadow:inset 0 0 0 4px #cbd5e1,0 14px 30px rgba(15,23,42,.12)}
.therm i{position:absolute;left:14px;right:14px;bottom:14px;border-radius:14px;background:linear-gradient(#22C4BE,#282472)}
.phone{position:absolute;background:#1e1b4b;padding:12px;border-radius:52px;box-shadow:0 40px 90px rgba(30,27,75,.35),0 0 0 2px rgba(30,27,75,.08)}
.phone img{display:block;border-radius:41px;width:100%;height:100%;object-fit:cover;object-position:top}
.check{position:absolute;left:${X}px;display:flex;gap:24px;align-items:center;font-size:46px;line-height:1.2;font-weight:700;color:#1e1b4b;background:#fff;border-radius:26px;padding:22px 32px 22px 24px;box-shadow:0 20px 50px rgba(30,27,75,.12)}
.check svg{flex:none}
.btn{position:absolute;left:${X}px;background:#22C4BE;color:#141238;font-weight:800;font-size:44px;border-radius:999px;padding:28px 50px;box-shadow:0 20px 44px rgba(34,196,190,.4)}
.url{position:absolute;left:${X}px;color:#282472;font-weight:700;font-size:40px;letter-spacing:.01em}
.x{position:absolute;left:-8px;right:-8px;top:52%;height:6px;border-radius:3px;background:#e11d48;transform:scaleX(0);transform-origin:left;animation:strike .4s ease-out forwards;animation-delay:var(--d,0s)}
@keyframes strike{to{transform:scaleX(1)}}
.flake{position:absolute;left:0;top:0;z-index:1;will-change:transform}
.scene{position:absolute;inset:0;opacity:0;z-index:4}
.in{opacity:0;animation:rise .7s cubic-bezier(.2,.8,.2,1) forwards;animation-delay:var(--d,0s)}
.pop{opacity:0;animation:pop .6s cubic-bezier(.2,1.4,.4,1) forwards;animation-delay:var(--d,0s)}
.slam{opacity:0;animation:slam .45s cubic-bezier(.2,1.2,.3,1) forwards;animation-delay:var(--d,0s)}
.wipe{clip-path:inset(0 100% 0 0);animation:wipe .6s cubic-bezier(.6,0,.2,1) forwards;animation-delay:var(--d,0s)}
@keyframes rise{from{opacity:0;transform:translateY(50px)}to{opacity:1;transform:none}}
@keyframes pop{0%{opacity:0;transform:scale(.6)}100%{opacity:1;transform:scale(1)}}
@keyframes slam{0%{opacity:0;transform:scale(1.6)}100%{opacity:1;transform:scale(1)}}
@keyframes wipe{to{clip-path:inset(0 0 0 0)}}
`;

const CHECK = `<svg width="58" height="58" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="11" fill="#22C4BE"/><path d="m7 12.5 3.2 3.2L17 9" stroke="#141238" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const FLAKE = (s, c) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.5" stroke-linecap="round">${[0, 60, 120, 180, 240, 300].map((a) => `<g transform="rotate(${a} 12 12)"><path d="M12 12V2M12 5.5 9.6 3.4M12 5.5l2.4-2.1M12 8.6l-1.8-1.5M12 8.6l1.8-1.5"/></g>`).join("")}</svg>`;
const phone = (img, x, y, h, rot = 0, cls = "", d = 0) => `<div class="phone ${cls}" style="left:${x}px;top:${y}px;width:${(h - 24) * (390 / 844) + 24}px;height:${h}px;transform:rotate(${rot}deg);--d:${d}s;z-index:3"><img src="${screen(img)}"></div>`;

// Deterministic snowfall (seeded), heavier as it gets colder, thinning once we "change".
let seed = 11;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const flakes = Array.from({ length: 34 }, (_, i) => ({ i, x: rnd() * W, y: rnd() * H, s: 18 + rnd() * 46, v: 70 + rnd() * 130, sway: 20 + rnd() * 50, ph: rnd() * 6.28, rot: rnd() * 90, c: rnd() < 0.5 ? "#9fb0c8" : "#7fd3cf", start: rnd() * 6 }));

function html() {
  const sc = (i, inner) => `<div class="scene" id="s${i}">${inner}</div>`;
  const s0 = `<div class="text" style="top:${TOP + 360}px"><div class="h slam" style="font-size:150px;--d:.25s">Do you</div><div class="h slam" style="font-size:190px;--d:1.0s"><b>feel it?</b></div>
      <div class="s in" style="--d:2.0s">Something's changing…</div></div>
    <div class="pop" style="position:absolute;left:520px;top:${TOP + 900}px;--d:1.4s"><div id="bigflake" style="opacity:.16">${FLAKE(560, "#282472")}</div></div>`;
  const s1 = `<div class="text" style="top:${TOP + 280}px"><div class="h in" style="--d:.1s">It's getting<br><b>colder.</b></div></div>
    <div class="therm in" style="left:${X}px;top:${TOP + 760}px;height:420px;--d:.5s"><i id="merc" style="height:300px"></i></div>
    <div class="temp in" style="left:${X + 100}px;top:${TOP + 790}px;font-size:300px;--d:.5s"><span id="deg">78</span>°<small>F</small></div>`;
  const s2 = `<div class="text" style="top:${TOP + 420}px"><div class="h slam" style="font-size:170px;--d:.15s">Change</div><div class="h slam" style="font-size:170px;--d:.65s"><b>is good!</b></div></div>
    <div class="check in" style="top:${TOP + 900}px;--d:1.3s;color:#64748b;background:#eef1f5;box-shadow:none"><span style="position:relative">Calling around for coverage<i class="x" style="--d:2.0s"></i></span></div>
    <div class="check in" style="top:${TOP + 1060}px;--d:2.3s">${CHECK}<span>Post a shift in minutes</span></div>`;
  const s3 = `<div class="text" style="top:${TOP + 210}px"><div class="h in" style="font-size:96px;--d:.05s">Change to</div>
      <img class="wipe" src="${LOGO}" style="display:block;width:840px;margin-top:26px;--d:.45s"></div>
    <div class="check in" style="top:${TOP + 600}px;--d:1.4s">${CHECK}<span>Verified doctors</span></div>
    <div class="check in" style="top:${TOP + 750}px;--d:2.4s">${CHECK}<span>Quality coverage</span></div>
    <div class="check in" style="top:${TOP + 900}px;--d:3.4s">${CHECK}<span>The best price</span></div>
    ${phone("c04-applicants-phone", 600, TOP + 1000, 760, 5, "in", 1.0)}`;
  const s4 = `<div class="text" style="top:${TOP + 230}px"><div class="h in" style="font-size:104px;--d:.05s">Find verified,<br>quality <b>coverage<br>doctors</b></div>
      <div class="s in" style="--d:.8s;font-size:44px;color:#282472;font-weight:700">at the best price.</div></div>
    <div class="btn pop" style="top:${TOP + 900}px;--d:1.6s;z-index:7">Change to Coverage On Call →</div>
    <div class="url in" style="top:${TOP + 1060}px;--d:2.3s">coverageoncall.com</div>
    ${phone("c03-post-shift-phone", 620, TOP + 1160, 640, -4, "in", 1.2)}`;
  const fl = flakes.map((f) => `<div class="flake" id="f${f.i}">${FLAKE(f.s, f.c)}</div>`).join("");
  return `<div id="c"><div class="line"></div><div class="line2"></div>${fl}<img class="logo" id="logo" src="${LOGO}"><div class="pill" id="pill">FOR CLINICS · CHANGE IS GOOD</div>
    ${sc(0, s0)}${sc(1, s1)}${sc(2, s2)}${sc(3, s3)}${sc(4, s4)}</div>`;
}

const script = `
const S = ${JSON.stringify(S)}, T = ${T}, H = ${H}, FL = ${JSON.stringify(flakes)};
window.at = (t) => {
  S.forEach((s, i) => {
    const e = i < S.length - 1 ? S[i + 1] : T + 1, el = document.getElementById('s' + i);
    el.style.opacity = Math.max(0, Math.min(1, (t - s) / .3, (e - t) / .3));
    for (const a of el.getAnimations({ subtree: true })) { a.pause(); a.currentTime = Math.max(0, (t - s) * 1000); }
  });
  // The temperature falls 78° → 48° through scene 2.
  const k = Math.max(0, Math.min(1, (t - S[1] - .6) / 2.6)), e = 1 - Math.pow(1 - k, 3);
  document.getElementById('deg').textContent = Math.round(78 - 30 * e);
  document.getElementById('merc').style.height = (300 - 200 * e) + 'px';
  const bf = document.getElementById('bigflake'); if (bf) bf.style.transform = 'rotate(' + t * 12 + 'deg)';
  // The small logo + pill sit out the logo scene (it has the big logo).
  const hide = Math.max(0, Math.min(1, (t - S[3] + .3) / .3, (S[4] - t) / .3));
  document.getElementById('logo').style.opacity = 1 - hide; document.getElementById('pill').style.opacity = 1 - hide;
  // Snow: starts light, heavier while it's "getting colder", fades back after the change.
  const dens = t < S[1] ? .45 : t < S[2] ? 1 : t < S[3] ? .7 : .35;
  FL.forEach((f) => {
    const el = document.getElementById('f' + f.i), on = (f.i / FL.length) < dens && t >= f.start * (t < S[1] ? 1 : 0);
    const y = ((f.y + f.v * t) % (H + 120)) - 60, x = f.x + Math.sin(t * 1.1 + f.ph) * f.sway;
    el.style.transform = 'translate(' + x + 'px,' + y + 'px) rotate(' + (f.rot + t * 25) + 'deg)';
    el.style.opacity = on ? .85 : 0;
  });
};`;

async function settle(p) {
  await p.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((i) => (i.complete ? 0 : new Promise((r) => (i.onload = i.onerror = r)))));
  });
}

(async () => {
  const [, , mode, a1, fps] = process.argv;
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: W, height: H } });
  const dir = mode === "cover" ? path.dirname(a1) : a1;
  fs.mkdirSync(dir, { recursive: true });
  const page = path.join(dir, "_change.html");
  fs.writeFileSync(page, `<html><head><style>${css}</style></head><body>${html()}<script>${script}</script></body></html>`);
  await p.goto("file://" + page);
  await settle(p);
  if (mode === "cover") {
    await p.evaluate((t) => window.at(t), +(fps || 9.6));
    await p.screenshot({ path: a1 });
  } else {
    const n = Math.round(T * +fps);
    for (let i = 0; i < n; i++) {
      await p.evaluate((t) => window.at(t), i / +fps);
      await p.screenshot({ path: path.join(dir, `f${String(i).padStart(5, "0")}.png`) });
    }
  }
  fs.rmSync(page, { force: true });
  await b.close();
  console.log("done");
})();
