# Earth: five cities. Notes

Files: `index.html` (page, import map, CSS), `app.js` (scene, picking, info panel), `data.js`
(cities and a rough land outline). Served at `/app/`, SDK at `/sdk/`.

## SDK API and view rig

- `createInline3D({ lazy: false })`, then `wall.addScene(canvas, viewer.onFrame, { virtualDisplayHeight, onLayerLost })`.
- `SceneViewer` (`/sdk/js/inline3d-viewer.js`) does the framing, drag-to-spin, idle turntable, depth
  cursor wiring and the mono fallback. Its API is marked experimental in the SDK, so it is outside the semver promise.
- `EyeCamera` (required by `useEyeCamera`) and `DepthCursor` / `raycastHitTest` from `/sdk/js/inline3d-three.js`.
- **View rig: display rig** (the default, from the scalar `virtualDisplayHeight`). The viewer turns the
  subject and the viewpoint never moves. The authoring guide's rule, "the user turns the subject, so display rig".
  Identity pose, `ipdFactor` 1, `parallaxFactor` 1, `perspectiveFactor` 1 (the runtime defaults).
- three.js 0.161.0 from jsDelivr (the SDK's peer range is `>=0.150.0`).

## Depth settings and why

Depth values are in virtual display metres, with the tile height `vH = 0.24`. Each value is shown as a
fraction of the tile height because that ratio is what the viewer perceives.

| Setting | Value | Why |
|---|---|---|
| `virtualDisplayHeight` | 0.24 m | The SDK default. It must match on `SceneViewer` and `addScene`. Since `fitTo` sizes the globe to the tile, it changes only the virtual scale, not the look. |
| `margin` + `fit: 'contain'` (`FILL`) | 0.5 | Globe diameter = half the tile height. The globe straddles the glass by ±0.25 tile heights, the same total depth as the SDK's own `hello-cube` (a 6 cm crate in a 12 cm tile). Matching a depth budget the SDK tuned is a safer starting point than guessing. |
| `fitSweep` | `false` | The default fits the sweep diagonal for long subjects. A sphere's silhouette does not change as it turns, so the diagonal would only shrink the globe for no reason. |
| `depthOffset` | 0 (not set) | The SDK says a version that slid the subject behind the glass read *worse* on hardware, and the centred zero-disparity placement is the native convention. Left at the default. |
| `ipdFactor` / `parallaxFactor` | 1 (default) | The depth is already at the SDK's reference ratio. If the globe is too strong on the panel, `ipdFactor` (relative, 0 to 1) is the first dial to try, using a `displayRig({ ipdFactor })`. |
| `idleSpin` | 4 °/s, paused while a city is selected | Not a depth setting. Stops the turntable while someone is reading a city. |
| `pitchLimit` | ±60° (default) | Cities span latitude −34° to +52°, so the limit is never hit. |
| `renderScale` | 1 (default) | The globe is smooth and worth full resolution. The SDK clamps the backing store to the GL limits. |
| Background | opaque `BG` (`0x070b16`), not transparent | A cleared (transparent) woven frame weaves black on the panel (known limitation), and an opaque background needs no edge feather. |
| Depth cursor | on (`viewer.useDepthCursor`) | Over the front of the globe, the OS cursor on the glass would look misplaced against content that pops out. The cursor rises to the surface instead. Remove the one `useDepthCursor` line to turn it off, if it misbehaves on hardware. |
| Markers | dot radius 0.07, placed at r 1.03; invisible hit spheres radius 0.16 at r 1.0 | The dots are small. The hit spheres give a generous click target, and they sit at the surface so they are occluded by the globe on the far side. |

Pop-out in virtual metres (`vH = 0.24`): globe front +0.060 m (0.25 vH), back −0.060 m (−0.25 vH),
markers to about +0.066 m (0.275 vH). `viewer.getSubjectBounds()` reports `front` and `back` live, if you need to check these on hardware.

## Woven-canvas rules followed

- The canvas is bare: no border, radius, shadow, filter, opacity or mask on it or any ancestor. The stage is a plain box.
- No `backdrop-filter` anywhere.
- The info panel and city list sit beside the stage, never over the canvas, so no overlay declaration is needed.
- A poster covers the canvas until `handle.firstWoven` settles, then is cut (`hidden`), never faded. It is not marked as an overlay.
- Two animation frames before `addScene` (the canvas is fresh to the compositor).
- Opaque clear colour, so a transparent frame never reaches the weave.
- The 2D fallback runs `viewer.startMono()` with the same globe and interaction.

## Things I could not verify, or am unsure of

- **Not run in a browser or on a display.** Checked: `app.js`, `data.js` and the SDK modules parse and resolve
  in Node. The rotation rule (yaw = −lon, pitch = lat, pivot `Rx·Ry`) is checked numerically, and the land outline
  renders as recognisable continents. Visual depth, comfort, click accuracy and the weave all still need a hardware check.
- **Depth values are reasoned, not measured.** `FILL` = 0.5 and no depth offset are chosen from the SDK's own ratios,
  not tested on a panel.
- **Picking uses the mono camera.** The stereo eyes have a different perspective, so a click on a marker near the
  limb could land a few pixels off. The hit spheres are wide enough that this should not matter, but it is unverified.
- **Populations are from memory and approximate.** Each figure names its area and year. Check them against current
  sources before publishing. Metro-area figures are much larger (Tokyo is about 37 M as a metro).
- **Land outline is hand-drawn and rough.** It is not a survey map, and inland seas are not carved out.
- **The depth cursor is on by default**, though the SDK documents it as opt-in. I chose it because the globe's front
  pops out and a cursor on the glass would mislead.
- Pointer events on the woven canvas are assumed to arrive normally in the DisplayXR Browser (the SDK's samples rely on this too).
