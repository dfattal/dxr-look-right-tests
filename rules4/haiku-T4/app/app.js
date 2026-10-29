// Quarterly sales by region — a 3D bar chart on the DisplayXR inline-3D SDK.
//
// One woven canvas, mounted for the life of the page (woven-canvas rules 1-3). It is an addScene
// window on a DISPLAY rig: the canvas is a portal onto a 0.24 m virtual display, and the chart is
// authored in metres for that display and centred on the glass (z = 0). Where the browser has no
// inline-3D session the same canvas runs a plain mono loop.

import * as THREE from 'three';
import { createInline3D, inline3dViewRigSupported, inline3dDisplayModesSupported } from '@displayxr/inline3d';
import { EyeCamera, displayRig } from '@displayxr/inline3d/three';

// ---- data ----------------------------------------------------------------------------------
const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];
const REGIONS = [
  { name: 'North', color: 0x4ea3d8, values: [12, 15, 14, 18] },
  { name: 'South', color: 0x7ee2a4, values: [9, 11, 13, 12] },
  { name: 'West', color: 0xf0a35e, values: [7, 10, 12, 16] },
];

// ---- layout, in metres for the virtual display ---------------------------------------------
// The display rig maps this scene onto a 0.24 m tall display centred on z = 0. Everything below
// is sized to sit inside that display, and the depth spread is kept small (see NOTES.md).
const VIRTUAL_DISPLAY_HEIGHT = 0.24;  // addScene's default, written out so the layout is explicit
const VIEW_DISTANCE = 0.6;            // the runtime's nominal viewer distance; +z is out of the glass
const BG = 0x1f2229;                  // opaque dark grey: a transparent canvas weaves black
const BASE_Y = -0.08;                 // the bars stand on this line; the chart spans about -0.08..+0.08
const METRES_PER_MILLION = 0.009;     // 18 million -> 0.162 m tall
const QUARTER_PITCH = 0.08;           // 3D: x distance between quarters
const ROW_DEPTH = 0.06;               // 3D: z distance between regions, +/-6 cm around the glass
const BAR_W = 0.046;
const BAR_D = 0.036;
// 2D: the same bars laid out flat, side by side, so all three regions stay visible.
const FLAT_BAR_W = 0.024;
const FLAT_STEP = 0.026;              // x distance between the three bars of one quarter
const FLAT_PITCH = 0.108;             // x distance between quarter groups
const SWAY_RAD = THREE.MathUtils.degToRad(5);  // idle yaw in 3D only; it is what shows the depth
const SWAY_PERIOD_S = 14;
const COVER_MS = 6000;                // safety: the cover comes off even if firstWoven never settles

// ---- renderer and scene --------------------------------------------------------------------
const canvas = document.getElementById('chart');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  preserveDrawingBuffer: true,        // older DisplayXR builds race the weave's read of a large canvas
});
renderer.setPixelRatio(1);            // getViewport() reports device pixels; see applyBuffer()
renderer.autoClear = false;           // we clear once per frame, then draw each eye's viewport
renderer.setClearColor(BG, 1);

const scene = new THREE.Scene();
scene.background = new THREE.Color(BG);
scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x20242e, 1.0));
const sun = new THREE.DirectionalLight(0xffffff, 1.1);
sun.position.set(0.3, 0.6, 1.0);
scene.add(sun);

// The chart group is the thing that sways; everything in it is authored around the origin.
const chart = new THREE.Group();
scene.add(chart);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(0.4, 0.2),
  new THREE.MeshStandardMaterial({ color: 0x2a2f3b, roughness: 1 }),
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = BASE_Y - 0.001;    // a hair under the bar bases, so they do not z-fight
chart.add(floor);

// One mesh per (region, quarter). `r` is the region index (North = 0), `q` the quarter index.
const bars = [];
REGIONS.forEach((region, r) => {
  const material = new THREE.MeshStandardMaterial({ color: region.color, roughness: 0.55, metalness: 0 });
  region.values.forEach((value, q) => {
    const h = value * METRES_PER_MILLION;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(BAR_W, h, BAR_D), material);
    mesh.position.y = BASE_Y + h / 2;
    chart.add(mesh);
    bars.push({ mesh, q, r });
  });
});

// 3D: quarters along x, regions in depth. 2D: quarters along x, regions side by side.
function layoutBars(flat) {
  for (const { mesh, q, r } of bars) {
    if (flat) {
      mesh.position.x = (q - 1.5) * FLAT_PITCH + (r - 1) * FLAT_STEP;
      mesh.position.z = 0;
      mesh.scale.x = FLAT_BAR_W / BAR_W;
    } else {
      mesh.position.x = (q - 1.5) * QUARTER_PITCH;
      mesh.position.z = (1 - r) * ROW_DEPTH;   // North nearest the glass, West furthest back
      mesh.scale.x = 1;
    }
  }
}
layoutBars(false);

// ---- cameras -------------------------------------------------------------------------------
// Two eye cameras, driven by the session's views while the window is woven.
const eyeCams = [new EyeCamera(THREE), new EyeCamera(THREE)];
// Preview cameras for the mono path: a perspective view of the same 0.24 m display (so the chart
// frames the same way as on the panel), and a flat orthographic view for 2D.
const monoCam = new THREE.PerspectiveCamera(
  THREE.MathUtils.radToDeg(2 * Math.atan(VIRTUAL_DISPLAY_HEIGHT / 2 / VIEW_DISTANCE)), 16 / 9, 0.01, 5);
monoCam.position.set(0, 0, VIEW_DISTANCE);
monoCam.lookAt(0, 0, 0);
const flatCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 5);
flatCam.position.set(0, 0, VIEW_DISTANCE);
flatCam.lookAt(0, 0, 0);

// Copies of each eye's matrices from the last good frame. An XRView is valid only inside its own
// callback, so a frame that cannot draw both eyes replays these rather than skipping or going black.
const lastEyes = [0, 1].map(() => ({ ok: false, proj: new Float32Array(16), pose: new Float32Array(16) }));

// ---- state ---------------------------------------------------------------------------------
let wall = null;
let handle = null;
let sbsMode = false;     // the backing store is a side-by-side pair (one half per eye) while woven
let lost = false;        // the weave layer is gone for good: the chart is drawn flat, mono
let monoLoopOn = false;
let want3D = true;       // what the button asks for
let strength = 1;        // 0..1 from the slider: ipdFactor on the display rig
const rigScratch = {};   // reused descriptor, so a slider drag does not allocate

const legendEl = document.getElementById('legend');
const dataEl = document.getElementById('data');
const modeBtn = document.getElementById('mode');
const strengthEl = document.getElementById('strength');
const strengthOut = document.getElementById('strengthOut');
const statusEl = document.getElementById('status');
const cover = document.getElementById('cover');

const STATUS_3D = 'Weaving for the DisplayXR panel: move your head to look around the chart.';
const STATUS_2D_FALLBACK = 'Flat preview. Open this page in the DisplayXR Browser on a DisplayXR display for glasses-free 3D.';

const hex = (c) => '#' + c.toString(16).padStart(6, '0');
legendEl.innerHTML = REGIONS.map((r) =>
  `<li><span class="sw" style="background:${hex(r.color)}"></span>${r.name}</li>`).join('');
dataEl.innerHTML =
  `<caption>Values in millions</caption>` +
  `<thead><tr><th scope="col">Region</th>${QUARTERS.map((q) => `<th scope="col">${q}</th>`).join('')}</tr></thead>` +
  `<tbody>${REGIONS.map((r) =>
    `<tr><th scope="row"><span class="sw" style="background:${hex(r.color)};margin-right:8px;vertical-align:-1px"></span>${r.name}</th>` +
    r.values.map((v) => `<td>${v}</td>`).join('') + '</tr>').join('')}</tbody>`;

function setStatus(text) { statusEl.textContent = text; }
function hideCover() { cover.hidden = true; }
function renderModeButton() {
  modeBtn.textContent = want3D ? 'Switch to 2D' : 'Switch to 3D';
  modeBtn.setAttribute('aria-pressed', String(!want3D));
}
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

// ---- backing store -------------------------------------------------------------------------
// While woven, the buffer is two eyes side by side: each eye keeps the full CSS box at device
// resolution, so the buffer is 2:1 in the box's aspect (the weave un-squeezes it). Otherwise it is
// one image at the box's size. Both axes are scaled down if the GL limit would clamp the buffer;
// bufferClamped on addScene tells the SDK we did that ourselves.
function bufferSize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const eyeW = Math.max(1, Math.round((canvas.clientWidth || 640) * dpr));
  const h = Math.max(1, Math.round((canvas.clientHeight || 360) * dpr));
  const eyes = sbsMode ? 2 : 1;
  const max = renderer.capabilities.maxTextureSize;
  const s = Math.min(1, max / (eyeW * eyes), max / h);
  const ew = Math.floor(eyeW * s);
  return { w: ew * eyes, h: Math.floor(h * s), eyeW: ew };
}

// Returns true when the buffer actually changed. Writing canvas.width clears it, so only do it
// when the size differs. The preview cameras follow the same eye aspect.
function applyBuffer() {
  const { w, h, eyeW } = bufferSize();
  const changed = renderer.domElement.width !== w || renderer.domElement.height !== h;
  if (changed) renderer.setSize(w, h, false);
  const aspect = eyeW / h;
  monoCam.aspect = aspect;
  monoCam.updateProjectionMatrix();
  const halfH = VIRTUAL_DISPLAY_HEIGHT / 2;
  flatCam.left = -halfH * aspect;
  flatCam.right = halfH * aspect;
  flatCam.top = halfH;
  flatCam.bottom = -halfH;
  flatCam.updateProjectionMatrix();
  return changed;
}

// The rectangle each eye draws into. layer.getViewport() splits canvas.width in half, so this
// matches it; it is used when there is no fresh view to read a viewport from.
function eyeRects() {
  const w = renderer.domElement.width;
  const h = renderer.domElement.height;
  if (!sbsMode) return [{ x: 0, y: 0, width: w, height: h }];
  const half = w / 2;
  return [
    { x: 0, y: 0, width: half, height: h },
    { x: half, y: 0, width: half, height: h },
  ];
}

// ---- drawing -------------------------------------------------------------------------------
// Validate before clearing: renderer.clear() is the point of no return. A stereo frame draws each
// eye's viewport from its copied matrices; anything else draws the preview camera into every rect.
function drawFrame(rects, stereo) {
  renderer.clear();
  renderer.setScissorTest(true);
  rects.forEach((vp, i) => {
    renderer.setViewport(vp.x, vp.y, vp.width, vp.height);
    renderer.setScissor(vp.x, vp.y, vp.width, vp.height);
    if (stereo) {
      eyeCams[i].setFromMatrices(lastEyes[i].proj, lastEyes[i].pose);
      renderer.render(scene, eyeCams[i].camera);
    } else {
      renderer.render(scene, want3D ? monoCam : flatCam);
    }
  });
  renderer.setScissorTest(false);
}

function sway(ms) {
  chart.rotation.y = want3D ? SWAY_RAD * Math.sin((ms / 1000) * (2 * Math.PI / SWAY_PERIOD_S)) : 0;
}

function storeEye(i, view) {
  lastEyes[i].proj.set(view.projectionMatrix);
  lastEyes[i].pose.set(view.transform.matrix);
  lastEyes[i].ok = true;
}

// Replay the last good frame. Stereo only once both eyes have been seen at least once.
function replayLastFrame() {
  sway(performance.now());
  drawFrame(eyeRects(), lastEyes.every((e) => e.ok));
}

// The per-frame callback from addScene. Called with two eye views while the window is woven.
function onXRFrame(views, layer) {
  const vps = views && views.length >= 2 && layer
    ? [layer.getViewport(views[0]), layer.getViewport(views[1])]
    : [null, null];
  const good = (vp) => !!vp && vp.width > 0 && vp.height > 0;
  if (good(vps[0]) && good(vps[1])) {
    storeEye(0, views[0]);
    storeEye(1, views[1]);
    sway(performance.now());
    drawFrame(vps, true);
  } else {
    replayLastFrame();
  }
}

// Fires inside the ResizeObserver callback when the CSS box changes. Resize and draw at once, so
// the old buffer is never shown stretched onto the new box.
function onCanvasResize() {
  if (applyBuffer()) replayLastFrame();
}

// ---- mono path (no inline-3D session, or the layer was lost) -------------------------------
function monoTick(now) {
  sway(now);
  applyBuffer();
  drawFrame(eyeRects(), false);
  requestAnimationFrame(monoTick);
}
function startMono() {
  if (monoLoopOn) return;
  monoLoopOn = true;
  requestAnimationFrame(monoTick);
}

// The weave layer went away for good. Take the canvas flat and stay on the mono loop.
function onLayerLost() {
  lost = true;
  sbsMode = false;
  hideCover();
  strengthEl.disabled = true;
  setStatus('3D is not available in this window. The chart is drawn flat.');
  startMono();
}

// ---- depth and mode ------------------------------------------------------------------------
// The display-rig eye separation. Relative [0,1]: 1 is the display's natural depth, lower is a
// comfort dial. In 2D the panel is switched flat by setStereoEnabled, and the SDK zeroes the rig
// itself. Where the browser has no display-mode API, flatten the rig here instead.
function currentIpd() {
  return want3D || inline3dDisplayModesSupported() ? strength : 0;
}

function applyRig() {
  if (!handle || lost || !inline3dViewRigSupported()) return;
  handle.setViewRig(displayRig({
    virtualDisplayHeight: VIRTUAL_DISPLAY_HEIGHT,
    ipdFactor: currentIpd(),
    out: rigScratch,
  }));
}

async function setMode(on3D) {
  want3D = on3D;
  renderModeButton();
  layoutBars(!on3D);
  if (!handle || lost) {
    setStatus(on3D ? STATUS_2D_FALLBACK : 'Flat preview.');
    return;
  }
  applyRig();
  if (!inline3dDisplayModesSupported()) {
    setStatus(on3D ? STATUS_3D : '2D: the chart is flattened in this window (this browser has no panel mode switch).');
    return;
  }
  try {
    await wall.setStereoEnabled(on3D);
    setStatus(on3D ? STATUS_3D : 'The panel is in 2D. Press the button to return to 3D.');
  } catch (err) {
    console.warn('[chart] setStereoEnabled failed', err);
    want3D = !on3D;   // a refused request changes nothing
    layoutBars(on3D);
    renderModeButton();
    applyRig();
    setStatus(`This display cannot switch to ${on3D ? '3D' : '2D'} right now; staying in ${want3D ? '3D' : '2D'}.`);
  }
}

modeBtn.addEventListener('click', () => { setMode(!want3D); });

strengthEl.addEventListener('input', () => {
  strength = strengthEl.value / 100;
  strengthOut.textContent = `${strengthEl.value}%`;
  applyRig();
});

// ---- boot ----------------------------------------------------------------------------------
async function boot() {
  try {
    wall = await createInline3D({ lazy: false });
  } catch (err) {
    console.warn('[chart] inline-3D unavailable', err);
    wall = { supported: false };
  }

  if (!wall.supported) {
    strengthEl.disabled = true;
    hideCover();
    setStatus(STATUS_2D_FALLBACK);
    startMono();
    return;
  }

  // Size the side-by-side store before registering, then wait two frames: a canvas that is fresh to
  // the compositor is only joined reliably once it has a settled backing store (woven rule 4).
  sbsMode = true;
  applyBuffer();
  await nextFrame();
  await nextFrame();

  try {
    handle = wall.addScene(canvas, onXRFrame, {
      // The viewer's depth is the display rig. The chart is authored for the 0.24 m virtual display,
      // which is also addScene's default height, so no separate virtualDisplayHeight is passed.
      viewRig: displayRig({ virtualDisplayHeight: VIRTUAL_DISPLAY_HEIGHT, ipdFactor: currentIpd() }),
      bufferClamped: true,            // we clamp the buffer to the GL limit ourselves
      rectCover: { color: '#1f2229', snapshot: false },   // a flat plate in the background colour
      onResize: onCanvasResize,
      onLayerLost,
    });
  } catch (err) {
    console.warn('[chart] addScene failed', err);
    onLayerLost();
    return;
  }

  // Release the cover on the SDK's woven signal, and on a timeout in case that signal never comes.
  handle.firstWoven.then((r) => {
    hideCover();
    if (!r.woven && r.confirmed) {
      setStatus(`3D did not join the panel yet (${r.reason}). The chart is shown as the browser draws it.`);
    }
  });
  setTimeout(hideCover, COVER_MS);

  strengthEl.disabled = false;
  setStatus(STATUS_3D);
}

renderModeButton();
boot();
