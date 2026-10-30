import { randomInt } from 'node:crypto';
import { HILO_MAX_GUESSES, validCasinoAction, type CasinoAction, type CasinoSession, type SessionGameId } from '../../src/shared/casinoSessions';
import { probabilityOf, stepMultiplier, withRtp } from './rush/hilo';

export type SessionState = {
  id: string; gameId: SessionGameId; rulesVersion: 1; state: CasinoSession['state']; stakeUnits: string;
  settings: Record<string, never>; choices: ('higher' | 'lower')[];
  cards: { rank: number; suit: number }[];
};
export function maxSessionMultiplier(_game: SessionGameId, _settings: SessionState['settings']): number {
  return Math.ceil(withRtp(13 ** HILO_MAX_GUESSES));
}
function ratio(s: SessionState): [bigint, bigint] {
  if (!s.choices.length) return [1n, 1n];
  if (s.state === 'lost') return [0n, 1n];
  let denominator = 100n;
  s.choices.forEach((choice, i) => { const rank = s.cards[i].rank; denominator *= BigInt(choice === 'higher' ? 13 - rank : rank - 1); });
  return [99n * 13n ** BigInt(s.choices.length), denominator];
}
export function sessionPayout(s: SessionState): bigint { const [n, d] = ratio(s); return BigInt(s.stakeUnits) * n / d; }
export function sessionReservation(s: SessionState): bigint { return s.state === 'active' ? BigInt(s.stakeUnits) * BigInt(maxSessionMultiplier(s.gameId, s.settings)) : 0n; }
export function publicSession(s: SessionState): CasinoSession {
  const [n,d] = ratio(s), multiplier = Number(n) / Number(d);
  const result: CasinoSession = { id:s.id,gameId:s.gameId,rulesVersion:1,state:s.state,stakeUnits:s.stakeUnits,
    multiplier,steps:s.choices.length,payoutUnits:sessionPayout(s).toString() };
  const rank=s.cards[s.choices.length].rank, raw=s.choices.length?Number(n)/Number(d)/.99:1;
  Object.assign(result,{cards:s.cards.slice(0,s.choices.length+1).map(c=>({...c})),next:s.state==='active'?{
    higher:probabilityOf('higher',rank)>0?withRtp(raw*stepMultiplier('higher',rank)):null,
    lower:probabilityOf('lower',rank)>0?withRtp(raw*stepMultiplier('lower',rank)):null,
  }:undefined});
  return result;
}
export function startSession(op: Extract<CasinoAction,{action:'start'}>, draw:(max:number)=>number = randomInt): SessionState {
  if (!validCasinoAction(op)) throw new Error('Invalid casino action');
  const checked=(n:number)=>{const v=draw(n);if(!Number.isInteger(v)||v<0||v>=n)throw new Error('Invalid casino randomness');return v;};
  return {id:op.id,gameId:op.gameId,rulesVersion:1,state:'active',stakeUnits:op.stakeUnits,settings:{...op.settings},choices:[],
    cards:Array.from({length:HILO_MAX_GUESSES+1},()=>({rank:checked(13)+1,suit:checked(4)}))};
}
export function advanceSession(before: SessionState, op: Exclude<CasinoAction,{action:'start'}>): SessionState {
  if (!validCasinoAction(op)) throw new Error('Invalid casino action');
  if(before.id!==op.sessionId||before.gameId!==op.gameId)throw new Error('Игра не найдена.');
  if(before.state!=='active')throw new Error('Эта партия уже завершена.');
  const s=structuredClone(before);
  if(op.action==='cashout') {if(!s.choices.length)throw new Error('Сделай хотя бы один ход перед выплатой.');s.state='cashed_out';return s;}
  const direction=op.choice,rank=s.cards[s.choices.length].rank;
  if(probabilityOf(direction,rank)===0)throw new Error('У этого направления нет выигрышных карт.');
  const next=s.cards[s.choices.length+1].rank,won=direction==='higher'?next>rank:next<rank;
  s.choices.push(direction);s.state=!won?'lost':s.choices.length===HILO_MAX_GUESSES?'cashed_out':'active';
  return s;
}
// Replay verifies the complete stored transition; unrevealed values stay server-side.
export function verifySessionTransition(before: SessionState | undefined, op: CasinoAction, after: SessionState): boolean {
  try {
    if(!validCasinoAction(op))return false;
    let expected:SessionState;
    if(op.action==='start') {
      if(before)return false;
      const values=after.cards.flatMap(c=>[c.rank-1,c.suit]);let index=0;
      expected=startSession(op,n=>{const value=values[index++];if(value===undefined||value>=n)throw Error();return value;});
      if(index!==values.length)return false;
    }else {if(!before)return false;expected=advanceSession(before,op);}
    return JSON.stringify(after)===JSON.stringify(expected);
  }catch{return false;}
}
