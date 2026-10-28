# RoyalGames catalogue artwork

The shared platform catalogue reads catalogue-specific character and subject images from `src/ui/royalCatalogArtwork.json` through `RoyalCatalogArtwork.ts`. Historical game entries remain registered. GitHub and Casino API Pro retain their existing artwork sources.

Caribbean Treasures uses a separate wide cover featuring its established adult pirate captain against the Caribbean harbor. It was created with built-in ImageGen from the approved captain and harbor references. The master and exact prompt are `games/caribbean-treasures/assets/catalog-cover.png` and `games/caribbean-treasures/assets/catalog-cover-prompt.md`. Export only this cover with `node scripts/export-caribbean-catalog-cover.mjs`; add `--check` to verify its content hash, registered URL and download budgets. The shared catalogue delegates Caribbean to the same art registry as other games instead of forcing its empty harbor background. The game module and its startup art are unchanged.

Native games use their own aliens, singers, survivors, GIRLHUB portraits, memes, Dracona, Vespera and football players. Caramel Carnival, Nitro Run and LAST EXIT feature their existing sweets and vehicles. Other Studio games frame the character already present in their world illustration and reuse their own game symbols.

The posters are separate from cabinet startup previews and gameplay assets. No game UI, sprites, animation, mathematics, package, host contract, wallet or session transport changes are required.

Regenerate with `node --import tsx scripts/build-royal-catalog-art.ts`. Chrome and `cwebp` are required; `PREVIEW_BROWSER_CHANNEL` and `CWEBP` can override their defaults. Use `--check` to verify the generated files and manifest. Images are 512 by 320 WebP files with content hashes in their names. The generator caps each image at 75 KB and all images at 1.8 MB. Catalogue images load lazily and decode asynchronously.

Verify the shared catalogue with chat enabled on desktop and mobile. Check every RoyalGames image, search and source filters, then open a game, return to the catalogue and reopen the same saved round. Cabinet artwork and independent game module files must remain unchanged in a catalogue-only deployment.
