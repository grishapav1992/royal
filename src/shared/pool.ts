import type {TableState} from './activities';
export const POOL_POCKETS=[[25,25],[360,18],[695,25],[25,375],[360,382],[695,375]];
export function canPlaceCue(s:TableState,x:number,y:number){
  return Number.isFinite(x)&&Number.isFinite(y)&&x>=40&&x<=680&&y>=40&&y<=360&&
    (s.ballInHand!=='kitchen'||x<=180)&&
    !s.balls.some(b=>b.id!==0&&b.active&&Math.hypot(b.x-x,b.y-y)<24)&&
    !POOL_POCKETS.some(([px,py])=>Math.hypot(px-x,py-y)<25);
}
export function defaultCuePosition(s:TableState){
  const cue=s.balls[0];if(canPlaceCue(s,cue.x,cue.y))return {x:cue.x,y:cue.y};
  if(canPlaceCue(s,120,200))return {x:120,y:200};
  for(let x=40;x<=(s.ballInHand==='kitchen'?180:680);x+=26)for(let y=40;y<=360;y+=26)if(canPlaceCue(s,x,y))return {x,y};
  return null;
}
