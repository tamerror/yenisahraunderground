/** Tiny WebAudio synth for game sound effects; no audio files needed. */
import { mulberry32 } from '../core/rng';

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private music: { timer: number; stopAt: number; index: number } | null = null;
  muted: boolean;

  constructor() {
    let m = false;
    try {
      m = localStorage.getItem('ysu:muted') === '1';
    } catch {
      /* ignore */
    }
    this.muted = m;
  }

  /** Must be called from a user gesture. */
  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
    } catch {
      this.ctx = null;
    }
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    try {
      localStorage.setItem('ysu:muted', this.muted ? '1' : '0');
    } catch {
      /* ignore */
    }
    return this.muted;
  }

  private tone(freq: number, start: number, dur: number, type: OscillatorType = 'sine', vol = 0.3, glideTo?: number): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime + start;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  pickup(mult = 1): void {
    const f = 620 * (1 + 0.12 * (mult - 1));
    this.tone(f, 0, 0.09, 'square', 0.12);
    this.tone(f * 1.5, 0.06, 0.14, 'square', 0.12);
  }

  rare(): void {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, i * 0.07, 0.25, 'triangle', 0.22));
  }

  record(): void {
    [392, 494, 587, 784, 988].forEach((f, i) => this.tone(f, i * 0.09, 0.35, 'triangle', 0.22));
    this.tone(98, 0, 0.9, 'sawtooth', 0.12);
  }

  powerup(): void {
    this.tone(300, 0, 0.35, 'sawtooth', 0.12, 1200);
  }

  meow(): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const f = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(520, t);
    o.frequency.linearRampToValueAtTime(880, t + 0.12);
    o.frequency.linearRampToValueAtTime(600, t + 0.4);
    f.type = 'bandpass';
    f.frequency.setValueAtTime(1200, t);
    f.frequency.linearRampToValueAtTime(2200, t + 0.15);
    f.frequency.linearRampToValueAtTime(900, t + 0.4);
    f.Q.value = 3;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.35, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    o.connect(f).connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.5);
  }

  badge(): void {
    [523, 659, 784].forEach((f) => this.tone(f, 0, 0.5, 'triangle', 0.15));
    [659, 784, 1047].forEach((f) => this.tone(f, 0.25, 0.6, 'triangle', 0.15));
  }

  quest(): void {
    [440, 554, 659, 880].forEach((f, i) => this.tone(f, i * 0.08, 0.2, 'square', 0.1));
  }

  street(): void {
    [587, 740, 880].forEach((f, i) => this.tone(f, i * 0.1, 0.25, 'triangle', 0.16));
  }

  warn(): void {
    this.tone(220, 0, 0.15, 'square', 0.1);
  }

  private noiseBuf(): AudioBuffer | null {
    if (!this.ctx) return null;
    if (!this.noise) {
      const n = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, n, n);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    }
    return this.noise;
  }

  private hit(t: number, kind: 'kick' | 'snare' | 'hat', vol: number): void {
    const ctx = this.ctx!;
    if (kind === 'kick') {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      o.connect(g).connect(this.master!);
      o.start(t);
      o.stop(t + 0.32);
      return;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf();
    const f = ctx.createBiquadFilter();
    f.type = kind === 'hat' ? 'highpass' : 'bandpass';
    f.frequency.value = kind === 'hat' ? 7000 : 1800;
    const g = ctx.createGain();
    const dur = kind === 'hat' ? 0.05 : 0.18;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  get playingRecord(): number | null {
    return this.music ? this.music.index : null;
  }

  /** Plays a short procedurally generated loop for one of the collected "Underground" records. */
  playRecord(index: number, seconds = 32): void {
    this.unlock();
    this.stopRecord();
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const rng = mulberry32(1000 + index * 7919);
    const bpm = 84 + Math.floor(rng() * 44);
    const step = 60 / bpm / 4;
    const roots = [45, 47, 48, 50, 52, 43, 41];
    const root = roots[index % roots.length];
    const scale = [0, 3, 5, 7, 10, 12, 15];
    const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
    const kick = Array.from({ length: 16 }, (_, i) => i % 8 === 0 || (i % 4 === 0 && rng() < 0.3) || (i % 2 === 1 && rng() < 0.08));
    const snare = Array.from({ length: 16 }, (_, i) => i % 8 === 4 || (i % 16 === 15 && rng() < 0.4));
    const bass = Array.from({ length: 16 }, (_, i) => (kick[i] || rng() < 0.18 ? scale[Math.floor(rng() * 3)] : null));
    const arp = Array.from({ length: 16 }, () => (rng() < 0.45 ? scale[Math.floor(rng() * scale.length)] + 12 : null));
    const wave: OscillatorType = (['square', 'triangle', 'sawtooth'] as const)[index % 3];
    let next = ctx.currentTime + 0.08;
    let i = 0;
    const stopAt = ctx.currentTime + seconds;
    const tick = () => {
      while (next < ctx.currentTime + 0.12 && next < stopAt) {
        const k = i % 16;
        const bar = Math.floor(i / 16) % 4;
        if (kick[k]) this.hit(next, 'kick', 0.5);
        if (snare[k]) this.hit(next, 'snare', 0.22);
        if (k % 2 === 0 || rng() < 0.3) this.hit(next, 'hat', 0.06);
        const shift = bar === 2 ? 5 : bar === 3 ? 3 : 0;
        if (bass[k] !== null) this.tone(mtof(root + bass[k]! + shift), next - ctx.currentTime, step * 1.8, 'sawtooth', 0.09);
        if (arp[k] !== null && i >= 32) this.tone(mtof(root + 12 + arp[k]! + shift), next - ctx.currentTime, step * 1.2, wave, 0.05);
        next += step;
        i++;
      }
      if (next >= stopAt) this.stopRecord();
    };
    const timer = window.setInterval(tick, 25);
    this.music = { timer, stopAt, index };
    tick();
  }

  stopRecord(): void {
    if (!this.music) return;
    clearInterval(this.music.timer);
    this.music = null;
  }

  level(): void {
    [392, 523, 659, 784, 1047].forEach((f, i) => this.tone(f, i * 0.11, 0.4, 'triangle', 0.2));
  }
}
