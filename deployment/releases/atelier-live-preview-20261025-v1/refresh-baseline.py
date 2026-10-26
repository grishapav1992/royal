from pathlib import Path
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
import subprocess

root = Path('/opt/royal-releases/atelier-live-preview-20261025-v1')
locks = []
for name in ['/opt/royal-releases/themed-publish.lock', '/opt/royal/.client-presentation-deploy.lock', '/opt/royal-game-modules-state/module.lock']:
    handle = open(name, 'a')
    fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    locks.append(handle)
assert not any((root / name).exists() for name in ['runtime-context', 'build-result.json', 'published.json'])
path = root / 'install-manifest.json'
original = path.read_bytes()
manifest = json.loads(original)
assert manifest['sourceCommit'] == '27264a8cac2744aad98145631e76a291af5cbedf'
old = manifest['before']
current = json.loads(subprocess.check_output(['python3', str(root / 'snapshot.py')], text=True))
assert set(old) == set(current)
assert all(old[key] == current[key] for key in old if key not in ['at', 'availableBytes', 'services'])
expected = {'/royal-ai-api-1', '/royal-tron-reader'}
assert set(old['services']) == set(current['services'])
changed = {name for name in old['services'] if old['services'][name] != current['services'][name]}
assert changed == expected
for name in changed:
    assert old['services'][name]['id'] == current['services'][name]['id']
    assert old['services'][name]['image'] == current['services'][name]['image']
    assert set(old['services'][name]) == {'id', 'image', 'startedAt'}
rows = json.loads(subprocess.check_output(['docker', 'inspect', *sorted(changed)], text=True))
for row in rows:
    assert row['State']['Status'] == 'running'
    assert row['State'].get('Health', {}).get('Status', 'healthy') == 'healthy'
    assert current['services'][row['Name']] == {'id': row['Id'], 'image': row['Image'], 'startedAt': row['State']['StartedAt']}
manifest['before'] = current
encoded = (json.dumps(manifest, indent=2) + '\n').encode()
evidence = {
    'at': datetime.now(timezone.utc).isoformat(),
    'sourceCommit': manifest['sourceCommit'],
    'reason': 'Two unchanged persistent containers restarted before this installation; all protected source, runtime, configuration and module fingerprints match exactly.',
    'manifestBeforeSha256': hashlib.sha256(original).hexdigest(),
    'manifestAfterSha256': hashlib.sha256(encoded).hexdigest(),
    'services': {name: {'before': old['services'][name], 'after': current['services'][name]} for name in sorted(changed)},
    'allOtherProtectedSectionsIdentical': True,
    'failedAttempt': json.loads((root / 'exit.json').read_text()),
}
(root / 'baseline-refresh.json').write_text(json.dumps(evidence, indent=2) + '\n')
temporary = path.with_suffix('.next')
temporary.write_bytes(encoded)
os.replace(temporary, path)
(root / 'exit.json').unlink()
print(json.dumps(evidence))
