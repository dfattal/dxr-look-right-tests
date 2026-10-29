# Notes

**Not run.** I had no browser or 3D display, so none of this has been executed.

## API and rig
- `createInline3D({ lazy:false })`, called once per document, then `addModel(wall, canvas, src, opts)` from `/sdk/js/inline3d-model-entry.js`. This is the default PlayCanvas engine.
- **Display rig** (the default). The canvas is a portal onto a virtual display, and the product is a subject the shopper rotates. I did not use a camera rig.
- A drag rotates the model (turntable orbit). `idleSpin` turns it until the shopper grabs it. "Reset view" calls `handle.resetPose()`.

## Depth settings
- **Placement left at SDK defaults.** I set no `virtualDisplayHeight`, `margin`, `fit`, `depthLimit` or `depthOffset`. The viewer scales the duck and centres it on the glass, which gives the smallest disparity spread. The SDK docs say not to push it back or shrink it.
- **`renderScale: 0.8`.** This sets the per-eye buffer resolution. It does not affect depth.
- **`feather: 24`.** The soft edge is drawn in the buffer, so the canvas has no CSS border, radius, shadow, filter or opacity.
- **Background is dark grey `#2a2d34`.** It is used for the page, the stage and the canvas clear colour. Pure black can't be corrected for crosstalk, so a bright yellow edge on black would double. The engine's default clear is transparent, which weaves black. After `ready` I set the engine camera's `clearColor` to the grey (`handle.engine.camera.camera`). This is an advanced, unstable hook.
- **All text, price and buttons are DOM beside the canvas, not over it.** That avoids 2D-over-3D overlay issues and keeps the UI crisp at native resolution. There is no `backdrop-filter`.
- **Cover.** A grey cover sits on top of the canvas and is cut (no fade) on `ready` plus `firstWoven`. A 5 s failsafe timer also removes it, and so does a setup error.
- The canvas gets `will-change: transform` in CSS, and one 2:1 canvas is used for the whole page.

## Unsure about
- **Draco decoder.** `/sdk` has no `vendor/draco/`, and I couldn't download files here. `decoderPath.draco` therefore points at the jsDelivr copy of three@0.180.0's `libs/draco/`. This needs the CDN to serve CORS headers and to work from the engine's worker. For production, copy `draco_wasm_wrapper.js` and `draco_decoder.wasm` into `/app/draco/` and set `decoderPath: { draco: '/app/draco/' }`.
- **Clear-colour hook.** I don't know whether the `clearColor` override works on every SDK build. It is wrapped in try/catch.
- **Failure message.** If the model fails to load, the failure message in the cover disappears when the 5 s failsafe fires.
- **Duck scale.** The Duck has a small depth extent. I haven't checked how much it pops out or recedes on the glass.
