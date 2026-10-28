// Quarterly sales by region — a 3D bar chart for a glasses-free spatial display.
// Built on the SDK's starter-ui template (docs/making-3d-look-right.md).
//
// RIG (guide §1): a chart is an object the viewer LOOKS AT → a DISPLAY rig, framed by SceneViewer,
// each eye drawn from its own view with EyeCamera.
// SCREEN PLANE (§2): through the chart (SceneViewer centres it on the glass), nudged back with
// depthOffset so the larger "behind" half of the budget is used too.
// DEPTH (§3): depthFit to the comfortable column for a 16:9 tile: nearest point ≤ 0.1 tile heights
// in front of the glass (≈ 0.6 % of width), farthest ≤ 0.27 h behind (≈ 1.5 %). The fit is done on
// the box of the chart AFTER its 3/4 turn, so it sees the real depth.
// 2D UI (§4, §6): title, legend, data table and controls are HTML OUTSIDE the tile; the one label
// over it (top-left) sits over the back wall / background, which is behind the glass.

import * as THREE from 'three';
import { createInline3D } from '@displayxr/inline3d';
import { EyeCamera, displayRig } from '@displayxr/inline3d/three';
import { SceneViewer } from '@displayxr/inline3d/viewer';

const canvas = document.getElementById('chart');
const cover = document.getElementById('cover');
const depth = document.getElementById('depth');
const depthVal = document.getElementById('depthVal');
const modeBtn = document.getElementById('mode');
const modeNote = document.getElementById('modeNote');

const VDH = 0.24;                      // virtual display height, metres — the SAME on the rig
const FRONT = 0.1, BACK = 0.27;        // depth budget, tile heights (16:9 tile, comfortable column)
const BG = '#f3f4f6';                  // == the page colour behind the tile (index.html)

// Rows listed BACK → FRONT: the tallest series at the back so it never hides a shorter one.
const QUARTERS = 4;
const SERIES = [
  { name: 'North', color: '#3b6fd8', values: [12, 15, 14, 18] },
  { name: 'West',  color: '#3fa66b', values: [7, 10, 12, 16] },
  { name: 'South', color: '#e0803a', values: [9, 11, 13, 12] },
];
const UNIT = 0.3;                      // chart units per $1M (bar width = 1 chart unit)
const GRID_MAX = 20, GRID_STEP = 5;    // $M

const viewer = new SceneViewer(THREE, canvas, {
  virtualDisplayHeight: VDH,
  clearColor: BG,                      // OPAQUE clear: alpha-0 pixels weave as stale/black
  depthFit: { front: FRONT, back: BACK },
  fitSweep: false,                     // nothing spins the chart: budget its real depth
  orbit: false,                        // a fixed view keeps the legend true and the fit valid;
                                       // head tracking still lets the viewer look around the bars
  // no `feather`: it fades to transparent, which needs an alpha clear (guide §5)
}).useEyeCamera(EyeCamera);

// ---- the chart -----------------------------------------------------------------------------------
let seed = 11;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
// A fine, low-contrast grain: flat untextured faces give the eyes nothing to fuse on.
function speckle(base, contrast = 0.16, roughness = 0.7) {
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
  return new THREE.MeshStandardMaterial({ map: t, roughness });
}

const COL_PITCH = 1.4, ROW_PITCH = 1.15, BAR_W = 1, BAR_D = 0.8;
const width = QUARTERS * COL_PITCH + 0.3;
const deep = SERIES.length * ROW_PITCH + 0.3;
const chart = new THREE.Group();

const base = new THREE.Mesh(new THREE.BoxGeometry(width, 0.15, deep), speckle('#c8ccd4'));
base.position.y = -0.075;
chart.add(base);

// A back wall with soft value gridlines: gives the bars a scale and the scene a plane behind them.
// Mid-grey on light grey (not black on white): sharp high-contrast edges off the glass ghost first.
const wallH = GRID_MAX * UNIT + 0.2;
const wall = new THREE.Mesh(new THREE.BoxGeometry(width, wallH, 0.08), speckle('#e1e4ea', 0.08, 0.9));
wall.position.set(0, wallH / 2 - 0.15, -deep / 2 - 0.04);
chart.add(wall);
const gridMat = new THREE.MeshStandardMaterial({ color: '#a3aab8', roughness: 0.9 });
for (let v = GRID_STEP; v <= GRID_MAX; v += GRID_STEP) {
  const line = new THREE.Mesh(new THREE.BoxGeometry(width - 0.1, 0.035, 0.01), gridMat);
  line.position.set(0, v * UNIT, -deep / 2 + 0.005);
  chart.add(line);
}

SERIES.forEach((s, row) => {
  const m = speckle(s.color);
  s.values.forEach((v, col) => {
    const h = v * UNIT;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(BAR_W, h, BAR_D), m);
    bar.position.set((col - (QUARTERS - 1) / 2) * COL_PITCH, h / 2, (row - (SERIES.length - 1) / 2) * ROW_PITCH);
    chart.add(bar);
  });
});

chart.rotation.set(THREE.MathUtils.degToRad(14), THREE.MathUtils.degToRad(-20), 0); // 3/4 view from a little above
viewer.content.add(chart);
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(-2, 4, 3);
viewer.scene.add(sun, new THREE.HemisphereLight(0xffffff, 0x8890a0, 1.2));

// Fit on the box the chart really occupies after the turn, so depthFit sees its true depth, and
// centre it (BACK − FRONT)/2 = 0.085 h behind the glass so both ends can reach their budget.
viewer.depthOffset = -((BACK - FRONT) / 2) * VDH;
const box = new THREE.Box3().setFromObject(viewer.content);
viewer.fitTo(box.getCenter(new THREE.Vector3()), box.getSize(new THREE.Vector3()));

// ---- boot ------------------------------------------------------------------------------------------
const wallSession = await createInline3D({ lazy: false });
if (!wallSession.supported) {
  // An ordinary browser: the same page, flat. Same layout; the 3D controls rest, and say why.
  viewer.startMono();
  cover.remove();
  depth.disabled = modeBtn.disabled = true;
  modeBtn.textContent = '2D';
  modeNote.textContent = 'Open this page in the DisplayXR Browser on a 3D display to see it in 3D.';
} else {
  const rig = (k) => displayRig({ virtualDisplayHeight: VDH, ipdFactor: k, parallaxFactor: k });
  const handle = wallSession.addScene(canvas, viewer.onFrame, {
    viewRig: rig(1),
    onLayerLost: viewer.onLayerLost,   // the session ended: go flat, never raw side-by-side
  });
  wallSession.session.updateRenderState({ depthNear: 0.01, depthFar: 20 });

  // Depth strength: ONE value k drives BOTH ipdFactor and parallaxFactor (stereo and look-around
  // shrink together). On a display rig 1 is the display's natural depth; the slider can only make
  // it shallower, never push it past the budget. Changes are eased (critically damped, ~0.25 s)
  // so the scene never jumps in depth.
  let flat = false;                    // what the display reports (or our fallback)
  let fallbackFlat = false;            // no 1-view mode on this display: flat = k forced to 0
  let k = 1;
  const target = () => (fallbackFlat ? 0 : Number(depth.value));
  let last = performance.now();
  viewer.onTick = () => {
    const now = performance.now(), dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    const t = target();
    if (k === t) return;
    k = Math.abs(t - k) < 0.002 ? t : t + (k - t) * Math.exp(-dt / 0.08);
    handle.setViewRig(rig(k));
  };

  const showDepth = () => { depthVal.textContent = `${Math.round(Number(depth.value) * 100)}%`; };
  depth.addEventListener('input', showDepth);

  // 2D/3D switch. The label follows what the display REPORTS (renderingmodechange), not the click.
  const show = () => {
    modeBtn.textContent = flat ? 'Show in 3D' : 'Show in 2D';
    modeBtn.setAttribute('aria-pressed', String(flat));
    depth.disabled = flat;             // the slider has no visible effect while flat
    modeNote.textContent = flat ? 'Showing a flat 2D view.' : '';
  };
  handle.on('renderingmodechange', (e) => {
    if (e.viewCount) { flat = e.viewCount === 1; if (!flat) fallbackFlat = false; show(); }
  });
  modeBtn.addEventListener('click', () => {
    if (fallbackFlat) { fallbackFlat = false; flat = false; show(); return; }
    handle.setStereoEnabled(flat).catch(() => {
      // No flat mode on this display (nothing changed): depth 0 gives a flat image anywhere.
      // The slider's own value is kept, so returning to 3D restores the viewer's chosen strength.
      fallbackFlat = flat = !flat;
      show();
    });
  });
  show();
  showDepth();
  await handle.firstWoven;             // cover until the first woven frame
  cover.remove();                      // cut, never fade
}
