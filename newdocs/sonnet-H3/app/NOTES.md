# Ring Runner — notes

Files: `index.html`, `game.js` (three.js 0.180.0 from jsDelivr; SDK from `/sdk/js/` via import map).

## SDK API and rig
- `createInline3D({ lazy: false })` → `wall.addScene(canvas, onFrame, { viewRig, onResize })`, one canvas, one session.
- **Camera rig** (the player moves through a world): `cameraRigFromCamera(THREE, cam, { convergence, attach: true, … })` + `EyeCamera` x2 parented under the chase camera (the attach pattern from `samples/starter-world`). Draw loop copied from that sample: views validated before clearing, last good frame replayed, each eye in its own `layer.getViewport`.
- Opaque clear, pixel ratio 1, canvas sized before registering and afterwards only in `onResize`, `updateRenderState({ depthNear, depthFar })` = camera near/far (0.5 / 1200).
- Cover over the canvas until `handle.firstWoven`, removed in one step. HUD is HTML at the top over sky (behind the glass), plain `rgba()` background, no filter/opacity/transform on or over the canvas.
- Ordinary browser: `supported === false` → same camera drawn once, depth controls disabled with a note.

## Depth settings (all in `game.js`)
- `CONVERGENCE = 14` world units, fixed and finite. Nearest edge-touching content is the ground/treetops at the bottom edge (≥ ~30 units away given the chase camera is ≥ ~18 above ground, looking ~7° down), so the world sits behind the glass. Not gaze-driven, not 0.
- `metersToVirtual = 3.7`, `ipdFactor = 1`: baseline 0.233 units. Chosen so infinity (sky/mountains) lands at ≈ +1.0 % of width (`100·b/D/1.658`, fov 50°, 16:9) — the full-frame "behind" limit. Ground ≈ +0.4 %.
- Chase distance 12 behind the plane: the plane is ≈ −0.19 % (barely in front, centre of frame, a subject). Rings are removed 3 units behind the plane (≈ −0.5 % at worst, centre) so nothing flies up to the camera.
- Minimum clearance over terrain (16 ahead-looking, hard floor 12) keeps ground away from the camera, so nothing near the bottom edge pops out of the glass.
- Fog 80–220 plus haze-coloured sky bottom, horizon disc and mountain bases: the far field is low contrast (far disparity ghosts less) and the world is closed (no window onto a hard edge). Mountains (r 540/760) and sky (r 900) follow the camera in x/z so they behave as infinity.
- Fine speckle texture + vertex-colour variation + instanced trees: stereo needs detail to fuse.
- Depth slider sets `ipdFactor` and `parallaxFactor` together (absolute on a camera rig; 1 = tuned maximum). 2D/3D button uses `setStereoEnabled`, falling back to slider 0.
- Camera roll is only 30 % of the plane's bank; the camera lag is stiff (rate 7) so the chase distance, hence disparity of the plane, barely changes.

## Unsure / untested
- Not run in a browser or on a panel: all disparity numbers are from the guide's formula, not measured.
- Whether the terrain re-sample (every 20 units ≈ 0.7 s, ~9k vertices + ~1.5k trees) causes a visible hitch on slow GPUs; if so, spread it over frames.
- Aggressive climbing/diving makes the camera look more steeply down; ground at the bottom edge could briefly come closer than 14 on steep hill faces.
- `renderingmodechange` / `setStereoEnabled` usage copied from `samples/starter-ui`; not exercised.
