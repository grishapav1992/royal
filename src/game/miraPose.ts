import { miraSeatAmount, type MiraView } from '../shared/miraRoutine';
import { CAT_CARE } from '../shared/catCare';

export type RigPoint = {x:number;y:number};
export type MiraJoint = 'hip'|'neck'|'leftShoulder'|'rightShoulder'|'leftElbow'|'rightElbow'|'leftHand'|'rightHand'|'leftHip'|'rightHip'|'leftKnee'|'rightKnee'|'leftFoot'|'rightFoot';
export type MiraProp = {kind:'glass'|'bottle'|'cloth';point:RigPoint;angle:number;alpha:number};
export type MiraPose = {
  action:MiraView['action'];seat:number;rootY:number;bodyAngle:number;headAngle:number;
  facing:'front'|'side'|'back';flipped:boolean;joints:Record<MiraJoint,RigPoint>;
  props:MiraProp[];pour?:{from:RigPoint;to:RigPoint};mouthOpen:boolean;blink:boolean;
};
export const MIRA_RIG_SIZE={width:96,height:160,resolution:4} as const;
const point=(x:number,y:number):RigPoint=>({x,y});
const mix=(a:number,b:number,p:number)=>a+(b-a)*p;
const clamp=(p:number)=>Math.max(0,Math.min(1,p));
export const mixPoint=(a:RigPoint,b:RigPoint,p:number)=>point(mix(a.x,b.x,p),mix(a.y,b.y,p));
const rotate=(p:RigPoint,a:number)=>point(p.x*Math.cos(a)-p.y*Math.sin(a),p.x*Math.sin(a)+p.y*Math.cos(a));
const add=(a:RigPoint,b:RigPoint)=>point(a.x+b.x,a.y+b.y);

/** A two-bone arm keeps its hand on the requested contact while its elbow bends. */
export function miraElbow(shoulder:RigPoint,hand:RigPoint,side:number,upper=18,lower=18):RigPoint {
  const dx=hand.x-shoulder.x,dy=hand.y-shoulder.y,distance=Math.max(.001,Math.hypot(dx,dy));
  const reach=Math.min(distance,upper+lower-.001),along=(upper*upper-lower*lower+reach*reach)/(2*reach);
  const bend=Math.sqrt(Math.max(0,upper*upper-along*along)),ux=dx/distance,uy=dy/distance;
  return point(shoulder.x+ux*along+uy*bend*side,shoulder.y+uy*along-ux*bend*side);
}

/** Art timings and amplitudes are game-specific choices, not perceptual thresholds. */
export function miraPose(view:MiraView,reducedMotion=false,time=0):MiraPose {
  const seat=miraSeatAmount(view.action,view.progress),p=clamp(view.progress);
  const phase=reducedMotion?0:p*Math.PI*8,wave=Math.sin(phase),stride=Math.sin(p*Math.PI*2);
  const walking=view.action==='walk',working=view.action==='wipe',stock=view.action==='stock';
  const side=view.facing==='left'||view.facing==='right';
  const breath=reducedMotion?0:Math.sin(time/1400)*.13;
  const push=view.action==='stand-up'||view.action==='sit-down'?Math.sin(p*Math.PI)*1.2:0;
  const rootY=59-21.8*seat;
  // A counter seat is higher than standing behind it; hands keep their table contacts.
  const floorDrop=17*(1-seat);
  const hip=point(48,90+21.8*seat+floorDrop-push+breath-(walking&&!reducedMotion?Math.abs(stride)*.8:0));
  const bodyAngle=working?.13:walking&&!reducedMotion?stride*.025:seat*.02;
  const neck=add(hip,rotate(point(0,-32),bodyAngle));
  const leftShoulder=add(neck,rotate(point(side?1.5:-12.5,4),bodyAngle));
  const rightShoulder=add(neck,rotate(point(side?-2:13.5,4),bodyAngle));
  const jointY=21.8*seat-push+breath;
  let leftHand=point(mix(41,27,seat),mix(91,65,seat)+jointY);
  let rightHand=point(mix(58,70,seat),mix(91,93,seat)+jointY);
  const props:MiraProp[]=[];
  let pour:MiraPose['pour'];
  if(seat>.001){
    if(view.action==='stand-up'||view.action==='sit-down')leftHand=point(mix(32,27,seat),mix(93,65,seat)+jointY);
    props.push({kind:'glass',point:add(leftHand,point(-1,-5)),angle:0,alpha:clamp(seat*5)});
  }else if(walking){
    const swing=reducedMotion?0:stride*7;
    leftHand=point((side?48:39)-swing,95+floorDrop);rightHand=point((side?48:58)+swing,95+floorDrop);
  }else if(working){
    const settle=clamp((p-.9)/.1);
    const limit=CAT_CARE.bar.perch.x-view.x+48-8;
    leftHand=point(35,94);rightHand=point(mix(Math.min(limit,65+wave*9),57,settle),97);
    props.push({kind:'cloth',point:add(rightHand,point(1,2)),angle:wave*.05,alpha:1-settle});
  }else if(view.action==='polish'){
    const settle=clamp((p-.88)/.12);
    leftHand=point(mix(44,39,settle),mix(88,94,settle));
    rightHand=point(mix(48+wave*1.8,58,settle),mix(80+Math.cos(phase)*1.4,92,settle));
    props.push({kind:'glass',point:add(leftHand,point(0,-5)),angle:0,alpha:1-settle});
    props.push({kind:'cloth',point:add(rightHand,point(0,1)),angle:wave*.15,alpha:1-settle});
  }else if(stock){
    const lift=reducedMotion?5:(wave+1)*3;
    leftHand=point(32,73);rightHand=point(65,56-lift);
    props.push({kind:'bottle',point:add(rightHand,point(0,-2)),angle:-.2,alpha:1});
  }else if(view.action==='greet'){
    const lift=Math.sin(p*Math.PI),flutter=reducedMotion?0:Math.sin(p*Math.PI*8)*lift*1.8;
    leftHand=point(mix(41,27,lift)+flutter,mix(91,48,lift));
  }else if(view.action==='listen'){
    leftHand=point(37,93);rightHand=point(59,93);
  }else if(view.action==='chat'){
    rightHand=point(62+(reducedMotion?0:wave*1.5),80+(reducedMotion?0:Math.cos(phase)*2));
  }else if(view.action==='serve'){
    const take=clamp(p/.2),handover=clamp((p-.55)/.35);
    leftHand=point(mix(mix(32,52,take),42,handover),mix(91,97,handover));
    const lift=clamp((p-.16)/.1)*(1-clamp((p-.5)/.13));
    rightHand=point(mix(58,66,lift),mix(91,67,lift));
    props.push({kind:'glass',point:add(leftHand,point(0,-5)),angle:0,alpha:clamp(p/.08)});
    if(p<.65){
      const angle=-lift*2.2;
      const bottle=add(rightHand,point(0,-2));
      props.push({kind:'bottle',point:bottle,angle,alpha:clamp((.65-p)/.08)});
      if(p>.28&&p<.51)pour={from:add(bottle,rotate(point(0,-12),angle)),to:add(leftHand,point(0,-12))};
    }
  }
  const leftHip=add(hip,point(-5,0)),rightHip=add(hip,point(5,0));
  const leftKnee=point(mix(43,38,seat),mix(134,132.8,seat)-push);
  const rightKnee=point(mix(53,49,seat),mix(134,128.8,seat)-push);
  const leftFoot=point(mix(44,53,seat),mix(158,157,seat));
  const rightFoot=point(mix(54,43,seat),mix(158,158,seat));
  if(walking&&!reducedMotion){
    leftKnee.x+=stride*8;rightKnee.x-=stride*8;
    leftFoot.x+=stride*12;rightFoot.x-=stride*12;
    leftFoot.y-=Math.max(0,-stride)*4;rightFoot.y-=Math.max(0,stride)*4;
    leftKnee.y-=Math.max(0,-stride)*3;rightKnee.y-=Math.max(0,stride)*3;
  }
  return {action:view.action,seat,rootY,bodyAngle,headAngle:bodyAngle+(view.action==='listen'?-.065:view.action==='chat'&&!reducedMotion?wave*.028:-.025),
    facing:view.facing==='up'?'back':side?'side':'front',flipped:view.facing==='left',
    joints:{hip,neck,leftShoulder,rightShoulder,leftHand,rightHand,leftElbow:miraElbow(leftShoulder,leftHand,seat>.001||view.action==='greet'?1:-1),rightElbow:miraElbow(rightShoulder,rightHand,stock||view.action==='serve'?-1:1),leftHip,rightHip,leftKnee,rightKnee,leftFoot,rightFoot},props,pour,
    mouthOpen:view.action==='chat'&&!reducedMotion&&Math.sin(phase*3)>.05,blink:!reducedMotion&&time%4700>4540};
}

export function blendMiraPose(previous:MiraPose,next:MiraPose,amount:number):MiraPose {
  const joints={...next.joints};
  for(const name of Object.keys(joints) as MiraJoint[])joints[name]=mixPoint(previous.joints[name],next.joints[name],amount);
  const angle=(a:RigPoint,b:RigPoint)=>Math.atan2(b.y-a.y,b.x-a.x);
  const blendAngle=(a:number,b:number)=>a+Math.atan2(Math.sin(b-a),Math.cos(b-a))*amount;
  for(const side of ['left','right'] as const){
    const shoulder=(side+'Shoulder') as MiraJoint,elbow=(side+'Elbow') as MiraJoint,hand=(side+'Hand') as MiraJoint;
    const upper=blendAngle(angle(previous.joints[shoulder],previous.joints[elbow]),angle(next.joints[shoulder],next.joints[elbow]));
    const lower=blendAngle(angle(previous.joints[elbow],previous.joints[hand]),angle(next.joints[elbow],next.joints[hand]));
    joints[elbow]=add(joints[shoulder],point(Math.cos(upper)*18,Math.sin(upper)*18));
    joints[hand]=add(joints[elbow],point(Math.cos(lower)*18,Math.sin(lower)*18));
  }
  const follow=(p:RigPoint,hand:'leftHand'|'rightHand')=>point(p.x+joints[hand].x-next.joints[hand].x,p.y+joints[hand].y-next.joints[hand].y);
  const props=next.props.map(prop=>({...prop,point:follow(prop.point,prop.kind==='glass'?'leftHand':'rightHand')}));
  const pour=next.pour?{from:follow(next.pour.from,'rightHand'),to:follow(next.pour.to,'leftHand')}:undefined;
  return {...next,joints,props,pour,seat:mix(previous.seat,next.seat,amount),rootY:mix(previous.rootY,next.rootY,amount),bodyAngle:mix(previous.bodyAngle,next.bodyAngle,amount),headAngle:mix(previous.headAngle,next.headAngle,amount)};
}
