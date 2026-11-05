import {hallFloor,HALL_WALL} from '../shared/clubGeometry';
import {HALLS,type HallId} from '../shared/world';
import {rearInteriorViews,type RearInteriorView} from './rearWindowInteriors';
import {LOUNGES} from '../shared/clubLayout';
import type {frontWindowLayout} from './frontWindowLife';

/** The front follows the interior's left-to-right order and the existing floor catalogue. */
export function frontWindowInterior(window:ReturnType<typeof frontWindowLayout>[number],columns:number):RearInteriorView|null{
  const hall=(Object.keys(HALLS) as HallId[]).find(id=>HALLS[id].floor===window.floor);if(!hall)return null;
  const FLOOR = hallFloor(hall);
  const views=rearInteriorViews(hall);
  const loungeIndex=hall==='tables'?0:hall==='github'?1:-1,lounge=LOUNGES.filter(p=>p.hall===hall)[loungeIndex];
  if(lounge){
    const w=340,h=w*window.glass.h/window.glass.w;
    views.push({id:hall+'-front-lounge-'+loungeIndex,hall,floor:HALLS[hall].floor,label:'Гостиная',anchor:{x:lounge.x,y:lounge.y+8},crop:{x:Math.max(FLOOR.x,Math.min(lounge.x-w/2,FLOOR.x+FLOOR.width-w)),y:lounge.y,w,h}});
    views.sort((a,b)=>a.anchor.x-b.anchor.x);
  }
  const room=window.floor===1?views.find(v=>v.id===(window.column?'arcade-royal-front':'arcade-mira-bar'))??views[0]:views[Math.round(window.column/Math.max(1,columns-1)*(views.length-1))];
  const height=room.crop.w*window.glass.h/window.glass.w;
  return {...room,crop:{...room.crop,h:height,y:Math.max(HALL_WALL.top,Math.min(room.anchor.y-height/2,FLOOR.y+FLOOR.height-height))}};
}
