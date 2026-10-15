#!/usr/bin/env python3
"""Explicit operator binding of lab wallets, and isolated read-only account views."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time
import uuid

ROOT = Path('/opt/royal-finance')
BINDINGS = Path('/opt/royal-nile-account-bindings')
OUTPUT = Path('/opt/royal-nile-account-views')
INPUT = Path('/opt/royal-nile-account-input')
STATE = Path('/opt/royal-finance-state')
CONFIG = Path('/opt/royal-nile-test-config/nile-test.json')
SCOPE = dict(network='nile', asset='USDT_NILE_TEST', scale=6, testOnly=True, spendable=False)


def encoded(value):
    return json.dumps(value, separators=(',', ':'), ensure_ascii=False).encode()


def digest(value):
    return hashlib.sha256(encoded(value)).hexdigest()


def write(path, value, uid=0, gid=1000, mode=0o640):
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.partial')
    try:
        with temporary.open('xb') as stream:
            stream.write(encoded(value) + b'\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.chown(temporary, uid, gid)
        temporary.chmod(mode)
        os.replace(temporary, path)
        handle = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(handle)
        finally:
            os.close(handle)
    finally:
        temporary.unlink(missing_ok=True)


def read(path):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 262144:
        raise ValueError('unsafe_account_view_input')
    return json.loads(path.read_bytes())


def database_query(sql):
    container = run(['docker', 'compose', '-f', str(ROOT / 'compose.finance.yaml'), 'ps', '-q', 'finance-db']).decode().strip()
    if not re.fullmatch(r'[a-f0-9]{12,64}', container):
        raise ValueError('database_not_ready')
    # The admin password stays inside its existing container; all SQL is structured stdin.
    command = ['docker', 'exec', '-i', container, 'sh', '-ec',
               'export PGPASSWORD="$(cat /run/secrets/finance_admin_password)"; exec psql -X -qAt -v ON_ERROR_STOP=1 -h 127.0.0.1 -U finance_schema_owner -d royal_finance_sim']
    lines = run(command, sql.encode()).decode().splitlines()
    if not lines:
        raise ValueError('binding_database_result_missing')
    return json.loads(lines[-1])


def validate_manifest(value, config):
    if set(value) != {'version', 'network', 'asset', 'configSha256', 'bindings'} \
            or value['version'] != 1 or value['network'] != 'nile' or value['asset'] != SCOPE['asset'] \
            or value['configSha256'] != digest(config) or not isinstance(value['bindings'], list) \
            or len(value['bindings']) > len(config['addresses']):
        raise ValueError('invalid_nile_bindings')
    ids, users = set(), set()
    for row in value['bindings']:
        if set(row) != {'accountId', 'userId', 'address', 'boundAt'} \
                or not re.fullmatch(r'[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}', row['accountId']) \
                or row['accountId'] in ids or row['userId'] in users \
                or type(row['boundAt']) is not int or not 0 < row['boundAt'] <= time.time() * 1000 + 30000 \
                or not any(a['userId'] == row['userId'] and a['address'] == row['address'] for a in config['addresses']):
            raise ValueError('invalid_nile_bindings')
        ids.add(row['accountId'])
        users.add(row['userId'])
    return value


def manifest(config):
    rows = database_query("SELECT coalesce(jsonb_agg(jsonb_build_object('accountId',account_id,'userId',user_id,'address',address,'boundAt',bound_at) ORDER BY bound_at,account_id),'[]'::jsonb) FROM royal_nile_deposits.account_bindings;")
    bindings = [dict(accountId=row['accountId'], userId=row['userId'], address=row['address'], boundAt=row['boundAt']) for row in rows]
    value = dict(version=1, network='nile', asset=SCOPE['asset'], configSha256=digest(config), bindings=bindings)
    return validate_manifest(value, config)


def project(value):
    # This file is a regenerated projection for existing encrypted cache backups.
    write(BINDINGS / 'bindings.json', value)


def bind_account(account, user, address):
    payload = encoded(dict(accountId=account, userId=user, address=address, boundAt=int(time.time() * 1000))).hex()
    source = "SELECT convert_from(decode('" + payload + "','hex'),'UTF8')::jsonb AS value"
    sql = "BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('royal-nile-account-bindings',0));\n"
    sql += "WITH input AS (" + source + ") INSERT INTO royal_nile_deposits.account_bindings(account_id,user_id,address,bound_at) SELECT value->>'accountId',value->>'userId',value->>'address',(value->>'boundAt')::bigint FROM input WHERE EXISTS(SELECT FROM royal_game.accounts WHERE id=value->>'accountId') AND EXISTS(SELECT FROM royal_nile_deposits.addresses WHERE user_id=value->>'userId' AND address=value->>'address') AND NOT EXISTS(SELECT FROM royal_nile_deposits.account_bindings WHERE account_id=value->>'accountId' OR user_id=value->>'userId') ON CONFLICT DO NOTHING;\n"
    sql += "WITH input AS (" + source + ") SELECT CASE WHEN NOT EXISTS(SELECT FROM royal_game.accounts WHERE id=value->>'accountId') THEN jsonb_build_object('ok',false,'code','game_account_not_found') WHEN EXISTS(SELECT FROM royal_nile_deposits.account_bindings WHERE account_id=value->>'accountId' AND user_id=value->>'userId' AND address=value->>'address') THEN jsonb_build_object('ok',true) ELSE jsonb_build_object('ok',false,'code','nile_binding_conflict') END FROM input; COMMIT;"
    result = database_query(sql)
    if result.get('ok') is not True:
        raise ValueError(result.get('code') if result.get('code') in ('game_account_not_found', 'nile_binding_conflict') else 'binding_database_failed')


def run(args, input=None, timeout=40):
    result = subprocess.run(args, input=input, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
    if result.returncode:
        raise ValueError('account_view_command_failed')
    return result.stdout


def export():
    try:
        project(manifest(read(CONFIG)))
        # Copy only the public reconciliation report; the operations directory stays private.
        write(INPUT / 'nile_reconciliation.json', read(STATE / 'nile_reconciliation.json'))
        command = ['docker', 'compose', '-f', str(ROOT / 'deployment/finance/compose.nile-account-views.yaml'),
                   'run', '--rm', '--no-deps', '--name', 'royal-nile-account-views-once', 'nile-account-views']
        print(run(command, timeout=40).decode().strip())
    except Exception:
        write(OUTPUT / 'wallets.json', dict(version=1, **SCOPE, ready=False, generatedAt=int(time.time() * 1000), wallets=[]), uid=1000, mode=0o600)
        raise
    finally:
        subprocess.run(['docker', 'rm', '--force', 'royal-nile-account-views-once'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)


def main():
    if os.geteuid() != 0:
        raise ValueError('root_required')
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=('init', 'bind', 'export', 'latest'))
    parser.add_argument('--user')
    parser.add_argument('--email')
    args = parser.parse_args()
    for directory, uid in ((BINDINGS, 0), (INPUT, 0), (OUTPUT, 1000)):
        directory.mkdir(mode=0o750 if uid == 0 else 0o700, exist_ok=True)
        if directory.is_symlink():
            raise ValueError('unsafe_account_view_directory')
        os.chown(directory, uid, 1000)
        directory.chmod(0o750 if uid == 0 else 0o700)
    with (STATE / 'nile-account-views.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        config = read(CONFIG)
        if config.get('network') != 'nile' or config.get('asset') != SCOPE['asset']:
            raise ValueError('invalid_nile_config')
        value = manifest(config)
        if args.command == 'bind':
            if (STATE / 'nile-play-required.json').exists():
                raise ValueError('use_nile_play_invitation')
            if not args.email or len(args.email) > 254 or not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}', args.user or ''):
                raise ValueError('invalid_binding_target')
            address = next((a['address'] for a in config['addresses'] if a['userId'] == args.user), None)
            if not address:
                raise ValueError('unknown_nile_user')
            # The existing game identity is read through a parameterized query, without passwords or sessions.
            container = run(['docker', 'compose', '-f', '/opt/royal/compose.yaml', 'ps', '-q', 'game']).decode().strip()
            if not re.fullmatch(r'[a-f0-9]{12,64}', container):
                raise ValueError('game_not_ready')
            script = "import pg from'pg';import{readFileSync}from'node:fs';let s='';for await(const c of process.stdin)s+=c;const db=new pg.Client({host:process.env.PGHOST,port:Number(process.env.PGPORT??5432),database:process.env.PGDATABASE,user:process.env.PGUSER,password:readFileSync(process.env.PGPASSWORD_FILE,'utf8').trim()});try{await db.connect();const result=await db.query('SELECT id FROM royal_game.accounts WHERE email=$1',[JSON.parse(s).email]);console.log(JSON.stringify({id:result.rows[0]?.id??null}));}finally{await db.end();}"
            account = json.loads(run(['docker', 'exec', '-i', container, 'node', '--input-type=module', '-e', script], encoded({'email': args.email.strip().lower()})))['id']
            if not account or not re.fullmatch(r'[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}', account):
                raise ValueError('game_account_not_found')
            previous = next((row for row in value['bindings'] if row['accountId'] == account or row['userId'] == args.user), None)
            if previous and (previous['accountId'] != account or previous['userId'] != args.user or previous['address'] != address):
                raise ValueError('nile_binding_conflict')
            if not previous:
                history = BINDINGS / ('before-' + digest(value) + '.json')
                if not history.exists():
                    write(history, value)
            bind_account(account, args.user, address)
            project(manifest(config))
            export()
            print(json.dumps(dict(ok=True, **SCOPE, accountId=account, userId=args.user, reassigned=False)))
        elif args.command == 'export':
            export()
        elif args.command == 'latest':
            project(value)
            print(json.dumps(dict(ok=True, **SCOPE, sha256=digest(value), manifest=value)))
        else:
            project(value)
            print(json.dumps(dict(ok=True, **SCOPE, accounts=len(value['bindings']))))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        code = str(error) if isinstance(error, ValueError) and re.fullmatch(r'[a-z_]+', str(error)) else 'nile_account_views_failed'
        print(json.dumps(dict(ok=False, code=code)))
        raise SystemExit(1)
