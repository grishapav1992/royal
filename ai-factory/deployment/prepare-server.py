#!/usr/bin/env python3
"""Create a private project snapshot and reversible proxy backup, without credentials."""
from pathlib import Path
from datetime import datetime, timezone
import json
import re
import shutil
import subprocess
import os

stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
source = Path('/opt/royal')
snapshot = Path('/opt/royal-ai-project')
backup = Path('/opt/royal-ai-backups') / ('install-' + stamp)
backup.mkdir(parents=True, mode=0o700)
proxy = source / 'deployment/Caddyfile'
shutil.copy2(proxy, backup / 'Caddyfile')
denied = re.compile(r'^(?:\.env(?:\..*)?|\.git|\.codex|\.agents|node_modules|data|secrets|credentials|dist(?:-server)?|artifacts|test-results.*|playwright-report)$')
secret = re.compile(r'private.*key|\.pem$|\.key$|auth\.json$|secret', re.I)
root_files = re.compile(r'^(?:package(?:-lock)?\.json|tsconfig.*\.json|vite\.config\.ts|playwright.*\.ts|index\.html|Dockerfile|README\.md|AGENTS\.md|THIRD_PARTY_NOTICES\.md)$')
root_dirs = {'src', 'server', 'public', 'tests', 'server-tests', 'scripts', 'docs'}

def excluded(directory, names):
    return [name for name in names if name.startswith('._') or denied.search(name) or secret.search(name) or (Path(directory) / name).is_symlink()]

if not snapshot.exists():
    snapshot.mkdir(mode=0o755)
    for item in source.iterdir():
        if item.is_symlink():
            continue
        if item.is_dir() and item.name in root_dirs:
            shutil.copytree(item, snapshot / item.name, ignore=excluded)
        elif item.is_file() and root_files.match(item.name):
            shutil.copy2(item, snapshot / item.name)
    if not (snapshot / 'package.json').is_file():
        raise RuntimeError('Project snapshot is incomplete')
    shutil.make_archive(str(backup / 'source'), 'gztar', snapshot)

# Deployment references are refreshed even when a source snapshot already exists.
# Existing task candidates live elsewhere and must never be overwritten here.
subprocess.run(['python3', str(Path(__file__).with_name('sync-project-knowledge.py'))], check=True)

# Only this filtered copy is made readable to the worker group, not production.
for item in [snapshot, *snapshot.rglob('*')]:
    if item.is_symlink():
        continue
    os.chown(item, 0, 1000)
    item.chmod(0o750 if item.is_dir() else 0o640)

images = {}
for container, repository in [('royal-caddy-1', 'royal-ai-caddy'), ('royal-game-1', 'royal-game')]:
    result = subprocess.run(['docker', 'inspect', container, '--format', '{{.Image}}'], capture_output=True, text=True)
    if result.returncode == 0:
        image = result.stdout.strip()
        tag = repository + ':before-ai-team-' + stamp
        subprocess.run(['docker', 'tag', image, tag], check=True)
        images[container] = {'image': image, 'backup_tag': tag}
(backup / 'manifest.json').write_text(json.dumps({'created_at': stamp, 'images': images}, indent=2))
print('Prepared isolated project snapshot and proxy backup:', backup)
