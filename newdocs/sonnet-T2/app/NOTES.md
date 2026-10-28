# Notes

**API / rig:** `createInline3D` → `wall.addScene(canvas, viewer.onFrame, { viewRig })` with `SceneViewer` + `EyeCamera`
(`/sdk/js/inline3d-viewer.js`, `inline3d-three.js`), three.js 0.180.0 from the CDN. **Display rig**
(`displayRig`, virtualDisplayHeight 0.24 m): the user looks at a diorama and doesn't move through it.
Ordinary browser: `viewer.startMono()`. Template followed: `sdk/samples/starter-scene` + `starter-ui`.

**Depth settings**
- `depthFit {front 0.1, back 0.27}` (tile heights, comfortable column on 16:9, ≈ 0.6 % / 1.5 % of width): shrinks the set uniformly to fit.
- `depthOffset = -(BACK-FRONT)/2 * VDH`: pushes the set behind the glass to use the larger behind budget; the sun sits near the glass.
- `fitSweep:false`, `orbit:false`: nothing turns the whole set, so its real depth is budgeted; drag-orbit would exceed it.
- Fit extent = the system's x/y extent, but its z extent includes the star slab, so the stars count against the behind budget.
- Table tilt 24°: keeps the disc's depth (~0.4× its diameter) modest.
- Starfield = 1.2-unit-thick slab of 1400 points just behind the system, not an infinite sphere (infinity would exceed the behind budget). Stars are mid-grey and small, and orbit lines dim, to limit ghosting of sharp high-contrast detail.
- Opaque `clearColor` = page background `#050813`; no feather; no CSS filter/opacity/transform on or over the canvas; controls sit below the tile; cover removed on `firstWoven`.
- Depth slider drives `ipdFactor` and `parallaxFactor` together (default 1); the 2D/3D button uses `setStereoEnabled`, falling back to slider 0.

**Unsure:** I couldn't run it in a browser or on a panel, so nothing is tested. The star point size and the slab's overscan against the tile edges are guesses (edge stars are behind the glass, so they should be safe). Depth numbers are the docs' values, not tuned on hardware. The fit uses a conservative bound of the whole disc, so the system may look smaller than it could.
