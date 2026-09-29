// Database connectivity check for cPanel: Setup Node.js App → "Run JS script" → dbcheck.
// Prints a plain-English diagnosis; never prints the password.
const net = require("net");

function done(msg) {
  console.log("\n==> " + msg + "\n");
  process.exit(0);
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
const port = Number(url.port || 5432);
const db = url.pathname.replace(/^\//, "");
console.log(`Host: ${host}\nPort: ${port}\nDatabase: ${db}\nUser: ${decodeURIComponent(url.username)}\nOptions: ${url.search || "(none)"}`);
if (host.includes("-pooler")) console.log("Note: this is the POOLED host. Use the non-pooled connection string (pooling off in Neon's Connect dialog).");
if (url.searchParams.has("channel_binding")) console.log("Note: remove '&channel_binding=require' from the end of DATABASE_URL.");

const sock = net.connect(port, host);
sock.setTimeout(10000);
sock.on("timeout", () => {
  sock.destroy();
  done(`BLOCKED: could not reach ${host} on port ${port} within 10s. The hosting firewall is blocking outgoing database connections.`);
});
sock.on("error", (e) => done(`NETWORK ERROR (${e.code}): ${e.message}. If this is ENOTFOUND, the host name in DATABASE_URL is wrong.`));
sock.on("connect", async () => {
  sock.end();
  console.log(`Port ${port} is OPEN. Trying to log in…`);
  let prisma;
  try {
    const { PrismaClient } = require("@prisma/client");
    prisma = new PrismaClient();
    const [{ current_database }] = await prisma.$queryRawUnsafe("select current_database()");
    console.log(`Logged in. Connected to database "${current_database}".`);
    const [{ n }] = await prisma.$queryRawUnsafe(`select count(*)::int as n from information_schema.tables where table_schema='public' and table_name in ('User','Shift','Profession','_prisma_migrations')`);
    if (n < 4) done(`CONNECTED, but the app's tables are missing in "${current_database}". Either DATABASE_URL points at the wrong database (it must be the one where database-setup.sql was run), or the setup script hasn't been run there.`);
    done(`ALL GOOD: database "${current_database}" is reachable and set up. If the site still errors, restart the app and check again.`);
  } catch (e) {
    const m = String(e && e.message ? e.message : e).split("\n").filter(Boolean).slice(-3).join(" ");
    if (/password authentication failed|authentication/i.test(m)) done(`LOGIN FAILED: wrong user or password in DATABASE_URL. Copy it again from Neon (Connect → pooling off → Show password).`);
    if (/does not exist/i.test(m)) done(`DATABASE NOT FOUND: "${db}" doesn't exist. Use the database name shown in Neon where you ran the setup script.`);
    done(`CONNECTION FAILED: ${m}`);
  } finally {
    if (prisma) await prisma.$disconnect().catch(() => {});
  }
});
