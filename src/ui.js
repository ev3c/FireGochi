import { FUELS, FUEL_ORDER, WET_LIMIT } from './sim/fuels.js';
import { ACHIEVEMENTS, MATCH_BOX } from './game.js';

const MOOD = {
  out: ['🥶', 'Apagado'], smoking: ['😣', 'Humeando'], choked: ['😵', 'Sofocado'], embers: ['😴', 'Brasas'],
  weak: ['🥺', 'Débil'], steady: ['🙂', 'Estable'], lively: ['😊', 'Vivo'], roaring: ['🤩', 'Rugiente'],
};

const TOOLS = [
  { id: 'hand', icon: '✋', name: 'Mano', key: '1', tip: 'Arrastra para girar la vista en 3D (con cualquier herramienta: botón derecho) · rueda para acercar · doble clic o C para centrar · pasa el ratón sobre la leña para ver su estado.' },
  { id: 'match', icon: '🔥', name: 'Cerilla', key: '2', tip: 'Clic para rascar una cerilla, acércala al papel y clic otra vez para soltarla.' },
  { id: 'poker', icon: '🪝', name: 'Atizador', key: '3', tip: 'Arrastra troncos para recolocarlos. Remover aviva las brasas y abre paso al aire.' },
  { id: 'bellows', icon: '💨', name: 'Fuelle', key: '4', tip: 'Mantén pulsado (o la barra espaciadora) para insuflar aire.' },
  { id: 'water', icon: '🪣', name: 'Agua', key: '5', tip: 'Apaga el fuego de golpe (¡y empapa la leña!).' },
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
  }

  bind(game, interaction) {
    this.game = game;
    this.ix = interaction;
    const tools = this.$('tools');
    tools.innerHTML = '';
    for (const t of TOOLS) {
      const b = document.createElement('button');
      b.className = 'slot tool';
      b.dataset.tool = t.id;
      b.title = `${t.name} (${t.key}) — ${t.tip}`;
      b.innerHTML = `<span class="ic">${t.icon}</span><span class="nm">${t.name}</span><span class="ct" id="ct-${t.id}"></span>`;
      if (t.id === 'bellows') {
        b.addEventListener('pointerdown', () => { this.ix.audio.start(); this.ix.bellowsHeld = true; });
        b.addEventListener('pointerup', () => { this.ix.bellowsHeld = false; });
        b.addEventListener('pointerleave', () => { this.ix.bellowsHeld = false; });
      }
      b.onclick = () => { this.ix.audio.start(); this.ix.setTool(this.ix.tool === t.id && t.id !== 'hand' ? 'hand' : t.id); };
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
    for (const t of FUEL_ORDER) {
      for (const wet of [false, true]) {
        const key = wet ? `${t}:wet` : t;
        const n = inv[key] || 0;
        if (wet && !n) continue;
        const F = FUELS[t];
        const b = document.createElement('button');
        b.className = 'slot fuel' + (n ? '' : ' empty') + (wet ? ' wet' : '');
        b.dataset.key = key;
        b.title = `${F.name}${wet ? ' (húmedo)' : ''} — ${F.desc}${wet ? ' Está mojado: echará vapor y tardará en prender. Se secará solo si lo guardas mientras el fuego arde.' : ''}`;
        b.innerHTML = `<span class="ic sp-${F.species || t}">${F.icon}</span><span class="nm">${F.short}${wet ? ' 💧' : ''}</span><span class="ct">${n}</span>`;
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
      const F = FUELS[key.split(':')[0]];
      hint.textContent = `Apunta dónde dejar ${F.short.toLowerCase()} y haz clic · rueda o R para girar · clic derecho o Esc para cancelar`;
    } else {
      hint.textContent = (TOOLS.find((t) => t.id === tool) || TOOLS[0]).tip;
    }
  }

  statusText() {
    const g = this.game;
    const lv = g.level.id;
    const steaming = g.sim.items.some((i) => i.steam > 0.05 && i.moisture > WET_LIMIT);
    const rem = g.remainingMinutes();
    if (this.ix.match) return 'La cerilla arde: acércala al papel o a una piña antes de que se consuma.';
    switch (lv) {
      case 'out':
        if (g.entries.size === 0) return 'La chimenea está fría. Pon papel bajo la parrilla, astillas encima y enciéndelo con una cerilla.';
        return 'El fuego está apagado. Asegúrate de tener papel y astillas debajo de los troncos y usa una cerilla.';
      case 'smoking':
        return steaming ? 'La leña húmeda silba y echa vapor, pero no prende. Necesita más calor debajo.' : 'Hay humo pero no llama: falta calor. Añade papel o astillas y sopla con el fuelle.';
      case 'choked':
        return '¡Se está ahogando! Demasiada leña y poco aire: usa el fuelle o separa los troncos con el atizador.';
      case 'embers':
        return 'Solo quedan brasas. Añade astillas o una rama encima y sopla con el fuelle para reavivarlo.';
      case 'weak':
        if (steaming) return 'La leña húmeda está robando calor al fuego mientras se seca.';
        return rem < 4 ? 'Las llamas se debilitan: añade leña pronto.' : 'El fuego es débil. Los troncos gruesos necesitan más calor: añade astillas o ramas.';
      default:
        if (steaming) return 'La leña húmeda silba y echa vapor mientras se seca.';
        if (rem < 6) return `Queda leña para unos ${Math.max(1, Math.round(rem))} minutos. Prepara el siguiente tronco.`;
        if (g.state.room < 17) return `El fuego va bien, pero la sala aún está fría (${g.state.room.toFixed(1)} °C).`;
        if (lv === 'roaring') return 'Fuego rugiente. ¡Qué espectáculo! Vigila que no se acabe la leña.';
        return 'El fuego está a gusto y la casa, calentita.';
    }
  }

  refresh() {
    const g = this.game;
    if (!g) return;
    const st = g.state;
    const lv = g.level.id;
    const [face, label] = MOOD[lv];
    this.$('mood').textContent = face;
    this.$('level').textContent = label;
    this.$('bar-fire').style.width = `${Math.min(100, (g.sim.power / 5) * 100)}%`;
    this.$('bar-air').style.width = `${Math.round(g.sim.o2 * 100)}%`;
    this.$('bar-air').classList.toggle('bad', g.sim.o2 < 0.6);
    this.$('room').textContent = `${st.room.toFixed(1)} °C`;
    const w = g.weatherInfo();
    this.$('outside').textContent = `${g.outsideTemp().toFixed(0)} °C ${w ? w.icon : ''}`;
    this.$('outside').title = w ? w.name : 'Tiempo tranquilo';
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
    this.$('btn-garden').textContent = gs > 0 ? `🌲 ${Math.ceil(gs / 60000)} min` : '🌲 Jardín';
    this.$('btn-garden').classList.toggle('ready', gs <= 0);
    this.$('btn-sound').textContent = st.sound ? '🔊' : '🔇';
    this.$('speed').textContent = st.speed > 1 ? `⏩ x${st.speed}` : '';
    document.body.style.setProperty('--haze', String(Math.min(0.55, g.roomSmoke)));
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
    this.modal.classList.add('open');
  }

  closeModal() {
    this.modal.classList.remove('open');
  }

  confirmWater(onYes) {
    this.openModal('¿Apagar con agua?', `<p>Vas a echar un cubo de agua sobre el fuego. Se apagará al momento y toda la leña quedará empapada.</p>
      <div class="row-btns"><button class="btn danger" id="w-yes">🪣 Sí, apagarlo</button><button class="btn" id="w-no">Cancelar</button></div>`);
    this.$('w-yes').onclick = () => { this.closeModal(); onYes(); this.ix.setTool('hand'); };
    this.$('w-no').onclick = () => this.closeModal();
  }

  openShop() {
    const g = this.game;
    const rows = FUEL_ORDER.map((t) => {
      const F = FUELS[t];
      return `<div class="shop-row"><span class="ic">${F.icon}</span><div class="info"><b>${F.name}</b><small>${F.desc}</small></div>
        <span class="have">Tienes ${g.state.inventory[t] || 0}</span>
        <button class="btn buy" data-k="${t}" data-p="${F.price}" data-q="1">1 · ${F.price} ✨</button>
        <button class="btn buy" data-k="${t}" data-p="${F.price * 4}" data-q="5">5 · ${F.price * 4} ✨</button></div>`;
    }).join('');
    this.openModal('🛒 Tienda de leña', `<p class="muted">Tienes <b>${Math.floor(g.state.points)} ✨</b> puntos de calor. Se ganan manteniendo el fuego vivo y la casa caliente.</p>
      <div class="shop">${rows}
      <div class="shop-row"><span class="ic">🔥</span><div class="info"><b>Caja de cerillas</b><small>${MATCH_BOX.qty} cerillas de madera.</small></div>
      <span class="have">Tienes ${g.state.matches}</span>
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
      this.toast(`Ya has recogido leña hace poco. Vuelve en ${Math.ceil(this.game.gardenStatus() / 60000)} min.`, '🌲');
      return;
    }
    const list = Object.entries(loot).map(([k, n]) => {
      const [t, wet] = k.split(':');
      return `${n} × ${FUELS[t].short.toLowerCase()}${wet ? ' húmedo' : ''}`;
    }).join(', ');
    this.toast(`Has recogido en el jardín: ${list}.`, '🌲');
    this.refreshInventory();
  }

  openAchievements() {
    const a = this.game.state.achievements;
    const html = ACHIEVEMENTS.map((x) => `<div class="ach ${a[x.id] ? 'done' : ''}"><span>${a[x.id] ? '🏆' : '🔒'}</span><div><b>${x.name}</b><small>${x.desc}</small></div></div>`).join('');
    const s = this.game.state.stats;
    this.openModal('🏆 Logros', `<div class="achs">${html}</div>
      <p class="muted">Mejor racha: ${fmtDuration(s.bestStreak)} · Tiempo total de fuego: ${fmtDuration(s.totalAlive)} · Cerillas usadas: ${s.matchesTotal || 0}</p>`);
  }

  openHelp() {
    this.openModal('🔥 Cómo cuidar tu chimenea', `
      <p>Tu fuego es como una mascota: tienes que <b>encenderlo</b>, <b>alimentarlo</b> y <b>vigilarlo</b>. El tiempo sigue corriendo aunque cierres la página: si no hay leña, se apagará.</p>
      <h4>Encender como en la vida real</h4>
      <ol>
        <li>Pon 1–2 bolas de <b>papel</b> en el suelo, bajo la parrilla (apunta entre los barrotes).</li>
        <li>Encima, sobre la parrilla, un par de manojos de <b>astillas</b> o unas <b>piñas</b>.</li>
        <li>Después, <b>ramas</b> y por último uno o dos <b>troncos</b>.</li>
        <li>Rasca una <b>cerilla</b> y acércala al papel. Una cerilla no puede prender un tronco por sí sola.</li>
      </ol>
      <h4>Mantenerlo</h4>
      <ul>
        <li>Los troncos juntos se dan calor entre sí; uno solo tiende a apagarse.</li>
        <li>Demasiada leña <b>ahoga</b> el fuego: verás humo. Usa el <b>fuelle</b> o separa troncos con el <b>atizador</b>.</li>
        <li>Las <b>brasas</b> duran mucho: con astillas y el fuelle puedes reavivar el fuego sin cerillas.</li>
        <li>La leña <b>húmeda</b> echa vapor y tarda en prender. La guardada se seca sola si el fuego arde.</li>
        <li>El pino da llama viva y chispas; el roble y la encina, calor y brasas durante horas.</li>
      </ul>
      <h4>Controles</h4>
      <p class="muted">Arrastrar con la mano o con el botón derecho: girar la vista 3D · Rueda: acercar (o girar la pieza que llevas) · Doble clic o C: centrar vista.</p>
      <p class="muted">1–5 herramientas · Espacio: fuelle · R: girar la pieza · Clic derecho/Esc: soltar herramienta.</p>
      <p class="muted">Ganas puntos ✨ con el fuego encendido y la casa entre 19 y 25 °C. Úsalos en la tienda. El jardín te da leña gratis cada pocos minutos.</p>`);
  }

  openSettings() {
    const st = this.game.state;
    this.openModal('⚙️ Ajustes', `
      <p><b>Ritmo del tiempo</b> <span class="muted">(acelera la combustión para jugar más rápido)</span></p>
      <div class="row-btns">${[1, 2, 5, 10].map((s) => `<button class="btn spd ${st.speed === s ? 'on' : ''}" data-s="${s}">x${s}</button>`).join('')}</div>
      <p><b>Partida</b></p>
      <div class="row-btns"><button class="btn danger" id="reset">Empezar de cero</button></div>`);
    this.modalBody.querySelectorAll('.spd').forEach((b) => {
      b.onclick = () => { st.speed = Number(b.dataset.s); this.openSettings(); this.refresh(); };
    });
    this.$('reset').onclick = () => {
      if (!confirm('¿Seguro? Se borrará todo tu progreso.')) return;
      this.game.reset();
      this.closeModal();
      this.refreshInventory();
      this.toast('Partida nueva. ¡A encender la chimenea!', '🔥');
    };
  }

  showOffline(r) {
    let txt;
    if (!r.wasAlive) txt = 'La chimenea seguía apagada.';
    else if (r.aliveNow) txt = '¡El fuego ha aguantado! Sigue vivo.';
    else txt = `El fuego se apagó hace ${fmtDuration(r.wentOutAgo)}.`;
    this.openModal('🕰️ Mientras no estabas…', `<p>Has estado fuera <b>${fmtDuration(r.seconds)}</b>.</p><p>${txt}</p>
      ${r.consumed > 0 ? `<p>Se han consumido ${r.consumed} piezas de leña.</p>` : ''}
      ${r.pointsGained >= 1 ? `<p>Has ganado <b>${Math.floor(r.pointsGained)} ✨</b>.</p>` : ''}
      <div class="row-btns"><button class="btn" id="off-ok">Volver junto al fuego</button></div>`);
    this.$('off-ok').onclick = () => this.closeModal();
  }
}
