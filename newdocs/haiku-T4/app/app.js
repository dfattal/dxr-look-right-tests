// Quarterly sales by region — a 3D bar chart on a DISPLAY rig, framed by SceneViewer. Built from
// starter-ui; the rules are in sdk/docs/making-3d-look-right.md. Settings and reasons: NOTES.md.
//
// RIG (guide §1): a chart is an object you look at, so a display rig. The canvas is a portal onto
// a virtual display VDH metres tall; SceneViewer scales the chart into it.
// SCREEN PLANE (§2): the chart's centre sits on the glass, nudged back (depthOffset) so the
// comfortable "behind" budget is used too. The West row is the nearest and comes just out of it.
// DEPTH (§3): depthFit to the comfortable 16:9 column, 0.1 h in front and 0.27 h behind.
// 2D UI (§4, §6): title, caption, legend and controls are HTML outside the tile. The 3D labels
// are sprites inside the scene, so they sit at the glass and share its perspective.

import * as THREE from 'three';
import { createInline3D } from '@displayxr/inline3d';
import { EyeCamera, displayRig } from '@displayxr/inline3d/three';
import { SceneViewer } from '@displayxr/inline3d/viewer';

const canvas = document.getElementById('chart');
const cover = document.getElementById('cover');
const depth = document.getElementById('depth');
const modeBtn = document.getElementById('mode');
const modeNote = document.getElementById('modeNote');
const legend = document.getElementById('legend');

const VDH = 0.24;                      // virtual display height, metres — the SAME on addScene
const FRONT = 0.1, BACK = 0.27;        // depth budget, tile heights (16:9 tile)
const BG = '#f3f4f6';                  // == the page colour behind the tile (index.html)

// The data: sales in millions, one row per region, one column per quarter.
const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];
const SERIES = [
  { name: 'North', color: '#3b6fd8', values: [12, 15, 14, 18] },
  { name: 'South', color: '#e0803a', values: [9, 11, 13, 12] },
  { name: 'West', color: '#3fa66b', values: [7, 10, 12, 16] },
];

// Layout, in chart units (one bar is BAR_W wide). UNIT: world units per million.
const UNIT = 0.1;
const BAR_W = 0.8, BAR_D = 0.7, COL_GAP = 1.3, ROW_GAP = 1.1;
const COLS = QUARTERS.length, ROWS = SERIES.length;
const colX = (c) => (c - (COLS - 1) / 2) * COL_GAP;
const rowZ = (r) => (r - (ROWS - 1) / 2) * ROW_GAP;   // +z is toward the viewer

const viewer = new SceneViewer(THREE, canvas, {
  virtualDisplayHeight: VDH,
  clearColor: BG,                      // OPAQUE clear
  depthFit: { front: FRONT, back: BACK },
  fitSweep: false,                     // no turntable: budget the chart's real depth
  orbit: false,                        // a fixed view keeps the labels and legend true
}).useEyeCamera(EyeCamera);

// ---- the chart --------------------------------------------------------------------------------
let seed = 11;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
function speckle(base, contrast = 0.18) {   // a fine irregular grain: stereo matching needs detail
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

// A label as a camera-facing sprite. It is drawn at 128 px per world unit of height, so it stays
// sharp at the glass. Transparent background: the scene's opaque clear shows through it.
function textSprite(text, worldH, { color = '#1d2230', weight = 600 } = {}) {
  const PX = 128;
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const font = `${weight} ${Math.round(PX * 0.7)}px system-ui, -apple-system, Segoe UI, sans-serif`;
  g.font = font;
  const w = Math.ceil(g.measureText(text).width) + 16;
  c.width = w;                         // resizing the canvas resets its state, so set the font after
  c.height = PX;
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = color;
  g.fillText(text, w / 2, PX / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set((worldH * w) / PX, worldH, 1);
  return sprite;
}

const chart = new THREE.Group();

// The base plate: sits on y = 0, with a margin around the bars.
const baseW = (COLS - 1) * COL_GAP + BAR_W + 0.6;
const baseD = (ROWS - 1) * ROW_GAP + BAR_D + 0.6;
const base = new THREE.Mesh(new THREE.BoxGeometry(baseW, 0.12, baseD), speckle('#c8ccd4'));
base.position.y = -0.06;
chart.add(base);

SERIES.forEach((s, row) => {
  const mat = speckle(s.color);
  s.values.forEach((v, col) => {
    const h = v * UNIT;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(BAR_W, h, BAR_D), mat);
    bar.position.set(colX(col), h / 2, rowZ(row));
    chart.add(bar);
    // The value, floating just above each bar.
    const val = textSprite(String(v), 0.26);
    val.position.set(colX(col), h + 0.16, rowZ(row));
    chart.add(val);
  });
});

// The quarter names along the front edge of the base, in the chart's own perspective.
const frontZ = rowZ(ROWS - 1) + BAR_D / 2 + 0.3;
QUARTERS.forEach((q, col) => {
  const label = textSprite(q, 0.28, { weight: 700 });
  label.position.set(colX(col), 0.2, frontZ);
  chart.add(label);
});

chart.rotation.set(THREE.MathUtils.degToRad(14), THREE.MathUtils.degToRad(-20), 0); // 3/4 view from above
viewer.content.add(chart);
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(-2, 4, 3);
viewer.scene.add(sun, new THREE.HemisphereLight(0xffffff, 0x8890a0, 1.2));

// Frame on the box the chart occupies after the turn, so depthFit sees its true depth. Centre it
// about 0.085 tile heights behind the glass: the budget's larger "behind" share is then used too.
viewer.depthOffset = -((BACK - FRONT) / 2) * VDH;
const box = new THREE.Box3().setFromObject(viewer.content);
viewer.fitTo(box.getCenter(new THREE.Vector3()), box.getSize(new THREE.Vector3()));

// ---- the legend (HTML, outside the tile) ------------------------------------------------------
for (const s of SERIES) {
  const total = s.values.reduce((a, b) => a + b, 0);
  const li = document.createElement('li');
  const swatch = document.createElement('i');
  swatch.style.background = s.color;
  const name = document.createElement('span');
  name.textContent = s.name;
  const sum = document.createElement('span');
  sum.className = 'total';
  sum.textContent = `${total} total`;
  li.append(swatch, name, sum);
  legend.append(li);
}

// ---- boot --------------------------------------------------------------------------------------
const wall = await createInline3D({ lazy: false });
if (!wall.supported) {
  // An ordinary browser: the same page, flat. Same layout; the 3D controls rest, and say why.
  viewer.startMono();
  cover.remove();
  depth.disabled = modeBtn.disabled = true;
  modeBtn.textContent = 'Show in 2D';
  modeNote.textContent = 'Open this page in the DisplayXR Browser on a 3D display to see it in 3D.';
} else {
  const rig = (k) => displayRig({ virtualDisplayHeight: VDH, ipdFactor: k, parallaxFactor: k });
  const handle = wall.addScene(canvas, viewer.onFrame, { viewRig: rig(1), onLayerLost: viewer.onLayerLost });
  wall.session.updateRenderState({ depthNear: 0.01, depthFar: 20 });

  // Depth slider: ONE value k moves BOTH factors. On a display rig 1 is what the display does
  // naturally; below 1 only makes the picture shallower.
  depth.addEventListener('input', () => handle.setViewRig(rig(Number(depth.value))));

  // 2D/3D switch. The label follows what the display REPORTS (renderingmodechange), not the click.
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
      // No flat mode on this display (nothing changed): the depth slider at 0 is flat anywhere.
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
