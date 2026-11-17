# Last Convoy animation facade

`LastConvoyUI` accepts a `ConvoyMotionFactory` through its constructor. The default factory creates `ConvoyMotion`; another implementation can receive the same board, audio, playback validity and UI ports. The common host still owns requests, UUID recovery, accepted rounds, rules and settlement.

The facade consumes the existing confirmed `ConvoySpin` and `ConvoyFrame` transcript. No server action, probability, bonus rule, stake or cost is added. Existing durations and sound cues are retained as presentation choices, not scientific thresholds.

| Event | Existing input | Presentation |
| --- | --- | --- |
| Request begins | Existing `start` or `convoy-spin` request | Neutral reels, held barricades and spin audio; no new outcome before confirmation |
| Reel lands | Board stop callback | Existing mechanical stop sound |
| Barricade collected | `frame.addedPins` | Charging phase, shield reaction and confirmed multiplier |
| Winning cascade | `frame.wins` and `frame.payoutUnits` | Highlight, group amounts and cumulative round total |
| Supplies fall | `frame.removed`, `drops`, `refills` | Existing removal and gravity animation |
| Evacuation signal | `spin.freeAward` | Existing radio signal and bonus message |
| Result | Confirmed session and spin | Final field, confirmed credited total and existing outcome cue |
| Restore or retry | Existing recovered session | Static UI sync; no call to `present`, no repeated reward cue |

`ConvoyHeroine` retains its existing reactions to presentation phases and its account-owned cosmetic progress. Reduced motion skips decorative waits and gravity, while retaining the exact field and amounts. Hidden tabs, host pause, account changes and close cancel playback and stop further result cues. Resume does not restart autoplay. Repeated presentation of the same account/session/revision is ignored.

Verification uses deterministic transcripts from the unchanged server engine, tests interruption before result feedback and checks the real host with connected chat at desktop and phone sizes. Technical verification does not establish subjective animation or audio quality.
