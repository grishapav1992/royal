import { randomInt } from 'node:crypto';
import { playSpin, SIZE } from '../../src/shared/draconaMath';
import { validDraconaSettings, validDraconaStake, validDraconaSettlement, type DraconaSettings, type DraconaView, type DraconaResult } from '../../src/shared/dracona';

export class DraconaMoveError extends Error {}
type Draw = (max: number) => number;

function next(value: DraconaView, stake: string, draw: Draw): DraconaResult {
  const view = structuredClone(value);
  const free = view.revision > 0;
  if (free && view.remaining === 0) throw new DraconaMoveError('Бонус уже завершен.');
  const draws: number[] = [];
  const result = playSpin({ bet: Number(stake) / 100, bonus: free, runes: view.history.at(-1)?.result.runes ?? Array(SIZE).fill(1), bonusIssued: view.bonusAwarded, random: () => {
    const value = draw(4294967296);
    if (!Number.isSafeInteger(value) || value < 0 || value >= 4294967296 || draws.length >= 512) throw Error('Invalid Dracona entropy');
    draws.push(value); return value / 4294967296;
  } });
  if (free) { view.remaining--; view.freePlayed++; }
  view.remaining += result.bonusAward;
  view.bonusAwarded += result.bonusAward;
  view.history.push({ draws, result });
  view.revision++;
  view.totalPayoutUnits = String(BigInt(view.totalPayoutUnits) + BigInt(result.payout) * 100n);
  const ended = view.remaining === 0, credit = ended ? Number(view.totalPayoutUnits) : 0;
  if (!validDraconaSettlement(ended ? 'settled' : 'active', stake, stake, String(credit), view)) throw Error('Invalid Dracona settlement');
  return { view, ended, credit, message: ended ? 'Раунд завершен. Выплата начислена в общий тестовый кошелек.' : 'Бонус сохранен. Продолжение без новой ставки.', actions: ended ? [] : [{ move: 'dracona-spin', label: 'Бесплатное вращение', cost: 0 }] };
}

export function startDracona(settings: DraconaSettings, stake: string, draw: Draw = randomInt): DraconaResult {
  if (!validDraconaSettings(settings) || !validDraconaStake(stake)) throw new DraconaMoveError('Недопустимая ставка или режим Драконы.');
  return next({ kind: 'dracona', version: 1, revision: 0, history: [], totalPayoutUnits: '0', bonusAwarded: 0, freePlayed: 0, remaining: 0 }, stake, draw);
}

export function moveDracona(view: DraconaView, stake: string, revision: unknown, draw: Draw = randomInt): DraconaResult {
  if (!view || revision !== view.revision || !validDraconaSettlement('active', stake, stake, '0', view)) throw new DraconaMoveError('Бонус уже изменился. Покажи сохраненный ход.');
  return next(view, stake, draw);
}
