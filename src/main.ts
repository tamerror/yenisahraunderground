import './style.css';
import { CONFIG_3D, CONFIG_SV, Game } from './core/game';
import { safeLocalStorage, saveKey } from './core/progress';
import type { AreaData } from './core/types';
import { BUNDLED, findBundled, loadBundled, slugify } from './data/areas';
import { BigMap, Minimap } from './render/minimap';
import { Sfx } from './ui/audio';
import { Hud } from './ui/hud';
import { Input } from './ui/input';

interface Settings {
  semt: string;
  mode: '3d' | 'sv';
  key: string;
}

interface Renderer {
  update(dt: number): void;
  resize(): void;
  dispose(): void;
  project(x: number, y: number, h?: number): { x: number; y: number } | null;
  toggleView?(): void;
  /** Street View drives the player itself. */
  drivesPlayer?: boolean;
  onAction?(a: string): void;
}

const store = safeLocalStorage();
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function loadSettings(): Settings {
  const def: Settings = { semt: 'Yenisahra', mode: '3d', key: '' };
  try {
    return { ...def, ...JSON.parse(store?.getItem('ysu:settings') ?? '{}') };
  } catch {
    return def;
  }
}

function saveSettings(s: Settings): void {
  try {
    store?.setItem('ysu:settings', JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

const OSM_CACHE_DAYS = 30;

type DayMode = 'auto' | 'day' | 'night';
const DAY_LABELS: Record<DayMode, string> = { auto: 'Otomatik', day: 'Hep gündüz', night: 'Hep gece' };

async function loadArea(semt: string, progress: (m: string) => void): Promise<{ area: AreaData; slug: string }> {
  const bundled = findBundled(semt);
  if (bundled) {
    progress(`${bundled.name} haritası yükleniyor…`);
    return { area: await loadBundled(bundled), slug: bundled.slug };
  }
  const slug = slugify(semt);
  const cacheKey = `ysu:osm:${slug}`;
  try {
    const cached = store?.getItem(cacheKey);
    if (cached) {
      const { t, area } = JSON.parse(cached) as { t: number; area: AreaData };
      if (Date.now() - t < OSM_CACHE_DAYS * 864e5) return { area, slug };
    }
  } catch {
    /* ignore broken cache */
  }
  const { loadFromOsm } = await import('./data/osm');
  const area = await loadFromOsm(semt, { onProgress: progress });
  try {
    store?.setItem(cacheKey, JSON.stringify({ t: Date.now(), area }));
  } catch {
    /* quota exceeded: fine, just not cached */
  }
  return { area, slug };
}

class App {
  private game: Game | null = null;
  private renderer: Renderer | null = null;
  private hud: Hud | null = null;
  private minimap: Minimap | null = null;
  private bigmap: BigMap | null = null;
  private input: Input | null = null;
  private readonly sfx = new Sfx();
  private raf = 0;
  private lastT = 0;
  private paused = false;
  private slowFrames = 0;
  private dayMode: DayMode = 'auto';
  private readonly root = $('game-root');
  private onResize = () => this.renderer?.resize();

  constructor() {
    this.setupMenu();
    window.addEventListener('resize', this.onResize);
    window.addEventListener('beforeunload', () => this.game?.save());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.game?.save();
    });
    const params = new URLSearchParams(location.search);
    if (params.get('autostart')) {
      const s = loadSettings();
      if (params.get('semt')) s.semt = params.get('semt')!;
      if (params.get('mode') === 'sv' || params.get('mode') === '3d') s.mode = params.get('mode') as Settings['mode'];
      void this.start(s);
    }
  }

  private setupMenu(): void {
    const s = loadSettings();
    const semt = $<HTMLInputElement>('semt');
    const key = $<HTMLInputElement>('apikey');
    semt.value = s.semt;
    key.value = s.key;
    $('semt-list').innerHTML = BUNDLED.map((b) => `<option value="${b.name}">${b.name}, ${b.district}</option>`).join('');
    const chips = $('semt-chips');
    chips.innerHTML = BUNDLED.map((b) => `<button type="button" class="chip" data-semt="${b.name}">${b.name}</button>`).join('');
    chips.querySelectorAll<HTMLButtonElement>('.chip').forEach((c) =>
      c.addEventListener('click', () => {
        semt.value = c.dataset.semt!;
        this.updateMenu();
      }),
    );
    const radios = document.querySelectorAll<HTMLInputElement>('input[name=mode]');
    radios.forEach((r) => {
      r.checked = r.value === s.mode;
      r.addEventListener('change', () => this.updateMenu());
    });
    semt.addEventListener('input', () => this.updateMenu());
    this.updateMenu();
    $('start-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const mode = (document.querySelector('input[name=mode]:checked') as HTMLInputElement).value as Settings['mode'];
      const settings: Settings = { semt: semt.value.trim() || 'Yenisahra', mode, key: key.value.trim() };
      if (mode === 'sv' && !settings.key) {
        this.menuError('Street View için bir API anahtarı gir ya da "3D Mahalle" modunu seç.');
        return;
      }
      saveSettings(settings);
      this.sfx.unlock();
      void this.start(settings);
    });
  }

  private updateMenu(): void {
    const mode = (document.querySelector('input[name=mode]:checked') as HTMLInputElement | null)?.value;
    document.querySelector('.key-field')!.classList.toggle('hidden', mode !== 'sv');
    const semt = $<HTMLInputElement>('semt').value;
    const b = findBundled(semt);
    document.querySelectorAll<HTMLButtonElement>('.chip').forEach((c) => c.classList.toggle('on', !!b && c.dataset.semt === b.name));
    $('semt-hint').textContent = b
      ? `✔ ${b.name}, ${b.district}: hazır harita, anında açılır.`
      : semt.trim()
        ? 'Bu semt OpenStreetMap\'ten indirilecek (internet gerekir, 10-60 sn sürebilir).'
        : '';
    const slug = b ? b.slug : slugify(semt);
    let info = '';
    try {
      const saved = store?.getItem(saveKey(slug));
      if (saved) {
        const p = JSON.parse(saved);
        info = `Kayıtlı oyun: ${Number(p.score).toLocaleString('tr-TR')} puan · %${((p.visitedCount / Math.max(1, p.sampleCount)) * 100).toFixed(1)} keşif`;
      }
    } catch {
      /* ignore */
    }
    $('save-info').textContent = info;
    $('menu-error').classList.add('hidden');
  }

  private menuError(msg: string): void {
    const el = $('menu-error');
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  private setLoading(msg: string | null): void {
    $('loading').classList.toggle('hidden', msg === null);
    if (msg) $('loading-text').textContent = msg;
  }

  async start(settings: Settings): Promise<void> {
    this.setLoading('Yükleniyor…');
    try {
      const { area, slug } = await loadArea(settings.semt, (m) => this.setLoading(m));
      this.setLoading('Mahalle kuruluyor…');
      await new Promise((r) => setTimeout(r, 30));
      const game = new Game(area, { store, saveId: slug, config: settings.mode === 'sv' ? CONFIG_SV : CONFIG_3D });
      this.game = game;
      $('menu').classList.add('hidden');
      this.root.classList.remove('hidden');
      this.input = new Input(this.root);
      this.hud = new Hud(this.root, game, {
        onMenu: () => this.toMenu(),
        onReset: () => this.reset(),
        onToggleView: () => this.renderer?.toggleView?.(),
        onToggleMap: () => this.toggleMap(),
        onToggleMute: () => this.sfx.toggleMute(),
        onPause: () => this.setPaused(true),
        onResume: () => this.setPaused(false),
        onPlayRecord: (i) => {
          if (this.sfx.playingRecord === i) {
            this.sfx.stopRecord();
            return false;
          }
          this.sfx.playRecord(i);
          return true;
        },
        onCycleDay: settings.mode === '3d' ? () => this.cycleDay() : undefined,
        dayLabel: () => DAY_LABELS[this.dayMode],
      });
      this.hud.setMuted(this.sfx.muted);
      if (settings.mode === 'sv') {
        this.setLoading('Google Street View açılıyor…');
        const { StreetViewMode } = await import('./render/streetview');
        const sv = new StreetViewMode(this.root, game, settings.key, this.input);
        try {
          await sv.ready;
        } catch (err) {
          sv.dispose();
          game.config = CONFIG_3D;
          this.renderer = await this.make3D(game);
          // shown once the 3D city is up so the message is not lost behind the loading screen
          this.hud.toast(`Street View açılamadı: ${(err as Error).message}. 3D moda geçildi.`, 'warn', '⚠️');
        }
        if (!this.renderer) this.renderer = sv;
      } else {
        this.renderer = await this.make3D(game);
      }
      this.hud.projector = (x, y, h) => this.renderer?.project(x, y, h) ?? null;
      try {
        const dm = store?.getItem('ysu:daymode') as DayMode | null;
        if (dm && dm in DAY_LABELS) this.dayMode = dm;
      } catch {
        /* ignore */
      }
      this.applyDayMode();
      this.minimap = new Minimap(this.hud.minimapSlot, game);
      this.bigmap = new BigMap(this.root, game);
      this.wireEvents(game);
      this.input.onAction((a) => this.onAction(a));
      this.setLoading(null);
      if (!store?.getItem('ysu:seen-help')) {
        this.hud.openModal('help');
        try {
          store?.setItem('ysu:seen-help', '1');
        } catch {
          /* ignore */
        }
      } else {
        this.hud.toast(`${area.name} — iyi gezmeler!`, 'info', '👋');
      }
      this.hud.toast(`Günün eşyası: ${game.dailyItem.name} — bugün iki kat puan!`, 'rare', game.dailyItem.emoji);
      (window as unknown as { __ysu: unknown }).__ysu = { game, app: this };
      this.lastT = performance.now();
      this.raf = requestAnimationFrame(this.loop);
    } catch (err) {
      console.error(err);
      this.teardown();
      this.setLoading(null);
      $('menu').classList.remove('hidden');
      this.menuError((err as Error).message || 'Bir hata oluştu.');
    }
  }

  private applyDayMode(): void {
    const w = (this.renderer as { world?: { dayTime: number; dayLength: number } } | null)?.world;
    if (!w) return;
    if (this.dayMode === 'auto') w.dayLength = 720;
    else {
      w.dayLength = 0;
      w.dayTime = this.dayMode === 'day' ? 0.45 : 0.95;
    }
  }

  private cycleDay(): string {
    const order: DayMode[] = ['auto', 'day', 'night'];
    this.dayMode = order[(order.indexOf(this.dayMode) + 1) % order.length];
    try {
      store?.setItem('ysu:daymode', this.dayMode);
    } catch {
      /* ignore */
    }
    this.applyDayMode();
    return DAY_LABELS[this.dayMode];
  }

  private async make3D(game: Game): Promise<Renderer> {
    const { World3D } = await import('./render/world3d');
    const w = new World3D(this.root, game);
    // start at the real time of day so evening players get the lit-up city
    const now = new Date();
    w.dayTime = (now.getHours() + now.getMinutes() / 60) / 24;
    return {
      update: (dt) => w.update(dt),
      resize: () => w.resize(),
      dispose: () => w.dispose(),
      project: (x, y, h) => w.project(x, y, h),
      toggleView: () => {
        const order = ['third', 'first', 'top'] as const;
        w.view = order[(order.indexOf(w.view) + 1) % order.length];
        this.hud?.toast(w.view === 'first' ? 'Birinci şahıs kamera' : w.view === 'top' ? 'Kuşbakışı kamera' : 'Takip kamerası', 'info', '🎥');
      },
      setPixelRatio: (r: number) => w.renderer.setPixelRatio(r),
      world: w,
    } as Renderer & { setPixelRatio(r: number): void; world: unknown };
  }

  private wireEvents(game: Game): void {
    game.on((e) => {
      switch (e.type) {
        case 'collect':
          if (e.item.def.kind === 'record') this.sfx.record();
          else if (e.item.def.kind === 'powerup') this.sfx.powerup();
          else if (e.item.def.rarity === 'efsane' || e.item.def.rarity === 'nadir') this.sfx.rare();
          else this.sfx.pickup(e.mult);
          break;
        case 'feed':
          this.sfx.meow();
          break;
        case 'badge':
          this.sfx.badge();
          break;
        case 'level':
          this.sfx.level();
          break;
        case 'quest-done':
          this.sfx.quest();
          break;
        case 'street-done':
          this.sfx.street();
          break;
        case 'toast':
          if (e.kind === 'warn') this.sfx.meow();
          else if (e.kind === 'rare') this.sfx.rare();
          break;
        default:
          break;
      }
    });
  }

  private onAction(a: string): void {
    if (!this.hud) return;
    if (a === 'pause') {
      if (this.bigmap?.open) this.toggleMap();
      else if (this.hud.modalOpen) this.hud.closeModal();
      else this.hud.openModal('pause');
      return;
    }
    if (a === 'map') return this.toggleMap();
    if (a === 'album') return this.hud.toggleModal('album');
    if (a === 'help') return this.hud.toggleModal('help');
    if (a === 'view') return this.renderer?.toggleView?.();
    if (a === 'mute') return this.hud.setMuted(this.sfx.toggleMute());
    if (!this.paused) this.renderer?.onAction?.(a);
  }

  private toggleMap(): void {
    if (!this.bigmap) return;
    this.bigmap.toggle();
    this.setPaused(this.bigmap.open || !!this.hud?.modalOpen);
  }

  private setPaused(p: boolean): void {
    this.paused = p || !!this.bigmap?.open || !!this.hud?.modalOpen;
    if (this.input) this.input.enabled = !this.paused;
  }

  private loop = (t: number) => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, (t - this.lastT) / 1000);
    this.lastT = t;
    const game = this.game;
    if (!game || !this.renderer) return;
    if (!this.paused) {
      game.update(dt, this.renderer.drivesPlayer ? null : this.input!.read());
    }
    this.renderer.update(this.paused ? 0 : dt);
    this.hud!.update();
    this.minimap!.draw();
    this.bigmap!.draw();
    // adaptive resolution: drop to 1x pixel ratio when frames are slow
    if (dt > 0.034) this.slowFrames++;
    else this.slowFrames = Math.max(0, this.slowFrames - 1);
    const r = this.renderer as Renderer & { setPixelRatio?(r: number): void };
    if (this.slowFrames > 90 && r.setPixelRatio && window.devicePixelRatio > 1) {
      r.setPixelRatio(1);
      this.slowFrames = -100000;
    }
  };

  private teardown(): void {
    cancelAnimationFrame(this.raf);
    this.sfx.stopRecord();
    this.game?.save();
    this.renderer?.dispose();
    this.input?.dispose();
    this.root.innerHTML = '';
    this.game = null;
    this.renderer = null;
    this.hud = null;
    this.minimap = null;
    this.bigmap = null;
    this.input = null;
    this.paused = false;
  }

  toMenu(): void {
    this.teardown();
    $('menu').classList.remove('hidden');
    this.updateMenu();
  }

  private reset(): void {
    if (!this.game) return;
    const id = this.game.progress.area;
    this.teardown();
    try {
      store?.removeItem(saveKey(id));
    } catch {
      /* ignore */
    }
    void this.start(loadSettings());
  }
}

new App();
