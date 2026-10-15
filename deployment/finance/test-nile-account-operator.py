#!/usr/bin/env python3
"""Run the binding operator with temporary projections and a mocked PostgreSQL authority."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import uuid

spec = importlib.util.spec_from_file_location('account_views', Path(__file__).with_name('nile-account-views.py'))
operator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(operator)
actual_uid = os.geteuid()

with tempfile.TemporaryDirectory(prefix='royal-binding-operator-') as directory:
    root = Path(directory)
    if actual_uid != 0:
        # Exercise production ownership requests without changing host permissions.
        operator.os.geteuid = lambda: 0
        operator.os.chown = lambda path, uid, gid: None
    operator.BINDINGS = root / 'bindings'
    operator.INPUT = root / 'input'
    operator.OUTPUT = root / 'output'
    operator.STATE = root / 'state'
    operator.STATE.mkdir()
    operator.CONFIG = root / 'config.json'
    config = dict(network='nile', asset='USDT_NILE_TEST', addresses=[dict(userId='alice', address='41' + 'a' * 40)])
    operator.CONFIG.write_text(json.dumps(config))
    account = str(uuid.uuid4())
    operator.run = lambda args, input=None, timeout=40: b'c' * 64 if args[1] == 'compose' else json.dumps(dict(id=account)).encode()
    authority = []

    def database_query(sql):
        if sql.startswith('SELECT coalesce'):
            return json.loads(json.dumps(authority))
        payload = json.loads(bytes.fromhex(re.search(r"decode\('([a-f0-9]+)'", sql).group(1)))
        previous = next((row for row in authority if row['accountId'] == payload['accountId'] or row['userId'] == payload['userId']), None)
        if previous and any(previous[key] != payload[key] for key in ('accountId', 'userId', 'address')):
            return dict(ok=False, code='nile_binding_conflict')
        if not previous:
            authority.append(payload)
        return dict(ok=True)

    operator.database_query = database_query
    exported = []
    operator.export = lambda: exported.append(True)

    def execute(*args):
        sys.argv = ['operator', *args]
        with contextlib.redirect_stdout(io.StringIO()):
            operator.main()

    execute('init')
    assert len(operator.manifest(config)['bindings']) == 0
    (operator.BINDINGS / 'bindings.json').write_text('stale invalid projection')
    execute('bind', '--email', 'fixture@example.test', '--user', 'alice')
    first = (operator.BINDINGS / 'bindings.json').read_bytes()
    assert operator.manifest(config)['bindings'][0]['accountId'] == account
    assert (operator.BINDINGS / 'bindings.json').stat().st_mode & 0o777 == 0o640
    assert operator.BINDINGS.stat().st_uid == actual_uid
    first_timestamp = authority[0]['boundAt']
    execute('bind', '--email', 'fixture@example.test', '--user', 'alice')
    assert (operator.BINDINGS / 'bindings.json').read_bytes() == first
    assert authority[0]['boundAt'] == first_timestamp
    (operator.BINDINGS / 'bindings.json').unlink()
    execute('latest')
    assert (operator.BINDINGS / 'bindings.json').read_bytes() == first
    account = str(uuid.uuid4())
    try:
        execute('bind', '--email', 'other@example.test', '--user', 'alice')
        raise AssertionError('Reassignment was accepted')
    except ValueError as error:
        assert str(error) == 'nile_binding_conflict'
    assert (operator.BINDINGS / 'bindings.json').read_bytes() == first
    try:
        execute('bind', '--email', 'fixture@example.test', '--user', 'unknown')
        raise AssertionError('Unknown lab address was accepted')
    except ValueError as error:
        assert str(error) == 'unknown_nile_user'
    account = None
    try:
        execute('bind', '--email', 'missing@example.test', '--user', 'alice')
        raise AssertionError('Missing game identity was accepted')
    except ValueError as error:
        assert str(error) == 'game_account_not_found'
    assert (operator.BINDINGS / 'bindings.json').read_bytes() == first
    assert len(exported) == 2
    assert len(authority) == 1
    assert len(list(operator.BINDINGS.glob('before-*.json'))) == 1
print(json.dumps(dict(ok=True, checks=7, isolatedTemporaryFiles=True, productionBindingsChanged=False,
                      postgresAuthoritative=True, staleProjectionIgnored=True, missingProjectionRegenerated=True)))
