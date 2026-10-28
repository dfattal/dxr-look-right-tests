# Ring Flight — notes

Files: `index.html` (shell + HUD), `game.js` (everything else). three.js 0.161.0 from jsDelivr; SDK from `/sdk/js/`.
Untested on hardware (no browser available); syntax-checked only.

## SDK API and rig
- `createInline3D({ lazy:false })` → `wall.supported` gate → `wall.addScene(canvas, onFrame, { viewRig, onLayerLost, onResize })`.
- **Camera rig** (`cameraRigFromCamera`, `@displayxr/inline3d/three`), not a display rig: the player owns a viewpoint moving through a world.
- **Attach pattern**: `appCam` is in the scene, both `EyeCamera`s are parented to it, `attach:true` sends an identity pose, eyes use `setLocalFromMatrices` (from copied last-good matrices). Rig is pushed every frame, before the early-outs. Camera has no roll (level horizon).
- `renderer.setPixelRatio(1)`, double-width backing store while woven, per-eye viewport/scissor from `layer.getViewport`. Validate-before-clear, replay last good frame instead of skipping. Size writes are skipped when unchanged; `onResize` resizes and redraws immediately. Backing store clamped to GL limits and ~10 Mpx.
- 2D fallback: plain `appCam` render in a rAF loop; same game code.
- Cover div over the canvas, removed on `handle.firstWoven` (hard cut, not marked as overlay). HUD boxes are small partial regions with `data-inline3d-overlay`, plain translucent backgrounds, no `backdrop-filter`; no CSS effects on the canvas or its ancestors.

## Depth settings (world units ≈ metres; plane is 2.5 wide)
- `FOV 50°`, `near 0.6`, `far 3200`; `session.updateRenderState({depthNear, depthFar})` set to match (the runtime builds projections from these).
- `convergence 5.5` = camera→plane distance, **fixed** (the camera is always 5 behind/1.2 above the plane). The plane and the HUD therefore sit on the glass; hills, mountains and sky recede behind it; the approaching rings emerge from behind the glass and cross it at the plane. A constant avoids depth "breathing" as terrain changes.
- `metersToVirtual 4`, `ipdFactor 1` (absolute on a camera rig): eye baseline 0.25 world units. At the world's scale (hills 30–60 units away, a 5-unit chase distance) a baseline of 0.063 gives almost no disparity; 4× gives clear depth to ~100–400 units without much pop-out. Comfort = 1·4·(1/5.5)·0.5 = 0.36 ≤ 1, so infinity (mountains, sky) has finite, non-diverging disparity (~2.5–3% of screen width at most).
- Nothing is closer than ~3 units to the camera except a collected ring, which is hidden within 0.18 s before the camera reaches it (avoids huge near-disparity).
- Background (sky sphere, haze floor, two mountain rings at r=1000/1650) is centred on the camera: effectively at infinity, no parallax drift. Mountains are hazed toward the horizon colour (aerial perspective) and use `fog:false`; terrain fog 140→420 hides chunk pop-in (terrain radius ≈ 448).
- Depth cues added deliberately: trees, per-vertex tone patches, opaque clouds at 55–165 m altitude spread across distances, a blob shadow under the plane. No post effects, no transparent sorted geometry other than the faint shadow, no HUD in the canvas (DOM text stays crisp).
- Head-tracking `parallaxFactor` left at default.

## Unsure about
- Whether `metersToVirtual 4` is the right strength on the real panel; it's the one knob to tune (`M2V` in `game.js`; 3 is gentler, 5 stronger — keep `M2V/CONVERGENCE·0.5 ≤ 1`).
- Whether `metersToVirtual` is applied as "world units per metre" exactly as I read the docs ("metres → world units on the eye").
- Thin ring tubes (0.38 radius) and flat-shaded mountain edges may shimmer slightly; MSAA is on.
- Pointing the canvas full-viewport means a window resize triggers a re-join gap; I only redraw immediately, no cover.
- `/sdk/js/inline3d-three.js` and `three/addons` import via import map; `three@0.161.0` was taken from the SDK's own sample.
