"""Bind only connection recovery changes to the verified live source graph."""
import hashlib, importlib.util, json, os, subprocess, sys
from pathlib import Path
ROOT = Path.cwd()
HERE = ROOT / 'deployment/releases/lobby-connection-20261101-v1'
FEATURE = 'ee5ca86f'
GIT = os.environ.get('ROYAL_GIT_BINARY', 'git')
def git(*args): return subprocess.check_output([GIT, *args], cwd=ROOT)
def digest(data): return hashlib.sha256(data).hexdigest()
def blob(commit, name): return git('show', commit + ':' + name).decode().replace('\r\n', '\n')
def projected(row):
    value = blob(row['commit'], row['path'])
    assert digest(value.encode()) == row['baseSha256']
    for patch in row.get('patches', []):
        assert value.count(patch['from']) == 1
        value = value.replace(patch['from'], patch['to'])
    assert digest(value.encode()) == row['sha256']
    return value
spec = importlib.util.spec_from_file_location('connection_overlay', HERE.parent / 'hall-elevator-20261101-v1/configure.py')
helper = importlib.util.module_from_spec(spec); spec.loader.exec_module(helper)
overlay = helper.overlay

def main():
    feature = git('rev-parse', FEATURE).decode().strip()
    parent = git('rev-parse', '5e987153^').decode().strip()
    before = json.loads(Path(sys.argv[1]).read_text())
    sources = ['server/LobbyRoom.ts', 'server/index.ts', 'src/i18n/en.ts', 'src/network/LobbyClient.ts',
               'src/network/reconnection.ts', 'src/shared/lobbyConnection.ts', 'src/ui/SocialUI.ts']
    whole = {'src/network/LobbyClient.ts', 'src/network/reconnection.ts', 'src/shared/lobbyConnection.ts'}
    configs = {
        'host': json.loads((HERE.parent / 'layout-priorities-20261101-v1/host-projection.json').read_text()),
        'backend': json.loads((HERE.parent / 'hall-elevator-20261101-v1/backend-projection.json').read_text()),
    }
    if len(sys.argv) > 2:
        prior = HERE.parent / sys.argv[2]
        for kind in configs:
            configs[kind] = json.loads((prior / (kind + '-projection.json')).read_text())
    expected = {}
    production_inputs = json.loads((HERE / 'production-inputs.json').read_text())
    for kind, config in configs.items():
        for name in ['moduleGames', 'moduleContracts', 'moduleAssets']: config.pop(name, None)
        config['productionCommit'] = before['sourceCommit']
        config['changedSources'] = sources
        for name in sources:
            if kind == 'host' and name.startswith('server/'): continue
            if kind == 'backend' and name not in ['server/LobbyRoom.ts', 'server/index.ts', 'src/shared/lobbyConnection.ts']: continue
            desired = blob(feature, name)
            if name in whole:
                row = dict(commit=feature, path=name, baseSha256=digest(desired.encode()), sha256=digest(desired.encode()))
            else:
                origin = config['files'][name]
                live = projected(origin)
                assert digest(live.encode()) in [before['source'].get(name), before['sourceLF'].get(name)], 'Live source changed: ' + name
                desired, patches = helper.overlay(blob(parent, name), desired, live)
                assert patches, 'Missing recovery change: ' + name
                row = {**origin, 'patches': [*origin.get('patches', []), *patches], 'sha256': digest(desired.encode())}
            config['files'][name] = row
            assert name not in expected or expected[name] == row['sha256'], 'Client and server source differ'
            expected[name] = row['sha256']
        needed = set(production_inputs[kind]) | (set(sources) - {'server/LobbyRoom.ts', 'server/index.ts'} if kind == 'host' else {'server/LobbyRoom.ts', 'server/index.ts', 'src/shared/lobbyConnection.ts'})
        config['files'] = {name: row for name, row in config['files'].items() if name in needed}
        assert set(config['files']) == needed, 'Incomplete production input graph'
        (HERE / (kind + '-projection.json')).write_text(json.dumps(config, ensure_ascii=False, indent=2)+'\n')
    (HERE / 'scope.json').write_text(json.dumps(dict(release='lobby-connection-20261101-v1',productionCommit=before['sourceCommit'],featureCommit=feature,
        changedSources=sources,expectedSources=expected,backendChanges=['dist-server/index.js'],moduleChanges=[],addedGames=[],restoredGames=[]),indent=2)+'\n')
    print(json.dumps(dict(productionCommit=before['sourceCommit'], sources=sources, featureCommit=feature)))

if __name__ == '__main__': main()
