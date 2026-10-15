#!/usr/bin/env python3
"""Provision Royal schemas and scoped logins in the existing PostgreSQL, without logging secrets."""
import argparse
import json
import os
from pathlib import Path
import re
import secrets
import subprocess

RUNTIME = {
    'royal_game_app': ('game-password', 'royal_game', ()),
    'royal_tron_reader_app': ('tron-reader-password', 'royal_tron_reader', ()),
    'royal_nile_deposits_app': ('nile-deposits-password', 'royal_nile_deposits', ('royal_tron_reader',)),
    'royal_nile_play_app': ('nile-play-password', 'royal_nile_play', ('royal_nile_deposits',)),
    'royal_nile_views_app': ('nile-views-password', None, ('royal_nile_deposits',)),
    'royal_nile_reconcile_app': ('nile-reconcile-password', None, ('royal_nile_deposits',)),
    'royal_mainnet_app': ('mainnet-password', 'royal_mainnet', ()),
}


def identifier(value):
    if not re.fullmatch(r'[a-z_][a-z0-9_]*', value):
        raise ValueError('invalid_postgres_identifier')
    return '"' + value + '"'


def provision_sql(database, passwords):
    db = identifier(database)
    sql = ['BEGIN;', "SELECT pg_advisory_xact_lock(hashtextextended('royal-postgres-provision',0));"]
    for role, (_file, schema, _reads) in RUNTIME.items():
        login = identifier(role)
        password = passwords[role]
        if not re.fullmatch(r'[a-f0-9]{64}', password):
            raise ValueError('invalid_postgres_secret')
        sql += [f"DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='{role}') THEN CREATE ROLE {login} LOGIN; END IF; END $$;",
                f"DO $$ BEGIN IF EXISTS(SELECT FROM pg_roles WHERE rolname='{role}' AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) OR EXISTS(SELECT FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname='{role}')) THEN RAISE EXCEPTION 'unsafe existing Royal login'; END IF; END $$;",
                f"ALTER ROLE {login} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '{password}';",
                f'GRANT CONNECT' + (', CREATE' if schema else '') + f' ON DATABASE {db} TO {login};',
                f"ALTER ROLE {login} IN DATABASE {db} SET statement_timeout='15s';",
                f"ALTER ROLE {login} IN DATABASE {db} SET idle_in_transaction_session_timeout='90s';"]
        if not schema:
            sql.append(f'REVOKE CREATE ON DATABASE {db} FROM {login};')
        if schema:
            name = identifier(schema)
            sql += [f'CREATE SCHEMA IF NOT EXISTS {name} AUTHORIZATION {login};',
                    f'ALTER SCHEMA {name} OWNER TO {login};',
                    f'REVOKE ALL ON SCHEMA {name} FROM PUBLIC;',
                    f'ALTER DEFAULT PRIVILEGES FOR ROLE {login} IN SCHEMA {name} REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;',
                    f'GRANT ALL ON ALL TABLES IN SCHEMA {name} TO {login};',
                    f'GRANT ALL ON ALL SEQUENCES IN SCHEMA {name} TO {login};']
            # Imported objects must have the same owner as objects created by the service.
            sql += [f"DO $$ DECLARE obj record; BEGIN FOR obj IN SELECT c.relname,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='{schema}' AND c.relkind IN ('r','p','S','v','m') ORDER BY c.relkind='S' LOOP EXECUTE format('ALTER %s %I.%I OWNER TO %I', CASE obj.relkind WHEN 'S' THEN 'SEQUENCE' WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' ELSE 'TABLE' END, '{schema}', obj.relname, '{role}'); END LOOP; FOR obj IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='{schema}' AND p.prokind='f' LOOP EXECUTE format('ALTER FUNCTION %s OWNER TO %I', obj.signature, '{role}'); END LOOP; END $$;"]
    owners = {schema: role for role, (_file, schema, _reads) in RUNTIME.items() if schema}
    for role, (_file, _schema, reads) in RUNTIME.items():
        for upstream in reads:
            name, login = identifier(upstream), identifier(role)
            sql += [f'GRANT USAGE ON SCHEMA {name} TO {login};',
                    f'GRANT SELECT ON ALL TABLES IN SCHEMA {name} TO {login};',
                    f'ALTER DEFAULT PRIVILEGES FOR ROLE {identifier(owners[upstream])} IN SCHEMA {name} GRANT SELECT ON TABLES TO {login};',
                    f'ALTER DEFAULT PRIVILEGES FOR ROLE finance_schema_owner IN SCHEMA {name} GRANT SELECT ON TABLES TO {login};']
    sql.append('COMMIT;')
    return '\n'.join(sql) + '\n'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', default='/opt/royal-finance')
    parser.add_argument('--directory', default='/opt/royal-postgres-secrets')
    parser.add_argument('--database', default='royal_finance_sim')
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise ValueError('root_required')
    os.umask(0o077)
    folder = Path(args.directory)
    if folder.is_symlink():
        raise ValueError('unsafe_postgres_secret_directory')
    folder.mkdir(mode=0o700, parents=True, exist_ok=True)
    folder.chmod(0o700)
    passwords = {}
    for role, (name, _schema, _reads) in RUNTIME.items():
        path = folder / name
        if path.is_symlink():
            raise ValueError('unsafe_postgres_secret_file')
        if not path.exists():
            with path.open('x') as stream:
                stream.write(secrets.token_hex(32) + '\n')
                stream.flush()
                os.fsync(stream.fileno())
        passwords[role] = path.read_text().strip()
        os.chown(path, 0, 1000)
        path.chmod(0o440)
    compose = ['docker', 'compose', '-f', str(Path(args.root) / 'compose.finance.yaml')]
    result = subprocess.run(compose + ['ps', '-q', 'finance-db'], capture_output=True, timeout=30)
    container = result.stdout.decode().strip()
    if result.returncode or not re.fullmatch(r'[a-f0-9]{12,64}', container):
        raise ValueError('postgres_container_unavailable')
    # The administrator credential stays in the database container and is never printed.
    command = ['docker', 'exec', '-i', container, 'sh', '-ec',
               'export PGPASSWORD="$(cat /run/secrets/finance_admin_password)"; exec psql -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -U finance_schema_owner -d "$1"',
               'royal-postgres-provision', args.database]
    result = subprocess.run(command, input=provision_sql(args.database, passwords).encode(), capture_output=True, timeout=120)
    if result.returncode:
        raise ValueError('postgres_provision_failed')
    print(json.dumps(dict(ok=True, database=args.database, roles=list(RUNTIME), secret_values_printed=False)))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print(json.dumps(dict(ok=False, code='postgres_provision_failed')))
        raise SystemExit(1)
