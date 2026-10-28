// 3D bar chart of quarterly sales by region. Adapted from the SDK's samples/starter-ui.
//
// RIG (guide §1): a chart is an object you look at -> DISPLAY rig, framed by SceneViewer.
// SCREEN PLANE (§2): through the chart, nudged back with depthOffset to use the "behind" budget.
// DEPTH (§3): depthFit to the comfortable column, 0.1 h in front / 0.27 h behind on a 16:9 tile
// (~0.6 % / 1.5 % of the width). fitSweep:false and orbit:false because nothing turns the chart.
// UI (§4, §6): title, legend and controls are HTML outside the tile; the one label over it sits
// over empty background. Plain rgba() only.

import * as THREE from 'three';
import { createInline3D } from '@displayxr/inline3d';
import { EyeCamera, displayRig } from '@displayxr/inline3d/three';
import { SceneViewer } from '@displayxr/inline3d/viewer';

const canvas = document.getElementById('chart');
const cover = document.getElementById('cover');
const depth = document.getElementById('depth');
const modeBtn = document.getElementById('mode');
const modeNote = document.getElementById('modeNote');

const VDH = 0.24;                      // virtual display height, metres — the SAME on addScene
const FRONT = 0.1, BACK = 0.27;        // depth budget, tile heights (16:9)
const BG = '#f3f4f6';                  // == the page colour behind the tile

const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];
const SERIES = [                       // rows, back to front (North at the back)
  { name: 'North', color: '#3b6fd8', values: [12, 15, 14, 18] },
  { name: 'South', color: '#e0803a', values: [9, 11, 13, 12] },
  { name: 'West',  color: '#3fa66b', values: [7, 10, 12, 16] },
];

const viewer = new SceneViewer(THREE, canvas, {
  virtualDisplayHeight: VDH,
  clearColor: BG,                      // OPAQUE clear
  depthFit: { front: FRONT, back: BACK },
  fitSweep: false,
  orbit: false,
}).useEyeCamera(EyeCamera);

let seed = 11;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
function speckle(base, contrast = 0.18) {   // fine grain: stereo matching needs detail
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 400; i++) {
    g.fillStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,255,255'},${rnd() * contrast})`;
    g.fillRect(rnd() * 64, rnd() * 64, 1 + rnd() * 3, 1 + rnd() * 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.7 });
}
function labelMesh(text, w, h) {       // flat text lying on the base (at the base's depth)
  const c = document.createElement('canvas');
  c.width = 256; c.height = Math.round(256 * h / w);
  const g = c.getContext('2d');
  g.fillStyle = '#c8ccd4';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#2a3040';
  g.font = `bold ${Math.round(c.height * 0.7)}px system-ui, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, c.width / 2, c.height / 2 + 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t }));
  m.rotation.x = -Math.PI / 2;
  return m;
}

// Chart units: one bar = 1 wide, 1 unit of height = $1M (linear).
const chart = new THREE.Group();
const COLS = QUARTERS.length, ROWS = SERIES.length;
const PITCH_X = 1.4, PITCH_Z = 1.1, LABEL_STRIP = 0.7;
const baseW = COLS * PITCH_X + 0.3, baseD = ROWS * PITCH_Z + 0.3 + LABEL_STRIP;
const zShift = -LABEL_STRIP / 2;       // bars toward the back; label strip at the front
const base = new THREE.Mesh(new THREE.BoxGeometry(baseW, 0.15, baseD), speckle('#c8ccd4'));
base.position.y = -0.075;
chart.add(base);
SERIES.forEach((s, row) => {
  const m = speckle(s.color);
  s.values.forEach((v, col) => {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1, v, 0.8), m);
    bar.position.set((col - (COLS - 1) / 2) * PITCH_X, v / 2, (row - (ROWS - 1) / 2) * PITCH_Z + zShift);
    chart.add(bar);
  });
});
QUARTERS.forEach((q, col) => {
  const l = labelMesh(q, 0.9, 0.5);
  l.position.set((col - (COLS - 1) / 2) * PITCH_X, 0.01, baseD / 2 - LABEL_STRIP / 2 - 0.05);
  chart.add(l);
});
chart.rotation.set(THREE.MathUtils.degToRad(14), THREE.MathUtils.degToRad(-20), 0); // 3/4 view from above
viewer.content.add(chart);
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(-2, 4, 3);
viewer.scene.add(sun, new THREE.HemisphereLight(0xffffff, 0x8890a0, 1.2));

// Frame on the box the chart really occupies after the turn, so depthFit sees its true depth.
viewer.depthOffset = -((BACK - FRONT) / 2) * VDH;
const box = new THREE.Box3().setFromObject(viewer.content);
viewer.fitTo(box.getCenter(new THREE.Vector3()), box.getSize(new THREE.Vector3()));

// ---- boot ----------------------------------------------------------------------------------
const wall = await createInline3D({ lazy: false });
if (!wall.supported) {
  // Ordinary browser: same page, flat. Controls rest and say why.
  viewer.startMono();
  cover.remove();
  depth.disabled = modeBtn.disabled = true;
  modeBtn.textContent = '2D';
  modeNote.textContent = 'Open this page in the DisplayXR Browser on a 3D display to see it in 3D.';
} else {
  const rig = (k) => displayRig({ virtualDisplayHeight: VDH, ipdFactor: k, parallaxFactor: k });
  const handle = wall.addScene(canvas, viewer.onFrame, { viewRig: rig(1), onLayerLost: viewer.onLayerLost });
  wall.session.updateRenderState({ depthNear: 0.01, depthFar: 20 });

  // One slider value k moves BOTH ipdFactor and parallaxFactor. 1 = natural; below only shallower.
  depth.addEventListener('input', () => handle.setViewRig(rig(Number(depth.value))));

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
      // No flat mode on this display: depth 0 is flat anywhere.
      flat = !flat;
      depth.value = flat ? 0 : 1;
      handle.setViewRig(rig(Number(depth.value)));
      show();
    });
  });
  show();
  await handle.firstWoven;             // cover until the first woven frame
  cover.remove();                      // cut, never fade
}
