#!/bin/sh
set -eu
task_archive=${1:?Factory board recovery archive required}
cd /opt/royal-ai
task_stamp=$(date -u +%Y%m%dT%H%M%SZ)
task_backup=/opt/royal-ai-backups/board-recovery-$task_stamp
mkdir -m 700 "$task_backup"
tar --exclude='./.env*' --exclude='./node_modules' --exclude='./data' --exclude='./workspaces' --exclude='./artifacts' --exclude='./knowledge-graph/.venv' --exclude='./knowledge-graph/.pip-cache' --exclude='./knowledge-graph/.state' -czf "$task_backup/source.tar.gz" .
task_api_image=$(docker inspect --format '{{.Image}}' royal-ai-api-1)
task_worker_image=$(docker inspect --format '{{.Image}}' royal-ai-worker-1)
docker image tag "$task_api_image" royal-ai-api:before-board-recovery-$task_stamp
docker image tag "$task_worker_image" royal-ai-worker:before-board-recovery-$task_stamp
docker inspect --format '{{.Name}} {{.Image}} {{.State.StartedAt}}' royal-ai-api-1 royal-ai-worker-1 royal-ai-knowledge-graph-1 royal-game-1 > "$task_backup/services-before.txt"
chmod 600 "$task_backup/source.tar.gz" "$task_backup/services-before.txt"
control() {
  docker compose cp /opt/royal-ai/deployment/graph-control.mjs api:/tmp/royal-board-recovery-control.mjs >/dev/null
  docker compose exec -T -u 0 api chown 1000:1000 /tmp/royal-board-recovery-control.mjs
  docker compose exec -T api node /tmp/royal-board-recovery-control.mjs "$1"
}
task_source_changed=false
task_switched=false
task_paused=false
cleanup() {
  task_code=$?
  trap - EXIT HUP INT TERM
  if [ "$task_code" -ne 0 ] && [ "$task_source_changed" = true ]; then
    tar -xzf "$task_backup/source.tar.gz" ./public/app.js ./public/styles.css ./lib/store.mjs ./lib/graph-store.mjs ./server.mjs
    docker image tag royal-ai-api:before-board-recovery-$task_stamp royal-ai-api:current
    docker image tag royal-ai-worker:before-board-recovery-$task_stamp royal-ai-worker:current
    if [ "$task_switched" = true ]; then docker compose up -d --no-deps api worker || true; fi
  fi
  if [ "$task_paused" = true ]; then control resume > "$task_backup/resumed.json" 2>/dev/null || true; fi
  docker compose exec -T -u 0 api rm -f /tmp/royal-board-recovery-control.mjs >/dev/null 2>&1 || true
  printf '\nBackup: %s\n' "$task_backup"
  exit "$task_code"
}
trap cleanup EXIT HUP INT TERM
control pause > "$task_backup/paused.json"
task_paused=true
python3 -c 'import json,sys; value=json.load(open(sys.argv[1])); assert value["active_jobs"] == 0, "An active AI job must finish before deployment"' "$task_backup/paused.json"
sh deployment/backup.sh
tar -xzf "$task_archive" -C /opt/royal-ai
task_source_changed=true
docker compose config --quiet
docker compose build api worker > "$task_backup/build.log" 2>&1
task_switched=true
docker compose stop worker
docker compose up -d --no-deps api worker
task_attempt=0
until docker compose exec -T api node -e 'fetch("http://127.0.0.1:2580/healthz").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' >/dev/null 2>&1; do
  task_attempt=$((task_attempt+1)); [ "$task_attempt" -le 20 ] || exit 1
  sleep 2
done
task_attempt=0
until docker compose exec -T api node --input-type=module -e 'import {Store} from "/app/lib/store.mjs";import {config} from "/app/lib/config.mjs";const s=new Store({connectionString:config().databaseUrl});try{const r=await s.getRuntime();if(!r.available||!r.authenticated||r.release_enabled!==false)process.exitCode=1;}finally{await s.close();}' >/dev/null 2>&1; do
  task_attempt=$((task_attempt+1)); [ "$task_attempt" -le 20 ] || exit 1
  sleep 2
done
docker compose exec -T api node --input-type=module -e 'import {Store} from "/app/lib/store.mjs";import {config} from "/app/lib/config.mjs";const s=new Store({connectionString:config().databaseUrl});try{const graph=await s.knowledgeGraph();const tasks=await s.listTasks();if(!tasks.every(t=>t.board_move_actions))throw Error("Recovery metadata missing");console.log(JSON.stringify({tasks:tasks.length,knowledge_graph:true,attention:tasks.filter(t=>t.status==="needs_attention").map(t=>({id:t.id,board_moves:t.board_moves}))}));}finally{await s.close();}'
printf 'Board recovery and knowledge fix published. Game and Graphiti were not restarted.\n'
