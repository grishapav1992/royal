# Card rules version 1

Frozen production source from 12 October 2026, before the mathematics fixes.
This engine is only used by server-owned sessions already tagged rulesVersion 1.
The server selects version 2 for every new game whose mathematics changed.
Clients cannot select a legacy version when starting a game.

The frozen sources preserve settlement of already accepted bets. Known defects
must be fixed in server/card-engine, never by editing this snapshot. Unchanged
games also retain their existing version 1 engine and rules.

SHA-256 of the production binary at capture:
c408bb0929442f0ae724e2723a971d70919fa6db25e1c903a991e6cf24dd3f41

Source manifest: artifacts/game-math-fix-20261012/legacy-source-manifest.json.
