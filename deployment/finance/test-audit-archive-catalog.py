#!/usr/bin/env python3
"""Exercise production archive verification on disposable PostgreSQL clusters."""
import json
from pathlib import Path
import re
import sys

import operations as ops


def snapshot_catalog(snapshot):
    if not re.fullmatch(r'[A-Fa-f0-9]+-[A-Fa-f0-9]+-[0-9]+', snapshot):
        raise SystemExit('Invalid local archive snapshot')
    snapshot_start = "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET TRANSACTION SNAPSHOT '" + snapshot + "'; "
    schemas = ['royal_audit', 'royal_game', 'royal_payments']
    catalog = ops.audit_backup_catalog('rehearsal', schemas, 3, [], snapshot_start)
    tables = ops.unified_inventory('rehearsal', snapshot_start)
    inventory = ops.fingerprint_inventory('rehearsal', snapshot_start)
    if [table['table'] for table in inventory] != tables:
        raise ops.OpsError('source_fingerprint_inventory_mismatch')
    digest, size = ops.fingerprint_v2('rehearsal', inventory, snapshot_start)
    verified = ops.audit_metadata_from_backup({'schemas': schemas, 'audit': catalog}, tables, 2)
    if verified is None:
        raise SystemExit('Missing rehearsal audit archive catalog')
    print(json.dumps({'catalog': verified, 'roleSql': ops.audit_restore_roles_sql(verified),
                      'fingerprint': {'tables': inventory, 'sha256': digest, 'bytes': size}}))


def restore_archive(tool, connect, archive_path, digest):
    archive = Path(archive_path)
    if not archive.is_absolute() or archive.name != 'rehearsal.dump' \
            or not archive.parent.name.startswith('royal-audit-rehearsal-dump-'):
        raise SystemExit('Invalid local rehearsal archive path')
    with ops._verified_restore_source(archive, digest) as (source, verify_source):
        verify_source()
        ops.run([tool, *connect, '--single-transaction', '--exit-on-error'], 'restore_database', stdin=source)
        verify_source()


def main():
    mode, pg_bin, port, *args = sys.argv[1:]
    tools = Path(pg_bin)
    if not tools.is_absolute() or not re.fullmatch(r'[1-9][0-9]{0,4}', port) or int(port) > 65535:
        raise SystemExit('Invalid local archive connection settings')
    connect = ['--host=127.0.0.1', '--port=' + port, '--username=' + ops.OWNER, '--dbname=royal_test', '--no-password']
    suffix = '.exe' if sys.platform == 'win32' else ''
    if mode == 'snapshot' and len(args) == 1:
        ops.psql_args = lambda _: [str(tools / ('psql' + suffix)), '-XqAt', '-v', 'ON_ERROR_STOP=1', *connect]
        snapshot_catalog(args[0])
    elif mode == 'restore' and len(args) == 2:
        restore_archive(str(tools / ('pg_restore' + suffix)), connect, *args)
    else:
        raise SystemExit('Invalid local archive check')


if __name__ == '__main__':
    try:
        main()
    except ops.OpsError as error:
        raise SystemExit(str(error)) from None
