// Desk aquarium — a glass tank on a wooden plinth: sand, rocks, swaying plants, an air stone with
// bubbles, and five fish on their own loops. Framed by SceneViewer on a DISPLAY rig: the user looks
// INTO a tank and does not walk through it. Rules: /sdk/docs/making-3d-look-right.md.
//
// SCREEN PLANE (§2): through the tank, nudged back with depthOffset so the "behind" budget is used
// too. The front glass is the nearest surface; the back glass and the far rocks the farthest.
// DEPTH (§3): depthFit to the comfortable column for a 16:9 tile: 0.1 h in front, 0.27 h behind.
// The tank is 0.4 of its height deep, so the height fit decides its size, not the depth budget.
// NO YAW: turning a 1 m wide tank by 10° adds ~0.17 m of depth and would shrink the whole tank to
// meet the budget. The 3D comes from the glass, the plants and fish at different depths, and from
// head tracking looking round them.

import * as THREE from 'three';
import { createInline3D } from '@displayxr/inline3d';
import { EyeCamera, displayRig } from '@displayxr/inline3d/three';
import { SceneViewer } from '@displayxr/inline3d/viewer';

const canvas = document.getElementById('tank');
const cover = document.getElementById('cover');
const depth = document.getElementById('depth');
const modeBtn = document.getElementById('mode');
const modeNote = document.getElementById('modeNote');

const VDH = 0.24;                  // virtual display height, metres: the SAME in displayRig() below
const FRONT = 0.1, BACK = 0.27;    // depth budget, tile heights (16:9, comfortable column)
const BG = '#101a24';              // == the page colour behind the canvas (index.html)

const viewer = new SceneViewer(THREE, canvas, {
  virtualDisplayHeight: VDH,
  clearColor: BG,                  // OPAQUE clear: the glass and water blend over it, nothing is see-through
  depthFit: { front: FRONT, back: BACK },
  fitSweep: false,                 // nothing turns the tank, so budget its real depth
  orbit: false,                    // a drag would swing the wide tank's width into depth
  // no `feather`: it fades to transparent, which needs an alpha clear (guide §5)
}).useEyeCamera(EyeCamera);

// ---- the tank, in metres (fitTo() scales the whole set into the tile) ------------------------------
const W = 1.0, H = 0.5, D = 0.2;   // outer glass box: 1 m wide, half as tall, 0.2 m deep
const G = 0.02;                    // glass and rim thickness
const FLOOR = -H / 2 + G;          // inside of the bottom glass
const SAND_TOP = FLOOR + 0.05;     // the sand is 5 cm deep
const WATER_TOP = 0.2;             // water level, under the rim
const AIR_X = 0.26;                // the air stone, on the sand

// ---- textures: a fine irregular grain, so stereo matching has detail to lock onto ----------------
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
function grain(base, contrast = 0.2, specks = 900) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < specks; i++) {
    g.fillStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,255,255'},${rnd() * contrast})`;
    g.fillRect(rnd() * 128, rnd() * 128, 1 + rnd() * 4, 1 + rnd() * 4);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
const sandTex = grain('#d9c293', 0.22);
sandTex.repeat.set(4, 1);          // the sand is a long, shallow box: stretch the grain along it
const sandMat = new THREE.MeshStandardMaterial({ map: sandTex, roughness: 0.95 });
const rockMat = new THREE.MeshStandardMaterial({ map: grain('#6e746f', 0.35), roughness: 0.8, flatShading: true });
const woodTex = grain('#6b4f35', 0.3);
woodTex.repeat.set(2, 1);
const woodMat = new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.7 });

// ---- the glass tank: panes, a mid-grey rim (high-contrast edges ghost, so no white), and water ----
const tank = new THREE.Group();
const glassMat = new THREE.MeshStandardMaterial({
  color: '#d6eef8', transparent: true, opacity: 0.1, roughness: 0.05, metalness: 0,
  side: THREE.DoubleSide, depthWrite: false,
});
const rimMat = new THREE.MeshStandardMaterial({ color: '#7f8f9b', roughness: 0.45, metalness: 0.2 });
const pane = (w, h, x, y, z, ry) => {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glassMat);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  m.renderOrder = 3;               // the glass is drawn last, over the water and bubbles
  tank.add(m);
};
pane(W, H, 0, 0, D / 2, 0);        // front
pane(W, H, 0, 0, -D / 2, 0);       // back
pane(D, H, -W / 2, 0, 0, Math.PI / 2);
pane(D, H, W / 2, 0, 0, Math.PI / 2);
const bar = (sx, sy, sz, x, y, z) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), rimMat);
  m.position.set(x, y, z);
  tank.add(m);
};
for (const y of [-H / 2, H / 2]) for (const z of [-D / 2, D / 2]) bar(W + G, G, G, 0, y, z);
for (const y of [-H / 2, H / 2]) for (const x of [-W / 2, W / 2]) bar(G, G, D + G, x, y, 0);
for (const x of [-W / 2, W / 2]) for (const z of [-D / 2, D / 2]) bar(G, H, G, x, 0, z);

const water = new THREE.Mesh(
  new THREE.BoxGeometry(W - 2 * G, WATER_TOP - FLOOR, D - 2 * G),
  new THREE.MeshStandardMaterial({ color: '#2a8db0', transparent: true, opacity: 0.2, roughness: 0.2, depthWrite: false }),
);
water.position.y = (WATER_TOP + FLOOR) / 2;
water.renderOrder = 1;             // after the opaque sand, fish and plants, before the glass
tank.add(water);

const sand = new THREE.Mesh(new THREE.BoxGeometry(W - 2 * G, SAND_TOP - FLOOR, D - 2 * G), sandMat);
sand.position.y = (SAND_TOP + FLOOR) / 2;
tank.add(sand);

const stone = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.02, 0.016, 12), rimMat);
stone.position.set(AIR_X, SAND_TOP + 0.008, 0);
tank.add(stone);

// ---- rocks: an icosphere whose radius wobbles with POSITION, so duplicate vertices move together
// and the surface does not crack ----
function rock(x, z, sx, sy, sz, s) {
  const geo = new THREE.IcosahedronGeometry(1, 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x0 = p.getX(i), y0 = p.getY(i), z0 = p.getZ(i);
    const k = 0.8 + 0.2 * Math.abs(Math.sin(x0 * 5.3 + y0 * 7.1 + z0 * 3.7 + s));
    p.setXYZ(i, x0 * k, y0 * k, z0 * k);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, rockMat);
  m.scale.set(sx, sy, sz);
  m.position.set(x, SAND_TOP + sy * 0.4, z);   // half sunk in the sand
  tank.add(m);
}
rock(-0.2, 0.02, 0.1, 0.06, 0.08, 1.3);
rock(0.12, -0.03, 0.14, 0.085, 0.1, 2.1);
rock(-0.02, 0.05, 0.07, 0.05, 0.06, 3.4);

// ---- plants: a chain of joints, so each one bends from its root and sways ----------------------
const stalkMat = new THREE.MeshStandardMaterial({ color: '#2f6b3a', roughness: 0.6 });
const leafGeo = new THREE.PlaneGeometry(0.03, 0.09).translate(0, 0.045, 0);   // pivot at the base
function plant(x, z, height, color, phase) {
  const leafMat = new THREE.MeshStandardMaterial({ color, roughness: 0.55, side: THREE.DoubleSide });
  const root = new THREE.Group();
  root.position.set(x, SAND_TOP, z);
  tank.add(root);
  const segs = 5, seg = height / segs;
  const joints = [];
  let parent = root;
  for (let i = 0; i < segs; i++) {
    const joint = new THREE.Group();
    joint.position.y = i === 0 ? 0 : seg;      // each joint sits at the top of the one below
    parent.add(joint);
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.007, seg, 6), stalkMat);
    stalk.position.y = seg / 2;
    joint.add(stalk);
    for (const side of [-1, 1]) {
      const leaf = new THREE.Mesh(leafGeo, leafMat);
      leaf.position.set(0, seg * 0.45, 0.004 * side);
      leaf.rotation.z = side * 0.7;
      joint.add(leaf);
    }
    joints.push(joint);
    parent = joint;
  }
  return { joints, phase };
}
const plants = [
  plant(-0.4, -0.03, 0.22, '#3f9e4f', 0.0),
  plant(-0.31, 0.04, 0.28, '#58b35e', 1.7),
  plant(0.02, -0.05, 0.18, '#2f8a4a', 3.1),
  plant(0.42, 0.02, 0.24, '#6cc26a', 4.4),
  plant(-0.11, 0.05, 0.14, '#4aa35a', 5.2),
];

// ---- fish: a body, a dorsal fin and a forked tail, facing +x. The yaw group carries position and
// heading; the pitch group inside it climbs and dives; the tail wags. ----------------------------
function polygon(pts) {
  const sh = new THREE.Shape();
  sh.moveTo(pts[0][0], pts[0][1]);
  for (const p of pts.slice(1)) sh.lineTo(p[0], p[1]);
  sh.closePath();
  return new THREE.ShapeGeometry(sh);
}
function makeFish(color, fin, s) {
  const yaw = new THREE.Group();
  const pitch = new THREE.Group();
  yaw.add(pitch);
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.05 });
  const finMat = new THREE.MeshStandardMaterial({ color: fin, roughness: 0.5, side: THREE.DoubleSide });
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), bodyMat);
  body.scale.set(s * 0.5, s * 0.22, s * 0.14);
  pitch.add(body);
  pitch.add(new THREE.Mesh(polygon([[0.1 * s, 0.18 * s], [-0.12 * s, 0.16 * s], [-0.02 * s, 0.3 * s]]), finMat));
  const tail = new THREE.Group();
  tail.position.x = -0.46 * s;
  tail.add(new THREE.Mesh(polygon([[0, 0], [-0.26 * s, 0.2 * s], [-0.2 * s, 0], [-0.26 * s, -0.2 * s]]), finMat));
  pitch.add(tail);
  return { yaw, pitch, tail };
}
const SCHOOL = [
  ['#ff8a3d', '#fff1d6'],          // orange, cream fins
  ['#f2c14e', '#2e4fa3'],          // gold, blue fins
  ['#5fb8e0', '#e8f7ff'],          // pale blue
  ['#e9e9e9', '#e0457b'],          // silver, pink fins
  ['#7fd18b', '#ffe066'],          // green, yellow fins
];
// Each fish runs its own Lissajous loop inside the tank: x across, y up and down, z a little in
// and out. The loop's own derivative gives the heading, so the fish always faces where it swims.
const fishes = SCHOOL.map(([body, fin]) => {
  const f = makeFish(body, fin, 0.11);
  tank.add(f.yaw);
  return {
    ...f,
    ax: 0.24 + 0.1 * rnd(), ay: 0.05 + 0.05 * rnd(), az: 0.03 + 0.03 * rnd(),
    wx: 0.2 + 0.12 * rnd(), wy: 0.25 + 0.15 * rnd(), wz: 0.3 + 0.2 * rnd(),
    px: rnd() * Math.PI * 2, py: rnd() * Math.PI * 2, pz: rnd() * Math.PI * 2,
    cy: -0.02 + 0.08 * rnd(),
    yawA: 0, pitchA: 0,
  };
});

// ---- bubbles: from the air stone up to the surface -----------------------------------------------
const bubbleGeo = new THREE.SphereGeometry(0.007, 12, 8);
const bubbleMat = new THREE.MeshStandardMaterial({
  color: '#e6f8ff', transparent: true, opacity: 0.5, roughness: 0.1, depthWrite: false,
});
const bubbles = Array.from({ length: 9 }, (_, i) => {
  const m = new THREE.Mesh(bubbleGeo, bubbleMat);
  m.renderOrder = 2;
  tank.add(m);
  return { m, t: i / 9, rate: 0.07 + 0.04 * rnd(), ph: rnd() * Math.PI * 2 };
});

// ---- the set: the tank on a wooden plinth -----------------------------------------------------------
const set = new THREE.Group();
set.add(tank);
const plinth = new THREE.Mesh(new THREE.BoxGeometry(W + 0.04, 0.12, D + 0.04), woodMat);
plinth.position.y = -H / 2 - 0.06;
set.add(plinth);
viewer.content.add(set);

const sun = new THREE.DirectionalLight('#fff4e0', 2.0);
sun.position.set(-1.5, 3, 2.5);
viewer.scene.add(sun, new THREE.HemisphereLight('#c9ecff', '#1d2a33', 1.2));

// Frame on the box the set really occupies. Then sit it a little behind the glass: the front glass
// is the nearest surface and the back glass the farthest, so both halves of the budget get used.
viewer.depthOffset = -((BACK - FRONT) / 2) * VDH;
const box = new THREE.Box3().setFromObject(viewer.content);
viewer.fitTo(box.getCenter(new THREE.Vector3()), box.getSize(new THREE.Vector3()));

// ---- animation: SceneViewer calls onTick once per drawn frame, woven or flat ----------------------
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const SPEED = reduce ? 0.3 : 1;    // a calmer tank for users who ask for less motion
let clock = 0, last = 0;
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
viewer.onTick = () => {
  const now = performance.now();
  const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
  last = now;
  clock += dt * SPEED;

  for (const p of plants) {
    p.joints.forEach((j, i) => {
      j.rotation.z = Math.sin(clock * 0.9 + p.phase + i * 0.5) * (0.05 + 0.03 * i);
    });
  }

  for (const f of fishes) {
    const a = f.wx * clock + f.px, b = f.wy * clock + f.py, c = f.wz * clock + f.pz;
    f.yaw.position.set(f.ax * Math.sin(a), f.cy + f.ay * Math.sin(b), f.az * Math.sin(c));
    const vx = f.ax * f.wx * Math.cos(a), vy = f.ay * f.wy * Math.cos(b), vz = f.az * f.wz * Math.cos(c);
    const yawT = Math.atan2(-vz, vx), pitchT = Math.atan2(vy, Math.hypot(vx, vz));
    // Ease the heading, so a turn at the end of a loop reads as a turn and not a flip.
    const k = Math.min(1, dt * 4);
    f.yawA = wrapAngle(f.yawA + wrapAngle(yawT - f.yawA) * k);
    f.pitchA += (pitchT - f.pitchA) * k;
    f.yaw.rotation.y = f.yawA;
    f.pitch.rotation.z = f.pitchA;
    f.tail.rotation.y = Math.sin(clock * 10 + f.px) * 0.45;
  }

  for (const b of bubbles) {
    b.t = (b.t + dt * SPEED * b.rate) % 1;
    b.m.position.set(
      AIR_X + 0.012 * Math.sin(b.t * 9 + b.ph),
      SAND_TOP + 0.03 + b.t * (WATER_TOP - SAND_TOP - 0.05),
      0,
    );
    b.m.scale.setScalar(0.6 + 0.6 * b.t);       // bubbles grow as they rise
  }
};

// ---- boot ------------------------------------------------------------------------------------------
const wall = await createInline3D({ lazy: false });
if (!wall.supported) {
  // An ordinary browser: the same page, flat. Same layout; the 3D controls rest, and say why.
  viewer.startMono();
  cover.remove();
  depth.disabled = modeBtn.disabled = true;
  modeBtn.textContent = '2D';
  modeNote.textContent = 'Open this page in the DisplayXR Browser on a 3D display to see it in 3D.';
} else {
  // One value k moves BOTH factors. On a display rig 1 is what the display does naturally; below 1
  // only makes the scene shallower, so the slider is a comfort dial and cannot add depth.
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
  await handle.firstWoven;           // cover until the first woven frame
  cover.remove();                    // cut, never fade
}
