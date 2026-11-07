import { CLUB_FINE_SOURCE } from '../../src/shared/security';
import type { PostgresDatabase } from '../database';
import { AUDIT_SCHEMA_VERSION, isAuditRecord, type AuditPosting, type AuditScope, type AuditSourceRef } from './contract';
import { resolveCasinoPosting, type CasinoPostingResolution } from './casino';
import { isPaidCasinoOpening } from './mode-registry';
import { resolvePvpPosting, type PvpPostingResolution } from './pvp';
import { resolveTotePosting, type TotePostingResolution } from './tote';
import { resolvePaymentPosting, type PaymentPostingResolution } from './payments';

type Evidence = CasinoPostingResolution | PvpPostingResolution | TotePostingResolution | PaymentPostingResolution;
type Found = {
  status: 'found';
  posting: AuditPosting;
  evidence: Evidence | null;
  openAtStart: boolean | null;
};
type Missing = { status: 'not-captured' | 'source-unavailable' | 'unsupported' };
type PostingResult = Found | Missing;
type OpeningKey = { namespace: string; ids: string[] };
type PostingFields = Omit<AuditPosting, 'schemaVersion' | 'scope' | 'type'>;
type SourceResult = { fields: PostingFields; evidence: Evidence | null } | Missing;

function unavailable(error: unknown) {
  const code = (error as { code?: string } | null)?.code;
  return typeof code === 'string' &&
    (code.startsWith('08') || ['42P01', '3F000', '42501', 'ECONNREFUSED', 'ECONNRESET'].includes(code));
}

function openingKey(evidence: Evidence | null): OpeningKey | null {
  if (!evidence) return null;
  if ('posting' in evidence) {
    return evidence.operation ? { namespace: evidence.operation.namespace, ids: [evidence.operation.rowId] } : null;
  }
  if ('openingObligationKey' in evidence) {
    const key = evidence.openingObligationKey;
    return { namespace: key.sourceNamespace, ids: [key.entityId] };
  }
  if ('tickets' in evidence) {
    return { namespace: evidence.source.namespace.replace(/\.demo_ledger$/, '.flag_tote_tickets'),
      ids: evidence.tickets.map(ticket => ticket.ticketId) };
  }
  const source = evidence.entity.source;
  if (!source.namespace.endsWith('.demo_casino_sessions')) return null;
  const [, id] = JSON.parse(source.rowId) as [string, string];
  return { namespace: source.namespace, ids: [id] };
}

/** Only refs inside a selected dataset can reach the source reader. */
export class AuditPostingReader {
  constructor(private readonly audit: PostgresDatabase, private readonly game: PostgresDatabase,
    private readonly payments?: PostgresDatabase) {}

  async read(datasetId: string, source: AuditSourceRef): Promise<PostingResult> {
    if (!/^[1-9][0-9]{0,18}$/.test(source.rowId) || BigInt(source.rowId) > 9223372036854775807n) return { status: 'not-captured' };
    return this.audit.transaction(async () => {
      const captured = await this.audit.prepare(`SELECT d.environment,r.account_id,r.operation_id,r.occurred_at_ms
        FROM audit_posting_refs r JOIN audit_datasets d ON d.id=r.dataset_id
        WHERE r.dataset_id=? AND r.source_namespace=? AND r.source_row_id=?`).get(datasetId, source.namespace, source.rowId);
      if (!captured) return { status: 'not-captured' };
      const scope: AuditScope = { datasetId, environment: captured.environment };
      const match = [this.game, this.payments].find(db => db && source.namespace.startsWith(db.schema + '.'));
      if (!match) return { status: 'source-unavailable' };
      const table = source.namespace.slice(match.schema.length + 1);
      if (table !== 'demo_ledger' && table !== 'capro_pending_ledger' && table !== 'crypto_ledger') {
        return { status: 'unsupported' };
      }
      const readSource = async (): Promise<SourceResult> => {
        const payment = await resolvePaymentPosting(match, { table, rowId: source.rowId });
        if (payment) return { fields: payment.posting, evidence: payment };
        return match.transaction<SourceResult>(async () => {
          if (table !== 'demo_ledger') {
            const row = await match.prepare(`SELECT id::text FROM ${table} WHERE id=?`).get(source.rowId);
            return row ? { status: 'unsupported' } as const : { status: 'source-unavailable' } as const;
          }
          const row = await match.prepare(`SELECT account_id,operation_id,source,entry_type,created_at,
            amount_units::text,balance_units::text FROM demo_ledger WHERE id=?`).get(source.rowId);
          if (!row) return { status: 'source-unavailable' } as const;
          const entry = { rowId: source.rowId, accountId: String(row.account_id), operationId: String(row.operation_id),
            gameId: String(row.source) };
          if (entry.gameId === CLUB_FINE_SOURCE) return { status: 'unsupported' } as const;
          const evidence = entry.gameId.startsWith('pvp:')
            ? await resolvePvpPosting(match, { ...entry, gameId: entry.gameId.slice(4) })
            : entry.gameId === 'flag-tote' ? await resolveTotePosting(match, entry) : await resolveCasinoPosting(match, entry);
          let movement: AuditPosting['movement'];
          switch (row.entry_type) {
            case 'bet':
              movement = evidence?.entity.category === 'pvp' ? 'reserve' : 'stake';
              if (evidence && 'operation' in evidence && evidence.operation && evidence.entity.category === 'casino' &&
                evidence.entity.source.namespace.endsWith('.demo_casino_sessions') &&
                (evidence.operation.rowId !== evidence.entity.source.rowId ||
                  isPaidCasinoOpening(entry.gameId, evidence.entity.modeId, evidence.entity.rulesVersion))) {
                movement = 'paid-option';
              }
              break;
            case 'win': movement = 'payout'; break;
            case 'refund': movement = 'refund'; break;
            case 'rollback': movement = 'reversal'; break;
            default: return { status: 'unsupported' } as const;
          }
          const fields: PostingFields = {
            source, sequence: source.rowId, accountId: entry.accountId, operationId: entry.operationId,
            occurredAtMs: Number(row.created_at), entity: evidence?.entity ?? null, coverage: evidence?.coverage ?? 'partial',
            movement, asset: { contour: 'virtual', code: 'VIRTUAL_USD', scale: 2 },
            availableDeltaUnits: String(row.amount_units), availableAfterUnits: String(row.balance_units),
            reservedDeltaUnits: null, reservedAfterUnits: null,
          };
          return { fields, evidence } as const;
        }, { readOnly: true });
      };
      const result = await readSource().catch((error: unknown): Missing => {
        if (unavailable(error)) return { status: 'source-unavailable' };
        throw error;
      });
      if ('status' in result) return { status: result.status };
      const posting = { schemaVersion: AUDIT_SCHEMA_VERSION, scope, type: 'posting' as const, ...result.fields };
      if (!isAuditRecord(posting) || posting.accountId !== captured.account_id || posting.operationId !== captured.operation_id ||
        posting.occurredAtMs !== Number(captured.occurred_at_ms)) return { status: 'unsupported' };
      const opening = openingKey(result.evidence);
      const openAtStart = opening ? !!await this.audit.prepare(`SELECT 1 FROM audit_opening_obligations
        WHERE dataset_id=? AND account_id=? AND source_namespace=? AND entity_id=ANY(?::text[]) LIMIT 1`)
        .get(datasetId, posting.accountId, opening.namespace, opening.ids) : null;
      return { status: 'found', posting, evidence: result.evidence, openAtStart };
    }, { readOnly: true });
  }
}
