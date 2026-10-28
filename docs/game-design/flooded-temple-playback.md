# Flooded Temple 0.6.0: quick play and finite autoplay

## Behavior

The console has a Quick toggle, a 10/25/50/100 spin selector and an Auto/Stop button. Quick and the last selected count are optional local preferences. Running autoplay, its budget and a pending timer are never restored from storage. The default speed remains normal.

Quick replaces the long traversal presentation with the exact confirmed map, one relevant recorded cue and a short character reaction. A complete paid result takes 250 ms for loss, 280 ms for a partial return, 300 ms for stake return, 500 ms for a positive result and 800 ms for the existing big tier. Relic entry takes 450 ms and a free continuation 350 ms. These exclude API time and the existing audio output lead. Reduced motion retains its static 180 ms summary and takes precedence over speed. All durations are design choices, not scientific thresholds. Enabling Quick during an animation finishes its decorations without another operation.

| Action or boundary | Result |
| --- | --- |
| Start finite autoplay | Schedule one paid start at the selected stake through the common ExpansionClient. |
| Confirmed new paid round | Decrease the remaining paid-start budget once. Lock stake and count until the series ends. |
| Previous round still active | Send no new paid start. Wait for manual expedition choices. |
| Free step, rope or finish | Use the same accepted round; no counter decrement or additional stake. |
| Expedition completes | Continue the remaining paid starts after confirmed feedback. |
| Stop during timer or HTTP request | Cancel future starts; let the already accepted operation resolve under its original UUID. |
| Unknown reply or operation error | Stop. Leave manual retry of the same saved operation available. |
| Insufficient shared balance | Stop before the next paid request. Server validation remains authoritative. |
| Host pause, hidden tab, account change, close | Cancel the timer and series. No automatic restart on return. |
| Rules or confirmation dialog | Pause presentation and scheduling; resume after the dialog closes. |

The inter-round scheduling delay is 220 ms in Quick and 600 ms at normal speed. Every timer rechecks account, shared wallet, pending operations, balance, active bonus and presentation state before sending. Epoch guards prevent a canceled callback or old response from starting the next wager. Only one owned autoplay timer exists. Manual route choices are preserved; no route strategy is automated.

## Mathematical and module boundary

Rules/progress/API stay 1/1/1. Each paid request has the same game ID, selected accepted stake, normal settings and independent operation UUID as a manual start. Count is a client scheduling budget, not a price multiplier, paid continuation or new mathematical mode. Probabilities, payouts, choices, collection progress, settlement and qualification sources are unchanged. The common wallet and serialized operation transport remain authoritative.

## Verification

The final package is `0.6.0-66fb58b41116`, source SHA-256 `66fb58b41116ed42f06612d7ed500062e6233685cae445f8b0ce89b8cc4b07fd`. All 33 payload file hashes were verified, totaling 19,178,191 bytes. The full application build passed, including the current RTP gate and all module contracts. The existing host bundle-size warning remains.

The profile suite passed 31 tests, the full browser suite 31, RTP gate tests 27 and independent module checks 7. Seven new browser scenarios cover exact Quick settlement and persisted speed, ten unique paid operations and exact debits, locked stake/count, manual bonus pause and resumption, Stop while a request is accepted, unknown reply recovery under the original UUID, insufficient balance and lifecycle cancellation. The other scenarios retain animation/audio clocks, reduced motion, account recovery and actual host/chat verification on desktop and phone. The mathematical gate verifies 13 current profiles and reports 114 legacy modules as unqualified; no mathematical evidence was edited or regenerated in this iteration.

The scenarios use the disposable local preview database and demo funds. No production publication is included. Timings describe the configured presentation; they do not establish subjective enjoyment or guaranteed device latency. Exact evidence is in the [verification record](flooded-temple-playback-verification.json).

[Desktop controls with chat](../assets/flooded-temple/playback-desktop.webp), [phone controls with chat](../assets/flooded-temple/playback-mobile.webp).

Temporary files belong only to `artifacts/work/flooded-temple-controls/`. Previously denied cleanup targets remain excluded. The existing preview session 7918 stays available for user review; stopping it with Ctrl+C releases its temporary database. The active managed checkout remains in use while another chat works in the primary checkout.

Fresh main `d76746b1a5d22a4b5b15c2f2934aea7c052568b5` was merged without conflicts. Its three incoming commits update Caribbean character presentation and reports. Temple sources, mathematics and the tested immutable package bytes did not change. The combined application build passed again in 56,827 ms, followed by all seven module checks. [Storage inventory and result](flooded-temple-playback-storage.json) records only this iteration's three owned cleanup candidates, excluding every previously denied path.

The exact source was pushed to `codex/flooded-temple` at `806c3cb3ea3bceef059655b3b7552a4f04b526db` and its remote SHA verified with `ls-remote`. Cleanup of the three new targets, 49,440,101 bytes, was rejected before execution by automatic approval review: `blocked by policy`, without a detailed reason. Removed folders, files, archive bytes and total bytes are zero; physical reclamation is not claimed. These targets were not retried and now join the previously denied scopes. The active preview and package remain available for review.
