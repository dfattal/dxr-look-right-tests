# Notes

**API:** `createInline3D({lazy:false})` + `wall.addScene(canvas, onFrame, {virtualDisplayHeight})`; per-eye render of `views` into `layer.getViewport(view)` (pattern from `samples/hello-cube`). **Rig:** default *display rig* (a tabletop scene framing a subject; nothing is walked through). Mono camera + rAF loop when `wall.supported` is false or setup throws.

**Depth settings and why**
- `virtualDisplayHeight: 0.12`: scene authored in metres for a 12 cm display (as in hello-cube); sun at z=0 (on the glass), orbits ≤ 7.6 cm radius.
- Orbital plane tilted 0.42 rad about X: near side pops out ≤ ~3 cm, far side recedes ~3 cm. Modest spread centred on the glass; no pushback/shrinking.
- Starfield at z = −5…−11 cm, dim (0.35–0.8) 2.5 px points; field wider than the window so parallax never exposes an edge. Deep enough to separate from planets, shallow enough to fuse.
- Background `#15171d` dark grey (never pure black) in scene and in the page/CSS under the canvas; orbit rings dim grey to avoid shimmering high-contrast lines.
- Default ipd/parallax/perspective factors untouched; no convergence setting (display rig).
- `setPixelRatio(1)`; backing store is 2× width × dpr in 3D mode (1:1 in mono). Canvas CSS is bare (no filter/radius/shadow/opacity); UI is plain HTML outside the canvas.
- Cover over the canvas is removed on `firstWoven`, on error, or after 4 s.

**Unsure:** tilt and star depth comfort could not be checked on hardware; `EdgeFeather` not used (opaque matching background instead); sun glow sprite is billboarded per eye (small, soft); `handle.firstWoven` assumed present per docs. three.js 0.161.0 from jsDelivr (untested here, no browser).
