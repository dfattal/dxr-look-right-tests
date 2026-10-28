// Ring Runner: a three.js flight game on the DisplayXR inline-3D display rig.
//
// The scene is a diorama authored in metres for a 0.24 m virtual display (addScene's default):
// z = 0 is the glass, +z comes toward the viewer. The plane is the subject the player steers, so
// it stays on the portal and the world scrolls past it. Depth is folded into a comfortable band
// around the glass (see depthOf). NOTES.md has the reasoning.

import * as THREE from 'three';
import { createInline3D } from '@displayxr/inline3d';
import { EyeCamera, EdgeFeather } from '@displayxr/inline3d/three';

// ---- display geometry -----------------------------------------------------------------------
const VDH = 0.24;                       // virtual display height the scene is composed for (m)
const VIEW_DIST = 0.6;                  // the runtime's nominal viewer distance (m)
const MONO_FOV = THREE.MathUtils.radToDeg(2 * Math.atan(VDH / 2 / VIEW_DIST)); // same framing in 2D

// Depth budget. Disparity on the glass is about 63 mm × depth / (0.6 + depth), so content stays
// within roughly ±0.1 m of the glass or the two eyes cannot fuse it.
const PLANE_Z = 0.03;                   // the plane pops 3 cm out of the glass
const K_BACK = 0.09;                    // the world recedes at most this far behind the plane's depth
const K_FRONT = 0.03;                   // and comes toward the viewer at most this far
const L_BACK = 0.2, L_FRONT = 0.2;      // distance (m) over which each limit is approached

// ---- world (metres along the track) ---------------------------------------------------------
const SPEED = 0.2;                      // m/s along the track
const ROW = 0.02, COL = 0.025;          // terrain grid spacing: along the track, across it
const X_HALF = 0.6;                     // terrain half-width (wider than the window at any depth)
const GROUND_Y = -0.09;                 // ground rests here; the window's bottom edge is at -0.12
const PX_MAX = 0.14, PY_MAX = 0.11;     // plane's reachable window
const CLEAR = 0.014;                    // plane never flies closer than this to the ground
const LAT_SPEED = 0.12, VERT_SPEED = 0.08;
const RING_R = 0.04, HIT_R = 0.03;      // ring radius, and the plane-centre distance that scores
const RING_SPAN = [0.14, 0.3];          // metres between rings along the track
const RING_FAR = 1.3;                   // rings appear this far ahead, and fade in

const SKY_TOP = new THREE.Color(0x2a5bb5);
const HORIZON = new THREE.Color(0xc4e3f7);
const VALLEY = new THREE.Color(0x4f8f3a);
const RIDGE = new THREE.Color(0xa08f50);
const RING_GOLD = 0xffc53d, RING_HIT = 0x5eead4, RING_MISS = 0x6b7280;

// Procedural hills: a sum of travelling sines over (x, a), with random phases each load. a is the
// distance along the track, so the ground under the plane is groundAt(px, s).
const PH = Array.from({ length: 4 }, () => Math.random() * Math.PI * 2);
function hills(x, a) {
  return 0.016 * Math.sin(12.5 * a + 0.9 * x + PH[0])
       + 0.009 * Math.sin(9.1 * a - 6.3 * x + PH[1])
       + 0.005 * Math.sin(23 * a + 14 * x + PH[2])
       + 0.004 * Math.sin(31 * x + 3.1 * a + PH[3]);
}
const groundAt = (x, a) => GROUND_Y + hills(x, a);

// dist = how far ahead of the plane something is along the track (negative = already passed).
// Returns its depth: the plane's depth at dist 0, receding to PLANE_Z - K_BACK far ahead and
// coming toward the viewer to PLANE_Z + K_FRONT behind. Continuous at 0 and monotonic in dist.
function depthOf(dist) {
  return dist >= 0
    ? PLANE_Z - K_BACK * (1 - Math.exp(-dist / L_BACK))
    : PLANE_Z + K_FRONT * (1 - Math.exp(dist / L_FRONT));
}
// Aerial perspective: 0 near, 1 at the horizon. Haze is colour only, so it costs no depth.
const haze = (dist) => THREE.MathUtils.smoothstep(dist, 0.1, 1.6);

// ---- renderer and scene ---------------------------------------------------------------------
const canvas = document.getElementById('game');
const scoreEl = document.getElementById('score');
const statusEl = document.getElementById('status');
const hintEl = document.getElementById('hint');
const cover = document.getElementById('cover');

// alpha + a 0-alpha clear: the EdgeFeather pass fades the edges to transparent, into the page.
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(1);              // the backing store is sized in JS (see sizeBuffer)
renderer.autoClear = false;             // we clear once per frame, then draw each eye's viewport

const scene = new THREE.Scene();

scene.add(new THREE.HemisphereLight(0xdbeafe, 0x3d5a2a, 1.1));
const sun = new THREE.DirectionalLight(0xfff4e0, 1.0);
sun.position.set(0.4, 1, 0.8);
scene.add(sun);

// Sky: a vertical gradient on a backdrop behind everything. Unlit, so it never shades.
const sky = new THREE.Mesh(
  new THREE.PlaneGeometry(6, 3, 1, 1),
  new THREE.MeshBasicMaterial({ vertexColors: true, depthWrite: false }),
);
{
  const pos = sky.geometry.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = THREE.MathUtils.clamp((pos.getY(i) + 0.1) / 1.6, 0, 1);
    c.copy(HORIZON).lerp(SKY_TOP, t);
    col.set([c.r, c.g, c.b], i * 3);
  }
  sky.geometry.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
}
sky.position.set(0, 0.02, -0.12);
sky.renderOrder = -1;
scene.add(sky);

// Clouds: a few soft puffs between the far ridges and the sky.
const clouds = new THREE.Group();
clouds.position.z = -0.11;
const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false });
for (let c = 0; c < 6; c++) {
  const cloud = new THREE.Group();
  for (let k = 0; k < 4; k++) {
    const puff = new THREE.Mesh(new THREE.CircleGeometry(0.02 + Math.random() * 0.02, 20), cloudMat);
    puff.position.set((k - 1.5) * 0.024, (Math.random() - 0.5) * 0.01, 0);
    cloud.add(puff);
  }
  cloud.position.set(-0.5 + Math.random() * 1.0, 0.05 + Math.random() * 0.1, 0);
  clouds.add(cloud);
}
scene.add(clouds);

// Mountain ridges: a strip of jagged peaks, two layers at different depths for parallax.
function ridgeMesh({ z, xMax, n, baseY, hMin, hMax, rock, snow }) {
  const peaks = Array.from({ length: n }, () => Math.random());
  for (let p = 0; p < 2; p++) {
    for (let i = 1; i < n - 1; i++) peaks[i] = (peaks[i - 1] + 2 * peaks[i] + peaks[i + 1]) / 4;
  }
  const pos = [], col = [], idx = [];
  const top = new THREE.Color(), base = new THREE.Color(rock).multiplyScalar(0.55);
  const hi = new THREE.Color(snow);
  for (let i = 0; i < n; i++) {
    const x = -xMax + (2 * xMax * i) / (n - 1), t = peaks[i];
    pos.push(x, baseY + hMin + (hMax - hMin) * t, z, x, baseY - 0.5, z);
    top.set(rock).lerp(hi, THREE.MathUtils.clamp((t - 0.7) / 0.3, 0, 1));
    col.push(top.r, top.g, top.b, base.r, base.g, base.b);
    if (i < n - 1) { const a = 2 * i, b = a + 2; idx.push(a, a + 1, b, b, a + 1, b + 1); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
}
const far = ridgeMesh({ z: -0.1, xMax: 0.9, n: 41, baseY: GROUND_Y - 0.02, hMin: 0.1, hMax: 0.26, rock: 0x7d8fc4, snow: 0xf3f7ff });
const near = ridgeMesh({ z: -0.085, xMax: 0.8, n: 33, baseY: GROUND_Y - 0.01, hMin: 0.04, hMax: 0.14, rock: 0x3c6b5c, snow: 0xdbe7ea });
scene.add(far, near);

// Terrain: one fixed-topology grid whose rows slide along the track. Row i is the track point
// a_i = (k0 + i) * ROW, so the ground's shape depends only on a, never on how far we have flown.
const NC = Math.round((2 * X_HALF) / COL) + 1;
const XS = Array.from({ length: NC }, (_, j) => -X_HALF + j * COL);
const NR = Math.ceil(3.1 / ROW) + 2;    // rows from 1 m behind the plane to 2.1 m ahead
const tPos = new Float32Array(NR * NC * 3);
const tCol = new Float32Array(NR * NC * 3);
const tIdx = [];
for (let i = 0; i < NR - 1; i++) {
  for (let j = 0; j < NC - 1; j++) {
    const a = i * NC + j, c = a + NC;
    tIdx.push(a, c, a + 1, a + 1, c, c + 1);
  }
}
const terrainGeo = new THREE.BufferGeometry();
const tPosAttr = new THREE.BufferAttribute(tPos, 3).setUsage(THREE.DynamicDrawUsage);
const tColAttr = new THREE.BufferAttribute(tCol, 3).setUsage(THREE.DynamicDrawUsage);
terrainGeo.setAttribute('position', tPosAttr);
terrainGeo.setAttribute('color', tColAttr);
terrainGeo.setIndex(tIdx);
const terrain = new THREE.Mesh(terrainGeo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
terrain.frustumCulled = false;          // vertices move every frame, so the stale bounds would cull it
scene.add(terrain);

function updateTerrain() {
  const k0 = Math.floor((s - 1.0) / ROW);
  const tmp = new THREE.Color();
  for (let i = 0; i < NR; i++) {
    const a = (k0 + i) * ROW, dist = a - s, z = depthOf(dist);
    for (let j = 0; j < NC; j++) {
      const x = XS[j], h = hills(x, a), v = (i * NC + j) * 3;
      tPos[v] = x;
      tPos[v + 1] = GROUND_Y + h;
      tPos[v + 2] = z;
      const t = THREE.MathUtils.clamp((h + 0.02) / 0.04, 0, 1);
      tmp.copy(VALLEY).lerp(RIDGE, t).lerp(HORIZON, haze(dist));
      tCol[v] = tmp.r; tCol[v + 1] = tmp.g; tCol[v + 2] = tmp.b;
    }
  }
  tPosAttr.needsUpdate = true;
  tColAttr.needsUpdate = true;
  terrainGeo.computeVertexNormals();
}

// The plane: built from primitives, nose toward -z (into the scene), seen from behind like a chase view.
function buildPlane() {
  const g = new THREE.Group();
  const orange = new THREE.MeshLambertMaterial({ color: 0xf97316 });
  const white = new THREE.MeshLambertMaterial({ color: 0xf8fafc });
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m; };
  add(new THREE.CylinderGeometry(0.0035, 0.0035, 0.05, 12).rotateX(Math.PI / 2), orange, 0, 0, 0);     // fuselage
  add(new THREE.ConeGeometry(0.0035, 0.01, 12).rotateX(-Math.PI / 2), orange, 0, 0, -0.03);            // nose
  add(new THREE.BoxGeometry(0.06, 0.0012, 0.013), white, 0, 0, 0.004);                                   // wings
  add(new THREE.BoxGeometry(0.0012, 0.0115, 0.009), orange, 0, 0.006, 0.02);                            // fin
  add(new THREE.BoxGeometry(0.02, 0.0012, 0.006), white, 0, 0, 0.021);                                  // tailplane
  const propeller = add(new THREE.BoxGeometry(0.018, 0.0012, 0.0008), white, 0, 0, -0.0355);          // spins about z
  g.scale.setScalar(0.9);
  return { group: g, propeller };
}
const { group: plane, propeller } = buildPlane();
scene.add(plane);

// Rings: a fixed pool, recycled. Each ring lives at track point `a`, and its depth comes from dist.
const RING_GEO = new THREE.TorusGeometry(RING_R, 0.0035, 10, 40);
const rings = [];
for (let i = 0; i < 14; i++) {
  const mesh = new THREE.Mesh(RING_GEO, new THREE.MeshLambertMaterial({ color: RING_GOLD, emissive: 0x3a2400, transparent: true }));
  mesh.visible = false;
  scene.add(mesh);
  rings.push({ mesh, a: 0, x: 0, y: 0, active: false, passed: false, hit: false, t: 0 });
}
let nextRingAt = 0.8;
let score = 0;

function spawnRing(a) {
  const r = rings.find((q) => !q.active);
  if (!r) return;
  r.a = a;
  r.x = (Math.random() * 2 - 1) * PX_MAX;
  r.y = groundAt(r.x, a) + 0.035 + Math.random() * 0.07;
  Object.assign(r, { active: true, passed: false, hit: false, t: 0 });
  r.mesh.material.color.setHex(RING_GOLD);
  r.mesh.visible = true;
}

function setScore(v) {
  score = v;
  scoreEl.textContent = String(v);
}

// Cameras. The eye camera is driven straight from each XRView; the mono camera is the same view
// with the same framing, for a browser without the SDK.
const eyeCam = new EyeCamera(THREE);
const monoCam = new THREE.PerspectiveCamera(MONO_FOV, 16 / 9, 0.01, 10);
monoCam.position.set(0, 0, VIEW_DIST);
monoCam.lookAt(0, 0, 0);

// Edge fade per eye. It has to be per eye because each eye's image spans the whole window.
const feather = new EdgeFeather(THREE, { px: 26 });

// ---- buffer sizing --------------------------------------------------------------------------
// In SBS mode the backing store is 2 eyes wide (left | right) at the CSS box's aspect. The weave
// squeezes the pair back into the box. Mono is one eye at the box's aspect. pixelRatio stays at 1,
// so getViewport's backing-store pixels are used as-is.
let sbsMode = false;
let eyeW = 640, eyeH = 360;
function measure() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cw = canvas.clientWidth || 640, ch = canvas.clientHeight || 360;
  const k = Math.min(1, 1600 / (cw * dpr));     // cap one eye at 1600 px wide
  eyeW = Math.round(cw * dpr * k);
  eyeH = Math.round(ch * dpr * k);
}
// Returns true when the buffer really changed. Writing canvas.width clears it, even to the same
// value, so compare first and redraw straight away when it did change.
function sizeBuffer(force = false) {
  measure();
  const w = sbsMode ? eyeW * 2 : eyeW, h = eyeH;
  if (!force && w === canvas.width && h === canvas.height) return false;
  renderer.setSize(w, h, false);                // updateStyle false: the CSS box belongs to the layout
  monoCam.aspect = eyeW / eyeH;
  monoCam.updateProjectionMatrix();
  return true;
}

// ---- input and timing -----------------------------------------------------------------------
const keys = new Set();
const ARROWS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
addEventListener('keydown', (e) => {
  if (!ARROWS.includes(e.key)) return;
  keys.add(e.key);
  e.preventDefault();                           // arrows steer; they must not scroll the page
});
addEventListener('keyup', (e) => keys.delete(e.key));
addEventListener('blur', () => keys.clear());

const vel = new THREE.Vector2();                // lateral, vertical velocity of the plane (m/s)
let s = 0, px = 0, py = 0.02;                   // s: distance flown; px, py: plane on the glass
let lastNow = 0;
function step() {
  const now = performance.now();
  const dt = lastNow ? Math.min(0.05, (now - lastNow) / 1000) : 0;
  lastNow = now;
  update(dt);
}

function update(dt) {
  const ease = Math.min(1, dt * 5);
  const tvx = ((keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0)) * LAT_SPEED;
  const tvy = ((keys.has('ArrowUp') ? 1 : 0) - (keys.has('ArrowDown') ? 1 : 0)) * VERT_SPEED;
  vel.x += (tvx - vel.x) * ease;
  vel.y += (tvy - vel.y) * ease;
  px = THREE.MathUtils.clamp(px + vel.x * dt, -PX_MAX, PX_MAX);
  py += vel.y * dt;
  s += SPEED * dt;

  // The plane sits on the track at dist 0, so the ground under it is groundAt(px, s).
  const floor = groundAt(px, s) + CLEAR;
  if (py < floor) { py = floor; vel.y = Math.max(vel.y, 0); }
  py = Math.min(py, PY_MAX);

  plane.position.set(px, py, PLANE_Z);
  plane.rotation.set(
    THREE.MathUtils.clamp(vel.y * 4, -0.4, 0.4),          // pitch
    -vel.x * 1.5,                                         // yaw into the turn
    THREE.MathUtils.clamp(-vel.x * 5, -0.6, 0.6),         // bank: right turn, right wing down
  );
  propeller.rotation.z += dt * 50;

  // Mountains and clouds shift a little against the plane's lateral motion: parallax, not depth.
  far.position.x = -px * 0.1;
  near.position.x = -px * 0.2;
  clouds.position.x = -px * 0.05;

  updateTerrain();
  updateRings(dt);
}

function updateRings(dt) {
  while (nextRingAt < s + RING_FAR) {
    spawnRing(nextRingAt);
    nextRingAt += RING_SPAN[0] + Math.random() * (RING_SPAN[1] - RING_SPAN[0]);
  }
  for (const r of rings) {
    if (!r.active) continue;
    const dist = r.a - s;
    if (!r.passed && dist <= 0) {
      r.passed = true;
      const dx = r.x - px, dy = r.y - py;
      r.hit = dx * dx + dy * dy < HIT_R * HIT_R;
      if (r.hit) setScore(score + 1);
      r.mesh.material.color.setHex(r.hit ? RING_HIT : RING_MISS);
    }
    if (r.hit) r.t += dt;
    if (dist < -0.25 || r.t > 0.6) {            // far enough behind the plane, or the flash is over
      r.active = false;
      r.mesh.visible = false;
      continue;
    }
    const fadeIn = THREE.MathUtils.clamp((RING_FAR - dist) / 0.3, 0, 1);
    r.mesh.material.opacity = r.hit ? fadeIn * (1 - r.t / 0.6) : fadeIn;
    r.mesh.scale.setScalar(r.hit ? 1 + r.t * 1.5 : 1);
    r.mesh.position.set(r.x, r.y, depthOf(dist));
  }
}

// ---- drawing --------------------------------------------------------------------------------
// The last good pair of eyes, copied out of the XRViews. An XRView is valid only inside its own
// callback, so a frame that arrives short replays these copies instead of clearing to nothing.
let lastEyes = null;
function captureEyes(views, layer) {
  if (views.length < 2) return false;
  const vps = [layer.getViewport(views[0]), layer.getViewport(views[1])];
  if (!vps[0] || !vps[1]) return false;
  if (!lastEyes) {
    lastEyes = [0, 1].map(() => ({
      proj: new Float32Array(16), xf: new Float32Array(16),
      vp: { x: 0, y: 0, width: 0, height: 0 },
    }));
  }
  for (let i = 0; i < 2; i++) {
    lastEyes[i].proj.set(views[i].projectionMatrix);
    lastEyes[i].xf.set(views[i].transform.matrix);
    Object.assign(lastEyes[i].vp, vps[i]);
  }
  return true;
}

// Before any real pair has arrived: the mono camera drawn into both halves.
function monoHalves() {
  monoCam.updateMatrixWorld();
  const w = canvas.width / 2, h = canvas.height;
  return [0, 1].map((i) => ({
    proj: monoCam.projectionMatrix.elements,
    xf: monoCam.matrixWorld.elements,
    vp: { x: i * w, y: 0, width: w, height: h },
  }));
}

function drawEyes(eyes) {
  renderer.clear();
  renderer.setScissorTest(true);
  for (const e of eyes) {
    const { x, y, width, height } = e.vp;
    renderer.setViewport(x, y, width, height);
    renderer.setScissor(x, y, width, height);
    eyeCam.setFromMatrices(e.proj, e.xf);
    renderer.render(scene, eyeCam.camera);
    feather.render(renderer, e.vp);
  }
  renderer.setScissorTest(false);
}

function drawMono() {
  const w = canvas.width, h = canvas.height;
  renderer.clear();
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, w, h);
  renderer.render(scene, monoCam);
  feather.render(renderer, { x: 0, y: 0, width: w, height: h });
}

// The SDK calls this once per XR frame with the two eye views. Validate before drawing, and
// clear only once we can draw both eyes. A bad frame replays the last good one.
function onXRFrame(views, layer) {
  step();
  if (captureEyes(views, layer)) drawEyes(lastEyes);
  else drawEyes(lastEyes || monoHalves());
}

let started = false;
function onResize() {
  if (!sizeBuffer() || !started) return;
  if (sbsMode) drawEyes(lastEyes || monoHalves());
  else drawMono();
}
new ResizeObserver(onResize).observe(canvas);
addEventListener('resize', onResize);

function monoFrame() {
  requestAnimationFrame(monoFrame);
  step();
  drawMono();
}

// ---- boot -----------------------------------------------------------------------------------
const twoFrames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

(async () => {
  sizeBuffer(true);
  update(0);
  const wall = await createInline3D({ lazy: false });

  if (!wall.supported) {
    // Plain browser: the same scene as a 2D canvas.
    cover.remove();
    statusEl.textContent = 'Flat preview. Open this page in the DisplayXR Browser on a DisplayXR display for glasses-free 3D.';
    started = true;
    requestAnimationFrame(monoFrame);
    return;
  }

  // Commit the canvas before registering it: a 2:1 backing store, and two frames to settle.
  sbsMode = true;
  sizeBuffer(true);
  await twoFrames();

  const handle = wall.addScene(canvas, onXRFrame, { virtualDisplayHeight: VDH });
  started = true;

  // Hold the cover until the first woven frame, then cut it.
  handle.firstWoven.then(({ woven }) => {
    cover.remove();
    statusEl.textContent = woven
      ? '3D on: move your head to look around.'
      : 'This window is not weaving here, so it shows flat.';
  });

  wall.on('trackingstatechange', (state) => { hintEl.hidden = state !== 'searching'; });
})();
