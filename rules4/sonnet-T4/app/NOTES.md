# Notes — 3D quarterly sales chart

**SDK:** `createInline3D({lazy:false})` → `wall.addScene(canvas, onFrame, { viewRig })`, three.js 0.161 (CDN) with `EyeCamera`, `EdgeFeather`, `displayRig` from `/sdk/js/inline3d-three.js`. Stereo render loop: one viewport per eye from `layer.getViewport`, validated before `clear()`, last good matrices replayed on a short/failed frame.

**View rig:** *display rig* (user turns the subject, not a viewpoint). Chart is a group rotated under a fixed portal (drag = yaw, clamped ±1 rad).

**Depth settings and why**
- `virtualDisplayHeight = 0.20 m`: chart (~0.22 m wide, ~0.12 m tall) fills most of the window; the SDK scales eyes, no app-side scaling.
- Chart centred on z=0 (glass) and not pushed back/flattened, so disparity spread is minimal (rule 1). Rows are only 3 deep (0.034 m apart), initial yaw −0.45 rad / pitch 0.32 rad so rows read as depth without large pop-out.
- Slider "3D strength" 0–100 % (default 100 %) → `ipdFactor` and `parallaxFactor` (relative [0,1]) via `handle.setViewRig(displayRig(...))`. 0 % = mono. `perspectiveFactor` left at 1.
- 2D/3D button: `handle.setStereoEnabled(false/true)` (real 1-view hardware mode; the SDK zeroes the rig itself and restores it). Also pushes a flat rig (strength 0) as a fallback if the request is refused; slider is disabled in 2D.
- Backing store is 2× width (SBS), `setPixelRatio(1)`, dpr capped at 2; resized only when dimensions change, in-frame, so no black frame.
- Backgrounds are dark grey (#262a33), never black. Canvas is alpha with per-eye `EdgeFeather` (24 px), no CSS on the canvas. Bright bars sit on a grey slab.
- Title, legend, controls are HTML outside the canvas rectangle (crisp 2D); in-scene labels (values, Q1–Q4, axis) are high-res canvas textures.
- Cover over the canvas dropped on `firstWoven`, on error, or after 4 s.

**Fallback:** no inline-3D → single mono camera; mouse-driven sway amplitude is scaled by the slider; button toggles it.

**Unsure / untested** (no browser or display available): exact visual balance of chart size vs. depth on hardware; whether `setStereoEnabled` is accepted on every panel (handled by catch); in-scene text legibility at distance from the glass; default strength 100 % may want to be lowered if bars popping out feel strong. The page was only syntax-checked, not run.
