import * as THREE from 'three';
import { createInline3D } from '@displayxr/inline3d';
import { EyeCamera, EdgeFeather, displayRig } from '@displayxr/inline3d/three';

const canvas = document.getElementById('chart');
const cover = document.getElementById('cover');
const statusEl = document.getElementById('status');
const slider = document.getElementById('strength');
const sliderVal = document.getElementById('strengthVal');
const modeBtn = document.getElementById('mode');

// The cover hides the raw side-by-side pair until the weave joins; it must always come off.
const dropCover = () => { cover.remove(); };
setTimeout(dropCover, 4000);

// ---- data ----------------------------------------------------------------------------------
const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];
const REGIONS = [
  { name: 'North', color: 0x4cc9f0, v: [12, 15, 14, 18] },   // back row
  { name: 'South', color: 0xf7b538, v: [9, 11, 13, 12] },
  { name: 'West',  color: 0xef476f, v: [7, 10, 12, 16] },    // front row
];

// ---- scene (metres; virtual display 0.20 m tall; chart centred on the z=0 glass plane) ------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setClearColor(0x000000, 0);   // transparent so EdgeFeather can dissolve into the page
renderer.setPixelRatio(1);             // getViewport() is in backing-store px
renderer.autoClear = false;

const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a4152, 1.0));
const key = new THREE.DirectionalLight(0xffffff, 1.5);
key.position.set(0.3, 0.8, 0.6);
scene.add(key);

const chart = new THREE.Group();       // origin = chart centre = on the glass
scene.add(chart);

const GX = 0.062, GZ = 0.034, BW = 0.027, UNIT = 0.0062, FLOOR = -0.05;

// Text plane drawn from a hi-res 2D canvas texture (w/h in metres).
const label = (text, { w, h, color = '#eef1f6', weight = 600 }) => {
  const c = document.createElement('canvas');
  c.width = Math.round(w * 40000); c.height = Math.round(h * 40000);
  const g = c.getContext('2d');
  g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `${weight} ${Math.round(c.height * 0.72)}px system-ui, sans-serif`;
  g.fillText(text, c.width / 2, c.height / 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
};

// floor slab (dark grey, not black) + faint gridlines on the back
const W = GX * 3 + 0.07, D = GZ * 2 + 0.06;
const slab = new THREE.Mesh(new THREE.BoxGeometry(W, 0.004, D),
  new THREE.MeshStandardMaterial({ color: 0x3d4455, roughness: 0.9 }));
slab.position.y = FLOOR - 0.002;
chart.add(slab);
for (let i = 1; i <= 4; i++) {            // a line every 5M
  const y = FLOOR + i * 5 * UNIT;
  const line = new THREE.Mesh(new THREE.BoxGeometry(W, 0.0006, 0.0006),
    new THREE.MeshBasicMaterial({ color: 0x6b7488 }));
  line.position.set(0, y, -D / 2 + 0.004);
  chart.add(line);
  const l = label(String(i * 5), { w: 0.014, h: 0.008, color: '#aab2c0', weight: 500 });
  l.position.set(-W / 2 - 0.01, y, -D / 2 + 0.004);
  chart.add(l);
}

REGIONS.forEach((r, ri) => {
  const z = (ri - 1) * GZ;
  const mat = new THREE.MeshStandardMaterial({ color: r.color, roughness: 0.45, metalness: 0.05 });
  r.v.forEach((val, qi) => {
    const x = (qi - 1.5) * GX;
    const h = val * UNIT;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(BW, h, BW), mat);
    bar.position.set(x, FLOOR + h / 2, z);
    chart.add(bar);
    const t = label(String(val), { w: 0.016, h: 0.009 });
    t.position.set(x, FLOOR + h + 0.007, z + BW / 2 + 0.0005);
    chart.add(t);
  });
});
QUARTERS.forEach((q, qi) => {            // quarter labels lie on the floor in front
  const l = label(q, { w: 0.026, h: 0.014 });
  l.rotation.x = -Math.PI / 2;
  l.position.set((qi - 1.5) * GX, FLOOR + 0.0005, GZ + BW / 2 + 0.02);
  chart.add(l);
});

// Initial turn so the three rows read as depth; drag to change.
let yaw = -0.45, targetYaw = yaw;
chart.rotation.set(0.32, yaw, 0);
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  const x0 = e.clientX, y0 = targetYaw;
  const move = (m) => { targetYaw = Math.max(-1.0, Math.min(1.0, y0 + (m.clientX - x0) * 0.006)); };
  const up = () => { canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up); };
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
});

const eyes = [new EyeCamera(THREE), new EyeCamera(THREE)];
const feather = new EdgeFeather(THREE, { px: 24 });
const monoCam = new THREE.PerspectiveCamera(32, 16 / 9, 0.01, 10);
monoCam.position.set(0, 0.03, 0.55);
let swayX = 0;                           // mono fallback: mouse parallax previews the slider
window.addEventListener('pointermove', (e) => { swayX = (e.clientX / innerWidth - 0.5) * 2; });

// ---- backing store ---------------------------------------------------------------------------
let sbsMode = false;
function ensureSize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(2, Math.round((canvas.clientWidth || 640) * dpr));
  const h = Math.max(2, Math.round((canvas.clientHeight || 360) * dpr));
  const bw = sbsMode ? w * 2 : w;
  // Writing width/height clears the buffer even if unchanged: only touch it on a real change.
  if (canvas.width !== bw || canvas.height !== h) renderer.setSize(bw, h, false);
  monoCam.aspect = w / h; monoCam.updateProjectionMatrix();
}

function animate() {
  yaw += (targetYaw - yaw) * 0.18;
  chart.rotation.y = yaw;
}

// ---- stereo frame ----------------------------------------------------------------------------
let lastGood = null;                     // COPIES of the last good matrices (XRView is callback-scoped)
function onXRFrame(views, layer) {
  try {
    animate();
    ensureSize();
    let vps = null;
    if (views && views.length >= 2 && layer) {
      vps = [layer.getViewport(views[0]), layer.getViewport(views[1])];
      if (vps.some((v) => !v || v.width <= 0 || v.height <= 0)) vps = null;
    }
    let mats;
    if (vps) {
      mats = [0, 1].map((i) => ({
        p: Float32Array.from(views[i].projectionMatrix),
        t: Float32Array.from(views[i].transform.matrix),
        vp: vps[i],
      }));
      lastGood = mats;
    } else if (lastGood) {
      mats = lastGood;                   // repaint the last good frame rather than skip
    } else return;
    renderer.clear();
    renderer.setScissorTest(true);
    for (let i = 0; i < 2; i++) {
      const m = mats[i];
      renderer.setViewport(m.vp.x, m.vp.y, m.vp.width, m.vp.height);
      renderer.setScissor(m.vp.x, m.vp.y, m.vp.width, m.vp.height);
      eyes[i].setFromMatrices(m.p, m.t);
      renderer.render(scene, eyes[i].camera);
      feather.render(renderer, m.vp);
    }
    renderer.setScissorTest(false);
  } catch (e) { console.error(e); dropCover(); }
}

let mono3d = true;
function onMonoFrame() {
  requestAnimationFrame(onMonoFrame);
  animate();
  ensureSize();
  const s = mono3d ? Number(slider.value) / 100 : 0;
  monoCam.position.x = swayX * 0.08 * s;
  monoCam.lookAt(0, 0, 0);
  renderer.clear();
  renderer.setViewport(0, 0, canvas.width, canvas.height);
  renderer.render(scene, monoCam);
}

// ---- controls --------------------------------------------------------------------------------
const VDH = 0.2;   // virtual display height (m): the ~0.22 m wide chart fills most of a 16:9 window
let handle = null, want3d = true;

function pushRig() {
  if (!handle) return;
  const s = want3d ? Number(slider.value) / 100 : 0;
  // Display-rig factors are RELATIVE [0,1]; disparity (ipd) and look-around (parallax) scale together.
  handle.setViewRig(displayRig({ virtualDisplayHeight: VDH, ipdFactor: s, parallaxFactor: s }));
}
slider.addEventListener('input', () => {
  sliderVal.textContent = `${slider.value}%`;
  pushRig();
});
modeBtn.addEventListener('click', async () => {
  want3d = !want3d;
  modeBtn.textContent = want3d ? 'Switch to 2D' : 'Switch to 3D';
  modeBtn.setAttribute('aria-pressed', String(want3d));
  slider.disabled = !want3d;
  mono3d = want3d;
  if (handle) {
    try { await handle.setStereoEnabled(want3d); }   // real hardware-2D mode where available
    catch (e) { console.warn('rendering-mode request failed; using a flat rig only', e); }
    pushRig();                                        // keeps/flattens the rig either way
  }
});

// ---- boot ------------------------------------------------------------------------------------
(async () => {
  try {
    const wall = await createInline3D({ lazy: false });
    if (wall.supported) {
      handle = wall.addScene(canvas, onXRFrame, {
        viewRig: displayRig({ virtualDisplayHeight: VDH, ipdFactor: 1, parallaxFactor: 1 }),
      });
      sbsMode = true;
      ensureSize();
      handle.firstWoven.then(dropCover, dropCover);
      statusEl.innerHTML = '<b>3D active</b> — move your head to look around.';
    } else {
      statusEl.innerHTML = '<b>2D fallback</b> — open in the DisplayXR Browser on a 3D display for depth. ' +
        'Move the mouse to preview the strength slider as parallax.';
      dropCover();
      requestAnimationFrame(onMonoFrame);
    }
  } catch (e) {
    console.error(e);
    statusEl.textContent = '2D fallback';
    dropCover();
    sbsMode = false;
    requestAnimationFrame(onMonoFrame);
  }
})();
