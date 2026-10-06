import type { Game } from '../core/game';
import { isVisited } from '../core/progress';
import type { Vec2 } from '../core/types';

export const QUEST_COLORS = ['#ffd54f', '#4dd0e1', '#f06292'];

interface View {
  cx: number;
  cy: number;
  /** px per metre */
  scale: number;
  /** rotation (radians) applied so the player's heading points up */
  rot: number;
  w: number;
  h: number;
}

/** Shared 2D map renderer used by both the corner minimap and the full-screen map. */
export class MapRenderer {
  private readonly buildingRings: Vec2[][];
  private readonly bbox: { x0: number; y0: number; x1: number; y1: number }[];

  constructor(private readonly game: Game) {
    this.buildingRings = game.area.buildings.map((b) => b.c.map((p) => game.proj.toLocal(p)));
    this.bbox = this.buildingRings.map((r) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of r) {
        x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
      }
      return { x0, y0, x1, y1 };
    });
  }

  draw(ctx: CanvasRenderingContext2D, v: View, opts: { full?: boolean } = {}): void {
    const g = this.game;
    const { w, h, scale } = v;
    ctx.save();
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = opts.full ? '#1b2033' : 'rgba(22,27,44,0.92)';
    ctx.fillRect(0, 0, w, h);
    ctx.translate(w / 2, h / 2);
    ctx.rotate(v.rot);
    ctx.scale(scale, -scale);
    ctx.translate(-v.cx, -v.cy);
    const r = Math.hypot(w, h) / 2 / scale;
    const inView = (x0: number, y0: number, x1: number, y1: number) =>
      x1 >= v.cx - r && x0 <= v.cx + r && y1 >= v.cy - r && y0 <= v.cy + r;

    // boundary fill
    ctx.beginPath();
    g.boundary.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.fillStyle = 'rgba(124,77,255,0.08)';
    ctx.fill();

    // buildings
    ctx.fillStyle = 'rgba(160,170,200,0.22)';
    ctx.beginPath();
    this.buildingRings.forEach((ring, i) => {
      const b = this.bbox[i];
      if (!inView(b.x0, b.y0, b.x1, b.y1)) return;
      ring.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
    });
    ctx.fill();

    // streets (unexplored = dim)
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(150,160,190,0.35)';
    for (const s of g.net.segs) {
      if (!inView(Math.min(s.ax, s.bx), Math.min(s.ay, s.by), Math.max(s.ax, s.bx), Math.max(s.ay, s.by))) continue;
      ctx.lineWidth = Math.max(s.hw * 1.1, 2.2 / scale);
      ctx.beginPath();
      ctx.moveTo(s.ax, s.ay);
      ctx.lineTo(s.bx, s.by);
      ctx.stroke();
    }
    // explored samples
    ctx.fillStyle = '#7ef0c5';
    ctx.beginPath();
    const rad = Math.max(5.5, 2.5 / scale);
    for (const smp of g.net.samples) {
      if (!isVisited(g.progress, smp.id)) continue;
      if (Math.abs(smp.x - v.cx) > r || Math.abs(smp.y - v.cy) > r) continue;
      ctx.moveTo(smp.x + rad, smp.y);
      ctx.arc(smp.x, smp.y, rad, 0, Math.PI * 2);
    }
    ctx.fill();

    // boundary line
    ctx.setLineDash([8 / scale, 6 / scale]);
    ctx.strokeStyle = 'rgba(179,136,255,0.9)';
    ctx.lineWidth = 2 / scale;
    ctx.beginPath();
    g.boundary.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);

    // route guide to the tracked quest
    if (g.guide && g.guide.path.length > 1) {
      ctx.strokeStyle = QUEST_COLORS[g.guide.index % QUEST_COLORS.length];
      ctx.lineWidth = 3 / scale;
      ctx.setLineDash([6 / scale, 4 / scale]);
      ctx.beginPath();
      g.guide.path.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // items
    const compass = (g.powerups.pusula ?? 0) > 0;
    for (const it of g.items) {
      if (Math.abs(it.x - v.cx) > r || Math.abs(it.y - v.cy) > r) continue;
      const rare = it.def.rarity === 'nadir' || it.def.rarity === 'efsane';
      if (it.def.kind === 'record' && !compass) continue;
      if (opts.full && !rare && it.def.kind !== 'powerup') continue;
      const s = (rare ? 3.2 : 2.2) / scale;
      ctx.fillStyle = it.def.kind === 'record' ? '#ff4081' : it.def.color;
      ctx.beginPath();
      ctx.arc(it.x, it.y, s, 0, Math.PI * 2);
      ctx.fill();
      if (rare) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1 / scale;
        ctx.stroke();
      }
    }
    // cats
    for (const c of g.cats) {
      if (Math.abs(c.x - v.cx) > r || Math.abs(c.y - v.cy) > r) continue;
      ctx.fillStyle = g.progress.fed[c.def.id] ? '#ff80ab' : '#ffb74d';
      ctx.strokeStyle = '#1b2033';
      ctx.lineWidth = 1.2 / scale;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 3.6 / scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();

    // quest targets (screen space, clamped to the edge when off-map)
    const toScreen = (p: Vec2) => {
      const dx = (p.x - v.cx) * scale;
      const dy = -(p.y - v.cy) * scale;
      const c = Math.cos(v.rot);
      const s = Math.sin(v.rot);
      return { x: w / 2 + dx * c - dy * s, y: h / 2 + dx * s + dy * c };
    };
    g.progress.quests.forEach((q, i) => {
      const t = g.questTargetPoint(q);
      if (!t) return;
      let sp = toScreen(t);
      const m = 10;
      const off = sp.x < m || sp.y < m || sp.x > w - m || sp.y > h - m;
      if (off) {
        const dx = sp.x - w / 2;
        const dy = sp.y - h / 2;
        const k = Math.min((w / 2 - m) / Math.abs(dx || 1e-6), (h / 2 - m) / Math.abs(dy || 1e-6));
        sp = { x: w / 2 + dx * k, y: h / 2 + dy * k };
      }
      ctx.save();
      ctx.translate(sp.x, sp.y);
      ctx.fillStyle = QUEST_COLORS[i % QUEST_COLORS.length];
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 1.5;
      if (off) {
        ctx.rotate(Math.atan2(sp.y - h / 2, sp.x - w / 2));
        ctx.beginPath();
        ctx.moveTo(8, 0);
        ctx.lineTo(-5, -6);
        ctx.lineTo(-5, 6);
        ctx.closePath();
      } else {
        ctx.rotate(Math.PI / 4);
        ctx.beginPath();
        ctx.rect(-5, -5, 10, 10);
      }
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    });

    // player arrow
    const ps = toScreen(g.player);
    ctx.save();
    ctx.translate(ps.x, ps.y);
    ctx.rotate(g.player.heading + v.rot);
    ctx.fillStyle = '#ff5252';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(6.5, 7);
    ctx.lineTo(0, 3.5);
    ctx.lineTo(-6.5, 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

export class Minimap {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly map: MapRenderer;
  zoom = 1.1;
  rotate = true;

  constructor(parent: HTMLElement, private readonly game: Game) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'minimap';
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.map = new MapRenderer(game);
  }

  draw(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (this.canvas.width !== Math.round(w * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const p = this.game.player;
    this.map.draw(this.ctx, { cx: p.x, cy: p.y, scale: this.zoom, rot: this.rotate ? -p.heading : 0, w, h });
  }
}

/** Full-screen north-up map with drag and wheel/pinch zoom. */
export class BigMap {
  readonly el: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly map: MapRenderer;
  private cx = 0;
  private cy = 0;
  private scale = 0.5;
  private drag: { x: number; y: number } | null = null;
  open = false;

  constructor(parent: HTMLElement, private readonly game: Game) {
    this.el = document.createElement('div');
    this.el.className = 'bigmap hidden';
    this.canvas = document.createElement('canvas');
    this.el.appendChild(this.canvas);
    const legend = document.createElement('div');
    legend.className = 'bigmap-legend';
    legend.innerHTML = `<b>${game.area.fullName}</b><span><i style="background:#7ef0c5"></i>keşfedildi</span><span><i style="background:rgba(150,160,190,.6)"></i>keşfedilmedi</span><span><i style="background:#ffb74d"></i>kedi</span><span><i style="background:#ff80ab"></i>dost kedi</span><span><i class="dia"></i>görev</span><span class="muted">M / Esc: kapat · sürükle & tekerlek: gezin</span>`;
    this.el.appendChild(legend);
    parent.appendChild(this.el);
    this.ctx = this.canvas.getContext('2d')!;
    this.map = new MapRenderer(game);
    this.canvas.addEventListener('pointerdown', (e) => {
      this.drag = { x: e.clientX, y: e.clientY };
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      this.cx -= (e.clientX - this.drag.x) / this.scale;
      this.cy += (e.clientY - this.drag.y) / this.scale;
      this.drag = { x: e.clientX, y: e.clientY };
    });
    this.canvas.addEventListener('pointerup', () => (this.drag = null));
    this.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.scale = Math.min(6, Math.max(0.15, this.scale * Math.exp(-e.deltaY * 0.0015)));
      },
      { passive: false },
    );
  }

  toggle(force?: boolean): void {
    this.open = force ?? !this.open;
    this.el.classList.toggle('hidden', !this.open);
    if (this.open) {
      const b = this.game.boundary;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of b) {
        x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
      }
      this.cx = (x0 + x1) / 2;
      this.cy = (y0 + y1) / 2;
      const w = this.el.clientWidth || window.innerWidth;
      const h = this.el.clientHeight || window.innerHeight;
      this.scale = Math.min(w / (x1 - x0 + 200), h / (y1 - y0 + 200));
    }
  }

  draw(): void {
    if (!this.open) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.el.clientWidth;
    const h = this.el.clientHeight;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.map.draw(this.ctx, { cx: this.cx, cy: this.cy, scale: this.scale, rot: 0, w, h }, { full: true });
  }
}
