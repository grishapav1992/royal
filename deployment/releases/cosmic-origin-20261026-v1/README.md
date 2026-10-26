# Cosmic Escape purchase-origin validation release

Publish only the reviewed Cosmic validation fix to the current application. The unrelated Velvet mode-label change remains in the original audit feature branch and is excluded from this release tree. Game probabilities, prices, caps and accepted-round rules remain unchanged. Cosmic retains host API/rules/progress 1/2/1.

Use the actual production source revision from a fresh guarded `snapshot.py` result as the `release:plan` and `release:prepare` base. The first reviewed snapshot is the healthy Atelier release at `27264a8cac2744aad98145631e76a291af5cbedf`. Do not substitute origin/main for the live revision. Sources must be committed and pushed to main before release preparation. Reuse the normal build directories and run `release:verify --github` before packaging the exact outputs with `prepare.mjs`.

`prepare.mjs` selects only the committed application-source changes, host client delta, main backend bundle and the Cosmic package. It rejects unrelated source, dependency, public-asset, immutable URL and host-contract changes. Package metadata may change scripts only; dependencies are compared against the exact recorded production source. The payload and its transport live only in `artifacts/work/cosmic-origin-release/`. No full source staging checkout or dependency copy is required.

`deploy.py release` holds the existing three deployment locks. It rechecks every protected source/runtime/config/service/module fingerprint, verifies a bounded full source backup and tags the previous image. A constrained image overlay uses the existing image plus the exact host/backend/package-metadata delta. It does not install dependencies, change environment settings, run migrations or restore player data. Disk checks retain at least 5 GiB, accounting for source, backup and runtime delta. Rollback returns only to the exact reviewed compatible application image, preserving the current database.

`modules.py check` and `modules.py publish` run after successful application installation under the same three locks. They preserve the host contract and every other module, publish only Cosmic through the standard independent-module installer and retain old resource URLs. A failed module phase restores only its own pointer and leaves the fixed backend available. Application rollback after a module publication first requires the guarded Cosmic pointer rollback. Never restore a database dump over later operations.

Before installation run the new engine/wallet/qualification regressions, installer/module-helper tests and `verify-local.mjs` against the exact prepared manifest. The local helper creates only isolated temporary accounts and PostgreSQL data, checks the real host and connected chat on desktop/mobile, restores an active purchase and retries a lost final response. `verify-public.mjs` is read-only: public hashes, authentication boundaries, unrelated module pointers, previous Cosmic URLs and a guest browser with all writes and WebSockets blocked.

Python helpers can be tested locally with the bundled runtime:

```sh
PYTHONDONTWRITEBYTECODE=1 /Users/grigory_pavlenko/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 -m unittest discover -s deployment/releases/cosmic-origin-20261026-v1 -p 'test_*.py'
```

Run long server installation in a detached process with a private log. Keep the recovery archive, old image tags, current release and player volumes. After public checks, push the source/image/verification record to `deployment/SERVER.md`, then remove only this task's transport, runtime context, temporary logs and obsolete local packages. Report measured storage changes without attributing concurrent changes to this cleanup.
