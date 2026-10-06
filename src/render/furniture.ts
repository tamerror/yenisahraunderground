import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Game } from '../core/game';
import { hashString, mulberry32 } from '../core/rng';
import { ROAD_HALF_WIDTH, type StreetNetwork } from '../core/streets';
import type { BuildingIndex } from './city';

function painted(g: THREE.BufferGeometry, color: string, m: THREE.Matrix4): THREE.BufferGeometry {
  const n = (g.index ? g.toNonIndexed() : g).applyMatrix4(m);
  const c = new THREE.Color(color);
  const arr = new Float32Array(n.attributes.position.count * 3);
  for (let i = 0; i < arr.length; i += 3) arr.set([c.r, c.g, c.b], i);
  n.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  n.deleteAttribute('uv');
  return n;
}

const T = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);

/** A small hatchback, 4 m long along +X, white body (tinted per instance), dark glass and tyres. */
function carGeometry(): THREE.BufferGeometry {
  const parts = [
    painted(new THREE.BoxGeometry(4.1, 0.75, 1.75), '#ffffff', T(0, 0.62, 0)),
    painted(new THREE.BoxGeometry(2.3, 0.62, 1.6), '#ffffff', T(-0.25, 1.28, 0)),
    painted(new THREE.BoxGeometry(2.36, 0.46, 1.64), '#1d2430', T(-0.25, 1.3, 0)),
    painted(new THREE.BoxGeometry(0.08, 0.18, 1.5), '#fff6c8', T(2.06, 0.72, 0)),
    painted(new THREE.BoxGeometry(0.08, 0.16, 1.5), '#b71c1c', T(-2.06, 0.75, 0)),
  ];
  for (const [x, z] of [[1.3, 0.8], [-1.3, 0.8], [1.3, -0.8], [-1.3, -0.8]])
    parts.push(painted(new THREE.CylinderGeometry(0.33, 0.33, 0.24, 10).rotateX(Math.PI / 2), '#151515', T(x, 0.33, z)));
  return mergeGeometries(parts)!;
}

const CAR_COLORS = ['#e9e9e9', '#f4f4f4', '#2b2b2b', '#9ea4ab', '#c0392b', '#1f4e79', '#7f8c8d', '#d5c9a8', '#2e7d32', '#f1c40f'];

/** Parked cars along residential streets, grouped in spatial chunks so frustum culling works. */
export function buildParkedCars(net: StreetNetwork, bidx: BuildingIndex, seed: string, focus: Set<string> | null): THREE.Group {
  const rng = mulberry32(hashString(`${seed}:cars`));
  const spots: { x: number; y: number; a: number; c: string }[] = [];
  for (const s of net.segs) {
    if (!s.main || (s.kind !== 'residential' && s.kind !== 'tertiary' && s.kind !== 'minor')) continue;
    if (s.len < 14) continue;
    const prob = focus && s.name && focus.has(s.name) ? 0.42 : 0.2;
    const rh = ROAD_HALF_WIDTH[s.kind];
    const n = Math.floor((s.len - 12) / 6.5);
    for (let i = 0; i < n; i++)
      for (const side of [-1, 1]) {
        if (rng() > prob) continue;
        const t = (6 + i * 6.5 + 3) / s.len;
        const p = net.pointOnSegment(s, t, side * (rh - 0.95));
        if (bidx.inside(p)) continue;
        const a = Math.atan2(s.by - s.ay, s.bx - s.ax);
        spots.push({ x: p.x, y: p.y, a, c: CAR_COLORS[Math.floor(rng() * CAR_COLORS.length)] });
      }
  }
  const group = new THREE.Group();
  const geo = carGeometry();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const chunks = new Map<string, typeof spots>();
  for (const sp of spots) {
    const k = `${Math.floor(sp.x / 220)},${Math.floor(sp.y / 220)}`;
    const c = chunks.get(k);
    if (c) c.push(sp);
    else chunks.set(k, [sp]);
  }
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);
  const col = new THREE.Color();
  for (const list of chunks.values()) {
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((sp, i) => {
      q.setFromAxisAngle(up, sp.a);
      m.compose(new THREE.Vector3(sp.x, 0.1, -sp.y), q, one);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, col.set(sp.c));
    });
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  return group;
}

const AWNING_COLORS = ['#c62828', '#2e7d32', '#1565c0', '#ef6c00', '#6a1b9a', '#00838f'];

/** Shop awnings on the street edge in front of shops, cafes and bakeries. */
export function buildAwnings(game: Game): THREE.InstancedMesh {
  const types = new Set(['shop', 'food', 'cafe', 'bakery', 'market', 'pharmacy', 'pet']);
  const spots: { x: number; y: number; a: number; c: string }[] = [];
  for (const poi of game.pois) {
    if (!types.has(poi.type) || poi.reach > 30) continue;
    const hit = game.net.nearest(poi, 35);
    if (!hit || ROAD_HALF_WIDTH[hit.seg.kind] === 0) continue;
    const s = hit.seg;
    const nx = -(s.by - s.ay) / s.len;
    const ny = (s.bx - s.ax) / s.len;
    const side = (poi.x - hit.x) * nx + (poi.y - hit.y) * ny >= 0 ? 1 : -1;
    const off = s.hw - 0.4;
    const x = hit.x + nx * side * off;
    const y = hit.y + ny * side * off;
    if (spots.some((o) => Math.hypot(o.x - x, o.y - y) < 3.5)) continue;
    // the awning hangs from the facade line and slopes down towards the street centre
    const dx = -nx * side;
    const dy = -ny * side;
    spots.push({ x, y, a: Math.atan2(-dx, dy), c: AWNING_COLORS[hashString(poi.name) % AWNING_COLORS.length] });
  }
  const geo = new THREE.BoxGeometry(3.2, 0.08, 1.5).translate(0, 0, -0.75).rotateX(-0.35);
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: '#ffffff' }), Math.max(1, spots.length));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const col = new THREE.Color();
  spots.forEach((sp, i) => {
    // the box extends along local -Z; rotate that onto the facade-to-street direction
    q.setFromEuler(e.set(0, sp.a, 0));
    m.compose(new THREE.Vector3(sp.x, 3.0, -sp.y), q, new THREE.Vector3(1, 1, 1));
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, col.set(sp.c));
  });
  mesh.count = spots.length;
  mesh.computeBoundingSphere();
  return mesh;
}

/** Istanbul-style blue street name plate, e.g. "ATALAY CD." with the neighbourhood above. */
function plateTexture(street: string, mahalle: string): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 144;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#123f8c';
  ctx.fillRect(0, 0, 512, 144);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 6;
  ctx.strokeRect(8, 8, 496, 128);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '600 22px system-ui, sans-serif';
  ctx.fillText(`${mahalle.toLocaleUpperCase('tr-TR')} MAH.`, 256, 34);
  let size = 52;
  ctx.font = `800 ${size}px system-ui, sans-serif`;
  while (ctx.measureText(street).width > 460 && size > 24) {
    size -= 2;
    ctx.font = `800 ${size}px system-ui, sans-serif`;
  }
  ctx.fillText(street, 256, 90);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function abbreviateStreet(name: string): string {
  return name
    .replace(/\bCaddesi\b/, 'CD.')
    .replace(/\bSokağı\b/, 'SK.')
    .replace(/\bSokak\b/, 'SK.')
    .replace(/\bBulvarı\b/, 'BLV.')
    .replace(/\bYolu\b/, 'YOLU')
    .toLocaleUpperCase('tr-TR');
}

interface SignSpot {
  node: number;
  x: number;
  y: number;
  plates: { name: string; angle: number }[];
}

/** Street name signs at intersections, created lazily near the player. */
export class StreetSigns {
  private readonly spots: SignSpot[] = [];
  private readonly live = new Map<number, THREE.Group>();
  private readonly pole = new THREE.CylinderGeometry(0.05, 0.05, 2.9, 6).translate(0, 1.45, 0);
  private readonly poleMat = new THREE.MeshLambertMaterial({ color: '#56606b' });
  private readonly plateGeo = new THREE.PlaneGeometry(1.5, 0.42);
  private readonly mahalle: string;

  constructor(private readonly scene: THREE.Scene, private readonly game: Game) {
    this.mahalle = game.area.name.replace(/\s*\(.*\)$/, '');
    const net = game.net;
    net.nodes.forEach((n, idx) => {
      if (n.segs.length < 3) return;
      const named = new Map<string, number>();
      for (const si of n.segs) {
        const s = net.segs[si];
        if (!s.main || !s.name || named.has(s.name) || s.kind === 'footway' || s.kind === 'steps') continue;
        named.set(s.name, Math.atan2(s.by - s.ay, s.bx - s.ax));
      }
      if (named.size < 2) return;
      // put the pole on the corner between the first two named streets
      const [[, a1], [, a2]] = [...named.entries()];
      let hw = 0;
      for (const si of n.segs) hw = Math.max(hw, net.segs[si].hw);
      const bis = Math.atan2(Math.sin(a1) + Math.sin(a2), Math.cos(a1) + Math.cos(a2)) + Math.PI / 4;
      const x = n.x + Math.cos(bis) * (hw - 0.4);
      const y = n.y + Math.sin(bis) * (hw - 0.4);
      this.spots.push({ node: idx, x, y, plates: [...named.entries()].slice(0, 2).map(([name, angle]) => ({ name, angle })) });
    });
  }

  private make(sp: SignSpot): THREE.Group {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(this.pole, this.poleMat));
    sp.plates.forEach((pl, i) => {
      const tex = plateTexture(abbreviateStreet(pl.name), this.mahalle);
      const mat = new THREE.MeshBasicMaterial({ map: tex });
      // two single-sided faces so the text reads correctly from both sides
      const plate = new THREE.Group();
      const front = new THREE.Mesh(this.plateGeo, mat);
      const back = new THREE.Mesh(this.plateGeo, mat);
      back.rotation.y = Math.PI;
      plate.add(front, back);
      // plates run parallel to their street (local x/y angle -> world rotation about Y) and hang off the pole
      plate.rotation.y = pl.angle;
      plate.position.set(Math.cos(pl.angle) * 0.8, 2.75 - i * 0.5, -Math.sin(pl.angle) * 0.8);
      g.add(plate);
    });
    g.position.set(sp.x, 0.1, -sp.y);
    return g;
  }

  update(): void {
    const p = this.game.player;
    for (const sp of this.spots) {
      const d = Math.hypot(sp.x - p.x, sp.y - p.y);
      const has = this.live.get(sp.node);
      if (d < 75 && !has && this.live.size < 24) {
        const g = this.make(sp);
        this.scene.add(g);
        this.live.set(sp.node, g);
      } else if (d > 95 && has) {
        this.scene.remove(has);
        has.children.forEach((c, i) => {
          if (i === 0) return;
          const m = (c.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
          m.map?.dispose();
          m.dispose();
        });
        this.live.delete(sp.node);
      }
    }
  }

  get count(): number {
    return this.spots.length;
  }
}
