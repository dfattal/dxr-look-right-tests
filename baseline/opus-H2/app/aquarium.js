// Desk Aquarium — a three.js tank woven as glasses-free 3D with the DisplayXR inline-3D SDK.
//
// View rig: the DEFAULT DISPLAY RIG (addScene + virtualDisplayHeight). The tank is a subject on a
// desk, not a world the viewer walks through, so the canvas is a portal onto a virtual display and
// the runtime places the eyes. Dragging turns the SUBJECT under the fixed portal (never a camera).
//
// Units: metres of a virtual display VDH tall. The tile plane is z = 0 (zero disparity); +z comes
// out of the glass toward the viewer, -z goes behind it. The tank is centred on z = 0 so the
// water the fish swim in straddles the screen plane.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { createInline3D } from '@displayxr/inline3d';
import { EyeCamera } from '@displayxr/inline3d/three';

const canvas = document.getElementById('tank');
const cover = document.getElementById('cover');
const statusEl = document.getElementById('status');

// ---- depth / framing constants ---------------------------------------------------------------
const VDH = 0.235;            // virtual display height (m). Ornament is ~0.20 m tall -> ~8% margin.
const TANK_W = 0.27, TANK_H = 0.17, TANK_D = 0.11;   // outer glass box; depth = ±0.055 about z=0
const REST_PITCH = 0.16;      // rad (~9°): tank tipped toward the viewer = seen from a little above
const MAX_YAW = 0.35;        // rad: drag limits, so the corners never swing far out of the glass
const PITCH_RANGE = [0.04, 0.32];
const DPR_CAP = 2;            // per-eye resolution beyond this is lost to the lens pitch anyway

const HALF_W = TANK_W / 2, HALF_H = TANK_H / 2, HALF_D = TANK_D / 2;
const GLASS = 0.002;
const IN_W = TANK_W - 2 * GLASS, IN_D = TANK_D - 2 * GLASS;
const FLOOR_Y = -HALF_H + 0.006;      // top of the bottom trim
const WATER_Y = HALF_H - 0.016;

// ---- renderer ------------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(1);            // getViewport() is already in backing-store px
renderer.autoClear = false;           // one clear per frame, then one viewport per eye
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false; // rendered once per frame, shared by both eyes

const gl = renderer.getContext();
const vpDims = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
const MAX_DIM = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE),
  gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), vpDims[0], vpDims[1]);

const scene = new THREE.Scene();
scene.background = null;              // the tile edge is invisible against the near-black page

const envMap = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;

const T = { value: 0 };               // shared time uniform

// Inject code into a built-in material (and its shadow-depth twin) without replacing it.
function patch(mat, uniforms, vertDecl, vertBody, fragDecl = '', fragBody = '', key = '') {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${vertDecl}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${vertBody}`);
    if (fragBody) {
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\n${fragDecl}`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${fragBody}`);
    }
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}
const depthTwin = (side = THREE.FrontSide) =>
  new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side });

// Cheap value-ish noise from sines; deterministic so the tank looks the same each load.
const n2 = (x, z) => Math.sin(x * 131.1 + z * 71.7) * Math.sin(x * 53.3 - z * 97.1);
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const rr = (a, b) => a + (b - a) * rand();

// ---- ornament hierarchy --------------------------------------------------------------------
// ornament: rotated by the drag (pitch/yaw) about the tile centre on the z=0 plane.
// tank:     everything in tank-local metres, lifted so the whole ornament is vertically centred.
const ornament = new THREE.Group();
scene.add(ornament);
const tank = new THREE.Group();
tank.position.y = 0.006;
ornament.add(tank);

// ---- lights (children of the tank so lighting and shadows turn with it) ----------------------
scene.add(new THREE.HemisphereLight(0x9fd6ff, 0x2a2016, 0.9));
const lamp = new THREE.DirectionalLight(0xfff1dc, 2.6);
lamp.position.set(0.04, 0.45, 0.12);
lamp.target.position.set(0, -0.04, 0);
lamp.castShadow = true;
lamp.shadow.mapSize.set(2048, 2048);
Object.assign(lamp.shadow.camera, { left: -0.2, right: 0.2, top: 0.2, bottom: -0.2, near: 0.1, far: 0.9 });
lamp.shadow.camera.updateProjectionMatrix();
lamp.shadow.bias = -0.0004;
lamp.shadow.normalBias = 0.0006;
lamp.shadow.radius = 3;
tank.add(lamp, lamp.target);
const fill = new THREE.DirectionalLight(0x5aa8ff, 0.55);  // cool front fill: water glow on the fish
fill.position.set(-0.1, 0.05, 0.6);
tank.add(fill);

// ---- sand ----------------------------------------------------------------------------------
// Aquascape slope: higher at the back, gentle ripples. Tank-local coordinates.
const sandY = (x, z) =>
  FLOOR_Y + 0.020 + (0.5 - z / IN_D) * 0.016 +
  0.0025 * Math.sin(x * 38 + z * 22) + 0.0016 * Math.sin(x * 87 - z * 61) + 0.0008 * n2(x, z);

{
  const g = new THREE.BoxGeometry(IN_W - 0.0005, 1, IN_D - 0.0005, 110, 1, 50);
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  const sandA = new THREE.Color(0xdcc69a), sandB = new THREE.Color(0xa88f66), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), top = p.getY(i) > 0;
    const y = top ? sandY(x, z) : FLOOR_Y;
    p.setY(i, y);
    const grain = 0.5 + 0.5 * n2(x * 3.1, z * 2.7);
    c.copy(sandA).lerp(sandB, top ? grain * 0.45 : 0.55 + 0.3 * grain);
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  // Caustics: thin bright moving lines on the sand, in tank space so both eyes see the same ones.
  patch(m, { uTime: T }, 'varying vec3 vSandP; varying vec3 vSandN;', 'vSandP = position; vSandN = normal;',
    `uniform float uTime; varying vec3 vSandP; varying vec3 vSandN;
     float caus(vec2 p, float t) {
       vec2 q = p * 58.0;
       float v = sin(q.x + t * 0.9 + sin(q.y * 0.8 + t * 0.7))
               + sin(q.y * 1.1 - t * 0.8 + sin(q.x * 0.9 - t * 0.6))
               + sin((q.x + q.y) * 0.7 + t * 0.5);
       return pow(1.0 - abs(v) / 3.0, 7.0);
     }`,
    `float cTop = smoothstep(0.5, 0.9, normalize(vSandN).y);
     totalEmissiveRadiance += vec3(0.55, 0.8, 0.95) * caus(vSandP.xz, uTime) * 0.32 * cTop;`,
    'sand');
  const sand = new THREE.Mesh(g, m);
  sand.receiveShadow = true;
  tank.add(sand);
}

// ---- rocks ---------------------------------------------------------------------------------
function makeRock(sx, sy, sz, s) {
  let g = new THREE.IcosahedronGeometry(1, 4);
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = mergeVertices(g);
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  const base = new THREE.Color().setHSL(0.08 + rr(-0.02, 0.02), 0.08, 0.33);
  const moss = new THREE.Color(0x4f6b33), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    let d = 1 + 0.16 * Math.sin(2.7 * x + s) * Math.sin(2.3 * y + 2 * s) + 0.1 * Math.sin(3.3 * z - s)
      + 0.05 * Math.sin(8.1 * x + 6.3 * z + s) + 0.025 * Math.sin(17 * y - 13 * x);
    let yy = y * d;
    if (yy < -0.35) yy = -0.35 + (yy + 0.35) * 0.15;   // flat-ish underside so it sits in the sand
    p.setXYZ(i, x * d * sx, yy * sy, z * d * sz);
    c.copy(base).multiplyScalar(0.8 + 0.35 * (0.5 + 0.5 * Math.sin(11 * x + 7 * y + s)));
    if (y > 0.55) c.lerp(moss, (y - 0.55) * 0.9);
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}
const ROCKS = [
  // x, z, sx, sy, sz, rotY
  [-0.035, -0.012, 0.030, 0.026, 0.022, 0.4],
  [0.004, -0.024, 0.018, 0.019, 0.015, 1.3],
  [-0.098, 0.022, 0.014, 0.010, 0.012, 2.2],
  [0.062, 0.012, 0.016, 0.011, 0.013, 0.9],
];
for (const [x, z, sx, sy, sz, ry] of ROCKS) {
  const r = makeRock(sx, sy, sz, rr(0, 6));
  r.position.set(x, sandY(x, z) + sy * 0.2, z);
  r.rotation.y = ry;
  tank.add(r);
}

// ---- plants (one merged mesh, swayed in the vertex shader) ----------------------------------
function blade({ x, z, h, w, bend, rot, lean, c0, c1, phase }) {
  const g = new THREE.PlaneGeometry(1, 1, 1, 14);
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3), sway = new Float32Array(p.count), ph = new Float32Array(p.count);
  const c = new THREE.Color(), cs = Math.cos(rot), sn = Math.sin(rot);
  const y0 = sandY(x, z) - 0.004;
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) + 0.5;
    const width = w * (1 - 0.75 * t) * Math.min(1, 0.55 + 4 * t);
    const lx = p.getX(i) * width + lean * t * h;
    const lz = bend * t * t * h;
    p.setXYZ(i, x + lx * cs + lz * sn, y0 + t * h, z - lx * sn + lz * cs);
    c.copy(c0).lerp(c1, t);
    col.set([c.r, c.g, c.b], i * 3);
    sway[i] = t * t * (h / 0.1);
    ph[i] = phase;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aSway', new THREE.BufferAttribute(sway, 1));
  g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
  g.computeVertexNormals();
  return g;
}
const blades = [];
function cluster(cx, cz, n, spread, kind) {
  for (let i = 0; i < n; i++) {
    const x = cx + rr(-spread, spread), z = cz + rr(-spread * 0.6, spread * 0.6);
    const b = { x, z, rot: rr(0, Math.PI), phase: x * 30 + rr(0, 1.5), bend: rr(-0.25, 0.25), lean: rr(-0.12, 0.12) };
    if (kind === 'tall') {
      // Keep the tips under the water line.
      Object.assign(b, { h: Math.min(rr(0.075, 0.115), WATER_Y - sandY(x, z) - 0.008), w: rr(0.004, 0.0065),
        c0: new THREE.Color(0x24602a), c1: new THREE.Color(0x8fcf5c) });
    } else if (kind === 'red') {
      Object.assign(b, { h: rr(0.04, 0.065), w: rr(0.006, 0.009),
        c0: new THREE.Color(0x5a2418), c1: new THREE.Color(0xd2603a) });
    } else {
      Object.assign(b, { h: rr(0.014, 0.028), w: rr(0.0025, 0.004), bend: rr(-0.5, 0.5),
        c0: new THREE.Color(0x2f6f2c), c1: new THREE.Color(0x96d86a) });
    }
    blades.push(blade(b));
  }
}
cluster(-0.095, -0.03, 13, 0.022, 'tall');
cluster(0.085, -0.034, 12, 0.024, 'tall');
cluster(0.035, -0.036, 6, 0.012, 'red');
cluster(-0.06, 0.02, 9, 0.014, 'grass');
cluster(0.1, 0.03, 8, 0.012, 'grass');
cluster(0.03, 0.03, 5, 0.01, 'grass');
{
  const g = mergeGeometries(blades);
  const decl = 'attribute float aSway; attribute float aPhase; uniform float uTime;';
  const body = `transformed.x += (sin(uTime * 1.05 + aPhase) * 0.0055 + sin(uTime * 2.3 + aPhase * 1.9) * 0.0012) * aSway;
                transformed.z += sin(uTime * 0.8 + aPhase * 0.7) * 0.0035 * aSway;`;
  const m = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide }),
    { uTime: T }, decl, body, '', '', 'plant');
  const plants = new THREE.Mesh(g, m);
  plants.customDepthMaterial = patch(depthTwin(THREE.DoubleSide), { uTime: T }, decl, body, '', '', 'plant-d');
  plants.castShadow = plants.receiveShadow = true;
  tank.add(plants);
}

// ---- back wall (aquarium background sheet) -------------------------------------------------
{
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 512;
  const cx = cv.getContext('2d');
  const gr = cx.createLinearGradient(0, 0, 0, 512);
  gr.addColorStop(0, '#2d6f80'); gr.addColorStop(0.55, '#174654'); gr.addColorStop(1, '#0b232b');
  cx.fillStyle = gr; cx.fillRect(0, 0, 256, 512);
  cx.globalAlpha = 0.07; cx.fillStyle = '#9fe3ff';
  for (let i = 0; i < 6; i++) {           // faint light shafts painted on the sheet
    const x = rr(0, 256), w = rr(10, 30);
    cx.beginPath(); cx.moveTo(x, 0); cx.lineTo(x + w, 0); cx.lineTo(x + w * 2.5 + 40, 512); cx.lineTo(x + 40, 512); cx.fill();
  }
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const h = HALF_H - FLOOR_Y;
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(IN_W, h),
    new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  wall.position.set(0, FLOOR_Y + h / 2, -HALF_D + GLASS + 0.0004);
  tank.add(wall);
}

// ---- water surface, light shafts -----------------------------------------------------------
{
  const g = new THREE.PlaneGeometry(IN_W, IN_D, 48, 20).rotateX(-Math.PI / 2);
  const m = patch(new THREE.MeshStandardMaterial({ color: 0xa6e2ff, roughness: 0.08, metalness: 0,
    transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, envMap, envMapIntensity: 0.7 }),
  { uTime: T }, 'uniform float uTime;',
  'transformed.y += 0.0007 * sin(position.x * 90.0 + uTime * 1.7) * sin(position.z * 70.0 - uTime * 1.3);',
  '', '', 'water');
  const surf = new THREE.Mesh(g, m);
  surf.position.y = WATER_Y;
  tank.add(surf);

  // Meniscus: a thin bright line where the water meets the front and side glass.
  const lineM = new THREE.MeshBasicMaterial({ color: 0x9fdcf0, transparent: true, opacity: 0.35, depthWrite: false });
  const front = new THREE.Mesh(new THREE.BoxGeometry(IN_W, 0.0012, 0.0006), lineM);
  front.position.set(0, WATER_Y, HALF_D - GLASS - 0.0004);
  const sideG = new THREE.BoxGeometry(0.0006, 0.0012, IN_D);
  const l = new THREE.Mesh(sideG, lineM), r = new THREE.Mesh(sideG, lineM);
  l.position.set(-HALF_W + GLASS + 0.0004, WATER_Y, 0); r.position.set(HALF_W - GLASS - 0.0004, WATER_Y, 0);
  tank.add(front, l, r);
}
const shafts = [];
{
  const m0 = new THREE.ShaderMaterial({
    uniforms: { uO: { value: 0.07 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec2 vUv; uniform float uO;
      void main(){ float a = pow(vUv.y, 1.6) * pow(1.0 - abs(vUv.x * 2.0 - 1.0), 2.0) * uO;
                   gl_FragColor = vec4(vec3(0.75, 0.92, 1.0) * a, a); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  for (const [x, z, w, ph] of [[-0.05, -0.02, 0.03, 0], [0.03, -0.005, 0.022, 2], [0.09, -0.03, 0.026, 4]]) {
    const h = WATER_Y - FLOOR_Y - 0.01;
    const s = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m0.clone());
    s.position.set(x, WATER_Y - h / 2, z);
    s.rotation.z = -0.22;
    s.userData.ph = ph;
    shafts.push(s); tank.add(s);
  }
}

// ---- glass, trim, lamp bar, plinth, desk ---------------------------------------------------
{
  const glassM = new THREE.MeshStandardMaterial({ color: 0xd8f4ff, roughness: 0.04, metalness: 0,
    transparent: true, opacity: 0.06, depthWrite: false, envMap, envMapIntensity: 0.55 });
  const pane = (w, h, d, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), glassM); m.position.set(x, y, z); tank.add(m); };
  pane(TANK_W, TANK_H, GLASS, 0, 0, HALF_D - GLASS / 2);
  pane(GLASS, TANK_H, TANK_D - 2 * GLASS, -HALF_W + GLASS / 2, 0, 0);
  pane(GLASS, TANK_H, TANK_D - 2 * GLASS, HALF_W - GLASS / 2, 0, 0);

  // Glass edges read faintly green, like real float glass seen edge-on. Dim on purpose: thin
  // bright lines at the front corners are the most crosstalk-prone thing in the scene.
  const edgeM = new THREE.MeshStandardMaterial({ color: 0x8fc9b8, roughness: 0.2, transparent: true, opacity: 0.35, depthWrite: false });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.BoxGeometry(0.0025, TANK_H - 0.02, 0.0025), edgeM);
    e.position.set(sx * (HALF_W - 0.00125), 0, sz * (HALF_D - 0.00125));
    tank.add(e);
  }

  const trimM = new THREE.MeshStandardMaterial({ color: 0x101214, roughness: 0.45, metalness: 0.2 });
  const ring = (y, h, t) => {
    for (const [w, d, x, z] of [[TANK_W + 0.002, t, 0, HALF_D - t / 2 + 0.001], [TANK_W + 0.002, t, 0, -HALF_D + t / 2 - 0.001],
      [t, TANK_D, -HALF_W + t / 2 - 0.001, 0], [t, TANK_D, HALF_W - t / 2 + 0.001, 0]]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), trimM);
      m.position.set(x, y, z); m.castShadow = true; tank.add(m);
    }
  };
  ring(HALF_H - 0.004, 0.008, 0.005);         // top rim
  ring(-HALF_H + 0.005, 0.01, 0.005);         // bottom rim
  const base = new THREE.Mesh(new THREE.BoxGeometry(TANK_W, 0.004, TANK_D), trimM);
  base.position.y = -HALF_H + 0.002; tank.add(base);

  // Slim LED lamp bar resting across the top rim.
  const bar = new THREE.Mesh(new THREE.BoxGeometry(TANK_W * 0.86, 0.005, 0.018), trimM);
  bar.position.set(0, HALF_H + 0.0025, 0.004); tank.add(bar);
  const led = new THREE.Mesh(new THREE.PlaneGeometry(TANK_W * 0.82, 0.012).rotateX(Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xfff6e6 }));
  led.position.set(0, HALF_H - 0.0001, 0.004); tank.add(led);

  // Wooden plinth.
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 64;
  const c2 = cv.getContext('2d');
  c2.fillStyle = '#6b4329'; c2.fillRect(0, 0, 512, 64);
  for (let i = 0; i < 70; i++) {
    c2.strokeStyle = `rgba(${rand() < 0.5 ? '40,22,12' : '150,100,60'},${rr(0.08, 0.25)})`;
    c2.lineWidth = rr(0.5, 2); c2.beginPath();
    const y = rr(0, 64); c2.moveTo(0, y);
    for (let x = 0; x <= 512; x += 32) c2.lineTo(x, y + Math.sin(x * 0.02 + i) * rr(1, 3));
    c2.stroke();
  }
  const wood = new THREE.CanvasTexture(cv); wood.colorSpace = THREE.SRGBColorSpace;
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(TANK_W + 0.016, 0.016, TANK_D + 0.016),
    new THREE.MeshStandardMaterial({ map: wood, roughness: 0.55 }));
  plinth.position.y = -HALF_H - 0.008;
  plinth.castShadow = plinth.receiveShadow = true;
  tank.add(plinth);

  // Desk top: dark, fading out radially long before the tile edge, so nothing in front of the
  // glass is ever cut by the window frame (no stereo window violation, no hard edge to ghost).
  const ac = document.createElement('canvas'); ac.width = ac.height = 256;
  const a2 = ac.getContext('2d');
  const rg = a2.createRadialGradient(128, 128, 30, 128, 128, 128);
  rg.addColorStop(0, '#fff'); rg.addColorStop(0.55, '#888'); rg.addColorStop(1, '#000');
  a2.fillStyle = rg; a2.fillRect(0, 0, 256, 256);
  const desk = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.22).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x2a1c14, roughness: 0.7, transparent: true,
      alphaMap: new THREE.CanvasTexture(ac), depthWrite: false }));
  desk.position.y = -HALF_H - 0.0161;
  desk.receiveShadow = true;
  desk.renderOrder = -1;
  tank.add(desk);
}

// ---- bubbles -------------------------------------------------------------------------------
const BUB_X = 0.112, BUB_Z = -0.036;
const bubbler = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.006, 0.004, 16),
  new THREE.MeshStandardMaterial({ color: 0x3a3f44, roughness: 0.9 }));
bubbler.position.set(BUB_X, sandY(BUB_X, BUB_Z) + 0.001, BUB_Z);
tank.add(bubbler);
const NB = 26;
const bubbleMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8),
  new THREE.MeshStandardMaterial({ color: 0xe8f8ff, roughness: 0.05, transparent: true, opacity: 0.55,
    depthWrite: false, envMap, envMapIntensity: 1.3 }), NB);
bubbleMesh.frustumCulled = false;
tank.add(bubbleMesh);
const bubbles = Array.from({ length: NB }, (_, i) => ({ y: 0, t: i / NB, r: 0, sp: 0, ph: 0 }));
for (const b of bubbles) resetBubble(b, true);
function resetBubble(b, scatter) {
  b.y0 = bubbler.position.y + 0.003;
  b.y = scatter ? rr(b.y0, WATER_Y) : b.y0;
  b.r = rr(0.0009, 0.0019); b.sp = rr(0.028, 0.045); b.ph = rr(0, 6.28);
}

// ---- food ----------------------------------------------------------------------------------
const NF = 40;
const foodMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.003, 0.0007, 0.0024),
  new THREE.MeshStandardMaterial({ color: 0xc9692c, roughness: 0.8 }), NF);
foodMesh.castShadow = true;
foodMesh.frustumCulled = false;
tank.add(foodMesh);
const food = [];   // {p:Vector3, age, rot}
function dropFood(xHint) {
  for (let i = 0; i < 7 && food.length < NF; i++) {
    food.push({ p: new THREE.Vector3(THREE.MathUtils.clamp(xHint + rr(-0.025, 0.025), -0.11, 0.11),
      WATER_Y - 0.001, rr(-0.035, 0.035)), age: 0, rot: rr(0, 6.28), sink: rr(0.005, 0.009) });
  }
}

// ---- fish ----------------------------------------------------------------------------------
const C = (h) => new THREE.Color(h);
const SPECIES = [
  { name: 'clown', L: 0.034, H: 0.0135, W: 0.0085, speed: 0.028, fin: C(0xff7a1c),
    body: (u, v, c) => {
      c.copy(C(0xff6a0e));
      for (const bu of [0.55, 0.0, -0.55]) {
        const d = Math.abs(u - bu);
        if (d < 0.11) c.copy(C(0xfafafa)); else if (d < 0.15) c.copy(C(0x151515));
      }
    } },
  { name: 'blue tang', L: 0.042, H: 0.019, W: 0.0065, speed: 0.034, fin: C(0xffd21a),
    body: (u, v, c) => {
      c.copy(C(0x1f4fd6));
      if (v > 0.15 && v < 0.55 && u < 0.45 && u > -0.65 - v) c.copy(C(0x0d0f1a));
      if (v < -0.55) c.lerp(C(0x6fa0ff), 0.4);
    } },
  { name: 'yellow tang', L: 0.036, H: 0.021, W: 0.006, speed: 0.03, fin: C(0xffd800), finH: 1.25,
    body: (u, v, c) => { c.copy(C(0xffd400)); if (u > 0.85) c.lerp(C(0xffffff), 0.35); } },
  { name: 'tetra', L: 0.026, H: 0.0075, W: 0.0045, speed: 0.04, fin: C(0x9fb6c8),
    body: (u, v, c) => {
      c.copy(C(0xc8d4dc));
      if (v > -0.05 && v < 0.4 && u < 0.85) c.copy(C(0x18e0ff));
      else if (v <= -0.05 && u < 0.2) c.copy(C(0xff2a3a));
    } },
  { name: 'angelfish', L: 0.032, H: 0.026, W: 0.005, speed: 0.022, fin: C(0xd8dde0), finH: 2.0,
    body: (u, v, c) => {
      c.copy(C(0xdfe4e6));
      for (const bu of [0.45, 0.0, -0.45]) if (Math.abs(u - bu) < 0.07) c.copy(C(0x2a2a2a));
      if (v > 0.5) c.lerp(C(0xc9b26a), 0.4);
    } },
];

function fishGeometry(sp) {
  const { L, H, W } = sp, finH = sp.finH || 1;
  // Body: an ellipsoid along +x (head) that pinches toward the tail.
  const body = new THREE.SphereGeometry(0.5, 32, 20);
  const p = body.attributes.position;
  const bc = new Float32Array(p.count * 3), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) / 0.5, y = p.getY(i) / 0.5, z = p.getZ(i) / 0.5;
    const pinch = u < 0 ? 1 + u * 0.45 : 1 - 0.12 * u * u;
    p.setXYZ(i, (0.1 + u * 0.4) * L, y * 0.5 * H * pinch, z * 0.5 * W * pinch);
    sp.body(u, y, c);
    bc.set([c.r, c.g, c.b], i * 3);
  }
  body.setAttribute('color', new THREE.BufferAttribute(bc, 3));
  body.computeVertexNormals();

  const finGeo = (pts) => {
    const g = new THREE.ShapeGeometry(new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x * L, y * H))));
    const n = g.attributes.position.count, fc = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) fc.set([sp.fin.r, sp.fin.g, sp.fin.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(fc, 3));
    return g;
  };
  const tail = finGeo([[-0.27, 0], [-0.52, 0.48], [-0.45, 0], [-0.52, -0.48]]);
  const dorsal = finGeo([[0.16, 0.42], [-0.04, 0.42 + 0.32 * finH], [-0.24, 0.3], [-0.1, 0.32]]);
  const anal = finGeo([[0.0, -0.4], [-0.12, -0.4 - 0.22 * finH], [-0.24, -0.28]]);
  return mergeGeometries([body.toNonIndexed(), tail.toNonIndexed(), dorsal.toNonIndexed(), anal.toNonIndexed()]);
}

// Interior swimming volume (tank-local), with clearance from glass, sand and surface.
const BOUND = { x: HALF_W - 0.03, zMin: -HALF_D + 0.016, zMax: HALF_D - 0.018, yMax: WATER_Y - 0.012 };
const floorAt = (x, z) => sandY(x, z) + 0.016;

const eyeGeo = new THREE.SphereGeometry(1, 12, 10);
const eyeMat = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.15, envMap, envMapIntensity: 1.0 });
const fishes = SPECIES.map((sp, i) => {
  const u = { uPhase: { value: rr(0, 6) }, uAmp: { value: 0.11 * sp.L }, uLen: { value: sp.L } };
  const decl = 'uniform float uPhase; uniform float uAmp; uniform float uLen;';
  // Travelling body wave: zero at the head, growing toward the tail.
  const body = `float s = clamp((uLen * 0.3 - position.x) / (uLen * 0.8), 0.0, 1.0);
                transformed.z += sin(uPhase - position.x * 7.0 / uLen) * uAmp * s * s;`;
  const mat = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.08,
    side: THREE.DoubleSide, envMap, envMapIntensity: 0.6 }), u, decl, body, '', '', 'fish');
  const mesh = new THREE.Mesh(fishGeometry(sp), mat);
  mesh.customDepthMaterial = patch(depthTwin(THREE.DoubleSide), u, decl, body, '', '', 'fish-d');
  mesh.castShadow = true;
  const ex = 0.33 * sp.L, ez = 0.5 * sp.W * 0.78, er = Math.max(0.0012, 0.075 * Math.min(sp.H, 0.016) * 1.6);
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(eyeGeo, eyeMat);
    e.scale.setScalar(er);
    e.position.set(ex, 0.12 * sp.H, s * ez);
    mesh.add(e);
  }
  tank.add(mesh);
  const pos = new THREE.Vector3(rr(-0.08, 0.08), rr(-0.01, 0.04), rr(-0.02, 0.02));
  const f = { sp, mesh, u, pos, vel: new THREE.Vector3(rr(-1, 1), 0, rr(-1, 1)).setLength(sp.speed * 0.5),
    target: new THREE.Vector3(), timer: 0, quat: new THREE.Quaternion(), pace: 1 };
  pickTarget(f);
  mesh.position.copy(pos);
  return f;
});

function pickTarget(f) {
  const x = rr(-BOUND.x, BOUND.x), z = rr(BOUND.zMin, BOUND.zMax);
  f.target.set(x, rr(floorAt(x, z) + 0.005, BOUND.yMax), z);
  f.timer = rr(3, 8);
  f.pace = rr(0.6, 1.15);
}

const _d = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YZX');
function updateFish(dt) {
  for (const f of fishes) {
    // Go for the nearest food flake that is still in the water; otherwise wander.
    let goal = null, best = 0.12;
    for (const fl of food) { const d = fl.p.distanceTo(f.pos); if (d < best) { best = d; goal = fl; } }
    let speed = f.sp.speed * f.pace;
    if (goal) {
      f.target.copy(goal.p); speed = f.sp.speed * 1.7;
      if (best < 0.006) { food.splice(food.indexOf(goal), 1); f.timer = 0; }
    } else {
      f.timer -= dt;
      if (f.timer <= 0 || f.pos.distanceTo(f.target) < 0.012) pickTarget(f);
    }
    _d.subVectors(f.target, f.pos).setLength(speed);
    // Separation from the other fish.
    for (const o of fishes) {
      if (o === f) continue;
      const dx = f.pos.x - o.pos.x, dy = f.pos.y - o.pos.y, dz = f.pos.z - o.pos.z;
      const dd = Math.hypot(dx, dy, dz);
      if (dd < 0.03 && dd > 1e-5) { const k = (0.03 - dd) / 0.03 * speed * 1.5 / dd; _d.x += dx * k; _d.y += dy * k; _d.z += dz * k; }
    }
    f.vel.lerp(_d, Math.min(1, dt * 1.4));
    const sp = f.vel.length();
    if (Math.abs(f.vel.y) > sp * 0.45) f.vel.y = Math.sign(f.vel.y) * sp * 0.45;   // fish swim level-ish
    f.pos.addScaledVector(f.vel, dt);
    // Soft walls.
    f.pos.x = THREE.MathUtils.clamp(f.pos.x, -BOUND.x, BOUND.x);
    f.pos.z = THREE.MathUtils.clamp(f.pos.z, BOUND.zMin, BOUND.zMax);
    f.pos.y = THREE.MathUtils.clamp(f.pos.y, floorAt(f.pos.x, f.pos.z), BOUND.yMax);

    // Face the direction of travel (local +x is the nose), turning smoothly.
    const hv = Math.hypot(f.vel.x, f.vel.z);
    if (sp > 1e-4) {
      _e.set(0, Math.atan2(-f.vel.z, f.vel.x), THREE.MathUtils.clamp(Math.atan2(f.vel.y, hv), -0.45, 0.45));
      _q.setFromEuler(_e);
      f.quat.slerp(_q, 1 - Math.exp(-dt * 4));
    }
    f.mesh.position.copy(f.pos);
    f.mesh.quaternion.copy(f.quat);
    // Tail beat follows speed.
    f.u.uPhase.value += dt * (6 + 260 * sp);
    f.u.uAmp.value = f.sp.L * (0.07 + 2.2 * Math.min(sp, 0.05));
  }
}

// ---- per-frame animation (shared by the stereo and mono paths) -------------------------------
const yp = { yaw: 0, pitch: REST_PITCH, tYaw: 0, tPitch: REST_PITCH };
let lastInteract = -1e9;
const _m = new THREE.Matrix4();
function update(dt, now) {
  T.value += dt;
  if (now - lastInteract > 4000) { yp.tYaw = 0; yp.tPitch = REST_PITCH; }
  const k = 1 - Math.exp(-dt * (dragging ? 14 : 2.2));
  yp.yaw += (yp.tYaw - yp.yaw) * k;
  yp.pitch += (yp.tPitch - yp.pitch) * k;
  ornament.rotation.set(yp.pitch, yp.yaw, 0, 'XYZ');

  updateFish(dt);

  for (let i = 0; i < NB; i++) {
    const b = bubbles[i];
    b.y += b.sp * dt;
    if (b.y > WATER_Y - b.r) resetBubble(b, false);
    const rise = (b.y - b.y0);
    _m.makeScale(b.r, b.r, b.r).setPosition(BUB_X + Math.sin(T.value * 5 + b.ph) * 0.0012 + rise * 0.04,
      b.y, BUB_Z + Math.cos(T.value * 4 + b.ph) * 0.001);
    bubbleMesh.setMatrixAt(i, _m);
  }
  bubbleMesh.instanceMatrix.needsUpdate = true;

  for (let i = food.length - 1; i >= 0; i--) {
    const fl = food[i];
    fl.age += dt;
    if (fl.age > 1.2) {
      const floor = sandY(fl.p.x, fl.p.z) + 0.0006;
      if (fl.p.y > floor) {
        fl.p.y = Math.max(floor, fl.p.y - fl.sink * dt);
        fl.p.x += Math.sin(fl.age * 2 + fl.rot) * 0.002 * dt;
      }
    }
    if (fl.age > 25) food.splice(i, 1);
  }
  for (let i = 0; i < NF; i++) {
    const fl = food[i];
    if (fl) _m.makeRotationY(fl.rot + fl.age * 0.5).setPosition(fl.p);
    else _m.makeScale(0, 0, 0);
    foodMesh.setMatrixAt(i, _m);
  }
  foodMesh.instanceMatrix.needsUpdate = true;

  for (const s of shafts) s.material.uniforms.uO.value = 0.05 + 0.025 * Math.sin(T.value * 0.5 + s.userData.ph);
}

// ---- sizing --------------------------------------------------------------------------------
// While woven the backing store is DOUBLE-WIDTH (left eye | right eye) at device resolution; in
// mono it is 1:1. Never rewrite the size when it has not changed (that clears the buffer).
let woven = false;
const monoCam = new THREE.PerspectiveCamera(35, 1.6, 0.01, 10);
// The mono camera frames exactly VDH at z = 0, the same window the 3D display shows.
monoCam.position.set(0, 0, 0.5 * VDH / Math.tan(THREE.MathUtils.degToRad(35) / 2));
monoCam.lookAt(0, 0, 0);

function sizeBuffer() {
  const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
  let w = Math.max(2, Math.round(canvas.clientWidth * dpr));
  let h = Math.max(2, Math.round(canvas.clientHeight * dpr));
  let bw = woven ? w * 2 : w;
  const f = Math.min(1, MAX_DIM / bw, MAX_DIM / h);    // GPU limit: shrink both axes together
  if (f < 1) { bw = Math.floor(bw * f / 2) * 2; h = Math.floor(h * f); w = woven ? bw / 2 : bw; }
  monoCam.aspect = w / h; monoCam.updateProjectionMatrix();
  if (canvas.width === bw && canvas.height === h) return false;
  renderer.setSize(bw, h, false);
  return true;
}
new ResizeObserver(() => {
  if (!sizeBuffer()) return;
  if (woven) replayLastGood(); else renderMono();       // repaint now, not next frame
}).observe(canvas);

// ---- stereo path ---------------------------------------------------------------------------
const eyes = [];
const good = [];          // copies of the last good per-eye matrices + viewports
let haveGood = false, lastT = 0;

function onXRFrame(views, layer) {
  const now = performance.now();
  const dt = lastT ? Math.min(0.05, (now - lastT) / 1000) : 0; lastT = now;
  update(dt, now);

  // Validate EVERYTHING before clearing: a short view list or a null viewport must not empty
  // the canvas (that is a black blink); repaint the last good frame instead.
  if (!views || views.length < 2 || !layer) return replayLastGood();
  const vps = views.map((v) => layer.getViewport(v));
  if (vps.some((vp) => !vp || vp.width <= 0 || vp.height <= 0)) return replayLastGood();

  renderer.shadowMap.needsUpdate = true;     // one shadow pass, reused by every eye
  renderer.clear();
  renderer.setScissorTest(true);
  for (let i = 0; i < views.length; i++) {
    const vp = vps[i];
    if (!eyes[i]) { eyes[i] = new EyeCamera(THREE); good[i] = { proj: new Float32Array(16), pose: new Float32Array(16), vp: {} }; }
    renderer.setViewport(vp.x, vp.y, vp.width, vp.height);
    renderer.setScissor(vp.x, vp.y, vp.width, vp.height);
    eyes[i].setFromView(views[i]);
    renderer.render(scene, eyes[i].camera);
    const g = good[i];
    g.proj.set(views[i].projectionMatrix); g.pose.set(views[i].transform.matrix);
    Object.assign(g.vp, { x: vp.x, y: vp.y, width: vp.width, height: vp.height });
  }
  good.length = views.length;
  renderer.setScissorTest(false);
  haveGood = true;
}

function replayLastGood() {
  renderer.clear();
  if (!haveGood) return;                     // still present a (cleared) frame; the cover is up
  renderer.shadowMap.needsUpdate = true;
  renderer.setScissorTest(true);
  for (let i = 0; i < good.length; i++) {
    const g = good[i];
    renderer.setViewport(g.vp.x, g.vp.y, g.vp.width, g.vp.height);
    renderer.setScissor(g.vp.x, g.vp.y, g.vp.width, g.vp.height);
    eyes[i].setFromMatrices(g.proj, g.pose);
    renderer.render(scene, eyes[i].camera);
  }
  renderer.setScissorTest(false);
}

// ---- mono (2D) path ------------------------------------------------------------------------
let monoRunning = false;
function renderMono() {
  renderer.shadowMap.needsUpdate = true;
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, canvas.width, canvas.height);
  renderer.clear();
  renderer.render(scene, monoCam);
}
function monoLoop() {
  if (!monoRunning) return;
  requestAnimationFrame(monoLoop);
  const now = performance.now();
  const dt = lastT ? Math.min(0.05, (now - lastT) / 1000) : 0; lastT = now;
  update(dt, now);
  renderMono();
}
function goMono(msg) {
  woven = false;
  cover.hidden = true;
  sizeBuffer();
  if (!monoRunning) { monoRunning = true; lastT = 0; requestAnimationFrame(monoLoop); }
  statusEl.innerHTML = msg;
}

// ---- interaction: drag turns the tank (the subject), a click drops food -----------------------
let dragging = false, down = null;
canvas.addEventListener('pointerdown', (e) => {
  down = { x: e.clientX, y: e.clientY, yaw: yp.tYaw, pitch: yp.tPitch, moved: false };
  canvas.setPointerCapture(e.pointerId);
  lastInteract = performance.now();
});
canvas.addEventListener('pointermove', (e) => {
  if (!down) return;
  const dx = e.clientX - down.x, dy = e.clientY - down.y;
  if (!down.moved && Math.hypot(dx, dy) < 5) return;
  down.moved = true; dragging = true; canvas.classList.add('dragging');
  const k = 2.2 / Math.max(200, canvas.clientWidth);
  yp.tYaw = THREE.MathUtils.clamp(down.yaw + dx * k, -MAX_YAW, MAX_YAW);
  yp.tPitch = THREE.MathUtils.clamp(down.pitch + dy * k, PITCH_RANGE[0], PITCH_RANGE[1]);
  lastInteract = performance.now();
});
const endDrag = (e) => {
  if (!down) return;
  if (!down.moved && e.type === 'pointerup') {
    const r = canvas.getBoundingClientRect();
    const u = (e.clientX - r.left) / r.width - 0.5;
    dropFood(u * VDH * (r.width / r.height) * 0.9);
  }
  down = null; dragging = false; canvas.classList.remove('dragging');
  lastInteract = performance.now();
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

// ---- boot ----------------------------------------------------------------------------------
const MSG_2D = '<b>2D preview</b> — open in the DisplayXR Browser on a spatial display to see the tank in glasses-free 3D';
(async () => {
  let wall = null;
  try { wall = await createInline3D({ lazy: false }); } catch (err) { console.warn('[aquarium] inline-3D unavailable', err); }
  if (!wall || !wall.supported) { goMono(MSG_2D); return; }

  try {
    woven = true;
    cover.hidden = false;                       // hide the raw side-by-side pair until woven
    sizeBuffer();
    try { wall.session.updateRenderState({ depthNear: 0.01, depthFar: 10 }); } catch { /* keep defaults */ }
    const handle = wall.addScene(canvas, onXRFrame, {
      virtualDisplayHeight: VDH,
      rectCover: 'auto',                        // cover a later resize until rewoven()
      onLayerLost: () => goMono(MSG_2D),
    });
    handle.firstWoven.then((r) => {
      cover.hidden = true;                      // hard cut, never a fade
      if (woven) {
        statusEl.innerHTML = r && r.woven
          ? '<b style="color:#7fe0c4">Glasses-free 3D</b> — move your head to look around the tank'
          : 'The 3D display did not pick up this tile; showing what it can';
      }
    });
    statusEl.textContent = 'starting 3D…';
  } catch (err) {
    console.warn('[aquarium] addScene failed, falling back to 2D', err);
    goMono(MSG_2D);
  }
})();
