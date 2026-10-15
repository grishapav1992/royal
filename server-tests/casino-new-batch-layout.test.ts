import test from 'node:test';
import assert from 'node:assert/strict';
import { CABINETS, cabinetHall, cabinetsInHall } from '../src/shared/cabinets';
import { WORLD, FLOOR, BOUNDS } from '../src/shared/clubGeometry';
import { BAR_APPROACH, HALLS, HALL_DOORS, hallObstacles, type HallId } from '../src/shared/world';
import { isCardGame } from '../src/shared/cardTables';
import { ACTIVITIES } from '../src/shared/activities';
import { guestStops } from '../src/shared/ambientGuests';
import { applyMovementInput } from '../src/shared/movement';
import { findPath, walkable, type Point } from '../src/game/navigation';

const newGames = ['variant-target-plinko','variant-triple-poker','variant-dice-streak','variant-gem-collection','variant-double-mines','variant-blackjack-target'];
const obstacles = hallObstacles('arcade');

function clearRoute(from: Point, to: Point, label: string, hall: HallId = 'arcade') {
  const obstacles=hallObstacles(hall);
  const path = findPath(from,to,obstacles);
  assert(path.length > 0,label+' has a route');
  assert.deepEqual(path.at(-1),to,label+' reaches the intended approach');
  let previous = from;
  for (const point of path) {
    const samples = Math.ceil(Math.hypot(point.x-previous.x,point.y-previous.y)/4);
    for (let sample = 0; sample <= samples; sample++) {
      const ratio = samples ? sample/samples : 0;
      assert(walkable(previous.x+(point.x-previous.x)*ratio,previous.y+(point.y-previous.y)*ratio,obstacles,16),label+' leaves player clearance along the whole route');
    }
    previous = point;
  }
  return path;
}

test('all cabinets have room to stand and walk from their own hall entrance', () => {
  assert.equal(cabinetsInHall('arcade').length,52);
  assert.equal(new Set(CABINETS.map(cabinet=>cabinet.id)).size,CABINETS.length);
  for (const cabinet of CABINETS) {
    const hall=cabinetHall(cabinet),obstacles=hallObstacles(hall);
    assert.equal(hall,isCardGame(cabinet.id)?'github':'arcade');
    const approach = {x:cabinet.x,y:cabinet.y+43};
    assert(walkable(approach.x,approach.y,obstacles,16),cabinet.id+' has a standing space');
    clearRoute(HALLS[hall].spawn,approach,cabinet.id,hall);
  }
});

test('six wallet games occupy the annex or card floor and connect to their hall destinations', () => {
  const approaches: (Point & {hall:HallId})[] = [];
  for (const id of newGames) {
    const cabinet = CABINETS.find(item=>item.id===id);
    assert(cabinet,id+' has a physical cabinet');
    assert(cabinet.playable && cabinet.wallet,id+' uses the shared wallet');
    const hall=cabinetHall(cabinet),card=isCardGame(id);
    assert.equal(hall,card?'github':'arcade');
    assert(cabinet.x > (card?1000:2090),id+' occupies its dedicated game area');
    assert(cabinet.x+(card?116:49) < BOUNDS.right,id+' stays inside the enlarged room');
    const approach = {x:cabinet.x,y:cabinet.y+43};
    approaches.push({...approach,hall});
    const origins=[HALLS[hall].spawn,HALL_DOORS[hall].arrival,...(hall==='arcade'?[BAR_APPROACH,ACTIVITIES.piano.entry]:[])];
    for (const origin of origins) {
      const path = clearRoute(origin,approach,id,hall);
      assert(path.some(point=>point.x>(card?1000:2090)),id+' enters the dedicated game area');
    }
    clearRoute(approach,HALL_DOORS[hall].entry,id+' return to stairs',hall);
  }
  for (const from of approaches) for (const to of approaches) if(from.hall===to.hall) clearRoute(from,{x:to.x,y:to.y},'between new game stations',from.hall);
});

test('NPCs can visit the new cabinets and the main annex corridor remains open', () => {
  for (const id of newGames) {
    const hall=cabinetHall(CABINETS.find(c=>c.id===id)!);
    const stops=guestStops(hall);
    const stop = stops.find(item=>item.id===id);
    assert(stop,id+' is part of the guest routine');
    assert.equal(stop.mood,'playing');
    clearRoute(hall==='arcade'?BAR_APPROACH:HALLS[hall].spawn,stop,id+' guest visit',hall);
  }
  for (const y of [600,760,1130]) {
    for (let x = 2090; x <= 2630; x += 20) assert(walkable(x,y,obstacles,16),'open annex walkway at '+x+','+y);
  }
});

test('server movement reaches the enlarged wing and stops at its actual edge', () => {
  assert.equal(WORLD.width,4260);
  assert.equal(WORLD.height,1380);
  assert.equal(FLOOR.x+FLOOR.width,WORLD.width-55);
  const body = {hall:'arcade',x:2050,y:700,facing:'right',moving:false,seat:'',action:'idle',drink:'',actionUntil:0};
  for (let seq = 1; seq <= 400; seq++) applyMovementInput(body,{seq,x:1,y:0,ms:50});
  assert(body.x>2630,'movement crosses the added floor');
  assert(body.x<=BOUNDS.right,'movement respects the relocated right wall');
  assert(BOUNDS.right-body.x<3,'the old right boundary no longer stops movement');
  assert.equal(body.y,700);
  assert(walkable(body.x,body.y,obstacles));
  assert(!walkable(BOUNDS.right+1,body.y,obstacles));
});
