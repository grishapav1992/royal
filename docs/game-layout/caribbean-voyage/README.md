# Caribbean Treasures: Voyage

The pirate setting of the earlier game is kept: the same harbour, frame, symbols and eleven pirates. The redesign adds a living scene, pirate effects and a crew that opens along a voyage map. Rules, probabilities, payouts and accepted rounds are unchanged.

| Part | Decision |
| --- | --- |
| Field | One place at a fixed window size in every state. It stands low on wide screens, so the sails of the galleon rise above it |
| Result row | Price, payout and net result have fixed space together with errors and recovery. A profit needs a payout above the whole accepted price: only then the sabre, coins and gold appear |
| Wheel | Starts a spin, opens the confirmed result at once and checks a lost answer. It never loses the keyboard focus |
| Giant and broadside | The giant rises from water on ropes. The deck gun fires on wide screens, the galleon on phones |
| Series | The raid is a sunset with boarding hooks, the assault is a storm with rain behind the plates |
| Crew | Points of completed paid rounds move a ship between eleven islands. See `docs/concepts/caribbean-treasures/collection-policy.md` |
| Boarding map | It opens by a random event. The row shows only a closed or an opened map: the `mapPieces` value of other rounds is not progress, so it is not shown |
| Small phones | 320 by 568 and 568 by 320 keep a face and one menu. The tablet has its own composition |

The scene lives in `games/caribbean-treasures/scene`. `scripts/export-caribbean-scene.mjs` makes the water mask and the gun. `prototype/` is the approved mock-up, `screenshots/` comes from the real host with connected chat.

Published on 25 November 2026 as package `1.8.0-42fe662a97ca`, [release verification](../../../deployment/releases/caribbean-voyage-module-20261125-v1/verification.json).
