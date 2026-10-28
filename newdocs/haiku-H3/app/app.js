// Ring Run — a flight game on a CAMERA rig: the player flies THROUGH a world, so the page owns a
// chase camera and the runtime turns it into two eyes. Rules: /sdk/docs/making-3d-look-right.md.
// Template: /sdk/samples/starter-world/. Everything is authored in metres.
//
// SCREEN PLANE (§2): a FIXED convergence, never driven by input. The nearest content touching a frame
// edge is the flat ground at the bottom edge. The chase camera sits at least MIN_CLEAR + CHASE_UP above
// the ground and is pitched CHASE_PITCH down, so that ground is about 16.6 m away (view depth) at the
// lowest altitude. Converging at 14 m, a little nearer, puts the bottom edge just behind the glass and
// the plane (about 11 m) at it. Nothing is driven by gaze or by the controls.
//
// DEPTH (§3, full-frame column). Numbers from the SDK's cameraRigDisparityPct at FOV 60°, 16:9,
// ipdFactor IPD_MAX = 1.8 (the slider's top), CONVERGENCE 14 m:
//   plane (11 m):          −0.11 %  (just in front, mid-frame)
//   bottom-edge ground (16.6 m): +0.06 %
//   rings (110–230 m):     +0.34 … +0.37 %
//   mountains (900 m), sky (∞): +0.39 … +0.40 %
// The comfortable full-frame limits are 1.0 % behind and 0.3 % in front. Nothing comes out of the glass
// except the plane. The camera is at least 11.5 m above the ground, and it looks down at 37° at the
// bottom edge, so on flat ground nothing in view is nearer than the bottom-edge distance above. A hill
// rising into the lower frame could be; that is the first thing to check on a panel.

import * as THREE from 'three';
import { createInline3D } from '@displayxr/inline3d';
import { EyeCamera, cameraRigFromCamera } from '@displayxr/inline3d/three';

const $ = (id) => document.getElementById(id);
const canvas = $('world');
const cover = $('cover');
const hud = $('hud');
const depth = $('depth');
const modeBtn = $('mode');
const note = $('note');

// ---- tuning ------------------------------------------------------------------------------------------
const FOV = 60;                 // full vertical angle, degrees
const NEAR = 0.3, FAR = 3000;   // metres; the sky dome (SKY_R) sits inside FAR
const CONVERGENCE = 14;         // metres: zero-disparity distance (see the header)
const IPD_MAX = 1.8;            // eye separation at the slider's top, × 63 mm (absolute on a camera rig)
const SPEED = 28;               // m/s, constant: the player steers, does not throttle
const MIN_CLEAR = 8;            // lowest the plane may fly above the ground, m
const CEILING = 110;            // highest the plane may fly, m
const CHASE_DIST = 11;          // camera behind the plane, m
const CHASE_UP = 3.5;           // camera above the plane, m
const CHASE_PITCH = -0.12;      // camera pitch, rad. FIXED: the camera does not follow the plane's pitch
const RING_R = 5, RING_TUBE = 0.45, RINGS = 14;
const SKY_R = 1500;
const HORIZON = 0xcfe3f2;       // the sky at the horizon = the fog colour, so distant hills dissolve into it
const BG = 0x15171c;            // page colour behind the canvas (the clear is opaque)

let seed = 7;                   // a seeded generator: the same world every visit
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const smooth = (a, b, x) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// ---- renderer, scene and the app camera --------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setClearColor(BG, 1);  // OPAQUE clear (a transparent pixel weaves as stale or black)
renderer.setPixelRatio(1);      // getViewport() is in store px; see sizeStore()
renderer.autoClear = false;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(HORIZON, 300, 1300);
// The app camera is IN the scene: the eye cameras hang under it (the attach pattern).
const cam = new THREE.PerspectiveCamera(FOV, 16 / 9, NEAR, FAR);
scene.add(cam);

scene.add(new THREE.HemisphereLight(0xdfeeff, 0x3a4a2a, 1.6));
const sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
sun.position.set(-1, 1.6, 0.6);
scene.add(sun);

// ---- sky: a gradient dome that follows the camera (the sky is at infinity: no parallax) ---------------
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(SKY_R, 32, 16),
  new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }),
);
{
  const p = sky.geometry.attributes.position;
  const col = new Float32Array(p.count * 3);
  const hor = new THREE.Color(HORIZON), zen = new THREE.Color('#2f5f9e'), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    c.copy(hor).lerp(zen, smooth(0, 0.6, p.getY(i) / SKY_R));
    col.set([c.r, c.g, c.b], i * 3);
  }
  sky.geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
}
sky.renderOrder = -1;
scene.add(sky);

// ---- terrain: procedural rolling hills ---------------------------------------------------------------
function groundHeight(x, z) {
  return (7 * Math.sin(x * 0.011 + 1.3) * Math.cos(z * 0.009) +
          4 * Math.sin(x * 0.029 + z * 0.023 + 0.7) +
          1.8 * Math.sin(x * 0.067 - z * 0.054) +
          0.8 * Math.cos(x * 0.15 + z * 0.13)) * smooth(30, 160, Math.hypot(x, z)); // flat take-off area
}

// Irregular grain (no obvious repeat) so the two eyes have detail to fuse on.
function grainTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = `rgba(0,0,0,${rnd() * 0.16})`;
    g.beginPath();
    g.arc(rnd() * 256, rnd() * 256, 1 + rnd() * rnd() * 14, 0, 7);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(60, 60);
  t.anisotropy = 8;
  return t;
}

const TERRAIN = 3200, TSEG = 280;
const tGeo = new THREE.PlaneGeometry(TERRAIN, TERRAIN, TSEG, TSEG).rotateX(-Math.PI / 2);
{
  const p = tGeo.attributes.position;
  const col = new Float32Array(p.count * 3);
  const LOW = new THREE.Color('#5d8a3e'), HIGH = new THREE.Color('#91985a'), ROCK = new THREE.Color('#7b7467');
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), h = groundHeight(x, z);
    p.setY(i, h);
    c.copy(LOW).lerp(HIGH, smooth(1, 8, h)).lerp(ROCK, smooth(9, 14, h));
    const j = 0.95 + 0.05 * Math.sin(x * 0.37) * Math.cos(z * 0.29);
    col.set([c.r * j, c.g * j, c.b * j], i * 3);
  }
  tGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  tGeo.computeVertexNormals();
}
const terrain = new THREE.Mesh(
  tGeo,
  new THREE.MeshStandardMaterial({ vertexColors: true, map: grainTexture(), roughness: 0.95 }),
);
scene.add(terrain);

// ---- distant mountains: a ring of jagged cones beyond the hills, dissolved by the fog -----------------
{
  const rock = new THREE.MeshStandardMaterial({ color: '#6b7a92', roughness: 1, flatShading: true });
  for (let i = 0; i < 46; i++) {
    const a = (i / 46) * Math.PI * 2 + rnd() * 0.1;
    const R = 880 + rnd() * 120, h = 180 + rnd() * 220, r = h * (0.7 + rnd() * 0.4);
    const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 6 + Math.floor(rnd() * 3), 2), rock);
    m.position.set(Math.cos(a) * R, h / 2 - 20, Math.sin(a) * R);  // base sunk below the hills
    m.rotation.y = rnd() * 6;
    scene.add(m);
  }
}

// ---- the plane: a simple built model, 0.6 scale (wingspan 4.5 m) ------------------------------------
const plane = new THREE.Group();
plane.scale.setScalar(0.6);
scene.add(plane);
const paint = new THREE.MeshStandardMaterial({ color: '#c8412b', roughness: 0.5 });
const trim = new THREE.MeshStandardMaterial({ color: '#ece6d4', roughness: 0.6 });
const glass = new THREE.MeshStandardMaterial({ color: '#2c4a66', roughness: 0.2, metalness: 0.3 });
const dark = new THREE.MeshStandardMaterial({ color: '#222428', roughness: 0.7 });
const part = (geo, mat, x, y, z) => {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  plane.add(m);
  return m;
};
part(new THREE.CylinderGeometry(0.35, 0.5, 4.2, 14).rotateX(Math.PI / 2), paint, 0, 0, 0); // nose at −z
part(new THREE.BoxGeometry(7.5, 0.1, 1.3), trim, 0, -0.05, -0.2);                           // main wing
part(new THREE.BoxGeometry(0.1, 1.1, 0.9), paint, 0, 0.55, 1.8);                            // fin
part(new THREE.BoxGeometry(2.6, 0.08, 0.7), trim, 0, 0.05, 1.9);                            // tailplane
part(new THREE.SphereGeometry(0.4, 16, 10).scale(1, 0.6, 1.4), glass, 0, 0.35, -0.7);       // canopy
const prop = part(new THREE.BoxGeometry(0.08, 1.9, 0.06), dark, 0, 0, -2.2);

// A soft ground shadow under the plane: the cue that tells the eye how high it is.
const shadow = new THREE.Mesh(
  new THREE.PlaneGeometry(9, 9).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2 }),
);
scene.add(shadow);
function blobTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(0,0,0,0.55)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

// ---- rings: a torus course ahead of the plane, recycled behind it -----------------------------------
const ringGeo = new THREE.TorusGeometry(RING_R, RING_TUBE, 12, 48);
const ringGold = new THREE.MeshStandardMaterial({ color: '#f2b233', emissive: '#3a2400', roughness: 0.35, metalness: 0.2 });
const ringDone = new THREE.MeshStandardMaterial({ color: '#58c46a', emissive: '#0f2a12', roughness: 0.35 });
const rings = [];
for (let i = 0; i < RINGS; i++) {
  const r = new THREE.Mesh(ringGeo, ringGold);
  r.userData.done = false;
  scene.add(r);
  rings.push(r);
}

// ---- flight state (metres, radians). Heading psi: + turns LEFT. Roll: + banks RIGHT. ------------------
const pos = new THREE.Vector3(0, 30, 0);
const prev = pos.clone();
let psi = 0, pitch = 0, roll = 0, score = 0;
const fwd = new THREE.Vector3(), right = new THREE.Vector3();
function headingVectors() {
  fwd.set(-Math.sin(psi), 0, -Math.cos(psi));
  right.set(Math.cos(psi), 0, -Math.sin(psi));
}
function placeRingAhead(ring, dist) {
  headingVectors();
  const p = ring.position;
  p.copy(pos).addScaledVector(fwd, dist).addScaledVector(right, (rnd() * 2 - 1) * 35);
  p.y = THREE.MathUtils.clamp(pos.y + (rnd() * 2 - 1) * 12, groundHeight(p.x, p.z) + 10, CEILING);
  ring.rotation.set(0, psi, 0);        // the ring faces the flight line
  ring.material = ringGold;
  ring.userData.done = false;
}
for (let i = 0; i < RINGS; i++) placeRingAhead(rings[i], 90 + i * 14 + rnd() * 6);

// ---- input: arrows only; the page's own slider keeps its arrow keys ---------------------------------
const keys = new Set();
addEventListener('keydown', (e) => {
  if (e.code.startsWith('Arrow') && e.target.tagName !== 'INPUT') e.preventDefault();
  keys.add(e.code);
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

// ---- one simulation step; the camera and the plane follow from it ------------------------------------
const nrm = new THREE.Vector3(), toPrev = new THREE.Vector3(), toNow = new THREE.Vector3(), hit = new THREE.Vector3();
function step(dt) {
  const turn = (keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0);
  const climb = (keys.has('ArrowUp') ? 1 : 0) - (keys.has('ArrowDown') ? 1 : 0);
  roll += (turn * 0.6 - roll) * Math.min(1, dt * 2.5);
  psi -= Math.sin(roll) * 1.6 * dt;     // a right bank turns right: the heading decreases
  pitch += (climb * 0.3 - pitch) * Math.min(1, dt * 1.2);

  prev.copy(pos);
  const cp = Math.cos(pitch);
  pos.x -= Math.sin(psi) * cp * SPEED * dt;
  pos.y += Math.sin(pitch) * SPEED * dt;
  pos.z -= Math.cos(psi) * cp * SPEED * dt;
  pos.y = THREE.MathUtils.clamp(pos.y, groundHeight(pos.x, pos.z) + MIN_CLEAR, CEILING);

  // Rings: collect on a crossing of the ring's plane inside its hole; recycle the ones left behind.
  headingVectors();
  for (const ring of rings) {
    const c = ring.position;
    if (!ring.userData.done) {
      nrm.set(0, 0, 1).applyEuler(ring.rotation);
      const s0 = toPrev.subVectors(prev, c).dot(nrm);
      const s1 = toNow.subVectors(pos, c).dot(nrm);
      if (s0 * s1 <= 0 && s0 !== s1) {
        hit.lerpVectors(prev, pos, s0 / (s0 - s1));
        if (hit.distanceTo(c) < RING_R) {
          ring.userData.done = true;
          ring.material = ringDone;
          score++;
          hud.textContent = `Rings ${score}`;
        }
      }
    }
    if (toNow.subVectors(c, pos).dot(fwd) < -60) placeRingAhead(ring, 110 + rnd() * 120);
  }
  updateVisuals(dt);
}

// The plane, its shadow and the chase camera. The camera's pitch is fixed, and it never leaves the
// heading. The camera's rig is set by the runtime from this pose, once per frame, and the eyes are
// attached below the camera.
function updateVisuals(dt) {
  headingVectors();
  plane.position.copy(pos);
  plane.rotation.set(pitch, psi, -roll, 'YXZ');    // the pitch, heading and bank of the model
  prop.rotation.z -= dt * 40;
  const ground = groundHeight(pos.x, pos.z);
  shadow.position.set(pos.x, ground + 0.3, pos.z);
  shadow.material.opacity = 0.5 * Math.max(0.15, 1 - (pos.y - ground) / 60);
  cam.position.set(pos.x - fwd.x * CHASE_DIST, pos.y + CHASE_UP, pos.z - fwd.z * CHASE_DIST);
  cam.rotation.set(CHASE_PITCH, psi, 0, 'YXZ');
  sky.position.copy(cam.position);
}
updateVisuals(0);

// ---- backing store: 2x wide woven (left | right eye), 1:1 flat. Sized BEFORE registering, then only in
// onResize. -------------------------------------------------------------------------------------------
let sbs = false;
function sizeStore(cssW = canvas.clientWidth, cssH = canvas.clientHeight, dpr = devicePixelRatio || 1) {
  const w = Math.max(1, Math.round(cssW * dpr)), h = Math.max(1, Math.round(cssH * dpr));
  renderer.setSize(sbs ? 2 * w : w, h, false);
  cam.aspect = w / h;
  cam.updateProjectionMatrix();
}

// ---- woven path: the attach pattern, drawn from the last GOOD frame ----------------------------------
// The rig is sent once with an identity pose (attach: true): the eyes are parented under `cam`, so
// three supplies THIS frame's camera pose, with no one-frame rig lag while the plane turns.
const eyes = [new EyeCamera(THREE), new EyeCamera(THREE)];
for (const e of eyes) cam.add(e.camera);
let last = null;                 // copies: an XRView is valid only inside its own frame
let lastT = 0;
function tick(now) {
  const dt = lastT ? Math.min((now - lastT) / 1000, 0.05) : 0;
  lastT = now;
  step(dt);
}

function onXRFrame(views, layer) {
  tick(performance.now());
  // Validate before clearing; a short view list (the session under load) replays the last frame.
  const vps = views && views.length >= 2 ? views.map((v) => layer.getViewport(v)) : null;
  if (vps && vps.every((vp) => vp && vp.width > 0 && vp.height > 0)) {
    last = views.slice(0, 2).map((v, i) => ({
      proj: Array.from(v.projectionMatrix), pose: Array.from(v.transform.matrix),
      vp: { x: vps[i].x, y: vps[i].y, width: vps[i].width, height: vps[i].height },
    }));
  }
  drawEyes();
}
function drawEyes() {
  if (!last) return;
  renderer.clear();
  renderer.setScissorTest(true);
  last.forEach((e, i) => {
    renderer.setViewport(e.vp.x, e.vp.y, e.vp.width, e.vp.height);
    renderer.setScissor(e.vp.x, e.vp.y, e.vp.width, e.vp.height);
    eyes[i].setLocalFromMatrices(e.proj, e.pose);   // rig-local eye pose, under `cam`
    renderer.render(scene, eyes[i].camera);
  });
  renderer.setScissorTest(false);
}
function onResize({ width, height, dpr }) {       // inside the SDK's observer, before paint
  sizeStore(width, height, dpr);
  if (!last) return;
  const w = canvas.width / 2;
  last.forEach((e, i) => { e.vp = { x: i * w, y: 0, width: w, height: canvas.height }; });
  drawEyes();
}

// ---- mono path: the same camera, drawn once per animation frame ---------------------------------------
function onMonoFrame(now) {
  requestAnimationFrame(onMonoFrame);
  tick(now);
  renderer.clear();
  renderer.setViewport(0, 0, canvas.width, canvas.height);
  renderer.render(scene, cam);
}

// ---- boot --------------------------------------------------------------------------------------------
const wall = await createInline3D({ lazy: false });
if (wall.supported) {
  sbs = true;
  sizeStore();                                    // size BEFORE registering
  // One rig, from one value k in [0, 1]: the slider moves BOTH factors (stereo and look-around).
  // On a camera rig the factors are absolute, so the slider's top is the tuned value.
  const rig = (k) => cameraRigFromCamera(THREE, cam, {
    convergence: CONVERGENCE, attach: true, ipdFactor: k * IPD_MAX, parallaxFactor: k,
  });
  const handle = wall.addScene(canvas, onXRFrame, { viewRig: rig(Number(depth.value)), onResize });
  // Each eye's projection is built from the session's near/far: give it the camera's.
  wall.session.updateRenderState({ depthNear: cam.near, depthFar: cam.far });
  depth.addEventListener('input', () => handle.setViewRig(rig(Number(depth.value))));

  // 2D/3D switch. The label follows what the display REPORTS (renderingmodechange), not the click.
  let flat = false;
  const show = () => {
    modeBtn.textContent = flat ? 'Show in 3D' : 'Show in 2D';
    modeBtn.setAttribute('aria-pressed', String(flat));
  };
  handle.on('renderingmodechange', (e) => {
    if (e.viewCount) { flat = e.viewCount === 1; show(); }
  });
  modeBtn.addEventListener('click', () => {
    handle.setStereoEnabled(flat).catch(() => {
      // No flat mode on this display (nothing changed): a depth slider at 0 is flat on any display.
      flat = !flat;
      depth.value = flat ? 0 : 1;
      handle.setViewRig(rig(Number(depth.value)));
      show();
    });
  });
  show();
  hud.textContent = `Rings ${score}`;
  await handle.firstWoven;                        // cover until the first woven frame
  cover.remove();                                 // cut, never fade
} else {
  // An ordinary browser: the same game, flat, with the same layout.
  sizeStore();
  new ResizeObserver(() => sizeStore()).observe(canvas);
  cover.remove();
  depth.disabled = modeBtn.disabled = true;
  modeBtn.textContent = '2D';
  note.textContent = 'Open this page in the DisplayXR Browser on a 3D display to see it in 3D.';
  hud.textContent = `Rings ${score}`;
  requestAnimationFrame(onMonoFrame);
}
