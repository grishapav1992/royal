import type { PvpChallenge } from '../../src/shared/pvp';
import { isPoolIdleTimeout } from '../../src/shared/pool';
import { identifier, type PostgresDatabase } from '../database';
import { reconcileStoredPvpMatch } from './check-pvp';
import type { AuditScope } from './contract';
import {
  createReplayPackage, isReplayId, isReplayScope, type ReplayEvent, type ReplayManifest, type SportGame, type SportReplayFrame,
} from './replay-package';
import {
  reconstructSportReplay, sportReplayDefinitions, sportReplayFrame, sportReplayMaximumTicks, type TableReplayObservation,
} from './replay-pvp-sport-engine';
import { AuditReplayStore } from './replay-store';

type Seat = 1 | 2;
type WalletOutcome = 'win' | 'draw' | 'resign' | 'disconnect' | 'server' | 'timeout';
type Match = { id: string; gameId: SportGame; creatorId: string; opponentId: string };
type Terminal = Extract<ReplayEvent['data'], { kind: 'terminal' }>;
type Gap = ReplayManifest['gaps'][number];
export type CapturedSportReplay = {
  matchId: string; gameId: SportGame; initial: SportReplayFrame | null; events: ReplayEvent[]; gaps: Gap[];
  settlement: { reason: WalletOutcome; winnerSeat: Seat | null; finishedAtMs: number };
};
type ActiveCapture = { match: Match; initial: SportReplayFrame; state: TableReplayObservation['state']; startedAt: number;
  events: ReplayEvent[]; disconnected: Set<Seat>; pending: number[]; pendingAt: number; tick: number; gap: boolean;
  idle?: { state: SportReplayFrame; at: number; elapsedMs: number };
  end?: { winner: Seat; state: SportReplayFrame; at: number } };

const checkpointEveryTicks = 120;
const maxEvents = 15_360;
const maxDurations = 64;
const profile = 'pvp-sport';
const other = (seat: Seat): Seat => seat === 1 ? 2 : 1;
const zero = (value: number) => value === 0 ? 0 : value;
const isSport = (value: string): value is SportGame => value === 'hockey' || value === 'pool';
const accountSeat = (match: Match, account: string | null | undefined): Seat | null | undefined =>
  account === null ? null : account === match.creatorId ? 1 : account === match.opponentId ? 2 : undefined;

function paidPlaying(match: PvpChallenge): Match | undefined {
  const { id, gameId, creatorId, opponentId, stakeUnits, status } = match;
  if (isSport(gameId) && status === 'playing' && isReplayId(id) && /^[1-9][0-9]{0,19}$/.test(stakeUnits) &&
    opponentId && opponentId !== creatorId) return { id, gameId, creatorId, opponentId };
}

/** Observes only paid table play already matched to server-verified seats. No transport identities enter the package. */
export class SportReplayCapture {
  private readonly candidates = new Map<SportGame, Match>();
  private readonly active = new Map<SportGame, ActiveCapture>();
  private readonly lastFinished = new Map<SportGame, string>();

  constructor(private readonly accountForSession: (sessionId: string) => string | undefined,
    private readonly sink: (recording: CapturedSportReplay) => void, private readonly now = () => performance.now()) {}

  observeMatches(matches: readonly PvpChallenge[], terminals: readonly PvpChallenge[] = []) {
    for (const terminal of terminals) this.observeTerminal(terminal);
    const paid = matches.flatMap(match => paidPlaying(match) ?? []);
    for (const game of ['hockey', 'pool'] as const) {
      const candidates = paid.filter(match => match.gameId === game);
      if (candidates.length !== 1) { this.candidates.delete(game); continue; }
      const candidate = candidates[0];
      if (candidate.id === this.lastFinished.get(game)) continue;
      this.candidates.set(game, candidate);
      if (this.active.has(game) && this.active.get(game)?.match.id !== candidate.id) this.active.delete(game);
    }
  }

  private append(capture: ActiveCapture, at: number, data: ReplayEvent['data']) {
    if (capture.gap || capture.events.length >= maxEvents - (data.kind === 'terminal' ? 0 : 1)) { capture.gap = true; return; }
    const atMs = Math.floor(Math.max(0, at - capture.startedAt, capture.events.at(-1)?.atMs ?? 0));
    if (!Number.isSafeInteger(atMs)) { capture.gap = true; return; }
    capture.events.push({ sequence: capture.events.length + 1, atMs, data, postings: [] });
  }

  private flush(capture: ActiveCapture) {
    if (!capture.pending.length) return;
    this.append(capture, capture.pendingAt, { kind: 'action', action: { profile, code: 'advance', durations: capture.pending } });
    capture.pending = [];
  }

  private seat(sessionId: string | undefined, match: Match) {
    return sessionId ? accountSeat(match, this.accountForSession(sessionId)) : undefined;
  }

  observeEngine(observation: TableReplayObservation) {
    const { state } = observation;
    const capture = this.active.get(state.id);
    const match = capture?.match ?? this.candidates.get(state.id);
    if (!match) return;
    if (this.seat(state.players[0], match) !== 1 || this.seat(state.players[1], match) !== 2) {
      if (capture && !capture.end) { this.flush(capture); capture.gap = true; }
      return;
    }
    const now = this.now();
    if (observation.kind === 'start') {
      if (capture) { this.flush(capture); capture.gap = true; return; }
      if (!Number.isFinite(now) || state.phase !== 'playing') return;
      const initial = sportReplayFrame(state, 0);
      const started: ActiveCapture = { match, initial, state, startedAt: now, events: [], disconnected: new Set(),
        pending: [], pendingAt: now, tick: 0, gap: false };
      this.active.set(state.id, started);
      this.append(started, now, { kind: 'checkpoint', state: initial });
      return;
    }
    if (!capture || capture.gap || capture.end) return;
    capture.state = state;
    if (observation.kind === 'advance') {
      if (!Number.isFinite(observation.dt) || observation.dt < 0 || observation.dt > .1 ||
        capture.tick >= sportReplayMaximumTicks || capture.disconnected.size) {
        this.flush(capture); capture.gap = true; return;
      }
      capture.tick++;
      capture.pending.push(zero(observation.dt));
      capture.pendingAt = now;
      if (state.phase === 'finished') {
        this.flush(capture);
        const winner = this.seat(state.winner, match);
        if (winner) capture.end = { winner, state: sportReplayFrame(state, capture.tick), at: now };
        else capture.gap = true;
      } else if (capture.tick % checkpointEveryTicks === 0) {
        this.flush(capture);
        this.append(capture, now, { kind: 'checkpoint', state: sportReplayFrame(state, capture.tick) });
      } else if (capture.pending.length === maxDurations) this.flush(capture);
      return;
    }
    this.flush(capture);
    if (capture.disconnected.has(observation.seat)) { capture.gap = true; return; }
    const { seat, kind } = observation;
    const action = kind === 'shot' ? { profile, code: kind, seat, angle: zero(observation.angle), power: observation.power, pocket: observation.pocket } as const :
      { profile, code: kind, seat, x: zero(observation.x), y: zero(observation.y) } as const;
    this.append(capture, now, { kind: 'action', action });
  }

  observePresence(sessionId: string, event: 'disconnected' | 'reconnected') {
    for (const capture of this.active.values()) {
      const seat = this.seat(sessionId, capture.match);
      if (!seat || capture.end || capture.gap || capture.disconnected.has(seat) === (event === 'disconnected')) continue;
      this.flush(capture);
      if (event === 'disconnected') capture.disconnected.add(seat);
      else capture.disconnected.delete(seat);
      this.append(capture, this.now(), { kind: 'presence', event, seat });
    }
  }

  /** Freeze the room's cutoff before the wallet call, and apply it only on success. */
  observeAdjudicationStart(matchId: string, idleForMs?: number): (() => void) | undefined {
    const capture = [...this.active.values()].find(active => active.match.id === matchId);
    if (!capture || capture.end || capture.gap || capture.state.phase !== 'playing') return;
    this.flush(capture);
    const length = capture.events.length, tick = capture.tick, gap = capture.gap;
    const idle = isPoolIdleTimeout(idleForMs) && capture.state.id === 'pool' && !capture.state.moving && !capture.disconnected.size
      ? { state: sportReplayFrame(capture.state, tick, 'settled'), at: this.now(), elapsedMs: idleForMs } : undefined;
    return () => {
      if (this.active.get(capture.match.gameId) !== capture) return;
      capture.events.length = length;
      capture.tick = tick;
      capture.gap = gap;
      capture.pending = [];
      capture.end = undefined;
      capture.idle = idle;
    };
  }

  observeAdjudication(matchId: string, winnerId: string | null, reason: 'win' | 'draw' | 'server' | 'timeout', finishedAtMs: number) {
    const match = this.find(matchId);
    if (match) this.finish(match, winnerId, reason, finishedAtMs);
  }

  observeTerminal(challenge: PvpChallenge, acceptedResignationActor?: string) {
    const match = this.find(challenge.id);
    if (!match || challenge.gameId !== match.gameId || challenge.creatorId !== match.creatorId ||
      challenge.opponentId !== match.opponentId || !['finished', 'cancelled'].includes(challenge.status)) return;
    const { reason } = challenge;
    if (reason === 'win' || reason === 'draw' || reason === 'resign' || reason === 'disconnect' || reason === 'server' || reason === 'timeout') {
      this.finish(match, challenge.winnerId, reason, challenge.expiresAt, acceptedResignationActor);
    }
  }

  private find(id: string) {
    return [...this.active.values()].find(capture => capture.match.id === id)?.match ??
      [...this.candidates.values()].find(match => match.id === id);
  }

  private finish(match: Match, winnerId: string | null, reason: WalletOutcome, finishedAtMs: number, acceptedResignationActor?: string) {
    const winnerSeat = accountSeat(match, winnerId);
    if (winnerSeat === undefined || !Number.isSafeInteger(finishedAtMs) || finishedAtMs < 0 ||
      (reason === 'draw' || reason === 'server') && winnerSeat !== null ||
      (reason === 'win' || reason === 'resign' || reason === 'disconnect' || reason === 'timeout') && winnerSeat === null) return;
    const capture = this.active.get(match.gameId);
    this.active.delete(match.gameId);
    this.candidates.delete(match.gameId);
    this.lastFinished.set(match.gameId, match.id);
    const settlement = { reason, winnerSeat, finishedAtMs };
    if (!capture) {
      this.sink({ matchId: match.id, gameId: match.gameId, initial: null, events: [],
        gaps: ['initial-state-unavailable', 'terminal-unavailable'], settlement });
      return;
    }
    const now = this.now();
    this.flush(capture);
    let terminal: Terminal | undefined;
    let terminalAt = capture.end?.at ?? now;
    if (!capture.gap && reason === 'timeout' && capture.idle && winnerSeat === other(capture.idle.state.turn)) {
      terminal = { kind: 'terminal', state: capture.idle.state, outcome: 'timed-out', winnerSeat, idleForMs: capture.idle.elapsedMs };
      terminalAt = capture.idle.at;
    } else if (!capture.gap && capture.end?.winner === winnerSeat && reason === 'win') {
      terminal = { kind: 'terminal', state: capture.end.state, outcome: 'settled', winnerSeat };
    } else if (!capture.gap && !capture.end && capture.state.phase === 'playing') {
      const resigning = accountSeat(match, acceptedResignationActor);
      if (reason === 'resign' && winnerSeat && resigning === other(winnerSeat)) {
        this.append(capture, now, { kind: 'action', action: { profile, code: 'resign', seat: resigning } });
        terminal = { kind: 'terminal', state: sportReplayFrame(capture.state, capture.tick, 'settled'), outcome: 'forfeited', winnerSeat };
      } else if (reason === 'disconnect' && winnerSeat && capture.disconnected.has(other(winnerSeat))) {
        terminal = { kind: 'terminal', state: sportReplayFrame(capture.state, capture.tick, 'settled'), outcome: 'forfeited', winnerSeat };
      } else if (reason === 'server') {
        terminal = { kind: 'terminal', state: sportReplayFrame(capture.state, capture.tick, 'cancelled'), outcome: 'cancelled', winnerSeat: null };
      }
    }
    if (terminal) this.append(capture, terminalAt, terminal);
    const gaps: Gap[] = [];
    if (capture.gap) gaps.push('event-gap');
    if (capture.events.at(-1)?.data.kind !== 'terminal') gaps.push('terminal-unavailable');
    this.sink({ matchId: match.id, gameId: match.gameId, initial: capture.initial, events: capture.events, gaps, settlement });
  }
}

export function buildSportReplay(recording: CapturedSportReplay, scope: AuditScope, links: {
  startMoney?: ReplayEvent['money']; terminalMoney?: ReplayEvent['money']; sourceGap?: boolean;
} = {}) {
  const last = recording.events.at(-1)?.data;
  const formatVersion = last?.kind === 'terminal' && last.outcome === 'timed-out' ? 5 : 4;
  const { formatVersion: _version, ...game } = sportReplayDefinitions.find(definition =>
    definition.gameId === recording.gameId && definition.formatVersion === formatVersion)!;
  const events = recording.events.map((event, index) => {
    const money = index === 0 && event.data.kind === 'checkpoint' && event.atMs === 0 ? links.startMoney :
      event.data.kind === 'terminal' ? links.terminalMoney : undefined;
    return { ...event, postings: money?.map(leg => leg.posting) ?? [], ...(money?.length ? { money } : {}) };
  });
  const gaps = links.sourceGap ? [...recording.gaps, 'source-unavailable' as const] : recording.gaps;
  const pack = createReplayPackage({ formatVersion, scope, replayId: recording.matchId, entityId: recording.matchId,
    game, initial: recording.initial, gaps, coverage: gaps.length ? 'partial' : 'complete' }, events);
  if (reconstructSportReplay(pack).status !== 'verified') throw new Error('Invalid sport replay evidence');
  return pack;
}

export async function persistCapturedSportReplay(audit: PostgresDatabase, scope: AuditScope, gameSchema: string, recording: CapturedSportReplay) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(gameSchema) || !isReplayScope(scope) || !isReplayId(recording.matchId) ||
    !isSport(recording.gameId)) return 'not-captured';
  const links = await audit.transaction(async () => {
    const match = await reconcileStoredPvpMatch(audit, { schema: gameSchema }, scope.datasetId, recording.matchId);
    if (match.status === 'not-captured' || match.scope?.environment !== scope.environment ||
      match.bank && match.bank.gameId !== recording.gameId) return null;
    const unavailable = { sourceGap: true };
    if (!match.bank || match.status !== 'match' || !['settled', 'refunded'].includes(match.bank.state ?? '')) return unavailable;
    const row = await audit.prepare(`
      SELECT m.creator_id,m.opponent_id FROM ${identifier(gameSchema)}.pvp_matches m
      JOIN audit_datasets d ON d.id=? AND m.updated_at>=d.started_at_ms
        AND (d.sealed_at_ms IS NULL OR m.updated_at<=d.sealed_at_ms)
      WHERE m.id=? AND m.status IN ('finished','cancelled')
    `).get(scope.datasetId, recording.matchId);
    if (!row?.opponent_id) return unavailable;
    const seat = match.bank.winnerId === null ? null : match.bank.winnerId === row.creator_id ? 1 :
      match.bank.winnerId === row.opponent_id ? 2 : undefined;
    if (seat !== recording.settlement.winnerSeat || match.bank.reason !== recording.settlement.reason) return unavailable;
    const startMoney: NonNullable<ReplayEvent['money']> = [], terminalMoney: NonNullable<ReplayEvent['money']> = [];
    const participants = [...match.participants].sort((a, b) => Number(a.accountId !== row.creator_id) - Number(b.accountId !== row.creator_id));
    for (const participant of participants) for (const posting of participant.postings) {
      const hold = posting.stage === 'hold';
      const movement = hold ? 'reserve' : posting.entryType === 'refund' ? 'refund' : 'payout';
      (hold ? startMoney : terminalMoney).push({ movement, units: posting.units, posting: posting.source });
    }
    return { startMoney, terminalMoney, sourceGap: participants.some(participant => participant.openingStakeUnits !== null) };
  }, { readOnly: true });
  if (!links) return 'not-captured';
  const pack = buildSportReplay(recording, scope, links);
  const store = new AuditReplayStore(audit);
  return audit.transaction(async () => {
    const accepted = await store.writeManifest(pack.manifest);
    if (accepted !== 'recorded' && accepted !== 'replayed') return accepted;
    for (const fragment of pack.fragments) {
      const result = await store.writeFragment(scope, pack.manifest.replayId, fragment);
      if (result !== 'recorded' && result !== 'replayed') throw new Error('Sport replay fragment could not be stored: ' + result);
    }
    return accepted;
  }, { lockKey: 'paid-audit-replay:' + scope.datasetId + ':' + recording.matchId });
}

/** At most two full packages await the background writer. Live room processing does not await PostgreSQL. */
export function sportReplayWriter(audit: PostgresDatabase, scope: AuditScope, gameSchema: string) {
  let tail = Promise.resolve(), pending = 0, accepting = true;
  const gap = (reason: string) => console.warn(JSON.stringify({ event: 'audit-sport-replay-gap', datasetId: scope.datasetId, reason }));
  return {
    record(recording: CapturedSportReplay) {
      if (!accepting || pending >= 2) { gap('queue-unavailable'); return; }
      pending++;
      tail = tail.then(async () => {
        const result = await persistCapturedSportReplay(audit, scope, gameSchema, recording);
        if (result !== 'recorded' && result !== 'replayed') gap(result);
      }).catch(() => gap('write-failed')).finally(() => { pending--; });
    },
    async stop() { accepting = false; await tail; },
  };
}
