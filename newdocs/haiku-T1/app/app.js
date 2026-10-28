// Product showcase: the Duck as a glasses-free 3D product, with its title, price and Add to cart
// beside the tile. Built from samples/starter-model; the rules are docs/making-3d-look-right.md
// and the reasons for each setting are in NOTES.md.
//
// RIG (guide §1): the shopper turns an OBJECT, so a display rig: addModel's default.
// SCREEN PLANE (§2): through the subject. addModel centres the duck on the glass; the turntable
// turns it about that centre.
// DEPTH (§3): depthFit shrinks the duck uniformly until, at every turntable angle, its nearest
// point is <= 0.1 tile heights in front of the glass and its farthest <= 0.27 behind: the 16:9
// comfortable column. depthOffset then centres that budget (below).
// 2D UI (§4, §6): title, price and button live BESIDE the tile, never over the part of the duck
// that comes out of the glass.

import { createInline3D } from '@displayxr/inline3d';
import { addModel } from '@displayxr/inline3d/model';

const canvas = document.getElementById('tile');
const cover = document.getElementById('cover');
const depth = document.getElementById('depth');
const modeBtn = document.getElementById('mode');
const modeNote = document.getElementById('modeNote');
const buy = document.getElementById('buy');
const liveStatus = document.getElementById('status');

const MODEL = new URL('../assets/Duck.gltf', import.meta.url).href;
const VDH = 0.16;                       // virtual display height, metres (the size knob)
const FRONT = 0.1, BACK = 0.27;         // depth budget, tile heights (16:9, comfortable)
// Centred on the glass, only the FRONT budget binds. Sliding the duck back by half the spare
// budget (0.085 h) lets both ends sit at their limit, so the duck is larger for the same comfort.
const DEPTH_OFFSET = -((BACK - FRONT) / 2) * VDH;
const BG = '#e9e6df';                   // == the page colour behind the tile (index.html)
// The Draco decoder is served by three's own files. This snapshot ships no copy, so it is read
// from jsDelivr at the same three version as the import map. For an offline build, copy
// three/examples/jsm/libs/draco/ to ../vendor/draco/ and point this at that path.
const DRACO_PATH = 'https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/libs/draco/';

const wall = await createInline3D({ lazy: false });
const model = addModel(wall, canvas, MODEL, {
  virtualDisplayHeight: VDH,
  clearColor: BG,                       // OPAQUE clear: alpha-0 pixels weave as stale/black
  depthFit: { front: FRONT, back: BACK },
  idleSpin: 14,                         // degrees/s once idle; drag to turn
  // depthFit is not refitted on zoom, so zooming IN would take the duck past the budget. Zoom
  // out is always comfortable; zoom in stops at the budgeted size, and the duck relaxes to 1x.
  zoom: { min: 0.6, max: 1, relax: true },
  decoderPath: { draco: DRACO_PATH },
  // no `feather`: it fades to transparent, which needs an alpha clear (guide §5)
});

const framed = model.ready.then(() => {
  model.viewer.depthOffset = DEPTH_OFFSET;
  model.viewer.fitTo(model.frame.center, model.frame.extent);
}).catch((e) => {
  console.warn('[product] model failed to load:', e);
  liveStatus.textContent = 'The 3D model could not be loaded.';
});

// Cover until the duck is framed AND the tile is woven; then cut (never fade). In an ordinary
// browser firstWoven resolves at once ('unsupported') and the flat view is shown.
Promise.all([framed, model.firstWoven]).then(() => cover.remove());

// ---- depth slider: ONE value k moves BOTH factors, so the look-around shrinks with the depth ------
// On a display rig 1 = what the display does naturally; below 1 only makes it shallower.
depth.addEventListener('input', () => {
  const k = Number(depth.value);
  model.setStereo({ ipdFactor: k, parallaxFactor: k });
});

// ---- 2D/3D switch: ask the display for its flat mode; show the state the display REPORTS ----------
let flat = false;                       // what the display last reported, never what we asked for
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
      // This display lists no flat mode (the call changed nothing): fall back to the slider,
      // which gives a flat image on any display.
      flat = !flat;
      depth.value = flat ? 0 : 1;
      depth.dispatchEvent(new Event('input'));
      showMode();
    });
  });
  showMode();
} else {
  // An ordinary browser: the same page, already flat. Keep the layout; say why the controls rest.
  modeBtn.disabled = depth.disabled = true;
  modeBtn.textContent = '2D';
  modeNote.textContent = 'Open this page in the DisplayXR Browser on a 3D display to see it in 3D.';
}

// ---- cart: the page's own state, announced through the live region ------------------------------
let inCart = 0;
buy.addEventListener('click', () => {
  inCart += 1;
  liveStatus.textContent = `Added to cart. ${inCart} in cart.`;
});
