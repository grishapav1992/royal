# Atelier scenery

The animated local scene uses a clean booth background, a separate tailor sprite, and a foreground crop of the same booth image to cover the tailor's waist. The booth displays at 250 by 190 world units, with its bottom on the wall base at y=175. The tailor uses a 56 by 84 world-unit frame box, including transparent padding, keeping his head close to the ordinary characters' scale at the same camera zoom.

`public/assets/atelier/wall-atelier-v2.webp`, an alpha WebP at 1188 by 829 pixels (156,680 bytes), remains the static fallback and supplies the portrait in the order window. It was derived with the built-in imagegen tool from the approved tall-ceiling concept, then trimmed to its transparent bounds and encoded for the game.

The original generation is retained as `exec-3df88f43-5a99-40e5-a786-9187d282070f.png` in this chat's generated images. The approved reference is `exec-920bb680-b9e7-416a-95a5-48e7e89436ec.png`. The existing wall and its tall ceiling remain code-rendered. Interaction uses the image's bounds without a separate price label. A visual check of the integrated scene is saved in ignored `artifacts/skin-studio/local-full/final-room.png`.

## Animation assets and prompts

Both animation assets were created with the built-in imagegen tool using the approved static booth as their image reference. The generated originals remain in this chat's generated images.

| Asset | Saved game file | Source generation | Preparation |
| --- | --- | --- | --- |
| Empty booth | `public/assets/atelier/wall-atelier-empty-v1.webp` | `exec-a391b54e-16b9-438e-92ac-7d184b357100.png` | Transparent bounds trimmed, resized to 1188 by 829, WebP quality 94 |
| Tailor poses | `public/assets/atelier/tailor-poses-v1.png` | `exec-3a6ecaeb-bb4c-4440-9c8e-9b4d01ec91ac.png` | Eight silhouettes normalized at one scale and aligned into a 1024 by 768 atlas, 256 by 384 per frame |

Prompt set:

1. Empty booth: edit the reference game sprite, removing only the elderly tailor and his hands. Fill the revealed interior naturally. Preserve the exact architecture, sign, counter, mirror, suits, lighting, proportions and transparent exterior. Produce a clean background plate for animating the tailor separately.
2. Tailor poses: extract the same small elderly gangster tailor as eight separate upper-body poses in a four-column, two-row transparent sprite sheet. Preserve his identity, gray side hair, round glasses, white shirt, charcoal waistcoat, burgundy tie and yellow measuring tape. Include neutral front, greeting, side turns, closed-eye blink, adjusting his tie and an alternate walking pose. Keep the same drawing style, scale and head position across poses, with no booth, text, labels or grid lines. The lower body will be hidden behind a counter.

Frames 3 and 7 alternate for walking and are mirrored for leftward movement. Frame 4 supplies the blink, frame 5 the tie adjustment, frame 6 the left inspection pose. The foreground counter stays fixed throughout. No sound accompanies these decorative actions.

Validation: production build and all seven atelier/UI browser checks passed. A separate local browser run observed blinking, greeting, tie adjustment and walking in both directions without JavaScript errors; reduced motion froze the character at the centered neutral pose. Screenshots and captured state are in ignored `artifacts/skin-studio/tailor-animation/`.

## Tailor animation events

These are local decorative actions, unrelated to payments or generation results. Timings are art direction choices, not measured perceptual thresholds. The existing small character scale and booth remain the visual reference.

| Event | Trigger and meaning | Motion and synchronization | Interruption and accessibility | Verification |
| --- | --- | --- | --- | --- |
| Idle | Atelier is visible on the first floor | Subtle breathing, occasional blink; no sound | Pause when hidden or outside the hall; reduced motion uses a still pose | Character pixels change while the sign and counter remain fixed |
| Small task | Idle routine reaches a quiet pause | Adjust tie or examine fabric, then return to rest; no sound | No queued actions after a pause; stationary while ordering | Pose changes without resizing the character or crossing the counter |
| Step behind counter | Quiet interval between tasks | A short sideways walk, pause and return; upper body stays behind a separate foreground counter; no sound | Pause off screen; reduced motion remains centered | Character stays inside the niche, counter occludes the waist |
| Greeting | Player approaches the atelier | Brief greeting pose, then face the customer; no sound | Do not repeat every frame; normal ordering remains available | Approach and open still work; greeting does not create a purchase |

## Static sprite generation prompt

Use case: precise-object-edit / game asset extraction. Produce ONLY the tailor atelier seen in the attached approved casino screenshot, isolated as a production 2D game scenery sprite on a genuinely transparent background. The source atelier is the recessed rectangular booth just left of the upstairs turquoise door, approximately x570..880, y100..348. Closely reproduce that exact warm illustrated wood booth, its materials, lighting, proportions and small elderly tailor. Do not redesign it. No casino room, no adjacent gold wall pillars, no carpet, no floor platform, no door, no CASINO sign. Crop composition snugly around the outer DARK WOOD rectangular architectural frame of the niche, with a very small transparent margin. Straight front view, wide rectangular silhouette approximately 1.30 width to height. Match the original screenshot's hand-painted 2D South Park game prop look: warm brown wood grain with subtle dimensional edges, dark recessed side reveals, a warm interior, three tiny inset ceiling lights. The upper burgundy and gold horizontal sign reads EXACTLY 'АТЕЛЬЕ' in Russian, small scissor decorations at its ends. Keep sign modest in height, as in the source. Behind the shallow counter: small oval gold framed blue mirror on the left, tiny picture, potted plant and folded fabrics on a short wooden shelf, gangster suit rack on the right with a charcoal suit, white shirt, dark suit and a fedora resting below. A SMALL elderly male tailor is CENTERED behind the counter, with balding gray side hair, low round eyeglasses, a mildly serious elderly face, white shirt, dark charcoal waistcoat, burgundy tie, subtle yellow measuring tape, both hands resting on the ledge. Crucial: preserve the original source tailor's modest scale. His head must be only about 15-16 percent of the entire booth width, and his head plus visible upper torso only about 35-36 percent of the whole booth height. He is not a giant, not a large-headed closeup, not a portrait filling the opening. Keep plentiful visible interior on both sides and above him. The counter occupies the lowest quarter of the booth, with 3 wooden front panels and fine brass trim, matching the source. The counter is built into the wall and has NO projecting platform or floor. No large simple flat placeholder shapes, no overly bright yellow wood, no extra label above the sign, no text except АТЕЛЬЕ. Entire asset visible and uncropped, transparent outside its outer wood frame. This is a game-ready standalone prop derived from the approved reference, not a new casino mockup.
