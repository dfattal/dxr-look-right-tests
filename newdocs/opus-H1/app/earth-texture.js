// earth-texture.js — a procedural equirectangular Earth (no download): coarse continent outlines,
// roughened with seamless 3D noise sampled on the sphere, then coloured by latitude and noise.
// Returns two canvases: colour (sRGB) and roughness (ocean glossier than land).
//
// The fine grain everywhere is deliberate: the eye pairs need surface detail to fuse, a flat
// colour field gives the visual system nothing to match.

// [lon, lat] outlines, deliberately coarse — the noise below supplies the coastline detail.
const LAND = [
  // North America
  [[-166,68],[-156,71],[-140,70],[-128,70],[-115,68],[-95,72],[-82,68],[-80,63],[-94,59],[-90,56],[-82,55],[-78,62],[-66,60],[-62,57],[-56,52],[-60,47],[-66,45],[-70,42],[-74,40],[-76,35],[-81,31],[-80,26],[-82,25],[-84,30],[-90,29],[-97,27],[-97,22],[-92,18],[-87,21],[-88,16],[-84,11],[-80,8],[-78,9],[-83,8],[-86,12],[-92,15],[-98,16],[-106,23],[-112,30],[-110,24],[-115,29],[-117,33],[-121,35],[-124,40],[-124,46],[-125,49],[-131,54],[-138,59],[-147,61],[-153,59],[-158,57],[-164,55],[-158,59],[-165,62]],
  // Canadian Arctic islands
  [[-120,74],[-100,76],[-80,74],[-75,80],[-62,82],[-90,82],[-115,78]],
  // Greenland
  [[-73,78],[-60,82],[-30,83],[-20,80],[-20,72],[-30,68],[-42,60],[-50,62],[-54,67],[-58,75]],
  // South America
  [[-80,9],[-74,11],[-62,10],[-52,5],[-50,0],[-44,-2],[-35,-6],[-39,-14],[-41,-22],[-48,-26],[-53,-34],[-58,-38],[-63,-41],[-65,-46],[-68,-51],[-70,-55],[-74,-52],[-74,-44],[-73,-37],[-71,-30],[-70,-18],[-76,-14],[-81,-6],[-80,-1],[-78,2],[-77,7]],
  // Eurasia
  [[-10,36],[-9,43],[-2,44],[-5,48],[2,51],[5,53],[8,57],[10,54],[14,55],[20,55],[22,60],[25,65],[21,64],[17,61],[18,59],[11,58],[6,58],[5,62],[14,68],[25,71],[40,68],[44,68],[60,70],[70,73],[80,73],[100,78],[115,74],[130,72],[140,72],[160,70],[180,68],[180,65],[175,62],[163,60],[160,54],[156,51],[155,58],[143,59],[137,54],[141,47],[135,43],[129,41],[129,35],[126,35],[126,38],[121,40],[118,38],[121,31],[122,25],[117,23],[108,21],[106,18],[109,12],[105,9],[100,13],[99,8],[104,1],[101,3],[98,8],[98,16],[94,17],[92,22],[87,21],[80,15],[78,8],[73,17],[73,21],[67,25],[60,25],[56,27],[50,30],[48,29],[51,24],[56,26],[60,22],[55,17],[44,12],[42,16],[35,28],[32,31],[35,33],[36,36],[30,36],[26,38],[26,41],[23,40],[22,37],[20,40],[16,38],[12,44],[13,46],[16,41],[18,40],[15,38],[8,44],[3,43],[3,42],[-1,37],[-5,36]],
  // Chukotka across the date line
  [[-180,65],[-180,69],[-172,67],[-170,65]],
  // Africa
  [[-17,21],[-16,28],[-10,30],[-6,36],[10,37],[11,33],[20,31],[30,31],[32,30],[35,28],[43,12],[51,12],[48,5],[40,-3],[40,-11],[35,-20],[33,-26],[28,-33],[20,-35],[18,-32],[12,-18],[13,-10],[9,-1],[9,4],[3,6],[-8,4],[-13,8],[-17,14]],
  [[44,-25],[47,-25],[50,-15],[49,-12],[44,-17]],                                   // Madagascar
  // Australia, New Zealand, Tasmania
  [[114,-22],[114,-34],[118,-35],[124,-33],[131,-31],[138,-35],[141,-38],[146,-39],[150,-37],[153,-31],[153,-25],[146,-19],[142,-11],[136,-12],[136,-15],[131,-12],[126,-14],[122,-18]],
  [[172,-34],[178,-38],[174,-41],[171,-46],[167,-46],[172,-41]],
  [[145,-41],[148,-41],[148,-43],[146,-44]],
  // Japan, UK, Ireland, Iceland
  [[130,31],[132,34],[135,34],[140,35],[141,38],[142,42],[145,44],[141,45],[140,41],[139,38],[136,36],[132,35]],
  [[-5,50],[1,51],[2,53],[-1,55],[-2,57],[-2,59],[-5,58],[-6,56],[-5,54],[-3,53],[-5,52]],
  [[-10,52],[-6,52],[-6,55],[-8,55],[-10,54]],
  [[-24,65],[-14,66],[-14,64],[-22,63]],
  // South-east Asia
  [[95,5],[98,4],[106,-6],[104,-6],[96,2]],
  [[109,1],[117,7],[119,1],[116,-4],[110,-3]],
  [[131,-1],[141,-3],[150,-10],[143,-9],[138,-8]],
  [[105,-6],[114,-7],[114,-9],[106,-7]],
  [[120,18],[122,18],[126,7],[122,7]],
  [[80,10],[82,8],[81,6],[80,7]],                                                     // Sri Lanka
];
const WATER = [                                                                       // inland seas
  [[28,42],[28,46],[34,46],[41,42],[36,41]],                                         // Black Sea
  [[47,46],[53,47],[54,40],[50,37],[47,40]],                                         // Caspian
];

// Seamless 3D value noise (sampled on the unit sphere, so no seam at ±180° and no polar pinch).
function hash(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const l = (a, b, t) => a + (b - a) * t;
  return l(
    l(l(hash(xi, yi, zi), hash(xi + 1, yi, zi), u), l(hash(xi, yi + 1, zi), hash(xi + 1, yi + 1, zi), u), v),
    l(l(hash(xi, yi, zi + 1), hash(xi + 1, yi, zi + 1), u), l(hash(xi, yi + 1, zi + 1), hash(xi + 1, yi + 1, zi + 1), u), v),
    w,
  );
}
function fbm(x, y, z, oct) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += a * noise3(x * f + i * 17, y * f, z * f); n += a; a *= 0.5; f *= 2; }
  return s / n;
}

// Separable box blur, wrapping in longitude, clamped in latitude.
function blur(src, W, H, r) {
  const tmp = new Float32Array(W * H), out = new Float32Array(W * H), n = 2 * r + 1;
  for (let y = 0; y < H; y++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += src[y * W + ((k + W) % W)];
    for (let x = 0; x < W; x++) {
      tmp[y * W + x] = s / n;
      s += src[y * W + ((x + r + 1) % W)] - src[y * W + ((x - r + W) % W)];
    }
  }
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += tmp[Math.min(H - 1, Math.max(0, y + k)) * W + x];
      out[y * W + x] = s / n;
    }
  }
  return out;
}

const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const sstep = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

export function makeEarthCanvases(W = 1024, H = 512) {
  // 1. Rasterise the outlines into a mask.
  const mc = document.createElement('canvas');
  mc.width = W; mc.height = H;
  const g = mc.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  const poly = (pts, col) => {
    g.fillStyle = col; g.beginPath();
    pts.forEach(([lon, lat], i) => {
      const x = ((lon + 180) / 360) * W, y = ((90 - lat) / 180) * H;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    });
    g.closePath(); g.fill();
  };
  LAND.forEach((p) => poly(p, '#fff'));
  WATER.forEach((p) => poly(p, '#000'));
  // Antarctica: a wavy band south of ~-70°.
  const ant = [[-180, -90]];
  for (let lon = -180; lon <= 180; lon += 10) ant.push([lon, -70 + 4 * Math.sin(lon * 0.05) + 2 * Math.sin(lon * 0.17)]);
  ant.push([180, -90]);
  poly(ant, '#fff');
  const px = g.getImageData(0, 0, W, H).data;
  const raw = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) raw[i] = px[i * 4] / 255;
  const soft = blur(raw, W, H, 5);    // coastline band the noise roughens
  const wide = blur(raw, W, H, 14);   // continental shelf (shallow water) and inland distance

  // 2. Colour.
  const cc = document.createElement('canvas'); cc.width = W; cc.height = H;
  const rc = document.createElement('canvas'); rc.width = W; rc.height = H;
  const cg = cc.getContext('2d'), rg = rc.getContext('2d');
  const col = cg.createImageData(W, H), rough = rg.createImageData(W, H);
  const DEEP = [10, 34, 66], SHELF = [28, 92, 128];
  const FOREST = [46, 92, 44], GRASS = [104, 128, 62], DESERT = [196, 164, 108], TUNDRA = [118, 118, 96];
  const ICE = [214, 222, 228];
  for (let y = 0; y < H; y++) {
    const lat = 90 - ((y + 0.5) / H) * 180, la = (lat * Math.PI) / 180;
    for (let x = 0; x < W; x++) {
      const lo = (((x + 0.5) / W) * 360 - 180) * Math.PI / 180;
      const sx = Math.cos(la) * Math.cos(lo), sy = Math.sin(la), sz = Math.cos(la) * Math.sin(lo);
      const i = y * W + x;
      const n = fbm(sx * 6, sy * 6, sz * 6, 5);          // coast + biome noise
      const fine = noise3(sx * 90, sy * 90, sz * 90);    // grain for stereo matching
      const land = soft[i] + (n - 0.5) * 0.55 > 0.5;
      let c, r;
      if (!land) {
        c = mix(DEEP, SHELF, sstep(0.05, 0.5, wide[i] + (n - 0.5) * 0.2));
        c = mix(c, [0, 0, 0], (fine - 0.5) * 0.12);
        r = 0.5;
      } else {
        const alat = Math.abs(lat);
        const arid = sstep(0.25, 0.0, Math.abs(alat - 24) / 30 + (n - 0.5) * 0.6) * sstep(0.45, 0.9, wide[i]);
        c = mix(FOREST, GRASS, sstep(0.35, 0.65, n));
        c = mix(c, DESERT, arid);
        c = mix(c, TUNDRA, sstep(52, 66, alat + (n - 0.5) * 12));
        const lon = lon2deg(lo);
        const greenland = (lat > 60 && lon > -60 && lon < -15) || (lat > 76 && lon > -75 && lon < -15);
        const ice = greenland ? sstep(0.3, 0.7, wide[i]) : sstep(68, 76, alat + (n - 0.5) * 10);
        c = mix(c, ICE, ice);
        c = mix(c, fine > 0.5 ? [255, 255, 255] : [0, 0, 0], Math.abs(fine - 0.5) * 0.22);
        r = 0.95;
      }
      const k = i * 4;
      col.data[k] = c[0]; col.data[k + 1] = c[1]; col.data[k + 2] = c[2]; col.data[k + 3] = 255;
      const rv = Math.round(r * 255);
      rough.data[k] = rough.data[k + 1] = rough.data[k + 2] = rv; rough.data[k + 3] = 255;
    }
  }
  cg.putImageData(col, 0, 0);
  rg.putImageData(rough, 0, 0);
  return { color: cc, roughness: rc };
}

function lon2deg(r) { return (r * 180) / Math.PI; }
