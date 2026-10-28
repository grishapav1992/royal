import {landingPose,SPIN_TIMING,type LandingPlan} from './SpinTimeline';
/** Contacts use the same zero-hop positions as the visual trajectory. */
export function rouletteContacts(plan:LandingPlan){
  const drop=.52*SPIN_TIMING.landing,join=SPIN_TIMING.join*SPIN_TIMING.landing,duration=SPIN_TIMING.landing;
  const times=[...Array.from({length:6},(_,i)=>drop+(join-drop)*i/6),join,join+(duration-join)/3,join+2*(duration-join)/3,duration];
  return times.map((ms,i)=>{const p=landingPose(plan,ms);return {ms,cue:i===times.length-1?'landing' as const:'tap' as const,gain:i===times.length-1?.43:.32*(1-i/(times.length+2)),pan:.28*Math.sin(p.ball*Math.PI/180)};});
}
export type AudioClock={currentTime:number;outputLatency?:number;baseLatency?:number;getOutputTimestamp?:()=>{contextTime?:number;performanceTime?:number}};
export function rouletteClock(clock:AudioClock,now:number){
  try{const stamp=clock.getOutputTimestamp?.();if(stamp&&typeof stamp.performanceTime==='number'&&stamp.performanceTime>0&&typeof stamp.contextTime==='number'&&Number.isFinite(stamp.contextTime)&&Math.abs(now-stamp.performanceTime)<5000&&clock.currentTime-stamp.contextTime>=-.02&&clock.currentTime-stamp.contextTime<.8){
    return{method:'output-timestamp',contextTime:stamp.contextTime,performanceTime:stamp.performanceTime,leadMs:Math.max(0,(clock.currentTime-stamp.contextTime)*1000)};
  }}catch{}
  const lag=Math.max(0,(clock.outputLatency??.02)+(clock.baseLatency??0));
  return{method:'latency-estimate',contextTime:clock.currentTime,performanceTime:now+lag*1000,leadMs:lag*1000};
}
export function rouletteAudioTime(clock:AudioClock,now:number,targetPeak:number,peakOffset:number){
  const mapping=rouletteClock(clock,now),desired=mapping.contextTime+(targetPeak-mapping.performanceTime)/1000-peakOffset;
  const at=Math.max(clock.currentTime+.004,desired),audiblePeak=mapping.performanceTime+(at+peakOffset-mapping.contextTime)*1000;
  return{at,audiblePeak,errorMs:audiblePeak-targetPeak,method:mapping.method};
}
