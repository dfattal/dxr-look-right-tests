# Ring Run — notes

## What it uses

- **SDK:** `createInline3D({ lazy: false })`, then `wall.addScene(canvas, onXRFrame, { viewRig, onResize })`.
  Also `wall.session.updateRenderState({ depthNear, depthFar })`, `handle.firstWoven`, `handle.setViewRig`,
  `handle.setStereoEnabled` and the `renderingmodechange` event (the 2D/3D button). Mono fallback when
  `wall.supported` is false.
- **Rig:** a **camera rig**, because the player moves through a world. `cameraRigFromCamera(THREE, cam,
  { convergence, attach: true, ipdFactor, parallaxFactor })`. The chase camera is `cam` (in the scene). The
  eye cameras are `EyeCamera`s parented under `cam`, and each frame they use `setLocalFromMatrices` (the
  attach pattern, as in `samples/starter-world`).
- **Template:** `samples/starter-world` (rig, woven/mono loops, cover) and `samples/starter-ui` (slider and
  2D/3D switch).
- **Three.js:** 0.180.0 from the CDN, the version the SDK's templates pin.

## Depth settings and why

All depth figures are the SDK's `cameraRigDisparityPct` at FOV 60°, 16:9, `ipdFactor` 1.8. Nothing was measured
on a panel.

| Setting | Value | Why |
|---|---|---|
| Rig | camera, attach | The player flies through the world (§1). |
| `CONVERGENCE` | **14 m**, fixed | The nearest content touching a frame edge is the ground at the bottom edge, about 16.6 m away at minimum altitude. 14 m is a little nearer, so the bottom edge sits just behind the glass. It is never driven by input. |
| `IPD_MAX` | **1.8** × 63 mm | Gives the sky and mountains +0.40 % behind (the comfortable full-frame limit is 1.0 %). Rings are +0.34–0.37 %. The plane at 11 m is −0.11 % (just in front, mid-frame). At 1.0 the far background would be only +0.22 %, which gives noticeably less depth. |
| `parallaxFactor` | `k` (slider) | The slider moves both factors together, so look-around shrinks with the depth. |
| Slider `k` | 0–1, default 1 | Lowering it makes the scene shallower. It is the comfort dial for any viewer. |
| `CHASE_UP` / `CHASE_DIST` / `CHASE_PITCH` | 3.5 m / 11 m / −0.12 rad | Sets the bottom-edge ground distance (16.6 m at minimum altitude). The camera pitch is fixed, so the plane's dive does not change the frame's geometry. |
| `MIN_CLEAR` / `CEILING` | 8 m / 110 m | Keeps the camera at least 11.5 m above the ground. This is what holds the bottom-edge distance above. |
| `FOV` / aspect | 60° / 16:9 | The rig reads the FOV from the camera. The budget numbers assume 16:9 (the canvas CSS aspect). |
| `NEAR` / `FAR` | 0.3 m / 3000 m | Passed to `updateRenderState`. The sky dome (radius 1500 m) sits inside the far plane. |
| Sky dome | radius 1500 m, follows the camera | The sky is at infinity, so it has no parallax. Centring it on the camera makes both eyes see it at 1500 m, which is effectively infinity. |
| Fog | `HORIZON` colour, 300–1300 m | Dissolves the mountains (880–1000 m) into the horizon. Fog does not change disparity, but it softens distant high-contrast edges, which ghost most. |
| Rings | 110–230 m ahead, ±35 m lateral, ±12 m altitude | Keeps every ring behind the glass and inside the budget. Gold, not white, to limit ghosting. |
| Terrain / plane colours | mid-tones | No pure white or black edges, for the same reason. |

## Not verified / unsure

- **Nothing ran in a browser.** I checked that the module parses and that the SDK paths exist. The numbers are
  analytic (the SDK's own formula), not measured. Check the panel for double images, ghosting at the horizon, and
  the depth at the slider's top.
- **Hills.** The 14 m convergence assumes flat ground at the bottom edge. A hill rising into the lower frame
  could come out of the glass. That is the first thing to look at on the panel.
- **`IPD_MAX` = 1.8** is a judgement from the budget, not from a panel. If the far background looks strained,
  lower it. The slider also does this.
- **Lighting intensities and the plane model** are guesses, chosen to look reasonable. They do not affect depth.
- **Controls:** I made ↑ climb and ↓ dive, with ← → banking and turning. The arrow keys are the only input, as
  the task asked.
- **Ring collection** uses a plane-crossing test inside the ring's hole. I did not exercise it.
- **2D fallback** is written like the SDK's starter but has not been run in a plain browser.
- **The 2D/3D switch** uses the `starter-ui` calls, copied from the SDK, not tested against a panel.
