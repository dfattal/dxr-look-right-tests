# Duck product page — notes

Files: `index.html` (layout, CSS, import map) and `app.js`.

## SDK API and view rig
- `createInline3D({ lazy: false })`: one session for the document, with one tile that is always on screen.
- `addModel(wall, canvas, '/assets/Duck.gltf', opts)` from `/sdk/js/inline3d-model-entry.js`. It uses the
  default **PlayCanvas** engine (`playcanvas@2.22.3`). If PlayCanvas can't be imported, the SDK falls back
  to three.js (`three@0.180.0`), which is also in the import map.
- **Display rig** (addModel's default, `virtualDisplayHeight` mode). The docs say to use it whenever the
  user turns the *subject*, and an orbit counts. The SDK scales the duck into the virtual display, so
  depth doesn't depend on model units.
- The same call works in a normal browser. Without a session, addModel renders a flat view that can
  still be orbited.
- The Draco decoder comes from `decoderPath.draco` pointed at three@0.180.0's `libs/draco/` on jsDelivr.

## Depth-related settings
| Setting | Value | Why |
|---|---|---|
| `virtualDisplayHeight` | 0.24 | SDK default. The fit normalises against it, so it sets world scale, not apparent depth. |
| `fit` / `margin` | `contain` / 0.78 | Keeps the duck clear of the tile edges, so popped-out parts never get cut off by the window frame. |
| `fitSweep` | true | Fits the turntable diagonal, so the duck stays inside the tile at every yaw. |
| `depthOffset` | −0.3 × turntable radius, every frame, 3D only | Puts about 35% of the duck in front of the glass and 65% behind it. The bill still comes out, but there is less pop-out (less crosstalk and double image) and the far side stays comfortable. It is recomputed every frame because `resetPose()` clears it and a refit or zoom changes the scale. |
| `orbitMaxDeg` | 15 | Limits drag tilt so the depth stays near the fitted range. |
| `zoom` | min 1, max 1.5, `relax: true` | Lets the shopper peek closer. It eases back to 1×, so the extra depth from zooming never sticks. |
| `idleSpin` | 10 °/s | A slow turntable that shows the duck's depth. The SDK turns it off under reduced motion. |
| `feather` | 24 px | Fades each eye's edge inside the buffer. CSS borders or radius would split between the eyes. |
| `cursor` | `'depth'` | Draws the pointer in front of popped-out geometry, so it doesn't sit on the glass "inside" the duck. |
| `renderScale` | 0.7 | Per-eye buffer scale. The interlace halves resolution anyway, so this costs nothing visible. |
| ipd / parallax | defaults (1) | addModel doesn't expose them. The display's natural values apply, and the SDK's 2D↔3D mode switch handles the transition. |

## Woven-canvas rules applied
- The canvas has a 2:1 backing store and `will-change: transform` from its first paint. The page waits two
  frames before registering it.
- An opaque black cover sits on top until `ready` and `firstWoven` both resolve. It is removed with a
  hard cut, not a fade.
- No CSS effects, radius, border or outline on the canvas or its ancestors. The focus ring is drawn on
  the wrapper, outside the canvas. The black stage background is *under* the canvas, which matches the
  black a transparent woven pixel shows on the panel.
- The UI (title, price, quantity, Add to cart, cart count) is ordinary DOM next to the tile and never
  overlaps it. It stays native-resolution 2D with no overlay or exclusion needed, and the header is
  neither sticky nor fixed.

## Things I'm unsure about (untested on hardware; no browser was available)
- **Draco decoder from a CDN.** The SDK deliberately defaults to `/draco/` on the page's own origin, and
  I couldn't copy the files locally. This setup assumes PlayCanvas's Draco worker and the SDK's
  preflight fetch accept cross-origin URLs. jsDelivr serves CORS `*`. For production, copy
  `three/examples/jsm/libs/draco/` to `/app/draco/` and set `decoderPath`.
- **`DEPTH_BIAS` = 0.3** is a judgement call, not something I measured on a panel. `0` (centred on the
  glass) is the SDK and native convention. Tune it on the device.
- How deep the duck looks in absolute terms depends on the tile's physical size. CSS caps it at
  `min(560px, 68vh)`.
- `depthOffset` is a documented viewer setter, but I'm calling it every frame to re-apply it after
  `resetPose()`. That relies on it being cheap, which the docs imply.
- The duck's front-facing direction at yaw 0 comes from the asset, and I haven't seen it.
