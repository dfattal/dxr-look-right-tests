// Orrery — an animated tabletop solar system for a DisplayXR spatial display.
//
// Rig: the DEFAULT DISPLAY RIG (the canvas is a portal onto a virtual display), via SceneViewer.
// The subject is a diorama the user turns, not a world they move through, so per the SDK docs it
// belongs on a display rig: the system is centred on the glass (z = 0) at its real proportions
// and the user's drag rotates the system, never a camera.
//
// SceneViewer owns the stereo loop (validate-before-clear, replay of the last good frame,
// non-destructive resize, device-limit clamp, tracking ease) and the 2D fallback.

import * as THREE from 'three';
import { createInline3D, inline3dViewRigSupported } from '@displayxr/inline3d';
import { EyeCamera, displayRig } from '@displayxr/inline3d/three';
import { SceneViewer } from '@displayxr/inline3d/viewer';

const DEBUG = new URLSearchParams(location.search).has('debug');

const canvas = document.getElementById('scene');
const stage = document.getElementById('stage');
const cover = document.getElementById('cover');
const statusEl = document.getElementById('status');

// ---- depth constants ------------------------------------------------------------------------
// Virtual display height in metres: the SDK default. On a display rig depth is scale-invariant
// (the runtime scales the eyes by VH / physical tile height), so this only fixes the units the
// backdrop and fit are expressed in.
const VH = 0.24;
// Initial tilt of the table (degrees, + = looking down onto it). A steeper look-down turns the
// disc's depth into height: at 38° the disc's depth is cos38 ≈ 0.79 of its width instead of 1.0,
// and the fit then binds on height, which keeps the whole system closer to the glass.
const PITCH0 = 38;
// Pitch the user may drag to. Never edge-on (the disc would become one deep line) or underneath.
const PITCH_LIMIT = [15, 55];
const BG = 0x0e1017; // page + backdrop base: dark grey-blue, NOT black (crosstalk rule)

// ---- viewer ---------------------------------------------------------------------------------
const viewer = new SceneViewer(THREE, canvas, {
  virtualDisplayHeight: VH,
  fit: 'contain',      // SDK default: the subject fills `margin` of the tile, centred on z = 0
  margin: 0.8,         // SDK default
  fitSweep: false,     // the disc is rotationally symmetric: its width is the same at every yaw
  idleSpin: 0,         // the planets already move; a turntable on top reads as noise
  pitchLimit: PITCH_LIMIT,
});
viewer.useEyeCamera(EyeCamera);
const renderer = viewer.renderer;
// Opaque clear: a transparent woven canvas weaves BLACK on current browsers, and the backdrop
// below covers the frame anyway. This is the safety colour for any pixel it doesn't reach.
renderer.setClearColor(BG, 1);

// Wheel zoom is disabled (the wheel scrolls the page instead): zooming in would scale the
// system's depth past the planned budget and through the starfield.
stage.addEventListener('wheel', (e) => e.stopPropagation(), { capture: true });

// ---- procedural textures --------------------------------------------------------------------
function hash3(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const l = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz);
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v),
    l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v), w);
}
function fbm(x, y, z, oct = 5) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f, z * f); n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const sstep = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

// Equirectangular texture sampled on the unit sphere, so there is no seam and no pole pinch.
function planetTexture(w, h, colorAt) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const lat = (0.5 - (y + 0.5) / h) * Math.PI;
    const cl = Math.cos(lat), sl = Math.sin(lat);
    for (let x = 0; x < w; x++) {
      const lon = ((x + 0.5) / w) * Math.PI * 2;
      const col = colorAt(cl * Math.cos(lon), sl, cl * Math.sin(lon));
      const i = (y * w + x) * 4;
      img.data[i] = col[0] * 255; img.data[i + 1] = col[1] * 255; img.data[i + 2] = col[2] * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const TEX = {
  cinder: () => planetTexture(256, 128, (x, y, z) => {
    const n = fbm(x * 3 + 7, y * 3, z * 3);
    const crater = sstep(0.62, 0.7, fbm(x * 9, y * 9 + 3, z * 9, 3));
    let c = mix([0.36, 0.31, 0.28], [0.72, 0.62, 0.52], n);
    return mix(c, [0.25, 0.21, 0.19], crater * 0.6);
  }),
  azure: () => planetTexture(512, 256, (x, y, z) => {
    const n = fbm(x * 2.2 + 11, y * 2.2, z * 2.2);
    let c = n < 0.52 ? mix([0.05, 0.16, 0.38], [0.12, 0.36, 0.62], n / 0.52)
      : mix([0.24, 0.44, 0.2], [0.58, 0.5, 0.33], sstep(0.52, 0.72, n));
    const ice = sstep(0.82, 0.9, Math.abs(y) + (n - 0.5) * 0.2);
    c = mix(c, [0.92, 0.95, 0.98], ice);
    const cloud = sstep(0.5, 0.72, fbm(x * 4 + 40, y * 6, z * 4));
    return mix(c, [0.97, 0.97, 0.98], cloud * 0.85);
  }),
  moon: () => planetTexture(128, 64, (x, y, z) => {
    const n = fbm(x * 4, y * 4 + 9, z * 4, 4);
    return mix([0.42, 0.42, 0.44], [0.78, 0.77, 0.75], n);
  }),
  rust: () => planetTexture(256, 128, (x, y, z) => {
    const n = fbm(x * 2.6 + 3, y * 2.6, z * 2.6);
    let c = mix([0.48, 0.2, 0.1], [0.86, 0.5, 0.3], n);
    c = mix(c, [0.3, 0.14, 0.1], sstep(0.55, 0.65, fbm(x * 5, y * 5 + 20, z * 5, 3)) * 0.7);
    return mix(c, [0.95, 0.9, 0.86], sstep(0.9, 0.95, Math.abs(y)));
  }),
  halcyon: () => planetTexture(512, 256, (x, y, z) => {
    const warp = fbm(x * 3, y * 3, z * 3, 4) - 0.5;
    const b = Math.sin((y + warp * 0.18) * 22) * 0.5 + 0.5;
    const b2 = Math.sin((y + warp * 0.1) * 57) * 0.5 + 0.5;
    let c = mix([0.62, 0.46, 0.3], [0.93, 0.85, 0.68], b);
    return mix(c, [0.78, 0.6, 0.42], b2 * 0.35);
  }),
};

function ringTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 1;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(256, 1);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    const bands = 0.55 + 0.45 * Math.sin(t * 60) * Math.sin(t * 17 + 1);
    const gap = 1 - sstep(0.6, 0.62, t) * (1 - sstep(0.66, 0.68, t)) * 0.85;
    const edge = sstep(0, 0.06, t) * (1 - sstep(0.92, 1, t));
    const a = bands * gap * edge * 0.85;
    img.data[i * 4] = 225; img.data[i * 4 + 1] = 205; img.data[i * 4 + 2] = 170;
    img.data[i * 4 + 3] = a * 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(255,230,170,1)');
  g.addColorStop(0.25, 'rgba(255,180,90,0.45)');
  g.addColorStop(0.6, 'rgba(255,130,50,0.08)');
  g.addColorStop(1, 'rgba(255,120,40,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---- the system (model units; SceneViewer fits it to the tile) -------------------------------
const SUN_R = 1.2;
const PLANETS = [
  { name: 'cinder', a: 2.7, r: 0.32, period: 7, spin: 3.0, tilt: 0.05, phase: 0.6 },
  { name: 'azure', a: 4.3, r: 0.52, period: 14, spin: 5.0, tilt: 0.41, phase: 2.4,
    moon: { a: 0.95, r: 0.14, period: 3.4, incl: 0.12 } },
  { name: 'rust', a: 6.0, r: 0.42, period: 24, spin: 4.6, tilt: 0.44, phase: 4.1 },
  { name: 'halcyon', a: 8.3, r: 0.95, period: 40, spin: 7.5, tilt: 0.47, phase: 5.5,
    ring: { inner: 1.3, outer: 2.1 } },
];
// Outer radius of everything that moves: Halcyon's orbit plus its ring.
const SYS_R = 8.3 + 0.95 * 2.1;

const system = new THREE.Group();
viewer.content.add(system);

// Sun: an animated emissive surface. Written in display values (no tone mapping) so it is bright
// but not clipped flat — a blown-out disc loses the surface detail that helps fuse it.
const sunMat = new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 } },
  vertexShader: /* glsl */`
    varying vec3 vObj; varying vec3 vN; varying vec3 vW;
    void main() {
      vObj = position; vN = normalize(mat3(modelMatrix) * normal);
      vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w;
    }`,
  fragmentShader: /* glsl */`
    uniform float uTime; varying vec3 vObj; varying vec3 vN; varying vec3 vW;
    float h(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7))) * 43758.5453); }
    float n3(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
      return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),
                 mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z); }
    float fbm(vec3 p){ float s=0.0,a=0.5; for(int i=0;i<5;i++){ s+=a*n3(p); p*=2.02; a*=0.5; } return s; }
    void main() {
      vec3 p = normalize(vObj) * 3.0;
      float n = fbm(p + vec3(0.0, uTime * 0.05, uTime * 0.03));
      float g = fbm(p * 2.5 - vec3(uTime * 0.04));
      float mu = clamp(dot(normalize(vN), normalize(cameraPosition - vW)), 0.0, 1.0);
      vec3 c = mix(vec3(0.95, 0.42, 0.08), vec3(1.0, 0.86, 0.5), smoothstep(0.3, 0.75, n));
      c = mix(c, vec3(1.0, 0.95, 0.78), smoothstep(0.55, 0.8, g) * 0.5);
      c *= 0.55 + 0.45 * pow(mu, 0.5);             // limb darkening
      gl_FragColor = vec4(c, 1.0);
    }`,
});
const sun = new THREE.Mesh(new THREE.SphereGeometry(SUN_R, 64, 32), sunMat);
system.add(sun);

const glowTex = glowTexture();
for (const [scale, opacity] of [[SUN_R * 4.2, 0.85], [SUN_R * 8.5, 0.3]]) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity,
  }));
  s.scale.setScalar(scale);
  system.add(s);
}

// Sunlight, plus a dim cool fill so night sides read as dark grey, not black holes.
system.add(new THREE.PointLight(0xfff1dc, 2.0, 0, 0));
system.add(new THREE.AmbientLight(0x5a6684, 0.35));

function orbitLine(radius, color, opacity) {
  const pts = [];
  for (let i = 0; i < 192; i++) {
    const t = (i / 192) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(t) * radius, 0, Math.sin(t) * radius));
  }
  return new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
}

const orbitLines = [];
const bodies = [];
for (const p of PLANETS) {
  const line = orbitLine(p.a, 0x8d97b8, 0.28);
  system.add(line); orbitLines.push(line);

  const pivot = new THREE.Group();          // rotates: the orbit
  system.add(pivot);
  const anchor = new THREE.Group();         // sits on the orbit, does not spin
  anchor.position.x = p.a;
  pivot.add(anchor);
  const tilt = new THREE.Group();           // axial tilt
  tilt.rotation.z = p.tilt;
  anchor.add(tilt);
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(p.r, 48, 24),
    new THREE.MeshStandardMaterial({ map: TEX[p.name](), roughness: 0.85, metalness: 0 }),
  );
  tilt.add(mesh);

  const body = { p, pivot, anchor, mesh, moonPivot: null };
  if (p.ring) {
    const g = new THREE.RingGeometry(p.r * p.ring.inner, p.r * p.ring.outer, 128, 1);
    // Radial UVs so the 1-D band texture runs from the inner to the outer edge.
    const pos = g.attributes.position, uv = g.attributes.uv, v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      uv.setXY(i, (v.length() - p.r * p.ring.inner) / (p.r * (p.ring.outer - p.ring.inner)), 0.5);
    }
    const ring = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
      map: ringTexture(), transparent: true, side: THREE.DoubleSide, depthWrite: false,
      roughness: 1, metalness: 0,
    }));
    ring.rotation.x = -Math.PI / 2;
    tilt.add(ring);
  }
  if (p.moon) {
    const m = p.moon;
    const incl = new THREE.Group();
    incl.rotation.z = m.incl;
    anchor.add(incl);
    const ml = orbitLine(m.a, 0x8d97b8, 0.2);
    incl.add(ml); orbitLines.push(ml);
    const moonPivot = new THREE.Group();
    incl.add(moonPivot);
    const moon = new THREE.Mesh(new THREE.SphereGeometry(m.r, 32, 16),
      new THREE.MeshStandardMaterial({ map: TEX.moon(), roughness: 0.95, metalness: 0 }));
    moon.position.x = m.a;
    moonPivot.add(moon);
    body.moonPivot = moonPivot;
  }
  bodies.push(body);
}

// ---- starfield backdrop (display space, NOT in viewer.content) ------------------------------
// One plane just behind the back edge of the system, so stars never sit in front of a planet
// and stay as close to the glass as the scene allows. It lives in viewer.scene, so dragging
// turns the system in front of a fixed sky. Content is deliberately low-contrast: stars are
// soft and capped well below white, and the nebula is low-frequency. High-contrast detail far
// behind the glass is what doubles first on a lenticular panel.
const backdropMat = new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 } },
  depthWrite: false,
  vertexShader: /* glsl */`
    varying vec2 vP;
    void main() {
      vec4 w = modelMatrix * vec4(position, 1.0);
      vP = w.xy;                      // display metres: star density independent of tile size
      gl_Position = projectionMatrix * viewMatrix * w;
    }`,
  fragmentShader: /* glsl */`
    uniform float uTime; varying vec2 vP;
    float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
      return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); }
    float fbm(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<5;i++){ s+=a*n2(p); p*=2.03; a*=0.5; } return s; }
    // One star layer: at most one soft star per cell, centre kept off the cell border.
    vec3 stars(vec2 p, float cell, float density, float peak, float seed) {
      vec2 g = p / cell, id = floor(g), f = fract(g);
      float r = h(id + seed);
      if (r > density) return vec3(0.0);
      vec2 c = 0.25 + 0.5 * vec2(h(id + seed + 3.1), h(id + seed + 7.7));
      float d = length((f - c) * cell);
      float b = pow(h(id + seed + 1.7), 3.0);          // mostly faint, a few brighter
      float sigma = cell * (0.045 + 0.04 * b);
      float tw = 0.85 + 0.15 * sin(uTime * (0.8 + 2.0 * h(id + 5.3)) + 6.28 * h(id + 9.1));
      vec3 tint = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.88, 0.72), h(id + seed + 4.4));
      return tint * peak * (0.25 + 0.75 * b) * tw * exp(-d * d / (sigma * sigma));
    }
    void main() {
      vec3 base = vec3(0.055, 0.063, 0.090);            // == page background #0e1017
      vec2 q = vP * 7.0;
      float n = fbm(q + vec2(3.0, 1.0));
      float m = fbm(q * 1.7 - vec2(n * 1.5, 0.0));
      vec3 neb = mix(vec3(0.10, 0.05, 0.16), vec3(0.03, 0.11, 0.14), m);
      vec3 col = base + neb * smoothstep(0.45, 0.85, n) * 0.55;
      col += stars(vP, 0.0045, 0.55, 0.42, 0.0);
      col += stars(vP, 0.012, 0.35, 0.62, 17.0);
      gl_FragColor = vec4(col, 1.0);
    }`,
});
const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), backdropMat);
backdrop.renderOrder = -1;
viewer.scene.add(backdrop);

// ---- framing --------------------------------------------------------------------------------
// fitTo takes the subject's MODEL-space box. Its height is given as the tilted disc's projected
// height at PITCH0 (not the disc's thickness), so 'contain' sizes the system to what the viewer
// actually sees and binds on height on a 16:9 tile — which is also what keeps the depth modest.
const P0 = THREE.MathUtils.degToRad(PITCH0);
const FIT_EXTENT = [2 * SYS_R, 2 * SYS_R * Math.sin(P0) + 2 * SUN_R * Math.cos(P0), 2 * SYS_R];
function frame() {
  viewer.fitTo([0, 0, 0], FIT_EXTENT);
  const box = canvas.getBoundingClientRect();
  const aspect = box.height > 0 ? box.width / box.height : 16 / 9;
  // Generous: head-tracked eyes look obliquely through the portal and the plane is behind it.
  backdrop.scale.set(VH * aspect * 3, VH * 3, 1);
}
frame();
viewer.setPose({ yaw: 0, pitch: PITCH0, zoom: 1 });
new ResizeObserver(frame).observe(canvas);

// Keep the backdrop just behind the system's far edge under the live tilt (display metres).
function placeBackdrop() {
  const { pitch } = viewer.getPose();
  const s = viewer.getSubjectBounds().scale;
  const pr = THREE.MathUtils.degToRad(pitch);
  const back = s * (SYS_R * Math.cos(pr) + 1.0 * Math.sin(pr));
  backdrop.position.z = -back - 0.006;
}

// ---- animation ------------------------------------------------------------------------------
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let playing = true;
let speed = reduceMotion ? 0.4 : 1;
let simT = 0;
let lastT = 0;
const TAU = Math.PI * 2;

viewer.onTick = () => {
  const t = performance.now();
  const dt = lastT ? Math.min((t - lastT) / 1000, 0.1) : 0;
  lastT = t;
  if (playing) simT += dt * speed;
  sunMat.uniforms.uTime.value = t / 1000;
  backdropMat.uniforms.uTime.value = t / 1000;
  sun.rotation.y = simT * 0.08;
  for (const b of bodies) {
    b.pivot.rotation.y = b.p.phase + (simT / b.p.period) * TAU;
    // Keep the anchor's frame fixed in space so the axial tilt does not wobble around the orbit.
    b.anchor.rotation.y = -b.pivot.rotation.y;
    b.mesh.rotation.y = (simT / b.p.spin) * TAU;
    if (b.moonPivot) b.moonPivot.rotation.y = (simT / b.p.moon.period) * TAU;
  }
  placeBackdrop();
};

// ---- controls -------------------------------------------------------------------------------
const playBtn = document.getElementById('play');
playBtn.addEventListener('click', () => {
  playing = !playing;
  playBtn.textContent = playing ? 'Pause' : 'Play';
});
const speedIn = document.getElementById('speed');
const speedOut = document.getElementById('speedOut');
const showSpeed = () => {
  speedOut.textContent = `${speed < 1 ? speed.toFixed(2) : speed.toFixed(1)}×`;
};
speedIn.value = String(Math.log2(speed));
showSpeed();
speedIn.addEventListener('input', () => { speed = Math.pow(2, parseFloat(speedIn.value)); showSpeed(); });
document.getElementById('orbits').addEventListener('change', (e) => {
  for (const l of orbitLines) l.visible = e.target.checked;
});
document.getElementById('reset').addEventListener('click', () => {
  viewer.setPose({ yaw: 0, pitch: PITCH0, zoom: 1, depthOffset: 0 });
});

// ---- boot -----------------------------------------------------------------------------------
let coverDone = false;
function dropCover() {
  if (coverDone) return;
  coverDone = true;
  cover.hidden = true; // hard cut, never a fade
}
// Rule: a cover must always come off, whatever happens below.
setTimeout(dropCover, 7000);

function goFlat(msg) {
  viewer.startMono();
  statusEl.textContent = msg;
  dropCover();
}

(async () => {
  try {
    const wall = await createInline3D({ lazy: false });
    if (!wall.supported) {
      goFlat('2D view — open in the DisplayXR Browser on a 3D display for depth');
      return;
    }
    // The viewer already sized the backing store 2:1 for stereo. Let the compositor see a
    // settled canvas for two frames before registering it (woven-canvas rule 4).
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const handle = wall.addScene(canvas, viewer.onFrame, {
      virtualDisplayHeight: VH,
      onLayerLost: () => { viewer.onLayerLost(); statusEl.textContent = '2D view'; dropCover(); },
      // A resize after the first join re-registers the rect: cover it with the last frame.
      rectCover: { color: '#0e1017', snapshot: true },
    });
    statusEl.innerHTML = '<b>Glasses-free 3D</b> · move your head to look around';

    // Optional comfort dial: the display rig's RELATIVE eye separation (1 = the display's own).
    if (inline3dViewRigSupported()) {
      const depthCtl = document.getElementById('depthCtl');
      const depthIn = document.getElementById('depth');
      const depthOut = document.getElementById('depthOut');
      const rig = {};
      depthCtl.hidden = false;
      depthIn.addEventListener('input', () => {
        const f = parseFloat(depthIn.value);
        depthOut.textContent = `${Math.round(f * 100)}%`;
        handle.setViewRig(displayRig({ virtualDisplayHeight: VH, ipdFactor: f, out: rig }));
      });
    }

    const res = await handle.firstWoven;
    dropCover();
    if (DEBUG) {
      console.log('[orrery] firstWoven', res);
      setInterval(() => console.log('[orrery] stats', handle.stats(), viewer.getSubjectBounds(),
        'backdrop z', backdrop.position.z.toFixed(3)), 5000);
    }
  } catch (err) {
    console.error('[orrery] inline-3D setup failed, showing 2D', err);
    goFlat('2D view');
  }
})();
