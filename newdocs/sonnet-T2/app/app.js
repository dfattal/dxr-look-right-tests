// Tabletop solar system on a DISPLAY rig (the user looks at a diorama, nobody walks through it),
// framed by SceneViewer + EyeCamera. Rules: sdk/docs/making-3d-look-right.md. See NOTES.md.
import * as THREE from 'three';
import { createInline3D } from '@displayxr/inline3d';
import { EyeCamera, displayRig } from '@displayxr/inline3d/three';
import { SceneViewer } from '@displayxr/inline3d/viewer';

const canvas = document.getElementById('scene');
const cover = document.getElementById('cover');
const depth = document.getElementById('depth');
const modeBtn = document.getElementById('mode');
const modeNote = document.getElementById('modeNote');

const VDH = 0.24;                 // virtual display height (m); same value on addScene's rig
const FRONT = 0.1, BACK = 0.27;   // comfortable budget, tile heights on 16:9 (~0.6 % / 1.5 % of width)
const BG = '#050813';             // == page colour behind the canvas

const viewer = new SceneViewer(THREE, canvas, {
  virtualDisplayHeight: VDH,
  clearColor: BG,                 // opaque clear
  depthFit: { front: FRONT, back: BACK },
  fitSweep: false,                // nothing turns the whole set; budget its real depth
  orbit: false,                   // dragging would swing width into depth past the fitted budget
}).useEyeCamera(EyeCamera);

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// Planet surface: banded/speckled so stereo matching has detail (a flat colour reads flat).
function surface(base, alt, bands = false) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 256, 128);
  if (bands) {
    for (let y = 0; y < 128; y += 4 + rnd() * 8) {
      g.fillStyle = alt; g.globalAlpha = 0.15 + rnd() * 0.35; g.fillRect(0, y, 256, 2 + rnd() * 6);
    }
  }
  for (let i = 0; i < 700; i++) {
    g.fillStyle = rnd() < 0.5 ? alt : '#000';
    g.globalAlpha = rnd() * 0.3;
    const s = 1 + rnd() * 7; g.fillRect(rnd() * 256, rnd() * 128, s, s);
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const mat = (base, alt, bands) => new THREE.MeshStandardMaterial({ map: surface(base, alt, bands), roughness: 0.8 });

// ---- the system: lies on the table (XZ plane), tilted toward the viewer -------------------------
const TILT = THREE.MathUtils.degToRad(24);   // shallow: depth of the disc ~ 0.4 x its diameter
const system = new THREE.Group();
system.rotation.x = TILT;
viewer.content.add(system);

const sunMesh = new THREE.Mesh(
  new THREE.SphereGeometry(0.55, 48, 32),
  new THREE.MeshBasicMaterial({ map: surface('#ffb52e', '#ff6a00', true) }));
system.add(sunMesh);
system.add(new THREE.PointLight(0xfff0d0, 90, 0, 1.6));
viewer.scene.add(new THREE.AmbientLight(0x6a7aa8, 0.9));

const PLANETS = [
  { r: 1.3, size: 0.17, speed: 1.6, mat: mat('#9a8f86', '#5a4f48') },
  { r: 2.0, size: 0.26, speed: 1.1, mat: mat('#d9b46a', '#a0742a', true) },
  { r: 2.9, size: 0.30, speed: 0.75, mat: mat('#3f78c8', '#2fa05a'), moon: true },
  { r: 3.9, size: 0.24, speed: 0.5, mat: mat('#c8603a', '#7a2a14'), ring: true },
];
const bodies = [];
for (const p of PLANETS) {
  const pts = Array.from({ length: 128 }, (_, i) => {
    const a = (i / 128) * Math.PI * 2;
    return new THREE.Vector3(Math.cos(a) * p.r, 0, Math.sin(a) * p.r);
  });
  // dim orbit line: sharp bright lines ghost
  system.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color: 0x3a4670 })));
  const pivot = new THREE.Group();
  const planet = new THREE.Mesh(new THREE.SphereGeometry(p.size, 40, 28), p.mat);
  planet.position.x = p.r;
  pivot.add(planet);
  pivot.rotation.y = rnd() * Math.PI * 2;
  system.add(pivot);
  const b = { pivot, planet, speed: p.speed };
  if (p.ring) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(p.size * 1.5, p.size * 2.3, 64),
      new THREE.MeshStandardMaterial({ color: 0xd8b98a, side: THREE.DoubleSide, roughness: 0.9 }));
    ring.rotation.x = Math.PI / 2 - 0.35;
    planet.add(ring);
  }
  if (p.moon) {
    b.moonPivot = new THREE.Group();
    const moon = new THREE.Mesh(new THREE.SphereGeometry(0.085, 24, 16), mat('#b8b8b8', '#666'));
    moon.position.x = 0.58;
    b.moonPivot.add(moon);
    planet.add(b.moonPivot);
  }
  bodies.push(b);
}

// ---- starfield: a thin slab of points BEHIND the system (a backdrop, not an infinite sphere:
// infinity would exceed the behind budget). Outside the tilted group, facing the viewer.
const sysBox = new THREE.Box3().setFromObject(system).expandByScalar(0.35);  // sun+rings+planets bound
const sz = sysBox.getSize(new THREE.Vector3());
const SLAB = 1.2;                                                            // slab thickness, model units
const N = 1400, pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
for (let i = 0; i < N; i++) {
  pos[i * 3] = (rnd() - 0.5) * sz.x * 3;          // overscan: the tile is wider than the system
  pos[i * 3 + 1] = (rnd() - 0.5) * sz.y * 4;
  pos[i * 3 + 2] = sysBox.min.z - 0.3 - rnd() * SLAB;
  const v = 0.45 + rnd() * 0.4;                   // mid-bright, not pure white (less ghosting)
  col[i * 3] = v * (0.85 + rnd() * 0.15); col[i * 3 + 1] = v * 0.92; col[i * 3 + 2] = v;
}
const sg = new THREE.BufferGeometry();
sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
sg.setAttribute('color', new THREE.BufferAttribute(col, 3));
viewer.content.add(new THREE.Points(sg, new THREE.PointsMaterial({ size: 0.05, vertexColors: true, sizeAttenuation: true })));

// Fit on the system's x/y extent and a z extent that includes the star slab.
viewer.depthOffset = -((BACK - FRONT) / 2) * VDH;
const zMin = sysBox.min.z - 0.3 - SLAB, zMax = sysBox.max.z;
viewer.fitTo(
  [(sysBox.min.x + sysBox.max.x) / 2, (sysBox.min.y + sysBox.max.y) / 2, (zMin + zMax) / 2],
  [sz.x, sz.y, zMax - zMin]);

let lastT = 0;
viewer.onTick = () => {
  const now = performance.now(), dt = lastT ? Math.min((now - lastT) / 1000, 0.1) : 0;
  lastT = now;
  sunMesh.rotation.y += dt * 0.1;
  for (const b of bodies) {
    b.pivot.rotation.y += dt * b.speed * 0.5;
    b.planet.rotation.y += dt * 0.8;
    if (b.moonPivot) b.moonPivot.rotation.y += dt * 2.2;
  }
};

// ---- boot ---------------------------------------------------------------------------------------
const wall = await createInline3D({ lazy: false });
if (!wall.supported) {
  viewer.startMono();
  cover.remove();
  depth.disabled = modeBtn.disabled = true;
  modeBtn.textContent = '2D';
  modeNote.textContent = 'Open this page in the DisplayXR Browser on a 3D display to see it in 3D.';
} else {
  const rig = (k) => displayRig({ virtualDisplayHeight: VDH, ipdFactor: k, parallaxFactor: k });
  const handle = wall.addScene(canvas, viewer.onFrame, { viewRig: rig(1), onLayerLost: viewer.onLayerLost });
  wall.session.updateRenderState({ depthNear: 0.01, depthFar: 20 });
  depth.addEventListener('input', () => handle.setViewRig(rig(Number(depth.value))));
  let flat = false;
  const show = () => {
    modeBtn.textContent = flat ? 'Show in 3D' : 'Show in 2D';
    modeBtn.setAttribute('aria-pressed', String(flat));
  };
  handle.on('renderingmodechange', (e) => { if (e.viewCount) { flat = e.viewCount === 1; show(); } });
  modeBtn.addEventListener('click', () => {
    handle.setStereoEnabled(flat).catch(() => {
      flat = !flat;
      depth.value = flat ? 0 : 1;
      handle.setViewRig(rig(Number(depth.value)));
      show();
    });
  });
  show();
  await handle.firstWoven;
  cover.remove();
}
