# Notes

**API:** `createInline3D({lazy:false})` once, then `addModel()` from `/sdk/js/inline3d-model-entry.js`
(`engine:'three'`). `addModel` registers an `addScene` window and uses the SDK's `SceneViewer` with its
default **display rig** (canvas = portal onto a virtual display, subject centred on the zero-disparity
plane, head-tracked by the runtime). I did not set a camera rig or call `setViewRig`.

**Depth settings**
- `virtualDisplayHeight: 0.16` – desk-object scale (same as the SDK model sample); keeps absolute disparity modest.
- `margin: 0.7`, `fitSweep: true` – duck stays inside the tile at every yaw, so nothing is cut by the window edge (edge violations cause depth conflicts).
- `depthLimit: 1.5` (default 4) – backstop on total depth for comfort.
- Subject centred on the glass (SDK default): roughly half pops out, half recedes. No `depthOffset`, no ipd/parallax changes (defaults = full relative 1).
- `feather: 24` – soft edge baked into the buffer rather than CSS.
- `renderScale: 1` – full-res eye buffers for crisp texture; `idleSpin: 10` slow turntable; drag/buttons rotate.

**Woven-canvas rules followed:** no CSS effects/radius/shadow on the canvas or ancestors; all UI (title, price, button, controls) is
plain DOM *beside* the canvas, solid colours, no `backdrop-filter`; dark page bg (transparent woven pixels render black);
opaque cover over the canvas until `firstWoven` (hard cut); one session; canvas never remounted; `will-change: transform` and a 2:1 backing store from first paint.

**Unsure / untested (no browser or display available)**
- Draco decoder: no local copy exists, so `decoderPath` points at jsDelivr's three@0.180.0 `libs/draco/`. The SDK default is deliberately same-origin `/draco/`; for offline use copy that folder and change the path.
- three/jsDelivr are required at runtime (internet). Nothing was run; the page has not been executed.
- Cover is released on `allSettled([ready, firstWoven])`, so a failed load still reveals the (empty) tile plus an error message.
- Rotate buttons rely on `viewer.getPose({target:true})`/`setPose` per `viewer.d.ts`.
