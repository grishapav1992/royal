# Collection policy: Caribbean voyage

Pirates are cosmetic. Points come from completed paid rounds of `studio-caribbean-treasures`, by the whole amount debited for the round: 0.10 to 0.49 USDT give 1, 0.50 to 0.99 give 2, 1 to 4.99 give 3, 5 to 9.99 give 5, 10 to 49.99 give 8, 50 and more give 12. Free spins, winnings and losses add none. A purchased series counts once, when it ends. Ten pirates open at 100, 250, 450, 700, 1000, 1350, 1750, 2200, 2700 and 3250 points, in the order of the voyage map. Points are never spent.

`server/caribbeanVoyage.ts` reads the committed progression outbox under its own account lock and keeps its own credited list, like the Cosmic crew. It writes neither wallet nor round data, so its failure cannot touch money. Registration is `nonWagered.caribbean-voyage` in `scripts/game-math/rtp-policy.json`; the game mathematics, qualification and settlement stay unchanged. A pirate can be met at any time and changed between rounds. Every pirate has the same game.

The change from the first collection happens once, in the database migration `caribbean-voyage-v1`: one token becomes one point, opened pirates and the chosen one stay. `/api/caribbean-crew` remains readable for packages that are still open; its challenges and token unlocks answer `collection-moved`.

# Earlier policy: Caribbean crew v1 (closed)

This is genuinely non-wagered cosmetic account progress. It accepts no stake, payment, wallet balance, spin, game outcome or random draw. Tokens are free profile points; they cannot be bought, wagered, transferred, redeemed, converted to USDT or returned as prizes. Every captain has the same unchanged qualified wagering game.

Isabella is initially owned. Each of ten other captains costs 100 profile tokens. Five one-time educational questions award 20 tokens each. Two free daily questions award 50 each and reset at midnight Europe/Moscow. Wrong answers award nothing and can be retried. Every lesson and daily challenge pays once per account. Unlocking an already owned captain consumes no further tokens. Answers, rewards, day keys, ownership and selection are checked by the common authenticated backend. Profile points are derived from accepted free completions minus fixed cosmetic unlock costs.

Registration is `nonWagered.caribbean-crew-collection` in `scripts/game-math/rtp-policy.json`. This classification does not exempt or replace the `studio-caribbean-treasures` RTP profile. Its rules/progress 1, qualification proof, probabilities, full paid-round costs, bonus continuations and settlement remain unchanged. Collection routes never call the wallet or paid-round engine. Existing accepted rounds retain their rules, amounts and operation IDs. Relevant mathematical, wallet and compatibility checks plus `check:rtp` still run.

Ownership and selection live in additive tables in the common account database, using versioned migrations and account locks. Browser storage is no longer evidence of ownership. Old 1.4.0 local preferences were free previews, not earned unlocks; the new collection starts with Isabella. Older clients can continue their originally accepted wagering rounds. The new optional profile API requires the common backend update; if temporarily unavailable, the slot remains playable with Isabella and the collection offers refresh.

The UI shows owned/locked state, 100-token cost, current progress and free tasks. Successful responses alone announce points or a new unlock. Lost responses can be checked by refresh; semantic deduplication and request IDs prevent repeated awards or charges. Closed, superseded and account-switched requests cannot paint another account's collection. Character identity never changes a paid result.
