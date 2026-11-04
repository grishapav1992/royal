import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { LobbyRoom } from '../server/LobbyRoom';
import { Player } from '../server/state';
import { MovementInputs } from '../server/movementInputs';
import { HALLS, hallObstacles } from '../src/shared/world';
import { walkable } from '../src/game/navigation';
import { applyMovementInput } from '../src/shared/movement';
import { playerRecoveryPoint } from '../src/shared/playerRecovery';
import { PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { DemoExpansionStore } from '../server/demoExpansion';

function fixture(context: TestContext) {
  const room = new LobbyRoom(), handlers = new Map<string, (client: any, value?: unknown) => any>(), packets: any[] = [];
  context.mock.method(room, 'onMessage', (type: string, handler: any) => { handlers.set(type, handler); });
  context.mock.method(room, 'setPatchRate', () => {}); context.mock.method(room, 'setSimulationInterval', () => {});
  context.mock.method(room, 'broadcast', () => {}); context.mock.method(room.clock, 'setInterval', () => ({ clear() {} }));
  room.onCreate(); room.state.guards.clear();
  const client: any = {sessionId:'stuck', auth:{account:{id:'stuck'},hash:'stuck'}, send(type:string,value:unknown){packets.push({type,value});}};
  room.clients.push(client); const player = new Player(); room.state.players.set(client.sessionId, player);
  const control = {dx:1,dy:1,at:Date.now(),path:[{x:1200,y:1305}],lastTarget:0,chatRevision:0,inputs:new MovementInputs(),predicted:false,afterMovement:()=>{throw Error('stale action executed');}};
  (room as any).controls.set(client.sessionId, control);
  (room as any).access.set(client.sessionId,{active:true,banUntil:0,pendingEject:false,revision:0});
  context.after(async()=>{await room.onDispose();room.clock.clear();});
  const recover = (request:any={requestId:1,revision:player.hallRevision}) => { handlers.get('unstuck')!(client,request);return packets.findLast(p=>p.type==='unstuck-result')?.value; };
  return {room,player,control,client,recover,handlers};
}

test('recovery frees a cabinet, fences queued commands and keeps account state', context => {
  const f=fixture(context);
  Object.assign(f.player,{hall:'arcade',x:1200,y:1305,cabinet:'original-jackie-chan',seat:'cabinet:original-jackie-chan',playing:true,action:'sit',soberAt:Date.now()+90000,appearance:'kept',gameReaction:'win'});
  const soberAt=f.player.soberAt;
  assert.equal(f.recover().accepted,true);
  assert.equal(f.player.hallRevision,1);assert.deepEqual({x:f.player.x,y:f.player.y},HALLS.arcade.spawn);
  assert.equal(f.player.playing,false);assert.equal(f.player.cabinet,'');assert.equal(f.player.seat,'');assert.equal(f.player.gameReaction,'');
  assert.equal(f.player.soberAt,soberAt);assert.equal(f.player.appearance,'kept');assert.equal(f.control.afterMovement,undefined);assert.deepEqual(f.control.path,[]);
  f.handlers.get('move')!(f.client,{revision:0,x:1,y:0});assert.equal(f.control.dx,0,'pre-recovery movement cannot resume');
  assert.equal(f.recover({requestId:2,revision:0}).accepted,false,'stale recovery cannot move the player again');
});

test('out-of-bounds avatars recover automatically and can walk again',context=>{
  const f=fixture(context);Object.assign(f.player,{hall:'arcade',x:1200,y:1305});
  (f.room as any).tick(.05);assert.equal(f.player.hallRevision,1);assert(walkable(f.player.x,f.player.y,hallObstacles('arcade')));
  const x=f.player.x;applyMovementInput(f.player,{seq:1,x:1,y:0,ms:50});assert(f.player.x>x);
});

test('security and shared games reject recovery without changing position or claims',context=>{
  const f=fixture(context);Object.assign(f.player,{hall:'tables',x:1200,y:1305,playing:true,activity:'chess'});
  assert.equal(f.recover().accepted,false);assert.equal(f.player.activity,'chess');assert.equal(f.player.y,1305);
  (f.room as any).tick(.05);assert.equal(f.player.y,1305,'automatic recovery cannot interrupt a game');
  Object.assign(f.player,{activity:'',security:'locked'});assert.equal(f.recover().accepted,false);assert.equal(f.player.y,1305);
  f.player.security='';f.player.connected=false;assert.equal(f.recover().accepted,false);
});

test('recovery selects clear unoccupied space on every floor',()=>{
  for(const hall of ['arcade','tables','github'] as const){
    const point=playerRecoveryPoint(hall,[HALLS[hall].spawn])!;
    assert(walkable(point.x,point.y,hallObstacles(hall),16));assert(Math.hypot(point.x-HALLS[hall].spawn.x,point.y-HALLS[hall].spawn.y)>=40);
  }
});

test('an unfinished paid series survives recovery, reopening and a repeated final action',async context=>{
  const f=fixture(context),db=new PostgresDatabase(':memory:');
  try{
    await db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY); INSERT INTO accounts VALUES('stuck')");
    const wallet=new DemoWalletStore(db);await wallet.ready;
    await wallet.operate('stuck',{id:crypto.randomUUID(),kind:'deposit',amount:1000});
    const openStore=()=>new DemoExpansionStore(db,id=>wallet.snapshot(id),wallet.ready,async()=>{},()=>0);
    let store=openStore();
    const operate=(op:unknown)=>store.operate('stuck',op,2,true,true,true,true,true,true,true,true,2,4,true,true,2,2,2);
    const start={id:crypto.randomUUID(),gameId:'original-cr-vs-leo',action:'start',stakePolicyVersion:1,stakeUnits:'10',settings:{penalty:{hero:'cr',risk:'safe'}}};
    const first=await operate(start);assert.equal(first.session.state,'active');
    const balance=await wallet.snapshot('stuck');
    Object.assign(f.player,{hall:'arcade',x:1200,y:1283,cabinet:'original-jackie-chan',seat:'cabinet:original-jackie-chan',playing:true,action:'sit'});
    assert.equal(f.recover().accepted,true);assert.deepEqual(await wallet.snapshot('stuck'),balance);
    store=openStore();const reopened=await operate(start);
    assert(reopened.replayed);assert.deepEqual(reopened.session,first.session);assert.equal(reopened.wallet.balance,balance.balance);
    const finish={id:crypto.randomUUID(),gameId:start.gameId,action:'move',sessionId:start.id,move:'cashout',revision:1};
    const settled=await operate(finish);assert.equal(settled.session.state,'settled');
    const replay=await operate(finish);assert(replay.replayed);assert.deepEqual(replay.session,settled.session);
    const final=await wallet.snapshot('stuck');assert.equal(final.balance,settled.wallet.balance);
    assert.equal(final.entries.filter(entry=>entry.kind==='bet').length,1);assert.equal(final.entries.filter(entry=>entry.kind==='win').length,1);
  }finally{await db.close();}
});
