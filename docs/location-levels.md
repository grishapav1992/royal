# Location levels MVP

Implementation source: feature/location-levels-mvp. The live Royal host uses its existing shared virtual USD wallet and VirtualPvpLedger. This feature does not change the currency, enable real-money withdrawals, convert old demo money, or replace the production wallet. Nile reward funding is an isolated adapter with an explicit store, not a second player balance.

## Product policy v1

Each stable location has its own permanent levels 1-100. The initial location is south-park, independent of a Colyseus room instance. Every player begins at level 1. The first schema activation timestamp is persisted. Previously accepted sessions are not imported, including sessions completed after activation. The policy is pinned when the first eligible round is accepted.

Experience measures settled paid turnover, including spending from previous cash winnings. One virtual USD gives 100 XP. Slots and PvP initially have coefficient 1. The complete-round cost includes additional paid moves and excludes actual cancellation refunds, not ordinary winning returns. Both PvP participants earn on their own accepted stake after settlement. Refunded matches, deposits, purchases and promotional spins give no experience. Fractional points accumulate using an exact common denominator; splitting stakes cannot create or erase XP.

The cumulative level threshold is ceil(100000000 * (level-1)^3 / 99^3) XP. Level 100 corresponds to 1000000 units of qualified turnover at coefficient 1, not deposits or casino income. These are explicit MVP policy choices, not measured retention results.

Every fifth level awards a fixed package. Levels ending in 5 use Royal Coins and those ending in 0 use Royal Fruits. Below level 25: 5 spins at 0.10. Levels 25-45: 8 at 0.20. Levels 50-70: 12 at 0.50. Levels 75-95: 20 at 1.00. Level 100: 40 at 2.00. Issued packages retain their game, nominal, count, currency and rules version, have no expiry in v1 and do not change when the player advances further.

A gift is one full ordinary round at its specified nominal, funded by Royal. It does not spend the player's nominal and its full payout is credited through the existing wallet. Initial gift games have no bonus continuation. Adding a gift game with continuations requires its full saved-round lifecycle and qualification; one continuation must not consume another gift.

## Boundaries and data

- src/shared/progression.ts: versioned typed policy, transport contracts and independent client validation.
- server/progression/sources.ts: adapters around existing wallet and PvP transactions. It reads original accepted game records and their exact debit/refund entries rather than net balance.
- server/progression/store.ts: immutable source identity, durable outbox, XP journal, player/location projection and automatic milestone grants.
- server/progression/handlers.ts: explicit typed source and reward registries. The default registry contains only the two cash-funded sources and free-spin rewards.
- server/progression/freeSpins.ts: atomic right consumption, real engine outcome, payout and retry receipts using the existing wallet.
- server/progressionRoutes.ts: authenticated same-origin API, bound to the visible account header.
- src/wallet/ProgressionClient.ts: account-scoped pending operation persistence and retry.
- src/ui/ProgressionUI.ts: host level button, complete roadmap and confirmed gift outcomes, retaining the connected chat.

All source contexts and settlement events commit with the original game's money transaction. The outbox is processed separately; XP journal, projection, grants and delivery acknowledgment commit together. Unique keys prevent duplicate source processing and repeated grants. The worker can restart and replay the queue. A large round awards every crossed milestone. Multiple currencies and locations remain separate scopes; test progress never grants another scope's rights.

Published policy definitions cannot change under the same version. Existing players remain on their pinned policy and already accepted rounds and rewards retain their terms. New sources add a typed event adapter and policy coefficient. New reward types add a grant handler. A new policy version is not a new entitlement to previously awarded milestones. No seasonal resets or retroactive policy migrations are part of v1.

The generic level/outbox engine dispatches through registered handlers. A source validates its domain facts and normalizes them into fixed units (10000 units per unweighted XP); the engine retains exact fractional coefficient accumulation. A reward handler validates its definition, writes its specialized resource in the current transaction and audits that resource. The central progression_milestones record freezes kind, definition and policy and enforces one grant per player, scope and milestone independently of the reward kind. Existing free-spin resources are backfilled without changing their identifiers or remaining rights. Handlers must retain published semantics and perform transactional database work; an external fulfilment operation needs its own durable job. The test-only discovery/badge registry demonstrates extension without enabling another public activity or reward.

## Operations and checks

ProgressionStore.setSwitches can pause new earning or new gift starts independently. Previously accepted rounds finish under their accepted context. Saved gift receipts remain replayable when gift starts are paused. Disabling either switch never deletes history or takes cash from a player.

Run `node --env-file-if-exists=.env --import tsx scripts/progression-report.ts` using the application's existing database configuration. The report distinguishes nominal amounts, exact expected payout from the Coins/Fruits distributions, actual promotional payouts, outstanding rights and pending events. Audit checks XP projections, outbox acknowledgment and consumed rights. No passwords or connection strings are printed.

Validation includes real PostgreSQL tests for source capture, bonus/session completion, atomic rollback, duplicate processing, concurrency, policy pinning, separate locations, reward payout and recovery. Browser checks must use the real host with connected chat on desktop and mobile. `npm run check:rtp`, relevant wallet/compatibility tests and `npm run build` remain release requirements. Gift denominations and paid denominations are registered in the exact slot qualification; stale proof hashes must be regenerated by qualification, never edited by hand.

The independent v1 promotion reference also checks all 100 thresholds, both source coefficients and all 20 reward packages. Full redemption awards 260 spins with nominal total 220.00 and exact expected payout 212.622 virtual units. Every cumulative milestone prefix must cost at most 100 basis points (1%) of cumulative qualified turnover from level 1. The first reward has expected cost 0.48 at 65.96 turnover. This is an explicit promotional budget, not a claim about casino profit or the combined RTP of the legacy games earning that experience.

## Delivery checklist

- [x] Product defaults and extensible contracts.
- [x] Paid source matrix and full-round adapters.
- [x] Durable XP and milestone grants.
- [x] Shared-wallet gift funding and recovery.
- [ ] HTTP/client/real-host verification.
- [ ] Final mathematical qualification, economics report and complete build.
- [ ] Independent review, GitHub synchronization and release preparation.
- [ ] Production baseline reconciliation and post-publication verification if published.
