"""Update the read-only consumers to the already qualified complete source audit."""
from pathlib import Path
import fcntl
import hashlib
import json
import re
import shutil
import subprocess
import time

ROOT = Path(__file__).resolve().parent
REVISION = '5d97773ef73d353b51dbd7f1b575dfd243e8fdf6'
sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()
run = lambda args: subprocess.check_output(args, text=True).strip()
bundles = {'reconcile-updated.js': 'a8167ee9d8b7f9820fef1361b55cad3ae929486ee2fd2517a85c580b276e2f77',
    'proof-updated.js': '980de420c302ab9a1759c003793ec208ff609777d3a6d6d03c78b9b1d9b98891',
    'view-updated.js': '358130b40672d1c608a523cb319f4004097ca242776e4e1ef099df2a67f28868'}
services = ['royal-nile-reconcile', 'royal-nile-account-views']
configurations = [('compose.finance.yaml', 'priority-compose-finance.yaml'),
    ('deployment/finance/compose.nile-play.yaml', 'priority-compose-nile.yaml'),
    ('deployment/finance/compose.nile-reconcile.yaml', 'priority-compose-reconcile.yaml'),
    ('deployment/finance/compose.nile-account-views.yaml', 'priority-compose-views.yaml')]

with open('/opt/royal-releases/themed-publish.lock', 'a+') as app, open('/opt/royal-game-modules-state/module.lock', 'a+') as modules:
    fcntl.flock(app, fcntl.LOCK_EX)
    fcntl.flock(modules, fcntl.LOCK_EX)
    for name, digest in bundles.items(): assert sha(ROOT / name) == digest, name
    old_images = {name: run(['docker', 'image', 'inspect', name + ':local', '--format', '{{.Id}}']) for name in services}
    changes = []
    for name, source in configurations:
        desired = (ROOT / source).read_text()
        for base in ['/opt/royal-finance', '/opt/royal']:
            target = Path(base) / name
            if not target.exists(): continue
            current = re.sub(r'^    cpu_shares: (8192|4096|65536|32768)\n', '', target.read_text(), flags=re.M)
            expected = re.sub(r'^    cpu_shares: \d+\n', '', desired, flags=re.M)
            if name.endswith('compose.nile-account-views.yaml'): current = current.replace('    cpus: 0.5\n', '    cpus: 2\n', 1)
            assert current == expected, 'Configuration advanced: ' + str(target)
            changes.append((target, ROOT / source))
    for name, image in old_images.items(): run(['docker', 'tag', image, name + ':before-pvp-audit-20261023'])
    (ROOT / 'audit-consumers-before.json').write_text(json.dumps(old_images, indent=2) + '\n')
    # These jobs only read the journal. Stop their old full scans before changing their next-run images.
    try:
        run(['systemctl', 'stop', *[name + '.timer' for name in services], *[name + '.service' for name in services]])
        for name in ['royal-nile-reconcile-once', 'royal-nile-account-views-once']:
            state = subprocess.run(['docker', 'inspect', name], text=True, capture_output=True)
            if state.returncode == 0 and json.loads(state.stdout)[0]['State']['Running']:
                run(['docker', 'stop', '-t', '10', name])
        images = {}
        for name, mapping in [('royal-nile-reconcile', {'reconcile-updated.js': 'reconcile.js', 'proof-updated.js': 'proof.js'}),
                              ('royal-nile-account-views', {'view-updated.js': 'view.js'})]:
            context = ROOT / (name + '-audit-context')
            context.mkdir(exist_ok=False)
            for source, target in mapping.items(): shutil.copyfile(ROOT / source, context / target)
            dockerfile = 'FROM ' + name + ':before-pvp-audit-20261023\n'
            for target in mapping.values(): dockerfile += 'COPY --chown=node:node ' + target + ' /app/' + target + '\n'
            (context / 'Dockerfile').write_text(dockerfile + 'LABEL org.opencontainers.image.revision="' + REVISION + '"\n')
            tag = name + ':pvp-audit-20261023'
            with (ROOT / (name + '-audit-build.log')).open('w') as log:
                subprocess.run(['docker', 'build', '--pull=false', '-t', tag, '.'], cwd=context, check=True, stdout=log, stderr=subprocess.STDOUT)
            image = run(['docker', 'image', 'inspect', tag, '--format', '{{.Id}}'])
            old, new = json.loads(run(['docker', 'image', 'inspect', old_images[name], image]))
            for key in ['User', 'WorkingDir', 'Env', 'Entrypoint', 'Cmd', 'ExposedPorts', 'Healthcheck', 'Volumes']:
                assert old['Config'].get(key) == new['Config'].get(key), (name, key)
            for target in mapping.values(): run(['docker', 'run', '--rm', '--network=none', '--read-only', '--entrypoint', 'node', image, '--check', '/app/' + target])
            images[name] = image
        for index, (target, source) in enumerate(changes):
            shutil.copyfile(target, ROOT / ('audit-consumer-config-before-' + str(index) + '.yaml'))
            temporary = target.with_name(target.name + '.audit-partial')
            assert not temporary.exists() and not target.is_symlink()
            shutil.copyfile(source, temporary)
            temporary.replace(target)
        for name, image in images.items(): run(['docker', 'tag', image, name + ':local'])
        result = {'sourceCommit': REVISION, 'images': images, 'previousImages': old_images,
            'bundles': bundles, 'readOnlyConsumers': True, 'databaseRestored': False,
            'configurations': {str(target): sha(target) for target, _ in changes}}
        (ROOT / 'audit-consumers-verification.json').write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps(result), flush=True)
    finally:
        run(['systemctl', 'start', *[name + '.timer' for name in services]])
    run(['systemctl', 'start', '--no-block', 'royal-nile-reconcile.service'])
