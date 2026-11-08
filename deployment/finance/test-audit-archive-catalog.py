#!/usr/bin/env python3
"""Read the production audit archive catalog from a disposable rehearsal snapshot."""
import json
from pathlib import Path
import re
import sys

import operations as ops


def main():
    pg_bin, port, snapshot = sys.argv[1:]
    tools = Path(pg_bin)
    if not tools.is_absolute() or not re.fullmatch(r'[1-9][0-9]{0,4}', port) or int(port) > 65535 \
            or not re.fullmatch(r'[A-Fa-f0-9]+-[A-Fa-f0-9]+-[0-9]+', snapshot):
        raise SystemExit('Invalid local archive snapshot settings')
    ops.psql_args = lambda _: [
        str(tools / ('psql.exe' if sys.platform == 'win32' else 'psql')), '-XqAt', '-v', 'ON_ERROR_STOP=1',
        '--host=127.0.0.1', '--port=' + port, '--username=' + ops.OWNER, '--dbname=royal_test', '--no-password',
    ]
    snapshot_start = "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET TRANSACTION SNAPSHOT '" + snapshot + "'; "
    schemas = ['royal_audit', 'royal_game', 'royal_payments']
    catalog = ops.audit_backup_catalog('rehearsal', schemas, 3, [], snapshot_start)
    tables = ops.unified_inventory('rehearsal', snapshot_start)
    verified = ops.audit_metadata_from_backup({'schemas': schemas, 'audit': catalog}, tables, 2)
    if verified is None:
        raise SystemExit('Missing rehearsal audit archive catalog')
    print(json.dumps({'catalog': verified, 'roleSql': ops.audit_restore_roles_sql(verified)}))


if __name__ == '__main__':
    main()
