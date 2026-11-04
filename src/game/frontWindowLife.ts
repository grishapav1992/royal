import {STREET} from '../shared/street';

export const FRONT_FACADE={upperBottom:STREET.building.y+STREET.building.h-320,tileWidth:246,tileHeight:250,top:-2200,
  upper:{x:64,y:34,width:156,height:182},lower:{centers:[930,1280],top:STREET.building.y+STREET.building.h-179,width:170,height:133}} as const;
export function frontWindowLayout(){
  const b=STREET.building,f=FRONT_FACADE,windows:{id:string;x:number;y:number;row:number;column:number;floor:number;width:number;height:number;glass:{x:number;y:number;w:number;h:number}}[]=[];
  const add=(floor:number,column:number,x:number,y:number,width:number,height:number)=>windows.push({id:'front-window-'+floor+'-'+column,x,y,row:floor-1,column,floor,width,height,glass:{x:3,y:3,w:width-6,h:height-6}});
  f.lower.centers.forEach((x,column)=>add(1,column,b.x+x-f.lower.width/2,f.lower.top,f.lower.width,f.lower.height));
  for(let bottom=f.upperBottom,floor=2;bottom>f.top;bottom-=f.tileHeight,floor++){
    for(let x=b.x,column=0;x<b.x+b.w-20;x+=f.tileWidth,column++)add(floor,column,x+f.upper.x,bottom-f.tileHeight+f.upper.y,f.upper.width,f.upper.height);
  }
  return windows;
}
