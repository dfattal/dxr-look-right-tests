// A spinning Earth with five city markers, as a DisplayXR inline-3D window.
//
// Rig: a DISPLAY rig. The globe is a subject the viewer turns, not a world the viewer walks
// through, so the canvas is a portal and the runtime places the eyes. SceneViewer does the
// framing, drag-to-spin, idle turntable and the flat fallback. This file adds the globe, the
// markers, picking and the info panel. NOTES.md lists every depth-related value and why.

import * as THREE from 'three';
import { createInline3D } from '@displayxr/inline3d';
import { SceneViewer } from '@displayxr/inline3d/viewer';
import { EyeCamera, DepthCursor, raycastHitTest } from '@displayxr/inline3d/three';
import { CITIES, LANDMASSES, DESERTS } from './data.js';

// ---- depth settings (each one is explained in NOTES.md) ---------------------------------------
const VIRTUAL_DISPLAY_HEIGHT = 0.24; // metres. Same value on SceneViewer and addScene.
const FILL = 0.5; // globe diameter as a fraction of the tile height: the same total depth as the SDK's hello-cube
const IDLE_SPIN_DEG_S = 4; // turntable speed while nothing is selected

const BG = 0x070b16; // opaque background: a transparent woven frame reads as black on the panel

const canvas = document.getElementById('globe');
const poster = document.getElementById('poster');
const statusEl = document.getElementById('status');
const cityList = document.getElementById('cities');
const hintEl = document.getElementById('hint');
const detailEl = document.getElementById('detail');
const nameEl = document.getElementById('cityName');
const countryEl = document.getElementById('cityCountry');
const popEl = document.getElementById('cityPop');
const basisEl = document.getElementById('cityBasis');
const clearBtn = document.getElementById('clear');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---- geometry helpers -------------------------------------------------------------------------
// Convention: longitude 0 faces the viewer (+z), east is +x. Then
//   x = cos(lat) sin(lon), y = sin(lat), z = cos(lat) cos(lon).
// SceneViewer's pivot is Rx(pitch) * Ry(yaw), so a city faces the viewer at
//   yaw = -lon, pitch = lat   (checked in NOTES.md).
function toVec(lat, lon, r, out = new THREE.Vector3()) {
  const la = THREE.MathUtils.degToRad(lat);
  const lo = THREE.MathUtils.degToRad(lon);
  return out.set(r * Math.cos(la) * Math.sin(lo), r * Math.sin(la), r * Math.cos(la) * Math.cos(lo));
}

// Even-odd point-in-polygon, on [lon, lat] pairs in degrees.
function inPolygon(lon, lat, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const C_OCEAN = new THREE.Color(0x1c5b8f);
const C_LAND = new THREE.Color(0x4f7f3c);
const C_DRY = new THREE.Color(0xa88f5a);
const C_ICE = new THREE.Color(0xe9f1f8);

// A gentle, deterministic shade so the surface is not a flat fill. Smooth on purpose: per-vertex
// noise would look like grain at this size.
const shade = (lat, lon) => 0.93 + 0.07 * Math.sin(lat * 0.13 + 1.1) * Math.cos(lon * 0.06);

function surfaceColour(lat, lon, out) {
  if (Math.abs(lat) > 74 || lat < -66) return out.copy(C_ICE);
  if (!LANDMASSES.some((poly) => inPolygon(lon, lat, poly))) return out.copy(C_OCEAN).multiplyScalar(shade(lat, lon));
  const arid = DESERTS.some(([a, b, c, d]) => lon >= a && lon <= b && lat >= c && lat <= d);
  return out.copy(arid ? C_DRY : C_LAND).multiplyScalar(shade(lat, lon));
}

// ---- scene content ----------------------------------------------------------------------------
// Radius 1 model unit. SceneViewer.fitTo scales it into the tile.
const globeGeo = new THREE.SphereGeometry(1, 144, 96);
{
  // Colour each vertex from its latitude and longitude. SphereGeometry's vertices lie on the
  // same convention as toVec, so atan2(x, z) recovers the longitude the markers use.
  const pos = globeGeo.attributes.position;
  const colours = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const lat = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(pos.getY(i), -1, 1)));
    const lon = THREE.MathUtils.radToDeg(Math.atan2(pos.getX(i), pos.getZ(i)));
    surfaceColour(lat, lon, c);
    colours.set([c.r, c.g, c.b], i * 3);
  }
  globeGeo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
}
const globe = new THREE.Mesh(
  globeGeo,
  new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 }),
);

// Invisible hit targets. The proxy is the globe's silhouette, so a marker on the far side is
// hidden behind it. Each marker gets a hit sphere wider than the drawn dot, so a click does not
// have to land on a few pixels of it. Materials with visible:false are skipped by the renderer
// but still raycast.
const hitMaterial = new THREE.MeshBasicMaterial({ visible: false });
const pickGroup = new THREE.Group();
pickGroup.add(new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), hitMaterial));

const markerGroup = new THREE.Group();
const markerGeo = new THREE.SphereGeometry(0.07, 24, 16);
const markerMat = new THREE.MeshStandardMaterial({ color: 0xffb703, emissive: 0x4a2c00, roughness: 0.35 });
const markerSelMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x3a3a3a, roughness: 0.35 });
const hitGeo = new THREE.SphereGeometry(0.16, 12, 8);

const markers = new Map(); // id -> { mesh, city }
for (const city of CITIES) {
  const mesh = new THREE.Mesh(markerGeo, markerMat);
  mesh.position.copy(toVec(city.lat, city.lon, 1.03));
  mesh.userData.city = city.id;
  markerGroup.add(mesh);

  const hit = new THREE.Mesh(hitGeo, hitMaterial);
  hit.position.copy(toVec(city.lat, city.lon, 1));
  hit.userData.city = city.id;
  pickGroup.add(hit);

  markers.set(city.id, { mesh, city });
}

// ---- viewer -----------------------------------------------------------------------------------
const viewer = new SceneViewer(THREE, canvas, {
  virtualDisplayHeight: VIRTUAL_DISPLAY_HEIGHT,
  fit: 'contain',
  margin: FILL,
  // A sphere's silhouette does not change as it turns, so sizing against the diagonal (the
  // default, for a long subject) would only shrink the globe for nothing.
  fitSweep: false,
  idleSpin: IDLE_SPIN_DEG_S,
  pitchLimit: [-60, 60],
});
viewer.useEyeCamera(EyeCamera);
viewer.renderer.setClearColor(BG, 1);
viewer.content.add(globe, pickGroup, markerGroup);
// The globe is centred on the zero-disparity plane (SceneViewer's default). The SDK's notes say a
// version that slid the subject behind the glass read worse on hardware, so there is no offset.
viewer.fitTo([0, 0, 0], [2, 2, 2]);

// Lights sit in the scene, not the content, so the globe turns under a fixed sun.
viewer.scene.add(new THREE.HemisphereLight(0xdde9ff, 0x0b1220, 1.0));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(1.2, 0.8, 1.6);
viewer.scene.add(sun);

// The SDK's depth cursor: on the glass it is the OS cursor, and over the part of the globe that
// comes out of the glass it rises to the surface, so it never sits behind what it points at.
viewer.useDepthCursor(DepthCursor, () => raycastHitTest(THREE, [pickGroup]));

// ---- picking ----------------------------------------------------------------------------------
// The mono camera frames the subject the way the flat view does, and the stereo view's
// perspective is close enough for a click target this size. Picking uses the same meshes the
// depth cursor uses.
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function pickCity(clientX, clientY) {
  const box = canvas.getBoundingClientRect();
  ndc.set(((clientX - box.left) / box.width) * 2 - 1, 1 - ((clientY - box.top) / box.height) * 2);
  viewer.scene.updateMatrixWorld(true);
  viewer.monoCamera.updateMatrixWorld(true);
  raycaster.setFromCamera(ndc, viewer.monoCamera);
  const hit = raycaster.intersectObjects(pickGroup.children, false)[0];
  return hit?.object.userData.city ?? null;
}

// A click is a press and release that did not move far or last long. Anything else is an orbit
// drag, which SceneViewer handles.
let press = null;
canvas.addEventListener('pointerdown', (e) => {
  press = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
  anim = null; // a grab cancels a turn in progress
});
canvas.addEventListener('pointerup', (e) => {
  if (!press || e.pointerId !== press.id) return;
  const moved = Math.hypot(e.clientX - press.x, e.clientY - press.y);
  const quick = performance.now() - press.t < 400;
  press = null;
  if (moved > 6 || !quick) return;
  const id = pickCity(e.clientX, e.clientY);
  if (id) select(id);
});
canvas.addEventListener('pointercancel', () => {
  press = null;
});

// ---- turning to a city ------------------------------------------------------------------------
// Eased on the viewer's tick with setPose, which writes the target and the value together, so the
// viewer's own easing has nothing left to chase.
let anim = null;
function faceCity(city) {
  const pose = viewer.getPose();
  const d = -city.lon - pose.yaw; // the yaw that brings this city to the front, minus where we are
  const dYaw = ((((d % 360) + 540) % 360) - 180); // shortest way round
  anim = {
    yaw0: pose.yaw,
    dYaw,
    pitch0: pose.pitch,
    pitch1: city.lat,
    t0: performance.now(),
    dur: reduceMotion ? 0 : 900,
  };
}
viewer.onTick = () => {
  if (!anim) return;
  const t = anim.dur ? Math.min(1, (performance.now() - anim.t0) / anim.dur) : 1;
  const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; // ease in-out cubic
  viewer.setPose({
    yaw: anim.yaw0 + anim.dYaw * e,
    pitch: anim.pitch0 + (anim.pitch1 - anim.pitch0) * e,
  });
  if (t >= 1) anim = null;
};

// ---- selection and the info panel -------------------------------------------------------------
const cityButtons = new Map(); // id -> button
for (const city of CITIES) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'city';
  btn.setAttribute('aria-pressed', 'false');
  btn.innerHTML = `<span>${city.name}</span><span class="muted">${city.country}</span>`;
  btn.addEventListener('click', () => select(city.id));
  cityList.appendChild(btn);
  cityButtons.set(city.id, btn);
}

function select(id) {
  const { city } = markers.get(id);
  for (const [cid, m] of markers) {
    const on = cid === id;
    m.mesh.material = on ? markerSelMat : markerMat;
    m.mesh.scale.setScalar(on ? 1.5 : 1);
  }
  for (const [cid, btn] of cityButtons) btn.setAttribute('aria-pressed', String(cid === id));

  nameEl.textContent = city.name;
  countryEl.textContent = city.country;
  popEl.textContent = city.population;
  basisEl.textContent = city.basis;
  hintEl.hidden = true;
  detailEl.hidden = false;

  viewer.idleSpin = 0; // stop the turntable while someone is looking at a city
  faceCity(city);
}

function clearSelection() {
  for (const m of markers.values()) {
    m.mesh.material = markerMat;
    m.mesh.scale.setScalar(1);
  }
  for (const btn of cityButtons.values()) btn.setAttribute('aria-pressed', 'false');
  detailEl.hidden = true;
  hintEl.hidden = false;
  viewer.idleSpin = IDLE_SPIN_DEG_S;
}

clearBtn.addEventListener('click', clearSelection);
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') clearSelection();
});

// ---- boot -------------------------------------------------------------------------------------
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
const setStatus = (text) => {
  statusEl.textContent = text;
};

(async () => {
  const wall = await createInline3D({ lazy: false });
  if (!wall.supported) {
    // No inline-3D session here: the same globe, flat. No poster is needed.
    viewer.startMono();
    poster.hidden = true;
    setStatus('2D view. Open this page in the DisplayXR Browser on a DisplayXR display for glasses-free 3D. Drag to spin.');
    return;
  }

  // The canvas is fresh to the compositor. Let it commit a frame before it joins the weave.
  await nextFrame();
  await nextFrame();
  const handle = wall.addScene(canvas, viewer.onFrame, {
    virtualDisplayHeight: VIRTUAL_DISPLAY_HEIGHT,
    onLayerLost: viewer.onLayerLost, // if the session ends, go flat rather than show raw SBS
  });
  // Cut the poster away once the browser has woven a real stereo frame. Never fade it, and never
  // a timer of our own.
  handle.firstWoven.then((result) => {
    poster.hidden = true;
    setStatus(result.woven
      ? '3D. Drag the globe to spin, or click a marker.'
      : '2D view. Drag the globe to spin, or click a marker.');
  });
})();
