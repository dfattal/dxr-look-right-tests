// Ring Flight — a three.js flight game on the DisplayXR inline-3D SDK.
//
// Rig: CAMERA rig (the player owns a viewpoint that moves through a world), attach pattern,
// authored at "metre-ish" scale: the plane is ~2.4 units wide, the chase camera sits 5 units behind.
// See NOTES.md for every depth setting.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createInline3D } from '@displayxr/inline3d';
import { EyeCamera, cameraRigFromCamera } from '@displayxr/inline3d/three';

// ---------------------------------------------------------------------------------------------
// Depth settings (all in world units; see NOTES.md)
// ---------------------------------------------------------------------------------------------
const FOV = 50;               // degrees, vertical
const NEAR = 0.6, FAR = 3200;
const CONVERGENCE = 5.5;      // camera -> plane distance: the plane sits ON the glass
const M2V = 4;                // metres->world on the eye: eye baseline = 0.063*4 = 0.25 units
const IPD_FACTOR = 1;
// comfort = ipd * m2v / convergence * 0.5 = 0.36  (<= 1, so infinity does not diverge)
const CAM_BACK = 5, CAM_UP = 1.2;

const HORIZON = new THREE.Color(0xcfe2f1);
const ZENITH = new THREE.Color(0x3b7bd0);

const $ = (id) => document.getElementById(id);
const canvas = $('stage');

// ---------------------------------------------------------------------------------------------
// Renderer / scene
// ---------------------------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(1);          // getViewport() is already in backing-store px
renderer.autoClear = false;
renderer.xr.enabled = false;
renderer.setClearColor(HORIZON, 1);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(HORIZON, 140, 420);

const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x4a5a3a, 1.15);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0d6, 2.1);
sun.position.set(-0.5, 0.8, 0.35);
scene.add(sun);

const appCam = new THREE.PerspectiveCamera(FOV, 16 / 9, NEAR, FAR);
scene.add(appCam);                  // IN the scene: the eye cameras are parented under it

// ---------------------------------------------------------------------------------------------
// Noise / terrain height
// ---------------------------------------------------------------------------------------------
function hash2(ix, iz) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  let fx = x - ix, fz = z - iz;
  fx = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  fz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}
function fbm(x, z, oct) {
  let s = 0, a = 0.5, n = 0;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x, z); n += a; x = x * 2.03 + 17.1; z = z * 2.03 - 9.3; a *= 0.5; }
  return s / n;
}
function terrainH(x, z) {
  const broad = fbm(x * 0.0042 + 11, z * 0.0042 + 7, 3);
  const amp = 0.65 + 0.9 * fbm(x * 0.0016 - 30, z * 0.0016 + 4, 2);
  return (broad - 0.5) * 2 * 30 * amp + (fbm(x * 0.021, z * 0.021, 2) - 0.5) * 7 + (vnoise(x * 0.09, z * 0.09) - 0.5) * 1.4;
}

// ---------------------------------------------------------------------------------------------
// Terrain chunks (+ trees)
// ---------------------------------------------------------------------------------------------
const CH = 128, SEG = 32, STEP = CH / SEG, RAD = 3;
const terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true });

const treeGeo = (() => {
  const trunk = new THREE.CylinderGeometry(0.12, 0.16, 1.0, 5).translate(0, 0.5, 0);
  const c1 = new THREE.ConeGeometry(1.0, 2.0, 6).translate(0, 1.8, 0);
  const c2 = new THREE.ConeGeometry(0.75, 1.7, 6).translate(0, 2.8, 0);
  const col = (g, hex) => {
    const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return g;
  };
  const g = mergeGeometries([col(trunk, 0x5b3d26), col(c1, 0x2f6b34), col(c2, 0x3a7d3a)]);
  return g;
})();
const treeMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

const chunks = new Map();
const _c = new THREE.Color();

function buildChunk(cx, cz) {
  const x0 = cx * CH, z0 = cz * CH, n = SEG + 1;
  const pos = new Float32Array(n * n * 3), nor = new Float32Array(n * n * 3), col = new Float32Array(n * n * 3);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = x0 + i * STEP, z = z0 + j * STEP, h = terrainH(x, z), k = (j * n + i) * 3;
    pos[k] = x; pos[k + 1] = h; pos[k + 2] = z;
    const nx = terrainH(x - STEP, z) - terrainH(x + STEP, z), nz = terrainH(x, z - STEP) - terrainH(x, z + STEP);
    const l = Math.hypot(nx, 2 * STEP, nz);
    nor[k] = nx / l; nor[k + 1] = 2 * STEP / l; nor[k + 2] = nz / l;
    const slope = 1 - nor[k + 1];
    // palette: lowland green -> meadow -> dry olive; rock on steep/high; large tone patches for relief
    const t = THREE.MathUtils.clamp((h + 22) / 50, 0, 1);
    _c.setHex(0x3f7d3a).lerp(new THREE.Color(0x86ad49), t);
    if (h > 14) _c.lerp(new THREE.Color(0xa9a06a), THREE.MathUtils.clamp((h - 14) / 14, 0, 0.7));
    if (slope > 0.12) _c.lerp(new THREE.Color(0x8a7f70), THREE.MathUtils.clamp((slope - 0.12) * 4, 0, 0.85));
    const patch = 0.86 + 0.28 * fbm(x * 0.03 + 5, z * 0.03 - 2, 3) + 0.06 * (vnoise(x * 0.4, z * 0.4) - 0.5);
    col[k] = _c.r * patch; col[k + 1] = _c.g * patch; col[k + 2] = _c.b * patch;
  }
  const idx = new Uint16Array(SEG * SEG * 6);
  let q = 0;
  for (let j = 0; j < SEG; j++) for (let i = 0; i < SEG; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, terrainMat);
  const group = new THREE.Group();
  group.add(mesh);

  // trees: deterministic per chunk, clustered by a forest mask, only on gentle low ground
  const spots = [];
  for (let t = 0; t < 70; t++) {
    const x = x0 + hash2(cx * 131 + t, cz * 17 + 3) * CH, z = z0 + hash2(cx * 29 + 5, cz * 211 + t) * CH;
    if (fbm(x * 0.011 + 40, z * 0.011 - 8, 2) < 0.52) continue;
    const h = terrainH(x, z);
    if (h > 16 || Math.abs(terrainH(x + 2, z) - h) > 1.6 || Math.abs(terrainH(x, z + 2) - h) > 1.6) continue;
    spots.push([x, h, z, t]);
  }
  if (spots.length) {
    const im = new THREE.InstancedMesh(treeGeo, treeMat, spots.length);
    const m = new THREE.Matrix4(), s = new THREE.Vector3(), p = new THREE.Vector3(), qq = new THREE.Quaternion();
    spots.forEach(([x, h, z, t], i) => {
      const sc = 1.1 + hash2(t * 7, cx + cz * 3) * 1.1;
      s.set(sc, sc * (0.9 + hash2(t, 99) * 0.5), sc); p.set(x, h - 0.15, z);
      m.compose(p, qq, s); im.setMatrixAt(i, m);
      const v = 0.8 + hash2(t, 5) * 0.4; im.setColorAt(i, _c.setRGB(v, v, v));
    });
    im.frustumCulled = false;
    group.add(im);
    group.userData.trees = im;
  }
  scene.add(group);
  return group;
}
function disposeChunk(group) {
  scene.remove(group);
  group.children[0].geometry.dispose();
  if (group.userData.trees) group.userData.trees.dispose();
}
function updateTerrain(px, pz, budget) {
  const ccx = Math.floor(px / CH), ccz = Math.floor(pz / CH);
  const want = [];
  for (let dz = -RAD; dz <= RAD; dz++) for (let dx = -RAD; dx <= RAD; dx++) want.push([ccx + dx, ccz + dz, dx * dx + dz * dz]);
  want.sort((a, b) => a[2] - b[2]);
  for (const [cx, cz] of want) {
    const key = cx + ',' + cz;
    if (chunks.has(key)) continue;
    if (budget-- <= 0) break;
    chunks.set(key, buildChunk(cx, cz));
  }
  for (const [key, g] of chunks) {
    const [cx, cz] = key.split(',').map(Number);
    if (Math.abs(cx - ccx) > RAD + 1 || Math.abs(cz - ccz) > RAD + 1) { disposeChunk(g); chunks.delete(key); }
  }
}

// ---------------------------------------------------------------------------------------------
// Sky, haze floor, distant mountains (all centred on the camera: they sit "at infinity")
// ---------------------------------------------------------------------------------------------
const BASE = 60;      // haze floor / mountain foot, below the lowest valley
const backdrop = new THREE.Group();
scene.add(backdrop);

const sky = new THREE.Mesh(
  new THREE.SphereGeometry(2600, 32, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: ZENITH }, hor: { value: HORIZON } },
    vertexShader: 'varying float vY; void main(){ vY = normalize(position).y; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 hor; varying float vY;' +
      'void main(){ float t = pow(clamp(vY,0.0,1.0), 0.55); gl_FragColor = vec4(mix(hor, top, t), 1.0); }',
  }),
);
sky.renderOrder = -2;
backdrop.add(sky);

const haze = new THREE.Mesh(
  new THREE.CircleGeometry(2500, 32).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: HORIZON, fog: false }),
);
haze.position.y = -BASE;
backdrop.add(haze);

function mountainRing(radius, count, minH, maxH, hazeAmt, seed) {
  const pos = [], col = [];
  const rock = new THREE.Color(0x56627a), snow = new THREE.Color(0xf3f6fb), base = new THREE.Color(0x4b6a5a);
  const L = [[1, 0], [0.64, 0.34], [0.34, 0.68], [0, 1]];
  const RS = 7;
  for (let m = 0; m < count; m++) {
    const a = ((m + hash2(m, seed) * 0.8) / count) * Math.PI * 2;
    const r = radius * (0.92 + hash2(m, seed + 1) * 0.2);
    const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
    const H = minH + hash2(m, seed + 2) * (maxH - minH), W = H * (1.0 + hash2(m, seed + 3) * 0.7);
    const rings = L.map(([rs, hs], li) => {
      const arr = [];
      for (let k = 0; k < RS; k++) {
        const ang = (k / RS) * Math.PI * 2 + hash2(m * 9 + k, seed + 4) * 0.5;
        const jr = 0.78 + hash2(m * 13 + k + li * 5, seed + 5) * 0.45;
        const jh = 1 + (hash2(m * 3 + k, seed + 6 + li) - 0.5) * 0.16;
        arr.push([cx + Math.cos(ang) * W * rs * jr, -BASE + hs * (H + BASE) * jh, cz + Math.sin(ang) * W * rs * jr, hs]);
      }
      return arr;
    });
    const push = (v) => {
      pos.push(v[0], v[1], v[2]);
      const hn = (v[1] + BASE) / (H + BASE);
      _c.copy(base).lerp(rock, THREE.MathUtils.smoothstep(hn, 0.1, 0.45)).lerp(snow, THREE.MathUtils.smoothstep(hn, 0.62, 0.78));
      _c.lerp(HORIZON, hazeAmt);
      col.push(_c.r, _c.g, _c.b);
    };
    for (let li = 0; li < L.length - 1; li++) for (let k = 0; k < RS; k++) {
      const k2 = (k + 1) % RS, a0 = rings[li][k], a1 = rings[li][k2], b0 = rings[li + 1][k], b1 = rings[li + 1][k2];
      push(a0); push(b0); push(a1); push(a1); push(b0); push(b1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, fog: false }));
}
backdrop.add(mountainRing(1000, 34, 140, 300, 0.42, 100));
backdrop.add(mountainRing(1650, 40, 260, 480, 0.68, 200));

// ---------------------------------------------------------------------------------------------
// Clouds (opaque puffs at mixed altitudes/distances: cheap, strong parallax cues)
// ---------------------------------------------------------------------------------------------
const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x2a3140, flatShading: true });
const cloudGeo = new THREE.IcosahedronGeometry(1, 1);
const CLOUD_R = 480;
const clouds = [];
for (let i = 0; i < 26; i++) {
  const g = new THREE.Group();
  const puffs = 4 + Math.floor(hash2(i, 1) * 3);
  for (let k = 0; k < puffs; k++) {
    const p = new THREE.Mesh(cloudGeo, cloudMat);
    const s = 7 + hash2(i, k + 10) * 9;
    p.scale.set(s * 1.4, s * 0.6, s);
    p.position.set((k - puffs / 2) * 9 + hash2(i, k + 20) * 4, hash2(i, k + 30) * 3, (hash2(i, k + 40) - 0.5) * 9);
    g.add(p);
  }
  g.position.set((hash2(i, 50) * 2 - 1) * CLOUD_R, 55 + hash2(i, 60) * 110, (hash2(i, 70) * 2 - 1) * CLOUD_R);
  scene.add(g);
  clouds.push(g);
}

// ---------------------------------------------------------------------------------------------
// The plane
// ---------------------------------------------------------------------------------------------
const plane = new THREE.Group();   // forward is -Z
const planeInner = new THREE.Group();
plane.add(planeInner);
let prop;
{
  const lam = (color) => new THREE.MeshLambertMaterial({ color, flatShading: true });
  const body = lam(0xf0f0f4), red = lam(0xd93a2b), glass = new THREE.MeshLambertMaterial({ color: 0x2a4a7a, emissive: 0x0a1a30 });
  const add = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); planeInner.add(m); return m; };
  add(new THREE.CylinderGeometry(0.12, 0.25, 1.7, 10).rotateX(Math.PI / 2), body, 0, 0, 0.1);
  add(new THREE.ConeGeometry(0.25, 0.4, 10).rotateX(-Math.PI / 2), red, 0, 0, -0.95);
  add(new THREE.BoxGeometry(2.5, 0.05, 0.55), red, 0, -0.04, -0.1);
  add(new THREE.BoxGeometry(0.95, 0.04, 0.3), red, 0, 0.02, 0.88);
  add(new THREE.BoxGeometry(0.04, 0.4, 0.34), red, 0, 0.24, 0.86);
  add(new THREE.SphereGeometry(0.2, 10, 8).scale(1, 0.8, 1.7), glass, 0, 0.2, -0.2);
  prop = add(new THREE.BoxGeometry(1.2, 0.07, 0.025), lam(0x333338), 0, 0, -1.17);
}
scene.add(plane);

const shadow = new THREE.Mesh(
  new THREE.CircleGeometry(1.1, 16).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0x0b1a0b, transparent: true, opacity: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
);
shadow.scale.set(1.1, 1, 1.5);
scene.add(shadow);

// ---------------------------------------------------------------------------------------------
// Flight state / input
// ---------------------------------------------------------------------------------------------
const SPEED = 24;
const P = { pos: new THREE.Vector3(0, 0, 0), yaw: 0, pitch: 0, roll: 0, turn: 0 };
P.pos.set(0, terrainH(0, 0) + 38, 0);
const cam = { yaw: 0, y: P.pos.y + CAM_UP, look: P.pos.y };

const keys = new Set();
let paused = false;
const norm = (e) => ({ ArrowLeft: 'L', ArrowRight: 'R', ArrowUp: 'U', ArrowDown: 'D', a: 'L', d: 'R', w: 'U', s: 'D', A: 'L', D: 'R', W: 'U', S: 'D' })[e.key];
addEventListener('keydown', (e) => {
  if (e.key === 'p' || e.key === 'P') { paused = !paused; return; }
  const k = norm(e);
  if (!k) return;
  e.preventDefault();
  keys.add(k);
  $('hint').classList.add('gone');
});
addEventListener('keyup', (e) => { const k = norm(e); if (k) keys.delete(k); });
addEventListener('blur', () => keys.clear());

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

function stepFlight(dt) {
  const tIn = (keys.has('L') ? 1 : 0) - (keys.has('R') ? 1 : 0);
  const pIn = (keys.has('U') ? 1 : 0) - (keys.has('D') ? 1 : 0);
  P.turn = damp(P.turn, tIn, 3.5, dt);
  P.yaw += P.turn * 1.05 * dt;
  P.pitch = damp(P.pitch, pIn * 0.5, 2.5, dt);
  P.roll = damp(P.roll, P.turn * 0.75, 4, dt);
  const cp = Math.cos(P.pitch);
  P.pos.x += -Math.sin(P.yaw) * cp * SPEED * dt;
  P.pos.z += -Math.cos(P.yaw) * cp * SPEED * dt;
  P.pos.y += Math.sin(P.pitch) * SPEED * dt;
  const floor = terrainH(P.pos.x, P.pos.z) + 3;
  if (P.pos.y < floor) { P.pos.y = floor; P.pitch = Math.max(P.pitch, 0.08); }
  if (P.pos.y > 130) { P.pos.y = 130; P.pitch = Math.min(P.pitch, 0); }

  plane.position.copy(P.pos);
  plane.rotation.set(P.pitch, P.yaw, 0, 'YXZ');
  planeInner.rotation.z = P.roll;
  prop.rotation.z += dt * 55;
  const gh = terrainH(P.pos.x, P.pos.z);
  shadow.position.set(P.pos.x, gh + 0.15, P.pos.z);
  shadow.material.opacity = THREE.MathUtils.clamp(0.42 - (P.pos.y - gh) * 0.004, 0.12, 0.42);
}

function stepCamera(dt) {
  cam.yaw += wrapAngle(P.yaw - cam.yaw) * (1 - Math.exp(-2.6 * dt));
  cam.y = damp(cam.y, P.pos.y + CAM_UP, 3, dt);
  cam.look = damp(cam.look, P.pos.y + 1.0, 3, dt);
  const dx = -Math.sin(cam.yaw), dz = -Math.cos(cam.yaw);
  appCam.position.set(P.pos.x - dx * CAM_BACK, cam.y, P.pos.z - dz * CAM_BACK);
  appCam.lookAt(P.pos.x + dx * 12, cam.look, P.pos.z + dz * 12);   // level horizon: no camera roll
  appCam.updateMatrixWorld(true);
  backdrop.position.set(appCam.position.x, 0, appCam.position.z);
}

// ---------------------------------------------------------------------------------------------
// Rings
// ---------------------------------------------------------------------------------------------
const RING_R = 4.2;
const ringGeo = new THREE.TorusGeometry(RING_R, 0.38, 10, 40);
const matNext = new THREE.MeshBasicMaterial({ color: 0xffc41f });
const matLater = new THREE.MeshBasicMaterial({ color: 0x9fd8ff });
const rings = [];
const bursts = [];
let score = 0, missed = 0;
let chain = { pos: new THREE.Vector3(), yaw: 0 };

function resetChain(from, yaw) {
  chain.pos.copy(from); chain.yaw = yaw;
}
function spawnRing() {
  chain.yaw += (Math.random() * 2 - 1) * 0.55;
  const step = 55 + Math.random() * 25;
  const dir = new THREE.Vector3(-Math.sin(chain.yaw), 0, -Math.cos(chain.yaw));
  const next = chain.pos.clone().addScaledVector(dir, step);
  const g = terrainH(next.x, next.z);
  const targetY = THREE.MathUtils.clamp(g + 9 + Math.random() * 20, 12, 110);
  next.y = THREE.MathUtils.clamp(targetY, chain.pos.y - step * 0.3, chain.pos.y + step * 0.3);
  next.y = Math.max(next.y, g + 8);
  const normal = next.clone().sub(chain.pos).normalize();
  const mesh = new THREE.Mesh(ringGeo, matLater);
  mesh.position.copy(next);
  mesh.lookAt(next.clone().add(normal));
  scene.add(mesh);
  rings.push({ mesh, normal, prevD: null, done: false });
  chain.pos.copy(next);
}
function ensureRings() {
  const live = rings.filter((r) => !r.done);
  if (live.length && live[0].mesh.position.distanceTo(P.pos) > 280) {
    for (const r of rings) scene.remove(r.mesh);
    rings.length = 0;
    resetChain(P.pos, P.yaw);
  }
  while (rings.filter((r) => !r.done).length < 5) spawnRing();
  const next = rings.find((r) => !r.done);
  for (const r of rings) r.mesh.material = r === next ? matNext : matLater;
}
function stepRings(dt, t) {
  for (const r of rings) {
    if (r.done) continue;
    const rel = P.pos.clone().sub(r.mesh.position);
    const d = rel.dot(r.normal);
    if (r.prevD !== null && Math.sign(d) !== Math.sign(r.prevD) && r.prevD < 0) {
      const inPlane = rel.addScaledVector(r.normal, -d).length();
      r.done = true;
      if (inPlane < RING_R + 0.6) { score++; flash(); bursts.push({ ring: r, t: 0 }); r.mesh.material = matNext; r.collected = true; }
      else { missed++; r.mesh.visible = false; }
    }
    r.prevD = d;
    if (!r.done && r === rings.find((x) => !x.done)) r.mesh.scale.setScalar(1 + 0.04 * Math.sin(t * 6));
  }
  // retire rings left behind
  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i];
    if (r.collected) continue;
    const behind = P.pos.clone().sub(r.mesh.position).dot(r.normal) > 30 || r.mesh.position.distanceTo(P.pos) > 360;
    if (r.done || behind) { if (!r.done) { r.done = true; missed++; } scene.remove(r.mesh); rings.splice(i, 1); }
  }
  // collected rings pop and fade out well before the camera (5 units behind) reaches them
  for (let i = bursts.length - 1; i >= 0; i--) {
    const b = bursts[i]; b.t += dt;
    const k = b.t / 0.18;
    if (k >= 1) {
      scene.remove(b.ring.mesh);
      const j = rings.indexOf(b.ring); if (j >= 0) rings.splice(j, 1);
      bursts.splice(i, 1);
    } else b.ring.mesh.scale.setScalar(1 + k * 0.5);
  }
  ensureRings();
  $('scoreVal').textContent = score;
  $('missVal').textContent = missed ? `missed ${missed}` : '';
}
let flashT = 0;
function flash() { $('flash').classList.add('on'); flashT = 0.7; }

resetChain(P.pos, P.yaw);
ensureRings();

// ---------------------------------------------------------------------------------------------
// Frame update
// ---------------------------------------------------------------------------------------------
let lastT = performance.now(), simT = 0;
function update() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  if (!paused) {
    simT += dt;
    stepFlight(dt);
    stepCamera(dt);
    stepRings(dt, simT);
    updateTerrain(P.pos.x, P.pos.z, 2);
    for (const c of clouds) {
      if (c.position.x - P.pos.x > CLOUD_R) c.position.x -= CLOUD_R * 2; else if (c.position.x - P.pos.x < -CLOUD_R) c.position.x += CLOUD_R * 2;
      if (c.position.z - P.pos.z > CLOUD_R) c.position.z -= CLOUD_R * 2; else if (c.position.z - P.pos.z < -CLOUD_R) c.position.z += CLOUD_R * 2;
    }
    if (flashT > 0 && (flashT -= dt) <= 0) $('flash').classList.remove('on');
  }
}

// ---------------------------------------------------------------------------------------------
// Backing store (double-width while woven) and drawing
// ---------------------------------------------------------------------------------------------
let woven = false;
const gl = renderer.getContext();
const MAXDIM = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
  ...Array.from(gl.getParameter(gl.MAX_VIEWPORT_DIMS)));

function sizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let w = Math.max(2, Math.round((canvas.clientWidth || innerWidth) * dpr));
  let h = Math.max(2, Math.round((canvas.clientHeight || innerHeight) * dpr));
  const cols = woven ? 2 : 1;
  const scale = Math.min(1, MAXDIM / (w * cols), MAXDIM / h, Math.sqrt(10e6 / (w * cols * h)));
  w = Math.max(2, Math.floor(w * scale)); h = Math.max(2, Math.floor(h * scale));
  appCam.aspect = w / h;
  appCam.updateProjectionMatrix();
  if (canvas.width === w * cols && canvas.height === h) return false;   // setSize would clear for nothing
  renderer.setSize(w * cols, h, false);
  return true;
}

const eyes = [new EyeCamera(THREE), new EyeCamera(THREE)];
for (const e of eyes) appCam.add(e.camera);
const good = [0, 1].map(() => ({ proj: new Float32Array(16), pose: new Float32Array(16), x: 0, y: 0, width: 0, height: 0 }));
let haveGood = false;

function drawStereo() {
  renderer.clear();
  renderer.setScissorTest(true);
  for (let i = 0; i < 2; i++) {
    const g = good[i];
    renderer.setViewport(g.x, g.y, g.width, g.height);
    renderer.setScissor(g.x, g.y, g.width, g.height);
    eyes[i].setLocalFromMatrices(g.proj, g.pose);   // attach pattern: LOCAL pose, eyes parented under appCam
    renderer.render(scene, eyes[i].camera);
  }
  renderer.setScissorTest(false);
}

let handle = null;
const rigScratch = {};
const rigOpts = { convergence: CONVERGENCE, attach: true, ipdFactor: IPD_FACTOR, metersToVirtual: M2V, out: rigScratch };
let lastNear = NEAR, lastFar = FAR;
let wall = null;

function onFrame(views, layer) {
  update();
  // The rig drives the NEXT locate; push it before any early-out so a hitch can't freeze the stereo.
  handle.setViewRig(cameraRigFromCamera(THREE, appCam, rigOpts));
  if (!views || views.length < 2 || !layer) { if (haveGood) drawStereo(); else renderer.clear(); return; }
  const vps = views.map((v) => layer.getViewport(v));
  if (vps.some((vp) => !vp || vp.width <= 0 || vp.height <= 0)) { if (haveGood) drawStereo(); else renderer.clear(); return; }
  for (let i = 0; i < 2; i++) {
    const g = good[i], vp = vps[i];
    g.proj.set(views[i].projectionMatrix); g.pose.set(views[i].transform.matrix);   // copies, not the XRView
    g.x = vp.x; g.y = vp.y; g.width = vp.width; g.height = vp.height;
  }
  haveGood = true;
  drawStereo();
}

// ---- 2D fallback ----------------------------------------------------------------------------
let monoRunning = false;
function monoFrame() {
  requestAnimationFrame(monoFrame);
  update();
  renderer.setScissorTest(false);
  renderer.clear();
  renderer.setViewport(0, 0, canvas.width, canvas.height);
  renderer.render(scene, appCam);
  if (monoRunning === 'first') { monoRunning = true; $('cover').remove(); }
}
function startMono(msg) {
  woven = false;
  for (const e of eyes) appCam.remove(e.camera);
  sizeCanvas();
  $('status').innerHTML = msg || '<b>2D mode</b> — open in the DisplayXR Browser on a spatial display for glasses-free 3D.';
  monoRunning = 'first';
  requestAnimationFrame(monoFrame);
}
addEventListener('resize', () => { if (!woven) sizeCanvas(); });

// ---- boot -----------------------------------------------------------------------------------
(async () => {
  updateTerrain(0, 0, 1e9);              // build the whole first ring of chunks before the first frame
  sizeCanvas();
  stepCamera(0.016);
  let w = null;
  try { w = await createInline3D({ lazy: false }); } catch (e) { console.warn('[flight] createInline3D failed', e); }
  if (!w || !w.supported) { startMono(); return; }
  wall = w;
  woven = true;
  sizeCanvas();
  try { wall.session.updateRenderState({ depthNear: NEAR, depthFar: FAR }); } catch (e) { console.warn(e); }
  handle = wall.addScene(canvas, onFrame, {
    viewRig: cameraRigFromCamera(THREE, appCam, rigOpts),
    onLayerLost: () => startMono('<b>3D layer lost</b> — showing 2D.'),
    onResize: () => { if (sizeCanvas() && haveGood) drawStereo(); },
  });
  $('status').innerHTML = '<b style="color:#7ee2a4">3D active</b> — the plane sits on the glass; the hills fall away behind it.';
  handle.firstWoven.then(() => $('cover').remove());
})();
