# Royal Bar visual rework

The v1 functional implementation passed its technical checks but failed the user's visual review. Its flat Canvas scenery and character proportions did not match the approved rich illustrated reference. Technical readiness must not be recorded as visual acceptance.

The first correction is a static composition in the actual room. Run `node scripts/royal-bar-art-review.mjs` while the local dialogue preview on port 5197 is available. The review server reads the previously prepared host projection and substitutes only `BarArtworkReview.ts` and image preload calls. The production Bar module, room behavior, catalogue, wallet, server and release files are unchanged. The preview clearly labels the new Mira as static. It is not an animation-complete release.

The three versioned PNG assets in `public/assets/royal-bar/v2/` were made with the built-in imagegen tool using the approved [reference](concepts/royal-bar-mira-reference-v2.png). Prompts: extract the complete detailed wood/brass bar assembly without the woman, stools or lettering; extract the seated adult Mira while preserving face, proportions, dress, jewelry, drink and pose; extract one matching burgundy and brass stool. Actual alpha is retained. Localized text is rendered separately.

## The cat's glass is required

The user explicitly requires preserving the cat's water glass and her approach to it. The mug remains a separate permanent object made by `drawCatCare`, named `cat-water-mug`, at `CAT_CARE.bar.mug = barPoint(254,114)`. Its depth is `CAT_CARE.bar.depth + 2`. The approach remains `barPoint(297,153)` and the perch remains `barPoint(224,112)`. The cat's route, elevated surface, drinking animation and water ripples remain owned by the existing cat modules. The new painted bar must be aligned around those points. A replacement bar image must never bake over, replace or remove that object.

## Pending

Assess the static room at normal and close camera scales, including NPC occlusion and cat-glass contact. Then derive coherent standing/work poses and detailed animations from the same accepted character art. Preserve the existing room-owned state, transitions and lifecycle tests. Do not publish this static art review as the finished animated bar.

## Local checks

TypeScript check passed. The real room loaded the new art with no JavaScript errors after its loading screen completed. The named cat mug remained present, visible and at depth 513. The existing `the cat climbs continuously onto the bar, drinks there, and jumps down onto walkable floor` test passed. The cat care, renderer, route and surface files have no changes in this draft. These checks do not constitute visual approval of the new art or verification of new Mira animations.
