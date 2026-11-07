import { identifier, type PostgresDatabase } from '../database';
import { applySchemaMigration } from '../database-migrations';
import { migrateAuditReplayPackages } from './replay-store';
import { migrateAuditRiskSignals } from './risk-store';

export const AUDIT_RECONCILE_MAX_BYTES = 1024 * 1024;
const maxQueue = 64;

export async function installAuditReconcileReport(db: PostgresDatabase, readerRole: string) {
  if (!/^[a-z_][a-z_0-9]{0,62}$/.test(readerRole)) throw new Error('Invalid audit report reader');
  await migrateAuditReplayPackages(db);
  await migrateAuditRiskSignals(db);
  const schema = identifier(db.schema), reader = identifier(readerRole);
  const requests = schema + '.audit_reconcile_requests';
  const read = schema + '.audit_report_reconcile';
  const dataset = schema + '.audit_datasets', refs = schema + '.audit_posting_refs';
  const acl = schema + '.audit_report_acl', jobs = schema + '.audit_export_jobs';
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
    `CREATE FUNCTION ${read}(p_job uuid,p_enqueue boolean) RETURNS jsonb
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
            AND j.expires_at>pg_catalog.clock_timestamp()
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
      $audit$`,
    `REVOKE ALL ON TABLE ${requests} FROM PUBLIC,${reader}`,
    `REVOKE ALL ON FUNCTION ${read}(uuid,boolean) FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${read}(uuid,boolean) TO ${reader}`,
  ] });
}
