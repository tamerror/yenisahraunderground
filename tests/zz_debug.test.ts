import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { Game } from '../src/core/game';
import { mulberry32 } from '../src/core/rng';
import { loadYenisahra } from './fixtures';
it('debug', () => {
  const g = new Game(loadYenisahra(), { rng: mulberry32(2024) });
  const out: string[] = [];
  for (const [px, py] of [[-191, -223], [-230, -295]]) {
    for (const s of g.net.segs) {
      const mx = (s.ax + s.bx) / 2, my = (s.ay + s.by) / 2;
      if (Math.hypot(mx - px, my - py) < 45) out.push(`${px},${py}: seg${s.id} ${s.kind} ${s.name} main=${s.main} a=(${s.ax.toFixed(1)},${s.ay.toFixed(1)}) b=(${s.bx.toFixed(1)},${s.by.toFixed(1)}) hw=${s.hw} len=${s.len.toFixed(1)} na=${s.a}(${g.net.nodes[s.a].segs.length}) nb=${s.b}(${g.net.nodes[s.b].segs.length})`);
    }
    const p = { x: px, y: py };
    out.push('incorr ' + g.net.inCorridor(p) + ' next ' + JSON.stringify(g.net.constrain(p, { x: px + 0.3, y: py + 5 })));
  }
  writeFileSync('/tmp/claude-0/-home-user-yenisahraunderground/a7b2fa22-7dd6-5f60-981f-7fd49f2491b7/scratchpad/segs.txt', out.join('\n'));
});
