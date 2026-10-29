// Earth — a procedurally coloured globe with five city markers, in a DisplayXR inline-3D window.
//
// The visitor turns the SUBJECT (the globe), so this is a display-rig scene framed by SceneViewer,
// not a camera rig (docs/authoring-inline-3d.md, "Which rig"). See NOTES.md for each depth setting.

import * as THREE from 'three';
import { createInline3D } from '@displayxr/inline3d';
import { DepthCursor, EyeCamera, raycastHitTest } from '@displayxr/inline3d/three';
import { SceneViewer } from '@displayxr/inline3d/viewer';

// ── depth and framing ───────────────────────────────────────────────────────────────────────
const VIRTUAL_DISPLAY_HEIGHT = 0.24; // metres; the SDK default, passed to both addScene and the viewer
const FIT_MARGIN = 0.8;              // the SDK default: the subject spans 80% of the tile
const SUBJECT_EXTENT = 2.3;          // globe diameter 2, plus marker heads and stalks on each side
const COVER_MAX_MS = 6000;           // the cover always comes off, even if firstWoven never settles

const BACKGROUND = 0x2a2d33;         // dark grey, not black: crosstalk cannot go darker than black
const CLICK_SLOP_PX = 6;             // pointer travel that still counts as a click, not a drag
const PICK_RADIUS_PX = 28;           // how close a click must land to a marker's head

const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);

const CITIES = [
  { key: 'london', name: 'London', lat: 51.5074, lon: -0.1278, population: 8_900_000,
    basis: 'Greater London, 2023 estimate' },
  { key: 'tokyo', name: 'Tokyo', lat: 35.6762, lon: 139.6503, population: 14_000_000,
    basis: 'Tokyo Metropolis, approx. 2023' },
  { key: 'new-york', name: 'New York', lat: 40.7128, lon: -74.006, population: 8_300_000,
    basis: 'New York City, 2023 estimate' },
  { key: 'sydney', name: 'Sydney', lat: -33.8688, lon: 151.2093, population: 5_400_000,
    basis: 'Greater Sydney, approx. 2023' },
  { key: 'nairobi', name: 'Nairobi', lat: -1.2921, lon: 36.8219, population: 4_400_000,
    basis: 'Nairobi City County, 2019 census' },
];

// Rough continents as ellipses [lat, lon, latRadius, lonRadius], degrees. Procedural, not
// geographic data: enough to read as Earth, with a noisy boundary so the coasts are not ellipses.
const LAND = [
  [48, -100, 22, 36], // North America
  [-14, -60, 30, 18], // South America
  [72, -40, 11, 19],  // Greenland
  [4, 20, 31, 27],    // Africa
  [54, 18, 12, 20],   // Europe
  [52, 95, 24, 70],   // Asia
  [24, 45, 9, 13],    // Arabia
  [22, 78, 12, 11],   // India
  [4, 107, 10, 12],   // South-east Asia
  [36, 138, 6, 4],    // Japan
  [-25, 135, 10, 20], // Australia (wide enough to put Sydney's marker on the coast)
  [-82, 0, 9, 180],   // Antarctica
];

const OCEAN = new THREE.Color(0x1f5c8c);
const FOREST = new THREE.Color(0x4f7d3c);
const DRY = new THREE.Color(0x9b8a57);
const ICE = new THREE.Color(0xe4ebf0);

// lat/lon in degrees → unit vector. Longitude 0 faces the viewer at yaw 0 (see spinTo).
function toUnit(latDeg, lonDeg, out = new THREE.Vector3()) {
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG;
  return out.set(Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon));
}

function isLand(lat, lon) {
  const wobble = 0.5 * Math.sin(lat * 0.21 + lon * 0.13)
    + 0.3 * Math.sin(lat * 0.47 - lon * 0.31 + 1.3)
    + 0.2 * Math.sin(lat * 0.9 + lon * 0.77 + 0.2);
  for (const [cLat, cLon, rLat, rLon] of LAND) {
    const dLon = ((lon - cLon + 540) % 360) - 180;
    if (Math.hypot((lat - cLat) / rLat, dLon / rLon) < 1 + 0.15 * wobble) return true;
  }
  return false;
}

// Mid-tones on purpose: no pure white or pure black, and no fine high-contrast detail.
function surfaceColour(lat, lon, out) {
  if (isLand(lat, lon)) {
    const mix = 0.5 + 0.5 * Math.sin(lat * 0.4 + lon * 0.25);
    out.copy(FOREST).lerp(DRY, mix * 0.6);
  } else {
    out.copy(OCEAN);
  }
  // Ice caps, blended over the last ~8 degrees towards each pole.
  const ice = Math.min(Math.max((Math.abs(lat) - 64) / 8, 0), 1);
  out.lerp(ICE, ice * 0.85);
  return out;
}

function buildGlobeRoot() {
  const geo = new THREE.SphereGeometry(1, 128, 96);
  const pos = geo.attributes.position;
  const colours = new Float32Array(pos.count * 3);
  const p = new THREE.Vector3();
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).normalize();
    surfaceColour(Math.asin(p.y) / DEG, Math.atan2(p.x, p.z) / DEG, c);
    colours.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  // Lambert, not Phong: a specular highlight is a bright spot on dark, which crosstalk doubles.
  const globe = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));

  const root = new THREE.Group();
  root.add(globe);

  const STALK = 0.13;
  const HEAD = 0.05;
  const stalkGeo = new THREE.CylinderGeometry(0.011, 0.011, STALK, 10);
  const headGeo = new THREE.SphereGeometry(HEAD, 20, 14);
  const idleMat = new THREE.MeshLambertMaterial({ color: 0xffb13b, emissive: 0x3a2200 });
  const selectedMat = new THREE.MeshLambertMaterial({ color: 0xff5a4e, emissive: 0x3a0800 });
  const stalkMat = new THREE.MeshLambertMaterial({ color: 0xd9dde3 });

  const markers = CITIES.map((city) => {
    // Each marker stands on the surface along its normal, so it turns with the globe.
    const normal = toUnit(city.lat, city.lon);
    const group = new THREE.Group();
    group.position.copy(normal);
    group.quaternion.setFromUnitVectors(UP, normal);
    const stalk = new THREE.Mesh(stalkGeo, stalkMat);
    stalk.position.y = STALK / 2;
    const head = new THREE.Mesh(headGeo, idleMat);
    head.position.y = STALK + HEAD * 0.5;
    group.add(stalk, head);
    root.add(group);
    return { key: city.key, head, setSelected: (on) => { head.material = on ? selectedMat : idleMat; } };
  });

  return { root, markers };
}

// ── the viewer and the scene ────────────────────────────────────────────────────────────────
const canvas = document.getElementById('globe');
const cover = document.getElementById('cover');
const status = document.getElementById('status');
const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const viewer = new SceneViewer(THREE, canvas, {
  virtualDisplayHeight: VIRTUAL_DISPLAY_HEIGHT,
  margin: FIT_MARGIN,
  // A sphere's silhouette is the same at every yaw, so the diagonal sweep fit (for a long subject
  // turning into the tile) would only shrink it for nothing.
  fitSweep: false,
  idleSpin: 0, // a still globe keeps its markers where a click expects them
});
viewer.useEyeCamera(EyeCamera);
viewer.scene.background = new THREE.Color(BACKGROUND);
viewer.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(-1.5, 1.2, 2.5); // fixed in the world, so the globe turns under the light
viewer.scene.add(sun);

const { root: globe, markers } = buildGlobeRoot();
viewer.content.add(globe);
viewer.fitTo([0, 0, 0], [SUBJECT_EXTENT, SUBJECT_EXTENT, SUBJECT_EXTENT]);

// The depth cursor rises to the content under the pointer, so the OS arrow is never drawn behind
// a marker or the bulge of the globe that pops out of the glass (docs/authoring-inline-3d.md).
viewer.useDepthCursor(DepthCursor, (content) => raycastHitTest(THREE, [content]));

// ── selection, info panel, and spinning to a city ───────────────────────────────────────────
const cardEl = document.getElementById('card');
const emptyEl = document.getElementById('empty');
const nameEl = document.getElementById('cityName');
const popEl = document.getElementById('cityPop');
const basisEl = document.getElementById('cityBasis');
const listButtons = [...document.querySelectorAll('[data-city]')];

function selectCity(key) {
  const city = CITIES.find((c) => c.key === key);
  if (!city) return;
  for (const m of markers) m.setSelected(m.key === key);
  for (const b of listButtons) b.setAttribute('aria-pressed', String(b.dataset.city === key));
  nameEl.textContent = city.name;
  popEl.textContent = `${(city.population / 1e6).toFixed(1)} million`;
  basisEl.textContent = city.basis;
  cardEl.hidden = false;
  emptyEl.hidden = true;
}

// Spin so the chosen city faces the viewer. With yaw about Y then pitch about X (the viewer's
// SceneViewer order), a city at (lat, lon) faces the viewer at yaw = -lon and pitch = lat.
const wrapDeg = (d) => ((((d + 180) % 360) + 360) % 360) - 180;
let tween = null;
function spinTo(city) {
  const from = viewer.getPose();
  tween = {
    t0: performance.now(),
    dur: reduceMotion ? 0 : 700,
    fromYaw: from.yaw,
    dYaw: wrapDeg(-city.lon - from.yaw),
    fromPitch: from.pitch,
    dPitch: city.lat - from.pitch,
  };
}
viewer.onTick = () => {
  if (!tween) return;
  const k = tween.dur ? Math.min((performance.now() - tween.t0) / tween.dur, 1) : 1;
  const e = 1 - Math.pow(1 - k, 3);
  viewer.setPose({
    yaw: tween.fromYaw + tween.dYaw * e,
    pitch: tween.fromPitch + tween.dPitch * e,
  });
  if (k >= 1) tween = null;
};

for (const b of listButtons) {
  b.addEventListener('click', () => {
    const city = CITIES.find((c) => c.key === b.dataset.city);
    selectCity(city.key);
    spinTo(city);
  });
}

// ── picking: a click on a marker's head, projected through the nominal viewer ──────────────
// A marker is pickable only if it faces the viewer; the sphere hides the far side. The projection
// uses the mono camera (the nominal viewer at the glass), not an eye camera.
const scratch = new THREE.Vector3();
const scratchN = new THREE.Vector3();
const scratchCam = new THREE.Vector3();
const scratchCentre = new THREE.Vector3();

function pickAt(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return;
  viewer.scene.updateMatrixWorld(true);
  viewer.monoCamera.updateMatrixWorld(true);
  const cam = viewer.monoCamera.position;
  globe.getWorldPosition(scratchCentre);

  let best = null;
  let bestD = PICK_RADIUS_PX;
  for (const m of markers) {
    m.head.getWorldPosition(scratch);
    scratchN.copy(scratch).sub(scratchCentre).normalize();
    scratchCam.copy(cam).sub(scratch);
    if (scratchN.dot(scratchCam) <= 0) continue; // on the far side of the globe
    const ndc = scratch.clone().project(viewer.monoCamera);
    if (ndc.z > 1) continue;
    const sx = r.left + ((ndc.x + 1) / 2) * r.width;
    const sy = r.top + ((1 - ndc.y) / 2) * r.height;
    const d = Math.hypot(sx - clientX, sy - clientY);
    if (d < bestD) {
      bestD = d;
      best = m;
    }
  }
  if (best) selectCity(best.key);
}

let press = null;
canvas.addEventListener('pointerdown', (e) => {
  press = { id: e.pointerId, x: e.clientX, y: e.clientY };
  tween = null; // a grab takes the globe back from any spin in progress
});
canvas.addEventListener('pointerup', (e) => {
  if (!press || press.id !== e.pointerId) return;
  const moved = Math.hypot(e.clientX - press.x, e.clientY - press.y);
  press = null;
  if (moved < CLICK_SLOP_PX) pickAt(e.clientX, e.clientY);
});
canvas.addEventListener('pointercancel', () => { press = null; });

// ── startup: the SDK's woven signal releases the cover, and a timer always does too ─────────
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const uncover = () => cover.remove();
const setStatus = (text) => {
  status.textContent = text;
  status.hidden = !text;
};
// Tracking state is a hint, never an error: nothing here changes the pixels.
const trackingHint = (state) => (state === 'searching' ? 'Step back into view to see the globe in 3D.' : '');

async function start() {
  try {
    const wall = await createInline3D({ lazy: false });
    if (!wall.supported) {
      // A normal browser: one flat camera on the same globe, same drag, same clicks.
      viewer.startMono();
      return;
    }

    const handle = wall.addScene(canvas, viewer.onFrame, {
      virtualDisplayHeight: VIRTUAL_DISPLAY_HEIGHT,
      onLayerLost: viewer.onLayerLost, // the session ended: go flat, never show raw side-by-side
    });
    setStatus(trackingHint(wall.trackingState));
    handle.on('trackingstatechange', (state) => setStatus(trackingHint(state)));
    // Cover comes off on the first woven frame, or after COVER_MAX_MS whichever is first.
    await Promise.race([handle.firstWoven, delay(COVER_MAX_MS)]);
  } catch (err) {
    console.warn('[globe] inline-3D setup failed; showing the flat globe', err);
    viewer.startMono();
  } finally {
    uncover();
  }
}

start();
