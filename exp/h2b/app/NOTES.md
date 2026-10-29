# Desk tank: notes

## SDK API and view rig

- `createInline3D({ lazy: false })`, one manager for the document (rule 1).
- `wall.addScene(canvas, onXRFrame, { virtualDisplayHeight: 0.24, onResize, onLayerLost })`.
  The canvas is registered once and never remounted (rule 2).
- **Display rig** (the default, set by `virtualDisplayHeight`), not a camera rig. The user looks
  at a diorama and does not move a camera through it, so the tank is authored in metres and the
  runtime places the eyes. No `viewRig` is set and no ipd or parallax is tuned.
- Helpers: `EyeCamera` (`/sdk/js/inline3d-three.js`) for the eye matrices, `ViewerEase` for the
  SDK's tracking-acquisition glide (on by default), and `frameTrackingState`.
- `handle.firstWoven` releases the cover. `handle.rewoven()` covers window resizes.
- three.js 0.180.0 from jsdelivr. It is the version the SDK's samples use most.

## Depth and look settings, and why

- **`virtualDisplayHeight` 0.24 m.** Equals the `addScene` default. The glass (z = 0) spans
  24 cm of height. The tank is authored to that size, with no per-frame scaling (rule 1).
- **Glass at z = 0, tank behind it (z < 0).** The front rim and the top and bottom edges sit on
  the glass plane, where disparity is zero, so the frame reads crisp.
- **Tank depth 0.10 m** (back wall at z = -0.10). I chose this to keep the total scene depth
  near 0.1 m, about 40 % of the display height. The earlier 6 cm hello-cube has about 25 %.
  Deeper would be a stronger effect but more strain.
- **Fish z-range -0.096 … +0.016.** The nearest fish pops out about 1.6 cm, under 7 % of
  display height. Fish pass behind the glass most of the time, so the eye does not have to
  fuse large pop-out.
- **Background #1d2c33 (dark slate), opaque.** Not black, since crosstalk correction cannot go
  darker than black (rule 3). Not transparent, since a cleared woven frame weaves black.
  The page colour is the same, so the canvas edge disappears.
- **Fog from 0.6 m to 0.9 m, colour = background.** A gentle aerial fade. It reduces contrast
  on far detail (rule 3), and the back wall is only 0.1 m deep so the fade stays mild.
- **Sand, rocks and plants in mid to dark tones**, with flat-shaded rocks. No pure white anywhere.
- **Ipd, parallax and perspective factors left at their defaults (1).** On a display rig they
  are relative comfort dials. I could not test them on a panel, so I did not guess at them.
- **Store: 2:1 (two eyes side by side) at a 16:10 CSS box.** Per eye at most 1280 px wide,
  device pixel ratio capped at 2, and the viewport max respected. The side-by-side store is
  therefore at most 2560 px wide. This is a guess at a panel-friendly width.
- **Cover:** an opaque plate, hidden on `firstWoven`, with an 8 s hard cap. It is cut, never
  faded (rule 5). It comes back on resize and is released on `rewoven()` (rule 11).
- **Frames:** eye matrices are copied before use. A short view list or a null viewport replays
  the last good frame, and the first frames are a flat draw, not a clear (rule 4).
- **Canvas CSS:** no border, radius, shadow, opacity, filter or backdrop-filter, on the canvas
  or its ancestors (rule 7). Text sits outside the canvas, so nothing overlays the woven pixels
  (rules 8 to 10).
- **Flat view FOV = 2·atan(0.12 / 0.6)**, so the plain-browser camera at 0.6 m frames the same
  24 cm slice the display rig does.

## Not sure about

- **Nothing was run.** I had no browser and no panel, and I could not run `node --check` in
  this environment. The JS was reviewed by reading only, so a typo or runtime error is possible.
- Whether 0.10 m of depth behind a 0.24 m virtual display is comfortable on a real panel.
  If it strains, first try `ipdFactor` below 1 through `setViewRig`, which is a display-rig
  comfort dial.
- Whether the glass side panes (opacity 0.07) and the rails read as glass or as clutter.
- `preserveDrawingBuffer: true` is set because the docs suggest it for large scene canvases
  on older builds. It costs a little per frame and may be unnecessary on newer builds.
- The fish colours, especially the silver one, may be brighter than the panel's crosstalk
  comfort likes. The fish are small, so I judged that acceptable.
- No depth cursor (`DepthCursor`) is used. The OS pointer is drawn on the glass plane, and the
  nearest fish pops out only about 1.6 cm, so I judged it unnecessary.
