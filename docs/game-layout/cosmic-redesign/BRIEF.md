# Cosmic Escape: UI redesign brief

Implement the new UI of Cosmic Escape (gameId `studio-cosmic-escape`) from the approved mockup.

Mockup (Design canvas, 7 artboards): https://claude.ai/artifact/Y25ZgtjRqq6aLZcLHzAy41
Read it with the Artifact tool (`action: "read"`, then `path: "project/Main.dc.html"` and the other `project/*.dc.html` files). The `.dc.html` sources contain the exact markup, sizes and colors. Artboards:

- `Main.dc.html` desktop 1440x900, idle state (prop `scene`: idle / win / fs)
- `Win.dc.html` desktop, line win
- `FreeSpins.dc.html` desktop, free spins
- `Mobile.dc.html` phone portrait 390x844 (prop `sheet`: none / auto)
- `MobileAuto.dc.html` phone portrait, autoplay sheet open
- `Landscape.dc.html` phone landscape 844x390
- `Tokens.dc.html` colors, type scale, button states

## Scope

UI and win presentation only. Do NOT change game math, RTP, server protocol, wallet logic, symbol art or the background art.

Files to change:
- `src/ui/cosmic-escape.css`, `src/ui/cosmic-guardians.css` (styles)
- `src/ui/CosmicEscapeUI.ts` (markup in `markup()`, controls, autoplay)
- `src/ui/CosmicEscapeBoard.ts` only for win highlighting / dimming
Art stays in `public/assets/cosmic-guardians/v1/` (symbols-v2.webp, alien.webp, background.webp).

Follow `AGENTS.md` (git sync workflow, feature branch, no em dash U+2014 in generated text). Keep all user-facing strings going through `translateText` / `tr` and add English strings to `src/i18n/en.ts`.

## Design tokens

Put them as CSS custom properties on `.ce-game` and use only these:

| token | value | use |
|---|---|---|
| --ce-bg | #120F1A | page background |
| --ce-surface | #1C1628 | reel cells, inputs, stepper |
| --ce-panel | #1A1426 | dialogs, sheets |
| --ce-bar | rgba(14,10,22,.95) | top bar, bottom control bar |
| --ce-card | rgba(20,15,30,.9) | side cards, reel frame fill |
| --ce-line | #4A3D5C | borders |
| --ce-line-soft | #3A3048 | bar dividers |
| --ce-ink | #FFF1D6 | main text |
| --ce-ink-2 | #C9BFD6 | labels, secondary text |
| --ce-amber | #F0A947 | Spin button, primary buttons |
| --ce-amber-hi | #FFC06B | logo, accent text, outline buttons |
| --ce-brass | #C98E4F | reel frame, outline buttons border |
| --ce-win | #FFD27A | win amounts, winning cell border |
| --ce-cyan | #5BE4DF | portals, bonus, demo badge, focus ring |
| --ce-wild | #FF8A3D | WILD label, energy multiplier in bonus |

Fonts (Google Fonts, cyrillic): `Unbounded` 500/700 for logo, amounts, multipliers; `Manrope` 500-800 for everything else. Numbers use `font-variant-numeric: tabular-nums`.

Type scale, nothing else allowed, minimum 12px: 44 (win amount), 24 (balance/win desktop), 18 (dialog titles, bet value), 16 (status line), 14 (body, buttons), 12 (uppercase labels, letter-spacing .12em).

Radii: 10 (icon buttons), 12 (cells, inputs), 14-16 (buttons, cards), 18-22 (reel frame, panels), 50% (Spin). Touch targets at least 44x44.

## Layout requirements

Desktop:
- Dark top bar 56px replaces the beige platform header look: wordmark, demo badge "Демо · виртуальный баланс", icon buttons with labels for rules/sound/settings, "Все игры", "Чат" with unread badge, close.
- Logo above reels must not be clipped. Under it a mode line ("Основная игра · 20 линий").
- Reels centered (820x470 at 1440 wide), brass frame. Character on the left must not overlap the bottom bar.
- Right column: Portals card (5 slots, filled ones glow cyan, "N / 5", reward ladder 3/4/5 -> 10/12/15 with the next reachable row highlighted), Energy card (multiplier), Missions outline button.
- Bottom bar 120px: Balance + USDT, Win, divider, bet stepper as ONE control (minus | value | plus, label "Ставка · все 20 линий"), spacer, speed segmented control (Обычно / Быстро / Турбо, radiogroup), "Авто" outline button, round Spin 104px that rises above the bar.
- Remove the unlabeled "10" select next to Auto and the two identical note icons.

Phone portrait: compact header, reels full width, a strip under reels with portals / energy / missions (they must not disappear), status line, bottom sheet panel with balance+win row, full width bet stepper, row [Авто][Spin 92px][Скорость].
Phone landscape: reels left, controls column right, portals strip under reels.

## States

- Idle: status pill "Нажми «Вращать», чтобы начать путешествие".
- Win: draw the payline, winning cells get `--ce-win` border + glow, other cells opacity .35; under the reels a win block with big amount and "Линия N · K x Символ". Do not cover winning symbols.
- Free spins: Spin replaced by a cyan ring counter "4/12 БОНУС", bet stepper disabled with reduced opacity, energy multiplier in `--ce-wild`.
- Spinning: Spin shows a stop icon.
- Autoplay: shows remaining count in the Spin button.

## Autoplay panel (required)

Desktop popover from "Авто", phone bottom sheet. Contains: spin count chips 10/25/50/100, "Стоп при потере" amount, "Стоп при выигрыше от" amount, checkbox "Остановить при запуске бонуса" (on by default), primary "Запустить N вращений". Wire the limits into the existing auto logic (`stopAuto`).

## Accessibility

- Every icon-only button has `aria-label`; visible `:focus-visible` ring 3px `--ce-cyan`.
- Text contrast at least 4.5:1 on its background.
- Respect `prefers-reduced-motion` and the existing `royal-luelon-reduced` setting for line, glow and character animations.

## Verification

- `npx tsc --noEmit -p games/cosmic-escape/tsconfig.json`, then the game build (`npm run build` in `games/cosmic-escape`).
- `npx playwright test -c playwright.game-layout-slots.config.ts` and fix regressions in tests that assert old selectors only if behavior is unchanged.
- Take screenshots at 1440x900, 393x852 and 852x393 and save them next to the old ones in `docs/game-layout/slots/` with a `-redesign` suffix. Compare with the mockup artboards and list any differences.
- Do not publish or deploy; leave the work on a pushed feature branch and open a PR.
