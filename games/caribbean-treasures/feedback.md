# Caribbean Treasures feedback specification

Design parameters below are game-specific hypotheses, not scientific perception thresholds. Confirmed rules and money remain in the common backend.

| Event and condition | Picture and meaning | Sound and synchronization | Interruption and verification |
| --- | --- | --- | --- |
| A paid start or a free spin is requested | The reels roll as a vertical smear of symbols. The wheel waits. The balance keeps its earlier value until the answer | Music starts only after a gesture, a quiet rope creak | A refused or lost request rolls the reels back to the earlier field and keeps the balance |
| The answer is confirmed | Six columns land one by one with splinters. At least 0.6 s of rolling. The balance shows only the debit until the result is visible | Wood landings end with their column | The wheel opens the result at once after 350 ms. Hiding, pausing, closing and changing account show the confirmed field without movement |
| Confirmed giant | One symbol rises from water on two ropes in 0.5 s | Thud and creak land with the end of the rise | Reduced motion shows the complete shape |
| Confirmed cannon | Fuse, shot, ball and blast, then the block grows inside its confirmed bounds. About 1.1 s | The shot and the impact land with their picture | The block never grows beyond confirmed coordinates |
| Paid lines, total above the accepted price | Sabre traces for up to three lines, thin threads for the rest, sums on the last symbols, coins to the row | Short metal, then a small coin sound | Skip keeps the lit symbols and the exact sum |
| Paid lines, total up to the accepted price | Pale threads and outlines, sums on the last symbols. No sabre, sparks, coins or gold | Quiet wood | The row says that a part or the whole price came back, without a plus |
| Natural choice or purchased series | Two tactic cards, then sunset and hooks or storm and rain in about 2 s | Latch, coins, hooks or thunder | A reopened series returns with its sea at once |
| Complete round, B < W < 20B | The row names the loot and the net result, the pirate salutes | Coins and creak | The same key cannot replay after recovery |
| Complete round, W >= 20B | A chest, rays and a counter with the net result, about 3.2 s | Layered coins, music ducks | Skip and every interruption clear it |
| A pirate is reached | The plate turns green. The meeting opens a chest and shows her, with a Skip button | Creak, latch and coins | A refused save keeps the meeting open |

Recorded music: the instrumental loop of Blackmoor Tides by Matthew Pablo (CC BY 3.0). Finished Foley: Kenney and Thimras (CC0). See [audio selection](audio-selection.md) and [credits](assets/audio-credits.md). Twelve stereo AAC files are preloaded and decoded into the common host context; no oscillators or generated melody remain. A native buffer loop, separate music preference, measured sample attack markers and background ducking keep events clear. Owned voices are limited to 24 simultaneously, stop on mute, zero volume, hide, pause, close and account change, and never replay an event after loading. Music preference changes cancel future duck automation. Async loading after destruction cannot restart audio.

Audio accents use `AudioContext.getOutputTimestamp()` when valid, otherwise output/base latency, with 70 ms of audio scheduling lookahead. The scene starts a sound early enough for the movement to end with its audible accent. Engineering target on the local test device: absolute scheduling deviation <= 50 ms. This measures scheduling, not physical speaker or Bluetooth latency. Silent and reduced-motion variants preserve all money and state information. There is no repeating full-screen flash; decorative pulses are at most one per confirmed event.

Compare the same saved scenarios from `docs/concepts/caribbean-treasures/scenarios.json`. Record signal peak, owned-source cleanup, actual scheduling deviation, readable money, no replay, and real host/chat layout. Listening comfort and physical phone/headphone/Bluetooth assessment must be distinguished from automated signal tests.

The scene draws the same illustrated symbols, pirates and harbour by displacement only. A pose changes inside a short dip of the body, so two drawings of a face are never mixed. Breathing, blinking, waves and palms stop with the window, the pause and reduced motion. A changed pirate comes on deck between rounds. Caption text is gone: the result row stays authoritative, in both languages.
