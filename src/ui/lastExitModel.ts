import type {ExpansionSession} from '../shared/casinoExpansion';

export type RaceAnchor={id:string;from:number;to:number;at:number};
export type RacePhase='idle'|'waiting'|'racing'|'escaped'|'crashed';
/** Paid multipliers already contain exact hundredths serialized as a number. */
export function raceHundredths(value:number,paid=false){return paid?Math.round(value*100):Math.floor(value*100);}
export function validRaceTime(s:ExpansionSession){return Number.isFinite(s.serverNow)&&Number.isFinite(s.startedAt)&&Number.isFinite(s.multiplier)&&s.multiplier!>=1&&s.multiplier!<=100;}
/** Interpolate received time only. Animation must never predict an unreceived outcome. */
export function raceDisplay(s:ExpansionSession|undefined,a:RaceAnchor|undefined,now:number,quiet=false){
 let time=0,value=1,phase:RacePhase='idle';
 if(s?.state==='active'&&validRaceTime(s)&&a?.id===s.id){
  const fraction=quiet?1:Math.max(0,Math.min(1,(now-a.at)/320));
  time=Math.min(a.to,a.from+(a.to-a.from)*fraction);
  phase=time<s.startedAt!?'waiting':'racing';
  value=Math.min(s.multiplier!,100,Math.exp(.06*Math.max(0,(time-s.startedAt!)/1000)));
 }else if(s?.state==='settled'){
  phase=s.returnedUnits==='0'?'crashed':'escaped';
  value=phase==='crashed'?s.crashAt??s.multiplier??1:s.multiplier??1;
 }
 const seconds=s?.state==='settled'?Math.log(Math.max(1,value))/.06:s?.startedAt?Math.max(0,(time-s.startedAt)/1000):0;
 return {time,value,hundredths:raceHundredths(value,phase==='escaped'),phase,seconds,countdown:s?.startedAt?Math.max(1,Math.ceil((s.startedAt-time)/1000)):0};
}
