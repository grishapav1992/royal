#!/bin/sh
set -eu
umask 077
root=/opt/royal-postgres-migration
final=$root/final
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup=/opt/royal-backups/postgres-$stamp
mkdir -p "$final" "$backup"
chmod 700 "$backup" "$final"
activated=0
old_stopped=0
source_applied=0
timers_stopped=0
recover() {
 result=$?
 if [ "$result" -ne 0 ]; then
  if [ "$old_stopped" -eq 1 ]; then
  if [ "$activated" -eq 0 ]; then
   if [ "$source_applied" -eq 1 ]; then
    tar -C /opt/royal -xzf "$backup/game-source.tgz"
    tar -C /opt/royal-finance -xzf "$backup/finance-source.tgz"
   fi
   while read -r service image; do
    case "$service" in game|game-latest) tag=royal-game:latest;; *) tag=royal-$service:local;; esac
    docker tag "$image" "$tag"
   done < "$backup/images.txt"
   docker start royal-tron-reader royal-nile-creditor royal-nile-play royal-game-1
   printf '%s\n' 'cutover failed before activation; old services resumed' > "$root/cutover-state"
  else
   printf '%s\n' 'activation requires repair; preserve committed PostgreSQL data' > "$root/cutover-state"
  fi
  fi
  if [ "$timers_stopped" -eq 1 ]; then systemctl start royal-finance-backup.timer royal-nile-reconcile.timer royal-nile-account-views.timer; fi
 fi
 exit "$result"
}
trap recover EXIT
for service in game tron-reader nile-creditor nile-play; do
 case "$service" in game) container=royal-game-1;; *) container=royal-$service;; esac
 image=$(docker inspect "$container" --format '{{.Image}}')
 docker tag "$image" "royal-$service:before-postgres-$stamp"
 printf '%s %s\n' "$service" "$image" >> "$backup/images.txt"
done
image=$(docker image inspect royal-game:latest --format '{{.Id}}')
docker tag "$image" "royal-game:before-postgres-latest-$stamp"
printf '%s %s\n' game-latest "$image" >> "$backup/images.txt"
for service in nile-reconcile nile-account-views; do
 image=$(docker image inspect "royal-$service:local" --format '{{.Id}}')
 docker tag "$image" "royal-$service:before-postgres-$stamp"
 printf '%s %s\n' "$service" "$image" >> "$backup/images.txt"
done
tar -C /opt/royal --exclude='./.env' --exclude='./.env.*' --exclude='./node_modules' --exclude='./data' --exclude='./dist' --exclude='./dist-server' --exclude='./artifacts' --exclude='./test-results*' --exclude='./playwright-report' -czf "$backup/game-source.tgz" .
tar -C /opt/royal-finance --exclude='./.env' --exclude='./.env.*' --exclude='./node_modules' --exclude='./data' --exclude='./dist*' --exclude='./artifacts' --exclude='./test-results*' --exclude='./playwright-report' -czf "$backup/finance-source.tgz" .
printf '%s\n' "$backup" > "$root/cutover-backup-path"
timers_stopped=1
systemctl stop royal-nile-reconcile.timer royal-nile-account-views.timer royal-finance-backup.timer
systemctl stop royal-nile-reconcile.service royal-nile-account-views.service royal-finance-backup.service || true
old_stopped=1
exec 9>/opt/royal-finance-state/nile-account-views.lock
flock -x 9
docker stop royal-game-1 royal-nile-play royal-nile-creditor royal-tron-reader > "$root/stopped-containers.log"
# Capture final SQLite snapshots through Node's backup API using each preserved old image.
for service in game tron-reader nile-creditor nile-play; do
 case "$service" in
  game) container=royal-game-1; source=/app/data/royal.sqlite; target=game.sqlite;;
  tron-reader) container=royal-tron-reader; source=/data/nile.sqlite; target=reader.sqlite;;
  nile-creditor) container=royal-nile-creditor; source=/data/nile-test.sqlite; target=deposits.sqlite;;
  nile-play) container=royal-nile-play; source=/data/play.sqlite; target=play.sqlite;;
 esac
 docker run -i --rm --user 0 --network none --volumes-from "$container:ro" -v "$final:/legacy" --entrypoint node "royal-$service:before-postgres-$stamp" --input-type=module - "$source" "/legacy/$target" < "$root/tools/sqlite-copy.mjs"
done
cp /opt/royal-nile-account-bindings/bindings.json "$final/bindings.json"
cat > "$root/tools/final-sources.json" <<'JSON'
[{"schema":"royal_game","path":"/legacy/game.sqlite"},{"schema":"royal_tron_reader","path":"/legacy/reader.sqlite"},{"schema":"royal_nile_deposits","path":"/legacy/deposits.sqlite","bindingsPath":"/legacy/bindings.json"},{"schema":"royal_nile_play","path":"/legacy/play.sqlite"}]
JSON
cp "$final"/*.sqlite "$final/bindings.json" "$backup/"
sha256sum "$final"/*.sqlite "$final/bindings.json" > "$backup/source-hashes.txt"
docker run --rm --user 0 --network royal-finance-sim_finance_private -e PGHOST=finance-db -e PGDATABASE=royal_finance_sim -e PGUSER=finance_schema_owner -e PGPASSWORD_FILE=/run/secrets/admin -v /opt/royal-finance-secrets/admin-password:/run/secrets/admin:ro -v "$root/tools/migrate.js:/app/database-migrate.js:ro" -v "$root/tools/final-sources.json:/app/sources.json:ro" -v "$final:/legacy" royal-finance-sim:local node --max-old-space-size=1024 /app/database-migrate.js /app/sources.json /legacy/import-report.json > "$final/import.log" 2>&1
# Native initialization installs immutable policies, then full audits verify the imported history.
docker run --rm --user 0 --memory 192m --network royal-finance-sim_finance_private -e PGHOST=finance-db -e PGDATABASE=royal_finance_sim -e PGUSER=finance_schema_owner -e PGPASSWORD_FILE=/run/secrets/admin -v /opt/royal-finance-secrets/admin-password:/run/secrets/admin:ro -v "$root/tools/cutover-check.js:/app/cutover-check.js:ro" royal-finance-sim:local node /app/cutover-check.js > "$final/audit.json" 2> "$final/audit.err"
cp "$final/import-report.json" "$final/audit.json" "$backup/"
# Apply only the reviewed backend/deployment overlay, preserving env, override and current frontend.
source_applied=1
tar -C /opt/royal -xzf "$root/release-overlay.tgz"
tar -C /opt/royal-finance -xzf "$root/release-overlay.tgz"
python3 /opt/royal-finance/deployment/provision-postgres.py > "$final/provision.json"
for service in tron-reader nile-creditor nile-play nile-reconcile nile-account-views; do
 docker tag "royal-$service:postgres-staged" "royal-$service:local"
done
docker tag royal-game:postgres-staged royal-game:latest
activated=1
cd /opt/royal-finance
for service in tron-reader nile-creditor nile-play; do
 docker compose -f "deployment/finance/compose.$service.yaml" up -d --no-build "$service"
done
cd /opt/royal
docker compose -f compose.yaml -f compose.override.yaml up -d --no-build --no-deps game
flock -u 9
exec 9>&-
printf '%s\n' 'postgres services activated'  > "$root/cutover-state"
systemctl start royal-finance-backup.timer royal-nile-reconcile.timer royal-nile-account-views.timer
printf '%s\n' "services activated; validation pending, backup $backup"
