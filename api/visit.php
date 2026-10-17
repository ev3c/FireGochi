<?php
// Avisa a info@firegochi.com cuando alguien abre firegochi.com.
// POST JSON opcional: page, referrer, lang, tz, screen, os, name, playerId.

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
  http_response_code(405);
  echo json_encode(['ok' => false, 'error' => 'method']);
  exit;
}

$in = json_decode(file_get_contents('php://input'), true);
if (!is_array($in)) $in = [];

function one_line($value, $max) {
  $value = preg_replace('/[\x00-\x1F\x7F]/u', ' ', (string) $value);
  $value = trim(preg_replace('/\s+/u', ' ', $value ?? ''));
  return function_exists('mb_substr') ? mb_substr($value, 0, $max) : substr($value, 0, $max);
}

function client_ip() {
  $remote = $_SERVER['REMOTE_ADDR'] ?? '';
  $forwarded = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? '';
  $ip = $remote;
  if ($forwarded !== '') {
    $first = trim(explode(',', $forwarded)[0]);
    if ($first !== '') $ip = $first;
  }
  $ip = preg_replace('/[^0-9a-fA-F:.]/', '', $ip);
  return substr($ip, 0, 45);
}

$ua = one_line($_SERVER['HTTP_USER_AGENT'] ?? '', 400);
if ($ua === '' || preg_match('/bot|crawl|spider|slurp|preview|wget|curl/i', $ua)) {
  echo json_encode(['ok' => true, 'skipped' => 'bot']);
  exit;
}

$ip = client_ip();
$dir = __DIR__ . '/data';
if (!is_dir($dir)) @mkdir($dir, 0755, true);
$rateFile = $dir . '/visits.json';
$fp = @fopen($rateFile, 'c+');
if (!$fp) {
  http_response_code(500);
  echo json_encode(['ok' => false, 'error' => 'storage']);
  exit;
}
flock($fp, LOCK_EX);
$rates = json_decode(stream_get_contents($fp) ?: '', true);
if (!is_array($rates)) $rates = [];
$now = time();
foreach ($rates as $key => $at) {
  if ($now - (int) $at > 3600) unset($rates[$key]);
}
if (isset($rates[$ip]) && $now - (int) $rates[$ip] < 60) {
  flock($fp, LOCK_UN);
  fclose($fp);
  echo json_encode(['ok' => true, 'skipped' => 'rate']);
  exit;
}
$rates[$ip] = $now;
ftruncate($fp, 0);
rewind($fp);
fwrite($fp, json_encode($rates));
fflush($fp);
flock($fp, LOCK_UN);
fclose($fp);

$host = one_line($_SERVER['HTTP_HOST'] ?? '', 80);
$page = one_line($in['page'] ?? '', 300);
$referrer = one_line($in['referrer'] ?? ($_SERVER['HTTP_REFERER'] ?? ''), 300);
$lang = one_line($in['lang'] ?? ($_SERVER['HTTP_ACCEPT_LANGUAGE'] ?? ''), 80);
$tz = one_line($in['tz'] ?? '', 60);
$screen = one_line($in['screen'] ?? '', 40);
$os = one_line($in['os'] ?? '', 40);
$gl = one_line($in['gl'] ?? '', 300);
$name = one_line($in['name'] ?? '', 20);
$playerId = one_line(preg_replace('/[^a-zA-Z0-9-]/', '', (string) ($in['playerId'] ?? '')), 40);
$when = date('Y-m-d H:i:s T');

$body = "Nueva conexión a FireGochi\n\n"
  . "Hora: $when\n"
  . "IP: $ip\n"
  . "Servidor visto: " . one_line($_SERVER['REMOTE_ADDR'] ?? '', 45) . "\n"
  . "Host: $host\n"
  . "Página: $page\n"
  . "Desde: " . ($referrer !== '' ? $referrer : '—') . "\n"
  . "Navegador: $ua\n"
  . "Idioma: $lang\n"
  . "Zona horaria: " . ($tz !== '' ? $tz : '—') . "\n"
  . "Pantalla: " . ($screen !== '' ? $screen : '—') . "\n"
  . "Sistema operativo: " . ($os !== '' ? $os : '—') . "\n"
  . ($gl !== '' ? "WebGL: $gl\n" : '')
  . "Jugador: " . ($name !== '' ? $name : 'sin nombre') . "\n"
  . "Id de partida: " . ($playerId !== '' ? $playerId : '—') . "\n";

$subject = 'FireGochi: conexión ' . date('Y-m-d H:i');
$headers = "From: FireGochi <info@firegochi.com>\r\n"
  . "Reply-To: info@firegochi.com\r\n"
  . "Content-Type: text/plain; charset=UTF-8\r\n"
  . "MIME-Version: 1.0\r\n";
$sent = @mail('info@firegochi.com', $subject, $body, $headers, '-finfo@firegochi.com');

echo json_encode(['ok' => true, 'sent' => (bool) $sent]);
