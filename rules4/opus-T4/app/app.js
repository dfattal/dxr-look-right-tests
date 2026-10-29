// Quarterly sales — a 3D bar chart in one woven tile.
//
// Rig: the DEFAULT DISPLAY RIG. The chart is a subject the viewer looks at (and may tilt), not a
// world they move through, so the canvas is a portal and the runtime places the eyes. SceneViewer
// (@displayxr/inline3d/viewer) does the framing (subject centred on the zero-disparity plane,
// scaled to the tile), the validated side-by-side loop, the tracking ease and the mono fallback.
//
// Depth controls:
//   slider  -> handle.setViewRig(displayRig({ ipdFactor }))   relative eye separation, 0..1
//   button  -> wall.setStereoEnabled(false/true)                the panel's real 1-view / 2-view mode

import * as THREE from 'three';
import {
  createInline3D,
  inline3dViewRigSupported,
  inline3dDisplayModesSupported,
} from '@displayxr/inline3d';
import { EyeCamera, displayRig } from '@displayxr/inline3d/three';
import { SceneViewer } from '@displayxr/inline3d/viewer';

// ---- data ------------------------------------------------------------------------------------
const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];
const REGIONS = [
  // Front-to-back order in the chart: the lowest series in front so it never hides the others.
  { name: 'South', color: '#f5a524', values: [9, 11, 13, 12] },
  { name: 'West', color: '#3ecf8e', values: [7, 10, 12, 16] },
  { name: 'North', color: '#4e9cf5', values: [12, 15, 14, 18] },
];
const AXIS_MAX = 20;

// ---- look ------------------------------------------------------------------------------------
const BG = '#1c2029';            // = page --bg. Dark grey, not black (crosstalk; rule 3).
const LABEL = '#d3d9e3';         // light grey, not pure white: less contrast far from the glass
const VDH = 0.24;                // virtual display height (m) — the SDK default, used everywhere
const BASE_PITCH = 22;           // deg: look down onto the chart so the floor and rows read
const BASE_YAW = 20;             // deg: three-quarter view so the bar sides give shape

// ---- DOM -------------------------------------------------------------------------------------
const canvas = document.getElementById('chart');
const cover = document.getElementById('cover');
const slider = document.getElementById('strength');
const sliderOut = document.getElementById('strengthOut');
const modeBtn = document.getElementById('mode');
const statusEl = document.getElementById('status');

let coverDropped = false;
function dropCover() {
  if (coverDropped) return;
  coverDropped = true;
  cover.hidden = true;           // hard cut, never a fade
  startGrow();
}
// Rule 4: the cover ALWAYS comes off, even if no signal ever arrives.
const coverTimer = setTimeout(dropCover, 6000);

// ---- viewer ----------------------------------------------------------------------------------
const viewer = new SceneViewer(THREE, canvas, {
  virtualDisplayHeight: VDH,
  fit: 'contain',
  margin: 0.84,
  fitSweep: false,   // our drag is limited to ±35° yaw, so fit the face-on width, not the diagonal
  orbit: false,      // own gentle drag below: no wheel zoom (it would rescale the depth)
  idleSpin: 0,       // a chart should hold still while it is being read
});
viewer.useEyeCamera(EyeCamera);
// Opaque clear in the page colour. A transparent woven frame weaves BLACK on the panel
// (woven-canvas-rules, "a transparent canvas weaves black"), which would put the bright bars on
// black — exactly what doubles. Matching the page also makes the tile edge invisible.
viewer.renderer.setClearColor(new THREE.Color(BG), 1);

const maxAniso = viewer.renderer.capabilities.getMaxAnisotropy();

// ---- lights (scene space; they do not turn with the chart) -------------------------------------
viewer.scene.add(new THREE.HemisphereLight(0xe4ecff, 0x30343d, 1.5));
const key = new THREE.DirectionalLight(0xffffff, 2.0);
key.position.set(-0.4, 1.0, 0.7);
viewer.scene.add(key);
const fill = new THREE.DirectionalLight(0xbfd2ff, 0.5);
fill.position.set(0.8, 0.2, 0.4);
viewer.scene.add(fill);

// ---- chart geometry (model units; SceneViewer scales it into the display) ---------------------
const tilt = new THREE.Group();          // the resting three-quarter view, baked into the subject
tilt.rotation.set(THREE.MathUtils.degToRad(BASE_PITCH), THREE.MathUtils.degToRad(BASE_YAW), 0, 'XYZ');
viewer.content.add(tilt);
const chart = new THREE.Group();
tilt.add(chart);

const COL = 1.3;                         // quarter spacing (x)
const ROW = 1.0;                         // region spacing (z)
const BAR = 0.68;                        // bar footprint
const UNIT = 0.16;                       // height per $M
const xOf = (q) => (q - 1.5) * COL;
const zOf = (r) => (1 - r) * ROW;        // r=0 front (+z), r=2 back
const HALF_W = 2 * COL + 0.25;
const HALF_D = 1.5 * ROW + 0.1;
const TOP = AXIS_MAX * UNIT;

// floor
const floor = new THREE.Mesh(
  new THREE.BoxGeometry(HALF_W * 2, 0.06, HALF_D * 2),
  new THREE.MeshStandardMaterial({ color: '#2d3340', roughness: 0.9 }),
);
floor.position.y = -0.03;
chart.add(floor);

// back wall + horizontal grid lines every $5M (thin boxes, not 1px GL lines, which alias badly
// once each eye only gets half the panel's columns)
const wall = new THREE.Mesh(
  new THREE.PlaneGeometry(HALF_W * 2, TOP + 0.15),
  new THREE.MeshStandardMaterial({ color: '#262b36', roughness: 1 }),
);
wall.position.set(0, (TOP + 0.15) / 2, -HALF_D);
chart.add(wall);
const gridMat = new THREE.MeshBasicMaterial({ color: '#434b5c' });
for (let v = 5; v <= AXIS_MAX; v += 5) {
  const line = new THREE.Mesh(new THREE.BoxGeometry(HALF_W * 2, 0.018, 0.01), gridMat);
  line.position.set(0, v * UNIT, -HALF_D + 0.006);
  chart.add(line);
}

// bars
const bars = [];
for (let r = 0; r < REGIONS.length; r++) {
  const mat = new THREE.MeshStandardMaterial({ color: REGIONS[r].color, roughness: 0.45, metalness: 0.05 });
  for (let q = 0; q < QUARTERS.length; q++) {
    const h = REGIONS[r].values[q] * UNIT;
    const geo = new THREE.BoxGeometry(BAR, h, BAR);
    geo.translate(0, h / 2, 0);            // grow from the floor
    const bar = new THREE.Mesh(geo, mat);
    bar.position.set(xOf(q), 0, zOf(r));
    chart.add(bar);
    bars.push(bar);
  }
}

// ---- labels: canvas-text planes, billboarded to face the glass ---------------------------------
// Facing the glass keeps text flat at one depth (no slant in disparity) and readable whatever the
// tilt. Large raster + mipmaps + anisotropy: each eye only gets about half the panel's columns.
const labels = [];
function makeLabel(text, { height, color = LABEL, weight = 600, align = 'center' }) {
  const px = 112;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const font = `${weight} ${px}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.font = font;
  const pad = px * 0.25;
  c.width = Math.ceil(ctx.measureText(text).width + pad * 2);
  c.height = Math.ceil(px * 1.3);
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, pad, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  const w = (height * c.width) / c.height;
  const geo = new THREE.PlaneGeometry(w, height);
  if (align === 'left') geo.translate(w / 2 - (height * pad) / c.height, 0, 0);
  if (align === 'right') geo.translate(-w / 2 + (height * pad) / c.height, 0, 0);
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }),
  );
  mesh.renderOrder = 2;
  labels.push(mesh);
  return mesh;
}

// quarter labels along the front edge
for (let q = 0; q < QUARTERS.length; q++) {
  const l = makeLabel(QUARTERS[q], { height: 0.34, weight: 650 });
  l.position.set(xOf(q), 0.02, HALF_D + 0.32);
  chart.add(l);
}
// region labels at the left end of each row, in the series colour
for (let r = 0; r < REGIONS.length; r++) {
  const l = makeLabel(REGIONS[r].name, { height: 0.3, color: REGIONS[r].color, weight: 700, align: 'right' });
  l.position.set(-HALF_W - 0.12, 0.12, zOf(r));
  chart.add(l);
}
// value axis ticks on the right edge of the back wall
for (let v = 0; v <= AXIS_MAX; v += 5) {
  const l = makeLabel(v === AXIS_MAX ? `$${v}M` : String(v), { height: 0.22, color: '#aab3c2', weight: 500, align: 'left' });
  l.position.set(HALF_W + 0.08, v * UNIT, -HALF_D);
  chart.add(l);
}
// value on top of every bar (shown once the bars have grown)
const valueLabels = [];
for (let r = 0; r < REGIONS.length; r++) {
  for (let q = 0; q < QUARTERS.length; q++) {
    const v = REGIONS[r].values[q];
    const l = makeLabel(String(v), { height: 0.24, weight: 650 });
    l.position.set(xOf(q), v * UNIT + 0.2, zOf(r));
    chart.add(l);
    valueLabels.push(l);
  }
}

const _q = new THREE.Quaternion();
function billboard() {
  for (const l of labels) {
    l.parent.getWorldQuaternion(_q);
    l.quaternion.copy(_q.invert());
  }
}

// ---- framing -----------------------------------------------------------------------------------
// The bounding box of the tilted chart (labels included), in content space. SceneViewer centres it
// on z = 0 — the glass — and scales it to the tile: the front rows come slightly out, the back wall
// sits slightly behind, which is the smallest disparity spread the subject can have.
let fitCenter = null;
let fitSize = null;
function measureAndFit() {
  viewer.content.updateMatrixWorld(true);
  billboard();
  viewer.content.updateMatrixWorld(true);
  // Box in the content's own space: temporarily treat content as the root.
  const inv = new THREE.Matrix4().copy(viewer.content.matrixWorld).invert();
  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  viewer.content.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry.computeBoundingBox();
    tmp.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld).applyMatrix4(inv);
    box.union(tmp);
  });
  fitCenter = box.getCenter(new THREE.Vector3());
  fitSize = box.getSize(new THREE.Vector3());
  viewer.fitTo(fitCenter, fitSize);
}
measureAndFit();
// fitTo sizes against the tile's aspect at the call: refit when the box changes shape.
new ResizeObserver(() => { if (fitCenter) viewer.fitTo(fitCenter, fitSize); }).observe(canvas);

// ---- gentle drag-to-tilt (bounded; no zoom) ------------------------------------------------------
const YAW_LIMIT = 35;
const PITCH_RANGE = [-18, 22];           // added to BASE_PITCH: 4°..44° total
let tYaw = 0, tPitch = 0, yaw = 0, pitch = 0, drag = null;
canvas.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const box = canvas.getBoundingClientRect();
  tYaw = THREE.MathUtils.clamp(tYaw + ((e.clientX - drag.x) / box.width) * 90, -YAW_LIMIT, YAW_LIMIT);
  tPitch = THREE.MathUtils.clamp(tPitch + ((e.clientY - drag.y) / box.height) * 60, PITCH_RANGE[0], PITCH_RANGE[1]);
  drag.x = e.clientX;
  drag.y = e.clientY;
});
const endDrag = (e) => { drag = null; canvas.releasePointerCapture?.(e.pointerId); };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('dblclick', () => { tYaw = 0; tPitch = 0; });

// ---- bar grow-in once the chart is revealed ------------------------------------------------------
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let growStart = reduceMotion ? -1 : Infinity;   // Infinity = not started; -1 = done
function startGrow() { if (growStart === Infinity) growStart = performance.now() + 150; }
function applyGrow(now) {
  let k = 1;
  if (growStart === Infinity) k = 0;
  else if (growStart >= 0) {
    const t = THREE.MathUtils.clamp((now - growStart) / 900, 0, 1);
    k = 1 - Math.pow(1 - t, 3);
    if (t >= 1) growStart = -1;
  }
  for (const b of bars) b.scale.y = Math.max(k, 0.001);
  for (const l of valueLabels) l.visible = k >= 1;
}

viewer.onTick = () => {
  // Eased pose from the drag; snaps through setPose (the viewer's own orbit is off).
  yaw += (tYaw - yaw) * 0.18;
  pitch += (tPitch - pitch) * 0.18;
  if (Math.abs(tYaw - yaw) < 1e-3) yaw = tYaw;
  if (Math.abs(tPitch - pitch) < 1e-3) pitch = tPitch;
  viewer.setPose({ yaw, pitch });
  applyGrow(performance.now());
  billboard();
};

// ---- 3D strength + 2D/3D -------------------------------------------------------------------------
let wallMgr = null;
let handle = null;
let strength = 1;              // display-rig ipdFactor, relative [0,1]; 1 = what the display does
let want2D = false;            // what the button shows; corrected by renderingmodechange
let useModes = false;          // the real 1-view mode is available
let rigFlat = false;           // fallback when there is no 1-view mode: flatten the rig ourselves
const rigOut = {};

function rigNow() {
  const flat = rigFlat;
  return displayRig({
    virtualDisplayHeight: VDH,
    ipdFactor: flat ? 0 : strength,
    // Head-tracked look-around stays at the display's natural response: the slider is about
    // disparity (the double-image risk), not about how the portal follows your head.
    parallaxFactor: flat ? 0 : 1,
    out: rigOut,
  });
}
function pushRig() { if (handle) handle.setViewRig(rigNow()); }

slider.addEventListener('input', () => {
  strength = Number(slider.value) / 100;
  sliderOut.value = `${slider.value}%`;
  pushRig();
});

function updateUi() {
  modeBtn.textContent = want2D ? 'Switch to 3D' : 'Switch to 2D';
  modeBtn.setAttribute('aria-pressed', String(want2D));
  slider.disabled = !handle || want2D || !inline3dViewRigSupported();
}

async function toggleMode() {
  const goFlat = !want2D;
  want2D = goFlat;
  updateUi();
  if (useModes) {
    try {
      await wallMgr.setStereoEnabled(!goFlat);   // eased: disparity ramps out before the panel flips
      return;
    } catch (e) {
      if (e && e.name === 'superseded') return;  // a second click reversed it mid-ramp: fine
      console.warn('[chart] setStereoEnabled failed, flattening the rig instead:', e);
      useModes = false;
    }
  }
  // No requestable 1-view mode: both eyes from one point. Flat, though the panel stays in 3D mode.
  rigFlat = goFlat;
  pushRig();
  setStatus();
}
modeBtn.addEventListener('click', toggleMode);

let trackingHint = false;
function setStatus(extra) {
  if (!wallMgr || !wallMgr.supported) {
    statusEl.innerHTML = extra || '<b>2D view</b> — this browser has no glasses-free 3D. ' +
      'Open the page in the DisplayXR Browser on a 3D display for depth.';
    return;
  }
  let s = want2D ? '<b>2D mode</b> — the display is showing the chart flat.' :
    '<b>3D on</b> — move your head slightly to look around the bars.';
  if (!inline3dViewRigSupported()) s += ' (This browser cannot adjust depth, so the slider is off.)';
  if (trackingHint && !want2D) s += ' <span class="hint">Move back into view of the display for 3D.</span>';
  statusEl.innerHTML = extra || s;
}

// ---- boot ------------------------------------------------------------------------------------------
const twoFrames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

function goMono(msg) {
  viewer.startMono();
  slider.disabled = true;
  modeBtn.disabled = true;
  modeBtn.title = 'Needs a glasses-free 3D display';
  slider.title = 'Needs a glasses-free 3D display';
  setStatus(msg);
  // One mono frame on the canvas before the cover comes off.
  requestAnimationFrame(() => requestAnimationFrame(dropCover));
}

(async () => {
  try {
    wallMgr = await createInline3D({ lazy: false });
    if (!wallMgr.supported) { goMono(); return; }

    // Rule 4: the canvas has its final box, will-change from first paint and (SceneViewer) a 2:1
    // backing store already; give the compositor two frames before registering it.
    await twoFrames();
    handle = wallMgr.addScene(canvas, viewer.onFrame, {
      viewRig: rigNow(),                       // display rig, VDH 0.24, ipdFactor from the slider
      onLayerLost: () => {
        handle = null;
        goMono('<b>2D view</b> — the 3D session ended, so the chart is shown flat.');
      },
      bufferClamped: true,                     // SceneViewer sizes and clamps its own store
      rectCover: { color: BG, snapshot: true },// resize / reflow: cover until rewoven
    });

    useModes = inline3dDisplayModesSupported();
    wallMgr.on('renderingmodechange', () => {
      const vc = wallMgr.activeMode.viewCount;
      if (vc > 0 && !rigFlat) want2D = vc === 1;
      updateUi();
      setStatus();
    });
    wallMgr.on('trackingstatechange', (state) => {
      // MANAGED displays go flat themselves; this is a hint only.
      trackingHint = state === 'searching';
      setStatus();
    });

    modeBtn.disabled = false;
    updateUi();
    setStatus();

    const res = await handle.firstWoven;
    clearTimeout(coverTimer);
    dropCover();
    if (!res.woven) console.warn('[chart] window did not weave:', res.reason);
    const vc = wallMgr.activeMode.viewCount;   // a panel that opened flat
    if (vc === 1) { want2D = true; updateUi(); setStatus(); }
  } catch (err) {
    console.error('[chart] inline-3D setup failed; showing the 2D chart', err);
    goMono();
  }
})();
