# Instructions

- Never use the em dash character (Unicode U+2014) in generated text.

## GitHub synchronization before work

- Before every new implementation, review or debugging task, run `git status --short --branch`, `git fetch origin`, and `git rev-list --left-right --count HEAD...origin/main`. Use the freshly fetched `origin/main` from `https://github.com/grishapav1992/royal` as the integration baseline. Fetching alone does not update working files.
- If the current checkout is on `main`, has no local changes and is only behind, update it with `git merge --ff-only origin/main` before starting work.
- If the checkout has staged, unstaged or untracked changes, or cannot fast-forward, preserve that work. Start independent tasks in a suitable clean managed worktree based on the latest `origin/main`. When continuing an existing task, preserve its commits and deliberately reconcile the relevant local changes with the current main. Never automatically stash, reset, clean, overwrite files or force-push to synchronize.
- Read the fetched `origin/main:AGENTS.md` when local instructions differ, and apply its current project rules together with applicable local instructions. Do not request confirmation for routine fetching, clean fast-forward updates or creating an isolated worktree within the authorized task.
- Fetch again before integrating, pushing or publishing, and reconcile changes made by other chats. If fetching fails, report that freshness could not be verified; do not claim that the checkout is current or silently publish from an outdated base.

## Disk usage, temporary files and backup retention

- Treat the main checkout and Git history as the source of truth. Do not create a full project copy for each attempt, test or release. Reuse build outputs and dependencies where compatible; create an isolated checkout only when concurrent work actually requires it.
- Before a large copy, archive, build or publication, measure free disk space and the expected additional footprint. Preserve at least 10 GiB free on the PC and 5 GiB on the server. First reduce the footprint or clean eligible temporary outputs if the operation would cross that reserve. Do not continue filling the disk when safe cleanup cannot provide enough space.
- Use one task-owned temporary directory under `artifacts/work/<task-id>/`. Record its owner, purpose and cleanup condition in a small metadata file. Do not duplicate `.git`, `node_modules`, existing build outputs, caches, databases, `.env` files or SSH identities into staging copies. Keep temporary artifacts within 2 GiB in total where possible; document a necessary larger active workload and its cleanup condition instead of leaving it indefinitely.
- Local builds must reuse the normal output directories. In local `module-dist`, keep the active package for each game; retain older packages only while a known running test or game session still needs them, then remove them. Do not accumulate a new permanent set of packages after every build.
- Cleanup is a required part of completing a task, including a failed attempt. After verification, remove that task's obsolete staging copies, release archives, dependency copies, build attempts and redundant screenshots, traces, videos and logs. Keep compact final verification reports. On resuming an interrupted task, include its abandoned temporary files in this review. Routine cleanup of owned, verified temporary outputs does not require a separate user request.
- Keep one verified local project backup. It must preserve the main source snapshot and all unique historical source files and required assets that have not been safely reconciled into the main checkout or Git. Keep a path manifest and checksums so these files can be restored. Never replace the backup with a fresh snapshot that silently drops unique files from the previous backup.
- Rotate the local backup by creating and checking its successor first, including a sample restore, then deleting the previous archive. Two archives may coexist only during this rotation. Exclude regenerable builds, dependencies and caches from new source backups. Preserve existing unique material when consolidating older archives.
- Before deleting any checkout or archive, verify that its unique source, assets and unpublished Git commits are preserved in the main checkout, shared Git history or the single verified backup. Never delete the only copy. Preserve other chats' active work and files changed since the cleanup inventory; record the task owner and the condition for their later cleanup. Do not use blanket recursive deletion of `artifacts`.
- After a production release passes verification, use the existing retention tooling and publication locks to keep the current application release and one verified rollback set (required source, image and release metadata). Remove obsolete application backups, release folders and unreferenced application images after that set is verified. Protect running containers and pinned releases; never use a broad forced Docker prune. Keep immutable game packages still needed by open sessions or the rollback set until they can be safely retired.
- Application retention must not delete or alter player data, persistent volumes, production configuration, or database and financial backups governed by their own policy. After cleanup, report free space before and after, retained backup location and size, and any active-work exceptions with their cleanup condition. Do not claim disk space was reclaimed by this task when another task performed the deletion.

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
