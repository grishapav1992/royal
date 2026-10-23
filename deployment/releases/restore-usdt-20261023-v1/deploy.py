"""Guarded financial-only publication. Never restores or edits player data."""
from pathlib import Path
import fcntl
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tarfile
import time
from snapshot import snapshot, inspect, profile

ROOT = Path(__file__).resolve().parent
LIVE = Path('/opt/royal')
FINANCE = Path('/opt/royal-finance')
NAME = 'restore-usdt-20261023-v1'
BACKUP = Path('/opt/royal-backups') / NAME
M = json.loads((ROOT / 'manifest.json').read_text())
sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()
canonical = lambda p: hashlib.sha256(Path(p).read_bytes().replace(b'\r\n', b'\n')).hexdigest()
run = lambda args, **kw: subprocess.check_output(args, text=True, **kw).strip()
save = lambda name, value: (ROOT / name).write_text(json.dumps(value, indent=2) + '\n')


def source_guard(expected):
    for folder, rows in expected.items():
        for name, digest in rows.items():
            path = Path(folder) / name
            assert (not path.exists()) if digest is None else canonical(path) == digest, name


def atomic(source, target):
    assert not target.is_symlink()
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_name(target.name + '.usdt-partial')
    assert not partial.exists()
    shutil.copyfile(source, partial)
    os.replace(partial, target)


if sys.argv[1] == 'baseline':
    assert not (ROOT / 'baseline.json').exists()
    rows = {}
    for folder in [LIVE, FINANCE]:
        rows[str(folder)] = {}
        for name, digest in M['inputs'].items():
            path = folder / name
            actual = canonical(path) if path.exists() else None
            expected = M['retainedFinanceInputs'].get(name, digest) if folder == FINANCE else digest
            assert actual == expected or name in M['source'], 'Unrelated input differs: ' + name
            rows[str(folder)][name] = actual
    before = snapshot()
    assert run(['docker', 'exec', 'royal-nile-play', 'node', '-p', 'require("pg/package.json").version']) == '8.23.1'
    save('baseline.json', {'source': rows, 'playImage': before['containers']['royal-nile-play']['image'],
        'reconcileImage': run(['docker', 'image', 'inspect', 'royal-nile-reconcile:local', '--format', '{{.Id}}'])})
    print(json.dumps({'baselineVerified': True, 'inputCount': len(M['inputs'])}))
    sys.exit(0)

assert sys.argv[1] == 'install'
baseline = json.loads((ROOT / 'baseline.json').read_text())
with open('/opt/royal-releases/themed-publish.lock', 'a+') as app, open('/opt/royal/.client-presentation-deploy.lock', 'a+') as client, open('/opt/royal-game-modules-state/module.lock', 'a+') as modules:
    for lock in [app, client, modules]: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    phase = 'guard'
    try:
        free_before = shutil.disk_usage(LIVE).free
        assert free_before > 6 * 1024**3, 'Need 5 GiB reserve and 1 GiB publication budget'
        for name, digest in M['payload'].items(): assert sha(ROOT / name) == digest, name
        source_guard(baseline['source'])
        before = snapshot()
        assert before['containers']['royal-nile-play']['image'] == baseline['playImage']
        assert run(['docker', 'image', 'inspect', 'royal-nile-reconcile:local', '--format', '{{.Id}}']) == baseline['reconcileImage']
        assert before['containers']['royal-game-1']['health'] == 'healthy'
        persistent = {n: r['id'] for n, r in before['containers'].items() if n != 'royal-nile-play' and inspect(n)['HostConfig']['RestartPolicy']['Name'] in ['always', 'unless-stopped']}
        save('before.json', before)
        phase = 'backup'
        BACKUP.mkdir(mode=0o700, exist_ok=False)
        with tarfile.open(BACKUP / 'source.tgz', 'w:gz') as archive:
            for label, folder, rows in [('game', LIVE, before['source']), ('finance', FINANCE, before['financeSource'])]:
                for name in rows: archive.add(folder / name, arcname=label + '/' + name, recursive=False)
        with tarfile.open(BACKUP / 'source.tgz') as archive:
            for label, rows in [('game', before['source']), ('finance', before['financeSource'])]:
                for name, row in rows.items():
                    assert hashlib.sha256(archive.extractfile(label + '/' + name).read()).hexdigest() == row['sha256']
        (BACKUP / 'manifest.json').write_text(json.dumps({'source': before['source'], 'financeSource': before['financeSource'], 'sha256': sha(BACKUP / 'source.tgz')}))
        for service, image in [('play', baseline['playImage']), ('reconcile', baseline['reconcileImage'])]:
            run(['docker', 'tag', image, 'royal-nile-' + service + ':before-' + NAME])
        phase = 'build'
        images = {}
        for service, bundle, target in [('play', 'nile-play.js', 'play.js'), ('reconcile', 'nile-reconcile.js', 'reconcile.js')]:
            context = ROOT / ('context-' + service)
            context.mkdir(exist_ok=False)
            shutil.copyfile(ROOT / bundle, context / target)
            (context / 'Dockerfile').write_text('FROM royal-nile-' + service + ':before-' + NAME + '\nCOPY --chown=node:node ' + target + ' /app/' + target + '\nLABEL org.opencontainers.image.revision="' + M['sourceCommit'] + '"\n')
            tag = 'royal-nile-' + service + ':' + NAME
            with (ROOT / (service + '-build.log')).open('w') as log:
                subprocess.run(['docker', 'build', '--pull=false', '-t', tag, '.'], cwd=context, stdout=log, stderr=subprocess.STDOUT, check=True)
            images[service] = run(['docker', 'image', 'inspect', tag, '--format', '{{.Id}}'])
        source_guard(baseline['source'])
        now = snapshot()
        for key in ['source', 'financeSource', 'program', 'preparedProgram', 'preparedImage', 'modules', 'hostContract', 'configuration']:
            assert now[key] == before[key], key
        phase = 'install'
        for name in M['source']:
            for folder in [LIVE, FINANCE]: atomic(ROOT / 'source' / name, folder / name)
        for service in ['play', 'reconcile']: run(['docker', 'tag', images[service], 'royal-nile-' + service + ':local'])
        compose = before['containers']['royal-nile-play']['composeFiles']
        run(['docker', 'compose', *[v for n in compose for v in ['-f', n]], 'up', '-d', '--no-deps', '--no-build', '--force-recreate', 'nile-play'], cwd=FINANCE)
        assert profile(inspect('royal-nile-play')) == before['containers']['royal-nile-play']['profile']
        # Restart only the read-only one-shot verifier to use the corrected image.
        run(['systemctl', 'stop', 'royal-nile-reconcile.service'])
        if 'royal-nile-reconcile-once' in run(['docker', 'ps', '--format', '{{.Names}}']).splitlines():
            run(['docker', 'stop', '--time', '10', 'royal-nile-reconcile-once'])
        run(['systemctl', 'start', '--no-block', 'royal-nile-reconcile.service'])
        after = snapshot()
        for key in ['program', 'preparedProgram', 'preparedImage', 'modules', 'hostContract', 'configuration']:
            assert after[key] == before[key], key
        for name, identifier in persistent.items(): assert inspect(name)['Id'] == identifier, name
        for key in ['source', 'financeSource']:
            expected = {n: r['sha256'] for n, r in before[key].items()}
            expected.update(M['source'])
            assert {n: r['sha256'] for n, r in after[key].items()} == expected, key
        result = {'installed': True, 'sourceCommit': M['sourceCommit'], 'images': images,
            'hostPreserved': True, 'configurationPreserved': True, 'playerDataChanged': False,
            'backup': str(BACKUP), 'backupBytes': (BACKUP / 'source.tgz').stat().st_size,
            'freeBytesBefore': free_before, 'freeBytesAfter': shutil.disk_usage(LIVE).free}
        save('installed.json', result)
        print(json.dumps(result), flush=True)
    except BaseException as error:
        save('failure.json', {'phase': phase, 'type': type(error).__name__, 'reason': str(error)})
        raise
