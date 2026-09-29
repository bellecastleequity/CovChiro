#!/usr/bin/env bash
# Builds the cPanel upload package. Run on Linux x64 (or in CI / Docker):
#   bash deploy/cpanel/build.sh
# Output: dist/coverageoncall-cpanel.zip  (app + database-setup.sql + guide)
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT=$(pwd)
OUT=$ROOT/dist/cpanel
APP=$OUT/coverageoncall

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
python3 deploy/cpanel/flatten.py apps/web/.next/standalone/node_modules/.pnpm "$APP/node_modules"
# Not needed: image optimizer (unused) and musl builds (cPanel hosts are glibc).
rm -rf "$APP/node_modules/sharp" "$APP/node_modules/@img" "$APP"/node_modules/@node-rs/argon2-linux-x64-musl
# Turbopack loads server externals through hashed alias symlinks in
# .next/node_modules; replace each with a stub that re-exports the real package.
find "$APP/apps/web/.next/node_modules" -type l 2>/dev/null | while read -r link; do
  real=$(readlink "$link"); real=${real##*/node_modules/}
  rm "$link" && mkdir -p "$link"
  # ESM re-export: resolves through the package's "import" condition, like the traced original.
  printf '{ "name": "%s", "private": true, "type": "module", "main": "index.js" }\n' "$(basename "$link")" > "$link/package.json"
  printf 'export * from "%s";\nexport { default } from "%s";\n' "$real" "$real" > "$link/index.js"
done
if [[ -n "$(find "$APP" -type l -print -quit)" ]]; then echo "symlinks left in package" >&2; exit 1; fi
mkdir -p "$APP/apps/web/.next"
cp -r apps/web/.next/static "$APP/apps/web/.next/static"
[[ -d apps/web/public ]] && cp -r apps/web/public "$APP/apps/web/public"
# cPanel's Node.js screen expects a package.json in the application root.
cat > "$APP/package.json" <<'JSON'
{ "name": "coverageoncall", "private": true, "scripts": { "start": "node apps/web/server.js" } }
JSON
# Never ship local env files.
find "$APP" -maxdepth 3 -name ".env*" -delete

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
cp deploy/cpanel/env.template "$OUT/environment-variables.txt"

(cd "$OUT" && rm -f ../coverageoncall-cpanel.zip && zip -qr ../coverageoncall-cpanel.zip .)
echo "Built dist/coverageoncall-cpanel.zip ($(du -h dist/coverageoncall-cpanel.zip | cut -f1), $(find "$APP" -type f | wc -l) files)"
