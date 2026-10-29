import {CASCADE_DATA,type CascadeFrame} from '../../src/shared/floodedTempleCascadeMath';
import type {TempleCascadeView} from '../../src/shared/floodedTempleCascade';
import type {TempleCue} from './TempleAudio';
import {templeOutcome,type TempleOutcome} from './presentation';
import type {CharacterBeat} from './character';

export type CascadeMove={cell:number;from:number|null;rows:number};
export type CascadeSource={grid:number[];removeMask:number};
export type CascadeBeat={id:number;at:number;duration:number;kind:'drop'|'evaluate'|'break'|'bonus'|'base-return'|'outcome'|'summary';frame:CascadeFrame;grid?:number[];removeMask?:number;fromPoints:number;toPoints:number;moves:CascadeMove[];cue?:TempleCue;accentMs:number;outcome?:TempleOutcome};
export type CascadePlan={key:string;beats:CascadeBeat[];duration:number;final:CascadeFrame;quick:boolean;reduced:boolean};
const fullMoves=():CascadeMove[]=>Array.from({length:15},(_,cell)=>({cell,from:null,rows:cell%3+3}));

/** The source is a confirmed grid. New symbols are read from the next confirmed frame. */
export function cascadeMoves(source:CascadeSource|undefined,grid:readonly number[]):CascadeMove[]{
  if(!source)return fullMoves();
  const moves:CascadeMove[]=[];
  for(let c=0;c<5;c++){
    let destination=c*3+2;
    for(let row=2;row>=0;row--){const from=c*3+row;if(source.removeMask&(1<<from))continue;
      if(source.grid[from]!==grid[destination])throw Error('Confirmed cascade survivor mismatch');
      moves.push({cell:destination,from,rows:destination-from});destination--;
    }
    const vacancies=destination-c*3+1;
    while(destination>=c*3){moves.push({cell:destination,from:null,rows:vacancies});destination--;}
  }
  return moves.sort((a,b)=>a.cell-b.cell);
}
export const cascadeLandMs=(cell:number)=>260+Math.floor(cell/3)*18+(cell%3)*8;
export const cascadeCounter=(beat:CascadeBeat,elapsed:number)=>beat.fromPoints+Math.floor((beat.toPoints-beat.fromPoints)*Math.min(1,Math.max(0,elapsed/Math.min(320,beat.duration))));

/** Pure presentation plan. No random draws, wallet writes or server continuation here. */
export function cascadePlan(key:string,view:TempleCascadeView,previous?:TempleCascadeView,quick=false,reduced=false):CascadePlan{
  const final=view.frames.at(-1)!;if(!final)throw Error('No confirmed cascade frames');
  const beats:CascadeBeat[]=[];let at=0,points=previous?.state.totalPoints??0;
  const add=(kind:CascadeBeat['kind'],duration:number,frame:CascadeFrame,extra:Partial<CascadeBeat>={})=>{
    beats.push({id:beats.length,at,duration,kind,frame,fromPoints:points,toPoints:points,moves:[],accentMs:0,...extra});at+=duration;
  };
  const outcome=view.phase==='complete'?templeOutcome(view.stakeUnits,view.totalPayoutUnits):undefined;
  const resultCue:TempleCue|undefined=outcome?outcome==='partial'||outcome==='loss'?'neutral':outcome:undefined;
  if(quick||reduced){
    add('summary',reduced?100:outcome==='big'?520:outcome==='win'?360:180,final,{fromPoints:final.totalPoints,toPoints:final.totalPoints,outcome,cue:resultCue,accentMs:reduced?40:100});
    return {key,beats,duration:at,final,quick,reduced};
  }
  let prior=previous?.frames.at(-1),base:CascadeSource|undefined=previous?.state.parent??undefined;
  for(const frame of view.frames){
    let source:CascadeSource|undefined;
    if(prior?.mode==='base'&&frame.mode==='free')base=prior;
    else if(prior?.mode==='free'&&frame.mode==='base'){
      source=base;base=undefined;add('base-return',420,frame,{grid:source?.grid,removeMask:0,cue:'cascadeReturn',accentMs:180});
    }else if(prior?.removeMask)source=prior;
    if(source?.removeMask){
      add('break',260,frame,{grid:source.grid,removeMask:source.removeMask,cue:frame.fall%2?'cascadeBreakA':'cascadeBreakB',accentMs:75});
    }
    const moves=cascadeMoves(source,frame.grid);
    add('drop',440,frame,{moves,cue:(['cascadeLandA','cascadeLandB','cascadeLandC']as const)[frame.fall%3],accentMs:Math.max(...moves.filter(m=>m.rows>0).map(m=>cascadeLandMs(m.cell)))});
    add('evaluate',frame.removeMask?340:120,frame,{toPoints:frame.totalPoints});points=frame.totalPoints;
    if(frame.addedFreeSpins&&!frame.capped)add('bonus',800,frame,{cue:'cascadeBonus',accentMs:260});
    prior=frame;
  }
  if(outcome)add('outcome',outcome==='big'?1600:outcome==='win'?1050:430,final,{outcome,cue:resultCue,accentMs:180});
  return {key,beats,duration:at,final,quick,reduced};
}

export function cascadeCharacter(beat:CascadeBeat):CharacterBeat{
  return {id:beat.id,duration:beat.duration,kind:beat.kind==='drop'?'fall':beat.kind==='break'?'fracture':beat.kind==='bonus'?'relic':beat.kind==='base-return'?'base-return':beat.kind==='evaluate'?(beat.frame.awardedPoints?'collect':'card'):beat.kind,
    outcome:beat.outcome,variant:beat.frame.fall%3,multiplier:beat.frame.multiplier};
}
export const cascadeLines=(frame:CascadeFrame)=>frame.wins.slice().sort((a,b)=>b.points-a.points).slice(0,3).map(win=>CASCADE_DATA.paylines[win.line]);
