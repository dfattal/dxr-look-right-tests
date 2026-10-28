# Room walk-through — notes

Files: `index.html`, `app.js` (three.js 0.161.0 pinned via CDN import map; SDK from `/sdk/js/`).
Not run in a browser or on a 3D display. `app.js` only passed a Node syntax check, so a first load may still turn up runtime errors.

## SDK API and rig
- `createInline3D({ lazy: false, autoChrome: false })` → `wall.addScene(canvas, onFrame, { viewRig, onResize, onLayerLost })`.
  The SDK is imported dynamically in a try/catch; if it is missing or `wall.supported` is false, the page runs a plain 2D loop.
- **Camera rig**, not a display rig: the visitor is somewhere and moves (first person). `cameraRigFromCamera(THREE, appCam, …)`.
- **Attach pattern**: the rig is identity-posed (`attach: true`). Two `EyeCamera`s are parented under `appCam`, which is in the scene.
  Eyes use `setLocalFromView`. This removes the one-frame stereo lag while looking around.
- Per frame: `setViewRig` (applies to the next locate), validate views/viewports before `clear()`, render both eyes into `layer.getViewport()`,
  and keep copies of the matrices to replay the last good frame (`setLocalFromMatrices`). Never `updateProjectionMatrix()` on an eye.
- Picking is not used. If added, raycast from `appCam`.

## Depth-related settings
- **Metre-scale world** (room 5 × 4.5 × 2.7 m, eye height 1.6 m). On a camera rig the 63 mm IPD is absolute, so metre units give natural depth.
- **`convergence = 2.6` m, fixed.** Docs advise a fixed look-ahead for first person; hit-testing convergence makes the scene "breathe".
  Comfort = 1 × 1 × (1/2.6) × 0.5 ≈ 0.19, well under 1. The room centre sits on the glass, the far wall and window recede behind it,
  and near furniture comes out of the glass moderately.
- **`ipdFactor = 0.8`.** Absolute on a camera rig. A little under 1 because everything in a small room is near and crossed disparity grows fast.
  Raise it to 1 for more depth.
- **`metersToVirtual` left at 1** (the scene is in metres). It is not used as a depth dial.
- **FOV 62°, near 0.1, far 60.** Passed through `updateRenderState` too. The vertical FOV comes from `appCam`.
- **Collision radius 0.55 m** against walls and furniture, so the nearest surface is ≥ ~0.5 m from the eye. This caps the maximum crossed
  disparity and avoids uncomfortable screen-edge violations from very close geometry.
- **No head-bob, smoothed acceleration, no camera roll.** Motion that conflicts with real head tracking or varies convergence is uncomfortable.
- **Outside the window**: sky plane at 28 m, hills at 18–24 m, trees at 6–13 m. This gives real far parallax through the window while staying
  within the comfort limit (diopters < 0.2).
- **Low-contrast procedural textures** (mipmaps + anisotropy 8), no thin bright lines or specular shimmer, no shadow maps (they would be rendered
  twice). Blob contact shadows are used instead. Both increase fusion comfort and cut the cost of the two eye renders.
- **Backing store**: double-width (2 × CSS px × dpr) while woven, 1:1 in 2D. `setPixelRatio(1)`. The SBS buffer is capped at the panel's pixel
  width (`screen.width × dpr`), per the SDK note about full-window canvases. Height stays full.
  Resizes compare sizes first (so no no-op clear) and replay immediately from `onResize`.

## 2D UI and weave hygiene
- HUD is DOM: small partial boxes with a solid translucent tint, no `backdrop-filter`. DOM sits at zero disparity, so it stays crisp.
- The canvas has no border, radius, shadow, filter or opacity. The HUD elements are registered with `addGlobalOverlay` (harmless on draw-order browsers).
- An opaque "Entering 3D…" cover sits on top of the fresh canvas until `handle.firstWoven` resolves, then it is hidden with `display:none` (hard cut).
  The help box is hidden with `display:none` too, never `opacity`.

## Unsure about
- **Pointer lock**: the docs say it is unverified over a woven canvas. Drag-to-look is the default; pointer lock is opt-in with `L`.
- **`preserveDrawingBuffer: true`** is on, as the docs suggest trying for large scene canvases. It costs some performance, and I did not check it on hardware.
- **`ipdFactor` 0.8 and `convergence` 2.6** are reasoned guesses. Tune them on the panel.
- **Per-eye aspect** is set to the CSS box aspect (`appCam.aspect`), while the SBS buffer may be narrower than 2× the box when capped.
  I assume the runtime un-squeezes it from its own projection, as it does for the 2:1 buffer. I did not confirm this.
- `onLayerLost` falls back to the mono loop in-page; I did not test that path.
