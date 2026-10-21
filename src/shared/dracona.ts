import { playSpin, SIZE, MAX_BONUS_SPINS, type SpinResult } from './draconaMath';

export const DRACONA_GAME = 'studio-dracona' as const;
export const DRACONA_CLIENT_HEADER = 'X-Royal-Dracona-Rules';
export const DRACONA_BETS = [10, 20, 50, 100, 200, 500] as const;
export const DRACONA_MAX_WIN = 100000;
export type DraconaSettings = { dracona: { mode: 'normal' } };
export type DraconaSpin = { draws: number[]; result: SpinResult };
export type DraconaView = {
  kind: 'dracona'; version: 1; revision: number; history: DraconaSpin[];
  totalPayoutUnits: string; bonusAwarded: number; freePlayed: number; remaining: number;
};
export type DraconaResult = {
  view: DraconaView; ended: boolean; credit: number; message: string;
  actions: { move: 'dracona-spin'; label: string; cost: 0 }[];
};
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: object, names: string) => Object.keys(value).sort().join(',') === names.split(',').sort().join(',');
const integer = (value: unknown, min: number, max: number): value is number => Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
export const draconaSame = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export const validDraconaStake = (value: unknown): value is string => typeof value === 'string' && DRACONA_BETS.some(bet => String(bet * 100) === value);
export function validDraconaSettings(value: unknown): value is DraconaSettings {
  return object(value) && keys(value, 'dracona') && object(value.dracona) && keys(value.dracona, 'mode') && value.dracona.mode === 'normal';
}

/** Replaying only past entropy validates every displayed frame and payout. */
export function validDraconaView(stake: string, value: unknown): value is DraconaView {
  try {
    if (!validDraconaStake(stake) || !object(value) || !keys(value, 'kind,version,revision,history,totalPayoutUnits,bonusAwarded,freePlayed,remaining')
      || value.kind !== 'dracona' || value.version !== 1 || !Array.isArray(value.history) || !integer(value.revision, 1, 21)
      || value.history.length !== value.revision) return false;
    let remaining = 0, awarded = 0, played = 0, payout = 0, runes = Array(SIZE).fill(1) as number[];
    for (const [index, spin] of value.history.entries()) {
      if (!object(spin) || !keys(spin, 'draws,result') || !Array.isArray(spin.draws) || spin.draws.length > 512
        || !spin.draws.every((draw: unknown) => integer(draw, 0, 4294967295)) || (index > 0 && remaining === 0)) return false;
      let cursor = 0;
      const result = playSpin({ bet: Number(stake) / 100, bonus: index > 0, runes, bonusIssued: awarded, random: () => {
        if (cursor >= spin.draws.length) throw Error('Missing entropy');
        return spin.draws[cursor++] / 4294967296;
      } });
      if (cursor !== spin.draws.length || !draconaSame(result, spin.result)) return false;
      if (index > 0) { remaining--; played++; }
      remaining += result.bonusAward; awarded += result.bonusAward; payout += result.payout * 100; runes = result.runes;
    }
    return awarded <= MAX_BONUS_SPINS && value.remaining === remaining && value.bonusAwarded === awarded && value.freePlayed === played
      && value.totalPayoutUnits === String(payout) && Number.isSafeInteger(payout) && payout <= Number(stake) * DRACONA_MAX_WIN;
  } catch { return false; }
}

export function validDraconaSettlement(state: 'active' | 'settled', stake: string, spent: string, returned: string, value: unknown): value is DraconaView {
  return validDraconaView(stake, value) && spent === stake && (state === 'active' ? value.remaining > 0 && returned === '0' : state === 'settled' && value.remaining === 0 && returned === value.totalPayoutUnits);
}

export function validDraconaEnvelope(state: 'active' | 'settled', value: unknown): boolean {
  if (!object(value) || !keys(value, 'player,dealer,community,actions,phase,ended,message,dracona') || !object(value.dracona)) return false;
  const expected = state === 'active' ? [{ move: 'dracona-spin', label: 'Бесплатное вращение', cost: 0 }] : [];
  return [value.player, value.dealer, value.community].every(list => Array.isArray(list) && list.length === 0)
    && value.phase === value.dracona.revision + 1 && value.ended === (state === 'settled') && typeof value.message === 'string' && draconaSame(value.actions, expected);
}

export function validDraconaSession(value: unknown): boolean {
  if (!object(value) || !keys(value, 'id,gameId,rulesVersion,state,stakeUnits,spentUnits,returnedUnits,view') || value.gameId !== DRACONA_GAME
    || value.rulesVersion !== 2 || typeof value.id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value.id)
    || !['active', 'settled'].includes(value.state) || !object(value.view)) return false;
  return validDraconaSettlement(value.state, value.stakeUnits, value.spentUnits, value.returnedUnits, value.view.dracona) && validDraconaEnvelope(value.state, value.view);
}

export const DRACONA_RULES = 'Поле 5 × 4. Группы от пяти соседних символов дают выплату и каскад, до восьми за спин. Исчезающий шкаф обменивает блок 2 × 2 с резервом, до трех переносов. Три герба на одном показе поля открывают восемь бесплатных вращений. В бонусе перенос гарантирован, руны его клеток сохраняются и растут от ×2 до ×5. Применяется наибольшая руна группы. Повторные три герба добавляют два вращения, максимум 20 за бонус. В 45% бесплатных вращений резерв состоит из четырех одинаковых символов. Одна ставка, выплата всей серии после завершения бонуса в общий тестовый кошелек.';
