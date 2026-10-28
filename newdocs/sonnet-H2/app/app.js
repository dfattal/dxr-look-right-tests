// Desk aquarium — a three.js object scene framed by SceneViewer on a DISPLAY rig.
// RIG: the user looks AT a tabletop object (a diorama), nobody walks through it -> display rig.
// SCREEN PLANE: through the tank, nudged back with depthOffset to use the larger "behind" budget.
// DEPTH: depthFit {front 0.1, back 0.27} tile heights (16:9, comfortable column ~0.6 % / 1.5 %
// of the width), fitted on the tank's real box after its 3/4 turn. See NOTES.md.
import * as THREE from 'three';
import { createInline3D } from '@displayxr/inline3d';
import { EyeCamera, displayRig } from '@displayxr/inline3d/three';
import { SceneViewer } from '@displayxr/inline3d/viewer';

const canvas = document.getElementById('tank');
const cover = document.getElementById('cover');
const depth = document.getElementById('depth');
const modeBtn = document.getElementById('mode');
const modeNote = document.getElementById('modeNote');

const VDH = 0.24;
const FRONT = 0.1, BACK = 0.27;
const BG = '#07131f';                  // == page colour behind the canvas

const viewer = new SceneViewer(THREE, canvas, {
  virtualDisplayHeight: VDH,
  clearColor: BG,                      // opaque clear
  depthFit: { front: FRONT, back: BACK },
  fitSweep: false,                     // the tank never turns
  orbit: false,                        // orbiting would swing the tank's width into depth
}).useEyeCamera(EyeCamera);

// ---- helpers ---------------------------------------------------------------------------------
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
function speckleTex(base, contrast = 0.25, n = 1500, repeat) {   // irregular detail helps stereo matching
  return canvasTex(128, 128, (g) => {
    g.fillStyle = base; g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < n; i++) {
      g.fillStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,255,255'},${rnd() * contrast})`;
      g.fillRect(rnd() * 128, rnd() * 128, 1 + rnd() * 4, 1 + rnd() * 4);
    }
  }, repeat);
}
const mat = (map, o = {}) => new THREE.MeshStandardMaterial({ map, roughness: 0.8, ...o });

// ---- the tank (2.0 wide, 1.2 tall, 1.0 deep) ---------------------------------------------------
const W = 2.0, H = 1.2, D = 1.0;
const tank = new THREE.Group();
const yFloor = -H / 2, yTop = H / 2;
const WATER_TOP = yTop - 0.08;

// Back wall: soft vertical gradient so fish read against it; finite far plane (no infinity).
const backTex = canvasTex(8, 256, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, '#2a7fa6'); gr.addColorStop(0.6, '#145a82'); gr.addColorStop(1, '#0a3658');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
});
const back = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ map: backTex }));
back.position.set(0, 0, -D / 2);
tank.add(back);

// Water volume: a faint blue tint, no depth write.
const water = new THREE.Mesh(
  new THREE.BoxGeometry(W - 0.02, WATER_TOP - yFloor, D - 0.02),
  new THREE.MeshBasicMaterial({ color: 0x3aa0d0, transparent: true, opacity: 0.07, depthWrite: false }));
water.position.y = (WATER_TOP + yFloor) / 2;
water.renderOrder = 5;
tank.add(water);
const surface = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.02, D - 0.02).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0x9fd8f0, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
surface.position.y = WATER_TOP;
surface.renderOrder = 6;
tank.add(surface);

// Sandy floor: bumpy plane with speckle texture.
const sandH = (x, z) => 0.07 + 0.035 * Math.sin(x * 4.1 + 1) * Math.cos(z * 5.3)
  + 0.04 * Math.exp(-((x + 0.45) ** 2 + (z + 0.05) ** 2) * 6);
const sandGeo = new THREE.PlaneGeometry(W - 0.02, D - 0.02, 60, 30).rotateX(-Math.PI / 2);
{
  const p = sandGeo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, sandH(p.getX(i), p.getZ(i)) + (rnd() - 0.5) * 0.006);
  sandGeo.computeVertexNormals();
}
const sand = new THREE.Mesh(sandGeo, mat(speckleTex('#d9c28f', 0.35, 2500, [5, 3]), { roughness: 0.95 }));
sand.position.y = yFloor;
tank.add(sand);
const sandBlock = new THREE.Mesh(new THREE.BoxGeometry(W - 0.02, 0.07, D - 0.02), mat(speckleTex('#c9ae78', 0.3)));
sandBlock.position.y = yFloor + 0.035;
tank.add(sandBlock);
const sandY = (x, z) => yFloor + sandH(x, z);

// Rocks
const rockTex = speckleTex('#7b7f86', 0.35, 1500);
function rock(x, z, sx, sy, sz, tint) {
  const g = new THREE.IcosahedronGeometry(1, 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const k = 1 + 0.18 * Math.sin(p.getX(i) * 5 + p.getY(i) * 3) * Math.cos(p.getZ(i) * 4 + x * 9) + (rnd() - 0.5) * 0.06;
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat(rockTex, { color: tint, flatShading: true, roughness: 0.9 }));
  m.scale.set(sx, sy, sz);
  m.position.set(x, sandY(x, z) + sy * 0.35, z);
  m.rotation.y = rnd() * 6;
  tank.add(m);
}
rock(-0.45, -0.05, 0.26, 0.2, 0.2, 0xb0b4bc);
rock(-0.2, -0.22, 0.14, 0.11, 0.12, 0x9a8f86);
rock(0.55, -0.2, 0.22, 0.15, 0.17, 0xa9a39c);
rock(0.85, 0.15, 0.1, 0.08, 0.09, 0x8f949c);
rock(-0.85, 0.2, 0.12, 0.09, 0.1, 0xb4a89a);

// Plants: ribbon blades swaying via CPU-displaced vertices.
const blades = [];
function plant(x, z, count, h0, hex) {
  const m = new THREE.MeshStandardMaterial({ map: speckleTex(hex, 0.2, 300), side: THREE.DoubleSide, roughness: 0.7 });
  for (let i = 0; i < count; i++) {
    const h = h0 * (0.7 + rnd() * 0.5), w = 0.07 + rnd() * 0.05;
    const g = new THREE.PlaneGeometry(w, h, 1, 10);
    g.translate(0, h / 2, 0);
    const bx = x + (rnd() - 0.5) * 0.14, bz = z + (rnd() - 0.5) * 0.12;
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(bx, sandY(bx, bz) - 0.01, bz);
    mesh.rotation.y = rnd() * Math.PI;
    tank.add(mesh);
    blades.push({ g, base: g.attributes.position.array.slice(), h, ph: rnd() * 6.28, sp: 0.8 + rnd() * 0.6, amp: 0.05 + rnd() * 0.05 });
  }
}
plant(-0.75, -0.3, 6, 0.75, '#2f9a4a');
plant(0.2, -0.35, 5, 0.6, '#47b85a');
plant(0.75, -0.05, 6, 0.85, '#2a8a52');
plant(-0.05, 0.0, 3, 0.35, '#6cc24a');
plant(-0.6, 0.3, 3, 0.4, '#3aa86a');

// Glass: faint panes (no sharp glints), mid-tone frame bars (no white edges that would ghost).
const glassMat = new THREE.MeshBasicMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.05, depthWrite: false, side: THREE.DoubleSide });
for (const [w, h, x, y, z, ry] of [[W, H, 0, 0, D / 2, 0], [D, H, -W / 2, 0, 0, Math.PI / 2], [D, H, W / 2, 0, 0, Math.PI / 2]]) {
  const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glassMat);
  p.position.set(x, y, z); p.rotation.y = ry; p.renderOrder = 8;
  tank.add(p);
}
const frameMat = new THREE.MeshStandardMaterial({ color: 0x6f8ba3, roughness: 0.35, metalness: 0.3 });
const T = 0.025;
function bar(sx, sy, sz, x, y, z) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), frameMat);
  b.position.set(x, y, z); tank.add(b);
}
for (const y of [yFloor, yTop]) {
  for (const z of [-D / 2, D / 2]) bar(W + T, T, T, 0, y, z);
  for (const x of [-W / 2, W / 2]) bar(T, T, D + T, x, y, 0);
}
for (const x of [-W / 2, W / 2]) for (const z of [-D / 2, D / 2]) bar(T, H + T, T, x, 0, z);
// Base: dark wood slab, inside the box we fit so the budget counts it.
const base = new THREE.Mesh(new THREE.BoxGeometry(W + 0.12, 0.08, D + 0.12), mat(speckleTex('#4a3322', 0.3), { roughness: 0.6 }));
base.position.y = yFloor - 0.045;
tank.add(base);

// Bubbles from an air stone
const bubGeo = new THREE.SphereGeometry(1, 12, 8);
const bubMat = new THREE.MeshStandardMaterial({ color: 0xd8f2ff, transparent: true, opacity: 0.4, roughness: 0.1, depthWrite: false });
const bubbles = [];
for (let i = 0; i < 16; i++) {
  const m = new THREE.Mesh(bubGeo, bubMat);
  m.renderOrder = 7;
  tank.add(m);
  bubbles.push({ m, y: rnd() * (WATER_TOP - yFloor - 0.2), r: 0.008 + rnd() * 0.012, sp: 0.12 + rnd() * 0.1, ph: rnd() * 6.28 });
}
const STONE = new THREE.Vector3(0.35, 0, -0.1);

// ---- fish -----------------------------------------------------------------------------------------
function fishTex(body, stripe, belly) {
  return canvasTex(64, 128, (g, w, h) => {      // v runs along the body
    g.fillStyle = body; g.fillRect(0, 0, w, h);
    const gr = g.createLinearGradient(0, 0, w, 0);
    gr.addColorStop(0, body); gr.addColorStop(0.5, belly); gr.addColorStop(1, body);
    g.globalAlpha = 0.45; g.fillStyle = gr; g.fillRect(0, 0, w, h); g.globalAlpha = 1;
    if (stripe) {
      g.fillStyle = stripe;
      for (const [a, b] of [[0.3, 0.4], [0.58, 0.66]]) g.fillRect(0, h * a, w, h * (b - a));
    }
    for (let i = 0; i < 500; i++) {             // scale speckle
      g.fillStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,255,255'},${rnd() * 0.18})`;
      g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 3, 1 + rnd() * 3);
    }
  });
}
function finShape(pts) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  return new THREE.ShapeGeometry(s);
}
function makeFish(o) {
  const g = new THREE.Group();
  const bodyMat = mat(fishTex(o.body, o.stripe, o.belly), { roughness: 0.45 });
  const finMat = new THREE.MeshStandardMaterial({ color: o.fin, side: THREE.DoubleSide, roughness: 0.6 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18).rotateZ(Math.PI / 2), bodyMat);   // poles along x
  body.scale.set(0.15 * o.len, 0.085 * o.tall, 0.045);
  g.add(body);
  const tail = new THREE.Group();
  tail.position.x = -0.14 * o.len;
  tail.add(new THREE.Mesh(finShape([[0, 0], [-0.11, 0.075 * o.tall], [-0.085, 0], [-0.11, -0.075 * o.tall]]), finMat));
  g.add(tail);
  const dorsal = new THREE.Mesh(finShape([[0.07, 0.06 * o.tall], [-0.01, 0.12 * o.tall], [-0.09, 0.06 * o.tall]]), finMat);
  g.add(dorsal);
  for (const s of [-1, 1]) {
    const f = new THREE.Mesh(finShape([[0.04, -0.01], [-0.03, -0.05], [-0.01, 0.015]]), finMat);
    f.position.z = s * 0.04; f.rotation.x = s * 0.5; g.add(f);
  }
  const eyeM = new THREE.MeshStandardMaterial({ color: 0xf6f6f0, roughness: 0.3 });
  const pupM = new THREE.MeshBasicMaterial({ color: 0x0a0a0a });
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.017, 12, 8), eyeM);
    e.position.set(0.1 * o.len, 0.018, s * 0.034);
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.009, 8, 6), pupM);
    p.position.set(0.007, 0, s * 0.008);
    e.add(p); g.add(e);
  }
  g.scale.setScalar(o.size);
  tank.add(g);
  return { g, tail, dorsal, o, th: rnd() * 6.28 };
}
// Paths are ellipses in x/z (kept inside the tank: |x| <= 0.8 + body, |z| <= 0.3) with a vertical bob.
const fish = [
  { body: '#f2762a', belly: '#ffb070', stripe: '#fff', fin: 0xe0601c, len: 1, tall: 1, size: 1.0, cx: 0.0, cy: 0.0, ax: 0.7, az: 0.3, ay: 0.12, w: 0.35, dir: 1 },
  { body: '#2a63d8', belly: '#7fb0ff', stripe: null, fin: 0xf2d230, len: 1.1, tall: 1.2, size: 1.05, cx: 0.1, cy: 0.22, ax: 0.6, az: 0.25, ay: 0.15, w: 0.28, dir: -1 },
  { body: '#f5d423', belly: '#fff29a', stripe: null, fin: 0xf0b800, len: 0.9, tall: 1.3, size: 0.85, cx: -0.2, cy: -0.1, ax: 0.5, az: 0.3, ay: 0.1, w: 0.45, dir: 1 },
  { body: '#d8325a', belly: '#ff93ac', stripe: '#3a0d1c', fin: 0xb82048, len: 1.2, tall: 0.9, size: 0.9, cx: 0.2, cy: 0.35, ax: 0.75, az: 0.22, ay: 0.08, w: 0.22, dir: -1 },
  { body: '#37b890', belly: '#a5f0d3', stripe: '#fff', fin: 0x2a9a7a, len: 1, tall: 1, size: 0.8, cx: -0.3, cy: 0.15, ax: 0.55, az: 0.3, ay: 0.14, w: 0.5, dir: -1 },
].map(makeFish);

const fishPos = (o, th, out) =>
  out.set(o.cx + o.ax * Math.cos(th), o.cy + o.ay * Math.sin(th * 2.3 + o.cx * 5), o.az * Math.sin(th) * o.dir);

// ---- lights -------------------------------------------------------------------------------------
const sun = new THREE.DirectionalLight(0xfff3e0, 2.4);
sun.position.set(-0.6, 2, 2);
viewer.scene.add(sun, new THREE.HemisphereLight(0xa8d8ff, 0x1d2a38, 1.3));

tank.rotation.set(THREE.MathUtils.degToRad(10), THREE.MathUtils.degToRad(-18), 0);
viewer.content.add(tank);
tank.updateMatrixWorld(true);

// Fit on the box the tank really occupies after its turn, pushed back by half the gap.
viewer.depthOffset = -((BACK - FRONT) / 2) * VDH;
const box = new THREE.Box3().setFromObject(viewer.content);
viewer.fitTo(box.getCenter(new THREE.Vector3()), box.getSize(new THREE.Vector3()));

// ---- animation ------------------------------------------------------------------------------------
let lastT = 0, time = 0;
const p0 = new THREE.Vector3(), p1 = new THREE.Vector3();
viewer.onTick = () => {
  const now = performance.now(), dt = lastT ? Math.min((now - lastT) / 1000, 0.1) : 0;
  lastT = now; time += dt;
  for (const f of fish) {
    f.th += dt * f.o.w;
    fishPos(f.o, f.th, p0);
    fishPos(f.o, f.th + 0.05, p1);
    f.g.position.copy(p0);
    const v = p1.sub(p0);
    f.g.rotation.set(0, Math.atan2(-v.z, v.x) + 0.08 * Math.sin(time * 4 + f.o.cx * 7), Math.atan2(v.y, Math.hypot(v.x, v.z)));
    f.tail.rotation.y = 0.45 * Math.sin(time * 7 + f.o.cx * 10);
    f.dorsal.rotation.x = 0.06 * Math.sin(time * 3 + f.o.cy * 9);
  }
  for (const b of blades) {
    const p = b.g.attributes.position, a = b.base;
    for (let i = 0; i < p.count; i++) {
      const y = a[i * 3 + 1], k = (y / b.h) ** 1.6;
      p.setX(i, a[i * 3] + b.amp * k * Math.sin(time * b.sp * 1.6 + b.ph + y * 2.5));
      p.setZ(i, a[i * 3 + 2] + b.amp * 0.5 * k * Math.cos(time * b.sp * 1.2 + b.ph));
    }
    p.needsUpdate = true;
  }
  const span = WATER_TOP - yFloor - 0.2;
  for (const b of bubbles) {
    b.y += dt * b.sp;
    if (b.y > span) b.y = 0;
    const u = b.y / span;
    b.m.position.set(STONE.x + 0.03 * Math.sin(time * 2 + b.ph) * (1 + u * 2), yFloor + 0.1 + b.y, STONE.z + 0.02 * Math.cos(time * 1.7 + b.ph));
    b.m.scale.setScalar(b.r * (0.7 + u * 0.6));
  }
};

// ---- boot -----------------------------------------------------------------------------------------
const wall = await createInline3D({ lazy: false });
if (!wall.supported) {
  viewer.startMono();
  cover.remove();
  depth.disabled = modeBtn.disabled = true;
  modeBtn.textContent = '2D';
  modeNote.textContent = 'Open this page in the DisplayXR Browser on a 3D display to see it in 3D.';
} else {
  // Depth slider moves ipdFactor and parallaxFactor together (never scale.z).
  const rig = (k) => displayRig({ virtualDisplayHeight: VDH, ipdFactor: k, parallaxFactor: k });
  const handle = wall.addScene(canvas, viewer.onFrame, { viewRig: rig(1), onLayerLost: viewer.onLayerLost });
  wall.session.updateRenderState({ depthNear: 0.01, depthFar: 20 });
  depth.addEventListener('input', () => handle.setViewRig(rig(Number(depth.value))));
  let flat = false;
  const show = () => { modeBtn.textContent = flat ? 'Show in 3D' : 'Show in 2D'; modeBtn.setAttribute('aria-pressed', String(flat)); };
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
