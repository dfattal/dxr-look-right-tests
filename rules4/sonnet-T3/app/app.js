// First-person walk-through of a small furnished room, inline 3D (camera rig) with a 2D fallback.
// World is authored in METRES (the camera rig's ipd / metersToVirtual are absolute world units).

import * as THREE from 'three';
import { createInline3D } from '@displayxr/inline3d';
import { EyeCamera, cameraRigFromCamera } from '@displayxr/inline3d/three';

// ---- depth settings (see NOTES.md) ----------------------------------------------------------
const CONVERGENCE = 2.5;   // metres, FIXED: mid-room look-ahead; never driven by the gaze
const IPD_FACTOR = 0.8;    // absolute on a camera rig; slightly under 1 to tame near-object pop-out
const FOV = 58;            // vertical degrees
const NEAR = 0.1, FAR = 40;
const EYE_HEIGHT = 1.6;
const KEEP_OUT = 0.5;      // never let the viewer get closer than this to a surface
const MAX_BUFFER_W = 4096; // cap on the side-by-side backing store width

const canvas = document.getElementById('stage');
const cover = document.getElementById('cover');
const statusEl = document.getElementById('status');
const hintEl = document.getElementById('hint');

// A cover must always come off: on a signal, on a timer, and if setup throws.
const dropCover = () => { cover.remove(); };
setTimeout(dropCover, 5000);

// ---- renderer --------------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);          // getViewport() is already backing-store px
renderer.autoClear = false;
renderer.xr.enabled = false;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;   // static scene: bake shadows once
renderer.shadowMap.needsUpdate = true;
renderer.setClearColor(0x23262e, 1);     // dark grey, not black
const maxAniso = renderer.capabilities.getMaxAnisotropy();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x23262e);

// ---- procedural textures ---------------------------------------------------------------------
function canvasTex(w, h, draw, rx = 1, ry = 1) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.anisotropy = maxAniso;
  return t;
}
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

const floorTex = canvasTex(1024, 1024, (g, w, h) => {
  const rows = 10, ph = h / rows;
  for (let r = 0; r < rows; r++) {
    let x = -rnd() * 400;
    while (x < w) {
      const len = 360 + rnd() * 320;
      const l = 40 + rnd() * 8, s = 38 + rnd() * 8;
      g.fillStyle = `hsl(${28 + rnd() * 5},${s}%,${l}%)`;
      g.fillRect(x, r * ph, len, ph);
      for (let i = 0; i < 14; i++) {            // soft grain, low contrast
        g.fillStyle = `rgba(60,35,15,${0.03 + rnd() * 0.04})`;
        g.fillRect(x, r * ph + rnd() * ph, len, 1 + rnd() * 2);
      }
      g.fillStyle = 'rgba(40,24,12,.55)'; g.fillRect(x, r * ph, 2, ph);   // butt seam
      x += len;
    }
    g.fillStyle = 'rgba(40,24,12,.55)'; g.fillRect(0, r * ph, w, 2);       // plank seam
  }
}, 3, 2.5);

const plasterTex = canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = '#ddd5c6'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 6000; i++) {
    g.fillStyle = `rgba(${rnd() > .5 ? '255,255,255' : '90,80,60'},${0.02 + rnd() * 0.03})`;
    g.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 3, 2 + rnd() * 3);
  }
}, 3, 1.5);

const rugTex = canvasTex(512, 384, (g, w, h) => {
  g.fillStyle = '#7a2f33'; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#e1c58b'; g.lineWidth = 10; g.strokeRect(18, 18, w - 36, h - 36);
  g.strokeStyle = '#2f4a63'; g.lineWidth = 18; g.strokeRect(46, 46, w - 92, h - 92);
  g.fillStyle = '#e1c58b';
  for (let i = 0; i < 5; i++) {
    const cx = w * (0.2 + i * 0.15), cy = h / 2;
    g.beginPath(); g.moveTo(cx, cy - 46); g.lineTo(cx + 30, cy); g.lineTo(cx, cy + 46); g.lineTo(cx - 30, cy); g.fill();
  }
});

const paintingTex = (a, b, c) => canvasTex(512, 384, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, a); gr.addColorStop(1, b);
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.fillStyle = c; g.beginPath(); g.arc(w * 0.65, h * 0.4, 70, 0, 7); g.fill();
  g.fillStyle = 'rgba(30,40,60,.7)';
  g.beginPath(); g.moveTo(0, h); g.lineTo(w * 0.3, h * 0.55); g.lineTo(w * 0.55, h); g.fill();
  g.beginPath(); g.moveTo(w * 0.35, h); g.lineTo(w * 0.7, h * 0.65); g.lineTo(w, h); g.fill();
});

const skyTex = canvasTex(1024, 256, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, '#6f9ad0'); gr.addColorStop(0.6, '#b9d3ea'); gr.addColorStop(1, '#d9e4ea');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,255,255,.55)';
  for (let i = 0; i < 9; i++) {
    const x = rnd() * w, y = 30 + rnd() * 110;
    for (let k = 0; k < 6; k++) { g.beginPath(); g.ellipse(x + k * 22, y + rnd() * 10, 40, 14, 0, 0, 7); g.fill(); }
  }
  g.fillStyle = '#8fae94'; g.beginPath(); g.moveTo(0, h);
  for (let x = 0; x <= w; x += 32) g.lineTo(x, h * 0.78 - Math.sin(x * 0.012) * 18 - rnd() * 6);
  g.lineTo(w, h); g.fill();
});

// ---- materials -------------------------------------------------------------------------------
const M = {
  floor: new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.65 }),
  wall: new THREE.MeshStandardMaterial({ map: plasterTex, roughness: 0.95 }),
  ceiling: new THREE.MeshStandardMaterial({ color: 0xece7dc, roughness: 1 }),
  trim: new THREE.MeshStandardMaterial({ color: 0xf2eee6, roughness: 0.5 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x8a5a34, roughness: 0.55 }),
  woodDark: new THREE.MeshStandardMaterial({ color: 0x4b3020, roughness: 0.6 }),
  fabric: new THREE.MeshStandardMaterial({ color: 0x3f6b7a, roughness: 0.9 }),
  metal: new THREE.MeshStandardMaterial({ color: 0x2c2c30, roughness: 0.35, metalness: 0.7 }),
  shade: new THREE.MeshStandardMaterial({ color: 0xffd9a0, emissive: 0xffc070, emissiveIntensity: 0.85,
    roughness: 0.9, side: THREE.DoubleSide }),
  rug: new THREE.MeshStandardMaterial({ map: rugTex, roughness: 1 }),
  glass: new THREE.MeshBasicMaterial({ color: 0xcfe6ff, transparent: true, opacity: 0.08, depthWrite: false }),
  leaf: new THREE.MeshBasicMaterial({ color: 0x5d8a58 }),
  trunk: new THREE.MeshBasicMaterial({ color: 0x6b5340 }),
  ground: new THREE.MeshBasicMaterial({ color: 0x86a77a }),
  sky: new THREE.MeshBasicMaterial({ map: skyTex, toneMapped: false }),
};

function box(w, h, d, mat, x, y, z, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = cast; m.receiveShadow = receive;
  scene.add(m);
  return m;
}
function boundsBox(x0, x1, y0, y1, z0, z1, mat) {
  return box(x1 - x0, y1 - y0, z1 - z0, mat, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
}

// ---- room shell: 6 m (x) × 5 m (z) × 2.7 m, window in the back wall ---------------------------
const RX = 3, RZ = 2.5, RH = 2.7, T = 0.12;
const floor = new THREE.Mesh(new THREE.PlaneGeometry(RX * 2, RZ * 2), M.floor);
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
boundsBox(-RX - T, RX + T, RH, RH + T, -RZ - T, RZ + T, M.ceiling);
boundsBox(-RX - T, -RX, 0, RH, -RZ - T, RZ + T, M.wall);   // left
boundsBox(RX, RX + T, 0, RH, -RZ - T, RZ + T, M.wall);     // right
boundsBox(-RX, RX, 0, RH, RZ, RZ + T, M.wall);             // front (behind the spawn)
// back wall with a window opening
const WX0 = -1.4, WX1 = 0.2, WY0 = 0.95, WY1 = 2.15;
boundsBox(-RX, WX0, 0, RH, -RZ - T, -RZ, M.wall);
boundsBox(WX1, RX, 0, RH, -RZ - T, -RZ, M.wall);
boundsBox(WX0, WX1, 0, WY0, -RZ - T, -RZ, M.wall);
boundsBox(WX0, WX1, WY1, RH, -RZ - T, -RZ, M.wall);
// window frame, sill and mullions (these cast the sun pattern onto the floor)
const fz = -RZ + 0.03;
boundsBox(WX0 - 0.04, WX1 + 0.04, WY0 - 0.04, WY0 + 0.03, fz - 0.1, fz + 0.1, M.trim);
boundsBox(WX0 - 0.04, WX1 + 0.04, WY1 - 0.03, WY1 + 0.04, fz - 0.05, fz + 0.05, M.trim);
boundsBox(WX0 - 0.04, WX0 + 0.03, WY0, WY1, fz - 0.05, fz + 0.05, M.trim);
boundsBox(WX1 - 0.03, WX1 + 0.04, WY0, WY1, fz - 0.05, fz + 0.05, M.trim);
boundsBox((WX0 + WX1) / 2 - 0.02, (WX0 + WX1) / 2 + 0.02, WY0, WY1, fz - 0.03, fz + 0.03, M.trim);
boundsBox(WX0, WX1, (WY0 + WY1) / 2 - 0.02, (WY0 + WY1) / 2 + 0.02, fz - 0.03, fz + 0.03, M.trim);
const glass = new THREE.Mesh(new THREE.PlaneGeometry(WX1 - WX0, WY1 - WY0), M.glass);
glass.position.set((WX0 + WX1) / 2, (WY0 + WY1) / 2, -RZ - 0.02); scene.add(glass);
// baseboards
for (const [x0, x1, z0, z1] of [[-RX, RX, -RZ, -RZ + 0.02], [-RX, RX, RZ - 0.02, RZ],
  [-RX, -RX + 0.02, -RZ, RZ], [RX - 0.02, RX, -RZ, RZ]]) {
  boundsBox(x0 - (x1 - x0 < 0.1 ? 0.01 : 0), x1, 0, 0.1, z0 - (z1 - z0 < 0.1 ? 0.01 : 0), z1, M.trim);
}

// outdoors, seen through the window: soft mid-tone sky, hills, a few trees
const sky = new THREE.Mesh(new THREE.PlaneGeometry(40, 10), M.sky);
sky.position.set(0, 3.5, -16); scene.add(sky);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 20), M.ground);
ground.rotation.x = -Math.PI / 2; ground.position.set(0, -0.05, -12); scene.add(ground);
for (const [x, z, s] of [[-3, -7, 1.2], [1.8, -9, 1.5], [-0.8, -12, 1.8], [4, -6, 1.1], [-5, -10, 1.6]]) {
  const t = new THREE.Mesh(new THREE.CylinderGeometry(0.1 * s, 0.14 * s, 1.2 * s, 8), M.trunk);
  t.position.set(x, 0.6 * s, z); scene.add(t);
  const l = new THREE.Mesh(new THREE.ConeGeometry(0.8 * s, 2.2 * s, 10), M.leaf);
  l.position.set(x, 2.1 * s, z); scene.add(l);
}

// ---- furniture + colliders -------------------------------------------------------------------
const colliders = [];   // {x0,x1,z0,z1}
const addCollider = (cx, cz, w, d) => colliders.push({ x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2 });

// rug
const rug = new THREE.Mesh(new THREE.PlaneGeometry(2.9, 2.2), M.rug);
rug.rotation.x = -Math.PI / 2; rug.position.set(0, 0.006, -0.3); rug.receiveShadow = true; scene.add(rug);

// table
const TX = 0, TZ = -0.3;
box(1.6, 0.06, 0.9, M.wood, TX, 0.75, TZ);
for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.07, 0.72, 0.07, M.woodDark, TX + sx * 0.73, 0.36, TZ + sz * 0.38);
addCollider(TX, TZ, 1.6, 0.9);

function chair(x, z, rotY) {
  const g = new THREE.Group();
  const add = (w, h, d, mat, px, py, pz) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(px, py, pz); m.castShadow = m.receiveShadow = true; g.add(m);
  };
  add(0.46, 0.05, 0.44, M.fabric, 0, 0.46, 0);
  add(0.46, 0.5, 0.04, M.fabric, 0, 0.75, -0.2);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(0.04, 0.44, 0.04, M.woodDark, sx * 0.2, 0.22, sz * 0.19);
  for (const sx of [-1, 1]) add(0.04, 0.5, 0.04, M.woodDark, sx * 0.2, 0.7, -0.2);
  g.position.set(x, 0, z); g.rotation.y = rotY; scene.add(g);
  addCollider(x, z, 0.5, 0.5);
}
chair(-0.4, TZ + 0.78, Math.PI + 0.12);
chair(0.4, TZ + 0.74, Math.PI - 0.08);
chair(-0.4, TZ - 0.78, 0.05);
chair(0.45, TZ - 0.82, -0.2);

// table lamp (the shadow-casting warm light)
box(0.16, 0.02, 0.16, M.metal, 0.5, 0.79, TZ - 0.1);
const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.32, 8), M.metal);
stem.position.set(0.5, 0.95, TZ - 0.1); stem.castShadow = true; scene.add(stem);
const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.17, 0.2, 20, 1, true), M.shade);
shade.position.set(0.5, 1.2, TZ - 0.1); scene.add(shade);
const tableLight = new THREE.PointLight(0xffc27a, 7, 8, 2);
tableLight.position.set(0.5, 1.17, TZ - 0.1);
tableLight.castShadow = true;
tableLight.shadow.mapSize.set(1024, 1024);
tableLight.shadow.bias = -0.002; tableLight.shadow.normalBias = 0.03;
scene.add(tableLight);
// things on the table
box(0.3, 0.025, 0.2, new THREE.MeshStandardMaterial({ color: 0xa33b3b, roughness: 0.7 }), -0.4, 0.79, TZ + 0.1);
box(0.28, 0.025, 0.19, new THREE.MeshStandardMaterial({ color: 0x2f6f8f, roughness: 0.7 }), -0.4, 0.815, TZ + 0.1);
const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: 0xe9e4da, roughness: 0.3, side: THREE.DoubleSide }));
bowl.position.set(-0.05, 0.9, TZ - 0.15); bowl.castShadow = true; scene.add(bowl);
for (const [dx, dz, c] of [[-0.05, -0.15, 0xd9482b], [0.0, -0.1, 0xe8b53a], [-0.1, -0.1, 0x7fa343]]) {
  const f = new THREE.Mesh(new THREE.SphereGeometry(0.045, 14, 10), new THREE.MeshStandardMaterial({ color: c, roughness: 0.5 }));
  f.position.set(dx, 0.81, TZ + dz); f.castShadow = true; scene.add(f);
}

// floor lamp, back-left corner
{
  const lx = -2.5, lz = -2.0;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.04, 20), M.metal);
  base.position.set(lx, 0.02, lz); scene.add(base);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.5, 8), M.metal);
  pole.position.set(lx, 0.78, lz); pole.castShadow = true; scene.add(pole);
  const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.26, 0.34, 24, 1, true), M.shade);
  sh.position.set(lx, 1.62, lz); scene.add(sh);
  const l = new THREE.PointLight(0xffc98a, 3.5, 6, 2);
  l.position.set(lx, 1.6, lz); scene.add(l);
  addCollider(lx, lz, 0.5, 0.5);
}

// bookshelf on the right wall
{
  const bx = RX - 0.2, z0 = -1.7, z1 = -0.3, zc = (z0 + z1) / 2;
  box(0.36, 2.1, 0.04, M.wood, bx, 1.05, z0); box(0.36, 2.1, 0.04, M.wood, bx, 1.05, z1);
  box(0.02, 2.1, z1 - z0, M.woodDark, RX - 0.03, 1.05, zc);
  for (let i = 0; i < 6; i++) box(0.34, 0.03, z1 - z0, M.wood, bx, 0.05 + i * 0.4, zc);
  for (let r = 0; r < 5; r++) {
    let z = z0 + 0.06;
    while (z < z1 - 0.1) {
      const w = 0.03 + rnd() * 0.04, h = 0.24 + rnd() * 0.12;
      const col = new THREE.Color().setHSL(rnd(), 0.35 + rnd() * 0.25, 0.32 + rnd() * 0.15);
      box(0.22, h, w, new THREE.MeshStandardMaterial({ color: col, roughness: 0.8 }), bx + 0.02, 0.065 + r * 0.4 + h / 2, z + w / 2, { cast: false });
      z += w + 0.004;
      if (rnd() < 0.08) z += 0.12;
    }
  }
  addCollider(bx, zc, 0.4, z1 - z0);
}

// sideboard + painting on the left wall
{
  const sx = -RX + 0.25, sz = 0.6;
  box(0.45, 0.8, 1.6, M.wood, sx, 0.4, sz);
  for (let i = 0; i < 3; i++) box(0.01, 0.62, 0.46, M.woodDark, sx + 0.23, 0.4, sz - 0.52 + i * 0.52);
  addCollider(sx, sz, 0.45, 1.6);
  const vase = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.28, 16),
    new THREE.MeshStandardMaterial({ color: 0x3d6f9e, roughness: 0.25 }));
  vase.position.set(sx, 0.94, sz + 0.5); vase.castShadow = true; scene.add(vase);
  for (let i = 0; i < 5; i++) {
    const stemM = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.35, 5), M.trunk);
    stemM.position.set(sx + (i - 2) * 0.012, 1.2, sz + 0.5); stemM.rotation.z = (i - 2) * 0.12; scene.add(stemM);
    const fl = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), new THREE.MeshStandardMaterial({ color: i % 2 ? 0xe86f9a : 0xf2c14e }));
    fl.position.set(sx + (i - 2) * 0.05, 1.4, sz + 0.5); scene.add(fl);
  }
  const frame = (tex, cx, cz, w, h, y) => {
    box(0.04, h + 0.08, w + 0.08, M.woodDark, -RX + 0.03, y, cz, { cast: false });
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex }));
    p.rotation.y = Math.PI / 2; p.position.set(-RX + 0.055, y, cz); scene.add(p);
  };
  frame(paintingTex('#e9b872', '#c4684a', '#fbe9b8'), 0, sz, 1.1, 0.8, 1.7);
}
// a small painting on the front wall behind the spawn is not needed; one on the right of the window:
{
  const p = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.52), new THREE.MeshBasicMaterial({ map: paintingTex('#6fa0b0', '#2f4f6e', '#f0e0b0') }));
  p.position.set(1.7, 1.55, -RZ + 0.03); scene.add(p);
  box(0.78, 0.6, 0.03, M.woodDark, 1.7, 1.55, -RZ + 0.012, { cast: false });
}

// ---- lights ----------------------------------------------------------------------------------
scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x6a5a48, 0.55));
const sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
sun.position.set(-3.5, 5.2, -9);
sun.target.position.set(-0.6, 0, -0.5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 22 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03; sun.shadow.radius = 3;
scene.add(sun, sun.target);

// ---- camera + player -------------------------------------------------------------------------
const appCam = new THREE.PerspectiveCamera(FOV, 16 / 9, NEAR, FAR);
appCam.rotation.order = 'YXZ';
scene.add(appCam);   // in the scene: the parented eye cameras need a traversal
const eyes = [new EyeCamera(THREE), new EyeCamera(THREE)];
for (const e of eyes) appCam.add(e.camera);

const player = { x: 0.2, z: 2.0, yaw: 0, pitch: -0.04, vx: 0, vz: 0 };
const keys = new Set();

function blocked(x, z) {
  if (x < -RX + KEEP_OUT || x > RX - KEEP_OUT || z < -RZ + KEEP_OUT || z > RZ - KEEP_OUT) return true;
  for (const c of colliders) {
    if (x > c.x0 - KEEP_OUT && x < c.x1 + KEEP_OUT && z > c.z0 - KEEP_OUT && z < c.z1 + KEEP_OUT) return true;
  }
  return false;
}

function update(dt) {
  dt = Math.min(dt, 0.05);
  const f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  const s = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  const speed = (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 2.6 : 1.5);
  if (keys.has('ArrowLeft')) player.yaw += 1.6 * dt;
  if (keys.has('ArrowRight')) player.yaw -= 1.6 * dt;
  const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
  // forward = (-sin, -cos); right = (cos, -sin)
  let tx = (-sin * f + cos * s), tz = (-cos * f - sin * s);
  const len = Math.hypot(tx, tz);
  if (len > 1) { tx /= len; tz /= len; }
  const k = 1 - Math.exp(-dt * 10);           // eased acceleration: no jolts in depth
  player.vx += (tx * speed - player.vx) * k;
  player.vz += (tz * speed - player.vz) * k;
  const nx = player.x + player.vx * dt, nz = player.z + player.vz * dt;
  if (!blocked(nx, player.z)) player.x = nx; else player.vx = 0;
  if (!blocked(player.x, nz)) player.z = nz; else player.vz = 0;

  appCam.position.set(player.x, EYE_HEIGHT, player.z);
  appCam.rotation.set(player.pitch, player.yaw, 0);
  appCam.updateMatrixWorld(true);
}

// ---- input -----------------------------------------------------------------------------------
const LOOK = 0.0022;
let looking = false, dragging = false;
function look(dx, dy) {
  player.yaw -= dx * LOOK;
  player.pitch = Math.max(-1.2, Math.min(1.2, player.pitch - dy * LOOK));
}
addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
canvas.addEventListener('click', () => {
  if (!document.pointerLockElement && canvas.requestPointerLock) {
    try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch { /* drag fallback */ }
  }
});
document.addEventListener('pointerlockchange', () => {
  looking = document.pointerLockElement === canvas;
  hintEl.style.display = looking ? 'none' : '';
});
canvas.addEventListener('pointerdown', () => { dragging = true; });
addEventListener('pointerup', () => { dragging = false; });
addEventListener('pointermove', (e) => {
  if (looking || dragging) look(e.movementX || 0, e.movementY || 0);
});

// ---- backing store ---------------------------------------------------------------------------
let woven = false;
let wall = null, handle = null;
const good = [0, 1].map(() => ({ proj: new Float32Array(16), pose: new Float32Array(16), x: 0, y: 0, width: 0, height: 0 }));
let haveGood = false;

function sizeBuffer() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let w = Math.round((canvas.clientWidth || innerWidth) * dpr);
  let h = Math.round((canvas.clientHeight || innerHeight) * dpr);
  const cssAspect = (canvas.clientWidth || innerWidth) / (canvas.clientHeight || innerHeight);
  const bufW = woven ? w * 2 : w;
  const scale = Math.min(1, MAX_BUFFER_W / bufW);   // keep the SBS store sane (and above 0.5 scale)
  w = Math.round(w * scale); h = Math.round(h * scale);
  const outW = woven ? w * 2 : w;
  if (renderer.domElement.width !== outW || renderer.domElement.height !== h) {
    renderer.setSize(outW, h, false);   // only when changed: setSize clears the buffer
    appCam.aspect = cssAspect;
    appCam.updateProjectionMatrix();
    if (woven) replayLastGood(); else renderMono();
  }
}
addEventListener('resize', sizeBuffer);

// ---- stereo render ---------------------------------------------------------------------------
const rigScratch = {};
let lastNear = 0, lastFar = 0;

function pushRig() {
  handle.setViewRig(cameraRigFromCamera(THREE, appCam, {
    convergence: CONVERGENCE, attach: true, ipdFactor: IPD_FACTOR, out: rigScratch,
  }));
}
function syncDepthRange() {
  if (appCam.near === lastNear && appCam.far === lastFar) return;
  try { wall.session.updateRenderState({ depthNear: appCam.near, depthFar: appCam.far }); lastNear = appCam.near; lastFar = appCam.far; } catch { /* retry next frame */ }
}

function replayLastGood() {
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

let lastT = performance.now();
function onFrame(views, layer) {
  const now = performance.now();
  update((now - lastT) / 1000); lastT = now;
  // Pushed before the validity gate: a rig drives the NEXT locate.
  pushRig();
  syncDepthRange();

  if (!views || views.length < 2 || !layer) return replayLastGood();
  const vps = views.map((v) => layer.getViewport(v));
  if (vps.some((vp) => !vp || vp.width <= 0 || vp.height <= 0)) return replayLastGood();

  renderer.clear();
  renderer.setScissorTest(true);
  for (let i = 0; i < 2; i++) {
    const vp = vps[i], g = good[i];
    renderer.setViewport(vp.x, vp.y, vp.width, vp.height);
    renderer.setScissor(vp.x, vp.y, vp.width, vp.height);
    eyes[i].setLocalFromView(views[i]);
    renderer.render(scene, eyes[i].camera);
    g.proj.set(views[i].projectionMatrix); g.pose.set(views[i].transform.matrix);   // copies
    g.x = vp.x; g.y = vp.y; g.width = vp.width; g.height = vp.height;
  }
  renderer.setScissorTest(false);
  haveGood = true;
}

// ---- 2D fallback -----------------------------------------------------------------------------
function renderMono() {
  renderer.clear();
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, renderer.domElement.width, renderer.domElement.height);
  renderer.render(scene, appCam);
}
function monoLoop() {
  requestAnimationFrame(monoLoop);
  const now = performance.now();
  update((now - lastT) / 1000); lastT = now;
  renderMono();
}

// ---- boot ------------------------------------------------------------------------------------
(async () => {
  try {
    update(0);
    sizeBuffer();
    wall = await createInline3D({ lazy: false });
    if (!wall.supported) throw new Error('mono');
    woven = true;
    sizeBuffer();
    syncDepthRange();
    handle = wall.addScene(canvas, onFrame, {
      virtualDisplayHeight: 1.2,   // framing older browsers fall back to without rig support
      viewRig: cameraRigFromCamera(THREE, appCam, { convergence: CONVERGENCE, attach: true, ipdFactor: IPD_FACTOR, out: rigScratch }),
      onResize: () => sizeBuffer(),
      onLayerLost: () => { woven = false; haveGood = false; sizeBuffer(); lastT = performance.now(); requestAnimationFrame(monoLoop); statusEl.textContent = '2D mode'; },
    });
    statusEl.textContent = '3D active';
    handle.firstWoven.then(dropCover, dropCover);
  } catch (err) {
    if (err && err.message !== 'mono') console.warn('[room] inline-3D setup failed, using 2D', err);
    woven = false;
    sizeBuffer();
    statusEl.textContent = '2D mode (open in the DisplayXR Browser for 3D)';
    requestAnimationFrame(monoLoop);
    requestAnimationFrame(dropCover);
  }
})();
