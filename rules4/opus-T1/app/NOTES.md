# Notes: Duck product page

Files: `index.html` (layout, styles, import map) and `app.js` (3D tile and cart logic).

## SDK API and view rig
- `createInline3D({ lazy: false })`, called once per document. Support is detected with `wall.supported`, not `isSessionSupported`.
- `addModel(wall, canvas, '../assets/Duck.gltf', …)` from `@displayxr/inline3d/model`, on the default **PlayCanvas** engine (`playcanvas@2.22.3`, the samples' version). `three@0.180.0` is also mapped, only for the SDK's fallback path.
- **Display rig** (the default). The shopper turns the *subject*, so the SDK scales the duck into the virtual display and centres it on the glass. I didn't use a camera rig because the user never moves through a world.
- Rotation: the SDK's turntable drag, a slow idle spin, and my own ⟲/⟳/Front-view buttons plus arrow keys. The buttons and keys ease `handle.setPose({ yaw })`, and Front view ends with `resetPose()`.
- Without 3D (`addModel` with an unsupported wall) the same tile renders a flat view you can still orbit. The page needs no branch for it.

## Depth and comfort settings
- `virtualDisplayHeight: 0.12`: roughly a real bath duck (9 cm, at 80 % of the tile height). The fit normalises size against vH, so this sets world scale only and changes neither apparent size nor depth.
- `margin`, `fit`, `fitSweep`, `depthLimit`: **left at their defaults on purpose** (rule 1). The viewer's placement already gives the smallest disparity spread. `fitSweep` keeps the duck's diagonal inside the tile while it turns, so it never gets cut off by the tile edge.
- `ipdFactor` / `parallaxFactor` / `perspectiveFactor`: untouched (runtime defaults). I made no convergence or depth changes.
- `zoom: { min: 1, max: 1.35, relax: true }`: lets the shopper look closer. Zooming pushes the duck out of the glass, so the range is capped and eases back to the framed size.
- **Background `#202227`, not black** (rule 3). Page, cover, `rectCover` colour and the tile's clear colour all use it. Every PlayCanvas camera in the tile gets an opaque clear in this colour, because a transparent woven frame shows black on the panel (browser-pvt #255). A bright yellow duck on black would double first.
- `feather: 0`: feather fades to transparent, which would show as a black frame around the tile on the panel. The canvas colour matches the page, so its edge doesn't show anyway.
- `renderScale: 1`: there is only one tile, so the eye buffers stay at full resolution for crisp edges.
- `idleSpin: 9` °/s (0 with `prefers-reduced-motion`): slow enough that the eyes can follow it.

## Woven-canvas hygiene
- The canvas has a 2:1 backing store and `will-change: transform` from first paint. Nothing on the canvas or its ancestors creates a render surface: no opacity, filter, transform, clip, `overflow` clipping or `border-radius`.
- An opaque cover sits on top of the canvas. It is removed with a hard cut on `ready` + `firstWoven`, after 8 s, or on any error, so it always comes off (rule 4).
- **All UI is ordinary DOM beside or below the tile**: title, price, rating, quantity, "Add to cart" and rotate buttons. Nothing overlaps the woven canvas, so text stays native-resolution and needs no overlay registration. Nothing uses `backdrop-filter`. The header is not sticky.
- System fonts only, so a late font load can't reflow the layout and move the canvas.

## Unsure / unverified (I had no browser and no panel)
- **Draco decoder from a CDN.** The SDK snapshot has no `vendor/draco/` folder, so `decoderPath.draco` points at `https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/libs/draco/`. The SDK recommends self-hosting (it has no CDN fallback of its own, for offline kiosks). I couldn't confirm that the PlayCanvas Draco worker accepts a cross-origin URL. If the duck fails to load, copy three's `libs/draco/` to `/draco/` and set `decoderPath: '/draco/'`.
- **Clear colour.** I set it through `handle.engine` (marked "ADVANCED, not semver"). I assume PlayCanvas writes `clearColor` to the backbuffer as-is, so it matches the CSS `#202227`. If it is gamma-converted, the tile would be a slightly different grey from the page.
- `virtualDisplayHeight` should not affect the look under the fit. That comes from the docs and samples, not from a panel.
- I haven't checked the turntable feel or the speed of the idle spin and the button tweens on hardware.
