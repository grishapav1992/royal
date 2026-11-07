import { CLUB_FINE_SOURCE } from '../../src/shared/security';
import { identifier, type PostgresDatabase } from '../database';
import { applySchemaMigration } from '../database-migrations';
import type { AuditSourceSchemas } from './datasets';
import { auditToteMode, casinoPaidOpeningSql, casinoSessionModeSql, instantCasinoModeSql, pvpModeVersionSql } from './mode-registry';
import { auditExportReaderProjectionGuard } from './report-export-slot';

export const playerColumns = [
  'schema_version', 'dataset_id', 'environment', 'source', 'posting_id', 'account_id', 'occurred_at',
  'operation_id', 'category', 'game_id', 'mode_id', 'rules_version', 'entity_id', 'ticket_id',
  'movement_type', 'contour', 'asset', 'scale', 'amount_units', 'reserved_delta_units',
  'expected_balance_units', 'stored_balance_units', 'expected_balance_basis', 'pending_delta_units',
  'stored_pending_units', 'coverage_status',
] as const;
export type PlayerReportRow = Record<(typeof playerColumns)[number], string | null>;
export type PlayerReportCursor = { at: string; source: string; id: string };
export type PlayerReportPage = { cursor: PlayerReportCursor | null; scanned: number; rows: PlayerReportRow[] };

const validName = (value: string) => /^[a-z_][a-z0-9_]{0,62}$/.test(value);
const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'";

async function relationExists(db: PostgresDatabase, schema: string, table: string) {
  return (await db.prepare('SELECT to_regclass(?) IS NOT NULL AS present').get(schema + '.' + table))?.present === true;
}

/** Shared canonical projection over already scoped references. */
export async function auditPostingProjectionSql(db: PostgresDatabase, sources: AuditSourceSchemas, allowedSources?: 'allowed') {
  const names = [db.schema, sources.game, ...(sources.payments ? [sources.payments] : [])];
  if (names.some(name => !validName(name)) || new Set(names).size !== names.length) {
    throw new Error('Invalid audit report source configuration');
  }
  const a = identifier(db.schema), g = identifier(sources.game);
  const p = sources.payments ? identifier(sources.payments) : null;
  const demo = literal(sources.game + '.demo_ledger'), pending = literal(sources.game + '.capro_pending_ledger');
  const crypto = sources.payments ? literal(sources.payments + '.crypto_ledger') : 'NULL::text';
  const sourceSelected = (namespace: string) => allowedSources
    ? ` AND EXISTS (SELECT 1 FROM ${allowedSources} WHERE source_namespace=${namespace})` : '';
  const fine = literal(CLUB_FINE_SOURCE);
  const hasMatches = await relationExists(db, sources.game, 'pvp_matches');
  const hasCallbacks = await relationExists(db, sources.game, 'capro_transactions') &&
    await relationExists(db, sources.game, 'capro_players');
  const flags = "substring(l.operation_id from '^flag-tote:(ft1-[0-9]{1,16}):final$')";
  const pvp = "substring(l.operation_id from '^pvp:([0-9a-f-]{36}):(hold|final)$')";
  const paidStart = casinoPaidOpeningSql('l.source', 'session_mode.mode_id', "x.payload->>'rulesVersion'");
  const selects = `
    SELECT r.*, l.id IS NOT NULL AS present, l.amount_units::numeric AS amount, l.balance_units::numeric AS balance,
      NULL::numeric AS reserved_delta, NULL::numeric AS pending_delta, NULL::numeric AS pending_balance,
      p.balance_units::numeric AS prior_balance, 'virtual'::text AS contour, 'VIRTUAL_USD'::text AS asset, 2 AS scale,
      CASE WHEN l.source LIKE 'pvp:%' THEN 'pvp'
        WHEN l.source='flag-tote' THEN 'totalizator'
        WHEN x.session_id IS NOT NULL OR op.result IS NOT NULL OR l.source IN ('royal-flight','royal-mines','github-tower')
          OR (l.source='casinoapipro' AND l.entry_type IN ('bet','win','refund','rollback') AND NOT t.transfer
            AND (l.operation_id NOT LIKE 'capro:transfer:%' OR provider.explicit_credit))
          THEN 'casino' END AS category,
      CASE WHEN l.source LIKE 'pvp:%' THEN substring(l.source from 5)
        WHEN l.source='flag-tote' OR x.session_id IS NOT NULL OR op.result IS NOT NULL
          OR l.source IN ('royal-flight','royal-mines','github-tower','casinoapipro') THEN l.source END AS game_id,
      CASE WHEN b.match_id IS NOT NULL THEN 'stake' WHEN pool.id IS NOT NULL THEN ${literal(auditToteMode.modeId)}
        WHEN op.kind='spin' AND op.request_key IS NULL AND l.source='royal-coins' AND op.round IS NULL THEN 'normal'
        WHEN op.result IS NOT NULL THEN ${instantCasinoModeSql('l.source', 'op.round')}
        WHEN x.session_id IS NOT NULL THEN session_mode.mode_id
        END AS mode_id,
      COALESCE(pool.rules_version::text, x.payload->>'rulesVersion', op.round->>'rulesVersion',
        m.rules_version) AS rules_version,
      COALESCE(pool.id,b.match_id,x.session_id,CASE WHEN op.result IS NOT NULL THEN l.operation_id END,
        f.session_id,n.id) AS entity_id, ticket.id AS ticket_id,
      CASE
        WHEN t.transfer THEN 'release'
        WHEN l.source=${fine} THEN CASE WHEN l.entry_type='bet' THEN 'fine' END
        WHEN l.source='casinoapipro' AND l.entry_type='win' AND l.operation_id LIKE 'capro:transfer:%'
          AND NOT provider.explicit_credit THEN NULL
        WHEN l.entry_type='bet' AND l.source IN ('atelier','janitor-skins') THEN 'purchase'
        WHEN l.entry_type='win' AND l.source LIKE 'reward:%' AND l.operation_id LIKE 'reward:%' THEN 'reward'
        WHEN l.entry_type='bet' AND b.match_id IS NOT NULL THEN 'reserve'
        WHEN l.entry_type='bet' AND x.session_id<>l.operation_id THEN 'paid-option'
        WHEN l.entry_type='bet' AND req.session_id=x.session_id AND x.session_id=l.operation_id
          AND (${paidStart}) THEN 'paid-option'
        WHEN l.entry_type='bet' THEN 'stake'
        WHEN l.entry_type='win' THEN 'payout'
        WHEN l.entry_type='refund' THEN 'refund'
        WHEN l.entry_type='rollback' THEN 'reversal'
        WHEN l.entry_type='deposit' THEN 'deposit' END AS movement
    FROM anchors r
    -- Resolve the unique posting ID before validating the reference metadata.
    LEFT JOIN LATERAL (
      SELECT id,account_id,operation_id,created_at,source,entry_type,amount_units,balance_units FROM ${g}.demo_ledger
      WHERE id=r.source_row_id LIMIT 1
    ) l ON l.account_id=r.account_id AND l.operation_id=r.operation_id AND l.created_at=r.occurred_at_ms
    LEFT JOIN LATERAL (
      SELECT balance_units FROM ${g}.demo_ledger WHERE id=r.prior_id AND account_id=r.account_id LIMIT 1
    ) p ON true
    LEFT JOIN LATERAL (
      SELECT kind,request_key,result,CASE WHEN pg_input_is_valid(result,'jsonb') THEN result::jsonb->'gameRound' END AS round
      FROM ${g}.demo_operations
      WHERE l.entry_type<>'deposit' AND l.source IS DISTINCT FROM ${fine}
        AND account_id=l.account_id AND operation_id=l.operation_id AND kind IN ('play','spin') LIMIT 1
    ) op ON true
    LEFT JOIN LATERAL (
      SELECT session_id FROM ${g}.demo_casino_requests
      WHERE l.entry_type<>'deposit' AND l.source IS DISTINCT FROM ${fine} AND account_id=l.account_id AND id=l.operation_id LIMIT 1
    ) req ON true
    LEFT JOIN LATERAL (
      SELECT s.id AS session_id, CASE WHEN pg_input_is_valid(s.payload,'jsonb') THEN s.payload::jsonb END AS payload
      FROM ${g}.demo_casino_sessions s WHERE l.entry_type<>'deposit' AND l.source IS DISTINCT FROM ${fine}
        AND s.account_id=l.account_id AND s.id=COALESCE(req.session_id,l.operation_id)
        AND s.game_id=l.source LIMIT 1
    ) x ON true
    CROSS JOIN LATERAL (
      SELECT CASE WHEN x.payload->>'id'=x.session_id AND x.payload->>'gameId'=l.source
        THEN ${casinoSessionModeSql('l.source', 'x.payload')} END AS mode_id
    ) session_mode
    LEFT JOIN ${g}.demo_flight_requests f ON l.source='royal-flight' AND f.account_id=l.account_id AND f.id=l.operation_id
    LEFT JOIN ${g}.demo_mines_sessions n ON l.source='royal-mines' AND n.account_id=l.account_id
      AND n.id=l.operation_id
    LEFT JOIN ${g}.virtual_pvp_banks b ON l.source='pvp:'||b.game_id AND b.match_id=${pvp}
      AND EXISTS (SELECT 1 FROM ${g}.virtual_pvp_holds h WHERE h.match_id=b.match_id AND h.account_id=l.account_id)
    ${hasMatches ? `LEFT JOIN LATERAL (
      SELECT ${pvpModeVersionSql('b.game_id', "p.challenge->'rulesVersion'")} AS rules_version
      FROM ${g}.pvp_matches pm
      CROSS JOIN LATERAL (
        SELECT CASE WHEN pg_input_is_valid(pm.payload,'jsonb') THEN pm.payload::jsonb->'challenge' END AS challenge
      ) p
      WHERE b.game_id='tsu-e-fa' AND pm.id=b.match_id AND (pm.creator_id=l.account_id OR pm.opponent_id=l.account_id)
        AND p.challenge->>'id'=pm.id AND p.challenge->>'gameId'=b.game_id
        AND p.challenge->>'creatorId'=pm.creator_id AND p.challenge->>'opponentId' IS NOT DISTINCT FROM pm.opponent_id
        AND p.challenge->>'status'=pm.status AND p.challenge->>'mode' IS DISTINCT FROM 'free'
        AND p.challenge->'stakeUnits'=to_jsonb((b.stake_units::numeric*10000)::text)
    ) m ON true` : 'LEFT JOIN LATERAL (SELECT NULL::text AS rules_version) m ON true'}
    LEFT JOIN ${g}.flag_tote_tickets ticket ON l.source='flag-tote' AND l.entry_type='bet' AND ticket.account_id=l.account_id
      AND ticket.id=substring(l.operation_id from '^flag-tote:([0-9a-fA-F-]{36})$')
    LEFT JOIN ${g}.flag_tote_rounds pool ON l.source='flag-tote' AND pool.id=COALESCE(ticket.round_id,${flags})
      AND EXISTS (SELECT 1 FROM ${g}.flag_tote_tickets pt WHERE pt.round_id=pool.id AND pt.account_id=l.account_id)
    CROSS JOIN LATERAL (
      SELECT ${hasCallbacks ? `EXISTS (SELECT 1 FROM ${g}.capro_transactions ct JOIN ${g}.capro_players cp ON cp.player_id=ct.player_id
        WHERE l.source='casinoapipro' AND ct.transaction_id=substring(l.operation_id from 7)
          AND ct.operation='credit' AND cp.account_id=l.account_id)` : 'false'} AS explicit_credit
    ) provider
    CROSS JOIN LATERAL (
      SELECT (l.source='casinoapipro' AND l.entry_type='win' AND l.amount_units>0 AND l.operation_id LIKE 'capro:transfer:%'
        AND NOT provider.explicit_credit
        AND EXISTS (SELECT 1 FROM ${a}.audit_report_acl acl WHERE acl.operator_name=session_user
          AND acl.dataset_id=r.dataset_id AND acl.source_namespace=${pending})
        AND EXISTS (SELECT 1 FROM ${g}.capro_pending_ledger cp JOIN ${a}.audit_posting_refs pending_ref
          ON pending_ref.dataset_id=r.dataset_id AND pending_ref.source_namespace=${pending} AND pending_ref.source_row_id=cp.id
          WHERE cp.account_id=l.account_id AND cp.operation_id=l.operation_id AND cp.reason='transfer'
            AND cp.amount_units::numeric=-l.amount_units)) IS TRUE AS transfer
    ) t
    WHERE r.source_namespace=${demo}${sourceSelected(demo)}

    UNION ALL
    SELECT r.*, l.id IS NOT NULL, CASE WHEN l.id IS NOT NULL THEN 0::numeric END, NULL::numeric,
      NULL::numeric,l.amount_units::numeric,l.pending_balance_units::numeric,p.pending_balance_units::numeric,
      'virtual','VIRTUAL_USD',2,
      CASE WHEN l.reason IN ('debit','credit','refund','rollback') THEN 'casino' END,
      CASE WHEN l.reason IN ('debit','credit','refund','rollback') THEN 'casinoapipro' END,
      NULL,NULL,NULL,NULL,
      CASE l.reason WHEN 'debit' THEN 'stake' WHEN 'credit' THEN 'payout' WHEN 'refund' THEN 'refund'
        WHEN 'rollback' THEN 'reversal' WHEN 'transfer' THEN 'release' END
    FROM anchors r
    LEFT JOIN LATERAL (
      SELECT id,amount_units,pending_balance_units,reason FROM ${g}.capro_pending_ledger
      WHERE id=r.source_row_id AND account_id=r.account_id AND operation_id=r.operation_id AND created_at=r.occurred_at_ms LIMIT 1
    ) l ON true
    LEFT JOIN LATERAL (
      SELECT pending_balance_units FROM ${g}.capro_pending_ledger WHERE id=r.prior_id AND account_id=r.account_id LIMIT 1
    ) p ON true
    WHERE r.source_namespace=${pending}${sourceSelected(pending)}
    ${p ? `UNION ALL
    SELECT r.*, l.id IS NOT NULL,l.available_delta::numeric,l.balance_units::numeric,l.reserved_delta::numeric,
      NULL::numeric,NULL::numeric,p.balance_units::numeric,'real','USDT',6,
      NULL,NULL,NULL,NULL,NULL,NULL,
      CASE WHEN l.entry_key='reserve:'||l.operation_id THEN 'withdrawal-reserve'
        WHEN l.entry_key='paid:'||l.operation_id THEN 'withdrawal-paid'
        WHEN l.entry_key='refund:'||l.operation_id THEN 'refund'
        WHEN l.entry_key='adjustment:'||l.operation_id THEN 'adjustment'
        WHEN l.entry_key LIKE 'deposit:%' THEN 'deposit' END
    FROM anchors r
    LEFT JOIN LATERAL (
      SELECT id,operation_id,entry_key,available_delta,reserved_delta,balance_units FROM ${p}.crypto_ledger
      WHERE id=r.source_row_id AND account_id=r.account_id AND operation_id=r.operation_id AND created_at=r.occurred_at_ms LIMIT 1
    ) l ON true
    LEFT JOIN LATERAL (
      SELECT balance_units FROM ${p}.crypto_ledger WHERE id=r.prior_id AND account_id=r.account_id LIMIT 1
    ) p ON true
    WHERE r.source_namespace=${crypto}${sourceSelected(crypto)}` : ''}
  `;
  return { a, g, p, demo, pending, crypto, selects };
}

/** Privileged setup only. The reader role executes a fixed projection, with no access to its base tables. */
export async function installAuditPlayerReport(db: PostgresDatabase, readerRole: string, sources: AuditSourceSchemas) {
  if (!validName(readerRole)) throw new Error('Invalid audit report role name');
  const { a, demo, pending, crypto, selects } = await auditPostingProjectionSql(db, sources);
  await applySchemaMigration(db, { id: 'paid-activity-audit-player-sequence-v1', statements: [], indexes: [
    { name: 'audit_posting_refs_player_sequence', table: 'audit_posting_refs',
      columns: ['dataset_id', 'account_id', 'source_namespace', 'source_row_id'] },
  ] });
  const fn = a + '.audit_report_player_page';
  const signature = fn + '(uuid,bigint,text,bigint,bigint)';
  await db.transaction(async () => {
    await db.exec(`CREATE OR REPLACE FUNCTION ${fn}(job uuid, cursor_at bigint, cursor_source text, cursor_id bigint, page_size bigint)
      RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $player$
      DECLARE j record;
      BEGIN
        -- A preceding journal insert in this transaction must commit before the first page can be read.
        IF current_setting('transaction_isolation')<>'read committed' OR pg_current_xact_id_if_assigned() IS NOT NULL THEN
          RAISE EXCEPTION 'Audit report requires a separate committed job' USING ERRCODE='42501';
        END IF;
        SELECT e.dataset_id,e.filters,d.environment INTO j FROM ${a}.audit_export_jobs e
        JOIN ${a}.audit_datasets d ON d.id=e.dataset_id
        WHERE e.id=job AND e.operator_name=session_user AND e.kind='player' AND e.status='running'
          AND e.expires_at>clock_timestamp();
        IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM ${a}.audit_report_acl acl
          WHERE acl.operator_name=session_user AND acl.dataset_id=j.dataset_id) THEN
          RAISE EXCEPTION 'Audit report access denied' USING ERRCODE='42501';
        END IF;
        IF page_size IS NULL OR page_size<1 OR page_size>256 OR
          ((cursor_at IS NULL OR cursor_source IS NULL OR cursor_id IS NULL) AND
           NOT (cursor_at IS NULL AND cursor_source IS NULL AND cursor_id IS NULL)) THEN
          RAISE EXCEPTION 'Invalid audit page' USING ERRCODE='22023';
        END IF;
        ${auditExportReaderProjectionGuard(db.schema, 'job', 'player')}
        RETURN (
          WITH refs AS MATERIALIZED (
            SELECT r.* FROM ${a}.audit_posting_refs r
            WHERE r.dataset_id=j.dataset_id AND r.account_id=j.filters->>'accountId'
              AND r.occurred_at_ms>=(j.filters->>'fromMs')::bigint AND r.occurred_at_ms<(j.filters->>'toMs')::bigint
              AND r.source_namespace IN (${demo},${pending},${crypto})
              AND (r.occurred_at_ms,r.source_namespace,r.source_row_id)>
                (COALESCE(cursor_at,(j.filters->>'fromMs')::bigint-1),COALESCE(cursor_source,''),COALESCE(cursor_id,0))
              AND EXISTS (SELECT 1 FROM ${a}.audit_report_acl acl WHERE acl.operator_name=session_user
                AND acl.dataset_id=r.dataset_id AND acl.source_namespace=r.source_namespace)
            ORDER BY r.occurred_at_ms,r.source_namespace,r.source_row_id LIMIT page_size
          ), anchors AS (
            SELECT r.*, older.source_row_id AS prior_id, op.available_units AS opening_balance
            FROM refs r
            LEFT JOIN LATERAL (
              SELECT old.source_row_id FROM ${a}.audit_posting_refs old
              WHERE old.dataset_id=r.dataset_id AND old.account_id=r.account_id
                AND old.source_namespace=r.source_namespace AND old.source_row_id<r.source_row_id
              ORDER BY old.source_row_id DESC LIMIT 1
            ) older ON true
            LEFT JOIN ${a}.audit_opening_balances op ON op.dataset_id=r.dataset_id AND op.account_id=r.account_id
              AND op.source_namespace=r.source_namespace AND older.source_row_id IS NULL
          ), projected AS (${selects}), matched AS (
            SELECT q.*, CASE WHEN q.prior_id IS NULL THEN q.opening_balance ELSE q.prior_balance END AS previous
            FROM projected q
            WHERE (j.filters->>'category' IS NULL OR q.category=j.filters->>'category')
              AND (j.filters->>'gameId' IS NULL OR q.game_id=j.filters->>'gameId')
              AND (j.filters->>'modeId' IS NULL OR q.mode_id=j.filters->>'modeId')
              AND (j.filters->>'asset' IS NULL OR q.asset=j.filters->>'asset')
              AND (j.filters->>'contour' IS NULL OR q.contour=j.filters->>'contour')
          )
          SELECT jsonb_build_object('scanned',(SELECT count(*) FROM refs),'cursor',
            (SELECT jsonb_build_object('at',occurred_at_ms::text,'source',source_namespace,'id',source_row_id::text) FROM refs
              ORDER BY occurred_at_ms DESC,source_namespace DESC,source_row_id DESC LIMIT 1),
            'rows',COALESCE((SELECT jsonb_agg(jsonb_build_object(
              'schema_version','1','dataset_id',m.dataset_id::text,'environment',j.environment,'source',m.source_namespace,
              'posting_id',m.source_row_id::text,'account_id',m.account_id,
              'occurred_at',to_char(to_timestamp(m.occurred_at_ms/1000.0) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
              'operation_id',m.operation_id,'category',m.category,
              'game_id',CASE WHEN m.game_id ~ '^[a-z0-9][a-z0-9._-]{0,127}$' THEN m.game_id END,
              'mode_id',CASE WHEN m.mode_id ~ '^[a-z0-9][a-z0-9._-]{0,127}$' THEN m.mode_id END,
              'rules_version',CASE WHEN m.rules_version ~ '^[a-z0-9][a-z0-9._-]{0,127}$' THEN m.rules_version END,
              'entity_id',m.entity_id,'ticket_id',m.ticket_id,'movement_type',m.movement,'contour',m.contour,
              'asset',m.asset,'scale',m.scale::text,'amount_units',m.amount::text,
              'reserved_delta_units',m.reserved_delta::text,
              'expected_balance_units',CASE WHEN m.balance IS NOT NULL THEN (m.previous+m.amount)::text END,
              'stored_balance_units',m.balance::text,
              'expected_balance_basis',CASE WHEN m.balance IS NULL OR m.previous IS NULL THEN 'unavailable'
                WHEN m.prior_id IS NULL THEN 'opening' ELSE 'adjacent' END,
              'pending_delta_units',m.pending_delta::text,'stored_pending_units',m.pending_balance::text,
              'coverage_status',CASE WHEN NOT m.present THEN 'source-unavailable' WHEN m.movement IS NULL THEN 'unsupported'
                ELSE 'partial' END)
              ORDER BY m.occurred_at_ms,m.source_namespace,m.source_row_id) FROM matched m),'[]'::jsonb))
        );
      END
      $player$;
      REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION ${signature} TO ${identifier(readerRole)}`);
  }, { lockKey: 'audit-report-player-install' });
}
