"""Package the verified build as a small delta against the reviewed production snapshot."""
from pathlib import Path
import hashlib
import json
import shutil
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[3]
WORK = ROOT / 'artifacts/work/pvp-virtual-usdt'
OUT = WORK / 'payload'
NAME = 'pvp-virtual-usdt-20261024-v1'
BASE = '5045c401063b5f2c792497ae2f4e53bcd34e1a98'
sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()
git = lambda *args: subprocess.check_output(['git', *args], cwd=ROOT, text=True).strip()
old = json.loads((WORK / 'before.json').read_text())
normalized = json.loads((WORK / 'source-normalized.json').read_text())
runtime = json.loads((WORK / 'runtime-normalized.json').read_text())
active = json.loads((WORK / 'active-modules.json').read_text())
release = json.loads((ROOT / 'module-build/release-manifest.json').read_text())
assert release['sourceCommit'] == git('rev-parse', 'HEAD')
assert release['baseCommit'] == git('rev-parse', BASE)
assert release['githubVerified'] and release['build']['passed']
assert not OUT.exists(), 'Retain and review an existing payload before replacing it'
OUT.mkdir()

def copy(source, relative):
    target = OUT / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)

changed = {}
for name in release['changed']:
    if name.startswith(('src/', 'server/', 'scripts/', 'docs/', 'games/')):
        assert (ROOT / name).is_file(), name
        if sha(ROOT / name) == old['source'].get(name): continue
        changed[name] = sha(ROOT / name)
        copy(ROOT / name, 'source/' + name)
for name, row in normalized.items():
    if name not in changed and name != 'deployment/SERVER.md' and not name.endswith(('.orig', '.bak')):
        assert (ROOT / name).is_file(), name
        assert hashlib.sha256((ROOT / name).read_bytes().replace(b'\r\n', b'\n')).hexdigest() == row['lf'], name
assert changed and 'server/index.ts' in changed

delta = {}
for name, digest in release['files'].items():
    if not name.startswith('dist/') or old['program'].get(name) == digest:
        continue
    relative = name.removeprefix('dist/')
    source = 'public/' + relative
    if name in runtime and runtime[name]['raw'] == old['program'].get(name) and digest == runtime[name]['lf']:
        continue
    if relative in ['index.html', 'admin.html'] or relative.startswith('assets/') and Path(relative).suffix in ['.js', '.css']:
        assert relative in ['index.html', 'admin.html'] or name not in old['program'], 'Existing asset URL would change'
        delta[relative] = digest
        copy(ROOT / name, 'dist-delta/' + relative)
    else:
        source = 'public/' + relative
        assert source in normalized and old['program'].get(name) == normalized[source]['sha256'], name
        assert digest == normalized[source]['lf'], 'Unexpected public asset change: ' + name
copy(ROOT / 'dist-server/index.js', 'server-delta/index.js')

packages = []
module_delta = {}
for row in release['packages']:
    game, version = row['gameId'], row['version']
    folder = ROOT / 'module-dist' / game / 'versions' / version
    metadata = json.loads((folder / 'manifest.json').read_text())
    prior = active['games'].get(game)
    if prior and metadata['files'] == prior['metadata']['files']:
        continue
    contract = active['host']['games'].get(game)
    assert contract and all(metadata[k] == contract[k] for k in ['apiVersion', 'rulesVersion', 'progressVersion']), game
    before = old['moduleFiles'].get('/opt/royal-game-modules/' + game + '/active.json', 'none')
    packages.append({'gameId': game, 'version': version, 'beforeSha256': before})
    for file in sorted(folder.rglob('*')):
        if file.is_file():
            name = file.relative_to(ROOT / 'module-dist').as_posix()
            module_delta[name] = sha(file)
            assert release['files']['module-dist/' + name] == module_delta[name]
            copy(file, 'modules/' + name)

for name in ['deploy.py', 'snapshot.py', 'modules.py']:
    copy(Path(__file__).parent / name, name)
copy(ROOT / 'module-build/release-manifest.json', 'release-manifest.json')
manifest = {'release': NAME, 'sourceCommit': release['sourceCommit'], 'baseCommit': release['baseCommit'],
    'before': old, 'changed': changed, 'delta': delta, 'serverDelta': {'index.js': sha(ROOT / 'dist-server/index.js')},
    'helperSha256': sha(OUT / 'deploy.py'), 'snapshotSha256': sha(OUT / 'snapshot.py'),
    'modulesHelperSha256': sha(OUT / 'modules.py'), 'moduleDelta': module_delta, 'modulePackages': packages}
(OUT / 'install-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
with tarfile.open(WORK / 'transport.tgz', 'w:gz') as archive:
    for file in sorted(OUT.rglob('*')):
        if file.is_file():
            archive.add(file, arcname=file.relative_to(OUT).as_posix(), recursive=False)
print(json.dumps({'sourceFiles': len(changed), 'clientFiles': len(delta), 'modulePackages': len(packages),
                  'transportBytes': (WORK / 'transport.tgz').stat().st_size, 'sourceCommit': release['sourceCommit']}))
