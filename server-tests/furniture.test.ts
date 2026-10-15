import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FURNITURE,furnitureBounds} from '../src/shared/furniture';
import {NPC_SPAWNS,hallObstacles} from '../src/shared/world';
import {walkable,findPath} from '../src/game/navigation';
import {applyMovementInput,type MovementBody} from '../src/shared/movement';

test('visible billiard rails and legs cannot be entered from any side',()=>{
  const pool=furnitureBounds(FURNITURE.pool);
  const obstacles=hallObstacles('tables');
  for(const [x,y,dx,dy] of [[562,310,0,1],[562,530,0,-1],[440,410,1,0],[715,410,-1,0]]){
    const p:MovementBody={hall:'tables',x,y,facing:'down',moving:false,seat:'',action:'idle',drink:'',actionUntil:0};
    for(let seq=1;seq<150;seq++){
      applyMovementInput(p,{seq,x:dx,y:dy,ms:16});
      assert(walkable(p.x,p.y,obstacles));
      assert(!(p.x>pool.x&&p.x<pool.x+pool.w&&p.y>pool.y&&p.y<pool.y+pool.h));
    }
    assert.equal(p.moving,false);
  }
  assert(!walkable(562,350,obstacles),'Formerly unblocked strip at the rear edge');
  assert(!walkable(562,480,obstacles),'Legs and front edge must also be solid');
});

test('retained table furniture is solid and casino visitor spawns remain clear',()=>{
  const arcade=hallObstacles('arcade'),tables=hallObstacles('tables');
  for(const [x,y] of NPC_SPAWNS)assert(walkable(x,y,arcade));
  for(const item of [FURNITURE.pool,FURNITURE.table]){
    const b=furnitureBounds(item);
    assert(!walkable(b.x+b.w/2,b.y+2,tables));
  }
});

test('click routes go around the billiard table instead of across it',()=>{
  const obstacles=hallObstacles('tables');
  const from={x:562,y:530},to={x:562,y:310};
  const path=findPath(from,to,obstacles);assert(path.length>0);
  let prior=from;
  for(const point of path){
    for(let t=0;t<=1;t+=.025)assert(walkable(prior.x+(point.x-prior.x)*t,prior.y+(point.y-prior.y)*t,obstacles));
    prior=point;
  }
  assert.deepEqual(findPath(from,{x:562,y:400},obstacles),[]);
});
