# Hill Flyer — notes

**API:** `createInline3D({ lazy:false, autoChrome:false })` → `wall.addScene(canvas, onFrame, { viewRig })`, three.js 0.161 with `EyeCamera` + `cameraRigFromCamera`. Double-width SBS backing store, `setPixelRatio(1)`, per-eye viewport/scissor from `layer.getViewport`. Falls back to a plain mono three.js loop when `wall.supported` is false.

**Rig: camera rig, attach pattern.** It is a game with a moving chase camera, so a display rig can't express it. The app camera is in the scene, the eye cameras are parented under it, the rig is sent with an identity pose, and the eyes use `setLocalFromView`. This avoids the one-frame stereo lag.

## Depth settings
- `convergence = 10` (fixed, never driven by gaze or terrain). The plane sits ~10 units in front of the chase camera, so it lands on the glass. Terrain below pops slightly out, and hills and mountains recede behind it.
- `metersToVirtual = 10` (1 unit = 10 cm). Camera-rig IPD is absolute, so this sets a sensible eye baseline for a scene authored at "game" scale. Comfort = 1·10·(1/10)·0.5 = **0.5** (≤ 1), so distant mountains never ask the eyes to diverge.
- `ipdFactor` and `parallaxFactor` are left at 1 (the default).
- `fov = 40°`; `depthNear 0.5`, `depthFar 2500`, set through `session.updateRenderState`. The nearest content (ground under the camera, clamped ≥ 2 units above terrain) stays well beyond the near plane and not extremely close, which limits crossed disparity.
- Background is never black. The horizon, fog and sky base are a light haze colour, and the page and cover are dark grey `#232830`. The mountains are baked toward the haze colour in layers (atmospheric perspective), with no thin high-contrast far detail.
- A soft ground shadow blob under the plane is an extra depth cue.
- Fog runs 70–330 and the terrain is 360 units wide, so its edge is fully fogged into the mountain base. The mountain rings follow the player at 85–98%, which gives a little parallax.
- The HUD is DOM (crisp, on the glass at zero disparity), in opaque plates registered with `addGlobalOverlay`. The canvas has no border, radius or filter. There is no full-bleed overlay except the startup cover, which comes off on `firstWoven` with a 4.5 s timeout and also in the error and 2D paths.

## Unsure about
- I couldn't view it on a display, so the comfort of the nearest ground and the pop-out strength are untested. The tuning knobs are `CONV` and `M2V` at the top of `game.js` (a larger `CONV` with the same `M2V` is gentler).
- Resizing the window clears one frame in woven mode (no replay on resize).
- three is pinned at 0.161.0, copied from the SDK's own samples.
- The terrain shader patches `MeshLambertMaterial` chunks, which are valid for 0.161 but may break on other versions.
