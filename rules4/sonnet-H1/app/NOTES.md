# Globe — notes

Files: `index.html` (layout, import map), `app.js` (scene, input, SDK), `earth.js` (procedural Earth colour map).
Not run in a browser or on a 3D display; only syntax-checked.

## SDK / rig
- `createInline3D({lazy:false})` then `wall.addScene(canvas, onFrame, {...})` with three.js `0.161.0` (pinned, jsDelivr), plus `EyeCamera` and `EdgeFeather` from `/sdk/js/inline3d-three.js`.
- **View rig: the default display rig**, `virtualDisplayHeight: 0.12` (the canvas is a portal onto a 12 cm virtual display). No camera rig, so there is no `convergence` to set.
- Per frame: one viewport per eye from `layer.getViewport(view)`, `eye.setFromView(view)`, render, `feather.render`. The scene is authored in metres and the views are used as-is.
- Mono fallback (no session, session error, or `onLayerLost`): a plain `PerspectiveCamera` framing the same 0.12 m window, with a 1:1 backing store.

## Depth settings and why
- **Globe centred on z = 0** (the zero-disparity plane), radius 0.036 m (60% of window height). The front hemisphere comes out of the glass and the back goes behind it, which gives the smallest disparity spread. It is not pushed back, shrunk or flattened.
- **Markers** are 8 mm stems with an amber head, so they stick out about 8 mm past the surface. That makes about 44 mm of pop-out in total, similar to the SDK's 6 cm hello-cube (about 42 mm at its corners).
- **Globe is rotated, the camera is not.** The rig stays fixed and head tracking stays correct.
- **No stars or far background.** Nothing sits far behind the glass, and there is no high-contrast far detail.
- **Background is dark grey `#15181f`**, never pure black, both on the page and behind the canvas. The canvas is transparent (`alpha`, clear alpha 0, `scene.background = null`) and the edges fade per eye with `EdgeFeather` (22 px).
- **Backing store** is 2 × eye width, `renderer.setPixelRatio(1)`, DPR capped at 2 and clamped to GL limits. Resizes go through `onResize`.
- **No CSS effects** on the canvas or its ancestors (no border, radius, shadow, filter, opacity or mask), and no `backdrop-filter` anywhere. The info panel and city buttons are beside the canvas, not over it, so no overlay exclusion is needed.
- **Cover.** An opaque cover sits over the canvas until `handle.firstWoven` resolves. It is removed by a 6 s failsafe, on unsupported or thrown setup, and in the 2D fallback.
- **Picking** averages each marker's screen position over both eyes' projections, so a marker that pops out of the glass is hit where it appears fused. Only markers on the visible hemisphere count.

## Unsure / not verified
- I could not check the look on hardware. Light intensities (hemisphere 1.5, directional 2.4, set for three ≥ r155 units) and the procedural colours were chosen by reasoning and may look a little bright or dark.
- Continent outlines are coarse hand-placed polygons, blurred and noise-perturbed. They are recognisable, not accurate. Populations are rounded city-proper figures.
- I did not enable `DepthCursor`, so the OS cursor is drawn at glass depth and may look behind the nearest part of the globe.
- The texture is built synchronously at start-up (roughly 0.5–1.5 s on a laptop) while the "Preparing 3D…" cover is shown.
- `firstWoven` timing relies on the SDK default hold (1200 ms) on browsers without the join report.
