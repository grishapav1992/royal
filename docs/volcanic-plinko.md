# Veil of Night: arcane Plinko

The `royal-plinko` cabinet now opens Veil of Night (Завеса ночи), a dark fantasy presentation with the adult sorceress Vespera. Its game ID, wallet protocol, rules version, server RNG, payouts and stored operations remain unchanged. Other Originals retain their interfaces.

New rounds use exactly 12 rows and the original vFair `easy`, `medium` and `hard` tables. Their maximum multipliers are 10, 33 and 170. The theoretical returns before money rounding are 98.9794921875%, 98.9892578125% and 99.1162109375%. These are Royal's existing tables, not Luelon's different tables. Legacy uncertain requests with other row counts or the expert profile can still be retried and their actual payout is shown without projecting a different path.

The initial Luelon-style art was replaced on 20 October at the user's request. New art was generated with the built-in image_gen tool: `public/assets/arcane-plinko/hero.png` (transparent adult sorceress inspired by Yennefer from The Witcher) and `public/assets/arcane-plinko/world.png` (moonlit gothic sanctuary). Full prompts, generated originals, final saved paths and SHA-256 hashes are in `public/assets/arcane-plinko/artwork.json`. The earlier Luelon art is preserved only in `artifacts/volcanic-plinko-20261020/previous-luelon-art` and is not loaded by the game.

The rune board uses the accepted server path. Every impact has a bell cue, glow and particles. A silver-violet magical orb with orbital rings leaves a fading trail. The rectangular field has a circular ritual seal, with horizontal risk choices above it and the sorceress on its left. The mobile layout has a compact sorceress portrait above the field. Landing highlights only the paid pocket. Normal and fast animation, shared audio preferences, reduced motion, tab hiding, native rules/history dialogs, balance refresh and mobile layouts are supported. Animation does not delay or change server settlement. Closing or changing accounts cancels the local presentation and its owned audio sources.

## Local preview

The development-only entry is `tests/fixtures/volcanic-plinko.html`. It is not an application build entry. It connects to the real local API and can create an isolated test account with 1,000 demo coins. It never uses the production database.

On Windows, start the isolated API:

```powershell
$env:PORT='2618'
node --import tsx scripts/database-test.ts --import tsx server/index.ts
```

In another terminal:

```powershell
$env:ROYAL_DEV_API_URL='http://127.0.0.1:2618'
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5218 --strictPort
```

Open http://127.0.0.1:5218/tests/fixtures/volcanic-plinko.html . Optional fixture-only parameters: `skipIntro`, `width=390&height=690`, `review` for sound counters and close control, and `loseReply` to drop the first accepted play response. None of these controls are in the club renderer.

## Verification, 20 October 2026

- TypeScript and full client/server production build passed.
- Three focused Node tests passed. All 4,096 paths were checked against actual crystal collisions and final pocket coordinates. Original tables, returns, invalid paths and mismatched payouts were checked.
- A real temporary PostgreSQL/API flow covered three risks, exact balances, idempotent replay, conflicting retries returning HTTP 409, and concurrent identical requests producing one debit.
- Browser checks covered all three risk profiles, normal/fast play, 12 impact cues per animated round, sources returning to zero, close during playback, narrow 390-pixel layout, lost-response recovery, and rules inside the standard GameWindow.
- Existing browser regression cases were adapted to the Canvas interface. The complete legacy browser suite was not run in this Windows session. No physical mobile device or subjective listening comparison was performed.

Evidence is under `artifacts/volcanic-plinko-20261020/proof`. This change has not been deployed. Before any production release, reconcile with the current production sources as required by `AGENTS.md` and `deployment/SERVER.md`; the historical root checkout is not a complete production release baseline.

The redesigned 390-pixel layout and desktop layout were inspected in the browser. A real local wallet round reached its paid pocket. Three focused tests covering all 4,096 paths, TypeScript and the client production build passed after the redesign. No server math, wallet routes, database or production deployment was changed.

## Player audit, 20 October 2026

Run `node --import tsx scripts/game-math/plinko-player-audit.mjs` for exact monetary checks on all 4,096 paths, each risk and each allowed stake (49,152 checks), three million cryptographic random samples, and 1.2 million seeded player sessions. The session model starts at 1,000 coins, uses a fixed stake of 10, 50, 100 or 500, plans 100 rounds, and stops when the next full stake is unaffordable. A positive payout below the stake counts as a net loss, never as a win.

With the isolated local API running, `node --import tsx scripts/game-math/plinko-player-api-check.mjs` checks 40 real rounds per risk, exact balances and ledger entries, replay, conflicting replay, concurrent duplicates, invalid inputs, account mismatch and insufficient balance. It rejects remote API hosts. The report and saved source hashes are under `artifacts/plinko-player-audit-20261020/`; `report.html` includes the exact probabilities, random observations and session distributions.

At the default 50-coin stake, the modeled median final balances were 935, 855 and 45 coins for easy, medium and hard. Observed early stops were 0%, 5.665% and 52.437%. These describe this simulation, not guarantees for a player. The high-risk random sample returned 98.17866%, below its exact 99.1162109375% RTP; the exhaustive calculation remains authoritative and the random sample was retained without selecting a more favorable rerun.

The browser lost-response scenario recovered the accepted operation after reload: a 10-coin stake paid 5, the balance moved from 940 to 935, and retry kept it at 935. The animation completed 12 impacts and one landing, with owned audio sources returning to zero. A small recovery-label mismatch was corrected to consistently say "Проверить результат". TypeScript, the client production build and `git diff --check` passed after this correction. No production deployment was performed.

## Release preparation, 20 October 2026

The release is prepared in the managed `veil-of-night-release` worktree on top of `origin/main` commit `bc4d0fd05b7bed84c5d83425f235ede66d833397`. It preserves the current LAST EXIT, cat, Mira, wallet, payment and other game sources. Only the royal-plinko branch of `OriginalGames` is replaced; the existing Dice and Limbo presenters and the separate variant Plinko stay intact. The previous Plinko presenter remains available in source for the other variant.

The new game uses the existing RU/EN language selection and number formats. Its own English dictionary covers the scene, controls, outcome notices, recovery, rules and history. This does not change game rules or account data. TypeScript, the full client and three server bundles passed. With the proper isolated PostgreSQL harness, all 40 focused Originals/security/audio/Plinko checks passed. The first direct invocation without that database harness could not initialize its database; the configured run passed without source changes. A fresh local API run passed 120 normal rounds, three concurrent duplicate scenarios and all replay, account and insufficient-balance checks.

The $100,000 initial balance, $500 fixed stake and 1,000-round model is reproducible with `node --import tsx scripts/game-math/plinko-bankroll-simulation.mjs`. It stores the Monte Carlo results and computes rare early-stop probabilities by finite first-passage recursion, separately from observed frequencies. It does not send requests to any wallet.

Production must still be compared against the live server immediately before publishing. The SSH identity specified in AGENTS.md was not present in this Windows environment during preparation. A local or GitHub build does not establish a successful production deployment.

After Windows access was authorized, the live snapshot matched 935 application source files in the GitHub release base. The protected server deployment log and unused LobbyRoom.ts.orig remain operational exclusions. A check through the real club catalog found that the generic viewport reduced Plinko to a small frame. GameViewport now treats the responsive Plinko canvas as a native layout, preserving readable controls across the available game area. The legacy game-window fixture was updated to import the current GameViewport and can constrain its dialog with width/height parameters for layout review. These fixture controls are not application build entries.

## Vespera animation, 21 October 2026

The first local portrait preview used weighted upper-body sway, independent head tilt, flowing hair and sleeve, subtle rising mouth corners, a direct gaze and a pulsing violet orb. The second revision below replaces its deforming pose after visual feedback. A generated closed-eyes frame supplies the eyelids; it is blended only over the eye region so other details do not crossfade. The same single WebGL renderer moves to the left portrait on entry, at 55 percent of the welcome motion amplitude. The original hero artwork remains the loading, reduced-motion and unavailable-GPU fallback. The game math, API, wallet and sound behavior are unchanged.

The renderer caps output at 30fps and proportional 1100x1500 bounds, pauses for hidden documents and offscreen portraits, and frees its frame callback, observers, listeners, buffers and textures on close. The fixture review controls exercise reduced motion, context loss and restoration, and report portrait frames/blinks alongside existing round sound counts. They are not included in the production build.

Validation: TypeScript for the application and preview fixture, client production build, desktop and 390-pixel container browser checks, live reduced-motion stop/resume with a stable stopped frame count, context-loss fallback and recovery, and a local 50-coin round with 12 hits and one landing. Browser console contained no errors during these checks. Proof is under artifacts/vespera-animation-20261021/proof. This animation is a local preview; this entry does not establish a production deployment.

## Vespera animation revision 2, 21 October 2026

The first rig made skin and body details look liquid. The revised renderer uses high-precision texture coordinates, removes torso dilation and lip-corner warping, and moves the face/skull as a rigid shape. A solid facial guard excludes skin and features from the stronger traveling hair wind. Finger tips bend around their own joint positions near the sphere. The body retains its proportions.

An authored, registered expression asset adds a single-eye wink, a small asymmetric smirk and a lifted eyebrow. Only the appropriate eyelid, lip and brow regions blend over the base image. An 18-second timeline separates normal blinking, finger gestures, head turns and the occasional wink. The sidebar halves wind, head and finger amplitudes while keeping the expression readable.

The local review fixture can freeze the wind, wink or finger gesture for visual inspection. Reduced-motion, GPU-loss/recovery, cleanup and static fallback remain supported. The existing game math, wallet contract and sounds are unchanged. This revision remains a local preview.

Revision 2 validation: application and fixture TypeScript passed; the client build passed. A 2,161-sample pose audit checked bounded expression values, non-overlapping ordinary blink and wink, neutral gesture loop seams and half-strength sidebar movement. Browser review covered frozen wink/smirk, finger and wind poses, live playback, reduced-motion fallback, GPU loss and recovery, desktop-to-sidebar handoff and 390-pixel containers. A 50-coin local round paid 25 coins at 0.5x, with 12 hits, one landing, zero remaining audio sources and no console errors. Evidence is in artifacts/vespera-animation-20261021/v2.

## Vespera bitmap frames, 21 October 2026

Following feedback about the moving ear, shoulder and head, the procedural WebGL rig is replaced by Canvas 2D playback of generated artwork. Six alpha PNG atlases contain 24 separate 512x768 drawings. The source sheets are retained unchanged. Only whole-frame registration offsets of zero or one source pixel are applied; skin, hair and clothing are not mathematically displaced or crossfaded at runtime. A one-pixel source inset prevents neighboring atlas cells from bleeding into frame edges.

The frame clock runs at 24fps with intentionally repeated resting poses. This is 24 authored drawings, not 192 distinct drawings for the 8-second welcome loop. The hand moves from the outer hip toward the waist, holds the waist pose, briefly winks and returns. Hair, feathers and loose lace change in the drawings. The sidebar cycle adds longer resting periods for a 12-second loop. This is a local animation prototype; generated costume and contour details can still vary between drawings and need artistic review.

The renderer pauses for hidden/offscreen views and reduced motion, keeps the original portrait as loading/error fallback, and releases observers, listeners, image references and its canvas on close. It does not require WebGL. The local review controls can freeze hip, transition, waist and wink poses; these controls are not production UI. Frame source paths, prompts, grid size and SHA256 checksums are recorded in public/assets/arcane-plinko/frames/artwork.json. One sheet recovered after interruption has a reconstructed prompt summary; the incompatible earlier second sheet remains only in ignored artifacts.

Bitmap playback validation: application and fixture TypeScript and client production build passed. The frame-clock audit covered all 192 welcome and 288 sidebar ticks, all 24 drawings, cycle wrap and bounded registration offsets. Browser checks covered hip/waist/wink poses, a stable reduced-motion frame count (657), resume, missing-Canvas fallback (zero frames), 390-pixel width without horizontal overflow, and removal of the portrait canvas on close. A local 50-coin round returned 50 at 1x, balance 975 before/after, 12 hits, one landing and zero remaining audio sources. Browser console contained no errors. Proof is under artifacts/vespera-animation-20261021/v3. No production deployment was performed.

## Vespera video loop, 21 October 2026

The user supplied seedance-25-max_video_2026_10_21_19_54_47.mp4 replaces bitmap playback with a native video portrait. The original in Downloads is unchanged. The first source frame was an outlier; a six-frame crossfade joins matching tail and head poses, then the loop wraps between adjacent source frames. The result contains 186 frames at 24fps, lasts 7.75 seconds, and is encoded as fast-start H.264/AAC at 786x1178. Its size is 2,804,626 bytes, compared with the 8,461,054-byte source. Source/output checksums, frame ranges, encoding recipe and seam measurements are in public/assets/arcane-plinko/vespera-video.json.

One muted inline video moves from the welcome screen into the sidebar without resetting playback. Audio is retained in the downloadable file; the portrait stays muted so the existing game sounds remain in control. Static artwork covers loading, playback failure, blocked autoplay and reduced motion. Hidden/offscreen views pause playback; closing releases the media source, observers and frame callback. The earlier generated drawings remain available as source assets and are not loaded by this renderer.

Validation: application and fixture TypeScript, client production build and git diff checks passed. Browser review covered five continuous loop wraps, welcome-to-sidebar handoff, reduced-motion pause with unchanged currentTime and resume, 390-pixel layout with scrollWidth equal to clientWidth, one video element, and zero video elements after close. The media reports duration 7.75, loop=true and muted=true. The narrow view console contained no errors. Sixteen frames around the boundary were visually inspected. Evidence is in artifacts/vespera-video-20261021. This is a local preview; no production deployment was performed.

## Video-matched background, 21 October 2026

The scene now uses a charcoal #080808 base matching the upper backing of the supplied video. The existing moonlit environment fades in toward the right of the desktop scene and below the character on narrow screens. The header, result strip, controls, portrait caption and board panel use neutral charcoal with amethyst accents. Narrow welcome artwork has a soft lower edge where the portrait is cropped by its container.

Playback uses the original-colour loop as a single native video. Its hair, skin, clothing and spell retain the source pixels. A narrow outer-frame fade joins the video rectangle to the matching scene. The experimental silhouette-matte video, preparation script and renderer are archived under artifacts/vespera-video-20261021 and are not application assets.

Application TypeScript, the client production build and diff checks passed. Desktop welcome and game screens and both 390-pixel layouts were reviewed in the browser. The narrow preview has clientWidth=scrollWidth=390, one video, no portrait canvas and no console errors. Native looping and welcome-to-sidebar handoff remained active. Screenshots and verification are in artifacts/vespera-video-20261021/backdrop. This change is local and has not been published to production.

## Event-driven portrait, 21 October 2026

The default portrait is now a quiet three-second idle loop. It uses the first thirteen frames of the supplied video, moves smoothly forward and back through that small pose range with a cosine timeline, and blends neighboring video frames without spatial deformation. The idle file contains 72 frames at 24fps and occupies 578,675 bytes. Measured mean adjacent-frame RGB change is 0.306 for idle versus 2.053 for the full gesture at the same analysis resolution. The hand stays near its resting pose while the hair, clothing and spell move slightly.

The full 7.75-second gesture plays once on entry from the welcome screen or direct entry, portrait-button activation by pointer or keyboard, and visible confirmed round results with a multiplier of at least 3. It returns to idle when it ends. Reactions share an 18-second interval between starts. Events during a gesture or cooldown are ignored without a queue. Two preloaded native videos crossfade over 350ms, with the inactive layer paused; a single portrait player moves between the welcome screen and sidebar. Hidden/offscreen views pause, reduced motion shows static artwork and suppresses reactions, and close removes both media elements and their callbacks. This presentation does not delay rounds or alter settlement.

Validation: application and fixture TypeScript, client production build and diff checks passed. Browser checks covered default idle with no reactions, entry and direct-entry greetings, one-shot completion and return, keyboard activation, repeated events during playback and cooldown, 2x ignored versus 3x accepted, reduced-motion pause/resume with both video times unchanged while paused, a 390-pixel container without horizontal overflow, inactive gesture paused after completion, zero video nodes after close and no console errors. The fixture's 2x/3x controls exercise only the portrait and do not create wallet operations. Recipe, quiet-motion measurements, screenshots and verification are in artifacts/vespera-video-20261021/events. No production deployment was performed.

## Portrait loading and storage, 21 October 2026

The videos are project static files in public/assets/arcane-plinko, copied to dist/assets/arcane-plinko by the client build and /app/dist/assets/arcane-plinko inside the published Docker image. Playback requests the Royal origin and has no Seedance or external video-host dependency. Originals and the previous delivery files remain available; the application references new content-hashed assets.

Desktop uses 720x1080 H.264 clips: 296,530 bytes for idle and 1,116,100 bytes for the gesture. Containers up to 650 pixels select 480x720 clips at 184,565 and 698,012 bytes. Both profiles retain 24fps and the three/7.75-second durations; the muted playback files omit audio. A 70,896-byte WebP first-frame poster replaces the 2.82MB PNG fallback request, and a 197,120-byte WebP copy replaces the 2.54MB PNG world request. This is format/size optimization, with the original artwork preserved. The selected profile is held for that open game session.

The initial portrait/background set is 564,546 bytes on desktop or 452,581 on mobile. The full gesture starts preloading 250ms after idle appears, or on a player's explicit request. The complete set, including the full gesture, is 1,680,646/1,150,593 bytes versus 8,888,717 previously. A pending entry or manual interaction may run once after buffering within eight seconds; hidden or expired requests are cancelled. Errors retain the idle view and allow a later explicit retry.

The local candidate included scoped static headers for content-hashed portrait/world assets. The production release below instead uses the existing one-year immutable cache on versioned game-module resources, so no server header change or restart is needed. HTTP checks on an isolated Express server using the actual built assets verified 206 byte ranges, ETags and 304 validation, content types and missing files. All four MP4s have moov before mdat for progressive startup. Local Vite deliberately retains its development cache validation.

Application/fixture TypeScript, client build and server bundle passed. In the local browser, idle first appeared 82-173ms after player construction; these are localhost measurements, not Internet timing guarantees. Checks covered both resolution profiles, preserved picture quality, a five-second delayed gesture starting once after an earlier click while idle continued, and an expired ten-second delayed request staying idle. SHA256 hashes, encoding arguments, sizes, HTTP results and screenshots are in artifacts/vespera-video-20261021/loading and the public media manifest. These changes have not been deployed.

## Portrait background seam revision 2, 21 October 2026

The complete portrait now composites with lighten after the internal idle/gesture crossfade, so its charcoal rectangle cannot darken the surrounding world. Applying this to the group keeps the two video poses from accumulating as separately lightened layers. A broad radial charcoal veil replaces the straight desktop background transition. A soft CSS amethyst halo extends the spell's low-intensity light beyond the encoded right edge, aligned with the actual contained video rectangle in both the welcome and sidebar views. Intro text stays above this decoration. The video files, foreground geometry, existing frame-edge masks, event policy and loading sequence are unchanged; no additional media is requested.

Application and fixture TypeScript, the client production build and diff checks passed. Browser review covered the desktop idle and waist poses, entry reaction and return to idle in the sidebar, 390-pixel welcome/game views without horizontal overflow, and paused videos under reduced motion. Both views had no console errors. Screenshots and verification are in artifacts/vespera-video-20261021/seam-v2. This revision remains local and has not been deployed.

## Modular video publication candidate, 21 October 2026

The release is reconciled with the newly published modular host at 7fdb80e. Plinko packages only six referenced delivery assets, including four MP4 profiles and two WebP images; generated drawing experiments and obsolete media are excluded. Literal resource URLs let the builder pin each video to its immutable module version. The module remains on API/rules/progress contract 1. The new portrait button label is also localized when used with the previous shared host dictionary.

MP4 is added to the builder, publisher and host manifest resource allowlists. Existing traversal, hash, contract and immutable-version checks remain in place. The build bridge normalizes Windows separators and retries brief filesystem locks. Validation includes 111 built packages, nine module/Plinko tests, eleven publisher safeguards in Linux temporary directories, TypeScript, the host client build and actual compiled-module playback. The guarded publisher and evidence are under deployment/releases/vespera-video-20261021-v1. Production status is recorded separately in deployment/SERVER.md after public verification.
