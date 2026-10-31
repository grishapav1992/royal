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

## Revision 1.5, 2026-10-31

Design goal: warmer ceramic and wood, a quieter bearing bed and less tiring repetition. The original sample generator now rounds transients with a sample-rate-independent 2800 Hz low pass before peak normalization. Chip and contact modes are lower; positive-result chimes use lower notes, gentler attacks and fewer high overtones. Continuous rolling uses smoothly modulated colored noise in place of the previous bright pulsed grain. These are sound-design choices, not measured preference findings.

The module master and repeated event gains are lower. The bearing follows wheel speed; rolling level and playback rate follow relative ball speed, and the bed fades as the ball drops into a pocket. The six contact peaks use the exact ballistic contact schedule from SpinTimeline. The audible sample peak, including its changed attack offset, is still mapped onto the output clock. The final contact and result reveal remain separate events. Loss receives only a quiet neutral cue; reward chimes remain limited to a positive net.

The host still owns context, volume and mute. No new context, external sound asset, wallet, timer owner or production dependency is added. Technical checks cover sample bounds, finite signal, loop seams, peak alignment, source limits, clean tails, cancellation and shared-context lifecycle. A listening review on phone speakers, wired headphones and Bluetooth is still required to assess preference and physical output delay; an offline waveform cannot establish either.
