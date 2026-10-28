// Solar system: a small three.js diorama for the DisplayXR inline-3D display.
//
// Two ways to show the same scene:
//  - On a DisplayXR display (DisplayXR Browser) the canvas is WOVEN. The SDK calls onFrame with
//    two eye views and we render the scene once per eye into the two halves of a double-width
//    backing store (the side-by-side pair the weave un-squeezes).
//  - Everywhere else the scene is drawn flat by one mono camera framed to match.
//
// The scene is authored in METRES for a virtual display 0.24 m tall. The sun sits at z = 0, the
// glass plane. Planets move in front of it and behind it. Nothing here scales the scene per frame.

import * as THREE from 'three';

const canvas = document.getElementById('scene');
const cover = document.getElementById('cover');
const statusEl = document.getElementById('status');

// ---- scene scale and framing ----------------------------------------------------------------
const VIRTUAL_DISPLAY_HEIGHT = 0.24;   // m. The portal's height at z = 0 (addScene's default, stated here)
const VIEW_DISTANCE = 0.6;             // m. The runtime's nominal eye distance; the mono camera uses it too
// Mono camera fov, so that 0.24 m fills the canvas height at 0.6 m. 2D and 3D then frame alike.
const MONO_FOV = THREE.MathUtils.radToDeg(2 * Math.atan(VIRTUAL_DISPLAY_HEIGHT / 2 / VIEW_DISTANCE));
// Tilt of the orbital plane about X. The orbits then span depth (z ~ R cos 50 deg), so the system
// has a front and a back, not a flat ring on the glass.
const TILT = THREE.MathUtils.degToRad(50);
const MAX_DPR = 1.5;                   // device px per CSS px, capped: the SBS buffer is twice this wide
const NEAR = 0.01, FAR = 10;           // also passed to updateRenderState, so eye clipping matches
const TAU = Math.PI * 2;

// ---- renderer and scene ----------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setClearColor(0x000000, 0);   // transparent: the page shows through, and EdgeFeather fades into it
renderer.setPixelRatio(1);             // getViewport() reports backing-store px; any other ratio scales each eye
renderer.autoClear = false;            // one clear per frame, then one viewport per eye
renderer.xr.enabled = false;           // inline-3D never goes through three's XR manager

const scene = new THREE.Scene();       // no background: the starfield is the backdrop

// Deterministic PRNG, so the starfield is the same on every load and identical for both eyes.
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Stars sit BEHIND the glass (z < 0), so the planets read as in front of them. Each star is spread
// across the frustum at its own depth, so the field fills the window wherever it lands.
const stars = (() => {
  const count = 1400, rand = rng(7);
  const pos = new Float32Array(count * 3), col = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const z = -(0.10 + rand() * 0.28);                        // -0.10 … -0.38 m
    const halfH = (VIRTUAL_DISPLAY_HEIGHT / 2) * ((VIEW_DISTANCE - z) / VIEW_DISTANCE) * 1.15;
    pos.set([(rand() * 2 - 1) * halfH * 2, (rand() * 2 - 1) * halfH, z], i * 3);
    const b = 0.4 + 0.6 * rand() ** 3;                        // mostly dim, a few bright
    col.set([b, b, b], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  // sizeAttenuation off: stars are 2 device px at every depth, which keeps them crisp.
  const points = new THREE.Points(geo, new THREE.PointsMaterial({ vertexColors: true, size: 2, sizeAttenuation: false }));
  scene.add(points);
  return points;
})();

// The solar system. Its orbits lie in XZ, and the group is tilted about X into depth.
const system = new THREE.Group();
system.rotation.x = TILT;
scene.add(system);

const sun = new THREE.Mesh(new THREE.SphereGeometry(0.014, 48, 32), new THREE.MeshBasicMaterial({ color: 0xffc35a }));
system.add(sun);
const sunGlow = new THREE.Mesh(
  new THREE.SphereGeometry(0.028, 40, 24),
  new THREE.MeshBasicMaterial({ color: 0xffa640, transparent: true, opacity: 0.14, depthWrite: false }),
);
sunGlow.renderOrder = 1;
system.add(sunGlow);

// The sun lights the planets. decay 0 means no falloff with distance, so the outer planets are not dark.
scene.add(new THREE.PointLight(0xfff1d6, 1.6, 0, 0));
scene.add(new THREE.HemisphereLight(0x9db8ff, 0x101020, 0.25));

const PLANETS = [
  { radius: 0.0035, orbit: 0.024, period: 6,  color: 0xb3aba2 },   // Mercury-like
  { radius: 0.0060, orbit: 0.036, period: 9,  color: 0xe6bd86 },   // Venus-like
  { radius: 0.0064, orbit: 0.050, period: 13, color: 0x3f7fd0,     // Earth-like, with a moon
    moon: { radius: 0.0019, orbit: 0.0135, period: 3.2 } },
  { radius: 0.0048, orbit: 0.066, period: 22, color: 0xc0573a },   // Mars-like
];

// A thin orbit line. Symmetric about its own centre, so rotating its pivot leaves it unchanged.
function orbitRing(radius, opacity) {
  const pts = [];
  for (let i = 0; i <= 128; i++) {
    const a = (i / 128) * TAU;
    pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
  }
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color: 0x8ea4d2, transparent: true, opacity, depthWrite: false }),
  );
}

// Each mover is a pivot whose rotation.y is set from the clock. Its child sits at the orbit radius.
const movers = [];
for (const p of PLANETS) {
  system.add(orbitRing(p.orbit, 0.22));
  const pivot = new THREE.Group();
  system.add(pivot);
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(p.radius, 32, 24),
    new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.9, metalness: 0 }),
  );
  body.position.x = p.orbit;
  pivot.add(body);
  movers.push({ pivot, period: p.period });

  if (p.moon) {
    // The moon's pivot is a child of the planet's pivot, so it follows the planet, centred on it.
    const moonPivot = new THREE.Group();
    moonPivot.position.x = p.orbit;
    pivot.add(moonPivot);
    moonPivot.add(orbitRing(p.moon.orbit, 0.14));
    const moon = new THREE.Mesh(
      new THREE.SphereGeometry(p.moon.radius, 20, 16),
      new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 1, metalness: 0 }),
    );
    moon.position.x = p.moon.orbit;
    moonPivot.add(moon);
    movers.push({ pivot: moonPivot, period: p.moon.period });
  }
}

function animate(t) {
  stars.rotation.z = t * 0.004;          // slow in-plane drift: no depth motion for the starfield
  for (const m of movers) m.pivot.rotation.y = (t / m.period) * TAU;
}

// ---- clock: one simulated time for both paths, clamped so a hitch cannot fling the planets ---
let simTime = 0, lastNow = null;
function advance(now) {
  if (lastNow !== null) simTime += Math.min(0.1, (now - lastNow) / 1000);
  lastNow = now;
}

// ---- sizing ------------------------------------------------------------------------------------
const monoCam = new THREE.PerspectiveCamera(MONO_FOV, 16 / 9, NEAR, FAR);
monoCam.position.set(0, 0, VIEW_DISTANCE);
monoCam.lookAt(0, 0, 0);

let woven = false;                     // true while the weave session drives this canvas

// Returns true only when the backing store actually changed. setSize clears the buffer even for
// equal values, so a no-op resize must not reach it.
function sizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  const bufW = woven ? w * 2 : w;      // woven: the buffer is the SBS pair, left eye | right eye
  if (canvas.width === bufW && canvas.height === h) return false;
  renderer.setSize(bufW, h, false);    // false: the CSS box stays under layout's control
  monoCam.aspect = w / h;
  monoCam.updateProjectionMatrix();
  return true;
}

// Each eye's half of the SBS buffer. Used when repainting from a copy, after the buffer changed size.
function eyeViewport(i) {
  const half = Math.floor(renderer.domElement.width / 2);
  return { x: i * half, y: 0, width: half, height: renderer.domElement.height };
}

// ---- flat (mono) path ----------------------------------------------------------------------------
let monoRunning = false;               // the loop stops itself once the weave takes over
function drawMono() {
  renderer.clear();
  renderer.setViewport(0, 0, canvas.width, canvas.height);
  renderer.setScissorTest(false);
  renderer.render(scene, monoCam);
}
function monoTick(now) {
  if (woven) { monoRunning = false; return; }   // the weave session owns the canvas now
  advance(now);
  animate(simTime);
  drawMono();
  requestAnimationFrame(monoTick);
}

// ---- woven path ----------------------------------------------------------------------------------
let eyes = null, feather = null;       // SDK helpers, loaded before the weave starts

// COPIES of each eye's matrices, for replay. An XRView is valid only inside the callback that
// delivered it.
const good = [0, 1].map(() => ({ proj: new Float32Array(16), pose: new Float32Array(16) }));
let haveGood = false;

function onFrame(views, layer) {
  advance(performance.now());
  animate(simTime);
  // Check everything BEFORE clear(). A short view list or a null viewport would otherwise leave
  // a black frame, which the weave reads as a dark tile. Repaint the last good frame instead.
  if (!views || views.length < 2 || !layer) return replayLastGood();
  const vps = [layer.getViewport(views[0]), layer.getViewport(views[1])];
  if (vps.some((vp) => !vp || vp.width <= 0 || vp.height <= 0)) return replayLastGood();

  renderer.clear();
  renderer.setScissorTest(true);
  for (let i = 0; i < 2; i++) {
    const vp = vps[i];
    renderer.setViewport(vp.x, vp.y, vp.width, vp.height);
    renderer.setScissor(vp.x, vp.y, vp.width, vp.height);
    eyes[i].setFromView(views[i]);     // projection and pose straight from the runtime
    renderer.render(scene, eyes[i].camera);
    feather.render(renderer, vp);      // fade this eye's edges into the page
    good[i].proj.set(views[i].projectionMatrix);
    good[i].pose.set(views[i].transform.matrix);
  }
  renderer.setScissorTest(false);
  haveGood = true;
}

function replayLastGood() {
  renderer.clear();                    // a frame is still presented, even before the first good one
  if (!haveGood) return;
  renderer.setScissorTest(true);
  for (let i = 0; i < 2; i++) {
    const vp = eyeViewport(i);
    renderer.setViewport(vp.x, vp.y, vp.width, vp.height);
    renderer.setScissor(vp.x, vp.y, vp.width, vp.height);
    eyes[i].setFromMatrices(good[i].proj, good[i].pose);
    renderer.render(scene, eyes[i].camera);
    feather.render(renderer, vp);
  }
  renderer.setScissorTest(false);
}

function setStatus(text) { statusEl.textContent = text; }

function startFlat(message) {
  woven = false;
  cover.hidden = true;
  sizeCanvas();
  setStatus(message);
  if (!monoRunning) { monoRunning = true; requestAnimationFrame(monoTick); }
}

// ---- boot ------------------------------------------------------------------------------------------
sizeCanvas();
const onResize = () => {
  if (!sizeCanvas()) return;
  // Repaint now, not on the next frame. A cleared buffer must not wait for it.
  if (woven) replayLastGood(); else drawMono();
};
new ResizeObserver(onResize).observe(canvas);
window.addEventListener('resize', onResize);

// Draw the flat scene at once. The loop stops only once the weave has actually taken over.
monoRunning = true;
requestAnimationFrame(monoTick);

(async () => {
  let wall = null;
  try {
    const { createInline3D } = await import('@displayxr/inline3d');
    const helpers = await import('@displayxr/inline3d/three');
    eyes = [new helpers.EyeCamera(THREE), new helpers.EyeCamera(THREE)];
    for (const e of eyes) { e.camera.near = NEAR; e.camera.far = FAR; }
    feather = new helpers.EdgeFeather(THREE, { px: 26 });
    wall = await createInline3D({ lazy: false });
  } catch (err) {
    console.warn('[solar] inline-3D unavailable, showing the flat view', err);
    return startFlat('Flat view. Open in the DisplayXR Browser on a DisplayXR display for 3D.');
  }
  if (!wall.supported) {
    return startFlat('Flat view. Open in the DisplayXR Browser on a DisplayXR display for 3D.');
  }

  let handle;
  try {
    handle = wall.addScene(canvas, onFrame, {
      virtualDisplayHeight: VIRTUAL_DISPLAY_HEIGHT,
      onLayerLost: () => startFlat('Flat view. The 3D layer was lost.'),
    });
  } catch (err) {
    console.warn('[solar] addScene failed, showing the flat view', err);
    return startFlat('Flat view. Open in the DisplayXR Browser on a DisplayXR display for 3D.');
  }

  // Activation succeeded: the weave owns the canvas now. The mono loop stops itself on its next tick.
  woven = true;
  sizeCanvas();                        // the double-width SBS backing store
  try { wall.session.updateRenderState({ depthNear: NEAR, depthFar: FAR }); } catch { /* session mid-teardown */ }

  // Keep the cover until the browser has joined the canvas (the first woven frame), then cut it.
  handle.firstWoven.then((result) => {
    cover.hidden = true;
    setStatus(result.woven
      ? '3D active. Move your head to look around the system.'
      : 'Flat view. The canvas did not weave on this display.');
  });
})();
