import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TOILET,TOILET_WINDOW,ROOF_TOILET,OCCUPIED_TOILET_CUBICLE,toiletCubicleOpen,toiletSinkApproaches,toiletCubicleApproaches,toiletCubicleStanding} from '../src/shared/toilet';
import {toiletResidentPose,TOILET_RESIDENT_CYCLE_MS} from '../src/game/toiletResidentPose';
import {ROOF} from '../src/shared/rooftop';
import {hallLinks,hallLinkAt,hallLinkToward,hallObstacles,HALLS} from '../src/shared/world';
import {findPath,walkable} from '../src/game/navigation';
import {applyMovementInput} from '../src/shared/movement';
import {atElevator,elevatorFloors,canTravelByElevator} from '../src/shared/elevator';
import {cabinetsInHall} from '../src/shared/cabinets';
import {LobbyRoom} from '../server/LobbyRoom';
import {accounts} from '../server/accounts';
import {Guards} from '../server/guards';
import {LobbyState,Player} from '../server/state';

test('compact plan keeps the empty cubicles, all approaches, sinks and window reachable',()=>{
  const obstacles=hallObstacles('toilet');
  assert.equal(TOILET.floor.w,640);assert.equal(TOILET.floor.h,300);assert.equal(TOILET.cubicles.length,3);
  for(const target of [TOILET_WINDOW.entry,...toiletSinkApproaches,...toiletCubicleApproaches,...toiletCubicleStanding]){
    assert(walkable(target.x,target.y,obstacles,16),JSON.stringify(target));
    const path=findPath(TOILET.spawn,target,obstacles);assert(path.length);let before=TOILET.spawn as {x:number;y:number};
    for(const next of path){for(let n=0;n<=20;n++)assert(walkable(before.x+(next.x-before.x)*n/20,before.y+(next.y-before.y)*n/20,obstacles));before=next;}
  }
  for(const p of [{x:60,y:400},{x:740,y:400},{x:300,y:560},{x:270,y:270},{x:480,y:290}])assert(!walkable(p.x,p.y,obstacles));
  assert.equal(cabinetsInHall('toilet').length,0);assert(!elevatorFloors().includes('toilet'));
  assert(!atElevator({hall:'toilet',...TOILET.spawn}));
  assert(!canTravelByElevator({hall:'arcade',x:1060,y:290},'toilet'));
});

test('the occupied cubicle stays closed and blocks click routes, walking and sprinting through its door',()=>{
  const p=TOILET.cubicles[OCCUPIED_TOILET_CUBICLE],obstacles=hallObstacles('toilet'),inside={x:p.x+50,y:p.y+110};
  assert.equal(toiletCubicleStanding.length,2);assert(!walkable(inside.x,inside.y,obstacles));assert.deepEqual(findPath(TOILET.spawn,inside,obstacles),[]);
  const near=[inside,{x:p.x+50,y:p.y+165}];
  assert.equal(toiletCubicleOpen(p.id,near),false);
  for(const other of TOILET.cubicles.filter(q=>q.id!==p.id))assert(toiletCubicleOpen(other.id,[{x:other.x+50,y:other.y+160}]));
  for(const sprint of [false,true]){
    const body={hall:'toilet',x:p.x+50,y:430,facing:'up',moving:false,seat:'',action:'idle',drink:'',actionUntil:0};
    for(let i=0;i<120;i++)applyMovementInput(body,{seq:i+1,x:0,y:-1,ms:50,sprint});
    assert(body.y>=p.y+p.h+12);assert(walkable(body.x,body.y,obstacles));
  }
});

test('the seated paper loop is bounded, continuous at phase changes and static with reduced motion',()=>{
  const stages=new Set<string>();
  for(let time=0;time<TOILET_RESIDENT_CYCLE_MS;time+=20){
    const pose=toiletResidentPose(time),next=toiletResidentPose(time+20);stages.add(pose.stage);
    for(const hand of [pose.left,pose.right])assert(hand.x>=20&&hand.x<=89&&hand.y>=50&&hand.y<=90);
    assert(Math.hypot(next.right.x-pose.right.x,next.right.y-pose.right.y)<1.5);
    assert(Math.abs(next.lean-pose.lean)<.15);
    if(pose.behindShirt)assert(pose.paper);
    assert.deepEqual(toiletResidentPose(time,true),toiletResidentPose(0,true));
  }
  assert.deepEqual([...stages],['idle','take-paper','tear-paper','wipe','settle']);
  assert(toiletResidentPose(7000).behindShirt);
});

test('roof window keeps the perimeter open, has reciprocal links and safe offset arrivals',()=>{
  const obstacles=hallObstacles('roof');
  assert(findPath(ROOF.spawn,ROOF_TOILET.entry,obstacles).length);
  for(let i=0;i<ROOF.loop.length;i++)assert(findPath(ROOF.loop[i],ROOF.loop[(i+1)%ROOF.loop.length],obstacles).length);
  assert.equal(hallLinkAt({hall:'roof',...ROOF_TOILET.entry})?.target,'toilet');
  assert.equal(hallLinkAt({hall:'toilet',...TOILET_WINDOW.entry})?.target,'roof');
  assert.deepEqual(hallLinks('toilet').map(p=>p.target),['roof']);
  for(const hall of ['roof','toilet'] as const)for(const link of hallLinks(hall)){
    assert(walkable(link.arrival.arrival.x,link.arrival.arrival.y,hallObstacles(link.target),16));
    assert(!hallLinkAt({hall:link.target,...link.arrival.arrival}));
  }
  assert.equal(hallLinkToward('arcade','toilet')?.target,'street');
  assert.equal(hallLinkToward('toilet','arcade')?.target,'roof');
});

test('server transfers through the window, preserves identity and rejects stale movement and busy admission',async context=>{
  const session=await accounts.login(`toilet-${crypto.randomUUID()}@example.test`,'Toilet-test-password!');await accounts.select(session.account.id,0);
  const client:any={sessionId:'toilet-test',auth:await accounts.session(session.token),send(){},leave(){}};
  const room=new LobbyRoom(),handlers=new Map<string,(client:any,data:unknown)=>void>();
  context.mock.method(room,'onMessage',(name:string,callback:any)=>{handlers.set(name,callback);});
  context.mock.method(room,'setPatchRate',()=>{});context.mock.method(room,'setSimulationInterval',()=>{});context.mock.method(room,'broadcast',()=>{});context.mock.method(room.clock,'setInterval',()=>({clear(){}}));
  room.onCreate();await room.onJoin(client,{},client.auth);
  const enter=()=>Reflect.get(room,'enterDoor').call(room,client.sessionId);
  try{
    const p=room.state.players.get(client.sessionId)!;Object.assign(p,{hall:'roof',...ROOF_TOILET.entry});
    for(const busy of [{playing:true},{security:'ejecting'},{seat:'occupied'},{action:'drink'},{connected:false}]){
      const saved=Object.fromEntries(Object.keys(busy).map(key=>[key,Reflect.get(p,key)]));Object.assign(p,busy);assert.equal(enter(),false);Object.assign(p,saved);
    }
    const before={id:client.sessionId,name:p.name,skin:p.skin,appearance:p.appearance,revision:p.hallRevision};
    assert(enter());assert.equal(p.hall,'toilet');assert.equal(p.hallRevision,before.revision+1);assert.equal(p.name,before.name);assert.equal(p.skin,before.skin);assert.equal(p.appearance,before.appearance);
    assert.deepEqual({x:p.x,y:p.y},TOILET.spawn);assert(!enter());
    handlers.get('inputs')!(client,{revision:before.revision,inputs:[{seq:1,x:1,y:0,ms:50}]});Reflect.get(room,'tick').call(room,.05);assert.equal(p.x,TOILET.spawn.x);
    for(let i=0;i<12;i++){applyMovementInput(p,{seq:i+2,x:0,y:-1,ms:50,sprint:true});enter();assert.equal(p.hall,'toilet','held W cannot re-enter the window after arrival');}
    Object.assign(p,TOILET_WINDOW.entry);assert(enter());assert.equal(p.hall,'roof');assert.equal(p.hallRevision,before.revision+2);assert.equal(p.stairStep,0);
    assert.deepEqual({x:p.x,y:p.y},ROOF_TOILET.arrival);
    for(let i=0;i<18;i++){applyMovementInput(p,{seq:i+20,x:0,y:-1,ms:50,sprint:true});enter();assert.equal(p.hall,'roof','return beside the crate cannot bounce back into the toilet');}
  }finally{room.onDispose();room.clock.clear();await accounts.logout(session.token);}
});

test('security can follow a visitor through the roof window without trapping either actor',()=>{
  const state=new LobbyState(),done:string[]=[],halls=new Set<string>();
  const guards=new Guards(state,(_id,result)=>done.push(result.kind),()=>.5),p=new Player();Object.assign(p,{hall:'toilet',...HALLS.toilet.spawn});state.players.set('visitor',p);
  guards.enqueue('visitor',{kind:'warning',until:1000});
  for(let i=0;i<5000&&!done.length;i++){guards.tick(.05);const g=state.guards.get('security')!;halls.add(g.hall);assert(walkable(g.x,g.y,hallObstacles(g.hall)));}
  assert(halls.has('roof')&&halls.has('toilet'));assert.deepEqual(done,['warning']);assert.equal(p.hall,'toilet');
});
