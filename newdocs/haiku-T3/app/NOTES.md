# NOTES — a room to walk through (`/app/`)

## SDK API and view rig

- **Rig:** camera rig. The visitor moves through a room, so the app owns a `THREE.PerspectiveCamera`
  (metres) and the rig is `cameraRigFromCamera(THREE, cam, { convergence, attach: true, ipdFactor, parallaxFactor })`.
- **Attach pattern:** two `EyeCamera`s are parented under `cam`; the rig is sent once with an identity pose,
  so the eyes take this frame's pose with no one-frame lag. Each eye is drawn with
  `setLocalFromMatrices(proj, pose)` into its `layer.getViewport(view)`.
- **Entry points:** `createInline3D({ lazy: false })`, `wall.addScene(canvas, onXRFrame, { viewRig, onResize, onLayerLost })`,
  `wall.session.updateRenderState({ depthNear, depthFar })`, `handle.firstWoven` (cover until then),
  `handle.setViewRig` (depth slider), `handle.setStereoEnabled` + `handle.on('renderingmodechange')` (2D/3D switch).
- **Loop:** views are validated before the canvas is cleared; a short list replays the last good frame.
  The store is sized before `addScene` and afterwards only in `onResize`; it is capped to the GL limits.
- **Import map:** three.js 0.180.0 from jsDelivr (same pin as `samples/starter-world`); `/sdk/js/...` for the SDK.
- **Ordinary browser:** `createInline3D` resolves `{ supported: false }`; the same room draws as one flat view and
  the depth and 2D controls are disabled.

## Depth settings and why

| Setting | Value | Why |
|---|---|---|
| Rig type | camera | the user walks through the world (guide §1) |
| `convergence` | 0.9 × 1.6 / tan(30°) = **2.49 m** | the floor at the bottom edge of a level view is 1.6 / tan 30° = 2.77 m ahead; 0.9× puts it just behind the glass. Fixed; not gaze-driven; never 0. |
| `ipdFactor` | **1** (63 mm), slider top | the natural eye separation; absolute on a camera rig |
| `parallaxFactor` | **1**, slider top | natural head-tracking response |
| Slider | `k` in [0, 1] moves both factors | one comfort dial; the guide's rule 8. At 0 the eyes collapse to one image. |
| `FOV` | 60° vertical | sets the convergence and the disparity denominator |
| Eye height | 1.6 m | the floor at the bottom edge sits at 2.77 m, behind the glass |
| Ceiling | 3.2 m | the ceiling at the top edge is also 2.77 m, behind the glass |
| Room | 6.4 m wide, far wall 9 m, near wall 1 m | the far wall sits at **0.89 %** of width behind the glass |
| Window backdrop | 10.5 m, mid-tone, low contrast | 0.94 % behind (comfortable is ≤ 1.0 %); no open sky at infinity |
| `CLEAR` | **1.4 m** from walls and furniture | the viewer cannot get closer; see "unsure" below |
| `depthNear` / `depthFar` | 0.05 / 30 | the camera's near and far, passed once to the session |

All disparity figures are my arithmetic with the guide's camera-rig formula
(`100·0.063·(1/D − 1/z) / (2·tan(fov/2)·aspect)`). They are not measured on a panel.

## Unsure

- **Close approach pops out.** At `CLEAR` = 1.4 m, a wall or chair at the frame edge is about 1.36 m away, which is
  roughly **−1 %** in front of the glass (strong column, not the comfortable one). Pulling that below ~0.6 %
  would need about 1.7 m, which the room cannot give. If double images show near the furniture or the side
  walls on the panel, raise `CLEAR` (the walk area shrinks) or move the furniture.
- **Start view:** nothing is nearer than the convergence (nearest edge content ≈ 2.77 m), so the start pose should be
  behind the glass throughout. I have not seen it on a panel.
- **2D mode:** switching resizes the store (one view, full width) and clears it for a frame. The one-view
  path is untested on hardware.
- **Mouse look:** drag, not pointer lock. Pointer lock was not verified in the DisplayXR Browser.
- **Fallback rig:** `addScene` gets `viewRig` only. A browser without the camera-rig API falls back to a display
  rig at the default height, so the room will look different there. The guide suggests also passing
  `virtualDisplayHeight`, but that warns when both are given. I did not add it.
- **Not run:** I had no browser and no display. I checked the module parses (`node --check`) and that the furniture
  layout is walkable with a grid flood fill; I did not check the picture.
