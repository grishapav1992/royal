"""Share only byte-identical immutable media while retaining every published version."""
from pathlib import Path, PurePosixPath
import hashlib
import json
import os
import shutil
import stat
import uuid


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def plain(root, name):
    relative = PurePosixPath(name)
    if str(relative) != name or relative.is_absolute() or any(part in ['..', '.'] for part in relative.parts):
        raise RuntimeError('Unsafe media path')
    path = root
    for part in relative.parts:
        path = path / part
        if path.is_symlink():
            raise RuntimeError('Media symlink rejected')
    if not path.is_file():
        raise RuntimeError('Media file missing')
    return path


def deduplicate(base, target):
    base, target = Path(base), Path(target)
    if base.is_symlink() or target.is_symlink() or base.resolve() == target.resolve():
        raise RuntimeError('Distinct regular version directories required')
    original = json.loads(plain(base, 'manifest.json').read_text())
    current = json.loads(plain(target, 'manifest.json').read_text())
    if original['gameId'] != current['gameId']:
        raise RuntimeError('Different games rejected')
    before = shutil.disk_usage(target).free
    candidates = []
    for name, digest in current['files'].items():
        if not name.startswith('media/') or original['files'].get(name) != digest:
            continue
        source, destination = plain(base, name), plain(target, name)
        if sha(source) != digest or sha(destination) != digest:
            raise RuntimeError('Media bytes differ from manifest')
        a, b = source.stat(), destination.stat()
        if (stat.S_IMODE(a.st_mode), a.st_uid, a.st_gid) != (stat.S_IMODE(b.st_mode), b.st_uid, b.st_gid):
            raise RuntimeError('Media ownership or permissions differ')
        if not os.path.samefile(source, destination):
            candidates.append((source, destination, b.st_size))
    linked = []
    for source, destination, size in candidates:
        temporary = destination.with_name('.dedup-' + uuid.uuid4().hex)
        try:
            os.link(source, temporary)
            os.replace(temporary, destination)
        finally:
            if temporary.exists():
                temporary.unlink()
        linked.append({'path': str(destination), 'bytes': size})
    if os.name == 'posix':
        for parent in {destination.parent for _, destination, _ in candidates}:
            descriptor = os.open(parent, os.O_RDONLY)
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
    return {'linked': linked, 'logicalDuplicateBytes': sum(row['bytes'] for row in linked),
            'freeBefore': before, 'freeAfter': shutil.disk_usage(target).free,
            'versionsAndBytesPreserved': True, 'physicalSpaceAttribution': 'Concurrent activity is not attributed to this operation'}
