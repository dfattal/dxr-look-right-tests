# Duck product page: notes

## API and view rig

- `createInline3D({ lazy: false })` once per document, then `addModel(wall, canvas, Duck.gltf, opts)`
  from `/sdk/js/inline3d-model-entry.js`. Engine is the SDK default (PlayCanvas 2.22.3).
- **Display rig** (the SDK's default for `addModel`). The shopper turns the subject; the camera
  does not move. A camera rig would make the depth collapse as the duck is framed at its size.
- Used: `handle.ready`, `handle.firstWoven`, `handle.frame`, `handle.resetPose()`.

## Depth-related settings

| Setting | Value | Why |
|---|---|---|
| `virtualDisplayHeight` | `0.16` | Sets only the world scale of the eye poses. The viewer fits the duck to the tile, so apparent size does not change. Same value as the SDK model sample. |
| `margin` | default `0.8` | Duck stays inside the tile with room to turn. |
| `fit` / `fitSweep` | defaults (`height`, `true`) | Fits the horizontal diagonal, so the duck stays in the tile at every yaw. |
| `depthLimit` | default `4.0` | Not binding (see below). |
| `depthOffset` | not set (0) | Duck is centred on the zero-disparity plane, the SDK's convention. The SDK notes a biased placement read worse on hardware. |
| `renderScale` | `1` | Sharpest tile. The duck is one light mesh, and the SDK already caps the buffer at DPR 2 and the GL limits. |
| `feather` | not set (0) | The duck never reaches the tile edge, and a fade to transparent weaves black. |
| `idleSpin` | `8` °/s | Slow motion gives parallax. It restarts after 2.5 s without input and stops on any drag. |
| `cursor` | `'depth'` | Without it the OS arrow sits on the glass in front of a popped-out duck. The arrow mirrors the CSS `grab` cursor. |
| wheel guard (not an SDK option) | capture-phase `stopPropagation` on `#stage` | The viewer's wheel handler calls `preventDefault` and turns it into zoom, which would trap page scroll over the product. Wheel zoom is therefore disabled on this page. |

**Estimated depth budget** (my arithmetic, not measured). From the POSITION accessor bounds
(x 165.6, y 154.2, z 115.4 model units): the diagonal governs the fit, so the duck is about
0.76 × tile height tall and about 0.57 tile heights deep. That is ±0.29 tile heights around the
glass, or about ±4.6 cm at `virtualDisplayHeight` 0.16. `depthLimit` 4.0 does not bind. I left it
alone: lowering it would shrink the duck, and I have no hardware evidence for a better number.

**Stage and cover**

- The stage is black because the PlayCanvas clear colour is transparent, which weaves black on the
  panel. A black stage makes the tile's edge disappear on both the panel and a flat browser.
- An opaque black cover sits on top of the tile. It is released by a hard cut when both
  `ready` and `firstWoven` have settled (woven-canvas rule 5).

**Layout rules followed** (woven-canvas rules 7–10)

- No border, radius, shadow, opacity, filter or blur on the canvas or its ancestors.
- Price, title and button sit beside the tile, never over it. So there is no `exclude()`, no
  `data-inline3d-overlay`, and no `backdrop-filter`.
- `will-change: transform` on the canvas, as the SDK sets it.

## Not verified

- **Nothing was run.** I had no browser and no DisplayXR display. Only a syntax check of `app.js`
  passed. The depth comfort and the look are unseen.
- **Draco decoder from jsDelivr.** The SDK defaults to same-origin decoder files and says it does not
  fall back to a CDN. This page sets `decoderPath` to three@0.180.0 on jsDelivr, because this web root
  has no decoder. It is untested that the PlayCanvas Draco worker loads cross-origin. If it does not,
  `ready` rejects with the decoder path named, and the cover shows the error. To fix, copy
  `three/examples/jsm/libs/draco/` into the site and point `decoderPath` at it.
- **Wheel guard** relies on the SDK attaching its wheel listener to the canvas (a descendant of
  `#stage`). If that moves, the guard stops working.
- **Touch.** The SDK sets `touch-action: none` on the canvas. A vertical swipe over the tile will
  not scroll the page on a phone. I did not address this.
- **Keyboard.** The duck cannot be turned from the keyboard. Only "Reset view" is keyboard-reachable.
  A keyboard turn would need `viewer.setPose`.
- **Placeholders.** Title, price, blurb and "Add to cart" (an in-memory counter, not a cart) are
  placeholders.
- **Environment** uses the SDK default (`neutral`, PlayCanvas). I did not tune lighting for the duck.
