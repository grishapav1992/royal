import {test} from 'node:test';
import assert from 'node:assert/strict';
import {STAIR_WINDOW,atStairWindow,atCardWindow,canWalkThroughStairWindow} from '../src/shared/stairWindow';
import {stairWindowLink,playerHallArrival,hallLinkAt,hallLinks,hallObstacles,HALLS} from '../src/shared/world';
import {ROOF_STAIR_ROUTE,ROOF_WINDOW_PLATFORM,onRoofWindowPlatform,moveRoofStairs,advanceRoofStairStep,settleRoofStairLanding,roofWindowPlatformPosition} from '../src/shared/rooftop';
import {StreetView} from '../src/game/streetView';
import {stairWindowFrame,stairWindowPlatform} from '../src/game/StairWindowRenderer';
import {roofStairContains} from '../src/game/roofStairInput';
import {REAR_WINDOW} from '../src/game/rearWindowLife';
import {findPath,walkable} from '../src/game/navigation';
import {applyMovementInput} from '../src/shared/movement';
import {LobbyRoom} from '../server/LobbyRoom';
import {accounts} from '../server/accounts';

test('middle platform meets the third-floor sill and keeps the ordinary stairs continuous',()=>{
  const view=new StreetView();view.side='rear';const frame=stairWindowFrame(view),landing=view.point(STAIR_WINDOW.landing,true);
  const platform=stairWindowPlatform(view),route=ROOF_STAIR_ROUTE.map(p=>view.point(p,true));
  assert.equal(STAIR_WINDOW.landingIndex,6);assert.equal(frame.column,2);
  assert.equal(frame.y+REAR_WINDOW.glass.y+REAR_WINDOW.glass.h,landing.y);
  assert(frame.x+98>landing.x+400,'the window is well to the right of the stair junction');
  assert(frame.x+98>platform.left&&frame.x+98<platform.right);
  for(let offset=0;offset<=ROOF_WINDOW_PLATFORM.length;offset+=10){
    const p=view.point(roofWindowPlatformPosition(offset),true);
    assert.equal(p.y,landing.y);assert(roofStairContains({x:p.x,y:p.y+6},route,false));
  }
  assert(!roofStairContains({x:platform.right+50,y:landing.y+6},route,false),'the extended walkway hit area ends with the balcony');
  for(const step of [6,7])assert(atStairWindow({hall:'street',...STAIR_WINDOW.outside,stairStep:step}));
  assert(!atStairWindow({hall:'street',...STAIR_WINDOW.landing,stairStep:7}),'the stair junction is not the window sill');
  assert(Math.abs(view.point(STAIR_WINDOW.outside,true).x-frame.x-98)<3);
  for(const step of [0,1,5,8,11])assert(!atStairWindow({hall:'street',...STAIR_WINDOW.landing,stairStep:step}));
  for(const [i,p]of ROOF_STAIR_ROUTE.entries()){
    if(i!==ROOF_STAIR_ROUTE.length-1)assert(!hallLinkAt({hall:'street',...p}),'passing a landing never automatically enters the card salon');
    if(i!==ROOF_STAIR_ROUTE.length-1)assert(!stairWindowLink({hall:'street',...p,stairStep:0}),'ground coordinates cannot grant access at height');
  }
  assert.deepEqual(hallLinks('street').map(l=>l.target),['arcade','roof'],'ground actors keep their existing routes');
});

test('the interior window has clear approaches and safe arrivals on the correct landing',()=>{
  const obstacles=hallObstacles('github');
  for(const p of [STAIR_WINDOW.entry,STAIR_WINDOW.arrival])assert(walkable(p.x,p.y,obstacles,16));
  assert(findPath(HALLS.github.spawn,STAIR_WINDOW.entry,obstacles).length);
  assert(findPath(STAIR_WINDOW.arrival,STAIR_WINDOW.entry,obstacles).length);
  assert(!atCardWindow({hall:'github',...STAIR_WINDOW.arrival}));
  const link=stairWindowLink({hall:'github',...STAIR_WINDOW.entry})!;
  const arrival=playerHallArrival('github',link);assert.deepEqual(arrival,STAIR_WINDOW.return);
  for(const y of [-1,1]){
    const p={...arrival,hall:'street',moving:false,soberAt:0};applyMovementInput(p,{seq:1,x:0,y,ms:50});
    assert(p.stairStep>0);assert.notDeepEqual({x:p.x,y:p.y},STAIR_WINDOW.landing);
    assert.equal(p.hall,'street');
  }
});

test('horizontal platform movement stays flat and never inherits an up/down choice',()=>{
  const p=ROOF_WINDOW_PLATFORM,view=new StreetView();view.side='rear';
  for(const step of [6,7])for(const direction of [-1,1]){
    const body={...STAIR_WINDOW.landing,stairStep:step,stairDirection:direction,moving:false};
    for(let i=0;i<80;i++){moveRoofStairs(body,{x:p.direction,y:0},5);assert.equal(body.y,p.junction.y);assert(onRoofWindowPlatform(body));assert.equal(view.point(body,true).y,20);}
    assert.equal(body.x,roofWindowPlatformPosition(p.length).x);const stopped={...body};settleRoofStairLanding(body);assert.equal(body.x,stopped.x);
    assert.equal(advanceRoofStairStep(body.stairStep,body),step);
    for(let i=0;i<80;i++)moveRoofStairs(body,{x:-p.direction,y:0},5);
    assert.deepEqual({x:body.x,y:body.y},p.junction);assert.equal(body.stairStep,step);
  }
});

test('explicit up and down select the intended flight from every platform position',()=>{
  const p=ROOF_WINDOW_PLATFORM;
  for(const offset of [0,40,155,p.windowOffset,p.length])for(const previous of [-1,1])for(const input of [-1,1]){
    const body={...roofWindowPlatformPosition(offset),stairStep:6,stairDirection:previous,moving:false};
    for(let i=0;i<80&&body.y===p.junction.y;i++)moveRoofStairs(body,{x:0,y:input},5);
    assert.equal(Math.sign(body.y-p.junction.y),input,JSON.stringify({offset,previous,input,body}));
    assert.equal(body.stairDirection,input<0?1:-1);
  }
});

test('horizontal keys cannot climb a flight; vertical keys follow either switchback direction',()=>{
  for(let step=1;step<ROOF_STAIR_ROUTE.length;step++){
    const a=ROOF_STAIR_ROUTE[step-1],b=ROOF_STAIR_ROUTE[step],start={x:(a.x+b.x)/2,y:(a.y+b.y)/2,stairStep:step,stairDirection:1,moving:false};
    for(const x of [-1,1]){const p={...start};moveRoofStairs(p,{x,y:0},10);assert.equal(p.x,start.x);assert.equal(p.y,start.y);}
    for(const y of [-1,1]){const p={...start};moveRoofStairs(p,{x:0,y},10);assert.equal(Math.sign(p.y-start.y),y);}
  }
});
test('walking through the window accepts its full glass width without granting access from a flight or ground',()=>{
  for(const offset of [ROOF_WINDOW_PLATFORM.windowOffset-40,ROOF_WINDOW_PLATFORM.windowOffset,ROOF_WINDOW_PLATFORM.length]){
    const p={hall:'street',...roofWindowPlatformPosition(offset),stairStep:7};assert(canWalkThroughStairWindow(p));
    assert(!canWalkThroughStairWindow({...p,stairStep:0}));assert(!canWalkThroughStairWindow({...p,y:p.y+2}));
  }
  assert(!canWalkThroughStairWindow({hall:'street',...STAIR_WINDOW.landing,stairStep:7}));
  assert(canWalkThroughStairWindow({hall:'github',...STAIR_WINDOW.entry}));
});
test('turning toward the balcony guides from either adjoining flight without a precision stop',()=>{
  const j=ROOF_WINDOW_PLATFORM.junction;
  for(const y of [-4,4]){
    const p={x:j.x-34,y:j.y+y,stairStep:y>0?6:7,stairDirection:1,moving:false};
    for(let i=0;i<20;i++)moveRoofStairs(p,{x:-1,y:0},5);
    assert(onRoofWindowPlatform(p));assert(p.x<j.x-40);assert.equal(p.y,j.y);
  }
});

test('manual window admission verifies height, revision and busy state, then preserves progress and identity',async context=>{
  const session=await accounts.login(`stair-window-${crypto.randomUUID()}@example.test`,'Stair-window-test-password!');await accounts.select(session.account.id,0);
  const client:any={sessionId:'stair-window-test',auth:await accounts.session(session.token),send(){},leave(){}};
  const room=new LobbyRoom(),handlers=new Map<string,(client:any,data:unknown)=>void>();
  context.mock.method(room,'onMessage',(name:string,callback:any)=>{handlers.set(name,callback);});
  context.mock.method(room,'setPatchRate',()=>{});context.mock.method(room,'setSimulationInterval',()=>{});context.mock.method(room,'broadcast',()=>{});context.mock.method(room.clock,'setInterval',()=>({clear(){}}));
  room.onCreate();await room.onJoin(client,{},client.auth);
  const use=(revision?:number)=>handlers.get('stair-window')!(client,{revision:revision??room.state.players.get(client.sessionId)!.hallRevision});
  try{
    const p=room.state.players.get(client.sessionId)!;Object.assign(p,{hall:'street',...STAIR_WINDOW.landing,stairStep:0});use();assert.equal(p.hall,'street');
    p.stairStep=7;use();assert.equal(p.hall,'street','a landing click must approach the actual sill first');Object.assign(p,STAIR_WINDOW.outside);
    for(const busy of [{playing:true},{security:'ejecting'},{seat:'occupied'},{action:'drink'},{connected:false}]){
      const saved=Object.fromEntries(Object.keys(busy).map(key=>[key,Reflect.get(p,key)]));Object.assign(p,busy);use();assert.equal(p.hall,'street');Object.assign(p,saved);
    }
    const identity={name:p.name,skin:p.skin,appearance:p.appearance,revision:p.hallRevision};
    use(p.hallRevision-1);assert.equal(p.hall,'street');
    use();assert.equal(p.hall,'github');assert.equal(p.stairStep,0);assert.equal(p.hallRevision,identity.revision+1);
    assert.deepEqual({x:p.x,y:p.y},STAIR_WINDOW.arrival);assert.equal(p.name,identity.name);assert.equal(p.skin,identity.skin);assert.equal(p.appearance,identity.appearance);
    use();assert.equal(p.hall,'github');
    Object.assign(p,STAIR_WINDOW.entry);use(identity.revision);assert.equal(p.hall,'github');
    use();assert.equal(p.hall,'street');assert.equal(p.stairStep,STAIR_WINDOW.return.stairStep);assert.equal(p.stairDirection,-1);assert.equal(p.hallRevision,identity.revision+2);
    assert.deepEqual({x:p.x,y:p.y},{x:STAIR_WINDOW.return.x,y:STAIR_WINDOW.return.y});
    assert.equal(Reflect.get(room,'enterDoor').call(room,client.sessionId),false,'return never auto-enters the roof or card room');
    assert.equal(p.stairStep,STAIR_WINDOW.landingIndex,'idle settling selects the descending side of the same landing');
    assert.deepEqual({x:p.x,y:p.y},{x:STAIR_WINDOW.return.x,y:STAIR_WINDOW.return.y});
    handlers.get('inputs')!(client,{revision:identity.revision+1,inputs:[{seq:1,x:0,y:-1,ms:50}]});
    assert.deepEqual({x:p.x,y:p.y},{x:STAIR_WINDOW.return.x,y:STAIR_WINDOW.return.y},'old indoor movement cannot move the return on the stairs');
  }finally{room.onDispose();room.clock.clear();await accounts.logout(session.token);}
});
