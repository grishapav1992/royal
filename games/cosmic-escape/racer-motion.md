# Cosmic Escape racer

The racer uses transparent 640 × 1229 WebP clips and stills. The boots share the same contact points in every pose. The idle cycle transfers weight, blinks and gives the ponytail a small trailing movement. The renderer draws a single pose in each frame, including the weight transfer.

| Game moment | Pose |
| --- | --- |
| Waiting | Weight shift and blink |
| Rolling | Ready stance |
| Net loss | Relaxed shoulders |
| Full stake returned | Short nod |
| Net win | Fist raised |
| Return of at least 20 times the stake | Raised arm and stronger follow-through |
| Portal opens | Gesture toward the mission |
| Mission energy increases | Looks down to check the meter |
| A new WILD column is added | Raises a shielding arm |
| Echo resolves | Turns toward the second pass |

The reel and wallet timelines already define these moments. The racer plays on those events and returns to the current waiting or rolling pose when a clip ends. Reduced-motion mode uses the corresponding stills.

To re-encode, run `node games/cosmic-escape/render-racer.mjs poses.json public/assets/cosmic-guardians/racer-v2 <temporary-dir>` from the repository root with Google Chrome and `img2webp` installed. The JSON maps the ten clip names plus `blink` and `rest` to registered 1024 × 1536 RGBA source poses. Optional arguments after the temporary directory restrict the export to specific clip names. The checked-in WebP files are the runtime assets. Builds use them directly.

Every crew member uses the same canvas, clip names and durations, so the table above applies to all of them. `CosmicEscapeRacer.character()` switches the clip directory and downloads only the chosen character.
