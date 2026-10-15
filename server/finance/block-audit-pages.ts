import type { PostgresDatabase } from '../database';

export const AUDIT_PAYLOAD_LIMIT = 8 * 1024 * 1024;

// Read only metadata for the candidate window, then fetch the payloads within its byte budget.
// An oversized first block remains visible with a NULL payload so callers can reject it safely.
export async function readBlockAuditPage(db: PostgresDatabase, after?: number) {
    return db.prepare(`WITH candidates AS MATERIALIZED (
        SELECT height,pg_catalog.octet_length(payload) AS payload_bytes FROM blocks
        ${after === undefined ? '' : 'WHERE height>?'} ORDER BY height LIMIT 128
    ), bounded AS (
        SELECT height,payload_bytes,pg_catalog.sum(payload_bytes) OVER (ORDER BY height) AS total_bytes,
            pg_catalog.row_number() OVER (ORDER BY height) AS ordinal FROM candidates
    ) SELECT b.height,b.hash,b.parent_hash,b.payload_sha256,w.payload_bytes,
        CASE WHEN w.payload_bytes<=${AUDIT_PAYLOAD_LIMIT} THEN b.payload ELSE NULL END AS payload
        FROM bounded w JOIN blocks b ON b.height=w.height
        WHERE w.total_bytes<=${AUDIT_PAYLOAD_LIMIT} OR w.ordinal=1 ORDER BY b.height`)
        .all(...(after === undefined ? [] : [after]));
}
