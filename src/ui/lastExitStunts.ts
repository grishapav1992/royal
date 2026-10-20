import type {RacePhase} from './lastExitModel';
export const clamp=(n:number)=>Math.max(0,Math.min(1,n));
export const ease=(n:number)=>{const p=clamp(n);return p*p*(3-2*p);};
export const mix=(a:number,b:number,p:number)=>a+(b-a)*p;
export type StuntVariant='pit-left'|'pit-right'|'helicopter'|'cargo-plane'|'drive';
export const impactAt=.4,rollAt=.72,explosionAt=3.48;
export const cargoTiming={planeAt:1.15,planeReady:2.9,rampNear:3.05,takeoff:3.5,landing:4.55,inside:5.05,departure:5.25,exit:8};
/** Cosmetic selection uses only the public round ID and its confirmed terminal phase. */
export function pickStunt(runId:string,phase:RacePhase,value=1):StuntVariant{
 if(phase!=='crashed'&&phase!=='escaped')return 'drive';
 if(phase==='escaped')return Math.round(value*100)>200?'cargo-plane':'helicopter';
 let hash=2166136261;for(const char of runId){hash=Math.imul(hash^char.charCodeAt(0),16777619)>>>0;}
 return (['pit-left','pit-right'] as const)[hash%2];
}
/** Cosmetic session sequence, stable for redraws and revisited recent rounds. */
export class CrashStuntSequence {
 private rounds=new Map<string,StuntVariant>();private previous?:StuntVariant;
 choose(runId:string,phase:RacePhase,value=1):StuntVariant{
  if(phase!=='crashed')return pickStunt(runId,phase,value);
  const cached=this.rounds.get(runId);if(cached)return cached;
  const variant=this.previous?(this.previous==='pit-left'?'pit-right':'pit-left'):pickStunt(runId,phase,value);
  this.previous=variant;this.rounds.set(runId,variant);
  if(this.rounds.size>64)this.rounds.delete(this.rounds.keys().next().value!);
  return variant;
 }
}
const crashSequence=new CrashStuntSequence();
export const nextStunt=(id:string,phase:RacePhase,value=1)=>crashSequence.choose(id,phase,value);
/** Presentation-only timeline. No crash seed, deadline or unconfirmed result enters here. */
export function stuntFrame(phase:RacePhase,seconds:number,reduced=false,variant:StuntVariant='pit-left'){
 const crash=phase==='crashed',escape=phase==='escaped',plane=escape&&variant==='cargo-plane';
 const t=reduced?(crash?4.2:escape?plane?4.7:3.7:0):Math.max(0,seconds);
 const hit=crash?ease((t-impactAt)/.28):0,tumble=crash?clamp((t-rollAt)/(explosionAt-rollAt)):0;
 const lift=escape&&!plane?ease((t-2.25)/1.85):0,cables=escape&&!plane?ease((t-.8)/1.35):0;
 const jump=plane?ease((t-cargoTiming.takeoff)/(cargoTiming.landing-cargoTiming.takeoff)):0,depart=plane?ease((t-cargoTiming.departure)/(cargoTiming.exit-cargoTiming.departure)):escape?ease((t-4.1)/2.9):0;
 const direction=variant==='pit-right'?-1:1;
 return {age:t,hit,tumble,lift,cables,jump,depart,variant,direction,
  carX:crash?direction*ease((t-.45)/3):0,
  carY:crash?Math.sin(tumble*Math.PI):escape?lift:0,
  rollTurns:crash?3.5*ease(tumble):0,
  carRoll:0,
  helicopter:escape&&!plane,plane,
  explosion:crash&&t>=explosionAt,debris:crash&&t>=rollAt,
  label:crash?(t<rollAt?'intercept':t<explosionAt?'depth-rollover':'explosion'):escape?plane?(t<cargoTiming.planeAt?'ramp-distant':t<cargoTiming.rampNear?'aircraft-approach':t<cargoTiming.takeoff?'ramp-climb':t<cargoTiming.landing?'cargo-jump':t<cargoTiming.departure?'cargo-entry':t<cargoTiming.exit?'cargo-escape':'extracted'):(t<.8?'helicopter-approach':t<2.25?'cables-descending':t<4.1?'airlift':t<7?'fly-away':'extracted'):phase,
  travel:crash?Math.max(0,1-t/3.6):plane?1-ease((t-cargoTiming.takeoff)/3.2)*.8:escape?Math.max(.28,1-t/8):phase==='racing'?1:0,
 };
}

/** Contact poses alternate wheels and roof while the car recedes along the road. */
export function crashMotion(seconds:number,reduced=false){
 const f=stuntFrame('crashed',seconds,reduced),depth=ease(f.tumble),sideways=ease((f.age-impactAt)/.34);
 const wave=Math.abs(Math.sin(f.rollTurns*Math.PI*2));
 return {sideways,depth,scale:1-depth*.60,ground:.96-depth*.27,
  hop:wave<1e-7?0:Math.pow(wave,.85)*.13*(1-depth*.65),
  turns:f.rollTurns,frame:(f.rollTurns%1)*8,screenAngle:0};
}
export const rolloverImpacts=Array.from({length:7},(_,i)=>{
 const target=(i+1)/7;let lo=0,hi=1;
 for(let j=0;j<45;j++){const mid=(lo+hi)/2;if(ease(mid)<target)lo=mid;else hi=mid;}
 return rollAt+(explosionAt-rollAt)*(lo+hi)/2;
});

/** A patrol reaches the side panel at impactAt, pushes laterally, then drops back. */
export function patrolContact(seconds:number,side:number,attacker:number){
 const t=Math.max(0,seconds),contact=ease(t/impactAt),push=ease((t-impactAt)/.28),retreat=ease((t-.76)/.95);
 return {attacking:side===attacker,contact,push,retreat,side,yaw:ease(t/.32)*(1-retreat*.70),screenAngle:0};
}

/** Tight sprite bounds put the patrol's inward nose inside the outer body panel. */
export function ramGeometry(seconds:number,w:number,h:number,side:number,heroX:number,heroWidth:number,initialX:number,initialFoot:number){
 const contact=patrolContact(seconds,side,side),pose=Math.min(2,Math.round(contact.yaw*2));
 const aspects=[423/338,465/335,546/310],height=Math.min(w*.23,262)*.82/(423/338),width=height*aspects[pose];
 const panel=heroX+side*heroWidth*.42,penetration=heroWidth*.10;
 const initialNose=initialX-side*height*aspects[0]*.5;
 const closingNose=mix(initialNose,panel,contact.contact)-side*penetration*contact.push;
 const x=mix(closingNose+side*width*.5,initialX+side*w*.20,contact.retreat);
 const foot=mix(mix(initialFoot,h*.965,contact.contact),h*1.12,contact.retreat);
 const noseX=x-side*width*.5;
 return {...contact,x,foot,width,height,pose,noseX,panel,overlap:(noseX-panel)*-side,contactY:foot-height*.19};
}

/** Road projection, takeoff, doorway occlusion and flight use the same geometry. */
export function cargoMotion(seconds:number,w:number,h:number,reduced=false,initialCarX=w*.5){
 const f=stuntFrame('escaped',seconds,reduced,'cargo-plane'),t=f.age,k=cargoTiming;
 const arrival=ease((t-k.planeAt)/(k.planeReady-k.planeAt)),climb=ease((t-k.rampNear)/(k.takeoff-k.rampNear));
 const entry=ease((t-k.landing)/(k.inside-k.landing)),scale=1-f.depart*.65;
 const planeBase=Math.min(w*.88,h*1.18,980),planeW=planeBase*mix(.20,1,arrival)*scale;
 const planeX=mix(w*.84,w*.5,arrival)+w*.85*f.depart,planeY=mix(-h*.38,h*.43,arrival)-h*.55*f.depart;
 const z=.025+1.135*Math.pow(clamp(t/k.rampNear),2.3)+Math.max(0,t-k.takeoff)*2.7;
 const ramp={x:w*.5,z,nearY:h*(.56+.44*z),lipY:h*(.56+.24*z),nearHalf:w*.24*z,farHalf:w*.137*z};
 const roadCarW=Math.min(w*.32,342),fittedCarW=Math.min(roadCarW,h*.50),baseCarW=mix(roadCarW,fittedCarW,ease(t/.55));
 const launchW=fittedCarW*.85,launchFoot=h*(.56+.24*1.16),launchY=launchFoot-launchW*.29;
 let carX=mix(initialCarX,w*.5,ease(t/2)),carW=mix(baseCarW,launchW,climb),carY=mix(h*.96-baseCarW*.29,launchY,climb);
 if(t>=k.takeoff){carX=mix(w*.5,planeX,f.jump);carW=mix(launchW,planeW*.115,f.jump);carY=mix(launchY,planeY+planeW*.17,f.jump)-Math.sin(f.jump*Math.PI)*Math.min(h*.04,Math.max(0,launchY-(planeY+planeW*.17))*.30);}
 if(t>=k.landing){carX=planeX;carW=planeW*mix(.115,.040,entry);carY=planeY+planeW*mix(.17,.11,entry);}
 const portalTop=planeY+planeW*.028,portalLeft=planeX-planeW*.095,portalRight=planeX+planeW*.095;
 const bounds={left:planeX-planeW/2,right:planeX+planeW/2,top:planeY-planeW/3,bottom:planeY+planeW/3};
 return {age:t,arrival,climb,entry,jump:f.jump,depart:f.depart,ramp,planeX,planeY,planeW,planeVisible:t>=k.planeAt,
  carX,carY,carW,portalTop,portalLeft,portalRight,inHold:t>=k.inside,carHidden:carY+carW/3<=portalTop,
  bounds,offscreen:bounds.left>w||bounds.right<0||bounds.bottom<0||bounds.top>h};
}

/** A single suspended assembly: fixed clearance on lift, shared scale on departure. */
export function helicopterMotion(seconds:number,w:number,h:number,reduced=false,initialCarX=w*.5){
 const f=stuntFrame('escaped',seconds,reduced,'helicopter'),arrival=ease(f.age/1.25),unitScale=1-f.depart*.55;
 const baseCarW=Math.min(w*.32,342),pickupCarW=Math.min(baseCarW,h*.42),carBase=mix(baseCarW,pickupCarW,arrival);
 const heliBase=Math.min(w*.42,435,h*.64),gap=Math.max(h*.08,carBase*.16);
 const rootX=mix(initialCarX,w*.5,arrival)+w*.78*f.depart;
 const projectedFoot=h*(.56+.40*carBase/baseCarW),pickupFoot=Math.min(h*.96,Math.max(projectedFoot,h*.12+(heliBase+carBase)*2/3+gap));
 const carY=pickupFoot-carBase*.29-h*.10*f.lift-h*.30*f.depart;
 const carW=carBase*unitScale,heliW=heliBase*unitScale;
 const carX=rootX+(reduced?0:Math.sin(f.age*2.3)*carW*.014*f.lift*(1-f.depart)),heliX=rootX;
 const heliY=carY-(heliBase/3+carBase/3+gap)*unitScale-h*.6*(1-arrival);
 const ropes=[[-.19,-.22],[-.10,-.12],[.10,-.12],[.19,-.22]].map(([side,roof])=>({
  ax:heliX+side*heliW*.72,ay:heliY+heliW*.25,bx:carX+side*carW*1.25,by:carY+roof*carW,
 }));
 const bounds={left:Math.min(heliX-heliW*.64,carX-carW/2),right:Math.max(heliX+heliW*.64,carX+carW/2),top:Math.min(heliY-heliW/3,carY-carW/3),bottom:Math.max(heliY+heliW/3,carY+carW/3)};
 return {carX,carY,carW,heliX,heliY,heliW,groundY:pickupFoot,ropes,bounds,clearance:(carY-carW/3)-(heliY+heliW/3),depart:f.depart,lift:f.lift,cables:f.cables,
  offscreen:bounds.right<0||bounds.left>w||bounds.bottom<0||bounds.top>h};
}
