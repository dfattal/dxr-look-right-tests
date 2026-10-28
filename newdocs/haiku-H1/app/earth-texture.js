// A procedural Earth map, drawn once into a canvas (no texture download).
//
// The canvas is equirectangular: column 0 is longitude -180, the centre column is 0, and the top
// row is the North Pole. That is the layout three.js's SphereGeometry expects for a CanvasTexture,
// and the same layout `latLonToNormal` in app.js uses to place the city markers.
//
// The continents are rough outlines in [longitude, latitude] degrees. They only need to read as
// land masses, and the city markers must sit on land.
//
// The colours are close in value (muted sea, muted land). A high-contrast coastline ghosts across
// the panel's crosstalk, so the map stays soft.

const LAND = [
  // Eurasia (one outline, coast-to-coast, including the Mediterranean shores)
  [[-9,43],[-2,44],[-1,46],[-2,48],[-5,48],[2,51],[5,52],[8,54],[8,57],[10,57],[12,56],[18,59],[17,62],[22,66],[25,65.5],[21,64],[23,60],[28,60],[30,60],[38,66],[44,68],[60,69],[70,73],[80,73],[88,75],[100,77],[110,74],[120,73],[130,71],[140,72],[150,71],[160,70],[170,70],[180,68],[180,65],[178,63],[170,60],[163,58],[162,55],[156,51],[156,57],[160,61],[150,59],[142,59],[137,54],[141,52],[140,48],[135,43],[130,42],[129,36],[126,35],[126,38],[125,40],[121,40],[122,37],[119,35],[121,31],[122,30],[117,23],[110,21],[108,21.5],[106,19],[109,12],[105,9],[103,10.5],[100,13],[100,8],[103,3],[101,3],[98,8],[98,15],[94,17],[92,22],[90,22],[87,21],[80,15],[77,8],[73,17],[72,21],[68,24],[57,25],[56,27],[50,30],[48,30],[51,25],[56,26],[59,22],[52,16],[43,13],[39,21],[35,28],[34,31],[36,36],[30,36],[27,37],[26,40.5],[23,40],[24,38],[22,37],[19,40],[16,41],[12,44],[8,44],[3,43],[0,38.5],[-5,36],[-9,37]],
  // Africa
  [[-17,21],[-16,28],[-10,30],[-6,36],[10,37],[11,33],[20,31],[30,31.5],[33,28],[35,28],[39,21],[43,12],[51,12],[49,6],[41,-2],[40,-10],[40,-16],[35,-22],[33,-27],[27,-34],[19,-35],[15,-27],[12,-18],[13,-10],[9,-1],[9,4],[4,6],[-4,5],[-8,4.5],[-13,8],[-17,14]],
  [[44,-25],[47,-25],[50,-15],[49,-12],[44,-17]],                           // Madagascar
  // The Americas
  [[-168,66],[-156,71],[-140,70],[-125,70],[-110,73],[-95,72],[-82,69],[-80,63],[-94,59],[-93,56],[-85,55],[-78,58],[-77,62],[-64,60],[-61,56],[-56,52],[-66,48],[-70,45],[-70,42],[-76,38],[-76,35],[-81,31],[-80,26],[-82,27],[-83,30],[-89,30],[-94,29.5],[-97,27],[-97,22],[-95,18],[-91,19],[-90,21],[-87,21],[-88,16],[-84,15.5],[-83,10],[-79,9],[-81,7],[-86,12],[-92,14.5],[-96,16],[-105,20],[-106,23],[-112,29],[-110,23],[-115,30],[-118,34],[-121,35],[-124,40],[-124,46],[-127,50],[-131,55],[-136,58],[-146,61],[-152,59],[-158,57],[-164,55],[-158,58],[-162,60],[-165,62]],
  [[-78,8],[-72,12],[-63,10.5],[-52,5],[-50,0],[-44,-2],[-35,-6],[-39,-14],[-41,-22],[-48,-26],[-53,-34],[-58,-38],[-62,-40],[-65,-45],[-68,-50],[-70,-54],[-74,-50],[-74,-42],[-72,-30],[-71,-18],[-76,-14],[-81,-6],[-80,-2],[-78,2],[-77,7]],
  [[-73,78],[-60,82],[-30,83],[-20,80],[-22,70],[-30,68],[-42,60],[-50,62],[-53,67],[-56,71],[-66,76]],   // Greenland
  // Islands
  [[-5,50],[1,51],[2,53],[-1,55],[-2,57],[-5,58.5],[-6,56],[-3,54],[-5,52]],     // Great Britain
  [[-10,52],[-6,52],[-6,55],[-9,54]],                                            // Ireland
  [[-24,65],[-14,66],[-14,64],[-22,63.5]],                                       // Iceland
  [[130.5,33.5],[135,34],[140,35],[141,39],[142,40],[140,41],[138,38],[135,36],[131,34.5]], // Honshu
  [[140,42],[145,43],[142,45],[140,43]],                                         // Hokkaido
  [[95,5.5],[98,4],[106,-6],[104,-5],[95.5,0]],                                  // Sumatra
  [[109,1.5],[117,7],[119,1],[116,-4],[110,-3]],                                 // Borneo
  [[105,-6],[114,-7],[114,-8.5],[106,-7.5]],                                     // Java
  [[131,-1],[141,-3],[150,-10],[141,-9],[137,-5]],                               // New Guinea
  [[120,18],[122,18],[124,12],[126,7],[122,7],[120,14]],                         // Philippines
  [[80,9.5],[82,7],[81,6],[80,6.5]],                                             // Sri Lanka
  [[114,-22],[122,-18],[130,-12],[137,-12],[137,-16],[142,-11],[146,-19],[153,-25],[150,-37],[146,-39],[140,-38],[135,-34],[131,-31],[124,-34],[115,-34],[113,-26]], // Australia
  [[173,-35],[178,-37.5],[175,-41.5],[172.5,-40.5]],                             // New Zealand, north
  [[174,-41.5],[171,-44],[167,-46],[170,-46.5],[173.5,-43]],                     // New Zealand, south
];

// Antarctica is drawn as ice, so it is the one light shape on the map.
const ICE = [[-180,-72],[-120,-74],[-60,-66],[-30,-70],[0,-71],[60,-67],[90,-66],[120,-67],[150,-68],[180,-72],[180,-90],[-180,-90]];

// A seeded generator, so the texture is the same on every load.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Draw the Earth into a new canvas.
 * @param {number} [width=1024]  width in px (a 2:1 map).
 * @param {number} [height=512]
 * @returns {HTMLCanvasElement}
 */
export function makeEarthCanvas(width = 1024, height = 512) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d');
  const rnd = mulberry32(20260);

  // Sea: a slightly deeper blue at the equator than at the poles.
  const sea = g.createLinearGradient(0, 0, 0, height);
  sea.addColorStop(0, '#2b5c84');
  sea.addColorStop(0.5, '#24527a');
  sea.addColorStop(1, '#2b5c84');
  g.fillStyle = sea;
  g.fillRect(0, 0, width, height);

  // Map (lon, lat) in degrees to canvas pixels.
  const toPx = ([lon, lat]) => [((lon + 180) / 360) * width, ((90 - lat) / 180) * height];
  const pathOf = (pts) => {
    const path = new Path2D();
    pts.forEach((p, i) => {
      const [x, y] = toPx(p);
      if (i === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    });
    path.closePath();
    return path;
  };

  // Land: one flat muted green, then low-contrast mottling clipped to the shape, so the surface
  // reads as terrain without any sharp edges.
  const tones = ['#6d8c53', '#5a7a46', '#86845a', '#7a6f4f'];
  for (const pts of LAND) {
    const path = pathOf(pts);
    g.fillStyle = '#617f4b';
    g.fill(path);
    g.save();
    g.clip(path);
    for (let i = 0; i < 900; i++) {
      g.globalAlpha = 0.12 + rnd() * 0.18;
      g.fillStyle = tones[(rnd() * tones.length) | 0];
      g.fillRect(rnd() * width, rnd() * height, 2 + rnd() * 6, 2 + rnd() * 4);
    }
    g.restore();
  }

  g.globalAlpha = 1;
  g.fillStyle = '#dfe7ec';
  g.fill(pathOf(ICE));
  return canvas;
}
