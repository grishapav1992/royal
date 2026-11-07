import { identifier, type PostgresDatabase } from '../database';
import { reconcileStoredPvpMatch } from './check-pvp';
import type { AuditScope } from './contract';
import { isReplayId, isReplayScope, type ReplayEvent } from './replay-package';
import { buildTsuTurnReplay, type CapturedTsuReplay } from './replay-pvp-tsu';
import { AuditReplayStore } from './replay-store';

export async function persistCapturedTsuReplay(audit: PostgresDatabase, scope: AuditScope, gameSchema: string,
  recording: CapturedTsuReplay) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(gameSchema) || !isReplayId(recording.matchId) || !isReplayScope(scope)) return 'not-captured';
  const links = await audit.transaction(async () => {
    const match = await reconcileStoredPvpMatch(audit, { schema: gameSchema }, scope.datasetId, recording.matchId);
    if (match.status === 'not-captured' || match.scope?.environment !== scope.environment) return null;
    const bank = match.bank;
    if (!bank || bank.gameId !== 'tsu-e-fa' || bank.gameRulesVersion !== '4') return null;
    const row = await audit.prepare(`
      SELECT m.creator_id,m.opponent_id FROM ${identifier(gameSchema)}.pvp_matches m
      JOIN audit_datasets d ON d.id=? AND m.updated_at>=d.started_at_ms
        AND (d.sealed_at_ms IS NULL OR m.updated_at<=d.sealed_at_ms)
      WHERE m.id=? AND m.updated_at=? AND m.status IN ('finished','cancelled')
    `).get(scope.datasetId, recording.matchId, recording.settlement.finishedAtMs);
    if (!row?.opponent_id) return null;
    const winner = bank.winnerId === null ? null : bank.winnerId === row.creator_id ? 1
      : bank.winnerId === row.opponent_id ? 2 : undefined;
    const moneyProven = match.status === 'match' && ['settled', 'refunded'].includes(bank.state ?? '') &&
      winner === recording.settlement.winnerSeat && bank.reason === recording.settlement.reason;
    const expected = recording.lockReceipts.map(lock => ({ ...lock, account_id: lock.seat === 1 ? row.creator_id : row.opponent_id }));
    const acceptedLocks = expected.length ? await audit.prepare(`
      SELECT e.sequence FROM jsonb_to_recordset(?::jsonb)
        AS e("requestId" text, account_id text, at bigint, round integer, sequence integer)
      JOIN ${identifier(gameSchema)}.pvp_requests p ON p.id=e."requestId" AND p.account_id=e.account_id AND p.created_at=e.at
      WHERE p.match_id=? AND p.request_key::jsonb->>'action'='move'
        AND p.request_key::jsonb #>> '{move,kind}'='choose' AND p.request_key::jsonb #>> '{move,round}'=e.round::text
    `).all(JSON.stringify(expected), recording.matchId) : [];
    const proven = new Set(acceptedLocks.map(lock => Number(lock.sequence)));
    const missingLock = recording.events.find(event => event.data.kind === 'action' &&
      event.data.action.code === 'move' && !proven.has(event.sequence));
    if (!moneyProven) return { sourceGap: true, missingLock: missingLock?.sequence };
    const start: NonNullable<ReplayEvent['money']> = [], finish: NonNullable<ReplayEvent['money']> = [];
    const participants = [...match.participants].sort((a, b) =>
      Number(a.accountId !== row.creator_id) - Number(b.accountId !== row.creator_id));
    for (const participant of participants) for (const posting of participant.postings) {
      const hold = posting.stage === 'hold';
      const movement = hold ? 'reserve' : posting.entryType === 'refund' ? 'refund' : 'payout';
      (hold ? start : finish).push({ movement, units: posting.units, posting: posting.source });
    }
    return { start, finish, sourceGap: start.length !== 2, missingLock: missingLock?.sequence };
  }, { readOnly: true });
  if (!links) return 'not-captured';
  const provenRecording = links.missingLock === undefined ? recording : { ...recording,
    events: recording.events.slice(0, links.missingLock - 1),
    gaps: [...new Set([...recording.gaps, 'event-gap' as const, 'terminal-unavailable' as const])] };
  const pack = buildTsuTurnReplay(provenRecording, scope, links);
  const store = new AuditReplayStore(audit);
  return audit.transaction(async () => {
    const accepted = await store.writeManifest(pack.manifest);
    if (accepted !== 'recorded' && accepted !== 'replayed') return accepted;
    for (const fragment of pack.fragments) {
      const result = await store.writeFragment(scope, pack.manifest.replayId, fragment);
      if (result !== 'recorded' && result !== 'replayed') throw new Error('Tsu replay fragment could not be stored: ' + result);
    }
    return accepted;
  }, { lockKey: 'paid-audit-replay:' + scope.datasetId + ':' + recording.matchId });
}

export function tsuReplayWriter(audit: PostgresDatabase, scope: AuditScope, gameSchema: string) {
  let tail = Promise.resolve(), pending = 0, accepting = true;
  const gap = (reason: string) => console.warn(JSON.stringify({ event: 'audit-tsu-replay-gap', datasetId: scope.datasetId, reason }));
  return {
    record(recording: CapturedTsuReplay) {
      if (!accepting || pending >= 8) { gap('queue-unavailable'); return; }
      pending++;
      tail = tail.then(async () => {
        const result = await persistCapturedTsuReplay(audit, scope, gameSchema, recording);
        if (result !== 'recorded' && result !== 'replayed') gap(result);
      }).catch(() => gap('write-failed')).finally(() => { pending--; });
    },
    async stop() {
      accepting = false;
      await tail;
    },
  };
}
