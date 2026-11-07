import { identifier, type PostgresDatabase } from '../database';
import { reconcileStoredPvpMatch } from './check-pvp';
import type { AuditScope } from './contract';
import { isReplayId, type ReplayEvent } from './replay-package';
import { buildChessTurnReplay, type CapturedChessReplay } from './replay-pvp-turn';
import { AuditReplayStore } from './replay-store';

/** Correlate recorded gameplay with the same dataset's committed wallet result. */
export async function persistCapturedChessReplay(
  audit: PostgresDatabase, scope: AuditScope, gameSchema: string, recording: CapturedChessReplay,
) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(gameSchema) || !isReplayId(recording.matchId)) return 'not-captured';
  const links = await audit.transaction(async () => {
    const match = await reconcileStoredPvpMatch(audit, { schema: gameSchema }, scope.datasetId, recording.matchId);
    if (match.status === 'not-captured' || match.scope?.environment !== scope.environment ||
        match.bank && match.bank.gameId !== 'chess') return null;
    const unavailable = { sourceGap: true };
    if (!match.bank || match.status !== 'match' || !['settled','refunded'].includes(match.bank.state ?? '')) return unavailable;
    const row = await audit.prepare(`SELECT creator_id,opponent_id FROM ${identifier(gameSchema)}.pvp_matches WHERE id=?`).get(recording.matchId);
    if (!row || !row.opponent_id) return unavailable;
    const seat = match.bank.winnerId === null ? null : match.bank.winnerId === row.creator_id ? 1
      : match.bank.winnerId === row.opponent_id ? 2 : undefined;
    if (seat !== recording.settlement.winnerSeat || match.bank.reason !== recording.settlement.reason) return unavailable;
    const startMoney: NonNullable<ReplayEvent['money']> = [], terminalMoney: NonNullable<ReplayEvent['money']> = [];
    for (const participant of match.participants) {
      for (const posting of participant.postings) {
        const hold = posting.stage === 'hold';
        const movement = hold ? 'reserve' : posting.entryType === 'refund' ? 'refund' : 'payout';
        (hold ? startMoney : terminalMoney).push({ movement, units: posting.units, posting: posting.source });
      }
    }
    return { startMoney, terminalMoney };
  }, { readOnly: true });
  if (!links) return 'not-captured';
  const pack = buildChessTurnReplay(recording, scope, links);
  const store = new AuditReplayStore(audit);
  const accepted = await store.writeManifest(pack.manifest);
  if (accepted !== 'recorded' && accepted !== 'replayed') return accepted;
  for (const fragment of pack.fragments) {
    const result = await store.writeFragment(scope, pack.manifest.replayId, fragment);
    if (result !== 'recorded' && result !== 'replayed') return result;
  }
  return accepted;
}

/** Limit memory and background database work. The lobby never waits for a replay write. */
export function chessReplayWriter(audit: PostgresDatabase, scope: AuditScope, gameSchema: string) {
  let tail = Promise.resolve(), pending = 0, accepting = true;
  const gap = (reason: string) => {
    console.warn(JSON.stringify({ event: 'audit-chess-replay-gap', datasetId: scope.datasetId, reason }));
  };
  return {
    record(recording: CapturedChessReplay) {
      if (!accepting || pending >= 8) { gap('queue-unavailable'); return; }
      pending++;
      tail = tail.then(async () => {
        const result = await persistCapturedChessReplay(audit, scope, gameSchema, recording);
        if (result !== 'recorded' && result !== 'replayed') gap(result);
      }).catch(() => gap('write-failed')).finally(() => { pending--; });
    },
    async stop() {
      accepting = false;
      await tail;
    },
  };
}
