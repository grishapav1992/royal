import type { PostgresDatabase } from '../database';
import { AUDIT_SCHEMA_VERSION, isAuditRecord, type AuditReplay, type AuditScope } from './contract';
import { isReplayId, isReplayScope, type ReplayDefinition } from './replay-package';

async function recordCaptureGap(audit: PostgresDatabase, scope: AuditScope, gameSchema: string,
  matchId: string, definition: ReplayDefinition) {
  if (!isReplayScope(scope) || !isReplayId(matchId) || definition.category !== 'pvp' ||
      !/^[a-z_][a-z0-9_]{0,62}$/.test(gameSchema)) return;
  const replayId = 'capture-gap:' + matchId;
  const occurredAtMs = Date.now();
  const table = definition.gameId === 'mortal-kombat' ? 'combat_matches' : 'pvp_matches';
  const marker: AuditReplay = {
    schemaVersion: AUDIT_SCHEMA_VERSION, type: 'replay', scope, occurredAtMs, replayId,
    entity: { category: 'pvp', kind: 'match', gameId: definition.gameId, modeId: definition.modeId,
      rulesVersion: null, ticketId: null, source: { namespace: gameSchema + '.' + table, rowId: matchId } },
    profile: definition.replayProfile, engineVersion: definition.engineVersion, formatVersion: definition.formatVersion,
    coverage: 'not-recorded', firstSequence: null, lastSequence: null, terminalEventId: null, sha256: null,
  };
  if (!isAuditRecord(marker)) throw new Error('Invalid replay capture marker');
  await audit.prepare(`INSERT INTO audit_evidence(dataset_id,kind,evidence_id,account_id,occurred_at_ms,payload)
    SELECT d.id,'replay',?,NULL,?,?::jsonb FROM audit_datasets d
    WHERE d.id=? AND d.environment=? AND d.sealed_at_ms IS NULL AND d.started_at_ms<=?
      AND (EXISTS (SELECT 1 FROM audit_posting_refs r WHERE r.dataset_id=d.id AND r.source_namespace=?
        AND r.operation_id IN (?,?))
        OR EXISTS (SELECT 1 FROM audit_opening_obligations o WHERE o.dataset_id=d.id AND o.source_namespace=?
          AND o.entity_id=? AND o.state='held'))
    FOR SHARE OF d ON CONFLICT (dataset_id,kind,evidence_id) DO NOTHING`)
    .run(replayId, occurredAtMs, JSON.stringify(marker), scope.datasetId, scope.environment, occurredAtMs,
      gameSchema + '.demo_ledger', 'pvp:' + matchId + ':hold', 'pvp:' + matchId + ':final',
      gameSchema + '.virtual_pvp_holds', matchId);
}

/** A bounded background queue. Overflow retains only the marker identity. */
export function replayCaptureWriter<Recording extends { matchId: string }>(audit: PostgresDatabase,
  scope: AuditScope, gameSchema: string, options: {
    event: string;
    capacity: number;
    definition: (recording: Recording) => ReplayDefinition | undefined;
    persist: (recording: Recording) => Promise<string>;
  }) {
  let tail = Promise.resolve(), pending = 0, pendingGaps = 0, accepting = true;
  const warn = (reason: string) => console.warn(JSON.stringify({ event: options.event, datasetId: scope.datasetId, reason }));
  async function mark(matchId: string, definition: ReplayDefinition | undefined) {
    if (definition) {
      try { await recordCaptureGap(audit, scope, gameSchema, matchId, definition); }
      catch { warn('marker-write-failed'); }
    }
  }
  return {
    record(recording: Recording) {
      if (!accepting) return;
      if (pending >= options.capacity) {
        warn('queue-unavailable');
        if (pendingGaps >= 128) return;
        const { matchId } = recording, definition = options.definition(recording);
        pendingGaps++;
        tail = tail.then(() => mark(matchId, definition)).finally(() => { pendingGaps--; });
        return;
      }
      pending++;
      tail = tail.then(async () => {
        let result: string;
        try { result = await options.persist(recording); }
        catch { result = 'write-failed'; }
        if (result === 'recorded' || result === 'replayed' || result === 'not-captured' || result === 'dataset-unavailable') return;
        warn(result);
        await mark(recording.matchId, options.definition(recording));
      }).finally(() => { pending--; });
    },
    async stop() {
      accepting = false;
      await tail;
    },
  };
}
