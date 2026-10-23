import test from 'node:test';
import assert from 'node:assert/strict';
import { goalBallPosition, goalNetPoint, NET_TRAVEL, NET_SETTLE } from '../src/ui/crLeoGoal';
import { shotLayout } from '../src/ui/crLeoFreeKick';
import { shotBallRadius } from '../src/ui/crLeoTimeline';
import { penaltyZone } from '../src/shared/crLeo';
const distance = (a: {x:number;y:number}, b: {x:number;y:number}) => Math.hypot(a.x-b.x,a.y-b.y);
const goal = shotLayout(1100,560,'cr','safe').goal;
test('a local impulse makes a visible pocket before reaching more distant threads', () => {
  const impact = { x: .5, y: .5, age: .12 }, rest = goalNetPoint(goal,.5,.5);
  assert(distance(goalNetPoint(goal,.5,.5,1,impact),rest)>goal.height*.025);
  assert.deepEqual(goalNetPoint(goal,.9,.5,1,impact),goalNetPoint(goal,.9,.5));
  assert.notDeepEqual(goalNetPoint(goal,.9,.5,1,{...impact,age:.5}),goalNetPoint(goal,.9,.5));
  const inside = goalNetPoint(goal,.48,.5,1,impact), outside = goalNetPoint(goal,.52,.5,1,impact);
  assert(inside.x>goalNetPoint(goal,.48,.5).x && outside.x<goalNetPoint(goal,.52,.5).x, 'neighboring threads are drawn into the ball pocket');
});
test('front frame, rear seams and ground anchors stay fixed for the full recoil', () => {
  for (const age of [.02,.12,.3,.65,1,1.5,1.799]) for (const n of [0,.25,.5,.75,1]) {
    const impact={x:.5,y:.5,age};
    for(const depth of [0,.5,1]) for(const [u,v] of [[0,n],[1,n],[n,0],[n,1]]) assert.deepEqual(goalNetPoint(goal,u,v,depth,impact),goalNetPoint(goal,u,v,depth));
    assert.deepEqual(goalNetPoint(goal,n,n,0,impact),goalNetPoint(goal,n,n,0));
  }
});
test('the wave settles smoothly and exactly restores the original mesh', () => {
  const energy=(age:number)=>{
    let total=0;for(let row=1;row<12;row++)for(let col=1;col<36;col++) total+=distance(goalNetPoint(goal,col/36,row/12,1,{x:.5,y:.5,age}),goalNetPoint(goal,col/36,row/12))**2;
    return total;
  };
  assert(energy(.15)>1); assert(energy(1.5)<energy(.15)*.01);
  assert(energy(NET_SETTLE-.001)<1e-6);
  for(const age of [-1,0,NET_SETTLE,5])assert.equal(energy(age),0);
});
test('all sectors keep ordered mesh cells at desktop and mobile scales throughout the impulse', () => {
  for (const [w,h] of [[320,385],[1100,560]]) for(const risk of ['safe','sharp','extreme'] as const) for(let zone=0;zone<18;zone++)for(const age of [.04,.12,.25,.45,.8,1.3]) {
    const geometry=shotLayout(w,h,'leo',risk).goal, z=penaltyZone(zone), impact={x:z.x,y:z.y,age};
    const points=Array.from({length:13},(_,row)=>Array.from({length:37},(_,col)=>goalNetPoint(geometry,col/36,row/12,1,impact)));
    for(let row=0;row<13;row++)for(let col=0;col<37;col++) {
      const p=points[row][col];assert(Number.isFinite(p.x)&&Number.isFinite(p.y));
      if(col)assert(p.x>points[row][col-1].x,`crossed columns: ${risk}, ${zone}, ${age}`);
      if(row)assert(p.y>points[row-1][col].y,`crossed rows: ${risk}, ${zone}, ${age}`);
    }
  }
});
test('the football reaches the cloth, follows its pocket and drops above the grass without teleporting', () => {
  for(const [w,h] of [[320,385],[1100,560]])for(const risk of ['safe','sharp','extreme'] as const)for(let id=0;id<18;id++) {
    const geometry=shotLayout(w,h,'cr',risk).goal,z=penaltyZone(id),radius=shotBallRadius(h,risk,1);
    const position=(age:number)=>goalBallPosition(geometry,{x:z.x,y:z.y,age},radius);
    assert(distance(position(-NET_TRAVEL),goalNetPoint(geometry,z.x,z.y,0))<1e-7);
    const floor=goalNetPoint(geometry,z.x,1).y-radius;
    for(const age of [0,.05,.12]) {
      const p=goalNetPoint(geometry,z.x,z.y,1,{x:z.x,y:z.y,age});
      assert(distance(position(age),{x:p.x,y:Math.min(floor,p.y)})<1e-7);
    }
    for(const at of [0,.13])assert(distance(position(at-1e-7),position(at+1e-7))<.001);
    for(let age=.15;age<2;age+=.05)assert(position(age).y<=floor+1e-7);
    assert(Math.abs(position(2).y-floor)<1e-7);
  }
});
