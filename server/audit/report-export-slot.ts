import { identifier } from '../database';

export const AUDIT_EXPORT_READER_SLOT_CONSTRAINT = 'audit_export_reader_slot';

export function auditExportReaderSlotGuard(schema: string) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schema)) throw new Error('Invalid audit export slot schema');
  return `IF NOT pg_catalog.pg_try_advisory_xact_lock(
          pg_catalog.hashtextextended('royal:audit-export-reader:${schema}',0)) THEN
          RAISE EXCEPTION 'An audit export reader is still active'
            USING ERRCODE='55P03', CONSTRAINT='${AUDIT_EXPORT_READER_SLOT_CONSTRAINT}';
        END IF;`;
}

export function auditExportReaderProjectionGuard(schema: string, job: 'job' | 'p_job', kind: 'player' | 'summary' | 'replay') {
  return `${auditExportReaderSlotGuard(schema)}
        -- The journal can be closed between the initial authorization and slot acquisition.
        IF NOT EXISTS (SELECT 1 FROM ${identifier(schema)}.audit_export_jobs e
          WHERE e.id=${job} AND e.operator_name=SESSION_USER AND e.kind='${kind}' AND e.status='running'
            AND e.expires_at>pg_catalog.clock_timestamp()) THEN
          RAISE EXCEPTION 'Audit report access denied' USING ERRCODE='42501';
        END IF;`;
}
