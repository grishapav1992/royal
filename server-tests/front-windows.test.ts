import {test} from 'node:test';
import assert from 'node:assert/strict';
import {frontWindowLayout,FRONT_FACADE} from '../src/game/frontWindowLife';
import {frontWindowInterior} from '../src/game/frontWindowInteriors';
import {RearWindowLife} from '../src/game/rearWindowLife';
import {STREET} from '../src/shared/street';
import {HALLS} from '../src/shared/world';
import {FLOOR,HALL_WALL} from '../src/shared/clubGeometry';

const layout=frontWindowLayout();
const panes=layout.map(w=>({...w,room:frontWindowInterior(w,layout.filter(p=>p.floor===w.floor).length)}));
test('front windows align with the painted bays and keep the entrance and sign clear',()=>{
  assert.equal(panes.filter(w=>w.floor===1).length,2);
  assert.equal(panes.filter(w=>w.floor===2).length,6);
  assert.equal(new Set(panes.map(w=>w.id)).size,panes.length);
  for(const w of panes){
    assert(w.x>=STREET.building.x&&w.x+w.width<=STREET.building.x+STREET.building.w);
    assert(w.glass.x>0&&w.glass.y>0&&w.glass.x+w.glass.w<w.width&&w.glass.y+w.glass.h<w.height);
    if(w.floor===1)assert(w.x>STREET.entrance.x+180,'no window cutout covers the door or central sign');
    else{
      assert.equal(w.x,STREET.building.x+w.column*FRONT_FACADE.tileWidth+FRONT_FACADE.upper.x);
      assert.equal(w.y,FRONT_FACADE.upperBottom-(w.floor-1)*FRONT_FACADE.tileHeight+FRONT_FACADE.upper.y);
    }
  }
});
test('front rooms follow actual floors in front-facing order and leave future floors unoccupied',()=>{
  for(const floor of [1,2,3]){
    const row=panes.filter(w=>w.floor===floor);assert(row.every(w=>w.room?.floor===floor));
    assert(row.every(w=>HALLS[w.room!.hall].floor===floor));
    if(floor>1){const xs=row.map(w=>w.room!.anchor.x);assert.deepEqual(xs,[...xs].sort((a,b)=>a-b));assert.equal(new Set(row.map(w=>w.room!.id)).size,5);}
  }
  assert(panes.filter(w=>w.floor>3).every(w=>w.room===null));
  assert.deepEqual(panes.filter(w=>w.floor===1).map(w=>w.room!.id),['arcade-mira-bar','arcade-royal-front']);
});
test('wide lower panes and taller upper panes preserve the interior aspect and clipping',()=>{
  for(const w of panes.filter(w=>w.room)){
    const crop=w.room!.crop;assert(Math.abs(crop.w/crop.h-w.glass.w/w.glass.h)<1e-10);
    assert(crop.x>=FLOOR.x&&crop.y>=HALL_WALL.top&&crop.x+crop.w<=FLOOR.x+FLOOR.width&&crop.y+crop.h<=FLOOR.y+FLOOR.height);
  }
});
test('front visitors use each pane size, walk both directions, pause and freeze offscreen',()=>{
  const life=new RearWindowLife(),w=panes.find(w=>w.floor===2)!,facings=new Set<string>(),positions=new Set<number>();let paused=false;
  for(let i=0;i<1000;i++){
    life.advance(50,true,false);const p=life.person(w,0,.5,w.glass);facings.add(p.facing);positions.add(Math.round(p.x));paused||=!p.moving;
    assert(p.x>=w.x+w.glass.x-30&&p.x<=w.x+w.glass.x+w.glass.w+30);assert(p.y<w.y+w.glass.y+w.glass.h);
  }
  assert(facings.has('left')&&facings.has('right')&&paused&&positions.size>100);
  const before=life.person(w,0,.5,w.glass),time=life.time;
  for(const flags of [[false,false,false],[true,true,false],[true,false,true]] as const){life.advance(9000,...flags);assert.equal(life.time,time);assert.equal(life.person(w,0,.5,w.glass).x,before.x);}
});
