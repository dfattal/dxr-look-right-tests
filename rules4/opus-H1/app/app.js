// Spatial Globe — a spinnable procedural Earth with five clickable cities, for the DisplayXR
// inline-3D browser (glasses-free 3D) with a plain 2D fallback everywhere else.
//
// Rig: the DISPLAY rig (the default). The visitor turns a SUBJECT, so we rotate the globe under
// a fixed portal rather than flying a camera (docs/authoring-inline-3d.md, "Which rig").
// SceneViewer does the framing (globe centred on the zero-disparity plane, scaled to the tile),
// the drag orbit, idle turntable, the validated SBS render loop and the mono fallback.

import * as THREE from 'three';
import { createInline3D } from '@displayxr/inline3d';
import { EyeCamera, DepthCursor, raycastHitTest } from '@displayxr/inline3d/three';
import { SceneViewer } from '@displayxr/inline3d/viewer';
import { buildEarthTextures } from './earth.js';

// Must match --bg in index.html: the scene clears to the page colour (dark grey, not black).
const BG = '#171b22';
// Metres of virtual display the tile's height spans. Passed to BOTH SceneViewer and addScene.
// The display rig is scale-invariant (the fit scales the globe into this), so this is just the
// SDK default, not a depth dial.
const VH = 0.24;
// Wheel zoom bounds (multiplier on the fit). Zooming in pushes the front of the globe further
// out of the glass, so we stop well short of the viewer's 6x.
const ZOOM_MIN = 0.75, ZOOM_MAX = 1.3;

const CITIES = [
  { id: 'london', name: 'London', country: 'United Kingdom', lat: 51.5072, lon: -0.1276,
    pop: 8_866_000, popNote: 'Greater London, 2021 census', tz: 'Europe/London' },
  { id: 'tokyo', name: 'Tokyo', country: 'Japan', lat: 35.6762, lon: 139.6503,
    pop: 14_047_000, popNote: 'Tokyo Metropolis, 2020 census (Greater Tokyo ≈ 37 million)', tz: 'Asia/Tokyo' },
  { id: 'newyork', name: 'New York', country: 'United States', lat: 40.7128, lon: -74.006,
    pop: 8_804_000, popNote: 'New York City, 2020 census (metro area ≈ 20 million)', tz: 'America/New_York' },
  { id: 'sydney', name: 'Sydney', country: 'Australia', lat: -33.8688, lon: 151.2093,
    pop: 5_231_000, popNote: 'Greater Sydney, 2021 census', tz: 'Australia/Sydney' },
  { id: 'nairobi', name: 'Nairobi', country: 'Kenya', lat: -1.2921, lon: 36.8219,
    pop: 4_397_000, popNote: 'Nairobi County, 2019 census', tz: 'Africa/Nairobi' },
];

const canvas = document.getElementById('globe');
const cover = document.getElementById('cover');
const modeEl = document.getElementById('mode');
const infoEl = document.getElementById('info');
const listEl = document.getElementById('cityList');
const stageEl = canvas.parentElement;

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---- cover: always comes off ---------------------------------------------------------------
let coverOff = false;
function removeCover() { if (!coverOff) { coverOff = true; cover.hidden = true; } } // hard cut
setTimeout(removeCover, 6000); // backstop: a missed signal must never leave the page sceneless

// ---- viewer --------------------------------------------------------------------------------
const viewer = new SceneViewer(THREE, canvas, {
  virtualDisplayHeight: VH,
  fit: 'contain',
  margin: 0.8,        // SDK default: subject fills 80% of the tile
  fitSweep: false,    // a sphere's footprint doesn't change as it turns; no need to shrink for it
  idleSpin: 5,        // slow turntable after the SDK's idle delay; off under reduced motion
});
viewer.useEyeCamera(EyeCamera);
viewer.scene.background = new THREE.Color(BG); // opaque dark grey in-canvas: no black behind the limb

// Lights live in the scene root, so they stay fixed relative to the viewer while the globe turns.
viewer.scene.add(new THREE.HemisphereLight(0xd6e4ff, 0x30343e, 1.15));
const sun = new THREE.DirectionalLight(0xfff4e6, 2.4);
sun.position.set(-0.7, 0.45, 1.0);
viewer.scene.add(sun);

// ---- the globe (model units: Earth radius 1) -----------------------------------------------
const earth = new THREE.Group();
viewer.content.add(earth);

const tex = buildEarthTextures({ width: 2048 });
const maxAniso = viewer.renderer.capabilities.getMaxAnisotropy();
const colorMap = new THREE.CanvasTexture(tex.color);
colorMap.colorSpace = THREE.SRGBColorSpace;
colorMap.anisotropy = Math.min(8, maxAniso);
const specMap = new THREE.CanvasTexture(tex.specular);
const cloudMap = new THREE.CanvasTexture(tex.clouds);

const globe = new THREE.Mesh(
  new THREE.SphereGeometry(1, 128, 64),
  new THREE.MeshPhongMaterial({ map: colorMap, specularMap: specMap, specular: 0x50606e, shininess: 28 }),
);
earth.add(globe);

const clouds = new THREE.Mesh(
  new THREE.SphereGeometry(1.012, 96, 48),
  new THREE.MeshLambertMaterial({ color: 0xf2f5f8, alphaMap: cloudMap, transparent: true,
    opacity: 0.55, depthWrite: false }),
);
earth.add(clouds);

// Atmosphere: a back-side halo just outside the limb. The limb sits at ~zero disparity (the
// globe is centred on the glass), so this glow is where stereo is most forgiving.
const atmoMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  uniforms: { color: { value: new THREE.Color(0x5b9cff) }, strength: { value: 0.55 } },
  vertexShader: `
    varying vec3 vN; varying vec3 vV;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `
    uniform vec3 color; uniform float strength;
    varying vec3 vN; varying vec3 vV;
    void main() {
      float d = -dot(normalize(vN), normalize(vV));     // 0 at the halo's outer edge
      float g = pow(clamp(d / 0.33, 0.0, 1.0), 1.6);    // strongest at the Earth's limb
      gl_FragColor = vec4(color * g * strength, 1.0);
    }`,
});
earth.add(new THREE.Mesh(new THREE.SphereGeometry(1.06, 96, 48), atmoMat));

// ---- markers --------------------------------------------------------------------------------
// Position on three's SphereGeometry for an equirectangular map: lon 0 at +x, lon +90 at -z.
function latLonToVec(lat, lon, r) {
  const p = THREE.MathUtils.degToRad(lat), t = THREE.MathUtils.degToRad(lon);
  return new THREE.Vector3(Math.cos(p) * Math.cos(t) * r, Math.sin(p) * r, -Math.cos(p) * Math.sin(t) * r);
}

const MARKER = 0xffb547, MARKER_SEL = 0x7fe3ff;
const headGeo = new THREE.SphereGeometry(0.022, 24, 16);
const stemGeo = new THREE.CylinderGeometry(0.005, 0.005, 0.05, 10).translate(0, 0.025, 0);
const ringGeo = new THREE.RingGeometry(0.018, 0.028, 32);
const proxyGeo = new THREE.SphereGeometry(0.06, 12, 8); // generous, invisible click target
const markers = [];
const hitTargets = [globe]; // what the depth cursor rises to (visible geometry only)
const pickTargets = [globe]; // what a click tests (globe first so back-side markers are occluded)

for (const city of CITIES) {
  const g = new THREE.Group();
  const n = latLonToVec(city.lat, city.lon, 1).normalize();
  g.position.copy(n);
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
  const mat = new THREE.MeshBasicMaterial({ color: MARKER });
  const stem = new THREE.Mesh(stemGeo, new THREE.MeshLambertMaterial({ color: 0xd9dde3 }));
  const head = new THREE.Mesh(headGeo, mat);
  head.position.y = 0.058;
  const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: MARKER, side: THREE.DoubleSide,
    transparent: true, opacity: 0.85, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.002;
  const proxy = new THREE.Mesh(proxyGeo, new THREE.MeshBasicMaterial());
  proxy.visible = false; proxy.position.y = 0.045; proxy.userData.city = city;
  g.add(stem, head, ring, proxy);
  earth.add(g);
  markers.push({ city, group: g, head, ring, mat, normal: n });
  hitTargets.push(head, stem);
  pickTargets.push(proxy);
}

// Model-space bounds: the halo (r 1.06) and the marker heads (≈1.08) define the subject.
viewer.fitTo([0, 0, 0], [2.16, 2.16, 2.16]);
const fitAgain = () => viewer.fitTo([0, 0, 0], [2.16, 2.16, 2.16]);
new ResizeObserver(() => requestAnimationFrame(fitAgain)).observe(canvas);

// Start facing Europe/Africa, tipped a little toward the viewer to show the north.
viewer.setPose({ yaw: yawFacing(latLonToVec(20, 15, 1)), pitch: 14 });

function yawFacing(p) { return -THREE.MathUtils.radToDeg(Math.atan2(p.x, p.z)); }

// ---- selection, pose tween, per-frame animation ---------------------------------------------
let selected = null;
let tween = null;
const idleSpin = viewer.idleSpin;

function select(city, { turn = true } = {}) {
  selected = city;
  for (const m of markers) {
    const on = m.city === city;
    m.mat.color.setHex(on ? MARKER_SEL : MARKER);
    m.ring.material.color.setHex(on ? MARKER_SEL : MARKER);
    if (!on) { m.head.scale.setScalar(1); m.ring.scale.setScalar(1); }
  }
  for (const b of listEl.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.id === city?.id));
  renderInfo(city);
  // Hold the turntable while a city is shown, so it stays in front.
  viewer.idleSpin = city ? 0 : idleSpin;
  if (city && turn) turnTo(city);
}

function turnTo(city) {
  const m = markers.find((x) => x.city === city);
  const from = viewer.getPose();
  let yaw = yawFacing(m.normal);
  yaw += 360 * Math.round((from.yaw - yaw) / 360); // shortest way round
  const pitch = THREE.MathUtils.clamp(city.lat * 0.75, -45, 45);
  if (reduceMotion) { viewer.setPose({ yaw, pitch }); tween = null; return; }
  tween = { t0: performance.now(), dur: 950, from, to: { yaw, pitch } };
}

const cloudSpin = 0.004; // rad/s relative to the ground
let lastT = performance.now();
viewer.onTick = () => {
  const t = performance.now();
  const dt = Math.min(0.1, (t - lastT) / 1000); lastT = t;
  if (!reduceMotion) clouds.rotation.y += cloudSpin * dt;
  if (tween) {
    const k = Math.min(1, (t - tween.t0) / tween.dur);
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    viewer.setPose({
      yaw: tween.from.yaw + (tween.to.yaw - tween.from.yaw) * e,
      pitch: tween.from.pitch + (tween.to.pitch - tween.from.pitch) * e,
    });
    if (k >= 1) tween = null;
  }
  if (selected && !reduceMotion) {
    const m = markers.find((x) => x.city === selected);
    const s = 1 + 0.18 * Math.sin(t / 260);
    m.head.scale.setScalar(s);
    m.ring.scale.setScalar(1 + 0.5 * ((t / 1400) % 1));
  }
};

// ---- info panel -------------------------------------------------------------------------------
const fmtPop = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });
function localTime(tz) {
  try { return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(new Date()); }
  catch { return '—'; }
}
const deg = (v, pos, neg) => `${Math.abs(v).toFixed(2)}° ${v >= 0 ? pos : neg}`;

function renderInfo(city) {
  if (!city) {
    infoEl.innerHTML = '<p class="empty">Select a marker on the globe to see the city’s name and population.</p>';
    return;
  }
  infoEl.innerHTML = `
    <h3>${city.name}</h3>
    <p class="country">${city.country}</p>
    <dl>
      <dt>Population</dt><dd class="pop">${fmtPop.format(city.pop)}</dd>
      <dt>Local time</dt><dd>${localTime(city.tz)}</dd>
      <dt>Location</dt><dd>${deg(city.lat, 'N', 'S')}, ${deg(city.lon, 'E', 'W')}</dd>
    </dl>
    <p class="note">${city.popNote}. Figures are approximate.</p>
    <button id="close" type="button">Clear selection</button>`;
  infoEl.querySelector('#close').addEventListener('click', () => select(null));
}

for (const city of CITIES) {
  const li = document.createElement('li');
  const b = document.createElement('button');
  b.type = 'button'; b.dataset.id = city.id; b.setAttribute('aria-pressed', 'false');
  b.innerHTML = `<span class="dot"></span>${city.name}<span style="margin-left:auto;color:var(--muted);font-size:13px">${city.country}</span>`;
  b.addEventListener('click', () => select(city));
  li.appendChild(b);
  listEl.appendChild(li);
}

// ---- picking ------------------------------------------------------------------------------------
// Display rig: there is no app camera, so a click is a ray from the viewer's eyes through the
// pointer's point on the glass (the z = 0 plane, VH tall, in display-local metres). We keep the
// midpoint of the latest eye pair for that. Before any 3D frame (and in 2D) the mono camera,
// which frames exactly VH at z = 0 from the nominal distance, gives the same ray.
const eyeMid = new THREE.Vector3();
let haveEyes = false;
function onFrame(views, layer, frame) {
  if (views && views.length >= 2) {
    const a = views[0].transform.matrix, b = views[views.length - 1].transform.matrix;
    eyeMid.set((a[12] + b[12]) / 2, (a[13] + b[13]) / 2, (a[14] + b[14]) / 2); // copied: XRViews expire
    haveEyes = true;
  }
  viewer.onFrame(views, layer, frame);
}

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const onGlass = new THREE.Vector3();
function pick(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  const u = (clientX - r.left) / r.width, v = (clientY - r.top) / r.height;
  if (viewer.is3D && haveEyes) {
    onGlass.set((u - 0.5) * VH * (r.width / r.height), (0.5 - v) * VH, 0);
    raycaster.set(eyeMid, onGlass.clone().sub(eyeMid).normalize());
  } else {
    ndc.set(u * 2 - 1, 1 - v * 2);
    raycaster.setFromCamera(ndc, viewer.monoCamera);
  }
  viewer.scene.updateMatrixWorld();
  const hit = raycaster.intersectObjects(pickTargets, false)[0];
  return hit?.object.userData.city || null;
}

// Click vs drag: SceneViewer owns the drag; a short, still press is a click.
let down = null;
canvas.addEventListener('pointerdown', (e) => {
  down = { x: e.clientX, y: e.clientY, t: performance.now() };
  tween = null; // the visitor takes over
  canvas.classList.add('dragging');
});
canvas.addEventListener('pointerup', (e) => {
  canvas.classList.remove('dragging');
  if (!down) return;
  const still = Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6 && performance.now() - down.t < 600;
  down = null;
  if (still) { const c = pick(e.clientX, e.clientY); if (c) select(c); }
});
canvas.addEventListener('pointercancel', () => { down = null; canvas.classList.remove('dragging'); });
let hoverQueued = false, hx = 0, hy = 0;
canvas.addEventListener('pointermove', (e) => {
  if (down) return;
  hx = e.clientX; hy = e.clientY;
  if (hoverQueued) return;
  hoverQueued = true;
  requestAnimationFrame(() => { hoverQueued = false; canvas.classList.toggle('over-city', !!pick(hx, hy)); });
});
canvas.addEventListener('pointerleave', () => canvas.classList.remove('over-city'));

// Bound the wheel zoom: swallow wheel events (capture phase, before the viewer's own listener)
// that would push past our limits.
stageEl.addEventListener('wheel', (e) => {
  if (e.target !== canvas) return;
  const z = viewer.getPose({ target: true }).zoom;
  if ((e.deltaY < 0 && z >= ZOOM_MAX) || (e.deltaY > 0 && z <= ZOOM_MIN)) {
    e.preventDefault(); e.stopPropagation();
  }
}, { capture: true, passive: false });

// ---- boot ---------------------------------------------------------------------------------------
function goMono(label) {
  viewer.startMono();
  modeEl.textContent = label;
  requestAnimationFrame(() => requestAnimationFrame(removeCover)); // after the first flat frame
}

(async () => {
  try {
    const wall = await createInline3D({ lazy: false });
    if (!wall.supported) { goMono('2D view'); return; }

    // The depth cursor: the globe's front comes out of the glass, so a cursor drawn on the glass
    // would sit "behind" it. This lifts it (or hands the depth to the runtime's own cursor).
    viewer.useDepthCursor(DepthCursor, () => raycastHitTest(THREE, hitTargets));

    // Commit the canvas before registering it: SceneViewer already sized a 2:1 store; give the
    // compositor two frames with it before the layer is created.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const handle = wall.addScene(canvas, onFrame, {
      virtualDisplayHeight: VH,
      onLayerLost: () => { viewer.onLayerLost(); modeEl.textContent = '2D view'; modeEl.classList.remove('on'); },
      rectCover: { color: BG, snapshot: true }, // cover the tile across responsive resizes
    });
    modeEl.textContent = 'Glasses-free 3D';
    modeEl.classList.add('on');
    const res = await handle.firstWoven; // never rejects
    if (!res.woven) console.info('[globe] tile not woven:', res.reason);
    removeCover();
  } catch (err) {
    console.error('[globe] inline-3D setup failed, showing 2D:', err);
    goMono('2D view');
  }
})();
