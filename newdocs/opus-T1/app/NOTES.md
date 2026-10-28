# Duck product page: notes

Files: `index.html` (layout, styles, import map) and `app.js` (3D tile and page logic). The page is based on `sdk/samples/starter-model`.

## SDK API and rig
- `createInline3D({ lazy: false })` from `/sdk/js/inline3d.js`, plus `addModel()` from `/sdk/js/inline3d-model-entry.js`. The model uses the default PlayCanvas engine, `playcanvas@2.22.3` from jsDelivr.
- **Display rig** (addModel's default). The shopper turns an object; they don't move through a world. The rig scales the duck into a virtual display, so its depth doesn't depend on the glTF's units.
- Rotation: drag to turn (turntable), wheel or pinch to zoom, and a slow idle spin. The ⟲ / Front / ⟳ buttons ease the yaw with `viewer.setPose`. They pause the idle spin for 6 s.
- In an ordinary browser, `wall.supported` is false. `addModel` then renders a flat view that can still be dragged, and the depth and 2D/3D controls are disabled with a note.

## Depth settings
| Setting | Value | Why |
|---|---|---|
| Tile shape | 16:9 (`aspect-ratio`) | The guide's budget numbers in tile heights are given for 16:9. |
| `virtualDisplayHeight` | 0.16 m | Same as the starter template. It only sets scale, because `depthFit` limits the depth. |
| `depthFit` | `{ front: 0.10, back: 0.27 }` tile heights | The "comfortable" column: about 0.6 % of the width in front of the glass and about 1.5 % behind. The duck is shrunk uniformly so this holds at every turntable angle (`fitSweep` is on by default). |
| `viewer.depthOffset` | −(0.27−0.10)/2 × 0.16 = −0.0136 m, then `fitTo` again | Screen plane through the subject. Centred, only the front limit binds; sliding the duck back uses the cheaper behind budget too, so the duck can be larger. I re-pass it in every `setPose`, because `resetPose()` would clear it. |
| `zoom` | `{ min: 0.8, max: 1.5, relax: true }` | Zoom is a short "look closer". At 1.5× the front reaches about 0.15 h (about 0.9 %), inside the "strong, briefly" column, and it eases back to 1× after the gesture. |
| `clearColor` | `#ebe8e1`, the same as the page background | Opaque clear. A transparent clear weaves stale or black pixels, and the matching colour keeps the tile edge invisible. No `feather`, because it needs an alpha clear. |
| Depth slider | `setStereo({ ipdFactor: k, parallaxFactor: k })`, k from 0 to 1 | Both factors move together. 1 is the display's natural depth. The slider never scales z. |
| 2D/3D button | `wall.setStereoEnabled()`; the label follows `renderingmodechange` | If the display has no flat mode, it falls back to setting the slider to 0. |

## Other comfort and crispness choices
- All text and controls are HTML beside or under the tile, never over it. Nothing 2D sits over content that comes out of the glass.
- The canvas and its ancestors have no border, radius, shadow, filter, opacity or transform.
- A solid cover (the same colour as the page) stays over the canvas until the model is framed and `firstWoven` has resolved. It is removed in one step, never faded.

## Unsure about
- **Draco decoder location.** The snapshot doesn't include the `vendor/draco/` folder that the samples use, and I couldn't download files. So `decoderPath.draco` points to `https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/libs/draco/`. I believe PlayCanvas's Draco worker loads these cross-origin files fine, since jsDelivr serves them with CORS, but I couldn't test it. If it fails, `ready` rejects and the cover shows "The 3D view could not be loaded." To self-host, copy three's `libs/draco/` into `app/draco/` and change `DRACO` in `app.js`.
- I couldn't run a browser or see the panel. The depth numbers come from the guide's budget table and the starter template's measurements, not from my own testing on a panel. `app.js` logs `depthReport()` to the console after framing, so the numbers can be checked there.
- The Duck's default front (yaw 0) is whatever the glTF's +Z faces. I didn't verify that it shows the duck in a flattering 3/4 view.
