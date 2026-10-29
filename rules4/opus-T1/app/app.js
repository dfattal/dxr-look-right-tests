// Product page: one glTF in one woven tile (addModel, display rig), everything else plain DOM.

import { createInline3D } from '@displayxr/inline3d';
import { addModel } from '@displayxr/inline3d/model';

const MODEL_URL = new URL('../assets/Duck.gltf', import.meta.url).href;

// The Draco decoder files (three's libs/draco/). The SDK snapshot ships no vendor/draco/ folder and
// this site has nowhere else to serve them from, so they come from the same pinned three release
// the import map uses. Self-host them (decoderPath: '/draco/') for an offline build.
const DECODER_PATH = { draco: 'https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/libs/draco/' };

// Same value as --bg in index.html. The tile clears to it instead of transparent: a transparent
// woven frame comes out black on the panel, and a bright subject on black doubles first.
const BG = [0x20 / 255, 0x22 / 255, 0x27 / 255];
const BG_CSS = '#202227';

const canvas = document.getElementById('product');
const cover = document.getElementById('cover');
const hint = document.getElementById('hint');
const mode = document.getElementById('mode');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── the cover always comes off ─────────────────────────────────────────────────────────────────
let coverOff = false;
function dropCover() {
  if (coverOff) return;
  coverOff = true;
  cover.remove(); // hard cut, never a fade
}
const coverTimer = setTimeout(dropCover, 8000); // a missed signal must not leave the page sceneless

// ── one inline-3D session for the document ─────────────────────────────────────────────────────
let wall = null;
try {
  wall = await createInline3D({ lazy: false });
} catch (err) {
  console.warn('inline-3D unavailable, rendering flat:', err);
}
const woven = !!wall?.supported;
mode.textContent = woven
  ? 'Viewing in glasses-free 3D. Move your head to look around the duck.'
  : 'Interactive 3D view. On a DisplayXR 3D display this duck appears in glasses-free 3D.';

let handle = null;
try {
  handle = addModel(wall, canvas, MODEL_URL, {
    // Display rig (the default): the SDK scales the duck into the virtual display and centres it
    // on the glass. vH is metres of world the tile height spans; the fit normalises size against
    // it, so it does not change apparent size or depth. ~real scale for a 9 cm bath duck.
    virtualDisplayHeight: 0.12,
    // margin / fit / fitSweep / depthLimit left at the SDK defaults on purpose (rule 1: keep the
    // viewer's placement — it is already the smallest disparity spread the subject can have).
    idleSpin: reduceMotion ? 0 : 9,
    orbitStyle: 'turntable',
    // A little zoom for a closer look, relaxing back to the framed size so the duck never stays
    // pushed out of the glass.
    zoom: { min: 1, max: 1.35, relax: true },
    environment: 'neutral',
    renderScale: 1, // a single tile: keep the eye buffers at full resolution for crisp edges
    feather: 0, // feather fades to transparent, which weaves black against the grey page
    rectCover: { color: BG_CSS },
    decoderPath: DECODER_PATH,
  });
} catch (err) {
  fail(err);
}

if (handle) {
  // Opaque dark-grey clear on every camera the tile makes (eye cameras can appear lazily).
  const painted = new WeakSet();
  (function paintClear() {
    if (!handle) return;
    const app = handle.engine?.app;
    if (app?.root) {
      for (const cam of app.root.findComponents('camera')) {
        if (painted.has(cam) || cam.clearColorBuffer === false) continue;
        const c = cam.clearColor.clone();
        c.set(BG[0], BG[1], BG[2], 1);
        cam.clearColor = c;
        painted.add(cam);
      }
    }
    requestAnimationFrame(paintClear);
  })();

  Promise.all([handle.ready, handle.firstWoven])
    .then(([, fw]) => {
      if (woven && fw && !fw.woven) console.info('firstWoven:', fw.reason);
      clearTimeout(coverTimer);
      dropCover();
    })
    .catch(fail);
}

function fail(err) {
  console.error(err);
  clearTimeout(coverTimer);
  dropCover();
  hint.textContent = 'The 3D view could not be loaded.';
}

// ── rotate controls (buttons + arrow keys), eased through setPose ──────────────────────────────
let tween = 0;
function currentYaw() {
  return handle?.viewer?.getPose?.().yaw ?? 0;
}
function rotateTo(target, ms = reduceMotion ? 0 : 450) {
  if (!handle) return;
  cancelAnimationFrame(tween);
  const from = currentYaw();
  const t0 = performance.now();
  const step = (t) => {
    const k = ms ? Math.min(1, (t - t0) / ms) : 1;
    const e = 1 - Math.pow(1 - k, 3);
    try { handle.setPose({ yaw: from + (target - from) * e }); } catch { return; }
    if (k < 1) tween = requestAnimationFrame(step);
  };
  tween = requestAnimationFrame(step);
}
const rotateBy = (deg) => rotateTo(currentYaw() + deg);

document.getElementById('rotL').addEventListener('click', () => rotateBy(-45));
document.getElementById('rotR').addEventListener('click', () => rotateBy(45));
document.getElementById('reset').addEventListener('click', () => {
  cancelAnimationFrame(tween);
  const y = currentYaw();
  // Turn the short way home, then let resetPose clear zoom/pitch and restart the idle timer.
  const home = y - 360 * Math.round(y / 360);
  rotateTo(y - home);
  setTimeout(() => handle?.resetPose(), reduceMotion ? 0 : 470);
});
canvas.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') { rotateBy(-30); e.preventDefault(); }
  else if (e.key === 'ArrowRight') { rotateBy(30); e.preventDefault(); }
  else if (e.key === 'Home') { document.getElementById('reset').click(); e.preventDefault(); }
});

// ── cart ───────────────────────────────────────────────────────────────────────────────────────
let qty = 1;
let cart = 0;
const qtyEl = document.getElementById('qty');
const status = document.getElementById('status');
const setQty = (n) => { qty = Math.max(1, Math.min(10, n)); qtyEl.textContent = String(qty); };
document.getElementById('qtyMinus').addEventListener('click', () => setQty(qty - 1));
document.getElementById('qtyPlus').addEventListener('click', () => setQty(qty + 1));
document.getElementById('addToCart').addEventListener('click', () => {
  cart += qty;
  document.getElementById('cartCount').textContent = String(cart);
  status.textContent = `Added ${qty} × Classic Rubber Duck to your cart.`;
});
