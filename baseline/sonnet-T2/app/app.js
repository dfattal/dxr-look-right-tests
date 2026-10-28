// Tabletop solar system — DisplayXR inline-3D, display rig (see NOTES.md).
import * as THREE from 'three';
import { createInline3D } from 'sdk/inline3d.js';
import { EyeCamera, EdgeFeather } from 'sdk/inline3d-three.js';

const canvas = document.getElementById('view');
const cover = document.getElementById('cover');
const statusEl = document.getElementById('status');

// Everything is authored in metres for a 12 cm-tall virtual display (z=0 is the glass,
// +z toward the viewer). Total scene depth stays within about z = -0.085 .. +0.04.
const VDH = 0.12;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(1);          // viewports are in buffer px; any other ratio mis-scales them
renderer.autoClear = false;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();    // no background: edges feather to the page

// ---------- procedural textures ----------
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function planetTexture(seed, base, accent, bands) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const g = c.getContext('2d'), r = rng(seed);
  g.fillStyle = base; g.fillRect(0, 0, 512, 256);
  for (let i = 0; i < (bands ? 40 : 160); i++) {
    g.globalAlpha = 0.08 + r() * 0.25; g.fillStyle = accent;
    if (bands) g.fillRect(0, r() * 256, 512, 3 + r() * 14);
    else { g.beginPath(); g.ellipse(r() * 512, r() * 256, 10 + r() * 50, 6 + r() * 25, r() * 3, 0, 7); g.fill(); }
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.wrapS = THREE.RepeatWrapping;
  return t;
}
function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'), gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  gr.addColorStop(0, 'rgba(255,214,120,0.9)'); gr.addColorStop(0.25, 'rgba(255,170,60,0.35)');
  gr.addColorStop(1, 'rgba(255,120,20,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ---------- sun ----------
const sun = new THREE.Mesh(
  new THREE.SphereGeometry(0.011, 48, 32),
  new THREE.MeshBasicMaterial({ map: planetTexture(7, '#ffb02e', '#ffe08a', false) }),
);
scene.add(sun);
const glow = new THREE.Sprite(new THREE.SpriteMaterial({
  map: glowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
glow.scale.set(0.05, 0.05, 1);
scene.add(glow);
const sunLight = new THREE.PointLight(0xfff0d8, 5, 0, 0);   // decay 0: no falloff over a 15 cm scene
scene.add(sunLight);
scene.add(new THREE.AmbientLight(0x2a3550, 1.2));

// ---------- planets ----------
// Orbits are ellipses (wide in x) so the 16:9 window is used; the plane is tilted toward the
// viewer like a table seen from above. The front of each orbit is at the bottom.
const TILT = 0.95;
const planetDefs = [
  { name: 'Ember', r: 0.0042, a: 0.034, b: 0.030, period: 6,  spin: 1.4, tex: planetTexture(11, '#9a7556', '#5b3d2a', false) },
  { name: 'Terra', r: 0.0058, a: 0.056, b: 0.044, period: 11, spin: 1.0, tex: planetTexture(23, '#2f6fc4', '#3f9a56', false), moon: true },
  { name: 'Giant', r: 0.0085, a: 0.080, b: 0.056, period: 19, spin: 0.7, tex: planetTexture(31, '#d2a066', '#8a5a30', true), ring: true },
  { name: 'Frost', r: 0.0062, a: 0.100, b: 0.064, period: 30, spin: 0.9, tex: planetTexture(47, '#7fd0d0', '#d9ffff', true) },
];
const tiltAxis = new THREE.Vector3(1, 0, 0);
const orbitPos = (d, ang, out) => out.set(Math.cos(ang) * d.a, 0, Math.sin(ang) * d.b).applyAxisAngle(tiltAxis, TILT);

for (const d of planetDefs) {
  d.mesh = new THREE.Mesh(
    new THREE.SphereGeometry(d.r, 40, 28),
    new THREE.MeshStandardMaterial({ map: d.tex, roughness: 0.85, metalness: 0 }));
  d.phase = Math.random() * 6.28;
  scene.add(d.mesh);
  const pts = [];
  for (let i = 0; i <= 160; i++) pts.push(orbitPos(d, (i / 160) * Math.PI * 2, new THREE.Vector3()));
  scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color: 0x6f86b8, transparent: true, opacity: 0.35 })));
  if (d.ring) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(d.r * 1.45, d.r * 2.2, 64),
      new THREE.MeshStandardMaterial({ color: 0xcdb089, side: THREE.DoubleSide, roughness: 0.9,
        transparent: true, opacity: 0.85, depthWrite: false }));
    ring.rotation.x = Math.PI / 2 - 0.45;
    d.mesh.add(ring);
  }
  if (d.moon) {
    d.moonMesh = new THREE.Mesh(new THREE.SphereGeometry(0.0017, 24, 16),
      new THREE.MeshStandardMaterial({ map: planetTexture(5, '#b9b9b9', '#6f6f6f', false), roughness: 1 }));
    scene.add(d.moonMesh);
  }
}

// ---------- starfield ----------
// A bounded slab BEHIND the glass (not infinity): stars at infinity would demand diverging eyes;
// here the deepest star is ~0.085 m behind z=0. Oversized in x/y so look-around never shows an edge.
function makeStars(count, zMin, zMax, seed) {
  const r = rng(seed), pos = new Float32Array(count * 3), col = new Float32Array(count * 3);
  const tint = [[1, 1, 1], [0.8, 0.88, 1], [1, 0.9, 0.78]];
  for (let i = 0; i < count; i++) {
    pos.set([(r() - 0.5) * 0.5, (r() - 0.5) * 0.3, -(zMin + r() * (zMax - zMin))], i * 3);
    const t = tint[(r() * 3) | 0], k = 0.6 + r() * 0.4;
    col.set([t[0] * k, t[1] * k, t[2] * k], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d'), gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, '#fff'); gr.addColorStop(0.5, '#fff'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
  const mat = new THREE.PointsMaterial({ size: 3, sizeAttenuation: false, vertexColors: true,
    map: new THREE.CanvasTexture(c), transparent: true, alphaTest: 0.05, depthWrite: false, toneMapped: false });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = -1;
  scene.add(pts);
  return mat;
}
// Min ~3 css px so a star never shrinks to a 1-px speck that shimmers differently per eye.
const starMats = [
  { mat: makeStars(500, 0.050, 0.085, 101), css: 3 },
  { mat: makeStars(120, 0.050, 0.085, 202), css: 5 },
];

// ---------- cameras ----------
const eye = new EyeCamera(THREE);
const monoCam = new THREE.PerspectiveCamera(2 * Math.atan(VDH / 2 / 0.35) * 180 / Math.PI, 16 / 9, 0.01, 5);
monoCam.position.set(0, 0, 0.35);
let mx = 0, my = 0;
addEventListener('pointermove', (e) => { mx = e.clientX / innerWidth - 0.5; my = e.clientY / innerHeight - 0.5; });

// ---------- sizing ----------
let sbsMode = false;
function sizeToCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round((canvas.clientWidth || 640) * dpr), h = Math.round((canvas.clientHeight || 360) * dpr);
  const bw = sbsMode ? w * 2 : w;
  if (canvas.width !== bw || canvas.height !== h) renderer.setSize(bw, h, false);  // a write clears the buffer
  monoCam.aspect = w / h; monoCam.updateProjectionMatrix();
  for (const s of starMats) s.mat.size = s.css * dpr;
}
sizeToCanvas();

// ---------- animation ----------
let simTime = 0, paused = false, speed = 1;
const tmp = new THREE.Vector3();
function update(dt) {
  if (!paused) simTime += dt * speed;
  sun.rotation.y = simTime * 0.1;
  for (const d of planetDefs) {
    orbitPos(d, d.phase + (simTime / d.period) * Math.PI * 2, d.mesh.position);
    d.mesh.rotation.y = simTime * d.spin;
    if (d.moonMesh) {
      const m = simTime * 1.6;
      tmp.set(Math.cos(m) * 0.0105, 0, Math.sin(m) * 0.0105).applyAxisAngle(tiltAxis, TILT * 0.6);
      d.moonMesh.position.copy(d.mesh.position).add(tmp);
    }
  }
}
const pauseBtn = document.getElementById('pause');
pauseBtn.onclick = () => { paused = !paused; pauseBtn.textContent = paused ? 'Play' : 'Pause'; };
document.getElementById('speed').oninput = (e) => { speed = parseFloat(e.target.value); };

// ---------- stereo rendering ----------
const feather = new EdgeFeather(THREE, { px: 28 });
const size = new THREE.Vector2();
let lastDraws = null;   // COPIES of per-eye matrices + viewports (an XRView is only valid in-callback)
let last = 0;

function drawEyes(draws) {
  renderer.clear();
  renderer.setScissorTest(true);
  for (const { proj, xf, vp } of draws) {
    renderer.setViewport(vp.x, vp.y, vp.width, vp.height);
    renderer.setScissor(vp.x, vp.y, vp.width, vp.height);
    eye.setFromMatrices(proj, xf);
    renderer.render(scene, eye.camera);
    feather.render(renderer, vp);
  }
  renderer.setScissorTest(false);
}
function onXRFrame(views, layer) {
  const now = performance.now(); const dt = last ? Math.min((now - last) / 1000, 0.1) : 0; last = now;
  update(dt);
  // Validate BEFORE clearing: need 2 views with viewports, else repaint the last good frame.
  if (views.length >= 2) {
    const d = [];
    for (let i = 0; i < 2; i++) {
      const vp = layer.getViewport(views[i]);
      if (!vp) break;
      d.push({ proj: Float32Array.from(views[i].projectionMatrix), xf: Float32Array.from(views[i].transform.matrix),
        vp: { x: vp.x, y: vp.y, width: vp.width, height: vp.height } });
    }
    if (d.length === 2) lastDraws = d;
  }
  if (lastDraws) drawEyes(lastDraws);
}

function onMonoFrame(now) {
  requestAnimationFrame(onMonoFrame);
  const dt = last ? Math.min((now - last) / 1000, 0.1) : 0; last = now;
  update(dt);
  monoCam.position.set(mx * 0.06, -my * 0.04, 0.35);
  monoCam.lookAt(0, 0, 0);
  renderer.clear();
  renderer.getSize(size);
  renderer.setViewport(0, 0, size.x, size.y);
  renderer.render(scene, monoCam);
}
addEventListener('resize', () => { if (!sbsMode) sizeToCanvas(); });
function goMono(msg) {
  sbsMode = false; sizeToCanvas(); cover.hidden = true;
  statusEl.innerHTML = msg;
  last = 0; requestAnimationFrame(onMonoFrame);
}

// ---------- boot ----------
const nextFrames = (n) => new Promise((res) => { const f = () => (--n <= 0 ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
(async () => {
  const wall = await createInline3D({ lazy: false });
  if (!wall.supported) {
    goMono('<b style="color:#9fb0cf">2D fallback</b> — move the pointer to look around. Open in the ' +
      '<a href="https://github.com/DisplayXR/displayxr-browser" style="color:#7aa7ff">DisplayXR Browser</a> on a 3D display for glasses-free 3D.');
    return;
  }
  // Commit the canvas first: final CSS box, 2:1 backing store, two frames, then register.
  cover.hidden = false;
  sbsMode = true; sizeToCanvas();
  await nextFrames(2);
  const handle = wall.addScene(canvas, onXRFrame, {
    virtualDisplayHeight: VDH,
    onResize: () => { sizeToCanvas(); if (lastDraws) drawEyes(lastDraws); },   // repaint right after the clear
    onLayerLost: () => goMono('<b style="color:#9fb0cf">3D session ended</b> — showing 2D.'),
  });
  statusEl.innerHTML = '<b>inline-3D active</b> — move your head to look around.';
  handle.firstWoven.then(() => { cover.hidden = true; });   // hard cut
})();
