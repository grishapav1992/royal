#!/usr/bin/env python3
"""Restore the exact archive accepted by restore-check into a disposable CI clone."""
import json
from pathlib import Path
import re
import sys

import operations as ops


def restore_clone(target, archive, latest, pg_restore):
    metadata, receipt = latest['metadata'], latest['restore']
    assert receipt['ok'] is True and receipt['status'] == 'complete'
    assert receipt['audit_verified'] is True and receipt['cleanup_verified'] is True
    assert archive.name == metadata['file'] == receipt['file']
    assert metadata['sha256'] == receipt['sha256'] and metadata['data_sha256'] == receipt['data_sha256']
    assert metadata['schema_version'] == 3 and metadata['fingerprint_format'] == 2
    assert metadata['runtime_roles'] == ['royal_game_app', 'royal_payments_app']
    audit = ops.audit_metadata_from_backup(metadata, metadata['all_tables'], 2)
    assert audit and audit['roles'] == ['royal_audit_reader', 'royal_audit_recorder']
    marker = ops.query(target, """SELECT current_setting('royal.audit_restore_fixture',true)='restored'
      AND NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname LIKE 'royal_%');""")
    assert marker.strip() == b't', 'Continuation requires an empty disposable clone'
    with ops._verified_restore_source(archive, receipt['sha256']) as (source, verify_source):
        ops.query(target, """CREATE ROLE royal_finance_runtime NOLOGIN; CREATE ROLE finance_app LOGIN;
          GRANT royal_finance_runtime TO finance_app WITH INHERIT TRUE;
          CREATE ROLE royal_finance_observer NOLOGIN; CREATE ROLE finance_ingest LOGIN;
          GRANT royal_finance_observer TO finance_ingest WITH INHERIT TRUE;
          CREATE ROLE royal_game_app LOGIN; CREATE ROLE royal_payments_app LOGIN;
          GRANT CONNECT, CREATE ON DATABASE royal_finance_sim TO royal_game_app,royal_payments_app;""")
        ops.query(target, ops.audit_restore_roles_sql(audit))
        verify_source()
        pg_restore(source)
        verify_source()
        inventory = ops.fingerprint_inventory(target)
        assert inventory == metadata['fingerprint_tables']
        assert ops.fingerprint_v2(target, inventory) == (receipt['data_sha256'], receipt['fingerprint_bytes'])
        assert ops.audit_backup_catalog(target, metadata['schemas'], 3, metadata['runtime_roles']) == audit
    return {'archiveSha256': receipt['sha256'], 'dataSha256': receipt['data_sha256']}


def main():
    container, receipt_path, archive_path = sys.argv[1:]
    assert re.fullmatch(r'[a-f0-9]{12,64}', container)
    archive = Path(archive_path)
    assert archive.is_absolute() and ops.NAME.fullmatch(archive.name)
    latest = json.loads(Path(receipt_path).read_text())

    def pg_restore(source):
        ops.run(['docker', 'exec', '-i', container, 'pg_restore', '-U', ops.OWNER, '-d', ops.DB,
                 '--single-transaction', '--exit-on-error'], 'restore_continuation_fixture', stdin=source)

    print(json.dumps(restore_clone(container, archive, latest, pg_restore)))


if __name__ == '__main__':
    main()
