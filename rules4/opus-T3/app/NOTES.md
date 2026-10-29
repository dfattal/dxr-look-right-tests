# A small room: notes

`index.html` + `main.js`. three.js 0.180.0 (pinned, jsDelivr). The SDK comes from `/sdk/js/` through the import map.

## SDK API and rig
- `createInline3D({ lazy: false, autoChrome: false })`, then `wall.addScene(canvas, onFrame, opts)`. I wrote the render loop myself (no SceneViewer).
- **Camera rig** (`cameraRigFromCamera`), because this is a first-person walk-through: the user moves through a world. The rig goes in at construction and again every frame via `handle.setViewRig`.
- **Attach pattern**: the rig has an identity pose, and the two `EyeCamera`s are children of the app camera (`setLocalFromMatrices`). This keeps the stereo from lagging one frame behind mouse-look.
- Each frame is checked before `clear()`: it needs two views and valid viewports. If not, the last good matrices are redrawn (from copies). `ViewerEase` smooths the jump when a viewer's tracking is picked up or lost.
- If the SDK is missing, or `supported` is false, or the layer is lost, the page drops to a flat `setAnimationLoop` render from the app camera. Same scene, same controls.

## Depth-related settings
- **Scene in metres** (room 5 × 6 × 2.7 m, eye height 1.6 m). On a camera rig `ipdFactor` and `metersToVirtual` are absolute, so metre scale means the 63 mm baseline is the real one. Both are left at 1. No scale correction.
- **`convergence: 1.6` m, fixed.** Rule: keep convergence fixed in a world, and never set it from where the user is looking. At 1.6 m the table and chairs, seen from a few steps away, sit on the glass. Far walls and the view outside recede. Comfort = 1 × 1 × (1/1.6) × 0.5 ≈ 0.31, well under 1.
- **Vertical FOV 55°.** A bit narrower than a typical FPS. The depth budget grows as the FOV narrows.
- **`BODY_RADIUS` 0.45 m** collision with walls and furniture. This also limits how far anything can pop out of the glass (about −2.6× baseline at 0.45 m, versus about +1× for the far distance).
- **near/far 0.05 / 120.** Passed to `session.updateRenderState` and set as plain values on the eye cameras. `updateProjectionMatrix()` is never called on an eye.
- **Eased walking** (velocity is smoothed), no head-bob, no sudden camera jumps.
- **No pure black:** page, clear colour and covers are `#2b2825`. The view out of the window (sky, hills, trees) is kept soft and low-contrast because it is the farthest thing from the glass.
- **Low-contrast, fine surface textures** (wood grain, plaster, rug) give the eyes something to match for depth. Plain flat walls would show no depth.
- **Shadow map is drawn once** (`autoUpdate = false`). Otherwise it would be redrawn for every eye.

## Canvas and UI
- `setPixelRatio(1)`. While woven, the backing store is (CSS width × dpr × `SBS_SCALE`) wide; it is 1:1 in 2D. `SBS_SCALE` is 1 by default, so each eye gets half the width, which keeps a full-window buffer no wider than the panel (pitfall 26). `?scale=2` gives each eye full width.
- `preserveDrawingBuffer: true` is also from pitfall 26.
- `setSize` is only called when the size really changes; `onResize` redraws straight away.
- The canvas has `will-change: transform` in CSS from its first paint. It is sized before registration, and registration waits two animation frames.
- An opaque cover stays up until `handle.firstWoven`, with a 6 s safety timeout, then is removed with a hard cut. `rectCover` handles later resizes.
- The HUD is DOM plates (crisp, they sit on the glass), solid backgrounds, no `backdrop-filter`, none full-bleed. They are registered with `addGlobalOverlay` for browsers without draw-order occlusion.
- There is no crosshair, on purpose: it would sit on the glass and look like it floats in front of far walls.

## Things I wasn't sure about
- **Pointer lock over a woven canvas has not been tested on hardware** (the docs say so). Drag-to-look and arrow keys always work too.
- **1.6 m convergence and 55° FOV are educated guesses**, not tuned on a panel. If near furniture doubles, try 1.8–2.0 m. If the room looks flat, try a smaller FOV.
- **Fallback when there is no `setViewRig`:** I pass `virtualDisplayHeight: 0.12`, reasoning that it keeps the display rig's nominal eye close behind the app camera. This is not verified.
- **Buffer width:** I'm not sure the half-width-per-eye default is the best trade-off between sharpness and stutter on current browsers.
- Lighting values (sun 3.0, hemisphere 0.85, lamp 4.0 cd, ACES tone mapping) were set by reasoning only. I never saw a single rendered frame.
