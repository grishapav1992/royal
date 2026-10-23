"""Replace the unpublished, incorrectly externalized bundle and complete this release."""
from pathlib import Path
import fcntl
import importlib.util
import json
import shutil
import subprocess
import time

ROOT = Path('/opt/royal-releases/pvp-usdt-20261023-v2')
EXPECTED_BUNDLE = '8575b7bfcb630bdbfb9d617f740a434e8fba0d56a9d3e651abe86148c92b0944'
spec = importlib.util.spec_from_file_location('release', ROOT / 'deploy.py')
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)

with open('/opt/royal-releases/themed-publish.lock', 'a+') as app, open('/opt/royal-game-modules-state/module.lock', 'a+') as modules:
    fcntl.flock(app, fcntl.LOCK_EX | fcntl.LOCK_NB)
    fcntl.flock(modules, fcntl.LOCK_EX | fcntl.LOCK_NB)
    r.validate_payload()
    built = json.loads((ROOT / 'build-result.json').read_text())
    assert r.source_inventory() == r.OLD['source'], 'Production source advanced; reconcile before publishing'
    assert r.inventory(r.MODULES) == r.OLD['moduleFiles'] and r.sha(r.HOST) == r.OLD['moduleHostContract']
    for name, digest in r.OLD['configHashes'].items():
        assert r.sha(r.LIVE / name) == digest
    for destination, row in r.M['extra']['files'].items():
        assert r.sha(destination) == r.sha(ROOT / 'finance-source' / row['source'])
    current = r.inspect('royal-nile-play')
    assert current['Image'] == built['financial']
    assert r.financial_profile(current) == built['financialProfile']
    assert r.sha(ROOT / 'play-corrected.js') == EXPECTED_BUNDLE
    r.run(['docker', 'tag', r.M['extra']['nileImage'], 'royal-nile-play:local'])
    compose = ['docker', 'compose', '-f', 'deployment/finance/compose.nile-play.yaml']
    r.run([*compose, 'up', '-d', '--no-deps', '--force-recreate', '--no-build', 'nile-play'], cwd='/opt/royal-finance')
    context = ROOT / 'financial-linked-context'
    context.mkdir(exist_ok=False)
    shutil.copyfile(ROOT / 'play-corrected.js', context / 'play.js')
    (context / 'Dockerfile').write_text(
        'FROM royal-game:before-' + r.NAME + '-prepared AS engines\n'
        'FROM royal-nile-play:before-' + r.NAME + '\n'
        'COPY --chown=node:node play.js /app/play.js\n'
        'COPY --from=engines /app/dist-server/card-engine /app/dist-server/card-engine-v1 /app/dist-server/\n'
        'LABEL org.opencontainers.image.revision="' + r.M['sourceCommit'] + '"\n')
    tag = 'royal-nile-play:' + r.NAME + '-linked'
    with (ROOT / 'financial-linked-build.log').open('w') as log:
        subprocess.run(['docker', 'build', '--pull=false', '-t', tag, '.'], cwd=context, check=True, stdout=log, stderr=subprocess.STDOUT)
    image = r.run(['docker', 'image', 'inspect', tag, '--format', '{{.Id}}'])
    r.run(['docker', 'tag', image, 'royal-nile-play:local'])
    # Import every dependency and audit the real journal read-only before switching.
    audit = json.loads(r.run([*compose, 'run', '-T', '--rm', '--no-deps', '--entrypoint', 'node', 'nile-play', 'play.js', 'audit'], cwd='/opt/royal-finance'))
    assert audit['ok'] and audit['testOnly']
    r.save('financial-link-audit.json', audit)
    shutil.copyfile(ROOT / 'build-result.json', ROOT / 'build-result-unlinked.json')
    shutil.copyfile(ROOT / 'install-manifest.json', ROOT / 'install-manifest-unlinked.json')
    r.atomic(ROOT / 'play-corrected.js', ROOT / 'play.js')
    r.M['financial'] = EXPECTED_BUNDLE
    r.M['payload']['play.js'] = EXPECTED_BUNDLE
    r.save('install-manifest.json', r.M)
    built['financial'] = image
    r.save('build-result.json', built)
    r.run([*compose, 'up', '-d', '--no-deps', '--force-recreate', '--no-build', 'nile-play'], cwd='/opt/royal-finance')
    assert r.financial_profile(r.inspect('royal-nile-play')) == built['financialProfile']
    r.run(['systemctl', 'start', '--no-block', 'royal-nile-reconcile.service'])
    deadline = time.monotonic() + 600
    while time.monotonic() < deadline:
        state = r.inspect('royal-nile-play')
        if state['State'].get('Health', {}).get('Status') == 'healthy':
            health = json.loads(r.run(['docker', 'exec', 'royal-nile-play', 'node', 'play.js', 'health']))
            if health['ok'] and health['ready']:
                r.save('finance-verification.json', health)
                print(json.dumps({'financialReady': True, 'image': image, 'auditOk': True}), flush=True)
                break
        time.sleep(10)
    else:
        raise RuntimeError('Financial service did not become ready; game remains unpublished')
    try:
        r.game()
    except BaseException:
        r.rollback()
        raise
