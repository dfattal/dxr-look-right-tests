# Aquarium — notes

**Files:** `index.html` (page, import map), `app.js` (scene). three.js 0.161.0 from jsDelivr; SDK from `/sdk/js/`.

## SDK / rig
- `createInline3D({ lazy: false })` once, then `wall.addScene(canvas, onFrame, { virtualDisplayHeight: 0.24, onResize })`.
- **Display rig** (default; `virtualDisplayHeight`, no `setViewRig`). The user turns a subject (the tank), so per the SDK guidance that is a display-rig case, not a camera rig.
- Eyes rendered with `EyeCamera.setFromMatrices` from copies of each view's matrices, into `layer.getViewport(view)`.
- Not 3D (`supported:false`, or setup throws): plain mono `PerspectiveCamera` (30° FOV, placed so 0.24 m is visible at z=0, same framing as the rig), full-canvas 1:1 buffer.

## Depth-related settings and why
- **Tank centred on the glass (z=0)**, 0.30 × 0.16 × 0.16 m, so front glass is ~8 cm out and back wall ~8 cm in. Small, balanced disparity range. No push-back/shrink (SDK rule 1).
- **virtualDisplayHeight 0.24 (default).** The tank fills about two thirds of the window height; the default keeps the standard depth scaling.
- **ipdFactor / parallaxFactor / perspectiveFactor left at defaults** (no hand-tuned depth).
- **Background `#1c1f26` dark grey, page too** — never pure black (crosstalk). Canvas is opaque, no alpha, no EdgeFeather (a transparent canvas weaves black).
- **Tank pitched 0.2 rad** toward the viewer so the sand floor is visible, plus gentle idle yaw ±0.08 rad; drag limits yaw ±0.7, pitch 0.05–0.5. Rotation is of the subject, not a camera.
- **Glass panes: opacity 0.07, depthWrite off**, so fish behind glass don't get ghost doubles; the bright rails on the tank edges give crisp depth cues. Bubbles and the water surface are also transparent with depthWrite off.
- Fish stay ≥ ~2 cm away from the glass so nothing sits right on the front pane at high contrast.
- **Buffer:** `pixelRatio` 1, store sized by hand: 2× CSS width × CSS height in device px (dpr capped at 2, total width ≤ 4096) while woven; 1:1 in mono. Resize repaints immediately in `onResize` and skips no-op size writes.
- **Frame gate:** views/viewports validated before `clear()`; on a bad frame the last good frame is replayed. `preserveDrawingBuffer: true` (SDK advice for large scene canvases on older browsers).
- **Cover** over the canvas (opaque, same colour, on top) removed on `handle.firstWoven`, and also after a 5 s timeout, and on any setup failure or in 2D.
- Canvas and ancestors have no filter/opacity/radius/shadow/backdrop-filter. Chrome sits below the stage, not over it.

## Unsure / untested
- Not run in a browser or on a 3D display; only syntax-checked. Visual scale, colours and comfort of the pop-out (front rails ~8 cm in front of the glass at the corners when pitched) need a check on hardware. If it feels too much, lower the tank depth `TANK.d` or raise `virtualDisplayHeight`.
- `preserveDrawingBuffer` may cost some performance; it is harmless if the browser doesn't need it.
- The glass may show faint speculars that differ per eye; kept dim on purpose.
- The fish path is a Lissajous wander; speeds were chosen by eye, not tuned.
