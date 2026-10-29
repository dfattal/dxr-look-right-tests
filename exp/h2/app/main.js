// main.js — boots the aquarium on the DisplayXR inline-3D session, with a flat fallback.
//
// The page owns one woven canvas for its whole life (never remounted). It is sized as a
// side-by-side store (two eyes, 2:1) before it is registered, covered until the first woven
// frame, and given the browser's replay and tracking-ease helpers so a short frame or a
// tracking glitch never shows as a black blink or a jump.

import * as THREE from 'three';
import { createInline3D, ViewerEase, frameTrackingState } from '@displayxr/inline3d';
import { EyeCamera } from '@displayxr/inline3d/three';
import { buildAquarium, BG } from './aquarium.js';

// ---- depth settings (reasons in NOTES.md) ---------------------------------------------------
const VIRTUAL_DISPLAY_M = 0.24; // display rig: the glass plane spans a 24 cm virtual display
const VIEWER_DISTANCE_M = 0.6; // the runtime's nominal eye distance; used only by the flat view
const FLAT_FOV_DEG = (2 * Math.atan(VIRTUAL_DISPLAY_M / 2 / VIEWER_DISTANCE_M) * 180) / Math.PI;

// ---- store sizing ---------------------------------------------------------------------------
const MAX_DPR = 2;
const MAX_EYE_PX = 1280; // per eye, so the side-by-side store stays at most 2560 px wide
const COVER_CAP_MS = 8000; // the cover always comes off, even if the browser never signals

const HINTS = {
  tracking: 'Move your head to look around the tank.',
  searching: 'Step into view to see the tank in depth.',
};

const canvas = document.getElementById('tank');
const cover = document.getElementById('cover');
const statusEl = document.getElementById('status');

const now = () => performance.now() / 1000;
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

// ---- renderer and scene ----------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
// The store is sized by sizeStore(). A pixel ratio other than 1 would scale three's viewports.
renderer.setPixelRatio(1);
renderer.autoClear = false; // we clear once per frame, then draw each eye into its half
renderer.setClearColor(BG, 1); // opaque: a transparent woven frame weaves black on the panel

const gl = renderer.getContext();
const [vpMaxW, vpMaxH] = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
const maxW = Math.min(renderer.capabilities.maxTextureSize, vpMaxW);
const maxH = Math.min(renderer.capabilities.maxTextureSize, vpMaxH);

const { scene, update } = buildAquarium(THREE);
const eye = new EyeCamera(THREE);
const flatCam = new THREE.PerspectiveCamera(FLAT_FOV_DEG, 1, 0.01, 10);
flatCam.position.set(0, 0, VIEWER_DISTANCE_M);
flatCam.lookAt(0, 0, 0);

// `sbs` is true only while the canvas is woven: the store then holds two eyes side by side.
let sbs = false;
let handleRef = null;

// Size the backing store to the CSS box. A 1:1 box gets a 2:1 store while woven. Compare
// before writing: a same-size write reallocates the buffer and blanks it.
function sizeStore() {
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  const boxW = canvas.clientWidth * dpr;
  const boxH = canvas.clientHeight * dpr;
  if (!boxW || !boxH) return false;
  const eyeMax = sbs ? Math.min(MAX_EYE_PX, maxW / 2) : maxW;
  const k = Math.min(1, eyeMax / boxW, maxH / boxH);
  const eyeW = Math.round(boxW * k);
  const w = sbs ? eyeW * 2 : eyeW;
  const h = Math.round(boxH * k);
  if (canvas.width === w && canvas.height === h) return false;
  renderer.setSize(w, h, false); // false: the CSS box belongs to the page, not to the renderer
  flatCam.aspect = eyeW / h;
  flatCam.updateProjectionMatrix();
  return true;
}

function halves() {
  const hw = canvas.width / 2;
  return [
    { x: 0, y: 0, width: hw, height: canvas.height },
    { x: hw, y: 0, width: hw, height: canvas.height },
  ];
}

// One stereo frame: `eyes` supplies each eye's projection and pose, `vps` each eye's viewport.
function drawStereo(eyes, vps) {
  renderer.setScissorTest(false);
  renderer.clear();
  renderer.setScissorTest(true);
  for (let i = 0; i < 2; i++) {
    const vp = vps[i];
    renderer.setViewport(vp.x, vp.y, vp.width, vp.height);
    renderer.setScissor(vp.x, vp.y, vp.width, vp.height);
    eye.setFromMatrices(eyes[i].proj, eyes[i].pose);
    renderer.render(scene, eye.camera);
  }
  renderer.setScissorTest(false);
  if ((window.__n = (window.__n || 0) + 1) % 30 === 0) {
    const gl = renderer.getContext(); const W = canvas.width, H = canvas.height; const px = [];
    for (const fx of [0.1, 0.25, 0.4, 0.6, 0.75, 0.9]) { const b = new Uint8Array(4); gl.readPixels(Math.floor(W * fx), Math.floor(H / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, b); px.push(Array.from(b).join(',')); }
    const r = (a) => Array.from(a).map((v) => +v.toFixed(3));
    window.__dbg = { n: window.__n, W, H, px, vps: vps.map((v) => [v.x, v.y, v.width, v.height]), proj0: r(eyes[0].proj), pose0: r(eyes[0].pose), camPos: eye.camera.position.toArray().map((v) => +v.toFixed(3)), camQ: eye.camera.quaternion.toArray().map((v) => +v.toFixed(3)) };
  }
}

// A flat frame: the same scene from one centred camera, into each half (or the whole canvas
// when it is not woven). Used before the first good frame and on the plain-browser path.
function drawFlat() {
  renderer.setScissorTest(false);
  renderer.clear();
  const vps = sbs ? halves() : [{ x: 0, y: 0, width: canvas.width, height: canvas.height }];
  for (const vp of vps) {
    renderer.setViewport(vp.x, vp.y, vp.width, vp.height);
    renderer.render(scene, flatCam);
  }
}

// ---- the woven path --------------------------------------------------------------------------
// The SDK's tracking-acquisition glide. It eases the eyes when the viewer is acquired or lost,
// so the tank glides into place instead of snapping.
const ease = new ViewerEase();
const newEye = () => ({ proj: new Float32Array(16), pose: new Float32Array(16) });
const live = [newEye(), newEye()]; // this frame's eased copies
const last = [newEye(), newEye()]; // the last frame we drew, for replay
let haveLast = false;

function onXRFrame(views, layer, frame) {
  if (!sbs) return;
  update(now());
  const vps = views.length === 2 ? views.map((v) => layer.getViewport(v)) : null;
  if (vps && vps[0] && vps[1]) {
    views.forEach((v, i) => {
      live[i].proj.set(v.projectionMatrix);
      live[i].pose.set(v.transform.matrix);
    });
    ease.apply(live, frameTrackingState(frame));
    for (let i = 0; i < 2; i++) {
      last[i].proj.set(live[i].proj);
      last[i].pose.set(live[i].pose);
    }
    haveLast = true;
    drawStereo(live, vps);
  } else if (haveLast) {
    // A short view list or a null viewport: replay the last good frame. Never clear and skip,
    // because an empty buffer is what the weave reads.
    drawStereo(last, halves());
  } else {
    drawFlat();
  }
}

// addScene's onResize: the box or dpr changed. Resize the store and paint before the browser
// paints, so the old store is never shown stretched onto the new box.
function onStoreBox() {
  if (!sbs || !sizeStore()) return;
  if (haveLast) drawStereo(last, halves());
  else drawFlat();
}

// ---- the flat path (plain browsers, or a woven layer that was lost) ---------------------------
let flatRunning = false;
function startFlat() {
  if (flatRunning) return;
  flatRunning = true;
  const frame = () => {
    requestAnimationFrame(frame);
    sizeStore();
    update(now());
    drawFlat();
  };
  requestAnimationFrame(frame);
}

function goFlat(message) {
  handleRef = null;
  sbs = false;
  hideCover();
  sizeStore();
  statusEl.textContent = message;
  startFlat();
}

// ---- the cover: an opaque plate over the canvas until the first woven frame -------------------
function hideCover() {
  cover.hidden = true;
}

// ---- boot ------------------------------------------------------------------------------------
const HINT_DEFAULT = 'Five fish, one tank.';
function setHint(state) {
  statusEl.textContent = HINTS[state] || HINT_DEFAULT;
}

(async function boot() {
  try {
    const wall = await createInline3D({ lazy: false });
    if (!wall.supported) {
      goFlat('Flat view. Open this page in the DisplayXR Browser on a DisplayXR display for depth.');
      return;
    }

    // Size the store and let two frames pass before registering a fresh canvas. Registering
    // straight after a size change can show the raw side-by-side pair for a moment.
    sbs = true;
    sizeStore();
    await nextFrame();
    await nextFrame();

    const handle = wall.addScene(canvas, onXRFrame, {
      virtualDisplayHeight: VIRTUAL_DISPLAY_M,
      onResize: onStoreBox,
      onLayerLost: () => goFlat('Flat view. The depth layer stopped; the tank is still here.'),
    });
    handleRef = handle;

    setHint(wall.trackingState);
    wall.on('trackingstatechange', setHint);

    // Release the cover on the first woven frame. A cap guarantees it comes off regardless.
    const cap = setTimeout(hideCover, COVER_CAP_MS);
    handle.firstWoven.then(() => {
      clearTimeout(cap);
      hideCover();
    });
  } catch (err) {
    console.error('[aquarium] boot failed; showing the flat view', err);
    goFlat('Flat view.');
  }
})();

// A resize moves the woven rect, which needs the same cover-and-rewoven treatment as a fresh
// canvas. The cover goes up first, and comes off once the moved rect has woven again.
addEventListener('resize', () => {
  if (!handleRef || !sbs) return;
  cover.hidden = false;
  handleRef.rewoven().then(hideCover);
});
