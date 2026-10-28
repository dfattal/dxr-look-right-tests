// Ring Runner — a small flight game on a spatial display (DisplayXR inline-3D web SDK).
//
// RIG (guide §1): the player moves THROUGH a world → CAMERA rig. A chase camera is the app camera;
// the runtime turns it into two eyes (cameraRigFromCamera, attach pattern, as samples/starter-world).
//
// SCREEN PLANE (§2): FIXED, FINITE convergence CONVERGENCE = 14 world units: about the distance of
// the nearest content that touches a frame edge (the hills / treetops at the bottom edge: the camera
// is >= ~18 above the ground, looking ~7° down, bottom ray ≈ 32° → ≥ 30 units). So ground, mountains
// and sky are all BEHIND the glass (a view through a window); only the plane (12 units ahead of the
// camera, centre of frame) is a hair in front of it. Never driven by gaze, never 0.
//
// DEPTH BUDGET (§3, full-frame column: front ≤ 0.3 %, behind ≤ 1.0 % of the tile width).
//   b = 0.063 · ipdFactor · METERS_TO_VIRTUAL = 0.063 · 3.7 = 0.233 world units (absolute on a camera rig)
//   disparity % = 100 · b · (1/D − 1/z) / (2 · tan(fov/2) · aspect), fov 50°, 16:9 → denominator 1.658
//   plane   z = 12  : −0.19 %  (in front, centre, a subject: ≤ 0.6 %)
//   ground  z ≈ 30  : +0.4 %
//   infinity (sky, mountains at 520–760, all fogged / hazed): ≤ +1.0 %   (= 100·b/D/1.658)
//   rings   z ≥ 12  : ≤ −0.19 % while ahead of the plane; removed 3 units behind the plane (z ≈ 9: −0.5 %)
// Atmosphere (fog, haze-coloured far layers) makes the far background low-contrast so its larger
// disparity ghosts less. The world is closed: terrain fades into haze, a disc fills below the horizon.

import * as THREE from 'three';
import { createInline3D } from '@displayxr/inline3d';
import { EyeCamera, cameraRigFromCamera } from '@displayxr/inline3d/three';

const canvas = document.getElementById('game');
const cover = document.getElementById('cover');
const nEl = document.getElementById('n');
const altEl = document.getElementById('alt');
const depthEl = document.getElementById('depth');
const modeBtn = document.getElementById('mode');
const noteEl = document.getElementById('note');

const FOV = 50;                       // full vertical angle, degrees
const CONVERGENCE = 14;               // zero-disparity distance, world units
const METERS_TO_VIRTUAL = 3.7;        // eye baseline = 0.063 m × 3.7 = 0.233 world units
const CHASE_BACK = 12, CHASE_UP = 4;  // chase camera offset from the plane
const SPEED = 30;                     // forward speed, units/s
const HAZE = new THREE.Color(0xc4d8e6);

// ---- renderer / scene / camera ----------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setClearColor(HAZE, 1);      // OPAQUE clear
renderer.setPixelRatio(1);
renderer.autoClear = false;
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(HAZE, 80, 220);
const cam = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.5, 1200);
scene.add(cam);                       // IN the scene: the eye cameras hang under it

// ---- noise / terrain function --------------------------------------------------------------------
function hash(x, z) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, z, oct = 4) {
  let s = 0, a = 0.5, n = 0;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x, z); n += a; x = x * 2.03 + 17.1; z = z * 2.03 - 9.4; a *= 0.5; }
  return s / n;
}
const terrain = (x, z) => (fbm(x * 0.005, z * 0.005, 4) - 0.4) * 70 + (vnoise(x * 0.03, z * 0.03) - 0.5) * 5;

// ---- terrain mesh: a window of the infinite field, re-sampled when the player moves a snap step ---
const CELL = 5, N = 96, SNAP = 20, HALF = (N * CELL) / 2;   // 480 wide; snap is a multiple of CELL
const V = N + 1;
const tGeo = new THREE.BufferGeometry();
const tPos = new Float32Array(V * V * 3), tCol = new Float32Array(V * V * 3), tUv = new Float32Array(V * V * 2);
for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
  const k = j * V + i;
  tPos[k * 3] = i * CELL - HALF; tPos[k * 3 + 2] = j * CELL - HALF;
  tUv[k * 2] = (i * CELL) / SNAP; tUv[k * 2 + 1] = (j * CELL) / SNAP;   // repeats every SNAP: no swimming
}
const idx = [];
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
  const a = j * V + i, b = a + 1, c = a + V, d = c + 1;
  idx.push(a, c, b, b, c, d);
}
tGeo.setIndex(idx);
tGeo.setAttribute('position', new THREE.BufferAttribute(tPos, 3));
tGeo.setAttribute('color', new THREE.BufferAttribute(tCol, 3));
tGeo.setAttribute('uv', new THREE.BufferAttribute(tUv, 2));

function speckle() {                 // fine irregular grain: the eyes need detail to fuse
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 256, 256);
  let s = 5;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 4500; i++) {
    g.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${r() * 0.3})`;
    g.beginPath(); g.arc(r() * 256, r() * 256, 0.8 + r() * r() * 5, 0, 7); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
const tMesh = new THREE.Mesh(tGeo, new THREE.MeshLambertMaterial({ vertexColors: true, map: speckle() }));
tMesh.frustumCulled = false;
scene.add(tMesh);

const cLow = new THREE.Color(0x3f7f35), cMid = new THREE.Color(0x6a9a3c), cHi = new THREE.Color(0x9a9a55);
const cField = new THREE.Color(0x9bac4a), cRock = new THREE.Color(0x8d8576), tmp = new THREE.Color();

// Trees: instanced cones, placed per world cell (hash) so they stay put as the window slides.
const TREE_MAX = 1800;
const trees = new THREE.InstancedMesh(
  new THREE.ConeGeometry(0.32, 1, 7).translate(0, 0.5, 0),
  new THREE.MeshLambertMaterial({ color: 0xffffff }), TREE_MAX);
trees.frustumCulled = false;
scene.add(trees);
const dummy = new THREE.Object3D();

let tileX = NaN, tileZ = NaN;
function rebuildTerrain(px, pz) {
  const sx = Math.round(px / SNAP) * SNAP, sz = Math.round(pz / SNAP) * SNAP;
  if (sx === tileX && sz === tileZ) return;
  tileX = sx; tileZ = sz;
  for (let k = 0; k < V * V; k++) {
    const x = tPos[k * 3] + sx, z = tPos[k * 3 + 2] + sz;
    const h = terrain(x, z);
    tPos[k * 3 + 1] = h;
    const patch = vnoise(x * 0.02 + 40, z * 0.02), grain = hash(Math.floor(x / 5), Math.floor(z / 5)) * 0.12;
    tmp.copy(cLow).lerp(cMid, THREE.MathUtils.smoothstep(h, -5, 18))
       .lerp(cHi, THREE.MathUtils.smoothstep(h, 20, 38))
       .lerp(cField, THREE.MathUtils.smoothstep(patch, 0.5, 0.65) * 0.8);
    const slope = Math.abs(terrain(x + 4, z) - h) + Math.abs(terrain(x, z + 4) - h);
    tmp.lerp(cRock, THREE.MathUtils.smoothstep(slope, 4, 9) * 0.7);
    const l = 0.92 + grain;
    tCol[k * 3] = tmp.r * l; tCol[k * 3 + 1] = tmp.g * l; tCol[k * 3 + 2] = tmp.b * l;
  }
  tMesh.position.set(sx, 0, sz);
  tGeo.attributes.position.needsUpdate = true;
  tGeo.attributes.color.needsUpdate = true;
  tGeo.computeVertexNormals();

  let n = 0;
  const g0x = Math.round(sx / SNAP), g0z = Math.round(sz / SNAP), R = Math.floor(HALF / SNAP) - 1;
  for (let gz = g0z - R; gz <= g0z + R; gz++) for (let gx = g0x - R; gx <= g0x + R; gx++) {
    for (let t = 0; t < 2; t++) {
      const x = (gx + hash(gx * 3 + t, gz)) * SNAP, z = (gz + hash(gx, gz * 3 + t + 7)) * SNAP;
      const forest = fbm(x * 0.012 + 90, z * 0.012, 3);
      const h = terrain(x, z);
      if (n >= TREE_MAX || hash(gx * 7 + t, gz * 5) > forest * 1.25 - 0.2 || h > 30 || h < -8) continue;
      const hh = 6 + hash(gx + t, gz * 11) * 6;
      dummy.position.set(x, h - 0.2, z);
      dummy.scale.set(hh * 0.55, hh, hh * 0.55);
      dummy.updateMatrix();
      trees.setMatrixAt(n, dummy.matrix);
      trees.setColorAt(n, tmp.setHSL(0.3 + hash(gx, gz + t) * 0.06, 0.45, 0.2 + hash(gz, gx + t) * 0.12));
      n++;
    }
  }
  trees.count = n;
  trees.instanceMatrix.needsUpdate = true;
  trees.instanceColor.needsUpdate = true;
}

// ---- sky, sun, clouds, mountains, horizon floor (all "infinite": follow the camera in x/z) ---------
const skyGeo = new THREE.SphereGeometry(900, 32, 24);
{
  const p = skyGeo.attributes.position, col = new Float32Array(p.count * 3);
  const top = new THREE.Color(0x2f6fc0), mid = new THREE.Color(0x7fb2e0), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / 900;
    c.copy(HAZE).lerp(mid, THREE.MathUtils.smoothstep(y, 0, 0.18)).lerp(top, THREE.MathUtils.smoothstep(y, 0.15, 0.9));
    col.set([c.r, c.g, c.b], i * 3);
  }
  skyGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}
const bg = (m) => { m.fog = false; return m; };
const sky = new THREE.Mesh(skyGeo, bg(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false })));
sky.renderOrder = -10;
scene.add(sky);
const SUN_DIR = new THREE.Vector3(-0.5, 0.42, -0.75).normalize();
const sun = new THREE.Mesh(new THREE.SphereGeometry(40, 16, 12), bg(new THREE.MeshBasicMaterial({ color: 0xfff4d0 })));
sun.position.copy(SUN_DIR).multiplyScalar(820);
sun.renderOrder = -9;
scene.add(sun);

const floor = new THREE.Mesh(new THREE.CircleGeometry(840, 48).rotateX(-Math.PI / 2), bg(new THREE.MeshBasicMaterial({ color: HAZE })));
floor.position.y = -60;
scene.add(floor);

function mountainRing(radius, maxH, hazeAmt, seedOff) {
  const SEG = 360, pos = [], col = [], ind = [];
  const rock = new THREE.Color(0x56688a), snow = new THREE.Color(0xe9f0f8), c = new THREE.Color();
  for (let i = 0; i <= SEG; i++) {
    const a = (i / SEG) * Math.PI * 2, cx = Math.cos(a), cz = Math.sin(a);
    const n1 = fbm(cx * 2.5 + seedOff, cz * 2.5 + seedOff, 2), n2 = fbm(cx * 14 + seedOff, cz * 14 - seedOff, 3);
    const ridge = 1 - Math.abs(2 * n2 - 1);
    const h = maxH * (0.15 + 0.85 * Math.pow(n1, 1.6)) * (0.55 + 0.45 * ridge);
    const x = cx * radius, z = cz * radius, y0 = -60;
    pos.push(x, y0, z, x, y0 + (h + 60) * 0.5, z, x, h, z);
    col.push(...HAZE.toArray());
    c.copy(rock).lerp(HAZE, hazeAmt); col.push(c.r, c.g, c.b);
    c.copy(rock).lerp(snow, THREE.MathUtils.smoothstep(h, maxH * 0.45, maxH * 0.8)).lerp(HAZE, hazeAmt);
    col.push(c.r, c.g, c.b);
    if (i < SEG) for (let r = 0; r < 2; r++) {
      const a0 = i * 3 + r, b0 = a0 + 3;
      ind.push(a0, b0, a0 + 1, b0, b0 + 1, a0 + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(ind);
  const m = new THREE.Mesh(g, bg(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })));
  m.renderOrder = -5;
  scene.add(m);
  return m;
}
const mountains = [mountainRing(760, 330, 0.62, 3), mountainRing(540, 200, 0.4, 11)];

const clouds = [];
{
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x7a8ca0, flatShading: true });
  for (let i = 0; i < 16; i++) {
    const grp = new THREE.Group();
    for (let k = 0; k < 5; k++) {
      const s = new THREE.Mesh(new THREE.IcosahedronGeometry(10 + hash(i, k) * 12, 1), mat);
      s.position.set((k - 2) * 14 + hash(k, i) * 8, hash(i * 2, k) * 5, hash(i, k * 3) * 14);
      s.scale.y = 0.55;
      grp.add(s);
    }
    grp.userData = { x: hash(i, 1) * 600 - 300, z: hash(i, 2) * 600 - 300, y: 105 + hash(i, 3) * 40 };
    scene.add(grp);
    clouds.push(grp);
  }
}

scene.add(new THREE.HemisphereLight(0xdcecff, 0x4a5a3a, 1.5));
const dirLight = new THREE.DirectionalLight(0xfff0d8, 2.4);
dirLight.position.copy(SUN_DIR);
scene.add(dirLight);

// ---- the plane (faces −z) ------------------------------------------------------------------------
const plane = new THREE.Group();
const prop = new THREE.Group();
{
  const red = new THREE.MeshLambertMaterial({ color: 0xd8322a }), white = new THREE.MeshLambertMaterial({ color: 0xf2f2ee });
  const dark = new THREE.MeshLambertMaterial({ color: 0x2a2f38 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.3, 3.4, 12).rotateX(Math.PI / 2), red);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.9, 12).rotateX(-Math.PI / 2), white);
  nose.position.z = -2.1;
  const wing = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.1, 1.1), white);
  wing.position.set(0, -0.05, -0.25);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(5.62, 0.12, 0.3), red);
  stripe.position.set(0, -0.05, -0.1);
  const tailW = new THREE.Mesh(new THREE.BoxGeometry(2, 0.08, 0.6), white);
  tailW.position.set(0, 0.05, 1.5);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.9, 0.7), red);
  fin.position.set(0, 0.45, 1.5);
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 8), dark);
  canopy.position.set(0, 0.4, -0.3); canopy.scale.z = 1.6;
  const blade = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.12, 0.05), dark);
  const blade2 = blade.clone(); blade2.rotation.z = Math.PI / 2;
  prop.add(blade, blade2);
  prop.position.z = -2.6;
  plane.add(body, nose, wing, stripe, tailW, fin, canopy, prop);
}
scene.add(plane);

// ---- rings -------------------------------------------------------------------------------------
const RING_R = 7;
const ringGeo = new THREE.TorusGeometry(RING_R, 0.9, 12, 40);
const ringGold = new THREE.MeshLambertMaterial({ color: 0xffc933, emissive: 0x6a4a00 });
const ringGreen = new THREE.MeshLambertMaterial({ color: 0x4ee07a, emissive: 0x0f5a28 });
const rings = [];
let score = 0, rndSeed = 12345;
const rnd = () => ((rndSeed = (rndSeed * 16807) % 2147483647) / 2147483647);

// ---- flight state ------------------------------------------------------------------------------
const keys = new Set();
addEventListener('keydown', (e) => {
  if (e.code.startsWith('Arrow')) { keys.add(e.code); e.preventDefault(); }
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

let yaw = 0, pitch = 0, roll = 0, turn = 0;
const pos = new THREE.Vector3(0, terrain(0, 0) + 30, 0);
const camPos = new THREE.Vector3(), tmpV = new THREE.Vector3(), look = new THREE.Vector3();
const flat = () => tmpV.set(-Math.sin(yaw), 0, -Math.cos(yaw));
const ahead = (d) => terrain(pos.x - Math.sin(yaw) * d, pos.z - Math.cos(yaw) * d);

function spawnRing() {
  const a = yaw + (rnd() - 0.5) * 0.7, d = 95 + rnd() * 50;
  const x = pos.x - Math.sin(a) * d, z = pos.z - Math.cos(a) * d;
  let y = terrain(x, z) + 18 + rnd() * 20;
  y = THREE.MathUtils.clamp(y, pos.y - 22, pos.y + 22);
  y = Math.min(Math.max(y, terrain(x, z) + 17), 95);
  const m = new THREE.Mesh(ringGeo, ringGold);
  m.position.set(x, y, z);
  m.rotation.y = a;
  scene.add(m);
  rings.push({ m, n: new THREE.Vector3(Math.sin(a), 0, Math.cos(a)), prevS: null, hit: false });
}

let lastT = 0;
const rel = new THREE.Vector3();
function step(now) {
  const dt = lastT ? Math.min((now - lastT) / 1000, 0.1) : 0;
  lastT = now;

  const steer = (keys.has('ArrowLeft') ? 1 : 0) - (keys.has('ArrowRight') ? 1 : 0);   // + = left
  const climb = (keys.has('ArrowUp') ? 1 : 0) - (keys.has('ArrowDown') ? 1 : 0);
  const ease = 1 - Math.exp(-dt * 4);
  turn += (steer - turn) * ease;
  pitch += (climb * 0.45 - pitch) * ease;
  yaw += turn * 0.9 * dt;
  roll += (turn * 0.75 - roll) * ease;

  const f = flat().multiplyScalar(Math.cos(pitch));
  pos.x += f.x * SPEED * dt;
  pos.z += f.z * SPEED * dt;
  pos.y += Math.sin(pitch) * SPEED * dt;
  // stay above the hills (and the ones ahead): lift smoothly, hard floor under the plane
  const minAlt = Math.max(terrain(pos.x, pos.z), ahead(20), ahead(40)) + 16;
  if (pos.y < minAlt) pos.y += (minAlt - pos.y) * Math.min(1, dt * 4);
  pos.y = THREE.MathUtils.clamp(pos.y, terrain(pos.x, pos.z) + 12, 95);

  rebuildTerrain(pos.x, pos.z);

  plane.position.copy(pos);
  plane.rotation.set(pitch, yaw, -roll, 'YXZ');
  prop.rotation.z += dt * 40;

  // chase camera
  flat();
  tmpV.multiplyScalar(-CHASE_BACK).add(pos);
  tmpV.y += CHASE_UP;
  if (!lastT || camPos.lengthSq() === 0) camPos.copy(tmpV); else camPos.lerp(tmpV, 1 - Math.exp(-dt * 7));
  camPos.y = Math.max(camPos.y, terrain(camPos.x, camPos.z) + 12);
  cam.position.copy(camPos);
  look.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(22).add(pos);
  cam.lookAt(look);
  cam.rotateZ(-roll * 0.3);
  cam.updateMatrixWorld();

  // far layers follow the camera (they are "at infinity")
  sky.position.copy(cam.position);
  sun.position.copy(cam.position).addScaledVector(SUN_DIR, 820);
  for (const m of mountains) m.position.set(cam.position.x, 0, cam.position.z);
  floor.position.x = cam.position.x; floor.position.z = cam.position.z;
  for (const c of clouds) {
    const u = c.userData;
    const wrap = (v) => ((((v + 300) % 600) + 600) % 600) - 300;   // into [−300, 300)
    c.position.set(cam.position.x + wrap(u.x - cam.position.x), u.y, cam.position.z + wrap(u.z - cam.position.z));
  }

  // rings: pass test = the plane crossing the ring's disc within its radius
  while (rings.length < 5) spawnRing();
  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i];
    rel.copy(pos).sub(r.m.position);
    const s = rel.dot(r.n);
    if (!r.hit && r.prevS !== null && r.prevS > 0 && s <= 0) {
      const lateral = rel.addScaledVector(r.n, -s).length();
      if (lateral < RING_R + 0.6) {
        r.hit = true; r.m.material = ringGreen;
        nEl.textContent = ++score;
      }
    }
    r.prevS = s;
    if (s < -3 || rel.copy(pos).sub(r.m.position).lengthSq() > 260 * 260) {
      scene.remove(r.m); rings.splice(i, 1);
    }
  }
  altEl.textContent = `ALT ${Math.round(pos.y - terrain(pos.x, pos.z))} m`;
}

// ---- backing store: 2x wide woven, 1:1 flat. Sized BEFORE registering, then only in onResize -------
let sbs = false;
function sizeStore(cssW = canvas.clientWidth, cssH = canvas.clientHeight, dpr = devicePixelRatio || 1) {
  const w = Math.max(1, Math.round(cssW * dpr)), h = Math.max(1, Math.round(cssH * dpr));
  renderer.setSize(sbs ? 2 * w : w, h, false);
  cam.aspect = w / h;
  cam.updateProjectionMatrix();
}

// ---- woven path: attach pattern, drawn from the last GOOD frame (as samples/starter-world) -------
const eyes = [new EyeCamera(THREE), new EyeCamera(THREE)];
for (const e of eyes) cam.add(e.camera);
let last = null;

function onXRFrame(views, layer) {
  step(performance.now());
  const vps = views && views.length >= 2 ? views.map((v) => layer.getViewport(v)) : null;
  if (vps && vps.every((vp) => vp && vp.width > 0 && vp.height > 0)) {
    last = views.slice(0, 2).map((v, i) => ({
      proj: Array.from(v.projectionMatrix), pose: Array.from(v.transform.matrix),
      vp: { x: vps[i].x, y: vps[i].y, width: vps[i].width, height: vps[i].height },
    }));
  }
  drawEyes();
}
function drawEyes() {
  if (!last) return;
  renderer.clear();
  renderer.setScissorTest(true);
  last.forEach((e, i) => {
    renderer.setViewport(e.vp.x, e.vp.y, e.vp.width, e.vp.height);
    renderer.setScissor(e.vp.x, e.vp.y, e.vp.width, e.vp.height);
    eyes[i].setLocalFromMatrices(e.proj, e.pose);
    renderer.render(scene, eyes[i].camera);
  });
  renderer.setScissorTest(false);
}
function onResize({ width, height, dpr }) {
  sizeStore(width, height, dpr);
  if (!last) return;
  const w = canvas.width / 2;
  last.forEach((e, i) => { e.vp = { x: i * w, y: 0, width: w, height: canvas.height }; });
  drawEyes();
}

// ---- mono path ------------------------------------------------------------------------------------
function onMonoFrame(now) {
  requestAnimationFrame(onMonoFrame);
  step(now);
  renderer.clear();
  renderer.setViewport(0, 0, canvas.width, canvas.height);
  renderer.render(scene, cam);
}

// ---- boot ------------------------------------------------------------------------------------------
step(0);                               // place plane + camera before the first frame
const wall = await createInline3D({ lazy: false });
if (wall.supported) {
  sbs = true;
  sizeStore();
  const rig = (k) => cameraRigFromCamera(THREE, cam, {
    convergence: CONVERGENCE, attach: true, metersToVirtual: METERS_TO_VIRTUAL, ipdFactor: k, parallaxFactor: k,
  });
  const handle = wall.addScene(canvas, onXRFrame, { viewRig: rig(1), onResize });
  wall.session.updateRenderState({ depthNear: cam.near, depthFar: cam.far });

  // Depth slider: one value moves BOTH factors. On a camera rig they are absolute; 1 is the tuned top.
  depthEl.addEventListener('input', () => handle.setViewRig(rig(Number(depthEl.value))));
  let flatMode = false;
  const show = () => { modeBtn.textContent = flatMode ? 'Show in 3D' : 'Show in 2D'; };
  handle.on('renderingmodechange', (e) => { if (e.viewCount) { flatMode = e.viewCount === 1; show(); } });
  modeBtn.addEventListener('click', () => {
    handle.setStereoEnabled(flatMode).catch(() => {      // no flat mode: slider at 0 is flat anywhere
      flatMode = !flatMode;
      depthEl.value = flatMode ? 0 : 1;
      handle.setViewRig(rig(Number(depthEl.value)));
      show();
    });
  });
  show();
  await handle.firstWoven;
  cover.remove();                      // cut, never fade
} else {
  sizeStore();
  new ResizeObserver(() => sizeStore()).observe(canvas);
  cover.remove();
  depthEl.disabled = modeBtn.disabled = true;
  modeBtn.textContent = '2D';
  noteEl.textContent = 'Open in the DisplayXR Browser on a 3D display to see it in 3D.';
  requestAnimationFrame(onMonoFrame);
}
