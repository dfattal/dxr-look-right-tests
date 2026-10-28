# 3D bar chart: notes

Files: `index.html` (title, canvas, legend, slider, button, import map), `app.js` (scene and controls).
SDK: `/sdk/js/` (v1.46.0 per `sdk/package.json`). three.js 0.161.0 from jsDelivr, the version the SDK samples use.

## SDK API and rig

- `createInline3D({ lazy: false, autoChrome: false })`: one session for the document, one always-on element.
  `autoChrome: false` because the page has no sticky chrome.
- `wall.addScene(canvas, onFrame, { virtualDisplayHeight: 0.24, bufferClamped: true, rectCover: 'auto', onResize, onLayerLost })`.
- `handle.setViewRig(displayRig({ virtualDisplayHeight: 0.24, ipdFactor, out }))`, sent right after `addScene`
  (only when `inline3dViewRigSupported()`). The scalar `virtualDisplayHeight` in `addScene` is kept as the
  fallback for browsers without rigs. Passing both `viewRig` and `virtualDisplayHeight` would warn.
- **Rig: display rig.** The viewer turns a subject; the page does not move a camera through a world. The chart
  is rotated, the portal stays at z = 0.
- `ViewerEase` on each frame (the SDK's tracking ease), with `frameTrackingState(frame)`.
  Last-good eye replay goes through the same copies.
- 2D/3D button: `wall.setStereoEnabled(false | true)`. If the call fails or the API is missing, the page
  sets `ipdFactor` to 0 (eyes match) while the panel is flat, and restores the slider value when it comes back to 3D.
- Woven-canvas rules: the backing store is sized before `addScene`, a cover over the canvas is released on
  `firstWoven` (hard cut), the canvas has no CSS border, radius, shadow, filter or opacity, nothing sits over it,
  and every `onFrame` draws (a short or null view list replays the last good pair, and before any pair arrives
  the mono camera fills both halves).

## Depth settings and why

| Setting | Value | Why |
|---|---|---|
| `virtualDisplayHeight` (addScene and rig) | 0.24 m | The chart is authored in metres for this display height. The runtime does the scaling. The chart fills about 70 % of it. |
| `ipdFactor` (display rig, relative) | slider, default 1.0 | 1 is the natural eye separation. Lowering it is the comfort dial. |
| `parallaxFactor`, `perspectiveFactor` | 1 (defaults) | Head tracking and the off-axis skew stay at the runtime's values. |
| Row spacing `ROW_GAP` | 0.026 m (North +, South 0, West −) | The regions are the depth axis. This is what the stereo reads. |
| Bar depth `BAR_D` / width `BAR_W` | 0.018 / 0.024 m | Thick enough to read as solid at this size. |
| Base turn | 16° about the vertical axis | Separates the rows in depth. |
| Sway | ±3° at 0.5 rad/s | Makes the depth move slowly even without head motion. Small on purpose. |
| Chart depth extent | about ±0.055 m (estimate) | Roughly a quarter of VDH, so the pop-out and the recession balance around the glass. My arithmetic, not measured. |
| Quarter labels | at z = +0.05 (front edge of the plinth) | Nearest content. Kept at the plinth edge so the pop-out stays inside the budget. |
| Mono camera fov | 22.6° at 0.6 m | Frames exactly 0.24 m at z = 0, the same view the display gives. |

## Unsure (not verified here)

- **I could not run a browser or see the display.** Comfort, the amount of depth, and whether the sway reads
  well are all unchecked. The depth numbers above are estimates from arithmetic.
- **How the flat (2D) hardware state presents the side-by-side buffer.** Both halves carry the same mono
  image (the SDK zeroes the rig). I followed the `display-modes` sample, which does the same. The docs say the
  1-view mode is real 2D, but I could not confirm the flat-panel picture.
- **`ViewerEase` with `Float64Array` entries.** The `.d.ts` says Float32, and the code reads by index, so
  `Float64Array` should work. Unverified.
- **`preserveDrawingBuffer: true`.** Set because the docs suggest it for older builds. It may not be needed.
- **Slider in a browser without the display (flat preview).** The slider sets the chart's turn there,
  because there is no stereo. On the panel it sets the eye separation instead.
- **Woven 3D at slider 0.** The eye separation goes to zero but the chart stays turned, so it looks flat
  but angled, not flat-on. Intentional, but may read oddly.
- **Label legibility.** The sprite text is drawn at 256×128 and sized from the chart's metres. Check it on the panel.
- **The `firstWoven` cover** sits over a dark background that matches the scene, so a slow first join shows a plain
  dark box rather than a flash. Not seen on hardware.
