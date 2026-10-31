#!/usr/bin/env python3
"""Reconcile verified release evidence before every scheduled history cleanup."""
import argparse
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import sys
import time
import uuid

spec = importlib.util.spec_from_file_location('history_cleanup', Path(__file__).with_name('cleanup-release-history.py'))
cleanup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cleanup)


def select_release(image, source_commit, root=None):
    matches = []
    for path in (root or cleanup.RELEASES).glob('*/install-manifest.json'):
        try:
            manifest = cleanup.read(path)
            built = cleanup.read(path.parent / 'build-result.json')
            published = cleanup.read(path.parent / 'published.json')
        except (OSError, ValueError):
            continue
        if (manifest.get('release') == path.parent.name and manifest.get('sourceCommit') == source_commit
                and built.get('sourceCommit') == source_commit and built.get('image') == image
                and published.get('sourceCommit') == source_commit and published.get('published') is True
                and published.get('runningImage', published.get('image')) == image
                and isinstance(manifest.get('before', {}).get('source'), dict) and built.get('program')):
            matches.append(path.parent.name)
    cleanup.require(len(matches) == 1, 'Running image needs one complete host release proof; found ' + str(len(matches)))
    return matches[0]


def rotate_audits(root, current):
    allowed = {'plan.json', 'result.json', 'summary.json', 'progress.json', 'image-progress.json', 'policy-before.json'}
    finished = sorted((p for p in root.glob('run-*') if p.is_dir() and not p.is_symlink()
                       and (p / 'summary.json').is_file()), key=lambda p: p.stat().st_mtime, reverse=True)
    history = root / 'history'; history.mkdir(exist_ok=True)
    for path in finished[2:]:
        if path == current or not re.fullmatch(r'run-[a-f0-9]{32}', path.name): continue
        children = list(path.iterdir())
        cleanup.require(all(p.name in allowed and p.is_file() and not p.is_symlink() for p in children), 'Unknown audit contents preserved')
        cleanup.write(history / (path.name + '.json'), cleanup.read(path / 'summary.json'))
        shutil.rmtree(path)
    summaries = sorted(history.glob('run-*.json'), key=lambda p: p.stat().st_mtime, reverse=True)
    for path in summaries[24:]:
        if path.is_file() and not path.is_symlink(): path.unlink()


def execute(root, last_result):
    cleanup.require(os.geteuid() == 0, 'Run as the deployment operator')
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    state = root / ('run-' + uuid.uuid4().hex); state.mkdir(mode=0o700)
    started = time.time(); locks = []
    result = {'startedAt': started, 'status': 'error', 'freeBefore': shutil.disk_usage(cleanup.LIVE).free}
    code = 1
    try:
        for path in [cleanup.RELEASES / 'themed-publish.lock', cleanup.LIVE / '.client-presentation-deploy.lock', cleanup.MODULE_STATE / 'module.lock']:
            cleanup.require(not path.is_symlink(), 'Unsafe deployment lock')
            lock = path.open('a'); locks.append(lock)
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        game = cleanup.healthy()
        source = game['Config'].get('Labels', {}).get('org.opencontainers.image.revision')
        release = select_release(game['Image'], source)
        plan = cleanup.prepare_plan(release)
        cleanup.write(state / 'plan.json', plan)
        result.update({'release': release, 'sourceCommit': source, 'currentImage': plan['currentImage'],
                       'rollbackImage': plan['rollbackImage'], 'plannedEntries': len(plan['entries']),
                       'plannedImages': len(plan['images']), 'preservedFinancialFiles': len(plan['preservedFinancialFiles']),
                       'retainedHistoryReasons': plan['retainedHistoryReasons']})
        applied = cleanup.apply(plan, state)
        result.update({k: applied[k] for k in ['removedEntries', 'removedImageTags', 'dockerRetainedImages', 'freeAfter', 'containersUnchanged', 'healthOk']})
        cleanup.require(result['freeAfter'] >= 5 * 1024**3, 'Cleanup completed but free space remains below five GiB; inspect retained data')
        result['status'] = 'completed'; code = 0
    except BlockingIOError:
        result.update({'status': 'retry', 'reason': 'Deployment lock busy; systemd retries in five minutes'}); code = 75
    except Exception as error:
        result['reason'] = str(error)
    finally:
        result.update({'finishedAt': time.time(), 'durationSeconds': round(time.time() - started, 2),
                       'freeAfter': shutil.disk_usage(cleanup.LIVE).free})
        cleanup.write(state / 'summary.json', result)
        cleanup.write(last_result, result)
        for lock in reversed(locks): lock.close()
    rotate_audits(root, state)
    return code, result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--state-root', type=Path, default=Path('/opt/royal-maintenance/automatic-runs'))
    parser.add_argument('--result', type=Path, default=Path('/opt/royal-maintenance/last-result.json'))
    args = parser.parse_args()
    code, result = execute(args.state_root, args.result)
    print(json.dumps(result), flush=True)
    raise SystemExit(code)


if __name__ == '__main__': main()
