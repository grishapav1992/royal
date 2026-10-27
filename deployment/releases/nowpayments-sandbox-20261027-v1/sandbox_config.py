"""Allow only the separately reviewed Sandbox environment addition."""
import hashlib
import json
import os
from pathlib import Path
import re
import stat

KEYS = {'NOWPAYMENTS_SANDBOX_ENABLED', 'NOWPAYMENTS_SANDBOX_API_KEY',
        'NOWPAYMENTS_SANDBOX_IPN_SECRET', 'NOWPAYMENTS_SANDBOX_CURRENCY'}
PRIVATE = '.env.nowpayments-sandbox'
COMPOSE = 'compose.nowpayments-sandbox.yaml'


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_private(path):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o600,
            'Sandbox configuration must be a private regular file')
    require(info.st_size <= 4096, 'Sandbox configuration is oversized')
    values = {}
    for line in path.read_text().splitlines():
        if not line:
            continue
        key, separator, value = line.partition('=')
        require(separator and key in KEYS and key not in values, 'Unexpected Sandbox variable')
        values[key] = value
    require(set(values) == KEYS and values['NOWPAYMENTS_SANDBOX_ENABLED'] == 'true'
            and values['NOWPAYMENTS_SANDBOX_CURRENCY'] == 'btc', 'Unexpected Sandbox mode')
    for key in ['NOWPAYMENTS_SANDBOX_API_KEY', 'NOWPAYMENTS_SANDBOX_IPN_SECRET']:
        require(re.fullmatch(r'[A-Za-z0-9._~+/=\-]{16,512}', values[key]), 'Invalid private Sandbox credential')
    return values


def validate_staged(root, manifest):
    source = root / 'private-sandbox.env'
    read_private(source)
    require(digest(source) == manifest['sandboxConfigHash'], 'Private Sandbox configuration changed')
    require(digest(root / COMPOSE) == manifest['sandboxComposeHash'], 'Sandbox Compose addition changed')
    require(PRIVATE not in manifest['before']['configHashes'] and COMPOSE not in manifest['before']['configHashes'],
            'Existing Sandbox configuration requires separate reconciliation')


def runtime_state(config, live):
    rows = config.get('Env', [])
    variables = dict(row.split('=', 1) for row in rows if '=' in row)
    require(len(variables) == len(rows), 'Duplicate runtime variables')
    selected = {key: value for key, value in variables.items() if key.startswith('NOWPAYMENTS_SANDBOX')}
    runtime = {key: config.get(key) for key in ['User', 'WorkingDir', 'Entrypoint', 'Cmd']}
    runtime['Env'] = {key: value for key, value in variables.items() if key not in KEYS}
    base = hashlib.sha256(json.dumps(runtime, sort_keys=True).encode()).hexdigest()
    matches = False
    if (live / PRIVATE).exists():
        matches = selected == read_private(live / PRIVATE)
    return {'runtimeWithoutSandboxHash': base, 'sandboxPresent': bool(selected),
            'sandboxMatchesPrivateFile': matches}


def check_settings(state, old, manifest, sandbox=False, recovery=False):
    additions = {PRIVATE: manifest['sandboxConfigHash'], COMPOSE: manifest['sandboxComposeHash']}
    expected = {**old['configHashes'], **additions} if sandbox else old['configHashes']
    if recovery:
        require(set(old['configHashes']).issubset(state['configHashes'])
                and set(state['configHashes']).issubset(set(old['configHashes']) | set(additions)),
                'Unexpected configuration prevents recovery')
        require(all(value == {**old['configHashes'], **additions}[name]
                    for name, value in state['configHashes'].items()), 'Configuration drift prevents recovery')
    else:
        require(state['configHashes'] == expected, 'Protected production state changed: configHashes')
    container = state['container']
    if container is None:
        require(recovery, 'Game container disappeared')
        return
    previous = old['container']
    if container['sandboxPresent']:
        require((sandbox or recovery) and container['sandboxMatchesPrivateFile'],
                'Runtime Sandbox credentials differ from the private file')
        require(container['runtimeWithoutSandboxHash'] == previous['runtimeHash'],
                'Unrelated runtime environment changed')
        require(container['composeFiles'] == previous['composeFiles'] + ',/opt/royal/' + COMPOSE,
                'Unexpected Sandbox Compose composition')
    else:
        require(not sandbox and container['runtimeHash'] == previous['runtimeHash']
                and container['composeFiles'] == previous['composeFiles'], 'Runtime settings changed')


def private_atomic(source, target, mode):
    require(not target.exists() and not target.is_symlink(), 'Existing Sandbox configuration must be preserved')
    require(not any(parent.is_symlink() for parent in target.parents), 'Configuration directory symlink')
    temporary = target.with_name('.' + target.name + '.next')
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    try:
        with os.fdopen(descriptor, 'wb') as output:
            output.write(source.read_bytes())
            output.flush()
            os.fsync(output.fileno())
        os.rename(temporary, target)
        descriptor = os.open(target.parent, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    finally:
        temporary.unlink(missing_ok=True)


def install(root, live, manifest):
    validate_staged(root, manifest)
    private_atomic(root / 'private-sandbox.env', live / PRIVATE, 0o600)
    private_atomic(root / COMPOSE, live / COMPOSE, 0o644)


def remove_owned(live, manifest):
    for name, expected in [(COMPOSE, manifest['sandboxComposeHash']), (PRIVATE, manifest['sandboxConfigHash'])]:
        path = live / name
        if path.exists():
            require(not path.is_symlink() and digest(path) == expected, 'Later Sandbox configuration prevents recovery')
            path.unlink()
