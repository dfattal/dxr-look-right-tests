// Product showcase: the Duck glTF as a glasses-free 3D element, with the product copy beside it.
// Every depth-related choice below is explained in ./NOTES.md.

import { createInline3D } from '@displayxr/inline3d';
import { addModel } from '@displayxr/inline3d/model';

// The Draco-compressed glTF in ../assets/ (its .bin and texture sit beside it).
const MODEL = new URL('../assets/Duck.gltf', import.meta.url).href;
// Draco decoder runtime files, from three@0.180.0 (the version the SDK's model sample pins). This
// web root has no decoder of its own, so they come from jsDelivr. decoderPath takes the parent
// directory that holds draco/ and basis/.
const DECODER = 'https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/libs/';

const stage = document.getElementById('stage');
const canvas = document.getElementById('tile');
const cover = document.getElementById('cover');
const coverText = document.getElementById('coverText');
const statusEl = document.getElementById('status');
const addBtn = document.getElementById('add');
const resetBtn = document.getElementById('reset');

// lazy: false, as in the SDK's model sample: the tile is created at load, not when it scrolls in.
const wall = await createInline3D({ lazy: false });

const handle = addModel(wall, canvas, MODEL, {
  // Height of the tile in metres. This only sets the world scale of the eye poses. The viewer fits
  // the duck to the tile, so it does not change how big the duck looks. Same value as the model sample.
  virtualDisplayHeight: 0.16,
  // Full resolution. The duck is one light mesh, and the SDK already caps the buffer at DPR 2 and the GL limits.
  renderScale: 1,
  // Slow turn, restarted after 2.5 s without input, so a shopper who has stopped dragging sees the
  // duck move and gets depth from the parallax. Any drag stops it straight away.
  idleSpin: 8,
  // Depth-aware pointer. Without it the OS cursor is drawn on the glass, which reads as broken
  // when the duck's nose is popping out in front of it.
  cursor: 'depth',
  decoderPath: DECODER,
});

// The viewer turns the wheel over the tile into zoom and calls preventDefault on it, which stops
// the page scrolling while the pointer is over the product. Stop the wheel here, before it reaches
// the canvas, so the page scrolls. Drag still rotates; wheel zoom is given up for this page.
stage.addEventListener('wheel', (ev) => ev.stopPropagation(), { capture: true, passive: true });

// Release the cover only when the model is loaded and the browser has woven a real stereo frame
// (handle.firstWoven). The release is a hard cut, never a fade: a fading tile-sized plate flashes.
Promise.allSettled([handle.ready, handle.firstWoven]).then(([loaded]) => {
  if (loaded.status === 'rejected') {
    coverText.textContent = 'The 3D model could not be loaded.';
    console.error(loaded.reason);
    return;
  }
  cover.hidden = true;
});

let inCart = 0;
addBtn.addEventListener('click', () => {
  inCart += 1;
  // Placeholder: replace with a call to your cart API.
  statusEl.textContent = `Added to cart. ${inCart} in cart.`;
});

resetBtn.addEventListener('click', () => {
  // The viewer exists once the duck is framed, so there is nothing to reset before that.
  if (handle.frame) handle.resetPose();
});
