# Earth globe — notes

Files: `index.html` (page, styles, import map), `app.js` (globe, markers, picking, spin). No texture
downloads; the only CDN import is three.js 0.180.0.

## SDK API and view rig

- `createInline3D({ lazy: false })`, then `wall.addScene(canvas, viewer.onFrame, { virtualDisplayHeight, onLayerLost })`.
- Framing and drag-to-spin come from the preview-tier `SceneViewer` (`/sdk/js/inline3d-viewer.js`), with
  `EyeCamera` and `DepthCursor` / `raycastHitTest` from `/sdk/js/inline3d-three.js`. The viewer is the
  SDK's documented path for "one object, drag to spin"; the globe is the subject, so this is a **display
  rig** (`virtualDisplayHeight`), not a camera rig. No `viewRig` is passed.
- Non-3D browsers: `createInline3D` resolves `{ supported: false }`, so the page calls `viewer.startMono()`:
  same globe, same drag, same clicks, one flat camera.
- Cover: the canvas sits under an opaque cover until `handle.firstWoven` resolves, with a hard cut. A 6 s
  timer also removes it, and so does any setup error.

## Depth and comfort settings, and why

| Setting | Value | Why |
|---|---|---|
| `virtualDisplayHeight` | 0.24 m (SDK default, set on both the viewer and `addScene`) | Only sets the world scale of the eye poses. The fit normalises apparent size, so this is not a depth dial. Both sides must match. |
| `margin` | 0.8 (SDK default) | Kept at the default on purpose. Shrinking the subject to reduce depth is the thing the comfort rules say not to do. |
| `fit` | `contain` (SDK default) with `fitSweep: false` | `fitSweep` is the SDK's diagonal "turn-safe" fit. A sphere's silhouette is the same at every yaw, so the diagonal would shrink it about 30% for nothing. |
| `SUBJECT_EXTENT` | 2.3 model units (globe diameter 2 plus marker heads and stalks) | Frames the markers inside the tile. The globe's radius is about 0.35 display heights, so it sits roughly ±0.08 m either side of the glass. |
| `fitTo` centre | origin, `depthOffset` 0 (not set) | The subject stays centred on the zero-disparity plane, per the SDK rule. No depth slide. |
| `idleSpin` | 0 | A turning globe moves markers out from under the pointer, which makes clicks miss. |
| `pitchLimit` | SDK default ±60° | Covers every city latitude (max |lat| 52°). |
| Background | `#2a2d33` (dark grey, opaque) | Crosstalk cannot go darker than black. An opaque background also means no transparent edge against the page. |
| Material | `MeshLambertMaterial`, mid-tone vertex colours, no specular | A specular highlight is a bright spot on a dark field, which the panel's crosstalk correction doubles. Mid-tones keep the sphere comfortable at the front and back. |
| Marker size | head radius 0.05, stalk 0.13 model units (heads stand about 0.23 units, roughly 2 cm, in front of the globe's front) | Small pop-out, so the pins add a depth cue without a large disparity. |
| Canvas CSS | bare, no border, radius, shadow, opacity or filter; the info panel sits beside it, not over it | The woven-canvas rules (7–10) forbid these, and a side panel avoids the overlay and backdrop-filter issues entirely. |
| Depth cursor | `viewer.useDepthCursor(DepthCursor, …)` with SDK defaults | The OS arrow is drawn on the glass. Over a marker or the front of the globe, which pops out, it would look like a broken image. |

## Picking

A click (pointer travel under 6 px) projects each visible marker head through `viewer.monoCamera` (the
nominal viewer at the glass) onto the canvas. The closest head within 28 px is selected. Markers on the far
side of the globe are skipped with a normal test. The list buttons select and spin the globe to face the
city (`yaw = -lon`, `pitch = lat`, from the SDK's `R = Rx·Ry` order, checked by hand-computed rotation).

## Unsure / not verified

- **I could not run a browser or see the display.** Checks done: `node --check` on `app.js` (ES-module
  syntax), and a pure-JS check of the spin rotation (each city lands at exactly (0, 0, 1) facing the viewer)
  and the land fraction (about 28%). The three.js calls themselves are unexecuted.
- **Click accuracy on the real panel.** Picking uses the nominal mono camera, not the tracked eyes, and the
  28 px radius was chosen without a test. Head tracking shifts the stereo centre, so clicks may be off on a
  real panel. The fix, if it is off, is either a larger radius or picking through the tracked eye centre.
- **Depth size.** The globe's ±0.08 m is the SDK's own default placement for a subject this shape. I did
  not reduce it, in line with the rule not to shrink a subject to look comfortable. If it reads too strong
  on hardware, the knob is `margin`, which also shrinks the globe.
- **Populations** came from memory, not a live source (no internet here). They are approximate and the
  definitions differ: London is Greater London, Tokyo is the metropolis (not the 23 wards), New York is the
  city (not the metro), Sydney is Greater Sydney, and Nairobi is the 2019 census county. Each one states its
  basis on the page.
- **Land masses** are hand-placed ellipses with a noisy boundary, not geographic data. The coasts are
  crude, and the mesh is 128×96 segments.
- **Pointer events on a woven canvas** are assumed to arrive at `canvas` with client coordinates, as the
  SDK samples assume. Not verified in the DisplayXR Browser.
- **Cover timing.** I use `Promise.race(firstWoven, 6 s)`. Per the SDK, `firstWoven` itself can take up to
  about 4.8 s on a browser without the join signal, so the 6 s cap leaves little margin.
