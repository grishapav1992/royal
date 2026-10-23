# GirlHUB feedback release

Publishes only the compatible studio-afterglow client package. The source lock identifies the gated build baseline, retained production dependencies, source overlays, exact bundle inputs and immutable package files. The current main wallet integration remains in main. Production retains its existing wardrobe endpoint and test-coin wording through the two dependency references and the explicitly tracked production UI variant in source/.

## Reproduction

Check out the source publication commit recorded in verification.json. Run python deployment/releases/girlhub-feedback-20261023-v1/prepare.py with a new absolute build directory. Install the dependencies pinned in its package-lock.json, then run npm --prefix games/girlhub run build there. The current builder enforces RTP policy without bypasses. Compare the resulting module-build/girlhub-proof.json and immutable files against source-lock.json. The mathematical inputs are unchanged. The independent package owns its new result translations and uses the host language, wallet, operation transport and audio services.

## Publication

The reviewed deploy.py checks the complete fresh source and module inventories under both publication locks. It validates the expected GirlHUB pointer, backs up and verifies every production source, pins the running and prepared image tags, overlays only the seven listed source paths and atomically installs one immutable package. It verifies that all host programs, other modules, containers and production settings remain unchanged. Failure restores the previous GirlHUB pointer and modified source files. A later production rollback requires corresponding tracked source and deployment records. Existing databases and user data are preserved.

Local outcome, lifecycle, recovery, layout and audio evidence is described in games/girlhub/feedback.md. Public verification and the exact installed source commit are recorded after publication. Software timing observations do not measure physical audio latency or subjective listening quality.
