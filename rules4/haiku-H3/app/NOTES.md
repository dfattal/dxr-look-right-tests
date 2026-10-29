# Ring Flight: notes

Files: `index.html` (page, import map, CSS), `main.js` (renderer, chase camera, weave, 2D fallback),
`world.js` (terrain, peaks, sky, plane, hoops), `game.js` (flight model and rings). SDK 1.46.0 (`/sdk/`),
three.js 0.161.0 (CDN, pinned, the same version the SDK's camera-rig sample uses).

## SDK API and view rig

- **Rig: camera rig**, not display rig. The user is inside the world and moves through it
  ([authoring-inline-3d.md, "Which rig"](../sdk/docs/authoring-inline-3d.md)).
- `createInline3D({ lazy: false })`, then `wall.addScene(canvas, onXRFrame, { viewRig, rectCover, onResize, onLayerLost })`.
- `cameraRigFromCamera(THREE, appCam, { convergence, attach: true, ipdFactor, parallaxFactor, metersToVirtual })`
  from `@displayxr/inline3d/three`. `attach: true` sends an identity pose, and the two `EyeCamera`s are
  parented under `appCam`, so the stereo uses this frame's camera with no one-frame lag.
- Eyes use `setLocalFromView`. Replay uses copies of the matrices and `setLocalFromMatrices`.
- `wall.session.updateRenderState({ depthNear, depthFar })`, as the porting guide asks.
- `handle.firstWoven` drops the cover. An 8 s timer is the safety net.
- `wall.getDisplayInfo()` gives `recommendedViewScaleX` and `displayPixelWidth`, used to size the buffer.
- If `inline3dViewRigSupported()` is false, the page stays 2D. It does not weave a display rig,
  which would ignore the chase camera.

## Depth settings and why

| Setting | Value | Why |
|---|---|---|
| Convergence | 25 m, fixed | Content at 25 m sits on the glass. The plane (about 13 m) pops slightly out, and the hills beyond about 50 m recede. Never 0 (infinity puts everything in front of the glass), and never driven by the camera's gaze. |
| `ipdFactor` | 1 | Absolute on a camera rig, so 1 is a real 63 mm eye separation. Keeps the world at true scale. Comfort = 1 × 1 × (1/25) × 0.5 = 0.02, well under 1, so no background divergence. |
| `parallaxFactor` | 1 | Full head-tracking response. |
| `metersToVirtual` | 1 | The world is authored in metres. |
| Vertical FOV | 55° | Depth budget falls with 1/tan(fov/2), so a narrower lens gives more depth. 55° is a compromise with the flight view. |
| `depthNear` / `depthFar` | 0.5 m / 4000 m | Session and eye clip planes. Far covers the peaks (2.6 km) and the sky dome (3.5 km). Set once, matching the eyes' `near`/`far`. |
| Fog | 120 m to 3200 m, colour = horizon | Distance cue. Far contrast fades into the horizon, which is rule 3 of the comfort guide. It also hides the terrain's 1.2 km edge. |
| Sky / clear / page | Gradient from #c6dbec to #3f72ad; page #1c1e23 | Nothing is pure black behind bright content. |
| Canvas `alpha` | false | A transparent canvas weaves black. |
| Backing store | 2 × eye width, device px (dpr ≤ 2) × `recommendedViewScale`, clamped to GL limits and panel width | Keeps the pair no wider than the panel (porting guide pitfall 26). The GL clamp avoids a silent browser clamp, which reads as a double image (woven-canvas rules §5). |
| `preserveDrawingBuffer` | true | Documented mitigation for the zero-copy read race on full-window tiles. Costs one extra copy per frame. |
| HUD | DOM chip, `data-inline3d-overlay`, translucent, inside the tile | Crisp 2D text. No `backdrop-filter`, no shadow or glow. Older browsers need the attribute. |

## Not verified, unsure

- **Nothing was run on a display or in a browser.** I checked the syntax of all three modules with Node, and
  checked the flight model, ring logic and terrain height with a scratch script (19 checks, all passing). The three.js
  scene code (`createWorld`, the renderer, the rig) has **not been executed**. Installing three.js into the
  sandbox was not approved. I checked those calls against the r161 API by reading.
- **Depth may still read flat on the panel.** At true 63 mm scale, hills several hundred metres away carry
  very little disparity by design (see porting guide pitfall 14). The plane and hoops carry the depth.
  `ipdFactor` above 1 is the first dial to try on hardware. Watch comfort (`ipd × m2v × D × 0.5`) if you do.
- **Terrain edge:** the 2.4 km terrain grid is rebuilt every 300 m of travel (a few ms each time). The seam at
  its edge (about 1.2 km) is hidden by fog and a ground plate, but I have not seen it.
- **Overlay on older browsers:** the HUD carries `data-inline3d-overlay`, not `handle.exclude()`, which is
  deprecated. On a browser without draw-order occlusion it should stay crisp, but check it on hardware.
- **`recommendedViewScale`:** applied as an advisory multiplier on the buffer, as the display-modes sample does.
  Not confirmed against real panel values.
- **Controls** are my choice: Up climbs, Down dives, Left/Right turn and bank. No touch input.
- **Cover:** released on `firstWoven`, with an 8 s fallback. Whether the raw side-by-side pair flashes
  before the join is only testable on hardware.
