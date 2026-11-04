import {test} from 'node:test';
import assert from 'node:assert/strict';
import {miraPose,blendMiraPose,type MiraJoint,type RigPoint} from '../src/game/miraPose';
import {MiraRoutine,type MiraView} from '../src/shared/miraRoutine';
import {CAT_CARE} from '../src/shared/catCare';
const view=(action:MiraView['action'],progress:number,x=265,facing:MiraView['facing']='down'):MiraView=>({x,y:456,action,progress,facing});
const distance=(a:RigPoint,b:RigPoint)=>Math.hypot(a.x-b.x,a.y-b.y);

test('illustrated arms retain their bone lengths and high gestures bend away from the face',()=>{
  for(const action of ['idle','walk','wipe','polish','stock','greet','listen','chat','serve','sit','sit-down','stand-up'] as const){
    for(let frame=0;frame<=100;frame++){
      const pose=miraPose(view(action,frame/100,334,action==='walk'?'right':action==='stock'?'up':'down'),false,2000),j=pose.joints;
      for(const side of ['left','right'] as const){
        assert.ok(Math.abs(distance(j[side+'Shoulder' as MiraJoint],j[side+'Elbow' as MiraJoint])-18)<.001,action+' upper arm');
        assert.ok(Math.abs(distance(j[side+'Elbow' as MiraJoint],j[side+'Hand' as MiraJoint])-18)<.001,action+' forearm');
      }
    }
  }
  const seated=miraPose(view('sit',.5));assert.ok(seated.joints.leftElbow.y>seated.joints.leftShoulder.y);
  const greeting=miraPose(view('greet',.5));assert.ok(greeting.joints.leftElbow.x<greeting.joints.leftShoulder.x);assert.ok(greeting.joints.leftHand.y<greeting.joints.neck.y);
});

test('interrupting a partial seat preserves every world contact in the illustrated pose',()=>{
  const routine=new MiraRoutine();for(let n=0;n<2300&&routine.state.action!=='sit-down';n++)routine.tick(.05);
  for(let n=0;n<5;n++)routine.tick(.05);
  const before=miraPose({...routine.state},false,2000);routine.tick(.05,false,false,'listen');
  assert.equal(routine.state.action,'stand-up');const after=miraPose({...routine.state},false,2000);
  for(const name of Object.keys(before.joints) as MiraJoint[]){
    assert.ok(Math.abs(before.joints[name].x-after.joints[name].x)<1e-7,name+' x');
    assert.ok(Math.abs(before.joints[name].y+before.rootY-after.joints[name].y-after.rootY)<1e-7,name+' y');
  }
});

test('the cleaning cloth stays on the countertop and leaves the cat corner free',()=>{
  for(const x of [191,334])for(let frame=0;frame<100;frame++){
    const pose=miraPose(view('wipe',frame/100,x)),cloth=pose.props.find(p=>p.kind==='cloth')!;
    const worldY=456+pose.rootY-160+cloth.point.y,worldRight=x+cloth.point.x-48+5;
    assert.ok(worldY>=446&&worldY<=463,'cloth touches the painted counter');
    assert.ok(worldRight<CAT_CARE.bar.perch.x,'cloth leaves the cat perch free');
    assert.ok(worldRight<CAT_CARE.bar.mug.x-8,'cloth leaves the separate water mug free');
  }
});

test('blended props follow their hands, and service settles after its pour',()=>{
  const previous=miraPose(view('sit',.5)),next=miraPose(view('serve',.4)),blended=blendMiraPose(previous,next,.15);
  for(const side of ['left','right'] as const){
    assert.ok(Math.abs(distance(blended.joints[side+'Shoulder' as MiraJoint],blended.joints[side+'Elbow' as MiraJoint])-18)<1e-7);
    assert.ok(Math.abs(distance(blended.joints[side+'Elbow' as MiraJoint],blended.joints[side+'Hand' as MiraJoint])-18)<1e-7);
  }
  for(const prop of blended.props){
    const hand=prop.kind==='glass'?'leftHand':'rightHand',original=next.props.find(p=>p.kind===prop.kind)!;
    assert.ok(Math.abs(prop.point.x-blended.joints[hand].x-original.point.x+next.joints[hand].x)<1e-7);
    assert.ok(Math.abs(prop.point.y-blended.joints[hand].y-original.point.y+next.joints[hand].y)<1e-7);
  }
  assert.ok(next.pour);
  const settled=miraPose(view('serve',1));assert.equal(settled.pour,undefined);assert.deepEqual(settled.props.map(p=>p.kind),['glass']);
  const later=miraPose(view('serve',1),false,3500);assert.deepEqual(later.props,settled.props);
});

test('reduced motion keeps action poses while suppressing repeating gestures and speech loops',()=>{
  const a=miraPose(view('wipe',.2),true,100),b=miraPose(view('wipe',.7),true,2100);assert.deepEqual(a.joints,b.joints);assert.deepEqual(a.props,b.props);
  const speaking=miraPose(view('chat',.24),true,4590);assert.equal(speaking.mouthOpen,false);assert.equal(speaking.blink,false);
});
