// A first-person walk-through of a small furnished room, for a glasses-free 3D display.
//
// Rig: a CAMERA rig (the user is somewhere and moves through a world), sent with the attach
// pattern — an identity-posed rig, and the two eye cameras parented under the app camera — so
// the stereo never trails the mouse by a frame. The scene is authored in metres, so the rig's
// absolute 63 mm baseline is a real interaxial and no scale correction is needed.
// Convergence is FIXED (see CONVERGENCE). In a normal browser the same scene renders flat from
// the app camera.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const canvas = document.getElementById('stage');
const coverEl = document.getElementById('cover');
const statusEl = document.getElementById('status');
const hintEl = document.getElementById('hint');
const helpEl = document.getElementById('help');

// ---- depth settings ------------------------------------------------------------------------
// Zero-disparity distance in metres. Fixed for the whole visit (never follows the gaze): the
// table, chairs and the middle of the room — what you look at from a few steps away — sit on
// the glass; the far walls and the view out of the window recede; anything you walk up to
// comes out a little. Comfort = ipd(1) × m2v(1) × (1/1.6 D) × 0.5 ≈ 0.31, well under 1.
const CONVERGENCE = 1.6;
const FOV = 55;            // vertical, degrees. Narrower than a typical FPS → more depth per metre.
const NEAR = 0.05, FAR = 120;
const EYE_HEIGHT = 1.6;
// How close the viewer may get to a wall or a piece of furniture. Also caps how far anything
// can pop out of the glass (a wall at 0.45 m with convergence 1.6 m).
const BODY_RADIUS = 0.45;
// Woven: total SBS buffer width as a multiple of the CSS width × dpr. 1 = each eye gets half
// the box's width in pixels (what a lenticular panel resolves per view anyway, and keeps a
// full-window buffer no wider than the panel). ?scale=2 gives each eye the full width.
const SBS_SCALE = Math.min(2, Math.max(1, parseFloat(new URLSearchParams(location.search).get('scale')) || 1));
const BG = 0x2b2825;       // dark warm grey, never pure black (crosstalk doubles bright-on-black first)

// ---- renderer ------------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);           // getViewport() is already backing-store px
renderer.autoClear = false;          // one clear per frame, then one draw per eye
renderer.xr.enabled = false;         // inline-3d never goes through three's XR manager
renderer.setClearColor(BG, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// The room is static: render the shadow map ONCE. Left on auto it would re-render per
// renderer.render() call, i.e. twice a frame on the stereo path.
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xb9c9d6);
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.35;
  pmrem.dispose();
}

// The app camera — IN the scene, because the eye cameras hang off it (attach pattern) and
// three only reaches a parented camera through a scene traversal.
const appCam = new THREE.PerspectiveCamera(FOV, 16 / 9, NEAR, FAR);
appCam.rotation.order = 'YXZ';
scene.add(appCam);

// ---- procedural textures (fine, moderate-contrast detail gives the eyes something to fuse) --
const maxAniso = renderer.capabilities.getMaxAnisotropy();
function canvasTexture(w, h, draw, { repeat = [1, 1], srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = maxAniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// Deterministic noise so both eyes (and every reload) see the same room.
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

const floorTex = canvasTexture(1024, 1024, (g, w, h) => {
  const rows = 8, plankH = h / rows;
  for (let r = 0; r < rows; r++) {
    let x = -rand() * w * 0.5;
    while (x < w) {
      const len = w * (0.35 + rand() * 0.4);
      const l = 46 + rand() * 9, s = 38 + rand() * 12, hue = 28 + rand() * 6;
      g.fillStyle = `hsl(${hue} ${s}% ${l}%)`;
      g.fillRect(x, r * plankH, len, plankH);
      // grain: faint streaks along the plank
      for (let i = 0; i < 26; i++) {
        g.strokeStyle = `hsla(${hue - 4} ${s}% ${l - 8 - rand() * 8}% / ${0.12 + rand() * 0.15})`;
        g.lineWidth = 0.6 + rand() * 1.4;
        const y = r * plankH + rand() * plankH;
        g.beginPath(); g.moveTo(x, y);
        g.bezierCurveTo(x + len * 0.3, y + (rand() - 0.5) * 6, x + len * 0.7, y + (rand() - 0.5) * 6, x + len, y + (rand() - 0.5) * 4);
        g.stroke();
      }
      g.fillStyle = 'rgba(40,26,16,0.55)';
      g.fillRect(x, r * plankH, 2, plankH);                // butt joint
      x += len;
    }
    g.fillStyle = 'rgba(40,26,16,0.6)';
    g.fillRect(0, r * plankH, w, 2);                       // long seam
  }
}, { repeat: [2.5, 3] });

const plasterTex = canvasTexture(512, 512, (g, w, h) => {
  g.fillStyle = '#e4dccf'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 9000; i++) {
    const v = 200 + rand() * 40;
    g.fillStyle = `rgba(${v},${v - 6},${v - 16},${0.10 + rand() * 0.12})`;
    const s = 1 + rand() * 3;
    g.fillRect(rand() * w, rand() * h, s, s);
  }
}, { repeat: [3, 2] });

const rugTex = canvasTexture(1024, 640, (g, w, h) => {
  g.fillStyle = '#7a3b2e'; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#d8c39a'; g.lineWidth = 18; g.strokeRect(40, 40, w - 80, h - 80);
  g.strokeStyle = '#2f4a5a'; g.lineWidth = 10; g.strokeRect(80, 80, w - 160, h - 160);
  g.fillStyle = '#2f4a5a';
  for (let x = 160; x < w - 140; x += 120) {
    for (let y = 160; y < h - 140; y += 110) {
      g.save(); g.translate(x, y); g.rotate(Math.PI / 4);
      g.fillRect(-22, -22, 44, 44);
      g.fillStyle = '#d8c39a'; g.fillRect(-8, -8, 16, 16); g.fillStyle = '#2f4a5a';
      g.restore();
    }
  }
  for (let i = 0; i < 20000; i++) {                      // wool fuzz
    g.fillStyle = `rgba(0,0,0,${rand() * 0.08})`;
    g.fillRect(rand() * w, rand() * h, 2, 2);
  }
});

const woodTex = canvasTexture(512, 512, (g, w, h) => {
  g.fillStyle = '#6b4128'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 120; i++) {
    g.strokeStyle = `rgba(${40 + rand() * 30},${22 + rand() * 16},${10},${0.15 + rand() * 0.2})`;
    g.lineWidth = 1 + rand() * 2;
    const y = rand() * h;
    g.beginPath(); g.moveTo(0, y);
    g.bezierCurveTo(w * 0.3, y + (rand() - 0.5) * 20, w * 0.7, y + (rand() - 0.5) * 20, w, y);
    g.stroke();
  }
});

// ---- materials -----------------------------------------------------------------------------
const M = {
  floor: new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.62, metalness: 0 }),
  wall: new THREE.MeshStandardMaterial({ map: plasterTex, color: 0xf2ebe0, roughness: 0.95 }),
  accentWall: new THREE.MeshStandardMaterial({ map: plasterTex, color: 0xa9bba8, roughness: 0.95 }),
  ceiling: new THREE.MeshStandardMaterial({ color: 0xf4f0ea, roughness: 1 }),
  trim: new THREE.MeshStandardMaterial({ color: 0xf6f3ee, roughness: 0.5 }),
  wood: new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.5 }),
  darkWood: new THREE.MeshStandardMaterial({ map: woodTex, color: 0x8a7a70, roughness: 0.55 }),
  paintedChair: new THREE.MeshStandardMaterial({ color: 0x3f5b66, roughness: 0.6 }),
  cushion: new THREE.MeshStandardMaterial({ color: 0xc9a46a, roughness: 0.9 }),
  rug: new THREE.MeshStandardMaterial({ map: rugTex, roughness: 1 }),
  brass: new THREE.MeshStandardMaterial({ color: 0xb08d57, roughness: 0.3, metalness: 1 }),
  shade: new THREE.MeshStandardMaterial({ color: 0xf3e3c3, roughness: 0.9, side: THREE.DoubleSide,
    emissive: 0xffc27a, emissiveIntensity: 0.55 }),
  bulb: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffd9a0, emissiveIntensity: 2.2 }),
  glass: new THREE.MeshPhysicalMaterial({ color: 0xdfeef5, roughness: 0.05, metalness: 0,
    transparent: true, opacity: 0.12, depthWrite: false }),
  pot: new THREE.MeshStandardMaterial({ color: 0xb4643f, roughness: 0.8 }),
  leaf: new THREE.MeshStandardMaterial({ color: 0x4f7a3e, roughness: 0.8 }),
  ceramic: new THREE.MeshStandardMaterial({ color: 0xe9e4da, roughness: 0.25 }),
};

function box(w, h, d, mat, x, y, z, parent = scene) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  parent.add(m);
  return m;
}
function cyl(rt, rb, h, mat, x, y, z, parent = scene, seg = 24) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  parent.add(m);
  return m;
}

// ---- the room: x ∈ [-2.5, 2.5], z ∈ [-3, 3], 2.7 m high; window in the north (−z) wall ----
const RW = 2.5, RD = 3, RH = 2.7, T = 0.15;
const floor = new THREE.Mesh(new THREE.PlaneGeometry(RW * 2, RD * 2), M.floor);
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(RW * 2, RD * 2), M.ceiling);
ceiling.rotation.x = Math.PI / 2; ceiling.position.y = RH; scene.add(ceiling);

// Window opening in the north wall.
const WX0 = -0.95, WX1 = 0.95, WY0 = 0.85, WY1 = 2.15;
const nz = -RD - T / 2;
box(WX0 + RW, RH, T, M.accentWall, (-RW + WX0) / 2, RH / 2, nz);             // left of window
box(RW - WX1, RH, T, M.accentWall, (WX1 + RW) / 2, RH / 2, nz);              // right
box(WX1 - WX0, WY0, T, M.accentWall, 0, WY0 / 2, nz);                        // below
box(WX1 - WX0, RH - WY1, T, M.accentWall, 0, (WY1 + RH) / 2, nz);            // above
box(RW * 2, RH, T, M.wall, 0, RH / 2, RD + T / 2);                           // south
box(T, RH, RD * 2, M.wall, -RW - T / 2, RH / 2, 0);                          // west
box(T, RH, RD * 2, M.wall, RW + T / 2, RH / 2, 0);                           // east

// Skirting boards and a light ceiling cornice — they draw the room's edges, which is where
// depth reads best.
box(RW * 2, 0.1, 0.02, M.trim, 0, 0.05, RD - 0.01);
box(0.02, 0.1, RD * 2, M.trim, -RW + 0.01, 0.05, 0);
box(0.02, 0.1, RD * 2, M.trim, RW - 0.01, 0.05, 0);
box(WX0 + RW, 0.1, 0.02, M.trim, (-RW + WX0) / 2, 0.05, -RD + 0.01);
box(RW - WX1, 0.1, 0.02, M.trim, (WX1 + RW) / 2, 0.05, -RD + 0.01);
box(WX1 - WX0, 0.1, 0.02, M.trim, 0, 0.05, -RD + 0.01);
box(RW * 2, 0.06, 0.05, M.trim, 0, RH - 0.03, RD - 0.025);
box(RW * 2, 0.06, 0.05, M.trim, 0, RH - 0.03, -RD + 0.025);
box(0.05, 0.06, RD * 2, M.trim, -RW + 0.025, RH - 0.03, 0);
box(0.05, 0.06, RD * 2, M.trim, RW - 0.025, RH - 0.03, 0);

// Window frame, mullions, sill, glass.
{
  const f = 0.06, fz = -RD - T / 2;
  box(WX1 - WX0 + 2 * f, f, T + 0.02, M.trim, 0, WY1 + f / 2, fz);
  box(WX1 - WX0 + 2 * f, f, T + 0.02, M.trim, 0, WY0 - f / 2, fz);
  box(f, WY1 - WY0, T + 0.02, M.trim, WX0 - f / 2, (WY0 + WY1) / 2, fz);
  box(f, WY1 - WY0, T + 0.02, M.trim, WX1 + f / 2, (WY0 + WY1) / 2, fz);
  box(0.035, WY1 - WY0, 0.05, M.trim, 0, (WY0 + WY1) / 2, fz);                 // vertical mullion
  box(WX1 - WX0, 0.035, 0.05, M.trim, 0, WY0 + (WY1 - WY0) * 0.62, fz);       // transom
  box(WX1 - WX0 + 0.3, 0.04, 0.24, M.trim, 0, WY0 - 0.02, -RD + 0.06);         // sill
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(WX1 - WX0, WY1 - WY0), M.glass);
  glass.position.set(0, (WY0 + WY1) / 2, fz); glass.renderOrder = 2;
  scene.add(glass);
  // Curtains either side: soft folds give the window wall real relief.
  const curtainMat = new THREE.MeshStandardMaterial({ color: 0xd9cbb3, roughness: 1, side: THREE.DoubleSide });
  for (const side of [-1, 1]) {
    const g = new THREE.PlaneGeometry(0.55, 2.35, 40, 1);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 34) * 0.035);
    g.computeVertexNormals();
    const c = new THREE.Mesh(g, curtainMat);
    c.position.set(side * (WX1 + 0.33), 2.35 / 2 + 0.2, -RD + 0.12);
    c.castShadow = true; c.receiveShadow = true;
    scene.add(c);
  }
  cyl(0.015, 0.015, WX1 - WX0 + 1.4, M.brass, 0, 2.4, -RD + 0.12).rotation.z = Math.PI / 2;
}

// Outside: a soft sky dome, a meadow and low hills. Kept low-contrast on purpose — it is the
// farthest thing from the glass, where high-contrast detail is the first to double.
{
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(100, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {},
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `varying vec3 vP;
        void main(){
          float h = clamp(vP.y, 0.0, 1.0);
          vec3 horizon = vec3(0.82, 0.86, 0.88), zenith = vec3(0.45, 0.62, 0.80);
          vec3 c = mix(horizon, zenith, pow(h, 0.6));
          gl_FragColor = vec4(c * 0.85, 1.0);
          #include <colorspace_fragment>
        }`,
    }),
  );
  sky.renderOrder = -1;                  // drawn first: it writes no depth, so nothing hides behind it
  scene.add(sky);
  const meadow = new THREE.Mesh(new THREE.CircleGeometry(90, 48),
    new THREE.MeshStandardMaterial({ color: 0x7f9a62, roughness: 1 }));
  meadow.rotation.x = -Math.PI / 2; meadow.position.y = -0.05; meadow.receiveShadow = true;
  scene.add(meadow);
  const hillMat = new THREE.MeshStandardMaterial({ color: 0x8aa27a, roughness: 1 });
  for (const [x, z, r, h] of [[-25, -60, 28, 9], [15, -70, 34, 12], [45, -55, 22, 7], [-55, -45, 24, 8]]) {
    const hill = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), hillMat);
    hill.scale.y = h / r; hill.position.set(x, -0.05, z);
    scene.add(hill);
  }
  const trunk = new THREE.MeshStandardMaterial({ color: 0x6a5240, roughness: 1 });
  const crown = new THREE.MeshStandardMaterial({ color: 0x5e7f4a, roughness: 1 });
  for (const [x, z, s] of [[-6, -14, 1.2], [-2.5, -19, 1.0], [5, -12, 1.4], [9, -22, 1.1], [1.5, -30, 1.3]]) {
    cyl(0.12 * s, 0.16 * s, 1.6 * s, trunk, x, 0.8 * s, z);
    const c = new THREE.Mesh(new THREE.IcosahedronGeometry(1.3 * s, 1), crown);
    c.position.set(x, 2.3 * s, z); c.castShadow = true;
    scene.add(c);
  }
}

// ---- furniture; each piece also registers a collision footprint ---------------------------
const obstacles = [];   // axis-aligned { x0, x1, z0, z1 } in metres
function block(x0, x1, z0, z1) { obstacles.push({ x0, x1, z0, z1 }); }

// Rug + dining table + four chairs.
{
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.7), M.rug);
  rug.rotation.x = -Math.PI / 2; rug.position.set(0, 0.004, -0.4); rug.receiveShadow = true;
  scene.add(rug);

  const tz = -0.4, tw = 1.6, td = 0.9, th = 0.75;
  box(tw, 0.045, td, M.wood, 0, th - 0.0225, tz);
  box(tw - 0.12, 0.08, td - 0.12, M.wood, 0, th - 0.085, tz);             // apron
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    box(0.06, th - 0.045, 0.06, M.wood, sx * (tw / 2 - 0.09), (th - 0.045) / 2, tz + sz * (td / 2 - 0.09));
  }
  block(-tw / 2, tw / 2, tz - td / 2, tz + td / 2);

  // A bowl of fruit and a jug on the table — small things at the convergence distance.
  const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.14, 32, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), M.ceramic);
  bowl.material = M.ceramic.clone(); bowl.material.side = THREE.DoubleSide;
  bowl.position.set(-0.2, th + 0.14, tz); bowl.castShadow = true; bowl.receiveShadow = true;
  scene.add(bowl);
  const fruitCols = [0xd2482b, 0xe0a030, 0x8fb33a, 0xd2482b, 0xe8c547];
  fruitCols.forEach((col, i) => {
    const a = (i / fruitCols.length) * Math.PI * 2;
    const f = new THREE.Mesh(new THREE.SphereGeometry(0.04, 20, 14),
      new THREE.MeshStandardMaterial({ color: col, roughness: 0.45 }));
    f.position.set(-0.2 + Math.cos(a) * 0.06, th + 0.05 + (i === 4 ? 0.04 : 0), tz + Math.sin(a) * 0.06);
    f.castShadow = true; scene.add(f);
  });
  const jug = cyl(0.05, 0.065, 0.2, new THREE.MeshStandardMaterial({ color: 0x3e6c8c, roughness: 0.3 }), 0.35, th + 0.1, tz + 0.12, scene, 28);
  jug.castShadow = true;

  function chair(x, z, rotY, mat) {
    const g = new THREE.Group();
    const sh = 0.46, sw = 0.44;
    box(sw, 0.04, sw, mat, 0, sh, 0, g);
    box(sw - 0.06, 0.03, sw - 0.06, M.cushion, 0, sh + 0.035, 0.0, g);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      box(0.035, sh, 0.035, mat, sx * (sw / 2 - 0.03), sh / 2, sz * (sw / 2 - 0.03), g);
    }
    for (const sx of [-1, 1]) box(0.035, 0.5, 0.035, mat, sx * (sw / 2 - 0.03), sh + 0.25, sw / 2 - 0.03, g);
    for (let i = 0; i < 3; i++) box(sw - 0.06, 0.05, 0.02, mat, 0, sh + 0.2 + i * 0.13, sw / 2 - 0.03, g);
    g.position.set(x, 0, z); g.rotation.y = rotY;
    scene.add(g);
    block(x - 0.25, x + 0.25, z - 0.25, z + 0.25);
  }
  // Two each side, facing the table (local −z is the chair's front); one pulled out a bit.
  chair(-0.4, tz - 0.62, Math.PI, M.paintedChair);
  chair(0.4, tz - 0.62, Math.PI, M.paintedChair);
  chair(-0.4, tz + 0.66, 0, M.paintedChair);
  chair(0.45, tz + 0.78, -0.18, M.paintedChair);
}

// Floor lamp in the north-west corner: the room's warm light.
const lampLight = new THREE.PointLight(0xffc98a, 4.0, 0, 2);
{
  const lx = -1.95, lz = -2.35;
  cyl(0.17, 0.19, 0.03, M.brass, lx, 0.015, lz);
  cyl(0.012, 0.012, 1.5, M.brass, lx, 0.78, lz);
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.24, 0.3, 40, 1, true), M.shade);
  shade.position.set(lx, 1.6, lz); shade.castShadow = false; scene.add(shade);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.04, 16, 12), M.bulb);
  bulb.position.set(lx, 1.56, lz); scene.add(bulb);
  lampLight.position.set(lx, 1.58, lz);
  scene.add(lampLight);
  block(lx - 0.2, lx + 0.2, lz - 0.2, lz + 0.2);
}

// Bookshelf on the west wall.
{
  const bx = -RW + 0.17, bz = 0.9, bw = 1.2, bh = 1.9, bd = 0.32;
  box(bd, bh, 0.03, M.darkWood, bx, bh / 2, bz - bw / 2);
  box(bd, bh, 0.03, M.darkWood, bx, bh / 2, bz + bw / 2);
  box(0.02, bh, bw, M.darkWood, bx - bd / 2 + 0.01, bh / 2, bz);
  for (let s = 0; s < 5; s++) {
    const y = 0.05 + s * 0.45;
    box(bd, 0.03, bw, M.darkWood, bx, y, bz);
    if (s === 4) break;
    let z = bz - bw / 2 + 0.04;
    while (z < bz + bw / 2 - 0.12) {
      const t = 0.025 + rand() * 0.035, hgt = 0.24 + rand() * 0.13;
      if (rand() < 0.1) { z += 0.08; continue; }
      const col = new THREE.Color().setHSL(rand(), 0.35 + rand() * 0.25, 0.3 + rand() * 0.25);
      const b = box(0.2 + rand() * 0.06, hgt, t, new THREE.MeshStandardMaterial({ color: col, roughness: 0.8 }),
        bx + 0.02, y + 0.015 + hgt / 2, z + t / 2);
      if (rand() < 0.08) b.rotation.x = 0.15;
      z += t + 0.003;
    }
  }
  block(-RW, -RW + 0.34, bz - bw / 2, bz + bw / 2);
}

// Sideboard on the east wall with a small table lamp, a vase and a picture above.
const tableLampLight = new THREE.PointLight(0xffd39a, 1.4, 0, 2);
{
  const sx = RW - 0.24, sz = 1.0, sw = 1.4, sh = 0.8, sd = 0.45;
  box(sd, sh - 0.12, sw, M.wood, sx, 0.12 + (sh - 0.12) / 2, sz);
  box(sd + 0.02, 0.03, sw + 0.02, M.wood, sx, sh + 0.015, sz);
  for (const k of [-1, 0, 1]) box(0.01, sh - 0.2, sw / 3 - 0.03, M.darkWood, sx - sd / 2 - 0.005, 0.12 + (sh - 0.12) / 2, sz + k * sw / 3);
  for (const k of [-1, 0, 1]) cyl(0.012, 0.012, 0.012, M.brass, sx - sd / 2 - 0.016, 0.55, sz + k * sw / 3).rotation.z = Math.PI / 2;
  for (const a of [-1, 1]) for (const b of [-1, 1]) cyl(0.02, 0.015, 0.12, M.darkWood, sx + a * (sd / 2 - 0.04), 0.06, sz + b * (sw / 2 - 0.05));
  block(RW - 0.47, RW, sz - sw / 2, sz + sw / 2);

  // table lamp
  const lz = sz + 0.42, top = sh + 0.03;
  const base = new THREE.Mesh(new THREE.SphereGeometry(0.09, 32, 16), M.ceramic);
  base.scale.y = 1.3; base.position.set(sx, top + 0.11, lz); base.castShadow = true; scene.add(base);
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.15, 0.18, 36, 1, true), M.shade);
  shade.position.set(sx, top + 0.33, lz); scene.add(shade);
  tableLampLight.position.set(sx, top + 0.3, lz);
  scene.add(tableLampLight);

  // vase with stems
  const vase = cyl(0.05, 0.07, 0.28, new THREE.MeshStandardMaterial({ color: 0x2f4a5a, roughness: 0.25 }), sx, top + 0.14, sz - 0.35);
  vase.castShadow = true;
  const stem = new THREE.MeshStandardMaterial({ color: 0x5f7b3d, roughness: 0.8 });
  for (let i = 0; i < 5; i++) {
    const s = cyl(0.004, 0.004, 0.35, stem, sx + (rand() - 0.5) * 0.06, top + 0.42, sz - 0.35 + (rand() - 0.5) * 0.06);
    s.rotation.set((rand() - 0.5) * 0.5, 0, (rand() - 0.5) * 0.5);
    const flower = new THREE.Mesh(new THREE.SphereGeometry(0.025, 12, 8),
      new THREE.MeshStandardMaterial({ color: [0xe8d07a, 0xe8e2d6, 0xd77a5a][i % 3], roughness: 0.7 }));
    flower.position.copy(s.position).add(new THREE.Vector3(0, 0.17, 0).applyEuler(s.rotation));
    scene.add(flower);
  }
}

// Pictures (simple painted landscapes on canvas) on the east and south walls.
function painting(w, h, palette, x, y, z, rotY) {
  const tex = canvasTexture(512, Math.round(512 * h / w), (g, W, H) => {
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, palette[0]); grd.addColorStop(0.6, palette[1]);
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
    g.fillStyle = palette[2];
    g.beginPath(); g.moveTo(0, H * 0.7);
    for (let i = 0; i <= 8; i++) g.lineTo(W * i / 8, H * (0.55 + 0.15 * Math.sin(i * 1.7 + palette.length)));
    g.lineTo(W, H); g.lineTo(0, H); g.fill();
    g.fillStyle = palette[3];
    g.beginPath(); g.arc(W * 0.72, H * 0.28, H * 0.09, 0, Math.PI * 2); g.fill();
  }, { repeat: [1, 1] });
  const grp = new THREE.Group();
  box(w + 0.08, h + 0.08, 0.03, M.darkWood, 0, 0, 0, grp);
  const art = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }));
  art.position.z = 0.016; grp.add(art);
  grp.position.set(x, y, z); grp.rotation.y = rotY;
  scene.add(grp);
}
painting(0.9, 0.6, ['#c7d5dc', '#e9d9b8', '#6f8a5c', '#e9b26a'], RW - 0.02, 1.6, 1.0, -Math.PI / 2);
painting(0.6, 0.8, ['#8fa6b8', '#d9c7a6', '#53664f', '#f0e2b6'], -0.8, 1.55, RD - 0.02, Math.PI);
painting(0.45, 0.45, ['#d6b9a0', '#efe2cc', '#a05a3c', '#f6efe0'], 0.25, 1.65, RD - 0.02, Math.PI);

// A potted plant in the north-east corner.
{
  const px = 1.95, pz = -2.4;
  cyl(0.2, 0.15, 0.36, M.pot, px, 0.18, pz);
  const leafGeo = new THREE.SphereGeometry(0.16, 16, 10);
  for (let i = 0; i < 14; i++) {
    const l = new THREE.Mesh(leafGeo, M.leaf);
    const a = rand() * Math.PI * 2, r = 0.05 + rand() * 0.22;
    l.position.set(px + Math.cos(a) * r, 0.5 + rand() * 0.75, pz + Math.sin(a) * r);
    l.scale.set(0.7 + rand() * 0.5, 0.4 + rand() * 0.3, 0.7 + rand() * 0.5);
    l.castShadow = true; l.receiveShadow = true;
    scene.add(l);
  }
  block(px - 0.25, px + 0.25, pz - 0.25, pz + 0.25);
}

// A pendant over the table (a third, dimmer source; no light of its own besides emissive).
{
  cyl(0.004, 0.004, 0.75, M.trim, 0, RH - 0.375, -0.4);
  const p = new THREE.Mesh(new THREE.SphereGeometry(0.18, 40, 20, 0, Math.PI * 2, 0, Math.PI * 0.55),
    new THREE.MeshStandardMaterial({ color: 0x2f4a5a, roughness: 0.4, side: THREE.DoubleSide }));
  p.position.set(0, RH - 0.72, -0.4); p.castShadow = true; scene.add(p);
  const b = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), M.bulb);
  b.position.set(0, RH - 0.8, -0.4); scene.add(b);
}

// ---- lighting ------------------------------------------------------------------------------
scene.add(new THREE.HemisphereLight(0xe6eef7, 0x8a7560, 0.85));
const sun = new THREE.DirectionalLight(0xfff0d8, 3.0);
sun.position.set(-3.2, 7.5, -11);
sun.target.position.set(0, 0, -0.5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 30 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
sun.shadow.radius = 3;
scene.add(sun, sun.target);
// The glass and the sky must not block the sun.
scene.traverse((o) => { if (o.material === M.glass) o.castShadow = false; });

// ---- movement --------------------------------------------------------------------------------
const pose = { x: 0, z: 1.9, yaw: 0, pitch: -0.12 };   // start near the south wall, facing the window
const vel = new THREE.Vector2();
const keys = new Set();
addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  keys.add(e.code);
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

const LOOK = 0.0022;   // rad per px of mouse movement
function look(dx, dy) {
  pose.yaw -= dx * LOOK;
  pose.pitch = Math.max(-1.35, Math.min(1.35, pose.pitch - dy * LOOK));
}

// Pointer lock is the standard first-person control but unverified over a woven canvas, so a
// drag-to-look path is always there too: press and drag looks, a click without a drag locks.
let locked = false, drag = null;
canvas.addEventListener('pointerdown', (e) => {
  canvas.focus();
  if (locked) return;
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 };
  canvas.setPointerCapture(e.pointerId);
  canvas.classList.add('dragging');
});
canvas.addEventListener('pointermove', (e) => {
  if (locked) { look(e.movementX, e.movementY); return; }
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.moved += Math.abs(dx) + Math.abs(dy);
  drag.x = e.clientX; drag.y = e.clientY;
  look(dx, dy);
});
function endDrag(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const click = drag.moved < 4 && e.type === 'pointerup';
  drag = null;
  canvas.classList.remove('dragging');
  if (click && canvas.requestPointerLock) {
    try {
      const p = canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch { /* drag-look stays available */ }
  }
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  hintEl.style.display = locked ? 'none' : '';
});

function collide(p) {
  const r = BODY_RADIUS;
  p.x = Math.max(-RW + r, Math.min(RW - r, p.x));
  p.z = Math.max(-RD + r, Math.min(RD - r, p.z));
  for (const o of obstacles) {
    // closest point on the box to the body centre; push out along that normal
    const cx = Math.max(o.x0, Math.min(o.x1, p.x));
    const cz = Math.max(o.z0, Math.min(o.z1, p.z));
    let dx = p.x - cx, dz = p.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    if (d2 > 1e-10) {
      const d = Math.sqrt(d2), k = (r - d) / d;
      p.x += dx * k; p.z += dz * k;
    } else {
      // centre inside the box: leave by the nearest face
      const opts = [[o.x0 - r - p.x, 0], [o.x1 + r - p.x, 0], [0, o.z0 - r - p.z], [0, o.z1 + r - p.z]];
      opts.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
      p.x += opts[0][0]; p.z += opts[0][1];
    }
  }
}

const clock = new THREE.Clock();
const fwd = new THREE.Vector2(), side = new THREE.Vector2(), want = new THREE.Vector2();
function update() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const turn = (keys.has('ArrowLeft') ? 1 : 0) - (keys.has('ArrowRight') ? 1 : 0);
  pose.yaw += turn * 1.6 * dt;
  const tilt = (keys.has('ArrowUp') ? 1 : 0) - (keys.has('ArrowDown') ? 1 : 0);
  pose.pitch = Math.max(-1.35, Math.min(1.35, pose.pitch + tilt * 1.0 * dt));

  const f = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
  const s = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  fwd.set(-Math.sin(pose.yaw), -Math.cos(pose.yaw));
  side.set(Math.cos(pose.yaw), -Math.sin(pose.yaw));
  want.set(0, 0).addScaledVector(fwd, f).addScaledVector(side, s);
  if (want.lengthSq() > 1) want.normalize();
  const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 2.4 : 1.3;   // m/s
  want.multiplyScalar(speed);
  // Eased start/stop: a walking pace, not a teleport — sudden lurches are what make stereo
  // motion uncomfortable.
  vel.lerp(want, 1 - Math.exp(-dt * 9));
  if (vel.lengthSq() < 1e-6 && want.lengthSq() === 0) vel.set(0, 0);
  pose.x += vel.x * dt; pose.z += vel.y * dt;
  collide(pose);

  appCam.position.set(pose.x, EYE_HEIGHT, pose.z);
  appCam.rotation.set(pose.pitch, pose.yaw, 0);
  appCam.updateMatrixWorld();
}

// ---- backing store ----------------------------------------------------------------------------
let woven = false;
function boxSize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  return { w: Math.max(1, Math.round((canvas.clientWidth || innerWidth) * dpr)),
           h: Math.max(1, Math.round((canvas.clientHeight || innerHeight) * dpr)) };
}
// Returns true if the buffer was reallocated (and so cleared) — the caller repaints at once.
function sizeCanvas() {
  const { w, h } = boxSize();
  const bufW = woven ? Math.round(w * SBS_SCALE) : w;
  appCam.aspect = w / h;                 // the box's shape, in both modes
  appCam.updateProjectionMatrix();
  if (canvas.width === bufW && canvas.height === h) return false;   // setSize clears even a no-op
  renderer.setSize(bufW, h, false);
  return true;
}

// ---- mono (2D) path ---------------------------------------------------------------------------
function monoTick() {
  update();
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, canvas.width, canvas.height);
  renderer.clear();
  renderer.render(scene, appCam);
}
function startMono(label) {
  woven = false;
  sizeCanvas();
  renderer.setAnimationLoop(monoTick);
  setStatus('flat', label);
  dropCover();
}
addEventListener('resize', () => { if (!woven && sizeCanvas()) monoTick(); });

// ---- status + cover ---------------------------------------------------------------------------
function setStatus(kind, html) {
  statusEl.className = `plate ${kind}`;
  statusEl.innerHTML = html;
}
let coverDropped = false;
function dropCover() {
  if (coverDropped) return;
  coverDropped = true;
  coverEl.remove();                      // a hard cut, never a fade
}

// ---- woven (3D) path --------------------------------------------------------------------------
async function startWoven() {
  let sdk, sdk3;
  try {
    // Dynamic, so a missing or broken SDK leaves the page on its 2D path instead of failing the
    // whole module graph.
    [sdk, sdk3] = await Promise.all([import('@displayxr/inline3d'), import('@displayxr/inline3d/three')]);
  } catch (err) {
    console.warn('[room] inline-3D SDK did not load; staying 2D', err);
    return startMono('<b>2D</b> — 3D SDK unavailable');
  }
  const { createInline3D, inline3dViewRigSupported, ViewerEase, frameTrackingState } = sdk;
  const { EyeCamera, cameraRigFromCamera } = sdk3;

  const wall = await createInline3D({ lazy: false, autoChrome: false });
  if (!wall.supported) {
    return startMono('<b>2D view</b> — open in the DisplayXR Browser on a 3D display for depth');
  }

  // Our HUD plates sit over the tile; register them (needed on browsers without draw-order
  // occlusion, accepted and ignored on those with it). None of them is full-bleed.
  for (const el of [helpEl, statusEl, hintEl]) wall.addGlobalOverlay(el);

  const eyes = [new EyeCamera(THREE), new EyeCamera(THREE)];
  for (const e of eyes) {
    appCam.add(e.camera);                // attach pattern: eyes are LOCAL to the app camera
    e.camera.near = NEAR; e.camera.far = FAR;   // scalars only; never updateProjectionMatrix()
  }
  const rig = {};
  const rigOpts = { convergence: CONVERGENCE, attach: true, out: rig };
  const good = [0, 1].map(() => ({ proj: new Float32Array(16), pose: new Float32Array(16) }));
  const goodVp = [0, 1].map(() => ({ x: 0, y: 0, width: 0, height: 0 }));
  let haveGood = false;
  const ease = new ViewerEase();         // glides the eyes across a tracking acquire/loss

  try {
    wall.session.updateRenderState({ depthNear: NEAR, depthFar: FAR });
  } catch (err) { console.warn('[room] updateRenderState failed', err); }

  // The drawing buffer can be smaller than canvas.width if the browser clamped it; map the
  // viewports onto what really exists.
  const gl = renderer.getContext();
  function scaleVp(vp) {
    const sx = canvas.width ? gl.drawingBufferWidth / canvas.width : 1;
    const sy = canvas.height ? gl.drawingBufferHeight / canvas.height : 1;
    if (sx === 1 && sy === 1) return vp;
    return { x: Math.round(vp.x * sx), y: Math.round(vp.y * sy), width: Math.round(vp.width * sx), height: Math.round(vp.height * sy) };
  }

  function drawEyes(vps, fromGood) {
    renderer.clear();
    renderer.setScissorTest(true);
    for (let i = 0; i < 2; i++) {
      const vp = scaleVp(vps[i]);
      renderer.setViewport(vp.x, vp.y, vp.width, vp.height);
      renderer.setScissor(vp.x, vp.y, vp.width, vp.height);
      if (fromGood) {
        eyes[i].setLocalFromMatrices(good[i].proj, good[i].pose);
        renderer.render(scene, eyes[i].camera);
      } else {
        renderer.render(scene, appCam);  // before any stereo frame: the same view in both halves
      }
    }
    renderer.setScissorTest(false);
  }
  // A frame that cannot draw stereo repaints the last good one — never skips, never clears bare.
  function replay() {
    if (haveGood) return drawEyes(goodVp, true);
    const w = canvas.width, h = canvas.height, half = Math.floor(w / 2);
    drawEyes([{ x: 0, y: 0, width: half, height: h }, { x: half, y: 0, width: w - half, height: h }], false);
  }

  let handle = null;
  function onFrame(views, layer, frame) {
    update();
    // Pushed before the gate: a rig drives the NEXT locate, so even a frame that cannot draw
    // must keep it current.
    if (handle) handle.setViewRig(cameraRigFromCamera(THREE, appCam, rigOpts));

    if (!views || views.length < 2 || !layer) return replay();
    const vps = [layer.getViewport(views[0]), layer.getViewport(views[1])];
    if (vps.some((vp) => !vp || !(vp.width > 0) || !(vp.height > 0))) return replay();

    for (let i = 0; i < 2; i++) {      // copies, never the XRView itself
      good[i].proj.set(views[i].projectionMatrix);
      good[i].pose.set(views[i].transform.matrix);
      Object.assign(goodVp[i], { x: vps[i].x, y: vps[i].y, width: vps[i].width, height: vps[i].height });
    }
    ease.apply(good, frameTrackingState(frame));
    haveGood = true;
    drawEyes(goodVp, true);
  }

  // Commit the canvas at its woven shape before registering it, then give it two frames. The
  // flat loop stops here (it would draw a mono frame over the pair); every failure path below
  // goes through startMono(), which restarts it.
  renderer.setAnimationLoop(null);
  woven = true;
  sizeCanvas();
  replay();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  try {
    handle = wall.addScene(canvas, onFrame, {
      viewRig: cameraRigFromCamera(THREE, appCam, rigOpts),   // the FIRST rig, at construction
      // Fallback framing for a browser without setViewRig (it then keeps a display rig): a
      // small virtual display keeps its nominal eye close behind the app camera.
      ...(inline3dViewRigSupported() ? {} : { virtualDisplayHeight: 0.12 }),
      rectCover: { color: '#2b2825' },   // covers a later resize/move until rewoven
      onResize: () => { if (sizeCanvas()) replay(); },
      onLayerLost: () => {
        haveGood = false;
        startMono('<b>2D view</b> — the 3D layer ended');
      },
    });
  } catch (err) {
    console.warn('[room] addScene failed; staying 2D', err);
    return startMono('<b>2D view</b> — 3D could not start');
  }
  setStatus('woven', inline3dViewRigSupported()
    ? '<b>3D</b> — glasses-free'
    : '<b>3D</b> — older browser: default display framing');

  // Cover until the first woven frame; always comes off (timeout, or the window not weaving).
  const safety = setTimeout(dropCover, 6000);
  handle.firstWoven.then((r) => {
    clearTimeout(safety);
    if (!r.woven) console.warn('[room] firstWoven:', r.reason);
    dropCover();
  }, () => dropCover());
}

// ---- boot -------------------------------------------------------------------------------------
update();
sizeCanvas();
renderer.setAnimationLoop(monoTick);     // the 2D loop until (and unless) 3D takes over
startWoven().catch((err) => {
  console.error('[room] 3D setup threw; staying 2D', err);
  startMono('<b>2D view</b>');
});
