# Solar system: notes

Files: `index.html` (page, import map, CSS), `app.js` (scene and render loop).
three.js is pinned to `three@0.180.0` on jsDelivr, the version the repo's own samples use.

## SDK API and view rig

- `createInline3D({ lazy: false })`, then `wall.addScene(canvas, onFrame, { virtualDisplayHeight, onLayerLost })`.
  Loaded with dynamic `import()`, so a broken SDK import falls back to the flat view instead of blanking the page.
- `EyeCamera` (from `/sdk/js/inline3d-three.js`) takes each view's projection and pose. `EdgeFeather` fades each eye's edges.
- **Display rig** (the `addScene` default, no `viewRig`). The canvas is a portal onto a 0.24 m tall virtual display.
  The solar system is a diorama framed by that portal, not a viewpoint the user moves through, so a camera rig would add
  nothing and would lose scale invariance.
- Render loop follows the porting guide: validate views and viewports before `clear()`, replay the last good frame from
  copied matrices, repaint immediately on a real resize, and never call `updateProjectionMatrix` on an eye camera.

## Depth-related settings, and why

| Setting | Value | Why |
|---|---|---|
| `virtualDisplayHeight` | 0.24 m (passed explicitly; equals the SDK default) | Scene scale. Authored in metres. The mono camera uses the same 0.6 m distance and fov, so 2D and 3D frame the same. |
| Sun position | origin, z = 0 | The sun is the zero-disparity object, sitting on the glass. |
| Orbital plane tilt | 50° about X | Orbits span depth. Outer orbit (0.066 m) gives z ≈ ±0.042 m, about 17% of the display height. Kept below the depth range of `hello-cube` (a 6 cm crate on a 12 cm display, about 25%). Not measured on hardware. |
| Starfield z range | −0.10 to −0.38 m | Behind the glass, so the planets read as in front of it. Kept shallow so the far field stays inside a comfortable disparity. |
| Starfield spread | scaled per depth to fill the frustum | The field fills the window at any depth, without stars leaving the view. |
| Star size | 2 device px, no size attenuation | Stars stay crisp and do not shrink or grow with depth. |
| `ipdFactor`, `parallaxFactor`, `perspectiveFactor` | left at 1 (runtime defaults) | I could not see the panel, so I did not tune the display rig's comfort dials. |
| `updateRenderState` | depthNear 0.01, depthFar 10 | Matches the eye cameras' near and far, so clipping agrees with the mono path. |
| Eye camera `near`/`far` | 0.01 / 10 | Same values, as the guide asks. |

Other settings that affect the 3D look:

- `pixelRatio` is 1, and the backing store is sized in device pixels. Device pixel ratio is capped at 1.5, which keeps the
  SBS buffer (twice the canvas width) from growing past the panel width. That is the SDK's pitfall 26 advice; the 1.5 value is my choice.
- `EdgeFeather` is 26 buffer px. The canvas is transparent and the page background matches the scene's, so the window
  edges dissolve rather than showing as a rectangle.
- A plain opaque cover (page colour) is held over the canvas until `handle.firstWoven` resolves, then removed as a hard cut.
- No `backdrop-filter`, no glow outside a DOM element's box, and no DOM overlay on top of the canvas. The caption is below it.

## Uncertain

- **Depth amount.** I cannot see the panel. The 50° tilt and the 17% figure are estimates. If the planets look flat, raise
  `TILT` toward 60°. If they look strained, lower it or set `ipdFactor` below 1 on a `displayRig`. Neither was tested.
- **Starfield at the far end.** Its disparity is estimated from geometry, not measured. It should stay comfortable, but I
  have not checked it.
- **`EdgeFeather` width** (26 px) and the star brightness are guesses.
- **Cover rule.** The guide says a full-tile cover can be woven along with the canvas on legacy browsers. My cover is a
  flat, uniform page colour, so that should be invisible. I did not register it with the SDK. I could not check this on hardware.
- **`firstWoven` returning `woven: false`.** The page shows a flat-view status but leaves the canvas as it is. I did not
  add a flat fallback for a withheld layer. `onLayerLost` does switch to the flat view.
- **Not run in a browser.** I could not run a browser, a WebGL context or a display. The only check was a syntax parse of
  `app.js` (`node --input-type=module --check`).
