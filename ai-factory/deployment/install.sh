#!/bin/sh
set -eu
cd /opt/royal-ai
mkdir -p /opt/royal-ai-secrets /opt/royal-ai-backups
chmod 700 /opt/royal-ai-secrets /opt/royal-ai-backups
python3 deployment/prepare-server.py
python3 - <<'PY'
from pathlib import Path
import secrets, os
root=Path('/opt/royal-ai-secrets')
password=root/'db-password'
if not password.exists():
    password.write_text(secrets.token_hex(32))
    password.chmod(0o600)
url=root/'database-url'
if not url.exists():
    url.write_text('postgresql://factory:'+password.read_text().strip()+'@db:5432/factory')
    url.chmod(0o600)
os.chown(url,1000,1000)
PY
if ! docker image inspect royal-ai-worker-runtime:0.1.0 > /dev/null 2>&1; then
    docker build -f Dockerfile.runtime -t royal-ai-worker-runtime:0.1.0 .
fi
docker compose build api
docker compose build worker
docker compose build knowledge-graph
docker compose up -d db api knowledge-graph
if [ -f /etc/apparmor.d/royal-ai-worker ] && grep -q '^royal-ai-worker ' /sys/kernel/security/apparmor/profiles; then
    docker compose up -d worker
else
    echo 'Panel installed. Validate the confined sandbox, then enable the dedicated profile before starting the worker.'
fi
