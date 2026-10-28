// 3D bar chart of quarterly sales for the DisplayXR inline-3D SDK (display rig, addScene).
import * as THREE from 'three';
import { createInline3D } from '@displayxr/inline3d';
import { EyeCamera, displayRig } from '@displayxr/inline3d/three';

const canvas = document.getElementById('chart');
const cover = document.getElementById('cover');
const statusEl = document.getElementById('status');
const slider = document.getElementById('strength');
const sliderOut = document.getElementById('strengthOut');
const modeBtn = document.getElementById('modeBtn');

const BG = 0x0d111a;
const VDH = 0.18;                       // virtual display height, metres (the zoom knob)
const DATA = [
  { name: 'North', color: 0x4f9dff, values: [12, 15, 14, 18] },
  { name: 'South', color: 0xffb347, values: [9, 11, 13, 12] },
  { name: 'West',  color: 0x5fd7a0, values: [7, 10, 12, 16] },
];

// ---- renderer / scene -------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(1);              // getViewport() is in backing-store px; we size the store ourselves
renderer.autoClear = false;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(BG); // opaque: a transparent woven canvas comes out black
scene.add(new THREE.HemisphereLight(0xdbe6ff, 0x1a2236, 1.1));
const key = new THREE.DirectionalLight(0xffffff, 1.5); key.position.set(-0.4, 0.8, 0.6); scene.add(key);
const fill = new THREE.DirectionalLight(0x9db8ff, 0.4); fill.position.set(0.6, 0.2, 0.4); scene.add(fill);

// Author in metres, centred on the z=0 (zero-disparity) plane so the chart straddles the glass:
// the front row comes out a little, the back wall sits behind. Depth is deliberately modest.
const S = 0.0042;                       // metres per million
const BAR_X = 0.03, BAR_Z = 0.02, COL_DX = 0.046, ROW_DZ = 0.028;
const FLOOR_W = 0.215, FLOOR_D = 0.098, WALL_H = 20 * S + 0.004;

const chart = new THREE.Group();
scene.add(chart);

function label(text, { size = 0.011, color = '#ffffff', weight = 700, align = 'center' } = {}) {
  const px = 128, c = document.createElement('canvas');
  const font = `${weight} ${px * 0.62}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  const ctx = c.getContext('2d');
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width + 16);
  c.width = w; c.height = px;            // resizing resets the context state
  ctx.font = font;
  ctx.fillStyle = color; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  ctx.fillText(text, w / 2, px / 2 + 3);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  spr.scale.set(size * w / px, size, 1);
  if (align === 'right') spr.center.set(1, 0.5);
  return spr;
}

// floor + back wall
const floor = new THREE.Mesh(new THREE.BoxGeometry(FLOOR_W, 0.004, FLOOR_D),
  new THREE.MeshStandardMaterial({ color: 0x1c2438, roughness: 0.9 }));
floor.position.y = -0.002;
chart.add(floor);
const wallZ = -FLOOR_D / 2 + 0.002;
const wall = new THREE.Mesh(new THREE.BoxGeometry(FLOOR_W, WALL_H, 0.004),
  new THREE.MeshStandardMaterial({ color: 0x151c2d, roughness: 1 }));
wall.position.set(0, WALL_H / 2, wallZ - 0.002);
chart.add(wall);

// gridlines on the wall at 5M steps (thin quads, constant thickness) + tick labels
const gridMat = new THREE.MeshBasicMaterial({ color: 0x3a4666 });
for (let v = 5; v <= 20; v += 5) {
  const line = new THREE.Mesh(new THREE.PlaneGeometry(FLOOR_W, 0.0008), gridMat);
  line.position.set(0, v * S, wallZ + 0.0002);
  chart.add(line);
  const t = label(String(v), { size: 0.009, color: '#98a2b8', weight: 600, align: 'right' });
  t.position.set(-FLOOR_W / 2 - 0.004, v * S, wallZ + 0.004);
  chart.add(t);
}
const unit = label('$M', { size: 0.009, color: '#98a2b8', weight: 600, align: 'right' });
unit.position.set(-FLOOR_W / 2 - 0.004, 22.2 * S, wallZ + 0.004);
chart.add(unit);

// bars: quarters along x, regions in depth (North at the back so the tallest never hides the rest)
const rowZ = [-ROW_DZ, 0, ROW_DZ];
DATA.forEach((region, r) => {
  const mat = new THREE.MeshStandardMaterial({ color: region.color, roughness: 0.42, metalness: 0.05 });
  region.values.forEach((v, q) => {
    const h = v * S;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(BAR_X, h, BAR_Z), mat);
    bar.position.set((q - 1.5) * COL_DX, h / 2, rowZ[r]);
    chart.add(bar);
    const t = label(String(v), { size: 0.0105 });
    t.position.set(bar.position.x, h + 0.0085, rowZ[r] + BAR_Z / 2 - 0.002);
    chart.add(t);
  });
});
for (let q = 0; q < 4; q++) {
  const t = label(`Q${q + 1}`, { size: 0.0115, color: '#e8ecf4' });
  t.position.set((q - 1.5) * COL_DX, 0.003, FLOOR_D / 2 + 0.008);
  chart.add(t);
}

// Subject orientation: turn the SUBJECT under a fixed portal (display rig), never a camera.
const POSE = { yaw: -0.2, pitch: -0.35 };
chart.position.y = -0.04;
function applyPose() { chart.rotation.set(POSE.pitch, POSE.yaw, 0, 'YXZ'); }
applyPose();

// drag to rotate (yaw, limited pitch)
let drag = null, userTouched = false;
canvas.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY, yaw: POSE.yaw, pitch: POSE.pitch };
  userTouched = true; canvas.setPointerCapture(e.pointerId); canvas.classList.add('drag');
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  POSE.yaw = THREE.MathUtils.clamp(drag.yaw + (e.clientX - drag.x) * 0.006, -0.9, 0.9);
  POSE.pitch = THREE.MathUtils.clamp(drag.pitch + (e.clientY - drag.y) * 0.004, -0.8, -0.05);
  applyPose();
});
const endDrag = () => { drag = null; canvas.classList.remove('drag'); };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

// ---- cameras ----------------------------------------------------------------------------------
const MONO_DIST = 0.5;
const monoCam = new THREE.PerspectiveCamera(THREE.MathUtils.radToDeg(2 * Math.atan(VDH / 2 / MONO_DIST)), 16 / 9, 0.01, 10);
monoCam.position.set(0, 0, MONO_DIST);
const eyes = [new EyeCamera(THREE), new EyeCamera(THREE)];

// ---- backing store ----------------------------------------------------------------------------
// Woven: 2x width (left | right). Mono: 1:1. Clamped so a hi-dpi 2x buffer stays within 4096.
let sbsMode = false;
function sizeToCanvas() {
  const dpr = window.devicePixelRatio || 1;
  let w = (canvas.clientWidth || 640) * dpr, h = (canvas.clientHeight || 360) * dpr;
  const k = Math.min(1, 4096 / (sbsMode ? w * 2 : w), 4096 / h);
  w = Math.max(1, Math.round(w * k)); h = Math.max(1, Math.round(h * k));
  const bw = sbsMode ? w * 2 : w;
  monoCam.aspect = (canvas.clientWidth || 16) / (canvas.clientHeight || 9);
  monoCam.updateProjectionMatrix();
  if (canvas.width === bw && canvas.height === h) return false;   // writing the same size still clears
  renderer.setSize(bw, h, false);
  return true;
}

// ---- drawing ----------------------------------------------------------------------------------
let lastGood = null;                    // copies of the last good matrices (never the XRView)
function drawStereo(entries) {
  renderer.clear();
  renderer.setScissorTest(true);
  for (let i = 0; i < 2; i++) {
    const vp = entries[i].vp;
    renderer.setViewport(vp.x, vp.y, vp.width, vp.height);
    renderer.setScissor(vp.x, vp.y, vp.width, vp.height);
    eyes[i].setFromMatrices(entries[i].proj, entries[i].xf);
    renderer.render(scene, eyes[i].camera);
  }
  renderer.setScissorTest(false);
}
function halves() {
  const hw = canvas.width / 2, h = canvas.height;
  return [{ x: 0, y: 0, width: hw, height: h }, { x: hw, y: 0, width: hw, height: h }];
}
function drawMonoInHalves() {            // before any stereo frame exists: same camera in both eyes
  renderer.clear();
  renderer.setScissorTest(true);
  for (const vp of halves()) {
    renderer.setViewport(vp.x, vp.y, vp.width, vp.height);
    renderer.setScissor(vp.x, vp.y, vp.width, vp.height);
    renderer.render(scene, monoCam);
  }
  renderer.setScissorTest(false);
}
function drawMono() {
  renderer.clear();
  renderer.setViewport(0, 0, canvas.width, canvas.height);
  renderer.render(scene, monoCam);
}
function redraw() {                      // after a resize cleared the buffer: repaint at once
  if (!sbsMode) return drawMono();
  if (lastGood) { const v = halves(); drawStereo(lastGood.map((e, i) => ({ ...e, vp: v[i] }))); }
  else drawMonoInHalves();
}

function onXRFrame(views, layer) {
  // Validate before clearing; on a short frame replay the last good one, never skip.
  const vps = views && views.length >= 2 && layer ? [0, 1].map((i) => layer.getViewport(views[i])) : null;
  if (!vps || vps.some((vp) => !vp || vp.width <= 0 || vp.height <= 0)) return redraw();
  lastGood = [0, 1].map((i) => ({ proj: Float32Array.from(views[i].projectionMatrix),
    xf: Float32Array.from(views[i].transform.matrix) }));
  drawStereo(lastGood.map((e, i) => ({ ...e, vp: vps[i] })));
}

let monoRunning = false;
function monoLoop(now) {
  requestAnimationFrame(monoLoop);
  // gentle idle sway so the flat view still reads as 3D, until the viewer takes over
  chart.rotation.y = userTouched ? POSE.yaw : POSE.yaw + Math.sin(now * 0.0006) * 0.22;
  drawMono();
}
function startMono() {
  if (monoRunning) return;
  monoRunning = true; sbsMode = false; sizeToCanvas();
  requestAnimationFrame(monoLoop);
}

new ResizeObserver(() => { if (sizeToCanvas()) redraw(); }).observe(canvas);

// ---- UI + inline-3D ---------------------------------------------------------------------------
const frames = (n) => new Promise((res) => { const f = () => (--n <= 0 ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
let handle = null, wall3d = null, flat = false;
const rigScratch = {};
const strength = () => Number(slider.value) / 100;
function rigFor(s) {                    // relative [0,1]: eye separation AND head-parallax together
  return displayRig({ virtualDisplayHeight: VDH, ipdFactor: s, parallaxFactor: s, out: rigScratch });
}
function pushRig() { if (handle) handle.setViewRig(rigFor(flat ? 0 : strength())); }
slider.addEventListener('input', () => { sliderOut.textContent = `${slider.value}%`; pushRig(); });

const setStatus = (html) => { statusEl.innerHTML = html; };
const statusFor = () => (flat
  ? '<b>2D</b> — flat view.'
  : '<b>3D</b> — glasses-free 3D active. Move your head to look around.');
function syncUI() {
  modeBtn.textContent = flat ? 'Switch to 3D' : 'Switch to 2D';
  slider.disabled = flat || !handle;
  setStatus(statusFor());
}

modeBtn.addEventListener('click', async () => {
  if (!handle) return;
  const goFlat = !flat;
  modeBtn.disabled = true;
  try {
    await wall3d.setStereoEnabled(!goFlat);   // real 1-view / 2-view panel mode (eased by the SDK)
  } catch (e) {
    console.warn('setStereoEnabled unavailable, flattening the rig instead:', e && e.message);
  }
  flat = goFlat;
  pushRig();                            // flattens the rig itself where no 1-view mode exists
  modeBtn.disabled = false;
  syncUI();
});

(async () => {
  wall3d = await createInline3D({ lazy: false, autoChrome: false });
  if (!wall3d.supported) {
    cover.remove();
    startMono();
    modeBtn.disabled = true; slider.disabled = true;
    modeBtn.textContent = '2D (no 3D display)';
    setStatus('<b>2D view</b> — open in the <a href="https://github.com/DisplayXR/displayxr-browser">DisplayXR Browser</a> on a spatial display for glasses-free 3D.');
    return;
  }
  // Woven-canvas rule 4: size the 2:1 store first, let it commit for 2 frames, then register.
  sbsMode = true; sizeToCanvas();
  drawMonoInHalves();
  await frames(2);
  handle = wall3d.addScene(canvas, onXRFrame, {
    viewRig: rigFor(strength()),
    onLayerLost: () => {                // this window will not weave: fall back to the flat path
      handle = null; cover.remove(); startMono(); syncUI();
      setStatus('<b>2D view</b> — 3D is unavailable for this window.');
    },
  });
  syncUI();
  handle.firstWoven.then(() => cover.remove());   // hard cut, never a fade
  wall3d.on('hardwaredisplaystatechange', () => {
    const st = wall3d.hardwareDisplayState;
    if (st === '2d' || st === '3d') { flat = st === '2d'; syncUI(); }
  });
})();
