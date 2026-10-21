<?php
// Applies pending app/migrations/*.sql files in order, once each.
//   php app/cli/migrate.php              apply pending migrations
//   php app/cli/migrate.php --baseline   mark all as applied (fresh install from schema.sql)
if (PHP_SAPI !== 'cli') exit("CLI only\n");
require_once __DIR__ . '/../bootstrap.php';

$pdo = pi_db();
$pdo->exec('CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(190) PRIMARY KEY, applied_at DATETIME NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
$applied = array_flip($pdo->query('SELECT version FROM schema_migrations')->fetchAll(PDO::FETCH_COLUMN));
$files = glob(__DIR__ . '/../migrations/*.sql');
sort($files);
$baseline = in_array('--baseline', $argv, true);
$ran = 0;
foreach ($files as $file) {
    $version = basename($file);
    if (isset($applied[$version])) continue;
    if (!$baseline) {
        echo "Applying $version\n";
        // MySQL commits DDL implicitly, so each file should be written to be
        // safe to stop halfway through (one change per file is simplest).
        foreach (array_filter(array_map('trim', explode(";\n", file_get_contents($file)))) as $stmt) $pdo->exec($stmt);
    }
    $pdo->prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')->execute([$version, now_str()]);
    $ran++;
}
echo $baseline ? "Baselined $ran migration(s).\n" : ($ran ? "Applied $ran migration(s).\n" : "Database is up to date.\n");
