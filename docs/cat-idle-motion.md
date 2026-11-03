# Cat idle motion

Updated 3 November 2026. Scope: the existing cat's sleeping and seated paintings.
This is local presentation work; it does not authorize a production release.

| State | Visible behavior | Interruption and comfort |
| --- | --- | --- |
| Sleeping, including the sleeping sofa pose | The back rises and settles over 3.6 seconds. The face and resting paws stay anchored. | Leaving the pose restores its ordinary artwork. Reduced motion displays the original still painting. |
| Seated, resting, perched, petting and purring | A small 3.2-second chest breath, upper-body sway and a brief head lean every 9.2 seconds, alternating sides. The lower paws stay anchored. | Movement is attached to the seated painting, so eating, walking, jumping and carrying keep their own poses. |

The periods and amplitudes are artistic design choices for this cat. They are
not scientific thresholds or measured evidence of player enjoyment. There is
no new sound or audio synchronization event.

`src/game/CatIdleMotion.ts` deforms strips of the existing atlas into one reused
canvas texture. It refreshes at most 30 times per second and advances only
while the idle pose is visible and motion is enabled. A long frame advances
the motion clock by at most 0.1 seconds. Hall changes reset it, and scene
shutdown releases the texture. No generated artwork or new network fields
are required.

Verification on Windows with Chrome:

- `node node_modules/typescript/bin/tsc --noEmit`: passed.
- `node node_modules/vite/bin/vite.js build`: passed; the existing large-bundle
  warning remains.
- `npx playwright test --config playwright.cat.config.ts`: 3 passed, covering
  desktop Canvas, desktop WebGL and a 390 by 844 mobile viewport. Pixel checks
  confirm changing back/chest/head regions, unchanged sleeping face and lower
  paws, cycle return, fixed world position/depth/scale, reduced motion, hidden
  hall behavior, walking transitions and texture disposal.
- Real offline room: the sleeping cat used the new texture, with no page errors.
  The reused texture is 425,216 bytes of uncompressed RGBA pixels.
- The existing cat routine/walk/online suite produced 16 passes and 7 failures.
  Its unchanged tests still reference removed cabinets, expect seven card
  tables where the current catalogue has four, and import the missing
  `server/websocketSafety` module. These failures are outside the renderer
  change. No catalogue entries or server behavior were changed to satisfy them.

The shared production graph was unavailable over SSH during this task. Source
relationships were inspected directly. Mobile checks use browser emulation;
physical mobile hardware and subjective player acceptance were not tested.
