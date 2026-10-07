import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Paint a geometry a single colour (non-indexed, with a colour attribute) so it can be merged. */
function paint(g: THREE.BufferGeometry, color: string, m?: THREE.Matrix4): THREE.BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g;
  if (m) n.applyMatrix4(m);
  const c = new THREE.Color(color);
  const arr = new Float32Array(n.attributes.position.count * 3);
  for (let i = 0; i < arr.length; i += 3) {
    arr[i] = c.r;
    arr[i + 1] = c.g;
    arr[i + 2] = c.b;
  }
  n.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  n.deleteAttribute('uv');
  return n;
}

const M = () => new THREE.Matrix4();
const T = (x: number, y: number, z: number) => M().makeTranslation(x, y, z);
const RX = (a: number) => M().makeRotationX(a);
const RZ = (a: number) => M().makeRotationZ(a);
const mul = (...ms: THREE.Matrix4[]) => ms.reduce((acc, m) => acc.multiply(m), M());

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false)!;
  g.computeBoundingSphere();
  return g;
}

/** Item models, roughly 1 m tall, origin at their visual centre. */
export function itemGeometry(id: string): THREE.BufferGeometry {
  switch (id) {
    case 'simit':
      return merge([
        paint(new THREE.TorusGeometry(0.42, 0.16, 10, 22), '#c8843a'),
        paint(new THREE.TorusGeometry(0.42, 0.165, 6, 22, Math.PI), '#e8c37a', mul(RZ(0.4), T(0, 0, 0.01))),
      ]);
    case 'cay': {
      const pts = [
        [0, -0.38], [0.16, -0.38], [0.2, -0.28], [0.14, -0.05], [0.13, 0.05], [0.2, 0.3], [0.22, 0.38], [0.2, 0.38],
      ].map(([x, y]) => new THREE.Vector2(x, y));
      return merge([
        paint(new THREE.LatheGeometry(pts, 14), '#b3261e'),
        paint(new THREE.CylinderGeometry(0.21, 0.21, 0.04, 14), '#f7d774', T(0, 0.37, 0)),
        paint(new THREE.CylinderGeometry(0.36, 0.3, 0.05, 16), '#fafafa', T(0, -0.42, 0)),
        paint(new THREE.TorusGeometry(0.3, 0.02, 4, 16), '#d32f2f', mul(T(0, -0.39, 0), RX(Math.PI / 2))),
      ]);
    }
    case 'lokum':
      return merge([
        paint(new THREE.BoxGeometry(0.32, 0.32, 0.32), '#f48fb1', T(-0.2, -0.12, 0)),
        paint(new THREE.BoxGeometry(0.32, 0.32, 0.32), '#fce4ec', T(0.2, -0.12, 0.05)),
        paint(new THREE.BoxGeometry(0.32, 0.32, 0.32), '#ec407a', mul(T(0, 0.2, 0), RZ(0.3))),
      ]);
    case 'kart':
      return merge([
        paint(new THREE.BoxGeometry(0.86, 0.54, 0.04), '#1e88e5'),
        paint(new THREE.BoxGeometry(0.86, 0.1, 0.045), '#e53935', T(0, -0.12, 0)),
        paint(new THREE.BoxGeometry(0.16, 0.12, 0.05), '#ffd54f', T(-0.25, 0.1, 0)),
      ]);
    case 'nazar':
      return merge([
        paint(new THREE.CylinderGeometry(0.45, 0.45, 0.08, 24), '#0d47a1', RX(Math.PI / 2)),
        paint(new THREE.CylinderGeometry(0.31, 0.31, 0.09, 24), '#fafafa', RX(Math.PI / 2)),
        paint(new THREE.CylinderGeometry(0.2, 0.2, 0.1, 20), '#4fc3f7', RX(Math.PI / 2)),
        paint(new THREE.CylinderGeometry(0.09, 0.09, 0.11, 14), '#111111', RX(Math.PI / 2)),
      ]);
    case 'altin':
      return merge([
        paint(new THREE.CylinderGeometry(0.42, 0.42, 0.08, 28), '#ffc107', RX(Math.PI / 2)),
        paint(new THREE.CylinderGeometry(0.32, 0.32, 0.09, 28), '#ffe082', RX(Math.PI / 2)),
      ]);
    case 'mama':
      return merge([
        paint(new THREE.SphereGeometry(0.3, 12, 8), '#4fc3f7', M().makeScale(1.4, 0.8, 0.5)),
        paint(new THREE.ConeGeometry(0.22, 0.3, 4), '#0288d1', mul(T(-0.5, 0, 0), RZ(Math.PI / 2))),
        paint(new THREE.SphereGeometry(0.05, 6, 4), '#111111', T(0.25, 0.06, 0.13)),
      ]);
    case 'miknatis':
      return merge([
        paint(new THREE.TorusGeometry(0.32, 0.12, 8, 18, Math.PI), '#e53935', RZ(Math.PI)),
        paint(new THREE.BoxGeometry(0.24, 0.2, 0.24), '#cfd8dc', T(-0.32, 0.1, 0)),
        paint(new THREE.BoxGeometry(0.24, 0.2, 0.24), '#cfd8dc', T(0.32, 0.1, 0)),
      ]);
    case 'scooter':
      return merge([
        paint(new THREE.BoxGeometry(0.9, 0.06, 0.2), '#43a047', T(0, -0.3, 0)),
        paint(new THREE.CylinderGeometry(0.03, 0.03, 0.75, 6), '#263238', mul(T(0.38, 0.05, 0), RZ(-0.15))),
        paint(new THREE.BoxGeometry(0.06, 0.04, 0.4), '#263238', T(0.44, 0.42, 0)),
        paint(new THREE.TorusGeometry(0.11, 0.04, 6, 12), '#212121', T(-0.4, -0.35, 0)),
        paint(new THREE.TorusGeometry(0.11, 0.04, 6, 12), '#212121', T(0.4, -0.35, 0)),
      ]);
    case 'pusula':
      return merge([
        paint(new THREE.CylinderGeometry(0.4, 0.4, 0.1, 24), '#8d6e63', RX(Math.PI / 2)),
        paint(new THREE.CylinderGeometry(0.33, 0.33, 0.11, 24), '#fff8e1', RX(Math.PI / 2)),
        paint(new THREE.ConeGeometry(0.06, 0.28, 4), '#e53935', T(0, 0.14, 0.06)),
        paint(new THREE.ConeGeometry(0.06, 0.28, 4), '#455a64', mul(T(0, -0.14, 0.06), RZ(Math.PI))),
      ]);
    case 'plak':
      return merge([
        paint(new THREE.CylinderGeometry(0.55, 0.55, 0.03, 32), '#151515', RX(Math.PI / 2)),
        paint(new THREE.TorusGeometry(0.4, 0.008, 3, 32), '#3a3a3a', T(0, 0, 0.016)),
        paint(new THREE.TorusGeometry(0.3, 0.008, 3, 32), '#3a3a3a', T(0, 0, 0.016)),
        paint(new THREE.CylinderGeometry(0.18, 0.18, 0.04, 20), '#d81b60', RX(Math.PI / 2)),
        paint(new THREE.CylinderGeometry(0.03, 0.03, 0.05, 8), '#fafafa', RX(Math.PI / 2)),
      ]);
    default:
      return paint(new THREE.IcosahedronGeometry(0.4), '#ffffff');
  }
}

export function treeGeometry(): THREE.BufferGeometry {
  return merge([
    paint(new THREE.CylinderGeometry(0.14, 0.2, 2.4, 6), '#6d4c41', T(0, 1.2, 0)),
    paint(new THREE.IcosahedronGeometry(1.6, 0), '#5f9e3b', mul(T(0, 3.4, 0), M().makeScale(1, 1.15, 1))),
    paint(new THREE.IcosahedronGeometry(1.1, 0), '#73b14a', T(0.5, 4.3, 0.3)),
  ]);
}

export function lampGeometry(): THREE.BufferGeometry {
  return merge([
    paint(new THREE.CylinderGeometry(0.06, 0.09, 5, 6), '#37474f', T(0, 2.5, 0)),
    paint(new THREE.BoxGeometry(0.9, 0.08, 0.12), '#37474f', T(0.4, 5, 0)),
  ]);
}

export interface Character {
  root: THREE.Group;
  update(dt: number, speed: number, scooter: boolean): void;
}

function box(w: number, h: number, d: number, color: string): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
  return m;
}

/** Low-poly player character facing +Z, feet at y = 0. */
export function createCharacter(): Character {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const hip = 0.9;
  const mkLimb = (w: number, len: number, color: string, shoe?: string) => {
    const pivot = new THREE.Group();
    const limb = box(w, len, w, color);
    limb.position.y = -len / 2;
    pivot.add(limb);
    if (shoe) {
      const s = box(w * 1.1, 0.12, w * 1.6, shoe);
      s.position.set(0, -len + 0.02, 0.05);
      pivot.add(s);
    }
    return pivot;
  };
  const legL = mkLimb(0.2, hip - 0.06, '#2f4f8f', '#f5f5f5');
  const legR = mkLimb(0.2, hip - 0.06, '#2f4f8f', '#f5f5f5');
  legL.position.set(-0.13, hip, 0);
  legR.position.set(0.13, hip, 0);
  const torso = box(0.56, 0.66, 0.32, '#00897b');
  torso.position.y = hip + 0.33;
  const stripe = box(0.57, 0.08, 0.33, '#ffca28');
  stripe.position.y = hip + 0.4;
  const armL = mkLimb(0.15, 0.62, '#00897b');
  const armR = mkLimb(0.15, 0.62, '#00897b');
  armL.position.set(-0.36, hip + 0.62, 0);
  armR.position.set(0.36, hip + 0.62, 0);
  const handL = box(0.13, 0.13, 0.13, '#e0ac69');
  handL.position.y = -0.66;
  armL.add(handL);
  const handR = handL.clone();
  armR.add(handR);
  const head = box(0.36, 0.38, 0.36, '#e0ac69');
  head.position.y = hip + 0.88;
  const cap = box(0.4, 0.13, 0.4, '#d32f2f');
  cap.position.y = hip + 1.1;
  const brim = box(0.36, 0.04, 0.22, '#d32f2f');
  brim.position.set(0, hip + 1.05, 0.26);
  const eyeL = box(0.05, 0.06, 0.02, '#222');
  eyeL.position.set(-0.08, hip + 0.92, 0.185);
  const eyeR = eyeL.clone();
  eyeR.position.x = 0.08;
  const bag = box(0.4, 0.45, 0.18, '#6d4c41');
  bag.position.set(0, hip + 0.35, -0.25);
  body.add(legL, legR, torso, stripe, armL, armR, head, cap, brim, eyeL, eyeR, bag);

  const scooter = new THREE.Mesh(itemGeometry('scooter'), new THREE.MeshLambertMaterial({ vertexColors: true }));
  scooter.scale.setScalar(1.3);
  scooter.rotation.y = -Math.PI / 2;
  scooter.position.y = 0.45;
  scooter.visible = false;
  root.add(scooter);

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.45, 16),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.16;
  root.add(shadow);

  let phase = 0;
  return {
    root,
    update(dt, speed, onScooter) {
      scooter.visible = onScooter;
      const s = Math.abs(speed);
      if (onScooter) {
        body.position.y = 0.55;
        legL.rotation.x = 0.1;
        legR.rotation.x = -0.1;
        armL.rotation.x = armR.rotation.x = -0.9;
        return;
      }
      body.position.y = 0;
      phase += dt * Math.min(14, 3 + s * 1.3) * (s > 0.2 ? 1 : 0);
      const amp = Math.min(0.8, s * 0.11);
      const sw = Math.sin(phase) * amp;
      legL.rotation.x = sw;
      legR.rotation.x = -sw;
      armL.rotation.x = -sw * 0.9;
      armR.rotation.x = sw * 0.9;
      body.position.y = Math.abs(Math.cos(phase)) * amp * 0.12;
      if (s <= 0.2) {
        // idle breathing
        phase += dt * 2;
        torso.scale.y = 1 + Math.sin(phase) * 0.01;
        legL.rotation.x *= 0.8;
        legR.rotation.x *= 0.8;
      }
    },
  };
}

export interface CatModel {
  root: THREE.Group;
  update(dt: number, moving: boolean): void;
}

export function createCat(colors: [string, string]): CatModel {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const [c1, c2] = colors;
  const torso = box(0.26, 0.24, 0.55, c1);
  torso.position.y = 0.32;
  const stripe = box(0.27, 0.06, 0.2, c2);
  stripe.position.set(0, 0.45, -0.05);
  const head = box(0.26, 0.24, 0.24, c1);
  head.position.set(0, 0.5, 0.33);
  const earGeo = new THREE.ConeGeometry(0.06, 0.12, 4);
  const earMat = new THREE.MeshLambertMaterial({ color: c2 });
  const earL = new THREE.Mesh(earGeo, earMat);
  earL.position.set(-0.08, 0.66, 0.33);
  const earR = earL.clone();
  earR.position.x = 0.08;
  const eye = box(0.05, 0.05, 0.02, '#9ccc65');
  eye.position.set(-0.06, 0.53, 0.455);
  const eye2 = eye.clone();
  eye2.position.x = 0.06;
  const nose = box(0.04, 0.03, 0.02, '#f48fb1');
  nose.position.set(0, 0.47, 0.455);
  const tailPivot = new THREE.Group();
  tailPivot.position.set(0, 0.4, -0.27);
  const tail = box(0.06, 0.06, 0.4, c2);
  tail.position.z = -0.18;
  tail.rotation.x = 0.7;
  tail.position.y = 0.12;
  tailPivot.add(tail);
  const legs: THREE.Mesh[] = [];
  for (const [x, z] of [[-0.09, 0.18], [0.09, 0.18], [-0.09, -0.18], [0.09, -0.18]]) {
    const l = box(0.07, 0.22, 0.07, c1);
    l.position.set(x, 0.11, z);
    legs.push(l);
  }
  body.add(torso, stripe, head, earL, earR, eye, eye2, nose, tailPivot, ...legs);
  let t = Math.random() * 10;
  return {
    root,
    update(dt, moving) {
      t += dt;
      tailPivot.rotation.y = Math.sin(t * 3) * 0.5;
      const k = moving ? Math.sin(t * 14) * 0.08 : 0;
      legs[0].position.y = legs[3].position.y = 0.11 + Math.max(0, k);
      legs[1].position.y = legs[2].position.y = 0.11 + Math.max(0, -k);
      body.position.y = moving ? Math.abs(Math.sin(t * 14)) * 0.02 : 0;
      head.rotation.y = moving ? 0 : Math.sin(t * 0.7) * 0.4;
    },
  };
}

/** Canvas-text sprite (labels above POIs and cats). */
export function labelSprite(text: string, opts: { bg?: string; fg?: string; size?: number; icon?: string } = {}): THREE.Sprite {
  const size = opts.size ?? 30;
  const font = `600 ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d')!;
  ctx.font = font;
  const label = opts.icon ? `${opts.icon} ${text}` : text;
  const w = Math.ceil(ctx.measureText(label).width) + size;
  const h = Math.ceil(size * 1.6);
  cv.width = w;
  cv.height = h;
  ctx.font = font;
  ctx.fillStyle = opts.bg ?? 'rgba(20,24,38,0.82)';
  const r = h / 2;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.arcTo(w, 0, w, h, r);
  ctx.arcTo(w, h, 0, h, r);
  ctx.arcTo(0, h, 0, 0, r);
  ctx.arcTo(0, 0, w, 0, r);
  ctx.fill();
  ctx.fillStyle = opts.fg ?? '#fff';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(label, w / 2, h / 2 + 1);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true });
  const s = new THREE.Sprite(mat);
  const scale = 0.022;
  s.scale.set(w * scale, h * scale, 1);
  return s;
}

export function heartSprite(): THREE.Sprite {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#ff4f7b';
  ctx.beginPath();
  ctx.moveTo(32, 56);
  ctx.bezierCurveTo(4, 36, 6, 8, 32, 20);
  ctx.bezierCurveTo(58, 8, 60, 36, 32, 56);
  ctx.fill();
  const tex = new THREE.CanvasTexture(cv);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  s.scale.set(0.45, 0.45, 1);
  return s;
}
