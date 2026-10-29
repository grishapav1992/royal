# Roulette audio specification

Package 1.4 audio design, 2026-10-29 (Europe/Moscow). Material character, durations, levels and the synchronization target are engineering choices, not scientific perceptual thresholds. No sound selects or modifies a paid outcome.

| Event | Meaning and sound | Synchronization | Interruption and evidence |
| --- | --- | --- | --- |
| Choose a chip | Short porcelain clink with a soft felt body | Dominant sample peak targets the existing selection pulse peak | No cue on hover, disabled controls or wallet refresh. Respect shared mute and volume. |
| Choose a field | Lower, dry chip placement | The same selection pulse clock | Rapid input remains bounded; mute/close cancels queued cues. |
| Launch and orbit | Soft bearing/felt texture and a light ceramic roll | Motion and sound share a planned performance-clock start. Ball rate and gentle pan follow the existing pose. | No separate AudioContext. Suspended/blocked audio fails quietly; no late catch-up after unlock. |
| Drop and pocket contacts | A diminishing series of restrained wood/ceramic taps | Future contact times are derived from the same landing plan, adjusted for each sample's peak offset and the output-clock mapping | Cancel future nodes on mute, hidden page, pause, account change, network failure and close. |
| Final result | Neutral final knock for loss; short warm chime for a positive net; a slightly fuller phrase for a straight-number hit | The confirmed result badge's peak, after the real ball landing | No win cue on a zero return, no repeated cue on background recovery. No fanfare, coin rain or punitive loss buzzer. |

Original seeded modal/noise synthesis creates the material samples locally. No external recordings, downloads or provider keys are required. Samples have shaped attacks/tails and seamless rolling-loop boundaries. Own nodes feed the host output, which already owns master volume and its limiter.

Use AudioContext.getOutputTimestamp when valid; otherwise estimate the render/output lead from available latency fields. Record which method was used. Compare planned audible sample peaks with the animation clock; a 40 ms scheduling-error budget is a local engineering check, not a universal perceptual threshold. Physical speaker, headphone and Bluetooth latency requires hardware testing and must not be claimed from an offline render.

Render representative stake, roll, drop, loss and win sequences. Check finite samples, peaks, tail silence, loop seams, overlapping cues and repeated playback. Verify actual-host mute, zero volume, unmute without stale replay, shared context identity, close/reopen and account changes. Nonzero signal and unclipped output are technical checks; a preview supports listening review but does not prove universal pleasantness.
