// First-person room walk-through on a CAMERA rig (the user moves through a world). Adapted from
// the SDK's starter-world: fixed finite convergence just nearer than the floor at the bottom edge,
// closed room (the window looks onto a nearby painted backdrop, never infinity), nothing close to
// the camera at the start. See NOTES.md.

import * as THREE from 'three';
import { createInline3D } from '@displayxr/inline3d';
import { EyeCamera, cameraRigFromCamera } from '@displayxr/inline3d/three';

const canvas = document.getElementById('world');
const cover = document.getElementById('cover');
const hud = document.getElementById('hud');
const depthEl = document.getElementById('depth');
const modeBtn = document.getElementById('mode');
const lockBtn = document.getElementById('lock');
const note = document.getElementById('note');

const FOV = 60;
const EYE_H = 1.6;
const CONVERGENCE = 0.9 * EYE_H / Math.tan(THREE.MathUtils.degToRad(FOV / 2)); // ≈ 2.49 m, FIXED
const ROOM = { w: 6, h: 3.2, near: 1, far: -9 };
const BG = 0x15171c;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setClearColor(BG, 1);
renderer.setPixelRatio(1);
renderer.autoClear = false;
const scene = new THREE.Scene();
const cam = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.05, 30);
cam.position.set(0, EYE_H, 0);
scene.add(cam);

// ---- textures: irregular detail so the eyes can fuse; no regular repeats -------------------------
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
function tex(base, { planks = 0, spots = 1500, contrast = 0.2, r = 8 } = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < planks; i++) {
    g.fillStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,255,255'},${rnd() * 0.18})`;
    g.fillRect(0, (i * 256) / planks, 256, 256 / planks);
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fillRect(0, (i * 256) / planks, 256, 2);
  }
  for (let i = 0; i < spots; i++) {
    g.fillStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,255,255'},${rnd() * contrast})`;
    g.beginPath();
    g.arc(rnd() * 256, rnd() * 256, 1 + rnd() * rnd() * r, 0, 7);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
// Material from a shared texture; repeat set so one tile covers ~m metres.
function mat(texture, wMeters = 1, hMeters = 1, m = 2) {
  const t = texture.clone();
  t.needsUpdate = true;
  t.repeat.set(wMeters / m, hMeters / m);
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.85 });
}
const T = {
  floor: tex('#8a6a4a', { planks: 10, r: 4 }),
  ceil: tex('#d9d4c8', { contrast: 0.08 }),
  wall: tex('#b9a98f', { contrast: 0.12, spots: 3000, r: 5 }),
  rug: tex('#7a2e2e', { spots: 900, contrast: 0.35 }),
  wood: tex('#6b4a2e', { planks: 6, contrast: 0.2 }),
  fabric: tex('#3d5a7a', { spots: 900, contrast: 0.3 }),
  frame: tex('#e9e4d8', { spots: 400, contrast: 0.1, r: 3 }),
  cushion: tex('#b5553a', { spots: 700, contrast: 0.3 }),
};
const wood = mat(T.wood, 1, 1, 1);
const colliders = []; // [minX, maxX, minZ, maxZ], padded by the body radius
function box(w, h, d, x, y, z, m, ry = 0, solid = false) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  b.position.set(x, y, z);
  b.rotation.y = ry;
  scene.add(b);
  if (solid) colliders.push([x - w / 2 - 0.25, x + w / 2 + 0.25, z - d / 2 - 0.25, z + d / 2 + 0.25]);
  return b;
}
const L = ROOM.near - ROOM.far, MZ = (ROOM.near + ROOM.far) / 2;
function plane(w, h, m, pos, rot) {
  const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
  p.position.set(...pos);
  p.rotation.set(...rot);
  scene.add(p);
  return p;
}

// ---- shell -------------------------------------------------------------------------------------
plane(ROOM.w, L, mat(T.floor, ROOM.w, L, 2), [0, 0, MZ], [-Math.PI / 2, 0, 0]);
plane(ROOM.w, L, mat(T.ceil, ROOM.w, L, 2), [0, ROOM.h, MZ], [Math.PI / 2, 0, 0]);
plane(L, ROOM.h, mat(T.wall, L, ROOM.h, 3), [-ROOM.w / 2, ROOM.h / 2, MZ], [0, Math.PI / 2, 0]);
plane(ROOM.w, ROOM.h, mat(T.wall, ROOM.w, ROOM.h, 3), [0, ROOM.h / 2, ROOM.far], [0, 0, 0]);
plane(ROOM.w, ROOM.h, mat(T.wall, ROOM.w, ROOM.h, 3), [0, ROOM.h / 2, ROOM.near], [0, Math.PI, 0]);
const skirt = mat(T.frame, 1, 1, 1);   // skirting boards: an edge cue where wall meets floor
box(0.04, 0.12, L, -ROOM.w / 2 + 0.02, 0.06, MZ, skirt);
box(0.04, 0.12, L, ROOM.w / 2 - 0.02, 0.06, MZ, skirt);
box(ROOM.w, 0.12, 0.04, 0, 0.06, ROOM.far + 0.02, skirt);

// Right wall (x = +3) with a window hole: z ∈ [-4.2,-2.6], y ∈ [0.9,2.4]
const WX = ROOM.w / 2, WZ0 = -4.2, WZ1 = -2.6, WY0 = 0.9, WY1 = 2.4;
function rightWallPiece(z0, z1, y0, y1) {
  const w = z1 - z0, h = y1 - y0;
  plane(w, h, mat(T.wall, w, h, 3), [WX, (y0 + y1) / 2, (z0 + z1) / 2], [0, -Math.PI / 2, 0]);
}
rightWallPiece(ROOM.far, ROOM.near, WY1, ROOM.h);   // above the window
rightWallPiece(WZ1, ROOM.near, 0, WY1);             // toward the camera (full height up to the head)
rightWallPiece(ROOM.far, WZ0, 0, WY1);              // toward the far wall
rightWallPiece(WZ0, WZ1, 0, WY0);                   // below the window
const fm = mat(T.frame, 1, 1, 1);
const cz = (WZ0 + WZ1) / 2, ww = WZ1 - WZ0, wh = WY1 - WY0, wcy = (WY0 + WY1) / 2;
box(0.12, 0.06, ww + 0.2, WX - 0.06, WY0 - 0.03, cz, fm);   // sill
box(0.1, 0.06, ww + 0.1, WX - 0.05, WY1 + 0.03, cz, fm);    // head
box(0.1, wh, 0.06, WX - 0.05, wcy, WZ0 - 0.03, fm);
box(0.1, wh, 0.06, WX - 0.05, wcy, WZ1 + 0.03, fm);
box(0.04, wh, 0.04, WX - 0.02, wcy, cz, fm);                // mullion
box(0.04, 0.04, ww, WX - 0.02, wcy, cz, fm);                // transom
// The view outside: a painted backdrop only 1.4 m beyond the wall (closed room: no infinity).
{
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, '#6fa8e0'); grd.addColorStop(0.6, '#cfe4f4'); grd.addColorStop(1, '#e8efe0');
  g.fillStyle = grd; g.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 14; i++) {
    g.fillStyle = `rgba(255,255,255,${0.25 + rnd() * 0.3})`;
    g.beginPath(); g.ellipse(rnd() * 512, 30 + rnd() * 90, 30 + rnd() * 50, 8 + rnd() * 10, 0, 0, 7); g.fill();
  }
  g.fillStyle = '#5b8a4e'; g.beginPath(); g.moveTo(0, 256);
  for (let x = 0; x <= 512; x += 16) g.lineTo(x, 175 + Math.sin(x * 0.03) * 14 + rnd() * 10);
  g.lineTo(512, 256); g.fill();
  for (let i = 0; i < 90; i++) {
    g.fillStyle = `hsl(${90 + rnd() * 40},45%,${22 + rnd() * 20}%)`;
    g.beginPath(); g.arc(rnd() * 512, 185 + rnd() * 70, 3 + rnd() * 9, 0, 7); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const back = new THREE.Mesh(new THREE.PlaneGeometry(16, 8), new THREE.MeshBasicMaterial({ map: t }));
  back.position.set(WX + 1.4, 2.0, cz);
  back.rotation.y = -Math.PI / 2;
  scene.add(back);
}
const sun = new THREE.DirectionalLight(0xfff0d0, 1.4);   // daylight through the window
sun.position.set(6, 4, -3);
sun.target.position.set(0, 0, -3.5);
scene.add(sun, sun.target);

// ---- furniture (everything central at the start pose is >= 2 m away) ---------------------------
plane(3, 2, mat(T.rug, 3, 2, 2), [0, 0.005, -4.6], [-Math.PI / 2, 0, 0]);
box(1.6, 0.06, 0.9, 0, 0.75, -4.6, wood, 0, true);                       // table
for (const [x, z] of [[-0.72, -4.2], [0.72, -4.2], [-0.72, -5], [0.72, -5]]) box(0.06, 0.72, 0.06, x, 0.36, z, wood);
for (const z of [-3.85, -5.35]) {                                        // chairs
  const back = z > -4.6 ? 0.2 : -0.2;
  box(0.45, 0.05, 0.45, 0, 0.46, z, wood);
  box(0.45, 0.5, 0.05, 0, 0.72, z + back, wood);
  for (const [dx, dz] of [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]]) box(0.04, 0.44, 0.04, dx, 0.22, z + dz, wood);
}
const ceramic = new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.4, side: THREE.DoubleSide });
const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.16, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), ceramic);
bowl.rotation.x = Math.PI;                                               // open side up
bowl.position.set(-0.3, 0.93, -4.6);
scene.add(bowl);
const vase = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.26, 20), new THREE.MeshStandardMaterial({ color: 0x2f6f8f, roughness: 0.3 }));
vase.position.set(0.35, 0.91, -4.55);
scene.add(vase);
box(0.01, 0.2, 0.01, 0.35, 1.1, -4.55, new THREE.MeshStandardMaterial({ color: 0x3a7a3a }));
const bloom = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), new THREE.MeshStandardMaterial({ color: 0xd8483a }));
bloom.position.set(0.35, 1.22, -4.55);
scene.add(bloom);
box(0.28, 0.04, 0.2, 0.05, 0.80, -4.85, new THREE.MeshStandardMaterial({ color: 0x8a2f2f }), 0.4);   // book
const fabric = mat(T.fabric, 1, 1, 1);                                   // sofa on the left
box(0.9, 0.45, 2.2, -2.5, 0.22, -6.2, fabric, 0, true);
box(0.25, 0.5, 2.2, -2.85, 0.6, -6.2, fabric);
box(0.2, 0.2, 0.5, -2.45, 0.55, -5.6, mat(T.cushion, 1, 1, 1), 0.3);
box(0.5, 0.8, 1.6, 2.7, 0.4, -6.6, wood, 0, true);                       // sideboard
const shelf = box(2.4, 2.2, 0.35, 0, 1.1, ROOM.far + 0.18, wood, 0, true);   // bookshelf
for (let r = 0; r < 4; r++) for (let x = -1.1; x < 1.05; x += 0.05 + rnd() * 0.06) {
  const h = 0.3 + rnd() * 0.18;
  box(0.045, h, 0.25, x, 0.15 + r * 0.52 + h / 2, shelf.position.z + 0.05,
    new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(rnd(), 0.45, 0.25 + rnd() * 0.35) }));
}
for (const [z, c] of [[-3.5, '#3f6b4f'], [-6.8, '#a0663a']]) {           // paintings, left wall
  plane(1.2, 0.8, mat(tex(c, { spots: 1500, contrast: 0.5 }), 1.2, 0.8, 1.2), [-ROOM.w / 2 + 0.03, 1.7, z], [0, Math.PI / 2, 0]);
  box(0.03, 0.88, 1.28, -ROOM.w / 2 + 0.015, 1.7, z, wood);
}
const LX = 2.4, LZ = -7.9;                                               // floor lamp
const lampLight = new THREE.PointLight(0xffd9a0, 7, 9, 1.5);
lampLight.position.set(LX, 1.7, LZ);
scene.add(lampLight);
box(0.3, 0.03, 0.3, LX, 0.015, LZ, wood);
box(0.04, 1.6, 0.04, LX, 0.8, LZ, wood);
const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.25, 0.32, 24, 1, true),
  new THREE.MeshStandardMaterial({ color: 0xf0dfb0, emissive: 0xffc070, emissiveIntensity: 0.55, side: THREE.DoubleSide }));
shade.position.set(LX, 1.7, LZ);
scene.add(shade);
colliders.push([LX - 0.5, LX + 0.5, LZ - 0.5, LZ + 0.5]);
scene.add(new THREE.HemisphereLight(0xfff4e0, 0x403028, 1.5));

// ---- input -------------------------------------------------------------------------------------
const keys = new Set();
addEventListener('keydown', (e) => keys.add(e.code));
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
let yaw = 0, pitch = 0, drag = null;
const look = (dx, dy) => {
  yaw -= dx * 0.003;
  pitch = Math.max(-1.2, Math.min(1.2, pitch - dy * 0.003));
};
canvas.addEventListener('pointerdown', (e) => { drag = [e.clientX, e.clientY]; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointerup', () => { drag = null; });
canvas.addEventListener('pointermove', (e) => {
  if (document.pointerLockElement === canvas) return look(e.movementX, e.movementY);
  if (!drag) return;
  look(e.clientX - drag[0], e.clientY - drag[1]);
  drag = [e.clientX, e.clientY];
});
lockBtn.addEventListener('click', () => canvas.requestPointerLock?.());
let lastT = 0;
function move(now) {
  const dt = lastT ? Math.min((now - lastT) / 1000, 0.1) : 0;
  lastT = now;
  const f = (keys.has('KeyW') || keys.has('ArrowUp')) - (keys.has('KeyS') || keys.has('ArrowDown'));
  const s = (keys.has('KeyD') || keys.has('ArrowRight')) - (keys.has('KeyA') || keys.has('ArrowLeft'));
  const v = 1.6 * dt;
  let nx = cam.position.x + (-Math.sin(yaw) * f + Math.cos(yaw) * s) * v;
  let nz = cam.position.z + (-Math.cos(yaw) * f - Math.sin(yaw) * s) * v;
  nx = Math.max(-ROOM.w / 2 + 0.4, Math.min(ROOM.w / 2 - 0.4, nx));
  nz = Math.max(ROOM.far + 0.6, Math.min(ROOM.near - 0.4, nz));
  const hit = (x, z) => colliders.some((c) => x > c[0] && x < c[1] && z > c[2] && z < c[3]);
  if (!hit(nx, cam.position.z)) cam.position.x = nx;      // slide along obstacles
  if (!hit(cam.position.x, nz)) cam.position.z = nz;
  cam.rotation.set(pitch, yaw, 0, 'YXZ');
}

// ---- backing store: 2x wide woven, 1:1 flat ----------------------------------------------------
let sbs = false;
function sizeStore(cssW = canvas.clientWidth, cssH = canvas.clientHeight, dpr = devicePixelRatio || 1) {
  const w = Math.max(1, Math.round(cssW * dpr)), h = Math.max(1, Math.round(cssH * dpr));
  renderer.setSize(sbs ? 2 * w : w, h, false);
  cam.aspect = w / h;
  cam.updateProjectionMatrix();
}

// ---- woven path (attach pattern, drawn from the last good frame) -------------------------------
const eyes = [new EyeCamera(THREE), new EyeCamera(THREE)];
for (const e of eyes) cam.add(e.camera);
let last = null;
function onXRFrame(views, layer) {
  move(performance.now());
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
    eyes[i].setLocalFromMatrices(e.proj, e.pose);
    renderer.render(scene, eyes[i].camera);
  });
  renderer.setScissorTest(false);
}
function onResize({ width, height, dpr }) {
  sizeStore(width, height, dpr);
  if (!last) return;
  const w = canvas.width / 2;
  last.forEach((e, i) => { e.vp = { x: i * w, y: 0, width: w, height: canvas.height }; });
  drawEyes();
}

// ---- mono path ---------------------------------------------------------------------------------
function onMonoFrame(now) {
  requestAnimationFrame(onMonoFrame);
  move(now);
  renderer.clear();
  renderer.setViewport(0, 0, canvas.width, canvas.height);
  renderer.render(scene, cam);
}

// ---- boot --------------------------------------------------------------------------------------
const HELP = 'WASD / arrows to walk · mouse to look';
let wall = { supported: false };
try { wall = await createInline3D({ lazy: false }); } catch (e) { console.warn('inline3d unavailable', e); }
if (wall.supported) {
  sbs = true;
  sizeStore();
  const rig = (k) => cameraRigFromCamera(THREE, cam, {
    convergence: CONVERGENCE, attach: true, ipdFactor: k, parallaxFactor: k,
  });
  const handle = wall.addScene(canvas, onXRFrame, { viewRig: rig(1), onResize });
  wall.session.updateRenderState({ depthNear: cam.near, depthFar: cam.far });
  hud.textContent = HELP;

  // Depth slider: one value moves BOTH factors. Camera-rig factors are absolute; 1 is the tuned top.
  depthEl.addEventListener('input', () => handle.setViewRig(rig(Number(depthEl.value))));
  let flat = false;
  const show = () => { modeBtn.textContent = flat ? 'Show in 3D' : 'Show in 2D'; };
  handle.on('renderingmodechange', (e) => { if (e.viewCount) { flat = e.viewCount === 1; show(); } });
  modeBtn.addEventListener('click', () => {
    handle.setStereoEnabled(flat).catch(() => {   // no flat mode: depth 0 is flat anywhere
      flat = !flat;
      depthEl.value = flat ? 0 : 1;
      handle.setViewRig(rig(Number(depthEl.value)));
      show();
    });
  });
  show();
  await handle.firstWoven;
  cover.remove();
} else {
  sizeStore();
  new ResizeObserver(() => sizeStore()).observe(canvas);
  cover.remove();
  hud.textContent = HELP;
  depthEl.disabled = modeBtn.disabled = true;
  modeBtn.textContent = '2D';
  note.textContent = 'Open in the DisplayXR Browser on a 3D display for depth.';
  requestAnimationFrame(onMonoFrame);
}
