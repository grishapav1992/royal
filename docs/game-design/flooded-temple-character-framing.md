# Flooded Temple 0.7.1: visible explorer poses

The explorer now has a reserved column to the left of the board on desktop and tablet. The previous portrait container was 136% wide with a negative 36% margin (160% / negative 60% on tablet), while the board had the higher stacking order. Enlarging the character into the board column could hide parts of a pose. The correction removes that overflow rather than drawing her above room controls.

Above 520 px, the play area uses one part for the explorer and two for the board, with a responsive gap. The portrait fits inside its column with a six-pixel inset. The board stays centered in its own column. All six original poses use the same frame; no pose is mirrored and no artwork, animation timing, reaction rule or sound changes. On phones, the existing compact head portrait remains above the board.

These proportions are a game-specific layout decision. They are not research thresholds or evidence of increased enjoyment. Event meanings, the shared feedback timeline, reduced motion, pause and resource disposal follow the existing [event design](flooded-temple-character-animation.md) and [feedback guide](../game-feedback.md).

## Verification story

The `verification` skill was applied to this story: a confirmed Temple event reaches the existing UI timeline and presents a visible explorer reaction inside the actual Royal game window with connected chat. The local fixture uses disposable PostgreSQL and demo coins; its endpoint, wallet and module loader remain the common ones. No environment file, production service or financial setting was changed.

The responsive check covers base and expedition layouts at 1440×1000, 1000×760, 1000×1100, 768×1024, 760×1000, 600×900, 521×900, 390×844 and 360×740. It measures the explorer/board intersection, the portrait frame, room target sizes, horizontal overflow and separation from the console. The real host check also includes tall and tablet windows, connected chat, close/reopen and restoration of the same six-move expedition.

Character checks exercise confirmed relic and gate reactions, paid outcome distinctions, pause, reduced motion, WebGL loss/fallback/restoration, account change and disposal. The mathematics, settlement, player choices and qualified rules stay unchanged. RTP and module compatibility gates still apply to the final build.

On the final `0.7.1-af8d1ba9080d` package, all six targeted browser scenarios and seven module compatibility checks passed. All 18 scene measurements had zero explorer/board intersection; the smallest room side was 55.5 px and the smallest desktop/tablet separation was 12 px. The full application build passed in 23,132 ms, including RTP (13 verified, 114 unchanged legacy modules without qualification), typecheck, modules, host and backend. Temple's qualification proof stayed valid. Final measured results and package digests are in the [verification record](flooded-temple-character-framing-verification.json). The [scene capture](../assets/flooded-temple/character-framing.webp) and [real-host capture](../assets/flooded-temple/character-framing-host.webp) use prepared local demo rounds. No human preference study or listening comparison was performed for this layout correction.

The browser tool listed the existing in-app preview but could not access its document (`browser.user is unavailable`). No gameplay or account action was attempted in that tab. Visual evidence comes from independent repository Playwright test contexts, not a claim that the user's existing tab was refreshed. Reloading the preview loads the active 0.7.1 package and restores its accepted round.

Temporary files belong only to `artifacts/work/flooded-temple-framing/`. Earlier denied cleanup scopes are excluded. The active preview package and possibly pinned 0.7.0 user tab are protected. Source preservation, exact cleanup inventory and measured space are in the [storage record](flooded-temple-character-framing-storage.json). This change is saved in the feature branch; it is not a production deployment.
