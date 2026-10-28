// Product page: the Draco-compressed Duck in one woven inline-3D tile (addModel, display rig),
// with the title / price / cart as ordinary 2D DOM beside it. Same code path in a plain browser:
// addModel renders a flat, orbitable view when there is no inline-3D session.

import { createInline3D } from '@displayxr/inline3d';
import { addModel } from '@displayxr/inline3d/model';

const MODEL_URL = new URL('../assets/Duck.gltf', location.href).href;

// The SDK never fetches decoders from a CDN by itself, and the default is /draco/ on this origin.
// This page has no copy of three's decoder files, so point at the same files three@0.180.0 ships.
// Copy three/examples/jsm/libs/draco/ to /app/draco/ and change this to serve them yourself.
const DECODER_PATH = { draco: 'https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/libs/draco/' };

// Display metres the tile's height spans. With a display rig the fit scales the duck into this
// virtual display, so depth is scale-invariant. 0.24 is the SDK default.
const VIRTUAL_DISPLAY_HEIGHT = 0.24;

// Fraction of the turntable radius pushed BEHIND the glass. 0 = centred on the zero-disparity
// plane (the SDK default: half the duck in front, half behind). 0.3 puts ~35% of it in front of
// the glass and ~65% behind: the bill still comes out at the shopper, the tile edges hold less
// pop-out (less window violation, less crosstalk), and the far side stays in an easy range.
const DEPTH_BIAS = 0.3;

// ── cart (wired first: it must work whether or not the 3D loads) ───────────────────────────
let qty = 1;
let inCart = 0;
const qtyOut = document.getElementById('qty');
const added = document.getElementById('added');
const setQty = (n) => { qty = Math.max(1, Math.min(9, n)); qtyOut.textContent = String(qty); };
document.getElementById('qtyDown').addEventListener('click', () => setQty(qty - 1));
document.getElementById('qtyUp').addEventListener('click', () => setQty(qty + 1));
document.getElementById('addToCart').addEventListener('click', () => {
  inCart += qty;
  document.getElementById('cartCount').textContent = String(inCart);
  added.textContent = `✓ Added ${qty} × Classic Rubber Duck — $${(qty * 14.99).toFixed(2)}`;
});

const canvas = document.getElementById('tile');
const cover = document.getElementById('cover');
const status = document.getElementById('status');

// One inline-3D session for the whole document (rule 1). lazy:false — one tile, always on screen.
const wall = await createInline3D({ lazy: false });
const woven = wall.supported;

// Rule 4: canvas is in the DOM with its final box, will-change and a 2:1 store; give the
// compositor two frames with it before registering.
await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

const product = addModel(wall, canvas, MODEL_URL, {
  virtualDisplayHeight: VIRTUAL_DISPLAY_HEIGHT,
  fit: 'contain',
  margin: 0.78, // a little air round the duck: edges of the tile stay clear of the subject
  fitSweep: true, // fit the turntable's diagonal, so the duck never leaves the tile as it spins
  idleSpin: 10, // slow turntable when untouched (the SDK disables it for prefers-reduced-motion)
  orbitStyle: 'turntable',
  orbitMaxDeg: 15, // drag tilt cap: keeps the duck upright and its depth near the fitted range
  zoom: { min: 1, max: 1.5, relax: true }, // a peek, eased back to 1x — never a lasting depth change
  feather: 24, // fade each eye's edges in-buffer (CSS borders/radius would split between eyes)
  renderScale: 0.7, // per-eye buffer scale; the interlace halves resolution anyway
  cursor: 'depth', // never leave the pointer on the glass behind the popped-out bill
  decoderPath: DECODER_PATH,
});

// ── depth placement ────────────────────────────────────────────────────────────────────────
// Re-evaluated every frame (cheap) so a refit on resize or a zoom keeps the same proportion.
// Only on a woven tile: in 2D there is no glass to sit behind, so the flat view stays as fitted.
function placeDepth() {
  const v = product.viewer;
  if (!woven || !v || !product.frame) return;
  const { scale } = v.getSubjectBounds();
  const [ex, , ez] = product.frame.extent;
  const radius = 0.5 * Math.hypot(ex, ez) * scale; // turntable radius in display metres
  const want = -DEPTH_BIAS * radius;
  if (Math.abs(v.depthOffset - want) > 1e-5) v.depthOffset = want;
}

// ── rotate buttons / keys: an eased yaw step through the public setPose/getPose ───────────
let anim = null;
function rotateBy(deg) {
  const v = product.viewer;
  if (!v || !product.frame) return;
  const from = anim ? anim.to : v.getPose({ target: true }).yaw;
  anim = { from: v.getPose().yaw, to: from + deg, t0: performance.now(), ms: 450 };
}
function stepAnim(now) {
  if (!anim) return;
  const k = Math.min(1, (now - anim.t0) / anim.ms);
  const e = k * k * (3 - 2 * k); // smoothstep
  product.setPose({ yaw: anim.from + (anim.to - anim.from) * e });
  if (k >= 1) anim = null;
}

(function tick(now) {
  requestAnimationFrame(tick);
  stepAnim(now);
  placeDepth();
})(performance.now());

document.getElementById('rotL').addEventListener('click', () => rotateBy(-45));
document.getElementById('rotR').addEventListener('click', () => rotateBy(45));
document.getElementById('reset').addEventListener('click', () => {
  anim = null;
  product.resetPose(); // also clears depthOffset; placeDepth() restores it next frame
});
canvas.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') rotateBy(-30);
  else if (e.key === 'ArrowRight') rotateBy(30);
  else if (e.key === 'Home') product.resetPose();
  else return;
  e.preventDefault();
});

// ── reveal: keep the opaque cover up until the model is in AND the tile is woven (rule 5) ──
try {
  await product.ready;
  const fw = await product.firstWoven; // resolves at once with reason 'unsupported' in 2D
  cover.remove(); // hard cut, never a fade
  status.textContent = woven && fw.woven
    ? 'Drag to rotate · viewing in glasses-free 3D'
    : 'Drag to rotate';
} catch (err) {
  console.error(err);
  cover.remove();
  status.textContent = 'The 3D model could not be loaded.';
}
