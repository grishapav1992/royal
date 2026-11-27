import type {LandingPlan} from './SpinTimeline';
/** Contacts come from the same simulated impacts that move the visible ball. */
export function rouletteContacts(plan:LandingPlan){
  const scale={diamond:.32/900,fret:.27/650,floor:.13/500,wall:.1/600,rest:0} as const;
  const hits=plan.contacts.filter(c=>c.kind!=='rest').map(c=>({ms:c.t*1000,cue:'tap' as const,gain:Math.min(.34,Math.max(.035,c.strength*scale[c.kind])),pan:.28*Math.sin(c.angle)}));
  const strongest=new Set([...hits].sort((a,b)=>b.gain-a.gain).slice(0,16));
  const rest=plan.contacts.find(c=>c.kind==='rest');
  return [...hits.filter(h=>strongest.has(h)),...(rest?[{ms:rest.t*1000,cue:'landing' as const,gain:.055,pan:0}]:[])];
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
