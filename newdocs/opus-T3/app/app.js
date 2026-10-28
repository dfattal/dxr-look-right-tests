// A first-person walk-through of a small furnished room, on a DisplayXR spatial display.
// Built from sdk/samples/starter-world; rules: sdk/docs/making-3d-look-right.md.
//
// RIG (guide §1): the visitor moves THROUGH a world → a CAMERA rig. The page owns its camera and
// the runtime turns it into two eyes (attach pattern: identity-posed rig, eye cameras parented
// under the app camera, so turning the head with the mouse has no one-frame rig lag).
// The world is authored in metres; eye separation is 63 mm × ipdFactor (absolute on this rig).
//
// SCREEN PLANE (§2): FIXED, FINITE convergence at the nearest content that touches a frame edge.
// With a level camera at eye height EYE_H that is the floor at the bottom edge (and, symmetrically,
// the ceiling at the top edge: ROOM.h = 2·EYE_H), EYE_H / tan(fov/2) ahead. We converge 10 % nearer
// so every edge is just behind the glass and the room reads as a view through a window. The side
// walls reach the left/right edges at 2.8 / tan(45.8°) ≈ 2.7 m, also behind. Never gaze-driven,
// never 0.
//
// DEPTH (§3, full-frame column: ≥ −0.3 % in front, ≤ 1.0 % behind, of the tile width).
//   disparity % = 100·0.063·k·(1/D − 1/z) / (2·tan(30°)·16/9) ≈ 3.07·k·(1/D − 1/z)
//   D = 2.49 m (1/D = 0.402). At the start pose (z = 0.9, k = 1):
//     • floor / ceiling at the frame edges ≈ 2.49–2.7 m   → ≈ 0 … +0.1 %   (at the glass)
//     • nearest chair back, centre      ≈ 3.7 m            → +0.4 %          (behind)
//     • far wall                        7.3 m              → +0.82 %
//     • garden backdrop through window  ≤ 11.9 m (worst pose anywhere in the room) → ≤ +0.98 %
//   The view through the window is CLOSED by a painted backdrop at a finite distance — no sky at
//   infinity, which on this rig would be 1.23 %. Pitch is limited to ±PITCH_MAX so the floor at the
//   bottom edge never comes nearer than ≈ 1.7 m (≈ −0.6 %, the "strong" centre value, and only
//   when looking down at the floor). Collision keeps the camera ≥ 0.6 m from walls, 0.4 m from furniture;
//   walking right up to something does bring it out of the glass — that is the visitor's choice,
//   and the Depth slider is there for it.

import * as THREE from 'three';
import { createInline3D } from '@displayxr/inline3d';
import { EyeCamera, cameraRigFromCamera } from '@displayxr/inline3d/three';

const canvas = document.getElementById('world');
const cover = document.getElementById('cover');
const hud = document.getElementById('hud');
const depth = document.getElementById('depth');
const modeBtn = document.getElementById('mode');
const modeNote = document.getElementById('modeNote');

const FOV = 60;                        // full vertical angle, degrees
const EYE_H = 1.6;                     // eye height, metres
const CONVERGENCE = 0.9 * EYE_H / Math.tan(THREE.MathUtils.degToRad(FOV / 2)); // ≈ 2.49 m
const IPD = 1;                         // tuned eye-separation factor; the slider's top (absolute)
const PITCH_MAX = 0.45;                // rad (≈ 26°): keeps the floor/ceiling at the edges ≥ 1.7 m
const ROOM = { w: 5.6, h: 3.2, near: 1.6, far: -6.4 };   // x ∈ ±2.8, y ∈ [0, 3.2], z ∈ [−6.4, 1.6]
const WIN = { x0: -1.0, x1: 1.0, y0: 0.9, y1: 2.4 };      // window hole in the far wall
const BACKDROP_Z = -10.5;              // the garden "horizon": a finite, painted backdrop
const BG = 0x15171c;

// ---- renderer + camera -------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setClearColor(BG, 1);         // OPAQUE clear
renderer.setPixelRatio(1);             // the backing store is sized explicitly in sizeStore()
renderer.autoClear = false;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false; // the room is static: render shadow maps once, not per eye
renderer.shadowMap.needsUpdate = true;

const scene = new THREE.Scene();
// The app camera is IN the scene: the eye cameras hang under it (attach pattern), and three only
// composes a parented camera's world matrix through a scene traversal.
const cam = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.05, 30);
cam.position.set(0, EYE_H, 0.9);
scene.add(cam);

// ---- procedural textures: irregular detail so the eyes can fuse surfaces (repeats confuse them) --
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
function canvasTex(c, repeat = [1, 1]) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.anisotropy = 8;
  return t;
}
function tex(base, { repeat = [1, 1], planks = 0, spots = 1500, contrast = 0.2, r = 8, grain = 0 } = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < planks; i++) {   // boards: a tone per board, a soft seam between
    g.fillStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,255,255'},${rnd() * 0.16})`;
    g.fillRect(0, (i * 256) / planks, 256, 256 / planks);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(0, (i * 256) / planks, 256, 2);
  }
  for (let i = 0; i < grain; i++) {    // long streaks along the boards (wood grain)
    g.strokeStyle = `rgba(${rnd() < 0.6 ? '40,20,5' : '255,235,200'},${rnd() * 0.12})`;
    g.lineWidth = 0.5 + rnd() * 1.5;
    const y = rnd() * 256;
    g.beginPath();
    g.moveTo(0, y);
    g.bezierCurveTo(85, y + (rnd() - 0.5) * 8, 170, y + (rnd() - 0.5) * 8, 256, y);
    g.stroke();
  }
  for (let i = 0; i < spots; i++) {    // soft random blotches of every size
    g.fillStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,255,255'},${rnd() * contrast})`;
    g.beginPath();
    g.arc(rnd() * 256, rnd() * 256, 1 + rnd() * rnd() * r, 0, 7);
    g.fill();
  }
  return canvasTex(c, repeat);
}
const mat = (base, o = {}, extra = {}) =>
  new THREE.MeshStandardMaterial({ map: tex(base, o), roughness: o.roughness ?? 0.85, ...extra });

// The garden seen through the window: soft, low-contrast, hazy (sharp contrast far behind the
// glass ghosts first). Painted once; MeshBasic so the lights do not change it.
function gardenTex() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 512;
  const g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, 512);
  sky.addColorStop(0, '#7fa7cf');
  sky.addColorStop(0.55, '#b9cfdf');
  sky.addColorStop(0.75, '#d8d9cf');
  g.fillStyle = sky;
  g.fillRect(0, 0, 1024, 512);
  for (let i = 0; i < 14; i++) {       // a few soft clouds
    const x = rnd() * 1024, y = 40 + rnd() * 160, s = 30 + rnd() * 70;
    const cg = g.createRadialGradient(x, y, 0, x, y, s);
    cg.addColorStop(0, 'rgba(255,255,255,0.45)');
    cg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = cg;
    g.fillRect(x - s, y - s, 2 * s, 2 * s);
  }
  const hills = (base, amp, col) => {  // two hazy ridgelines
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(0, 512);
    for (let x = 0; x <= 1024; x += 16) {
      g.lineTo(x, base - amp * (0.6 * Math.sin(x * 0.006 + rnd() * 0.2) + 0.4 * Math.sin(x * 0.017)));
    }
    g.lineTo(1024, 512);
    g.fill();
  };
  hills(330, 40, '#9fb0a6');
  hills(370, 28, '#7f9a7c');
  for (let i = 0; i < 260; i++) {      // a soft tree line
    const x = rnd() * 1024, y = 380 + rnd() * 30, s = 8 + rnd() * 18;
    g.fillStyle = `rgba(${60 + rnd() * 30},${95 + rnd() * 30},${55 + rnd() * 20},0.85)`;
    g.beginPath();
    g.arc(x, y, s, 0, 7);
    g.fill();
  }
  g.fillStyle = '#6f8f55';
  g.fillRect(0, 410, 1024, 102);
  for (let i = 0; i < 2500; i++) {
    g.fillStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,255,230'},${rnd() * 0.12})`;
    g.fillRect(rnd() * 1024, 410 + rnd() * 102, 2, 2);
  }
  return canvasTex(c);
}

// ---- helpers -------------------------------------------------------------------------------------
function mesh(geo, m, x, y, z, parent = scene, { cast = true, receive = true } = {}) {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z);
  o.castShadow = cast;
  o.receiveShadow = receive;
  parent.add(o);
  return o;
}
const box = (w, h, d, x, y, z, m, parent, o) => mesh(new THREE.BoxGeometry(w, h, d), m, x, y, z, parent, o);
function plane(w, h, m, pos, rot, o) {
  const p = mesh(new THREE.PlaneGeometry(w, h), m, ...pos, scene, o);
  p.rotation.set(...rot);
  return p;
}
const blockers = [];                   // walkable-area obstacles, XZ boxes [x0, z0, x1, z1]
const block = (x0, z0, x1, z1) => blockers.push([x0, z0, x1, z1]);

// ---- the room shell ------------------------------------------------------------------------------
const L = ROOM.near - ROOM.far, MZ = (ROOM.near + ROOM.far) / 2, HW = ROOM.w / 2;
plane(ROOM.w, L, mat('#8a6a4a', { planks: 11, grain: 60, repeat: [2, 4], r: 4, roughness: 0.6 }),
  [0, 0, MZ], [-Math.PI / 2, 0, 0], { cast: false });                                  // floor
plane(ROOM.w, L, mat('#dcd7cc', { repeat: [2, 3], contrast: 0.07 }),
  [0, ROOM.h, MZ], [Math.PI / 2, 0, 0]);                                               // ceiling
const wallMat = mat('#c2b49b', { repeat: [3, 1], contrast: 0.11, spots: 3000, r: 5 });
plane(L, ROOM.h, wallMat, [-HW, ROOM.h / 2, MZ], [0, Math.PI / 2, 0]);                // left
plane(L, ROOM.h, wallMat, [HW, ROOM.h / 2, MZ], [0, -Math.PI / 2, 0]);                // right
plane(ROOM.w, ROOM.h, wallMat, [0, ROOM.h / 2, ROOM.near], [0, Math.PI, 0]);          // behind you
{ // far wall, with the window cut out of it (ShapeGeometry UVs are in metres)
  const s = new THREE.Shape();
  s.moveTo(-HW, 0); s.lineTo(HW, 0); s.lineTo(HW, ROOM.h); s.lineTo(-HW, ROOM.h); s.closePath();
  const hole = new THREE.Path();
  hole.moveTo(WIN.x0, WIN.y0); hole.lineTo(WIN.x0, WIN.y1); hole.lineTo(WIN.x1, WIN.y1); hole.lineTo(WIN.x1, WIN.y0);
  hole.closePath();
  s.holes.push(hole);
  const m = mat('#c2b49b', { repeat: [1 / 2.7, 1 / 3.2], contrast: 0.11, spots: 3000, r: 5 });
  mesh(new THREE.ShapeGeometry(s), m, 0, 0, ROOM.far);
}
const trim = new THREE.MeshStandardMaterial({ color: 0xe9e4da, roughness: 0.6 });
for (const [w, d, x, z, ry] of [[ROOM.w, 0.02, 0, ROOM.far + 0.01, 0], [L, 0.02, -HW + 0.01, MZ, Math.PI / 2],
  [L, 0.02, HW - 0.01, MZ, Math.PI / 2], [ROOM.w, 0.02, 0, ROOM.near - 0.01, 0]]) {
  box(w, 0.1, d, x, 0.05, z, trim).rotation.y = ry;                                    // skirting
}
// A door in the wall behind the start position (you turn round to see it).
box(0.95, 2.1, 0.05, 1.3, 1.05, ROOM.near - 0.03, mat('#7a5638', { planks: 5, grain: 40 }));
mesh(new THREE.SphereGeometry(0.03, 16, 12), new THREE.MeshStandardMaterial({ color: 0xc9a050, metalness: 0.8, roughness: 0.3 }),
  0.92, 1.0, ROOM.near - 0.07);

// ---- the window: frame, mullions, sill, curtains, and the garden beyond ---------------------------
{
  const frame = new THREE.MeshStandardMaterial({ color: 0xf1ede4, roughness: 0.5 });
  const cx = (WIN.x0 + WIN.x1) / 2, cy = (WIN.y0 + WIN.y1) / 2, ww = WIN.x1 - WIN.x0, wh = WIN.y1 - WIN.y0;
  const z = ROOM.far;
  box(ww + 0.16, 0.08, 0.18, cx, WIN.y1 + 0.04, z, frame);                 // head
  box(0.08, wh, 0.18, WIN.x0 - 0.04, cy, z, frame);                         // jambs
  box(0.08, wh, 0.18, WIN.x1 + 0.04, cy, z, frame);
  box(ww + 0.3, 0.05, 0.3, cx, WIN.y0 - 0.025, z + 0.08, frame);           // sill, into the room
  box(0.045, wh, 0.06, cx, cy, z, frame);                                   // mullion
  box(ww, 0.045, 0.06, cx, cy + 0.15, z, frame);                            // transom
  const curtain = mat('#6e7f5a', { spots: 1400, contrast: 0.25, r: 3 });
  for (const sx of [-1, 1]) {                                               // curtains, gently folded
    const g = new THREE.PlaneGeometry(0.62, 2.75, 24, 1);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, 0.035 * Math.sin(p.getX(i) * 32));
    g.computeVertexNormals();
    const c = mesh(g, curtain, cx + sx * (ww / 2 + 0.33), 1.5, z + 0.12);
    c.material.side = THREE.DoubleSide;
  }
  box(ww + 1.5, 0.03, 0.03, cx, 2.88, z + 0.12, new THREE.MeshStandardMaterial({ color: 0x3a3028, metalness: 0.4, roughness: 0.5 })); // rod

  // Outside: lawn, a hedge, two trees, then the painted backdrop at a finite distance.
  const outside = { cast: false, receive: false };
  plane(16, ROOM.far - BACKDROP_Z, mat('#5f7f45', { spots: 3000, contrast: 0.2, r: 3, repeat: [4, 1.2] }),
    [0, -0.01, (ROOM.far + BACKDROP_Z) / 2], [-Math.PI / 2, 0, 0], outside);
  box(12, 1.1, 0.7, 0, 0.55, -8.7, mat('#3f5f34', { spots: 4000, contrast: 0.3, r: 4 }), scene, outside);
  const bark = new THREE.MeshStandardMaterial({ color: 0x5a4636, roughness: 0.9 });
  const leaves = mat('#4d7040', { spots: 3000, contrast: 0.3, r: 4 }, { flatShading: true });
  for (const [x, zz, s] of [[-1.9, -9.4, 1.0], [2.3, -9.9, 1.25]]) {
    mesh(new THREE.CylinderGeometry(0.08 * s, 0.12 * s, 2.2 * s, 10), bark, x, 1.1 * s, zz, scene, outside);
    mesh(new THREE.IcosahedronGeometry(0.9 * s, 1), leaves, x, 2.5 * s, zz, scene, outside);
    mesh(new THREE.IcosahedronGeometry(0.6 * s, 1), leaves, x + 0.5 * s, 2.0 * s, zz + 0.2, scene, outside);
  }
  // Backdrop: a back panel plus two side panels, so a steep look out of the window never runs
  // off its edge (no open sky anywhere: infinity would be the deepest point in view).
  const garden = gardenTex();
  plane(16, 11, new THREE.MeshBasicMaterial({ map: garden, toneMapped: false }), [0, 3.2, BACKDROP_Z], [0, 0, 0], outside);
  const sideTex = garden.clone();
  sideTex.repeat.set(0.4, 1);
  sideTex.needsUpdate = true;
  const skySide = new THREE.MeshBasicMaterial({ map: sideTex, toneMapped: false });
  const sd = ROOM.far - BACKDROP_Z, sz = (ROOM.far + BACKDROP_Z) / 2;
  plane(sd, 11, skySide, [-8, 3.2, sz], [0, Math.PI / 2, 0], outside);
  plane(sd, 11, skySide, [8, 3.2, sz], [0, -Math.PI / 2, 0], outside);
}

// ---- furniture -------------------------------------------------------------------------------------
const wood = mat('#6b4a2e', { planks: 6, grain: 50, contrast: 0.18, roughness: 0.55 });
const darkWood = mat('#4a3322', { planks: 4, grain: 40, contrast: 0.15, roughness: 0.6 });
const TABLE = { x: 0, z: -3.5 };
plane(3.0, 2.2, mat('#7a2e2e', { spots: 1800, contrast: 0.32, r: 6 }), [TABLE.x, 0.004, TABLE.z],
  [-Math.PI / 2, 0, 0], { cast: false });                                                // rug
box(1.6, 0.05, 0.9, TABLE.x, 0.75, TABLE.z, wood);                                       // table top
box(1.45, 0.08, 0.75, TABLE.x, 0.69, TABLE.z, darkWood);                                 // apron
for (const [dx, dz] of [[-0.72, -0.38], [0.72, -0.38], [-0.72, 0.38], [0.72, 0.38]]) {
  box(0.06, 0.73, 0.06, TABLE.x + dx, 0.365, TABLE.z + dz, darkWood);
}
block(TABLE.x - 0.8, TABLE.z - 0.45, TABLE.x + 0.8, TABLE.z + 0.45);

function chair(x, z) {                 // faces the table centre
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = Math.atan2(TABLE.x - x, TABLE.z - z);
  box(0.44, 0.04, 0.42, 0, 0.46, 0, wood, g);
  for (const [dx, dz] of [[-0.19, -0.18], [0.19, -0.18], [-0.19, 0.18], [0.19, 0.18]]) {
    box(0.035, 0.45, 0.035, dx, 0.225, dz, darkWood, g);
  }
  for (const dx of [-0.19, 0.19]) box(0.035, 0.5, 0.035, dx, 0.73, -0.19, darkWood, g); // back posts
  box(0.42, 0.16, 0.025, 0, 0.86, -0.19, wood, g);                                        // back rail
  box(0.42, 0.04, 0.025, 0, 0.62, -0.19, wood, g);
  scene.add(g);
  block(x - 0.26, z - 0.26, x + 0.26, z + 0.26);
}
chair(TABLE.x - 0.4, TABLE.z + 0.72); chair(TABLE.x + 0.4, TABLE.z + 0.72);
chair(TABLE.x - 0.4, TABLE.z - 0.72); chair(TABLE.x + 0.4, TABLE.z - 0.72);

// On the table: a bowl of fruit and a jug (small, central, well behind the glass at the start).
const ceramic = new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.35 });
const bowl = new THREE.LatheGeometry([0, 0.07, 0.12, 0.15, 0.155].map((r, i) => new THREE.Vector2(r, i * 0.022)), 32);
mesh(bowl, ceramic, TABLE.x - 0.2, 0.775, TABLE.z, scene).material.side = THREE.DoubleSide;
for (let i = 0; i < 5; i++) {
  const a = (i / 5) * Math.PI * 2;
  mesh(new THREE.SphereGeometry(0.04, 16, 12), new THREE.MeshStandardMaterial({
    color: [0xc8402c, 0xe0a030, 0x8aa83a, 0xc8402c, 0xe0a030][i], roughness: 0.45,
  }), TABLE.x - 0.2 + Math.cos(a) * 0.065, 0.83, TABLE.z + Math.sin(a) * 0.065);
}
const jug = new THREE.LatheGeometry([[0.0, 0], [0.06, 0], [0.075, 0.06], [0.07, 0.14], [0.045, 0.2], [0.05, 0.24]]
  .map(([r, y]) => new THREE.Vector2(r, y)), 28);
mesh(jug, new THREE.MeshStandardMaterial({ color: 0x3c6a8c, roughness: 0.3, side: THREE.DoubleSide }), TABLE.x + 0.35, 0.775, TABLE.z - 0.1);

// Sofa along the right wall, a painting above it.
{
  const fabric = mat('#3d5a7a', { spots: 1500, contrast: 0.25, r: 3, roughness: 0.95 });
  const cushion = mat('#46668a', { spots: 1200, contrast: 0.22, r: 3, roughness: 0.95 });
  const sx = HW - 0.45, sz = -2.4, len = 2.1;
  box(0.85, 0.25, len, sx, 0.2, sz, fabric);                                   // base
  box(0.2, 0.55, len, HW - 0.1, 0.55, sz, fabric);                             // back
  for (const e of [-1, 1]) box(0.85, 0.32, 0.18, sx, 0.48, sz + e * (len / 2 - 0.09), fabric); // arms
  for (const e of [-1, 1]) box(0.62, 0.14, (len - 0.4) / 2 - 0.02, sx - 0.08, 0.39, sz + e * (len - 0.4) / 4, cushion);
  for (const z of [-0.4, 0.4]) box(0.12, 0.42, 0.62, HW - 0.24, 0.66, sz + z, cushion).rotation.z = -0.15;
  block(sx - 0.43, sz - len / 2, HW, sz + len / 2);
  const frameM = new THREE.MeshStandardMaterial({ color: 0x2c2420, roughness: 0.5 });
  box(0.04, 0.82, 1.22, HW - 0.02, 1.75, sz, frameM);
  plane(1.1, 0.7, mat('#b0703a', { spots: 1600, contrast: 0.5, r: 18 }), [HW - 0.045, 1.75, sz], [0, -Math.PI / 2, 0], { cast: false });
}

// Bookshelf against the left wall.
{
  const g = new THREE.Group();
  g.position.set(-HW + 0.18, 0, -2.2);
  g.rotation.y = Math.PI / 2;           // its front faces into the room (+x)
  const W = 1.8, H = 2.0, D = 0.34;
  box(W, H, 0.02, 0, H / 2, -D / 2 + 0.01, darkWood, g);                        // back panel
  for (const sx of [-1, 1]) box(0.03, H, D, sx * (W / 2 - 0.015), H / 2, 0, wood, g);
  for (let r = 0; r <= 4; r++) box(W, 0.03, D, 0, 0.05 + r * 0.48, 0, wood, g); // shelves
  for (let r = 0; r < 4; r++) {
    let x = -W / 2 + 0.06;
    while (x < W / 2 - 0.1) {
      const t = 0.03 + rnd() * 0.04, h = 0.24 + rnd() * 0.16;
      if (rnd() < 0.08) { x += 0.12; continue; }                                // a gap now and then
      const b = box(t, h, 0.22, x + t / 2, 0.065 + r * 0.48 + h / 2, 0.02,
        new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(rnd(), 0.4, 0.22 + rnd() * 0.3), roughness: 0.8 }), g);
      if (rnd() < 0.06) b.rotation.z = 0.12;
      x += t + 0.004;
    }
  }
  scene.add(g);
  block(-HW, -2.2 - W / 2, -HW + 0.36, -2.2 + W / 2);
}

// A potted plant in the corner by the window.
{
  const px = 1.95, pz = -5.75;
  mesh(new THREE.CylinderGeometry(0.2, 0.15, 0.42, 24), mat('#9c5a3c', { contrast: 0.15 }), px, 0.21, pz);
  const leaf = mat('#3e6b35', { spots: 900, contrast: 0.3, r: 3 }, { flatShading: true });
  for (let i = 0; i < 7; i++) {
    const s = 0.16 + rnd() * 0.14;
    mesh(new THREE.IcosahedronGeometry(s, 0), leaf, px + (rnd() - 0.5) * 0.3, 0.6 + rnd() * 0.6, pz + (rnd() - 0.5) * 0.3);
  }
  block(px - 0.25, pz - 0.25, px + 0.25, pz + 0.25);
}

// The floor lamp, in the far-left corner, and its light.
{
  const lx = -2.15, lz = -5.6;
  const metal = new THREE.MeshStandardMaterial({ color: 0x2b2b2e, metalness: 0.7, roughness: 0.35 });
  mesh(new THREE.CylinderGeometry(0.17, 0.19, 0.03, 32), metal, lx, 0.015, lz);
  mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.5, 12), metal, lx, 0.78, lz);
  const shadeM = mat('#efe2c0', { contrast: 0.08, spots: 600 }, {
    side: THREE.DoubleSide, emissive: new THREE.Color(0xffc477), emissiveIntensity: 0.55,
  });
  mesh(new THREE.CylinderGeometry(0.16, 0.26, 0.34, 32, 1, true), shadeM, lx, 1.62, lz, scene, { cast: false, receive: false });
  mesh(new THREE.SphereGeometry(0.05, 16, 12), new THREE.MeshBasicMaterial({ color: 0xfff1d0 }), lx, 1.58, lz, scene, { cast: false, receive: false });
  const light = new THREE.PointLight(0xffc98a, 7, 9, 1.6);
  light.position.set(lx, 1.56, lz);
  light.castShadow = true;
  light.shadow.mapSize.set(512, 512);
  light.shadow.bias = -0.002;
  light.shadow.radius = 3;
  scene.add(light);
  block(lx - 0.25, lz - 0.25, lx + 0.25, lz + 0.25);
}

// ---- lighting: soft daylight through the window, a warm fill --------------------------------------
scene.add(new THREE.HemisphereLight(0xfff4e6, 0x4a3a2e, 1.15));
{
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.6);
  const dir = new THREE.Vector3(0.25, -0.75, 0.8).normalize();       // travelling into the room
  sun.target.position.set(0, 0, -4);
  sun.position.copy(sun.target.position).addScaledVector(dir, -25);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 5, far: 45 });
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 2;
  scene.add(sun, sun.target);
}

// ---- input: WASD / arrows to walk; mouse-look with pointer lock, drag-look as a fallback ---------
// Pointer lock over a woven canvas is unverified on hardware (porting-three-js-apps.md §7), so
// dragging always works too.
const keys = new Set();
const isField = (e) => e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);
addEventListener('keydown', (e) => {
  if (isField(e) || !MOVE_KEYS.has(e.code)) return;
  keys.add(e.code);
  if (e.code.startsWith('Arrow')) e.preventDefault();   // don't scroll the page while walking
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

let yaw = 0, pitch = 0, drag = null;
const locked = () => document.pointerLockElement === canvas;
function look(dx, dy, k) {
  yaw -= dx * k;
  pitch = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, pitch - dy * k));
}
canvas.addEventListener('pointerdown', (e) => {
  if (locked()) return;
  canvas.focus({ preventScroll: true });
  drag = { x: e.clientX, y: e.clientY, moved: 0, mouse: e.pointerType === 'mouse' };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (locked()) { look(e.movementX, e.movementY, 0.0022); return; }
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.moved += Math.abs(dx) + Math.abs(dy);
  look(dx, dy, 0.004);
  drag.x = e.clientX; drag.y = e.clientY;
});
canvas.addEventListener('pointerup', () => {
  // A click (not a drag) with the mouse captures it for free look.
  if (drag && drag.mouse && drag.moved < 4 && canvas.requestPointerLock) {
    try { Promise.resolve(canvas.requestPointerLock()).catch(() => {}); } catch { /* drag still works */ }
  }
  drag = null;
});
canvas.addEventListener('pointercancel', () => { drag = null; });
let baseHint = '';
const showHint = () => {
  hud.textContent = locked() ? 'Mouse captured — move to look · WASD to walk · Esc to release' : baseHint;
};
document.addEventListener('pointerlockchange', showHint);

// Walking, with collision against the walls and the furniture (slides along obstacles).
const R_WALL = 0.6, R_FURN = 0.4;      // clearance, metres: keeps things from filling your face
function blocked(x, z) {
  if (x < -HW + R_WALL || x > HW - R_WALL || z < ROOM.far + R_WALL || z > ROOM.near - R_WALL) return true;
  const r = R_FURN;
  return blockers.some(([x0, z0, x1, z1]) => x > x0 - r && x < x1 + r && z > z0 - r && z < z1 + r);
}
let lastT = 0;
function move(now) {
  const dt = lastT ? Math.min((now - lastT) / 1000, 0.1) : 0;
  lastT = now;
  const f = (keys.has('KeyW') || keys.has('ArrowUp')) - (keys.has('KeyS') || keys.has('ArrowDown'));
  const s = (keys.has('KeyD') || keys.has('ArrowRight')) - (keys.has('KeyA') || keys.has('ArrowLeft'));
  const run = keys.has('ShiftLeft') || keys.has('ShiftRight');
  const v = (run ? 2.6 : 1.4) * dt / (f && s ? Math.SQRT2 : 1);    // m/s
  const dx = (-Math.sin(yaw) * f + Math.cos(yaw) * s) * v;
  const dz = (-Math.cos(yaw) * f - Math.sin(yaw) * s) * v;
  const p = cam.position;
  if (!blocked(p.x + dx, p.z)) p.x += dx;
  if (!blocked(p.x, p.z + dz)) p.z += dz;
  cam.rotation.set(pitch, yaw, 0, 'YXZ');
}

// ---- backing store: 2× wide when woven, 1:1 flat. Sized BEFORE registering, then only in onResize
let sbs = false;
function sizeStore(cssW = canvas.clientWidth, cssH = canvas.clientHeight, dpr = devicePixelRatio || 1) {
  const w = Math.max(1, Math.round(cssW * dpr)), h = Math.max(1, Math.round(cssH * dpr));
  renderer.setSize(sbs ? 2 * w : w, h, false);
  cam.aspect = w / h;
  cam.updateProjectionMatrix();
}

// ---- woven path: the attach pattern, drawn from the last GOOD frame ------------------------------
const eyes = [new EyeCamera(THREE), new EyeCamera(THREE)];
for (const e of eyes) cam.add(e.camera);
let last = null;                       // copies: an XRView is valid only inside its own frame

function onXRFrame(views, layer) {
  move(performance.now());
  // Validate before clearing; a short view list (session under load) replays the last good frame.
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
  renderer.clear();
  renderer.setScissorTest(true);
  last.forEach((e, i) => {
    renderer.setViewport(e.vp.x, e.vp.y, e.vp.width, e.vp.height);
    renderer.setScissor(e.vp.x, e.vp.y, e.vp.width, e.vp.height);
    eyes[i].setLocalFromMatrices(e.proj, e.pose);   // rig-local eye pose, under `cam`
    renderer.render(scene, eyes[i].camera);
  });
  renderer.setScissorTest(false);
}
function onResize({ width, height, dpr }) {          // inside the SDK's observer, before paint
  sizeStore(width, height, dpr);
  if (!last) return;
  const w = canvas.width / 2;
  last.forEach((e, i) => { e.vp = { x: i * w, y: 0, width: w, height: canvas.height }; });
  drawEyes();
}

// ---- mono path: the same camera, drawn once --------------------------------------------------------
function onMonoFrame(now) {
  requestAnimationFrame(onMonoFrame);
  move(now);
  renderer.clear();
  renderer.setViewport(0, 0, canvas.width, canvas.height);
  renderer.render(scene, cam);
}

// ---- boot ------------------------------------------------------------------------------------------
const wall = await createInline3D({ lazy: false });
if (wall.supported) {
  sbs = true;
  sizeStore();                                       // size BEFORE registering
  // Depth slider k ∈ [0, 1] scales BOTH factors (stereo and look-around together). On a camera rig
  // they are absolute, so the top of the slider is the tuned value IPD (= 1).
  const rig = (k) => cameraRigFromCamera(THREE, cam, {
    convergence: CONVERGENCE, attach: true, ipdFactor: IPD * k, parallaxFactor: IPD * k,
  });
  const handle = wall.addScene(canvas, onXRFrame, { viewRig: rig(1), onResize });
  // Each eye's projection is built from the session's near/far: give it the camera's.
  wall.session.updateRenderState({ depthNear: cam.near, depthFar: cam.far });
  depth.addEventListener('input', () => handle.setViewRig(rig(Number(depth.value))));

  // 2D/3D switch. The label follows what the display REPORTS, not the click.
  let flat = false;
  const show = () => {
    modeBtn.textContent = flat ? 'Show in 3D' : 'Show in 2D';
    modeBtn.setAttribute('aria-pressed', String(flat));
  };
  handle.on('renderingmodechange', (e) => {
    if (e.viewCount) { flat = e.viewCount === 1; show(); }
  });
  modeBtn.addEventListener('click', () => {
    handle.setStereoEnabled(flat).catch(() => {
      // No flat mode on this display (nothing changed): depth 0 is flat on any display.
      flat = !flat;
      depth.value = flat ? 0 : 1;
      handle.setViewRig(rig(Number(depth.value)));
      show();
    });
  });
  show();
  baseHint = 'WASD to walk · click to look with the mouse · or drag';
  showHint();
  await handle.firstWoven;                           // cover until the first woven frame
  cover.remove();                                    // cut, never fade
} else {
  // An ordinary browser: the same room, drawn once per frame with the app camera.
  sizeStore();
  new ResizeObserver(() => sizeStore()).observe(canvas);
  cover.remove();
  depth.disabled = modeBtn.disabled = true;
  modeBtn.textContent = '2D';
  modeNote.textContent = 'Open this page in the DisplayXR Browser on a 3D display to see it in 3D.';
  baseHint = 'WASD to walk · click to look with the mouse · or drag';
  showHint();
  requestAnimationFrame(onMonoFrame);
}
