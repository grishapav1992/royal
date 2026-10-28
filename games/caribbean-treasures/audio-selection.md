# Caribbean Treasures recorded audio

The user rejected the procedural score as sounding like an old game. Replace it with the instrumental loop of **Blackmoor Tides** by Matthew Pablo, published under CC BY 3.0 at https://opengameart.org/content/blackmoor-tides-epic-pirate-battle-theme. The selected original is `Blackmoor Tides Loop (No Chants).wav`. This is a produced orchestral arrangement, not a claim of a live orchestra recording. Keep the author's credit, source and license available inside the game and alongside exported files.

Finished Foley clips come from Kenney's Impact Sounds and RPG Audio packs (CC0), plus Thimras's Cannon hit wall (CC0). Preserve the selected originals and their exact mapping. No soundtrack from another commercial game is used. Source pages and license links are recorded in `assets/audio-credits.md` and runtime `audio/credits.json`.

| Confirmed event | Sample design and meaning |
| --- | --- |
| Click | Small metal mechanism, low level |
| Column lands | Three short wood-stop takes, chosen deterministically by column |
| Giant appears | Heavy wood contact, quiet creak and metal latch |
| Cannon grows the giant | Prepared cannon impact with a natural fading tail |
| Winning combination | Brief small-coin movement, below final-round level |
| Tactic selection | Chest latch, creak and a short coin rustle |
| Loss or partial return | Quiet wooden settling; no victory coins |
| Exact cost returned | Neutral latch |
| Positive complete-round result | Coin handling with chest opening |
| Large positive complete-round result | A longer layered coin/chest accent with music ducking |

These are presentation hypotheses. Preserve all rules, costs, probabilities and accepted rounds. The orchestral loop is a background bed, with separate music preference and short ducking under major accents. Use the common host context/output/volume/mute. Preload and decode immutable local files; missing or late samples must never replay a past result. Pause, close, hide, account changes and skip stop owned sources. Loading must not create a new context or wallet, and async completion after close must not restart audio.

Exports use stereo AAC, 44.1 kHz, 160 kbps music and 128 kbps effects. Normalize the music in two passes toward -18 LUFS with true-peak target -2 dBTP; preserve its dynamics. Effects use measured peak gain and short edge fades. Record onset markers from decoded exports so visual accents follow the actual sample attack, rather than the network response or an arbitrary file start. These levels and timing tolerances are engineering choices for this game, not scientific preference thresholds.

Verify decoded files, size, hashes, fades, real-host sample playback, mute, music-only mute, zero volume, skip/reduced motion, reopening, loading failure and late decode cancellation. The review preview must use this same playback class and the released samples. Peak and RMS are technical measurements; physical-device listening and user taste remain separate.
