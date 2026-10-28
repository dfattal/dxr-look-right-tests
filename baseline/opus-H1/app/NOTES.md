# Five Cities — notes

Files: `index.html` (layout, CSS, import map), `app.js` (scene, markers, picking, panel, SDK wiring),
`earth-texture.js` (procedural Earth colour/specular/cloud maps drawn into 2D canvases; no downloads).
three.js 0.180.0 from jsDelivr; the SDK from `/sdk/js/`.

## SDK API and rig
- `createInline3D({ lazy: false })` → `wall.addScene(canvas, onFrame, { virtualDisplayHeight, onLayerLost, rectCover })`.
- `SceneViewer` (`@displayxr/inline3d/viewer`) with `useEyeCamera(EyeCamera)`. It runs the side-by-side loop,
  frames the subject on the zero-disparity plane, handles drag orbit and the idle turntable, replays the last good
  frame, and falls back to mono (`startMono()` when `wall.supported` is false).
- **Display rig** (the default, set through `virtualDisplayHeight`). The visitor turns the subject (the globe); they
  don't move through a world. The docs say that calls for a display rig even with orbiting, because a display rig's
  depth doesn't depend on the subject's size. No camera rig and no `setViewRig`.
- `DepthCursor` + `raycastHitTest` (from `./three`), attached with `viewer.useDepthCursor(...)`. The front of the
  globe comes out of the glass, so the cursor rises over it instead of being drawn behind it.
- `handle.firstWoven` releases an opaque cover (hard cut). `rectCover` covers later resizes until `rewoven()`.

## Depth-related settings
| Setting | Value | Why |
|---|---|---|
| `virtualDisplayHeight` | 0.24 (SDK default) | Only sets the world units. The display rig is scale-invariant, so depth is a fraction of the tile's physical height either way. The same value goes to `SceneViewer` and `addScene`. |
| `fit` / `margin` / `fitSweep` | `contain` / 0.78 / false | Globe + halo fill 78% of the square tile, so nothing touches a tile edge (no window violations or cut-off parallax at the borders). The sweep correction isn't needed for a sphere. |
| `depthOffset` | −0.5 × globe radius (× zoom) | Centred on the glass (the SDK default), only the *front* hemisphere is visible, so the whole visible globe would be in front of the screen, about 0.35 of the tile height deep. Moving it back half a radius splits that range evenly: the front of the globe ~R/2 in front of the glass, the limb ~R/2 behind. That's about ±2–3 cm on a laptop-sized tile, which is comfortable and halves the worst pop-out disparity (less crosstalk ghosting). |
| zoom | clamped to 0.8–1.15 (own wheel handler, captured before the viewer's 0.2–6× one) | Depth scales with zoom. At 6× the globe would leave the tile and come far out of the glass. `depthOffset` scales with zoom to keep the same split. |
| pitch limit | ±40° | Enough to reach London and Sydney; stops the globe rolling over. |
| ipd / parallax / perspective factors | left at 1 | The scene's depth is already controlled by size and placement. No reason to flatten it. |
| marker height | pins stick 0.075 R out | Small extra pop-out, so markers read as standing on the surface without adding disparity. |
| clear colour | opaque `#04060c` = page background | A transparent woven canvas shows black on the panel (documented browser bug). An opaque page-coloured clear is identical in 2D and 3D and makes the tile edge invisible. The background has zero disparity, so it can't double. |
| Fresnel rim/halo, specular | computed from each eye's real camera position | Each eye gets its own correct highlight. Kept faint so the two eyes never see very different brightness. |

Crisp UI: all text (city list, info panel, status) is HTML in a separate column, never over the canvas.
Flat text over content that pops out would conflict with its depth. Nothing on or above the canvas has a
`filter`, `opacity`, `backdrop-filter`, border or radius.

Picking: in 3D the ray runs from the midpoint of the two reported eyes through the pointer's point on the
z = 0 plane (the virtual display, `virtualDisplayHeight` tall, centred). In 2D it uses `raycaster.setFromCamera`
with the mono camera. Click targets are invisible, enlarged spheres on layer 1. The globe is in the ray list, so
markers on the far side can't be clicked.

## Unsure about
- `viewer.useDepthCursor` is a real method in `inline3d-viewer.js` (used by `./model` and `./splat`), but it isn't
  in `viewer.d.ts`. The code feature-detects it.
- The 3D pick ray assumes the display rig's z = 0 plane spans exactly `virtualDisplayHeight` × aspect, centred on the
  origin (as the docs describe). It wasn't checked on hardware, and the viewer's tracking ease may make the
  picked eye position differ from the one drawn by a frame.
- The comfort numbers are estimates. The physical depth depends on the panel and the tile's physical size.
  `DEPTH_BIAS` (app.js) is the single knob to tune on the panel.
- The texture build is synchronous (~1.7 s in Node; likely similar in a browser). It runs behind the load cover.
- Populations are rounded census or official figures, recalled without a source to check against.
- Not run in a browser or on a 3D display. The modules were syntax-checked, and the texture generator was run
  headlessly and inspected (the harness is in `../scratch/`, not needed by the page).
