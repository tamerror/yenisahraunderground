import type { Game } from '../core/game';
import { wrapAngle } from '../core/geo';
import type { Input } from '../ui/input';
import { QUEST_COLORS } from './minimap';

/* Minimal typings for the parts of the Google Maps JS API we use. */
interface LatLngLiteral {
  lat: number;
  lng: number;
}
interface GLatLng {
  lat(): number;
  lng(): number;
}
interface Pov {
  heading: number;
  pitch: number;
}
interface SvLink {
  heading: number | null;
  pano: string | null;
}
interface SvPanorama {
  setPano(p: string): void;
  getPosition(): GLatLng | null;
  getPov(): Pov;
  setPov(p: Pov): void;
  getZoom(): number;
  getLinks(): SvLink[] | null;
  addListener(ev: string, fn: () => void): { remove(): void };
  setVisible(v: boolean): void;
}
interface SvLib {
  StreetViewPanorama: new (el: HTMLElement, opts: Record<string, unknown>) => SvPanorama;
  StreetViewService: new () => {
    getPanorama(req: Record<string, unknown>): Promise<{ data: { location?: { pano: string; latLng?: GLatLng } } }>;
  };
  StreetViewSource?: Record<string, string>;
  StreetViewPreference?: Record<string, string>;
}
interface GoogleNs {
  maps: SvLib & { importLibrary?: (n: string) => Promise<SvLib> };
}

declare global {
  interface Window {
    google?: GoogleNs;
    gm_authFailure?: () => void;
    __ysuGmReady?: () => void;
  }
}

const D2R = Math.PI / 180;
const CAMERA_H = 2.6;
const OVERLAY_DIST = 95;

let loader: Promise<SvLib> | null = null;

/** Loads the Maps JS API once per page. */
export function loadGoogleMaps(key: string): Promise<SvLib> {
  if (loader) return loader;
  loader = new Promise<SvLib>((resolve, reject) => {
    const fail = (msg: string) => {
      loader = null;
      reject(new Error(msg));
    };
    window.gm_authFailure = () => fail('API anahtarı reddedildi (Maps JavaScript API etkin mi, faturalandırma açık mı?)');
    window.__ysuGmReady = async () => {
      try {
        const g = window.google!.maps;
        resolve(g.importLibrary ? await g.importLibrary('streetView') : g);
      } catch (e) {
        fail((e as Error).message);
      }
    };
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&callback=__ysuGmReady&language=tr&region=TR`;
    s.async = true;
    s.onerror = () => fail('Google Maps yüklenemedi (internet bağlantısı?)');
    document.head.appendChild(s);
    setTimeout(() => fail('Google Maps yanıt vermedi'), 20000);
  });
  return loader;
}

/** Picks the Street View link whose heading is closest to `heading` (degrees), within `maxDiff`. */
export function chooseLink(links: SvLink[], heading: number, maxDiff = 70): SvLink | null {
  let best: SvLink | null = null;
  let bd = Infinity;
  for (const l of links) {
    if (l.heading == null || !l.pano) continue;
    const d = Math.abs(wrapAngle((l.heading - heading) * D2R)) / D2R;
    if (d < bd) {
      bd = d;
      best = l;
    }
  }
  return bd <= maxDiff ? best : null;
}

export interface SvCamera {
  /** degrees */
  heading: number;
  pitch: number;
  zoom: number;
  w: number;
  h: number;
}

/** Projects a point at (dx east, dy north, dz up relative to the camera) onto the panorama view. */
export function projectToView(dx: number, dy: number, dz: number, cam: SvCamera): { x: number; y: number; d: number } | null {
  const d = Math.hypot(dx, dy);
  const rel = wrapAngle(Math.atan2(dx, dy) - cam.heading * D2R);
  if (Math.abs(rel) > Math.PI / 2 - 0.05) return null;
  const hfov = (180 / Math.pow(2, cam.zoom)) * D2R;
  const th = Math.tan(hfov / 2);
  const tv = (th * cam.h) / cam.w;
  const x = cam.w / 2 + (Math.tan(rel) / th) * (cam.w / 2);
  const pitch = Math.atan2(dz, d) - cam.pitch * D2R;
  const y = cam.h / 2 - (Math.tan(pitch) / tv) * (cam.h / 2) / Math.cos(rel);
  return { x, y, d };
}

export class StreetViewMode {
  readonly drivesPlayer = true;
  readonly ready: Promise<void>;
  private pano: SvPanorama | null = null;
  private readonly el: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private stepCooldown = 0;
  private time = 0;
  private listeners: { remove(): void }[] = [];

  constructor(root: HTMLElement, private readonly game: Game, key: string, private readonly input: Input) {
    this.el = document.createElement('div');
    this.el.className = 'sv-pano';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'sv-overlay';
    root.append(this.el, this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.ready = this.init(key);
  }

  private async init(key: string): Promise<void> {
    const lib = await loadGoogleMaps(key);
    const svc = new lib.StreetViewService();
    const p = this.game.player;
    const [lng, lat] = this.game.proj.toLonLat(p);
    let panoId: string | null = null;
    for (const radius of [40, 150, 500]) {
      try {
        const res = await svc.getPanorama({
          location: { lat, lng } as LatLngLiteral,
          radius,
          source: lib.StreetViewSource?.OUTDOOR ?? 'outdoor',
          preference: lib.StreetViewPreference?.NEAREST ?? 'nearest',
        });
        panoId = res.data.location?.pano ?? null;
        if (panoId) break;
      } catch {
        /* try a larger radius */
      }
    }
    if (!panoId) throw new Error('Bu konumda Street View görüntüsü yok');
    this.pano = new lib.StreetViewPanorama(this.el, {
      pano: panoId,
      pov: { heading: (p.heading / D2R + 360) % 360, pitch: 0 },
      zoom: 1,
      addressControl: false,
      fullscreenControl: false,
      motionTracking: false,
      motionTrackingControl: false,
      panControl: false,
      zoomControl: false,
      enableCloseButton: false,
      showRoadLabels: true,
      linksControl: true,
      clickToGo: true,
      keyboardShortcuts: false,
    });
    this.listeners.push(
      this.pano.addListener('position_changed', () => this.sync()),
      this.pano.addListener('pov_changed', () => this.sync()),
    );
    this.sync();
  }

  private sync(): void {
    if (!this.pano) return;
    const pos = this.pano.getPosition();
    if (!pos) return;
    const v = this.game.proj.toLocal([pos.lng(), pos.lat()]);
    this.game.setPlayerPose(v.x, v.y, wrapAngle(this.pano.getPov().heading * D2R));
  }

  /** Move one panorama forward (dir = 1) or backward (-1). */
  step(dir: 1 | -1): boolean {
    if (!this.pano) return false;
    const links = this.pano.getLinks() ?? [];
    const h = this.pano.getPov().heading + (dir < 0 ? 180 : 0);
    const link = chooseLink(links, h, dir > 0 ? 70 : 60);
    if (!link?.pano) return false;
    this.pano.setPano(link.pano);
    return true;
  }

  onAction(a: string): void {
    if (a === 'step-forward' && this.stepCooldown <= 0) {
      this.step(1);
      this.stepCooldown = 0.5;
    }
    if (a === 'step-back' && this.stepCooldown <= 0) {
      this.step(-1);
      this.stepCooldown = 0.5;
    }
  }

  resize(): void {
    /* the overlay canvas tracks its CSS size every frame */
  }

  toggleView(): void {
    this.canvas.classList.toggle('hidden');
  }

  private camera(): SvCamera {
    const pov = this.pano?.getPov() ?? { heading: this.game.player.heading / D2R, pitch: 0 };
    return { heading: pov.heading, pitch: pov.pitch, zoom: this.pano?.getZoom() ?? 1, w: this.canvas.clientWidth, h: this.canvas.clientHeight };
  }

  project(x: number, y: number, h = 1.5): { x: number; y: number } | null {
    const p = this.game.player;
    const r = projectToView(x - p.x, y - p.y, h - CAMERA_H, this.camera());
    return r ? { x: r.x, y: r.y } : null;
  }

  update(dt: number): void {
    this.time += dt;
    if (this.pano && dt > 0) {
      const inp = this.input.read();
      if (inp.turn) {
        const pov = this.pano.getPov();
        this.pano.setPov({ heading: (pov.heading + inp.turn * 80 * dt + 360) % 360, pitch: pov.pitch });
      }
      this.stepCooldown -= dt;
      // holding forward/back keeps walking from panorama to panorama
      if (inp.forward !== 0 && this.stepCooldown <= 0) {
        this.step(inp.forward > 0 ? 1 : -1);
        this.stepCooldown = inp.run ? 0.35 : 0.6;
      }
    }
    this.drawOverlay();
  }

  private drawOverlay(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const cam = this.camera();
    const g = this.game;
    const p = g.player;
    type Sprite = { x: number; y: number; d: number; draw: (s: { x: number; y: number; d: number }) => void };
    const sprites: Sprite[] = [];
    const add = (x: number, y: number, z: number, maxD: number, draw: Sprite['draw']) => {
      const dx = x - p.x;
      const dy = y - p.y;
      if (dx * dx + dy * dy > maxD * maxD) return;
      const s = projectToView(dx, dy, z - CAMERA_H, cam);
      if (s && s.x > -100 && s.x < w + 100) sprites.push({ ...s, draw });
    };
    for (const it of g.items) {
      add(it.x, it.y, 1.2 + Math.sin(it.phase) * 0.25, OVERLAY_DIST, (s) => {
        const size = Math.max(16, Math.min(110, 1100 / Math.max(4, s.d)));
        const glow = it.def.rarity === 'efsane' ? '255,193,7' : it.def.rarity === 'nadir' ? '186,104,200' : '255,255,255';
        const grad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, size * 0.9);
        grad.addColorStop(0, `rgba(${glow},0.55)`);
        grad.addColorStop(1, `rgba(${glow},0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(s.x, s.y, size * 0.9, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = `${size}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(it.def.emoji, s.x, s.y);
      });
    }
    g.cats.forEach((c) => {
      add(c.x, c.y, 0.5, OVERLAY_DIST, (s) => {
        const size = Math.max(18, Math.min(100, 900 / Math.max(4, s.d)));
        ctx.font = `${size}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🐈', s.x, s.y);
        const fed = g.progress.fed[c.def.id];
        ctx.font = `600 ${Math.max(11, size * 0.28)}px system-ui,sans-serif`;
        const label = `${c.def.name}${c.follow > 0 ? ' ❤' : fed ? '' : ' 🐟?'}`;
        const tw = ctx.measureText(label).width + 12;
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.fillRect(s.x - tw / 2, s.y - size * 0.95, tw, size * 0.36);
        ctx.fillStyle = '#3b2a1a';
        ctx.fillText(label, s.x, s.y - size * 0.77);
      });
    });
    g.progress.quests.forEach((q, i) => {
      const t = g.questTargetPoint(q);
      if (!t) return;
      add(t.x, t.y, 6, 5000, (s) => {
        ctx.fillStyle = QUEST_COLORS[i];
        ctx.strokeStyle = '#111';
        ctx.lineWidth = 2;
        const y = Math.max(40, Math.min(h - 120, s.y));
        ctx.beginPath();
        ctx.moveTo(s.x, y + 14);
        ctx.lineTo(s.x - 10, y);
        ctx.lineTo(s.x, y - 14);
        ctx.lineTo(s.x + 10, y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.font = '600 13px system-ui,sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#fff';
        ctx.strokeText(`${Math.round(s.d)} m`, s.x, y + 28);
        ctx.fillText(`${Math.round(s.d)} m`, s.x, y + 28);
      });
    });
    sprites.sort((a, b) => b.d - a.d);
    for (const s of sprites) s.draw(s);

    // compass power-up: arrow at the top of the screen
    const target = (g.powerups.pusula ?? 0) > 0 ? g.compassTarget() : null;
    if (target) {
      const rel = wrapAngle(Math.atan2(target.x - p.x, target.y - p.y) - cam.heading * D2R);
      ctx.save();
      ctx.translate(w / 2, 110);
      ctx.rotate(rel);
      ctx.fillStyle = '#ffb300';
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -26);
      ctx.lineTo(16, 14);
      ctx.lineTo(0, 6);
      ctx.lineTo(-16, 14);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  dispose(): void {
    for (const l of this.listeners) l.remove();
    this.pano?.setVisible(false);
    this.el.remove();
    this.canvas.remove();
  }
}
