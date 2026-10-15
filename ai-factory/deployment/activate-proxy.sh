#!/bin/sh
set -eu
cd /opt/royal-ai
python3 - <<'PY'
from pathlib import Path
path=Path('/opt/royal/deployment/Caddyfile')
original=path.read_text()
if 'royal-ai-api:2580' in original:
    candidate=original
else:
    expected='    reverse_proxy game:2567'
    if original.count(expected)!=1:
        raise RuntimeError('Unexpected proxy configuration; preserve it for review')
    candidate=original.replace(expected, '''    redir /team /team/ 308
    handle_path /team/* {
        reverse_proxy royal-ai-api:2580
    }
    handle {
        reverse_proxy game:2567
    }''')
Path('/opt/royal-ai/Caddyfile.candidate').write_text(candidate)
PY
docker exec -i royal-caddy-1 caddy validate --config /dev/stdin --adapter caddyfile < Caddyfile.candidate
# The existing Caddy container binds this file, so preserve the mounted inode.
cat Caddyfile.candidate > /opt/royal/deployment/Caddyfile
docker exec -i royal-caddy-1 caddy reload --config /dev/stdin --adapter caddyfile < Caddyfile.candidate
