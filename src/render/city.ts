import * as THREE from 'three';
import { centroid, polygonArea, pointInPolygon } from '../core/geo';
import { hashString, mulberry32 } from '../core/rng';
import { ROAD_HALF_WIDTH, type StreetNetwork } from '../core/streets';
import type { AreaData, AreaType, Vec2 } from '../core/types';
import type { Projection } from '../core/geo';

/** Local (x east, y north) to three.js world: X = x, Z = -y. */
export const toWorld = (p: Vec2, h = 0) => new THREE.Vector3(p.x, h, -p.y);

const FACADES = ['#efe6d2', '#e8d8b8', '#d9c3a0', '#f2ede4', '#e7c9a9', '#cfd6d6', '#e9dcc9', '#d8b48c', '#f0d9c4', '#c9c0b0', '#e4e0d0', '#ddc6b6'];
const ROOFS = ['#8a8580', '#9b948b', '#a0522d', '#7d7a75', '#b5651d'];

export interface BuildingInfo {
  ring: Vec2[];
  height: number;
}

/** Simple grid of building footprints for point-in-building queries. */
export class BuildingIndex {
  private cells = new Map<string, number[]>();
  constructor(readonly buildings: BuildingInfo[], private size = 30) {
    buildings.forEach((b, i) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of b.ring) {
        x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
      }
      for (let ix = Math.floor(x0 / size); ix <= Math.floor(x1 / size); ix++)
        for (let iy = Math.floor(y0 / size); iy <= Math.floor(y1 / size); iy++) {
          const k = `${ix},${iy}`;
          const c = this.cells.get(k);
          if (c) c.push(i);
          else this.cells.set(k, [i]);
        }
    });
  }
  inside(p: Vec2): boolean {
    const c = this.cells.get(`${Math.floor(p.x / this.size)},${Math.floor(p.y / this.size)}`);
    if (!c) return false;
    for (const i of c) if (pointInPolygon(p, this.buildings[i].ring)) return true;
    return false;
  }
}

export function buildingInfos(area: AreaData, proj: Projection): BuildingInfo[] {
  return area.buildings.map((b, i) => {
    let ring = b.c.map((p) => proj.toLocal(p));
    if (polygonArea(ring) < 0) ring = ring.reverse();
    const rng = mulberry32(hashString(`b${i}:${b.c[0][0]}`));
    const area = Math.abs(polygonArea(ring));
    let floors: number;
    if (b.f) floors = b.f;
    else if (area < 40) floors = 1 + Math.floor(rng() * 2);
    else if (area > 1500) floors = 6 + Math.floor(rng() * 8);
    else floors = 3 + Math.floor(rng() * 5);
    const height = b.h ?? floors * 3 + 0.6 + rng() * 0.6;
    return { ring, height };
  });
}

/** Buildings as a single geometry. Attribute `aWall` = (u along facade, v height, total height); roofs use v = -1. */
export function buildBuildings(infos: BuildingInfo[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const wall: number[] = [];
  const c = new THREE.Color();
  infos.forEach((b, i) => {
    const rng = mulberry32(hashString(`c${i}`));
    const facade = new THREE.Color(FACADES[Math.floor(rng() * FACADES.length)]);
    facade.offsetHSL(0, 0, (rng() - 0.5) * 0.06);
    const roof = new THREE.Color(ROOFS[Math.floor(rng() * ROOFS.length)]);
    const h = b.height;
    const r = b.ring;
    let u = rng() * 10;
    for (let k = 0; k < r.length; k++) {
      const a = r[k];
      const bb = r[(k + 1) % r.length];
      const len = Math.hypot(bb.x - a.x, bb.y - a.y);
      if (len < 0.01) continue;
      // outward normal of a CCW ring in local coords is (dy, -dx); world z = -y
      const nx = (bb.y - a.y) / len;
      const ny = -(bb.x - a.x) / len;
      const quad = [
        [a.x, 0, -a.y, u, 0],
        [bb.x, 0, -bb.y, u + len, 0],
        [bb.x, h, -bb.y, u + len, h],
        [a.x, 0, -a.y, u, 0],
        [bb.x, h, -bb.y, u + len, h],
        [a.x, h, -a.y, u, h],
      ];
      for (const q of quad) {
        pos.push(q[0], q[1], q[2]);
        nor.push(nx, 0, -ny);
        col.push(facade.r, facade.g, facade.b);
        wall.push(q[3], q[4], h);
      }
      u += len;
    }
    const tris = THREE.ShapeUtils.triangulateShape(r.map((p) => new THREE.Vector2(p.x, p.y)), []);
    for (const t of tris)
      for (const idx of [t[0], t[1], t[2]]) {
        const p = r[idx];
        pos.push(p.x, h, -p.y);
        nor.push(0, 1, 0);
        col.push(roof.r, roof.g, roof.b);
        wall.push(0, -1, h);
      }
  });
  void c;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aWall', new THREE.Float32BufferAttribute(wall, 3));
  g.computeBoundingSphere();
  return g;
}

export const buildingUniforms = {
  uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
  uSunColor: { value: new THREE.Color(1, 0.96, 0.88) },
  uAmbient: { value: new THREE.Color(0.55, 0.58, 0.65) },
  uNight: { value: 0 },
};

export function buildingMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]) as Record<string, THREE.IUniform>,
    vertexColors: true,
    fog: true,
    vertexShader: /* glsl */ `
      attribute vec3 aWall;
      varying vec3 vColor;
      varying vec3 vNormal;
      varying vec3 vWall;
      #include <fog_pars_vertex>
      void main() {
        vColor = color;
        vNormal = normal;
        vWall = aWall;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec3 uAmbient;
      uniform float uNight;
      varying vec3 vColor;
      varying vec3 vNormal;
      varying vec3 vWall;
      #include <fog_pars_fragment>
      float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      void main() {
        vec3 base = vColor;
        vec3 emissive = vec3(0.0);
        if (vWall.y >= 0.0) {
          float fl = floor(vWall.y / 3.0);
          float fy = fract(vWall.y / 3.0);
          float col = floor(vWall.x / 3.2);
          float fx = fract(vWall.x / 3.2);
          float top = step(vWall.z - 0.7, vWall.y);
          float ground = 1.0 - step(3.0, vWall.y);
          float win = step(0.28, fx) * step(fx, 0.76) * step(0.32, fy) * step(fy, 0.80) * (1.0 - top);
          float shop = ground * step(0.08, fx) * step(fx, 0.92) * step(0.1, fy) * step(fy, 0.78) * step(10.0, vWall.z);
          win = max(win, shop);
          float seed = floor(vWall.z * 7.0);
          float h = hash(vec2(col + seed * 3.7, fl + seed));
          vec3 glass = mix(vec3(0.035, 0.05, 0.075), vec3(0.09, 0.15, 0.22), step(0.72, h));
          // balconies / shutters variety
          float shutter = step(0.88, h) * (1.0 - ground);
          glass = mix(glass, vColor * 0.75, shutter);
          base = mix(base, glass, win);
          float lit = step(0.45, hash(vec2(col * 1.7 + seed, fl * 3.1 + 17.0)));
          emissive = win * lit * uNight * vec3(1.0, 0.62, 0.25) * (shop > 0.5 ? 0.9 : 0.6);
          // floor slab lines and ground darkening
          base *= 1.0 - 0.08 * (1.0 - step(0.04, fy));
          base *= mix(0.72, 1.0, smoothstep(0.0, 2.2, vWall.y));
        }
        vec3 n = normalize(vNormal);
        float ndl = max(dot(n, uSunDir), 0.0);
        float side = 0.85 + 0.15 * abs(n.x);
        vec3 color = base * (uAmbient * side + uSunColor * ndl * 0.8) + emissive;
        gl_FragColor = vec4(color, 1.0);
        #include <fog_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

function pushQuad(pos: number[], col: number[], a: Vec2, b: Vec2, hw: number, y: number, c: THREE.Color): void {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 0.01) return;
  const nx = (-(b.y - a.y) / len) * hw;
  const ny = ((b.x - a.x) / len) * hw;
  const p = [
    [a.x + nx, a.y + ny],
    [a.x - nx, a.y - ny],
    [b.x - nx, b.y - ny],
    [b.x + nx, b.y + ny],
  ];
  for (const i of [0, 1, 2, 0, 2, 3]) {
    pos.push(p[i][0], y, -p[i][1]);
    col.push(c.r, c.g, c.b);
  }
}

function pushDisc(pos: number[], col: number[], o: Vec2, r: number, y: number, c: THREE.Color, n = 12): void {
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    pos.push(o.x, y, -o.y, o.x + Math.cos(a1) * r, y, -(o.y + Math.sin(a1) * r), o.x + Math.cos(a0) * r, y, -(o.y + Math.sin(a0) * r));
    for (let k = 0; k < 3; k++) col.push(c.r, c.g, c.b);
  }
}

/** Roads, sidewalks, paths and markings as one vertex-coloured geometry. */
export function buildRoads(net: StreetNetwork): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const sidewalk = new THREE.Color('#bdb7ab');
  const paving = new THREE.Color('#d2c3a3');
  const asphalt = new THREE.Color('#4a4c52');
  const asphaltMain = new THREE.Color('#3d3f45');
  const line = new THREE.Color('#f2f2f2');
  const Y_SIDE = 0.05;
  const Y_ROAD = 0.1;
  const Y_LINE = 0.13;
  for (const s of net.segs) {
    const a = { x: s.ax, y: s.ay };
    const b = { x: s.bx, y: s.by };
    const rh = ROAD_HALF_WIDTH[s.kind];
    pushQuad(pos, col, a, b, s.hw, Y_SIDE, rh ? sidewalk : paving);
    if (rh) {
      const c = s.kind === 'primary' || s.kind === 'secondary' ? asphaltMain : asphalt;
      pushQuad(pos, col, a, b, rh, Y_ROAD, c);
      if (s.kind === 'primary' || s.kind === 'secondary' || s.kind === 'tertiary') {
        // dashed centre line
        const n = Math.floor(s.len / 6);
        for (let i = 0; i < n; i++) {
          const t0 = (i * 6 + 1) / s.len;
          const t1 = (i * 6 + 4) / s.len;
          if (t1 > 1) break;
          pushQuad(
            pos,
            col,
            { x: s.ax + (s.bx - s.ax) * t0, y: s.ay + (s.by - s.ay) * t0 },
            { x: s.ax + (s.bx - s.ax) * t1, y: s.ay + (s.by - s.ay) * t1 },
            0.12,
            Y_LINE,
            line,
          );
        }
      }
    }
  }
  for (const n of net.nodes) {
    if (!n.segs.length) continue;
    let hw = 0;
    let rh = 0;
    for (const si of n.segs) {
      const s = net.segs[si];
      hw = Math.max(hw, s.hw);
      rh = Math.max(rh, ROAD_HALF_WIDTH[s.kind]);
    }
    pushDisc(pos, col, n, hw, Y_SIDE, rh ? sidewalk : paving);
    if (rh) {
      let mx = 0;
      for (const si of n.segs) mx = Math.max(mx, ROAD_HALF_WIDTH[net.segs[si].kind]);
      pushDisc(pos, col, n, mx, Y_ROAD + 0.001, asphalt);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

const AREA_COLORS: Record<AreaType, string> = {
  park: '#8bbf5a',
  grass: '#9cc76b',
  pitch: '#4f9a4a',
  school: '#d9cbb0',
  religious: '#d8d0c0',
};

export function buildAreas(area: AreaData, proj: Projection): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const order: AreaType[] = ['school', 'religious', 'grass', 'park', 'pitch'];
  for (const a of [...area.areas].sort((x, y) => order.indexOf(x.t) - order.indexOf(y.t))) {
    const ring = a.c.map((p) => proj.toLocal(p));
    if (ring.length < 3) continue;
    const c = new THREE.Color(AREA_COLORS[a.t]);
    const y = 0.02 + order.indexOf(a.t) * 0.003;
    const tris = THREE.ShapeUtils.triangulateShape(ring.map((p) => new THREE.Vector2(p.x, p.y)), []);
    for (const t of tris)
      for (const i of [t[0], t[1], t[2]]) {
        pos.push(ring[i].x, y, -ring[i].y);
        col.push(c.r, c.g, c.b);
      }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  return g;
}

/** Tree positions: inside parks and along residential sidewalks, never inside buildings or on roads. */
export function treeSpots(area: AreaData, proj: Projection, net: StreetNetwork, bidx: BuildingIndex): Vec2[] {
  const rng = mulberry32(hashString(`${area.name}:trees`));
  const out: Vec2[] = [];
  for (const a of area.areas) {
    if (a.t !== 'park' && a.t !== 'grass') continue;
    const ring = a.c.map((p) => proj.toLocal(p));
    const ar = Math.abs(polygonArea(ring));
    const n = Math.min(80, Math.floor(ar / 180));
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of ring) {
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
    }
    for (let i = 0, tries = 0; i < n && tries < n * 6; tries++) {
      const p = { x: x0 + rng() * (x1 - x0), y: y0 + rng() * (y1 - y0) };
      if (!pointInPolygon(p, ring) || net.inCorridor(p) || bidx.inside(p)) continue;
      out.push(p);
      i++;
    }
    void centroid;
  }
  for (const s of net.segs) {
    if (s.kind !== 'residential' && s.kind !== 'tertiary' && s.kind !== 'secondary') continue;
    const n = Math.floor(s.len / 14);
    for (let i = 0; i < n; i++) {
      if (rng() > 0.45) continue;
      const side = rng() < 0.5 ? -1 : 1;
      const p = net.pointOnSegment(s, (i + 0.5) / n, side * (s.hw - 0.7));
      if (bidx.inside(p)) continue;
      // keep clear of intersections
      const near = net.nearest(p, s.hw + 2);
      if (near && near.seg !== s && near.seg.kind !== 'footway') continue;
      out.push({ x: p.x, y: p.y });
    }
  }
  return out;
}
