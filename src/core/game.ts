import { checkBadges, type BadgeDef } from './badges';
import {
  CATS,
  COMBO_WINDOW,
  comboMultiplier,
  ITEM_BY_ID,
  ITEMS,
  levelFor,
  MAX_MAMA,
  POWERUP_DURATION,
  RECORD_TITLES,
  type CatDef,
  type ItemDef,
} from './content';
import { Projection, wrapAngle } from './geo';
import {
  isVisited,
  loadProgress,
  markVisited,
  saveProgress,
  type KeyValueStore,
  type Progress,
} from './progress';
import { advanceQuests, fillQuests, type GamePoi, type QuestContext, type QuestSignal, type QuestState } from './quests';
import { hashString, mulberry32, pick, type Rng, weightedPick } from './rng';
import { StreetNetwork } from './streets';
import type { AreaData, Vec2 } from './types';

export interface GameConfig {
  /** Distance at which items are picked up. */
  pickupRadius: number;
  /** Street samples within this distance count as explored. */
  exploreRadius: number;
  feedRadius: number;
  poiRadius: number;
  /** Metres of street per spawned item. */
  itemSpacing: number;
  walkSpeed: number;
  runSpeed: number;
  /** radians / second */
  turnSpeed: number;
}

export const CONFIG_3D: GameConfig = {
  pickupRadius: 2.6,
  exploreRadius: 9,
  feedRadius: 4,
  poiRadius: 22,
  itemSpacing: 55,
  walkSpeed: 6,
  runSpeed: 10,
  turnSpeed: 2.4,
};

/** Street View moves in ~10 m panorama hops, so everything is more forgiving. */
export const CONFIG_SV: GameConfig = {
  ...CONFIG_3D,
  pickupRadius: 13,
  exploreRadius: 15,
  feedRadius: 15,
  poiRadius: 30,
  itemSpacing: 45,
};

export interface MoveInput {
  /** -1..1 */
  forward: number;
  /** -1..1, positive = clockwise (right) */
  turn: number;
  run: boolean;
}

export interface WorldItem {
  uid: number;
  def: ItemDef;
  x: number;
  y: number;
  /** animation phase */
  phase: number;
  record?: number;
}

export interface Cat {
  def: CatDef;
  x: number;
  y: number;
  heading: number;
  homeX: number;
  homeY: number;
  targetX: number;
  targetY: number;
  idle: number;
  moving: boolean;
  /** seconds left following the player after being fed */
  follow: number;
  /** game time when the cat may be fed again */
  hungryAt: number;
  lastNag: number;
}

export type ToastKind = 'info' | 'good' | 'rare' | 'badge' | 'quest' | 'warn';

export type GameEvent =
  | { type: 'collect'; item: WorldItem; points: number; mult: number }
  | { type: 'feed'; cat: Cat; points: number; first: boolean }
  | { type: 'toast'; text: string; kind: ToastKind; emoji?: string }
  | { type: 'badge'; badge: BadgeDef }
  | { type: 'level'; title: string }
  | { type: 'quest-done'; quest: QuestState }
  | { type: 'quest-new'; quest: QuestState }
  | { type: 'street-done'; name: string; points: number }
  | { type: 'poi'; poi: GamePoi }
  | { type: 'powerup'; id: string }
  | { type: 'explore'; points: number };

export interface GameOptions {
  config?: GameConfig;
  store?: KeyValueStore | null;
  /** Randomness for item spawns (deterministic placements always derive from the area name). */
  rng?: Rng;
  /** Area save key; defaults to the area name. */
  saveId?: string;
}

const RECORD_COUNT = RECORD_TITLES.length;

export class Game {
  readonly proj: Projection;
  readonly net: StreetNetwork;
  readonly pois: GamePoi[];
  readonly boundary: Vec2[];
  readonly progress: Progress;
  config: GameConfig;
  readonly player = { x: 0, y: 0, heading: 0, speed: 0, moving: false };
  readonly items: WorldItem[] = [];
  readonly cats: Cat[] = [];
  readonly combo = { chain: 0, timer: 0, mult: 1 };
  readonly powerups: Record<string, number> = {};
  time = 0;
  currentStreet: string | null = null;
  /** Sample ids marked visited during the last update (for minimap fog). */
  readonly freshSamples: number[] = [];

  private readonly listeners: ((e: GameEvent) => void)[] = [];
  private readonly rng: Rng;
  private readonly store: KeyValueStore | null;
  private readonly streetVisits = new Map<string, number>();
  private readonly sampleStreet: (string | null)[] = [];
  private uid = 1;
  private spawnTimer = 0;
  private tickTimer = 0;
  private saveTimer = 0;
  private readonly targetItems: number;
  private readonly recordSpots: Vec2[] = [];
  private readonly metroPois: GamePoi[];

  constructor(readonly area: AreaData, opts: GameOptions = {}) {
    this.config = opts.config ?? CONFIG_3D;
    this.rng = opts.rng ?? mulberry32((Math.random() * 2 ** 32) >>> 0);
    this.store = opts.store ?? null;
    this.proj = new Projection(area.center);
    this.net = new StreetNetwork(area, this.proj);
    this.boundary = area.boundary.map((p) => this.proj.toLocal(p));
    this.pois = area.pois.map((p, index) => ({ index, name: p.n, type: p.t, ...this.proj.toLocal(p.p) }));
    this.metroPois = this.pois.filter((p) => p.type === 'metro');
    this.progress = loadProgress(this.store, opts.saveId ?? area.name, this.net.samples.length);

    for (const smp of this.net.samples) this.sampleStreet.push(this.net.blocks[smp.block].main ? this.net.blocks[smp.block].name : null);
    for (let i = 0; i < this.net.samples.length; i++) {
      const s = this.sampleStreet[i];
      if (s && isVisited(this.progress, i)) this.streetVisits.set(s, (this.streetVisits.get(s) ?? 0) + 1);
    }

    this.targetItems = Math.round(Math.min(900, Math.max(30, this.net.totalLength / this.config.itemSpacing)));
    this.placeStart();
    this.placeRecords();
    this.placeCats();
    this.fillItems();
    this.seedStarterTrail();
    const added = fillQuests(this.questCtx());
    void added;
  }

  on(fn: (e: GameEvent) => void): () => void {
    this.listeners.push(fn);
    return () => {
      const i = this.listeners.indexOf(fn);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  private emit(e: GameEvent): void {
    for (const l of this.listeners) l(e);
  }

  // ---------------------------------------------------------------- setup

  private placeStart(): void {
    const saved = this.progress.player;
    if (saved && this.net.inCorridor(saved)) {
      this.player.x = saved.x;
      this.player.y = saved.y;
      this.player.heading = saved.h;
      return;
    }
    // start on a decent street close to the centre of the neighbourhood
    let best: { x: number; y: number; h: number; score: number } | null = null;
    for (const seg of this.net.segs) {
      if (!seg.main || seg.kind === 'footway' || seg.kind === 'steps' || seg.kind === 'service') continue;
      const mx = (seg.ax + seg.bx) / 2;
      const my = (seg.ay + seg.by) / 2;
      const d = Math.hypot(mx, my) - (seg.kind === 'residential' || seg.kind === 'tertiary' ? 40 : 0);
      if (!best || d < best.score) best = { x: mx, y: my, h: Math.atan2(seg.bx - seg.ax, seg.by - seg.ay), score: d };
    }
    const s = best ?? { ...this.net.randomPoint(this.rng), h: 0 };
    this.player.x = s.x;
    this.player.y = s.y;
    this.player.heading = s.h;
  }

  /** Farthest-point sampling of candidate points for an even spread. */
  private spread(cands: Vec2[], n: number, rng: Rng): Vec2[] {
    if (!cands.length) return [];
    const out: Vec2[] = [pick(rng, cands)];
    const dmin = cands.map((c) => Math.hypot(c.x - out[0].x, c.y - out[0].y));
    while (out.length < Math.min(n, cands.length)) {
      let bi = 0;
      for (let i = 1; i < cands.length; i++) if (dmin[i] > dmin[bi]) bi = i;
      const c = cands[bi];
      out.push(c);
      for (let i = 0; i < cands.length; i++) dmin[i] = Math.min(dmin[i], Math.hypot(cands[i].x - c.x, cands[i].y - c.y));
    }
    return out;
  }

  private placeRecords(): void {
    const rng = mulberry32(hashString(`${this.area.name}:records`));
    const cands: Vec2[] = this.net.deadEnds.map((n) => {
      const node = this.net.nodes[n];
      const seg = this.net.segs[node.segs[0]];
      const ox = seg.a === n ? seg.bx : seg.ax;
      const oy = seg.a === n ? seg.by : seg.ay;
      const k = Math.min(3, seg.len / 2) / (seg.len || 1);
      return { x: node.x + (ox - node.x) * k, y: node.y + (oy - node.y) * k };
    });
    while (cands.length < RECORD_COUNT * 2) cands.push(this.net.randomPoint(rng));
    this.recordSpots.push(...this.spread(cands, RECORD_COUNT, rng));
    this.recordSpots.forEach((p, i) => {
      if (!this.progress.records.includes(i)) this.addItem(ITEM_BY_ID.plak, p.x, p.y, i);
    });
  }

  private placeCats(): void {
    const rng = mulberry32(hashString(`${this.area.name}:cats`));
    const cands: Vec2[] = [];
    for (let i = 0; i < 300; i++) {
      const p = this.net.randomPoint(rng, 0.6);
      if (p.seg.kind !== 'primary' && p.seg.kind !== 'secondary') cands.push(p);
    }
    const spots = this.spread(cands, CATS.length, rng);
    spots.forEach((p, i) => {
      const def = CATS[i];
      this.cats.push({
        def,
        x: p.x,
        y: p.y,
        heading: rng() * Math.PI * 2,
        homeX: p.x,
        homeY: p.y,
        targetX: p.x,
        targetY: p.y,
        idle: rng() * 4,
        moving: false,
        follow: 0,
        hungryAt: 0,
        lastNag: -99,
      });
    });
  }

  private addItem(def: ItemDef, x: number, y: number, record?: number): WorldItem {
    const it: WorldItem = { uid: this.uid++, def, x, y, phase: this.rng() * Math.PI * 2, record };
    this.items.push(it);
    return it;
  }

  private randomItemDef(): ItemDef {
    return weightedPick(this.rng, ITEMS, (d) => d.weight);
  }

  /** Spawns one random item somewhere on the network, at least `minDist` from the player. */
  spawnRandomItem(minDist = 0): WorldItem | null {
    const def = this.randomItemDef();
    for (let attempt = 0; attempt < 12; attempt++) {
      let p: Vec2 | null = null;
      if (def.nearPoi && this.rng() < 0.55) {
        const cands = this.pois.filter((q) => def.nearPoi!.includes(q.type));
        if (cands.length) {
          const poi = pick(this.rng, cands);
          const a = this.rng() * Math.PI * 2;
          const r = 4 + this.rng() * 22;
          const hit = this.net.nearest({ x: poi.x + Math.cos(a) * r, y: poi.y + Math.sin(a) * r }, 60);
          if (hit) p = this.net.pointOnSegment(hit.seg, hit.t, (this.rng() * 2 - 1) * 0.4 * hit.seg.hw);
        }
      }
      if (!p) p = this.net.randomPoint(this.rng, 0.45);
      if (Math.hypot(p.x - this.player.x, p.y - this.player.y) < minDist) continue;
      if (this.items.some((o) => Math.abs(o.x - p!.x) < 5 && Math.abs(o.y - p!.y) < 5)) continue;
      return this.addItem(def, p.x, p.y);
    }
    return null;
  }

  private regularItemCount(): number {
    let n = 0;
    for (const it of this.items) if (it.def.kind !== 'record') n++;
    return n;
  }

  private fillItems(): void {
    let guard = 0;
    while (this.regularItemCount() < this.targetItems && guard++ < this.targetItems * 3) this.spawnRandomItem(12);
  }

  /** A few easy pickups right in front of the player so the first seconds are rewarding. */
  private seedStarterTrail(): void {
    const near = this.net.samplesNear(this.player, 70);
    const f = { x: Math.sin(this.player.heading), y: Math.cos(this.player.heading) };
    const ahead = near
      .map((id) => this.net.samples[id])
      .filter((s) => {
        const dx = s.x - this.player.x;
        const dy = s.y - this.player.y;
        const d = Math.hypot(dx, dy);
        return d > 8 && (dx * f.x + dy * f.y) / d > 0.6;
      })
      .sort((a, b) => Math.hypot(a.x - this.player.x, a.y - this.player.y) - Math.hypot(b.x - this.player.x, b.y - this.player.y));
    const defs = [ITEM_BY_ID.simit, ITEM_BY_ID.cay, ITEM_BY_ID.simit, ITEM_BY_ID.lokum, ITEM_BY_ID.cay];
    for (let i = 0; i < Math.min(defs.length, ahead.length); i += 1) {
      const s = ahead[i];
      if (!this.items.some((o) => Math.hypot(o.x - s.x, o.y - s.y) < 4)) this.addItem(defs[i], s.x, s.y);
    }
  }

  // ---------------------------------------------------------------- queries

  get explorePct(): number {
    const total = this.net.walkableSampleCount;
    return total ? (this.progress.visitedCount / total) * 100 : 0;
  }

  get level() {
    return levelFor(this.progress.score);
  }

  streetVisited(name: string): number {
    return this.streetVisits.get(name) ?? 0;
  }

  speedMultiplier(): number {
    return (this.powerups.scooter ?? 0) > 0 ? 1.8 : 1;
  }

  /** Where the compass power-up points: nearest remaining record, else nearest rare item. */
  compassTarget(): WorldItem | null {
    let best: WorldItem | null = null;
    let bd = Infinity;
    for (const pass of ['record', 'rare'] as const) {
      for (const it of this.items) {
        const ok = pass === 'record' ? it.def.kind === 'record' : it.def.rarity === 'nadir' || it.def.rarity === 'efsane';
        if (!ok) continue;
        const d = Math.hypot(it.x - this.player.x, it.y - this.player.y);
        if (d < bd) {
          bd = d;
          best = it;
        }
      }
      if (best) return best;
    }
    return null;
  }

  questTargetPoint(q: QuestState): Vec2 | null {
    if (q.type === 'visit') {
      const p = this.pois[Number(q.target)];
      return p ? { x: p.x, y: p.y } : null;
    }
    if (q.type === 'street') {
      const st = this.net.streets.get(String(q.target));
      if (!st) return null;
      let best: Vec2 | null = null;
      let bd = Infinity;
      for (const b of st.blocks)
        for (const sid of this.net.blocks[b].samples) {
          if (isVisited(this.progress, sid)) continue;
          const s = this.net.samples[sid];
          const d = Math.hypot(s.x - this.player.x, s.y - this.player.y);
          if (d < bd) {
            bd = d;
            best = { x: s.x, y: s.y };
          }
        }
      return best;
    }
    return null;
  }

  private questCtx(): QuestContext {
    return {
      rng: this.rng,
      progress: this.progress,
      net: this.net,
      pois: this.pois,
      player: this.player,
      streetVisited: (n) => this.streetVisited(n),
      explorePct: () => this.explorePct,
      catCount: this.cats.length,
    };
  }

  // ---------------------------------------------------------------- scoring

  private addScore(points: number): void {
    const before = levelFor(this.progress.score).index;
    this.progress.score += points;
    const after = levelFor(this.progress.score);
    if (after.index > before) this.emit({ type: 'level', title: after.title });
  }

  private bumpCombo(): number {
    this.combo.chain = this.combo.timer > 0 ? this.combo.chain + 1 : 1;
    this.combo.timer = COMBO_WINDOW;
    const m = comboMultiplier(this.combo.chain);
    if (m > this.combo.mult) this.signal({ kind: 'combo', mult: m });
    this.combo.mult = m;
    if (m > this.progress.bestCombo) this.progress.bestCombo = m;
    return m;
  }

  private signal(sig: QuestSignal): void {
    const ctx = this.questCtx();
    const done = advanceQuests(ctx, sig);
    for (const q of done) {
      this.progress.questsDone++;
      this.addScore(q.reward);
      this.emit({ type: 'quest-done', quest: q });
    }
    if (done.length) for (const q of fillQuests(ctx)) this.emit({ type: 'quest-new', quest: q });
  }

  /** Replaces an active quest with a fresh one (small cost, for quests the player dislikes). */
  rerollQuest(id: number): boolean {
    const i = this.progress.quests.findIndex((q) => q.id === id);
    if (i < 0) return false;
    this.progress.quests.splice(i, 1);
    for (const q of fillQuests(this.questCtx())) this.emit({ type: 'quest-new', quest: q });
    return true;
  }

  // ---------------------------------------------------------------- update

  /** Street View mode: the panorama decides where the player is. */
  setPlayerPose(x: number, y: number, heading: number): void {
    const d = Math.hypot(x - this.player.x, y - this.player.y);
    if (d < 200) this.progress.distance += d;
    this.player.moving = d > 0.01;
    this.player.x = x;
    this.player.y = y;
    this.player.heading = heading;
  }

  update(dt: number, input?: MoveInput | null): void {
    dt = Math.min(dt, 0.1);
    this.time += dt;
    this.progress.playTime += dt;
    this.freshSamples.length = 0;
    if (input) this.move(dt, input);
    this.explore();
    this.updateItems(dt);
    this.updateCats(dt);
    for (const k of Object.keys(this.powerups)) {
      this.powerups[k] -= dt;
      if (this.powerups[k] <= 0) delete this.powerups[k];
    }
    if (this.combo.timer > 0) {
      this.combo.timer -= dt;
      if (this.combo.timer <= 0) {
        this.combo.chain = 0;
        this.combo.mult = 1;
      }
    }
    this.tickTimer -= dt;
    if (this.tickTimer <= 0) {
      this.tickTimer = 0.5;
      this.slowTick();
    }
    this.saveTimer -= dt;
    if (this.saveTimer <= 0) {
      this.saveTimer = 5;
      this.save();
    }
  }

  save(): void {
    this.progress.player = { x: this.player.x, y: this.player.y, h: this.player.heading };
    saveProgress(this.store, this.progress);
  }

  private move(dt: number, input: MoveInput): void {
    const p = this.player;
    p.heading = wrapAngle(p.heading + input.turn * this.config.turnSpeed * dt);
    const target = input.forward * (input.run ? this.config.runSpeed : this.config.walkSpeed) * this.speedMultiplier();
    // smooth acceleration
    const k = Math.min(1, dt * 8);
    p.speed += (target - p.speed) * k;
    if (Math.abs(p.speed) < 0.05 && input.forward === 0) p.speed = 0;
    p.moving = Math.abs(p.speed) > 0.2;
    if (!p.speed) return;
    const step = p.speed * dt;
    const to = { x: p.x + Math.sin(p.heading) * step, y: p.y + Math.cos(p.heading) * step };
    const next = this.net.constrain(p, to);
    const moved = Math.hypot(next.x - p.x, next.y - p.y);
    this.progress.distance += moved;
    p.x = next.x;
    p.y = next.y;
    // gentle auto-steer: when walking roughly along a street without turning, follow its direction
    if (input.turn === 0 && input.forward > 0) {
      const hit = this.net.nearest(p, 12);
      if (hit) {
        const along = this.net.alignedHeading(hit.seg, p.heading);
        const diff = wrapAngle(along - p.heading);
        const blocked = moved < Math.abs(step) * 0.6;
        const limit = blocked ? 1.2 : 0.45;
        if (Math.abs(diff) < limit) p.heading = wrapAngle(p.heading + diff * Math.min(1, dt * (blocked ? 6 : 2.5)));
      }
    }
  }

  private explore(): void {
    const ids = this.net.samplesNear(this.player, this.config.exploreRadius);
    let fresh = 0;
    for (const id of ids) {
      if (!markVisited(this.progress, id)) continue;
      fresh++;
      this.freshSamples.push(id);
      const st = this.sampleStreet[id];
      if (!st) continue;
      const n = (this.streetVisits.get(st) ?? 0) + 1;
      this.streetVisits.set(st, n);
      const info = this.net.streets.get(st);
      if (info && n >= Math.ceil(info.sampleCount * 0.9) && !this.progress.completedStreets.includes(st)) {
        this.progress.completedStreets.push(st);
        const pts = Math.round(Math.min(250, 25 + info.length / 5));
        this.addScore(pts);
        this.emit({ type: 'street-done', name: st, points: pts });
      }
    }
    if (fresh) {
      this.addScore(fresh);
      this.emit({ type: 'explore', points: fresh });
    }
    const hit = this.net.nearest(this.player, 25);
    if (hit) this.currentStreet = hit.seg.name;
  }

  private updateItems(dt: number): void {
    const p = this.player;
    const magnet = (this.powerups.miknatis ?? 0) > 0;
    const r = this.config.pickupRadius;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.phase += dt * 2;
      const dx = p.x - it.x;
      const dy = p.y - it.y;
      const d = Math.hypot(dx, dy);
      if (magnet && d < 24 && d > 0.01 && it.def.kind !== 'record') {
        const s = Math.min(d, 22 * dt);
        it.x += (dx / d) * s;
        it.y += (dy / d) * s;
      }
      if (d <= r) this.pickUp(i);
    }
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 1.2;
      if (this.regularItemCount() < this.targetItems) this.spawnRandomItem(60);
    }
  }

  private pickUp(index: number): void {
    const it = this.items[index];
    const def = it.def;
    if (def.kind === 'consumable' && def.id === 'mama' && this.progress.mama >= MAX_MAMA) return;
    this.items.splice(index, 1);
    this.progress.counts[def.id] = (this.progress.counts[def.id] ?? 0) + 1;
    let points = 0;
    let mult = 1;
    if (def.kind === 'powerup') {
      this.powerups[def.id] = POWERUP_DURATION[def.id] ?? 20;
      this.emit({ type: 'powerup', id: def.id });
    } else {
      mult = this.bumpCombo();
      points = def.points * mult;
      this.addScore(points);
      if (def.id === 'mama') this.progress.mama = Math.min(MAX_MAMA, this.progress.mama + 1);
      if (def.kind === 'record' && it.record !== undefined && !this.progress.records.includes(it.record)) {
        this.progress.records.push(it.record);
      }
    }
    this.emit({ type: 'collect', item: it, points, mult });
    this.signal({ kind: 'collect', item: def.id });
  }

  private updateCats(dt: number): void {
    const p = this.player;
    for (const c of this.cats) {
      if (c.follow > 0) {
        c.follow -= dt;
        const dx = p.x - c.x;
        const dy = p.y - c.y;
        const d = Math.hypot(dx, dy);
        if (d > 3) {
          c.targetX = p.x - (dx / d) * 2.5;
          c.targetY = p.y - (dy / d) * 2.5;
        } else {
          c.targetX = c.x;
          c.targetY = c.y;
        }
        if (c.follow <= 0) {
          // walk back home
          c.targetX = c.homeX;
          c.targetY = c.homeY;
        }
      } else if (c.idle > 0) {
        c.idle -= dt;
        if (c.idle <= 0) {
          const a = this.rng() * Math.PI * 2;
          const r = 3 + this.rng() * 10;
          c.targetX = c.homeX + Math.cos(a) * r;
          c.targetY = c.homeY + Math.sin(a) * r;
        }
      }
      const dx = c.targetX - c.x;
      const dy = c.targetY - c.y;
      const d = Math.hypot(dx, dy);
      const speed = c.follow > 0 ? Math.max(2.5, Math.abs(p.speed) * 1.1) : 1.3;
      if (d > 0.3) {
        const s = Math.min(d, speed * dt);
        const next = this.net.constrain(c, { x: c.x + (dx / d) * s, y: c.y + (dy / d) * s });
        const moved = Math.hypot(next.x - c.x, next.y - c.y);
        c.heading = Math.atan2(dx, dy);
        c.x = next.x;
        c.y = next.y;
        c.moving = moved > 0.001;
        if (moved < s * 0.2 && c.follow <= 0) {
          c.targetX = c.x;
          c.targetY = c.y;
        }
      } else {
        c.moving = false;
        if (c.idle <= 0 && c.follow <= 0) c.idle = 2 + this.rng() * 6;
      }
      // feeding
      const pd = Math.hypot(p.x - c.x, p.y - c.y);
      if (pd <= this.config.feedRadius && this.time >= c.hungryAt) {
        if (this.progress.mama > 0) this.feed(c);
        else if (this.time - c.lastNag > 10) {
          c.lastNag = this.time;
          this.emit({ type: 'toast', kind: 'warn', emoji: '🐈', text: `${c.def.name} aç! Kedi maması 🐟 bulup getir.` });
        }
      }
    }
  }

  private feed(c: Cat): void {
    this.progress.mama--;
    const first = !this.progress.fed[c.def.id];
    this.progress.fed[c.def.id] = (this.progress.fed[c.def.id] ?? 0) + 1;
    const points = first ? 75 : 25;
    this.addScore(points);
    c.hungryAt = this.time + 120;
    c.follow = 25;
    this.emit({ type: 'feed', cat: c, points, first });
    this.signal({ kind: 'feed' });
  }

  private slowTick(): void {
    // POI discovery
    const r2 = this.config.poiRadius ** 2;
    for (const poi of this.pois) {
      if ((poi.x - this.player.x) ** 2 + (poi.y - this.player.y) ** 2 > r2) continue;
      if (this.progress.pois.includes(poi.index)) continue;
      this.progress.pois.push(poi.index);
      this.addScore(5);
      this.emit({ type: 'poi', poi });
      this.signal({ kind: 'visit', poi: poi.index });
    }
    if (!this.progress.metro) {
      for (const m of this.metroPois) {
        if (Math.hypot(m.x - this.player.x, m.y - this.player.y) < 60) {
          this.progress.metro = true;
          this.addScore(200);
          this.emit({ type: 'toast', kind: 'rare', emoji: 'Ⓜ️', text: `${m.name} metro istasyonu! Yeraltına indin: +200` });
        }
      }
    }
    this.signal({ kind: 'tick' });
    const badges = checkBadges(this.progress, this.explorePct, { streets: this.net.streets.size, pois: this.pois.length });
    for (const b of badges) this.emit({ type: 'badge', badge: b });
  }
}
