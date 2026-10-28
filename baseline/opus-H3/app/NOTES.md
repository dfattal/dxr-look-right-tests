# Sky Rings — notes

Files: `index.html` (layout, HUD, import map), `game.js` (everything else). three.js is pinned to
`three@0.161.0` on jsDelivr, the same version the SDK samples use. The SDK comes from `/sdk/js/` and is
loaded with a **dynamic import inside try/catch**, so if the SDK is missing the page still runs in 2D.
`?2d` forces the 2D path. `?depth=0.6` sets the starting depth.

## SDK API and view rig
- `createInline3D({ lazy: false, autoChrome: false })` → `wall.supported` decides 3D or 2D. I never
  call `isSessionSupported`.
- `wall.addScene(canvas, onFrame, { viewRig, rectCover: 'auto', onResize, onLayerLost })`. The page
  runs its own two-eye three.js loop with `EyeCamera` from `inline3d-three.js`.
- **Camera rig**, via `cameraRigFromCamera(THREE, appCam, { attach: true, convergence, ipdFactor })`
  and `handle.setViewRig()` every frame. A flight game moves a viewpoint through a world, so the docs
  call for a camera rig; a display rig is for showing a subject. The rig uses the **attach
  pattern**: an identity pose, eye cameras parented under the chase camera (which is in the scene),
  and `setLocalFromView`. This way the stereo never trails the moving camera by a frame.
- Browsers without `setViewRig` (checked with `inline3dViewRigSupported()`) fall back to a display
  rig. Its `virtualDisplayHeight` is the camera's view height at the convergence distance, and the
  eyes hang from an anchor that distance in front of the camera.
- The loop follows the porting guide:
  - It checks the view count and viewports **before** `clear()`. On a bad frame it **replays the
    last good frame** from copied matrices instead of skipping.
  - The rig is pushed before that check.
  - `renderer.setPixelRatio(1)`. The backing store is sized by hand and clamped to GL limits.
  - `updateRenderState({ depthNear, depthFar })` matches the camera's clip planes, and the eye
    cameras get those near/far values. `updateProjectionMatrix()` is never called on an eye.
  - The 2D `requestAnimationFrame` loop stops only after `addScene` succeeds. `onLayerLost` restarts it.
- Woven-canvas rules:
  - The canvas has no CSS effects and gets `will-change: transform` from its first paint.
  - Its backing store is sized, then the page waits two frames before `addScene`.
  - An opaque cover hides the canvas until `handle.firstWoven`, then disappears with a hard cut
    (`display:none`).
  - `rectCover: 'auto'` handles window resizes.
- HUD (score, status, help, messages) is plain DOM made of small partial-rect plates, registered with
  `wall.addGlobalOverlay`. They have solid tinted backgrounds, no `backdrop-filter`, and hide with
  `display:none`. DOM sits on the glass at native resolution, so the text stays crisp.

## Depth settings and why
| Setting | Value | Why |
|---|---|---|
| World scale | plane ≈ 1 unit wingspan, chase cam 2.35 back / 0.62 up (≈2.43 from the plane) | On a camera rig the eye baseline is absolute: 63 mm × ipdFactor, in world units. The scene is authored so the chase distance is a couple of "metres", which is the scale where a 63 mm baseline gives real depth. A full-size plane seen from 30 m would look flat. |
| `convergence` | 1.12 × live camera→plane distance (≈2.7) | The docs say a third-person camera should converge on the subject. The plane sits on the glass, slightly in front of it, so it is sharp, and the terrain falls away behind. Because it uses the live (spring-smoothed) distance, convergence eases with the camera instead of jumping. |
| `ipdFactor` | 0.8 by default; `[` / `]` adjust it live, 0.3–1.2 | With it, comfort = 0.8 × 1 × (1/2.7) × 0.5 ≈ 0.15, far under the divergence limit of 1. I lowered it from 1 on purpose: most of this scene (hills, mountains) is effectively at infinity, and a smaller far-field disparity should mean less crosstalk ghosting on a lenticular panel. |
| `metersToVirtual` | 1 (unset) | The world is already authored at that scale. |
| `parallaxFactor` | 1 (unset) | Normal look-around. |
| FOV | 45° vertical | A moderate FOV keeps the depth budget (∝ 1/tan(fov/2)) reasonable. |
| near / far | 0.25 / 1200 | Nothing is meant to come closer than about 1.4 units. The sky dome (r = 1000) fits inside far. |
| Ring fade | opacity → 0 between 4.2 and 1.4 units from the camera | A ring you fly through sweeps past the camera. Without the fade it would leap far out of the glass and get cut by the window edge, which is uncomfortable and ghosts. |
| Fog 55→185, hazy unlit mountains at 470 / 640, soft cloud sprites | — | Lower contrast on distant, high-disparity content should hide crosstalk. Fog also hides the edge of the chunked terrain. The sky is a plain gradient, so its disparity doesn't show. |
| Textured terrain (vertex-colour mottling, fields), instanced trees, blob shadow | — | Gives the eyes surface detail to fuse and makes height above ground readable. Flat colours tend to look flat in stereo. |
| SBS buffer = canvas box × dpr (≤2), half per eye | — | For a full-window tile, the porting guide says to keep the buffer no wider than the panel. `preserveDrawingBuffer: true` is on for the same reason. |

## Unsure about
- **Nothing has been tested.** I couldn't run a browser at all, so neither the 2D page nor the 3D
  display has been seen. The only check was a JS syntax check of `game.js`.
- The ~9 mm far-field disparity is my own estimate (comfort × IPD) of how far the 0.8 baseline puts
  the background. I don't know how much this panel can take before ghosting. If the mountains double,
  press `[`. If it looks shallow, press `]`.
- On browsers without rig support, the display-rig fallback framing is only approximate. The
  eye-to-screen distance depends on the panel's physical height, which the page can't know.
  `ipdFactor` also doesn't apply there.
- HUD plates are registered as global overlays. I didn't verify that the `display`-toggled message
  plate gets re-matched correctly on legacy (non-draw-order) browsers.
- I assumed the display uses MANAGED tracking, so the page does nothing special when no one is
  tracked.
