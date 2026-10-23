import { randomUUID } from 'node:crypto';
import { CombatGame } from './combatGame';
import type { CombatEscrowStore } from './combatEscrow';
import { COMBAT_STAKES } from '../src/shared/combat';

export type CombatDependencies = { escrow:CombatEscrowStore; account:(session:string)=>string|undefined; name:(session:string)=>string };
export class CombatRoom {
 game=new CombatGame(randomUUID());
 private accounts=new Map<string,string>();
 private dropped=new Map<string,number>();
 private pending=false;
 private abortFunding=false;
 private retryAt=0;
 constructor(private dependencies:CombatDependencies,private notice:(id:string,text:string)=>void){}
 get state(){return this.game.state;}
 join(id:string){
  const account=this.dependencies.account(id),s=this.state;
  if(!account)return false;
  if(s.players.includes(id)){this.dropped.delete(id);return true;}
  if(s.players.length>=2||s.phase!=='waiting'||[...this.accounts.values()].includes(account))return false;
  s.players.push(id);s.names.push(this.dependencies.name(id));this.accounts.set(id,account);s.revision++;return true;
 }
 handle(id:string,v:Record<string,unknown>){
  const s=this.state;
  if(!s.players.includes(id)||v.match!==s.id)return;
  if(v.type==='combat-input'){this.game.input(id,v.input,Date.now());return;}
  if(v.type==='combat-stake'&&s.phase==='waiting'&&(COMBAT_STAKES as readonly unknown[]).includes(v.stake)){
   s.stake=v.stake as number;s.ready=[];s.revision++;return;
  }
  if(v.type==='combat-ready'&&s.phase==='waiting'&&s.players.length===2&&v.stake===s.stake&&!s.ready.includes(id)){
   s.ready.push(id);s.revision++;
   if(s.ready.length===2)void this.fund();
  }
  if(v.type==='combat-rematch'&&s.phase==='finished'){
   const players=[...s.players],names=[...s.names],stake=s.stake;
   this.game=new CombatGame(randomUUID());Object.assign(this.state,{players,names,stake});
  }
 }
 private async fund(){
  const s=this.state,accounts=s.players.map(id=>this.accounts.get(id)!);
  this.pending=true;this.abortFunding=false;s.phase='funding';s.message='Проверяем ставки';
  try{
   await this.dependencies.escrow.recoverExpired();
   await this.dependencies.escrow.fund(s.id,accounts,s.stake);
   if(this.abortFunding){s.winner='';s.phase='settling';s.message='Возврат ставок';}
   else{this.game.start();s.pot=s.stake*2;}
  }catch(error){s.phase='waiting';s.ready=[];s.message=error instanceof Error?error.message:'Не удалось подтвердить ставки.';}
  finally{this.pending=false;s.revision++;}
 }
 disconnect(id:string){if(this.state.players.includes(id)){this.dropped.set(id,Date.now());const f=this.state.fighters[this.state.players.indexOf(id)];if(f)f.inputAt=0;}}
 reconnect(id:string){this.dropped.delete(id);}
 leave(id:string){
  const s=this.state,index=s.players.indexOf(id);if(index<0)return;
  if(s.phase==='funding'){this.abortFunding=true;this.dropped.set(id,Date.now()-21000);return;}
  if(s.phase==='playing'||s.phase==='countdown'){
   this.dropped.set(id,Date.now()-21000);s.winner=s.players[1-index];s.phase='settling';s.message='Соперник сдался';return;
  }
  if(s.phase==='settling'){this.dropped.set(id,Date.now()-21000);return;}
  s.players.splice(index,1);s.names.splice(index,1);if(s.phase==='finished')s.fighters=[];s.ready=[];this.accounts.delete(id);this.dropped.delete(id);s.revision++;
  if(!s.players.length)this.game=new CombatGame(randomUUID());
 }
 tick(dt:number){
  const s=this.state,now=Date.now();
  for(const [id,at] of this.dropped)if(now-at>=20000){
   if(s.phase==='playing'||s.phase==='countdown'){
    const other=s.players.find(player=>player!==id);
    s.winner=other&&!this.dropped.has(other)?other:'';s.phase='settling';s.message=s.winner?'Соперник не вернулся в бой':'Возврат ставок';
   }else if(s.phase==='waiting'||s.phase==='finished')this.leave(id);
  }
  this.game.tick(dt,now);
  if(s.phase==='settling'&&!this.pending&&now>=this.retryAt)void this.settle();
 }
 private async settle(){
  const s=this.state;this.pending=true;
  try{
   const result=await this.dependencies.escrow.settle(s.id,s.winner?this.accounts.get(s.winner)!:'');
   s.fee=result.fee;s.payout=result.payout;s.winnerName=s.names[s.players.indexOf(s.winner)]??'';
   if(!result.winner){s.winner='';s.winnerName='';s.message='Ставки возвращены без комиссии';}
   s.phase='finished';s.revision++;
   for(const id of [...this.dropped.keys()])this.leave(id);
  }catch{this.retryAt=Date.now()+1000;s.message='Проверяем выплату. Повторного списания нет.';}
  finally{this.pending=false;}
 }
}
