# Пересмотр знаний проекта, 3 ноября 2026

Основа проверки: свежий `origin/main`, коммит `44b12afd5f3707f49b0d435dfa526ba59d346db4`. Рабочие исходники совпадали с этой версией. Проверены документы, определения маршрутов, конфигурации и границы хранилищ. Работающий VPS, платёжные аккаунты, RPC и производственные данные не проверялись. Слово `verified` у пересмотренных записей означает подтверждение описанного факта по исходникам, а не новую проверку развёртывания.

Версия набора: `2026-11-03.1`. Версия каждой пересмотренной записи, дата и исходный коммит сохранены в `record_reviews` набора `ai-factory/project-knowledge/graph-seed.json`. Для остальных записей остаётся дата знания `2026-10-10.1`; изменение версии общего набора не делает их заново проверенными.

## Результат проверки исходных десяти записей

| ID | Что уточнено | Подтверждающие источники |
| --- | --- | --- |
| `service:finance_gateway` | В исходниках сохранён внутренний HAProxy для симулятора USDT_SIM, а не подтверждение действующего способа оплаты. Окружение записи изменено с production на sandbox. | `compose.finance.yaml`, `deployment/finance/haproxy.cfg`, `server/finance/config.ts`, `docs/payment-methods.md` |
| `service:finance_api` | Compose объявляет две реплики симулятора с общей PostgreSQL. Наличие этой конфигурации не подтверждает сейчас запущенные процессы на VPS. | `compose.finance.yaml`, `server/finance/config.ts`, `docs/financial-core-implementation.md` |
| `mechanic:own_games` | Удалён старый перечень якобы доступных игр. Подтверждены серверные движки и общее хранилище кошелька. Окружение project, доступность production требует отдельной сверки. | `server/games/core.ts`, `server/demoWallet.ts`, `server/demoWalletRoutes.ts`, `src/shared/arcadeCatalog.ts` |
| `service:tron_reader` | Сохранённый наблюдатель Nile сверяет два RPC и сеть, работает watch-only. Это историческая инфраструктура, а не публичный способ пополнения. | `server/finance/tron-reader.ts`, `server/finance/tron-protocol.ts`, `deployment/finance/compose.tron-reader.yaml`, `docs/payment-methods.md` |
| `service:nile_creditor` | Сохранённый обработчик читает журнал наблюдателя и ведёт отдельный USDT_NILE_TEST. Он не подписывает выплаты и не публикует старые платёжные API. | `server/finance/nile-test-creditor.ts`, `server/finance/nile-test-ledger.ts`, `deployment/finance/compose.nile-creditor.yaml` |
| `edge:gateway_api` | Связь подтверждена конфигурацией маршрутизации к двум экземплярам API. Убрано утверждение об актуальном запуске на VPS; окружение sandbox. | `deployment/finance/haproxy.cfg`, `compose.finance.yaml` |
| `edge:own_games_demo` | Подтверждено использование общего серверного хранилища операций и раундов. Связь не открывает старые игры для новых ставок; окружение project. | `server/demoWallet.ts`, `server/demoWalletRoutes.ts`, `src/shared/arcadeCatalog.ts` |
| `edge:nile_reader` | Исторический модуль Nile содержит watch-only наблюдатель; эта связь не означает доступность Nile в платёжном каталоге. | `server/finance/tron-reader.ts`, `deployment/finance/compose.tron-reader.yaml`, `server/payments/methods.ts` |
| `edge:creditor_reader` | Подтверждено чтение проверенных событий и контроль свежести, последовательности и целостности. Публичные пополнения через Nile остаются закрыты. | `server/finance/nile-test-creditor.ts`, `deployment/finance/compose.nile-creditor.yaml`, `server/payments/methods.ts` |
| `edge:separate_nile_sim` | Разделение USDT_NILE_TEST и USDT_SIM сохранено. Наличие исторических журналов не является подключением их к текущему пополнению клуба. | `server/finance/nile-test-ledger.ts`, `server/finance/config.ts`, `docs/financial-core-implementation.md`, `docs/payment-methods.md` |

## Проверенные границы текущего приложения

`src/shared/paymentMethods.ts` объявляет NOWPayments, NOWPayments Sandbox и Telegram Stars. Наличие в каталоге не подтверждает подключение провайдера; Stars по умолчанию выключен, см. `docs/payment-methods.md`. Старый баннер финансового README, перечислявший только первые два способа, уточнён ссылкой на этот актуальный документ.

`server/payments/methods.ts` устанавливает перехватчики `/api/nile-wallet`, `/api/nile-play`, `/api/game-wallet` и `/api/usdt-wallet` с HTTP 410. `server/index.ts` устанавливает этот слой и не подключает старые Nile/game-wallet/usdt-wallet адаптеры. Файлы адаптеров сохранены для совместимости и изолированных проверок. Их существование не означает работающий публичный маршрут.

`compose.finance.yaml` задаёт `FINANCE_MODE=simulation`, `NODE_ENV=development` и две API-реплики. `requireFinanceSimulation` отклоняет production-режим. В Compose отсутствует публикация портов финансового API и шлюза на хост. Схема HAProxy подтверждает внутреннюю маршрутизацию, а не состояние удалённых контейнеров.

Наблюдатель проверяет два независимых источника, genesis Nile, совпадение подтверждённых блоков и сохранённую границу. Обработчик поступлений читает схему наблюдателя в read-only транзакции и импортирует события через отдельный `NileTestLedger`. Конфигурации задают отдельные PostgreSQL-схемы и тестовый актив. Ни эта проверка, ни обновление знаний не выполняли сетевые или денежные операции.

## Связанные уточнения

Чтобы не сохранять противоречащие друг другу утверждения, также уточнены `integration:tron_nile`, `service:nile_play`, `mechanic:nile_auto_deposit`, `integration:tron_mainnet_pilot`, `edge:game_own_games`, `edge:game_nile_play`, `edge:nile_auto_deposit`, `edge:nile_whitelist` и `edge:mainnet_game_candidate`.

У этих записей теперь явно указано, что старый код Nile/mainnet и назначения адресов сохранён, но соответствующие публичные URL закрыты. Для mainnet сохранён статус candidate: проверка исходников не является разрешением на денежный запуск. Для собственного игрового ядра подтверждено наличие кода, а не перечень активных игр.

Исторический раздел `PROJECT.md` сохранён под датой 10 октября. Перед ним добавлены актуальные уточнения с приоритетом над старым текстом. Изменение контрольной суммы этой обложки учтено в ссылающихся записях; их прежние утверждения не объявляются заново проверенными. Текущие копии разрешённых документов в `project-knowledge/references` синхронизированы с исходниками.

## Как воспроизвести проверку

```sh
node --test ai-factory/test/graph-seed.test.mjs ai-factory/test/project-knowledge.test.mjs ai-factory/test/knowledge-graph.test.mjs
npm run test:graphify
npm run brain:build
npm run brain:query -- "finance-gateway"
npm run brain:query -- "Собственные серверные игры"
```

Проверки знаний контролируют хеши и ссылки, сохранение старых версий непересмотренных записей, закрытые платёжные границы и совпадение копий документов. Поиск должен показывать источники, дату и исходный коммит пересмотра. Любое последующее изменение закреплённого файла снова требует пересмотра соответствующего утверждения.

Дополнительно на неизменённых исходниках main выполнена изолированная HTTP-проверка настоящего `installPaymentMethods`: каталог вернул три объявленных способа, восемь GET/POST запросов к четырём старым URL получили 410, нижележащий тестовый legacy-обработчик не был вызван. База, реальные учётные записи и внешние провайдеры не использовались.
