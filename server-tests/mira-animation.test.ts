import {test} from 'node:test';
import assert from 'node:assert/strict';
import {interpolateMiraWalk,sampleMiraFrame,MIRA_ATLASES} from '../src/game/miraAnimation';
import {MiraRoutine,type MiraView} from '../src/shared/miraRoutine';
import {NpcMotion} from '../src/network/NpcMotion';
const view=(action:MiraView['action'],progress:number):MiraView=>({x:265,y:456,facing:'down',action,progress});

test('interrupted sitting reverses the painted sequence at the same contact position',()=>{
  const routine=new MiraRoutine();
  for(let n=0;n<2300&&routine.state.action!=='sit-down';n++)routine.tick(.05);
  for(let n=0;n<5;n++)routine.tick(.05);
  const before=sampleMiraFrame(routine.state);routine.tick(.05,false,false,'listen');
  const after=sampleMiraFrame(routine.state);
  assert.equal(after.clip,'stand-up');assert.equal(after.frame,before.frame);assert.ok(Math.abs(after.seat-before.seat)<1e-12);assert.equal(after.atlas,'seat');
});

test('painted service keeps a completed presentation without repeating its pour',()=>{
  const pouring=sampleMiraFrame(view('serve',.4));assert.equal(pouring.atlas,'serve');assert.equal(pouring.frame,3);
  for(const p of [.9,1,2])assert.equal(sampleMiraFrame(view('serve',p)).frame,7);
  const indices=Array.from({length:101},(_,i)=>sampleMiraFrame(view('serve',i/100)).frame);
  for(let i=1;i<indices.length;i++)assert.ok(indices[i]>=indices[i-1]);
});

test('all actions select existing complete poses, including ends and nonfinite drafts',()=>{
  for(const action of ['idle','walk','wipe','polish','stock','greet','listen','chat','serve','sit','sit-down','stand-up'] as const){
    for(const p of [-1,0,.05,.3,.5,.99,1,2,NaN]){
      const result=sampleMiraFrame(view(action,p));
      assert.ok(result.frame>=0&&result.frame<MIRA_ATLASES[result.atlas].columns*MIRA_ATLASES[result.atlas].rows);
    }
  }
  assert.equal(sampleMiraFrame({...view('walk',.2),facing:'left'}).flipped,true);
  assert.equal(sampleMiraFrame({...view('walk',.2),facing:'right'}).flipped,false);
});

test('walk renders all 24 frames in both directions between room updates',()=>{
  for(const facing of ['left','right'] as const){
    const motion=new NpcMotion<MiraView>({delayMs:0,interpolate:interpolateMiraWalk});
    for(let tick=0;tick<=13;tick++){
      motion.push({...view('walk',(tick*50/625)%1),facing},tick*50);
    }
    for(let frame=0;frame<24;frame++){
      const sample=sampleMiraFrame(motion.sample((frame+.5)*625/24)!);
      assert.equal(sample.frame,frame);
      assert.equal(sample.flipped,facing==='left');
    }
    assert.equal(sampleMiraFrame(motion.sample(630)!).frame,0);
  }
});

test('reduced motion holds repeated work and conversational gestures but retains meaningful service phases',()=>{
  for(const action of ['walk','wipe','polish','greet','listen','chat'] as const){
    const first=sampleMiraFrame(view(action,.1),true);
    for(const p of [.3,.5,.9])assert.equal(sampleMiraFrame(view(action,p),true).frame,first.frame);
  }
  assert.notEqual(sampleMiraFrame(view('serve',.1),true).frame,sampleMiraFrame(view('serve',.9),true).frame);
});

test('every painted pose is reachable through a real action, including all four listening drawings',()=>{
  const reached=new Set<string>();
  for(const action of ['walk','sit','sit-down','stand-up','wipe','polish','stock','serve','greet','listen','chat'] as const){
    for(let n=0;n<=1000;n++){
      const frame=sampleMiraFrame(view(action,n/1000));reached.add(frame.atlas+':'+frame.frame);
    }
  }
  for(const [atlas,spec] of Object.entries(MIRA_ATLASES)){
    for(let frame=0;frame<spec.columns*spec.rows;frame++)assert.ok(reached.has(atlas+':'+frame),atlas+':'+frame);
  }
  assert.equal(reached.size,72);
});
