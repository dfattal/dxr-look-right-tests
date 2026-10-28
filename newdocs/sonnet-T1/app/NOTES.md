# Duck product page — notes

Files: `index.html`, `app.js` (adapted from `sdk/samples/starter-model`).

## API and rig
- `createInline3D({lazy:false})` + `addModel` from `@displayxr/inline3d/model` (default PlayCanvas engine).
- **Display rig** (addModel default): the shopper turns an object, so not a camera rig.
- Import map uses absolute `/sdk/js/...` paths; model at `/assets/Duck.gltf`.

## Depth settings
- `virtualDisplayHeight: 0.16` — size of the virtual display; depth is independent of model units.
- `depthFit {front: 0.1, back: 0.27}` — comfortable budget for a 16:9 tile (~0.6 % / ~1.6 % of width); uniform shrink only.
- `viewer.depthOffset = -(BACK-FRONT)/2 * VDH`, then `fitTo` — uses the cheaper "behind" budget so the duck can be bigger at the same comfort.
- `idleSpin: 14` deg/s turntable; drag rotates, wheel zooms. The depth fit already accounts for the turn.
- `clearColor` = page colour `#e9e6df`, opaque; no `feather` (needs alpha clear).
- Depth slider sets `ipdFactor` and `parallaxFactor` together (max 1; never `scale.z`). 2D/3D button uses `setStereoEnabled`, falling back to depth 0.
- Canvas is 16:9 with no CSS filter/opacity/transform. HTML UI sits beside the tile, not over it. Cover is removed in one step after `firstWoven`.
- Ordinary browser: `wall.supported` is false, so the flat view renders and the 3D controls are disabled with a note.

## Unsure / to check
- **Draco decoder files** are not in the SDK snapshot (`vendor/draco/` is missing) and I could not download them. `app.js` uses `/app/draco/` if present (copy `draco_wasm_wrapper.js`, `draco_decoder.wasm`, `draco_decoder.js` from `three@0.180.0/examples/jsm/libs/draco/`). Otherwise it falls back to the pinned jsDelivr copy. The SDK docs advise against a CDN; whether the PlayCanvas worker loads cross-origin decoders is untested.
- Not run in a browser or on a panel; the depth numbers come from the starter's documented measurements. The duck's real extent may differ.
- Price, title and copy are placeholders.
