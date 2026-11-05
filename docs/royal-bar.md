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
| Rest | Second job, after the first glass-polishing task | Walk left, sit down, relaxed seated hold, stand before leaving | First hold starts at about 10.35 s in an uninterrupted new shift; service and conversation take priority. Reverse partial sit continuously; check seat and counter contact |
| Walk | Staff route changes position | Bent knees/elbows, grounded soles, restrained hair motion | Authoritative stopping position; two viewers and late join |
| Polish | Glass job | Hold glass, rub with cloth, settle | Pause on service; no duplicate objects |
| Wipe | Counter job | Bend, move cloth along counter, settle | Cloth touches surface; no hand/body clipping |
| Stock | Bottle job | Turn toward shelf, lift bottle, return hands | Consistent hand and shelf lane |
| Greet | Nearby player opens dialogue | Face visitor, brief raised hand, listen | Heartbeat must not repeat greeting |
| Listen | Player types or awaits response | Four complete attentive poses form a restrained nod | No mouth movement before reply; reduced motion holds the neutral drawing |
| Reply | New reply displayed | Mouth poses and small hand gesture, listen | Restored history static; close/hidden tab clears transient speech |
| Service | Confirmed drink action | Take glass, prepare, hand over, hold | Animation never changes drink/financial rules or repeats an accepted action |

No new voice or music. Reduced motion retains informative poses while suppressing repeating gestures and decorative particles. Hidden-tab resumption uses current state without replaying missed events. Scene, dialogue and server keep their existing module boundaries.

Countertop occlusion is explicit: staff body, counter, staff contact poses, complete countertop objects, cat, then the cat mug. `royalBarLayers.ts` contains the five object outlines, including the small left glass and its base. Opaque objects use a small runtime texture crop with solid alpha because the original assembly has alpha 252-253 inside the coffee cup. Source PNGs retain their original bytes and alpha. This prevents the hands from showing over or faintly through solid objects. The cat mug remains at depth 513 and its approach and perch coordinates are unchanged.

The current main removes ambient NPC status captions in a separate change. Preserve that removal so those captions cannot cover Mira's seated pose; this follow-up does not restore them.

`npx playwright test --config=playwright.mira-animation.config.ts` starts the complete current host and a real isolated backend with disposable PostgreSQL. It checks every painted pose against a background reference on desktop/mobile, includes a negative control that reproduces the old glass overlap, then exercises the ordinary shared routine, dialogue, service and late arrival. `node --import tsx scripts/mira-animation-review.mjs` starts the same local room for review at `http://127.0.0.1:5202/?offline=1`; the page begins with the normal routine. The test pose controller is injected by that local Vite stand and is absent from the application build. No paid Mira provider is configured in this stand.

## Acceptance

Check all directions, continuous transitions, grounded contacts, coherent props and recognizable identity at real zoom. Exercise open, type, delayed reply, error, history restore, drink, close, leave, reconnect, pause and account change. Two viewers and a late arrival must agree on position/action. Verify one localized title, unchanged paths/seats, usable chat/dialogue on desktop/mobile, no JavaScript errors and no stale timers after close. Record automated checks, visual observations and physical-device limitations separately.
