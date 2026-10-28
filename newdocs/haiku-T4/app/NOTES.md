# NOTES — quarterly sales 3D bar chart

Files: `index.html` (title, caption, legend, controls, import map), `app.js` (data, chart, depth
and 2D/3D logic). Built from the SDK's `samples/starter-ui` template, with its rules.

## API and rig

- **Rig: display rig.** A chart is an object the user looks at, so it is framed on a virtual
  display, not a camera. Guide §1.
- **API:** `createInline3D({ lazy: false })`, then `SceneViewer` (`/sdk/js/inline3d-viewer.js`)
  with `EyeCamera` and `displayRig` (`inline3d-three.js`). `viewer.onFrame` and `viewer.onLayerLost`
  go to `wall.addScene`. The page uses `handle.setViewRig`, `handle.setStereoEnabled`,
  `handle.on('renderingmodechange')` and `handle.firstWoven`. `wall.session.updateRenderState`
  sets the near and far planes.
- **Flat browser:** `wall.supported === false` calls `viewer.startMono()`. The slider and the
  button are disabled and say why. The layout is the same.

## Depth-related settings and why

| Setting | Value | Why |
|---|---|---|
| `virtualDisplayHeight` | 0.24 m | SDK default, passed to both `SceneViewer` and `addScene` so they match. |
| `depthFit` | `{ front: 0.1, back: 0.27 }` tile heights | Comfortable column for a 16:9 tile (≈ 0.6 % in front, 1.5 % behind). The canvas is `aspect-ratio: 16/9`. `depthFit` shrinks the chart uniformly until both ends fit. Guide §3. |
| `depthOffset` | `-((0.27 - 0.1) / 2) × 0.24` ≈ −0.0204 m | Centres the chart about 0.085 h behind the glass, so the behind budget is used as well as the front one. Guide §2–3. |
| `fitSweep` | `false` | Nothing turns the chart, so `depthFit` should budget its real depth. |
| `orbit` | `false` | Drag-to-orbit would swing the chart's width into depth, past the budget it was fitted to. A fixed yaw also keeps the labels true. Head tracking still looks around. |
| Chart yaw/pitch | 14° pitch, −20° yaw | The 3/4 view that gives the chart its depth. Taken from the starter. |
| Row spacing | `ROW_GAP` 1.1, `BAR_D` 0.7 | The three regions sit one behind another. The West row is nearest, so it is the one that pops out. |
| Height scale | `UNIT` 0.1 per million | Tallest bar (18) is 1.8 units. Only the scale changes the depth-to-height ratio, and `depthFit` absorbs it. |
| Slider → `ipdFactor` and `parallaxFactor` | `k` in [0, 1], default 1 | One value moves both, so the look-around shrinks with the stereo. The top is 1, never above, since on a display rig above 1 only adds depth the budget does not allow. Guide §7, §10. |
| `clearColor` | `#f3f4f6`, opaque | Opaque clear avoids stale or black pixels on the weave. It matches the page background. No `feather`, which needs an alpha clear. |
| `depthNear` / `depthFar` | 0.01 / 20 | Standard near and far planes for the eye projections. |
| Speckle textures on bars | fine grain, low contrast | Stereo matching needs surface detail. Plain colour can give a weak depth read. |
| Value and quarter labels | 3D sprites at 128 px per unit | Keeps the labels in the chart's perspective and at the glass. They are drawn sharp for their size. |
| Title, caption, legend, controls | HTML, all outside the tile | Rule 4: nothing in front of the glass sits under HTML. The old starter had a units label over the tile; I moved it to the caption. |
| No CSS `filter`, `opacity`, `backdrop-filter` or animation on or over the canvas | — | These take the canvas out of the weave (guide §6). The disabled-state `opacity` is on the controls, not the canvas. |

## Unsure

- **Not checked on a panel.** I could not run a browser or see the display. Every number comes
  from the SDK guide and the starter's measured values. Please check the no-double-image rule and
  the look at the default slider position first.
- **3D text.** The sprite labels are the riskiest part for legibility. They sit at the front
  edge, possibly in front of the glass. If they ghost or look soft on the panel, use HTML labels
  outside the tile instead.
- **Chart size.** `depthFit` guarantees the budget, not the size. The data-driven shape may leave
  the chart smaller than the starter's. `viewer.getSubjectBounds()` reports the placed `front` and
  `back`, if a measurement is needed.
- **Units.** The brief says "(millions)" with no currency, so the page shows "Sales, millions".
- **Slider at 0 and the button.** At slider 0 the picture is flat but the display is still in 3D,
  so the button still says "Show in 2D". This is the starter's behaviour and matches the display's
  reported mode.
- **SDK version.** The SDK is a snapshot and its docs mark `./viewer` as a preview tier, so its
  options may change. Three.js is pinned to 0.180.0, as in the SDK samples.
- **Not run.** The 2D fallback is untested. I checked `app.js` for syntax with `node --check`
  only, and checked the import targets exist.
