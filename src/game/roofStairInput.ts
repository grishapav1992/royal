import type { Point } from './navigation';

/** Match the painted escape, keeping the pavement below it outside the hit area. */
export function roofStairContains(point:Point,route:readonly Point[],overview:boolean):boolean {
  if(!route.length)return false;
  const foot=route[0];
  if(overview)return Math.abs(point.x-foot.x)<=38&&Math.abs(point.y-foot.y+2)<=16;
  for(let index=1;index<route.length;index++){
    const from=route[index-1],to=route[index];
    if(point.x<Math.min(from.x,to.x)-36||point.x>Math.max(from.x,to.x)+36)continue;
    if(from.x===to.x){
      if(point.y>=Math.min(from.y,to.y)-56&&point.y<=Math.max(from.y,to.y)+18)return true;
    }else{
      const progress=Math.max(0,Math.min(1,(point.x-from.x)/(to.x-from.x)));
      const tread=from.y+(to.y-from.y)*progress;
      if(point.y>=tread-56&&point.y<=tread+24)return true;
    }
  }
  return false;
}
