// Spinnable 3D globe with five city markers and an HTML info panel.
//
// RIG (guide §1): the visitor turns an OBJECT → DISPLAY rig, framed by SceneViewer + displayRig().
// SCREEN PLANE (§2): the globe is pushed back (depthOffset) so its visible front hemisphere spans
//   from just in front of the glass to behind it.
// DEPTH (§3), tile heights h (16:9 tile; comfortable = 0.1 h front / 0.27 h behind):
//   globe radius R = 0.28 h, centre at −0.19 h  →  nearest point (+ marker tips) ≈ +0.09 h,
//   limb (farthest VISIBLE surface; the far hemisphere is hidden) ≈ −0.19 h. Inside the table.
//   The viewer's own depthFit would budget the whole sphere (incl. the hidden half) and shrink
//   the globe to ~65 %, so the size/offset are set by hand: `margin` = 2R/h, `depthOffset`.
// 2D UI (§4, §6): every word of text is HTML OUTSIDE the tile; nothing is drawn over the canvas
//   except the cover. No filter / opacity / backdrop-filter / animated transform near the canvas.

import * as THREE from 'three';
import { createInline3D } from '@displayxr/inline3d';
import { EyeCamera, displayRig } from '@displayxr/inline3d/three';
import { SceneViewer } from '@displayxr/inline3d/viewer';

const canvas = document.getElementById('globe');
const cover = document.getElementById('cover');
const depth = document.getElementById('depth');
const modeBtn = document.getElementById('mode');
const modeNote = document.getElementById('modeNote');
const spinBtn = document.getElementById('spin');
const info = document.getElementById('info');
const list = document.getElementById('cities');

const VDH = 0.24;                 // virtual display height, metres — same on addScene
const R_H = 0.28;                 // globe radius in tile heights
const CENTRE_H = -0.19;           // globe centre in tile heights (− = behind the glass)
const NOMINAL_VIEWER = 0.6;       // metres; only for the click hit-test's perspective correction
const BG = '#101a33';             // == page colour (index.html)

const CITIES = [
  { name: 'London',   lat: 51.51,  lon: -0.13,  pop: 8_980_000,  note: 'United Kingdom' },
  { name: 'Tokyo',    lat: 35.68,  lon: 139.69, pop: 13_960_000, note: 'Japan' },
  { name: 'New York', lat: 40.71,  lon: -74.01, pop: 8_340_000,  note: 'United States' },
  { name: 'Sydney',   lat: -33.87, lon: 151.21, pop: 5_310_000,  note: 'Australia' },
  { name: 'Nairobi',  lat: -1.29,  lon: 36.82,  pop: 4_400_000,  note: 'Kenya' },
];

// ---- procedural Earth texture ----------------------------------------------------------------
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x, y) => { let s = 0, a = 0.5; for (let i = 0; i < 5; i++) { s += a * vnoise(x, y); x *= 2.03; y *= 2.03; a *= 0.5; } return s; };

// Coarse continent outlines [lon, lat]; edges are subdivided and jittered for a natural coast.
const LAND = [
  // North America
  [[-168,66],[-162,70],[-141,70],[-125,70],[-110,73],[-95,72],[-85,70],[-80,63],[-93,58],[-86,55],[-80,52],[-78,62],[-70,60],[-62,58],[-56,52],[-60,47],[-66,45],[-70,42],[-74,40],[-76,35],[-81,31],[-80,25],[-83,29],[-90,30],[-97,27],[-97,22],[-94,18],[-90,21],[-87,21],[-88,16],[-84,15],[-83,10],[-77,8],[-80,7],[-86,11],[-92,14],[-100,17],[-106,22],[-112,29],[-115,31],[-117,33],[-121,35],[-124,40],[-124,47],[-130,54],[-140,60],[-150,60],[-158,57],[-165,60]],
  // South America
  [[-77,8],[-72,12],[-62,10],[-52,5],[-50,0],[-35,-6],[-39,-14],[-41,-22],[-48,-26],[-54,-34],[-58,-38],[-65,-41],[-66,-47],[-69,-52],[-68,-55],[-74,-52],[-74,-40],[-71,-30],[-70,-18],[-76,-14],[-81,-5],[-80,0],[-78,3]],
  // Eurasia
  [[-10,36],[-9,43],[-1,46],[-4,48],[2,51],[8,54],[10,58],[5,62],[15,69],[28,71],[40,67],[60,69],[80,73],[105,77],[130,72],[160,70],[180,68],[180,65],[165,60],[156,51],[143,52],[141,46],[135,43],[129,35],[126,38],[122,40],[121,31],[117,23],[108,21],[106,10],[100,13],[100,2],[104,1],[98,8],[93,19],[88,22],[80,15],[77,8],[73,17],[67,25],[57,25],[56,27],[49,30],[51,24],[56,24],[59,22],[52,16],[43,13],[35,28],[34,31],[36,36],[27,37],[26,40],[23,38],[19,40],[12,44],[16,38],[9,44],[3,43],[-5,36]],
  // Africa
  [[-17,21],[-10,30],[-6,36],[10,37],[11,33],[20,31],[32,31],[35,28],[43,12],[51,12],[40,-2],[40,-15],[35,-25],[27,-34],[19,-35],[15,-26],[12,-6],[9,4],[-8,4],[-17,14]],
  // Australia
  [[114,-22],[122,-18],[130,-12],[137,-12],[136,-15],[142,-11],[146,-19],[153,-26],[150,-37],[141,-38],[135,-35],[129,-32],[115,-34],[113,-26]],
  // Greenland
  [[-55,60],[-45,60],[-20,70],[-18,80],[-40,83],[-65,80],[-70,77],[-55,70]],
  // Antarctica
  [[-180,-72],[-120,-74],[-60,-68],[0,-70],[60,-67],[120,-66],[180,-72],[180,-90],[-180,-90]],
  // Japan, UK, Ireland, Madagascar, New Zealand, Indonesia
  [[130,31],[132,34],[136,36.5],[140,41],[141.5,45],[145,43.5],[142,38],[141,35],[137,34],[133,33],[131,31]],
  [[-5,50],[1,51],[2,53],[-2,56],[-3,58.5],[-6,58],[-5,55],[-3,54],[-5,52]],
  [[-10,52],[-6,52],[-6,55],[-10,54]],
  [[44,-25],[47,-25],[50,-15],[49,-12],[44,-17]],
  [[172,-41],[175,-37],[178,-38],[174,-42],[170,-46],[167,-46]],
  [[95,5],[104,-3],[106,-6],[101,-3],[96,2]],
  [[109,1],[117,7],[119,1],[116,-4],[110,-3]],
  [[106,-6],[114,-7],[114,-8.5],[106,-7.5]],
  [[131,-1],[141,-3],[150,-10],[141,-9],[132,-4]],
];

function makeEarthTexture() {
  const W = 2048, H = 1024;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const px = (lon) => ((lon + 180) / 360) * W;
  const py = (lat) => ((90 - lat) / 180) * H;

  // Land mask drawn white on black.
  const m = document.createElement('canvas');
  m.width = W; m.height = H;
  const mg = m.getContext('2d');
  mg.fillStyle = '#000'; mg.fillRect(0, 0, W, H);
  mg.fillStyle = '#fff';
  for (const poly of LAND) {
    mg.beginPath();
    const n = poly.length;
    let first = true;
    for (let i = 0; i < n; i++) {
      const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % n];
      const steps = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 2));
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        const lon = x0 + (x1 - x0) * t, lat = y0 + (y1 - y0) * t;
        const jx = (fbm(lon * 0.9 + 40, lat * 0.9) - 0.5) * 5;
        const jy = (fbm(lon * 0.9, lat * 0.9 + 90) - 0.5) * 5;
        const X = px(lon + jx), Y = py(lat + jy);
        if (first) { mg.moveTo(X, Y); first = false; } else mg.lineTo(X, Y);
      }
    }
    mg.closePath();
    mg.fill();
  }
  const mask = mg.getImageData(0, 0, W, H).data;

  const img = g.createImageData(W, H);
  const d = img.data;
  for (let y = 0; y < H; y++) {
    const lat = 90 - (y / H) * 180;
    const alat = Math.abs(lat);
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const nx = x / 60, ny = y / 60;
      const detail = fbm(nx * 3, ny * 3);              // fine grain: gives stereo matching texture
      let r, gg, b;
      if (mask[i] > 127) {
        const dry = fbm(nx * 0.7 + 10, ny * 0.7);       // desert vs. forest
        const arid = Math.max(0, 1 - Math.abs(alat - 25) / 14) * (0.6 + dry * 0.7);
        const t = Math.min(1, arid * 0.9);
        r = 70 + 150 * t + (detail - 0.5) * 60;
        gg = 125 + 30 * t + (detail - 0.5) * 60;
        b = 60 + 20 * t + (detail - 0.5) * 40;
        if (alat > 52) { const k = Math.min(1, (alat - 52) / 25); r += (205 - r) * k * 0.6; gg += (210 - gg) * k * 0.6; b += (210 - b) * k * 0.6; }
        if (alat > 68) { r = 235 + detail * 15; gg = 240 + detail * 10; b = 245; }
      } else {
        const sea = 0.5 + 0.5 * fbm(nx * 1.2 + 50, ny * 1.2);
        r = 14 + 14 * sea + (detail - 0.5) * 12;
        gg = 55 + 40 * sea + (detail - 0.5) * 14;
        b = 120 + 55 * sea + (detail - 0.5) * 16;
        if (alat > 74) { r += 110; gg += 110; b += 70; }
      }
      d[i] = r; d[i + 1] = gg; d[i + 2] = b; d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);

  // Faint graticule: reads the rotation even over open ocean.
  g.strokeStyle = 'rgba(255,255,255,0.13)'; g.lineWidth = 1.5;
  for (let lon = -180; lon <= 180; lon += 30) { g.beginPath(); g.moveTo(px(lon), 0); g.lineTo(px(lon), H); g.stroke(); }
  for (let lat = -60; lat <= 60; lat += 30) { g.beginPath(); g.moveTo(0, py(lat)); g.lineTo(W, py(lat)); g.stroke(); }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// ---- scene -----------------------------------------------------------------------------------
const viewer = new SceneViewer(THREE, canvas, {
  virtualDisplayHeight: VDH,
  clearColor: BG,                       // OPAQUE clear
  fit: 'height',
  margin: 2 * R_H,                      // globe diameter = 0.56 of the tile height
  fitSweep: false,                      // a sphere's footprint does not change with yaw
  orbit: false,                         // own drag-to-spin below (click vs drag, ease-to-city)
}).useEyeCamera(EyeCamera);

const tilt = new THREE.Group();         // axis tilt / pitch (about X)
const spin = new THREE.Group();         // yaw (about Y)
tilt.add(spin);
viewer.content.add(tilt);

const earth = new THREE.Mesh(
  new THREE.SphereGeometry(1, 96, 64),
  new THREE.MeshStandardMaterial({ map: makeEarthTexture(), roughness: 0.9, metalness: 0 }), // rough: no hot glints
);
spin.add(earth);

const markerGeo = new THREE.SphereGeometry(0.03, 20, 14);
const markers = CITIES.map((c) => {
  const la = THREE.MathUtils.degToRad(c.lat), lo = THREE.MathUtils.degToRad(c.lon);
  // three's SphereGeometry puts lon 0 on +X, lon 90°E on −Z.
  const n = new THREE.Vector3(Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo));
  const mesh = new THREE.Mesh(markerGeo, new THREE.MeshStandardMaterial({ color: 0xff8a1f, emissive: 0x7a2a00, roughness: 0.6 }));
  mesh.position.copy(n).multiplyScalar(1.015);
  spin.add(mesh);
  return { city: c, mesh, normal: n };
});

const sun = new THREE.DirectionalLight(0xffffff, 2.4);
sun.position.set(-2, 2.5, 4);
viewer.scene.add(sun, new THREE.HemisphereLight(0xcfdcff, 0x1a2036, 1.0));

// Pose: yaw ψ puts longitude L on the viewer when ψ = −90 − L (degrees).
const lonToYaw = (L) => -90 - L;
let yaw = lonToYaw(10), pitch = 18, tYaw = yaw, tPitch = pitch;
let autoSpin = true, lastInput = -1e9, selected = null;
const apply = () => { spin.rotation.y = THREE.MathUtils.degToRad(yaw); tilt.rotation.x = THREE.MathUtils.degToRad(pitch); };
apply();

viewer.depthOffset = CENTRE_H * VDH;
viewer.fitTo([0, 0, 0], [2, 2, 2]);

let lastT = performance.now();
viewer.onTick = () => {
  const t = performance.now(), dt = Math.min(0.1, (t - lastT) / 1000);
  lastT = t;
  if (autoSpin && !selected && t - lastInput > 3000 && !drag) tYaw += 7 * dt;
  const k = 1 - Math.exp(-dt * 7);
  yaw += (tYaw - yaw) * k;
  pitch += (tPitch - pitch) * k;
  apply();
  markers.forEach((m) => {
    const sel = m.city === selected;
    m.mesh.scale.setScalar(sel ? 1.5 : 1);
    m.mesh.material.color.setHex(sel ? 0xfff0a0 : 0xff8a1f);
  });
};

// ---- picking: project marker positions to canvas px ---------------------------------------------
const tmp = new THREE.Vector3(), centreW = new THREE.Vector3();
function screenOf(m) {
  viewer.scene.updateMatrixWorld();
  m.mesh.getWorldPosition(tmp);
  earth.getWorldPosition(centreW);
  const nz = tmp.clone().sub(centreW).normalize().z;        // facing the viewer?
  const box = canvas.getBoundingClientRect();
  let x, y;
  if (viewer.is3D) {
    const f = NOMINAL_VIEWER / Math.max(0.05, NOMINAL_VIEWER - tmp.z);
    const vW = VDH * (box.width / box.height);
    x = (tmp.x * f / vW + 0.5) * box.width;
    y = (0.5 - tmp.y * f / VDH) * box.height;
  } else {
    const p = tmp.clone().project(viewer.monoCamera);
    x = (p.x * 0.5 + 0.5) * box.width;
    y = (0.5 - p.y * 0.5) * box.height;
  }
  return { x, y, visible: nz > 0.12 };
}
function pick(ev) {
  const box = canvas.getBoundingClientRect();
  const px = ev.clientX - box.left, py = ev.clientY - box.top;
  const reach = Math.max(18, box.height * 0.045);
  let best = null, bd = reach;
  for (const m of markers) {
    const s = screenOf(m);
    if (!s.visible) continue;
    const dd = Math.hypot(s.x - px, s.y - py);
    if (dd < bd) { bd = dd; best = m.city; }
  }
  return best;
}

// ---- drag to spin / click to select ------------------------------------------------------------
let drag = null;
canvas.addEventListener('pointerdown', (ev) => {
  drag = { x: ev.clientX, y: ev.clientY, sx: ev.clientX, sy: ev.clientY, moved: false };
  lastInput = performance.now();
  canvas.setPointerCapture(ev.pointerId);
});
canvas.addEventListener('pointermove', (ev) => {
  if (!drag) { canvas.classList.toggle('hot', !!pick(ev)); return; }
  const box = canvas.getBoundingClientRect();
  if (Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy) > 5) { drag.moved = true; canvas.classList.add('dragging'); }
  if (drag.moved) {
    // The face under the cursor follows it (a full tile-width drag = a half turn).
    tYaw += ((ev.clientX - drag.x) / box.width) * 180;
    tPitch = Math.max(-60, Math.min(60, tPitch + ((ev.clientY - drag.y) / box.height) * 180));
    selected = null;  // spinning by hand lets go of any "centre on city" lock
  }
  drag.x = ev.clientX; drag.y = ev.clientY;
  lastInput = performance.now();
});
const end = (ev) => {
  if (!drag) return;
  const wasClick = !drag.moved;
  drag = null;
  canvas.classList.remove('dragging');
  lastInput = performance.now();
  if (wasClick && ev.type === 'pointerup') {
    const c = pick(ev);
    if (c) select(c);
  }
};
canvas.addEventListener('pointerup', end);
canvas.addEventListener('pointercancel', end);

// ---- info panel + city list --------------------------------------------------------------------
const fmt = new Intl.NumberFormat('en-US');
function show(c) {
  info.replaceChildren();
  const mk = (tag, cls, text) => { const e = document.createElement(tag); e.className = cls; e.textContent = text; info.append(e); };
  mk('p', 'name', c.name);
  mk('p', 'pop', `Population ${fmt.format(c.pop)}`);
  mk('p', 'meta', `${c.note} · ${Math.abs(c.lat).toFixed(1)}°${c.lat < 0 ? 'S' : 'N'}, ${Math.abs(c.lon).toFixed(1)}°${c.lon < 0 ? 'W' : 'E'} · city proper, approx.`);
}
const buttons = CITIES.map((c) => {
  const li = document.createElement('li');
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = c.name;
  b.setAttribute('aria-pressed', 'false');
  b.addEventListener('click', () => select(c));
  li.append(b); list.append(li);
  return b;
});
function select(c) {
  selected = c;
  show(c);
  buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(CITIES[i] === c)));
  // Ease the globe so the city faces the viewer (nearest equivalent turn, no long way round).
  const want = lonToYaw(c.lon);
  tYaw += ((((want - tYaw) % 360) + 540) % 360) - 180;
  tPitch = Math.max(-40, Math.min(40, c.lat * 0.8));
}
spinBtn.addEventListener('click', () => {
  autoSpin = !autoSpin;
  spinBtn.textContent = `Auto-rotate: ${autoSpin ? 'on' : 'off'}`;
  spinBtn.setAttribute('aria-pressed', String(autoSpin));
});

// ---- boot --------------------------------------------------------------------------------------
const wall = await createInline3D({ lazy: false });
if (!wall.supported) {
  // An ordinary browser: the same page, flat.
  viewer.startMono();
  cover.remove();
  depth.disabled = modeBtn.disabled = true;
  modeBtn.textContent = '2D';
  modeNote.textContent = 'Open this page in the DisplayXR Browser on a 3D display to see it in 3D.';
} else {
  const rig = (k) => displayRig({ virtualDisplayHeight: VDH, ipdFactor: k, parallaxFactor: k });
  const handle = wall.addScene(canvas, viewer.onFrame, { viewRig: rig(1), onLayerLost: viewer.onLayerLost });
  wall.session.updateRenderState({ depthNear: 0.01, depthFar: 20 });

  // ONE slider value moves BOTH factors (never scale.z).
  depth.addEventListener('input', () => handle.setViewRig(rig(Number(depth.value))));

  let flat = false;
  const label = () => { modeBtn.textContent = flat ? 'Show in 3D' : 'Show in 2D'; };
  handle.on('renderingmodechange', (e) => { if (e.viewCount) { flat = e.viewCount === 1; label(); } });
  modeBtn.addEventListener('click', () => {
    handle.setStereoEnabled(flat).catch(() => {   // no flat mode: depth 0 is flat everywhere
      flat = !flat;
      depth.value = flat ? 0 : 1;
      handle.setViewRig(rig(Number(depth.value)));
      label();
    });
  });
  label();
  await handle.firstWoven;   // cover until the first woven frame
  cover.remove();            // cut, never fade
}
