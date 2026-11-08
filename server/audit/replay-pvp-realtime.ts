import type { CombatState } from '../../src/shared/combat';
import type { CombatGame } from '../combatGame';
import type { CombatRoom } from '../combatRoom';
import type { CombatEscrow } from '../combatWallet';
import { identifier, type PostgresDatabase } from '../database';
import { reconcileStoredPvpMatch } from './check-pvp';
import type { AuditScope } from './contract';
import { replayCaptureWriter } from './replay-capture-writer';
import { createReplayPackage, isReplayId, type ReplayEvent, type ReplayPackage } from './replay-package';
import { AuditReplayStore } from './replay-store';
import { combatReplayButtonMask, combatReplayDefinition, combatReplayFrame, combatReplayNaturalEnd, combatReplaySeatOf,
  combatReplaySeats, combatReplayTickDuration, maximumCombatReplayTicks, reconstructCombatReplay,
  type CombatReplayEnd, type CombatReplayFrame, type CombatReplaySeat } from './replay-pvp-realtime-engine';

export { combatReplayDefinition, reconstructCombatReplay } from './replay-pvp-realtime-engine';

const { formatVersion, ...game } = combatReplayDefinition;
const maximumEvents = 12000;
const inputExpiryMs = 350;
const checkpointInterval = 60;
type Gap = 'event-gap' | 'terminal-unavailable' | 'source-unavailable';
type Money = NonNullable<ReplayEvent['money']>;
type Capture = {
  id: string; initial: CombatReplayFrame; events: ReplayEvent[]; startedAt: number; tick: number; buttons: [number, number];
  dropped: Set<CombatReplaySeat>; end?: CombatReplayEnd; gap: boolean;
};
export type CapturedCombatReplay = {
  matchId: string; initial: CombatReplayFrame; events: ReplayEvent[]; gaps: Gap[];
  winnerSeat: CombatReplaySeat | null; walletWinnerSeat: CombatReplaySeat | null;
};


/** One room only. Watches the real engine's synchronous public boundaries when audit is enabled. */
export class CombatRealtimeReplayCapture {
  private observedRoom?: CombatRoom;
  private observedGame?: CombatGame;
  private funded?: { id: string; accounts: [string, string] };
  private active?: Capture;

  constructor(private readonly sink: (recording: CapturedCombatReplay) => void,
    private readonly now: () => number = () => performance.now()) {}

  escrow(source: CombatEscrow): CombatEscrow {
    return {
      fund: async (id, accounts, stake) => {
        await source.fund(id, accounts, stake);
        if (isReplayId(id) && accounts.length === 2 && accounts[0] !== accounts[1]) {
          this.funded = { id, accounts: [accounts[0], accounts[1]] };
        }
      },
      settle: async (id, winner) => {
        const settled = await source.settle(id, winner);
        this.guard(() => this.finish(id, settled.winner));
        return settled;
      },
      recoverExpired: () => source.recoverExpired(),
      ...(source.cancel ? { cancel: async (id: string, accounts: string[], stake: number) => {
        await source.cancel!(id, accounts, stake);
        if (this.funded?.id === id) this.funded = undefined;
      } } : {}),
    };
  }

  attach(room: CombatRoom) {
    if (this.observedRoom === room) return;
    this.observedRoom = room;
    const tick = room.tick.bind(room), handle = room.handle.bind(room), leave = room.leave.bind(room);
    const disconnect = room.disconnect.bind(room), reconnect = room.reconnect.bind(room);
    const attachGame = () => this.guard(() => this.attachGame(room.game));
    attachGame();
    room.tick = dt => { attachGame(); tick(dt); };
    room.handle = (id, value) => { handle(id, value); attachGame(); };
    room.disconnect = id => { disconnect(id); this.guard(() => this.presence(room.state, id, 'disconnected')); };
    room.reconnect = id => { reconnect(id); this.guard(() => this.presence(room.state, id, 'reconnected')); };
    room.leave = id => {
      const phase = room.state.phase;
      leave(id);
      this.guard(() => {
        if ((phase === 'playing' || phase === 'countdown') && room.state.phase === 'settling') {
          this.presence(room.state, id, 'disconnected');
          this.externalEnd(room.state, this.now());
        }
      });
      attachGame();
    };
  }

  private guard(observe: () => void) {
    try { observe(); } catch { if (this.active) this.active.gap = true; }
  }

  private attachGame(engine: CombatGame) {
    if (this.observedGame === engine) return;
    this.observedGame = engine;
    const start = engine.start.bind(engine), tick = engine.tick.bind(engine);
    engine.start = () => { start(); this.guard(() => this.start(engine.state)); };
    engine.tick = (dt, now) => {
      const state = engine.state;
      let before: { remaining: number; masks: [number, number] } | undefined;
      this.guard(() => {
        if (state.id !== this.active?.id || this.active.end || this.active.gap) return;
        if (state.phase === 'settling') this.externalEnd(state, now);
        if (state.phase !== 'playing' || state.fighters.length !== 2) return;
        const effective = (fighter: CombatState['fighters'][number]) => now - fighter.inputAt > inputExpiryMs ? 0 : combatReplayButtonMask(fighter.input);
        before = { remaining: state.remaining, masks: [effective(state.fighters[0]), effective(state.fighters[1])] };
      });
      tick(dt, now);
      if (before) this.guard(() => this.physics(state, now, before!));
    };
  }

  private start(state: CombatState) {
    if (this.funded?.id !== state.id || state.players.length !== 2 || state.fighters.length !== 2 || state.phase !== 'countdown') return;
    const startedAt = this.now();
    if (!Number.isFinite(startedAt)) return;
    const initial = combatReplayFrame(state, 0);
    this.active = { id: state.id, startedAt, initial, events: [], tick: 0, buttons: [0, 0], dropped: new Set(), gap: false };
    this.append(this.active, startedAt, { kind: 'checkpoint', state: initial });
  }

  private append(capture: Capture, now: number, data: ReplayEvent['data']) {
    if (!Number.isFinite(now) || capture.events.length >= maximumEvents) { capture.gap = true; return; }
    const atMs = Math.floor(Math.max(now - capture.startedAt, capture.events.at(-1)?.atMs ?? 0));
    if (!Number.isSafeInteger(atMs)) { capture.gap = true; return; }
    capture.events.push({ sequence: capture.events.length + 1, atMs, data, postings: [] });
  }

  private physics(state: CombatState, now: number, before: { remaining: number; masks: [number, number] }) {
    const capture = this.active;
    if (!capture || capture.id !== state.id || capture.end || capture.gap || state.remaining === before.remaining) return;
    // The unchanged game subtracts this same value once per inner step, at most six times per outer tick.
    // Equality also counts the final clamp to zero, where division and rounding can lose the last tiny delta.
    let remaining = before.remaining, steps = 0;
    while (remaining !== state.remaining && steps < 6) {
      remaining = Math.max(0, remaining - combatReplayTickDuration);
      steps++;
    }
    if (remaining !== state.remaining || capture.tick + steps > maximumCombatReplayTicks) { capture.gap = true; return; }
    for (const seat of combatReplaySeats) {
      const index = seat - 1, buttons = before.masks[index];
      if (buttons === capture.buttons[index]) continue;
      this.append(capture, now, { kind: 'action', action: { profile: game.replayProfile, code: 'input', seat, tick: capture.tick + 1, buttons } });
      capture.buttons[index] = buttons;
    }
    const previousTick = capture.tick;
    capture.tick += steps;
    const end = combatReplayNaturalEnd(state);
    if (end) this.terminal(capture, state, end, now);
    else if (Math.floor(previousTick / checkpointInterval) !== Math.floor(capture.tick / checkpointInterval)) {
      this.append(capture, now, { kind: 'checkpoint', state: combatReplayFrame(state, capture.tick) });
    }
  }

  private presence(state: CombatState, id: string, event: 'disconnected' | 'reconnected') {
    const capture = this.active, seat = combatReplaySeatOf(state.players, id);
    if (!capture || capture.id !== state.id || !seat || capture.end || capture.gap ||
        capture.dropped.has(seat) === (event === 'disconnected')) return;
    if (event === 'disconnected') capture.dropped.add(seat);
    else capture.dropped.delete(seat);
    this.append(capture, this.now(), { kind: 'presence', event, seat });
  }

  private externalEnd(state: CombatState, now: number) {
    const capture = this.active, winnerSeat = combatReplaySeatOf(state.players, state.winner);
    if (!capture || capture.id !== state.id || capture.end || capture.gap) return;
    if (winnerSeat === null && capture.dropped.size === 2) this.terminal(capture, state, { outcome: 'cancelled', winnerSeat }, now);
    else if (winnerSeat && capture.dropped.has(winnerSeat === 1 ? 2 : 1)) this.terminal(capture, state, { outcome: 'forfeited', winnerSeat }, now);
    else capture.gap = true;
  }

  private terminal(capture: Capture, state: CombatState, end: CombatReplayEnd, now: number) {
    if (capture.gap) return;
    this.append(capture, now, { kind: 'terminal', ...end,
      state: combatReplayFrame(state, capture.tick, end.outcome === 'cancelled' ? 'cancelled' : 'settled') });
    if (!capture.gap) capture.end = end;
  }

  private finish(id: string, winner: string) {
    const funded = this.funded, capture = this.active;
    if (!funded || funded.id !== id) return;
    this.funded = undefined;
    this.active = undefined;
    if (!capture || capture.id !== id) return;
    const winnerSeat = combatReplaySeatOf(funded.accounts, winner);
    const gaps: Gap[] = [];
    if (capture.gap) gaps.push('event-gap');
    if (!capture.end) gaps.push('terminal-unavailable');
    if (winnerSeat === undefined || capture.end && capture.end.winnerSeat !== winnerSeat) gaps.push('source-unavailable');
    this.sink({ matchId: id, initial: capture.initial, events: capture.events, gaps,
      winnerSeat: capture.end?.winnerSeat ?? null, walletWinnerSeat: winnerSeat ?? null });
  }
}

export function buildCombatReplay(recording: CapturedCombatReplay, scope: AuditScope, links: {
  startMoney?: Money; terminalMoney?: Money; sourceGap?: boolean;
} = {}): ReplayPackage {
  const gaps = [...new Set([...recording.gaps, ...(links.sourceGap ? ['source-unavailable' as const] : [])])];
  const events = recording.events.map((event, index) => {
    const money = index === 0 ? links.startMoney : event.data.kind === 'terminal' ? links.terminalMoney : undefined;
    return { ...event, postings: money?.map(leg => leg.posting) ?? [], ...(money?.length ? { money } : {}) };
  });
  const replay = createReplayPackage({ formatVersion, scope, replayId: recording.matchId, entityId: recording.matchId,
    game, initial: recording.initial, gaps, coverage: gaps.length ? 'partial' : 'complete' }, events);
  if (reconstructCombatReplay(replay).status !== 'verified') throw Error('Invalid combat replay evidence');
  return replay;
}


export async function persistCapturedCombatReplay(audit: PostgresDatabase, scope: AuditScope, gameSchema: string, recording: CapturedCombatReplay) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(gameSchema) || !isReplayId(recording.matchId)) return 'not-captured';
  const links = await audit.transaction(async () => {
    const match = await reconcileStoredPvpMatch(audit, { schema: gameSchema }, scope.datasetId, recording.matchId);
    if (match.status === 'not-captured' || match.scope?.environment !== scope.environment ||
        match.bank && match.bank.gameId !== game.gameId) return null;
    const unavailable = { sourceGap: true };
    if (!match.bank || match.status !== 'match' || !['settled', 'refunded'].includes(match.bank.state ?? '') ||
        match.bank.reason !== (recording.walletWinnerSeat === null ? 'draw' : 'win') ||
        recording.gaps.includes('source-unavailable')) return unavailable;
    const row = await audit.prepare(`SELECT accounts FROM ${identifier(gameSchema)}.combat_matches WHERE id=?`).get(recording.matchId);
    const accounts: unknown = row ? JSON.parse(row.accounts) : null;
    if (!Array.isArray(accounts) || accounts.length !== 2 || combatReplaySeatOf(accounts, match.bank.winnerId ?? '') !== recording.walletWinnerSeat) return unavailable;
    const startMoney: Money = [], terminalMoney: Money = [];
    for (const participant of match.participants) {
      for (const posting of participant.postings) {
        const hold = posting.stage === 'hold';
        const movement = hold ? 'reserve' : posting.entryType === 'refund' ? 'refund' : 'payout';
        (hold ? startMoney : terminalMoney).push({ movement, units: posting.units, posting: posting.source });
      }
    }
    if (startMoney.length !== 2 || !terminalMoney.length || !recording.events.some(event => event.data.kind === 'terminal')) return unavailable;
    return { startMoney, terminalMoney };
  }, { readOnly: true });
  if (!links) return 'not-captured';
  const pack = buildCombatReplay(recording, scope, links);
  const store = new AuditReplayStore(audit);
  const accepted = await store.writeManifest(pack.manifest);
  if (accepted !== 'recorded' && accepted !== 'replayed') return accepted;
  for (const fragment of pack.fragments) {
    const result = await store.writeFragment(scope, pack.manifest.replayId, fragment);
    if (result !== 'recorded' && result !== 'replayed') return result;
  }
  return accepted;
}

export function combatReplayWriter(audit: PostgresDatabase, scope: AuditScope, gameSchema: string) {
  return replayCaptureWriter<CapturedCombatReplay>(audit, scope, gameSchema, {
    event: 'audit-combat-replay-gap', capacity: 4, definition: () => combatReplayDefinition,
    persist: recording => persistCapturedCombatReplay(audit, scope, gameSchema, recording),
  });
}
