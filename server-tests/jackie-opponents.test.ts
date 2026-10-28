import test from 'node:test';
import assert from 'node:assert/strict';
import {opponentLineup,OPPONENTS} from '../games/jackie-chan/JackieOpponents';

test('the three difficulties use ordered opponent tiers without duplicates',()=>{
  const allowed={1:['street','agile'],2:['agile','bruiser','enforcer'],3:['bruiser','enforcer','master']} as const;
  for(const location of ['restaurant','harbor','market']as const){
    for(let fight=0;fight<5;fight++){
      const strength=[];
      for(const count of [1,2,3]as const){
        const foes=opponentLineup(location,fight,count);
        assert.equal(foes.length,count);assert.equal(new Set(foes.map(f=>f.id)).size,count);
        assert.deepEqual(foes,opponentLineup(location,fight,count));
        assert(foes.every(f=>(allowed[count] as readonly string[]).includes(f.id)));
        strength.push(foes.reduce((sum,foe)=>sum+foe.rank,0));
        assert.equal(foes.some(f=>f.id==='master'),count===3);
      }
      assert(strength[0]<strength[1]&&strength[1]<strength[2]);
    }
  }
});
test('lineups rotate within their tier and every role retains its own illustrated sheet',()=>{
  const locations=['restaurant','harbor','market']as const;
  for(const location of locations)for(const count of [1,2,3]){
    const sequence=Array.from({length:5},(_,fight)=>opponentLineup(location,fight,count).map(f=>f.id).join(','));
    assert(new Set(sequence).size>=2);
  }
  assert.notDeepEqual(opponentLineup('restaurant',0,2),opponentLineup('harbor',0,2));
  assert.equal(new Set(Object.values(OPPONENTS).map(f=>f.asset)).size,5);
  assert.throws(()=>opponentLineup('restaurant',0,4),RangeError);
});
