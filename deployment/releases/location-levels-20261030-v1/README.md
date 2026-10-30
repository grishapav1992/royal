# Location levels guarded host overlay

This release installs location experience, its account-scoped progression API and fixed free-spin grants in the current shared virtual wallet. It changes only the fourteen required host/backend source paths listed in `scope.json`, optional explicitly listed new supporting sources, the reviewed client index/new hashed bundles and `dist-server/index.js`. Existing game rules, game packages, Go executables, dependencies, auxiliary backend programs, payment and reconciliation services, Nile programs, private configuration and persistent mounts are retained.

The installer reuses the existing tracked `cat-purr-hall-only-20261030-v1/deploy.py` as `overlay-base.py` in the transport package. Its exact SHA-256 is pinned in the new wrapper. This avoids another tracked copy of the publication and uncertain-Docker recovery implementation. `scope.json.references` identifies the other reviewed helper sources to copy into the package. Their package hashes are mandatory. No helper creates a source checkout or a dependency/runtime staging copy on the server.

## Required prepared package

After the source is committed and pushed to main, use the standard `release:prepare` and `release:verify --github` workflow with the tracked host and backend projection configurations. The following package files are required:

- `deploy.py`, `snapshot.py`, `scope.json`, `quiesce.cjs`, and the reference helpers from `scope.json.references`.
- `source/`, `dist-delta/`, `server-delta/index.js`, with exact inventories in `install-manifest.json` as `changed`, `delta`, and `serverDelta`.
- The unmodified official `release-manifest.json` and `release-github.json`, bound by `releaseManifestSha256` and `receiptSha256`.
- `backend-projection.json`, the tracked projection configuration, and `backend-projection-report.json`, the exact `backendProjection` object from the official manifest. The report hash is `backendProjectionSha256`. Its configuration hash, production commit, inputs/origins and output hash are checked again.
- `helperSha256`, `snapshotSha256`, `scopeSha256`, and a `helpers` map containing exactly `overlay-base.py`, `financial_gate.py`, `quiesce-base.cjs`, `quiesce.cjs`, and `runtime-inventory.cjs`.
- `compatibility.hostContractVersionsUnchanged`, `compatibility.bundledAndExternalModulesRetained`, and `compatibility.dependencyLockEquivalent`, all true after their preparation checks.

`before` is the complete reviewed baseline: raw `source` and `sourceLF` maps, `sourceCommit`, full `program` and `preparedProgram` maps, prepared image ID, game container metadata, every persistent service identity and `serviceProfiles`, private configuration hashes, external module inventories and host contract hash. `before.protectedPrograms` additionally binds the retained Nile `play.js` and `proof.js` bytes to their unchanged service identity; the snapshot hashes only explicitly allowed code filenames and never environment or data paths. Environment values and player data do not belong in this JSON or in Git. Prepared and running images may have different identities only when their complete runtime inventories have already been verified identical. Their distinct rollback tags are both preserved.

The backend artifact must equal `release-manifest.files["dist-server/index.js"]`. The projection report must be identical in the top-level manifest and its build report. Every backend input must match either an explicitly replaced source or the retained production raw/normalized source fact. The installer rejects an unknown input, a changed immutable client asset URL or any extra backend bundle.

Run `node deployment/releases/location-levels-20261030-v1/prepare.mjs` after official verification. Set `ROYAL_GIT_BINARY` to the bundled Git executable if the system Git is unavailable. The preparer uses the existing `module-build/release-manifest.json`, `module-build/release-github.json` and `artifacts/work/location-levels-mvp/baseline.json`. It performs no build, network request or production operation. It requires a clean committed checkout, a receipt matching the local `origin/main`, and the exact production and feature source commits pinned in the reviewed configurations.

The preparer writes only `artifacts/work/location-levels-mvp/publication`, refuses an existing directory, and keeps a 10 GiB local free-space reserve. Only the fourteen projected source files, changed client index/new hashed bundles, backend index and bound metadata/helpers enter this directory. It creates no source checkout, dependency copy or transport archive. The unchanged catalog read by the verified client must contain exactly the installed host compatibility versions. Dependency resolution fields must match the retained production package configuration, and the local lock hash must match the installed lock. Newly built unrelated modules and auxiliary programs from the official application build remain outside this publication.

## Guards and additive migration readiness

All operations hold the existing application, client-presentation and module publication locks. Baseline source/runtime/configuration/service checks repeat under those locks before build, after build and before publication. Candidate and final running inventories include dependencies, all bundled modules and every auxiliary backend program. External module symlinks and host contract symlinks are rejected.

The quiesce wrapper extends the reviewed PostgreSQL lease protocol. It first waits for all active casino sessions, Mines, Flight, combat, PvP holds and reserved skin purchases to finish. It does not cancel or ignore them. Once no obligations remain, it takes a nonblocking SHARE table fence over the account, wallet, operation, session and escrow tables and checks again. This fence covers native account transactions, which are not protected by the older schema advisory lock alone. A competing writer causes rollback and another drain attempt; it is never bypassed.

Using the unchanged application's database credentials, the same gate verifies schema USAGE/CREATE and ownership privileges needed for the additive index on `demo_ledger`. It does not grant privileges, change database roles, apply a substitute migration or delete existing feature state. A failed readiness check blocks publication. New tables and indexes are created by the application's normal initialization.

The lease runs in a separate one-off container. It remains alive while Compose recreates the game container. The installer explicitly releases the advisory/table fence after Compose returns and before waiting for application health, so new application initialization is not held behind its own health check. A lease failure or uncertain Docker result prevents an automatic second Compose operation and writes recovery evidence for inspection.

## Space, backups and recovery

Before build, available space must exceed 5 GiB, three copies of the client/backend delta, an 8 MiB margin and a bounded 64 MiB database archive allowance. Only existing changed source files enter the bounded source archive. New source files are recorded as newly added and are removed only by the guarded rollback. The current index and both old image identities are retained. A custom-format `royal_game` archive is hashed and inspected with `pg_restore --list`; an archive that exceeds the allowance blocks the release and its partial file is removed.

The overlay build context hard-links only the verified deltas and inherits all other image layers. The build has no network access. Publication never restores a database, environment file or persistent volume. Rollback restores source and the exact old prepared image, leaving additive progression tables, accepted player operations and financial history intact. Later source, configuration, service, module or runtime changes block rollback instead of overwriting them.

Commands `check`, `build`, `publish`, `release`, and `rollback` are accepted only from `/opt/royal-releases/location-levels-20261030-v1`. Package preparation and local tests do not authorize or perform production mutation. After a successful guarded publication, public host, wallet, recovery and progression checks and the pushed deployment record remain required.

## Local verification

Run `test_deploy.py` with Python and `node --test test_quiesce.cjs`. They use temporary fixtures and fake clients only. The existing 28 tests of the reused overlay engine also verify its lease loss and uncertain-Docker recovery behavior. No production checks are performed by these tests.

Run `node --test deployment/releases/location-levels-20261030-v1/test_prepare.mjs` from the repository to verify the scoped package and its rejection of changed provenance, foreign sources, output collisions, compatibility changes, unsafe paths and an existing publication directory.

Run `node --import tsx scripts/database-test.ts --test deployment/releases/location-levels-20261030-v1/test_quiesce_pg.cjs` from the repository to verify the real PostgreSQL privilege query, retained table locks, blocked account writer and explicit release in a disposable database.
