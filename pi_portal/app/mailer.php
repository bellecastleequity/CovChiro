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

function send_mail(string $to, string $subject, string $text): bool {
    if (!mail_configured() || !filter_var($to, FILTER_VALIDATE_EMAIL)) return false;
    $secure = defined('SMTP_SECURE') ? SMTP_SECURE : 'tls';
    $port = defined('SMTP_PORT') ? (int)SMTP_PORT : ($secure === 'ssl' ? 465 : 587);
    $ctx = stream_context_create(['ssl' => ['verify_peer' => true, 'verify_peer_name' => true, 'peer_name' => SMTP_HOST]]);
    $fp = @stream_socket_client(($secure === 'ssl' ? 'ssl://' : 'tcp://') . SMTP_HOST . ':' . $port, $errno, $err, 15, STREAM_CLIENT_CONNECT, $ctx);
    if (!$fp) { pi_log_error("SMTP connect failed: $err"); return false; }
    stream_set_timeout($fp, 15);
    $read = function () use ($fp): string {
        $out = '';
        while (($line = fgets($fp, 1024)) !== false) { $out .= $line; if (strlen($line) < 4 || $line[3] === ' ') break; }
        return $out;
    };
    $cmd = function (string $line, array $ok) use ($fp, $read): string {
        if ($line !== '') fwrite($fp, $line . "\r\n");
        $r = $read();
        if (!in_array((int)substr($r, 0, 3), $ok, true)) throw new RuntimeException('SMTP: ' . (in_array(strtok($line, ' :'), ['EHLO', 'STARTTLS', 'AUTH', 'MAIL', 'RCPT', 'DATA', 'QUIT'], true) ? strtok($line, ' :') : ($line === '' ? 'connect' : '(message or credentials)')) . ' -> ' . trim($r));
        return $r;
    };
    try {
        $cmd('', [220]);
        $host = parse_url(defined('APP_URL') ? APP_URL : 'http://localhost', PHP_URL_HOST) ?: 'localhost';
        $cmd("EHLO $host", [250]);
        if ($secure === 'tls') {
            $cmd('STARTTLS', [220]);
            if (!stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT | STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT)) throw new RuntimeException('SMTP: TLS failed');
            $cmd("EHLO $host", [250]);
        }
        if (defined('SMTP_USER') && SMTP_USER !== '') {
            $cmd('AUTH LOGIN', [334]);
            $cmd(base64_encode(SMTP_USER), [334]);
            $cmd(base64_encode(SMTP_PASS), [235]);
        }
        $from = MAIL_FROM;
        $cmd('MAIL FROM:<' . $from . '>', [250]);
        $cmd('RCPT TO:<' . $to . '>', [250, 251]);
        $cmd('DATA', [354]);
        $name = defined('BRAND_NAME') ? BRAND_NAME : 'InjuryCase';
        $headers = [
            'From: ' . $name . ' <' . $from . '>', 'To: <' . $to . '>',
            'Subject: =?UTF-8?B?' . base64_encode($subject) . '?=',
            'Date: ' . date('r'), 'Message-ID: <' . bin2hex(random_bytes(12)) . '@' . $host . '>',
            'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: 8bit',
        ];
        if (defined('SUPPORT_EMAIL')) $headers[] = 'Reply-To: <' . SUPPORT_EMAIL . '>';
        $body = preg_replace('/^\./m', '..', str_replace(["\r\n", "\r"], "\n", $text));
        $cmd(implode("\r\n", $headers) . "\r\n\r\n" . str_replace("\n", "\r\n", $body) . "\r\n.", [250]);
        $cmd('QUIT', [221, 250]);
        fclose($fp);
        return true;
    } catch (RuntimeException $e) {
        pi_log_error($e->getMessage());
        @fclose($fp);
        return false;
    }
}
