# Игры с GitHub

Архив снятых с первого этажа игр, создан 24 октября 2026 года. Он не является каталогом доступных игр.

`manifest.json` содержит имена и идентификаторы девяти адаптаций GitHub, 32 ранних студийных игр и ранее снятых некарточных вариантов. Для каждой группы сохранено реальное происхождение: `github-adaptation`, `royal-studio`, `royal-variant`. Название архива не приписывает авторские студийные игры сторонним авторам. Источники и лицензии описаны в `docs/github-games.md` и `THIRD_PARTY_NOTICES.md`.

Математические исходники сохранены без перемещения и дублирования. Их точные пути и SHA-256 находятся в разделе `sources` манифеста. Это позволяет завершать ранее принятые партии по прежним правилам и проверять историю. Общие файлы могут также использоваться оставшимися Royal или играми других этажей: они не удаляются.

Основные места хранения:

- `server/games/vfair/` и `src/shared/originalGames.ts`: Dice, Limbo, Mines, Keno и общие таблицы Plinko.
- `server/games/fruits.ts`, `src/shared/gameCore.ts`: Royal Fruits и базовые расчёты.
- `server/games/rush/`, `src/vendor/github/`: адаптированные исходники и оригиналы GitHub.
- `server/games/studioGames.ts`, `src/shared/studioGames.ts`: ранние студийные игры.
- `server/games/casino*Variants.ts`, `src/shared/casino*Variants.ts`: сохранённые варианты.
- `server/demoExpansion.ts`, `server/demoCasino.ts`, `server/demoMines.ts`: расчёт и восстановление принятых партий.

Проверка сохранности: `node --import tsx scripts/archive-first-floor-math.ts --check`.

На первом этаже доступны только 12 игр из `ARCADE_HOUSE_GAMES` в `src/shared/arcadeCatalog.ts`. Новые партии снятых игр отклоняются; прежние запросы и незавершённые партии сохраняются. Второй и третий этажи этим изменением не меняются.
