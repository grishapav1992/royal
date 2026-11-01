import test from 'node:test';
import assert from 'node:assert/strict';
import { CABINETS, cabinetHall, cabinetsInHall } from '../src/shared/cabinets';
import { isCardGame } from '../src/shared/cardTables';
import { STUDIO_GAMES } from '../src/shared/studioGames';
import { WORLD, FLOOR, BOUNDS } from '../src/shared/clubGeometry';
import { HALL_DOORS, HALLS, BAR_APPROACH, hallObstacles } from '../src/shared/world';
import { guestStops } from '../src/shared/ambientGuests';
import { applyMovementInput } from '../src/shared/movement';
import { findPath, walkable, type Point } from '../src/game/navigation';
import { interiorRasterSize } from '../src/game/interiorArt';

const retained = [{"id":"casinoapipro","x":240,"y":267},{"id":"royal-fruits","x":500,"y":267},{"id":"royal-dice","x":1200,"y":270},{"id":"royal-limbo","x":1380,"y":270},{"id":"royal-mines","x":1560,"y":270},{"id":"royal-plinko","x":1740,"y":270},{"id":"royal-keno","x":1920,"y":270},{"id":"luelon","x":780,"y":810},{"id":"github-blackjack","x":1200,"y":410},{"id":"github-poker","x":1380,"y":410},{"id":"github-video-poker","x":1560,"y":410},{"id":"github-baccarat","x":1740,"y":410},{"id":"github-craps","x":1920,"y":410},{"id":"github-hilo","x":1200,"y":550},{"id":"github-diamonds","x":240,"y":600},{"id":"github-crash","x":480,"y":810},{"id":"github-three-card","x":1560,"y":550},{"id":"github-caribbean","x":1740,"y":550},{"id":"github-let-it-ride","x":1920,"y":550},{"id":"github-ultimate","x":1200,"y":790},{"id":"github-war","x":1380,"y":790},{"id":"github-red-dog","x":1560,"y":790},{"id":"github-pai-gow","x":1740,"y":790},{"id":"github-dragon-tiger","x":1920,"y":790},{"id":"github-deuces","x":240,"y":1180},{"id":"github-sic-bo","x":480,"y":1180},{"id":"github-mississippi","x":1200,"y":930},{"id":"github-four-card","x":1380,"y":930},{"id":"github-crazy-four","x":1560,"y":930},{"id":"github-flush","x":1740,"y":930},{"id":"github-holdem-bonus","x":1920,"y":930},{"id":"github-oasis","x":1200,"y":1070},{"id":"github-russian","x":1380,"y":1070},{"id":"github-caribbean-draw","x":1560,"y":1070},{"id":"github-spanish","x":1740,"y":1070},{"id":"github-exposure","x":1920,"y":1070},{"id":"github-switch","x":1200,"y":1210},{"id":"github-free-bet","x":1380,"y":1210},{"id":"github-rummy","x":1560,"y":1210},{"id":"github-andar-bahar","x":1740,"y":1210},{"id":"variant-target-plinko","x":2250,"y":410},{"id":"variant-triple-poker","x":2430,"y":410},{"id":"variant-dice-streak","x":2610,"y":410},{"id":"variant-gem-collection","x":2250,"y":930},{"id":"variant-double-mines","x":2430,"y":930},{"id":"variant-blackjack-target","x":2610,"y":930}];
const originalDoors = {"arcade":{"entry":{"x":900,"y":240},"arrival":{"x":900,"y":290},"facing":"down","click":{"x":900,"y":166},"left":860,"right":940,"top":225,"bottom":247},"tables":{"entry":{"x":900,"y":1300},"arrival":{"x":900,"y":1250},"facing":"up","click":{"x":900,"y":1307},"left":860,"right":940,"top":1293,"bottom":1310},"github":{"entry":{"x":900,"y":1300},"arrival":{"x":900,"y":1250},"facing":"up","click":{"x":900,"y":1307},"left":860,"right":940,"top":1293,"bottom":1310}};
const originalBar = {"x":866,"y":578};
const currentHalls = {"arcade":{"floor":1,"name":"Казино и бар","number":"01","spawn":{"x":540,"y":590}},"tables":{"floor":2,"name":"Игры на двоих","number":"02","spawn":{"x":540,"y":590}},"github":{"floor":3,"name":"Карточный салон","number":"03","spawn":{"x":540,"y":590}}};
const obstacles = hallObstacles('arcade');

function assertRoute(from: Point,to: Point,label: string) {
  const path = findPath(from,to,obstacles);
  assert(path.length > 0,label+' has a route');
  assert.deepEqual(path.at(-1),to,label+' reaches its destination');
  let previous = from;
  for(const point of path) {
    const samples = Math.ceil(Math.hypot(point.x-previous.x,point.y-previous.y)/4);
    for(let sample=0;sample<=samples;sample++) {
      const ratio = samples ? sample/samples : 0;
      assert(walkable(previous.x+(point.x-previous.x)*ratio,previous.y+(point.y-previous.y)*ratio,obstacles,16),label+' leaves player clearance along the full route');
    }
    previous=point;
  }
}

test('35 native studio cabinets retain the first-floor wing while card games move to their own floor',()=>{
  assert.equal(STUDIO_GAMES.length,35);
  assert.equal(CABINETS.length,85);
  assert.equal(cabinetsInHall('arcade').length,52);
  assert.equal(new Set(CABINETS.map(c=>c.id)).size,85);
  for(const expected of retained) {
    const cabinet = CABINETS.find(c=>c.id===expected.id);
    assert(cabinet,expected.id+' remains installed');
    if(isCardGame(cabinet.id))assert.equal(cabinetHall(cabinet),'github');
    else assert.deepEqual({id:cabinet.id,x:cabinet.x,y:cabinet.y},expected);
  }
  assert.deepEqual(HALL_DOORS,originalDoors);
  assert.deepEqual(BAR_APPROACH,originalBar);
  assert.deepEqual(HALLS,currentHalls);
  for(const id of STUDIO_GAMES) {
    const cabinet = CABINETS.find(c=>c.id===id);
    assert(cabinet,id+' has a physical terminal');
    assert(cabinet.playable && cabinet.wallet,id+' connects to the common wallet');
    assert.equal(cabinetHall(cabinet),'arcade');
    assert(cabinet.x>=3000 && cabinet.x+49<BOUNDS.right,id+' occupies the new wing with clearance');
    assert(walkable(cabinet.x,cabinet.y+43,obstacles,16),id+' has a clear standing area');
    assert(!walkable(cabinet.x,cabinet.y-25,obstacles),id+' is a solid terminal');
  }
});

test('every studio cabinet is reachable from all player spawns, the bar and the stairs',()=>{
  const spawns = Array.from({length:24},(_,index)=>({x:420+index%8*40,y:570+Math.floor(index/8)*25}));
  const origins = [...spawns,HALLS.arcade.spawn,HALL_DOORS.arcade.arrival,BAR_APPROACH];
  for(const id of STUDIO_GAMES) {
    const cabinet = CABINETS.find(c=>c.id===id)!;
    const approach = {x:cabinet.x,y:cabinet.y+43};
    for(const origin of origins)assertRoute(origin,approach,id);
    assertRoute(approach,HALL_DOORS.arcade.entry,id+' exit');
  }
});

test('NPCs can visit all studio terminals and players can cross both directions through the wing',()=>{
  const stops=guestStops('arcade');
  for(const id of STUDIO_GAMES) {
    const stop=stops.find(item=>item.id===id);
    assert(stop,id+' is part of the NPC routine');
    assert.equal(stop.mood,'playing');
    assertRoute(BAR_APPROACH,stop,id+' NPC');
  }
  for(const y of [700,760,830]) {
    for(let x=2760;x<=BOUNDS.right;x+=10)assert(walkable(x,y,obstacles,16),'open studio corridor at '+x+','+y);
    assertRoute({x:2760,y},{x:BOUNDS.right,y},'studio corridor');
    assertRoute({x:BOUNDS.right,y},{x:2760,y},'studio return');
  }
});

test('shared movement and artwork use the full extended room within GPU texture limits',()=>{
  assert.equal(WORLD.width,4260);
  assert.equal(WORLD.height,1380);
  assert.equal(FLOOR.x+FLOOR.width,WORLD.width-55);
  const body={hall:'arcade',x:2050,y:700,facing:'right',moving:false,seat:'',action:'idle',drink:'',actionUntil:0};
  for(let seq=1;seq<=400;seq++)applyMovementInput(body,{seq,x:1,y:0,ms:50});
  assert(body.x>4100,'server movement traverses the studio wing');
  assert(body.x<=BOUNDS.right && BOUNDS.right-body.x<3,'server movement stops at the actual right wall');
  assert.equal(body.y,700);
  assert(!walkable(BOUNDS.right+1,body.y,obstacles));
  for(const [width,height] of [[FLOOR.width,FLOOR.height],[FLOOR.width,112]]) {
    for(const density of [1,2,3]) {
      const raster=interiorRasterSize(width,height,density,true);
      assert(raster.width<=4096 && raster.height<=4096,'room panorama fits a 4096-pixel GPU');
      assert(raster.width>0 && raster.height>0);
      assert(Math.abs((raster.width/raster.height)/(width/height)-1)<.02,'raster dimensions preserve room proportions');
    }
  }
  const prop=interiorRasterSize(84,122,3);
  assert.equal(prop.width,252,'cabinet artwork keeps its existing detail');
  assert.equal(prop.height,366);
});
