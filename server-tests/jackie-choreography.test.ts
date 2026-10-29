import test from 'node:test';
import assert from 'node:assert/strict';
import {choreography as timeline,contactAt,chairReleaseAt,resultAt,VICTORY_DURATION,impacts,recoveryX} from '../games/jackie-chan/JackieChoreography';
import {FIGHT_PLANS,FURNITURE_PLAN,fightPlan,moveFurniture,combatPose} from '../games/jackie-chan/JackieFightPlans';
import {openingActions} from '../games/jackie-chan/JackieOpenings';
const choreography=(elapsed:number,count:number,status:Parameters<typeof timeline>[2],cashout=false)=>timeline(elapsed,count,status,cashout,FURNITURE_PLAN);

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

test('every series changes choreography between its five fights and restores the same choice without a chair opener',()=>{
  const seen=new Set<string>();
  for(let series=0;series<100;series++)for(const place of ['restaurant','harbor','market']as const){
    const plans=Array.from({length:5},(_,i)=>fightPlan('series-'+series,i,place));assert.equal(new Set(plans.map(p=>p.id)).size,5);assert.notEqual(plans[0].moves[0],'chair');
    for(let i=0;i<5;i++){assert.deepEqual(fightPlan('series-'+series,i,place),plans[i]);seen.add(plans[i].id);}
  }
  assert.equal(seen.size,13);
});

test('all thirteen move types have the right contact pose, material and result boundary',()=>{
  assert.equal(new Set(FIGHT_PLANS.map(p=>p.moves[0])).size,13);
  for(const plan of FIGHT_PLANS)for(const count of [1,2,3])for(const status of ['playing','lost']as const){
    for(let i=0;i<count;i++){
      const move=plan.moves[i],frame=timeline(contactAt(i),count,status,false,plan);assert.equal(frame.fighter,i);assert.equal(frame.move,move);assert.equal(frame.furniture,moveFurniture(move));assert(!frame.reveal);assert(frame.busy);
      assert.equal(frame.pose,combatPose(move)??(move==='table'?4:move==='stool'?5:move==='kick'?4:3));
      const events=impacts(plan,count).filter(event=>event.fighter===i);assert.equal(events.filter(e=>e.primary).length,1);assert.equal(events.at(-1)!.at,contactAt(i));
      assert.equal(events.length,move==='combo'?5:4);
      if(move!=='chair'){
        for(const [index,opening]of openingActions(plan,i).entries()){
          const frame=timeline(events[index].at,count,status,false,plan);
          assert.equal(frame.phase,opening.phase);assert.equal(frame.pose,opening.pose);assert.equal(frame.atlas,opening.atlas);
          assert.equal(events[index].actor,opening.actor);assert.equal(events[index].kind,opening.kind);
        }
      }
      if(move==='combo')assert.equal(timeline(events[3].at,count,status,false,plan).phase,'jab');
    }
    assert(!timeline(resultAt(count)-.001,count,status,false,plan).reveal);assert(timeline(resultAt(count),count,status,false,plan).reveal);
    assert(!timeline(Infinity,count,status,false,plan).busy);
  }
});

test('all twelve unarmed routines have distinct opening exchanges and vary between opponents',()=>{
  const plans=FIGHT_PLANS.filter(plan=>plan.id!=='chair-counter');
  assert.equal(new Set(plans.map(plan=>openingActions(plan,0).map(a=>a.phase).join(','))).size,12);
  for(const plan of plans)assert.notDeepEqual(openingActions(plan,0),openingActions(plan,1));
});

test('the next opponent starts after chair release and the hero continues from the recovery position',()=>{
  for(const plan of [...FIGHT_PLANS,FURNITURE_PLAN])for(let i=1;i<3;i++){
    const start=contactAt(i)-1.82;
    if(plan.moves[i-1]==='chair')assert(start>chairReleaseAt(i-1));
    const next=timeline(start+.001,3,'playing',false,plan);
    assert.equal(next.fighter,i);assert.equal(next.phase,'approach');assert(Math.abs(next.x-recoveryX(plan,i-1))<.001);
  }
});
