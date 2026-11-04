import type Phaser from 'phaser';
import type {ToiletResidentPose} from './toiletResidentPose';

type Paint=CanvasRenderingContext2D;
type Point={x:number;y:number};
type Part={x:number;y:number;w:number;h:number;pivot:Point;hand:Point};
export const TOILET_RESIDENT_RIG_KEY='toilet-visitor-reference-rig-v2';
export const TOILET_RESIDENT_RIG_URL='/assets/toilet/visitor-rig-v2-161e9417f4a0.png';
const scale=102/1024,centerX=595,top=27;
const body={x:330,y:0,w:530,h:1024};
const left:Part={x:1070,y:584,w:190,h:312,pivot:{x:1147,y:653},hand:{x:1174,y:831}};
const right:Part={x:1046,y:152,w:185,h:315,pivot:{x:1153,y:221},hand:{x:1125,y:399}};
let rig:CanvasImageSource|undefined;

export function preloadToiletResident(scene:Phaser.Scene){scene.load.image(TOILET_RESIDENT_RIG_KEY,TOILET_RESIDENT_RIG_URL);}
export function prepareToiletResident(scene:Phaser.Scene){
  rig=scene.textures.exists(TOILET_RESIDENT_RIG_KEY)?scene.textures.get(TOILET_RESIDENT_RIG_KEY).getSourceImage():undefined;
}
export function toiletResidentRigReady(){return !!rig;}
const onBody=(x:number,y:number):Point=>({x:50+(x-centerX)*scale,y:top+y*scale});

function oval(c:Paint,x:number,y:number,w:number,h:number,color:string,edge='#302f35',width=.6){
  c.beginPath();c.ellipse(x,y,w/2,h/2,0,0,Math.PI*2);c.fillStyle=color;c.fill();if(edge){c.strokeStyle=edge;c.lineWidth=width;c.stroke();}
}
function paper(c:Paint,p:Point){
  c.beginPath();c.moveTo(p.x-2,p.y-2);c.lineTo(p.x+3,p.y-1.5);c.lineTo(p.x+2.6,p.y+3);c.lineTo(p.x+.5,p.y+2.5);c.lineTo(p.x-2,p.y+3);c.closePath();
  c.fillStyle='#fff7e6';c.fill();c.lineWidth=.35;c.strokeStyle='#544a40';c.stroke();
}

/** Each forearm pivots at its cuff; the body retains the reference's uniform scale. */
function arm(c:Paint,part:Part,pivot:Point,target:Point):Point{
  const sx=part.hand.x-part.pivot.x,sy=part.hand.y-part.pivot.y,dx=target.x-pivot.x,dy=target.y-pivot.y;
  const angle=Math.atan2(dy,dx)-Math.atan2(sy,sx),length=Math.hypot(sx,sy)*scale;
  const stretch=Math.max(.62,Math.min(1.45,Math.hypot(dx,dy)/length));
  c.save();c.translate(pivot.x,pivot.y);c.rotate(angle);c.scale(scale,scale*stretch);
  c.drawImage(rig!,part.x,part.y,part.w,part.h,part.x-part.pivot.x,part.y-part.pivot.y,part.w,part.h);c.restore();
  return {x:pivot.x+scale*(sx*Math.cos(angle)-sy*stretch*Math.sin(angle)),y:pivot.y+scale*(sx*Math.sin(angle)+sy*stretch*Math.cos(angle))};
}

/** Reference artwork is a rig, not a redrawn face. The shirt conceals the gesture. */
export function paintToiletResident(c:Paint,pose:ToiletResidentPose){
  if(!rig)return;
  c.save();c.beginPath();c.rect(9,9,82,123);c.clip();
  oval(c,50,129,43,5,'#57635b33','');
  for(const p of [{x:78,y:123},{x:73,y:128}])paper(c,p);
  // The visible seat hugs the seated hips instead of appearing behind the head.
  oval(c,50,106,51,31,'#f3ecd8');oval(c,50,106,44,25,'#829f98');
  c.save();c.translate(50,130);c.rotate(-pose.lean*.005);c.scale(1,1+pose.breath*.002);c.translate(-50,-130);
  const leftPivot=onBody(418,625),rightPivot=onBody(783,625);
  const leftTarget={x:pose.left.x+1,y:pose.left.y*2-51};
  const rightTarget={x:pose.right.x+1+(pose.behindShirt?7:0),y:pose.right.y*2-51};
  let hand:Point|undefined;
  if(pose.behindShirt){hand=arm(c,right,rightPivot,rightTarget);if(pose.paper)paper(c,{x:hand.x+1,y:hand.y});}
  c.drawImage(rig,body.x,body.y,body.w,body.h,50-body.w*scale/2,top,body.w*scale,body.h*scale);
  const other=arm(c,left,leftPivot,leftTarget);
  if(!pose.behindShirt){
    hand=arm(c,right,rightPivot,rightTarget);
    if(pose.paper){
      if(pose.stage==='tear-paper'){
        c.beginPath();c.moveTo(other.x,other.y);c.lineTo(hand.x,hand.y);c.strokeStyle='#fff7e6';c.lineWidth=3;c.stroke();
      }
      paper(c,{x:hand.x+1,y:hand.y});
    }
  }
  c.restore();c.restore();
}
