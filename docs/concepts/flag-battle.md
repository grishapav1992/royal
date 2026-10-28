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

## Presentation physics 1.1

The arena now runs a deterministic 240 Hz equal-mass solver with interpolation. Visible flag radii and collision radii match. Bodies start separated, exchange normal momentum on contact, bounce from the circular rim and its moving end caps, and leave only after clearing the physical opening. A gentle downward acceleration and a smoothly widening opening prevent long quiet periods. The winner eases into the center after the last physical exit; escaped bodies continue outward and fade. Idle preview keeps the ring closed.

The solver first simulates twelve anonymous bodies using the saved visual seed. Its physical exit permutation is then labeled with the saved server country order before the first frame. Playback replays the same trajectory at a constant scale to approximately twenty seconds, followed by a short winner transition. No country changes identity during playback, no target is pulled toward the gap, and no flag is deleted by a scheduled timer. This is presentation of the accepted server result; it does not make the solver a source of wager randomness. Rules 1, odds, payout, request IDs, wallet, qualification sources and accepted rounds remain unchanged.

Event update: elimination is shown and sounded only when the whole body clears the rim. Opening changes are continuous; the moving end caps exchange impulse with contacting bodies. Hidden tabs, reduced motion, skip and restore still present the accepted result directly and silently. Timings and accelerations remain engineering choices for this game.

Physics verification covers elastic head-on and glancing contacts, coincident centers, separating bodies, separated initial placement, a closed rim, deterministic replay, 30/60/144 fps, bounded complete rounds and continuous motion through the opening. A 32-seed diagnostic completed every round; its largest per-step active-body movement was 0.01123 arena radii at a 1/240 second step. These measurements test the implementation and do not establish player preference.

## Sound design 1.2

All sounds use the existing host audio context, output, mute and volume. These are original synthesized effects, with no additional audio context or downloaded recordings. No music bed is added. Contact timbres are quiet and short; elimination and result cues take priority. A rolling lookahead schedules cues against the visible physics playhead and the host output timestamp, using reported output latency when available. The engineering synchronization target is within 40 ms on the tested local output; this is not a perceptual threshold or a claim about untested Bluetooth devices.

| Event | Meaning and confirmation | Sound and sync point | Interruption and comfort |
| --- | --- | --- | --- |
| Selection | Unpaid country or stake choice | Short, soft pluck after a user gesture | No delayed replay after unlock, account change or close |
| Accepted start | New validated server round starts presentation | Two rising notes at the first arena frame | No start cue while awaiting the server; restored rounds stay silent |
| Flag contact | Approaching bodies exchange impulse | Rounded wooden tick, energy-dependent level, horizontal stereo position | Weak contacts ignored; strongest contact per short interval; no idle-preview audio |
| Ring contact | Body reflects from the rim or a moving end cap | Short higher glass-like tap at physical impact | Same density and voice limits as body contacts; no continuous wall chatter |
| Elimination | Body fully clears the opening | Brief airy outward sweep with a soft falling note | Suppresses nearby impact cues; one event per actual exit; selected country has a lower, distinct note |
| Final two | Tenth exit leaves two flags | One restrained two-note signal | Not a payout or win signal; never repeated by restore |
| Positive paid result | Selected country wins and its confirmed return is shown | Short major arpeggio | Only for a positive net paid-round result; skip, hide, mute and close cancel queued notes |
| Zero return | Another country wins and zero return is shown | Neutral low tap | No victory figure or celebratory loss sound |

Reduced-motion fresh rounds use a brief result cue only. Restoring saved rounds is silent. Mute, zero volume, hidden tabs, pause, account changes and destroy stop owned voices and discard future cues; enabling sound resumes from the current visual time and does not replay the past. Offline rendering tests can verify signal, envelopes and headroom, but listening quality requires human assessment and is not inferred from RMS alone.

Sound verification on 29 October 2026: six timeline/lifecycle tests and seven physics/rendering tests passed. All eight cues were rendered in Chrome's OfflineAudioContext using the same synthesis code; individual peaks ranged from 0.0627 to 0.1363 full scale, all final 100 ms tails were silent and no voices remained after rendering. The real host with desktop/mobile chat produced all eleven elimination cues, the final-two signal and exactly one appropriate result cue; skip and close/reopen remained silent. Tests also covered lost-response recovery, late audio unlock, output-timestamp mapping, mute/unmute with discarded past cues, duplicate result IDs, destruction and the sixteen-voice cap. These are technical signal and lifecycle checks. Physical speaker/headphone/Bluetooth synchronization and subjective listening quality have not been assessed; the 40 ms engineering target is not an acoustically measured claim.
