import test from 'node:test';
import assert from 'node:assert/strict';
import { penaltyZone, type PenaltyShot } from '../src/shared/crLeo';
import { freeKickFlight, isWallHit, shotLayout, wallContact, wallMotion, wallCrossing, WALL_CROSSING } from '../src/ui/crLeoFreeKick';
import { shotPose, shotTarget, shotTiming, shotBallRadius, strikePlacement, strikeAnchors } from '../src/ui/crLeoTimeline';
import { goalNetPoint } from '../src/ui/crLeoGoal';
import { spriteParts } from '../src/ui/crLeoSprites';

const shot = (zone: number, finish: PenaltyShot['finish'] = 'goal'): PenaltyShot => ({ index:0,goal:finish==='goal',finish,side:penaltyZone(zone).side,risk:'sharp',zone });
test('near free kicks have five defenders and each successful sector clears the wall with continuous speed',()=>{
  const routes=new Set<string>();
  for(const [w,h] of [[320,385],[643,386],[1280,470],[1440,650]])for(const hero of ['cr','leo'] as const)for(let id=0;id<18;id++){
    const layout=shotLayout(w,h,hero,'sharp'),wall=layout.wall!,s=shot(id),to=shotTarget(s,layout.goal);
    assert.equal(wall.count,5);assert(wall.bottom>layout.goal.bottom&&wall.bottom<layout.ball.y);assert(layout.goal.width<shotLayout(w,h,hero,'safe').goal.width);
    const start=freeKickFlight(0,layout.ball,to,wall,s),cross=freeKickFlight(WALL_CROSSING,layout.ball,to,wall,s),end=freeKickFlight(1,layout.ball,to,wall,s);
    assert.equal(start.x,layout.ball.x);assert.equal(start.y,layout.ball.y);assert(Math.abs(end.x-to.x)<1e-7&&Math.abs(end.y-to.y)<1e-7);routes.add(cross.route);
    const jumpingTop=wall.bottom-wall.size*.9-h*.045,halfWall=2.5*wall.spacing;
    assert(cross.y+shotBallRadius(h,'sharp',WALL_CROSSING)<jumpingTop||Math.abs(cross.x-wall.x)>halfWall+shotBallRadius(h,'sharp',WALL_CROSSING),'ball must go above or outside all five defenders');
    const e=1e-5,a=freeKickFlight(WALL_CROSSING-e,layout.ball,to,wall,s),b=freeKickFlight(WALL_CROSSING+e,layout.ball,to,wall,s);
    const before={x:(cross.x-a.x)/e,y:(cross.y-a.y)/e},after={x:(b.x-cross.x)/e,y:(b.y-cross.y)/e};
    assert(Math.abs(before.x-after.x)<h*.003&&Math.abs(before.y-after.y)<h*.003,'no trajectory kink');assert(Math.hypot(before.x,before.y)>h*.03,'no pause at wall');
    const size=h*(hero==='cr'?.59:.55),placement=strikePlacement(hero,layout.ball,size),toe=strikeAnchors[hero];assert(Math.abs(placement.x+(toe.x-.5)*size-layout.ball.x)<1e-7);assert(Math.abs(placement.bottom+(toe.y-.94)*size-layout.ball.y)<1e-7);
  }
  assert.deepEqual([...routes].sort(),['around','over']);
});
test('wall impacts are a cosmetic existing loss, touch a defender and rebound without going through the wall',()=>{
  const l=shotLayout(1280,470,'leo','sharp'),wall=l.wall!;let impacts=0;
  for(let id=0;id<18;id++)for(const finish of ['goal','save','post','wide'] as const){
    const s=shot(id,finish),hit=isWallHit(s);if(hit){impacts++;assert(!s.goal&&s.finish==='wide');const to=shotTarget(s,l.goal),contact=wallContact(s,wall),p=freeKickFlight(WALL_CROSSING,l.ball,to,wall,s),rebound=freeKickFlight(1,l.ball,to,wall,s);assert.equal(p.route,'wall');assert.equal(p.x,contact.x);assert.equal(p.y,contact.y);assert(contact.player>=0&&contact.player<5);assert(rebound.y>p.y);assert.equal(wallMotion(WALL_CROSSING,470,true).row,3);}
    assert(!isWallHit({...s,risk:'safe'}));
  }assert.equal(impacts,12);
});
test('free-kick outcome and celebration clocks follow arrival or wall collision, while penalty timing stays unchanged',()=>{
  const goal=shot(0),timing=shotTiming('sharp',goal);assert.equal(timing.result,2.12);assert.equal(timing.ready,2.77);assert.equal(shotPose(1.9,'leo',goal),6);assert.equal(shotPose(timing.result,'leo',goal),7);
  const blocked=shot(8,'wide'),wall=shotTiming('sharp',blocked);assert(Math.abs(wall.result-1.55)<1e-8);assert.equal(shotPose(wall.result-.001,'leo',blocked),6);assert.equal(shotPose(wall.result,'leo',blocked),12);
  assert.equal(shotTiming('safe').result,1.70);assert.equal(shotTiming('safe').ready,2.35);assert.equal(shotTiming('extreme').result,2.50);assert.equal(shotTiming('extreme').ready,3.15);
});
test('group extraction retains five separate full defenders instead of discarding four as sprite noise',()=>{
  const width=100,height=50,pixels=new Uint8ClampedArray(width*height*4);
  for(let i=0;i<5;i++)for(let y=5;y<45;y++)for(let x=5+i*18;x<12+i*18;x++)pixels[(y*width+x)*4+3]=255;
  const {groups}=spriteParts(pixels,width,height,1,1,true,5);assert.equal(groups[0].length,5);assert(groups[0].every(p=>p.top===5&&p.bottom===44));
});

test('distant free kicks use three defenders, a smaller goal, earlier wall plane and smooth clear trajectories for every sector',()=>{
  const routes=new Set<string>();
  for(const [w,h] of [[320,385],[643,386],[1280,470],[1440,650]])for(const hero of ['cr','leo'] as const)for(let id=0;id<18;id++){
    const layout=shotLayout(w,h,hero,'extreme'),near=shotLayout(w,h,hero,'sharp'),wall=layout.wall!,s={...shot(id),risk:'extreme' as const},to=shotTarget(s,layout.goal),crossing=wall.crossing;
    assert.equal(wall.count,3);assert.equal(crossing,wallCrossing('extreme'));assert(crossing<WALL_CROSSING);
    assert(layout.goal.bottom>=h*.44&&layout.goal.bottom<near.goal.bottom);assert(layout.goal.width<near.goal.width);assert(wall.bottom>near.wall!.bottom&&wall.bottom<layout.ball.y);
    const start=freeKickFlight(0,layout.ball,to,wall,s),cross=freeKickFlight(crossing,layout.ball,to,wall,s),end=freeKickFlight(1,layout.ball,to,wall,s);
    assert.deepEqual({x:start.x,y:start.y},layout.ball);assert(Math.abs(end.x-to.x)<1e-7&&Math.abs(end.y-to.y)<1e-7);routes.add(cross.route);
    const jumpingTop=wall.bottom-wall.size*.9-h*.045,halfWall=wall.count/2*wall.spacing;
    assert(cross.y+shotBallRadius(h,'extreme',crossing)<jumpingTop||Math.abs(cross.x-wall.x)>halfWall+shotBallRadius(h,'extreme',crossing),'successful ball must clear all three defenders');
    const e=1e-5,a=freeKickFlight(crossing-e,layout.ball,to,wall,s),b=freeKickFlight(crossing+e,layout.ball,to,wall,s);
    const before={x:(cross.x-a.x)/e,y:(cross.y-a.y)/e},after={x:(b.x-cross.x)/e,y:(b.y-cross.y)/e};
    assert(Math.abs(before.x-after.x)<h*.003&&Math.abs(before.y-after.y)<h*.003);assert(Math.hypot(before.x,before.y)>h*.03);
    assert.equal(wallMotion(crossing,h,false,crossing).row,2);
  }assert.deepEqual([...routes].sort(),['around','over']);
});
test('distant wall contact and result clock agree, preserving all accepted loss types and probabilities',()=>{
  const layout=shotLayout(643,386,'leo','extreme'),wall=layout.wall!;let impacts=0;
  for(let id=0;id<18;id++)for(const finish of ['goal','save','post','wide'] as const){
    const s={...shot(id,finish),risk:'extreme' as const},hit=isWallHit(s),timing=shotTiming('extreme',s);
    if(hit){impacts++;assert.equal(finish,'wide');const p=freeKickFlight(wall.crossing,layout.ball,shotTarget(s,layout.goal),wall,s),contact=wallContact(s,wall);assert.equal(p.x,contact.x);assert.equal(p.y,contact.y);assert(contact.player>=0&&contact.player<3);assert.equal(wallMotion(wall.crossing,386,true,wall.crossing).row,3);assert(Math.abs(timing.result-1.534)<1e-8);assert.equal(shotPose(timing.result-.001,'leo',s),6);assert.equal(shotPose(timing.result,'leo',s),12);}
    else assert.equal(timing.result,2.50);
  }assert.equal(impacts,6);
});
test('three-member group extraction preserves full silhouettes in all four atlas cells',()=>{
  const width=120,height=100,pixels=new Uint8ClampedArray(width*height*4);
  for(let row=0;row<2;row++)for(let col=0;col<2;col++)for(let i=0;i<3;i++)for(let y=row*50+5;y<row*50+45;y++)for(let x=col*60+5+i*18;x<col*60+12+i*18;x++)pixels[(y*width+x)*4+3]=255;
  const {groups}=spriteParts(pixels,width,height,2,2,true,3);assert.equal(groups.length,4);assert(groups.every(g=>g.length===3));
});

test('goal rear net uses parallel columns and rows instead of diagonal hanging threads',()=>{
  for(const risk of ['safe','sharp','extreme'] as const)for(const [w,h] of [[320,385],[643,386],[1280,470]]){
    const goal=shotLayout(w,h,'cr',risk).goal;
    for(let col=0;col<=36;col++){const u=col/36;assert.equal(goalNetPoint(goal,u,0).x,goalNetPoint(goal,u,1).x);}
    for(let row=0;row<=12;row++){const v=row/12;assert.equal(goalNetPoint(goal,0,v).y,goalNetPoint(goal,1,v).y);}
    assert(goalNetPoint(goal,0,0).x>goal.x-goal.width/2);assert(goalNetPoint(goal,1,0).x<goal.x+goal.width/2);
    assert(goalNetPoint(goal,0,0).y>goal.bottom-goal.height);assert(goalNetPoint(goal,0,1).y<goal.bottom);
  }
});
test('goal mouth and every net seam stay fixed throughout an impact ripple',()=>{
  const goal=shotLayout(1280,470,'cr','safe').goal;
  for(const age of [-1,0,.05,.1,.3,.7,.8,2])for(const u of [0,.25,.5,.75,1])for(const v of [0,.25,.5,.75,1]){
    const impact={x:.4,y:.5,age};assert.deepEqual(goalNetPoint(goal,u,v,0,impact),goalNetPoint(goal,u,v,0));
    if(u===0||u===1||v===0||v===1)for(const d of [0,.25,.5,.75,1])assert.deepEqual(goalNetPoint(goal,u,v,d,impact),goalNetPoint(goal,u,v,d));
  }
});
test('net reaction starts after contact, stays local and settles without moving the rigid frame',()=>{
  const goal=shotLayout(1280,470,'cr','safe').goal,base=goalNetPoint(goal,.4,.5),impact={x:.4,y:.5,age:.06};
  assert.notDeepEqual(goalNetPoint(goal,.4,.5,1,impact),base);
  for(const age of [-1,0,.8,2])assert.deepEqual(goalNetPoint(goal,.4,.5,1,{...impact,age}),base);
  const moved=goalNetPoint(goal,.4,.5,1,impact);assert(Math.hypot(moved.x-base.x,moved.y-base.y)<goal.width*.02);
});

test('football stays visible throughout every shot and rebound, including the distant goal on a narrow screen',()=>{
  for(const h of [330,385,386,470,560,650])for(const risk of ['safe','sharp','extreme'] as const){
    const start=shotBallRadius(h,risk);assert(start>=h*.028);let previous=start;
    for(let i=0;i<=100;i++){const radius=shotBallRadius(h,risk,i/100);assert(radius>=5.5&&radius>=h*.015&&radius<=start);assert(radius<=previous+1e-9);previous=radius;}
    const crossing=wallCrossing(risk);assert(shotBallRadius(h,risk,1,true)>shotBallRadius(h,risk,crossing,true));
    assert.equal(shotBallRadius(h,risk,-1),start);assert.equal(shotBallRadius(h,risk,2),shotBallRadius(h,risk,1));
  }
});
