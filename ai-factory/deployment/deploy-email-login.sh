#!/bin/sh
set -eu
umask 077
task_archive=${1:?Email login archive required}
task_email=${2:?Owner email required}
cd /opt/royal-ai
task_stamp=$(date -u +%Y%m%dT%H%M%SZ)
task_backup=/opt/royal-ai-backups/email-login-$task_stamp
mkdir -m 700 "$task_backup"
task_api=$(docker compose ps -q api)
test -n "$task_api"
task_previous_image=$(docker inspect --format '{{.Image}}' "$task_api")
task_volume=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' "$task_api")
test -n "$task_volume"
sha256sum lib/owner.mjs server.mjs public/app.js public/index.html > "$task_backup/source-before.sha256"
docker compose exec -T api sh -c 'cd /app && sha256sum lib/owner.mjs server.mjs public/app.js public/index.html' > "$task_backup/running-before.sha256"
cmp "$task_backup/source-before.sha256" "$task_backup/running-before.sha256"
tar --exclude='./.env*' --exclude='./node_modules' --exclude='./data' --exclude='./workspaces' --exclude='./artifacts' --exclude='./knowledge-graph/.venv' --exclude='./knowledge-graph/.pip-cache' --exclude='./knowledge-graph/.state' -czf "$task_backup/source.tar.gz" .
docker image tag "$task_previous_image" royal-ai-api:before-email-login-$task_stamp
docker compose exec -T api cat /data/owner.json > "$task_backup/owner-before.json"
sh deployment/backup.sh
task_source_changed=false
task_owner_touched=false
task_switched=false
cleanup() {
  task_code=$?
  trap - EXIT HUP INT TERM
  if [ "$task_code" -ne 0 ]; then
    if [ "$task_source_changed" = true ]; then
      tar -xzf "$task_backup/source.tar.gz" ./lib/owner.mjs ./server.mjs ./public/app.js ./public/index.html
      docker image tag "$task_previous_image" royal-ai-api:current
    fi
    if [ "$task_owner_touched" = true ]; then
      docker run --rm -i --network none --read-only --cap-drop ALL --security-opt no-new-privileges --memory 128m --cpus 0.5 -v "$task_volume:/data" "$task_previous_image" node --input-type=module -e 'import {readFileSync} from "node:fs";import {writeFile,rename} from "node:fs/promises";const raw=readFileSync(0,"utf8");JSON.parse(raw);const temporary="/data/.owner-email-rollback-"+process.pid;await writeFile(temporary,raw,{mode:0o600});await rename(temporary,"/data/owner.json");' < "$task_backup/owner-before.json" || task_code=1
    fi
    if [ "$task_switched" = true ]; then docker compose up -d --no-deps api || task_code=1; fi
  fi
  printf '\nBackup: %s\n' "$task_backup"
  exit "$task_code"
}
trap cleanup EXIT HUP INT TERM
task_source_changed=true
tar -xzf "$task_archive" -C /opt/royal-ai
docker compose config --quiet
docker compose build api > "$task_backup/build.log" 2>&1
task_owner_touched=true
# Bind before promotion; this isolated process has only the owner's data volume.
docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges --memory 128m --cpus 0.5 -v "$task_volume:/data" royal-ai-api:current node --input-type=module -e 'import assert from "node:assert/strict";import {isDeepStrictEqual} from "node:util";import {Owner} from "/app/lib/owner.mjs";const owner=new Owner("/data");const before=await owner.read();await owner.bindEmail(process.argv[1]);const after=await owner.read();assert.ok(isDeepStrictEqual(after,{...before,email:process.argv[1].trim().toLowerCase()}),"Owner fields changed during email migration.");console.log(JSON.stringify({owner_email_bound:true,password_preserved:true,owner_fields_preserved:true}));' "$task_email"
task_switched=true
docker compose up -d --no-deps api
task_attempt=0
until docker compose exec -T api node -e 'fetch("http://127.0.0.1:2580/healthz").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' >/dev/null 2>&1; do
  task_attempt=$((task_attempt+1)); [ "$task_attempt" -le 20 ] || exit 1
  sleep 2
done
sha256sum lib/owner.mjs server.mjs public/app.js public/index.html > "$task_backup/source-after.sha256"
docker compose exec -T api sh -c 'cd /app && sha256sum lib/owner.mjs server.mjs public/app.js public/index.html' > "$task_backup/running-after.sha256"
cmp "$task_backup/source-after.sha256" "$task_backup/running-after.sha256"
printf 'Email login published.\n'
