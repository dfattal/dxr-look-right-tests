// walkthrough.js — a first-person walk through a small furnished room, on the DisplayXR inline-3D SDK.
//
// The visitor IS the viewpoint, so this is a CAMERA rig (docs/authoring-inline-3d.md, "Which rig"):
// the page sends its own camera's pose, vertical FOV and convergence distance, and the runtime
// perturbs that frustum with the two eyes. The room is authored at metre scale, so nothing here
// rescales the scene. Every depth setting is gathered in the block below; NOTES.md says why each
// value is what it is.

import * as THREE from 'three';
import { createInline3D, inline3dViewRigSupported } from '@displayxr/inline3d';
import { EyeCamera, cameraRigFromCamera } from '@displayxr/inline3d/three';

// ---- depth settings ------------------------------------------------------------------------------
const VERTICAL_FOV_DEG = 50;      // the FULL vertical lens angle, three's convention (degrees)
const IPD_FACTOR = 1;             // camera rig: ABSOLUTE eye separation; 1 = a real 63 mm baseline
const PARALLAX_FACTOR = 1;        // camera rig: how far the eyes follow head tracking; 1 = full
const METERS_TO_VIRTUAL = 1;      // the room is authored in metres, so no unit conversion
const CONVERGENCE_MIN = 0.9;      // m; the nearest the glass is allowed to sit (comfort: see NOTES)
const CONVERGENCE_MAX = 3.0;      // m; far walls and the window view stay behind the glass
const CONVERGENCE_DEFAULT = 2.0;  // m; used when the look ray hits nothing
const CONVERGENCE_TAU = 0.35;     // s; time constant easing convergence toward what you look at

// ---- walking -------------------------------------------------------------------------------------
const EYE_HEIGHT = 1.6;           // m
const WALK_SPEED = 1.4;           // m/s
const RUN_SPEED = 2.6;            // m/s, with Shift held
const PLAYER_RADIUS = 0.3;        // m; keeps the lens off walls and furniture (near things = big disparity)
const LOOK_SENSITIVITY = 0.0022;  // radians per pixel of mouse movement
const PITCH_LIMIT = 1.25;         // radians, just short of straight up or down

// ---- room (metres; floor at y = 0, +z toward the front wall, -z toward the window) ---------------
const HALF_W = 1.95;              // interior half-width  (x)
const HALF_D = 2.45;              // interior half-depth (z)
const CEILING = 2.6;
const WALL_T = 0.1;
const W = { x0: -0.5, x1: 0.9, y0: 0.9, y1: 2.2 };   // window opening in the back wall (z = -HALF_D)
const TABLE = { x: -0.25, z: -0.2, w: 1.3, d: 0.75, top: 0.75 };
const LAMP = { x: -0.7, z: -0.45 };                  // on the table

// ---- page -----------------------------------------------------------------------------------------
const canvas = document.getElementById('stage');
const coverEl = document.getElementById('cover');
const hudEl = document.getElementById('hud');
setTimeout(() => { hudEl.hidden = true; }, 9000);

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ---- renderer -------------------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
// pixelRatio MUST be 1: layer.getViewport() reports BACKING-STORE pixels and three scales the
// viewport/scissor by the pixel ratio, so anything else silently zooms each eye. We size the store.
renderer.setPixelRatio(1);
renderer.autoClear = false;       // the stereo path clears once, then draws two scissored eyes
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// The room is static, so bake the shadow maps once. Left on, every eye of every frame re-renders them.
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;

// Largest store this GL context will hold. The browser clamps a too-large drawing buffer silently
// (a double image with no error), so the page clamps first.
const BUFFER_LIMIT = (() => {
  const gl = renderer.getContext();
  const [vw, vh] = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
  return Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), vw, vh);
})();

// ---- scene ----------------------------------------------------------------------------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14120f);

// Seeded random, so the procedural textures look the same on every visit.
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}

// Floor: four boards across a 1.2 m tile, staggered end joints, a little grain.
const floorTex = makeTexture(512, 512, (g, w, h) => {
  const rand = rng(7);
  const boardW = w / 4;
  for (let b = 0; b < 4; b++) {
    const tone = 0.85 + rand() * 0.2;
    g.fillStyle = `rgb(${Math.round(150 * tone)}, ${Math.round(100 * tone)}, ${Math.round(62 * tone)})`;
    g.fillRect(b * boardW, 0, boardW, h);
    for (let y = -rand() * h; y < h; y += h * (0.45 + rand() * 0.4)) {
      g.fillStyle = 'rgba(40, 24, 14, .75)';
      g.fillRect(b * boardW, y, boardW, 2);
    }
    for (let i = 0; i < 26; i++) {
      const x = b * boardW + rand() * boardW;
      g.strokeStyle = `rgba(60, 36, 20, ${0.05 + rand() * 0.1})`;
      g.lineWidth = 1 + rand();
      g.beginPath();
      g.moveTo(x, 0);
      g.bezierCurveTo(x + rand() * 8 - 4, h * 0.33, x + rand() * 8 - 4, h * 0.66, x + rand() * 6 - 3, h);
      g.stroke();
    }
    g.fillStyle = 'rgba(40, 24, 14, .7)';
    g.fillRect(b * boardW, 0, 2, h);
  }
});
floorTex.repeat.set((2 * HALF_W) / 1.2, (2 * HALF_D) / 1.2);

const rugTex = makeTexture(256, 192, (g, w, h) => {
  g.fillStyle = '#7e3a2c';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = '#d9b26a';
  g.lineWidth = 6;
  g.strokeRect(10, 10, w - 20, h - 20);
  g.lineWidth = 2;
  g.strokeStyle = '#e8c98a';
  g.strokeRect(22, 22, w - 44, h - 44);
  g.fillStyle = '#a8553f';
  g.fillRect(40, 40, w - 80, h - 80);
  g.fillStyle = '#d9b26a';
  for (let i = 0; i < 5; i++) {
    const cx = 40 + ((w - 80) * (i + 0.5)) / 5;
    const cy = h / 2;
    g.beginPath();
    g.moveTo(cx, cy - 18);
    g.lineTo(cx + 12, cy);
    g.lineTo(cx, cy + 18);
    g.lineTo(cx - 12, cy);
    g.closePath();
    g.fill();
  }
});

// Outside the window: a sky-to-grass gradient on a backdrop, plus two trees for parallax.
const skyTex = makeTexture(16, 256, (g, w, h) => {
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#6fb0e6');
  grad.addColorStop(0.55, '#e4f2fb');
  grad.addColorStop(0.62, '#b9cf9c');
  grad.addColorStop(1, '#5f7f48');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
});

// Lit materials are standard PBR, so the room reads under the lights below. The sky and bulb are
// basic and skip tone mapping so they stay at their authored brightness.
const mat = {
  wall: new THREE.MeshStandardMaterial({ color: 0xe9e2d4, roughness: 0.95 }),
  ceiling: new THREE.MeshStandardMaterial({ color: 0xf6f3ee, roughness: 1 }),
  trim: new THREE.MeshStandardMaterial({ color: 0xd8cfbf, roughness: 0.7 }),
  frame: new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.5 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x7a5234, roughness: 0.55 }),
  fabric: new THREE.MeshStandardMaterial({ color: 0x5d7a6a, roughness: 0.9 }),
  brass: new THREE.MeshStandardMaterial({ color: 0xb8924a, roughness: 0.35, metalness: 0.8 }),
  shade: new THREE.MeshStandardMaterial({ color: 0xf3e6cf, roughness: 0.9, side: THREE.DoubleSide, emissive: 0x2a1d0c }),
  floor: new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.6 }),
  rug: new THREE.MeshStandardMaterial({ map: rugTex, roughness: 1 }),
  sky: new THREE.MeshBasicMaterial({ map: skyTex, toneMapped: false }),
  tree: new THREE.MeshStandardMaterial({ color: 0x4f7d3f, roughness: 1 }),
  bulb: new THREE.MeshBasicMaterial({ color: 0xfff0cf, toneMapped: false }),
};

// The look ray picks the convergence distance from these; the walk collides with the footprints.
const pickables = [];
const footprints = [];   // {x0, x1, z0, z1}: furniture on the floor, in metres

// Walls, ceiling and window frame do not cast shadows: they are closed boxes, and a sun or lamp
// that could see through them would be blocked entirely. Furniture casts.
function box(w, h, d, x, y, z, material, { cast = false, pick = true } = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = cast;
  m.receiveShadow = true;
  scene.add(m);
  if (pick) pickables.push(m);
  return m;
}

function footprint(cx, cz, w, d) {
  footprints.push({ x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2 });
}

// Floor
const floor = new THREE.Mesh(new THREE.PlaneGeometry(2 * HALF_W, 2 * HALF_D), mat.floor);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
pickables.push(floor);

// Ceiling
box(2 * HALF_W + 2 * WALL_T, WALL_T, 2 * HALF_D + 2 * WALL_T, 0, CEILING + WALL_T / 2, 0, mat.ceiling, { pick: false });

// Walls. The back wall has the window cut out, built from four pieces around the opening.
const span = 2 * HALF_D + 2 * WALL_T;
const xLeft = -HALF_W - WALL_T / 2;
const xRight = HALF_W + WALL_T / 2;
const zFront = HALF_D + WALL_T / 2;
const zBack = -HALF_D - WALL_T / 2;
box(WALL_T, CEILING, span, xLeft, CEILING / 2, 0, mat.wall);
box(WALL_T, CEILING, span, xRight, CEILING / 2, 0, mat.wall);
box(2 * HALF_W + 2 * WALL_T, CEILING, WALL_T, 0, CEILING / 2, zFront, mat.wall);
const outerL = -HALF_W - WALL_T;
const outerR = HALF_W + WALL_T;
box(W.x0 - outerL, CEILING, WALL_T, (outerL + W.x0) / 2, CEILING / 2, zBack, mat.wall);
box(outerR - W.x1, CEILING, WALL_T, (W.x1 + outerR) / 2, CEILING / 2, zBack, mat.wall);
box(W.x1 - W.x0, W.y0, WALL_T, (W.x0 + W.x1) / 2, W.y0 / 2, zBack, mat.wall);
box(W.x1 - W.x0, CEILING - W.y1, WALL_T, (W.x0 + W.x1) / 2, (W.y1 + CEILING) / 2, zBack, mat.wall);

// Baseboards on the side and front walls (the back one is broken by the window).
box(0.015, 0.1, 2 * HALF_D, -HALF_W + 0.0075, 0.05, 0, mat.trim, { pick: false });
box(0.015, 0.1, 2 * HALF_D, HALF_W - 0.0075, 0.05, 0, mat.trim, { pick: false });
box(2 * HALF_W, 0.1, 0.015, 0, 0.05, HALF_D - 0.0075, mat.trim, { pick: false });

// Window: frame members inside the opening, a mullion and transom, and a sill.
{
  const zf = -HALF_D + 0.03;
  const ft = 0.05;
  const fd = 0.06;
  const cx = (W.x0 + W.x1) / 2;
  const cy = (W.y0 + W.y1) / 2;
  const ww = W.x1 - W.x0;
  const wh = W.y1 - W.y0;
  box(ft, wh + ft, fd, W.x0 - ft / 2, cy, zf, mat.frame, { pick: false });
  box(ft, wh + ft, fd, W.x1 + ft / 2, cy, zf, mat.frame, { pick: false });
  box(ww + 2 * ft, ft, fd, cx, W.y1 + ft / 2, zf, mat.frame, { pick: false });
  box(ww + 2 * ft, ft, fd, cx, W.y0 - ft / 2, zf, mat.frame, { pick: false });
  box(0.03, wh, fd, cx, cy, zf, mat.frame, { pick: false });
  box(ww, 0.03, fd, cx, cy, zf, mat.frame, { pick: false });
  box(ww + 0.2, 0.03, 0.2, cx, W.y0 + 0.015, -HALF_D + 0.1, mat.frame, { pick: false });
}

// Outside: a backdrop well behind the wall, and two trees visible through the opening.
const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(16, 9), mat.sky);
backdrop.position.set(0, 2.5, -6.5);
scene.add(backdrop);
pickables.push(backdrop);

function tree(x, z, s) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.08 * s, 0.1 * s, 1.2 * s, 8), mat.wood);
  trunk.position.y = 0.6 * s;
  const crown = new THREE.Mesh(new THREE.SphereGeometry(0.7 * s, 16, 12), mat.tree);
  crown.position.y = 1.6 * s;
  g.add(trunk, crown);
  g.position.set(x, 0, z);
  scene.add(g);
}
tree(0.5, -4.2, 1.0);
tree(-0.8, -5.0, 1.3);

// Table, with its footprint for the walk
for (const dx of [-0.6, 0.6]) {
  for (const dz of [-0.325, 0.325]) {
    box(0.05, TABLE.top - 0.05, 0.05, TABLE.x + dx, (TABLE.top - 0.05) / 2, TABLE.z + dz, mat.wood, { cast: true, pick: false });
  }
}
box(TABLE.w, 0.05, TABLE.d, TABLE.x, TABLE.top - 0.025, TABLE.z, mat.wood, { cast: true });
footprint(TABLE.x, TABLE.z, TABLE.w, TABLE.d);

// Two chairs, one each side of the table, facing it
function chair(x, z, yaw) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = yaw;
  scene.add(g);
  const part = (w, h, d, px, py, pz, m) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    b.position.set(px, py, pz);
    b.castShadow = true;
    b.receiveShadow = true;
    g.add(b);
  };
  part(0.45, 0.05, 0.45, 0, 0.45, 0, mat.fabric);       // seat
  part(0.45, 0.5, 0.04, 0, 0.7, -0.2, mat.wood);        // backrest, on the far side
  for (const lx of [-0.19, 0.19]) {
    for (const lz of [-0.19, 0.19]) part(0.04, 0.43, 0.04, lx, 0.215, lz, mat.wood);
  }
  footprint(x, z, 0.5, 0.5);
}
chair(TABLE.x, -1.0, 0);
chair(TABLE.x, 0.6, Math.PI);

// Table lamp: brass base, stem, open shade, and a bulb inside the shade just above the stem, which
// the point light sits on
{
  const topY = TABLE.top;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.025, 24), mat.brass);
  base.position.set(LAMP.x, topY + 0.0125, LAMP.z);
  const stemH = 0.34;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, stemH, 12), mat.brass);
  stem.position.set(LAMP.x, topY + 0.025 + stemH / 2, LAMP.z);
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.17, 0.22, 32, 1, true), mat.shade);
  shade.position.set(LAMP.x, topY + 0.025 + stemH + 0.08, LAMP.z);
  scene.add(base, stem, shade);
  const bulbY = topY + 0.025 + stemH + 0.02;
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), mat.bulb);
  bulb.position.set(LAMP.x, bulbY, LAMP.z);
  scene.add(bulb);

  const lampLight = new THREE.PointLight(0xffd6a0, 5, 8, 2);   // candela, cut off past 8 m
  lampLight.position.set(LAMP.x, bulbY, LAMP.z);
  lampLight.castShadow = true;
  lampLight.shadow.mapSize.set(512, 512);
  lampLight.shadow.bias = -0.0008;
  lampLight.shadow.normalBias = 0.02;
  scene.add(lampLight);
}

// Rug under the table
const rug = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.35), mat.rug);
rug.rotation.x = -Math.PI / 2;
rug.position.set(TABLE.x, 0.004, TABLE.z);
rug.receiveShadow = true;
scene.add(rug);

// Light: a soft sky/ground hemisphere, plus daylight from the window side. The sun casts shadows,
// so the table and chairs read as solid on the floor. Shadows are baked once (see the renderer).
scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x6b5a48, 0.8));
const sun = new THREE.DirectionalLight(0xfff1dc, 2.0);
sun.position.set(0.2, 3.5, -6);
sun.target.position.set(0, 0.4, 0);
scene.add(sun, sun.target);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 1, far: 14 });
sun.shadow.camera.updateProjectionMatrix();
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.02;

// ---- the camera: the visitor's eyes ---------------------------------------------------------------
// This is the app's own camera. It is in the scene, and the eye cameras are parented under it, so
// the world pose is this frame's (no one-frame rig lag). See the attach pattern in the authoring guide.
const appCam = new THREE.PerspectiveCamera(VERTICAL_FOV_DEG, 16 / 9, 0.05, 50);
scene.add(appCam);
const eyes = [new EyeCamera(THREE), new EyeCamera(THREE)];
for (const eye of eyes) appCam.add(eye.camera);

// The walker's state, in metres and radians. Starts just inside the front wall, looking at the window.
const pose = { x: 0, z: 1.85, yaw: 0, pitch: 0 };

// ---- input ----------------------------------------------------------------------------------------
const keys = new Set();
const held = (...codes) => codes.some((c) => keys.has(c));
addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code.startsWith('Arrow')) e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());   // a key released while another window had focus stays stuck otherwise

let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY };
  canvas.setPointerCapture?.(e.pointerId);
  // Pointer lock makes the mouse an unbounded look device. Where it is refused, drag still looks.
  canvas.requestPointerLock?.()?.catch?.(() => {});
});
canvas.addEventListener('pointermove', (e) => {
  if (document.pointerLockElement === canvas) {
    look(e.movementX, e.movementY);
  } else if (drag) {
    look(e.clientX - drag.x, e.clientY - drag.y);
    drag = { x: e.clientX, y: e.clientY };
  }
});
const endDrag = () => { drag = null; };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

function look(dx, dy) {
  pose.yaw -= dx * LOOK_SENSITIVITY;
  pose.pitch = clamp(pose.pitch - dy * LOOK_SENSITIVITY, -PITCH_LIMIT, PITCH_LIMIT);
}

// ---- walking and collision ------------------------------------------------------------------------
// Inside the room, and not inside any piece of furniture, with the player's radius as margin.
function free(x, z) {
  if (Math.abs(x) > HALF_W - PLAYER_RADIUS || z < -HALF_D + PLAYER_RADIUS || z > HALF_D - PLAYER_RADIUS) return false;
  for (const f of footprints) {
    if (x > f.x0 - PLAYER_RADIUS && x < f.x1 + PLAYER_RADIUS && z > f.z0 - PLAYER_RADIUS && z < f.z1 + PLAYER_RADIUS) return false;
  }
  return true;
}

function walk(dt) {
  const fwd = (held('KeyW', 'ArrowUp') ? 1 : 0) - (held('KeyS', 'ArrowDown') ? 1 : 0);
  const strafe = (held('KeyD', 'ArrowRight') ? 1 : 0) - (held('KeyA', 'ArrowLeft') ? 1 : 0);
  if (!fwd && !strafe) return;
  // Diagonals are not faster: normalise the input before scaling by speed.
  const speed = ((held('ShiftLeft', 'ShiftRight') ? RUN_SPEED : WALK_SPEED) * dt) / Math.hypot(fwd, strafe);
  // Yaw-only basis, so looking down does not sink you into the floor.
  // Forward is (-sin, -cos) in x,z; right is (cos, -sin).
  const s = Math.sin(pose.yaw);
  const c = Math.cos(pose.yaw);
  const dx = (-s * fwd + c * strafe) * speed;
  const dz = (-c * fwd - s * strafe) * speed;
  // Slide along a wall: try each axis on its own.
  if (free(pose.x + dx, pose.z)) pose.x += dx;
  if (free(pose.x, pose.z + dz)) pose.z += dz;
}

// ---- per-frame update -----------------------------------------------------------------------------
const lookDir = new THREE.Vector3();
const ray = new THREE.Raycaster();
let convergence = CONVERGENCE_DEFAULT;

// Distance to the nearest surface along the look direction, or Infinity if nothing is hit.
function lookDistance() {
  appCam.getWorldDirection(lookDir);
  ray.set(appCam.position, lookDir);
  const hit = ray.intersectObjects(pickables, false)[0];
  return hit ? hit.distance : Infinity;
}

// Pose from the input, then (stereo only) the convergence distance eases toward what you look at.
function update(dt, stereo) {
  walk(dt);
  appCam.quaternion.setFromEuler(new THREE.Euler(pose.pitch, pose.yaw, 0, 'YXZ'));
  appCam.position.set(pose.x, EYE_HEIGHT, pose.z);
  appCam.updateMatrixWorld();
  if (!stereo) return;
  // Convergence sets which depth sits on the glass. Changing it slides the whole scene in depth, so
  // it is eased, never snapped.
  const hit = lookDistance();
  const target = Number.isFinite(hit) ? clamp(hit, CONVERGENCE_MIN, CONVERGENCE_MAX) : CONVERGENCE_DEFAULT;
  convergence += (target - convergence) * (1 - Math.exp(-dt / CONVERGENCE_TAU));
}

let lastTime = performance.now();
function frameDt() {
  const now = performance.now();
  const dt = Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;
  return dt;
}

// The rig is rebuilt every frame. It is a camera rig with an identity pose (attach), so the runtime
// only offsets the eyes and skews the frustum; the world pose comes from appCam.
const rigOut = {};
function currentRig() {
  return cameraRigFromCamera(THREE, appCam, {
    convergence,
    attach: true,
    ipdFactor: IPD_FACTOR,
    parallaxFactor: PARALLAX_FACTOR,
    metersToVirtual: METERS_TO_VIRTUAL,
    out: rigOut,
  });
}

// ---- backing store --------------------------------------------------------------------------------
// The store is SIDE-BY-SIDE (2 eyes wide) while woven, 1:1 when flat. A resize clears the buffer
// even at the same size, so the size is assigned only when it changes.
let sbs = false;
function sizeBuffer() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  let h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  const cols = sbs ? 2 : 1;
  // Shrink both axes by one factor, so the eye keeps its aspect and the store fits the device limit.
  const s = Math.min(1, BUFFER_LIMIT / (w * cols), BUFFER_LIMIT / h);
  w = Math.max(1, Math.floor(w * s));
  h = Math.max(1, Math.floor(h * s));
  if (canvas.width !== w * cols || canvas.height !== h) renderer.setSize(w * cols, h, false);
  appCam.aspect = w / h;
  appCam.updateProjectionMatrix();
}
addEventListener('resize', sizeBuffer);

// ---- the stereo frame: one per session frame ------------------------------------------------------
let handle = null;
function onStereoFrame(views, layer) {
  // Validate BEFORE clearing. renderer.clear() is the point of no return: a short view list, or a
  // null viewport, would leave an empty buffer for the weave to read as one dark tile.
  if (!views || views.length < 2 || !layer) return;
  const vps = [layer.getViewport(views[0]), layer.getViewport(views[1])];
  if (vps.some((vp) => !vp || vp.width <= 0 || vp.height <= 0)) return;

  update(frameDt(), true);
  handle?.setViewRig(currentRig());   // drives the views the browser delivers NEXT frame

  renderer.clear();
  renderer.setScissorTest(true);
  for (let i = 0; i < 2; i++) {
    const vp = vps[i];
    renderer.setViewport(vp.x, vp.y, vp.width, vp.height);
    renderer.setScissor(vp.x, vp.y, vp.width, vp.height);
    // Local, not world: the eye poses are in rig space (identity), composed with appCam by the scene graph.
    eyes[i].setLocalFromView(views[i]);
    renderer.render(scene, eyes[i].camera);
  }
  renderer.setScissorTest(false);
  if ((window.__n = (window.__n || 0) + 1) % 30 === 0) {
    const gl = renderer.getContext(); const W = canvas.width, H = canvas.height; const px = [];
    for (const fx of [0.1, 0.25, 0.4, 0.6, 0.75, 0.9]) { const b = new Uint8Array(4); gl.readPixels(Math.floor(W * fx), Math.floor(H / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, b); px.push(Array.from(b).join(',')); }
    window.__dbg = { n: window.__n, W, H, px, vps: vps.map((v) => [v.x, v.y, v.width, v.height]), cam: eyes[0].camera.matrixWorld.elements.slice(12, 15).map((v) => +v.toFixed(2)), fb: !!gl.getParameter(gl.FRAMEBUFFER_BINDING) };
  }
}

// ---- flat: a normal browser, or a DisplayXR page that has lost its weave -------------------------
let monoRunning = false;
function monoFrame() {
  requestAnimationFrame(monoFrame);
  update(frameDt(), false);
  renderer.clear();
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, canvas.width, canvas.height);
  renderer.render(scene, appCam);
}

function goFlat() {
  sbs = false;
  sizeBuffer();
  if (!monoRunning) {
    monoRunning = true;
    requestAnimationFrame(monoFrame);
  }
  coverEl.remove();   // the 2D picture is the page's own, so there is nothing left to cover
}

// ---- boot -----------------------------------------------------------------------------------------
(async () => {
  update(0, false);   // a pose for the first rig and the first frame
  const wall = await createInline3D({ lazy: false });
  if (!wall.supported) {
    goFlat();
    return;
  }
  if (!inline3dViewRigSupported()) {
    // This camera is framed by its rig. Without setViewRig the browser would weave the room on a
    // default display rig that does not match this camera, so show it flat rather than wrongly stereo.
    wall.close();
    goFlat();
    return;
  }
  sbs = true;
  sizeBuffer();   // the store settles before the window registers (woven-canvas rule 4)
  handle = wall.addScene(canvas, onStereoFrame, {
    viewRig: currentRig(),                 // passed at construction: the first located frame is already on the camera
    rectCover: 'auto',                     // a later resize is covered until it weaves again (rule 11)
    onResize: () => sizeBuffer(),          // a real CSS-box or dpr change only
    onLayerLost: goFlat,                   // the weave is gone: take the canvas flat
  });
  // Opaque cover until the first woven frame (rule 5). A hard cut when it lifts, never a fade.
  handle.firstWoven.then((r) => {
    coverEl.remove();
    console.log('[walkthrough] firstWoven', r);
  });
})();
