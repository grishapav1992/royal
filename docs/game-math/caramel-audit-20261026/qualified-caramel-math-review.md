# Caramel Carnival: independent mathematical audit

Checked current rules 2, progress 1, math profile 1. No game source, accepted rules, prices, policy, baseline or qualification evidence was changed. Reproducible code is in scripts/game-math/caramel-audit/ and reviewed reports are in docs/game-math/caramel-audit-20261026/. All generated output is written to artifacts/work/caramel-audit-20261026/.

## Outcome and limits

The fresh complete-round samples show no excessive mean return. Current Caramel already rejects the forged initial multiplier state found earlier in Cosmic. The mathematical and engine checks below found no payout discrepancy.

This is an audit, not formal RTP qualification. There is no Caramel entry in `rtp-policy.json` and no explicit Caramel target or tolerance in its current mathematical source. The earlier approximately 96% screening result is not an approved target. The full-round RTP below is estimated statistically, not integrated exactly. These results do not establish a deterministic full-round 95.8-96.2% interval.

## Actual source model

- `server/games/caramelCarnival.ts`: SHA-256 `efea2d448a692637819eef014badf72ac2aa1a0621284ba12011ab68ff1886a7`.
- `src/shared/caramelCarnival.ts`: SHA-256 `17f9e338297ac7fc37fa0f6ac6608e22cdc9ad145ad18f8c6764d72575f725aa`.
- Normal costs one base stake and includes its base spin, all cascades and any naturally triggered festival.
- Festival costs 35 base stakes and starts with ten free spins at multiplier 1. The purchase creates the saved feature without drawing a spin or crediting a reward.
- A group of 8-9, 10-11 or at least 12 identical ordinary symbols pays its corresponding coefficient once. Position and adjacency do not affect payment. Several different symbols can pay on the same frame.
- Spinners add 2, 3, 5 or 10 before a winning frame pays. The multiplier stops at 50. A frame with no ordinary winning group adds no energy and causes no refill. All paid ordinary symbols and all spinners disappear after a winning frame. Tickets survive the cascades.
- Normal spins start at multiplier 1. Entering a natural festival resets it to 1. Free spins carry the multiplier within that festival. New paid rounds do not inherit it.
- At least four tickets on the final base grid grant ten free spins. In a festival, at least three final tickets add three spins, with a total award ceiling of thirty. The last extra award can therefore be two spins.
- Each spin permits twenty paid cascade frames. After a winning twentieth frame, its final refill is generated and its tickets count for the feature award, although that refill is not scored. Both engine and validator implement this rule. It is explicitly covered here.
- The complete paid round, including free continuations, stops at 5,000 base stakes. This limit uses the base stake, including in the 35x purchase.
- All thirteen allowed stakes are multiples of 100. Every coefficient and multiplier is an integer. Consequently, awards, costs and cap thresholds scale exactly on every random path, with no rounding loss at any allowed stake. Identical replay paths across stakes are not additional independent samples.

## Fresh complete-round results

The sample design used four fixed fresh seeds, two million normal rounds and 500,000 festival rounds per seed. All streams are included. Each statistical observation is one finished paid round. Normal includes organic entries; festival includes every continuation and retrigger. The cap and the twentieth-frame refill are active.

| Mode | Independent paid rounds | Mean return / actual cost | Approximate 95% interval | Mean payout in base stakes | Chance payout exceeds paid cost |
| --- | ---: | ---: | ---: | ---: | ---: |
| Normal | 8,000,000 | 96.000098% | 95.613473-96.386723% | 0.960001 | 15.2300% |
| Festival, price 35x | 2,000,000 | 96.144461% | 95.967506-96.321416% | 33.650561 | 31.1527% |

Normal's measured return consists of 70.450083 percentage points from the base spin and 25.550015 from the free festival. It had 60,435 natural entries, or 0.755438% of paid rounds. Festival averaged 10.258686 free spins per purchase. Its mean payout is compared with all 35 stakes paid, not one base stake.

The samples contain 21,137,564 free spins and 42,792,998 cascade frames. The twentieth-cascade limit appeared five times in normal and thirty times in purchased festival. No random sample reached the 5,000x cap; observed maxima were 713.92x and 815.19x. This does not imply the cap is unreachable: forced valid trajectories reach it in both modes and are checked separately.

For an additional conservative statistical check, the bounded-payout empirical Bernstein inequality gives simultaneous 99% intervals of 94.304006-97.696190% for normal and 95.702940-96.585982% for festival. These intervals use both tails for both modes with failure probability 0.0025 per tail. The formula and source are recorded in JSON. The theorem assumes independent identically distributed observations; reproducible seeded uniform draws model that assumption. These are statistical bounds, not exact analytical RTP. See [Maurer and Pontil, Theorem 4](https://arxiv.org/pdf/0907.3740).

## Independent arithmetic and actual server replay

The audit uses independent category thresholds, paytable scoring and count-state transitions. It does not call the game's grouping, energy, gravity or payout helpers to generate its sample rewards. Gravity can be omitted mathematically because rewards, energy, removals and tickets depend on symbol counts, and refill symbols are independent. The number and order of random calls still match the server, so identical streams can be compared.

- 24,105 comparisons with actual `caramelPayout` pass, covering all stakes, ordinary count thresholds, different multipliers, partial cap room and random mixed fields.
- 220 category and energy threshold boundary checks pass against actual `caramelSymbol`.
- 1,664 actual complete server rounds pass across both modes and every stake. Comparisons include frame symbol counts, group awards, multipliers, energy, tickets, awards, stops, complete payout and random consumption. These replays contain 8,645 free spins, thirteen natural entries, sixty-five retriggers and sixty-five multiplier-cap events. Their repeated stake paths do not inflate the independent sample count.
- Fifty-two forced scenario/stake combinations pass: whole-round festival cap, thirty-spin retrigger ceiling, natural entry after refill with multiplier 11 resetting to 1, and twentieth-cascade final-refill tickets.
- Another 403 actual engine/validator assertions pass, including ninety-one forged state cases, all thirteen normal-mode caps, initial purchase accounting, stale revisions, completed-round refusal, exact origin multiplier 1, and spinners without an ordinary win.

## Exact finite checks

An independent rational dynamic program integrates the thirty-cell initial frame by the count of one selected ordinary symbol and clipped total spinner energy. Linearity sums the seven differently priced symbol rewards. A second exact count convolution computes the probability that any ordinary symbol count reaches eight.

| Initial frame, multiplier before = 1 | Exact expected payout in base stakes, displayed approximately | Exact win probability, displayed approximately | Initial ticket threshold probability, displayed approximately |
| --- | ---: | ---: | ---: |
| Base | 0.318737301043 | 30.3907197240% | 0.4064090568% for four tickets |
| Free | 0.713615003586 | 24.2730001643% | 0.5506943400% for three tickets |

Authoritative numerator/denominator fractions are preserved in JSON. These values cover the first frame only. The free row is the first purchased free frame at multiplier 1 and sufficient remaining cap room, not an average over all free spins. The values do not replace cascades, carry-over multipliers, retriggers or complete-round RTP. In particular, final tickets can be more frequent than initial tickets because tickets survive refills.

Independent review reproduced all six rational fractions exactly using conditional-count expansion, inclusion-exclusion for up to three simultaneous paying symbols, and complementary ticket probabilities. It also recomputed variance with BigInt and matched the Bernstein limits within 1e-13. A separate geometry-based simulator matched another 832 complete actual server rounds across all stakes; see `native-round-results.json` and `native-qualified-review.md`. These checks and the separate native statistical screen are not added to the prespecified ten-million-round sample or its confidence calculation.

## Reproduction and scope

Run `scripts/game-math/caramel-audit/qualified-caramel-audit.mjs` with Node and the existing `tsx` import loader. Defaults reproduce all ten million paid rounds and the 1,664 server replays. Its `--checks-only` option repeats the arithmetic, boundary, forced-branch and actual replay checks without repeating the samples. The focused rerun corrected two test boundary values to the actual base spinner cutoff 37,450; the sampler itself was unchanged. All saved fractions and replay receipts matched the full-run evidence. [qualified-caramel-invariants.mjs](../../../scripts/game-math/caramel-audit/qualified-caramel-invariants.mjs) reproduces the 403 invariant assertions. Evidence is in the corresponding JSON files.

The full run recorded source commit `3430485363532d720110654ecdf19762a3207c78`. Mathematical hashes were verified unchanged at the end of the run. The recorded commit and Caramel mathematical hashes identify the checked source; later repository commits do not change the scope of this historical evidence. Wallet persistence, transport, UI, close/reopen and legacy rules 1 are separate parts of the overall Caramel review and are not inferred from this current-rules mathematical sample.
