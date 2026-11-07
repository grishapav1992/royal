#!/usr/bin/env python3
"""Operational checks for the isolated financial simulator, never a live restore."""
import argparse
from contextlib import contextmanager
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import select
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import uuid

ROOT = Path(os.environ.get("FINANCE_ROOT", "/opt/royal-finance"))
BACKUPS = Path(os.environ.get("FINANCE_BACKUP_DIR", "/opt/royal-finance-backups"))
STATE = Path(os.environ.get("FINANCE_STATE_DIR", "/opt/royal-finance-state"))
DB = "royal_finance_sim"
OWNER = "finance_schema_owner"
BASE_TABLES = ("meta", "users", "accounts", "journals", "entries", "requests", "withdrawals", "rounds", "outbox")
DEPOSIT_TABLES = ("deposit_streams", "deposit_addresses", "deposit_blocks", "deposit_events")
TOTAL_TABLES = ("account_totals",)
AUDIT_SCHEMA = 'royal_audit'
AUDIT_ROLES = {'royal_audit_reader': False, 'royal_audit_recorder': True,
               'royal_audit_worker': True, 'royal_audit_risk': True}
AUDIT_REVIEWER_ROLE = re.compile(r'royal_audit_reviewer_[a-z0-9]+(?:_[a-z0-9]+)*')
AUDIT_SOURCE_TABLES = {'royal_game.demo_ledger', 'royal_game.capro_pending_ledger', 'royal_payments.crypto_ledger'}
ROYAL_SCHEMAS = ('royal_finance', 'royal_game', 'royal_tron_reader', 'royal_nile_deposits', 'royal_nile_play', 'royal_mainnet', 'royal_payments', AUDIT_SCHEMA)
ROYAL_LOGINS = ('royal_game_app', 'royal_tron_reader_app', 'royal_nile_deposits_app', 'royal_nile_play_app', 'royal_nile_views_app', 'royal_nile_reconcile_app', 'royal_mainnet_app', 'royal_payments_app')
ROYAL_OWNERS = dict(zip(('royal_game', 'royal_tron_reader', 'royal_nile_deposits', 'royal_nile_play', 'royal_mainnet', 'royal_payments'),
                        ('royal_game_app', 'royal_tron_reader_app', 'royal_nile_deposits_app', 'royal_nile_play_app', 'royal_mainnet_app', 'royal_payments_app')))
DATABASE_NETWORK = os.environ.get('ROYAL_PGNETWORK', 'royal-finance-sim_finance_private')


def qualified_copy_sql(tables):
    if not tables or any(not re.fullmatch(r'royal_[a-z_]+\.[a-z_][a-z0-9_]*', table) for table in tables):
        raise OpsError('invalid_unified_backup_inventory')
    return "COPY (SELECT relation,row FROM (" + " UNION ALL ".join(
        "SELECT '" + table + "' AS relation,to_jsonb(t)::text AS row FROM " + table + " t" for table in tables
    ) + ") contents ORDER BY relation COLLATE \"C\",row COLLATE \"C\") TO STDOUT;"


def unified_inventory(container, snapshot_start):
    allowed = ','.join("'" + schema + "'" for schema in ROYAL_SCHEMAS)
    sql = snapshot_start + "SELECT coalesce(jsonb_agg(schemaname||'.'||tablename ORDER BY schemaname,tablename),'[]'::jsonb) FROM pg_tables WHERE schemaname IN (" + allowed + "); ROLLBACK;"
    return json.loads(query(container, sql, 'unified_backup_inventory'))


def fingerprint_inventory(container, snapshot_start=''):
    allowed = ','.join("'" + schema + "'" for schema in ROYAL_SCHEMAS)
    sql = snapshot_start + """SELECT coalesce(jsonb_agg(jsonb_build_object(
      'table',n.nspname||'.'||c.relname,
      'primary_key',(SELECT jsonb_agg(a.attname ORDER BY k.position) FROM pg_index i
        CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(number,position)
        JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.number
        WHERE i.indrelid=c.oid AND i.indisprimary AND k.position<=i.indnkeyatts),
      'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,
        'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull) ORDER BY a.attnum)
        FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped))
      ORDER BY n.nspname,c.relname),'[]'::jsonb) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE c.relkind IN ('r','p') AND n.nspname IN (""" + allowed + ');' + (' ROLLBACK;' if snapshot_start else '')
    inventory = json.loads(query(container, sql, 'fingerprint_inventory'))
    validate_fingerprint_inventory(inventory)
    return inventory


def validate_fingerprint_inventory(inventory):
    if not isinstance(inventory, list) or not inventory:
        raise OpsError('fingerprint_inventory_invalid')
    names = []
    for table in inventory:
        if not isinstance(table, dict) or set(table) != {'table', 'primary_key', 'columns'}:
            raise OpsError('fingerprint_inventory_invalid')
        name, keys, columns = table['table'], table['primary_key'], table['columns']
        if not isinstance(name, str) or not re.fullmatch(r'royal_[a-z_]+\.[a-z_][a-z0-9_]*', name) or name.split('.')[0] not in ROYAL_SCHEMAS:
            raise OpsError('fingerprint_inventory_invalid')
        if not isinstance(columns, list) or not columns:
            raise OpsError('fingerprint_inventory_invalid')
        for column in columns:
            if not isinstance(column, dict) or set(column) != {'name', 'type', 'not_null'} or not isinstance(column['name'], str) or not re.fullmatch(r'[a-z_][a-z0-9_]*', column['name']) or not isinstance(column['type'], str) or not isinstance(column['not_null'], bool):
                raise OpsError('fingerprint_inventory_invalid')
        column_names = [column['name'] for column in columns]
        if len(set(column_names)) != len(column_names) or not isinstance(keys, list) or not keys or any(not isinstance(key, str) or key not in column_names for key in keys) or len(set(keys)) != len(keys):
            raise OpsError('fingerprint_primary_key_invalid')
        names.append(name)
    if names != sorted(set(names)):
        raise OpsError('fingerprint_inventory_invalid')


def primary_key_copy_sql(table):
    validate_fingerprint_inventory([table])
    name = table['table']
    ordering = ','.join('t."' + key + '"' for key in table['primary_key'])
    return "COPY (SELECT '" + name + "' AS relation,to_jsonb(t)::text AS row FROM " + name + ' t ORDER BY ' + ordering + ') TO STDOUT;'


def fingerprint_v2(container, inventory, snapshot_start=''):
    validate_fingerprint_inventory(inventory)
    digest = hashlib.sha256(b'royal-postgres-fingerprint-v2\n')
    total = 0
    for table in inventory:
        header = json.dumps(table, sort_keys=True, separators=(',', ':')).encode()
        digest.update(b'\x00TABLE\n' + header + b'\n')
        sql = (snapshot_start or 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; ') + "SET LOCAL timezone='UTC'; " + primary_key_copy_sql(table) + ' ROLLBACK;'
        _, size = query_digest(container, sql, 'table_fingerprint', digest=digest)
        total += size
        digest.update(b'\x00END_TABLE\n')
    return digest.hexdigest(), total


def local_snapshots(info):
    return 'DATABASE_LOCAL_SNAPSHOTS=false' not in info.get('Config', {}).get('Env', [])


def closed_database_network(info):
    return set(info.get('NetworkSettings', {}).get('Networks', {})) == {DATABASE_NETWORK} and not info.get('HostConfig', {}).get('PortBindings')


def audit_royal_roles(container, roles):
    if any(role not in ROYAL_LOGINS for role in roles):
        raise OpsError('invalid_royal_role_inventory')
    if not roles:
        return 0
    logins = ','.join("'" + role + "'" for role in roles)
    owned = ','.join("('" + role + "','" + schema + "')" for schema, role in ROYAL_OWNERS.items())
    sql = "WITH owned(login,schema) AS (VALUES " + owned + ") SELECT (SELECT count(*) FROM pg_roles WHERE rolname IN (" + logins + ") AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) + (SELECT count(*) FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname IN (" + logins + ")) + (SELECT count(*) FROM pg_roles r CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE r.rolname IN (" + logins + ") AND n.nspname IN (" + ','.join("'" + schema + "'" for schema in ROYAL_SCHEMAS) + ") AND c.relkind IN ('r','p') AND NOT EXISTS(SELECT FROM owned o WHERE o.login=r.rolname AND o.schema=n.nspname) AND has_table_privilege(r.oid,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'));"
    return int(query(container, sql, 'royal_role_audit'))



def finance_roles(version):
    return [OWNER, "royal_finance_runtime", "finance_app"] + (
        ["royal_finance_observer", "finance_ingest"] if version >= 2 else [])


def audit_role_login(role):
    if not isinstance(role, str) or len(role) > 63:
        return None
    if role in AUDIT_ROLES:
        return AUDIT_ROLES[role]
    return True if AUDIT_REVIEWER_ROLE.fullmatch(role) else None


def audit_metadata_valid(value):
    invalid = OpsError('invalid_audit_backup_inventory')
    if not isinstance(value, dict) or set(value) != {'format', 'roles', 'triggers', 'active_sources'} \
            or type(value['format']) is not int or value['format'] != 1:
        raise invalid
    roles, triggers, sources = value['roles'], value['triggers'], value['active_sources']
    if not isinstance(roles, list) or any(audit_role_login(role) is None for role in roles) \
            or roles != sorted(set(roles)) or not isinstance(triggers, list) or len(triggers) > len(AUDIT_SOURCE_TABLES):
        raise invalid
    relations = []
    enabled = set()
    for trigger in triggers:
        if not isinstance(trigger, dict) or set(trigger) != {'relation', 'enabled', 'trigger_sha256', 'function_sha256'} \
                or not isinstance(trigger['relation'], str) or trigger['relation'] not in AUDIT_SOURCE_TABLES \
                or trigger['enabled'] not in ('O', 'D') or any(
                    not isinstance(trigger[key], str) or not re.fullmatch('[a-f0-9]{64}', trigger[key])
                    for key in ('trigger_sha256', 'function_sha256')):
            raise invalid
        relations.append(trigger['relation'])
        if trigger['enabled'] == 'O':
            enabled.add(trigger['relation'])
    if relations != sorted(set(relations)) or not isinstance(sources, list) or any(
            not isinstance(source, str) or source not in enabled for source in sources) or sources != sorted(set(sources)):
        raise invalid
    return value


def audit_metadata_from_backup(metadata, all_tables, fingerprint_format):
    schemas = metadata.get('schemas', [])
    audit = metadata.get('audit')
    has_audit_schema = (isinstance(schemas, list) and AUDIT_SCHEMA in schemas) or any(
        table.startswith(AUDIT_SCHEMA + '.') for table in (all_tables or ()))
    if audit is not None:
        audit_metadata_valid(audit)
        expected_schemas = sorted({table.split('.')[0] for table in (all_tables or ())} | {AUDIT_SCHEMA})
        if fingerprint_format != 2 or schemas != expected_schemas:
            raise OpsError('invalid_audit_backup_schema_scope')
    elif has_audit_schema:
        raise OpsError('missing_audit_backup_inventory')
    return audit


def audit_restore_roles_sql(metadata):
    return ''.join(
        'CREATE ROLE "' + role + '" ' + ('LOGIN' if audit_role_login(role) else 'NOLOGIN')
        + ' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;'
        for role in audit_metadata_valid(metadata)['roles'])


def audit_backup_catalog(container, schemas, version, runtime_roles, snapshot_start=''):
    """Check the optional schema, referenced cluster roles, and cross-schema capture DDL."""
    if not set(schemas) <= set(ROYAL_SCHEMAS):
        raise OpsError('invalid_audit_backup_schema_scope')
    def read(sql, label):
        return json.loads(query(container, snapshot_start + sql + (' ROLLBACK;' if snapshot_start else ''), label))

    # Trigger definitions are returned only as digests. The qualified search path is
    # identical before backup and after restore, independent of caller role settings.
    scoped = ','.join("'" + schema + "'" for schema in sorted(set(schemas) | {AUDIT_SCHEMA}))
    catalog = read("""SET """ + ('LOCAL ' if snapshot_start else '') + """search_path=pg_catalog;
      SELECT jsonb_build_object(
        'present',to_regnamespace('royal_audit') IS NOT NULL,
        'triggers',coalesce((SELECT jsonb_agg(jsonb_build_object(
          'relation',n.nspname||'.'||c.relname, 'enabled',t.tgenabled,
          'trigger_sha256',encode(sha256(convert_to(pg_get_triggerdef(t.oid),'UTF8')),'hex'),
          'function_sha256',encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex'),
          'trusted',t.tgname='royal_audit_posting_v1' AND c.relkind='r'
            AND pns.nspname='royal_audit' AND p.proname='audit_capture_posting_v1'
            AND p.prosecdef AND pg_get_userbyid(p.proowner)='finance_schema_owner'
            AND p.proconfig=ARRAY['search_path=pg_catalog']
            AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
              WHERE a.grantee=0 AND a.privilege_type='EXECUTE')
            AND t.tgdeferrable AND t.tginitdeferred AND t.tgtype=5 AND t.tgnargs=0 AND t.tgqual IS NULL
        ) ORDER BY n.nspname,c.relname,t.tgname)
        FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace pns ON pns.oid=p.pronamespace
        WHERE NOT t.tgisinternal AND n.nspname IN (""" + scoped + """)
          AND (t.tgname='royal_audit_posting_v1' OR pns.nspname='royal_audit')),'[]'::jsonb));""", 'audit_capture_catalog')
    triggers = catalog['triggers']
    if any(trigger.pop('trusted', None) is not True for trigger in triggers):
        raise OpsError('untrusted_audit_capture')
    if not catalog['present']:
        if triggers:
            raise OpsError('missing_audit_backup_schema')
        return None

    # This inventory includes column-level grants and grants on source schemas.
    # Named operator membership and passwords are provisioned outside the archive.
    role_deps = read("""WITH deps AS (
      SELECT DISTINCT r.rolname, r.rolcanlogin, r.oid,
        (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls) AS elevated,
        coalesce(schema_obj.nspname,default_acl_schema.nspname,policy_schema.nspname,obj.schema) AS schema_name,
        d.deptype
      FROM pg_shdepend d JOIN pg_roles r ON r.oid=d.refobjid AND d.refclassid='pg_authid'::regclass
      CROSS JOIN LATERAL pg_identify_object(d.classid,d.objid,d.objsubid) obj
      LEFT JOIN pg_namespace schema_obj ON d.classid='pg_namespace'::regclass AND schema_obj.oid=d.objid
      LEFT JOIN pg_default_acl defaults ON d.classid='pg_default_acl'::regclass AND defaults.oid=d.objid
      LEFT JOIN pg_namespace default_acl_schema ON default_acl_schema.oid=defaults.defaclnamespace
      LEFT JOIN pg_policy policy ON d.classid='pg_policy'::regclass AND policy.oid=d.objid
      LEFT JOIN pg_class policy_table ON policy_table.oid=policy.polrelid
      LEFT JOIN pg_namespace policy_schema ON policy_schema.oid=policy_table.relnamespace
      WHERE d.dbid=(SELECT oid FROM pg_database WHERE datname=current_database())
    ), included AS (
      SELECT * FROM deps WHERE schema_name IN (""" + scoped + """)
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object('role',r.rolname,'login',r.rolcanlogin,
      'owns_audit',r.owns_audit,'safe',NOT r.elevated AND NOT has_database_privilege(r.oid,current_database(),'CREATE')
        AND NOT EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid)
        AND NOT EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname IN (""" + scoped + """) AND (
          has_schema_privilege(r.oid,n.oid,'CREATE') OR EXISTS(
            SELECT 1 FROM pg_class c WHERE c.relnamespace=n.oid AND c.relkind IN ('r','p','v','m','f')
              AND (r.rolname='royal_audit_reader' AND has_any_column_privilege(r.oid,c.oid,'SELECT')
                OR (r.rolname='royal_audit_reader' OR n.nspname<>'royal_audit') AND (
                  has_table_privilege(r.oid,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                  OR has_any_column_privilege(r.oid,c.oid,'INSERT,UPDATE,REFERENCES')))))
      )) ORDER BY r.rolname),'[]'::jsonb)
    FROM (SELECT rolname,rolcanlogin,oid,elevated,bool_or(schema_name='royal_audit' AND deptype='o') AS owns_audit
      FROM included GROUP BY rolname,rolcanlogin,oid,elevated) r;""", 'audit_role_dependencies')
    existing_roles = set(finance_roles(version)) | set(runtime_roles)
    audit_roles = []
    for role in role_deps:
        name = role['role']
        if role['owns_audit'] and name != OWNER:
            raise OpsError('untrusted_audit_object_owner')
        if name in existing_roles:
            continue
        login = audit_role_login(name)
        if login is None or role['login'] is not login or role['safe'] is not True:
            raise OpsError('untrusted_audit_backup_role')
        audit_roles.append(name)

    registry_count = read("""SELECT count(*) FROM (VALUES
      (to_regclass('royal_audit.audit_datasets')),
      (to_regclass('royal_audit.audit_dataset_sources')),
      (to_regclass('royal_audit.audit_posting_refs'))) required(oid)
      WHERE oid IS NOT NULL;""", 'audit_backup_registry')
    if registry_count != 3 and (registry_count or triggers):
        raise OpsError('missing_audit_backup_registry')
    sources = read("""SELECT coalesce(jsonb_agg(s.source_namespace ORDER BY s.source_namespace),'[]'::jsonb)
      FROM royal_audit.audit_dataset_sources s JOIN royal_audit.audit_datasets d ON d.id=s.dataset_id
      WHERE d.sealed_at_ms IS NULL;""", 'audit_backup_sources') if registry_count else []
    return audit_metadata_valid({'format': 1, 'roles': audit_roles, 'triggers': triggers, 'active_sources': sources})


def tables_for_version(version):
    if version not in (1, 2, 3):
        raise OpsError("unsupported_backup_schema")
    return BASE_TABLES + (DEPOSIT_TABLES if version >= 2 else ()) + (TOTAL_TABLES if version >= 3 else ())


def copy_sql(tables):
    return "COPY (SELECT relation,row FROM (" + " UNION ALL ".join(
        "SELECT '" + table + "' AS relation, to_jsonb(t)::text AS row FROM royal_finance."
        + table + " t" for table in tables
    ) + ") contents ORDER BY relation COLLATE \"C\", row COLLATE \"C\") TO STDOUT;"
NAME = re.compile(r"finance-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}\.dump")


class OpsError(Exception):
    pass


def failure_code(label, diagnostic):
    # Return fixed categories only. Database stderr can contain private row values.
    data = diagnostic.lower()
    for marker, category in ((b'no space left on device', 'storage_exhausted'),
                             (b'out of memory', 'memory_exhausted'),
                             (b'cannot allocate memory', 'memory_exhausted'),
                             (b'statement timeout', 'timeout'),
                             (b'lock timeout', 'lock_timeout')):
        if marker in data:
            return label + '_' + category
    return label + '_failed'


def stream_digest(args, label, input=b'', timeout=600, digest=None):
    """Hash exactly the subprocess output, without holding a database copy in RAM."""
    if digest is None:
        digest = hashlib.sha256()
    count = 0
    process = None
    deadline = time.monotonic() + timeout
    try:
        with tempfile.TemporaryFile() as errors:
            process = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=errors)
            process.stdin.write(input)
            process.stdin.close()
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise OpsError(label + '_timeout')
                readable, _, _ = select.select([process.stdout], [], [], min(remaining, 1))
                if not readable:
                    continue
                block = os.read(process.stdout.fileno(), 65536)
                if not block:
                    break
                digest.update(block)
                count += len(block)
            process.wait(timeout=max(0.01, deadline - time.monotonic()))
            if process.returncode:
                errors.seek(0)
                raise OpsError(failure_code(label, errors.read(16384)))
        return digest.hexdigest(), count
    except (OSError, subprocess.TimeoutExpired) as error:
        raise OpsError(label + ('_timeout' if isinstance(error, subprocess.TimeoutExpired) else '_unavailable')) from error
    finally:
        if process is not None:
            if process.poll() is None:
                process.kill()
                process.wait()
            if process.stdout is not None:
                process.stdout.close()
            if process.stdin is not None and not process.stdin.closed:
                process.stdin.close()


def query_digest(container, sql, label, digest=None):
    sql = "SET statement_timeout='10min'; SET lock_timeout='5s'; " + sql
    return stream_digest(psql_args(container), label, sql.encode(), digest=digest)


def restore_space_required(metadata):
    # Space includes restored relations, WAL and the deterministic comparison sort.
    estimates = [2 * 1024 ** 3, int(metadata.get('bytes', 0)) * 16]
    for key in ('database_bytes', 'fingerprint_bytes'):
        value = metadata.get(key)
        if value is not None:
            if not isinstance(value, int) or isinstance(value, bool) or value < 0:
                raise OpsError('backup_size_metadata_invalid')
            estimates.append(value * 4)
    return max(estimates)


def utc():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def atomic_json(path, value):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".partial")
    try:
        with temporary.open("x") as stream:
            json.dump(value, stream, sort_keys=True)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def read_json(path):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return {}


def record(kind, ok, **details):
    previous = read_json(STATE / (kind + ".json"))
    value = {"ok": ok, "checked_at": utc(), **details}
    if ok:
        value["last_success_at"] = value["checked_at"]
    elif "last_success_at" in previous:
        value["last_success_at"] = previous["last_success_at"]
    atomic_json(STATE / (kind + ".json"), value)
    print(json.dumps({"check": kind, **value}), flush=True)
    return value


def run(args, label, input=None, stdin=None, stdout=None, timeout=180):
    try:
        result = subprocess.run(args, input=input, stdin=stdin, stdout=stdout or subprocess.PIPE,
                                stderr=subprocess.PIPE, timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise OpsError(label + "_unavailable") from error
    if result.returncode:
        # Subprocess diagnostics can contain source data. Keep operational logs generic.
        raise OpsError(failure_code(label, result.stderr))
    return result.stdout


def compose(*args):
    return ["docker", "compose", "-f", str(ROOT / "compose.finance.yaml"), *args]


def db_container():
    value = run(compose("ps", "-q", "finance-db"), "find_database").decode().strip()
    if not re.fullmatch(r"[a-f0-9]{12,64}", value):
        raise OpsError("database_not_running")
    return value


def psql_args(container):
    return ["docker", "exec", "-i", container, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1",
            "-U", OWNER, "-d", DB]


def query(container, sql, label="database_query"):
    return run(psql_args(container), label, input=sql.encode(), timeout=180)


def role_safety_sql(login, profile):
    if login not in ("finance_app", "finance_ingest") or profile not in ("runtime", "observer"):
        raise OpsError("invalid_role_audit")
    source = (ROOT / "server/finance/role-safety.sql").read_text()
    body = source.split("AS $$\n", 1)[1].split("$$;", 1)[0]
    # These two literals are fixed operational identities, never user input.
    return re.sub(r"\bprofile\b", "'" + profile + "'", re.sub(r"\blogin\b", "'" + login + "'", body)).strip().rstrip(";")


def audit_roles(container, version):
    sql = "SELECT jsonb_build_object('runtime',(" + role_safety_sql("finance_app", "runtime") + ")"
    if version >= 2:
        sql += ",'observer',(" + role_safety_sql("finance_ingest", "observer") + ")"
    return json.loads(query(container, sql + ");", "live_role_audit"))


def sha256_stream(stream):
    digest = hashlib.sha256()
    for block in iter(lambda: stream.read(1024 * 1024), b""):
        digest.update(block)
    return digest.hexdigest()


def sha256(path):
    with path.open("rb") as stream:
        return sha256_stream(stream)


def candidates():
    return sorted(p for p in BACKUPS.glob("finance-*.dump")
                  if NAME.fullmatch(p.name) and p.with_suffix(".dump.json").is_file())


def latest():
    available = candidates()
    if not available:
        raise OpsError("no_complete_backup")
    return available[-1]


def backup():
    container = db_container()
    for unfinished in BACKUPS.glob("finance-*.dump.partial"):
        if NAME.fullmatch(unfinished.name[:-len(".partial")]) and unfinished.stat().st_mtime < time.time() - 86400:
            unfinished.unlink()
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    target = BACKUPS / ("finance-" + stamp + "-" + uuid.uuid4().hex[:8] + ".dump")
    temporary = target.with_suffix(".dump.partial")
    with tempfile.TemporaryFile() as errors:
        keeper = subprocess.Popen(psql_args(container), stdin=subprocess.PIPE,
                                  stdout=subprocess.PIPE, stderr=errors)
        try:
            keeper.stdin.write(b"BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT pg_export_snapshot();\n")
            keeper.stdin.flush()
            readable, _, _ = select.select([keeper.stdout], [], [], 30)
            if not readable:
                raise OpsError("snapshot_timeout")
            snapshot = keeper.stdout.readline().decode().strip()
            if not re.fullmatch(r"[A-Fa-f0-9]+-[A-Fa-f0-9]+-[0-9]+", snapshot):
                raise OpsError("snapshot_invalid")
            snapshot_start = "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET TRANSACTION SNAPSHOT '" + snapshot + "'; "
            version = int(query(container, snapshot_start + "SELECT version FROM royal_finance.meta; ROLLBACK;", "snapshot_schema"))
            tables = tables_for_version(version)
            role_audit = audit_roles(container, version)
            if any(value != 0 for value in role_audit.values()):
                raise OpsError("unsafe_source_roles")
            all_tables = unified_inventory(container, snapshot_start)
            schemas = sorted({table.split('.')[0] for table in all_tables})
            runtime_roles = json.loads(query(container, "SELECT coalesce(jsonb_agg(rolname ORDER BY rolname),'[]'::jsonb) FROM pg_roles WHERE rolname IN (" + ','.join("'" + role + "'" for role in ROYAL_LOGINS) + ");", 'runtime_role_inventory'))
            if audit_royal_roles(container, runtime_roles):
                raise OpsError('unsafe_royal_roles')
            audit = audit_backup_catalog(container, schemas, version, runtime_roles, snapshot_start)
            if audit is not None:
                schemas = sorted(set(schemas) | {AUDIT_SCHEMA})
            fingerprint_tables = fingerprint_inventory(container, snapshot_start)
            if [table['table'] for table in fingerprint_tables] != all_tables:
                raise OpsError('source_fingerprint_inventory_mismatch')
            fingerprint, fingerprint_bytes = fingerprint_v2(container, fingerprint_tables, snapshot_start)
            database_bytes = int(query(container, 'SELECT pg_database_size(current_database());', 'source_database_size'))
            with temporary.open("xb") as output:
                run(["docker", "exec", container, "pg_dump", "-U", OWNER, "-d", DB,
                     "--format=custom", "--snapshot=" + snapshot, *["--schema=" + schema for schema in schemas]], "database_dump", stdout=output, timeout=600)
                output.flush()
                os.fsync(output.fileno())
            with temporary.open("rb") as source:
                manifest = run(["docker", "exec", "-i", container, "pg_restore", "--list"],
                               "dump_catalog", stdin=source)
            metadata = {"format": 1, "scope": "royal-unified-postgres", "environment": "simulation", "asset": "USDT_SIM",
                        "created_at": utc(), "file": target.name, "bytes": temporary.stat().st_size,
                        "sha256": sha256(temporary), "data_sha256": fingerprint,
                        "schema_version": version, "tables": list(tables),
                        "all_tables": all_tables, "schemas": schemas, "runtime_roles": runtime_roles,
                        "database_bytes": database_bytes, "fingerprint_bytes": fingerprint_bytes,
                        "fingerprint_format": 2, "fingerprint_tables": fingerprint_tables,
                        "role_audit": role_audit,
                        "roles": finance_roles(version)}
            if audit is not None:
                metadata['audit'] = audit
            os.replace(temporary, target)
            target.with_suffix(".dump.manifest").write_bytes(manifest)
            atomic_json(target.with_suffix(".dump.json"), metadata)
            record("backup", True, file=target.name, sha256=metadata["sha256"], bytes=metadata["bytes"])
            # Only retire complete backups made by this script, after a new backup succeeded.
            cutoff = time.time() - 14 * 86400
            for old in candidates():
                if old != target and old.stat().st_mtime < cutoff:
                    for suffix in (".dump", ".dump.json", ".dump.manifest", ".dump.restore.json"):
                        old.with_suffix(suffix).unlink(missing_ok=True)
            return target
        finally:
            temporary.unlink(missing_ok=True)
            if keeper.poll() is None:
                keeper.terminate()
                try:
                    keeper.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    keeper.kill()
                    keeper.wait()


RECONCILE_SQL = """
SELECT jsonb_build_object(
 'mismatched_accounts', (SELECT count(*) FROM royal_finance.accounts a WHERE a.balance <>
   (SELECT coalesce(sum(e.delta),0) FROM royal_finance.entries e WHERE e.account_id=a.id)),
 'unbalanced_journals', (SELECT count(*) FROM royal_finance.journals j WHERE
   (SELECT coalesce(sum(delta),0) FROM royal_finance.entries WHERE journal_id=j.id) <> 0 OR
   (SELECT count(*) FROM royal_finance.entries WHERE journal_id=j.id) < 2),
 'negative_accounts', (SELECT count(*) FROM royal_finance.accounts WHERE bucket <> 'assets' AND balance < 0),
 'net_units', (SELECT coalesce(sum(balance),0)::text FROM royal_finance.accounts),
 'missing_outbox', (SELECT count(*) FROM royal_finance.requests q LEFT JOIN royal_finance.outbox o
   ON o.actor=q.actor AND o.request_key=q.key WHERE o.id IS NULL),
 'reservation_mismatches', (SELECT count(*) FROM royal_finance.accounts a WHERE
   (a.bucket='withdrawal_reserved' AND a.balance <>
    (SELECT coalesce(sum(amount+fee),0) FROM royal_finance.withdrawals WHERE user_id=a.owner_id AND status IN ('reserved','unknown'))) OR
   (a.bucket='game_reserved' AND a.balance <>
    (SELECT coalesce(sum(stake),0) FROM royal_finance.rounds WHERE user_id=a.owner_id AND status='reserved')) OR
   (a.bucket='house_reserved' AND a.balance <>
    (SELECT coalesce(sum(max_payout),0) FROM royal_finance.rounds WHERE status='reserved'))),
 'invalid_runtime_roles', (SELECT count(*) FROM pg_roles WHERE rolname IN ('finance_app','royal_finance_runtime')
   AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)),
 'writable_runtime_tables', (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='royal_finance' AND c.relkind='r' AND has_table_privilege('finance_app',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE')),
 'runtime_schema_create', has_schema_privilege('finance_app','royal_finance','CREATE'),
 'runtime_private_execute', (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='royal_finance' AND p.proname NOT IN ('execute','create_user','deposit_address','role_safety')
   AND has_function_privilege('finance_app',p.oid,'EXECUTE')),
 'runtime_missing_membership', NOT pg_has_role('finance_app','royal_finance_runtime','USAGE'),
 'guard_trigger_count', (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
   JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='royal_finance' AND t.tgenabled='O'
   AND t.tgname IN ('immutable_journals','immutable_entries','immutable_requests','immutable_outbox',
                   'sealed_entries','balanced_journal','reconciled_account','immutable_deposit_addresses',
                   'immutable_deposit_blocks','immutable_deposit_events','initialize_account_total',
                   'accumulate_entry_total','protected_account_totals','protected_total_truncate','reconciled_total')),
 'invalid_meta', (SELECT count(*) FROM royal_finance.meta WHERE version NOT IN (1,2,3) OR environment<>'simulation' OR asset<>'USDT_SIM' OR scale<>6),
 'schema_version', (SELECT version FROM royal_finance.meta),
 'meta_rows', (SELECT count(*) FROM royal_finance.meta),
 'counts', (SELECT jsonb_object_agg(relation, n) FROM (
   SELECT 'users' AS relation, count(*) AS n FROM royal_finance.users UNION ALL
   SELECT 'accounts', count(*) FROM royal_finance.accounts UNION ALL
   SELECT 'journals', count(*) FROM royal_finance.journals UNION ALL
   SELECT 'entries', count(*) FROM royal_finance.entries UNION ALL
   SELECT 'requests', count(*) FROM royal_finance.requests UNION ALL
   SELECT 'withdrawals', count(*) FROM royal_finance.withdrawals UNION ALL
   SELECT 'rounds', count(*) FROM royal_finance.rounds UNION ALL
   SELECT 'outbox', count(*) FROM royal_finance.outbox) c)
);
"""


def reconciliation_sql(version):
    base = "SELECT checks || jsonb_build_object('unsafe_runtime_roles',(" + role_safety_sql("finance_app", "runtime") + ")) FROM (" + RECONCILE_SQL.strip().rstrip(';') + ") base(checks)"
    if version == 1:
        return base + ";"
    deposits = "SELECT checks || jsonb_build_object(" + """
      'counts', (checks->'counts') || (SELECT jsonb_build_object(
        'deposit_streams',(SELECT count(*) FROM royal_finance.deposit_streams),
        'deposit_addresses',(SELECT count(*) FROM royal_finance.deposit_addresses),
        'deposit_blocks',(SELECT count(*) FROM royal_finance.deposit_blocks),
        'deposit_events',(SELECT count(*) FROM royal_finance.deposit_events))),
      'deposit_credit_mismatches',(SELECT count(*) FROM royal_finance.deposit_events e
        LEFT JOIN royal_finance.requests r ON r.actor='simulator' AND r.key=e.request_key
        WHERE e.disposition='credited' AND (r.key IS NULL OR r.kind<>'simulate_deposit'
          OR r.body->>'eventId' IS DISTINCT FROM e.event_id::text OR r.body->>'userId' IS DISTINCT FROM e.user_id
          OR r.body->>'amountUnits' IS DISTINCT FROM e.amount::text)),
      'deposit_cursor_mismatches',(SELECT count(*) FROM royal_finance.deposit_streams s
        WHERE s.cursor_height<>(SELECT count(*) FROM royal_finance.deposit_blocks b WHERE b.network=s.network)
          OR s.cursor_height<>(SELECT coalesce(max(height),0) FROM royal_finance.deposit_blocks b WHERE b.network=s.network)
          OR s.cursor_hash IS DISTINCT FROM coalesce((SELECT hash FROM royal_finance.deposit_blocks b
            WHERE b.network=s.network AND b.height=s.cursor_height),repeat('0',64))),
      'deposit_halted_streams',(SELECT count(*) FROM royal_finance.deposit_streams WHERE halted_reason IS NOT NULL),
      'observer_invalid_roles',(SELECT count(*) FROM pg_roles WHERE rolname IN ('finance_ingest','royal_finance_observer')
        AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)),
      'observer_writable_tables',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='royal_finance' AND c.relkind='r' AND has_table_privilege('finance_ingest',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE')),
      'observer_private_execute',(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='royal_finance' AND p.proname NOT IN ('ingest_deposit_block','halt_deposit_stream','role_safety')
          AND has_function_privilege('finance_ingest',p.oid,'EXECUTE')),
      'observer_schema_create',has_schema_privilege('finance_ingest','royal_finance','CREATE'),
      'observer_missing_membership',NOT pg_has_role('finance_ingest','royal_finance_observer','USAGE')
    ) FROM (
    """ + base + ") restored(checks)"
    role_checks = "SELECT checks || jsonb_build_object('unsafe_observer_roles',(" + role_safety_sql("finance_ingest", "observer") + ")) FROM (" + deposits + ") deposits(checks)"
    if version == 2:
        return role_checks + ";"
    return "SELECT checks || jsonb_build_object('counts', (checks->'counts') || jsonb_build_object('account_totals',(SELECT count(*) FROM royal_finance.account_totals)), 'mismatched_totals',(SELECT count(*) FROM royal_finance.account_totals t FULL JOIN royal_finance.accounts a ON a.id=t.account_id WHERE a.id IS NULL OR t.account_id IS NULL OR a.balance IS DISTINCT FROM t.balance OR t.balance IS DISTINCT FROM (SELECT coalesce(sum(delta),0) FROM royal_finance.entries e WHERE e.account_id=t.account_id))) FROM (" + role_checks + ") totals(checks);"


def restore_check(target):
    if target.parent.resolve() != BACKUPS.resolve() or not NAME.fullmatch(target.name):
        raise OpsError("restore_backup_path_invalid")
    receipt = target.with_suffix('.dump.restore.json')
    previous = read_json(receipt)
    attempt = {'ok': False, 'file': target.name, 'status': 'in-progress', 'checked_at': utc()}
    if isinstance(previous, dict) and 'last_success_at' in previous:
        attempt['last_success_at'] = previous['last_success_at']
    atomic_json(receipt, attempt)
    try:
        result = _restore_archive(target)
    except Exception as error:
        code = str(error) if isinstance(error, OpsError) else type(error).__name__
        atomic_json(receipt, {**attempt, 'status': 'failed', 'checked_at': utc(), 'error': code})
        raise
    result['cleanup_verified'] = True
    value = record('restore', True, status='complete', **result)
    atomic_json(receipt, value)
    return result


def _restore_archive(target):
    metadata = read_json(target.with_suffix(".dump.json"))
    if not isinstance(metadata, dict) or metadata.get("file") != target.name:
        raise OpsError("backup_checksum_mismatch")
    with _verified_restore_source(target, metadata.get("sha256")) as (source, verify_source):
        return _restore_into_workspace(metadata, source, verify_source)


@contextmanager
def _verified_restore_source(target, expected_sha256):
    try:
        source = open(target, "rb", opener=lambda path, flags: os.open(path, flags | os.O_NOFOLLOW | os.O_NONBLOCK))
    except OSError as error:
        raise OpsError("restore_backup_file_invalid") from error

    def identity(info):
        return info.st_dev, info.st_ino, info.st_mode, info.st_size, info.st_mtime_ns, info.st_ctime_ns

    with source:
        opened = os.fstat(source.fileno())
        if not stat.S_ISREG(opened.st_mode):
            raise OpsError("restore_backup_file_invalid")
        expected = identity(opened)

        def verify_source():
            try:
                current = target.lstat()
                descriptor = os.fstat(source.fileno())
            except OSError as error:
                raise OpsError("restore_backup_archive_changed") from error
            if identity(current) != expected or identity(descriptor) != expected:
                raise OpsError("restore_backup_archive_changed")

        verify_source()
        digest = sha256_stream(source)
        verify_source()
        if digest != expected_sha256:
            raise OpsError("backup_checksum_mismatch")
        source.seek(0)
        yield source, verify_source
        verify_source()


def _restore_into_workspace(metadata, source, verify_source):
    version = metadata.get("schema_version", 1)
    tables = tables_for_version(version)
    if metadata.get("tables") != list(tables):
        raise OpsError("backup_table_inventory_invalid")
    all_tables = metadata.get('all_tables')
    if all_tables is not None:
        if not isinstance(all_tables, list) or sorted(set(all_tables)) != all_tables or any(table.split('.')[0] not in ROYAL_SCHEMAS for table in all_tables):
            raise OpsError('unified_backup_inventory_invalid')
        qualified_copy_sql(all_tables)
    runtime_roles = metadata.get('runtime_roles', [])
    if not isinstance(runtime_roles, list) or any(role not in ROYAL_LOGINS for role in runtime_roles) or len(runtime_roles) != len(set(runtime_roles)):
        raise OpsError('unified_backup_roles_invalid')
    fingerprint_format = metadata.get('fingerprint_format', 1)
    if not isinstance(fingerprint_format, int) or isinstance(fingerprint_format, bool) or fingerprint_format not in (1, 2):
        raise OpsError('unsupported_fingerprint_format')
    if fingerprint_format == 2:
        fingerprint_tables = metadata.get('fingerprint_tables')
        validate_fingerprint_inventory(fingerprint_tables)
        if [table['table'] for table in fingerprint_tables] != all_tables:
            raise OpsError('backup_fingerprint_inventory_mismatch')
    audit = audit_metadata_from_backup(metadata, all_tables, fingerprint_format)
    schemas = metadata.get('schemas', [])
    image = run(["docker", "inspect", db_container(), "--format", "{{.Image}}"], "database_image").decode().strip()
    if not re.fullmatch(r"sha256:[a-f0-9]{64}", image):
        raise OpsError("database_image_invalid")
    container = "royal-finance-restore-" + uuid.uuid4().hex[:12]
    started = time.monotonic()
    required_space = restore_space_required(metadata)
    if shutil.disk_usage(STATE).free < required_space:
        raise OpsError('restore_workspace_space_insufficient')
    workspace_path = Path(tempfile.mkdtemp(prefix='restore-', dir=STATE))
    created = False
    try:
        os.chown(workspace_path, 999, 999)
        workspace_path.chmod(0o700)
        run(["docker", "run", "--detach", "--rm", "--name", container,
             "--label", "royal.finance.restore=1", "--network", "none", "--user", "postgres",
             "--memory", "512m", "--cpus", "0.5", "--pids-limit", "128", "--read-only",
             "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
             "--mount", 'type=bind,source=' + str(workspace_path) + ',target=/var/lib/postgresql/data',
             "--tmpfs", "/var/run/postgresql:uid=999,gid=999,mode=0775,size=16m",
             "--tmpfs", "/tmp:size=32m", "-e", "POSTGRES_USER=" + OWNER,
             "-e", "POSTGRES_DB=" + DB, "-e", "POSTGRES_HOST_AUTH_METHOD=trust", image,
             'postgres', '-c', 'shared_buffers=64MB', '-c', 'work_mem=8MB',
             '-c', 'maintenance_work_mem=32MB', '-c', 'max_parallel_workers_per_gather=0',
             '-c', 'max_parallel_maintenance_workers=0', '-c', 'max_wal_size=256MB'], "restore_container")
        created = True
        deadline = time.monotonic() + 90
        while True:
            try:
                query(container, "SELECT 1;", "restore_ready")
                break
            except OpsError:
                if time.monotonic() >= deadline:
                    raise OpsError("restore_start_timeout")
                time.sleep(1)
        query(container, "CREATE ROLE royal_finance_runtime NOLOGIN; CREATE ROLE finance_app LOGIN; "
                         "GRANT royal_finance_runtime TO finance_app WITH INHERIT TRUE;", "restore_roles")
        if version >= 2:
            query(container, "CREATE ROLE royal_finance_observer NOLOGIN; CREATE ROLE finance_ingest LOGIN; "
                             "GRANT royal_finance_observer TO finance_ingest WITH INHERIT TRUE;", "restore_observer_roles")
        for role in runtime_roles:
            query(container, 'CREATE ROLE ' + role + ' LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; GRANT CONNECT' + ('' if role in ('royal_nile_views_app', 'royal_nile_reconcile_app') else ', CREATE') + ' ON DATABASE ' + DB + ' TO ' + role + ';', 'restore_royal_role')
        if audit is not None and audit['roles']:
            query(container, audit_restore_roles_sql(audit), 'restore_audit_roles')
        verify_source()
        run(["docker", "exec", "-i", container, "pg_restore", "-U", OWNER, "-d", DB,
             "--single-transaction", "--exit-on-error"], "restore_database", stdin=source, timeout=600)
        verify_source()
        if fingerprint_format == 2:
            restored_inventory = fingerprint_inventory(container)
            if restored_inventory != fingerprint_tables:
                raise OpsError('restored_fingerprint_inventory_mismatch')
            fingerprint, fingerprint_bytes = fingerprint_v2(container, restored_inventory)
        else:
            fingerprint, fingerprint_bytes = query_digest(container, "SET timezone='UTC'; " + (qualified_copy_sql(all_tables) if all_tables is not None else copy_sql(tables)), "restored_fingerprint")
        if fingerprint != metadata.get("data_sha256"):
            raise OpsError("restored_data_mismatch")
        if audit is not None and audit_backup_catalog(container, schemas, version, runtime_roles) != audit:
            raise OpsError('restored_audit_inventory_mismatch')
        checks = json.loads(query(container, reconciliation_sql(version), "restore_reconciliation"))
        if audit_royal_roles(container, runtime_roles):
            raise OpsError('restored_royal_roles_invalid')
        for name, value in checks.items():
            if name in ("counts", "deposit_halted_streams"):
                continue
            expected = {"net_units": "0", "meta_rows": 1, "schema_version": version,
                        "guard_trigger_count": {1: 7, 2: 10, 3: 15}[version]}.get(name, 0)
            if value != expected:
                raise OpsError("restored_" + name + "_invalid")
        query(container, "SET ROLE finance_app; SELECT count(*) FROM royal_finance.accounts;", "restore_runtime_read")
        result = {"file": metadata["file"], "sha256": metadata["sha256"], "data_sha256": fingerprint,
                  "seconds": round(time.monotonic() - started, 2), "checks": checks,
                  "isolated_container": container, "network": "none", "live_volume_attached": False,
                  "storage": "private-disk-workspace", "memory_limit_bytes": 512 * 1024 ** 2,
                  "required_disk_free_bytes": required_space, "fingerprint_bytes": fingerprint_bytes}
        result['fingerprint_format'] = fingerprint_format
        if audit is not None:
            result['audit_verified'] = True
        return result
    finally:
        # The unique name identifies only this operation's isolated container.
        try:
            cleanup = subprocess.run(['docker', 'rm', '--force', container],
                                     capture_output=True, timeout=30)
        except (OSError, subprocess.TimeoutExpired) as error:
            # Preserve the workspace while container shutdown remains uncertain.
            raise OpsError('restore_cleanup_unavailable') from error
        if cleanup.returncode and (created or b'No such container' not in cleanup.stderr):
            # Keep the private workspace if container shutdown cannot be confirmed.
            raise OpsError('restore_cleanup_failed')
        try:
            shutil.rmtree(workspace_path)
        except OSError as error:
            raise OpsError('restore_workspace_cleanup_failed') from error


def age(path):
    state = read_json(path)
    try:
        return max(0, (dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(state["last_success_at"])).total_seconds())
    except (KeyError, ValueError, TypeError):
        return float("inf")


def nile_latest():
    directory = Path('/opt/royal-nile-test-data/backups')
    pattern = re.compile(r'nile-credit-[0-9]{8}T[0-9]{9}Z-[a-f0-9]{8}\.pg\.json')
    files = sorted(file for file in directory.glob('nile-credit-*.pg.json')
                   if pattern.fullmatch(file.name) and Path(str(file) + '.meta.json').is_file())
    if not files:
        raise OpsError('nile_backup_missing')
    target = files[-1]
    metadata_file = Path(str(target) + '.meta.json')
    metadata = read_json(metadata_file)
    if target.is_symlink() or metadata_file.is_symlink() or not isinstance(metadata, dict) \
            or not isinstance(metadata.get('checks'), dict) or metadata.get('file') != target.name or metadata.get('ok') is not True \
            or metadata['checks'].get('asset') != 'USDT_NILE_TEST' or metadata['checks'].get('network') != 'nile' \
            or metadata['checks'].get('testOnly') is not True \
            or not re.fullmatch('[a-f0-9]{64}', metadata.get('sha256', '')):
        raise OpsError('nile_backup_metadata_invalid')
    return {'directory': str(directory), 'metadata': metadata}


def nile_reconcile():
    args = ['docker', 'compose', '-f', str(ROOT / 'deployment/finance/compose.nile-reconcile.yaml'),
            'run', '--rm', '--no-deps', '--name', 'royal-nile-reconcile-once', 'nile-reconcile']
    try:
        result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=300)
        if result.stdout.strip():
            value = json.loads(result.stdout)
        else:
            value = {}
            for line in reversed(result.stderr.decode(errors='replace').splitlines()):
                try:
                    candidate = json.loads(line)
                    if candidate.get('ok') is False and re.fullmatch('[a-z_]+', candidate.get('code', '')):
                        value = candidate
                        break
                except (ValueError, AttributeError, TypeError):
                    pass
        if value.get('ok') is True and (result.returncode or value.get('network') != 'nile'
                                       or value.get('asset') != 'USDT_NILE_TEST' or value.get('spendable') is not False):
            raise OpsError('unsafe_nile_reconciliation_result')
        if 'ok' not in value:
            raise OpsError('nile_reconciliation_unavailable')
        ok = value.pop('ok') is True
        return record('nile_reconciliation', ok, **value)
    except (OSError, ValueError, subprocess.TimeoutExpired):
        # Remove only this owned one-shot container after a failed or timed-out run.
        subprocess.run(['docker', 'rm', '--force', 'royal-nile-reconcile-once'],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15)
        raise OpsError('nile_reconciliation_unavailable')


def monitor():
    issues = []
    node = """const fs=require('node:fs'); const token=fs.readFileSync('/run/secrets/finance_sandbox_token','utf8').trim();
    (async()=>{const h=await fetch('http://finance-gateway:2570/healthz',{signal:AbortSignal.timeout(10000)});
    if(!h.ok)process.exit(1); const r=await fetch('http://finance-gateway:2570/sandbox/reconciliation',
    {headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});
    const b=await r.json(); if(!r.ok||!b.ok||b.deposit_halted_streams>0||b.asset!=='USDT_SIM'||b.environment!=='simulation')process.exit(1);
    process.stdout.write(JSON.stringify({ok:true,asset:b.asset,environment:b.environment}));})().catch(()=>process.exit(1));"""
    probe_container = None
    try:
        raw = run(compose("ps", "--all", "--format", "json"), "container_status").decode().strip()
        containers = json.loads(raw) if raw.startswith("[") else [json.loads(line) for line in raw.splitlines()]
        active = {}
        for item in containers:
            active.setdefault(item["Service"], []).append(item)
        for name, expected_count in (("finance-api", 2), ("finance-db", 1), ("finance-gateway", 1)):
            items = active.get(name, [])
            healthy = [item for item in items if item.get("State") == "running" and item.get("Health") == "healthy"]
            if len(healthy) < expected_count or len(healthy) != len(items):
                issues.append(name + "_not_healthy")
            if any(p.get("PublishedPort", 0) for item in items for p in (item.get("Publishers") or [])):
                issues.append(name + "_port_published")
            if name == "finance-api" and healthy:
                probe_container = healthy[0].get("ID")
    except (OpsError, ValueError, KeyError):
        issues.append("container_status_unavailable")
    try:
        container = db_container()
        version = int(query(container, "SELECT version FROM royal_finance.meta;", "monitor_schema"))
        if any(value != 0 for value in audit_roles(container, version).values()):
            issues.append("unsafe_database_roles")
        present = json.loads(query(container, "SELECT coalesce(jsonb_agg(rolname),'[]'::jsonb) FROM pg_roles WHERE rolname IN (" + ','.join("'" + role + "'" for role in ROYAL_LOGINS) + ");", 'monitor_royal_roles'))
        if audit_royal_roles(container, present):
            issues.append('unsafe_royal_roles')
    except (OpsError, ValueError, IndexError, OSError):
        issues.append("database_role_audit_failed")
    try:
        if not probe_container or not re.fullmatch(r"[a-f0-9]{12,64}", probe_container):
            raise OpsError("no_healthy_api")
        run(["docker", "exec", probe_container, "node", "-e", node], "api_reconciliation", timeout=35)
    except OpsError:
        issues.append("api_or_reconciliation_failed")
    disk = shutil.disk_usage(BACKUPS)
    if disk.free < 2 * 1024 ** 3 or disk.free / disk.total < 0.1:
        issues.append("disk_space_low")
    if age(STATE / "backup.json") > 7200:
        issues.append("backup_stale")
    if not read_json(STATE / "backup.json").get("ok"):
        issues.append("latest_backup_failed")
    if age(STATE / "restore.json") > 30 * 3600:
        issues.append("restore_check_stale")
    if not read_json(STATE / "restore.json").get("ok"):
        issues.append("latest_restore_failed")
    if (STATE / "tron-reader-required.json").exists():
        try:
            required = read_json(STATE / "tron-reader-required.json")
            if required != {"network": "nile", "mode": "watch-only", "container": "royal-tron-reader"}:
                raise OpsError("invalid_tron_reader_marker")
            raw = run(["docker", "inspect", "--format", "{{json .State}}", "royal-tron-reader"], "tron_reader_container", timeout=10)
            container_state = json.loads(raw)
            if not container_state.get("Running") or container_state.get("Health", {}).get("Status") != "healthy":
                raise OpsError("unhealthy_tron_reader")
            reader_info = json.loads(run(['docker', 'inspect', 'royal-tron-reader'], 'reader_configuration'))[0]
            reader = json.loads(run(["docker", "exec", "royal-tron-reader", "node", "reader.js", "status"], "tron_reader_status", timeout=15))
            if not reader.get("ok") or reader.get("network") != "nile" or reader.get("mode") != "watch-only" or reader.get("moneyCredited") is not False:
                raise OpsError("unsafe_tron_reader_status")
            if local_snapshots(reader_info) and time.time() * 1000 - (reader.get("lastBackupAt") or 0) > 7200000:
                issues.append("tron_reader_backup_stale")
        except (OpsError, ValueError, TypeError):
            issues.append("tron_reader_not_ready")
    nile_status = None
    if (STATE / "nile-creditor-required.json").exists():
        try:
            required = read_json(STATE / "nile-creditor-required.json")
            if required != {"network": "nile", "asset": "USDT_NILE_TEST", "container": "royal-nile-creditor"}:
                raise OpsError("invalid_nile_creditor_marker")
            info = json.loads(run(["docker", "inspect", "royal-nile-creditor"], "nile_creditor_container", timeout=10))[0]
            if not info["State"].get("Running") or info["State"].get("Health", {}).get("Status") != "healthy":
                raise OpsError("unhealthy_nile_creditor")
            mounts = {item["Destination"]: item for item in info.get("Mounts", [])}
            if not closed_database_network(info):
                raise OpsError("unsafe_nile_creditor_network")
            if set(mounts) != {"/data", "/reader", "/config", "/run/secrets/royal_database_password"} or mounts["/reader"].get("RW") or mounts["/config"].get("RW"):
                raise OpsError("unsafe_nile_creditor_mounts")
            status = json.loads(run(["docker", "exec", "royal-nile-creditor", "node", "creditor.js", "status"], "nile_creditor_status", timeout=15))
            nile_status = status
            if not status.get("ok") or status.get("network") != "nile" or status.get("asset") != "USDT_NILE_TEST" \
                    or status.get("testOnly") is not True or status.get("hasSigningKeys") is not False:
                raise OpsError("unsafe_nile_creditor_status")
            if any(balance.get("spendable") is not False for balance in status.get("balances", [])):
                raise OpsError("spendable_nile_test_balance")
            if local_snapshots(info) and time.time() * 1000 - (status.get("lastBackupAt") or 0) > 7200000:
                issues.append("nile_creditor_backup_stale")
        except (OpsError, ValueError, TypeError, KeyError, IndexError):
            issues.append("nile_creditor_not_ready")
    if (STATE / 'nile-reconciliation-required.json').exists():
        expected = {'network': 'nile', 'asset': 'USDT_NILE_TEST', 'mode': 'read-only'}
        check = read_json(STATE / 'nile_reconciliation.json')
        if read_json(STATE / 'nile-reconciliation-required.json') != expected:
            issues.append('invalid_nile_reconciliation_marker')
        if check.get('ok') is not True or check.get('network') != 'nile' or check.get('asset') != 'USDT_NILE_TEST' \
                or check.get('testOnly') is not True or check.get('spendable') is not False:
            issues.append('nile_reconciliation_failed')
        if age(STATE / 'nile_reconciliation.json') > 600:
            issues.append('nile_reconciliation_stale')
        if nile_status and check.get('ok') is True:
            try:
                liability = sum(int(balance['availableUnits']) for balance in nile_status['balances'])
                if liability != int(check['liabilitiesUnits']) or nile_status['credits'] != check['credits']:
                    issues.append('nile_reconciliation_balances_changed')
            except (ValueError, KeyError, TypeError):
                issues.append('nile_reconciliation_invalid')
    if (STATE / 'nile-account-views-required.json').exists():
        try:
            scope = dict(network='nile', asset='USDT_NILE_TEST', scale=6, testOnly=True, spendable=False)
            if read_json(STATE / 'nile-account-views-required.json') != scope:
                raise OpsError('invalid_nile_account_view_marker')
            view = read_json(Path('/opt/royal-nile-account-views/wallets.json'))
            bindings = read_json(Path('/opt/royal-nile-account-bindings/bindings.json'))
            expected_hash = hashlib.sha256(json.dumps(bindings, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()
            if any(view.get(key) != value for key, value in scope.items()) or view.get('ready') is not True \
                    or type(view.get('generatedAt')) is not int or not -30000 <= time.time() * 1000 - view['generatedAt'] <= 120000 \
                    or view.get('bindingsSha256') != expected_hash or len(view.get('wallets', [])) != len(bindings.get('bindings', [])):
                raise OpsError('nile_account_views_not_ready')
            container = run(['docker', 'compose', '-f', '/opt/royal/compose.yaml', 'ps', '-q', 'game'], 'find_game', timeout=10).decode().strip()
            info = json.loads(run(['docker', 'inspect', container], 'game_view_mount', timeout=10))[0]
            mounts = {item['Destination']: item for item in info.get('Mounts', [])}
            if '/nile-view' not in mounts or mounts['/nile-view'].get('RW') \
                    or mounts['/nile-view'].get('Source') != '/opt/royal-nile-account-views' \
                    or any(path in mounts for path in ('/ledger', '/bindings', '/config', '/reader')):
                raise OpsError('unsafe_game_nile_mount')
        except (OpsError, ValueError, TypeError, KeyError, IndexError):
            issues.append('nile_account_views_not_ready')
    if (STATE / 'nile-play-required.json').exists():
        try:
            marker = read_json(STATE / 'nile-play-required.json')
            if marker != dict(network='nile', asset='USDT_NILE_TEST', container='royal-nile-play', testOnly=True, withdrawable=False):
                raise OpsError('invalid_play_marker')
            info = json.loads(run(['docker', 'inspect', 'royal-nile-play'], 'play_container', timeout=10))[0]
            mounts = {item['Destination']: item for item in info.get('Mounts', [])}
            if not info['State'].get('Running') or info['State'].get('Health', {}).get('Status') != 'healthy' \
                    or not closed_database_network(info) \
                    or info['Config'].get('User') != 'node' or not info['HostConfig'].get('ReadonlyRootfs') \
                    or set(mounts) != {'/data', '/config', '/ledger', '/operations', '/run/nile', '/run/secrets/royal_database_password'} \
                    or any(mounts[path].get('RW') for path in ('/config', '/ledger', '/operations')):
                raise OpsError('unsafe_play_container')
            play = json.loads(run(['docker', 'exec', 'royal-nile-play', 'node', 'play.js', 'status'], 'play_status', timeout=15))
            if not play.get('ok') or not play.get('ready') or play.get('network') != 'nile' or play.get('asset') != 'USDT_NILE_TEST' \
                    or play.get('testOnly') is not True or play.get('withdrawable') is not False or play.get('halted'):
                raise OpsError('play_not_ready')
            if nile_status and (play['credits'] != nile_status['credits'] or int(play['totalUnits']) != sum(int(row['availableUnits']) for row in nile_status['balances'])):
                raise OpsError('play_source_changed')
            if int(play['houseUnits']) + int(play['playerUnits']) != int(play['totalUnits']):
                raise OpsError('play_backing_mismatch')
            backup = read_json(Path('/opt/royal-nile-play-data/backups/latest.json'))
            if local_snapshots(info) and (time.time() - dt.datetime.fromisoformat(backup.get('createdAt', '').replace('Z', '+00:00')).timestamp() > 900 or backup.get('audit', {}).get('ok') is not True):
                raise OpsError('play_backup_stale')
            container = run(['docker', 'compose', '-f', '/opt/royal/compose.yaml', 'ps', '-q', 'game'], 'find_game', timeout=10).decode().strip()
            game = json.loads(run(['docker', 'inspect', container], 'game_play_mount', timeout=10))[0]
            mount = next((row for row in game['Mounts'] if row['Destination'] == '/nile-play'), {})
            if mount.get('RW') or mount.get('Source') != '/opt/royal-nile-play-sockets' or any(row['Destination'] in ('/data', '/ledger', '/config', '/operations', '/run/nile') for row in game['Mounts']):
                raise OpsError('unsafe_game_play_mount')
        except (OpsError, ValueError, TypeError, KeyError, IndexError):
            issues.append('nile_play_not_ready')
    return record("monitor", not issues, issues=issues, disk_free_bytes=disk.free)


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("backup", "restore-check", "monitor", "latest", "status", "nile-latest", "nile-reconcile"))
    args = parser.parse_args()
    BACKUPS.mkdir(mode=0o700, parents=True, exist_ok=True)
    STATE.mkdir(mode=0o700, parents=True, exist_ok=True)
    if args.command == "latest":
        target = latest()
        print(json.dumps({"directory": str(BACKUPS), "metadata": read_json(target.with_suffix(".dump.json")),
                          "restore": read_json(target.with_suffix(".dump.restore.json"))}))
        return
    if args.command == "status":
        value = {kind: read_json(STATE / (kind + '.json')) for kind in ('backup', 'restore', 'monitor', 'nile_reconciliation')}
        metadata = read_json(latest().with_suffix('.dump.json')) if candidates() else {}
        value['unified_postgres'] = {'royal_game', 'royal_tron_reader', 'royal_nile_deposits', 'royal_nile_play'} <= set(metadata.get('schemas', []))
        value['nile_required'] = (STATE / 'nile-creditor-required.json').exists()
        value['nile_accounts_required'] = (STATE / 'nile-account-views-required.json').exists()
        value['nile_play_required'] = (STATE / 'nile-play-required.json').exists()
        print(json.dumps(value))
        return
    if args.command == 'nile-latest':
        print(json.dumps(nile_latest()))
        return
    lock_name = 'nile-reconcile.lock' if args.command == 'nile-reconcile' else "monitor.lock" if args.command == "monitor" else "operations.lock"
    with (STATE / lock_name).open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        kind = 'nile_reconciliation' if args.command == 'nile-reconcile' else "restore" if args.command == "restore-check" else args.command
        try:
            if args.command == 'nile-reconcile':
                if not nile_reconcile()['ok']:
                    sys.exit(1)
            elif args.command == "backup":
                backup()
            elif args.command == "restore-check":
                restore_check(latest())
            else:
                if not monitor()["ok"]:
                    sys.exit(1)
        except Exception as error:
            code = str(error) if isinstance(error, OpsError) else type(error).__name__
            record(kind, False, error=code)
            sys.exit(1)


if __name__ == "__main__":
    main()
