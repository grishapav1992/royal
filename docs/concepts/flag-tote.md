# Flag totalizator, rules 1

Accepted on 31 October 2026: all 48 countries take part, including countries without bets. The platform fee is 5% of a completed round's entire bank. If the actual first-place country has bets, its supporters share the remaining 95%. Otherwise the three highest-placed countries with bets share that remainder 60/30/10. Within each country the award is proportional to accepted stakes. At least three backed countries and two accounts are required; an insufficient round refunds every stake without a fee.

All money uses integer common-wallet cents. Allowed individual tickets retain Flag Battle stakes 100, 200, 500, 1000, 2000 and 5000 cents. Limits: 256 tickets per round, 50000 cents per account per round and 1000000 cents for the whole bank. A participant reserves capacity for the maximum possible bank until settlement. These limits and the rules version belong to the accepted round.

The total bank is a multiple of 100 cents, so 5% is exact. Split the net bank among countries with the largest remainder method, then split each country's award among its supporters with the same method. Ties use the finishing place for countries and the original ticket sequence for tickets. Every cent belongs to a player or the declared fee; there is no retained surplus, rollover or additional consolation fee. A positive return below the player's combined stake is a net loss and must not trigger a win celebration.

## Return policy

This is a player-funded pool, not the solo Flag Battle paytable. Aggregate return is exactly 95% on completion and 100% on cancellation. Individual expectation depends on the allocation of stakes and the chosen countries, and is not advertised as a fixed RTP. All 48 finishing orders are uniformly random permutations; a country's first-place chance is 1/48 regardless of its backing. Qualification must cover every allowed stake, country, prize branch, integer allocation and refund, with independent seeded runtime comparison and common-wallet concurrency/recovery tests. An algebraic conservation proof covers arbitrary accepted bank compositions; finite replay examples are cross-checks, not exhaustive enumeration of all compositions.

## Shared round and access

Initial cadence: one global five-minute slot, four minutes of betting, about 31 seconds of the existing physics presentation and the rest for results. These timings are product hypotheses. There are no parallel local banks or house-funded opponents. The existing solo game and accepted solo rounds remain unchanged. The independent `flag-tote` client uses the shared module loader, wallet, identity, operation recovery and audio services.

The host announces the current round and provides access through its normal game window with chat. The organiser is an interface character, never a bettor. The server, not a browser tab, closes bets, freezes the bank, generates the permutation and settles awards. No outcome or visual seed exists while betting is open. A queued late request is rejected using the authoritative clock before debit. A lost response preserves its ticket UUID and original terms; close/reopen, a server restart or disconnected supporters cannot create another charge or lose an award.

## Feedback events

| Event | Presentation and sound | Verification |
| --- | --- | --- |
| Waiting / confirmed ticket | Legible cutoff, bank and personal receipt; brief existing selection cue after confirmation | No optimistic paid ticket, no queued sound after hide/close |
| Betting closed / race | All 48 flags, shared server time, existing Flag physics; original gentle effects, no music | Two clients show the same exits at the same server time; late join advances quietly |
| Completed result | Actual winner plus paid countries and actual finishing places; personal stake, gross return and net result | Unbacked winner and consolation cannot be labelled first-place win; net loss stays neutral |
| Recovery / refund | Saved receipt or full refund explanation, quiet | No replay of historical award effects; same UUID, exact wallet entries |

Use reduced motion and the common mute/volume settings. Stop owned feedback on close, account change and hidden tabs. Desktop and mobile checks must use the real host with connected chat.

## Local acceptance, 31 October 2026

The feature is implemented and verified locally. It has not been deployed. Entry points: the shared round invitation in the hall and the Royal game catalogue. The organiser currently appears inside the game interface; a physical moving NPC in the world is not part of this implementation.

- Official qualification: 14912 independent-model/runtime comparisons, all 48 countries, six ticket stakes, every possible consolation place, direct-win and both refund branches, plus two independent seeded composition streams. Arbitrary valid compositions are covered by the exact conservation argument, not falsely described as exhaustively enumerated.
- Nine real PostgreSQL mathematical, wallet and HTTP tests pass. They cover concurrent retry, account isolation, request mutation, shared capacity, cutoff after lock, persistent recovery, refunds and invalid entropy rollback.
- One proof-integrity test rejects incomplete or altered evidence. The existing sixteen RTP-gate tests pass.
- Twelve existing solo Flag Battle and common-wallet tests pass; seven module identity/resource tests pass across all 124 packages. Sixteen existing physics and audio tests pass.
- The full application build and npm run check:rtp pass, including 26 current/historical profiles. Forest Heart, Wild Nudge and Roulette evidence was regenerated using the official qualifier after common-wallet wiring changed. Existing probabilities and paytables were preserved. The existing game route file is byte-identical to origin/main.
- Two Chrome host scenarios pass: separate real accounts and a shared chat room, hall invitation and catalogue entry, a complete natural 48-flag race, identical saved order/seed, 60/30/10 awards, honest negative personal net, close/reopen without another ledger entry, lost accepted reply and exact insufficient-round refund. Desktop 1440x1000 and phone 390x844 retain chat and accessible controls without horizontal overflow.
- Example local result: an 800-cent bank, 40-cent fee and unbacked Kenya winner award France 456, Brazil 228 and Russia 76 cents. One player's combined 300-cent stake returns 532 cents; another player's 500-cent stake returns 228 cents and is presented as a net loss.

The browser scenarios use a disposable local database and explicit test-only clock controls; they do not create production accounts or wagers. Device speaker/headphone listening has not been measured, and no claim of universal sound preference is made. Production publication still requires the normal baseline, compatibility, backup and release process.
