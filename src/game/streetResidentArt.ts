import type Phaser from 'phaser';
import type { StreetResidentPose } from './StreetResidentActions';

const ink=0x302a30;
type Graphics=Phaser.GameObjects.Graphics;

export function createStreetMascotTexture(scene:Phaser.Scene){
  const key='street-golden-chip-mascot-walk';
  if(scene.textures.exists(key))return key;
  const texture=scene.textures.createCanvas(key,1400,220)!,c=texture.context;c.scale(2,2);
  const oval=(x:number,y:number,rx:number,ry:number,fill:string,edge=1.5)=>{
    c.beginPath();c.ellipse(x,y,rx,ry,0,0,Math.PI*2);c.fillStyle=fill;c.fill();
    if(edge){c.strokeStyle='#302a30';c.lineWidth=edge;c.stroke();}
  };
  for(let frame=0;frame<7;frame++){
  c.save();c.translate(frame*100,0);
  const step=frame===6?0:[0,1,.55,0,-1,-.55][frame];
  for(const [index,x] of [34,59].entries()){
    const lift=Math.max(0,step*(index?-1:1))*3;
    c.fillStyle='#665332';c.fillRect(x,87,8,17-lift);
  }
  for(const [index,x] of [36,64].entries())oval(x+step*(index?-2:2),104-Math.max(0,step*(index?-1:1))*3,11,4,'#37343b');
  oval(50,58,38,39,'#d8a63c',2);
  oval(50,58,32,33,'#f7d660',1.4);
  for(let n=0;n<12;n++){
    const a=n*Math.PI/6;c.save();c.translate(50,58);c.rotate(a);
    c.fillStyle=n%2?'#fff0bd':'#f0c35b';c.fillRect(-3,-37,6,8);c.restore();
  }
  oval(50,58,28,29,'#efc34b',1.2);
  oval(50,45,16,17,'#65452d',1.2);oval(50,45,13,14,'#e7b693',1);
  for(const x of [44,56]){oval(x,43,5.3,6.3,'#fff8e8',.7);oval(x+.3,43,1.5,2.1,'#302a30',0);}
  c.strokeStyle='#684736';c.lineWidth=1.3;c.beginPath();c.arc(50,49,6,0.15,Math.PI-.15);c.stroke();
  c.strokeStyle='#84632e';c.lineWidth=1.3;c.beginPath();c.moveTo(39,72);c.lineTo(61,72);c.stroke();
  c.font='bold 8px Georgia';c.textAlign='center';c.fillStyle='#69492a';c.fillText('ROYAL',50,82);
  c.beginPath();c.moveTo(42,69);c.lineTo(40,61);c.lineTo(46,65);c.lineTo(50,58);c.lineTo(54,65);c.lineTo(60,61);c.lineTo(58,69);c.closePath();c.fillStyle='#fff0b1';c.fill();c.strokeStyle='#8a642b';c.lineWidth=1;c.stroke();
  c.restore();texture.add(String(frame),0,frame*200,0,200,220);
  }
  texture.refresh();return key;
}

export function streetShovelPose(pose:StreetResidentPose){
  const {action,progress:p}=pose;
  const side=pose.facing==='left'||pose.facing==='right';
  const step=action==='walk'?[0,1,.55,0,-1,-.55][pose.frame]??0:0;
  const bounce=action==='walk'?[0,-1.2,-.5,0,-1.2,-.5][pose.frame]??0:0;
  // Follow the janitor's near wrist in the shared fat-body avatar, including its walking swing.
  const arm=step*(side?20:9)*Math.PI/180,body=step*(side?2.8:1.2)*Math.PI/180;
  const ax=(side?26:54)+.2*Math.cos(arm)-21*Math.sin(arm),ay=47+.2*Math.sin(arm)+21*Math.cos(arm);
  const dx=ax-32,dy=ay-64;
  const nativeX=32+(dx*Math.cos(body)-dy*Math.sin(body))*.94;
  const nativeY=76+(64+dx*Math.sin(body)+dy*Math.cos(body)+bounce-76)*.94;
  const handX=(nativeX-32)*.9*(pose.facing==='left'?-1:1),handY=nativeY*.9-72;
  const push=action==='clear-snow'?Math.sin(p*Math.PI*4)*8:0;
  const tap=action==='tap-shovel'?Math.sin(p*Math.PI*8)*3:0;
  const lean=action==='rest'||action==='look-around'?10:0;
  return {handX,handY,bladeX:handX+(pose.facing==='left'?-1:1)*((side?42:22)+push+lean),bladeY:-5+tap};
}

export function drawResidentShovel(g:Graphics,pose:StreetResidentPose){
  const {handX,handY,bladeX,bladeY}=streetShovelPose(pose),{action,progress:p}=pose;
  g.lineStyle(3,ink).lineBetween(handX,handY,bladeX,bladeY);
  g.lineStyle(1.4,0xa8794b).lineBetween(handX,handY,bladeX,bladeY);
  g.lineStyle(2,0x463b34).strokeRoundedRect(handX-4,handY-6,8,7,2);
  g.fillStyle(0x8e9a9e).fillRoundedRect(bladeX-8,bladeY-4,21,11,3);
  g.lineStyle(1.5,0x364148).strokeRoundedRect(bladeX-8,bladeY-4,21,11,3);
  g.fillStyle(0xf8fbff).fillEllipse(bladeX+5,bladeY+6,23,5);
  g.fillStyle(0xedc2a2).fillEllipse(handX,handY,5.5,6);
  g.lineStyle(.8,ink).strokeEllipse(handX,handY,5.5,6);
  if(action==='tap-shovel'){
    for(let n=0;n<3;n++){const t=(p*3+n/3)%1;g.fillStyle(0xf8fbff,1-t).fillEllipse(bladeX+12+t*9,bladeY+4+t*12,3,2);}
  }
}

export function drawTaxiHabit(g:Graphics,pose:StreetResidentPose){
  if(pose.action==='smoke'){
    // A cigarette stays at the mouth; the figure's own arms remain in the resting pose.
    g.lineStyle(2.5,0xefe4cf).lineBetween(-16,-32,-28,-34);
    g.lineStyle(2.8,0xbf8956).lineBetween(-16,-32,-20,-32.7);
    g.fillStyle(0xda8758).fillCircle(-28,-34,1.3);
    if(pose.progress>.3){
      for(let n=0;n<3;n++){
        const t=(pose.progress*1.7+n/3)%1,x=-28-Math.sin(t*Math.PI*2+n)*3,y=-38-t*30;
        g.lineStyle(1.4,0x81909b,(1-t)*.38).strokePoints([{x,y:y+7},{x:x-3,y:y+3},{x:x+1,y:y-2}]);
      }
    }
  }
  if(pose.action==='check-watch'){
    g.lineStyle(3,0x4d4240).lineBetween(-14,-16,-23,-13);
    g.fillStyle(0xd8c79e).fillCircle(-20,-14,3);g.lineStyle(1,ink).strokeCircle(-20,-14,3).lineBetween(-20,-14,-20,-16);
  }
}

export function drawTouristCamera(g:Graphics,pose:StreetResidentPose){
  const held=['frame-photo','take-photo','review-photo'].includes(pose.action);
  // Align with the shared raised-hand pose; the camera covers its ordinary held prop.
  const x=held?14:0,y=held?-36:-27;
  g.lineStyle(1.5,0x38333d).strokePoints([{x:-14,y:-37},{x:x-10,y:y+5},{x:x+10,y:y+5},{x:14,y:-37}]);
  g.fillStyle(0x3d424d).fillRoundedRect(x-13,y-8,26,17,3);g.lineStyle(1.5,ink).strokeRoundedRect(x-13,y-8,26,17,3);
  g.fillStyle(0x697580).fillRect(x-10,y-11,8,4);
  if(held){
    g.fillStyle(0x8bb7c3).fillRect(x-8,y-4,15,9);g.lineStyle(1,0x405663).strokeRect(x-8,y-4,15,9);
    g.fillStyle(pose.action==='take-photo'&&pose.progress>.42&&pose.progress<.57?0xf2d273:0x819b87).fillCircle(x+10,y-2,1.3);
    if(pose.action!=='review-photo')g.lineStyle(1,0xe7d39a).strokeRect(x-4,y-2,7,5);
  }else{
    g.fillStyle(0x222936).fillCircle(x+2,y,7);g.lineStyle(1.5,0x9baeb7).strokeCircle(x+2,y,5);
    g.fillStyle(0x7cabb7).fillCircle(x+2,y,2.5);
    g.fillStyle(pose.action==='take-photo'&&pose.progress>.42&&pose.progress<.57?0xe5c369:0x7f9394).fillRect(x-9,y-4,3,2);
  }
}

export function drawMascotArms(g:Graphics,pose:StreetResidentPose){
  const wave=pose.action==='wave'||pose.action==='greet';
  const poseForPhoto=pose.action==='pose';
  const swing=pose.action==='walk'?Math.sin(pose.progress*Math.PI*2)*6:0;
  const left={x:-43,y:wave?-65+Math.sin(pose.progress*Math.PI*6)*7:poseForPhoto?-43:-24+swing};
  const right={x:43,y:poseForPhoto?-55:-27-swing};
  for(const [side,hand] of [[-1,left],[1,right]] as const){
    g.lineStyle(8,ink).strokePoints([{x:side*31,y:-50},{x:side*40,y:-42},{x:hand.x,y:hand.y}]);
    g.lineStyle(5,0xc99736).strokePoints([{x:side*31,y:-50},{x:side*40,y:-42},{x:hand.x,y:hand.y}]);
    g.fillStyle(0xfff2d6).fillEllipse(hand.x,hand.y,11,13);g.lineStyle(1.3,ink).strokeEllipse(hand.x,hand.y,11,13);
    g.lineStyle(1,0xbbb3a3).lineBetween(hand.x-2,hand.y-4,hand.x-2,hand.y+2);
  }
}
