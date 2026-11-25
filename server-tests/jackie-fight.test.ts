import test from 'node:test';
import assert from 'node:assert/strict';
import {Fight,RATE,REACTION,VICTORY,contactAt,revealAt,type Options,type Status} from '../games/jackie-chan/JackieFight';
import {OPPONENTS,opponentLineup,type OpponentId} from '../games/jackie-chan/JackieOpponents';
import type {Sheet} from '../games/jackie-chan/JackieArt';

// Drawn measurements are not available outside a browser; plausible bodies are enough for the script.
const frame=(dx:number)=>({img:null as never,k:1,ax:0,w:1,h:1,native:1 as const,tip:{dx,dy:.7},front:()=>.18});
const hero:Sheet=Object.fromEntries(['b','f','c'].flatMap(s=>Array.from({length:8},(_,i)=>[s+i,frame(.45)])));
const foe:Sheet=Object.fromEntries(Array.from({length:8},(_,i)=>['b'+i,frame(.45)]));
const foes=Object.fromEntries(Object.keys(OPPONENTS).map(id=>[id,foe]));
const places=['restaurant','harbor','market']as const;
const make=(o:Partial<Options>&{count?:number}={})=>{const location=o.location??'restaurant',fightIndex=o.fightIndex??0;
  return new Fight({seed:'series',location,fightIndex,lineup:opponentLineup(location,fightIndex,o.count??1).map(f=>f.id as OpponentId),status:'playing',hero,foes,W:1.5,...o});};
const all=function*(){for(const location of places)for(const count of [1,2,3])for(let fightIndex=0;fightIndex<5;fightIndex++)for(const seed of ['a','b','c','d'])yield {location,count,fightIndex,seed};};

test('the same accepted fight is rebuilt exactly and a series changes its exchanges',()=>{
  for(const o of all()){const first=make(o),again=make(o);assert.equal(first.sequence,again.sequence);assert.deepEqual(first.fx,again.fx);assert.deepEqual(first.cues,again.cues);}
  for(const location of places)for(const count of [1,2,3])for(const seed of ['a','b','c']){
    const fights=Array.from({length:5},(_,fightIndex)=>make({location,count,seed,fightIndex}));
    assert.equal(new Set(fights.map(f=>f.sequence)).size,5);
    const last=fights.map(f=>f.beats.at(-1)!.label);assert(new Set(last).size>=4,`${location} ${count} ${seed}: ${last}`);last.forEach((id,i)=>assert.notEqual(id,last[i-1]));
  }
});
test('no actor moves differently before the decisive contact, so the outcome stays hidden',()=>{
  for(const o of all()){
    const won=make({...o,status:o.fightIndex===4?'complete':'playing'}),lost=make({...o,status:'lost'}),decisive=contactAt(o.count-1);
    assert.equal(won.sequence,lost.sequence);
    for(let t=0;t<decisive-.075;t+=1/60)for(const [a,b]of [[won.hero,lost.hero],...won.foes.map((f,i)=>[f,lost.foes[i]])]){
      const p=a.at(t),q=b.at(t);assert.equal(p.pose,q.pose);assert(Math.abs(p.x-q.x)<1e-9&&Math.abs(p.y-q.y)<1e-9);
    }
    const early=(f:Fight)=>f.cues.filter(c=>c.t<decisive-.15).map(c=>[c.t,c.kind,c.level]);assert.deepEqual(early(won),early(lost));
    const cams=(f:Fight)=>f.cams.filter(c=>c.t<decisive-.1);assert.deepEqual(cams(won),cams(lost));
    const marks=(f:Fight)=>f.fx.filter(e=>e.t<decisive-.1).map(e=>[e.t,e.kind,e.x]);assert.deepEqual(marks(won),marks(lost));
  }
});
test('the choice of moves does not depend on the size of the window',()=>{
  for(const o of all()){const sizes=[.9,1.1,1.6,2.4].map(W=>make({...o,W}).sequence);assert.equal(new Set(sizes).size,1);}
});
test('normal fights last about four, seven and nine seconds and celebrate only a complete series',()=>{
  for(const count of [1,2,3]){
    const seconds=(status:Status)=>make({count,status}).end/RATE;
    assert(Math.abs(seconds('playing')-[4.27,6.73,9.19][count-1])<.02);assert(Math.abs(seconds('complete')-seconds('playing')-(VICTORY-REACTION)/RATE)<.01);
    assert(revealAt(count)>contactAt(count-1)+1);
  }
});
test('exchanges are at least as dense as promised and every position is finite',()=>{
  const totals:Record<number,number[]>={1:[],2:[],3:[]};
  for(const o of all()){
    const f=make({...o,status:o.fightIndex===4?'complete':'playing'});totals[o.count].push(f.hits+f.evades);
    for(let t=-1;t<f.end+2;t+=.05)for(const a of [f.hero,...f.foes]){const s=a.at(t);assert(Number.isFinite(s.x+s.y+s.rot+s.z));assert(s.y>=0);}
    for(const c of f.cues)assert(Number.isFinite(c.t)&&c.level>0);
    assert(f.foes.every(a=>a.down));
  }
  const mean=(n:number)=>totals[n].reduce((a,b)=>a+b)/totals[n].length;
  assert(mean(1)>=7);assert(mean(2)>=13);assert(mean(3)>=20);
});
test('a piece of the set is used once and survives until the move that needs it',()=>{
  const uses:Record<string,string>={stoolThrow:'stool',barrelRoll:'barrel',fruitThrow:'basket',chair:'chair',table:'table',stool:'stool',barrel:'barrel',cart:'cart',basket:'basket'};
  const seen=new Set<string>();
  for(const o of all()){
    const f=make(o),ids=f.sequence.split('|').flatMap(s=>s.split('+'));ids.forEach(id=>seen.add(id));
    const kinds=ids.map(id=>uses[id]).filter(Boolean);assert.equal(new Set(kinds).size,kinds.length,f.sequence);
  }
  const f=make();for(const p of [...f.phrases(),...f.finishers()])if(!/^m\d$/.test(p.id))assert(seen.has(p.id),p.id+' is never chosen');
  assert(f.phrases().length+f.finishers().length>=40);
});
test('big flashes stay within three per second even at double speed',()=>{
  for(const o of all()){
    const f=make({...o,status:o.fightIndex===4?'complete':'playing'}),big=f.fx.filter(e=>e.kind==='hit'&&e.power>=1.5).map(e=>e.t/RATE).sort((a,b)=>a-b);
    for(const speed of [1,2])big.forEach((t,i)=>assert(big.filter((u,j)=>j>=i&&(u-t)/speed<1).length<=3,`${speed}x ${f.sequence}`));
  }
});
test('after a result everyone rests inside the frame at wide and narrow sizes',()=>{
  for(const o of all())for(const W of [.9,1.1,1.6])for(const status of ['playing','lost','complete']as const){
    const f=make({...o,W,status});for(const a of [f.hero,...f.foes])assert(Math.abs(a.x(f.end+3))<=Math.max(W-.1,.55),`${status} ${W} ${a.track.id} ${a.x(f.end+3)}`);
  }
});
