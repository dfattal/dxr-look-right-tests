# Quarterly sales 3D chart — notes

Files: `index.html` (layout, legend, controls, import map), `app.js` (scene + SDK wiring).
three.js 0.161.0 from jsDelivr (the version the SDK samples use); SDK from `/sdk/js/`.

## SDK API and view rig

- `createInline3D({ lazy: false })`: one session for the document, one always-on tile.
  If `wall.supported` is false, the page runs `SceneViewer.startMono()` (an ordinary WebGL chart).
- `SceneViewer` (`@displayxr/inline3d/viewer`, marked experimental) does the side-by-side render
  loop, the 2:1 backing store, validate-before-clear and last-good-frame replay, resizes, and the
  mono fallback. The chart goes in `viewer.content`. `fitTo()` centres it on the zero-disparity
  plane, and the page drives the tilt with `setPose()` from `onTick`. Its built-in orbit is off
  because it would also take over the mouse wheel and zoom.
- `wall.addScene(canvas, viewer.onFrame, { viewRig, onLayerLost })`. I picked a **display rig**
  (`displayRig()` from `./three`) because the user turns a *subject* (the chart), not a viewpoint.
  The docs say to rotate the subject under a fixed portal in that case. On a browser without
  `setViewRig`, it passes `virtualDisplayHeight` instead.
- **Slider** → `handle.setViewRig(displayRig({ ipdFactor: s, parallaxFactor: s }))`, with s from 0
  to 1, default 0.8. On a display rig both factors are relative, and 1 means the display's natural
  setting. Scaling them together keeps the stereo and the head look-around consistent with each
  other. In a plain browser the same slider scales the viewing tilt, since there is no stereo there.
- **2D button** → `wall.setStereoEnabled(false/true)`: the panel's real 1-view mode, so the text
  is full resolution and nothing is woven. The SDK eases the disparity in and out. If the
  display-mode API is missing or the request fails, the page pushes a flat rig instead
  (ipd = parallax = 0). Either way the chart also morphs from depth rows into a flat, front-on
  grouped bar chart that sits on the glass, with value labels on every bar.
- `viewer.useDepthCursor(DepthCursor, …)`: the pointer rises above bars that stick out of the
  glass instead of being drawn behind them.
- Woven-canvas rules I followed:
  - The canvas has `will-change: transform` from its first paint, and no border, radius,
    filter or opacity on it or its parents.
  - Registration waits two frames.
  - An opaque page-coloured cover sits over the canvas until `handle.firstWoven` resolves, then
    comes off in one cut (no fade).
  - All UI is DOM placed outside the canvas, so nothing is drawn over the woven area and it stays
    sharp.
  - The scene background is opaque and the same colour as the page, because a transparent woven
    frame shows up black.

## Depth settings and why

| Setting | Value | Why |
|---|---|---|
| `virtualDisplayHeight` | 0.24 m (SDK default) | A display rig gives the same depth at any scene scale, so only the chart's proportions matter. |
| `fitTo` | `contain`, margin 0.9, `fitSweep: false`, box centred at z = 0 | The middle row (South) and the middle of the bar heights sit on the glass. The front row comes out of the screen and the back row and wall go behind it, split roughly evenly. The SDK says centred reads best on hardware. The sweep is off because yaw stays within a few degrees. |
| Row spacing `SZ` | 0.55 units (bars 0.55 deep, floor ±0.9) | The main depth control. Front to back is about 0.5–0.55 of the tile height in virtual metres. That is a little shallower than the SDK's hello-cube (a cube up to ~0.87 of the tile height) because flat bars with sharp edges show crosstalk more. |
| 3D pose | yaw −8°, pitch +10°; drag limited to ±16° yaw, −6…+10° pitch | Yaw turns the wide chart into depth and pitch turns the bar heights into depth, so the tilt is kept small on the panel. Head tracking supplies the look-around instead. |
| Mono pose | yaw −6…−32°, pitch 6…24°, set by the slider | In 2D the tilt is the only 3D cue, and there is no depth limit to stay inside. |
| ipd/parallax | slider default 0.8 | Some headroom against double images on edges far from the glass. 100% is still allowed. |
| Text | large labels, medium contrast; values only on hover in 3D, all values in the flat chart | Ghosting grows with contrast and with distance from the glass. Labels in the flat chart sit on z ≈ 0, so they stay sharp. |

## Unsure about / untested

- I have not seen this on a 3D panel. The depth numbers come from the docs' reasoning and the
  samples' sizes, not from looking at the result. The amount of out-of-screen depth (front bars
  about +0.06 virtual m) is the first thing I'd tune on hardware: raise or lower `SZ`, or the
  default strength.
- Hover picking uses `viewer.monoCamera`. It matches the display rig exactly on the glass, but
  only approximately for bars a few cm in front of or behind it.
- On a panel that is already flat, I don't know how `setStereoEnabled` behaves when the 2D/3D
  state is changed from outside the page (another tab, the OS shell). The button shows the page's
  own state, not the state the panel reports.
- No cover over the canvas on resize (rule 11, which the docs mark as insurance). A window resize
  could briefly show the raw side-by-side frame on some builds.
- `SceneViewer` and `useDepthCursor` are experimental APIs (SDK 1.46.0 snapshot).
