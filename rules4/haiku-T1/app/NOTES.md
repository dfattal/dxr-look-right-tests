# Product page notes

## What was used

- **API:** `createInline3D({ lazy: false })` from `/sdk/js/inline3d.js`, then
  `addModel(wall, canvas, Duck.gltf, opts)` from `/sdk/js/inline3d-model-entry.js`.
  Default engine (PlayCanvas, `playcanvas@2.22.3` in the import map). The SDK's `ModelHandle`
  supplies `firstWoven`, `ready` and `resetPose()`.
- **View rig:** display rig (the `addModel` default). The duck is the subject the shopper turns,
  so it sits centred on the glass (`docs/making-3d-look-right.md`, rule 1). No `viewRig`, no
  convergence, no `depthOffset`.
- **Layout:** title, price, and "Add to cart" are plain 2D DOM beside the canvas, not over it.
  Text and buttons stay crisp and nothing sits over the weave.

## Depth-related settings

| Setting | Value | Why |
|---|---|---|
| `virtualDisplayHeight` | `0.24` | The SDK default, written out. It sets the world scale of the display; `fit` normalises the apparent size, so this does not change how big the duck looks. |
| `fit` | `'contain'` | The default. Frames the subject to the tile. |
| `margin` | `0.8` | The default. The duck fills 80% of the tile, leaving room to turn without clipping. |
| `fitSweep` | `true` | The default. Fits the box's diagonal, so the duck stays inside the tile at every yaw. |
| `idleSpin` | `0` | Default is 8°/s. A constantly turning subject changes its depth all the time, which tires the eyes. The shopper turns it instead. |
| `feather` | `24` | Soft edge in the buffer, as the SDK's model sample does. Edges fade rather than end at a hard rectangle. |
| `depthLimit` | default (`4.0`) | Backstop only; left alone. |
| `renderScale` | default (`1`) | Full resolution for crispness. The duck is a small mesh, so no perf reason to reduce it. |
| `cursor` | default (off) | Depth cursor is opt-in and not needed for a subject that stays on or near the glass. |

Not used: `depthOffset`, `setFocus`, convergence. Each would move the subject off the glass or
change the depth budget, which rule 1 forbids for objects.

## Other settings

- **Cover:** a dark-grey cover sits on top of the canvas until `firstWoven` resolves, then it is
  removed (hard cut). An 8 s timer and a `ready` failure also remove it, so the page cannot stay
  covered with no scene (rule 5 and making-3d rule 4).
- **Draco decoder:** `decoderPath: { draco: 'https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/libs/draco/' }`.
  The snapshot has no decoder files and the SDK never fetches one by default. The CDN path is
  the same three release as the import map.

## Unsure / not verified

- **Not tested on the panel.** Only syntax was checked. The 3D look, the depth comfort, the
  cover timing and the drag feel are all unverified.
- **Transparent background weaves black.** The model backend clears to transparent
  (`clearColor (0,0,0,0)`) and offers no background option. Rule 3 asks for dark grey behind a
  bright subject, but the SDK's own transparent clear weaves black. I did not reach into the
  engine's camera to change it, and the duck is yellow on black. This is the first thing to check
  on hardware.
- **Price and title are placeholders** ($12.00, "Classic Rubber Duck"). The description is
  generic and makes no product claims. The duck is credited as CC0 (Sony) per the SDK sample's
  note on the same model. Confirm the credit for your catalogue asset.
- **CDN decoder in a worker.** The PlayCanvas Draco worker has to load the decoder from jsDelivr
  cross-origin. For an offline build, copy `three/examples/jsm/libs/draco/` into `./app/draco/`
  and point `decoderPath` at `'./draco/'`.
- **Drag on touch.** The canvas has `touch-action: none` so a horizontal drag turns the duck
  instead of scrolling the page. Check that page scroll still works from the info column on a phone.
- **Flat browsers.** Without a DisplayXR session `wall.supported` is false. `addModel` then gives a
  flat orbitable view, the cover is released at once, and the note says to open the DisplayXR
  Browser for 3D. Confirm this on an ordinary browser.
