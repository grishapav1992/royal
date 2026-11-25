# Caribbean Treasures 1.8.0

Independent client package for `studio-caribbean-treasures`. Host API 1, server rules 2 and progress contract 1. The common module loader mounts `entry.ts`; the host supplies the expansion client, wallet, account, money formatting and language.

The shared host collapses chat behind a button on compact screens, including landscape phones. Desktop retains a chat column when space permits and remembers a manual collapse. The game uses its real container dimensions: portrait places a full-width field above the console, and short landscape panes put the console beside the field. The primary field and actions do not scroll. Repeated title plaques are hidden in compact layouts; the pirate portrait, harbor, frame, symbols and red spin control retain the game's identity.

Stake, line and autoplay-count controls move as live DOM elements into the compact options sheet. Opening or closing the sheet retains their values and handlers. The accepted cost, balance, payout and net result stay in the console. A bonus choice replaces inactive spin/settings controls, and an active autoplay Stop remains accessible. Resizing preserves the mounted instance, pending-operation UUID and accepted round. See the [layout verification](../../docs/game-layout-priorities-verification.md).

The plate beside the pirate opens the voyage map. Completed paid rounds give points by the whole debited amount, and eleven pirates open at fixed thresholds in the order of the islands. Points and choices live in the common account through `/api/caribbean-voyage`; the slot remains playable if it is unavailable. Tokens of the earlier collection became points one to one and opened pirates stay. See [collection-policy.md](../../docs/concepts/caribbean-treasures/collection-policy.md).

A chosen pirate comes on deck between rounds, never during a paid presentation. A failed load or a refused choice keeps the current pirate. Profile operations never submit a wager or change an accepted round.

Crew masters and prompts are in `assets/crew/`. Run `node scripts/export-caribbean-crew.mjs` from the repository root to export 80 transparent reaction images and 11 small gallery previews, or add `--check` to verify exact exported bytes. An eight-pixel atlas inset excludes neighboring frame edges. Only the chosen reaction set loads; the original 16-image startup list remains bounded. The additional crew has a separate 12 MiB runtime media budget. Music and recorded effects are unchanged.

The package renders confirmed 6×4 fields, continuous giant blocks, winning cells and selected paylines. It exposes 1/5/10/20 active lines, four per-line stakes, natural tactic selection, both purchased series, rules, round history and pending-operation recovery. Settings lock during accepted rounds. Outcomes, costs, entropy, persistence, house coverage and final credit belong to the common backend.

Paid starts are unavailable when the latest shared wallet balance cannot cover their existing accepted price. A persistent status explains the required amount; the + button beside the balance opens the common test wallet. Shared-wallet funding updates an already mounted game. Free continuations remain available at zero balance, and a definitive server rejection remains visible after the shared client's automatic refresh. No price or settlement rule is changed.

The scene in `scene/` draws the existing harbour, symbols, frame and pirates on canvas and WebGL: one loop, stopped by the pause, a hidden window and closing, with its contexts released on destroy. `scripts/export-caribbean-scene.mjs` makes `harbor-mask.webp` and `gun.webp`. Design and screenshots: [Voyage](../../docs/game-layout/caribbean-voyage/README.md). The produced instrumental loop of Blackmoor Tides by Matthew Pablo accompanies recorded effects; source and license credits are in the in-game rules and assets/audio-credits.md. All sound uses the host AudioContext, output, mute and volume. Recovery and operation retries do not replay a reward. Autoplay keeps its 10/25/50/100 paid-round budgets; after a bonus series it waits until the player confirms the result.

Client support is advertised through `X-Royal-Caribbean-Treasures: 1` on the common transport. Older clients receive a filtered session list and cannot change this game's rounds. The current rules-2 total stake is divided across the selected lines; accepted legacy rounds retain their original pricing. This layout update preserves the existing rules, transport and progress contracts. The compact shared shell requires its matching host update.

Every pirate has eight poses: idle, blink, focus, cannon surprise, bonus gesture, calm loss/partial return, positive result and laugh. A pose changes inside a short dip of the body, so two drawings are never mixed. Reduced motion keeps a static idle pose. See the [six final ImageGen prompts](assets/character-prompts.md).

Four compositions share one set of controls: wide, portrait with a tablet variant, short landscape, and a small phone with a face and one menu. The field keeps its place in every state of the same window.

The header owns a higher stacking layer than the isolated stage, so portrait gestures and field effects cannot cover its four tools. The modal remains above the header. A real-host pixel regression deliberately moves pirate art into the toolbar and verifies unchanged button interiors, then checks sound, music, rules and history on desktop, laptop and mobile.

Columns land with a short settle, the continuous giant rises within its exact block, and cannon growth uses the confirmed before/after bounds with a local recoil. One paid prefix route is traced outside the giant, the integer tally uses a smooth frame-based easing, and positive complete rounds add bounded gold particles. Skip immediately preserves confirmed money and clears owned decoration.

Raster source PNGs and ImageGen prompts are in `assets/`. Reproducible WebP runtime exports use the repository's declared `public/assets/caribbean-treasures/` media root and are bundled into this game's immutable package. `icons.ts` maps the six unchanged symbol IDs to those exports. Sixteen runtime images fit the 5 MiB presentation budget. Event design, cancellation and synchronization are specified in [feedback.md](feedback.md) and the reference upgrade in [reference-polish.md](reference-polish.md).

Build with `npm run build` or `node scripts/build-game-module.mjs --game caribbean-treasures`. Run `npm run test:caribbean` for full-round, transport and wallet coverage.

For real-host browser checks, start `node --import tsx scripts/caribbean-preview.ts`, then run `npx playwright test --config playwright.caribbean.config.ts`. The loopback-only stand creates its own temporary PostgreSQL and disposable accounts. It uses the actual host, module loader, shared wallet store and live chat. Test-only top-up, forced bonus and seeded saved-scenario controls exist in that local stand only. Saved scenarios drive actual backend rounds, not injected UI results. Stop with POST `http://127.0.0.1:5234/__test/caribbean/stop`; this closes its backend and temporary database.

Set `CARIBBEAN_WEB_PORT`, `CARIBBEAN_API_PORT` and `CARIBBEAN_ARTIFACTS_DIR` to the same values for the stand and Playwright when a user preview already runs. The separate stand writes `runtime.json` in its own artifact directory and does not replace another preview's ownership record.

The local stand starts new accounts with zero funds. For free local test credit, sign in first and open `http://127.0.0.1:5234/scripts/caribbean-fund-local.html`, then use its explicit 1000-demo-credit button. This development page calls only the stand's existing authenticated fixture route and is excluded from production builds. It does not enable production deposits or change the shared wallet implementation.

See [the staged development plan](../../docs/concepts/caribbean-treasures/development-plan.md) and [final review](../../docs/concepts/caribbean-treasures/final-review.md). Automated signal and scheduling checks do not establish listening comfort on physical devices.
