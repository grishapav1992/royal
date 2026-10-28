# Caribbean Treasures character and motion direction

User request: improve the game animation and give the established adult pirate captain varied movement and event reactions. Preserve the approved character identity, costume, harbor, host/chat layout and recorded soundtrack. No rule, probability, stake, cost or payout change.

## Event cards

| Event | Captain | Field | Cancellation / meaning |
| --- | --- | --- | --- |
| Idle, visible game | Slow breathing, occasional blink and a short glance toward the field; deterministic variation | Quiet static field | Stop timers and owned animations on pause, hide, modal and close |
| Waiting for API / rolling | Focused look toward the reels, restrained alternating settling gestures | Continuous masked rolling strips | No outcome prediction and no response to near misses |
| Confirmed reel stop | One small nod/lean variant, aligned to the recorded stop attack | Actual four-cell column lands with a short settle | No repeated landing from polling |
| Confirmed giant | Attentive acknowledgement | One continuous symbol rises and settles inside the exact confirmed block | Do not split the giant image or invent cells |
| Confirmed cannon | Brief surprised expression and restrained recoil | Exact before-to-after block growth, local recoil, warm muzzle accent and fading smoke | No full-screen flash, no extra wager |
| Winning cells / accumulated money | Attentive acknowledgement, not a final profit celebration | Trace one representative paid route, emphasize all paid cells, count confirmed integer total smoothly | Preserve the authoritative final amount on skip |
| Confirmed tactic choice / purchased series | Open guiding gesture toward the field | Boarding card / accepted free-spin count | This is a bonus entrance, not a final wallet credit |
| Complete round loss / partial return | Calm sympathetic look, quiet shoulder settling | Exact payout and negative net | No victory expression, no prompt to chase losses |
| Complete round return of accepted cost | Neutral nod | Exact zero net | No victory particles |
| Complete paid round positive result | Existing positive pose plus a short gesture sequence | Modest gold particles, confirmed money | Compare against full accepted paid-round cost |
| Complete paid round large positive result | Delighted laugh / lifted spyglass sequence | Longer restrained gold flourish | Uses existing outcome threshold; no math change |

Character pose changes and movement are separate layers, including the mobile portrait. Idle variation uses one owned timer, not a continuous JavaScript render loop. Reactions are keyed to a newly confirmed operation and never replay on refresh, retry or reopening. Starting another spin interrupts the preceding decoration. A hidden/paused game owns no running character timer or animation. Reduced motion keeps a static meaningful pose and text while suppressing decorative motion and blinking.

New raster states: blink, focus, surprise, bonus, soft and laugh. Existing idle and positive masters remain. Runtime WebP images use the same portrait canvas and size. Event durations, 50 ms scheduling tolerance, particle counts and motion amplitudes are design choices, not scientific preference thresholds. Keep figures within their reserved area and the live chat visible at 1440x1000 and 390x844.

Verify: all reaction types, deterministic variation, paid-round outcome classification, no replay, exact cannon bounds, continuous giant art, exact integer tally after skip, reduced motion changes mid-show, hide/pause/account/close cleanup, asset decode/alpha/budget, native host/wallet recovery and a short real-host motion recording. Subjective appeal is separate from technical checks.
