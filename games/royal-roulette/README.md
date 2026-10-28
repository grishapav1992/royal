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
| Bet awaiting confirmation | A host operation is pending | Lock accepted choice and stake. Begin neutral counter-rotation without displaying an invented result. | No new audio | Retry uses the same saved UUID. Check lost responses and reopen. |
| Wheel settling | A validated server receipt arrived | A minimum 650 ms launch precedes a 3200 ms landing plan. Wheel and ball counter-rotate, the ball leaves the rim and settles inside the confirmed pocket. Its number then appears in the result badge below. | Shared hall ambience only | Reduced motion skips rotation. Pause, hide or close cancels the animation; settlement remains in the host wallet. |
| Losing round | Return is zero | Show landed number, credited return 0 and negative net. Highlight the numbered table cell. | Existing host reaction only | No reward celebration. Suppress reactions while hidden or paused. |
| Positive round | Return exceeds the accepted stake | Reveal the number, exact credited return and positive net together after the wheel stops. A straight hit uses the same clear result treatment. | Existing host reaction only | Emit at most once per observed operation. Recovered background settlement is displayed without a new reaction. |
| Recovery or account change | Saved pending request, replayed receipt or a different account | Restore accepted settings before retry. Clear old account results. Keep results and rules readable without sound in RU and EN. | No recovery cue | Destroy aborts listeners and cancels owned animation. Reopen uses the shared wallet instance. |

The layout fills the existing game stage and scrolls its field independently. The stake, spin and status footer stays visible while the host keeps the club chat. Validate desktop and phone sizes in the actual hall, including close, reopen, changed accounts, uncertain replies and immutable package loading. Technical browser checks do not establish subjective sound quality or enjoyment.

## Visual system 1.2

The table uses emerald felt, warm brass and polished wood tones. The wheel is scalable SVG artwork with a bevelled outer rim, separate numbered pockets, a recessed bowl, metal spindle and pearl ball. Its existing pocket order and confirmed landing angle are retained. The last result has its own coloured badge below the wheel, rather than replacing its physical centre.

Stake chips expose exactly the existing four common-wallet amounts. Selected chips and bets have a visible pressed state; the accepted controls lock during a request and restoration. Return and round net remain separate. The desktop field uses the classic three-row number arrangement; the phone uses six number columns, a full-height zero and an independently scrollable field. Stake chips, the confirmation action and club chat stay visible. No additional sounds, payout rules or stake progressions were introduced.

The spinning action icon is decorative waiting feedback and is disabled by reduced-motion preferences. Package 1.3 uses the shared launch, coast, drop and pocket timeline described below; the result appears after that presentation finishes. Visual quality is assessed from real-host screenshots, separately from mathematical qualification.

Short desktop viewports use a height-aware compact layout so the entire wheel and number field remain visible alongside chat. The visual browser check covers 1440 by 1000, 1280 by 720 and 390 by 844 viewports, including scrolling the phone field to number 36.

## Motion system 1.3

`SpinTimeline.ts` contains presentation-only trajectories. A single frame clock drives the numbered ring, spindle, ball orbit, radial drop, subtle trail and final hops. The wheel velocity decreases monotonically during the confirmed landing. The ball matches the pocket position and velocity before its final small hops, without fabricated stops on neighbouring numbers. The durations are design choices, not scientific perceptual thresholds.

`RouletteMotion.ts` owns the frame request, transient chip/bet responses, result reveal and history transitions. It cancels frames, resolves interrupted promises and releases effects on error, pause, hidden page, reduced-motion change, account change and destruction. A cancelled presentation snaps a verified receipt to its real resting pose and emits no delayed reaction. Background recovery stays quiet.

All 37 pocket alignments, counter-rotation, continuity and trajectory bounds have dedicated tests. The actual-host checks also verify cancellation, zero remaining owned frames/effects, loss/retry of an accepted response and close/reopen behaviour. See `docs/concepts/royal-roulette/motion-spec.md` and `motion-review.md`. No custom audio graph or new sound cues were added.
