# Caramel Carnival: engine and full paid round review

26 October 2026. No engine or settlement defect was reproduced in this review. This is a deterministic transition audit plus observed RTP screening, not formal mathematical qualification. Production was not changed.

The current engine has two choices: normal costs one base stake; festival costs 35 base stakes and starts ten free spins at multiplier 1. The thirteen allowed stakes are 100, 200, 300, 500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000 and 100000 integer units. There is no carried collection between paid rounds or player choice during a free series. All stake values are multiples of 100, while paytable coefficients and multipliers are integers. Every normalized payout and whole-round cap therefore scales exactly across these stakes without an extra floor loss.

The purchased initial bonus is reconstructed independently by the settlement validator as {awarded:10, played:0, remaining:10, multiplier:1}. Every spin must start at that reconstructed multiplier. Empty, active and complete forged x50 origins are rejected. Unlike the Cosmic defect previously found, this engine already anchors its first purchased spin. Relevant source: src/shared/caramelCarnival.ts lines 51-55 and 78-79, server/games/caramelCarnival.ts lines 32-38.

Only a winning ordinary group activates spinner energy. Energy is added before payment, capped at x50 and retained between free spins. A natural bonus resets the base-spin multiplier to x1. Four or more final base tickets award ten free spins; three or more final free tickets add up to three, limited to thirty total awarded spins. A final partial award of two is legal when the count reaches thirty. There are at most twenty paid frames in one spin and thirty one history entries including a natural base entry. The twentieth winning frame still refills its removed cells; those final tickets determine the bonus award. That behavior matches both the generator and the displayed final-field rules. Relevant source: server/games/caramelCarnival.ts lines 20-30, shared validator lines 61-76, UI rules at src/ui/CaramelCarnivalUI.ts line 172.

The 5000-base-stake cap applies to the entire paid round. Reaching it clips the current payment, consumes no subsequent refill entropy, stops the remaining free series and suppresses a ticket retrigger. Credits are zero while the series remains active; the engine returns one total credit on completion. The audit directly exercised a legal capped series with an unpaid remainder in its last group, plus a limited frame containing three simultaneous payable groups. Relevant source: server/games/caramelCarnival.ts lines 12-15 and 21-28, src/shared/caramelCarnival.ts lines 43-46.

All eighteen controlled scenarios in native-engine-audit.mjs passed. They include origin tampering, energy values 2/3/5/10, a legal jump to x50, carry and reset, capped and partial retriggers, history and cascade limits, gravity, integer scaling on every allowed stake, malformed receipts and rejected revisions. Actual server functions and serialized receipts were used, without a database.

The separate native-round-screen.mjs implements its own ordinary-symbol counts, payouts, gravity, cap and bonus state transitions. It imports only fixed probability and paytable inputs from the game. Before sampling, 832 full rounds were replayed against the real server across both modes, all thirteen stakes and two replay seeds. Every full spin/frame receipt, final bonus state and subsequent RNG draw matched exactly.

| Mode | Actual debit for 1 USDT base stake | Complete paid rounds | Observed RTP | Approximate marginal 95% interval | Mean net player result |
| --- | ---: | ---: | ---: | ---: | ---: |
| normal | 1 USDT | 900000 | 95.612611% | 94.483072% to 96.742150% | -0.043874 USDT |
| festival | 35 USDT | 300000 | 96.275246% | 95.817277% to 96.733215% | -1.303664 USDT |

Normal mode includes every organically triggered bonus. Purchased mode completes every free continuation and retrigger. Three new reproducible streams were used per mode. Mean festival gross return was 33.696336 USDT for the full 35 USDT purchase, which must be used when interpreting a displayed accumulated win. Individual festival rounds exceeded their full price in 31.112333% of sampled rounds; this does not imply a positive mean return.

Limits: the confidence intervals use a normal approximation for independent full-round observations. They are not rigorous rare-tail bounds or familywise intervals. No cap event occurred in this statistical sample; cap correctness was checked through controlled engine scenarios. This audit does not establish a 96% plus or minus 0.2 percentage point policy, and the current RTP policy file has no Caramel qualification profile. Wallet atomicity, HTTP/authentication, browser recovery, actual production fingerprints and legacy rules-1 restoration are separate checks. This review tested the current custom Caramel rules-2 engine, whose receipt version is 1.

Reproduce from the project root:

```sh
node --import tsx scripts/game-math/caramel-audit/native-engine-audit.mjs
node --import tsx scripts/game-math/caramel-audit/native-round-screen.mjs
```

Compact results and source hashes are in native-engine-results.json and native-round-results.json. The latter records every seed, debit total, gross total, payout moments, replay digest and sampled feature counts. No game source, probabilities, prices or settlement rules were changed by this audit. Production access was not used.
