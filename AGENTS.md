# Instructions

- Never use the em dash character (Unicode U+2014) in generated text.

## GitHub synchronization before work

- Before every new implementation, review or debugging task, run `git status --short --branch`, `git fetch origin`, and `git rev-list --left-right --count HEAD...origin/main`. Use the freshly fetched `origin/main` from `https://github.com/grishapav1992/royal` as the integration baseline. Fetching alone does not update working files.
- If the current checkout is on `main`, has no local changes and is only behind, update it with `git merge --ff-only origin/main` before starting work.
- If the checkout has staged, unstaged or untracked changes, or cannot fast-forward, preserve that work. Start independent tasks in a suitable clean managed worktree based on the latest `origin/main`. When continuing an existing task, preserve its commits and deliberately reconcile the relevant local changes with the current main. Never automatically stash, reset, clean, overwrite files or force-push to synchronize.
- Read the fetched `origin/main:AGENTS.md` when local instructions differ, and apply its current project rules together with applicable local instructions. Do not request confirmation for routine fetching, clean fast-forward updates or creating an isolated worktree within the authorized task.
- Fetch again before integrating, pushing or publishing, and reconcile changes made by other chats. If fetching fails, report that freshness could not be verified; do not claim that the checkout is current or silently publish from an outdated base.

## Mandatory game mathematics qualification

- Before adding a wagered game or changing probabilities, paytables, free spins, multipliers, collection progress or paid costs, register its RTP policy and qualify the complete paid round, including every bonus continuation, allowed stake and player choice. Preserve accepted rounds under their original rules.
- Run `npm run check:rtp` and the relevant mathematical, wallet and compatibility tests. `npm run build` and independent module builds enforce current source hashes and qualification evidence. A stale or missing qualification is a release blocker; do not bypass the gate or edit a proof to make a build pass.
- Regenerate evidence with `npm run qualify:rtp -- --game <game-id> --write-proof` after changing mathematics. Use independent qualification seeds, integer settlement, confidence limits and explicit target/tolerance; distinguish observed estimates from exact analytical RTP.
- `scripts/game-math/rtp-legacy-baseline.json` freezes existing modules outside this initial gate. It does not qualify them and must not be expanded to admit new games. Register new wagered modules with qualification or explicitly document genuinely non-wagered modules.
- The legacy baseline also freezes mathematical source hashes. Changing a frozen source requires qualification profiles covering every affected game and mode; unchanged legacy sources are not evidence of acceptable RTP. Do not update the baseline to avoid qualification.

## Game animation and sound

- Before designing or changing game animation and audio, read `docs/game-feedback.md`. Use its event specification and verification guidance together with the game's existing design and module boundaries. Preserve choices already authorized by the user.
- Distinguish research findings, game-specific design hypotheses and measured results. Do not present arbitrary timings as scientific thresholds, signal presence as listening quality, or greater play time as proof of enjoyment.

## New games and module boundaries

- Implement every new game as an independent client module under `games/<slug>/`, with its own entry, package metadata, TypeScript configuration and game-specific assets. Follow `docs/game-modules.md` and register its identity and compatibility contract in `src/modules/GameModuleCatalog.ts`.
- Open games through the shared module loader. Keep the wallet, operation transport, sessions, authentication, language, audio and server rules in the common host/backend. Do not create a separate wallet, balance store or microservice for a new game.
- Preserve the host game window, responsive sizing and the connected chat beside the game. Verify the real host with chat enabled on desktop and mobile; mounting a game in an isolated fixture is not sufficient for layout verification.
- Before publishing a new module or update, build and verify its package, confirm that wallet recovery and close/reopen behavior remain correct, and follow the production and GitHub requirements below. A new incompatible host contract requires a compatible host release before independent publication.

## Production server access

- Read deployment/SERVER.md before deploying.
- Server: root@45.192.12.242, application directory /opt/royal, Docker Compose.
- SSH identity on this computer: ~/.ssh/royal_server_ed25519. Use ssh -i "$HOME/.ssh/royal_server_ed25519" -o BatchMode=yes root@45.192.12.242.
- The private key stays outside the project. Never print or copy it into source, archives, or chat. The key is available to other local chats on this computer.
- codex.sale API key is separate: CODEX_SALE_API_KEY in the local and server .env files. Never print these files or replace the server .env with the local one. Preserve production domain settings.
- Back up source and tag the previous image before publishing. Preserve the existing game_data volume.

## Production changes and GitHub

- Every change published to the production server must also be committed and pushed to `main` in `https://github.com/grishapav1992/royal`. This applies to application releases, independent game modules, hotfixes, and rollbacks.
- Before publishing, compare the release with the current production source and preserve changes from other chats. If the release is prepared in an ignored `artifacts/` stage or directly on the server, reconcile its actual source, required assets, build configuration, and migrations into the tracked project paths. Do not push an outdated root checkout as the source of that release.
- Validate the release, commit its corresponding source, and push to `origin/main` before publishing those same sources. Include only changes belonging to the release; preserve unrelated local work. Never force-push over other changes.
- Never commit secrets, `.env` files, private keys, database contents, or production user data. Preserve production environment settings and persistent volumes.
- Record the Git commit, release or image identifier, and verification result in `deployment/SERVER.md`. Commit and push the deployment record after verification. For a rollback, record and push the source change that restores the selected version.
- A deployment is complete only when the running release corresponds to source saved in `royal`, the deployment record is pushed, and production checks pass. If GitHub synchronization fails, report the deployment as incomplete and resolve the synchronization; do not claim that the repository is up to date.
