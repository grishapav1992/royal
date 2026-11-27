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
| Bet awaiting confirmation | A host operation is pending | Lock accepted choice and stake. Begin neutral counter-rotation without displaying an invented result. | Soft launch and material rolling loops | Retry uses the same saved UUID. Check lost responses and reopen. |
| Wheel settling | A validated server receipt arrived | A minimum 650 ms launch precedes a simulated landing of about 4 to 5.5 s. Wheel and ball counter-rotate, the ball slows on the track, falls across the diamonds, clatters over the frets and comes to rest in the confirmed pocket. Its number then appears over the hub and in the result card. | Speed-following wheel and ball textures with diminishing contact taps | Reduced motion skips rotation. Pause, hide or close cancels the animation; settlement remains in the host wallet. |
| Losing round | Return is zero | Show landed number, credited return 0 and negative net. Highlight the numbered table cell. | Quiet neutral settling tap | No reward celebration. Suppress reactions while hidden or paused. |
| Positive round | Return exceeds the accepted stake | Reveal the number, exact credited return and positive net together after the wheel stops. A straight hit uses the same clear result treatment. | Short warm chime; fuller phrase for a straight hit | Emit at most once per observed operation. Recovered background settlement is displayed without a new reaction. |
| Recovery or account change | Saved pending request, replayed receipt or a different account | Restore accepted settings before retry. Clear old account results. Keep results and rules readable without sound in RU and EN. | No recovery cue | Destroy aborts listeners and cancels owned animation. Reopen uses the shared wallet instance. |

The layout fills the existing game stage and scrolls its field independently. The stake, spin and status footer stays visible while the host keeps the club chat. Validate desktop and phone sizes in the actual hall, including close, reopen, changed accounts, uncertain replies and immutable package loading. Technical browser checks do not establish subjective sound quality or enjoyment.

## Visual system 1.2

The table uses emerald felt, warm brass and polished wood tones. The wheel is scalable SVG artwork with a bevelled outer rim, separate numbered pockets, a recessed bowl, metal spindle and pearl ball. Its existing pocket order and confirmed landing angle are retained. The last result has its own coloured badge below the wheel, rather than replacing its physical centre.

Stake chips expose exactly the existing four common-wallet amounts. Selected chips and bets have a visible pressed state; the accepted controls lock during a request and restoration. Return and round net remain separate. The desktop field uses the classic three-row number arrangement; the phone uses six number columns, a full-height zero and an independently scrollable field. Stake chips, the confirmation action and club chat stay visible. The visual revision retained the existing payout rules and stake choices.

The spinning action icon is decorative waiting feedback and is disabled by reduced-motion preferences. Package 1.3 uses the shared launch, coast, drop and pocket timeline described below; the result appears after that presentation finishes. Visual quality is assessed from real-host screenshots, separately from mathematical qualification.

Short desktop viewports use a height-aware compact layout so the entire wheel and number field remain visible alongside chat. The visual browser check covers 1440 by 1000, 1280 by 720 and 390 by 844 viewports, including scrolling the phone field to number 36.

## Motion system 1.3

`SpinTimeline.ts` contains presentation-only trajectories. A single frame clock drives the numbered ring, spindle, ball orbit, radial drop, subtle trail and final hops. The wheel velocity decreases monotonically during the confirmed landing. The ball matches the pocket position and velocity before its final small hops, without fabricated stops on neighbouring numbers. The durations are design choices, not scientific perceptual thresholds.

`RouletteMotion.ts` owns the frame request, transient chip/bet responses, result reveal and history transitions. It cancels frames, resolves interrupted promises and releases effects on error, pause, hidden page, reduced-motion change, account change and destruction. A cancelled presentation snaps a verified receipt to its real resting pose and emits no delayed reaction. Background recovery stays quiet.

All 37 pocket alignments, counter-rotation, continuity and trajectory bounds have dedicated tests. The actual-host checks also verify cancellation, zero remaining owned frames/effects, loss/retry of an accepted response and close/reopen behaviour. See `docs/concepts/royal-roulette/motion-spec.md` and `motion-review.md`. Audio 1.4 adds the owned sound graph described below.

## Audio system 1.4

Original seeded modal/noise samples provide two restrained chip clinks, lower field placement, bearing and ceramic-roll loops, contact taps, a neutral loss and short positive-result chimes. The generator never uses game randomness. `RouletteSound` uses the host AudioContext, output, mute and volume; it owns only its sources, gain and panners. Rolling speed and pan follow the same pose as the SVG wheel. Contact peaks follow its zero-hop times. Selection and result peaks use per-segment animation easing so their explicit time offsets remain intact.

`RouletteSoundTimeline` maps future sample peaks through a valid output timestamp, with a latency estimate fallback. A 40 ms scheduling budget is an engineering check for this interface, not a hardware latency guarantee. Mute, zero volume, hide, pause, account changes, failure and close discard future sources and pending unlock work. Unmute does not restart the interrupted orbit. Recovery remains quiet. The local preview supports listening review; phone speakers, wired headphones and Bluetooth require separate hardware review. See `docs/concepts/royal-roulette/audio-spec.md` and `audio-review.md`.

## Feedback revision 1.5

The 2026-10-31 update adds rolling drag, a longer readable descent, ballistic flights with diminishing duration and height, alternating contact deflections, and a height-following ball shadow. Six shared contact times drive both the visible impacts and the output-clock-aligned taps. All 37 confirmed pockets retain exact alignment. This is presentation kinematics; the server still selects and settles the same European roulette rules.

The original audio is retuned toward lower ceramic/wood resonances, rounded transients, softer rolling noise and restrained warm chimes. Repeated events and the bearing bed are quieter. Pleasantness is a design goal pending device listening review, separate from technical signal and browser checks. See the revision 1.5 sections of the motion and audio specifications for event details.

## Ball motion revision 1.6.2

After rolling along the rim, the ball approaches a raised divider tip on the rotating wheel. The first impact reduces its slip relative to the wheel and sends it inward toward the confirmed pocket. A second impact reverses the remaining slip against the far side of that pocket. The ball then loses height and lateral motion until it rests at the pocket center. The two contacts and subsequent bounces use the existing visual and audio timeline. The server receipt supplies the destination for this presentation model.

## Visual system and ball physics 2.0

The 2026-11-27 redesign replaces the flat SVG wheel with a canvas wheel seen from a seat at the table (`WheelRenderer.ts`). The bowl has a raised wooden rim, a visible inner wall and cabinet side, a lacquered ball track, eight brass diamonds, numbered plates, pockets with raised frets, a marquetry cone and a chrome turret drawn with height. A fixed lamp glare and falloff stay in place while the rotor turns underneath, so the rotation reads as real. The ball has its own orientation: it rolls without slipping relative to the surface it touches, keeps its spin in the air, shows a faint seam at readable speeds, a fixed highlight, a height-dependent shadow and motion blur at high speed.

`BallPhysics.ts` integrates the ball at 960 Hz in wheel pixels: rolling drag and wall friction on the track, the inward pull of the bowl, deflection and lift from the diamonds, sliding grip on the rotor, collisions with moving frets, hops with restitution and capture once the ball rests relative to the rotor. A small seeded generator varies restitution and lift for presentation only; it never sees game randomness. The server receipt still selects and settles the number.

The confirmed pocket is reached without steering the ball. All pockets have identical geometry, and the ball never touches the rotor before it first reaches the rotor edge. Before that moment the rotor's speed profile is reshaped, always monotonically decreasing, so that afterwards the rotor is advanced by a whole number of pockets. The simulated motion is therefore unchanged, and the number under the ball becomes the receipt number. After capture the ball rolls to the pocket centre and the rotor brakes to rest. Planning takes a few milliseconds; a presentation failure snaps to the verified result.

The felt is one continuous table: the wheel heads it on tall playfields, wheel and felt sit side by side on shorter ones, and phones keep the wheel full size with bets in the shared panel. The chosen field carries a chip with the stake. A win lifts the chip and shows the return over the hub; a loss sweeps the chip and replaces it. The history is a tote board with red numbers to the left and black to the right. Tests in `server-tests/roulette-motion.test.ts` check every pocket from several rotations, waits and seeds, rotor monotonicity and continuity, bowl and fret bounds, contact order and determinism.
