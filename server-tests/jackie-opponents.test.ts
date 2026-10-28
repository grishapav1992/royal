import test from 'node:test';
import assert from 'node:assert/strict';
import {opponentLineup,OPPONENTS} from '../games/jackie-chan/JackieOpponents';

test('every group has distinct opponents and single-opponent runs show all five identities',()=>{
  for(const location of ['restaurant','harbor','market']as const){
    const singles=[];
    for(let fight=0;fight<5;fight++){
      singles.push(opponentLineup(location,fight,1)[0].id);
      for(const count of [1,2,3]){
        const foes=opponentLineup(location,fight,count);
        assert.equal(foes.length,count);assert.equal(new Set(foes.map(f=>f.id)).size,count);
        assert.deepEqual(foes,opponentLineup(location,fight,count));
        assert.deepEqual(foes,opponentLineup(location,fight,3).slice(0,count));
      }
    }
    assert.equal(new Set(singles).size,5);
  }
});
test('location gives a distinct first group and each role has its own illustrated sheet',()=>{
  const locations=['restaurant','harbor','market']as const;
  assert.equal(new Set(locations.map(l=>opponentLineup(l,0,1)[0].id)).size,3);
  assert.equal(new Set(Object.values(OPPONENTS).map(f=>f.asset)).size,5);
});
