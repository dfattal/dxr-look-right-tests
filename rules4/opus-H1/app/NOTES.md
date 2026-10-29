# Spatial Globe — notes

Files: `index.html` (layout, CSS, import map), `app.js` (scene, interaction, SDK wiring),
`earth.js` (procedural textures: hand-drawn continent outlines with coastlines roughened by noise,
biome colours, specular and cloud maps; nothing is downloaded). three.js is `0.180.0` from jsDelivr,
the same version the SDK's model and splat samples use.

## SDK API and view rig
- `createInline3D({ lazy: false })` → `wall.supported`. If false, or if setup throws,
  `SceneViewer.startMono()` draws a normal 2D globe.
- `SceneViewer` (`/sdk/js/inline3d-viewer.js`, experimental tier) handles framing, drag-to-spin,
  wheel zoom, the idle turntable, the validated side-by-side loop and the mono fallback.
  `useEyeCamera(EyeCamera)` enables real stereo. `useDepthCursor(DepthCursor, raycastHitTest(...))`
  lifts the cursor over the globe, which comes out of the glass.
- `wall.addScene(canvas, onFrame, { virtualDisplayHeight, onLayerLost, rectCover })`. `onFrame`
  saves the midpoint of the two eye positions for picking, then calls `viewer.onFrame`.
- **Display rig** (the default). The visitor turns a subject, so the globe rotates under a fixed
  portal and no camera moves. The SDK docs prescribe this for orbit viewers, and it keeps the depth
  the same whatever the globe's size in model units.

## Depth-related settings, and why
- `virtualDisplayHeight: 0.24` (the SDK default), passed to both `SceneViewer` and `addScene`. On a
  display rig the fit scales the subject into this height, so the value does not change how deep
  the globe looks.
- `fit: 'contain'`, `margin: 0.8` (default): the globe fills 80% of the tile height and is
  **centred on the zero-disparity plane**. Following the SDK's rule 1, I left that placement alone:
  no `depthOffset`, no shrinking, no flattening. The front of the globe pops out of the glass by
  about its radius, and the limb sits on the glass.
- `fitSweep: false`: a sphere is the same width at every rotation, so the default allowance for a
  long object turning into the frame would only shrink the globe.
- Fit extent `2.16` model units (Earth radius 1): includes the atmosphere halo (1.06) and the
  marker heads (about 1.08), so neither gets clipped.
- Zoom is limited to ×0.75–×1.3, against the viewer's ×0.2–×6. A wheel listener in the capture
  phase swallows events past the limit. Zooming in pushes the front of the globe further out of
  the glass; ×6 would be far past comfortable.
- No `ipdFactor`/`parallaxFactor`/`perspectiveFactor` overrides: the runtime's defaults are used.
- Background is `#171b22` dark grey, both in the page and as an opaque `scene.background`. This
  follows rule 3 (no pure black behind a bright subject) and sidesteps the known bug where a
  transparent woven canvas shows as black. No edge feather, because the tile is the same colour as
  the page.
- Moderate texture contrast (no pure white or black), and the glow is placed at the limb, where
  disparity is close to zero, to limit crosstalk ghosting.
- All UI (city list, info panel) is HTML **beside** the canvas, not over it. Text is drawn at the
  glass, crisp and at native resolution, and no overlay rules apply. No `backdrop-filter`, and no
  CSS effects on the canvas or its parents.
- Woven-canvas rules: `will-change: transform` in CSS from first paint. The 2:1 backing store is
  sized before registering, then two frames pass before `addScene`. An opaque cover sits on top and
  is hard-cut on `handle.firstWoven`, with a 6 s fallback and on any error.
  `rectCover: { color: BG, snapshot: true }` covers responsive resizes.

## Picking
On a display rig there is no app camera. A click (a press that moves less than 6 px) casts a ray
from the eye midpoint of the latest frame through the pointer's point on the glass (the `z = 0`
plane, `VH` tall). In 2D, or before the first stereo frame, the ray comes from `viewer.monoCamera`,
which frames the same plane. Rays hit the globe and generous invisible proxy spheres, so markers on
the far side are blocked by the globe.

## Unsure / unverified (no hardware or browser was available)
- I couldn't run it in any browser. Only a syntax check and a script confirming all five cities
  fall inside the land outlines were run. Lighting levels (three r180 light units), colours and the
  speed of building the textures at load (2048×1024, done in JavaScript) are untested.
- How deep the globe looks is the SDK's default framing. I could not judge it on a panel.
- Picking from the eye midpoint is my own reading of "map the pointer onto the z = 0 plane". The
  depth cursor sits on the line of sight through the pointer, so the two should agree, but this is
  not verified.
- `viewer.idleSpin` is set at runtime (0 while a city is selected, so it stays in front). It is a
  plain field on `SceneViewer` but not declared in `viewer.d.ts`.
- The selection animation calls `setPose` every frame from `onTick`. That works with the viewer's
  easing, but it is not a documented animation path.
- Population figures are approximate census values from memory (labelled in the panel).
