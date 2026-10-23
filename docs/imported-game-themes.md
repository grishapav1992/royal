# First-floor GitHub game worlds

The redesign is restricted to `ARCADE_GITHUB_GAMES`, the ten imported games currently displayed on the first floor. Copied Luelon/Studio games, provider screens, LAST EXIT, retired definitions, custom variants and card-floor games keep their existing presentation. The earlier broader decorative registration was removed.

| Game | Dedicated world | Game surface |
| --- | --- | --- |
| Royal Fruits | Cherry Express | Cream railway cabinet, cherry enamel, teal reel frame |
| Royal Dice | The Alchemist's Workshop | Copper measuring instrument and green elixir colours |
| Royal Limbo | Andromeda Gate | Violet orbital glass and an illuminated path |
| Royal Mines | Expedition to El Dorado | Mossy stone cells and a carved temple frame |
| Royal Plinko | Pearl Reef | Aquarium frame, pearl pegs and shell-shaped pocket windows |
| Royal Keno | The Constellation Atlas | An astronomical plate with round number markers |
| Craps | Midnight Jazz | Brass dice and an oval velvet lounge table |
| Dragon Tower | Dragon Citadel | Stone masonry and arched doors for the nine levels |
| Diamonds | The Aurora Vault | Faceted gems in a polar crystal cavern |
| Sic Bo | Tomb of the Scarab | Sandstone dice trays, lapis panels and a scarab seal |

Every world has its own original SVG scene and emblem, palette, title and caption in Russian and English. No remote images or fonts are required. The game's original name remains visible in the header and host window.

## Presentation boundaries

`src/ui/FirstFloorGameArt.ts` owns the explicit ten-game registry and artwork. `src/ui/ImportedGameThemes.ts` decorates only registered identities. `src/ui/imported-game-themes.css` supplies the shared control foundation; `src/ui/first-floor-game-worlds.css` supplies individual surfaces and details. Styles are scoped to decorated roots. Shared renderers return without decoration for games outside the registry.

The decorator changes presentation attributes, headers and styles. It does not read wallet or round state, send operations or choose outcomes. Diamonds' faceted shapes derive only from the original symbols already rendered on screen; unknown gems stay unknown. Rank, payout, result, motion and recovery data remain owned by existing game views and server rules. No module identity or compatibility contract changes.

## Verification

`server-tests/first-floor-game-themes.test.ts` checks exact agreement with the active first-floor collection, exclusion of copied and provider games, and distinct artwork, palettes and bilingual titles. Build the application and run the module checks. Verify the actual hall with connected chat on desktop and mobile, including close/reopen of an active round and wallet recovery. Fixture mounts alone do not verify host layout.

Local screenshots and verification evidence for this pass are under `artifacts/github-first-floor-v2/`. Publishing remains a separate operation governed by `AGENTS.md` and `deployment/SERVER.md`.
