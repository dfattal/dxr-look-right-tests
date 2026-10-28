# Globe — notes

Files: `index.html` (layout, import map), `app.js` (scene, SDK, interaction), `earth.js` (procedural Earth textures).
Not run in a browser or on hardware; JS syntax-checked only.

## SDK / rig
- `createInline3D({lazy:false})` → `wall.addScene(canvas, onFrame, {viewRig: displayRig({virtualDisplayHeight: 0.24}), onLayerLost, onResize})`, three.js with `EyeCamera` + `EdgeFeather` from `/sdk/js/inline3d-three.js`.
- **Display rig, not camera rig**: the user turns a subject, so the globe is rotated under a fixed portal. Depth is then independent of the globe's size in world units.
- Not supported / throws → mono fallback (plain perspective camera matching the same 0.24 m portal, 1:1 buffer). `onLayerLost` also drops to mono.

## Depth settings
- `virtualDisplayHeight = 0.24` m (SDK default, the zoom knob). Globe radius 0.08 m ≈ 67% of the window height.
- Globe centre at `z = -0.03`: front surface +0.05 m out of the glass, back −0.11 m behind it. It straddles the glass, so pop-out stays modest and nothing sits at the divergence limit. (+z is toward the viewer.) Pins add 0.012 m, so tips reach ≈ +0.062.
- Stars (decorative) at `z = -0.12 … -0.26`, behind the globe, as a far depth reference. Static, tiny points.
- `ipdFactor`, `parallaxFactor`, `perspectiveFactor` left at 1 (full natural stereo and look-around). I did not lower them; the budget above should be comfortable, but I couldn't check on hardware.
- `updateRenderState({depthNear: 0.05, depthFar: 5})`: tight range for depth precision; eyes are ~0.6 m away and the scene spans −0.26…+0.06.
- Texture detail for stereo matching: graticule every 30°, ocean ripple noise, land mottling and a bump map. Plain smooth ocean gives the eyes nothing to fuse.
- Light: fixed directional + hemisphere (not tied to the eye) so shading is identical in both eyes. No view-dependent glow or atmosphere shell (silhouette halos have ambiguous depth).
- Buffer is 2× width SBS, `setPixelRatio(1)`, dpr capped at 2, clamped to GL max texture size; resizes handled in `onResize` with an immediate redraw. Frames with <2 views or null viewports repaint the last good eye matrices (copies) instead of clearing.
- Canvas is transparent with per-eye `EdgeFeather` (40 px) and has no CSS border/radius/filter/background. The page background sits behind it. An opaque cover sits above the canvas until `handle.firstWoven` resolves, then is removed (hard cut).

## Interaction and UI
- Drag to rotate (with inertia, pitch clamped ±63°); idle turntable stops after any interaction or selection. Clicking a city (marker or sidebar button) eases the globe to face it.
- Picking: each marker's screen position is the mean of its projection in the left and right eye (the cyclopean view), compared to the pointer within 26 css px; back-facing markers are ignored. This is what a flat pointer on the glass lines up with for a pin that pops out. All info (name, population) is in the HTML sidebar panel, outside the canvas rect, with solid backgrounds and no `backdrop-filter`. A small tooltip with the hovered name follows the pointer.
- No floating labels over the globe: flat text on the glass would conflict with pins that stand in front of it.

## Unsure
- Overall look (continent outlines are hand-made coarse polygons; colours, bump strength, 0.08 m radius, pop-out amount) was never seen on a display. If pop-out feels strong, lower `GLOBE_Z` magnitude's front reach by moving the globe back (e.g. −0.04) or shrink `R`.
- Pointer-on-glass vs. a pin that appears in front of the glass: cyclopean picking is an approximation; the SDK's `DepthCursor` (`?cursor=depth` in the hello-cube sample) was not used.
- Populations are approximate city-proper figures (London 8.98M, Tokyo 13.96M, New York 8.26M, Sydney 5.31M, Nairobi 4.40M), rounded from memory.
- Three.js pinned to 0.161.0 from jsDelivr, the version the SDK samples use.
