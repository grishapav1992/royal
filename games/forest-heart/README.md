# Forest Heart client 1.17

The Living Tree presentation keeps the approved forest, elf, tiles, roots, crystal, flowers and logo, and rebuilds their layout and motion. The design record is in [docs/game-layout/forest-living-tree](../../docs/game-layout/forest-living-tree/README.md).

`ForestLayout` sizes one scene from the module window. `ForestFrame` paints the mirrored frame. `ForestField` paints the five by five field, light, held roots and the rune offer from confirmed masks only. `ForestEffects` owns decoration. `ForestScene` runs one frame loop for them and stops on pause, hidden pages and reduced motion. `autoplay.ts` counts paid fields.

The module retains host API 1, rules 1 and progress 1. The host owns transport, wallet, sessions, language and audio. Rules, paid costs and payout mathematics are unchanged. Presentation reads only the confirmed view and never generates an outcome.

The elf keeps the video-v3 nod, board glance and crystal gesture. Each lasts three seconds, separated by six seconds of quiet idle. No new clip starts while a field is being presented; a running clip finishes. Video texture coordinates are fixed. Source poses differ at the beginning and end, and the premultiplied blend can reveal this mismatch. [Source provenance](../../docs/concepts/forest-heart/video-v3-assets.json) and [rendered verification](../../docs/concepts/forest-heart/stability-v15-review.json) record inputs and limitations.
