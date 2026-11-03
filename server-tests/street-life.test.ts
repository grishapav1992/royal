import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StreetLife } from '../src/game/StreetLife';
import { STREET_OBSTACLES } from '../src/shared/street';
import { walkable } from '../src/game/navigation';
import { findPath } from '../src/game/navigation';
import { STREET } from '../src/shared/street';
import { STREET_RESIDENTS, StreetConversations, streetViewOffset } from '../src/game/streetDetails';
import { parseAppearance } from '../src/shared/appearance';
import { streetResidentPose } from '../src/game/StreetResidentActions';
import { StreetResidentPatrols, STREET_PATROLS } from '../src/game/StreetResidentPatrols';

test('street pedestrians stay on the pavement and traffic stays in separate road lanes', () => {
  const life=new StreetLife(),visibility=new Map<string,Set<boolean>>();
  for(let tick=0;tick<10000;tick++){
    const state=life.advance(50);
    for(const person of state.pedestrians)assert(walkable(person.x,person.y,STREET_OBSTACLES,16),person.id+' has a safe walking route');
    for(const car of state.cars){
      assert(car.y-78>=1210,'car artwork stays below the kerb');
      const seen=visibility.get(car.id)??new Set<boolean>();seen.add(car.visible);visibility.set(car.id,seen);
    }
    const lane=state.cars.filter(car=>car.visible&&car.direction===1);
    if(lane.length===2)assert(Math.abs(lane[0].x-lane[1].x)>190,'same-lane cars never overlap');
    assert(state.sign.sheen>=0&&state.sign.sheen<=.24);
    assert(state.sign.sparkle>=0&&state.sign.sparkle<=.72);
  }
  for(const seen of visibility.values())assert.deepEqual(seen,new Set([true,false]),'cars periodically leave the scene');
});

test('hidden and reduced-motion street ambience freezes without queued travel or light effects', () => {
  const life=new StreetLife();
  const before=life.advance(50);
  for(const options of [{paused:true},{reducedMotion:true}]){
    const paused=life.advance(60000,options);
    assert.equal(paused.time,before.time);
    assert.deepEqual(paused.cars,before.cars);
    assert.deepEqual(paused.pedestrians.map(p=>[p.x,p.y]),before.pedestrians.map(p=>[p.x,p.y]));
    assert(paused.pedestrians.every(p=>!p.moving));
    assert.equal(paused.sign.sheen,0);assert.equal(paused.sign.sparkle,0);
  }
  assert.equal(life.advance(60000).time,before.time+50,'resume never catches up a wall-clock gap');
  const time=life.snapshot().time;
  for(const delta of [NaN,Infinity,-1])life.advance(delta);
  assert.equal(life.snapshot().time,time);
});

test('each street resident has a valid outfit and a clear approach outside the perimeter lane',()=>{
  for(const person of STREET_RESIDENTS){
    assert(parseAppearance(person.appearance),person.id+' has a supported outfit');
    assert(walkable(person.x,person.y,STREET_OBSTACLES,16));
    const path=findPath(STREET.spawn,person.approach,STREET_OBSTACLES);
    assert(path.length,person.id+' can be reached without crossing the building or road');
    assert.deepEqual(path.at(-1),person.approach);
    assert(Math.hypot(person.approach.x-person.x,person.approach.y-person.y)<112);
  }
});

test('resident conversations require proximity and close on walking away or entering the casino',()=>{
  const dialogue=new StreetConversations(),person=STREET_RESIDENTS[0];
  assert(!dialogue.talk(person.id),'a hidden street cannot start a conversation');
  dialogue.update(STREET.spawn,true);assert(!dialogue.talk(person.id),'distant clicks must approach first');
  dialogue.update(person.approach,true);assert(dialogue.talk(person.id));
  assert.equal(dialogue.snapshot().line,0);dialogue.next();assert.equal(dialogue.snapshot().line,1);
  dialogue.next();dialogue.next();assert.equal(dialogue.snapshot().line,0,'short conversation wraps without new actions');
  dialogue.update({x:person.x+141,y:person.y},true);assert.equal(dialogue.snapshot().conversation,null);
  dialogue.update(person.approach,true);dialogue.talk(person.id);
  dialogue.update(person.approach,false);assert.equal(dialogue.snapshot().conversation,null);assert.equal(dialogue.snapshot().nearby,null);
});

test('a ladder visitor cannot talk to ground residents at the same map coordinates and can talk after returning',()=>{
  const dialogue=new StreetConversations(),people=[{id:'janitor' as const,x:1750,y:320}],point={x:1750,y:408};
  dialogue.update(point,true,people);assert(dialogue.talk('janitor'),'the ground conversation is in range');
  for(let stairStep=1;stairStep<=12;stairStep++){
    const state=dialogue.update({...point,stairStep},true,people);
    assert.equal(state.active,false);assert.equal(state.nearby,null);assert.equal(state.conversation,null);
    assert.equal(dialogue.talk('janitor'),false,'a matching map radius does not allow a conversation above ground');
  }
  dialogue.update({...point,stairStep:0},true,people);
  assert(dialogue.talk('janitor'),'conversation becomes available again on the ground');
});

test('the rear camera frames the service area without a jump at either corner',()=>{
  for(const height of [500,806]){
    assert(streetViewOffset(1030,height)>=0);
    assert(streetViewOffset(360,height)<=0);
    for(let y=350;y<1050;y++)assert(Math.abs(streetViewOffset(y+1,height)-streetViewOffset(y,height))<1);
  }
});

test('resident routines vary their actions and become static during conversation or reduced motion',()=>{
  const actions=new Map(STREET_RESIDENTS.map(p=>[p.id,new Set<string>()]));
  for(let time=0;time<60000;time+=100){
    for(const person of STREET_RESIDENTS){
      const pose=streetResidentPose(person.id,time,true);
      actions.get(person.id)!.add(pose.action);
      assert(pose.progress>=0&&pose.progress<1);
      assert(pose.frame>=6&&pose.frame<=16);
      for(const [motion,talking] of [[false,false],[true,true]]){
        assert.deepEqual(streetResidentPose(person.id,time,motion,talking),{action:'idle',progress:0,frame:6});
      }
    }
  }
  for(const action of ['clear-snow','tap-shovel','rest','look-around'])assert(actions.get('janitor')!.has(action));
  for(const action of ['coffee','smoke','check-watch','look-around'])assert(actions.get('taxi-driver')!.has(action));
  for(const action of ['frame-photo','take-photo','review-photo'])assert(actions.get('tourist')!.has(action));
  for(const action of ['wave','pose','rest'])assert(actions.get('mascot')!.has(action));
});

test('working residents visit several safe places while the entrance and perimeter remain clear',()=>{
  const patrols=new StreetResidentPatrols(),visits=new Map(['tourist','janitor','mascot'].map(id=>[id,new Set<number>()]));
  const photos=new Set<number>(),cleaned=new Set<number>();
  let previous=patrols.snapshot();
  for(let tick=0;tick<12000;tick++){
    const people=patrols.advance(50);
    for(const person of people){
      assert(walkable(person.x,person.y,STREET_OBSTACLES,16),person.id+' stays on pavement');
      assert(!(person.x>744&&person.x<946&&person.y>899&&person.y<1031),'residents keep the doorway approach clear');
      const before=previous.find(p=>p.id===person.id)!;
      assert(Math.hypot(person.x-before.x,person.y-before.y)<=(STREET_PATROLS[person.id]?.speed??0)*.05+.001,'no teleports between stops');
      if(!person.moving)visits.get(person.id)?.add(person.stop);
      const action=streetResidentPose(person.id,person.workTime,true).action;
      if(!person.moving&&person.id==='tourist'&&action==='take-photo')photos.add(person.stop);
      if(!person.moving&&person.id==='janitor'&&action==='clear-snow')cleaned.add(person.stop);
      if(person.id==='mascot')assert(person.x-52>882+48,'costume never occupies the entrance corridor');
    }
    previous=people;
  }
  assert.equal(photos.size,5);assert.equal(cleaned.size,5);
  assert.equal(visits.get('mascot')!.size,4);
});

test('a moving resident can be stopped at its actual position for an approach and conversation',()=>{
  const patrols=new StreetResidentPatrols();
  for(let n=0;n<310;n++)patrols.advance(50);
  const person=patrols.snapshot().find(p=>p.id==='tourist')!;
  assert(person.moving);assert(person.x>1500);
  const point=patrols.approach('tourist',STREET.spawn)!;assert(point);assert(walkable(point.x,point.y,STREET_OBSTACLES,16));
  const dialogue=new StreetConversations();
  for(let n=0;n<100;n++)patrols.advance(50,{frozen:['tourist']});
  const stopped=patrols.snapshot().find(p=>p.id==='tourist')!;
  assert.equal(stopped.x,person.x);assert.equal(stopped.y,person.y);
  dialogue.update(point,true,patrols.snapshot());assert(dialogue.talk('tourist'));
  for(let n=0;n<100;n++)patrols.advance(50,{motion:false});
  assert.equal(patrols.snapshot().find(p=>p.id==='tourist')!.x,stopped.x);
  patrols.advance(50);assert(patrols.snapshot().find(p=>p.id==='tourist')!.x>stopped.x,'walking resumes from the same position');
});

test('the mascot greets a nearby passer with a pause and a bounded greeting rate',()=>{
  const patrols=new StreetResidentPatrols(),first=patrols.snapshot().find(p=>p.id==='mascot')!;
  assert(!patrols.advance(50).find(p=>p.id==='mascot')!.greeting);
  const passers=[{x:first.x-100,y:first.y+40}];
  const greeting=patrols.advance(50,{passers}).find(p=>p.id==='mascot')!;
  assert(greeting.greeting);
  for(let n=0;n<20;n++)patrols.advance(50,{passers});
  const during=patrols.snapshot().find(p=>p.id==='mascot')!;
  assert.equal(during.x,greeting.x);assert.equal(during.y,greeting.y);
  let previous=true,starts=1;
  for(let n=0;n<200;n++){const current=patrols.advance(50,{passers}).find(p=>p.id==='mascot')!.greeting;if(current&&!previous)starts++;previous=current;}
  assert(starts<=2,'a nearby passer cannot queue greetings each frame');
});

test('all street viewpoints keep the same world anchors and invert clicks and directions',async()=>{
  const {projectStreetPoint,unprojectStreetPoint,streetDirection}=await import('../src/game/streetView');
  const points=[STREET.spawn,...STREET.loop,...STREET_RESIDENTS];
  for(const side of ['front','rear'] as const){
    for(const point of points)assert.deepEqual(unprojectStreetPoint(projectStreetPoint(point,side),side),{x:point.x,y:point.y});
    for(const point of [{x:1,y:0},{x:0,y:-1},{x:1,y:1}])assert.deepEqual(streetDirection(streetDirection(point,side),side,true),point);
  }
});

test('the street keeps its front orientation along either side and hides traffic in the rear courtyard',async()=>{
  const {StreetView}=await import('../src/game/streetView');
  const taxi={x:2580,y:1120},views=[{point:{x:840,y:1030},side:'front',taxi:true},{point:{x:2320,y:710},side:'front',taxi:true},{point:{x:1370,y:360},side:'rear',taxi:false},{point:{x:480,y:710},side:'front',taxi:true}] as const;
  for(const expected of views){const view=new StreetView();view.configure(expected.point,false);assert.equal(view.side,expected.side);assert.equal(view.visible(taxi),expected.taxi);assert.deepEqual(view.world(view.point(taxi)),taxi);}
});

test('the courtyard opens only after clearing a rear corner, with a full-width rear wall',async()=>{
  const {StreetView}=await import('../src/game/streetView');
  for(const direction of [-1,1]){
    const view=new StreetView(),edge=direction<0?STREET.building.x:STREET.building.x+STREET.building.w,outside=edge+direction*140,inside=edge-direction*60;
    for(const y of [1050,710,500,360]){view.configure({x:outside,y},false);assert.equal(view.side,'front');assert.equal(view.angle,0);}
    view.configure({x:edge,y:360},false);assert.equal(view.side,'front','touching the corner does not turn the map');
    view.configure({x:inside,y:360},false);assert.equal(view.side,'rear');assert.equal(view.wall.width,STREET.building.w);
    view.configure({x:outside,y:360},false);assert.equal(view.side,'rear','leaving the courtyard has its own complete corner crossing');
    view.configure({x:outside,y:600},false);assert.equal(view.side,'front');
  }
});

test('the rear escape rises on the exterior wall while overview retains the actual map path',async()=>{
  const {StreetView}=await import('../src/game/streetView');const {ROOF_STAIR_ROUTE}=await import('../src/shared/rooftop');
  const view=new StreetView();view.configure({x:1660,y:360},false);
  assert(view.point(ROOF_STAIR_ROUTE[0],true).y>view.wall.base);
  assert(view.point(ROOF_STAIR_ROUTE.at(-1)!,true).y<view.wall.base);
  view.configure({x:1660,y:360},true);assert.equal(view.orientation,'front');
  for(const point of ROOF_STAIR_ROUTE)assert.deepEqual(view.point(point,true),point);
});

test('the facade covers people progressively before the rear corner changes view',async()=>{
  const {StreetView}=await import('../src/game/streetView');
  for(const edge of ['left','right'] as const){
    const view=new StreetView(),partial={x:edge==='left'?636:2084,y:360},hidden={x:edge==='left'?656:2064,y:360},rear={x:edge==='left'?688:2032,y:360};
    for(const p of [partial,hidden]){view.configure(p,false);assert.equal(view.side,'front');assert.deepEqual(view.point(p),p);assert(view.depth(p)<view.wall.base);}
    assert.equal(view.occluded(partial),false);assert.equal(view.occluded(hidden),true);
    view.configure(rear,false);assert.equal(view.side,'rear');assert.equal(view.occluded(rear),false);
  }
});

test('street screen positions and clicks use the original coordinates without sidewalk shifts',async()=>{
  const {StreetView,projectStreetPoint}=await import('../src/game/streetView');
  for(const side of ['front','rear'] as const){const view=new StreetView();view.side=side;
    for(const y of [360,470,488,500,560,700,920,970,1040])for(let x=300;x<=2550;x+=10){const p={x,y};assert.deepEqual(view.point(p),projectStreetPoint(p,side));assert.deepEqual(view.world(view.point(p)),p);}
  }
});

test('resident patrols use the same below-facade layer when passing behind the building',async()=>{
  const {StreetView}=await import('../src/game/streetView');const patrols=new StreetResidentPatrols();
  const views=(['front','rear'] as const).map(side=>{const view=new StreetView();view.side=side;return view;});
  for(let step=0;step<6000;step++)for(const person of patrols.advance(50))for(const view of views){const p=view.point(person);assert.equal(view.depth(person),p.y);if(p.y<view.wall.base)assert(view.depth(person)<view.wall.base);}
});
