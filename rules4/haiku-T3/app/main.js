// First-person walk-through, on the DisplayXR inline-3D camera rig.
//
// The visitor IS somewhere and moves through the room, so this is a CAMERA rig: the app camera is
// the viewpoint (WASD walks it, the mouse looks), and the runtime perturbs its frustum per eye so
// the convergence distance sits on the glass. The eye cameras are parented under the app camera
// (the attach pattern), so the stereo follows the camera this frame instead of trailing it by one.
// Depth settings and why they are what they are: NOTES.md.

import * as THREE from 'three';
import { createInline3D, inline3dViewRigSupported } from '@displayxr/inline3d';
import { EyeCamera, cameraRigFromCamera } from '@displayxr/inline3d/three';
import { buildRoom, ROOM } from './room.js';

// ---- depth settings (NOTES.md) -------------------------------------------------------------------
// Both can be overridden from the URL to tune on a panel without editing: ?ipd=0.5&conv=2.5
const params = new URLSearchParams(location.search);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const numParam = (name, fallback) => {
  const v = parseFloat(params.get(name));
  return Number.isFinite(v) ? v : fallback;
};
const DEPTH = {
  // Eye separation, absolute on a camera rig: 1 = a real 63 mm IPD. Below 1 keeps the room's depth
  // budget inside what a 24 cm reference object gets, instead of ~2.7× it.
  ipdFactor: clamp(numParam('ipd', 0.6), 0, 1.5),
  // Metres to the zero-disparity plane. Fixed on purpose: it is a look-ahead, not the distance to
  // whatever the visitor is looking at, so the room does not breathe in depth as they turn.
  convergence: clamp(numParam('conv', 2.0), 0.5, 20),
};
const FOV_DEG = 60;          // vertical, full angle (three's convention)
const EYE_HEIGHT = 1.6;      // metres
const PLAYER_RADIUS = 0.3;   // metres; keeps the eye out of walls and furniture
const WALK_SPEED = 1.5;      // metres per second

// ---- DOM -----------------------------------------------------------------------------------------
const canvas = document.getElementById('stage');
const cover = document.getElementById('cover');
const statusEl = document.getElementById('status');
const hintEl = document.getElementById('hint');
const captureBtn = document.getElementById('capture');

// ---- renderer, scene, camera ---------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
// getViewport() reports backing-store pixels. A pixel ratio other than 1 scales each eye's viewport,
// which looks like a projection bug, so the backing store is sized in device pixels by resizeBacking().
renderer.setPixelRatio(1);
renderer.autoClear = false;                // cleared once per frame, after the views are validated
renderer.setClearColor(0x2a2c33, 1);       // dark grey, not black (making-3d-look-right, rule 3)

const scene = new THREE.Scene();
const { root, colliders } = buildRoom(THREE);
scene.add(root);

// The app camera is the viewpoint. It is IN the scene on purpose: the eye cameras are parented under
// it, and renderer.render() reaches a parented camera only through a scene traversal.
const camera = new THREE.PerspectiveCamera(FOV_DEG, 16 / 9, 0.05, 50);
camera.rotation.order = 'YXZ';             // yaw about world up, then pitch: a head, not a gimbal
scene.add(camera);

const eyes = [new EyeCamera(THREE), new EyeCamera(THREE)];
for (const eye of eyes) camera.add(eye.camera);

// ---- the visitor ----------------------------------------------------------------------------------
const player = { x: 0, z: 1.8, yaw: 0, pitch: 0 };   // yaw 0 faces the window, down the −z axis

const MOVE = { KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right' };
const held = new Set();
addEventListener('keydown', (e) => {
  if (!(e.code in MOVE)) return;
  held.add(e.code);
  e.preventDefault();   // stops the arrow keys scrolling the page
});
addEventListener('keyup', (e) => held.delete(e.code));
addEventListener('blur', () => held.clear());

const look = (dx, dy) => {
  player.yaw -= dx * 0.0035;
  player.pitch = clamp(player.pitch - dy * 0.0025, -1.2, 1.2);
};

// Drag to look. This always works, and it is the fallback Pointer Lock is not verified on a panel.
let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  drag = { x: e.clientX, y: e.clientY };
  canvas.setPointerCapture(e.pointerId);
  canvas.classList.add('dragging');
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  look(e.clientX - drag.x, e.clientY - drag.y);
  drag = { x: e.clientX, y: e.clientY };
});
const endDrag = () => {
  drag = null;
  canvas.classList.remove('dragging');
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

// Optional mouse-look with the cursor captured. Esc releases it (the browser does that).
captureBtn.addEventListener('click', () => {
  if (document.pointerLockElement === canvas) document.exitPointerLock();
  else Promise.resolve(canvas.requestPointerLock?.()).catch(() => {});
});
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  captureBtn.textContent = locked ? 'Release mouse (Esc)' : 'Capture mouse for mouse-look';
});
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === canvas) look(e.movementX, e.movementY);
});

// Walls and furniture are AABBs; the eye keeps PLAYER_RADIUS clear of all of them.
function isFree(x, z) {
  const r = PLAYER_RADIUS;
  if (Math.abs(x) > ROOM.halfW - r || Math.abs(z) > ROOM.halfD - r) return false;
  for (const c of colliders) {
    if (x > c.minX - r && x < c.maxX + r && z > c.minZ - r && z < c.maxZ + r) return false;
  }
  return true;
}

function update(dt) {
  const fwd = (held.has('KeyW') || held.has('ArrowUp') ? 1 : 0) - (held.has('KeyS') || held.has('ArrowDown') ? 1 : 0);
  const side = (held.has('KeyD') || held.has('ArrowRight') ? 1 : 0) - (held.has('KeyA') || held.has('ArrowLeft') ? 1 : 0);
  if (fwd || side) {
    const k = (WALK_SPEED * dt) / Math.hypot(fwd, side);
    const s = Math.sin(player.yaw);
    const c = Math.cos(player.yaw);
    // On the floor, forward is (−sin, −cos) and right is (cos, −sin) for this yaw.
    const dx = (-s * fwd + c * side) * k;
    const dz = (-c * fwd - s * side) * k;
    // Axis by axis, so the visitor slides along a wall instead of stopping dead against it.
    if (isFree(player.x + dx, player.z)) player.x += dx;
    if (isFree(player.x, player.z + dz)) player.z += dz;
  }
  camera.position.set(player.x, EYE_HEIGHT, player.z);
  camera.rotation.set(player.pitch, player.yaw, 0);
}

// ---- backing store --------------------------------------------------------------------------------
let woven = false;   // true while the canvas is an SBS (left | right) pair
let mono = false;    // true once the canvas has fallen back to a flat, 1:1 picture

// Backing store: double width while woven (left eye | right eye), 1:1 when flat. The CSS box is 16:9
// either way; the weave un-squeezes the SBS pair back onto it. A write of the SAME size clears the
// buffer, so the size is compared first and the buffer is only reallocated on a real change.
function resizeBacking() {
  if (!canvas.clientWidth || !canvas.clientHeight) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(canvas.clientWidth * dpr);
  const h = Math.round(canvas.clientHeight * dpr);
  const bufW = woven ? w * 2 : w;
  if (canvas.width === bufW && canvas.height === h) return;
  renderer.setSize(bufW, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

// ---- woven drawing --------------------------------------------------------------------------------
// The last good frame, as plain copies. An XRView is valid only inside the callback that delivered it,
// so the matrices are copied out, and the replay path draws from these copies.
const lastGood = { vps: null, mats: null };

function drawEyes(vps, mats) {
  renderer.clear();
  renderer.setScissorTest(true);
  for (let i = 0; i < 2; i++) {
    const vp = vps[i];
    renderer.setViewport(vp.x, vp.y, vp.width, vp.height);
    renderer.setScissor(vp.x, vp.y, vp.width, vp.height);
    // Attach pattern: the runtime's pose is in rig space (identity), and the parent supplies the world.
    eyes[i].setLocalFromMatrices(mats[i].proj, mats[i].xf);
    renderer.render(scene, eyes[i].camera);
  }
  renderer.setScissorTest(false);
}

function onXRFrame(views, layer) {
  if (mono) return;
  // Validate BEFORE clearing. An empty buffer is what the weave consumes, so a short view list
  // repaints the last good frame instead of blanking the window.
  const vps = views && views.length >= 2 && layer ? views.slice(0, 2).map((v) => layer.getViewport(v)) : null;
  if (!vps || vps.some((vp) => !vp || vp.width <= 0 || vp.height <= 0)) {
    if (lastGood.vps) drawEyes(lastGood.vps, lastGood.mats);
    return;
  }
  lastGood.vps = vps.map((vp) => ({ x: vp.x, y: vp.y, width: vp.width, height: vp.height }));
  lastGood.mats = views.slice(0, 2).map((v) => ({ proj: v.projectionMatrix.slice(), xf: v.transform.matrix.slice() }));
  drawEyes(lastGood.vps, lastGood.mats);
}

// Called by the SDK inside its ResizeObserver, when the CSS box or the DPR changes. Resize, then
// redraw the last frame at the new size. Otherwise the old buffer shows stretched for a frame.
function onResize() {
  resizeBacking();
  if (!lastGood.mats) return;
  // getViewport() splits the buffer in half: the left eye at x=0, the right eye at x=half.
  const half = canvas.width / 2;
  drawEyes(
    [
      { x: 0, y: 0, width: half, height: canvas.height },
      { x: half, y: 0, width: half, height: canvas.height },
    ],
    lastGood.mats,
  );
}

// ---- flat fallback --------------------------------------------------------------------------------
// The same room, flat, with the same walk and look. Used on any browser without the camera rig
// (rigs are the only way this walk-through is framed correctly), and whenever the window stops weaving.
function startFlat(message) {
  if (!mono) {
    mono = true;
    woven = false;
    resizeBacking();
  }
  uncover();
  setStatus('flat', message);
}

function drawFlat() {
  resizeBacking();
  renderer.clear();
  renderer.setViewport(0, 0, canvas.width, canvas.height);
  renderer.render(scene, camera);
}

// ---- status and cover -----------------------------------------------------------------------------
function setStatus(state, text) {
  statusEl.dataset.state = state;
  statusEl.textContent = text;
}

// The cover hides the canvas until the browser has joined it to the weave. Cut, never fade.
function uncover() {
  cover?.remove();
}

// ---- loop -----------------------------------------------------------------------------------------
// One rAF loop moves the visitor. It only draws in flat mode: woven frames come from the session.
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  update(dt);
  if (mono) drawFlat();
}

// ---- boot -----------------------------------------------------------------------------------------
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

async function boot() {
  // A browser without setViewRig would frame the room with its own display rig, and the visitor's
  // camera would go nowhere. So without the rig there is no stereo: the flat walk-through instead.
  if (!inline3dViewRigSupported()) {
    startFlat('Flat walk-through. Stereo needs the DisplayXR Browser on a DisplayXR display.');
    return;
  }

  let wall = null;
  try {
    wall = await createInline3D({ lazy: false });
  } catch (err) {
    console.warn('[walkthrough] inline-3D unavailable, running flat:', err);
  }
  if (!wall || !wall.supported) {
    startFlat('Flat walk-through. Open it in the DisplayXR Browser on a DisplayXR display for 3D.');
    return;
  }

  // The canvas goes SBS before it is registered, and is committed for two frames first.
  woven = true;
  resizeBacking();
  await nextFrame();
  await nextFrame();

  // The rig is set once. It is a constant camera (identity pose, fixed FOV, fixed convergence, fixed
  // IPD), so it never changes per frame; the attached eyes carry the camera's motion.
  const handle = wall.addScene(canvas, onXRFrame, {
    viewRig: cameraRigFromCamera(THREE, camera, {
      attach: true,
      convergence: DEPTH.convergence,
      ipdFactor: DEPTH.ipdFactor,
    }),
    onLayerLost: () => startFlat('Stereo stopped. Showing the flat walk-through.'),
    onResize,
  });

  // Tracking hint: a nudge only. On a MANAGED display the runtime already flattens the panel itself.
  wall.on('trackingstatechange', (state) => {
    hintEl.hidden = state !== 'searching';
  });

  setStatus('woven', 'Starting 3D…');
  handle.firstWoven.then((result) => {
    if (result.woven) {
      uncover();
      setStatus('woven', '3D active.');
    } else {
      startFlat('Stereo is unavailable on this window. Showing the flat walk-through.');
    }
  });
  // Never leave the page covered, even if the join signal is missed.
  setTimeout(uncover, 5000);
}

requestAnimationFrame(frame);
boot().catch((err) => {
  // Any failure after the canvas went SBS drops to the flat picture, so the page is never left blank.
  console.error('[walkthrough] failed to start, running flat:', err);
  startFlat('The 3D view failed to start. Showing the flat walk-through.');
});
