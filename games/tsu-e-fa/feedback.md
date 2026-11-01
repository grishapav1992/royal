# Hand-duel sound, package 1.3.1

The module uses Royal's existing AudioContext, master output, volume and mute preference. Original procedural skin/paper percussion and damped wooden notes are rendered into short mono buffers. There is no music loop, browser speech, new audio context, network audio dependency or third-party recording.

| Server-confirmed event | Sound and visual accent | Interruption and recovery |
| --- | --- | --- |
| Own readiness or own private choice accepted | Dry wooden tick, once per transition | A retry or restored locked sign is quiet. The opponent's choice never determines a sound before disclosure. |
| Both confirmations fund the match | Two soft wooden taps | Indicates the match start; carries no victory signal. |
| Five pre-reveal chant beats | Soft palm knocks every existing 800 ms server beat, with a slight pitch lift | Future beats use the audio output clock; late beats are discarded. Reconnect shifts the server timeline while preserving consumed beats. |
| Confirmed reveal on three | Short palm slap with a papery tail | The hands, score and three caption wait for the estimated audible accent. It never predicts an unrevealed server result. |
| Point for self / opponent / tie | Two rising notes / two falling notes / equal neutral notes, 100 ms after the slap | A point is distinct from match settlement. |
| Final settled win / defeat | Short four-note wooden cadence / restrained descending cadence | Replaces the point cue on the final round. Refunds carry no victory fanfare. Finished results reopen silently. |

The existing Russian text chant stays visible. Reduced motion removes the fist rhythm while sound remains optional. The module sound button changes Royal's shared mute preference, and the main volume remains in Royal settings.

Scheduling uses `getOutputTimestamp()` when usable, otherwise `outputLatency` plus `baseLatency`. The lookahead is device latency plus 60 ms with a 120 ms minimum; countdown cues over 120 ms late are consumed silently. These are implementation choices for avoiding a backlog, not scientific perceptual thresholds. Reveal visuals use animation frames and the returned audible-time estimate. Output timing estimates do not measure acoustic playback through speakers or Bluetooth.

Mute, zero volume, hidden pages, a paused host, reconnect pauses, account changes and close cancel owned sources. Restoring availability consumes missed transitions, with no delayed result or batch of old beats. All nodes disconnect on completion or cancellation; subscriptions and animation frames stop on destruction.

Verification separates digital peak/DC/fade checks, real Web Audio playback through the shared host, event scheduling and cancellation from subjective listening quality. Physical phone speakers, headphones and Bluetooth listening are not inferred from a nonzero signal or automated viewport tests.
