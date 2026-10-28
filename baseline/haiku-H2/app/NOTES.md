# Aquarium — notes

## SDK API and view rig

- `createInline3D({ lazy: false })` once per document, then `wall.addScene(canvas, onFrame, …)`.
- **Display rig**, via `displayRig()` from `@displayxr/inline3d/three` and passed as `viewRig`.
  The viewer never moves, and the tank is a fixed subject seen through a portal. A camera rig
  would add nothing here and would bring back the depth-budget trap in the authoring guide.
- Each eye: `EyeCamera.setFromView(view)` and `renderer.render`, with `pixelRatio` 1.
- Backing store is 2:1 SBS while woven, sized by the page (`bufferClamped: true`).
- `handle.firstWoven` drops the cover. `onResize` resizes and replays the last good pair.
  `onLayerLost` falls back to a mono render.

## Depth settings and why

| Setting | Value | Why |
|---|---|---|
| `virtualDisplayHeight` (in `displayRig`) | 0.24 m | Scale: the z=0 plane is a 24 cm display. The 16:10 window is about 38 × 24 cm, and the 30 × 17 cm tank fills most of it with a margin of about 3–4 cm on each side. |
| `ipdFactor` | 1 | The runtime's own depth. Content is shallow in absolute terms, so no comfort reduction was needed. Lower it toward ~0.7 if viewing strains. |
| `parallaxFactor` | 1 | Keeps the head look-around, which is the strongest depth cue for a tank. |
| `perspectiveFactor` | 1 | An effect, not a correction; left at its default. |
| Tank front glass and frame | z = 0 (frame front ≈ +3 mm) | The sharpest plane is the one the eye reads as the window edge. |
| `TANK.d` (back wall depth) | 0.07 m | The back wall sits about 0.6° of disparity behind the glass at a 0.6 m viewer (63 mm IPD over 7 cm). That stays under about 1°. |
| Fish centre extent | from about −0.040 to +0.003 m | Only a few millimetres come forward of the glass. This avoids crosstalk on high-contrast fish and avoids a pop-out that strains the eyes. |
| Rocks and plants | inside the tank depth | No geometry passes through the back wall or the glass. |
| `updateRenderState` clip planes | near 0.1, far 3 | All content is between about 0.53 and 0.67 m from the eye, so these leave wide margin without clipping. |
| Mono fallback FOV | 22.6° at 0.6 m | Makes the flat view show the same 24 cm height at z=0 as the woven view. |

## Other choices

- The canvas has no border, radius, shadow, opacity or filter on it or its ancestors. Its
  background matches the page, so there is no hard rectangle.
- The cover sits over the canvas until `firstWoven` resolves, then drops as a hard cut.
- Frames are validated before `clear()`. Invalid frames replay copies of the last good matrices.
- Resize compares before setting the store size, because `setSize` clears even for the same value.
- Store size is capped at 1280×800 per eye and clamped to GL limits, so the page never relies on
  the browser to clamp it.
- three is pinned to 0.161.0, the version the SDK's own samples use.

## Unsure or not verified

- Not run in a browser and not seen on the display. Syntax was checked with `node --check` only.
  Depth amount, fish legibility at 3 cm, and the tank's size in the window all need a look on
  hardware.
- The clip-plane values and the claim that `displayRig` at identity factors matches the default
  rig are from reading the SDK, not from testing.
- I assumed `layer.getViewport()` splits `canvas.width` exactly in half, as the SDK docs say.
- Imports are static. If the three CDN fails, the whole module fails and there is no mono
  fallback. Porting pitfall 25 suggests a dynamic import of the SDK in a try/catch.
- `updateRenderState` is a native `XRSession` method. It is wrapped in try/catch because older
  browsers may not support it.
