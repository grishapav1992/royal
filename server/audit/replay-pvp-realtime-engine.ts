import { neutralCombatInput, type CombatInput, type CombatState } from '../../src/shared/combat';
import { CombatGame } from '../combatGame';
import { verifyReplayPackage, type ReplayDefinition, type ReplayEvent, type ReplayState } from './replay-package';

export const combatReplayDefinition = {
  gameId: 'mortal-kombat', modeId: 'stake', category: 'pvp', replayProfile: 'pvp-realtime',
  rulesVersion: 'royal-combat-v1', gameVersion: 'royal-combat-v1', engineId: 'royal-combat-60hz', engineVersion: '1',
  formatVersion: 2,
} as const satisfies ReplayDefinition;

export const combatReplayTickDuration = 1 / 60;
export const maximumCombatReplayTicks = 5401;
export const combatReplaySeats = [1, 2] as const;
export type CombatReplaySeat = (typeof combatReplaySeats)[number];
export type CombatReplayFrame = Extract<ReplayState, { profile: 'pvp-realtime' }>;
export type CombatReplayEnd = Pick<Extract<ReplayEvent['data'], { kind: 'terminal' }>, 'outcome' | 'winnerSeat'>;
export type CombatReplayReconstruction =
  { status: 'verified'; state: CombatReplayFrame } |
  { status: 'incomplete' | 'corrupt' | 'unsupported' | 'too-large' | 'unknown-tick' };

const buttonNames = ['left', 'right', 'jump', 'punch', 'kick', 'block'] as const satisfies readonly (keyof CombatInput)[];
const poses = ['stand', 'walking', 'jumping', 'high-punch', 'high-kick', 'blocking', 'endure', 'fall'] as const;
const profile = combatReplayDefinition.replayProfile;

export function combatReplayButtonMask(input: CombatInput) {
  return buttonNames.reduce((mask, key, index) => mask | (Number(input[key]) << index), 0);
}

function combatInput(mask: number): CombatInput {
  const input = neutralCombatInput();
  for (const [index, name] of buttonNames.entries()) input[name] = (mask & (1 << index)) !== 0;
  return input;
}

export function combatReplayFrame(state: CombatState, tick: number, phase: CombatReplayFrame['phase'] = 'open'): CombatReplayFrame {
  const [left, right] = state.fighters;
  const project = (fighter: typeof left, facing: -1 | 1) => ({
    x: Math.round(fighter.x * 1000), y: Math.round(fighter.y * 1000), health: fighter.health,
    pose: poses.indexOf(fighter.action), facing,
  });
  return { profile, phase, tick, fighters: [project(left, 1), project(right, -1)] };
}

function frameMatches(observed: ReplayState, expected: CombatReplayFrame) {
  return observed.profile === profile && observed.phase === expected.phase && observed.tick === expected.tick &&
    observed.fighters.every((fighter, index) => {
      const correct = expected.fighters[index];
      return fighter.x === correct.x && fighter.y === correct.y && fighter.health === correct.health &&
        fighter.pose === correct.pose && fighter.facing === correct.facing;
    });
}

export function combatReplaySeatOf(players: readonly string[], id: string): CombatReplaySeat | null | undefined {
  return id === '' ? null : players[0] === id ? 1 : players[1] === id ? 2 : undefined;
}

export function combatReplayNaturalEnd(state: CombatState): CombatReplayEnd | undefined {
  if (state.phase !== 'settling') return;
  const winnerSeat = combatReplaySeatOf(state.players, state.winner);
  if (winnerSeat === undefined) return;
  return { outcome: winnerSeat === null ? 'draw' : state.remaining === 0 ? 'timed-out' : 'settled', winnerSeat };
}

/**
 * Replay applied buttons against the pinned engine and verify every checkpoint.
 * The optional timeline emits only after validation. An input at tick N shows the
 * state at N-1 before either seat's inputs for N are applied. Checkpoints and
 * terminal events show their exact tick. Presence has no physics tick in format 2.
 */
export function reconstructCombatReplay(input: unknown, targetTick?: number,
  onFrame?: (event: ReplayEvent, state: CombatReplayFrame) => void): CombatReplayReconstruction {
  const verified = verifyReplayPackage(input, [combatReplayDefinition]);
  if (verified.status !== 'verified') return { status: verified.status };
  if (targetTick !== undefined && (!Number.isSafeInteger(targetTick) || targetTick < 0 || targetTick > maximumCombatReplayTicks)) {
    return { status: 'unknown-tick' };
  }
  const { manifest, fragments } = verified.value;
  const simulation = new CombatGame(manifest.entityId);
  simulation.state.players = ['1', '2'];
  simulation.start();
  simulation.state.phase = 'playing'; // Countdown applies no physics; tick one is its first active step.
  const initial = combatReplayFrame(simulation.state, 0);
  if (!manifest.initial || !frameMatches(manifest.initial, initial)) return { status: 'corrupt' };
  const activeMasks = [0, 0];
  const dropped = new Set<CombatReplaySeat>();
  const timeline: { event: ReplayEvent; state: CombatReplayFrame }[] | undefined = onFrame ? [] : undefined;
  let tick = 0, pendingTick = 0, pendingSeat = 0, sequence = 0;
  let previous = initial, selected = targetTick === 0 ? initial : undefined;

  function advance(to: number) {
    if (to < tick || to > maximumCombatReplayTicks) return false;
    while (tick < to) {
      if (simulation.state.phase !== 'playing') return false;
      tick++;
      for (const seat of combatReplaySeats) simulation.input(String(seat), combatInput(activeMasks[seat - 1]), tick);
      simulation.tick(combatReplayTickDuration, tick);
      if (tick === targetTick) selected = combatReplayFrame(simulation.state, tick);
    }
    return true;
  }

  for (const event of fragments.flatMap(part => part.events)) {
    if (event.sequence !== ++sequence) return { status: 'incomplete' };
    const { data } = event;
    if (data.kind === 'action') {
      const action = data.action;
      if (action.profile !== profile || action.buttons > 63 || action.tick < 1 || action.tick > maximumCombatReplayTicks ||
        action.tick < pendingTick || action.tick === pendingTick && action.seat <= pendingSeat ||
        !advance(action.tick - 1) || simulation.state.phase !== 'playing' || activeMasks[action.seat - 1] === action.buttons) return { status: 'corrupt' };
      timeline?.push({ event, state: combatReplayFrame(simulation.state, tick) });
      pendingTick = action.tick;
      pendingSeat = action.seat;
      activeMasks[action.seat - 1] = action.buttons;
    } else if (data.kind === 'presence') {
      if (dropped.has(data.seat) === (data.event === 'disconnected')) return { status: 'corrupt' };
      if (data.event === 'disconnected') dropped.add(data.seat);
      else dropped.delete(data.seat);
    } else if (data.kind === 'checkpoint' || data.kind === 'terminal') {
      if (data.state.profile !== profile || data.state.tick < pendingTick || !advance(data.state.tick)) return { status: 'corrupt' };
      if (data.kind === 'terminal') {
        const actual = combatReplayNaturalEnd(simulation.state);
        if (data.outcome === 'forfeited') {
          if (actual || data.winnerSeat === null || !dropped.has(data.winnerSeat === 1 ? 2 : 1)) return { status: 'corrupt' };
        } else if (data.outcome === 'cancelled') {
          if (actual || dropped.size !== 2 || data.winnerSeat !== null) return { status: 'corrupt' };
        } else if (actual?.outcome !== data.outcome || actual.winnerSeat !== data.winnerSeat) return { status: 'corrupt' };
      } else if (simulation.state.phase !== 'playing') return { status: 'corrupt' };
      previous = combatReplayFrame(simulation.state, tick, data.kind === 'checkpoint' ? 'open' : data.outcome === 'cancelled' ? 'cancelled' : 'settled');
      if (!frameMatches(data.state, previous)) return { status: 'corrupt' };
      timeline?.push({ event, state: previous });
      if (tick === targetTick) selected = previous;
    } else return { status: 'corrupt' };
  }
  for (const { event, state } of timeline ?? []) onFrame?.(event, structuredClone(state));
  if (targetTick === undefined) return { status: 'verified', state: previous };
  return selected && targetTick <= previous.tick ? { status: 'verified', state: selected } : { status: 'unknown-tick' };
}
