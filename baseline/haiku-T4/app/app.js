// 3D bar chart: quarterly sales by region, woven on a DisplayXR display.
//
// One inline-3D session, one addScene canvas, on a DISPLAY rig. The chart is a subject the viewer
// looks at rather than a place they walk through, so the portal stays fixed at z = 0 and we turn
// the chart, not a camera. The title, legend, slider and button are ordinary DOM beside the
// canvas, never over it.

import * as THREE from 'three';
import {
  createInline3D,
  frameTrackingState,
  inline3dDisplayModesSupported,
  inline3dViewRigSupported,
  ViewerEase,
} from '@displayxr/inline3d';
import { EyeCamera, displayRig } from '@displayxr/inline3d/three';

// ---- data ----------------------------------------------------------------------------------------
const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];
// `row` is the depth row: +1 is nearest the viewer (out of the glass), -1 is furthest.
const REGIONS = [
  { name: 'North', values: [12, 15, 14, 18], color: '#4ea3d8', row: 1 },
  { name: 'South', values: [9, 11, 13, 12], color: '#e8833a', row: 0 },
  { name: 'West', values: [7, 10, 12, 16], color: '#7ee2a4', row: -1 },
];

// ---- scale and depth (metres, display-local) -----------------------------------------------------
// The scene is authored for a 24 cm tall virtual display (VDH). The runtime scales the eye poses
// to that display, so nothing here is scaled per frame. The chart uses about 70 % of the height.
const VDH = 0.24;
const MAX_VALUE = 18;
const CHART_H = 0.13;          // height of the tallest bar
const UNIT = CHART_H / MAX_VALUE;
const FLOOR_Y = -0.07;
const QUARTER_GAP = 0.036;     // x spacing between quarters
const ROW_GAP = 0.026;         // z spacing between regions: the depth the stereo actually reads
const BAR_W = 0.024;
const BAR_D = 0.018;
// The chart's z extent is roughly ±0.055 m, about a quarter of VDH, so the front and back halves
// of the chart balance around the glass. The turn separates the rows in depth; the sway makes that
// depth move slowly, so it reads even with the head still.
const BASE_TURN = THREE.MathUtils.degToRad(16);
const SWAY = THREE.MathUtils.degToRad(3);
const SWAY_RATE = 0.5;         // rad/s, a cycle of about 12 s
// The vertical field of view that frames exactly VDH at the nominal viewing distance (0.6 m).
// The flat preview uses it, so it matches what the display shows at z = 0.
const MONO_DISTANCE = 0.6;
const MONO_FOV = THREE.MathUtils.radToDeg(2 * Math.atan(VDH / 2 / MONO_DISTANCE));
const BG = 0x0b0c12;           // the page colour, so the canvas box is invisible on the page
// Largest backing-store side the device allows. Both axes are scaled by one factor to fit.
// Read from the GL context once the renderer exists.
let LIMIT = 4096;

const canvas = document.getElementById('chart');
const coverEl = document.getElementById('cover');
const depthEl = document.getElementById('depth');
const depthOut = document.getElementById('depthOut');
const modeBtn = document.getElementById('mode');
const statusEl = document.getElementById('status');
const legendEl = document.getElementById('legend');

// ---- renderer and scene --------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
// pixelRatio MUST be 1: layer.getViewport() reports backing-store pixels, and three multiplies
// setViewport/setScissor by the pixel ratio. We size the backing store in device px ourselves.
renderer.setPixelRatio(1);
renderer.autoClear = false;            // we clear once per frame, then draw the eye viewports
renderer.setClearColor(BG, 1);
{
  const gl = renderer.getContext();
  LIMIT = Math.min(
    gl.getParameter(gl.MAX_TEXTURE_SIZE),
    gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
    ...gl.getParameter(gl.MAX_VIEWPORT_DIMS),
  );
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(BG);
scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x161b2e, 1.0));
const key = new THREE.DirectionalLight(0xffffff, 1.2);
key.position.set(0.4, 1.0, 0.8);
scene.add(key);

// Everything below is authored in metres at z = 0 (the glass). +z is toward the viewer.
const rowZ = (region) => region.row * ROW_GAP;
const quarterX = (q) => (q - (QUARTERS.length - 1) / 2) * QUARTER_GAP;

const chart = new THREE.Group();
scene.add(chart);

// The plinth the bars stand on.
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(0.22, 0.1),
  new THREE.MeshStandardMaterial({ color: 0x161b2e, roughness: 1 }),
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = FLOOR_Y;
chart.add(floor);

// A text label drawn into a canvas texture on a billboard sprite. Text is part of the 3D image,
// so it is crisp only at the drawn resolution: 256×128, at roughly twice the on-panel size.
function textSprite(text, height, css = '#e6e9f5') {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 128;
  const g = cv.getContext('2d');
  g.font = '600 76px system-ui, -apple-system, "Segoe UI", sans-serif';
  g.fillStyle = css;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 66);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set(height * 2, height, 1);
  return sprite;
}

const barGeo = new THREE.BoxGeometry(BAR_W, 1, BAR_D);   // unit height; each bar scales its own
for (const region of REGIONS) {
  const mat = new THREE.MeshStandardMaterial({ color: region.color, roughness: 0.45, metalness: 0.05 });
  region.values.forEach((v, q) => {
    const h = v * UNIT;
    const bar = new THREE.Mesh(barGeo, mat);
    bar.scale.y = h;
    bar.position.set(quarterX(q), FLOOR_Y + h / 2, rowZ(region));
    chart.add(bar);

    const tag = textSprite(String(v), 0.018);
    tag.position.set(quarterX(q), FLOOR_Y + h + 0.014, rowZ(region));
    chart.add(tag);
  });
  const name = textSprite(region.name, 0.02, '#c9d0e6');
  name.position.set(-0.105, FLOOR_Y + 0.004, rowZ(region));
  chart.add(name);
}
// Quarter labels sit at the front edge of the plinth, which is the nearest thing in the chart.
// Keeping them there, and not further forward, is part of the depth budget.
QUARTERS.forEach((label, q) => {
  const s = textSprite(label, 0.018, '#c9d0e6');
  s.position.set(quarterX(q), FLOOR_Y - 0.016, 0.05);
  chart.add(s);
});

// ---- legend and accessible name (DOM, not the canvas) --------------------------------------------
for (const region of REGIONS) {
  const total = region.values.reduce((a, b) => a + b, 0);
  const li = document.createElement('li');
  const sw = document.createElement('span');
  sw.className = 'swatch';
  sw.style.background = region.color;
  const name = document.createTextNode(region.name);
  const tot = document.createElement('span');
  tot.className = 'total';
  tot.textContent = `· ${total}`;
  li.append(sw, name, ' ', tot);
  legendEl.appendChild(li);
}
canvas.setAttribute(
  'aria-label',
  '3D bar chart of quarterly sales, in millions. ' +
    REGIONS.map((r) => `${r.name}: ${r.values.join(', ')}`).join('. ') + '.',
);

// ---- cameras -------------------------------------------------------------------------------------
// The flat preview (and the mode before any eye pose arrives) looks down the z axis at the chart.
const monoCam = new THREE.PerspectiveCamera(MONO_FOV, 16 / 9, 0.01, 10);
monoCam.position.set(0, 0, MONO_DISTANCE);
monoCam.lookAt(0, 0, 0);

// Eye cameras, driven by the session's views through EyeCamera.setFromMatrices.
const eyes = [new EyeCamera(THREE), new EyeCamera(THREE)];
// Copies of each eye's matrices. The XRView is only valid inside its frame callback, so the last
// good pair lives here, and a short or null frame is replayed from it (never skipped).
const eyeCopies = [
  { proj: new Float64Array(16), pose: new Float64Array(16) },
  { proj: new Float64Array(16), pose: new Float64Array(16) },
];
let haveEyes = false;
// The SDK's tracking ease: when the viewer is acquired or lost, the eyes glide instead of snapping.
const ease = new ViewerEase();

// ---- backing store ------------------------------------------------------------------------------
// While woven the buffer is side by side: 2 × the eye width, at the CSS box's aspect ratio. The
// browser squeezes that pair into the box, and the weave un-squeezes it. Flat, it is 1:1.
let sbs = false;
function sizeBuffer() {
  const cssW = canvas.clientWidth || 720;
  const cssH = canvas.clientHeight || 405;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  monoCam.aspect = cssW / cssH;
  monoCam.updateProjectionMatrix();
  let w = Math.round(cssW * dpr);
  let h = Math.round(cssH * dpr);
  if (sbs) w *= 2;
  // One factor for both axes, so the clamped buffer keeps its shape.
  const k = Math.min(1, LIMIT / w, LIMIT / h);
  w = Math.max(1, Math.round(w * k));
  h = Math.max(1, Math.round(h * k));
  if (w === canvas.width && h === canvas.height) return false;
  renderer.setSize(w, h, false);   // updateStyle false: the page's CSS owns the box
  return true;
}

// The two eye viewports, split evenly. Used when no fresh pair arrives.
function halves() {
  const hw = canvas.width / 2;
  return [
    { x: 0, y: 0, width: hw, height: canvas.height },
    { x: hw, y: 0, width: hw, height: canvas.height },
  ];
}

function validViewports(views, layer) {
  if (!views || views.length < 2 || !layer) return null;
  const a = layer.getViewport(views[0]);
  const b = layer.getViewport(views[1]);
  if (!a || !b || a.width <= 0 || b.width <= 0) return null;
  return [a, b];
}

function drawPair(vps, cams) {
  renderer.clear();
  renderer.setScissorTest(true);
  for (let i = 0; i < 2; i++) {
    const vp = vps[i];
    renderer.setViewport(vp.x, vp.y, vp.width, vp.height);
    renderer.setScissor(vp.x, vp.y, vp.width, vp.height);
    renderer.render(scene, cams[i]);
  }
  renderer.setScissorTest(false);
}

// Draw one complete frame. With no fresh pair, replay the last good eyes, or the mono camera in
// both halves if none has ever arrived. Either way the buffer is never left blank.
function paint(vps) {
  const cams = haveEyes
    ? [eyes[0].setFromMatrices(eyeCopies[0].proj, eyeCopies[0].pose),
       eyes[1].setFromMatrices(eyeCopies[1].proj, eyeCopies[1].pose)]
    : [monoCam, monoCam];
  drawPair(vps || halves(), cams);
}

// ---- pose: what the chart does, separate from the stereo --------------------------------------
const S = { mode: '3d', strength: 1 };
let woven = false;
let hwFlat = false;        // the panel was put flat by setStereoEnabled(false) and not restored
let fallbackFlat = false;  // the page flattened the rig itself because the panel did not switch
let tracking = 'unknown';

// How much of the chart's depth is turned on. 2D is flat. Woven 3D turns it fully, and the
// stereo strength (the slider) is applied to the eye separation. In a flat preview there is no
// stereo, so the slider drives the turn instead, which keeps the depth cue responding.
function poseAmount() {
  if (S.mode === '2d') return 0;
  return woven ? 1 : S.strength;
}
function updatePose(seconds) {
  chart.rotation.y = poseAmount() * (BASE_TURN + SWAY * Math.sin(seconds * SWAY_RATE));
}

// ---- view rig ------------------------------------------------------------------------------------
// A display rig. ipdFactor is relative on this rig: 1 is the natural eye separation, and the
// slider lowers it. While a flat mode is active the SDK zeroes the rig itself, so the page only
// writes 0 when the panel could not be put flat and the page has to flatten the eyes.
let handle = null;
const rigScratch = {};
function pushRig() {
  if (!handle || !inline3dViewRigSupported()) return;
  handle.setViewRig(displayRig({
    virtualDisplayHeight: VDH,
    ipdFactor: fallbackFlat ? 0 : S.strength,
    out: rigScratch,
  }));
}

// ---- frame callbacks -----------------------------------------------------------------------------
function onFrame(views, layer, frame) {
  updatePose(performance.now() / 1000);
  const vps = validViewports(views, layer);
  if (vps) {
    for (let i = 0; i < 2; i++) {
      eyeCopies[i].proj.set(views[i].projectionMatrix);
      eyeCopies[i].pose.set(views[i].transform.matrix);
    }
    ease.apply(eyeCopies, frameTrackingState(frame));
    haveEyes = true;
  }
  paint(vps);
}

// Flat preview: one centred camera on the chart, redrawn every animation frame.
let monoRunning = false;
function startMonoLoop() {
  if (monoRunning) return;
  monoRunning = true;
  requestAnimationFrame(monoFrame);
}
function monoFrame(now) {
  requestAnimationFrame(monoFrame);
  sizeBuffer();
  updatePose(now / 1000);
  renderer.clear();
  renderer.setViewport(0, 0, canvas.width, canvas.height);
  renderer.render(scene, monoCam);
}

// The window will not weave (the layer was lost). Take it flat at 1:1 rather than leave a squeezed
// pair on screen.
function goFlat() {
  woven = false;
  sbs = false;
  sizeBuffer();
  startMonoLoop();
  updateStatus();
}

// ---- status --------------------------------------------------------------------------------------
let wall = null;
function updateStatus() {
  let text;
  if (!wall) text = 'Starting…';
  else if (!wall.supported) text = 'Flat preview. Open this page in the DisplayXR Browser on a DisplayXR display to see the chart in 3D.';
  else if (!woven) text = 'Flat preview. The 3D layer stopped, so the chart is shown without depth.';
  else if (S.mode === '2d') text = '2D view. The panel is flat, so the text stays sharp.';
  else if (tracking === 'searching') text = 'Step into view of the display to see the chart in 3D.';
  else text = '3D on. Move your head to look around the chart.';
  statusEl.textContent = text;
}

// ---- controls ------------------------------------------------------------------------------------
depthEl.addEventListener('input', () => {
  S.strength = depthEl.value / 100;
  depthOut.textContent = `${depthEl.value}%`;
  pushRig();
});

modeBtn.addEventListener('click', () => setMode(S.mode === '3d' ? '2d' : '3d'));

async function setMode(next) {
  S.mode = next;
  ease.reset();   // the view count changes here, so the ease must not carry the old frame over
  modeBtn.textContent = next === '3d' ? 'Switch to 2D' : 'Switch to 3D';
  updateStatus();
  if (!woven) return;   // the flat preview: the pose change above is the whole switch

  const to3d = next === '3d';
  modeBtn.disabled = true;
  try {
    if (!inline3dDisplayModesSupported()) throw new Error('no display-mode API');
    // The SDK ramps the disparity out before the panel flips, and back in only after the panel
    // reports 3D. The rig collapse follows the panel too.
    await wall.setStereoEnabled(to3d);
    hwFlat = !to3d;
    fallbackFlat = false;
  } catch (e) {
    // The panel did not switch. Flatten the eyes ourselves while the panel is still flat, so the
    // two halves match (the lens alone would show the pair flat, a double image).
    fallbackFlat = !to3d || hwFlat;
  } finally {
    modeBtn.disabled = false;
  }
  pushRig();
}

// ---- boot ----------------------------------------------------------------------------------------
(async () => {
  updateStatus();
  // lazy: false, because this page has one always-on 3D element. autoChrome: false, because the
  // page has no sticky chrome for the SDK to scan for.
  wall = await createInline3D({ lazy: false, autoChrome: false });
  if (!wall.supported) {
    coverEl.hidden = true;
    startMonoLoop();
    updateStatus();
    return;
  }

  woven = true;
  sbs = true;
  sizeBuffer();   // size the backing store before registering it (woven-canvas rule 4)
  handle = wall.addScene(canvas, onFrame, {
    virtualDisplayHeight: VDH,    // the same display the rig below describes, for browsers without rigs
    bufferClamped: true,          // this page clamps its own buffer above
    rectCover: 'auto',            // the SDK covers a rect change until the weave rejoins
    onResize: () => { if (sizeBuffer()) paint(null); },
    onLayerLost: goFlat,
  });
  // Hold the cover until the browser reports the canvas woven, then cut it (woven-canvas rule 5).
  handle.firstWoven.then(() => { coverEl.hidden = true; });
  wall.on('trackingstatechange', (state) => { tracking = state; updateStatus(); });
  tracking = wall.trackingState;
  pushRig();
  updateStatus();
})();
