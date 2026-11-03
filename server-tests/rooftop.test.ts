import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findPath, walkable } from '../src/game/navigation';
import { ROOF, ROOF_STAIRS, STREET_ROOF_STAIRS, ROOF_STAIR_ROUTE, advanceRoofStairStep } from '../src/shared/rooftop';
import { HALLS, hallLinkAt, hallLinks, hallLinkToward, hallObstacles, type HallId } from '../src/shared/world';
import { atElevator, canTravelByElevator, elevatorFloors } from '../src/shared/elevator';
import { cabinetsInHall } from '../src/shared/cabinets';
import { LobbyRoom } from '../server/LobbyRoom';
import { accounts } from '../server/accounts';
import { Guards } from '../server/guards';
import { LobbyState, Player } from '../server/state';
import { StreetView } from '../src/game/streetView';
import { roofStairContains } from '../src/game/roofStairInput';
import { applyMovementInput,type MovementBody } from '../src/shared/movement';
import { MovementPrediction } from '../src/network/MovementPrediction';

test('visible ladder rungs, flights and landings accept input without capturing the rear pavement',()=>{
  const view=new StreetView();view.configure({x:1660,y:360},false);
  const route=ROOF_STAIR_ROUTE.map(p=>view.point(p,true)),foot=route[0];
  assert(roofStairContains({x:foot.x,y:foot.y-80},route,false),'middle rung is clickable');
  for(const index of [1,3,5,7])assert(roofStairContains({x:route[index].x,y:route[index].y-35},route,false),'landing rail is clickable');
  for(const [start,end] of [[1,2],[3,4],[5,6]]){
    const a=route[start],b=route[end];
    assert(roofStairContains({x:(a.x+b.x)/2,y:(a.y+b.y)/2-20},route,false),'flight accepts a click between tread and rail');
  }
  for(let x=320;x<=2500;x+=10)assert(!roofStairContains(view.point({x,y:360}),route,false),'rear circulation lane stays free');
  assert(!roofStairContains({x:foot.x+100,y:foot.y-80},route,false),'wall beside the ladder is not interactive');
  view.configure({x:1660,y:360},true);
  const plan=ROOF_STAIR_ROUTE.map(p=>view.point(p,true));
  assert(roofStairContains(STREET_ROOF_STAIRS.click,plan,true));
  assert(!roofStairContains({x:1660,y:360},plan,true),'overview retains the pavement route');
});

test('roof has a safe complete walking loop, solid equipment and guarded edges', () => {
  const obstacles = hallObstacles('roof'), points = [ROOF.spawn, ...ROOF.loop, ROOF.spawn, ROOF_STAIRS.entry];
  for (let i = 1; i < points.length; i++) {
    const path = findPath(points[i - 1], points[i], obstacles);
    assert(path.length, 'each roof sector is reachable');
    let before = points[i - 1];
    for (const next of path) {
      const steps = Math.max(1, Math.ceil(Math.hypot(next.x - before.x, next.y - before.y) / 3));
      for (let k = 0; k <= steps; k++) assert(walkable(before.x + (next.x - before.x) * k / steps, before.y + (next.y - before.y) * k / steps, obstacles));
      before = next;
    }
  }
  for (const p of [{ x: 100, y: 700 }, { x: 2150, y: 700 }, { x: 900, y: 250 }, { x: 900, y: 1250 }, { x: 530, y: 500 }, { x: 1120, y: 500 }]) assert(!walkable(p.x, p.y, obstacles));
  assert.equal(cabinetsInHall('roof').length, 0);
  assert(!elevatorFloors().includes('roof'));
  assert(!atElevator({ hall: 'roof', ...ROOF.spawn }));
  assert(!canTravelByElevator({ hall: 'arcade', x: 1060, y: 290 }, 'roof'));
});

test('roof uses only the rear street stairs, with safe arrivals and real multi-door navigation', () => {
  assert.deepEqual(hallLinks('roof').map(link => link.target), ['street']);
  assert.equal(hallLinkAt({ hall: 'street', ...STREET_ROOF_STAIRS.entry })?.target, 'roof');
  assert.equal(hallLinkAt({ hall: 'roof', ...ROOF_STAIRS.entry })?.target, 'street');
  for (const hall of ['street', 'roof'] as const) for (const link of hallLinks(hall)) {
    assert(walkable(link.arrival.arrival.x, link.arrival.arrival.y, hallObstacles(link.target), 16));
    assert(!hallLinkAt({ hall: link.target, ...link.arrival.arrival }));
  }
  for (const from of Object.keys(HALLS) as HallId[]) for (const target of Object.keys(HALLS) as HallId[]) {
    let here = from;
    const visited = new Set<HallId>();
    while (here !== target) {
      assert(!visited.has(here), 'routing cannot loop between floors'); visited.add(here);
      const link = hallLinkToward(here, target); assert(link); here = link.target;
    }
  }
  assert.equal(hallLinkToward('github', 'roof')?.target, 'tables');
  assert.equal(hallLinkToward('arcade', 'roof')?.target, 'street');
  assert.equal(hallLinkAt({ hall: 'street', x: 1660, y: 360 }), undefined, 'rear circulation lane does not trigger the stairs');
});

test('security can reach a roof visitor and finish without crossing a parapet', () => {
  for (const kind of ['warning', 'ejecting'] as const) {
    const state = new LobbyState(), completed: string[] = [], visited = new Set<string>();
    const guards = new Guards(state, (_id, decision) => completed.push(decision.kind), () => .5);
    const p = new Player(); Object.assign(p, { hall: 'roof', x: 1700, y: 1050 }); state.players.set('roof-visitor', p);
    guards.enqueue('roof-visitor', { kind, until: 1000 });
    for (let i = 0; i < 4500 && !completed.length; i++) {
      guards.tick(.05); const g = state.guards.get('security')!; visited.add(g.hall);
      assert(walkable(g.x, g.y, hallObstacles(g.hall)), 'security stays on accessible ground');
      assert.equal(p.hall, 'roof');
    }
    assert(visited.has('arcade') && visited.has('street') && visited.has('roof'));
    assert.deepEqual(completed, [kind]); assert(walkable(p.x, p.y, hallObstacles('roof')));
  }
});

test('server controls roof ascent and return, blocks busy visitors and ignores old movement packets', async context => {
  const session = await accounts.login(`roof-${crypto.randomUUID()}@example.test`, 'Roof-test-password!');
  await accounts.select(session.account.id, 0);
  const client: any = { sessionId: 'roof-test', auth: await accounts.session(session.token), send() {}, leave() {} };
  const room = new LobbyRoom(), handlers = new Map<string, (client: any, data: unknown) => void>();
  context.mock.method(room, 'onMessage', (name: string, callback: any) => { handlers.set(name, callback); });
  context.mock.method(room, 'setPatchRate', () => {}); context.mock.method(room, 'setSimulationInterval', () => {});
  context.mock.method(room, 'broadcast', () => {}); context.mock.method(room.clock, 'setInterval', () => ({ clear() {} }));
  room.onCreate(); await room.onJoin(client, {}, client.auth);
  const enter = () => Reflect.get(room, 'enterDoor').call(room, client.sessionId);
  try {
    const p = room.state.players.get(client.sessionId)!;
    Object.assign(p, { hall: 'street', ...STREET_ROOF_STAIRS.foot }); assert.equal(enter(), false);
    Object.assign(p, STREET_ROOF_STAIRS.entry); assert.equal(enter(),false,'walking straight to the top does not bypass the flights');
    Object.assign(p, STREET_ROOF_STAIRS.foot);
    for (const state of [{ playing: true }, { security: 'ejecting' }, { seat: 'occupied' }, { action: 'drink' }, { connected: false }]) {
      const saved = Object.fromEntries(Object.keys(state).map(key => [key, Reflect.get(p, key)]));
      Object.assign(p, state); assert.equal(enter(), false); Object.assign(p, saved);
    }
    const revision = p.hallRevision;
    assert.equal(enter(),false);
    assert.equal(p.stairStep,1);
    Object.assign(p,{x:(ROOF_STAIR_ROUTE[1].x+ROOF_STAIR_ROUTE[2].x)/2,y:(ROOF_STAIR_ROUTE[1].y+ROOF_STAIR_ROUTE[2].y)/2,stairStep:2});
    const held={x:p.x,y:p.y,step:p.stairStep};
    handlers.get('target')!(client,{revision,x:2300,y:1000});Reflect.get(room,'tick').call(room,.05);
    assert.deepEqual({x:p.x,y:p.y,step:p.stairStep},held,'a legacy ground target cannot pull a person off a flight');
    handlers.get('move')!(client,{revision,x:-1,y:0});Reflect.get(room,'tick').call(room,.05);
    assert(p.x<held.x&&p.y>held.y,'a reverse legacy direction walks back along the flight');
    assert.equal(p.stairStep,held.step);assert.equal(p.stairDirection,-1);
    handlers.get('stop')!(client,{});Object.assign(p,{...STREET_ROOF_STAIRS.foot,stairStep:1,stairDirection:1});
    for(let segment=1;segment<ROOF_STAIR_ROUTE.length&&p.hall==='street';segment++){
      const from=ROOF_STAIR_ROUTE[segment-1],to=ROOF_STAIR_ROUTE[segment],steps=Math.ceil(Math.hypot(to.x-from.x,to.y-from.y)/3);
      for(let step=1;step<=steps&&p.hall==='street';step++){
        Object.assign(p,{x:from.x+(to.x-from.x)*step/steps,y:from.y+(to.y-from.y)*step/steps});
        enter();
      }
    } assert.equal(p.hall, 'roof'); assert.equal(p.hallRevision, revision + 1);
    assert.equal(p.x, ROOF.spawn.x); assert.equal(p.y, ROOF.spawn.y); assert.equal(enter(), false);
    handlers.get('inputs')!(client, { revision, inputs: [{ seq: 1, x: 1, y: 0, ms: 50 }] });
    Reflect.get(room, 'tick').call(room, .05); assert.equal(p.x, ROOF.spawn.x);
    Object.assign(p, ROOF_STAIRS.entry); assert.equal(enter(), true);
    assert.equal(p.hall, 'street'); assert.equal(p.hallRevision, revision + 2);
    assert.equal(p.x, STREET_ROOF_STAIRS.arrival.x); assert.equal(p.y, STREET_ROOF_STAIRS.arrival.y); assert.equal(enter(), false);
  } finally { room.onDispose(); room.clock.clear(); await accounts.logout(session.token); }
});


test('switchback qualification requires every flight and rejects positions off its route',()=>{
  const obstacles=hallObstacles('street');let progress=0;const reached=new Set<number>();
  for(let segment=1;segment<ROOF_STAIR_ROUTE.length;segment++){
    const from=ROOF_STAIR_ROUTE[segment-1],to=ROOF_STAIR_ROUTE[segment],steps=Math.ceil(Math.hypot(to.x-from.x,to.y-from.y)/3);
    for(let step=0;step<=steps;step++){
      const point={x:from.x+(to.x-from.x)*step/steps,y:from.y+(to.y-from.y)*step/steps};
      assert(walkable(point.x,point.y,obstacles,16));
      progress=advanceRoofStairStep(progress,point);reached.add(progress);
    }
  }
  assert.equal(progress,ROOF_STAIR_ROUTE.length);
  for(let step=1;step<=ROOF_STAIR_ROUTE.length;step++)assert(reached.has(step));
  assert.equal(advanceRoofStairStep(0,STREET_ROOF_STAIRS.entry),0);
  assert.equal(advanceRoofStairStep(1,ROOF_STAIR_ROUTE[5]),0,'cannot jump to a later flight');
  assert.equal(advanceRoofStairStep(3,{x:1660,y:360}),0,'the normal underpass does not earn a landing');
  assert.equal(advanceRoofStairStep(2,{x:1900,y:700}),0);
  assert.equal(advanceRoofStairStep(999,STREET_ROOF_STAIRS.entry),0);
});

function stairBody():MovementBody {
  return {hall:'street',...STREET_ROOF_STAIRS.foot,stairStep:1,stairDirection:1,facing:'up',moving:false,seat:'',action:'idle',drink:'',actionUntil:0};
}

test('manual horizontal stair input follows every flight and stops on release at its exact landing',()=>{
  const body=stairBody();let sequence=0;
  for(let step=1;step<ROOF_STAIR_ROUTE.length;step++){
    assert.equal(body.stairStep,step);
    const a=ROOF_STAIR_ROUTE[step-1],b=ROOF_STAIR_ROUTE[step];
    const correct={x:Math.sign(b.x-a.x),y:b.x===a.x?-1:0};
    for(let frame=0;body.stairStep===step&&frame<100;frame++)applyMovementInput(body,{seq:++sequence,...correct,ms:50});
    assert.equal(body.stairStep,step+1);assert.deepEqual({x:body.x,y:body.y},b,'landing is reached exactly');
    const before={x:body.x,y:body.y,step:body.stairStep};
    applyMovementInput(body,{seq:++sequence,x:0,y:0,ms:50});
    assert.deepEqual({x:body.x,y:body.y,step:body.stairStep},before,'releasing a key stops ascent');
  }
  assert.equal(body.stairStep,ROOF_STAIR_ROUTE.length);
});

test('approaching the lower ladder from either side guides into it without a precision alignment',()=>{
  for(const side of [-1,1])for(const upward of [false,true]){
    const body={...stairBody(),stairStep:0,x:STREET_ROOF_STAIRS.foot.x+side*54,y:STREET_ROOF_STAIRS.foot.y-20};
    const input=upward?{x:0,y:1}:{x:-side,y:0};
    for(let frame=0;frame<100&&!body.stairStep;frame++)applyMovementInput(body,{seq:frame+1,...input,ms:16});
    assert.equal(body.stairStep,1);assert.equal(body.x,STREET_ROOF_STAIRS.foot.x);assert.equal(body.y,STREET_ROOF_STAIRS.foot.y);
  }
});

test('a held side-entry Up input captures the ladder at the same point before and after server validation',()=>{
  const local={...stairBody(),stairStep:0,x:1606,y:460},server={...local};
  for(let frame=0;frame<90;frame++){
    const input={seq:frame+1,x:0,y:local.stairStep? -1:1,ms:16};
    applyMovementInput(local,input);applyMovementInput(server,input);
    const before=server.stairStep;server.stairStep=advanceRoofStairStep(before,server);
    if(!before&&server.stairStep===1){server.x=STREET_ROOF_STAIRS.foot.x;server.y=STREET_ROOF_STAIRS.foot.y;server.stairDirection=1;}
    assert(Math.hypot(local.x-server.x,local.y-server.y)<1e-8);assert.equal(local.stairStep,server.stairStep);
  }
  assert(local.stairStep>1);
});

test('ordinary rear circulation, walking away and clicks beside the ladder do not capture it',()=>{
  const body={...stairBody(),stairStep:0,x:1550,y:360};
  for(let frame=0;frame<100;frame++)applyMovementInput(body,{seq:frame+1,x:1,y:0,ms:16});
  assert.equal(body.stairStep,0);assert(body.x>1750);
  Object.assign(body,{x:STREET_ROOF_STAIRS.foot.x+40,y:STREET_ROOF_STAIRS.foot.y-20});
  applyMovementInput(body,{seq:101,x:1,y:0,ms:50});assert(body.x>STREET_ROOF_STAIRS.foot.x+40);assert.equal(body.stairStep,0);
  Object.assign(body,{x:1660,y:360});const target={x:1608,y:464};
  for(let frame=0;frame<200;frame++){
    const dx=target.x-body.x,dy=target.y-body.y,length=Math.hypot(dx,dy);if(length<.01)break;
    applyMovementInput(body,{seq:frame+102,x:dx/length,y:dy/length,route:true,ms:Math.min(16,length/155*1000)});
  }
  assert.equal(body.stairStep,0);assert(Math.hypot(body.x-target.x,body.y-target.y)<.01);
});

test('every flight permits an immediate reverse and a complete descent through all lower landings',()=>{
  for(let step=1;step<ROOF_STAIR_ROUTE.length;step++){
    const a=ROOF_STAIR_ROUTE[step-1],b=ROOF_STAIR_ROUTE[step];
    const body={...stairBody(),stairStep:step,x:(a.x+b.x)/2,y:(a.y+b.y)/2};
    const reverse={x:b.x===a.x?0:-Math.sign(b.x-a.x),y:b.x===a.x?1:0};
    const start={x:body.x,y:body.y};applyMovementInput(body,{seq:1,...reverse,ms:16});
    assert.equal(body.stairDirection,-1);assert(Math.hypot(body.x-a.x,body.y-a.y)<Math.hypot(start.x-a.x,start.y-a.y));
    assert.equal(advanceRoofStairStep(body.stairStep,body),body.stairStep,'validation retains reverse progress');
    applyMovementInput(body,{seq:2,x:-reverse.x,y:-reverse.y,ms:16});
    assert(Math.hypot(body.x-start.x,body.y-start.y)<1e-8);assert.equal(body.stairDirection,1);
  }
  const last=ROOF_STAIR_ROUTE.length-1,a=ROOF_STAIR_ROUTE[last-1],b=ROOF_STAIR_ROUTE[last];
  const body={...stairBody(),stairStep:last,x:(a.x+b.x)/2,y:(a.y+b.y)/2},visited=new Set<number>();
  for(let frame=0;frame<1000&&body.stairStep;frame++){
    const previous=body.stairStep;visited.add(previous);applyMovementInput(body,{seq:frame+1,x:0,y:1,ms:50});
    assert(body.stairStep<=previous);assert.equal(advanceRoofStairStep(body.stairStep,body),body.stairStep);
  }
  assert.equal(body.stairStep,0);for(let step=1;step<=last;step++)assert(visited.has(step));
  assert(walkable(body.x,body.y,hallObstacles('street'),16));
});

test('prediction and acknowledgement replay retain descending direction across switchback landings',()=>{
  const step=8,a=ROOF_STAIR_ROUTE[step-1],b=ROOF_STAIR_ROUTE[step];
  const local={...stairBody(),stairStep:step,x:(a.x+b.x)/2,y:(a.y+b.y)/2},server={...local},prediction=new MovementPrediction();let acknowledged=0;
  for(let frame=0;frame<1000&&local.stairStep;frame++){
    prediction.step(local,0,1,16);
    if(frame%3===0){
      prediction.flush(batch=>{for(const input of batch){applyMovementInput(server,input);acknowledged=input.seq;}});
      const replay=prediction.reconcile(server,acknowledged);
      assert(Math.hypot(replay.x-local.x,replay.y-local.y)<1e-8);assert.equal(replay.stairStep,local.stairStep);assert.equal(replay.stairDirection,local.stairDirection);
    }
  }
  assert.equal(local.stairStep,0);
});

test('the lower ladder can be backed down safely onto the pavement',()=>{
  const body=stairBody();
  for(let n=0;n<6;n++)applyMovementInput(body,{seq:n+1,x:0,y:-1,ms:50});
  assert.equal(body.stairStep,1);assert(body.y<STREET_ROOF_STAIRS.foot.y);
  for(let n=0;n<10&&body.stairStep;n++)applyMovementInput(body,{seq:n+7,x:0,y:1,ms:50});
  assert.equal(body.stairStep,0);assert(body.y<STREET_ROOF_STAIRS.foot.y-7);
  assert(walkable(body.x,body.y,hallObstacles('street'),16));
});

test('prediction and replay keep paused and moving stair positions on the same flight',()=>{
  const prediction=new MovementPrediction(),local=stairBody(),server=stairBody();let acknowledged=0;
  for(let frame=0;frame<500&&local.stairStep!<ROOF_STAIR_ROUTE.length;frame++){
    const step=local.stairStep!,a=ROOF_STAIR_ROUTE[step-1],b=ROOF_STAIR_ROUTE[step];
    const correct={x:Math.sign(b.x-a.x),y:b.x===a.x?-1:0};
    const input=frame%4===0?{x:0,y:0}:frame%7===0?{x:1,y:1}:correct;
    prediction.step(local,input.x,input.y,16);
    if(frame%3===0){
      prediction.flush(batch=>{for(const input of batch){applyMovementInput(server,input);acknowledged=input.seq;}});
      const replay=prediction.reconcile(server,acknowledged);
      assert(Math.hypot(replay.x-local.x,replay.y-local.y)<1e-8);assert.equal(replay.stairStep,local.stairStep);
    }
  }
  assert(local.stairStep!>2);
});

test('all long escape flights align with their drawn treads and the final roof edge',()=>{
  const view=new StreetView();view.configure({x:1660,y:360},false);
  const route=ROOF_STAIR_ROUTE.map(p=>view.point(p,true));
  assert(route.length>=12);assert(route[0].y-route.at(-1)!.y>1500);
  assert.equal(route.at(-1)!.y,view.roofEdge);
  for(let step=1;step<route.length;step++)for(let sample=0;sample<=20;sample++){
    const t=sample/20,a=ROOF_STAIR_ROUTE[step-1],b=ROOF_STAIR_ROUTE[step];
    const p=view.point({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t},true);
    assert(Math.hypot(p.x-route[step-1].x-(route[step].x-route[step-1].x)*t,p.y-route[step-1].y-(route[step].y-route[step-1].y)*t)<1e-8);
  }
});

test('returning from the roof or reconnecting at the ladder restores the rear view without an early corner cut',()=>{
  const view=new StreetView();view.arrive(STREET_ROOF_STAIRS.arrival);view.configure(STREET_ROOF_STAIRS.arrival,false);
  assert.equal(view.side,'rear');
  view.arrive(ROOF_STAIR_ROUTE[4]);assert.equal(view.side,'rear');
  view.arrive({x:840,y:1030});assert.equal(view.side,'front');
  view.configure({x:636,y:360},false);assert.equal(view.side,'front');
});
