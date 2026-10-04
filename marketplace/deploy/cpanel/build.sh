#!/usr/bin/env bash
# Builds the cPanel upload package. Run on Linux x64 (or in CI / Docker):
#   bash deploy/cpanel/build.sh
# Output: dist/coverageoncall-cpanel.zip  (app + database-setup.sql + guide)
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT=$(pwd)
OUT=$ROOT/dist/cpanel
# Named like the domain, matching the usual cPanel convention. The domain's
# document root is pointed at $SITE/public (empty), so the app's own files are
# never served as downloads; uploads live in $SITE/uploads, also not public.
APP_DIR=${APP_DIR:-coverageoncall.com}
SITE=$OUT/$APP_DIR
# CloudLinux's Node.js Selector forbids a node_modules folder inside the
# application root (it reserves that name for its own symlink). So the code
# lives in $SITE/app (the application root) and the dependencies one level up
# in $SITE/node_modules, which Node's module resolution finds by walking up.
APP=$SITE/app

if [[ "$(uname -sm)" != "Linux x86_64" ]]; then
  echo "Build on Linux x86_64 so native modules match the cPanel server (use WSL, a Linux VM, or CI)." >&2
  exit 1
fi

pnpm install --frozen-lockfile
DATABASE_URL=${DATABASE_URL:-postgresql://build@localhost/build} pnpm --filter @cm/db generate
pnpm --filter @cm/web build

rm -rf "$OUT" && mkdir -p "$APP"
# cPanel's File Manager extractor drops symlinks, so turn pnpm's symlinked
# layout into one flat, real node_modules (no package exists in two versions).
cp -r apps/web/.next/standalone/apps "$APP/apps"
rm -rf "$APP/apps/web/node_modules"
python3 deploy/cpanel/flatten.py apps/web/.next/standalone/node_modules/.pnpm "$SITE/node_modules"
# Not needed: image optimizer (unused) and musl builds (cPanel hosts are glibc).
rm -rf "$SITE/node_modules/sharp" "$SITE/node_modules/@img" "$SITE"/node_modules/@node-rs/argon2-linux-x64-musl
# Turbopack loads server externals through hashed alias symlinks in
# .next/node_modules; replace each with a stub that re-exports the real package.
find "$APP/apps/web/.next/node_modules" -type l 2>/dev/null | while read -r link; do
  real=$(readlink "$link"); real=${real##*/node_modules/}
  rm "$link" && mkdir -p "$link"
  # ESM re-export: resolves through the package's "import" condition, like the traced original.
  # Re-export `default` only if the package has one (e.g. @neondatabase/serverless doesn't).
  printf '{ "name": "%s", "private": true, "type": "module", "main": "index.js" }\n' "$(basename "$link")" > "$link/package.json"
  has_default=$(cd "$SITE" && node --input-type=module -e "import('$real').then(m => process.stdout.write('default' in m ? 'yes' : 'no'), e => { console.error(e.message); process.stdout.write('err'); })")
  if [[ "$has_default" == "err" ]]; then echo "cannot load $real from the package" >&2; exit 1; fi
  printf 'export * from "%s";\n' "$real" > "$link/index.js"
  [[ "$has_default" == "yes" ]] && printf 'export { default } from "%s";\n' "$real" >> "$link/index.js"
  echo "  stub $(basename "$link") -> $real (default export: $has_default)"
done
if [[ -n "$(find "$SITE" -type l -print -quit)" ]]; then echo "symlinks left in package" >&2; exit 1; fi
mkdir -p "$APP/apps/web/.next"
cp -r apps/web/.next/static "$APP/apps/web/.next/static"
[[ -d apps/web/public ]] && mkdir -p "$APP/apps/web/public" && cp -r apps/web/public/. "$APP/apps/web/public/"
mkdir -p "$SITE/public" "$SITE/uploads"
# Belt and braces: even if uploads/ ever ends up web-reachable, deny it.
# (Both syntaxes: Namecheap runs LiteSpeed, which honours either form.)
printf '<IfModule mod_authz_core.c>\n  Require all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\n  Order allow,deny\n  Deny from all\n</IfModule>\n' > "$SITE/uploads/.htaccess"
# cPanel's Node.js screen expects a package.json in the application root.
cat > "$APP/package.json" <<'JSON'
{ "name": "coverageoncall", "private": true, "scripts": { "start": "node apps/web/server.js", "dbcheck": "node dbcheck.js", "update": "node updater.js", "rollback": "node updater.js rollback" } }
JSON
# Which release is installed (Admin → Backups shows it; rollback = previous app folder).
LATEST_MIGRATION=$(ls packages/db/prisma/migrations | grep -E '^[0-9]{4}_' | sort | tail -1)
printf '{ "version": "%s", "builtAt": "%s", "latestMigration": "%s" }\n' "$(git rev-parse --short HEAD 2>/dev/null || echo unknown)" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$LATEST_MIGRATION" > "$APP/RELEASE.json"
# Diagnostics: Setup Node.js App → "Run JS script" → dbcheck.
cp deploy/cpanel/dbcheck.js "$APP/dbcheck.js"
# One-file updates: Setup Node.js App → "Run JS script" → update / rollback.
cp deploy/cpanel/updater.js "$APP/updater.js"
# Never ship local env files.
find "$SITE" -maxdepth 4 -name ".env*" -delete
if [[ -e "$APP/node_modules" ]]; then echo "app/ must not contain node_modules (CloudLinux)" >&2; exit 1; fi

# One-shot database setup: both migrations + Prisma's migration history (so
# future `prisma migrate deploy` runs see them as applied), in one transaction.
SQL=$OUT/database-setup.sql
{
  echo "-- CoverageOnCall database setup. Run once on an EMPTY Postgres 16 database"
  echo "-- that allows the postgis, btree_gist and citext extensions (e.g. Neon)."
  echo "BEGIN;"
  echo 'CREATE TABLE IF NOT EXISTS "_prisma_migrations" ("id" VARCHAR(36) PRIMARY KEY NOT NULL, "checksum" VARCHAR(64) NOT NULL, "finished_at" TIMESTAMPTZ, "migration_name" VARCHAR(255) NOT NULL, "logs" TEXT, "rolled_back_at" TIMESTAMPTZ, "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "applied_steps_count" INTEGER NOT NULL DEFAULT 0);'
  for dir in packages/db/prisma/migrations/*/; do
    name=$(basename "$dir")
    file="$dir/migration.sql"
    echo; echo "-- ===== migration $name ====="
    cat "$file"
    sum=$(sha256sum "$file" | cut -d' ' -f1)
    echo; echo "INSERT INTO \"_prisma_migrations\" (id, checksum, finished_at, migration_name, applied_steps_count) VALUES (gen_random_uuid()::text, '$sum', now(), '$name', 1);"
  done
  echo "COMMIT;"
} > "$SQL"

cp INSTALL-CPANEL.md "$OUT/INSTALL-CPANEL.md"
cp INSTALL-SANDBOX.md "$OUT/INSTALL-SANDBOX.md"
cp deploy/cpanel/env.template "$OUT/environment-variables.txt"
# Database updates new in this release, for sites already installed (each
# safe to re-run). Updates from earlier releases live in updates/archive and
# aren't shipped again; a fresh install gets everything from
# database-setup.sql + /setup. "-- @migration <name>" expands to that
# migration plus its Prisma history row.
UPD=$ROOT/dist/updates
rm -rf "$UPD" && mkdir -p "$UPD"
shopt -s nullglob
for f in deploy/cpanel/updates/update-*.sql; do
  {
    while IFS= read -r line; do
      if [[ $line =~ ^--\ @migration\ ([A-Za-z0-9_]+)$ ]]; then
        name=${BASH_REMATCH[1]}
        file=packages/db/prisma/migrations/$name/migration.sql
        sum=$(sha256sum "$file" | cut -d' ' -f1)
        echo "BEGIN;"
        cat "$file"
        echo "INSERT INTO \"_prisma_migrations\" (id, checksum, finished_at, migration_name, applied_steps_count) SELECT gen_random_uuid()::text, '$sum', now(), '$name', 1 WHERE NOT EXISTS (SELECT 1 FROM \"_prisma_migrations\" WHERE migration_name = '$name');"
        echo "COMMIT;"
        echo "SELECT 'update applied' AS result;"
      else
        echo "$line"
      fi
    done < "$f"
  } > "$UPD/$(basename "$f")"
done
shopt -u nullglob

(cd "$OUT" && rm -f ../coverageoncall-cpanel.zip && zip -qr ../coverageoncall-cpanel.zip .)
# Same content in three parts under 30 MB each (for size-limited transfers).
# Each extracts into the same folder; extracting all three = the full package.
(cd "$OUT" && rm -f ../coverageoncall-cpanel-part*.zip \
  && zip -qr -9 ../coverageoncall-cpanel-part1.zip . -x "$APP_DIR/node_modules/@prisma/*" "$APP_DIR/node_modules/.prisma/*" \
  && zip -qr -9 ../coverageoncall-cpanel-part2.zip "$APP_DIR/node_modules/@prisma" \
  && zip -qr -9 ../coverageoncall-cpanel-part3.zip "$APP_DIR/node_modules/.prisma")
# Update packages for an installed site, extracted INSIDE coverageoncall.com:
#   part1 = app/ (every release)
#   part2 = node_modules/ minus .prisma, part3 = node_modules/.prisma (engines
#   included) — only when the schema or dependencies change. Together part2 +
#   part3 are a COMPLETE node_modules, so the install is the same as for app:
#   rename node_modules → node_modules-previous, extract both. (The old part 2
#   left the Prisma engine out and had to be extracted over the old folder;
#   renaming instead of copying caused two outages in Oct 2026.)
# Each part stays under 30 MB. public/ and uploads/ are left alone.
# One-file update package (deploy/cpanel/updater.js): app/ + node_modules/ + every migration
# (each wrapped with its Prisma history row; the updater applies only the ones the site lacks)
# + manifest.json. Uploaded into the site folder and installed with "Run JS script" → update.
PKG=$ROOT/dist/package-staging
rm -rf "$PKG" && mkdir -p "$PKG/migrations"
MIGS=()
for dir in packages/db/prisma/migrations/*/; do
  name=$(basename "$dir")
  [[ $name =~ ^[0-9]{4}_ ]] || continue
  sum=$(sha256sum "$dir/migration.sql" | cut -d' ' -f1)
  {
    echo "BEGIN;"
    cat "$dir/migration.sql"
    echo ""
    echo "INSERT INTO \"_prisma_migrations\" (id, checksum, finished_at, migration_name, applied_steps_count) SELECT gen_random_uuid()::text, '$sum', now(), '$name', 1 WHERE NOT EXISTS (SELECT 1 FROM \"_prisma_migrations\" WHERE migration_name = '$name');"
    echo "COMMIT;"
  } > "$PKG/migrations/$name.sql"
  MIGS+=("\"$name\"")
done
VERSION=$(git rev-parse --short HEAD 2>/dev/null || echo unknown)
printf '{ "version": "%s", "builtAt": "%s", "migrations": [%s] }\n' "$VERSION" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(IFS=,; echo "${MIGS[*]}")" > "$PKG/manifest.json"
rm -f "$ROOT"/dist/coverageoncall-update*.tar.gz
python3 - "$PKG" "$OUT/$APP_DIR" "$ROOT/dist/coverageoncall-update.tar.gz" <<'PY'
import sys, tarfile
pkg, site, out = sys.argv[1:]
with tarfile.open(out, "w:gz", compresslevel=9, format=tarfile.GNU_FORMAT) as t:
    t.add(f"{pkg}/manifest.json", "manifest.json")
    t.add(f"{pkg}/migrations", "migrations")
    t.add(f"{site}/app", "app")
    t.add(f"{site}/node_modules", "node_modules")
PY
rm -rf "$PKG"
# The same package in pieces under 30 MB (for size-limited transfers); the updater joins them.
(cd "$ROOT/dist" && rm -f coverageoncall-update-*.tar.gz.part* && split -b 29m -d -a 1 coverageoncall-update.tar.gz "coverageoncall-update-$VERSION.tar.gz.part" \
  && for f in coverageoncall-update-$VERSION.tar.gz.part[0-9]; do n=${f##*part}; mv "$f" "coverageoncall-update-$VERSION.tar.gz.part$((n + 1))"; done)
echo "Built dist/coverageoncall-update.tar.gz ($(du -h "$ROOT/dist/coverageoncall-update.tar.gz" | cut -f1), one-file update: upload, Stop App, Run JS script update, Start App)"
(cd "$OUT/$APP_DIR" && rm -f "$ROOT"/dist/coverageoncall-update*.zip \
  && zip -qr -9 "$ROOT/dist/coverageoncall-update-part1.zip" app \
  && zip -qr -9 "$ROOT/dist/coverageoncall-update-part2.zip" node_modules -x "node_modules/.prisma/*" \
  && zip -qr -9 "$ROOT/dist/coverageoncall-update-part3.zip" node_modules/.prisma)
# Fresh-install database script on its own too (e.g. for the test site's empty database).
cp "$SQL" "$ROOT/dist/database-setup.sql"
cp INSTALL-SANDBOX.md "$ROOT/dist/INSTALL-SANDBOX.md"
echo "Built dist/coverageoncall-update-part1.zip (app, $(du -h dist/coverageoncall-update-part1.zip | cut -f1)), part2 + part3 (complete node_modules, $(du -h dist/coverageoncall-update-part2.zip | cut -f1) + $(du -h dist/coverageoncall-update-part3.zip | cut -f1)); database updates: $(ls "$UPD" | tr '\n' ' ' | sed 's/ $//' || true)"
echo "Built dist/coverageoncall-cpanel.zip ($(du -h dist/coverageoncall-cpanel.zip | cut -f1), $(find "$SITE" -type f | wc -l) files)"
