# Caramel Carnival: UI redesign brief

Implement the new UI of Caramel Carnival (gameId `studio-caramel-carnival`) from the approved mockup.

Mockup (Design canvas, 7 artboards): https://claude.ai/artifact/2211VT2fo9W3gaKrEo4qsv
Read it with the Artifact tool (`action: "read"`, then `path: "project/Main.dc.html"` and the other `project/*.dc.html` files). The `.dc.html` sources contain the exact markup, sizes and colors. Artboards:

- `Main.dc.html` desktop 1440x900, idle state, clickable (prop `scene`: idle / win / fest)
- `Win.dc.html` desktop, first cascade with two winning groups and a spinning top +5
- `Festival.dc.html` desktop, festival (free spins) 6 / 10, multiplier kept
- `Mobile.dc.html` phone portrait 390x844, clickable (prop `sheet`: none / auto)
- `MobileAuto.dc.html` phone portrait, autoplay sheet open
- `Landscape.dc.html` phone landscape 844x390
- `Tokens.dc.html` colors, type scale, cell states, Spin states, awning

Direction: "evening fair". The UI is a dark plum night layer over the existing fair background, with caramel, berry stripes and garland gold. A striped awning with scallops and garland lights hangs over the board.

## Scope

UI and cascade presentation only. Do NOT change game math, RTP, paytable, server protocol, wallet logic, symbol art (`caramel-rebuild/v1/symbols.webp`) or the background art (`caramel-rebuild/v1/background.webp`). The mockup uses crops of the same sprite; in code keep `caramelSymbol()` with the sprite.

Files to change:
- `src/ui/caramel-carnival.css` (styles)
- `src/ui/CaramelCarnivalUI.ts` (markup in `markup()`, `features()`, `tickets()`, `factor()`, `present()` messages, dialogs, autoplay)
- `src/ui/CaramelBoard.ts` only for win highlighting / dimming / energy cell state
- `src/i18n/en.ts` for every new string

Follow `AGENTS.md` (git sync workflow, feature branch, no em dash U+2014 in generated text). Keep all user-facing strings going through `translateText` / `tr`. Do not touch the audit evidence in `docs/game-math/caramel-audit-20261026/`.

## Design tokens

CSS custom properties on `.cc-game`, use only these:

| token | value | use |
|---|---|---|
| --cc-bg | #170F1F | page background under the art |
| --cc-surface | #241729 | bet stepper, inputs, segmented control |
| --cc-panel | #1E1424 | dialogs, sheets |
| --cc-cell | #2A1A30 | board cells (at .92 alpha), amount plates |
| --cc-card | rgba(28,17,34,.9) | side cards, board frame fill |
| --cc-bar | rgba(20,12,26,.95) | top bar, bottom control bar |
| --cc-line | #4E3550 | borders |
| --cc-line-soft | #3A2840 | bar dividers |
| --cc-ink | #FFF3E6 | main text |
| --cc-ink-2 | #D9C3D2 | labels, secondary text |
| --cc-caramel | #F2A65A | Spin face, primary buttons (text #2A1206) |
| --cc-caramel-hi | #FFC98A | wordmark, outline buttons (Auto) |
| --cc-gold | #E8B95A | board frame, awning rail, festival accents |
| --cc-berry | #E8547A | awning stripes, Spin lollipop ring |
| --cc-berry-hi | #FF8FAB | tickets, "Buy festival" outline |
| --cc-cream | #FFF1E2 | light awning stripes, Spin ring |
| --cc-win | #FFD873 | win amounts, winning cell border |
| --cc-mint | #7FE0C2 | spinning top energy, multiplier, energy cell border |

Fonts (Google Fonts, cyrillic): `Lobster` only for the wordmark; `Rubik` 500-700 for amounts, multiplier, counters; `Nunito` 600-900 for everything else. Numbers use `font-variant-numeric: tabular-nums`.

Type scale, minimum 12px: 56 (multiplier), 54 (wordmark), 28 (win amount), 24 (balance / win in bar), 18 (bet value, counters, dialog titles), 16 (status line, buttons), 14 (body), 12 (uppercase labels, letter-spacing .12em).

Radii: 10 (icon buttons), 12 (cells, inputs), 14 (buttons, stepper), 18 (cards), 22 (board frame bottom corners), 50% (Spin). Touch targets at least 44x44.

## Layout requirements

Desktop:
- Dark top bar 56px: wordmark, demo badge "Демо · виртуальный баланс", icon buttons with aria-labels for rules / sound / settings, "Все игры", "Чат" with unread badge, close.
- Left column 300px: wordmark (two lines) with a mode pill (`data-cc-phase-title` content), Tickets card, "Как играть" card (three rows with symbol thumbs, link to full rules).
- Board centered (696x588 at 1440 wide) under the awning: gold rail, 60px berry/cream stripes, scallop row, garland lights. In festival the berry stripes turn gold and the frame turns mint.
- Status line under the board (see States).
- Right column 300px: Energy card (top icon, big multiplier, meter with ticks x1 / x10 / x25 / x50, note), Festival card (ticket art, "10 бесплатных вращений", price as 35 x stake in USDT, outline button "Купить фестиваль").
- Bottom bar 120px: Balance + USDT, Win, divider, bet stepper as ONE control (minus | value | plus, label "Ставка · за вращение"), spacer, speed segmented control (radiogroup), "Авто" outline button, round Spin 116px that rises above the bar.
- Remove: the unlabeled auto count select, the "За ход: ..." line, the glyph buttons ⓘ ♫ ♪ ☷ (replace with SVG icons; music, volume and "меньше анимации" go to the settings popover, history goes there as a menu item), the ✦ and ⟳ glyphs.

Phone portrait: compact 52px header (wordmark, rules, sound, all games, close), mode pill, awning + board full width, a 3-card strip under the board (tickets / energy / festival buy, they must not disappear), status line, bottom sheet with balance + win row, full width bet stepper, row [Авто][Spin 98][Скорость].
Phone landscape: board left, tickets / energy / festival / status column in the middle, controls panel right.

## States

- Idle: status pill "Нажми «Вращать», чтобы открыть ярмарку" with a "ПРОБЕЛ" key hint on desktop.
- Cascade win: winning cells get `--cc-win` 2px border + glow, the spinning top that charged energy gets `--cc-mint` border + glow and its +N badge, every other cell opacity .35. Under the board a win pill: mint badge "КАСКАД N · xM", "ВЫИГРЫШ" + total (28px, `--cc-win`), one chip per group (symbol thumb + "count x amount"). Never cover winning symbols. During `energy` phase the Energy card border turns mint and shows a "+N волчок" chip.
- Tickets: slots are dashed when empty, berry border + glow when collected. Base game 4 slots, festival 3 slots ("3 билета на поле: ещё 3 бесплатных вращения").
- Festival: awning gold, frame mint, the Festival card becomes "ФЕСТИВАЛЬ ИДЁТ" with N / awarded, a progress row of dots, the +3 rule and festival win; Spin face turns `#F5D592` and shows "6 / 10" + "БЕСПЛАТНО"; bet stepper disabled at .45 opacity; status "Фестиваль идёт сам · множитель xM сохраняется между вращениями".
- Spinning / autoplay: Spin shows a stop icon and "СТОП", autoplay shows the remaining count.
- Disabled Spin (assets loading, no balance): desaturated ring at .55 opacity.

## Autoplay panel (required)

Desktop popover from "Авто", phone bottom sheet. Contains: paid spin count chips 10/25/50/100 (radiogroup), "Стоп при потере" amount, "Стоп при выигрыше от" amount, checkbox "Остановить при входе в фестиваль" (on by default, matches current behavior), primary "Запустить N вращений", note about stops. Wire the limits into the existing auto logic (`stopAuto`, `autoRemaining`).

## Speed

The current UI has a boolean `fast`. Show it as a segmented control. If a third "Турбо" speed is not added to `SlotPlayback` timings, ship two segments (Обычно / Быстро) rather than a dead option.
