# Desk aquarium — notes

Files: `index.html` (page, import map, CSS), `app.js` (scene and SDK wiring). Served at `/app/`.

## SDK API and view rig

- Template: `sdk/samples/starter-scene` (object scene) and `starter-ui` (slider and 2D/3D switch).
- `SceneViewer` (`@displayxr/inline3d/viewer`) with `.useEyeCamera(EyeCamera)` from `@displayxr/inline3d/three`.
  It owns the canvas size, the eye cameras and the last-good-frame replay.
- `createInline3D({ lazy: false })`, then `wall.addScene(canvas, viewer.onFrame, { viewRig, onLayerLost })`.
- **Rig: display rig** (`displayRig({ virtualDisplayHeight, ipdFactor, parallaxFactor })`). The user looks
  into a tank and does not walk through it, so a display rig is the right one (guide §1).
- `await handle.firstWoven`, with an opaque cover over the canvas until then. Then the cover is removed (cut, not faded).
- Ordinary browser: `wall.supported === false` → `viewer.startMono()`, same layout, the 3D controls disabled.
- Depth slider → `handle.setViewRig(displayRig(...))`. 2D/3D button → `handle.setStereoEnabled()`, with the label driven
  by `renderingmodechange`.
- Import map maps the SDK to `/sdk/js/...` and three to the CDN at `three@0.180.0`. That is the version the SDK's own samples pin.

## Depth-related settings, and why

| Setting | Value | Why |
|---|---|---|
| `virtualDisplayHeight` / `displayRig` | `0.24` m (both the same) | The SDK default, and the value the templates use. Must match between `SceneViewer` and the rig. |
| `depthFit` | `{ front: 0.1, back: 0.27 }` tile heights | The comfortable column for a 16:9 tile (≈0.6 % / 1.5 % of width). The canvas is `aspect-ratio: 16/9`, so the numbers hold. |
| `depthOffset` | `-((0.27 - 0.1) / 2) * 0.24` ≈ −0.02 m | Puts the tank's centre about 0.085 h behind the glass. The front glass then sits near +0.07 h and the back near −0.24 h, so the "behind" budget is used, not only the "in front" one. Computed by hand from the model dimensions. The budget is not exceeded there, so `depthFit` does not shrink the tank further. |
| Yaw | none (0°) | A wide tank turned by 10° adds ~0.17 m of depth. That would make depth bind and shrink the tank well below its height fit. The 3D comes from the glass, the plants and the fish at different depths, plus head tracking. |
| `fitSweep` | `false` | Nothing turns the set, so the budget can use its real depth. |
| `orbit` | `false` | Drag-to-orbit would swing the wide tank's width into depth, past the budget it was fitted to. |
| `ipdFactor` / `parallaxFactor` | `1` at default, slider 0…1 moves both together | Display-rig factors are relative. 1 is what the display does naturally. Above 1 would exceed the budget, so the slider only goes down. |
| `clearColor` | `#101a24` (opaque), same as the page background | An alpha-0 clear can weave as black or stale pixels. The glass and water are translucent inside the scene, but they blend over the opaque clear. |
| `feather` | off | `feather` fades to transparent, so it needs an alpha clear. |
| Materials | glass opacity 0.1, water opacity 0.2, rims mid-grey `#7f8f9b` | Glass and water are low contrast. Sharp, high-contrast edges (white on black) ghost on a lenticular panel, so the rims are mid-tone. |
| Depth cues | sand, rock and wood use a fine noise grain | Stereo matching needs detail. Flat colour areas make the depth unreliable. |
| Plinth | 4 cm wider and deeper than the tank, 12 cm tall | It is the nearest thing in the set after the glass, and it stays well inside the depth budget. |
| Rig/canvas | `renderScale` default 1, `pixelRatio` 1 (set by SceneViewer) | The guide's rule for the viewport maths. |

## Other choices

- The fish are five, each on its own Lissajous loop, with a heading eased toward the loop's velocity so turns don't flip.
- Plants are 5-joint chains that sway. Bubbles rise from an air stone.
- `prefers-reduced-motion` slows all motion to 30 %.
- The page's own text and controls sit below the tile, not over it. There is no HTML over the 3D content.

## Unsure / not verified

- **Nothing was run on a 3D panel or in a browser.** I only checked the JS parses. The depth numbers come from the SDK's
  guide and samples, not from a stereo measurement of this scene. The guide says to trust the panel over the table.
- The tank's **back glass and the rocks at the back** are the farthest content. I estimated they sit within
  −0.27 h, but that is by hand, not measured. Check `viewer.getSubjectBounds()` or `handle.depthReport()` if you can.
- **Glass ghosting.** The glass is nearly transparent, so it may read as a faint film, not as glass. Edge ghosting on the
  rims and plant leaves is the main thing to look at on the panel.
- I did not pass `virtualDisplayHeight` to `addScene`, only `viewRig`, as `starter-ui` does. The rig's height is
  `VDH` (0.24), the same as `SceneViewer`'s. This avoids the "both passed" warning.
- `SceneViewer` does not expose `preserveDrawingBuffer`. The guide suggests it for large canvases on older browser
  builds. I did not add it.
- The 2D fallback relies on `startMono()` and the mono camera framing the same set. That is the SDK's own path, but I
  did not see the flat result.
