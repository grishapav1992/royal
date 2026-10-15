#!/bin/sh
set -eu
cd /opt/royal-ai
task_backup=/opt/royal-ai-backups/$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$task_backup"
chmod 700 "$task_backup"
docker compose exec -T db pg_dump -U factory -d factory -Fc > "$task_backup/factory.dump"
docker compose exec -T api tar -C /data -cf - owner.json > "$task_backup/owner.tar"
chmod 600 "$task_backup/factory.dump" "$task_backup/owner.tar"
sha256sum "$task_backup/factory.dump" > "$task_backup/SHA256SUMS"
# Project workspaces and generated candidates remain in their persistent volume.
