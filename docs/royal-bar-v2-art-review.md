# Royal Bar visual rework

The v1 functional implementation passed its technical checks but failed the user's visual review. Its flat Canvas scenery and character proportions did not match the approved rich illustrated reference. Technical readiness must not be recorded as visual acceptance.

The reference-based composition is now animated in the actual room. `Bar` retains the room-owned `MiraRoutine` and `NpcMotion`; `MiraRig` renders the detailed character parts using continuous joints from `miraPose`. `RoomScene` preloads the versioned scenery and character atlases. The single localized title, bar interaction bounds and seats retain their existing roles.

Run `node scripts/royal-bar-art-review.mjs` and open `http://127.0.0.1:5198/?offline=1`. The standalone local viewer supplies scripted Mira replies. Its optional action selector demonstrates individual movements; opening a conversation returns to the ordinary routine. Review controls move out of the way of dialogue and the camera fits the bar on narrow viewports. The viewer reads the previously reviewed host projection with the current bar modules, preserving unrelated host and catalogue inputs. `ROYAL_BAR_API_URL` selects an isolated real test backend, `ROYAL_BAR_PORT` selects its frontend port, and `ROYAL_BAR_REVIEW_UI=0` removes all demonstration controls for normal-host tests.

The scenery and character assets in `public/assets/royal-bar/v2/` were made with the built-in imagegen tool using the approved [reference](concepts/royal-bar-mira-reference-v2.png). The scenery extraction retains wood, brass, lamps and objects without baked lettering. The original seated Mira is retained as the identity reference. The animation uses `mira-body-parts.png`, `mira-limb-parts.png` and `mira-props.png`; their exact generation prompts are saved in [animation-generation.json](../public/assets/royal-bar/v2/animation-generation.json). Actual alpha is retained. Frame registration and runtime transforms do not redraw her as simplified vector shapes.

## Action specification

Timings and amplitudes are game-specific art choices. The existing 0.8-second seat transition and 3.2-second service timeline remain authoritative; a short 0.09-second pose blend softens action changes.

| Action | Visible phases | Trigger and interruption |
| --- | --- | --- |
| Sit / stand | Crossed seated legs, palm supported on the counter, glass lowers as she rises, legs retreat behind the counter | Existing routine; interrupted partial sitting reverses continuously before walking |
| Walk | Profile or rear view, alternating knees and feet, counter-swinging arms, restrained hair and body motion | Existing staff route and shared authoritative position |
| Wipe | Body leans, one hand supports, the cloth moves along the tabletop, then settles | Wipe job; reach ends before the cat's corner |
| Polish | One hand holds the glass, the other moves the cloth, then lowers both | Glass job; props remain attached to hands through pose blends |
| Stock | Rear view, bottle lifted toward the shelf, elbows stay outside the hair | Existing shelf job |
| Greet | Arm raises, brief wrist wave, arm returns | Newly opened nearby conversation; heartbeat does not replay it |
| Listen | Supported hands, slight head tilt, closed mouth | Typing or waiting for reply; no speech before a new reply |
| Reply | Small open-hand gesture, mouth movement, blink | Actual reply presentation; closing or restoring history does not leave transient speech |
| Serve | Take glass, raise and tilt bottle, pour, lower bottle, extend the glass and hold | Existing confirmed drink sequence; its completion does not create another drink action |

Arms blend rotations while retaining their lengths; props and the pour stream follow the blended hands. Upper body, tabletop hands and seated legs use separate depth layers. Reduced motion keeps informative action poses and essential transitions while stopping repeating gestures, blink, mouth cycles and steam. The renderer has no independent animation timers, and its generated textures are released on scene shutdown. No new audio, voice, money logic, game rules or catalogue entries are introduced.

## The cat's glass is required

The user explicitly requires preserving the cat's water glass and her approach to it. The mug remains a separate permanent object made by `drawCatCare`, named `cat-water-mug`, at `CAT_CARE.bar.mug = barPoint(254,114)`. Its depth is `CAT_CARE.bar.depth + 2`. The approach remains `barPoint(297,153)` and the perch remains `barPoint(224,112)`. The cat's route, elevated surface, drinking animation and water ripples remain owned by the existing cat modules. The new painted bar must be aligned around those points. A replacement bar image must never bake over, replace or remove that object.

## Local checks

TypeScript passed. Five illustrated-rig tests cover bone lengths, the continuous reversal of sitting, cloth contact and the reserved cat corner, props during pose blending, service completion and reduced motion. Five existing presentation/controller tests passed. The cat's complete climb, drink and exit test passed. The cat care, renderer, route and surface files have no feature changes.

Eleven real-host browser tests passed with an isolated PostgreSQL database and a real local backend. They cover entry, account changes, two viewers and late join, actual dialogue presence, reply, confirmed drink, history, close, seated contact and desktop/mobile layouts. A previous run exposed review-toolbar overlap; the final run used the ordinary host without review controls. An existing late-join test was corrected to wait while network state is not initialized rather than dereferencing null.

Eight action demonstrations were captured in the real room, followed by a real UI conversation using scripted local responses and a mobile viewport. Their asset requests and JavaScript checks passed. The named water mug stayed present, visible and at depth 513, above the character's foreground layer. The recording includes a clean comparison view with NPCs explicitly hidden by the review control; normal room tests retain NPCs. Physical devices and a paid live Mira provider were not used. This is a local implementation and verification, not a production deployment record.
