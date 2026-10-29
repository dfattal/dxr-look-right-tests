import * as THREE from 'three';
import { createInline3D } from '@displayxr/inline3d';
import { EyeCamera, cameraRigFromCamera } from '@displayxr/inline3d/three';

const $ = (id) => document.getElementById(id);
const canvas = $('stage');

// ---- depth configuration -------------------------------------------------------------------
// World unit = 10 cm (metersToVirtual 10). The plane sits CONV units from the chase camera, so
// it lands on the glass; terrain falls away behind/below it, mountains are near-infinity.
// comfort = ipd(1) * m2v(10) * (1/CONV) * 0.5 = 0.5  (<= 1, so the far background never diverges)
const CONV = 10;
const M2V = 10;
const FOV = 40;
const NEAR = 0.5, FAR = 2500;

// ---- renderer / scene ------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(1);          // getViewport() is already backing-store px
renderer.autoClear = false;
renderer.xr.enabled = false;

const HORIZON = new THREE.Color(0xa9bfd0);
const scene = new THREE.Scene();
scene.background = HORIZON;
scene.fog = new THREE.Fog(HORIZON, 70, 330);

scene.add(new THREE.HemisphereLight(0xdbe9ff, 0x5b5a48, 1.15));
const sun = new THREE.DirectionalLight(0xfff0d8, 2.0);
sun.position.set(-60, 90, 40);
scene.add(sun);

const appCam = new THREE.PerspectiveCamera(FOV, 16 / 9, NEAR, FAR);
scene.add(appCam);                  // in the scene: eye cameras are parented under it
const eyes = [new EyeCamera(THREE), new EyeCamera(THREE)];
for (const e of eyes) appCam.add(e.camera);

// ---- terrain height (shared by JS collision and the GPU) ---------------------------------------
const HEIGHT_GLSL = `
float terrainH(vec2 p){
  return 3.2*sin(p.x*0.045+1.3)*cos(p.y*0.037)
       + 1.7*sin(p.x*0.11+p.y*0.09+2.0)
       + 0.8*sin(p.x*0.23-p.y*0.19+0.7)
       + 0.35*sin(p.x*0.41+p.y*0.37);
}`;
function terrainH(x, z) {
  return 3.2 * Math.sin(x * 0.045 + 1.3) * Math.cos(z * 0.037)
    + 1.7 * Math.sin(x * 0.11 + z * 0.09 + 2.0)
    + 0.8 * Math.sin(x * 0.23 - z * 0.19 + 0.7)
    + 0.35 * Math.sin(x * 0.41 + z * 0.37);
}

const CELL = 2, SEG = 180, SIZE = CELL * SEG;       // 360 units square
const tGeo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
tGeo.rotateX(-Math.PI / 2);
const tMat = new THREE.MeshLambertMaterial({ color: 0xffffff, fog: true });
const tOff = { value: new THREE.Vector2() };
tMat.onBeforeCompile = (sh) => {
  sh.uniforms.uOff = tOff;
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', `#include <common>\nuniform vec2 uOff;\nvarying float vH;\nvarying vec2 vW;\n${HEIGHT_GLSL}`)
    .replace('#include <beginnormal_vertex>', `
      vec2 wp = position.xz + uOff;
      float e = 1.0;
      float dx = terrainH(wp+vec2(e,0.))-terrainH(wp-vec2(e,0.));
      float dz = terrainH(wp+vec2(0.,e))-terrainH(wp-vec2(0.,e));
      vec3 objectNormal = normalize(vec3(-dx, 2.0*e, -dz));
      #ifdef USE_TANGENT
      vec3 objectTangent = vec3( tangent.xyz );
      #endif`)
    .replace('#include <begin_vertex>', `
      float hh = terrainH(wp);
      vH = hh; vW = wp;
      vec3 transformed = vec3(position.x, hh, position.z);`);
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying float vH;\nvarying vec2 vW;')
    .replace('#include <color_fragment>', `
      float t = clamp((vH + 4.5) / 9.0, 0.0, 1.0);
      vec3 low = vec3(0.20, 0.42, 0.20), mid = vec3(0.42, 0.55, 0.24), high = vec3(0.62, 0.58, 0.38);
      vec3 gcol = mix(mix(low, mid, smoothstep(0.0, 0.5, t)), high, smoothstep(0.55, 1.0, t));
      gcol *= 0.94 + 0.06 * sin(vW.x*0.7) * sin(vW.y*0.7);   // very soft, low-contrast texture
      diffuseColor.rgb = gcol;`);
};
const terrain = new THREE.Mesh(tGeo, tMat);
terrain.frustumCulled = false;
scene.add(terrain);

// ---- mountains: ridge rings with baked haze colours, no fog -------------------------------------
function ridge(x, y) {
  return Math.sin(x * 1.7 + y * 0.9) * 0.5 + Math.sin(x * 3.9 - y * 2.1 + 1.0) * 0.28
    + Math.sin(x * 8.3 + y * 5.0) * 0.14 + Math.sin(x * 17.0 - y * 9.0) * 0.06;
}
function mountainRing(r0, depth, maxH, seed, tint) {
  const A = 360, R = 5, pos = [], col = [], idx = [];
  const c = new THREE.Color(), snowC = new THREE.Color(0.92, 0.95, 1);
  for (let j = 0; j <= R; j++) for (let i = 0; i <= A; i++) {
    const a = (i / A) * Math.PI * 2, rr = r0 + (j / R) * depth;
    const n = ridge(Math.cos(a) * 2.2 + seed, Math.sin(a) * 2.2 + seed * 0.7);
    const crest = Math.max(0, (n + 0.55) / 1.4);
    const peak = Math.pow(crest, 1.6) * maxH;
    const h = peak * (1 - Math.pow(j / R, 1.2) * 0.9) - 4;
    pos.push(Math.cos(a) * rr, h, Math.sin(a) * rr);
    // rock -> snow, then haze toward the horizon colour by layer (tint) and by lowness
    const snow = THREE.MathUtils.smoothstep(h, maxH * 0.55, maxH * 0.8);
    c.setRGB(0.36, 0.40, 0.48).lerp(snowC, snow)
      .lerp(HORIZON, THREE.MathUtils.clamp(tint + (1 - THREE.MathUtils.smoothstep(h, -4, maxH * 0.4)) * 0.5, 0, 1));
    col.push(c.r, c.g, c.b);
  }
  for (let j = 0; j < R; j++) for (let i = 0; i < A; i++) {
    const a = j * (A + 1) + i, b = a + 1, d = a + A + 1, e = d + 1;
    idx.push(a, d, b, b, d, e);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide }));
  m.frustumCulled = false;
  return m;
}
const mountains = [
  { mesh: mountainRing(1100, 260, 260, 3.0, 0.62), follow: 0.98 },
  { mesh: mountainRing(800, 220, 200, 7.5, 0.42), follow: 0.93 },
  { mesh: mountainRing(520, 160, 130, 12.1, 0.22), follow: 0.85 },
];
mountains.forEach((m) => scene.add(m.mesh));

// ---- sky -----------------------------------------------------------------------------------------
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(2000, 32, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `varying vec3 vP;
      void main(){
        float t = clamp(normalize(vP).y, 0.0, 1.0);
        vec3 hor = vec3(${HORIZON.r.toFixed(3)}, ${HORIZON.g.toFixed(3)}, ${HORIZON.b.toFixed(3)});
        vec3 top = vec3(0.20, 0.42, 0.74);
        gl_FragColor = vec4(mix(hor, top, pow(t, 0.55)), 1.0);
      }`,
  }),
);
sky.renderOrder = -10;
sky.frustumCulled = false;
scene.add(sky);

// ---- clouds (soft, mid-distance, wrap around the player) ------------------------------------------
const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x6f7c88, fog: true });
const clouds = [];
const puffGeo = new THREE.IcosahedronGeometry(1, 1);
for (let i = 0; i < 16; i++) {
  const g = new THREE.Group();
  const n = 3 + (i % 3);
  for (let k = 0; k < n; k++) {
    const p = new THREE.Mesh(puffGeo, cloudMat);
    p.position.set((k - n / 2) * 4.5 + Math.sin(i + k) * 2, Math.cos(i * 2 + k) * 1.2, Math.sin(k * 2 + i) * 3);
    p.scale.set(5 + (k % 2) * 2, 2.6, 4);
    g.add(p);
  }
  g.userData = { ox: Math.sin(i * 12.9898) * 400, oz: -i * 40 + 40, y: 38 + (i % 5) * 7 };
  scene.add(g);
  clouds.push(g);
}

// ---- plane -----------------------------------------------------------------------------------------
const plane = new THREE.Group();
const body = new THREE.Group();
plane.add(body);
const mWhite = new THREE.MeshLambertMaterial({ color: 0xf1ece0 });
const mRed = new THREE.MeshLambertMaterial({ color: 0xe0452e });
const fus = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.1, 1.5, 12), mWhite);
fus.rotation.x = Math.PI / 2;           // axis along z; nose toward -z
body.add(fus);
const nose = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.4, 12), mRed);
nose.rotation.x = -Math.PI / 2; nose.position.z = -0.95;
body.add(nose);
const wing = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.04, 0.5), mRed);
wing.position.set(0, 0, -0.1);
body.add(wing);
const tailW = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.03, 0.26), mRed);
tailW.position.set(0, 0.02, 0.68);
body.add(tailW);
const fin = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.34, 0.28), mRed);
fin.position.set(0, 0.2, 0.68);
body.add(fin);
const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 8), new THREE.MeshLambertMaterial({ color: 0x4a6f93 }));
canopy.scale.z = 1.6; canopy.position.set(0, 0.13, -0.15);
body.add(canopy);
scene.add(plane);

// ground shadow blob: a strong, cheap depth cue linking the plane to the terrain
const shadow = new THREE.Mesh(
  new THREE.CircleGeometry(0.9, 20),
  new THREE.MeshBasicMaterial({ color: 0x10200f, transparent: true, opacity: 0.4, depthWrite: false, fog: true }),
);
shadow.rotation.x = -Math.PI / 2;
scene.add(shadow);

// ---- rings ------------------------------------------------------------------------------------------
const RING_R = 2.4, RING_GAP = 46;
const ringGeo = new THREE.TorusGeometry(RING_R, 0.22, 12, 40);
const rings = [];
let nextRingZ = -60, lastRingX = 0;
let rngState = 12345;
const rnd = () => ((rngState = (rngState * 1664525 + 1013904223) >>> 0) / 4294967296);

function spawnRing() {
  const x = THREE.MathUtils.clamp(lastRingX + (rnd() - 0.5) * 36, -45, 45);
  const z = nextRingZ;
  const y = THREE.MathUtils.clamp(terrainH(x, z) + 5 + rnd() * 5, 6, 20);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffc933, emissive: 0x6a4a00 });
  const mesh = new THREE.Mesh(ringGeo, mat);
  mesh.position.set(x, y, z);
  scene.add(mesh);
  rings.push({ mesh, mat, state: 'live', t: 0 });
  lastRingX = x;
  nextRingZ -= RING_GAP;
}

// ---- game state / input -------------------------------------------------------------------------------
const P = { x: 0, y: 14, z: 0, yaw: 0, pitch: 0, roll: 0, vy: 0, rate: 0 };
const SPEED = 15;
let score = 0;
const keys = {};
addEventListener('keydown', (e) => {
  if (e.key.startsWith('Arrow')) { keys[e.key] = true; e.preventDefault(); $('hint').style.display = 'none'; }
});
addEventListener('keyup', (e) => { if (e.key.startsWith('Arrow')) keys[e.key] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

const camPos = new THREE.Vector3(0, 16, 10);
let camYaw = 0;

function tick(dt) {
  dt = Math.min(dt, 0.05);
  const steer = (keys.ArrowLeft ? 1 : 0) - (keys.ArrowRight ? 1 : 0);
  const climb = (keys.ArrowUp ? 1 : 0) - (keys.ArrowDown ? 1 : 0);

  // yaw rate eases toward the input; with no input the heading relaxes back toward straight ahead
  const targetRate = steer * 0.9 - (steer === 0 ? P.yaw * 0.8 : 0);
  P.rate += (targetRate - P.rate) * Math.min(1, dt * 4);
  P.yaw = THREE.MathUtils.clamp(P.yaw + P.rate * dt, -0.9, 0.9);
  P.roll += (steer * 0.7 + P.rate * 0.3 - P.roll) * Math.min(1, dt * 5);
  P.vy += (climb * 9 - P.vy) * Math.min(1, dt * 3.5);
  P.pitch += (climb * 0.3 - P.pitch) * Math.min(1, dt * 4);

  P.x += -Math.sin(P.yaw) * SPEED * dt;
  const prevZ = P.z;
  P.z += -Math.cos(P.yaw) * SPEED * dt;
  P.y += P.vy * dt;

  const gh = terrainH(P.x, P.z);
  const floor = gh + 1.4, ceil = 26;
  if (P.y < floor) { P.y = floor; P.vy = Math.max(P.vy, 0); }
  if (P.y > ceil) { P.y = ceil; P.vy = Math.min(P.vy, 0); }

  plane.position.set(P.x, P.y, P.z);
  plane.rotation.set(P.pitch, P.yaw, 0, 'YXZ');
  body.rotation.z = P.roll;

  shadow.position.set(P.x, gh + 0.08, P.z);
  shadow.scale.setScalar(THREE.MathUtils.clamp(1.2 - (P.y - gh) * 0.03, 0.5, 1.2));

  // rings
  while (rings.length < 9) spawnRing();
  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i], rp = r.mesh.position;
    if (r.state === 'live' && prevZ > rp.z && P.z <= rp.z) {
      const hit = Math.hypot(P.x - rp.x, P.y - rp.y) < RING_R + 0.25;
      r.state = hit ? 'hit' : 'miss';
      if (hit) { score++; $('scoreVal').textContent = score; }
      else { r.mat.color.set(0x7a5a54); r.mat.emissive.set(0x1a1210); }
    }
    if (r.state === 'hit') {
      r.t += dt;
      r.mat.color.set(0x5fe58a); r.mat.emissive.set(0x136a30);
      r.mesh.scale.setScalar(1 + r.t * 1.6);
      r.mat.transparent = true; r.mat.opacity = Math.max(0, 1 - r.t * 1.8);
      if (r.t > 0.6) { scene.remove(r.mesh); r.mat.dispose(); rings.splice(i, 1); continue; }
    }
    if (rp.z > P.z + 25) { scene.remove(r.mesh); r.mat.dispose(); rings.splice(i, 1); }
  }

  // terrain follows the plane, snapped to the vertex grid so the surface never "swims"
  const sx = Math.round(P.x / CELL) * CELL, sz = Math.round(P.z / CELL) * CELL;
  terrain.position.set(sx, 0, sz);
  tOff.value.set(sx, sz);
  mountains.forEach(({ mesh, follow }) => mesh.position.set(P.x * follow, 0, P.z * follow));
  sky.position.set(P.x, 0, P.z);

  for (const c of clouds) {
    const d = c.userData;
    // wrap every cloud into an 800-unit window around the player
    const cz = d.oz - Math.floor((d.oz - P.z + 600) / 800) * 800;
    const cx = d.ox - Math.floor((d.ox - P.x + 400) / 800) * 800;
    c.position.set(cx, d.y, cz);
  }

  // chase camera: smooth heading follow (the stereo rig is attached, so it adds no lag)
  camYaw += (P.yaw - camYaw) * Math.min(1, dt * 2.5);
  camPos.x += (P.x + Math.sin(camYaw) * 10 - camPos.x) * Math.min(1, dt * 6);
  camPos.z += (P.z + Math.cos(camYaw) * 10 - camPos.z) * Math.min(1, dt * 6);
  camPos.y += (P.y + 2.4 - camPos.y) * Math.min(1, dt * 3);
  const camGround = terrainH(camPos.x, camPos.z) + 2.0;
  if (camPos.y < camGround) camPos.y = camGround;
  appCam.position.copy(camPos);
  appCam.lookAt(P.x - Math.sin(camYaw) * 8, P.y + 0.6, P.z - Math.cos(camYaw) * 8);
}

// ---- sizing ----------------------------------------------------------------------------------------------
let sbs = false;
function sizeToCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round((canvas.clientWidth || innerWidth) * dpr);
  const h = Math.round((canvas.clientHeight || innerHeight) * dpr);
  const bufW = sbs ? w * 2 : w;
  appCam.aspect = w / h;
  appCam.updateProjectionMatrix();
  if (canvas.width === bufW && canvas.height === h) return;   // setSize clears even if unchanged
  renderer.setSize(bufW, h, false);
}
addEventListener('resize', sizeToCanvas);
sizeToCanvas();

// ---- stereo frame -------------------------------------------------------------------------------------------
const clock = new THREE.Clock();
const rigScratch = {};
let handle = null;
const good = [0, 1].map(() => ({ proj: new Float32Array(16), pose: new Float32Array(16), x: 0, y: 0, width: 0, height: 0 }));
let haveGood = false;

// A frame that cannot draw stereo repaints the last good one (never leave the canvas undrawn).
function drawGood() {
  renderer.clear();
  if (!haveGood) return;
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
  tick(clock.getDelta());
  // Fixed convergence for the whole game; pushed before the validation gate (drives the NEXT locate).
  handle.setViewRig(cameraRigFromCamera(THREE, appCam, {
    convergence: CONV, metersToVirtual: M2V, attach: true, out: rigScratch,
  }));
  if (!views || views.length < 2 || !layer) return drawGood();
  const vps = views.map((v) => layer.getViewport(v));
  if (vps.some((vp) => !vp || vp.width <= 0 || vp.height <= 0)) return drawGood();

  renderer.clear();
  renderer.setScissorTest(true);
  for (let i = 0; i < 2; i++) {
    const vp = vps[i], g = good[i];
    renderer.setViewport(vp.x, vp.y, vp.width, vp.height);
    renderer.setScissor(vp.x, vp.y, vp.width, vp.height);
    eyes[i].setLocalFromView(views[i]);
    renderer.render(scene, eyes[i].camera);
    g.proj.set(views[i].projectionMatrix); g.pose.set(views[i].transform.matrix);
    g.x = vp.x; g.y = vp.y; g.width = vp.width; g.height = vp.height;
  }
  renderer.setScissorTest(false);
  haveGood = true;
}

// ---- 2D fallback ------------------------------------------------------------------------------------------------
function monoLoop() {
  requestAnimationFrame(monoLoop);
  tick(clock.getDelta());
  renderer.clear();
  renderer.setViewport(0, 0, canvas.width, canvas.height);
  renderer.render(scene, appCam);
}

// ---- boot --------------------------------------------------------------------------------------------------------------
const removeCover = () => { const c = $('cover'); if (c) c.remove(); };
setTimeout(removeCover, 4500);      // the cover must always come off

(async () => {
  let wall = null;
  try { wall = await createInline3D({ lazy: false, autoChrome: false }); } catch (e) { console.warn(e); }
  if (!wall || !wall.supported) {
    $('mode').textContent = '2D mode';
    requestAnimationFrame(() => { monoLoop(); removeCover(); });
    return;
  }
  try {
    sbs = true;
    sizeToCanvas();
    try { wall.session.updateRenderState({ depthNear: NEAR, depthFar: FAR }); } catch (e) { console.warn(e); }
    for (const id of ['score', 'mode', 'hint']) wall.addGlobalOverlay($(id));
    handle = wall.addScene(canvas, onFrame, {
      viewRig: cameraRigFromCamera(THREE, appCam, { convergence: CONV, metersToVirtual: M2V, attach: true }),
    });
    $('mode').textContent = '3D mode';
    handle.firstWoven.then(removeCover);
  } catch (e) {
    console.error(e);
    sbs = false; sizeToCanvas();
    $('mode').textContent = '2D mode';
    monoLoop(); removeCover();
  }
})();
