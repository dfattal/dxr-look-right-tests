# Room walk-through — notes

Files: `index.html` (layout, HUD, import map), `main.js` (SDK wiring, controls, depth fitter),
`room.js` (procedural room in metres, no downloaded assets). three.js `0.161.0` from jsDelivr
(the version the SDK's own camera-rig sample pins). Add `?debug` to the URL for a live readout of
convergence, ipdFactor, the sampled depth range, comfort and `handle.stats()`.

## SDK API and rig
- `createInline3D({ lazy: false, autoChrome: false })` → `wall.addScene(canvas, onFrame, opts)`.
  If `wall.supported` is false, a plain three.js `setAnimationLoop` renders the app camera full-window.
- **Camera rig** (`cameraRigFromCamera` from `inline3d-three.js`). The docs say a first-person
  walkthrough needs one. It uses the **attach pattern**: an identity-posed rig (`attach: true`),
  both `EyeCamera`s parented under the app camera, and `setLocalFromView`. The rig is pushed every
  frame with `handle.setViewRig`, before validation. The first rig goes into `addScene`.
- Render loop as in the porting guide: validate `views.length >= 2` and both viewports *before*
  `clear()`, replay copied matrices (`setLocalFromMatrices`) on a bad frame, and never skip a frame.
  `setPixelRatio(1)`. The backing store is 2× wide while woven, in device px. It is clamped by one
  factor to the GL limits and to 2560 px per eye, and resized only on a real change, with an
  immediate repaint.
- Woven-canvas rules: the canvas has `will-change: transform` from its first paint and is
  committed at its SBS size two frames before `addScene`. An opaque cover sits on top until
  `handle.firstWoven` and is removed with a hard cut. `rectCover: 'auto'` handles window resizes,
  and `onLayerLost` drops the page to 2D. The HUD is small DOM panels: crisp, at zero disparity,
  solid tint, no `backdrop-filter`, hidden with `display:none`, and registered with
  `addGlobalOverlay`. There's no crosshair, because a glass-plane mark would fight content in
  front of the glass.

## Depth settings and why
- **Units = metres** (eye height 1.6 m, room 6×5×2.7 m). On a camera rig `ipdFactor` and
  `metersToVirtual` are absolute, so `metersToVirtual` stays at its default of 1 and `ipdFactor` 1
  means the viewer's real eye separation, i.e. the room at true scale.
- **FOV 55° vertical, near 0.05, far 80.** The same near/far go to `session.updateRenderState` and
  to the eye cameras' scalars. I never call `updateProjectionMatrix` on the eye cameras.
- **Depth fitter, instead of a fixed convergence.** The porting guide suggests a fixed look-ahead
  of a couple of metres for first person. In a small room that puts a wall 0.4 m away about 4×
  past the comfort budget in front of the glass, which shows up as double images. Every 4 frames I
  raycast a 7×5 grid from the app camera and take zNear/zFar along the view axis. Parallax as a
  fraction of IPD is `p(z) = ipd·0.5·(1/d − 1/z)`; at z→∞ this is the runtime's comfort formula.
  - `FRONT = 0.15` (≈10 mm crossed, ≈6–7 cm in front of the glass) and `BACK = 0.25` (≈16 mm,
    ≈17 cm behind; 0.25 is the auto-3D shim's open-scene comfort level).
  - Convergence = the diopter value that fits [zNear, zFar] into that budget with the largest ipd,
    `D* = (BACK·Dn + FRONT·Df)/(FRONT+BACK)`, clamped to 0.5–3 m (0.5 m is the runtime's comfort
    floor). It is eased with τ = 0.7 s so it never jumps as you sweep the view.
  - `ipdFactor` = min(1, what both bounds allow at the current convergence), with a floor of 0.15.
    It eases down fast (τ 0.15 s) when something comes close and recovers slowly (τ 0.9 s). In the
    open part of the room it sits at 1.0, which is true scale.
  - `parallaxFactor = ipdFactor`, as the shim does, so head look-around matches the stereo scale.
  - Both fade in from 0 over 700 ms after `firstWoven`. The `-`/`=` keys scale the budget from
    50% to 140%. "Less" also lowers the ipd cap; "more" never goes past real IPD.
- Collision radius 0.32 m and walk speed 1.35 m/s, with eased acceleration and no head bob, all
  for comfort.
- Static shadow maps render once (`shadowMap.autoUpdate = false`). Otherwise they would re-render
  for each eye.

## Unsure / untested (I had no browser and no display)
- None of this has run. I only syntax-checked it. Nothing has been checked in a 2D browser either,
  and the lighting intensities are guesses.
- The fitter goes against the docs' advice of a constant convergence for first person. On the
  panel, check that the slow convergence change doesn't read as the scene "breathing". If it does,
  raise `CONV_TAU` or fix convergence near 1.8 m and let only `ipdFactor` adapt.
- I'm inferring that `p(z)`, and so FRONT/BACK, map to millimetres on the panel from the comfort
  formula. The runtime may scale differently per display.
- Pointer lock over a woven canvas is unverified on hardware according to the SDK docs. Drag-look
  always works as a fallback.
- On a browser without `setViewRig`, the runtime uses a display rig (`virtualDisplayHeight` 0.24).
  I move the eyes forward by the reported eye depth so they land on the walker. That is my own
  approximation: expect a narrower FOV and plane-at-~0.6 m depth there.
