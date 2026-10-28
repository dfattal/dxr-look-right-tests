// A 3D globe with five city markers, on a DISPLAY rig (the user turns an object; nobody walks
// through it). Clicking a marker shows the city and its population in an HTML panel beside the
// canvas. Rules: /sdk/docs/making-3d-look-right.md. Notes and the reasoning per setting: NOTES.md.
//
// RIG: a display rig, drawn by SceneViewer. The canvas is a portal onto a virtual display VDH
// metres tall; the viewer fits the globe into it and centres it on the glass.
//
// SCREEN PLANE (§2): the globe is the subject, so it sits on the glass, nudged back by
// depthOffset so the cheaper "behind" budget is used as well as the "in front" one.
//
// DEPTH (§3, 16:9 comfortable column): FRONT 0.1 h in front, BACK 0.27 h behind. The globe is a
// sphere, but its markers stick out radially, so the fit budgets the bounding sphere of globe and
// pins (RB), and fitSweep makes that hold at every spin angle.
//
// PICKING: the SDK has no click API. Each frame we keep copies of the eye views (an XRView is only
// valid inside its own frame callback), and a click builds one ray per eye with cursorViewRay (the
// same maths DepthCursor uses). The nearest hit along a ray wins, so a marker behind the globe is
// occluded. Each marker has an invisible pick proxy, so a small pin is still easy to hit.

import * as THREE from 'three';
import { createInline3D } from '@displayxr/inline3d';
import { EyeCamera, displayRig } from '@displayxr/inline3d/three';
import { SceneViewer } from '@displayxr/inline3d/viewer';
import { cursorViewRay } from '@displayxr/inline3d/cursor-depth';
import { makeEarthCanvas } from './earth-texture.js';

const canvas = document.getElementById('globe');
const cover = document.getElementById('cover');

const VDH = 0.24;                       // virtual display height, metres (passed to addScene too)
const FRONT = 0.1, BACK = 0.27;         // depth budget, tile heights (16:9, comfortable column)
const BG = '#0b1220';                   // == the page colour behind the canvas (index.html)
const START_LON = -10;                  // the longitude that faces the viewer when the page opens

const GLOBE_R = 1;                      // model units; fitTo sizes the whole thing
const PIN_LIFT = 0.08;                  // stalk length, model units
const HEAD_R = 0.06;                    // marker head radius
const RB = GLOBE_R + PIN_LIFT + 2 * HEAD_R; // bounding radius of globe + pins (1.20)

const PIN = '#ffb84d', PIN_SELECTED = '#ffffff';

// Population figures are approximate, from memory (no live data), and the year is as noted.
const CITIES = [
  { id: 'london', name: 'London', lat: 51.51, lon: -0.13, population: '8.9 million', note: 'Greater London, 2023 estimate' },
  { id: 'tokyo', name: 'Tokyo', lat: 35.68, lon: 139.69, population: '14 million', note: 'Tokyo Metropolis, 2024 estimate' },
  { id: 'new-york', name: 'New York', lat: 40.71, lon: -74.01, population: '8.3 million', note: 'New York City, 2023 estimate' },
  { id: 'sydney', name: 'Sydney', lat: -33.87, lon: 151.21, population: '5.4 million', note: 'Greater Sydney, 2023 estimate' },
  { id: 'nairobi', name: 'Nairobi', lat: -1.29, lon: 36.82, population: '4.4 million', note: 'Nairobi, 2019 census' },
];

// ---- scene ----------------------------------------------------------------------------------------
const viewer = new SceneViewer(THREE, canvas, {
  virtualDisplayHeight: VDH,
  clearColor: BG,                       // OPAQUE clear: alpha-0 pixels weave as stale/black
  depthFit: { front: FRONT, back: BACK },
  fitSweep: true,                       // the globe turns: budget its depth at every yaw
  orbit: true,                          // drag to spin, wheel to zoom
  idleSpin: 6,                          // deg/s when left alone (the viewer ignores it under reduced motion)
  // no `feather`: it fades to transparent, which needs an alpha clear (guide §5)
}).useEyeCamera(EyeCamera);

viewer.scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x1a2233, 1.1));
const sun = new THREE.DirectionalLight(0xfff4e6, 1.8);
sun.position.set(1.5, 1, 2.5);
viewer.scene.add(sun);

// The globe. `earth` carries the spin and the start longitude; the markers hang off it.
const globe = new THREE.Group();
viewer.content.add(globe);
const earth = new THREE.Group();
// Yaw a brings longitude λ to the viewer's side when a = -90° - λ (the direction (cos λ, 0, -sin λ)
// rotates to (0, 0, 1)). Checked by hand against SphereGeometry's UVs (see NOTES.md).
earth.rotation.y = THREE.MathUtils.degToRad(-(90 + START_LON));
globe.add(earth);

const map = new THREE.CanvasTexture(makeEarthCanvas());
map.colorSpace = THREE.SRGBColorSpace;
map.anisotropy = 8;
const earthMesh = new THREE.Mesh(
  new THREE.SphereGeometry(GLOBE_R, 96, 64),
  new THREE.MeshStandardMaterial({ map, roughness: 0.9, metalness: 0 }), // matte: no glints to ghost
);
earth.add(earthMesh);

// (lat, lon) in degrees → the unit normal of the globe at that point. This is the same mapping as
// SphereGeometry's UVs with the canvas above: u = (lon + 180) / 360, v from latitude.
function latLonToNormal(latDeg, lonDeg) {
  const la = THREE.MathUtils.degToRad(latDeg), lo = THREE.MathUtils.degToRad(lonDeg);
  return new THREE.Vector3(Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo));
}

// Markers: a stalk standing on the surface, and a head on top. Each has an invisible pick proxy,
// hit-testable but not drawn (colorWrite and depthWrite off), so a click on the small head works.
const UP = new THREE.Vector3(0, 1, 0);
const stalkGeo = new THREE.CylinderGeometry(0.018, 0.018, PIN_LIFT, 10);
const headGeo = new THREE.SphereGeometry(HEAD_R, 20, 14);
const pickGeo = new THREE.SphereGeometry(0.12, 12, 8);
const pickMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
const stalkMat = new THREE.MeshStandardMaterial({ color: '#e8edf5', roughness: 0.6 });
const pickables = [];
for (const city of CITIES) {
  const n = latLonToNormal(city.lat, city.lon);
  const pin = new THREE.Group();
  pin.position.copy(n).multiplyScalar(GLOBE_R);
  pin.quaternion.setFromUnitVectors(UP, n);     // the pin's +Y points out of the globe
  const stalk = new THREE.Mesh(stalkGeo, stalkMat);
  stalk.position.y = PIN_LIFT / 2;
  const head = new THREE.Mesh(
    headGeo,
    new THREE.MeshStandardMaterial({ color: PIN, emissive: PIN, emissiveIntensity: 0.35, roughness: 0.5 }),
  );
  head.position.y = PIN_LIFT + HEAD_R;
  const pick = new THREE.Mesh(pickGeo, pickMat);
  pick.position.y = PIN_LIFT + HEAD_R;
  pick.userData.city = city.id;
  pin.add(stalk, head, pick);
  earth.add(pin);
  city.head = head;
  pickables.push(pick);
}

// ---- framing and depth ------------------------------------------------------------------------------
// The budget is "behind" and "in front" of the glass in tile heights, so the glass sits between the
// two. Centring on the glass would use only the front budget, so the globe is set back by half the
// difference: its front reaches FRONT and its back reaches BACK.
viewer.depthOffset = -((BACK - FRONT) / 2) * VDH;
// depthFit budgets hypot(x, z)/2 (the swept half-width) when fitSweep is on. Passing √2·RB for x
// and z makes that hypot equal RB, so the budget covers the bounding sphere at every spin angle.
// The size fit (y) is 2·RB tall; depthFit then shrinks it uniformly to the budget.
const EXT = Math.SQRT2 * RB;
viewer.fitTo({ x: 0, y: 0, z: 0 }, { x: EXT, y: 2 * RB, z: EXT });

// ---- selection --------------------------------------------------------------------------------------
const el = {
  name: document.getElementById('city-name'),
  pop: document.getElementById('city-pop'),
  note: document.getElementById('city-note'),
  clear: document.getElementById('clear'),
  depth: document.getElementById('depth'),
  mode: document.getElementById('mode'),
  modeNote: document.getElementById('modeNote'),
};
const cityButtons = document.querySelectorAll('[data-city]');
let selectedId = null;

function select(id) {
  selectedId = id;
  for (const city of CITIES) city.head.material.color.set(city.id === id ? PIN_SELECTED : PIN);
  const city = CITIES.find((c) => c.id === id);
  el.name.textContent = city ? city.name : 'Pick a city';
  el.pop.textContent = city
    ? `Population: about ${city.population}`
    : 'Click a marker on the globe, or choose a city below.';
  el.note.textContent = city ? city.note : '';
  el.clear.hidden = !city;
  for (const b of cityButtons) b.setAttribute('aria-pressed', String(b.dataset.city === id));
}
cityButtons.forEach((b) => b.addEventListener('click', () => select(b.dataset.city)));
el.clear.addEventListener('click', () => select(null));

// ---- picking ----------------------------------------------------------------------------------------
let eyes = null;   // copies of this frame's views: [{ projectionMatrix, transformMatrix }]
const raycaster = new THREE.Raycaster();
const pickTargets = [earthMesh, ...pickables];

// The city under a click at (clientX, clientY), or null. Each eye gives one ray; the nearest hit of
// a ray is what it sees, so a marker behind the globe is occluded by it.
function pickAt(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  const u = (clientX - r.left) / r.width, v = (clientY - r.top) / r.height;
  if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) return null;
  viewer.scene.updateMatrixWorld(true);

  const rays = [];
  if (eyes && eyes.length) {
    for (const e of eyes) {
      const { origin, direction } = cursorViewRay(e, u, v);
      rays.push([origin, direction]);
    }
  } else {
    // Ordinary browser: the viewer's one camera.
    viewer.monoCamera.updateMatrixWorld();
    raycaster.setFromCamera(new THREE.Vector2(2 * u - 1, 1 - 2 * v), viewer.monoCamera);
    rays.push([raycaster.ray.origin.toArray(), raycaster.ray.direction.toArray()]);
  }
  for (const [origin, direction] of rays) {
    raycaster.set(new THREE.Vector3(...origin), new THREE.Vector3(...direction).normalize());
    const hit = raycaster.intersectObjects(pickTargets, false)[0];
    if (hit && hit.object.userData.city) return hit.object.userData.city;
  }
  return null;
}

// A click is a press and release in place. A drag (more than a few px, or slow) is left to the
// viewer, which spins the globe.
let press = null;
canvas.addEventListener('pointerdown', (e) => {
  press = { x: e.clientX, y: e.clientY, t: performance.now() };
});
canvas.addEventListener('pointercancel', () => { press = null; });
canvas.addEventListener('pointerup', (e) => {
  const p = press;
  press = null;
  if (!p || e.button !== 0) return;
  if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 6 || performance.now() - p.t > 700) return;
  const id = pickAt(e.clientX, e.clientY);
  if (id) select(id);
});

// ---- depth slider: ONE value k moves BOTH factors, so the look-around shrinks with the depth -------
// On a display rig 1 = what the display does naturally; below 1 only makes it shallower.
const rig = (k) => displayRig({ virtualDisplayHeight: VDH, ipdFactor: k, parallaxFactor: k });

// ---- boot ---------------------------------------------------------------------------------------------
select(null);
const wall = await createInline3D({ lazy: false });
if (wall.supported) {
  const handle = wall.addScene(
    canvas,
    (views, layer, frame) => {
      // Keep the eye matrices of the frame being drawn, for the next click. Only copy when there
      // are views (an empty list keeps the last good copies).
      if (views.length) {
        eyes = views.map((v) => ({
          projectionMatrix: Array.from(v.projectionMatrix),
          transformMatrix: Array.from(v.transform.matrix),
        }));
      }
      viewer.onFrame(views, layer, frame);
    },
    { virtualDisplayHeight: VDH, onLayerLost: viewer.onLayerLost },
  );
  // Each eye's projection is built from the session's near and far planes: give it ours.
  wall.session.updateRenderState({ depthNear: 0.01, depthFar: 20 });

  el.depth.addEventListener('input', () => handle.setViewRig(rig(Number(el.depth.value))));

  // 2D/3D switch: ask the display for its flat mode, and show the state it REPORTS.
  let flat = false;   // what the display last reported, never what we asked for
  const showMode = () => {
    el.mode.textContent = flat ? 'Show in 3D' : 'Show in 2D';
    el.mode.setAttribute('aria-pressed', String(flat));
  };
  wall.on('renderingmodechange', (e) => {
    if (e.viewCount) { flat = e.viewCount === 1; showMode(); }
  });
  el.mode.addEventListener('click', () => {
    wall.setStereoEnabled(flat).catch(() => {
      // This display lists no flat mode (nothing changed): fall back to the slider, which gives a
      // flat image on any display.
      flat = !flat;
      el.depth.value = flat ? 0 : 1;
      el.depth.dispatchEvent(new Event('input'));
      showMode();
    });
  });
  showMode();

  await handle.firstWoven;   // keep the cover until the first woven frame
} else {
  // An ordinary browser: the same page, already flat. Keep the layout; say why the controls rest.
  viewer.startMono();
  el.mode.disabled = el.depth.disabled = true;
  el.mode.textContent = '2D';
  el.modeNote.textContent = 'Open this page in the DisplayXR Browser on a 3D display to see it in 3D.';
}
cover.remove();              // cut, never fade
