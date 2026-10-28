// Orrery — an animated tabletop solar system for a glasses-free 3D (lenticular) display.
//
// Rendering: the DisplayXR inline-3D SDK, DISPLAY rig (the canvas is a portal onto a virtual
// display VH metres tall; the runtime places the eyes and computes the off-axis frusta). The
// SDK's SceneViewer drives the per-eye loop: frame validation + last-good replay, the 2:1
// backing store, resize handling, the tracking ease, edge feathering and the 2D fallback.
//
// Units: metres in DISPLAY space. z = 0 is the glass (zero disparity), +z comes out toward the
// viewer, −z goes behind it. See NOTES.md for why every depth number below is what it is.

import * as THREE from 'three';

// ---- depth & framing (all in display metres) ----------------------------------------------
const VH = 0.24;               // virtual display height the scene is authored for (SDK default)
const PITCH_DEG = 62;          // look down onto the orbital plane: turns a 0.22 m wide disc into
                               // ~0.10 m of depth instead of 0.22 m
const PITCH_LIMIT = [56, 76];  // drag range; 56° keeps the far orbit in front of the starfield
const DEPTH_OFFSET = -0.008;   // sink the system slightly: front ≈ +0.044, back ≈ −0.060
const STAR_Z = [-0.095, -0.072]; // starfield shell: just behind the far side of the outer orbit
const NEBULA_Z = -0.1;         // faint low-frequency backdrop behind the stars
const FEATHER_PX = 28;         // per-eye edge fade (buffer px): softens window-edge violations

// ---- DOM -----------------------------------------------------------------------------------
const canvas = document.getElementById('scene');
const cover = document.getElementById('cover');
const statusEl = document.getElementById('status');
const trackingHint = document.getElementById('tracking-hint');
const pauseBtn = document.getElementById('pause');
const resetBtn = document.getElementById('reset');
const speedBtns = [...document.querySelectorAll('[data-speed]')];

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let speed = reduceMotion ? 0.5 : 1;
let paused = false;
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
const removeCover = () => cover.remove(); // a hard cut, never a fade (woven-canvas rule 5)

// ---- procedural textures -------------------------------------------------------------------
// Value noise sampled ON THE SPHERE (3D), so equirect maps have no seam and no pole pinch.
function hash3(i, j, k, seed) {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 1440662683) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h & 0xffffff) / 0xffffff;
}
function noise3(x, y, z, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const l = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz, seed);
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v),
    l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v),
    w,
  );
}
function fbm(x, y, z, seed, oct = 4) {
  let s = 0, a = 0.5, f = 1;
  for (let o = 0; o < oct; o++) { s += a * noise3(x * f, y * f, z * f, seed + o * 101); a *= 0.5; f *= 2.03; }
  return s / (1 - Math.pow(0.5, oct));
}
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

/** Equirect texture from fn(nx, ny, nz, lat) -> [r, g, b, a] (0..255), evaluated on the unit sphere. */
function sphereTexture(w, h, fn, { srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    const lat = (0.5 - (y + 0.5) / h) * Math.PI;
    const cl = Math.cos(lat), sl = Math.sin(lat);
    for (let x = 0; x < w; x++) {
      const lon = ((x + 0.5) / w) * Math.PI * 2;
      const px = fn(cl * Math.cos(lon), sl, cl * Math.sin(lon), lat);
      const i = (y * w + x) * 4;
      d[i] = px[0]; d[i + 1] = px[1]; d[i + 2] = px[2]; d[i + 3] = px.length > 3 ? px[3] : 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const TEX = {
  sun: () => sphereTexture(512, 256, (x, y, z) => {
    const n = fbm(x * 7, y * 7, z * 7, 11, 5);
    const g = fbm(x * 22, y * 22, z * 22, 23, 3);
    const t = Math.min(1, Math.max(0, n * 0.8 + g * 0.45 - 0.15));
    return [255, mix(110, 236, t), mix(20, 150, t * t)];
  }),
  ember: () => sphereTexture(256, 128, (x, y, z) => {
    const n = fbm(x * 5, y * 5, z * 5, 31, 5);
    const cr = smooth(0.55, 0.75, fbm(x * 14, y * 14, z * 14, 37, 2));
    const t = n * (1 - 0.35 * cr);
    return [mix(70, 205, t), mix(45, 120, t), mix(38, 88, t)];
  }),
  azure: () => sphereTexture(512, 256, (x, y, z, lat) => {
    const n = fbm(x * 3.2, y * 3.2, z * 3.2, 51, 5);
    const land = smooth(0.52, 0.56, n);
    const ice = smooth(1.12, 1.25, Math.abs(lat) + 0.15 * fbm(x * 8, y * 8, z * 8, 53, 2));
    let r = mix(18, 30, n), g = mix(52, 90, n), b = mix(120, 170, n);              // ocean
    const lt = fbm(x * 9, y * 9, z * 9, 57, 3);
    r = mix(r, mix(60, 150, lt), land); g = mix(g, mix(110, 130, lt), land); b = mix(b, mix(45, 80, lt), land);
    return [mix(r, 235, ice), mix(g, 240, ice), mix(b, 250, ice)];
  }),
  clouds: () => sphereTexture(512, 256, (x, y, z) => {
    const n = fbm(x * 4 + 3, y * 9, z * 4, 61, 5);
    const a = smooth(0.5, 0.75, n) * 220;
    return [255, 255, 255, a];
  }),
  sable: () => sphereTexture(512, 256, (x, y, z) => {
    const warp = fbm(x * 3, y * 3, z * 3, 71, 4) * 0.5;
    const band = 0.5 + 0.5 * Math.sin((y + warp * 0.25) * 26) * Math.cos((y - warp * 0.1) * 9);
    const fine = fbm(x * 2, y * 40, z * 2, 73, 3);
    const t = band * 0.75 + fine * 0.25;
    return [mix(150, 236, t), mix(108, 205, t), mix(72, 158, t)];
  }),
  glacier: () => sphereTexture(256, 128, (x, y, z) => {
    const warp = fbm(x * 2, y * 2, z * 2, 81, 3);
    const t = 0.5 + 0.5 * Math.sin((y + warp * 0.15) * 14);
    return [mix(120, 175, t), mix(195, 228, t), mix(210, 238, t)];
  }),
};

function ringTexture() {
  // 1-D radial profile stored along U; RingGeometry UVs are remapped to (radius, angle) below.
  const w = 512, c = document.createElement('canvas');
  c.width = w; c.height = 4;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, 4);
  for (let x = 0; x < w; x++) {
    const u = x / (w - 1);
    let a = 0.55 + 0.45 * Math.sin(u * 60) * Math.sin(u * 17 + 1.3);
    a *= smooth(0, 0.08, u) * smooth(1, 0.9, u);
    if (u > 0.58 && u < 0.64) a *= 0.12;                       // a Cassini-like gap
    const t = fbm(u * 30, 0, 0, 91, 3);
    for (let y = 0; y < 4; y++) {
      const i = (y * w + x) * 4;
      img.data[i] = mix(170, 235, t); img.data[i + 1] = mix(140, 205, t); img.data[i + 2] = mix(105, 160, t);
      img.data[i + 3] = Math.max(0, Math.min(255, a * 235));
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function glowTexture(stops) {
  const s = 256, c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  for (const [o, col] of stops) g.addColorStop(o, col);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function nebulaTexture() {
  const w = 512, h = 320, c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w, v = y / h;
      const n = fbm(u * 3.5, v * 2.2, 0.5, 101, 5);
      const m = fbm(u * 2.5 + 7, v * 1.6 + 3, 1.5, 107, 4);
      const k = smooth(0.42, 0.85, n);
      const edge = smooth(0, 0.22, u) * smooth(1, 0.78, u) * smooth(0, 0.25, v) * smooth(1, 0.75, v);
      const i = (y * w + x) * 4;
      img.data[i] = (mix(30, 90, m) * k) * edge;
      img.data[i + 1] = (mix(25, 40, m) * k) * edge;
      img.data[i + 2] = (mix(90, 120, 1 - m) * k) * edge;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---- the scene -----------------------------------------------------------------------------
/**
 * Builds the backdrop (starfield + nebula: fixed to the display, never tilted) and the solar
 * system (goes under the viewer's pivot so the drag tilts it). Returns an update(dt) hook.
 */
function buildScene() {
  // -- backdrop
  const backdrop = new THREE.Group();

  const nebula = new THREE.Mesh(
    new THREE.PlaneGeometry(1.3, 0.8),
    new THREE.MeshBasicMaterial({ map: nebulaTexture(), blending: THREE.AdditiveBlending,
      transparent: true, depthWrite: false, opacity: 0.55, toneMapped: false }),
  );
  nebula.position.z = NEBULA_Z;
  nebula.renderOrder = -2;
  backdrop.add(nebula);

  const N = 1700;
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
  const size = new Float32Array(N), phase = new Float32Array(N);
  const tint = [[0.75, 0.82, 1.0], [1.0, 1.0, 1.0], [1.0, 0.9, 0.75], [0.85, 0.9, 1.0]];
  let rnd = 1234567;
  const rand = () => ((rnd = Math.imul(rnd ^ (rnd >>> 15), 2246822519) + 0x6d2b79f5 | 0) >>> 0) / 4294967296;
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (rand() - 0.5) * 0.9;
    pos[i * 3 + 1] = (rand() - 0.5) * 0.56;
    pos[i * 3 + 2] = mix(STAR_Z[0], STAR_Z[1], rand());
    // Mostly faint stars, a few bright ones. Brightness is capped: a hard white point on black
    // is the worst case for lenticular crosstalk, so the brightest stars stay well under 1.
    const b = Math.pow(rand(), 3.2);
    const t = tint[(rand() * tint.length) | 0];
    const lum = mix(0.12, 0.6, b);              // linear; ≈0.38–0.8 after sRGB encode
    col[i * 3] = t[0] * lum; col[i * 3 + 1] = t[1] * lum; col[i * 3 + 2] = t[2] * lum;
    size[i] = mix(1.6, 3.6, b);
    phase[i] = rand();
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  sg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  sg.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  sg.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  const starMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPx: { value: 1 } },
    vertexShader: /* glsl */`
      attribute float aSize; attribute float aPhase;
      uniform float uTime; uniform float uPx;
      varying vec3 vColor;
      void main() {
        // Gentle twinkle, driven by time only — both eyes see the same brightness.
        float tw = 0.8 + 0.2 * sin(uTime * (0.5 + aPhase * 1.5) + aPhase * 40.0);
        vColor = color * tw;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uPx;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vColor;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.0, d);
        gl_FragColor = vec4(vColor * a * a, 1.0);
        #include <colorspace_fragment>
      }`,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const stars = new THREE.Points(sg, starMat);
  stars.renderOrder = -1;
  stars.frustumCulled = false;
  backdrop.add(stars);

  // -- the solar system (lies in its own XZ plane; the viewer's pitch tilts it toward us)
  const system = new THREE.Group();
  system.add(new THREE.AmbientLight(0x6070a0, 0.35));         // night sides: dim, not void
  const sunLight = new THREE.PointLight(0xfff1dc, 3.2, 0, 0); // decay 0: tabletop scale
  system.add(sunLight);

  const SUN_R = 0.022;
  const sunMat = new THREE.ShaderMaterial({
    uniforms: { map: { value: TEX.sun() } },
    vertexShader: /* glsl */`
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D map;
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main() {
        float mu = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
        float limb = 0.45 + 0.55 * pow(mu, 0.55);            // limb darkening
        vec3 c = texture2D(map, vUv).rgb * limb * 1.15;
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sun = new THREE.Mesh(new THREE.SphereGeometry(SUN_R, 64, 32), sunMat);
  system.add(sun);

  // Halo: two additive sprites centred on the sun (they sit at the sun's depth in both eyes).
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture([[0, 'rgba(255,214,140,0.85)'], [0.18, 'rgba(255,170,70,0.45)'],
      [0.45, 'rgba(255,120,30,0.10)'], [1, 'rgba(255,100,20,0)']]),
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false,
  }));
  halo.scale.setScalar(SUN_R * 5.2);
  const corona = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture([[0, 'rgba(255,190,110,0.35)'], [0.3, 'rgba(255,140,60,0.10)'], [1, 'rgba(255,120,40,0)']]),
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false,
  }));
  corona.scale.setScalar(SUN_R * 11);
  system.add(halo, corona);

  function orbitLine(r, color, opacity) {
    const pts = [];
    for (let i = 0; i <= 256; i++) { const a = (i / 256) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)); }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
    return line;
  }

  const planetDefs = [
    { name: 'Ember',   orbit: 0.040, r: 0.0042, period: 8,  spin: 0.6, tex: TEX.ember,   rough: 0.95, phase: 0.6 },
    { name: 'Azure',   orbit: 0.061, r: 0.0062, period: 14, spin: 1.4, tex: TEX.azure,   rough: 0.7,  phase: 2.4, moon: true, clouds: true },
    { name: 'Sable',   orbit: 0.083, r: 0.0095, period: 24, spin: 2.2, tex: TEX.sable,   rough: 0.85, phase: 4.1, ring: true },
    { name: 'Glacier', orbit: 0.104, r: 0.0068, period: 38, spin: 1.8, tex: TEX.glacier, rough: 0.8,  phase: 5.3 },
  ];

  const planets = planetDefs.map((p) => {
    system.add(orbitLine(p.orbit, 0x8fa6ff, 0.22));
    const carrier = new THREE.Group();                    // rides the orbit
    const tilt = new THREE.Group();                       // axial tilt
    tilt.rotation.z = p.ring ? 0.42 : 0.2;
    carrier.add(tilt);
    const body = new THREE.Mesh(new THREE.SphereGeometry(p.r, 48, 24),
      new THREE.MeshStandardMaterial({ map: p.tex(), roughness: p.rough, metalness: 0 }));
    tilt.add(body);
    const entry = { ...p, carrier, body, angle: p.phase };
    if (p.clouds) {
      const cl = new THREE.Mesh(new THREE.SphereGeometry(p.r * 1.035, 48, 24),
        new THREE.MeshStandardMaterial({ map: TEX.clouds(), transparent: true, depthWrite: false, roughness: 1 }));
      tilt.add(cl);
      entry.cloudMesh = cl;
    }
    if (p.ring) {
      const inner = p.r * 1.45, outer = p.r * 2.2;
      const rg = new THREE.RingGeometry(inner, outer, 128, 1);
      const uv = rg.attributes.uv, P = rg.attributes.position;
      for (let i = 0; i < uv.count; i++) {
        const rr = Math.hypot(P.getX(i), P.getY(i));
        uv.setXY(i, (rr - inner) / (outer - inner), 0.5);
      }
      const ring = new THREE.Mesh(rg, new THREE.MeshStandardMaterial({ map: ringTexture(),
        transparent: true, depthWrite: false, side: THREE.DoubleSide, roughness: 1 }));
      ring.rotation.x = -Math.PI / 2;
      tilt.add(ring);
    }
    if (p.moon) {
      const moonOrbit = new THREE.Group();
      moonOrbit.rotation.x = 0.22;                        // inclined so it passes in front/behind
      carrier.add(moonOrbit);
      const moon = new THREE.Mesh(new THREE.SphereGeometry(0.0018, 32, 16),
        new THREE.MeshStandardMaterial({ map: TEX.ember(), color: 0xb8b8c0, roughness: 1 }));
      moon.position.x = 0.0115;
      moonOrbit.add(moon);
      entry.moonOrbit = moonOrbit;
      entry.moonAngle = 1;
    }
    system.add(carrier);
    return entry;
  });

  let time = 0;
  function update(dt, bufferHeight) {
    time += dt;
    starMat.uniforms.uTime.value = time;
    starMat.uniforms.uPx.value = Math.max(0.8, bufferHeight / 950);
    sun.rotation.y += dt * 0.12;
    for (const p of planets) {
      p.angle += (dt * Math.PI * 2) / p.period;
      p.carrier.position.set(Math.cos(p.angle) * p.orbit, 0, -Math.sin(p.angle) * p.orbit);
      p.body.rotation.y += dt * p.spin;
      if (p.cloudMesh) p.cloudMesh.rotation.y += dt * p.spin * 1.15;
      if (p.moonOrbit) { p.moonAngle += (dt * Math.PI * 2) / 3.4; p.moonOrbit.rotation.y = p.moonAngle; }
    }
  }
  update(0, 1000);
  // Extent of the system in its own (untilted) frame, for SceneViewer.fitTo's bookkeeping.
  const R = 0.104 + 0.0068;
  return { backdrop, system, update, extent: [2 * R, 0.03, 2 * R] };
}

// ---- interaction: drag to tilt / spin (eased); no wheel, so the page still scrolls ---------
function makeDrag(el, initial) {
  const s = { yaw: initial.yaw, pitch: initial.pitch, tYaw: initial.yaw, tPitch: initial.pitch };
  let drag = null;
  el.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; el.setPointerCapture(e.pointerId); });
  el.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const r = el.getBoundingClientRect();
    s.tYaw += ((e.clientX - drag.x) / r.width) * 160;
    s.tPitch = Math.min(PITCH_LIMIT[1], Math.max(PITCH_LIMIT[0], s.tPitch + ((e.clientY - drag.y) / r.height) * 60));
    drag.x = e.clientX; drag.y = e.clientY;
  });
  const end = (e) => { drag = null; el.releasePointerCapture?.(e.pointerId); };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  s.reset = () => { s.tYaw = initial.yaw; s.tPitch = initial.pitch; };
  s.step = (dt) => {
    const k = 1 - Math.pow(0.0005, dt);  // smooth, critically-damped-ish approach
    s.yaw += (s.tYaw - s.yaw) * k;
    s.pitch += (s.tPitch - s.pitch) * k;
  };
  return s;
}

// ---- UI wiring -----------------------------------------------------------------------------
pauseBtn.addEventListener('click', () => {
  paused = !paused;
  pauseBtn.textContent = paused ? 'Play' : 'Pause';
  pauseBtn.setAttribute('aria-pressed', String(paused));
});
for (const b of speedBtns) {
  b.addEventListener('click', () => {
    speed = parseFloat(b.dataset.speed);
    for (const o of speedBtns) o.setAttribute('aria-pressed', String(o === b));
  });
}
if (reduceMotion) for (const o of speedBtns) o.setAttribute('aria-pressed', String(o.dataset.speed === '0.5'));

// ---- boot ----------------------------------------------------------------------------------
const world = buildScene();
const drag = makeDrag(canvas, { yaw: -18, pitch: PITCH_DEG });
resetBtn.addEventListener('click', () => drag.reset());
canvas.addEventListener('dblclick', () => drag.reset());

let sdk = null, viewerMod = null, glue = null;
try {
  // Dynamic + caught: if the SDK can't load, the page still renders its 2D scene below.
  [sdk, viewerMod, glue] = await Promise.all([
    import('@displayxr/inline3d'),
    import('@displayxr/inline3d/viewer'),
    import('@displayxr/inline3d/three'),
  ]);
} catch (err) {
  console.warn('[orrery] inline-3D SDK unavailable, rendering 2D only:', err);
}

if (viewerMod && glue) await bootWithSdk();
else bootPlain();

async function bootWithSdk() {
  // The viewer owns the renderer and the loop. fit:'none' — this scene is authored at display
  // scale on purpose (its depth budget is designed, not derived from the tile), and orbit:false
  // because we run our own drag (bounded pitch, no wheel-zoom: zoom would scale the depth too).
  const viewer = new viewerMod.SceneViewer(THREE, canvas, {
    virtualDisplayHeight: VH,
    fit: 'none',
    orbit: false,
    feather: FEATHER_PX,
    pitchLimit: PITCH_LIMIT,
    // Keep the side-by-side buffer no wider than the panel (each eye gets ~half the panel's
    // columns after the interlace anyway); never below 0.6, where the interlace shows.
    renderScale: Math.min(1, Math.max(0.6, screen.width / (2 * Math.max(1, canvas.clientWidth)))),
  });
  viewer.useEyeCamera(glue.EyeCamera, glue.EdgeFeather);
  const r = viewer.renderer;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.05;

  viewer.scene.add(world.backdrop);           // fixed to the display: never tilts
  viewer.content.add(world.system);           // under the pivot: tilted by the pose
  viewer.fitTo([0, 0, 0], world.extent);      // fit:'none' → scale 1; also frames the mono camera
  viewer.depthOffset = DEPTH_OFFSET;
  viewer.setPose({ yaw: drag.yaw, pitch: drag.pitch });

  let last = 0;
  viewer.onTick = () => {                     // once per frame (3D and 2D), never per eye
    const t = performance.now();
    const dt = last ? Math.min((t - last) / 1000, 0.1) : 0;
    last = t;
    drag.step(dt);
    viewer.setPose({ yaw: drag.yaw, pitch: drag.pitch });
    world.update(paused ? 0 : dt * speed, r.domElement.height);
  };

  const wall = await sdk.createInline3D({ lazy: false });
  if (!wall.supported) {
    viewer.startMono();
    statusEl.textContent = '2D preview — open in the DisplayXR Browser on a 3D display for depth';
    await nextFrame(); await nextFrame();
    removeCover();
    return;
  }

  // Tighter clip range than the WebXR default: eyes sit ~1 m away, content spans ~0.2 m.
  try { wall.session.updateRenderState({ depthNear: 0.05, depthFar: 10 }); } catch {}

  // Rule 4: the canvas already has its final box, will-change from CSS, and a 2:1 store (the
  // viewer sized it in 3D mode). Let it commit for two frames before registering.
  await nextFrame(); await nextFrame();
  const handle = wall.addScene(canvas, viewer.onFrame, {
    virtualDisplayHeight: VH,
    onLayerLost: () => {
      viewer.onLayerLost();
      statusEl.textContent = '3D unavailable — showing 2D';
    },
  });
  statusEl.innerHTML = '<b>Glasses-free 3D</b> · move your head to look around';

  wall.on?.('trackingstatechange', (state) => { trackingHint.hidden = state !== 'searching'; });
  trackingHint.hidden = wall.trackingState !== 'searching';

  await handle.firstWoven;                    // never rejects; a lost layer has already gone 2D
  removeCover();
}

// Fallback when the SDK modules fail to load: a plain three.js mono render of the same scene.
function bootPlain() {
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  r.setClearColor(0x000000, 0);
  r.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  const pivot = new THREE.Group();
  pivot.add(world.system);
  pivot.position.z = DEPTH_OFFSET;
  scene.add(world.backdrop, pivot);
  const cam = new THREE.PerspectiveCamera(35, 16 / 9, 0.01, 10);
  cam.position.set(0, 0, 0.5 * VH / Math.tan((35 / 2) * Math.PI / 180));
  let last = 0;
  const loop = (t) => {
    requestAnimationFrame(loop);
    const w = canvas.clientWidth, h = canvas.clientHeight, dpr = Math.min(devicePixelRatio, 2);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      r.setPixelRatio(dpr); r.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix();
    }
    const dt = last ? Math.min((t - last) / 1000, 0.1) : 0; last = t;
    drag.step(dt);
    pivot.rotation.set(drag.pitch * Math.PI / 180, drag.yaw * Math.PI / 180, 0, 'XYZ');
    world.update(paused ? 0 : dt * speed, canvas.height);
    r.render(scene, cam);
  };
  requestAnimationFrame(loop);
  statusEl.textContent = '2D preview';
  requestAnimationFrame(() => requestAnimationFrame(removeCover));
}
