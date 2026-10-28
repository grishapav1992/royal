import test from 'node:test';
import assert from 'node:assert/strict';
import {choreography,contactAt,chairReleaseAt,resultAt,VICTORY_DURATION} from '../games/jackie-chan/JackieChoreography';

test('chair grip, lift, block and physical strike precede the confirmed group result',()=>{
  for(const [time,phase,pose]of [[.25,'chair-grab',0],[.6,'chair-lift',1],[.9,'chair-block',2],[contactAt(0),'chair-strike',3]]as const){
    const f=choreography(time,1,'playing');assert.equal(f.phase,phase);assert.equal(f.pose,pose);assert.equal(f.atlas,'furniture');assert.equal(f.furniture,'chair');assert(!f.reveal);assert(f.busy);
  }
  assert(!choreography(resultAt(1)-.001,1,'playing').reveal);assert(choreography(resultAt(1),1,'playing').reveal);
});

test('a missed group also keeps the chair through recovery and lowers it before releasing',()=>{
  for(const status of ['playing','lost']as const)for(const count of [1,2,3]){
    const recover=choreography(contactAt(0)+.3,count,status),lower=choreography(contactAt(0)+.6,count,status);
    assert.equal(recover.phase,'chair-recover');assert.equal(recover.furniture,'chair');
    assert.equal(lower.phase,'chair-lower');assert.equal(lower.furniture,'chair');assert.equal(lower.pose,0);
    const release=choreography(chairReleaseAt(),count,status);assert.equal(release.furniture,null);assert(!release.reveal);
    assert(lower.x<recover.x);assert.equal(recover.atlas,'furniture');assert.equal(lower.atlas,'furniture');
  }
});
test('the contact cue selects table and stool actions for the second and third opponents',()=>{
  for(const count of [2,3])for(let i=0;i<count;i++){
    const f=choreography(contactAt(i),count,'playing');assert.equal(f.fighter,i);assert.equal(f.furniture,['chair','table','stool'][i]);assert.equal(f.pose,[3,4,5][i]);assert.equal(f.atlas,'furniture');
  }
});
test('complete series has a distinct fist, bow and final victory pose, while losses never celebrate',()=>{
  for(const count of [1,2,3]){
    const end=resultAt(count);
    assert.equal(choreography(end+.6,count,'complete').phase,'victory-fist');assert.equal(choreography(end+.6,count,'complete').pose,6);
    assert.equal(choreography(end+1.6,count,'complete').phase,'victory-bow');assert.equal(choreography(end+1.6,count,'complete').pose,7);
    assert(choreography(end+.6,count,'complete').celebrating);assert(choreography(end+.6,count,'complete').reveal);
    assert(!choreography(end+VICTORY_DURATION,count,'complete').busy);
    assert(!choreography(end+.6,count,'lost').celebrating);assert.equal(choreography(end+.6,count,'lost').phase,'lost');
    const restored=choreography(Infinity,count,'complete');assert.equal(restored.phase,'victory-hold');assert(!restored.busy);assert(!restored.celebrating);
    assert(!choreography(end+.6,count,'playing').celebrating);assert(!choreography(.5,count,'banked',true).celebrating);
  }
});
