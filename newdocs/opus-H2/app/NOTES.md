# Desk Aquarium — notes

Files: `index.html` (layout, import map, controls), `app.js` (scene and SDK wiring). The scene is
fully procedural, with no asset files. It uses three.js 0.180.0 from jsDelivr (the same version
as the SDK starters) and the SDK from `/sdk/js/`.

## SDK API and rig
- `createInline3D({ lazy: false })`, then `wall.addScene(canvas, viewer.onFrame, { viewRig, onLayerLost })`.
- **Display rig** (`displayRig({ virtualDisplayHeight, ipdFactor, parallaxFactor })`). The user
  looks at an object and does not move through it (guide §1).
- `SceneViewer` (`/sdk/js/inline3d-viewer.js`) with `useEyeCamera(EyeCamera)`. It draws each eye
  from that eye's own view and viewport, keeps the last good frame when the view list is short,
  and sizes the canvas at pixel ratio 1. Without 3D, `viewer.startMono()` gives the normal 2D
  view. The structure is copied from `samples/starter-scene` and `samples/starter-ui`.

## Depth settings and why
| Setting | Value | Why |
|---|---|---|
| `virtualDisplayHeight` | 0.24 (same on `SceneViewer` and `displayRig`) | SDK default. The viewer frames against it. |
| `depthFit.front` | 0.10 tile heights (≈ 0.6 % of the width on 16:9) | Comfortable in-front budget. The nearest point is the front-bottom edge of the plinth and front glass. |
| `depthFit.back` | 0.30 h (≈ 1.7 % of the width) | Slightly over the comfortable 1.5 %, well under the 2.3 % "strong" limit. The farthest content is the soft, low-contrast blue backdrop and the top-back glass edge. The guide says soft mid-tone content tolerates more disparity than sharp edges. |
| `depthOffset` | −(BACK−FRONT)/2 × VDH = −0.1 h | Moves the tank back so both ends reach their budget together, which makes the tank bigger for the same comfort (guide §3). |
| Screen plane | Through the tank (SceneViewer centring + the offset above) | Rule 2: a clear subject. The front glass sits slightly in front of the screen surface and the backdrop behind it. |
| `fitSweep: false`, `orbit: false` | — | Nothing spins the tank. An orbit would swing its width into depth past the fitted budget. Head tracking still lets you look around it. |
| Pose | 7° pitch, 0° yaw | Each degree of tilt adds depth and `depthFit` shrinks the tank to pay for it. The tank comes out ≈ 0.6 h tall and ≈ 52 % of the tile width. The fit uses the tilted ornament's exact box (plinth to lamp). Fish, plants and bubbles always stay inside that box, so they are within budget too. |
| `margin` | 0.86 | Keeps a clear band of plain background around the tank, so nothing in front of the screen touches a frame edge (no window violations). |
| `clearColor` | `#10151c`, same as the page background | Opaque clear (rule 5), so the tile has no visible edge. No `feather`, because it needs an alpha clear. |
| `depthNear/depthFar` | 0.01 / 20 | Same as the starters. |
| Depth slider | k ∈ [0,1] → `ipdFactor = parallaxFactor = k` through `handle.setViewRig` | Rule 8. 1 means the display's natural depth, and lower values only make the scene shallower. |
| 2D/3D button | `handle.setStereoEnabled()`. Its label follows `renderingmodechange`. If the call is rejected, it falls back to slider = 0 | Rule 9. |

## Comfort and crispness details
- All UI is plain HTML **below** the canvas. Nothing is drawn over the canvas, and there is no
  filter, opacity or transform on or around it. A cover hides the canvas until `handle.firstWoven`
  and is then removed in one step.
- The glass edges are a soft, half-transparent green rather than bright white lines, and the glass
  and env reflections are kept weak. Sharp, high-contrast edges away from the screen surface ghost
  first.
- The sand, rocks and backdrop have fine texture so the two eyes have detail to match. The
  caustics and plant sway are computed from tank-space position plus a shared clock, so both eyes
  see the same thing.
- The **Feed the fish** button drops flakes that sink. Fish chase them and eat them. This works in
  2D and 3D.

## Unsure about
- I couldn't run a browser or see a panel. Everything was checked only by reading the code, plus a
  syntax check. The `BACK = 0.30` choice in particular needs checking on hardware. If the backdrop
  or the top-back glass edge looks doubled, set it to 0.27.
- How well the panel shows transparent sorting (glass, water tint, bubbles) and the specular
  glints that differ between the eyes is untested. If they ghost, lower `envMapIntensity` on the
  glass and surface.
- I set `NeutralToneMapping` and `scene.environment` on `viewer.renderer` and `viewer.scene`
  myself. The SDK doesn't touch either one (checked by grep), but the starters don't do this.
