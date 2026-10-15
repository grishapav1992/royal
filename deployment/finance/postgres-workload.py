#!/usr/bin/env python3
"""Read-only PostgreSQL statistics and fixed SELECT plans, without SQL text or private values."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time
sys.dont_write_bytecode = True
from operations import DB, OWNER, ROYAL_SCHEMAS, db_container, qualified_copy_sql

SETTINGS = ('shared_buffers', 'effective_cache_size', 'work_mem', 'maintenance_work_mem',
            'autovacuum_work_mem', 'autovacuum_max_workers', 'max_connections',
            'max_parallel_workers_per_gather', 'shared_preload_libraries', 'compute_query_id',
            'track_io_timing', 'track_wal_io_timing', 'statement_timeout', 'lock_timeout',
            'idle_in_transaction_session_timeout', 'fsync', 'synchronous_commit', 'full_page_writes')

PROBES = {
    'reader-block-page': "SELECT height,payload,payload_sha256 FROM royal_tron_reader.blocks WHERE height>(SELECT coalesce(max(height),0)-128 FROM royal_tron_reader.blocks) ORDER BY height LIMIT 128",
    'reader-transfer-page': "SELECT height,tx_id,log_index,contract,from_address,to_address,amount_units FROM royal_tron_reader.transfers WHERE height BETWEEN (SELECT coalesce(max(height),0)-127 FROM royal_tron_reader.blocks) AND (SELECT coalesce(max(height),0) FROM royal_tron_reader.blocks) ORDER BY height,tx_id,log_index",
    'deposit-credit-page': "SELECT height,tx_id,log_index,user_id,amount_units FROM royal_nile_deposits.credits WHERE height BETWEEN (SELECT coalesce(max(height),0)-127 FROM royal_nile_deposits.blocks) AND (SELECT coalesce(max(height),0) FROM royal_nile_deposits.blocks) ORDER BY height,tx_id,log_index",
    'deposit-balances': "SELECT account,SUM(amount_units::numeric)::text AS units FROM royal_nile_deposits.entries WHERE account<>'external' GROUP BY account",
    'game-session-lookup': "SELECT a.id FROM royal_game.accounts a JOIN royal_game.sessions s ON s.account_id=a.id WHERE s.hash='diagnostic-placeholder' AND s.expires>extract(epoch FROM clock_timestamp())*1000",
    'backup-reader-primary-key': "SELECT 'royal_tron_reader.blocks' AS relation,to_jsonb(t)::text AS row FROM royal_tron_reader.blocks t ORDER BY t.height",
    'backup-deposits-primary-key': "SELECT 'royal_nile_deposits.blocks' AS relation,to_jsonb(t)::text AS row FROM royal_nile_deposits.blocks t ORDER BY t.height",
}


def query(container, sql):
    prefix = "BEGIN READ ONLY; SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='2s'; "
    args = ['docker', 'exec', '-i', container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
            '-U', OWNER, '-d', DB]
    result = subprocess.run(args, input=(prefix + sql + '; ROLLBACK;').encode(),
                            capture_output=True, timeout=40)
    if result.returncode:
        raise ValueError('workload_query_failed')
    return json.loads(result.stdout)


def snapshot(container):
    names = ','.join("'" + s + "'" for s in SETTINGS)
    value = query(container, """SELECT jsonb_build_object('captured_at',clock_timestamp(),
      'database_bytes',pg_database_size(current_database()),
      'settings',(SELECT jsonb_agg(jsonb_build_object('name',name,'value',setting,'unit',unit,'pending_restart',pending_restart)) FROM pg_settings WHERE name IN (""" + names + """)),
      'database',(SELECT to_jsonb(d)-'datid' FROM pg_stat_database d WHERE datname=current_database()),
      'connections',(SELECT jsonb_agg(to_jsonb(c)) FROM (SELECT usename,application_name,backend_type,state,wait_event_type,wait_event,count(*) connections,max(extract(epoch FROM clock_timestamp()-xact_start)) transaction_seconds FROM pg_stat_activity WHERE datname=current_database() GROUP BY usename,application_name,backend_type,state,wait_event_type,wait_event) c),
      'tables',(SELECT jsonb_agg(to_jsonb(t)) FROM (SELECT schemaname,relname,n_live_tup,n_dead_tup,n_tup_ins,n_tup_upd,n_tup_hot_upd,n_mod_since_analyze,seq_scan,seq_tup_read,idx_scan,idx_tup_fetch,last_autovacuum,last_autoanalyze,pg_total_relation_size(relid) total_bytes FROM pg_stat_user_tables WHERE schemaname LIKE 'royal_%' ORDER BY pg_total_relation_size(relid) DESC) t),
      'wal',(SELECT to_jsonb(w) FROM pg_stat_wal w),
      'checkpointer',(SELECT to_jsonb(c) FROM pg_stat_checkpointer c),
      'statistics_extension',(SELECT extversion FROM pg_extension WHERE extname='pg_stat_statements'))""")
    value['query_statistics'] = {'available': False}
    if value['statistics_extension'] and 'pg_stat_statements' in next(s['value'] for s in value['settings'] if s['name'] == 'shared_preload_libraries'):
        # Query text and parameter values are deliberately excluded, including DDL utilities.
        value['query_statistics'] = {'available': True, 'queries': query(container, """SELECT coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) FROM (
          SELECT r.rolname role,p.queryid::text query_id,p.calls,p.total_exec_time,p.mean_exec_time,p.rows,
          p.shared_blks_hit,p.shared_blks_read,p.temp_blks_read,p.temp_blks_written,p.wal_bytes,p.stats_since
          FROM public.pg_stat_statements p JOIN pg_roles r ON r.oid=p.userid
          WHERE p.dbid=(SELECT oid FROM pg_database WHERE datname=current_database())
          ORDER BY p.total_exec_time DESC LIMIT 30) s""")}
    return value


def explain(container, name, analyze):
    sql = PROBES.get(name)
    if name == 'backup-fingerprint':
        allowed = ','.join("'" + s + "'" for s in ROYAL_SCHEMAS)
        tables = query(container, "SELECT coalesce(jsonb_agg(schemaname||'.'||tablename ORDER BY schemaname,tablename),'[]'::jsonb) FROM pg_tables WHERE schemaname IN (" + allowed + ')')
        sql = qualified_copy_sql(tables)[len('COPY ('):-len(') TO STDOUT;')]
    options = 'ANALYZE, BUFFERS, TIMING OFF, ' if analyze else ''
    return {'workload': name, 'analyze': analyze,
            'plan': query(container, 'EXPLAIN (' + options + 'FORMAT JSON) ' + sql)}


def save(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.partial')
    with temporary.open('x') as stream:
        os.chmod(temporary, 0o600)
        json.dump(data, stream, indent=2)
        stream.write('\n')
    os.replace(temporary, path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=('capture', 'explain'))
    parser.add_argument('--container', help='Existing production or isolated-copy PostgreSQL container')
    parser.add_argument('--interval', type=int, default=10, choices=range(1, 61))
    parser.add_argument('--workload', choices=tuple(PROBES) + ('backup-fingerprint',), default='reader-block-page')
    parser.add_argument('--analyze', action='store_true', help='Execute only the fixed read-only SELECT probe')
    parser.add_argument('--output')
    args = parser.parse_args()
    container = args.container or db_container()
    if args.command == 'capture':
        first = snapshot(container)
        time.sleep(args.interval)
        last = snapshot(container)
        # Each rate uses the actual timestamp precision rather than the requested sleep.
        from datetime import datetime
        elapsed = (datetime.fromisoformat(last['captured_at']) - datetime.fromisoformat(first['captured_at'])).total_seconds()
        keys = ('xact_commit','xact_rollback','sessions','temp_bytes','tup_inserted','tup_updated')
        rates = {key + '_per_second': (last['database'][key] - first['database'][key]) / elapsed for key in keys}
        data = {'read_only': True, 'query_text_included': False, 'seconds': elapsed,
                'rates': rates, 'samples': [first, last]}
    else:
        data = explain(container, args.workload, args.analyze)
    if args.output:
        save(args.output, data)
    print(json.dumps(data))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, subprocess.TimeoutExpired):
        print(json.dumps({'ok': False, 'code': 'workload_capture_failed'}))
        raise SystemExit(1)
