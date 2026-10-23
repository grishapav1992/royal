"""Package a committed, built LF checkout against the reviewed production inventory."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile

stage, proof, output = map(Path, sys.argv[1:])
output.mkdir(parents=True, exist_ok=False)
before = json.loads((proof / 'production-before.json').read_text(encoding='utf-8-sig'))
extra = json.loads((proof / 'production-extra.json').read_text(encoding='utf-8-sig'))
with tarfile.open(proof / 'production-source.tgz') as archive:
    original = {m.name: archive.extractfile(m).read() for m in archive if m.isfile()}
sha = lambda b: hashlib.sha256(b).hexdigest()
assert all(sha(original[n]) == h for n, h in before['source'].items())
changed = {}
paths = [p for directory in ['src', 'server', 'public', 'scripts', 'docs', 'games'] for p in (stage / directory).rglob('*')]
paths += [stage / name for name in ['Dockerfile','.dockerignore','package.json','package-lock.json','index.html','tsconfig.json','tsconfig.finance.json','vite.config.ts','deployment/SERVER.md']]
for path in paths:
    if path.is_file() and not path.is_symlink():
        name = path.relative_to(stage).as_posix()
        assert not any(p in ['node_modules', 'data', 'secrets', '.git'] or p.startswith('.env') for p in path.relative_to(stage).parts)
        data = path.read_bytes()
        if name in original and original[name].replace(b'\r\n', b'\n') == data.replace(b'\r\n', b'\n'):
            continue
        destination = output / 'source' / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)
        changed[name] = sha(data)
for row in extra['files'].values():
    name = row['source']
    destination = output / 'finance-source' / name
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(stage / name, destination)

def delta(source, target, prefix, previous):
    result = {}
    for path in source.rglob('*'):
        if path.is_file():
            relative = path.relative_to(source).as_posix()
            digest = sha(path.read_bytes())
            if previous.get(prefix + relative) == digest:
                continue
            result[relative] = digest
            destination = target / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, destination)
    return result

dist = delta(stage / 'dist', output / 'dist-delta', 'dist/', before['program'])
modules = delta(stage / 'module-dist', output / 'module-delta', 'module-dist/', before['program'])
(output / 'server-delta').mkdir()
shutil.copyfile(stage / 'dist-server/index.js', output / 'server-delta/index.js')
shutil.copyfile(stage / 'dist-server/nile-play.js', output / 'play.js')
pointers = {}
for name in before['moduleFiles']:
    if name.endswith('/active.json'):
        game = Path(name).parent.name
        pointer = stage / 'module-dist' / game / 'active.json'
        assert pointer.is_file(), game
        data = json.loads(pointer.read_text())
        version_root = Path(data['manifest']).parent.as_posix().removeprefix('/game-modules/')
        for source in (stage / 'module-dist' / version_root).rglob('*'):
            if source.is_file():
                relative = source.relative_to(stage / 'module-dist')
                destination = output / 'external-modules' / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source, destination)
        destination = output / 'external-modules' / game / 'active.json'
        shutil.copyfile(pointer, destination)
        pointers[name] = sha(pointer.read_bytes())
shutil.copyfile(stage / 'module-dist/host-contracts.json', output / 'host.json')
for name in ['deploy.py', 'snapshot.py']:
    source = stage / 'deployment/releases/pvp-usdt-20261023-v1' / name
    shutil.copyfile(source, output / name)
revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=proof.parent.parent, text=True).strip()
manifest = {'release': 'pvp-usdt-20261023-v1', 'sourceCommit': revision, 'before': before, 'extra': extra,
            'changed': changed, 'dist': dist, 'modules': modules,
            'backend': sha((output / 'server-delta/index.js').read_bytes()),
            'financial': sha((output / 'play.js').read_bytes()), 'pointers': pointers,
            'packages': {name: sha((stage / name).read_bytes()) for name in ['package.json','package-lock.json']}}
manifest['payload'] = {p.relative_to(output).as_posix(): sha(p.read_bytes()) for p in output.rglob('*') if p.is_file()}
(output / 'install-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(json.dumps({'changedSources': len(changed), 'distFiles': len(dist), 'moduleFiles': len(modules), 'externalPointers': len(pointers)}))
