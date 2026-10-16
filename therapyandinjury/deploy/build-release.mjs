// Builds a deployable release of therapyandinjury.com for cPanel Node.js.
//
//   npm run release                 # builds the site, then packages version from package.json
//   npm run release -- 1.0.1        # or set the version here (also written back to package.json)
//   npm run release -- --skip-build # package the existing dist/ as-is
//
// Output in deploy/out/:
//   therapyandinjury-<version>.tar.gz (+ .sha256)   the release package: upload it at /_admin for updates
//   therapyandinjury-node-<version>.zip             first install: extract into the cPanel app root
//   latest.json                                     optional update manifest { version, url, sha256 }
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const project = path.join(here, '..');
const outDir = path.join(here, 'out');
const args = process.argv.slice(2);
const pkgFile = path.join(project, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
const argVersion = args.find((a) => /^\d+\.\d+\.\d+/.test(a));
if (argVersion && argVersion !== pkg.version) {
  pkg.version = argVersion;
  fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n');
}
const version = pkg.version;
if (!/^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`Bad version "${version}" in package.json`);

if (!args.includes('--skip-build')) execFileSync('npm', ['run', 'build'], { cwd: project, stdio: 'inherit' });
const dist = path.join(project, 'dist');
for (const need of ['client', 'server/entry.mjs', 'check/index.html']) {
  if (!fs.existsSync(path.join(dist, need))) throw new Error(`dist/${need} is missing; run the build first (npm run build)`);
}

let commit = '';
try { commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: project }).toString().trim(); } catch {}

// ---------- tar (ustar) writer ----------
function tarHeader(name, size, type, mode, mtime) {
  const h = Buffer.alloc(512);
  let prefix = '';
  if (Buffer.byteLength(name) > 100) {
    const cut = name.lastIndexOf('/', 155);
    if (cut <= 0 || Buffer.byteLength(name.slice(cut + 1)) > 100) throw new Error(`Path too long for the package: ${name}`);
    prefix = name.slice(0, cut);
    name = name.slice(cut + 1);
  }
  h.write(name, 0, 100);
  h.write(mode.toString(8).padStart(7, '0') + '\0', 100);
  h.write('0000000\0', 108); h.write('0000000\0', 116);
  h.write(size.toString(8).padStart(11, '0') + '\0', 124);
  h.write(Math.floor(mtime / 1000).toString(8).padStart(11, '0') + '\0', 136);
  h.write('        ', 148);
  h.write(type, 156);
  h.write('ustar\0', 257); h.write('00', 263);
  h.write(prefix, 345, 155);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return h;
}
function tarGz(entries) {
  const parts = [];
  for (const e of entries) {
    if (e.dir) { parts.push(tarHeader(e.name.replace(/\/?$/, '/'), 0, '5', 0o755, e.mtime)); continue; }
    parts.push(tarHeader(e.name, e.data.length, '0', 0o644, e.mtime), e.data, Buffer.alloc((512 - (e.data.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(parts), { level: 9 });
}

// ---------- zip writer (deflate) ----------
function crc32(buf) {
  if (zlib.crc32) return zlib.crc32(buf);
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  const d = new Date();
  const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const f of files) {
    const name = Buffer.from(f.name);
    const deflated = zlib.deflateRawSync(f.data, { level: 9 });
    const useDeflate = deflated.length < f.data.length;
    const body = useDeflate ? deflated : f.data;
    const crc = crc32(f.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(useDeflate ? 8 : 0, 8); local.writeUInt16LE(dosTime, 10); local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(0x031e, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(useDeflate ? 8 : 0, 10); central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(f.data.length, 24); central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38); central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

// ---------- collect the release ----------
const entries = [];
const now = Date.now();
function addTree(srcDir, prefix, skip = () => false) {
  for (const ent of fs.readdirSync(srcDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const src = path.join(srcDir, ent.name);
    const name = `${prefix}/${ent.name}`;
    if (skip(ent.name, src)) continue;
    if (ent.isDirectory()) { entries.push({ name, dir: true, mtime: now }); addTree(src, name, skip); }
    else if (ent.isFile()) entries.push({ name, data: fs.readFileSync(src), mtime: fs.statSync(src).mtimeMs });
  }
}
const site = JSON.parse(fs.readFileSync(path.join(project, 'src/data/site.json'), 'utf8'));
const branches = JSON.parse(fs.readFileSync(path.join(project, 'src/data/branches.json'), 'utf8'));
const serverSite = {
  domain: site.domain,
  branches: branches.map((b) => b.slug),
  cityDomains: Object.fromEntries(branches.flatMap((b) => (b.domains || []).map((d) => [d.toLowerCase(), b.slug]))),
};
const manifest = { name: 'therapyandinjury.com', version, builtAt: new Date().toISOString(), commit, node: '>=18' };

entries.push({ name: 'release', dir: true, mtime: now });
// site/: static files (the Node server does .htaccess's job, so it's left out). index.html is the
// build-time home page: older updaters require it, and it's never served (pages come from site-server/).
entries.push({ name: 'release/site', dir: true, mtime: now });
addTree(path.join(dist, 'client'), 'release/site', (n) => n.startsWith('.'));
entries.push({ name: 'release/site/index.html', data: fs.readFileSync(path.join(dist, 'check/index.html')), mtime: now });
// site-server/: the page renderer. site-static/: every page as rendered at build time (fallback only).
entries.push({ name: 'release/site-server', dir: true, mtime: now });
addTree(path.join(dist, 'server'), 'release/site-server');
entries.push({ name: 'release/site-static', dir: true, mtime: now });
addTree(path.join(dist, 'check'), 'release/site-static', (n, src) => n.startsWith('.') || (!fs.statSync(src).isDirectory() && !/\.(html|xml|txt)$/.test(n)));
entries.push({ name: 'release/server', dir: true, mtime: now });
addTree(path.join(here, 'server'), 'release/server');
entries.push({ name: 'release/server/site.json', data: Buffer.from(JSON.stringify(serverSite, null, 2) + '\n'), mtime: now });
entries.push({ name: 'release/bootstrap', dir: true, mtime: now });
addTree(path.join(here, 'bootstrap'), 'release/bootstrap');
entries.push({ name: 'release/release.json', data: Buffer.from(JSON.stringify(manifest, null, 2) + '\n'), mtime: now });

fs.mkdirSync(outDir, { recursive: true });
const pkgName = `therapyandinjury-${version}.tar.gz`;
const tgz = tarGz(entries);
const sha256 = crypto.createHash('sha256').update(tgz).digest('hex');
fs.writeFileSync(path.join(outDir, pkgName), tgz);
fs.writeFileSync(path.join(outDir, `${pkgName}.sha256`), `${sha256}  ${pkgName}\n`);
fs.writeFileSync(path.join(outDir, 'latest.json'), JSON.stringify({ version, url: `https://YOUR-HOST/${pkgName}`, sha256 }, null, 2) + '\n');

// First-install zip: bootstrap files at the top, the package in incoming/, and the setup guide.
const boot = (f) => ({ name: f, data: fs.readFileSync(path.join(here, 'bootstrap', f)) });
const zipName = `therapyandinjury-node-${version}.zip`;
fs.writeFileSync(path.join(outDir, zipName), zip([
  boot('app.js'), boot('updater.js'), boot('package.json'), boot('config.example.json'),
  { name: 'DEPLOY.md', data: fs.readFileSync(path.join(here, 'DEPLOY.md')) },
  { name: `incoming/${pkgName}`, data: tgz },
  { name: `incoming/${pkgName}.sha256`, data: Buffer.from(`${sha256}  ${pkgName}\n`) },
]));

const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;
console.log(`\nRelease ${version}${commit ? ` (${commit})` : ''}
  ${path.relative(project, path.join(outDir, pkgName))}  ${mb(tgz.length)}  sha256 ${sha256.slice(0, 16)}…  ← updates: upload at /_admin
  ${path.relative(project, path.join(outDir, zipName))}  ← first install: extract into the cPanel app root (see DEPLOY.md)`);
