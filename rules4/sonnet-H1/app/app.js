import * as THREE from 'three';
import { createInline3D } from '@displayxr/inline3d';
import { EyeCamera, EdgeFeather } from '@displayxr/inline3d/three';
import { makeEarthCanvas } from './earth.js';

const canvas = document.getElementById('globe');
const coverEl = document.getElementById('cover');
const statusEl = document.getElementById('status');
const infoEl = document.getElementById('info');
const citiesEl = document.getElementById('cities');

const CITIES = [
  { name: 'London',   country: 'United Kingdom', lat: 51.51,  lon: -0.13,   pop: 8800000 },
  { name: 'Tokyo',    country: 'Japan',          lat: 35.68,  lon: 139.69,  pop: 14000000 },
  { name: 'New York', country: 'United States',  lat: 40.71,  lon: -74.01,  pop: 8260000 },
  { name: 'Sydney',   country: 'Australia',      lat: -33.87, lon: 151.21,  pop: 5300000 },
  { name: 'Nairobi',  country: 'Kenya',          lat: -1.29,  lon: 36.82,   pop: 4400000 },
];

// ---- scene ----------------------------------------------------------------------------------
// Authored in metres for a 0.12 m-tall virtual display (the addScene virtualDisplayHeight below).
// The globe is centred on z = 0, the zero-disparity plane, so it straddles the glass: the smallest
// disparity spread an object of this size can have. Do not push it back or shrink it for "comfort".
const R = 0.036;           // globe radius: diameter = 60% of the window height
const STEM = 0.008;        // marker stem height above the surface

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setClearColor(0x000000, 0);   // transparent: edges feather into the dark-grey page
renderer.setPixelRatio(1);             // getViewport() is in backing-store px; see sizeToCanvas
renderer.autoClear = false;

const scene = new THREE.Scene();       // no background: EdgeFeather needs alpha
const map = new THREE.CanvasTexture(makeEarthCanvas(2048));
map.colorSpace = THREE.SRGBColorSpace;
map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

const globe = new THREE.Mesh(
  new THREE.SphereGeometry(R, 96, 64),
  new THREE.MeshStandardMaterial({ map, roughness: 0.62, metalness: 0 }),
);
scene.add(globe);

scene.add(new THREE.HemisphereLight(0xdbe8ff, 0x2a3350, 1.5));
const sun = new THREE.DirectionalLight(0xfff4e0, 2.4);
sun.position.set(-0.4, 0.5, 0.8);
scene.add(sun);

// Lat/lon -> unit vector in globe-local space (matches three's SphereGeometry UV layout).
function llToVec(lat, lon, out = new THREE.Vector3()) {
  const la = THREE.MathUtils.degToRad(lat), lo = THREE.MathUtils.degToRad(lon);
  return out.set(Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo));
}

// ---- markers --------------------------------------------------------------------------------
const AMBER = new THREE.Color(0xffb020), WHITE = new THREE.Color(0xffffff);
const stemMat = new THREE.MeshStandardMaterial({ color: 0xffd27a, roughness: 0.5 });
const markers = CITIES.map((city) => {
  const normal = llToVec(city.lat, city.lon);
  const group = new THREE.Group();
  group.position.copy(normal).multiplyScalar(R);
  group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.0007, 0.0007, STEM, 8), stemMat);
  stem.position.y = STEM / 2;
  const headMat = new THREE.MeshStandardMaterial({ color: AMBER, emissive: AMBER, emissiveIntensity: 0.55, roughness: 0.4 });
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.0028, 20, 14), headMat);
  head.position.y = STEM;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.0030, 0.0042, 40),
    new THREE.MeshBasicMaterial({ color: AMBER, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.0004;
  group.add(stem, head, ring);
  globe.add(group);
  return { city, normal, group, head, headMat, ring, scale: 1 };
});

// ---- cameras --------------------------------------------------------------------------------
const eye = new EyeCamera(THREE);
// Mono fallback: frames the same 0.12 m-tall window from 0.3 m (vertical FOV = 2*atan(0.06/0.3)).
const monoCam = new THREE.PerspectiveCamera(22.6, 1.6, 0.01, 10);
monoCam.position.set(0, 0, 0.3);

// In inline-3D the backing store is double-width (left | right). Mono stays 1:1.
let sbsMode = false;
function sizeToCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let w = Math.round((canvas.clientWidth || 640) * dpr);
  let h = Math.round((canvas.clientHeight || 400) * dpr);
  const cap = Math.min(renderer.capabilities.maxTextureSize, renderer.capabilities.maxRenderbufferSize || 1e9, 8192);
  const k = Math.min(1, cap / ((sbsMode ? 2 : 1) * w), cap / h);   // keep 2 x eye width within GL limits
  w = Math.floor(w * k); h = Math.floor(h * k);
  renderer.setSize(sbsMode ? w * 2 : w, h, false);
  monoCam.aspect = w / h; monoCam.updateProjectionMatrix();
}
window.addEventListener('resize', sizeToCanvas);
sizeToCanvas();

const feather = new EdgeFeather(THREE, { px: 22 });

// ---- interaction state ----------------------------------------------------------------------
globe.quaternion.copy(facing(new THREE.Vector3(0, 0, 1), 20, 15));
let velX = 0, velY = 0;                 // inertia, rad/s about world X / Y
let lastInput = -1e9;                   // performance.now() of last user input
let target = null;                      // quaternion to ease towards after selecting a city
let selected = -1;
let hover = -1;

function facing(dir, lat, lon) {
  // Quaternion rotating the globe so (lat, lon) points along `dir`.
  return new THREE.Quaternion().setFromUnitVectors(llToVec(lat, lon), dir.clone().normalize());
}

function select(i) {
  selected = i;
  if (i >= 0) {
    const worldDir = markers[i].normal.clone().applyQuaternion(globe.quaternion);
    target = new THREE.Quaternion().setFromUnitVectors(worldDir, new THREE.Vector3(0, 0, 1)).multiply(globe.quaternion);
    velX = velY = 0;
  } else target = null;
  renderInfo();
}

function step(dt, now) {
  if (target) {
    const a = globe.quaternion.angleTo(target);
    globe.quaternion.slerp(target, 1 - Math.exp(-6 * dt));
    if (a < 0.002) target = null;
  } else if (!dragging) {
    const idle = (now - lastInput) / 1000;
    if (Math.abs(velX) + Math.abs(velY) > 1e-3) {
      rotateBy(velY * dt, velX * dt);
      const decay = Math.exp(-3 * dt); velX *= decay; velY *= decay;
    } else if (selected < 0 && idle > 3) {
      rotateBy(0.12 * dt, 0);            // gentle idle turntable
    }
  }
  const t = now / 1000;
  markers.forEach((m, i) => {
    const sel = i === selected;
    const want = sel ? 1.5 + 0.12 * Math.sin(t * 4) : (i === hover ? 1.25 : 1);
    m.scale += (want - m.scale) * Math.min(1, dt * 12);
    m.head.scale.setScalar(m.scale);
    m.ring.scale.setScalar(sel ? 1.2 + 0.4 * ((t * 1.2) % 1) : 1);
    m.ring.material.opacity = sel ? 1 - ((t * 1.2) % 1) * 0.7 : 0.85;
    m.headMat.color.lerp(sel ? WHITE : AMBER, Math.min(1, dt * 10));
    m.headMat.emissive.copy(m.headMat.color);
  });
}

const qa = new THREE.Quaternion(), AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0);
function rotateBy(yaw, pitch) {
  qa.setFromAxisAngle(AY, yaw);
  globe.quaternion.premultiply(qa);
  qa.setFromAxisAngle(AX, pitch);
  globe.quaternion.premultiply(qa);
  globe.quaternion.normalize();
}

// ---- picking --------------------------------------------------------------------------------
// The click point is in the canvas box, and each eye's viewport covers the whole box, so a marker's
// NDC position in each eye is directly comparable to the pointer. Average the eyes: a marker that
// pops out of the glass sits at different x per eye, and the pointer must land on the fused image.
let pickViews = [];   // { proj, viewInv, pos } for the last rendered frame
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _p = new THREE.Vector3();
function recordViews(list) {
  pickViews = list.map(({ proj, world }) => ({
    proj: new THREE.Matrix4().fromArray(proj),
    viewInv: new THREE.Matrix4().fromArray(world).invert(),
    pos: new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(world)),
  }));
}
function pick(clientX, clientY) {
  if (!pickViews.length) return -1;
  const r = canvas.getBoundingClientRect();
  const px = clientX - r.left, py = clientY - r.top;
  const radius = Math.max(16, r.height * 0.035);   // CSS px hit radius
  globe.updateMatrixWorld();
  let best = -1, bestD = radius;
  markers.forEach((m, i) => {
    m.head.getWorldPosition(_w);
    m.group.getWorldPosition(_p);
    let sx = 0, sy = 0, front = false;
    for (const v of pickViews) {
      _v.copy(_w).applyMatrix4(v.viewInv).applyMatrix4(v.proj);   // NDC
      sx += (_v.x * 0.5 + 0.5) * r.width; sy += (0.5 - _v.y * 0.5) * r.height;
      // visible hemisphere: the eye sees the marker's side of the globe
      const n = m.normal.clone().transformDirection(globe.matrixWorld);
      if (n.dot(v.pos.clone().sub(_p)) > 0) front = true;
    }
    if (!front) return;
    const d = Math.hypot(sx / pickViews.length - px, sy / pickViews.length - py);
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

// ---- pointer / keyboard ---------------------------------------------------------------------
let dragging = false, moved = 0, lastX = 0, lastY = 0, lastT = 0;
canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 && e.pointerType === 'mouse') return;
  canvas.setPointerCapture(e.pointerId);
  dragging = true; moved = 0; lastX = e.clientX; lastY = e.clientY; lastT = performance.now();
  velX = velY = 0; target = null;
  canvas.classList.add('dragging');
});
canvas.addEventListener('pointermove', (e) => {
  if (dragging) {
    const now = performance.now(), dt = Math.max(0.001, (now - lastT) / 1000);
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    moved += Math.abs(dx) + Math.abs(dy);
    const k = 1 / (canvas.clientHeight * 0.3);     // globe radius is ~0.3 of the window height
    if (moved > 4) {
      rotateBy(dx * k, dy * k);
      velY = THREE.MathUtils.lerp(velY, dx * k / dt, 0.5);
      velX = THREE.MathUtils.lerp(velX, dy * k / dt, 0.5);
      lastInput = now;
    }
    lastX = e.clientX; lastY = e.clientY; lastT = now;
  } else {
    const h = pick(e.clientX, e.clientY);
    if (h !== hover) { hover = h; canvas.classList.toggle('hot', h >= 0); }
  }
});
function endDrag(e, cancelled) {
  if (!dragging) return;
  dragging = false; canvas.classList.remove('dragging');
  if (performance.now() - lastT > 80) velX = velY = 0;   // held still before release: no fling
  const speed = Math.hypot(velX, velY); if (speed > 6) { velX *= 6 / speed; velY *= 6 / speed; }
  if (!cancelled && moved <= 4) {
    const h = pick(e.clientX, e.clientY);
    if (h >= 0) select(h === selected ? -1 : h);
  }
  lastInput = performance.now();
}
canvas.addEventListener('pointerup', (e) => endDrag(e, false));
canvas.addEventListener('pointercancel', (e) => endDrag(e, true));
canvas.addEventListener('pointerleave', () => { if (!dragging && hover >= 0) { hover = -1; canvas.classList.remove('hot'); } });
canvas.addEventListener('keydown', (e) => {
  const s = 0.12;
  const m = { ArrowLeft: [-s, 0], ArrowRight: [s, 0], ArrowUp: [0, -s], ArrowDown: [0, s] }[e.key];
  if (m) { e.preventDefault(); target = null; rotateBy(m[0], m[1]); lastInput = performance.now(); }
  if (e.key === 'Escape') select(-1);
});

// ---- HTML info panel ------------------------------------------------------------------------
const fmt = new Intl.NumberFormat('en-US');
function renderInfo() {
  if (selected < 0) {
    infoEl.innerHTML = '<div class="kicker">City</div><h2>Select a city</h2>' +
      '<p class="hint">Click an amber marker on the globe, or pick a city below.</p>';
  } else {
    const c = CITIES[selected];
    infoEl.innerHTML = `<button class="close" aria-label="Clear selection">×</button>` +
      `<div class="kicker">City</div><h2>${c.name}</h2><p class="country">${c.country}</p>` +
      `<div class="pop">${fmt.format(c.pop)}</div><div class="popl">inhabitants (approx.)</div>` +
      `<div class="ll">${Math.abs(c.lat).toFixed(2)}°${c.lat < 0 ? 'S' : 'N'}, ${Math.abs(c.lon).toFixed(2)}°${c.lon < 0 ? 'W' : 'E'}</div>`;
    infoEl.querySelector('.close').addEventListener('click', () => select(-1));
  }
  [...citiesEl.children].forEach((b, i) => b.setAttribute('aria-pressed', String(i === selected)));
}
CITIES.forEach((c, i) => {
  const b = document.createElement('button');
  b.textContent = c.name; b.type = 'button';
  b.addEventListener('click', () => select(i === selected ? -1 : i));
  citiesEl.appendChild(b);
});
renderInfo();

// ---- render loops ---------------------------------------------------------------------------
let last = 0;
function onXRFrame(views, layer) {
  const now = performance.now(), dt = Math.min(0.1, last ? (now - last) / 1000 : 0); last = now;
  step(dt, now);
  globe.updateMatrixWorld();
  const size = new THREE.Vector2(); renderer.getSize(size);
  renderer.clear();
  renderer.setScissorTest(true);
  const rec = [];
  for (const view of views) {
    const vp = layer.getViewport(view) || fallbackHalf(view, views, size);
    renderer.setViewport(vp.x, vp.y, vp.width, vp.height);
    renderer.setScissor(vp.x, vp.y, vp.width, vp.height);
    eye.setFromView(view);
    renderer.render(scene, eye.camera);
    feather.render(renderer, vp);
    rec.push({ proj: Array.from(view.projectionMatrix), world: Array.from(view.transform.matrix) });
  }
  renderer.setScissorTest(false);
  recordViews(rec);
}
function fallbackHalf(view, views, size) {
  const i = views.indexOf(view), half = size.x / 2;
  return { x: i === 0 ? 0 : half, y: 0, width: half, height: size.y };
}

let monoRunning = false;
function startMono() {
  if (monoRunning) return;
  monoRunning = true; sbsMode = false; sizeToCanvas();
  const loop = (now) => {
    requestAnimationFrame(loop);
    const dt = Math.min(0.1, last ? (now - last) / 1000 : 0); last = now;
    step(dt, now);
    globe.updateMatrixWorld(); monoCam.updateMatrixWorld();
    renderer.clear();
    const s = new THREE.Vector2(); renderer.getSize(s);
    renderer.setViewport(0, 0, s.x, s.y);
    renderer.render(scene, monoCam);
    recordViews([{ proj: monoCam.projectionMatrix.toArray(), world: monoCam.matrixWorld.toArray() }]);
  };
  requestAnimationFrame(loop);
}

// ---- boot -----------------------------------------------------------------------------------
const dropCover = () => { coverEl.remove(); };
(async () => {
  // Safety: the cover always comes off, even if setup throws or the woven signal never arrives.
  const failsafe = setTimeout(dropCover, 6000);
  try {
    const wall = await createInline3D({ lazy: false });
    if (wall.supported) {
      const handle = wall.addScene(canvas, onXRFrame, {
        virtualDisplayHeight: 0.12,       // display rig: window = portal onto a 12 cm virtual display
        onResize: sizeToCanvas,
        onLayerLost: startMono,           // layer gone: the SBS pair would show squeezed, so go flat
      });
      sbsMode = true; sizeToCanvas();
      statusEl.innerHTML = '<b>3D active</b> · move your head to look around';
      handle.firstWoven.then(() => { clearTimeout(failsafe); dropCover(); });
    } else {
      statusEl.textContent = '2D fallback — open in the DisplayXR Browser on a 3D display for glasses-free 3D.';
      startMono(); clearTimeout(failsafe); dropCover();
    }
  } catch (err) {
    console.error(err);
    statusEl.textContent = '2D fallback';
    startMono(); clearTimeout(failsafe); dropCover();
  }
})();
