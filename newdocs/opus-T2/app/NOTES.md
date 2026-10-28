# Orrery: notes

**Files:** `index.html` (layout and import map), `app.js` (scene and SDK wiring). three.js 0.180.0 comes from jsDelivr. The SDK is loaded from `/sdk/js/`.

## SDK API and rig
- `createInline3D({ lazy: false })`, then `wall.addScene(canvas, viewer.onFrame, { viewRig, onLayerLost })`.
- `SceneViewer` (`/sdk/js/inline3d-viewer.js`) with `.useEyeCamera(EyeCamera)`. It draws each eye from its own view and keeps the last good frame when a frame arrives with too few views. In a normal browser it falls back to `viewer.startMono()`.
- **Display rig:** `displayRig({ virtualDisplayHeight: 0.24, ipdFactor: k, parallaxFactor: k })`. The orrery is an object you look at, not a world you move through (guide §1). Drag-to-orbit is off; head tracking still lets you look around it.
- The page follows `samples/starter-scene` and `samples/starter-ui`:
  - opaque `clearColor`, the same colour as the page background (`#04060c`);
  - no feather;
  - a cover over the canvas until `handle.firstWoven`, then removed in one step;
  - no HTML over the tile, and no CSS filter, opacity or transform near it;
  - a depth slider that sets `ipdFactor` and `parallaxFactor` together;
  - a 2D/3D button using `setStereoEnabled`, falling back to depth 0;
  - `updateRenderState({ depthNear: 0.01, depthFar: 20 })`.

## Depth settings
Depths are in tile heights (h) on a 16:9 tile. Disparity as a share of tile width is about 10·d·9/16.

| Setting | Value | Why |
|---|---|---|
| `virtualDisplayHeight` | 0.24 | The SDK default, and the same value in the viewer and the rig. |
| `depthFit` | `{ front: 0.10, back: 0.16 }` | Front ≈ 0.56 % of width, just inside the comfortable 0.6 %. Back ≈ 0.9 %, which leaves room behind the orrery for the stars. |
| `depthOffset` | `−(BACK−FRONT)/2 · VDH` | Uses both sides of the budget, as in the starters. The sun stays near the glass, the sharpest plane, which suits the brightest object. |
| Fit box | tilted orbital plane plus a temporary torus around the outer orbit (tube 0.7, covers the giant's ring) | `depthFit` then budgets every planet position, not only where the planets start. `fitSweep: false` and `orbit: false`, because nothing yaws the disc. |
| Tilt | 62° above the orbital plane | A flatter tabletop view makes the disc deeper (2R·cos θ), so the fit would shrink it. At 62° the orrery is about 0.45 h tall. |
| Stars | `THREE.Points` in `viewer.scene` (display metres) at −0.18 … −0.21 h (≈1.0–1.2 %) | Placing them outside `viewer.content` keeps them out of the fit and at a fixed depth behind the orrery. They span 5×3 tile heights, so looking around never reaches their edge. They are mostly dim, soft 3 px sprites because bright points on black ghost first. |
| Nebula plane | −0.22 h (≈1.24 %) | A full-frame backdrop with faint grain so both eyes can fuse it. Kept dim and low-contrast. |
| Depth slider | k ∈ [0, 1] → `ipdFactor = parallaxFactor = k` | Can only make the scene shallower; never above 1 on a display rig. |

Nothing in front of the glass reaches a frame edge. The orrery fills only the middle ~25–30 % of the width, and the only thing touching the edges is the backdrop, which is behind the glass.

## Unsure about
- **Backdrop depth.** The guide's full-frame row recommends at most 1.0 % behind; the nebula is at about 1.24 % and the farthest stars at about 1.2 %. I accepted this because the backdrop is dim and soft. If it ghosts on a real panel, move `STARS_*` and `NEBULA` in to about 0.17–0.18 h, or lower the nebula contrast.
- **Orrery size.** The depth budget limits a wide disc a lot, so the orrery is fairly small in the tile. To make it bigger, use a steeper tilt or the "strong" budget.
- **Untested in a browser.** I could not run a browser or the display. The disparity numbers above are calculated, not measured. On load the console logs the actual `getSubjectBounds()` placement in tile heights, so you can check them.
- **Orbit lines.** They are 1 px lines with material opacity 0.45, and could look thin or shimmer when woven.
- **Star size.** The 3 px point size is in eye-buffer pixels, so stars may look a bit smaller or larger on the panel than in 2D.
