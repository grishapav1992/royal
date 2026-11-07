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
  const investigationReasons = resultReasons + ",'replay-absent','replay-corrupt','replay-incomplete','replay-unsupported'";
  const exportKinds = "'player','summary','replay'";

  const beginSql = (version: 1 | 2 | 3 | 4 | 5 | 6 | 7) => `CREATE ${version > 1 ? 'OR REPLACE ' : ''}FUNCTION ${begin}(p_dataset uuid,p_kind text,p_filters jsonb) RETURNS uuid
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $audit$
      DECLARE
        v_from bigint;
        v_to bigint;
        v_now timestamptz;
        v_job uuid;
      BEGIN
        IF ${version >= 3 ? "p_kind IS NULL OR p_kind NOT IN ('player','summary','detail','replay','reconcile')"
          : version === 2 ? "p_kind IS NULL OR p_kind NOT IN ('player','summary')" : "p_kind IS DISTINCT FROM 'player'"} OR
           pg_catalog.jsonb_typeof(p_filters) IS DISTINCT FROM 'object' OR
           pg_catalog.pg_column_size(p_filters)>4096 THEN
          RAISE EXCEPTION 'Invalid audit export filters' USING ERRCODE='22023';
        END IF;
${version >= 3 ? `        IF p_kind='replay' THEN
          IF (p_filters - 'replayId')<>'{}'::jsonb OR
             pg_catalog.jsonb_typeof(p_filters->'replayId') IS DISTINCT FROM 'string' OR
             (p_filters->>'replayId') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN
            RAISE EXCEPTION 'Invalid audit replay filter' USING ERRCODE='22023';
          END IF;
${version >= 5 ? `        ELSIF p_kind='reconcile' AND (p_filters ? 'fromMs' OR p_filters ? 'toMs') THEN
          IF (p_filters - ARRAY['source','fromMs','toMs','accountId','refresh'${version >= 7 ? ",'paged','cursor'" : ''}])<>'{}'::jsonb OR
             pg_catalog.jsonb_typeof(p_filters->'source') IS DISTINCT FROM 'string' OR
             (p_filters->>'source') !~ '^[a-z_][a-z_0-9]{0,62}[.][a-z_][a-z_0-9]{0,62}$' OR
             (p_filters ? 'accountId' AND (pg_catalog.jsonb_typeof(p_filters->'accountId') IS DISTINCT FROM 'string' OR
               (p_filters->>'accountId') !~ '^[a-zA-Z0-9._:-]{1,128}$')) OR
             (p_filters ? 'refresh' AND pg_catalog.jsonb_typeof(p_filters->'refresh') IS DISTINCT FROM 'boolean') OR
${version >= 7 ? `             (p_filters ? 'paged' AND p_filters->'paged' IS DISTINCT FROM 'true'::jsonb) OR
             (p_filters ? 'cursor' AND (p_filters->'paged' IS DISTINCT FROM 'true'::jsonb OR p_filters ? 'refresh' OR
               pg_catalog.jsonb_typeof(p_filters->'cursor') IS DISTINCT FROM 'string' OR
               (p_filters->>'cursor') !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$')) OR
` : ''}             pg_catalog.jsonb_typeof(p_filters->'fromMs') IS DISTINCT FROM 'number' OR
             pg_catalog.jsonb_typeof(p_filters->'toMs') IS DISTINCT FROM 'number' OR
             (p_filters->>'fromMs') !~ '^[0-9]{1,16}$' OR (p_filters->>'toMs') !~ '^[0-9]{1,16}$' THEN
            RAISE EXCEPTION 'Invalid audit reconciliation period' USING ERRCODE='22023';
          END IF;
          v_from := (p_filters->>'fromMs')::bigint;
          v_to := (p_filters->>'toMs')::bigint;
          IF v_to>${maximumSafeInteger} OR v_to<=v_from OR v_to-v_from>${maximumPeriodMs} THEN
            RAISE EXCEPTION 'Invalid audit reconciliation period' USING ERRCODE='22023';
          END IF;
` : ''}${version >= 4 ? `        ELSIF p_kind='detail' AND p_filters ? 'lookupKind' THEN
          IF (p_filters - ARRAY['source','lookupKind','lookupId','accountId'])<>'{}'::jsonb OR
             pg_catalog.jsonb_typeof(p_filters->'source') IS DISTINCT FROM 'string' OR
             (p_filters->>'source') !~ '^[a-z_][a-z_0-9]{0,62}[.][a-z_][a-z_0-9]{0,62}$' OR
             pg_catalog.jsonb_typeof(p_filters->'lookupKind') IS DISTINCT FROM 'string' OR
             (p_filters->>'lookupKind') NOT IN ('operation','round','match','ticket') OR
             pg_catalog.jsonb_typeof(p_filters->'lookupId') IS DISTINCT FROM 'string' OR
             (p_filters->>'lookupId') !~ '^[a-zA-Z0-9._:-]{1,128}$' OR
             ((p_filters->>'lookupKind') IN ('match','ticket') AND
               (p_filters->>'lookupId') !~ '^[a-fA-F0-9]{8}(-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$') OR
             (p_filters ? 'accountId' AND (pg_catalog.jsonb_typeof(p_filters->'accountId') IS DISTINCT FROM 'string' OR
               (p_filters->>'accountId') !~ '^[a-zA-Z0-9._:-]{1,128}$')) THEN
            RAISE EXCEPTION 'Invalid audit detail lookup' USING ERRCODE='22023';
          END IF;
` : ''}        ELSIF p_kind IN ('detail','reconcile') THEN
          IF (p_filters - ARRAY['source','postingId','refresh'])<>'{}'::jsonb OR
             (p_filters ? 'refresh' AND (p_kind<>'reconcile' OR
               pg_catalog.jsonb_typeof(p_filters->'refresh') IS DISTINCT FROM 'boolean')) OR
             pg_catalog.jsonb_typeof(p_filters->'source') IS DISTINCT FROM 'string' OR
             (p_filters->>'source') !~ '^[a-z_][a-z_0-9]{0,62}[.][a-z_][a-z_0-9]{0,62}$' OR
             pg_catalog.jsonb_typeof(p_filters->'postingId') IS DISTINCT FROM 'string' OR
             (p_filters->>'postingId') !~ '^[1-9][0-9]{0,18}$' THEN
            RAISE EXCEPTION 'Invalid audit posting filter' USING ERRCODE='22023';
          END IF;
          IF (p_filters->>'postingId')::numeric>9223372036854775807 THEN
            RAISE EXCEPTION 'Invalid audit posting ID' USING ERRCODE='22023';
          END IF;
        ELSE
` : ''}        IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_object_keys(p_filters) AS key(name)
            WHERE name NOT IN ('accountId','fromMs','toMs','category','gameId','modeId','asset','contour')) OR
${version > 1 ? `           ((p_kind='player' OR p_filters ? 'accountId') AND
             (pg_catalog.jsonb_typeof(p_filters->'accountId') IS DISTINCT FROM 'string' OR
              (p_filters->>'accountId') !~ '^[a-zA-Z0-9._:-]{1,128}$')) OR` : `           pg_catalog.jsonb_typeof(p_filters->'accountId') IS DISTINCT FROM 'string' OR
           (p_filters->>'accountId') !~ '^[a-zA-Z0-9._:-]{1,128}$' OR`}
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
${version >= 3 ? '        END IF;\n' : ''}        IF NOT EXISTS (SELECT 1 FROM ${acl} WHERE operator_name=SESSION_USER AND dataset_id=p_dataset) THEN
          RAISE EXCEPTION 'Audit export scope is unavailable' USING ERRCODE='42501';
        END IF;

        v_now := pg_catalog.clock_timestamp();
        UPDATE ${jobs} SET status='expired',finished_at=v_now,reason='lease-expired'
          WHERE ${version >= 6 ? `status='running' AND expires_at<=v_now AND
            (operator_name=SESSION_USER OR (p_kind IN (${exportKinds}) AND kind IN (${exportKinds})))`
            : "operator_name=SESSION_USER AND status='running' AND expires_at<=v_now"};
        INSERT INTO ${jobs}(operator_name,dataset_id,kind,filters,status,started_at,expires_at)
          VALUES(SESSION_USER,p_dataset,p_kind,p_filters,'running',v_now,v_now+interval '${leaseMinutes} minutes')
          ON CONFLICT${version >= 6 ? '' : "(operator_name) WHERE status='running'"} DO NOTHING
          RETURNING id INTO v_job;
        IF v_job IS NULL THEN
          RAISE EXCEPTION 'An audit export is already running' USING ERRCODE='55P03';
        END IF;
        RETURN v_job;
      END
      $audit$`;

  const finishSql = (expanded: boolean) => `CREATE ${expanded ? 'OR REPLACE ' : ''}FUNCTION ${finish}(p_job uuid,p_outcome text,p_row_count bigint,p_byte_count bigint,p_reason text) RETURNS void
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $audit$
      DECLARE
        v_now timestamptz := pg_catalog.clock_timestamp();
      BEGIN
        IF p_outcome IS NULL OR p_outcome NOT IN ('succeeded','failed','cancelled') OR
           p_row_count NOT BETWEEN 0 AND ${maximumSafeInteger} OR
           p_byte_count NOT BETWEEN 0 AND ${maximumSafeInteger} OR
           (p_outcome='succeeded' AND (p_row_count IS NULL OR p_byte_count IS NULL OR p_reason IS NOT NULL)) OR
           (p_outcome='failed' AND (p_reason IS NULL OR p_reason NOT IN (${expanded ? investigationReasons : resultReasons}))) OR
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
      $audit$`;

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
    beginSql(1),
    finishSql(false),
    `REVOKE ALL ON TABLE ${acl},${jobs} FROM PUBLIC,${reader}`,
    `REVOKE ALL ON FUNCTION ${begin}(uuid,text,jsonb),${finish}(uuid,text,bigint,bigint,text) FROM PUBLIC`,
    `GRANT USAGE ON SCHEMA ${schema} TO ${reader}`,
    `GRANT EXECUTE ON FUNCTION ${begin}(uuid,text,jsonb),${finish}(uuid,text,bigint,bigint,text) TO ${reader}`,
  ] });
  await applySchemaMigration(db, { id: 'paid-activity-audit-summary-access-v1', statements: [
    `ALTER TABLE ${jobs} DROP CONSTRAINT audit_export_jobs_kind_check,
      ADD CONSTRAINT audit_export_jobs_kind_check CHECK(kind IN ('player','summary'))`,
    beginSql(2),
  ] });
  await applySchemaMigration(db, { id: 'paid-activity-audit-investigation-access-v1', statements: [
    `ALTER TABLE ${jobs} DROP CONSTRAINT audit_export_jobs_kind_check,
      ADD CONSTRAINT audit_export_jobs_kind_check CHECK(kind IN ('player','summary','detail','replay','reconcile'))`,
    beginSql(3),
    finishSql(true),
  ] });
  await applySchemaMigration(db, { id: 'paid-activity-audit-detail-lookup-access-v1', statements: [beginSql(4)] });
  await applySchemaMigration(db, { id: 'paid-activity-audit-period-reconcile-access-v1', statements: [beginSql(5)] });
  await applySchemaMigration(db, { id: 'paid-activity-audit-export-admission-v1', statements: [
    `UPDATE ${jobs} SET status='expired',finished_at=pg_catalog.clock_timestamp(),reason='lease-expired'
      WHERE status='running' AND kind IN (${exportKinds}) AND expires_at<=pg_catalog.clock_timestamp()`,
    `CREATE UNIQUE INDEX audit_report_one_export ON ${jobs} ((1))
      WHERE status='running' AND kind IN (${exportKinds})`,
    beginSql(6),
  ] });
  await applySchemaMigration(db, { id: 'paid-activity-audit-period-continuation-access-v1', statements: [beginSql(7)] });
}
