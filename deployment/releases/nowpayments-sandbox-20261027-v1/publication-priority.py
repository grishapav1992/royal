"""Bounded CPU leases for this isolated payment publication; no financial services."""
from pathlib import Path
import json
import hashlib
import os
import re
import runpy
import secrets
import subprocess
import sys
import time

ROOT = Path('/opt/royal-releases/nowpayments-sandbox-20261027-v1')
PROC = Path('/proc')
CGROUP = Path('/sys/fs/cgroup')
DOCKER = Path('/var/lib/docker/containers')
HERE = Path(__file__).resolve().parent
if not __debug__:
    raise RuntimeError('Optimized Python would disable operational checks')
core = runpy.run_path(str(HERE / 'cpu-priority-release-v3.py'), run_name='combat_priority_core')


def checked_rows(mode):
    if mode == 'services':
        processes = [(2877, 'dockerd', '/system.slice/docker.service', 100),
                     (122534, 'containerd', '/system.slice/containerd.service', 100)]
    elif mode == 'game':
        manifest = json.loads((ROOT / 'install-manifest.json').read_text())
        assert manifest['release'] == ROOT.name
        assert manifest['modulePackages'] == [] and manifest['moduleDelta'] == {}
        assert re.fullmatch('[a-f0-9]{40}', manifest['sourceCommit'])
        proof_bytes = (ROOT/'helpers-source.json').read_bytes()
        assert hashlib.sha256(proof_bytes).hexdigest() == manifest['helperProofSha256']
        proof = json.loads(proof_bytes)
        assert proof['applicationSourceCommit'] == manifest['sourceCommit']
        assert proof['sourceCommit'] == manifest['helperSourceCommit']
        allowed = {manifest['before']['container']['image']}
        built = ROOT / 'build-result.json'
        if built.exists():
            candidate = json.loads(built.read_text())
            assert candidate['sourceCommit'] == manifest['sourceCommit']
            allowed.add(candidate['image'])
        games = [json.loads(p.read_text()) for p in DOCKER.glob('*/config.v2.json')]
        games = [v for v in games if v.get('Name') == '/royal-game-1' and v['State'].get('Running')]
        assert len(games) == 1
        game = games[0]
        assert re.fullmatch('[a-f0-9]{64}', game['ID']) and game['Image'] in allowed
        assert manifest['before']['container']['host']['CpuShares'] == 8192
        processes = [(game['State']['Pid'], 'docker-init', '/system.slice/docker-' + game['ID'] + '.scope', 532)]
    else:
        raise ValueError('Unsupported priority scope')
    rows = []
    for pid, name, expected, original in processes:
        process = PROC / str(pid)
        assert (process / 'comm').read_text().strip() == name
        group = (process / 'cgroup').read_text().strip().split(':')[-1]
        assert group == expected
        path = CGROUP / group.lstrip('/') / 'cpu.weight'
        assert not path.is_symlink() and int(path.read_text()) == original
        st = path.stat()
        rows.append({'path': str(path), 'old': original, 'target': 3023, 'device': st.st_dev, 'inode': st.st_ino})
    return rows


def hold(mode):
    rows = checked_rows(mode)
    folder = ROOT / ('priority-' + mode + '-' + secrets.token_hex(6))
    folder.mkdir(mode=0o700)
    plan = {'rows': rows, 'parentPid': os.getpid(), 'parentStartTicks': core['start_ticks'](os.getpid()),
            'createdAt': time.time(), 'hardDeadlineMonotonic': time.monotonic() + 1800, 'nonce': secrets.token_hex(16)}
    core['write_json'](folder / 'plan.json', plan)
    watch = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), 'watchdog', str(folder)],
                             stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    try:
        until = time.monotonic() + 10
        while not (folder / 'ready.json').exists():
            if watch.poll() is not None or time.monotonic() >= until:
                raise RuntimeError('Restore watchdog did not become ready')
            time.sleep(.05)
        assert json.loads((folder / 'ready.json').read_text())['nonce'] == plan['nonce']
        core['activate_if_live'](folder, plan, watch)
        core['write_json'](folder / 'active.json', {'mode': mode, 'pid': os.getpid(), 'rows': rows, 'at': time.time()})
        print(json.dumps({'active': True, 'folder': str(folder), 'mode': mode}), flush=True)
        while time.monotonic() < plan['hardDeadlineMonotonic'] - 2 and not (folder / 'release-request').exists():
            if mode == 'game' and not Path(rows[0]['path']).exists():
                break
            time.sleep(.5)
    finally:
        result = core['cancel_and_restore'](folder, plan, 'result.json')
        (folder / 'finish').write_text('restoration attempted\n')
        try:
            watch.wait(timeout=3)
        except subprocess.TimeoutExpired:
            result['watchdogAwaitingOwnExit'] = True
        print(json.dumps(result), flush=True)


if __name__ == '__main__':
    if len(sys.argv) == 2 and sys.argv[1] in ['services', 'game']:
        hold(sys.argv[1])
    elif len(sys.argv) == 3 and sys.argv[1] == 'watchdog':
        folder = Path(sys.argv[2])
        assert folder.parent == ROOT and re.fullmatch('priority-(services|game)-[a-f0-9]{12}', folder.name)
        core['watchdog'](folder)
    else:
        raise SystemExit('Unsupported Cosmic publication operation')
