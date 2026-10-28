import type {ExpansionSession} from '../shared/casinoExpansion';

export type RaceAnchor={id:string;from:number;to:number;at:number;heardAt:number};
export type RacePhase='idle'|'waiting'|'racing'|'escaped'|'crashed';
// Presentation budget for delayed replies, not an extension of a cashout deadline.
export const RACE_CONNECTION_GRACE_MS=3000;
/** Paid multipliers already contain exact hundredths serialized as a number. */
export function raceHundredths(value:number,paid=false){return paid?Math.round(value*100):Math.floor(value*100);}
export function validRaceTime(s:ExpansionSession){return Number.isFinite(s.serverNow)&&Number.isFinite(s.startedAt)&&Number.isFinite(s.multiplier)&&s.multiplier!>=1&&s.multiplier!<=100;}
/** Project elapsed time between replies. Only a server settlement supplies an outcome. */
export function raceDisplay(s:ExpansionSession|undefined,a:RaceAnchor|undefined,now:number,_quiet=false){
 let time=0,value=1,phase:RacePhase='idle',stalled=false;
 if(s?.state==='active'&&validRaceTime(s)&&a?.id===s.id){
  stalled=now-a.heardAt>=RACE_CONNECTION_GRACE_MS;
  time=a.from+Math.max(0,Math.min(now,a.heardAt+RACE_CONNECTION_GRACE_MS)-a.at);
  phase=time<s.startedAt!?'waiting':'racing';
  value=Math.min(100,Math.exp(.06*Math.max(0,(time-s.startedAt!)/1000)));
 }else if(s?.state==='settled'){
  phase=s.returnedUnits==='0'?'crashed':'escaped';
  value=phase==='crashed'?s.crashAt??s.multiplier??1:s.multiplier??1;
 }
 const seconds=s?.state==='settled'?Math.log(Math.max(1,value))/.06:s?.startedAt?Math.max(0,(time-s.startedAt)/1000):0;
 return {time,value,hundredths:raceHundredths(value,phase==='escaped'),phase,seconds,stalled,countdown:s?.startedAt?Math.max(1,Math.ceil((s.startedAt-time)/1000)):0};
}

/** Replies renew freshness without stopping, accelerating or rewinding the visible clock. */
export function raceAnchor(s:ExpansionSession,previous:RaceAnchor|undefined,now:number):RaceAnchor{
 if(previous?.id===s.id){
  if(s.serverNow!<=previous.to)return previous;
  const display=raceDisplay(s,previous,now);
  // A recovered connection may skip stale time; ordinary replies never change the pace.
  const from=display.stalled?Math.max(display.time,s.serverNow!):display.time;
  return {id:s.id,from,to:s.serverNow!,at:Math.max(previous.at,now),heardAt:now};
 }
 return {id:s.id,from:s.serverNow!,to:s.serverNow!,at:now,heardAt:now};
}
