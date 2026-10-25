#!/usr/bin/env bash
# InjuryCase — deploy a code update. Keeps secrets.php and storage/ (documents)
# untouched. Run on the server as root:
#   cd /opt/injurycase-src && git pull && bash pi_portal/deploy/aws/update.sh
# Schema changes ship as numbered files in pi_portal/app/migrations/ and are
# applied once each, in order.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Run as root"; exit 1; }
SRC="$(cd "$(dirname "$0")/../.." && pwd)"
APP=/var/www/injurycase

# PHP GD (white-label logo re-encoding); no-op once installed.
rpm -q php8.3-gd >/dev/null 2>&1 || dnf -y install php8.3-gd

rsync -a --delete --exclude 'app/secrets.php' --exclude 'storage/' "$SRC/" "$APP/"
chown -R root:apache "$APP" && chown -R apache:apache "$APP/storage"
find "$APP" -path "$APP/storage" -prune -o -type f -exec chmod 640 {} +
find "$APP" -path "$APP/storage" -prune -o -type d -exec chmod 750 {} +
sudo -u apache php "$APP/app/cli/migrate.php"
# Daily jobs (kept in step with setup.sh).
# Times are the practice's (US Eastern): daily digest 6:38am, trial reminders 9:17am.
printf '%s\n' "CRON_TZ=America/New_York" \
  "38 6 * * * apache php $APP/app/cli/daily_digest.php >> $APP/storage/logs/cron.log 2>&1" \
  "52 7 * * * apache php $APP/app/cli/task_reminders.php >> $APP/storage/logs/cron.log 2>&1" \
  "23 9 * * 1-5 apache php $APP/app/cli/status_requests.php >> $APP/storage/logs/cron.log 2>&1" \
  "41 9 * * 1-5 apache php $APP/app/cli/case_updates.php >> $APP/storage/logs/cron.log 2>&1" \
  "17 9 * * * apache php $APP/app/cli/trial_reminders.php >> $APP/storage/logs/cron.log 2>&1" > /etc/cron.d/injurycase
chmod 644 /etc/cron.d/injurycase
systemctl reload php-fpm httpd
echo "Updated."
