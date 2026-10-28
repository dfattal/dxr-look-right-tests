# Ring Flyer — notes

Files: `index.html` (layout, HUD, import map), `app.js` (game + SDK glue). three.js 0.180.0 from
jsDelivr; SDK from `/sdk/js/inline3d.js` and `/sdk/js/inline3d-three.js`.

## SDK API and rig
- `createInline3D({ lazy: false })` → `wall.addScene(canvas, onXRFrame, { viewRig, onResize })`.
- **Camera rig** (the user flies *through* a world): `cameraRigFromCamera(THREE, cam, { convergence,
  attach: true, ipdFactor, parallaxFactor })`, using the **attach pattern** from
  `samples/starter-world`. The rig has an identity pose, two `EyeCamera`s are parented under the
  chase camera and filled with `setLocalFromMatrices(view.projectionMatrix, view.transform.matrix)`.
  This avoids a one-frame stereo lag while the camera swings.
- Views are checked before clearing, and the last good frame is replayed if a frame has fewer than
  2 views. Clear is opaque, pixel ratio 1, the store is sized before registering and afterwards only
  in `onResize`, and `depthNear/depthFar` come from the camera (0.2 / 600).
- Without the 3D API (an ordinary browser), the same camera renders once with a normal rAF loop.
  The 3D controls are disabled, with a note.

## Depth settings (16:9 tile, vertical FOV 55°, world in metres, metersToVirtual 1)
Disparity was checked with the SDK's `cameraRigDisparityPct`:
- `convergence = 3.5` m, **fixed** = the plane's distance along the view axis (chase cam 3.4 m behind,
  1.1 m above, aiming 2.2 m ahead). The plane, the subject in the centre, sits on the glass, where
  the image is crisp. The world sits behind the glass. Convergence is never gaze-driven and never 0.
- `ipdFactor = 1` (63 mm). Sky/infinity is +0.97 %, mountains (330–430 m) +0.96 %. Both are within the
  full-frame "behind ≤ 1.0 %" comfortable budget. That budget is why D is 3.5 and not closer.
- Plane tail ≈ −0.24 % (centre of frame, under the 0.3 % full-frame front limit); nose ≈ +0.16 %.
- Ground at the bottom edge stays at or behind the glass: the plane keeps ≥ 2.2 m clearance, and the
  camera ≥ 2.8 m above the ground below it.
- Comfort = ipd·m2v·(1/D)·0.6 ≈ 0.17 (must be ≤ 1).
- Rings are removed with a hard cut as soon as the plane crosses their plane (at the glass). They are
  also removed if they get nearer to the camera than ~2.9 m, so nothing comes out of the glass at a
  frame edge. The "collected" flash is attached to the plane, so it stays at the glass in the centre.
- Fog (70–205 m) and hazy, low-contrast mountains/sky soften far edges. Clouds are soft sprites
  high above.
- Fixed 16:9 aspect, so these percentages hold at any window size.
- **Depth slider** k ∈ [0,1] sets `ipdFactor = k` and `parallaxFactor = k` together. Camera-rig
  factors are absolute, so the slider tops out at the tuned value. **2D/3D button**:
  `setStereoEnabled`, and the label follows `renderingmodechange`. If the display has no flat mode,
  the button falls back to slider = 0.
- HUD (score/best/help) sits at the top over the sky (behind the glass). Its backgrounds are plain
  `rgba()`, with no filter/opacity/transform. Controls sit below the tile. A cover stays up until
  `handle.firstWoven` and is then removed in one step.

## Unsure about
- Nothing was tested in a browser or on a panel (no three.js locally, no display). The code passes
  `node --check`, and the depth numbers come from the formula and the SDK helper only.
- A sky at +0.97 % is at the edge of the full-frame budget. If the horizon ghosts on hardware, lower
  `IPD` (e.g. 0.8) or raise `CONVERGENCE` slightly (the plane would then sit slightly in front).
- The plane's own relief is small (≈ 0.4 % total). The depth comes mostly from plane-vs-world
  separation. A closer chase cam would deepen the plane but push the sky past budget.
- I assumed `handle.on('renderingmodechange')` and `setStereoEnabled` behave the same on a
  camera-rig `addScene` as they do in the display-rig `starter-ui` sample.
- Controls: ↑ climbs, ↓ dives (arcade style, not flight-sim inverted).
