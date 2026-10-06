import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const stub = readFileSync(new URL('./gmaps-stub.js', import.meta.url), 'utf8');

type Dbg = { game: { player: { x: number; y: number; heading: number }; progress: { score: number; visitedCount: number; counts: Record<string, number> }; items: { x: number; y: number; def: { id: string } }[]; area: { name: string } } };

async function startGame(page: Page, opts: { semt?: string; mode?: '3d' | 'sv'; key?: string; seenHelp?: boolean } = {}) {
  await page.goto('/');
  if (opts.seenHelp !== false) await page.evaluate(() => localStorage.setItem('ysu:seen-help', '1'));
  await page.goto('/');
  if (opts.semt) await page.fill('#semt', opts.semt);
  if (opts.mode === 'sv') {
    await page.check('input[name=mode][value=sv]');
    await page.fill('#apikey', opts.key ?? 'TESTKEY');
  }
  await page.click('#start-btn');
  await page.waitForFunction(() => !!(window as unknown as { __ysu?: unknown }).__ysu, null, { timeout: 30_000 });
}

const dbg = <T>(page: Page, fn: (d: Dbg) => T) => page.evaluate(fn as never, null) as Promise<T>;

test('bundled neighbourhood chips pick a ready map', async ({ page }) => {
  await page.goto('/');
  await page.click('.chip[data-semt=Kuzguncuk]');
  await expect(page.locator('#semt')).toHaveValue('Kuzguncuk');
  await expect(page.locator('#semt-hint')).toContainText('Üsküdar');
  await page.click('#start-btn');
  await page.waitForFunction(() => !!(window as unknown as { __ysu?: unknown }).__ysu, null, { timeout: 30_000 });
  const name = await page.evaluate(() => (window as unknown as { __ysu: { game: { area: { name: string } } } }).__ysu.game.area.name);
  expect(name).toBe('Kuzguncuk');
});

test('menu shows Yenisahra as a ready map', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toContainText('Yenisahra');
  await expect(page.locator('#semt')).toHaveValue('Yenisahra');
  await expect(page.locator('#semt-hint')).toContainText('hazır harita');
  await page.fill('#semt', 'Bostancı, Kadıköy');
  await expect(page.locator('#semt-hint')).toContainText("OpenStreetMap");
  await page.check('input[name=mode][value=sv]');
  await expect(page.locator('#apikey')).toBeVisible();
});

test('first start shows the help, then walking explores and scores', async ({ page }) => {
  await startGame(page, { seenHelp: false });
  await expect(page.locator('.modal-card h2')).toHaveText('Nasıl oynanır?');
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal')).toBeHidden();
  await expect(page.locator('canvas.world-canvas')).toBeVisible();
  const start = await dbg(page, () => ({ ...(window as unknown as { __ysu: Dbg }).__ysu.game.player }));
  await page.keyboard.down('Shift');
  await page.keyboard.down('KeyW');
  await page.waitForFunction(
    (s) => {
      const p = (window as unknown as { __ysu: Dbg }).__ysu.game.player;
      return Math.hypot(p.x - s.x, p.y - s.y) > 8;
    },
    start,
    { timeout: 30_000 },
  );
  await page.keyboard.up('KeyW');
  await page.keyboard.up('Shift');
  const visited = await dbg(page, () => (window as unknown as { __ysu: Dbg }).__ysu.game.progress.visitedCount);
  expect(visited).toBeGreaterThan(0);
  await expect(page.locator('.street-name')).not.toHaveText('—');
});

test('collecting an item updates score, toast and album; progress survives reload', async ({ page }) => {
  await startGame(page);
  await page.evaluate(() => {
    const g = (window as unknown as { __ysu: Dbg }).__ysu.game;
    const it = g.items.find((i) => i.def.id === 'simit')!;
    g.player.x = it.x;
    g.player.y = it.y;
  });
  await page.waitForFunction(() => ((window as unknown as { __ysu: Dbg }).__ysu.game.progress.counts.simit ?? 0) >= 1, null, { timeout: 20_000 });
  await expect(page.locator('[data-testid=score]')).not.toHaveText('0', { timeout: 10_000 });
  await expect(page.locator('.toast').first()).toBeVisible();
  const score = await dbg(page, () => (window as unknown as { __ysu: Dbg }).__ysu.game.progress.score);
  expect(score).toBeGreaterThanOrEqual(10);
  await page.keyboard.press('KeyK');
  await expect(page.locator('.modal-card h2')).toContainText('Albümü');
  await expect(page.locator('.tile:not(.locked)').first()).toContainText('Simit');
  await page.click('.tab[data-tab=stats]');
  await expect(page.locator('.stats-grid')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.evaluate(() => (window as unknown as { __ysu: { game: { save(): void } } }).__ysu.game.save());
  await page.goto('/');
  await expect(page.locator('#save-info')).toContainText('Kayıtlı oyun');
  await page.click('#start-btn');
  await page.waitForFunction(() => !!(window as unknown as { __ysu?: unknown }).__ysu);
  const after = await dbg(page, () => (window as unknown as { __ysu: Dbg }).__ysu.game.progress.score);
  expect(after).toBeGreaterThanOrEqual(score);
});

test('map and pause menus open and close', async ({ page }) => {
  await startGame(page);
  await page.keyboard.press('KeyM');
  await expect(page.locator('.bigmap')).toBeVisible();
  await expect(page.locator('.bigmap-legend')).toContainText('Yenisahra');
  await page.keyboard.press('Escape');
  await expect(page.locator('.bigmap')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal-card h2')).toHaveText('Durduruldu');
  await page.click('button[data-a=menu]');
  await expect(page.locator('#menu')).toBeVisible();
});

test('Street View mode moves between panoramas and overlays items', async ({ page }) => {
  await page.route('https://maps.googleapis.com/maps/api/js**', (r) => r.fulfill({ contentType: 'text/javascript', body: stub }));
  await startGame(page, { mode: 'sv' });
  await expect(page.locator('.sv-pano')).toBeVisible();
  await expect(page.locator('canvas.sv-overlay')).toBeVisible();
  const before = await dbg(page, () => ({ ...(window as unknown as { __ysu: Dbg }).__ysu.game.player }));
  await page.keyboard.press('ArrowUp');
  await page.waitForFunction(() => (window as unknown as { __svSteps: number }).__svSteps >= 2);
  const after = await dbg(page, () => ({ ...(window as unknown as { __ysu: Dbg }).__ysu.game.player }));
  expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(8);
  // project an item right in front of the camera and check it is drawn (pixel not transparent)
  const drawn = await page.evaluate(async () => {
    const d = (window as unknown as { __ysu: Dbg }).__ysu;
    const g = d.game;
    const it = g.items[0];
    const h = g.player.heading;
    it.x = g.player.x + Math.sin(h) * 30;
    it.y = g.player.y + Math.cos(h) * 30;
    await new Promise((r) => setTimeout(r, 300));
    const c = document.querySelector('canvas.sv-overlay') as HTMLCanvasElement;
    const ctx = c.getContext('2d')!;
    const data = ctx.getImageData(Math.floor(c.width / 2) - 20, 0, 40, c.height).data;
    let n = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n++;
    return n;
  });
  expect(drawn).toBeGreaterThan(50);
});

test('a rejected Google key falls back to the 3D city', async ({ page }) => {
  await page.route('https://maps.googleapis.com/maps/api/js**', (r) => r.fulfill({ contentType: 'text/javascript', body: stub }));
  await startGame(page, { mode: 'sv', key: 'BAD' });
  await expect(page.locator('canvas.world-canvas')).toBeVisible();
  await expect(page.locator('.toast.warn').first()).toContainText('Street View açılamadı', { timeout: 15_000 });
});

test('another neighbourhood loads from OpenStreetMap', async ({ page }) => {
  const fixture = JSON.parse(readFileSync(new URL('./osm-fixture.json', import.meta.url), 'utf8'));
  await page.route('https://nominatim.openstreetmap.org/**', (r) => r.fulfill({ json: fixture.nominatim }));
  await page.route('https://overpass-api.de/**', (r) => r.fulfill({ json: { elements: fixture.elements } }));
  await startGame(page, { semt: 'Bostancı' });
  const name = await dbg(page, () => (window as unknown as { __ysu: Dbg }).__ysu.game.area.name);
  expect(name).toBe('Bostancı');
  await expect(page.locator('canvas.world-canvas')).toBeVisible();
});

test('unknown neighbourhood shows an error on the menu', async ({ page }) => {
  await page.route('https://nominatim.openstreetmap.org/**', (r) => r.fulfill({ json: [] }));
  await page.goto('/');
  await page.fill('#semt', 'Böyle Bir Yer Yok');
  await page.click('#start-btn');
  await expect(page.locator('#menu-error')).toContainText('bulunamadı');
});

test.describe('touch devices', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('show the joystick and move with it', async ({ page }) => {
    await startGame(page);
    await expect(page.locator('.joystick')).toBeVisible();
    await expect(page.locator('.run-btn')).toBeVisible();
    const before = await dbg(page, () => ({ ...(window as unknown as { __ysu: Dbg }).__ysu.game.player }));
    const box = (await page.locator('.joystick').boundingBox())!;
    const x = box.x + 90;
    const y = box.y + box.height - 110;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - 45, { steps: 4 });
    await page.waitForFunction(
      (s) => {
        const p = (window as unknown as { __ysu: Dbg }).__ysu.game.player;
        return Math.hypot(p.x - s.x, p.y - s.y) > 3;
      },
      before,
      { timeout: 30_000 },
    );
    await page.mouse.up();
  });
});
