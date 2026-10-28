// earth-texture.js — procedural Earth maps, drawn into 2D canvases (no downloads).
//
// The land masses are hand-simplified continent outlines in [lon, lat] degrees, roughened by
// seeded midpoint displacement so the coasts read as natural at globe scale. Colour is then
// computed per pixel from latitude, a rough aridity field and seamless 3D value noise sampled on
// the unit sphere (so there is no seam at the antimeridian and no pinching at the poles).
//
// Everything is equirectangular: x = (lon + 180) / 360, y = (90 - lat) / 180 — the UV layout of
// THREE.SphereGeometry.

// ---- continents (rough outlines, lon/lat) -----------------------------------------------------
const LAND = [
  // North America
  [[-168,66],[-162,70],[-156,71.3],[-140,69.6],[-128,70],[-115,68.5],[-95,72],[-82,73],[-70,67],[-62,60],[-56,52],[-66,45],[-70,42],[-75,37],[-76,35],[-81,31],[-80,25.5],[-82,27.5],[-84,30],[-89,30],[-94,29.5],[-97,26],[-97.5,22],[-95,18.5],[-91,19],[-90,21.5],[-87,21],[-88,16],[-84,15],[-83.5,10],[-79.5,9],[-77.5,8],[-80,7.5],[-83,8.5],[-86,12],[-92,14.5],[-96,15.7],[-105,19.5],[-106,23.5],[-109,26],[-112.5,29.5],[-114.5,31.5],[-112.5,28],[-110,24],[-110,23],[-112,25],[-114.5,28],[-117,32.5],[-120.5,34.5],[-122.5,37.5],[-124,40.5],[-124,46],[-123,48.5],[-127,50.5],[-131,54],[-135,57.5],[-140,59.5],[-146,61],[-152,59],[-158,56.5],[-163,55],[-158,58],[-162,60],[-165,62.5],[-164,64.5]],
  // Greenland
  [[-73,78],[-60,82],[-35,83.5],[-20,82],[-18,77],[-22,70],[-32,68],[-40,65],[-43,60],[-48,61],[-52,65],[-55,70],[-58,75],[-66,77]],
  // Canadian Arctic islands
  [[-80,63.5],[-68,62],[-62,66.5],[-68,70.5],[-78,72.8],[-90,73.5],[-85,70],[-82,67],[-87,64]],
  [[-80,77],[-65,82],[-62,82.5],[-75,83],[-90,81.5],[-92,78]],
  [[-118,69],[-102,69],[-101,72.5],[-118,73]],
  [[-125,71.5],[-115,71.5],[-118,74],[-125,74]],
  // Caribbean
  [[-85,21.8],[-82,23.1],[-77,22],[-74.2,20.2],[-77.5,19.9],[-81,21.7]],
  [[-74.4,18.5],[-72.8,19.9],[-69.9,19.6],[-68.4,18.6],[-71.5,17.6]],
  // South America
  [[-80,9],[-75,11],[-71.5,12.5],[-64,10.5],[-60,8.5],[-52,5],[-50,1],[-44,-2.5],[-35,-5.5],[-35,-9],[-39,-13.5],[-39,-18],[-41,-22],[-48,-25.5],[-48.5,-28.5],[-53,-34],[-58,-34.5],[-57,-38],[-62,-39],[-65,-42],[-65,-46],[-68,-50.5],[-69,-52.5],[-71,-54],[-74.5,-52],[-75.5,-47],[-73.5,-42],[-73.5,-37],[-71.5,-30],[-70.3,-18.5],[-75,-15.5],[-77,-12],[-81,-6],[-80.5,-1.5],[-80,1],[-78.5,3],[-77.5,7]],
  // Eurasia
  [[-9.5,37],[-9,43],[-2,43.5],[-1.5,46.5],[-4.5,48.5],[-1.5,49.5],[2,51],[5,53.3],[8.5,54],[8.5,57.2],[10.5,57.7],[10.5,54.5],[14,54],[19,54.5],[21,57],[24,58.5],[30,60],[23,60],[21.5,63],[25,65.5],[21.5,65.5],[17.5,62.5],[19,60],[16.5,56.5],[12.8,55.5],[11,58.8],[8,58],[5.5,59],[5,62],[10,64],[14.5,67.5],[19,70],[25,71],[31,70],[40,67],[44,68.5],[53,68.5],[60,69.5],[68,69],[72,72.5],[80,73.5],[87,75],[100,77.5],[106,77],[113,73.5],[127,73.5],[140,72.5],[150,71.5],[160,70],[170,70],[180,68.5],[180,65],[178,64.5],[173,61],[166,60],[163,59.5],[161,54],[156.5,51],[156,57.5],[163,62],[152,59],[143,59.5],[137,54],[141,52],[140.5,48],[135,43.5],[129.5,42.5],[129.5,36],[126.5,34.5],[126.5,37.7],[125,39.5],[122,40],[121,40.9],[118,39],[119,37],[122.5,37],[120,34],[122,30.5],[121.5,28],[119.5,25.5],[117,23.5],[113,22],[110,21.5],[108,21.5],[106.5,19.5],[109,15],[109,11.5],[105,8.6],[103,10.5],[100.5,13.5],[100,9],[101.5,6.8],[103.5,4],[103.5,1.3],[101,3],[98.5,7.8],[98.5,13],[97.5,16.5],[94.3,16],[94,19],[92,21.5],[90,22],[87,21.5],[86.5,20],[84,18],[80.5,15.5],[80,10.5],[77.5,8],[76,10],[74,15],[72.8,19],[72.5,21.5],[70,22.5],[68.5,23.5],[66.5,25.4],[61.5,25.2],[57.5,25.7],[56.5,27],[51.5,27.9],[50,30],[48,30],[48.5,28.5],[50.5,25],[51.5,24],[54,24],[56,26],[56.5,24.5],[59.8,22.5],[58,20.5],[55,17],[52,15.5],[45,13],[43.5,12.7],[42.8,15.5],[40,20],[38.5,23],[35,28],[34.5,29.5],[32.5,30],[34.5,31.5],[36,35],[36,36.6],[32,36.2],[29,36.6],[26.5,38.5],[26.5,40.3],[29,41],[26,40.9],[24,40.5],[22.8,40.5],[24,38],[22,36.5],[21,38.5],[19.5,40.5],[19.5,42],[15.5,44],[13.5,45.5],[12.5,44.5],[16,41.5],[18.5,40.2],[16,38],[15.7,40],[12,42],[10.5,43],[8.5,44.3],[6,43],[3.3,43.3],[3,41.5],[0.5,40.5],[-0.5,38.5],[-2,36.8],[-5.5,36],[-7,37]],
  // European islands
  [[-5.7,50],[1.4,51.2],[1.7,52.7],[0,53.5],[-1.6,55.6],[-2,57.6],[-3.3,58.6],[-5,58.6],[-6,57],[-5.5,55.7],[-4.8,54.8],[-3,54],[-3.2,53.3],[-4.6,53.1],[-4.2,52.3],[-5.2,51.7],[-3.2,51.4],[-4.2,51.2]],
  [[-6,52.2],[-6.2,53.8],[-5.6,54.8],[-7.3,55.3],[-8.5,54.6],[-10,54],[-9.7,52.2],[-8.5,51.6],[-6.5,52]],
  [[-24,65.5],[-22,66.4],[-18,66.2],[-14.5,66],[-13.5,65],[-15,64.3],[-18.5,63.4],[-22.5,63.8]],
  [[12.4,38],[15.6,38.3],[15.1,36.7]],
  [[11,78.5],[17,80.3],[27,80],[21,78],[16,76.6]],
  [[52,71.5],[57,70.6],[60,73],[68,76.8],[56,75],[52,72.5]],
  // Africa
  [[-17,21],[-16,24],[-13,27.5],[-9.5,30],[-9,32.5],[-6,35.8],[-2,35.2],[3,36.8],[10,37.2],[11,35],[10,34],[11,33],[15,32.3],[19,30.3],[20,32],[23,32.6],[25,31.5],[29,30.9],[32.3,31.3],[32.5,29.9],[33.5,27.5],[35.5,24],[37,21],[38.5,18],[39.5,15.5],[42.5,13],[43.3,11.8],[44,10.5],[51,11.8],[51,10.5],[48,4.5],[46,2],[42,-1],[40,-3],[39.3,-6],[39.7,-10],[40.5,-15],[37,-17.5],[35,-20],[35.5,-23.5],[32.8,-26],[32.5,-29],[30,-31.5],[27,-33.7],[22.5,-34],[20,-34.8],[18.4,-34],[18,-32],[16.5,-28.5],[15,-26.5],[14.5,-22.5],[11.8,-17],[13.6,-11.5],[12.2,-6],[12,-4.5],[9.5,-1],[9.5,3],[9.8,4],[8.5,4.5],[6,4.3],[4.5,6.3],[2,6.3],[-2,4.8],[-4.5,5.2],[-7.5,4.4],[-11,6.8],[-13.2,8.5],[-15,11],[-16.8,13],[-17.2,14.7],[-16.5,16],[-16,19.5]],
  [[44,-25],[47,-25],[50.3,-15.5],[49.5,-12],[48,-13.5],[44,-16.5],[43.3,-22]],
  // Asian islands
  [[130,31.3],[131.5,31.5],[132,33.8],[135,33.5],[136.8,34.3],[139,34.8],[140.8,35.7],[140.9,38],[142,39.5],[141.4,41.4],[140,40.5],[139.8,38],[138.5,37.5],[136.8,37.3],[136,36],[133,35.5],[131,34.4],[129.7,33.2]],
  [[140,41.5],[141,41.8],[143.3,42],[145.5,43.3],[144.5,44],[141.8,45.4],[141.3,43.3]],
  [[142,46],[143.5,49],[143,54.3],[142.2,54],[141.8,49]],
  [[120.2,22.6],[121.9,25],[121.5,25.3],[120.1,23.6]],
  [[79.8,8.2],[80.2,9.8],[81.8,7.5],[81,6],[80,6.2]],
  [[120,18.5],[122.3,18.5],[122,16],[124,13],[123,13],[121.5,13.8],[120.6,14.5],[119.8,16]],
  [[122,7],[124,6],[126.4,6.3],[126.2,9],[125,9.8],[123.5,8.6]],
  [[109,1.5],[110,-1.5],[111.5,-3],[114.5,-4],[116.2,-3.5],[116.5,-1],[118,1],[117.8,4.2],[119,5.3],[117,7],[115.5,5],[113,3.2],[111,1.8]],
  [[95.3,5.5],[98,4],[100.5,1],[103.8,-1],[106,-3.3],[105.8,-5.8],[104,-5],[101,-2.2],[98.6,1.5]],
  [[105.2,-6.8],[106.5,-6],[110.5,-6.9],[114.5,-7.7],[114.4,-8.7],[110,-8.2],[106.5,-7.4]],
  [[119.4,-5.5],[120.5,-5.5],[120.6,-2.8],[121.3,-4.7],[123,-4.8],[121.6,-1.6],[123.2,-0.9],[120.6,0.6],[124.6,1.2],[124.9,1.7],[120,1.1],[119.6,-0.8]],
  [[131,-1.3],[134,-0.8],[138,-1.6],[141,-2.6],[144.5,-3.8],[147.5,-6.2],[147.5,-8],[150,-10.5],[146,-8.8],[143.5,-9.2],[141,-9.2],[139,-8.1],[137.8,-5.3],[135,-4.4],[132.3,-4],[132,-2.8]],
  // Australia & New Zealand
  [[113.5,-22],[114,-26],[115,-34],[118,-35],[123.5,-34],[129,-31.6],[131.5,-31.5],[135,-34.8],[138,-35.5],[138.5,-34],[140,-38],[144,-38.3],[146.5,-39],[150,-37.5],[151.2,-33.9],[153,-31],[153.5,-28],[153,-25],[150.5,-22.5],[149,-20.5],[146,-18],[145.3,-15],[143.5,-14],[142.5,-10.8],[141.5,-13],[141.5,-17],[140,-17.7],[137.7,-16],[135.5,-15],[136.7,-12.2],[132.5,-11.5],[130,-13],[129.5,-15],[126.5,-14],[124,-16.5],[122.5,-17.5],[121.5,-19.5],[118.5,-20.4],[116,-21]],
  [[144.6,-40.7],[148.3,-40.9],[148,-43.2],[146,-43.6],[145.2,-42]],
  [[172.7,-34.5],[174.5,-36.5],[176,-37.6],[178.5,-37.7],[177,-39.5],[175,-41.6],[174.6,-39.8],[173.8,-39.2],[174.6,-37.5]],
  [[172.7,-40.5],[174.3,-41.7],[173,-43.8],[171,-45.5],[169,-46.6],[166.5,-46],[168,-44],[171,-42]],
];

// Inland water cut back out of the land.
const WATER = [
  [[28,41.5],[28.5,43.5],[30,45.5],[33,44.5],[34,46],[37,45.5],[39.5,44],[41.5,41.5],[36,41.5],[33,42],[30,41.2]],         // Black Sea
  [[47,45],[50,46.5],[53,46],[53,42],[54,40],[53.5,37.5],[50,37],[49,38.5],[49.5,40.5],[47.5,42.5]],                       // Caspian
  [[-95,59],[-93,61],[-88,64],[-86,66.5],[-82,66.5],[-80,63.5],[-78,62.5],[-77,60],[-77.5,56],[-79.5,54.5],[-82,53],[-85,55.3],[-89,57],[-92.5,57.2]], // Hudson Bay
];

// Antarctica: a wavy coast closed along the south pole row.
const ANTARCTICA = [[-180,-78],[-160,-78],[-150,-76],[-130,-74],[-100,-73],[-80,-73],[-70,-69],[-62,-65],[-57,-63.3],[-60,-66],[-62,-70],[-60,-75],[-45,-78],[-30,-76],[-20,-73],[0,-70],[20,-69.8],[40,-69],[60,-67.5],[75,-69],[90,-66.5],[110,-66.2],[130,-66.2],[150,-68.5],[165,-70.5],[170,-72],[175,-77],[180,-78]];

// ---- seeded helpers ------------------------------------------------------------------------
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

function hash3(x, y, z) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const l = (a, b, t) => a + (b - a) * t;
  return l(
    l(l(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), u), l(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), u), v),
    l(l(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), u), l(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), u), v),
    w,
  );
}

function fbm(x, y, z, octaves) {
  let a = 0.5, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += a * noise3(x * f, y * f, z * f);
    norm += a;
    a *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

// Midpoint displacement: every edge gets a few levels of perpendicular jitter, proportional to its
// length, so straight polygon edges become plausible coastline.
function roughen(poly, rand, levels = 3, amount = 0.22, closed = true) {
  let pts = poly;
  for (let l = 0; l < levels; l++) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      out.push(a);
      if (!closed && i === pts.length - 1) break;
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len = Math.hypot(dx, dy);
      const off = (rand() - 0.5) * 2 * amount * len;
      out.push([(a[0] + b[0]) / 2 - (dy / (len || 1)) * off, (a[1] + b[1]) / 2 + (dx / (len || 1)) * off]);
    }
    pts = out;
  }
  return pts;
}

function drawPoly(ctx, poly, W, H) {
  ctx.beginPath();
  poly.forEach(([lon, lat], i) => {
    const x = ((lon + 180) / 360) * W, y = ((90 - lat) / 180) * H;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fill();
}

function landMask(W, H) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const rand = rng(20261028);
  ctx.fillStyle = '#fff';
  for (const p of LAND) drawPoly(ctx, roughen(p, rand), W, H);
  // Antarctica: roughen only the coast, then close along the pole.
  const coast = roughen(ANTARCTICA, rand, 3, 0.22, false);
  drawPoly(ctx, [...coast, [180, -90], [-180, -90]], W, H);
  ctx.fillStyle = '#000';
  for (const p of WATER) drawPoly(ctx, roughen(p, rand, 2, 0.15), W, H);
  return c;
}

// Dry regions: [lon, lat, radius°, strength]
const ARID = [
  [12, 23, 16, 1], [30, 24, 9, 0.9], [-5, 22, 10, 0.9], [46, 22, 11, 1], [58, 28, 8, 0.7],
  [133, -25, 13, 0.95], [122, -24, 8, 0.7], [104, 42, 11, 0.8], [80, 40, 8, 0.7], [64, 41, 8, 0.6],
  [20, -24, 7, 0.75], [15, -22, 5, 0.6], [-112, 33, 7, 0.65], [-69, -24, 5, 0.6], [-68, -45, 7, 0.45],
  [42, 5, 5, 0.45],
];

function aridity(lon, lat) {
  let a = 0;
  for (const [x, y, r, s] of ARID) {
    let dx = Math.abs(lon - x); if (dx > 180) dx = 360 - dx;
    dx *= Math.cos((lat * Math.PI) / 180);
    const d2 = (dx * dx + (lat - y) * (lat - y)) / (r * r);
    a = Math.max(a, s * Math.exp(-d2));
  }
  return a;
}

const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const sat = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const smooth = (e0, e1, x) => { const t = sat((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };

/**
 * Build the colour map, the specular (ocean = shiny) map and a cloud alpha map.
 * @returns {{ color: HTMLCanvasElement, specular: HTMLCanvasElement, clouds: HTMLCanvasElement }}
 */
export function buildEarthMaps(W = 2048, H = 1024) {
  const mask = landMask(W, H);
  const m = mask.getContext('2d').getImageData(0, 0, W, H).data;

  // Continental shelf: the mask, shrunk and smoothed back up — a cheap wide blur that works in
  // every browser (no ctx.filter needed).
  const sw = W / 16, sh = H / 16;
  const small = document.createElement('canvas');
  small.width = sw; small.height = sh;
  const sctx = small.getContext('2d');
  sctx.imageSmoothingEnabled = true;
  sctx.drawImage(mask, 0, 0, sw, sh);
  const shelfC = document.createElement('canvas');
  shelfC.width = W; shelfC.height = H;
  const shctx = shelfC.getContext('2d');
  shctx.imageSmoothingEnabled = true;
  shctx.imageSmoothingQuality = 'high';
  shctx.drawImage(small, 0, 0, W, H);
  const shelf = shctx.getImageData(0, 0, W, H).data;

  const color = document.createElement('canvas');
  color.width = W; color.height = H;
  const cctx = color.getContext('2d');
  const img = cctx.createImageData(W, H);
  const px = img.data;

  const spec = document.createElement('canvas');
  spec.width = W; spec.height = H;
  const spctx = spec.getContext('2d');
  const simg = spctx.createImageData(W, H);
  const sp = simg.data;

  const DEEP = [7, 27, 66], MID = [12, 52, 104], SHALLOW = [28, 104, 148];
  const RAIN = [28, 92, 46], TEMPERATE = [62, 118, 56], BOREAL = [44, 78, 50], TUNDRA = [118, 120, 98];
  const SAVANNA = [132, 140, 70], DESERT = [206, 176, 118], DUNE = [222, 196, 140], ICE = [236, 243, 250];

  for (let y = 0; y < H; y++) {
    const lat = 90 - ((y + 0.5) / H) * 180;
    const phi = (lat * Math.PI) / 180;
    const cl = Math.cos(phi), sl = Math.sin(phi);
    const alat = Math.abs(lat);
    for (let x = 0; x < W; x++) {
      const lon = ((x + 0.5) / W) * 360 - 180;
      const th = (lon * Math.PI) / 180;
      // Seamless noise: sample on the sphere, not the rectangle.
      const nx = cl * Math.cos(th) * 3, ny = sl * 3, nz = cl * Math.sin(th) * 3;
      const n = fbm(nx + 11.3, ny + 4.1, nz + 7.7, 3);
      const i = (y * W + x) * 4;
      const land = m[i] / 255;
      let c;
      if (land > 0.5) {
        // Vegetation by latitude, then dried out by the aridity field.
        let v;
        if (alat < 14) v = RAIN;
        else if (alat < 24) v = mix(RAIN, SAVANNA, smooth(14, 24, alat));
        else if (alat < 50) v = mix(SAVANNA, TEMPERATE, smooth(26, 42, alat));
        else if (alat < 64) v = mix(TEMPERATE, BOREAL, smooth(50, 62, alat));
        else v = mix(BOREAL, TUNDRA, smooth(62, 72, alat));
        // Finer noise breaks the desert edges up, so they never read as round blobs.
        const fine = fbm(nx * 4.1, ny * 4.1, nz * 4.1, 3);
        const a = sat(aridity(lon, lat) * 1.15 + (n - 0.5) * 0.6 + (fine - 0.5) * 0.9);
        c = mix(v, mix(DESERT, DUNE, sat(n * 1.4 - 0.3)), smooth(0.4, 0.7, a));
        // Relief-ish shading from the same noise, so land is never a flat fill.
        const shade = 0.82 + 0.36 * fine;
        c = [c[0] * shade, c[1] * shade, c[2] * shade];
        // Ice sheets: Antarctica, Greenland (blended in by longitude, no hard edge), the high Arctic.
        const greenland = smooth(-80, -68, lon) * (1 - smooth(-16, -8, lon));
        const arctic = smooth(74, 80, alat + (n - 0.5) * 8);
        const ice = lat < -60 ? 1 : Math.max(arctic, greenland * smooth(61, 66, lat + (n - 0.5) * 6));
        c = mix(c, ICE, ice);
        sp[i] = sp[i + 1] = sp[i + 2] = 10 + ice * 40;
      } else {
        const s = shelf[i] / 255;
        c = mix(DEEP, MID, smooth(0.0, 0.25, s + (n - 0.5) * 0.25));
        c = mix(c, SHALLOW, smooth(0.3, 0.75, s));
        const v = 0.9 + 0.2 * n;
        c = [c[0] * v, c[1] * v, c[2] * v];
        // Polar seas a touch greyer; a little sea ice at the very top.
        c = mix(c, [40, 62, 84], smooth(55, 75, alat) * 0.5);
        c = mix(c, ICE, smooth(80, 86, lat + (n - 0.5) * 6) * 0.85);
        sp[i] = sp[i + 1] = sp[i + 2] = 150;
      }
      px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
      sp[i + 3] = 255;
    }
  }
  cctx.putImageData(img, 0, 0);
  spctx.putImageData(simg, 0, 0);

  // Graticule every 30° — faint, but it gives the eyes texture to fuse on open ocean.
  cctx.strokeStyle = 'rgba(170, 210, 255, 0.13)';
  cctx.lineWidth = 1.5;
  cctx.beginPath();
  for (let lon = -180; lon < 180; lon += 30) {
    const xx = ((lon + 180) / 360) * W;
    cctx.moveTo(xx, H * (10 / 180)); cctx.lineTo(xx, H * (170 / 180));
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    const yy = ((90 - lat) / 180) * H;
    cctx.moveTo(0, yy); cctx.lineTo(W, yy);
  }
  cctx.stroke();

  return { color, specular: spec, clouds: buildClouds(W / 2, H / 2) };
}

function buildClouds(W, H) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(W, H);
  const p = img.data;
  for (let y = 0; y < H; y++) {
    const lat = 90 - ((y + 0.5) / H) * 180;
    const phi = (lat * Math.PI) / 180;
    const cl = Math.cos(phi), sl = Math.sin(phi);
    // Cloud belts: the ITCZ near the equator and the stormy mid-latitudes; clear subtropics.
    const belt = 0.55 + 0.25 * Math.exp(-(lat * lat) / 60) + 0.3 * Math.exp(-((Math.abs(lat) - 55) ** 2) / 150)
      - 0.25 * Math.exp(-((Math.abs(lat) - 25) ** 2) / 60);
    for (let x = 0; x < W; x++) {
      const th = (((x + 0.5) / W) * 360 - 180) * Math.PI / 180;
      const nx = cl * Math.cos(th) * 4, ny = sl * 4 * 1.6, nz = cl * Math.sin(th) * 4;
      const n = fbm(nx + 31, ny + 17, nz + 5, 5);
      const a = smooth(0.5, 0.66, n + (belt - 0.6) * 0.35);
      const i = (y * W + x) * 4;
      p[i] = p[i + 1] = p[i + 2] = 255;
      p[i + 3] = a * 200;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
