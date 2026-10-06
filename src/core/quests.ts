import { ITEM_BY_ID, POI_LABEL } from './content';
import type { Progress } from './progress';
import { pick, type Rng, weightedPick } from './rng';
import type { StreetNetwork } from './streets';
import type { PoiType, Vec2 } from './types';

export type QuestType = 'collect' | 'street' | 'feed' | 'combo' | 'visit' | 'explore';

export interface QuestState {
  id: number;
  type: QuestType;
  /** item id, street name or poi index depending on type */
  target: string | number | null;
  goal: number;
  progress: number;
  reward: number;
  title: string;
  /** Value of the tracked counter when the quest was issued (explore %). */
  base?: number;
}

export interface GamePoi {
  index: number;
  name: string;
  type: PoiType;
  x: number;
  y: number;
  /** Distance from the walkable network (metres). */
  reach: number;
}

/** POIs further than this from any walkable street never become visit targets. */
export const MAX_VISIT_REACH = 80;

export interface QuestContext {
  rng: Rng;
  progress: Progress;
  net: StreetNetwork;
  pois: GamePoi[];
  player: Vec2;
  streetVisited(name: string): number;
  explorePct(): number;
  catCount: number;
}

export const ACTIVE_QUESTS = 3;

const COLLECT_TARGETS: { id: string; n: [number, number]; w: number }[] = [
  { id: 'simit', n: [4, 8], w: 3 },
  { id: 'cay', n: [4, 8], w: 3 },
  { id: 'lokum', n: [2, 5], w: 2 },
  { id: 'kart', n: [2, 4], w: 2 },
  { id: 'mama', n: [2, 4], w: 1.5 },
  { id: 'nazar', n: [1, 2], w: 1 },
];

let nextQuestId = 1;

function streetLabel(name: string): string {
  return name;
}

function makeCollect(ctx: QuestContext): QuestState {
  const t = weightedPick(ctx.rng, COLLECT_TARGETS, (x) => x.w);
  const n = t.n[0] + Math.floor(ctx.rng() * (t.n[1] - t.n[0] + 1));
  const def = ITEM_BY_ID[t.id];
  return {
    id: nextQuestId++,
    type: 'collect',
    target: t.id,
    goal: n,
    progress: 0,
    reward: Math.round((Math.max(def.points, 8) * n * 1.5) / 5) * 5 + 20,
    title: `${n} ${def.name} topla ${def.emoji}`,
  };
}

function makeStreet(ctx: QuestContext, taken: Set<string | number | null>): QuestState | null {
  const done = new Set(ctx.progress.completedStreets);
  const cands = [...ctx.net.streets.values()].filter(
    (s) => !done.has(s.name) && !taken.has(s.name) && s.length >= 60 && s.length <= 900 && s.sampleCount >= 4,
  );
  if (!cands.length) return null;
  // prefer streets close to the player
  const distTo = (name: string) => {
    let best = Infinity;
    for (const b of ctx.net.streets.get(name)!.blocks)
      for (const sid of ctx.net.blocks[b].samples) {
        const s = ctx.net.samples[sid];
        best = Math.min(best, Math.hypot(s.x - ctx.player.x, s.y - ctx.player.y));
      }
    return best;
  };
  const scored = cands.map((s) => ({ s, d: distTo(s.name) })).sort((a, b) => a.d - b.d).slice(0, 8);
  const { s } = pick(ctx.rng, scored);
  const goal = Math.ceil(s.sampleCount * 0.9);
  return {
    id: nextQuestId++,
    type: 'street',
    target: s.name,
    goal,
    progress: Math.min(goal, ctx.streetVisited(s.name)),
    reward: Math.round((40 + s.length / 4) / 5) * 5,
    title: `${streetLabel(s.name)} boyunca yürü 🚶`,
  };
}

function makeVisit(ctx: QuestContext, taken: Set<string | number | null>): QuestState | null {
  const known = new Set(ctx.progress.pois);
  const cands = ctx.pois
    .filter((p) => !known.has(p.index) && !taken.has(p.index) && p.type !== 'bus' && p.type !== 'shop' && p.reach <= MAX_VISIT_REACH)
    .map((p) => ({ p, d: Math.hypot(p.x - ctx.player.x, p.y - ctx.player.y) }))
    .filter((c) => c.d > 80)
    .sort((a, b) => a.d - b.d)
    .slice(0, 6);
  if (!cands.length) return null;
  const { p, d } = pick(ctx.rng, cands);
  return {
    id: nextQuestId++,
    type: 'visit',
    target: p.index,
    goal: 1,
    progress: 0,
    reward: Math.round((50 + d / 4) / 5) * 5,
    title: `${POI_LABEL[p.type].emoji} ${p.name} (${POI_LABEL[p.type].label.toLowerCase()}) — uğra`,
  };
}

function makeFeed(ctx: QuestContext): QuestState {
  const n = 1 + Math.floor(ctx.rng() * 2);
  return {
    id: nextQuestId++,
    type: 'feed',
    target: null,
    goal: n,
    progress: 0,
    reward: 70 * n,
    title: n === 1 ? 'Bir sokak kedisini besle 🐈' : `${n} sokak kedisini besle 🐈`,
  };
}

function makeCombo(ctx: QuestContext): QuestState {
  const k = 2 + Math.floor(ctx.rng() * 2) + (ctx.progress.bestCombo >= 3 ? 1 : 0);
  return { id: nextQuestId++, type: 'combo', target: null, goal: k, progress: 1, reward: 50 * k, title: `x${k} kombo yap ⚡` };
}

function makeExplore(ctx: QuestContext): QuestState | null {
  const cur = Math.floor(ctx.explorePct());
  if (cur >= 99) return null;
  const goal = Math.min(100, cur + (cur < 20 ? 3 : 5));
  return {
    id: nextQuestId++,
    type: 'explore',
    target: null,
    goal,
    progress: cur,
    base: cur,
    reward: 120 + goal * 2,
    title: `Mahallenin %${goal}'ini keşfet 🗺️`,
  };
}

/** Creates a new quest that does not duplicate the currently active ones. */
export function generateQuest(ctx: QuestContext): QuestState {
  const active = ctx.progress.quests;
  const types = new Set(active.map((q) => q.type));
  const taken = new Set(active.map((q) => q.target));
  const options: { t: QuestType; w: number }[] = [
    { t: 'collect', w: 3 },
    { t: 'street', w: 3 },
    { t: 'visit', w: 2 },
    { t: 'feed', w: ctx.catCount > 0 ? 1.5 : 0 },
    { t: 'combo', w: 1 },
    { t: 'explore', w: 1 },
  ];
  for (let attempt = 0; attempt < 12; attempt++) {
    const t = weightedPick(ctx.rng, options, (o) => (types.has(o.t) && attempt < 8 ? 0 : o.w)).t;
    let q: QuestState | null = null;
    if (t === 'collect') q = makeCollect(ctx);
    else if (t === 'street') q = makeStreet(ctx, taken);
    else if (t === 'visit') q = makeVisit(ctx, taken);
    else if (t === 'feed') q = makeFeed(ctx);
    else if (t === 'combo') q = makeCombo(ctx);
    else q = makeExplore(ctx);
    if (q && !(q.type === 'collect' && taken.has(q.target))) return q;
  }
  return makeCollect(ctx);
}

export function fillQuests(ctx: QuestContext): QuestState[] {
  const added: QuestState[] = [];
  nextQuestId = Math.max(nextQuestId, ...ctx.progress.quests.map((q) => q.id + 1), 1);
  while (ctx.progress.quests.length < ACTIVE_QUESTS) {
    const q = generateQuest(ctx);
    ctx.progress.quests.push(q);
    added.push(q);
  }
  return added;
}

export type QuestSignal =
  | { kind: 'collect'; item: string }
  | { kind: 'feed' }
  | { kind: 'combo'; mult: number }
  | { kind: 'visit'; poi: number }
  | { kind: 'tick' };

/** Applies a signal to the active quests; returns the quests that just completed (and removes them). */
export function advanceQuests(ctx: QuestContext, sig: QuestSignal): QuestState[] {
  const done: QuestState[] = [];
  for (const q of ctx.progress.quests) {
    switch (q.type) {
      case 'collect':
        if (sig.kind === 'collect' && sig.item === q.target) q.progress++;
        break;
      case 'feed':
        if (sig.kind === 'feed') q.progress++;
        break;
      case 'combo':
        if (sig.kind === 'combo') q.progress = Math.max(q.progress, sig.mult);
        break;
      case 'visit':
        if (sig.kind === 'visit' && sig.poi === q.target) q.progress = 1;
        break;
      case 'street':
        if (sig.kind === 'tick') q.progress = Math.min(q.goal, ctx.streetVisited(String(q.target)));
        break;
      case 'explore':
        if (sig.kind === 'tick') q.progress = Math.floor(ctx.explorePct());
        break;
    }
    if (q.progress >= q.goal) done.push(q);
  }
  if (done.length) ctx.progress.quests = ctx.progress.quests.filter((q) => !done.includes(q));
  return done;
}
