# Star Spin rules 2: source review

3 November 2026. Baseline: `d5b4a28f15a3a6d0050927bcc5fc190e3f4c094a`, synchronized with main `44b12afd5f3707f49b0d435dfa526ba59d346db4`.

The first publication requires the nine common stakes, starting at 0.10 USDT for all 20 lines. The prior six-stake definition remains historical rules 1. Its reel strips, paytable, WILD search, additive multipliers, scatter law, eight continuations and source implementations remain byte-identical. Rules 2 use a separate transcript adapter in `src/shared/wildNudgeStakes.ts`.

The independent rules-1 model proves a full-round RTP of 0.96137192293385. Rules 2 use the same consumed five-reel stops and the same `wildNudgeSpin` evaluator. They accumulate `stake * sum(points) / 100` through the complete round. The common independent uniform final ticket preserves this exact rational expectation at every denomination. No intermediate payout is credited, and the ticket is drawn only when every bonus continuation has completed. The reserve of 8608 times stake still exceeds the ceiling of the unchanged maximum of 8607.9 times stake.

## Review of shared monetary dispatch

- `src/shared/casinoExpansion.ts`: the WILD-specific import now accepts the rules-2 transcript type. Rules-version validation additionally accepts version 2 only for `studio-wild-nudge`. Other identities, settings, stake validation and reply formats retain their existing branches.
- `server/demoExpansion.ts`: the WILD validator accepts both historical and new transcripts. Only a WILD start pinned to `stakePolicyVersion=1` selects rules 2; legacy starts and saved moves retain rules 1. Move dispatch chooses the adapter using the accepted session's rules version. Other game branches, paid costs, capability argument positions and settlement paths are unchanged.
- `src/shared/roundPrecision.ts`: the new rational award branch is guarded by `view.wildNudge`. The denominator is asserted against the unchanged 20-line, five-point scale in `server-tests/star-spin-stakes.test.ts`. No other award branch changed.
- `src/shared/gameStakes.ts`: only Star Spin's registration is added. The nine denominations, default and validators remain unchanged.
- `src/shared/arcadeCatalog.ts`: only Star Spin is added to the existing collection and removed from the unpublished predicate. No other game is restored.

The new adapter has no wallet, network, mutable global state or entropy side effects at module initialization. Its replay validation reconstructs the original reel outcomes from consumed stops. Historical validation delegates to the unchanged rules-1 validator.

## Scope of the Caribbean model review

The Caribbean mathematical model, engine and transport sources remain unchanged. The shared dispatcher changes above apply only to WILD. The independent 4096-case Caribbean replay completed on the changed dispatcher before its reviewed-source guard required this review. The existing complete-round model remains applicable; its reviewed shared-source fingerprints are advanced with this explanation, and its proof must be regenerated through the qualifier. Mathematical hashes in a proof or the legacy baseline are never edited to pass a build.

Every affected mathematical and shared-stake profile is regenerated with the actual current sources. Existing sampled-slot moment records are reused only when every sampler source hash is unchanged; fresh current-runtime and real-wallet replays are still required. Changing any sampler source rejects that reuse. Final qualification and wallet results belong in the release verification record, not in this source-review rationale.
