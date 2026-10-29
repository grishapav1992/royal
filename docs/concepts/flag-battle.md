# Флажочки: Flag Battle

Independent module `flag-battle`, host API 1, rules 2, progress 1. Twelve, twenty-four or forty-eight countries compete in a circular arena with a rotating opening. A player chooses a mode and country before paying. All countries within the chosen mode have identical odds. No live opponents or viewer votes are implied.

## Modes 2.0 specification

New starts choose Classic (12), Expanded (24) or World (48) before payment. Every flag in the chosen fixed roster is equally likely to win. Total return includes the stake: 11.52x, 23.04x or 46.08x respectively. Each mode has exact analytical RTP 24/25, with the existing six integer-cent stakes. No extra paid action, bonus, continuation or progress is introduced. Rules-1 sessions and requests without a mode retain the original twelve-country roster and settlement. Explicit mode starts use immutable rules/view 2, and require capability 2; capability 1 clients only see rules-1 sessions. Qualification must cover legacy starts and all country/mode/stake choices before building.

| Event | Confirmation and presentation | Audio and interruption | Verification |
| --- | --- | --- | --- |
| Mode selection | Unpaid buttons show roster size, 1/N odds, total multiplier and quote before the bet; preview resets to that roster | Existing soft selection pop; no music | Locked during submission, unresolved request and presentation; selected country preserved if present, otherwise RU |
| Accepted start | Server-saved mode and complete order determine roster and outcome | Existing one-shot start, spaced physical contacts and actual-exit effects | Country, mode, stake and reply must match; old requests replay with original rules |
| Larger battle | Body radius scales to roster; 24/48 bodies start separated and exit physically through the opening; selected body outlined | Same density cap as Classic, no louder or denser wall chatter | Complete deterministic trajectory, readable desktop/mobile host with chat, no clipping or overlap at placement |
| Final two and result | Final two follows exit N-2; result after N-1 exits, one winner remains | One final-two cue and one appropriate paid result accent; zero return stays neutral | Skip, restore, reduced motion, mute, hide and close retain their existing cancellation behavior |

Larger rounds target 24 and 30 seconds, with a scrollable flag picker so bet controls remain reachable. These are design choices, not research thresholds. Physical timing and sound pleasantness still require device/listening assessment. The math qualification, wallet/retry compatibility and real host layout checks are release gates.

Modes 2.0 verification, 29 October 2026: all 576 legacy/mode/country/stake profiles qualified with 16,000,000 independent-model observations per choice, exact integer settlement and 304,128 cross-checks through the production permutation. Observed estimates ranged from 95.651424% to 96.339456%; each exact analytical expectation remains 96%. The target, tolerance, confidence level and maximum confidence half-width were preserved; samples were increased for the higher variance of larger rosters. Country comparisons use common winner streams, with independent seed streams and separately seeded modes.

Verification passed 16 sound/physics tests, five mathematics/common-wallet/native-journal tests, thirteen Caribbean compatibility/wallet tests, twenty-four RTP gate tests, seven package integrity/host-boundary tests and four Chrome scenarios. A final repeat covered the container layout at 669 by 804 with chat and mobile at 390 by 844. A full natural World round produced 47 actual exits, 47 elimination cues, one final-two cue, one appropriate result cue and a single remaining country matching the saved server winner. Mode/stake locks, search, country fallback, saved mode, legacy round restoration and lost-response replay were checked. The shared physics/audio clock now uses each mode's own duration.

The game and all thirty affected existing client packages were rebuilt; source hashes and bytes of all 119 active packages passed integrity checks. Host TypeScript, JS/CSS, backend, reconciliation and payments compilation passed. The monolithic build was stopped while reading unrelated untracked resource duplicates containing ` 2`; those source files were preserved untouched. Host compilation was completed without automatic public copying, then all 699 tracked or task-reviewed public files were copied from this checkout to the ordinary build directory. This is local verification, not a production release or a successful unmodified monolithic build. The existing seven demo wallets were retained and their complete balance rows matched before and after the local stand restart. No production publication was performed.

## Complete paid round (legacy rules 1)

Allowed common-wallet cent stakes: 100, 200, 500, 1000, 2000, 5000. A server-side uniform Fisher-Yates permutation fixes the elimination order. Its last entry wins with probability 1/12 for every country. Return is floor(stake * 288 / 25) for a winning choice, zero otherwise. For these stakes the division is exact, giving exact analytical RTP (1/12) * (288/25) = 24/25 = 96%. The 11.52 multiplier includes the stake. No boosts, cashout, extra paid actions, bonuses or persistent progress exist.

The existing expansion transaction debits once and credits the full outcome atomically using the common wallet, account lock and request journal. The saved immutable rules-1 session survives close/reopen, retry and server restart. The browser animates the saved order; collisions are presentation, not a separate settlement engine. A capability header hides this session from older clients. The new host catalogue requires a host release before independent module publication.

## Feedback events

| Event | Condition and meaning | Visual and sound | Interruption and verification |
| --- | --- | --- | --- |
| Selection | Unpaid choice | Gold outline and country name; soft pop | Keyboard buttons with pressed state; locked while submitting/presenting |
| Accepted round | Validated session for the submitted operation | Arena starts with all twelve countries; short upward puff | Uncertain response offers retry of the same ID; no speculative outcome |
| Elimination | Next country in the saved order reaches the opening | Flight through the opening, survivor count and elimination list; short airy cue | No rapid flashes; hidden tab skips to saved result without queued sound |
| Final two | Ten confirmed presentation eliminations | Two larger readable flags; no additional reward implication | Reduced motion presents the saved final result directly |
| Victory | Saved winning flag remains | Winner name and full return; rounded result accent only for a positive net result | Restoring a saved session is silent and has no repeated celebration |
| Loss | Selected country is not last | Winner name and zero return; neutral low tap | No win celebration for losses |

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

## Sound design 1.3

All sounds use the existing host audio context, output, mute and volume. These are original synthesized effects, with no additional audio context or downloaded recordings. The user requested pleasant effects without music. Version 1.3 replaces note sequences and bright ringing with rounded, low sliding pops and filtered air. There is no music bed, melody, arpeggio or looping source. This warmer, sparser palette is a design hypothesis awaiting the user's listening assessment. Contact cues have at least 160 ms between onsets; elimination and final-two cues take priority. A rolling lookahead schedules cues against the visible physics playhead and the host output timestamp, using reported output latency when available. The 40 ms engineering synchronization target is not a perceptual threshold or a claim about untested Bluetooth devices.

| Event | Meaning and confirmation | Sound and sync point | Interruption and comfort |
| --- | --- | --- | --- |
| Selection | Unpaid country or stake choice | Small rounded pop after a user gesture | No delayed replay after unlock, account change or close |
| Accepted start | New validated server round starts presentation | One low upward puff at the first arena frame | No start cue while awaiting the server; restored rounds stay silent |
| Flag contact | Approaching bodies exchange impulse | Quiet rubber-like knock, energy-dependent level, horizontal stereo position | Weak contacts ignored; strongest spaced contacts retained; no idle-preview audio |
| Ring contact | Body reflects from the rim or a moving end cap | Short muted wooden tap at physical impact | Same density and voice limits as body contacts; no continuous wall chatter |
| Elimination | Body fully clears the opening | Brief low-pass airy outward sweep with a soft falling pop | Suppresses nearby impact cues; one event per actual exit; selected country has a lower pop |
| Final two | Tenth exit leaves two flags | One soft hollow accent | Not a payout or win signal; never repeated by restore |
| Positive paid result | Selected country wins and its confirmed return is shown | One rounded pop with a short airy tail, no sequence of notes | Only for a positive net paid-round result; skip, hide, mute and close cancel queued sources |
| Zero return | Another country wins and zero return is shown | Neutral low tap | No victory figure or celebratory loss sound |

Reduced-motion fresh rounds use a brief result cue only. Restoring saved rounds is silent. Mute, zero volume, hidden tabs, pause, account changes and destroy stop owned voices and discard future cues; enabling sound resumes from the current visual time and does not replay the past. Offline rendering tests can verify signal, envelopes and headroom, but listening quality requires human assessment and is not inferred from RMS alone.

Version 1.3 verification on 29 October 2026: 28 tests passed, covering audio timeline/lifecycle, physics, paid mathematics/wallet recovery, package compatibility and three Chrome browser scenarios. Eight isolated cues rendered through the production synthesizer with absolute peaks from 0.0392 to 0.0855 full scale, silent final 100 ms tails and zero remaining voices. This is a per-cue signal check, not a claim about total host mix loudness or pleasantness. Contact onset spacing, short non-looping simultaneous layers, output-timestamp mapping, late unlock, mute/unmute, skip and destruction passed. The desktop/mobile host with connected chat produced eleven elimination cues, one final-two cue and exactly one appropriate result cue; saved-round restore stayed silent and lost-response retry debited once. Physical speaker/headphone/Bluetooth synchronization and subjective listening quality have not been assessed; the 40 ms engineering target is not an acoustically measured claim.
