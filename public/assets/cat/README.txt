Zverochka game artwork

Generated with the built-in imagegen tool from the owner-approved concept, which
was based on the owner's photographs. No original family photographs are served
by the game. Approved concept: artifacts/cat-home/approved-concept.png.
Game atlas: public/assets/cat/zverochka-atlas.png.
Frame bounds and animation selection: src/game/CatRenderer.ts.

Local walking revision, 20 October 2026:
- zverochka-walk-v3.png: eight walking phases for each of four directions.
- walk-v3-frames.json: silhouette bounds, torso anchors and ground contact.
- walk-prompt.txt: built-in imagegen prompt and extraction notes.
The walk advances by travelled distance through src/game/CatWalkCycle.ts.
Shared walking speed is 78 world units per second. Stops and hall changes reset
the stride. Sleeping, hugging, eating and other artwork retain their own atlas.
Preview: /artifacts/cat-home/walk-preview.html on the local development server.
The cat remains local only and must not be published without a new explicit request.
Interaction UI: approach the cat and press E. A contextual key hint replaces the
permanent Cat button. Esc closes the panel or releases a hug, and walking away
closes the panel. Clicking the sprite cannot open a remote interaction menu.

Additional habits, generated with the built-in imagegen tool:
- zverochka-habits.png: rolling belly-up, drinking and eating animations.
  Exact prompt: habits-prompt.txt. Only rows 1, 3 and 4 are used.
- zverochka-climb.png: four separate climbing poses, with transparent alpha.
  Exact generation and extraction prompts: climb-prompt.txt.
Each atlas uses measured silhouette bounds to keep adjacent poses separate.
Claw sharpening: zverochka-scratch.png, four frames from the built-in imagegen
tool, exact prompt in scratch-prompt.txt. Rear paws stay planted, front paws
alternate on the permanent scratching post near the sunny window.
The mug and bowl are permanent Phaser graphics in src/game/catCareArt.ts.
Shared locations: src/shared/catCare.ts. Routine: src/shared/cat.ts.

Generation prompt:
Transform this approved cat concept into a production game sprite atlas of EXACTLY 20 separate sprites, on a fully transparent background. One image with aspect ratio 4:5, exactly FOUR equal-width COLUMNS and FIVE equal-height ROWS, all 20 rectangular cells equally sized, no grid lines or text. Each cell contains the SAME specific adult female tuxedo cat from the reference, whole body including paws, ears and tail, consistent size, centered horizontally, feet baseline at 82 percent of cell height, generous clear transparent margins so no sprite touches any neighboring cell. Clean stylized hand-drawn 2D game rendering, simplified fur, confident dark contours, NOT pixel art and NOT photorealistic. Camera for walking is the elevated three-quarter top-down view used in a cozy 2D game. Cat proportions and colors from reference: rounded adult body, black head, back and long black tail; white bib, belly, paws and lower hind legs; yellow-green eyes, black nose, long white whiskers; crucial asymmetrical small WHITE PATCH on the cat's LEFT muzzle (viewer RIGHT when facing front), small BLACK CHIN SPOT. Avoid symmetric muzzle. No clothing/collar.
Exact layout by rows: ROW 1 cat facing toward camera/down: column1 standing idle, columns2,3,4 consecutive walking steps with distinct alternating front and hind paw placements. ROW2 facing screen right in side three-quarter view: column1 idle standing, columns2,3,4 walking steps. ROW3 facing away/up showing black back and ears: column1 idle standing, columns2,3,4 walking steps. ROW4 facing screen left: column1 idle standing, columns2,3,4 walking steps. ROW5 distinct special poses: column1 relaxed curled/side-lying asleep with eyes closed and white forepaws folded, matching large resting cat in reference but WITHOUT cushion or window; column2 seated looking up affectionately with a slight head tilt; column3 seated licking a raised white paw, a tiny pink tongue visible; column4 compact relaxed upright cuddling pose, white forepaws forward as if on a human chest but no human/hand/prop visible. All poses must have precisely the same recognizable cat identity. No cushions, windows, objects, cast shadows, scenery, humans, outlines around cells, captions or labels. The only opaque pixels in the entire atlas must be the 20 individual cat sprites. Four columns, five rows, equal cells, no additional cats.

The generated atlas has individually painted silhouettes, so named frames use
measured bounds instead of assuming every painting fits an exact grid cell.
