import test from 'node:test';import assert from 'node:assert/strict';
import {CrashStuntSequence,cargo,cinematicLabel,explosionAt,heli,impactAt,pickStunt,rollAt,rollPath,titleAt,tunnel,type StuntVariant} from '../games/last-exit/stunts';
import {Pursuit,WALL,type Car,type Fx,type Hero} from '../games/last-exit/pursuit';

test('unconfirmed running and countdown never select or label a result stunt',()=>{
 for(const phase of ['idle','waiting','racing'] as const)for(const value of [1,2,2.01,8,100]){assert.equal(pickStunt('a',phase,value),'drive');for(const age of [0,.5,4,1000])assert.equal(cinematicLabel(phase,'drive',age),phase);}
});
test('confirmed paid multipliers select helicopter, aircraft and tunnel at exact hundredths',()=>{
 for(let i=0;i<100;i++)for(const [value,expected] of [[1,'helicopter'],[2,'helicopter'],[2+Number.EPSILON,'helicopter'],[2.01,'cargo-plane'],[7.99,'cargo-plane'],[8,'tunnel'],[8-Number.EPSILON,'tunnel'],[100,'tunnel']] as const)assert.equal(pickStunt('winner-'+i,'escaped',value),expected);
 const losses=new Set<string>();for(let i=0;i<100;i++)losses.add(pickStunt('round-'+i,'crashed',1+i));assert.deepEqual([...losses].sort(),['pit-left','pit-right']);
 for(let i=0;i<50;i++)assert.equal(pickStunt('same','crashed',1+i),pickStunt('same','crashed',99));
});
test('consecutive new losses alternate attackers and revisiting a round keeps its side',()=>{
 const sequence=new CrashStuntSequence();let previous='';
 for(let i=0;i<60;i++){const id='same-hash-parity-'+i,side=sequence.choose(id,'crashed');assert.notEqual(side,previous);assert.equal(sequence.choose(id,'crashed'),side);sequence.choose('win-'+i,'escaped',3);sequence.choose(id,'racing');assert.equal(sequence.choose(id,'crashed'),side);previous=side;}
 const first=sequence.choose('same-hash-parity-0','crashed');assert.equal(first,pickStunt('same-hash-parity-0','crashed'));
});
test('cinematic labels follow their own order and the title never precedes the main accent',()=>{
 assert(impactAt<rollAt&&rollAt<explosionAt&&explosionAt<titleAt['pit-left']);assert(titleAt.helicopter>heli.depart&&titleAt['cargo-plane']>cargo.departure&&titleAt.tunnel>tunnel.slide);
 const walk=(variant:StuntVariant,phase:'escaped'|'crashed')=>{const seen:string[]=[];for(let t=0;t<14;t+=.01){const l=cinematicLabel(phase,variant,t);if(seen.at(-1)!==l){assert(!seen.includes(l));seen.push(l);}}return seen;};
 assert.deepEqual(walk('pit-left','crashed'),['intercept','depth-rollover','explosion']);
 assert.deepEqual(walk('helicopter','escaped'),['helicopter-approach','cables-descending','airlift','fly-away','extracted']);
 assert.equal(walk('cargo-plane','escaped').at(-1),'extracted');assert.deepEqual(walk('tunnel','escaped'),['exit-approach','exit-turn','tunnel-entry','rockslide','extracted']);
 assert.equal(cinematicLabel('escaped','tunnel',0,true),'passing-bridge');
});
test('the losing roll is ballistic, meets the barrier once and rests on its roof',()=>{
 for(const dir of [-1,1])for(const reach of [.8,WALL-.2]){const p=rollPath(dir,dir*.16,rollAt,explosionAt,reach);assert(p.contacts.length>=4&&p.contacts.length<=8);assert(p.wall>rollAt&&p.wall<explosionAt);
  for(let i=1;i<p.contacts.length;i++)assert(p.contacts[i]>p.contacts[i-1]);for(const f of p.frames){assert(f.y>=0&&Number.isFinite(f.x)&&Math.abs(f.x)<WALL);}
  const turns=p.frames.at(-1)!.roll/Math.PI;assert(Math.abs(turns-Math.round(turns))<1e-9&&Math.round(turns)%2===1);assert.deepEqual(p,rollPath(dir,dir*.16,rollAt,explosionAt,reach));}
});

function chase(seed:number,seconds:number,step:number,value:number|((t:number)=>number)=1.4){
 const log:string[]=[];const fx:Fx={hit:(x,_y,z,p)=>log.push('hit:'+[x,z,p].map(v=>v.toFixed(3)).join(',')),scrape(){},contact:c=>log.push('contact'+c.id),wreck:c=>log.push('wreck'+c.id),boom:()=>log.push('boom'),smash:p=>log.push('smash'+p.kind),hero:()=>log.push('hero')};
 const sim=new Pursuit(fx);sim.reset(seed);const hero:Hero={x:0,vx:0,hw:.15,z:1.055,bias:0};for(const side of [-1,1])sim.make('cop',{side,x:side*.565,z:1.06,v:26,tx:side*.565,hw:.12});
 let most=0;for(let t=0;t<seconds;t+=step){const ax=(sim.wish(hero,0)-hero.x)*22-hero.vx*6;hero.vx+=ax*step;hero.x+=hero.vx*step;sim.ensure(26,.12,step);sim.step(step,26,hero,typeof value==='number'?value:value(t),'race');most=Math.max(most,sim.cars.length);
  assert(Math.abs(hero.x)<=WALL,'the coupe stays on the road');for(const c of sim.cars)for(const n of [c.x,c.z,c.y,c.vx,c.v,c.yaw,c.roll])assert(Number.isFinite(n));}
 return {log,most,trips:sim.count,cars:sim.cars as Car[]};
}
test('the chase is reproducible from its public seed and differs between runs',()=>{
 const a=chase(7,20,1/120),b=chase(7,20,1/120),c=chase(8,20,1/120);assert.deepEqual(a.log,b.log);assert.notDeepEqual(a.log,c.log);
});
test('long chases stay finite and bounded while patrols keep being replaced',()=>{
 for(let seed=1;seed<=8;seed++){const r=chase(seed*37,90,1/120,t=>Math.min(100,Math.exp(.06*t)));assert(r.most<=9);assert(r.trips>3);assert(r.log.some(x=>x.startsWith('hit')));}
});
test('physics receives no session, deadline, outcome or wallet input',async()=>{
 const {readFile}=await import('node:fs/promises');for(const file of ['pursuit.ts','scene-base.ts','scene-road.ts','scene-actors.ts','scene-effects.ts','scene-finales.ts','LastExitScene.ts']){const source=await readFile(new URL('../games/last-exit/'+file,import.meta.url),'utf8');
  assert.doesNotMatch(source,/crashAt|crashPoint|serverNow|startedAt|returnedUnits|stakeUnits|ExpansionClient|WalletClient|fetch\(/,file);}
 for(const file of ['pursuit.ts','stunts.ts'])assert.doesNotMatch(await readFile(new URL('../games/last-exit/'+file,import.meta.url),'utf8'),/Math\.random/);
});
