# Caribbean Treasures 1.0

Independent client package for `studio-caribbean-treasures`. Host API 1, server rules 1 and progress contract 1. The common module loader mounts `entry.ts`; the host supplies the expansion client, wallet, account, money formatting and language.

The package renders confirmed 6×4 fields, continuous giant blocks, winning cells and selected paylines. It exposes 1/5/10/20 active lines, four per-line stakes, natural tactic selection, both purchased series, rules, round history and pending-operation recovery. Settings lock during accepted rounds. Outcomes, costs, entropy, persistence, house coverage and final credit belong to the common backend.

The finished presentation includes the approved Caribbean harbor, an adult pirate captain with idle and celebration poses, six editable colored symbols, brass framing, confirmed reel stops, giant reveal, exact cannon growth and paid-round outcome classification. Original maritime music and effects use the host AudioContext, output, mute and volume. The music toggle is separate. Skip, hide, pause, close and account changes cancel owned presentation. Recovery and operation retries do not replay a reward. No automatic paid spins are implemented.

Client support is advertised through `X-Royal-Caribbean-Treasures: 1` on the common transport. Older clients receive a filtered session list and cannot change this game's rounds. Server rules and progress remain version 1. First publication needs the compatible host/backend and finance runtime; later game packages can update independently.

Raster source PNGs and ImageGen prompts are in `assets/`. Reproducible WebP runtime exports use the repository's declared `public/assets/caribbean-treasures/` media root and are bundled into this game's immutable package. Six symbol masters remain in `icons.ts`. Event design, cancellation and synchronization are specified in [feedback.md](feedback.md).

Build with `npm run build` or `node scripts/build-game-module.mjs --game caribbean-treasures`. Run `npm run test:caribbean` for full-round, transport and wallet coverage.

For real-host browser checks, start `node --import tsx scripts/caribbean-preview.ts`, then run `npx playwright test --config playwright.caribbean.config.ts`. The loopback-only stand creates its own temporary PostgreSQL and disposable accounts. It uses the actual host, module loader, shared wallet store and live chat. Test-only top-up and forced bonus controls exist in that local stand only. Stop with POST `http://127.0.0.1:5234/__test/caribbean/stop`; this closes its backend and temporary database.

See [the staged development plan](../../docs/concepts/caribbean-treasures/development-plan.md) and [final review](../../docs/concepts/caribbean-treasures/final-review.md). Automated signal and scheduling checks do not establish listening comfort on physical devices.
