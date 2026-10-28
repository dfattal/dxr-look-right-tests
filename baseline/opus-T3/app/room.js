// room.js — the furnished room, authored in METRES (load-bearing on a camera rig: the eye
// separation is absolute in world units, so 1 unit must be 1 m for the viewer's real IPD to apply).
//
// Everything is procedural (no asset downloads): boxes, cylinders and canvas textures. Textures
// stay mid-frequency on purpose: very fine high-contrast detail aliases differently in each eye
// and reads as shimmer on a lenticular panel.

import * as THREE from 'three';

export const ROOM = { minX: -3, maxX: 3, minZ: -2.5, maxZ: 2.5, height: 2.7 };
const WALL_T = 0.15;
const WIN = { x0: -0.35, x1: 1.55, y0: 0.85, y1: 2.25 };   // window opening in the north wall

// ---- deterministic randomness ----------------------------------------------------------------
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- canvas textures -------------------------------------------------------------------------
function canvasTex(size, draw, { repeat = [1, 1], aniso = 8 } = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = aniso;
  return t;
}

function floorTexture(aniso) {
  const r = rng(7);
  // 8 planks across the tile; the tile spans 1.28 m, so a plank is 16 cm wide.
  return canvasTex(1024, (g, s) => {
    const rows = 8, h = s / rows;
    for (let i = 0; i < rows; i++) {
      let x = -r() * s;
      while (x < s) {
        const len = s * (0.45 + r() * 0.5);
        const base = [126 + r() * 30, 84 + r() * 20, 52 + r() * 14];
        g.fillStyle = `rgb(${base[0] | 0},${base[1] | 0},${base[2] | 0})`;
        g.fillRect(x, i * h, len, h);
        // soft grain: a few low-contrast long strokes
        g.globalAlpha = 0.10;
        for (let k = 0; k < 9; k++) {
          g.strokeStyle = r() < 0.5 ? '#3b2414' : '#e2b98a';
          g.lineWidth = 1 + r() * 2.5;
          g.beginPath();
          const y = i * h + 4 + r() * (h - 8);
          g.moveTo(x, y);
          g.bezierCurveTo(x + len * 0.3, y + (r() - 0.5) * 10, x + len * 0.7, y + (r() - 0.5) * 10, x + len, y);
          g.stroke();
        }
        g.globalAlpha = 1;
        g.fillStyle = 'rgba(40,24,12,0.55)';
        g.fillRect(x, i * h, 2, h);           // butt joint
        x += len;
      }
      g.fillStyle = 'rgba(40,24,12,0.6)';
      g.fillRect(0, i * h, s, 2);             // long seam
    }
  }, { repeat: [6 / 1.28, 5 / 1.28], aniso });
}

function plasterTexture(aniso, tint) {
  const r = rng(11);
  return canvasTex(256, (g, s) => {
    g.fillStyle = tint;
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.035)' : 'rgba(255,255,255,0.05)';
      const w = 2 + r() * 6;
      g.fillRect(r() * s, r() * s, w, w);
    }
  }, { repeat: [4, 2], aniso });
}

function rugTexture(aniso) {
  return canvasTex(512, (g, s) => {
    g.fillStyle = '#7d2f2a'; g.fillRect(0, 0, s, s);
    g.strokeStyle = '#d8c39a'; g.lineWidth = 14; g.strokeRect(26, 26, s - 52, s - 52);
    g.strokeStyle = '#2f3b52'; g.lineWidth = 10; g.strokeRect(52, 52, s - 104, s - 104);
    g.fillStyle = '#d8c39a';
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
      const cx = 110 + i * 73, cy = 110 + j * 73;
      g.save(); g.translate(cx, cy); g.rotate(Math.PI / 4);
      g.fillRect(-13, -13, 26, 26);
      g.restore();
    }
    g.fillStyle = '#2f3b52';
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) g.fillRect(104 + i * 73, 104 + j * 73, 12, 12);
  }, { aniso });
}

function paintingTexture() {
  return canvasTex(512, (g, s) => {
    const sky = g.createLinearGradient(0, 0, 0, s);
    sky.addColorStop(0, '#f0b071'); sky.addColorStop(0.55, '#e9d3a6'); sky.addColorStop(0.56, '#5c7a6b');
    sky.addColorStop(1, '#2d4038');
    g.fillStyle = sky; g.fillRect(0, 0, s, s);
    g.fillStyle = '#f6e7c4'; g.beginPath(); g.arc(s * 0.68, s * 0.42, s * 0.08, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#3d5248';
    g.beginPath(); g.moveTo(0, s * 0.6); g.lineTo(s * 0.3, s * 0.38); g.lineTo(s * 0.55, s * 0.58); g.lineTo(s, s * 0.5);
    g.lineTo(s, s); g.lineTo(0, s); g.fill();
  }, { aniso: 4 });
}

// ---- helpers ---------------------------------------------------------------------------------
function box(w, h, d, mat, x, y, z, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = cast; m.receiveShadow = receive;
  return m;
}
function cyl(rt, rb, h, mat, x, y, z, seg = 24, opts = {}) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg, 1, !!opts.open), mat);
  m.position.set(x, y, z);
  m.castShadow = opts.cast !== false; m.receiveShadow = true;
  return m;
}

// ---- the room --------------------------------------------------------------------------------
export function buildRoom(renderer) {
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xbcd3ea);

  /** Axis-aligned XZ footprints the walker collides with: {minX,maxX,minZ,maxZ}. */
  const colliders = [];
  /** Meshes the depth limiter raycasts against (no glass, no sky-only clutter). */
  const depthTargets = [];
  const add = (obj, { depth = true } = {}) => {
    scene.add(obj);
    if (depth) obj.traverse((o) => { if (o.isMesh) depthTargets.push(o); });
    return obj;
  };
  const footprint = (minX, maxX, minZ, maxZ) => colliders.push({ minX, maxX, minZ, maxZ });

  // Materials
  const wood = new THREE.MeshStandardMaterial({ color: 0x8b5a3a, roughness: 0.55, metalness: 0.0 });
  const darkWood = new THREE.MeshStandardMaterial({ color: 0x4e3424, roughness: 0.6 });
  const paint = new THREE.MeshStandardMaterial({ color: 0xf2efe9, roughness: 0.6 });
  const wallMat = new THREE.MeshStandardMaterial({ map: plasterTexture(aniso, '#e6dccb'), roughness: 0.95 });
  const accentWallMat = new THREE.MeshStandardMaterial({ map: plasterTexture(aniso, '#9fb2a4'), roughness: 0.95 });
  const ceilMat = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 1.0 });
  const floorMat = new THREE.MeshStandardMaterial({ map: floorTexture(aniso), roughness: 0.62 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x2b2b2e, roughness: 0.35, metalness: 0.8 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xb08d57, roughness: 0.3, metalness: 0.9 });
  const fabric = new THREE.MeshStandardMaterial({ color: 0x3f5d74, roughness: 0.9 });

  const { minX, maxX, minZ, maxZ, height: H } = ROOM;
  const W = maxX - minX, D = maxZ - minZ;

  // Floor, ceiling
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), floorMat);
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
  add(floor);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), ceilMat);
  ceil.rotation.x = Math.PI / 2; ceil.position.y = H;
  add(ceil);

  // Walls (boxes, so the outside is closed and the sun only enters through the window)
  const half = WALL_T / 2;
  add(box(WALL_T, H, D + WALL_T * 2, accentWallMat, minX - half, H / 2, 0));            // west
  add(box(WALL_T, H, D + WALL_T * 2, wallMat, maxX + half, H / 2, 0));                  // east
  add(box(W, H, WALL_T, wallMat, 0, H / 2, maxZ + half));                               // south
  // north wall, built around the window opening
  const nz = minZ - half;
  add(box(WIN.x0 - minX, H, WALL_T, wallMat, (minX + WIN.x0) / 2, H / 2, nz));
  add(box(maxX - WIN.x1, H, WALL_T, wallMat, (WIN.x1 + maxX) / 2, H / 2, nz));
  add(box(WIN.x1 - WIN.x0, WIN.y0, WALL_T, wallMat, (WIN.x0 + WIN.x1) / 2, WIN.y0 / 2, nz));
  add(box(WIN.x1 - WIN.x0, H - WIN.y1, WALL_T, wallMat, (WIN.x0 + WIN.x1) / 2, (WIN.y1 + H) / 2, nz));

  // Baseboards
  const bb = 0.1, bt = 0.02;
  add(box(W, bb, bt, paint, 0, bb / 2, maxZ - bt / 2));
  add(box(W, bb, bt, paint, 0, bb / 2, minZ + bt / 2));
  add(box(bt, bb, D, paint, minX + bt / 2, bb / 2, 0));
  add(box(bt, bb, D, paint, maxX - bt / 2, bb / 2, 0));

  // Window: frame, mullions, sill, glass
  const wcx = (WIN.x0 + WIN.x1) / 2, wcy = (WIN.y0 + WIN.y1) / 2;
  const ww = WIN.x1 - WIN.x0, wh = WIN.y1 - WIN.y0, fr = 0.06;
  const win = new THREE.Group();
  win.add(box(ww + fr * 2, fr, WALL_T + 0.02, paint, wcx, WIN.y1 + fr / 2, nz));
  win.add(box(ww + fr * 2, fr, WALL_T + 0.02, paint, wcx, WIN.y0 - fr / 2, nz));
  win.add(box(fr, wh, WALL_T + 0.02, paint, WIN.x0 - fr / 2, wcy, nz));
  win.add(box(fr, wh, WALL_T + 0.02, paint, WIN.x1 + fr / 2, wcy, nz));
  win.add(box(0.04, wh, 0.05, paint, wcx, wcy, nz));          // vertical mullion
  win.add(box(ww, 0.04, 0.05, paint, wcx, wcy + 0.15, nz));   // transom
  win.add(box(ww + 0.3, 0.035, 0.24, paint, wcx, WIN.y0 - 0.02, minZ + 0.06)); // sill
  add(win);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(ww, wh),
    new THREE.MeshStandardMaterial({ color: 0xcfe6ff, roughness: 0.05, metalness: 0.0, transparent: true, opacity: 0.12, depthWrite: false }));
  glass.position.set(wcx, wcy, nz - 0.01);
  add(glass, { depth: false });

  // Outside: sky dome, lawn, a few trees. Kept within ~25 m so the far end of the depth range is
  // bounded (the depth limiter sees it through the window).
  const skyGeo = new THREE.SphereGeometry(30, 32, 16);
  const skyCol = [];
  const pos = skyGeo.attributes.position;
  const top = new THREE.Color(0x6fa3d8), hor = new THREE.Color(0xdfeaf2), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = Math.max(0, pos.getY(i) / 30);
    c.copy(hor).lerp(top, Math.pow(t, 0.6));
    skyCol.push(c.r, c.g, c.b);
  }
  skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(skyCol, 3));
  add(new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false })));
  const lawn = new THREE.Mesh(new THREE.CircleGeometry(30, 32),
    new THREE.MeshStandardMaterial({ color: 0x6f8f4e, roughness: 1 }));
  lawn.rotation.x = -Math.PI / 2; lawn.position.y = -0.02; lawn.receiveShadow = true;
  add(lawn);
  const leaf = new THREE.MeshStandardMaterial({ color: 0x4f7a3a, roughness: 0.9 });
  const leaf2 = new THREE.MeshStandardMaterial({ color: 0x3e6a34, roughness: 0.9 });
  const bark = new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 1 });
  const r = rng(3);
  [[-2.5, -8], [1.5, -10.5], [4.5, -7.5], [-6, -12], [7, -13], [-1, -15], [3, -18]].forEach(([x, z]) => {
    const s = 0.8 + r() * 0.6;
    const t = new THREE.Group();
    t.add(cyl(0.12 * s, 0.16 * s, 1.6 * s, bark, 0, 0.8 * s, 0, 10));
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.3 * s, 1), r() < 0.5 ? leaf : leaf2);
    crown.position.y = 2.4 * s; crown.castShadow = true;
    t.add(crown);
    t.position.set(x, 0, z);
    add(t);
  });
  // a low hedge just outside, so the window's lower half has a near-ish layer
  add(box(5, 0.8, 0.6, leaf2, 0.6, 0.4, -4.2));

  // Rug
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.9),
    new THREE.MeshStandardMaterial({ map: rugTexture(aniso), roughness: 1 }));
  rug.rotation.x = -Math.PI / 2; rug.position.set(0.3, 0.004, 0.25); rug.receiveShadow = true;
  add(rug);

  // Table (long axis along x)
  const T = { x: 0.3, z: 0.25, w: 1.6, d: 0.9, h: 0.76 };
  const table = new THREE.Group();
  table.add(box(T.w, 0.05, T.d, wood, 0, T.h - 0.025, 0));
  table.add(box(T.w - 0.16, 0.08, T.d - 0.16, darkWood, 0, T.h - 0.09, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    table.add(box(0.06, T.h - 0.05, 0.06, darkWood, sx * (T.w / 2 - 0.1), (T.h - 0.05) / 2, sz * (T.d / 2 - 0.1)));
  }
  // things on the table: a bowl of fruit, a vase, a book
  table.add(cyl(0.16, 0.09, 0.08, new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.4 }), -0.25, T.h + 0.04, 0.05));
  const fruitCols = [0xd0412f, 0xe7a23a, 0x9bbf3c, 0xd0412f];
  fruitCols.forEach((col, i) => {
    const f = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 12), new THREE.MeshStandardMaterial({ color: col, roughness: 0.45 }));
    const a = i * 1.7;
    f.position.set(-0.25 + Math.cos(a) * 0.06, T.h + 0.1, 0.05 + Math.sin(a) * 0.06);
    f.castShadow = true;
    table.add(f);
  });
  const vase = cyl(0.04, 0.06, 0.26, new THREE.MeshStandardMaterial({ color: 0x2f5f7a, roughness: 0.2 }), 0.4, T.h + 0.13, -0.15, 20);
  table.add(vase);
  for (let i = 0; i < 3; i++) {
    const st = cyl(0.004, 0.004, 0.3, leaf, 0.4 + (i - 1) * 0.02, T.h + 0.38, -0.15 + (i - 1) * 0.015, 6);
    st.rotation.z = (i - 1) * 0.25;
    table.add(st);
    const bloom = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), new THREE.MeshStandardMaterial({ color: 0xf0d24a, roughness: 0.7 }));
    bloom.position.set(0.4 + (i - 1) * 0.06, T.h + 0.53, -0.15 + (i - 1) * 0.015);
    table.add(bloom);
  }
  table.add(box(0.22, 0.035, 0.16, new THREE.MeshStandardMaterial({ color: 0x8e2d36, roughness: 0.7 }), 0.05, T.h + 0.018, 0.22));
  table.position.set(T.x, 0, T.z);
  add(table);
  footprint(T.x - T.w / 2, T.x + T.w / 2, T.z - T.d / 2, T.z + T.d / 2);

  // Chairs: two on each long side, facing the table
  function chair() {
    const g = new THREE.Group();
    const seatH = 0.46;
    g.add(box(0.44, 0.045, 0.44, wood, 0, seatH, 0));
    g.add(box(0.4, 0.03, 0.4, fabric, 0, seatH + 0.035, 0.01));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      g.add(box(0.035, seatH, 0.035, darkWood, sx * 0.19, seatH / 2, sz * 0.19));
    }
    // back (toward +z in chair space), two posts + three slats
    for (const sx of [-1, 1]) g.add(box(0.035, 0.48, 0.035, darkWood, sx * 0.19, seatH + 0.24, 0.19));
    for (let i = 0; i < 3; i++) g.add(box(0.36, 0.05, 0.02, wood, 0, seatH + 0.17 + i * 0.12, 0.2));
    return g;
  }
  const chairSpots = [
    [T.x - 0.4, T.z - 0.68, 0, 0.06], [T.x + 0.42, T.z - 0.72, 0, -0.1],
    [T.x - 0.38, T.z + 0.7, Math.PI, -0.08], [T.x + 0.45, T.z + 0.66, Math.PI, 0.12],
  ];
  for (const [x, z, rot, jitter] of chairSpots) {
    const ch = chair();
    ch.position.set(x, 0, z);
    // chair space +z is the back, so rot 0 = back toward -z (north side) facing the table at +z
    ch.rotation.y = rot + Math.PI + jitter;
    add(ch);
    footprint(x - 0.24, x + 0.24, z - 0.24, z + 0.24);
  }

  // Floor lamp, north-west corner
  const L = { x: -2.45, z: -1.95 };
  const lamp = new THREE.Group();
  lamp.add(cyl(0.16, 0.18, 0.03, metal, 0, 0.015, 0, 32));
  // the pole stops below the light: a light inside its back faces would be shadowed by them
  lamp.add(cyl(0.012, 0.012, 1.38, brass, 0, 0.72, 0, 12));
  const shadeMat = new THREE.MeshStandardMaterial({ color: 0xf3e3c3, emissive: 0xffd9a0, emissiveIntensity: 0.9, roughness: 0.9, side: THREE.DoubleSide });
  const shade = cyl(0.14, 0.22, 0.28, shadeMat, 0, 1.58, 0, 32, { open: true, cast: false });
  lamp.add(shade);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.04, 16, 12), new THREE.MeshBasicMaterial({ color: 0xfff1d6 }));
  bulb.position.y = 1.52;
  lamp.add(bulb);
  lamp.position.set(L.x, 0, L.z);
  add(lamp);
  footprint(L.x - 0.2, L.x + 0.2, L.z - 0.2, L.z + 0.2);
  const lampLight = new THREE.PointLight(0xffc98a, 6, 0, 2);
  lampLight.position.set(L.x, 1.52, L.z);
  lampLight.castShadow = true;
  lampLight.shadow.mapSize.set(1024, 1024);
  lampLight.shadow.bias = -0.002;
  lampLight.shadow.radius = 3;
  scene.add(lampLight);

  // Armchair next to the lamp
  const arm = new THREE.Group();
  const armFab = new THREE.MeshStandardMaterial({ color: 0x9a6b43, roughness: 0.85 });
  arm.add(box(0.8, 0.4, 0.8, armFab, 0, 0.25, 0));
  arm.add(box(0.8, 0.5, 0.18, armFab, 0, 0.65, 0.31));
  for (const sx of [-1, 1]) arm.add(box(0.14, 0.25, 0.8, armFab, sx * 0.33, 0.55, 0));
  arm.add(box(0.6, 0.1, 0.6, new THREE.MeshStandardMaterial({ color: 0xb98a5e, roughness: 0.9 }), 0, 0.5, -0.05));
  arm.position.set(-2.4, 0, -1.0);
  arm.rotation.y = Math.PI / 2 + Math.PI - 0.5;
  add(arm);
  footprint(-2.9, -1.9, -1.5, -0.5);

  // Bookshelf on the west wall
  const shelf = new THREE.Group();
  const S = { w: 1.2, h: 1.9, d: 0.32 };
  shelf.add(box(S.w, 0.03, S.d, darkWood, 0, S.h, 0));
  for (const sx of [-1, 1]) shelf.add(box(0.03, S.h, S.d, darkWood, sx * (S.w / 2 - 0.015), S.h / 2, 0));
  shelf.add(box(S.w, S.h, 0.015, darkWood, 0, S.h / 2, -S.d / 2 + 0.008));
  const bookCols = [0x7a2e2e, 0x2e4a7a, 0xc9a24b, 0x3d6b4f, 0xd8d0c0, 0x5b3a6e, 0x1f1f24, 0xb5562f];
  const rb = rng(21);
  for (let level = 0; level < 5; level++) {
    const y = 0.06 + level * 0.38;
    shelf.add(box(S.w - 0.04, 0.025, S.d - 0.02, darkWood, 0, y, 0.005));
    if (level === 4) continue;
    let x = -S.w / 2 + 0.05;
    while (x < S.w / 2 - 0.1) {
      const bw = 0.025 + rb() * 0.035, bh = 0.2 + rb() * 0.1, bd = 0.18 + rb() * 0.06;
      if (rb() < 0.08) { x += 0.08; continue; }
      const b = box(bw, bh, bd, new THREE.MeshStandardMaterial({ color: bookCols[(rb() * bookCols.length) | 0], roughness: 0.8 }),
        x + bw / 2, y + 0.0125 + bh / 2, 0.02);
      if (rb() < 0.1) b.rotation.z = 0.12;
      shelf.add(b);
      x += bw + 0.004;
    }
  }
  shelf.position.set(minX + S.d / 2 + 0.01, 0, 0.6);
  shelf.rotation.y = Math.PI / 2;
  add(shelf);
  footprint(minX, minX + S.d + 0.02, 0.6 - S.w / 2, 0.6 + S.w / 2);

  // Sideboard + picture on the east wall
  const sb = new THREE.Group();
  sb.add(box(1.4, 0.75, 0.45, wood, 0, 0.375 + 0.08, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) sb.add(box(0.04, 0.08, 0.04, darkWood, sx * 0.64, 0.04, sz * 0.18));
  for (let i = 0; i < 3; i++) {
    sb.add(box(0.44, 0.6, 0.01, darkWood, -0.46 + i * 0.46, 0.46, 0.226));
    sb.add(box(0.1, 0.015, 0.02, brass, -0.46 + i * 0.46, 0.68, 0.24));
  }
  // a small table lamp on the sideboard (unlit accent)
  sb.add(cyl(0.05, 0.07, 0.25, new THREE.MeshStandardMaterial({ color: 0xc5b8a2, roughness: 0.5 }), 0.45, 0.955, 0, 20));
  sb.add(cyl(0.1, 0.14, 0.18, shadeMat, 0.45, 1.16, 0, 24, { open: true, cast: false }));
  sb.position.set(maxX - 0.24, 0, 1.0);
  sb.rotation.y = -Math.PI / 2;
  add(sb);
  footprint(maxX - 0.48, maxX, 0.3, 1.7);
  const pic = new THREE.Group();
  pic.add(box(1.0, 0.72, 0.04, darkWood, 0, 0, 0));
  const canvasMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.88, 0.6),
    new THREE.MeshStandardMaterial({ map: paintingTexture(), roughness: 0.8 }));
  canvasMesh.position.z = 0.021;
  pic.add(canvasMesh);
  pic.position.set(maxX - 0.02, 1.65, 1.0);
  pic.rotation.y = -Math.PI / 2;
  add(pic);

  // Plant, north-east corner
  const plant = new THREE.Group();
  plant.add(cyl(0.2, 0.15, 0.4, new THREE.MeshStandardMaterial({ color: 0xb4583a, roughness: 0.8 }), 0, 0.2, 0, 24));
  const rp = rng(5);
  for (let i = 0; i < 14; i++) {
    const l = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.55 + rp() * 0.3, 6), rp() < 0.5 ? leaf : leaf2);
    const a = rp() * Math.PI * 2, tilt = 0.25 + rp() * 0.5;
    l.position.set(Math.cos(a) * 0.08, 0.6 + rp() * 0.15, Math.sin(a) * 0.08);
    l.rotation.set(Math.sin(a) * tilt, 0, -Math.cos(a) * tilt);
    l.castShadow = true;
    plant.add(l);
  }
  plant.position.set(2.5, 0, -2.0);
  add(plant);
  footprint(2.28, 2.72, -2.22, -1.78);

  // Door on the south wall (inset panel + frame + handle), for orientation
  const door = new THREE.Group();
  door.add(box(0.9, 2.05, 0.04, new THREE.MeshStandardMaterial({ color: 0xe8e1d4, roughness: 0.55 }), 0, 1.025, 0));
  door.add(box(1.04, 0.07, 0.06, paint, 0, 2.085, 0.01));
  for (const sx of [-1, 1]) door.add(box(0.07, 2.12, 0.06, paint, sx * 0.485, 1.06, 0.01));
  for (const y of [0.55, 1.45]) door.add(box(0.62, 0.6, 0.012, paint, 0, y, -0.025));
  door.add(cyl(0.025, 0.025, 0.06, brass, 0.33, 1.0, -0.04, 12));
  door.position.set(-1.7, 0, maxZ - 0.02);
  add(door);

  // Ceiling light fitting (decor)
  add(cyl(0.18, 0.18, 0.03, paint, T.x, H - 0.015, T.z, 32));

  // ---- lights --------------------------------------------------------------------------------
  scene.add(new THREE.HemisphereLight(0xe6eefc, 0x8a6f55, 0.65));
  // Sun through the window: casts the window's light patch across the floor.
  const sun = new THREE.DirectionalLight(0xfff0d8, 3.2);
  sun.position.set(-3.5, 7.5, -10);
  sun.target.position.set(0.8, 0, 0.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 1, far: 30 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  // Soft daylight bounce from the window side (no shadow)
  const fill = new THREE.PointLight(0xdbe8ff, 2.2, 0, 2);
  fill.position.set(wcx, 1.7, minZ + 0.7);
  scene.add(fill);

  return { scene, colliders, depthTargets };
}
