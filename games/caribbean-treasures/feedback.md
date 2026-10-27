# Caribbean Treasures feedback specification

Design parameters below are game-specific hypotheses, not scientific perception thresholds. Confirmed rules and money remain in the common backend.

| Event and condition | Picture and meaning | Sound and synchronization | Interruption and verification |
| --- | --- | --- | --- |
| User requests a paid start or free spin | Decorative rolling strips and confirmation badge; no invented result | Music starts only after a gesture. No result sound until confirmation | Failed request leaves the common pending operation. No outcome cue |
| A new confirmed spin is accepted | Six columns settle sequentially, with a 100 ms preparation wait before each aligned accent, then the server's `gridBefore` is readable | Short wooden/percussive landings, each visual scheduled for the predicted audible output time | Skip, pause, hide, close or account change shows the current confirmed field and cancels owned audio |
| Confirmed giant exists | One continuous 2×2 or 3×3 symbol scales into its occupied cells over 280 ms | Warm low string accent at reveal | Reduced motion shows the complete shape immediately |
| Confirmed cannon expands `blockBefore` | Warm muzzle accent, then the exact containing block and `grid` replace the previous field over 320 ms | Low drum and airy sweep; no repeated screen flashes | The block never grows beyond confirmed coordinates |
| Confirmed winning cells | Continuous giant outline and borders outside it; integer round tally over 280 ms | Short bell, softer than final positive outcome | This is accumulated round money, not a separate wallet credit |
| Natural tactic choice or purchased series | Boarding card and explicit free-spin count | Brief flute motif | A purchase confirmation states its actual rounded price; cancelling does not wager |
| Complete paid round, W < B | Exact credit and negative net; neutral return label | Quiet settling note, no victory fanfare | Partial payouts are not celebrated as profit |
| Complete paid round, W = B | Stake returned label and zero net | Neutral pair of notes | Classification uses full accepted paid-round cost |
| Complete paid round, B < W < 20B | Positive round result, short gold emphasis | Resolving plucked-string phrase | Same key cannot replay through refresh or reopen |
| Complete paid round, W >= 20B | Large positive round result, 700 ms gold flourish | Longer resolving phrase with low percussion, music ducks | Skip ends decoration without another request or credit |

Original procedural music: quiet 6/8 maritime guitar, bass and flute in an eight-bar phrase. It uses the host AudioContext and output, global mute and volume, and an independent music preference. Owned voices have a simultaneous limit (48 total, 24 for music), short attack/release, and stop on mute, zero volume, hidden document, pause, close and account change. No queued result sounds resume after interruption.

Audio accents use `AudioContext.getOutputTimestamp()` when valid, otherwise output/base latency, with 70 ms of audio scheduling lookahead. Visual accents reserve 24 ms for the next animation frame and painting before the estimated audible moment. Engineering target on the local test device: absolute scheduling deviation <= 50 ms. This measures scheduling, not physical speaker or Bluetooth latency. Silent and reduced-motion variants preserve all money and state information. There is no repeating full-screen flash; decorative pulses are at most one per confirmed event.

Compare the same saved scenarios from `docs/concepts/caribbean-treasures/scenarios.json`. Record signal peak, owned-source cleanup, actual scheduling deviation, readable money, no replay, and real host/chat layout. Listening comfort and physical phone/headphone/Bluetooth assessment must be distinguished from automated signal tests.

Reference art upgrade: see [reference-polish.md](reference-polish.md). Every cell and giant uses the same illustrated WebP master. The owned music and effects branches each have a short room impulse; muting music leaves effects available. Pausing discards both branches, so reverb tails cannot return on reopen. The default gain is explicitly zero before scheduling the first attack, including starts between sample boundaries.
