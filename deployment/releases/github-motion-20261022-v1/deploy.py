"""Guarded single-game publication without changing host programs or user data."""
from pathlib import Path, PurePosixPath
from types import SimpleNamespace
import fcntl
import hashlib
import importlib.util
import json
import shutil
import subprocess
import sys
import tarfile

ROOT = Path(__file__).resolve().parent
LIVE = Path('/opt/royal')
NAME = 'github-motion-20261022-v1'
GAMES = ('royal-fruits','royal-dice','royal-limbo','royal-mines','royal-keno','github-craps','github-tower','github-diamonds','github-sic-bo')
PUBLIC = Path('/opt/royal-game-modules')
STATE = Path('/opt/royal-game-modules-state')
BACKUP = Path('/opt/royal-backups') / NAME
M = json.loads((ROOT / 'install-manifest.json').read_text())
OLD = M['before']
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def run(args):
    return subprocess.check_output(args, text=True).strip()


def snapshot():
    return json.loads(run(['python3', str(ROOT / 'snapshot.py')]))


def write(name, value):
    (ROOT / name).write_text(json.dumps(value, indent=2) + '\n')


def publisher():
    spec = importlib.util.spec_from_file_location('reviewed_publisher', ROOT / 'publisher.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def args(operation, game):
    return SimpleNamespace(operation=operation, package=str(ROOT / 'packages' / game), game=game,
                           version=None, expected_sha=M['games'][game]['priorPointerSha256'], root=str(PUBLIC), state=str(STATE))


def unchanged(after):
    for key in ['configHashes', 'container', 'services', 'moduleHostContract', 'realMoneyFlags',
                'preparedImage', 'program', 'preparedProgram']:
        require(after[key] == OLD[key], 'Host or production settings changed: ' + key)


def validate():
    require(ROOT == Path('/opt/royal-releases') / NAME and M['release'] == NAME, 'Unexpected release path')
    require(len(M['sourceCommit']) == 40, 'Missing source commit')
    for name, digest in M['helpers'].items():
        require(sha(ROOT / name) == digest, 'Reviewed helper changed: ' + name)
    allowed = {'docs/imported-game-motion.md', *['games/' + game + '/entry.ts' for game in GAMES],
               *['src/ui/' + name + '.ts' for name in ['CasinoConfirmedMotion','CasinoSessionsUI','DiceSlotUI','FruitsReels','FruitsSlotUI','GithubGames','LimboSlotUI','OriginalGameView']],
               *['src/ui/importedMotion/' + name for name in ['Audio.ts','ImportedMotion.ts','Outcome.ts','Profiles.ts','imported-motion.css']]}
    require(set(M['changes']) == allowed and set(M['games']) == set(GAMES), 'Unexpected release scope')
    collections = [(M['changes'], 'source'), *[(M['games'][game]['files'], 'packages/' + game) for game in GAMES]]
    for collection, folder in collections:
        for name, digest in collection.items():
            path = PurePosixPath(name)
            require(str(path) == name and not path.is_absolute() and not any(part in ['..', '.', '.git', 'data', 'secrets'] or part.startswith('.env') for part in path.parts), 'Unsafe payload path')
            target = ROOT / folder / name
            require(target.is_file() and not any(p.is_symlink() for p in [target, *target.parents]), 'Missing or symbolic payload')
            require(sha(target) == digest, 'Payload changed: ' + name)
    checked = {}
    module = publisher()
    for game in GAMES:
        value = module.run(args('check', game))
        require(value['version'] == M['games'][game]['version'] and value['beforeSha256'] == M['games'][game]['priorPointerSha256'], 'Module pointer changed')
        checked[game] = value
    before = snapshot()
    unchanged(before)
    for key in ['source', 'moduleFiles']:
        require(before[key] == OLD[key], 'Production baseline changed: ' + key)
    require(before['container']['health'] == 'healthy', 'Application is not healthy')
    require(before['availableBytes'] > 500 * 1024**2, 'Insufficient backup capacity')
    return checked


def atomic(source, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(target.name + '.github-motion-next')
    require(not temporary.exists(), 'Unexpected temporary file')
    shutil.copy2(source, temporary)
    temporary.replace(target)


def backup():
    BACKUP.mkdir(mode=0o700, exist_ok=False)
    with tarfile.open(BACKUP / 'source.tgz', 'w:gz') as archive:
        for name, digest in OLD['source'].items():
            require(sha(LIVE / name) == digest, 'Source changed during backup: ' + name)
            archive.add(LIVE / name, arcname=name, recursive=False)
    with tarfile.open(BACKUP / 'source.tgz') as archive:
        saved = {m.name: hashlib.sha256(archive.extractfile(m).read()).hexdigest() for m in archive.getmembers()}
        require(saved == OLD['source'], 'Source backup differs')
    for game in GAMES:
        pointer = PUBLIC / game / 'active.json'
        if pointer.is_file():
            shutil.copy2(pointer, BACKUP / (game + '-active.json'))
    for suffix, ref in [('', OLD['container']['image']), ('-prepared', OLD['preparedImage'])]:
        run(['docker', 'tag', ref, 'royal-game:before-' + NAME + suffix])
    write('backup.json', {'path': str(BACKUP), 'sourceSha256': sha(BACKUP / 'source.tgz'), 'priorExternalPointers': {game: (PUBLIC / game / 'active.json').is_file() for game in GAMES}})


def restore():
    for game in GAMES:
        pointer = PUBLIC / game / 'active.json'
        saved = BACKUP / (game + '-active.json')
        if saved.is_file():
            atomic(saved, pointer)
        else:
            pointer.unlink(missing_ok=True)
    with tarfile.open(BACKUP / 'source.tgz') as archive:
        for name in M['changes']:
            target = ROOT / 'restore' / name
            target.parent.mkdir(parents=True, exist_ok=True)
            if name in OLD['source']:
                target.write_bytes(archive.extractfile(name).read())
                atomic(target, LIVE / name)
            else:
                (LIVE / name).unlink(missing_ok=True)
    write('recovered.json', {'priorPointerAndSourceRestored': True, 'immutableVersionRetained': True, 'databaseTouched': False})


def publish():
    validate()
    backup()
    # Hold both publisher locks through baseline comparison, switch and verification.
    try:
        for name in M['changes']:
            atomic(ROOT / 'source' / name, LIVE / name)
        module = publisher()
        installed = {game: module.run(args('install', game)) for game in GAMES}
        after = snapshot()
        unchanged(after)
        require(after['source'] == {**OLD['source'], **M['changes']}, 'Published source differs')
        expected = dict(OLD['moduleFiles'])
        for game in GAMES:
            prefix = str(PUBLIC / game / 'versions' / M['games'][game]['version']) + '/'
            expected.update({prefix + name: digest for name, digest in M['games'][game]['files'].items()})
            expected[str(PUBLIC / game / 'active.json')] = installed[game]['activeSha256']
        require(after['moduleFiles'] == expected, 'Another module changed')
        write('after.json', after)
        result = {'published': True, 'release': NAME, 'sourceCommit': M['sourceCommit'],
                  'modules': installed, 'royalGamesPreserved': True, 'backup': str(BACKUP),
                  'runningImage': after['container']['image'], 'preparedImage': after['preparedImage'],
                  'containerRestarted': False, 'otherModulesPreserved': True, 'programsPreserved': True,
                  'settingsPreserved': True, 'otherServicesPreserved': True, 'databaseTouched': False}
        write('published.json', result)
        return result
    except BaseException:
        restore()
        raise


if __name__ == '__main__':
    require(len(sys.argv) == 2 and sys.argv[1] in ['check', 'publish'], 'Unknown operation')
    with (LIVE / '.client-presentation-deploy.lock').open('a') as shared, (STATE / 'module.lock').open('a') as module:
        fcntl.flock(shared, fcntl.LOCK_EX | fcntl.LOCK_NB)
        fcntl.flock(module, fcntl.LOCK_EX | fcntl.LOCK_NB)
        print(json.dumps(validate() if sys.argv[1] == 'check' else publish()))
