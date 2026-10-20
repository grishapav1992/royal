import { BOUNDS, findPath, walkable, type Obstacle, type Point } from '../src/game/navigation';

function clear(a: Point, b: Point, obstacles: Obstacle[]) {
  return !obstacles.some(o => {
    let enter=0, exit=1;
    for (const [start,delta,min,max] of [[a.x,b.x-a.x,o.x-12,o.x+o.w+12],[a.y,b.y-a.y,o.y-12,o.y+o.h+12]]) {
      if (Math.abs(delta)<1e-9) { if(start<=min||start>=max)return false; }
      else {
        const t1=(min-start)/delta,t2=(max-start)/delta;
        enter=Math.max(enter,Math.min(t1,t2));exit=Math.min(exit,Math.max(t1,t2));
        if(enter>=exit-1e-9)return false;
      }
    }
    return enter<exit-1e-9;
  });
}

// Furniture corners preserve narrow, walkable passages that the normal 20 px grid cannot represent.
export function guardPath(from: Point, to: Point, obstacles: Obstacle[]): Point[] {
  if(!walkable(from.x,from.y,obstacles)||!walkable(to.x,to.y,obstacles))return [];
  const grid=findPath(from,to,obstacles);
  if(grid.length && grid.every((p,i)=>clear(i?grid[i-1]:from,p,obstacles)))return grid;
  const corners=obstacles.flatMap(o=>[o.x-12.1,o.x+o.w+12.1].flatMap(x=>[o.y-12.1,o.y+o.h+12.1].map(y=>({x,y}))));
  const nodes=[from,to,...corners.filter(p=>p.x>=BOUNDS.left&&p.x<=BOUNDS.right&&p.y>=BOUNDS.top&&p.y<=BOUNDS.bottom&&walkable(p.x,p.y,obstacles))];
  const costs=nodes.map(()=>Infinity),parents=nodes.map(()=>-1),closed=new Set<number>();costs[0]=0;
  for(let n=0;n<nodes.length;n++){
    let current=-1;for(let i=0;i<nodes.length;i++)if(!closed.has(i)&&(current<0||costs[i]<costs[current]))current=i;
    if(current<0||!Number.isFinite(costs[current]))return [];
    if(current===1){const path:Point[]=[];for(let i=1;i!==0;i=parents[i])path.unshift(nodes[i]);return path;}
    closed.add(current);
    for(let i=0;i<nodes.length;i++){
      if(closed.has(i))continue;
      const cost=costs[current]+Math.hypot(nodes[i].x-nodes[current].x,nodes[i].y-nodes[current].y);
      if(cost<costs[i]&&clear(nodes[current],nodes[i],obstacles)){costs[i]=cost;parents[i]=current;}
    }
  }
  return [];
}
