// Servidor estático mínimo, sin dependencias: node server.mjs
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 5173);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

// Imitación local de api/record.php (en Hostinger lo sirve PHP).
const recordFile = path.join(root, 'api/data/record.json');
function recordApi(req, res) {
  const send = (code, body) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };
  if (req.method === 'OPTIONS') return send(204);
  let record = null;
  try { record = JSON.parse(fs.readFileSync(recordFile, 'utf8')); } catch {}
  if (req.method !== 'POST') return send(200, { record });
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    let inp;
    try { inp = JSON.parse(raw); } catch { return send(400, { error: 'invalid', record }); }
    const seconds = Number(inp.seconds);
    const id = String(inp.id || '').slice(0, 40).replace(/[^a-zA-Z0-9-]/g, '');
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 1e11 || !id) return send(400, { error: 'invalid', record });
    const name = String(inp.name || '').replace(/[\x00-\x1F\x7F<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 20) || null;
    let changed = false;
    if (!record || seconds > record.seconds) {
      record = { name, seconds: Math.round(seconds * 10) / 10, id, at: Math.floor(Date.now() / 1000) };
      changed = true;
    } else if (record.id === id && name && name !== record.name) {
      record.name = name;
      changed = true;
    }
    if (changed) {
      fs.mkdirSync(path.dirname(recordFile), { recursive: true });
      fs.writeFileSync(recordFile, JSON.stringify(record));
    }
    send(200, { record });
  });
}

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (url === '/api/record.php') return recordApi(req, res);
  if (url.startsWith('/api/data/')) {
    res.writeHead(403);
    return res.end();
  }
  let file = path.normalize(path.join(root, url === '/' ? 'index.html' : url));
  if (!file.startsWith(root)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('No encontrado');
    }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

server.listen(port, '0.0.0.0', () => {
  const url = `http://localhost:${port}/`;
  console.log(`La chimenea está lista en ${url}  (Ctrl+C para cerrar)`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      const v4 = net.family === 'IPv4' || net.family === 4;
      if (v4 && !net.internal) console.log(`Desde el iPhone o el Mac, en la misma Wi-Fi: http://${net.address}:${port}/`);
    }
  }
  if (!process.argv.includes('--no-open')) {
    const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open ${url}` : `xdg-open ${url}`;
    exec(cmd);
  }
});
