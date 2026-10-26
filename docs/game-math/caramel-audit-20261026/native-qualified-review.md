# Independent review of the count-state audit

26 October 2026. Reviewed qualified-caramel-audit.mjs, its saved 8 million normal and 2 million purchased full-round samples, and qualified-caramel-invariants.mjs. No error was found in the count-state payout model, exact initial-frame calculation or saved concentration-bound arithmetic.

The count projection is exact for the current engine. Payments depend only on ordinary-symbol counts, spinner counts and the carried multiplier. Each winning ordinary symbol is removed completely, all spinners are removed on a winning frame, and tickets survive. The number and category counts of remaining cells are therefore determined by counts alone. Independent identically distributed refill symbols produce the same new counts irrespective of column gravity. Tickets, multiplier transitions, retriggers, cascade stopping and the full-round cap also depend only on those counts. The reduced simulator consumes the same number of symbol draws and has the same paid-round distribution. This relies on the current position-independent symbol generator and the rule that matches pay anywhere.

The exact initial-frame expectation uses linearity over seven ordinary symbols. For one chosen symbol, a count of at least eight guarantees a winning frame, so spinner energy applies. Its marginal count and capped energy suffice; dependence between separate winning groups does not invalidate summing their expectations. Equal ordinary weights allow summing the seven paytable coefficients for each count tier. This integrates one initial frame, not the complete cascade or free series.

I independently recalculated both initial-frame payout fractions using a different conditional-count expansion: choose the chosen ordinary symbol's k positions, then integrate capped spinner energy over the remaining 30-k positions. Both fractions matched exactly by cross multiplication of BigInt numerators and denominators. Initial win probabilities were independently recovered by inclusion-exclusion over one, two and three simultaneously winning ordinary categories; four categories cannot each occupy eight of thirty cells. Both exact fractions matched. The ticket thresholds were recalculated through the complementary binomial event and both fractions also matched.

The empirical Bernstein formula matches [Maurer and Pontil, Theorem 4](https://arxiv.org/pdf/0907.3740). Applying the theorem to both tails of each of two modes with per-tail failure probability 0.0025 gives log(800) and total failure probability at most 0.01 by the union bound. The sample variance is unbiased and the bounded normalized payout range is 5000 divided by the actual mode cost. Recomputing variance from the exact integer expression n*sumOfSquares-sumSquared reproduced the stored interval endpoints within 1e-13:

| Mode | Stored simultaneous interval under the IID model |
| --- | --- |
| normal | 94.304006% to 97.696190% |
| festival | 95.702940% to 96.585982% |

These are statistical bounds under the stated independent-sample model. Fixed seeded pseudorandom trajectories model that assumption; they do not provide a deterministic proof of exact RTP. The exact free-grid result at initial multiplier one applies to a fresh purchased first frame or an unconstrained standalone frame. It is not the average of all free spins, whose multiplier and remaining cap depend on earlier results. There is still no approved Caramel target/tolerance profile in the RTP policy.

An initial audit boundary list used 27449/27450 in place of the base cutover 37449/37450. Those test values were corrected and the full focused arithmetic and replay suite passed again. The simulator and production probabilities were correct before the correction; the saved statistical trajectories are unchanged.

This independent review did not change game source, probabilities or settlement rules. The separate native geometry simulator's 832 exact full-receipt replays and 18 controlled engine scenarios provide additional checks of the same source behavior.
