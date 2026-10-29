export type TempleClock={contextTime:number;performanceTime:number;latencyMs:number;method:'output-timestamp'|'latency-estimate'|'silent'};
export function readTempleClock(context:AudioContext|undefined,now:number):TempleClock{
  if(!context||context.state!=='running')return {contextTime:0,performanceTime:now,latencyMs:0,method:'silent'};
  let timestamp:AudioTimestamp|undefined;try{timestamp=context.getOutputTimestamp?.();}catch{/* Fall back when a device exposes no usable output clock. */}
  const time=Number(timestamp?.contextTime),performanceTime=Number(timestamp?.performanceTime);
  if(Number.isFinite(time)&&Number.isFinite(performanceTime)&&performanceTime>0&&time>=0&&Math.abs(performanceTime-now)<250&&time<=context.currentTime+.05){
    return {contextTime:time,performanceTime,latencyMs:Math.max(0,(context.currentTime-time)*1000),method:'output-timestamp'};
  }
  const validLatency=(n:number)=>Number.isFinite(n)&&n>0?n:0;
  const latency=validLatency(context.outputLatency)+validLatency(context.baseLatency);
  return {contextTime:context.currentTime-latency,performanceTime:now,latencyMs:latency*1000,method:'latency-estimate'};
}
export const contextTimeForAccent=(clock:TempleClock,performanceTime:number,accentSeconds:number)=>clock.contextTime+(performanceTime-clock.performanceTime)/1000-accentSeconds;
