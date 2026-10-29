// aquarium.js — the tank as a three.js scene.
//
// Authored in metres for the 0.24 m virtual display that main.js asks for. The glass is the
// z = 0 plane and +z points out of it toward the viewer, so the tank sits BEHIND the glass
// (z < 0). Only the fish cross the glass, and only by a centimetre or so. Nothing is pushed back
// or shrunk to change how deep it looks: the tank's own proportions set the depth.

export const BG = 0x1d2c33; // water and page colour: dark slate, never pure black (crosstalk)

const HW = 0.172; // half the interior width
const HH = 0.106; // half the interior height
const DEPTH = 0.1; // glass to back wall
const FLOOR = -HH; // bottom of the tank
const RIM = 0.007; // rim and rail thickness

// Small deterministic PRNG, so rocks, plants and bubbles look the same on every load.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Five fish. Each one traces a Lissajous path inside its own box: centre c, radii r, angular
// speeds w and phases p. The z range (c.z ± r.z, plus half a body) stays between -0.096 and
// +0.016, so the nearest fish pops out of the glass by about 1.6 cm at most.
const FISH = [
  { color: 0xd9733b, s: 1.0, c: [-0.02, 0.01, -0.05], r: [0.13, 0.03, 0.025], w: [0.42, 0.61, 0.27], p: [0.0, 1.0, 0.5], wag: 11 },
  { color: 0x4b9fd5, s: 0.85, c: [0.03, -0.035, -0.06], r: [0.12, 0.025, 0.025], w: [0.33, 0.75, 0.48], p: [2.0, 0.3, 1.9], wag: 13 },
  { color: 0xd8b24a, s: 0.9, c: [-0.06, 0.04, -0.03], r: [0.1, 0.03, 0.025], w: [0.52, 0.45, 0.37], p: [4.0, 2.2, 0.2], wag: 10 },
  { color: 0xc4543f, s: 0.75, c: [0.08, 0.0, -0.02], r: [0.08, 0.04, 0.03], w: [0.61, 0.83, 0.29], p: [1.1, 4.1, 2.6], wag: 14 },
  { color: 0xa9b8bc, s: 0.8, c: [0.0, -0.01, -0.07], r: [0.14, 0.02, 0.02], w: [0.27, 0.58, 0.41], p: [5.2, 0.9, 3.3], wag: 12 },
];

// The back wall: a vertical gradient, lighter near the surface and darker at the floor.
function gradientTexture(THREE) {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#2e4c55');
  grad.addColorStop(1, '#14222a');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// A leaf outline, base at (0,0), tip at (0,1). Scale it to set the leaf length.
function leafGeometry(THREE) {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.quadraticCurveTo(0.22, 0.35, 0, 1);
  s.quadraticCurveTo(-0.22, 0.35, 0, 0);
  return new THREE.ShapeGeometry(s, 6);
}

// A fish, nose along +x, lying in the xy plane so it reads from the front.
function makeFish(THREE, f) {
  const group = new THREE.Group();
  group.rotation.order = 'YZX'; // yaw about the tank's up axis, then pitch in the body frame
  const bodyMat = new THREE.MeshStandardMaterial({ color: f.color, roughness: 0.45 });
  const finMat = new THREE.MeshStandardMaterial({ color: f.color, roughness: 0.6, side: THREE.DoubleSide });

  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), bodyMat);
  body.scale.set(0.02 * f.s, 0.0105 * f.s, 0.0078 * f.s);
  group.add(body);

  // Tail: a flat fan on a pivot at the rear, so it can swing side to side.
  const tail = new THREE.Group();
  tail.position.x = -0.016 * f.s;
  group.add(tail);
  const tailShape = new THREE.Shape();
  tailShape.moveTo(0, 0);
  tailShape.lineTo(-0.014, 0.011);
  tailShape.quadraticCurveTo(-0.01, 0, -0.014, -0.011);
  tailShape.lineTo(0, 0);
  const tailMesh = new THREE.Mesh(new THREE.ShapeGeometry(tailShape, 4), finMat);
  tailMesh.scale.setScalar(f.s);
  tail.add(tailMesh);

  // Dorsal fin.
  const finShape = new THREE.Shape();
  finShape.moveTo(0.004, 0.0095);
  finShape.lineTo(-0.006, 0.0095);
  finShape.lineTo(-0.002, 0.0165);
  finShape.lineTo(0.004, 0.0095);
  const fin = new THREE.Mesh(new THREE.ShapeGeometry(finShape, 3), finMat);
  fin.scale.setScalar(f.s);
  group.add(fin);

  // Eye, on the front face of the body so it reads as facing the viewer.
  const eye = new THREE.Mesh(
    new THREE.SphereGeometry(0.0022 * f.s, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0x101418, roughness: 0.4 }),
  );
  eye.position.set(0.0125 * f.s, 0.003 * f.s, 0.0068 * f.s);
  group.add(eye);

  return { group, tail };
}

// rock surface jitter: a function of position only, so shared vertices stay welded together
function rockJitter(x, y, z, seed) {
  return 1 + 0.16 * Math.sin(3.1 * x + 2.3 * y + seed) * Math.cos(2.7 * z - 1.1 * x) + 0.07 * Math.sin(7 * y + 5 * z + seed * 2);
}

export function buildAquarium(THREE) {
  const rand = rng(20240611);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  // Aerial fade: far things melt toward the water colour. It is gentle, since the back wall is
  // only DEPTH behind the glass, and it cuts the high-contrast detail far from the glass (rule 3).
  scene.fog = null;

  scene.add(new THREE.HemisphereLight(0xcfe6ee, 0x1c2b31, 1.0));
  const sun = new THREE.DirectionalLight(0xfff3e2, 0.8);
  sun.position.set(0.3, 1, 0.8);
  scene.add(sun);

  // ---- back wall ----
  const back = new THREE.Mesh(
    new THREE.PlaneGeometry(2 * HW + 0.02, 2 * HH + 0.02),
    new THREE.MeshStandardMaterial({ map: gradientTexture(THREE), roughness: 1 }),
  );
  back.position.z = -DEPTH;
  scene.add(back);

  // ---- glass: side panes (faint, so they read as glass rather than as a plate) ----
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xc8e4ea,
    roughness: 0.15,
    transparent: true,
    opacity: 0.07,
    depthWrite: false,
  });
  for (const s of [-1, 1]) {
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(DEPTH, 2 * HH), glassMat);
    pane.rotation.y = (s * Math.PI) / 2;
    pane.position.set(s * HW, 0, -DEPTH / 2);
    scene.add(pane);
  }

  // ---- frame: the front rim sits ON the glass plane (zero disparity, so it stays crisp),
  //      and the rails recede into the tank so its box reads as a box ----
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x33454c, roughness: 0.55 });
  const bar = (w, h, d, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), frameMat);
    m.position.set(x, y, z);
    scene.add(m);
  };
  bar(2 * HW + RIM, RIM, RIM * 1.4, 0, HH, 0);
  bar(2 * HW + RIM, RIM, RIM * 1.4, 0, -HH, 0);
  bar(RIM, 2 * HH + RIM, RIM * 1.4, -HW, 0, 0);
  bar(RIM, 2 * HH + RIM, RIM * 1.4, HW, 0, 0);
  for (const x of [-HW, HW]) for (const y of [-HH, HH]) bar(RIM, RIM, DEPTH, x, y, -DEPTH / 2);

  // ---- sand: a gently rippled floor ----
  const sandGeo = new THREE.PlaneGeometry(2 * HW, DEPTH, 40, 12);
  sandGeo.rotateX(-Math.PI / 2); // now lies flat; local z spans -DEPTH/2..DEPTH/2
  const sandPos = sandGeo.attributes.position;
  for (let i = 0; i < sandPos.count; i++) {
    const x = sandPos.getX(i);
    const z = sandPos.getZ(i);
    sandPos.setY(i, 0.006 * Math.sin(x * 38 + 1.3) * Math.cos(z * 52) + 0.003 * Math.sin(z * 90 + x * 20));
  }
  sandGeo.computeVertexNormals();
  const sand = new THREE.Mesh(sandGeo, new THREE.MeshStandardMaterial({ color: 0xa8956b, roughness: 1 }));
  sand.position.set(0, FLOOR + 0.004, -DEPTH / 2);
  scene.add(sand);

  // ---- rocks: half-buried, flat-shaded, mid grey so they don't read as high contrast ----
  const rocks = [
    { x: -0.09, z: -0.07, r: 0.022, s: [1.25, 0.85, 1.0], c: 0x6b7174, seed: 0.4 },
    { x: 0.02, z: -0.085, r: 0.017, s: [1.0, 0.9, 1.1], c: 0x5f6669, seed: 1.9 },
    { x: 0.1, z: -0.05, r: 0.026, s: [1.3, 0.8, 1.0], c: 0x737a7c, seed: 3.2 },
    { x: -0.15, z: -0.03, r: 0.012, s: [1.0, 1.0, 1.0], c: 0x5a6163, seed: 4.6 },
  ];
  for (const k of rocks) {
    const geo = new THREE.IcosahedronGeometry(1, 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const j = rockJitter(x, y, z, k.seed);
      pos.setXYZ(i, x * j, y * j, z * j);
    }
    geo.computeVertexNormals();
    const rock = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: k.c, roughness: 0.95, flatShading: true }));
    rock.scale.set(k.r * k.s[0], k.r * k.s[1], k.r * k.s[2]);
    rock.position.set(k.x, FLOOR + k.r * k.s[1] * 0.3, k.z);
    scene.add(rock);
  }

  // ---- plants: a chain of joints per stalk, swaying, with leaves on the upper joints ----
  const SEGS = 5;
  const stalkGeo = new THREE.CylinderGeometry(0.0032, 0.0042, 1, 6, 1);
  stalkGeo.translate(0, 0.5, 0); // base at the origin, so scale.y sets the segment length
  const leafGeo = leafGeometry(THREE);
  const stalkMat = new THREE.MeshStandardMaterial({ color: 0x2e7d5b, roughness: 0.7 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x3f9a6e, roughness: 0.6, side: THREE.DoubleSide });
  const plantSpecs = [
    { x: -0.135, z: -0.085, h: 0.105, ph: 0.0 },
    { x: -0.11, z: -0.04, h: 0.065, ph: 1.7 },
    { x: 0.12, z: -0.07, h: 0.11, ph: 3.1 },
    { x: 0.148, z: -0.095, h: 0.075, ph: 4.4 },
    { x: 0.02, z: -0.095, h: 0.09, ph: 2.2 },
  ];
  const plants = plantSpecs.map((sp) => {
    const root = new THREE.Group();
    root.position.set(sp.x, FLOOR, sp.z);
    scene.add(root);
    const segLen = sp.h / SEGS;
    const joints = [];
    let parent = root;
    for (let i = 0; i < SEGS; i++) {
      const joint = new THREE.Group();
      joint.position.y = i === 0 ? 0 : segLen;
      parent.add(joint);
      const stalk = new THREE.Mesh(stalkGeo, stalkMat);
      stalk.scale.y = segLen;
      joint.add(stalk);
      if (i > 0) {
        const leaf = new THREE.Mesh(leafGeo, leafMat);
        leaf.scale.setScalar(0.03 - i * 0.003);
        leaf.rotation.set(0, i * 2.1, i % 2 ? 0.9 : -0.9);
        joint.add(leaf);
      }
      joints.push(joint);
      parent = joint;
    }
    return { joints, ph: sp.ph };
  });

  // ---- fish ----
  const fish = FISH.map((f) => {
    const { group, tail } = makeFish(THREE, f);
    scene.add(group);
    return { ...f, group, tail };
  });

  // ---- bubbles: a few, rising slowly, faint so they don't fight the glass ----
  const bubbleGeo = new THREE.SphereGeometry(1, 8, 6);
  const bubbleMat = new THREE.MeshStandardMaterial({
    color: 0xdcf1f7,
    roughness: 0.2,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
  });
  const bubbles = [];
  for (let i = 0; i < 8; i++) {
    const m = new THREE.Mesh(bubbleGeo, bubbleMat);
    const r = 0.0016 + rand() * 0.0022;
    m.scale.setScalar(r);
    scene.add(m);
    bubbles.push({ m, x: (rand() - 0.5) * 2 * HW * 0.8, ph: rand(), sp: 0.04 + rand() * 0.03, z: -0.03 - rand() * 0.06 });
  }

  // Every motion is a closed-form function of absolute time t (seconds), so the frames the
  // runtime replays and the frames it lives stay on one clock.
  function update(t) {
    for (const p of plants) {
      p.joints.forEach((j, i) => {
        j.rotation.z = Math.sin(t * 0.9 + p.ph + i * 0.55) * (0.05 + 0.03 * i);
        j.rotation.x = Math.sin(t * 0.6 + p.ph * 1.3 + i * 0.35) * 0.06 * i;
      });
    }
    for (const f of fish) {
      const [cx, cy, cz] = f.c;
      const [rx, ry, rz] = f.r;
      const [wx, wy, wz] = f.w;
      const [px, py, pz] = f.p;
      f.group.position.set(
        cx + rx * Math.sin(wx * t + px),
        cy + ry * Math.sin(wy * t + py),
        cz + rz * Math.sin(wz * t + pz),
      );
      // Heading from the velocity, so the nose always leads: yaw about up, then pitch.
      const vx = rx * wx * Math.cos(wx * t + px);
      const vy = ry * wy * Math.cos(wy * t + py);
      const vz = rz * wz * Math.cos(wz * t + pz);
      f.group.rotation.y = Math.atan2(-vz, vx);
      f.group.rotation.z = Math.max(-0.5, Math.min(0.5, Math.atan2(vy, Math.hypot(vx, vz))));
      f.tail.rotation.y = Math.sin(t * f.wag) * 0.45;
    }
    for (const b of bubbles) {
      const phase = (t * b.sp + b.ph) % 1;
      b.m.position.set(
        b.x + 0.003 * Math.sin(t * 2.1 + b.ph * 9),
        FLOOR + 0.01 + phase * (2 * HH - 0.02),
        b.z,
      );
    }
  }

  return { scene, update };
}
