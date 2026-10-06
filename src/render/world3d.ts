import * as THREE from 'three';
import { ITEMS, POI_LABEL } from '../core/content';
import type { Game, WorldItem } from '../core/game';
import { mulberry32 } from '../core/rng';
import {
  BuildingIndex,
  buildAreas,
  buildBuildings,
  buildingInfos,
  buildingMaterial,
  buildingUniforms,
  buildRoads,
  treeSpots,
} from './city';
import { createCat, createCharacter, heartSprite, itemGeometry, labelSprite, lampGeometry, treeGeometry, type CatModel } from './models';
import { QUEST_COLORS } from './minimap';

export type ViewMode = 'third' | 'first' | 'top';

const RARITY_COLOR: Record<string, string> = { yaygın: '#ffffff', orta: '#64b5f6', nadir: '#ba68c8', efsane: '#ffb300' };
const DRAW_DIST = 230;

interface Burst {
  points: THREE.Points;
  vel: Float32Array;
  age: number;
}

/** Keyless renderer: a stylised 3D model of the neighbourhood built from map data. */
export class World3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  view: ViewMode = 'third';
  /** 0..1, 0 = midnight. */
  dayTime = 0.42;
  /** Seconds per full day; 0 freezes time. */
  dayLength = 720;

  private readonly hemi: THREE.HemisphereLight;
  private readonly sun: THREE.DirectionalLight;
  private readonly lantern = new THREE.PointLight(0xffc27a, 0, 26, 1.4);
  private readonly sky: THREE.Mesh;
  private readonly skyUniforms = { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() } };
  private readonly character = createCharacter();
  private readonly itemMeshes = new Map<string, THREE.InstancedMesh>();
  private readonly ringMeshes = new Map<string, THREE.InstancedMesh>();
  private readonly cats: { model: CatModel; label: THREE.Sprite; heart: THREE.Sprite }[] = [];
  private readonly poiLabels = new Map<number, THREE.Sprite>();
  private readonly questBeams: THREE.Mesh[] = [];
  private readonly compassArrow: THREE.Mesh;
  private readonly crumbs: THREE.InstancedMesh;
  private readonly crumbMat = new THREE.MeshBasicMaterial({ color: '#ffd54f', transparent: true, opacity: 0.8, depthWrite: false });
  private readonly magnetRing: THREE.Mesh;
  private readonly lampHeadMat = new THREE.MeshBasicMaterial({ color: '#888' });
  private readonly bursts: Burst[] = [];
  private readonly born = new Map<number, number>();
  private readonly camPos = new THREE.Vector3();
  private readonly camLook = new THREE.Vector3();
  private camInit = false;
  private time = 0;
  private readonly tmpM = new THREE.Matrix4();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpS = new THREE.Vector3();
  private readonly yAxis = new THREE.Vector3(0, 1, 0);

  constructor(private readonly container: HTMLElement, private readonly game: Game) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.className = 'world-canvas';

    this.camera = new THREE.PerspectiveCamera(62, 1, 0.3, 1500);
    this.scene.fog = new THREE.Fog(0xcfe3f0, 80, 520);

    this.hemi = new THREE.HemisphereLight(0xdfefff, 0x8a8170, 1.2);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.6);
    this.scene.add(this.hemi, this.sun, this.sun.target, this.lantern);

    // sky dome
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(1200, 24, 12),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: this.skyUniforms,
        vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `uniform vec3 top; uniform vec3 horizon; varying vec3 vP;
          void main(){ float h = clamp(normalize(vP).y, 0.0, 1.0); gl_FragColor = vec4(mix(horizon, top, pow(h, 0.6)), 1.0);
          #include <colorspace_fragment>
          }`,
      }),
    );
    this.sky.renderOrder = -1;
    this.scene.add(this.sky);

    this.buildCity();
    this.buildItems();
    this.buildCats();

    this.scene.add(this.character.root);
    this.compassArrow = new THREE.Mesh(
      new THREE.ConeGeometry(0.35, 1.1, 4),
      new THREE.MeshBasicMaterial({ color: '#ffb300', transparent: true, opacity: 0.9 }),
    );
    this.compassArrow.visible = false;
    this.scene.add(this.compassArrow);
    this.crumbs = new THREE.InstancedMesh(new THREE.CircleGeometry(0.32, 10).rotateX(-Math.PI / 2), this.crumbMat, 60);
    this.crumbs.count = 0;
    this.crumbs.frustumCulled = false;
    this.scene.add(this.crumbs);
    this.magnetRing = new THREE.Mesh(
      new THREE.RingGeometry(23.5, 24, 64),
      new THREE.MeshBasicMaterial({ color: '#e53935', transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.magnetRing.rotation.x = -Math.PI / 2;
    this.magnetRing.visible = false;
    this.scene.add(this.magnetRing);
    for (let i = 0; i < 3; i++) {
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.9, 0.9, 60, 12, 1, true),
        new THREE.MeshBasicMaterial({
          color: QUEST_COLORS[i],
          transparent: true,
          opacity: 0.28,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
        }),
      );
      beam.visible = false;
      this.scene.add(beam);
      this.questBeams.push(beam);
    }

    game.on((e) => {
      if (e.type === 'collect') this.burst(e.item.x, e.item.y, e.item.def.color, e.item.def.rarity === 'efsane' ? 40 : 18);
      if (e.type === 'feed') this.burst(e.cat.x, e.cat.y, '#ff4f7b', 24);
    });
    this.resize();
  }

  private buildCity(): void {
    const g = this.game;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000), new THREE.MeshLambertMaterial({ color: '#b9b29c' }));
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);

    const areas = new THREE.Mesh(buildAreas(g.area, g.proj), new THREE.MeshLambertMaterial({ vertexColors: true }));
    this.scene.add(areas);

    const roads = new THREE.Mesh(
      buildRoads(g.net),
      new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    );
    this.scene.add(roads);

    const infos = buildingInfos(g.area, g.proj);
    const mat = buildingMaterial();
    mat.uniforms.uSunDir = buildingUniforms.uSunDir;
    mat.uniforms.uSunColor = buildingUniforms.uSunColor;
    mat.uniforms.uAmbient = buildingUniforms.uAmbient;
    mat.uniforms.uNight = buildingUniforms.uNight;
    const buildings = new THREE.Mesh(buildBuildings(infos), mat);
    this.scene.add(buildings);

    const bidx = new BuildingIndex(infos);
    const spots = treeSpots(g.area, g.proj, g.net, bidx);
    const trees = new THREE.InstancedMesh(treeGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }), spots.length);
    const rng = mulberry32(99);
    spots.forEach((p, i) => {
      const s = 0.75 + rng() * 0.5;
      this.tmpQ.setFromAxisAngle(this.yAxis, rng() * Math.PI * 2);
      this.tmpM.compose(this.tmpV.set(p.x, 0, -p.y), this.tmpQ, this.tmpS.set(s, s * (0.85 + rng() * 0.3), s));
      trees.setMatrixAt(i, this.tmpM);
    });
    this.scene.add(trees);

    // street lamps along bigger streets
    const lamps: { x: number; y: number; a: number }[] = [];
    for (const s of g.net.segs) {
      if (s.kind !== 'primary' && s.kind !== 'secondary' && s.kind !== 'tertiary') continue;
      const n = Math.floor(s.len / 32);
      for (let i = 0; i < n; i++) {
        const side = i % 2 ? 1 : -1;
        const p = g.net.pointOnSegment(s, (i + 0.5) / n, side * (s.hw - 0.4));
        if (bidx.inside(p)) continue;
        lamps.push({ x: p.x, y: p.y, a: Math.atan2(s.by - s.ay, s.bx - s.ax) + (side > 0 ? -Math.PI / 2 : Math.PI / 2) });
      }
    }
    const poles = new THREE.InstancedMesh(lampGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }), lamps.length);
    const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.12, 0.3), this.lampHeadMat, lamps.length);
    lamps.forEach((l, i) => {
      this.tmpQ.setFromAxisAngle(this.yAxis, l.a);
      this.tmpM.compose(this.tmpV.set(l.x, 0, -l.y), this.tmpQ, this.tmpS.set(1, 1, 1));
      poles.setMatrixAt(i, this.tmpM);
      const off = new THREE.Vector3(0.75, 4.92, 0).applyQuaternion(this.tmpQ);
      this.tmpM.compose(this.tmpV.set(l.x + off.x, off.y, -l.y + off.z), this.tmpQ, this.tmpS.set(1, 1, 1));
      heads.setMatrixAt(i, this.tmpM);
    });
    this.scene.add(poles, heads);
  }

  private buildItems(): void {
    for (const def of ITEMS) {
      const cap = def.id === 'plak' ? 16 : 400;
      const mesh = new THREE.InstancedMesh(
        itemGeometry(def.id),
        new THREE.MeshLambertMaterial({ vertexColors: true, emissive: new THREE.Color(def.color), emissiveIntensity: 0.25 }),
        cap,
      );
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.itemMeshes.set(def.id, mesh);
    }
    for (const [rarity, color] of Object.entries(RARITY_COLOR)) {
      const mesh = new THREE.InstancedMesh(
        new THREE.RingGeometry(0.55, 0.85, 24).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }),
        rarity === 'yaygın' ? 600 : 300,
      );
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.ringMeshes.set(rarity, mesh);
    }
  }

  private buildCats(): void {
    for (const c of this.game.cats) {
      const model = createCat(c.def.colors);
      const label = labelSprite(c.def.name, { size: 26, bg: 'rgba(255,255,255,0.88)', fg: '#3b2a1a' });
      label.position.y = 1.15;
      model.root.add(label);
      const heart = heartSprite();
      heart.position.y = 1.65;
      heart.visible = false;
      model.root.add(heart);
      this.scene.add(model.root);
      this.cats.push({ model, label, heart });
    }
  }

  private burst(x: number, y: number, color: string, n: number): void {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    const vel = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = x;
      pos[i * 3 + 1] = 1.1;
      pos[i * 3 + 2] = -y;
      const a = Math.random() * Math.PI * 2;
      const s = 2 + Math.random() * 4;
      vel[i * 3] = Math.cos(a) * s;
      vel[i * 3 + 1] = 2 + Math.random() * 5;
      vel[i * 3 + 2] = Math.sin(a) * s;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ color, size: 0.35, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.scene.add(points);
    this.bursts.push({ points, vel, age: 0 });
  }

  resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Screen position (CSS px) of a local point at height h, or null when behind the camera. */
  project(x: number, y: number, h = 1.5): { x: number; y: number } | null {
    const v = this.tmpV.set(x, h, -y).project(this.camera);
    if (v.z > 1) return null;
    const el = this.renderer.domElement;
    return { x: ((v.x + 1) / 2) * el.clientWidth, y: ((1 - v.y) / 2) * el.clientHeight };
  }

  private updateLighting(dt: number): void {
    if (this.dayLength > 0) this.dayTime = (this.dayTime + dt / this.dayLength) % 1;
    const ang = (this.dayTime - 0.25) * Math.PI * 2;
    const elev = Math.sin(ang);
    const day = THREE.MathUtils.smoothstep(elev, -0.12, 0.3);
    const dusk = Math.exp(-((elev / 0.14) ** 2));
    const night = 1 - THREE.MathUtils.smoothstep(elev, -0.06, 0.12);
    const top = new THREE.Color('#0d1530').lerp(new THREE.Color('#3f86d4'), day);
    const hor = new THREE.Color('#25304f').lerp(new THREE.Color('#d4e6f2'), day).lerp(new THREE.Color('#f39c6b'), dusk * 0.55);
    this.skyUniforms.top.value.copy(top);
    this.skyUniforms.horizon.value.copy(hor);
    (this.scene.fog as THREE.Fog).color.copy(hor);
    const sunDir = new THREE.Vector3(Math.cos(ang) * 0.8, Math.max(0.25, elev), 0.45).normalize();
    if (elev < 0) sunDir.set(-0.3, 0.7, -0.4).normalize(); // moon
    buildingUniforms.uSunDir.value.copy(sunDir);
    const sunCol = new THREE.Color(0.85, 0.8, 0.7).lerp(new THREE.Color(1, 0.72, 0.5), dusk * 0.6);
    const moonCol = new THREE.Color(0.06, 0.08, 0.15);
    buildingUniforms.uSunColor.value.copy(moonCol.clone().lerp(sunCol, day));
    buildingUniforms.uAmbient.value.copy(new THREE.Color(0.07, 0.08, 0.14).lerp(new THREE.Color(0.36, 0.38, 0.44), day));
    buildingUniforms.uNight.value = night;
    this.sun.position.copy(sunDir).multiplyScalar(100).add(this.camLook);
    this.sun.target.position.copy(this.camLook);
    this.sun.color.copy(buildingUniforms.uSunColor.value);
    this.sun.intensity = 0.25 + 1.35 * day;
    this.hemi.intensity = 0.35 + 0.9 * day;
    this.hemi.color.copy(new THREE.Color('#6f7fb0').lerp(new THREE.Color('#dfefff'), day));
    this.lantern.intensity = 42 * night;
    this.lampHeadMat.color.copy(new THREE.Color('#5a5f66').lerp(new THREE.Color('#ffe08a'), night));
  }

  get nightFactor(): number {
    return buildingUniforms.uNight.value;
  }

  update(dt: number): void {
    this.time += dt;
    const g = this.game;
    const p = g.player;
    this.updateLighting(dt);

    // character
    const ch = this.character.root;
    ch.position.set(p.x, 0.1, -p.y);
    ch.rotation.y = Math.PI - p.heading;
    this.character.update(dt, p.speed, (g.powerups.scooter ?? 0) > 0);
    ch.visible = this.view !== 'first';
    this.lantern.position.set(p.x, 3.2, -p.y);

    this.updateCamera(dt);
    this.updateItems();
    this.updateCats(dt);
    this.updateLabels();
    this.updateHelpers();

    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.age += dt;
      const pos = b.points.geometry.attributes.position as THREE.BufferAttribute;
      for (let k = 0; k < pos.count; k++) {
        b.vel[k * 3 + 1] -= 12 * dt;
        pos.setXYZ(k, pos.getX(k) + b.vel[k * 3] * dt, Math.max(0.15, pos.getY(k) + b.vel[k * 3 + 1] * dt), pos.getZ(k) + b.vel[k * 3 + 2] * dt);
      }
      pos.needsUpdate = true;
      (b.points.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - b.age / 0.9);
      if (b.age > 0.9) {
        this.scene.remove(b.points);
        b.points.geometry.dispose();
        (b.points.material as THREE.Material).dispose();
        this.bursts.splice(i, 1);
      }
    }
    this.sky.position.copy(this.camera.position);
    this.renderer.render(this.scene, this.camera);
  }

  private updateCamera(dt: number): void {
    const p = this.game.player;
    const fx = Math.sin(p.heading);
    const fy = Math.cos(p.heading);
    const desired = new THREE.Vector3();
    const look = new THREE.Vector3();
    if (this.view === 'first') {
      desired.set(p.x + fx * 0.2, 1.75, -(p.y + fy * 0.2));
      look.set(p.x + fx * 10, 1.6, -(p.y + fy * 10));
    } else if (this.view === 'top') {
      desired.set(p.x - fx * 25, 95, -(p.y - fy * 25));
      look.set(p.x, 0, -p.y);
    } else {
      // keep the chase camera inside the street corridor so buildings never block the view
      const back = this.game.net.constrain(p, { x: p.x - fx * 8.5, y: p.y - fy * 8.5 });
      const blocked = 8.5 - Math.hypot(back.x - p.x, back.y - p.y);
      desired.set(back.x, 4.2 + blocked * 0.7, -back.y);
      look.set(p.x + fx * 4, 1.3, -(p.y + fy * 4));
    }
    if (!this.camInit) {
      this.camPos.copy(desired);
      this.camLook.copy(look);
      this.camInit = true;
    }
    const k = this.view === 'first' ? 1 : 1 - Math.exp(-dt * 6);
    this.camPos.lerp(desired, k);
    this.camLook.lerp(look, this.view === 'first' ? 1 : 1 - Math.exp(-dt * 10));
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
  }

  private updateItems(): void {
    const g = this.game;
    const p = g.player;
    const counts = new Map<string, number>();
    const ringCounts = new Map<string, number>();
    const d2max = DRAW_DIST * DRAW_DIST;
    const alive = new Set<number>();
    for (const it of g.items) {
      alive.add(it.uid);
      const dx = it.x - p.x;
      const dy = it.y - p.y;
      if (dx * dx + dy * dy > d2max) continue;
      const mesh = this.itemMeshes.get(it.def.id)!;
      const n = counts.get(it.def.id) ?? 0;
      if (n >= mesh.instanceMatrix.count) continue;
      let b = this.born.get(it.uid);
      if (b === undefined) {
        b = this.time;
        this.born.set(it.uid, b);
      }
      const grow = Math.min(1, (this.time - b) / 0.5);
      const scale = (it.def.kind === 'record' ? 1.35 : it.def.kind === 'powerup' ? 1.15 : 1) * (0.2 + 0.8 * grow);
      this.setItemMatrix(it, scale);
      mesh.setMatrixAt(n, this.tmpM);
      counts.set(it.def.id, n + 1);
      const ring = this.ringMeshes.get(it.def.rarity)!;
      const rn = ringCounts.get(it.def.rarity) ?? 0;
      if (rn < ring.instanceMatrix.count) {
        const pulse = 1 + Math.sin(it.phase * 1.5) * 0.12;
        this.tmpQ.identity();
        this.tmpM.compose(this.tmpV.set(it.x, 0.16, -it.y), this.tmpQ, this.tmpS.set(pulse * scale, 1, pulse * scale));
        ring.setMatrixAt(rn, this.tmpM);
        ringCounts.set(it.def.rarity, rn + 1);
      }
    }
    for (const [id, mesh] of this.itemMeshes) {
      mesh.count = counts.get(id) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
    }
    for (const [r, mesh] of this.ringMeshes) {
      mesh.count = ringCounts.get(r) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
    }
    if (this.born.size > alive.size + 200) for (const k of this.born.keys()) if (!alive.has(k)) this.born.delete(k);
  }

  private setItemMatrix(it: WorldItem, scale: number): void {
    const bob = Math.sin(it.phase) * 0.15;
    this.tmpQ.setFromAxisAngle(this.yAxis, it.phase * 0.8);
    this.tmpM.compose(this.tmpV.set(it.x, 1.1 + bob, -it.y), this.tmpQ, this.tmpS.set(scale, scale, scale));
  }

  private updateCats(dt: number): void {
    const p = this.game.player;
    this.game.cats.forEach((c, i) => {
      const v = this.cats[i];
      v.model.root.position.set(c.x, 0.1, -c.y);
      v.model.root.rotation.y = Math.PI - c.heading;
      v.model.update(dt, c.moving);
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      v.model.root.visible = d < DRAW_DIST;
      v.label.visible = d < 30;
      v.heart.visible = c.follow > 0;
      if (v.heart.visible) v.heart.position.y = 1.65 + Math.sin(this.time * 4) * 0.08;
    });
  }

  private updateLabels(): void {
    const p = this.game.player;
    const near = this.game.pois
      .map((poi) => ({ poi, d: Math.hypot(poi.x - p.x, poi.y - p.y) }))
      .filter((x) => x.d < 75 && x.poi.type !== 'bus')
      .sort((a, b) => a.d - b.d)
      .slice(0, 10);
    const keep = new Set(near.map((n) => n.poi.index));
    for (const [idx, s] of this.poiLabels) {
      if (!keep.has(idx)) {
        this.scene.remove(s);
        s.material.map?.dispose();
        s.material.dispose();
        this.poiLabels.delete(idx);
      }
    }
    for (const { poi } of near) {
      if (this.poiLabels.has(poi.index)) continue;
      const known = this.game.progress.pois.includes(poi.index);
      const s = labelSprite(poi.name, { icon: POI_LABEL[poi.type].emoji, bg: known ? 'rgba(20,24,38,0.78)' : 'rgba(255,193,7,0.92)', fg: known ? '#fff' : '#1b1b1b' });
      s.position.set(poi.x, 4.4, -poi.y);
      this.scene.add(s);
      this.poiLabels.set(poi.index, s);
    }
  }

  /** Re-render a POI label (e.g. after it was discovered). */
  refreshPoi(index: number): void {
    const s = this.poiLabels.get(index);
    if (!s) return;
    this.scene.remove(s);
    s.material.map?.dispose();
    s.material.dispose();
    this.poiLabels.delete(index);
  }

  private updateHelpers(): void {
    const g = this.game;
    const p = g.player;
    // quest beams
    g.progress.quests.forEach((q, i) => {
      const beam = this.questBeams[i];
      if (!beam) return;
      const t = g.questTargetPoint(q);
      beam.visible = !!t;
      if (t) {
        beam.position.set(t.x, 30, -t.y);
        (beam.material as THREE.MeshBasicMaterial).opacity = 0.18 + Math.sin(this.time * 3 + i) * 0.06;
      }
    });
    for (let i = g.progress.quests.length; i < this.questBeams.length; i++) this.questBeams[i].visible = false;
    // compass power-up arrow
    const target = (g.powerups.pusula ?? 0) > 0 ? g.compassTarget() : null;
    this.compassArrow.visible = !!target;
    if (target) {
      const a = Math.atan2(target.x - p.x, target.y - p.y);
      this.compassArrow.position.set(p.x + Math.sin(a) * 2.2, 2.6, -(p.y + Math.cos(a) * 2.2));
      this.compassArrow.rotation.set(0, 0, 0);
      // cone points +Y; tip it forward along the target direction
      this.compassArrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(Math.sin(a), 0, -Math.cos(a)));
    }
    // breadcrumbs along the route guide, animated towards the target
    let n = 0;
    if (g.guide) {
      this.crumbMat.color.set(QUEST_COLORS[g.guide.index % QUEST_COLORS.length]);
      const path = g.guide.path;
      const spacing = 3.2;
      let carry = spacing - ((this.time * 4) % spacing);
      let walked = 0;
      for (let i = 1; i < path.length && n < this.crumbs.instanceMatrix.count && walked < 140; i++) {
        const a = path[i - 1];
        const b = path[i];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        let d = carry;
        while (d < len && n < this.crumbs.instanceMatrix.count) {
          const t = d / len;
          const x = a.x + (b.x - a.x) * t;
          const y = a.y + (b.y - a.y) * t;
          if (Math.hypot(x - p.x, y - p.y) > 2.5) {
            const s = 1 - Math.min(1, (walked + d) / 160) * 0.5;
            this.tmpQ.identity();
            this.tmpM.compose(this.tmpV.set(x, 0.17, -y), this.tmpQ, this.tmpS.set(s, 1, s));
            this.crumbs.setMatrixAt(n++, this.tmpM);
          }
          d += spacing;
        }
        carry = d - len;
        walked += len;
      }
    }
    this.crumbs.count = n;
    this.crumbs.instanceMatrix.needsUpdate = true;
    this.magnetRing.visible = (g.powerups.miknatis ?? 0) > 0;
    if (this.magnetRing.visible) this.magnetRing.position.set(p.x, 0.2, -p.y);
  }

  dispose(): void {
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
