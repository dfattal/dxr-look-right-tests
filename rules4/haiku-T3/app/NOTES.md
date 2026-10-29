# Walk-through: notes

Files: `index.html` (page, import map, CSS), `main.js` (SDK wiring, walk and look), `room.js`
(room geometry, textures, lights). Served at `/app/`, SDK at `/sdk/`. three.js 0.180.0 from jsdelivr.

## SDK API and view rig

- `createInline3D({ lazy: false })`, then `wall.addScene(canvas, onXRFrame, { viewRig, onLayerLost, onResize })`.
  One always-on scene, so `lazy: false`.
- **Camera rig**, not display rig. The visitor is somewhere and moves through the room, which is
  the authoring guide's "user IS somewhere and moves" case. The rig is `cameraRigFromCamera(THREE,
  camera, { attach: true, convergence, ipdFactor })`, set once at `addScene`.
- **Attach pattern.** The rig has an identity pose. `EyeCamera`s are parented under the app camera,
  which is in the scene, and each eye uses `setLocalFromMatrices`. This keeps the visitor's motion
  from lagging a frame behind the stereo.
- **Gate:** `inline3dViewRigSupported()`. Without a rig the walk-through is flat, not stereo. A
  display rig would frame the room from a fixed portal, and the visitor's camera would go nowhere.

## Depth settings and why

| Setting | Value | Why |
|---|---|---|
| rig type | camera | the viewpoint moves through a world (authoring guide, "Which rig") |
| `convergence` | **2.0 m, fixed** | the zero-disparity plane sits 2 m ahead of the eye, so the table and chairs land near the glass and the back wall recedes. Fixed, not hit-tested, so the room does not change depth as the visitor turns (porting guide, "Convergence"). Never 0, which would mean infinity. |
| `ipdFactor` | **0.6** (absolute on a camera rig) | My estimate: at 1.0 the room's depth budget is about 2.7× a 24 cm reference object, using near ≈ 0.5 m and far ≈ 4.5 m. At 0.6 it is about 1.6×. Still strong, but less strain on the far wall. |
| comfort | 1 × 0.6 × 0.5 × 0.5 = **0.15** | runtime rule `ipd × m2v × diopters × 0.5 ≤ 1`, far below the divergence limit |
| `metersToVirtual` | 1 (default) | the scene is authored in metres at real scale. Scaling it would be a depth dial, not a unit fix. |
| `parallaxFactor` | 1 (default) | full head tracking |
| vertical FOV | 60° | wide enough for a room. A wider FOV shrinks the depth budget, so I did not go wider. |
| eye height | 1.6 m | standing eye level |

`?ipd=` and `?conv=` in the URL override `ipdFactor` and `convergence` so you can tune on a panel
without editing.

## Comfort and look (rules from `making-3d-look-right.md`)

- **Background:** the clear colour is dark grey `#2a2c33`, and the page is `#1b1c21`. No pure black.
- **Palette:** mid tones. Walls `#cdc6b9`, floor planks in browns, window sky `#8fb4cc` to `#d6e4ec`.
  The sky sits behind the glass, about 4.3 m out. The ceiling is the lightest surface, but it is
  mid-room and at 2.7 m, not a bright edge on a dark field.
- **Lighting:** a hemisphere light plus a warm sun and a lamp, with no shadow maps. Nothing goes to
  black, so the crosstalk correction has nothing to double.
- **Cover:** a solid `#cover` sits over the canvas until `firstWoven` resolves. It is removed by
  `uncover()`, never faded. A 5 s timer removes it even if the signal never comes.

## Woven-canvas handling

- Canvas CSS has no border, radius, shadow, filter, or opacity. The only CSS on it is
  `will-change: transform`.
- Backing store is 2× width (2:1 per eye) while woven, 1:1 when flat.
- Two frames of commit before `addScene`.
- `resizeBacking()` compares sizes before reallocating, since a same-size write clears the buffer.
- Short or null view lists repaint the last good frame. The views are validated before
  `renderer.clear()`.
- `onResize` resizes and replays the last frame at the new size.
- `onLayerLost` and `firstWoven → woven: false` both fall back to flat, 1:1, with the same walk.
- All text (status, hint, controls) is below the stage, not over it.

## Controls

- Walk: WASD by physical key position (`e.code`), plus arrow keys. On non-QWERTY layouts the keys
  map by position, not letter.
- Look: drag on the picture (always works). Pointer Lock is an optional button and is not verified
  on hardware, so drag stays the default.
- Walls and furniture are axis-aligned boxes with a 0.3 m clearance. The visitor slides along them.

## Unsure, and what would settle it

- **Nothing here has been seen on a panel.** The depth numbers, FOV, and light levels are judgement
  calls. On hardware, check that the table sits welded to the glass when you look at it from the
  start position, and that the back wall and window sit comfortably behind. Adjust with `?ipd=` and
  `?conv=`, then bake the values in.
- **Lighting and palette** were chosen blind. The room may look dim, flat, or too warm on the panel.
- **Pointer Lock over a woven canvas** is untested on hardware (porting guide, §7).
- **Replay split:** `onResize` assumes the left eye is at x=0 and the right at x=half of the buffer. This
  matches the sample comment on `getViewport()`, but I did not check it against the SDK source.
- **Import map:** I could not load three.js from the CDN or serve the page, so the import URLs are
  unverified. Both modules pass `node --check`, but that is only a syntax check.
- **Not run:** no browser, no server, no display. Frame rate, DPR cap (2, the SDK default), and
  `firstWoven` timing are unmeasured.
- **Fallbacks:** a browser without the rig, or without inline-3D, gets the flat walk-through. I chose
  flat over a display-rig fallback because the display-rig framing would not show the room from the
  visitor's position.
