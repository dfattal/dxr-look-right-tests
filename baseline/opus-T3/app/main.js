// main.js — first-person walk-through of a small room, woven as glasses-free 3D in the DisplayXR
// Browser and drawn as a normal three.js page everywhere else.
//
// Rig choice: the user IS somewhere and moves, so this is a CAMERA rig (docs/authoring-inline-3d.md
// "Which rig"). The page sends its own camera's vertical FOV + a convergence distance every frame;
// the runtime offsets the eyes and skews the frusta. No projection math lives here.
//
// Lag: the camera follows the mouse, so we use the ATTACH pattern — an identity-posed rig, eye
// cameras parented under the app camera, `setLocalFromView` — so three composes THIS frame's pose
// instead of the rig's one-frame-old one.
//
// Depth: the scene is in metres, so a camera rig at ipdFactor 1 is the viewer's real eye
// separation. A room puts surfaces very close to the camera, though, and real-scale stereo at a
// fixed convergence would throw a nearby wall or chair far out of the glass (double images on a
// lenticular panel). So a small "depth fitter" samples the view's depth range a few times a second
// and, slowly eased, (1) places convergence where the range fits the display's budget best and
// (2) lowers ipdFactor only when even that cannot fit. See NOTES.md for the numbers.

import * as THREE from 'three';
import { createInline3D, inline3dViewRigSupported } from '@displayxr/inline3d';
import { EyeCamera, cameraRigFromCamera } from '@displayxr/inline3d/three';
import { buildRoom, ROOM } from './room.js';

const canvas = document.getElementById('stage');
const helpEl = document.getElementById('help');
const startEl = document.getElementById('start');
const statusEl = document.getElementById('status');
const debugEl = document.getElementById('debug');
const coverEl = document.getElementById('cover');
const DEBUG = new URLSearchParams(location.search).has('debug');
if (DEBUG) debugEl.style.display = 'block';

// ---- renderer ----------------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
// pixelRatio MUST be 1: layer.getViewport() is in backing-store pixels and three would multiply it.
// We size the backing store in device pixels ourselves (sizeCanvas).
renderer.setPixelRatio(1);
renderer.autoClear = false;           // one clear per frame, then one viewport per eye
renderer.xr.enabled = false;          // inline-3d never goes through three's XR manager
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// The room is static: render the shadow maps ONCE. Left on auto they would re-render on every
// renderer.render() call, i.e. twice a frame in stereo, for nothing.
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;

const { scene, colliders, depthTargets } = buildRoom(renderer);

// ---- the app camera (the one the camera rig perturbs) -----------------------------------------
const FOV = 55;                       // degrees, full vertical angle
const NEAR = 0.05, FAR = 80;
const EYE_HEIGHT = 1.6;
const appCam = new THREE.PerspectiveCamera(FOV, 16 / 9, NEAR, FAR);
appCam.rotation.order = 'YXZ';
scene.add(appCam);                    // IN the scene: parented eye cameras need a traversal

const RIG_OK = inline3dViewRigSupported();
// Eye cameras, parented (attach pattern). On a browser WITHOUT setViewRig the runtime keeps its
// default display rig (canvas plane at z = 0, eyes ~0.6 m in front of it); we then hang the eyes
// off an anchor pushed forward by the reported eye distance, so the eye still lands on the walker.
const eyes = [new EyeCamera(THREE), new EyeCamera(THREE)];
const fallbackAnchor = new THREE.Object3D();
appCam.add(fallbackAnchor);
for (const e of eyes) {
  (RIG_OK ? appCam : fallbackAnchor).add(e.camera);
  e.camera.near = NEAR; e.camera.far = FAR;     // scalars only; NEVER updateProjectionMatrix()
}

// ---- walker state ------------------------------------------------------------------------------
const P = { x: 0.75, z: 1.95, yaw: 0.12, pitch: -0.1, vx: 0, vz: 0 };
const RADIUS = 0.32;                  // keeps the eye ~a third of a metre off any surface
const WALK = 1.35, RUN = 2.6;         // m/s; gentle, since fast translation is tiring in stereo
const keys = new Set();

function placeCamera() {
  appCam.position.set(P.x, EYE_HEIGHT, P.z);
  appCam.rotation.set(P.pitch, P.yaw, 0);
}

function collide() {
  for (let pass = 0; pass < 2; pass++) {
    P.x = Math.min(ROOM.maxX - RADIUS, Math.max(ROOM.minX + RADIUS, P.x));
    P.z = Math.min(ROOM.maxZ - RADIUS, Math.max(ROOM.minZ + RADIUS, P.z));
    for (const b of colliders) {
      const cx = Math.min(b.maxX, Math.max(b.minX, P.x));
      const cz = Math.min(b.maxZ, Math.max(b.minZ, P.z));
      let dx = P.x - cx, dz = P.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= RADIUS * RADIUS) continue;
      if (d2 > 1e-10) {
        const d = Math.sqrt(d2), push = (RADIUS - d) / d;
        P.x += dx * push; P.z += dz * push;
      } else {               // centre inside the box: leave along the shallowest side
        const pen = [P.x - b.minX, b.maxX - P.x, P.z - b.minZ, b.maxZ - P.z];
        const i = pen.indexOf(Math.min(...pen));
        if (i === 0) P.x = b.minX - RADIUS; else if (i === 1) P.x = b.maxX + RADIUS;
        else if (i === 2) P.z = b.minZ - RADIUS; else P.z = b.maxZ + RADIUS;
      }
    }
  }
}

function update(dt) {
  let f = 0, s = 0, turn = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) f += 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) f -= 1;
  if (keys.has('KeyD')) s += 1;
  if (keys.has('KeyA')) s -= 1;
  if (keys.has('ArrowLeft')) turn += 1;
  if (keys.has('ArrowRight')) turn -= 1;
  P.yaw += turn * 1.6 * dt;
  const len = Math.hypot(f, s) || 1;
  const speed = (keys.has('ShiftLeft') || keys.has('ShiftRight')) ? RUN : WALK;
  const sin = Math.sin(P.yaw), cos = Math.cos(P.yaw);
  // camera looks down -z at yaw 0: forward = (-sin, -cos), right = (cos, -sin)
  const tx = ((-sin * f) + (cos * s)) / len * speed;
  const tz = ((-cos * f) + (-sin * s)) / len * speed;
  const k = 1 - Math.exp(-dt * 9);    // eased start/stop: no jerks through the stereo
  P.vx += (tx - P.vx) * k; P.vz += (tz - P.vz) * k;
  P.x += P.vx * dt; P.z += P.vz * dt;
  collide();
  placeCamera();
}

// ---- mouse look: drag always works; a click asks for pointer lock -----------------------------
// Pointer Lock over a woven canvas is unverified on hardware (porting guide §7), so drag-look is
// the guaranteed path and the lock is a convenience on top.
const SENS = 0.0022;
let drag = null;
const locked = () => document.pointerLockElement === canvas;
function look(dx, dy) {
  P.yaw -= dx * SENS;
  P.pitch = Math.max(-1.35, Math.min(1.35, P.pitch - dy * SENS));
  if (startEl.style.display !== 'none') startEl.style.display = 'none';
}
canvas.addEventListener('pointerdown', (e) => {
  canvas.focus();
  if (locked()) return;
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (locked()) { look(e.movementX, e.movementY); return; }
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
  look(dx, dy);
});
function endDrag(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const click = drag.moved < 4 && e.type === 'pointerup' && e.pointerType === 'mouse';
  drag = null;
  if (click && canvas.requestPointerLock) {
    try {
      const p = canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch { /* drag-look still works */ }
    look(0, 0);
  }
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

// ---- keyboard ----------------------------------------------------------------------------------
const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);
addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (MOVE_KEYS.has(e.code)) {
    keys.add(e.code);
    if (e.code.startsWith('Arrow')) e.preventDefault();
    if (e.code !== 'ShiftLeft' && e.code !== 'ShiftRight') startEl.style.display = 'none';
    return;
  }
  if (e.repeat) return;
  if (e.code === 'KeyH') helpEl.style.display = helpEl.style.display === 'none' ? '' : 'none';
  if (e.code === 'Minus' || e.code === 'NumpadSubtract') setUserDepth(-1);
  if (e.code === 'Equal' || e.code === 'NumpadAdd') setUserDepth(+1);
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

// ---- depth fitter ------------------------------------------------------------------------------
// Screen parallax, as a fraction of the viewer's IPD, for content at view depth z on a camera rig
// (metersToVirtual 1, N = 0.5 m the runtime's nominal viewing distance):
//     p(z) = ipdFactor · N · (1/d − 1/z)        > 0 behind the glass, < 0 in front of it
// At z → ∞ this is exactly the runtime's comfort number (ipd × m2v × diopters × N). We bound it:
//     behind:  p(zFar)  ≤ BACK     in front:  −p(zNear) ≤ FRONT
// and choose the convergence diopters that let both bounds hold with the largest ipdFactor:
//     D* = (BACK·Dn + FRONT·Df) / (FRONT + BACK),   Dn = 1/zNear, Df = 1/zFar.
const N_VIEW = 0.5;
const DEPTH = {
  FRONT: 0.15,          // max crossed parallax: ~10 mm, ≈ 6–7 cm in front of the glass
  BACK: 0.25,           // max uncrossed parallax: ~16 mm, ≈ 17 cm behind it (the auto-3D shim's open-scene comfort)
  IPD_MAX: 1.0,         // never hyper-stereo: 1 = the viewer's real eye separation, room at true scale
  IPD_MIN: 0.15,
  CONV_MIN: 0.5,        // the runtime's comfort floor for ipd 1, m2v 1
  CONV_MAX: 3.0,
  CONV_TAU: 0.7,        // s — slow, so convergence never "breathes" with a sweep of the view
  IPD_TAU_DOWN: 0.15,   // s — fast when content comes too close (no double image)
  IPD_TAU_UP: 0.9,      // s — slow when it is safe again
};
const USER_STEPS = [0.5, 0.7, 0.85, 1.0, 1.2, 1.4];
let userStep = 3;
const depth = { D: 1 / 1.8, ipd: 0.8, zNear: 1.5, zFar: 6, sampledAt: -1, ramp: 0, rampStart: -1 };

const raycaster = new THREE.Raycaster();
raycaster.near = NEAR; raycaster.far = FAR;
const GX = 7, GY = 5;
const ndc = new THREE.Vector2(), fwd = new THREE.Vector3();
const samples = new Float32Array(GX * GY);

function sampleDepthRange() {
  appCam.getWorldDirection(fwd);
  let n = 0;
  for (let j = 0; j < GY; j++) for (let i = 0; i < GX; i++) {
    // a little inside the frame edge, which head-tracked eye frusta wander around
    ndc.set(-0.94 + (1.88 * i) / (GX - 1), -0.94 + (1.88 * j) / (GY - 1));
    raycaster.setFromCamera(ndc, appCam);
    const hit = raycaster.intersectObjects(depthTargets, false)[0];
    samples[n++] = hit ? Math.max(NEAR, hit.distance * raycaster.ray.direction.dot(fwd)) : FAR;
  }
  let zn = Infinity, zf = 0;
  for (let k = 0; k < n; k++) { zn = Math.min(zn, samples[k]); zf = Math.max(zf, samples[k]); }
  depth.zNear = zn; depth.zFar = zf;
}

function ease(cur, target, dt, tau) { return cur + (target - cur) * (1 - Math.exp(-dt / tau)); }

function updateDepth(dt, frameNo) {
  if (frameNo - depth.sampledAt >= 4) { sampleDepthRange(); depth.sampledAt = frameNo; }
  const u = USER_STEPS[userStep];
  const F = DEPTH.FRONT * u, B = DEPTH.BACK * u;
  const Dn = 1 / depth.zNear, Df = 1 / depth.zFar;
  const Dstar = (B * Dn + F * Df) / (F + B);
  const Dt = Math.min(1 / DEPTH.CONV_MIN, Math.max(1 / DEPTH.CONV_MAX, Dstar));
  depth.D = ease(depth.D, Dt, dt, DEPTH.CONV_TAU);
  // ipd allowed by both bounds at the convergence actually in force this frame
  // "less depth" also lowers the cap; "more depth" only widens the budget (never hyper-stereo)
  let ipdT = DEPTH.IPD_MAX * Math.min(1, u);
  const front = N_VIEW * (Dn - depth.D), back = N_VIEW * (depth.D - Df);
  if (front > 1e-6) ipdT = Math.min(ipdT, F / front);
  if (back > 1e-6) ipdT = Math.min(ipdT, B / back);
  ipdT = Math.max(DEPTH.IPD_MIN, ipdT);
  depth.ipd = ease(depth.ipd, ipdT, dt, ipdT < depth.ipd ? DEPTH.IPD_TAU_DOWN : DEPTH.IPD_TAU_UP);
  // the fade-in after the first woven frame (stereo eases in instead of snapping on)
  if (depth.rampStart >= 0) {
    const t = Math.min(1, (performance.now() - depth.rampStart) / 700);
    depth.ramp = t * t * (3 - 2 * t);
  }
}

function setUserDepth(dir) {
  userStep = Math.max(0, Math.min(USER_STEPS.length - 1, userStep + dir));
  flashStatus(`depth ${Math.round(USER_STEPS[userStep] * 100)}%`);
}

// ---- backing store -----------------------------------------------------------------------------
let woven = false;
const gl = renderer.getContext();
const vpDims = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
const MAX_W = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), vpDims[0]);
const MAX_H = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), vpDims[1]);
const MAX_EYE_W = 2560;               // perf cap per eye; keeps renderScale ≥ ~0.6 on 4K panels

function sizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || innerWidth, cssH = canvas.clientHeight || innerHeight;
  const eyeW = Math.max(1, Math.round(cssW * dpr)), eyeH = Math.max(1, Math.round(cssH * dpr));
  const cols = woven ? 2 : 1;          // DOUBLE-WIDTH while woven (left | right), 1:1 in mono
  // one scale for both axes, so the SBS split stays at exactly 50% (device GL limits clamp silently)
  const s = Math.min(1, MAX_EYE_W / eyeW, MAX_W / (cols * eyeW), MAX_H / eyeH);
  const bufW = cols * Math.max(1, Math.floor(eyeW * s)), bufH = Math.max(1, Math.floor(eyeH * s));
  appCam.aspect = eyeW / eyeH;
  appCam.updateProjectionMatrix();
  const el = renderer.domElement;
  if (el.width === bufW && el.height === bufH) return false;   // setSize clears even a no-op
  renderer.setSize(bufW, bufH, false);
  if (woven) replayLastGood(); else renderMono();               // repaint NOW, not next frame
  return true;
}

// ---- rendering ---------------------------------------------------------------------------------
function renderMono() {
  const w = renderer.domElement.width, h = renderer.domElement.height;
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, w, h);
  renderer.clear();
  renderer.render(scene, appCam);
}

// Before the first good stereo frame: draw the mono camera into BOTH halves rather than a blank
// buffer (an undrawn canvas can drop out of the weave; a transparent one weaves black).
function renderMonoPair() {
  const w = renderer.domElement.width, h = renderer.domElement.height, half = Math.floor(w / 2);
  renderer.setViewport(0, 0, w, h);
  renderer.clear();
  renderer.setScissorTest(true);
  for (let i = 0; i < 2; i++) {
    renderer.setViewport(i * half, 0, half, h);
    renderer.setScissor(i * half, 0, half, h);
    renderer.render(scene, appCam);
  }
  renderer.setScissorTest(false);
}

const good = [0, 1].map(() => ({ proj: new Float32Array(16), pose: new Float32Array(16), x: 0, y: 0, width: 0, height: 0 }));
let haveGood = false;

function replayLastGood() {
  if (!haveGood) { renderMonoPair(); return; }
  renderer.clear();
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

// ---- frame loops -------------------------------------------------------------------------------
let last = performance.now(), frameNo = 0;
function step() {
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  frameNo++;
  update(dt);
  return dt;
}

function monoTick() {
  step();
  renderMono();
  if (DEBUG) debugEl.textContent = `2D · ${P.x.toFixed(2)}, ${P.z.toFixed(2)}`;
}

let handle = null, wall = null;
const rig = {};                       // reused descriptor: a per-frame rig allocates nothing

function currentRig() {
  const k = depth.ramp * depth.ipd;
  return cameraRigFromCamera(THREE, appCam, {
    attach: true,                     // identity pose; the scene graph supplies the world pose
    convergence: 1 / depth.D,         // world metres to the zero-disparity plane
    ipdFactor: k,
    parallaxFactor: k,                // look-around scales with the stereo (consistent geometry)
    out: rig,
  });
}

function onXRFrame(views, layer) {
  const dt = step();
  appCam.updateMatrixWorld(true);
  updateDepth(dt, frameNo);
  // Pushed BEFORE the gate: a rig drives the NEXT locate, so a frame that cannot draw must still
  // advance it.
  if (handle) handle.setViewRig(currentRig());

  // Validate EVERYTHING before clear(): a short view list or a null viewport must not empty the
  // buffer (that is a black blink). Replay the last good frame instead of skipping.
  if (!views || views.length < 2 || !layer) { replayLastGood(); return; }
  const vps = [layer.getViewport(views[0]), layer.getViewport(views[1])];
  if (vps.some((vp) => !vp || vp.width <= 0 || vp.height <= 0)) { replayLastGood(); return; }

  if (!RIG_OK) {
    // legacy display rig: put the eyes on the walker (anchor forward by the reported eye depth)
    const ez = (views[0].transform.matrix[14] + views[1].transform.matrix[14]) / 2;
    fallbackAnchor.position.z = -ez;
    fallbackAnchor.updateMatrixWorld(true);
  }

  renderer.clear();                   // the point of no return
  renderer.setScissorTest(true);
  for (let i = 0; i < 2; i++) {
    const vp = vps[i], g = good[i];
    renderer.setViewport(vp.x, vp.y, vp.width, vp.height);
    renderer.setScissor(vp.x, vp.y, vp.width, vp.height);
    eyes[i].setLocalFromView(views[i]);          // LOCAL: the eyes are parented (attach pattern)
    renderer.render(scene, eyes[i].camera);
    // copies, never the XRView (valid only inside this callback)
    g.proj.set(views[i].projectionMatrix); g.pose.set(views[i].transform.matrix);
    g.x = vp.x; g.y = vp.y; g.width = vp.width; g.height = vp.height;
  }
  renderer.setScissorTest(false);
  haveGood = true;

  if (DEBUG && frameNo % 10 === 0) {
    const st = handle && handle.stats ? handle.stats() : null;
    debugEl.textContent =
      `conv ${(1 / depth.D).toFixed(2)} m · ipd ${(depth.ipd * depth.ramp).toFixed(2)} · ` +
      `range ${depth.zNear.toFixed(2)}–${depth.zFar.toFixed(1)} m · comfort ${(depth.ipd * depth.ramp * depth.D * N_VIEW).toFixed(2)}` +
      (st ? ` · frames ${st.frames} mono ${st.monoFrames}` : '') + (RIG_OK ? '' : ' · NO setViewRig');
  }
}

// ---- status --------------------------------------------------------------------------------------
let baseStatus = { text: 'Starting…', cls: 'flat' };
let flashTimer = 0;
function setStatus(text, cls) {
  baseStatus = { text, cls };
  if (!flashTimer) { statusEl.textContent = text; statusEl.className = `hud ${cls}`; }
}
function flashStatus(text) {
  statusEl.textContent = text;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    flashTimer = 0;
    statusEl.textContent = baseStatus.text; statusEl.className = `hud ${baseStatus.cls}`;
  }, 1400);
}

function goMono(reason) {
  woven = false;
  sizeCanvas();
  renderer.setAnimationLoop(monoTick);
  coverEl.style.display = 'none';
  document.getElementById('depthKeyLabel').textContent = 'less / more depth (3D only)';
  setStatus(reason, 'flat');
}

// ---- boot ----------------------------------------------------------------------------------------
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

(async () => {
  placeCamera();
  appCam.updateMatrixWorld(true);
  addEventListener('resize', () => sizeCanvas());

  try {
    wall = await createInline3D({ lazy: false, autoChrome: false });
  } catch (err) {
    console.warn('[room] createInline3D failed', err);
    wall = { supported: false };
  }
  if (!wall.supported) { goMono('2D view — open in the DisplayXR Browser for glasses-free 3D'); return; }

  // Partial-rect HUD over the tile: needed on browsers without draw-order occlusion, ignored on
  // those with it. The full-tile cover is deliberately NOT registered (woven-canvas rules 5/8).
  for (const el of [helpEl, startEl, statusEl, debugEl]) wall.addGlobalOverlay(el);

  // Commit a settled double-width canvas before registering it (woven-canvas rules 4).
  woven = true;
  sizeCanvas();
  renderMonoPair();
  await nextFrame(); renderMonoPair();
  await nextFrame(); renderMonoPair();

  try { wall.session.updateRenderState({ depthNear: NEAR, depthFar: FAR }); } catch { /* next frame decides */ }

  sampleDepthRange();
  {
    const F = DEPTH.FRONT, B = DEPTH.BACK, Dn = 1 / depth.zNear, Df = 1 / depth.zFar;
    depth.D = Math.min(1 / DEPTH.CONV_MIN, Math.max(1 / DEPTH.CONV_MAX, (B * Dn + F * Df) / (F + B)));
  }
  handle = wall.addScene(canvas, onXRFrame, {
    virtualDisplayHeight: 0.24,       // what a browser without setViewRig uses (see NOTES.md)
    viewRig: currentRig(),            // the FIRST rig, so the first located frame is already ours
    rectCover: 'auto',                // cover the tile across a window resize until it re-weaves
    onResize: () => sizeCanvas(),
    onLayerLost: () => goMono('2D view — the 3D layer went away'),
  });

  wall.on('trackingstatechange', (state) => {
    if (!woven) return;
    if (state === 'searching') setStatus('Step in front of the display for 3D', 'warn');
    else setStatus('Glasses-free 3D', 'woven');
  });

  const res = await handle.firstWoven;
  if (!woven) return;                 // already dropped to 2D by onLayerLost
  coverEl.style.display = 'none';     // hard cut, never a fade
  depth.rampStart = performance.now();
  if (res.woven) setStatus(RIG_OK ? 'Glasses-free 3D' : 'Glasses-free 3D (legacy rig)', 'woven');
  else setStatus(`3D not confirmed (${res.reason})`, 'warn');
  if (DEBUG) console.log('[room] firstWoven', res, 'rig support', RIG_OK);
})();
