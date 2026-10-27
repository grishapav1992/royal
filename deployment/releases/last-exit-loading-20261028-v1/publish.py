"""Publish one verified Last EXIT package under the existing publication locks."""
import fcntl
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tarfile
from types import SimpleNamespace

NAME = 'last-exit-loading-20261028-v1'
ROOT = Path('/opt/royal-releases') / NAME
LIVE = Path('/opt/royal')
MODULES = Path('/opt/royal-game-modules')
STATE = Path('/opt/royal-game-modules-state')
BACKUP = Path('/opt/royal-backups') / NAME
GAME = 'github-crash'

def require(value, message):
    if not value:
        raise RuntimeError(message)

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def read(path):
    require(not path.is_symlink(), 'Symlink rejected')
    return json.loads(path.read_text())

def command(args):
    return subprocess.check_output(args, cwd=LIVE, text=True).strip()

def snapshot(source_names):
    container = json.loads(command(['docker', 'inspect', 'royal-game-1']))[0]
    program = json.loads(command(['docker', 'exec', 'royal-game-1', 'node', '-e',
        "const fs=require('fs'),c=require('crypto');console.log(JSON.stringify(Object.fromEntries(['dist/index.html','dist-server/index.js','dist-server/payments.js','dist-server/crypto-reconcile.js'].map(n=>[n,c.createHash('sha256').update(fs.readFileSync('/app/'+n)).digest('hex')]))))"]))
    return {'image': container['Image'], 'containerId': container['Id'],
        'startedAt': container['State']['StartedAt'], 'health': container['State']['Health']['Status'],
        'sourceCommit': container['Config']['Labels'].get('org.opencontainers.image.revision'),
        'preparedImage': command(['docker', 'image', 'inspect', 'royal-game', '--format', '{{.Id}}']),
        'source': {name: sha(LIVE/name) if (LIVE/name).is_file() else None for name in source_names},
        'program': program, 'hostContractSha256': sha(STATE/'host.json'),
        'modulePointers': {str(p.relative_to(MODULES)): sha(p) for p in sorted(MODULES.glob('*/active.json'))},
        'services': command(['docker', 'ps', '--no-trunc', '--format', '{{.ID}} {{.Names}} {{.Image}}'])}

def main():
    require(Path(__file__).resolve() == ROOT/'publish.py', 'Unexpected publication path')
    for root in [ROOT, LIVE, MODULES, STATE]:
        require(root.is_dir() and not any(p.is_symlink() for p in [root, *root.parents]), 'Unsafe root')
    release = read(ROOT/'release-manifest.json')
    before = read(ROOT/'before.json')
    receipt = read(ROOT/'release-github.json')
    expected = read(ROOT/'operator.json')
    require(release['scope'] == 'modules' and release['modules'] == ['last-exit'] and release['build']['passed'], 'Unexpected release scope')
    require(release['sourceCommit'] == receipt['sourceCommit'] == expected['sourceCommit'], 'Source commit differs')
    require(release['baseCommit'] == before['sourceCommit'], 'Production source baseline differs')
    require(len(release['packages']) == 1 and release['packages'][0]['gameId'] == GAME, 'Foreign package rejected')
    require(sha(ROOT/'publisher.py') == expected['publisherSha256'], 'Publisher bytes differ')
    version = release['packages'][0]['version']
    folder = 'module-dist/' + GAME + '/versions/' + version + '/'
    files = release['files']
    require(set(files) == {'module-dist/'+GAME+'/active.json', *[folder+name for name in read(ROOT/'package/manifest.json')['files']], folder+'manifest.json'}, 'Unexpected release inventory')
    for name, digest in files.items():
        if name.startswith(folder):
            require(sha(ROOT/'package'/name[len(folder):]) == digest, 'Prepared package bytes differ')
    spec = importlib.util.spec_from_file_location('reviewed_game_publisher', ROOT/'publisher.py')
    publisher = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(publisher)
    locks = []
    try:
        for path in [Path('/opt/royal-releases/themed-publish.lock'), LIVE/'.client-presentation-deploy.lock', STATE/'module.lock']:
            require(not path.is_symlink(), 'Lock symlink rejected')
            handle = path.open('a')
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            locks.append(handle)
        require(shutil.disk_usage(LIVE).free >= 5*1024**3, 'Server free-space reserve is not met')
        require(not (ROOT/'published.json').exists(), 'Publication is already recorded')
        current = snapshot(before['source'])
        require(current == {key: before[key] for key in current}, 'Production changed since review')
        require(current['health'] == 'healthy', 'Host is unhealthy')
        contract = read(STATE/'host.json')['games'][GAME]
        require(contract == {'apiVersion': 1, 'rulesVersion': 1, 'progressVersion': 1}, 'Host contract differs')
        publisher.verify(ROOT/'package', contract, GAME)
        pointer = MODULES/GAME/'active.json'
        require(sha(pointer) == before['pointerSha256'], 'Last EXIT changed since review')
        old_version = before['pointer']['manifest'].split('/')[4]
        publisher.verify(MODULES/GAME/'versions'/old_version, contract, GAME)
        BACKUP.mkdir(mode=0o700)
        archive = BACKUP/'source.tgz'
        with tarfile.open(archive, 'w:gz') as output:
            for name in before['source']:
                if (LIVE/name).is_file():
                    require(not (LIVE/name).is_symlink(), 'Source symlink rejected')
                    output.add(LIVE/name, arcname='application/'+name, recursive=False)
            output.add(pointer, arcname='game-modules/'+GAME+'/active.json', recursive=False)
            output.add(MODULES/GAME/'versions'/old_version, arcname='game-modules/'+GAME+'/versions/'+old_version)
            output.add(STATE/'host.json', arcname='state/host.json', recursive=False)
        archive.chmod(0o600)
        for image, suffix in [(current['image'], ''), (current['preparedImage'], '-prepared')]:
            subprocess.run(['docker', 'tag', image, 'royal-game:before-'+NAME+suffix], check=True)
        backup = {'archive': str(archive), 'bytes': archive.stat().st_size, 'sha256': sha(archive), 'priorImage': current['image'], 'oldVersion': old_version}
        (BACKUP/'backup.json').write_text(json.dumps(backup, indent=2)+'\n')
        (ROOT/'backup.json').write_text(json.dumps(backup, indent=2)+'\n')
        require(shutil.disk_usage(LIVE).free >= 5*1024**3, 'Server reserve is not met after backup')
        result = publisher.run(SimpleNamespace(operation='install', package=str(ROOT/'package'), game=GAME,
            root=str(MODULES), state=str(STATE), expected_sha=before['pointerSha256']))
        after = snapshot(before['source'])
        require({key: value for key, value in after.items() if key != 'modulePointers'} == {key: value for key, value in current.items() if key != 'modulePointers'}, 'Host or services changed')
        require({key: value for key, value in after['modulePointers'].items() if key != GAME+'/active.json'} == {key: value for key, value in current['modulePointers'].items() if key != GAME+'/active.json'}, 'Another module changed')
        require(sha(pointer) == files['module-dist/'+GAME+'/active.json'], 'Installed pointer differs from prepared bytes')
        publisher.verify(MODULES/GAME/'versions'/version, contract, GAME)
        record = {'release': NAME, 'sourceCommit': release['sourceCommit'], 'baseCommit': release['baseCommit'], 'published': True,
            'module': result, 'backup': backup, 'after': after, 'freeBytesAfter': shutil.disk_usage(LIVE).free,
            'hostRestarted': False, 'databaseTouched': False, 'otherModulesPreserved': True}
        (ROOT/'published.json').write_text(json.dumps(record, indent=2)+'\n')
        print(json.dumps(record))
    finally:
        for lock in reversed(locks):
            lock.close()

if __name__ == '__main__':
    main()
