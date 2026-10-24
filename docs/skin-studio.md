# Paid character skins

The first-floor atelier is recessed in the back wall, left of the upstairs door, with an elderly gangster tailor, mirror and suit rail. The casino wall is now 275 world units tall. Its ceiling extends upwards without changing floor movement coordinates. The counter finishes at the wall base and adds no floor obstacle. Royal Fruits was moved down to clear the shop and its approach. Chandeliers were removed. Click the atelier to walk to it and open the order window; E also opens it when standing near the counter. The profile's `Образы` button provides quick access.

## Local preview

Run `npm run dev:atelier` and open `http://localhost:5187`. Every local account with a selected character receives a one-time $50 test credit, including accounts registered from the normal login screen. New accounts are checked every two seconds; repeated checks and restarts never reset or double-credit a spent balance. Credits use the ordinary shared game wallet and its ledger. The helper refuses any database except the isolated local atelier database on 127.0.0.1:55587. The optional test login is `tailor@atelier.local`, password `AtelierLocal2026`; after the verified real generation its balance is $40 and one chosen outfit is in the wardrobe. The launcher uses separate game and payment services at ports 2587 and 2588, with persistent data in ignored `.tmp/atelier-local/`. External deposits and withdrawals are disabled on this stand. Image generation uses the actual configured provider and its billing.

The server reads `CODEX_SALE_API_KEY` from the ignored `.env.local-atelier` or `.env`; no key is embedded in client code or logs. Stop the launcher with Ctrl+C. Restarting preserves the local account, balance, wardrobe and interrupted jobs. This launcher is a development tool and refuses production mode.

The profile's `Образы` button opens the atelier. One generation costs $10 from the player's existing shared game balance, and produces two complete original designs. The player previews four directions and standing, walking and sitting poses, then permanently selects one. Only the selected design enters the wardrobe and may be equipped. Other candidates are deleted. A new prompt is another paid generation. Existing free character selection remains available.

Every new order creates a complete new character from its text description alone. No current portrait, generated sheet or previous prompt is sent to the provider. The face, expression, hair, body and outfit are invented anew within this casino's South Park paper-cutout style. Even stale clients' optional reference field is discarded by the server. Image quality and consistency remain probabilistic.

## Configuration and theme

Server-only `CODEX_SALE_API_KEY` uses the existing codex.sale account. Compose and `.env.example` select `gpt-image-2.5-flare` through `CODEX_SALE_SKIN_MODEL`, chosen by the owner after a live three-model comparison on 24 October 2026. Direct Node startup without this variable retains the provider fallback `gpt-image-2`; set the variable explicitly to use Flare. Requests use `/v1/images/generations`, one transparent 1024 by 1536 PNG per design, high quality, with two concurrent JSON calls per new job. No provider credentials reach the browser.

The Flare rollout changes only the model passed to the currently installed provider through the game container environment. It preserves the installed host, provider endpoint, generation count, wallet rules, saved outfits and player data. Other atelier changes in main require their own application release. A single comparison sample took 38.5 seconds through codex.sale; this is an observed request duration, not a latency guarantee or a proof that every animation frame is correct.

The atelier uses the existing shared game wallet. It does not require or enable NOWPayments, deposits, withdrawals, a second balance or a payment microservice. Without image generation credentials it shows unavailable and creates no charge. Provider credentials are configured locally in the ignored `.env.local-atelier` file; they are not printed or committed.

The deployment's theme is fixed by `SKIN_THEME` in `src/shared/skinStudio.ts` and `SKIN_STYLE` in `server/skinImages.ts`. The client cannot choose a different theme. Saved jobs, assets and equipped appearances carry the theme identifier. When adding another casino, define its own theme profile, style/reference art, renderer contract and wardrobe scope. Do not relabel the existing theme or reuse its wardrobe for another style.

## Money and recovery

Purchases are recorded in `skin_purchases` in the game database. The server fixes the price at 1,000 cents ($10). Reserve, capture and refund use the generation UUID and the same `account:<id>` transaction lock as games. A reservation debits the shared available balance once and writes an atelier entry in its ledger. Capture confirms that reservation without a second debit. A generation failure returns exactly $10 with a refund entry. Replayed requests and concurrent calls never repeat a debit or refund.

Pending atelier reservations participate in the shared wallet's capacity calculation, preserving room for a refund while other games or deposits change the available balance. Insufficient funds prevent image requests. No production test credits are installed; the local funding helper refuses every database except its isolated localhost stand.

The game persists a job before making image calls. A worker reserves payment, requests both sheets for new orders and validates dimensions, transparency and sixteen separate silhouettes. All candidates are stored before capture. A failed generation refunds the reservation and exposes no partial results. Jobs use a ten-minute database lease with fencing. A stale image request is refunded instead of generating or charging again. A ready job survives page closure until the player chooses. One unresolved generation per account and a ten-per-hour limit apply.

Candidates are private to the owner. The chosen immutable PNG is public for rendering to other players. The ordinary character update API rejects generated appearances; only ownership-checked studio endpoints equip them. Account events and room state distribute the selected appearance across lobby processes. Generated artwork is stored as PostgreSQL BYTEA, so it follows database backup and persistence, with no new Docker volume.

## Rendering

Worker updates are fenced by a unique lease token and expiry checked under the job's row lock. A late image response cannot restore a refunded job. Replaying a completed choice returns the saved result without re-equipping an old outfit. Each job stores its promised variant count. Existing jobs retain three candidates; new jobs use two. No existing wardrobe artwork is regenerated or overwritten. The open atelier refreshes the ordinary game wallet. Its generation label stays constant during background polling.

Each sheet has four direction rows (front, left, right, back) and four pose columns (standing, left step, right step, sitting). The renderer uses the standing cutout of the requested direction for all walking frames, animating its lower legs around fixed hips. It never alternates independently generated walking figures, preventing changes of face, orientation, scale and body anchor between steps, including for existing skins. Sitting uses the sitting column, with a cup overlay for drinking and body motion for reactions. Head, arm and expression animation is not independently rigged in this first version. Failed artwork downloads retain the base character and retry three times.

## Validation and release

Local full-flow verification on 22 October 2026 used three real generated sheets through the game UI. One design was selected and equipped; its appearance survived a page reload, both unselected assets returned 404, and the local available balance changed from 50,000,000 to 40,000,000 units with zero reserved. Evidence and screenshots are saved in ignored `artifacts/skin-studio/local-full/`. Regression tests additionally cover late workers, replayed choices, discarded legacy references, old three-candidate orders and delayed balance synchronization.

Tests cover shared-wallet reservation/capture/refund, refund capacity, concurrent purchases, concurrent choices, ownership, request replay, provider failure, crash recovery, HTTP authorization, candidate privacy, preview controls and mobile layout. The actual codex.sale edit endpoint returned one image in 51 seconds during the smoke check; its sheet passed normalization after silhouette-based alignment. This is a sample latency, not a service guarantee.

Run `npm run test:skins` for server regressions and `npm run test:skins:ui` for browser checks. Temporary PostgreSQL databases explicitly use UTF-8 on Windows so the existing emoji profile cases remain valid.

Production release history is recorded in `deployment/SERVER.md`. A release updates the common host/backend while preserving the existing payment service and its configuration, compare against fresh production sources, preserve parallel work and production environment/volumes, and follow AGENTS.md and deployment/SERVER.md for main synchronization, backup, image tagging and deployment recording.

## Walking correction, 24 October 2026

The event is actual actor movement; facing comes from movement state and remains fixed within each direction's walking loop. The upper body and face use the same standing image in all six phases. Only the two lower cutout pieces swing, with a fixed body position and no walking bounce. Stopping returns to that same standing image. Reduced motion removes idle decoration as before. These are game-specific design choices, not perceptual thresholds. Browser checks compare upper-body pixels across all walking frames in all directions, verify changing feet and cover old and new orders.
