import type { MoveInput } from '../core/game';

export type Action = 'view' | 'map' | 'album' | 'pause' | 'help' | 'mute' | 'step-forward' | 'step-back';

const ACTION_KEYS: Record<string, Action> = {
  KeyV: 'view',
  KeyM: 'map',
  KeyK: 'album',
  Tab: 'album',
  Escape: 'pause',
  KeyP: 'pause',
  KeyH: 'help',
  KeyN: 'mute',
};

/** Keyboard + touch joystick input. */
export class Input {
  private readonly down = new Set<string>();
  private readonly listeners: ((a: Action) => void)[] = [];
  private joy = { x: 0, y: 0, active: false, id: -1, ox: 0, oy: 0 };
  private runTouch = false;
  enabled = true;

  constructor(private readonly root: HTMLElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => this.down.clear());
    this.setupTouch();
  }

  onAction(fn: (a: Action) => void): void {
    this.listeners.push(fn);
  }

  private emit(a: Action): void {
    for (const l of this.listeners) l(a);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    const a = ACTION_KEYS[e.code];
    if (a) {
      e.preventDefault();
      if (!e.repeat) this.emit(a);
      return;
    }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    if (!e.repeat && (e.code === 'ArrowUp' || e.code === 'KeyW')) this.emit('step-forward');
    if (!e.repeat && (e.code === 'ArrowDown' || e.code === 'KeyS')) this.emit('step-back');
    this.down.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.down.delete(e.code);
  };

  private setupTouch(): void {
    const pad = document.createElement('div');
    pad.className = 'joystick';
    pad.innerHTML = '<div class="joy-base"><div class="joy-knob"></div></div>';
    const run = document.createElement('button');
    run.className = 'run-btn';
    run.textContent = '🏃';
    run.setAttribute('aria-label', 'Koş');
    this.root.append(pad, run);
    const knob = pad.querySelector('.joy-knob') as HTMLElement;
    const base = pad.querySelector('.joy-base') as HTMLElement;
    const R = 50;
    pad.addEventListener('pointerdown', (e) => {
      this.joy = { x: 0, y: 0, active: true, id: e.pointerId, ox: e.clientX, oy: e.clientY };
      pad.setPointerCapture(e.pointerId);
      const r = pad.getBoundingClientRect();
      base.style.left = `${e.clientX - r.left}px`;
      base.style.top = `${e.clientY - r.top}px`;
      pad.classList.add('active');
      this.emit('step-forward');
    });
    pad.addEventListener('pointermove', (e) => {
      if (!this.joy.active || e.pointerId !== this.joy.id) return;
      let dx = e.clientX - this.joy.ox;
      let dy = e.clientY - this.joy.oy;
      const d = Math.hypot(dx, dy);
      if (d > R) {
        dx = (dx / d) * R;
        dy = (dy / d) * R;
      }
      this.joy.x = dx / R;
      this.joy.y = dy / R;
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
    });
    const end = () => {
      this.joy.active = false;
      this.joy.x = this.joy.y = 0;
      knob.style.transform = '';
      pad.classList.remove('active');
    };
    pad.addEventListener('pointerup', end);
    pad.addEventListener('pointercancel', end);
    run.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.runTouch = !this.runTouch;
      run.classList.toggle('on', this.runTouch);
    });
  }

  read(): MoveInput {
    if (!this.enabled) return { forward: 0, turn: 0, run: false };
    const k = (c: string) => this.down.has(c);
    let forward = (k('ArrowUp') || k('KeyW') ? 1 : 0) - (k('ArrowDown') || k('KeyS') ? 1 : 0);
    let turn = (k('ArrowRight') || k('KeyD') ? 1 : 0) - (k('ArrowLeft') || k('KeyA') ? 1 : 0);
    if (this.joy.active) {
      const dz = (v: number) => (Math.abs(v) < 0.18 ? 0 : v);
      forward = forward || -dz(this.joy.y);
      turn = turn || dz(this.joy.x) * 0.9;
    }
    return { forward, turn, run: k('ShiftLeft') || k('ShiftRight') || this.runTouch };
  }

  /** For tests and the Street View controller. */
  isDown(code: string): boolean {
    return this.down.has(code);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }
}
