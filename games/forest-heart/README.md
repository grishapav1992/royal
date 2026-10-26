# Forest Heart v1

Independent client for `studio-forest-heart`, using Royal host API 1, rules 1 and progress 1. The common expansion transport and wallet own operations, sessions and money. This package only presents accepted public states. Mathematical rules: [rules-v1.md](../../docs/concepts/forest-heart/rules-v1.md).

## Event specification

The choices below are artistic and engineering hypotheses for this game, following [game-feedback.md](../../docs/game-feedback.md). Durations are not scientific perceptual thresholds. Every sound uses the host AudioContext and output.

| Event and trigger | Meaning and visual phases | Sound and synchronization | Interruption and verification |
| --- | --- | --- | --- |
| Idle, visible and unpaused | Slow character breathing, soft fireflies; no reward | Original quiet harp, airy pad and forest texture; enabled by a gesture and the common preferences | Hidden, pause, mute, volume zero, close or account change cancels owned voices; reduced motion removes travel |
| A confirmed new field | Wood tiles open, then actual contacts become readable; no fake near miss | One wooden landing sound at the end of reveal | All results remain visible when decoration is skipped; never creates a request |
| Confirmed manual turn | Only the accepted root turns 90 degrees; new pulse follows its confirmed network | Short wood and magic accent at rotation completion | No entropy or fee from presentation; verify original collected flowers stay paid |
| Source pulse | Mint light travels through the actual powered connected component; branches remain readable | Soft air sweep starts with the first lit root | A single frame clock uses the estimated audible output time; record timestamp mode, measured frame skew and latency separately |
| Connected flower | Petals open and show a series contribution; each receiver at most once per pulse | Three related bell notes at flower opening | No final wallet-credit language; restore and repeated replies do not replay notes |
| Confirmed choice or bonus entry | Elf blends to the spell pose, selectable roots or four bonus buds become clear | A short distinct rising phrase | One cue per accepted transition; no special payout inferred from entering the bonus |
| Complete series | Exact total and net relative to the original paid stake | No celebratory cue for zero, partial return or break-even; positive result gets a resolving chord; 10x gets a longer harmony | The 10x threshold is this game's presentation choice. Skip cancels decoration only. Restored history stays silent |

Normal reveal is 320 ms and pulse travel is up to 420 ms; fast mode shortens them. Reduced motion shows the confirmed state directly. Cue scheduling uses getOutputTimestamp when available, with outputLatency/baseLatency as a fallback. The engineering goal is at most 80 ms of visible frame skew from the estimated audible accent on the local test setup; this does not measure physical acoustic latency. Phone speakers, wired headphones, Bluetooth and human listening quality require separate listening records. Nonzero audio samples prove signal presence only.

RU/EN copy is local to the module. All controls are keyboard accessible. The choice is deliberate and has no timeout. There is no automatic paid spinning. Final verification and asset provenance are recorded under docs/concepts/forest-heart/.
