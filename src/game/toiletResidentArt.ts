import type {ToiletResidentPose} from './toiletResidentPose';

type Paint=CanvasRenderingContext2D;
const ink='#302e34',skin='#efc28e',shirt='#278d91';
function oval(c:Paint,x:number,y:number,w:number,h:number,color:string,edge=ink,width=.8){
  c.beginPath();c.ellipse(x,y,w/2,h/2,0,0,Math.PI*2);c.fillStyle=color;c.fill();if(edge){c.strokeStyle=edge;c.lineWidth=width;c.stroke();}
}
function path(c:Paint,points:readonly number[][],color:string,width=1,fill=false){
  c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));
  if(fill){c.closePath();c.fillStyle=color;c.fill();c.lineWidth=.8;c.strokeStyle=ink;c.stroke();}
  else{c.strokeStyle=color;c.lineWidth=width;c.lineCap='round';c.lineJoin='round';c.stroke();}
}
function foam(c:Paint,x:number,y:number,size=1){
  for(const [dx,dy,r]of [[-2,0,2],[0,-2,2.3],[2,0,2.1],[0,2,2.1]])oval(c,x+dx*size,y+dy*size,r*2*size,r*2*size,'#f5faf5','#c4d7ce',.45);
  oval(c,x-.5,y-1,1,1,'#ffffff','');
}
function paper(c:Paint,x:number,y:number){
  path(c,[[x-3,y-4],[x+4,y-3],[x+3,y+4],[x,y+3],[x-2,y+4]],'#fff5dc',1,true);
  path(c,[[x-1,y-2],[x+2,y-1],[x+1,y+2]],'#c2bba6',.45);
}

/** Drawn inside the existing cubicle. The shirt conceals the wiping gesture. */
export function paintToiletResident(c:Paint,pose:ToiletResidentPose){
  c.save();c.beginPath();c.rect(9,9,82,123);c.clip();
  c.translate(0,30);c.scale(1,.65);
  oval(c,51,119,43,9,'#57635b33','');
  for(const x of [39,62]){
    oval(c,x,89,15,21,skin);oval(c,x,101,11,17,skin);
    oval(c,x,116,22,9,'#453b35');
  }
  path(c,[[28,103],[36,101],[48,104],[61,101],[73,104],[71,112],[59,114],[49,111],[35,114],[29,110]],'#444149',1,true);
  path(c,[[29,105],[70,106]],'#76645a',2.6);path(c,[[32,110],[41,108],[49,110],[59,108],[69,111]],'#2d2c33',.7);
  c.fillStyle='#aaa59a';c.fillRect(47,103,7,5);c.fillStyle='#423c3b';c.fillRect(48.5,104.3,4,2.3);
  for(const [x,y]of [[78,119],[72,126]])paper(c,x,y);
  c.save();c.translate(pose.lean,pose.breath);
  const arm=(right:boolean)=>{
    const hand=right?pose.right:pose.left,shoulder={x:right?65:34,y:57};
    const elbow=right?{x:72+(hand.x-66)*.2,y:68+(hand.y-79)*.3}:{x:29+(hand.x-35)*.4,y:68};
    path(c,[[shoulder.x,shoulder.y],[elbow.x,elbow.y],[hand.x,hand.y]],ink,8);
    path(c,[[shoulder.x,shoulder.y],[elbow.x,elbow.y]],shirt,6.4);
    path(c,[[elbow.x,elbow.y],[hand.x,hand.y]],skin,5.2);
    if(right&&pose.paper)paper(c,hand.x+1,hand.y);
    oval(c,hand.x,hand.y,6,7,skin);
    path(c,[[hand.x-1,hand.y],[hand.x+1,hand.y+1]],'#c99b70',.5);
  };
  if(pose.behindShirt)arm(true);
  path(c,[[34,53],[44,51],[56,51],[65,54],[69,65],[70,82],[60,88],[50,84],[40,88],[30,82],[32,64]],shirt,1,true);
  path(c,[[44,52],[49,60],[51,54],[56,60],[59,53]],'#50aba9',1.2);
  path(c,[[51,60],[51,83]],'#246769',.65);
  for(const y of [64,72,80])oval(c,53,y,1.6,1.6,'#245b61','');
  path(c,[[58,64],[64,64],[64,70],[58,70]],'#176e75',.65);
  foam(c,34,57,.7);foam(c,65,59,.8);foam(c,42,70,.85);foam(c,61,80,.7);
  arm(false);if(!pose.behindShirt)arm(true);
  c.save();c.translate(50,38);c.scale(1,1/.65);c.rotate(-.08-pose.lean*.012);c.translate(-50,-38);
  oval(c,50,34,40,42,'#25252b');
  path(c,[[31,31],[33,20],[38,20],[39,15],[46,17],[50,13],[54,17],[61,17],[68,24],[69,40]],'#25252b',1,true);
  oval(c,50,38,35,37,skin);
  path(c,[[33,31],[39,20],[45,22],[46,18],[51,24],[54,20],[62,28],[67,30]],'#25252b',1,true);
  for(const x of [41.5,57.5]){
    if(pose.blink){path(c,[[x-6,40],[x+5,39]],ink,.75);continue;}
    oval(c,x,39.5,16,11,'#f5f1db','#a78a65',.55);
    c.save();c.beginPath();c.ellipse(x,39.5,8,5.5,0,0,Math.PI*2);c.clip();
    path(c,[[x-9,35],[x+9,33],[x+9,39],[x-9,41]],'#ddba85',.5,true);c.restore();
    oval(c,x+2,40.5,1.8,2.6,ink,'');
    path(c,[[x-7,40],[x+7,37.5]],'#8a6e4d',.55);
  }
  path(c,[[36,29],[44,27]],ink,1.5);path(c,[[54,27],[63,28]],ink,1.5);
  path(c,[[50,42],[48,47],[51,48]],'#b4895e',.75);
  path(c,[[44,49],[48,48],[55,49],[57,52],[50,51],[44,53]],'#28252a',1,true);
  path(c,[[47,53],[54,52],[55,56],[49,57]],'#27242a',1,true);
  path(c,[[49,53],[52,53]],'#f6edcf',.7);path(c,[[46,59],[51,58]],'#b28e67',.65);
  foam(c,37,20,.9);foam(c,34,26,.65);foam(c,63,24,.65);foam(c,35,46,.6);foam(c,64,47,.7);
  c.restore();c.restore();c.restore();
}
