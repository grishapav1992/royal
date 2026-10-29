import test from 'node:test';
import assert from 'node:assert/strict';
import { FlagPhysics, FLAG_BODY_RADIUS, FLAG_PHYSICS_STEP, angleDistance, planFlagPhysics, resolveFlagPair, type FlagBody } from '../games/flag-battle/FlagPhysics';
const body=(id:number,x:number,y:number,vx:number,vy:number):FlagBody=>({id,x,y,vx,vy,previousX:x,previousY:y,escapedAt:null});
const near=(a:number,b:number)=>assert(Math.abs(a-b)<1e-9,`${a} differs from ${b}`);

test('equal-mass head-on and glancing contacts conserve momentum and kinetic energy',()=>{
  for(const [x,y]of [[.16,0],[.12,.09],[0,.16]]){
    const a=body(0,0,0,.7,.4),b=body(1,x,y,-.5,-.2);
    const px=a.vx+b.vx,py=a.vy+b.vy,energy=a.vx*a.vx+a.vy*a.vy+b.vx*b.vx+b.vy*b.vy;
    resolveFlagPair(a,b);
    near(a.vx+b.vx,px);near(a.vy+b.vy,py);near(a.vx*a.vx+a.vy*a.vy+b.vx*b.vx+b.vy*b.vy,energy);
    assert(Math.hypot(a.x-b.x,a.y-b.y)>=FLAG_BODY_RADIUS*2);
  }
});
test('overlapping centers separate finitely; separating contacts do not bounce a second time',()=>{
  const a=body(0,0,0,1,0),b=body(1,0,0,-1,0);resolveFlagPair(a,b);
  assert([a.x,a.y,a.vx,a.vy,b.x,b.y,b.vx,b.vy].every(Number.isFinite));
  assert(Math.hypot(a.x-b.x,a.y-b.y)>=FLAG_BODY_RADIUS*2);
  const c=body(2,0,0,-1,0),d=body(3,.15,0,1,0);resolveFlagPair(c,d);near(c.vx,-1);near(d.vx,1);
});
test('initial placement has no overlaps, and a closed preview never leaks through the ring',()=>{
  for(const seed of [0,1,93,2147483647]){
    const w=new FlagPhysics(seed,true);
    for(let i=0;i<12;i++)for(let j=i+1;j<12;j++)assert(Math.hypot(w.bodies[i].x-w.bodies[j].x,w.bodies[i].y-w.bodies[j].y)>=2*FLAG_BODY_RADIUS);
    w.advance(12);assert.equal(w.exits.length,0);
    for(const b of w.bodies)assert(Math.hypot(b.x,b.y)<=1-FLAG_BODY_RADIUS-.0119);
  }
});
test('30, 60 and 144 fps produce the same fixed-step trajectory',()=>{
  const worlds=[30,60,144].map(fps=>{const w=new FlagPhysics(93,true);for(let i=0;i<fps*6;i++)w.advance(1/fps);return w;});
  for(const w of worlds.slice(1)){
    near(w.time,worlds[0].time);
    for(let i=0;i<12;i++){near(w.bodies[i].x,worlds[0].bodies[i].x);near(w.bodies[i].y,worlds[0].bodies[i].y);}
  }
});
test('anonymous physical exits are deterministic, bounded and pass through the actual opening',()=>{
  for(const seed of [0,1,2,7,93,74117,910493,1528496907,2147483647]){
    const plan=planFlagPhysics(seed);
    assert.equal(plan.order.length,12);assert.equal(new Set(plan.order).size,12);assert(plan.duration<90);
    for(const e of plan.exits){
      assert(Math.hypot(e.x,e.y)>1+FLAG_BODY_RADIUS);
      assert(Math.abs(angleDistance(Math.atan2(e.y,e.x),e.gap))<e.halfGap+.03);
    }
    const replay=new FlagPhysics(seed);while(!replay.finished)replay.advance(1/60);
    assert.deepEqual(replay.exits,plan.exits);assert.deepEqual(replay.bodies,plan.terminal);
  }
});
test('opening moves continuously and contacts do not teleport a flag toward the exit',()=>{
  const w=new FlagPhysics(93);let lastGap=0;
  while(!w.finished){
    const positions=w.bodies.map(b=>({x:b.x,y:b.y}));w.step();
    assert(Math.abs(w.halfGap-lastGap)<=.301*FLAG_PHYSICS_STEP);lastGap=w.halfGap;
    for(const b of w.bodies)if(b.escapedAt===null)assert(Math.hypot(b.x-positions[b.id].x,b.y-positions[b.id].y)<.05);
  }
});

test('restored completed rounds draw only the winner, without a frozen departing flag',async()=>{
  const {FlagArena}=await import('../games/flag-battle/FlagArena');
  const {flagCountries,FLAG_MODES}=await import('../src/shared/flagBattle');
  const imageDescriptor=Object.getOwnPropertyDescriptor(globalThis,'Image'),ratioDescriptor=Object.getOwnPropertyDescriptor(globalThis,'devicePixelRatio');
  Object.defineProperty(globalThis,'Image',{configurable:true,value:class{src='';complete=true;naturalWidth=90;}});
  Object.defineProperty(globalThis,'devicePixelRatio',{configurable:true,value:1});
  try{
    let draws=0;
    const context=new Proxy({createRadialGradient:()=>({addColorStop(){}}),drawImage:()=>{draws++;}},{get:(target,key)=>Reflect.get(target,key)??(()=>{})});
    const canvas={width:0,height:0,getContext:()=>context,getBoundingClientRect:()=>({width:600,height:600})};
    const arena=new FlagArena(canvas as unknown as HTMLCanvasElement);
    arena.reset({version:1,country:'RU',order:flagCountries().map(c=>c.id),seed:1528496907});
    arena.finish();arena.tick(100,false,'RU',true);assert.equal(draws,1);
    assert.equal(arena.count(),11);
    for(const mode of FLAG_MODES){
      arena.reset({version:2,mode:mode.id,country:'RU',order:flagCountries(mode.id).map(c=>c.id),seed:0});
      arena.tick(0,true,'RU',true);
      let state;
      for(let frame=1;frame<=mode.seconds*30;frame++)state=arena.tick(frame*1000/60,true,'RU',true);
      assert(Math.abs(state!.playhead-mode.seconds/2)<.02,mode.id+' must use its own round duration for the audio clock');
      for(let frame=mode.seconds*30+1;frame<=(mode.seconds+1)*60;frame++)state=arena.tick(frame*1000/60,true,'RU',true);
      assert.equal(state!.finished,true);assert.equal(state!.eliminated,mode.count-1);
      assert(Math.abs(state!.playhead-mode.seconds-.7)<.02);
    }
  }finally{
    if(imageDescriptor)Object.defineProperty(globalThis,'Image',imageDescriptor);else Reflect.deleteProperty(globalThis,'Image');
    if(ratioDescriptor)Object.defineProperty(globalThis,'devicePixelRatio',ratioDescriptor);else Reflect.deleteProperty(globalThis,'devicePixelRatio');
  }
});

test('larger modes place all bodies apart and deterministically clear N-1 real exits',()=>{
  for(const count of [24,48])for(const seed of [0,93]){
    const preview=new FlagPhysics(seed,true,undefined,count);assert.equal(preview.bodies.length,count);
    for(let i=0;i<count;i++)for(let j=i+1;j<count;j++)assert(Math.hypot(preview.bodies[i].x-preview.bodies[j].x,preview.bodies[i].y-preview.bodies[j].y)>=preview.radius*2);
    preview.advance(2);assert.equal(preview.exits.length,0);
    const plan=planFlagPhysics(seed,count),replay=new FlagPhysics(seed,false,undefined,count);
    assert.equal(plan.order.length,count);assert.equal(new Set(plan.order).size,count);assert.equal(plan.exits.length,count-1);assert(plan.duration<90);
    while(!replay.finished)replay.advance(1/60);assert.deepEqual(replay.exits,plan.exits);
    for(const e of plan.exits){assert(Math.hypot(e.x,e.y)>1+replay.radius);assert(Math.abs(angleDistance(Math.atan2(e.y,e.x),e.gap))<e.halfGap+.03);}
    assert.equal(replay.bodies.filter(b=>b.escapedAt===null).length,1);
  }
});
