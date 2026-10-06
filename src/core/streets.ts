import { closestOnSegment, Projection, wrapAngle } from './geo';
import type { Rng } from './rng';
import type { AreaData, StreetKind, Vec2 } from './types';

/** Half width (metres) of the walkable corridor around each street centreline, sidewalks included. */
export const HALF_WIDTH: Record<StreetKind, number> = {
  primary: 9,
  secondary: 7.5,
  tertiary: 6.5,
  residential: 5,
  minor: 4.5,
  service: 3.5,
  pedestrian: 4,
  footway: 2.2,
  steps: 2,
};

/** Half width of the drivable asphalt (0 = pedestrian only). */
export const ROAD_HALF_WIDTH: Record<StreetKind, number> = {
  primary: 6.5,
  secondary: 5,
  tertiary: 4.2,
  residential: 3,
  minor: 2.8,
  service: 2.4,
  pedestrian: 0,
  footway: 0,
  steps: 0,
};

export interface StreetNode {
  x: number;
  y: number;
  segs: number[];
}

export interface Segment {
  id: number;
  a: number;
  b: number;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  len: number;
  hw: number;
  kind: StreetKind;
  name: string | null;
  bridge: boolean;
  /** Belongs to the largest connected component (walkable). */
  main: boolean;
  block: number;
}

export interface Block {
  id: number;
  segs: number[];
  name: string | null;
  length: number;
  samples: number[];
  main: boolean;
}

export interface Sample {
  id: number;
  x: number;
  y: number;
  block: number;
}

export interface NamedStreet {
  name: string;
  blocks: number[];
  length: number;
  sampleCount: number;
}

export interface NearestHit {
  seg: Segment;
  x: number;
  y: number;
  t: number;
  d: number;
}

const SNAP = 1.0;
const GRID = 20;
export const SAMPLE_SPACING = 10;

class Grid<T> {
  private readonly cells = new Map<number, T[]>();
  constructor(private readonly size: number) {}

  private key(ix: number, iy: number): number {
    return (ix + 32768) * 65536 + (iy + 32768);
  }

  insertBox(item: T, x0: number, y0: number, x1: number, y1: number): void {
    const s = this.size;
    for (let ix = Math.floor(x0 / s); ix <= Math.floor(x1 / s); ix++)
      for (let iy = Math.floor(y0 / s); iy <= Math.floor(y1 / s); iy++) {
        const k = this.key(ix, iy);
        let c = this.cells.get(k);
        if (!c) this.cells.set(k, (c = []));
        c.push(item);
      }
  }

  query(x: number, y: number, r: number, out: Set<T>): Set<T> {
    const s = this.size;
    for (let ix = Math.floor((x - r) / s); ix <= Math.floor((x + r) / s); ix++)
      for (let iy = Math.floor((y - r) / s); iy <= Math.floor((y + r) / s); iy++) {
        const c = this.cells.get(this.key(ix, iy));
        if (c) for (const it of c) out.add(it);
      }
    return out;
  }
}

export class StreetNetwork {
  readonly nodes: StreetNode[] = [];
  readonly segs: Segment[] = [];
  readonly blocks: Block[] = [];
  readonly samples: Sample[] = [];
  readonly streets = new Map<string, NamedStreet>();
  /** Total walkable length in metres. */
  totalLength = 0;
  /** Dead-end node indices on the walkable network. */
  readonly deadEnds: number[] = [];
  readonly bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

  private readonly segGrid = new Grid<number>(GRID);
  private readonly sampleGrid = new Grid<number>(GRID);
  private readonly walkSegs: number[] = [];
  private readonly walkCum: number[] = [];

  constructor(area: AreaData, readonly proj: Projection) {
    this.buildGraph(area);
    this.markMainComponent();
    this.buildBlocks();
    this.buildIndex();
  }

  private buildGraph(area: AreaData): void {
    const nodeGrid = new Map<string, number[]>();
    const findOrAdd = (x: number, y: number): number => {
      const cx = Math.floor(x / 2);
      const cy = Math.floor(y / 2);
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++) {
          const c = nodeGrid.get(`${cx + dx},${cy + dy}`);
          if (!c) continue;
          for (const n of c) {
            const nd = this.nodes[n];
            if (Math.abs(nd.x - x) <= SNAP && Math.abs(nd.y - y) <= SNAP) return n;
          }
        }
      const id = this.nodes.length;
      this.nodes.push({ x, y, segs: [] });
      const k = `${cx},${cy}`;
      const c = nodeGrid.get(k);
      if (c) c.push(id);
      else nodeGrid.set(k, [id]);
      return id;
    };
    const seen = new Set<string>();
    for (const st of area.streets) {
      let prev = -1;
      for (const ll of st.c) {
        const p = this.proj.toLocal(ll);
        const n = findOrAdd(p.x, p.y);
        if (prev >= 0 && n !== prev) {
          const key = prev < n ? `${prev}-${n}` : `${n}-${prev}`;
          if (!seen.has(key)) {
            seen.add(key);
            const A = this.nodes[prev];
            const B = this.nodes[n];
            const seg: Segment = {
              id: this.segs.length,
              a: prev,
              b: n,
              ax: A.x,
              ay: A.y,
              bx: B.x,
              by: B.y,
              len: Math.hypot(B.x - A.x, B.y - A.y),
              hw: HALF_WIDTH[st.k] ?? 4,
              kind: st.k,
              name: st.n,
              bridge: !!st.b,
              main: false,
              block: -1,
            };
            this.segs.push(seg);
            A.segs.push(seg.id);
            B.segs.push(seg.id);
          }
        }
        prev = n;
      }
    }
  }

  private markMainComponent(): void {
    const comp = new Int32Array(this.nodes.length).fill(-1);
    const lengths: number[] = [];
    for (let s = 0; s < this.nodes.length; s++) {
      if (comp[s] >= 0 || this.nodes[s].segs.length === 0) continue;
      const c = lengths.length;
      let len = 0;
      const stack = [s];
      comp[s] = c;
      while (stack.length) {
        const n = stack.pop()!;
        for (const si of this.nodes[n].segs) {
          const seg = this.segs[si];
          const o = seg.a === n ? seg.b : seg.a;
          if (seg.a === n) len += seg.len;
          if (comp[o] < 0) {
            comp[o] = c;
            stack.push(o);
          }
        }
      }
      lengths.push(len);
    }
    let best = 0;
    for (let i = 1; i < lengths.length; i++) if (lengths[i] > lengths[best]) best = i;
    for (const seg of this.segs) seg.main = comp[seg.a] === best;
  }

  private buildBlocks(): void {
    const deg = (n: number) => this.nodes[n].segs.length;
    for (const start of this.segs) {
      if (start.block >= 0) continue;
      const id = this.blocks.length;
      const chain: number[] = [start.id];
      start.block = id;
      // extend from both ends through degree-2 nodes while the name stays the same
      for (const endNode of [start.a, start.b]) {
        let node = endNode;
        let cur = start;
        for (;;) {
          if (deg(node) !== 2) break;
          const nextId = this.nodes[node].segs[0] === cur.id ? this.nodes[node].segs[1] : this.nodes[node].segs[0];
          const next = this.segs[nextId];
          if (next.block >= 0 || next.name !== start.name) break;
          next.block = id;
          chain.push(nextId);
          node = next.a === node ? next.b : next.a;
          cur = next;
        }
      }
      const length = chain.reduce((s, i) => s + this.segs[i].len, 0);
      const block: Block = { id, segs: chain, name: start.name, length, samples: [], main: start.main };
      this.blocks.push(block);
      // place samples every SAMPLE_SPACING metres along each segment of the block
      for (const si of chain) {
        const seg = this.segs[si];
        const n = Math.max(1, Math.round(seg.len / SAMPLE_SPACING));
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n;
          const smp: Sample = {
            id: this.samples.length,
            x: seg.ax + (seg.bx - seg.ax) * t,
            y: seg.ay + (seg.by - seg.ay) * t,
            block: id,
          };
          this.samples.push(smp);
          block.samples.push(smp.id);
        }
      }
      if (block.main && block.name) {
        let st = this.streets.get(block.name);
        if (!st) this.streets.set(block.name, (st = { name: block.name, blocks: [], length: 0, sampleCount: 0 }));
        st.blocks.push(id);
        st.length += length;
        st.sampleCount += block.samples.length;
      }
    }
  }

  private buildIndex(): void {
    let cum = 0;
    for (const seg of this.segs) {
      const b = this.bounds;
      b.minX = Math.min(b.minX, seg.ax, seg.bx);
      b.maxX = Math.max(b.maxX, seg.ax, seg.bx);
      b.minY = Math.min(b.minY, seg.ay, seg.by);
      b.maxY = Math.max(b.maxY, seg.ay, seg.by);
      if (!seg.main) continue;
      const hw = seg.hw;
      this.segGrid.insertBox(
        seg.id,
        Math.min(seg.ax, seg.bx) - hw,
        Math.min(seg.ay, seg.by) - hw,
        Math.max(seg.ax, seg.bx) + hw,
        Math.max(seg.ay, seg.by) + hw,
      );
      cum += seg.len;
      this.walkSegs.push(seg.id);
      this.walkCum.push(cum);
    }
    this.totalLength = cum;
    for (const smp of this.samples) {
      if (!this.blocks[smp.block].main) continue;
      this.sampleGrid.insertBox(smp.id, smp.x, smp.y, smp.x, smp.y);
    }
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      if (n.segs.length === 1 && this.segs[n.segs[0]].main && this.segs[n.segs[0]].kind !== 'footway') this.deadEnds.push(i);
    }
  }

  get walkableSampleCount(): number {
    let n = 0;
    for (const b of this.blocks) if (b.main) n += b.samples.length;
    return n;
  }

  /** Nearest walkable segment within maxDist (metres), or null. */
  nearest(p: Vec2, maxDist = 30): NearestHit | null {
    const ids = this.segGrid.query(p.x, p.y, maxDist, new Set());
    let best: NearestHit | null = null;
    for (const id of ids) {
      const seg = this.segs[id];
      const c = closestOnSegment(p, { x: seg.ax, y: seg.ay }, { x: seg.bx, y: seg.by });
      const d = Math.hypot(p.x - c.x, p.y - c.y);
      if (d <= maxDist && (!best || d < best.d)) best = { seg, x: c.x, y: c.y, t: c.t, d };
    }
    return best;
  }

  /** True when p lies inside some walkable corridor. */
  inCorridor(p: Vec2): boolean {
    const ids = this.segGrid.query(p.x, p.y, 0, new Set());
    for (const id of ids) {
      const seg = this.segs[id];
      const c = closestOnSegment(p, { x: seg.ax, y: seg.ay }, { x: seg.bx, y: seg.by });
      if ((p.x - c.x) ** 2 + (p.y - c.y) ** 2 <= seg.hw * seg.hw) return true;
    }
    return false;
  }

  /**
   * Move from `from` towards `to`, staying inside the walkable corridors. Movement that would leave
   * the corridors slides along their edges instead.
   */
  constrain(from: Vec2, to: Vec2): Vec2 {
    const d = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.max(1, Math.ceil(d / 1.0));
    let cur = { x: from.x, y: from.y };
    for (let i = 1; i <= steps; i++) {
      const target = { x: cur.x + (to.x - from.x) / steps, y: cur.y + (to.y - from.y) / steps };
      cur = this.constrainStep(cur, target);
    }
    return cur;
  }

  private constrainStep(from: Vec2, to: Vec2): Vec2 {
    if (this.inCorridor(to)) return to;
    const ids = this.segGrid.query(to.x, to.y, 12, new Set());
    let best: Vec2 | null = null;
    let bestD = Infinity;
    for (const id of ids) {
      const seg = this.segs[id];
      const c = closestOnSegment(to, { x: seg.ax, y: seg.ay }, { x: seg.bx, y: seg.by });
      const dx = to.x - c.x;
      const dy = to.y - c.y;
      const dd = Math.hypot(dx, dy);
      const k = (seg.hw * 0.999) / dd;
      const q = { x: c.x + dx * k, y: c.y + dy * k };
      const e = Math.hypot(to.x - q.x, to.y - q.y);
      if (e < bestD) {
        bestD = e;
        best = q;
      }
    }
    if (!best) return from;
    // never let a single slide step move further than the requested step
    const req = Math.hypot(to.x - from.x, to.y - from.y);
    const got = Math.hypot(best.x - from.x, best.y - from.y);
    if (got > req * 1.5 + 0.05) return from;
    return best;
  }

  /** Snap an arbitrary point onto the nearest walkable centreline (searching wider if needed). */
  snap(p: Vec2): Vec2 {
    for (const r of [30, 120, 500, 3000]) {
      const h = this.nearest(p, r);
      if (h) return { x: h.x, y: h.y };
    }
    return { x: p.x, y: p.y };
  }

  /** Uniformly random point on the walkable network (by length), optionally offset sideways. */
  randomPoint(rng: Rng, lateral = 0): { x: number; y: number; seg: Segment } {
    const r = rng() * this.totalLength;
    let lo = 0;
    let hi = this.walkCum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.walkCum[mid] < r) lo = mid + 1;
      else hi = mid;
    }
    const seg = this.segs[this.walkSegs[lo]];
    return this.pointOnSegment(seg, rng(), (rng() * 2 - 1) * lateral * seg.hw);
  }

  pointOnSegment(seg: Segment, t: number, offset = 0): { x: number; y: number; seg: Segment } {
    const nx = -(seg.by - seg.ay) / (seg.len || 1);
    const ny = (seg.bx - seg.ax) / (seg.len || 1);
    return { x: seg.ax + (seg.bx - seg.ax) * t + nx * offset, y: seg.ay + (seg.by - seg.ay) * t + ny * offset, seg };
  }

  /** Sample ids within radius r of p (walkable network only). */
  samplesNear(p: Vec2, r: number, out: number[] = []): number[] {
    const ids = this.sampleGrid.query(p.x, p.y, r, new Set());
    for (const id of ids) {
      const s = this.samples[id];
      if ((s.x - p.x) ** 2 + (s.y - p.y) ** 2 <= r * r) out.push(id);
    }
    return out;
  }

  /** Compass heading of a segment, flipped to be closest to `heading`. */
  alignedHeading(seg: Segment, heading: number): number {
    const h = Math.atan2(seg.bx - seg.ax, seg.by - seg.ay);
    const d = wrapAngle(h - heading);
    return Math.abs(d) <= Math.PI / 2 ? h : wrapAngle(h + Math.PI);
  }
}
