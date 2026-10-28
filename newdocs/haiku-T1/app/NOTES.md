# Product showcase: notes

Page: `app/index.html` + `app/app.js`. Served from the web root, so the page is `/app/`, the SDK is `/sdk/`, and the model is `../assets/Duck.gltf`.

## SDK API and view rig

- `createInline3D({ lazy: false })` and `addModel()` from `@displayxr/inline3d/model`. Rendered with the SDK default engine (PlayCanvas). Template: `sdk/samples/starter-model/`, SDK 1.46.0.
- **Display rig** (addModel's default). The shopper turns an object, so the duck is scaled to a virtual display and sits on the glass. Turntable on drag, `idleSpin` when idle.

## Depth settings and why

| Setting | Value | Why |
|---|---|---|
| `virtualDisplayHeight` | 0.16 m | Size of the virtual display. Sets world scale only; the fit normalises apparent size. |
| `depthFit` | `{ front: 0.1, back: 0.27 }` tile heights | The 16:9 comfortable column (guide §3). The duck is shrunk uniformly so nearest and farthest points sit inside it at every turntable angle. |
| `depthOffset` | `-((0.27 - 0.1) / 2) * 0.16` ≈ −0.0136 m, set after `ready` and then `fitTo` | Centred on the glass, only the front budget binds. Half the spare back budget moved behind the glass lets both ends reach their limit, so the duck is larger for the same comfort. |
| `zoom` | `{ min: 0.6, max: 1, relax: true }` | `depthFit` is not refitted on zoom. Zoom-in is capped at the budgeted size; zoom-out is always safe. `relax` returns to 1× when idle. |
| `idleSpin` | 14 °/s | Slow turn. The turntable costs size (depthFit budgets the swept box), which is accepted. |
| `clearColor` | `#e9e6df`, same as the page background | Opaque clear. Transparent pixels can weave as stale or black. |
| Depth slider | 0–1 drives `setStereo({ ipdFactor, parallaxFactor })` together | One dial; never `scale.z`. Default 1 = what the display does naturally. |
| `renderScale` | default 1 | Crisp output. The duck is light, so there is no need to lower it. |
| No `feather` | — | It fades to transparent, which needs an alpha clear. |

Other rules followed: title, price and button are HTML beside the tile, never over it. The canvas has no border, radius, shadow, opacity, filter or transform. The cover stays until `firstWoven`, then is removed in one step. The 2D/3D switch shows the state reported by `renderingmodechange`. An ordinary browser shows the same layout in 2D, with the depth controls disabled.

## Not verified / unsure

- **Draco decoder.** The duck is `KHR_draco_mesh_compression`. No decoder ships in this snapshot and I can't download one, so `decoderPath` points at jsDelivr (three@0.180.0, matching the import map). I could not confirm the PlayCanvas worker loads it cross-origin. For an offline build, copy `three/examples/jsm/libs/draco/` to `vendor/draco/` in the web root and change `DRACO_PATH` in `app.js`.
- **Placement and comfort are untested on a panel.** The numbers come from the starter and the guide. I could not see the display, so check the nearest and farthest points with `model.depthReport()`.
- **Wheel zoom and scroll.** The wheel zooms the duck. On a narrow stacked layout the tile also takes touch drags (`touch-action: none`), so the page can't scroll there. This follows the SDK's default interaction. I did not add a way to disable it.
- **`zoom` clamp.** I read the `min`/`max` semantics from `model.d.ts` and `splat.d.ts`; I did not test them.
- **Placeholder content.** "The Classic Duck", the "Bath collection" kicker and $12.00 are invented. Add to cart only counts clicks in the page; there is no real cart.
- **Syntax.** The page was checked by reading; I could not run it in a browser.
