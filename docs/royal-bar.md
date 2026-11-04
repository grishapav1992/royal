# Royal Bar and Mira

The agreed reference is a warm wood and brass bar, with Mira seated at the left during her rest. The dialogue portrait `public/assets/mira/portrait-haughty.jpg` defines the character: copper waves, half-lidded eyes, raised eyebrow, gold hoops, wine-red off-shoulder dress, gold belt and black apron. These features must read at actual room camera scale.

The single title is `Роял Бар` in Russian and `Royal Bar` in English, rendered once above the bar by the localization system, outside decorative textures.

## Sequence

1. Match the room character to the portrait and retain the approved composition.
2. Draw the back bar, counter, lamps, cups, plants and stools as separate native art layers within existing interaction bounds.
3. Add seated rest and continuous sit/stand transitions to the room-owned work routine.
4. Add greeting, listening, speaking and a preparation/handover service sequence.
5. Connect actual conversation presence and confirmed drinking to that timeline, including late arrival, interruption, pause and reduced motion.
6. Verify the real room and dialogue at desktop/mobile sizes and with multiple viewers, then prepare reviewed source for release.

## Event specification

Timings are initial game-specific design choices, not perceptual thresholds. Existing dialogue and drink rules remain authoritative.

| Event | Trigger and meaning | Visual phases | Interruption and checks |
| --- | --- | --- | --- |
| Rest | Rest job reached | Sit down, relaxed seated hold, stand before leaving | Reverse partial sit continuously; check seat and counter contact |
| Walk | Staff route changes position | Bent knees/elbows, grounded soles, restrained hair motion | Authoritative stopping position; two viewers and late join |
| Polish | Glass job | Hold glass, rub with cloth, settle | Pause on service; no duplicate objects |
| Wipe | Counter job | Bend, move cloth along counter, settle | Cloth touches surface; no hand/body clipping |
| Stock | Bottle job | Turn toward shelf, lift bottle, return hands | Consistent hand and shelf lane |
| Greet | Nearby player opens dialogue | Face visitor, brief raised hand, listen | Heartbeat must not repeat greeting |
| Listen | Player types or awaits response | Attentive pose and occasional blink | No mouth movement before reply |
| Reply | New reply displayed | Mouth poses and small hand gesture, listen | Restored history static; close/hidden tab clears transient speech |
| Service | Confirmed drink action | Take glass, prepare, hand over, hold | Animation never changes drink/financial rules or repeats an accepted action |

No new voice or music. Reduced motion retains informative poses while suppressing repeating gestures and decorative particles. Hidden-tab resumption uses current state without replaying missed events. Scene, dialogue and server keep their existing module boundaries.

## Acceptance

Check all directions, continuous transitions, grounded contacts, coherent props and recognizable identity at real zoom. Exercise open, type, delayed reply, error, history restore, drink, close, leave, reconnect, pause and account change. Two viewers and a late arrival must agree on position/action. Verify one localized title, unchanged paths/seats, usable chat/dialogue on desktop/mobile, no JavaScript errors and no stale timers after close. Record automated checks, visual observations and physical-device limitations separately.
