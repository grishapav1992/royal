import type { Ball, TableState } from '../src/shared/activities';
import { clampPaddle, stepPaddle, stepHockeyPuck, keepPaddleClearOfServe } from '../src/shared/hockey';
import { canPlaceCue, POOL_POCKETS } from '../src/shared/pool';
const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
const ball=(id:number,x:number,y:number):Ball=>({id,x,y,vx:0,vy:0,active:true});
const pockets=POOL_POCKETS;
export class TableGame {
  state:TableState;
  private targets=[{x:100,y:200},{x:620,y:200}];
  private pocketed:number[]=[];
  private firstHit=-1;
  private rails=new Set<number>();
  private afterContactRail=false;
  private eightEligible=false;
  private calledPocket=-1;
  private eightPocket=-1;
  private soundTime=0;
  private elapsed=0;
  private scratch=false;
  private shotTime=0;
  constructor(id:'hockey'|'pool') {this.state={id,players:[],phase:'waiting',score:[0,0],winner:'',turn:0,moving:false,balls:[],paddles:[],ready:[],groups:['open','open'],breaking:true,ballInHand:'none',message:'',sound:{seq:0,kind:''},serveDelay:0};this.reset();}
  join(id:string) {
    if(this.state.players.includes(id))return true;
    if(this.state.players.length===2)return false;
    this.state.players.push(id);this.reset();return true;
  }
  leave(id:string) {if(!this.state.players.includes(id))return;this.state.players=this.state.players.filter(p=>p!==id);this.reset();}
  rematch(id:string) {
    if(this.state.phase!=='finished'||!this.state.players.includes(id))return;
    if(!this.state.ready.includes(id))this.state.ready.push(id);
    if(this.state.ready.length===2)this.reset();
  }
  private reset() {
    Object.assign(this.state,{phase:this.state.players.length===2?'playing':'waiting',score:[0,0],winner:'',turn:0,moving:false,ready:[],groups:['open','open'],breaking:true,ballInHand:'none',message:'Разбой'});
    this.pocketed=[];this.scratch=false;this.shotTime=0;this.state.serveDelay=0;
    this.targets=[{x:100,y:200},{x:620,y:200}];this.state.paddles=this.targets.map(p=>({...p}));
    if(this.state.id==='hockey')this.serve();
    else {
      this.state.balls=[ball(0,180,200)];
      const rack=[1,9,2,10,8,3,4,11,5,12,6,13,7,14,15];let index=0;
      for(let row=0;row<5;row++)for(let col=0;col<=row;col++)this.state.balls.push(ball(rack[index++],470+row*19.2,200+(col-row/2)*22.2));
    }
  }
  private serve() {this.state.balls=[ball(0,360,200)];this.state.balls[0].vx=this.state.turn===0?180:-180;this.state.balls[0].vy=60;this.state.serveDelay=.8;}
  move(id:string,x:unknown,y:unknown) {
    const side=this.state.players.indexOf(id);
    if(this.state.id!=='hockey'||this.state.phase!=='playing'||side<0||typeof x!=='number'||typeof y!=='number'||!Number.isFinite(x)||!Number.isFinite(y))return;
    this.targets[side]=clampPaddle({x,y},side);
  }
  shoot(id:string,angle:unknown,power:unknown,pocket:unknown=-1) {
    const s=this.state;
    if(s.id!=='pool'||s.phase!=='playing'||s.moving||s.ballInHand!=='none'||s.players[s.turn]!==id||typeof angle!=='number'||typeof power!=='number'||!Number.isFinite(angle)||!Number.isFinite(power))return false;
    this.eightEligible=s.groups[s.turn]!=='open'&&!s.balls.some(b=>b.active&&this.group(b.id)===s.groups[s.turn]);
    if(this.eightEligible&&(!Number.isInteger(pocket)||Number(pocket)<0||Number(pocket)>5))return false;
    this.calledPocket=Number(pocket);this.eightPocket=-1;this.firstHit=-1;this.rails.clear();this.afterContactRail=false;
    const cue=s.balls[0];cue.vx=Math.cos(angle)*clamp(power,80,850);cue.vy=Math.sin(angle)*clamp(power,80,850);
    s.moving=true;s.message='';this.pocketed=[];this.scratch=false;this.shotTime=0;this.sound('cue');return true;
  }
  place(id:string,x:unknown,y:unknown){
    const s=this.state;
    if(s.id!=='pool'||s.phase!=='playing'||s.moving||s.players[s.turn]!==id||s.ballInHand==='none'||typeof x!=='number'||typeof y!=='number'||!Number.isFinite(x)||!Number.isFinite(y))return false;
    if(!canPlaceCue(s,x,y))return false;
    Object.assign(s.balls[0],{x,y,active:true,vx:0,vy:0});s.ballInHand='none';s.message='Белый шар установлен';return true;
  }
  private group(id:number):'open'|'solid'|'stripe'{return id>=1&&id<=7?'solid':id>=9?'stripe':'open';}
  private sound(kind:string){if(this.elapsed-this.soundTime<.06&&['rail','hit'].includes(kind))return;this.soundTime=this.elapsed;this.state.sound={seq:this.state.sound.seq+1,kind};}
  tick(dt:number) {
    this.elapsed+=dt;
    if(this.state.phase!=='playing')return;
    const steps=Math.ceil(Math.min(dt,.1)*240), step=Math.min(dt,.1)/steps;
    for(let i=0;i<steps&&this.state.phase==='playing';i++)this.state.id==='hockey'?this.hockey(step):this.pool(step);
  }
  private hockey(dt:number) {
    const s=this.state,b=s.balls[0];
    const velocities=s.paddles.map((p,i)=>stepPaddle(p,this.targets[i],dt));
    if(s.serveDelay>0){s.paddles.forEach((p,i)=>keepPaddleClearOfServe(p,i));s.serveDelay=Math.max(0,s.serveDelay-dt);return;}
    const {rail,hit,scorer}=stepHockeyPuck(b,s.paddles,velocities,dt);
    if(rail)this.sound('rail');if(hit)this.sound('hit');
    if(scorer>=0){s.score[scorer]++;this.sound('goal');s.turn=1-scorer;if(s.score[scorer]>=7){s.phase='finished';s.winner=s.players[scorer];}this.serve();}
    s.moving=true;
  }
  private pool(dt:number) {
    const s=this.state;if(!s.moving)return;this.shotTime+=dt;
    for(const b of s.balls){
      if(!b.active)continue;b.x+=b.vx*dt;b.y+=b.vy*dt;
      const pocket=pockets.findIndex(([x,y])=>Math.hypot(b.x-x,b.y-y)<22);
      if(pocket>=0){b.active=false;b.vx=b.vy=0;this.sound('pocket');if(b.id===0)this.scratch=true;else this.pocketed.push(b.id);if(b.id===8)this.eightPocket=pocket;continue;}
      if(b.x<34||b.x>686||b.y<34||b.y>366){this.rails.add(b.id);if(this.firstHit>=0)this.afterContactRail=true;this.sound('rail');}
      if(b.x<34||b.x>686){b.x=clamp(b.x,34,686);b.vx*=-.88;}
      if(b.y<34||b.y>366){b.y=clamp(b.y,34,366);b.vy*=-.88;}
      const speed=Math.hypot(b.vx,b.vy), next=Math.max(0,speed-105*dt),ratio=speed?next/speed:0;b.vx*=ratio;b.vy*=ratio;
    }
    for(let i=0;i<s.balls.length;i++)for(let j=i+1;j<s.balls.length;j++){
      const a=s.balls[i],b=s.balls[j];if(!a.active||!b.active)continue;
      const dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy);if(d>=22)continue;
      const nx=d?dx/d:1,ny=d?dy/d:0,overlap=(22-d)/2;a.x-=nx*overlap;a.y-=ny*overlap;b.x+=nx*overlap;b.y+=ny*overlap;
      const impulse=(a.vx-b.vx)*nx+(a.vy-b.vy)*ny;
      if(impulse>0){if(a.id===0&&this.firstHit<0)this.firstHit=b.id;this.sound('hit');a.vx-=impulse*nx;a.vy-=impulse*ny;b.vx+=impulse*nx;b.vy+=impulse*ny;}
    }
    if(this.shotTime>12||s.balls.every(b=>!b.active||Math.hypot(b.vx,b.vy)<3)){
      s.balls.forEach(b=>{b.vx=b.vy=0;});s.moving=false;
      this.finishShot();
    }
  }
  private respot(id:number){
    const b=this.state.balls.find(b=>b.id===id)!;b.active=true;
    if(id===8&&this.state.balls.every(other=>other===b||!other.active||Math.hypot(other.x-470,other.y-200)>24)){b.x=470;b.y=200;return;}
    outer:for(let x=id===8?470:90;x<680;x+=26)for(let y=80;y<340;y+=26)if(this.state.balls.every(other=>other===b||!other.active||Math.hypot(other.x-x,other.y-y)>24)){b.x=x;b.y=y;break outer;}
  }
  private finishShot(){
    const s=this.state,group=s.groups[s.turn],wasBreak=s.breaking;
    const wrong=this.firstHit<0||(!wasBreak&&(group==='open'?this.firstHit===8:this.eightEligible?this.firstHit!==8:this.group(this.firstHit)!==group));
    const weakBreak=wasBreak&&!this.pocketed.length&&[...this.rails].filter(id=>id!==0).length<4;
    const foul=this.scratch||wrong||(!this.pocketed.length&&!this.afterContactRail)||weakBreak;
    if(this.eightPocket>=0&&!wasBreak){
      const legal=this.eightEligible&&!foul&&this.eightPocket===this.calledPocket;
      s.phase='finished';s.winner=s.players[legal?s.turn:1-s.turn];s.message=legal?'Восьмёрка в заказанной лузе':'Неправильно забита восьмёрка';this.sound(legal?'win':'lose');return;
    }
    if(this.eightPocket>=0)this.respot(8);
    s.breaking=false;
    if(!foul&&!wasBreak&&group==='open'){
      const first=this.pocketed.find(id=>id!==8);
      if(first){s.groups[s.turn]=this.group(first);s.groups[1-s.turn]=s.groups[s.turn]==='solid'?'stripe':'solid';}
    }
    s.score=s.groups.map(g=>g==='open'?0:s.balls.filter(b=>!b.active&&this.group(b.id)===g).length);
    if(foul){
      if(this.scratch)this.respot(0);
      s.turn=1-s.turn;s.ballInHand=wasBreak?'kitchen':'table';
      s.message=this.scratch?'Фол: белый шар в лузе':wrong?'Фол: неверное первое касание':weakBreak?'Фол: слабый разбой':'Фол: нет борта после касания';this.sound('foul');
    }else{
      const keep=wasBreak?this.pocketed.some(id=>id!==8):this.pocketed.some(id=>this.group(id)===s.groups[s.turn]&&id!==8);
      if(!keep)s.turn=1-s.turn;s.message=s.groups[s.turn]==='open'?'Открытый стол':'';
    }
  }
}
