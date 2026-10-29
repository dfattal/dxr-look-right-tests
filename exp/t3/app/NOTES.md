# Walk-through room: notes

SDK snapshot: `@displayxr/inline3d` 1.46.0 (`sdk/package.json`). three.js 0.161.0 from jsDelivr.
Not run in a browser: the code was parse-checked only. Nothing here has been seen on a DisplayXR panel.

## SDK API and view rig

- `createInline3D({ lazy: false })`: one session for the document (woven-canvas rule 1). `lazy: false`
  because this page has one window that is always on screen.
- `wall.addScene(canvas, onStereoFrame, { viewRig, rectCover: 'auto', onResize, onLayerLost })`
  on the full-window `<canvas>`. Each frame: validate the two views and their viewports, then
  `renderer.clear()`, then draw both eyes with `EyeCamera.setLocalFromView`.
- **View rig: camera rig**, from `cameraRigFromCamera(THREE, appCam, { attach: true, ... })`.
  The visitor is the viewpoint and walks through the room, which is the case the authoring guide
  gives for a camera rig ("a first-person walkthrough"). A display rig would fix the room to a
  portal, and the visitor could not move through it.
- **Attach pattern.** The rig has an identity pose and both eye cameras are parented under
  `appCam`, so the world pose comes from this frame's camera and not from a rig set last frame.
  `handle.setViewRig(...)` is pushed every frame (it drives the next frame's views).
- The cover (`#cover`) stays on top of the canvas until `handle.firstWoven` resolves (rule 5).
  `onLayerLost` and a browser without `inline3dViewRigSupported()` both go flat.

## Depth settings and why

| Setting | Value | Why |
|---|---|---|
| `VERTICAL_FOV_DEG` | 50 | Full vertical angle. Depth budget scales as `baseline / tan(vFov/2)`: 50° gives about 24% more depth range than 60°, while staying close to natural perspective. Judgment call, not measured. |
| `IPD_FACTOR` | 1 | On a camera rig this is absolute: a 63 mm eye separation at metre scale, which is correct by construction. Lowering it flattens the room; that is a comfort dial, not a fix. |
| `PARALLAX_FACTOR` | 1 | Full head-tracking response. |
| `METERS_TO_VIRTUAL` | 1 | The room is authored in metres, so no unit conversion is needed. No scale correction is applied anywhere (SDK guide: a camera rig that needs one is the wrong rig). |
| `CONVERGENCE_MIN` | 0.9 m | The comfort rule is `ipd × m2v × diopters × 0.5 ≤ 1`, which is convergence ≥ 0.5 m. 0.9 keeps a margin: comfort ≈ 0.56 at the closest allowed convergence. |
| `CONVERGENCE_MAX` | 3.0 m | Far walls and the window view sit behind the glass. Above this the scene only drifts further back and comfort gains nothing. |
| `CONVERGENCE_DEFAULT` | 2.0 m | Used when the look ray hits nothing. |
| `CONVERGENCE_TAU` | 0.35 s | Convergence follows what the look ray hits, eased with this time constant. Snapping it would slide the whole scene in depth in one frame, which reads as a jump. |
| `PLAYER_RADIUS` | 0.3 m | The walk keeps the lens about 0.3 m from walls and furniture. Objects closer than that produce large disparity. |
| `EYE_HEIGHT` | 1.6 m | Sets the eye point in metres. |
| near/far | not set | The runtime takes depth near/far from the session render state (SDK guide, camera-rig output). `appCam` near/far only matter in the flat path. |

Convergence is the only depth value that changes at runtime. The others are fixed.

## Rendering and safety

- `pixelRatio` is 1 and the store is sized in device pixels. The store is 2 eyes wide while woven
  and 1:1 when flat. The SDK's `getViewport()` reads backing-store pixels, so any other pixel ratio
  would zoom each eye.
- The store is clamped to `MAX_TEXTURE_SIZE` / `MAX_RENDERBUFFER_SIZE` / `MAX_VIEWPORT_DIMS`
  by my own code, not the SDK's internal clamp helper. A silent browser clamp gives a double image.
- A resize only reassigns the canvas size when the size really changed, because assigning clears
  the buffer (rule 11). `rectCover: 'auto'` covers the rect change until it weaves again.
- Shadow maps are baked once (`shadowMap.autoUpdate = false`). The room is static.
- Walls and the window frame do not cast shadows. They are closed boxes, so a sun or lamp that
  could see through them would block all light. Only furniture casts.
- Keys are cleared on window blur, so a key released in another window does not stay stuck.
- `#hud` is a small partial overlay tagged `data-inline3d-overlay`. It has a translucent tint, no
  `backdrop-filter` and no glow outside its box. It hides after 9 s.

## Not sure about

- **Light values are untuned.** I cannot see the output, so the sun (2.0), lamp (5 cd) and
  hemisphere (0.8) are starting points. Check them on the panel first.
- **Auto-convergence is a judgment call.** It is what makes the depth of whatever you look at
  sit on the glass. It may feel as if the room "breathes" while you turn. If it does, raise
  `CONVERGENCE_TAU` or fix `convergence` to a constant (around 2 m).
- **Pointer lock is unverified** in the DisplayXR Browser. Drag-to-look is the fallback and works
  without it. The SDK docs say nothing about pointer lock.
- **Sun through walls.** The sun is a non-occluded fill, so the far wall gets light it would not
  get in a real room. Shadows from the furniture still show, which is the depth cue that matters.
- **Mono fallback** uses the same scene and camera at 1:1 with a DPR cap of 2. It is not tested on
  a 2D monitor either.
- **Input lag.** The eye poses are parented, so a turn is not one frame behind. Convergence is one
  frame behind the look direction, and the easing hides that.
- **Not checked:** the `three` 0.161 class and option names I used are from memory of that release,
  and the SDK's `three.d.ts` was not compared against them.
