// A room to walk through: a first-person walk on a CAMERA rig, built from samples/starter-world.
// Rules: /sdk/docs/making-3d-look-right.md. The numbers and why they are what they are: NOTES.md.
//
// RIG (guide §1): the visitor moves THROUGH a room, so a camera rig. The app owns its camera in
// metres (eye separation 63 mm); the runtime turns it into two eyes.
//
// SCREEN PLANE (§2): FIXED, FINITE convergence at the nearest content that touches a frame edge.
// The floor at the bottom edge of a level view is EYE_H / tan(fov/2) = 2.77 m ahead. We converge
// a little nearer (×0.9) so the floor, walls and ceiling at the edges sit just behind the glass.
// It never follows gaze or the cursor, and it is never 0 (infinity would float the room).
//
// COMFORT (§2, §4): the viewer keeps CLEAR metres from every wall and every furniture footprint, so
// nothing close enough to pop hard out of the glass can reach a frame edge. Walls and furniture
// get the same clearance because either one at the edge is the same problem.

import * as THREE from 'three';
import { createInline3D } from '@displayxr/inline3d';
import { EyeCamera, cameraRigFromCamera } from '@displayxr/inline3d/three';

const canvas = document.getElementById('room');
const cover = document.getElementById('cover');
const hud = document.getElementById('hud');
const depth = document.getElementById('depth');
const modeBtn = document.getElementById('mode');
const note = document.getElementById('note');

const FOV = 60;                       // full vertical angle, degrees
const EYE_H = 1.6;                    // eye height, metres
const CONVERGENCE = 0.9 * EYE_H / Math.tan(THREE.MathUtils.degToRad(FOV / 2)); // ≈ 2.49 m
const ROOM = { w: 6.4, h: 3.2, near: 1, far: -9 };  // x ∈ ±3.2, y ∈ [0, 3.2], z ∈ [−9, 1]
const CLEAR = 1.4;                    // metres the viewer keeps from walls and furniture (NOTES.md)
const WALK = {                        // where the viewer's eye may be
  x0: -ROOM.w / 2 + CLEAR, x1: ROOM.w / 2 - CLEAR,
  z0: ROOM.far + CLEAR, z1: ROOM.near - CLEAR,
};
const WALK_SPEED = 1.6;               // m/s
const LOOK = 0.004;                   // radians per pixel of mouse drag
const BG = 0x15171c;                  // == the page colour behind the canvas

// Window in the far wall: x ∈ [−0.8, 0.8], y ∈ [1.0, 2.4].
const WIN = { x0: -0.8, x1: 0.8, y0: 1.0, y1: 2.4 };

// ---- renderer + camera ----------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setClearColor(BG, 1);        // OPAQUE clear: a transparent pixel weaves as stale or black
renderer.setPixelRatio(1);            // the SDK sizes the canvas; sizeStore() does the rest
renderer.autoClear = false;
const gl = renderer.getContext();
const scene = new THREE.Scene();
// The app camera sits IN the scene: the eye cameras hang under it (the attach pattern), and three
// composes a parented camera's world matrix only through a scene traversal.
const cam = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.05, 30);
cam.position.set(0, EYE_H, -0.4);
scene.add(cam);

// ---- materials and helpers --------------------------------------------------------------------------
// Irregular, low-contrast texture with no repeating pattern: stereo matching needs detail to fuse.
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
function texture(base, { repeat = [1, 1], planks = 0, spots = 1200, contrast = 0.2, r = 8 } = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < planks; i++) {  // boards: a tone per board, a dark seam between
    g.fillStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,255,255'},${rnd() * 0.18})`;
    g.fillRect(0, (i * 256) / planks, 256, 256 / planks);
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fillRect(0, (i * 256) / planks, 256, 2);
  }
  for (let i = 0; i < spots; i++) {   // soft random blotches of every size
    g.fillStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,255,255'},${rnd() * contrast})`;
    g.beginPath();
    g.arc(rnd() * 256, rnd() * 256, 1 + rnd() * rnd() * r, 0, 7);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.anisotropy = 8;
  return t;
}
const mat = (base, o) => new THREE.MeshStandardMaterial({ map: texture(base, o), roughness: 0.85 });

// A flat rectangle at pos, facing along its normal (PlaneGeometry faces +z before rotation).
function panel(w, h, m, pos, rot) {
  const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
  p.position.set(...pos);
  p.rotation.set(...rot);
  scene.add(p);
  return p;
}
function box(w, h, d, x, y, z, m) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  b.position.set(x, y, z);
  scene.add(b);
  return b;
}
// Furniture footprints (x0, x1, z0, z1) in metres. The viewer keeps CLEAR away from each one.
const solids = [];
const solid = (x0, x1, z0, z1) => solids.push({ x0, x1, z0, z1 });

// Soft dark blob under a piece of furniture: a contact shadow, so the object sits on the floor.
const shadowMat = new THREE.MeshBasicMaterial({
  map: (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(0,0,0,0.5)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })(),
  transparent: true,
  depthWrite: false,
});
function contact(x, z, w, d) {
  const p = new THREE.Mesh(new THREE.PlaneGeometry(w, d), shadowMat);
  p.rotation.x = -Math.PI / 2;
  p.position.set(x, 0.008, z);
  scene.add(p);
}

// Soft mid-tone backdrop for the window: a pale sky, a few faint clouds, a low hill. No hard edges
// and little contrast, so the far end ghosts as little as possible.
function skyTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 384;
  const g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, 384);
  sky.addColorStop(0, '#9fbfdc');
  sky.addColorStop(1, '#dfe7d8');
  g.fillStyle = sky;
  g.fillRect(0, 0, 512, 384);
  g.fillStyle = 'rgba(255,255,255,0.18)';
  for (let i = 0; i < 14; i++) {
    g.beginPath();
    g.ellipse(rnd() * 512, 60 + rnd() * 140, 40 + rnd() * 60, 10 + rnd() * 12, 0, 0, 7);
    g.fill();
  }
  g.fillStyle = 'rgba(90,120,100,0.22)';
  g.beginPath();
  g.moveTo(0, 290);
  g.bezierCurveTo(160, 230, 330, 270, 512, 250);
  g.lineTo(512, 384);
  g.lineTo(0, 384);
  g.closePath();
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---- the room: floor, walls, a window in the far wall ----------------------------------------------
const { w: W, h: H, near: NZ, far: FZ } = ROOM;
const MZ = (NZ + FZ) / 2;             // room centre along z
const D = NZ - FZ;                    // room depth
panel(W, D, mat('#8a6a4a', { planks: 10, repeat: [2, 4], r: 4 }), [0, 0, MZ], [-Math.PI / 2, 0, 0]);  // floor
panel(W, D, mat('#d9d4c8', { repeat: [2, 3], contrast: 0.08 }), [0, H, MZ], [Math.PI / 2, 0, 0]);     // ceiling

const wallMat = mat('#b9a98f', { repeat: [2, 1], contrast: 0.12, spots: 3000, r: 5 });
panel(D, H, wallMat, [-W / 2, H / 2, MZ], [0, Math.PI / 2, 0]);     // left wall
panel(D, H, wallMat, [W / 2, H / 2, MZ], [0, -Math.PI / 2, 0]);     // right wall
panel(W, H, wallMat, [0, H / 2, NZ], [0, Math.PI, 0]);              // near wall (behind the start view)

// Far wall, cut around the window: four panels leave the opening.
const farMat = mat('#c4b59a', { repeat: [1, 1], contrast: 0.12, spots: 2500, r: 5 });
const farPiece = (x0, x1, y0, y1) => panel(x1 - x0, y1 - y0, farMat, [(x0 + x1) / 2, (y0 + y1) / 2, FZ], [0, 0, 0]);
farPiece(-W / 2, WIN.x0, 0, H);
farPiece(WIN.x1, W / 2, 0, H);
farPiece(WIN.x0, WIN.x1, WIN.y1, H);
farPiece(WIN.x0, WIN.x1, 0, WIN.y0);

// Window frame: thin wood around the opening, with a centre mullion.
const trim = mat('#6b4a2e', { planks: 6, contrast: 0.2 });
const fz = FZ + 0.04;
const wy = (WIN.y0 + WIN.y1) / 2, wh = WIN.y1 - WIN.y0;
box(0.08, wh + 0.16, 0.08, WIN.x0 - 0.04, wy, fz, trim);
box(0.08, wh + 0.16, 0.08, WIN.x1 + 0.04, wy, fz, trim);
box(WIN.x1 - WIN.x0 + 0.16, 0.08, 0.08, 0, WIN.y1 + 0.04, fz, trim);
box(WIN.x1 - WIN.x0 + 0.16, 0.08, 0.08, 0, WIN.y0 - 0.04, fz, trim);
box(0.05, wh, 0.05, 0, wy, fz, trim);

// What is seen through the window: a backdrop 10.5 m away. Behind the far wall (9 m), still well
// inside the far-background budget. Wide enough to cover the window from every walkable spot.
panel(8, 6, new THREE.MeshBasicMaterial({ map: skyTexture() }), [0, 1.5, FZ - 1.5], [0, 0, 0]);

// ---- furniture (each footprint is registered as a solid) --------------------------------------------
// Rug under the table.
panel(2.4, 1.8, mat('#7a2e2e', { spots: 900, contrast: 0.35 }), [-1.0, 0.005, -5.0], [-Math.PI / 2, 0, 0]);

// Dining table, two chairs at its ends.
const wood = mat('#6b4a2e', { planks: 6, contrast: 0.2 });
const TABLE = { x: -1.0, z: -5.0 };
box(1.2, 0.05, 0.7, TABLE.x, 0.74, TABLE.z, wood);
for (const [dx, dz] of [[-0.55, -0.3], [0.55, -0.3], [-0.55, 0.3], [0.55, 0.3]]) {
  box(0.05, 0.72, 0.05, TABLE.x + dx, 0.36, TABLE.z + dz, wood);
}
solid(TABLE.x - 0.6, TABLE.x + 0.6, TABLE.z - 0.35, TABLE.z + 0.35);

function chair(x, z, backDz) {         // backDz: the back rest sits on this side of the seat
  box(0.45, 0.05, 0.45, x, 0.46, z, wood);
  box(0.45, 0.5, 0.05, x, 0.72, z + backDz, wood);
  for (const [dx, dz] of [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]]) {
    box(0.04, 0.44, 0.04, x + dx, 0.22, z + dz, wood);
  }
  solid(x - 0.25, x + 0.25, z - 0.25, z + 0.25);
}
chair(TABLE.x, -4.0, +0.2);            // faces the table, back toward the viewer
chair(TABLE.x, -6.0, -0.2);            // faces the table, back away from it

// Sofa against the left wall.
const fabric = mat('#3d5a7a', { spots: 900, contrast: 0.3 });
box(0.9, 0.4, 1.8, -2.7, 0.2, -6.2, fabric);
box(0.6, 0.12, 1.8, -2.45, 0.46, -6.2, fabric);
box(0.25, 0.5, 1.8, -3.0, 0.65, -6.2, fabric);
solid(-3.15, -2.25, -7.1, -5.3);

// Bookcase on the far wall, left of the window, with coloured books.
box(1.6, 2.0, 0.35, -2.2, 1.0, FZ + 0.18, wood);
for (let row = 0; row < 4; row++) {
  for (let x = -0.72; x < 0.7; x += 0.05 + rnd() * 0.06) {
    const h = 0.3 + rnd() * 0.18;
    box(0.045, h, 0.25, -2.2 + x, 0.1 + row * 0.46 + h / 2, FZ + 0.23,
      new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(rnd(), 0.45, 0.25 + rnd() * 0.35) }));
  }
}
solid(-3.0, -1.4, FZ, FZ + 0.35);

// Floor lamp in the far-right corner: the pole is a solid, the shade is a warm light.
const brass = new THREE.MeshStandardMaterial({ color: 0x9a7b3c, roughness: 0.4, metalness: 0.6 });
box(0.3, 0.03, 0.3, 2.8, 0.015, -8.6, brass);
box(0.04, 1.6, 0.04, 2.8, 0.8, -8.6, brass);
solid(2.75, 2.85, -8.65, -8.55);
const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.22, 0.3, 24, 1, true),
  mat('#e8d9b0', { contrast: 0.1 }));
shade.material.side = THREE.DoubleSide;
shade.position.set(2.8, 1.7, -8.6);
scene.add(shade);

// Two paintings on the right wall.
panel(0.8, 1.2, mat('#3f6b4f', { spots: 1500, contrast: 0.5 }), [W / 2 - 0.01, 1.6, -3.0], [0, -Math.PI / 2, 0]);
panel(0.8, 1.2, mat('#a0663a', { spots: 1500, contrast: 0.5 }), [W / 2 - 0.01, 1.6, -6.0], [0, -Math.PI / 2, 0]);

// Contact shadows under the big pieces.
contact(TABLE.x, TABLE.z, 1.5, 1.0);
contact(TABLE.x, -4.0, 0.7, 0.7);
contact(TABLE.x, -6.0, 0.7, 0.7);
contact(-2.7, -6.2, 1.1, 2.0);
contact(-2.2, FZ + 0.4, 1.8, 0.6);

// ---- lights -----------------------------------------------------------------------------------------
const lampLight = new THREE.PointLight(0xffd9a0, 6, 8, 1.5);     // the floor lamp
lampLight.position.set(2.8, 1.65, -8.6);
scene.add(lampLight);
scene.add(new THREE.HemisphereLight(0xfff4e0, 0x403028, 1.4));  // soft room fill
const sun = new THREE.DirectionalLight(0xffffff, 0.8);          // daylight through the window
sun.position.set(0, 1.5, -12);
sun.target.position.set(0, 0.5, 0);
scene.add(sun, sun.target);

// ---- movement: WASD / arrows walk, drag looks; collision keeps CLEAR from walls and furniture ------
const keys = new Set();
const ARROWS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
addEventListener('keydown', (e) => { if (ARROWS.has(e.code)) e.preventDefault(); keys.add(e.code); });
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

let yaw = 0, pitch = 0, drag = null;
canvas.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY };
  canvas.setPointerCapture(e.pointerId);
});
const endDrag = () => { drag = null; };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  yaw -= (e.clientX - drag.x) * LOOK;
  pitch = Math.max(-1.0, Math.min(1.0, pitch - (e.clientY - drag.y) * LOOK));
  drag = { x: e.clientX, y: e.clientY };
});

// True if the viewer's eye may stand at (x, z): inside the walk area and CLEAR from every solid.
function free(x, z) {
  if (x < WALK.x0 || x > WALK.x1 || z < WALK.z0 || z > WALK.z1) return false;
  return solids.every((b) => x <= b.x0 - CLEAR || x >= b.x1 + CLEAR || z <= b.z0 - CLEAR || z >= b.z1 + CLEAR);
}

let lastT = 0;
function move(now) {
  const dt = lastT ? Math.min((now - lastT) / 1000, 0.1) : 0;
  lastT = now;
  const f = (keys.has('KeyW') || keys.has('ArrowUp')) - (keys.has('KeyS') || keys.has('ArrowDown'));
  const s = (keys.has('KeyD') || keys.has('ArrowRight')) - (keys.has('KeyA') || keys.has('ArrowLeft'));
  // Forward and strafe in the horizontal plane, normalised so a diagonal is not faster.
  const fx = -Math.sin(yaw) * f + Math.cos(yaw) * s;
  const fz = -Math.cos(yaw) * f - Math.sin(yaw) * s;
  const len = Math.hypot(fx, fz) || 1;
  const dx = (fx / len) * WALK_SPEED * dt;
  const dz = (fz / len) * WALK_SPEED * dt;
  const p = cam.position;
  // Slide: try each axis on its own, so a wall or a chair stops one direction, not both.
  if (free(p.x + dx, p.z)) p.x += dx;
  if (free(p.x, p.z + dz)) p.z += dz;
  cam.rotation.set(pitch, yaw, 0, 'YXZ');
}

// ---- view rig: camera rig, fixed convergence, one depth knob ---------------------------------------
// The rig is built from the app camera: convergence in metres, ipdFactor and parallaxFactor
// absolute on a camera rig (1 = 63 mm eye separation and full head-tracking response).
// attach: identity pose, so the eye cameras (parented under cam) supply this frame's pose.
const rig = (k) => cameraRigFromCamera(THREE, cam, {
  convergence: CONVERGENCE, attach: true, ipdFactor: k, parallaxFactor: k,
});

// ---- backing store: side by side when stereo, one flat view in 2D. Sized before registering, and
// afterwards only from onResize. Capped to the GL limits, so a large tile never gets silently clamped.
let sbs = false;                      // true: two eyes side by side in the store
function sizeStore(cssW = canvas.clientWidth, cssH = canvas.clientHeight, dpr = Math.min(devicePixelRatio || 1, 2)) {
  const maxDim = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
  let w = Math.max(1, Math.round(cssW * dpr));
  let h = Math.max(1, Math.round(cssH * dpr));
  const k = Math.min(1, maxDim / (sbs ? 2 * w : w), maxDim / h);
  w = Math.max(1, Math.floor(w * k));
  h = Math.max(1, Math.floor(h * k));
  renderer.setSize(sbs ? 2 * w : w, h, false);
  cam.aspect = w / h;
  cam.updateProjectionMatrix();
}

// ---- woven path: the attach pattern, drawn from the last GOOD frame ---------------------------------
const eyes = [new EyeCamera(THREE), new EyeCamera(THREE)];
for (const e of eyes) cam.add(e.camera);
let last = null;                      // copies of the views: an XRView is valid only in its own frame
let flat = false;                     // 2D mode: the display reports one view

function onXRFrame(views, layer) {
  move(performance.now());
  // Validate before anything is cleared. A short view list (the session under load) replays the
  // last good frame; a one-view list is the expected frame in 2D mode.
  const n = views.length;
  const ok = (n === 2 && sbs) || (n === 1 && !sbs);
  const vps = ok ? views.map((v) => layer.getViewport(v)) : null;
  if (vps && vps.every((vp) => vp && vp.width > 0 && vp.height > 0)) {
    last = views.map((v, i) => ({
      proj: Array.from(v.projectionMatrix),
      pose: Array.from(v.transform.matrix),
      vp: { x: vps[i].x, y: vps[i].y, width: vps[i].width, height: vps[i].height },
    }));
  }
  drawEyes();
}
function drawEyes() {
  if (!last) return;
  renderer.clear();
  renderer.setScissorTest(true);
  last.forEach((e, i) => {
    renderer.setViewport(e.vp.x, e.vp.y, e.vp.width, e.vp.height);
    renderer.setScissor(e.vp.x, e.vp.y, e.vp.width, e.vp.height);
    eyes[i].setLocalFromMatrices(e.proj, e.pose);   // this eye's pose, under cam
    renderer.render(scene, eyes[i].camera);
  });
  renderer.setScissorTest(false);
}
function onResize({ width, height, dpr }) {          // inside the SDK's observer, before paint
  sizeStore(width, height, dpr);
  if (!last) return;
  const bw = gl.drawingBufferWidth, bh = gl.drawingBufferHeight;
  last.forEach((e, i) => {
    e.vp = last.length === 2
      ? { x: (i * bw) / 2, y: 0, width: bw / 2, height: bh }
      : { x: 0, y: 0, width: bw, height: bh };
  });
  drawEyes();
}

// ---- mono path: an ordinary browser, or a window the display has let go of: one flat view ------------
let mono = false;
function startMono() {
  mono = true;
  sbs = false;
  last = null;
  sizeStore();
  new ResizeObserver(() => sizeStore()).observe(canvas);
  requestAnimationFrame(onMonoFrame);
}
function onMonoFrame(now) {
  if (!mono) return;
  requestAnimationFrame(onMonoFrame);
  move(now);
  renderer.clear();
  renderer.setViewport(0, 0, renderer.domElement.width, renderer.domElement.height);
  renderer.render(scene, cam);
}

// ---- boot ----------------------------------------------------------------------------------------------
const wall = await createInline3D({ lazy: false });
if (wall.supported) {
  sbs = true;
  sizeStore();                                       // size BEFORE registering
  const handle = wall.addScene(canvas, onXRFrame, {
    viewRig: rig(1),
    onResize,
    onLayerLost: startMono,                          // the display let go: draw one flat view
  });
  // Each eye's projection is built from the session's near and far planes: give it the camera's.
  wall.session.updateRenderState({ depthNear: cam.near, depthFar: cam.far });

  // Depth slider: ONE value k moves BOTH factors, so stereo and look-around shrink together.
  // On a camera rig they are absolute, so 1 is the tuned top of the range (NOTES.md).
  depth.addEventListener('input', () => handle.setViewRig(rig(Number(depth.value))));

  // 2D/3D switch. The label follows what the display REPORTS (renderingmodechange), not the click.
  const showMode = () => {
    modeBtn.textContent = flat ? 'Show in 3D' : 'Show in 2D';
    modeBtn.setAttribute('aria-pressed', String(flat));
  };
  handle.on('renderingmodechange', (e) => {
    if (!e.viewCount) return;
    flat = e.viewCount === 1;
    sbs = !flat;
    last = null;                                     // the store changes size: replay after it
    sizeStore();
    showMode();
  });
  modeBtn.addEventListener('click', () => {
    handle.setStereoEnabled(!flat).catch(() => {
      // No flat mode on this display (nothing changed): depth 0 is a flat image on any display.
      flat = !flat;
      depth.value = flat ? 0 : 1;
      handle.setViewRig(rig(Number(depth.value)));
      showMode();
    });
  });
  showMode();

  hud.textContent = 'WASD / arrows to walk · drag to look';
  await handle.firstWoven;                           // cover until the first woven frame
  cover.remove();                                    // cut, never fade
} else {
  // An ordinary browser: the same room and the same layout, drawn flat.
  startMono();
  cover.remove();
  depth.disabled = modeBtn.disabled = true;
  modeBtn.textContent = 'Show in 2D';
  note.textContent = 'Open this page in the DisplayXR Browser on a 3D display to see the room in 3D.';
  hud.textContent = 'WASD / arrows to walk · drag to look';
}
