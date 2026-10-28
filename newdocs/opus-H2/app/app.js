// Desk Aquarium — a three.js tank framed by SceneViewer on a DISPLAY rig.
// Follows sdk/docs/making-3d-look-right.md and the starter-scene / starter-ui templates.
//
// RIG (guide §1): the user LOOKS AT an ornament on the desk; nobody moves through it → display rig.
//   The canvas is a portal onto a virtual display VDH metres tall; SceneViewer scales the tank
//   into it, so the depth does not depend on the units the tank is modelled in.
// SCREEN PLANE (§2): through the subject (SceneViewer centres it on the glass), nudged back with
//   depthOffset so the cheaper "behind" budget is used as well as the "in front" one.
// DEPTH (§3): depthFit scales the tank DOWN uniformly until its nearest point is ≤ FRONT and its
//   farthest ≤ BACK tile heights from the glass. On this 16:9 tile:
//     FRONT 0.10 h ≈ 0.6 % of the width  (the comfortable in-front column)
//     BACK  0.30 h ≈ 1.7 % of the width  (a touch past the comfortable 1.5 %, well inside the
//                                         2.3 % "strong" column; what sits there is the soft,
//                                         low-contrast backdrop — guide: soft mid-tone edges
//                                         tolerate more disparity than sharp bright ones)
//   The fish, plants and bubbles are all inside the tank's box, so they inherit the budget.
//   orbit:false / fitSweep:false — nothing turns the tank about Y, so its real depth is budgeted
//   (an orbit would swing its 1.6-wide front into depth, past the fit). Head tracking still
//   gives look-around.
// COMPOSITION (§4): the tank sits inside the tile with a margin; nothing touches a frame edge and
//   no HTML is over the canvas (all controls are below it).

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { createInline3D } from '@displayxr/inline3d';
import { EyeCamera, displayRig } from '@displayxr/inline3d/three';
import { SceneViewer } from '@displayxr/inline3d/viewer';

const canvas = document.getElementById('tank');
const cover = document.getElementById('cover');
const feedBtn = document.getElementById('feed');
const depth = document.getElementById('depth');
const modeBtn = document.getElementById('mode');
const note = document.getElementById('note');

const VDH = 0.24;                       // virtual display height, metres — the SAME on addScene
const FRONT = 0.10, BACK = 0.30;        // depth budget, tile heights (16:9 tile)
const BG = '#10151c';                   // == page colour behind the canvas (index.html)

const viewer = new SceneViewer(THREE, canvas, {
  virtualDisplayHeight: VDH,
  clearColor: BG,                       // OPAQUE clear: alpha-0 pixels weave as stale/black
  depthFit: { front: FRONT, back: BACK },
  margin: 0.86,                         // leaves a clear band of background round the tank
  fitSweep: false,
  orbit: false,
  // no `feather`: it fades to transparent, which needs an alpha clear (guide §5)
}).useEyeCamera(EyeCamera);

const renderer = viewer.renderer;       // pixel ratio 1 and sizing are owned by SceneViewer
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.05;
const scene = viewer.scene;
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.45;

// ---- helpers ----------------------------------------------------------------------------------
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const lerp = THREE.MathUtils.lerp;
const uTime = { value: 0 };             // shared shader clock (world-keyed effects: both eyes agree)

function canvasTexture(w, h, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}

// ---- tank dimensions (model units; SceneViewer rescales everything) ---------------------------
const W = 1.6, D = 0.5, H = 0.95;       // inner glass box; floor at y = 0
const WATER = 0.87;                      // water line
const GT = 0.012;                        // glass thickness

// Sand surface: an aquascape slope rising toward the back, plus gentle ripples.
function sandH(x, z) {
  const back = 0.5 - z / D;              // 0 at the front pane, 1 at the back
  return 0.055 + 0.085 * back * back
    + 0.012 * Math.sin(x * 9.0 + z * 4.0) + 0.008 * Math.sin(x * 23.0 - z * 17.0)
    + 0.03 * Math.exp(-((x + 0.3) ** 2 + (z + 0.12) ** 2) / 0.03);   // a mound by the big rock
}

const set = new THREE.Group();           // the whole ornament
const tank = new THREE.Group();          // everything in tank coordinates
set.add(tank);

// ---- plinth (walnut) --------------------------------------------------------------------------
const woodTex = canvasTexture(512, 128, (g, w, h) => {
  g.fillStyle = '#5b3a25'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 160; i++) {
    const y = rnd() * h, a = rnd() * 0.18;
    g.strokeStyle = `rgba(${rnd() < 0.5 ? '30,16,8' : '150,100,60'},${a})`;
    g.lineWidth = 0.5 + rnd() * 2;
    g.beginPath(); g.moveTo(0, y);
    for (let x = 0; x <= w; x += 32) g.lineTo(x, y + Math.sin(x * 0.02 + i) * 3);
    g.stroke();
  }
});
const plinth = new THREE.Mesh(
  new THREE.BoxGeometry(W + 0.12, 0.07, D + 0.12),
  new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.55, metalness: 0 }),
);
plinth.position.y = -0.035 - GT;
tank.add(plinth);

// ---- backdrop: a soft blue gradient behind the back glass (low contrast → comfortable far plane)
const backTex = canvasTexture(512, 320, (g, w, h) => {
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, '#2f7f9a'); grd.addColorStop(0.55, '#1a4f6e'); grd.addColorStop(1, '#0f2e47');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
  // soft mottling: gives stereo matching something to lock on to without hard edges
  for (let i = 0; i < 70; i++) {
    const x = rnd() * w, y = rnd() * h, r = 20 + rnd() * 70;
    const rg = g.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, `rgba(${rnd() < 0.5 ? '140,210,230' : '5,20,40'},0.10)`);
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg; g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
});
const backdrop = new THREE.Mesh(
  new THREE.PlaneGeometry(W, H),
  new THREE.MeshStandardMaterial({ map: backTex, roughness: 1, emissive: 0xffffff, emissiveMap: backTex, emissiveIntensity: 0.35 }),
);
backdrop.position.set(0, H / 2, -D / 2 - GT - 0.002);
tank.add(backdrop);

// ---- sand: heightfield top + skirts down to the tank floor (seen in section through the glass)
const sandTex = canvasTexture(256, 256, (g, w, h) => {
  g.fillStyle = '#cdb68e'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 6000; i++) {
    const v = rnd();
    g.fillStyle = v < 0.45 ? `rgba(90,70,45,${rnd() * 0.35})` : v < 0.9 ? `rgba(255,245,220,${rnd() * 0.35})` : `rgba(60,60,60,${rnd() * 0.5})`;
    const s = 1 + rnd() * 2.2;
    g.fillRect(rnd() * w, rnd() * h, s, s);
  }
}, [1, 1]);

function sandGeometry() {
  const NX = 96, NZ = 32, pos = [], uv = [], idx = [];
  const vert = (x, y, z, u, v) => { pos.push(x, y, z); uv.push(u, v); return pos.length / 3 - 1; };
  const grid = [];
  for (let j = 0; j <= NZ; j++) {
    for (let i = 0; i <= NX; i++) {
      const x = -W / 2 + (W * i) / NX, z = -D / 2 + (D * j) / NZ;
      grid.push(vert(x, sandH(x, z), z, x * 2.2, z * 2.2));
    }
  }
  const at = (i, j) => grid[j * (NX + 1) + i];
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    idx.push(at(i, j), at(i, j + 1), at(i + 1, j), at(i + 1, j), at(i, j + 1), at(i + 1, j + 1));
  }
  // skirts (front and sides; the back one is hidden by the backdrop)
  const skirt = (pts) => {
    let prev = null;
    for (const [x, z] of pts) {
      const y = sandH(x, z), s = x + z;
      const top = vert(x, y, z, s * 2.2, y * 2.2), bot = vert(x, 0, z, s * 2.2, 0);
      if (prev) idx.push(prev[0], prev[1], top, top, prev[1], bot);
      prev = [top, bot];
    }
  };
  const line = (n, f) => Array.from({ length: n + 1 }, (_, k) => f(k / n));
  skirt(line(NX, (t) => [-W / 2 + W * t, D / 2]));
  skirt(line(NZ, (t) => [-W / 2, -D / 2 + D * t]));
  skirt(line(NZ, (t) => [W / 2, -D / 2 + D * t]));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// Caustics on the sand: thin bright moving lines, keyed on tank-space position and time.
const sandMat = new THREE.MeshStandardMaterial({ map: sandTex, roughness: 0.95, side: THREE.DoubleSide });
sandMat.onBeforeCompile = (sh) => {
  sh.uniforms.uTime = uTime;
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vTankPos;\nvarying float vUp;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTankPos = position;\nvUp = normal.y;');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', `#include <common>
      uniform float uTime; varying vec3 vTankPos; varying float vUp;
      float caustic(vec2 p, float t) {
        vec2 q = p; float v = 0.0;
        for (int i = 0; i < 3; i++) {
          float fi = float(i);
          q += 0.55 * vec2(sin(q.y * 1.3 + t * 0.8 + fi * 1.9), cos(q.x * 1.1 - t * 0.65 + fi * 2.7));
          v += abs(sin(q.x + q.y + fi));
        }
        return pow(clamp(1.0 - v / 3.0, 0.0, 1.0), 3.0);
      }`)
    .replace('#include <dithering_fragment>', `#include <dithering_fragment>
      float c = caustic(vTankPos.xz * 11.0, uTime) * smoothstep(0.6, 0.95, vUp);
      gl_FragColor.rgb += c * vec3(0.30, 0.42, 0.42);`);
};
const sand = new THREE.Mesh(sandGeometry(), sandMat);
tank.add(sand);

// ---- rocks: displaced icospheres with mossy tops ----------------------------------------------
function rockGeometry(r, sx, sy, sz) {
  let g = new THREE.IcosahedronGeometry(1, 4);
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = mergeVertices(g);
  const p = g.attributes.position, v = new THREE.Vector3();
  const o = [rnd() * 9, rnd() * 9, rnd() * 9];
  const cols = [];
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = 1 + 0.16 * Math.sin(v.x * 2.1 + o[0]) * Math.sin(v.y * 2.3 + o[1]) * Math.sin(v.z * 1.9 + o[2])
      + 0.07 * Math.sin(v.x * 5.3 + v.z * 4.1 + o[1]) + 0.03 * Math.sin(v.y * 11.0 + v.x * 9.0);
    v.multiplyScalar(n);
    v.set(v.x * sx * r, v.y * sy * r, v.z * sz * r);
    p.setXYZ(i, v.x, v.y, v.z);
    const grain = 0.85 + 0.3 * rnd();
    const moss = THREE.MathUtils.smoothstep(v.y / (sy * r), 0.35, 0.9) * 0.55;
    const base = new THREE.Color(0.36 * grain, 0.33 * grain, 0.30 * grain);
    base.lerp(new THREE.Color(0.20, 0.33, 0.14), moss);
    cols.push(base.r, base.g, base.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.computeVertexNormals();
  return g;
}
const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
const rocks = [
  [-0.30, -0.10, 0.17, 1.35, 0.95, 0.95],
  [0.56, -0.02, 0.12, 1.2, 0.85, 1.0],
  [-0.66, 0.10, 0.075, 1.3, 0.7, 1.0],
  [0.30, 0.13, 0.05, 1.2, 0.6, 1.0],
  [-0.12, 0.14, 0.035, 1.1, 0.6, 1.0],
];
for (const [x, z, r, sx, sy, sz] of rocks) {
  const m = new THREE.Mesh(rockGeometry(r, sx, sy, sz), rockMat);
  m.position.set(x, sandH(x, z) - r * sy * 0.25, z);
  m.rotation.y = rnd() * Math.PI * 2;
  tank.add(m);
}
// pebbles strewn over the sand
{
  const peb = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ roughness: 0.8 }), 70);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), e = new THREE.Euler();
  for (let i = 0; i < peb.count; i++) {
    const x = (rnd() - 0.5) * (W - 0.06), z = (rnd() - 0.5) * (D - 0.06), r = 0.006 + rnd() * 0.012;
    s.set(r * (1 + rnd() * 0.6), r * 0.6, r);
    q.setFromEuler(e.set(0, rnd() * 6.3, 0));
    m.compose(new THREE.Vector3(x, sandH(x, z) + r * 0.2, z), q, s);
    peb.setMatrixAt(i, m);
    const c = new THREE.Color().setHSL(0.07 + rnd() * 0.05, 0.15 + rnd() * 0.2, 0.25 + rnd() * 0.4);
    peb.setColorAt(i, c);
  }
  tank.add(peb);
}

// ---- plants: ribbon blades merged per cluster, swaying in a vertex shader ---------------------
const plantMat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.65 });
plantMat.onBeforeCompile = (sh) => {
  sh.uniforms.uTime = uTime;
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float aSway;\nattribute float aPhase;\nuniform float uTime;')
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      float s2 = aSway * aSway;
      transformed.x += sin(uTime * 1.05 + aPhase + aSway * 3.0) * s2 * 0.17;
      transformed.z += sin(uTime * 0.75 + aPhase * 1.3 + aSway * 2.2) * s2 * 0.08;`);
};

function plantCluster(n, { h0, h1, w, spread, hue, sat, light }) {
  const geos = [];
  for (let b = 0; b < n; b++) {
    const h = lerp(h0, h1, rnd()), seg = 14;
    const g = new THREE.PlaneGeometry(w * (0.7 + rnd() * 0.6), 1, 1, seg);
    g.translate(0, 0.5, 0);
    const p = g.attributes.position, sway = [], phase = [], col = [];
    const ph = rnd() * Math.PI * 2, curl = (rnd() - 0.5) * 0.5;
    const tint = new THREE.Color().setHSL(hue + (rnd() - 0.5) * 0.04, sat, light * (0.85 + rnd() * 0.3));
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      p.setX(i, p.getX(i) * (1 - 0.8 * Math.pow(y, 1.6)) + curl * y * y * h * 0.4);
      p.setZ(i, 0.18 * y * y * h);
      p.setY(i, y * h);
      sway.push(y * h); phase.push(ph);
      const c = tint.clone().multiplyScalar(0.45 + 0.75 * y);
      col.push(c.r, c.g, c.b);
    }
    g.setAttribute('aSway', new THREE.Float32BufferAttribute(sway, 1));
    g.setAttribute('aPhase', new THREE.Float32BufferAttribute(phase, 1));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.rotateY(rnd() * Math.PI * 2);
    g.translate((rnd() - 0.5) * spread, 0, (rnd() - 0.5) * spread * 0.6);
    geos.push(g);
  }
  const merged = mergeGeometries(geos);
  merged.computeVertexNormals();
  return new THREE.Mesh(merged, plantMat);
}
const plants = [
  [-0.56, -0.15, 14, { h0: 0.45, h1: 0.68, w: 0.034, spread: 0.16, hue: 0.29, sat: 0.55, light: 0.42 }],
  [0.40, -0.16, 12, { h0: 0.40, h1: 0.62, w: 0.03, spread: 0.18, hue: 0.31, sat: 0.5, light: 0.40 }],
  [0.12, -0.18, 8, { h0: 0.24, h1: 0.38, w: 0.05, spread: 0.12, hue: 0.02, sat: 0.55, light: 0.40 }],
  [0.70, -0.14, 7, { h0: 0.28, h1: 0.45, w: 0.045, spread: 0.10, hue: 0.24, sat: 0.6, light: 0.45 }],
  [-0.08, -0.17, 6, { h0: 0.18, h1: 0.30, w: 0.04, spread: 0.10, hue: 0.33, sat: 0.5, light: 0.38 }],
  [-0.70, 0.02, 6, { h0: 0.12, h1: 0.20, w: 0.04, spread: 0.08, hue: 0.27, sat: 0.6, light: 0.45 }],
];
for (const [x, z, n, opts] of plants) {
  const m = plantCluster(n, opts);
  m.position.set(x, sandH(x, z) - 0.01, z);
  tank.add(m);
}

// ---- fish ------------------------------------------------------------------------------------
// Bodies are along +z (so Matrix4.lookAt can aim them), laterally compressed like real fish, with
// colour bands from vertex colours (no texture seams). The tail and fins hang off pivots.
const FISH = [
  { name: 'clown', len: 0.15, h: 0.075, w: 0.05, body: '#f06418', belly: '#f79a52', fin: '#f07a2a',
    bands: [[0.70, 0.07, '#fbfbf6'], [0.42, 0.09, '#fbfbf6'], [0.12, 0.05, '#fbfbf6']], edge: '#1d140f', speed: 0.13 },
  { name: 'tang', len: 0.19, h: 0.10, w: 0.045, body: '#2b5fd8', belly: '#4f86ec', fin: '#1d3a8f', tail: '#f3cf2c',
    bands: [[0.45, 0.22, '#152b6b']], speed: 0.16 },
  { name: 'yellow', len: 0.16, h: 0.11, w: 0.04, body: '#f6d21c', belly: '#fbe46a', fin: '#f2c510', speed: 0.14 },
  { name: 'angel', len: 0.15, h: 0.12, w: 0.035, body: '#d9dfe2', belly: '#f2f4f2', fin: '#c8d0d4', tallFins: true,
    bands: [[0.70, 0.05, '#2c2f33'], [0.48, 0.05, '#2c2f33'], [0.26, 0.04, '#2c2f33']], speed: 0.10 },
  { name: 'gramma', len: 0.12, h: 0.055, w: 0.035, body: '#8a3fd1', rear: '#f2b92e', belly: '#a35fe0', fin: '#c08a2c', speed: 0.15 },
];

const finShape = (pts) => {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  return new THREE.ShapeGeometry(s).rotateY(-Math.PI / 2);   // shape u → +z, v → +y
};
const shadowTex = canvasTexture(64, 64, (g) => {
  const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  rg.addColorStop(0, 'rgba(0,0,0,0.55)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = rg; g.fillRect(0, 0, 64, 64);
});

function makeFish(spec) {
  const { len, h, w } = spec;
  const g = new THREE.SphereGeometry(1, 28, 44).rotateX(Math.PI / 2);   // poles along z
  const p = g.attributes.position, col = [];
  const cBody = new THREE.Color(spec.body), cBelly = new THREE.Color(spec.belly);
  const cRear = spec.rear ? new THREE.Color(spec.rear) : null;
  const cEdge = spec.edge ? new THREE.Color(spec.edge) : null;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const fat = 1 + 0.22 * z - 0.15 * Math.max(0, -z) ** 2;   // thick forward, thin toward the tail
    x *= fat; y *= fat * (1 - 0.12 * Math.max(0, z) ** 3);
    const t = (z + 1) / 2;                                    // 0 = tail end, 1 = nose
    const c = cRear ? cRear.clone().lerp(cBody, THREE.MathUtils.smoothstep(t, 0.4, 0.6)) : cBody.clone();
    c.lerp(cBelly, THREE.MathUtils.smoothstep(-y, 0.1, 0.9) * 0.8);
    for (const [at, half, hex] of spec.bands || []) {
      const d = Math.abs(t - at);
      if (d < half) c.set(hex);
      else if (cEdge && d < half + 0.025) c.copy(cEdge);
    }
    col.push(c.r, c.g, c.b);
    p.setXYZ(i, x * w / 2, y * h / 2, z * len / 2);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();

  const fish = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.05 });
  const finMat = new THREE.MeshStandardMaterial({ color: spec.fin, roughness: 0.5, side: THREE.DoubleSide });
  const tailMat = spec.tail ? new THREE.MeshStandardMaterial({ color: spec.tail, roughness: 0.5, side: THREE.DoubleSide }) : finMat;
  const body = new THREE.Mesh(g, bodyMat);
  fish.add(body);

  const tail = new THREE.Group();
  tail.position.z = -len * 0.44;
  const tl = len * 0.32, th = h * (spec.tallFins ? 1.1 : 0.85);
  tail.add(new THREE.Mesh(finShape([[0.02 * len, 0], [-tl, th / 2], [-tl * 0.72, 0], [-tl, -th / 2]]), tailMat));
  fish.add(tail);

  const dh = spec.tallFins ? h * 0.9 : h * 0.32;
  const dorsal = new THREE.Mesh(finShape([[len * 0.18, 0], [-len * 0.08, dh], [-len * 0.32, 0]]), finMat);
  dorsal.position.y = h * 0.4;
  fish.add(dorsal);
  const anal = new THREE.Mesh(finShape([[len * 0.02, 0], [-len * 0.2, -dh * 0.7], [-len * 0.3, 0]]), finMat);
  anal.position.y = -h * 0.38;
  fish.add(anal);

  const pects = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(s * w * 0.42, -h * 0.08, len * 0.12);
    const fin = new THREE.Mesh(finShape([[0, 0], [-len * 0.16, h * 0.12], [-len * 0.13, -h * 0.1]]), finMat);
    pivot.add(fin);
    pivot.rotation.y = s * 0.5;
    fish.add(pivot);
    pects.push(pivot);
  }
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.15 });
  const ringMat = new THREE.MeshStandardMaterial({ color: 0xe8e2c8, roughness: 0.4 });
  for (const s of [-1, 1]) {
    const ring = new THREE.Mesh(new THREE.SphereGeometry(h * 0.1, 12, 10), ringMat);
    ring.position.set(s * w * 0.36, h * 0.1, len * 0.31);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(h * 0.07, 12, 10), eyeMat);
    pupil.position.set(s * h * 0.045, 0, h * 0.02);
    ring.add(pupil);
    fish.add(ring);
  }

  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
  );
  return { spec, fish, tail, pects, shadow, pos: new THREE.Vector3(), vel: new THREE.Vector3(), target: new THREE.Vector3(),
           retarget: 0, phase: rnd() * 10, cruise: spec.speed, eaten: 0 };
}

// Where a fish may go: inside the water, above the sand, clear of the glass.
const swimMin = (y) => new THREE.Vector3(-W / 2 + 0.1, y, -D / 2 + 0.07);
const swimMax = new THREE.Vector3(W / 2 - 0.1, WATER - 0.07, D / 2 - 0.07);
function pickTarget(f) {
  const x = lerp(-W / 2 + 0.12, W / 2 - 0.12, rnd()), z = lerp(-D / 2 + 0.08, D / 2 - 0.08, rnd());
  const yLo = sandH(x, z) + 0.08;
  f.target.set(x, lerp(yLo, swimMax.y, rnd() * 0.85), z);
  f.retarget = 3 + rnd() * 5;
  f.cruise = f.spec.speed * (rnd() < 0.2 ? 0.45 : 0.8 + rnd() * 0.4);   // sometimes dawdle
}

const school = FISH.map(makeFish);
school.forEach((f, i) => {
  f.pos.set(lerp(-0.55, 0.55, i / (school.length - 1)), 0.35 + rnd() * 0.3, (rnd() - 0.5) * 0.2);
  f.vel.set(i % 2 ? -1 : 1, 0, 0).multiplyScalar(f.spec.speed);
  pickTarget(f);
  f.fish.position.copy(f.pos);
  f.fish.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(f.vel, new THREE.Vector3(), new THREE.Vector3(0, 1, 0)));
  tank.add(f.fish, f.shadow);
});

// ---- bubbles from an air stone in the back-right corner --------------------------------------
const STONE = new THREE.Vector3(W / 2 - 0.14, 0, -D / 2 + 0.07);
STONE.y = sandH(STONE.x, STONE.z);
const stone = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.03, 16),
  new THREE.MeshStandardMaterial({ color: 0x8c8a86, roughness: 1 }));
stone.position.copy(STONE).setY(STONE.y + 0.005);
tank.add(stone);
const bubbleMat = new THREE.MeshStandardMaterial({ color: 0xe8fbff, roughness: 0.05, metalness: 0.1,
  transparent: true, opacity: 0.45, depthWrite: false, envMapIntensity: 1.2 });
const bubbleGeo = new THREE.SphereGeometry(1, 12, 8);
const bubbles = Array.from({ length: 26 }, (_, i) => {
  const m = new THREE.Mesh(bubbleGeo, bubbleMat);
  const b = { m, y: STONE.y + (WATER - STONE.y) * (i / 26), r: 0.004 + rnd() * 0.006, ph: rnd() * 6.3, sp: 0.16 + rnd() * 0.08 };
  m.scale.setScalar(b.r);
  tank.add(m);
  return b;
});

// ---- water and glass -------------------------------------------------------------------------
// Water volume: front-facing box faces tint what is inside; its top is drawn by the surface mesh.
const waterMat = new THREE.MeshPhysicalMaterial({ color: 0x4fb7c4, transparent: true, opacity: 0.10,
  roughness: 0.2, depthWrite: false, envMapIntensity: 0.3 });
const hidden = new THREE.MeshBasicMaterial({ visible: false });
const water = new THREE.Mesh(new THREE.BoxGeometry(W - 0.002, WATER, D - 0.002),
  [waterMat, waterMat, hidden, hidden, waterMat, hidden]);       // +x −x +y −y +z −z
water.position.y = WATER / 2;
tank.add(water);

const surfMat = new THREE.MeshPhysicalMaterial({ color: 0x9fdde4, transparent: true, opacity: 0.32,
  roughness: 0.08, metalness: 0, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 0.55 });
surfMat.onBeforeCompile = (sh) => {
  sh.uniforms.uTime = uTime;
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nuniform float uTime;')
    .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
      vec2 sp = position.xy * 14.0;
      objectNormal = normalize(vec3(0.07 * cos(sp.x + uTime * 1.6) + 0.05 * cos(sp.x * 0.7 + sp.y * 1.3 - uTime * 1.2),
                                    0.07 * cos(sp.y * 1.2 - uTime * 1.3), 1.0));`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      transformed.z += 0.004 * sin(sp.x + uTime * 1.6) + 0.003 * sin(sp.x * 0.7 + sp.y * 1.3 - uTime * 1.2);`);
};
const surface = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.002, D - 0.002, 64, 20), surfMat);
surface.rotation.x = -Math.PI / 2;
surface.position.y = WATER;
tank.add(surface);

const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xd8f2ee, transparent: true, opacity: 0.07,
  roughness: 0.04, metalness: 0, depthWrite: false, envMapIntensity: 0.5 });
const pane = (sx, sy, sz, x, y, z) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), glassMat);
  m.position.set(x, y, z);
  tank.add(m);
};
pane(W + 2 * GT, H, GT, 0, H / 2, D / 2 + GT / 2);           // front
pane(GT, H, D, -W / 2 - GT / 2, H / 2, 0);                   // left
pane(GT, H, D, W / 2 + GT / 2, H / 2, 0);                    // right
pane(W + 2 * GT, H, GT, 0, H / 2, -D / 2 - GT / 2);          // back (in front of the backdrop)

// Polished glass edges: the faint green of thick low-iron glass, soft rather than bright, so
// the tank's outline reads without the hard high-contrast lines that ghost first off the glass.
const edgeMat = new THREE.MeshStandardMaterial({ color: 0x7fb5a8, roughness: 0.25, transparent: true, opacity: 0.55, depthWrite: false });
const xs = [-W / 2 - GT / 2, W / 2 + GT / 2], zs = [-D / 2 - GT / 2, D / 2 + GT / 2];
for (const x of xs) for (const z of zs) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(GT, H, GT), edgeMat); m.position.set(x, H / 2, z); tank.add(m);
}
for (const y of [H, -GT / 2]) {
  for (const z of zs) { const m = new THREE.Mesh(new THREE.BoxGeometry(W + 2 * GT, GT, GT), edgeMat); m.position.set(0, y, z); tank.add(m); }
  for (const x of xs) { const m = new THREE.Mesh(new THREE.BoxGeometry(GT, GT, D + 2 * GT), edgeMat); m.position.set(x, y, 0); tank.add(m); }
}

// A slim LED lamp across the top, resting on the side panes.
const lamp = new THREE.Group();
const lampBody = new THREE.Mesh(new THREE.BoxGeometry(W * 0.86, 0.022, 0.085),
  new THREE.MeshStandardMaterial({ color: 0x2b3138, roughness: 0.4, metalness: 0.6 }));
lamp.add(lampBody);
const led = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.82, 0.05).rotateX(Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xdff6ff }));
led.position.y = -0.0115;
lamp.add(led);
const armLen = (W + GT - W * 0.86) / 2 + 0.01;               // bracket from the bar to each side pane
for (const s of [-1, 1]) {
  const arm = new THREE.Mesh(new THREE.BoxGeometry(armLen, 0.012, 0.03), lampBody.material);
  arm.position.set(s * (W * 0.43 + armLen / 2 - 0.005), 0, 0);
  const foot = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.02, 0.12), lampBody.material);
  foot.position.set(s * (W / 2 + GT / 2), -0.002, 0);
  lamp.add(arm, foot);
}
lamp.position.y = H + GT + 0.011;
tank.add(lamp);

// ---- lights ------------------------------------------------------------------------------------
const sun = new THREE.DirectionalLight(0xf2fbff, 2.4);    // the lamp: from above, slightly front
sun.position.set(0.25, 3, 0.9);
const fill = new THREE.HemisphereLight(0xbfe8ff, 0x3a2c20, 0.55);
scene.add(sun, fill);

// ---- framing -----------------------------------------------------------------------------------
// A desk ornament seen from a seated eye: face-on, tipped 7° toward the viewer so the sand and
// the water surface read. No yaw on purpose: every degree swings the tank's 1.6 width into depth
// and depthFit would shrink the whole tank to pay for it (4° of yaw costs ~12 % of its size).
// Head tracking supplies the look-around. Ornament depth after the tilt ≈ 0.75 units against a
// 0.40 h budget → the tank comes out ≈ 0.6 h tall, ≈ 52 % of the tile width.
set.rotation.set(THREE.MathUtils.degToRad(7), 0, 0);
viewer.content.add(set);
set.updateMatrix();
// Fit on the ornament's own box (plinth to lamp), turned exactly as shown, so depthFit sees the
// true nearest and farthest points (not the moving fish, which are always inside it).
const ornament = new THREE.Box3(
  new THREE.Vector3(-W / 2 - 0.06, -0.07 - GT, -D / 2 - 0.06),
  new THREE.Vector3(W / 2 + 0.06, H + 0.035, D / 2 + 0.06),
).applyMatrix4(set.matrix);
viewer.depthOffset = -((BACK - FRONT) / 2) * VDH;   // centre 0.1 h behind the glass: both ends at budget
viewer.fitTo(ornament.getCenter(new THREE.Vector3()), ornament.getSize(new THREE.Vector3()));

// ---- feeding -----------------------------------------------------------------------------------
const flakes = [];
const flakeGeo = new THREE.BoxGeometry(0.014, 0.0025, 0.011);
const flakeMats = ['#c9772f', '#b8432e', '#d9b35a', '#7a9a3a'].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 }));
function feed() {
  const cx = lerp(-0.4, 0.4, rnd());
  for (let i = 0; i < 12; i++) {
    const m = new THREE.Mesh(flakeGeo, flakeMats[i % flakeMats.length]);
    const f = { m, pos: new THREE.Vector3(cx + (rnd() - 0.5) * 0.25, WATER - 0.004, (rnd() - 0.5) * (D - 0.16)),
                float: 0.8 + rnd() * 2.0, life: 0, spin: new THREE.Vector3(rnd(), rnd(), rnd()).multiplyScalar(3), ph: rnd() * 6 };
    m.position.copy(f.pos);
    tank.add(m);
    flakes.push(f);
  }
  for (const f of school) f.eaten = 0;
}
feedBtn.addEventListener('click', feed);
function removeFlake(i) {
  tank.remove(flakes[i].m);
  flakes.splice(i, 1);
}

// ---- animation -----------------------------------------------------------------------------------
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), roll = new THREE.Quaternion();
const ZERO = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const desired = new THREE.Vector3(), sep = new THREE.Vector3(), dir = new THREE.Vector3();
let lastT = 0;

function stepFish(f, dt, t) {
  // Chase food if any is in the water and this fish is still hungry; otherwise wander.
  let chasing = null;
  if (flakes.length && f.eaten < 4) {
    let best = Infinity;
    for (const fl of flakes) {
      const d = fl.pos.distanceToSquared(f.pos);
      if (d < best) { best = d; chasing = fl; }
    }
  }
  if (chasing) {
    f.target.copy(chasing.pos);
    f.cruise = f.spec.speed * 1.7;
  } else {
    f.retarget -= dt;
    if (f.retarget <= 0 || f.pos.distanceTo(f.target) < 0.06) pickTarget(f);
  }
  desired.subVectors(f.target, f.pos);
  desired.y *= chasing ? 1 : 0.6;                       // fish mostly cruise level
  desired.normalize().multiplyScalar(f.cruise);
  // keep a little personal space
  sep.set(0, 0, 0);
  for (const o of school) {
    if (o === f) continue;
    dir.subVectors(f.pos, o.pos);
    const d = dir.length(), r = (f.spec.len + o.spec.len) * 0.75;
    if (d > 1e-4 && d < r) sep.addScaledVector(dir, ((r - d) / r) / d);
  }
  desired.addScaledVector(sep, 0.12);
  f.vel.lerp(desired, 1 - Math.exp(-dt * (chasing ? 2.2 : 1.1)));
  // limit climb angle so nobody swims straight up
  const hs = Math.hypot(f.vel.x, f.vel.z);
  f.vel.y = THREE.MathUtils.clamp(f.vel.y, -hs * 0.7, hs * 0.7);
  f.pos.addScaledVector(f.vel, dt);
  const floor = sandH(f.pos.x, f.pos.z) + f.spec.h * 0.7;
  f.pos.clamp(swimMin(floor), swimMax);
  f.fish.position.copy(f.pos);

  // Aim along velocity, bank slightly into turns, and smooth it.
  const speed = f.vel.length();
  if (speed > 1e-4) {
    tmpM.lookAt(dir.copy(f.vel), ZERO, UP);
    tmpQ.setFromRotationMatrix(tmpM);
    const turn = f.vel.clone().normalize().cross(desired.clone().normalize()).y;
    roll.setFromAxisAngle(Z, THREE.MathUtils.clamp(-turn * 0.6, -0.35, 0.35));
    tmpQ.multiply(roll);
    f.fish.quaternion.slerp(tmpQ, 1 - Math.exp(-dt * 5));
  }
  // Swimming motion: the tail beats faster when the fish is faster.
  f.phase += dt * (5 + speed * 45);
  f.tail.rotation.y = Math.sin(f.phase) * (0.35 + speed * 1.5);
  f.fish.children[0].rotation.y = -Math.sin(f.phase) * 0.05;   // body flexes against the tail
  f.pects[0].rotation.y = -0.5 - 0.35 * Math.sin(t * 6 + f.phase * 0.3);
  f.pects[1].rotation.y = 0.5 + 0.35 * Math.sin(t * 6 + f.phase * 0.3);

  // Soft blob shadow on the sand, fading as the fish rises.
  const sy = sandH(f.pos.x, f.pos.z), height = f.pos.y - sy;
  f.shadow.position.set(f.pos.x, sy + 0.004, f.pos.z);
  const s = f.spec.len * (1.1 + height * 0.8);
  f.shadow.scale.set(s * 0.55, 1, s);
  f.shadow.rotation.y = Math.atan2(f.vel.x, f.vel.z);
  f.shadow.material.opacity = THREE.MathUtils.clamp(0.9 - height * 1.1, 0.15, 0.9);

  // Eat a flake that is right at the mouth.
  if (chasing) {
    dir.set(0, 0, f.spec.len * 0.5).applyQuaternion(f.fish.quaternion).add(f.pos);
    if (dir.distanceTo(chasing.pos) < f.spec.len * 0.35) {
      removeFlake(flakes.indexOf(chasing));
      f.eaten++;
      f.retarget = 0;
    }
  }
}

viewer.onTick = () => {
  const now = performance.now(), dt = lastT ? Math.min((now - lastT) / 1000, 0.05) : 0;
  lastT = now;
  const t = (uTime.value += dt);
  for (const f of school) stepFish(f, dt, t);

  for (const b of bubbles) {
    b.y += dt * b.sp;
    if (b.y > WATER - b.r) { b.y = STONE.y + 0.02; b.ph = rnd() * 6.3; }
    const rise = b.y - STONE.y;
    b.m.position.set(STONE.x + Math.sin(t * 3 + b.ph) * 0.006 * (1 + rise * 3), b.y, STONE.z + Math.cos(t * 2.3 + b.ph) * 0.005 * (1 + rise * 2));
  }

  for (let i = flakes.length - 1; i >= 0; i--) {
    const f = flakes[i];
    f.life += dt;
    if (f.life > f.float) {                               // float a moment, then drift down
      const floor = sandH(f.pos.x, f.pos.z) + 0.003;
      if (f.pos.y > floor) {
        f.pos.y = Math.max(floor, f.pos.y - dt * 0.045);
        f.pos.x += Math.sin(t * 1.7 + f.ph) * dt * 0.02;
        f.m.rotation.x += f.spin.x * dt; f.m.rotation.z += f.spin.z * dt;
      } else if (f.life > 25) { removeFlake(i); continue; }
    }
    f.m.rotation.y += f.spin.y * dt * 0.3;
    f.m.position.copy(f.pos);
  }
};

// ---- boot ------------------------------------------------------------------------------------------
const wall = await createInline3D({ lazy: false });
if (!wall.supported) {
  // An ordinary browser: the same page, flat, with the same layout. The 3D controls rest.
  viewer.startMono();
  cover.remove();
  depth.disabled = modeBtn.disabled = true;
  modeBtn.textContent = '2D';
  note.textContent = 'Open this page in the DisplayXR Browser on a 3D display to see the tank in glasses-free 3D.';
} else {
  const rig = (k) => displayRig({ virtualDisplayHeight: VDH, ipdFactor: k, parallaxFactor: k });
  const handle = wall.addScene(canvas, viewer.onFrame, { viewRig: rig(1), onLayerLost: viewer.onLayerLost });
  wall.session.updateRenderState({ depthNear: 0.01, depthFar: 20 });

  // Depth slider: ONE value k moves BOTH factors (stereo and look-around shrink together).
  // On a display rig 1 is what the display does naturally; below 1 only makes it shallower.
  depth.addEventListener('input', () => handle.setViewRig(rig(Number(depth.value))));

  // 2D/3D switch. The label follows what the display REPORTS (renderingmodechange).
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
  await handle.firstWoven;              // cover until the first woven frame
  cover.remove();                       // cut, never fade
}
