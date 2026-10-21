# Database migrations

Schema changes after launch go here as numbered SQL files, applied once each
in filename order by `app/cli/migrate.php` (which `deploy/aws/update.sh` runs):

    2026_11_01_001_add_case_tags.sql

Also apply the same change to `app/schema.sql`, so a brand-new install
starts out current. setup.sh marks every existing file as applied ("baseline")
on a fresh install.
