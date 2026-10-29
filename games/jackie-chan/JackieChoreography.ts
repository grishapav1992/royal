import {FIGHT_PLANS,moveFurniture,type FightMove,type FightPlan,type Furniture} from './JackieFightPlans';
export type {Furniture} from './JackieFightPlans';

const CONTACT_INTERVAL = 1.3;
export const contactAt = (index:number) => 1.32 + index * CONTACT_INTERVAL;
export const chairReleaseAt = (index=0) => contactAt(index) + .7;
export const resultAt = (count:number) => contactAt(count-1) + .72;
export const fighterX = (index:number) => .34 + index * .105;
export const VICTORY_DURATION = 2.65;
export const GROUP_REACTION = .66;
export type Impact={at:number;fighter:number;kind:'punch'|'kick'|'chair'|'block';primary:boolean};
export function impacts(plan:FightPlan,count:number):Impact[]{
  return plan.moves.slice(0,count).flatMap((move,fighter)=>[
    ...(move==='combo'?[{at:contactAt(fighter)-.25,fighter,kind:'block' as const,primary:false}]:[]),
    {at:contactAt(fighter),fighter,kind:move==='chair'?'chair' as const:move==='kick'||move==='table'||move==='stool'?'kick' as const:'punch' as const,primary:true},
  ]);
}
export const recoveryX=(plan:FightPlan,index:number)=>fighterX(index)-(plan.moves[index]==='chair'?.08:0);
export type Choreography = {
  phase:string; atlas:'base'|'furniture'; pose:number; fighter:number; move:FightMove;
  x:number; lift:number; angle:number; furniture:Furniture|null;
  reveal:boolean; busy:boolean; victory:number; celebrating:boolean;
};
const clamp=(n:number)=>Math.max(0,Math.min(1,n));
export const ease=(n:number)=>{const t=clamp(n);return t*t*(3-2*t);};
/** Presentation only. One server outcome still resolves the entire selected group. */
export function choreography(elapsed:number,count:number,status:'playing'|'complete'|'banked'|'lost'|'idle',cashout=false,plan:FightPlan=FIGHT_PLANS[0]):Choreography {
  const end=resultAt(count),won=status!=='lost',complete=status==='complete';
  let fighter=0;
  for(let i=1;i<count;i++){
    const start=contactAt(i)-(plan.moves[i]==='combo'?.7:.4);
    const released=plan.moves[i-1]==='chair'?chairReleaseAt(i-1)+.02:0;
    if(elapsed>=Math.max(start,released))fighter=i;
  }
  const local=elapsed-contactAt(fighter),target=fighterX(fighter),move=plan.moves[fighter];
  const base:Choreography={phase:'ready',atlas:'base',pose:0,fighter,move,x:.28,lift:0,angle:0,furniture:null,reveal:true,busy:false,victory:0,celebrating:false};
  if(status==='idle')return base;
  if(!Number.isFinite(elapsed))return {...base,phase:complete?'victory-hold':status==='banked'?'paid':won?'group-won':'lost',atlas:complete?'furniture':'base',pose:complete?6:status==='banked'?7:won?0:6,x:complete?.46:fighterX(count-1),victory:complete?1:0};
  if(cashout)return {...base,phase:'paid',atlas:'furniture',pose:7,x:.38,busy:elapsed<1.1,angle:Math.sin(clamp(elapsed/1.1)*Math.PI)*.035};
  if(elapsed>=end){
    if(!won)return {...base,phase:'lost',pose:6,x:target-.04};
    if(complete){
      const t=elapsed-end,progress=clamp(t/VICTORY_DURATION),pose=t<.32?7:t<1.2?6:t<2.05?7:6,busy=elapsed<end+VICTORY_DURATION;
      const from=recoveryX(plan,count-1);
      return {...base,phase:t<.32?'victory-step':t<1.2?'victory-fist':t<2.05?'victory-bow':'victory-hold',atlas:t<.32?'base':'furniture',pose,x:from+(.46-from)*ease(t/.32),lift:t>=.32&&t<1.2?Math.sin(clamp((t-.32)/.88)*Math.PI)*.025:0,angle:t>=1.2&&t<2.05?Math.sin((t-1.2)/.85*Math.PI)*.025:0,busy,victory:progress,celebrating:busy};
    }
    return {...base,phase:'group-won',atlas:elapsed<end+GROUP_REACTION?'furniture':'base',pose:elapsed<end+GROUP_REACTION?6:0,x:target-(move==='chair'?.08*(1-ease((elapsed-end)/.2)):0),busy:elapsed<end+GROUP_REACTION};
  }
  const action={...base,reveal:false,busy:true,x:target};
  if(fighter===0&&elapsed<.18)return {...action,x:.28+.06*ease(elapsed/.18),phase:'approach'};
  if(fighter>0&&local<(move==='combo'?-.5:-.24)){const from=recoveryX(plan,fighter-1),lead=move==='combo'?.7:.4;return {...action,phase:'approach',pose:5,x:from+(target-from)*ease((local+lead)/(move==='combo'?.2:.16))};}
  if(move==='chair'){
    if(elapsed<.5)return {...action,phase:'chair-grab',atlas:'furniture',pose:0,furniture:'chair'};
    if(elapsed<.84)return {...action,phase:'chair-lift',atlas:'furniture',pose:1,furniture:'chair',angle:-.015*Math.sin((elapsed-.5)/.34*Math.PI)};
    if(local<-.14)return {...action,phase:'chair-block',atlas:'furniture',pose:2,furniture:'chair'};
    if(local<.22)return {...action,phase:'chair-strike',atlas:'furniture',pose:3,furniture:'chair',x:target+.025*ease((local+.14)/.14)};
    if(local<.46)return {...action,phase:'chair-recover',atlas:'furniture',pose:1,furniture:'chair',x:target+.025*(1-ease((local-.22)/.24))};
    if(elapsed<chairReleaseAt(fighter))return {...action,phase:'chair-lower',atlas:'furniture',pose:0,furniture:'chair',x:target-.08*ease((local-.46)/.24)};
    return {...action,phase:!won&&fighter===count-1?'hurt':'recover',pose:!won&&fighter===count-1?6:0,x:target-.08};
  }
  if(move==='table'||move==='stool'){
    if(local<-.42)return {...action,phase:'guard-step',pose:0};
    if(local<-.24)return {...action,phase:'vault-prepare',pose:5};
    if(local<.18)return {...action,phase:move==='table'?'table-vault':'stool-kick',atlas:'furniture',pose:move==='table'?4:5,furniture:moveFurniture(move)};
  }else{
    if(!won&&fighter===count-1&&local>=.04)return {...action,phase:'hurt',pose:6,x:target-.035*ease((local-.04)/.24),angle:-.035};
    if(move==='combo'){
      if(local<-.48)return {...action,phase:'guard-step'};
      if(local<-.34)return {...action,phase:'jab-windup',pose:2,x:target-.008};
      if(local<-.19)return {...action,phase:'jab',pose:3,x:target+.012*ease((local+.34)/.09)};
      if(local<-.08)return {...action,phase:'cross-windup',pose:2,x:target+.012*(1-ease((local+.19)/.11))};
      if(local<.14)return {...action,phase:'cross-punch',pose:3,x:target+.025*ease((local+.08)/.08)};
    }else if(move==='evade'){
      if(local<-.6)return {...action,phase:'guard-step'};
      if(local<-.28)return {...action,phase:'duck-evade',pose:1,x:target-.025*ease((local+.6)/.2)};
      if(local<-.12)return {...action,phase:'counter-windup',pose:2,x:target-.025};
      if(local<.14)return {...action,phase:'counter-punch',pose:3,x:target-.025+.045*ease((local+.12)/.12)};
    }else if(move==='kick'){
      if(local<-.48)return {...action,phase:'guard-step'};
      if(local<-.13)return {...action,phase:'kick-chamber',pose:1,x:target-.012};
      if(local<.16)return {...action,phase:'side-kick',pose:4,x:target+.012*ease((local+.13)/.13),angle:-.025};
    }else{
      if(local<-.48)return {...action,phase:'guard-step'};
      if(local<-.14)return {...action,phase:'punch-windup',pose:2,x:target-.012};
      if(local<.14)return {...action,phase:'straight-punch',pose:3,x:target+.025*ease((local+.14)/.14)};
    }
  }
  return {...action,phase:!won&&fighter===count-1?'hurt':'recover',pose:!won&&fighter===count-1?6:local<.36?5:0,x:target};
}
