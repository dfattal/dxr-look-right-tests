// earth.js — a procedural Earth: equirectangular colour, specular and cloud canvases built at
// load time, no downloads. Coarse hand-drawn continent outlines (lon, lat) give recognisable
// land masses; a noise domain-warp roughens the coasts and noise drives the biome colours.
//
// Detail is deliberately moderate. On a lenticular panel high-contrast fine detail far from the
// glass ghosts first, and the globe's front pops out of the glass by its radius.

// ---- coarse land outlines, [lon, lat] -----------------------------------------------------
const LAND = [
  // North America (incl. Central America)
  [[-168,66],[-162,70],[-156,71],[-140,70],[-128,70],[-115,68],[-95,72],[-82,73],[-78,66],
   [-90,64],[-94,60],[-85,55],[-80,52],[-78,58],[-70,61],[-64,60],[-60,55],[-56,52],[-60,47],
   [-66,45],[-70,43],[-74,40],[-76,35],[-81,31],[-80,26],[-82,27],[-84,30],[-90,30],[-97,28],
   [-97,22],[-94,18],[-90,21],[-87,21],[-88,16],[-83,15],[-83,10],[-79,9],[-78,7],[-80,7.5],
   [-86,11],[-92,15],[-96,16],[-105,20],[-106,23],[-110,24],[-112,29],[-115,30],[-118,34],
   [-121,36],[-124,40],[-124,46],[-123,49],[-128,51],[-132,55],[-138,59],[-146,61],[-152,59],
   [-158,57],[-164,55],[-158,59],[-162,60],[-166,62],[-165,65]],
  // Greenland
  [[-73,78],[-60,82],[-30,83],[-20,80],[-20,72],[-24,69],[-35,66],[-42,60],[-48,61],[-53,67],
   [-55,72],[-66,76]],
  // Iceland
  [[-24,65.5],[-14,66.5],[-13.5,64.5],[-22,63.5]],
  // Cuba
  [[-85,22],[-80,23],[-74,20],[-78,21]],
  // South America
  [[-80,9],[-77,8],[-72,12],[-64,10.5],[-60,8],[-52,5],[-50,0],[-44,-2],[-35,-5],[-35,-9],
   [-39,-15],[-41,-22],[-48,-26],[-53,-34],[-58,-38],[-62,-39],[-65,-42],[-67,-46],[-66,-50],
   [-69,-52],[-68,-55],[-72,-54],[-75,-50],[-74,-43],[-73,-37],[-71,-30],[-70,-18],[-75,-15],
   [-77,-12],[-81,-6],[-80,-2],[-79,1],[-77,4],[-78,7]],
  // Eurasia
  [[-9,43],[-9,37],[-6,36],[-2,37],[0,39],[3,42],[5,43],[9,44],[12,42],[16,38],[18,40],[13,45],
   [19,42],[20,40],[23,37],[26,40],[29,41],[36,36],[35,33],[34.5,31],[34,28],[39,21],[43,13],
   [45,13],[52,16],[57,19],[59,22],[56,26],[51,25],[48,29],[50,30],[57,26],[62,25],[67,24],
   [70,21],[73,16],[77,8],[80,10],[80,15],[86,20],[90,22],[92,21],[94,17],[98,16],[98,9],
   [100,4],[103,1.5],[104,1.5],[103,6],[101,13],[104,10],[107,11],[109,13],[108,16],[106,19],
   [108,21],[111,21],[116,23],[120,26],[122,30],[121,32],[119,35],[122,37],[118,38],[121,40],
   [125,40],[127,38],[126,35],[129,35],[130,42],[135,43],[140,48],[141,53],[137,54],[141,59],
   [150,59],[156,58],[156,51],[160,54],[163,58],[170,60],[178,62],[180,65],[180,69],[170,70],
   [160,70],[150,72],[140,73],[130,72],[120,73],[113,74],[105,78],[95,76],[85,75],[80,73],
   [70,73],[68,69],[60,69],[55,68],[45,68],[41,67],[35,69],[28,71],[20,70],[14,67],[12,64],
   [6,62],[5,59],[8,58],[11,59],[12,56],[10,57],[8,55],[9,54],[4,52],[2,51],[-1,49],[-4,48],
   [-1,46],[-2,43]],
  // Great Britain, Ireland
  [[-5.5,50],[1.5,51],[2,53],[0,54],[-2,56],[-2,58],[-5,58.6],[-6.2,57],[-5,55],[-3,54],
   [-4.5,52.5],[-5.3,51.6]],
  [[-10,52],[-6,52],[-5.8,55],[-8,55.3],[-10,54]],
  // Japan (Honshu–Kyushu, Hokkaido), Taiwan, Sri Lanka
  [[130,31],[131,34],[135,34],[140,35],[141,38],[142,40],[141,41.5],[140,40],[139,38],[137,37],
   [133,35.5],[130,33.5]],
  [[140,42],[143,42],[145.5,43.5],[142,45.5]],
  [[120,22],[122,25],[121,25.3]],
  [[80,6],[82,7],[80,10]],
  // Africa, Madagascar
  [[-17,21],[-16,28],[-10,30],[-9,33],[-6,36],[0,36],[10,37],[11,33],[20,31],[25,32],[32,31],
   [34,28],[37,22],[39,16],[43,12],[51,12],[51,10],[48,5],[42,-1],[40,-5],[39,-10],[40,-15],
   [35,-20],[35,-24],[33,-26],[32,-29],[28,-33],[22,-34],[18,-34],[18,-30],[15,-27],[12,-18],
   [13,-12],[12,-5],[9,-1],[9,4],[5,6],[-1,5],[-5,5],[-8,4],[-12,7],[-15,11],[-17,15]],
  [[44,-25],[47,-25],[50,-15],[49,-12],[44,-16]],
  // Maritime South-East Asia, New Guinea, Philippines
  [[95,5.5],[98,4],[106,-6],[104,-6],[100,-2]],
  [[109,1],[110,-3],[116,-4],[119,1],[117,7],[113,3]],
  [[105,-6],[114,-7],[114,-8.5],[106,-7.5]],
  [[119,-1],[125,1.5],[121,-5.5]],
  [[131,-1],[141,-2],[148,-6],[150,-10],[143,-9],[138,-8],[134,-4]],
  [[120,18],[122,18],[126,7],[124,6],[120,13]],
  // Australia, Tasmania, New Zealand
  [[114,-22],[114,-26],[115,-34],[118,-35],[124,-34],[131,-31.5],[135,-35],[138,-35],[140,-38],
   [144,-38.5],[147,-38],[150,-37],[152.5,-33.4],[153,-30],[153,-25],[150,-22],[146,-19],
   [145,-15],[143,-11],[142,-11],[141,-17],[136,-15],[137,-12],[131,-11],[129,-15],[125,-14],
   [122,-17],[120,-20]],
  [[145,-41],[148,-41],[148,-43.5],[146,-43.5]],
  [[172.5,-34.5],[175,-37],[178,-38],[175,-41.5],[173,-40.5],[174,-38]],
  [[172.5,-41],[174,-41.5],[171,-44],[169,-46.5],[166.5,-46],[168,-44]],
  // Antarctica
  [[-180,-90],[180,-90],[180,-78],[150,-68],[100,-66],[60,-67],[20,-70],[-20,-72],[-60,-75],
   [-58,-63],[-65,-68],[-100,-73],[-150,-77],[-180,-78]],
];

// Inland seas punched back out of the land.
const WATER = [
  [[28,41.5],[41,41.5],[38,45],[34,46.5],[30,46]],                                    // Black Sea
  [[47,45],[50,47],[54,45],[54,38],[49,38]],                                          // Caspian
  [[12,54],[20,54],[22,57],[24,60],[30,60],[22,61],[21,64],[25,66],[22,66],[17,62],
   [19,60],[16,57],[14,55]],                                                          // Baltic
];

// ---- noise (3D value noise on the unit sphere: seamless at the date line and poles) -------
function hash3(x, y, z) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const l = (a, b, t) => a + (b - a) * t;
  const c000 = hash3(xi, yi, zi), c100 = hash3(xi + 1, yi, zi);
  const c010 = hash3(xi, yi + 1, zi), c110 = hash3(xi + 1, yi + 1, zi);
  const c001 = hash3(xi, yi, zi + 1), c101 = hash3(xi + 1, yi, zi + 1);
  const c011 = hash3(xi, yi + 1, zi + 1), c111 = hash3(xi + 1, yi + 1, zi + 1);
  return l(l(l(c000, c100, u), l(c010, c110, u), v), l(l(c001, c101, u), l(c011, c111, u), v), w);
}
function fbm(x, y, z, oct) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f, z * f); n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}

const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
// Smooth "bump" over a lon/lat box — regional aridity tweaks.
const region = (lon, lat, lo0, lo1, la0, la1, soft = 6) =>
  smooth(lo0 - soft, lo0 + soft, lon) * (1 - smooth(lo1 - soft, lo1 + soft, lon)) *
  smooth(la0 - soft, la0 + soft, lat) * (1 - smooth(la1 - soft, la1 + soft, lat));

function drawPolys(ctx, polys, W, H) {
  for (const poly of polys) {
    ctx.beginPath();
    poly.forEach(([lon, lat], i) => {
      const x = ((lon + 180) / 360) * W, y = ((90 - lat) / 180) * H;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    });
    ctx.closePath();
    ctx.fill();
  }
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// Palette (sRGB 0-255). Muted, mid-luminance: no pure white, no pure black.
const DEEP = [12, 42, 82], MID = [20, 66, 116], SHALLOW = [38, 104, 146];
const TROPIC = [46, 100, 48], TEMPERATE = [88, 122, 60], BOREAL = [54, 86, 56];
const TUNDRA = [122, 120, 98], STEPPE = [158, 142, 94], DESERT = [196, 170, 120];
const ICE = [222, 229, 234], SEAICE = [190, 205, 216];

/**
 * Build the globe's textures. Returns canvases (equirectangular, 2:1):
 *   color    — sRGB albedo
 *   specular — ocean shiny, land matte
 *   clouds   — greyscale alpha for the cloud shell
 */
export function buildEarthTextures({ width = 2048 } = {}) {
  const W = width, H = width / 2;

  // 1. Binary land mask.
  const maskC = makeCanvas(W, H);
  const mctx = maskC.getContext('2d', { willReadFrequently: true });
  mctx.fillStyle = '#000'; mctx.fillRect(0, 0, W, H);
  mctx.fillStyle = '#fff'; drawPolys(mctx, LAND, W, H);
  mctx.fillStyle = '#000'; drawPolys(mctx, WATER, W, H);
  const mask = mctx.getImageData(0, 0, W, H).data;

  // 2. A soft "distance to coast" field: downsample then upsample with smoothing (portable —
  //    no reliance on ctx.filter).
  const small = makeCanvas(W / 32, H / 32);
  const sctx = small.getContext('2d');
  sctx.imageSmoothingEnabled = true;
  sctx.drawImage(maskC, 0, 0, small.width, small.height);
  const softC = makeCanvas(W / 4, H / 4);
  const sfctx = softC.getContext('2d', { willReadFrequently: true });
  sfctx.imageSmoothingEnabled = true; sfctx.imageSmoothingQuality = 'high';
  sfctx.drawImage(small, 0, 0, softC.width, softC.height);
  const soft = sfctx.getImageData(0, 0, softC.width, softC.height).data;
  const SW = softC.width, SH = softC.height;

  const sampleMask = (x, y) => { // bilinear, x wraps, y clamps; 0..1
    x = ((x % W) + W) % W; y = Math.min(H - 1.001, Math.max(0, y));
    const x0 = Math.floor(x), y0 = Math.floor(y), x1 = (x0 + 1) % W, y1 = y0 + 1;
    const fx = x - x0, fy = y - y0;
    const m = (xx, yy) => mask[(yy * W + xx) * 4] / 255;
    return (m(x0, y0) * (1 - fx) + m(x1, y0) * fx) * (1 - fy) + (m(x0, y1) * (1 - fx) + m(x1, y1) * fx) * fy;
  };

  const colC = makeCanvas(W, H), specC = makeCanvas(W, H);
  const cctx = colC.getContext('2d'), spctx = specC.getContext('2d');
  const col = cctx.createImageData(W, H), spec = spctx.createImageData(W, H);
  const cd = col.data, sd = spec.data;

  const warpAmp = W / 300; // ~7 px at 2048: roughens coasts without moving cities off their land
  for (let j = 0; j < H; j++) {
    const lat = 90 - ((j + 0.5) / H) * 180;
    const phi = (lat * Math.PI) / 180, cl = Math.cos(phi), sl = Math.sin(phi);
    for (let i = 0; i < W; i++) {
      const lon = ((i + 0.5) / W) * 360 - 180;
      const th = (lon * Math.PI) / 180;
      const px = cl * Math.cos(th), py = sl, pz = cl * Math.sin(th);

      const n1 = fbm(px * 5 + 11, py * 5, pz * 5, 4);
      const n2 = fbm(px * 5, py * 5 + 23, pz * 5 - 7, 3);
      const land = smooth(0.42, 0.58, sampleMask(i + (n1 - 0.5) * 2 * warpAmp * 1.3, j + (n2 - 0.5) * 2 * warpAmp));
      const coast = soft[((Math.min(SH - 1, (j / 4) | 0)) * SW + ((i / 4) | 0)) * 4] / 255;
      const detail = fbm(px * 18, py * 18, pz * 18, 3);
      const alat = Math.abs(lat);

      // Ocean: deep → shallow near coasts, sea ice in the high Arctic.
      let ocean = mix3(DEEP, MID, smooth(0.0, 0.25, coast) * 0.8 + (n2 - 0.5) * 0.25);
      ocean = mix3(ocean, SHALLOW, smooth(0.25, 0.55, coast) * 0.7);
      const seaIce = lat > 0 ? smooth(76, 80, lat + (n1 - 0.5) * 8) : smooth(68, 72, alat + (n1 - 0.5) * 6);
      ocean = mix3(ocean, SEAICE, seaIce);

      // Land: vegetation by latitude, aridity in the real desert belts, ice at the poles.
      let g = alat < 15 ? TROPIC : alat < 45 ? mix3(TROPIC, TEMPERATE, smooth(15, 35, alat))
        : alat < 60 ? mix3(TEMPERATE, BOREAL, smooth(45, 58, alat)) : mix3(BOREAL, TUNDRA, smooth(58, 68, alat));
      const arid = Math.min(1,
        region(lon, lat, -17, 58, 15, 33) * 1.0 +        // Sahara + Arabia
        region(lon, lat, 50, 75, 25, 38) * 0.8 +         // Iran / Pakistan
        region(lon, lat, 55, 115, 36, 48) * 0.6 +        // Central Asia, Gobi
        region(lon, lat, 116, 145, -32, -19) * 0.95 +    // Australian interior
        region(lon, lat, -118, -103, 26, 37) * 0.7 +     // US south-west / Mexico
        region(lon, lat, 12, 26, -29, -18) * 0.8 +       // Kalahari / Namib
        region(lon, lat, -75, -68, -30, -15, 3) * 0.7);  // Atacama
      const dry = smooth(0.25, 0.75, arid + (n1 - 0.5) * 0.5);
      g = mix3(g, mix3(STEPPE, DESERT, smooth(0.55, 0.9, arid + (detail - 0.5) * 0.3)), dry);
      const ice = lat < -62 ? 1 : smooth(0.0, 1.0, (alat - 70) / 6 + (n1 - 0.5) * 1.2) *
        (lon < -15 && lon > -75 && lat > 58 ? 1 : smooth(74, 80, alat)); // Greenland ice sheet
      g = mix3(g, ICE, Math.min(1, ice));
      const shade = 0.86 + (detail - 0.5) * 0.35 + (n1 - 0.5) * 0.15;
      g = [g[0] * shade, g[1] * shade, g[2] * shade];

      const c = mix3(ocean, g, land);
      const k = (j * W + i) * 4;
      cd[k] = c[0]; cd[k + 1] = c[1]; cd[k + 2] = c[2]; cd[k + 3] = 255;
      const s = (1 - land) * (1 - seaIce) * 150;
      sd[k] = s; sd[k + 1] = s; sd[k + 2] = s; sd[k + 3] = 255;
    }
  }
  cctx.putImageData(col, 0, 0);
  spctx.putImageData(spec, 0, 0);

  // 3. Clouds: thresholded fbm, sparser at the subtropical highs. Half resolution — clouds are soft.
  const CW = W / 2, CH = H / 2;
  const cloudC = makeCanvas(CW, CH);
  const clctx = cloudC.getContext('2d');
  const cl = clctx.createImageData(CW, CH), cld = cl.data;
  for (let j = 0; j < CH; j++) {
    const lat = 90 - ((j + 0.5) / CH) * 180;
    const phi = (lat * Math.PI) / 180, c0 = Math.cos(phi), s0 = Math.sin(phi);
    const band = 0.12 * Math.cos((Math.abs(lat) - 25) * Math.PI / 25) * (Math.abs(lat) < 50 ? 1 : 0);
    for (let i = 0; i < CW; i++) {
      const th = ((i + 0.5) / CW) * 2 * Math.PI;
      const x = c0 * Math.cos(th), y = s0, z = c0 * Math.sin(th);
      const w = fbm(x * 2 + 5, y * 2, z * 2, 2);
      const n = fbm(x * 4 + w * 1.6, y * 7 + w, z * 4 - w * 1.6, 5);
      const a = smooth(0.52 + band, 0.72 + band, n) * 0.9;
      const k = (j * CW + i) * 4;
      const v = a * 255;
      cld[k] = v; cld[k + 1] = v; cld[k + 2] = v; cld[k + 3] = 255;
    }
  }
  clctx.putImageData(cl, 0, 0);

  return { color: colC, specular: specC, clouds: cloudC };
}
