# GitHub game worlds release

Publishes exactly nine compatible client packages. The host, server programs, other modules, production configuration and databases remain unchanged. The source lock lists the 42 published source paths, every package resource and every bundle input hash.

## Reproduction

The source publication commit is recorded in verification.json after installation. Archive productionBuildBaseCommit from source-lock.json into an empty build directory. Overlay only sourceChanges from the source publication commit. Install the dependencies pinned in that archived package-lock.json. Run npm run build:modules in the build directory. Verify all buildInputs hashes and the nine resulting versions against source-lock.json before publication.

This explicit baseline preserves production shared dependencies while main also contains a separate unpublished Neopolis prototype. Main retains that work. The archived baseline and all overlay files are saved in the same Git history. A build of the whole latest main is not the package artifact for this release.

## Installation

Use the existing publisher API with expected previous active.json SHA-256. The guarded deploy.py accepts check or publish under both publication locks, verifies all 1590 production source paths and 414 external files, validates each package, backs up all source and previous pointers, tags both previous images, and preserves host programs and production settings. It installs only the nine listed packages and overlays the 42 source paths. A failed guarded installation restores the nine old pointers and modified source paths. A production rollback also requires the corresponding source commit and deployment record in main.

Local verification includes exact package reproduction, TypeScript, all 112 baseline packages, 18 module/policy checks, actual local rounds, desktop/mobile with chat, close/reopen, and unchanged RoyalGames. Public HTTP and browser results are recorded in verification.json after installation. Animation timing is a design choice; there was no participant comparison or measured Bluetooth latency in this artwork release.
