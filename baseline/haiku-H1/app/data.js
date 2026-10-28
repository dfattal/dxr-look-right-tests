// Data for the globe page: the five cities, and a hand-drawn, deliberately rough land outline.
// No texture is downloaded; app.js colours the sphere's vertices from these polygons.

// Population figures are approximate. Each one names its area and year, because city, metro and
// urban-area numbers differ by a factor of two or more (Tokyo is ~14 M as a city, ~37 M as a metro).
export const CITIES = [
  {
    id: 'london',
    name: 'London',
    country: 'United Kingdom',
    lat: 51.5074,
    lon: -0.1278,
    population: '≈ 9.0 million',
    basis: 'Greater London, ONS estimate (c. 2023)',
  },
  {
    id: 'tokyo',
    name: 'Tokyo',
    country: 'Japan',
    lat: 35.6762,
    lon: 139.6503,
    population: '≈ 14.0 million',
    basis: 'Tokyo Metropolis, 2023 estimate',
  },
  {
    id: 'new-york',
    name: 'New York',
    country: 'United States',
    lat: 40.7128,
    lon: -74.006,
    population: '≈ 8.3 million',
    basis: 'New York City, 2023 Census Bureau estimate',
  },
  {
    id: 'sydney',
    name: 'Sydney',
    country: 'Australia',
    lat: -33.8688,
    lon: 151.2093,
    population: '≈ 5.4 million',
    basis: 'Greater Sydney, ABS estimate (c. 2022)',
  },
  {
    id: 'nairobi',
    name: 'Nairobi',
    country: 'Kenya',
    lat: -1.2921,
    lon: 36.8219,
    population: '≈ 4.4 million',
    basis: 'Nairobi County, 2019 census (4.39 M)',
  },
];

// Outlines as [longitude, latitude] in degrees. Simplified on purpose: they read as continents at
// globe scale and nothing more. Hudson Bay, the Caspian and the Baltic are not carved out.
const NORTH_AMERICA = [
  [-168, 66], [-156, 71], [-141, 70], [-128, 70], [-115, 68], [-95, 69], [-82, 68], [-80, 63],
  [-94, 59], [-88, 56], [-78, 55], [-78, 60], [-70, 60], [-62, 58], [-56, 52], [-60, 47],
  [-66, 45], [-70, 42], [-74, 40], [-76, 37], [-76, 35], [-81, 31], [-80, 26], [-82, 27],
  [-84, 30], [-89, 30], [-94, 29], [-97, 27], [-97, 22], [-95, 18], [-91, 19], [-90, 21],
  [-87, 21], [-88, 16], [-84, 15], [-83, 11], [-79, 9], [-77, 8], [-80, 7], [-84, 9],
  [-87, 13], [-92, 14], [-96, 16], [-105, 20], [-110, 24], [-112, 30], [-115, 31], [-117, 32],
  [-121, 35], [-124, 40], [-124, 46], [-125, 49], [-130, 54], [-138, 58], [-146, 61], [-152, 59],
  [-158, 57], [-164, 55], [-162, 59], [-165, 62], [-161, 64], [-168, 66],
];

const SOUTH_AMERICA = [
  [-77, 8], [-72, 12], [-64, 10], [-60, 8], [-52, 5], [-50, 0], [-44, -2], [-35, -5],
  [-39, -13], [-41, -22], [-48, -26], [-53, -34], [-58, -38], [-62, -40], [-65, -45], [-68, -50],
  [-69, -53], [-72, -54], [-74, -50], [-74, -40], [-72, -30], [-70, -18], [-76, -14], [-81, -6],
  [-80, -2], [-80, 1], [-77, 4],
];

const EURASIA = [
  [-9, 37], [-9, 43], [-2, 44], [-1, 46], [-4, 48], [2, 51], [5, 53], [8, 54], [9, 57], [11, 57],
  [11, 54], [20, 55], [21, 57], [24, 59], [30, 60], [23, 60], [21, 63], [25, 65], [22, 66],
  [17, 62], [18, 59], [15, 56], [12, 56], [7, 58], [5, 62], [13, 68], [25, 71], [40, 67],
  [44, 68], [60, 69], [70, 73], [80, 73], [100, 78], [113, 74], [130, 71], [150, 71], [170, 70],
  [180, 69], [180, 65], [163, 60], [156, 51], [163, 57], [156, 61], [142, 59], [138, 54],
  [140, 48], [131, 43], [129, 40], [126, 35], [129, 35], [126, 38], [122, 40], [118, 38],
  [121, 31], [119, 25], [110, 21], [106, 20], [109, 12], [105, 9], [101, 13], [100, 8],
  [103, 1], [98, 8], [98, 16], [93, 19], [90, 22], [80, 15], [77, 8], [72, 21], [67, 25],
  [57, 25], [52, 24], [48, 29], [35, 29], [34, 31], [36, 36], [30, 36], [26, 40], [23, 40],
  [22, 37], [20, 40], [19, 42], [13, 45], [12, 44], [16, 41], [18, 40], [16, 38], [12, 42],
  [8, 44], [3, 43], [-1, 37], [-5, 36],
];

const AFRICA = [
  [-17, 21], [-16, 28], [-10, 30], [-6, 35], [10, 37], [11, 33], [20, 31], [32, 31], [34, 28],
  [38, 22], [43, 12], [51, 11], [48, 5], [40, -3], [39, -10], [41, -16], [35, -24], [32, -29],
  [27, -34], [19, -35], [15, -27], [12, -17], [13, -10], [9, -1], [9, 4], [5, 6], [-2, 5],
  [-8, 4], [-13, 8], [-17, 14],
];

const AUSTRALIA = [
  [114, -22], [122, -18], [130, -12], [137, -12], [137, -16], [142, -11], [146, -19], [153, -26],
  [151, -34], [146, -39], [140, -38], [135, -35], [131, -31], [124, -33], [115, -34], [113, -26],
];

// Islands: small enough to matter at globe scale, big enough to be recognisable.
const ISLANDS = [
  [[-73, 78], [-60, 82], [-30, 83], [-20, 80], [-18, 72], [-25, 68], [-40, 65], [-44, 60], [-50, 64], [-55, 70], [-68, 76]], // Greenland
  [[-5, 50], [1, 51], [2, 53], [-2, 56], [-3, 58.5], [-6, 57], [-5, 55], [-3, 54], [-5, 52]], // Great Britain
  [[-10, 52], [-6, 52], [-6, 55], [-8, 55], [-10, 54]], // Ireland
  [[130, 31], [136, 34], [140, 35], [141, 41], [142, 45], [140, 42], [138, 38], [133, 35]], // Japan
  [[44, -25], [47, -25], [50, -15], [49, -12], [44, -17]], // Madagascar
  [[172, -34], [178, -38], [175, -41], [172, -44], [167, -46], [169, -41]], // New Zealand
  [[-24, 65], [-14, 66], [-14, 64], [-22, 63]], // Iceland
  [[95, 5], [106, -6], [103, -5], [95, 2]], // Sumatra
  [[109, 1], [117, 7], [119, 1], [116, -4], [110, -3]], // Borneo
  [[131, -1], [141, -3], [150, -10], [141, -9], [137, -5]], // New Guinea
];

export const LANDMASSES = [NORTH_AMERICA, SOUTH_AMERICA, EURASIA, AFRICA, AUSTRALIA, ...ISLANDS];

// Rough arid regions, drawn lighter. [lonMin, lonMax, latMin, latMax].
export const DESERTS = [
  [-12, 33, 18, 30], // Sahara
  [40, 55, 18, 30], // Arabia
  [125, 140, -32, -20], // Australian interior
  [78, 110, 38, 46], // Gobi and Taklamakan
  [18, 26, -28, -19], // Kalahari
];
