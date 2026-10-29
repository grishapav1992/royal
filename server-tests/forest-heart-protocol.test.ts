import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {startForestHeart,moveForestHeart,forestHeartEnergy} from '../server/games/forestHeart';
import {FOREST_HEART_GAME,validForestHeartView,validForestHeartSettlement,validForestHeartSession} from '../src/shared/forestHeart';
import {validExpansionAction} from '../src/shared/casinoExpansion';
const settings={forestHeart:{mode:'normal' as const}};
function programmed(values:number[]){
  const calls:number[]=[];
  return {calls,draw:(max:number)=>{calls.push(max);assert(values.length,'Unexpected future draw');const value=values.shift()!;assert(value<max);return value;}};
}
test('all 10000 energy tickets reproduce the declared exact weights',()=>{
  const histogram=new Map<number,number>();
  for(let i=0;i<10000;i++){const energy=forestHeartEnergy(i);histogram.set(energy,(histogram.get(energy)??0)+1);}
  assert.deepEqual([...histogram],[[1,9000],[2,800],[5,180],[20,19],[100,1]]);
  for(const value of [-1,10000,NaN,1.2])assert.throws(()=>forestHeartEnergy(value));
});
test('start reveals only four independent completed draws, not future bonus fields',()=>{
  const rng=programmed([0,0,0,0]),started=startForestHeart(settings,'1000',rng.draw);
  assert.deepEqual(rng.calls,[4096,10000,32,64]);assert.equal(started.view.stage,'choice');
  assert.equal(started.credit,0);assert.deepEqual(started.view.bonus,[]);assert.equal(started.view.remaining,4);
  assert(validForestHeartSettlement('active','1000','1000','0',started.view));
  assert.deepEqual(Object.keys(started.view).sort(),['base','bonus','heldState','kind','remaining','revision','stage','totalPayoutUnits','version']);
  assert.equal(JSON.stringify(started).includes('seed'),false);
});
test('one visible turn consumes no entropy, bonus draws lazily and the whole series credits only once',()=>{
  const rng=programmed([0,0,0,0,...Array.from({length:4},()=>[132,0]).flat()]);
  let reply=startForestHeart(settings,'1000',rng.draw);const original=structuredClone(reply.view);
  reply=moveForestHeart(reply.view,'1000',1,'forest-turn-2',rng.draw);
  assert.equal(rng.calls.length,4);assert.equal(reply.credit,0);assert.equal(reply.view.stage,'bonus');
  assert.equal(original.base.choiceDone,false);assert.equal(original.revision,1);
  for(let i=0;i<4;i++){
    const previous=structuredClone(reply.view);
    reply=moveForestHeart(reply.view,'1000',reply.view.revision,'forest-spin',rng.draw);
    assert.equal(reply.view.bonus.length,i+1);assert.equal(rng.calls.length,6+i*2);
    assert.equal(previous.bonus.length,i);assert(validForestHeartView(reply.view,'1000'));
    assert.equal(reply.credit,i===3?Number(reply.view.totalPayoutUnits):0);
  }
  assert(reply.ended);assert.equal(reply.view.remaining,0);assert.equal(reply.view.revision,6);
  assert.equal(reply.credit,8834);
  assert.throws(()=>moveForestHeart(reply.view,'1000',reply.view.revision,'forest-spin',rng.draw));
  assert.equal(rng.calls.length,12);
});
test('stale revisions, unavailable moves and tampered history are rejected before any new draw',()=>{
  const rng=programmed([0,0,0,0]),initial=startForestHeart(settings,'1000',rng.draw);
  for(const [revision,move] of [[0,'forest-pass'],[1,'forest-spin'],[1,'forest-turn-12'],[1,'cashout']]as const)
    assert.throws(()=>moveForestHeart(initial.view,'1000',revision,move,rng.draw));
  const mutated=structuredClone(initial.view);mutated.totalPayoutUnits='99999999';
  assert.equal(validForestHeartView(mutated,'1000'),false);
  assert.throws(()=>moveForestHeart(mutated,'1000',1,'forest-pass',rng.draw));
  const bonus=moveForestHeart(initial.view,'1000',1,'forest-pass',rng.draw);
  const next=moveForestHeart(bonus.view,'1000',2,'forest-spin',programmed([132,0]).draw);
  for(const mutate of [
    (v:typeof next.view)=>{v.bonus[0].payoutUnits='0';},
    (v:typeof next.view)=>{v.bonus[0].heldState=242;},
    (v:typeof next.view)=>{v.remaining++;},
    (v:typeof next.view)=>{v.revision++;},
  ]){const value=structuredClone(next.view);mutate(value);assert.equal(validForestHeartView(value,'1000'),false);}
  assert.equal(rng.calls.length,4);
});
test('strict public actions reject client outcomes, invalid stakes, extra fields and unsupported revisions',()=>{
  const start={id:randomUUID(),action:'start',gameId:FOREST_HEART_GAME,stakeUnits:'1000',settings};
  assert(validExpansionAction(start));
  assert(!validExpansionAction({...start,seed:1}));
  assert(!validExpansionAction({...start,settings:{forestHeart:{mode:'normal',payoutUnits:'999'}}}));
  const move={id:randomUUID(),action:'move',gameId:FOREST_HEART_GAME,sessionId:start.id,move:'forest-turn-11',revision:1};
  assert(validExpansionAction(move));
  for(const changed of [{...move,picks:[1]},{...move,payoutUnits:'1'},{...move,revision:0},{...move,revision:6},{...move,move:'forest-turn-12'}])assert(!validExpansionAction(changed));
  let draws=0;
  assert.throws(()=>startForestHeart(settings,'1001',()=>{draws++;return 0;}));assert.equal(draws,0);
  for(const invalid of [-1,4096,NaN,1.5])assert.throws(()=>startForestHeart(settings,'1000',()=>invalid));
  const settled=startForestHeart(settings,'1000',programmed([132,0,1,1]).draw);
  const session={gameId:FOREST_HEART_GAME,rulesVersion:1,state:'settled',stakeUnits:'1000',spentUnits:'1000',returnedUnits:String(settled.credit),
    view:{forestHeart:settled.view,ended:true,phase:2,actions:[]}};
  assert(validForestHeartSession(session));assert(!validForestHeartSession({...session,returnedUnits:'0'}));
});
