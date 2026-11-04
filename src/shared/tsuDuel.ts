import { GAME_STAKE_CENTS, validGameStake } from './gameStakes';
import {exactAward,makeRoundPrecision} from './roundPrecision';
export const TSU_DUEL_STAKES = GAME_STAKE_CENTS.map(cents=>String(cents*10000));
export const validTsuDuelStake = (value:unknown):value is string => typeof value==='string' && /^\d+$/.test(value)
  && BigInt(value)%10000n===0n && validGameStake(String(BigInt(value)/10000n)) && TSU_DUEL_STAKES.includes(value);
export const TSU_DUEL_DEFAULT_STAKE='100000';
export const TSU_DUEL_SELECT_MS=30_000;
export const TSU_DUEL_BEAT_MS=800;
export const TSU_DUEL_CHANT=['Камень','Ножницы','Бумага','Раз','Два','Три'] as const;
export const TSU_DUEL_REVEAL_MS=1600;
export function tsuDuelPayout(stakeUnits:string){
  if(!validTsuDuelStake(stakeUnits))throw Error('Выбери ставку от 0,10 до 50 USDT.');
  const stake=BigInt(stakeUnits),pot=stake*2n;
  // Every common denomination has an exact integer-cent 95% pot return.
  const precision=makeRoundPrecision(exactAward((stake/10000n)*19n,10n),'0',()=>{throw Error('PvP payout must settle in exact cents');});
  const payout=BigInt(precision.creditedUnits)*10000n;
  return {potUnits:String(pot),payoutUnits:String(payout),feeUnits:String(pot-payout)};
}
