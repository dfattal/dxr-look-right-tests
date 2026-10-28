// Sky Rings — a small three.js flight game for a glasses-free 3D (lenticular) display, via the
// DisplayXR inline-3D SDK, with a plain 2D fallback in any other browser.
//
// Stereo design, in one paragraph (details in NOTES.md):
// This is a game the user flies THROUGH a world, so it hands the runtime its own chase camera as a
// CAMERA RIG (cameraRigFromCamera) and lets the runtime compute both off-axis eyes. The rig is sent
// identity-posed with the eye cameras parented under the app camera (the "attach pattern") so the
// stereo never lags the chase camera by a frame. The world is authored at a scale where the chase
// distance is ~2.5 world units ("metres" to the runtime): convergence sits just behind the plane, so
// the plane floats a hair in front of the glass and the landscape recedes behind it, and the
// comfort number (ipd × m2v × diopters × 0.5) stays ~0.14 — well inside the no-divergence limit of
// 1, which keeps the far hills/mountains at a modest on-screen disparity (less crosstalk ghosting).

import * as THREE from 'three';

// ---------------------------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------------------------
const FOV = 45;               // vertical FOV, degrees (sent to the runtime in the rig)
const NEAR = 0.25, FAR = 1200;
const CHASE_BACK = 2.35;      // chase camera distance behind the plane (world units ≈ metres)
const CHASE_UP = 0.62;        // …and above it
const CONV_FACTOR = 1.12;     // convergence = 1.12 × camera→plane distance: plane slightly OUT of the glass
let depthScale = 0.8;         // camera-rig ipdFactor (absolute). [ / ] adjust it live on a 3D display.
const DEPTH_MIN = 0.3, DEPTH_MAX = 1.2;

const BASE_SPEED = 9;         // world units / s
const WATER = -5.5;
const CHUNK = 48, SEG = 24, RAD = 4;   // terrain chunks: 9×9 around the plane, 2-unit grid
const FOG_NEAR = 55, FOG_FAR = 185;    // FOG_FAR < RAD*CHUNK so the terrain edge is never seen
const RING_R = 1.55, RING_TUBE = 0.13, RINGS_AHEAD = 5, RING_SPACING = 40;

const SKY_TOP = new THREE.Color(0x2f6fc0);
const SKY_HORIZON = new THREE.Color(0xc9def0);
const SUN_DIR = new THREE.Vector3(-0.45, 0.62, -0.64).normalize();

const params = new URLSearchParams(location.search);
const FORCE_2D = params.has('2d');
if (params.has('depth')) depthScale = clamp(parseFloat(params.get('depth')) || depthScale, DEPTH_MIN, DEPTH_MAX);

// ---------------------------------------------------------------------------------------------
// Small math helpers + deterministic value noise
// ---------------------------------------------------------------------------------------------
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function smoothstep(a, b, v) { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
function damp(dt, rate) { return 1 - Math.exp(-dt * rate); }

function hash2(ix, iz, seed = 0) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function noise(x, z, seed = 0) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  return (a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz) * 2 - 1;
}
function fbm(x, z, oct = 4, seed = 0) {
  let s = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += amp * noise(x * f, z * f, seed + i * 17); f *= 2.03; amp *= 0.5; }
  return s;
}

// Rolling hills: a broad fBm, plus a gentle mid-frequency swell. Analytic so normals, collisions,
// shadows and ring placement all agree across chunk seams.
function groundHeight(x, z) {
  return fbm(x * 0.0105, z * 0.0105, 4, 3) * 17 + noise(x * 0.04 + 7.3, z * 0.04 - 2.1, 9) * 1.6 + 1.5;
}
function surfaceHeight(x, z) { return Math.max(groundHeight(x, z), WATER); }

// ---------------------------------------------------------------------------------------------
// Renderer, scene, camera
// ---------------------------------------------------------------------------------------------
const canvas = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({
  canvas, antialias: true,
  // Full-window woven scene: lets the browser copy each frame to a separate front buffer, which
  // avoids the read/write race on large tiles (porting pitfall 26).
  preserveDrawingBuffer: true,
});
// MUST be 1: layer.getViewport() reports backing-store px, and three multiplies setViewport by
// the pixel ratio. We size the backing store in device px ourselves.
renderer.setPixelRatio(1);
renderer.autoClear = false;
renderer.setClearColor(SKY_HORIZON, 1);   // a not-yet-drawn frame is sky-coloured, not black

const gl = renderer.getContext();
const MAX_DIM = Math.min(
  gl.getParameter(gl.MAX_TEXTURE_SIZE),
  gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
  ...gl.getParameter(gl.MAX_VIEWPORT_DIMS),
);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(SKY_HORIZON, FOG_NEAR, FOG_FAR);

const hemi = new THREE.HemisphereLight(0xd6e8ff, 0x55683a, 1.15);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1dc, 2.1);
sun.position.copy(SUN_DIR).multiplyScalar(100);
scene.add(sun);
scene.add(sun.target);

// The app's own camera. IN the scene on purpose: the attach pattern parents the eye cameras under
// it, and three only reaches a parented camera through a scene traversal.
const appCam = new THREE.PerspectiveCamera(FOV, 16 / 9, NEAR, FAR);
scene.add(appCam);

// ---------------------------------------------------------------------------------------------
// Sky dome (gradient + soft sun glow). Uniform colour has no stereo texture, so its "infinite"
// disparity costs nothing visually.
// ---------------------------------------------------------------------------------------------
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(1000, 32, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: SKY_TOP }, horizon: { value: SKY_HORIZON }, sunDir: { value: SUN_DIR } },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = max(d.y, 0.0);
        vec3 c = mix(horizon, top, pow(h, 0.55));
        float s = max(dot(d, sunDir), 0.0);
        c += vec3(1.0, 0.85, 0.6) * (pow(s, 10.0) * 0.18 + pow(s, 80.0) * 0.35);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  }),
);
sky.renderOrder = -10;
scene.add(sky);

// ---------------------------------------------------------------------------------------------
// Distant mountains: two layered ridgelines on rings far outside the fog, following the plane so
// they are never reached. Haze-tinted, snow on the high peaks, unlit.
// ---------------------------------------------------------------------------------------------
function makeRange(radius, minH, maxH, base, snow, haze, seed) {
  const N = 480;
  const pos = [], col = [], idx = [];
  const cBase = new THREE.Color(base), cSnow = new THREE.Color(snow), cHaze = new THREE.Color(haze);
  const tmp = new THREE.Color();
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const cx = Math.cos(a), sz = Math.sin(a);
    // periodic noise: sample on a circle so the ridge closes seamlessly
    const n = fbm(cx * 3.2 + 10, sz * 3.2 - 4, 5, seed) * 0.5 + 0.5;
    const peaks = Math.pow(clamp(n, 0, 1), 1.6);
    const h = minH + (maxH - minH) * peaks;
    const streak = noise(i * 0.9, seed, seed + 5) * 0.07;   // vertical striations = rock texture
    const rows = [[-40, 0], [h * 0.45, 0.5], [h * 0.8, 0.8], [h, 1]];
    for (const [y, t] of rows) {
      pos.push(cx * radius, y, sz * radius);
      if (t === 0) tmp.copy(cHaze);
      else {
        tmp.copy(cHaze).lerp(cBase, Math.min(1, t * 1.25));
        tmp.offsetHSL(0, 0, streak);
        if (t >= 0.8 && h > minH + (maxH - minH) * 0.55) tmp.lerp(cSnow, t === 1 ? 0.95 : 0.45);
      }
      col.push(tmp.r, tmp.g, tmp.b);
    }
  }
  for (let i = 0; i < N; i++) {
    for (let r = 0; r < 3; r++) {
      const a = i * 4 + r, b = (i + 1) * 4 + r;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: false }));
}
const mountains = new THREE.Group();
mountains.add(makeRange(640, 55, 150, 0x8fa7c2, 0xf2f6fb, 0xc3d7ea, 21));  // far, paler
mountains.add(makeRange(470, 30, 105, 0x5f7891, 0xeef3f8, 0xb6cde2, 42));  // nearer, darker
mountains.children[0].renderOrder = -9;
mountains.children[1].renderOrder = -8;
scene.add(mountains);

// ---------------------------------------------------------------------------------------------
// Terrain: chunked, procedurally generated, with vertex-colour texture (mottled fields give the
// eyes something to fuse on — flat colours read as flat) and instanced trees.
// ---------------------------------------------------------------------------------------------
const terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true });
const chunks = new Map();
const C = {
  sand: new THREE.Color(0xd8c690), grassA: new THREE.Color(0x5d9a3a), grassB: new THREE.Color(0x3f7b2c),
  field: new THREE.Color(0x9bbb4c), dry: new THREE.Color(0x8c9a55), rock: new THREE.Color(0x857f70),
};
const tc = new THREE.Color();

function terrainNormal(x, z, out) {
  const e = 0.8;
  const dx = groundHeight(x + e, z) - groundHeight(x - e, z);
  const dz = groundHeight(x, z + e) - groundHeight(x, z - e);
  return out.set(-dx / (2 * e), 1, -dz / (2 * e)).normalize();
}

function buildChunk(i, j) {
  const g = new THREE.PlaneGeometry(CHUNK, CHUNK, SEG, SEG);
  g.rotateX(-Math.PI / 2);
  const ox = (i + 0.5) * CHUNK, oz = (j + 0.5) * CHUNK;
  const p = g.attributes.position;
  const nrm = g.attributes.normal;
  const colors = new Float32Array(p.count * 3);
  const n = new THREE.Vector3();
  for (let v = 0; v < p.count; v++) {
    const wx = p.getX(v) + ox, wz = p.getZ(v) + oz;
    const h = groundHeight(wx, wz);
    p.setY(v, h);
    terrainNormal(wx, wz, n);
    nrm.setXYZ(v, n.x, n.y, n.z);
    // colour
    if (h < WATER + 0.9) tc.copy(C.sand);
    else {
      const patch = noise(wx * 0.07, wz * 0.07, 31);
      tc.copy(C.grassA).lerp(C.grassB, clamp(noise(wx * 0.18, wz * 0.18, 5) * 0.5 + 0.5, 0, 1));
      if (patch > 0.35) tc.lerp(C.field, smoothstep(0.35, 0.5, patch) * 0.75);
      if (h > 9) tc.lerp(C.dry, smoothstep(9, 14, h));
      if (n.y < 0.86) tc.lerp(C.rock, smoothstep(0.86, 0.72, n.y));
      tc.offsetHSL(0, 0, (hash2(Math.round(wx * 2), Math.round(wz * 2), 77) - 0.5) * 0.05);
    }
    colors[v * 3] = tc.r; colors[v * 3 + 1] = tc.g; colors[v * 3 + 2] = tc.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  const mesh = new THREE.Mesh(g, terrainMat);
  mesh.position.set(ox, 0, oz);
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  scene.add(mesh);

  // trees: jittered 8-unit grid, thinned by a forest-density noise
  const trees = [];
  const cells = CHUNK / 8;
  for (let a = 0; a < cells; a++) {
    for (let b = 0; b < cells; b++) {
      const gx = i * cells + a, gz = j * cells + b;
      const r = hash2(gx, gz, 101);
      const forest = noise(gx * 0.11, gz * 0.11, 55);
      if (r > 0.25 + forest * 0.45) continue;
      const tx = gx * 8 + 1 + hash2(gx, gz, 102) * 6, tz = gz * 8 + 1 + hash2(gx, gz, 103) * 6;
      const th = groundHeight(tx, tz);
      if (th < WATER + 1.2) continue;
      terrainNormal(tx, tz, n);
      if (n.y < 0.84) continue;
      trees.push({ x: tx, y: th - 0.05, z: tz, s: 0.75 + hash2(gx, gz, 104) * 0.7, r: hash2(gx, gz, 105) * 6.28,
        shade: hash2(gx, gz, 106) });
    }
  }
  chunks.set(`${i},${j}`, { mesh, trees, i, j });
}

const MAX_TREES = (2 * RAD + 3) ** 2 * (CHUNK / 8) ** 2;
const trunks = new THREE.InstancedMesh(
  new THREE.CylinderGeometry(0.07, 0.1, 0.55, 6).translate(0, 0.27, 0),
  new THREE.MeshLambertMaterial({ color: 0x6b4a2e }), MAX_TREES);
const crowns = new THREE.InstancedMesh(
  new THREE.ConeGeometry(0.48, 1.35, 7).translate(0, 1.05, 0),
  new THREE.MeshLambertMaterial({ color: 0xffffff }), MAX_TREES);
trunks.frustumCulled = crowns.frustumCulled = false;   // instances span the whole map
scene.add(trunks, crowns);

function rebuildTrees() {
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const cA = new THREE.Color(0x2f6b2a), cB = new THREE.Color(0x1f4f24), c = new THREE.Color();
  let k = 0;
  for (const ch of chunks.values()) {
    for (const t of ch.trees) {
      if (k >= MAX_TREES) break;
      q.setFromAxisAngle(up, t.r);
      s.setScalar(t.s);
      p.set(t.x, t.y, t.z);
      m.compose(p, q, s);
      trunks.setMatrixAt(k, m);
      crowns.setMatrixAt(k, m);
      crowns.setColorAt(k, c.copy(cA).lerp(cB, t.shade));
      k++;
    }
  }
  trunks.count = crowns.count = k;
  trunks.instanceMatrix.needsUpdate = crowns.instanceMatrix.needsUpdate = true;
  if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
}

let lastCi = null, lastCj = null;
function updateChunks() {
  const ci = Math.floor(P.pos.x / CHUNK), cj = Math.floor(P.pos.z / CHUNK);
  if (ci === lastCi && cj === lastCj) return;
  lastCi = ci; lastCj = cj;
  let changed = false;
  for (let i = ci - RAD; i <= ci + RAD; i++) {
    for (let j = cj - RAD; j <= cj + RAD; j++) {
      if (!chunks.has(`${i},${j}`)) { buildChunk(i, j); changed = true; }
    }
  }
  for (const [key, ch] of chunks) {
    if (Math.abs(ch.i - ci) > RAD + 1 || Math.abs(ch.j - cj) > RAD + 1) {
      scene.remove(ch.mesh);
      ch.mesh.geometry.dispose();
      chunks.delete(key);
      changed = true;
    }
  }
  if (changed) rebuildTrees();
}

const water = new THREE.Mesh(
  new THREE.PlaneGeometry(1400, 1400).rotateX(-Math.PI / 2),
  new THREE.MeshLambertMaterial({ color: 0x3f86b8 }),
);
water.position.y = WATER;
scene.add(water);

// ---------------------------------------------------------------------------------------------
// Clouds: soft sprites high above, recycled around the plane.
// ---------------------------------------------------------------------------------------------
function radialTexture(inner, outer, size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner); g.addColorStop(0.55, inner.replace(/[\d.]+\)$/, '0.55)')); g.addColorStop(1, outer);
  x.fillStyle = g;
  x.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const cloudTex = radialTexture('rgba(255,255,255,0.95)', 'rgba(255,255,255,0)');
const clouds = [];
for (let i = 0; i < 26; i++) {
  // fog off (the clouds live beyond the terrain fog); each cloud fades by its own distance instead
  const cloudMat = new THREE.SpriteMaterial({ map: cloudTex, transparent: true, depthWrite: false, fog: false });
  const g = new THREE.Group();
  g.userData.mat = cloudMat;
  const puffs = 4 + Math.floor(Math.random() * 4);
  for (let k = 0; k < puffs; k++) {
    const s = new THREE.Sprite(cloudMat);
    const sz = 9 + Math.random() * 12;
    s.scale.set(sz * 1.5, sz, 1);
    s.position.set((Math.random() - 0.5) * 26, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 14);
    g.add(s);
  }
  clouds.push(g);
  scene.add(g);
}
function placeCloud(g, ahead) {
  const a = ahead ? P.yaw + (Math.random() - 0.5) * 1.8 : Math.random() * Math.PI * 2;
  const r = ahead ? 170 + Math.random() * 70 : 50 + Math.random() * 190;
  g.position.set(P.pos.x - Math.sin(a) * r, 34 + Math.random() * 22, P.pos.z - Math.cos(a) * r);
}

// ---------------------------------------------------------------------------------------------
// The plane (nose toward -Z), ~1 unit wingspan.
// ---------------------------------------------------------------------------------------------
function makePlane() {
  const g = new THREE.Group();
  const red = new THREE.MeshStandardMaterial({ color: 0xd8342c, roughness: 0.45, metalness: 0.1 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.5, metalness: 0.05 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c2b40, roughness: 0.15, metalness: 0.4 });
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m; };

  add(new THREE.CylinderGeometry(0.075, 0.04, 0.78, 14).rotateX(Math.PI / 2), red, 0, 0, 0.02);
  add(new THREE.CylinderGeometry(0.08, 0.077, 0.1, 14).rotateX(Math.PI / 2), white, 0, 0, -0.41);
  add(new THREE.SphereGeometry(0.03, 10, 8), dark, 0, 0, -0.47);                     // spinner
  add(new THREE.SphereGeometry(0.065, 14, 10).scale(1, 0.8, 1.9), dark, 0, 0.065, -0.13); // canopy
  add(new THREE.BoxGeometry(1.0, 0.024, 0.2), white, 0, 0.0, -0.1);                  // wing
  add(new THREE.BoxGeometry(0.16, 0.026, 0.2), red, 0.43, 0.0, -0.1);                // wing tips
  add(new THREE.BoxGeometry(0.16, 0.026, 0.2), red, -0.43, 0.0, -0.1);
  add(new THREE.BoxGeometry(0.38, 0.018, 0.1), white, 0, 0.01, 0.35);                // tailplane
  add(new THREE.BoxGeometry(0.018, 0.17, 0.12), red, 0, 0.09, 0.36);                 // fin
  const disc = add(new THREE.CircleGeometry(0.19, 24),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }),
    0, 0, -0.475);
  disc.renderOrder = 2;
  const blade = add(new THREE.BoxGeometry(0.36, 0.028, 0.008), dark, 0, 0, -0.47);
  g.userData.blade = blade;
  return g;
}
const plane = makePlane();
scene.add(plane);

// soft blob shadow under the plane — a strong depth cue for height above the ground
const shadow = new THREE.Mesh(
  new THREE.PlaneGeometry(1.3, 1.0).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ map: radialTexture('rgba(0,0,0,0.85)', 'rgba(0,0,0,0)', 64), transparent: true,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, fog: true }),
);
scene.add(shadow);

// guide chevron: hovers above the plane and points at the next ring when it's off to the side
const guide = new THREE.Group();
const guideMesh = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.26, 4).rotateX(Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0x63f0ff }));
guide.add(guideMesh);
scene.add(guide);

// ---------------------------------------------------------------------------------------------
// Rings
// ---------------------------------------------------------------------------------------------
const ringGeo = new THREE.TorusGeometry(RING_R, RING_TUBE, 14, 56);
const rings = [];
let courseEnd = null, courseDir = null;

function addRing() {
  courseDir.applyAxisAngle(new THREE.Vector3(0, 1, 0), (Math.random() - 0.5) * 1.1);
  courseEnd.addScaledVector(courseDir, RING_SPACING + Math.random() * 12);
  let ground = -1e9;
  for (let k = -1; k <= 1; k++) ground = Math.max(ground, surfaceHeight(courseEnd.x + courseDir.x * k * 6, courseEnd.z + courseDir.z * k * 6));
  courseEnd.y = ground + 3.6 + Math.random() * 4;
  const mat = new THREE.MeshStandardMaterial({ color: 0xffc43d, emissive: 0xff8f00, emissiveIntensity: 0.4,
    roughness: 0.35, metalness: 0.35, transparent: true });
  const m = new THREE.Mesh(ringGeo, mat);
  m.position.copy(courseEnd);
  m.lookAt(courseEnd.clone().add(courseDir));       // torus axis (+Z) along the course
  m.updateMatrixWorld();
  m.userData = { state: 'live', t: 0, prevZ: null };
  rings.push(m);
  scene.add(m);
}
function resetCourse() {
  for (const r of rings) { scene.remove(r); r.material.dispose(); }
  rings.length = 0;
  courseDir = new THREE.Vector3(-Math.sin(P.yaw), 0, -Math.cos(P.yaw));
  courseEnd = P.pos.clone().addScaledVector(courseDir, -8);
  for (let i = 0; i < RINGS_AHEAD; i++) addRing();
}

// ---------------------------------------------------------------------------------------------
// Game state + HUD
// ---------------------------------------------------------------------------------------------
const P = { pos: new THREE.Vector3(), yaw: 0, pitch: 0, roll: 0, speed: BASE_SPEED };
const prevPos = new THREE.Vector3();
const fwd = new THREE.Vector3();
let score = 0, streak = 0, best = +(localStorage.getItem('skyrings.best') || 0);
let running = false, paused = false, invuln = 0, time = 0;
const keys = { left: false, right: false, up: false, down: false };

const el = (id) => document.getElementById(id);
const vScore = el('vScore'), vStreak = el('vStreak'), vBest = el('vBest'), msgEl = el('msg');
let msgTimer = 0;
function hud() {
  vScore.textContent = score; vStreak.textContent = streak; vBest.textContent = best;
}
function message(text, kind, secs = 1.2) {
  msgEl.textContent = text;
  msgEl.className = `hud ${kind}`;
  msgEl.style.display = 'block';   // display, never opacity: an invisible plate is still "there" to the weave
  msgTimer = secs;
}

function resetPlane() {
  P.pos.set(0, 0, 0);
  P.yaw = 0; P.pitch = 0; P.roll = 0; P.speed = BASE_SPEED;
  P.pos.y = surfaceHeight(0, 0) + 7;
  prevPos.copy(P.pos);
  updateChunks();
  resetCourse();
  for (const c of clouds) placeCloud(c, false);
  snapCamera();
}
function restart() {
  score = 0; streak = 0; hud();
  resetPlane();
  message('Fly through the rings!', 'good', 2);
}

function crash() {
  streak = 0; hud();
  message('Crashed! Streak lost', 'bad', 1.6);
  P.pos.y = surfaceHeight(P.pos.x, P.pos.z) + 7;
  P.pitch = 0.15; P.roll = 0;
  invuln = 1.6;
  prevPos.copy(P.pos);
  for (const r of rings) r.userData.prevZ = null;
}

addEventListener('keydown', (e) => {
  const k = e.key;
  if (k === 'ArrowLeft' || k === 'a' || k === 'A') keys.left = true;
  else if (k === 'ArrowRight' || k === 'd' || k === 'D') keys.right = true;
  else if (k === 'ArrowUp' || k === 'w' || k === 'W') keys.up = true;
  else if (k === 'ArrowDown' || k === 's' || k === 'S') keys.down = true;
  else if (k === 'p' || k === 'P') { paused = !paused; if (paused) message('Paused', 'good', 1e9); else msgEl.style.display = 'none'; }
  else if (k === 'r' || k === 'R') restart();
  else if (k === '[' || k === ']') {
    depthScale = clamp(depthScale + (k === ']' ? 0.1 : -0.1), DEPTH_MIN, DEPTH_MAX);
    message(`3D depth ${Math.round(depthScale * 100)}%`, 'good', 0.9);
  } else return;
  if (k.startsWith('Arrow')) e.preventDefault();
});
addEventListener('keyup', (e) => {
  const k = e.key;
  if (k === 'ArrowLeft' || k === 'a' || k === 'A') keys.left = false;
  else if (k === 'ArrowRight' || k === 'd' || k === 'D') keys.right = false;
  else if (k === 'ArrowUp' || k === 'w' || k === 'W') keys.up = false;
  else if (k === 'ArrowDown' || k === 's' || k === 'S') keys.down = false;
});
addEventListener('blur', () => { keys.left = keys.right = keys.up = keys.down = false; });

// ---------------------------------------------------------------------------------------------
// Per-frame update (shared by the woven and the 2D loop — runs exactly once per frame)
// ---------------------------------------------------------------------------------------------
const camPos = new THREE.Vector3(), camGoal = new THREE.Vector3();
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), lookAt = new THREE.Vector3(), lookDir = new THREE.Vector3();
const ringLocal = new THREE.Vector3();

function chaseTarget(out) {
  // behind along the flat heading, a little above; follow a fraction of the pitch so dives read
  const s = Math.sin(P.yaw), c = Math.cos(P.yaw);
  const back = CHASE_BACK * Math.cos(P.pitch * 0.5);
  return out.set(P.pos.x + s * back, P.pos.y + CHASE_UP - Math.sin(P.pitch * 0.5) * CHASE_BACK * 0.6, P.pos.z + c * back);
}
function snapCamera() { chaseTarget(camPos); placeCamera(); }

function placeCamera() {
  const minY = surfaceHeight(camPos.x, camPos.z) + 0.5;
  if (camPos.y < minY) camPos.y = minY;
  appCam.position.copy(camPos);
  lookDir.set(-Math.sin(P.yaw), Math.sin(P.pitch) * 0.6, -Math.cos(P.yaw));
  lookAt.copy(P.pos).addScaledVector(lookDir, 3);
  lookAt.y += 0.15;
  appCam.lookAt(lookAt);
  appCam.rotateZ(P.roll * 0.28);
  appCam.updateMatrixWorld();
  sky.position.copy(camPos);
}

function update(dt) {
  time += dt;
  const live = running && !paused;
  if (live) {
    const steer = (keys.left ? 1 : 0) - (keys.right ? 1 : 0);
    const climb = (keys.up ? 1 : 0) - (keys.down ? 1 : 0);
    let targetPitch = climb * 0.42;
    const agl = P.pos.y - surfaceHeight(P.pos.x, P.pos.z);
    if (agl > 26) targetPitch = Math.min(targetPitch, -0.25);    // soft ceiling
    P.roll += (steer * 0.8 - P.roll) * damp(dt, 3.5);
    P.pitch += (targetPitch - P.pitch) * damp(dt, 2.6);
    P.yaw += P.roll * 1.2 * dt;
    P.speed += (BASE_SPEED - 5 * Math.sin(P.pitch) - P.speed) * damp(dt, 1.4);

    fwd.set(-Math.sin(P.yaw) * Math.cos(P.pitch), Math.sin(P.pitch), -Math.cos(P.yaw) * Math.cos(P.pitch));
    prevPos.copy(P.pos);
    P.pos.addScaledVector(fwd, P.speed * dt);

    invuln = Math.max(0, invuln - dt);
    if (P.pos.y < surfaceHeight(P.pos.x, P.pos.z) + 0.18) {
      if (invuln > 0) P.pos.y = surfaceHeight(P.pos.x, P.pos.z) + 0.18;
      else crash();
    }
    updateChunks();
  }

  // plane pose + propeller
  plane.position.copy(P.pos);
  plane.rotation.set(P.pitch, P.yaw, P.roll, 'YXZ');
  plane.userData.blade.rotation.z += dt * 55;
  plane.visible = invuln <= 0 || Math.floor(time * 10) % 2 === 0;

  // shadow
  const sh = surfaceHeight(P.pos.x, P.pos.z);
  shadow.position.set(P.pos.x, sh + 0.06, P.pos.z);
  shadow.rotation.y = P.yaw;
  shadow.material.opacity = clamp(0.75 - (P.pos.y - sh) / 16, 0.12, 0.75);
  const sShadow = 1 + (P.pos.y - sh) * 0.04;
  shadow.scale.set(sShadow, 1, sShadow);

  // camera (spring-follow), sky, distant layers
  chaseTarget(camGoal);
  camPos.lerp(camGoal, live ? damp(dt, 5) : 1);
  placeCamera();
  mountains.position.set(P.pos.x, 0, P.pos.z);
  water.position.x = P.pos.x; water.position.z = P.pos.z;
  for (const c of clouds) {
    const d = Math.hypot(c.position.x - P.pos.x, c.position.z - P.pos.z);
    if (d > 265) placeCloud(c, true);
    c.userData.mat.opacity = 0.92 * (1 - smoothstep(190, 260, d));   // fade at the edge instead of popping
  }

  // rings: crossing test against each ring's plane (local z sign change), fade, collect anims
  let next = null;
  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i], u = r.userData;
    if (u.state === 'live') {
      if (live) {
        ringLocal.copy(P.pos);
        r.worldToLocal(ringLocal);
        if (u.prevZ !== null && u.prevZ < 0 && ringLocal.z >= 0 && Math.abs(ringLocal.z) < 3) {
          if (Math.hypot(ringLocal.x, ringLocal.y) < RING_R - RING_TUBE * 0.5) {
            u.state = 'collected'; u.t = 0;
            score++; streak++;
            if (score > best) { best = score; localStorage.setItem('skyrings.best', String(best)); }
            hud();
            message(streak >= 3 ? `+1 · streak ${streak}!` : '+1', 'good', 0.8);
          } else if (Math.hypot(ringLocal.x, ringLocal.y) < RING_R * 4) {
            u.state = 'missed'; u.t = 0;
            streak = 0; hud();
            message('Missed!', 'bad', 0.9);
          }
        }
        u.prevZ = ringLocal.z;
      }
    } else {
      u.t += dt;
      const k = u.t / (u.state === 'collected' ? 0.45 : 0.35);
      if (u.state === 'collected') r.scale.setScalar(1 + k * 0.7);
      else r.material.color.setHex(0xff5a4a);
      if (k >= 1) { scene.remove(r); r.material.dispose(); rings.splice(i, 1); addRing(); continue; }
    }
  }
  // the oldest live ring is "next"; if we wandered far from it, lay a fresh course ahead
  for (const r of rings) if (r.userData.state === 'live') { next = r; break; }
  if (live && next && next.position.distanceTo(P.pos) > 170) { resetCourse(); next = rings[0]; }

  for (const r of rings) {
    const u = r.userData, m = r.material;
    // COMFORT: a ring sweeping past the chase camera would leap far out of the glass and get cut by
    // the window edge. Fade rings out as they come within a few units of the camera.
    const dc = r.position.distanceTo(camPos);
    let op = smoothstep(1.4, 4.2, dc);
    if (u.state === 'collected') op *= 1 - clamp(u.t / 0.45, 0, 1);
    if (u.state === 'missed') op *= 1 - clamp(u.t / 0.35, 0, 1);
    m.opacity = op;
    m.visible = op > 0.01;
    m.depthWrite = op > 0.95;
    m.emissiveIntensity = r === next ? 0.75 + 0.35 * Math.sin(time * 6) : 0.28;
  }

  // guide chevron toward the next ring, only when it's well off the nose
  guide.visible = false;
  if (next && running) {
    tmpV.copy(next.position).sub(P.pos);
    const ang = tmpV.angleTo(fwd.set(-Math.sin(P.yaw) * Math.cos(P.pitch), Math.sin(P.pitch), -Math.cos(P.yaw) * Math.cos(P.pitch)));
    if (ang > 0.5) {
      guide.visible = true;
      guide.position.copy(P.pos).add(tmpV2.set(0, 0.42, 0)).addScaledVector(fwd, 0.25);
      guide.lookAt(next.position);
    }
  }

  if (msgTimer > 0) { msgTimer -= dt; if (msgTimer <= 0) msgEl.style.display = 'none'; }
}

// ---------------------------------------------------------------------------------------------
// Backing store. In BOTH modes the buffer is the canvas box in device px (dpr ≤ 2): flat, that is
// the picture; woven, it is the side-by-side pair, half the width per eye — "no wider than the
// panel", which is what a lenticular resolves per eye anyway and avoids the full-window stutter
// (porting pitfall 26). Clamped to the GL limits so getViewport()'s split matches the real buffer.
// ---------------------------------------------------------------------------------------------
function sizeBuffer() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = canvas.clientWidth || innerWidth, cssH = canvas.clientHeight || innerHeight;
  let w = Math.round(cssW * dpr), h = Math.round(cssH * dpr);
  const s = Math.min(1, MAX_DIM / w, MAX_DIM / h);
  w = Math.floor(w * s); h = Math.floor(h * s);
  if (w % 2) w -= 1;                       // an even width splits into two equal eyes
  appCam.aspect = cssW / cssH;             // the picture's aspect is the CSS box's, in both modes
  appCam.updateProjectionMatrix();
  if (canvas.width === w && canvas.height === h) return false;   // setSize clears even on a no-op
  renderer.setSize(w, h, false);
  return true;
}

// ---------------------------------------------------------------------------------------------
// 2D loop (any browser; also the fallback if the 3D layer is lost)
// ---------------------------------------------------------------------------------------------
let mode = 'mono';            // 'mono' | 'woven'
let lastT = performance.now();
function frameDt() {
  const now = performance.now();
  const dt = Math.min(0.05, Math.max(0, (now - lastT) / 1000));
  lastT = now;
  return dt;
}
function drawMono() {
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, canvas.width, canvas.height);
  renderer.clear();
  renderer.render(scene, appCam);
}
function monoTick() {
  if (mode !== 'mono') return;          // the session's frames drive the woven path
  requestAnimationFrame(monoTick);
  update(frameDt());
  drawMono();
}
addEventListener('resize', () => { if (mode === 'mono' && sizeBuffer()) drawMono(); });

// ---------------------------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------------------------
const statusEl = el('status');
const coverEl = el('cover');
function setStatus(on, html) { statusEl.className = `hud ${on ? 'on' : 'off'}`; statusEl.innerHTML = html; }
function startGame() {
  coverEl.style.display = 'none';       // hard cut, never a fade
  running = true;
  restart();
}

resetPlane();
hud();
sizeBuffer();
requestAnimationFrame(monoTick);

(async () => {
  let sdk = null, sdk3 = null;
  if (!FORCE_2D) {
    // Imported dynamically inside try/catch (porting pitfall 25): a missing/moved SDK degrades the
    // page to its 2D path instead of failing the whole module graph.
    try {
      [sdk, sdk3] = await Promise.all([import('@displayxr/inline3d'), import('@displayxr/inline3d/three')]);
    } catch (err) {
      console.warn('[sky-rings] SDK unavailable, staying 2D:', err);
    }
  }
  let wall = null;
  if (sdk) {
    try { wall = await sdk.createInline3D({ lazy: false, autoChrome: false }); } catch (err) { console.warn(err); }
  }
  if (!wall || !wall.supported) {
    setStatus(false, '<b>2D mode</b> — open in the DisplayXR Browser on a 3D display for glasses-free depth');
    startGame();
    return;
  }
  try {
    await startWoven(sdk, sdk3, wall);
  } catch (err) {
    console.warn('[sky-rings] could not start the 3D window, staying 2D:', err);
    mode = 'mono';
    sizeBuffer();
    requestAnimationFrame(monoTick);
    setStatus(false, '<b>2D mode</b> — 3D window failed to start');
    startGame();
  }
})();

async function startWoven(sdk, sdk3, wall) {
  const { EyeCamera, cameraRigFromCamera } = sdk3;
  const RIG_OK = sdk.inline3dViewRigSupported();
  el('coverText').textContent = 'Opening the 3D window…';

  // HUD plates: partial rects over the canvas. Required on browsers without draw-order occlusion,
  // accepted and ignored on browsers with it — so unconditional.
  for (const id of ['score', 'status', 'help', 'msg']) wall.addGlobalOverlay(el(id));

  // Depth range of the runtime's projection = our camera's clip planes.
  try { wall.session.updateRenderState({ depthNear: NEAR, depthFar: FAR }); } catch (err) { console.warn(err); }

  // Eye cameras. Attach pattern: parented under the app camera, set with setLocalFromView, rig sent
  // with an identity pose — the scene graph supplies THIS frame's camera pose (no one-frame lag).
  // On a browser without setViewRig the runtime keeps its default display rig; then we hang the eyes
  // off an anchor at the convergence distance in front of the camera, so the "glass" lands on the
  // plane, framed by a virtual display as tall as the camera's view at that distance.
  const eyes = [new EyeCamera(THREE), new EyeCamera(THREE)];
  const screenAnchor = new THREE.Object3D();
  appCam.add(screenAnchor);
  const eyeParent = RIG_OK ? appCam : screenAnchor;
  for (const e of eyes) {
    eyeParent.add(e.camera);
    e.camera.near = NEAR; e.camera.far = FAR;     // scalars only — never updateProjectionMatrix() on an eye
  }

  const rig = {};
  const convergence = () => appCam.position.distanceTo(P.pos) * CONV_FACTOR;
  const currentRig = () => cameraRigFromCamera(THREE, appCam, {
    convergence: convergence(), attach: true, ipdFactor: depthScale, out: rig,
  });

  const good = [0, 1].map(() => ({ proj: new Float32Array(16), pose: new Float32Array(16), x: 0, y: 0, width: 0, height: 0 }));
  let haveGood = false;
  let handle = null;

  function replayLastGood() {
    renderer.setScissorTest(false);
    renderer.clear();
    if (!haveGood) return;               // still PRESENT a frame (sky-coloured), never skip one
    renderer.setScissorTest(true);
    for (let i = 0; i < 2; i++) {
      const g = good[i];
      renderer.setViewport(g.x, g.y, g.width, g.height);
      renderer.setScissor(g.x, g.y, g.width, g.height);
      eyes[i].setLocalFromMatrices(g.proj, g.pose);
      renderer.render(scene, eyes[i].camera);
    }
    renderer.setScissorTest(false);
  }

  function onFrame(views, layer) {
    update(frameDt());
    if (!RIG_OK) screenAnchor.position.set(0, 0, -convergence());
    // Pushed BEFORE the validity gate: a rig drives the NEXT locate, so even a frame that cannot
    // draw must advance it.
    if (handle && RIG_OK) handle.setViewRig(currentRig());

    // Validate everything before clear(): a short view list (load fallback) or a null viewport must
    // not produce a dark frame — replay the last good one instead.
    if (!views || views.length < 2 || !layer) return replayLastGood();
    const vps = [layer.getViewport(views[0]), layer.getViewport(views[1])];
    if (vps.some((vp) => !vp || vp.width <= 0 || vp.height <= 0)) return replayLastGood();

    renderer.setScissorTest(false);
    renderer.clear();
    renderer.setScissorTest(true);
    for (let i = 0; i < 2; i++) {
      const vp = vps[i], g = good[i];
      renderer.setViewport(vp.x, vp.y, vp.width, vp.height);
      renderer.setScissor(vp.x, vp.y, vp.width, vp.height);
      eyes[i].setLocalFromView(views[i]);
      renderer.render(scene, eyes[i].camera);
      // copies, never the XRView (valid only inside this callback)
      g.proj.set(views[i].projectionMatrix); g.pose.set(views[i].transform.matrix);
      g.x = vp.x; g.y = vp.y; g.width = vp.width; g.height = vp.height;
    }
    renderer.setScissorTest(false);
    haveGood = true;
  }

  // Commit a settled canvas before registering it (woven-canvas rule 4): final CSS box and
  // will-change are in the stylesheet, the backing store is sized; wait two frames.
  sizeBuffer();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  const vdh = 2 * convergence() * Math.tan(THREE.MathUtils.degToRad(FOV) / 2);
  handle = wall.addScene(canvas, onFrame, {
    // The FIRST rig goes in at construction so the very first located frame is already ours.
    // Without rig support, name the fallback display-rig framing instead (not both: they share a slot).
    ...(RIG_OK ? { viewRig: currentRig() } : { virtualDisplayHeight: vdh }),
    rectCover: 'auto',                           // cover window resizes until rewoven
    onResize: () => { if (sizeBuffer()) replayLastGood(); },
    onLayerLost: () => {
      // the pair is no longer being woven: go flat, on our own loop
      mode = 'mono';
      for (const e of eyes) e.camera.parent && e.camera.parent.remove(e.camera);
      sizeBuffer();
      lastT = performance.now();
      requestAnimationFrame(monoTick);
      setStatus(false, '<b>2D mode</b> — the 3D window closed');
    },
  });
  mode = 'woven';                                // only now stop the 2D loop (activation succeeded)
  el('depthHelp').style.display = '';
  setStatus(true, RIG_OK
    ? '<b>Glasses-free 3D</b> · camera rig'
    : '<b>Glasses-free 3D</b> · display rig (this browser has no camera rigs)');

  // Keep the cover up until the browser has really joined the canvas to the weave.
  const res = await handle.firstWoven;
  if (!res.woven) console.info('[sky-rings] firstWoven:', res);
  startGame();
}
