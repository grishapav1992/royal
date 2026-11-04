import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { LobbyRoom } from '../server/LobbyRoom';
import { Player } from '../server/state';
import { MovementInputs } from '../server/movementInputs';
import { HALLS, hallObstacles } from '../src/shared/world';
import { walkable } from '../src/game/navigation';
import { applyMovementInput } from '../src/shared/movement';
import { playerRecoveryPoint } from '../src/shared/playerRecovery';

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
