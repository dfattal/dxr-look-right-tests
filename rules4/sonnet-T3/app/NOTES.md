# Room walk-through — notes

Files: `index.html`, `app.js`. three.js 0.161.0 from jsDelivr; SDK from `/sdk/js/` via import map.
I could not run a browser or the display, so none of this is tested. I only syntax-checked `app.js`.

## SDK API and rig
- `createInline3D({ lazy: false })`, then `wall.addScene(canvas, onFrame, opts)`. The `onFrame` callback draws one eye per viewport from `layer.getViewport(view)`.
- **Camera rig**, because this is a first-person walk-through (the viewer owns a viewpoint that moves through a world). I used `cameraRigFromCamera(THREE, appCam, { convergence, attach: true, ipdFactor })`, sent via `viewRig` at `addScene` and then `handle.setViewRig` every frame.
- The attach pattern: `appCam` is in the scene, two `EyeCamera`s are parented under it, and each eye uses `setLocalFromView`. This avoids the one-frame stereo lag when the camera moves.
- I follow the porting doc's loop. It validates views and viewports before `clear()`, and replays the last good frame (using copied matrices) instead of skipping a frame.
- `renderer.setPixelRatio(1)`. The backing store is 2× width while woven and 1:1 in mono. `setSize` is only called when the size changed.
- `session.updateRenderState({ depthNear, depthFar })` matches `appCam` (0.1 / 40).
- The 2D fallback renders `appCam` on a plain rAF loop. Mouse look and WASD work there too.

## Depth settings and why
- **convergence = 2.5 m, fixed.** Rule: never drive it from the gaze. 2.5 m puts the table and mid-room on the glass, with the near furniture in front and the window and walls behind. It is well past the 0.5 m comfort limit.
- **ipdFactor = 0.8** (absolute on a camera rig). This slightly reduces disparity so close furniture and the far window stay fusible. It is a comfort choice and I could not judge it on the panel.
- **metersToVirtual** is left at 1 because the scene is authored in metres.
- **FOV 58° vertical.** A narrower FOV increases the depth budget, and this is a compromise with walking comfort.
- **Keep-out distance 0.5 m** from walls and furniture, plus near plane 0.1 m. Surfaces cannot get so close that disparity becomes extreme. Motion is eased with no head bob, so depth does not jolt or swim.
- **Background and clear colour are dark grey `#23262e`, not black.** The page is the same grey. The outdoor view is soft mid-tone (sky, hills, simple trees) rather than a bright high-contrast sky next to dark detail.
- No pure white fine detail far away. Textures are low-contrast and mipmapped with anisotropy.
- Shadows are baked once (`shadowMap.autoUpdate = false`), so they are identical in both eyes and cost nothing per frame.
- No DOM crosshair, because a zero-disparity overlay would fight nearer objects.

## Page and weave rules followed
- The canvas is full-window, with no border, radius, filter, opacity or background, on it or any ancestor. It has `will-change: transform`.
- The SBS backing store is capped at 4096 px wide.
- An opaque cover sits on top of the canvas until `handle.firstWoven`. It also comes off after 5 s and if setup throws, and it is a hard cut.
- The HUD panels use a plain translucent tint (no `backdrop-filter`), are smaller than the canvas, and carry `data-inline3d-overlay`. The hint hides while the pointer is locked.
- There is one `createInline3D` per document, and the canvas is never remounted.

## Unsure about
- Whether `ipdFactor` 0.8 and convergence 2.5 m are ideal on the real panel. These are the first things to tune.
- `preserveDrawingBuffer: true` is on as a defensive choice from the docs (older browser builds can race the weave's read). I don't know if it's needed, and it costs a little performance.
- `onLayerLost` falls back to mono by resizing the buffer to 1:1. This path is untested.
- The cover is not re-raised on window resize (rule 11). A resize may briefly show a raw SBS pair on some browser builds.
- Pointer lock `movementX` is used for look. Without lock, dragging on the canvas also works.
- Procedural textures are generated at load, so the first frame can take a moment.
