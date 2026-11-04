import type Phaser from 'phaser';
import { drawAvatar,type AvatarDrawingParts } from './avatarArt';
import { CLOTHING_COLORS,SKIN_COLORS,parseAppearance,type Appearance } from '../shared/appearance';
import type { Facing } from '../shared/movement';
import { TOURIST_FRAMES,touristCameraRig } from './touristCameraPose';

type Paint=CanvasRenderingContext2D;
const ink='#343039';
export function paintTouristFrame(c:Paint,appearance:Appearance,facing:Facing,frame:number){
  const rig=touristCameraRig(facing,frame),skin=SKIN_COLORS[appearance.skinTone],sleeve=CLOTHING_COLORS[appearance.topColor];
  const line=(c:Paint,points:{x:number;y:number}[],color:string,width:number)=>{c.beginPath();points.forEach((p,i)=>i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y));c.strokeStyle=color;c.lineWidth=width;c.lineCap='round';c.lineJoin='round';c.stroke();};
  const hand=(c:Paint,p:{x:number;y:number})=>{c.beginPath();c.ellipse(p.x,p.y,3.1,3.5,0,0,Math.PI*2);c.fillStyle=skin;c.fill();c.strokeStyle=ink;c.lineWidth=.65;c.stroke();};
  const armTip=(far:boolean,x:number)=>{const target=far?rig.hands.far:rig.hands.near;return {x:x+.2+(target.x-x-.2)*rig.grip,y:68+(target.y-68)*rig.grip};};
  const arm=(c:Paint,far:boolean,x:number,y:number)=>{
    const g=rig.grip,tip=armTip(far,x);
    const elbow={x:x+((rig.side?(far?47:35):(far?10:54))-x)*g,y:58+((rig.side?far?52-8*rig.lift:55-3*rig.lift:57-2*rig.lift)-58)*g};
    const points=[{x,y},elbow,tip];line(c,points,ink,8.2);line(c,points,sleeve,6.6);hand(c,tip);
    if(!far&&rig.press){
      const button={x:rig.camera.x+(rig.side?1:6),y:rig.camera.y-rig.camera.h/2+.5};
      line(c,[tip,{x:button.x-1,y:button.y-1.3},button],skin,2.1);
    }
  };
  const strap=(c:Paint)=>{
    c.beginPath();
    if(rig.back){c.moveTo(22,44);c.quadraticCurveTo(32,50,42,44);}
    else for(const [neckX,dx]of (rig.side?[[35,-5],[44,5]]:[[23,-8],[41,8]])){
      c.moveTo(neckX,45);c.quadraticCurveTo(neckX+(dx<0?-5:5),rig.lift>.2?67:52,rig.camera.x+dx,rig.camera.y-2);
    }
    c.strokeStyle='#454149';c.lineWidth=1.7;c.stroke();
  };
  const camera=(c:Paint)=>{
    const {x,y,w,h,angle}=rig.camera;c.save();c.translate(x,y);c.rotate(angle);
    const box=(x:number,y:number,w:number,h:number,color:string)=>{c.beginPath();c.roundRect(x,y,w,h,1.5);c.fillStyle=color;c.fill();c.strokeStyle='#242a31';c.lineWidth=1;c.stroke();};
    box(-w/2,-h/2,w,h,'#46515b');line(c,[{x:-w/2+2,y:-h/2+1},{x:w/2-2,y:-h/2+1}],'#839397',1);
    box(rig.side?-5:-3,-h/2-2,6,3,'#303943');
    box(rig.side?2:6,-h/2-1,3,1.5,rig.press?'#c0a577':'#d9cba6');
    if(rig.side){
      box(4,-3.5,7,7,'#303b47');line(c,[{x:7,y:-2.5},{x:7,y:2.5}],'#8ca4a9',1);
      c.beginPath();c.ellipse(11.2,0,1.5,3.3,0,0,Math.PI*2);c.fillStyle='#83aeb5';c.fill();c.strokeStyle='#27353f';c.stroke();
      box(-6.3,-2.7,1.5,5.5,'#678b8b');
    }else{
      c.beginPath();c.arc(1,0,4.5,0,Math.PI*2);c.fillStyle='#283744';c.fill();c.strokeStyle='#99b4b9';c.lineWidth=1.3;c.stroke();
      c.beginPath();c.arc(1,0,2.4,0,Math.PI*2);c.fillStyle='#618d9a';c.fill();
      c.beginPath();c.arc(.3,-.8,.8,0,Math.PI*2);c.fillStyle='#bdd6d4';c.fill();
    }
    c.restore();
  };
  const parts:AvatarDrawingParts={
    gazeY:rig.review*2,
    arm:rig.grip>0?(c,joint)=>{if(rig.back||!rig.side&&joint.far)return;arm(c,joint.far,joint.x,joint.y);}:undefined,
    beforeBody:c=>{if(rig.back&&rig.grip>0){arm(c,true,16,47);arm(c,false,48,47);camera(c);}},
    beforeHead:strap,
    afterHead:c=>{
      if(rig.back)return;
      if(rig.grip>0&&!rig.side)arm(c,true,16,47);
      camera(c);
      if(rig.grip>0)hand(c,armTip(true,rig.side?39:16));
    },
  };
  drawAvatar(c,appearance,facing,rig.avatarFrame,false,-1,parts);
}

/** One atlas contains the body, fingers, strap and camera in the same drawing space. */
export function createTouristTexture(scene:Phaser.Scene,serialized:string){
  const key='street-tourist-camera-v2';if(scene.textures.exists(key))return key;
  const appearance=parseAppearance(serialized);if(!appearance)throw Error('Tourist outfit is invalid');
  const columns=16,width=96,height=144,count=TOURIST_FRAMES*4;
  const texture=scene.textures.createCanvas(key,columns*width,Math.ceil(count/columns)*height)!,c=texture.context;
  const directions:Facing[]=['down','left','right','up'];
  directions.forEach((facing,row)=>{for(let frame=0;frame<TOURIST_FRAMES;frame++){
    const index=row*TOURIST_FRAMES+frame,x=index%columns*width,y=Math.floor(index/columns)*height;
    c.save();c.translate(x,y);c.scale(3,3);c.translate(0,8);paintTouristFrame(c,appearance,facing,frame);c.restore();
    texture.add(`${facing}-${frame}`,0,x,y,width,height);
  }});texture.refresh();return key;
}
