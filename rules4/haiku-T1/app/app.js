// Product showcase: one glTF duck in an inline-3D window that the shopper turns by dragging, with
// the title, price and button as plain 2D page content beside it. Depth settings: see NOTES.md.

import { createInline3D } from '../../sdk/js/inline3d.js';
import { addModel } from '../../sdk/js/inline3d-model-entry.js';

const MODEL = new URL('../assets/Duck.gltf', import.meta.url).href;
// The Draco decoder is three's, from the same release as the import map. The SDK never fetches a
// decoder from a CDN on its own, so the page names where the files are. For an offline build,
// copy three/examples/jsm/libs/draco/ into ./app/draco/ and use './draco/' here.
const DRACO = 'https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/libs/draco/';

const $ = (id) => document.getElementById(id);
const canvas = $('tile');
const cover = $('cover');
const note = $('note');
const addBtn = $('add');
const resetBtn = $('reset');
const cartNote = $('cartNote');

const wall = await createInline3D({ lazy: false });

// Display rig (addModel's only rig): the duck is the subject, so it sits centred on the glass.
const tile = addModel(wall, canvas, MODEL, {
  virtualDisplayHeight: 0.24, // the SDK default, written out: the world scale of the display
  fit: 'contain',
  margin: 0.8,                // fraction of the tile the subject may fill, width and height
  fitSweep: true,             // fit the diagonal so the duck stays in the tile as it turns
  idleSpin: 0,                // no auto-turn: the shopper turns it, so the depth never moves unasked
  feather: 24,                // soft edge in the buffer, not CSS
  decoderPath: { draco: DRACO },
});

// Cover until the first woven frame, then a hard cut. A timer releases it too, so a missed signal
// cannot leave the page covered with no scene (making-3d-look-right.md, rule 4).
let released = false;
const release = () => {
  if (released) return;
  released = true;
  cover.hidden = true;
};
tile.firstWoven.then(release);
setTimeout(release, 8000);

tile.ready.then(
  () => {
    note.textContent = wall.supported
      ? 'Drag to turn the duck.'
      : 'Drag to turn the duck. Open in the DisplayXR Browser to see it in 3D.';
  },
  (err) => {
    release();
    note.textContent = `The 3D view could not load: ${err?.message || err}`;
  },
);

resetBtn.addEventListener('click', () => tile.resetPose());

let inCart = 0;
addBtn.addEventListener('click', () => {
  inCart += 1;
  cartNote.textContent = `Added to cart (${inCart}).`;
});
