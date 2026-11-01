/** Read-only validation of accepted casino history and retirement settlements. */
type LegacyStateFields = {
  id: string; rulesVersion: 1;
  state: 'active' | 'lost' | 'cashed_out'; stakeUnits: string;
};
export type LegacyTowerState = LegacyStateFields & {
  gameId: 'github-tower'; settings: { difficulty: 'easy' | 'medium' | 'hard' };
  choices: number[]; cards: { rank: number; suit: number }[]; dragons: number[];
};
export type LegacyCasinoState = LegacyTowerState | LegacyStateFields & {
  gameId: 'github-hilo'; settings: Record<string, never>; choices: ('higher' | 'lower')[];
  cards: { rank: number; suit: number }[]; dragons?: number[];
};
export type LegacyCasinoAction =
  | { id: string; gameId: LegacyCasinoState['gameId']; action: 'start'; stakeUnits: string; settings: LegacyCasinoState['settings'] }
  | { id: string; gameId: LegacyCasinoState['gameId']; action: 'pick'; sessionId: string; choice: number | 'higher' | 'lower' }
  | { id: string; gameId: LegacyCasinoState['gameId']; action: 'cashout'; sessionId: string };
const record = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const fields = (value: object, names: string) => Object.keys(value).sort().join(',') === names.split(',').sort().join(',');
const uuid = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const integer = (value: unknown, min: number, max: number) => Number.isInteger(value) && Number(value) >= min && Number(value) <= max;
const units = (value: unknown) => typeof value === 'string' && /^[1-9][0-9]{0,15}$/.test(value);
const columns = (difficulty: unknown) => difficulty === 'easy' ? 4 : difficulty === 'medium' ? 3 : difficulty === 'hard' ? 2 : 0;
const same = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, i) => same(value, b[i]));
  return record(a) && record(b) && Object.keys(a).length === Object.keys(b).length
    && Object.keys(a).every(key => Object.hasOwn(b, key) && same(a[key], b[key]));
};

export function validLegacyCasinoState(value: unknown): value is LegacyCasinoState {
  if (!record(value) || !fields(value, 'id,gameId,rulesVersion,state,stakeUnits,settings,choices,cards' + (Object.hasOwn(value, 'dragons') ? ',dragons' : ''))
    || !uuid(value.id) || !['github-hilo', 'github-tower'].includes(value.gameId) || value.rulesVersion !== 1
    || !['active', 'lost', 'cashed_out'].includes(value.state) || !units(value.stakeUnits) || !record(value.settings)
    || !Array.isArray(value.choices) || !Array.isArray(value.cards)) return false;
  const tower = value.gameId === 'github-tower', width = columns(value.settings.difficulty), limit = tower ? 9 : 2;
  if (tower ? !fields(value.settings, 'difficulty') || !width || value.cards.length !== 0
      || !Array.isArray(value.dragons) || value.dragons.length !== 9 || !value.dragons.every((n: unknown) => integer(n, 0, width - 1))
    : Object.keys(value.settings).length !== 0 || value.cards.length !== 3
      || !value.cards.every((card: unknown) => record(card) && fields(card, 'rank,suit') && integer(card.rank, 1, 13) && integer(card.suit, 0, 3))
      || Object.hasOwn(value, 'dragons') && (!Array.isArray(value.dragons) || value.dragons.length !== 0)) return false;
  if (value.choices.length > limit) return false;
  let lost = false;
  for (let i = 0; i < value.choices.length; i++) {
    const choice = value.choices[i];
    if (lost) return false;
    if (tower) {
      if (!integer(choice, 0, width - 1)) return false;
      lost = value.dragons![i] === choice;
    } else {
      const rank = value.cards[i].rank, next = value.cards[i + 1].rank;
      if (!['higher', 'lower'].includes(choice) || choice === 'higher' && rank === 13 || choice === 'lower' && rank === 1) return false;
      lost = choice === 'higher' ? next <= rank : next >= rank;
    }
  }
  return lost ? value.state === 'lost' : value.state === 'active' ? value.choices.length < limit
    : value.state === 'cashed_out' && (tower || value.choices.length > 0);
}
export function isLegacyTowerState(value: unknown): value is LegacyTowerState {
  return validLegacyCasinoState(value) && value.gameId === 'github-tower';
}

function ratio(state: LegacyCasinoState): [bigint, bigint] {
  if (!validLegacyCasinoState(state)) throw Error('Invalid historical casino state');
  if (state.state === 'lost') return [0n, 1n];
  if (!state.choices.length) return [1n, 1n];
  if (state.gameId === 'github-tower') {
    const width = BigInt(columns(state.settings.difficulty)), steps = BigInt(state.choices.length);
    return [99n * width ** steps, 100n * (width - 1n) ** steps];
  }
  let denominator = 100n;
  state.choices.forEach((choice, i) => { const rank = state.cards[i].rank; denominator *= BigInt(choice === 'higher' ? 13 - rank : rank - 1); });
  return [99n * 13n ** BigInt(state.choices.length), denominator];
}
export function legacyCasinoPayout(state: LegacyCasinoState): bigint {
  const [numerator, denominator] = ratio(state);
  return BigInt(state.stakeUnits) * numerator / denominator;
}
export function legacyCasinoReservation(state: LegacyCasinoState): bigint {
  if (!validLegacyCasinoState(state)) throw Error('Invalid historical casino state');
  if (state.state !== 'active') return 0n;
  const width = BigInt(columns(state.settings.difficulty));
  const numerator = state.gameId === 'github-hilo' ? 99n * 13n ** 2n : 99n * width ** 9n;
  const denominator = state.gameId === 'github-hilo' ? 100n : 100n * (width - 1n) ** 9n;
  return BigInt(state.stakeUnits) * ((numerator + denominator - 1n) / denominator);
}

/** No random draws or new operations are produced by historical replay. */
export function verifyLegacyCasinoTransition(before: LegacyCasinoState | undefined, value: unknown, after: LegacyCasinoState): boolean {
  if (!record(value) || !validLegacyCasinoState(after) || !uuid(value.id) || value.gameId !== after.gameId) return false;
  const op = value as LegacyCasinoAction;
  if (op.action === 'start') {
    return !before && fields(value, 'id,gameId,action,stakeUnits,settings') && op.id === after.id
      && op.stakeUnits === after.stakeUnits && same(op.settings, after.settings) && after.state === 'active' && after.choices.length === 0;
  }
  if (!before || !validLegacyCasinoState(before) || before.state !== 'active' || op.sessionId !== before.id
    || op.gameId !== before.gameId || after.id !== before.id) return false;
  const expected = structuredClone(before);
  if (op.action === 'cashout') {
    if (!fields(value, 'id,gameId,action,sessionId') || !before.choices.length) return false;
    expected.state = 'cashed_out';
  } else if (op.action === 'pick') {
    if (!fields(value, 'id,gameId,action,sessionId,choice')) return false;
    if (expected.gameId === 'github-tower') {
      if (!integer(op.choice, 0, columns(before.settings.difficulty) - 1)) return false;
      const choice = Number(op.choice), lost = before.dragons![before.choices.length] === choice;
      expected.choices.push(choice); expected.state = lost ? 'lost' : expected.choices.length === 9 ? 'cashed_out' : 'active';
    } else {
      const rank = before.cards[before.choices.length].rank, next = before.cards[before.choices.length + 1].rank;
      if (op.choice !== 'higher' && op.choice !== 'lower' || op.choice === 'higher' && rank === 13 || op.choice === 'lower' && rank === 1) return false;
      const won = op.choice === 'higher' ? next > rank : next < rank;
      expected.choices.push(op.choice); expected.state = !won ? 'lost' : expected.choices.length === 2 ? 'cashed_out' : 'active';
    }
  } else return false;
  return same(expected, after);
}

/** Only an internal retirement event may cash out an untouched Tower round. */
export function verifyLegacyCasinoRetirement(before: unknown, after: unknown): boolean {
  return isLegacyTowerState(before) && before.state === 'active' && validLegacyCasinoState(after)
    && same({ ...before, state: 'cashed_out' }, after);
}
