// Aquarium desk ornament — three.js on the DisplayXR inline-3D SDK, DISPLAY rig.
// The user turns a subject (the tank) under a fixed portal, so this is a display-rig case:
// the tank is authored in metres, centred on the glass (z = 0), and rendered from the reported views.

import * as THREE from 'three';
import { createInline3D } from '@displayxr/inline3d';
import { EyeCamera } from '@displayxr/inline3d/three';

const canvas = document.getElementById('tank');
const cover = document.getElementById('cover');
const statusEl = document.getElementById('status');

const BG = 0x1c1f26;              // dark grey, never pure black (crosstalk); matches the page
const VDH = 0.24;                 // virtual display height in metres (SDK default)
const TANK = { w: 0.30, h: 0.16, d: 0.16 };   // tank is ~2/3 of the window height: well inside the depth budget

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);        // getViewport() is in backing-store px; we size the store ourselves
renderer.autoClear = false;
renderer.setClearColor(BG, 1);

const scene = new THREE.Scene();
scene.background = new THREE.Color(BG);

scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x2a3040, 1.1));
const key = new THREE.DirectionalLight(0xfff2dd, 1.8);
key.position.set(0.15, 0.4, 0.3);
scene.add(key);
const rim = new THREE.DirectionalLight(0x7fb0ff, 0.5);
rim.position.set(-0.3, 0.1, -0.2);
scene.add(rim);

// Everything lives in `tankGroup` so drag/idle rotation turns the subject under the fixed portal.
const tankGroup = new THREE.Group();
tankGroup.rotation.order = 'YXZ';
scene.add(tankGroup);

const rand = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();

// ---------------------------------------------------------------- tank shell
const hw = TANK.w / 2, hh = TANK.h / 2, hd = TANK.d / 2;
const floorY = -hh;
const sandTop = floorY + 0.018;
const waterTop = hh - 0.012;

// Desk base
const base = new THREE.Mesh(
  new THREE.BoxGeometry(TANK.w + 0.016, 0.012, TANK.d + 0.016),
  new THREE.MeshStandardMaterial({ color: 0x2b303b, roughness: 0.6, metalness: 0.2 }));
base.position.y = floorY - 0.006;
tankGroup.add(base);

// Glass: low opacity, no depth write, so fish behind a pane never get a ghost double.
const glassMat = new THREE.MeshStandardMaterial({
  color: 0xbfe6ff, transparent: true, opacity: 0.07, roughness: 0.05, metalness: 0,
  depthWrite: false, side: THREE.DoubleSide });
const t = 0.002;
function pane(w, h, d, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), glassMat);
  m.position.set(x, y, z); m.renderOrder = 10; tankGroup.add(m);
}
pane(TANK.w, TANK.h, t, 0, 0, hd);
pane(t, TANK.h, TANK.d, -hw, 0, 0);
pane(t, TANK.h, TANK.d, hw, 0, 0);
// (back pane is the backdrop below)

// Silicone/frame rails: crisp bright edges give strong, unambiguous depth cues.
const railMat = new THREE.MeshStandardMaterial({ color: 0x9fb3c8, roughness: 0.4, metalness: 0.3 });
const r = 0.003;
function rail(w, h, d, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), railMat);
  m.position.set(x, y, z); tankGroup.add(m);
}
for (const sx of [-1, 1]) for (const sz of [-1, 1]) rail(r, TANK.h, r, sx * hw, 0, sz * hd);          // verticals
for (const sy of [-1, 1]) for (const sz of [-1, 1]) rail(TANK.w, r, r, 0, sy * hh, sz * hd);          // along x
for (const sy of [-1, 1]) for (const sx of [-1, 1]) rail(r, r, TANK.d, sx * hw, sy * hh, 0);          // along z

// Backdrop: vertical teal -> deep blue gradient on the back wall (inside the tank).
{
  const c = document.createElement('canvas'); c.width = 4; c.height = 256;
  const g = c.getContext('2d'); const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#3f8fa6'); grad.addColorStop(0.55, '#1f5a82'); grad.addColorStop(1, '#14324f');
  g.fillStyle = grad; g.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const back = new THREE.Mesh(new THREE.PlaneGeometry(TANK.w, TANK.h), new THREE.MeshBasicMaterial({ map: tex }));
  back.position.z = -hd + 0.001; tankGroup.add(back);
  // side walls get a faint tint of the same water so the box reads as one volume
  for (const sx of [-1, 1]) {
    const sw = new THREE.Mesh(new THREE.PlaneGeometry(TANK.d, TANK.h),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.45, depthWrite: false }));
    sw.rotation.y = -sx * Math.PI / 2; sw.position.x = sx * (hw - 0.001); tankGroup.add(sw);
  }
}

// Water surface
const surface = new THREE.Mesh(new THREE.PlaneGeometry(TANK.w - 0.002, TANK.d - 0.002),
  new THREE.MeshStandardMaterial({ color: 0x9fdcff, transparent: true, opacity: 0.16, roughness: 0.1,
    side: THREE.DoubleSide, depthWrite: false }));
surface.rotation.x = -Math.PI / 2; surface.position.y = waterTop; surface.renderOrder = 9;
tankGroup.add(surface);

// ---------------------------------------------------------------- sand + rocks
{
  const geo = new THREE.PlaneGeometry(TANK.w - 0.004, TANK.d - 0.004, 60, 36);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    p.setY(i, 0.004 * Math.sin(x * 90 + z * 30) * Math.cos(z * 70) + 0.002 * (rand() - 0.5) + 0.006 * (z / hd < 0 ? 0.5 : 0));
  }
  geo.computeVertexNormals();
  const sand = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xd9c08a, roughness: 1, flatShading: false }));
  sand.position.y = sandTop; tankGroup.add(sand);
  const fill = new THREE.Mesh(new THREE.BoxGeometry(TANK.w - 0.004, sandTop - floorY, TANK.d - 0.004),
    new THREE.MeshStandardMaterial({ color: 0xc7ad76, roughness: 1 }));
  fill.position.y = (sandTop + floorY) / 2 - 0.002; tankGroup.add(fill);
}

function rock(x, z, s, color) {
  const geo = new THREE.DodecahedronGeometry(1, 1);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const k = 0.82 + 0.3 * rand();
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.7, p.getZ(i) * k);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true }));
  m.scale.setScalar(s); m.position.set(x, sandTop + s * 0.35, z);
  m.rotation.y = rand() * 6; tankGroup.add(m);
}
rock(-0.085, -0.02, 0.024, 0x6e7479);
rock(-0.06, 0.03, 0.013, 0x858b8f);
rock(0.075, -0.035, 0.030, 0x5d6368);
rock(0.105, 0.025, 0.014, 0x7a7f84);
rock(0.01, -0.06, 0.017, 0x6b6560);

// ---------------------------------------------------------------- plants (chains of tapered blades)
const plants = [];
function plant(x, z, height, segs, color, width, amp, speed) {
  const root = new THREE.Group(); root.position.set(x, sandTop, z);
  const segH = height / segs;
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.7, side: THREE.DoubleSide });
  let parent = root; const chain = [];
  for (let i = 0; i < segs; i++) {
    const j = new THREE.Group(); j.position.y = i === 0 ? 0 : segH;
    const taper = 1 - i / segs * 0.6;
    const blade = new THREE.Mesh(new THREE.CylinderGeometry(width * taper * 0.8, width * taper, segH * 1.05, 6), mat);
    blade.scale.z = 0.3; blade.position.y = segH / 2;
    j.add(blade); parent.add(j); parent = j; chain.push(j);
  }
  plants.push({ chain, amp, speed, phase: rand() * 6.28 });
  tankGroup.add(root);
}
plant(-0.115, -0.045, 0.085, 8, 0x2f9e57, 0.0035, 0.16, 1.1);
plant(-0.103, -0.040, 0.065, 7, 0x3fb36a, 0.003, 0.18, 1.3);
plant(-0.04, -0.062, 0.075, 8, 0x27864a, 0.0035, 0.15, 0.9);
plant(0.045, 0.045, 0.045, 6, 0x57c27a, 0.003, 0.2, 1.4);
plant(0.118, -0.045, 0.092, 9, 0x2f9e57, 0.0035, 0.14, 1.0);
plant(0.130, -0.030, 0.06, 7, 0x4cbf72, 0.003, 0.17, 1.2);
plant(0.04, -0.065, 0.055, 7, 0x3fb36a, 0.003, 0.18, 1.25);

// ---------------------------------------------------------------- fish
const fishDefs = [
  { body: 0xff7a1a, fin: 0xffb05a, len: 0.040, a: [0.095, 0.030, 0.050], w: [0.31, 0.43, 0.27], c: [0, 0.012, 0] },
  { body: 0xffd23a, fin: 0xfff0a0, len: 0.032, a: [0.105, 0.035, 0.045], w: [0.37, 0.29, 0.41], c: [0, 0.000, 0] },
  { body: 0x3db8ff, fin: 0x9fdcff, len: 0.036, a: [0.085, 0.025, 0.052], w: [0.23, 0.47, 0.33], c: [0, 0.020, 0] },
  { body: 0xe8456b, fin: 0xff9db3, len: 0.044, a: [0.100, 0.020, 0.040], w: [0.27, 0.35, 0.21], c: [0, 0.005, 0] },
  { body: 0xa6e04a, fin: 0xd8f59a, len: 0.030, a: [0.110, 0.032, 0.048], w: [0.41, 0.33, 0.37], c: [0, 0.028, 0] },
];
const eyeWhite = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
const eyeBlack = new THREE.MeshBasicMaterial({ color: 0x050505 });

function makeFish(def) {
  const L = def.len;
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: def.body, roughness: 0.45, metalness: 0.1 });
  const finMat = new THREE.MeshStandardMaterial({ color: def.fin, roughness: 0.6, side: THREE.DoubleSide, transparent: true, opacity: 0.92 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), bodyMat);
  body.scale.set(L * 0.5, L * 0.27, L * 0.15); g.add(body);
  // tail pivots at the rear of the body
  const tail = new THREE.Group(); tail.position.x = -L * 0.42; g.add(tail);
  const tailMesh = new THREE.Mesh(new THREE.ConeGeometry(L * 0.24, L * 0.5, 4, 1), finMat);
  tailMesh.rotation.z = Math.PI / 2; tailMesh.position.x = -L * 0.22; tailMesh.scale.set(1, 1, 0.12);
  tail.add(tailMesh);
  const dorsal = new THREE.Mesh(new THREE.ConeGeometry(L * 0.14, L * 0.3, 3), finMat);
  dorsal.position.set(-L * 0.05, L * 0.3, 0); dorsal.rotation.z = 0.5; dorsal.scale.z = 0.15; g.add(dorsal);
  for (const s of [-1, 1]) {
    const fin = new THREE.Mesh(new THREE.ConeGeometry(L * 0.09, L * 0.22, 3), finMat);
    fin.position.set(L * 0.08, -L * 0.07, s * L * 0.12); fin.rotation.set(s * 0.6, 0, Math.PI / 2 + 0.5); fin.scale.z = 0.2;
    g.add(fin);
    const ew = new THREE.Mesh(new THREE.SphereGeometry(L * 0.055, 12, 8), eyeWhite);
    ew.position.set(L * 0.30, L * 0.06, s * L * 0.085); g.add(ew);
    const ep = new THREE.Mesh(new THREE.SphereGeometry(L * 0.03, 8, 6), eyeBlack);
    ep.position.set(L * 0.33, L * 0.065, s * L * 0.105); g.add(ep);
  }
  g.rotation.order = 'YZX';
  tankGroup.add(g);
  return { g, tail, def, phase: rand() * 6.28 };
}
const fishes = fishDefs.map(makeFish);

const _p = new THREE.Vector3(), _v = new THREE.Vector3();
function pathAt(f, time, out) {
  const { a, w, c } = f.def, ph = f.phase;
  // Lissajous wander; the extra slow term keeps it from repeating visibly.
  out.set(
    c[0] + a[0] * Math.sin(w[0] * time + ph) + 0.012 * Math.sin(w[0] * 2.3 * time),
    c[1] + a[1] * Math.sin(w[1] * time + ph * 1.7),
    c[2] + a[2] * Math.sin(w[2] * time + ph * 0.6));
  return out;
}
function updateFish(time) {
  for (const f of fishes) {
    pathAt(f, time, _p); pathAt(f, time + 0.05, _v).sub(_p);
    f.g.position.copy(_p);
    const sp = _v.length() / 0.05;
    if (sp > 1e-4) {
      f.g.rotation.y = Math.atan2(-_v.z, _v.x);
      f.g.rotation.z = Math.atan2(_v.y, Math.hypot(_v.x, _v.z));
    }
    f.tail.rotation.y = Math.sin(time * (6 + sp * 40) + f.phase) * 0.45;
  }
}

// ---------------------------------------------------------------- bubbles
const bubbleMat = new THREE.MeshStandardMaterial({ color: 0xdff4ff, transparent: true, opacity: 0.45, roughness: 0.1, depthWrite: false });
const bubbleGeo = new THREE.SphereGeometry(1, 10, 8);
const bubbles = [];
for (let i = 0; i < 14; i++) {
  const m = new THREE.Mesh(bubbleGeo, bubbleMat);
  const s = 0.0014 + rand() * 0.0016; m.scale.setScalar(s);
  m.renderOrder = 11;
  tankGroup.add(m);
  bubbles.push({ m, y: sandTop + rand() * (waterTop - sandTop), speed: 0.012 + rand() * 0.012, ph: rand() * 6.28 });
}
function updateBubbles(dt, time) {
  for (const b of bubbles) {
    b.y += b.speed * dt;
    if (b.y > waterTop - 0.004) { b.y = sandTop + 0.004; b.speed = 0.012 + rand() * 0.012; }
    b.m.position.set(-0.025 + Math.sin(time * 2 + b.ph) * 0.002, b.y, -0.03 + Math.cos(time * 1.7 + b.ph) * 0.002);
  }
}

function updatePlants(time) {
  for (const p of plants) {
    p.chain.forEach((j, i) => {
      const ph = time * p.speed + p.phase + i * 0.55;
      j.rotation.z = Math.sin(ph) * p.amp * 0.5 + 0.02;
      j.rotation.x = Math.cos(ph * 0.8) * p.amp * 0.35;
    });
  }
}

// ---------------------------------------------------------------- drag + idle sway
const pose = { yaw: 0, yawT: 0, pitch: 0.20, pitchT: 0.20 };
let dragging = null;
canvas.addEventListener('pointerdown', (e) => {
  dragging = { x: e.clientX, y: e.clientY }; canvas.classList.add('drag'); canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  pose.yawT = Math.max(-0.7, Math.min(0.7, pose.yawT + (e.clientX - dragging.x) * 0.006));
  pose.pitchT = Math.max(0.05, Math.min(0.5, pose.pitchT + (e.clientY - dragging.y) * 0.004));
  dragging = { x: e.clientX, y: e.clientY };
});
const endDrag = () => { dragging = null; canvas.classList.remove('drag'); };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

let lastT = performance.now() / 1000;
function tick() {
  const now = performance.now() / 1000;
  const dt = Math.min(0.1, now - lastT); lastT = now;
  const k = 1 - Math.exp(-dt * 6);
  pose.yaw += (pose.yawT - pose.yaw) * k;
  pose.pitch += (pose.pitchT - pose.pitch) * k;
  tankGroup.rotation.y = pose.yaw + Math.sin(now * 0.2) * 0.08;   // gentle idle sway
  tankGroup.rotation.x = pose.pitch;
  updateFish(now); updatePlants(now); updateBubbles(dt, now);
}

// ---------------------------------------------------------------- sizing
let sbs = false;
function targetSize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let w = Math.round((canvas.clientWidth || 960) * dpr), h = Math.round((canvas.clientHeight || 540) * dpr);
  const maxW = sbs ? 4096 : 8192;                 // keep the (2x wide) store inside GL limits
  const s = Math.min(1, maxW / (sbs ? w * 2 : w));
  return { w: Math.round(w * s), h: Math.round(h * s) };
}
function sizeToCanvas() {
  const { w, h } = targetSize();
  const bw = sbs ? w * 2 : w;
  if (canvas.width === bw && canvas.height === h) return false;    // setSize always reallocates: skip no-ops
  renderer.setSize(bw, h, false);
  monoCam.aspect = w / h; monoCam.updateProjectionMatrix();
  return true;
}

// ---------------------------------------------------------------- stereo render
const eye = new EyeCamera(THREE);
let lastGood = null;   // copies of the last good matrices per eye (an XRView is only valid in its callback)

function drawStereo(mats, vps) {
  renderer.clear();
  renderer.setScissorTest(true);
  for (let i = 0; i < 2; i++) {
    const vp = vps[i];
    renderer.setViewport(vp.x, vp.y, vp.width, vp.height);
    renderer.setScissor(vp.x, vp.y, vp.width, vp.height);
    eye.setFromMatrices(mats[i].proj, mats[i].xf);
    renderer.render(scene, eye.camera);
  }
  renderer.setScissorTest(false);
}
function halfViewports() {
  const W = renderer.domElement.width, H = renderer.domElement.height;
  return [{ x: 0, y: 0, width: W / 2, height: H }, { x: W / 2, y: 0, width: W / 2, height: H }];
}

function onFrame(views, layer) {
  tick();
  // Validate BEFORE clearing; on a bad frame replay the last good one instead of going black.
  const vps = views && views.length >= 2 && layer ? views.slice(0, 2).map((v) => layer.getViewport(v)) : null;
  if (!vps || vps.some((v) => !v || v.width <= 0 || v.height <= 0)) {
    if (lastGood) drawStereo(lastGood.mats, lastGood.vps);
    return;
  }
  const mats = views.slice(0, 2).map((v) => ({
    proj: Float32Array.from(v.projectionMatrix), xf: Float32Array.from(v.transform.matrix) }));
  lastGood = { mats, vps: vps.map((v) => ({ x: v.x, y: v.y, width: v.width, height: v.height })) };
  drawStereo(mats, lastGood.vps);
}

// Resize clears the buffer: resize and repaint immediately inside the observer callback.
function onResize() {
  if (!sizeToCanvas()) return;
  if (lastGood) drawStereo(lastGood.mats, halfViewports());
}

// ---------------------------------------------------------------- 2D fallback
// Camera that frames the same slice of the world the display rig does (VDH tall at z = 0).
const monoCam = new THREE.PerspectiveCamera(30, 16 / 9, 0.05, 5);
monoCam.position.set(0, 0, VDH / (2 * Math.tan(THREE.MathUtils.degToRad(15))));
monoCam.lookAt(0, 0, 0);
function monoLoop() {
  requestAnimationFrame(monoLoop);
  tick();
  sizeToCanvas();
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, canvas.width, canvas.height);
  renderer.clear();
  renderer.render(scene, monoCam);
}

// ---------------------------------------------------------------- boot
function dropCover() { cover.hidden = true; }

(async () => {
  let started3d = false;
  try {
    const wall = await createInline3D({ lazy: false });
    if (wall.supported) {
      sbs = true;
      sizeToCanvas();
      const handle = wall.addScene(canvas, onFrame, { virtualDisplayHeight: VDH, onResize });
      started3d = true;
      statusEl.className = 'status';
      statusEl.innerHTML = '<b>3D active</b> — drag to turn the tank; move your head to look around.';
      // The cover is lifted on the woven signal, with a hard timeout so it can never stick.
      setTimeout(dropCover, 5000);
      handle.firstWoven.then(dropCover, dropCover);
    }
  } catch (err) {
    console.warn('[aquarium] inline-3D setup failed, falling back to 2D', err);
    if (started3d) return;
    sbs = false;
  }
  if (!started3d) {
    sbs = false;
    statusEl.className = 'status flat';
    statusEl.innerHTML = '<b>2D view</b> — open in the <a href="https://github.com/DisplayXR/displayxr-browser">DisplayXR Browser</a> on a 3D display for the glasses-free version. Drag still turns the tank.';
    dropCover();
    sizeToCanvas();
    requestAnimationFrame(monoLoop);
  }
})();
window.addEventListener('resize', () => { if (!sbs) sizeToCanvas(); });
