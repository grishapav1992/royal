# Universal free spins release

Production baseline: `591461b5350f5c164e69fe14476c5b912b3bd2da`.
Reviewed runtime feature: `60b13bb8dde910919057835ed056a98257b78857`.

This release installs the v3 pooled reward policy, the common host bridge and catalogue access for Coins/Fruits. It preserves the actual production source projection and all unrelated runtime programs. `source-patches.json` explicitly excludes unrelated changes already present in main; every replacement is bound to the original Git bytes and the reviewed resulting hash. `moduleGames` and `moduleAssets` also bind the two independent packages to this projection, including their shared presentation imports and existing artwork. The common source tree is read from verified Git objects in memory, with no full staging checkout or dependency copy.

Use the standard `release:plan`, `release:prepare` with both projection configurations, and `release:verify --github` from a clean committed source on main. The build preserves the full module inventory and substitutes only the two reviewed module outputs. Their input origins and hashes, externalized progression bridge, manifests and all output files are checked against the official release. The scoped preparer additionally validates both mathematical proofs against the exact projected production inputs. Generate and commit the native restart report against those same built backend bytes before preparing the final publication directory. An unverified local build cannot be installed.

The 26-table financial fence includes all progression resources, wallet/session tables and atelier jobs. It checks additive DDL ownership, drains timed or external obligations, and rejects any existing cohort pinned to an earlier policy. It preserves untimed native rounds under the retained engines. The rollback guard refuses an adopted v3 track or any pooled right before source restoration.

Publication order:

1. Capture a fresh read-only baseline and check source, full runtime inventory, external modules, service profiles and disk capacity.
2. Prepare and verify the scoped host/backend package. Save and verify its source in GitHub first. Preserve the source/database backup, previous image and persistent volumes.
3. Run the guarded installer once, retaining the process identity and terminal result if the observer disconnects. Verify the running image, exact host/backend bytes, health, retained services and API boundaries.
4. Publish only the two Coins/Fruits packages from the same verified official manifest through `scripts/game-module-release.py`, with the reviewed previous active pointer hashes. Check the installed host source/image first: the new packages require its progression bridge. Keep older immutable module versions for open windows and coordinated recovery.
5. Verify both public module pointers, manifests and every asset against the official manifest. All other external module bytes must remain identical to the baseline. Repeat the authenticated flow locally against the exact published host, backend and module packages, with chat on desktop/mobile. Production verification remains read-only.
6. Record the source commit, image, module versions and results in `deployment/SERVER.md`, push the record, and remove only task-owned local build/review material. Keep the compact completion report and required server recovery protection.

Module publication and host rollback must be coordinated. A host rollback cannot retain a new module that requires the progression bridge. No blanket Docker cleanup, data restoration or lower disk threshold is part of this release.
