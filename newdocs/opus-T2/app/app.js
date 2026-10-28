// A tabletop solar system on a spatial display. Built from samples/starter-scene + starter-ui;
// rules: sdk/docs/making-3d-look-right.md.
//
// RIG (guide §1): the user LOOKS AT an orrery on a table; nobody flies through it → DISPLAY rig,
// framed by SceneViewer. The canvas is a portal onto a virtual display VDH metres tall, so the
// depth does not depend on the units the orrery is modelled in.
//
// SCREEN PLANE (§2): through the subject. SceneViewer centres the orrery's box on the glass; the
// sun sits at the box centre, so the sun is (almost) at zero disparity, the near half of every
// orbit comes out of the glass and the far half recedes.
//
// DEPTH (§3), all in tile heights h, 16:9 tile (disparity % of width ≈ 10 × d × 9/16):
//   orrery front   +0.10 h  ≈ 0.56 %   (comfortable in-front limit 0.6 %)
//   orrery back    −0.16 h  ≈ 0.90 %
//   stars          −0.18 … −0.21 h ≈ 1.0 … 1.2 %
//   nebula plane   −0.22 h  ≈ 1.24 %   (comfortable behind limit 1.5 %; full-frame row says 1.0 %,
//                                        so the nebula is kept dim and low-contrast to ghost less)
// The starfield is the only thing that reaches the frame edges, and it is all BEHIND the glass
// (§4). The orrery stays in the middle ~45 % of the frame, so nothing in front of the glass
// touches an edge, and no HTML sits over the tile at all (§6).

import * as THREE from 'three';
import { createInline3D } from '@displayxr/inline3d';
import { EyeCamera, displayRig } from '@displayxr/inline3d/three';
import { SceneViewer } from '@displayxr/inline3d/viewer';

const canvas = document.getElementById('scene');
const cover = document.getElementById('cover');
const depth = document.getElementById('depth');
const speed = document.getElementById('speed');
const pauseBtn = document.getElementById('pause');
const modeBtn = document.getElementById('mode');
const modeNote = document.getElementById('modeNote');

const VDH = 0.24;                      // virtual display height, metres — the SAME on the view rig
const FRONT = 0.10, BACK = 0.16;       // orrery depth budget, tile heights (16:9)
const STARS_NEAR = 0.18, STARS_FAR = 0.21, NEBULA = 0.22;   // backdrop depths, tile heights behind
const BG = '#04060c';                  // == the page colour behind the canvas (index.html)
const TILT = THREE.MathUtils.degToRad(62);   // orbital plane seen from 62° above: a tabletop view
                                             // that keeps the disc's depth (2R·cos 62°) affordable

const viewer = new SceneViewer(THREE, canvas, {
  virtualDisplayHeight: VDH,
  clearColor: BG,                      // OPAQUE clear: alpha-0 pixels weave as stale/black
  depthFit: { front: FRONT, back: BACK },
  fitSweep: false,                     // the fit box below already holds every orbit's full sweep
  orbit: false,                        // drag-to-spin would tip the disc's width into depth, past
                                       // the budget; head tracking still looks around it
  // no `feather`: it fades to transparent, which needs an alpha clear (guide §5)
}).useEyeCamera(EyeCamera);

// ---- procedural textures (irregular detail everywhere: stereo matching needs texture) --------------
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
function canvasTex(w, h, paint) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  paint(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function speckle(g, w, h, n, contrast, maxSize = 6) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,255,255'},${rnd() * contrast})`;
    const s = 1 + rnd() * maxSize;
    g.fillRect(rnd() * w, rnd() * h, s, s * (0.6 + rnd() * 0.8));
  }
}
function blobs(g, w, h, n, colour, rMin, rMax, alpha) {
  for (let i = 0; i < n; i++) {
    const x = rnd() * w, y = h * (0.12 + rnd() * 0.76), r = rMin + rnd() * (rMax - rMin);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, colour.replace('A', alpha));
    grd.addColorStop(1, colour.replace('A', 0));
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
}
function bands(g, w, h, colours) {
  let y = 0;
  while (y < h) {
    const bh = 4 + rnd() * 22;
    g.fillStyle = colours[Math.floor(rnd() * colours.length)];
    g.fillRect(0, y, w, bh + 1);
    y += bh;
  }
  speckle(g, w, h, 1400, 0.12, 10);
}
function radialSprite(stops) {
  return canvasTex(128, 128, (g) => {
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    for (const [o, c] of stops) grd.addColorStop(o, c);
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
  });
}

// ---- the orrery, modelled in "orrery units" (sun radius 1); fitTo scales it ----------------------
const system = new THREE.Group();      // the tabletop disc, tilted toward the viewer
system.rotation.x = TILT;
viewer.content.add(system);

// Sun: unlit, granulated, with a soft additive glow. It sits at the glass, the sharpest plane,
// which is where the brightest, highest-contrast object in the scene belongs (§4.6).
const SUN_R = 1;
const sunTex = canvasTex(512, 256, (g, w, h) => {
  g.fillStyle = '#ffb53d'; g.fillRect(0, 0, w, h);
  blobs(g, w, h, 60, 'rgba(255,236,150,A)', 10, 40, 0.5);
  blobs(g, w, h, 40, 'rgba(225,110,20,A)', 8, 30, 0.45);
  speckle(g, w, h, 2500, 0.18, 4);
});
const sun = new THREE.Mesh(new THREE.SphereGeometry(SUN_R, 64, 32), new THREE.MeshBasicMaterial({ map: sunTex }));
system.add(sun);
const glow = new THREE.Sprite(new THREE.SpriteMaterial({
  map: radialSprite([[0, 'rgba(255,210,120,0.55)'], [0.35, 'rgba(255,160,60,0.22)'], [1, 'rgba(255,120,40,0)']]),
  blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
}));
glow.scale.setScalar(SUN_R * 3.6);
system.add(glow);
// The sun lights the planets. decay 0: the content is scaled into display metres by the fit, and a
// physical falloff would then depend on that scale.
system.add(new THREE.PointLight(0xfff0d8, 3.2, 0, 0));
viewer.scene.add(new THREE.HemisphereLight(0x8fa6d8, 0x1a1420, 0.22));   // night sides stay readable

const PLANETS = [
  { name: 'cinder', a: 1.85, r: 0.20, period: 7,  tilt: 0.05, paint: (g, w, h) => {
      g.fillStyle = '#9d958c'; g.fillRect(0, 0, w, h);
      blobs(g, w, h, 70, 'rgba(60,55,50,A)', 3, 14, 0.5); speckle(g, w, h, 2000, 0.25, 4); } },
  { name: 'azure', a: 2.65, r: 0.32, period: 13, tilt: 0.41, moon: true, paint: (g, w, h) => {
      g.fillStyle = '#2f6fc8'; g.fillRect(0, 0, w, h);
      blobs(g, w, h, 26, 'rgba(70,140,70,A)', 14, 46, 0.9);
      blobs(g, w, h, 14, 'rgba(160,130,80,A)', 8, 24, 0.6);
      blobs(g, w, h, 40, 'rgba(255,255,255,A)', 8, 30, 0.45);
      g.fillStyle = 'rgba(240,248,255,0.85)'; g.fillRect(0, 0, w, h * 0.06); g.fillRect(0, h * 0.94, w, h * 0.06);
      speckle(g, w, h, 1200, 0.1, 4); } },
  { name: 'rust', a: 3.45, r: 0.26, period: 21, tilt: 0.44, paint: (g, w, h) => {
      g.fillStyle = '#b8542f'; g.fillRect(0, 0, w, h);
      blobs(g, w, h, 40, 'rgba(90,35,20,A)', 8, 30, 0.6);
      blobs(g, w, h, 30, 'rgba(230,150,90,A)', 6, 20, 0.4);
      speckle(g, w, h, 2200, 0.2, 4); } },
  { name: 'giant', a: 4.55, r: 0.58, period: 36, tilt: 0.47, ring: [0.78, 1.25], paint: (g, w, h) => {
      bands(g, w, h, ['#d9b27c', '#c99a62', '#ead2a6', '#b88352', '#e3c390', '#a87448']); } },
];
const OUTER = Math.max(...PLANETS.map((p) => p.a + (p.ring ? p.ring[1] * p.r : p.r)));

const orbitMat = new THREE.LineBasicMaterial({ color: 0x51648c, transparent: true, opacity: 0.45 });
function orbitLine(radius, segments = 160) {
  const pts = [];
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(t) * radius, 0, Math.sin(t) * radius));
  }
  return new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), orbitMat);
}

function ringMesh(inner, outer) {
  const geo = new THREE.RingGeometry(inner, outer, 128, 1);
  const pos = geo.attributes.position, uv = geo.attributes.uv, v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {          // radial UVs, so the texture reads as bands
    v.fromBufferAttribute(pos, i);
    uv.setXY(i, (v.length() - inner) / (outer - inner), 0.5);
  }
  const tex = canvasTex(256, 4, (g, w, h) => {
    for (let x = 0; x < w; x++) {
      const a = (0.25 + 0.6 * rnd()) * (x < 8 || x > w - 6 ? 0.3 : 1) * (x > 150 && x < 162 ? 0.15 : 1);
      const l = 62 + rnd() * 20;
      g.fillStyle = `hsla(36, 38%, ${l}%, ${a})`;
      g.fillRect(x, 0, 1, h);
    }
  });
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false, roughness: 0.9,
  }));
  m.rotation.x = -Math.PI / 2;
  return m;
}

const bodies = [];
for (const p of PLANETS) {
  system.add(orbitLine(p.a));
  const orbit = new THREE.Group();               // turns about the sun
  orbit.rotation.y = rnd() * Math.PI * 2;        // a staggered starting phase
  const holder = new THREE.Group();              // at the planet's position; carries the axial tilt
  holder.position.x = p.a;
  holder.rotation.z = p.tilt;
  const planet = new THREE.Mesh(
    new THREE.SphereGeometry(p.r, 48, 24),
    new THREE.MeshStandardMaterial({ map: canvasTex(512, 256, p.paint), roughness: 0.85, metalness: 0 }),
  );
  holder.add(planet);
  if (p.ring) holder.add(ringMesh(p.ring[0] * p.r, p.ring[1] * p.r));
  orbit.add(holder);
  let moonOrbit = null;
  if (p.moon) {
    moonOrbit = new THREE.Group();
    moonOrbit.position.x = p.a;
    moonOrbit.rotation.z = 0.12;                 // a slightly inclined moon orbit
    const moon = new THREE.Mesh(
      new THREE.SphereGeometry(0.085, 32, 16),
      new THREE.MeshStandardMaterial({ map: canvasTex(256, 128, (g, w, h) => {
        g.fillStyle = '#b9b6b0'; g.fillRect(0, 0, w, h);
        blobs(g, w, h, 30, 'rgba(70,70,75,A)', 3, 10, 0.5); speckle(g, w, h, 900, 0.2, 3);
      }), roughness: 0.95 }),
    );
    moon.position.x = 0.55;
    moonOrbit.add(moon);
    orbit.add(moonOrbit);
  }
  system.add(orbit);
  bodies.push({ ...p, orbit, planet, moonOrbit });
}

// ---- the backdrop: stars and a faint nebula, placed straight in DISPLAY space -------------------
// viewer.scene is in display metres (glass at z = 0, +z toward the viewer, tile VDH tall). Putting
// the backdrop here, not in viewer.content, keeps it out of the fit (the orrery is not shrunk to
// make room for it) and pins it at a known depth behind the glass whatever the orrery's scale.
// It spans far beyond the tile so head-tracked look-around never reaches its edge.
const W = 5 * VDH, H = 3 * VDH;
{
  const N = 2600;
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (rnd() - 0.5) * W;
    pos[i * 3 + 1] = (rnd() - 0.5) * H;
    pos[i * 3 + 2] = -(STARS_NEAR + rnd() * (STARS_FAR - STARS_NEAR)) * VDH;
    // Mostly dim: bright white points on black are the first thing to ghost (§3, §4.6).
    const b = 0.25 + 0.55 * Math.pow(rnd(), 2.2);
    const warm = rnd();
    col[i * 3] = b * (0.85 + 0.15 * warm);
    col[i * 3 + 1] = b * 0.9;
    col[i * 3 + 2] = b * (1 - 0.15 * warm);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const stars = new THREE.Points(geo, new THREE.PointsMaterial({
    size: 3, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false,
    map: radialSprite([[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.55)'], [1, 'rgba(255,255,255,0)']]),
  }));
  stars.renderOrder = -1;
  viewer.scene.add(stars);

  const nebula = new THREE.Mesh(
    new THREE.PlaneGeometry(W, H),
    new THREE.MeshBasicMaterial({ map: canvasTex(1024, 640, (g, w, h) => {
      g.fillStyle = BG; g.fillRect(0, 0, w, h);
      blobs(g, w, h, 18, 'rgba(70,40,120,A)', 80, 260, 0.22);
      blobs(g, w, h, 14, 'rgba(25,70,120,A)', 60, 220, 0.2);
      blobs(g, w, h, 8, 'rgba(120,50,80,A)', 40, 140, 0.12);
      speckle(g, w, h, 4000, 0.035, 3);           // faint grain so the plane itself fuses
    }) }),
  );
  nebula.position.z = -NEBULA * VDH;
  nebula.renderOrder = -2;
  viewer.scene.add(nebula);
}

// ---- framing --------------------------------------------------------------------------------------
// Fit on a box that holds every orbit's FULL sweep (a torus at the outer radius, tubes as thick as
// the giant's ring) plus the sun, after the tilt, so depthFit budgets every planet position.
const sweep = new THREE.Mesh(new THREE.TorusGeometry(OUTER - 0.7, 0.7, 12, 96).rotateX(Math.PI / 2));
system.add(sweep);
system.updateMatrixWorld(true);
const box = new THREE.Box3().setFromObject(viewer.content, true);
system.remove(sweep);
sweep.geometry.dispose();
// Split the leftover budget so the box is used front AND back: centre at −(BACK − FRONT)/2.
viewer.depthOffset = -((BACK - FRONT) / 2) * VDH;
viewer.fitTo(box.getCenter(new THREE.Vector3()), box.getSize(new THREE.Vector3()));
{
  const b = viewer.getSubjectBounds();
  console.info(`[orrery] placement, tile heights: front ${(b.front / VDH).toFixed(3)}, back ${(b.back / VDH).toFixed(3)}, ` +
    `width ${(b.extent.x / VDH).toFixed(2)}, height ${(b.extent.y / VDH).toFixed(2)}`);
}

// ---- animation -----------------------------------------------------------------------------------
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let paused = false;
let timeScale = reduceMotion ? 0.35 : 1;
speed.value = String(timeScale);
let lastT = 0;
viewer.onTick = () => {
  const now = performance.now(), dt = lastT ? Math.min((now - lastT) / 1000, 0.1) : 0;
  lastT = now;
  if (paused) return;
  const s = dt * timeScale;
  sun.rotation.y += s * 0.08;
  for (const b of bodies) {
    b.orbit.rotation.y += s * (Math.PI * 2) / b.period;
    b.planet.rotation.y += s * 0.9;
    if (b.moonOrbit) b.moonOrbit.rotation.y += s * (Math.PI * 2) / 2.6;
  }
};
speed.addEventListener('input', () => { timeScale = Number(speed.value); });
pauseBtn.addEventListener('click', () => {
  paused = !paused;
  pauseBtn.textContent = paused ? 'Play' : 'Pause';
});

// ---- boot ----------------------------------------------------------------------------------------
const wall = await createInline3D({ lazy: false });
if (!wall.supported) {
  // An ordinary browser: the same page, flat, same layout. The 3D controls rest, and say why.
  viewer.startMono();
  cover.remove();
  depth.disabled = modeBtn.disabled = true;
  modeBtn.textContent = '2D';
  modeNote.textContent = 'Open this page in the DisplayXR Browser on a 3D display to see it in 3D.';
} else {
  const rig = (k) => displayRig({ virtualDisplayHeight: VDH, ipdFactor: k, parallaxFactor: k });
  const handle = wall.addScene(canvas, viewer.onFrame, { viewRig: rig(1), onLayerLost: viewer.onLayerLost });
  wall.session.updateRenderState({ depthNear: 0.01, depthFar: 20 });

  // Depth slider: ONE value k drives BOTH factors. On a display rig 1 is the display's natural
  // depth; lower only makes it shallower (never raise ipdFactor above 1 here).
  depth.addEventListener('input', () => handle.setViewRig(rig(Number(depth.value))));

  // 2D/3D switch; the label follows what the display REPORTS, not the click.
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
      // No flat mode on this display (nothing changed): depth 0 is flat on any display.
      flat = !flat;
      depth.value = flat ? 0 : 1;
      handle.setViewRig(rig(Number(depth.value)));
      show();
    });
  });
  show();
  await handle.firstWoven;             // cover until the first woven frame
  cover.remove();                      // cut, never fade
}
