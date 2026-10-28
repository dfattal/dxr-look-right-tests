# Five cities: notes

Files: `index.html` (layout, import map), `app.js` (scene, input, SDK wiring), `earth-texture.js`
(procedural equirectangular Earth: rough continent outlines roughened by seamless 3D noise. Nothing
is downloaded).

## SDK API and rig
- `createInline3D({ lazy: false })` → `wall.addScene(canvas, viewer.onFrame, { viewRig, onLayerLost })`.
- **Display rig** (`displayRig({ virtualDisplayHeight: 0.24, ipdFactor: k, parallaxFactor: k })`),
  because the visitor turns an object rather than moving through a world.
- `SceneViewer` (`/sdk/js/inline3d-viewer.js`) with `useEyeCamera(EyeCamera)`. It draws each eye
  from its own view, keeps the last good frame when a frame comes up short, sizes the canvas with
  pixel ratio 1, and runs `startMono()` in an ordinary browser.
- The globe group is rotated inside `viewer.content` (yaw/pitch, eased, no overshoot). There is no
  camera move. `orbit: false` turns off the SDK's drag and wheel-zoom so that zoom can't push the
  globe past the depth budget; the page handles drag, click, arrow keys and a slow idle spin
  itself.
- `viewer.useDepthCursor(DepthCursor, () => raycastHitTest(THREE, [earth, markers]))` lifts the
  cursor over the front of the globe, which comes out of the glass.
- Depth slider: one value `k` sets both `ipdFactor` and `parallaxFactor` (range 0–1).
  2D/3D button: `handle.setStereoEnabled()`, with a fallback to `k = 0` if that call is rejected.
  The button label follows `renderingmodechange`. A cover hides the canvas until
  `handle.firstWoven`, then is removed in one step.

## Depth settings (16:9 tile; h = tile height)
- `fit: 'none'`: the globe is modelled directly in display metres, so the depth is set exactly
  rather than by an automatic fit.
- `depthOffset = LIMB·VDH` with **LIMB = −0.22 h**. The globe's centre sits behind the glass.
  Only the front hemisphere of a sphere is ever visible, and its farthest visible point is the
  limb, at the centre's depth. So the limb is the "behind" extreme: about **+1.30 %** of the width,
  under the comfortable 1.5 %.
- **FRONT = +0.09 h** is the nearest point: a marker tip when that city faces the viewer. It is
  about **−0.53 %** of the width, under the comfortable 0.6 %. The radius is derived from these:
  R = (FRONT − LIMB) / 1.07 ≈ 0.29 h, so the globe is about 0.58 h across. A centred `depthFit`
  would allow only about 0.37 h, because it budgets the hidden back hemisphere too.
  The percentages come from the SDK's `disparityPct()` formula at 0.6 m viewing distance.
- A sphere has the same depth range at every rotation, so spinning costs no depth and needs no
  sweep fit.
- The part that comes out of the glass is always in the middle of the tile. The tile's edges are
  empty background, so nothing in front of the glass touches an edge. No HTML sits over the tile:
  the info panel, city buttons and controls are in a column beside it.
- Clear colour `#070d1a`, opaque, the same as the page background. There is no feather and no
  stars, because bright points far behind the glass ghost. An additive atmosphere halo softens the
  limb's silhouette. The textures have fine grain so the two eye images can fuse.
- `depthNear 0.01`, `depthFar 20` are passed via `updateRenderState`.

## Unsure about
- **Picking on a display rig.** I project the markers through `viewer.monoCamera`, which frames
  exactly the z = 0 glass plane, and pick the nearest front-facing marker within 26 px. Markers
  sit only 0.03–0.09 h off the glass, so the error from the viewer's real eye position should be
  a few px. I couldn't verify this on hardware.
- Putting the centre behind the glass at −0.22 h goes against `fitTo`'s documented preference for
  "centred on the glass". I chose it deliberately to make the globe bigger, using the argument
  that the back hemisphere is hidden. It needs checking on a panel for limb ghosting; if the limb
  doubles, raise LIMB toward −0.15.
- I relied on the private-looking but documented `useDepthCursor` hook. Population figures are
  approximate (city proper, years noted in the panel).
- Not run in a browser here. I only syntax-checked it, so even the 2D fallback hasn't been seen.
