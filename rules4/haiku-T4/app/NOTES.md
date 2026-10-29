# Notes: 3D quarterly sales chart

Files: `index.html` (page, import map, CSS), `app.js` (scene and SDK wiring). Served at `/app/`.
Not run on hardware or in a browser. Checked by reading against the SDK docs and
`node --check` only.

## SDK API and view rig

- `createInline3D({ lazy: false })` once, then `wall.addScene(canvas, onXRFrame, …)`.
- **Display rig** (`displayRig` from `@displayxr/inline3d/three`), passed as `viewRig`.
  `virtualDisplayHeight` 0.24 m, the addScene default, so no separate height is passed.
  Passing both options warns, and the browser fallback already uses 0.24.
- Scene authored in metres, rendered with `EyeCamera.setFromMatrices` per eye. No
  per-frame scaling. `+z` is out of the glass.
- Depth changes go through `handle.setViewRig(displayRig({ … }))`. Mode changes go through
  `wall.setStereoEnabled(bool)`.
- Woven-canvas rules: one persistent canvas; backing store 2:1 (side-by-side), sized in device
  pixels, dpr capped at 2; cover over the canvas until `firstWoven` (plus a 6 s timeout);
  `rectCover` plate in the background colour for resizes; `onResize` redraws immediately;
  `onLayerLost` falls back to a flat mono loop.

## Depth-related settings and why

| Setting | Value | Why |
|---|---|---|
| `virtualDisplayHeight` | 0.24 m | Scene is authored for this. Chart is 0.16 m tall, centred on z = 0, so it sits inside the display and does not need to be pushed back or shrunk. |
| `ipdFactor` | slider, default 1.0 | 1 is the display's natural depth. Lower values are the comfort dial. 0 is no disparity. |
| `ipdFactor` in 2D | 0 only if the browser has no display-mode API | With the API, `setStereoEnabled(false)` puts the panel flat and the SDK zeroes the rig itself. Without it, the rig is flattened in the page. |
| `parallaxFactor` | 1 (default) | Keeps the head-tracking look-around. |
| `perspectiveFactor` | 1 (default) | Not changed; it is an effect, not a correction. |
| Region depth rows | North z = +0.06, South 0, West −0.06 | ±6 cm around the glass. A rough estimate (not measured on a panel) puts the end rows at about 6–7 mm of parallax against a 63 mm eye separation. The middle row sits on the glass. |
| Bar size and pitch | width 0.046, depth 0.036, quarter pitch 0.08 | Keeps the 3D layout inside the display width. |
| Bar height | 0.009 m per million, base at −0.08 m | Tallest bar (18) reaches +0.082 m. Chart is centred vertically. |
| Background | opaque `#1f2229` dark grey | A transparent canvas weaves black, and pure black next to bright bars doubles. The page, cover and rect plate use the same grey, so the edges vanish. |
| Idle sway | ±5°, 14 s period, 3D only | Shows depth from motion. Stopped in 2D. Set `SWAY_RAD` to 0 to remove it. |
| `preserveDrawingBuffer` | true | Older DisplayXR builds race the weave's read of a large canvas (woven rules, §2). |
| `bufferClamped` | true | The page clamps the buffer to `maxTextureSize` itself. |

Canvas styling: no border, radius, shadow, opacity, filter, mask or backdrop on the canvas or
its ancestors. `will-change: transform` from first paint. Legend, controls and table sit outside
the stage, so nothing overlaps the woven picture.

## Unsure / not verified

- **Comfort and magnitude.** The ±6 cm spread and the 6–7 mm estimate are my reasoning from the
  docs, not measured. If it feels strong, reduce `ROW_DEPTH` first, then lower the default
  `strength`.
- **2D on the panel.** The page keeps the side-by-side render path and relies on the SDK to
  collapse the rig. The docs say a 1-view mode still weaves the two-view atlas, so the flat
  picture depends on the runtime. I did not add a separate flat canvas. If 2D looks wrong on
  hardware, that is the first place to look.
- **2D layout.** On a flat or mono view the regions are laid out side by side, not in depth,
  because an orthographic view would stack them on top of each other.
- **Fallback framing.** Without rig support, `addScene` uses its default 0.24 m height. This
  matches the chart's authoring height, but I have not checked it on that path.
- **Layout arithmetic.** Bar extents were checked by hand against the 0.24 m display at 16:9.
  Nothing was rendered.
- **Three.js version.** `three@0.180.0` from jsDelivr, the version the newer SDK samples use.
  Not loaded in a browser here.
- **Session start.** I assumed `createInline3D` needs no user gesture. If it does, the page
  falls back to the flat loop until the viewer interacts.
- **Order of depth.** North is nearest the glass and West furthest back. That is an arbitrary
  choice, stated in the subtitle.
