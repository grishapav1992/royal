#!/usr/bin/env python3
"""Check bounded streaming, exact fingerprints and private error categories without Docker."""
from contextlib import redirect_stdout
import hashlib
import importlib.util
from io import StringIO
import json
from pathlib import Path
import resource
import subprocess
import sys
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch
sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location('ops', Path(__file__).with_name('operations.py'))
ops = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ops)

block = b'royal-postgres-stream-test\n' * 2048
expected = hashlib.sha256()
for _ in range(2048):
    expected.update(block)
child = "import sys; b=b'royal-postgres-stream-test\\n'*2048; [sys.stdout.buffer.write(b) for _ in range(2048)]"
actual, size = ops.stream_digest([sys.executable, '-c', child], 'fingerprint')
assert actual == expected.hexdigest()
assert size == len(block) * 2048
rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
rss_bytes = rss if sys.platform == 'darwin' else rss * 1024
assert rss_bytes < 64 * 1024 ** 2, 'streaming retained the full database output'

for message, code in [('No space left on device', 'storage_exhausted'),
                      ('out of memory', 'memory_exhausted'),
                      ('canceling statement due to statement timeout', 'timeout'),
                      ('canceling statement due to lock timeout', 'lock_timeout'),
                      ('unrecognized database error', 'failed')]:
    child = "import sys;sys.stderr.write(" + repr(message + '\nprivate-row-value') + ");sys.exit(1)"
    try:
        ops.stream_digest([sys.executable, '-c', child], 'fingerprint')
        raise AssertionError('failed child accepted')
    except ops.OpsError as error:
        assert str(error) == 'fingerprint_' + code
        assert 'private-row-value' not in str(error)

try:
    ops.stream_digest([sys.executable, '-c', 'import time;time.sleep(30)'], 'fingerprint', timeout=0.1)
    raise AssertionError('timeout accepted')
except ops.OpsError as error:
    assert str(error) == 'fingerprint_timeout'

assert ops.restore_space_required({'bytes': 80 * 1024 ** 2}) == 2 * 1024 ** 3
assert ops.restore_space_required({'bytes': 1, 'database_bytes': 1024 ** 3}) == 4 * 1024 ** 3
try:
    ops.restore_space_required({'bytes': 1, 'fingerprint_bytes': -1})
    raise AssertionError('invalid size accepted')
except ops.OpsError:
    pass
assert '_royal_migrations' in ops.qualified_copy_sql(['royal_game._royal_migrations'])


def invoke(command, expected_exit=0):
    output = StringIO()
    with redirect_stdout(output), patch.object(sys, 'argv', ['operations.py', command]):
        try:
            ops.main()
        except SystemExit as error:
            assert error.code == expected_exit
        else:
            assert expected_exit == 0
    return json.loads(output.getvalue())


def check_restore_receipts():
    with TemporaryDirectory(prefix='royal-finance-restore-receipt-') as temporary:
        root = Path(temporary)
        archive = root / 'finance-20261108T123456Z-abcdef12.dump'
        archive.write_bytes(b'synthetic archive')
        metadata = {'file': archive.name, 'sha256': ops.sha256(archive), 'data_sha256': 'd' * 64,
                    'schema_version': 1, 'tables': list(ops.tables_for_version(1)), 'bytes': archive.stat().st_size}
        ops.atomic_json(archive.with_suffix('.dump.json'), metadata)
        ops.atomic_json(archive.with_suffix('.dump.restore.json'), {
            'ok': True, 'file': archive.name, 'sha256': metadata['sha256'], 'last_success_at': 'previous-check',
        })
        catalog = {'roles': []}
        checks = {'net_units': '0', 'meta_rows': 1, 'schema_version': 1, 'guard_trigger_count': 7}
        remove_workspace = ops.shutil.rmtree
        failed_step = None

        def during_cleanup():
            pending = invoke('latest')['restore']
            assert pending['ok'] is False and pending['status'] == 'in-progress'
            assert 'cleanup_verified' not in pending and 'audit_verified' not in pending
            assert pending.get('last_success_at')

        def docker_remove(args, **_):
            assert args[:3] == ['docker', 'rm', '--force']
            assert args[3].startswith('royal-finance-restore-')
            during_cleanup()
            return subprocess.CompletedProcess(args, int(failed_step == 'container'))

        def workspace_remove(path):
            assert path.parent == root and path.is_dir() and path.name.startswith('restore-')
            during_cleanup()
            if failed_step == 'workspace':
                raise OSError('synthetic workspace removal failure')
            remove_workspace(path)

        with (patch.multiple(ops, BACKUPS=root, STATE=root, ROOT=Path(__file__).resolve().parents[2]),
              patch.object(ops.os, 'chown'),
              patch.object(ops.shutil, 'disk_usage', return_value=SimpleNamespace(free=2 * 1024 ** 3)),
              patch.object(ops.shutil, 'rmtree', side_effect=workspace_remove),
              patch.object(ops.subprocess, 'run', side_effect=docker_remove) as removal,
              patch.object(ops, 'db_container', return_value='synthetic'),
              patch.object(ops, 'run', return_value=b'sha256:' + b'a' * 64),
              patch.object(ops, 'query', return_value=json.dumps(checks)),
              patch.object(ops, 'query_digest', return_value=(metadata['data_sha256'], 1)),
              patch.object(ops, 'audit_metadata_from_backup', return_value=catalog),
              patch.object(ops, 'audit_backup_catalog', return_value=catalog),
              patch.object(ops, 'audit_royal_roles', return_value=0)):
            success = invoke('restore-check')
            assert success['ok'] is True and success['status'] == 'complete'
            assert success['cleanup_verified'] is True and success['audit_verified'] is True
            assert success['sha256'] == metadata['sha256'] and not list(root.glob('restore-*'))
            assert invoke('latest')['restore'] == {key: value for key, value in success.items() if key != 'check'}
            for failed_step, error in [('container', 'restore_cleanup_failed'), ('workspace', 'restore_workspace_cleanup_failed')]:
                failed = invoke('restore-check', 1)
                receipt = invoke('latest')['restore']
                assert failed['ok'] is False and failed['error'] == error
                assert receipt['ok'] is False and receipt['status'] == 'failed' and receipt['error'] == error
                assert receipt['last_success_at'] == success['last_success_at']
                assert 'cleanup_verified' not in receipt and 'audit_verified' not in receipt
            assert removal.call_count == 3 and len(list(root.glob('restore-*'))) == 2


check_restore_receipts()
print(json.dumps({'ok': True, 'checks': 12, 'stream_bytes': size, 'peak_rss_bytes': rss_bytes,
                  'migration_metadata_included': True, 'private_rows_printed': False}))
