import { describe, expect, it } from 'vitest';
import { CONFIG_3D, Game, type GameEvent, type MoveInput } from '../src/core/game';
import { wrapAngle } from '../src/core/geo';
import { mulberry32 } from '../src/core/rng';
import type { Vec2 } from '../src/core/types';
import { loadYenisahra } from './fixtures';

/** A simple autopilot that plays the game the way a person might: chase items and quest targets along real routes. */
class Bot {
  private route: Vec2[] = [];
  private wp = 0;
  private replan = 0;
  private target: Vec2 | null = null;
  private targetAge = 0;
  stuck = 0;
  stuckAt: unknown[] = [];
  private lastPos = { x: 0, y: 0 };
  private stillTime = 0;

  constructor(private readonly g: Game, private readonly rng: () => number) {}

  private pickTarget(): Vec2 | null {
    const g = this.g;
    const p = g.player;
    // quest targets now and then, otherwise the nearest interesting thing
    if (this.rng() < 0.35) {
      for (const q of g.progress.quests) {
        const t = g.questTargetPoint(q);
        if (t) return t;
      }
    }
    if (g.progress.mama > 0) {
      const hungry = g.cats.filter((c) => g.time >= c.hungryAt).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
      if (hungry && Math.hypot(hungry.x - p.x, hungry.y - p.y) < 250) return hungry;
    }
    let best: Vec2 | null = null;
    let bd = Infinity;
    for (const it of g.items) {
      if (it.def.id === 'mama' && g.progress.mama >= 5) continue;
      const d = Math.hypot(it.x - p.x, it.y - p.y);
      if (d < bd && d > 1) {
        bd = d;
        best = it;
      }
    }
    return best;
  }

  debug() {
    const p = this.g.player;
    const t = this.target;
    return { p: [Math.round(p.x), Math.round(p.y)], t: t ? [Math.round(t.x), Math.round(t.y), 'homeX' in t ? 'cat' : 'def' in t ? (t as { def: { id: string } }).def.id : 'pt'] : null, route: this.route.length, wp: this.wp, age: Math.round(this.targetAge), mama: this.g.progress.mama };
  }

  input(dt: number): MoveInput {
    const g = this.g;
    const p = g.player;
    this.replan -= dt;
    this.targetAge += dt;
    const t0 = this.target;
    const done =
      !t0 ||
      this.targetAge > 70 ||
      Math.hypot(t0.x - p.x, t0.y - p.y) < 2 ||
      // collected items disappear from the world
      ('phase' in t0 && !g.items.includes(t0 as never)) ||
      // fed cats are no longer a target
      ('hungryAt' in t0 && (t0 as { hungryAt: number }).hungryAt > g.time) ||
      // quest points vanish once the quest is done
      (!('def' in t0) && !g.progress.quests.some((q) => {
        const qt = g.questTargetPoint(q);
        return qt && Math.abs(qt.x - t0.x) < 0.01 && Math.abs(qt.y - t0.y) < 0.01;
      }));
    if (done) {
      this.target = this.pickTarget();
      this.targetAge = 0;
      this.replan = 0;
    }
    if (this.replan <= 0 || this.wp >= this.route.length) {
      this.replan = 2;
      this.route = (this.target && g.net.route(p, this.target)) || [];
      this.wp = 1;
      if (!this.route.length) this.target = null;
    }
    while (this.wp < this.route.length && Math.hypot(this.route[this.wp].x - p.x, this.route[this.wp].y - p.y) < 2.5) this.wp++;
    const target = this.route[this.wp];
    if (Math.hypot(p.x - this.lastPos.x, p.y - this.lastPos.y) < 0.05) this.stillTime += dt;
    else this.stillTime = 0;
    this.lastPos = { x: p.x, y: p.y };
    if (this.stillTime > 3 && target) {
      this.stuck++;
      this.stuckAt.push({ x: Math.round(p.x), y: Math.round(p.y), tx: Math.round(target.x), ty: Math.round(target.y), h: +p.heading.toFixed(2), kind: this.target ? ('homeX' in this.target ? 'cat' : 'def' in this.target ? 'item' : 'point') : 'none', inCorr: g.net.inCorridor(this.target ?? p) } as never);
      this.stillTime = 0;
      this.replan = 0;
    }
    if (!target) return { forward: 0, turn: 1, run: false };
    const want = Math.atan2(target.x - p.x, target.y - p.y);
    const diff = wrapAngle(want - p.heading);
    return { forward: Math.abs(diff) < 1.0 ? 1 : 0.15, turn: Math.max(-1, Math.min(1, diff * 2.5)), run: true };
  }
}

describe('autopilot playtest (Yenisahra)', () => {
  it('ten minutes of play feel rewarding and nothing gets stuck', async () => {
    const g = new Game(loadYenisahra(), { rng: mulberry32(99), config: CONFIG_3D, date: new Date(2026, 9, 6) });
    const bot = new Bot(g, mulberry32(9));
    const events: Record<string, number> = {};
    g.on((e: GameEvent) => (events[e.type] = (events[e.type] ?? 0) + 1));
    const timeline: number[] = [];
    const dt = 1 / 20;
    for (let t = 0; t < 600; t += dt) {
      g.update(dt, bot.input(dt));
      if (Math.abs(t % 60) < dt) timeline.push(g.progress.score);
      expect(g.net.inCorridor(g.player)).toBe(true);
    }
    const p = g.progress;
    const summary = {
      score: p.score,
      perMinute: timeline,
      level: g.level.title,
      explore: g.explorePct.toFixed(1),
      distance: Math.round(p.distance),
      collected: Object.values(p.counts).reduce((a, b) => a + b, 0),
      counts: p.counts,
      quests: p.questsDone,
      badges: p.badges,
      streets: p.completedStreets.length,
      fed: p.fed,
      pois: p.pois.length,
      stuck: bot.stuck,
      stuckAt: bot.stuckAt,
      events,
    };
    if (process.env.PLAYTEST_OUT) (await import("node:fs")).writeFileSync(process.env.PLAYTEST_OUT, JSON.stringify(summary, null, 1));
    expect(p.score).toBeGreaterThan(800);
    expect(p.questsDone).toBeGreaterThanOrEqual(3);
    expect(summary.collected).toBeGreaterThan(40);
    expect(bot.stuck).toBeLessThan(4);
  }, 60_000);
});
