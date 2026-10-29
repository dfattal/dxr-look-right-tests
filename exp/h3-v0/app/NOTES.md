# Ring Runner: notes

## What I used

- **SDK API:** `createInline3D({ lazy: false })`, then `wall.addScene(canvas, onXRFrame, { virtualDisplayHeight: 0.24 })`.
  - `handle.firstWoven` drives the cover (cut on settle).
  - `wall.on('trackingstatechange')` shows a hint when nobody is tracked.
- **Three.js glue:** `EyeCamera` (`setFromMatrices` from copied view matrices) and `EdgeFeather` (`px: 26`).
- **View rig:** the default **display rig**. I did not pass `viewRig`, so the runtime's defaults apply
  (`ipdFactor`, `parallaxFactor`, `perspectiveFactor` all 1).
- **Imports:** three.js `0.161.0` from jsdelivr, the same pin as `sdk/samples/hello-cube`. SDK modules come from `/sdk/js/`.

## Depth settings and why

All values are metres, with z = 0 on the glass and +z toward the viewer.

| Setting | Value | Why |
|---|---|---|
| `virtualDisplayHeight` | 0.24 | The scene's scale: addScene's default. The z = 0 plane spans 0.24 m vertically. |
| `VIEW_DIST` / `MONO_FOV` | 0.6 m / 22.6° | The runtime's nominal viewer distance. The mono camera uses `2·atan(0.12/0.6)`, so the flat fallback frames the same plane. |
| `PLANE_Z` | +0.03 | The plane pops 3 cm out of the glass, the main "in front" cue, while keeping disparity small. |
| `K_BACK` | 0.09 | The world recedes at most to z ≈ −0.06 (terrain horizon). Mountains are at −0.085 / −0.10 and the sky at −0.12. At ~0.1 m behind the glass a 63 mm eye gives roughly 9 mm (about 0.9°) of disparity, inside what a viewer can fuse. |
| `K_FRONT` | 0.03 | The nearest ground comes forward to about z = +0.06, roughly 7 mm of disparity. |
| `L_BACK` / `L_FRONT` | 0.2 m | Scales how fast depth saturates. Near ground spreads out and the horizon stacks at the limit. |
| Ring / hill / ridge z | within the band above | Everything sits inside about −0.12…+0.06. The rule behind it is disparity ≈ 63 mm × d / (0.6 + d), so depth past ~0.1 m double-images. |
| `EdgeFeather px` | 26 | Fades the scene edges into the page, as the hello-cube sample does. |
| Backing store | 2 eyes × eye width, 16:9 eyes | A 2:1 SBS buffer in a 16:9 CSS box. Eye width capped at 1600 px, DPR capped at 2, `pixelRatio` 1. |
| Parallax of ridges/clouds | 0.1 / 0.2 / 0.05 × plane x | Lateral only, in display metres. It is not added depth. |

Depth reasoning: the flight is a display-rig diorama. The plane is the subject the player turns, and the
world scrolls under it. The depth-of-world mapping `depthOf(dist)` folds the distance ahead into that band.

## Unsure

- **Rig choice.** The SDK doc lists "a game" under the camera rig. I chose the display rig because the plane is the subject the player turns, and a camera rig at flight scale gives shallow depth (the doc's own budget formula). The camera rig would need the attach pattern to avoid per-frame latency. If the panel looks flat, a camera rig with a fixed fly-camera is the alternative to try.
- **Depth amount.** The ±0.1 m band is conservative by the doc's formula, so it may read flatter than a larger budget. `K_BACK` and `K_FRONT` are the knobs to tune on hardware.
- **Not verified on hardware.** I could not run a browser or see the display. The page is only parse-checked. Three.js calls are not executed, and no weave or cover timing has been observed.
- **Horizon pop-in.** Rings fade in at about 1.3 m ahead and appear at the horizon band. This is untested on the panel.
- **Keyboard.** Arrow keys need page focus. Arrow keys call `preventDefault`, so the page does not scroll.
- **Collision.** Altitude is clamped to the ground. There is no crash state. Score is the only win condition.
- **No DepthCursor.** The page has no pointer interaction, so I did not add one. The HUD is plain DOM above the canvas, so no overlay exclusion is needed.
- **Mono fallback.** It runs the same scene at the same framing and skips the cover and firstWoven steps.
