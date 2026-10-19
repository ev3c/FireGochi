import { FUELS, FUEL_ORDER, WET_LIMIT } from './sim/fuels.js';
import { ACHIEVEMENTS, MATCH_BOX, BODY, bodyState } from './game.js';
import { t, setLang, getLang, onLang, fuelName, fuelShort, fuelDesc } from './i18n.js';
import { WorldRecord } from './worldRecord.js';

const HEAT_RISK = ['hot', 'veryhot', 'heatstroke'];
const SPEEDS = [1, 8, 16, 32, 64, 128, 256, 512, 1024];

const TOOLS = [
  { id: 'hand', icon: '✋', key: '1' },
  { id: 'match', icon: '🔥', key: '2' },
  { id: 'poker', icon: '🪝', key: '3' },
  { id: 'bellows', icon: '💨', key: '4' },
  { id: 'water', icon: '🪣', key: '5' },
];

const touchScreen = () => matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 1;

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
    this.$('confirm-yes').onclick = () => this.resolveConfirm?.(true);
    this.$('confirm-no').onclick = () => this.resolveConfirm?.(false);
    this.$('confirm').addEventListener('pointerdown', (e) => { if (e.target.id === 'confirm') this.resolveConfirm?.(false); });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.resolveConfirm?.(false); });
    // Botón Atrás (Android o navegador): una entrada extra en el historial lo intercepta para cerrar
    // la ventana abierta o preguntar antes de salir. Chrome se salta las entradas añadidas sin un gesto
    // del usuario, así que se vuelve a armar en el siguiente toque.
    this.trapped = !!history.state?.firegochi;
    const arm = (e) => { if (!e.target.closest?.('#confirm')) this.armTrap(); };
    window.addEventListener('pointerdown', arm, true);
    window.addEventListener('keydown', arm, true);
    window.addEventListener('popstate', () => {
      if (this.leaving) return;
      this.trapped = false;
      if (this.resolveConfirm) this.resolveConfirm(false);
      else if (this.modal.classList.contains('open')) this.closeModal();
      else return this.askExit();
      this.armTrap();
    });
    this.lastStatus = '';
    this.view = null;
    this.world = new WorldRecord();
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
    this.advanceTutorial('speed');
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
    else if (view === 'points') this.openPoints();
    else if (view === 'offline') this.showOffline(this.offlineReport);
    else if (view === 'gameover') this.showGameOver();
    else if (view === 'name') this.askName();
  }

  refreshToolLabels() {
    for (const tool of TOOLS) {
      const b = document.querySelector(`[data-tool="${tool.id}"]`);
      if (!b) continue;
      b.querySelector('.nm').textContent = t(`tool.${tool.id}.name`);
      b.title = `${t(`tool.${tool.id}.name`)} (${tool.key}) — ${t(touchScreen() ? `tool.${tool.id}.tipTouch` : `tool.${tool.id}.tip`)}`;
    }
    if (this.ix) this.setActiveTool(this.ix.tool, this.ix.placeKey);
    if (this.coachStep) this.showCoach();
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
      b.title = `${t(`tool.${tool.id}.name`)} (${tool.key}) — ${t(touchScreen() ? `tool.${tool.id}.tipTouch` : `tool.${tool.id}.tip`)}`;
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
    this.$('btn-points').onclick = () => this.openPoints();
    this.$('btn-sound').onclick = () => {
      game.state.sound = !game.state.sound;
      this.ix.audio.setEnabled(game.state.sound);
      this.refresh();
    };
    this.refreshInventory();
    this.refresh();
    const bar = this.$('toolbar');
    bar.addEventListener('scroll', () => this.updateBarMore(), { passive: true });
    this.$('bar-left').onclick = () => { bar.scrollBy({ left: -180, behavior: 'smooth' }); };
    this.$('bar-right').onclick = () => { bar.scrollBy({ left: 180, behavior: 'smooth' }); };
    this.$('coach-skip').onclick = () => this.finishTutorial(false);
    window.addEventListener('resize', () => { this.updateBarMore(); this.placeCoach(); });
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
        b.addEventListener('pointerdown', (e) => {
          if (e.button !== 0) return;
          const sx = e.clientX, sy = e.clientY;
          let dragged = false;
          const prev = { tool: this.ix.tool, key: this.ix.placeKey };
          if (n) {
            this.ix.audio.start();
            this.ix.setTool('place', key);
          }
          const move = (ev) => {
            if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 14) dragged = true;
          };
          const end = () => {
            b.removeEventListener('pointermove', move);
            b.removeEventListener('pointerup', end);
            b.removeEventListener('pointercancel', end);
            if (dragged) {
              if (n && this.ix.tool === 'place' && this.ix.placeKey === key) this.ix.setTool(prev.tool, prev.key);
              return;
            }
            if (!n) {
              this.ix.audio.start();
              this.openShop();
            }
          };
          b.addEventListener('pointermove', move);
          b.addEventListener('pointerup', end);
          b.addEventListener('pointercancel', end);
        });
        box.appendChild(b);
      }
    }
    this.setActiveTool(this.ix.tool, this.ix.placeKey);
    this.$('ct-match').textContent = this.game.state.matches;
    this.updateBarMore();
    if (this.coachStep) this.showCoach();
  }

  updateBarMore() {
    const bar = this.$('toolbar');
    if (!bar) return;
    // Quitar .pad para medir recorta scrollLeft y deja el último objeto bajo la flecha.
    const extra = bar.classList.contains('pad') ? 56 : 0;
    const overflows = bar.scrollWidth - extra - bar.clientWidth > 8;
    if (bar.classList.contains('pad') !== overflows) bar.classList.toggle('pad', overflows);
    const max = bar.scrollWidth - bar.clientWidth;
    this.$('bar-left').hidden = !overflows || bar.scrollLeft < 8;
    this.$('bar-right').hidden = !overflows || bar.scrollLeft > max - 8;
    this.$('bar-left').title = t('bar.left');
    this.$('bar-right').title = t('bar.right');
  }

  setActiveTool(tool, key) {
    document.querySelectorAll('.slot').forEach((el) => {
      el.classList.toggle('active', (el.dataset.tool && el.dataset.tool === tool) || (tool === 'place' && el.dataset.key === key));
    });
    const hint = this.$('hint');
    const touch = touchScreen();
    if (tool === 'place') {
      const id = key.split(':')[0];
      hint.textContent = t(touch ? 'hint.placeTouch' : 'hint.place', { name: fuelShort(id).toLowerCase() });
    } else {
      const id = tool || 'hand';
      hint.textContent = t(touch ? `tool.${id}.tipTouch` : `tool.${id}.tip`);
    }
  }

  startTutorial() {
    if (this.game.state.tutorialSeen || this.game.state.dead) return;
    this.coachStep = 'paper';
    this.showCoach();
  }

  advanceTutorial(step) {
    if (this.coachStep !== step) return;
    const next = { paper: 'kindling', kindling: 'match', match: 'speed', speed: 'garden', garden: 'shop', shop: null };
    this.coachStep = next[step];
    if (!this.coachStep) this.finishTutorial(true);
    else this.showCoach();
  }

  finishTutorial(done) {
    this.game.state.tutorialSeen = true;
    this.coachStep = null;
    document.querySelector('.coach-target')?.classList.remove('coach-target');
    this.$('coach').hidden = true;
    this.$('toasts').style.top = '';
    this.game.save();
    if (done) this.toast(t('tut.done'), '🔥');
  }

  showCoach() {
    if (!this.coachStep) return;
    const coach = this.$('coach');
    this.$('coach-text').textContent = t(`tut.${this.coachStep}`);
    this.$('coach-skip').textContent = t('tut.skip');
    coach.hidden = false;
    document.querySelector('.coach-target')?.classList.remove('coach-target');
    const selectors = { match: '[data-tool="match"]', speed: '#speed', garden: '#btn-garden', shop: '#btn-shop' };
    const target = document.querySelector(selectors[this.coachStep] || `[data-key="${this.coachStep}"]`);
    if (target) {
      target.classList.add('coach-target');
      target.scrollIntoView({ inline: 'center', block: 'nearest' });
    }
    this.placeCoach();
    this.updateBarMore();
  }

  placeCoach() {
    const coach = this.$('coach');
    const toasts = this.$('toasts');
    if (!coach || coach.hidden) {
      if (toasts) toasts.style.top = '';
      return;
    }
    const target = document.querySelector('.coach-target');
    const atTop = target && !this.$('bottom').contains(target);
    if (atTop) {
      const r = target.getBoundingClientRect();
      const hud = this.$('hud').getBoundingClientRect();
      const half = coach.offsetWidth / 2;
      const center = Math.min(window.innerWidth - half - 8, Math.max(half + 8, r.left + r.width / 2));
      let top = r.bottom + 8;
      const left = center - half;
      if (left < hud.right && center + half > hud.left && top < hud.bottom) top = hud.bottom + 8;
      top = Math.min(top, window.innerHeight - coach.offsetHeight - 8);
      coach.style.bottom = 'auto';
      coach.style.left = `${center}px`;
      coach.style.top = `${top}px`;
      if (toasts) {
        const coachRight = center + half;
        const overlaps = coachRight > window.innerWidth - 340 && top < 160;
        toasts.style.top = overlaps ? `${Math.round(top + coach.offsetHeight + 8)}px` : '';
      }
      return;
    }
    if (toasts) toasts.style.top = '';
    target?.scrollIntoView({ inline: 'center', block: 'nearest' });
    coach.style.left = '50%';
    coach.style.top = 'auto';
    const bottom = this.$('bottom').getBoundingClientRect();
    coach.style.bottom = `${Math.max(8, window.innerHeight - bottom.top + 8)}px`;
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
    this.refreshWorld();
    this.$('points').textContent = Math.floor(st.points);
    this.$('ct-match').textContent = st.matches;
    const status = this.statusText();
    if (status !== this.lastStatus) {
      this.lastStatus = status;
      this.$('status').textContent = status;
    }
    const gs = g.gardenStatus();
    this.$('btn-garden').textContent = gs > 0 ? `🌲 ${Math.ceil(gs / 60)} min` : t('nav.garden');
    this.$('btn-garden').classList.toggle('ready', gs <= 0);
    this.$('btn-sound').textContent = st.sound ? '🔊' : '🔇';
    this.$('spd-val').textContent = `x${st.speed}`;
    this.$('spd-down').disabled = st.speed <= SPEEDS[0];
    this.$('spd-up').disabled = st.speed >= SPEEDS[SPEEDS.length - 1];
    document.body.style.setProperty('--haze', String(Math.min(0.55, g.roomSmoke)));
  }

  refreshWorld() {
    const w = this.world;
    const best = this.game.state.stats.bestStreak;
    if (w.update(best) && !this.view && !this.game.state.dead) this.askName();
    const box = this.$('world');
    box.hidden = !w.enabled || !w.online;
    if (box.hidden) return;
    const r = w.record;
    this.$('world-time').textContent = r ? fmtDuration(r.seconds) : '—';
    const who = !r ? t('world.empty') : w.mine ? t('world.you') : (r.name || t('world.anon'));
    this.$('world-name').textContent = who;
    box.classList.toggle('mine', w.mine);
    box.title = r ? `${t('world.title')}: ${fmtDuration(r.seconds)} — ${r.name || t('world.anon')}` : t('world.title');
  }

  askName() {
    this.view = 'name';
    this.openModal(t('world.newTitle'), `<p>${t('world.newBody', { time: fmtDuration(this.game.state.stats.bestStreak) })}</p>
      <form id="name-form" class="name-form">
        <input id="name-input" type="text" maxlength="20" autocomplete="nickname" placeholder="${t('world.placeholder')}" />
        <button class="btn" type="submit">${t('world.save')}</button>
      </form>
      <p class="muted">${t('world.privacy')}</p>`);
    const input = this.$('name-input');
    setTimeout(() => input.focus(), 50);
    this.$('name-form').onsubmit = (e) => {
      e.preventDefault();
      if (!input.value.trim()) return input.focus();
      this.world.setName(input.value);
      this.view = null;
      this.closeModal();
      this.world.send(this.game.state.stats.bestStreak);
      this.toast(t('world.saved', { name: this.world.player.name }), '🌍');
    };
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
      this.startTutorial();
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
    if (this.view === 'name') this.world.anonymous = true;
    this.view = null;
    this.modal.classList.remove('open');
  }

  armTrap() {
    if (this.trapped || this.leaving) return;
    this.trapped = true;
    history.pushState({ firegochi: true }, '');
  }

  askConfirm({ title, text, yes, danger = false }) {
    this.resolveConfirm?.(false);
    this.$('confirm-title').textContent = title;
    this.$('confirm-text').textContent = text;
    const yesBtn = this.$('confirm-yes');
    yesBtn.textContent = yes;
    yesBtn.classList.toggle('danger', danger);
    this.$('confirm-no').textContent = t('confirm.no');
    this.$('confirm').hidden = false;
    this.$('confirm-no').focus();
    return new Promise((resolve) => {
      this.resolveConfirm = (ok) => {
        this.$('confirm').hidden = true;
        this.resolveConfirm = null;
        resolve(ok);
      };
    });
  }

  async askExit() {
    this.game?.save();
    const ok = await this.askConfirm({ title: t('exit.title'), text: t('exit.text'), yes: t('exit.yes'), danger: true });
    if (!ok) {
      this.armTrap();
      return;
    }
    this.leaving = true;
    history.back();
    // En la app instalada no hay página anterior: se intenta cerrar y, si no se puede,
    // el siguiente Atrás del sistema sale porque la trampa ya no está armada.
    setTimeout(() => {
      if (document.hidden) return;
      window.close();
      this.leaving = false;
    }, 400);
  }

  openPoints() {
    this.view = 'points';
    const n = Math.floor(this.game.state.points);
    const ways = ['alive', 'comfort', 'steady', 'ach'].map((k) => `<li>${t(`points.${k}`)}</li>`).join('');
    this.openModal(t('points.title'), `<p>${t('points.intro', { n })}</p>
      <ul class="points-list">${ways}</ul>
      <p class="muted">${t('points.note')}</p>
      <div class="row-btns"><button class="btn" id="points-shop">${t('points.shop')}</button></div>`);
    this.$('points-shop').onclick = () => this.openShop();
  }

  openShop() {
    this.advanceTutorial('shop');
    this.view = 'shop';
    const g = this.game;
    const row = (icon, name, desc, have, buys) => `<div class="shop-row"><span class="ic">${icon}</span>
      <div class="info"><b>${name}</b><span class="have">${t('shop.have', { n: have })}</span><small>${desc}</small></div>
      <div class="buys">${buys.map(([k, q, p]) => `<button class="btn buy" data-k="${k}" data-p="${p}" data-q="${q}"><span class="q">×${q}</span> ${p} ✨</button>`).join('')}</div></div>`;
    const rows = FUEL_ORDER.map((id) => {
      const F = FUELS[id];
      return row(F.icon, fuelName(id), fuelDesc(id), g.state.inventory[id] || 0, [[id, 1, F.price], [id, 5, F.price * 4]]);
    }).join('');
    const matches = row('🔥', t('shop.matches'), t('shop.matchesDesc', { n: MATCH_BOX.qty }), g.state.matches,
      [['matches', MATCH_BOX.qty, MATCH_BOX.price]]);
    this.openModal(`${t('shop.title')} · ${Math.floor(g.state.points)} ✨`, `<p class="muted shop-intro">${t('shop.intro', { n: Math.floor(g.state.points) })}</p>
      <div class="shop">${rows}${matches}</div>`);
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
    this.advanceTutorial('garden');
    const loot = this.game.gatherGarden();
    if (!loot) {
      this.toast(t('toast.gardenWait', { min: Math.ceil(this.game.gardenStatus() / 60) }), '🌲');
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
      <p class="set-head"><b>${t('settings.time')}</b> <span class="muted">${t('settings.timeHint')}</span></p>
      <div class="row-btns">${SPEEDS.map((s) => `<button class="btn spd ${st.speed === s ? 'on' : ''}" data-s="${s}">x${s}</button>`).join('')}</div>
      <p class="set-head"><b>${t('world.nick')}</b> <span class="muted">${t('world.nickHint')}</span></p>
      <form id="nick-form" class="name-form">
        <input id="nick-input" type="text" maxlength="20" autocomplete="nickname" placeholder="${t('world.placeholder')}" />
        <button class="btn" type="submit">${t('world.save')}</button>
      </form>
      ${'Notification' in window ? `<p class="set-head"><b>${t('remind.title')}</b> <span class="muted">${t('remind.hint')}</span></p>
      <div class="row-btns"><button class="btn ${st.remind ? 'on' : ''}" id="remind">${t(st.remind ? 'remind.on' : 'remind.off')}</button></div>` : ''}
      <p><b>${t('settings.game')}</b></p>
      <div class="row-btns"><button class="btn danger" id="reset">${t('settings.reset')}</button></div>
      <a id="contact" href="mailto:info@firegochi.com" title="${t('contact.mail')}">info@firegochi.com</a>`);
    this.$('nick-input').value = this.world.player.name;
    this.$('nick-form').onsubmit = (e) => {
      e.preventDefault();
      this.world.setName(this.$('nick-input').value);
      if (this.world.mine) this.world.send(this.world.seconds);
      this.toast(t('world.saved', { name: this.world.player.name || t('world.anon') }), '🌍');
    };
    const remind = this.$('remind');
    if (remind) remind.onclick = async () => {
      if (st.remind) {
        st.remind = false;
        this.openSettings();
        return;
      }
      const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
      if (perm !== 'granted') {
        this.toast(t('remind.denied'), '🔔');
        return;
      }
      st.remind = true;
      this.game.save();
      if (this.view === 'settings') this.openSettings();
      this.toast(t('remind.saved'), '🔔');
    };
    this.modalBody.querySelectorAll('.spd').forEach((b) => {
      b.onclick = () => { st.speed = Number(b.dataset.s); this.openSettings(); this.refresh(); };
    });
    this.$('reset').onclick = async () => {
      const ok = await this.askConfirm({ title: t('confirm.resetTitle'), text: t('settings.confirm'), yes: t('settings.reset'), danger: true });
      if (!ok) return;
      this.game.reset();
      this.bodyRank = undefined;
      this.closeModal();
      this.refreshInventory();
      this.startTutorial();
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
