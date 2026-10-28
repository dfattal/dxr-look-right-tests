import { createInline3D } from '@displayxr/inline3d';
import { addModel } from '@displayxr/inline3d/model';

const $ = (id) => document.getElementById(id);
const status = $('status');

// ONE inline-3D session for the document; createInline3D resolves { supported:false } on a normal
// browser and addModel then renders a flat, orbitable view, so there is no separate 2D path.
const wall = await createInline3D({ lazy: false });

const handle = addModel(wall, $('tile'), new URL('../assets/Duck.gltf', import.meta.url).href, {
  engine: 'three',            // three's DRACOLoader fetches the decoder from decoderPath (CDN below)
  decoderPath: { draco: 'https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/libs/draco/' },
  virtualDisplayHeight: 0.16, // world scale of the tile: a modest, desk-sized object (as the SDK sample)
  margin: 0.7,                // subject fills <=70% of the tile so a turning duck never clips the edge
  depthLimit: 1.5,            // cap total depth at 1.5 display heights (default 4) - comfort backstop
  fitSweep: true,             // fit the horizontal diagonal so the beak/tail stay in frame at any yaw
  idleSpin: 10,               // slow turntable when idle; the viewer pauses it on input
  feather: 24,                // soft edge baked into the buffer (no CSS on the canvas)
  renderScale: 1,             // full-res per-eye buffer: product text/texture stays crisp
});

handle.ready.then(() => {
  status.textContent = wall.supported ? '' : 'Open in the DisplayXR Browser for glasses-free 3D.';
}).catch((err) => {
  status.textContent = `Could not load the model: ${err?.message || err}`;
});

// Keep the opaque cover over the canvas until the first WOVEN frame, then hard-cut it away.
Promise.allSettled([handle.ready, handle.firstWoven]).then(() => $('cover').remove());

// Rotation buttons, on top of drag. setPose eases toward the target.
const turn = (deg) => {
  if (!handle.viewer) return;
  const p = handle.viewer.getPose({ target: true });
  handle.viewer.setPose({ yaw: p.yaw + deg });
};
$('left').addEventListener('click', () => turn(-45));
$('right').addEventListener('click', () => turn(45));
$('reset').addEventListener('click', () => handle.resetPose());

// Add to cart (demo state only).
let qty = 0;
let timer;
const add = $('add');
add.addEventListener('click', () => {
  qty += 1;
  $('cart').innerHTML = `<b>${qty}</b> × Classic Rubber Duck in your cart — $${(qty * 12.99).toFixed(2)}`;
  add.textContent = 'Added ✓';
  clearTimeout(timer);
  timer = setTimeout(() => { add.textContent = 'Add to cart'; }, 1400);
});
