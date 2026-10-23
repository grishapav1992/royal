import test from 'node:test';
import assert from 'node:assert/strict';
import {PVP_GAMES} from '../src/shared/pvp';
import {pvpSeat} from '../src/shared/pvpSeats';
import {activityHall,hallObstacles} from '../src/shared/world';
import {walkable,findPath} from '../src/game/navigation';
test('every duel has two different walkable seats, including the new card tables',()=>{
 for(const id of Object.keys(PVP_GAMES)as(keyof typeof PVP_GAMES)[]){
  const obstacles=hallObstacles(activityHall(id)),a=pvpSeat(id,0),b=pvpSeat(id,1);
  assert(Math.hypot(a.x-b.x,a.y-b.y)>=100,id);
  assert(walkable(a.x,a.y,obstacles),id+' first seat');assert(walkable(b.x,b.y,obstacles),id+' second seat');
  assert(findPath(a,b,obstacles).length,id+' seats are reachable');
 }
});
