#!/bin/bash
set -euo pipefail

deployment_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
apparmor_policy="$deployment_dir/worker-apparmor"
seccomp_policy="$deployment_dir/worker-seccomp.json"
profile_name=royal-ai-worker-test
container_name="royal-ai-fixed-checks-probe-$$"
runtime_image=royal-ai-worker:current
workspace_volume=royal-ai_factory_workspaces
profile_loaded=0

if [ "$(id -u)" != 0 ]; then echo 'Run the isolated diagnostic on the Docker host as root.' >&2; exit 1; fi
if grep -q -E "^${profile_name} " /sys/kernel/security/apparmor/profiles; then
  echo 'The diagnostic profile already exists. Refusing to replace it.' >&2; exit 1
fi
if docker container inspect "$container_name" >/dev/null 2>&1; then
  echo 'The diagnostic container already exists. Refusing to replace it.' >&2; exit 1
fi
apparmor_parser -Q -T "$apparmor_policy"
docker volume inspect "$workspace_volume" >/dev/null
if [ "$(docker image inspect "$runtime_image" --format '{{.Architecture}}')" != amd64 ]; then
  echo 'The candidate namespace policy requires amd64.' >&2; exit 1
fi
cleanup() {
  probe_status=$?
  trap - EXIT INT TERM
  docker rm -f "$container_name" >/dev/null 2>&1 || true
  if [ "$profile_loaded" = 1 ] && ! apparmor_parser -R "$apparmor_policy"; then
    echo 'Diagnostic profile cleanup failed.' >&2; probe_status=1
  fi
  exit "$probe_status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
apparmor_parser -a "$apparmor_policy"
profile_loaded=1

module_encoded=$(base64 -w 0 "$deployment_dir/../lib/check-sandbox.mjs")
{
  printf 'const moduleBase64="%s";\n' "$module_encoded"
  cat "$deployment_dir/probe-fixed-sandbox.mjs"
} | timeout --kill-after=5s 90s docker run --rm -i --name "$container_name" \
  --network bridge --user 1000:1000 --cap-drop ALL --security-opt no-new-privileges \
  --security-opt "apparmor=$profile_name" --security-opt "seccomp=$seccomp_policy" \
  --memory 512m --pids-limit 128 --cpus 1 \
  --mount "type=volume,src=$workspace_volume,dst=/workspaces" \
  --entrypoint node "$runtime_image" --input-type=module
