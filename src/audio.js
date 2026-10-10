// Sonido 100 % sintetizado con Web Audio.

export class FireAudio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.crackleAcc = 0;
  }

  start() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = (this.ctx = new Ctx());
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 0.8 : 0;
    this.master.connect(ctx.destination);

    this.noiseBuf = this.makeNoise(3, 'white');
    this.brownBuf = this.makeNoise(4, 'brown');

    // Rugido grave del fuego.
    this.roar = this.loop(this.brownBuf);
    this.roarFilter = ctx.createBiquadFilter();
    this.roarFilter.type = 'lowpass';
    this.roarFilter.frequency.value = 350;
    this.roarGain = ctx.createGain();
    this.roarGain.gain.value = 0;
    this.roar.connect(this.roarFilter).connect(this.roarGain).connect(this.master);

    // Siseo de la llama.
    this.hiss = this.loop(this.noiseBuf);
    const hf = ctx.createBiquadFilter();
    hf.type = 'bandpass';
    hf.frequency.value = 2400;
    hf.Q.value = 0.6;
    this.hissGain = ctx.createGain();
    this.hissGain.gain.value = 0;
    this.hiss.connect(hf).connect(this.hissGain).connect(this.master);

    // Vapor de la leña húmeda.
    this.steam = this.loop(this.noiseBuf);
    const sf = ctx.createBiquadFilter();
    sf.type = 'highpass';
    sf.frequency.value = 4500;
    this.steamGain = ctx.createGain();
    this.steamGain.gain.value = 0;
    this.steam.connect(sf).connect(this.steamGain).connect(this.master);

    // Fuelle.
    this.bellows = this.loop(this.noiseBuf);
    this.bellowsFilter = ctx.createBiquadFilter();
    this.bellowsFilter.type = 'lowpass';
    this.bellowsFilter.frequency.value = 600;
    this.bellowsGain = ctx.createGain();
    this.bellowsGain.gain.value = 0;
    this.bellows.connect(this.bellowsFilter).connect(this.bellowsGain).connect(this.master);

    // Viento / lluvia de fondo.
    this.wind = this.loop(this.brownBuf);
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 400;
    this.windFilter.Q.value = 0.8;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.wind.connect(this.windFilter).connect(this.windGain).connect(this.master);

    this.rain = this.loop(this.noiseBuf);
    const rf = ctx.createBiquadFilter();
    rf.type = 'bandpass';
    rf.frequency.value = 1200;
    rf.Q.value = 0.3;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    this.rain.connect(rf).connect(this.rainGain).connect(this.master);
  }

  makeNoise(seconds, kind) {
    const ctx = this.ctx;
    const len = ctx.sampleRate * seconds;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'brown') {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else d[i] = w;
    }
    return buf;
  }

  loop(buf) {
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.start(0, Math.random() * buf.duration);
    return s;
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.setTargetAtTime(on ? 0.8 : 0, this.ctx.currentTime, 0.1);
  }

  burst({ freq = 2000, q = 1, dur = 0.03, gain = 0.3, type = 'bandpass', when = 0 }) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 2);
    src.stop(t + dur + 0.05);
  }

  crackle(intensity = 1) {
    const n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      this.burst({
        freq: 1200 + Math.random() * 3500,
        q: 0.8 + Math.random() * 2,
        dur: 0.008 + Math.random() * 0.03,
        gain: (0.08 + Math.random() * 0.25) * intensity,
        when: i * (0.01 + Math.random() * 0.04),
      });
    }
  }

  pop() {
    this.burst({ freq: 900 + Math.random() * 600, q: 0.7, dur: 0.06, gain: 0.55 });
    this.burst({ freq: 3000, q: 1, dur: 0.02, gain: 0.3, when: 0.01 });
    for (let i = 0; i < 4; i++) this.burst({ freq: 2500 + Math.random() * 2000, q: 2, dur: 0.01, gain: 0.12, when: 0.03 + Math.random() * 0.15 });
  }

  strike() {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(1500, t);
    f.frequency.exponentialRampToValueAtTime(5000, t + 0.15);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 0.3);
    // Fogonazo.
    this.burst({ freq: 500, q: 0.5, dur: 0.5, gain: 0.35, type: 'lowpass', when: 0.12 });
  }

  thud(strength = 1) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(110 + Math.random() * 40, t);
    o.frequency.exponentialRampToValueAtTime(50, t + 0.15);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.4 * strength, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.25);
    this.burst({ freq: 700, q: 0.8, dur: 0.08, gain: 0.25 * strength });
  }

  paperRustle() {
    for (let i = 0; i < 6; i++) this.burst({ freq: 3000 + Math.random() * 3000, q: 0.5, dur: 0.05, gain: 0.08, when: i * 0.04 });
  }

  splash() {
    if (!this.ctx || !this.enabled) return;
    this.burst({ freq: 800, q: 0.4, dur: 0.6, gain: 0.6, type: 'lowpass' });
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 3500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t + 0.1);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 4);
    src.connect(f).connect(g).connect(this.master);
    src.start(t + 0.1);
    src.stop(t + 4.2);
  }

  chime() {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    [660, 880, 1320].forEach((fr, i) => {
      const o = ctx.createOscillator();
      o.frequency.value = fr;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + i * 0.09);
      g.gain.exponentialRampToValueAtTime(0.12, t + i * 0.09 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.09 + 0.6);
      o.connect(g).connect(this.master);
      o.start(t + i * 0.09);
      o.stop(t + i * 0.09 + 0.7);
    });
  }

  update(dt, { flame, power, steam, bellows, crackleRate, wind, rain }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.roarGain.gain.setTargetAtTime(Math.min(0.5, power * 0.07 + flame * 0.03) * (1 + bellows * 0.8), t, 0.3);
    this.roarFilter.frequency.setTargetAtTime(250 + Math.min(flame, 6) * 60 + bellows * 300, t, 0.3);
    this.hissGain.gain.setTargetAtTime(Math.min(0.06, flame * 0.008), t, 0.3);
    this.steamGain.gain.setTargetAtTime(Math.min(0.12, steam * 0.08), t, 0.3);
    this.bellowsGain.gain.setTargetAtTime(bellows * 0.35, t, 0.08);
    this.bellowsFilter.frequency.setTargetAtTime(400 + bellows * 900, t, 0.1);
    this.windGain.gain.setTargetAtTime(wind * 0.18, t, 1.5);
    this.windFilter.frequency.setTargetAtTime(300 + Math.sin(t * 0.3) * 120 + wind * 150, t, 0.5);
    this.rainGain.gain.setTargetAtTime(rain * 0.05, t, 1.5);

    this.crackleAcc += crackleRate * dt;
    while (this.crackleAcc > 1) {
      this.crackleAcc -= 1 + Math.random();
      this.crackle(0.7 + Math.random() * 0.6);
    }
  }
}
