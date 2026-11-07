import { identifier, type PostgresDatabase } from '../database';
import { applySchemaMigration } from '../database-migrations';
import { migrateAuditDatasets } from './datasets';

const maximumPeriodMs = 31 * 24 * 60 * 60 * 1000;
const maximumSafeInteger = Number.MAX_SAFE_INTEGER;
const leaseMinutes = 5;

export async function installAuditReportAccess(db: PostgresDatabase, readerRole: string): Promise<void> {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(readerRole)) throw new Error('Invalid PostgreSQL report role name');
  const group = await db.prepare(`SELECT 1 FROM pg_catalog.pg_roles r
    WHERE r.rolname=? AND NOT (r.rolcanlogin OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR
      r.rolreplication OR r.rolbypassrls)
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member=r.oid)`).get(readerRole);
  if (!group) throw new Error('Provision an unprivileged NOLOGIN report group before installation');

  await migrateAuditDatasets(db);
  const schema = identifier(db.schema);
  const reader = identifier(readerRole);
  const relation = (name: string) => schema + '.' + identifier(name);
  const acl = relation('audit_report_acl');
  const jobs = relation('audit_export_jobs');
  const begin = relation('audit_report_begin');
  const finish = relation('audit_report_finish');
  const resultReasons = "'time-limit','row-limit','scan-limit','byte-limit','source-unavailable','output-error','internal-error','permission-denied'";

  await applySchemaMigration(db, { id: 'paid-activity-audit-report-access-v1', statements: [
    `CREATE TABLE ${acl} (
      operator_name name NOT NULL, dataset_id uuid NOT NULL, source_namespace text NOT NULL,
      PRIMARY KEY(operator_name,dataset_id,source_namespace),
      FOREIGN KEY(dataset_id,source_namespace) REFERENCES ${relation('audit_dataset_sources')}(dataset_id,source_namespace)
    )`,
    `CREATE TABLE ${jobs} (
      id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
      operator_name name NOT NULL, dataset_id uuid NOT NULL REFERENCES ${relation('audit_datasets')}(id),
      kind text NOT NULL CHECK(kind='player'), filters jsonb NOT NULL,
      status text NOT NULL CHECK(status IN ('running','succeeded','failed','cancelled','expired')),
      started_at timestamptz NOT NULL, expires_at timestamptz NOT NULL CHECK(expires_at>started_at),
      finished_at timestamptz CHECK(finished_at>=started_at),
      row_count bigint CHECK(row_count BETWEEN 0 AND ${maximumSafeInteger}),
      byte_count bigint CHECK(byte_count BETWEEN 0 AND ${maximumSafeInteger}), reason text,
      CHECK((status='running')=(finished_at IS NULL))
    )`,
    `CREATE UNIQUE INDEX audit_report_one_running ON ${jobs}(operator_name) WHERE status='running'`,
    `CREATE FUNCTION ${begin}(p_dataset uuid,p_kind text,p_filters jsonb) RETURNS uuid
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $audit$
      DECLARE
        v_from bigint;
        v_to bigint;
        v_now timestamptz;
        v_job uuid;
      BEGIN
        IF p_kind IS DISTINCT FROM 'player' OR
           pg_catalog.jsonb_typeof(p_filters) IS DISTINCT FROM 'object' OR
           pg_catalog.pg_column_size(p_filters)>4096 THEN
          RAISE EXCEPTION 'Invalid audit export filters' USING ERRCODE='22023';
        END IF;
        IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_object_keys(p_filters) AS key(name)
            WHERE name NOT IN ('accountId','fromMs','toMs','category','gameId','modeId','asset','contour')) OR
           pg_catalog.jsonb_typeof(p_filters->'accountId') IS DISTINCT FROM 'string' OR
           (p_filters->>'accountId') !~ '^[a-zA-Z0-9._:-]{1,128}$' OR
           pg_catalog.jsonb_typeof(p_filters->'fromMs') IS DISTINCT FROM 'number' OR
           pg_catalog.jsonb_typeof(p_filters->'toMs') IS DISTINCT FROM 'number' OR
           (p_filters->>'fromMs') !~ '^[0-9]{1,16}$' OR (p_filters->>'toMs') !~ '^[0-9]{1,16}$' THEN
          RAISE EXCEPTION 'Invalid audit export filters' USING ERRCODE='22023';
        END IF;
        v_from := (p_filters->>'fromMs')::bigint;
        v_to := (p_filters->>'toMs')::bigint;
        IF v_to>${maximumSafeInteger} OR v_to<=v_from OR v_to-v_from>${maximumPeriodMs} OR
           (p_filters ? 'category' AND COALESCE(p_filters->>'category','') NOT IN ('casino','pvp','totalizator')) OR
           (p_filters ? 'contour' AND COALESCE(p_filters->>'contour','') NOT IN ('virtual','test','real')) OR
           (p_filters ? 'gameId' AND (pg_catalog.jsonb_typeof(p_filters->'gameId') IS DISTINCT FROM 'string' OR
             (p_filters->>'gameId') !~ '^[a-zA-Z0-9._:-]{1,128}$')) OR
           (p_filters ? 'modeId' AND (pg_catalog.jsonb_typeof(p_filters->'modeId') IS DISTINCT FROM 'string' OR
             (p_filters->>'modeId') !~ '^[a-zA-Z0-9._:-]{1,128}$')) OR
           (p_filters ? 'asset' AND (pg_catalog.jsonb_typeof(p_filters->'asset') IS DISTINCT FROM 'string' OR
             (p_filters->>'asset') !~ '^[A-Z][A-Z0-9_]{0,31}$')) THEN
          RAISE EXCEPTION 'Invalid audit export filters' USING ERRCODE='22023';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM ${acl} WHERE operator_name=SESSION_USER AND dataset_id=p_dataset) THEN
          RAISE EXCEPTION 'Audit export scope is unavailable' USING ERRCODE='42501';
        END IF;

        v_now := pg_catalog.clock_timestamp();
        UPDATE ${jobs} SET status='expired',finished_at=v_now,reason='lease-expired'
          WHERE operator_name=SESSION_USER AND status='running' AND expires_at<=v_now;
        INSERT INTO ${jobs}(operator_name,dataset_id,kind,filters,status,started_at,expires_at)
          VALUES(SESSION_USER,p_dataset,p_kind,p_filters,'running',v_now,v_now+interval '${leaseMinutes} minutes')
          ON CONFLICT(operator_name) WHERE status='running' DO NOTHING
          RETURNING id INTO v_job;
        IF v_job IS NULL THEN
          RAISE EXCEPTION 'An audit export is already running' USING ERRCODE='55P03';
        END IF;
        RETURN v_job;
      END
      $audit$`,
    `CREATE FUNCTION ${finish}(p_job uuid,p_outcome text,p_row_count bigint,p_byte_count bigint,p_reason text) RETURNS void
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $audit$
      DECLARE
        v_now timestamptz := pg_catalog.clock_timestamp();
      BEGIN
        IF p_outcome IS NULL OR p_outcome NOT IN ('succeeded','failed','cancelled') OR
           p_row_count NOT BETWEEN 0 AND ${maximumSafeInteger} OR
           p_byte_count NOT BETWEEN 0 AND ${maximumSafeInteger} OR
           (p_outcome='succeeded' AND (p_row_count IS NULL OR p_byte_count IS NULL OR p_reason IS NOT NULL)) OR
           (p_outcome='failed' AND (p_reason IS NULL OR p_reason NOT IN (${resultReasons}))) OR
           (p_outcome='cancelled' AND p_reason IS DISTINCT FROM 'cancelled') THEN
          RAISE EXCEPTION 'Invalid audit export outcome' USING ERRCODE='22023';
        END IF;
        UPDATE ${jobs} SET status=p_outcome,finished_at=GREATEST(started_at,v_now),
          row_count=p_row_count,byte_count=p_byte_count,reason=p_reason
          WHERE id=p_job AND operator_name=SESSION_USER AND status='running' AND expires_at>v_now;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Audit export job is unavailable' USING ERRCODE='42501';
        END IF;
      END
      $audit$`,
    `REVOKE ALL ON TABLE ${acl},${jobs} FROM PUBLIC,${reader}`,
    `REVOKE ALL ON FUNCTION ${begin}(uuid,text,jsonb),${finish}(uuid,text,bigint,bigint,text) FROM PUBLIC`,
    `GRANT USAGE ON SCHEMA ${schema} TO ${reader}`,
    `GRANT EXECUTE ON FUNCTION ${begin}(uuid,text,jsonb),${finish}(uuid,text,bigint,bigint,text) TO ${reader}`,
  ] });
}
