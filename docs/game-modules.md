# Independently published games

GIRLHUB is the first independent client package. The hall supplies host API 1 with the existing wallet, serialized operation transport, audio, reactions and language services. The module does not instantiate another wallet. Server rules 2 and progress format 3 remain in the shared backend. Other games keep their current packaging.

Build from the qualified source tree with `npm --prefix games/girlhub run build`. The result is under `module-dist/studio-afterglow/versions/`. A version contains its JavaScript, stylesheet, 22 existing media resources and SHA-256 manifest. The game UI, math, sounds, photographs and progress rules are unchanged by this migration. Temporary integration fixtures are not part of a release.

The initial host deployment installs the loader and `/game-modules` endpoint. Compose adds the read-only mount `/opt/royal-game-modules:/app/game-modules:ro`. Public packages are separate from application images and game data. Private publication state lives in `/opt/royal-game-modules-state`, with an explicit compatible host contract in `host.json`. That file must be updated only together with a reviewed host release.

For later client releases, upload only the immutable package and the reviewed publisher. Run `python3 scripts/game-module-release.py check --package <version-directory>`, then `install` with the same package and `--expected-sha <current-active-json-sha256>`. Use `none` only for the initial installation. The publisher shares the application's publication lock, validates every file and contract, refuses stale pointers or version collisions, flushes copied files to disk, then atomically switches `active.json`. It never builds or restarts a container, changes the database, edits the host source or removes packages.

Rollback uses `rollback --version <retained-version> --expected-sha <current-active-json-sha256>`. Historical bytes are verified again. Immutable versions must remain available to already open games. Do not edit a published version in place. The next opening loads the selected version; an open game keeps the version it started with.

Both new and rolled back client packages use the existing server session and pending-operation identity. Closing, reconnecting, updating or retrying a lost response must not debit a second stake. Rule changes, progress migrations and backend work still require a full compatible host release and normal database safeguards. Independent visual publication does not imply separate math services or isolated runtime security boundaries.
