import data from './floodedTempleCascadeData.json';

function freeze<T>(v:T):T{if(v&&typeof v==='object'){for(const x of Object.values(v))freeze(x);Object.freeze(v);}return v;}
export const CASCADE_DATA=freeze(data);
export const CASCADE_WILD=7,CASCADE_BONUS=8,CASCADE_CAP_POINTS=data.maxWin*data.paylines.length;
export type CascadeDraw=(maximum:number)=>number;
export type CascadeMode='base'|'free';
export type CascadeNext='initial'|'collapse'|'free-spin'|'resume-base'|'done';
export type CascadeLine={line:number;symbol:number;count:number;points:number;cells:number[]};
export type CascadeFrame={fall:number;mode:CascadeMode;grid:number[];multiplier:number;wins:CascadeLine[];bonusLines:number[];addedFreeSpins:number;remainingFreeSpins:number;playedFreeSpins:number;removeMask:number;rawPoints:number;awardedPoints:number;totalPoints:number;capped:boolean};
export type CascadeState={mode:CascadeMode;grid:number[];cascade:number;remainingFreeSpins:number;playedFreeSpins:number;totalPoints:number;falls:number;removeMask:number;next:CascadeNext;parent:{grid:number[];removeMask:number;cascade:number}|null;bonusLines:number;awardedFreeSpins:number};
const cells=data.paylines.map(rows=>rows.map((row,column)=>column*3+row));
export const CASCADE_REELS={base:data.baseReels.map(bag=>Uint8Array.from(bag.flatMap((weight,symbol)=>Array(weight).fill(symbol)))),free:data.freeReels.map(bag=>Uint8Array.from(bag.flatMap((weight,symbol)=>Array(weight).fill(symbol))))};
export function initialCascadeState():CascadeState{return {mode:'base',grid:Array(15).fill(0),cascade:0,remainingFreeSpins:0,playedFreeSpins:0,totalPoints:0,falls:0,removeMask:0,next:'initial',parent:null,bonusLines:0,awardedFreeSpins:0};}
export function scoreCascadeGrid(grid:readonly number[],details=true){
  let points=0,removeMask=0,bonusCount=0;
  const wins:CascadeLine[]=[],bonusLines:number[]=[];
  for(let line=0;line<cells.length;line++){
    const at=cells[line],symbol=grid[at[0]];
    if(symbol===CASCADE_BONUS){
      if((grid[at[1]]===CASCADE_BONUS||grid[at[1]]===CASCADE_WILD)&&(grid[at[2]]===CASCADE_BONUS||grid[at[2]]===CASCADE_WILD)){
        bonusCount++;removeMask|=(1<<at[0])|(1<<at[1])|(1<<at[2]);if(details)bonusLines.push(line);
      }
    }else if(symbol>=0&&symbol<7){
      let count=1;while(count<5&&(grid[at[count]]===symbol||grid[at[count]]===CASCADE_WILD))count++;
      if(count>=3){const value=data.paytable[symbol][count-3];points+=value;for(let i=0;i<count;i++)removeMask|=1<<at[i];if(details)wins.push({line,symbol,count,points:value,cells:at.slice(0,count)});}
    }
  }
  return {points,removeMask,bonusCount,wins,bonusLines};
}
/** Mutates only a private round state. Points are integer multiples of the line stake. */
export function advanceCascade(state:CascadeState,draw:CascadeDraw,details=true):CascadeFrame|undefined{
  if(state.next==='done')throw Error('Cascade round already complete');
  let mask=state.removeMask;
  if(state.next==='initial'){mask=32767;state.mode='base';state.cascade=0;}
  else if(state.next==='free-spin'){
    if(state.remainingFreeSpins<=0)throw Error('No free spins');
    state.mode='free';state.remainingFreeSpins--;state.playedFreeSpins++;state.cascade=0;mask=32767;
  }else if(state.next==='resume-base'){
    if(!state.parent)throw Error('Missing saved base chain');
    state.mode='base';state.grid=state.parent.grid;mask=state.parent.removeMask;state.cascade=state.parent.cascade;state.parent=null;
  }else state.cascade++;
  const reels=CASCADE_REELS[state.mode];
  for(let column=0;column<5;column++){
    const start=column*3;let destination=start+2;
    for(let source=start+2;source>=start;source--)if(!(mask&(1<<source)))state.grid[destination--]=state.grid[source];
    while(destination>=start){const ticket=draw(reels[column].length);if(!Number.isSafeInteger(ticket)||ticket<0||ticket>=reels[column].length)throw Error('Invalid cascade entropy');state.grid[destination--]=reels[column][ticket];}
  }
  const scored=scoreCascadeGrid(state.grid,details),levels=state.mode==='free'?data.freeMultipliers:data.baseMultipliers;
  const multiplier=levels[Math.min(state.cascade,levels.length-1)],rawPoints=scored.points*multiplier;
  const awardedPoints=Math.min(rawPoints,CASCADE_CAP_POINTS-state.totalPoints);state.totalPoints+=awardedPoints;state.falls++;state.removeMask=scored.removeMask;
  const added=scored.bonusCount*data.freeSpinsPerLine;state.remainingFreeSpins+=added;state.awardedFreeSpins+=added;state.bonusLines+=scored.bonusCount;
  const capped=state.totalPoints===CASCADE_CAP_POINTS;
  if(capped){state.next='done';state.remainingFreeSpins=0;state.parent=null;}
  else if(state.mode==='base'&&added){state.parent={grid:state.grid.slice(),removeMask:state.removeMask,cascade:state.cascade+1};state.next='free-spin';}
  else if(scored.removeMask)state.next='collapse';
  else if(state.mode==='base')state.next='done';
  else state.next=state.remainingFreeSpins?'free-spin':'resume-base';
  return details?{fall:state.falls,mode:state.mode,grid:state.grid.slice(),multiplier,wins:scored.wins,bonusLines:scored.bonusLines,addedFreeSpins:added,remainingFreeSpins:state.remainingFreeSpins,playedFreeSpins:state.playedFreeSpins,removeMask:scored.removeMask,rawPoints,awardedPoints,totalPoints:state.totalPoints,capped}:undefined;
}
export function simulateCascadeRound(draw:CascadeDraw){const state=initialCascadeState();while(state.next!=='done')advanceCascade(state,draw,false);return state;}
