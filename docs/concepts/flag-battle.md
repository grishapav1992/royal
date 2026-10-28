# Флажочки: Flag Battle

Independent module `flag-battle`, host API/rules/progress 1. Twelve countries compete in a circular arena with a rotating opening. A player chooses one country before paying. All countries have identical odds. No live opponents or viewer votes are implied.

## Complete paid round

Allowed common-wallet cent stakes: 100, 200, 500, 1000, 2000, 5000. A server-side uniform Fisher-Yates permutation fixes the elimination order. Its last entry wins with probability 1/12 for every country. Return is floor(stake * 288 / 25) for a winning choice, zero otherwise. For these stakes the division is exact, giving exact analytical RTP (1/12) * (288/25) = 24/25 = 96%. The 11.52 multiplier includes the stake. No boosts, cashout, extra paid actions, bonuses or persistent progress exist.

The existing expansion transaction debits once and credits the full outcome atomically using the common wallet, account lock and request journal. The saved immutable rules-1 session survives close/reopen, retry and server restart. The browser animates the saved order; collisions are presentation, not a separate settlement engine. A capability header hides this session from older clients. The new host catalogue requires a host release before independent module publication.

## Feedback events

| Event | Condition and meaning | Visual and sound | Interruption and verification |
| --- | --- | --- | --- |
| Selection | Unpaid choice | Gold outline and country name; silent | Keyboard buttons with pressed state; locked while submitting/presenting |
| Accepted round | Validated session for the submitted operation | Arena starts with all twelve countries; silent | Uncertain response offers retry of the same ID; no speculative outcome |
| Elimination | Next country in the saved order reaches the opening | Flight through the opening, survivor count and elimination list; short host audio tap | No rapid flashes; hidden tab skips to saved result without queued sound |
| Final two | Ten confirmed presentation eliminations | Two larger readable flags; no additional reward implication | Reduced motion presents the saved final result directly |
| Victory | Saved winning flag remains | Winner name and full return; host win cue only for a positive net result | Restoring a saved session is silent and has no repeated celebration |
| Loss | Selected country is not last | Winner name and zero return; neutral host tap | No win celebration for losses |

Round duration and motion are design hypotheses, not research thresholds. Pause/visibility, account change and destroy cancel animation and pending cues. Shared host audio preferences govern every cue. Russian and English labels use the host language. Tests cover the real host with chat on desktop/mobile, server settlement, retries, ownership and capability negotiation. Technical checks do not establish listening quality or player enjoyment.

Research reference: [FlagsBattle classic circular escape mode](https://flagsbattle.com/). This module uses original presentation and local vector flag assets.

## Verification, 29 October 2026

- Qualification covers all 72 country/stake combinations, 4,000,000 sampled outcomes per country across two independent seeds, and 55,296 server permutation replay checks. The sample estimates range from 95.675328% to 96.286752%; the exact expectation remains 96%.
- Common-wallet and Nile-journal tests cover wins, losses, all declared stakes, duplicate concurrent requests, changed requests, store restart, account isolation and old-client filtering.
- Real Royal host with connected chat: desktop 1440 by 1000 and mobile 390 by 844, country selection, stake change, skip, full natural animation with eleven eliminations, reduced motion, close/reopen and lost-response recovery passed in Chrome. Mobile controls are reachable by scrolling within the game; chat remains visible. Speaker, headphone and Bluetooth listening quality has not been assessed.
- Existing Caribbean wallet, native journal and transport tests passed. The shared transport changes only add the Flag Battle branch and its optional capability. Caribbean mathematical sources, prices, bonus continuation logic and settlement calculations are unchanged. After reviewing those transport diffs, the three reviewed shared-source hashes were updated and the entire Caribbean proof was regenerated, including all 64 profiles and 4096 complete-round server replays. The frozen legacy baseline was not edited.
- The application build, RTP gate tests and independent package integrity checks passed. No production publication was performed.
