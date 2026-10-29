// World: sky, fog, rolling hills, distant peaks, the plane and the hoops. Metres throughout.
//
// The hills are a pure function of world x/z (groundHeight), so the terrain can be rebuilt around
// the plane at any time and every rebuild agrees with the last one: no seam, no pop.

import { RING_RADIUS } from './game.js';

// The horizon colour is the fog colour and the clear colour, so the far world dissolves into the
// sky instead of ending at an edge. Not black anywhere: a bright subject on black doubles first.
export const SKY_HORIZON = 0xc6dbec;
const SKY_ZENITH = 0x3f72ad;
const SKY_RADIUS = 3500;          // inside the session far plane (4000 m)
const PEAK_RADIUS = 2600;         // the distant mountain ring
const PLATE_RADIUS = 3600;        // ground under the terrain's edge, fully fogged
const TERRAIN_SIZE = 2400;        // m
const TERRAIN_CELLS = 200;        // 12 m cells
const CELL = TERRAIN_SIZE / TERRAIN_CELLS;
const REBUILD_DISTANCE = 300;     // m the plane may drift from the terrain centre before a rebuild

const GOLD = 0xffb43c;
const HOOP_HIT = 0x6fe08f;
const HOOP_MISSED = 0x8a93a0;

// ---- procedural height -------------------------------------------------------------------------

function hash(ix, iz, seed) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

// Smooth 2D value noise in [0, 1].
function valueNoise(x, z, seed) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz, seed), b = hash(ix + 1, iz, seed);
  const c = hash(ix, iz + 1, seed), d = hash(ix + 1, iz + 1, seed);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

function fbm(x, z, octaves, seed) {
  let sum = 0, amp = 0.5, total = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x, z, seed + o);
    total += amp;
    x *= 2;
    z *= 2;
    amp *= 0.5;
  }
  return sum / total;
}

/** Terrain height in metres. Always positive, so the ground plate at y = 0 never shows through. */
export function groundHeight(x, z) {
  const broad = fbm(x / 700, z / 700, 2, 11);   // rolling hills, a few hundred metres across
  const hills = fbm(x / 170, z / 170, 2, 23);   // smaller undulations
  return 3 + 60 * broad * broad + 16 * hills;
}

function smooth(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// ---- the world ----------------------------------------------------------------------------------

export function createWorld(THREE, game) {
  const scene = new THREE.Scene();
  // Fog is the depth cue for distance: far contrast fades into the horizon colour.
  scene.fog = new THREE.Fog(SKY_HORIZON, 120, 3200);

  scene.add(new THREE.HemisphereLight(0xdbeaf7, 0x3d4a2e, 1.0));
  const sun = new THREE.DirectionalLight(0xfff1dc, 1.6);
  sun.position.set(-400, 700, 250);
  scene.add(sun);

  // Sky: a gradient dome, drawn first and never written to depth.
  const skyGeo = new THREE.SphereGeometry(SKY_RADIUS, 32, 16);
  const skyPos = skyGeo.attributes.position;
  const horizon = new THREE.Color(SKY_HORIZON), zenith = new THREE.Color(SKY_ZENITH);
  const skyCol = new THREE.Color();
  const skyColors = new Float32Array(skyPos.count * 3);
  for (let i = 0; i < skyPos.count; i++) {
    const t = Math.max(0, skyPos.getY(i) / SKY_RADIUS);
    skyCol.copy(horizon).lerp(zenith, Math.pow(t, 0.6));
    skyColors.set([skyCol.r, skyCol.g, skyCol.b], i * 3);
  }
  skyGeo.setAttribute('color', new THREE.BufferAttribute(skyColors, 3));
  const sky = new THREE.Mesh(
    skyGeo,
    new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false }),
  );
  sky.renderOrder = -2;
  scene.add(sky);

  // Ground plate under the terrain's fogged edge, so the edge has nothing hard to show.
  const plate = new THREE.Mesh(
    new THREE.CircleGeometry(PLATE_RADIUS, 48),
    new THREE.MeshLambertMaterial({ color: 0x56664c }),
  );
  plate.rotation.x = -Math.PI / 2;
  scene.add(plate);

  const peaks = buildPeaks(THREE);
  scene.add(peaks);

  // ---- terrain: one grid, rebuilt around the plane when it drifts (heights are world-fixed) ----
  const terrainGeo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_CELLS, TERRAIN_CELLS);
  terrainGeo.rotateX(-Math.PI / 2);
  terrainGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(terrainGeo.attributes.position.count * 3), 3));
  const terrain = new THREE.Mesh(terrainGeo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  terrain.frustumCulled = false;   // the mesh moves in steps; its bounds are not worth tracking
  scene.add(terrain);

  const GRASS = new THREE.Color(0x4f7a3f), DRY = new THREE.Color(0x8c8f52), ROCK = new THREE.Color(0x7d7062);
  const c = new THREE.Color();
  let terrainX = NaN, terrainZ = NaN;

  function rebuildTerrain(cx, cz) {
    const pos = terrainGeo.attributes.position;
    const arr = pos.array;
    for (let i = 0; i < pos.count; i++) {
      arr[i * 3 + 1] = groundHeight(arr[i * 3] + cx, arr[i * 3 + 2] + cz);
    }
    pos.needsUpdate = true;
    terrainGeo.computeVertexNormals();
    const nrm = terrainGeo.attributes.normal.array;
    const col = terrainGeo.attributes.color.array;
    for (let i = 0; i < pos.count; i++) {
      const h = arr[i * 3 + 1], ny = nrm[i * 3 + 1];
      c.copy(GRASS).lerp(DRY, smooth(30, 60, h));
      c.lerp(ROCK, smooth(0.8, 0.6, ny));
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    terrainGeo.attributes.color.needsUpdate = true;
    terrain.position.set(cx, 0, cz);
    terrainX = cx;
    terrainZ = cz;
  }
  const snap = (v) => Math.round(v / CELL) * CELL;
  rebuildTerrain(snap(game.plane.x), snap(game.plane.z));

  // ---- the plane: a simple low-poly model, nose along -z ----
  const plane = new THREE.Group();
  const white = new THREE.MeshLambertMaterial({ color: 0xf2f4f7 });
  const orange = new THREE.MeshLambertMaterial({ color: 0xd9643c });
  const dark = new THREE.MeshLambertMaterial({ color: 0x2b2f36 });
  const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.55, 6.5, 14).rotateX(Math.PI / 2), white);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(9.5, 0.14, 1.6), white);
  wing.position.set(0, 0, -0.6);
  const tailplane = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.12, 1.0), white);
  tailplane.position.set(0, 0.05, 2.8);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.5, 1.1), orange);
  fin.position.set(0, 0.8, 2.9);
  const prop = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.2, 0.08), dark);
  prop.position.set(0, 0, -3.35);
  plane.add(fuselage, wing, tailplane, fin, prop);
  scene.add(plane);

  // ---- hoops ----
  const hoops = game.rings.map(() => {
    const mesh = new THREE.Mesh(
      new THREE.TorusGeometry(RING_RADIUS, 0.6, 12, 56),
      new THREE.MeshLambertMaterial({ color: GOLD, emissive: 0x402800 }),
    );
    mesh.userData.state = 'open';
    scene.add(mesh);
    return mesh;
  });

  const euler = new THREE.Euler();
  const Z = new THREE.Vector3(0, 0, 1);
  const normal = new THREE.Vector3();

  return {
    scene,

    /**
     * Place everything for this frame. `cam` is the app camera's position: the sky, the peaks and
     * the plate follow it so they stay at infinity for both eyes.
     */
    update(dt, cam) {
      const p = game.plane;
      if (Math.abs(p.x - terrainX) > REBUILD_DISTANCE || Math.abs(p.z - terrainZ) > REBUILD_DISTANCE) {
        rebuildTerrain(snap(p.x), snap(p.z));
      }
      sky.position.copy(cam);
      peaks.position.set(cam.x, 0, cam.z);
      plate.position.set(cam.x, 0, cam.z);

      plane.position.set(p.x, p.y, p.z);
      plane.quaternion.setFromEuler(euler.set(p.pitch, p.yaw, p.roll, 'YXZ'));
      prop.rotation.z -= dt * 60;

      for (let i = 0; i < hoops.length; i++) {
        const ring = game.rings[i];
        const mesh = hoops[i];
        mesh.position.set(ring.x, ring.y, ring.z);
        normal.set(ring.nx, ring.ny, ring.nz);
        mesh.quaternion.setFromUnitVectors(Z, normal);
        if (mesh.userData.state !== ring.state) {
          mesh.userData.state = ring.state;
          const colour = ring.state === 'hit' ? HOOP_HIT : ring.state === 'missed' ? HOOP_MISSED : GOLD;
          mesh.material.color.setHex(colour);
        }
      }
    },
  };
}

// A ring of peaks around the horizon. Each is a strip from below the ground plate up to its ridge.
function buildPeaks(THREE) {
  const N = 180;
  const low = new THREE.Color(0x5b6b7d), snow = new THREE.Color(0xd5dde6), c = new THREE.Color();
  const positions = [], colors = [], indices = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    const r = PEAK_RADIUS + (valueNoise(ca * 3 + 5, sa * 3 + 5, 61) - 0.5) * 240;
    const top = 30 + 420 * Math.pow(fbm(ca * 1.2 + 9, sa * 1.2 + 9, 4, 61), 1.6);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    positions.push(x, -80, z, x, top, z);
    c.copy(low).lerp(snow, Math.min(1, top / 420));
    colors.push(low.r, low.g, low.b, c.r, c.g, c.b);
    const next = ((i + 1) % N) * 2;
    const b = i * 2;
    indices.push(b, next, b + 1, b + 1, next, next + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, fog: true, side: THREE.DoubleSide }));
}
