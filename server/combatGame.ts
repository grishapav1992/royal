import { freshCombatState, neutralCombatInput, type CombatState, type Fighter, type CombatInput } from '../src/shared/combat';

const fighter=(x:number):Fighter=>({x,y:0,vy:0,health:100,action:'stand',actionTime:0,cooldown:0,stun:0,input:neutralCombatInput(),inputAt:0});
/** Server simulation accepts buttons only. Health, positions and victory never come from a client. */
export class CombatGame {
 readonly state:CombatState;
 private accumulator=0;
 constructor(id:string){this.state=freshCombatState(id);}
 start(){const s=this.state;s.fighters=[fighter(240),fighter(480)];s.phase='countdown';s.countdown=3;s.remaining=90;s.winner='';s.message='';}
 input(id:string,input:unknown,now:number){
  const index=this.state.players.indexOf(id);
  if(index<0||!input||typeof input!=='object'||Array.isArray(input))return;
  const v=input as Record<string,unknown>,keys=Object.keys(neutralCombatInput());
  if(Object.keys(v).length!==keys.length||!keys.every(key=>typeof v[key]==='boolean'))return;
  if(this.state.phase!=='playing'&&this.state.phase!=='countdown')return;
  this.state.fighters[index].input={...v} as CombatInput;this.state.fighters[index].inputAt=now;
 }
 tick(dt:number,now:number){
  const s=this.state;
  if(s.phase==='countdown'){s.countdown=Math.max(0,s.countdown-dt);if(!s.countdown)s.phase='playing';return;}
  if(s.phase!=='playing')return;
  this.accumulator+=Math.min(.1,Math.max(0,dt));
  while(this.accumulator>=1/60&&s.phase==='playing'){this.accumulator-=1/60;this.step(1/60,now);}
 }
 private step(dt:number,now:number){
  const s=this.state;s.remaining=Math.max(0,s.remaining-dt);
  const attacks:{side:number;damage:number;reach:number}[]=[];
  s.fighters.forEach((f,i)=>{
   if(now-f.inputAt>350)f.input=neutralCombatInput();
   f.cooldown=Math.max(0,f.cooldown-dt);f.stun=Math.max(0,f.stun-dt);f.actionTime=Math.max(0,f.actionTime-dt);
   f.vy-=1100*dt;f.y=Math.max(0,f.y+f.vy*dt);if(!f.y)f.vy=0;
   if(f.health<=0){f.action='fall';return;}
   if(f.stun){f.action='endure';return;}
   const input=f.input;
   if(input.jump&&!f.y){f.vy=470;f.y=1;}
   const blocking=input.block&&!f.y;
   if(!blocking&&!f.actionTime)f.x=Math.max(45,Math.min(675,f.x+(Number(input.right)-Number(input.left))*210*dt));
   if(!blocking&&!f.cooldown&&(input.punch||input.kick)){
    const kick=input.kick;f.action=kick?'high-kick':'high-punch';f.actionTime=kick?.5:.32;f.cooldown=kick?.65:.42;
    attacks.push({side:i,damage:kick?12:8,reach:kick?115:85});
   }else if(!f.actionTime)f.action=blocking?'blocking':f.y?'jumping':input.left!==input.right?'walking':'stand';
  });
  const [a,b]=s.fighters;
  if(a.x>b.x-48){const mid=(a.x+b.x)/2;a.x=Math.max(45,mid-24);b.x=Math.min(675,mid+24);}
  for(const {side,damage,reach} of attacks){
   const f=s.fighters[side],target=s.fighters[1-side];
   if(Math.abs(f.x-target.x)>reach||Math.abs(f.y-target.y)>80)continue;
   const blocked=target.input.block&&!target.y;
   target.health=Math.max(0,target.health-(blocked?2:damage));
   if(!blocked){target.stun=.18;target.action='endure';target.actionTime=.18;}
   s.hitSeq++;
  }
  if(a.health<=0||b.health<=0||!s.remaining){
   s.winner=a.health===b.health?'':s.players[a.health>b.health?0:1];s.phase='settling';
   s.message=s.winner?'Бой завершён':'Ничья: возврат ставок';
  }
 }
}
