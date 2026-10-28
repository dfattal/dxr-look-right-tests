# Desk Aquarium: notes

Files: `index.html`, `app.js` (three.js 0.161.0 from jsDelivr; SDK from `/sdk/js/`).
I could not run it in a browser or on the display, so none of this is tested visually.
I only syntax-checked `app.js`.

## SDK API and rig
- `createInline3D({ lazy: false })`, then `wall.addScene(canvas, onFrame, { virtualDisplayHeight })`.
  `EyeCamera.setFromView` is used per eye (two renders per frame, side by side).
- **Display rig**, set through the scalar `virtualDisplayHeight`. That is the default display rig:
  identity pose, factors 1.
  I chose it because the tank is a subject seen through a portal, not a viewpoint the user moves through.
  Depth therefore doesn't depend on world scale.
  I did not use a camera rig, and I send no rig updates (`setViewRig` is never called).
- No stereo maths in the app. The scene is authored in metres and the views are rendered as given.
- No SDK 3D mode (`woven`): the same scene renders to a 1:1 canvas with a normal camera and
  pointer parallax.

## Depth-related settings, and why
- `virtualDisplayHeight = 0.26` m. This is the zoom. The tank is 0.32 x 0.17 x 0.14 m, so it fills
  about 77% of the window width and leaves a margin for the head-tracked look-around.
- Tank placement: back glass at z = -0.105, front glass at z = +0.035, glass plane z = 0 inside the volume.
  Almost all of the depth goes behind the glass, which is the comfortable side.
  Only the front rim and a little of the fish volume pop out, by a few cm at most.
- Fish swim in z from about -0.08 to about 0.01, with per-fish z offsets so paths rarely cross.
  They stay off the front glass, so nothing gets large disparity.
- Backdrop: a flat gradient on the back glass, plus the sand slope, rocks, plants and bubbles at
  graded depths. These give strong, easy depth cues.
- `depthNear 0.05` / `depthFar 5` set via `session.updateRenderState`.
  The views' projection uses these, so they cover the eye distance (about 0.6-0.8 m after scaling)
  with margin and keep the z-buffer precise.
- `renderer.setPixelRatio(1)` and a backing store of 2x width, in device pixels (dpr capped at 2).
  The store is also capped to the GL limits and to the panel's physical width. `getViewport()` is
  in backing-store pixels, and any other ratio mis-scales each eye.
- Opaque clear colour `#05090e` matches the page background, so the window has no visible edge.
  I avoided a transparent canvas because the docs say a transparent woven canvas comes out
  black on the panel.
- Transparent items (glass, water, bubbles, surface) have `depthWrite:false` and explicit
  `renderOrder`. The glass is only about 5% opaque, so there is no reflection or double-image rivalry at the glass.
- All animation (fish, plants, caustics, water, bubbles) is driven by one clock, updated once per frame
  before the eye loop. Both eyes see identical state, so no temporal disparity.
- Caustics and plant sway are shader effects keyed on world position and the shared time uniform.
- Crisp UI: all text is DOM, outside and below the canvas, at zero disparity.
  The canvas has no CSS border, radius, shadow, filter or opacity.

## Robustness (from the SDK docs)
- Frames are validated before `clear()`. A short view list or null viewport replays the last good
  frame, using copied matrices.
- Resize compares sizes first and is applied inside `onFrame`.
- `will-change: transform` on the canvas from first paint, and a 2x store plus 2 frames before `addScene`.
- A page-coloured cover sits on top of the canvas until `handle.firstWoven` resolves, then is removed (hard cut).
- `onLayerLost` falls back to the mono path.

## Unsure about
- The caustic pattern's scale and brightness (`uv * 5`, strength 0.5 / 0.35) are guessed. Stereo
  shimmer on sand is worth checking.
- Whether to set `preserveDrawingBuffer: true`. The docs suggest it only for large scene canvases on older browsers. I left it off.
- Fish orientation and fin geometry (head at +x, texture stripes along the body) are untested visually.
  A fish might be backwards or a stripe off.
- `firstWoven` takes about 1.2 s on browsers without the join report, so the tank appears after a short
  "Preparing" cover.
- The cover is a full-bleed element over the canvas. The docs say that is correct for rule 5, but
  legacy overlay handling could in principle match it to the canvas rect. It is removed after the first join.
- The GL limit checks use `MAX_VIEWPORT_DIMS[0]` only.
