import test from 'node:test';
import assert from 'node:assert/strict';
import { AmbientGuests, guestStops } from '../src/shared/ambientGuests';
import { AmbientGuests as ServerGuests } from '../server/ambientGuests';
import { LobbyState } from '../server/state';
import { WORLD, BOUNDS } from '../src/shared/clubGeometry';
import { CLUB_ZONES, type ClubZone } from '../src/shared/clubLayout';
import { HALLS, hallObstacles, hallLinks, SEATS, ROOM_CAPACITY } from '../src/shared/world';
import { findPath, walkable, type Obstacle, type Point } from '../src/game/navigation';

function clearPointInsideZone(zone: ClubZone, obstacles: Obstacle[]): Point {
  const candidates: Point[]=[];
  for(let y=zone.y+20;y<=zone.y+zone.h-20;y+=20)for(let x=zone.x+20;x<=zone.x+zone.w-20;x+=20){
    if(walkable(x,y,obstacles,16))candidates.push({x,y});
  }
  assert(candidates.length>0,zone.name+' contains a standing space');
  const preferred={x:zone.x+zone.w/2,y:zone.y+zone.h-40};
  candidates.sort((a,b)=>Math.hypot(a.x-preferred.x,a.y-preferred.y)-Math.hypot(b.x-preferred.x,b.y-preferred.y));
  return candidates[0];
}

test('every enlarged floor has reachable zones, games, guest destinations, seats and connecting doors',()=>{
  assert(WORLD.width*WORLD.height>1080*730*3.5);
  for(const hall of ['arcade','tables','github'] as const){
    const obstacles=hallObstacles(hall);
    const points=[...guestStops(hall),...hallLinks(hall).map(link=>link.door.entry),...SEATS.filter(seat=>(seat.hall??'arcade')===hall).map(seat=>seat.entry),...CLUB_ZONES[hall].map(zone=>clearPointInsideZone(zone,obstacles))];
    for(const point of points){assert(walkable(point.x,point.y,obstacles),hall+': '+JSON.stringify(point));assert(findPath(HALLS[hall].spawn,point,obstacles).length,hall+': reachable');}
    const farPoints=[{x:1980,y:hall==='github'?1270:1200},{x:110,y:1200},{x:1990,y:hall==='github'?840:620},{x:4140,y:840}];
    for(const point of farPoints){
      assert(walkable(point.x,point.y,obstacles,16),'far side of '+hall+' has standing clearance');
      const path=findPath(HALLS[hall].spawn,point,obstacles);
      assert(path.length,'far side of '+hall+' is reachable');
      assert.deepEqual(path.at(-1),point,'far side route reaches the requested position');
    }
  }
});
test('long routes cross the enlarged navigation grid without cutting through a near-complete wall',()=>{
  const obstacles=[{x:1100,y:225,w:40,h:990}],target={x:2020,y:260},path=findPath({x:100,y:240},target,obstacles);
  assert(path.length>140);assert.deepEqual(path.at(-1),target);
  for(const point of path)assert(walkable(point.x,point.y,obstacles));
});
test('ambient guests actually walk, play, drink and rest within each floor without entering furniture',()=>{
  const routine=new AmbientGuests(),initial=routine.snapshot(),moods=new Set<string>(),moving=new Set<string>();
  assert(initial.length>=24);assert(initial.some(guest=>guest.mood==='drinking'));
  for(let tick=0;tick<1800;tick++){
    routine.tick(.1);
    for(const guest of routine.snapshot()){
      assert(walkable(guest.x,guest.y,hallObstacles(guest.hall)),guest.id+' outside furniture');
      assert(guest.x>=BOUNDS.left&&guest.x<=BOUNDS.right);moods.add(guest.mood);if(guest.moving)moving.add(guest.id);
      if(guest.mood==='drinking'){assert.equal(guest.hall,'arcade');assert.equal(guest.drink,'lemonade');}
    }
  }
  assert.equal(moving.size,initial.length);assert.deepEqual([...moods].sort(),['drinking','playing','resting','walking']);
});
test('the server publishes independent guests without occupying player capacity or game accounts',()=>{
  const state=new LobbyState(),routine=new ServerGuests(state),initial=[...state.guests.values()].map(guest=>({...guest.toJSON()}));
  assert.equal(state.players.size,0);assert(state.guests.size>=24);assert.equal(ROOM_CAPACITY,30);
  for(let tick=0;tick<300;tick++)routine.tick(.1);
  assert([...state.guests.values()].some(guest=>guest.moving));
  assert([...state.guests.values()].some((guest,index)=>guest.x!==initial[index].x||guest.y!==initial[index].y));
  assert.equal(state.players.size,0);
});
