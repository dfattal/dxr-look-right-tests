// Solar system — a tabletop orrery on a DISPLAY rig, framed by SceneViewer. Rules:
// sdk/docs/making-3d-look-right.md. Plumbing follows sdk/samples/starter-ui.
//
// RIG (guide §1): the user looks at a thing; nobody walks through it. So a display rig: the canvas
// is a portal onto a virtual display VDH metres tall, and SceneViewer scales the system into it.
//
// SCREEN PLANE (§2): the sun sits on the glass; the system's depth budget is centred on it, with
// depthOffset, so the "behind" half of the budget is used too.
//
// STARFIELD (§3, §4): the stars are one flat sheet at one depth, BEHIND the whole system. They live
// in viewer.scene, not viewer.content, so the fit, the pivot and depthOffset never move them. One
// depth gives one disparity across the frame.

import * as THREE from 'three';
import { createInline3D } from '@displayxr/inline3d';
import { EyeCamera, displayRig } from '@displayxr/inline3d/three';
import { SceneViewer } from '@displayxr/inline3d/viewer';

const canvas = document.getElementById('scene');
const cover = document.getElementById('cover');
const depth = document.getElementById('depth');
const modeBtn = document.getElementById('mode');
const modeNote = document.getElementById('modeNote');

const VDH = 0.24;                     // virtual display height, metres — the SAME on addScene
const FRONT = 0.1, BACK = 0.12;       // depth budget for the system, tile heights (16:9). Comfortable
                                      // column is 0.1 h / 0.27 h; BACK is kept shallow so the stars fit behind.
const STAR_DEPTH = 0.16;              // starfield, tile heights BEHIND the glass. On a 16:9 tile that is
                                      // 0.16 × 10 × 0.5625 ≈ 0.9 % of the width: inside the 1.0 % full-frame limit.
const TILT = 0.25;                    // radians the orbital plane is tipped away from the glass
const MARGIN = 0.7;                   // share of the tile height the system may fill; keeps the in-front
                                      // planets well clear of the top and bottom edges (§4)
const BG = '#05070d';                 // == the page colour behind the canvas (index.html)
const SPEED = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.25 : 1;

// ---- helpers -----------------------------------------------------------------------------------
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// A fine irregular grain on a surface: stereo matching needs detail to lock onto.
function speckle(base, contrast = 0.25) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,255,255'},${rnd() * contrast})`;
    g.fillRect(rnd() * 128, rnd() * 128, 1 + rnd() * 5, 1 + rnd() * 5);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.7, metalness: 0 });
}

// A dim dotted orbit: thin, bright lines ghost on the panel, so keep them low-contrast.
const ORBIT_MAT = new THREE.LineBasicMaterial({ color: '#2a3652' });
function orbitRing(r) {
  const pts = [];
  for (let i = 0; i < 256; i++) {
    const a = (i / 256) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0));
  }
  return new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), ORBIT_MAT);
}

// ---- viewer: the framed, woven window onto the scene ---------------------------------------------
const viewer = new SceneViewer(THREE, canvas, {
  virtualDisplayHeight: VDH,
  clearColor: BG,                     // OPAQUE clear: alpha-0 pixels weave as stale/black
  margin: MARGIN,
  depthFit: { front: FRONT, back: BACK },
  fitSweep: false,                    // nothing turns the system, so budget its real depth
  orbit: false,                       // drag-to-spin would swing the orbits' width into depth
  idleSpin: 0,
  // no `feather`: it fades to transparent, which needs an alpha clear (guide §5)
}).useEyeCamera(EyeCamera);

// ---- the system: sun, four planets, one moon. Units are arbitrary: fitTo scales the whole thing. ----
// Orbits lie in the system's xy-plane. Periods follow Kepler's third law (T ∝ r^1.5), so the inner
// planets race and the outer ones crawl.
const PLANETS = [
  { orbit: 0.42, radius: 0.05, period: 10, spin: 0.9, phase: 0.4, color: '#9c8170' },
  { orbit: 0.62, radius: 0.08, period: 18, spin: 0.5, phase: 2.2, color: '#d8b98c' },
  { orbit: 0.84, radius: 0.085, period: 28, spin: 1.2, phase: 4.1, color: '#3d7fc0',
    moon: { orbit: 0.17, radius: 0.024, period: 4, color: '#b9bcc4' } },
  { orbit: 1.06, radius: 0.065, period: 40, spin: 0.8, phase: 5.3, color: '#c05a3c' },
];

const system = new THREE.Group();
system.rotation.x = TILT;             // tip the orbital plane a little; keeps depth inside the budget
viewer.content.add(system);

const sunMat = speckle('#ffc266', 0.15);
sunMat.emissive.set('#ff9a3c');
sunMat.emissiveIntensity = 1.2;
const sun = new THREE.Mesh(new THREE.SphereGeometry(0.16, 48, 32), sunMat);
system.add(sun);
// The sun lights every body from the centre. Decay 0: no falloff with distance, so the far planets
// are lit as well as the near ones. No shadows.
system.add(new THREE.PointLight(0xfff1dd, 2.2, 0, 0));

const unitSphere = new THREE.SphereGeometry(1, 40, 28);
const bodies = [];
let reach = 0;                        // farthest any body or moon reaches from the sun
for (const p of PLANETS) {
  system.add(orbitRing(p.orbit));
  const pivot = new THREE.Group();    // rotates about the sun: this is the orbit
  pivot.rotation.z = p.phase;
  system.add(pivot);
  const carrier = new THREE.Group();  // sits on the orbit; moons and the planet hang off it
  carrier.position.x = p.orbit;
  pivot.add(carrier);
  const planet = new THREE.Mesh(unitSphere, speckle(p.color));
  planet.scale.setScalar(p.radius);
  carrier.add(planet);
  reach = Math.max(reach, p.orbit + p.radius);

  const body = { pivot, planet, omega: (2 * Math.PI) / p.period, spin: p.spin, moonPivot: null, moonOmega: 0 };
  if (p.moon) {
    const moonPivot = new THREE.Group();   // rotates about the planet
    carrier.add(moonPivot);
    moonPivot.add(orbitRing(p.moon.orbit));
    const moon = new THREE.Mesh(unitSphere, speckle(p.moon.color));
    moon.scale.setScalar(p.moon.radius);
    moon.position.x = p.moon.orbit;
    moonPivot.add(moon);
    reach = Math.max(reach, p.orbit + p.moon.orbit + p.moon.radius);
    body.moonPivot = moonPivot;
    body.moonOmega = (2 * Math.PI) / p.moon.period;
  }
  bodies.push(body);
}

// ---- the starfield: one flat sheet of stars at ONE depth, behind everything --------------------
function softDot() {                  // round, soft stars: hard single pixels ghost more
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.6)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}
function starfield() {
  const N = 2600;
  const HALF_W = 0.5, HALF_H = 0.35;  // display metres: wider than the tile's frustum at that depth
  const z = -STAR_DEPTH * VDH;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (rnd() * 2 - 1) * HALF_W;
    pos[i * 3 + 1] = (rnd() * 2 - 1) * HALF_H;
    pos[i * 3 + 2] = z;
    const b = 0.15 + 0.6 * rnd() ** 3;  // most stars faint, a few bright: keeps the contrast low
    col[i * 3] = b * 0.9;
    col[i * 3 + 1] = b * 0.95;
    col[i * 3 + 2] = b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({
    size: 2.5,                        // pixels (sizeAttenuation off), so stars stay the same size at any depth
    sizeAttenuation: false,
    vertexColors: true,
    map: softDot(),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  viewer.scene.add(new THREE.Points(geo, mat));
}

// The starfield and the scene-level hemisphere light go into viewer.scene.
viewer.scene.add(new THREE.HemisphereLight(0x8aa0d6, 0x0a0c12, 0.3));
starfield();

// ---- frame: centre the depth budget on the glass, then fit the system to the tile ----------------
// The orbits all lie in one plane, tipped by TILT, and every body stays inside a disc of radius
// `reach` about the sun. A disc tipped by TILT spans ±reach·cos(TILT) vertically and ±reach·sin(TILT)
// in depth, so this box holds for every orbit at every time. (The bodies move, so measuring the
// content with a Box3 would be wrong.)
viewer.depthOffset = ((FRONT - BACK) / 2) * VDH;   // both ends of the budget are used
viewer.fitTo([0, 0, 0], [2 * reach, 2 * reach * Math.cos(TILT), 2 * reach * Math.sin(TILT)]);

// ---- animation: SceneViewer calls onTick once per drawn frame, woven or flat --------------------
let last = 0;
viewer.onTick = () => {
  const now = performance.now();
  const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
  last = now;
  for (const b of bodies) {
    b.pivot.rotation.z += b.omega * SPEED * dt;
    b.planet.rotation.y += b.spin * SPEED * dt;
    if (b.moonPivot) b.moonPivot.rotation.z += b.moonOmega * SPEED * dt;
  }
  sun.rotation.y += 0.2 * SPEED * dt;
};

// ---- boot ----------------------------------------------------------------------------------------
const wall = await createInline3D({ lazy: false });
if (!wall.supported) {
  // An ordinary browser: the same page, flat. Same layout; the 3D controls rest, and say why.
  viewer.startMono();
  cover.remove();
  depth.disabled = modeBtn.disabled = true;
  modeBtn.textContent = '2D';
  modeNote.textContent = 'Open this page in the DisplayXR Browser on a 3D display to see it in 3D.';
} else {
  // Depth slider: ONE value k moves BOTH the stereo (ipdFactor) and the look-around
  // (parallaxFactor). On a display rig 1 is what the display does naturally; below 1 only makes it
  // shallower.
  const rig = (k) => displayRig({ virtualDisplayHeight: VDH, ipdFactor: k, parallaxFactor: k });
  const handle = wall.addScene(canvas, viewer.onFrame, { viewRig: rig(1), onLayerLost: viewer.onLayerLost });
  wall.session.updateRenderState({ depthNear: 0.01, depthFar: 20 });
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
      // No flat mode on this display (nothing changed): the depth slider at 0 is flat anywhere.
      flat = !flat;
      depth.value = flat ? 0 : 1;
      handle.setViewRig(rig(Number(depth.value)));
      show();
    });
  });
  show();
  await handle.firstWoven;            // cover until the first woven frame
  cover.remove();                     // cut, never fade
}
