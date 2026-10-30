# Level rewards v2

User choice: one free atelier generation at every fifth level, starting at level 5. A generation creates two candidates and grants permanent ownership of one selected skin. The live wallet remains VIRTUAL_USD. XP sources, coefficients and all 100 thresholds are unchanged.

| Level | Spins | Nominal | Skin generations |
| --- | --- | --- | --- |
| 5 | 5 | 0.50 | 1 |
| 10 | 5 | 1.00 | 1 |
| 15 | 5 | 2.00 | 1 |
| 20 | 5 | 3.00 | 1 |
| 25, 30, 35, 40, 45 | 8 each | 5.00 | 1 each |
| 50, 55, 60, 65, 70 | 12 each | 10.00 | 1 each |
| 75, 80, 85, 90, 95 | 20 each | 20.00 | 1 each |
| 100 | 40 | 50.00 | 1 |

Levels ending in 5 retain Royal Coins; those ending in 0 retain Royal Fruits. Both resources are awarded automatically in one transaction through the registered `bundle` handler. Skin generation is an independently registered reward handler, and can also be awarded alone by a future policy. The central milestone identity prevents reissuing either resource on event replay.

Free generation rights live in `progression_skin_rewards`. `progression_skin_uses` binds one atelier job UUID to one right and records reservation, capture or refund. Creating the job and reserving the right is atomic. The normal atelier worker, image validation, leases, two variants, choice, wardrobe and appearance events are reused. The payment adapter returns a zero-price receipt and does not touch money, cash reservations or the paid purchase journal. Failed or interrupted generation restores its original right once. A successful generation consumes it once, including when the capture response is lost. A free request never falls back to paid generation.

The atelier automatically offers an available free right first and saves its grant ID with the request before transmission. The level panel shows both reward resources and opens the atelier. `skinsEnabled` pauses new free reservations independently; accepted jobs can still complete or refund. Rights do not expire.

The policy is published as `location-levels-v2`. The v1 definition remains immutable as `LEGACY_PROGRESSION_POLICY`; existing accepted sources, pinned players and issued packets retain their original conditions. There is no retroactive replacement or duplicate historical giveaway. A read-only production aggregate before preparation found zero progression players, pending progression rounds, issued packets and active atelier jobs. Publication must recheck current state instead of relying on this observation.

Full redemption awards 260 spins, nominal total 4832.50, exact expected slot payout 4671.80 virtual units, plus 20 two-candidate generations. The independent model limits each cumulative **spin payout** prefix to 4% of qualified turnover. This replaces the v1 1% spin budget. The first spin packet has expected payout 2.40 at 65.96 turnover. Generation retail value is 10.00 each (200.00 total); retail value is not provider cost. Actual provider cost is not known from this repository and is excluded from the spin payout limit. No profitability or combined legacy-game RTP is claimed.

Coins/Fruits qualification includes all old issued denominations as well as the expanded v2 denominations. Paid stakes, distributions and multipliers do not change. Qualification is regenerated with the normal command, not by editing proofs.

Implementation checks: 77 PostgreSQL/server/client/math/atelier tests and four real-host browser scenarios passed. Browser verification uses disposable local accounts and a fixture image provider; it makes no paid external image requests. The new scenario recovers an accepted free generation after a lost reply and reload, verifies unchanged cash and XP, selects one skin, and checks the mobile layout. Production publication and exact built artifact binding remain separate release requirements.
