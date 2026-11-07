import { identifier, type PostgresDatabase } from '../database';
import { applySchemaMigration } from '../database-migrations';
import { migrateAuditReplayPackages } from './replay-store';
import { migrateAuditRiskSignals } from './risk-store';

export const AUDIT_RECONCILE_MAX_BYTES = 1024 * 1024;
export const AUDIT_RECONCILE_PAGE_SIZE = 16;
export const AUDIT_RECONCILE_SCAN_MAX_POSTINGS = 4096;
const maxManifestBytes = 128 * 1024;
const maxQueue = 64;

export async function installAuditReconcileReport(db: PostgresDatabase, readerRole: string) {
  if (!/^[a-z_][a-z_0-9]{0,62}$/.test(readerRole)) throw new Error('Invalid audit report reader');
  await migrateAuditReplayPackages(db);
  await migrateAuditRiskSignals(db);
  const schema = identifier(db.schema), reader = identifier(readerRole);
  const requests = schema + '.audit_reconcile_requests';
  const read = schema + '.audit_report_reconcile';
  const readPeriod = schema + '.audit_report_reconcile_period';
  const readPage = schema + '.audit_report_reconcile_page';
  const dataset = schema + '.audit_datasets', refs = schema + '.audit_posting_refs';
  const acl = schema + '.audit_report_acl', jobs = schema + '.audit_export_jobs';
  const readPostingSql = (periodEnabled: boolean) => `CREATE ${periodEnabled ? 'OR REPLACE ' : ''}FUNCTION ${read}(p_job uuid,p_enqueue boolean) RETURNS jsonb
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $audit$
      DECLARE
        v_dataset uuid; v_environment text; v_filters jsonb; v_source text; v_id bigint;
        v_request ${requests}%ROWTYPE; v_status text;
      BEGIN
        IF p_enqueue IS NULL THEN RAISE EXCEPTION 'Invalid reconciliation request' USING ERRCODE='22023'; END IF;
        IF pg_catalog.current_setting('transaction_isolation')<>'read committed' OR
            pg_catalog.pg_current_xact_id_if_assigned() IS NOT NULL THEN
          RAISE EXCEPTION 'Audit reconciliation requires a committed job' USING ERRCODE='42501';
        END IF;
        SELECT j.dataset_id,d.environment,j.filters INTO v_dataset,v_environment,v_filters
          FROM ${jobs} j JOIN ${dataset} d ON d.id=j.dataset_id
          WHERE j.id=p_job AND j.kind='reconcile' AND j.operator_name=SESSION_USER AND j.status='running'
            AND j.expires_at>pg_catalog.clock_timestamp()${periodEnabled ? " AND j.filters ? 'postingId'" : ''}
            AND EXISTS (SELECT 1 FROM ${acl} a WHERE a.operator_name=SESSION_USER AND a.dataset_id=j.dataset_id
              AND a.source_namespace=j.filters->>'source');
        IF NOT FOUND THEN RAISE EXCEPTION 'Audit reconciliation is unavailable' USING ERRCODE='42501'; END IF;
        v_source := v_filters->>'source'; v_id := (v_filters->>'postingId')::bigint;
        IF NOT EXISTS (SELECT 1 FROM ${refs} r WHERE r.dataset_id=v_dataset AND r.source_namespace=v_source
            AND r.source_row_id=v_id) THEN
          v_status := 'not-captured';
        ELSE
          SELECT * INTO v_request FROM ${requests}
            WHERE dataset_id=v_dataset AND source_namespace=v_source AND posting_id=v_id;
          IF v_request.status='ready' AND EXISTS (
            SELECT 1 FROM pg_catalog.unnest(v_request.required_sources) n(source_namespace)
            WHERE NOT EXISTS (SELECT 1 FROM ${acl} a WHERE a.dataset_id=v_dataset
              AND a.operator_name=SESSION_USER AND a.source_namespace=n.source_namespace)
          ) THEN
            v_status := 'source-unavailable';
          ELSIF p_enqueue AND (v_request.status IS NULL OR
              (COALESCE((v_filters->>'refresh')::boolean,false) AND v_request.status IN ('ready','failed'))) THEN
            IF NOT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('${db.schema}:audit-reconcile-queue',0)) THEN
              v_status := 'queue-busy';
            ELSE
              IF (SELECT count(*) FROM ${requests} WHERE status IN ('queued','running'))>=${maxQueue} THEN
                v_status := 'queue-full';
              ELSE
                INSERT INTO ${requests} AS existing(dataset_id,source_namespace,posting_id,status,requested_at)
                  VALUES(v_dataset,v_source,v_id,'queued',pg_catalog.clock_timestamp())
                  ON CONFLICT(dataset_id,source_namespace,posting_id) DO UPDATE
                  SET status='queued',requested_at=EXCLUDED.requested_at,finished_at=NULL,result=NULL,required_sources='{}'
                  WHERE COALESCE((v_filters->>'refresh')::boolean,false) AND existing.status IN ('ready','failed')
                    AND NOT EXISTS (SELECT 1 FROM pg_catalog.unnest(existing.required_sources) n(source_namespace)
                      WHERE NOT EXISTS (SELECT 1 FROM ${acl} a WHERE a.dataset_id=v_dataset
                        AND a.operator_name=SESSION_USER AND a.source_namespace=n.source_namespace));
              END IF;
            END IF;
          END IF;
          IF v_status IS NULL THEN
            SELECT * INTO v_request FROM ${requests}
              WHERE dataset_id=v_dataset AND source_namespace=v_source AND posting_id=v_id;
            v_status := COALESCE(v_request.status,'not-requested');
          END IF;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM ${jobs} j JOIN ${acl} a ON a.dataset_id=j.dataset_id
            AND a.operator_name=SESSION_USER AND a.source_namespace=v_source
          WHERE j.id=p_job AND j.kind='reconcile' AND j.operator_name=SESSION_USER AND j.status='running'
            AND j.expires_at>pg_catalog.clock_timestamp()) THEN
          RAISE EXCEPTION 'Audit reconciliation is unavailable' USING ERRCODE='42501';
        END IF;
        RETURN pg_catalog.jsonb_build_object('schemaVersion',1,'datasetId',v_dataset,'environment',v_environment,
          'anchor',pg_catalog.jsonb_build_object('namespace',v_source,'rowId',v_id::text),
          'requestedAt',v_request.requested_at,'finishedAt',v_request.finished_at,
          'requestStatus',CASE WHEN v_status='ready' AND EXISTS (
            SELECT 1 FROM pg_catalog.unnest(v_request.required_sources) n(source_namespace)
            WHERE NOT EXISTS (SELECT 1 FROM ${acl} a WHERE a.dataset_id=v_dataset
              AND a.operator_name=SESSION_USER AND a.source_namespace=n.source_namespace)
          ) THEN 'source-unavailable' ELSE v_status END,
          'report',CASE WHEN v_status='ready' AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.unnest(v_request.required_sources) n(source_namespace)
            WHERE NOT EXISTS (SELECT 1 FROM ${acl} a WHERE a.dataset_id=v_dataset
              AND a.operator_name=SESSION_USER AND a.source_namespace=n.source_namespace)
          ) THEN v_request.result ELSE NULL END);
      END
      $audit$`;
  await applySchemaMigration(db, { id: 'paid-activity-audit-reconcile-report-v1', indexes: [
    { name: 'audit_replay_packages_entity', table: 'audit_replay_packages', columns: ['dataset_id', "(manifest->>'entityId')", 'replay_id'] },
    { name: 'audit_risk_signals_observed', table: 'audit_risk_signals', columns: ['dataset_id', 'as_of_ms DESC', 'signal_key'], where: "status='observed'" },
  ], statements: [
    `CREATE TABLE ${requests} (
      dataset_id uuid NOT NULL, source_namespace text NOT NULL, posting_id bigint NOT NULL,
      status text NOT NULL CHECK(status IN ('queued','running','ready','failed')),
      requested_at timestamptz NOT NULL, finished_at timestamptz, claim uuid, lease_until timestamptz,
      result jsonb CHECK (pg_catalog.octet_length(result::text)<=${AUDIT_RECONCILE_MAX_BYTES * 2}),
      required_sources text[] NOT NULL DEFAULT '{}',
      PRIMARY KEY(dataset_id,source_namespace,posting_id),
      FOREIGN KEY(dataset_id,source_namespace,posting_id) REFERENCES ${refs}(dataset_id,source_namespace,source_row_id),
      CHECK((status='running')=(claim IS NOT NULL AND lease_until IS NOT NULL)),
      CHECK((status IN ('ready','failed'))=(finished_at IS NOT NULL)),
      CHECK((status='ready')=(result IS NOT NULL)),
      CHECK(status<>'ready' OR pg_catalog.array_position(required_sources,source_namespace) IS NOT NULL)
    )`,
    `CREATE INDEX audit_reconcile_next ON ${requests}(requested_at,dataset_id,source_namespace,posting_id)
      WHERE status IN ('queued','running')`,
    readPostingSql(false),
    `REVOKE ALL ON TABLE ${requests} FROM PUBLIC,${reader}`,
    `REVOKE ALL ON FUNCTION ${read}(uuid,boolean) FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${read}(uuid,boolean) TO ${reader}`,
  ] });
  const readPeriodSql = (pagingInstalled: boolean) => `CREATE ${pagingInstalled ? 'OR REPLACE ' : ''}FUNCTION ${readPeriod}(p_job uuid,p_enqueue boolean) RETURNS jsonb
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $audit$
      DECLARE
        v_dataset uuid; v_environment text; v_filters jsonb; v_source text;
        v_from bigint; v_to bigint; v_account text; v_request ${requests}%ROWTYPE; v_status text;
        v_report jsonb;
      BEGIN
        IF p_enqueue IS NULL THEN RAISE EXCEPTION 'Invalid reconciliation request' USING ERRCODE='22023'; END IF;
        IF pg_catalog.current_setting('transaction_isolation')<>'read committed' OR
            pg_catalog.pg_current_xact_id_if_assigned() IS NOT NULL THEN
          RAISE EXCEPTION 'Audit reconciliation requires a committed job' USING ERRCODE='42501';
        END IF;
        SELECT j.dataset_id,d.environment,j.filters INTO v_dataset,v_environment,v_filters
          FROM ${jobs} j JOIN ${dataset} d ON d.id=j.dataset_id
          JOIN ${acl} a ON a.dataset_id=j.dataset_id AND a.operator_name=SESSION_USER
            AND a.source_namespace=j.filters->>'source'
          WHERE j.id=p_job AND j.kind='reconcile' AND j.operator_name=SESSION_USER AND j.status='running'
            AND j.expires_at>pg_catalog.clock_timestamp() AND j.filters ? 'fromMs'${pagingInstalled ? " AND NOT (j.filters ? 'paged')" : ''};
        IF NOT FOUND THEN RAISE EXCEPTION 'Audit reconciliation is unavailable' USING ERRCODE='42501'; END IF;
        v_source := v_filters->>'source'; v_from := (v_filters->>'fromMs')::bigint; v_to := (v_filters->>'toMs')::bigint;
        v_account := COALESCE(v_filters->>'accountId','');
        SELECT * INTO v_request FROM ${requests} WHERE dataset_id=v_dataset AND source_namespace=v_source AND posting_id IS NULL${pagingInstalled ? ' AND scan_owner IS NULL' : ''}
          AND from_ms=v_from AND to_ms=v_to AND account_id=v_account;
        IF p_enqueue AND (v_request.status IS NULL OR
            (COALESCE((v_filters->>'refresh')::boolean,false) AND v_request.status IN ('ready','failed')))
            AND NOT EXISTS (SELECT 1 FROM pg_catalog.unnest(v_request.required_sources) n(source_namespace)
              WHERE NOT EXISTS (SELECT 1 FROM ${acl} a WHERE a.dataset_id=v_dataset
                AND a.operator_name=SESSION_USER AND a.source_namespace=n.source_namespace)) THEN
            IF NOT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('${db.schema}:audit-reconcile-queue',0)) THEN
              v_status := 'queue-busy';
            ELSIF (SELECT count(*) FROM ${requests} WHERE status IN ('queued','running'))>=${maxQueue} THEN
              v_status := 'queue-full';
            ELSE
              INSERT INTO ${requests} AS existing(dataset_id,source_namespace,from_ms,to_ms,account_id,status,requested_at)
                VALUES(v_dataset,v_source,v_from,v_to,v_account,'queued',pg_catalog.clock_timestamp())
                ON CONFLICT(dataset_id,source_namespace,from_ms,to_ms,account_id) WHERE posting_id IS NULL${pagingInstalled ? ' AND scan_owner IS NULL' : ''} DO UPDATE
                SET status='queued',requested_at=EXCLUDED.requested_at,finished_at=NULL,result=NULL,required_sources='{}'
                WHERE COALESCE((v_filters->>'refresh')::boolean,false) AND existing.status IN ('ready','failed')
                  AND NOT EXISTS (SELECT 1 FROM pg_catalog.unnest(existing.required_sources) n(source_namespace)
                    WHERE NOT EXISTS (SELECT 1 FROM ${acl} a WHERE a.dataset_id=v_dataset
                      AND a.operator_name=SESSION_USER AND a.source_namespace=n.source_namespace));
            END IF;
        END IF;
        SELECT * INTO v_request FROM ${requests} WHERE dataset_id=v_dataset AND source_namespace=v_source AND posting_id IS NULL${pagingInstalled ? ' AND scan_owner IS NULL' : ''}
          AND from_ms=v_from AND to_ms=v_to AND account_id=v_account;
        SELECT CASE WHEN v_request.status='ready' AND EXISTS (
              SELECT 1 FROM pg_catalog.unnest(v_request.required_sources) n(source_namespace)
              WHERE NOT EXISTS (SELECT 1 FROM ${acl} a WHERE a.dataset_id=v_dataset
                AND a.operator_name=SESSION_USER AND a.source_namespace=n.source_namespace)
            ) THEN 'source-unavailable' ELSE COALESCE(v_status,v_request.status,'not-requested') END
          INTO v_status FROM ${jobs} j JOIN ${acl} a ON a.dataset_id=j.dataset_id
            AND a.operator_name=SESSION_USER AND a.source_namespace=v_source
          WHERE j.id=p_job AND j.kind='reconcile' AND j.operator_name=SESSION_USER AND j.status='running'
            AND j.expires_at>pg_catalog.clock_timestamp()${pagingInstalled ? " AND NOT (j.filters ? 'paged')" : ''};
        IF NOT FOUND THEN RAISE EXCEPTION 'Audit reconciliation is unavailable' USING ERRCODE='42501'; END IF;
        IF v_status='ready' THEN v_report := v_request.result; END IF;
        RETURN pg_catalog.jsonb_build_object('schemaVersion',1,'datasetId',v_dataset,'environment',v_environment,
          'selection',pg_catalog.jsonb_build_object('source',v_source,'fromMs',v_from,'toMs',v_to,'accountId',NULLIF(v_account,'')),
          'requestedAt',v_request.requested_at,'finishedAt',v_request.finished_at,'requestStatus',v_status,'report',v_report);
      END
      $audit$`;
  await applySchemaMigration(db, { id: 'paid-activity-audit-period-reconcile-report-v1', indexes: [
    { name: 'audit_posting_refs_period', table: 'audit_posting_refs',
      columns: ['dataset_id', 'source_namespace', 'occurred_at_ms', 'source_row_id'] },
    { name: 'audit_posting_refs_period_account', table: 'audit_posting_refs',
      columns: ['dataset_id', 'source_namespace', 'account_id', 'occurred_at_ms', 'source_row_id'] },
  ], statements: [
    `ALTER TABLE ${requests}
      DROP CONSTRAINT audit_reconcile_requests_pkey,
      ALTER COLUMN posting_id DROP NOT NULL,
      ADD COLUMN request_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      ADD COLUMN from_ms bigint, ADD COLUMN to_ms bigint, ADD COLUMN account_id text,
      ADD UNIQUE(dataset_id,source_namespace,posting_id),
      ADD FOREIGN KEY(dataset_id,source_namespace) REFERENCES ${schema}.audit_dataset_sources(dataset_id,source_namespace),
      ADD CHECK ((posting_id IS NOT NULL AND from_ms IS NULL AND to_ms IS NULL AND account_id IS NULL) OR
        (posting_id IS NULL AND from_ms IS NOT NULL AND to_ms IS NOT NULL AND account_id IS NOT NULL AND
          from_ms>=0 AND to_ms<=9007199254740991 AND to_ms>from_ms AND to_ms-from_ms<=2678400000 AND
          account_id ~ '^[a-zA-Z0-9._:-]{0,128}$'))`,
    `CREATE UNIQUE INDEX audit_reconcile_period_key ON ${requests}(dataset_id,source_namespace,from_ms,to_ms,account_id)
      WHERE posting_id IS NULL`,
    readPostingSql(true),
    readPeriodSql(false),
    `REVOKE ALL ON FUNCTION ${readPeriod}(uuid,boolean) FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${readPeriod}(uuid,boolean) TO ${reader}`,
  ] });
  const lookupPage = `SELECT * INTO v_request FROM ${requests}
    WHERE dataset_id=v_dataset AND source_namespace=v_source AND posting_id IS NULL
      AND from_ms=v_from AND to_ms=v_to AND account_id=v_account AND scan_owner=SESSION_USER`;
  const auxiliarySourceMissing = `EXISTS (SELECT 1 FROM pg_catalog.unnest(v_request.required_sources) n(source_namespace)
    WHERE NOT EXISTS (SELECT 1 FROM ${acl} a WHERE a.dataset_id=v_dataset
      AND a.operator_name=SESSION_USER AND a.source_namespace=n.source_namespace))`;
  const chooseAction = `CASE
    WHEN v_cursor IS NULL AND v_request.request_id IS NULL THEN 'start'
    WHEN v_cursor IS NULL AND v_refresh AND v_request.status IN ('ready','failed') THEN 'refresh'
    WHEN v_cursor IS NOT NULL AND v_request.status='ready' AND v_request.scan_next_cursor=v_cursor THEN 'advance'
    ELSE NULL END`;
  await applySchemaMigration(db, { id: 'paid-activity-audit-period-continuation-v1', statements: [
    `ALTER TABLE ${requests}
      ADD COLUMN scan_owner name,
      ADD COLUMN scan_cursor uuid,
      ADD COLUMN scan_next_cursor uuid,
      ADD COLUMN scan_manifest jsonb CHECK (pg_catalog.jsonb_typeof(scan_manifest)='object'
        AND pg_catalog.octet_length(scan_manifest::text)<=${maxManifestBytes}),
      ADD COLUMN scan_offset integer NOT NULL DEFAULT 0,
      ADD CHECK (
        (scan_owner IS NULL AND scan_cursor IS NULL AND scan_next_cursor IS NULL AND scan_manifest IS NULL AND scan_offset=0) OR
        (scan_owner IS NOT NULL AND posting_id IS NULL AND scan_offset>=0 AND scan_offset<${AUDIT_RECONCILE_SCAN_MAX_POSTINGS}
          AND scan_offset % ${AUDIT_RECONCILE_PAGE_SIZE}=0 AND (scan_offset=0)=(scan_cursor IS NULL)
          AND (scan_next_cursor IS NULL OR
            (status='ready' AND scan_manifest IS NOT NULL AND scan_next_cursor IS DISTINCT FROM scan_cursor)))
      )`,
    `DROP INDEX ${schema}.audit_reconcile_period_key`,
    `CREATE UNIQUE INDEX audit_reconcile_period_key ON ${requests}(dataset_id,source_namespace,from_ms,to_ms,account_id)
      WHERE posting_id IS NULL AND scan_owner IS NULL`,
    `CREATE UNIQUE INDEX audit_reconcile_period_page_key ON ${requests}(dataset_id,source_namespace,from_ms,to_ms,account_id,scan_owner)
      WHERE posting_id IS NULL AND scan_owner IS NOT NULL`,
    readPeriodSql(true),
    `CREATE FUNCTION ${readPage}(p_job uuid,p_enqueue boolean) RETURNS jsonb
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $audit$
      DECLARE
        v_dataset uuid; v_environment text; v_filters jsonb; v_source text;
        v_from bigint; v_to bigint; v_account text; v_cursor uuid; v_refresh boolean;
        v_request ${requests}%ROWTYPE; v_action text; v_status text; v_visible boolean; v_changed bigint := 0;
      BEGIN
        IF p_enqueue IS NULL THEN RAISE EXCEPTION 'Invalid reconciliation request' USING ERRCODE='22023'; END IF;
        IF pg_catalog.current_setting('transaction_isolation')<>'read committed' OR
            pg_catalog.pg_current_xact_id_if_assigned() IS NOT NULL THEN
          RAISE EXCEPTION 'Audit reconciliation requires a committed job' USING ERRCODE='42501';
        END IF;
        SELECT j.dataset_id,d.environment,j.filters INTO v_dataset,v_environment,v_filters
          FROM ${jobs} j JOIN ${dataset} d ON d.id=j.dataset_id
          JOIN ${acl} a ON a.dataset_id=j.dataset_id AND a.operator_name=SESSION_USER
            AND a.source_namespace=j.filters->>'source'
          WHERE j.id=p_job AND j.kind='reconcile' AND j.operator_name=SESSION_USER AND j.status='running'
            AND j.expires_at>pg_catalog.clock_timestamp() AND j.filters->'paged'='true'::jsonb;
        IF NOT FOUND THEN RAISE EXCEPTION 'Audit reconciliation is unavailable' USING ERRCODE='42501'; END IF;
        v_source := v_filters->>'source'; v_from := (v_filters->>'fromMs')::bigint; v_to := (v_filters->>'toMs')::bigint;
        v_account := COALESCE(v_filters->>'accountId','');
        v_cursor := (v_filters->>'cursor')::uuid;
        v_refresh := COALESCE((v_filters->>'refresh')::boolean,false);
        ${lookupPage};
        v_action := ${chooseAction};
        IF p_enqueue AND v_action IS NOT NULL AND NOT ${auxiliarySourceMissing} THEN
          IF NOT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('${db.schema}:audit-reconcile-queue',0)) THEN
            v_status := 'queue-busy';
          ELSE
            ${lookupPage} FOR UPDATE;
            v_action := ${chooseAction};
            IF ${auxiliarySourceMissing} THEN
              v_status := 'source-unavailable';
            ELSIF v_action IS NOT NULL AND
                (SELECT count(*) FROM ${requests} WHERE status IN ('queued','running'))>=${maxQueue} THEN
              v_status := 'queue-full';
            ELSIF v_action='start' THEN
              INSERT INTO ${requests}(dataset_id,source_namespace,from_ms,to_ms,account_id,status,requested_at,scan_owner)
                VALUES(v_dataset,v_source,v_from,v_to,v_account,'queued',pg_catalog.clock_timestamp(),SESSION_USER)
                ON CONFLICT(dataset_id,source_namespace,from_ms,to_ms,account_id,scan_owner)
                  WHERE posting_id IS NULL AND scan_owner IS NOT NULL DO NOTHING;
              GET DIAGNOSTICS v_changed = ROW_COUNT;
            ELSIF v_action='refresh' THEN
              UPDATE ${requests} SET status='queued',requested_at=pg_catalog.clock_timestamp(),finished_at=NULL,result=NULL,
                scan_offset=0,scan_cursor=NULL,scan_next_cursor=NULL,scan_manifest=NULL
                WHERE request_id=v_request.request_id;
              GET DIAGNOSTICS v_changed = ROW_COUNT;
            ELSIF v_action='advance' THEN
              IF v_request.result #>> '{page,offset}' IS DISTINCT FROM v_request.scan_offset::text OR
                  v_request.result #>> '{page,processed}' IS DISTINCT FROM '${AUDIT_RECONCILE_PAGE_SIZE}' OR
                  v_request.result #> '{page,hasMore}' IS DISTINCT FROM 'true'::jsonb OR
                  COALESCE(CASE WHEN pg_catalog.jsonb_typeof(v_request.scan_manifest->'rowIds')='array'
                    THEN pg_catalog.jsonb_array_length(v_request.scan_manifest->'rowIds') END,0)
                      <=v_request.scan_offset+${AUDIT_RECONCILE_PAGE_SIZE} THEN
                v_status := 'source-unavailable';
              ELSE
                UPDATE ${requests} SET status='queued',requested_at=pg_catalog.clock_timestamp(),finished_at=NULL,result=NULL,
                  scan_offset=scan_offset+${AUDIT_RECONCILE_PAGE_SIZE},scan_cursor=v_cursor,scan_next_cursor=NULL
                  WHERE request_id=v_request.request_id;
                GET DIAGNOSTICS v_changed = ROW_COUNT;
              END IF;
            END IF;
          END IF;
        END IF;
        ${lookupPage};
        IF NOT EXISTS (SELECT 1 FROM ${jobs} j JOIN ${acl} a ON a.dataset_id=j.dataset_id
            AND a.operator_name=SESSION_USER AND a.source_namespace=v_source
          WHERE j.id=p_job AND j.kind='reconcile' AND j.operator_name=SESSION_USER AND j.status='running'
            AND j.expires_at>pg_catalog.clock_timestamp()) THEN
          RAISE EXCEPTION 'Audit reconciliation is unavailable' USING ERRCODE='42501';
        END IF;
        IF ${auxiliarySourceMissing} THEN
          IF v_changed>0 THEN RAISE EXCEPTION 'Audit reconciliation is unavailable' USING ERRCODE='42501'; END IF;
          v_status := 'source-unavailable';
        ELSIF v_status IS NULL THEN
          v_status := CASE
            WHEN v_cursor IS NULL OR v_cursor=v_request.scan_cursor THEN COALESCE(v_request.status,'not-requested')
            WHEN v_request.status='ready' AND v_cursor=v_request.scan_next_cursor THEN 'not-requested'
            ELSE 'cursor-expired' END;
        END IF;
        v_visible := v_status IN ('queued','running','ready','failed');
        RETURN pg_catalog.jsonb_build_object('schemaVersion',1,'datasetId',v_dataset,'environment',v_environment,
          'selection',pg_catalog.jsonb_build_object('source',v_source,'fromMs',v_from,'toMs',v_to,'accountId',NULLIF(v_account,'')),
          'requestedAt',CASE WHEN v_visible THEN v_request.requested_at END,
          'finishedAt',CASE WHEN v_visible THEN v_request.finished_at END,'requestStatus',v_status,
          'report',CASE WHEN v_status='ready' THEN v_request.result END,
          'cursor',CASE WHEN v_visible THEN v_request.scan_cursor END,
          'nextCursor',CASE WHEN v_status='ready' THEN v_request.scan_next_cursor END);
      END
      $audit$`,
    `REVOKE ALL ON FUNCTION ${readPage}(uuid,boolean) FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${readPage}(uuid,boolean) TO ${reader}`,
  ] });
}
