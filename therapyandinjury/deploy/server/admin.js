'use strict';
/**
 * /_admin: password-protected updater page.
 *
 * Password: ADMIN_PASSWORD environment variable (cPanel → Setup Node.js App → Environment variables)
 * or "adminPassword" in config.json. At least 12 characters; with no password set, /_admin is off (404).
 * Sign in with any username and that password (browser login prompt, HTTP Basic over HTTPS).
 *
 * Changes need the custom header X-Admin-Action, which other sites can't send (CSRF protection).
 */
const path = require('path');
const crypto = require('crypto');

const MAX_UPLOAD = 150 * 1024 * 1024;
const fails = new Map(); // ip → [timestamps]
const LOCK = { windowMs: 15 * 60 * 1000, max: 10 };

const ipOf = (req) => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();

function passwordOf(ctx) {
  const p = process.env.ADMIN_PASSWORD || ctx.getConfig().adminPassword || '';
  return p.length >= 12 ? p : null;
}

function authorized(req, password) {
  const m = /^Basic\s+(.+)$/i.exec(String(req.headers.authorization || ''));
  if (!m) return false;
  const decoded = Buffer.from(m[1], 'base64').toString('utf8');
  const given = decoded.slice(decoded.indexOf(':') + 1);
  return crypto.timingSafeEqual(digest(given), digest(password));
}

function readRaw(req, max) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > max) {
        req.removeAllListeners('data');
        req.resume();
        reject(Object.assign(new Error(`Upload is larger than ${max / 1048576} MB`), { status: 413 }));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function handle(req, res, url, ctx, send) {
  const base = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow', 'x-frame-options': 'DENY' };
  const json = (status, body) => send(res, status, { ...base, 'content-type': 'application/json' }, JSON.stringify(body));
  const password = passwordOf(ctx);
  if (!password) return send(res, 404, { ...base, 'content-type': 'text/plain' }, 'Not found\n');

  const ip = ipOf(req);
  const now = Date.now();
  const recent = (fails.get(ip) || []).filter((t) => now - t < LOCK.windowMs);
  if (recent.length >= LOCK.max) return send(res, 429, { ...base, 'content-type': 'text/plain', 'retry-after': '900' }, 'Too many sign-in attempts. Try again in 15 minutes.\n');
  if (!authorized(req, password)) {
    if (req.headers.authorization) { recent.push(now); fails.set(ip, recent); }
    return send(res, 401, { ...base, 'www-authenticate': 'Basic realm="Therapy & Injury site admin", charset="UTF-8"', 'content-type': 'text/plain' }, 'Sign in required\n');
  }
  fails.delete(ip);

  const updater = require(path.join(ctx.root, 'updater.js'));
  const route = url.pathname.replace(/\/+$/, '') || '/_admin';

  if (req.method === 'GET' && route === '/_admin') return send(res, 200, { ...base, 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src data:" }, PAGE);
  if (req.method === 'GET' && route === '/_admin/api/status') {
    const st = updater.status();
    const mail = ctx.getConfig().mail || {};
    return json(200, {
      ...st,
      running: ctx.version,
      degraded: ctx.degraded,
      node: process.version,
      uptimeSec: Math.round(process.uptime()),
      branches: ctx.site.branches || [],
      mailRecipients: Object.keys(mail.recipients || {}),
      updateSource: ctx.getConfig().update?.manifestUrl ? 'manifest URL' : ctx.getConfig().update?.github?.repo ? `GitHub ${ctx.getConfig().update.github.repo}` : null,
    });
  }

  // Everything below changes the site: require the custom header (CSRF) and a write method.
  if (!['POST', 'PUT'].includes(req.method) || req.headers['x-admin-action'] !== '1') return json(400, { ok: false, error: 'Bad request' });
  try {
    if (route === '/_admin/api/upload') {
      const buf = await readRaw(req, MAX_UPLOAD);
      const r = updater.installBuffer(buf, { source: 'admin upload', force: url.searchParams.get('force') === '1' });
      return json(200, { ok: true, ...r, note: 'Installed. The site switches over on the next request.' });
    }
    const body = JSON.parse((await readRaw(req, 4096)).toString('utf8') || '{}');
    if (route === '/_admin/api/activate') return json(200, { ok: true, ...updater.activate(String(body.version || '')) });
    if (route === '/_admin/api/rollback') return json(200, { ok: true, ...updater.rollback() });
    if (route === '/_admin/api/check') return json(200, { ok: true, ...(await updater.check()) });
    if (route === '/_admin/api/update') return json(200, { ok: true, ...(await updater.update()) });
    if (route === '/_admin/api/restart') { updater.touchRestart(); return json(200, { ok: true }); }
    return json(404, { ok: false, error: 'Unknown action' });
  } catch (e) {
    console.error('[admin]', e.message);
    return json(e.status || 400, { ok: false, error: e.message });
  }
}

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Site admin · Therapy &amp; Injury</title>
<style>
:root{--navy:#0b2d5b;--teal:#19ccbe;--slate:#57667a;--gray:#f4f6f8;--line:#dfe4ea;--red:#b42318;--green:#067647}
*{box-sizing:border-box}body{margin:0;font:16px/1.5 Inter,system-ui,-apple-system,Segoe UI,sans-serif;color:var(--navy);background:var(--gray)}
header{background:var(--navy);color:#fff;padding:18px 24px;display:flex;align-items:center;gap:12px}
header b{font-size:18px}header span{color:#c9d3de;font-size:14px}
main{max-width:880px;margin:24px auto;padding:0 16px;display:grid;gap:16px}
section{background:#fff;border:1px solid var(--line);border-radius:12px;padding:20px}
h2{font-size:17px;margin:0 0 12px}p{margin:6px 0;color:var(--slate)}
.kv{display:grid;grid-template-columns:max-content 1fr;gap:6px 18px}.kv dt{color:var(--slate)}.kv dd{margin:0;font-weight:600}
table{width:100%;border-collapse:collapse;font-size:15px}td,th{text-align:left;padding:8px 6px;border-top:1px solid var(--line)}th{color:var(--slate);font-weight:500;border-top:0}
button,.file{font:inherit;font-weight:700;border:0;border-radius:999px;padding:9px 18px;cursor:pointer;background:var(--teal);color:var(--navy)}
button.ghost{background:var(--gray);color:var(--navy)}button:disabled{opacity:.5;cursor:wait}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.tag{font-size:12px;font-weight:700;background:var(--teal);color:var(--navy);border-radius:999px;padding:2px 9px;margin-left:6px}
#msg{min-height:24px;font-weight:600}#msg.err{color:var(--red)}#msg.ok{color:var(--green)}
input[type=file]{font:inherit}code{background:var(--gray);padding:1px 6px;border-radius:6px}
</style></head><body>
<header><b>Therapy &amp; Injury</b><span>Website admin · updates</span></header>
<main>
<section><h2>Status</h2><dl class="kv" id="status"><dt>Loading…</dt><dd></dd></dl></section>
<section><h2>Install an update</h2>
<p>Upload a release package (<code>therapyandinjury-&lt;version&gt;.tar.gz</code>, built with <code>npm run release</code>). It is checked, installed beside the current version, and switched on. The previous version stays installed for one-click rollback.</p>
<div class="row" style="margin-top:12px"><input type="file" id="pkg" accept=".gz,.tgz,application/gzip"><button id="upload">Upload &amp; install</button></div>
<div class="row" style="margin-top:14px" id="remoteRow"><button class="ghost" id="check">Check for updates</button><button class="ghost" id="update">Install latest</button></div>
</section>
<section><h2>Installed versions</h2><table><thead><tr><th>Version</th><th>Built</th><th>Installed</th><th></th></tr></thead><tbody id="releases"></tbody></table>
<div class="row" style="margin-top:14px"><button class="ghost" id="rollback">Roll back to previous</button><button class="ghost" id="restart">Restart app</button></div></section>
<p id="msg" role="status"></p>
</main>
<script>
const $=(s)=>document.querySelector(s);const msg=(t,ok)=>{const m=$('#msg');m.textContent=t;m.className=ok===undefined?'':ok?'ok':'err'};
const fmt=(d)=>d?new Date(d).toLocaleString():'—';
async function api(path,opts={}){const r=await fetch('/_admin/api/'+path,{...opts,headers:{'x-admin-action':'1',...(opts.headers||{})}});const j=await r.json().catch(()=>({ok:false,error:'HTTP '+r.status}));if(!r.ok||j.ok===false)throw new Error(j.error||('HTTP '+r.status));return j}
async function load(){const s=await fetch('/_admin/api/status').then(r=>r.json());
const pending=s.current&&s.current.version!==s.running&&!s.degraded;
const kv=[['Running version',s.running+(s.degraded?' (fallback: '+s.degraded+' failed to start; check the log)':'')+(pending?' (switching to '+s.current.version+' on the next request)':'')],['Active (current.json)',s.current?s.current.version:'—'],['Previous',s.current&&s.current.previous||'—'],['Node.js',s.node],['Up for',Math.round(s.uptimeSec/60)+' min'],['Form email set for',s.mailRecipients.length?s.mailRecipients.join(', '):'none yet (form asks visitors to call)'],['Remote update source',s.updateSource||'not set (upload packages here instead)']];
$('#status').innerHTML=kv.map(([k,v])=>'<dt>'+k+'</dt><dd>'+String(v).replace(/</g,'&lt;')+'</dd>').join('');
$('#remoteRow').style.display=s.updateSource?'flex':'none';
$('#releases').innerHTML=s.installed.map(r=>'<tr><td><b>'+r.version+'</b>'+(s.current&&r.version===s.current.version?'<span class="tag">active</span>':'')+'</td><td>'+fmt(r.builtAt)+'</td><td>'+fmt(r.installedAt)+'</td><td>'+(s.current&&r.version===s.current.version?'':'<button class="ghost" data-v="'+r.version+'">Activate</button>')+'</td></tr>').join('');
document.querySelectorAll('[data-v]').forEach(b=>b.onclick=()=>act(()=>api('activate',{method:'POST',body:JSON.stringify({version:b.dataset.v})}),'Activated '+b.dataset.v))}
async function act(fn,done){document.querySelectorAll('button').forEach(b=>b.disabled=true);msg('Working…');try{const r=await fn();msg((done||'Done')+(r&&r.version?' · version '+r.version:'')+(r&&r.upToDate?' (already up to date)':'')+(r&&r.latest?' · latest '+r.latest+(r.newer?' (newer than current)':' (no update)'):''),true);
await new Promise(r=>setTimeout(r,1500));await load()}catch(e){msg(e.message,false)}finally{document.querySelectorAll('button').forEach(b=>b.disabled=false)}}
$('#upload').onclick=()=>{const f=$('#pkg').files[0];if(!f)return msg('Choose a package file first.',false);act(()=>api('upload',{method:'PUT',body:f,headers:{'content-type':'application/octet-stream'}}),'Installed')};
$('#check').onclick=()=>act(()=>api('check',{method:'POST'}),'Checked');
$('#update').onclick=()=>act(()=>api('update',{method:'POST'}),'Update finished');
$('#rollback').onclick=()=>{if(confirm('Switch back to the previous version?'))act(()=>api('rollback',{method:'POST'}),'Rolled back')};
$('#restart').onclick=()=>act(()=>api('restart',{method:'POST'}),'Restart requested');
load().catch(e=>msg(e.message,false));
</script></body></html>`;

module.exports = { handle };
