import { CABINETS, cabinetHall } from './cabinets';
import { CABINET_SCALE, CABINET_SIZE } from './cabinetGeometry';
import { isCardGame } from './cardTables';
import { LOUNGES } from './clubLayout';
import { FURNITURE } from './furniture';
import { CAT_HOME } from './catHome';
import { CAT_CARE } from './catCare';
import { hallObstacles, type HallId } from './world';
import { walkable, type Point } from '../game/navigation';
import type { Facing } from './movement';

export type CatSurface = {
  id:string; hall:HallId; kind:'pillow'|'bar'|'cabinet'|'sofa'|'table';
  label:string; approach:Point; perch:Point; height:number; width:number; depth:number; facing:Facing;
};
export const CAT_MAX_JUMP_HEIGHT = 170;
export const CAT_SURFACES: readonly CatSurface[] = [
  {id:'pillow',hall:CAT_HOME.hall,kind:'pillow',label:'На своей подушке',approach:CAT_HOME.approach,perch:CAT_HOME.pillow,height:CAT_HOME.approach.y-CAT_HOME.pillow.y,width:128,depth:205,facing:'down'},
  {id:'bar',hall:CAT_CARE.hall,kind:'bar',label:'На барной стойке',approach:CAT_CARE.bar.approach,perch:CAT_CARE.bar.perch,height:41,width:72,depth:CAT_CARE.bar.depth,facing:'right'},
  ...CABINETS.map((cabinet):CatSurface=>{
    const card=isCardGame(cabinet.id),height=CABINET_SIZE.height*CABINET_SCALE-6;
    return {
      id:'cabinet:'+cabinet.id,hall:cabinetHall(cabinet),kind:card?'table':'cabinet',
      label:card?'На краю игрового стола':'На автомате «'+cabinet.name+'»',
      approach:card?{x:cabinet.x+82,y:cabinet.y+42}:{x:cabinet.x+64,y:cabinet.y+28},
      perch:card?{x:cabinet.x+74,y:cabinet.y-12}:{x:cabinet.x,y:cabinet.y-height},
      height:card?54:height+28,width:card?66:CABINET_SIZE.width*CABINET_SCALE,
      depth:cabinet.y+(card?15:2),facing:'down',
    };
  }),
  ...LOUNGES.flatMap((lounge,index):CatSurface[]=>[
    {id:'sofa:'+index,hall:lounge.hall,kind:'sofa',label:'На спинке дивана',approach:{x:lounge.x+124,y:lounge.y-6},perch:{x:lounge.x+46,y:lounge.y-73},height:67,width:72,depth:lounge.y-17,facing:'left'},
    {id:'coffee-table:'+index,hall:lounge.hall,kind:'table',label:'На журнальном столике',approach:{x:lounge.x+78,y:lounge.y+122},perch:{x:lounge.x+16,y:lounge.y+80},height:42,width:72,depth:lounge.y+116,facing:'left'},
  ]),
  {id:'reading-table',hall:'tables',kind:'table',label:'На столике в библиотеке',approach:{x:FURNITURE.table.x+80,y:FURNITURE.table.y+16},perch:{x:FURNITURE.table.x+16,y:FURNITURE.table.y-46},height:62,width:80,depth:FURNITURE.table.y+1,facing:'left'},
];
const surfaces=new Map(CAT_SURFACES.map(surface=>[surface.id,surface]));
export const catSurface = (id:string):CatSurface|undefined => surfaces.get(id);

/** Only registered, wide enough surfaces with a reachable floor exit are usable. */
export function canCatUseSurface(surface:CatSurface,people:readonly {hall:HallId;x:number;y:number;connected?:boolean}[]=[]) {
  return surface.height>0&&surface.height<=CAT_MAX_JUMP_HEIGHT&&surface.width>=46
    &&walkable(surface.approach.x,surface.approach.y,hallObstacles(surface.hall),18)
    &&!people.some(person=>person.connected!==false&&person.hall===surface.hall&&Math.hypot(person.x-surface.perch.x,person.y-surface.perch.y)<28);
}
