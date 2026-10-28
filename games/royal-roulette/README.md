# Royal Roulette

European single-zero roulette in the Royal collection. The existing identity `royal-roulette`, host API 1, rules 1 and progress 1 are retained. The physical hall seats are unchanged. Every Royal seat offers roulette through the collection catalogue and the common independent module loader.

## Rules and money

One choice per round: red, black, even, odd or one integer from 0 to 36. The server draws one uniform integer from 0 to 36 with its existing cryptographic RNG. Outside bets return 2 times the stake; a straight number returns 36 times the stake. Zero loses outside bets. Returns include the stake. There are no bonus rounds, paid continuations or automatic stake progressions.

The exact RTP is 36/37 for every choice and every positive integer stake. The available common-wallet stakes are 10, 50, 100 and 500 virtual USDT. The screen distinguishes the credited return from the round net. All operations use the host wallet and its saved UUID; a retry or reopening never creates another wager. Account changes clear local presentation and suppress late effects. The backend preserves historical rules 1 receipts.

Qualification: `npm run qualify:rtp -- --game royal-roulette --write-proof`. It exhausts all 37 outcomes for each of 41 choices and all allowed stakes against an independent expected table, verifies integer unit and large-integer settlement, and replays two fixed independent seed streams. The exact analytical bounds are not sampling confidence intervals. The frozen legacy baseline is unchanged.

## Feedback events

Durations are implementation choices for this interface, not scientific thresholds.

| Event and meaning | Condition and scale | Presentation and synchronization | Sound | Interruption and verification |
| --- | --- | --- | --- | --- |
| Bet awaiting confirmation | A host operation is pending | Lock accepted choice and stake. Show confirmation text, never an invented result. | No new audio | Retry uses the same saved UUID. Check lost responses and reopen. |
| Wheel settling | A validated server receipt arrived | A 1.8 second deceleration lands the confirmed numbered pocket under the pointer. The ball and the result have one fixed reference at the top. | Shared hall ambience only | Reduced motion skips rotation. Pause, hide or close cancels the animation; settlement remains in the host wallet. |
| Losing round | Return is zero | Show landed number, credited return 0 and negative net. Highlight the numbered table cell. | Existing host reaction only | No reward celebration. Suppress reactions while hidden or paused. |
| Positive round | Return exceeds the accepted stake | Reveal the number, exact credited return and positive net together after the wheel stops. A straight hit uses the same clear result treatment. | Existing host reaction only | Emit at most once per observed operation. Recovered background settlement is displayed without a new reaction. |
| Recovery or account change | Saved pending request, replayed receipt or a different account | Restore accepted settings before retry. Clear old account results. Keep results and rules readable without sound in RU and EN. | No recovery cue | Destroy aborts listeners and cancels owned animation. Reopen uses the shared wallet instance. |

The layout fills the existing game stage and scrolls its field independently. The stake, spin and status footer stays visible while the host keeps the club chat. Validate desktop and phone sizes in the actual hall, including close, reopen, changed accounts, uncertain replies and immutable package loading. Technical browser checks do not establish subjective sound quality or enjoyment.
