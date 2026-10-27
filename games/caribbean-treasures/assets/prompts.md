# Art provenance

Tool: built-in ImageGen, 26 October 2026. All three PNG originals are in `source/`. The reference for the environment and first captain pose was the user-approved `docs/concepts/caribbean-treasures/concept.png`. The second captain pose referenced the first generated captain. Runtime WebP exports are in `public/assets/caribbean-treasures/` and are inventoried into this module's immutable package. Export with `node scripts/export-caribbean-assets.mjs`.

## Harbor

Use case: stylized-concept. Create ONE production background asset for the game Caribbean Treasures. The reference image is a style and mood reference only. Wide 16:9 panoramic Caribbean harbor, vivid turquoise sea, warm golden afternoon, palm fronds, old wooden pier, ropes, brass fittings, tall sailing ships and distant colorful tropical port. Polished hand-painted stylized 3D adventure game art matching the reference. Keep the middle 65% calm, darker desaturated teal sea and distant scenery so a separately rendered reel board can sit above it. Rich details at far edges. No characters, no text, no symbols, no game grid, no interface, no logo, no border. A clean finished environment illustration, suitable for CSS cover.

## Captain

Use case: stylized-concept. Create ONE isolated transparent character asset for Caribbean Treasures, using the adult pirate woman in the reference as the visual design reference. Beautiful clearly adult woman around 30, wavy dark brown hair, red bandana, expressive hazel eyes, gold earrings and pendant, richly embroidered open crimson captain's coat, fitted brown leather corset with gold trim, attractive curvy silhouette and tasteful neckline, exposed shoulders, confident playful smile. She holds a brass telescope in her right hand at waist level and rests her left hand on her hip. Polished warm cinematic stylized 3D game illustration, same Caribbean adventure aesthetic as reference, strong readable silhouette. Framing from head to upper thighs, complete hatless head, both hands fully in frame, centered vertical composition, generous transparent margin around silhouette. Golden rim light. No background, no scenery, no text, no interface. True transparent alpha.

## Captain celebration

Create one production transparent celebration pose of exactly this same clearly adult pirate captain, same face, hair, attractive mature silhouette, red bandana, brown fitted leather corset, gold jewelry and ornate red coat. Preserve the character identity, visual quality, lighting and head-to-upper-thigh framing. Change her expression to a warm confident victorious smile and raise the telescope in her right hand to shoulder height, left hand still resting on hip. All hands and head fully inside generous transparent margins. Polished stylized 3D Caribbean game character cutout. True transparent alpha, no glow backdrop, no scenery, no text, no interface.

## Editable symbols and frame

The six vector masters in `icons.ts` and the code-native brass, wood-colored frame and controls in `caribbean.css` extend the established symbol system. They use no external icon collection. Each symbol retains the same identity at 1×1, 2×2 and 3×3, independent of its payout. The captain and atmosphere stay outside the playable field. Compact screens show a captain portrait in the heading and keep the field, money and chat readable.

Runtime media budget: below 1 MiB total. Source PNGs are retained for future art exports, never loaded by the game.
