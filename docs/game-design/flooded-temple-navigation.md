# Flooded Temple 0.7.0: explicit passage choices

The demo bonus begins in A2 with one legal passage to B2. The previous UI left the action disabled until the player found and selected that room, while allowing any of twenty rooms to replace the route selection. This made a forced corridor look like a hidden-choice task.

## Behavior

- A unique legal destination is selected automatically. The primary action names the room and its one-move cost, and is immediately available.
- A fork never receives an arbitrary automatic choice. Open passages have numbered badges, visible arrows from the current room, and matching buttons in the console.
- Each passage button identifies its destination, contents and cost. Revisits explicitly say that they give no new reward; rope passages are marked separately.
- Inspecting an unreachable room or the base map preserves the selected legal move. Inspection and route selection are separate UI fields.
- Choosing a rope destination enables an explicit Prepare rope action, followed by confirmation of the crossing. Preparing the rope sends no operation and consumes no move. The existing Use rope toggle remains available.
- Reload restores guidance from the confirmed view: a sole passage is selected, a fork waits for a decision, and no automatic move or reward is sent.
- Initial snapshot loading renders a disabled action and `aria-busy` immediately. This prevents an apparently enabled first button from silently rejecting a click while the common client refreshes.

Selection is cosmetic. Every passage still needs confirmation, uses one free expedition move and preserves Finish and collect. No path strategy, probability, stake, payout, progression rule or settlement changes. Host API/rules/progress remain 1/1/1, with the existing shared wallet and operation identity.

The eight authored bonus layouts have six single-passage starts and two starts with a fork. This is an inventory of map definitions, not a measured player frequency or a claim of improved enjoyment. On the demo map, B2 has three passages: return to A2, chest C2, and lever B3.

## Presentation and access

The current room has a short YOU marker, the caption names its coordinates, and every legal target has the same number on the board and in the console. Available arrows use cyan, selected arrows gold and rope arrows dashed amber. Existing route history remains visible. Numbers and text complement color.

The passage panel appears before the main action in reading order. Desktop bonus maps reserve at least 840 px of document height; short host stages scroll inside the existing game frame. This prevents the enlarged console from covering the map. Phone layouts retain the connected chat and vertical game scrolling. No animation or sound asset changes are introduced.

## Verification

`npm run test:temple` passed all 32 checks again on the final source after synchronization with current main, covering mathematics, wallet, transport, client, presentation and navigation over all eight map definitions. A full browser run passed 34 of 35 scenarios and exposed the initial snapshot loading issue. After fixing it and adding a delayed-loading regression, the final package passed all seven targeted browser scenarios: sole passage, forks and inspection, rope preparation, reopen, delayed initial loading, RU/EN responsive keyboard layout, and the real Royal host with connected chat. The inherited scenarios passed in the earlier run; this is not a claim that all 36 scenarios were rerun on the final package.

The post-synchronization application build passed in 23,551 ms (the earlier final Temple build passed in 39,842 ms), including RTP, typecheck, independent modules, host and backend. RTP verification reported 13 verified games and 114 unchanged legacy modules without qualification; Temple's existing proof remained valid. The seven independent module checks passed and validated package payload hashes. No mathematical source or qualification proof changed.

The active package is `0.7.0-bc6bd4bcff7e`, with source SHA-256 `bc6bd4bcff7ea0c270450da01a5cb83d17521bced7a7404ebfa0e7f3bb454b78` and manifest SHA-256 `81634359ac9cbc53ded42ac996c0064775741b7ca53b80ec602d7b4bb454b858`. See [machine-readable verification](flooded-temple-navigation-verification.json) and [storage report](flooded-temple-navigation-storage.json).

Prepared test-round captures show [the unique passage](../assets/flooded-temple/navigation-single.webp), [the B2 fork](../assets/flooded-temple/navigation-fork.webp), and the actual host with chat on [desktop](../assets/flooded-temple/navigation-host-desktop.webp) and [phone](../assets/flooded-temple/navigation-host-mobile.webp). A separate [ready-screen capture](../assets/flooded-temple/navigation-preview.jpg) records the newly opened in-app preview. The browser tool did not find the previously supplied tab, so a new version 0.7.0 tab was opened and checked after loading, without starting gameplay there.

Temporary files are owned under `artifacts/work/flooded-temple-navigation/`; all earlier denied cleanup scopes are excluded. The local preview at port 5226 uses its existing disposable database and demo funds. No production deployment is included.

The source was preserved and remotely verified at `42d50463172151005124f0448e0de0e48fc459ab`. Automatic approval review rejected the single cleanup attempt before execution with `blocked by policy`, without a detailed reason. Nothing was removed: the owned temporary directory (14,905,207 bytes) and four inactive 0.7.0 packages (76,760,617 bytes) remain. No archive or source backup was created. Exact paths, inventories, measured free space and active-session exceptions are in the storage report. No earlier denied scope was retried.
