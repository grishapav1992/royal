# Paid character skins

Actual generated artwork receives [short visual descriptions for NPCs](skin-npc-context.md), independently of the player's original request.

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

Each sheet has four direction rows (front, left, right, back) and four pose columns (standing, left step, right step, sitting). The renderer cycles whole standing, left-step and right-step figures from the requested direction. The complete drawn arms and legs move together, with no artificial cuts through the body or joints. The normalized cells share the same scale and foot baseline. Sitting uses the sitting column, with a cup overlay for drinking and body motion for reactions. Head, arm and expression animation is not independently rigged in this first version. Failed artwork downloads retain the base character and retry three times.

## Validation and release

Local full-flow verification on 22 October 2026 used three real generated sheets through the game UI. One design was selected and equipped; its appearance survived a page reload, both unselected assets returned 404, and the local available balance changed from 50,000,000 to 40,000,000 units with zero reserved. Evidence and screenshots are saved in ignored `artifacts/skin-studio/local-full/`. Regression tests additionally cover late workers, replayed choices, discarded legacy references, old three-candidate orders and delayed balance synchronization.

Tests cover shared-wallet reservation/capture/refund, refund capacity, concurrent purchases, concurrent choices, ownership, request replay, provider failure, crash recovery, HTTP authorization, candidate privacy, preview controls and mobile layout. The actual codex.sale edit endpoint returned one image in 51 seconds during the smoke check; its sheet passed normalization after silhouette-based alignment. This is a sample latency, not a service guarantee.

Run `npm run test:skins` for server regressions and `npm run test:skins:ui` for browser checks. Temporary PostgreSQL databases explicitly use UTF-8 on Windows so the existing emoji profile cases remain valid.

Production release history is recorded in `deployment/SERVER.md`. A release updates the common host/backend while preserving the existing payment service and its configuration, compare against fresh production sources, preserve parallel work and production environment/volumes, and follow AGENTS.md and deployment/SERVER.md for main synchronization, backup, image tagging and deployment recording.

## Walking correction, 27 October 2026

The event is actual actor movement; facing comes from movement state and remains fixed within each direction's walking loop. Whole prepared poses provide the arm and leg movements. The six phases use standing, left step, left step, standing, right step and right step at the shared game rate of 12 frames per second. Stopping returns to the standing pose. The fitting room uses the same phases, renderer and cadence. The earlier lower-leg rotation introduced detached joints and froze the arms, and has been removed for both new and saved skins. No wardrobe image is regenerated. Sitting, drinking and game reactions retain their existing complete poses. Browser regressions check that hands move relative to the head, feet alternate, and the connected figure stays intact in every direction and phase. These are game-specific presentation choices, not perceptual thresholds.

## Walking alignment, 30 October 2026

Whole generated poses can have different head positions or a reversed profile even when they share a direction row. Loading a sheet now measures its walking cells against that row's standing head on a small RGBA thumbnail. Each complete pose receives one translation and uniform scale around the ground anchor. A reversed profile is mirrored as a complete figure when it matches the reference better. An unusable cell uses the complete standing figure. Arms, legs, clothing and their connections remain intact; bodies are never sliced into separately rotated pieces.

The shared renderer applies this once per loaded sheet in both the room and the fitting preview. Existing immutable PNGs, saved choices and payments are unchanged. Alignment does not make an image-generation request. Sitting and reactions retain their original poses. The bounded search and similarity cutoff are conservative engineering choices for the casino's paper-cutout style, not perceptual or scientific thresholds. Regressions use shifted, resized and mirrored complete figures and verify fixed head/ground anchors, moving connected limbs and monotonically leftward travel while holding Left in the real fitting component. Run `node --import tsx --test server-tests/skin-pose-alignment.test.ts` and the existing skin UI suite.

## Interactive fitting room, 25 October 2026

New orders offer two designs. Each candidate has a front thumbnail and a try-on button. The same atelier dialog contains a walkable fitting room using `drawGeneratedSkin` and `movementFacing`, exactly as the game renders generated artwork. Click or tap the floor, hold WASD or arrow keys while focused in the room, or hold the directional buttons. The sitting button checks the game's seated pose. Trying a candidate does not equip it, save it or send a movement request. Saving the selected candidate remains the explicit permanent choice. Already paid three-candidate orders retain every promised candidate.

The six game walking phases follow actual local movement, stopping returns to the standing cutout, and sitting is explicit. The second motion stage adds subtle resting breath with the feet anchored; the preview has no audio. Closing, changing account, losing focus or hiding the page clears input. The animation loop stops when the dialog closes. Resizing preserves the relative horizontal position. Wardrobe skins can also be tried without changing the equipped skin. When a different order becomes ready, the room automatically switches to its first new candidate; refreshes of that same order preserve the candidate being tried.

Browser coverage checks keyboard and floor movement, touch-sized directional controls, sitting, switching candidates, close/reopen, account changes, explicit selection and mobile overflow. The isolated local atelier initializes the wallet entry before importing the funding helper to avoid its pre-existing ESM import cycle; production wallet behavior is unchanged.

## Character motion, second stage, 27 October 2026

Live actors and the fitting room share a distance-driven gait. One cycle covers 77.5 world units, preserving the existing 12 phases per second at normal speed (155 units/s). Sprint and slower motion advance with actual rendered travel; turns preserve fractional progress. A stale moving flag holds the current pose briefly, then plants the feet after 150 ms without travel. Stopping plants them immediately, including during an idle animation delay. Jumps and long update gaps do not accumulate footfalls. These values are presentation choices for this game, not research thresholds.

| Event | Visual and sound | Interruption and verification |
| --- | --- | --- |
| Actual travel crosses each half-cycle | Whole walking pose reaches planted phase 3 or 0. Existing step sound and fading footprint fire once at that same update. The existing distance attenuation and sound mix remain. | No travel produces no sound or footprint. Stops reset the gait; turns retain it. Reduced motion suppresses footprints. Compare normal, sprint, different frame rates, stalls and resumed movement. |
| Standing or sitting without another action | A small whole-figure breath (0.8% vertical, 0.3% horizontal, 4.2 s cycle) fades in over 0.5 s. Feet stay anchored, including in the fitting room. Individual actors have different phases. | Walking, drinking and game reactions reset the decoration. Reduced motion uses exact base scale. Closing the fitting room stops its loop; changing skins resets its motion state. |

The preview uses the live scene's reduced-motion choice and the same reference speed. It has no sound. The existing complete-pose artwork renderer is unchanged. Tests verify logical sound-to-pose alignment, not physical device latency or subjective listening quality. Phone speakers, headphones and Bluetooth have not been separately measured for this update. The full host with chat must also be checked on desktop and mobile before release.
