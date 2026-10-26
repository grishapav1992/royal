# Caribbean Treasures prototype

Independent client package for `studio-caribbean-treasures`. Host API 1, server rules 1 and progress contract 1. The common module loader mounts `entry.ts`; the host supplies the expansion client, wallet, account, money formatting and language.

The package renders confirmed 6×4 fields, continuous giant blocks, winning cells and selected paylines. It exposes 1/5/10/20 active lines, four per-line stakes, natural tactic selection, both purchased series, rules, round history and pending-operation recovery. Settings lock during accepted rounds. Outcomes, costs, entropy, persistence, house coverage and final credit belong to the common backend.

The vector glyphs and teal/gold layout are a functional prototype. The approved Caribbean port and adult pirate concept, production graphics, animation and audio are later stages. No automatic paid spins are implemented.

Build with `npm run build` or `node scripts/build-game-module.mjs --game caribbean-treasures`. Run `npm run test:caribbean` for full-round, transport and wallet coverage.

For real-host browser checks, start `node --import tsx scripts/caribbean-preview.ts`, then run `npx playwright test --config playwright.caribbean.config.ts`. The loopback-only stand creates its own temporary PostgreSQL and disposable accounts. It uses the actual host, module loader, shared wallet store and live chat. Test-only top-up and forced bonus controls exist in that local stand only. Stop with POST `http://127.0.0.1:5234/__test/caribbean/stop`; this closes its backend and temporary database.

See [the staged development plan](../../docs/concepts/caribbean-treasures/development-plan.md) and [verification evidence](../../docs/concepts/caribbean-treasures/stage3-verification.md).
