/** Tiny WebAudio synth for game sound effects; no audio files needed. */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
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

  level(): void {
    [392, 523, 659, 784, 1047].forEach((f, i) => this.tone(f, i * 0.11, 0.4, 'triangle', 0.2));
  }
}
