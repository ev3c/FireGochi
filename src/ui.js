import { FUELS, FUEL_ORDER, WET_LIMIT } from './sim/fuels.js';
import { ACHIEVEMENTS, MATCH_BOX, BODY, bodyState } from './game.js';
import { t, setLang, getLang, onLang, fuelName, fuelShort, fuelDesc } from './i18n.js';

const HEAT_RISK = ['hot', 'veryhot', 'heatstroke'];
const SPEEDS = [1, 8, 16, 32, 64, 128, 256, 512, 1024];

const TOOLS = [
  { id: 'hand', icon: '✋', key: '1' },
  { id: 'match', icon: '🔥', key: '2' },
  { id: 'poker', icon: '🪝', key: '3' },
  { id: 'bellows', icon: '💨', key: '4' },
  { id: 'water', icon: '🪣', key: '5' },
];

function fmtDuration(s) {
  s = Math.max(0, Math.floor(s));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d) return `${d} d ${h} h`;
  if (h) return `${h} h ${m} min`;
  if (m) return `${m} min`;
  return `${s} s`;
}

export class UI {
  constructor() {
    this.$ = (id) => document.getElementById(id);
    this.tipEl = this.$('tip');
    this.toastsEl = this.$('toasts');
    this.modal = this.$('modal');
    this.modalBody = this.$('modal-body');
    this.$('modal-close').onclick = () => this.closeModal();
    this.modal.addEventListener('pointerdown', (e) => { if (e.target === this.modal) this.closeModal(); });
    this.lastStatus = '';
    this.view = null;
    this.$('lang-switch').addEventListener('click', (e) => {
      const b = e.target.closest('[data-lang]');
      if (b) setLang(b.dataset.lang);
    });
    onLang(() => this.onLanguage());
    this.$('spd-down').onclick = () => this.stepSpeed(-1);
    this.$('spd-up').onclick = () => this.stepSpeed(1);
    this.applyChrome();
  }

  stepSpeed(dir) {
    const st = this.game?.state;
    if (!st) return;
    const i = SPEEDS.indexOf(st.speed);
    const cur = i >= 0 ? i : SPEEDS.findIndex((s) => s >= st.speed);
    st.speed = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, cur + dir))];
    this.refresh();
    if (this.view === 'settings') this.openSettings();
  }

  applyChrome() {
    document.documentElement.lang = getLang() === 'en' ? 'en' : 'es';
    document.title = t('appTitle');
    for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
    for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
    for (const b of document.querySelectorAll('.lang-btn')) b.classList.toggle('on', b.dataset.lang === getLang());
  }

  onLanguage() {
    this.applyChrome();
    if (!this.game) return;
    this.refreshToolLabels();
    this.refreshInventory();
    this.lastStatus = '';
    this.refresh();
    if (this.view) this.reopen();
  }

  reopen() {
    const view = this.view;
    if (view === 'shop') this.openShop();
    else if (view === 'ach') this.openAchievements();
    else if (view === 'help') this.openHelp();
    else if (view === 'settings') this.openSettings();
    else if (view === 'offline') this.showOffline(this.offlineReport);
    else if (view === 'gameover') this.showGameOver();
  }

  refreshToolLabels() {
    for (const tool of TOOLS) {
      const b = document.querySelector(`[data-tool="${tool.id}"]`);
      if (!b) continue;
      b.querySelector('.nm').textContent = t(`tool.${tool.id}.name`);
      b.title = `${t(`tool.${tool.id}.name`)} (${tool.key}) — ${t(`tool.${tool.id}.tip`)}`;
    }
    if (this.ix) this.setActiveTool(this.ix.tool, this.ix.placeKey);
  }

  bind(game, interaction) {
    this.game = game;
    this.ix = interaction;
    const tools = this.$('tools');
    tools.innerHTML = '';
    for (const tool of TOOLS) {
      const b = document.createElement('button');
      b.className = 'slot tool';
      b.dataset.tool = tool.id;
      b.title = `${t(`tool.${tool.id}.name`)} (${tool.key}) — ${t(`tool.${tool.id}.tip`)}`;
      b.innerHTML = `<span class="ic">${tool.icon}</span><span class="nm">${t(`tool.${tool.id}.name`)}</span><span class="ct" id="ct-${tool.id}"></span>`;
      if (tool.id === 'bellows') {
        b.addEventListener('pointerdown', () => { this.ix.audio.start(); this.ix.bellowsHeld = true; });
        b.addEventListener('pointerup', () => { this.ix.bellowsHeld = false; });
        b.addEventListener('pointerleave', () => { this.ix.bellowsHeld = false; });
      }
      b.onclick = () => { this.ix.audio.start(); this.ix.setTool(this.ix.tool === tool.id && tool.id !== 'hand' ? 'hand' : tool.id); };
      tools.appendChild(b);
    }
    this.$('btn-shop').onclick = () => this.openShop();
    this.$('btn-garden').onclick = () => this.gather();
    this.$('btn-ach').onclick = () => this.openAchievements();
    this.$('btn-help').onclick = () => this.openHelp();
    this.$('btn-settings').onclick = () => this.openSettings();
    this.$('btn-sound').onclick = () => {
      game.state.sound = !game.state.sound;
      this.ix.audio.setEnabled(game.state.sound);
      this.refresh();
    };
    this.refreshInventory();
    this.refresh();
  }

  refreshInventory() {
    const inv = this.game.state.inventory;
    const box = this.$('inventory');
    box.innerHTML = '';
    for (const id of FUEL_ORDER) {
      for (const wet of [false, true]) {
        const key = wet ? `${id}:wet` : id;
        const n = inv[key] || 0;
        if (wet && !n) continue;
        const F = FUELS[id];
        const b = document.createElement('button');
        b.className = 'slot fuel' + (n ? '' : ' empty') + (wet ? ' wet' : '');
        b.dataset.key = key;
        b.title = `${fuelName(id)}${wet ? t('wetParen') : ''} — ${fuelDesc(id)}${wet ? t('wetNote') : ''}`;
        b.innerHTML = `<span class="ic sp-${F.species || id}">${F.icon}</span><span class="nm">${fuelShort(id)}${wet ? ' 💧' : ''}</span><span class="ct">${n}</span>`;
        b.onclick = () => {
          this.ix.audio.start();
          if (!n) { this.openShop(); return; }
          this.ix.setTool('place', key);
        };
        box.appendChild(b);
      }
    }
    this.setActiveTool(this.ix.tool, this.ix.placeKey);
    this.$('ct-match').textContent = this.game.state.matches;
  }

  setActiveTool(tool, key) {
    document.querySelectorAll('.slot').forEach((el) => {
      el.classList.toggle('active', (el.dataset.tool && el.dataset.tool === tool) || (tool === 'place' && el.dataset.key === key));
    });
    const hint = this.$('hint');
    if (tool === 'place') {
      const id = key.split(':')[0];
      hint.textContent = t('hint.place', { name: fuelShort(id).toLowerCase() });
    } else {
      hint.textContent = t(`tool.${tool || 'hand'}.tip`);
    }
  }

  statusText() {
    const g = this.game;
    const lv = g.level.id;
    const steaming = g.sim.items.some((i) => i.steam > 0.05 && i.moisture > WET_LIMIT);
    const rem = g.remainingMinutes();
    const body = bodyState(g.state.room).id;
    if (HEAT_RISK.includes(body)) return t(`body.${body}.risk`, { temp: g.state.room.toFixed(1) });
    if (this.ix.match) return t('status.match');
    switch (lv) {
      case 'out':
        if (g.entries.size === 0) return t('status.outEmpty');
        return t('status.out');
      case 'smoking':
        return steaming ? t('status.smokingWet') : t('status.smoking');
      case 'choked':
        return t('status.choked');
      case 'embers':
        return t('status.embers');
      case 'weak':
        if (steaming) return t('status.weakWet');
        return rem < 4 ? t('status.weakSoon') : t('status.weak');
      default:
        if (steaming) return t('status.steam');
        if (rem < 6) return t('status.rem', { n: Math.max(1, Math.round(rem)) });
        if (g.state.room < 17) return t('status.coldRoom', { temp: g.state.room.toFixed(1) });
        if (lv === 'roaring') return t('status.roaring');
        return t('status.good');
    }
  }

  refresh() {
    const g = this.game;
    if (!g) return;
    const st = g.state;
    const lv = g.level.id;
    const body = bodyState(st.room);
    this.$('mood').textContent = body.face;
    this.$('mood').title = `${t(`body.${body.id}.name`)} (${st.room.toFixed(1)} °C)${HEAT_RISK.includes(body.id) ? ` — ${t(`body.${body.id}.risk`, { temp: st.room.toFixed(1) })}` : ''}`;
    this.$('mood').classList.toggle('danger', HEAT_RISK.includes(body.id));
    this.warnBody(body);
    this.$('level').textContent = t(`mood.${lv}`);
    this.$('bar-fire').style.width = `${Math.min(100, (g.sim.power / 5) * 100)}%`;
    this.$('bar-air').style.width = `${Math.round(g.sim.o2 * 100)}%`;
    this.$('bar-air').classList.toggle('bad', g.sim.o2 < 0.6);
    this.$('room').textContent = `${st.room.toFixed(1)} °C`;
    const w = g.weatherInfo();
    this.$('outside').textContent = `${g.outsideTemp().toFixed(0)} °C ${w ? w.icon : ''}`;
    this.$('outside').title = w ? t(`weather.${st.weather.id}.name`) : t('weather.calmName');
    this.$('alive').textContent = g.isAlive() ? fmtDuration(st.stats.aliveFor) : '—';
    this.$('best').textContent = fmtDuration(st.stats.bestStreak);
    this.$('points').textContent = Math.floor(st.points);
    this.$('ct-match').textContent = st.matches;
    const status = this.statusText();
    if (status !== this.lastStatus) {
      this.lastStatus = status;
      this.$('status').textContent = status;
    }
    const gs = g.gardenStatus();
    this.$('btn-garden').textContent = gs > 0 ? `🌲 ${Math.ceil(gs / 60000)} min` : t('nav.garden');
    this.$('btn-garden').classList.toggle('ready', gs <= 0);
    this.$('btn-sound').textContent = st.sound ? '🔊' : '🔇';
    this.$('spd-val').textContent = `x${st.speed}`;
    this.$('spd-down').disabled = st.speed <= SPEEDS[0];
    this.$('spd-up').disabled = st.speed >= SPEEDS[SPEEDS.length - 1];
    document.body.style.setProperty('--haze', String(Math.min(0.55, g.roomSmoke)));
  }

  warnBody(body) {
    const rank = BODY.length - BODY.indexOf(body);
    const prev = this.bodyRank ?? rank;
    this.bodyRank = rank;
    if (this.game.state.dead) {
      if (this.view !== 'gameover') this.showGameOver();
      return;
    }
    if (rank > prev && HEAT_RISK.includes(body.id)) {
      this.toast(t(`body.${body.id}.risk`, { temp: this.game.state.room.toFixed(1) }), body.face);
    }
  }

  showGameOver() {
    this.view = 'gameover';
    const st = this.game.state;
    this.openModal(t('over.title'), `<p>${t('over.body', { temp: st.room.toFixed(1) })}</p>
      <p class="muted">${t('ach.summary', { best: fmtDuration(st.stats.bestStreak), total: fmtDuration(st.stats.totalAlive), matches: st.stats.matchesTotal || 0 })}</p>
      <div class="row-btns"><button class="btn danger" id="over-reset">${t('over.reset')}</button></div>`);
    this.$('over-reset').onclick = () => {
      this.game.reset();
      this.bodyRank = undefined;
      this.view = null;
      this.closeModal();
      this.refreshInventory();
      this.refresh();
      this.toast(t('toast.newGame'), '🔥');
    };
  }

  showTip(px, html) {
    this.tipEl.innerHTML = html;
    this.tipEl.style.display = 'block';
    this.tipEl.style.left = `${px.x + 16}px`;
    this.tipEl.style.top = `${px.y + 16}px`;
  }

  hideTip() {
    this.tipEl.style.display = 'none';
  }

  toast(text, icon = '🔥') {
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `<span>${icon}</span><span>${text}</span>`;
    this.toastsEl.appendChild(el);
    setTimeout(() => el.classList.add('out'), 5200);
    setTimeout(() => el.remove(), 6000);
    while (this.toastsEl.children.length > 5) this.toastsEl.firstChild.remove();
  }

  openModal(title, html) {
    this.$('modal-title').textContent = title;
    this.modalBody.innerHTML = html;
    this.$('modal-close').hidden = this.view === 'gameover';
    this.modal.classList.add('open');
  }

  closeModal() {
    if (this.view === 'gameover' && this.game?.state.dead) return;
    this.view = null;
    this.modal.classList.remove('open');
  }

  openShop() {
    this.view = 'shop';
    const g = this.game;
    const rows = FUEL_ORDER.map((id) => {
      const F = FUELS[id];
      return `<div class="shop-row"><span class="ic">${F.icon}</span><div class="info"><b>${fuelName(id)}</b><small>${fuelDesc(id)}</small></div>
        <span class="have">${t('shop.have', { n: g.state.inventory[id] || 0 })}</span>
        <button class="btn buy" data-k="${id}" data-p="${F.price}" data-q="1">1 · ${F.price} ✨</button>
        <button class="btn buy" data-k="${id}" data-p="${F.price * 4}" data-q="5">5 · ${F.price * 4} ✨</button></div>`;
    }).join('');
    this.openModal(t('shop.title'), `<p class="muted">${t('shop.intro', { n: Math.floor(g.state.points) })}</p>
      <div class="shop">${rows}
      <div class="shop-row"><span class="ic">🔥</span><div class="info"><b>${t('shop.matches')}</b><small>${t('shop.matchesDesc', { n: MATCH_BOX.qty })}</small></div>
      <span class="have">${t('shop.have', { n: g.state.matches })}</span>
      <button class="btn buy" data-k="matches" data-p="${MATCH_BOX.price}" data-q="${MATCH_BOX.qty}">${MATCH_BOX.qty} · ${MATCH_BOX.price} ✨</button><span></span></div></div>`);
    this.modalBody.querySelectorAll('.buy').forEach((b) => {
      b.disabled = g.state.points < Number(b.dataset.p);
      b.onclick = () => {
        if (g.buy(b.dataset.k, Number(b.dataset.p), Number(b.dataset.q))) {
          this.refreshInventory();
          this.openShop();
        }
      };
    });
  }

  gather() {
    const loot = this.game.gatherGarden();
    if (!loot) {
      this.toast(t('toast.gardenWait', { min: Math.ceil(this.game.gardenStatus() / 60000) }), '🌲');
      return;
    }
    const list = Object.entries(loot).map(([k, n]) => {
      const [id, wet] = k.split(':');
      return `${n} × ${fuelShort(id).toLowerCase()}${wet ? ` ${t('wet')}` : ''}`;
    }).join(', ');
    this.toast(t('toast.garden', { list }), '🌲');
    this.refreshInventory();
  }

  openAchievements() {
    this.view = 'ach';
    const a = this.game.state.achievements;
    const html = ACHIEVEMENTS.map((x) => `<div class="ach ${a[x.id] ? 'done' : ''}"><span>${a[x.id] ? '🏆' : '🔒'}</span><div><b>${t(`ach.${x.id}.name`)}</b><small>${t(`ach.${x.id}.desc`)}</small></div></div>`).join('');
    const s = this.game.state.stats;
    this.openModal(t('ach.title'), `<div class="achs">${html}</div>
      <p class="muted">${t('ach.summary', { best: fmtDuration(s.bestStreak), total: fmtDuration(s.totalAlive), matches: s.matchesTotal || 0 })}</p>`);
  }

  openHelp() {
    this.view = 'help';
    this.openModal(t('help.title'), t('help.body'));
  }

  openSettings() {
    this.view = 'settings';
    const st = this.game.state;
    this.openModal(t('settings.title'), `
      <p><b>${t('settings.time')}</b> <span class="muted">${t('settings.timeHint')}</span></p>
      <div class="row-btns">${SPEEDS.map((s) => `<button class="btn spd ${st.speed === s ? 'on' : ''}" data-s="${s}">x${s}</button>`).join('')}</div>
      <p><b>${t('settings.game')}</b></p>
      <div class="row-btns"><button class="btn danger" id="reset">${t('settings.reset')}</button></div>`);
    this.modalBody.querySelectorAll('.spd').forEach((b) => {
      b.onclick = () => { st.speed = Number(b.dataset.s); this.openSettings(); this.refresh(); };
    });
    this.$('reset').onclick = () => {
      if (!confirm(t('settings.confirm'))) return;
      this.game.reset();
      this.bodyRank = undefined;
      this.closeModal();
      this.refreshInventory();
      this.toast(t('toast.newGame'), '🔥');
    };
  }

  showOffline(r) {
    this.view = 'offline';
    this.offlineReport = r;
    let txt;
    if (!r.wasAlive) txt = t('offline.dead');
    else if (r.aliveNow) txt = t('offline.alive');
    else txt = t('offline.outAgo', { time: fmtDuration(r.wentOutAgo) });
    this.openModal(t('offline.title'), `<p>${t('offline.away', { time: fmtDuration(r.seconds) })}</p><p>${txt}</p>
      ${r.consumed > 0 ? `<p>${t('offline.consumed', { n: r.consumed })}</p>` : ''}
      ${r.pointsGained >= 1 ? `<p>${t('offline.points', { n: Math.floor(r.pointsGained) })}</p>` : ''}
      <div class="row-btns"><button class="btn" id="off-ok">${t('offline.back')}</button></div>`);
    this.$('off-ok').onclick = () => this.closeModal();
  }
}
