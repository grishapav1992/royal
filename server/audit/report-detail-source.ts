import { identifier, type PostgresDatabase } from '../database';
import { applySchemaMigration } from '../database-migrations';
import type { AuditSourceRef } from './contract';
import type { AuditSourceSchemas } from './datasets';
import { auditPostingProjectionSql } from './report-player-source';

export const AUDIT_DETAIL_MAX_BYTES = 262144;
const maxPostings = 128;
const maxEvidence = 64;

export type AuditDetailReport = {
  schemaVersion: 1;
  datasetId: string;
  environment: 'test' | 'live';
  status: 'found' | 'not-captured' | 'source-unavailable';
  source: AuditSourceRef;
  anchor: Record<string, unknown> | null;
  linkedPostings: Record<string, unknown>[];
  operation: Record<string, unknown> | null;
  outcome: Record<string, unknown> | null;
  events: Record<string, unknown>[];
  attempts: Record<string, unknown>[];
  coverage: Record<string, unknown>;
};

const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'";
const slug = '^[a-z0-9][a-z0-9._-]{0,127}$';
const units = '^(0|-?[1-9][0-9]{0,77})$';
const recordId = '^[a-zA-Z0-9._:-]{1,128}$';

function posting(alias: string) {
  const previous = `CASE WHEN ${alias}.prior_id IS NULL THEN ${alias}.opening_balance ELSE ${alias}.prior_balance END`;
  return `jsonb_build_object(
    'source',jsonb_build_object('namespace',${alias}.source_namespace,'rowId',${alias}.source_row_id::text),
    'accountId',${alias}.account_id,'operationId',${alias}.operation_id,'occurredAtMs',${alias}.occurred_at_ms::text,
    'category',${alias}.category,
    'gameId',CASE WHEN ${alias}.game_id ~ '${slug}' THEN ${alias}.game_id END,
    'modeId',CASE WHEN ${alias}.mode_id ~ '${slug}' THEN ${alias}.mode_id END,
    'rulesVersion',CASE WHEN ${alias}.rules_version ~ '${slug}' THEN ${alias}.rules_version END,
    'entityId',${alias}.entity_id,'ticketId',${alias}.ticket_id,'movement',${alias}.movement,
    'asset',jsonb_build_object('contour',${alias}.contour,'code',${alias}.asset,'scale',${alias}.scale),
    'amountUnits',${alias}.amount::text,'reservedDeltaUnits',${alias}.reserved_delta::text,
    'storedBalanceUnits',${alias}.balance::text,
    'expectedBalanceUnits',CASE WHEN ${alias}.balance IS NOT NULL THEN ((${previous})+${alias}.amount)::text END,
    'expectedBalanceBasis',CASE WHEN ${alias}.balance IS NULL OR (${previous}) IS NULL THEN 'unavailable'
      WHEN ${alias}.prior_id IS NULL THEN 'opening' ELSE 'adjacent' END,
    'pendingDeltaUnits',${alias}.pending_delta::text,'storedPendingUnits',${alias}.pending_balance::text,
    'coverage',CASE WHEN NOT ${alias}.present THEN 'source-unavailable'
      WHEN ${alias}.movement IS NULL THEN 'unsupported' ELSE 'partial' END)`;
}

/** Fixed, privileged SQL. The report login can read only the source selected by its committed job. */
export async function installAuditDetailReport(db: PostgresDatabase, readerRole: string, sources: AuditSourceSchemas) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(readerRole)) throw new Error('Invalid audit detail reader role');
  const { a, g, p, demo, pending, crypto, selects } = await auditPostingProjectionSql(db, sources);
  await applySchemaMigration(db, { id: 'paid-activity-audit-detail-events-v1', statements: [], indexes: [
    { name: 'audit_evidence_detail_events', table: 'audit_evidence',
      columns: ['dataset_id', 'account_id', "(payload->>'operationId')", 'occurred_at_ms', 'evidence_id'],
      where: "kind='event'" },
  ] });
  const fn = a + '.audit_report_detail', signature = fn + '(uuid)';
  const anchors = `anchors AS (
    SELECT r.*,older.source_row_id AS prior_id,opening.available_units AS opening_balance
    FROM refs r LEFT JOIN LATERAL (
      SELECT old.source_row_id FROM ${a}.audit_posting_refs old WHERE old.dataset_id=r.dataset_id
        AND old.account_id=r.account_id AND old.source_namespace=r.source_namespace AND old.source_row_id<r.source_row_id
      ORDER BY old.source_row_id DESC LIMIT 1
    ) older ON true
    LEFT JOIN ${a}.audit_opening_balances opening ON opening.dataset_id=r.dataset_id AND opening.account_id=r.account_id
      AND opening.source_namespace=r.source_namespace AND older.source_row_id IS NULL
  )`;
  const operationSource = (table: string, id: string, gameSchema = sources.game) => `jsonb_build_object(
    'namespace',${literal(gameSchema + '.' + table)},
    'rowId','['||to_json(v_anchor.account_id)::text||','||to_json(${id})::text||']')`;

  await db.transaction(async () => {
    await db.exec(`CREATE OR REPLACE FUNCTION ${fn}(p_job uuid) RETURNS jsonb
      LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET plan_cache_mode=force_custom_plan AS $detail$
      DECLARE
        j record;
        v_anchor record;
        v_source text;
        v_id text;
        v_keys text[];
        v_routes text[] := ARRAY[]::text[];
        v_operation jsonb;
        v_outcome jsonb;
        v_postings jsonb := '[]'::jsonb;
        v_events jsonb := '[]'::jsonb;
        v_attempts jsonb := '[]'::jsonb;
        v_outcome_coverage text := 'not-recorded';
        v_links_truncated boolean := false;
        v_events_truncated boolean := false;
        v_attempts_truncated boolean := false;
        v_report jsonb;
      BEGIN
        IF current_setting('transaction_isolation')<>'read committed' OR pg_current_xact_id_if_assigned() IS NOT NULL THEN
          RAISE EXCEPTION 'Audit report requires a separate committed job' USING ERRCODE='42501';
        END IF;
        SELECT e.dataset_id,e.filters,d.environment,d.sealed_at_ms INTO j
          FROM ${a}.audit_export_jobs e JOIN ${a}.audit_datasets d ON d.id=e.dataset_id
          WHERE e.id=p_job AND e.operator_name=SESSION_USER AND e.kind='detail'
            AND e.status='running' AND e.expires_at>clock_timestamp();
        IF NOT FOUND THEN RAISE EXCEPTION 'Audit detail access denied' USING ERRCODE='42501'; END IF;
        v_source := j.filters->>'source';
        v_id := j.filters->>'postingId';
        IF v_source IS NULL OR NOT (v_source=ANY(array_remove(ARRAY[${demo},${pending},${crypto}]::text[],NULL)))
          OR NOT EXISTS (SELECT 1 FROM ${a}.audit_report_acl acl WHERE acl.operator_name=SESSION_USER
            AND acl.dataset_id=j.dataset_id AND acl.source_namespace=v_source) THEN
          RAISE EXCEPTION 'Audit detail access denied' USING ERRCODE='42501';
        END IF;
        IF v_id IS NULL OR v_id !~ '^[1-9][0-9]{0,18}$' THEN
          RAISE EXCEPTION 'Invalid audit detail anchor' USING ERRCODE='22023';
        END IF;
        IF v_id::numeric>9223372036854775807 THEN
          RAISE EXCEPTION 'Invalid audit detail anchor' USING ERRCODE='22023';
        END IF;
        v_report := jsonb_build_object('schemaVersion',1,'datasetId',j.dataset_id::text,'environment',j.environment,
          'source',jsonb_build_object('namespace',v_source,'rowId',v_id),'anchor',NULL,'linkedPostings','[]'::jsonb,
          'operation',NULL,'outcome',NULL,'events','[]'::jsonb,'attempts','[]'::jsonb,'coverage','{}'::jsonb);

        WITH refs AS MATERIALIZED (
          SELECT r.* FROM ${a}.audit_posting_refs r WHERE r.dataset_id=j.dataset_id
            AND r.source_namespace=v_source AND r.source_row_id=v_id::bigint
        ), ${anchors}, projected AS (${selects})
        SELECT projected.*, ${posting('projected')} AS detail FROM projected INTO v_anchor;
        IF NOT FOUND THEN RETURN v_report||jsonb_build_object('status','not-captured',
          'coverage',jsonb_build_object('anchor','not-captured')); END IF;
        IF NOT v_anchor.present THEN
          RETURN v_report||jsonb_build_object('status','source-unavailable','anchor',v_anchor.detail,
            'coverage',jsonb_build_object('anchor','source-unavailable'));
        END IF;

        v_keys := ARRAY[v_anchor.operation_id]::text[];
        IF v_source=${demo} THEN
          IF v_anchor.category='casino' AND v_anchor.entity_id IS NOT NULL THEN
            IF EXISTS (SELECT 1 FROM ${g}.demo_casino_sessions s WHERE s.account_id=v_anchor.account_id
              AND s.id=v_anchor.entity_id AND s.game_id=v_anchor.game_id) THEN
              v_keys := v_keys||ARRAY[v_anchor.entity_id]||ARRAY(
                SELECT r.id FROM ${g}.demo_casino_requests r WHERE r.account_id=v_anchor.account_id
                  AND r.session_id=v_anchor.entity_id AND (j.sealed_at_ms IS NULL OR EXISTS (
                    SELECT 1 FROM ${a}.audit_posting_refs captured WHERE captured.dataset_id=j.dataset_id
                      AND captured.source_namespace=v_source AND captured.account_id=r.account_id
                      AND captured.operation_id=r.id))
                  ORDER BY r.id LIMIT ${maxPostings + 1});
              v_routes := ARRAY['/api/demo-wallet/expansion','/api/demo-wallet/casino-sessions'];
              SELECT jsonb_build_object('id',r.id,'kind',
                CASE WHEN saved.key->>'action' IN ('start','move','pick','cashout') THEN saved.key->>'action'
                     WHEN saved.key->>2 IN ('start','pick','cashout') THEN saved.key->>2 END,
                'source',${operationSource('demo_casino_requests', 'r.id')},'occurredAtMs',r.created_at::text,
                'entityId',r.session_id) INTO v_operation
              FROM ${g}.demo_casino_requests r CROSS JOIN LATERAL (
                SELECT CASE WHEN octet_length(r.request_key)<=8192 AND pg_input_is_valid(r.request_key,'jsonb')
                  THEN r.request_key::jsonb END AS key
              ) saved WHERE r.account_id=v_anchor.account_id AND r.id=v_anchor.operation_id
                AND r.session_id=v_anchor.entity_id AND NOT (v_anchor.game_id='github-crash'
                  AND v_anchor.movement='payout' AND v_anchor.operation_id=v_anchor.entity_id);
              IF v_operation IS NULL AND v_anchor.game_id='github-crash' AND v_anchor.movement='payout'
                AND v_anchor.operation_id=v_anchor.entity_id THEN
                v_operation := jsonb_build_object('id',v_anchor.operation_id,'kind','automatic-settlement',
                  'source',${operationSource('demo_casino_sessions', 'v_anchor.entity_id')},'entityId',v_anchor.entity_id);
              END IF;
              IF j.sealed_at_ms IS NULL THEN
                SELECT jsonb_build_object('kind','casino-session','basis','current-source',
                  'state',CASE WHEN s.state IN ('active','settled','lost','cashed_out') THEN s.state END,
                  'stakeUnits',CASE WHEN saved.body->>'stakeUnits' ~ '${units}' THEN saved.body->>'stakeUnits' END,
                  'spentUnits',CASE WHEN saved.body->>'spentUnits' ~ '${units}' THEN saved.body->>'spentUnits' END,
                  'payoutUnits',CASE WHEN saved.body->>'returnedUnits' ~ '${units}' THEN saved.body->>'returnedUnits' END)
                  INTO v_outcome FROM ${g}.demo_casino_sessions s CROSS JOIN LATERAL (
                    SELECT CASE WHEN octet_length(s.payload)<=1048576 AND pg_input_is_valid(s.payload,'jsonb')
                      THEN s.payload::jsonb END AS body
                  ) saved WHERE s.account_id=v_anchor.account_id AND s.id=v_anchor.entity_id AND s.game_id=v_anchor.game_id;
              ELSE v_outcome_coverage := 'mutable-source-after-seal'; END IF;
            END IF;
          ELSIF v_anchor.category='pvp' AND v_anchor.entity_id IS NOT NULL THEN
            v_keys := v_keys||ARRAY['pvp:'||v_anchor.entity_id||':hold','pvp:'||v_anchor.entity_id||':final'];
          ELSIF v_anchor.category='totalizator' AND v_anchor.entity_id IS NOT NULL THEN
            v_keys := v_keys||ARRAY['flag-tote:'||v_anchor.entity_id||':final']||ARRAY(
              SELECT 'flag-tote:'||t.id FROM ${g}.flag_tote_tickets t WHERE t.round_id=v_anchor.entity_id
                AND t.account_id=v_anchor.account_id AND (EXISTS (
                  SELECT 1 FROM ${a}.audit_posting_refs captured WHERE captured.dataset_id=j.dataset_id
                    AND captured.source_namespace=v_source AND captured.account_id=t.account_id
                    AND captured.operation_id='flag-tote:'||t.id) OR EXISTS (
                  SELECT 1 FROM ${a}.audit_opening_obligations opening WHERE opening.dataset_id=j.dataset_id
                    AND opening.source_namespace=${literal(sources.game + '.flag_tote_tickets')}
                    AND opening.account_id=t.account_id AND opening.entity_id=t.id))
                ORDER BY t.sequence LIMIT ${maxPostings + 1});
            v_routes := ARRAY['/api/demo-wallet/flag-tote'];
            SELECT jsonb_build_object('id',t.id,'kind','ticket','stakeUnits',t.stake_units::text,'country',
              CASE WHEN t.country ~ '^[A-Z]{2}$' THEN t.country END,'entityId',t.round_id,
              'source',jsonb_build_object('namespace',${literal(sources.game + '.flag_tote_tickets')},'rowId',t.id)) INTO v_operation
            FROM ${g}.flag_tote_tickets t WHERE t.id=v_anchor.ticket_id AND t.account_id=v_anchor.account_id
              AND t.round_id=v_anchor.entity_id;
          END IF;
          IF v_operation IS NULL AND v_anchor.category IS DISTINCT FROM 'pvp'
            AND v_anchor.category IS DISTINCT FROM 'totalizator' AND cardinality(v_routes)=0 THEN
            SELECT jsonb_build_object('id',o.operation_id,'kind',o.kind,'amountUnits',o.amount_units::text,
              'source',${operationSource('demo_operations', 'o.operation_id')},
              'parameters',CASE WHEN saved.request->>0=o.kind AND saved.request->>2=v_anchor.game_id THEN
                CASE WHEN v_anchor.game_id='royal-roulette' AND saved.request#>>'{4,bet}' IN ('black','red','even','odd','number')
                  THEN jsonb_build_object('bet',saved.request#>>'{4,bet}','number',
                    CASE WHEN saved.request#>>'{4,number}' ~ '^([0-9]|[12][0-9]|3[0-6])$' THEN saved.request#>>'{4,number}' END)
                WHEN v_anchor.game_id='royal-plinko' AND saved.request#>>'{4,risk}' IN ('easy','medium','hard','expert')
                  AND saved.request#>>'{4,rows}' ~ '^([89]|1[0-6])$'
                  THEN jsonb_build_object('risk',saved.request#>>'{4,risk}','rows',saved.request#>>'{4,rows}') END END),
              CASE WHEN o.kind IN ('play','spin') AND saved.round->>'gameId'=v_anchor.game_id THEN
                jsonb_build_object('kind','casino-round','basis','accepted-receipt','state','settled',
                  'stakeUnits',CASE WHEN saved.round->>'stakeUnits' ~ '${units}' THEN saved.round->>'stakeUnits' END,
                  'payoutUnits',CASE WHEN saved.round->>'payoutUnits' ~ '${units}' THEN saved.round->>'payoutUnits' END,
                  'rouletteNumber',CASE WHEN v_anchor.game_id='royal-roulette' AND saved.round#>>'{outcome,number}' ~ '^([0-9]|[12][0-9]|3[0-6])$'
                    THEN saved.round#>>'{outcome,number}' END,
                  'plinkoBucket',CASE WHEN v_anchor.game_id='royal-plinko' AND saved.round#>>'{outcome,bucket}' ~ '^([0-9]|1[0-6])$'
                    THEN saved.round#>>'{outcome,bucket}' END) END
              INTO v_operation,v_outcome
            FROM ${g}.demo_operations o CROSS JOIN LATERAL (
              SELECT CASE WHEN octet_length(o.result)<=32768 AND pg_input_is_valid(o.result,'jsonb')
                THEN o.result::jsonb->'gameRound' END AS round,
                CASE WHEN octet_length(o.request_key)<=8192 AND pg_input_is_valid(o.request_key,'jsonb')
                  THEN o.request_key::jsonb END AS request
            ) saved WHERE o.account_id=v_anchor.account_id AND o.operation_id=v_anchor.operation_id
              AND o.kind IN ('deposit','play','spin');
            IF v_operation IS NOT NULL THEN v_routes := ARRAY['/api/demo-wallet/operations'];
            ELSIF v_anchor.game_id='royal-flight' THEN v_routes := ARRAY['/api/demo-wallet/flight'];
            ELSIF v_anchor.game_id='royal-mines' THEN v_routes := ARRAY['/api/demo-wallet/mines']; END IF;
          END IF;
        ${p ? `ELSIF v_source=${crypto} THEN
          v_routes := ARRAY['/api/crypto-wallet/deposits','/api/crypto-wallet/withdrawals',
            '/api/crypto-wallet/rounds','/api/crypto-wallet/stars','/api/crypto-wallet/operations/:id/refresh'];
          SELECT jsonb_build_object('id',o.id,'kind',o.kind,'amountUnits',o.amount_units::text,
            'source',jsonb_build_object('namespace',${literal(sources.payments + '.crypto_operations')},'rowId',o.id),
            'occurredAtMs',o.created_at::text) INTO v_operation
          FROM ${p}.crypto_operations o WHERE o.account_id=v_anchor.account_id AND o.id=v_anchor.operation_id;` : ''}
        END IF;

        v_keys := ARRAY[v_anchor.operation_id]||ARRAY(SELECT DISTINCT k FROM unnest(v_keys) AS x(k)
          WHERE k<>v_anchor.operation_id ORDER BY k LIMIT ${maxPostings});
        v_links_truncated := cardinality(v_keys)>${maxPostings};
        v_keys := v_keys[1:${maxPostings}];
        WITH refs AS MATERIALIZED (
          SELECT r.* FROM ${a}.audit_posting_refs r WHERE r.dataset_id=j.dataset_id
            AND r.source_namespace=v_source AND r.account_id=v_anchor.account_id AND r.operation_id=ANY(v_keys)
            AND r.source_row_id<>v_id::bigint ORDER BY r.source_row_id LIMIT ${maxPostings + 1}
        ), ${anchors}, projected AS (${selects}), page AS (
          SELECT * FROM projected ORDER BY source_row_id LIMIT ${maxPostings}
        )
        SELECT COALESCE((SELECT jsonb_agg(${posting('page')} ORDER BY source_row_id) FROM page),'[]'::jsonb),
          v_links_truncated OR (SELECT count(*) FROM refs)>${maxPostings}
          INTO v_postings,v_links_truncated;

        IF v_source=${demo} AND v_anchor.category='pvp' AND v_anchor.entity_id IS NOT NULL
          AND (j.sealed_at_ms IS NULL OR v_anchor.operation_id='pvp:'||v_anchor.entity_id||':final' OR EXISTS (
            SELECT 1 FROM jsonb_array_elements(v_postings) p WHERE p->>'operationId'='pvp:'||v_anchor.entity_id||':final'
              AND p->>'coverage'<>'source-unavailable')) THEN
          SELECT jsonb_build_object('kind','pvp-bank','basis',CASE WHEN j.sealed_at_ms IS NULL THEN 'current-source'
            ELSE 'captured-settlement' END,'state',b.state,'reason',
            CASE WHEN b.reason IN ('win','draw','cancel','expired','server','disconnect','resign','timeout') THEN b.reason END,
            'feeUnits',b.fee_units::text,'accountWon',CASE WHEN b.state='settled' THEN b.winner_id=v_anchor.account_id END)
            INTO v_outcome FROM ${g}.virtual_pvp_banks b WHERE b.match_id=v_anchor.entity_id AND b.game_id=v_anchor.game_id;
        ELSIF v_source=${demo} AND v_anchor.category='totalizator' AND v_anchor.entity_id IS NOT NULL
          AND (j.sealed_at_ms IS NULL OR v_anchor.operation_id='flag-tote:'||v_anchor.entity_id||':final' OR EXISTS (
            SELECT 1 FROM jsonb_array_elements(v_postings) p WHERE p->>'operationId'='flag-tote:'||v_anchor.entity_id||':final'
              AND p->>'coverage'<>'source-unavailable')) THEN
          SELECT jsonb_build_object('kind','pool','basis',CASE WHEN j.sealed_at_ms IS NULL THEN 'current-source'
            ELSE 'captured-settlement' END,'state',r.state,'bankUnits',
            CASE WHEN saved.value->>'potUnits' ~ '${units}' THEN saved.value->>'potUnits' END,'feeUnits',
            CASE WHEN saved.value->>'feeUnits' ~ '${units}' THEN saved.value->>'feeUnits' END)
            INTO v_outcome FROM ${g}.flag_tote_rounds r CROSS JOIN LATERAL (
              SELECT CASE WHEN octet_length(r.settlement)<=65536 AND pg_input_is_valid(r.settlement,'jsonb')
                THEN r.settlement::jsonb END AS value
            ) saved WHERE r.id=v_anchor.entity_id;
        END IF;
        IF v_outcome IS NOT NULL THEN v_outcome_coverage := 'stored'; END IF;

        -- Operation IDs inside the transport differ from Flag Tote ledger operation IDs.
        IF v_source=${demo} AND v_anchor.category='totalizator' THEN
          v_keys := v_keys||ARRAY(SELECT substring(k from 11) FROM unnest(v_keys) AS x(k)
            WHERE k ~ '^flag-tote:[a-fA-F0-9-]{36}$');
        END IF;
        WITH evidence AS MATERIALIZED (
          SELECT e.evidence_id,e.kind,e.occurred_at_ms,e.payload FROM ${a}.audit_evidence e
          WHERE e.dataset_id=j.dataset_id AND e.kind='event'
            AND e.payload->>'operationId'=ANY(v_keys) AND e.payload->>'eventId'=e.evidence_id
            AND e.evidence_id ~ '${recordId}' AND (
              (e.account_id=v_anchor.account_id AND e.payload->>'accountId'=v_anchor.account_id) OR
              (e.account_id IS NULL AND e.payload->'accountId'='null'::jsonb
                AND e.payload->'postings' @> jsonb_build_array(v_anchor.detail->'source')))
            AND e.payload->'schemaVersion'='1'::jsonb AND e.payload->>'type'=e.kind
            AND jsonb_typeof(e.payload->'occurredAtMs')='number' AND e.payload->>'occurredAtMs'=e.occurred_at_ms::text
            AND e.payload#>>'{scope,datasetId}'=j.dataset_id::text AND e.payload#>>'{scope,environment}'=j.environment
            AND e.payload#>>'{entity,category}'=v_anchor.category AND e.payload#>>'{entity,gameId}'=v_anchor.game_id
            AND e.payload->>'event' IN ('accepted','advanced','reserved','released','settled','cancelled','timed-out',
              'disconnected','reconnected','forfeited','recovered')
            AND octet_length(e.payload::text)<=8192
          ORDER BY e.occurred_at_ms,e.evidence_id LIMIT ${maxEvidence + 1}
        ), page AS (SELECT * FROM evidence LIMIT ${maxEvidence})
        SELECT COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id',e.evidence_id,'operationId',e.payload->>'operationId','occurredAtMs',e.occurred_at_ms::text,
          'accountId',e.payload->>'accountId','event',e.payload->>'event','sequence',CASE WHEN e.payload->>'sequence' ~ '^[0-9]{1,78}$' THEN e.payload->>'sequence' END,
          'reasonCode',CASE WHEN e.payload->>'reasonCode' ~ '${slug}' THEN e.payload->>'reasonCode' END,
          'postings',COALESCE((SELECT jsonb_agg(p->'source' ORDER BY (p#>>'{source,rowId}')::bigint)
            FROM jsonb_array_elements(jsonb_build_array(v_anchor.detail)||v_postings) p
            WHERE p->>'coverage'<>'source-unavailable' AND e.payload->'postings' @> jsonb_build_array(p->'source')),'[]'::jsonb))
          ORDER BY e.occurred_at_ms,e.evidence_id) FROM page e),'[]'::jsonb),
          (SELECT count(*) FROM evidence)>${maxEvidence} INTO v_events,v_events_truncated;

        WITH evidence AS MATERIALIZED (
          SELECT e.evidence_id,e.occurred_at_ms,e.payload FROM ${a}.audit_evidence e
          WHERE e.dataset_id=j.dataset_id AND e.account_id=v_anchor.account_id AND e.kind='attempt'
            AND e.payload->>'operationId'=ANY(v_keys) AND e.payload->>'route'=ANY(v_routes)
            AND e.payload->>'attemptId'=e.evidence_id AND e.evidence_id ~ '${recordId}'
            AND e.payload->>'accountId'=v_anchor.account_id AND e.payload->'schemaVersion'='1'::jsonb
            AND e.payload->>'type'=e.kind AND jsonb_typeof(e.payload->'occurredAtMs')='number'
            AND e.payload->>'occurredAtMs'=e.occurred_at_ms::text AND e.payload#>>'{scope,datasetId}'=j.dataset_id::text AND e.payload#>>'{scope,environment}'=j.environment
            AND e.payload->>'decision' IN ('accepted','replayed','rejected','unknown')
            AND e.payload->>'response' IN ('formed','not-observed') AND e.payload->>'transport' IN ('http','websocket')
            AND octet_length(e.payload::text)<=8192
          ORDER BY e.occurred_at_ms,e.evidence_id LIMIT ${maxEvidence + 1}
        ), page AS (SELECT * FROM evidence LIMIT ${maxEvidence}), observations AS (
          SELECT e.*,CASE WHEN e.payload->>'response'='not-observed' THEN 'not-recorded'
            WHEN e.payload#>>'{balance,state}'='value' AND jsonb_typeof(e.payload#>'{balance,units}')='string'
            AND e.payload#>>'{balance,units}' ~ '${units}' AND (
              (e.payload#>>'{balance,asset,code}'='VIRTUAL_USD' AND e.payload#>>'{balance,asset,contour}'='virtual'
                AND e.payload#>>'{balance,asset,scale}'='2' AND v_source=${demo}) OR
              (e.payload#>>'{balance,asset,code}'='USDT' AND e.payload#>>'{balance,asset,contour}'='real'
                AND e.payload#>>'{balance,asset,scale}'='6' AND v_source=${crypto}))
            THEN 'value' WHEN e.payload#>>'{balance,state}' IN ('absent','invalid','not-recorded')
            THEN e.payload#>>'{balance,state}' ELSE 'invalid' END AS balance_state,
            s.id AS snapshot_id,s.balance_units AS snapshot_balance
          FROM page e LEFT JOIN LATERAL (
            SELECT l.id,l.balance_units FROM ${a}.audit_posting_refs r JOIN ${g}.demo_ledger l
              ON l.id=r.source_row_id AND l.account_id=r.account_id AND l.operation_id=r.operation_id
                AND l.created_at=r.occurred_at_ms
            WHERE v_source=${demo} AND r.dataset_id=j.dataset_id AND r.source_namespace=v_source
              AND r.account_id=v_anchor.account_id AND e.payload#>>'{balance,snapshot,namespace}'=v_source
              AND r.source_row_id=CASE WHEN e.payload#>>'{balance,snapshot,rowId}' ~ '^[1-9][0-9]{0,18}$' THEN
                CASE WHEN (e.payload#>>'{balance,snapshot,rowId}')::numeric<=9223372036854775807
                  THEN (e.payload#>>'{balance,snapshot,rowId}')::bigint END END
          ) s ON true
        )
        SELECT COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id',e.evidence_id,'operationId',e.payload->>'operationId','occurredAtMs',e.occurred_at_ms::text,
          'route',e.payload->>'route','transport',e.payload->>'transport','decision',e.payload->>'decision',
          'response',e.payload->>'response','statusCode',CASE WHEN e.payload->>'response'='formed'
            AND e.payload->>'transport'='http' AND jsonb_typeof(e.payload->'statusCode')='number'
            AND e.payload->>'statusCode' ~ '^[1-5][0-9]{2}$'
            THEN (e.payload->>'statusCode')::integer END,
          'delivery',CASE WHEN e.payload->>'delivery' IN ('closed','unobserved') OR
            (e.payload->>'delivery'='handed-off' AND e.payload->>'response'='formed') THEN e.payload->>'delivery' END,
          'balance',CASE WHEN e.balance_state='value' THEN jsonb_build_object('state','value','units',e.payload#>>'{balance,units}',
            'asset',jsonb_build_object('contour',v_anchor.contour,'code',v_anchor.asset,'scale',v_anchor.scale),
            'snapshot',CASE WHEN e.snapshot_id IS NOT NULL THEN jsonb_build_object('namespace',v_source,'rowId',e.snapshot_id::text) END,
            'snapshotBalanceUnits',e.snapshot_balance::text) ELSE jsonb_build_object('state',e.balance_state) END)
          ORDER BY e.occurred_at_ms,e.evidence_id) FROM observations e),'[]'::jsonb),
          (SELECT count(*) FROM evidence)>${maxEvidence} INTO v_attempts,v_attempts_truncated;

        v_report := v_report||jsonb_build_object('status','found','anchor',v_anchor.detail,'linkedPostings',v_postings,
          'operation',v_operation,'outcome',v_outcome,'events',v_events,'attempts',v_attempts,'coverage',jsonb_build_object(
            'linkedPostingsTruncated',v_links_truncated,'eventsTruncated',v_events_truncated,'attemptsTruncated',v_attempts_truncated,
            'operation',CASE WHEN v_operation IS NOT NULL THEN 'stored' ELSE 'not-recorded' END,
            'outcome',v_outcome_coverage,'events',CASE WHEN jsonb_array_length(v_events)>0 THEN 'partial' ELSE 'not-recorded' END,
            'attempts',CASE WHEN jsonb_array_length(v_attempts)>0 THEN 'partial' ELSE 'not-recorded' END));
        IF octet_length(v_report::text)>${AUDIT_DETAIL_MAX_BYTES} THEN
          RAISE EXCEPTION 'Audit detail byte limit exceeded' USING ERRCODE='54000';
        END IF;
        RETURN v_report;
      END
      $detail$;
      REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION ${signature} TO ${identifier(readerRole)}`);
  }, { lockKey: 'audit-report-detail-install' });
}
