// Desk Aquarium: a three.js tank for a glasses-free 3D display (DisplayXR inline-3D).
//
// Rig: DISPLAY rig (the canvas is a portal onto a virtual display). The tank is a subject, not a
// viewpoint the user moves through, so the runtime places the eyes and we render its views as-is.
// The scene is authored in METRES for a virtualDisplayHeight of VDH; z = 0 is the glass plane,
// +z toward the viewer. No app-side stereo maths, no per-frame world scaling.

import * as THREE from 'three';
import { createInline3D } from '@displayxr/inline3d';
import { EyeCamera } from '@displayxr/inline3d/three';

const BG = 0x05090e;                 // == --bg in index.html
const VDH = 0.26;                    // virtual display height (m): the zoom knob. Tank is 0.17 m tall.

const canvas = document.getElementById('tank');
const coverEl = document.getElementById('cover');
const statusEl = document.getElementById('status');

// ---- renderer -----------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);           // getViewport() is already backing-store px; ratio != 1 mis-scales the eyes
renderer.autoClear = false;          // one explicit clear per frame, then one draw per eye viewport
renderer.setClearColor(BG, 1);       // opaque: a transparent woven canvas comes out black on the panel
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.xr.enabled = false;
const gl = renderer.getContext();
const GL_MAX = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
  gl.getParameter(gl.MAX_VIEWPORT_DIMS)[0]);

const scene = new THREE.Scene();
const uTime = { value: 0 };          // one clock for every shader: both eyes always agree

// ---- tank dimensions (metres) -------------------------------------------------------------
const W = 0.32, H = 0.17, D = 0.14;
const X0 = -W / 2, X1 = W / 2;
const Y0 = -0.095, Y1 = Y0 + H;       // bottom / top of the glass
const Z0 = -0.105, Z1 = Z0 + D;       // back / front glass (front is +0.035, a little out of the screen)
const CZ = (Z0 + Z1) / 2;
const WATER_Y = Y1 - 0.012;
const FLOOR_Y = Y0 + 0.004;

const tank = new THREE.Group();
scene.add(tank);

// ---- lights -------------------------------------------------------------------------------
scene.add(new THREE.HemisphereLight(0xc4ecff, 0x1b2b22, 1.0));
const key = new THREE.DirectionalLight(0xfff3e0, 2.2);
key.position.set(-0.15, 0.5, 0.35);
scene.add(key);
const rim = new THREE.DirectionalLight(0x6fc8ff, 0.8);
rim.position.set(0.3, 0.1, -0.4);
scene.add(rim);

// ---- shader helpers -----------------------------------------------------------------------
// Caustics: animated light net on sand and rocks, keyed on world position + the shared clock.
function addCaustics(mat, strength) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.uniforms.uCaus = { value: strength };
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec3 vWPos;\nvoid main() {')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `
        varying vec3 vWPos; uniform float uTime; uniform float uCaus;
        float caustic(vec2 uv, float t) {
          vec2 p = mod(uv * 6.28318, 6.28318) - 250.0;
          vec2 i = p; float c = 1.0; float inten = 0.005;
          for (int n = 0; n < 4; n++) {
            float tt = t * (1.0 - (3.5 / float(n + 1)));
            i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
            c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
          }
          c /= 4.0; c = 1.17 - pow(c, 1.4);
          return pow(abs(c), 8.0);
        }
        void main() {`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float cw = clamp((${WATER_Y.toFixed(4)} - vWPos.y) * 30.0, 0.0, 1.0);
        totalEmissiveRadiance += vec3(0.55, 0.85, 1.0) * caustic(vWPos.xz * 5.0, uTime * 0.35) * uCaus * cw;`);
  };
  mat.customProgramCacheKey = () => 'caustics';
  return mat;
}

// Sway: plants bend from a fixed base; phase comes from where the blade is planted.
function addSway(mat, amp) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.uniforms.uAmp = { value: amp };
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'uniform float uTime; uniform float uAmp;\nvoid main() {')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float k = uv.y * uv.y;
        float ph = modelMatrix[3].x * 53.0 + modelMatrix[3].z * 31.0;
        transformed.x += sin(uTime * 1.1 + ph + uv.y * 2.5) * uAmp * k;
        transformed.z += cos(uTime * 0.8 + ph * 1.3 + uv.y * 2.0) * uAmp * 0.6 * k;`);
  };
  mat.customProgramCacheKey = () => 'sway';
  return mat;
}

// ---- deterministic randomness -------------------------------------------------------------
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const rr = (a, b) => a + (b - a) * rnd();

// ---- backdrop (inside the back glass) -----------------------------------------------------
{
  const c = document.createElement('canvas'); c.width = 4; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#1f7f99'); grad.addColorStop(0.55, '#0e4259'); grad.addColorStop(1, '#04202e');
  g.fillStyle = grad; g.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const back = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ map: tex }));
  back.position.set(0, (Y0 + Y1) / 2, Z0 + 0.0005);
  tank.add(back);
}

// ---- sand ---------------------------------------------------------------------------------
function sandTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#d9c391'; g.fillRect(0, 0, 512, 512);
  const img = g.getImageData(0, 0, 512, 512);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd() - 0.5) * 46;
    img.data[i] += n; img.data[i + 1] += n * 0.95; img.data[i + 2] += n * 0.8;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 1.5);
  t.anisotropy = 4;
  return t;
}
const sandH = (x, z) => {
  const back = (Z1 - z) / D;                           // 0 at the front, 1 at the back: slopes up toward the back
  return back * 0.016 + Math.sin(x * 38 + z * 21) * 0.0022 + Math.sin(x * 83 - z * 47) * 0.0010
    + Math.exp(-((x + 0.07) ** 2 + (z - CZ) ** 2) / 0.0012) * 0.008;
};
{
  const geo = new THREE.PlaneGeometry(W - 0.004, D - 0.004, 80, 40);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i) + CZ;
    p.setY(i, FLOOR_Y + sandH(x, z));
    p.setZ(i, z);
  }
  geo.computeVertexNormals();
  const sand = new THREE.Mesh(geo, addCaustics(new THREE.MeshStandardMaterial({ map: sandTexture(), roughness: 1, metalness: 0 }), 0.5));
  tank.add(sand);
}

// ---- rocks --------------------------------------------------------------------------------
function makeRock(r, sx, sy, sz, color) {
  const geo = new THREE.IcosahedronGeometry(r, 3);
  const p = geo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = Math.sin(v.x * 140 + 1.3) * Math.sin(v.y * 120 + 0.4) * Math.sin(v.z * 130 + 2.1);
    const f = 1 + 0.16 * Math.sin(v.x * 55 + v.z * 40) + 0.07 * n;
    v.multiplyScalar(f); v.x *= sx; v.y *= sy; v.z *= sz;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, addCaustics(new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0, flatShading: true }), 0.35));
  return m;
}
[
  // x, z, radius, sx, sy, sz, color, ry
  [-0.105, CZ - 0.015, 0.030, 1.25, 0.85, 1.0, 0x6d6a66, 0.4],
  [-0.075, CZ + 0.012, 0.016, 1.0, 0.8, 0.9, 0x7a736a, 1.2],
  [0.115, CZ - 0.030, 0.026, 1.1, 1.0, 0.95, 0x5c5f63, 2.0],
  [0.075, CZ + 0.025, 0.013, 1.0, 0.7, 1.0, 0x82786b, 0.2],
].forEach(([x, z, r, sx, sy, sz, c, ry]) => {
  const rock = makeRock(r, sx, sy, sz, c);
  rock.position.set(x, FLOOR_Y + sandH(x, z) + r * sy * 0.45, z);
  rock.rotation.y = ry;
  tank.add(rock);
});

// ---- plants -------------------------------------------------------------------------------
function makeBlade(h, w, shape) {
  const geo = new THREE.PlaneGeometry(w, h, 1, 10);
  geo.translate(0, h / 2, 0);                         // base at y = 0; uv.y runs 0..1 up the blade
  const p = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const t = uv.getY(i);
    const f = shape === 'leaf' ? Math.pow(Math.sin(Math.PI * Math.min(t * 0.92 + 0.04, 1)), 0.7) : 1 - t * 0.8;
    p.setX(i, p.getX(i) * f);
  }
  return geo;
}
const grassMat = addSway(new THREE.MeshStandardMaterial({ color: 0x3fae5a, roughness: 0.7, side: THREE.DoubleSide }), 0.016);
const leafMat = addSway(new THREE.MeshStandardMaterial({ color: 0x2e8f4c, roughness: 0.6, side: THREE.DoubleSide }), 0.012);
const redMat = addSway(new THREE.MeshStandardMaterial({ color: 0xb8475a, roughness: 0.6, side: THREE.DoubleSide }), 0.012);
function clump(cx, cz, n, hMin, hMax, w, mat, shape, spread) {
  for (let i = 0; i < n; i++) {
    const x = cx + rr(-spread, spread), z = cz + rr(-spread, spread);
    const blade = new THREE.Mesh(makeBlade(rr(hMin, hMax), w, shape), mat);
    blade.position.set(x, FLOOR_Y + sandH(x, z) - 0.002, z);
    blade.rotation.y = rr(0, Math.PI);
    blade.rotation.z = rr(-0.18, 0.18);
    tank.add(blade);
  }
}
clump(-0.135, CZ - 0.04, 9, 0.07, 0.125, 0.007, grassMat, 'grass', 0.014);
clump(0.045, CZ - 0.05, 7, 0.06, 0.1, 0.006, grassMat, 'grass', 0.012);
clump(0.14, CZ + 0.005, 5, 0.06, 0.095, 0.02, leafMat, 'leaf', 0.01);
clump(-0.02, CZ - 0.045, 4, 0.05, 0.085, 0.018, redMat, 'leaf', 0.008);

// ---- water volume, surface, glass ---------------------------------------------------------
const water = new THREE.Mesh(
  new THREE.BoxGeometry(W - 0.004, WATER_Y - Y0 - 0.004, D - 0.004),
  new THREE.MeshBasicMaterial({ color: 0x2b9fc0, transparent: true, opacity: 0.09, depthWrite: false, side: THREE.DoubleSide }));
water.position.set(0, (WATER_Y + Y0) / 2 + 0.002, CZ);
water.renderOrder = 1;
tank.add(water);

const surfGeo = new THREE.PlaneGeometry(W - 0.004, D - 0.004, 24, 12);
surfGeo.rotateX(-Math.PI / 2);
const surf = new THREE.Mesh(surfGeo, new THREE.MeshPhongMaterial({
  color: 0x9fe3ff, specular: 0xffffff, shininess: 90, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }));
surf.position.set(0, WATER_Y, CZ);
surf.renderOrder = 3;
tank.add(surf);
const surfBase = Float32Array.from(surfGeo.attributes.position.array);
function updateSurface(t) {
  const p = surfGeo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = surfBase[i * 3], z = surfBase[i * 3 + 2];
    p.setY(i, Math.sin(x * 60 + t * 1.6) * 0.0006 + Math.sin(z * 70 - t * 1.3 + x * 20) * 0.0005);
  }
  p.needsUpdate = true;
  surfGeo.computeVertexNormals();
}

const glassMat = new THREE.MeshBasicMaterial({ color: 0xbfe9ff, transparent: true, opacity: 0.05, depthWrite: false, side: THREE.DoubleSide });
function pane(w, h, x, y, z, ry) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glassMat);
  m.position.set(x, y, z); m.rotation.y = ry; m.renderOrder = 4;
  tank.add(m);
}
pane(W, H, 0, (Y0 + Y1) / 2, Z1, 0);                       // front
pane(D, H, X0, (Y0 + Y1) / 2, CZ, Math.PI / 2);            // left
pane(D, H, X1, (Y0 + Y1) / 2, CZ, Math.PI / 2);            // right

// Frame: dark silicone corner posts, top rim and bottom rim, plus a plinth.
const trimMat = new THREE.MeshStandardMaterial({ color: 0x0c0f13, roughness: 0.45, metalness: 0.5 });
function bar(w, h, d, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), trimMat);
  m.position.set(x, y, z); tank.add(m); return m;
}
const T = 0.004;
for (const x of [X0, X1]) for (const z of [Z0, Z1]) bar(T, H, T, x, (Y0 + Y1) / 2, z);
for (const y of [Y0, Y1]) {
  bar(W + T, T, T, 0, y, Z1); bar(W + T, T, T, 0, y, Z0);
  bar(T, T, D + T, X0, y, CZ); bar(T, T, D + T, X1, y, CZ);
}
const plinth = new THREE.Mesh(new THREE.BoxGeometry(W + 0.03, 0.012, D + 0.03),
  new THREE.MeshStandardMaterial({ color: 0x2a1c14, roughness: 0.55, metalness: 0.1 }));
plinth.position.set(0, Y0 - 0.008, CZ);
tank.add(plinth);

// ---- bubbles ------------------------------------------------------------------------------
const NB = 26;
const bubbles = new THREE.InstancedMesh(new THREE.SphereGeometry(0.0016, 10, 8),
  new THREE.MeshBasicMaterial({ color: 0xe8fbff, transparent: true, opacity: 0.45, depthWrite: false }), NB);
bubbles.renderOrder = 2; bubbles.frustumCulled = false;
tank.add(bubbles);
const bub = Array.from({ length: NB }, () => ({ y: rr(0, 1), s: rr(0.05, 0.085), sz: rr(0.6, 1.5), ph: rr(0, 6.28) }));
const stone = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.005, 0.005, 12),
  new THREE.MeshStandardMaterial({ color: 0x555a60, roughness: 0.9 }));
const AIR = { x: 0.12, z: Z0 + 0.02 };
stone.position.set(AIR.x, FLOOR_Y + sandH(AIR.x, AIR.z) + 0.001, AIR.z);
tank.add(stone);
const dummy = new THREE.Object3D();
function updateBubbles(dt) {
  const span = WATER_Y - (FLOOR_Y + 0.012);
  bub.forEach((b, i) => {
    b.y += (b.s * dt) / span * (0.7 + b.y * 0.6);
    if (b.y > 1) { b.y -= 1; b.ph = rr(0, 6.28); b.sz = rr(0.6, 1.5); }
    dummy.position.set(AIR.x + Math.sin(uTime.value * 2 + b.ph + b.y * 9) * 0.0025 * b.y,
      FLOOR_Y + 0.012 + b.y * span, AIR.z + Math.cos(uTime.value * 1.7 + b.ph) * 0.002 * b.y);
    dummy.scale.setScalar(b.sz * (0.8 + b.y * 0.5));
    dummy.updateMatrix();
    bubbles.setMatrixAt(i, dummy.matrix);
  });
  bubbles.instanceMatrix.needsUpdate = true;
}

// ---- fish ---------------------------------------------------------------------------------
// Each fish's body is a sphere stretched along +x (head at +x). The path is a smooth 3-frequency
// Lissajous inside the tank; the fish yaws/pitches into its velocity.
function bodyTexture(kind) {
  const c = document.createElement('canvas'); c.width = 8; c.height = 256;
  const g = c.getContext('2d');          // canvas top = head (+x), bottom = tail
  const fill = (a, b, col) => { g.fillStyle = col; g.fillRect(0, a * 256, 8, (b - a) * 256); };
  const grad = (stops) => { const gr = g.createLinearGradient(0, 0, 0, 256); stops.forEach(([o, col]) => gr.addColorStop(o, col)); g.fillStyle = gr; g.fillRect(0, 0, 8, 256); };
  switch (kind) {
    case 'clown':
      fill(0, 1, '#ff7414');
      for (const [a, b] of [[0.18, 0.30], [0.50, 0.62], [0.80, 0.88]]) { fill(a - 0.02, b + 0.02, '#1b1b1b'); fill(a, b, '#fbfbf4'); }
      break;
    case 'blue':
      grad([[0, '#2a7bff'], [1, '#1236a8']]);
      fill(0.42, 0.47, '#0b0f26'); fill(0.62, 0.66, '#0b0f26');
      fill(0.92, 1, '#ffd21a');
      break;
    case 'yellow': grad([[0, '#fff04a'], [1, '#f2b705']]); break;
    case 'tetra':
      grad([[0, '#8fd6ff'], [0.5, '#3a7bd5'], [0.52, '#e01e37'], [1, '#c8102e']]);
      break;
    default: // 'betta'
      grad([[0, '#ff5fb0'], [0.6, '#b0287f'], [1, '#6a1b9a']]);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function finShape(pts) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  return new THREE.ShapeGeometry(s);
}
const eyeWhite = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
const eyeBlack = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.2 });
const eyeGeo = new THREE.SphereGeometry(0.0022, 12, 10), pupilGeo = new THREE.SphereGeometry(0.0012, 10, 8);

const fishDefs = [
  { kind: 'clown', fin: 0xff6a10, size: 0.9, tail: 1.0, dorsal: 0.8 },
  { kind: 'blue', fin: 0xffd21a, size: 1.15, tail: 1.1, dorsal: 1.0 },
  { kind: 'yellow', fin: 0xf2b705, size: 1.0, tail: 0.9, dorsal: 1.1 },
  { kind: 'tetra', fin: 0xd01a35, size: 0.7, tail: 0.9, dorsal: 0.7 },
  { kind: 'betta', fin: 0xe0409a, size: 1.0, tail: 1.7, dorsal: 1.2 },
];
const fish = fishDefs.map((d, i) => {
  const outer = new THREE.Group();                    // +z = heading (Object3D.lookAt convention)
  const inner = new THREE.Group();
  inner.rotation.y = -Math.PI / 2;                    // fish local +x -> outer +z
  inner.scale.setScalar(d.size);
  outer.add(inner);

  const bodyGeo = new THREE.SphereGeometry(1, 28, 20);
  bodyGeo.rotateZ(-Math.PI / 2);                      // poles along x; +y pole (canvas top) -> +x (head)
  const bodyMat = new THREE.MeshStandardMaterial({ map: bodyTexture(d.kind), roughness: 0.38, metalness: 0.1 });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.scale.set(0.024, 0.0125, 0.0068);
  inner.add(body);

  const finMat = new THREE.MeshStandardMaterial({ color: d.fin, roughness: 0.5, side: THREE.DoubleSide, transparent: true, opacity: 0.92 });
  const tailPivot = new THREE.Group();
  tailPivot.position.x = -0.0215;
  const tl = 0.014 * d.tail, th = 0.0105 * Math.sqrt(d.tail);
  const tail = new THREE.Mesh(finShape([[0.001, 0], [-tl, th], [-tl * 0.72, 0], [-tl, -th]]), finMat);
  tailPivot.add(tail);
  inner.add(tailPivot);

  const dl = 0.014 * d.dorsal;
  const dorsal = new THREE.Mesh(finShape([[0.009, 0], [0.004, dl], [-0.010, dl * 0.5], [-0.014, 0]]), finMat);
  dorsal.position.y = 0.0105;
  inner.add(dorsal);
  const belly = new THREE.Mesh(finShape([[0.004, 0], [-0.002, -0.0065], [-0.011, 0]]), finMat);
  belly.position.y = -0.0105;
  inner.add(belly);

  const pecs = [1, -1].map((s) => {
    const f = new THREE.Mesh(finShape([[0, 0], [-0.007, -0.0035], [-0.0045, 0.0015]]), finMat);
    f.position.set(0.008, -0.002, s * 0.0058);
    f.rotation.y = s * 0.5;
    inner.add(f);
    return f;
  });

  for (const s of [1, -1]) {
    const e = new THREE.Mesh(eyeGeo, eyeWhite); e.position.set(0.0148, 0.0028, s * 0.0046);
    const p = new THREE.Mesh(pupilGeo, eyeBlack); p.position.set(0.0158, 0.0028, s * 0.0058);
    inner.add(e, p);
  }

  const path = {
    cx: rr(-0.01, 0.01), cy: -0.015 + i * 0.011 + rr(-0.004, 0.004), cz: CZ + (i - 2) * 0.012,
    ax: rr(0.095, 0.125), ay: rr(0.022, 0.034), az: rr(0.017, 0.024),
    wx: rr(0.30, 0.46), wy: rr(0.45, 0.8), wz: rr(0.35, 0.6),
    px: rr(0, 6.28), py: rr(0, 6.28), pz: rr(0, 6.28),
  };
  tank.add(outer);
  return { outer, tailPivot, pecs, body, path, wag: rr(0, 6), q: new THREE.Quaternion(), init: false, d };
});
const _p = new THREE.Vector3(), _v = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0), _d = new THREE.Vector3(), _zero = new THREE.Vector3();
function updateFish(t, dt) {
  for (const f of fish) {
    const a = f.path;
    _p.set(a.cx + a.ax * Math.sin(a.wx * t + a.px), a.cy + a.ay * Math.sin(a.wy * t + a.py), a.cz + a.az * Math.sin(a.wz * t + a.pz));
    _v.set(a.ax * a.wx * Math.cos(a.wx * t + a.px), a.ay * a.wy * Math.cos(a.wy * t + a.py) * 0.5, a.az * a.wz * Math.cos(a.wz * t + a.pz));
    const speed = _v.length();
    f.outer.position.copy(_p);
    // Face along velocity; `lookAt` for a plain Object3D aims +z at the target.
    _d.copy(_v).negate().normalize();                           // Matrix4.lookAt gives z = eye - target
    _m.lookAt(_zero, _d, _up);
    _q.setFromRotationMatrix(_m);
    if (!f.init) { f.q.copy(_q); f.init = true; } else f.q.slerp(_q, 1 - Math.exp(-dt * 3.5));
    f.outer.quaternion.copy(f.q);
    // Tail wag rate and amplitude follow speed; the whole body gets a little counter-sway.
    f.wag += dt * (5 + speed * 90);
    const amp = 0.35 + Math.min(speed * 6, 0.4);
    f.tailPivot.rotation.y = Math.sin(f.wag) * amp;
    f.body.rotation.y = Math.sin(f.wag - 0.9) * 0.07;
    f.pecs[0].rotation.z = f.pecs[1].rotation.z = Math.sin(f.wag * 0.5) * 0.35;
  }
}

// ---- cameras ------------------------------------------------------------------------------
// Mono fallback: 0.5 m back, FOV chosen so the z = 0 plane spans VDH.
const MONO_DIST = 0.5;
const monoCam = new THREE.PerspectiveCamera(2 * Math.atan(VDH / 2 / MONO_DIST) * 180 / Math.PI, 1.6, 0.01, 5);
monoCam.position.set(0, 0, MONO_DIST);
const ptr = { x: 0, y: 0, sx: 0, sy: 0 };
addEventListener('pointermove', (e) => { ptr.x = e.clientX / innerWidth - 0.5; ptr.y = e.clientY / innerHeight - 0.5; });

const eyes = [new EyeCamera(THREE), new EyeCamera(THREE)];

// ---- backing store ------------------------------------------------------------------------
// Woven: DOUBLE-WIDTH (left eye | right eye), in device pixels. Mono: 1:1.
let woven = false;
function sizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let w = Math.round((canvas.clientWidth || 640) * dpr), h = Math.round((canvas.clientHeight || 400) * dpr);
  // Keep the SBS store within the GL limits and no wider than the panel's physical pixels.
  const panelW = Math.round(screen.width * (window.devicePixelRatio || 1));
  const maxW = Math.min(GL_MAX, Math.max(panelW, 1280));
  const k = Math.min(1, maxW / (woven ? w * 2 : w), GL_MAX / h);
  w = Math.max(2, Math.floor(w * k)); h = Math.max(2, Math.floor(h * k));
  const bw = woven ? w * 2 : w;
  const el = renderer.domElement;
  if (el.width === bw && el.height === h) return false;   // setSize clears even when unchanged: compare first
  renderer.setSize(bw, h, false);
  monoCam.aspect = w / h; monoCam.updateProjectionMatrix();
  return true;
}

// ---- frame update (once per frame, NOT per eye) -------------------------------------------
let lastT = 0;
function update(nowMs) {
  const dt = lastT ? Math.min((nowMs - lastT) / 1000, 0.1) : 0.016;
  lastT = nowMs;
  uTime.value += dt;
  updateFish(uTime.value, dt);
  updateBubbles(dt);
  updateSurface(uTime.value);
  scene.updateMatrixWorld();
}

// ---- woven path ---------------------------------------------------------------------------
const good = [0, 1].map(() => ({ proj: new Float32Array(16), pose: new Float32Array(16), x: 0, y: 0, w: 0, h: 0 }));
let haveGood = false;

function drawLastGood() {
  renderer.clear();
  if (!haveGood) return;
  renderer.setScissorTest(true);
  for (let i = 0; i < 2; i++) {
    const g = good[i];
    renderer.setViewport(g.x, g.y, g.w, g.h);
    renderer.setScissor(g.x, g.y, g.w, g.h);
    eyes[i].setFromMatrices(g.proj, g.pose);
    renderer.render(scene, eyes[i].camera);
  }
  renderer.setScissorTest(false);
}

function onFrame(views, layer) {
  update(performance.now());
  if (sizeCanvas()) haveGood = false;
  // Validate everything BEFORE clearing: a short view list or null viewport must not blank the tile.
  if (!views || views.length < 2 || !layer) return drawLastGood();
  const vps = [views[0], views[1]].map((v) => layer.getViewport(v));
  if (vps.some((vp) => !vp || vp.width <= 0 || vp.height <= 0)) return drawLastGood();

  renderer.clear();
  renderer.setScissorTest(true);
  for (let i = 0; i < 2; i++) {
    const vp = vps[i], g = good[i];
    renderer.setViewport(vp.x, vp.y, vp.width, vp.height);
    renderer.setScissor(vp.x, vp.y, vp.width, vp.height);
    eyes[i].setFromView(views[i]);
    renderer.render(scene, eyes[i].camera);
    g.proj.set(views[i].projectionMatrix); g.pose.set(views[i].transform.matrix);   // COPIES, never the XRView
    g.x = vp.x; g.y = vp.y; g.w = vp.width; g.h = vp.height;
  }
  renderer.setScissorTest(false);
  haveGood = true;
}

// ---- mono path ----------------------------------------------------------------------------
let monoRunning = false;
function monoFrame(now) {
  if (!monoRunning) return;
  requestAnimationFrame(monoFrame);
  update(now);
  sizeCanvas();
  ptr.sx += (ptr.x - ptr.sx) * 0.05; ptr.sy += (ptr.y - ptr.sy) * 0.05;
  monoCam.position.set(ptr.sx * 0.12, -ptr.sy * 0.06, MONO_DIST);
  monoCam.lookAt(0, 0, -0.03);
  renderer.setScissorTest(false);
  const size = renderer.getSize(new THREE.Vector2());
  renderer.setViewport(0, 0, size.x, size.y);
  renderer.clear();
  renderer.render(scene, monoCam);
}
function startMono() {
  woven = false;
  monoRunning = true;
  sizeCanvas();
  coverEl.hidden = true;
  requestAnimationFrame(monoFrame);
}

// ---- boot ---------------------------------------------------------------------------------
const nextFrames = (n) => new Promise((res) => { const f = () => (--n <= 0 ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });

(async () => {
  const wall = await createInline3D({ lazy: false });
  if (!wall.supported) {
    statusEl.innerHTML = '2D view. Open in the <a href="https://github.com/DisplayXR/displayxr-browser">DisplayXR Browser</a> on a spatial display for glasses-free 3D. Move the pointer to look around.';
    startMono();
    return;
  }
  // Rule 4: give the compositor a settled canvas (final CSS box, 2x-wide store, a couple of frames)
  // before registering it.
  woven = true;
  sizeCanvas();
  monoCam.updateProjectionMatrix();
  renderer.clear();
  await nextFrames(2);

  try { wall.session.updateRenderState({ depthNear: 0.05, depthFar: 5 }); } catch (e) { /* session mid-teardown */ }

  const handle = wall.addScene(canvas, onFrame, {
    // Scalar form of the default DISPLAY rig (identity pose, all factors 1): works on every browser.
    virtualDisplayHeight: VDH,
    onLayerLost: () => { statusEl.textContent = '3D layer lost - showing 2D.'; startMono(); },
  });
  statusEl.innerHTML = '<b>3D active</b> - move your head to look around the tank.';
  await handle.firstWoven;               // keep the cover over the canvas until the weave has joined
  coverEl.hidden = true;                 // hard cut, never a fade
})().catch((err) => {
  console.error(err);
  statusEl.textContent = '3D unavailable - showing 2D.';
  startMono();
});
