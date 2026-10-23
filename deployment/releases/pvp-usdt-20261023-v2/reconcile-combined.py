"""Reconcile reviewed artifacts with the independently published lounge and GirlHUB."""
from pathlib import Path
import fcntl
import hashlib
import importlib.util
import json
import shutil
import subprocess
import tarfile
import time

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('release', ROOT / 'deploy.py')
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
candidate = json.loads((ROOT / 'combined-install-manifest.json').read_text())
reuse = json.loads((ROOT / 'combined-reuse.json').read_text())

with open('/opt/royal-releases/themed-publish.lock', 'a+') as app, open('/opt/royal-game-modules-state/module.lock', 'a+') as modules:
    fcntl.flock(app, fcntl.LOCK_EX | fcntl.LOCK_NB)
    fcntl.flock(modules, fcntl.LOCK_EX | fcntl.LOCK_NB)
    before = candidate['before']
    assert r.source_inventory() == before['source'], 'Production source advanced again'
    assert r.inventory(r.MODULES) == before['moduleFiles'] and r.sha(r.HOST) == before['moduleHostContract']
    assert r.inspect('royal-game-1')['Image'] == before['container']['image']
    assert r.inspect('royal-game-1')['State']['Health']['Status'] == 'healthy'
    for name, digest in before['configHashes'].items(): assert r.sha(r.LIVE / name) == digest
    built = json.loads((ROOT / 'build-result.json').read_text())
    assert r.inspect('royal-nile-play')['Image'] == built['financial']
    assert r.financial_profile(r.inspect('royal-nile-play')) == built['financialProfile']
    database = r.inspect('royal-finance-sim-finance-db-1')
    db_config = Path('/opt/royal-finance/compose.finance.yaml')
    assert r.sha(db_config) == '5576ad8154f62815185f3bece5c1ec3de0135f5c02c53be4d01f6c232769e6ae'
    expected_config = db_config.read_text().replace('    mem_limit: 512m\n    cpus: 0.75\n', '    mem_limit: 1280m\n    cpus: 2\n', 1)
    assert expected_config == (ROOT / 'database-cache-compose.yaml').read_text()
    available = next(int(line.split()[1]) * 1024 for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemAvailable:'))
    assert available >= 1024**3, 'Insufficient memory headroom for the journal cache'
    shutil.copyfile(db_config, ROOT / 'database-cache-compose-before.yaml')
    r.run(['docker', 'update', '--memory', '1280m', '--memory-swap', '2560m', '--cpus', '2', 'royal-finance-sim-finance-db-1'])
    updated_database = r.inspect('royal-finance-sim-finance-db-1')
    assert database['Id'] == updated_database['Id'] and database['State']['StartedAt'] == updated_database['State']['StartedAt']
    assert database['Config'] == updated_database['Config'] and database['Mounts'] == updated_database['Mounts']
    old_host, new_host = dict(database['HostConfig']), dict(updated_database['HostConfig'])
    for key in ['Memory', 'MemorySwap', 'NanoCpus']:
        old_host.pop(key); new_host.pop(key)
    assert old_host == new_host
    r.atomic(ROOT / 'database-cache-compose.yaml', db_config)
    assert r.sha(r.LIVE / 'compose.finance.yaml') == '5576ad8154f62815185f3bece5c1ec3de0135f5c02c53be4d01f6c232769e6ae'
    r.atomic(ROOT / 'database-cache-compose.yaml', r.LIVE / 'compose.finance.yaml')
    r.save('database-cache-verification.json', {'sameContainer': True, 'restarted': False, 'mountsPreserved': True,
        'memoryBytes': updated_database['HostConfig']['Memory'], 'nanoCpus': updated_database['HostConfig']['NanoCpus'],
        'sourceSha256': r.sha(db_config), 'availableBytesBefore': available})
    temporary = ROOT / 'combined-materialized'
    temporary.mkdir(exist_ok=True)
    for file in temporary.rglob('*'):
        if file.is_file(): assert r.sha(file) == candidate['payload'][file.relative_to(temporary).as_posix()]
    with tarfile.open(ROOT / 'combined-delta.tgz') as archive:
        for member in archive:
            assert member.isfile() and member.name in candidate['payload']
            assert not Path(member.name).is_absolute() and '..' not in Path(member.name).parts
            data = archive.extractfile(member).read()
            assert hashlib.sha256(data).hexdigest() == candidate['payload'][member.name]
            destination = temporary / member.name
            if destination.exists():
                assert r.sha(destination) == candidate['payload'][member.name]
                continue
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(data)
    pending = dict(reuse)
    while pending:
        progressed = False
        for target, source in list(pending.items()):
            assert target in candidate['payload'] and not Path(target).is_absolute() and '..' not in Path(target).parts
            choices = [Path(source)] if Path(source).is_absolute() else [temporary / source, ROOT / source]
            source = next((p for p in choices if p.is_file() and not p.is_symlink() and r.sha(p) == candidate['payload'][target]), None)
            if source is None: continue
            destination = temporary / target
            destination.parent.mkdir(parents=True, exist_ok=True)
            if source != destination: shutil.copyfile(source, destination)
            del pending[target]
            progressed = True
        assert progressed, 'Unresolved content references: ' + str(list(pending)[:3])
    for file in temporary.rglob('*'):
        if file.is_file(): r.atomic(file, ROOT / file.relative_to(temporary))
    for name, digest in candidate['payload'].items(): assert r.sha(ROOT / name) == digest, name
    r.BACKUP.joinpath('initial').mkdir(exist_ok=False)
    for name in ['source.tgz', 'index.html', 'host.json']:
        shutil.copyfile(r.BACKUP / name, r.BACKUP / 'initial' / name)
    shutil.copytree(r.BACKUP / 'pointers', r.BACKUP / 'initial' / 'pointers')
    with tarfile.open(r.BACKUP / 'source.tgz', 'w:gz') as archive:
        for name, digest in before['source'].items():
            assert r.sha(r.LIVE / name) == digest
            archive.add(r.LIVE / name, arcname=name, recursive=False)
    with tarfile.open(r.BACKUP / 'source.tgz') as archive:
        assert {m.name: hashlib.sha256(archive.extractfile(m).read()).hexdigest() for m in archive} == before['source']
    r.run(['docker', 'cp', 'royal-game-1:/app/dist/index.html', str(r.BACKUP / 'index.html')])
    for name in candidate['pointers']:
        shutil.copyfile(name, r.BACKUP / 'pointers' / Path(name).parent.name / 'active.json')
    shutil.copyfile(ROOT / 'install-manifest.json', ROOT / 'install-manifest-before-combined.json')
    r.save('install-manifest.json', candidate)
    r.M = candidate
    r.OLD = before
    r.validate_payload()
    context = ROOT / 'game-combined-context'
    context.mkdir(exist_ok=False)
    for directory in ['dist-delta', 'server-delta', 'module-delta']:
        shutil.copytree(ROOT / directory, context / directory)
    for name in candidate['packages']: shutil.copyfile(ROOT / 'source' / name, context / name)
    (context / 'Dockerfile').write_text(
        'FROM royal-game:pvp-usdt-20261023-v2\n'
        'COPY --chown=node:node dist-delta/ /app/dist/\n'
        'COPY --chown=node:node server-delta/index.js /app/dist-server/index.js\n'
        'COPY --chown=node:node module-delta/ /app/module-dist/\n'
        'COPY --chown=node:node package.json package-lock.json /app/\n'
        'LABEL org.opencontainers.image.revision="' + candidate['sourceCommit'] + '"\n')
    tag = 'royal-game:pvp-usdt-20261023-v2-combined'
    with (ROOT / 'game-combined-build.log').open('w') as log:
        subprocess.run(['docker', 'build', '--pull=false', '-t', tag, '.'], cwd=context, check=True, stdout=log, stderr=subprocess.STDOUT)
    image = r.run(['docker', 'image', 'inspect', tag, '--format', '{{.Id}}'])
    built.update(game=image, sourceCommit=candidate['sourceCommit'], sourceBackupSha256=r.sha(r.BACKUP / 'source.tgz'))
    r.save('build-result.json', built)
    r.run(['docker', 'tag', before['preparedImage'], 'royal-game:before-pvp-usdt-20261023-v2-combined'])
    print(json.dumps({'combinedImage': image, 'sourceCommit': candidate['sourceCommit'], 'gameStillUnpublished': True}), flush=True)
    deadline = time.monotonic() + 600
    observations = []
    while time.monotonic() < deadline:
        state = r.inspect('royal-nile-play')
        if state['State'].get('Health', {}).get('Status') == 'healthy':
            health = json.loads(r.run(['docker', 'exec', '-e', 'UV_THREADPOOL_SIZE=1', 'royal-nile-play', 'node', '--v8-pool-size=1', 'play.js', 'health']))
            if health['ok'] and health['ready']:
                observations.append({'at': time.time(), **health})
                if len(observations) >= 3 and observations[-1]['at'] - observations[0]['at'] >= 120:
                    r.save('finance-verification.json', {'ok': True, 'observations': observations})
                    break
            else: observations = []
        else: observations = []
        time.sleep(35)
    else: raise RuntimeError('Financial readiness is not sustained; game remains unpublished')
    try: r.game()
    except BaseException:
        r.rollback()
        raise
