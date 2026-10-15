#!/bin/sh
set -eu
task_archive=${1:?Factory source archive required}
cd /opt/royal-ai
task_stamp=$(date -u +%Y%m%dT%H%M%SZ)
task_backup=/opt/royal-ai-backups/graph-$task_stamp
mkdir -m 700 "$task_backup"
tar --exclude='./.env*' --exclude='./node_modules' --exclude='./data' --exclude='./workspaces' --exclude='./artifacts' --exclude='./knowledge-graph/.venv' --exclude='./knowledge-graph/.state' -czf "$task_backup/source.tar.gz" .
cp compose.yaml "$task_backup/compose.yaml"
docker image tag royal-ai-api:current royal-ai-api:before-graph-$task_stamp
docker image tag royal-ai-worker:current royal-ai-worker:before-graph-$task_stamp
task_control=/opt/royal-ai/deployment/graph-control.mjs
control() {
  docker compose cp "$task_control" api:/tmp/royal-graph-control.mjs >/dev/null
  docker compose exec -T -u 0 api chown 1000:1000 /tmp/royal-graph-control.mjs
  docker compose exec -T api node /tmp/royal-graph-control.mjs "$1"
}
task_changed=false
cleanup() {
  task_code=$?
  trap - EXIT HUP INT TERM
  if [ "$task_code" -ne 0 ] && [ "$task_changed" = true ]; then
    cp "$task_backup/compose.yaml" compose.yaml
    docker image tag royal-ai-api:before-graph-$task_stamp royal-ai-api:current
    docker image tag royal-ai-worker:before-graph-$task_stamp royal-ai-worker:current
    docker compose up -d --no-deps api worker || true
  fi
  control resume > "$task_backup/resumed.json" 2>/dev/null || true
  printf '\nBackup: %s\n' "$task_backup"
  exit "$task_code"
}
trap cleanup EXIT HUP INT TERM
control pause > "$task_backup/paused.json"
python3 -c 'import json,sys; value=json.load(open(sys.argv[1])); assert value["active_jobs"] == 0, "An active AI job must finish before deployment"' "$task_backup/paused.json"
sh deployment/backup.sh
tar -xzf "$task_archive" -C /opt/royal-ai
docker compose config --quiet
docker compose build api worker knowledge-graph > "$task_backup/build.log" 2>&1
task_changed=true
docker compose stop worker
docker compose up -d --no-deps knowledge-graph api
docker compose up -d --no-deps worker
task_attempt=0
until docker compose exec -T api node -e 'fetch("http://127.0.0.1:2580/healthz").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' >/dev/null 2>&1; do
  task_attempt=$((task_attempt+1)); [ "$task_attempt" -le 20 ] || exit 1
  sleep 2
done
task_attempt=0
until docker compose exec -T api node -e 'fetch("http://knowledge-graph:8093/healthz",{signal:AbortSignal.timeout(5000)}).then(async r=>{if(!r.ok)process.exit(1);const s=await r.json();if(!s.ready)process.exit(1);console.log(JSON.stringify(s))}).catch(()=>process.exit(1))' > "$task_backup/graph-health.json"; do
  task_attempt=$((task_attempt+1)); [ "$task_attempt" -le 30 ] || exit 1
  sleep 2
done
printf 'Factory and Graphiti started.\n'
