import importlib.util
import json
from pathlib import Path
import sys
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('ops', Path(__file__).with_name('operations.py'))
o = importlib.util.module_from_spec(spec)
spec.loader.exec_module(o)
o.psql_args = lambda db: [sys.argv[1], sys.argv[2], '--copy-client', sys.argv[3], db]
a, b = 'royal_fingerprint_source', 'royal_fingerprint_copy'
i, j = o.fingerprint_inventory(a), o.fingerprint_inventory(b)
assert i == j
h, n = o.fingerprint_v2(a, i)
other, m = o.fingerprint_v2(b, j)
assert h == other and n == m
tables = [x['table'] for x in i]
sql = "SET timezone='UTC'; " + o.qualified_copy_sql(tables)
v1, v1_bytes = o.query_digest(a, sql, 'legacy')
v1_copy, v1_copy_bytes = o.query_digest(b, sql, 'legacy')
assert v1 == v1_copy, (v1_bytes, v1_copy_bytes)
o.query(b, "UPDATE royal_game.sample SET value='tampered' WHERE id=1; SELECT 1;")
changed, _ = o.fingerprint_v2(b, j)
assert changed != h
o.query(b, "ALTER TABLE royal_game.empty_table ADD COLUMN extra text; SELECT 1;")
k = o.fingerprint_inventory(b)
assert k != i
empty_changed, _ = o.fingerprint_v2(b, k)
assert empty_changed != changed
print(json.dumps({'ok': True, 'checks': ['source_copy_v2_match', 'legacy_v1_match', 'row_tamper_rejected', 'empty_table_schema_tamper_rejected', 'migration_metadata_included'], 'bytes': n, 'v2_sha256': h, 'v1_sha256': v1}))
