# Hall loading

The initial hall loads small cabinet composites from `src/game/startupPreviews.json`.
Full game artwork stays in its independent game package. Catalog cards use smaller
background images. Cabinet composites preserve the previous browser composition at
four times its logical screen resolution, including the GIRLHUB logo.

Regenerate and verify previews with Chrome and `cwebp` installed:

```sh
node --import tsx scripts/build-startup-previews.ts
node --import tsx scripts/build-startup-previews.ts --check
```

The check compares all cabinet pixels and enforces transfer budgets. Commit the
generated WebP files and JSON manifest. Ordinary builds need no image encoder.

Cat atlases use lossless WebP with unchanged dimensions and RGBA values. Generate
them with `node scripts/build-cat-webp.mjs`. The small profile image is exactly frame
17 with its original margin. The room starts first, then downloads cat animation
atlases with at most two requests in parallel. The renderer uses the latest cat
state when the atlases are ready. Authentication, chat and movement do not wait for
these downloads. Mira's dialogue portrait starts loading on the first bar opening.

Independent games fetch their validated stylesheet and entry concurrently. Mounting
still waits for both, and closing a loading game prevents it from mounting later.
Active pointers, compatibility checks, the shared wallet and version pinning retain
their existing behavior.

Focused checks:

```sh
npm run build
npx playwright test --config=playwright.startup.config.ts
npx playwright test --config=playwright.modules.config.ts --grep 'failed package|closing a delayed|published pointer|activity state|piano releases|provider host|legacy arcade|parallel module|uncertain operation'
```

Measure the built public release with a clean browser context, chat enabled and
`domcontentloaded` navigation. Record hall readiness, usable login form readiness
and completed resource bodies separately. Waiting for the page's `load` event
would include background decoration downloads and obscure the time users can enter.
