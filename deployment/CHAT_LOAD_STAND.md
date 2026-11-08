# Распределённый SQL-стенд чата

Стенд проверяет задачи 00.1 и 00.2 из [декомпозиции](../docs/chat-delivery-backlog.md). Для запуска используются независимый Linux-генератор, два отдельных Linux-узла PostgreSQL 17 и тестовый хост игровой базы. Основная база и реплика связываются по частной сети. Генератор подключается к обоим узлам через SSH-перенаправления на `127.0.0.1`.

## Подготовка узлов

1. Сверить публичный ED25519-отпечаток каждого SSH-хоста по консоли провайдера и закрепить ключи в отдельном файле `known_hosts`. Сохранить подтверждение размещения узлов, CPU, RAM, свободного диска и RTT по частному маршруту между PostgreSQL. Хеши `machine-id` подтверждают различие настроенных идентичностей, а подтверждение раздельного размещения даёт инвентаризация.
2. На каждом узле PostgreSQL выделить Linux-пользователя `royal_chat_load` и принадлежащие ему каталоги `/var/lib/royal-chat-load`, `plans` и `runs` с правами `0700`. Скрипт использует PostgreSQL 17 из `/usr/lib/postgresql/17/bin` и требует свободный резерв диска перед развёртыванием. На генераторе использовать Node.js 24+ и зависимости из `npm ci` проверенного коммита.
3. Сохранить план каждого узла в `/var/lib/royal-chat-load/plans` с правами `0600`. Пароли и ключи TLS хранятся в приватном каталоге вне Git. `hostId` вычисляется из `/etc/machine-id` на соответствующем хосте командой `tr -d '\n' < /etc/machine-id | sha256sum`.

В каждом плане `format` равен `1`, `purpose` равен `royal-chat-load-distributed`, а `role` задаёт роль узла. Поля `runId`, `hostId`, `expiresAtUnixMs`, `listenAddress` и `port` задают UUIDv4 запуска, SHA-256 идентификатора машины, срок плана, частный IPv4-адрес и выделенный порт. Основной узел чата и его реплика получают один `runId`. Каждая тестовая игровая база получает свой.

| Роль | Дополнительные поля |
| --- | --- |
| `primary` | `peerAddress` реплики, `replicationPassword`, отдельный `password` роли чата, абсолютные `tlsCertificateFile` и `tlsKeyFile` |
| `standby` | `peerAddress` основного узла, тот же `replicationPassword`, `systemIdentifier` основного узла, его `primaryPort`, `primaryDnsName` из сертификата и абсолютный `tlsRootFile` |
| `game` | `password` роли игровой базы |

Пароли задаются 64 строчными шестнадцатеричными символами. Закрытый TLS-ключ основного узла принадлежит `royal_chat_load`, имеет права `0600` и хранится в обычном файле без ссылок. Сертификат и файл CA защищены от записи другими пользователями. Реплика проверяет сертификат и идентификатор кластера перед `pg_basebackup`. Пара создаётся из свежего тестового кластера. [Параметры копирования PostgreSQL 17](https://www.postgresql.org/docs/17/app-pgbasebackup.html) · [Параметры TLS и аутентификации libpq](https://www.postgresql.org/docs/17/libpq-connect.html)

Оператор запускает команды от `royal_chat_load`. На основном узле выполняет `prepare` и `start`, берёт `systemIdentifier` из отчёта и указывает его в плане реплики. Затем выполняет `prepare` и `start` на реплике. На основном узле выполняет `verify` и сохраняет `minimumReplayLsn`. На реплике проверяет `status` до появления `markerPresent` и достижения этого LSN. Позиции сравниваются как значения `pg_lsn`. Для игровой базы достаточно `prepare` и `start`. Срок плана узла ограничен восемью часами.

```sh
sudo -u royal_chat_load -- python3 scripts/prepare-distributed-chat-postgres.py prepare --plan /var/lib/royal-chat-load/plans/node.json
sudo -u royal_chat_load -- python3 scripts/prepare-distributed-chat-postgres.py start --plan /var/lib/royal-chat-load/plans/node.json
sudo -u royal_chat_load -- python3 scripts/prepare-distributed-chat-postgres.py verify --plan /var/lib/royal-chat-load/plans/primary.json
sudo -u royal_chat_load -- python3 scripts/prepare-distributed-chat-postgres.py status --plan /var/lib/royal-chat-load/plans/standby.json
```

## Генератор

Перенаправления открываются с проверенными ключами хостов. На каждом узле авторизовать публичный ключ генератора для локального перенаправления на частный адрес и порт тестовой базы. На каждый узел нужен свой SSH-канал и отдельный локальный порт. Удалённая сторона перенаправления указывает `listenAddress` соответствующего плана.

```sh
ssh -F /dev/null -N -T -o BatchMode=yes -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=yes -o ExitOnForwardFailure=yes \
  -o UserKnownHostsFile=/private/chat-load/known_hosts -o GlobalKnownHostsFile=/dev/null \
  -i /private/chat-load/generator_key \
  -L 127.0.0.1:15432:10.60.0.11:25432 royal_chat_load@test-chat-primary.example.invalid
```

Манифест генератора хранится вне Git с правами `0600` под пользователем запуска. В нём ровно следующие поля.

| Поле | Значение |
| --- | --- |
| `format`, `purpose` | `1`, `royal-chat-load-distributed` |
| `runId`, `systemIdentifier`, `minimumReplayLsn` | Значения отчёта `verify` основного узла |
| `expiresAtUnixMs`, `generatorHostId` | Срок действия до четырёх часов от момента запуска и SHA-256 `machine-id` генератора |
| `primary`, `standby` | Объекты с локальным `port` SSH-перенаправления, `hostId` узла и свежим `freeDiskBytes` из его `status` |
| `password` | Пароль роли чата из плана основного узла |

Пробный запуск использует короткий профиль. Для замера 00.2 на пустой базе создаётся отдельная пара. Для замера с полной историей создаётся новая пара и новый манифест. Полная история содержит 57 542 400 квитанций и около 28,8 млн публикаций. Генератор требует от 80 ГиБ свободного места на каждом узле по данным `status`. Пакеты истории размером до 40 000 квитанций фиксируются отдельно, при прерывании остаётся согласованный префикс. Срок манифеста покрывает предзаполнение, профиль и 130 секунд на итоговую сверку при полной истории. Для нового прогона после прерывания создаётся новый тестовый кластер.

```sh
mkdir -p artifacts/work/chat-sql-empty
node --import tsx scripts/chat-load-sql-probe.ts artifacts/work/chat-sql-empty \
  --distributed-manifest /private/chat-load/empty.json --prefill 0 \
  --seconds 1800 --rate 333 --burst 10000 --burst-at 600 \
  --quota-partitions 4 --admission-workers 8 --workers 4

mkdir -p artifacts/work/chat-sql-full
node --import tsx scripts/chat-load-sql-probe.ts artifacts/work/chat-sql-full \
  --distributed-manifest /private/chat-load/full.json --prefill full \
  --seconds 1800 --rate 333 --burst 10000 --burst-at 600 \
  --quota-partitions 4 --admission-workers 8 --workers 4
```

## Сравнение кошелька

На одном выделенном игровом хосте создать два свежих кластера `game` с разными портами, паролями и `runId`. Для каждого открыть отдельное перенаправление. Два приватных манифеста используют `format: 1`, `purpose: royal-chat-load-wallet-distributed`, `phase` соответственно `baseline` и `chat-on`, а также `runId`, `expiresAtUnixMs`, `generatorHostId`, `systemIdentifier`, `password`, объект `game` с `port`, `hostId`, `freeDiskBytes` и одинаковый `profile` с `durationSeconds` и `authorizationRate`. `game.port` означает локальный порт на генераторе. `hostId`, `freeDiskBytes` и `systemIdentifier` берутся из свежего отчёта `start`. Срок действия должен покрывать подготовку и обе последовательные фазы. Перед измерением проверяются владельцы обеих свежих баз, совпадение настроек PostgreSQL и отсутствие конкурирующего запуска.

```sh
mkdir -p artifacts/work/chat-wallet-distributed
node --import tsx scripts/chat-load-wallet-authorization-ab.ts --distributed \
  artifacts/work/chat-wallet-distributed /private/chat-load/wallet-baseline.json /private/chat-load/wallet-chat-on.json
```

Оператор закрывает SSH-каналы и выполняет `destroy` с исходным планом на каждом хосте. Результат `destroyed: true` подтверждает удаление выделенных данных, журнала и файла репликации. Для временной остановки используется `stop`, который сохраняет каталог запуска. По завершении удаляются использованные приватные планы, манифесты и учётные данные этого прогона. Отчёты из `artifacts/work` содержат измерения и подтверждение закрытия клиентских подключений. Для зачёта этапа отдельно сверяются размещение, полные профили, пороги из ТЗ и очистка выделенных узлов. [Критерии нагрузки](../docs/chat-delivery-at-scale.md#8-нагрузка-и-эксплуатация)
