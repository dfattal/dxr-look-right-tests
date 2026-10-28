# Desk Aquarium — notes

**SDK / rig:** `createInline3D` + `SceneViewer` (`/sdk/js/inline3d-viewer.js`) with `EyeCamera`, and `wall.addScene(canvas, viewer.onFrame, { viewRig: displayRig(...) })`. **Display rig**: the tank is an object the user looks at, not a world they walk through. Ordinary browsers use `viewer.startMono()`. Structure follows `samples/starter-scene` and `starter-ui`.

**Depth settings**
- `virtualDisplayHeight: 0.24`, the same on the viewer and `displayRig`. This is the template value; depth then doesn't depend on model units.
- `depthFit { front: 0.1, back: 0.27 }`: the comfortable column for a 16:9 tile (about 0.6 % / 1.5 % of width). The canvas is fixed at 16:9, so no rescale.
- `depthOffset = -(BACK-FRONT)/2 * VDH`: puts the tank centre slightly behind the glass so the larger "behind" budget is used.
- `fitSweep: false`, `orbit: false`: the tank never turns, so its real depth is budgeted (not the turntable sweep).
- The tank is turned 18° yaw / 10° pitch for a 3/4 view. The fit uses the `Box3` of the turned content, since the fit doesn't account for pitch.
- Fish, plants and bubbles stay inside the tank box, so the fitted box bounds all the depth. The back wall (a gradient plane) is the farthest thing; nothing is at infinity.
- Glass panes are very faint (opacity 0.05, no depth write) and frame bars are mid-tone, so no high-contrast edges sit in front of the glass.
- Opaque `clearColor` equals the page background `#07131f`. No `feather`. `depthNear/Far` = 0.01 / 20.
- The depth slider sets `ipdFactor` and `parallaxFactor` together. The 2D/3D button uses `setStereoEnabled`, falling back to depth 0.
- All HTML is outside the canvas, with no filter, opacity or transform over it. The cover is removed in one step after `firstWoven`.
- Surfaces get speckle textures, since stereo matching needs fine detail.

**Unsure about** (I couldn't run a browser):
- The actual fitted depth. The tank's front-bottom corner and base are the nearest points, and fit includes them.
- How translucent water, glass and bubbles weave on a panel. They are ordered with `renderOrder`.
- Fish and plant sizes and the CPU plant-animation cost.
- Whether the three.js CDN (0.180.0) is reachable from the DisplayXR Browser.
