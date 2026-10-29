// Desk Aquarium — a three.js planted tank on a DisplayXR spatial display.
//
// Rig: the DEFAULT DISPLAY RIG via SceneViewer. The tank is a subject (an ornament you turn),
// not a world you move through, so the canvas is a portal and the runtime places the eyes.
// SceneViewer centres the tank on the zero-disparity plane (z = 0) and scales it into the
// virtual display; we never move a camera or set convergence ourselves.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeVertices, mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createInline3D } from '@displayxr/inline3d';
import { EyeCamera, EdgeFeather } from '@displayxr/inline3d/three';
import { SceneViewer } from '@displayxr/inline3d/viewer';

const canvas = document.getElementById('tank');
const cover = document.getElementById('cover');
const modeChip = document.getElementById('mode');

// Rule 4: the cover must always come off, whatever happens.
let coverDropped = false;
function dropCover() {
  if (coverDropped) return;
  coverDropped = true;
  cover.hidden = true;
}
setTimeout(dropCover, 6000);

// ---- tank dimensions (model units = metres; the viewer rescales to the virtual display) ----
const W = 0.50;          // inner width
const D = 0.26;          // inner depth
const H = 0.30;          // glass height (floor of the tank at y = 0)
const WATER_Y = 0.285;   // water surface
const GLASS_T = 0.005;

// Same value to SceneViewer (framing) and addScene (the rig). 0.24 m is the SDK default.
const VIRTUAL_DISPLAY_HEIGHT = 0.24;

// Gentle look-down, as you would see an ornament on a desk.
const REST_PITCH = 8;

const rand = (a, b) => a + Math.random() * (b - a);
let seed = 7;
const srand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

function sandHeight(x, z) {
  // Aquascape slope: higher at the back, with soft ripples.
  const back = 0.5 - z / D;                    // 0 at front, 1 at back
  return 0.035 + 0.03 * back * back
    + 0.004 * Math.sin(x * 31 + 0.7) * Math.cos(z * 27)
    + 0.0025 * Math.sin(x * 63 + z * 41 + 1.3);
}

async function main() {
  // ---- viewer -------------------------------------------------------------------------------
  const viewer = new SceneViewer(THREE, canvas, {
    virtualDisplayHeight: VIRTUAL_DISPLAY_HEIGHT,
    fit: 'contain',
    margin: 0.8,
    fitSweep: true,          // the tank still fits the tile when it is turned side-on
    orbit: true,
    idleSpin: 0,             // an ornament sits still; the fish provide the motion
    feather: 24,
    pitchLimit: [-8, 30],    // never roll under the tank or look straight down into it
  });
  viewer.useEyeCamera(EyeCamera, EdgeFeather);

  const renderer = viewer.renderer;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = viewer.scene;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  // Lights live in WORLD space (the room), so turning the tank turns it under a fixed lamp.
  scene.add(new THREE.HemisphereLight(0xd6f0ff, 0x40362a, 0.9));
  const key = new THREE.DirectionalLight(0xfff3e0, 2.4);
  key.position.set(0.06, 0.5, 0.14);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -0.25, right: 0.25, top: 0.25, bottom: -0.25, near: 0.05, far: 1.2 });
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.0015;
  key.shadow.radius = 3;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x9cc8ff, 0.5);
  fill.position.set(-0.4, 0.15, 0.5);
  scene.add(fill);

  const tank = new THREE.Group();
  viewer.content.add(tank);

  // Shared animation uniforms.
  const U = {
    uTime: { value: 0 },
    uTankInv: { value: new THREE.Matrix4() },
    uTankUp: { value: new THREE.Vector3(0, 1, 0) },
  };

  buildTank(tank);
  buildSand(tank, U);
  buildRocks(tank, U);
  buildPlants(tank, U);
  const bubbles = buildBubbles(tank);
  const water = buildWaterSurface(tank);
  const fish = buildFish(tank);
  const food = makeFood(tank);

  // ---- framing ------------------------------------------------------------------------------
  const fit = () => {
    tank.updateWorldMatrix(true, true);
    // Bounds in CONTENT space (model units), whatever the current fit scale or orbit pose.
    const box = new THREE.Box3();
    const inv = new THREE.Matrix4().copy(viewer.content.matrixWorld).invert();
    tank.traverse((o) => {
      if (!o.isMesh || o.userData.noBounds) return;
      o.geometry.computeBoundingBox();
      const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld).applyMatrix4(inv);
      box.union(b);
    });
    const c = box.getCenter(new THREE.Vector3());
    const s = box.getSize(new THREE.Vector3());
    viewer.fitTo(c, s);
  };
  fit();
  viewer.setPose({ pitch: REST_PITCH });
  if (typeof ResizeObserver === 'function') {
    let w = 0, h = 0;
    new ResizeObserver(() => {
      const r = canvas.getBoundingClientRect();
      if (Math.abs(r.width - w) < 1 && Math.abs(r.height - h) < 1) return;
      w = r.width; h = r.height;
      fit();
    }).observe(canvas);
  }

  // ---- per-frame update (runs once per frame, before both eyes draw) -------------------------
  let last = performance.now();
  const t0 = last;
  viewer.onTick = () => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    const t = (now - t0) / 1000;
    U.uTime.value = t;
    tank.updateWorldMatrix(true, false);
    U.uTankInv.value.copy(tank.matrixWorld).invert();
    U.uTankUp.value.set(0, 1, 0).transformDirection(tank.matrixWorld);
    water.update(t);
    bubbles.update(dt, t);
    food.update(dt, t);
    fish.update(dt, t, food);
  };

  // ---- UI -----------------------------------------------------------------------------------
  const feed = () => food.drop(9);
  document.getElementById('feed').addEventListener('click', feed);
  document.getElementById('reset').addEventListener('click', () => {
    viewer.resetPose();
    viewer.setPose({ pitch: REST_PITCH });
  });
  addEventListener('keydown', (e) => {
    if ((e.key === 'f' || e.key === 'F') && !e.repeat && !e.metaKey && !e.ctrlKey) feed();
  });

  // ---- 3D or 2D -----------------------------------------------------------------------------
  let wall = null;
  try {
    wall = await createInline3D({ lazy: false });
  } catch (err) {
    console.warn('[aquarium] inline-3d unavailable:', err);
  }
  if (wall && wall.supported) {
    const handle = wall.addScene(canvas, viewer.onFrame, {
      virtualDisplayHeight: VIRTUAL_DISPLAY_HEIGHT,
      onLayerLost: () => { viewer.onLayerLost(); setMode(false); dropCover(); },
    });
    setMode(true);
    handle.firstWoven.then((r) => {
      if (!r.woven) setMode(false);
      dropCover();
    });
  } else {
    viewer.startMono();
    setMode(false);
    requestAnimationFrame(() => requestAnimationFrame(dropCover));
  }
}

function setMode(is3D) {
  modeChip.textContent = is3D ? 'Glasses-free 3D' : '2D preview';
  modeChip.classList.toggle('on', is3D);
}

// =============================================================================================
// Caustics: a shader patch for MeshStandard/Physical materials. Pattern is in TANK space so it
// stays glued to the floor as the tank turns, and identical for both eyes.
// =============================================================================================
const CAUSTIC_GLSL = /* glsl */ `
  uniform float uTime;
  uniform vec3 uTankUp;
  varying vec3 vCLocal;
  float causticAt(vec2 uv, float time) {
    vec2 p = mod(uv * 6.28318, 6.28318) - 250.0;
    vec2 i = p;
    float c = 1.0;
    float inten = 0.005;
    for (int n = 0; n < 4; n++) {
      float t = time * (1.0 - (3.5 / float(n + 1)));
      i = p + vec2(cos(t - i.x) + sin(t + i.y), sin(t - i.y) + cos(t + i.x));
      c += 1.0 / length(vec2(p.x / (sin(i.x + t) / inten), p.y / (cos(i.y + t) / inten)));
    }
    c /= 4.0;
    c = 1.17 - pow(c, 1.4);
    return clamp(pow(abs(c), 8.0), 0.0, 1.0);
  }
`;

function addCaustics(material, U, strength = 0.35) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = U.uTime;
    shader.uniforms.uTankInv = U.uTankInv;
    shader.uniforms.uTankUp = U.uTankUp;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform mat4 uTankInv;\nvarying vec3 vCLocal;')
      .replace('#include <project_vertex>',
        '#include <project_vertex>\nvCLocal = (uTankInv * modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + CAUSTIC_GLSL)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec3 upV = normalize((viewMatrix * vec4(uTankUp, 0.0)).xyz);
          float facing = smoothstep(0.1, 0.8, dot(normal, upV));
          float depthFade = smoothstep(-0.02, 0.12, vCLocal.y) * 0.5 + 0.5;
          float c = causticAt(vCLocal.xz * 5.5, uTime * 0.55);
          totalEmissiveRadiance += diffuseColor.rgb * vec3(0.85, 1.0, 1.05) * c * facing * depthFade * ${strength.toFixed(3)};
        }`);
  };
  material.customProgramCacheKey = () => 'caustics' + strength;
  return material;
}

// =============================================================================================
// Tank: glass, trim, backdrop, stand, contact shadow
// =============================================================================================
function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function buildTank(tank) {
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xeafcff, transparent: true, opacity: 0.08, roughness: 0.04, metalness: 0,
    envMapIntensity: 0.9, depthWrite: false, side: THREE.DoubleSide,
  });
  const pane = (w, h, d, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), glass);
    m.position.set(x, y, z);
    m.renderOrder = 10;
    tank.add(m);
    return m;
  };
  const oW = W + GLASS_T * 2, oD = D + GLASS_T * 2;
  pane(oW, H, GLASS_T, 0, H / 2, D / 2 + GLASS_T / 2);      // front
  pane(GLASS_T, H, D, -W / 2 - GLASS_T / 2, H / 2, 0);       // left
  pane(GLASS_T, H, D, W / 2 + GLASS_T / 2, H / 2, 0);        // right

  // Glass edges read faintly green-cyan: thin translucent strips at the vertical corners.
  const edgeMat = new THREE.MeshStandardMaterial({
    color: 0x8fc9c4, transparent: true, opacity: 0.35, roughness: 0.2, depthWrite: false,
  });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.BoxGeometry(GLASS_T * 1.2, H, GLASS_T * 1.2), edgeMat);
    e.position.set(sx * (W / 2 + GLASS_T / 2), H / 2, sz * (D / 2 + GLASS_T / 2));
    e.renderOrder = 11;
    tank.add(e);
  }

  // Back panel with an aquarium backdrop: a deep teal gradient, dark grey-blue at the bottom
  // (never black: a bright fish over black is where crosstalk doubles first).
  const backdrop = canvasTexture(64, 256, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#3d8197');
    grd.addColorStop(0.55, '#245566');
    grd.addColorStop(1, '#183842');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  });
  const backMat = new THREE.MeshStandardMaterial({ map: backdrop, roughness: 0.9, envMapIntensity: 0.2,
    emissive: 0x0d2a33, emissiveIntensity: 0.6 });
  const back = new THREE.Mesh(new THREE.BoxGeometry(oW, H, GLASS_T), [
    new THREE.MeshStandardMaterial({ color: 0x2a3036, roughness: 0.8 }),
    new THREE.MeshStandardMaterial({ color: 0x2a3036, roughness: 0.8 }),
    new THREE.MeshStandardMaterial({ color: 0x2a3036, roughness: 0.8 }),
    new THREE.MeshStandardMaterial({ color: 0x2a3036, roughness: 0.8 }),
    backMat,                                                   // +z face: the inside
    new THREE.MeshStandardMaterial({ color: 0x2b3238, roughness: 0.7 }),
  ]);
  back.position.set(0, H / 2, -D / 2 - GLASS_T / 2);
  back.receiveShadow = true;
  tank.add(back);

  // Bottom plate and trims (dark grey, satin): they define the tank's outline crisply.
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x33383f, roughness: 0.45, metalness: 0.4 });
  const bottom = new THREE.Mesh(new THREE.BoxGeometry(oW + 0.006, 0.012, oD + 0.006), trimMat);
  bottom.position.y = -0.006;
  tank.add(bottom);
  const trimH = 0.008, trimT = 0.009;
  const rim = [
    [oW + 0.006, trimT, 0, oD / 2], [oW + 0.006, trimT, 0, -oD / 2],
  ];
  for (const [w, t, x, z] of rim) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, trimH, t), trimMat);
    m.position.set(x, H + trimH / 2 - 0.002, z);
    tank.add(m);
  }
  for (const sx of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(trimT, trimH, oD + 0.006), trimMat);
    m.position.set(sx * oW / 2, H + trimH / 2 - 0.002, 0);
    tank.add(m);
  }

  // Wooden stand.
  const wood = canvasTexture(512, 64, (g, w, h) => {
    g.fillStyle = '#6e4a30'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) {
      g.strokeStyle = `rgba(${40 + srand() * 30},${22 + srand() * 15},${10},${0.15 + srand() * 0.25})`;
      g.lineWidth = 0.5 + srand() * 1.5;
      g.beginPath();
      const y = srand() * h;
      g.moveTo(0, y);
      for (let x = 0; x <= w; x += 32) g.lineTo(x, y + Math.sin(x * 0.02 + i) * 2.5);
      g.stroke();
    }
  });
  const stand = new THREE.Mesh(
    new THREE.BoxGeometry(oW + 0.035, 0.024, oD + 0.035),
    new THREE.MeshStandardMaterial({ map: wood, roughness: 0.55, envMapIntensity: 0.4 }),
  );
  stand.position.y = -0.012 - 0.012;
  stand.receiveShadow = true;
  stand.castShadow = true;
  tank.add(stand);

  // Soft contact shadow on the desk (fades into the transparent canvas, no hard rectangle).
  const shadowTex = canvasTexture(128, 128, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 8, w / 2, h / 2, w / 2);
    grd.addColorStop(0, 'rgba(0,0,0,0.55)');
    grd.addColorStop(0.6, 'rgba(0,0,0,0.25)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  });
  const contact = new THREE.Mesh(
    new THREE.PlaneGeometry(oW + 0.14, oD + 0.12),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, color: 0x0d0f12 }),
  );
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = -0.0365;
  contact.userData.noBounds = true;
  tank.add(contact);
}

// =============================================================================================
// Sand
// =============================================================================================
function buildSand(tank, U) {
  const sandTex = canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#cdb68c'; g.fillRect(0, 0, w, h);
    const img = g.getImageData(0, 0, w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (srand() - 0.5) * 38;
      img.data[i] += n; img.data[i + 1] += n * 0.95; img.data[i + 2] += n * 0.8;
    }
    g.putImageData(img, 0, 0);
    for (let i = 0; i < 260; i++) {           // a few darker / lighter grains
      g.fillStyle = srand() < 0.5 ? 'rgba(120,96,64,0.55)' : 'rgba(245,235,210,0.6)';
      g.fillRect(srand() * w, srand() * h, 1 + srand() * 1.5, 1 + srand() * 1.5);
    }
  });
  sandTex.wrapS = sandTex.wrapT = THREE.RepeatWrapping;
  sandTex.repeat.set(3, 1.6);
  const mat = addCaustics(new THREE.MeshStandardMaterial({ map: sandTex, roughness: 0.95, envMapIntensity: 0.3 }), U, 0.45);

  const geo = new THREE.PlaneGeometry(W, D, 80, 40);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, sandHeight(p.getX(i), p.getZ(i)));
  geo.computeVertexNormals();
  const sand = new THREE.Mesh(geo, mat);
  sand.receiveShadow = true;
  tank.add(sand);

  // Skirts: the sand's cross-section seen through the front and side glass.
  const skirtMat = new THREE.MeshStandardMaterial({ map: sandTex, color: 0xc9b38a, roughness: 1, envMapIntensity: 0.2 });
  const edges = [
    { from: [-W / 2, D / 2], to: [W / 2, D / 2] },
    { from: [W / 2, -D / 2], to: [-W / 2, -D / 2] },
    { from: [-W / 2, -D / 2], to: [-W / 2, D / 2] },
    { from: [W / 2, D / 2], to: [W / 2, -D / 2] },
  ];
  for (const { from, to } of edges) {
    const n = 60, pos = [], uv = [], idx = [];
    for (let i = 0; i <= n; i++) {
      const s = i / n;
      const x = from[0] + (to[0] - from[0]) * s, z = from[1] + (to[1] - from[1]) * s;
      pos.push(x, sandHeight(x, z), z, x, 0, z);
      uv.push(s * 3, sandHeight(x, z) * 10, s * 3, 0);
      if (i < n) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, skirtMat);
    m.material.side = THREE.DoubleSide;
    tank.add(m);
  }
}

// =============================================================================================
// Rocks
// =============================================================================================
function rockGeometry(r, squash, s) {
  let g = new THREE.IcosahedronGeometry(r, 4);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    const n = 1
      + 0.18 * Math.sin(v.x * 3.1 + s) * Math.cos(v.y * 2.7 + s * 1.7)
      + 0.10 * Math.sin(v.z * 5.3 + s * 2.3 + v.x * 2.0)
      + 0.04 * Math.sin(v.x * 11 + v.y * 9 + s);
    // Facet-like flattening gives a stone rather than a blob.
    v.multiplyScalar(r * n);
    p.setXYZ(i, v.x, v.y * squash, v.z);
  }
  g.computeVertexNormals();
  return g;
}

function buildRocks(tank, U) {
  const rocks = [
    { x: -0.15, z: -0.06, r: 0.055, sq: 0.85, c: 0x7c7a74, ry: 0.3 },
    { x: -0.085, z: -0.085, r: 0.032, sq: 0.9, c: 0x8b857a, ry: 1.2 },
    { x: 0.11, z: 0.02, r: 0.04, sq: 0.62, c: 0x6f7378, ry: 2.0 },
    { x: 0.165, z: -0.075, r: 0.03, sq: 0.8, c: 0x86817a, ry: 0.8 },
    { x: -0.03, z: 0.07, r: 0.016, sq: 0.7, c: 0x938c80, ry: 0.1 },
    { x: 0.03, z: 0.085, r: 0.011, sq: 0.7, c: 0x7d7b78, ry: 2.4 },
  ];
  rocks.forEach((k, i) => {
    const mat = addCaustics(new THREE.MeshStandardMaterial({ color: k.c, roughness: 0.88, envMapIntensity: 0.35 }), U, 0.3);
    const m = new THREE.Mesh(rockGeometry(k.r, k.sq, i * 3.7 + 1), mat);
    m.position.set(k.x, sandHeight(k.x, k.z) + k.r * k.sq * 0.45, k.z);
    m.rotation.y = k.ry;
    m.castShadow = m.receiveShadow = true;
    tank.add(m);
  });
}

// =============================================================================================
// Plants: tapered blades merged per clump, swayed in the vertex shader.
// =============================================================================================
function bladeGeometry({ height, width, bend, segs = 12, yaw, tilt, x, z, phase }) {
  const g = new THREE.PlaneGeometry(1, 1, 1, segs);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const v = p.getY(i) + 0.5;                       // 0 base → 1 tip
    const taper = Math.pow(Math.sin(Math.PI * Math.min(1, 0.15 + v * 0.95)), 0.55) * (1 - 0.35 * v);
    const px = p.getX(i) * width * taper;
    const py = v * height;
    const pz = bend * v * v * height;
    p.setXYZ(i, px, py, pz);
  }
  g.rotateX(-tilt);
  g.rotateY(yaw);
  g.translate(x, 0, z);
  const n = p.count;
  g.setAttribute('aPhase', new THREE.Float32BufferAttribute(new Float32Array(n).fill(phase), 1));
  g.setAttribute('aHeight', new THREE.Float32BufferAttribute(new Float32Array(n).fill(height), 1));
  return g;
}

function swayMaterial(color, U, amp) {
  const m = new THREE.MeshStandardMaterial({
    color, roughness: 0.6, side: THREE.DoubleSide, envMapIntensity: 0.3,
  });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = U.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute float aPhase;\nattribute float aHeight;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          float h = clamp(position.y / aHeight, 0.0, 1.0);
          float k = h * h;
          float sx = sin(uTime * 0.9 + aPhase + h * 2.2) * 0.6 + sin(uTime * 1.9 + aPhase * 1.7) * 0.22;
          float sz = cos(uTime * 0.7 + aPhase * 1.3 + h * 1.8) * 0.45;
          transformed.x += sx * ${amp.toFixed(3)} * aHeight * k;
          transformed.z += sz * ${amp.toFixed(3)} * aHeight * k;
        }`);
  };
  m.customProgramCacheKey = () => 'sway' + amp;
  return m;
}

function buildPlants(tank, U) {
  const clumps = [
    // Tall vallisneria along the back.
    { x: -0.2, z: -0.09, n: 16, h: [0.17, 0.24], w: [0.006, 0.009], color: 0x4f9a3e, spread: 0.035, bend: 0.12, amp: 0.22 },
    { x: 0.05, z: -0.1, n: 14, h: [0.15, 0.22], w: [0.006, 0.008], color: 0x5aa548, spread: 0.04, bend: 0.12, amp: 0.22 },
    { x: 0.2, z: -0.06, n: 12, h: [0.12, 0.19], w: [0.007, 0.01], color: 0x478f3a, spread: 0.03, bend: 0.14, amp: 0.2 },
    // Broad-leaf sword plant mid-left.
    { x: -0.06, z: -0.03, n: 9, h: [0.07, 0.11], w: [0.018, 0.026], color: 0x3f8a3a, spread: 0.012, bend: 0.35, amp: 0.1, tilt: [0.25, 0.6] },
    // Reddish ludwigia right-front.
    { x: 0.165, z: 0.05, n: 10, h: [0.05, 0.08], w: [0.008, 0.012], color: 0xa8483a, spread: 0.02, bend: 0.25, amp: 0.15 },
    // Low tufts at the front.
    { x: -0.14, z: 0.075, n: 14, h: [0.02, 0.035], w: [0.004, 0.006], color: 0x6cb04f, spread: 0.025, bend: 0.3, amp: 0.12, tilt: [0.1, 0.5] },
    { x: 0.07, z: 0.06, n: 10, h: [0.018, 0.03], w: [0.004, 0.006], color: 0x62a84a, spread: 0.02, bend: 0.3, amp: 0.12, tilt: [0.1, 0.5] },
  ];
  for (const c of clumps) {
    const geos = [];
    for (let i = 0; i < c.n; i++) {
      const a = srand() * Math.PI * 2, r = Math.sqrt(srand()) * c.spread;
      const bx = Math.cos(a) * r, bz = Math.sin(a) * r * 0.7;
      const tilt = c.tilt ? c.tilt[0] + srand() * (c.tilt[1] - c.tilt[0]) : 0.05 + srand() * 0.15;
      geos.push(bladeGeometry({
        height: c.h[0] + srand() * (c.h[1] - c.h[0]),
        width: c.w[0] + srand() * (c.w[1] - c.w[0]),
        bend: c.bend * (0.5 + srand()),
        yaw: c.tilt ? a + Math.PI / 2 : srand() * Math.PI * 2,
        tilt, x: bx, z: bz, phase: srand() * 6.28,
      }));
    }
    const merged = mergeGeometries(geos);
    merged.computeVertexNormals();
    const col = new THREE.Color(c.color);
    const plant = new THREE.Mesh(merged, swayMaterial(col, U, c.amp));
    plant.position.set(c.x, sandHeight(c.x, c.z) - 0.004, c.z);
    plant.receiveShadow = true;
    tank.add(plant);
  }
}

// =============================================================================================
// Water surface and bubbles
// =============================================================================================
function buildWaterSurface(tank) {
  const geo = new THREE.PlaneGeometry(W, D, 40, 20);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  const base = Float32Array.from(p.array);
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xa8e2ee, transparent: true, opacity: 0.3, roughness: 0.08, metalness: 0,
    envMapIntensity: 0.9, side: THREE.DoubleSide, depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = WATER_Y;
  mesh.renderOrder = 5;
  tank.add(mesh);

  // A faint water tint just inside the front glass makes the volume read as water.
  const tint = new THREE.Mesh(
    new THREE.PlaneGeometry(W, WATER_Y),
    new THREE.MeshBasicMaterial({ color: 0x5fb3c4, transparent: true, opacity: 0.06, depthWrite: false }),
  );
  tint.position.set(0, WATER_Y / 2, D / 2 - 0.001);
  tint.renderOrder = 6;
  tint.userData.noBounds = true;
  tank.add(tint);

  let frame = 0;
  return {
    update(t) {
      if ((frame++ & 1) === 1) return;   // 30 Hz is plenty for slow ripples
      for (let i = 0; i < p.count; i++) {
        const x = base[i * 3], z = base[i * 3 + 2];
        const y = 0.0012 * Math.sin(x * 38 + t * 1.6) + 0.0009 * Math.sin(z * 47 - t * 1.3 + x * 12)
          + 0.0005 * Math.sin((x + z) * 90 + t * 2.7);
        p.setY(i, y);
      }
      p.needsUpdate = true;
      geo.computeVertexNormals();
    },
  };
}

function buildBubbles(tank) {
  const stoneX = W / 2 - 0.055, stoneZ = -D / 2 + 0.04;
  const stoneY = sandHeight(stoneX, stoneZ);
  const stone = new THREE.Mesh(
    new THREE.CylinderGeometry(0.009, 0.01, 0.008, 20),
    new THREE.MeshStandardMaterial({ color: 0x8a8f94, roughness: 0.95 }),
  );
  stone.position.set(stoneX, stoneY + 0.002, stoneZ);
  stone.castShadow = true;
  tank.add(stone);
  // Clear airline tubing up the back corner.
  const tube = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0022, 0.0022, H - stoneY + 0.01, 10),
    new THREE.MeshStandardMaterial({ color: 0xcfe6e4, transparent: true, opacity: 0.45, roughness: 0.2, depthWrite: false }),
  );
  tube.position.set(stoneX + 0.012, (H + stoneY) / 2 + 0.004, stoneZ - 0.012);
  tube.renderOrder = 4;
  tank.add(tube);

  const N = 36;
  const mesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(1, 12, 8),
    new THREE.MeshPhysicalMaterial({ color: 0xe8fbff, transparent: true, opacity: 0.5, roughness: 0.05,
      envMapIntensity: 1.4, depthWrite: false }),
    N,
  );
  mesh.renderOrder = 7;
  mesh.frustumCulled = false;
  mesh.userData.noBounds = true;
  tank.add(mesh);
  const bs = [];
  const span = WATER_Y - stoneY;
  for (let i = 0; i < N; i++) bs.push({ y: stoneY + (i / N) * span, s: rand(0.0013, 0.0028), v: rand(0.055, 0.085), ph: rand(0, 6.28) });
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
  return {
    update(dt, t) {
      for (let i = 0; i < N; i++) {
        const b = bs[i];
        b.y += b.v * dt;
        if (b.y > WATER_Y - b.s) { b.y = stoneY + 0.006; b.s = rand(0.0013, 0.0028); b.ph = rand(0, 6.28); }
        const rise = (b.y - stoneY) / span;
        ps.set(stoneX + Math.sin(t * 5 + b.ph) * 0.003 * rise, b.y, stoneZ + Math.cos(t * 4 + b.ph) * 0.003 * rise);
        const s = b.s * (1 + rise * 0.4);
        sc.set(s, s * 0.85, s);
        m.compose(ps, q, sc);
        mesh.setMatrixAt(i, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

// =============================================================================================
// Fish
// =============================================================================================
const SPECIES = [
  { name: 'clownfish', L: 0.055, hR: 1.05, wR: 0.5, speed: 0.045, tex: 'clown', fin: 0xf07a1e, finEdge: true, tail: 'round' },
  { name: 'blue tang', L: 0.068, hR: 1.35, wR: 0.38, speed: 0.05, tex: 'tang', fin: 0x1d47b8, tailColor: 0xf3c623, tail: 'fork' },
  { name: 'yellow tang', L: 0.058, hR: 1.55, wR: 0.34, speed: 0.04, tex: 'yellow', fin: 0xf5d23a, tail: 'fork', dorsal: 1.2 },
  { name: 'cardinal', L: 0.038, hR: 0.85, wR: 0.5, speed: 0.06, tex: 'cardinal', fin: 0xd9e6ea, tail: 'fork', finOpacity: 0.5 },
  { name: 'angelfish', L: 0.06, hR: 1.7, wR: 0.3, speed: 0.032, tex: 'angel', fin: 0xd8dde0, tail: 'angel', dorsal: 2.2, anal: 2.0, finOpacity: 0.75 },
];

function fishTexture(kind) {
  // u (x) runs around the body: 0 belly, 0.5 back, 1 belly. v (y, flipped) runs tail → nose.
  return canvasTexture(256, 256, (g, w, h) => {
    const band = (v0, v1, color) => { g.fillStyle = color; g.fillRect(0, h * (1 - v1), w, h * (v1 - v0)); };
    const sideShade = (belly, back) => {
      const grd = g.createLinearGradient(0, 0, w, 0);
      grd.addColorStop(0, belly); grd.addColorStop(0.5, back); grd.addColorStop(1, belly);
      g.fillStyle = grd; g.fillRect(0, 0, w, h);
    };
    switch (kind) {
      case 'clown':
        sideShade('#ff9a3c', '#f06a12');
        for (const [a, b] of [[0.73, 0.83], [0.43, 0.55], [0.1, 0.17]]) {
          band(a - 0.018, b + 0.018, '#2a2420');
          band(a, b, '#fbf6ef');
        }
        break;
      case 'tang':
        sideShade('#3d7be6', '#1d4fc4');
        g.fillStyle = '#1a1d2b';
        g.beginPath();                                  // the "palette" marking on each flank
        for (const cx of [0.36, 0.64]) {
          g.ellipse(w * cx, h * 0.48, w * 0.1, h * 0.3, 0, 0, Math.PI * 2);
        }
        g.fill();
        g.fillStyle = '#3d7be6';
        for (const cx of [0.3, 0.7]) { g.beginPath(); g.ellipse(w * cx, h * 0.48, w * 0.05, h * 0.16, 0, 0, Math.PI * 2); g.fill(); }
        band(0, 0.08, '#f3c623');
        break;
      case 'yellow':
        sideShade('#ffe466', '#f2c81e');
        band(0.04, 0.09, '#fff7d6');
        break;
      case 'cardinal': {
        // Red belly, iridescent cyan lateral stripe, olive back.
        const grd = g.createLinearGradient(0, 0, w, 0);
        const stops = [[0, '#e0263a'], [0.17, '#e0263a'], [0.21, '#3fe6ff'], [0.29, '#2fc2f0'], [0.33, '#3c4a3e'],
          [0.5, '#2f3a33'], [0.67, '#3c4a3e'], [0.71, '#2fc2f0'], [0.79, '#3fe6ff'], [0.83, '#e0263a'], [1, '#e0263a']];
        for (const [o, c] of stops) grd.addColorStop(o, c);
        g.fillStyle = grd; g.fillRect(0, 0, w, h);
        // The red only reaches the back half of the belly.
        const fade = g.createLinearGradient(0, h, 0, 0);
        fade.addColorStop(0.55, 'rgba(230,236,238,0)'); fade.addColorStop(0.7, 'rgba(230,236,238,1)');
        g.globalCompositeOperation = 'source-atop';
        g.fillStyle = fade;
        g.fillRect(0, 0, w * 0.17, h); g.fillRect(w * 0.83, 0, w * 0.17, h);
        g.globalCompositeOperation = 'source-over';
        break;
      }
      case 'angel':
        sideShade('#eef0ee', '#c9ccc8');
        for (const [a, b] of [[0.72, 0.77], [0.47, 0.54], [0.2, 0.25]]) band(a, b, '#3a3d40');
        break;
    }
  });
}

function makeFinShape(points) {
  const s = new THREE.Shape();
  s.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i += 2) {
    if (i + 1 < points.length) s.quadraticCurveTo(points[i][0], points[i][1], points[i + 1][0], points[i + 1][1]);
    else s.lineTo(points[i][0], points[i][1]);
  }
  s.closePath();
  const g = new THREE.ShapeGeometry(s, 10);
  g.rotateY(Math.PI / 2);   // shape +x → fish −z (backwards); shape y stays up
  return g;
}

function createFish(sp) {
  const L = sp.L, R = L * 0.17;
  const prof = [[0, 0], [0.09, 0.0], [0.14, 0.02], [0.18, 0.1], [0.5, 0.26], [0.85, 0.45], [1.0, 0.6],
    [0.93, 0.74], [0.68, 0.87], [0.36, 0.96], [0.12, 0.995], [0, 1]];
  const pts = prof.map(([r, t]) => new THREE.Vector2(Math.max(r * R, 1e-5), (t - 0.5) * L));
  const body = new THREE.LatheGeometry(pts, 36);
  body.rotateX(Math.PI / 2);                 // lathe axis Y → fish forward (+z)
  body.scale(sp.wR, sp.hR, 1);               // applyMatrix4 carries the normals through

  const root = new THREE.Group();
  const wiggle = new THREE.Group();
  root.add(wiggle);

  const bodyMat = new THREE.MeshPhysicalMaterial({
    map: fishTexture(sp.tex), roughness: 0.35, metalness: 0.05, clearcoat: 0.6, clearcoatRoughness: 0.3,
    envMapIntensity: 0.6,
  });
  const bodyMesh = new THREE.Mesh(body, bodyMat);
  bodyMesh.castShadow = true;
  wiggle.add(bodyMesh);

  const finMat = (color, opacity = sp.finOpacity ?? 0.88) => new THREE.MeshStandardMaterial({
    color, side: THREE.DoubleSide, transparent: opacity < 1, opacity, roughness: 0.5, depthWrite: opacity >= 0.85,
  });
  const fMat = finMat(sp.fin);

  // Tail on its own pivot at the peduncle.
  const tailPivot = new THREE.Group();
  tailPivot.position.z = -L * 0.47;
  wiggle.add(tailPivot);
  const tl = L * 0.32, th = R * sp.hR * (sp.tail === 'angel' ? 1.5 : 1.1);
  let tailPts;
  if (sp.tail === 'fork') tailPts = [[0, 0.12 * th], [tl * 0.6, th * 0.6], [tl * 1.05, th * 1.1], [tl * 0.7, 0], [tl * 1.05, -th * 1.1], [tl * 0.6, -th * 0.6], [0, -0.12 * th]];
  else if (sp.tail === 'angel') tailPts = [[0, 0.15 * th], [tl * 0.7, th * 0.9], [tl * 1.1, th * 1.2], [tl * 0.95, 0], [tl * 1.1, -th * 1.2], [tl * 0.7, -th * 0.9], [0, -0.15 * th]];
  else tailPts = [[0, 0.15 * th], [tl * 0.6, th * 0.95], [tl * 0.95, th * 0.55], [tl * 1.1, 0], [tl * 0.95, -th * 0.55], [tl * 0.6, -th * 0.95], [0, -0.15 * th]];
  const tail = new THREE.Mesh(makeFinShape(tailPts), sp.tailColor ? finMat(sp.tailColor, 0.95) : fMat);
  tail.castShadow = true;
  tailPivot.add(tail);

  // Dorsal fin along the back.
  const dh = R * sp.hR * 0.55 * (sp.dorsal ?? 1);
  const top = R * sp.hR * 0.9;
  const dorsal = new THREE.Mesh(makeFinShape([
    [-L * 0.12, 0], [-L * 0.05, dh * 0.9], [L * 0.12, dh], [L * 0.3, dh * 0.4], [L * 0.32, 0],
  ]), fMat);
  dorsal.position.set(0, top, 0);
  wiggle.add(dorsal);
  if (sp.anal) {
    const ah = R * sp.hR * 0.55 * sp.anal;
    const anal = new THREE.Mesh(makeFinShape([
      [-L * 0.02, 0], [L * 0.05, -ah * 0.9], [L * 0.2, -ah], [L * 0.3, -ah * 0.4], [L * 0.3, 0],
    ]), fMat);
    anal.position.set(0, -top * 0.9, 0);
    wiggle.add(anal);
  }
  // Pectoral fins.
  const pecs = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * R * sp.wR * 0.85, -R * sp.hR * 0.2, L * 0.12);
    const pec = new THREE.Mesh(makeFinShape([[0, R * 0.25], [L * 0.1, R * 0.4], [L * 0.16, 0], [L * 0.1, -R * 0.35], [0, -R * 0.2]]), fMat);
    pec.rotation.y = -side * 0.5;            // swing the fin out from the flank
    pivot.add(pec);
    wiggle.add(pivot);
    pecs.push({ pivot, side });
  }
  // Eyes: a gold ring and a dark (not black) pupil.
  const eyeR = L * 0.055;
  const ringGeo = new THREE.SphereGeometry(eyeR, 16, 12);
  const pupGeo = new THREE.SphereGeometry(eyeR * 0.62, 14, 10);
  const ringMat = new THREE.MeshStandardMaterial({ color: sp.tex === 'cardinal' ? 0x9fdfff : 0xd8b35a, roughness: 0.3 });
  const pupMat = new THREE.MeshPhysicalMaterial({ color: 0x16181b, roughness: 0.1, clearcoat: 1 });
  for (const side of [-1, 1]) {
    const ex = side * R * sp.wR * 0.62, ey = R * sp.hR * 0.22, ez = L * 0.3;
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.set(ex, ey, ez);
    ring.scale.set(0.6, 1, 1);
    const pupil = new THREE.Mesh(pupGeo, pupMat);
    pupil.position.set(ex + side * eyeR * 0.38, ey, ez + eyeR * 0.1);
    wiggle.add(ring, pupil);
  }
  return { root, wiggle, tailPivot, pecs };
}

function buildFish(tank) {
  const B = {
    minX: -W / 2 + 0.05, maxX: W / 2 - 0.05,
    minY: 0.125, maxY: WATER_Y - 0.03,
    minZ: -D / 2 + 0.045, maxZ: D / 2 - 0.045,
  };
  const randomTarget = (f) => new THREE.Vector3(
    rand(B.minX, B.maxX),
    THREE.MathUtils.clamp(f.pos.y + rand(-0.06, 0.06), B.minY, B.maxY),
    rand(B.minZ, B.maxZ),
  );
  const fish = SPECIES.map((sp, i) => {
    const parts = createFish(sp);
    const pos = new THREE.Vector3(rand(B.minX, B.maxX), rand(B.minY + 0.02, B.maxY - 0.02), rand(B.minZ, B.maxZ));
    const f = {
      sp, ...parts, pos,
      vel: new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1)).setLength(sp.speed * 0.5),
      phase: rand(0, 6.28), speedPh: rand(0, 6.28), timer: 0, roll: 0, heading: 0,
      quat: new THREE.Quaternion(),
    };
    f.target = randomTarget(f);
    parts.root.position.copy(pos);
    tank.add(parts.root);
    return f;
  });

  const desired = new THREE.Vector3(), tmp = new THREE.Vector3(), mtx = new THREE.Matrix4();
  const UP = new THREE.Vector3(0, 1, 0), ZERO = new THREE.Vector3();
  const qTarget = new THREE.Quaternion(), qRoll = new THREE.Quaternion(), Z = new THREE.Vector3(0, 0, 1);

  return {
    update(dt, t, food) {
      if (dt <= 0) return;
      for (const f of fish) {
        const sp = f.sp;
        // Food first: go for the nearest flake.
        let chasing = false;
        const flake = food.nearest(f.pos);
        if (flake) {
          f.target.copy(flake.pos);
          chasing = true;
          if (f.pos.distanceTo(flake.pos) < sp.L * 0.45) food.eat(flake);
        } else {
          f.timer -= dt;
          if (f.pos.distanceTo(f.target) < 0.035 || f.timer <= 0) {
            f.target = randomTarget(f);
            f.timer = rand(5, 11);
          }
        }
        const cruise = sp.speed * (0.75 + 0.3 * Math.sin(t * 0.4 + f.speedPh)) * (chasing ? 1.7 : 1);
        desired.subVectors(f.target, f.pos);
        const dist = desired.length();
        desired.setLength(cruise * Math.min(1, dist / 0.03 + 0.35));
        // Keep apart.
        for (const o of fish) {
          if (o === f) continue;
          tmp.subVectors(f.pos, o.pos);
          const d = tmp.length();
          const r = (sp.L + o.sp.L) * 0.9;
          if (d < r && d > 1e-5) desired.addScaledVector(tmp.divideScalar(d), cruise * 1.4 * (1 - d / r));
        }
        // Soft walls.
        const wall = (v, lo, hi) => (v < lo ? (lo - v) : v > hi ? (hi - v) : 0) * 4;
        desired.x += wall(f.pos.x, B.minX, B.maxX);
        desired.y += wall(f.pos.y, B.minY, B.maxY);
        desired.z += wall(f.pos.z, B.minZ, B.maxZ);
        desired.y = THREE.MathUtils.clamp(desired.y, -0.35 * cruise, 0.35 * cruise);

        f.vel.lerp(desired, Math.min(1, dt * (chasing ? 2.2 : 1.3)));
        f.pos.addScaledVector(f.vel, dt);
        f.pos.x = THREE.MathUtils.clamp(f.pos.x, B.minX - 0.02, B.maxX + 0.02);
        f.pos.y = THREE.MathUtils.clamp(f.pos.y, B.minY - 0.03, B.maxY + 0.015);
        f.pos.z = THREE.MathUtils.clamp(f.pos.z, B.minZ - 0.02, B.maxZ + 0.02);
        f.root.position.copy(f.pos);

        // Orientation: face the velocity, bank into turns.
        const sp2 = f.vel.length();
        if (sp2 > 1e-4) {
          tmp.copy(f.vel).divideScalar(sp2);
          const heading = Math.atan2(tmp.x, tmp.z);
          let dh = heading - f.heading;
          dh = Math.atan2(Math.sin(dh), Math.cos(dh));
          f.heading = heading;
          const turnRate = dh / dt;
          f.roll += (THREE.MathUtils.clamp(-turnRate * 0.12, -0.45, 0.45) - f.roll) * Math.min(1, dt * 3);
          mtx.lookAt(tmp, ZERO, UP);
          qTarget.setFromRotationMatrix(mtx);
          qRoll.setFromAxisAngle(Z, f.roll);
          qTarget.multiply(qRoll);
          f.quat.slerp(qTarget, Math.min(1, dt * 5));
          f.root.quaternion.copy(f.quat);
        }
        // Swimming motion.
        const effort = sp2 / (sp.L * 1.2);
        f.phase += dt * (6 + 7 * effort);
        const amp = 0.28 + 0.25 * Math.min(1, effort);
        f.tailPivot.rotation.y = Math.sin(f.phase) * amp;
        f.wiggle.rotation.y = Math.sin(f.phase - 1.2) * amp * 0.16;
        for (const p of f.pecs) p.pivot.rotation.y = -p.side * (0.15 + 0.3 * (0.5 + 0.5 * Math.sin(f.phase * 0.6 + p.side)));
      }
    },
  };
}

// =============================================================================================
// Food flakes
// =============================================================================================
function makeFood(tank) {
  const geo = new THREE.BoxGeometry(0.0045, 0.0008, 0.0035);
  const mats = [0xc0612b, 0x8f6a2a, 0xd28a3a].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 }));
  const flakes = [];
  return {
    drop(n) {
      const cx = rand(-W / 2 + 0.08, W / 2 - 0.08), cz = rand(-D / 2 + 0.06, D / 2 - 0.06);
      for (let i = 0; i < n; i++) {
        if (flakes.length > 40) break;
        const m = new THREE.Mesh(geo, mats[i % 3]);
        m.userData.noBounds = true;
        m.castShadow = true;
        const f = {
          mesh: m,
          pos: new THREE.Vector3(cx + rand(-0.03, 0.03), WATER_Y - 0.002, cz + rand(-0.025, 0.025)),
          vy: rand(0.008, 0.016), ph: rand(0, 6.28), floatT: rand(0.6, 2.2), rest: 0, dead: false,
        };
        m.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
        m.position.copy(f.pos);
        tank.add(m);
        flakes.push(f);
      }
    },
    nearest(p) {
      let best = null, bd = Infinity;
      for (const f of flakes) {
        if (f.dead) continue;
        const d = f.pos.distanceToSquared(p);
        if (d < bd) { bd = d; best = f; }
      }
      return best;
    },
    eat(f) { f.dead = true; },
    update(dt, t) {
      for (let i = flakes.length - 1; i >= 0; i--) {
        const f = flakes[i];
        const floor = sandHeight(f.pos.x, f.pos.z) + 0.001;
        if (!f.dead) {
          if (f.floatT > 0) {
            f.floatT -= dt;
            f.pos.y = WATER_Y - 0.002 + 0.0008 * Math.sin(t * 3 + f.ph);
          } else if (f.pos.y > floor) {
            f.pos.y = Math.max(floor, f.pos.y - f.vy * dt);
            f.pos.x += Math.sin(t * 1.3 + f.ph) * 0.006 * dt;
            f.pos.z += Math.cos(t * 1.1 + f.ph) * 0.004 * dt;
            f.mesh.rotation.x += dt * 1.2; f.mesh.rotation.z += dt * 0.8;
          } else if ((f.rest += dt) > 25) f.dead = true;
          f.mesh.position.copy(f.pos);
        }
        if (f.dead) { tank.remove(f.mesh); flakes.splice(i, 1); }
      }
    },
  };
}

main().catch((err) => {
  console.error('[aquarium] setup failed:', err);
  modeChip.textContent = 'Could not start';
  dropCover();
});
