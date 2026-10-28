// Procedural Earth textures: coarse continent outlines (lon, lat) with fractal coastline
// roughening, biome colouring from 3D value noise (seamless across the antimeridian), a shallow
// shelf glow, a faint graticule, plus roughness and bump maps. No downloads.

const W = 2048, H = 1024;

const LAND = {
  northAmerica: [[-165,68],[-140,70],[-110,73],[-95,72],[-82,68],[-80,63],[-93,58],[-82,52],[-78,55],[-70,59],[-62,57],[-56,52],[-66,45],[-70,42],[-76,36],[-81,31],[-80,25],[-83,29],[-90,30],[-97,27],[-97,22],[-92,18],[-88,21],[-87,16],[-83,10],[-78,8],[-80,7],[-86,11],[-92,14],[-105,20],[-106,23],[-112,29],[-117,33],[-121,35],[-124,40],[-124,47],[-130,54],[-140,60],[-152,59],[-165,55],[-158,58],[-166,62]],
  southAmerica: [[-77,8],[-72,12],[-62,10],[-52,5],[-50,0],[-35,-5],[-38,-13],[-41,-22],[-48,-26],[-53,-34],[-58,-38],[-65,-41],[-68,-50],[-69,-55],[-74,-52],[-73,-40],[-71,-30],[-70,-18],[-76,-14],[-81,-5],[-80,0],[-77,4]],
  greenland: [[-73,78],[-60,82],[-30,83],[-20,75],[-22,70],[-42,60],[-50,64],[-55,70],[-68,76]],
  eurasia: [[-9,37],[-9,43],[-1,46],[-4,48],[2,51],[5,53],[9,55],[8,58],[10,57],[11,59],[5,59],[5,62],[14,67],[22,70],[30,71],[40,67],[44,68],[60,69],[70,73],[80,73],[100,77],[113,74],[130,71],[150,71],[170,70],[180,68],[180,65],[170,60],[163,58],[162,60],[155,58],[156,51],[142,59],[135,55],[140,48],[132,43],[129,40],[129,35],[126,35],[126,38],[121,40],[122,37],[119,35],[122,30],[120,24],[110,21],[106,18],[109,12],[105,9],[100,13],[100,8],[103,2],[98,8],[98,16],[94,18],[91,22],[87,21],[80,15],[78,8],[73,16],[72,21],[67,24],[57,25],[56,27],[50,30],[48,29],[51,25],[56,26],[59,22],[52,16],[43,13],[35,28],[34,31],[36,36],[28,37],[26,40],[24,40],[23,37],[21,38],[19,42],[14,45],[12,44],[16,41],[18,40],[16,38],[12,42],[9,44],[3,43],[0,39],[-5,36]],
  africa: [[-17,21],[-16,28],[-9,32],[-6,36],[10,37],[11,33],[20,31],[32,31],[34,31],[33,27],[38,19],[43,12],[51,12],[48,5],[40,-3],[39,-9],[41,-15],[35,-24],[32,-29],[27,-34],[20,-35],[18,-32],[14,-23],[12,-14],[13,-6],[9,0],[9,4],[4,6],[-4,5],[-8,4],[-13,8],[-17,14]],
  australia: [[114,-22],[122,-18],[130,-12],[136,-12],[137,-16],[142,-11],[146,-19],[153,-26],[151,-34],[146,-39],[140,-38],[135,-34],[130,-32],[115,-34],[113,-26]],
  antarctica: [[-180,-71],[-150,-75],[-120,-73],[-90,-72],[-60,-64],[-58,-72],[-30,-72],[0,-70],[40,-68],[80,-67],[110,-66],[140,-67],[170,-72],[180,-71],[180,-90],[-180,-90]],
  uk: [[-5,50],[1,51],[2,53],[-2,56],[-2,58],[-5,58],[-6,56],[-3,54],[-5,52]],
  ireland: [[-10,52],[-6,52],[-6,55],[-10,54]],
  iceland: [[-24,64],[-14,64],[-15,66],[-22,66]],
  honshu: [[131,34],[135,34],[140,35],[142,39],[141,41],[139,40],[136,37],[132,35]],
  hokkaido: [[140,42],[145,43],[142,45]],
  kyushu: [[130,31],[132,33],[130,34]],
  sumatra: [[95,5],[106,-6],[104,-5],[98,0]],
  borneo: [[109,1],[117,7],[119,1],[116,-4],[110,-3]],
  java: [[105,-6],[114,-8],[106,-7]],
  newGuinea: [[131,-1],[141,-3],[150,-10],[141,-9],[137,-5]],
  nzNorth: [[172,-34],[178,-38],[175,-41],[173,-35]],
  nzSouth: [[172,-41],[174,-42],[170,-46],[167,-46]],
  madagascar: [[44,-25],[48,-25],[50,-15],[49,-12],[44,-17]],
  cuba: [[-85,22],[-74,20],[-80,23]],
  philippines: [[120,18],[122,18],[126,8],[122,7],[120,14]],
  srilanka: [[80,9],[82,7],[80,6]],
  taiwan: [[120,22],[122,25],[121,25]],
};

function mulberry32(a) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

// Subdivide each edge and jitter perpendicular to it so coastlines look ragged, not polygonal.
function roughen(poly, rnd) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy);
    const n = Math.max(1, Math.ceil(d / 2.2));
    out.push(a);
    for (let k = 1; k < n; k++) {
      const t = k / n, amp = Math.min(1.1, d / n * 0.45) * (rnd() - 0.5) * 2;
      out.push([a[0] + dx * t - dy / d * amp, a[1] + dy * t + dx / d * amp]);
    }
  }
  return out;
}

// 3D value noise on the unit sphere => no seam at lon = ±180.
function hash3(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const sm = (t) => t * t * (3 - 2 * t);
function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const u = sm(x - xi), v = sm(y - yi), w = sm(z - zi);
  const l = (a, b, t) => a + (b - a) * t;
  return l(
    l(l(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), u), l(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), u), v),
    l(l(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), u), l(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), u), v),
    w);
}
function fbm(x, y, z, oct) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f, z * f); n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}
const mix = (a, b, t) => a + (b - a) * t;
const clamp01 = (t) => Math.max(0, Math.min(1, t));
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

function canvas2d(w = W, h = H) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })];
}

export function buildEarthCanvases() {
  const rnd = mulberry32(7);
  // 1. land mask
  const [maskC, mctx] = canvas2d();
  mctx.fillStyle = '#000'; mctx.fillRect(0, 0, W, H);
  mctx.fillStyle = '#fff';
  for (const poly of Object.values(LAND)) {
    const p = roughen(poly, rnd);
    mctx.beginPath();
    p.forEach(([lo, la], i) => {
      const x = (lo + 180) / 360 * W, y = (90 - la) / 180 * H;
      i ? mctx.lineTo(x, y) : mctx.moveTo(x, y);
    });
    mctx.closePath(); mctx.fill();
  }
  const mask = mctx.getImageData(0, 0, W, H).data;
  // 2. blurred mask => continental shelf
  const [blurC, bctx] = canvas2d();
  bctx.filter = 'blur(9px)'; bctx.drawImage(maskC, 0, 0);
  const blur = bctx.getImageData(0, 0, W, H).data;

  const [colC, cctx] = canvas2d();
  const [rouC, rctx] = canvas2d();
  const [bumC, uctx] = canvas2d();
  const col = cctx.createImageData(W, H), rou = rctx.createImageData(W, H), bum = uctx.createImageData(W, H);

  for (let j = 0; j < H; j++) {
    const lat = 90 - (j + 0.5) / H * 180, la = lat * Math.PI / 180;
    const cl = Math.cos(la), sl = Math.sin(la);
    for (let i = 0; i < W; i++) {
      const lon = (i + 0.5) / W * 360 - 180, lo = lon * Math.PI / 180;
      const px = cl * Math.cos(lo), py = sl, pz = -cl * Math.sin(lo);
      const o = (j * W + i) * 4;
      const land = mask[o] / 255, shelf = blur[o] / 255;
      const n = fbm(px * 5 + 11, py * 5, pz * 5, 5);        // elevation-ish
      const m = fbm(px * 3 - 7, py * 3 + 3, pz * 3, 4);      // moisture-ish
      const a = Math.abs(lat);
      // ocean
      const d = sstep(0.05, 0.65, shelf);
      const ripple = (fbm(px * 40, py * 40, pz * 40, 3) - 0.5) * 0.10;
      let or = mix(7, 34, d) * (1 + ripple), og = mix(34, 118, d) * (1 + ripple), ob = mix(92, 165, d) * (1 + ripple * 0.6);
      // land biomes
      let r = 52, g = 112, b = 52;                                    // forest
      const grass = sstep(0.42, 0.6, 1 - m);
      r = mix(r, 122, grass); g = mix(g, 146, grass); b = mix(b, 62, grass);
      const desert = sstep(8, 18, a) * (1 - sstep(32, 42, a)) * sstep(0.38, 0.55, 1 - m * 1.15);
      r = mix(r, 212, desert); g = mix(g, 176, desert); b = mix(b, 108, desert);
      const tundra = sstep(52, 64, a);
      r = mix(r, 128, tundra); g = mix(g, 132, tundra); b = mix(b, 112, tundra);
      const mount = sstep(0.56, 0.72, n);
      r = mix(r, 130, mount * 0.7); g = mix(g, 112, mount * 0.7); b = mix(b, 96, mount * 0.7);
      const ice = lat < -66 || (lat > 60 && lon > -75 && lon < -12 && land > 0.5) ? 1 : sstep(72, 80, a);
      r = mix(r, 240, ice); g = mix(g, 246, ice); b = mix(b, 250, ice);
      const sh = 0.82 + 0.36 * n;                                     // mottling
      r *= sh; g *= sh; b *= sh;
      // polar sea ice on the ocean
      const pice = sstep(76, 86, a);
      or = mix(or, 220, pice * 0.8); og = mix(og, 232, pice * 0.8); ob = mix(ob, 240, pice * 0.8);
      col.data[o] = mix(or, r, land); col.data[o + 1] = mix(og, g, land); col.data[o + 2] = mix(ob, b, land); col.data[o + 3] = 255;
      const ro = mix(mix(70, 110, pice), 215, land) ; // ocean glossy, land matte (G channel)
      rou.data[o] = rou.data[o + 1] = rou.data[o + 2] = ro; rou.data[o + 3] = 255;
      const hgt = land * (60 + 195 * Math.max(0, n - 0.35) * 1.6);
      bum.data[o] = bum.data[o + 1] = bum.data[o + 2] = Math.min(255, hgt); bum.data[o + 3] = 255;
    }
  }
  cctx.putImageData(col, 0, 0); rctx.putImageData(rou, 0, 0); uctx.putImageData(bum, 0, 0);

  // graticule every 30 degrees: gives the open ocean something for the two eyes to fuse on
  cctx.strokeStyle = 'rgba(255,255,255,0.16)'; cctx.lineWidth = 1.6;
  cctx.beginPath();
  for (let lo = -180; lo <= 180; lo += 30) { const x = (lo + 180) / 360 * W; cctx.moveTo(x, 0); cctx.lineTo(x, H); }
  for (let la = -60; la <= 60; la += 30) { const y = (90 - la) / 180 * H; cctx.moveTo(0, y); cctx.lineTo(W, y); }
  cctx.stroke();
  return { color: colC, rough: rouC, bump: bumC };
}
