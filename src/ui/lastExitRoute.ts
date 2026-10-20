import type {RacePhase} from './lastExitModel';

export const routeBlendSeconds=2.4;
export const routeProfiles=[
 {key:'industrial',ru:'ПРОМЗОНА',en:'INDUSTRIAL',minimum:1,horizon:.505,asphalt:[132,128,119],props:[0,1],steel:false},
 {key:'interchange',ru:'РАЗВЯЗКА',en:'INTERCHANGE',minimum:2,horizon:.515,asphalt:[128,128,123],props:[2,3],steel:false},
 {key:'highway',ru:'ШОССЕ',en:'HIGHWAY',minimum:4,horizon:.505,asphalt:[144,133,112],props:[4,5],steel:true},
 {key:'last-exit',ru:'ПОСЛЕДНИЙ СЪЕЗД',en:'LAST EXIT',minimum:8,horizon:.478,asphalt:[140,138,125],props:[6,7],steel:false},
] as const;

/** The visible confirmed multiplier selects scenery only. */
export function locationIndex(multiplier:number){
 const value=Number.isFinite(multiplier)?multiplier:1;
 return value>=8?3:value>=4?2:value>=2?1:0;
}

/** Interrupted fades continue from their current composition, including a new run. */
export class RouteTransition {
 private run='';private initialized=false;private target=0;private elapsed=routeBlendSeconds;
 private weights=[1,0,0,0];private origin=[1,0,0,0];
 update(runId:string,phase:RacePhase,multiplier:number,dt:number,reduced=false){
  const requested=phase==='idle'||phase==='waiting'?0:locationIndex(multiplier);
  const next=runId===this.run&&phase!=='idle'&&phase!=='waiting'?Math.max(this.target,requested):requested;
  this.run=runId;
  if(!this.initialized){this.target=next;this.weights=this.origin=this.unit(next);this.initialized=true;}
  if(next!==this.target){this.origin=[...this.weights];this.target=next;this.elapsed=0;}
  this.elapsed=Math.min(routeBlendSeconds,this.elapsed+Math.max(0,Number.isFinite(dt)?dt:0));
  const x=this.elapsed/routeBlendSeconds,p=reduced?1:x*x*(3-2*x);
  this.weights=this.origin.map((v,i)=>v*(1-p)+(i===this.target?p:0));
  if(reduced){this.origin=[...this.weights];this.elapsed=routeBlendSeconds;}
  return this.inspect();
 }
 private unit(index:number){return [0,1,2,3].map(i=>i===index?1:0);}
 inspect(){return {index:this.target,key:routeProfiles[this.target].key,weights:[...this.weights],progress:this.elapsed/routeBlendSeconds};}
}
