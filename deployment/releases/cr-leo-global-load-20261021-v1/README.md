# CR vs. Leo: global asset readiness

Validated candidate, not yet published by this release. Built against main 9938722.

The game waits for all nine runtime images and all 56 prepared sprite frames before exposing the stadium. Both heroes, penalty, near free kick and far free kick are ready together. Mode selection no longer schedules or prioritizes asset downloads. Failures remain retryable without reloading completed assets. Existing WebP bytes, math, wallet and host contract are unchanged.

Module: original-cr-vs-leo, version 1.0.0-d7e1b79a7590, 13 resources. Publish only this compatible independent module after authorization and a fresh production comparison. Preserve every other module, the application image and running container, environment and persistent data. Follow deployment/SERVER.md for source synchronization, backup, previous-image tags and verification record.

Verification: four asset-store tests, 23 model/geometry tests, module TypeScript and module build passed. Browser review used the built module through IndependentGameUI. Holding wall-far.webp kept the scene hidden at 83% with eight assets and 52 frames. Releasing it prepared all nine assets and 56 frames. All six hero/mode combinations and close/open reused the assets without new image requests. No production account or wager was used. Detailed local evidence: artifacts/cr-leo-global-load-20261021/proof.
