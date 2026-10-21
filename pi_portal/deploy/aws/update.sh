#!/usr/bin/env bash
# CaseMGR — deploy a code update. Keeps secrets.php and storage/ (documents)
# untouched. Run on the server as root:
#   cd /opt/casemgr-src && git pull && bash pi_portal/deploy/aws/update.sh
# Schema changes ship as numbered files in pi_portal/app/migrations/ and are
# applied once each, in order.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Run as root"; exit 1; }
SRC="$(cd "$(dirname "$0")/../.." && pwd)"
APP=/var/www/casemgr

rsync -a --delete --exclude 'app/secrets.php' --exclude 'storage/' "$SRC/" "$APP/"
chown -R root:apache "$APP" && chown -R apache:apache "$APP/storage"
find "$APP" -path "$APP/storage" -prune -o -type f -exec chmod 640 {} +
find "$APP" -path "$APP/storage" -prune -o -type d -exec chmod 750 {} +
sudo -u apache php "$APP/app/cli/migrate.php"
systemctl reload php-fpm httpd
echo "Updated."
