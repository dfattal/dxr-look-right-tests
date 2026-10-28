# Notes — first-person room walk-through

**API / rig:** `createInline3D({lazy:false})` → `wall.addScene(canvas, onFrame, {viewRig, onResize})` with a
**camera rig** (`cameraRigFromCamera(THREE, cam, {convergence, attach:true, ipdFactor, parallaxFactor})`) and
`EyeCamera` per eye parented under the app camera (attach pattern). Chosen because the visitor moves *through*
a world. Structure adapted from `sdk/samples/starter-world`. Mono fallback: same camera drawn once.

**Depth settings and why**
- `convergence` = 0.9·EYE_H / tan(fov/2) ≈ 2.49 m, **fixed and finite**: the floor at the bottom edge is the nearest
  edge-touching content, so the room sits just behind the glass (view through a window). Never gaze-driven, never 0.
- `ipdFactor = parallaxFactor = k` (slider, 0–1, default 1; absolute on a camera rig, 1 = tuned value). Moved together.
  2D/3D button uses `setStereoEnabled`, falling back to depth 0.
- Closed room: the window looks at a painted backdrop 1.4 m outside the wall, so no content at infinity
  (far wall 8–9 m gives ≈0.9 % of width behind the glass by the guide's formula; budget ≤ 1.0 %).
- Furniture in the centre at the start is ≥ 2 m away; collision padding keeps the visitor ≥ 0.25 m from solids,
  but walking close to a table will still push things in front of the glass (inherent to a walk-through).
- FOV 60°, near 0.05 / far 30 (also passed via `updateRenderState`). Procedural, irregular textures (detail helps fusion).
- Opaque clear, pixel ratio 1, canvas 2× wide only when woven, sized before registration and then only in `onResize`;
  last good frame replayed on short view lists; cover removed in one step after `firstWoven`.
- HUD at the top; controls are HTML below the canvas; no filter/opacity/transform on or over the canvas.

**Unsure / untested:** nothing was run (no browser, no display) — numbers are from the SDK docs, not measured.
Pointer-lock look is extra to the starter's drag-look; its interaction with the woven canvas is untested.
Walking close to furniture or walls exceeds the "in front of glass" budget at the frame edges (floor nearer than
convergence when looking down); the Depth slider is the user's remedy.
