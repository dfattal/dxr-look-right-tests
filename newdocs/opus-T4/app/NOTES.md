# Notes — Quarterly sales 3D chart

Files: `index.html` (layout, HTML title/legend/data table/controls, import map), `app.js` (scene + SDK).
Based on the SDK's `samples/starter-ui` template and `docs/making-3d-look-right.md`.

## SDK API and rig
- `createInline3D({ lazy: false })` → `wall.addScene(canvas, viewer.onFrame, { viewRig, onLayerLost })`.
- `SceneViewer` (`/sdk/js/inline3d-viewer.js`) with `EyeCamera` (`/sdk/js/inline3d-three.js`): draws each eye
  from its own view, sizes the canvas, keeps the last good frame, `startMono()` in an ordinary browser.
- **Display rig** (`displayRig(...)`): a chart is an object you look at, not a world you move through.
- three.js 0.180.0 from jsDelivr (same version the SDK samples use).

## Depth settings and why
- `virtualDisplayHeight: 0.24` (on both the viewer and the rig) — the SDK default/template value.
- `depthFit: { front: 0.1, back: 0.27 }` tile heights — the guide's "comfortable" budget for a 16:9 tile
  (≈ 0.6 % of width in front of the glass, ≈ 1.5 % behind). The canvas is fixed at `aspect-ratio: 16/9`.
- `depthOffset = -(0.27 − 0.1)/2 × 0.24` — chart centred slightly behind the glass so the cheaper "behind" budget
  is used and the bars come out only a little.
- Fit on `Box3.setFromObject(content)` after the 14° pitch / −20° yaw, so the fit sees the turned chart's real depth.
- `fitSweep: false`, `orbit: false` — nothing spins the chart, so its depth stays inside the fitted budget; head
  tracking still gives look-around.
- Opaque `clearColor` `#f3f4f6` = page background; no `feather` (needs alpha clear).
- `depthNear 0.01 / depthFar 20` via `session.updateRenderState`, as in the templates.
- Tallest series (North) in the back row, shortest (South) in front: less occlusion and the parts nearest the
  viewer are low and central. Back wall gridlines are mid-grey on light grey (low contrast ghosts less off the glass).
- **Depth slider**: one value k∈[0,1] → `ipdFactor = parallaxFactor = k` via `handle.setViewRig`. Never above 1
  (on a display rig 1 = natural depth). Eased toward the slider value (~0.25 s, no overshoot) so depth never jumps.
- **2D/3D button**: `handle.setStereoEnabled(bool)`; label follows the `renderingmodechange` event. If the display
  has no flat mode (promise rejects) it falls back to easing k to 0, keeping the slider's value for the return.
- UI: all HTML outside the tile except one units label at top-left, which sits over the back wall (behind the glass).
  No filter/opacity/backdrop-filter/transform on or around the canvas. Cover removed in one step on `firstWoven`.
- Ordinary browser: `startMono()`, same layout; slider and button disabled with an explanatory note.

## Unsure about
- Not verified on hardware or in any browser (couldn't run one); the depth numbers come from the guide, not a measurement.
- Whether the top-left units label really falls over the back wall at every window width (it does in the expected
  3/4 layout, same as the template).
- Quarter labels are HTML text under the tile rather than 3D text, to avoid ghosted text off the glass; the
  data table gives exact values.
- Easing the slider is my own addition; the template sets the rig directly on `input`.
