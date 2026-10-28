// First-person walk-through of a small furnished room, for the DisplayXR inline-3D SDK.
//
// Rig: CAMERA rig (the visitor IS somewhere and moves), attach pattern (identity-posed rig, eye
// cameras parented under the app camera, so there is no one-frame stereo lag while looking around).
// The scene is authored in metres, because on a camera rig ipd / metersToVirtual are absolute.

import * as THREE from 'three';

const canvas = document.getElementById('stage');
const statusEl = document.getElementById('status');
const coverEl = document.getElementById('cover');
const helpEl = document.getElementById('help');

// ---- depth settings (see NOTES.md) -------------------------------------------------------------
const FOV = 62;            // vertical degrees, a natural first-person view
const NEAR = 0.1, FAR = 60;
const CONVERGENCE = 2.6;   // m: fixed look-ahead, never hit-tested. Room centre sits on the glass.
const IPD_FACTOR = 0.8;    // absolute on a camera rig; slightly under 1 as rooms put things close
const EYE_HEIGHT = 1.6;
const BODY_RADIUS = 0.55;  // keeps nearest surface >= ~0.5 m from the eye (limits crossed disparity)

// ---- renderer ----------------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);            // getViewport() is already in backing-store px
renderer.autoClear = false;
renderer.xr.enabled = false;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const MAX_ANISO = Math.min(8, renderer.capabilities.getMaxAnisotropy());

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x15151a);
const appCam = new THREE.PerspectiveCamera(FOV, 16 / 9, NEAR, FAR);
scene.add(appCam);                    // IN the scene: parented eye cameras need a traversal

// ---- procedural textures -----------------------------------------------------------------------
function makeTex(w, h, draw, repeat = [1, 1], srgb = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = MAX_ANISO;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function woodDraw(base, planks, vertical) {
  return (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    const n = planks, sz = (vertical ? w : h) / n;
    for (let i = 0; i < n; i++) {
      const l = 0.9 + rnd() * 0.2;
      g.fillStyle = `rgba(${l > 1 ? 255 : 0},${l > 1 ? 230 : 0},${l > 1 ? 190 : 0},${Math.abs(l - 1) * 0.9})`;
      if (vertical) g.fillRect(i * sz, 0, sz, h); else g.fillRect(0, i * sz, w, sz);
      for (let k = 0; k < 14; k++) {      // grain: soft low-contrast streaks
        g.strokeStyle = `rgba(60,35,15,${0.03 + rnd() * 0.05})`;
        g.lineWidth = 1 + rnd() * 2;
        g.beginPath();
        if (vertical) { const x = i * sz + rnd() * sz; g.moveTo(x, 0); g.lineTo(x + (rnd() - .5) * 8, h); }
        else { const y = i * sz + rnd() * sz; g.moveTo(0, y); g.lineTo(w, y + (rnd() - .5) * 8); }
        g.stroke();
      }
      g.strokeStyle = 'rgba(40,22,10,0.28)'; g.lineWidth = 2;   // seam, low contrast to avoid shimmer
      g.beginPath();
      if (vertical) { g.moveTo(i * sz, 0); g.lineTo(i * sz, h); } else { g.moveTo(0, i * sz); g.lineTo(w, i * sz); }
      g.stroke();
    }
  };
}
const floorTex = makeTex(1024, 1024, woodDraw('#a9764a', 8, false), [2.5, 2.25]);
const tableTex = makeTex(512, 512, woodDraw('#6b4226', 6, false), [1, 1]);
const darkWoodTex = makeTex(256, 256, woodDraw('#4a2e1c', 4, true), [1, 1]);
const plasterTex = makeTex(512, 512, (g, w, h) => {
  g.fillStyle = '#d9d2c3'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 2500; i++) {
    g.fillStyle = `rgba(${rnd() > .5 ? '255,255,255' : '120,100,80'},${rnd() * 0.05})`;
    g.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 6, 2 + rnd() * 6);
  }
}, [3, 1.5]);
const rugTex = makeTex(512, 512, (g, w, h) => {
  g.fillStyle = '#8c2f2f'; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#e9d9a8'; g.lineWidth = 14; g.strokeRect(24, 24, w - 48, h - 48);
  g.strokeStyle = '#2d3f5c'; g.lineWidth = 22; g.strokeRect(60, 60, w - 120, h - 120);
  g.fillStyle = '#e9d9a8';
  g.beginPath(); g.moveTo(w / 2, 130); g.lineTo(w - 130, h / 2); g.lineTo(w / 2, h - 130); g.lineTo(130, h / 2); g.closePath(); g.fill();
  g.fillStyle = '#2d3f5c';
  g.beginPath(); g.moveTo(w / 2, 190); g.lineTo(w - 190, h / 2); g.lineTo(w / 2, h - 190); g.lineTo(190, h / 2); g.closePath(); g.fill();
}, [1, 1]);
const skyTex = makeTex(8, 256, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, '#5d9be0'); gr.addColorStop(0.65, '#bcdcf5'); gr.addColorStop(1, '#f2ead2');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
});
const blobTex = makeTex(128, 128, (g, w, h) => {
  const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  gr.addColorStop(0, 'rgba(0,0,0,0.5)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
}, [1, 1], false);

const M = {
  floor: new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.7 }),
  wall: new THREE.MeshStandardMaterial({ map: plasterTex, roughness: 0.95 }),
  ceil: new THREE.MeshStandardMaterial({ color: 0xece7da, roughness: 1 }),
  trim: new THREE.MeshStandardMaterial({ color: 0xf1ede3, roughness: 0.6 }),
  table: new THREE.MeshStandardMaterial({ map: tableTex, roughness: 0.55 }),
  chair: new THREE.MeshStandardMaterial({ map: darkWoodTex, roughness: 0.6 }),
  cushion: new THREE.MeshStandardMaterial({ color: 0x3b6a73, roughness: 0.9 }),
  metal: new THREE.MeshStandardMaterial({ color: 0x2b2b2e, roughness: 0.45, metalness: 0.6 }),
  rug: new THREE.MeshStandardMaterial({ map: rugTex, roughness: 1 }),
  frame: new THREE.MeshStandardMaterial({ color: 0xf5f2ea, roughness: 0.5 }),
  glass: new THREE.MeshBasicMaterial({ color: 0xffffff, map: skyTex }),
};

const root = new THREE.Group();
scene.add(root);
function box(w, h, d, mat, x, y, z, parent = root) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
function blob(x, z, sx, sz) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(sx, sz),
    new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.set(x, 0.006, z);
  root.add(m);
}

// ---- room: 5.0 x 4.5 x 2.7 m, window in the back (-z) wall ------------------------------------
const RX = 2.5, RZ = 2.25, RH = 2.7, T = 0.2;
const floor = new THREE.Mesh(new THREE.PlaneGeometry(RX * 2, RZ * 2), M.floor);
floor.rotation.x = -Math.PI / 2; root.add(floor);
const ceil = new THREE.Mesh(new THREE.PlaneGeometry(RX * 2, RZ * 2), M.ceil);
ceil.rotation.x = Math.PI / 2; ceil.position.y = RH; root.add(ceil);

box(T, RH, RZ * 2 + 2 * T, M.wall, -RX - T / 2, RH / 2, 0);                 // left
box(T, RH, RZ * 2 + 2 * T, M.wall, RX + T / 2, RH / 2, 0);                  // right
box(RX * 2, RH, T, M.wall, 0, RH / 2, RZ + T / 2);                          // front
// back wall with window opening x∈[-0.95,0.95], y∈[0.95,2.15]
const WX = 0.95, WY0 = 0.95, WY1 = 2.15, bz = -RZ - T / 2;
box(RX - WX, RH, T, M.wall, -(RX + WX) / 2, RH / 2, bz);
box(RX - WX, RH, T, M.wall, (RX + WX) / 2, RH / 2, bz);
box(WX * 2, WY0, T, M.wall, 0, WY0 / 2, bz);
box(WX * 2, RH - WY1, T, M.wall, 0, (RH + WY1) / 2, bz);
// frame, mullions, sill
const fz = -RZ - 0.02;
box(0.06, WY1 - WY0, 0.1, M.trim, -WX, (WY0 + WY1) / 2, fz);
box(0.06, WY1 - WY0, 0.1, M.trim, WX, (WY0 + WY1) / 2, fz);
box(WX * 2, 0.06, 0.1, M.trim, 0, WY1, fz);
box(WX * 2 + 0.2, 0.05, 0.3, M.trim, 0, WY0, -RZ + 0.08);
box(0.04, WY1 - WY0, 0.06, M.trim, 0, (WY0 + WY1) / 2, fz);
box(WX * 2, 0.04, 0.06, M.trim, 0, (WY0 + WY1) / 2, fz);
// baseboards
const bb = 0.11;
box(RX * 2, bb, 0.03, M.trim, 0, bb / 2, RZ - 0.015);
box(0.03, bb, RZ * 2, M.trim, -RX + 0.015, bb / 2, 0);
box(0.03, bb, RZ * 2, M.trim, RX - 0.015, bb / 2, 0);
box(RX - WX, bb, 0.03, M.trim, -(RX + WX) / 2, bb / 2, -RZ + 0.015);
box(RX - WX, bb, 0.03, M.trim, (RX + WX) / 2, bb / 2, -RZ + 0.015);

// the outside: sky, then layers of distant hills / trees at increasing depth (real parallax)
const sky = new THREE.Mesh(new THREE.PlaneGeometry(80, 40), M.glass);
sky.position.set(0, 8, -28); root.add(sky);
function hill(x, z, w, h, col) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.15, w * 0.5, h, 24, 1), new THREE.MeshBasicMaterial({ color: col }));
  m.scale.z = 0.4; m.position.set(x, h / 2 - 0.5, z); root.add(m);
}
hill(-5, -24, 22, 4, 0x9db4a0); hill(7, -22, 20, 3, 0x93ab97); hill(0, -18, 18, 2.2, 0x7e9b80);
function tree(x, z, s) {
  const g = new THREE.Group();
  box(0.18 * s, 1.4 * s, 0.18 * s, new THREE.MeshBasicMaterial({ color: 0x5b4330 }), 0, 0.7 * s, 0, g);
  const c = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9 * s, 1), new THREE.MeshBasicMaterial({ color: 0x4f8a4c }));
  c.position.y = 2.0 * s; g.add(c);
  g.position.set(x, 0, z); root.add(g);
}
tree(-1.4, -6, 1.2); tree(1.8, -9, 1.5); tree(-3.5, -13, 1.8);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 60), new THREE.MeshBasicMaterial({ color: 0x86a96c }));
ground.rotation.x = -Math.PI / 2; ground.position.set(0, -0.02, -30); root.add(ground);

// ---- furniture ---------------------------------------------------------------------------------
const obstacles = [];   // {x, z, hx, hz} in the xz plane
const addObstacle = (x, z, hx, hz) => obstacles.push({ x, z, hx, hz });

// rug
const rug = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 2.4), M.rug);
rug.rotation.x = -Math.PI / 2; rug.position.set(0, 0.008, -0.3); root.add(rug);

// table
const TX = 0, TZ = -0.3;
box(1.7, 0.06, 0.95, M.table, TX, 0.76, TZ);
for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.07, 0.73, 0.07, M.chair, TX + sx * 0.77, 0.365, TZ + sz * 0.4);
box(1.5, 0.08, 0.05, M.chair, TX, 0.68, TZ - 0.4); box(1.5, 0.08, 0.05, M.chair, TX, 0.68, TZ + 0.4);
addObstacle(TX, TZ, 0.9, 0.5);
blob(TX, TZ, 2.4, 1.6);
// things on the table
const vase = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.26, 20), new THREE.MeshStandardMaterial({ color: 0x2e5c8a, roughness: 0.3 }));
vase.position.set(-0.1, 0.92, TZ); root.add(vase);
for (let i = 0; i < 5; i++) {
  const s = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.3, 5), new THREE.MeshStandardMaterial({ color: 0x4f7a3a }));
  s.position.set(-0.1 + (i - 2) * 0.02, 1.17, TZ + (i % 2 - .5) * 0.03); s.rotation.z = (i - 2) * 0.12; root.add(s);
  const f = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), new THREE.MeshStandardMaterial({ color: [0xe85d5d, 0xf2c14e, 0xf08fc0][i % 3] }));
  f.position.set(-0.1 + (i - 2) * 0.045, 1.32, TZ + (i % 2 - .5) * 0.03); root.add(f);
}
const bookCols = [0xa83a3a, 0x3a6aa8, 0xd2b04c];
bookCols.forEach((c, i) => box(0.24 - i * 0.02, 0.035, 0.17, new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 }), 0.4, 0.8 + i * 0.035, TZ + 0.1, root).rotation.y = 0.2 * i);
const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.032, 0.08, 16), new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.3 }));
cup.position.set(-0.5, 0.83, TZ + 0.15); root.add(cup);

// chairs: 2 on each long side, facing the table
function chair(x, z, rotY) {
  const g = new THREE.Group();
  box(0.44, 0.05, 0.44, M.chair, 0, 0.45, 0, g);
  box(0.4, 0.05, 0.4, M.cushion, 0, 0.5, 0, g);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.04, 0.43, 0.04, M.chair, sx * 0.19, 0.215, sz * 0.19, g);
  for (const sx of [-1, 1]) box(0.04, 0.5, 0.04, M.chair, sx * 0.19, 0.7, -0.2, g);
  box(0.4, 0.07, 0.03, M.chair, 0, 0.9, -0.2, g);
  box(0.4, 0.07, 0.03, M.chair, 0, 0.77, -0.2, g);
  g.position.set(x, 0, z); g.rotation.y = rotY; root.add(g);
  addObstacle(x, z, 0.26, 0.26);
  blob(x, z, 0.9, 0.9);
}
chair(-0.45, TZ + 0.85, Math.PI);   // +z side: back toward +z, facing table (-z)
chair(0.45, TZ + 0.85, Math.PI + 0.12);
chair(-0.45, TZ - 0.85, 0);
chair(0.45, TZ - 0.85, -0.1);

// floor lamp (front-left corner area), the main warm light
const LX = -2.0, LZ = 1.55;
const lamp = new THREE.Group();
box(0.001, 0.001, 0.001, M.metal, 0, 0, 0, lamp);
const base = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.03, 24), M.metal); base.position.y = 0.015; lamp.add(base);
const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.5, 10), M.metal); pole.position.y = 0.78; lamp.add(pole);
const shadeMat = new THREE.MeshStandardMaterial({ color: 0xffe2b0, emissive: 0xffb764, emissiveIntensity: 1.1, roughness: 0.9, side: THREE.DoubleSide });
const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.26, 0.32, 28, 1, true), shadeMat); shade.position.y = 1.62; lamp.add(shade);
const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), new THREE.MeshBasicMaterial({ color: 0xfff1d0 })); bulb.position.y = 1.58; lamp.add(bulb);
lamp.position.set(LX, 0, LZ); root.add(lamp);
addObstacle(LX, LZ, 0.2, 0.2);
blob(LX, LZ, 0.9, 0.9);

// bookshelf on the left wall
const SZ = -0.4;
const shelfM = M.chair;
box(0.34, 1.9, 1.4, shelfM, -RX + 0.17, 0.95, SZ);
for (let i = 0; i < 5; i++) box(0.3, 0.03, 1.32, M.table, -RX + 0.19, 0.2 + i * 0.4, SZ);
box(0.02, 1.86, 1.32, M.chair, -RX + 0.02 + 0.05, 0.95, SZ);
let bi = 0;
for (let r = 0; r < 4; r++) {
  let z = SZ - 0.6;
  while (z < SZ + 0.58) {
    const w = 0.04 + rnd() * 0.04, h = 0.22 + rnd() * 0.1;
    const col = new THREE.Color().setHSL(rnd(), 0.4 + rnd() * 0.3, 0.35 + rnd() * 0.15);
    box(0.22, h, w, new THREE.MeshStandardMaterial({ color: col, roughness: 0.8 }), -RX + 0.2, 0.215 + r * 0.4 + h / 2, z + w / 2);
    z += w + 0.004; bi++;
  }
}
addObstacle(-RX + 0.17, SZ, 0.2, 0.72);

// plant in the front-right corner
const PX = 2.0, PZ = 1.6;
const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.15, 0.32, 20), new THREE.MeshStandardMaterial({ color: 0xb4623f, roughness: 0.8 }));
pot.position.set(PX, 0.16, PZ); root.add(pot);
const leafM = new THREE.MeshStandardMaterial({ color: 0x3f7d3a, roughness: 0.7 });
for (let i = 0; i < 9; i++) {
  const a = i / 9 * Math.PI * 2, leaf = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8), leafM);
  leaf.scale.set(0.5, 1.4, 0.2); leaf.position.set(PX + Math.cos(a) * 0.16, 0.65 + (i % 3) * 0.12, PZ + Math.sin(a) * 0.16);
  leaf.rotation.set(Math.sin(a) * 0.5, -a, -Math.cos(a) * 0.5); root.add(leaf);
}
addObstacle(PX, PZ, 0.25, 0.25);
blob(PX, PZ, 0.9, 0.9);

// wall pictures (right wall)
function picture(z, y, w, h, col) {
  const g = new THREE.Group();
  box(0.04, h + 0.08, w + 0.08, M.frame, 0, 0, 0, g);
  const art = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({
    map: makeTex(128, 128, (c, W, H) => {
      c.fillStyle = col[0]; c.fillRect(0, 0, W, H);
      c.fillStyle = col[1]; c.beginPath(); c.arc(W * 0.62, H * 0.4, W * 0.2, 0, 7); c.fill();
      c.fillStyle = col[2]; c.fillRect(0, H * 0.7, W, H * 0.3);
    }),
  }));
  art.rotation.y = -Math.PI / 2; art.position.x = -0.022; g.add(art);
  g.position.set(RX - 0.03, y, z); root.add(g);
}
picture(-0.9, 1.6, 0.7, 0.5, ['#e8d7b5', '#d9534f', '#3d6b8a']);
picture(0.4, 1.55, 0.45, 0.6, ['#2e4057', '#f2c14e', '#7a9e7e']);
picture(1.3, 1.65, 0.6, 0.4, ['#f4e3d7', '#4a7c8c', '#c9704a']);

// ---- lights ------------------------------------------------------------------------------------
scene.add(new THREE.HemisphereLight(0xdfeaff, 0x7a6350, 0.9));
const sun = new THREE.DirectionalLight(0xfff2dc, 1.5);     // daylight from the window
sun.position.set(0.5, 3, -6); sun.target.position.set(0, 0, 1); scene.add(sun, sun.target);
const lampLight = new THREE.PointLight(0xffb870, 14, 9, 2);
lampLight.position.set(LX, 1.5, LZ - 0.05); scene.add(lampLight);

// ---- player / controls -------------------------------------------------------------------------
const P = { x: 0.9, z: 1.5, yaw: 0, pitch: 0, vx: 0, vz: 0 };
const keys = new Set();
addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'KeyL') (document.pointerLockElement ? document.exitPointerLock() : canvas.requestPointerLock?.());
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  hideHelpSoon();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

let drag = null;
canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; canvas.classList.add('dragging'); canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', (e) => {
  if (document.pointerLockElement === canvas) return look(e.movementX, e.movementY);
  if (!drag) return;
  look(e.clientX - drag.x, e.clientY - drag.y);
  drag = { x: e.clientX, y: e.clientY };
});
const endDrag = () => { drag = null; canvas.classList.remove('dragging'); };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
function look(dx, dy) {
  P.yaw -= dx * 0.0035;
  P.pitch = Math.max(-1.1, Math.min(1.1, P.pitch - dy * 0.0035));
  hideHelpSoon();
}
let helpTimer = 0;
function hideHelpSoon() {   // display:none (never opacity) so no stale element lingers over the weave
  if (helpTimer) return;
  helpTimer = setTimeout(() => { helpEl.style.display = 'none'; }, 12000);
}

function resolveCollisions() {
  const r = BODY_RADIUS;
  P.x = Math.max(-RX + r, Math.min(RX - r, P.x));
  P.z = Math.max(-RZ + r, Math.min(RZ - r, P.z));
  for (let it = 0; it < 3; it++) for (const o of obstacles) {
    const cx = Math.max(o.x - o.hx, Math.min(o.x + o.hx, P.x));
    const cz = Math.max(o.z - o.hz, Math.min(o.z + o.hz, P.z));
    let dx = P.x - cx, dz = P.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    if (d2 > 1e-8) { const d = Math.sqrt(d2); P.x = cx + dx / d * r; P.z = cz + dz / d * r; }
    else { // centre inside the box: push out along the shallowest axis
      const px = o.hx - Math.abs(P.x - o.x), pz = o.hz - Math.abs(P.z - o.z);
      if (px < pz) P.x = o.x + Math.sign(P.x - o.x || 1) * (o.hx + r); else P.z = o.z + Math.sign(P.z - o.z || 1) * (o.hz + r);
    }
  }
}

let lastT = performance.now();
function update() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  const turn = (keys.has('ArrowLeft') ? 1 : 0) - (keys.has('ArrowRight') ? 1 : 0);
  if (turn) P.yaw += turn * 1.6 * dt;
  const up = (keys.has('ArrowUp') ? 1 : 0) - (keys.has('ArrowDown') ? 1 : 0);
  if (up) P.pitch = Math.max(-1.1, Math.min(1.1, P.pitch + up * 1.2 * dt));
  const f = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
  const s = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  const speed = (keys.has('ShiftLeft') || keys.has('ShiftRight')) ? 2.6 : 1.4;
  let tx = 0, tz = 0;
  if (f || s) {
    const l = Math.hypot(f, s);
    const sy = Math.sin(P.yaw), cy = Math.cos(P.yaw);
    tx = (-sy * f + cy * s) / l * speed;
    tz = (-cy * f - sy * s) / l * speed;
  }
  const k = 1 - Math.exp(-10 * dt);   // smooth accel: abrupt starts make the stereo scene "jerk"
  P.vx += (tx - P.vx) * k; P.vz += (tz - P.vz) * k;
  P.x += P.vx * dt; P.z += P.vz * dt;
  resolveCollisions();
  appCam.position.set(P.x, EYE_HEIGHT, P.z);       // no head-bob: it fights real head tracking
  appCam.rotation.set(P.pitch, P.yaw, 0, 'YXZ');
  appCam.updateMatrixWorld(true);
}

// ---- backing store -----------------------------------------------------------------------------
let woven = false;
let renderScale = 1;
function sizeStore() {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || innerWidth, cssH = canvas.clientHeight || innerHeight;
  let w = Math.round(cssW * dpr), h = Math.round(cssH * dpr);
  let bufW = woven ? w * 2 : w;
  // keep the SBS buffer no wider than the panel (browser zero-copy read, lens pitch is per-eye half)
  const panelW = Math.round((screen.width || cssW) * dpr);
  if (woven && bufW > panelW) bufW = Math.max(panelW, w);
  const maxDim = Math.min(renderer.capabilities.maxTextureSize, 8192);
  const sc = Math.min(1, maxDim / Math.max(bufW, h));
  bufW = Math.round(bufW * sc); h = Math.round(h * sc);
  renderScale = sc;
  appCam.aspect = cssW / cssH;                      // per-eye aspect is the CSS box's
  appCam.updateProjectionMatrix();
  const el = renderer.domElement;
  if (el.width === bufW && el.height === h) return false;   // setSize would clear for nothing
  renderer.setSize(bufW, h, false);
  return true;
}
addEventListener('resize', () => { if (!woven) sizeStore(); });

// ---- stereo rendering --------------------------------------------------------------------------
let SDK = null;
const eyes = [];
let handle = null;
const rig = {};
const good = [0, 1].map(() => ({ proj: new Float32Array(16), pose: new Float32Array(16), x: 0, y: 0, width: 0, height: 0 }));
let haveGood = false;
let frameCount = 0;

function currentRig() {
  return SDK.cameraRigFromCamera(THREE, appCam, { convergence: CONVERGENCE, attach: true, ipdFactor: IPD_FACTOR, out: rig });
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

function onXRFrame(views, layer) {
  update();
  try { handle.setViewRig(currentRig()); } catch (e) { /* session mid-teardown */ }   // drives NEXT locate
  if (!views || views.length < 2 || !layer) return replayLastGood();
  const vps = [layer.getViewport(views[0]), layer.getViewport(views[1])];
  if (vps.some((vp) => !vp || vp.width <= 0 || vp.height <= 0)) return replayLastGood();

  renderer.clear();
  renderer.setScissorTest(true);
  for (let i = 0; i < 2; i++) {
    const vp = vps[i], g = good[i];
    renderer.setViewport(vp.x, vp.y, vp.width, vp.height);
    renderer.setScissor(vp.x, vp.y, vp.width, vp.height);
    eyes[i].setLocalFromView(views[i]);        // LOCAL: eye cameras are parented under appCam
    renderer.render(scene, eyes[i].camera);
    g.proj.set(views[i].projectionMatrix); g.pose.set(views[i].transform.matrix);
    g.x = vp.x; g.y = vp.y; g.width = vp.width; g.height = vp.height;
  }
  renderer.setScissorTest(false);
  haveGood = true;
  frameCount++;
}

// ---- 2D fallback -------------------------------------------------------------------------------
function monoTick() {
  requestAnimationFrame(monoTick);
  update();
  renderer.clear();
  const sz = renderer.getSize(new THREE.Vector2());
  renderer.setViewport(0, 0, sz.x, sz.y);
  renderer.render(scene, appCam);
}

// ---- boot --------------------------------------------------------------------------------------
function setStatus(cls, html) { statusEl.className = 'hud ' + cls; statusEl.innerHTML = html; }

(async () => {
  sizeStore();
  // Dynamic import in try/catch so a missing SDK degrades to the plain 2D walk-through.
  let wall = null;
  try {
    const core = await import('@displayxr/inline3d');
    const glue = await import('@displayxr/inline3d/three');
    SDK = { cameraRigFromCamera: glue.cameraRigFromCamera, EyeCamera: glue.EyeCamera };
    wall = await core.createInline3D({ lazy: false, autoChrome: false });
  } catch (e) {
    console.warn('[room] SDK unavailable, 2D mode', e);
  }
  if (!wall || !wall.supported) {
    setStatus('flat', '<b>2D mode</b> — open in the DisplayXR Browser on a 3D display for depth');
    requestAnimationFrame(monoTick);
    return;
  }

  for (let i = 0; i < 2; i++) { eyes.push(new SDK.EyeCamera(THREE)); appCam.add(eyes[i].camera); }
  for (const id of ['title', 'status', 'help']) wall.addGlobalOverlay(document.getElementById(id));

  woven = true;
  sizeStore();
  try { wall.session.updateRenderState({ depthNear: NEAR, depthFar: FAR }); } catch (e) { /* ignore */ }

  coverEl.style.display = 'grid';        // opaque cover ON TOP of the fresh canvas until woven
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  update();
  handle = wall.addScene(canvas, onXRFrame, {
    viewRig: currentRig(),
    onResize: () => { if (sizeStore()) replayLastGood(); },
    onLayerLost: () => {                  // fall back to flat rendering
      woven = false; handle = null; sizeStore();
      setStatus('flat', '<b>2D mode</b> — 3D session ended');
      requestAnimationFrame(monoTick);
    },
  });
  setStatus('woven', '<b>3D active</b> — drag to look, WASD to walk');
  handle.firstWoven.then(() => { coverEl.style.display = 'none'; });   // hard cut, never a fade
})();
