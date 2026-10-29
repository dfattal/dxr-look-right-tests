// Solar system: an animated three.js tabletop scene for the DisplayXR inline-3D SDK.
//
// Rig: a DISPLAY rig (the SDK default, made explicit). The canvas is a portal onto a virtual display
// VDH metres tall. The solar system is a subject the viewer looks at, not a world they move through,
// so there is no camera to hand over and no convergence to choose. The sun sits on the
// zero-disparity plane (z = 0). The orbit plane leans toward the viewer, so the planets are the only
// things with depth. Everything is authored in metres and the views are rendered as the runtime
// reports them, with no per-frame scaling.
//
// With no inline-3D session (any ordinary browser) the same scene is drawn once, flat.

import * as THREE from 'three';
import { createInline3D } from '@displayxr/inline3d';
import { EyeCamera, displayRig } from '@displayxr/inline3d/three';

const TAU = Math.PI * 2;

// ---- depth and comfort (every value is explained in NOTES.md) ---------------------------------
const VDH = 0.24;                   // m: virtual display height. The SDK default; the system spans ~70% of it.
const EYE_DIST = 0.6;               // m: the runtime's nominal viewer distance from the glass (flat camera only).
const TILT = 0.44;                  // rad (~25°): the orbit plane leans toward the viewer. Planet depth ≈ orbit × sin(TILT).
const SWAY = 0.2;                   // rad: the whole system rocks slowly about its vertical axis (±11°).
const SWAY_PERIOD = 48;             // s
const STAR_DEPTH = [-0.35, -0.08];  // m: stars sit behind the glass, short of the far end where disparity grows.
const DEPTH_NEAR = 0.1;             // m: session clip planes. The scene is 0.5–0.95 m from the eye.
const DEPTH_FAR = 2;                // m
const BG = 0x1e222b;                // dark grey, not black: a bright edge on pure black doubles first.
const COVER_MAX_MS = 8000;          // safety: the cover always comes off, even if firstWoven never settles.

// ---- scene content (metres) -------------------------------------------------------------------
const PLANETS = [
  { orbit: 0.032, radius: 0.0035, period: 4, phase: 0.4, color: 0xb5aa9c },
  { orbit: 0.047, radius: 0.0055, period: 7, phase: 2.2, color: 0xe3b67a },
  { orbit: 0.063, radius: 0.006, period: 10, phase: 3.7, color: 0x4f8fe6,
    moon: { orbit: 0.0165, radius: 0.0019, period: 2.4 } },
  { orbit: 0.08, radius: 0.0045, period: 16, phase: 5.1, color: 0xd9663f },
];

const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('scene'), antialias: true,
  preserveDrawingBuffer: true });   // older DisplayXR builds can drop a frame without it
renderer.setPixelRatio(1);          // getViewport() is already in backing-store pixels
renderer.autoClear = false;         // one clear per frame, then one draw per eye
renderer.setClearColor(BG, 1);      // opaque: a transparent woven frame comes out black
renderer.xr.enabled = false;        // inline-3D does not go through three's XR manager

const canvas = renderer.domElement;
const statusEl = document.getElementById('status');
const coverEl = document.getElementById('cover');
const pauseBtn = document.getElementById('pause');

const gl = renderer.getContext();
// The largest buffer this GPU takes. A browser clamp is silent and skews the eye split, so we clamp first.
const MAX_BUF = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
  ...gl.getParameter(gl.MAX_VIEWPORT_DIMS));

const scene = new THREE.Scene();    // no scene.background: the clear colour is the background

const stars = starfield();
scene.add(stars);

// The orbit plane: tilt the subject, not a camera. Yaw is applied inside the tilt.
const tilt = new THREE.Group();
tilt.rotation.x = TILT;
scene.add(tilt);
const system = new THREE.Group();
tilt.add(system);

const sun = new THREE.Mesh(new THREE.SphereGeometry(0.018, 48, 32), new THREE.MeshBasicMaterial({ color: 0xffc94d }));
system.add(sun);
// decay 0: no falloff across a system this small, so every planet is lit the same whatever its orbit.
const sunLight = new THREE.PointLight(0xfff0d0, 2.2, 0, 0);
system.add(sunLight);
scene.add(new THREE.AmbientLight(0x7a86a6, 0.3));

const bodies = PLANETS.map((p) => {
  system.add(orbitRing(p.orbit));
  const pivot = new THREE.Group();          // turns the planet about the sun, in the orbit plane
  system.add(pivot);
  const body = new THREE.Mesh(new THREE.SphereGeometry(p.radius, 32, 20),
    new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.9 }));
  body.position.x = p.orbit;
  pivot.add(body);
  let moonPivot = null;
  if (p.moon) {
    body.add(orbitRing(p.moon.orbit));
    moonPivot = new THREE.Group();          // turns the moon about its planet
    body.add(moonPivot);
    const moon = new THREE.Mesh(new THREE.SphereGeometry(p.moon.radius, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0xbdbdbd, roughness: 1 }));
    moon.position.x = p.moon.orbit;
    moonPivot.add(moon);
  }
  return { ...p, pivot, moonPivot };
});

// The camera for the two eyes. Its matrices come from the views every frame; the scene is static
// under a fixed portal, so no attach pattern is needed.
const eye = new EyeCamera(THREE);
const flatCam = new THREE.PerspectiveCamera(THREE.MathUtils.radToDeg(2 * Math.atan(VDH / 2 / EYE_DIST)), 1, DEPTH_NEAR, DEPTH_FAR);
flatCam.position.set(0, 0, EYE_DIST);
flatCam.lookAt(0, 0, 0);

// The last good frame, as copies of the two eye matrices (a view is valid only inside its callback).
const good = [0, 1].map(() => ({ proj: new Float32Array(16), pose: new Float32Array(16) }));
let haveGood = false;

let sbs = false;                    // double-width backing store while woven
let flat = false;                   // true once we are drawing the flat fallback
let t = 0, lastNow = 0, paused = false;

pauseBtn.addEventListener('click', () => {
  paused = !paused;
  pauseBtn.textContent = paused ? 'Resume' : 'Pause';
  pauseBtn.setAttribute('aria-pressed', String(paused));
});

// Size the backing store to the box: double-width while woven (left eye | right eye), 1:1 flat.
// setSize rewrites canvas.width/height, which clears the buffer even when nothing changed, so skip
// the call when the size is already right. Returns true when it changed.
function sizeStore() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round((canvas.clientWidth || 640) * dpr);
  const h = Math.round((canvas.clientHeight || 400) * dpr);
  const k = Math.min(1, MAX_BUF / (sbs ? 2 * w : w), MAX_BUF / h);
  const eyeW = Math.floor(w * k);
  const bufW = sbs ? 2 * eyeW : eyeW;
  const bufH = Math.floor(h * k);
  if (canvas.width === bufW && canvas.height === bufH) return false;
  renderer.setSize(bufW, bufH, false);   // false: the CSS box belongs to the layout, not to three
  flatCam.aspect = bufW / bufH;
  flatCam.updateProjectionMatrix();
  stars.material.size = 2 * dpr * k;
  return true;
}

// The left and right halves of the buffer, which is where the layer reports the two eyes.
function eyeRect(i) {
  const half = canvas.width / 2;
  return { x: i * half, y: 0, width: half, height: canvas.height };
}

function drawRect(r, camera) {
  renderer.setViewport(r.x, r.y, r.width, r.height);
  renderer.setScissor(r.x, r.y, r.width, r.height);
  renderer.render(scene, camera);
}

function advance() {
  const now = performance.now();
  if (lastNow && !paused) t += Math.min((now - lastNow) / 1000, 0.1);
  lastNow = now;
  animate(t);
}

function animate(time) {
  system.rotation.y = SWAY * Math.sin((time / SWAY_PERIOD) * TAU);
  for (const b of bodies) {
    b.pivot.rotation.z = b.phase + (time / b.period) * TAU;
    if (b.moonPivot) b.moonPivot.rotation.z = (time / b.moon.period) * TAU;
  }
}

// ---- inline-3D path: two eye viewports per frame -----------------------------------------------
function onFrame(views, layer) {
  advance();
  // Validate BEFORE clearing. A short view list or a null viewport means this frame cannot fill the
  // buffer, and a cleared buffer is what the weave would show. Repaint the last good frame instead.
  if (!views || views.length < 2 || !layer) return replayLastGood();
  const rects = [layer.getViewport(views[0]), layer.getViewport(views[1])];
  if (rects.some((r) => !r || r.width <= 0 || r.height <= 0)) return replayLastGood();

  renderer.clear();
  renderer.setScissorTest(true);
  for (let i = 0; i < 2; i++) {
    const view = views[i];
    eye.setFromView(view);
    drawRect(rects[i], eye.camera);
    good[i].proj.set(view.projectionMatrix);
    good[i].pose.set(view.transform.matrix);
  }
  renderer.setScissorTest(false);
  haveGood = true;
}

function replayLastGood() {
  renderer.clear();          // a cleared frame still counts: an undrawn canvas can drop out of the weave
  if (!haveGood) return;
  renderer.setScissorTest(true);
  for (let i = 0; i < 2; i++) {
    eye.setFromMatrices(good[i].proj, good[i].pose);
    drawRect(eyeRect(i), eye.camera);
  }
  renderer.setScissorTest(false);
}

// ---- flat path: an ordinary browser, or a window that lost its weave ---------------------------
function flatFrame() {
  requestAnimationFrame(flatFrame);
  sizeStore();
  advance();
  renderer.clear();
  drawRect({ x: 0, y: 0, width: canvas.width, height: canvas.height }, flatCam);
}

function goFlat() {
  if (flat) return;
  flat = true;
  sbs = false;
  sizeStore();
  uncover();
  statusEl.innerHTML = 'Flat view. Open this page in the <a href="https://github.com/DisplayXR/displayxr-browser">DisplayXR Browser</a> ' +
    'on a DisplayXR display for glasses-free 3D.';
  requestAnimationFrame(flatFrame);
}

// The cover comes off with a hard cut, never a fade. Also used by every failure path.
function uncover() {
  coverEl.hidden = true;
}

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

// ---- starfield and orbit helpers ---------------------------------------------------------------
function starfield() {
  const N = 420;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const z = THREE.MathUtils.lerp(STAR_DEPTH[0], STAR_DEPTH[1], Math.random());
    // The view widens with distance behind the glass, so scale the field to cover the frustum at z.
    const k = (EYE_DIST - z) / EYE_DIST;
    pos.set([(Math.random() * 2 - 1) * (VDH / 2) * k * 2.2,
             (Math.random() * 2 - 1) * (VDH / 2) * k * 1.4, z], i * 3);
    // Dim on purpose: bright points on black are the first thing to double on this panel.
    const b = 0.3 + Math.random() * 0.35;
    col.set([b, b, b * 1.1], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return new THREE.Points(geo, new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true }));
}

function orbitRing(r) {
  const pts = [];
  for (let i = 0; i <= 128; i++) {
    const a = (i / 128) * TAU;
    pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0));
  }
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x3b4558 }));
}

// ---- boot ---------------------------------------------------------------------------------------
(async function boot() {
  let wall;
  try {
    wall = await createInline3D({ lazy: false });
  } catch (err) {
    console.warn('inline-3D unavailable', err);
    wall = { supported: false };
  }
  if (!wall.supported) {
    goFlat();
    return;
  }
  try {
    // Give the canvas its final box and two frames before it asks to join the weave.
    await nextFrame();
    await nextFrame();
    sbs = true;
    sizeStore();
    try {
      wall.session.updateRenderState({ depthNear: DEPTH_NEAR, depthFar: DEPTH_FAR });
    } catch (err) {
      console.warn('could not set depth range', err);
    }
    const handle = wall.addScene(canvas, onFrame, {
      // The display rig, explicit. The values are the SDK's defaults, written out so each one is visible.
      viewRig: displayRig({ virtualDisplayHeight: VDH, ipdFactor: 1, parallaxFactor: 1, perspectiveFactor: 1 }),
      // Re-cover on a rect change (layout reflow, fullscreen). Matches the page, not the SDK's black.
      rectCover: { color: '#1e222b' },
      onResize: () => { if (sizeStore()) replayLastGood(); },
      onLayerLost: goFlat,
    });
    handle.firstWoven.then((result) => {
      if (result.woven) {
        statusEl.innerHTML = '<b>inline-3D active.</b> Move your head to look around.';
      } else {
        console.warn('scene not woven', result.reason);
      }
      uncover();
    });
    setTimeout(uncover, COVER_MAX_MS);   // safety net: never leave the page covered
  } catch (err) {
    console.error('inline-3D setup failed', err);
    uncover();
    goFlat();
  }
})();
