#!/bin/bash
set -euo pipefail

# Run only after factory tests and all confined security controls pass.
# Record the game baseline honestly; an existing game defect must block release.
# This adds a dedicated profile for the new AI worker. Host defaults stay intact.
deployment_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
destination=/etc/apparmor.d/royal-ai-worker
profile_name=royal-ai-worker
candidate=$(mktemp)
trap 'rm -f "$candidate"' EXIT

if [ "$(id -u)" != 0 ]; then
  echo 'Run on the Docker host as root.' >&2
  exit 1
fi
if [ "$(docker image inspect royal-ai-worker:current --format '{{.Architecture}}')" != amd64 ]; then
  echo 'The tested namespace policy supports amd64 only.' >&2
  exit 1
fi

sed 's/royal-ai-worker-test/royal-ai-worker/g' "$deployment_dir/worker-apparmor" > "$candidate"
grep -Fqx 'profile royal-ai-worker flags=(attach_disconnected,mediate_deleted) {' "$candidate"
if grep -q 'flags=(unconfined)' "$candidate"; then
  echo 'An unconfined profile is not permitted.' >&2
  exit 1
fi
apparmor_parser -Q -T "$candidate"

if [ -e "$destination" ]; then
  if ! cmp -s "$candidate" "$destination"; then
    echo 'An existing policy differs. Review and back it up before any replacement.' >&2
    exit 1
  fi
else
  if grep -q -E "^${profile_name} " /sys/kernel/security/apparmor/profiles; then
    echo 'A policy with this name is already loaded. Refusing to replace it.' >&2
    exit 1
  fi
  install -o root -g root -m 0644 "$candidate" "$destination"
fi

if ! grep -q -E "^${profile_name} " /sys/kernel/security/apparmor/profiles; then
  apparmor_parser -a "$destination"
fi
echo 'The dedicated confined worker profile is available.'
