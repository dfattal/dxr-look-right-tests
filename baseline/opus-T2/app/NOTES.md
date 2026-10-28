# Orrery: notes

Files: `index.html` (page, import map, CSS) and `app.js` (scene and SDK wiring). three.js is
`three@0.180.0` from jsDelivr, the same pin the SDK's newer samples use. The SDK is loaded from
`/sdk/js/…`. All textures are generated in code, so there are no asset files.

## SDK API and view rig
- `createInline3D({ lazy:false })` → `wall.addScene(canvas, viewer.onFrame, { virtualDisplayHeight, onLayerLost })`.
- **Display rig** (the default). The canvas is a portal and the runtime places the eyes. The docs
  say a framed subject belongs on a display rig, even one the user turns. A tabletop diorama is
  that kind of subject, so the drag rotates the system and never moves a camera.
- `SceneViewer` (`/viewer`, an experimental subpath) with `EyeCamera` + `EdgeFeather` (`/three`) runs
  the per-eye loop. It checks each frame before clearing and replays the last good frame when one
  fails. It also handles the 2:1 backing store, `pixelRatio 1`, resizes that don't clear the
  buffer, the tracking ease and the 2D (`startMono`) path. I used `fit:'none'` and
  `orbit:false` and wrote my own drag, because the depth budget is set by hand (below) and
  wheel-zoom would scale the depth along with the size.
- Woven-canvas rules I followed: `will-change: transform` in CSS, and a bare canvas (no
  border/radius/filter). The 2:1 store is committed, then the page waits two frames before
  `addScene`. An opaque cover sits on top until `handle.firstWoven` and is removed with a hard cut.
  The dark page background sits behind the canvas. All UI is DOM outside the woven rect, so it is
  crisp, flat and needs no overlay rules. Nothing uses `backdrop-filter`.
- In a normal browser: `wall.supported === false` → `viewer.startMono()`. If the SDK modules fail
  to import, a plain three.js mono loop (`bootPlain`) draws the same scene.

## Depth settings (display metres; z=0 is the glass, +z comes out toward the viewer)
| setting | value | why |
|---|---|---|
| `virtualDisplayHeight` | 0.24 | SDK default. The whole scene is authored against it. |
| orbit radii | 0.040–0.104 (Rmax with planet ≈ 0.111) | Sized by the depth budget, not by the tile width. The system fills about half the 16:9 width and the starfield fills the rest. |
| pitch | 62° (drag limited to 56–76°) | Looking down at the plane squeezes a 0.22 m disc to about ±0.052 m of depth (R·cos pitch). At 56° the far edge still stays in front of the stars. |
| `depthOffset` | −0.008 | Sinks the system a little. Front ≈ +0.044, back ≈ −0.060, so slightly more sits behind the glass than in front. That leaves less pop-out near the bottom edge of the frame, where the near side of the orbits is. |
| sun | centred at z≈−0.008 | The brightest, highest-contrast object sits on the glass, where crosstalk is lowest. |
| starfield | z ∈ [−0.095, −0.072] | A shallow shell just behind the outer orbit. It reads as "behind" and has some parallax between layers. I kept it shallow on purpose: small bright points on black ghost the most on a lenticular panel. Star brightness is capped and sizes are 1.6–3.6 px × (buffer height / 950), so no star is a single pixel. |
| nebula | z = −0.10, low contrast, low frequency | Gives the backdrop body without adding high-contrast detail that would ghost. |
| `ipdFactor` / `parallaxFactor` / `perspectiveFactor` | not set (1) | I kept depth under control with geometry instead of turning down the eye separation. |
| `feather` | 28 buffer px | Fades each eye's edges, which softens window-edge violations from stars and orbits cut by the frame. |
| `renderScale` | `clamp(screen.width / (2·canvas width), 0.6, 1)` | Keeps the side-by-side buffer no wider than the panel, and never drops below 0.6, where the interlace starts to show. |
| `depthNear/Far` | 0.05 / 10 | Tighter than the WebXR defaults, for better depth precision. Eyes are about 1 virtual metre away and the content is about 0.2 m deep. |

Total depth is about 0.155 m virtual (≈0.65·VH). With a canvas about 15 cm tall on a laptop
panel, m2v ≈ 1.6, which works out to roughly +2.7 cm in front of and −6 cm behind the glass
physically.

## Unsure about
- The comfort limits for this specific panel. I picked the numbers from SDK conventions (the
  hello-cube sample and SceneViewer framing allow about ±0.4·VH) plus general lenticular
  experience. I could not check them on hardware. If stars double, move `STAR_Z` closer to −0.07.
  If the scene looks flat, lower `PITCH_DEG` or the depth offset.
- `SceneViewer` is experimental (no semver promise).
- Twinkle, the sun halo sprites and the nebula are untested on the panel. The halo sprites are
  billboards drawn per eye, so they appear at the sun's depth.
- The 0.6 m nominal viewing distance used for the physical estimates comes from the docs. The real
  canvas size, and with it m2v, depends on the user's window.
