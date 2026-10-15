#!/usr/bin/env python3
"""Refresh explicitly approved Markdown references without changing candidate code."""
import argparse
import json
import os
import re
import shutil
import stat
from pathlib import Path


def checked_path(root, relative):
    if not re.fullmatch(r'[A-Za-z0-9_.\-/]+\.md', relative):
        raise ValueError('Knowledge reference must be a relative Markdown path')
    parts = relative.split('/')
    if any(part in ('', '.', '..') or re.search(
            r'^\.(env|git|codex|agents|aws)|secret|credential|private.*key', part, re.I)
           for part in parts):
        raise ValueError('Knowledge reference contains a forbidden path component')
    path = root
    for part in parts:
        path = path / part
        if path.is_symlink():
            raise ValueError('Knowledge references cannot use symbolic links')
    if path.exists():
        info = path.stat()
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise ValueError('Knowledge reference must be a regular file with one link')
        if info.st_size > 128 * 1024:
            raise ValueError('Knowledge reference exceeds the document size limit')
    return path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', default=str(Path(__file__).parent.parent / 'project-knowledge/references'))
    parser.add_argument('--target', default='/opt/royal-ai-project')
    parser.add_argument('--manifest', default=str(Path(__file__).parent.parent / 'project-knowledge/manifest.json'))
    args = parser.parse_args()
    source, target = Path(args.source), Path(args.target)
    for root in (source, target):
        if root.is_symlink() or not root.is_dir() or root.resolve() != root.absolute():
            raise ValueError('Knowledge source and target must be real directories')
    manifest = json.loads(Path(args.manifest).read_text())
    references = manifest['documents']
    if not isinstance(references, list) or len(references) > 32 or len(set(references)) != len(references):
        raise ValueError('Invalid knowledge reference list')
    copied, missing = [], []
    for reference in references:
        origin, destination = checked_path(source, reference), checked_path(target, reference)
        if not origin.exists():
            # Do not retain a reference from an older, now absent source.
            if destination.exists():
                destination.unlink()
            missing.append(reference)
            continue
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_name(destination.name + '.knowledge-tmp')
        if temporary.exists() or temporary.is_symlink():
            raise ValueError('Unexpected temporary knowledge file')
        try:
            shutil.copyfile(origin, temporary)
            temporary.chmod(0o640)
            if os.geteuid() == 0:
                os.chown(temporary, 0, 1000)
                for parent in destination.parents:
                    if parent == target:
                        break
                    os.chown(parent, 0, 1000)
                    parent.chmod(0o750)
            temporary.replace(destination)
        finally:
            if temporary.exists():
                temporary.unlink()
        copied.append(reference)
    print(json.dumps({'version': manifest['version'], 'copied': copied, 'missing': missing}))


if __name__ == '__main__':
    main()
