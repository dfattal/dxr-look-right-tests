# Skyhopper — notes

Files: `index.html` (layout, HUD, import map) and `app.js` (game + stereo). three.js is pinned to
`three@0.161.0` on jsDelivr. The SDK is loaded from `/sdk/js/inline3d.js` and `/sdk/js/inline3d-three.js`
with a dynamic `import()` inside a try/catch, so a failed SDK load leaves the 2D game running.

## SDK API and view rig
- `createInline3D({ lazy: false, autoChrome: false })` → `wall.addScene(canvas, onFrame, opts)`.
  There is one session for the whole document and one persistent canvas.
- **Camera rig** (`cameraRigFromCamera`), because the player flies through a world. I used the
  **attach pattern**: the rig has an identity pose and two `EyeCamera`s are parented under the chase
  camera, drawn with `setLocalFromMatrices`. This way the stereo doesn't lag the camera by a frame.
  The rig is pushed every frame, before the validity gate.
- The render loop follows the porting guide. It checks that there are 2 views and both viewports
  exist before calling `clear()`. If a frame can't draw, it replays the last good frame from copied
  matrices instead of skipping it. It uses `ViewerEase` so the view glides instead of snapping when
  tracking picks up or loses a viewer. `onResize` reallocates the buffer only when the size really
  changed, then repaints. `onLayerLost` switches back to the flat loop.
- When woven, the side-by-side buffer is the element's device-pixel size, so each eye gets half the
  width. That follows the porting guide's pitfall 26 for full-window tiles (keep the buffer no wider
  than the panel). `setPixelRatio(1)` is always on.
- `session.updateRenderState({depthNear: 0.5, depthFar: 7000})` uses the app camera's clip planes.

## Depth settings and why
- **Convergence = 13.3 units, fixed.** This is how far the plane sits along the chase camera's view
  axis. It is calculated once from the chase offsets (13 back, 3.6 up, looking 10 ahead), so the
  plane sits on the glass and the world recedes behind it. It is never re-measured per frame
  (rule 2). The camera's spring lag moves the plane only slightly off the glass.
- **metersToVirtual = comfort × d / 0.5, with comfort = 0.3.** This is the same formula the SDK's own
  game mode uses (`controls:'page'`, the auto-3D shim). It makes the runtime's comfort value
  `ipd·m2v·(1/d)·0.5` equal 0.3 no matter how big the world is, so the sky and mountains stay well
  short of making the eyes diverge. `ipdFactor` and `parallaxFactor` are left at 1. The player can
  change comfort from 0.10 to 0.50 with `−` / `=` (3D only). This scales depth without moving
  convergence.
- **Limits on how far things pop out of the screen:**
  - The camera always stays at least 4 units above the ground, and the plane at least 5. The
    nearest ground at the bottom of the frame is therefore about as deep as the plane.
  - Rings fade out as they come nearer than the plane (from 0.95·d down to 0.45·d), so a ring never
    flies through the viewer at a large crossed disparity.
  - Clouds sit above the flight ceiling, so the camera never passes through one.
- **Avoiding double images and crosstalk:**
  - Nothing is pure black. The page and the cover are #1d2129, and the sky is a pale gradient.
  - Distant content is low contrast: linear fog matched exactly to the sky's horizon colour, and
    mountains with haze baked into their vertex colours.
  - The sun is a soft glow with no hard disk, and the terrain has no high-frequency detail.
- **HUD is DOM** (on the glass, crisp). Each panel is a partial rect with a translucent tint and no
  `backdrop-filter`, registered with `addGlobalOverlay`. There are no full-bleed overlays.
- **Cover** over the canvas until `handle.firstWoven` resolves. It is cut instantly, never faded. It
  also comes off on any setup failure and after a 6 s safety timer. `rectCover` handles resizes.

## Unsure / untested
- None of this has run in a browser or on a display: I couldn't run either. I only syntax-checked
  `app.js`.
- I haven't confirmed that `depthNear`/`depthFar` should be in world units when
  `metersToVirtual ≠ 1`. The SDK's auto-3D shim does it this way.
- The half-width-per-eye buffer follows pitfall 26, but the samples use a 2× buffer. If the 3D
  looks soft, try doubling the woven buffer width in `sizeCanvas()`.
- On browsers without `setViewRig`, the window uses a `virtualDisplayHeight: 0.24` display rig.
  The eyes are still parented to the chase camera, so the framing is roughly right, but depth is
  very shallow.
- Comfort 0.3 is the SDK default. On a real panel the mountains might look better slightly lower.
- Controls: Up climbs and Down dives (not inverted flight-sim style). `P` pauses.
