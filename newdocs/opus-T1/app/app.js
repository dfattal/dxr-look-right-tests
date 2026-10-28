// Product showcase: one Draco glTF (the Khronos Duck) in a 3D tile, the product's HTML beside it,
// a depth slider and a 2D/3D switch. Based on sdk/samples/starter-model.
// Rules: sdk/docs/making-3d-look-right.md.
//
// RIG (guide §1): the shopper turns an OBJECT → a DISPLAY rig (addModel's default). It scales the
// model into a virtual display VDH metres tall, so the depth does not depend on the model's units.
//
// SCREEN PLANE (§2): through the subject. addModel centres the duck on the glass; we then slide it
// back by half the front/back gap so the cheaper "behind" budget is used too.
//
// DEPTH (§3), 16:9 tile, comfortable column: nearest point ≤ 0.10 tile heights in front of the
// glass (≈ 0.6 % of width), farthest ≤ 0.27 h behind (≈ 1.5 %). depthFit shrinks the duck
// uniformly until that holds at EVERY turntable angle (fitSweep, default on).
//
// 2D UI (§4, §6): title, price and buttons are HTML beside / under the tile, never over it, so no
// HTML ever sits over content that comes out of the glass.

import { createInline3D } from '@displayxr/inline3d';
import { addModel } from '@displayxr/inline3d/model';

const $ = (id) => document.getElementById(id);
const canvas = $('tile');
const cover = $('cover');
const depth = $('depth');
const modeBtn = $('mode');
const modeNote = $('modeNote');

const MODEL = new URL('../assets/Duck.gltf', import.meta.url).href;
const VDH = 0.16;                      // virtual display height, metres (as starter-model)
const FRONT = 0.1, BACK = 0.27;        // depth budget, tile heights (16:9 tile, comfortable)
const BG = '#ebe8e1';                  // == --bg in index.html (opaque clear matches the page)

// Draco decoder: three's libs/draco files (draco_wasm_wrapper.js + draco_decoder.wasm). The SDK
// snapshot does not ship them and the SDK never picks a CDN on its own, so point it at jsDelivr,
// pinned to the same three version as the import map (served with CORS). To self-host, copy
// three/examples/jsm/libs/draco/ to ./draco/ and set DRACO = new URL('./draco/', import.meta.url).href.
const DRACO = 'https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/libs/draco/';
const IDLE_SPIN = 12;                  // deg/s turntable once idle; a drag takes over

const wall = await createInline3D({ lazy: false });

const model = addModel(wall, canvas, MODEL, {
  virtualDisplayHeight: VDH,
  clearColor: BG,                      // OPAQUE clear: alpha-0 pixels weave as stale/black
  depthFit: { front: FRONT, back: BACK },
  idleSpin: IDLE_SPIN,
  // Wheel / pinch zoom is a brief "look closer" that eases back to 1× (relax). 1.5× pushes the
  // front to ≈ 0.15 h ≈ 0.9 % — inside the "strong, briefly" column — and only while zooming.
  zoom: { min: 0.8, max: 1.5, relax: true },
  decoderPath: { draco: DRACO },
  // no `feather`: it fades to transparent and needs an alpha clear (guide §5).
});

// Centred, only the FRONT budget binds. Slide back by (BACK − FRONT)/2 = 0.085 h and refit: both
// ends then sit at their budget and the duck can be larger for the same comfort.
const DEPTH_OFFSET = -((BACK - FRONT) / 2) * VDH;
const framed = model.ready.then(() => {
  model.viewer.depthOffset = DEPTH_OFFSET;
  model.viewer.fitTo(model.frame.center, model.frame.extent);
  const r = model.depthReport?.();
  if (r) console.info(`[duck] depth: front ${r.frontPct.toFixed(2)} % / behind ${r.backPct.toFixed(2)} % of width (${r.budget})`);
  return true;
}).catch((e) => {
  console.warn('[duck] model failed to load:', e);
  cover.textContent = 'The 3D view could not be loaded.';
  return false;
});

// Cover until framed AND woven, then cut (never fade). In an ordinary browser firstWoven resolves
// at once ('unsupported') and the flat, draggable view shows.
Promise.all([framed, model.firstWoven]).then(([ok]) => { if (ok) cover.hidden = true; });

// ---- rotate buttons: eased yaw steps (setPose snaps, so the page eases it) ----------------------
// The turntable pauses while the shopper looks at the angle they picked, then resumes.
let anim = 0, spinTimer = 0;
function turnTo(yawTarget) {
  const v = model.viewer;
  if (!v) return;
  cancelAnimationFrame(anim);
  v.idleSpin = 0;
  clearTimeout(spinTimer);
  spinTimer = setTimeout(() => { v.idleSpin = IDLE_SPIN; }, 6000);
  const from = v.getPose({ target: true }).yaw;
  const t0 = performance.now(), dur = 600;
  const step = (t) => {
    const k = Math.min(1, (t - t0) / dur);
    const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;   // ease in-out, no overshoot
    v.setPose({ yaw: from + (yawTarget - from) * e, depthOffset: DEPTH_OFFSET });
    if (k < 1) anim = requestAnimationFrame(step);
  };
  anim = requestAnimationFrame(step);
}
const curYaw = () => model.viewer?.getPose({ target: true }).yaw ?? 0;
$('left').addEventListener('click', () => turnTo(curYaw() - 45));
$('right').addEventListener('click', () => turnTo(curYaw() + 45));
$('reset').addEventListener('click', () => {
  // Shortest way back to the front; pitch and zoom back to rest too.
  const y = curYaw(), target = y - (((y % 360) + 540) % 360 - 180);
  model.viewer?.setPose({ pitch: 0, zoom: 1, depthOffset: DEPTH_OFFSET });
  turnTo(target);
});

// ---- depth slider: ONE value k moves BOTH factors (never scale.z) -------------------------------
// Display rig: 1 = what the display does naturally; below 1 only makes it shallower.
depth.addEventListener('input', () => {
  const k = Number(depth.value);
  model.setStereo({ ipdFactor: k, parallaxFactor: k });
});

// ---- 2D/3D switch: ask the display for its flat mode; show what the display REPORTS -------------
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
      // No flat mode on this display: the depth slider at 0 is flat anywhere.
      flat = !flat;
      depth.value = flat ? 0 : 1;
      depth.dispatchEvent(new Event('input'));
      showMode();
    });
  });
  showMode();
} else {
  // Ordinary browser: the same page, already flat. Keep the layout; say why the controls rest.
  modeBtn.disabled = depth.disabled = true;
  modeBtn.textContent = '2D';
  modeNote.textContent = 'Open this page in the DisplayXR Browser on a 3D display to see the duck in 3D.';
}

// ---- cart ----------------------------------------------------------------------------------------
let qty = 1, inCart = 0, resetTimer = 0;
const qtyOut = $('qty'), buy = $('buy');
$('minus').addEventListener('click', () => { qty = Math.max(1, qty - 1); qtyOut.value = qty; });
$('plus').addEventListener('click', () => { qty = Math.min(99, qty + 1); qtyOut.value = qty; });
buy.addEventListener('click', () => {
  inCart += qty;
  $('cartCount').textContent = inCart;
  buy.textContent = `Added ${qty} ✓`;
  buy.classList.add('done');
  clearTimeout(resetTimer);
  resetTimer = setTimeout(() => { buy.textContent = 'Add to cart'; buy.classList.remove('done'); }, 1800);
});
