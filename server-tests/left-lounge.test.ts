import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CLUB_ZONES,LOUNGES} from '../src/shared/clubLayout';
import {BAR_POSITION,BAR_SOLID} from '../src/shared/furniture';
import {BAR_APPROACH,HALLS,HALL_DOORS,SEATS,hallObstacles,atBar} from '../src/shared/world';
import {ACTIVITIES} from '../src/shared/activities';
import {CAT_CARE} from '../src/shared/catCare';
import {guestStops} from '../src/shared/ambientGuests';
import {GUARD_STOPS} from '../server/guardRoutine';
import {cabinetsInHall} from '../src/shared/cabinets';
import {findPath,walkable} from '../src/game/navigation';

test('the left lounge contains two aligned sofas and their tables, lamps and seats',()=>{
 const lounges=LOUNGES.filter(l=>l.hall==='arcade');assert.equal(lounges.length,2);assert.equal(lounges[0].y,lounges[1].y);
 const zone=CLUB_ZONES.arcade.find(z=>z.x===150&&z.y===800)!;assert(zone);
 const seats=SEATS.filter(s=>s.kind==='sofa'&&s.hall==='arcade');assert.equal(seats.length,2);
 lounges.forEach(l=>{
  assert(l.x-159>=zone.x&&l.x+99<=zone.x+zone.w&&l.y-118>zone.y&&l.y+118<zone.y+zone.h);
  assert(seats.some(s=>s.x>=l.x-80&&s.x<=l.x+80&&s.y===l.y+10));
 });
 assert(BAR_POSITION.x+BAR_SOLID.w<500);assert(atBar(BAR_APPROACH));assert(!atBar({x:866,y:578}));
});

test('every relocated interaction and all game collections have clear routes without ghost furniture',()=>{
 const obstacles=hallObstacles('arcade');
 const destinations=[BAR_APPROACH,ACTIVITIES.piano.entry,CAT_CARE.bar.approach,HALL_DOORS.arcade.entry,
  ...SEATS.filter(s=>s.hall==='arcade').map(s=>s.entry),...GUARD_STOPS.arcade,
  ...guestStops('arcade'),...cabinetsInHall('arcade').map(c=>({x:c.x,y:c.y+43}))];
 for(const to of destinations){
  assert(walkable(to.x,to.y,obstacles,16),JSON.stringify(to));
  for(const from of [HALLS.arcade.spawn,HALL_DOORS.arcade.arrival,BAR_APPROACH]){
   const route=findPath(from,to,obstacles);assert(route.length>0,JSON.stringify(to));let previous=from;
   for(const point of route){
    for(let t=0;t<=1;t+=.1)assert(walkable(previous.x+(point.x-previous.x)*t,previous.y+(point.y-previous.y)*t,obstacles));
    previous=point;
   }
  }
 }
 for(const old of [{x:120,y:290},{x:900,y:450},{x:770,y:1200}])assert(walkable(old.x,old.y,obstacles,16));
 assert(!walkable(BAR_SOLID.x+120,BAR_SOLID.y+60,obstacles));
});
