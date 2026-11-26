import {advanceCascade,initialCascadeState,type CascadeFrame} from '../../../../src/shared/floodedTempleCascadeMath';
import {cascadeUnits} from '../../../../src/shared/floodedTempleCascade';
export type Round={frames:CascadeFrame[];points:number};
export const xor=(seed:number)=>{let s=seed>>>0||1;return(m:number)=>{s^=s<<13;s^=s>>>17;s^=s<<5;return(s>>>0)%m;};};
/** A whole paid round of the unchanged rules. The published game takes the same frames from the server. */
export function playRound(draw:(m:number)=>number):Round{const st=initialCascadeState(),frames:CascadeFrame[]=[];while(st.next!=='done')frames.push(advanceCascade(st,draw,true)!);return{frames,points:st.totalPoints};}
export const pay=(points:number,stake:number)=>Number(cascadeUnits(points,String(stake)));
export type Outcome='loss'|'partial'|'return'|'win'|'big'|'huge';
export const outcome=(stake:number,p:number):Outcome=>p===0?'loss':p<stake?'partial':p===stake?'return':p>=stake*25?'huge':p>=stake*5?'big':'win';
