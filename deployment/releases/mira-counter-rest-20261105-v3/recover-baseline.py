"""Restore the reviewed source and image tag while the original game is still healthy."""
import hashlib
import importlib.util
import json
import sys
import tarfile
import tempfile
import time
from contextlib import ExitStack
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path('/opt/royal-releases/mira-counter-rest-20261105-v3')
INSTALL_MANIFEST = '0518cca069cbf3781f5a93fc98cac7e67de134c8b0a1bd1cba5c89f91c174e1e'


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def check_game(base):
    ids = base.run(['docker', 'ps', '-aq', '--no-trunc', '--filter', 'label=com.docker.compose.project=royal',
                    '--filter', 'label=com.docker.compose.service=game']).split()
    require(ids == [base.OLD['container']['id']], 'A replacement or additional game container exists')
    row = json.loads(base.run(['docker', 'container', 'inspect', ids[0]]))[0]
    expected = base.OLD['container']
    require(row['Name'] == '/royal-game-1' and row['Image'] == expected['image']
            and row['State']['StartedAt'] == expected['startedAt'] and row['State']['Running']
            and row['State']['Health']['Status'] == 'healthy', 'Original game lifecycle changed')


def main():
    require(ROOT.resolve(strict=True) == ROOT, 'Unexpected release root')
    raw = (ROOT / 'install-manifest.json').read_bytes()
    require(hashlib.sha256(raw).hexdigest() == INSTALL_MANIFEST, 'Unexpected failed package')
    manifest = json.loads(raw)
    helper = ROOT / 'deploy.py'
    require(not helper.is_symlink() and hashlib.sha256(helper.read_bytes()).hexdigest() == manifest['helperSha256'],
            'Installer changed')
    sys.path.insert(0, str(ROOT))
    spec = importlib.util.spec_from_file_location('mira_installer', helper)
    installer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(installer)
    base = installer.configure(ROOT)
    base.payload()
    with ExitStack() as guard:
        try:
            guard.enter_context(installer.publication_locks())
        except installer.PublicationBusy as error:
            print(str(error), file=sys.stderr)
            return 75
        base.payload()
        require(not any((ROOT / name).exists() for name in ['published.json','after.json','baseline-recovered.json']),
                'Recovery is only for the unsettled first attempt')
        failure = json.loads((ROOT / 'publication-failed.json').read_text())
        require(failure == {'errorType': 'GateError', 'reason': 'Supervised command deadline exceeded',
                            'daemonOutcomeUnknown': True, 'mutationStarted': True, 'databaseRestored': False},
                'Unexpected publication failure')
        built = json.loads((ROOT / 'build-result.json').read_text())
        require(built['program'] == base.expected_program() and built['sourceCommit'] == manifest['sourceCommit'],
                'Unreviewed candidate')
        check_game(base)
        current = base.snapshot()
        base.recovery_guard(current, built)
        require(current['container'] == base.OLD['container'], 'Only the original healthy game may stay in service')
        require(current['preparedImage'] in [built['image'], base.OLD['preparedImage']], 'A later tag prevents recovery')
        base.publication_backup(built)
        base.healthy()
        check_game(base)

        with tarfile.open(base.BACKUP / 'source.tgz') as archive, tempfile.TemporaryDirectory(dir=ROOT, prefix='baseline-restore-') as staging:
            for name, attempted in base.CHANGES.items():
                target = base.LIVE / name
                require(not target.is_symlink() and not any(parent.is_symlink() for parent in target.parents),
                        'Unexpected source path')
                actual = base.sha(target) if target.is_file() else None
                require(actual == current['source'].get(name), 'Source changed during recovery')
                if actual == base.BASE.get(name):
                    continue
                require(actual == attempted, 'A later source prevents recovery')
                if name in base.BASE:
                    restored = Path(staging) / name
                    restored.parent.mkdir(parents=True, exist_ok=True)
                    member = archive.getmember(name)
                    restored.write_bytes(archive.extractfile(member).read())
                    restored.chmod(member.mode)
                    base.atomic(restored, target)
                else:
                    target.unlink()

        if current['preparedImage'] != base.OLD['preparedImage']:
            base.run(['docker', 'tag', base.OLD['preparedImage'], 'royal-game:latest'], timeout=120)
        after = base.baseline()
        check_game(base)
        base.healthy()
        base.write('baseline-recovered.json', {'sourceCommit': after['sourceCommit'], 'runningImage': after['container']['image'],
                   'preparedImage': after['preparedImage'], 'containerId': after['container']['id'],
                   'sourceFiles': len(after['source']), 'programFiles': len(after['program']),
                   'moduleFiles': len(after['moduleFiles']), 'containerRestarted': False,
                   'databaseTouched': False, 'verifiedAt': time.time()})
        print((ROOT / 'baseline-recovered.json').read_text(), end='', flush=True)


if __name__ == '__main__':
    sys.exit(main())
