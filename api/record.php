<?php
// Récord mundial de FireGochi: el mayor tiempo con la chimenea encendida.
// GET  -> {"record": {"name", "seconds", "id", "at"} | null}
// POST {"id", "name", "seconds"} -> guarda si supera al actual y devuelve el récord vigente.

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Cache-Control: no-store');

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method === 'OPTIONS') {
  http_response_code(204);
  exit;
}

const MAX_SECONDS = 1e11;
const MAX_NAME = 20;

$dir = __DIR__ . '/data';
$file = $dir . '/record.json';
if (!is_dir($dir)) @mkdir($dir, 0755, true);

function clean_name($name) {
  $name = preg_replace('/[\x00-\x1F\x7F<>]/u', '', (string) $name);
  if ($name === null) return null;
  $name = trim(preg_replace('/\s+/u', ' ', $name));
  $name = function_exists('mb_substr') ? mb_substr($name, 0, MAX_NAME) : substr($name, 0, MAX_NAME);
  return $name === '' ? null : $name;
}

$fp = @fopen($file, 'c+');
if (!$fp) {
  http_response_code(500);
  echo json_encode(['error' => 'storage']);
  exit;
}
flock($fp, $method === 'POST' ? LOCK_EX : LOCK_SH);
$raw = stream_get_contents($fp);
$record = $raw ? json_decode($raw, true) : null;

if ($method === 'POST') {
  $in = json_decode(file_get_contents('php://input'), true);
  $seconds = is_array($in) && isset($in['seconds']) ? (float) $in['seconds'] : 0;
  $id = is_array($in) && isset($in['id']) ? preg_replace('/[^a-zA-Z0-9-]/', '', substr((string) $in['id'], 0, 40)) : '';
  if (!is_finite($seconds) || $seconds <= 0 || $seconds > MAX_SECONDS || $id === '') {
    flock($fp, LOCK_UN);
    fclose($fp);
    http_response_code(400);
    echo json_encode(['error' => 'invalid', 'record' => $record]);
    exit;
  }
  $name = clean_name($in['name'] ?? '');
  if (!$record || $seconds > (float) $record['seconds']) {
    $record = ['name' => $name, 'seconds' => round($seconds, 1), 'id' => $id, 'at' => time()];
    ftruncate($fp, 0);
    rewind($fp);
    fwrite($fp, json_encode($record, JSON_UNESCAPED_UNICODE));
    fflush($fp);
  } elseif ($record['id'] === $id && $name !== null && $name !== $record['name']) {
    // El mismo jugador puede ponerse nombre después de batir el récord.
    $record['name'] = $name;
    ftruncate($fp, 0);
    rewind($fp);
    fwrite($fp, json_encode($record, JSON_UNESCAPED_UNICODE));
    fflush($fp);
  }
}

flock($fp, LOCK_UN);
fclose($fp);
echo json_encode(['record' => $record], JSON_UNESCAPED_UNICODE);
