import { isDeepStrictEqual } from 'node:util';
import { gameAccountId } from '../../src/shared/nileWallet';
import { validPvpRequest } from '../../src/shared/pvp';
import { identifier, type PostgresDatabase } from '../database';
import { reconcileStoredPvpMatch } from './check-pvp';
import type { AuditScope } from './contract';
import { replayCaptureWriter } from './replay-capture-writer';
import { isReplayId, isReplayScope, type ReplayEvent } from './replay-package';
import {
  buildCardTurnReplay, cardParticipantSeat, cardReplayAction, cardReplayState, cardTurnReplayDefinitions, isCardTurnReplayGame, verifyCardTurnReplay,
  type CapturedCardReplay, type CardReplayReceipt, type CardTurnState,
} from './replay-pvp-cards';
import { AuditReplayStore } from './replay-store';

type Terminal = Extract<ReplayEvent['data'], { kind: 'terminal' }>;
const maxReceipts = 1026;

function terminalOutcome(reason: string | null, state: string | null): Terminal['outcome'] | null {
  if (state === 'settled') {
    if (reason === 'win') return 'settled';
    if (reason === 'resign' || reason === 'disconnect') return 'forfeited';
    if (reason === 'timeout') return 'timed-out';
  }
  if (state === 'refunded') {
    if (reason === 'draw') return 'draw';
    if (reason === 'server' || reason === 'expired' || reason === 'cancel') return 'cancelled';
  }
  return null;
}

/** Verify the original receipts, exact financial postings and final public position before writing. */
export async function persistCapturedCardReplay(audit: PostgresDatabase, scope: AuditScope, gameSchema: string,
  recording: CapturedCardReplay) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(gameSchema) || !isReplayScope(scope) || !isReplayId(recording.matchId) ||
      !isCardTurnReplayGame(recording.gameId) || recording.moves.length > maxReceipts - 2) return 'not-captured';
  const { matchId, gameId } = recording;
  const prefix = identifier(gameSchema) + '.';
  const pack = await audit.transaction(async () => {
    const match = await reconcileStoredPvpMatch(audit, { schema: gameSchema }, scope.datasetId, matchId);
    if (match.scope?.environment !== scope.environment || match.status !== 'match' || match.bank?.gameId !== gameId) return null;
    const outcome = terminalOutcome(match.bank.reason, match.bank.state);
    if (!outcome) return null;
    const row = await audit.prepare(`
      SELECT creator_id,opponent_id,updated_at,status,jsonb_typeof(cards) AS card_type,cards->>'gameId' AS game_id,cards->>'phase' AS card_phase,
        cards->'winner' AS card_winner,cards->'revision' AS revision,cards->'actor' AS actor,cards->'attacker' AS attacker,
        CASE WHEN jsonb_typeof(cards->'hands'->0)='array' THEN jsonb_array_length(cards->'hands'->0) END AS first_count,
        CASE WHEN jsonb_typeof(cards->'hands'->1)='array' THEN jsonb_array_length(cards->'hands'->1) END AS second_count,
        CASE WHEN jsonb_typeof(cards->'stock')='array' THEN jsonb_array_length(cards->'stock') END AS stock_count,
        CASE WHEN jsonb_typeof(cards->'discard')='array' THEN jsonb_array_length(cards->'discard') END AS discard_count,
        CASE WHEN cards->>'gameId'='crazy-eights' THEN jsonb_build_array(jsonb_build_object('attack',cards->'discard'->(-1)))
          ELSE cards->'table' END AS public_table,
        CASE WHEN jsonb_typeof(cards->'stock')='array' AND jsonb_array_length(cards->'stock')>0 THEN cards->'trump' END AS trump,
        cards->'suit' AS suit,cards->'collecting' AS collecting
      FROM (SELECT creator_id,opponent_id,updated_at,status,payload::jsonb->'cards' AS cards FROM ${prefix}pvp_matches WHERE id=?) AS m
    `).get(matchId);
    const dataset = await audit.prepare('SELECT started_at_ms,sealed_at_ms FROM audit_datasets WHERE id=?').get(scope.datasetId);
    if (!row || !dataset || !gameAccountId(row.creator_id) || row.opponent_id !== null && !gameAccountId(row.opponent_id) ||
        row.updated_at < dataset.started_at_ms || dataset.sealed_at_ms !== null && row.updated_at > dataset.sealed_at_ms) return null;
    const winnerSeat = cardParticipantSeat({ creatorId: row.creator_id, opponentId: row.opponent_id }, match.bank.winnerId);
    const isNatural = outcome === 'settled' || outcome === 'draw';
    const neverStarted = outcome === 'cancelled' && row.status === 'cancelled' && row.card_type === 'null';
    if ((match.bank.winnerId !== null) !== (winnerSeat !== null) || (outcome === 'draw' || outcome === 'cancelled') !== (winnerSeat === null)) return null;
    if (!neverStarted && (row.game_id !== gameId || !row.opponent_id || (isNatural
      ? row.card_phase !== 'finished' || row.card_winner !== (winnerSeat === null ? null : winnerSeat - 1)
      : row.card_phase !== 'playing'))) return null;
    const state: CardTurnState | null = neverStarted
      ? { profile: 'pvp-turn-based', phase: 'cancelled', turn: 0, seatToMove: null, board: [] }
      : cardReplayState(gameId, {
      revision: row.revision, actor: row.actor, attacker: row.attacker, handCounts: [row.first_count, row.second_count],
      stockCount: row.stock_count, discardCount: row.discard_count, trump: row.trump, suit: row.suit,
      collecting: row.collecting, table: row.public_table,
    }, outcome === 'cancelled' ? 'cancelled' : 'settled');
    if (!state) return null;

    const refs = new Map<string, { key: string; atMs: number }>();
    const receiptKey = (ref: CardReplayReceipt) => ref.seat + ':' + ref.requestId;
    const identities = [recording.initial?.receipt, ...recording.moves, recording.resign];
    const wanted = identities.flatMap(ref => {
      const account = ref?.seat === 1 ? row.creator_id : ref?.seat === 2 ? row.opponent_id : null;
      return ref && gameAccountId(ref.requestId) && account ? [{ account_id: account, id: ref.requestId }] : [];
    });
    if (wanted.length) {
      const accepted = await audit.prepare(`
        SELECT p.account_id,p.id,p.request_key,p.created_at FROM jsonb_to_recordset(?::jsonb) AS expected(account_id text,id text)
        JOIN ${prefix}pvp_requests p USING(account_id,id)
        WHERE p.match_id=? AND p.created_at>=? AND p.created_at<=COALESCE(?::bigint,9223372036854775807)
          AND octet_length(p.request_key)<=2048
      `).all(JSON.stringify(wanted), matchId, dataset.started_at_ms, dataset.sealed_at_ms);
      for (const receipt of accepted) {
        const seat = receipt.account_id === row.creator_id ? 1 : 2;
        refs.set(receiptKey({ seat, requestId: receipt.id }), { key: receipt.request_key, atMs: receipt.created_at });
      }
    }
    const requestFor = (ref: CardReplayReceipt) => {
      const receipt = refs.get(receiptKey(ref));
      if (!receipt) return null;
      try {
        const request: unknown = JSON.parse(receipt.key);
        return validPvpRequest(request) && request.id === ref.requestId && 'challengeId' in request && request.challengeId === matchId
          ? { request, atMs: receipt.atMs } : null;
      } catch { return null; }
    };
    const readyReceipt = recording.initial && requestFor(recording.initial.receipt);
    const initial = readyReceipt?.request.action === 'ready' ? recording.initial : null;
    const moveClocks = new Map<number, number>();
    const moves = recording.moves.filter(move => {
      const receipt = requestFor(move), request = receipt?.request;
      if (!receipt || request?.action !== 'move' || request.revision !== move.prior || move.after.turn !== move.prior + 1 ||
          !isDeepStrictEqual(cardReplayAction(gameId, move.seat, request.move), move.action) ||
          move.after.turn >= state.turn && !isDeepStrictEqual(move.after.board, state.board)) return false;
      moveClocks.set(move.prior, receipt.atMs);
      return true;
    });
    const resignReceipt = recording.resign && requestFor(recording.resign);
    const resignVerified = resignReceipt?.request.action === 'resign' && match.bank.reason === 'resign' && recording.resign?.seat !== winnerSeat;
    const clocks = initial?.startedAtMs != null && initial.startedAtMs === readyReceipt?.atMs
      ? { startedAtMs: initial.startedAtMs, finishedAtMs: row.updated_at as number, moves: moveClocks, resignedAtMs: resignReceipt?.atMs }
      : undefined;
    const startMoney: NonNullable<ReplayEvent['money']> = [], terminalMoney: NonNullable<ReplayEvent['money']> = [];
    const participants = [...match.participants].sort((a, b) => Number(a.accountId !== row.creator_id) - Number(b.accountId !== row.creator_id));
    for (const participant of participants) {
      for (const posting of participant.postings) {
        const hold = posting.stage === 'hold';
        (hold ? startMoney : terminalMoney).push({ movement: hold ? 'reserve' : posting.entryType === 'refund' ? 'refund' : 'payout',
          units: posting.units, posting: posting.source });
      }
    }
    return buildCardTurnReplay({ ...recording, initial, moves }, scope, {
      terminal: { kind: 'terminal', state, outcome, winnerSeat }, startMoney, terminalMoney, resignVerified, clocks,
      resignExpected: match.bank.reason === 'resign', sourceGap: participants.some(participant => participant.openingStakeUnits !== null),
    });
  }, { readOnly: true });
  if (!pack) return 'not-captured';
  if (verifyCardTurnReplay(pack).status !== 'verified') return 'corrupt';
  const store = new AuditReplayStore(audit);
  return audit.transaction(async () => {
    const accepted = await store.writeManifest(pack.manifest);
    if (accepted !== 'recorded' && accepted !== 'replayed') return accepted;
    for (const fragment of pack.fragments) {
      const result = await store.writeFragment(scope, pack.manifest.replayId, fragment);
      if (result !== 'recorded' && result !== 'replayed') throw new Error('Card replay fragment could not be stored: ' + result);
    }
    return accepted;
  }, { lockKey: 'paid-audit-replay:' + scope.datasetId + ':' + matchId });
}

/** The wallet and lobby never await the capped audit-only queue. */
export function cardsReplayWriter(audit: PostgresDatabase, scope: AuditScope, gameSchema: string) {
  return replayCaptureWriter<CapturedCardReplay>(audit, scope, gameSchema, {
    event: 'audit-cards-replay-gap', capacity: 8,
    definition: recording => cardTurnReplayDefinitions.find(definition => definition.gameId === recording.gameId),
    persist: recording => persistCapturedCardReplay(audit, scope, gameSchema, recording),
  });
}
