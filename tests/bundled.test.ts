import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Game } from '../src/core/game';
import { mulberry32 } from '../src/core/rng';
import type { AreaData } from '../src/core/types';
import { BUNDLED, findBundled } from '../src/data/areas';

describe('bundled neighbourhoods', () => {
  for (const b of BUNDLED) {
    it(`${b.name} is playable`, () => {
      const area = JSON.parse(readFileSync(fileURLToPath(new URL(`../public/data/${b.slug}.json`, import.meta.url)), 'utf8')) as AreaData;
      const g = new Game(area, { rng: mulberry32(1) });
      expect(g.net.totalLength).toBeGreaterThan(3000);
      expect(g.items.length).toBeGreaterThan(40);
      expect(g.net.inCorridor(g.player)).toBe(true);
      expect(g.progress.quests.length).toBe(3);
      for (const alias of b.aliases) expect(findBundled(alias)?.slug).toBe(b.slug);
    });
  }
});
