# Forest Heart client 1.18

The Living Tree presentation keeps the approved forest, elf, tiles, roots, crystal, flowers and logo, and rebuilds their layout and motion. The design record is in [docs/game-layout/forest-living-tree](../../docs/game-layout/forest-living-tree/README.md).

`ForestLayout` sizes one scene from the module window. `ForestFrame` paints the mirrored frame. `ForestField` paints the five by five field, light, held roots and the rune offer from confirmed masks only. `ForestEffects` owns decoration. `ForestScene` runs one frame loop for them and stops on pause, hidden pages and reduced motion. `autoplay.ts` counts paid fields.

The module retains host API 1, rules 1 and progress 1. The host owns transport, wallet, sessions, language and audio. Rules, paid costs and payout mathematics are unchanged. Presentation reads only the confirmed view and never generates an outcome.

Since 1.18 the elf has no video. `ForestCharacter` draws seven approved poses and optional lids, weaves changes in light from the acting hand and keeps one head between both drawings. A started change always finishes and the newest requested pose follows. Sustained actions last until the next event. Magic and the held crystal take the colour of the confirmed energy. The unused video-v3 files stay in the repository for older packages.

1.18.1 aligns the module with the approved prototype: the field keeps its place and the plate keeps the width of the frame in every wide window, money shows two decimals, and celebrations stay while the result window is open. `FOREST_HEADROOM` is the canvas room above the drawing.
