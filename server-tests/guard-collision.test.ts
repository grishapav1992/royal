import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LobbyState,Player} from '../server/state';
import {Guards} from '../server/guards';
import {GuardBumps,BUMP_STREAK_MS} from '../server/guardBumps';
import {MovementInputs} from '../server/movementInputs';
import {MovementPrediction} from '../src/network/MovementPrediction';
import {applyMovementInput} from '../src/shared/movement';
import {GUARD_CONTACT_RADIUS} from '../src/shared/guardCollision';
import {AccountStore} from '../server/accounts';
import {hallObstacles} from '../src/shared/world';
import {walkable} from '../src/game/navigation';

test('guard collision prediction and server agree, including sprint, replay and moving out of overlap',()=>{
 const guards=[{x:600,y:600,hall:'arcade',phase:'watch'}];
 const server=new Player();server.x=555;server.y=600;
 const local=server.toJSON() as Player,prediction=new MovementPrediction(),inputs=new MovementInputs(0);let contacts=0;
 for(let i=1;i<=20;i++){
  prediction.step(local,1,0,50,true,guards);
  prediction.flush(data=>inputs.accept(server,data,i*50,guards,()=>contacts++));
  Object.assign(local,prediction.reconcile(server.toJSON() as Player,inputs.sequence,guards));
  assert.equal(local.x,server.x);assert(Math.hypot(server.x-600,server.y-600)>=GUARD_CONTACT_RADIUS);
 }
 assert(contacts>0);assert(server.x<600);
 server.x=580;applyMovementInput(server,{seq:21,x:-1,y:0,ms:50},guards);assert(server.x<580);
 server.hall='tables';server.x=580;applyMovementInput(server,{seq:22,x:1,y:0,ms:50},guards);assert(server.x>580);
});

test('a held contact counts once; ten separated contacts show fists then eject without chat warnings',()=>{
 const state=new LobbyState(),counter=new GuardBumps(),finished:string[]=[];let count=0;
 const guards=new Guards(state,id=>finished.push(id),()=>.3,id=>{
  count=counter.record(id,1000+count*1000);
  if(count===10)guards.enqueue(id,{kind:'ejecting',until:999999,reason:'collision'});
  return count;
 });
 const g=state.guards.get('security')!,p=new Player();p.x=g.x-38;p.y=g.y;state.players.set('a',p);
 guards.contact('a');assert.equal(g.phase,'bump');assert.equal(count,1);assert.equal(p.security,'');
 for(let i=0;i<30;i++)guards.contact('a');assert.equal(count,1);
 for(let hit=2;hit<=10;hit++){
  p.x=g.x-60;guards.tick(.02);p.x=g.x-38;p.y=g.y;guards.contact('a');assert.equal(count,hit);
  if(hit<10){assert.equal(g.phase,'bump');assert.equal(p.security,'');assert.equal(g.speech,hit===9?'Ещё один толчок, и на выход. 9/10.':`Не толкайся. ${hit}/10.`);}
 }
 assert.equal(p.security,'ejecting');
 for(let i=0;i<600&&!finished.length;i++)guards.tick(.05);
 assert.deepEqual(finished,['a']);
});

test('bump streaks are per account, reset after a quiet period and restart after ten',()=>{
 const counts=new GuardBumps();assert.equal(counts.record('a',100),1);assert.equal(counts.record('b',200),1);
 assert.equal(counts.record('a',300),2);assert.equal(counts.record('a',300+BUMP_STREAK_MS),1);
 for(let i=2;i<=10;i++)assert.equal(counts.record('a',300+BUMP_STREAK_MS+i),i);
 assert.equal(counts.record('a',400+BUMP_STREAK_MS),1);
});

test('guard-initiated contact pushes an idle guest without a strike and never through furniture',()=>{
 const state=new LobbyState();let bumps=0;const guards=new Guards(state,()=>{},()=>.3,()=>++bumps),g=state.guards.get('security')!;
 const p=new Player();p.x=625;p.y=635;state.players.set('a',p);
 for(let i=0;i<120;i++){guards.tick(.05);assert(walkable(p.x,p.y,hallObstacles(p.hall)));assert(Math.hypot(g.x-p.x,g.y-p.y)>=GUARD_CONTACT_RADIUS-.001);}
 assert.equal(bumps,0);assert.equal(p.security,'');assert(p.x!==625||p.y!==635);
});

test('physical harassment ban needs no chat strike and is enforced by the account store',async()=>{
 const store=new AccountStore(':memory:');
 try{const {account}=await store.login('bumps@example.test','Royal-test-123!');const result=(await store.moderation.eject(account.id,1000));
  assert.equal(result.kind,'ejecting');assert.equal(result.reason,'collision');assert.equal((await store.moderation.banUntil(account.id,1001)),result.until);
  assert.equal((await store.moderation.banUntil(account.id,result.until)),0);assert.equal((await store.moderation.record(account.id,result.until)).kind,'warning');
 }finally{(await store.close());}
});
