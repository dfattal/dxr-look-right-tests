// Product showcase for assets/Duck.gltf (Draco). Based on sdk/samples/starter-model.
// Rules: sdk/docs/making-3d-look-right.md.
//
// RIG: the shopper turns an OBJECT -> display rig, addModel's default. The model is scaled into a
//   virtual display VDH metres tall, so depth is independent of the model's units.
// SCREEN PLANE: through the subject (addModel centres it on the glass), then slid back a little.
// DEPTH: depthFit {front 0.1, back 0.27} tile heights = comfortable column for a 16:9 tile
//   (~0.6 % in front / ~1.6 % behind of the tile width). Uniform scale only.
// UI: title/price/button are HTML BESIDE the tile, never over the pop-out part.

import { createInline3D } from '@displayxr/inline3d';
import { addModel } from '@displayxr/inline3d/model';

const canvas = document.getElementById('tile');
const cover = document.getElementById('cover');
const depth = document.getElementById('depth');
const modeBtn = document.getElementById('mode');
const modeNote = document.getElementById('modeNote');

const MODEL = '../assets/Duck.gltf';
const VDH = 0.16;                      // virtual display height, metres (zoom knob)
const FRONT = 0.1, BACK = 0.27;        // depth budget, tile heights (16:9, comfortable)
const BG = '#e9e6df';                  // == page colour behind the tile

// Draco decoder files: prefer a copy served by this page (./draco/, copied from
// three/examples/jsm/libs/draco/); otherwise fall back to the pinned three@0.180.0 CDN copy.
async function dracoPath() {
  try {
    const r = await fetch('./draco/draco_decoder.wasm', { method: 'HEAD' });
    const type = r.headers.get('content-type') || '';
    if (r.ok && !type.includes('text/html')) return './draco/';
  } catch {}
  return 'https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/libs/draco/';
}

const wall = await createInline3D({ lazy: false });
const model = addModel(wall, canvas, MODEL, {
  virtualDisplayHeight: VDH,
  clearColor: BG,                      // OPAQUE clear
  depthFit: { front: FRONT, back: BACK },
  idleSpin: 14,                        // deg/s when idle; drag to turn, wheel to zoom
  decoderPath: { draco: await dracoPath() },
});

// Centred, the front budget binds and the behind budget goes unused: slide back by half the
// difference and refit so the duck is larger for the same comfort.
const framed = model.ready.then(() => {
  model.viewer.depthOffset = -((BACK - FRONT) / 2) * VDH;
  model.viewer.fitTo(model.frame.center, model.frame.extent);
}).catch((e) => console.warn('[duck] model failed to load:', e));

// Cover until framed AND woven; remove in one step. In a normal browser firstWoven resolves at once.
Promise.all([framed, model.firstWoven]).then(() => cover.remove());

// Depth slider: ONE value moves BOTH factors (never scale.z).
depth.addEventListener('input', () => {
  const k = Number(depth.value);
  model.setStereo({ ipdFactor: k, parallaxFactor: k });
});

// 2D/3D switch; shows the state the display reports.
let flat = false;
function showMode() {
  modeBtn.textContent = flat ? 'Show in 3D' : 'Show in 2D';
  modeBtn.setAttribute('aria-pressed', String(flat));
}
if (wall.supported) {
  wall.on('renderingmodechange', (e) => {
    if (e.viewCount) { flat = e.viewCount === 1; showMode(); }
  });
  modeBtn.addEventListener('click', () => {
    wall.setStereoEnabled(flat).catch(() => {
      flat = !flat;                    // no flat mode listed: depth 0 is flat on any display
      depth.value = flat ? 0 : 1;
      depth.dispatchEvent(new Event('input'));
      showMode();
    });
  });
  showMode();
} else {
  modeBtn.disabled = depth.disabled = true;
  modeBtn.textContent = '2D';
  modeNote.textContent = 'Open this page in the DisplayXR Browser on a 3D display to see it in 3D.';
}

let count = 0;
document.getElementById('buy').addEventListener('click', () => {
  count++;
  document.getElementById('cartNote').textContent =
    `✓ Added to cart (${count} × Classic Rubber Duck)`;
});
