# Roulette motion specification

Presentation design hypotheses for package 1.3, dated 2026-10-29 (Europe/Moscow). These durations are engineering choices for this interface, not established perceptual thresholds. Server rules, stakes, draw probabilities and integer settlement remain unchanged.

| Event | Meaning and trigger | Motion and common timeline | Sound | Interruption and verification |
| --- | --- | --- | --- | --- |
| Choose a bet or chip | A permitted local choice changes | Short scale response on the chosen control; the selected-bet summary settles gently. No money is sent by selection. | No new cue | Cancel effects on hide, pause, account change or close; reduced motion skips them. |
| Launch | The player submits or explicitly retries a saved operation | One frame clock accelerates the wheel clockwise and the ball counterclockwise. At least 650 ms of launch precedes a confirmed landing. An uncertain request may continue orbiting without displaying an invented result. | Existing shared ambience | Error stops owned motion and retains the host pending operation for retry. |
| Coast and drop | The existing server receipt is verified | A 3200 ms landing plan matches current angular velocity and decelerates to the confirmed pocket. The ball leaves the outer track, joins that pocket and settles with small radial hops. Final angular wobble stays inside that pocket; neighbouring false stops are not added. | No new cue | Wheel and ball use the same frame time. Pause, hidden page or reduced motion snaps only a verified receipt to its true resting pose. No stale animation resumes. |
| Reveal | The ball has settled, or a verified receipt is shown quietly | Reveal the confirmed number, exact return and net together. Apply a neutral result accent and slide the new history chip into position. A positive net may receive a modest extra highlight; zero return receives no reward celebration. | Existing host reaction only | Once per observed UUID. Background recovery remains quiet. |

The wheel, ball orbit and radial movement have one cancellation owner. The owner also releases selection, history and reveal effects. A media-preference change during a spin cancels motion. Closing or changing accounts cannot cause delayed effects, another request or a second reaction.

Verify all 37 pocket alignments, monotonic wheel deceleration, position/velocity continuity where the ball joins the pocket, finite bounded trajectories and final radius. In the actual host, verify both rotation directions, orbit-to-pocket progression, result timing, reduced motion, hide/pause, close during motion, uncertain responses and recovery. A short silent video demonstrates appearance only; it is not evidence of listening quality or enjoyment.

## Revision 1.5, 2026-10-31

The minimum launch remains 650 ms. Confirmed settling now lasts 4400 ms, with an exponential rolling-drag phase followed by a guided descent. The supported rim phase always counter-rotates and loses angular speed. The descent matches its entry position and velocity and captures the confirmed pocket at matching angular velocity. This is a presentation model with collision-inspired motion, not a simulation that selects a roulette outcome.

Six contact accents share one schedule. Successive flight times shrink by 0.68, and their ballistic heights by 0.68 squared. Piecewise parabolic flights replace the equally spaced sine hops. Small alternating lateral deflections stay inside the captured pocket; reported angular velocity includes their derivative. Ball lift, shadow spread and shadow opacity follow the same height. The wheel retains monotonic deceleration and exact final alignment at every pocket. The final result remains withheld until settling finishes.

All timings and restitution values are game-specific design hypotheses. Verification covers every pocket, long reply delays, coast/descent continuity, numerical angular derivatives, decaying flight durations/heights and the real host lifecycle. Reduced motion, hide, account change and close keep their existing cancellation behavior. No changed rules, probabilities, paid costs or stake choices are involved.
