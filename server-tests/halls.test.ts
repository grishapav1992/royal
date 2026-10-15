import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hallObstacles, activityHall, HALLS, HALL_DOORS, SEATS, NPC_SPAWNS} from '../src/shared/world';
import {CABINETS,cabinetHall,cabinetsInHall} from '../src/shared/cabinets';
import {cabinetSeat} from '../src/shared/cabinetSeating';
import {ACTIVITIES} from '../src/shared/activities';
import {FURNITURE,furnitureBounds} from '../src/shared/furniture';
import {walkable,findPath} from '../src/game/navigation';
import {Activities} from '../server/activities';
import {applyMovementInput} from '../src/shared/movement';
import {LobbyRoom} from '../server/LobbyRoom';
import {accounts} from '../server/accounts';

test('each hall has reachable games and only its own furniture collisions',()=>{
 for(const [id,activity] of Object.entries(ACTIVITIES)){
  const hall=activityHall(id),obstacles=hallObstacles(hall);
  assert(walkable(activity.entry.x,activity.entry.y,obstacles,16));
  assert(findPath(HALLS[hall].spawn,activity.entry,obstacles).length>0,id);
 }
 const poolRear={x:FURNITURE.pool.x,y:furnitureBounds(FURNITURE.pool).y+7};
 const hockeyRear={x:ACTIVITIES.hockey.entry.x,y:ACTIVITIES.hockey.bounds.y+2};
 for(const [x,y,hall] of [[poolRear.x,poolRear.y,'tables'],[1550,875,'tables'],[hockeyRear.x,hockeyRear.y,'tables'],[850,450,'arcade'],[120,290,'arcade'],[500,245,'arcade']] as const){
  assert(!walkable(x,y,hallObstacles(hall)),hall+' furniture');
  assert(walkable(x,y,hallObstacles(hall==='arcade'?'tables':'arcade')),hall+' absent furniture');
 }
 const body={hall:'tables',x:562,y:510,facing:'up',moving:false,seat:'',action:'idle',drink:'',actionUntil:0};
 for(let seq=1;seq<80;seq++)applyMovementInput(body,{seq,x:0,y:-1,ms:50});
 assert(body.y>490,'pool stops walking');
 Object.assign(body,{hall:'arcade',...poolRear});
 for(let seq=80;seq<110;seq++)applyMovementInput(body,{seq,x:1,y:0,ms:50});
 assert(body.x>690,'the casino aisle crosses the space occupied by the pool in the games room');
});

test('current casino games, doors and seating have clear routes from both entrances',()=>{
 const obstacles=hallObstacles('arcade');
 const destinations=[...SEATS.map(s=>({id:s.id,point:s.entry})),...cabinetsInHall('arcade').map(c=>({id:c.id,point:{x:c.x,y:c.y+43}})),{id:'hall-door',point:HALL_DOORS.arcade.entry}];
 for(const [x,y] of NPC_SPAWNS)assert(walkable(x,y,obstacles,16),'NPC spawn');
 for(const {id,point:destination} of destinations){
  assert(walkable(destination.x,destination.y,obstacles,16),id+' approach');
  for(const from of [HALLS.arcade.spawn,HALL_DOORS.arcade.arrival]){
   const path=findPath(from,destination,obstacles);
   assert(path.length>0,id+' remains reachable');
   assert.deepEqual(path.at(-1),destination,id+' route reaches the approach');
   let previous: {x: number; y: number}=from;
   for(const point of path){
    for(let step=0;step<=20;step++){
     const t=step/20;
     assert(walkable(previous.x+(point.x-previous.x)*t,previous.y+(point.y-previous.y)*t,obstacles),id+' route crosses no furniture');
    }
    previous=point;
   }
  }
 }
});
test('cannot occupy a game in another hall and leaving frees a chess seat',()=>{
 const p={hall:'arcade',...ACTIVITIES.chess.entry,playing:false,connected:true,activity:'',ears:false,seat:'',action:'idle',facing:'up',moving:false};
 const a=new Activities(()=>p,()=>{},()=>{},()=>{});
 a.handle('a',{type:'join',id:'chess'});assert.equal(a.chess.state.players.length,0);
 p.hall='tables';a.handle('a',{type:'join',id:'chess'});assert.deepEqual(a.chess.state.players,['a']);
 a.leave('a');assert.equal(a.chess.state.players.length,0);assert(!p.playing);
 Object.assign(p,ACTIVITIES.piano.entry);a.handle('a',{type:'join',id:'piano'});assert.equal(a.pianist,'');
});

test('connected doors preserve travel direction and both approaches are reachable',async()=>{
 const {HALL_DOORS,inHallDoor}=await import('../src/shared/world');
 for(const hall of ['arcade','tables'] as const){
  const door=HALL_DOORS[hall],obstacles=hallObstacles(hall);
  assert(inHallDoor({...door.entry,hall}));assert(!inHallDoor({...door.arrival,hall}));
  assert(walkable(door.entry.x,door.entry.y,obstacles,16));
  assert(walkable(door.arrival.x,door.arrival.y,obstacles,16));
  assert(findPath({x:540,y:590},door.entry,obstacles).length>0);
  if(hall==='tables')assert(findPath({x:938.75,y:225},door.entry,obstacles).length>0,'route from the wall beside a plant must stay inside the grid');
  const body={hall,...door.arrival,facing:door.facing,moving:false,seat:'',action:'idle',drink:'',actionUntil:0};
  for(let seq=1;seq<=160;seq++){
   applyMovementInput(body,{seq,x:0,y:door.facing==='up'?-1:1,ms:50});
   assert(!inHallDoor(body),'continuing into the room must not return through its entrance');
  }
 }
});

test('all casino cabinets authorize play in their own hall and reject other halls',async context=>{
 const login=await accounts.login(`luelon-hall-${crypto.randomUUID()}@example.test`,'luelon-room-password');
 (await accounts.select(login.account.id,0));
 const results:any[]=[];
 const client:any={sessionId:'luelon-hall',auth:(await accounts.session(login.token))!,send(type:string,value:unknown){if(type==='cabinet-play-result')results.push(value);},leave(){}};
 const room=new LobbyRoom(),handlers=new Map<string,(client:any,value?:unknown)=>void>();
 context.mock.method(room,'onMessage',(type:string,handler:any)=>{handlers.set(type,handler);});
 context.mock.method(room,'setPatchRate',()=>{});
 context.mock.method(room,'setSimulationInterval',()=>{});
 context.mock.method(room,'broadcast',()=>{});
 context.mock.method(room.clock,'setInterval',()=>({clear(){}}));
 room.onCreate();(await room.onJoin(client,{},client.auth));
 try{
  const player=room.state.players.get(client.sessionId)!;
  let requestId=0;
  for(const cabinet of CABINETS.filter(c=>c.playable)){
   const ownHall=cabinetHall(cabinet);
   Object.assign(player,{hall:ownHall,...cabinetSeat(cabinet).entry});
   await handlers.get('cabinet-play')!(client,{id:cabinet.id,requestId:++requestId});
   assert.equal(results.at(-1)?.accepted,true,cabinet.id+' accepts play in its hall');assert.equal(player.cabinet,cabinet.id);
   await handlers.get('playing')!(client,false);assert.equal(player.playing,false,'closing releases movement');
   for(const hall of ['arcade','tables','github'].filter(hall=>hall!==ownHall)){
    player.hall=hall;await handlers.get('cabinet-play')!(client,{id:cabinet.id,requestId:++requestId});
    assert.equal(results.at(-1)?.accepted,false,cabinet.id+' rejects play in '+hall);
    assert.equal(player.playing,false,cabinet.id+' leaves movement unlocked in '+hall);
   }
  }
  Object.assign(player,{hall:'arcade',x:540,y:590});
  await handlers.get('playing')!(client,false);assert.equal(player.playing,false,'closing remains accepted away from a cabinet');
 }finally{room.onDispose();room.clock.clear();(await accounts.logout(login.token));}
});
