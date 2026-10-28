// aquarium.js — a glass tank with sand, rocks, swaying plants and five fish, as one DisplayXR
// inline-3D scene. One canvas, one display rig, one three.js scene. Where the browser cannot
// weave, the same scene is drawn flat with a mono camera framed for the same virtual display.
//
// SCALE AND DEPTH. Everything is authored in metres for a 24 cm-tall virtual display. The z=0
// plane is the glass: the tank's front frame sits on it, the back wall is TANK.d behind it, and
// the fish stay in a thin slab that barely crosses in front of the glass. Nothing is posed or
// scaled per frame; the runtime supplies the eye views.

import * as THREE from 'three';
import { createInline3D } from '@displayxr/inline3d';
import { EyeCamera, displayRig } from '@displayxr/inline3d/three';

const canvas = document.getElementById('tank');
const cover = document.getElementById('cover');
const statusEl = document.getElementById('status');

// ---- depth and layout constants -------------------------------------------------------------
const BG = 0x0d1a22;                       // page and canvas background: the window dissolves into the page
const VDH = 0.24;                          // virtual display height, metres: the scene's scale and zoom
const MONO_DIST = 0.6;                     // the runtime's nominal viewer distance, metres
const MONO_FOV = THREE.MathUtils.radToDeg(2 * Math.atan(VDH / 2 / MONO_DIST)); // same framing as SBS
const NEAR = 0.1, FAR = 3;                 // session clip planes; all content sits near 0.6 m

const TANK = { w: 0.30, h: 0.17, d: 0.07 }; // interior size; front glass at z=0, back wall at z=-d
const FRAME = 0.006;                        // frame rail thickness
const FLOOR_Y = -TANK.h / 2;

// ---- deterministic randomness: the same tank every load -------------------------------------
function rngFrom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rngFrom(7);
const TAU = Math.PI * 2;

// ---- renderer --------------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
// pixelRatio MUST be 1. getViewport() reports backing-store pixels, and three multiplies viewport
// rectangles by the ratio, so any other value zooms each eye. We size the store ourselves.
renderer.setPixelRatio(1);
renderer.autoClear = false;                // one clear per frame, then the eye viewports
renderer.setClearColor(BG, 1);

const gl = renderer.getContext();
const GL_LIMIT = Math.min(
  gl.getParameter(gl.MAX_TEXTURE_SIZE),
  gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
  ...gl.getParameter(gl.MAX_VIEWPORT_DIMS),
);

const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xcfe9f5, 0x1d3a44, 1.1));
const sun = new THREE.DirectionalLight(0xfff3dc, 1.4);
sun.position.set(0.3, 1, 0.8);
scene.add(sun);

function paintTexture(w, h, paint) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  paint(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---- tank ------------------------------------------------------------------------------------
// Back wall: unlit, so its colour is the water and not a lit surface. TANK.d is deliberate: at a
// 0.6 m viewing distance the back wall's disparity against the glass is about 0.6 degrees (a
// 63 mm eye separation over 7 cm of depth), which stays inside a comfortable range.
const backTex = paintTexture(8, 256, (g, w, h) => {
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, '#2f7d8c');
  grd.addColorStop(1, '#0c2b36');
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
});
const back = new THREE.Mesh(
  new THREE.PlaneGeometry(TANK.w, TANK.h),
  new THREE.MeshBasicMaterial({ map: backTex }),
);
back.position.set(0, 0, -TANK.d - 0.001);
scene.add(back);

// Sand floor: a flat plane with a speckled texture. Flat keeps the floor's edge crisp.
const sandTex = paintTexture(128, 128, (g, w, h) => {
  g.fillStyle = '#d6c08a';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = rand() < 0.5 ? 'rgba(120,96,58,0.35)' : 'rgba(255,240,200,0.30)';
    g.fillRect(rand() * w, rand() * h, 1 + rand() * 1.5, 1 + rand() * 1.5);
  }
});
sandTex.wrapS = sandTex.wrapT = THREE.RepeatWrapping;
sandTex.repeat.set(3, 1);
const sand = new THREE.Mesh(
  new THREE.PlaneGeometry(TANK.w, TANK.d),
  new THREE.MeshStandardMaterial({ map: sandTex, roughness: 1 }),
);
sand.rotation.x = -Math.PI / 2;
sand.position.set(0, FLOOR_Y, -TANK.d / 2);
scene.add(sand);

// Frame: four rails around the front edge, deep enough to read as the tank's glass edges. The
// front faces sit a few millimetres in front of z=0, which is the sharpest plane on the panel.
const railMat = new THREE.MeshStandardMaterial({ color: 0x3b4f58, roughness: 0.5, metalness: 0.2 });
const railDepth = TANK.d + FRAME;
const railZ = -TANK.d / 2;
function rail(w, h, x, y) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, railDepth), railMat);
  m.position.set(x, y, railZ);
  scene.add(m);
}
rail(TANK.w + 2 * FRAME, FRAME, 0, TANK.h / 2 + FRAME / 2);
rail(TANK.w + 2 * FRAME, FRAME, 0, -TANK.h / 2 - FRAME / 2);
rail(FRAME, TANK.h, TANK.w / 2 + FRAME / 2, 0);
rail(FRAME, TANK.h, -TANK.w / 2 - FRAME / 2, 0);

// Front glass: a faint, nearly clear pane exactly on z=0. It washes the fish behind it a little,
// which is what makes them read as being inside glass rather than floating on the screen.
const glass = new THREE.Mesh(
  new THREE.PlaneGeometry(TANK.w, TANK.h),
  new THREE.MeshBasicMaterial({ color: 0xbfeeff, transparent: true, opacity: 0.07, depthWrite: false }),
);
scene.add(glass);

// Rocks: lumpy icosahedra, flat-shaded, partly buried. Each rock fits inside the tank's depth:
// z must sit between -(TANK.d - r) and -r, so none pokes through the back wall or the glass.
const rockMat = new THREE.MeshStandardMaterial({ color: 0x7f766a, roughness: 0.95, flatShading: true });
function makeRock(r) {
  const geo = new THREE.IcosahedronGeometry(r, 3);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  const ph = [rand() * TAU, rand() * TAU, rand() * TAU];
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const k = 1 + 0.22 * Math.sin(3.1 * v.x + ph[0]) * Math.cos(2.7 * v.y + ph[1])
              + 0.12 * Math.sin(5.3 * v.z + ph[2] + 2 * v.x);
    pos.setXYZ(i, v.x * r * k, v.y * r * k * 0.7, v.z * r * k);
  }
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, rockMat);
}
for (const [x, z, r, sy] of [[-0.10, -0.036, 0.024, 0.8], [0.085, -0.040, 0.022, 0.7], [0.02, -0.030, 0.016, 0.9]]) {
  const rock = makeRock(r);
  rock.scale.y = sy;
  rock.position.set(x, FLOOR_Y + r * 0.3 * sy, z);
  scene.add(rock);
}

// Plants: each is a chain of five leaf segments, every joint a child of the one below. Swaying
// is one rotation per joint per frame, so there is no geometry to rebuild. Each leaf is crossed
// with a second, perpendicular leaf so the plant has volume from both eyes.
const SEG = 0.018;
const leafGeo = new THREE.PlaneGeometry(0.010, SEG);
leafGeo.translate(0, SEG / 2, 0);
const plantMats = [0x2f8f4e, 0x3ea35c, 0x5fb35f, 0x2a7a55].map((c) =>
  new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, side: THREE.DoubleSide }));
function makePlant(x, z, mat) {
  const root = new THREE.Group();
  root.position.set(x, FLOOR_Y, z);
  scene.add(root);
  const joints = [];
  let parent = root;
  for (let i = 0; i < 5; i++) {
    const joint = new THREE.Group();
    joint.position.y = i === 0 ? 0 : SEG;
    const a = new THREE.Mesh(leafGeo, mat);
    const b = new THREE.Mesh(leafGeo, mat);
    b.rotation.y = Math.PI / 2;
    joint.add(a, b);
    parent.add(joint);
    joints.push(joint);
    parent = joint;
  }
  return { joints, phase: rand() * TAU };
}
const plants = [
  makePlant(-0.118, -0.040, plantMats[0]),
  makePlant(-0.062, -0.058, plantMats[1]),
  makePlant(0.058, -0.052, plantMats[2]),
  makePlant(0.118, -0.035, plantMats[3]),
];

// Fish: a body, a tail on a pivot, and a dorsal fin. The swim path is a Lissajous curve, and each
// fish's heading is the path's velocity. The z extent is small: each fish's centre stays between
// about 4 cm behind the glass and 3 mm in front of it, so only a sliver ever comes forward.
function makeFish(color, size) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  root.scale.setScalar(size);

  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.4 });
  const finMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color).multiplyScalar(0.8), roughness: 0.5, side: THREE.DoubleSide,
  });
  const bodyMesh = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 14), bodyMat);
  bodyMesh.scale.set(0.030, 0.014, 0.011);  // 3 cm long, nose along +x
  body.add(bodyMesh);

  const dorsal = new THREE.Mesh(new THREE.ConeGeometry(0.0045, 0.009, 3), finMat);
  dorsal.position.set(-0.004, 0.0075, 0);
  body.add(dorsal);

  const tailGeo = new THREE.ConeGeometry(0.0075, 0.012, 4);
  tailGeo.rotateZ(Math.PI / 2);             // apex points along -x
  tailGeo.translate(-0.006, 0, 0);          // base at the pivot
  const tailMesh = new THREE.Mesh(tailGeo, finMat);
  tailMesh.scale.z = 0.35;                  // a thin fan, wide in y
  const tail = new THREE.Group();
  tail.position.x = -0.013;
  tail.add(tailMesh);
  body.add(tail);

  return { root, body, tail };
}
const FISH_SPECS = [
  // colour, size, swim centre [x,y,z], extent [x,y,z], angular speed [x,y,z] (rad/s)
  { color: 0xff7a2e, size: 1.00, c: [0.00, 0.010, -0.018], a: [0.095, 0.026, 0.016], w: [0.31, 0.52, 0.23] },
  { color: 0x2f6fd6, size: 0.90, c: [-0.02, -0.012, -0.016], a: [0.085, 0.030, 0.014], w: [0.27, 0.44, 0.36] },
  { color: 0xffd23f, size: 0.85, c: [0.01, 0.024, -0.020], a: [0.090, 0.020, 0.018], w: [0.40, 0.61, 0.19] },
  { color: 0xe0463c, size: 1.10, c: [-0.01, -0.024, -0.017], a: [0.070, 0.024, 0.012], w: [0.22, 0.35, 0.29] },
  { color: 0xdfe9ef, size: 0.95, c: [0.02, 0.002, -0.016], a: [0.100, 0.030, 0.019], w: [0.36, 0.48, 0.42] },
];
const fish = FISH_SPECS.map((s) => {
  const f = makeFish(s.color, s.size);
  f.path = {
    cx: s.c[0], cy: s.c[1], cz: s.c[2],
    ax: s.a[0], ay: s.a[1], az: s.a[2],
    wx: s.w[0], wy: s.w[1], wz: s.w[2],
    px: rand() * TAU, py: rand() * TAU, pz: rand() * TAU,
    phase: rand() * TAU,
  };
  scene.add(f.root);
  return f;
});

// ---- animation (scene state only: the same for SBS and mono) ----------------------------------
let t = 0;
let lastNow = null;
function advance(now) {
  const dt = lastNow === null ? 0 : Math.min(0.05, (now - lastNow) / 1000); // clamp: no jump after a stall
  lastNow = now;
  t += dt;
}

function animate(time) {
  for (const p of plants) {
    p.joints.forEach((j, i) => {
      j.rotation.z = Math.sin(time * 1.1 + p.phase + i * 0.6) * (0.05 + 0.05 * i);
      j.rotation.x = Math.cos(time * 0.8 + p.phase + i * 0.5) * 0.05;
    });
  }
  for (const f of fish) {
    const p = f.path;
    const sx = Math.sin(p.wx * time + p.px), cx = Math.cos(p.wx * time + p.px);
    const sy = Math.sin(p.wy * time + p.py), cy = Math.cos(p.wy * time + p.py);
    const sz = Math.sin(p.wz * time + p.pz), cz = Math.cos(p.wz * time + p.pz);
    f.root.position.set(p.cx + p.ax * sx, p.cy + p.ay * sy, p.cz + p.az * sz);
    // Heading is the velocity: yaw in the x-z plane, then pitch. 'YXZ' applies roll-free pitch
    // first, then yaw, which is the order that keeps the nose on the path.
    const vx = p.ax * p.wx * cx, vy = p.ay * p.wy * cy, vz = p.az * p.wz * cz;
    f.root.rotation.set(0, Math.atan2(-vz, vx), Math.atan2(vy, Math.hypot(vx, vz)), 'YXZ');
    const flap = Math.sin(time * 9 + p.phase);
    f.body.rotation.y = flap * 0.08;
    f.tail.rotation.y = flap * 0.5;
  }
}

// ---- backing store ---------------------------------------------------------------------------
// The SBS store is 2:1 while woven: the left eye in the left half, the right in the right half.
// A canvas whose store is not 2:1 weaves to a double image, so the size is set here, from the
// CSS box, and never by the SDK.
let mode = 'boot';                          // 'boot' | 'sbs' | 'mono'
let sbs = false;
let bufW = 0, bufH = 0;
const EYE_MAX = { w: 1280, h: 800 };        // device px per eye: past this the weave gains nothing, the GPU pays
const monoCam = new THREE.PerspectiveCamera(MONO_FOV, 1.6, 0.01, 5);
monoCam.position.set(0, 0, MONO_DIST);      // looks down -z at the glass

function sizeBuffer() {
  const dpr = window.devicePixelRatio || 1;
  const eyeW = Math.max(1, Math.round((canvas.clientWidth || 640) * dpr));
  const eyeH = Math.max(1, Math.round((canvas.clientHeight || 400) * dpr));
  const per = sbs ? 2 : 1;
  // Scale both axes by the same factor so the eye keeps the CSS aspect. Clamp here, never let the
  // browser clamp: a silent clamp splits the pair at the wrong point (a large double image).
  const s = Math.min(1, EYE_MAX.w / eyeW, EYE_MAX.h / eyeH, GL_LIMIT / (eyeW * per), GL_LIMIT / eyeH);
  const eyeWpx = Math.floor(eyeW * s), eyeHpx = Math.floor(eyeH * s);
  const w = eyeWpx * per, h = eyeHpx;
  if (canvas.width !== w || canvas.height !== h) {   // setSize clears even for the same value
    renderer.setSize(w, h, false);
    monoCam.aspect = eyeWpx / eyeHpx;
    monoCam.updateProjectionMatrix();
  }
  bufW = w; bufH = h;
}

// ---- SBS rendering ---------------------------------------------------------------------------
// One eye camera driven by each XRView, and a copy of each eye's matrices for replay.
const eye = new EyeCamera(THREE);
const good = [0, 1].map(() => ({ proj: new Float32Array(16), pose: new Float32Array(16) }));
let haveGood = false;

function onFrame(views, layer) {
  advance(performance.now());
  animate(t);
  // Validate BEFORE clear(). A short view list or a null viewport is a frame that cannot fill the
  // store, and clearing it would blink the tile. Repaint the last good frame instead.
  if (!views || views.length < 2 || !layer) return replayGood();
  const vps = [layer.getViewport(views[0]), layer.getViewport(views[1])];
  if (vps.some((vp) => !vp || vp.width <= 0 || vp.height <= 0)) return replayGood();

  renderer.clear();
  renderer.setScissorTest(true);
  for (let i = 0; i < 2; i++) {
    const vp = vps[i];
    renderer.setViewport(vp.x, vp.y, vp.width, vp.height);
    renderer.setScissor(vp.x, vp.y, vp.width, vp.height);
    eye.setFromView(views[i]);
    renderer.render(scene, eye.camera);
    // Copies, never the XRView: it is valid only inside this callback.
    good[i].proj.set(views[i].projectionMatrix);
    good[i].pose.set(views[i].transform.matrix);
  }
  renderer.setScissorTest(false);
  haveGood = true;
}

// Replays the last good pair into the CURRENT store. The halves are split the way the layer
// splits canvas.width, so this is also what onResize draws before the next frame.
function replayGood() {
  renderer.clear();
  if (!haveGood) return;                    // nothing good yet: the cleared (opaque) frame is still presented
  renderer.setScissorTest(true);
  const half = bufW / 2;
  for (let i = 0; i < 2; i++) {
    renderer.setViewport(i * half, 0, half, bufH);
    renderer.setScissor(i * half, 0, half, bufH);
    eye.setFromMatrices(good[i].proj, good[i].pose);
    renderer.render(scene, eye.camera);
  }
  renderer.setScissorTest(false);
}

// ---- mono rendering (ordinary browsers, or after the layer is lost) -------------------------
function monoFrame(now) {
  if (mode !== 'mono') return;
  requestAnimationFrame(monoFrame);
  advance(now);
  animate(t);
  sizeBuffer();
  renderer.clear();
  renderer.setViewport(0, 0, bufW, bufH);
  renderer.render(scene, monoCam);
}

function startMono(message) {
  if (mode === 'mono') return;
  mode = 'mono';
  sbs = false;
  cover.hidden = true;                      // nothing is woven, so there is nothing to cover
  sizeBuffer();
  statusEl.innerHTML = message;
  requestAnimationFrame(monoFrame);
}

// ---- boot ------------------------------------------------------------------------------------
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

(async () => {
  const wall = await createInline3D({ lazy: false }).catch(() => null);
  if (!wall || !wall.supported) {
    startMono('<b>2D fallback</b> — open in the <a href="https://github.com/DisplayXR/displayxr-browser">DisplayXR Browser</a> on a DisplayXR display for glasses-free 3D');
    return;
  }

  mode = 'sbs';
  sbs = true;
  sizeBuffer();                             // the 2:1 store is set before the layer exists
  await nextFrame();                        // two frames: the canvas must be settled before it
  await nextFrame();                        // joins the compositor (woven-canvas rule 4)

  try {
    wall.session.updateRenderState({ depthNear: NEAR, depthFar: FAR });
  } catch {
    // Older browsers keep their default clip planes; the scene still renders.
  }

  // The display rig, with every factor at 1: the runtime's own depth for a 24 cm display. Browsers
  // without rig support fall back to addScene's default virtualDisplayHeight, which is VDH.
  const handle = wall.addScene(canvas, onFrame, {
    viewRig: displayRig({ virtualDisplayHeight: VDH, ipdFactor: 1, parallaxFactor: 1, perspectiveFactor: 1 }),
    bufferClamped: true,                    // this page sizes and clamps the store itself
    onResize: () => {                       // a real CSS or dpr change: resize, then repaint now
      sizeBuffer();                         // so the old store is never shown stretched
      if (haveGood) replayGood();
    },
    onLayerLost: () => startMono('<b>2D fallback</b> — the 3D layer was lost; showing the flat tank'),
  });

  // Drop the cover on the first real stereo frame, not on a timer (woven-canvas rule 5). A hard cut.
  handle.firstWoven.then(() => { cover.hidden = true; });
  statusEl.innerHTML = '<b>inline-3D active</b> — weaving glasses-free 3D';
})();
