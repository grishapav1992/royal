import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CatRoutine, catApproachPoint, canHearCat, CAT_HEARING_DISTANCE, type CatPerson } from '../src/shared/cat';
import { CAT_HOME } from '../src/shared/catHome';
import { CAT_CARE } from '../src/shared/catCare';
import { hallObstacles, hallLinks } from '../src/shared/world';
import { walkable } from '../src/game/navigation';
import { LobbyState, Player } from '../server/state';
import { RoomCat } from '../server/cat';
import { CAT_SURFACES,catSurface,canCatUseSurface,CAT_MAX_JUMP_HEIGHT } from '../src/shared/catSurfaces';
import { CABINETS } from '../src/shared/cabinets';
import { cabinetSeat } from '../src/shared/cabinetSeating';
import { isCardGame } from '../src/shared/cardTables';

const person = (id='one'): CatPerson => ({ id, hall:'arcade',...CAT_HOME.approach,connected:true });
const advance = (cat: CatRoutine, seconds: number, people: CatPerson[] = []) => {
  for (let elapsed=0;elapsed<seconds-.000001;elapsed+=.1) cat.tick(Math.min(.1,seconds-elapsed),people);
};
function floorCat(cat:CatRoutine) {
  for(let i=0;i<8000;i++) {
    const view=cat.snapshot();
    if(!view.onPillow&&!view.onBar&&view.mood==='walking')return view;
    cat.tick(.1);
  }
  throw new Error('Cat did not start walking');
}

test('one continuous tour reaches every hall and returns to her pillow without crossing furniture', () => {
  const cat=new CatRoutine(), halls=new Set<string>(), habits=new Set<string>();
  let previous=cat.snapshot(), returned=false, left=false;
  for(let i=0;i<6000;i++) {
    cat.tick(.1);const view=cat.snapshot();halls.add(view.hall);habits.add(view.mood);
    if(view.hall!==previous.hall) {
      const link=hallLinks(previous.hall).find(link=>link.target===view.hall);
      assert(link,'only connected halls can be crossed');
      assert(Math.hypot(previous.x-link.door.entry.x,previous.y-link.door.entry.y)<15);
    } else if(view.mood!=='jumping'&&previous.mood!=='jumping') {
      assert(Math.hypot(view.x-previous.x,view.y-previous.y)<12,'walking never teleports');
    }
    if(view.onBar&&view.mood!=='jumping') {
      assert.equal(view.hall,CAT_CARE.hall);assert.equal(view.mood,'drinking');
      assert.equal(view.x,CAT_CARE.bar.perch.x);assert.equal(view.y,CAT_CARE.bar.perch.y);
    }
    if(view.surfaceId&&view.mood!=='jumping') {
      const surface=catSurface(view.surfaceId)!;assert(surface,'only registered furniture is used');
      assert.equal(view.x,surface.perch.x);assert.equal(view.y,surface.perch.y);
    }
    if(!view.surfaceId&&view.mood!=='jumping') {
      left=true;assert(walkable(view.x,view.y,hallObstacles(view.hall)),'cat walks around furniture');
    }
    if(left&&view.onPillow&&view.mood==='sleeping')returned=true;
    previous=view;
  }
  assert.deepEqual([...halls].sort(),['arcade','github','tables']);assert(returned);
  for(const mood of ['belly-up','eating-bowl','drinking','perched','scratching'])assert(habits.has(mood),mood+' happens naturally');
});

test('she sharpens her claws at her own post, finishes undisturbed and continues her route',()=>{
  const cat=new CatRoutine(),point=CAT_CARE.scratcher.approach;
  assert(walkable(point.x,point.y,hallObstacles(CAT_CARE.hall),18));
  assert(!walkable(CAT_CARE.scratcher.post.x,CAT_CARE.scratcher.post.y,hallObstacles(CAT_CARE.hall),0));
  for(let i=0;i<8000&&cat.snapshot().mood!=='scratching';i++)cat.tick(.1);
  const start=cat.snapshot();assert.equal(start.mood,'scratching');assert.equal(start.hall,CAT_CARE.hall);
  assert.equal(start.x,point.x);assert.equal(start.y,point.y);assert.equal(start.facing,'right');assert.equal(start.surfaceId,'');
  for(const action of ['pet','feed','call','hug']) {
    const before=cat.snapshot();cat.interact(action,{...person(action),...point});assert.deepEqual(cat.snapshot(),before);
  }
  advance(cat,7);assert.equal(cat.snapshot().mood,'scratching');
  advance(cat,5.5);assert.equal(cat.snapshot().mood,'walking');
  assert(walkable(cat.snapshot().x,cat.snapshot().y,hallObstacles(cat.snapshot().hall)));
});

test('jumping surfaces have reachable exits, enough room and a bounded height',()=>{
  const usable=CAT_SURFACES.filter(surface=>canCatUseSurface(surface));
  for(const kind of ['cabinet','sofa','table'])assert(usable.some(surface=>surface.kind===kind),kind+' is available');
  for(const surface of usable) {
    assert(surface.height<=CAT_MAX_JUMP_HEIGHT);assert(surface.width>=46);
    assert(walkable(surface.approach.x,surface.approach.y,hallObstacles(surface.hall),18));
    assert(!canCatUseSurface({...surface,height:CAT_MAX_JUMP_HEIGHT+1}));
    assert(!canCatUseSurface({...surface,width:20}));
    assert(!canCatUseSurface(surface,[{hall:surface.hall,...surface.perch}]));
  }
});

function playerAtCabinet(id:string,cabinetId:string):CatPerson {
  const cabinet=CABINETS.find(c=>c.id===cabinetId)!;
  return {id,hall:cabinet.hall??'arcade',...cabinetSeat(cabinet),playing:true,cabinet:cabinetId,connected:true};
}

test('players at all seven card tables can hear their visiting cat beyond interaction range',()=>{
  const tables=CABINETS.filter(cabinet=>isCardGame(cabinet.id));
  assert.equal(tables.length,7);
  for(const table of tables) {
    const cat=new CatRoutine(),player=playerAtCabinet('listener',table.id);
    for(let i=0;i<10000&&cat.snapshot().mood!=='purring';i++)cat.tick(.1,[player]);
    const view=cat.snapshot(),approach=catApproachPoint(view);
    assert.equal(view.mood,'purring',table.id);assert.equal(view.targetId,player.id);
    assert.equal(view.surfaceId,'cabinet:'+table.id);
    assert(Math.hypot(player.x-approach.x,player.y-approach.y)>100,'the seated player remains outside interaction range');
    assert(canHearCat(view,player),table.id+' must hear her purr');
    assert(!canHearCat(view,{...player,hall:player.hall==='arcade'?'github':'arcade'}),'sound never crosses halls');
    assert(!canHearCat(view,{...player,x:view.x+CAT_HEARING_DISTANCE+1,y:view.y}),'distant players cannot hear her');
  }
});

test('cat hearing uses her position and its own bounded radius',()=>{
  const cat=new CatRoutine().snapshot();
  assert(canHearCat(cat,{...cat,x:cat.x+CAT_HEARING_DISTANCE}));
  assert(!canHearCat(cat,{...cat,x:cat.x+CAT_HEARING_DISTANCE+1}));
  const cabinet=catSurface('cabinet:royal-fruits')!;
  assert(canHearCat({...cabinet.perch,hall:cabinet.hall},playerAtCabinet('listener','royal-fruits')));
});

test('she visits a playing person, jumps onto their cabinet and purrs without moving the player',()=>{
  const cat=new CatRoutine(),player=playerAtCabinet('playing','royal-fruits'),original={...player};
  let climbed=false,landed=false,left=false,returnedHome=false,prior=cat.snapshot();
  for(let i=0;i<10000;i++) {
    cat.tick(.1,[player]);const view=cat.snapshot();
    if(view.surfaceId==='cabinet:royal-fruits'&&view.mood==='jumping'&&!view.jumpingDown) {
      climbed=true;assert(Math.hypot(view.x-prior.x,view.y-prior.y)<22,'the jump is continuous');
    }
    if(view.mood==='purring') {
      assert.equal(view.surfaceId,'cabinet:royal-fruits');assert.equal(view.targetId,player.id);
      const surface=catSurface(view.surfaceId)!;assert.equal(view.x,surface.perch.x);assert.equal(view.y,surface.perch.y);
      if(!landed)assert.equal(cat.interact('hug',{...person('bystander'),...surface.approach}).includes('погладить'),true);
      landed=true;
    }
    if(landed&&view.jumpingDown)left=true;
    if(left&&view.onPillow&&view.mood==='sleeping'){returnedHome=true;break;}
    prior=view;
  }
  assert(climbed);assert(landed);assert(left);assert(returnedHome,'visits do not replace the home routine');assert.deepEqual(player,original);
});

test('a visit ends safely when the player stops, disconnects or changes floors',()=>{
  for(const reason of ['stop','disconnect','hall','different-cabinet'] as const) {
    const cat=new CatRoutine(),player=playerAtCabinet('playing','royal-fruits');
    for(let i=0;i<8000&&cat.snapshot().mood!=='purring';i++)cat.tick(.1,[player]);
    assert.equal(cat.snapshot().mood,'purring');
    if(reason==='stop')player.playing=false;
    if(reason==='disconnect')player.connected=false;
    if(reason==='hall')player.hall='tables';
    if(reason==='different-cabinet')player.cabinet='royal-dice';
    cat.tick(.1,[player]);assert.equal(cat.snapshot().jumpingDown,true);
    assert.equal(cat.snapshot().surfaceId,'cabinet:royal-fruits');
    advance(cat,1.8,[player]);const view=cat.snapshot();
    assert.equal(view.surfaceId,'');assert.equal(view.hall,'arcade');assert(walkable(view.x,view.y,hallObstacles(view.hall)));
  }
});

test('a canceled approach never leaves a floating cat and visits include card tables on other floors',()=>{
  const cat=new CatRoutine(),player=playerAtCabinet('playing','royal-fruits');
  for(let i=0;i<8000&&cat.snapshot().targetId!==player.id;i++)cat.tick(.1,[player]);
  assert.equal(cat.snapshot().targetId,player.id);player.playing=false;
  advance(cat,3,[player]);assert.notEqual(cat.snapshot().mood,'purring');assert.equal(cat.snapshot().targetId,'');
  const card=new CatRoutine(),cardPlayer=playerAtCabinet('cards','github-baccarat');
  for(let i=0;i<10000&&card.snapshot().mood!=='purring';i++)card.tick(.1,[cardPlayer]);
  assert.equal(card.snapshot().mood,'purring');assert.equal(card.snapshot().hall,'github');assert.equal(card.snapshot().surfaceId,'cabinet:github-baccarat');
});

test('she shares visits between players instead of staying on one cabinet forever',()=>{
  const cat=new CatRoutine(),people=[playerAtCabinet('one','royal-fruits'),playerAtCabinet('two','royal-dice')],visited=new Set<string>();
  for(let i=0;i<11000;i++) {
    cat.tick(.1,people);const view=cat.snapshot();
    if(view.mood==='purring')visited.add(view.targetId);
    if(visited.size===2&&view.onPillow&&view.mood==='sleeping')break;
  }
  assert.deepEqual([...visited].sort(),['one','two']);assert.equal(cat.snapshot().onPillow,true);
});

test('calling from furniture uses the floor exit and never starts walking through its solid body',()=>{
  const cat=new CatRoutine();
  for(let i=0;i<4000&&cat.snapshot().mood!=='perched';i++)cat.tick(.1);
  assert.equal(cat.snapshot().mood,'perched');
  const surface=catSurface(cat.snapshot().surfaceId)!,caller={...person(),...surface.approach};
  cat.interact('call',caller);
  for(let i=0;i<400;i++) {
    cat.tick(.1,[caller]);const view=cat.snapshot();
    if(view.mood==='walking') {assert.equal(view.surfaceId,'');assert(walkable(view.x,view.y,hallObstacles(view.hall)));return;}
  }
  assert.fail('the cat should safely return to walking');
});

test('belly-up relaxation stays on the pillow and returns to sleep before walking away',()=>{
  const cat=new CatRoutine();let belly=false,sleptAgain=false;
  for(let i=0;i<900;i++) {
    cat.tick(.1);const view=cat.snapshot();
    if(view.mood==='belly-up') { belly=true;assert(view.onPillow);assert.equal(view.x,CAT_HOME.pillow.x);assert.equal(view.y,CAT_HOME.pillow.y);assert(view.progress>=0&&view.progress<=1); }
    if(belly&&view.mood==='sleeping')sleptAgain=true;
  }
  assert(belly);assert(sleptAgain);
});

test('the cat climbs continuously onto the bar, drinks there, and jumps down onto walkable floor',()=>{
  const cat=new CatRoutine();let climbed=false,drank=false,descended=false;
  for(let i=0;i<4000;i++) {
    const before=cat.snapshot();cat.tick(.1);const view=cat.snapshot();
    if(view.onBar&&view.mood==='jumping') { climbed=true;assert(Math.hypot(view.x-before.x,view.y-before.y)<12); }
    if(view.onBar&&view.mood==='drinking') {
      drank=true;const p={...person(),...CAT_CARE.bar.approach},snapshot=cat.snapshot();
      for(const action of ['call','hug','feed','pet']) { cat.interact(action,p);assert.deepEqual(cat.snapshot(),snapshot,'drinking cannot be interrupted'); }
    }
    if(drank&&!view.onBar&&!view.onPillow&&view.mood==='walking') { descended=true;assert(walkable(view.x,view.y,hallObstacles(view.hall)));break; }
  }
  assert(climbed);assert(drank);assert(descended);
});

test('eating uses the real food bowl approach and cannot be interrupted',()=>{
  const cat=new CatRoutine();let ate=false;
  for(let i=0;i<1500;i++) {
    cat.tick(.1);const view=cat.snapshot();if(view.mood!=='eating-bowl')continue;
    ate=true;assert.equal(view.hall,CAT_CARE.hall);assert.equal(view.x,CAT_CARE.food.approach.x);assert.equal(view.y,CAT_CARE.food.approach.y);
    const snapshot=cat.snapshot();cat.interact('hug',{...person(),...CAT_CARE.food.approach});assert.deepEqual(cat.snapshot(),snapshot);break;
  }
  assert(ate);
});

test('floor hugs have one owner, a fixed location and a five to seven second limit', () => {
  const cat=new CatRoutine();
  const origin=floorCat(cat),first={...person(),...origin},second={...person('two'),...origin};
  const initial=cat.snapshot();assert.equal(cat.interact('hurt',first),'');assert.deepEqual(cat.snapshot(),initial);
  assert.equal(cat.interact('pick-up',first),'','old carrying requests are rejected');
  cat.interact('hug',{...first,id:'distant',x:540,y:570});assert.equal(cat.snapshot().mood,'walking');
  const pickup=cat.snapshot();cat.interact('hug',first);assert.equal(cat.snapshot().carriedBy,'one');
  assert.match(cat.interact('hug',second),/другого/);assert.equal(cat.snapshot().carriedBy,'one');
  advance(cat,1.1,[first,second]);cat.interact('release',second);assert.equal(cat.snapshot().carriedBy,'one');
  advance(cat,3.7,[first,second]);assert.equal(cat.snapshot().carriedBy,'one','still hugging before five seconds');
  advance(cat,2.2,[first,second]);assert.equal(cat.snapshot().carriedBy,'');
  assert.equal(cat.snapshot().hall,pickup.hall);assert.equal(cat.snapshot().x,pickup.x);assert.equal(cat.snapshot().y,pickup.y);
  assert.equal(cat.snapshot().mood,'stretching');
});

test('interruption returns her to the pickup location and never transports her to another hall', () => {
  for(const reason of ['disconnect','playing','seat','security','move','hall','release'] as const) {
    const cat=new CatRoutine(),origin=floorCat(cat),p:CatPerson={...person(),...origin};cat.interact('hug',p);
    cat.tick(.05,[p]);
    if(reason==='release')cat.interact('release',p);
    else {
      if(reason==='playing')p.playing=true;
      if(reason==='disconnect')p.connected=false;
      if(reason==='seat')p.seat='bar';
      if(reason==='security')p.security='warning';
      if(reason==='move')p.x+=50;
      if(reason==='hall'){p.hall='tables';p.x=900;p.y=1250;}
      cat.tick(.1,[p]);
    }
    const view=cat.snapshot();assert.equal(view.carriedBy,'');assert.equal(view.mood,'stretching');
    assert.equal(view.hall,origin.hall);assert.equal(view.x,origin.x);assert.equal(view.y,origin.y);
    assert(walkable(view.x,view.y,hallObstacles(view.hall)));
  }
});

test('only petting is allowed on the pillow and calls respect her mood', () => {
  const cat=new CatRoutine(), p=person();
  for(const action of ['hug','feed']) {
    const before=cat.snapshot();cat.interact(action,{...p,id:action});assert.deepEqual(cat.snapshot(),before);
  }
  cat.interact('pet',p);assert.equal(cat.snapshot().mood,'petting');assert(cat.snapshot().onPillow);
  advance(cat,1.1,[p]);cat.interact('feed',p);assert.equal(cat.snapshot().mood,'petting');
  advance(cat,4,[p]);assert.equal(cat.snapshot().mood,'sleeping');
  cat.interact('feed',p);assert.equal(cat.snapshot().mood,'sleeping');
  advance(cat,1.1,[p]);
  cat.interact('call',p);assert(['sleeping','jumping'].includes(cat.snapshot().mood));
  assert.equal(cat.interact({action:'pet',x:NaN},p),'');
});

test('early release is immediate, starts one shared cooldown and resumes her own route',()=>{
  const cat=new CatRoutine(),origin=floorCat(cat),first={...person(),...origin},second={...person('two'),...origin};
  cat.interact('hug',first);cat.interact('release',first);
  assert.equal(cat.snapshot().mood,'stretching');assert.equal(cat.snapshot().carriedBy,'');
  assert(cat.snapshot().hugCooldown>=20&&cat.snapshot().hugCooldown<=30);
  advance(cat,2.1,[first,second]);assert.equal(cat.snapshot().mood,'walking');
  Object.assign(second,cat.snapshot());assert.match(cat.interact('hug',second),/чуть позже/);assert.equal(cat.snapshot().carriedBy,'');
  const point=cat.snapshot();cat.interact('call',first);assert.equal(cat.snapshot().targetId,'','recently hugged cat can ignore calls');
  assert(point.hugCooldown>0);
  for(let i=0;i<8000;i++) {
    const view=cat.snapshot();
    if(!view.hugCooldown&&!view.onPillow&&!view.onBar&&['walking','resting'].includes(view.mood))break;
    cat.tick(.1);
  }
  Object.assign(second,cat.snapshot());cat.interact('hug',second);assert.equal(cat.snapshot().carriedBy,'two');
});

test('the room publishes exactly one authoritative cat for every player', () => {
  const state=new LobbyState(), cat=new RoomCat(state);
  for(const id of ['one','two']) { const p=new Player();Object.assign(p,CAT_HOME.approach);state.players.set(id,p); }
  for(let i=0;i<8000&&state.cat.mood!=='walking';i++)cat.tick(.1);
  for(const p of state.players.values())Object.assign(p,{x:state.cat.x,y:state.cat.y,hall:state.cat.hall});
  cat.handle('one','hug');assert.equal(state.cat.carriedBy,'one');
  cat.handle('two','hug');assert.equal(state.cat.carriedBy,'one');
  state.players.delete('one');cat.tick(.1);assert.equal(state.cat.carriedBy,'');assert.equal(state.players.size,1);
  assert.equal(cat.handle('missing','pet'),'');
});
