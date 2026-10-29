// Ring Flight: main. Renderer, chase camera, the inline-3D weave and the 2D fallback.
//
// The view is a CAMERA RIG. The user is somewhere in a world and moves through it, so the app's
// chase camera is the viewpoint: it is sent to the runtime as an identity-posed rig, and the two
// eye cameras hang off the app camera in the scene graph. Each frame's stereo therefore follows
// this frame's camera with no one-frame lag. See NOTES.md for every depth setting below.

import * as THREE from 'three';
import { FlightGame } from './game.js';
import { createWorld, groundHeight, SKY_HORIZON } from './world.js';

// ---- depth settings ----------------------------------------------------------------------------
const CONVERGENCE = 25;        // m, fixed for the whole flight: content at 25 m sits on the glass
const IPD_FACTOR = 1;          // absolute on a camera rig: 1 is a real 63 mm eye separation
const PARALLAX_FACTOR = 1;     // full head-tracking response
const METERS_TO_VIRTUAL = 1;   // the world is authored in metres
const VERTICAL_FOV = 55;       // degrees, three's convention (the rig converts to radians)
const DEPTH_NEAR = 0.5;        // m, the session's and the eye cameras' clip planes
const DEPTH_FAR = 4000;        // m, past the peaks (2.6 km) and the sky dome (3.5 km)

const CHASE_BACK = 13;         // m behind the plane
const CHASE_UP = 4.5;          // m above it
const CHASE_AHEAD = 30;        // m: the camera looks this far ahead of the plane

const canvas = document.getElementById('scene');
const coverEl = document.getElementById('cover');
const scoreEl = document.getElementById('score');
const statusEl = document.getElementById('status');

const KEY_MAP = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
const game = new FlightGame(groundHeight, onRing);
const world = createWorld(THREE, game);
const { scene } = world;

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,              // an alpha canvas weaves black where it is transparent
  preserveDrawingBuffer: true, // the weave reads the buffer while the next frame draws
});
renderer.setPixelRatio(1);   // getViewport() reports backing-store pixels; any other ratio scales each eye
renderer.autoClear = false;  // one clear per frame, then one viewport per eye
renderer.setClearColor(SKY_HORIZON);

const appCam = new THREE.PerspectiveCamera(VERTICAL_FOV, 16 / 9, DEPTH_NEAR, DEPTH_FAR);
scene.add(appCam);

let flat = false;            // true once the page is on the 2D path, for good
let sbs = false;             // true while the backing store is the two-eye side-by-side pair
let viewScale = 1;           // advisory per-view scale from the display (recommendedViewScale)
let panelMaxWidth = Infinity;

// ---- backing store -----------------------------------------------------------------------------
// Woven: twice the eye width, side by side, in device px. Mono: one view at device px. The CSS box
// is the same either way; the weave un-squeezes the pair. Returns true when the store changed.
function sizeBuffer() {
  const cssW = canvas.clientWidth || 640;
  const cssH = canvas.clientHeight || 360;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const gl = renderer.getContext();
  const vpDims = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
  const maxDim = Math.min(
    gl.getParameter(gl.MAX_TEXTURE_SIZE),
    gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
    vpDims[0],
    vpDims[1],
  );
  const views = sbs ? 2 : 1;
  const wantW = cssW * dpr * viewScale * views;
  const wantH = cssH * dpr * viewScale;
  // Clamp both axes by one factor, and keep the pair no wider than the panel. A browser clamps a
  // canvas silently, which reads as a double image.
  const f = Math.min(1, maxDim / wantW, maxDim / wantH, panelMaxWidth / wantW);
  const bw = Math.max(2, 2 * Math.floor((wantW * f) / 2));  // even, so each eye gets half
  const bh = Math.max(2, Math.floor(wantH * f));
  if (renderer.domElement.width === bw && renderer.domElement.height === bh) return false;
  renderer.setSize(bw, bh, false);
  appCam.aspect = cssW / cssH;
  appCam.updateProjectionMatrix();
  return true;
}

// ---- chase camera ------------------------------------------------------------------------------
const wantPos = new THREE.Vector3();
let chaseReady = false;
let lastT = performance.now();

function step(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  game.update(dt);

  const p = game.plane;
  const f = game.forward();
  wantPos.set(p.x - f.x * CHASE_BACK, p.y - f.y * CHASE_BACK + CHASE_UP, p.z - f.z * CHASE_BACK);
  wantPos.y = Math.max(wantPos.y, groundHeight(wantPos.x, wantPos.z) + 3);
  if (chaseReady) appCam.position.lerp(wantPos, 1 - Math.exp(-8 * dt));
  else appCam.position.copy(wantPos);
  chaseReady = true;
  appCam.lookAt(p.x + f.x * CHASE_AHEAD, p.y + f.y * CHASE_AHEAD, p.z + f.z * CHASE_AHEAD);

  world.update(dt, appCam.position);
}

function onRing(score) {
  scoreEl.textContent = String(score);
  scoreEl.classList.remove('pop');
  void scoreEl.offsetWidth; // restart the CSS animation
  scoreEl.classList.add('pop');
}

// ---- keyboard ----------------------------------------------------------------------------------
addEventListener('keydown', (e) => {
  const k = KEY_MAP[e.key];
  if (!k) return;
  game.keys[k] = true;
  e.preventDefault();
});
addEventListener('keyup', (e) => {
  const k = KEY_MAP[e.key];
  if (k) game.keys[k] = false;
});
addEventListener('blur', () => {
  for (const k of Object.keys(game.keys)) game.keys[k] = false;
});

// ---- cover -------------------------------------------------------------------------------------
// The cover hides the canvas until the browser has joined it to the weave (firstWoven), so a raw
// side-by-side pair never shows. It comes off on the join, on a fallback timer, and on any error.
function hideCover() {
  coverEl.hidden = true;
}

// ---- woven path --------------------------------------------------------------------------------
let eyes = null;
let haveGood = false;
// The last good frame, kept as copies: an XRView is only valid inside the callback that gave it.
const good = [0, 1].map(() => ({
  proj: new Float32Array(16), pose: new Float32Array(16), x: 0, y: 0, width: 0, height: 0, bw: 0, bh: 0,
}));

function onXRFrame(views, layer) {
  if (flat) return;
  step(performance.now());
  sizeBuffer();

  // Validate before clear(): clearing and then failing to draw leaves the empty buffer the weave
  // reads, which is a dark tile. A short view list is the runtime's mono fallback under load.
  if (!views || views.length < 2 || !layer) return replayLastGood();
  const vps = views.map((v) => layer.getViewport(v));
  if (vps.some((vp) => !vp || vp.width <= 0 || vp.height <= 0)) return replayLastGood();

  const bw = renderer.domElement.width, bh = renderer.domElement.height;
  renderer.clear();
  renderer.setScissorTest(true);
  for (let i = 0; i < 2; i++) {
    const vp = vps[i];
    renderer.setViewport(vp.x, vp.y, vp.width, vp.height);
    renderer.setScissor(vp.x, vp.y, vp.width, vp.height);
    // LOCAL pose: the eye hangs off appCam, so the eye's world pose comes from this frame's camera.
    eyes[i].setLocalFromView(views[i]);
    renderer.render(scene, eyes[i].camera);
    const g = good[i];
    g.proj.set(views[i].projectionMatrix);
    g.pose.set(views[i].transform.matrix);
    g.x = vp.x; g.y = vp.y; g.width = vp.width; g.height = vp.height;
    g.bw = bw; g.bh = bh;
  }
  renderer.setScissorTest(false);
  haveGood = true;
}

// Repaint the last good frame rather than skipping: a canvas that is not redrawn can drop out of
// the aggregated frame and smear. Before the first good frame, a cleared frame is still presented.
function replayLastGood() {
  renderer.clear();
  if (!haveGood) return;
  const bw = renderer.domElement.width, bh = renderer.domElement.height;
  renderer.setScissorTest(true);
  for (let i = 0; i < 2; i++) {
    const g = good[i];
    // The buffer may have been reallocated since the last good frame, so scale its viewport.
    const sx = bw / g.bw, sy = bh / g.bh;
    const x = Math.round(g.x * sx), y = Math.round(g.y * sy);
    const w = Math.round(g.width * sx), h = Math.round(g.height * sy);
    renderer.setViewport(x, y, w, h);
    renderer.setScissor(x, y, w, h);
    eyes[i].setLocalFromMatrices(g.proj, g.pose);
    renderer.render(scene, eyes[i].camera);
  }
  renderer.setScissorTest(false);
}

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

async function startWeave(core, helpers) {
  // This page's framing depends on the camera. Without setViewRig the runtime would weave a fixed
  // portal that ignores the chase camera, so the page stays 2D rather than show that.
  if (!core.inline3dViewRigSupported()) return false;
  const wall = await core.createInline3D({ lazy: false });
  if (!wall.supported) return false;

  const { EyeCamera, cameraRigFromCamera } = helpers;
  eyes = [new EyeCamera(THREE), new EyeCamera(THREE)];
  for (const eye of eyes) {
    eye.camera.near = DEPTH_NEAR;
    eye.camera.far = DEPTH_FAR;
    appCam.add(eye.camera);
  }
  try {
    wall.session.updateRenderState({ depthNear: DEPTH_NEAR, depthFar: DEPTH_FAR });
  } catch (err) {
    console.warn('[ring-flight] updateRenderState failed; the runtime keeps its default depth range', err);
  }

  sbs = true;
  sizeBuffer();
  // The display's advisory per-view scale and panel width. Not awaited: the call waits for the
  // window to go live, and the first frames should not wait for it.
  wall.getDisplayInfo().then((info) => {
    if (!info) return;
    viewScale = info.recommendedViewScaleX || 1;
    panelMaxWidth = info.displayPixelWidth || Infinity;
    sizeBuffer();
  }).catch(() => {});

  // Two frames before registering, so the canvas is settled for the browser's join.
  await nextFrame();
  await nextFrame();

  const handle = wall.addScene(canvas, onXRFrame, {
    viewRig: cameraRigFromCamera(THREE, appCam, {
      convergence: CONVERGENCE,
      attach: true,               // identity pose; the eyes carry the scene graph's pose
      ipdFactor: IPD_FACTOR,
      parallaxFactor: PARALLAX_FACTOR,
      metersToVirtual: METERS_TO_VIRTUAL,
    }),
    rectCover: { color: '#1c1e23' },  // the SDK's cover across a resize, in the page colour
    onResize: () => {
      if (!flat && sizeBuffer()) replayLastGood();
    },
    onLayerLost: goFlat,
  });

  handle.firstWoven.then(() => hideCover());
  setTimeout(hideCover, 8000);   // safety: the join settles within about 5 s, even when it is withheld

  statusEl.innerHTML = '<b class="ok">inline-3D active</b> · ←/→ bank and turn · ↑/↓ climb and dive';
  return true;
}

// ---- 2D path -----------------------------------------------------------------------------------
function monoFrame(now) {
  requestAnimationFrame(monoFrame);
  step(now);
  sizeBuffer();
  renderer.clear();
  renderer.render(scene, appCam);
}

function startMono() {
  flat = true;
  sbs = false;
  haveGood = false;
  sizeBuffer();
  hideCover();
  statusEl.innerHTML = '2D preview. Open this page in the <a href="https://github.com/DisplayXR/displayxr-browser">DisplayXR Browser</a> on a DisplayXR display for glasses-free 3D.';
  lastT = performance.now();
  requestAnimationFrame(monoFrame);
}

// The weave layer went away for good. Its buffer is now squeezed 2D, so resize it to 2D first.
function goFlat() {
  if (flat) return;
  startMono();
}

// ---- boot --------------------------------------------------------------------------------------
async function boot() {
  sizeBuffer();   // the backing store is sized before anything registers with the browser
  let woven = false;
  try {
    const [core, helpers] = await Promise.all([
      import('@displayxr/inline3d'),
      import('@displayxr/inline3d/three'),
    ]);
    woven = await startWeave(core, helpers);
  } catch (err) {
    console.warn('[ring-flight] inline-3D failed; running 2D', err);
  }
  if (!woven) startMono();
}

boot();
