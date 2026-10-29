# Solar system: notes

Files: `index.html` (page, import map, CSS), `app.js` (scene and inline-3D loop).
Served at `/app/`; the SDK is imported from `/sdk/js/`; three.js is `three@0.161.0` from jsDelivr.

## SDK API and view rig

- `createInline3D({ lazy: false })` once per document, then `wall.addScene(canvas, onFrame, {...})`.
- Eyes: `EyeCamera` from `/sdk/js/inline3d-three.js`, `setFromView` on live frames and
  `setFromMatrices` on the replayed last-good frame. `displayRig()` builds the rig.
- Signals and safety: `handle.firstWoven`, `onLayerLost` (drops to the flat view),
  `onResize` (resizes the store and repaints), `rectCover`, `wall.session.updateRenderState`.
- Rig: **display rig** (`viewRig: displayRig({ virtualDisplayHeight: 0.24, ... })`). The canvas is
  a portal and the solar system is a subject the viewer looks at, not a camera they move through.
  That makes it the SDK's documented case for a display rig. No camera rig, no convergence to pick.

## Depth and comfort settings, and why

| Setting | Value | Why |
|---|---|---|
| `virtualDisplayHeight` | 0.24 m | The SDK default, written out. The whole system spans about 70% of the glass. |
| `ipdFactor` | 1 | Natural eye separation. The depth budget is already small, so I did not cut it for comfort. |
| `parallaxFactor` | 1 | Full head-tracking response, so the look-around reads. |
| `perspectiveFactor` | 1 | The default skew. |
| `TILT` | 0.44 rad (25°) | Orbits lean toward the viewer. Planet depth is about `orbit × sin(TILT)`, so the largest is ±0.034 m (about ±14% of the virtual display). Enough to read as 3D, small enough to fuse. |
| Sun at z = 0 | the origin | The sun is the zero-disparity anchor: crisp at the glass, and the planets pop in and out around it. |
| `SWAY` | ±0.2 rad, 48 s period | The whole system rocks slowly. The motion gives parallax without a fast change in depth. |
| Starfield depth | z in [−0.35, −0.08] m | Behind the glass, and short of the far end where disparity grows. The field is scaled to cover the view at each depth. |
| Starfield brightness | dim, 0.3–0.65 | Bright points on black double first on this panel. |
| Background | `#1e222b` (dark grey), opaque | Rule 3: never pure black. The page uses the same colour, so the canvas edge does not show. |
| `DEPTH_NEAR` / `DEPTH_FAR` | 0.1 / 2 m | The scene is 0.5–0.95 m from the eye. Set once on the session with `updateRenderState`. |
| Cover | opaque, `firstWoven`, 8 s safety | Rule 5: the raw side-by-side pair never shows. The cover always comes off. |
| `rectCover` | `{ color: '#1e222b' }` | Rule 11: covers a layout resize. It is off by default on `addScene`. `'auto'` would cover in black (`#000`), so I set the page colour instead. |

Other choices:

- No edge feathering. The clear colour is opaque, because a fully transparent woven frame can come
  out black (a known browser issue). The starfield fills the box instead.
- The backing store is 2× width while woven and clamped to the GL limits in `sizeStore()`, so the
  browser never clamps it silently.
- `preserveDrawingBuffer: true`, for older DisplayXR builds that can drop a frame otherwise.
- No DOM over the canvas. The status line and the Pause button sit below it (rules 8–10).

## Not verified

- I could not run a browser or see the display. Nothing here has been seen on a panel.
  The depth, lighting and star density are reasoned, not measured.
- Lighting: a single point light with `decay 0` at intensity 2.2, plus ambient 0.3. The values are
  a guess. Planets may be too dark or too bright.
- Starfield coverage assumes a canvas wider than tall, up to about 2.2:1. A taller box would show
  the field's edges.
- The 8 s cover timer, the 1.2 s hold and the rectCover colour are my reading of the docs.
- `/sdk/llms.txt` names samples (`camera-rig`, `display-modes`) that are not in the snapshot. I
  used `samples/hello-cube` and `docs/` instead.
