# Royal Bar and Mira

The feature source is `9c093138`. The production baseline was read independently through the installed snapshot helper. Its main backend was reproduced byte for byte from the committed Star Spin backend projection before preparing this delta.

The release changes only the 15 source files in `scope.json`, the main client index and its new immutable JS/CSS, and `dist-server/index.js`. Host and backend projections retain exact Git origins for every other input. The running compact header is preserved by a three-way reconciliation of the feature's small `main.ts` delta; the existing host dictionary receives only the new venue label. The backend retains its separately pinned dictionary, as in the verified baseline. No games are added or restored, and no module pointer, payment service, secret, volume or financial program is changed.

The installer extends the existing guarded application installer. It verifies the complete baseline, exact source and program scopes, GitHub release receipt, projected input hashes, immutable client URLs, configuration, other services and module inventories. It retains the source backup, prior image, financial barrier and common publication locks. A changed production baseline must be reconciled rather than bypassed.

Build with `npm run release:prepare -- --base <scope.productionCommit> --host-projection deployment/releases/royal-bar-mira-20261104-v1/host-projection.json --backend-projection deployment/releases/royal-bar-mira-20261104-v1/backend-projection.json`, from the clean committed source already in main. Verify with `npm run release:verify -- --github`, then package using `node deployment/releases/royal-bar-mira-20261104-v1/prepare.mjs <before.json> <task-owned-payload-directory>`.

Run the Mira, bar, wallet and real-host tests against the final prepared bytes. After guarded installation, verify public file hashes, health, catalogue availability and completed mandatory maintenance, and record the actual result in `deployment/SERVER.md`.
