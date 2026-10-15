#!/bin/bash
set -euo pipefail

deployment_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
apparmor_policy="$deployment_dir/worker-apparmor"
seccomp_policy="$deployment_dir/worker-seccomp.json"
adapter_source="$deployment_dir/../lib/codex.mjs"
profile_name=royal-ai-worker-test
container_name="royal-ai-sandbox-probe-$$"
runtime_image=${ROYAL_SANDBOX_PROBE_IMAGE:-royal-ai-worker-runtime:0.1.0}
probe_network=${ROYAL_SANDBOX_PROBE_NETWORK:-none}
profile_loaded=0

case "$probe_network" in
  none|bridge) ;;
  *) echo 'Only isolated none/bridge diagnostic networks are supported.' >&2; exit 1 ;;
esac

if [ "$(id -u)" != 0 ]; then
  echo 'Run this diagnostic on the Docker host as root.' >&2
  exit 1
fi
if grep -q -E "^${profile_name} " /sys/kernel/security/apparmor/profiles; then
  echo 'The diagnostic profile already exists. Refusing to replace it.' >&2
  exit 1
fi
grep -Fqx 'profile royal-ai-worker-test flags=(attach_disconnected,mediate_deleted) {' "$apparmor_policy"
apparmor_parser -Q -T "$apparmor_policy"
if [ "$(docker image inspect "$runtime_image" --format '{{.Architecture}}')" != amd64 ]; then
  echo 'This candidate namespace allowlist requires amd64.' >&2
  exit 1
fi

cleanup() {
  probe_status=$?
  trap - EXIT INT TERM
  docker rm -f "$container_name" >/dev/null 2>&1 || true
  if [ "$profile_loaded" = 1 ]; then
    if ! apparmor_parser -R "$apparmor_policy"; then
      echo 'Diagnostic profile cleanup failed. Remove royal-ai-worker-test before continuing.' >&2
      probe_status=1
    fi
  fi
  exit "$probe_status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

apparmor_parser -a "$apparmor_policy"
profile_loaded=1

docker_args=(run --rm --name "$container_name" --network "$probe_network" --user 1000:1000 --cap-drop ALL
  --security-opt no-new-privileges
  --security-opt "apparmor=$profile_name"
  --security-opt "seccomp=$seccomp_policy")

timeout --kill-after=5s 30s docker "${docker_args[@]}" --env CODEX_HOME=/home/node/.codex \
  --entrypoint codex "$runtime_image" sandbox -P :workspace -C /tmp -- /bin/true

adapter_encoded=$(base64 -w 0 "$adapter_source")
{
  printf 'const adapterBase64="%s";\n' "$adapter_encoded"
  cat "$deployment_dir/sandbox-probe.mjs"
} | timeout --kill-after=5s 240s docker "${docker_args[@]}" -i \
  --env "ROYAL_SANDBOX_EGRESS_CONTROL=$probe_network" \
  --entrypoint node "$runtime_image" --input-type=module

echo 'Sandbox checks passed; the EXIT trap now removes the diagnostic profile.'
