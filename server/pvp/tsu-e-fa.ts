import { isTsuEFaChoice, tsuEFaWinner, validTsuEFaTarget, type TsuEFaChoice, type TsuEFaResult, type TsuEFaView } from '../../src/shared/tsuEFa';

export type TsuEFaState = Omit<TsuEFaView, 'self' | 'locked' | 'choice'> & { choices: [TsuEFaChoice | null, TsuEFaChoice | null] };
export function createTsuEFa(target: TsuEFaView['target'] = 3, rulesVersion: 1 | 2 = 2): TsuEFaState {
  if (rulesVersion === 1 ? target !== 2 : !validTsuEFaTarget(target)) throw Error('Недопустимая длина матча.');
  return { rulesVersion, revision: 0, phase: 'playing', round: 1, score: [0, 0], target,
    choices: [null, null], last: null, winner: null };
}
export function playTsuEFa(state: TsuEFaState, side: number, value: unknown): TsuEFaState {
  const move = value as Record<string, unknown> | null;
  if (state.phase !== 'playing' || side !== 0 && side !== 1 || !move || Array.isArray(move)
    || Object.keys(move).sort().join(',') !== 'choice,kind,round' || move.kind !== 'choose'
    || move.round !== state.round || !isTsuEFaChoice(move.choice) || state.choices[side] !== null) throw Error('Этот выбор недоступен.');
  const next = structuredClone(state);
  next.choices[side] = move.choice;
  next.revision++;
  const [a, b] = next.choices;
  if (a !== null && b !== null) {
    const winner = tsuEFaWinner(a, b);
    next.last = { round: next.round, choices: [a, b], winner } satisfies TsuEFaResult;
    if (winner !== null) next.score[winner]++;
    if (winner !== null && next.score[winner] === next.target) { next.phase = 'finished'; next.winner = winner; }
    else next.round++;
    next.choices = [null, null];
  }
  return next;
}
export function publicTsuEFa(state: TsuEFaState, side: 0 | 1): TsuEFaView {
  // Never spread private state into a network snapshot.
  return structuredClone({ rulesVersion: state.rulesVersion, revision: state.revision, phase: state.phase,
    round: state.round, self: side, score: state.score, target: state.target,
    locked: [state.choices[0] !== null, state.choices[1] !== null], choice: state.choices[side],
    last: state.last, winner: state.winner });
}
