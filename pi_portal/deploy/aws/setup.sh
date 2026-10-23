#!/usr/bin/env bash
# InjuryCase — one-time server setup on the EC2 instance created by injurycase.yaml
# (Amazon Linux 2023). Run from a checkout of the repository:
#
#   aws ssm start-session --target <InstanceId>      # from your computer
#   sudo -i
#   git clone https://github.com/<you>/<repo>.git /opt/injurycase-src
#   bash /opt/injurycase-src/pi_portal/deploy/aws/setup.sh
#
# Safe to re-run: it never overwrites secrets.php, the encryption key or the
# database once they exist. Code updates afterwards: deploy/aws/update.sh.
set -euo pipefail

[[ $EUID -eq 0 ]] || { echo "Run as root (sudo -i)"; exit 1; }
[[ -f /etc/injurycase.env ]] || { echo "/etc/injurycase.env missing — was this instance created by injurycase.yaml?"; exit 1; }
# shellcheck disable=SC1091
source /etc/injurycase.env
export AWS_DEFAULT_REGION="$AWS_REGION"

SRC="$(cd "$(dirname "$0")/../.." && pwd)"      # .../pi_portal
APP=/var/www/injurycase
RDS_CA=/etc/pki/tls/certs/rds-global-bundle.pem
say() { printf '\n\033[1;34m== %s\033[0m\n' "$*"; }

say "Installing Apache, PHP 8.3, MySQL client"
dnf -y install httpd mod_ssl php8.3 php8.3-fpm php8.3-cli php8.3-mysqlnd php8.3-pdo php8.3-sodium php8.3-mbstring php8.3-xml php8.3-gd \
  mariadb105 jq rsync cronie dnf-automatic poppler-utils unzip
if ! command -v certbot >/dev/null; then
  dnf -y install certbot python3-certbot-apache 2>/dev/null || {
    python3 -m venv /opt/certbot && /opt/certbot/bin/pip install -q certbot certbot-apache && ln -sf /opt/certbot/bin/certbot /usr/bin/certbot
  }
fi
php -m | grep -qi sodium || { echo "PHP sodium extension missing"; exit 1; }

say "Automatic security updates"
sed -i 's/^upgrade_type.*/upgrade_type = security/; s/^apply_updates.*/apply_updates = yes/' /etc/dnf/automatic.conf
systemctl enable --now dnf-automatic.timer crond

say "Copying application to $APP"
mkdir -p "$APP"
rsync -a --delete --exclude 'app/secrets.php' --exclude 'storage/' "$SRC/" "$APP/"
mkdir -p "$APP/storage/documents" "$APP/storage/logs"
chown -R root:apache "$APP"
chown -R apache:apache "$APP/storage"
chmod 700 "$APP/storage" "$APP/storage/documents" "$APP/storage/logs"
find "$APP" -path "$APP/storage" -prune -o -type f -exec chmod 640 {} +
find "$APP" -path "$APP/storage" -prune -o -type d -exec chmod 750 {} +

say "RDS certificate bundle (TLS to the database)"
curl -fsSL https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem -o "$RDS_CA"

DB_JSON=$(aws secretsmanager get-secret-value --secret-id "$DB_SECRET_ARN" --query SecretString --output text)
DB_HOST=$(jq -r .host <<<"$DB_JSON"); DB_USER=$(jq -r .username <<<"$DB_JSON"); DB_PASS=$(jq -r .password <<<"$DB_JSON")
[[ "$DB_HOST" != "null" ]] || { echo "Database secret has no host yet — wait for the stack to finish and retry."; exit 1; }

say "Encryption key"
APP_KEY=$(aws secretsmanager get-secret-value --secret-id "$APP_KEY_SECRET_ARN" --query SecretString --output text)
if [[ "$APP_KEY" == "unset" ]]; then
  APP_KEY=$(php -r 'echo base64_encode(random_bytes(32));')
  aws secretsmanager put-secret-value --secret-id "$APP_KEY_SECRET_ARN" --secret-string "$APP_KEY" >/dev/null
  echo "Generated a new key and stored it in Secrets Manager."
  echo ">>> Also store an OFFLINE copy now (password manager / safe):"
  echo ">>>   aws secretsmanager get-secret-value --secret-id $APP_KEY_SECRET_ARN --query SecretString --output text"
fi

if [[ ! -f "$APP/app/secrets.php" ]]; then
  say "Writing app/secrets.php"
  cat > "$APP/app/secrets.php" <<EOF
<?php
// Written by deploy/aws/setup.sh. Values come from AWS Secrets Manager.
define('PI_DB_HOST', '$DB_HOST');
define('PI_DB_NAME', 'injurycase');
define('PI_DB_USER', '$DB_USER');
define('PI_DB_PASSWORD', '$DB_PASS');
define('PI_DB_SSL_CA', '$RDS_CA');
define('PI_ENCRYPTION_KEY', '$APP_KEY');
define('APP_URL', 'https://$DOMAIN');
define('SUPPORT_EMAIL', '$ADMIN_EMAIL');
// Stripe — fill in when ready (see README), then: systemctl reload php-fpm
// define('STRIPE_SECRET_KEY', 'sk_live_...');
// define('STRIPE_WEBHOOK_SECRET', 'whsec_...');
// define('STRIPE_PRICES', [
//   'solo' => ['monthly' => 'price_...', 'annual' => 'price_...'],
//   'practice' => ['monthly' => 'price_...', 'annual' => 'price_...'],
//   'group' => ['monthly' => 'price_...', 'annual' => 'price_...'],
// ]);
// Email (trial reminders) — Amazon SES SMTP credentials (see README)
// define('SMTP_HOST', 'email-smtp.us-east-1.amazonaws.com');
// define('SMTP_PORT', 587);
// define('SMTP_USER', '...');
// define('SMTP_PASS', '...');
// define('MAIL_FROM', 'hello@$DOMAIN');
EOF
fi
chown root:apache "$APP/app/secrets.php"; chmod 640 "$APP/app/secrets.php"

say "Daily jobs"
# Trial reminder emails (sends nothing until email is configured).
# Times are the practice's (US Eastern): daily digest 6:38am, trial reminders 9:17am.
printf '%s\n' "CRON_TZ=America/New_York" \
  "38 6 * * * apache php $APP/app/cli/daily_digest.php >> $APP/storage/logs/cron.log 2>&1" \
  "52 7 * * * apache php $APP/app/cli/task_reminders.php >> $APP/storage/logs/cron.log 2>&1" \
  "23 9 * * 1-5 apache php $APP/app/cli/status_requests.php >> $APP/storage/logs/cron.log 2>&1" \
  "17 9 * * * apache php $APP/app/cli/trial_reminders.php >> $APP/storage/logs/cron.log 2>&1" > /etc/cron.d/injurycase
chmod 644 /etc/cron.d/injurycase

say "Database schema"
MYSQL=(mysql --ssl-ca="$RDS_CA" --ssl-verify-server-cert -h "$DB_HOST" -u "$DB_USER" "-p$DB_PASS" injurycase)
TABLES=$("${MYSQL[@]}" -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='injurycase'")
if [[ "$TABLES" == "0" ]]; then
  "${MYSQL[@]}" < "$APP/app/schema.sql"
  sudo -u apache php "$APP/app/cli/migrate.php" --baseline
  echo "Schema imported."
else
  echo "Schema already present ($TABLES tables) — left as is."
fi

say "PHP settings"
cat > /etc/php.d/90-injurycase.ini <<'EOF'
expose_php = Off
display_errors = Off
log_errors = On
upload_max_filesize = 25M
post_max_size = 30M
memory_limit = 256M
max_execution_time = 60
session.use_strict_mode = 1
session.cookie_httponly = 1
session.cookie_secure = 1
date.timezone = America/New_York
EOF

say "Apache virtual host"
cat > /etc/httpd/conf.d/injurycase.conf <<EOF
ServerTokens Prod
ServerSignature Off
TraceEnable Off
<VirtualHost *:80>
  ServerName $DOMAIN
  ServerAlias www.$DOMAIN
  DocumentRoot $APP/public
  # Nothing outside public/ is ever served.
  <Directory $APP>
    Require all denied
  </Directory>
  <Directory $APP/public>
    AllowOverride All
    Options -Indexes
    Require all granted
  </Directory>
</VirtualHost>
EOF
rm -f /etc/httpd/conf.d/welcome.conf
systemctl enable --now php-fpm httpd
systemctl reload php-fpm httpd

say "HTTPS certificate (Let's Encrypt)"
# Both the bare domain and www; falls back to the bare domain alone if
# www's DNS record isn't in place yet.
if certbot --apache -d "$DOMAIN" -d "www.$DOMAIN" -m "$ADMIN_EMAIL" --agree-tos -n --redirect \
   || certbot --apache -d "$DOMAIN" -m "$ADMIN_EMAIL" --agree-tos -n --redirect; then
  systemctl enable --now certbot-renew.timer 2>/dev/null || echo "0 3 * * * root certbot renew -q" > /etc/cron.d/certbot
else
  echo "Certificate not issued yet. Point the DNS A records for $DOMAIN and www.$DOMAIN at this server's Elastic IP, wait a few minutes, then re-run this script."
fi

say "Done"
cat <<EOF
Next steps:
  1. Store the encryption key offline (command above, if a new key was generated).
  2. Create your operator login:
       sudo -u apache php $APP/app/cli/create_operator.php you@example.com "Your Name"
  3. Create your own clinic (comped) and note its practice id:
       sudo -u apache php $APP/app/cli/create_practice.php "Your Clinic" doc@clinic.com "Dr. Name" --comped
  4. Import your spreadsheets (copy the CSVs up first):
       sudo -u apache php $APP/app/cli/import_sheets.php --practice=1 --ar=ar.csv --tracking=tracking.csv --dry-run
  5. Visit https://$DOMAIN
EOF
