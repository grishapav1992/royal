import { identifier, type PostgresDatabase } from '../database';
import { applySchemaMigration } from '../database-migrations';
import type { AuditSourceSchemas } from './datasets';
import { auditExportReaderProjectionGuard } from './report-export-slot';
import { auditPostingProjectionSql } from './report-player-source';

export const summaryColumns = [
  'contour', 'asset', 'scale', 'category', 'movement_type', 'posting_count', 'amount_units',
  'reserved_delta_units', 'pending_delta_units', 'confirmed_withdrawal_units', 'fee_units', 'coverage_status',
] as const;
export type SummaryReportRow = Record<(typeof summaryColumns)[number], string | null>;
export type SummaryReport = {
  datasetId: string;
  environment: 'test' | 'live';
  asOf: string;
  sources: string[];
  scanned: number;
  gaps: {
    unavailablePostings: number;
    unclassifiedPostings: number;
    invalidWithdrawalPostings: number;
    unavailableFees: number;
    feesExcludedForAccount: boolean;
  };
  rows: SummaryReportRow[];
};

export const AUDIT_SUMMARY_SCAN_CAP = 20_000;

/** Privileged setup only. The operator executes a fixed, scoped projection over captured references. */
export async function installAuditSummaryReport(db: PostgresDatabase, readerRole: string, sources: AuditSourceSchemas) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(readerRole)) throw new Error('Invalid audit summary reader');
  const { a, g, demo, pending, crypto, selects } = await auditPostingProjectionSql(db, sources, 'summary');
  await applySchemaMigration(db, { id: 'paid-activity-audit-summary-period-v1', statements: [], indexes: [
    { name: 'audit_posting_refs_period', table: 'audit_posting_refs',
      columns: ['dataset_id', 'source_namespace', 'occurred_at_ms', 'source_row_id'] },
    { name: 'audit_posting_refs_operation', table: 'audit_posting_refs',
      columns: ['dataset_id', 'source_namespace', 'operation_id', 'source_row_id'] },
  ] });
  const fn = a + '.audit_report_summary', signature = fn + '(uuid)';
  await db.transaction(async () => {
    await db.exec(`CREATE OR REPLACE FUNCTION ${fn}(job uuid) RETURNS jsonb
      LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp
      SET plan_cache_mode=force_custom_plan AS $summary$
      DECLARE j record;
      DECLARE report jsonb;
      BEGIN
        IF current_setting('transaction_isolation')<>'read committed' OR pg_current_xact_id_if_assigned() IS NOT NULL THEN
          RAISE EXCEPTION 'Audit report requires a separate committed job' USING ERRCODE='42501';
        END IF;
        SELECT e.dataset_id,e.filters,d.environment INTO j FROM ${a}.audit_export_jobs e
        JOIN ${a}.audit_datasets d ON d.id=e.dataset_id
        WHERE e.id=job AND e.operator_name=session_user AND e.kind='summary' AND e.status='running'
          AND e.expires_at>clock_timestamp();
        IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM ${a}.audit_report_acl acl
          WHERE acl.operator_name=session_user AND acl.dataset_id=j.dataset_id
            AND acl.source_namespace IN (${demo},${pending},${crypto})) THEN
          RAISE EXCEPTION 'Audit report access denied' USING ERRCODE='42501';
        END IF;
        ${auditExportReaderProjectionGuard(db.schema, 'job', 'summary')}

        WITH allowed AS MATERIALIZED (
          SELECT source_namespace FROM ${a}.audit_report_acl
          WHERE operator_name=session_user AND dataset_id=j.dataset_id
            AND source_namespace IN (${demo},${pending},${crypto})
        ), refs AS MATERIALIZED (
          SELECT r.* FROM allowed s CROSS JOIN LATERAL (
            SELECT ref.source_namespace,ref.source_row_id,ref.account_id,ref.operation_id,ref.occurred_at_ms
            FROM ${a}.audit_posting_refs ref
            WHERE ref.dataset_id=j.dataset_id AND ref.source_namespace=s.source_namespace
              AND ref.occurred_at_ms>=(j.filters->>'fromMs')::bigint AND ref.occurred_at_ms<(j.filters->>'toMs')::bigint
              AND (j.filters->>'accountId' IS NULL OR ref.account_id=j.filters->>'accountId')
            -- Success uses every row. An extra row only serves as the scan-limit sentinel.
            LIMIT ${AUDIT_SUMMARY_SCAN_CAP + 1}
          ) r LIMIT ${AUDIT_SUMMARY_SCAN_CAP + 1}
        ), scan AS (SELECT count(*) AS scanned FROM refs), anchors AS NOT MATERIALIZED (
          SELECT j.dataset_id AS dataset_id,refs.*,NULL::bigint AS prior_id,NULL::numeric AS opening_balance
          FROM refs WHERE (SELECT scanned FROM scan)<=${AUDIT_SUMMARY_SCAN_CAP}
        ), projected AS (${selects}), classified AS MATERIALIZED (
          SELECT fee.source_row_id,fee.account_id,fee.operation_id,fee.entity_id,
            q.amount,q.reserved_delta,q.pending_delta,q.contour,q.asset,q.scale,q.category,q.movement,
            (j.filters->>'category' IS NULL OR q.category=j.filters->>'category')
              AND (j.filters->>'gameId' IS NULL OR q.game_id=j.filters->>'gameId')
              AND (j.filters->>'modeId' IS NULL OR q.mode_id=j.filters->>'modeId')
              AND (j.filters->>'asset' IS NULL OR q.asset=j.filters->>'asset')
              AND (j.filters->>'contour' IS NULL OR q.contour=j.filters->>'contour') AS matches_filters,
            CASE WHEN q.source_namespace=${crypto} AND q.movement='withdrawal-paid' AND q.amount=0 AND q.reserved_delta<0
              THEN -q.reserved_delta END AS confirmed_withdrawal,
            CASE WHEN NOT q.present THEN 'source-unavailable' WHEN q.movement IS NULL THEN 'unsupported'
              WHEN q.movement='withdrawal-paid' AND (q.amount IS DISTINCT FROM 0 OR q.reserved_delta IS NULL OR q.reserved_delta>=0)
                THEN 'partial' ELSE 'complete' END AS coverage
          FROM projected q
          LEFT JOIN LATERAL (
            SELECT q.source_row_id,q.account_id,q.operation_id,q.entity_id
            WHERE j.filters->>'accountId' IS NULL AND q.present AND q.source_namespace=${demo}
              AND q.category IN ('pvp','totalizator') AND q.movement='payout' AND q.amount>0
          ) fee ON true
        ), gaps AS (
          SELECT count(*) FILTER (WHERE coverage='source-unavailable') AS unavailable,
            count(*) FILTER (WHERE coverage='unsupported') AS unclassified,
            count(*) FILTER (WHERE coverage='partial') AS invalid_withdrawals
          FROM classified
        ), fee_anchors AS (
          SELECT m.* FROM classified m
          WHERE m.matches_filters AND m.source_row_id IS NOT NULL
            -- Charge once across periods, even when multiple pool credits have different timestamps.
            AND m.source_row_id=(SELECT older.source_row_id FROM ${a}.audit_posting_refs older
              WHERE older.dataset_id=j.dataset_id AND older.source_namespace=${demo}
                AND older.operation_id=m.operation_id ORDER BY older.source_row_id LIMIT 1)
        ), fees AS MATERIALIZED (
          SELECT m.contour,m.asset,m.scale,m.category,
            CASE WHEN b.state='settled' AND b.winner_id=m.account_id AND holds.total=m.amount+b.fee_units
                AND holds.winner_capacity=m.amount THEN b.fee_units::numeric
              WHEN pool.state='settled' AND pool.rules_version=1 AND saved.value->>'state'='settled'
                AND saved.value->>'potUnits'=tickets.bank::text AND tickets.credit=m.amount
                AND tickets.bank=tickets.payouts+saved.fee AND saved.fee=trunc(tickets.bank/20)
                THEN saved.fee END AS fee
          FROM fee_anchors m
          LEFT JOIN ${g}.virtual_pvp_banks b ON m.category='pvp' AND b.match_id=m.entity_id
            AND m.operation_id='pvp:'||b.match_id||':final'
          LEFT JOIN LATERAL (
            SELECT sum(h.stake_units::numeric) AS total,
              max(h.reserved_units) FILTER (WHERE h.account_id=b.winner_id) AS winner_capacity
            FROM ${g}.virtual_pvp_holds h WHERE h.match_id=b.match_id
            HAVING count(*)=2 AND bool_and(h.state='settled' AND h.stake_units=b.stake_units)
          ) holds ON true
          LEFT JOIN ${g}.flag_tote_rounds pool ON m.category='totalizator' AND pool.id=m.entity_id
            AND m.operation_id='flag-tote:'||pool.id||':final'
          LEFT JOIN LATERAL (
            SELECT sum(t.stake_units::numeric) AS bank,sum(t.payout_units::numeric) AS payouts,
              sum(t.payout_units::numeric) FILTER (WHERE t.account_id=m.account_id) AS credit
            FROM ${g}.flag_tote_tickets t WHERE t.round_id=pool.id
            HAVING count(*) BETWEEN 1 AND 256 AND count(t.payout_units)=count(*)
          ) tickets ON true
          LEFT JOIN LATERAL (
            SELECT parsed.value,
              CASE WHEN parsed.value->>'feeUnits' ~ '^(0|[1-9][0-9]{0,6})$'
                THEN (parsed.value->>'feeUnits')::numeric END AS fee
            FROM (SELECT CASE WHEN pg_input_is_valid(pool.settlement,'jsonb')
              THEN pool.settlement::jsonb END AS value) parsed
          ) saved ON true
        ), totals AS (
          SELECT contour,asset,scale,category,movement AS movement_type,count(*) AS posting_count,
            sum(amount) AS amount,sum(reserved_delta) AS reserved_delta,sum(pending_delta) AS pending_delta,
            sum(confirmed_withdrawal) AS confirmed_withdrawal,NULL::numeric AS fee,coverage
          FROM classified WHERE matches_filters GROUP BY contour,asset,scale,category,movement,coverage
          UNION ALL
          SELECT contour,asset,scale,category,'fee',0,NULL,NULL,NULL,NULL,sum(fee),
            CASE WHEN fee IS NULL THEN 'partial' ELSE 'complete' END
          FROM fees GROUP BY contour,asset,scale,category,fee IS NULL
        )
        SELECT jsonb_build_object('datasetId',j.dataset_id::text,'environment',j.environment,
          'asOf',to_char(statement_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'sources',COALESCE((SELECT jsonb_agg(source_namespace ORDER BY source_namespace) FROM allowed),'[]'::jsonb),
          'scanned',(SELECT scanned FROM scan),
          'gaps',jsonb_build_object(
            'unavailablePostings',gaps.unavailable,
            'unclassifiedPostings',gaps.unclassified,
            'invalidWithdrawalPostings',gaps.invalid_withdrawals,
            'unavailableFees',(SELECT count(*) FROM fees WHERE fee IS NULL),
            'feesExcludedForAccount',j.filters->>'accountId' IS NOT NULL),
          'rows',COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'contour',t.contour,'asset',t.asset,'scale',t.scale::text,'category',t.category,
            'movement_type',t.movement_type,'posting_count',t.posting_count::text,'amount_units',t.amount::text,
            'reserved_delta_units',t.reserved_delta::text,'pending_delta_units',t.pending_delta::text,
            'confirmed_withdrawal_units',t.confirmed_withdrawal::text,'fee_units',t.fee::text,'coverage_status',t.coverage)
            ORDER BY t.contour,t.asset,t.scale,t.category,t.movement_type,t.coverage) FROM totals t),'[]'::jsonb))
        INTO report FROM gaps;
        IF (report->>'scanned')::bigint>${AUDIT_SUMMARY_SCAN_CAP} THEN
          RAISE EXCEPTION 'Audit summary scan limit exceeded' USING ERRCODE='54000';
        END IF;
        RETURN report;
      END
      $summary$;
      REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION ${signature} TO ${identifier(readerRole)}`);
  }, { lockKey: 'audit-report-summary-install' });
}
