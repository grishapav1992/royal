"""Package committed build outputs against a fresh production fingerprint."""
from pathlib import Path
import hashlib
import json
import shutil
import sys

stage, snapshot, output = map(Path, sys.argv[1:4])
revision = sys.argv[4]
assert len(revision) == 40 and all(c in '0123456789abcdef' for c in revision)
before = json.loads(snapshot.read_text(encoding='utf-8-sig'))
assert before['program'] == before['preparedProgram'], 'Running/prepared image mismatch'
assert before['containers']['royal-game-1']['health'] == 'healthy'
output.mkdir(parents=True, exist_ok=False)
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
canonical = lambda p: hashlib.sha256(p.read_bytes().replace(b'\r\n',b'\n')).hexdigest()
release = json.loads((stage / 'module-build/release-manifest.json').read_text())
assert release['sourceCommit'] == revision and release['build']['passed'] and release['githubVerified']
for name,digest in release['files'].items(): assert sha(stage / name) == digest, name
payload = {}

def copy(source, name):
    target = output / name
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)
    payload[name] = sha(target)
    return payload[name]

roots = ['src', 'server', 'public', 'scripts', 'docs', 'games']
inputs = ['package.json', 'package-lock.json', 'Dockerfile', '.dockerignore', 'index.html', 'admin.html',
          'tsconfig.json', 'tsconfig.finance.json', 'vite.config.ts', 'vite.admin.config.ts']
sources = {}
for path in [stage / n for n in inputs] + [p for r in roots for p in (stage / r).rglob('*')]:
    if not path.is_file(): continue
    name = path.relative_to(stage).as_posix()
    assert not path.is_symlink() and not any(p.startswith('.env') or p in ['node_modules','data','secrets','.git'] for p in Path(name).parts)
    if before['source'].get(name, {}).get('lf') != canonical(path):
        sources[name] = copy(path, 'source/' + name)

finance = {}
for name, old in before['financeSource'].items():
    if name.startswith(('server/', 'src/', 'scripts/')) and (stage / name).is_file() and canonical(stage / name) != old['lf']:
        finance[name] = copy(stage / name, 'finance-source/' + name)

# All financial bundle inputs must be the committed candidate, including bundled dependencies.
meta = json.loads((stage / 'artifacts/work/mortal-kombat-duel/financial-meta.json').read_text())
assert meta['sourceCommit'] == revision, 'Financial source commit differs'
for name in meta['inputs']:
    if 'node_modules' in Path(name).parts: continue
    assert not Path(name).is_absolute() and '..' not in Path(name).parts, 'Financial input escaped source tree'
    assert (stage / name).is_file(), name
    if before['financeSource'].get(name,{}).get('lf') != canonical(stage / name):
        finance[name] = copy(stage / name, 'finance-source/' + name)

def delta(directory):
    result = {}
    for name in release['files']:
        if name.startswith(directory + '/'):
            path = stage / name
            relative = path.relative_to(stage / directory).as_posix()
            if before['program'].get(directory + '/' + relative) != sha(path):
                result[relative] = copy(path, directory + '/' + relative)
    return result

dist, modules = delta('dist'), delta('module-dist')
backend = copy(stage / 'dist-server/index.js', 'index.js')
financial = copy(stage / 'dist-server/nile-play.js', 'play.js')
packages = {name:sha(stage / name) for name in ['package.json','package-lock.json']}
install_dependencies = any(digest != before['program'][name] for name,digest in packages.items())
if install_dependencies:
    for name in packages: copy(stage / name, 'dependencies/' + name)
pointers = {}
wallet_transition = before['source'].get('src/wallet/WalletClient.ts', {}).get('lf') != canonical(stage / 'src/wallet/WalletClient.ts')
games = {'mortal-kombat'}
if wallet_transition:
    games.update(Path(name).parent.name for name in before['modules'] if name.endswith('/active.json'))
for game in sorted(games):
    pointer = stage / 'module-dist' / game / 'active.json'
    data = json.loads(pointer.read_text())
    relative = data['manifest'].removeprefix('/game-modules/')
    root = (stage / 'module-dist' / relative).parent
    for path in root.rglob('*'):
        if path.is_file(): copy(path, 'external/' + path.relative_to(stage / 'module-dist').as_posix())
    pointers['/opt/royal-game-modules/' + game + '/active.json'] = copy(pointer, 'external/' + game + '/active.json')
copy(stage / 'module-dist/host-contracts.json', 'host.json')
copy(stage / 'module-build/release-manifest.json', 'release-manifest.json')
for name in ['snapshot.py', 'deploy.py']:
    copy(stage / 'deployment/releases/mortal-kombat-20261023-v1' / name, name)
manifest = {'release':'mortal-kombat-20261023-v1','sourceCommit':revision,'before':{**before,'sourceRows':before['source'],'source':{n:v['sha256'] for n,v in before['source'].items()},'container':{'image':before['containers']['royal-game-1']['image']}},'source':sources,'changed':sources,
            'financeSource':finance,'dist':dist,'modules':modules,'backend':backend,'financial':financial,
            'pointers':pointers,'payload':payload,'packages':packages,'installDependencies':install_dependencies,
            'walletTransition':wallet_transition,'preexistingNileUnready':before['containers']['royal-nile-play']['health']!='healthy',
            'helperSha256':payload['deploy.py'],'snapshotSha256':payload['snapshot.py']}
(output / 'install-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(json.dumps({'sources':len(sources),'financeSources':len(finance),'dist':len(dist),'modules':len(modules),'pointers':len(pointers)}))
