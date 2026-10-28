// Five Cities — a spinnable 3D globe for the DisplayXR Browser (glasses-free 3D), flat 2D elsewhere.
//
// Rig choice: the visitor turns the SUBJECT (the globe), so this is a DISPLAY rig — the canvas is
// a portal onto a virtual display and the runtime places the eyes. SceneViewer (the SDK's
// ./viewer) does the side-by-side loop, framing on the zero-disparity plane, drag-orbit, idle
// turntable, last-good-frame replay and the mono fallback; this file adds the globe, the city
// markers, picking and the HTML info panel.

import * as THREE from 'three';
import { createInline3D } from '@displayxr/inline3d';
import { EyeCamera, DepthCursor, raycastHitTest } from '@displayxr/inline3d/three';
import { SceneViewer } from '@displayxr/inline3d/viewer';
import { buildEarthMaps } from './earth-texture.js';

// ---- depth & framing settings (see NOTES.md for the reasoning) ------------------------------
const PAGE_BG = '#04060c';        // = CSS --bg; the canvas clears to it, opaque
const VIRTUAL_DISPLAY_H = 0.24;   // metres of virtual world the tile height spans (SDK default)
const MARGIN = 0.78;              // globe + glow fill 78% of the tile: never touches an edge
const DEPTH_BIAS = 0.5;           // globe centre sits this many radii BEHIND the glass
const ZOOM_RANGE = [0.8, 1.15];   // bounded zoom: depth grows with zoom, keep it comfortable
const PITCH_LIMIT = [-40, 40];
const IDLE_SPIN = 5;              // deg/s turntable after 2.5 s idle (off while a city is open)

const R = 1;                      // globe radius, model units (SceneViewer scales it to the tile)
const EXTENT = 1.12 * R;          // half-size including the atmosphere shell, for fitTo

const CITIES = [
  { id: 'london',  name: 'London',   country: 'United Kingdom', lat: 51.507,  lon: -0.128,
    population: 8_866_000,  popNote: '2021 census, Greater London', tz: 'Europe/London' },
  { id: 'tokyo',   name: 'Tokyo',    country: 'Japan',          lat: 35.690,  lon: 139.692,
    population: 14_040_000, popNote: '2023 estimate, Tokyo Metropolis', tz: 'Asia/Tokyo' },
  { id: 'newyork', name: 'New York', country: 'United States',  lat: 40.713,  lon: -74.006,
    population: 8_804_000,  popNote: '2020 census, New York City', tz: 'America/New_York' },
  { id: 'sydney',  name: 'Sydney',   country: 'Australia',      lat: -33.869, lon: 151.209,
    population: 5_232_000,  popNote: '2021 census, Greater Sydney', tz: 'Australia/Sydney' },
  { id: 'nairobi', name: 'Nairobi',  country: 'Kenya',          lat: -1.286,  lon: 36.817,
    population: 4_397_000,  popNote: '2019 census, Nairobi County', tz: 'Africa/Nairobi' },
];

const canvas = document.getElementById('globe');
const cover = document.getElementById('cover');
const statusEl = document.getElementById('status');
const infoEl = document.getElementById('info');
const listEl = document.getElementById('cityList');

const D2R = Math.PI / 180;
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

// Same parameterisation as THREE.SphereGeometry's UVs, so markers land on the texture's places.
function latLonToVec(lat, lon, r = R) {
  const polar = (90 - lat) * D2R;
  const th = (lon + 180) * D2R;
  return new THREE.Vector3(
    -r * Math.cos(th) * Math.sin(polar),
    r * Math.cos(polar),
    r * Math.sin(th) * Math.sin(polar),
  );
}

// ---- boot -----------------------------------------------------------------------------------
await nextFrame(); // let the cover paint before the (synchronous) texture build
const maps = buildEarthMaps(2048, 1024);

const viewer = new SceneViewer(THREE, canvas, {
  virtualDisplayHeight: VIRTUAL_DISPLAY_H,
  fit: 'contain',
  margin: MARGIN,
  fitSweep: false,               // a sphere is as wide at every yaw; no need to shrink for sweep
  idleSpin: IDLE_SPIN,
  pitchLimit: PITCH_LIMIT,
});
viewer.useEyeCamera(EyeCamera);
// Opaque clear in the page colour: a transparent woven canvas shows BLACK on the panel
// (woven-canvas-rules, "a transparent canvas weaves black"); this keeps 2D and 3D identical.
viewer.renderer.setClearColor(new THREE.Color(PAGE_BG), 1);
viewer.renderer.outputColorSpace = THREE.SRGBColorSpace;

// ---- the globe --------------------------------------------------------------------------------
const maxAniso = viewer.renderer.capabilities.getMaxAnisotropy();
function canvasTex(c, srgb) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = Math.min(8, maxAniso);
  return t;
}

const earth = new THREE.Group();          // rotated by the viewer (via its content group)
viewer.content.add(earth);

const globe = new THREE.Mesh(
  new THREE.SphereGeometry(R, 128, 64),
  new THREE.MeshPhongMaterial({
    map: canvasTex(maps.color, true),
    specularMap: canvasTex(maps.specular, false),
    specular: new THREE.Color(0x4a6a8a),
    shininess: 22,
  }),
);
earth.add(globe);

const clouds = new THREE.Mesh(
  new THREE.SphereGeometry(R * 1.012, 96, 48),
  new THREE.MeshLambertMaterial({
    map: canvasTex(maps.clouds, true),
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  }),
);
earth.add(clouds);

// Fresnel rim on the globe (front faces) + a soft halo just outside it (back faces). Both use
// the real per-eye camera position, so each eye gets its own correct rim.
const fresnelVS = /* glsl */ `
  varying vec3 vN; varying vec3 vW;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;
const rim = new THREE.Mesh(
  new THREE.SphereGeometry(R * 1.004, 96, 48),
  new THREE.ShaderMaterial({
    vertexShader: fresnelVS,
    fragmentShader: /* glsl */ `
      varying vec3 vN; varying vec3 vW;
      void main() {
        float d = max(dot(normalize(vN), normalize(cameraPosition - vW)), 0.0);
        float a = pow(1.0 - d, 3.5) * 0.65;
        gl_FragColor = vec4(vec3(0.35, 0.62, 1.0) * a, 1.0);
      }`,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  }),
);
earth.add(rim);
const halo = new THREE.Mesh(
  new THREE.SphereGeometry(R * 1.12, 96, 48),
  new THREE.ShaderMaterial({
    vertexShader: fresnelVS,
    fragmentShader: /* glsl */ `
      varying vec3 vN; varying vec3 vW;
      void main() {
        float d = -dot(normalize(vN), normalize(cameraPosition - vW));   // back faces: > 0
        float a = pow(smoothstep(0.0, 0.46, d), 2.4) * 0.55;
        gl_FragColor = vec4(vec3(0.30, 0.55, 1.0) * a, 1.0);
      }`,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  }),
);
earth.add(halo);

// Light fixed to the DISPLAY (scene root), not the globe: spinning the globe moves the land
// under a steady key light from the upper left, like a desk globe under a lamp.
viewer.scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x1a2234, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 2.0);
sun.position.set(-0.9, 0.7, 1.2);
viewer.scene.add(sun);

// ---- markers ----------------------------------------------------------------------------------
const COLOR_IDLE = new THREE.Color(0xffb547);
const COLOR_SEL = new THREE.Color(0xff6b7d);
const markersGroup = new THREE.Group();
earth.add(markersGroup);
const proxies = [];
const UP = new THREE.Vector3(0, 1, 0);
const stemGeo = new THREE.CylinderGeometry(0.0045, 0.0045, 0.05, 10);
stemGeo.translate(0, 0.025, 0);
const headGeo = new THREE.SphereGeometry(0.02, 20, 12);
const ringGeo = new THREE.RingGeometry(0.026, 0.034, 40);
ringGeo.rotateX(-Math.PI / 2);
const proxyGeo = new THREE.SphereGeometry(0.075, 12, 8);
const proxyMat = new THREE.MeshBasicMaterial({ visible: false });

for (const city of CITIES) {
  const g = new THREE.Group();
  const n = latLonToVec(city.lat, city.lon, 1).normalize();
  g.position.copy(n).multiplyScalar(R);
  g.quaternion.setFromUnitVectors(UP, n);

  const color = COLOR_IDLE.clone();
  const stem = new THREE.Mesh(stemGeo, new THREE.MeshBasicMaterial({ color }));
  const head = new THREE.Mesh(headGeo, new THREE.MeshBasicMaterial({ color }));
  head.position.y = 0.055;
  const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide,
  }));
  ring.position.y = 0.016;                 // just above the cloud layer
  // Invisible, generous click target — on its own layer so the depth cursor's ray (layer 0)
  // ignores it and rises to the real marker/globe surface instead.
  const proxy = new THREE.Mesh(proxyGeo, proxyMat);
  proxy.position.y = 0.03;
  proxy.layers.set(1);
  proxy.userData.city = city;
  proxies.push(proxy);

  g.add(stem, head, ring, proxy);
  markersGroup.add(g);
  city.marker = { group: g, head, ring, materials: [stem.material, head.material, ring.material] };
}

// ---- framing ----------------------------------------------------------------------------------
// fitTo centres the subject on the zero-disparity plane and scales it to the tile; depthOffset
// then slides it back so the visible hemisphere straddles the glass (see NOTES.md).
viewer.fitTo([0, 0, 0], [2 * EXTENT, 2 * EXTENT, 2 * EXTENT]);
const fitScale = viewer.getSubjectBounds().scale;      // model units -> display metres at zoom 1
const radiusDisplay = R * fitScale;
const depthFor = (zoom) => -DEPTH_BIAS * radiusDisplay * zoom;

// Open on Europe & Africa, tilted so the northern cities are toward the viewer.
const yawFor = (city) => {
  const v = latLonToVec(city.lat, city.lon, 1);
  return -Math.atan2(v.x, v.z) / D2R;
};
viewer.setPose({ yaw: yawFor({ lat: 0, lon: 15 }), pitch: 14, zoom: 1, depthOffset: depthFor(1) });

// ---- per-frame: our animation on top of the viewer's tick -------------------------------------
let fly = null;                 // { yaw, pitch } target, eased
let zoomTarget = 1;
let zoom = 1;
let selected = null;
let lastT = performance.now();

viewer.onTick = () => {
  const t = performance.now();
  const dt = Math.min((t - lastT) / 1000, 0.1);
  lastT = t;

  clouds.rotation.y += dt * 0.006;

  // Selected marker: a gentle pulse on the ring. (Scale only — no flashing, nothing that would
  // differ between the eyes.)
  const pulse = 1 + 0.25 * (0.5 + 0.5 * Math.sin(t / 380));
  for (const c of CITIES) {
    const on = c === selected;
    c.marker.ring.scale.setScalar(on ? pulse : 1);
    c.marker.head.scale.setScalar(on ? 1.3 : 1);
  }

  const k = 1 - Math.exp(-dt * 5);
  const pose = {};
  if (fly) {
    const p = viewer.getPose();
    const dy = fly.yaw - p.yaw, dp = fly.pitch - p.pitch;
    if (Math.abs(dy) < 0.05 && Math.abs(dp) < 0.05) { pose.yaw = fly.yaw; pose.pitch = fly.pitch; fly = null; }
    else { pose.yaw = p.yaw + dy * k; pose.pitch = p.pitch + dp * k; }
  }
  if (Math.abs(zoomTarget - zoom) > 1e-4) {
    zoom += (zoomTarget - zoom) * k;
    pose.zoom = zoom;
    pose.depthOffset = depthFor(zoom);   // keep the same proportion in front of / behind the glass
  }
  if (Object.keys(pose).length) viewer.setPose(pose);
};

// ---- picking ------------------------------------------------------------------------------------
// In 3D the pointer is ON THE GLASS (z = 0), so the line of sight runs from the midpoint of the
// two eyes the runtime reported through the pointer's point on the z = 0 plane — the plane spans
// the virtual display (VIRTUAL_DISPLAY_H tall, centred on the origin). In 2D it is the mono camera.
const eyeMid = new THREE.Vector3();
let haveEyes = false;
function onFrame(views, layer, frame) {
  if (views && views.length >= 2) {
    let x = 0, y = 0, z = 0;
    for (const v of views) { const m = v.transform.matrix; x += m[12]; y += m[13]; z += m[14]; }
    eyeMid.set(x / views.length, y / views.length, z / views.length);
    haveEyes = true;
  }
  viewer.onFrame(views, layer, frame);
}

const raycaster = new THREE.Raycaster();
raycaster.layers.enableAll();
const pickTargets = [globe, ...proxies];
const ndc = new THREE.Vector2();
const onGlass = new THREE.Vector3();
function cityAt(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  const u = (clientX - r.left) / r.width, v = (clientY - r.top) / r.height;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  if (viewer.is3D && haveEyes) {
    const aspect = r.width / r.height;
    onGlass.set((u - 0.5) * VIRTUAL_DISPLAY_H * aspect, (0.5 - v) * VIRTUAL_DISPLAY_H, 0);
    raycaster.set(eyeMid, onGlass.clone().sub(eyeMid).normalize());
  } else {
    ndc.set(u * 2 - 1, 1 - v * 2);
    raycaster.setFromCamera(ndc, viewer.monoCamera);
  }
  viewer.scene.updateMatrixWorld();
  const hit = raycaster.intersectObjects(pickTargets, false)[0];
  return hit?.object.userData.city || null;   // the globe in front of a marker hides it
}

let down = null;
canvas.addEventListener('pointerdown', (e) => {
  down = { x: e.clientX, y: e.clientY, t: performance.now() };
  fly = null;                                  // the visitor takes over
  canvas.classList.add('dragging');
});
const endDrag = (e) => {
  canvas.classList.remove('dragging');
  if (down && e.type === 'pointerup') {
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    if (moved < 6 && performance.now() - down.t < 600) {
      const city = cityAt(e.clientX, e.clientY);
      if (city) select(city);
    }
  }
  down = null;
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

let hoverQueued = false, hoverX = 0, hoverY = 0;
canvas.addEventListener('pointermove', (e) => {
  hoverX = e.clientX; hoverY = e.clientY;
  if (down || hoverQueued) return;
  hoverQueued = true;
  requestAnimationFrame(() => {
    hoverQueued = false;
    canvas.classList.toggle('over-marker', !!cityAt(hoverX, hoverY));
  });
});
canvas.addEventListener('pointerleave', () => canvas.classList.remove('over-marker'));

// Bounded zoom. Captured on the stage so the viewer's own (0.2x–6x) wheel zoom never runs: at 6x
// the globe would burst through the tile edges and far out of the glass.
canvas.parentElement.addEventListener('wheel', (e) => {
  if (e.target !== canvas) return;
  e.stopPropagation();
  e.preventDefault();
  let px = e.deltaY;
  if (e.deltaMode === 1) px *= 33; else if (e.deltaMode === 2) px *= 400;
  px = Math.max(-120, Math.min(120, px));
  zoomTarget = Math.max(ZOOM_RANGE[0], Math.min(ZOOM_RANGE[1], zoomTarget * Math.exp(-px * 0.001)));
}, { capture: true, passive: false });

// ---- selection + HTML panel -------------------------------------------------------------------
const fmtPop = (n) => new Intl.NumberFormat('en', { maximumFractionDigits: 1, notation: 'compact' })
  .format(n).replace('M', ' million');
const fmtFull = (n) => new Intl.NumberFormat('en').format(n);

function localTime(tz) {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', weekday: 'short' }).format(new Date());
  } catch { return '—'; }
}
const fmtCoord = (lat, lon) =>
  `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(2)}° ${lon >= 0 ? 'E' : 'W'}`;

function renderInfo() {
  if (!selected) {
    infoEl.innerHTML = '<h2>City</h2><p class="empty">Select a marker on the globe.</p>';
    return;
  }
  const c = selected;
  infoEl.innerHTML = `
    <button class="close" type="button" aria-label="Close">Close</button>
    <h2>City</h2>
    <p class="name">${c.name}</p>
    <p class="country">${c.country}</p>
    <dl>
      <dt>Population</dt><dd><span class="pop">${fmtPop(c.population)}</span></dd>
      <dt></dt><dd style="color:var(--muted);font-size:13px">${fmtFull(c.population)} · ${c.popNote}</dd>
      <dt>Local time</dt><dd>${localTime(c.tz)}</dd>
      <dt>Location</dt><dd>${fmtCoord(c.lat, c.lon)}</dd>
    </dl>`;
  infoEl.querySelector('.close').addEventListener('click', () => select(null));
}

const buttons = new Map();
for (const c of CITIES) {
  const li = document.createElement('li');
  const b = document.createElement('button');
  b.type = 'button';
  b.setAttribute('aria-pressed', 'false');
  b.innerHTML = `<span class="dot"></span><span>${c.name}</span><span class="country">${c.country}</span>`;
  b.addEventListener('click', () => select(c));
  li.appendChild(b);
  listEl.appendChild(li);
  buttons.set(c, b);
}

function select(city) {
  selected = city;
  for (const c of CITIES) {
    const on = c === city;
    for (const m of c.marker.materials) m.color.copy(on ? COLOR_SEL : COLOR_IDLE);
    buttons.get(c).setAttribute('aria-pressed', String(on));
  }
  // Hold the globe still while a city is open, so its marker stays in view.
  viewer.idleSpin = city ? 0 : IDLE_SPIN;
  if (city) {
    // Turn the city to the front: the nearest equivalent yaw, and a partial tilt toward its
    // latitude (inside the pitch clamp).
    const cur = viewer.getPose().yaw;
    let yaw = yawFor(city);
    yaw += Math.round((cur - yaw) / 360) * 360;
    const pitch = Math.max(PITCH_LIMIT[0], Math.min(PITCH_LIMIT[1], city.lat * 0.7));
    fly = { yaw, pitch };
  }
  renderInfo();
}

addEventListener('keydown', (e) => { if (e.key === 'Escape' && selected) select(null); });
setInterval(() => { if (selected) renderInfo(); }, 30_000);   // keep "local time" fresh

// ---- depth-aware cursor ---------------------------------------------------------------------
// The front of the globe and its markers come OUT of the glass; a flat cursor drawn on the
// glass over them reads as a broken image. Same option ./model and ./splat expose as
// cursor:'depth'. Proxies are on layer 1, so the hit test sees only real surfaces.
if (typeof viewer.useDepthCursor === 'function') {
  viewer.useDepthCursor(DepthCursor, () => raycastHitTest(THREE, [globe, markersGroup]), { raysPerFrame: 6 });
}

// ---- inline-3D session, or the 2D fallback ----------------------------------------------------
const wall = await createInline3D({ lazy: false });
if (wall.supported) {
  // Rule 4: the backing store is already 2:1 (SceneViewer sized it for 3D in its constructor);
  // give the compositor two committed frames before registering.
  await nextFrame(); await nextFrame();
  const handle = wall.addScene(canvas, onFrame, {
    virtualDisplayHeight: VIRTUAL_DISPLAY_H,
    onLayerLost: viewer.onLayerLost,
    rectCover: { color: PAGE_BG, snapshot: true },   // covers later resizes until rewoven()
  });
  const r = await handle.firstWoven;
  cover.hidden = true;                                // cut, never fade
  statusEl.innerHTML = r.woven
    ? '<b>Glasses-free 3D</b> · move your head to look around the globe'
    : '2D view';
} else {
  viewer.startMono();
  cover.hidden = true;
  statusEl.textContent = '2D view — open in the DisplayXR Browser on a 3D display for depth';
}
