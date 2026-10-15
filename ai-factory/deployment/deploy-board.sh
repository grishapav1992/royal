#!/bin/sh
set -eu
task_archive=${1:?Board update archive required}
cd /opt/royal-ai
task_stamp=$(date -u +%Y%m%dT%H%M%SZ)
task_backup=/opt/royal-ai-backups/board-$task_stamp
mkdir -m 700 "$task_backup"
tar --exclude='./.env*' --exclude='./node_modules' --exclude='./data' --exclude='./workspaces' --exclude='./artifacts' --exclude='./knowledge-graph/.venv' --exclude='./knowledge-graph/.pip-cache' --exclude='./knowledge-graph/.state' -czf "$task_backup/source.tar.gz" .
cp compose.yaml "$task_backup/compose.yaml"
docker image tag royal-ai-api:current royal-ai-api:before-board-$task_stamp
docker compose exec -T api tar -C /app/public -cf - . > "$task_backup/public.tar"
chmod 600 "$task_backup/source.tar.gz" "$task_backup/public.tar"
sh deployment/backup.sh
task_source_changed=false
task_switched=false
cleanup() {
  task_code=$?
  trap - EXIT HUP INT TERM
  if [ "$task_code" -ne 0 ] && [ "$task_source_changed" = true ]; then
    tar -xzf "$task_backup/source.tar.gz" ./public/app.js ./public/index.html ./public/styles.css ./lib/store.mjs ./lib/schema.sql ./server.mjs
    docker image tag royal-ai-api:before-board-$task_stamp royal-ai-api:current
    if [ "$task_switched" = true ]; then docker compose up -d --no-deps api || true; fi
  fi
  printf '\nBackup: %s\n' "$task_backup"
  exit "$task_code"
}
trap cleanup EXIT HUP INT TERM
tar -xzf "$task_archive" -C /opt/royal-ai
task_source_changed=true
docker compose config --quiet
docker compose build api > "$task_backup/build.log" 2>&1
task_switched=true
docker compose up -d --no-deps api
task_attempt=0
until docker compose exec -T api node -e 'fetch("http://127.0.0.1:2580/healthz").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' >/dev/null 2>&1; do
  task_attempt=$((task_attempt+1)); [ "$task_attempt" -le 20 ] || exit 1
  sleep 2
done
docker compose exec -T api node --input-type=module -e 'import {Store} from "/app/lib/store.mjs";import {config} from "/app/lib/config.mjs";const s=new Store({connectionString:config().databaseUrl});try{const rows=await s.listTasks();if(!rows.every(t=>Array.isArray(t.board_moves)))throw Error("Board migration unavailable");console.log(JSON.stringify({tasks:rows.length,board_moves:true}));}finally{await s.close();}'
printf 'Board drag and drop published. Worker and game were not restarted.\n'
