<?php
// Outgoing email over SMTP (e.g. Amazon SES's SMTP interface). Used only
// for account emails — trial reminders and the like — never for patient
// information. Configure in secrets.php:
//   SMTP_HOST, SMTP_PORT (587), SMTP_USER, SMTP_PASS, MAIL_FROM,
//   SMTP_SECURE: 'tls' (STARTTLS, default), 'ssl' (port 465), or 'none'
//   (local testing only).
// Without SMTP_HOST, mail is not sent and send_mail() returns false.

function mail_configured(): bool {
    return defined('SMTP_HOST') && SMTP_HOST !== '' && defined('MAIL_FROM') && MAIL_FROM !== '';
}

// $fromName: the sender name (a white-labelled practice's brand); defaults to InjuryCase.
function send_mail(string $to, string $subject, string $text, ?string $fromName = null): bool {
    if (!mail_configured() || !filter_var($to, FILTER_VALIDATE_EMAIL)) return false;
    $cfg = ['host' => SMTP_HOST, 'port' => defined('SMTP_PORT') ? (int)SMTP_PORT : null, 'secure' => defined('SMTP_SECURE') ? SMTP_SECURE : 'tls',
        'user' => defined('SMTP_USER') ? SMTP_USER : '', 'pass' => defined('SMTP_PASS') ? SMTP_PASS : '', 'from' => MAIL_FROM];
    $name = '=?UTF-8?B?' . base64_encode($fromName ?? (defined('BRAND_NAME') ? BRAND_NAME : 'InjuryCase')) . '?=';
    $headers = ['From: ' . $name . ' <' . MAIL_FROM . '>', 'To: <' . $to . '>', 'Subject: =?UTF-8?B?' . base64_encode($subject) . '?=',
        'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: 8bit'];
    if (defined('SUPPORT_EMAIL')) $headers[] = 'Reply-To: <' . SUPPORT_EMAIL . '>';
    return smtp_deliver($cfg, $to, $headers, $text)['ok'];
}

// An HTML email with a plain-text alternative and any extra headers (e.g.
// List-Unsubscribe), through the SMTP account in $cfg (see smtp_deliver).
// $opts: from, from_name, reply_to, headers[]. Returns ['ok', 'error',
// 'permanent'] — permanent when the server refused the address (5xx).
function send_mail_html(array $cfg, string $to, string $subject, string $text, string $html, array $opts = []): array {
    if (!filter_var($to, FILTER_VALIDATE_EMAIL)) return ['ok' => false, 'error' => 'invalid address', 'permanent' => true];
    $b = 'b' . bin2hex(random_bytes(8));
    $from = $opts['from'] ?? $cfg['from'];
    $fromName = '=?UTF-8?B?' . base64_encode($opts['from_name'] ?? 'InjuryCase') . '?=';
    $headers = array_merge(['From: ' . $fromName . ' <' . $from . '>', 'To: <' . $to . '>', 'Subject: =?UTF-8?B?' . base64_encode($subject) . '?=',
        'MIME-Version: 1.0', 'Content-Type: multipart/alternative; boundary="' . $b . '"'],
        !empty($opts['reply_to']) ? ['Reply-To: <' . $opts['reply_to'] . '>'] : [], $opts['headers'] ?? []);
    $part = fn($type, $body) => "--$b\nContent-Type: $type; charset=UTF-8\nContent-Transfer-Encoding: base64\n\n" . rtrim(chunk_split(base64_encode($body), 76, "\n")) . "\n";
    $body = $part('text/plain', $text) . $part('text/html', $html) . "--$b--\n";
    return smtp_deliver($cfg + ['from' => $from], $to, $headers, $body);
}

// One message over SMTP. $cfg: host, port, secure (tls|ssl|none), user,
// pass, from (envelope sender). $headers without Date / Message-ID.
function smtp_deliver(array $cfg, string $to, array $headers, string $text): array {
    $secure = $cfg['secure'] ?? 'tls';
    $port = $cfg['port'] ?: ($secure === 'ssl' ? 465 : 587);
    $ctx = stream_context_create(['ssl' => ['verify_peer' => true, 'verify_peer_name' => true, 'peer_name' => $cfg['host']]]);
    $fp = @stream_socket_client(($secure === 'ssl' ? 'ssl://' : 'tcp://') . $cfg['host'] . ':' . $port, $errno, $err, 15, STREAM_CLIENT_CONNECT, $ctx);
    if (!$fp) { pi_log_error("SMTP connect failed: $err"); return ['ok' => false, 'error' => 'connect failed', 'permanent' => false]; }
    stream_set_timeout($fp, 15);
    $read = function () use ($fp): string {
        $out = '';
        while (($line = fgets($fp, 1024)) !== false) { $out .= $line; if (strlen($line) < 4 || $line[3] === ' ') break; }
        return $out;
    };
    $last = '';
    $cmd = function (string $line, array $ok) use ($fp, $read, &$last): string {
        if ($line !== '') fwrite($fp, $line . "\r\n");
        $r = $read();
        $last = $r;
        if (!in_array((int)substr($r, 0, 3), $ok, true)) throw new RuntimeException('SMTP: ' . (in_array(strtok($line, ' :'), ['EHLO', 'STARTTLS', 'AUTH', 'MAIL', 'RCPT', 'DATA', 'QUIT'], true) ? strtok($line, ' :') : ($line === '' ? 'connect' : '(message or credentials)')) . ' -> ' . trim($r));
        return $r;
    };
    $stage = 'connect';
    try {
        $cmd('', [220]);
        $host = parse_url(defined('APP_URL') ? APP_URL : 'http://localhost', PHP_URL_HOST) ?: 'localhost';
        $cmd("EHLO $host", [250]);
        if ($secure === 'tls') {
            $cmd('STARTTLS', [220]);
            if (!stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT | STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT)) throw new RuntimeException('SMTP: TLS failed');
            $cmd("EHLO $host", [250]);
        }
        if (($cfg['user'] ?? '') !== '') {
            $cmd('AUTH LOGIN', [334]);
            $cmd(base64_encode($cfg['user']), [334]);
            $cmd(base64_encode($cfg['pass']), [235]);
        }
        $cmd('MAIL FROM:<' . $cfg['from'] . '>', [250]);
        $stage = 'rcpt';
        $cmd('RCPT TO:<' . $to . '>', [250, 251]);
        $stage = 'data';
        $cmd('DATA', [354]);
        $domain = substr(strrchr($cfg['from'], '@') ?: '@' . $host, 1);
        $headers = array_merge($headers, ['Date: ' . date('r'), 'Message-ID: <' . bin2hex(random_bytes(12)) . '@' . $domain . '>']);
        $body = preg_replace('/^\./m', '..', str_replace(["\r\n", "\r"], "\n", $text));
        $cmd(implode("\r\n", $headers) . "\r\n\r\n" . str_replace("\n", "\r\n", $body) . "\r\n.", [250]);
        $cmd('QUIT', [221, 250]);
        fclose($fp);
        return ['ok' => true, 'error' => null, 'permanent' => false];
    } catch (RuntimeException $e) {
        pi_log_error($e->getMessage());
        @fclose($fp);
        $code = (int)substr($last, 0, 3);
        return ['ok' => false, 'error' => mb_substr($e->getMessage(), 0, 250), 'permanent' => $stage === 'rcpt' && $code >= 500];
    }
}
