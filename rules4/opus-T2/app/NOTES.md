# Orrery: notes

## SDK API and rig
- `createInline3D({ lazy: false })` → `wall.addScene(canvas, viewer.onFrame, …)`, with
  `SceneViewer` from `@displayxr/inline3d/viewer` (marked experimental in the SDK) plus
  `EyeCamera` from `/three`. SceneViewer handles the stereo loop: it checks a frame is drawable
  before clearing, replays the last good frame on a short view list, avoids clearing on resize,
  clamps the buffer to device limits, eases tracking changes, and provides the 2D fallback
  (`startMono`, also wired to `onLayerLost`).
- **Display rig (the default).** The orrery is a diorama the user turns, not a world they move
  through. Dragging rotates the system under a fixed portal; no camera rig is used.
- three.js 0.180.0 from jsDelivr (the version the SDK samples use).

## Depth-related settings
| Setting | Value | Why |
|---|---|---|
| `virtualDisplayHeight` | 0.24 (SDK default) | A display rig is scale-invariant, so this only sets the units. |
| `fit` / `margin` | `'contain'` / 0.8 (SDK defaults) | The system is centred on the glass (z = 0) at real proportions, per rule 1. |
| `fitTo` extent | width = depth = 2 × outer radius; height = the tilted disc's projected height at 38° | The fit sizes the system to what is actually seen. On a 16:9 tile it binds on height, so the system spans about ±0.11 m (about ±46% of the virtual display height) in front of and behind the glass. |
| `fitSweep` | false | The disc is rotationally symmetric, so its width is the same at every yaw. |
| Initial pitch | 38°, drag limited to 15–55° | A tabletop seen from above. A steeper look-down turns the disc's depth into height and keeps it nearer the glass. Edge-on views are blocked. |
| Wheel zoom | blocked (the wheel scrolls the page) | Zooming in would scale the depth past the planned budget and push planets through the starfield. |
| `idleSpin` | 0 | The planets already move. |
| Starfield | one shader plane in `viewer.scene` (not in the rotated content), recomputed every frame to sit 6 mm behind the system's far edge | It is always behind every planet but as close to the glass as possible. Stars are soft, capped at about 0.4–0.6 brightness, and the nebula is low-frequency, because high-contrast detail far behind the glass is what doubles first (rule 3). |
| Background | `#0e1017` for the clear colour, the backdrop base and the page | Dark grey-blue, not black (rule 3). The canvas is opaque because transparent woven pixels come out black. |
| Ambient fill | dim cool ambient light | The night sides of planets show as dark grey, not pure black. |
| "3D depth" slider | `displayRig({ ipdFactor })`, 0.3–1, default 1 | The relative comfort dial on the display rig. It only appears when `inline3dViewRigSupported()` is true. |

Woven-canvas rules followed:
- The canvas gets its final CSS box and `will-change: transform` from the first paint, the
  backing store is sized 2:1 before registering, and registration waits two animation frames.
- An opaque cover sits on top of the canvas and is removed with a hard cut on `firstWoven`. It is
  also removed after 7 s at the latest, on errors, and immediately in 2D.
- `rectCover` covers resizes.
- There is no CSS on the canvas or its ancestors, and all UI sits below the tile (no
  `backdrop-filter`), so text stays crisp.

## Unsure about
- **Overall depth.** This is the main open question. Real proportions put the front and back
  planets about 0.11 m (in virtual-display units) out of and into the glass. The SDK says its
  hardware tests favoured this framing, but I could not see the panel. If it doubles, the fix is
  to lower the "3D depth" slider or raise `PITCH0`. Shrinking or pushing the system back would go
  against the SDK's guidance.
- **Starfield placement.** I chose a plane just behind the system rather than "at infinity". It
  is still at roughly the same depth as the system's far edge, so very bright stars could ghost.
  I kept them dim for that reason.
- **Fixed sky.** The sky does not rotate with the drag. That seemed more natural for a sky than
  having it swing with the table.
- **Untested.** Nothing was run in a browser. Shader and texture code was syntax-checked only
  (`node --check`).
- **Debug mode.** `?debug` logs `firstWoven`, `handle.stats()` and the subject bounds.
