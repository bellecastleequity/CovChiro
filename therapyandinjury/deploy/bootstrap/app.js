'use strict';
/**
 * Startup file for cPanel "Setup Node.js App" (Phusion Passenger). Set "Application startup file" to app.js.
 *
 * Loads the live release named in current.json (releases/<version>/server/server.js). On the very first
 * start, if nothing is installed yet, it installs the newest package from incoming/ automatically.
 * Updates never replace this file's job: they add a new releases/<version>/ and switch current.json.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = __dirname;

function fail(message, err) {
  // Keep the site answering (503) with a plain explanation instead of a Passenger error page.
  console.error(`[app] ${message}`, err ? err.stack || err.message : '');
  const server = http.createServer((req, res) => {
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8', 'retry-after': '120', 'cache-control': 'no-store' });
    res.end('Therapy & Injury: the site is being set up. Please call (844) 84-TREAT.\n');
  });
  server.listen(process.env.PORT || 3000);
}

let current;
try {
  current = JSON.parse(fs.readFileSync(path.join(ROOT, 'current.json'), 'utf8'));
} catch {
  try {
    console.log('[app] no release active yet; installing from incoming/ …');
    require('./updater.js').installIncoming();
    current = JSON.parse(fs.readFileSync(path.join(ROOT, 'current.json'), 'utf8'));
  } catch (e) {
    fail('Not installed. Upload a therapyandinjury-<version>.tar.gz to incoming/ and run the "install-release" script.', e);
  }
}

if (current) {
  const releaseDir = path.join(ROOT, 'releases', current.version);
  try {
    require(path.join(releaseDir, 'server', 'server.js')).start({ root: ROOT, releaseDir, version: current.version });
  } catch (e) {
    // A broken release should not take the site down: fall back to the previous one if there is one.
    if (current.previous && fs.existsSync(path.join(ROOT, 'releases', current.previous, 'server', 'server.js'))) {
      console.error(`[app] release ${current.version} failed to start; serving ${current.previous}`, e.stack || e.message);
      const prevDir = path.join(ROOT, 'releases', current.previous);
      require(path.join(prevDir, 'server', 'server.js')).start({ root: ROOT, releaseDir: prevDir, version: current.previous, degraded: current.version });
    } else {
      fail(`Release ${current.version} failed to start.`, e);
    }
  }
}
