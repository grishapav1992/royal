import type { PvpChallenge, PvpSnapshot } from '../../src/shared/pvp';
import { isReplayId, type ReplayEvent } from './replay-package';
import { tsuReplayState, verifyTsuTerminal, verifyTsuTransition, type CapturedTsuReplay } from './replay-pvp-tsu';

type Seat = 1 | 2;
type State = NonNullable<CapturedTsuReplay['initial']>;
type Active = { recording: CapturedTsuReplay; state: State; revision: number; startedAt: number;
  observedAt: number; presence: Set<Seat>; participants: [string, string]; gap: boolean };
type Command = { id?: unknown; action?: unknown; challengeId?: unknown };
type MatchedCommand = { accountId: string; action: unknown; requestId: string };

function append(active: Active, at: number, data: ReplayEvent['data']) {
  if (active.recording.events.length >= 4096 || at < active.startedAt || !Number.isSafeInteger(at)) { active.gap = true; return; }
  const atMs = at - active.startedAt;
  const last = active.recording.events.at(-1);
  if (last && atMs < last.atMs) { active.gap = true; return; }
  active.recording.events.push({ sequence: active.recording.events.length + 1, atMs, data, postings: [] });
}

export class TsuTurnReplayCapture {
  private readonly active = new Map<string, Active>();

  constructor(private readonly sink: (recording: CapturedTsuReplay) => void) {}

  observeCommand(accountId: string, request: Command | undefined, snapshot: PvpSnapshot & { requestId?: string }) {
    this.observe(snapshot, isReplayId(request?.id) && request.id === snapshot.requestId && request.challengeId === snapshot.active?.id
      ? { accountId, action: request.action, requestId: request.id } : undefined);
  }

  observeSnapshot(snapshot: PvpSnapshot) { this.observe(snapshot); }

  private observe(snapshot: PvpSnapshot, command?: MatchedCommand) {
    const { active: challenge, tsuEFa: view, now } = snapshot;
    if (challenge?.gameId === 'tsu-e-fa' && challenge.rulesVersion === 4 && challenge.mode === 'stake' &&
        challenge.opponentId && view?.duel && isReplayId(challenge.id) && /^[1-9][0-9]*$/.test(challenge.stakeUnits)) {
      const ongoing = challenge.status === 'playing';
      const state = tsuReplayState(view, ongoing ? 'open' : challenge.reason === 'server' ? 'cancelled' : 'settled');
      let active = this.active.get(challenge.id);
      const originalStart = view.revision === 0 && view.duel.startsAt === now && command?.action === 'duel-ready';
      const laterObservation = view.revision > 0 || view.duel.startsAt < now;
      if (!active && ongoing && state && (originalStart || laterObservation) &&
          !view.duel.paused && !challenge.disconnected.length && this.active.size < 32) {
        const participants: Active['participants'] = [challenge.creatorId, challenge.opponentId];
        const recording: CapturedTsuReplay = { matchId: challenge.id, initial: originalStart ? state : null, events: [],
          lockReceipts: [], gaps: originalStart ? [] : ['initial-state-unavailable', 'event-gap'],
          settlement: { reason: '', winnerSeat: null, finishedAtMs: 0 } };
        active = { recording, state, revision: view.revision, startedAt: now, observedAt: now,
          presence: new Set(), participants, gap: false };
        this.active.set(challenge.id, active);
        append(active, active.startedAt, { kind: 'checkpoint', state });
      }
      if (active && now >= active.observedAt && view.revision >= active.revision) {
        if (ongoing) {
          if (state) this.update(active, state, challenge, view.revision, now, view.duel.startsAt, command);
          else active.gap = true;
        } else if (challenge.status === 'finished' || challenge.status === 'cancelled') {
          const terminalRevision = active.revision + (challenge.reason === 'win' ? 2 : 0);
          this.finish(active, challenge, view.revision === terminalRevision ? state : null, command);
        }
      }
    }
    // A terminal challenge can outlive its last per-player game projection.
    for (const terminal of snapshot.challenges) {
      const active = this.active.get(terminal.id);
      if (active && (terminal.status === 'finished' || terminal.status === 'cancelled')) {
        this.finish(active, terminal, null);
      }
    }
  }

  private update(active: Active, state: State, challenge: PvpChallenge, revision: number, now: number, stageStartedAt: number,
    command?: MatchedCommand) {
    if (active.gap) return;
    active.observedAt = now;
    for (const seat of [1, 2] as const) {
      const disconnected = challenge.disconnected.some(row => row.accountId === active.participants[seat - 1]);
      if (disconnected === active.presence.has(seat)) continue;
      if (disconnected) active.presence.add(seat); else active.presence.delete(seat);
      append(active, now, { kind: 'presence', seat, event: disconnected ? 'disconnected' : 'reconnected' });
    }
    if (revision === active.revision) {
      if (!state.board.every((value, i) => value === active.state.board[i])) active.gap = true;
      return;
    }
    const added = state.board[4] & ~active.state.board[4];
    const expectedRevision = active.revision + (active.state.board[3] === 1 ? 2 : 1);
    const seat = added === 1 || added === 2 ? added : 0;
    const exactClock = seat ? command?.action === 'move' && command.accountId === active.participants[seat - 1] : stageStartedAt === now;
    if (revision !== expectedRevision || !verifyTsuTransition(active.state, state, seat) || !exactClock) {
      active.gap = true;
      return;
    }
    if (seat && command) {
      append(active, now, { kind: 'action', action: { profile: state.profile, code: 'move', seat, positions: [state.turn] } });
      if (!active.gap) active.recording.lockReceipts.push({ requestId: command.requestId, seat, round: state.turn, at: now,
        sequence: active.recording.events.length });
    }
    append(active, now, { kind: 'checkpoint', state });
    active.state = state;
    active.revision = revision;
  }

  private finish(active: Active, challenge: PvpChallenge, state: State | null, command?: MatchedCommand) {
    this.active.delete(challenge.id);
    const winnerSeat = challenge.winnerId === active.participants[0] ? 1 : challenge.winnerId === active.participants[1] ? 2 : null;
    const reason = challenge.reason;
    active.recording.settlement = { reason, winnerSeat, finishedAtMs: challenge.expiresAt };
    const resigned = command?.action === 'resign' ?
      command.accountId === active.participants[0] ? 1 : command.accountId === active.participants[1] ? 2 : null : null;
    const outcome = reason === 'win' ? 'settled' : reason === 'draw' ? 'draw' : reason === 'timeout' ? 'timed-out'
      : reason === 'resign' || reason === 'disconnect' ? 'forfeited' : reason === 'server' ? 'cancelled' : null;
    if (!active.gap && state && outcome && (!challenge.winnerId || winnerSeat)) {
      const data = { kind: 'terminal', state, winnerSeat, outcome } as const;
      if (verifyTsuTerminal(data, active.state, resigned, active.presence)) {
        if (resigned) append(active, challenge.expiresAt, { kind: 'action', action: { profile: state.profile,
          code: 'resign', seat: resigned, positions: [] } });
        append(active, challenge.expiresAt, data);
      }
    }
    if (active.recording.events.at(-1)?.data.kind !== 'terminal') {
      if (!active.recording.gaps.includes('event-gap')) active.recording.gaps.push('event-gap');
      active.recording.gaps.push('terminal-unavailable');
    }
    this.sink(active.recording);
  }
}
