import type {ExpansionSession} from '../shared/casinoExpansion';

export type RaceAnchor={id:string;from:number;to:number;at:number};
export type RacePhase='idle'|'waiting'|'racing'|'escaped'|'crashed';
// Two polling intervals absorb ordinary reply jitter without predicting server time.
export const RACE_DISPLAY_BUFFER_MS=700;
/** Paid multipliers already contain exact hundredths serialized as a number. */
export function raceHundredths(value:number,paid=false){return paid?Math.round(value*100):Math.floor(value*100);}
export function validRaceTime(s:ExpansionSession){return Number.isFinite(s.serverNow)&&Number.isFinite(s.startedAt)&&Number.isFinite(s.multiplier)&&s.multiplier!>=1&&s.multiplier!<=100;}
/** Interpolate received time only. Animation must never predict an unreceived outcome. */
export function raceDisplay(s:ExpansionSession|undefined,a:RaceAnchor|undefined,now:number,_quiet=false){
 let time=0,value=1,phase:RacePhase='idle';
 if(s?.state==='active'&&validRaceTime(s)&&a?.id===s.id){
  time=Math.min(a.to,a.from+Math.max(0,now-a.at));
  phase=time<s.startedAt!?'waiting':'racing';
  value=Math.min(s.multiplier!,100,Math.exp(.06*Math.max(0,(time-s.startedAt!)/1000)));
 }else if(s?.state==='settled'){
  phase=s.returnedUnits==='0'?'crashed':'escaped';
  value=phase==='crashed'?s.crashAt??s.multiplier??1:s.multiplier??1;
 }
 const seconds=s?.state==='settled'?Math.log(Math.max(1,value))/.06:s?.startedAt?Math.max(0,(time-s.startedAt)/1000):0;
 return {time,value,hundredths:raceHundredths(value,phase==='escaped'),phase,seconds,countdown:s?.startedAt?Math.max(1,Math.ceil((s.startedAt-time)/1000)):0};
}

/** Rebase at the visible instant, preserving a constant clock across replies. */
export function raceAnchor(s:ExpansionSession,previous:RaceAnchor|undefined,now:number):RaceAnchor{
 if(previous?.id===s.id){
  if(s.serverNow!<=previous.to)return previous;
  const visible=raceDisplay(s,previous,now).time;
  // Reconnect to fresh confirmed time after an outage instead of retaining stale quotes.
  const from=s.serverNow!-visible>RACE_DISPLAY_BUFFER_MS*2?s.serverNow!-RACE_DISPLAY_BUFFER_MS:visible;
  return {id:s.id,from,to:s.serverNow!,at:Math.max(previous.at,now)};
 }
 // A new countdown starts at its confirmed instant; reserve the buffer before ticking.
 const countdown=s.serverNow!<s.startedAt!;
 return {id:s.id,from:countdown?s.serverNow!:s.serverNow!-RACE_DISPLAY_BUFFER_MS,to:s.serverNow!,at:now+(countdown?RACE_DISPLAY_BUFFER_MS:0)};
}
