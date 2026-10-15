#!/usr/bin/env python3
"""Check bounded streaming, exact fingerprints and private error categories without Docker."""
import hashlib
import importlib.util
import json
from pathlib import Path
import resource
import sys
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
print(json.dumps({'ok': True, 'checks': 11, 'stream_bytes': size, 'peak_rss_bytes': rss_bytes,
                  'migration_metadata_included': True, 'private_rows_printed': False}))
