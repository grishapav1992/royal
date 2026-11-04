import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rearInteriorViews,rearWindowInterior} from '../src/game/rearWindowInteriors';
import {rearWindowLayout,REAR_WINDOW} from '../src/game/rearWindowLife';
import {StreetView} from '../src/game/streetView';
import {HALLS,type HallId} from '../src/shared/world';
import {BAR_POSITION,FURNITURE} from '../src/shared/furniture';
import {ACTIVITIES} from '../src/shared/activities';
import {cabinetsInHall} from '../src/shared/cabinets';

test('rear facade rows map to real floors and keep unbuilt rows closed',()=>{
 const view=new StreetView();view.side='rear';const windows=rearWindowLayout(view.wall,view.roofEdge),rows=Math.max(...windows.map(w=>w.row))+1,columns=Math.max(...windows.map(w=>w.column))+1;
 const views=windows.map(w=>({window:w,room:rearWindowInterior(w,rows,columns)}));
 assert.equal(rows,5);assert.equal(columns,5);
 for(const row of [0,1])assert(views.filter(v=>v.window.row===row).every(v=>v.room===null));
 for(const [hall,definition]of Object.entries(HALLS).filter(([,d])=>d.floor>0)){
   const actual=views.filter(v=>v.room?.hall===hall);assert.equal(actual.length,columns);
   assert(actual.every(v=>v.window.row===rows-definition.floor));
   assert.equal(new Set(actual.map(v=>v.room!.id)).size,columns);
   const centers=actual.map(v=>v.room!.crop.x+v.room!.crop.w/2);
   assert.deepEqual(centers,[...centers].sort((a,b)=>b-a),'back view reverses the front-facing interior order');
 }
 const taller=rearWindowLayout(view.wall,view.roofEdge-REAR_WINDOW.rowPitch);
 assert.equal(rearWindowInterior(taller[0],rows+1,columns),null,'a taller facade does not invent another casino hall');
});

test('window crops use existing bar, activities, furniture and actual cabinet coordinates with one scale',()=>{
 const center=(view:ReturnType<typeof rearInteriorViews>[number])=>({x:view.crop.x+view.crop.w/2,y:view.crop.y+view.crop.h/2});
 const first=rearInteriorViews('arcade'),second=rearInteriorViews('tables');
 assert.deepEqual(center(first.find(v=>v.id==='arcade-mira-bar')!),{x:BAR_POSITION.x+131,y:BAR_POSITION.y+112});
 assert.equal(center(first.find(v=>v.id==='arcade-piano')!).x,ACTIVITIES.piano.entry.x);
 assert.equal(center(second.find(v=>v.id==='tables-billiards')!).x,FURNITURE.pool.x);
 assert.equal(center(second.find(v=>v.id==='tables-air-hockey')!).x,ACTIVITIES.hockey.entry.x);
 assert.equal(center(second.find(v=>v.id==='tables-chess')!).x,FURNITURE.table.x);
 for(const hall of ['arcade','tables','github'] as HallId[])for(const view of rearInteriorViews(hall)){
   assert.equal(view.hall,hall);assert.equal(view.floor,HALLS[hall].floor);
   assert(Math.abs(view.crop.w/view.crop.h-REAR_WINDOW.glass.w/REAR_WINDOW.glass.h)<1e-10,'no aspect distortion');
   assert(view.crop.x>=55&&view.crop.y>=-100&&view.crop.x+view.crop.w<=5190&&view.crop.y+view.crop.h<=1320);
 }
 for(const c of cabinetsInHall('github')){
   const view=rearInteriorViews('github').find(v=>v.id==='github-'+c.id)!;assert(view);assert.equal(view.anchor.x,c.x);assert.equal(view.anchor.y,c.y-55);
 }
});
