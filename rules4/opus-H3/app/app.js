// Skyhopper — a small three.js flight game, woven to glasses-free 3D by the DisplayXR inline-3D SDK
// and a plain 2D game everywhere else.
//
// Stereo setup (see NOTES.md for the why):
//   * CAMERA rig — the player moves through a world, so the app camera is the viewpoint.
//   * Attach pattern — identity-posed rig, eye cameras parented under the chase camera, so the
//     stereo never trails the camera by a frame.
//   * Convergence FIXED at the chase distance: the plane sits on the glass, the world recedes.
//   * metersToVirtual = comfort · d / 0.5 (the SDK's own controls:'page' game rig), so the depth
//     budget does not depend on how big the world is in units.

import * as THREE from 'three';

// ---------------------------------------------------------------------------------------------
// DOM
const canvas = document.getElementById('stage');
const coverEl = document.getElementById('cover');
const scoreValueEl = document.getElementById('scoreValue');
const scoreSubEl = document.getElementById('scoreSub');
const navArrowEl = document.getElementById('navArrow');
const navDistEl = document.getElementById('navDist');
const navVertEl = document.getElementById('navVert');
const modeEl = document.getElementById('mode');
const modeTextEl = document.getElementById('modeText');
const depthHelpEl = document.getElementById('depthHelp');
const toastEl = document.getElementById('toast');
const hintEl = document.getElementById('hint');
const pausedEl = document.getElementById('paused');
const HUD_ELEMENTS = ['score', 'nav', 'mode', 'help', 'toast', 'hint', 'paused'].map((id) => document.getElementById(id));

// ---------------------------------------------------------------------------------------------
// Tunables
const FOV = 60;               // vertical, degrees
const NEAR = 0.5, FAR = 7000; // world units (≈ metres)
const SPEED = 36;             // units / s
const CHASE_BACK = 13, CHASE_UP = 3.6, LOOK_AHEAD = 10, LOOK_UP = 1.2;
const MIN_CLEARANCE = 5, CEILING = 150, WATER_Y = 0;
const RING_R = 6.5, RING_TUBE = 0.45, RINGS_AHEAD = 6;
const CHUNK = 200, SEG = 40, CHUNK_RANGE = 5;

// Comfort: the runtime's ipd × metersToVirtual × diopters × 0.5. With m2v = comfort·d/0.5 it equals
// `comfort` by construction; 0.3 is the SDK's default for a page-owned game camera. Adjustable with
// −/= in 3D, clamped to a range that stays well short of divergence.
let comfort = 0.3;
const COMFORT_MIN = 0.1, COMFORT_MAX = 0.5;

// Colours (sRGB hex). The sky's horizon IS the fog colour, so distant terrain melts into it.
const HORIZON = 0xcfe0ec, ZENITH = 0x3f7fc4, SUN_TINT = 0xfff1d6;
const SUN_DIR = new THREE.Vector3(0.45, 0.62, 0.35).normalize();

// ---------------------------------------------------------------------------------------------
// Noise (2D simplex, seeded)
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeNoise2D(seed) {
  const rand = mulberry32(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const GX = [1, -1, 1, -1, 1, -1, 0, 0], GY = [1, 1, -1, -1, 0, 0, 1, -1];
  const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
  return function (xin, yin) {
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s), j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t), y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    let n = 0, tt, g;
    tt = 0.5 - x0 * x0 - y0 * y0;
    if (tt > 0) { tt *= tt; g = perm[ii + perm[jj]] & 7; n += tt * tt * (GX[g] * x0 + GY[g] * y0); }
    tt = 0.5 - x1 * x1 - y1 * y1;
    if (tt > 0) { tt *= tt; g = perm[ii + i1 + perm[jj + j1]] & 7; n += tt * tt * (GX[g] * x1 + GY[g] * y1); }
    tt = 0.5 - x2 * x2 - y2 * y2;
    if (tt > 0) { tt *= tt; g = perm[ii + 1 + perm[jj + 1]] & 7; n += tt * tt * (GX[g] * x2 + GY[g] * y2); }
    return 70 * n;
  };
}
const SEED = 1337;
const noiseA = makeNoise2D(SEED), noiseB = makeNoise2D(SEED + 1), noiseC = makeNoise2D(SEED + 2), noiseM = makeNoise2D(SEED + 3);

// Rolling hills: smooth fbm (no high-frequency detail — sharp texture far from the glass is what
// doubles first on a lenticular panel) on top of a broad swell that makes valleys and lakes.
function heightAt(x, z) {
  let a = 0, amp = 1, f = 0.0021, norm = 0;
  for (let o = 0; o < 4; o++) { a += amp * noiseA(x * f, z * f); norm += amp; amp *= 0.5; f *= 2.03; }
  return (a / norm) * 48 + noiseB(x * 0.00045, z * 0.00045) * 26 + 9;
}
function groundAt(x, z) { return Math.max(heightAt(x, z), WATER_Y); }

// ---------------------------------------------------------------------------------------------
// Renderer, scene, camera
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
// pixelRatio MUST stay 1: layer.getViewport() reports backing-store pixels, and three multiplies
// setViewport/setScissor by the pixel ratio. We size the backing store ourselves.
renderer.setPixelRatio(1);
renderer.autoClear = false;
renderer.setClearColor(HORIZON);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(HORIZON, 260, 1150);

scene.add(new THREE.HemisphereLight(0xdfeeff, 0x5a6b3c, 1.15));
const sun = new THREE.DirectionalLight(SUN_TINT, 2.1);
sun.position.copy(SUN_DIR).multiplyScalar(100);
scene.add(sun);

// The app's own chase camera. IN the scene: the eye cameras hang off it (attach pattern), and three
// only reaches a parented camera through a scene traversal.
const appCam = new THREE.PerspectiveCamera(FOV, 16 / 9, NEAR, FAR);
scene.add(appCam);

// ---------------------------------------------------------------------------------------------
// Sky dome — a soft gradient with a soft sun glow (no hard sun disk: a tiny bright point at
// background depth is exactly the high-contrast far detail that ghosts).
function srgbVec(hex) { return new THREE.Vector3(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255); }
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(5500, 32, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { horizon: { value: srgbVec(HORIZON) }, zenith: { value: srgbVec(ZENITH) },
                sunDir: { value: SUN_DIR.clone() }, sunCol: { value: srgbVec(SUN_TINT) } },
    vertexShader: `varying vec3 vDir;
      void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    // Uniforms are sRGB and written as-is, so the horizon matches the fog colour pixel for pixel.
    fragmentShader: `uniform vec3 horizon; uniform vec3 zenith; uniform vec3 sunDir; uniform vec3 sunCol;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = max(d.y, 0.0);
        vec3 c = mix(horizon, zenith, pow(h, 0.6));
        float s = max(dot(d, sunDir), 0.0);
        c += sunCol * (pow(s, 90.0) * 0.35 + pow(s, 6.0) * 0.12);
        gl_FragColor = vec4(min(c, vec3(1.0)), 1.0);
      }`,
  }),
);
sky.renderOrder = -10;
scene.add(sky);

// ---------------------------------------------------------------------------------------------
// Distant mountains: two rings of ridges that travel with the player (always on the horizon).
// Shading and haze are baked into vertex colours (MeshBasic, no fog) so their contrast stays low —
// they sit at the back of the depth budget, where contrast costs the most.
function buildRange({ radius, depth, hMin, hMax, freq, seedOff, rock, snowLine, haze }) {
  const N = 300, ROWS = 4;
  const pos = new Float32Array(N * ROWS * 3);
  const rowR = [radius - depth, radius - depth * 0.45, radius, radius + depth * 0.6];
  for (let i = 0; i < N; i++) {
    const th = (i / N) * Math.PI * 2, c = Math.cos(th), s = Math.sin(th);
    let n = 0, amp = 1, f = freq, norm = 0;
    for (let o = 0; o < 4; o++) { n += amp * noiseM(c * f + seedOff, s * f - seedOff); norm += amp; amp *= 0.5; f *= 2.1; }
    n = n / norm * 0.5 + 0.5;
    const H = hMin + (hMax - hMin) * Math.pow(Math.max(0, n), 1.4);
    const rowY = [-80, H * (0.45 + 0.15 * noiseM(c * 7 + seedOff, s * 7)), H, -80];
    for (let r = 0; r < ROWS; r++) {
      const k = (i * ROWS + r) * 3;
      pos[k] = c * rowR[r]; pos[k + 1] = rowY[r]; pos[k + 2] = s * rowR[r];
    }
  }
  const idx = [];
  for (let i = 0; i < N; i++) {
    const i2 = (i + 1) % N;
    for (let r = 0; r < ROWS - 1; r++) {
      const a = i * ROWS + r, b = i * ROWS + r + 1, c = i2 * ROWS + r, d = i2 * ROWS + r + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // Lighting uses |n·sun|, so the winding direction doesn't matter (the material is double-sided).
  const nor = geo.getAttribute('normal');
  const col = new Float32Array(pos.length);
  const rockC = new THREE.Color(rock), snowC = new THREE.Color(0xf4f6fa), hazeC = new THREE.Color(HORIZON), tmp = new THREE.Color();
  const sunV = SUN_DIR;
  for (let v = 0; v < N * ROWS; v++) {
    const y = pos[v * 3 + 1];
    const lit = 0.62 + 0.38 * Math.max(0, Math.abs(nor.getX(v) * sunV.x + nor.getY(v) * sunV.y + nor.getZ(v) * sunV.z));
    tmp.copy(y > snowLine ? snowC : rockC).multiplyScalar(lit);
    // More haze toward the foot: the base dissolves into the horizon colour.
    const footHaze = THREE.MathUtils.clamp(1 - (y + 20) / (snowLine * 0.9), 0, 1);
    tmp.lerp(hazeC, Math.min(1, haze + (1 - haze) * footHaze * 0.85));
    col[v * 3] = tmp.r; col[v * 3 + 1] = tmp.g; col[v * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide }));
}
const mountains = new THREE.Group();
mountains.add(buildRange({ radius: 3700, depth: 700, hMin: 380, hMax: 1050, freq: 2.3, seedOff: 11.7, rock: 0x7f8fa6, snowLine: 640, haze: 0.62 }));
mountains.add(buildRange({ radius: 2350, depth: 520, hMin: 140, hMax: 520, freq: 3.1, seedOff: -4.2, rock: 0x5f7a6a, snowLine: 9999, haze: 0.48 }));
mountains.children.forEach((m, i) => { m.renderOrder = -5 + i; });
scene.add(mountains);

// ---------------------------------------------------------------------------------------------
// Water — one big plane at sea level that travels with the player; lakes appear wherever the
// hills dip below it. Fogged, so it reads as the horizon far out.
const water = new THREE.Mesh(
  new THREE.PlaneGeometry(9000, 9000).rotateX(-Math.PI / 2),
  new THREE.MeshPhongMaterial({ color: 0x4f8fb8, specular: 0x334455, shininess: 40 }),
);
water.position.y = WATER_Y;
scene.add(water);

// ---------------------------------------------------------------------------------------------
// Terrain chunks + trees, generated around the player on demand.
const terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true });
const treeGeo = new THREE.ConeGeometry(2.3, 8.5, 7).translate(0, 4.25, 0);
const treeMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
const C_SAND = new THREE.Color(0xd9c893), C_GRASS = new THREE.Color(0x77ad4c), C_GRASS2 = new THREE.Color(0x5c9440),
  C_FOREST = new THREE.Color(0x4f7d3a), C_ROCK = new THREE.Color(0x8f8a78), C_TREE = new THREE.Color(0x2f6334);

const chunks = new Map();
let chunkQueue = [];
let centerKey = '';

function buildChunk(ci, cj) {
  const ox = ci * CHUNK, oz = cj * CHUNK, n = SEG + 1, step = CHUNK / SEG;
  const pos = new Float32Array(n * n * 3), nor = new Float32Array(n * n * 3), col = new Float32Array(n * n * 3);
  const c = new THREE.Color();
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = ox + i * step, z = oz + j * step, h = heightAt(x, z), k = (j * n + i) * 3;
      pos[k] = i * step; pos[k + 1] = h; pos[k + 2] = j * step;
      // Analytic-ish normal from the height field, so chunk seams shade identically.
      const hx = (heightAt(x + 1.5, z) - heightAt(x - 1.5, z)) / 3, hz = (heightAt(x, z + 1.5) - heightAt(x, z - 1.5)) / 3;
      const il = 1 / Math.hypot(hx, 1, hz);
      nor[k] = -hx * il; nor[k + 1] = il; nor[k + 2] = -hz * il;
      const tint = noiseC(x * 0.01, z * 0.01) * 0.5 + 0.5;
      if (h < 1.8) c.copy(C_SAND);
      else if (h < 6) c.copy(C_SAND).lerp(C_GRASS, (h - 1.8) / 4.2);
      else if (h < 30) c.copy(C_GRASS).lerp(C_GRASS2, tint).lerp(C_FOREST, THREE.MathUtils.smoothstep(h, 14, 30) * 0.6);
      else c.copy(C_FOREST).lerp(C_ROCK, THREE.MathUtils.smoothstep(h, 34, 55));
      const slope = 1 - il; // 0 flat .. 1 vertical
      if (slope > 0.12) c.lerp(C_ROCK, THREE.MathUtils.smoothstep(slope, 0.12, 0.35) * 0.7);
      col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b;
    }
  }
  const idx = new Uint16Array(SEG * SEG * 6);
  let q = 0;
  for (let j = 0; j < SEG; j++) for (let i = 0; i < SEG; i++) {
    const a = j * n + i, b = a + 1, cc = a + n, d = cc + 1;
    idx[q++] = a; idx[q++] = cc; idx[q++] = b; idx[q++] = b; idx[q++] = cc; idx[q++] = d;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingSphere();
  const group = new THREE.Group();
  group.position.set(ox, 0, oz);
  group.add(new THREE.Mesh(geo, terrainMat));

  // Trees: clustered by a low-frequency "forest" mask, only on gentle dry slopes.
  const rand = mulberry32((ci * 73856093) ^ (cj * 19349663) ^ SEED);
  const m = new THREE.Matrix4(), qt = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const placed = [];
  for (let t = 0; t < 70; t++) {
    const lx = rand() * CHUNK, lz = rand() * CHUNK, x = ox + lx, z = oz + lz, h = heightAt(x, z);
    if (h < 3 || h > 40) continue;
    if (noiseC(x * 0.004 + 40, z * 0.004) < -0.05) continue;
    const hx = heightAt(x + 2, z) - heightAt(x - 2, z), hz = heightAt(x, z + 2) - heightAt(x, z - 2);
    if (Math.hypot(hx, hz) / 4 > 0.45) continue;
    const s = 0.75 + rand() * 0.7;
    m.compose(p.set(lx, h - 0.8, lz), qt.setFromAxisAngle(up, rand() * 6.28), sc.set(s, s * (0.85 + rand() * 0.5), s));
    placed.push(m.clone(), 0.75 + rand() * 0.35);
  }
  if (placed.length) {
    const count = placed.length / 2;
    const trees = new THREE.InstancedMesh(treeGeo, treeMat, count);
    const tc = new THREE.Color();
    for (let i = 0; i < count; i++) {
      trees.setMatrixAt(i, placed[i * 2]);
      trees.setColorAt(i, tc.copy(C_TREE).multiplyScalar(placed[i * 2 + 1]));
    }
    trees.computeBoundingSphere();
    group.add(trees);
  }
  return group;
}

function disposeChunk(group) {
  scene.remove(group);
  for (const child of group.children) {
    if (child.isInstancedMesh) child.dispose();
    else child.geometry.dispose();
  }
}

function updateChunks(px, pz, budget) {
  const ci = Math.floor(px / CHUNK), cj = Math.floor(pz / CHUNK), key = ci + ',' + cj;
  if (key !== centerKey) {
    centerKey = key;
    const want = [];
    for (let dj = -CHUNK_RANGE; dj <= CHUNK_RANGE; dj++) for (let di = -CHUNK_RANGE; di <= CHUNK_RANGE; di++) {
      if (di * di + dj * dj > (CHUNK_RANGE + 0.5) ** 2) continue;
      const k = (ci + di) + ',' + (cj + dj);
      if (!chunks.has(k)) want.push({ i: ci + di, j: cj + dj, k, d: di * di + dj * dj });
    }
    want.sort((a, b) => a.d - b.d);
    chunkQueue = want;
    for (const [k, g] of chunks) {
      const [i, j] = k.split(',').map(Number);
      if ((i - ci) ** 2 + (j - cj) ** 2 > (CHUNK_RANGE + 1.5) ** 2) { disposeChunk(g); chunks.delete(k); }
    }
  }
  while (budget-- > 0 && chunkQueue.length) {
    const c = chunkQueue.shift();
    if (chunks.has(c.k)) continue;
    const g = buildChunk(c.i, c.j);
    chunks.set(c.k, g);
    scene.add(g);
  }
}

// ---------------------------------------------------------------------------------------------
// Clouds — soft sprites well above the flight ceiling (the camera never flies through one).
function cloudTexture() {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 128;
  const g = cv.getContext('2d');
  const rand = mulberry32(7);
  for (let i = 0; i < 14; i++) {
    const x = 50 + rand() * 156, y = 58 + (rand() - 0.5) * 30, r = 22 + rand() * 30;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,255,0.55)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const cloudMat = new THREE.SpriteMaterial({ map: cloudTexture(), transparent: true, depthWrite: false, opacity: 0.9, fog: false });
const clouds = [];
const cloudRand = mulberry32(99);
function placeCloud(sp, cx, cz, aheadX, aheadZ, far) {
  const ang = cloudRand() * Math.PI * 2, dist = far ? 1700 + cloudRand() * 900 : 150 + cloudRand() * 2300;
  let x = cx + Math.cos(ang) * dist, z = cz + Math.sin(ang) * dist;
  if (far) { x = cx + aheadX * dist + (cloudRand() - 0.5) * 2600; z = cz + aheadZ * dist + (cloudRand() - 0.5) * 2600; }
  sp.position.set(x, 200 + cloudRand() * 90, z);
  const s = 260 + cloudRand() * 320;
  sp.scale.set(s, s * 0.45, 1);
}
for (let i = 0; i < 34; i++) {
  const sp = new THREE.Sprite(cloudMat);
  placeCloud(sp, 0, 0, 0, -1, false);
  clouds.push(sp);
  scene.add(sp);
}

// ---------------------------------------------------------------------------------------------
// The plane (local forward = −Z).
function buildPlane() {
  const g = new THREE.Group();
  const red = new THREE.MeshLambertMaterial({ color: 0xd84a3c });
  const cream = new THREE.MeshLambertMaterial({ color: 0xf2e6c8 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x3c4553 });
  const glass = new THREE.MeshLambertMaterial({ color: 0x86b9da, emissive: 0x1b2c3c });
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m; };
  add(new THREE.CylinderGeometry(0.3, 0.58, 4.6, 14).rotateX(Math.PI / 2), red, 0, 0, 0.3);
  add(new THREE.CylinderGeometry(0.58, 0.6, 0.5, 14).rotateX(Math.PI / 2), cream, 0, 0, -2.15);
  add(new THREE.ConeGeometry(0.24, 0.55, 12).rotateX(-Math.PI / 2), dark, 0, 0, -2.65);
  add(new THREE.SphereGeometry(0.44, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.85, 1.9), glass, 0, 0.38, -0.4);
  add(new THREE.BoxGeometry(7.2, 0.14, 1.35), cream, 0, -0.18, -0.5);
  add(new THREE.BoxGeometry(0.9, 0.16, 1.37), red, 3.15, -0.18, -0.5);
  add(new THREE.BoxGeometry(0.9, 0.16, 1.37), red, -3.15, -0.18, -0.5);
  add(new THREE.BoxGeometry(2.7, 0.1, 0.75), cream, 0, 0.08, 2.3);
  add(new THREE.BoxGeometry(0.1, 1.05, 0.85), red, 0, 0.6, 2.3);
  const disc = add(new THREE.CircleGeometry(1.35, 36), new THREE.MeshBasicMaterial({
    color: 0xdfe4ea, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }), 0, 0, -2.5);
  disc.renderOrder = 2;
  const blade = add(new THREE.BoxGeometry(0.14, 2.6, 0.05), dark, 0, 0, -2.46);
  g.userData.blade = blade;
  return g;
}
const plane = buildPlane();
scene.add(plane);

// ---------------------------------------------------------------------------------------------
// Game state
const S = {
  pos: new THREE.Vector3(), prevPos: new THREE.Vector3(),
  yaw: 0, pitch: 0, roll: 0,
  score: 0, streak: 0, best: Number(localStorage.getItem('skyhopper.bestStreak') || 0),
  paused: false, lowWarnT: 0,
};
const keys = { left: false, right: false, up: false, down: false };
const FWD = new THREE.Vector3(), HFWD = new THREE.Vector3(), RIGHT = new THREE.Vector3();
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), lookTarget = new THREE.Vector3(), camGoal = new THREE.Vector3();
const euler = new THREE.Euler(0, 0, 0, 'YXZ');

function resetPlayer() {
  S.pos.set(0, Math.max(groundAt(0, 0), 10) + 30, 0);
  S.prevPos.copy(S.pos);
  S.yaw = 0; S.pitch = 0; S.roll = 0;
  updateDirs();
  appCam.position.copy(S.pos).addScaledVector(HFWD, -CHASE_BACK).add(tmpV.set(0, CHASE_UP, 0));
}
function updateDirs() {
  const cy = Math.cos(S.yaw), sy = Math.sin(S.yaw), cp = Math.cos(S.pitch), sp = Math.sin(S.pitch);
  FWD.set(-sy * cp, sp, -cy * cp);
  HFWD.set(-sy, 0, -cy);
  RIGHT.set(cy, 0, -sy);
}

// Convergence: the depth of the plane along the chase camera's axis at rest — the plane sits ON the
// glass. A constant (rule: fixed convergence in worlds), never re-measured from the live camera.
const CONVERGENCE = (() => {
  const cam = new THREE.Vector3(0, CHASE_UP, CHASE_BACK), look = new THREE.Vector3(0, LOOK_UP, -LOOK_AHEAD);
  const axis = look.clone().sub(cam).normalize();
  return new THREE.Vector3().sub(cam).dot(axis);
})();

// ---------------------------------------------------------------------------------------------
// Rings
const ringGeo = new THREE.TorusGeometry(RING_R, RING_TUBE, 14, 56);
const rings = [];
const pathPos = new THREE.Vector3(), pathDir = new THREE.Vector3();
const ringRand = mulberry32(2024);

function resetPath() {
  for (const r of rings) if (r.state === 'active') { r.state = 'gone'; r.t = 0; }
  pathPos.copy(S.pos);
  pathDir.copy(HFWD);
  pathPos.addScaledVector(pathDir, 40);
}
function placeRing() {
  const turn = (ringRand() - 0.5) * 0.9;
  pathDir.applyAxisAngle(tmpV.set(0, 1, 0), turn).normalize();
  const prev = pathPos.clone();
  pathPos.addScaledVector(pathDir, 150 + ringRand() * 60);
  const y = THREE.MathUtils.clamp(groundAt(pathPos.x, pathPos.z) + 14 + ringRand() * 20, WATER_Y + 16, CEILING - 15);
  pathPos.y = y;
  const normal = pathPos.clone().sub(prev);
  normal.y *= 0.5;
  normal.normalize();
  const mat = new THREE.MeshLambertMaterial({ color: 0xffc23a, emissive: 0x5a3a00, transparent: true, opacity: 1 });
  const mesh = new THREE.Mesh(ringGeo, mat);
  mesh.position.copy(pathPos);
  mesh.lookAt(tmpV.copy(pathPos).add(normal));
  scene.add(mesh);
  rings.push({ mesh, mat, pos: pathPos.clone(), normal, state: 'active', t: 0, prevSide: null });
}
function nextRing() { return rings.find((r) => r.state === 'active') || null; }

function updateRings(dt, time) {
  // Through-the-ring test: a crossing of the ring's plane, inside its radius.
  for (const r of rings) {
    if (r.state !== 'active') continue;
    const side = tmpV.copy(S.pos).sub(r.pos).dot(r.normal);
    if (r.prevSide !== null && r.prevSide < 0 && side >= 0) {
      const prevSide = tmpV2.copy(S.prevPos).sub(r.pos).dot(r.normal);
      const f = prevSide / (prevSide - side);
      const cross = tmpV2.copy(S.prevPos).lerp(S.pos, f).sub(r.pos);
      const lateral = cross.addScaledVector(r.normal, -cross.dot(r.normal)).length();
      if (lateral < RING_R - 0.6) onRingHit(r);
      else if (lateral < RING_R * 4) onRingMiss(r, true);
    }
    r.prevSide = side;
    // Left behind (turned away): counts as a miss once well past it.
    const toRing = tmpV.copy(r.pos).sub(S.pos);
    if (r.state === 'active' && toRing.dot(HFWD) < -60 && toRing.length() > 90) onRingMiss(r, false);
  }
  // Too far from the course: start a fresh course in front of the player.
  const nr = nextRing();
  if (!nr || nr.pos.distanceTo(S.pos) > 750) resetPath();
  while (rings.filter((r) => r.state === 'active').length < RINGS_AHEAD) placeRing();

  // Visuals.
  const nextR = nextRing();
  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i];
    let op = 1;
    if (r.state === 'active') {
      const pulse = r === nextR ? 0.5 + 0.5 * Math.sin(time * 5) : 0;
      r.mat.emissive.setRGB(0.35 + 0.35 * pulse, 0.2 + 0.2 * pulse, 0.0);
    } else {
      r.t += dt;
      const dur = r.state === 'hit' ? 0.6 : 0.9;
      const k = Math.min(1, r.t / dur);
      op = 1 - k;
      if (r.state === 'hit') r.mesh.scale.setScalar(1 + k * 0.9);
      if (k >= 1) { scene.remove(r.mesh); r.mat.dispose(); rings.splice(i, 1); continue; }
    }
    // Keep rings from popping far out of the glass: fade them as they come nearer than the plane
    // (which is on the glass). Their depth along the chase camera's axis:
    const z = -tmpV.copy(r.pos).applyMatrix4(appCam.matrixWorldInverse).z;
    op *= THREE.MathUtils.smoothstep(z, CONVERGENCE * 0.45, CONVERGENCE * 0.95);
    r.mat.opacity = op;
    r.mesh.visible = op > 0.01;
  }
}
function onRingHit(r) {
  r.state = 'hit'; r.t = 0;
  r.mat.color.set(0x9ff5c0); r.mat.emissive.set(0x1f6a3a);
  S.score++; S.streak++;
  if (S.streak > S.best) { S.best = S.streak; localStorage.setItem('skyhopper.bestStreak', String(S.best)); }
  scoreValueEl.classList.remove('pop'); void scoreValueEl.offsetWidth; scoreValueEl.classList.add('pop');
  toast(S.streak >= 3 ? `+1 · streak ×${S.streak}` : '+1', 'good');
  updateScoreHud();
}
function onRingMiss(r, close) {
  r.state = 'miss'; r.t = 0;
  r.mat.color.set(0x9aa0aa); r.mat.emissive.set(0x000000);
  if (S.streak > 0 && close) toast('Missed!', 'bad');
  S.streak = 0;
  updateScoreHud();
}

// ---------------------------------------------------------------------------------------------
// HUD
function updateScoreHud() {
  scoreValueEl.textContent = String(S.score);
  scoreSubEl.textContent = `streak ${S.streak} · best ${S.best}`;
}
let toastTimer = 0;
function toast(text, kind) {
  toastEl.textContent = text;
  toastEl.className = 'hud ' + kind;
  void toastEl.offsetWidth;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.className = 'hud'; }, 1150); // back to display:none
}
let navT = 0;
function updateNavHud(dt) {
  navT -= dt;
  if (navT > 0) return;
  navT = 0.08;
  const r = nextRing();
  if (!r) { navDistEl.textContent = '—'; navVertEl.textContent = ''; return; }
  const rel = tmpV.copy(r.pos).sub(S.pos);
  const ang = Math.atan2(rel.dot(RIGHT), rel.dot(HFWD));
  navArrowEl.setAttribute('transform', `rotate(${(ang * 180 / Math.PI).toFixed(1)})`);
  navDistEl.textContent = `${Math.round(rel.length())} m`;
  navVertEl.textContent = rel.y > 8 ? '▲ climb' : rel.y < -8 ? '▼ dive' : '';
}
function setMode(woven, extra) {
  modeEl.classList.toggle('woven', woven);
  modeTextEl.textContent = woven ? `3D · depth ${comfort.toFixed(2)}` : (extra || '2D');
  depthHelpEl.style.display = woven ? '' : 'none';
}

// ---------------------------------------------------------------------------------------------
// Input
const KEYMAP = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
addEventListener('keydown', (e) => {
  if (KEYMAP[e.key]) { keys[KEYMAP[e.key]] = true; e.preventDefault(); return; }
  if (e.key === 'p' || e.key === 'P') { S.paused = !S.paused; pausedEl.style.display = S.paused ? 'block' : 'none'; }
  if (woven && (e.key === '-' || e.key === '_')) { comfort = Math.max(COMFORT_MIN, +(comfort - 0.05).toFixed(2)); setMode(true); }
  if (woven && (e.key === '=' || e.key === '+')) { comfort = Math.min(COMFORT_MAX, +(comfort + 0.05).toFixed(2)); setMode(true); }
});
addEventListener('keyup', (e) => { if (KEYMAP[e.key]) { keys[KEYMAP[e.key]] = false; e.preventDefault(); } });
addEventListener('blur', () => { keys.left = keys.right = keys.up = keys.down = false; });

// ---------------------------------------------------------------------------------------------
// Simulation — one step per displayed frame, shared by the 2D and the woven loop.
let lastT = performance.now(), simTime = 0;
const damp = (k, dt) => 1 - Math.exp(-k * dt);

function step(now) {
  const dt = Math.min(0.05, Math.max(0, (now - lastT) / 1000));
  lastT = now;
  if (!S.paused) simulate(dt);
  placeCamera(S.paused ? 0 : dt);
  // World-following backdrops.
  sky.position.copy(appCam.position);
  mountains.position.set(appCam.position.x, 0, appCam.position.z);
  water.position.set(appCam.position.x, WATER_Y, appCam.position.z);
  updateRings(S.paused ? 0 : dt, simTime);
  updateNavHud(dt);
}

function simulate(dt) {
  simTime += dt;
  const turnIn = (keys.left ? 1 : 0) - (keys.right ? 1 : 0);
  const pitchIn = (keys.up ? 1 : 0) - (keys.down ? 1 : 0);
  S.roll += (turnIn * 0.8 - S.roll) * damp(3.2, dt);
  S.pitch += (pitchIn * 0.42 - S.pitch) * damp(2.4, dt);
  S.yaw += S.roll * 1.05 * dt;
  updateDirs();

  S.prevPos.copy(S.pos);
  const speed = SPEED - S.pitch * 14;
  S.pos.addScaledVector(FWD, speed * dt);

  // Soft floor and ceiling.
  const g = groundAt(S.pos.x, S.pos.z);
  if (S.pos.y < g + MIN_CLEARANCE) {
    S.pos.y = g + MIN_CLEARANCE;
    if (S.pitch < 0.2) S.pitch = 0.2;
    if (S.lowWarnT <= 0) { toast('Pull up!', 'bad'); S.lowWarnT = 1.5; if (S.streak) { S.streak = 0; updateScoreHud(); } }
  }
  S.lowWarnT -= dt;
  if (S.pos.y > CEILING) { S.pos.y = CEILING; if (S.pitch > 0) S.pitch *= 0.5; }

  euler.set(S.pitch, S.yaw, S.roll);
  plane.quaternion.setFromEuler(euler);
  plane.position.copy(S.pos);
  plane.userData.blade.rotation.z += dt * 28;

  // Clouds: recycle the ones left far behind to the horizon ahead.
  for (const c of clouds) {
    const dx = c.position.x - S.pos.x, dz = c.position.z - S.pos.z;
    if (dx * dx + dz * dz > 2700 * 2700) placeCloud(c, S.pos.x, S.pos.z, HFWD.x, HFWD.z, true);
  }
  updateChunks(S.pos.x, S.pos.z, 2);
}

function placeCamera(dt) {
  camGoal.copy(S.pos).addScaledVector(HFWD, -CHASE_BACK);
  camGoal.y += CHASE_UP + S.pitch * 3;
  if (dt > 0) appCam.position.lerp(camGoal, damp(5, dt));
  const cg = groundAt(appCam.position.x, appCam.position.z) + 4;
  if (appCam.position.y < cg) appCam.position.y = cg;
  lookTarget.copy(S.pos).addScaledVector(HFWD, LOOK_AHEAD);
  lookTarget.y += LOOK_UP;
  appCam.lookAt(lookTarget);
  appCam.rotateZ(S.roll * 0.18);
  appCam.updateMatrixWorld();
}

// ---------------------------------------------------------------------------------------------
// Backing store
let woven = false;
const MAX_BUFFER_W = 4096;
function sizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = canvas.clientWidth || innerWidth, cssH = canvas.clientHeight || innerHeight;
  // Woven: the side-by-side buffer is the element's device size (each eye gets half the width —
  // what a lenticular panel resolves per eye anyway; also keeps a full-window tile's buffer no
  // wider than the panel). Mono: the same device size, one image.
  let w = Math.round(cssW * dpr), h = Math.round(cssH * dpr);
  const cap = Math.min(MAX_BUFFER_W, renderer.capabilities.maxTextureSize || MAX_BUFFER_W);
  if (w > cap) { h = Math.round(h * cap / w); w = cap; }
  appCam.aspect = cssW / cssH;
  appCam.updateProjectionMatrix();
  const el = renderer.domElement;
  if (el.width === w && el.height === h) return false; // a same-size write would still clear it
  renderer.setSize(w, h, false);
  return true;
}

// ---------------------------------------------------------------------------------------------
// 2D path
function renderMono() {
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, canvas.width, canvas.height);
  renderer.clear();
  renderer.render(scene, appCam);
}
function monoFrame(now) {
  step(now);
  renderMono();
}
function startMono() {
  woven = false;
  sizeCanvas();
  renderer.setAnimationLoop(monoFrame);
}
addEventListener('resize', () => { if (!woven && sizeCanvas()) renderMono(); });

// ---------------------------------------------------------------------------------------------
// Cover
let coverDropped = false;
function dropCover() {
  if (coverDropped) return;
  coverDropped = true;
  coverEl.remove(); // hard cut, never a fade
}

// ---------------------------------------------------------------------------------------------
// 3D path
let sdk = null, sdk3 = null, handle = null, eyes = null, ease = null, rigOk = false;
const rigScratch = {};
const good = [0, 1].map(() => ({ proj: new Float32Array(16), pose: new Float32Array(16), x: 0, y: 0, width: 0, height: 0 }));
let haveGood = false;

function buildRig() {
  return sdk3.cameraRigFromCamera(THREE, appCam, {
    attach: true,
    convergence: CONVERGENCE,
    metersToVirtual: (comfort * CONVERGENCE) / 0.5, // comfort = ipd·m2v·(1/d)·0.5 = `comfort`
    out: rigScratch,
  });
}

function drawStereo() {
  renderer.clear();
  renderer.setScissorTest(true);
  for (let i = 0; i < 2; i++) {
    const g = good[i];
    renderer.setViewport(g.x, g.y, g.width, g.height);
    renderer.setScissor(g.x, g.y, g.width, g.height);
    eyes[i].setLocalFromMatrices(g.proj, g.pose); // LOCAL: the eyes are parented under appCam
    renderer.render(scene, eyes[i].camera);
  }
  renderer.setScissorTest(false);
}

function replayLastGood() {
  if (!haveGood) { renderer.clear(); return; } // still present a frame, never skip one
  drawStereo();
}

function onXRFrame(views, layer, frame) {
  step(performance.now());
  // Pushed BEFORE the gate: a rig drives the NEXT locate, so a frame that can't draw still advances it.
  if (handle && rigOk) handle.setViewRig(buildRig());

  // Validate everything before clear(); a short view list or a null viewport replays the last frame.
  if (!views || views.length < 2 || !layer) return replayLastGood();
  for (let i = 0; i < 2; i++) {
    const vp = layer.getViewport(views[i]);
    if (!vp || vp.width <= 0 || vp.height <= 0) return replayLastGood();
    const g = good[i];
    g.x = vp.x; g.y = vp.y; g.width = vp.width; g.height = vp.height;
    g.proj.set(views[i].projectionMatrix); // COPIES — an XRView is only valid inside this callback
    g.pose.set(views[i].transform.matrix);
  }
  ease.apply(good, sdk.frameTrackingState(frame)); // glide, don't snap, when a viewer is acquired/lost
  haveGood = true;
  drawStereo();
}

function onResize3D() {
  if (!woven) return;
  if (!sizeCanvas()) return;
  // The buffer was reallocated (and cleared): re-split it per eye and repaint NOW.
  const w = canvas.width, h = canvas.height;
  good[0].x = 0; good[0].y = 0; good[0].width = Math.floor(w / 2); good[0].height = h;
  good[1].x = Math.floor(w / 2); good[1].y = 0; good[1].width = w - Math.floor(w / 2); good[1].height = h;
  ease.reset();
  replayLastGood();
}

function onLayerLost() {
  // The weave is gone for good: the SBS pair would now show squeezed, so go back to a flat render.
  if (handle) handle = null;
  for (const e of eyes || []) if (e.camera.parent) e.camera.parent.remove(e.camera);
  startMono();
  dropCover();
  setMode(false, '2D (3D session ended)');
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

async function activate3D(wall) {
  const RIG_OK = (rigOk = sdk.inline3dViewRigSupported());
  eyes = [new sdk3.EyeCamera(THREE), new sdk3.EyeCamera(THREE)];
  for (const e of eyes) { e.camera.near = NEAR; e.camera.far = FAR; appCam.add(e.camera); }
  ease = new sdk.ViewerEase();

  // Size the SBS backing store first, then give the compositor a couple of frames (rule 4).
  woven = true;
  sizeCanvas();
  await nextFrame(); await nextFrame();
  try { wall.session.updateRenderState({ depthNear: NEAR, depthFar: FAR }); } catch (e) { /* session ending */ }

  const opts = {
    onLayerLost,
    onResize: onResize3D,
    rectCover: { color: '#1d2129', snapshot: true },
  };
  // A browser without setViewRig ignores the rig and frames by virtualDisplayHeight instead; the
  // attach pattern still puts that display rig's eyes at the chase camera, just with tiny depth.
  if (RIG_OK) opts.viewRig = buildRig();
  else opts.virtualDisplayHeight = 0.24;
  handle = wall.addScene(canvas, onXRFrame, opts);
  renderer.setAnimationLoop(null); // only after activation succeeded

  // HUD plates over the tile (needed on browsers without draw-order occlusion; ignored elsewhere).
  for (const el of HUD_ELEMENTS) wall.addGlobalOverlay(el);
  wall.on('trackingstatechange', (state) => { hintEl.style.display = state === 'searching' ? 'block' : 'none'; });

  setMode(true);
  if (!RIG_OK) modeTextEl.textContent += ' (no camera rig)';
  handle.firstWoven.then(dropCover, dropCover);
  setTimeout(dropCover, 6000); // the cover always comes off, whatever happens to the signal
}

// ---------------------------------------------------------------------------------------------
// Boot
resetPlayer();
updateChunks(S.pos.x, S.pos.z, Infinity);
placeCamera(0);
updateScoreHud();
startMono(); // the flat game runs while we detect (and is the whole story on a normal browser)

(async () => {
  try {
    // Dynamic, inside try: a bad SDK load degrades to 2D instead of killing the module graph.
    [sdk, sdk3] = await Promise.all([import('@displayxr/inline3d'), import('@displayxr/inline3d/three')]);
  } catch (e) {
    console.warn('[skyhopper] inline-3D SDK failed to load — staying 2D', e);
    setMode(false); dropCover(); return;
  }
  let wall;
  try {
    wall = await sdk.createInline3D({ lazy: false, autoChrome: false });
  } catch (e) {
    wall = { supported: false, error: e };
  }
  if (!wall.supported) { setMode(false); dropCover(); return; }
  try {
    await activate3D(wall);
  } catch (e) {
    console.error('[skyhopper] 3D activation failed — falling back to 2D', e);
    if (handle) { try { handle.remove(); } catch (_) { /* ignore */ } handle = null; }
    for (const ec of eyes || []) if (ec.camera.parent) ec.camera.parent.remove(ec.camera);
    startMono();
    setMode(false);
    dropCover();
  }
})();
