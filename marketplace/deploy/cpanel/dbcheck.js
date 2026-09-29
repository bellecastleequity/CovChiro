// Database connectivity check for cPanel: Setup Node.js App → "Run JS script" → dbcheck.
// Prints a plain-English diagnosis; never prints the password.
const net = require("net");

function done(msg) {
  console.log("\n==> " + msg + "\n");
  process.exit(0);
}

// CloudLinux caps each process at 4 GB of address space; Node's built-in
// fetch/WebSocket (undici) reserves more than that for WebAssembly unless
// started with --disable-wasm-trap-handler.
for (const ev of ["uncaughtException", "unhandledRejection"]) {
  process.on(ev, (e) => {
    const m = String(e && e.message ? e.message : e);
    if (/Wasm memory|WebAssembly/i.test(m)) done("MEMORY LIMIT: add the environment variable NODE_OPTIONS = --disable-wasm-trap-handler, restart the app, and run dbcheck again.");
    done(`UNEXPECTED ERROR: ${m.split("\n")[0]}`);
  });
}

/** Details needed to pick the right Prisma engine for this server. */
function engineReport(message) {
  const fs = require("fs");
  const path = require("path");
  const { execSync } = require("child_process");
  const lines = message.split("\n").map((l) => l.trim()).filter(Boolean);
  console.log("\n--- engine report ---");
  console.log("Error: " + lines.filter((l) => /runtime|engine|require|GLIBC|libssl|cannot open/i.test(l)).slice(0, 4).join(" | "));
  try {
    const os = fs.readFileSync("/etc/os-release", "utf8");
    console.log("OS: " + (os.match(/^PRETTY_NAME="?([^"\n]*)/m) || [])[1] + " (ID_LIKE=" + ((os.match(/^ID_LIKE="?([^"\n]*)/m) || [])[1] || "-") + ")");
  } catch { console.log("OS: /etc/os-release not readable"); }
  for (const cmd of ["openssl version", "ldd --version"]) {
    try { console.log(cmd + ": " + execSync(cmd + " 2>&1", { encoding: "utf8" }).split("\n")[0]); } catch (x) { console.log(cmd + ": not available"); }
  }
  try {
    const libs = fs.readdirSync("/usr/lib64").concat(fs.existsSync("/lib64") ? fs.readdirSync("/lib64") : []).filter((f) => /^libssl\.so/.test(f));
    console.log("libssl files: " + ([...new Set(libs)].join(", ") || "none found"));
  } catch { console.log("libssl files: not readable"); }
  let dir;
  try { dir = path.dirname(require.resolve(".prisma/client/default")); } catch { dir = null; }
  console.log("Engine folder: " + (dir || "NOT FOUND (node_modules/.prisma is missing — re-extract part 3)"));
  if (dir) console.log("Engine files: " + (fs.readdirSync(dir).filter((f) => f.includes("query_engine")).join(", ") || "none"));
  console.log("Node: " + process.version + " " + process.arch);
  console.log("---------------------");
  // CloudLinux hides /etc/os-release, so Prisma guesses the wrong engine; name it explicitly.
  if (dir) {
    let ssl = "";
    try { ssl = execSync("openssl version 2>&1", { encoding: "utf8" }); } catch {}
    const want = /OpenSSL 3\./.test(ssl) ? "rhel-openssl-3.0.x" : "rhel-openssl-1.1.x";
    const file = path.join(dir, `libquery_engine-${want}.so.node`);
    if (fs.existsSync(file)) console.log(`FIX: add the environment variable PRISMA_QUERY_ENGINE_LIBRARY = ${file}  then restart the app and run dbcheck again.`);
  }
}

const raw = process.env.DATABASE_URL;
if (!raw) done("DATABASE_URL is not set in this app's environment variables.");
let url;
try {
  url = new URL(raw);
} catch {
  done("DATABASE_URL is not a valid connection string (check for spaces or quotes).");
}
const host = url.hostname;
const websocket = process.env.DATABASE_TRANSPORT === "websocket";
// WebSocket transport reaches Neon on HTTPS port 443 instead of Postgres' 5432.
const port = websocket ? 443 : Number(url.port || 5432);
const db = url.pathname.replace(/^\//, "");
console.log(`Transport: ${websocket ? "websocket (port 443)" : "direct (port 5432)"}\nHost: ${host}\nPort: ${port}\nDatabase: ${db}\nUser: ${decodeURIComponent(url.username)}\nOptions: ${url.search || "(none)"}`);
if (host.includes("-pooler")) console.log("Note: this is the POOLED host. Use the non-pooled connection string (pooling off in Neon's Connect dialog).");
if (url.searchParams.has("channel_binding")) console.log("Note: remove '&channel_binding=require' from the end of DATABASE_URL.");

const sock = net.connect(port, host);
sock.setTimeout(10000);
sock.on("timeout", () => {
  sock.destroy();
  done(websocket
    ? `BLOCKED: could not reach ${host} on port 443 within 10s. Check the host name in DATABASE_URL.`
    : `BLOCKED: could not reach ${host} on port ${port} within 10s. The hosting firewall is blocking outgoing database connections. Add the environment variable DATABASE_TRANSPORT = websocket, restart the app, and run dbcheck again.`);
});
sock.on("error", (e) => {
  if (e.code === "ENOTFOUND") done(`HOST NOT FOUND: "${host}" doesn't exist. The host name in DATABASE_URL is wrong.`);
  if (!websocket && (e.code === "ETIMEDOUT" || e.code === "ECONNREFUSED" || e.code === "EHOSTUNREACH"))
    done(`BLOCKED (${e.code}): the hosting firewall is blocking outgoing database connections on port ${port}. Add the environment variable DATABASE_TRANSPORT = websocket, restart the app, and run dbcheck again.`);
  done(`NETWORK ERROR (${e.code}): ${e.message}`);
});
sock.on("connect", async () => {
  sock.end();
  console.log(`Port ${port} is OPEN. Trying to log in${websocket ? " over WebSocket" : ""}…`);
  let prisma;
  try {
    const { PrismaClient } = require("@prisma/client");
    let adapter;
    if (websocket) {
      // These ship as ES modules only, so load them with import().
      const { neonConfig } = await import("@neondatabase/serverless");
      const { PrismaNeon } = await import("@prisma/adapter-neon");
      neonConfig.webSocketConstructor = globalThis.WebSocket;
      adapter = new PrismaNeon({ connectionString: raw });
    }
    prisma = new PrismaClient(adapter ? { adapter } : undefined);
    const [{ current_database }] = await prisma.$queryRawUnsafe("select current_database()::text as current_database");
    console.log(`Logged in. Connected to database "${current_database}".`);
    const [{ n }] = await prisma.$queryRawUnsafe(`select count(*)::int as n from information_schema.tables where table_schema='public' and table_name in ('User','Shift','Profession','_prisma_migrations')`);
    if (n < 4) done(`CONNECTED, but the app's tables are missing in "${current_database}". Either DATABASE_URL points at the wrong database (it must be the one where database-setup.sql was run), or the setup script hasn't been run there.`);
    done(`ALL GOOD: database "${current_database}" is reachable and set up. If the site still errors, restart the app and check again.`);
  } catch (e) {
    const full = String(e && e.message ? e.message : e);
    if (/could not locate the Query Engine|Unable to require|libquery_engine|Query engine library/i.test(full)) {
      engineReport(full);
      done("ENGINE NOT FOUND: the database engine file for this server's system is missing. Send the lines above to your developer.");
    }
    const m = full.split("\n").filter(Boolean).slice(-3).join(" ");
    if (/password authentication failed|authentication/i.test(m)) done(`LOGIN FAILED: wrong user or password in DATABASE_URL. Copy it again from Neon (Connect → pooling off → Show password).`);
    if (/does not exist/i.test(m)) done(`DATABASE NOT FOUND: "${db}" doesn't exist. Use the database name shown in Neon where you ran the setup script.`);
    done(`CONNECTION FAILED: ${m}`);
  } finally {
    if (prisma) await prisma.$disconnect().catch(() => {});
  }
});
