# Hong Kong Warrior: available-stage layout

The module uses the actual host stage width and height, including the space reserved for the connected chat and the hall toolbar. It does not scale text with the shared minimum-width fitter. Wide stages show the scene beside a control column; portrait stages put the controls below the scene. Settings scroll within that column, while the fight and cash-out buttons stay at its bottom with at least 44 CSS pixels of height. Changing the viewport does not remount the game or submit an operation.

The location picker has an opaque dark background, light text, explicit native dark color scheme and 14 CSS pixel text. Its options use the same foreground and background. The result occupies a separate row above the canvas so it cannot cover a face when the available height is small. These are game-specific design choices, not measured usability thresholds.

`tests/jackie.spec.ts` checks 13 desktop Chrome viewport sizes from 320x568 through 1920x1080, including tablet portrait and phone landscape, inside the real authenticated hall with connected chat and temporary PostgreSQL. It checks action visibility, scrolling access to the location picker, stage bounds, text styles, no operations on resize, continued fight identity and close/reopen recovery. The regular animation, sound, wardrobe and wallet browser scenarios remain part of acceptance. Physical-device and native operating-system picker appearance are not claimed as verified.

This compatible client-only update retains host API/rules/progress 1/1/2 and changes no probabilities, stakes, settlement, collection progress or shared host/backend code. Publish only its independently verified module package; unpublished changes elsewhere in main are outside this release.
