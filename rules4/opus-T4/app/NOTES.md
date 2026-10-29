# Notes — 3D quarterly sales chart

Files: `index.html` (title, legend, controls, import map), `app.js` (scene and SDK wiring).
Libraries: three@0.161.0 from jsDelivr (the version the SDK's own scene samples use) and the SDK
from `/sdk/js/`.

## SDK API and view rig
- `createInline3D({ lazy: false })` is called once. If it returns `supported: false`, the page runs
  `SceneViewer.startMono()` and shows the same chart flat.
- `SceneViewer` (`@displayxr/inline3d/viewer`) with `useEyeCamera(EyeCamera)`, passed to
  `wall.addScene(canvas, viewer.onFrame, …)`. It does the framing, the side-by-side render loop
  that checks each frame before drawing (and redraws the last good frame instead of a black one),
  the tracking ease and the mono fallback.
- **Display rig**, set with `displayRig()` from `@displayxr/inline3d/three`. The chart is a
  subject you look at, not a world you move through, so the docs call for a display rig, not a
  camera rig. Dragging tilts the subject. It never moves a camera.
- Slider: `handle.setViewRig(displayRig({ ipdFactor }))`.
- 2D/3D button: `wall.setStereoEnabled(false/true)`. This puts the panel into its real 1-view
  mode, and the SDK ramps the depth down before the panel switches. If no 1-view mode can be
  requested, the page sets the rig's `ipdFactor` and `parallaxFactor` to 0 instead. The button
  label follows `renderingmodechange` and `wall.activeMode`.

## Depth-related settings and why
| Setting | Value | Why |
|---|---|---|
| `virtualDisplayHeight` | 0.24 m | The SDK default. Used for both the viewer and the rig, so a browser without view-rig support (which falls back to its own default of 0.24) frames it the same. |
| Framing | `fitTo()` on the box of the tilted chart, labels included; `fit:'contain'`, `margin:0.84` | The box is centred on the screen surface (z = 0): front rows come slightly out of the screen and the back wall sits slightly behind it. This is the smallest depth spread the chart can have (rule 1). I didn't push it back or flatten it. |
| `fitSweep` | false | Dragging is limited to ±35° of yaw, so the chart is fitted to its front-on width and not its diagonal. A full-diagonal fit would have made it much smaller. |
| `orbit` / `idleSpin` | off / 0 | My own drag is limited (yaw ±35°, total pitch 4°–44°) and has **no wheel zoom**: zoom would rescale the chart and grow its depth spread. No turntable either, because a chart should hold still while someone reads it. |
| Resting view | pitch 22°, yaw 20°, built into the subject | Shows the floor, the rows and the sides of the bars, so the depth reads clearly. |
| `ipdFactor` | 0–1 from the slider, default 1 | On a display rig this is relative: 1 is what the display does naturally, and lower values reduce disparity. |
| `parallaxFactor` | 1 (0 only in the fallback 2D mode) | Head-tracked look-around isn't what causes double images, so the slider leaves it alone. |
| Background / clear colour | `#1c2029`, opaque, the same on page and canvas | Dark grey, not black, because bright edges on black double first (rule 3). The clear is opaque because a transparent woven frame comes out black on the panel. |
| Text and grid | light grey (not white), thin boxes instead of 1-px lines, labels always face the screen | Keeps contrast moderate away from the screen surface. Each label sits at a single depth. |
| Cover | opaque, on top of the canvas, removed instantly on `handle.firstWoven`, after 6 s, or on any error | Prevents the raw side-by-side flash and can never stay stuck (rules 4 and 5). |
| `rectCover: {color: BG, snapshot: true}`, `bufferClamped: true` | | The SDK covers the canvas during resizes. SceneViewer sizes its own buffer within the GPU limits. |
| Registration | canvas has `will-change: transform` in CSS and a 2:1 buffer; `addScene` runs two frames later | Woven-canvas rule 4. |

All 2D UI (title, legend, slider, button, status) is outside the tile, so it stays sharp on every
browser version and needs no overlay handling. Nothing uses `backdrop-filter`, and the canvas and
its parents have no CSS effects.

## Unsure about
- None of this has been checked on a real panel or in any browser: I couldn't run one. Light
  levels, label sizes and the 22°/20° view were chosen without seeing them.
- Whether a full-height chart (84% of the tile, centred on the screen surface) is comfortable at
  slider 100% on a large panel. The docs say to trust the default placement. The slider is there
  to reduce it.
- The fallback when no 1-view mode exists flattens the rig, but the panel stays in its 3D optical
  mode. It looks flat but isn't the panel's true 2D mode.
- In-scene labels are rendered per eye, so they're softer than HTML text. The data is also in a
  hidden HTML table for screen readers.
- Tracking loss only produces a status hint. I assumed a MANAGED display, which flattens itself.
- In a normal browser the slider and 2D/3D button are disabled (with a tooltip), because there is
  no 3D to adjust there.
