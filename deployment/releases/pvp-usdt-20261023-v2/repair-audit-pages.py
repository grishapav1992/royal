"""Upgrade only the financial audit reader, preserving its complete validation."""
from pathlib import Path
import fcntl
import importlib.util
import json
import shutil
import subprocess

ROOT = Path(__file__).resolve().parent
REVISION = 'd564712c6a34e0020c727b716c6c4f26f3ec3285'
BUNDLE = '2d3aab959ce12ed26be83269b6e502de0a913c3368aee309bf6c876af1591b21'
spec = importlib.util.spec_from_file_location('release', ROOT / 'deploy.py')
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)

with open('/opt/royal-releases/themed-publish.lock', 'a+') as app, open('/opt/royal-game-modules-state/module.lock', 'a+') as modules:
    fcntl.flock(app, fcntl.LOCK_EX | fcntl.LOCK_NB)
    fcntl.flock(modules, fcntl.LOCK_EX | fcntl.LOCK_NB)
    built = json.loads((ROOT / 'build-result.json').read_text())
    current = r.inspect('royal-nile-play')
    assert current['Image'] == built['financial']
    assert r.financial_profile(current) == built['financialProfile']
    assert r.sha(ROOT / 'play-audit-pages.js') == BUNDLE
    context = ROOT / 'financial-audit-context'
    context.mkdir(exist_ok=False)
    shutil.copyfile(ROOT / 'play-audit-pages.js', context / 'play.js')
    shutil.copyfile(ROOT / 'source-audit.js', context / 'source-audit.js')
    (context / 'Dockerfile').write_text(
        'FROM royal-nile-play:pvp-usdt-20261023-v2-linked\n'
        'COPY --chown=node:node play.js source-audit.js /app/\n'
        'LABEL org.opencontainers.image.revision="' + REVISION + '"\n')
    tag = 'royal-nile-play:pvp-usdt-20261023-v2-audit'
    with (ROOT / 'financial-audit-build.log').open('w') as log:
        subprocess.run(['docker', 'build', '--pull=false', '-t', tag, '.'], cwd=context, check=True, stdout=log, stderr=subprocess.STDOUT)
    image = r.run(['docker', 'image', 'inspect', tag, '--format', '{{.Id}}'])
    r.run(['docker', 'run', '--rm', '--network=none', '--read-only', '--entrypoint', 'node', image, '--check', '/app/play.js'])
    shutil.copyfile(ROOT / 'build-result.json', ROOT / 'build-result-before-audit-pages.json')
    shutil.copyfile(ROOT / 'install-manifest.json', ROOT / 'install-manifest-before-audit-pages.json')
    r.atomic(ROOT / 'play-audit-pages.js', ROOT / 'play.js')
    r.M['financial'] = BUNDLE
    r.M['financialSourceCommit'] = REVISION
    r.M['payload']['play.js'] = BUNDLE
    r.M['payload']['deploy.py'] = r.sha(ROOT / 'deploy.py')
    r.save('install-manifest.json', r.M)
    built.update(financial=image, financialSourceCommit=REVISION)
    r.save('build-result.json', built)
    r.run(['docker', 'tag', image, 'royal-nile-play:local'])
    r.run(['docker', 'compose', '-f', 'deployment/finance/compose.nile-play.yaml', 'up', '-d', '--no-deps', '--force-recreate', '--no-build', 'nile-play'], cwd='/opt/royal-finance')
    assert r.financial_profile(r.inspect('royal-nile-play')) == built['financialProfile']
    r.run(['systemctl', 'start', '--no-block', 'royal-nile-reconcile.service'])
    print(json.dumps({'financialImage': image, 'sourceCommit': REVISION, 'gameUnchanged': True}), flush=True)
