#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[[ ${GITHUB_ACTIONS:-} == true && ${RUNNER_OS:-} == Linux && ${RUNNER_TEMP:-} == /* ]]
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)
test_root=$(mktemp -d "$RUNNER_TEMP/royal-audit-restore.XXXXXXXX")
finance_root="$test_root/source"
backup_dir="$test_root/backups"
state_dir="$test_root/state"
docker_config="$test_root/docker-config"
mkdir -p "$finance_root/server/finance" "$backup_dir" "$state_dir" "$docker_config"
ln -s "$repo_root/server/finance/role-safety.sql" "$finance_root/server/finance/role-safety.sql"

fixture_password=$(openssl rand -hex 32)
printf 'POSTGRES_PASSWORD=%s\n' "$fixture_password" > "$finance_root/fixture.env"
cat > "$finance_root/compose.finance.yaml" <<'YAML'
name: royal-audit-restore-fixture
services:
  finance-db:
    # Image verified in deployment/finance/STATUS.md.
    image: postgres@sha256:639ab7ceb90e13123085b741fb31ef493fba25463002f6da665352e7b534b652
    user: postgres
    command: [postgres, -c, royal.audit_restore_fixture=synthetic]
    env_file: [fixture.env]
    environment:
      POSTGRES_USER: finance_schema_owner
      POSTGRES_DB: royal_finance_sim
      POSTGRES_INITDB_ARGS: --auth-host=scram-sha-256
    ports:
      - target: 5432
        host_ip: 127.0.0.1
    read_only: true
    tmpfs:
      - /tmp
      - /var/run/postgresql:uid=999,gid=999,mode=0775
    volumes:
      - fixture_data:/var/lib/postgresql/data
    cap_drop: [ALL]
    security_opt: ["no-new-privileges:true"]
    healthcheck:
      test: [CMD, pg_isready, -h, 127.0.0.1, -U, finance_schema_owner, -d, royal_finance_sim]
      interval: 1s
      timeout: 3s
      retries: 30
volumes:
  fixture_data:
YAML

local_docker() { sudo env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin DOCKER_CONFIG="$docker_config" docker "$@"; }
compose() { local_docker compose -f "$finance_root/compose.finance.yaml" "$@"; }
run_ops() {
  sudo env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin \
    DOCKER_CONFIG="$docker_config" \
    FINANCE_ROOT="$finance_root" FINANCE_BACKUP_DIR="$backup_dir" FINANCE_STATE_DIR="$state_dir" \
    python3 "$repo_root/deployment/finance/operations.py" "$@"
}
cleanup() {
  local status=$? leftover_restore
  trap - EXIT
  if compose down --volumes --remove-orphans &&
      leftover_restore=$(local_docker ps -aq --filter label=royal.finance.restore=1) && [[ -z $leftover_restore ]]; then
    if ! sudo rm -rf -- "$test_root"; then status=1; fi
  else
    status=1
  fi
  exit "$status"
}
trap cleanup EXIT

compose up --detach --wait --wait-timeout 60 finance-db
address=$(compose port finance-db 5432)
[[ $address =~ ^127\.0\.0\.1:([1-9][0-9]{0,4})$ ]]
port=${BASH_REMATCH[1]}
container=$(compose ps -q finance-db)
image_id=$(local_docker inspect "$container" --format '{{.Image}}')
[[ $image_id =~ ^sha256:[a-f0-9]{64}$ ]]
cd "$repo_root"
NODE_ENV=test ROYAL_AUDIT_RESTORE_FIXTURE_PASSWORD="$fixture_password" \
  node --import tsx deployment/finance/seed-audit-restore-fixture.ts "$port"
unset fixture_password

run_ops backup
run_ops restore-check
run_ops latest > "$test_root/success.json"
jq -e '
  .metadata.scope == "royal-unified-postgres" and .metadata.fingerprint_format == 2
  and .metadata.schemas == ["royal_audit","royal_finance","royal_game","royal_payments"]
  and .metadata.runtime_roles == ["royal_game_app","royal_payments_app"]
  and .metadata.audit.roles == ["royal_audit_reader","royal_audit_recorder"]
  and .metadata.audit.active_sources == ["royal_game.capro_pending_ledger","royal_game.demo_ledger","royal_payments.crypto_ledger"]
  and .restore.ok == true and .restore.status == "complete"
  and .restore.audit_verified == true and .restore.cleanup_verified == true
  and .restore.file == .metadata.file and .restore.sha256 == .metadata.sha256
  and .restore.data_sha256 == .metadata.data_sha256 and .restore.fingerprint_bytes == .metadata.fingerprint_bytes
  and .restore.network == "none" and .restore.live_volume_attached == false
  and .restore.checks.schema_version == 3 and .restore.checks.counts.journals == 1
' "$test_root/success.json" >/dev/null

archive_file=$(jq -r '.metadata.file' "$test_root/success.json")
[[ $archive_file =~ ^finance-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}\.dump$ ]]
metadata="$backup_dir/$archive_file.json"
# Keep the real archive and its SHA. Change only one structurally valid catalog digest.
sudo jq '.audit.triggers[0].trigger_sha256 = ("0" * 64)' "$metadata" \
  | sudo tee "$metadata.changed" >/dev/null
sudo mv -- "$metadata.changed" "$metadata"
if run_ops restore-check > "$test_root/rejected.json"; then
  printf '%s\n' 'Restore accepted a mismatched audit catalog.' >&2
  exit 1
fi
run_ops latest > "$test_root/latest-rejected.json"
last_success=$(jq -r '.restore.last_success_at' "$test_root/success.json")
jq -e --arg last_success "$last_success" '
  .restore.ok == false and .restore.status == "failed"
  and .restore.error == "restored_audit_inventory_mismatch"
  and .restore.last_success_at == $last_success
  and (.restore | has("audit_verified") or has("cleanup_verified") | not)
' "$test_root/latest-rejected.json" >/dev/null
remaining=$(local_docker ps -aq --filter label=royal.finance.restore=1)
workspaces=$(sudo find "$state_dir" -mindepth 1 -maxdepth 1 -type d -name 'restore-*' -print)
[[ -z $remaining && -z $workspaces ]]

jq -n --arg image "$image_id" --slurpfile success "$test_root/success.json" \
  --slurpfile rejected "$test_root/latest-rejected.json" '{
    fixture: "synthetic", sourceImageId: $image, restore: $success[0].restore,
    rejectedRestore: $rejected[0].restore
  }' > "$RUNNER_TEMP/royal-audit-restore-proof.json"
