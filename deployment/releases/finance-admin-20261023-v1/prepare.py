"""Package the reviewed admin build, preserving all unrelated published source and assets."""
from pathlib import Path
import hashlib
import json
import shutil
import subprocess
import sys

CHECKOUT = Path(__file__).resolve().parents[3]
STAGE, BEFORE, OUTPUT = map(Path, sys.argv[1:])
assert not OUTPUT.exists()
OUTPUT.mkdir(parents=True)
SOURCE = '78cb1ccd53c64c08e2df836f9d14a9eb3926f1be'
BASE = '272f566'
old = json.loads(BEFORE.read_text(encoding='utf-8-sig'))
sha = lambda b: hashlib.sha256(b).hexdigest()


def git(*args):
    return subprocess.check_output(['git', *args], cwd=CHECKOUT)


def copy_file(source, relative):
    target = OUTPUT / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)
    return sha(target.read_bytes())


changed = git('diff', '--name-only', BASE, SOURCE).decode().splitlines()
changed = [n for n in changed if n.startswith(('server/', 'src/admin/', 'src/shared/financeAdmin', 'docs/finance-admin'))
           or n in ['admin.html', 'vite.config.ts', 'vite.admin.config.ts', 'package.json']]
expected = {}
for component, metadata in [('game', 'game-meta.json'), ('payments', 'payments-meta.json'), ('nile', 'nile-meta.json')]:
    meta = json.loads((STAGE / 'dist-server' / metadata).read_text())
    for name in meta['inputs']:
        if name.startswith('node_modules/'):
            continue
        value = sha((STAGE / name).read_bytes().replace(b'\r\n', b'\n'))
        expected[name] = value
        if name not in changed:
            assert old['source'].get(name, {}).get('lf') == value, 'Published backend dependency differs: ' + name
for name in changed:
    previous = git('show', BASE + ':' + name) if name in old['source'] else None
    if previous is not None:
        assert old['source'][name]['lf'] in [sha(previous.replace(b'\r\n', b'\n')), sha((STAGE / name).read_bytes().replace(b'\r\n', b'\n'))], 'Changed production file: ' + name
    copy_file(STAGE / name, 'source/' + name)
for name in expected:
    # Store every actual financial build input alongside the running financial service.
    copy_file(STAGE / name, 'finance-source/' + name)
for name in ['index.js', 'payments.js', 'play.js']:
    copy_file(STAGE / 'dist-server' / name, 'runtime/' + name)
for p in (STAGE / 'dist-admin').rglob('*'):
    if p.is_file():
        copy_file(p, 'admin/' + p.relative_to(STAGE / 'dist-admin').as_posix())
for name in ['snapshot.py', 'deploy.py']:
    copy_file(Path(__file__).parent / name, name)
copy_file(CHECKOUT / 'compose.finance-admin.yaml', 'compose.finance-admin.yaml')
copy_file(CHECKOUT / 'deployment/finance/compose.admin.yaml', 'compose.admin.yaml')
manifest = {'sourceCommit': SOURCE, 'publishedCommit': git('rev-parse', 'HEAD').decode().strip(),
            'ownerId': 'fb3dae97-8288-4932-86ab-28d40ce45014', 'before': old, 'buildInputs': expected,
            'payload': {p.relative_to(OUTPUT).as_posix(): sha(p.read_bytes()) for p in OUTPUT.rglob('*') if p.is_file()}}
(OUTPUT / 'install-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(json.dumps({'sources': len(changed), 'buildInputs': len(expected), 'files': len(manifest['payload'])}))
