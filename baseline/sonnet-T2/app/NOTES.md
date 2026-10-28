# Notes

**API / rig:** `createInline3D({lazy:false})` + `wall.addScene(canvas, onFrame, {virtualDisplayHeight, onResize, onLayerLost})`, with `EyeCamera` and `EdgeFeather` from `/sdk/js/inline3d-three.js`. It uses the default **display rig**: the canvas is a portal and the user looks at the scene, not through a moving camera. three.js is pinned at 0.161.0 (the same version as the SDK's hello-cube sample). Without 3D support (`wall.supported` false) the page renders a mono camera with pointer-driven parallax.

**Depth settings and why**
- `virtualDisplayHeight = 0.12` m: the zoom knob. The scene is authored in metres for a 12 cm display. The sun, planets and orbits fill the 16:9 window at that setting.
- Orbit plane tilted 0.95 rad toward the viewer, with elliptical orbits. This gives a tabletop look while keeping depth modest: planets span roughly z = -0.035..+0.035 m. The sun is at z = 0, on the glass.
- Starfield is a bounded slab at z = -0.05..-0.085 m, not at infinity. Far content can't demand diverging eyes, and the gap behind the orbits stays comfortable. The slab is oversized (0.5 × 0.3 m) so look-around never exposes an edge.
- Stars are soft round sprites of at least 3 css px (×dpr). 1-px specks shimmer and fuse badly between eyes. Stars are static, so there's no rivalry from moving points.
- No `ipd`, `parallax` or `perspective` overrides: defaults (1) keep the runtime's natural depth.
- Edge feather (28 px per eye) over a transparent alpha canvas. The dark backdrop is on the `.stage` element *under* the canvas, and the canvas has no CSS effects.
- Backing store is 2× width (dpr capped at 2), pixelRatio is 1, and the buffer is only resized when its size changes.
- Per woven-canvas rules: `will-change: transform` from first paint, a 2:1 store and two frames before `addScene`, and an opaque cover held until `handle.firstWoven`, then cut. The frame is validated before clearing, and the last good frame is repainted from copied matrices when the view list is short.
- UI (title, controls, legend) is HTML outside the canvas, so it is crisp and nothing sits over the weave.

**Unsure / untested** (not run in a browser or on a 3D display)
- Whether the depth looks right: the z extents were chosen from the docs' scale, not from seeing it. If it's too deep or too flat, scale the z positions or tune `VDH` (smaller = bigger objects).
- Light intensity (PointLight 5, decay 0, ambient 1.2, ACES tone mapping) is a guess and may need tuning.
- The sun glow is a camera-facing sprite, which is slightly different per eye. It is small and centred on the glass, so it should be harmless.
- The sun/planet/star counts and sizes are untuned for performance on the panel.
