from pathlib import Path
import fcntl
import json
import os
import runpy
import subprocess
import sys
import time

ROOT = Path('/opt/royal-releases/nowpayments-sandbox-20261027-v1')
LOCKS = ['/opt/royal-releases/themed-publish.lock', '/opt/royal/.client-presentation-deploy.lock', '/opt/royal-game-modules-state/module.lock']


def locks_owned(pid):
    expected = {(os.major(os.stat(p).st_dev), os.minor(os.stat(p).st_dev), os.stat(p).st_ino) for p in LOCKS}
    observed = set()
    for line in Path('/proc/locks').read_text().splitlines():
        fields = line.split()
        if len(fields) >= 6 and fields[1] == 'FLOCK' and fields[3] == 'WRITE' and fields[4] == str(pid):
            major, minor, inode = fields[5].split(':')
            observed.add((int(major,16), int(minor,16), int(inode)))
    return expected.issubset(observed)


def game_id():
    for path in Path('/var/lib/docker/containers').glob('*/config.v2.json'):
        try:
            value = json.loads(path.read_text())
            if value.get('Name') == '/royal-game-1' and value['State'].get('Running'):
                return value['ID']
        except (FileNotFoundError,json.JSONDecodeError):
            pass
    return None


def run():
    if not __debug__:
        raise RuntimeError('Optimized Python would disable operational checks')
    runpy.run_path(str(ROOT/'deploy.py'), run_name='cosmic_payload_validation')['payload']()
    leases = []
    seen = set()
    def start(mode):
        path = ROOT / ('priority-' + mode + '-' + str(len(leases)) + '.log')
        with path.open('xb') as output:
            child = subprocess.Popen([sys.executable,str(ROOT/'publication-priority.py'),mode],
                stdin=subprocess.DEVNULL,stdout=output,stderr=subprocess.STDOUT,start_new_session=True)
        leases.append(child)
    publisher = subprocess.Popen([sys.executable,str(ROOT/'deploy.py'),'release'])
    (ROOT/'publisher-process.json').write_text(json.dumps({'pid':publisher.pid,'at':time.time()})+'\n')
    code = None
    try:
        while publisher.poll() is None and not locks_owned(publisher.pid):
            time.sleep(.1)
        if publisher.poll() is None:
            start('services')
            while publisher.poll() is None:
                identity = game_id()
                if identity and identity not in seen:
                    seen.add(identity)
                    start('game')
                time.sleep(1)
        code = publisher.wait()
    finally:
        owned = {p.pid for p in leases}
        for folder in ROOT.glob('priority-*'):
            plan = folder/'plan.json'
            if plan.is_file() and json.loads(plan.read_text())['parentPid'] in owned:
                (folder/'release-request').write_text('publication supervisor ended\n')
        pending = []
        for lease in leases:
            try:
                lease.wait(timeout=15)
            except subprocess.TimeoutExpired:
                pending.append(lease.pid)
        result = {'code':code,'finishedAt':time.time(),'priorityLeasePids':[p.pid for p in leases],
                  'priorityReleasePending':pending,'publisherPid':publisher.pid,'publisherStillRunning':publisher.poll() is None}
        (ROOT/'release-exit.json').write_text(json.dumps(result)+'\n')
        print(json.dumps(result),flush=True)
    raise SystemExit(code if code is not None else 1)


if __name__=='__main__':
    assert Path(__file__).resolve().parent == ROOT
    run()
