# Globe: notes

**Not run.** I had no browser, and my syntax check of `app.js` was blocked by a permission prompt. The code has only been read through, so expect small bugs.

## SDK and rig
- `createInline3D({ lazy: false })`, then `wall.addScene(canvas, viewer.onFrame, { viewRig, onLayerLost })`.
- `SceneViewer` from `/sdk/js/inline3d-viewer.js` with `useEyeCamera(EyeCamera)`. three.js 0.180.0 comes from the jsDelivr import map.
- **Display rig** (`displayRig({ virtualDisplayHeight: 0.24, ipdFactor: k, parallaxFactor: k })`), because the visitor turns an object. Built on `samples/starter-ui`.
- In a browser without the 3D API, `viewer.startMono()` draws a normal 2D view. The layout is the same and the 3D controls are disabled.

## Depth settings
All figures are in tile heights (h) on a 16:9 tile. The comfortable budget is 0.1 h in front and 0.27 h behind.
- **Globe radius 0.28 h, centre 0.19 h behind the glass.** Set with `margin: 2 × 0.28` and `viewer.depthOffset = -0.19 × 0.24 m`.
  - The nearest point is about +0.09 h. Marker tips add about 0.5 % of the radius.
  - The farthest *visible* surface is the limb, at about −0.19 h.
  - The hidden far hemisphere is not drawn, so the budget does not need to cover it.
  - I did not use `depthFit`, because it budgets the whole sphere and would shrink the globe to about 65 %.
- **`fitSweep: false`.** A sphere looks the same at every yaw.
- **`orbit: false`.** The page has its own drag-to-spin. That lets it tell a click from a drag and ease the globe toward a chosen city. It also drops the viewer's wheel zoom, which would break the depth budget.
- **Depth slider.** One value `k` drives both `ipdFactor` and `parallaxFactor` through `handle.setViewRig`. There is no `scale.z`.
- **2D/3D button.** `handle.setStereoEnabled`. If the display has no flat mode, it falls back to setting the slider to 0. The label follows `renderingmodechange`.
- **Opaque clear.** `clearColor` is `#101a33`, the same as the page and the cover. I used dark navy rather than black to soften the limb's contrast, since high-contrast edges ghost first.
- **Surface.** Roughness is 0.9, so there are no glints. The texture has fine noise grain and a faint graticule, so there is detail for stereo matching and the spin reads over open ocean.
- **No HTML over the tile except the cover.** City names, the info panel and the controls are all outside the canvas. There is no `filter`, `opacity` or animated `transform` near it. The cover is removed in one step after `handle.firstWoven`.
- **Pixel ratio, near and far.** The viewer handles pixel ratio. `updateRenderState` is set to near 0.01 and far 20.

## Unsure about
- **Click hit-test in 3D.** I did not use a raycaster, because the canvas holds two eye views. Instead it projects each marker's display-space position to the tile with a perspective factor for an assumed 0.6 m viewing distance. The hit radius is generous (at least 18 px or 4.5 % of the tile height). If the real viewer distance differs a lot, clicks could be off by a few pixels. The HTML city buttons give another way to select a city.
- **`viewer.is3D`.** The code assumes it is true while the side-by-side store is active, and chooses the 3D or mono hit-test from it.
- **Land shapes.** They are rough hand-made outlines with noise on the coasts. Populations are approximate city-proper figures.
- **Auto-rotate.** It pauses 3 s after input and while a city is selected.
- **Hover feedback.** It is only a pointer cursor on the markers. Because nothing is drawn over the canvas, there are no hover labels.
