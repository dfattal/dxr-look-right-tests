import * as THREE from 'three';
import { createInline3D } from '@displayxr/inline3d';

const canvas = document.getElementById('stage');
const cover = document.getElementById('cover');
const statusEl = document.getElementById('status');
const BG = 0x15171d;                       // dark grey, never pure black (crosstalk)

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(1);                 // getViewport() is in backing-store px
renderer.autoClear = false;
renderer.setClearColor(BG, 1);

const scene = new THREE.Scene();

// Authored in metres for a 0.12 m virtual display; z=0 is the glass, +z toward the viewer.
const VDH = 0.12;

// Starfield: dim small points well behind the glass (modest disparity), wider than the
// window so head-tracking parallax never reveals an edge.
const starMat = new THREE.PointsMaterial({ size: 2.5, sizeAttenuation: false, vertexColors: true });
{
  const N = 1400, pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 0.5;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 0.3;
    pos[i * 3 + 2] = -0.05 - Math.random() * 0.06;
    const b = 0.35 + Math.random() * 0.45, t = Math.random();
    col[i * 3] = b * (0.85 + 0.15 * t); col[i * 3 + 1] = b * 0.9; col[i * 3 + 2] = b * (1 - 0.15 * t);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  scene.add(new THREE.Points(g, starMat));
}

// Tabletop: orbital plane tilted so the near side comes out of the glass and the far side recedes.
const table = new THREE.Group();
table.rotation.x = 0.42;
scene.add(table);

const sun = new THREE.Mesh(new THREE.SphereGeometry(0.011, 48, 32), new THREE.MeshBasicMaterial({ color: 0xffc766 }));
table.add(sun);
{
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'), gr = x.createRadialGradient(64, 64, 4, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,200,110,0.55)'); gr.addColorStop(1, 'rgba(255,160,60,0)');
  x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  }));
  s.scale.setScalar(0.04);
  table.add(s);
}
table.add(new THREE.PointLight(0xfff0d8, 3.2, 0, 0));
scene.add(new THREE.HemisphereLight(0x9fb4ff, 0x2a2430, 0.45));

const defs = [
  { r: 0.028, size: 0.0035, color: 0xb8a58f, speed: 1.6 },
  { r: 0.043, size: 0.0055, color: 0xe3a45b, speed: 1.1 },
  { r: 0.059, size: 0.0060, color: 0x4f8fe0, speed: 0.75, moon: true },
  { r: 0.076, size: 0.0048, color: 0xd0583f, speed: 0.5 },
];
const planets = defs.map((d, i) => {
  const pts = Array.from({ length: 128 }, (_, k) => {
    const a = (k / 128) * Math.PI * 2;
    return new THREE.Vector3(Math.cos(a) * d.r, 0, Math.sin(a) * d.r);
  });
  table.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color: 0x4a5164 })));
  const pivot = new THREE.Group(); table.add(pivot);
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(d.size, 32, 24),
    new THREE.MeshStandardMaterial({ color: d.color, roughness: 0.75, metalness: 0 }));
  mesh.position.x = d.r; pivot.add(mesh);
  pivot.rotation.y = i * 1.7;
  let moon = null;
  if (d.moon) {
    moon = new THREE.Group(); mesh.add(moon);
    const mm = new THREE.Mesh(new THREE.SphereGeometry(0.0017, 20, 16),
      new THREE.MeshStandardMaterial({ color: 0xcfd2d8, roughness: 0.9 }));
    mm.position.x = 0.0105; moon.add(mm);
  }
  return { d, pivot, mesh, moon };
});

// ---- cameras ---------------------------------------------------------------------------
const monoCam = new THREE.PerspectiveCamera(40, 16 / 9, 0.01, 2);
monoCam.position.set(0, 0, VDH / 2 / Math.tan(THREE.MathUtils.degToRad(20)));
monoCam.lookAt(0, 0, 0);
const eyeCam = new THREE.PerspectiveCamera();
eyeCam.matrixAutoUpdate = false;
function setCameraFromView(view) {
  eyeCam.projectionMatrix.fromArray(view.projectionMatrix);
  eyeCam.projectionMatrixInverse.copy(eyeCam.projectionMatrix).invert();
  eyeCam.matrix.fromArray(view.transform.matrix);
  eyeCam.matrixWorld.copy(eyeCam.matrix);
  eyeCam.matrixWorldInverse.copy(eyeCam.matrixWorld).invert();
}

let sbsMode = false;
function sizeToCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round((canvas.clientWidth || 640) * dpr);
  const h = Math.round((canvas.clientHeight || 360) * dpr);
  renderer.setSize(sbsMode ? w * 2 : w, h, false);
  monoCam.aspect = w / h; monoCam.updateProjectionMatrix();
  starMat.size = 2.5 * dpr;                // buffer px: ~2.5 CSS px
}
addEventListener('resize', sizeToCanvas);
sizeToCanvas();

// ---- animation -------------------------------------------------------------------------
let last = 0;
function animate(now) {
  const dt = last ? Math.min((now - last) / 1000, 0.1) : 0; last = now;
  sun.rotation.y += dt * 0.2;
  for (const p of planets) {
    p.pivot.rotation.y += dt * p.d.speed * 0.5;
    p.mesh.rotation.y += dt * 1.5;
    if (p.moon) p.moon.rotation.y += dt * 3.2;
  }
}

function onXRFrame(views, layer) {
  animate(performance.now());
  const size = new THREE.Vector2(); renderer.getSize(size);
  renderer.clear();
  renderer.setScissorTest(true);
  views.forEach((view, i) => {
    const vp = layer.getViewport(view) ||
      { x: i === 0 ? 0 : size.x / 2, y: 0, width: size.x / 2, height: size.y };
    renderer.setViewport(vp.x, vp.y, vp.width, vp.height);
    renderer.setScissor(vp.x, vp.y, vp.width, vp.height);
    setCameraFromView(view);
    renderer.render(scene, eyeCam);
  });
  renderer.setScissorTest(false);
}
function onMonoFrame(now) {
  requestAnimationFrame(onMonoFrame);
  animate(now);
  const size = new THREE.Vector2(); renderer.getSize(size);
  renderer.setViewport(0, 0, size.x, size.y);
  renderer.clear();
  renderer.render(scene, monoCam);
}

// ---- boot ------------------------------------------------------------------------------
const uncover = () => cover.remove();
setTimeout(uncover, 4000);                 // the cover must always come off
(async () => {
  try {
    const wall = await createInline3D({ lazy: false });
    if (wall.supported) {
      const handle = wall.addScene(canvas, onXRFrame, { virtualDisplayHeight: VDH });
      sbsMode = true; sizeToCanvas();
      statusEl.textContent = 'Inline 3D active — move your head to look around.';
      handle.firstWoven.then(uncover, uncover);
    } else {
      statusEl.textContent = '2D fallback — open in the DisplayXR Browser on a spatial display for 3D.';
      requestAnimationFrame(onMonoFrame);
      uncover();
    }
  } catch (e) {
    console.error(e);
    statusEl.textContent = '2D fallback (setup error).';
    sbsMode = false; sizeToCanvas();
    requestAnimationFrame(onMonoFrame);
    uncover();
  }
})();
