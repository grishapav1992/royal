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
