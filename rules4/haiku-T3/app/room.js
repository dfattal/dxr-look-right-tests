// The room: floor, four walls with a window, a table, two chairs, a floor lamp and a painting.
//
// Authored in metres at real scale. The camera rig is absolute about metres (metersToVirtual
// stays 1), so nothing here is scaled to make it look deeper. Every surface is a closed box or a
// double-sided plane, and the palette stays in mid tones: pure black or pure white next to each
// other is what doubles first through the panel's crosstalk correction (making-3d-look-right, rule 3).

// Inside faces of the walls, x ∈ [-halfW, halfW], z ∈ [-halfD, halfD], floor at y = 0, ceiling at height.
export const ROOM = { halfW: 2.2, halfD: 2.5, height: 2.7 };

// The window opening in the back wall (z = -halfD). Metres.
const WIN = { x0: -0.8, x1: 0.8, y0: 0.9, y1: 2.1 };

// Canvas-generated textures, so the page needs no image files.
function canvasTexture(THREE, w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function floorTexture(THREE) {
  // Planks running along x, a little tone variation from plank to plank.
  const tones = ['#8d6a4b', '#96734f', '#876446', '#9b7956', '#8f6c4a'];
  return canvasTexture(THREE, 1024, 1024, (g, w, h) => {
    const n = 22;
    const ph = h / n;
    for (let i = 0; i < n; i++) {
      g.fillStyle = tones[(i * 3) % tones.length];
      g.fillRect(0, i * ph, w, ph);
      g.fillStyle = 'rgba(40, 25, 15, 0.45)';
      g.fillRect(0, i * ph, w, 2);
      g.strokeStyle = 'rgba(60, 40, 25, 0.14)';
      g.lineWidth = 1;
      for (let k = 0; k < 5; k++) {
        const y = i * ph + ((k * 37 + i * 11) % 19) + 4;
        g.beginPath();
        g.moveTo(0, y);
        g.bezierCurveTo(w * 0.3, y + 3, w * 0.6, y - 3, w, y + 1);
        g.stroke();
      }
    }
  });
}

function skyTexture(THREE) {
  // A soft daytime sky with two muted hill bands. Light, but nowhere near white.
  return canvasTexture(THREE, 512, 512, (g, w, h) => {
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#8fb4cc');
    sky.addColorStop(1, '#d6e4ec');
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);
    const band = (base, amp, colour) => {
      g.fillStyle = colour;
      g.beginPath();
      g.moveTo(0, h);
      for (let x = 0; x <= w; x += 8) {
        g.lineTo(x, h * base + Math.sin(x * 0.021) * h * amp + Math.sin(x * 0.067) * h * amp * 0.4);
      }
      g.lineTo(w, h);
      g.closePath();
      g.fill();
    };
    band(0.74, 0.035, '#a3b8a6');
    band(0.84, 0.025, '#7f9a86');
  });
}

function paintingTexture(THREE) {
  // A calm abstract: three soft horizontal fields.
  return canvasTexture(THREE, 256, 192, (g, w, h) => {
    g.fillStyle = '#9aa9a0';
    g.fillRect(0, 0, w, h * 0.45);
    g.fillStyle = '#c4b59a';
    g.fillRect(0, h * 0.45, w, h * 0.3);
    g.fillStyle = '#6f7f7a';
    g.fillRect(0, h * 0.75, w, h * 0.25);
    g.fillStyle = '#d9a46b';
    g.beginPath();
    g.arc(w * 0.66, h * 0.38, h * 0.16, 0, Math.PI * 2);
    g.fill();
  });
}

// Returns { root, colliders }. `root` goes into the scene; `colliders` are footprints (x/z AABBs,
// metres) the walker may not enter, so the room is walked around, not through.
export function buildRoom(THREE) {
  const root = new THREE.Group();
  const colliders = [];

  const wallMat = new THREE.MeshStandardMaterial({ color: 0xcdc6b9, roughness: 0.95 });
  const ceilingMat = new THREE.MeshStandardMaterial({ color: 0xe4e0d8, roughness: 1 });
  const floorMat = new THREE.MeshStandardMaterial({ map: floorTexture(THREE), roughness: 0.75 });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x7a5636, roughness: 0.7 });
  const fabricMat = new THREE.MeshStandardMaterial({ color: 0x6f8078, roughness: 0.9 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0xe9e5dc, roughness: 0.6 });
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x4a4a52, metalness: 0.6, roughness: 0.4 });
  const shadeMat = new THREE.MeshStandardMaterial({
    color: 0xf2e6cf, emissive: 0xffd9a0, emissiveIntensity: 0.35, roughness: 0.9, side: THREE.DoubleSide,
  });

  const box = (w, h, d, x, y, z, mat) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    root.add(m);
    return m;
  };
  const footprint = (x, z, hx, hz) => colliders.push({ minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz });

  const T = 0.1; // wall thickness
  const { halfW: hw, halfD: hd, height: H } = ROOM;

  // Floor and ceiling.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(2 * hw, 2 * hd), floorMat);
  floor.rotation.x = -Math.PI / 2;
  root.add(floor);
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(2 * hw, 2 * hd), ceilingMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = H;
  root.add(ceiling);

  // Side walls and the front wall (behind the visitor's start).
  box(T, H, 2 * hd + 2 * T, -hw - T / 2, H / 2, 0, wallMat);
  box(T, H, 2 * hd + 2 * T, hw + T / 2, H / 2, 0, wallMat);
  box(2 * hw, H, T, 0, H / 2, hd + T / 2, wallMat);

  // Back wall, with the window opening cut out of it.
  const zb = -hd - T / 2;
  box(2 * hw, WIN.y0, T, 0, WIN.y0 / 2, zb, wallMat);
  box(2 * hw, H - WIN.y1, T, 0, (H + WIN.y1) / 2, zb, wallMat);
  box(WIN.x0 + hw, WIN.y1 - WIN.y0, T, (-hw + WIN.x0) / 2, (WIN.y0 + WIN.y1) / 2, zb, wallMat);
  box(hw - WIN.x1, WIN.y1 - WIN.y0, T, (WIN.x1 + hw) / 2, (WIN.y0 + WIN.y1) / 2, zb, wallMat);

  // Window: the sky sits in the opening, the trim sits on the room side of the wall.
  const zGlass = -hd - 0.02;
  const sky = new THREE.Mesh(
    new THREE.PlaneGeometry(WIN.x1 - WIN.x0, WIN.y1 - WIN.y0),
    new THREE.MeshBasicMaterial({ map: skyTexture(THREE) }),
  );
  sky.position.set(0, (WIN.y0 + WIN.y1) / 2, zGlass);
  root.add(sky);
  const zTrim = -hd + 0.03;
  box(WIN.x1 - WIN.x0 + 0.12, 0.06, 0.06, 0, WIN.y1 + 0.03, zTrim, trimMat);
  box(0.06, WIN.y1 - WIN.y0 + 0.06, 0.06, WIN.x0 - 0.03, (WIN.y0 + WIN.y1) / 2, zTrim, trimMat);
  box(0.06, WIN.y1 - WIN.y0 + 0.06, 0.06, WIN.x1 + 0.03, (WIN.y0 + WIN.y1) / 2, zTrim, trimMat);
  box(WIN.x1 - WIN.x0 + 0.2, 0.04, 0.2, 0, WIN.y0, -hd + 0.1, trimMat);

  // A small painting on the right-hand wall.
  const paintZ = 0.6;
  box(0.03, 0.7, 0.9, hw - 0.015, 1.5, paintZ, trimMat);
  const painting = new THREE.Mesh(
    new THREE.PlaneGeometry(0.8, 0.6),
    new THREE.MeshStandardMaterial({ map: paintingTexture(THREE), roughness: 0.9 }),
  );
  painting.rotation.y = -Math.PI / 2;
  painting.position.set(hw - 0.035, 1.5, paintZ);
  root.add(painting);

  // Table, centred at (0.3, -0.5). Top 1.2 × 0.7 m at 0.74 m.
  const tx = 0.3;
  const tz = -0.5;
  box(1.2, 0.04, 0.7, tx, 0.74, tz, woodMat);
  for (const dx of [-0.52, 0.52]) {
    for (const dz of [-0.27, 0.27]) {
      box(0.05, 0.72, 0.05, tx + dx, 0.36, tz + dz, woodMat);
    }
  }
  footprint(tx, tz, 0.6, 0.35);

  // Chair: seat at 0.46 m, back on the side given by `facing` (+1 = toward +z, −1 = toward −z).
  const chair = (cx, cz, facing) => {
    box(0.46, 0.04, 0.46, cx, 0.46, cz, fabricMat);
    for (const dx of [-0.2, 0.2]) {
      for (const dz of [-0.2, 0.2]) {
        box(0.04, 0.44, 0.04, cx + dx, 0.22, cz + dz, woodMat);
      }
    }
    box(0.46, 0.5, 0.04, cx, 0.71, cz + facing * 0.21, woodMat);
    footprint(cx, cz, 0.25, 0.25);
  };
  chair(0.3, 0.15, +1);   // south of the table, its back toward the visitor
  chair(0.3, -1.2, -1);   // north of the table, its back toward the window

  // Floor lamp in the back-left corner.
  const lx = -1.7;
  const lz = -1.9;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.03, 32), metalMat);
  base.position.set(lx, 0.015, lz);
  root.add(base);
  box(0.03, 1.45, 0.03, lx, 0.75, lz, metalMat);
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.24, 0.32, 32, 1, true), shadeMat);
  shade.position.set(lx, 1.5, lz);
  root.add(shade);
  footprint(lx, lz, 0.2, 0.2);

  // Lights: a sky-and-floor hemisphere for the room, a warm sun through the window, and the lamp.
  root.add(new THREE.HemisphereLight(0xeaf1f7, 0x5b4c3e, 1.3));
  const sun = new THREE.DirectionalLight(0xfff3dd, 1.2);
  sun.position.set(0.8, 2.6, -3.0);
  root.add(sun);
  const lamp = new THREE.PointLight(0xffd9a0, 4, 0, 2);
  lamp.position.set(lx, 1.45, lz);
  root.add(lamp);

  return { root, colliders };
}
