# Notes

**API / rig:** `createInline3D({lazy:false})` + `wall.addScene` with `SceneViewer` (`/viewer`) and `EyeCamera`/`displayRig` (`/three`), three.js 0.180.0 from jsDelivr. **Display rig** (`virtualDisplayHeight` 0.24 m): the chart is an object you look at, not a world you walk through. Based on the SDK's `samples/starter-ui`.

**Depth settings**
- `depthFit {front:0.1, back:0.27}` (tile heights, 16:9): the SDK's comfortable budget (~0.6 % of width in front, ~1.5 % behind). It shrinks the chart uniformly; the tall 18-unit bars would otherwise exceed it.
- `depthOffset = -(BACK-FRONT)/2 * VDH`: pushes the chart slightly behind the glass so the larger "behind" budget is used. The screen plane passes through the chart.
- `fitSweep:false`, `orbit:false`: nothing turns the chart, so its real depth is budgeted and the view stays readable. Head tracking still gives look-around.
- Slider "3D strength" 0..1 (default 1): sets `ipdFactor` and `parallaxFactor` together via `handle.setViewRig(displayRig(...))`. Never above 1; never `scale.z`.
- 2D/3D button: `handle.setStereoEnabled`; if rejected, falls back to slider = 0. The label follows `renderingmodechange`.
- Opaque clear equal to the page colour; no feather; speckled materials for stereo matching; Q1–Q4 labels are flat on the base, at the base's depth.

**UI:** title, legend and controls are HTML outside the canvas. Only the "sales, $ millions" label overlays the top-left (empty background). No filter/opacity/transform on or over the canvas. The cover is removed in one step after `firstWoven`.

**No 3D (ordinary browser):** `viewer.startMono()`; the controls are disabled with an explanatory note.

**Unsure / untested:** I could not run a browser, so nothing was verified visually or on a panel. The tall bars (18 vs ~6 wide) make the fitted chart fairly small in the tile. I did not check the legibility of the Q1–Q4 base labels. There is no value axis; exact values are in the caption under the chart. I did not confirm that the `SceneViewer` and `displayRig` signatures match the starter sample beyond copying its usage.
