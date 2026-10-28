// Quarterly sales — a 3D bar chart for a DisplayXR spatial display, with a plain-2D fallback.
//
// Structure (see NOTES.md for the reasoning behind every depth number):
//   - SceneViewer (@displayxr/inline3d/viewer) owns the renderer, the side-by-side render loop,
//     last-good-frame replay, resize handling and the mono fallback. We put the chart in
//     `viewer.content` and drive its pose ourselves through setPose().
//   - DISPLAY rig: the canvas is a portal; the chart is the subject and we tilt the SUBJECT, never
//     a camera. The slider scales the rig's ipdFactor/parallaxFactor (relative, [0,1]).
//   - The 2D button asks the panel for its real 1-view mode (wall.setStereoEnabled(false)) and
//     morphs the chart into a flat, front-on grouped bar chart.

import * as THREE from 'three';
import { createInline3D, inline3dViewRigSupported, inline3dDisplayModesSupported } from '@displayxr/inline3d';
import { EyeCamera, DepthCursor, displayRig, raycastHitTest } from '@displayxr/inline3d/three';
import { SceneViewer } from '@displayxr/inline3d/viewer';

// ---- data ------------------------------------------------------------------------------------
const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];
const REGIONS = [
  // `row` is the depth row in the 3D layout: -1 = back, +1 = front. Tallest series at the back so
  // it never hides the others; the shortest-on-average series in front.
  { name: 'North', color: 0x5b9cff, values: [12, 15, 14, 18], row: -1 },
  { name: 'South', color: 0xffad4d, values: [9, 11, 13, 12], row: 0 },
  { name: 'West', color: 0x3fcf9c, values: [7, 10, 12, 16], row: 1 },
];

// ---- depth & layout constants (model units; SceneViewer.fitTo scales them to the tile) --------
const VDH = 0.24;            // virtualDisplayHeight (m): the SDK default; the display rig is scale-invariant
const U = 0.2;               // model units per $1M of bar height (18M -> 3.6)
const SX = 1.45;             // spacing between quarter groups along x
const SZ = 0.55;             // spacing between region rows along z (3D layout) — the main depth knob
const BAR3D = 0.55;          // bar footprint in the 3D layout
const BAR2D = 0.36;          // bar footprint in the flat grouped layout
const GROUP2D = 0.4;         // x offset between regions inside a quarter group (2D layout)
const FLOOR_HX = 2.75;       // floor half-width
const FLOOR_HZ3D = 0.9;      // floor half-depth, 3D layout
const FLOOR_HZ2D = 0.3;      // floor half-depth, 2D layout
const GRID_MAX = 20;         // y-axis gridlines up to $20M
// Subject box handed to fitTo: x covers the y-axis labels on the left, y the quarter labels below
// the floor and the hover value label over the tallest bar. Its centre lands on the glass (z=0).
const BOX_MIN = [-FLOOR_HX - 0.55, -0.55, -FLOOR_HZ3D];
const BOX_MAX = [FLOOR_HX + 0.05, U * GRID_MAX + 0.35, FLOOR_HZ3D];
const BOX_CENTER = BOX_MIN.map((v, i) => (v + BOX_MAX[i]) / 2);
const BOX_EXTENT = BOX_MIN.map((v, i) => BOX_MAX[i] - v);

// Pose (degrees). On the 3D display the tilt is kept small: yaw swings the 6-unit-wide chart
// into depth and pitch swings the bar heights into depth, so both cost depth budget.
const POSE_STEREO = { yaw: -8, pitch: 10 };
// In a plain browser there is no depth budget; the tilt IS the 3D cue, and the slider scales it.
const POSE_MONO_MIN = { yaw: -6, pitch: 6 };
const POSE_MONO_MAX = { yaw: -32, pitch: 24 };
const DRAG_LIMIT_STEREO = { yaw: 16, pitchLo: -6, pitchHi: 10 };
const DRAG_LIMIT_MONO = { yaw: 35, pitchLo: -10, pitchHi: 20 };

const BG = '#0e1118';        // must equal --bg in index.html: the tile has no visible edge

// ---- DOM -------------------------------------------------------------------------------------
const canvas = document.getElementById('chart');
const cover = document.getElementById('cover');
const readout = document.getElementById('readout');
const slider = document.getElementById('strength');
const sliderOut = document.getElementById('strengthOut');
const modeBtn = document.getElementById('mode');
const statusEl = document.getElementById('status');

// ---- state -----------------------------------------------------------------------------------
const S = {
  stereo: false,        // true while a live inline-3D layer is weaving this canvas
  rigOK: false,         // browser accepts setViewRig (the slider's mechanism on the panel)
  modesOK: false,       // browser exposes rendering modes (a real 2D panel mode)
  flat: false,          // the user picked 2D
  strength: slider.valueAsNumber / 100,
  morph: 0, grow: 0, growStart: -1,
  yaw: POSE_STEREO.yaw, pitch: POSE_STEREO.pitch,
  userYaw: 0, userPitch: 0,
  pointer: null,        // NDC of the pointer over the canvas, or null
  hovered: null,
  lastT: 0,
};
let wall = null;
let handle = null;

// ---- viewer + scene --------------------------------------------------------------------------
const viewer = new SceneViewer(THREE, canvas, {
  virtualDisplayHeight: VDH,
  fit: 'contain',
  margin: 0.9,
  fitSweep: false,      // yaw is bounded to a few degrees; no need to reserve width for a full turn
  orbit: false,         // our own bounded drag below; SceneViewer's orbit would also wheel-zoom the page
  idleSpin: 0,
});
// Opaque background equal to the page colour (a transparent woven frame weaves black).
viewer.scene.background = new THREE.Color(BG);

viewer.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x1a1f2b, 1.1));
const key = new THREE.DirectionalLight(0xffffff, 1.6);
key.position.set(0.5, 1.0, 0.9);       // world space: the light stays put while the chart tilts
viewer.scene.add(key);

const chart = new THREE.Group();
viewer.content.add(chart);

// Text as textured quads. Kept moderate in contrast (not pure white) because on a lenticular panel
// crosstalk ghosting scales with contrast; and drawn large, since small text off the glass blurs.
function makeLabel(text, { size = 0.3, color = '#b8c0d0', weight = 600 } = {}) {
  const px = 128;
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const font = `${weight} ${px * 0.78}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  g.font = font;
  const w = Math.ceil(g.measureText(text).width + px * 0.3);
  c.width = w; c.height = px;
  g.font = font;
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, px * 0.54);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size * (w / px), size), mat);
  mesh.renderOrder = 10;
  return mesh;
}

// Floor + back wall with y-axis gridlines. Unit boxes, scaled per frame by the layout morph.
const unitBox = new THREE.BoxGeometry(1, 1, 1);
const baseBox = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);   // origin at the base
const floor = new THREE.Mesh(unitBox, new THREE.MeshStandardMaterial({ color: 0x1a2030, roughness: 0.9 }));
chart.add(floor);
const wall3 = new THREE.Mesh(unitBox, new THREE.MeshStandardMaterial({ color: 0x151a26, roughness: 1 }));
chart.add(wall3);
const gridMat = new THREE.MeshBasicMaterial({ color: 0x323b51 });
const gridLines = [];
const yLabels = [];
for (let v = 5; v <= GRID_MAX; v += 5) {
  const line = new THREE.Mesh(unitBox, gridMat);
  chart.add(line);
  gridLines.push({ mesh: line, v });
  const lab = makeLabel(String(v), { size: 0.28, color: '#8c95a8', weight: 500 });
  chart.add(lab);
  yLabels.push({ mesh: lab, v });
}
const qLabels = QUARTERS.map((q) => {
  const lab = makeLabel(q, { size: 0.34, color: '#c9d0de' });
  chart.add(lab);
  return lab;
});

const bars = [];
const barGroup = new THREE.Group();
chart.add(barGroup);
REGIONS.forEach((reg, r) => {
  reg.values.forEach((value, q) => {
    const color = new THREE.Color(reg.color);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.0 });
    const mesh = new THREE.Mesh(baseBox, mat);
    mesh.userData.bar = { r, q, value, region: reg.name, quarter: QUARTERS[q], color };
    barGroup.add(mesh);
    const label = makeLabel(String(value), { size: 0.3, color: '#e3e7ef' });
    label.material.opacity = 0;
    label.visible = false;
    chart.add(label);
    bars.push({ mesh, mat, label, r, q, value, row: reg.row, color, show: 0 });
  });
});

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const smooth = (t) => t * t * (3 - 2 * t);

// Lay the chart out for morph m (0 = depth rows, 1 = flat grouped) and growth g (intro).
function layout(m, g) {
  const ms = smooth(m);
  const hz = lerp(FLOOR_HZ3D, FLOOR_HZ2D, ms);
  floor.scale.set(FLOOR_HX * 2, 0.04, hz * 2);
  floor.position.set(0, -0.02, 0);
  const wallZ = -hz - 0.01;
  const wallH = U * GRID_MAX + 0.1;
  wall3.scale.set(FLOOR_HX * 2, wallH, 0.02);
  wall3.position.set(0, wallH / 2, wallZ);
  for (const { mesh, v } of gridLines) {
    mesh.scale.set(FLOOR_HX * 2, 0.022, 0.004);
    mesh.position.set(0, U * v, wallZ + 0.012);
  }
  for (const { mesh, v } of yLabels) mesh.position.set(-FLOOR_HX - 0.3, U * v, wallZ + 0.02);
  qLabels.forEach((lab, q) => lab.position.set((q - 1.5) * SX, -0.3, hz + 0.02));

  const w = lerp(BAR3D, BAR2D, ms);
  for (const b of bars) {
    const x = (b.q - 1.5) * SX + ms * (b.r - 1) * GROUP2D;
    const z = (1 - ms) * b.row * SZ;
    const h = Math.max(0.001, U * b.value * g);
    b.mesh.scale.set(w, h, w);
    b.mesh.position.set(x, 0, z);
    b.label.position.set(x, h + 0.25, z + w / 2);
  }
}

viewer.fitTo(BOX_CENTER, BOX_EXTENT);
layout(0, 0);

// ---- per-frame animation (runs from SceneViewer's tick in both the 3D and the mono loop) -------
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const invQ = new THREE.Quaternion();
const euler = new THREE.Euler();

function targetPose() {
  if (S.flat) return { yaw: 0, pitch: 0 };
  let base, lim;
  if (S.stereo) {
    base = POSE_STEREO;
    lim = DRAG_LIMIT_STEREO;
  } else {
    const t = S.strength;
    base = { yaw: lerp(POSE_MONO_MIN.yaw, POSE_MONO_MAX.yaw, t), pitch: lerp(POSE_MONO_MIN.pitch, POSE_MONO_MAX.pitch, t) };
    lim = DRAG_LIMIT_MONO;
  }
  S.userYaw = clamp(S.userYaw, -lim.yaw, lim.yaw);
  S.userPitch = clamp(S.userPitch, lim.pitchLo, lim.pitchHi);
  return { yaw: base.yaw + S.userYaw, pitch: base.pitch + S.userPitch };
}

viewer.onTick = () => {
  const now = performance.now();
  const dt = S.lastT ? Math.min((now - S.lastT) / 1000, 0.1) : 0;
  S.lastT = now;
  // Damped approach: no snaps (a snap reads as a jump on a head-tracked display).
  const k = 1 - Math.exp(-dt * 6);

  const tp = targetPose();
  S.yaw += (tp.yaw - S.yaw) * k;
  S.pitch += (tp.pitch - S.pitch) * k;
  viewer.setPose({ yaw: S.yaw, pitch: S.pitch });

  S.morph += ((S.flat ? 1 : 0) - S.morph) * k;
  if (Math.abs(S.morph - (S.flat ? 1 : 0)) < 1e-3) S.morph = S.flat ? 1 : 0;
  if (S.growStart >= 0) S.grow = easeOutCubic(clamp((now - S.growStart) / 1100, 0, 1));
  layout(S.morph, S.grow);

  // Labels face the viewer: undo the pivot's rotation (SceneViewer applies Euler XYZ pitch, yaw).
  euler.set((S.pitch * Math.PI) / 180, (S.yaw * Math.PI) / 180, 0, 'XYZ');
  invQ.setFromEuler(euler).invert();
  for (const l of qLabels) l.quaternion.copy(invQ);
  for (const { mesh } of yLabels) mesh.quaternion.copy(invQ);

  // Hover pick through the mono camera: it frames the z=0 plane exactly as the display rig does,
  // so it is exact on the glass and a close approximation a few cm off it.
  let hit = null;
  if (S.pointer && S.grow > 0.5) {
    viewer.scene.updateMatrixWorld();
    viewer.monoCamera.updateMatrixWorld();
    raycaster.setFromCamera(ndc.set(S.pointer.x, S.pointer.y), viewer.monoCamera);
    const hits = raycaster.intersectObjects(barGroup.children, false);
    if (hits.length) hit = hits[0].object;
  }
  setHovered(hit);

  // Value labels: all of them in the flat chart (they sit on the glass, so they are crisp), only
  // the hovered bar's in depth (a dozen numbers floating at a dozen depths is clutter + crosstalk).
  for (const b of bars) {
    const want = Math.max(smooth(S.morph), b.mesh === S.hovered ? 1 : 0) * (S.grow > 0.95 ? 1 : 0);
    b.show += (want - b.show) * Math.min(1, k * 2);
    b.label.material.opacity = b.show;
    b.label.visible = b.show > 0.01;
    b.label.quaternion.copy(invQ);
  }
};

function setHovered(mesh) {
  if (mesh === S.hovered) return;
  if (S.hovered) S.hovered.material.emissive.setHex(0x000000);
  S.hovered = mesh;
  if (mesh) {
    const d = mesh.userData.bar;
    mesh.material.emissive.copy(d.color).multiplyScalar(0.28);
    readout.innerHTML = `<b>${d.region} · ${d.quarter}</b> &nbsp;$${d.value}M`;
  } else {
    readout.innerHTML = '&nbsp;';
  }
}

// ---- input: bounded drag to tilt, hover readout ---------------------------------------------
let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  if (S.flat) return;
  drag = { x: e.clientX, y: e.clientY };
  canvas.setPointerCapture(e.pointerId);
  canvas.classList.add('dragging');
});
canvas.addEventListener('pointermove', (e) => {
  const r = canvas.getBoundingClientRect();
  S.pointer = { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 };
  if (!drag) return;
  S.userYaw += ((e.clientX - drag.x) / r.width) * 70;
  S.userPitch += ((e.clientY - drag.y) / r.height) * 40;
  targetPose(); // clamps the offsets so the drag never winds up past the limit
  drag.x = e.clientX; drag.y = e.clientY;
});
const endDrag = () => { drag = null; canvas.classList.remove('dragging'); };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('pointerleave', () => { if (!drag) S.pointer = null; });
canvas.addEventListener('dblclick', () => { S.userYaw = 0; S.userPitch = 0; });
canvas.addEventListener('keydown', (e) => {
  if (S.flat) return;
  const step = { ArrowLeft: [-4, 0], ArrowRight: [4, 0], ArrowUp: [0, -3], ArrowDown: [0, 3] }[e.key];
  if (step) { S.userYaw += step[0]; S.userPitch += step[1]; targetPose(); e.preventDefault(); }
  if (e.key === 'Home') { S.userYaw = 0; S.userPitch = 0; }
});

// Refit when the tile's aspect changes (fitTo reads the canvas box). SceneViewer resizes the
// backing store itself.
new ResizeObserver(() => viewer.fitTo(BOX_CENTER, BOX_EXTENT)).observe(canvas);

// ---- 3D strength slider ---------------------------------------------------------------------
const rigScratch = {};
function currentRig() {
  // Display rig: both factors are RELATIVE in [0,1] — 1 is what the display does naturally.
  // Scaling them together is "the viewer's eyes and head offset pulled toward the nominal centre",
  // which keeps stereo and look-around consistent with each other.
  return displayRig({
    virtualDisplayHeight: VDH,
    ipdFactor: S.strength,
    parallaxFactor: S.strength,
    out: rigScratch,
  });
}
function flatRig() {
  return displayRig({ virtualDisplayHeight: VDH, ipdFactor: 0, parallaxFactor: 0 });
}
function pushRig() {
  if (!handle || !S.rigOK) return;
  // If the panel has no real 2D mode, "2D" is a flat rig (both eyes from one point).
  handle.setViewRig(S.flat && !S.modesOK ? flatRig() : currentRig());
}
slider.addEventListener('input', () => {
  S.strength = slider.valueAsNumber / 100;
  sliderOut.textContent = `${slider.value}%`;
  pushRig();
});

// ---- 3D / 2D button -------------------------------------------------------------------------
async function setFlat(flat) {
  S.flat = flat;
  modeBtn.textContent = flat ? 'Switch to 3D' : 'Switch to 2D';
  modeBtn.setAttribute('aria-pressed', String(flat));
  slider.disabled = flat || (S.stereo && !S.rigOK);
  if (flat) setHovered(null);
  if (!S.stereo) return;           // plain browser: the morph to a flat chart is the whole switch
  if (S.modesOK) {
    // The panel's real 1-view mode: optics off, full-resolution 2D, no weave. The SDK eases the
    // disparity out before the panel flips and back in after it reports 3D again.
    try {
      await wall.setStereoEnabled(!flat);
    } catch (err) {
      if (err && err.name === 'superseded') return;   // a quick re-press reversed it; fine
      console.warn('[sales3d] setStereoEnabled failed; flattening the rig instead', err);
      S.modesOK = false;
      pushRig();
    }
  } else {
    pushRig();
  }
}
modeBtn.addEventListener('click', () => setFlat(!S.flat));

// ---- boot -----------------------------------------------------------------------------------
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

function startMono(msg) {
  S.stereo = false;
  viewer.startMono();
  cover.hidden = true;
  if (S.growStart < 0) S.growStart = performance.now();
  statusEl.innerHTML = msg;
}

(async () => {
  try {
    wall = await createInline3D({ lazy: false });
  } catch (err) {
    console.warn('[sales3d] createInline3D failed', err);
    wall = null;
  }
  if (!wall || !wall.supported) {
    startMono('Standard 2D view — open this page in the DisplayXR Browser on a 3D display for glasses-free depth. ' +
      'Here the 3D-strength slider sets the viewing angle.');
    return;
  }

  S.rigOK = inline3dViewRigSupported();
  S.modesOK = inline3dDisplayModesSupported();
  viewer.useEyeCamera(EyeCamera);
  // A cursor that rises to bars which come out of the glass instead of being drawn behind them.
  viewer.useDepthCursor(DepthCursor, () => raycastHitTest(THREE, [barGroup, floor]));

  // Rule 4: the backing store is already 2:1 (SceneViewer starts in 3D mode); give the compositor
  // two frames with the settled canvas before registering it.
  await nextFrame();
  await nextFrame();
  S.stereo = true;
  handle = wall.addScene(canvas, viewer.onFrame, {
    // A rig where supported; otherwise the scalar height (the same display rig at strength 1).
    ...(S.rigOK ? { viewRig: currentRig() } : { virtualDisplayHeight: VDH }),
    onLayerLost: () => {
      viewer.onLayerLost();
      S.stereo = false;
      cover.hidden = true;
      statusEl.textContent = '3D display connection lost — showing the 2D view.';
    },
  });

  const res = await handle.firstWoven;   // never rejects
  cover.hidden = true;                   // hard cut, never a fade
  S.growStart = performance.now();
  if (res.woven || S.stereo) {
    statusEl.innerHTML = '<b>Glasses-free 3D on.</b> Move your head to look around the bars; drag to tilt.' +
      (S.rigOK ? '' : ' (This browser cannot change the 3D strength; the slider has no effect.)');
  }
  if (!S.rigOK) slider.disabled = true;
})();
