"""Activate the dashboard already published by the shared-wallet release.

Build only payments from an exact committed archive. Require all dashboard
source and actual payments inputs to match production before packaging.
"""
from pathlib import Path
import hashlib
import json
import shutil
import subprocess
import sys

CHECKOUT = Path(__file__).resolve().parents[3]
STAGE, BEFORE, OUTPUT = map(Path, sys.argv[1:4])
SOURCE = sys.argv[4]
OWNER_ID = sys.argv[5]
assert len(sys.argv) == 6 and not OUTPUT.exists()
old = json.loads(BEFORE.read_text(encoding='utf-8-sig'))
sha = lambda b: hashlib.sha256(b).hexdigest()


def git(*args):
    return subprocess.check_output(['git', *args], cwd=CHECKOUT)


assert git('rev-parse', SOURCE).decode().strip() == SOURCE
assert git('merge-base', '--is-ancestor', SOURCE, 'origin/main') == b''
assert 'dist/admin.html' in old['program'], 'Publish the shared-wallet host first'
required = git('diff', '--name-only', '272f566', '78cb1cc').decode().splitlines()
required = [n for n in required if n.startswith(('server/', 'src/admin/', 'src/shared/financeAdmin'))
            or n in ['admin.html', 'vite.config.ts', 'vite.admin.config.ts', 'package.json']]
metadata = json.loads((STAGE / 'dist-server/payments-meta.json').read_text())
inputs = [n for n in metadata['inputs'] if not n.startswith('node_modules/')]
for name in sorted(set(required + inputs)):
    committed = git('show', SOURCE + ':' + name)
    staged = (STAGE / name).read_bytes()
    assert committed == staged, 'Stage differs from committed archive: ' + name
    assert old['source'].get(name, {}).get('lf') == sha(staged.replace(b'\r\n', b'\n')), 'Published source differs: ' + name

OUTPUT.mkdir(parents=True)


def copy(source, relative):
    target = OUTPUT / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)


copy(STAGE / 'dist-server/payments.js', 'runtime/payments.js')
for name in ['snapshot.py', 'deploy.py']:
    copy(Path(__file__).parent / name, name)
copy(CHECKOUT / 'compose.finance-admin.yaml', 'compose.finance-admin.yaml')
copy(CHECKOUT / 'deployment/finance/compose.admin.yaml', 'compose.admin.yaml')
manifest = {'sourceCommit': SOURCE, 'publishedCommit': git('rev-parse', 'HEAD').decode().strip(),
            'activationOnly': True, 'ownerId': OWNER_ID, 'before': old,
            'paymentImports': sorted({i['path'] for o in metadata['outputs'].values() for i in o.get('imports', []) if i.get('external')}),
            'payload': {p.relative_to(OUTPUT).as_posix(): sha(p.read_bytes()) for p in OUTPUT.rglob('*') if p.is_file()}}
(OUTPUT / 'install-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(json.dumps({'sourceCommit': SOURCE, 'verifiedSources': len(set(required + inputs)), 'activationOnly': True}))
