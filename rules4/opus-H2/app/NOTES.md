# Desk Aquarium: notes

Files: `index.html` (page, import map, cover) and `aquarium.js` (scene and SDK wiring).
three.js comes from jsDelivr, pinned to `three@0.180.0`. The SDK is imported from `/sdk/js/...`.

## SDK API and view rig
- `createInline3D({ lazy: false })`, then `wall.addScene(canvas, viewer.onFrame, { virtualDisplayHeight, onLayerLost })`.
- `SceneViewer` (`/sdk/js/inline3d-viewer.js`, experimental) with `useEyeCamera(EyeCamera, EdgeFeather)`.
  It provides the side-by-side render loop, the validate-before-clear and replay-last-frame logic,
  the resize handling, drag-to-orbit and the 2D fallback (`startMono()` when `wall.supported` is false).
- **Display rig (the default).** The tank is a subject you turn, not a world you move through, so
  the user rotates the tank under a fixed portal. I don't use a camera rig and don't set
  convergence. All animation runs in `viewer.onTick`, once per frame before both eyes draw, so the
  two eyes always see the same fish positions.

## Depth-related settings
| Setting | Value | Why |
|---|---|---|
| `virtualDisplayHeight` | 0.24 (same value to the viewer and to `addScene`) | The SDK default. The viewer frames against it, so the two must match. |
| `fit` / `margin` / `fitSweep` | `'contain'` / 0.8 / true | The viewer's own placement: the tank is centred on z = 0 at real proportions. `fitSweep` keeps it inside the tile when it is turned side-on. I didn't push it back, shrink it or flatten it (rule 1). |
| `depthOffset` | 0 (not touched) | The tank straddles the glass: the front pane is slightly in front of the screen and the back panel slightly behind it, which is the smallest disparity spread. |
| Tank proportions | 0.50 W × 0.30 H × 0.26 D | Shallow like a real desk tank. After fitting, the depth is about 0.6 of the virtual display height. |
| `pitchLimit` | [-8°, 30°], resting at 8° | A slight look down, as at a desk ornament. The limits stop the user rolling under the tank or looking straight down into it. |
| `idleSpin` | 0 | The fish are the motion. The head-tracked look-around supplies the parallax. |
| `feather` | 24 px | Per-eye edge fade, so a zoomed-in tank never ends at a hard rectangle. CSS masks or radius would break the weave. |
| Backgrounds | page `#1f2227`; tank backdrop is teal down to `#183842` | No pure black behind bright fish (rule 3). The canvas is transparent and sits on a flat, uniform page colour. A gradient behind the canvas would be woven into the side-by-side pair. |
| Pupils and trims | dark grey, never `#000` | Same crosstalk reason. |
| Caustics | strength 0.3–0.45, slow | High-contrast moving detail on the floor, which sits slightly behind the glass, is kept modest. |
| `renderer.setPixelRatio` | left at 1 by `SceneViewer` | Viewports are in backing-store pixels. |

The cover over the canvas is an opaque block in the page colour, cut (no fade). It comes off on
`handle.firstWoven`, on layer loss, on any setup error, after the first frames in 2D, and in any
case after 6 s (rule 4). The UI (buttons and text) is plain 2D outside the canvas, with no
`backdrop-filter`.

## Unsure about / untested
- Nothing has been run in a browser or on the display. I only syntax-checked the JS.
- The fit is still large: the front glass rim is a few cm in front of the screen in virtual units.
  I kept it because the docs say not to shrink the subject. Check it on hardware.
- `SceneViewer` lets wheel or pinch zoom up to 6×, which also scales the depth. I left it on.
- Lights are in world space. With orbit, the "room lamp" stays put while the tank turns; I chose that on purpose.
- The caustic and plant-sway shader patches rely on three r180 chunk names (`project_vertex`,
  `begin_vertex`, `emissivemap_fragment`, with `normal` defined before emissive). They come from
  memory, and I couldn't check them offline.
- Shadow maps and the physical materials render twice per frame (once per eye). The scene is
  small, but the cost on the target GPU hasn't been measured.
