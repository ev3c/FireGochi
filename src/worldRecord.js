// Récord mundial: el mayor tiempo con la chimenea encendida de todos los jugadores (api/record.php).

// Dirección de la web en Hostinger, para que la copia de GitHub Pages lea y guarde ahí el récord.
// Ejemplo: 'https://firegochi.com/'. Vacío = solo funciona en la propia web de Hostinger.
const HOSTINGER_URL = 'https://www.firegochi.com/';

const PLAYER_KEY = 'firegochi-player';
const REFRESH_MS = 2 * 60 * 1000;
const SEND_EVERY_MS = 30 * 1000;
const MIN_SECONDS = 5 * 60;

function apiUrl() {
  if (location.hostname.endsWith('github.io')) return HOSTINGER_URL ? new URL('api/record.php', HOSTINGER_URL).href : null;
  return new URL('api/record.php', location.href).href;
}

function loadPlayer() {
  try {
    const p = JSON.parse(localStorage.getItem(PLAYER_KEY) || 'null');
    if (p && p.id) return p;
  } catch {}
  const id = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
  const p = { id, name: '' };
  localStorage.setItem(PLAYER_KEY, JSON.stringify(p));
  return p;
}

export class WorldRecord {
  constructor() {
    this.url = apiUrl();
    this.player = loadPlayer();
    this.record = null;
    this.online = false;
    this.lastFetch = 0;
    this.lastSent = 0;
    this.sentSeconds = 0;
    this.busy = false;
  }

  get enabled() { return !!this.url; }
  get mine() { return !!this.record && this.record.id === this.player.id; }
  get seconds() { return this.record ? Number(this.record.seconds) || 0 : 0; }

  setName(name) {
    this.player.name = String(name || '').replace(/[\x00-\x1F\x7F<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 20);
    localStorage.setItem(PLAYER_KEY, JSON.stringify(this.player));
  }

  async request(body) {
    if (!this.url || this.busy) return;
    this.busy = true;
    try {
      const res = await fetch(this.url, body
        ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' }
        : { cache: 'no-store' });
      const data = await res.json();
      if ('record' in data) this.record = data.record;
      this.online = res.ok || res.status === 400;
    } catch {
      this.online = false;
    } finally {
      this.busy = false;
      this.lastFetch = Date.now();
    }
  }

  // Devuelve true si el jugador acaba de superar el récord mundial y aún no tiene nombre.
  update(bestStreak) {
    if (!this.url) return false;
    const now = Date.now();
    if (!this.lastFetch || now - this.lastFetch > REFRESH_MS) {
      this.request();
      return false;
    }
    if (!this.online || bestStreak < MIN_SECONDS || bestStreak <= this.seconds + 1) return false;
    if (!this.player.name && !this.mine && !this.anonymous) return true;
    if (now - this.lastSent > SEND_EVERY_MS || !this.mine) this.send(bestStreak);
    return false;
  }

  send(bestStreak) {
    this.lastSent = Date.now();
    this.sentSeconds = bestStreak;
    return this.request({ id: this.player.id, name: this.player.name, seconds: bestStreak });
  }
}
