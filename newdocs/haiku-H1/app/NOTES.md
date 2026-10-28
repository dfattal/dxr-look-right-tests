# Globe — build notes

Files: `index.html` (page, import map), `app.js` (scene, picking, UI), `earth-texture.js` (procedural map).
Served at `/app/`; SDK at `/sdk/`; three.js 0.180.0 from jsDelivr.

## SDK API and view rig

- **Rig: display rig.** The user turns an object, so this is the guide's default (§1). Built by
  `SceneViewer` (`@displayxr/inline3d/viewer`) with `EyeCamera` (`@displayxr/inline3d/three`).
  `addScene` gets `virtualDisplayHeight: VDH`, the same value the slider's `displayRig` uses.
- Entry: `createInline3D({ lazy: false })`, then `wall.addScene(canvas, onFrame, { onLayerLost })`,
  `wall.session.updateRenderState({ depthNear: 0.01, depthFar: 20 })`, cover until `firstWoven`.
- 2D/3D switch: `wall.setStereoEnabled`, state from `renderingmodechange`. Depth slider:
  `handle.setViewRig(displayRig({ virtualDisplayHeight, ipdFactor: k, parallaxFactor: k }))`.
- Ordinary browser: `viewer.startMono()`; the controls are disabled and the page reads flat.
- Picking: the SDK has no click API. `cursorViewRay` (`@displayxr/inline3d/cursor-depth`) builds
  one ray per eye from copies of the frame's view matrices, the same maths `DepthCursor` uses.

## Depth settings and why

| Setting | Value | Why |
|---|---|---|
| `virtualDisplayHeight` | 0.24 m | SDK default. Only the scale of the units; the budgets are relative. |
| `depthFit` | `{ front: 0.1, back: 0.27 }` tile heights | The guide's comfortable 16:9 column (≈0.6 % / ≈1.5 % of width). The globe is not a strong hero object, so the comfortable column is the target. |
| `depthOffset` | `-0.085 × VDH` | Centred on the glass, only the front budget binds. Setting the globe back by half the difference (0.085 h) uses both budgets: front room 0.185 h, back room 0.185 h. |
| `fitSweep` | `true` (default) | The globe spins (orbit and idle spin). Required so the depth budget holds at every yaw. |
| `fitTo` extent | `x = z = √2·RB`, `y = 2·RB`, `RB = 1.20` | `depthFit` budgets `hypot(x, z)/2` when swept. `√2·RB` makes that exactly `RB`, the bounding radius of the globe plus its pins (1 + 0.08 stalk + 2×0.06 head). Pins stick out radially, so a plain box underestimates depth at some spin angles. |
| `orbit` / `idleSpin` | `true` / `6` deg/s | The user can spin. Yaw does not change a sphere's depth; the bounding-sphere fit covers the pins. Idle spin is off under reduced motion (viewer handles it). |
| `clearColor` | `#0b1220` (== page) | Opaque clear. A transparent clear shows stale or black pixels on the weave. |
| `feather` | off | It fades to transparent, which needs an alpha clear. |
| Pins | stalk 0.08, head r 0.06, pick proxy r 0.12 | Small pins keep the depth budget. The proxy makes a head about 2× easier to click without drawing anything. |
| Map colours / material | muted sea and land, matte (roughness 0.9, metalness 0), no specular | A high-contrast coastline or glint ghosts across the panel's crosstalk. |

Result: the globe's radius is about 0.154 × VDH, so its diameter is about 31 % of the tile height.
The size fit alone would give 0.33 VDH; the depth budget binds. The guide's "strong" column
(0.18 h / 0.45 h) would allow about 1.7× the radius, for a hero moment only.

## HTML and 2D UI

- The info panel and city buttons sit beside the canvas, never over it (rule §4.2/§6). No
  `filter`, `opacity`, `backdrop-filter` or transform on the canvas or its ancestors. Panel
  changes are hard cuts, not fades.
- Picking: a press and release within 6 px and 700 ms counts as a click. A drag is left to the
  viewer, which spins the globe.
- Accessibility: the five city buttons select the same cities as the markers.

## Not verified / unsure

- **Not seen on a panel or in a browser.** Nothing here has been run. I checked the JavaScript
  with Node's module parser and checked the marker placement numerically (see below). The depth
  numbers come from the guide, not from measurement on hardware.
- **Map placement checked numerically, not visually.** My `latLonToNormal` matches three's
  `SphereGeometry` vertex and UV formulas to ~1e-16 for all five cities. The start yaw (`-(90° + START_LON)`)
  brings the 10°W meridian to the viewer side. London, New York and Nairobi start on the visible side;
  Tokyo and Sydney start behind.
- **Eye copies vs eased poses.** The picking uses the raw view matrices copied from each frame. The
  viewer's tracking ease (`viewerEase`) can differ from them for a few frames after a view is acquired
  or lost, so a click then may miss by a few pixels. It is not a depth problem.
- **Picking from the flat (2D/3D switch off) mode.** It uses the one view the display reports, which
  should be right, but I have not tested it.
- **Populations** are approximate, from memory (no live data, no internet). Tokyo is the metropolis
  (about 14 million), not the 23 wards. The panel shows each figure's definition and year. Please check
  before publishing.
- **The map is schematic.** Continent outlines are rough polygons; coastlines are not accurate.
- **No auto-rotate to a selected city.** I did not implement it: the viewer's pitch sign convention
  is not verified, so facing a city by pitch and yaw could land it off centre.
- **three.js 0.180.0** is the version the SDK's own starter uses. The SDK's peer range is `>=0.150.0`,
  and I did not test other versions.
- **Depth slider latency.** `setViewRig` takes effect a frame late (guide note). Fine for a dial.
