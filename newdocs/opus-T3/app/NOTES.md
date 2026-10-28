# Room walk-through — notes

Files: `index.html` (layout, import map, HUD, controls) and `app.js` (scene and SDK wiring).
three.js r0.180.0 comes from jsDelivr. The SDK is imported from `/sdk/js/inline3d.js` and `/sdk/js/inline3d-three.js`.

## SDK API and rig
- `createInline3D({ lazy: false })` → `wall.addScene(canvas, onXRFrame, { viewRig, onResize })`.
- **Camera rig**, because the visitor moves through a world (guide §1):
  `cameraRigFromCamera(THREE, cam, { convergence, attach: true, ipdFactor, parallaxFactor })`.
  It uses the **attach pattern**: the rig is sent once with an identity pose, the two `EyeCamera`s are children of the app camera, and each eye is set with `setLocalFromMatrices(view.projectionMatrix, view.transform.matrix)`. Mouse-look therefore has no one-frame rig lag.
- The loop follows `samples/starter-world`:
  - views are checked before the clear, and the last good frame is replayed if the view list is short;
  - the clear is opaque and the pixel ratio is 1;
  - the backing store is 2× wide, sized before registering and afterwards only in `onResize`;
  - `session.updateRenderState({ depthNear: 0.05, depthFar: 30 })` matches the camera.
- **2D/3D switch:** `handle.setStereoEnabled()`, labelled from `renderingmodechange`. If the display can't switch, it falls back to depth 0.
- **Depth slider:** k ∈ [0,1] sets `ipdFactor` and `parallaxFactor` together, both = k.
- **Ordinary browser:** `wall.supported === false` → the same camera draws once per frame (mono), and the 3D controls are disabled with a note.

## Depth settings and why
Disparity is given as a % of tile width, ≈ 3.07·k·(1/D − 1/z) for FOV 60° on a 16:9 tile.
- `FOV = 60°`, `EYE_H = 1.6 m`, `ROOM.h = 3.2 m`. The ceiling is as far above the eye as the floor is below it, so the top and bottom edges are at the same depth.
- **`convergence = 0.9·EYE_H/tan(30°) ≈ 2.49 m`, fixed.** This is the nearest content touching a frame edge (the floor at the bottom, the ceiling at the top). Converging 10% nearer puts every edge just behind the glass, like looking through a window. Convergence is never driven by gaze or the cursor, and never 0.
- Room width 5.6 m, so the side walls reach the left/right edges at ≈ 2.7 m, which is behind the glass.
- **`ipdFactor = parallaxFactor = 1`** (the slider's top). Values from the start pose:
  - chairs: +0.4%
  - far wall (7.3 m): +0.8%
  - garden backdrop: ≤ +0.98% from the worst pose in the room
  
  All of these sit inside the full-frame "behind ≤ 1.0%" budget. Nothing in front at the start.
- **No infinity.** The window looks onto a lawn, hedge and trees, then a painted, low-contrast sky/hill backdrop at z = −10.5 m, with side panels so it never runs out. Open sky would be 1.23%.
- **Pitch is clamped to ±0.45 rad**, so the floor or ceiling at an edge never comes nearer than ≈ 1.7 m (≈ −0.6%).
- **Collision clearance:** 0.6 m from walls, 0.4 m from furniture. This limits, but cannot prevent, things coming out of the glass when you walk right up to them.
- Furniture in the centre of the start view is ≥ 3.5 m away. Small table props are central, never at an edge.
- **HUD** sits at the top, over the ceiling, which is behind the glass. It uses a plain `rgba()` background. The other controls are outside the canvas.
- No CSS filter, opacity or transform on or over the canvas. A cover hides the canvas until `firstWoven`, then is removed in one cut.
- Textures are procedural and irregular, so the eyes can fuse them. The backdrop is soft and hazy, because high-contrast edges far behind the glass ghost first.
- Shadow maps render once (`shadowMap.autoUpdate = false`): the scene is static, and this avoids extra shadow passes for the second eye.

## Unsure about
- Nothing was tested on a display or even in a browser; only a syntax check was run. The lighting and tone-mapping values are tuned blind.
- **Walking close to things:** walls or furniture 0.5–1 m away come well out of the glass (2–5%) and cross the frame edges. That is inherent to a walk-through with fixed convergence and IPD. The docs forbid adapting either per glance, so I left it to the clearance and the Depth slider. On hardware, a default k of about 0.7–0.8 may be more comfortable.
- **Pointer lock over a woven canvas is unverified on hardware** (according to the SDK docs). Drag-to-look always works as a fallback.
- The disparity figures are hand-calculated from the guide's formula, not measured by the SDK's stereo judge.
