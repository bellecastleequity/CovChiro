#!/usr/bin/env python3
"""Writes eobgenie.html (the EOB Genie demo layout) from eobgenie.json, the app's
progress-screen CSS and lamp artwork, and the screenshots in shots_eobgenie/.
  python3 make_eobgenie_html.py && python3 tts_gemini.py --scenes eobgenie.json
  python3 build_video.py --scenes eobgenie.json"""
import re, json
import os
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
os.chdir(os.path.dirname(os.path.abspath(__file__)))
css_app = open(os.path.join(ROOT, "pi_portal/public/assets/app.css")).read().splitlines()
gp = '\n'.join(l for l in css_app if (l.startswith('.gp') or l.startswith('@keyframes gp')))
gp = gp.replace('transition:width .25s ease-out;', '')
lamp = re.search(r"const GENIE_LAMP = `(.*?)`;", open(os.path.join(ROOT, "pi_portal/public/assets/app.js")).read(), re.S).group(1)
cfg = json.load(open('eobgenie.json'))
D = [s['min'] for s in cfg['scenes']]
SH = 'shots_eobgenie/'
SHIELD = '<svg viewBox="0 0 24 24" fill="none"><path d="M12 2.5 19.5 5v6c0 4.9-3.2 8.6-7.5 10.5C7.7 19.6 4.5 15.9 4.5 11V5L12 2.5Z" fill="#176A96"/><path d="m8.5 12 2.4 2.4 4.6-4.8" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>'

def copy(eyebrow, h, lead, pts=None, note=None):
    s = f'<div class="copy"><div class="eyebrow a" data-in="0.3" data-fx="up">{eyebrow}</div><h2 class="a" data-in="0.6" data-fx="up">{h}</h2>'
    if lead: s += f'<p class="lead a" data-in="1.2" data-fx="up">{lead}</p>'
    if pts:
        s += '<div class="pts">' + ''.join(f'<div class="pt a" data-in="{1.8 + i * 0.7:.1f}" data-fx="left"><b>✓</b>{p}</div>' for i, p in enumerate(pts)) + '</div>'
    if note: s += f'<p class="note a" data-in="{2.4 + (len(pts or []) * 0.7):.1f}" data-fx="up">{note}</p>'
    return s + '</div>'

def card(img, style, kb=None, din='0.6'):
    k = f' data-kb="{kb}"' if kb else ''
    return f'<div class="card a" data-in="{din}" data-fx="up" style="{style}"><img src="{SH}{img}.png"{k}></div>'

def frame(img, title, pan=None, kb=None):
    a = f' data-pan="{pan}"' if pan else (f' data-kb="{kb}"' if kb else '')
    return f'<div class="frame a" data-in="0.4" data-fx="right"><div class="bar"><i></i><i></i><i></i><span>{title}</span></div><div class="view"><img src="{SH}{img}.png"{a}></div></div>'

sc = {}
sc['g01-open'] = ('dark', f'''<div class="a" data-in="0.2" data-fx="zoom" style="position:absolute;left:0;right:0;top:230px;text-align:center"><img src="assets/eobgenie/logo-dark.png" style="height:200px"></div>
<h1 class="a white" data-in="1.2" data-fx="up" style="position:absolute;left:0;right:0;top:520px;text-align:center">Scanned EOBs, <span class="hl">read and posted.</span></h1>
<p class="a lead" data-in="2.2" data-fx="up" style="position:absolute;left:0;right:0;top:650px;text-align:center;color:rgba(255,255,255,.78)">Auto / PIP EOBs to a checked, posted ledger, in about a minute.</p>
<p class="foot">Fictional demo data: every patient, claim and amount in this video is made up.</p>''')
scans = ''.join(f'<div class="paper a" data-in="{0.4 + i * 0.5:.1f}" data-fx="pop" style="left:{900 + i * 170}px;top:{150 + (i % 2) * 40}px;width:520px;rotate:{[-8, -2, 4, 9][i]}deg"><img src="assets/eobgenie/scan-{n}.jpg"></div>' for i, n in enumerate([1, 3, 5, 7]))
sc['g02-paper'] = ('dark', f'''<div class="copy" style="width:640px"><div class="eyebrow a" data-in="0.3" data-fx="up">The usual pile</div><h2 class="a white" data-in="0.6" data-fx="up">A stack of PIP EOBs.</h2><p class="lead a" data-in="1.2" data-fx="up" style="color:rgba(255,255,255,.78)">GEICO, Progressive, USAA and the checks, all in one scan. Normally keyed in by hand, line by line.</p></div>{scans}
<p class="foot">Fictional EOBs made for this demo.</p>''')
sc['g03-upload'] = ('light', copy('Step 1 · Upload', 'Upload the whole scan.', 'One EOB or the whole day’s mail, in one PDF.', ['Mixed payers and checks', 'Health-insurance pages skipped', 'Read, then discarded: <span class="in">never stored</span>']) + card('upload', 'right:120px;top:250px;width:1000px'))
gpstage = f'''<div class="gp" id="gp"><div class="gp-stage"><div class="gp-docs"><i class="gp-doc"></i><i class="gp-doc"></i><i class="gp-doc"></i></div><div class="gp-smoke"><i></i><i></i><i></i><i></i></div>
<img class="gp-genie" src="assets/eobgenie/icon.png" alt="">{lamp}<span class="gp-spark"></span><span class="gp-spark"></span><span class="gp-spark"></span><span class="gp-spark"></span><span class="gp-spark"></span><div class="gp-burst">{'<i></i>' * 10}</div></div>
<p class="gp-msg" id="gp-msg"></p><div class="gp-bar"><i id="gp-bar"><b class="gp-bar-spark"></b></i></div><p class="gp-sub" id="gp-sub">Reading 8 pages · usually under 15 seconds</p></div>'''
sc['g04-reading'] = ('light', copy('Step 2 · Read', 'The genie gets to work.', 'A cheerful progress screen while every page is read.', ['Reads every line', 'Matches each EOB to its patient', 'Checks the PIP math']) +
    f'<div class="card modal a" data-in="0.4" data-fx="up" style="right:150px;top:170px;width:960px;height:740px"><div class="mtitle">Upload insurance EOBs</div><div class="gpwrap">{gpstage}</div></div>')
sc['g05-review'] = ('light', copy('Step 3 · Review', '3 EOBs found in 8 pages.', 'Each matched to the right patient and coverage by claim number, or by name and date of loss.') + frame('review', 'Upload insurance EOBs · review', pan='1.2,0,0.62'))
sc['g06-checks'] = ('light', copy('Step 3 · Review', 'Every number, checked.', None, ['Line totals and allowed totals', 'Payment vs. 80% of allowed', 'Unusual lines flagged']) + card('rev-geico', 'right:160px;top:120px;width:900px', kb='2.0,1,1.06,60,100'))
sc['g07-exhausted'] = ('light', copy('Benefits exhausted', 'Exhausted? Handled.', 'The balance moves to the patient, and the case switches to a letter of protection when no other coverage is left.') + card('rev-usaa', 'right:330px;top:110px;width:760px') + card('lop-notice', 'right:90px;top:640px;width:900px', din='3.2'))
sc['g08-newpatient'] = ('light', copy('New patient', 'Not set up yet? No problem.', 'Create the patient and the auto case right from the EOB.') + card('new-patient', 'right:200px;top:270px;width:840px'))
sc['g09-ledger'] = ('light', copy('Step 4 · Post', 'Posted to the ledger.', None, ['The insurer’s payment', 'The fee-schedule adjustment', 'The 20% moved to the patient']) + card('case-eob-card', 'right:110px;top:300px;width:1060px') + card('case-charges', 'right:110px;top:520px;width:1060px', din='1.6'))
sc['g10-edit'] = ('light', copy('Edit EOB', 'Still your ledger.', 'Fix a line or add a late check. The posting updates to match.') + card('edit-eob', 'right:160px;top:180px;width:960px'))
sc['g11-report'] = ('light', copy('EOB Genie report', 'What to act on, across every case.', 'Every saved EOB and check, with the money at stake.') + frame('genie-page', 'EOB Genie', kb='1.5,1,1.12,30,10'))
sc['g12-money'] = ('light', copy('Report', 'Money left on the table.', 'Underpaid and denied lines, with a pre-suit demand letter one click away. Plus fees that may sit below the PIP schedule.') + card('money-left', 'right:90px;top:280px;width:1080px') + card('fee-check', 'right:90px;top:540px;width:1080px', din='3.0'))
sc['g13-late'] = ('light', copy('Report', 'Late, missing, or out of time.', None, ['Paid late, with the interest due', 'Bills with no EOB yet', 'Bills sent after Florida’s window']) + card('paid-late', 'right:90px;top:150px;width:1080px') + card('no-eob', 'right:90px;top:410px;width:1080px', din='2.8') + card('billed-late', 'right:90px;top:650px;width:1080px', din='4.2'))
sc['g14-pip'] = ('light', copy('Report', 'Before PIP runs out.', 'Visits left, the run-out date, and whether the letter of protection is signed.') + card('pip-out', 'right:90px;top:380px;width:1080px'))
sc['g14b-suit'] = ('light', copy('PIP suit &amp; demand checks', 'No EOB? Read it anyway.', 'Scan the insurer’s check with your attorney’s cover letter.', ['Firm, file number and patient from the letter', 'Interest split from the check', 'Paid against the oldest open visits']) + card('pay-progressive', 'right:90px;top:200px;width:1060px'))
sc['g14c-recovered'] = ('light', copy('Report', 'Recovered by demands &amp; suits.', 'By attorney, with the interest: what your demands and suits bring in.') + card('genie-tiles', 'right:90px;top:170px;width:1080px') + card('recovered', 'right:90px;top:400px;width:1080px', din='1.6'))
post_badges = [('💵', 'Interest kept separate', 'Recorded with the EOB, never paid against the visits'), ('🧾', 'Deductible on its own line', 'Apart from the 20% moved to the patient'), ('🩹', 'MedPay pays the 20%', 'The patient balance moves back to MedPay and is paid')]
sc['g14d-posting'] = ('light', copy('Posting', 'The details, done right.', 'Every EOB posts the way Florida PIP works.') + '<div style="position:absolute;right:150px;top:290px;display:flex;flex-direction:column;gap:24px">'
    + ''.join(f'<div class="badge a" data-in="{1.6 + i * 0.8:.1f}" data-fx="left"><div class="ic">{e}</div><div><b>{t}</b><small>{d}</small></div></div>' for i, (e, t, d) in enumerate(post_badges)) + '</div>')
badges = [('🛡', 'Never stored', 'The scan is read, then discarded'), ('✓', 'Only what you approve', 'Nothing is saved until you check it'), ('🔒', 'Every access logged', 'Full audit trail, two-factor sign-in'), ('📄', 'BAA included', 'Signed with every practice')]
sc['g15-privacy'] = ('dark', '<div style="position:absolute;left:150px;top:300px;width:720px;display:flex;flex-direction:column;gap:26px"><div class="eyebrow a" data-in="0.3" data-fx="up">Privacy first</div><h2 class="a white" data-in="0.6" data-fx="up">Your patients’ documents are never stored.</h2><p class="lead a" data-in="1.2" data-fx="up" style="color:rgba(255,255,255,.78)">EOB Genie keeps the numbers, not the paper.</p></div><div style="position:absolute;right:150px;top:240px;display:flex;flex-direction:column;gap:22px">'
    + ''.join(f'<div class="badge a" data-in="{1.4 + i * 0.6:.1f}" data-fx="left"><div class="ic">{e}</div><div><b>{t}</b><small>{s}</small></div></div>' for i, (e, t, s) in enumerate(badges)) + '</div>')
sc['g16-pricing'] = ('light', '''<div class="a" data-in="0.3" data-fx="up" style="position:absolute;left:0;right:0;top:120px;text-align:center"><div class="eyebrow" style="justify-content:center">Pricing</div><h2 style="margin-top:18px">On its own, or built in.</h2></div>
<div class="price feat a" data-in="0.9" data-fx="up" style="left:230px"><div class="tag">EOB Genie on its own</div><img src="assets/eobgenie/logo.png" style="height:64px"><div class="amt">$49<span>/month</span></div><ul><li>Upload, check &amp; post EOBs</li><li>EOB Genie report</li><li>5 users</li></ul></div>
<div class="price a" data-in="1.3" data-fx="up" style="left:740px"><h3>Gold</h3><p class="blurb">A busy PI clinic</p><div class="amt">$59<span>/month</span></div><ul><li><b class="in">EOB Genie included</b></li><li>300 open cases · 10 users</li><li>Daily huddle sheet</li></ul></div>
<div class="price a" data-in="1.7" data-fx="up" style="left:1250px"><h3>Platinum</h3><p class="blurb">Multiple doctors or locations</p><div class="amt">$79<span>/month</span></div><ul><li><b class="in">EOB Genie included</b></li><li>Unlimited cases &amp; users</li><li>White label</li></ul></div>
<div class="a" data-in="2.6" data-fx="up" style="position:absolute;left:0;right:0;top:880px;text-align:center;font-size:30px;font-weight:700;color:var(--ocean)">14-day free trial · No credit card</div>''')
sc['g17-cta'] = ('dark', '''<div style="position:absolute;left:150px;top:210px;width:1000px;display:flex;flex-direction:column;gap:34px">
<img class="a" data-in="0.3" data-fx="up" src="assets/eobgenie/logo-dark.png" style="height:120px;align-self:flex-start">
<h1 class="a white" data-in="0.7" data-fx="up">Let the genie<br><span class="hl">read your EOBs.</span></h1>
<div class="a" data-in="1.6" data-fx="up"><span class="btn">Start your free trial</span></div>
<p class="a" data-in="2.2" data-fx="up" style="font-size:32px;color:rgba(255,255,255,.85)"><b style="color:#fff">injurycase.com</b></p></div>
<div class="a" data-in="2.0" data-fx="zoom" style="position:absolute;right:190px;top:270px;background:#fff;border-radius:24px;padding:26px;text-align:center;width:380px"><img src="assets/qr.svg" style="width:328px;height:328px;display:block"><div style="font-size:22px;font-weight:700;color:var(--navy);margin-top:14px">Scan to start free</div></div>
<p class="foot">Demo data shown is fictional. EOB Genie helps you check EOBs; always compare against the paper before saving.</p>''')

body = ''
for s in cfg['scenes']:
    kind, inner = sc[s['id']]
    body += f'<section class="scene {kind}" data-id="{s["id"]}">\n{inner}\n</section>\n'

html = '''<!doctype html><html><head><meta charset="utf-8"><title>EOB Genie demo</title><style>
@font-face{font-family:Montserrat;font-weight:600;src:url(assets/eobgenie/montserrat-latin-600-normal.woff2) format("woff2")}
@font-face{font-family:Montserrat;font-weight:700 800;src:url(assets/eobgenie/montserrat-latin-700-normal.woff2) format("woff2")}
*{box-sizing:border-box;margin:0;padding:0}
:root{--navy:#152E46;--ocean:#176A96;--arctic:#69C8E8;--frost:#CFF4FF;--silver:#E6EEF5;--muted:rgba(21,46,70,.68);
--g-frost:#CFF4FF;--g-arctic:#69C8E8;--g-ocean:#176A96;--g-navy:#152E46;--g-silver:#E6EEF5}
html,body{width:1920px;height:1080px;overflow:hidden;font-family:Inter,"Segoe UI",Arial,sans-serif;background:var(--navy)}
.scene{position:absolute;inset:0;opacity:0}
.dark{background:radial-gradient(1200px 760px at 75% 15%,#1D4F78 0%,var(--navy) 62%)}
.light{background:linear-gradient(135deg,#F6FCFF 0%,#DDF3FB 100%)}
.a{opacity:0;will-change:transform,opacity}
h1,h2,.eyebrow,.btn,.price h3,.price .amt,.badge b,.mtitle{font-family:Montserrat,Inter,sans-serif}
h1{font-size:80px;line-height:1.08;letter-spacing:-.02em;font-weight:800}
h2{font-size:58px;line-height:1.1;letter-spacing:-.015em;font-weight:800;color:var(--navy)}
.lead{font-size:29px;line-height:1.45;color:var(--muted)}
.white{color:#fff}.hl{color:var(--arctic)}.light .hl{color:var(--ocean)}
.eyebrow{font-size:18px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--ocean);display:flex;align-items:center;gap:12px}
.eyebrow::before{content:"";width:34px;height:4px;border-radius:2px;background:var(--arctic)}
.dark .eyebrow{color:var(--arctic)}
.copy{position:absolute;left:110px;top:0;bottom:0;width:580px;display:flex;flex-direction:column;justify-content:center;gap:26px}
.frame{position:absolute;right:90px;top:170px;width:1080px;height:740px;border-radius:18px;overflow:hidden;background:#fff;box-shadow:0 40px 90px rgba(21,46,70,.25),0 0 0 1px rgba(21,46,70,.08)}
.frame .bar{height:38px;background:#E6EEF5;display:flex;align-items:center;gap:8px;padding:0 16px}
.frame .bar i{width:12px;height:12px;border-radius:50%;background:#C3D2E0}
.frame .bar span{margin-left:14px;font-size:14px;color:#5E7186;background:#fff;border-radius:6px;padding:4px 14px}
.frame .view{position:absolute;top:38px;left:0;right:0;bottom:0;overflow:hidden}
.frame img{position:absolute;left:0;top:0;width:100%}
.card{position:absolute;background:#fff;border-radius:18px;box-shadow:0 30px 70px rgba(21,46,70,.2),0 0 0 1px rgba(21,46,70,.06);overflow:hidden}
.card img{display:block;width:100%}
.pts{display:flex;flex-direction:column;gap:16px}
.pt{font-size:26px;color:var(--navy);display:flex;gap:14px;align-items:flex-start;line-height:1.35}
.pt b{flex:none;width:32px;height:32px;border-radius:50%;background:var(--ocean);color:#fff;font-size:17px;display:grid;place-items:center;margin-top:1px}
b.in,span.in{color:var(--ocean);font-weight:700}
.note{font-size:18px;color:var(--muted);border-left:3px solid #BFD3E2;padding-left:12px;line-height:1.4}
.paper{position:absolute;background:#fff;border-radius:6px;box-shadow:0 40px 90px rgba(0,0,0,.4);overflow:hidden}
.paper img{display:block;width:100%}
.badge{display:flex;align-items:center;gap:22px;background:#fff;border-radius:18px;padding:24px 28px;box-shadow:0 16px 40px rgba(0,0,0,.2);width:640px}
.badge .ic{width:64px;height:64px;border-radius:50%;display:grid;place-items:center;font-size:30px;flex:none;background:var(--frost);color:var(--ocean);font-weight:800}
.badge b{font-size:28px;color:var(--navy);display:block}.badge small{font-size:20px;color:var(--muted)}
.price{position:absolute;top:330px;width:440px;height:480px;background:#fff;border-radius:22px;padding:42px;box-shadow:0 30px 70px rgba(21,46,70,.16),0 0 0 1px rgba(21,46,70,.07)}
.price h3{font-size:36px;color:var(--navy)}.price .blurb{font-size:20px;color:var(--muted);margin-top:6px}
.price .amt{font-size:84px;font-weight:800;color:var(--navy);margin-top:24px;letter-spacing:-.02em}.price .amt span{font-size:26px;font-weight:500;color:var(--muted)}
.price ul{list-style:none;margin-top:22px;display:flex;flex-direction:column;gap:12px;font-size:22px;color:var(--navy)}
.price li::before{content:"✓  ";color:var(--ocean);font-weight:800}
.price.feat{border:3px solid var(--arctic)}
.price .tag{position:absolute;top:-18px;left:40px;background:var(--ocean);color:#fff;font-size:16px;font-weight:700;padding:6px 14px;border-radius:999px}
.btn{display:inline-block;background:var(--arctic);color:var(--navy);font-size:36px;font-weight:800;padding:26px 54px;border-radius:16px;box-shadow:0 18px 40px rgba(105,200,232,.35)}
.foot{position:absolute;left:0;right:0;bottom:34px;text-align:center;font-size:16px;color:rgba(21,46,70,.55)}
.dark .foot{color:rgba(255,255,255,.55)}
.corner{position:absolute;right:90px;top:62px;display:flex;align-items:center;gap:10px;background:#fff;border:1.5px solid #BFE6F5;color:var(--navy);font-size:19px;font-weight:700;padding:10px 18px;border-radius:999px;box-shadow:0 8px 22px rgba(21,46,70,.1)}
.corner svg{width:24px;height:24px}.corner span{color:var(--muted);font-weight:500}
.brand{position:absolute;left:110px;top:56px;height:58px}
.progress{position:absolute;left:0;bottom:0;height:6px;background:linear-gradient(90deg,var(--arctic),var(--ocean));z-index:9}
.modal{padding:30px 34px}.mtitle{font-size:26px;font-weight:700;color:var(--navy)}
.gpwrap{position:absolute;left:0;right:0;top:80px;display:flex;justify-content:center}
.gpwrap .gp{transform:scale(1.8);transform-origin:50% 0;width:440px}
.card img.gp-genie{width:118px;display:block}.card svg.gp-lamp{width:150px}
.gp-msg{font-size:17px;min-height:24px}
''' + gp + '''
</style></head><body>
<!-- EOB Genie demo: scene layout here, narration in eobgenie.json (generated by make_eobgenie_html.py). -->
''' + body + '''<div class="progress" id="prog"></div>
<template id="corner"><div class="corner">''' + SHIELD + '''Never stored <span>· HIPAA-ready</span></div></template>
<template id="brand"><img class="brand" src="assets/eobgenie/logo.png"></template>
<script>document.querySelectorAll('.scene.light').forEach((sc) => { sc.appendChild(document.getElementById('corner').content.cloneNode(true)); if (!sc.querySelector('.price')) sc.appendChild(document.getElementById('brand').content.cloneNode(true)); });</script>
<script>
const DEFAULTS = ''' + json.dumps(D) + ''';
let DUR = DEFAULTS.slice(), START = [], T = 0;
function applyTimeline(durations) {
  DUR = durations && durations.length === DEFAULTS.length ? durations : DEFAULTS.slice();
  START = []; T = 0; for (const d of DUR) { START.push(T); T += d; }
  window.TOTAL = T;
}
const ease = (x) => x < 0 ? 0 : x > 1 ? 1 : 1 - Math.pow(1 - x, 3);
const STEPS = [[0, 'Rubbing the lamp…'], [8, 'Poof! The genie is up and stretching.'], [20, 'Reading every line — no squinting required.'], [40, 'Matching each EOB to its patient…'],
  [58, 'Checking the PIP math (80%, every time)…'], [76, 'Hunting for money left on the table…'], [90, 'Polishing the numbers until they sparkle…']];
// The progress screen: CSS animations from the app, pinned to the video clock.
function genie(lt, d) {
  const gp = document.getElementById('gp'), start = 0.9, doneAt = d - 2.6;
  const k = Math.min(1, Math.max(0, (lt - start) / (doneAt - start)));
  const done = lt >= doneAt;
  gp.classList.toggle('gp-done', done);
  document.getElementById('gp-bar').style.width = (done ? 100 : 100 * (1 - Math.pow(1 - k, 1.6)) * 0.97).toFixed(2) + '%';
  const pct = k * 100; let m = STEPS[0][1]; for (const [p, s] of STEPS) if (pct >= p) m = s;
  const msg = document.getElementById('gp-msg');
  msg.textContent = done ? 'Ta-da! 3 EOBs ready for you to check.' : m;
  document.getElementById('gp-sub').style.visibility = done ? 'hidden' : 'visible';
  for (const an of gp.getAnimations({ subtree: true })) {
    an.pause();
    const late = ['gp-tada', 'gp-burst'].includes(an.animationName);
    an.currentTime = Math.max(0, (late ? lt - doneAt : lt)) * 1000;
  }
}
function render(t) {
  document.querySelectorAll('.scene').forEach((s, i) => {
    const a = START[i], b = START[i] + DUR[i] + (i < DUR.length - 1 ? 0.2 : 0);
    const fadeIn = i === 0 ? 1 : ease((t - a) / 0.5), fadeOut = i === DUR.length - 1 ? 1 : 1 - ease((t - (b - 0.5)) / 0.5);
    s.style.opacity = t < a || t > b ? 0 : Math.min(fadeIn, fadeOut);
    s.style.visibility = t < a - 0.1 || t > b + 0.1 ? 'hidden' : 'visible';
    const lt = t - a;
    s.querySelectorAll('.a').forEach((el) => {
      const p = ease((lt - +el.dataset.in) / 0.7), fx = el.dataset.fx, d = 1 - p;
      el.style.opacity = p;
      el.style.transform = fx === 'up' ? `translateY(${d * 40}px)` : fx === 'left' ? `translateX(${-d * 60}px)` : fx === 'right' ? `translateX(${d * 80}px)` : fx === 'zoom' ? `scale(${0.9 + 0.1 * p})` : fx === 'pop' ? `translateY(${d * 120}px) scale(${0.85 + 0.15 * p})` : '';
    });
    s.querySelectorAll('[data-kb]').forEach((img) => {
      const [k0, s0, s1, fx, fy] = img.dataset.kb.split(',').map(Number);
      const k = Math.min(1, Math.max(0, (lt - k0) / Math.max(1, DUR[i] - k0)));
      const e = k * k * (3 - 2 * k);
      img.style.transformOrigin = `${fx}% ${fy}%`;
      img.style.transform = `scale(${s0 + (s1 - s0) * e})`;
    });
    s.querySelectorAll('[data-pan]').forEach((img) => {
      const [p0, f0, f1] = img.dataset.pan.split(',').map(Number);
      const k = Math.min(1, Math.max(0, (lt - p0) / Math.max(1, DUR[i] - p0 - 0.8)));
      const e = k * k * (3 - 2 * k), box = img.parentElement.clientHeight;
      const over = Math.max(0, img.naturalHeight / img.naturalWidth * img.clientWidth - box);
      img.style.transform = `translateY(${-over * (f0 + (f1 - f0) * e)}px)`;
    });
    if (s.dataset.id === 'g04-reading' && s.style.visibility === 'visible') genie(lt, DUR[i]);
  });
  document.getElementById('prog').style.width = (t / T * 100) + '%';
}
window.render = render; window.applyTimeline = applyTimeline; applyTimeline(null); render(0);
</script></body></html>'''
open('eobgenie.html', 'w').write(html)
print(len(html))
