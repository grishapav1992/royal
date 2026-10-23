# RoyalGames catalogue artwork

The shared platform catalogue uses 43 character or subject compositions from the games' existing artwork. The catalogue renderer reads `src/ui/royalCatalogArtwork.json` through `RoyalCatalogArtwork.ts`. GitHub and Casino API Pro retain their existing artwork sources.

Native games use their own aliens, singers, survivors, GIRLHUB portraits, memes, Dracona, Vespera and football players. Caramel Carnival, Nitro Run and LAST EXIT feature their existing sweets and vehicles. Other Studio games frame the character already present in their world illustration and reuse their own game symbols.

The posters are separate from cabinet startup previews and gameplay assets. No game UI, sprites, animation, mathematics, package, host contract, wallet or session transport changes are required.

Regenerate with `node --import tsx scripts/build-royal-catalog-art.ts`. Chrome and `cwebp` are required; `PREVIEW_BROWSER_CHANNEL` and `CWEBP` can override their defaults. Use `--check` to verify the generated files and manifest. Images are 512 by 320 WebP files with content hashes in their names. The generator caps each image at 75 KB and all images at 1.8 MB. Catalogue images load lazily and decode asynchronously.

Verify the shared catalogue with chat enabled on desktop and mobile. Check every RoyalGames image, search and source filters, then open a game, return to the catalogue and reopen the same saved round. Cabinet artwork and independent game module files must remain unchanged in a catalogue-only deployment.
