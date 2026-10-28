# Solar system — notes

## SDK API and view rig

- **Rig:** display rig (`displayRig`, `virtualDisplayHeight` 0.24 m), because the user looks at an
  object and does not walk through it (guide §1).
- **Viewer:** `SceneViewer` with `EyeCamera` from `@displayxr/inline3d/viewer` and
  `@displayxr/inline3d/three`. The system goes in `viewer.content`; the starfield and a hemisphere
  light go in `viewer.scene`.
- **Session:** `createInline3D({ lazy: false })`, then `wall.addScene(canvas, viewer.onFrame, { viewRig, onLayerLost })`.
  Renderer updates: `depthNear` 0.01, `depthFar` 20.
- **Controls:** the depth slider calls `handle.setViewRig(displayRig(...))` with `ipdFactor` and
  `parallaxFactor` both set to the slider value. The 2D/3D button calls `handle.setStereoEnabled`
  and labels itself from `renderingmodechange`. Both are copied from `samples/starter-ui`.
- **Covers and ordinary browsers:** the canvas is covered until `handle.firstWoven`. Without 3D
  support, `viewer.startMono()` runs and the controls are disabled.
- **Three.js:** 0.180.0 from jsDelivr, the version every SDK sample pins.

## Depth settings and why

| Setting | Value | Why |
|---|---|---|
| `virtualDisplayHeight` | 0.24 m | The SDK's default and the starter's value. It sets the scale of the tile, not the depth. |
| `depthFit` | front 0.1 h, back 0.12 h | Comfortable column for the front (0.1 h ≈ 0.6 % width on 16:9). Back is shortened from the 0.27 h column so the system stays in front of the stars. |
| `depthOffset` | (FRONT − BACK)/2 × VDH = −0.01 h | Centres the budget so both ends are used. The system sits just behind the glass. |
| `STAR_DEPTH` | 0.16 h behind | Full-frame background limit is about 1.0 % of width behind (0.18 h). 0.16 h ≈ 0.9 %. The stars must sit behind the system (back end at about −0.10 h). |
| `TILT` | 0.25 rad (14°) | Tips the orbit plane. Depth extent is about 0.26 × vertical extent, so the system fits the depth budget at close to full size. Face-on is the least depth. |
| `margin` | 0.7 | Keeps the planets that come out of the glass at least 0.15 h from the top and bottom edges (guide §4). The SDK default of 0.8 would put them at 0.1 h. |
| `fitSweep`, `orbit`, `idleSpin` | false, false, 0 | Nothing turns the system, so the fit budgets its real depth. Orbit-drag would swing its width into depth past the budget. |
| `ipdFactor`, `parallaxFactor` | slider, default 1 | Display-rig factors are relative. 1 is the natural display depth; the slider only makes it shallower. |
| `clearColor` | `#05070d`, opaque | Alpha-0 pixels weave as stale or black. The page colour matches it. No `feather`. |
| Starfield | 2600 soft dots, 2.5 px, mostly faint | Points at one depth give one disparity across the frame. Faint, soft stars keep the contrast low, since sharp bright points ghost. |
| Orbit rings | `#2a3652` | Dim lines for the same reason. |

Depth fit: the fit box is an analytic bound on the tilted disc (`reach` about the sun), not a `Box3`
of the current pose. The bodies move, so a measured box would be wrong at other times. I checked
numerically over 400 s that the bodies stay inside the box.

## Unsure

- **Not run on a panel or in a browser.** I could only check that the module parses and that the
  depth box bounds the orbits numerically. Depth, ghosting and the 2D/3D switch are unverified on
  hardware.
- **Expected fit:** the vertical margin binds, so the depth ends up about 0.18 h in total: roughly
  +0.08 h in front and −0.10 h behind. These are my calculations from the guide's formula, not
  measured values.
- **Small planets:** the planets are 2–4 % of the tile height. They may be hard to read or fuse at
  small tile sizes. Raising the planet radii would help, at the cost of more depth.
- **Starfield ghosting** is untested. It is a flat sheet of points, the one element I am least sure
  about.
- **Light:** the sun's point light uses decay 0 (no falloff) for a readable look. That is a look
  choice, not an SDK recommendation.
- **Reduced motion** slows the animation to 25 %.
- **SDK typings:** `sdk/llms.txt` lists `index.d.ts`, but the snapshot has no such file. I used
  `viewer.d.ts`, `three.d.ts` and the `starter-ui` code instead.
