"""Remove only verified transport archives and the completed build context."""
from pathlib import Path
import fcntl
import hashlib
import json
import shutil
import subprocess

ROOT = Path('/opt/royal-releases/hall-elevator-20261101-v1')
COMMIT = '2683c223a46450c456079b487fc36cdfb4e6eade'
IMAGE = 'sha256:3ded1726150cfa09b786fcdacaed4c5ee1c48bac34d3007b00f6a1bc225e0cfc'
PRESERVED = '2d19e058da20b90959e7dacbe0d753b8aff00c6c'
ARCHIVES = {
    ROOT.parent / 'hall-elevator-20261101-v1.tgz': 'c760513d93ed1be923c3d887dc555be40da8bf2d8e04774a4ec253d100eb5dc4',
    ROOT.parent / 'hall-elevator-20261101-v1-final.tgz': 'd5606933fd0d71491f667fb02fba790eb5395e4a1ea12acb7086093bb2754f7e',
}


def require(value, reason):
    if not value:
        raise RuntimeError(reason)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(path):
    return json.loads(path.read_text())


def main():
    require(Path(__file__).resolve().parent == ROOT and ROOT.resolve() == ROOT, 'Unexpected cleanup root')
    locks = []
    for path in [ROOT.parent / 'themed-publish.lock', Path('/opt/royal/.client-presentation-deploy.lock'), Path('/opt/royal-game-modules-state/module.lock')]:
        require(not path.is_symlink(), 'Unsafe lock')
        lock = path.open('a')
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        locks.append(lock)
    manifest = read(ROOT / 'install-manifest.json')
    published = read(ROOT / 'published.json')
    built = read(ROOT / 'build-result.json')
    require(manifest['sourceCommit'] == published['sourceCommit'] == COMMIT and published['published'], 'Publication evidence differs')
    require(published['runningImage'] == built['image'] == IMAGE, 'Image evidence differs')
    maintenance = read(Path('/opt/royal-maintenance/last-result.json'))
    require(maintenance['status'] == 'completed' and maintenance['sourceCommit'] == COMMIT, 'Release maintenance is incomplete')
    game = json.loads(subprocess.check_output(['docker', 'inspect', 'royal-game-1']))[0]
    require(game['Image'] == IMAGE and game['State']['Health']['Status'] == 'healthy', 'Current application differs')
    backup = Path(built['backup']) / 'source.tgz'
    require(backup == Path('/opt/royal-backups/hall-elevator-20261101-v1/source.tgz') and not backup.is_symlink(), 'Unexpected backup')
    require(sha(backup) == built['sourceBackupSha256'], 'Rollback source archive differs')
    context = ROOT / 'runtime-context'
    rows = []
    if context.exists():
        require(context.resolve() == context and context.is_dir(), 'Unsafe context')
        entries = list(context.rglob('*'))
        require(not any(p.is_symlink() for p in entries), 'Context symlink rejected')
        files = {p.relative_to(context).as_posix(): p for p in entries if p.is_file()}
        expected = {'Dockerfile': 'fbad412abc6ded386eb7e775428dc69e2dec349b6b0ce704dbbf27a5757434b0', '.dockerignore': '7f5b69c74e1cc018660c7e2e483cd1a1c30b92f8e1656790d34a6056707b3830'}
        expected.update({'dist-delta/' + n: h for n, h in manifest['delta'].items()})
        expected.update({'server-delta/' + n: h for n, h in manifest['serverDelta'].items()})
        require(set(files) == set(expected), 'Unexpected context files')
        require(all(sha(files[n]) == h for n, h in expected.items()), 'Context bytes differ')
        rows.append({'path': str(context), 'logicalBytes': sum(p.stat().st_size for p in files.values()), 'directory': True})
    for path, digest in ARCHIVES.items():
        require(path.parent == ROOT.parent and path.resolve() == path, 'Unsafe archive path')
        if path.exists():
            require(path.is_file() and not path.is_symlink() and sha(path) == digest, 'Transport bytes differ')
            rows.append({'path': str(path), 'logicalBytes': path.stat().st_size, 'directory': False})
    free_before = shutil.disk_usage(ROOT).free
    require(free_before >= 5 * 1024**3, 'Low free disk space')
    for row in rows:
        path = Path(row['path'])
        if row['directory']:
            shutil.rmtree(path)
        else:
            path.unlink()
    report = {'status': 'completed', 'preservationCommit': PRESERVED, 'sourceCommit': COMMIT, 'removed': rows, 'logicalBytesRemoved': sum(r['logicalBytes'] for r in rows), 'freeBytesBefore': free_before, 'freeBytesAfter': shutil.disk_usage(ROOT).free, 'rollbackSourcePreserved': sha(backup) == built['sourceBackupSha256'], 'imageAndDataChanges': False, 'retained': ['source', 'dist-delta', 'server-delta', 'install-manifest.json', 'build-result.json', 'published.json'], 'cleanupCondition': 'Retain guarded rollback inputs until superseded by a verified compatible host release; financial and persistent data are outside this cleanup.'}
    (ROOT / 'cleanup.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))


if __name__ == '__main__':
    main()
