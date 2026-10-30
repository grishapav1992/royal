# Galactic Reactor v1 feedback

Uses docs/game-feedback.md. Every reel stop, nudge and amount comes from the accepted server spin. The displayed stack is one three-cell tower whose position follows the recorded cyclic stop path. No decorative event changes a wager or future result.

| Event | Visible meaning and phases | Sound and synchronization | Interruption and verification |
| --- | --- | --- | --- |
| Pending request | Decorative repeated equipment strips inside fixed reel frames, status pending | Quiet mechanical start; no result cue | Stop cancels autoplay, not an accepted request. Unknown replies retain the common pending UUID. |
| Accepted stop | Reveal the actual pre-nudge window from left to right | Short rounded metal contact, scheduled on the host AudioContext output timeline | Reduced motion reveals directly. Closing, pause and skip cancel owned sources and motion. |
| Dovetail step | One raw strip cell advances in the confirmed direction; tower aligns and multiplier increases | Low energy surge; one shared visual/audio accent per actual step | Only the recorded steps are shown. No whole-interface shake. |
| Bonus entry | Eight-segment amber indicator; original stake remains fixed | Brief airy portal chord, separate from final credit | Restored bonus shows current remaining count quietly. |
| Result | Highlight the highest paid line and show total and net relative to the original round cost | Low-key partial/return, resolved warm chord only for a positive complete round | No profit celebration for a smaller-than-stake return or a recovered result. |

The visual lead, short stop intervals and nudge duration are game-specific art choices. Scheduling records host outputTimestamp/outputLatency estimates and measured visual skew. These are engineering observations on the test browser, not a claim about physical Bluetooth or all devices. Slow main-thread handling and hidden pages must not release stale cue bursts.

Music is an original rendered ambient space score, not the Star Wars soundtrack. Quiet layered string-like pads, a soft bass and sparse high harmonics support the hangar. Effects are locally synthesized physical/energy accents through the same host context and output. In-game music/effects switches are independent, respect the common mute/volume, and persist. Pausing and closing stop all owned audio. Pleasantness and fatigue require user listening and physical-device checks; signal measurements alone do not establish them.
