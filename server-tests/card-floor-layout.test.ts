import test from 'node:test';
import assert from 'node:assert/strict';
import { CABINETS, cabinetBounds, cabinetHall, cabinetsInHall } from '../src/shared/cabinets';
import { CARD_GAME_IDS, isCardGame, cardTableBounds, cardTableApproach, cardTableSeat } from '../src/shared/cardTables';
import { HALLS, HALL_DOORS, GITHUB_ROOM_DOOR, hallObstacles, hallLinks, hallLinkAt, SEATS } from '../src/shared/world';
import { CLUB_ZONES, clubPlants } from '../src/shared/clubLayout';
import { BOUNDS } from '../src/shared/clubGeometry';
import { AmbientGuests, guestStops } from '../src/shared/ambientGuests';
import { findPath, walkable, type Point, type Obstacle } from '../src/game/navigation';
import { guardPath } from '../server/guardNavigation';
import { GUARD_STOPS } from '../server/guardRoutine';
import { Guards } from '../server/guards';
import { LobbyState } from '../server/state';

const retained = [
  ['casinoapipro',240,267],['royal-fruits',500,267],['royal-dice',1200,270],['royal-limbo',1380,270],
  ['royal-mines',1560,270],['royal-plinko',1740,270],['royal-keno',1920,270],['luelon',780,810],
  ['github-craps',1920,410],['github-diamonds',240,600],['github-crash',480,810],
  ['github-sic-bo',480,1180],['variant-target-plinko',2250,410],['variant-dice-streak',2610,410],
  ['variant-gem-collection',2250,930],['variant-double-mines',2430,930],
  ['studio-cosmic-escape',3000,300],['studio-caramel-carnival',3180,300],['studio-velvet-reign',3360,300],
  ['studio-deep-current',3540,300],['studio-ember-vault',3720,300],['studio-lumen-grove',3900,300],['studio-neon-crown',4080,300],
  ['studio-sky-lanterns',3000,470],['studio-stormforge-duel',3180,470],['studio-copperline-express',3360,470],
  ['studio-saffron-cipher',3540,470],['studio-prism-atelier',3720,470],['studio-midnight-market',3900,470],['studio-pulse-district',4080,470],
  ['studio-rivet-rally',3000,640],['studio-petal-parlor',3180,640],['studio-frostline-courier',3360,640],
  ['studio-beacon-bay',3540,640],['studio-sunbird-trails',3720,640],['studio-blazing-orchard',3900,640],['studio-jade-koi',4080,640],
  ['studio-moonlit-mint',3000,980],['studio-starfall-oracle',3180,980],['studio-orbit',3360,980],['studio-gale-riders',3540,980],
  ['studio-dune-hopper',3720,980],['studio-canopy-crossing',3900,980],['studio-aurora-lift',4080,980],
  ['studio-tidal-relay',3000,1150],['studio-mosaic-muse',3180,1150],['studio-obsidian-drop',3360,1150],
  ['studio-signal-fox',3540,1150],['studio-saffron-spin',3720,1150],['studio-fossil-trail',3900,1150],['studio-lucky-spotlight',4080,1150],
] as const;
const cardObstacles = hallObstacles('github');

function assertClearRoute(from: Point, to: Point, obstacles: Obstacle[], path: Point[], label: string, radius = 16) {
  assert(path.length > 0,label+' has a route');
  assert.deepEqual(path.at(-1),to,label+' reaches the intended position');
  let previous = from;
  for (const point of path) {
    const samples = Math.ceil(Math.hypot(point.x-previous.x,point.y-previous.y)/4);
    for (let sample = 0; sample <= samples; sample++) {
      const ratio = samples ? sample/samples : 0;
      assert(walkable(previous.x+(point.x-previous.x)*ratio,previous.y+(point.y-previous.y)*ratio,obstacles,radius),label+' stays clear along the whole route');
    }
    previous = point;
  }
}

test('all 33 card games have separate third-floor tables and every other cabinet retains its position',()=>{
  assert.equal(CARD_GAME_IDS.length,33);
  assert.equal(CABINETS.length,85);
  assert.equal(new Set(CABINETS.map(c=>c.id)).size,85);
  assert.equal(cabinetsInHall('github').length,33);
  assert.equal(cabinetsInHall('arcade').length,52);
  assert.equal(cabinetsInHall('tables').length,0);
  assert.deepEqual(cabinetsInHall('github').map(c=>c.id).sort(),[...CARD_GAME_IDS].sort());
  assert(CABINETS.every(c=>isCardGame(c.id)===(cabinetHall(c)==='github')));
  for(const [id,x,y] of retained){const c=CABINETS.find(c=>c.id===id)!;assert.deepEqual({x:c.x,y:c.y,hall:cabinetHall(c)},{x,y,hall:'arcade'},id);}
  assert.equal(retained.length,51);
  for(const id of ['variant-color','variant-duel','variant-war']){const c=CABINETS.find(c=>c.id===id)!;assert(c.playable && c.wallet);}
});

test('existing hall identifiers and stairs connect three separate floors with clear arrivals',()=>{
  assert.deepEqual(Object.keys(HALLS),['arcade','tables','github']);
  assert.deepEqual(Object.values(HALLS).map(h=>h.floor),[1,2,3]);
  assert.equal(HALLS.github.name,'Карточный салон');
  assert.deepEqual(hallLinks('github').map(link=>link.target),['tables']);
  assert(hallLinks('tables').some(link=>link.target==='github'));
  assert.equal(hallLinkAt({...GITHUB_ROOM_DOOR.entry,hall:'tables'})?.target,'github');
  assert.equal(hallLinkAt({...HALL_DOORS.github.entry,hall:'github'})?.target,'tables');
  for(const hall of Object.keys(HALLS) as (keyof typeof HALLS)[]){
    const obstacles=hallObstacles(hall);
    assert(walkable(HALLS[hall].spawn.x,HALLS[hall].spawn.y,obstacles,16));
    for(const link of hallLinks(hall)){
      assert(walkable(link.door.entry.x,link.door.entry.y,obstacles,16));
      const destination=hallObstacles(link.target);
      assert(walkable(link.arrival.arrival.x,link.arrival.arrival.y,destination,16));
      assertClearRoute(HALLS[hall].spawn,link.door.entry,obstacles,findPath(HALLS[hall].spawn,link.door.entry,obstacles),hall+' stair');
    }
  }
});

test('table footprints contain the dealer position and leave player and NPC approaches clear',()=>{
  CARD_GAME_IDS.forEach((id,index)=>{
    const c=CABINETS.find(c=>c.id===id)!,bounds=cabinetBounds(c);
    assert.deepEqual({x:c.x,y:c.y},{x:1120+index%7*460,y:[340,540,740,1000,1200][Math.floor(index/7)]});
    assert.deepEqual(bounds,cardTableBounds(c));
    assert.deepEqual(bounds,{x:c.x-116,y:c.y-112,w:232,h:122});
    assert(bounds.x>=BOUNDS.left && bounds.x+bounds.w<=BOUNDS.right && bounds.y>=BOUNDS.top && bounds.y+bounds.h<=BOUNDS.bottom);
    assert(!walkable(c.x,c.y-86,cardObstacles),id+' dealer has a solid station');
    assert(!walkable(c.x,c.y-25,cardObstacles),id+' table body stays solid');
    const approach=cardTableApproach(c);
    assert.deepEqual(approach,{x:c.x-72,y:c.y+65});
    const seat=cardTableSeat(c);
    assert.deepEqual(seat,{x:c.x-72,y:c.y+43});
    assert(walkable(seat.x,seat.y,cardObstacles,16),id+' seated player clears the table');
    assert(walkable(approach.x,approach.y,cardObstacles,16),id+' player approach');
    assert(walkable(c.x+25,c.y+65,cardObstacles,16),id+' NPC approach');
  });
  for(const c of cabinetsInHall('arcade'))assert.deepEqual(cabinetBounds(c),{x:c.x-47,y:c.y-51,w:94,h:51});
});

test('every table connects to the spawn, stairs, all other tables and NPC destinations with full standing clearance',()=>{
  const approaches=cabinetsInHall('github').map(cardTableApproach);
  const origins=[HALLS.github.spawn,HALL_DOORS.github.arrival,...approaches];
  for(const [index,point] of approaches.entries())for(const origin of origins){
    assertClearRoute(origin,point,cardObstacles,findPath(origin,point,cardObstacles),CARD_GAME_IDS[index]);
  }
  for(const point of guestStops('github')){
    assert(walkable(point.x,point.y,cardObstacles,16),point.id+' NPC stand');
    assertClearRoute(HALLS.github.spawn,point,cardObstacles,findPath(HALLS.github.spawn,point,cardObstacles),point.id+' NPC route');
  }
  for(const point of [...SEATS.filter(seat=>seat.hall==='github').map(seat=>seat.entry),...CLUB_ZONES.github.map(zone=>({x:zone.x+zone.w/2,y:zone.y+zone.h-40}))]){
    assertClearRoute(HALLS.github.spawn,point,cardObstacles,findPath(HALLS.github.spawn,point,cardObstacles),'card floor lounge or zone');
  }
  for(let x=1000;x<=4100;x+=20)assert(walkable(x,840,cardObstacles,16),'main card-floor corridor '+x);
});

test('guests visit every card table and all guest movement stays outside physical tables',()=>{
  const stops=guestStops('github');
  for(const id of CARD_GAME_IDS){assert.equal(stops.find(stop=>stop.id===id)?.mood,'playing');assert(!guestStops('arcade').some(stop=>stop.id===id));}
  assert.equal(clubPlants('github').length,6);
  const guests=new AmbientGuests(),moving=new Set<string>();
  for(let tick=0;tick<1800;tick++){
    guests.tick(.1);
    for(const guest of guests.snapshot()){
      assert(walkable(guest.x,guest.y,hallObstacles(guest.hall)),guest.id+' stays outside furniture');
      if(guest.moving)moving.add(guest.id);
    }
  }
  assert.equal(moving.size,guests.snapshot().length);
});

test('guard routes and the complete three-floor patrol avoid card tables',()=>{
  for(const destination of GUARD_STOPS.github){
    assert(walkable(destination.x,destination.y,cardObstacles),destination.id+' guard stop');
    for(const origin of [HALL_DOORS.github.arrival,...GUARD_STOPS.github,...cabinetsInHall('github').map(cardTableApproach)]){
      assertClearRoute(origin,destination,cardObstacles,guardPath(origin,destination,cardObstacles),destination.id+' guard route',12);
    }
  }
  const state=new LobbyState();let seed=2;
  const guards=new Guards(state,()=>{},()=>{seed=(seed*1664525+1013904223)>>>0;return seed/2**32;});
  const visited=new Map<string,Set<string>>();
  for(let tick=0;tick<18000;tick++){
    guards.tick(.05);const guard=state.guards.get('security')!;
    assert(walkable(guard.x,guard.y,hallObstacles(guard.hall)),guard.hall+' guard stays outside furniture');
    if(['chat','window','inspect','watch'].includes(guard.phase)){
      if(!visited.has(guard.hall))visited.set(guard.hall,new Set());
      visited.get(guard.hall)!.add(guard.routine);
    }
  }
  for(const hall of ['arcade','tables','github'] as const)for(const stop of GUARD_STOPS[hall])assert(visited.get(hall)?.has(stop.id),hall+' patrol visits '+stop.id);
});
