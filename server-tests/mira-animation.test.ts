import {test} from 'node:test';
import assert from 'node:assert/strict';
import {interpolateMiraProgress,isMiraPouring,sampleMiraFrame,MIRA_ATLASES} from '../src/game/miraAnimation';
import {MIRA_REST_SECONDS,MiraRoutine,type MiraView} from '../src/shared/miraRoutine';
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
  const pouring=sampleMiraFrame(view('serve',.4));assert.equal(pouring.atlas,'serve');assert.ok(isMiraPouring(pouring),String(pouring.frame));
  for(const p of [.9,1,2])assert.equal(sampleMiraFrame(view('serve',p)).frame,23);
  const indices=Array.from({length:101},(_,i)=>sampleMiraFrame(view('serve',i/100)).frame);
  for(let i=1;i<indices.length;i++)assert.ok(indices[i]>=indices[i-1]);
});

test('all actions select existing complete poses, including ends and nonfinite drafts',()=>{
  for(const action of ['idle','walk','wipe','polish','stock','greet','listen','chat','serve','sit','sit-down','stand-up','smile','tease','concern'] as const){
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
    const motion=new NpcMotion<MiraView>({delayMs:0,interpolate:interpolateMiraProgress});
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

test('wipe plays 24 registered poses per sweep and holds the final pose when the task finishes',()=>{
  const motion=new NpcMotion<MiraView>({delayMs:0,interpolate:interpolateMiraProgress});
  motion.push(view('wipe',0),0);
  for(let step=0;step<120;step++){
    motion.push(view('wipe',(step+1)/120),(step+1)*50);
    const pose=sampleMiraFrame(motion.sample(step*50+25)!);
    assert.equal(pose.atlas,'wipe');
    assert.equal(pose.frame,step%24);
  }
  assert.equal(sampleMiraFrame(view('wipe',1)).frame,23);
  assert.equal(sampleMiraFrame(view('wipe',.9),true).frame,3);
});

test('seating and rising share the same registered poses and seated rest moves only through its idle cycle',()=>{
  for(let frame=0;frame<24;frame++){
    const p=frame/23;
    assert.equal(sampleMiraFrame(view('sit-down',p)).frame,frame);
    assert.equal(sampleMiraFrame(view('stand-up',1-p)).frame,frame);
    assert.equal(sampleMiraFrame(view('sit',p),true).frame,24);
  }
  // Ten seconds of rest: a hold, the sip lifts through every seated drawing and lowers back, one step at a time.
  const seated=Array.from({length:1001},(_,i)=>sampleMiraFrame(view('sit',i/1000)).frame);
  assert.equal(seated[0],24);assert.ok(seated.includes(47));
  assert.ok(seated.every(frame=>frame>=24&&frame<=47));
  for(let i=1;i<seated.length;i++)assert.ok(Math.abs(seated[i]-seated[i-1])<=1,`sit step ${i}`);
  assert.equal(MIRA_REST_SECONDS,10);
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
  const views=[...(['walk','sit','sit-down','stand-up','wipe','polish','stock','serve','greet','listen','chat','idle','smile','tease','concern'] as const).map(action=>view(action,0)),
    {...view('idle',0),x:306}];
  for(const base of views){
    for(let n=0;n<=1000;n++){
      const frame=sampleMiraFrame({...base,progress:n/1000});reached.add(frame.atlas+':'+frame.frame);
    }
  }
  for(const [atlas,spec] of Object.entries(MIRA_ATLASES)){
    for(let frame=atlas==='work'?8:0;frame<spec.columns*spec.rows;frame++)assert.ok(reached.has(atlas+':'+frame),atlas+':'+frame);
  }
  const drawn=Object.entries(MIRA_ATLASES).reduce((sum,[atlas,spec])=>sum+spec.columns*spec.rows-(atlas==='work'?8:0),0);
  assert.equal(reached.size,drawn);assert.equal(drawn,172);
});

test('the step follows the distance covered and every walk starts and stops gently',()=>{
  const routine=new MiraRoutine();
  for(let n=0;n<600&&routine.state.action!=='walk';n++)routine.tick(.05);
  assert.equal(routine.state.action,'walk');
  let last={...routine.state},travelled=0,phase=0,fastest=0,first=Infinity;
  for(let n=0;n<400&&routine.state.action==='walk';n++){
    routine.tick(.05);const moved=Math.hypot(routine.state.x-last.x,routine.state.y-last.y);
    if(routine.state.action!=='walk')break;
    travelled+=moved;phase+=(routine.state.progress-last.progress+1)%1;fastest=Math.max(fastest,moved/.05);first=Math.min(first,moved/.05);
    last={...routine.state};
  }
  assert.ok(Math.abs(phase*76-travelled)<1,`phase ${phase} for ${travelled}px`);
  assert.ok(fastest<=85.01&&fastest>45,`top speed ${fastest}`);
  assert.ok(first<fastest*.7,`start ${first} vs ${fastest}`);
});

test('a reply mood plays a short shared reaction before talking',()=>{
  const routine=new MiraRoutine();
  for(let n=0;n<200;n++)routine.tick(.05,false,false,'listen');
  routine.tick(.05,false,false,'speak-tease');
  assert.equal(routine.state.action,'tease');
  for(let n=0;n<30;n++)routine.tick(.05,false,false,'speak-tease');
  assert.equal(routine.state.action,'chat');
  const plain=new MiraRoutine();
  for(let n=0;n<200;n++)plain.tick(.05,false,false,'listen');
  plain.tick(.05,false,false,'speak');
  assert.equal(plain.state.action,'chat');
  for(const mood of ['smile','tease','concern'] as const)for(const p of [0,.5,1])assert.equal(sampleMiraFrame(view(mood,p)).atlas,'extra');
});

test('between jobs she pauses at the counter instead of turning straight to the next task',()=>{
  const routine=new MiraRoutine(),seen:string[]=[];
  for(let n=0;n<4000;n++){routine.tick(.05);if(seen.at(-1)!==routine.state.action)seen.push(routine.state.action);}
  const order=seen.filter(action=>action!=='walk');
  assert.ok(order.join(' ').includes('sit-down sit stand-up idle wipe'),order.join(' '));
  assert.ok(order.join(' ').includes('polish idle wipe'),order.join(' '));
});

test('a mostly vertical walk keeps the painted side instead of snapping to the right',()=>{
  const routine=new MiraRoutine();const facings=new Set<string>();
  for(let n=0;n<4000;n++){routine.tick(.05);if(routine.state.action==='walk')facings.add(routine.state.facing);}
  assert.deepEqual([...facings].sort(),['left','right']);
});
