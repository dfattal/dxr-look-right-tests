# 3D sales chart — notes

**SDK / rig:** `createInline3D({lazy:false, autoChrome:false})` → `wall.addScene(canvas, onFrame, {viewRig})` with a
**display rig** (`displayRig()` from `@displayxr/inline3d/three`). The viewer turns the *subject* (dragging rotates the
chart group), so no camera rig. three.js 0.161.0 via CDN import map; SDK from `/sdk/js/`. When `wall.supported` is
false it renders a mono camera (with idle sway); the slider and 2D button are disabled there.

**Depth settings and why**
- `virtualDisplayHeight = 0.18 m`: chart authored in metres (~0.22 m wide) so it fills most of the window while its
  total depth stays about ±6 cm around z=0, a modest slice of the virtual display, so nothing pops far out.
- Chart centred on z=0 (zero-disparity plane): front row slightly out, back wall behind. Not pushed fully in front.
- Chart tilted (pitch −0.35, yaw −0.2 rad) via the group, so floor and row spacing show depth. Drag rotates it.
- Regions in depth rows (North back, West front) so the tallest bars never hide the others.
- "3D strength" 0–100% sets `ipdFactor` and `parallaxFactor` together (display rig, relative [0,1]) via
  `handle.setViewRig`, also passed as the initial `viewRig`. 0 = mono. Default 100% (natural). It lands one frame late
  (SDK behaviour).
- 2D button: `wall.setStereoEnabled(false/true)` (real 1-view mode; the SDK zeroes the rig and restores it). If that
  rejects, the page flattens the rig itself (ipd/parallax 0). The slider is disabled while in 2D.
- Opaque scene background equal to the page background (transparent woven canvases come out black). No CSS effects on
  the canvas. Title, legend and controls are plain HTML outside the tile (no backdrop-filter, no overlap).
- Backing store is 2× width (L|R), pixelRatio 1, clamped to ≤4096; a resize repaints the last good frame at once.
- Woven-canvas rules: canvas sized and `will-change` set before `addScene`, 2-frame wait, opaque cover removed
  (hard cut) on `handle.firstWoven`; one session; canvas never remounted.
- Labels are canvas-texture sprites inside the scene, so they sit at the data's depth and stay crisp (mipmapped).

**Unsure about:** I couldn't run any of this. Comfort of ±6 cm depth on real hardware, whether the
`hardwaredisplaystatechange` handler (which reads `wall.hardwareDisplayState`) behaves as intended, and how sprite
billboarding looks per eye.
