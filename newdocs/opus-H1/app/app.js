// Five cities — a spinnable 3D globe with city markers, for the DisplayXR inline-3D browser.
//
// RIG (making-3d-look-right §1): the visitor turns an OBJECT → a DISPLAY rig. SceneViewer (./viewer)
// draws every eye from its own view (EyeCamera), keeps the last good frame, and falls back to mono.
// The globe is spun by rotating the globe itself inside the viewer's content, never a camera.
//
// SCREEN PLANE (§2) and DEPTH (§3), in tile heights h on this 16:9 tile:
//   • Only the FRONT hemisphere of a globe is ever visible; its farthest visible point is the limb,
//     at the depth of the centre. So the centre goes BEHIND the glass at LIMB = −0.22 h and the
//     nearest point (a marker tip at the front) at FRONT = +0.09 h. Via the SDK's disparityPct():
//       front +0.09 h ≈ 0.53 % of the width (comfortable ≤ 0.6 %)
//       limb  −0.22 h ≈ 1.30 % of the width (comfortable ≤ 1.5 %; the dark halo/limb is soft)
//     That lets the globe be ~0.58 h across instead of the ~0.37 h a centred depthFit would give.
//   • The globe is a sphere: any yaw/pitch keeps the same depth range, so the spin costs nothing.
//   • The front (the only pop-out) is in the middle of the tile; everything near the edges is empty
//     background — no window violations. No HTML is drawn over the tile.
//   • No wheel zoom (orbit: false) so the budget cannot be broken by the visitor.

import * as THREE from 'three';
import { createInline3D } from '@displayxr/inline3d';
import { EyeCamera, displayRig, DepthCursor, raycastHitTest } from '@displayxr/inline3d/three';
import { SceneViewer } from '@displayxr/inline3d/viewer';
import { makeEarthCanvases } from './earth-texture.js';

const canvas = document.getElementById('globe');
const cover = document.getElementById('cover');
const info = document.getElementById('info');
const cityList = document.getElementById('cities');
const depth = document.getElementById('depth');
const modeBtn = document.getElementById('mode');
const modeNote = document.getElementById('modeNote');

const VDH = 0.24;                 // virtual display height (m) — the SAME value goes to displayRig
const FRONT = 0.09;            // nearest point, tile heights in front of the glass
const LIMB = -0.22;               // globe centre / visible limb, tile heights behind the glass
const MARKER_TOP = 1.07;          // marker tip radius, in globe radii
const R = ((FRONT - LIMB) / MARKER_TOP) * VDH;   // globe radius in display metres (≈ 0.29 h)
const BG = '#070d1a';             // == the page background (index.html)
const PITCH_LIMIT = 60;           // degrees

const CITIES = [
  { name: 'London', country: 'United Kingdom', lat: 51.507, lon: -0.128, tz: 'Europe/London',
    pop: 8_870_000, popNote: 'Greater London, 2023 estimate', metro: '≈ 14.9 million (metro)' },
  { name: 'Tokyo', country: 'Japan', lat: 35.676, lon: 139.650, tz: 'Asia/Tokyo',
    pop: 14_090_000, popNote: 'Tokyo Metropolis, 2023 estimate', metro: '≈ 37 million (Greater Tokyo)' },
  { name: 'New York', country: 'United States', lat: 40.713, lon: -74.006, tz: 'America/New_York',
    pop: 8_260_000, popNote: 'New York City, 2023 estimate', metro: '≈ 19.5 million (metro)' },
  { name: 'Sydney', country: 'Australia', lat: -33.869, lon: 151.209, tz: 'Australia/Sydney',
    pop: 5_450_000, popNote: 'Greater Sydney, 2023 estimate', metro: null },
  { name: 'Nairobi', country: 'Kenya', lat: -1.286, lon: 36.817, tz: 'Africa/Nairobi',
    pop: 4_397_000, popNote: 'Nairobi County, 2019 census', metro: null },
];

// ---- the viewer -----------------------------------------------------------------------------------
const viewer = new SceneViewer(THREE, canvas, {
  virtualDisplayHeight: VDH,
  fit: 'none',                    // the globe is modelled in display metres; depth set explicitly above
  clearColor: BG,                 // OPAQUE clear (alpha 0 weaves as stale/black pixels)
  orbit: false,                   // our own drag-to-spin below; no wheel zoom past the depth budget
  // no feather: it fades to transparent, which needs an alpha clear
}).useEyeCamera(EyeCamera);

// ---- the globe --------------------------------------------------------------------------------------
const globe = new THREE.Group();                 // rotated by the visitor
viewer.content.add(globe);

const tex = makeEarthCanvases(1024, 512);
const colorMap = new THREE.CanvasTexture(tex.color);
colorMap.colorSpace = THREE.SRGBColorSpace;
colorMap.anisotropy = viewer.renderer.capabilities.getMaxAnisotropy();
const roughMap = new THREE.CanvasTexture(tex.roughness);
const earth = new THREE.Mesh(
  new THREE.SphereGeometry(R, 96, 64),
  new THREE.MeshStandardMaterial({ map: colorMap, roughnessMap: roughMap, roughness: 1, metalness: 0 }),
);
globe.add(earth);

// Atmosphere: a soft additive halo just outside the limb (at the limb's depth, behind the glass). It
// also softens the globe's silhouette against the dark page — hard high-contrast edges ghost first.
const halo = new THREE.Mesh(
  new THREE.SphereGeometry(R * 1.08, 64, 48),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { color: { value: new THREE.Color(0x4f8fe6) } },
    vertexShader: `varying vec3 vN; varying vec3 vP;
      void main(){ vec4 p = modelViewMatrix * vec4(position,1.0); vP = p.xyz;
        vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * p; }`,
    fragmentShader: `uniform vec3 color; varying vec3 vN; varying vec3 vP;
      void main(){ float d = -dot(normalize(vN), normalize(-vP));
        float a = smoothstep(0.0, 0.42, d) * 0.55; gl_FragColor = vec4(color * a, 1.0); }`,
  }),
);
viewer.content.add(halo);      // not in `globe`: it is rotation-invariant anyway
// A thin fresnel rim on the globe's own face, like air seen edge-on.
const rim = new THREE.Mesh(
  new THREE.SphereGeometry(R * 1.004, 96, 64),
  new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { color: { value: new THREE.Color(0x6aa8ff) } },
    vertexShader: `varying vec3 vN; varying vec3 vP;
      void main(){ vec4 p = modelViewMatrix * vec4(position,1.0); vP = p.xyz;
        vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * p; }`,
    fragmentShader: `uniform vec3 color; varying vec3 vN; varying vec3 vP;
      void main(){ float f = 1.0 - max(dot(normalize(vN), normalize(-vP)), 0.0);
        gl_FragColor = vec4(color * pow(f, 3.0) * 0.6, 1.0); }`,
  }),
);
viewer.content.add(rim);

// Lat/lon → a point on the sphere, matching SphereGeometry's UV layout (u = 0 at lon −180°).
function dirOf(lat, lon, out = new THREE.Vector3()) {
  const phi = ((lon + 180) / 360) * Math.PI * 2, la = THREE.MathUtils.degToRad(lat);
  return out.set(-Math.cos(phi) * Math.cos(la), Math.sin(la), Math.sin(phi) * Math.cos(la));
}

// ---- markers: a stem and a glowing head, with a ring on the ground for the selected city -----------
const markers = new THREE.Group();
globe.add(markers);
const HEAD_R = 0.022 * R;
const stemGeo = new THREE.CylinderGeometry(0.0045 * R, 0.0045 * R, (MARKER_TOP - 1) * R - 2 * HEAD_R, 8);
stemGeo.translate(0, R + ((MARKER_TOP - 1) * R - 2 * HEAD_R) / 2, 0);
const headGeo = new THREE.SphereGeometry(HEAD_R, 20, 14);
headGeo.translate(0, (MARKER_TOP * R) - HEAD_R, 0);
const ringGeo = new THREE.RingGeometry(0.035 * R, 0.05 * R, 40).rotateX(-Math.PI / 2).translate(0, R * 1.002, 0);
const AMBER = new THREE.Color(0xffb347), RED = new THREE.Color(0xff5a4f);
const UP = new THREE.Vector3(0, 1, 0);

CITIES.forEach((c, i) => {
  const g = new THREE.Group();
  c.dir = dirOf(c.lat, c.lon);
  g.quaternion.setFromUnitVectors(UP, c.dir);
  const headMat = new THREE.MeshStandardMaterial({ color: AMBER, emissive: AMBER, emissiveIntensity: 0.55, roughness: 0.4 });
  const stem = new THREE.Mesh(stemGeo, new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.5 }));
  const head = new THREE.Mesh(headGeo, headMat);
  const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: RED, side: THREE.DoubleSide }));
  ring.visible = false;
  g.add(stem, head, ring);
  markers.add(g);
  Object.assign(c, { group: g, head, headMat, ring, index: i });
});

const sun = new THREE.DirectionalLight(0xfff4e6, 2.6);
sun.position.set(-1.2, 1.0, 1.6);                // upper left, in front: the visible face is lit
viewer.scene.add(sun, new THREE.HemisphereLight(0xbcd4ff, 0x1b2233, 0.9));

// Place it: fit 'none' keeps scale 1 (display metres); the centre goes LIMB tile heights behind.
viewer.depthOffset = LIMB * VDH;
viewer.fitTo([0, 0, 0], [2 * MARKER_TOP * R, 2 * MARKER_TOP * R, 2 * MARKER_TOP * R]);

// ---- spin: eased yaw/pitch of the globe (Rx(pitch)·Ry(yaw), as SceneViewer orbits) -----------------
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let yaw = 0, pitch = 0, tYaw = 0, tPitch = 0;
let lastInput = performance.now(), lastT = 0, selected = null;
let dragging = false, downX = 0, downY = 0, lastX = 0, lastY = 0, moved = false;

function aimAt(c, snap = false) {         // bring a city to the front, centre of the globe
  const want = -Math.atan2(c.dir.x, c.dir.z) * 180 / Math.PI;
  tYaw = yaw + ((((want - yaw) % 360) + 540) % 360) - 180;   // shortest way round
  tPitch = THREE.MathUtils.clamp(c.lat, -PITCH_LIMIT, PITCH_LIMIT);
  if (snap) { yaw = tYaw; pitch = tPitch; }
}
aimAt({ dir: dirOf(22, 15), lat: 22 }, true);     // open on Europe and Africa, tilted a little north

viewer.onTick = () => {
  const now = performance.now(), dt = lastT ? Math.min((now - lastT) / 1000, 0.1) : 0;
  lastT = now;
  if (!selected && !dragging && !reduceMotion && now - lastInput > 3000) tYaw += 5 * dt;   // gentle idle spin
  const k = dt > 0 ? 1 - Math.pow(0.002, dt) : 1;   // critically-damped-ish: no overshoot
  yaw += (tYaw - yaw) * k;
  pitch += (tPitch - pitch) * k;
  globe.rotation.set(THREE.MathUtils.degToRad(pitch), THREE.MathUtils.degToRad(yaw), 0, 'XYZ');
  if (selected) {                                   // a slow pulse on the selected ring, in the scene
    const s = 1 + 0.25 * (0.5 + 0.5 * Math.sin(now / 320));
    selected.ring.scale.set(s, 1, s);
  }
};

// ---- picking: screen-space nearest visible marker ---------------------------------------------------
// On a display rig there is no app camera; the canvas is the z = 0 plane. The viewer's mono camera
// frames exactly that plane (vH tall at z = 0), so projecting through it maps a marker to where it
// sits on the glass. Markers are close to the glass (+0.03…+0.10 h), so the residual parallax
// error is a few pixels; the generous pick radius covers it.
const PICK_PX = 26;
const tmp = new THREE.Vector3(), nrm = new THREE.Vector3(), toCam = new THREE.Vector3();
function markerAt(clientX, clientY) {
  const cam = viewer.monoCamera, box = canvas.getBoundingClientRect();
  viewer.scene.updateMatrixWorld();
  cam.updateMatrixWorld();
  let best = null, bestD = PICK_PX;
  for (const c of CITIES) {
    c.head.getWorldPosition(tmp);
    nrm.copy(c.dir).applyQuaternion(globe.getWorldQuaternion(new THREE.Quaternion()));
    toCam.copy(cam.position).sub(tmp).normalize();
    if (nrm.dot(toCam) < 0.12) continue;            // on the far side or right at the limb
    tmp.project(cam);
    const x = box.left + (tmp.x * 0.5 + 0.5) * box.width, y = box.top + (0.5 - tmp.y * 0.5) * box.height;
    const d = Math.hypot(x - clientX, y - clientY);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

// ---- input: drag to spin, click to pick ------------------------------------------------------------
canvas.style.touchAction = 'none';
canvas.addEventListener('pointerdown', (e) => {
  dragging = true; moved = false;
  downX = lastX = e.clientX; downY = lastY = e.clientY;
  lastInput = performance.now();
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) {
    canvas.classList.toggle('over-marker', !!markerAt(e.clientX, e.clientY));
    return;
  }
  if (!moved && Math.hypot(e.clientX - downX, e.clientY - downY) > 5) { moved = true; canvas.classList.add('dragging'); }
  if (!moved) return;
  const box = canvas.getBoundingClientRect();
  tYaw += ((e.clientX - lastX) / box.width) * 180;           // a full drag across the tile = half a turn
  tPitch = THREE.MathUtils.clamp(tPitch + ((e.clientY - lastY) / box.height) * 120, -PITCH_LIMIT, PITCH_LIMIT);
  lastX = e.clientX; lastY = e.clientY;
  lastInput = performance.now();
});
const endDrag = (e) => {
  if (!dragging) return;
  dragging = false;
  canvas.classList.remove('dragging');
  canvas.releasePointerCapture?.(e.pointerId);
  lastInput = performance.now();
  if (!moved && e.type === 'pointerup') {
    const c = markerAt(e.clientX, e.clientY);
    if (c) select(c);
  }
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('keydown', (e) => {
  const step = { ArrowLeft: [-15, 0], ArrowRight: [15, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] }[e.key];
  if (!step) return;
  e.preventDefault();
  tYaw += step[0];
  tPitch = THREE.MathUtils.clamp(tPitch + step[1], -PITCH_LIMIT, PITCH_LIMIT);
  lastInput = performance.now();
});

// ---- the info panel (HTML beside the tile, at the glass) ------------------------------------------
const buttons = CITIES.map((c) => {
  const li = document.createElement('li'), b = document.createElement('button');
  b.type = 'button'; b.textContent = c.name; b.setAttribute('aria-pressed', 'false');
  b.addEventListener('click', () => select(c));
  li.appendChild(b); cityList.appendChild(li);
  return b;
});
const fmtPop = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2)} million` : n.toLocaleString('en'));
const fmtDeg = (v, p, n) => `${Math.abs(v).toFixed(2)}° ${v >= 0 ? p : n}`;
function localTime(tz) {
  try { return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', weekday: 'short' }).format(new Date()); }
  catch { return '—'; }
}
let clock = 0;
function select(c) {
  if (selected) {
    selected.ring.visible = false;
    selected.headMat.color.copy(AMBER); selected.headMat.emissive.copy(AMBER);
  }
  selected = c;
  c.ring.visible = true;                         // hard cut, never a fade
  c.headMat.color.copy(RED); c.headMat.emissive.copy(RED);
  buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(i === c.index)));
  aimAt(c);
  lastInput = performance.now();
  const render = () => {
    info.innerHTML = `
      <p class="city">${c.name}</p>
      <p class="country">${c.country}</p>
      <dl>
        <dt>Population</dt><dd class="pop">${fmtPop(c.pop)}</dd>
        ${c.metro ? `<dt>Wider area</dt><dd>${c.metro}</dd>` : ''}
        <dt>Local time</dt><dd>${localTime(c.tz)}</dd>
        <dt>Position</dt><dd>${fmtDeg(c.lat, 'N', 'S')}, ${fmtDeg(c.lon, 'E', 'W')}</dd>
      </dl>
      <p class="note">${c.popNote}; figures are approximate.</p>`;
  };
  render();
  clearInterval(clock);
  clock = setInterval(render, 30_000);
}

// ---- boot -------------------------------------------------------------------------------------------
const wall = await createInline3D({ lazy: false });
if (!wall.supported) {
  // An ordinary browser: the same page, flat. The 3D-only controls rest and say why.
  viewer.startMono();
  cover.remove();
  depth.disabled = modeBtn.disabled = true;
  modeBtn.textContent = '2D';
  modeNote.textContent = 'Open this page in the DisplayXR Browser on a 3D display to see it in 3D.';
} else {
  viewer.useDepthCursor(DepthCursor, () => raycastHitTest(THREE, [earth, markers]));   // arrow rises over the pop-out front
  const rig = (k) => displayRig({ virtualDisplayHeight: VDH, ipdFactor: k, parallaxFactor: k });
  const handle = wall.addScene(canvas, viewer.onFrame, { viewRig: rig(1), onLayerLost: viewer.onLayerLost });
  wall.session.updateRenderState({ depthNear: 0.01, depthFar: 20 });

  // Depth slider: ONE value moves both factors; 1 = the display's natural depth, lower = shallower.
  depth.addEventListener('input', () => handle.setViewRig(rig(Number(depth.value))));

  // 2D/3D switch; the label follows what the display REPORTS, not the click.
  let flat = false;
  const show = () => {
    modeBtn.textContent = flat ? 'Show in 3D' : 'Show in 2D';
    modeBtn.setAttribute('aria-pressed', String(flat));
  };
  handle.on('renderingmodechange', (e) => { if (e.viewCount) { flat = e.viewCount === 1; show(); } });
  modeBtn.addEventListener('click', () => {
    handle.setStereoEnabled(flat).catch(() => {
      // No flat mode on this display: depth 0 is flat anywhere.
      flat = !flat;
      depth.value = flat ? 0 : 1;
      handle.setViewRig(rig(Number(depth.value)));
      show();
    });
  });
  show();
  await handle.firstWoven;     // cover until the first woven frame
  cover.remove();              // cut, never fade
}
