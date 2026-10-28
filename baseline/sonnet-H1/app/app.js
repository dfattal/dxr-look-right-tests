// Spinnable 3D globe for the DisplayXR Browser (inline-3D, DISPLAY rig), with a flat fallback.
//
// The user turns a SUBJECT, so: display rig, globe rotated under a fixed portal (no camera rig).
// Scene authored in metres for a 0.24 m virtual display; the globe straddles the z=0 glass.

import * as THREE from 'three';
import { createInline3D } from '@displayxr/inline3d';
import { EyeCamera, EdgeFeather, displayRig } from '@displayxr/inline3d/three';
import { buildEarthCanvases } from './earth.js';

const VDH = 0.24;            // virtual display height (m): the zoom knob
const R = 0.08;              // globe radius (m)
const GLOBE_Z = -0.03;       // centre behind the glass: front pole +0.05 m out, back -0.11 m
const PIN_H = 0.012;

const CITIES = [
  { name: 'London',   country: 'United Kingdom', lat: 51.5074, lon: -0.1278,  pop: 8982000 },
  { name: 'Tokyo',    country: 'Japan',          lat: 35.6762, lon: 139.6503, pop: 13960000 },
  { name: 'New York', country: 'United States',  lat: 40.7128, lon: -74.0060, pop: 8258000 },
  { name: 'Sydney',   country: 'Australia',      lat: -33.8688, lon: 151.2093, pop: 5312000 },
  { name: 'Nairobi',  country: 'Kenya',          lat: -1.2921, lon: 36.8219,  pop: 4397000 },
];

const $ = (id) => document.getElementById(id);
const canvas = $('globe'), statusEl = $('status'), infoEl = $('info'), listEl = $('cityList'), tipEl = $('tip'), coverEl = $('cover');

// ---- renderer / scene ------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setClearColor(0x000000, 0);   // transparent: the page shows through, edges feather out
renderer.setPixelRatio(1);             // getViewport() is in backing-store px; we size the store ourselves
renderer.autoClear = false;

const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xaac4ff, 0x101830, 0.7));
const sun = new THREE.DirectionalLight(0xfff4e0, 2.6);
sun.position.set(-0.6, 0.5, 1); scene.add(sun);

const tex = buildEarthCanvases();
const aniso = renderer.capabilities.getMaxAnisotropy();
const mkTex = (c, srgb) => { const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; return t; };
const globe = new THREE.Group();                       // rotation: x = pitch, y = yaw (Euler XYZ)
globe.position.set(0, 0, GLOBE_Z);
scene.add(globe);
globe.add(new THREE.Mesh(
  new THREE.SphereGeometry(R, 128, 96),
  new THREE.MeshStandardMaterial({
    map: mkTex(tex.color, true), roughnessMap: mkTex(tex.rough), roughness: 1, metalness: 0,
    bumpMap: mkTex(tex.bump), bumpScale: 0.6,
  }),
));

// stars well behind the globe (z -0.12..-0.26): cheap depth reference, kept inside the comfort zone
{
  const n = 450, pos = new Float32Array(n * 3), colr = new Float32Array(n * 3);
  let s = 12345; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < n; i++) {
    pos.set([(rnd() - 0.5) * 0.7, (rnd() - 0.5) * 0.4, -0.12 - rnd() * 0.14], i * 3);
    const b = 0.35 + rnd() * 0.65; colr.set([b, b, b * 1.05], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(colr, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({
    size: 1.6 * Math.min(2, window.devicePixelRatio || 1), sizeAttenuation: false, vertexColors: true, depthWrite: false,
  })));
}

// ---- markers ---------------------------------------------------------------------------------
const latLon = (lat, lon, out = new THREE.Vector3()) => {
  const la = lat * Math.PI / 180, lo = lon * Math.PI / 180;       // lon 0 = +x, matches SphereGeometry's u
  return out.set(Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo));
};
const pinMat = new THREE.MeshStandardMaterial({ color: 0xffb347, emissive: 0xff7a00, emissiveIntensity: 0.55, roughness: 0.4 });
const markers = CITIES.map((c, idx) => {
  const n = latLon(c.lat, c.lon);
  const anchor = new THREE.Group();
  anchor.position.copy(n).multiplyScalar(R);
  anchor.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);   // anchor +y = surface normal
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.0006, 0.0006, PIN_H, 8), pinMat);
  stem.position.y = PIN_H / 2;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.0034, 24, 16), pinMat.clone());
  head.position.y = PIN_H;
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.0065, 0.0082, 48),
    new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.0005;
  anchor.add(stem, head, ring);
  globe.add(anchor);
  return { idx, city: c, n, anchor, head, ring, sx: 0, sy: 0, vis: false };
});

// ---- globe state / interaction ---------------------------------------------------------------
let yaw = -Math.PI / 2 - 20 * Math.PI / 180, pitch = 0.35;
let vYaw = 0, vPitch = 0;
let target = null;            // { yaw, pitch } eased toward after a selection
let selected = -1, hover = -1, dragging = false, lastInteract = -1e9;
const clampPitch = (p) => Math.max(-1.1, Math.min(1.1, p));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

function select(i) {
  selected = i;
  const c = CITIES[i];
  target = { yaw: yaw + wrap(-Math.PI / 2 - c.lon * Math.PI / 180 - yaw), pitch: clampPitch(c.lat * Math.PI / 180 * 0.8) };
  [...listEl.querySelectorAll('button')].forEach((b, k) => b.setAttribute('aria-pressed', String(k === i)));
  infoEl.replaceChildren();
  const h = document.createElement('h2'); h.textContent = c.name;
  const meta = document.createElement('div'); meta.className = 'meta';
  meta.textContent = `${c.country} · ${Math.abs(c.lat).toFixed(2)}°${c.lat >= 0 ? 'N' : 'S'}, ${Math.abs(c.lon).toFixed(2)}°${c.lon >= 0 ? 'E' : 'W'}`;
  const pop = document.createElement('div'); pop.className = 'pop'; pop.textContent = c.pop.toLocaleString('en-US');
  const lab = document.createElement('div'); lab.className = 'meta'; lab.textContent = 'population (city proper, approx.)';
  infoEl.append(h, meta, pop, lab);
}
CITIES.forEach((c, i) => {
  const li = document.createElement('li'), b = document.createElement('button');
  b.type = 'button'; b.setAttribute('aria-pressed', 'false');
  const d = document.createElement('span'); d.className = 'dot';
  b.append(d, c.name); b.addEventListener('click', () => select(i));
  li.append(b); listEl.append(li);
});

function pick(x, y) {
  let best = -1, bd = 26 * 26;
  for (const m of markers) {
    if (!m.vis) continue;
    const d = (m.sx - x) ** 2 + (m.sy - y) ** 2;
    if (d < bd) { bd = d; best = m.idx; }
  }
  return best;
}
const local = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

let down = null;
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  const [x, y] = local(e);
  down = { x, y, t: performance.now(), lx: x, ly: y, moved: 0 };
  dragging = true; vYaw = vPitch = 0; target = null; canvas.classList.add('drag');
});
canvas.addEventListener('pointermove', (e) => {
  const [x, y] = local(e);
  if (dragging && down) {
    const k = 2.4 / Math.max(200, canvas.clientHeight);          // rad per px
    const dx = x - down.lx, dy = y - down.ly;
    down.lx = x; down.ly = y; down.moved += Math.abs(dx) + Math.abs(dy);
    yaw += dx * k; pitch = clampPitch(pitch + dy * k);
    vYaw = dx * k * 60; vPitch = dy * k * 60;
    lastInteract = performance.now();
    tipEl.style.display = 'none';
  } else {
    hover = pick(x, y);
    canvas.classList.toggle('hot', hover >= 0);
    if (hover >= 0) { tipEl.textContent = CITIES[hover].name; tipEl.style.display = 'block'; tipEl.style.left = e.clientX + 14 + 'px'; tipEl.style.top = e.clientY + 14 + 'px'; }
    else tipEl.style.display = 'none';
  }
});
const endDrag = (e) => {
  if (!dragging) return;
  dragging = false; canvas.classList.remove('drag');
  if (down && down.moved < 6 && performance.now() - down.t < 600) {
    const [x, y] = local(e), i = pick(x, y);
    if (i >= 0) { select(i); vYaw = vPitch = 0; }
  }
  down = null; lastInteract = performance.now();
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('pointerleave', () => { if (!dragging) { hover = -1; tipEl.style.display = 'none'; canvas.classList.remove('hot'); } });

function update(dt, now) {
  dt = Math.min(dt, 0.1);
  if (!dragging) {
    if (target) {
      const a = 1 - Math.exp(-dt * 4);
      yaw += wrap(target.yaw - yaw) * a; pitch += (target.pitch - pitch) * a;
      if (Math.abs(wrap(target.yaw - yaw)) < 1e-3 && Math.abs(target.pitch - pitch) < 1e-3) target = null;
    } else {
      yaw += vYaw * dt; pitch = clampPitch(pitch + vPitch * dt);
      const f = Math.exp(-dt * 3); vYaw *= f; vPitch *= f;
      if (selected < 0 && now - lastInteract > 3000) yaw += 0.12 * dt;   // idle turntable
    }
  }
  globe.rotation.set(pitch, yaw, 0);
  const t = now / 1000;
  for (const m of markers) {
    const on = m.idx === selected, hot = m.idx === hover;
    const s = on ? 1.6 : hot ? 1.35 : 1;
    m.head.scale.setScalar(s);
    m.head.material.color.set(on ? 0xffffff : 0xffb347);
    m.head.material.emissiveIntensity = on ? 0.9 : hot ? 0.8 : 0.55;
    m.ring.material.opacity = on ? 0.55 + 0.35 * Math.sin(t * 4) : 0;
    m.ring.scale.setScalar(on ? 1 + 0.25 * (0.5 + 0.5 * Math.sin(t * 4)) : 1);
  }
  scene.updateMatrixWorld(true);
}

// Where each marker appears to the viewer: the mean of its projections in the cameras drawn
// (left+right eye = the cyclopean view), which is where a 2D pointer sitting on the glass lines up.
const _p = new THREE.Vector3(), _c = new THREE.Vector3(), _e = new THREE.Vector3(), _v = new THREE.Vector3(), _w = new THREE.Vector3();
function trackMarkers(cams) {
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  _e.set(0, 0, 0);
  for (const cam of cams) _e.add(_v.setFromMatrixPosition(cam.matrixWorld));
  _e.multiplyScalar(1 / cams.length);
  globe.getWorldPosition(_c);
  for (const m of markers) {
    m.head.getWorldPosition(_p);
    let sx = 0, sy = 0;
    for (const cam of cams) { _v.copy(_p).project(cam); sx += (_v.x * 0.5 + 0.5) * cw; sy += (-_v.y * 0.5 + 0.5) * ch; }
    m.sx = sx / cams.length; m.sy = sy / cams.length;
    _w.copy(_p).sub(_c).normalize();                       // outward normal in world space
    _v.copy(_e).sub(_p).normalize();
    m.vis = _w.dot(_v) > 0.12;
  }
}

// ---- sizing ----------------------------------------------------------------------------------
let sbs = false;
const maxDim = Math.min(renderer.capabilities.maxTextureSize, 8192);
function sizeCanvas() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  let w = Math.max(2, Math.round((canvas.clientWidth || 640) * dpr));
  let h = Math.max(2, Math.round((canvas.clientHeight || 480) * dpr));
  const k = Math.min(1, maxDim / (sbs ? w * 2 : w), maxDim / h);   // one factor for both axes
  w = Math.round(w * k); h = Math.round(h * k);
  const bw = sbs ? w * 2 : w;
  if (canvas.width !== bw || canvas.height !== h) renderer.setSize(bw, h, false);   // setSize clears: only when changed
  monoCam.aspect = w / h; monoCam.updateProjectionMatrix();
}
// mono camera = the same portal: 0.6 m back, z=0 plane exactly VDH tall
const monoCam = new THREE.PerspectiveCamera(2 * Math.atan(VDH / 2 / 0.6) * 180 / Math.PI, 1, 0.05, 5);
monoCam.position.set(0, 0, 0.6);

// ---- stereo draw (shared by live frames and replay) ------------------------------------------
const eyes = [new EyeCamera(THREE), new EyeCamera(THREE)];
const feather = new EdgeFeather(THREE, { px: 40 });
const good = [0, 1].map(() => ({ proj: new Float32Array(16), pose: new Float32Array(16), vp: null }));
let haveGood = false, last = 0;

function drawGood(useStoredVp) {
  const bw = renderer.domElement.width, bh = renderer.domElement.height;
  const cams = [];
  for (let i = 0; i < 2; i++) cams.push(eyes[i].setFromMatrices(good[i].proj, good[i].pose));
  trackMarkers(cams);
  renderer.clear();
  renderer.setScissorTest(true);
  for (let i = 0; i < 2; i++) {
    const vp = useStoredVp ? good[i].vp : { x: i * (bw >> 1), y: 0, width: bw >> 1, height: bh };
    renderer.setViewport(vp.x, vp.y, vp.width, vp.height);
    renderer.setScissor(vp.x, vp.y, vp.width, vp.height);
    renderer.render(scene, cams[i]);
    feather.render(renderer, vp);
  }
  renderer.setScissorTest(false);
}

function onFrame(views, layer) {
  const now = performance.now(), dt = last ? (now - last) / 1000 : 0; last = now;
  update(dt, now);
  // validate everything BEFORE clearing: a short view list must not blank the canvas
  const vps = views && views.length >= 2 && layer ? [layer.getViewport(views[0]), layer.getViewport(views[1])] : null;
  if (!vps || vps.some((v) => !v || v.width <= 0 || v.height <= 0)) {
    if (haveGood) drawGood(false); else { renderer.clear(); }
    return;
  }
  for (let i = 0; i < 2; i++) {
    good[i].proj.set(views[i].projectionMatrix); good[i].pose.set(views[i].transform.matrix);   // copies, not the XRView
    good[i].vp = { x: vps[i].x, y: vps[i].y, width: vps[i].width, height: vps[i].height };
  }
  haveGood = true;
  drawGood(true);
}

function monoFrame(now) {
  const dt = last ? (now - last) / 1000 : 0; last = now;
  update(dt, now);
  monoCam.updateMatrixWorld();
  trackMarkers([monoCam]);
  renderer.setViewport(0, 0, canvas.width, canvas.height);
  renderer.clear();
  renderer.render(scene, monoCam);
}
let monoRunning = false;
function startMono() {
  if (monoRunning) return;
  monoRunning = true; sbs = false; sizeCanvas();
  const loop = (t) => { monoFrame(t); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
}

// ---- boot ------------------------------------------------------------------------------------
let ro = null;
(async () => {
  let wall = null;
  try { wall = await createInline3D({ lazy: false }); } catch (e) { console.warn('inline-3D unavailable', e); }
  if (wall && wall.supported) {
    coverEl.hidden = false;                                  // opaque cover until the first woven frame
    try { wall.session.updateRenderState({ depthNear: 0.05, depthFar: 5 }); } catch (_) {}
    sbs = true; sizeCanvas();
    const handle = wall.addScene(canvas, onFrame, {
      viewRig: displayRig({ virtualDisplayHeight: VDH }),
      onLayerLost: () => { statusEl.textContent = '2D fallback'; startMono(); },
      onResize: () => { sizeCanvas(); if (haveGood) drawGood(false); },
    });
    statusEl.innerHTML = '<b>inline-3D active</b> · move your head to look around';
    handle.firstWoven.then(() => { coverEl.remove(); });     // hard cut, never a fade
  } else {
    coverEl.remove();
    statusEl.textContent = '2D view — open in the DisplayXR Browser on a 3D display for glasses-free depth';
    startMono();
  }
  ro = new ResizeObserver(() => { if (sbs) return; sizeCanvas(); monoFrame(performance.now()); });   // woven path resizes via onResize
  ro.observe(canvas);
})();
