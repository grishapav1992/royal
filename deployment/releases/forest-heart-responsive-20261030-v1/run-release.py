"""Keep the guarded publication running across an SSH disconnect."""
from pathlib import Path
import datetime
import fcntl
import hashlib
import json
import os
import subprocess
import sys

ROOT = Path('/opt/royal-releases/forest-heart-responsive-20261030-v1')


def main():
    if Path(__file__).resolve() != ROOT / 'run-release.py':
        raise RuntimeError('Unexpected runner path')
    with (ROOT / 'runner.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if any((ROOT / name).exists() for name in ['exit.json', 'published.json']):
            raise RuntimeError('Publication already completed or attempted')
        operator = json.loads((ROOT / 'operator.json').read_text())
        guard = ROOT / 'guard.py'
        if hashlib.sha256(guard.read_bytes()).hexdigest() != operator['guardSha256']:
            raise RuntimeError('Guard differs from reviewed operator')
        with (ROOT / 'publish.log').open('x') as log:
            result = subprocess.run([sys.executable, str(guard), 'publish'], cwd=ROOT,
                                    stdin=subprocess.DEVNULL, stdout=log,
                                    stderr=subprocess.STDOUT)
        record = {'exitCode': result.returncode,
                  'finishedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()}
        temporary = ROOT / 'exit.json.next'
        with temporary.open('x') as out:
            out.write(json.dumps(record) + '\n')
            out.flush()
            os.fsync(out.fileno())
        os.replace(temporary, ROOT / 'exit.json')
        print(json.dumps(record), flush=True)
        return result.returncode


if __name__ == '__main__':
    sys.exit(main())
