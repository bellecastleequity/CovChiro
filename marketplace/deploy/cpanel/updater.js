// One-file updater for cPanel: Setup Node.js App → "Run JS script" → update (or rollback).
// 1. Upload coverageoncall-update.tar.gz into the site folder (next to app/ and node_modules/).
// 2. Stop App.  3. Run JS script "update".  4. Start App.
// It unpacks the package beside the running copy, checks it, makes a database restore point
// (live site, when the Neon keys are set), applies the database updates this site hasn't had
// (each one in its own transaction, recorded so it never runs twice), then swaps the new app in
// and keeps the old one as app-previous / node_modules-previous. Anything wrong before the swap
// leaves the site exactly as it was. "rollback" swaps the previous version back (database
// updates are additive, so the previous version runs on the updated database).
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { pathToFileURL } = require("url");

const APP = __dirname;
const SITE = path.dirname(APP);
const STAGING = path.join(SITE, ".update-staging");
const LOG = path.join(SITE, "update-log.txt");
const mode = process.argv[2] === "rollback" ? "rollback" : "update";

function log(msg) {
  console.log(msg);
  try { fs.appendFileSync(LOG, `${new Date().toISOString()} ${msg}\n`); } catch {}
}
function finish(msg, ok = true) {
  log(`\n==> ${ok ? "" : "STOPPED: "}${msg}\n`);
  process.exit(0);
}
for (const ev of ["uncaughtException", "unhandledRejection"]) {
  process.on(ev, (e) => {
    const m = String(e && e.message ? e.message : e);
    if (/Wasm memory|WebAssembly/i.test(m)) finish("MEMORY LIMIT: add the environment variable NODE_OPTIONS = --disable-wasm-trap-handler, then run update again. Nothing was changed.", false);
    finish(`Unexpected error: ${m.split("\n")[0]}. If the site isn't working, run "rollback".`, false);
  });
}

const exists = (p) => { try { fs.lstatSync(p); return true; } catch { return false; } };
const rm = (p) => fs.rmSync(p, { recursive: true, force: true });
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };

// ---------------- rollback ----------------

function swap(a, b) {
  const tmp = `${a}-swap-${Date.now()}`;
  fs.renameSync(a, tmp);
  fs.renameSync(b, a);
  fs.renameSync(tmp, b);
}

if (mode === "rollback") {
  if (!exists(path.join(SITE, "app-previous"))) finish("There's no app-previous folder to roll back to.", false);
  const from = readJson(path.join(APP, "RELEASE.json"));
  const to = readJson(path.join(SITE, "app-previous", "RELEASE.json"));
  swap(path.join(SITE, "app"), path.join(SITE, "app-previous"));
  if (exists(path.join(SITE, "node_modules-previous"))) swap(path.join(SITE, "node_modules"), path.join(SITE, "node_modules-previous"));
  finish(`Rolled back from ${from ? from.version : "?"} to ${to ? to.version : "the previous version"}. Now click Start App (or Restart). Run "rollback" again to undo this.`);
}

// ---------------- find and unpack the package ----------------

function findPackage() {
  const files = fs.readdirSync(SITE).filter((f) => /^coverageoncall-update.*\.tar\.gz$/i.test(f)).map((f) => ({ f, t: fs.statSync(path.join(SITE, f)).mtimeMs }));
  files.sort((a, b) => b.t - a.t);
  return files[0] ? path.join(SITE, files[0].f) : null;
}

/** Streaming .tar.gz extractor (ustar + GNU long names), no dependencies. */
function extract(file, dest) {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    let longName = null;
    let longLink = null;
    let cur = null; // { fd, left, pad }
    let count = 0;
    let ended = false;
    const str = (b, s, l) => b.subarray(s, s + l).toString("utf8").replace(/\0.*$/s, "");
    const oct = (b, s, l) => parseInt(str(b, s, l).trim() || "0", 8);
    const safe = (name) => {
      const p = path.resolve(dest, name);
      if (p !== dest && !p.startsWith(dest + path.sep)) throw new Error(`unsafe path in package: ${name}`);
      return p;
    };
    function step() {
      for (;;) {
        if (cur) {
          if (cur.left > 0) {
            if (!buf.length) return;
            const n = Math.min(cur.left, buf.length);
            if (cur.fd !== null) fs.writeSync(cur.fd, buf, 0, n);
            if (cur.collect) cur.collect.push(buf.subarray(0, n));
            buf = buf.subarray(n);
            cur.left -= n;
            continue;
          }
          if (buf.length < cur.pad) return;
          buf = buf.subarray(cur.pad);
          if (cur.fd !== null) fs.closeSync(cur.fd);
          if (cur.done) cur.done();
          cur = null;
          continue;
        }
        if (buf.length < 512) return;
        const h = buf.subarray(0, 512);
        buf = buf.subarray(512);
        if (h.every((x) => x === 0)) { ended = true; continue; }
        const size = oct(h, 124, 12);
        const type = String.fromCharCode(h[156] || 48);
        const prefix = str(h, 345, 155);
        let name = longName || (prefix ? `${prefix}/${str(h, 0, 100)}` : str(h, 0, 100));
        const link = longLink || str(h, 157, 100);
        const pad = (512 - (size % 512)) % 512;
        if (type === "L" || type === "K") {
          const parts = [];
          cur = { fd: null, left: size, pad, collect: parts, done: () => { const v = Buffer.concat(parts).toString("utf8").replace(/\0.*$/s, ""); if (type === "L") longName = v; else longLink = v; } };
          continue;
        }
        longName = null;
        longLink = null;
        if (type === "x" || type === "g") { cur = { fd: null, left: size, pad }; continue; }
        const target = safe(name);
        if (type === "5") { fs.mkdirSync(target, { recursive: true }); continue; }
        fs.mkdirSync(path.dirname(target), { recursive: true });
        if (type === "2") { rm(target); fs.symlinkSync(link, target); continue; }
        const fd = fs.openSync(target, "w", oct(h, 100, 8) & 0o777 || 0o644);
        cur = { fd, left: size, pad };
        if (++count % 2000 === 0) console.log(`  ${count} files…`);
      }
    }
    const input = fs.createReadStream(file).pipe(zlib.createGunzip());
    input.on("data", (chunk) => {
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      try { step(); } catch (e) { input.destroy(); reject(e); }
    });
    input.on("error", reject);
    input.on("end", () => {
      if (cur) return reject(new Error("the package is cut off (upload it again)"));
      resolve(count);
      void ended;
    });
  });
}

// ---------------- database ----------------

async function database(staging) {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL isn't set in this app's environment variables");
  const req = (m) => require.resolve(m, { paths: [staging] });
  if (process.env.DATABASE_TRANSPORT === "websocket") {
    const { Pool, neonConfig } = await import(pathToFileURL(req("@neondatabase/serverless")).href);
    neonConfig.webSocketConstructor = globalThis.WebSocket;
    const pool = new Pool({ connectionString: raw });
    return { query: async (sql) => (await pool.query(sql)).rows, end: () => pool.end() };
  }
  let pg;
  try { pg = require(req("pg")); } catch { throw new Error("direct database connections need the websocket transport here (DATABASE_TRANSPORT = websocket)"); }
  const client = new pg.Client({ connectionString: raw });
  await client.connect();
  return { query: async (sql) => (await client.query(sql)).rows, end: () => client.end() };
}

/** A Neon restore point before changing the live database (skipped without the Neon keys and on the test site). */
async function restorePoint(label) {
  const key = process.env.NEON_API_KEY;
  const project = process.env.NEON_PROJECT_ID;
  if (!key || !project || process.env.SANDBOX_MODE === "1") return null;
  const call = async (method, p, body) => {
    const r = await fetch(`https://console.neon.tech/api/v2${p}`, { method, headers: { Authorization: `Bearer ${key}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
    const t = await r.text();
    if (!r.ok) throw new Error(`Neon said (${r.status}): ${t.slice(0, 200)}`);
    return t ? JSON.parse(t) : {};
  };
  let parent = process.env.NEON_BRANCH_ID;
  if (!parent) parent = ((await call("GET", `/projects/${project}/branches`)).branches || []).find((b) => b.default || b.primary)?.id;
  const d = new Date();
  const stamp = d.toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
  const name = `restore-point-${stamp}-${label}`.slice(0, 60);
  await call("POST", `/projects/${project}/branches`, { branch: { name, parent_id: parent } });
  return name;
}

// ---------------- update ----------------

(async () => {
  const pkg = findPackage();
  if (!pkg) finish(`Upload coverageoncall-update.tar.gz into ${SITE} first (the folder that has app and node_modules).`, false);
  log(`Package: ${path.basename(pkg)} (${Math.round(fs.statSync(pkg).size / 1048576)} MB)`);

  rm(STAGING);
  fs.mkdirSync(STAGING, { recursive: true });
  log("Unpacking…");
  let files;
  try {
    files = await extract(pkg, STAGING);
  } catch (e) {
    rm(STAGING);
    finish(`Couldn't unpack the package: ${e.message}. Nothing was changed.`, false);
  }
  const manifest = readJson(path.join(STAGING, "manifest.json"));
  const ok = manifest && exists(path.join(STAGING, "app", "apps", "web", "server.js")) && exists(path.join(STAGING, "node_modules", ".prisma"));
  if (!ok) { rm(STAGING); finish("That file isn't a complete update package. Nothing was changed.", false); }
  const current = readJson(path.join(APP, "RELEASE.json"));
  log(`Unpacked ${files} files. Installed: ${current ? current.version : "unknown"}. New: ${manifest.version} (built ${manifest.builtAt}).`);

  // Database updates this site hasn't had yet.
  let db;
  try {
    db = await database(STAGING);
    const applied = new Set((await db.query(`SELECT migration_name::text AS name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`)).map((r) => r.name));
    const pending = manifest.migrations.filter((m) => !applied.has(m));
    if (pending.length) {
      const rp = await restorePoint(`before-${manifest.version}`).catch((e) => { throw new Error(`couldn't make the restore point (${e.message}); make one in Admin → Backups, or remove the Neon keys to skip it`); });
      if (rp) log(`Restore point made: ${rp}`);
      for (const m of pending) {
        log(`Database update: ${m}…`);
        await db.query(fs.readFileSync(path.join(STAGING, "migrations", `${m}.sql`), "utf8"));
      }
      log(`${pending.length} database update${pending.length === 1 ? "" : "s"} applied.`);
    } else log("Database is already up to date.");
  } catch (e) {
    if (db) await db.end().catch(() => {});
    rm(STAGING);
    finish(`Database update failed: ${String(e.message || e).split("\n")[0]}. The app wasn't changed; send this message to your developer.`, false);
  }
  await db.end().catch(() => {});

  // Swap the new app in; keep the current one as the previous version.
  const p = (n) => path.join(SITE, n);
  try {
    rm(p("app-previous"));
    rm(p("node_modules-previous"));
    fs.renameSync(p("app"), p("app-previous"));
    try {
      if (exists(p("node_modules"))) fs.renameSync(p("node_modules"), p("node_modules-previous"));
      fs.renameSync(path.join(STAGING, "node_modules"), p("node_modules"));
      fs.renameSync(path.join(STAGING, "app"), p("app"));
    } catch (e) {
      // Put everything back the way it was.
      if (!exists(p("app")) && exists(p("app-previous"))) fs.renameSync(p("app-previous"), p("app"));
      if (exists(p("node_modules-previous"))) { rm(p("node_modules")); fs.renameSync(p("node_modules-previous"), p("node_modules")); }
      throw e;
    }
  } catch (e) {
    rm(STAGING);
    finish(`Couldn't swap the folders: ${e.message}. The previous version is still in place.`, false);
  }
  rm(STAGING);
  const done = p("installed-updates");
  fs.mkdirSync(done, { recursive: true });
  fs.renameSync(pkg, path.join(done, `${manifest.version}-${path.basename(pkg)}`));
  for (const old of fs.readdirSync(done).map((f) => ({ f, t: fs.statSync(path.join(done, f)).mtimeMs })).sort((a, b) => b.t - a.t).slice(2)) rm(path.join(done, old.f));
  finish(`Installed ${manifest.version}. Now click Start App (or Restart). If anything looks wrong, Stop App, run "rollback", and Start App.`);
})();
