# Desk Aquarium: notes

Files: `index.html` (page and import map), `aquarium.js` (scene and render loop). three.js r0.161.0
comes from jsDelivr. The SDK is imported from `/sdk/js/inline3d.js` and `/sdk/js/inline3d-three.js`.
Everything is procedural, so there are no other assets.

## SDK API and rig
- `createInline3D({ lazy: false })`, then check `wall.supported`. I don't use
  `isSessionSupported`. If it isn't supported, the page runs a normal three.js loop with a
  mono camera.
- `wall.addScene(canvas, onFrame, { virtualDisplayHeight, rectCover: 'auto', onLayerLost })` with
  my own render loop. `EyeCamera.setFromView` draws each eye into `layer.getViewport(view)`.
- **Display rig** (the default one; there is no `viewRig` and no camera rig). The tank is a
  subject on a desk, not a world you move through, so the canvas acts as a window onto it.
  Dragging rotates the tank group under that fixed window. The camera never moves. When you let
  go, the tank eases back to its resting pose after 4 s.
- The loop follows the docs. It checks `views.length >= 2` and that every viewport is non-null
  before calling `clear()`. If a frame fails that check, it replays copies of the last good eye
  matrices. `pixelRatio` is 1. The backing store is 2× the CSS width × DPR while woven and 1:1 in
  mono. It is clamped to the GPU's max texture, renderbuffer and viewport size. It is only
  resized when the size actually changes, and the frame is redrawn right after a resize.
- An opaque cover (the same colour as the page) sits over the canvas until `handle.firstWoven`
  resolves, then disappears with a hard cut. This keeps the raw side-by-side pair from showing.
  `onLayerLost` switches to the 2D loop.
- The shadow map is drawn once per frame and both eyes reuse it.

## Depth settings and why
| Setting | Value | Why |
|---|---|---|
| `virtualDisplayHeight` | 0.235 m | The ornament (plinth + tank + lamp bar) is about 0.20 m tall, so it fills the tile with about 8 % margin. The SDK says scale comes from the rig, not from scaling the scene, so the scene is built in metres at this size. |
| Tank placement | centred on z = 0 (glass box 0.27 × 0.17 × 0.11 m, so ±0.055 m) | The zero-disparity plane runs through the middle of the water, where the fish swim. That's where detail is sharpest, and it gives about equal depth in front of and behind the screen. The SDK's viewer uses the same "subject centred on the ZDP" convention and notes that a behind-the-glass bias looked worse on hardware. |
| Resting pitch | 0.16 rad (~9°) toward the viewer | Shows the sand and water surface from slightly above, like a real desk ornament. The rotation is applied to the subject, which is the way the SDK recommends. Resting depth range is about +0.07 / −0.07 m, roughly ±30 % of the display height. |
| Drag limits | yaw ±0.35 rad, pitch 0.04–0.32 rad | Stops the front corners from swinging far out of the glass. The worst case is about +0.10 m, and the tank eases back afterwards. |
| `ipdFactor` / `parallaxFactor` / `perspectiveFactor` | left at the defaults (1) | The geometry already keeps the depth budget modest, so these comfort controls aren't needed. |
| Desk plane | radial alpha fade well inside the tile | The only geometry that reaches toward the tile edge in front of the glass fades out first. Nothing gets cut by the window frame (no stereo window violation). |
| Fish volume | ≥ 16–18 mm inside the glass, above the sand, below the surface | Fish never get close to the panes, and never come further out than about +0.04 m. |
| Contrast choices | dim glass edges and meniscus line, low-contrast back sheet, near-black page | Bright thin lines far from z = 0 are the most likely to ghost on a lenticular panel. The docs also note that a transparent woven pixel shows as black, so the page is near-black to match it, and the tile has no visible edge in 3D or 2D. |
| depth range | `depthNear 0.01`, `depthFar 10` via `session.updateRenderState` | Covers the scene at virtual scale. It is wrapped in try/catch. |
| DPR cap | 2 | Keeps the per-eye render cost reasonable. Anything above that is lost to the lens anyway. |

All UI (title, status, hint) is plain HTML outside the canvas, so none of it is woven or occluded.
Nothing on the canvas or its ancestors uses border, radius, filter, opacity or a transform.

## Unsure about
- I could not run a browser or look at a panel. Nothing here was checked visually, including the
  depth amount, the ghosting, the colours, shader compilation, and whether `firstWoven` behaves on
  real hardware. I only syntax-checked the JS.
- I don't know the physical tile size, so I don't know the real magnification (m2v). If the depth
  looks too strong, the first things to change are a larger `VDH` or a lower `REST_PITCH`.
- The shader patches use `onBeforeCompile` and depend on r0.161's chunk names (`begin_vertex`,
  `emissivemap_fragment`). The fish tail-wiggle is also applied to the shadow-depth material.
- `rectCover: 'auto'` for `addScene` is documented as opt-in. I assume it works with a page-owned
  render loop.
- Glass reflections come from a RoomEnvironment env map, so they differ slightly between the two
  eyes, as real reflections do. They are kept faint, but they could show slight rivalry.
