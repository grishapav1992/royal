# Flooded Temple 0.9.3 release preparation

This step prepares and audits a release candidate. It does not install, tag Docker images, alter production balances or update the production module pointer.

The observed application base is `b921d0537fed52336aaee5d97144bf36a9188107`, currently Caribbean Treasures v2. Production has 120 contracts and no Temple contract. The first Temple release therefore needs the compatible host/backend before the independent package. The candidate adds only the 1/2/2 Temple contract. Preserve all existing external module pointers, dependencies, environment, player databases, payment and reconciliation programs and other persistent services.

The candidate is pinned in `codex/flooded-temple-release` to the reviewed Temple code from `4ede7a95335601c5c287ffd9d84b38cd8016a97b` plus its final reports. Shared development and synchronization continue in `codex/flooded-temple`, which also preserves the later Hong Kong Warrior integration. After the pinned candidate is included in main, select that exact clean source commit for preparation. Do not use the release branch as an ongoing feature branch: merging subsequent unrelated work changes its candidate identity and requires a fresh scope review.

From a clean committed checkout already included in GitHub main, run:

```powershell
node deployment/releases/flooded-temple-20261029-v1/prepare.mjs artifacts/work/temple-release-preparation/production-before.json
```

The wrapper uses the official `release:plan`, `release:prepare` and `release:verify --github` implementations. It uses the current checkout and standard `dist`, `dist-server`, `module-dist` and `module-build` outputs. It also prepares the reviewed financial program and checks the actual compiled-client/API evidence. It does not create a full source staging tree, dependency copy or transport archive.

`module-build/release-manifest.json` owns the exact source commit, tree and standard artifact hashes. `module-build/temple-release/readiness.json` adds the production snapshot identity, the single Temple contract, financial graph, verification evidence and installation requirements. `nile-play.js` and `financial-inputs.json` sit beside it. Keep these normal active outputs until the publication decision. A later source commit or build invalidates verification; prepare and verify again from that selected committed source.

The financial builder preserves 15 existing source origins and the published financial catalogue, appending only Temple. In particular, the old Nile service still uses wardrobe v3 from `6ea6b2a20276d03561b16bc6290ce832c8ffc3cb`. The current host's wardrobe v4 is not imported into that service. The two v4-specific common-wallet tests do not describe this published financial composition; `legacy-finance.test.ts` explicitly checks preserved v3 import, incompatible v4 rejection, the old default selection and complete-round progress/settlement. All other financial tests retain their ordinary assertions. Every shared runtime input outside the Temple allowlist must match its running source fingerprint or a pinned reviewed Git blob.

```powershell
node deployment/releases/flooded-temple-20261029-v1/verify-finance.mjs artifacts/work/temple-release-preparation/production-before.json
npm run test:temple:release
```

The browser suite starts the compiled `dist-server/index.js` and serves the compiled `dist`. It uses a disposable PostgreSQL, synthetic accounts and credits only that isolated database through the existing wallet store. There is no Vite server, wallet middleware replacement or prepared RNG. Desktop and phone profiles verify connected chat, original stakes, exact balances, quiet reopen and loss/retry/reload with the same accepted UUID. Emulation does not certify physical Android, iOS or listening quality.

Physical speaker, wired-headphone and Bluetooth listening remains unverified from the device acceptance step. This limitation is recorded, not inferred from digital signal tests. The music, recordings, animations and mathematical rules are unchanged in this preparation.

Before installation, refresh the actual production baseline under all common locks. A changed production revision, image, configuration, service, source fingerprint or module pointer requires deliberate reconciliation. Use a Temple-scoped guarded installer, not an installer hardcoded for a previous game. Retain previous images and source/financial backups, keep at least 5 GiB free on the server through peak allocation, and preserve the existing persistent volumes. Publish the compatible backend before the new contract and package. Keep v1/v2 accepted rounds valid; after new operations, do not restore an old player database. Finish with public hash/health/authentication/pointer checks and a pushed `deployment/SERVER.md` record. Installation and public verification are separate from this preparation.
