/** Stage-one candidate only. No runnable module, transport, RNG or wallet is registered. */
import data from './wildNudgeData.json';

function freezeParameters(value:unknown):void {
  if(!value||typeof value!=='object'||Object.isFrozen(value))return;
  Object.freeze(value);for(const child of Object.values(value))freezeParameters(child);
}
freezeParameters(data);

export const WILD_NUDGE_GAME = 'studio-wild-nudge' as const;
export const WILD_NUDGE_RULES_VERSION = 1;
export const WILD_NUDGE_PROGRESS_VERSION = 1;
export const WILD_NUDGE_STAKES = ['100','200','500','1000','2000','5000'] as const;
export type WildNudgeMode = 'base' | 'bonus';
export type WildNudgeRandom = (exclusiveMaximum:number)=>number;
export const WILD = 6, SCATTER = 7;
export const WILD_NUDGE_DATA = data;
export interface NudgeReel {
  stop:number; finalStop:number; before:number[]; after:number[];
  direction:-1|0|1; steps:number; multiplier:number;
  path:{stop:number; cells:number[]; multiplier:number}[];
}
export interface NudgeLineWin {line:number;symbol:number;count:number;multiplier:number;points:number}
export interface NudgeSpin {
  mode:WildNudgeMode; reels:NudgeReel[]; before:number[]; grid:number[];
  wins:NudgeLineWin[]; points:number; scatterReels:number[]; awardedSpins:number;
}
const requireValue=(condition:unknown,message:string):void=>{if(!condition)throw new Error(message);};
const validMode=(mode:unknown):mode is WildNudgeMode=>mode==='base'||mode==='bonus';
const index=(value:number,length:number)=>(value%length+length)%length;
const cells=(strip:readonly number[],stop:number)=>Array.from({length:data.rows},(_,i)=>strip[index(stop+i,strip.length)]);
const validCells=(grid:unknown):grid is number[]=>Array.isArray(grid)&&grid.length===data.columns*data.rows&&grid.every(n=>Number.isInteger(n)&&n>=0&&n<=SCATTER);

/** The stack anchor is found on the cyclic strip, never guessed from the visible fragment. */
export function wildNudgeReel(column:number,stop:number,mode:WildNudgeMode):NudgeReel {
  requireValue(validMode(mode),'Invalid mode');
  requireValue(Number.isInteger(column)&&column>=0&&column<data.columns,'Invalid reel');
  const strip=data.reels[column];
  requireValue(Number.isInteger(stop)&&stop>=0&&stop<strip.length,'Invalid stop');
  const before=cells(strip,stop),increment=mode==='base'?data.baseIncrement:data.bonusIncrement;
  let shift=0;
  if(before.includes(WILD)){
    const candidates:number[]=[];
    for(let delta=-(data.rows-1);delta<data.rows;delta++)if(cells(strip,stop+delta).every(n=>n===WILD))candidates.push(delta);
    requireValue(candidates.length===1,'Ambiguous or broken WILD stack');shift=candidates[0];
  }
  const direction=Math.sign(shift) as -1|0|1,steps=Math.abs(shift);
  const path=Array.from({length:steps+1},(_,i)=>({stop:index(stop+direction*i,strip.length),cells:cells(strip,stop+direction*i),multiplier:1+increment*i}));
  return {stop,finalStop:index(stop+shift,strip.length),before,after:path.at(-1)!.cells.slice(),direction,steps,multiplier:1+increment*steps,path};
}

/** Highest eligible left-starting combination pays once. WILD increments add, never multiply. */
export function scoreWildNudgeLine(symbols:readonly number[],multipliers:readonly number[]):Omit<NudgeLineWin,'line'>|null {
  requireValue(symbols.length===data.columns&&symbols.every(n=>Number.isInteger(n)&&n>=0&&n<=SCATTER),'Invalid line');
  requireValue(multipliers.length===data.columns&&multipliers.every(n=>Number.isInteger(n)&&n>=1&&n<=1+data.bonusIncrement*(data.rows-1)),'Invalid WILD multiplier');
  let best:Omit<NudgeLineWin,'line'>|null=null;
  for(let symbol=0;symbol<WILD;symbol++){
    let count=0,multiplier=1;
    while(count<data.columns&&(symbols[count]===symbol||symbols[count]===WILD)){
      if(symbols[count]===WILD)multiplier+=multipliers[count]-1;
      count++;
    }
    if(count<3)continue;
    const points=data.paytable[symbol][count-3]*multiplier;
    if(!best||points>best.points||points===best.points&&count>best.count)best={symbol,count,multiplier,points};
  }
  return best;
}
export function scoreWildNudgeGrid(grid:number[],multipliers:number[]):NudgeLineWin[] {
  requireValue(validCells(grid),'Invalid grid');
  const wins:NudgeLineWin[]=[];
  for(const [line,rows]of data.lines.entries()){
    const result=scoreWildNudgeLine(rows.map((row,column)=>grid[row*data.columns+column]),multipliers);
    if(result)wins.push({line,...result});
  }
  return wins;
}
export function wildNudgeSpin(stops:readonly number[],mode:WildNudgeMode):NudgeSpin {
  requireValue(validMode(mode),'Invalid mode');requireValue(stops.length===data.columns,'Five stops required');
  const reels=stops.map((stop,column)=>wildNudgeReel(column,stop,mode));
  const before=Array.from({length:data.columns*data.rows},(_,i)=>reels[i%data.columns].before[Math.floor(i/data.columns)]);
  const grid=Array.from({length:before.length},(_,i)=>reels[i%data.columns].after[Math.floor(i/data.columns)]);
  const wins=scoreWildNudgeGrid(grid,reels.map(reel=>reel.multiplier));
  const scatterReels=reels.flatMap((reel,column)=>reel.after.includes(SCATTER)?[column]:[]);
  return {mode,reels,before,grid,wins,points:wins.reduce((n,win)=>n+win.points,0),scatterReels,
    awardedSpins:mode==='base'&&scatterReels.length>=data.scatterTrigger?data.bonusSpins:0};
}
export function drawWildNudgeSpin(mode:WildNudgeMode,random:WildNudgeRandom):NudgeSpin {
  requireValue(validMode(mode),'Invalid mode');
  const stops=data.reels.map(strip=>{const stop=random(strip.length);requireValue(Number.isInteger(stop)&&stop>=0&&stop<strip.length,'RNG returned an invalid stop');return stop;});
  return wildNudgeSpin(stops,mode);
}
export function settleWildNudgePoints(points:number,stakeUnits:string):string {
  requireValue(WILD_NUDGE_STAKES.some(stake=>stake===stakeUnits),'Unsupported total stake');
  requireValue(Number.isSafeInteger(points)&&points>=0&&points<=wildNudgePointBound('bonus'),'Invalid spin points');
  const numerator=BigInt(stakeUnits)*BigInt(points),denominator=BigInt(data.lines.length*data.payDenominator);
  requireValue(numerator%denominator===0n,'Non-integral settlement');
  return String(numerator/denominator);
}
export function wildNudgePointBound(mode:WildNudgeMode):number {
  requireValue(validMode(mode),'Invalid mode');
  const increment=mode==='base'?data.baseIncrement:data.bonusIncrement;
  return data.lines.length*Math.max(...data.paytable.flat())*(1+data.columns*increment*(data.rows-1));
}
export function wildNudgeRound(input:{stakeUnits:string;baseStops:readonly number[];bonusStops:readonly (readonly number[])[]}) {
  const base=wildNudgeSpin(input.baseStops,'base');
  requireValue(input.bonusStops.length===base.awardedSpins,'A complete round requires exactly the awarded free spins');
  const bonus=input.bonusStops.map(stops=>wildNudgeSpin(stops,'bonus'));
  const amounts=[base,...bonus].map(spin=>settleWildNudgePoints(spin.points,input.stakeUnits));
  return {rulesVersion:WILD_NUDGE_RULES_VERSION,progressVersion:WILD_NUDGE_PROGRESS_VERSION,
    costUnits:input.stakeUnits,base,bonus,payoutUnits:String(amounts.reduce((total,n)=>total+BigInt(n),0n))};
}
