#!/usr/bin/env python3
"""Real PG17 archive/restore checks in two private temporary clusters."""
from contextlib import contextmanager
import importlib.util
import json
import os
import re
import select
import shlex
from pathlib import Path
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('ops', Path(__file__).with_name('operations.py'))
ops = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ops)

tools = Path(os.environ['ROYAL_TEST_PG_BIN']).resolve()
for name in tuple(os.environ):
    if name.startswith('PG'):
        del os.environ[name]
environment = os.environ.copy()
port = '55417'
version = 3
legacy_roles = ['royal_game_app']
schemas = ['royal_audit', 'royal_game']
legacy_schemas = ['royal_game']


def call(name, args, *, expected=0):
    result = subprocess.run([str(tools / name), *args], env=environment, capture_output=True,
                            text=True, check=False, timeout=60)
    if result.returncode != expected:
        raise AssertionError(f'{name} returned {result.returncode}: {result.stderr}')
    return result.stdout


@contextmanager
def cluster(directory):
    directory.mkdir()
    data = directory / 'pg'
    call('initdb', ['-D', str(data), '-U', ops.OWNER, '-A', 'trust', '--no-locale', '-E', 'UTF8'])
    call('pg_ctl', ['-D', str(data), '-l', str(directory / 'log'),
                    '-o', f"-c listen_addresses='' -k {shlex.quote(str(directory))} -p {port}", '-w', 'start'])
    try:
        yield ['-h', str(directory), '-p', port, '-U', ops.OWNER]
    finally:
        call('pg_ctl', ['-D', str(data), '-m', 'fast', '-w', 'stop'])


@contextmanager
def snapshot():
    with subprocess.Popen(ops.psql_args('source'), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE) as keeper:
        try:
            keeper.stdin.write(b'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT pg_export_snapshot();\n')
            keeper.stdin.flush()
            assert select.select([keeper.stdout], [], [], 5)[0]
            name = keeper.stdout.readline().decode().strip()
            assert re.fullmatch('[A-Fa-f0-9]+-[A-Fa-f0-9]+-[0-9]+', name)
            yield name, "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET TRANSACTION SNAPSHOT '" + name + "'; "
        finally:
            keeper.terminate()
            keeper.wait(timeout=5)


def dump(source, selected_schemas, archive, snapshot_name=None):
    call('pg_dump', [*source, '-d', 'postgres', '--format=custom', '--file', str(archive),
                    *['--schema=' + name for name in selected_schemas],
                    *(['--snapshot=' + snapshot_name] if snapshot_name else [])])


def restore(target, database, archive, *, expected=0):
    call('pg_restore', [*target, '-d', database, '--single-transaction', '--exit-on-error', str(archive)], expected=expected)


def rejected(fn, message):
    try:
        fn()
    except ops.OpsError as error:
        assert str(error) == message, str(error)
    else:
        raise AssertionError(f'{message} was not rejected')


with tempfile.TemporaryDirectory(prefix='audit-pg17-') as temp:
    root = Path(temp)
    with cluster(root / 'source') as source, cluster(root / 'target') as target:
        connections = {'source': (source, 'postgres'), 'target-admin': (target, 'postgres'),
                       'legacy': (target, 'legacy'), 'restored': (target, 'restored'), 'stopped': (target, 'stopped')}
        ops.psql_args = lambda name: [str(tools / 'psql'), *connections[name][0], '-d', connections[name][1],
                                      '-XqAt', '-v', 'ON_ERROR_STOP=1']
        ops.query('source', """CREATE ROLE royal_game_app LOGIN;
          CREATE SCHEMA royal_game AUTHORIZATION royal_game_app;
          CREATE TABLE royal_game.demo_ledger(id bigint PRIMARY KEY, account_id text NOT NULL,
            operation_id text NOT NULL, created_at bigint NOT NULL);
          ALTER TABLE royal_game.demo_ledger OWNER TO royal_game_app;
          INSERT INTO royal_game.demo_ledger VALUES (1,'test-actor','before-audit',1);""")
        ops.query('target-admin', 'CREATE ROLE royal_game_app LOGIN; CREATE DATABASE legacy; CREATE DATABASE restored; CREATE DATABASE stopped;')
        assert ops.audit_backup_catalog('source', legacy_schemas, version, legacy_roles) is None
        assert ops.audit_metadata_from_backup({'schemas': legacy_schemas}, ['royal_game.demo_ledger'], 2) is None
        legacy = root / 'legacy.dump'
        dump(source, legacy_schemas, legacy)
        restore(target, 'legacy', legacy)
        old_inventory = ops.fingerprint_inventory('source')
        assert ops.fingerprint_inventory('legacy') == old_inventory
        assert ops.fingerprint_v2('legacy', old_inventory) == ops.fingerprint_v2('source', old_inventory)

        ops.query('source', """CREATE ROLE royal_audit_reader NOLOGIN;
          CREATE ROLE royal_audit_recorder LOGIN;
          CREATE ROLE royal_audit_reviewer_anna LOGIN;
          CREATE SCHEMA royal_audit;
          CREATE TABLE royal_audit.audit_datasets(id uuid PRIMARY KEY, sealed_at_ms bigint);
          CREATE TABLE royal_audit.audit_dataset_sources(
            dataset_id uuid REFERENCES royal_audit.audit_datasets(id), source_namespace text,
            PRIMARY KEY(dataset_id,source_namespace));
          CREATE TABLE royal_audit.audit_posting_refs(dataset_id uuid REFERENCES royal_audit.audit_datasets(id),
            source_row_id bigint, PRIMARY KEY(dataset_id,source_row_id));
          INSERT INTO royal_audit.audit_datasets VALUES('6362eae7-c32d-44b3-a377-8e8affb31cd6',NULL);
          INSERT INTO royal_audit.audit_dataset_sources VALUES('6362eae7-c32d-44b3-a377-8e8affb31cd6','royal_game.demo_ledger');
          GRANT USAGE ON SCHEMA royal_audit TO royal_audit_reader,royal_audit_recorder,royal_audit_reviewer_anna;
          CREATE TABLE royal_audit.audit_risk_signals(id integer PRIMARY KEY,review jsonb);
          INSERT INTO royal_audit.audit_risk_signals VALUES(1,NULL);
          GRANT SELECT ON royal_audit.audit_risk_signals TO royal_audit_reviewer_anna;
          GRANT UPDATE(review) ON royal_audit.audit_risk_signals TO royal_audit_reviewer_anna;
          GRANT SELECT(id) ON royal_audit.audit_datasets TO royal_audit_recorder;
          GRANT USAGE ON SCHEMA royal_game TO royal_audit_recorder;
          GRANT SELECT(id) ON royal_game.demo_ledger TO royal_audit_recorder;
          CREATE TABLE royal_audit.audit_report_acl(operator_name text PRIMARY KEY);
          INSERT INTO royal_audit.audit_report_acl VALUES('named_restore_operator');
          CREATE FUNCTION royal_audit.fixture_report() RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER
            SET search_path=pg_catalog AS $body$
            SELECT count(*)::integer FROM royal_audit.audit_report_acl WHERE operator_name=session_user
            $body$;
          REVOKE ALL ON FUNCTION royal_audit.fixture_report() FROM PUBLIC;
          GRANT EXECUTE ON FUNCTION royal_audit.fixture_report() TO royal_audit_reader;
          CREATE FUNCTION royal_audit.audit_capture_posting_v1() RETURNS trigger
            LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
            BEGIN
              INSERT INTO royal_audit.audit_posting_refs(dataset_id,source_row_id)
                SELECT s.dataset_id,NEW.id FROM royal_audit.audit_dataset_sources s
                JOIN royal_audit.audit_datasets d ON d.id=s.dataset_id
                WHERE d.sealed_at_ms IS NULL AND s.source_namespace=TG_TABLE_SCHEMA||'.'||TG_TABLE_NAME;
              RETURN NEW;
            END
            $body$;
          REVOKE ALL ON FUNCTION royal_audit.audit_capture_posting_v1() FROM PUBLIC;
          CREATE CONSTRAINT TRIGGER royal_audit_posting_v1
            AFTER INSERT ON royal_game.demo_ledger DEFERRABLE INITIALLY DEFERRED
            FOR EACH ROW EXECUTE FUNCTION royal_audit.audit_capture_posting_v1();""")
        ops.query('source', """SET SESSION AUTHORIZATION royal_game_app;
          INSERT INTO royal_game.demo_ledger VALUES (2,'test-actor','captured',2);
          RESET SESSION AUTHORIZATION;""")
        expected = ops.audit_backup_catalog('source', schemas, version, legacy_roles)
        assert expected['roles'] == ['royal_audit_reader', 'royal_audit_recorder', 'royal_audit_reviewer_anna']
        assert expected['active_sources'] == ['royal_game.demo_ledger']
        assert expected['triggers'][0]['enabled'] == 'O'
        all_tables = ops.unified_inventory('source', '')
        assert ops.audit_metadata_from_backup({'schemas': schemas, 'audit': expected}, all_tables, 2) == expected
        rejected(lambda: ops.audit_metadata_from_backup({'schemas': schemas}, all_tables, 2), 'missing_audit_backup_inventory')
        for untrusted in ('unapproved_role', 'royal_audit_reviewer_', 'royal_audit_reviewer_Anna',
                          'royal_audit_reviewer_' + 'x' * 43):
            rejected(lambda: ops.audit_restore_roles_sql({**expected, 'roles': [untrusted]}), 'invalid_audit_backup_inventory')
        ops.query('source', 'ALTER ROLE royal_audit_reviewer_anna NOLOGIN;')
        rejected(lambda: ops.audit_backup_catalog('source', schemas, version, legacy_roles), 'untrusted_audit_backup_role')
        ops.query('source', 'ALTER ROLE royal_audit_reviewer_anna LOGIN;')
        rejected(lambda: ops.audit_metadata_from_backup({'schemas': ['royal_audit'], 'audit': expected},
                                                       all_tables, 2), 'invalid_audit_backup_schema_scope')
        ops.query('source', 'CREATE ROLE unapproved_role NOLOGIN; GRANT SELECT(id) ON royal_game.demo_ledger TO unapproved_role;')
        rejected(lambda: ops.audit_backup_catalog('source', schemas, version, legacy_roles), 'untrusted_audit_backup_role')
        ops.query('source', 'REVOKE SELECT(id) ON royal_game.demo_ledger FROM unapproved_role; DROP ROLE unapproved_role;')
        ops.query('source', 'GRANT UPDATE(created_at) ON royal_game.demo_ledger TO royal_audit_recorder;')
        rejected(lambda: ops.audit_backup_catalog('source', schemas, version, legacy_roles), 'untrusted_audit_backup_role')
        ops.query('source', 'REVOKE UPDATE(created_at) ON royal_game.demo_ledger FROM royal_audit_recorder;')
        ops.query('source', 'GRANT SELECT ON royal_audit.audit_datasets TO royal_audit_reader;')
        rejected(lambda: ops.audit_backup_catalog('source', schemas, version, legacy_roles), 'untrusted_audit_backup_role')
        ops.query('source', 'REVOKE SELECT ON royal_audit.audit_datasets FROM royal_audit_reader;')
        ops.query('source', 'ALTER TABLE royal_game.demo_ledger DISABLE TRIGGER royal_audit_posting_v1;')
        rejected(lambda: ops.audit_backup_catalog('source', schemas, version, legacy_roles), 'invalid_audit_backup_inventory')
        ops.query('source', 'ALTER TABLE royal_game.demo_ledger ENABLE TRIGGER royal_audit_posting_v1;')
        assert ops.audit_backup_catalog('source', schemas, version, legacy_roles) == expected

        incomplete = root / 'missing-schema.dump'
        dump(source, legacy_schemas, incomplete)
        restore(target, 'restored', incomplete, expected=1)
        complete = root / 'audit.dump'
        with snapshot() as (snapshot_name, snapshot_start):
            assert ops.audit_backup_catalog('source', schemas, version, legacy_roles, snapshot_start) == expected
            full_inventory = ops.fingerprint_inventory('source', snapshot_start)
            full_fingerprint = ops.fingerprint_v2('source', full_inventory, snapshot_start)
            dump(source, schemas, complete, snapshot_name)
        restore(target, 'restored', complete, expected=1)
        ops.query('restored', ops.audit_restore_roles_sql(expected))
        restore(target, 'restored', complete)
        assert ops.audit_backup_catalog('restored', schemas, version, legacy_roles) == expected
        assert ops.fingerprint_inventory('restored') == full_inventory
        assert ops.fingerprint_v2('restored', full_inventory) == full_fingerprint
        assert ops.query('restored', "SELECT to_regrole('named_restore_operator') IS NULL;").strip() == b't'
        access = ops.query('restored', """CREATE ROLE named_restore_operator LOGIN;
          GRANT royal_audit_reader TO named_restore_operator;
          SET SESSION AUTHORIZATION named_restore_operator;
          SELECT royal_audit.fixture_report();
          SELECT has_table_privilege(current_user,'royal_audit.audit_report_acl','SELECT');
          RESET SESSION AUTHORIZATION;""")
        assert access.splitlines() == [b'1', b'f']
        review = ops.query('restored', """SET SESSION AUTHORIZATION royal_audit_reviewer_anna;
          UPDATE royal_audit.audit_risk_signals SET review='{"status":"explained"}'::jsonb WHERE id=1;
          SELECT review->>'status', has_column_privilege(current_user,'royal_audit.audit_risk_signals','id','UPDATE')
          FROM royal_audit.audit_risk_signals;
          RESET SESSION AUTHORIZATION;""")
        assert review.splitlines() == [b'explained|f']
        assert ops.query('restored', """SELECT has_table_privilege(
          'royal_game_app','royal_audit.audit_posting_refs','SELECT');""").strip() == b'f'
        ops.query('restored', """SET SESSION AUTHORIZATION royal_game_app;
          INSERT INTO royal_game.demo_ledger VALUES (3,'test-actor','after-restore',3);
          RESET SESSION AUTHORIZATION;""")
        assert ops.query('restored', 'SELECT source_row_id FROM royal_audit.audit_posting_refs ORDER BY source_row_id;').splitlines() == [b'2', b'3']

        ops.query('source', """UPDATE royal_audit.audit_datasets SET sealed_at_ms=3;
          ALTER TABLE royal_game.demo_ledger DISABLE TRIGGER royal_audit_posting_v1;""")
        stopped = ops.audit_backup_catalog('source', schemas, version, legacy_roles)
        assert stopped['triggers'][0]['enabled'] == 'D' and stopped['active_sources'] == []
        stopped_archive = root / 'stopped.dump'
        dump(source, schemas, stopped_archive)
        restore(target, 'stopped', stopped_archive)
        assert ops.audit_backup_catalog('stopped', schemas, version, legacy_roles) == stopped
        ops.query('stopped', """SET SESSION AUTHORIZATION royal_game_app;
          INSERT INTO royal_game.demo_ledger VALUES (3,'test-actor','capture-stopped',3);
          RESET SESSION AUTHORIZATION;""")
        assert ops.query('stopped', 'SELECT source_row_id FROM royal_audit.audit_posting_refs;').splitlines() == [b'2']
        print(json.dumps({'ok': True, 'legacy_archive': True, 'cross_schema_dependency': True,
                          'trusted_role_inventory': True, 'same_fingerprint': True,
                          'post_restore_wallet_capture': True, 'stopped_capture_dependency': True}))
