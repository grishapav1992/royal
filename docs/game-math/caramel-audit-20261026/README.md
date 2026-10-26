# Caramel Carnival: материалы аудита 26 октября 2026

Основной вывод, объём проверки и ограничения: [итоговый отчёт](final-caramel-audit.md) и [структурированные данные](final-caramel-audit.json). Проверены текущие rules 2 / progress 1 / math 1. Игровые исходники, вероятности, цены и расчёт кошелька не менялись.

Основная выборка из 10 млн полных оплаченных раундов сохранена без изменения в [qualified-caramel-audit.json](qualified-caramel-audit.json). Отдельный независимый прогон 1,2 млн раундов: [native-round-results.json](native-round-results.json). Выборки и доверительные интервалы не объединены. Слово `qualified` в исторических именах файлов обозначает независимый набор аудита: эти скрипты не создают RTP proof и не регистрируют целевую политику Caramel.

## Повторный запуск

Команды выполняются из корня репозитория с установленными зависимостями проекта. Пять скриптов находятся в [scripts/game-math/caramel-audit/](../../../scripts/game-math/caramel-audit/). Все результаты записываются в `artifacts/work/caramel-audit-20261026/`; каталог и файл OWNER создаются при необходимости. Сохранённые документы в `docs/` не перезаписываются.

Основные 10 млн раундов, точные первые поля, принудительные сценарии и 1 664 серверных replay:

```sh
node --import tsx scripts/game-math/caramel-audit/qualified-caramel-audit.mjs
```

Только арифметика, точные первые поля, границы вероятностей, принудительные сценарии и серверные replay, без повторения статистической выборки:

```sh
node --import tsx scripts/game-math/caramel-audit/qualified-caramel-audit.mjs --checks-only
```

403 проверки инвариантов и отдельные 18 управляемых сценариев:

```sh
node --import tsx scripts/game-math/caramel-audit/qualified-caramel-invariants.mjs
node --import tsx scripts/game-math/caramel-audit/native-engine-audit.mjs
```

Независимый геометрический симулятор: 832 полных сравнения с сервером и отдельная выборка 1,2 млн раундов:

```sh
node --import tsx scripts/game-math/caramel-audit/native-round-screen.mjs
```

Общий кошелёк: 59 групп сценариев на одноразовом локальном PostgreSQL и восемь проверок чистых функций таблицы результата и общей реакции:

```sh
node --import tsx scripts/database-test.ts --import tsx scripts/game-math/caramel-audit/wallet-regression.mjs
```

Обёртка создаёт отдельную локальную БД, задаёт тестовое окружение и удаляет её после проверки. Production, HTTP и браузер не используются. Восемь UI-проверок исполняют настоящие renderer и amount-reaction функции, но не монтируют игру, не проверяют DOM/layout и не подтверждают качество звука.

## Что сохранено

- [Математический разбор](qualified-caramel-math-review.md), [основные данные](qualified-caramel-audit.json), [повторные focused checks](qualified-caramel-checks.json), [инварианты](qualified-caramel-invariants.json).
- [Независимый разбор движка](native-review.md), [18 сценариев](native-engine-results.json), [832 replay и отдельная статистика](native-round-results.json), [независимый review точных расчётов](native-qualified-review.md).
- [59 групп сценариев кошелька](wallet-results.json), [восемь UI-проверок и наблюдение о звуке](ui-ledger-results.json).

Hashes исходников и отчётов находятся в итоговом JSON. Если математические исходники изменятся, прежние данные останутся свидетельством для записанных hashes. Новый аудит выполняется отдельно; старые числа не редактируются для прохождения проверки. Точный полный RTP, формальная квалификация, legacy rules 1, HTTP и браузерная проверка не заявляются.
