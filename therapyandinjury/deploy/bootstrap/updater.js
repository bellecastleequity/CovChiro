'use strict';
/**
 * Therapy & Injury site installer / updater. Zero dependencies (Node 18+ built-ins only).
 *
 * Lives in the cPanel Node.js app root next to app.js. Each release is a .tar.gz package built by
 * deploy/build-release.mjs. Installed releases sit side by side in releases/<version>/; current.json
 * names the live one, so switching versions (or rolling back) is one small file write + a restart.
 *
 *   node updater.js install [file.tar.gz | https://…/file.tar.gz] [--force]
 *        no argument: installs the newest package in incoming/
 *   node updater.js update      check the remote update source (config.json "update") and install if newer
 *   node updater.js check       only report whether a newer version is available
 *   node updater.js rollback    switch back to the previous release
 *   node updater.js activate <version>
 *   node updater.js status
 *
 * In cPanel these run from "Setup Node.js App" → Run JS script (see package.json scripts), or from
 * Terminal. The site's /_admin page uses the same functions (upload a package, update, roll back).
 *
 * Layout of the app root:
 *   app.js, updater.js, package.json   bootstrap (refreshed from each release on install)
 *   config.json                        your settings (never touched by updates)
 *   current.json                       { version, previous, activatedAt }
 *   releases/<version>/                site/, server/, bootstrap/, release.json
 *   incoming/                          drop packages here for "install"
 *   tmp/restart.txt                    touched to make Passenger restart the app
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const ROOT = __dirname;
const RELEASES = path.join(ROOT, 'releases');
const INCOMING = path.join(ROOT, 'incoming');
const CURRENT = path.join(ROOT, 'current.json');
const KEEP = 4; // installed releases kept (the current and previous ones are always kept)
const PACKAGE_RE = /^therapyandinjury-(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\.tar\.gz$/;

function log(...a) { console.log('[updater]', ...a); }

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJsonAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

function loadConfig() {
  return readJson(path.join(ROOT, 'config.json'), {});
}

/** Compares "1.2.10" and "1.2.9" numerically (pre-release tags sort before the release). */
function compareVersions(a, b) {
  const pa = String(a).split(/[-+]/)[0].split('.').map(Number);
  const pb = String(b).split(/[-+]/)[0].split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  const ta = String(a).includes('-'), tb = String(b).includes('-');
  return ta === tb ? 0 : ta ? -1 : 1;
}

/** Reads a .tar.gz buffer (ustar, GNU long names and pax headers) into [{ name, type, data, mode }]. */
function untar(gz) {
  const buf = zlib.gunzipSync(gz);
  const out = [];
  let pos = 0, longName = null, paxPath = null;
  const str = (o, n) => buf.toString('utf8', o, o + n).replace(/\0[\s\S]*$/, '');
  while (pos + 512 <= buf.length) {
    const h = pos;
    if (buf[h] === 0) break; // end-of-archive blocks
    const size = parseInt(str(h + 124, 12).trim() || '0', 8);
    const type = String.fromCharCode(buf[h + 156] || 48);
    const prefix = str(h + 345, 155);
    let name = str(h, 100);
    if (prefix) name = `${prefix}/${name}`;
    const data = buf.subarray(h + 512, h + 512 + size);
    pos = h + 512 + Math.ceil(size / 512) * 512;
    if (type === 'L') { longName = data.toString('utf8').replace(/\0+$/, ''); continue; }
    if (type === 'x') {
      const m = /\d+ path=([^\n]*)\n/.exec(data.toString('utf8'));
      if (m) paxPath = m[1];
      continue;
    }
    if (type === 'g') continue;
    if (longName) { name = longName; longName = null; }
    if (paxPath) { name = paxPath; paxPath = null; }
    out.push({ name, type, data, mode: parseInt(str(h + 100, 8).trim() || '644', 8) });
  }
  return out;
}

/** Writes entries under dir, refusing absolute paths, "..", and links. */
function extractTo(entries, dir, strip) {
  for (const e of entries) {
    let rel = e.name.replace(/^\.\//, '');
    if (strip) {
      if (!rel.startsWith(strip)) continue;
      rel = rel.slice(strip.length);
    }
    if (!rel) continue;
    if (path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) throw new Error(`Unsafe path in package: ${e.name}`);
    const target = path.join(dir, rel);
    if (e.type === '5') { fs.mkdirSync(target, { recursive: true }); continue; }
    if (e.type !== '0' && e.type !== '\0') continue; // files only; skip links/devices
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, e.data, { mode: e.mode & 0o755 });
  }
}

function touchRestart() {
  fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
  const f = path.join(ROOT, 'tmp', 'restart.txt');
  fs.writeFileSync(f, new Date().toISOString() + '\n');
}

function current() {
  return readJson(CURRENT, null);
}

function installed() {
  if (!fs.existsSync(RELEASES)) return [];
  return fs.readdirSync(RELEASES)
    .filter((v) => !v.startsWith('.') && fs.existsSync(path.join(RELEASES, v, 'release.json')))
    .map((v) => ({ version: v, ...readJson(path.join(RELEASES, v, 'release.json'), {}) }))
    .sort((a, b) => compareVersions(b.version, a.version));
}

/** Copies the release's bootstrap files (app.js, updater.js, package.json) into the app root. */
function refreshBootstrap(releaseDir) {
  const src = path.join(releaseDir, 'bootstrap');
  for (const f of ['app.js', 'updater.js', 'package.json', 'config.example.json']) {
    const from = path.join(src, f);
    if (!fs.existsSync(from)) continue;
    const to = path.join(ROOT, f);
    const next = fs.readFileSync(from);
    if (fs.existsSync(to) && fs.readFileSync(to).equals(next)) continue;
    fs.writeFileSync(`${to}.tmp`, next);
    fs.renameSync(`${to}.tmp`, to);
    log(`refreshed ${f}`);
  }
}

function prune() {
  const cur = current() || {};
  const keep = new Set([cur.version, cur.previous].filter(Boolean));
  installed().forEach((r, i) => {
    if (i >= KEEP && !keep.has(r.version)) {
      fs.rmSync(path.join(RELEASES, r.version), { recursive: true, force: true });
      log(`removed old release ${r.version}`);
    }
  });
}

/** Makes `version` the live release and asks Passenger to restart. */
function activate(version) {
  const dir = path.join(RELEASES, version);
  if (!fs.existsSync(path.join(dir, 'release.json'))) throw new Error(`Release ${version} is not installed`);
  const cur = current();
  writeJsonAtomic(CURRENT, {
    version,
    previous: cur && cur.version !== version ? cur.version : cur?.previous || null,
    activatedAt: new Date().toISOString(),
  });
  refreshBootstrap(dir);
  touchRestart();
  log(`active release: ${version} (restart requested)`);
  return { version };
}

/**
 * Installs a package buffer: verifies it, unpacks to releases/<version>/, activates it.
 * `expectedSha256` (optional) is checked against the package bytes.
 */
function installBuffer(buf, { force = false, expectedSha256 = null, source = 'upload', activateNow = true, noDowngrade = false } = {}) {
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  if (expectedSha256 && expectedSha256.toLowerCase() !== sha256) throw new Error('Package checksum does not match; not installed');
  let entries;
  try { entries = untar(buf); } catch (e) { throw new Error(`Not a valid .tar.gz package (${e.message})`); }
  const manifestEntry = entries.find((e) => e.name.replace(/^\.\//, '') === 'release/release.json');
  if (!manifestEntry) throw new Error('Package has no release/release.json; is this a Therapy & Injury release package?');
  const manifest = JSON.parse(manifestEntry.data.toString('utf8'));
  const version = manifest.version;
  if (!/^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/.test(version || '')) throw new Error(`Bad version in package: ${version}`);
  for (const need of ['release/site/index.html', 'release/server/server.js', 'release/bootstrap/app.js']) {
    if (!entries.some((e) => e.name.replace(/^\.\//, '') === need)) throw new Error(`Package is missing ${need}`);
  }
  const dir = path.join(RELEASES, version);
  const cur = current();
  // An older package never replaces a newer live release unless asked (activate/rollback/--force).
  const older = noDowngrade && !force && cur && compareVersions(version, cur.version) < 0;
  if (fs.existsSync(dir)) {
    if (!force) {
      if (cur?.version === version) { log(`release ${version} is already installed and active`); return { version, alreadyInstalled: true, active: true }; }
      if (older) { log(`release ${version} is older than the active ${cur.version}; not switching (use activate ${version} to switch)`); return { version, alreadyInstalled: true, skipped: 'older than active release' }; }
      log(`release ${version} is already installed`);
      return activateNow ? { ...activate(version), alreadyInstalled: true } : { version, alreadyInstalled: true };
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const staging = path.join(RELEASES, `.staging-${version}-${process.pid}`);
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  try {
    extractTo(entries, staging, 'release/');
    writeJsonAtomic(path.join(staging, 'release.json'), { ...manifest, installedAt: new Date().toISOString(), sha256, source });
    fs.renameSync(staging, dir);
  } catch (e) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw e;
  }
  log(`installed release ${version} from ${source}`);
  if (older) log(`release ${version} is older than the active ${cur.version}; installed but not switched (use activate ${version} to switch)`);
  const result = activateNow && !older ? activate(version) : { version, ...(older && { skipped: 'older than active release' }) };
  prune();
  return { ...result, sha256 };
}

async function download(url, headers = {}) {
  const r = await fetch(url, { headers: { 'user-agent': 'therapyandinjury-updater', ...headers }, redirect: 'follow' });
  if (!r.ok) throw new Error(`Download failed (${r.status}) for ${url.replace(/[?#].*$/, '')}`);
  return Buffer.from(await r.arrayBuffer());
}

/**
 * Finds the newest release on the configured update source:
 *   config.update.manifestUrl: JSON { version, url, sha256 } (any HTTPS host), optional config.update.headers
 *   config.update.github: { repo: "owner/name", token } — latest GitHub release whose asset is therapyandinjury-<v>.tar.gz
 */
async function findRemote(config = loadConfig()) {
  const u = config.update || {};
  const token = process.env.GITHUB_TOKEN || u.github?.token;
  if (u.manifestUrl) {
    const m = JSON.parse((await download(u.manifestUrl, u.headers || {})).toString('utf8'));
    if (!m.version || !m.url) throw new Error('Update manifest needs "version" and "url"');
    return { version: m.version, fetch: () => download(m.url, u.headers || {}), sha256: m.sha256 || null, from: m.url };
  }
  if (u.github?.repo) {
    const api = `https://api.github.com/repos/${u.github.repo}/releases/latest`;
    const auth = token ? { authorization: `Bearer ${token}` } : {};
    const rel = JSON.parse((await download(api, { accept: 'application/vnd.github+json', ...auth })).toString('utf8'));
    const asset = (rel.assets || []).find((a) => PACKAGE_RE.test(a.name));
    if (!asset) throw new Error(`Latest GitHub release (${rel.tag_name}) has no therapyandinjury-<version>.tar.gz asset`);
    const sumAsset = (rel.assets || []).find((a) => a.name === `${asset.name}.sha256`);
    const get = (a) => download(a.url, { accept: 'application/octet-stream', ...auth });
    let sha256 = null;
    if (sumAsset) sha256 = (await get(sumAsset)).toString('utf8').trim().split(/\s+/)[0];
    return { version: PACKAGE_RE.exec(asset.name)[1], fetch: () => get(asset), sha256, from: `GitHub ${u.github.repo} ${rel.tag_name}` };
  }
  throw new Error('No update source set. Add "update": { "github": { "repo": "owner/name" } } or "update": { "manifestUrl": "https://…" } to config.json');
}

async function check() {
  const remote = await findRemote();
  const cur = current();
  const newer = !cur || compareVersions(remote.version, cur.version) > 0;
  return { current: cur?.version || null, latest: remote.version, newer, from: remote.from };
}

async function update({ force = false } = {}) {
  const remote = await findRemote();
  const cur = current();
  if (cur && !force && compareVersions(remote.version, cur.version) <= 0) {
    return { upToDate: true, version: cur.version };
  }
  const buf = await remote.fetch();
  return installBuffer(buf, { expectedSha256: remote.sha256, source: remote.from, force });
}

/** Installs the newest package in incoming/ (used by first boot and "install" with no argument). */
function installIncoming({ force = false } = {}) {
  if (!fs.existsSync(INCOMING)) throw new Error('No incoming/ folder with a package to install');
  const pkgs = fs.readdirSync(INCOMING).filter((f) => PACKAGE_RE.test(f))
    .sort((a, b) => compareVersions(PACKAGE_RE.exec(b)[1], PACKAGE_RE.exec(a)[1]));
  if (!pkgs.length) throw new Error('No therapyandinjury-<version>.tar.gz in incoming/');
  const file = path.join(INCOMING, pkgs[0]);
  const sumFile = `${file}.sha256`;
  const expectedSha256 = fs.existsSync(sumFile) ? fs.readFileSync(sumFile, 'utf8').trim().split(/\s+/)[0] : null;
  return installBuffer(fs.readFileSync(file), { force, expectedSha256, source: `incoming/${pkgs[0]}`, noDowngrade: true });
}

function rollback() {
  const cur = current();
  if (!cur?.previous) throw new Error('No previous release to roll back to');
  return activate(cur.previous);
}

function status() {
  return { root: ROOT, current: current(), installed: installed().map((r) => ({ version: r.version, builtAt: r.builtAt, commit: r.commit, installedAt: r.installedAt })) };
}

module.exports = { installBuffer, installIncoming, activate, rollback, check, update, status, current, installed, compareVersions, touchRestart, untar, ROOT };

if (require.main === module) {
  const [cmd, arg] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const force = process.argv.includes('--force');
  const run = async () => {
    switch (cmd) {
      case 'install':
        if (!arg) return installIncoming({ force });
        if (/^https:\/\//.test(arg)) return installBuffer(await download(arg), { force, source: arg });
        {
          const sum = `${arg}.sha256`;
          const expectedSha256 = fs.existsSync(sum) ? fs.readFileSync(sum, 'utf8').trim().split(/\s+/)[0] : null;
          return installBuffer(fs.readFileSync(path.resolve(arg)), { force, expectedSha256, source: path.basename(arg) });
        }
      case 'update': return update({ force });
      case 'check': return check();
      case 'rollback': return rollback();
      case 'activate': return activate(arg);
      case 'status': case undefined: return status();
      default: throw new Error(`Unknown command "${cmd}". Use install, update, check, rollback, activate or status.`);
    }
  };
  run().then((r) => { console.log(JSON.stringify(r, null, 2)); }).catch((e) => { console.error(`[updater] ERROR: ${e.message}`); process.exit(1); });
}
