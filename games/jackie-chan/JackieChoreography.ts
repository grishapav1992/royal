const CONTACT_INTERVAL = 1.3;
export const contactAt = (index:number) => 1.32 + index * CONTACT_INTERVAL;
export const chairReleaseAt = () => contactAt(0) + .7;
export const resultAt = (count:number) => contactAt(count-1) + .72;
export const fighterX = (index:number) => .34 + index * .105;
export const VICTORY_DURATION = 2.65;
export const GROUP_REACTION = .66;
export type Furniture = 'chair'|'table'|'stool';
export type Choreography = {
  phase:string; atlas:'base'|'furniture'; pose:number; fighter:number;
  x:number; lift:number; angle:number; furniture:Furniture|null;
  reveal:boolean; busy:boolean; victory:number; celebrating:boolean;
};
const clamp=(n:number)=>Math.max(0,Math.min(1,n));
export const ease=(n:number)=>{const t=clamp(n);return t*t*(3-2*t);};
/** Presentation only. One server outcome still resolves the entire selected group. */
export function choreography(elapsed:number,count:number,status:'playing'|'complete'|'banked'|'lost'|'idle',cashout=false):Choreography {
  const end=resultAt(count),won=status!=='lost',complete=status==='complete';
  const fighter=Math.max(0,Math.min(count-1,Math.floor((elapsed-(contactAt(1)-.4))/CONTACT_INTERVAL)+1));
  const local=elapsed-contactAt(fighter),target=fighterX(fighter);
  const base:Choreography={phase:'ready',atlas:'base',pose:0,fighter,x:.28,lift:0,angle:0,furniture:null,reveal:true,busy:false,victory:0,celebrating:false};
  if(status==='idle')return base;
  if(!Number.isFinite(elapsed))return {...base,phase:complete?'victory-hold':status==='banked'?'paid':won?'group-won':'lost',atlas:complete?'furniture':'base',pose:complete?6:status==='banked'?7:won?0:6,x:complete?.46:fighterX(count-1),victory:complete?1:0};
  if(cashout)return {...base,phase:'paid',atlas:'furniture',pose:7,x:.38,busy:elapsed<1.1,angle:Math.sin(clamp(elapsed/1.1)*Math.PI)*.035};
  if(elapsed>=end){
    if(!won)return {...base,phase:'lost',pose:6,x:target-.04};
    if(complete){
      const t=elapsed-end,progress=clamp(t/VICTORY_DURATION),pose=t<.32?7:t<1.2?6:t<2.05?7:6,busy=elapsed<end+VICTORY_DURATION;
      const from=target-(count===1?.08:0);
      return {...base,phase:t<.32?'victory-step':t<1.2?'victory-fist':t<2.05?'victory-bow':'victory-hold',atlas:t<.32?'base':'furniture',pose,x:from+(.46-from)*ease(t/.32),lift:t>=.32&&t<1.2?Math.sin(clamp((t-.32)/.88)*Math.PI)*.025:0,angle:t>=1.2&&t<2.05?Math.sin((t-1.2)/.85*Math.PI)*.025:0,busy,victory:progress,celebrating:busy};
    }
    return {...base,phase:'group-won',atlas:elapsed<end+GROUP_REACTION?'furniture':'base',pose:elapsed<end+GROUP_REACTION?6:0,x:target-(count===1?.08*(1-ease((elapsed-end)/.2)):0),busy:elapsed<end+GROUP_REACTION};
  }
  const action={...base,reveal:false,busy:true,x:target};
  if(fighter===0){
    if(elapsed<.18)return {...action,x:.28+.06*ease(elapsed/.18),phase:'approach'};
    if(elapsed<.5)return {...action,phase:'chair-grab',atlas:'furniture',pose:0,furniture:'chair'};
    if(elapsed<.84)return {...action,phase:'chair-lift',atlas:'furniture',pose:1,furniture:'chair',angle:-.015*Math.sin((elapsed-.5)/.34*Math.PI)};
    if(local<-.14)return {...action,phase:'chair-block',atlas:'furniture',pose:2,furniture:'chair'};
    if(local<.22)return {...action,phase:'chair-strike',atlas:'furniture',pose:3,furniture:'chair',x:target+.025*ease((local+.14)/.14)};
    if(local<.46)return {...action,phase:'chair-recover',atlas:'furniture',pose:1,furniture:'chair',x:target+.025*(1-ease((local-.22)/.24))};
    if(elapsed<chairReleaseAt())return {...action,phase:'chair-lower',atlas:'furniture',pose:0,furniture:'chair',x:target-.08*ease((local-.46)/.24)};
    return {...action,phase:'recover',pose:0,x:target-.08};
  }
  const start=contactAt(fighter)-.4;
  const from=fighter===1?fighterX(0)-.08:fighterX(fighter-1);
  if(local<-.24)return {...action,phase:'approach',pose:5,x:from+(target-from)*ease((elapsed-start)/.16)};
  if(local<.18)return {...action,phase:fighter===1?'table-vault':'stool-kick',atlas:'furniture',pose:fighter===1?4:5,furniture:fighter===1?'table':'stool'};
  return {...action,phase:!won&&fighter===count-1?'lost':'recover',pose:!won&&fighter===count-1?6:0};
}
