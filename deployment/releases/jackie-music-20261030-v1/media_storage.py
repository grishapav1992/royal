"""Share only byte-identical immutable media while retaining every published version."""
from pathlib import Path, PurePosixPath
import hashlib
import json
import os
import shutil
import stat
import uuid
import re


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


def materialize(package, destination, verify):
    """Verify and atomically retain the already uploaded bytes without a second media copy."""
    package, destination = Path(package), Path(destination)
    if not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+-[a-f0-9]{12}', destination.name):
        raise RuntimeError('Invalid immutable destination')
    destination = destination.parent.resolve(strict=True) / destination.name
    verify(package)
    if destination.exists():
        verify(destination)
        if sha(package / 'manifest.json') != sha(destination / 'manifest.json'):
            raise RuntimeError('Immutable version collision')
        return
    temporary = destination.parent / ('.pending-' + uuid.uuid4().hex)
    try:
        shutil.copytree(package, temporary, copy_function=os.link)
        verify(temporary)
        if os.name == 'posix':
            for path in temporary.rglob('*'):
                if path.is_file():
                    with path.open('rb') as handle:
                        os.fsync(handle.fileno())
            for directory in sorted([temporary, *[p for p in temporary.rglob('*') if p.is_dir()]], key=lambda p:len(p.parts), reverse=True):
                descriptor = os.open(directory, os.O_RDONLY)
                try:os.fsync(descriptor)
                finally:os.close(descriptor)
        temporary.rename(destination)
        if os.name == 'posix':
            descriptor = os.open(destination.parent, os.O_RDONLY)
            try:os.fsync(descriptor)
            finally:os.close(descriptor)
    finally:
        if temporary.exists():
            if temporary.is_symlink() or temporary.resolve().parent != destination.parent:
                raise RuntimeError('Temporary cleanup escaped immutable version root')
            shutil.rmtree(temporary)
