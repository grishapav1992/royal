import { HALLS,type HallId } from '../shared/world';
import { BAR_POSITION,FURNITURE } from '../shared/furniture';
import { ACTIVITIES } from '../shared/activities';
import { LOUNGES } from '../shared/clubLayout';
import { cabinetsInHall } from '../shared/cabinets';
import { REAR_WINDOW,type RearWindow } from './rearWindowLife';
import { hallFloor,HALL_WALL } from '../shared/clubGeometry';

export type RearInteriorView={id:string;hall:HallId;floor:number;label:string;anchor:{x:number;y:number};crop:{x:number;y:number;w:number;h:number}};
function around(hall:HallId,id:string,label:string,x:number,y:number,w=340):RearInteriorView{
  const FLOOR = hallFloor(hall);
  const h=w*REAR_WINDOW.glass.h/REAR_WINDOW.glass.w;
  return {id:hall+'-'+id,hall,floor:HALLS[hall].floor,label,anchor:{x,y},crop:{x:Math.max(FLOOR.x,Math.min(x-w/2,FLOOR.x+FLOOR.width-w)),y:Math.max(HALL_WALL.top,Math.min(y-h/2,FLOOR.y+FLOOR.height-h)),w,h}};
}

/** Anchors come from the same furniture, activities and cabinets used inside each hall. */
export function rearInteriorViews(hall:HallId):RearInteriorView[]{
  const cabinet=(id:string)=>{const c=cabinetsInHall(hall).find(p=>p.id===id);return c?around(hall,c.id,c.name,c.x,c.y-55):undefined;};
  const lounge=(index:number)=>{const p=LOUNGES.filter(p=>p.hall===hall)[index];return p?around(hall,'lounge-'+index,'Гостиная',p.x,p.y+8):undefined;};
  let views:(RearInteriorView|undefined)[];
  if(hall==='arcade')views=[
    around(hall,'mira-bar','Бар Миры',BAR_POSITION.x+131,BAR_POSITION.y+112),
    lounge(1),
    around(hall,'piano','Рояль',ACTIVITIES.piano.entry.x,ACTIVITIES.piano.bounds.y+30,320),
    around(hall,'royal-front','Автоматы у музыкального салона',...pair('studio-cosmic-escape','studio-caramel-carnival'),360),
    around(hall,'royal-rear','Автоматы у гостиной',...pair('royal-plinko','original-cr-vs-leo'),360),
  ];
  else if(hall==='tables')views=[
    around(hall,'billiards','Бильярд',FURNITURE.pool.x,FURNITURE.pool.y-FURNITURE.pool.height/2),
    lounge(1),
    around(hall,'air-hockey','Аэрохоккей',ACTIVITIES.hockey.entry.x,ACTIVITIES.hockey.bounds.y+50,320),
    around(hall,'chess','Шахматный стол',FURNITURE.table.x,FURNITURE.table.y-30,320),lounge(2),
  ];
  else views=[lounge(0),...cabinetsInHall(hall).map(c=>cabinet(c.id))];
  const result=views.filter((p):p is RearInteriorView=>Boolean(p));
  if(!result.length)result.push(around(hall,'passage','Проход зала',HALLS[hall].spawn.x,HALLS[hall].spawn.y));
  return result.sort((a,b)=>a.anchor.x-b.anchor.x);

  function pair(first:string,second:string):[number,number]{
    const cabinets=cabinetsInHall(hall),a=cabinets.find(p=>p.id===first),b=cabinets.find(p=>p.id===second);
    if(!a||!b)return [HALLS[hall].spawn.x,HALLS[hall].spawn.y];
    return [(a.x+b.x)/2,(a.y+b.y)/2-35];
  }
}

/** Lowest facade row is floor one. The rear view reverses the interior's left/right order. */
export function rearWindowInterior(window:RearWindow,rows:number,columns:number):RearInteriorView|null{
  const floors=(Object.keys(HALLS) as HallId[]).filter(hall=>HALLS[hall].floor>0).sort((a,b)=>HALLS[a].floor-HALLS[b].floor);
  const hall=floors[rows-1-window.row];if(!hall)return null;
  const views=rearInteriorViews(hall),position=columns>1?(columns-1-window.column)/(columns-1):.5;
  return views[Math.round(position*(views.length-1))];
}
