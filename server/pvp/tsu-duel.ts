import { createTsuEFa, playTsuEFa, publicTsuEFa, type TsuEFaState } from './tsu-e-fa';
import { isTsuEFaChoice, type TsuEFaView } from '../../src/shared/tsuEFa';
import { TSU_DUEL_SELECT_MS, TSU_DUEL_BEAT_MS, TSU_DUEL_CHANT, TSU_DUEL_REVEAL_MS } from '../../src/shared/tsuDuel';
export type TsuDuelState=TsuEFaState & {rulesVersion:3;stage:'select'|'countdown'|'reveal';startsAt:number;endsAt:number};
export function createTsuDuel(now:number):TsuDuelState {
  return {...createTsuEFa(3,2),rulesVersion:3,stage:'select',startsAt:now,endsAt:now+TSU_DUEL_SELECT_MS};
}
export function lockTsuDuel(state:TsuDuelState,side:0|1,value:unknown,now:number):TsuDuelState {
  const move=value as Record<string,unknown>|null;
  if(state.phase!=='playing'||state.stage!=='select'||now>=state.endsAt||!move||Array.isArray(move)
    ||Object.keys(move).sort().join(',')!=='choice,kind,round'||move.kind!=='choose'||move.round!==state.round
    ||!isTsuEFaChoice(move.choice)||state.choices[side]!==null)throw Error('Этот выбор недоступен.');
  const next=structuredClone(state);next.choices[side]=move.choice;next.revision++;
  if(next.choices.every(c=>c!==null)){next.stage='countdown';next.startsAt=now;next.endsAt=now+(TSU_DUEL_CHANT.length-1)*TSU_DUEL_BEAT_MS;}
  return next;
}
export function advanceTsuDuel(state:TsuDuelState,now:number):TsuDuelState {
  if(state.phase!=='playing'||now<state.endsAt)return state;
  if(state.stage==='select')return state; // The match store adjudicates missing choices.
  if(state.stage==='reveal')return {...state,stage:'select',startsAt:now,endsAt:now+TSU_DUEL_SELECT_MS,revision:state.revision+1};
  // Use the historically qualified signs and scoring, but reveal only on the server's final beat.
  let resolved=createTsuEFa(3,2);resolved.score=[...state.score];resolved.round=state.round;resolved.revision=state.revision;
  for(const side of [0,1] as const)resolved=playTsuEFa(resolved,side,{kind:'choose',round:state.round,choice:state.choices[side]});
  return {...resolved,rulesVersion:3,stage:'reveal',startsAt:now,endsAt:now+TSU_DUEL_REVEAL_MS};
}
export function publicTsuDuel(state:TsuDuelState,side:0|1,paused:boolean):TsuEFaView {
  return {...publicTsuEFa(state,side),duel:{stage:state.stage,startsAt:state.startsAt,endsAt:state.endsAt,paused}};
}
