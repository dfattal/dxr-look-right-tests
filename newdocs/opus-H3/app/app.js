// Ring Flyer — a small chase-camera flight game for the DisplayXR Browser (works flat anywhere).
// Built on samples/starter-world (camera rig, attach pattern). Rules: sdk/docs/making-3d-look-right.md.
//
// RIG (guide §1): the user flies THROUGH a world → CAMERA rig. The page owns a chase camera and
// the runtime turns it into two eyes (63 mm × ipdFactor × metersToVirtual, world units = metres).
//
// SCREEN PLANE (§2): FIXED, FINITE convergence = the chase distance along the view axis (≈ 3.5 m),
// so the plane — the subject, always in the centre of the frame — sits ON the glass, crisp, and
// the world falls away behind it like a view through a window. The chase camera keeps that
// distance constant, so the convergence is a constant: never driven by what is under the cursor.
//
// DEPTH (§3, full-frame column, 16:9 tile, vertical FOV 55°). On a camera rig
//   disparity (% of width) = 100 · 0.063 · (1/D − 1/z) / (2 · tan(fov/2) · aspect),  D = 3.5
//   sky / infinity (1/z = 0) ......... +0.97 %   (comfortable behind ≤ 1.0 %)
//   mountains at 330–430 m ............ +0.96 %   (and hazed, low contrast)
//   plane's tail, ~2.8 m .............. −0.24 %   (centre of frame; full-frame front ≤ 0.3 %)
//   plane's nose, ~4.2 m .............. +0.16 %
//   terrain at the bottom edge ........ ≥ 0       (camera kept ≥ 2.3 m above the ground there)
//   comfort = ipd · m2v · (1/D) · 0.6 = 0.17  (must stay ≤ 1)
// Rings vanish (hard cut) the moment the plane crosses them — at the glass — so they never come
// out of the glass at the frame edges; anything that gets nearer than the plane is removed.

import * as THREE from 'three';
import { createInline3D } from '@displayxr/inline3d';
import { EyeCamera, cameraRigFromCamera } from '@displayxr/inline3d/three';

const canvas = document.getElementById('game');
const cover = document.getElementById('cover');
const ringsEl = document.getElementById('rings');
const missedEl = document.getElementById('missed');
const bestEl = document.getElementById('best');
const depthEl = document.getElementById('depth');
const modeBtn = document.getElementById('mode');
const modeNote = document.getElementById('modeNote');

// ---- tuning ------------------------------------------------------------------------------------
const FOV = 55;                 // vertical, degrees
const CHASE_BACK = 3.4;         // camera behind the plane, m
const CHASE_UP = 1.1;           // camera above the plane, m
const LOOK_AHEAD = 2.2;         // camera aims this far ahead of the plane
const CONVERGENCE = 3.5;        // = plane distance along the view axis (see header)
const IPD = 1.0;                // tuned eye scale (absolute on a camera rig): the slider's top
const SPEED = 15;               // m/s
const CLEARANCE = 2.2;          // plane's minimum height above the ground
const CAM_CLEARANCE = 2.8;      // camera's minimum height above the ground below it
const MAX_Y = 34;
const WATER = 1.4;
const RING_R = 1.7;
const HAZE = new THREE.Color('#c9d8e6');   // fog == sky horizon == clear colour
const ZENITH = new THREE.Color('#4f86c6');
const SUN_DIR = new THREE.Vector3(-0.45, 0.42, -0.79).normalize();

// ---- renderer, scene, camera -------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setClearColor(HAZE, 1);          // OPAQUE clear
renderer.setPixelRatio(1);                // the SDK sizes the store; never multiply again
renderer.autoClear = false;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(HAZE, 70, 205);
const cam = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.2, 600);
scene.add(cam);                           // IN the scene: the eye cameras hang under it

scene.add(new THREE.HemisphereLight(0xdfeeff, 0x4a5a3a, 1.25));
const sun = new THREE.DirectionalLight(0xfff1d8, 2.4);
sun.position.copy(SUN_DIR).multiplyScalar(100);
scene.add(sun);

// ---- noise -------------------------------------------------------------------------------------
let seed = 20261028;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const perm = new Uint8Array(512);
{
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
}
const GX = [1, -1, 1, -1, 1.41, -1.41, 0, 0], GY = [1, 1, -1, -1, 0, 0, 1.41, -1.41];
function noise(x, y) {                     // 2D gradient noise, ≈ [−1, 1]
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const X = xi & 255, Y = yi & 255;
  const g = (ix, iy, dx, dy) => { const h = perm[ix + perm[iy]] & 7; return GX[h] * dx + GY[h] * dy; };
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = g(X, Y, xf, yf), b = g(X + 1, Y, xf - 1, yf);
  const c = g(X, Y + 1, xf, yf - 1), d = g(X + 1, Y + 1, xf - 1, yf - 1);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v);
}
function fbm(x, y, oct) {
  let s = 0, a = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += a * noise(x, y); n += a; x *= 2.03; y *= 2.03; a *= 0.5; }
  return s / n;
}
function rawHeight(x, z) {                 // rolling hills, metres
  const big = fbm(x * 0.0075 + 13.1, z * 0.0075 - 7.3, 3);
  const mid = noise(x * 0.028, z * 0.028);
  return 7.5 + big * 17 + mid * 2.2;
}
const heightAt = (x, z) => Math.max(WATER, rawHeight(x, z));

// A fine irregular grain (stereo matching needs detail; repeats confuse it).
function grainTexture(size = 256, n = 2600, contrast = 0.16, r = 3) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < n; i++) {
    g.fillStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,255,255'},${rnd() * contrast})`;
    g.beginPath();
    g.arc(rnd() * size, rnd() * size, 0.6 + rnd() * rnd() * r, 0, 7);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// ---- terrain: one grid that re-centres under the plane, heights from world coordinates ----------
const T_SIZE = 440, T_SEG = 176, T_CELL = T_SIZE / T_SEG, T_SNAP = 10;
const tGeo = new THREE.BufferGeometry();
const tN = (T_SEG + 1) * (T_SEG + 1);
const tPos = new Float32Array(tN * 3), tCol = new Float32Array(tN * 3), tUV = new Float32Array(tN * 2);
tGeo.setAttribute('position', new THREE.BufferAttribute(tPos, 3));
tGeo.setAttribute('color', new THREE.BufferAttribute(tCol, 3));
tGeo.setAttribute('uv', new THREE.BufferAttribute(tUV, 2));
{
  const idx = [];
  for (let j = 0; j < T_SEG; j++) for (let i = 0; i < T_SEG; i++) {
    const a = j * (T_SEG + 1) + i, b = a + 1, c = a + T_SEG + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  tGeo.setIndex(idx);
}
const terrain = new THREE.Mesh(tGeo, new THREE.MeshStandardMaterial({
  vertexColors: true, map: grainTexture(), roughness: 0.95, metalness: 0,
}));
scene.add(terrain);
const C_WATER = new THREE.Color('#3f7fa6'), C_SAND = new THREE.Color('#cfc08a');
const C_GRASS1 = new THREE.Color('#5f9a3c'), C_GRASS2 = new THREE.Color('#3f7a35');
const C_HIGH = new THREE.Color('#8a9a55'), C_ROCK = new THREE.Color('#8b8272');
const tmpC = new THREE.Color();
let tCenter = null;
function buildTerrain(cx, cz) {
  tCenter = { x: cx, z: cz };
  const x0 = cx - T_SIZE / 2, z0 = cz - T_SIZE / 2;
  let k = 0;
  for (let j = 0; j <= T_SEG; j++) for (let i = 0; i <= T_SEG; i++, k++) {
    const x = x0 + i * T_CELL, z = z0 + j * T_CELL;
    const hr = rawHeight(x, z), h = Math.max(WATER, hr);
    tPos[k * 3] = x; tPos[k * 3 + 1] = h; tPos[k * 3 + 2] = z;
    tUV[k * 2] = x / 9; tUV[k * 2 + 1] = z / 9;     // world-anchored: the grain never slides
    const jit = noise(x * 0.11 + 50, z * 0.11);       // patchy fields
    if (hr < WATER) tmpC.copy(C_WATER).offsetHSL(0, 0, jit * 0.03);
    else if (hr < WATER + 0.9) tmpC.copy(C_SAND);
    else if (hr < 16) tmpC.copy(C_GRASS1).lerp(C_GRASS2, 0.5 + jit * 0.6).lerp(C_HIGH, Math.max(0, (hr - 10) / 6));
    else tmpC.copy(C_HIGH).lerp(C_ROCK, Math.min(1, (hr - 16) / 5));
    tCol[k * 3] = tmpC.r; tCol[k * 3 + 1] = tmpC.g; tCol[k * 3 + 2] = tmpC.b;
  }
  tGeo.attributes.position.needsUpdate = true;
  tGeo.attributes.color.needsUpdate = true;
  tGeo.attributes.uv.needsUpdate = true;
  tGeo.computeVertexNormals();
  tGeo.computeBoundingSphere();
}
function updateTerrain(px, pz) {
  const cx = Math.round(px / T_SNAP) * T_SNAP, cz = Math.round(pz / T_SNAP) * T_SNAP;
  if (!tCenter || cx !== tCenter.x || cz !== tCenter.z) buildTerrain(cx, cz);
}

// ---- sky: a gradient dome with a soft sun; follows the camera ------------------------------------
const sky = new THREE.Mesh(new THREE.SphereGeometry(480, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { haze: { value: HAZE }, zenith: { value: ZENITH }, sunDir: { value: SUN_DIR } },
  vertexShader: `varying vec3 vDir;
    void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform vec3 haze; uniform vec3 zenith; uniform vec3 sunDir; varying vec3 vDir;
    void main(){
      vec3 d = normalize(vDir);
      vec3 c = mix(haze, zenith, smoothstep(0.0, 0.55, d.y));
      float s = max(dot(d, sunDir), 0.0);
      c += vec3(1.0, 0.93, 0.8) * (pow(s, 12.0) * 0.25 + smoothstep(0.9975, 0.9990, s) * 0.9);
      gl_FragColor = vec4(c, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
}));
sky.renderOrder = -2;
scene.add(sky);

// ---- distant mountains: two hazy ranges on rings that travel with the player ---------------------
function mountainRange(radius, base, amp, freq, cLow, cTop, snowAt) {
  const SEG = 360, ROWS = 5, pos = [], col = [], idx = [];
  const lo = new THREE.Color(cLow), hi = new THREE.Color(cTop), snow = new THREE.Color('#eef2f6');
  for (let s = 0; s <= SEG; s++) {
    const a = (s / SEG) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    const ridge = 1 - Math.abs(fbm(ca * freq + radius, sa * freq, 4));     // sharp-ish crests
    const peak = base + amp * ridge * ridge;
    for (let r = 0; r <= ROWS; r++) {
      const t = r / ROWS, y = -25 + t * (peak + 25);
      const rr = radius - t * 25;                                           // slope toward us
      pos.push(ca * rr, y, sa * rr);
      tmpC.copy(HAZE).lerp(lo, Math.min(1, t * 1.8)).lerp(hi, Math.max(0, t - 0.4));
      if (y > snowAt && r >= ROWS - 1) tmpC.lerp(snow, 0.75);
      col.push(tmpC.r, tmpC.g, tmpC.b);
    }
  }
  for (let s = 0; s < SEG; s++) for (let r = 0; r < ROWS; r++) {
    const a = s * (ROWS + 1) + r, b = a + ROWS + 1;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide }));
  m.renderOrder = -1;
  return m;
}
const mountains = new THREE.Group();
mountains.add(mountainRange(430, 40, 120, 2.2, '#9fb3c8', '#8ea3ba', 125));
mountains.add(mountainRange(335, 20, 70, 3.1, '#8ea595', '#71877f', 999));
scene.add(mountains);

// ---- clouds: soft sprites high above (soft edges don't ghost) ------------------------------------
function cloudTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  for (let i = 0; i < 14; i++) {
    const x = 50 + rnd() * 156, y = 50 + rnd() * 34, r = 22 + rnd() * 30;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.55)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 256, 128);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const CLOUD_BOX = 260;
const cloudMats = [cloudTexture(), cloudTexture(), cloudTexture()].map((map) =>
  new THREE.SpriteMaterial({ map, depthWrite: false, fog: true, transparent: true }));
const clouds = [];
for (let i = 0; i < 34; i++) {
  const s = new THREE.Sprite(cloudMats[i % 3]);
  const w = 45 + rnd() * 50;
  s.scale.set(w, w / 2, 1);
  s.position.set((rnd() * 2 - 1) * CLOUD_BOX, 58 + rnd() * 22, (rnd() * 2 - 1) * CLOUD_BOX);
  scene.add(s);
  clouds.push(s);
}

// ---- the plane ---------------------------------------------------------------------------------
// Modelled nose along −Z (like a camera); rotation order YXZ = yaw, pitch, roll.
const plane = new THREE.Group();
{
  const red = new THREE.MeshStandardMaterial({ color: '#d8432f', roughness: 0.5, metalness: 0.1 });
  const cream = new THREE.MeshStandardMaterial({ color: '#f1ead8', roughness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: '#2a2f38', roughness: 0.6 });
  const glass = new THREE.MeshStandardMaterial({ color: '#2d4f73', roughness: 0.15, metalness: 0.3 });
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
    plane.add(m);
    return m;
  };
  add(new THREE.CylinderGeometry(0.07, 0.15, 1.3, 16), red, 0, 0, 0.05, Math.PI / 2);       // fuselage
  add(new THREE.SphereGeometry(0.15, 16, 12), cream, 0, 0, -0.6);                            // nose
  add(new THREE.SphereGeometry(0.12, 16, 10), glass, 0, 0.12, -0.18).scale.set(0.8, 0.7, 1.6); // canopy
  const wing = new THREE.BoxGeometry(0.92, 0.035, 0.32);
  add(wing, cream, -0.47, -0.03, -0.12, 0, 0, -0.06);                                        // wings, a little dihedral
  add(wing, cream, 0.47, -0.03, -0.12, 0, 0, 0.06);
  add(new THREE.BoxGeometry(0.12, 0.04, 0.33), red, -0.88, -0.006, -0.12, 0, 0, -0.06);      // red wing tips
  add(new THREE.BoxGeometry(0.12, 0.04, 0.33), red, 0.88, -0.006, -0.12, 0, 0, 0.06);
  add(new THREE.BoxGeometry(0.66, 0.03, 0.18), cream, 0, 0.02, 0.6);                         // tailplane
  add(new THREE.BoxGeometry(0.03, 0.28, 0.22), red, 0, 0.15, 0.62);                          // fin
  add(new THREE.CylinderGeometry(0.04, 0.04, 0.06, 10), dark, 0, 0, -0.76, Math.PI / 2);     // hub
  const disc = add(new THREE.CircleGeometry(0.34, 32), new THREE.MeshBasicMaterial({
    color: '#3a3f48', transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide,
  }), 0, 0, -0.79);
  disc.renderOrder = 2;
  for (const s of [-1, 1]) add(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 6), dark, s * 0.17, -0.22, -0.3, 0, 0, s * 0.35); // gear
}
scene.add(plane);

// A soft shadow blob on the ground under the plane: a strong cue to its height.
const blobTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(0,0,0,0.5)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.6), new THREE.MeshBasicMaterial({
  map: blobTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
}));
shadow.rotation.x = -Math.PI / 2;
scene.add(shadow);

// A brief glow ring around the plane when a ring is collected: attached to the plane, so it stays
// at the glass in the centre of the frame (never flies at the viewer).
const flash = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.05, 8, 48),
  new THREE.MeshBasicMaterial({ color: '#ffe27a', transparent: true, opacity: 0, depthWrite: false, fog: false }));
flash.visible = false;
plane.add(flash);
let flashT = 1;

// ---- rings: a gently curving course, a few rings ahead at a time --------------------------------
const ringGeo = new THREE.TorusGeometry(RING_R, 0.13, 12, 56);
const ringNext = new THREE.MeshStandardMaterial({ color: '#ffc531', emissive: '#ffb000', emissiveIntensity: 0.65, roughness: 0.35, metalness: 0.4 });
const ringLater = new THREE.MeshStandardMaterial({ color: '#f4efe4', emissive: '#d9cfb8', emissiveIntensity: 0.35, roughness: 0.5 });
const rings = [];
const gen = { x: 0, z: 0, yaw: 0 };
function spawnRing() {
  gen.yaw += (rnd() * 2 - 1) * 0.55;
  const step = 38 + rnd() * 16;
  gen.x += -Math.sin(gen.yaw) * step;
  gen.z += -Math.cos(gen.yaw) * step;
  const y = Math.min(MAX_Y - 3, heightAt(gen.x, gen.z) + 4.5 + rnd() * 6);
  const m = new THREE.Mesh(ringGeo, ringLater);
  m.position.set(gen.x, y, gen.z);
  m.rotation.y = gen.yaw;                    // the ring faces along the course
  scene.add(m);
  rings.push({ mesh: m, n: new THREE.Vector3(-Math.sin(gen.yaw), 0, -Math.cos(gen.yaw)), prev: null });
}
function dropRing(i) {
  scene.remove(rings[i].mesh);               // a hard cut, never a fade
  rings.splice(i, 1);
}

// ---- game state ----------------------------------------------------------------------------------
const st = { x: 0, y: 14, z: 0, yaw: 0, pitch: 0, bank: 0, score: 0, missed: 0 };
let best = Number(localStorage.getItem('ringflyer.best') || 0);
bestEl.textContent = `best ${best}`;
function hudUpdate() {
  ringsEl.textContent = st.score;
  missedEl.textContent = st.missed;
  if (st.score > best) { best = st.score; localStorage.setItem('ringflyer.best', best); }
  bestEl.textContent = `best ${best}`;
}

const keys = new Set();
const GAME_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyA', 'KeyD', 'KeyW', 'KeyS'];
addEventListener('keydown', (e) => {
  if (!GAME_KEYS.includes(e.code)) return;
  e.preventDefault();
  keys.add(e.code);
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

const camTarget = new THREE.Vector3(), camPos = new THREE.Vector3(), tmp = new THREE.Vector3();
let camInit = false;
const damp = (cur, to, rate, dt) => cur + (to - cur) * (1 - Math.exp(-rate * dt));

function step(dt) {
  // Input → bank and pitch targets; the bank turns the plane.
  const turn = (keys.has('ArrowLeft') || keys.has('KeyA')) - (keys.has('ArrowRight') || keys.has('KeyD'));
  const climb = (keys.has('ArrowUp') || keys.has('KeyW')) - (keys.has('ArrowDown') || keys.has('KeyS'));
  st.bank = damp(st.bank, turn * 0.75, 3.2, dt);
  st.pitch = damp(st.pitch, climb * 0.4, 2.6, dt);
  st.yaw += st.bank * 1.5 * dt;

  const cp = Math.cos(st.pitch);
  st.x += -Math.sin(st.yaw) * cp * SPEED * dt;
  st.z += -Math.cos(st.yaw) * cp * SPEED * dt;
  st.y += Math.sin(st.pitch) * SPEED * dt;
  const ground = heightAt(st.x, st.z);
  if (st.y < ground + CLEARANCE) { st.y = ground + CLEARANCE; st.pitch = Math.max(st.pitch, 0.12); }
  if (st.y > MAX_Y) { st.y = MAX_Y; st.pitch = Math.min(st.pitch, 0); }

  plane.position.set(st.x, st.y, st.z);
  plane.rotation.set(st.pitch, st.yaw, st.bank, 'YXZ');
  const alt = st.y - ground;
  shadow.position.set(st.x, ground + 0.05, st.z);
  shadow.rotation.z = st.yaw;
  shadow.scale.setScalar(1 + alt * 0.04);
  shadow.material.opacity = Math.max(0.15, 1 - alt / 25);

  if (flashT < 1) {
    flashT = Math.min(1, flashT + dt / 0.45);
    flash.scale.setScalar(1 + flashT * 0.35);
    flash.material.opacity = 0.9 * (1 - flashT);
    flash.visible = flashT < 1;
  }

  // Chase camera: behind and above along the heading; damped, so it swings a little in turns.
  const fx = -Math.sin(st.yaw), fz = -Math.cos(st.yaw);
  tmp.set(st.x - fx * CHASE_BACK, st.y + CHASE_UP + st.pitch * 0.6, st.z - fz * CHASE_BACK);
  tmp.y = Math.max(tmp.y, heightAt(tmp.x, tmp.z) + CAM_CLEARANCE);
  const look = new THREE.Vector3(st.x + fx * LOOK_AHEAD, st.y + 0.3, st.z + fz * LOOK_AHEAD);
  if (!camInit) { camPos.copy(tmp); camTarget.copy(look); camInit = true; }
  const k = 1 - Math.exp(-7 * dt);
  camPos.lerp(tmp, k);
  camTarget.lerp(look, 1 - Math.exp(-10 * dt));
  cam.position.copy(camPos);
  cam.lookAt(camTarget);
  cam.rotateZ(st.bank * 0.22);              // a hint of the bank, not the full roll

  // World that travels with the player.
  updateTerrain(st.x, st.z);
  sky.position.copy(cam.position);
  mountains.position.set(cam.position.x, 0, cam.position.z);
  for (const c of clouds) {
    if (c.position.x - st.x > CLOUD_BOX) c.position.x -= 2 * CLOUD_BOX;
    if (c.position.x - st.x < -CLOUD_BOX) c.position.x += 2 * CLOUD_BOX;
    if (c.position.z - st.z > CLOUD_BOX) c.position.z -= 2 * CLOUD_BOX;
    if (c.position.z - st.z < -CLOUD_BOX) c.position.z += 2 * CLOUD_BOX;
  }

  // Rings: score on crossing the ring's plane inside it; drop anything passed, far, or nearer
  // to the camera than the plane (it would come out of the glass at the frame edge).
  let changed = false;
  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i], p = r.mesh.position;
    tmp.set(st.x - p.x, st.y - p.y, st.z - p.z);
    const d = tmp.dot(r.n);
    let gone = false;
    if (r.prev !== null && Math.sign(d) !== Math.sign(r.prev)) {
      const lateral = tmp.addScaledVector(r.n, -d).length();
      if (lateral < RING_R - 0.15) { st.score++; flashT = 0; flash.visible = true; }
      else st.missed++;
      gone = true;
    } else if (p.distanceTo(cam.position) < CONVERGENCE - 0.6 || p.distanceTo(plane.position) > 240 ||
               (p.x - st.x) * fx + (p.z - st.z) * fz < -8) {
      st.missed++;
      gone = true;
    }
    r.prev = d;
    if (gone) { dropRing(i); changed = true; }
  }
  if (rings.length === 0) { gen.x = st.x; gen.z = st.z; gen.yaw = st.yaw; }
  while (rings.length < 5) spawnRing();
  rings.forEach((r, i) => { r.mesh.material = i === 0 ? ringNext : ringLater; });
  if (changed) hudUpdate();
}

let lastT = 0;
function tick(now) {
  const dt = lastT ? Math.min((now - lastT) / 1000, 0.1) : 0;
  lastT = now;
  step(dt);
}
step(0);

// ---- backing store: 2× wide when woven, 1:1 flat. Sized BEFORE registering, then only in onResize
let sbs = false;
function sizeStore(cssW = canvas.clientWidth, cssH = canvas.clientHeight, dpr = devicePixelRatio || 1) {
  const w = Math.max(1, Math.round(cssW * dpr)), h = Math.max(1, Math.round(cssH * dpr));
  renderer.setSize(sbs ? 2 * w : w, h, false);
  cam.aspect = w / h;
  cam.updateProjectionMatrix();
}

// ---- woven path: the attach pattern (identity-posed rig, eyes parented under the app camera) ------
const eyes = [new EyeCamera(THREE), new EyeCamera(THREE)];
for (const e of eyes) cam.add(e.camera);
let last = null;                           // copies: an XRView is valid only inside its frame

function onXRFrame(views, layer) {
  tick(performance.now());
  // Validate before clearing; a short view list replays the last good frame.
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
  scene.updateMatrixWorld();
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
function onResize({ width, height, dpr }) {   // inside the SDK's observer, before paint
  sizeStore(width, height, dpr);
  if (!last) return;
  const w = canvas.width / 2;
  last.forEach((e, i) => { e.vp = { x: i * w, y: 0, width: w, height: canvas.height }; });
  drawEyes();
}

// ---- mono path: the same camera, drawn once ---------------------------------------------------------
function onMonoFrame(now) {
  requestAnimationFrame(onMonoFrame);
  tick(now);
  renderer.clear();
  renderer.setViewport(0, 0, canvas.width, canvas.height);
  renderer.render(scene, cam);
}

// ---- boot --------------------------------------------------------------------------------------------
const wall = await createInline3D({ lazy: false });
if (wall.supported) {
  sbs = true;
  sizeStore();                               // size BEFORE registering
  const rig = (k) => cameraRigFromCamera(THREE, cam, {
    convergence: CONVERGENCE, attach: true, ipdFactor: IPD * k, parallaxFactor: k,
  });
  const handle = wall.addScene(canvas, onXRFrame, { viewRig: rig(1), onResize });
  wall.session.updateRenderState({ depthNear: cam.near, depthFar: cam.far });

  // Depth slider: ONE value moves BOTH factors. Absolute on a camera rig, so its top is the tuned IPD.
  depthEl.addEventListener('input', () => handle.setViewRig(rig(Number(depthEl.value))));

  // 2D/3D switch; the label follows what the display REPORTS, not the click.
  let flat = false;
  const show = () => {
    modeBtn.textContent = flat ? 'Show in 3D' : 'Show in 2D';
    modeBtn.setAttribute('aria-pressed', String(flat));
  };
  handle.on('renderingmodechange', (e) => { if (e.viewCount) { flat = e.viewCount === 1; show(); } });
  modeBtn.addEventListener('click', () => {
    handle.setStereoEnabled(flat).catch(() => {
      // No flat mode on this display: depth 0 is flat anywhere.
      flat = !flat;
      depthEl.value = flat ? 0 : 1;
      handle.setViewRig(rig(Number(depthEl.value)));
      show();
    });
  });
  show();
  await handle.firstWoven;                   // cover until the first woven frame
  cover.remove();                            // cut, never fade
} else {
  sizeStore();
  new ResizeObserver(() => sizeStore()).observe(canvas);
  depthEl.disabled = modeBtn.disabled = true;
  modeBtn.textContent = '2D';
  modeNote.textContent = 'Open in the DisplayXR Browser on a 3D display to fly in 3D.';
  cover.remove();
  requestAnimationFrame(onMonoFrame);
}
